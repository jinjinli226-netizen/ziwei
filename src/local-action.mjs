import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;

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
export function createLocalActionExecutor({runtimeDir, allowedExecutables = [], executorCommand = null, executorArgs = []} = {}) {
  if (!runtimeDir) throw new TypeError('runtimeDir is required');
  fs.mkdirSync(runtimeDir, {recursive: true});
  return async action => {
    const type = String(action?.type || '');
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

