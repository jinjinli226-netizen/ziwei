import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {executeRuntime, discoverInstalledRuntimes, hermesHome, hermesProfileHome} from './runtime-adapters.mjs';
import {normalizeRuntimeProfile} from './employee-runtime.mjs';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_DIRECTORY_ENTRIES = 200;

function localDirectoryRoots() {
  if (process.platform !== 'win32') return ['/'];
  const roots = [];
  for (let code = 65; code <= 90; code += 1) {
    const root = `${String.fromCharCode(code)}:\\`;
    try { if (fs.statSync(root).isDirectory()) roots.push(root); } catch {}
  }
  return roots;
}

/**
 * Inspect a real directory on the paired workstation. This deliberately
 * returns directory names only; file contents never cross the A2A boundary.
 * A missing path is reported to the UI so creation remains an explicit user
 * action instead of silently creating a typo.
 */
export function inspectLocalDirectory({directoryPath = '', basePath = process.cwd(), createIfMissing = false, includeRoots = true, includeChildren = true, maxEntries = MAX_DIRECTORY_ENTRIES} = {}) {
  const raw = String(directoryPath || '').trim();
  const base = resolveApprovedPath(basePath, '.');
  const target = resolveApprovedPath(base, raw || '.');
  const limit = Math.min(MAX_DIRECTORY_ENTRIES, Math.max(1, Number(maxEntries) || MAX_DIRECTORY_ENTRIES));
  const result = {
    path: target,
    currentPath: base,
    exists: false,
    created: false,
    isDirectory: false,
    roots: includeRoots ? localDirectoryRoots() : [],
    entries: []
  };
  if (!fs.existsSync(target)) {
    if (!createIfMissing) return result;
    fs.mkdirSync(target, { recursive: true });
    result.created = true;
  }
  const stats = fs.statSync(target);
  if (!stats.isDirectory()) throw new Error(`工作目录不是目录: ${target}`);
  result.exists = true;
  result.isDirectory = true;
  if (includeChildren) {
    result.entries = fs.readdirSync(target, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
      .slice(0, limit)
      .map(entry => ({ name: entry.name, path: path.join(target, entry.name), type: 'directory' }));
  }
  return result;
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function realPathForExistingParent(candidate) {
  let existing = candidate;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  return fs.realpathSync.native(existing);
}

function resolveApprovedPath(basePath, requested = '.') {
  const root = path.resolve(String(basePath || process.cwd()));
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error('已批准的工作目录不存在或不是目录');
  const candidate = path.resolve(root, String(requested || '.'));
  if (!isInside(root, candidate)) throw new Error('工作目录超出已批准根目录');
  const rootReal = fs.realpathSync.native(root);
  if (!isInside(rootReal, realPathForExistingParent(candidate))) throw new Error('工作目录解析到已批准根目录之外');
  return candidate;
}

/**
 * Resolve a path under the daemon's private runtime directory. Both lexical
 * traversal and symlink/junction escapes are rejected. This is shared by all
 * local actions so a new action type cannot accidentally bypass the boundary.
 */
export function resolveRuntimePath(runtimeDir, requested = '.') {
  const root = path.resolve(runtimeDir);
  const rootReal = fs.realpathSync.native(root);
  const candidate = path.resolve(root, String(requested || '.'));
  if (!isInside(root, candidate)) throw new Error('A2A action path is outside the registered runtime directory');
  if (!isInside(rootReal, realPathForExistingParent(candidate))) {
    throw new Error('A2A action path resolves outside the registered runtime directory');
  }
  return candidate;
}

function decodeContent(payload) {
  if (payload.contentBase64 !== undefined || payload.content_base64 !== undefined) {
    const encoded = String(payload.contentBase64 ?? payload.content_base64 ?? '');
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error('contentBase64 is invalid');
    return Buffer.from(encoded, 'base64');
  }
  return Buffer.from(String(payload.content ?? payload.message ?? payload.prompt ?? ''), 'utf8');
}

function safeFileName(value) {
  const normalized = String(value || 'action').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120);
  return normalized || 'action';
}

function profileText(value, fallback = '') {
  return String(value ?? fallback).replace(/^\uFEFF/, '');
}

const HERMES_PROVIDER_FILES = ['auth.json', 'config.yaml', '.env'];

function inheritedHermesProviderFiles(root, payload = {}) {
  if (payload.inheritProvider === false || payload.inherit_provider === false) return [];
  return HERMES_PROVIDER_FILES.flatMap(name => {
    const source = path.join(root, name);
    try {
      if (!fs.existsSync(source) || !fs.statSync(source).isFile()) return [];
      const bytes = fs.readFileSync(source);
      if (bytes.length > MAX_FILE_BYTES) throw new Error(`Hermes provider 配置超过 10 MiB: ${name}`);
      return [{name, bytes}];
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  });
}

function attachmentFileName(value, index) {
  const candidate = path.basename(String(value || '').trim()).replace(/[^A-Za-z0-9._\-\u0080-\uFFFF]/g, '_').replace(/^\.+/, '').slice(0, 180);
  return candidate || `attachment-${index + 1}`;
}

function decodeAttachmentContent(attachment) {
  let value = attachment?.content ?? attachment?.data ?? attachment?.contentBase64 ?? '';
  let encoding = String(attachment?.contentEncoding ?? attachment?.content_encoding ?? 'base64').toLowerCase();
  if (typeof value !== 'string') value = Buffer.from(value || '').toString('base64');
  if (value.startsWith('data:')) {
    const match = value.match(/^data:([^;,]+)?;base64,(.*)$/s);
    if (!match) throw new Error('附件 data URL 无效');
    value = match[2]; encoding = 'base64';
  }
  if (encoding === 'utf8' || encoding === 'utf-8' || encoding === 'text') return Buffer.from(value, 'utf8');
  const normalized = String(value).replace(/\s+/g, '');
  if (normalized && (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 === 1)) throw new Error('附件必须是有效的 Base64 内容');
  return Buffer.from(normalized, 'base64');
}

/**
 * Materialize browser-uploaded attachments below the selected workstation
 * directory. The CLI receives paths in its prompt, while the original bytes
 * stay local to the paired computer and never get written by the server.
 */
export function materializeRuntimeAttachments({attachments = [], cwd, actionId = 'action'} = {}) {
  if (!Array.isArray(attachments) || !attachments.length) return [];
  const root = resolveApprovedPath(cwd || process.cwd(), '.');
  const folder = resolveApprovedPath(root, path.join('.ziwei', 'attachments', safeFileName(actionId)));
  const paths = [];
  let total = 0;
  const used = new Set();
  for (let index = 0; index < Math.min(attachments.length, 20); index += 1) {
    const attachment = attachments[index];
    if (!attachment || typeof attachment !== 'object') continue;
    const bytes = decodeAttachmentContent(attachment);
    if (bytes.length > MAX_FILE_BYTES || (total += bytes.length) > MAX_FILE_BYTES) throw new Error('会话附件总大小不能超过 10 MiB');
    let name = attachmentFileName(attachment.name || attachment.filename, index);
    const base = name; let suffix = 1;
    while (used.has(name)) name = `${base}-${suffix++}`;
    used.add(name);
    fs.mkdirSync(folder, {recursive: true});
    if (!isInside(fs.realpathSync.native(root), fs.realpathSync.native(folder))) throw new Error('附件目录解析到已批准根目录之外');
    const target = path.join(folder, name);
    if (fs.existsSync(target)) {
      if (fs.lstatSync(target).isSymbolicLink() || !fs.statSync(target).isFile() || !fs.readFileSync(target).equals(bytes)) throw new Error(`附件目标已存在且内容不同: ${name}`);
    } else fs.writeFileSync(target, bytes, {flag: 'wx', mode: 0o600});
    paths.push({name, path: target, bytes: bytes.length, mimeType: String(attachment.mimeType || attachment.mime_type || 'application/octet-stream')});
  }
  return paths;
}

/**
 * Create a Hermes profile on the paired computer.  Profile contents are
 * deliberately written below the daemon user's Hermes home; the API server
 * only queues this action and never receives a filesystem path to write.
 */
function createHermesProfile({payload = {}, hermesHomePath = null} = {}) {
  const profile = normalizeRuntimeProfile(payload.profile || payload.profileName || payload.profile_name || payload.runtimeProfile || payload.runtime_profile || payload.name);
  if (!profile || profile.toLowerCase() === 'default') throw new Error('不能创建 Hermes default profile');
  const root = hermesHome({baseHome: hermesHomePath});
  const target = hermesProfileHome(profile, {baseHome: root});
  const profilesRoot = path.join(root, 'profiles');
  if (!isInside(profilesRoot, target)) throw new Error('Hermes profile 路径无效');
  const files = {'SOUL.md': profileText(payload.soul ?? payload.soulMd ?? payload.soul_md ?? payload.instructions ?? payload.files?.['SOUL.md'], `# ${profile}\n`)};
  // Keep the initial profile contract small and deterministic. Optional files
  // are restricted to markdown names so a server payload cannot escape the
  // profile directory or replace executable/configuration files.
  if (payload.files && typeof payload.files === 'object' && !Array.isArray(payload.files)) {
    for (const [name, value] of Object.entries(payload.files)) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.md$/i.test(name) || name.toUpperCase() === 'SOUL.MD') continue;
      files[name] = profileText(value);
    }
  }
  if (payload.memory ?? payload.memoryMd ?? payload.memory_md) files['MEMORY.md'] = profileText(payload.memory ?? payload.memoryMd ?? payload.memory_md);
  if (payload.identity ?? payload.identityMd ?? payload.identity_md) files['IDENTITY.md'] = profileText(payload.identity ?? payload.identityMd ?? payload.identity_md);
  const inheritedProviderFiles = inheritedHermesProviderFiles(root, payload);
  const totalBytes = Object.values(files).reduce((sum, value) => sum + Buffer.byteLength(value, 'utf8'), 0);
  if (totalBytes > MAX_FILE_BYTES) throw new Error('Hermes profile 内容超过 10 MiB');
  fs.mkdirSync(profilesRoot, {recursive: true});
  const rootReal = fs.realpathSync.native(root);
  const profilesRootReal = fs.realpathSync.native(profilesRoot);
  if (!isInside(rootReal, profilesRootReal)) throw new Error('Hermes profile 目录解析到受保护目录之外');
  if (fs.existsSync(target)) {
    const targetReal = fs.realpathSync.native(target);
    if (!isInside(profilesRootReal, targetReal)) throw new Error('Hermes profile 目标解析到受保护目录之外');
    if (!fs.statSync(targetReal).isDirectory()) throw new Error('Hermes profile 目标不是目录');
    const same = Object.entries(files).every(([name, value]) => {
      const file = path.join(target, name);
      return fs.existsSync(file) && fs.statSync(file).isFile() && fs.readFileSync(file, 'utf8') === value;
    });
    if (!same) throw new Error(`Hermes profile 已存在且内容不同: ${profile}`);
    for (const item of inheritedProviderFiles) {
      const destination = path.join(target, item.name);
      if (!fs.existsSync(destination)) fs.writeFileSync(destination, item.bytes, {flag: 'wx', mode: 0o600});
    }
    return {profile, path: path.relative(root, target), files: [...Object.keys(files), ...inheritedProviderFiles.map(item => item.name)], duplicate: true};
  }
  const temporary = path.join(profilesRoot, `.${profile}.${process.pid}.${Date.now()}.tmp`);
  fs.mkdirSync(temporary, {recursive: true});
  try {
    for (const [name, value] of Object.entries(files)) fs.writeFileSync(path.join(temporary, name), value, {encoding: 'utf8', mode: 0o600});
    for (const item of inheritedProviderFiles) fs.writeFileSync(path.join(temporary, item.name), item.bytes, {flag: 'wx', mode: 0o600});
    try { fs.renameSync(temporary, target); }
    catch (error) {
      if (fs.existsSync(target)) {
        const same = Object.entries(files).every(([name, value]) => fs.existsSync(path.join(target, name)) && fs.readFileSync(path.join(target, name), 'utf8') === value);
        if (same) return {profile, path: path.relative(root, target), files: [...Object.keys(files), ...inheritedProviderFiles.map(item => item.name)], duplicate: true};
      }
      throw error;
    }
  } finally { try { fs.rmSync(temporary, {recursive: true, force: true}); } catch {} }
  return {profile, path: path.relative(root, target), files: [...Object.keys(files), ...inheritedProviderFiles.map(item => item.name)], inheritedProvider: inheritedProviderFiles.length > 0, duplicate: false};
}

function messagePayload(action) {
  const payload = action.payload || {};
  const content = payload.content ?? payload.message ?? payload.prompt ?? payload.title;
  if (content === undefined || String(content).trim() === '') throw new Error('message.deliver requires content, message, prompt, or title');
  return {
    action_id: action.id,
    type: action.type,
    task_id: action.taskId ?? action.task_id ?? null,
    content: String(content),
    metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {},
    created_at: new Date().toISOString()
  };
}

async function writeMessage(runtimeDir, action) {
  const record = messagePayload(action);
  const inbox = resolveRuntimePath(runtimeDir, 'inbox');
  fs.mkdirSync(inbox, {recursive: true});
  const target = resolveRuntimePath(runtimeDir, `inbox/${safeFileName(action.id)}.json`);
  const bytes = Buffer.from(JSON.stringify(record, null, 2), 'utf8');
  if (bytes.length > MAX_FILE_BYTES) throw new Error('message payload exceeds 10 MiB');
  if (fs.existsSync(target)) {
    const existing = fs.readFileSync(target);
    if (existing.equals(bytes)) return {operation: 'message.deliver', path: path.relative(runtimeDir, target), bytes: bytes.length, duplicate: true};
    throw new Error('message target already contains a different action');
  }
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, bytes, {flag: 'wx'});
  try { fs.renameSync(temporary, target); } catch (error) { try { fs.rmSync(temporary, {force: true}); } catch {} ; throw error; }
  return {operation: 'message.deliver', path: path.relative(runtimeDir, target), bytes: bytes.length, duplicate: false};
}

async function writeFile(runtimeDir, action) {
  const payload = action.payload || {};
  if (!payload.path && !payload.name) throw new Error('file.write requires path');
  const target = resolveRuntimePath(runtimeDir, payload.path ?? payload.name);
  const bytes = decodeContent(payload);
  if (bytes.length > MAX_FILE_BYTES) throw new Error('file.write payload exceeds 10 MiB');
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, bytes, {flag: 'w'});
  return {operation: 'file.write', path: path.relative(runtimeDir, target), bytes: bytes.length};
}

async function readFile(runtimeDir, action) {
  const payload = action.payload || {};
  if (!payload.path && !payload.name) throw new Error('file.read requires path');
  const target = resolveRuntimePath(runtimeDir, payload.path ?? payload.name);
  const bytes = fs.readFileSync(target);
  if (bytes.length > MAX_FILE_BYTES) throw new Error('file.read result exceeds 10 MiB');
  return {operation: 'file.read', path: path.relative(runtimeDir, target), bytes: bytes.length, contentBase64: bytes.toString('base64')};
}

function runCommand({runtimeDir, action, executable, baseArgs = [], allowedExecutables = [], timeoutMs = 60_000}) {
  const payload = action.payload || {};
  const args = [...baseArgs, ...(Array.isArray(payload.args) ? payload.args.map(String) : [])];
  if (args.length > 100) throw new Error('command.execute accepts at most 100 arguments');
  const configured = new Set(allowedExecutables.map(item => String(item)));
  const hasPath = executable.includes('/') || executable.includes('\\') || path.isAbsolute(executable);
  let command = executable;
  if (hasPath) command = resolveRuntimePath(runtimeDir, executable);
  else if (!configured.has(executable)) throw new Error(`executable is not allowlisted: ${executable}`);
  const cwd = resolveRuntimePath(runtimeDir, payload.cwd || payload.workdir || '.');
  const environment = payload.env && typeof payload.env === 'object'
    ? Object.fromEntries(Object.entries(payload.env).map(([key, value]) => [String(key), String(value)]))
    : {};
  if (process.env.PATH) environment.PATH = process.env.PATH;
  if (process.env.SystemRoot) environment.SystemRoot = process.env.SystemRoot;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {cwd, env: environment, shell: false, windowsHide: true});
    let stdout = ''; let stderr = ''; let total = 0; let timedOut = false;
    const append = (target, chunk) => {
      total += chunk.length;
      if (total <= MAX_OUTPUT_BYTES) return target + chunk.toString('utf8');
      return target;
    };
    child.stdout?.on('data', chunk => { stdout = append(stdout, chunk); });
    child.stderr?.on('data', chunk => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, Math.min(10 * 60 * 1000, Math.max(100, Number(payload.timeoutMs || timeoutMs))));
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      const result = {operation: 'command.execute', executable, args, code, signal, stdout, stderr, truncated: total > MAX_OUTPUT_BYTES};
      if (timedOut) return resolve({status: 'failed', code: 'command_timeout', error: 'command timed out', result});
      if (code !== 0) return resolve({status: 'failed', code: 'command_failed', error: `command exited with code ${code ?? 'unknown'}`, result});
      return resolve({status: 'succeeded', result});
    });
  });
}

/**
 * Build the only executor used by ziwei_user. Actions are explicit and
 * bounded: message delivery, controlled file I/O, and opt-in argv execution.
 * Unknown/unsupported actions fail loudly so the cloud never sees a fake
 * success merely because an action was accepted by the daemon.
 */
export function createLocalActionExecutor({runtimeDir, allowedExecutables = [], executorCommand = null, executorArgs = [], defaultRuntime = null, hermesHomePath = null} = {}) {
  if (!runtimeDir) throw new TypeError('runtimeDir is required');
  fs.mkdirSync(runtimeDir, {recursive: true});
  return async (action, context = {}) => {
    const type = String(action?.type || '');
    if (type === 'directory.inspect' || type === 'device.directory.inspect') {
      const payload = action.payload || {};
      return {
        status: 'succeeded',
        result: inspectLocalDirectory({
          directoryPath: payload.path || payload.directory || payload.workingDirectory || payload.working_directory || '',
          basePath: payload.workdir || process.cwd(),
          createIfMissing: payload.createIfMissing === true || payload.create_if_missing === true,
          includeRoots: payload.includeRoots !== false && payload.include_roots !== false,
          includeChildren: payload.includeChildren !== false && payload.include_children !== false,
          maxEntries: payload.maxEntries || payload.max_entries
        })
      };
    }
    if (type === 'hermes.profile.create' || type === 'profile.create') {
      return {status: 'succeeded', result: createHermesProfile({payload: action.payload || {}, hermesHomePath})};
    }
    // Native model calls intentionally use the installed local CLI.  This is
    // the one action family with full local permissions; the ordinary file and
    // command actions below remain bounded to the bridge runtime directory.
    if (['agent.execute', 'conversation.execute', 'runtime.execute', 'automation.execute'].includes(type)
      || (type === 'task.execute' && (action.payload?.runtime || action.payload?.agent || action.payload?.modelId || action.payload?.prompt))) {
      const payload = action.payload || {};
      const approvedWorkdir = payload.workdir || payload.workingDirectory || payload.working_directory || process.cwd();
      const requestedCwd = payload.cwd || payload.workingDirectory || payload.working_directory || payload.workdir || '.';
      const safeCwd = resolveApprovedPath(approvedWorkdir, requestedCwd);
      const runtime = payload.runtime || payload.agent || payload.runtimeName || defaultRuntime
        || Object.values(discoverInstalledRuntimes().runtimes).find(item => item.status === 'available')?.runtime;
      const prompt = payload.prompt ?? payload.message ?? payload.content ?? payload.instructions;
      const attachmentPaths = materializeRuntimeAttachments({attachments: payload.attachments, cwd: safeCwd, actionId: action.id});
      const promptWithAttachments = attachmentPaths.length
        ? `${String(prompt || '').trim()}\n\n[本机附件]\n${attachmentPaths.map(item => `- ${item.name}: ${item.path}`).join('\n')}`
        : prompt;
      return executeRuntime({
        runtime,
        model: payload.model || payload.modelId || payload.model_id || null,
        profile: payload.profile || payload.runtimeProfile || payload.runtime_profile || payload.hermesProfile || payload.hermes_profile || null,
        prompt: promptWithAttachments,
        attachments: attachmentPaths,
        cwd: safeCwd,
        env: payload.env,
        signal: context.signal,
        onOutput: context.onOutput,
        onProgress: context.onProgress,
        onStage: context.onStage,
      });
    }
    if (type === 'message.deliver' || type === 'local.message' || type === 'task.execute') {
      return {status: 'succeeded', result: await writeMessage(runtimeDir, action)};
    }
    if (type === 'file.write') return {status: 'succeeded', result: await writeFile(runtimeDir, action)};
    if (type === 'file.read') return {status: 'succeeded', result: await readFile(runtimeDir, action)};
    if (type === 'command.execute') {
      const executable = String(action.payload?.executable ?? action.payload?.command ?? '');
      if (!executable) throw new Error('command.execute requires executable');
      return runCommand({runtimeDir, action, executable, allowedExecutables});
    }
    if (type === 'automation.execute') {
      if (!executorCommand) throw new Error('automation executor is not configured for ziwei_user');
      return runCommand({runtimeDir, action, executable: String(executorCommand), baseArgs: executorArgs, allowedExecutables});
    }
    throw new Error(`unsupported A2A action type: ${type || '(empty)'}`);
  };
}

