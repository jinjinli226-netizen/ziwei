import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { redactSecrets } from './redaction.mjs';

/**
 * Native local runtime adapters used by ziwei_user.
 *
 * The bridge deliberately discovers the executables that are installed on the
 * current computer.  It never ships a pretend model catalog and never sends
 * credentials to the server.  An adapter only receives a prompt and a model
 * id; authentication remains in the user's existing CLI configuration.
 */

const WINDOWS_SHELL = process.platform === 'win32' ? 'powershell.exe' : null;
const PS_ARGS = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'];
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const VERSION_TIMEOUT_MS = 3000;
const DISCOVERY_TTL_MS = 30_000;
const WINDOWS_INTERNET_SETTINGS = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

const DEFINITIONS = {
  Claude: {
    aliases: ['claude', 'Claude'],
    versionArgs: ['--version'],
    invoke: ({ prompt, model }) => ({
      args: ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions', ...(model ? ['--model', model] : [])],
      stdin: null,
      format: 'json-lines',
    }),
  },
  Codex: {
    aliases: ['codex', 'Codex'],
    versionArgs: ['--version'],
    invoke: ({ prompt, model }) => ({
      args: ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '--config', 'model_reasoning_summary="auto"', ...(model ? ['--model', model] : []), '-'],
      stdin: prompt,
      format: 'json-lines',
    }),
  },
  Gemini: {
    aliases: ['gemini', 'Gemini'],
    versionArgs: ['--version'],
    invoke: ({ prompt, model }) => ({
      args: ['-p', prompt, '--output-format', 'stream-json', '--approval-mode', 'yolo', '--sandbox=false', '--skip-trust', ...(model ? ['--model', model] : [])],
      stdin: null,
      format: 'json-lines',
    }),
  },
  Hermes: {
    aliases: ['hermes', 'Hermes'],
    versionArgs: ['--version'],
    invoke: ({ prompt, model }) => ({
      args: ['-z', prompt, '--yolo', ...(model ? ['--model', model] : [])],
      stdin: null,
      format: 'text',
    }),
  },
};

let cached = { expiresAt: 0, value: null };

/**
 * Turn a Windows Internet Settings ProxyServer value into a URL that CLI
 * clients understand. ProxyServer may be either `host:port` or a semicolon
 * separated protocol map such as `http=host:port;https=host:port`.
 */
export function normalizeProxyUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || /^(?:direct|none)$/i.test(raw)) return null;
  const entries = raw.split(';').map(item => item.trim()).filter(Boolean);
  const preferred = entries.find(item => /^https?=/i.test(item)) || entries.find(item => /^socks(?:4|5)?=/i.test(item)) || entries[0];
  const candidate = String(preferred || '').replace(/^[a-z0-9_-]+=/i, '').trim();
  if (!candidate) return null;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(candidate)) return candidate;
  if (/^[^\s/:]+:\d+$/.test(candidate) || /^\[[^\]]+\]:\d+$/.test(candidate)) return `http://${candidate}`;
  return null;
}

function windowsInternetProxyUrl() {
  if (process.platform !== 'win32') return null;
  try {
    const enabled = execFileSync('reg', ['query', WINDOWS_INTERNET_SETTINGS, '/v', 'ProxyEnable'], {
      encoding: 'utf8', timeout: 1500, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
    });
    if (!/ProxyEnable\s+REG_DWORD\s+0x0*1\b/i.test(enabled) && !/ProxyEnable\s+REG_DWORD\s+1\b/i.test(enabled)) return null;
    const configured = execFileSync('reg', ['query', WINDOWS_INTERNET_SETTINGS, '/v', 'ProxyServer'], {
      encoding: 'utf8', timeout: 1500, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
    });
    const match = configured.match(/ProxyServer\s+REG_SZ\s+(.+)$/im);
    return normalizeProxyUrl(match?.[1]);
  } catch {
    return null;
  }
}

export function proxyUrlForChild(env = {}) {
  const configured = [
    env.HTTPS_PROXY, env.https_proxy, env.HTTP_PROXY, env.http_proxy,
    env.ALL_PROXY, env.all_proxy, process.env.HTTPS_PROXY, process.env.https_proxy,
    process.env.HTTP_PROXY, process.env.http_proxy, process.env.ALL_PROXY, process.env.all_proxy
  ].map(normalizeProxyUrl).find(Boolean);
  return configured || windowsInternetProxyUrl();
}

function commandCandidates(name) {
  // `where.exe` returns the .ps1 path for Codex/Gemini on Windows only when the
  // PowerShell shim is on PATH.  Looking for a same-name .ps1 beside a normal
  // result covers both that case and older Windows installations.
  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(locator, [name], { encoding: 'utf8', timeout: 1500, windowsHide: true });
  const paths = result.status === 0
    ? String(result.stdout || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean)
    : [];
  const expanded = [];
  for (const item of paths) {
    expanded.push(item);
    if (process.platform === 'win32' && !/\.ps1$/i.test(item) && fs.existsSync(`${item}.ps1`)) expanded.push(`${item}.ps1`);
  }
  return [...new Set(expanded)];
}

function resolveExecutable(name) {
  const candidates = commandCandidates(name);
  // Prefer a real executable over a PowerShell shim when both exist.  The
  // shims are still valid and are retained as a fallback.
  const existing = candidates.filter(item => fs.existsSync(item));
  return existing.find(item => /\.exe$/i.test(item))
    || existing.find(item => /\.(ps1|cmd|bat)$/i.test(item))
    || existing[0]
    || null;
}

function spawnSpec(binary, args) {
  if (process.platform === 'win32' && /\.ps1$/i.test(binary)) return { command: WINDOWS_SHELL, args: [...PS_ARGS, binary, ...args] };
  return { command: binary, args };
}

function discoveredModels(runtime) {
  const home = os.homedir();
  const files = {
    Claude: [path.join(home, '.claude', 'settings.json'), path.join(home, '.claude', 'settings.local.json')],
    Codex: [path.join(home, '.codex', 'config.toml'), path.join(home, '.codex', 'models_cache.json')],
    Gemini: [path.join(home, '.gemini', 'settings.json')],
    Hermes: [path.join(home, '.hermes', 'config.json'), path.join(home, '.hermes', 'settings.json')]
  }[runtime] || [];
  const models = [];
  const add = value => {
    if (Array.isArray(value)) value.forEach(add);
    else if (typeof value === 'string') { const id=value.trim(); if (id) models.push({id,label:id,source:'ziwei_user'}); }
    else if (value && typeof value === 'object') {
      const id=String(value.id || value.slug || value.model || '').trim();
      if (id) models.push({id,label:String(value.label || value.display_name || id),source:'ziwei_user'});
    }
  };
  for (const file of files) {
    try {
      if (!fs.existsSync(file) || fs.statSync(file).size > 2 * 1024 * 1024) continue;
      const raw=fs.readFileSync(file,'utf8');
      if (/\.toml$/i.test(file)) { const match=raw.match(/^\s*model\s*=\s*["']([^"']+)["']/mi); if (match) add(match[1]); continue; }
      const json=JSON.parse(raw);
      for (const key of ['model','model_id','modelId','defaultModel','default_model','models']) add(json[key]);
      if (/models_cache\.json$/i.test(file) && Array.isArray(json.models)) json.models.slice(0,100).forEach(add);
    } catch {}
  }
  const seen=new Set();
  return models.filter(item => !seen.has(item.id) && seen.add(item.id)).slice(0,100);
}
function firstLine(value) {
  return String(value || '').split(/\r?\n/).map(item => item.trim()).find(Boolean) || null;
}

function versionFor(binary, definition) {
  if (!binary) return { version: null, binary: null, status: 'unavailable' };
  const spec = spawnSpec(binary, definition.versionArgs);
  try {
    const output = execFileSync(spec.command, spec.args, { encoding: 'utf8', timeout: VERSION_TIMEOUT_MS, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    return { version: firstLine(output), binary, status: firstLine(output) ? 'available' : 'unknown' };
  } catch (error) {
    const metadataVersion = metadataVersionFor(binary);
    if (metadataVersion) return { version: metadataVersion, binary, status: 'available', source: 'installed-metadata' };
    return { version: null, binary, status: 'unavailable', error: error.code || error.message };
  }
}

function metadataVersionFor(binary) {
  if (!binary) return null;
  const normalized = String(binary).toLowerCase();
  try {
    if (normalized.includes('gemini')) {
      const packagePath = path.join(path.dirname(binary), 'node_modules', '@google', 'gemini-cli', 'package.json');
      const packagePathAlt = path.join(path.dirname(binary), 'node_modules', '@google', 'gemini-cli', 'package.json');
      for (const candidate of [packagePath, packagePathAlt]) if (fs.existsSync(candidate)) return JSON.parse(fs.readFileSync(candidate, 'utf8')).version || null;
      // npm global shims can sit one directory above node_modules.
      const root = path.dirname(binary);
      const glob = path.join(root, 'node_modules', '@google', 'gemini-cli', 'package.json');
      if (fs.existsSync(glob)) return JSON.parse(fs.readFileSync(glob, 'utf8')).version || null;
    }
    if (normalized.includes('hermes')) {
      const home = process.env.HERMES_HOME || path.join(os.homedir(), 'AppData', 'Local', 'hermes');
      const updateFile = path.join(home, '.update_check');
      if (fs.existsSync(updateFile)) return JSON.parse(fs.readFileSync(updateFile, 'utf8')).ver || null;
    }
  } catch {}
  return null;
}

export function discoverInstalledRuntimes({ force = false } = {}) {
  if (!force && cached.value && cached.expiresAt > Date.now()) return cached.value;
  const runtimes = {};
  for (const [runtime, definition] of Object.entries(DEFINITIONS)) {
    const binary = resolveExecutable(definition.aliases[0]);
    const found = versionFor(binary, definition);
    runtimes[runtime] = { runtime, ...found, models: discoveredModels(runtime), modelSource: found.version ? 'cli-installed' : 'manual' };
  }
  const value = {
    bridge: { name: 'ziwei_user', version: process.env.ZIWEI_USER_VERSION || null, host: os.hostname() },
    runtimes,
    discoveredAt: new Date().toISOString(),
  };
  cached = { value, expiresAt: Date.now() + DISCOVERY_TTL_MS };
  return value;
}

export function resetRuntimeDiscovery() { cached = { expiresAt: 0, value: null }; }

function normalizeRuntime(value) {
  const needle = String(value || '').trim().toLowerCase();
  return Object.keys(DEFINITIONS).find(runtime => runtime.toLowerCase() === needle || DEFINITIONS[runtime].aliases.some(alias => alias.toLowerCase() === needle)) || null;
}

function appendOutput(state, chunk, onOutput) {
  const text = String(chunk || '');
  if (!text) return;
  state.bytes += Buffer.byteLength(text);
  if (state.bytes <= MAX_OUTPUT_BYTES) state.output += text;
  if (state.bytes > MAX_OUTPUT_BYTES) state.truncated = true;
  if (typeof onOutput === 'function') onOutput(text);
}

function responseText(value) {
  const candidates = [
    value?.text,
    value?.content,
    value?.delta,
    value?.message?.content,
    value?.response,
    value?.result,
    value?.item?.text,
    value?.item?.content,
    value?.item?.message?.content,
    value?.item?.response,
    value?.item?.result
  ];
  return candidates.find(item => typeof item === 'string' && item.trim()) || null;
}

function runtimeStage(value) {
  const type = String(value?.item?.type || value?.type || '').toLowerCase();
  if (/reasoning|thinking/.test(type)) return { stage: 'reasoning', message: '思考摘要' };
  if (/command|shell|terminal|exec/.test(type)) return { stage: 'command', message: '运行命令' };
  if (/mcp|tool|function|browser|search|patch/.test(type)) return { stage: 'tool', message: '调用工具' };
  if (/compact|context/.test(type)) return { stage: 'context', message: '处理上下文' };
  return null;
}

function summaryText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(summaryText).filter(Boolean).join('\n');
  if (!value || typeof value !== 'object') return '';
  return [value.text, value.content, value.summary].map(summaryText).filter(Boolean).join('\n');
}

function reasoningSummary(value) {
  const item = value?.item && typeof value.item === 'object' ? value.item : value;
  const type = String(item?.type || value?.type || '').toLowerCase();
  if (!/reasoning|thinking/.test(type)) return null;
  const raw = summaryText(item?.summary) || summaryText(item?.text) || summaryText(item?.content) || summaryText(value?.summary);
  const cleaned = redactSecrets(raw).replace(/<!--\s*-->/g, '').trim().slice(0, 4000);
  return cleaned || null;
}

function commandName(value) {
  const source = String(value || '').trim();
  if (!source) return null;
  const tokens = [...source.matchAll(/"([^"\r\n]+)"|'([^'\r\n]+)'|(\S+)/g)].map(match => match[1] || match[2] || match[3]);
  if (!tokens.length) return null;
  const first = String(tokens[0]);
  if (/^(?:powershell|pwsh)(?:\.exe)?$/i.test(path.basename(first))) {
    const fileIndex = tokens.findIndex(token => /^-file$/i.test(token));
    if (fileIndex >= 0 && tokens[fileIndex + 1]) return path.basename(tokens[fileIndex + 1]).replace(/\.(?:cmd|bat|exe|ps1)$/i, '');
  }
  return path.basename(first).replace(/\.(?:cmd|bat|exe|ps1)$/i, '');
}

function runtimeStageDetail(value, stage) {
  const item = value?.item && typeof value.item === 'object' ? value.item : value;
  const type = String(value?.type || '').toLowerCase();
  const phase = /complete|finished|done|result/.test(type) ? ' · 已完成' : /error|fail/.test(type) ? ' · 失败' : ' · 执行中';
  if (stage?.stage === 'reasoning') return '公开推理摘要';
  if (stage?.stage === 'command') {
    const name = commandName(item?.command || item?.command_line || item?.executable || item?.cmd);
    return `${name ? `命令：${redactSecrets(name)}` : '本机命令'}${phase}`;
  }
  if (stage?.stage === 'tool') {
    const name = item?.name || item?.tool || item?.tool_name || item?.function?.name || item?.function_name;
    return `${name ? `工具：${redactSecrets(name)}` : '本机工具'}${phase}`;
  }
  if (stage?.stage === 'context') return '上下文窗口整理';
  return 'CLI 输出';
}

export function parseRuntimeStreamLine(line, state, onOutput = () => {}, onStage = () => {}) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return;
  try {
    const value = JSON.parse(trimmed);
    const stage = runtimeStage(value);
    if (stage) {
      const summary = reasoningSummary(value);
      onStage({...stage, detail: runtimeStageDetail(value, stage), ...(summary ? { summary } : {})});
    }
    const text = responseText(value);
    if (typeof text === 'string' && stage?.stage !== 'reasoning') {
      appendOutput(state, text, onOutput);
      const itemType = String(value?.item?.type || value?.type || '').toLowerCase();
      if (itemType === 'agent_message' || itemType === 'message' || value?.item?.role === 'assistant') {
        state.response = `${state.response || ''}${state.response ? '\n' : ''}${text}`;
      }
    }
    else if (value?.type === 'error' || value?.error) appendOutput(state, `[error] ${value.error || value.message || 'runtime error'}\n`, onOutput);
  } catch {
    appendOutput(state, `${line}\n`, onOutput);
  }
}

/** Execute an installed CLI using an explicit argv, with full local approval. */
export function executeRuntime({ runtime, prompt, model = null, cwd = process.cwd(), env = {}, signal, onOutput, onProgress, onStage } = {}) {
  const resolvedRuntime = normalizeRuntime(runtime);
  if (!resolvedRuntime) return Promise.reject(new Error(`未知本机运行时: ${runtime || '(empty)'}`));
  const definition = DEFINITIONS[resolvedRuntime];
  const discovered = discoverInstalledRuntimes().runtimes[resolvedRuntime];
  if (!discovered?.binary) return Promise.reject(new Error(`${resolvedRuntime} CLI 未安装或不在 PATH 中`));
  const content = String(prompt ?? '').trim();
  if (!content) return Promise.reject(new Error('agent.execute 需要非空 prompt'));
  const invocation = definition.invoke({ prompt: content, model: model ? String(model) : null });
  const spec = spawnSpec(discovered.binary, invocation.args);
  const childEnv = { ...process.env, ...env };
  delete childEnv.ZIWEI_CONFIG;
  // The desktop user session may have a proxy configured in Windows Internet
  // Settings while the daemon process has no proxy variables in its service
  // environment. Propagate that proxy to each local CLI child, preserving any
  // explicit per-process proxy the caller supplied.
  const proxy = proxyUrlForChild(env);
  if (proxy) {
    for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
      if (!String(childEnv[key] || '').trim()) childEnv[key] = proxy;
    }
  }
  const state = { output: '', response: '', bytes: 0, truncated: false, lineBuffer: '' };
  const consume = chunk => {
    if (invocation.format !== 'json-lines') { appendOutput(state, chunk, onOutput); return; }
    state.lineBuffer += String(chunk || '');
    const lines = state.lineBuffer.split(/\r?\n/);
    state.lineBuffer = lines.pop() || '';
    for (const line of lines) parseRuntimeStreamLine(line, state, onOutput, onStage);
  };
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, { cwd: path.resolve(String(cwd || process.cwd())), env: childEnv, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let settled = false;
    const finish = (result, error = null) => {
      if (settled) return;
      settled = true;
      if (error) reject(error); else resolve(result);
    };
    const abort = () => { try { child.kill('SIGTERM'); } catch {} };
    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }
    child.stdout?.on('data', chunk => {
      consume(chunk);
      onProgress?.({ runtime: resolvedRuntime, bytes: state.bytes, truncated: state.truncated });
    });
    child.stderr?.on('data', chunk => {
      // stderr contains diagnostics and is deliberately streamed to the same
      // redacted event channel without writing it to the daemon log.
      consume(chunk);
    });
    child.once('error', error => finish(null, error));
    child.once('close', (code, childSignal) => {
      if (state.lineBuffer) parseRuntimeStreamLine(state.lineBuffer, state, onOutput, onStage);
      if (signal?.aborted) return finish({ status: 'failed', code: 'cancelled', error: 'runtime execution cancelled', result: { runtime: resolvedRuntime, code, signal: childSignal, output: state.output, truncated: state.truncated } });
      const result = { runtime: resolvedRuntime, model: model || null, binary: discovered.binary, code, signal: childSignal, output: state.response.trim() || state.output, diagnostics: state.response.trim() ? state.output : null, truncated: state.truncated };
      if (code !== 0) return finish({ status: 'failed', code: 'runtime_failed', error: `${resolvedRuntime} CLI exited with code ${code ?? 'unknown'}`, result });
      finish({ status: 'succeeded', result });
    });
    if (invocation.stdin !== null && invocation.stdin !== undefined) child.stdin.end(String(invocation.stdin));
    else child.stdin.end();
  });
}

export function runtimeDefinitions() { return Object.keys(DEFINITIONS).map(runtime => ({ runtime, flags: ['full_local_permission'] })); }

export function runtimeInvocation(runtime, { prompt, model = null } = {}) {
  const resolvedRuntime = normalizeRuntime(runtime);
  if (!resolvedRuntime) throw new Error(`未知本机运行时: ${runtime || '(empty)'}`);
  return DEFINITIONS[resolvedRuntime].invoke({ prompt: String(prompt ?? ''), model: model ? String(model) : null });
}


