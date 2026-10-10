import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const LOCATOR_TIMEOUT_MS = 1500;
const VERSION_TIMEOUT_MS = 3000;
const MAX_PROBE_BYTES = 64 * 1024;
// Execution PATH is local process state. It is deliberately never enumerable in
// runtime metadata, heartbeat JSON, or diagnostics sent to the platform.
const childPaths = new WeakMap();
const SAFE_ERRORS = new Set(['ENOENT', 'EACCES', 'EPERM', 'ETIMEDOUT', 'EINVAL', 'E2BIG', 'ENOBUFS', 'EIO', 'EPIPE']);
const REASONS = {
  cli_not_found: '未发现 CLI；请检查是否安装以及本机 PATH。',
  cli_lookup_failed: 'CLI 路径检测失败；请检查本机权限和 PATH。',
  cli_version_timeout: '已找到 CLI，但版本检测超时。',
  cli_dependency_missing: '已找到 CLI，但启动程序或依赖解释器不可用。',
  cli_version_failed: '已找到 CLI，但版本检测退出失败。',
  cli_version_unrecognized: '已找到 CLI，但未返回可识别的版本。'
};

function pathValue(env) {
  return Object.entries(env).find(([key, value]) => /^path$/i.test(key) && String(value || '').trim())?.[1] || '';
}

function readNpmUserConfig(file) {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() && stat.size <= MAX_PROBE_BYTES ? fs.readFileSync(file, 'utf8') : '';
  } catch { return ''; }
}

export function createCliDiscoveryContext({ platform = process.platform, arch = process.arch, home = os.homedir(), env = process.env, io = {}, now = Date.now, spawnSpec = (binary, args) => ({ command: binary, args }), extraCandidates = () => [], metadataVersion = () => null } = {}) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const delimiter = platform === 'win32' ? ';' : ':';
  const inheritedPath = String(pathValue(env));
  const dirs = [];
  const seen = new Set();
  const add = (value, source) => {
    const dir = String(value || '').trim().replace(/^"(.*)"$/, '$1');
    if (!paths.isAbsolute(dir) || dir.length > 4096 || dirs.length >= 256) return;
    const key = platform === 'win32' ? dir.toLowerCase() : dir;
    if (seen.has(key)) return;
    seen.add(key); dirs.push({ dir, source });
  };
  for (const dir of inheritedPath.split(delimiter)) add(dir, 'path');
  if (platform === 'win32') {
    // npm Windows global shims live directly in the prefix, not prefix/bin.
    // These are existing local installation locations, not login-shell probes.
    add(env.npm_config_prefix || env.NPM_CONFIG_PREFIX, 'npm_prefix');
    // Parse one path setting locally; never expose registry/auth lines or run
    // npm config (which can print credentials and unrelated configuration).
    try {
      const userConfig = paths.isAbsolute(String(env.NPM_CONFIG_USERCONFIG || env.npm_config_userconfig || ''))
        ? env.NPM_CONFIG_USERCONFIG || env.npm_config_userconfig : paths.join(home, '.npmrc');
      const content = String((io.readNpmPrefix || readNpmUserConfig)(userConfig) || '');
      const configured = content.match(/^\s*prefix\s*=\s*([^\r\n]+)\s*$/im)?.[1]?.trim().replace(/^(["'])(.*)\1$/, '$2');
      add(configured, 'npm_userconfig');
    } catch {}
    add(paths.join(env.APPDATA || paths.join(home, 'AppData', 'Roaming'), 'npm'), 'npm_user');
    add(paths.join(home, '.local', 'bin'), 'user_bin');
  }
  const probeEnv = { ...env };
  if (platform === 'win32') {
    for (const key of Object.keys(probeEnv)) if (/^path$/i.test(key)) delete probeEnv[key];
    // Preserve the original PATH (including native relative entries) before
    // appending fallback installation directories for shim dependencies.
    probeEnv.PATH = [inheritedPath, ...dirs.filter(item => item.source !== 'path').map(item => item.dir)].filter(Boolean).join(delimiter);
  }
  return {
    platform, arch, paths, dirs, probeEnv, now, spawnSpec, extraCandidates, metadataVersion,
    exists: io.exists || (file => { try { return fs.statSync(file).isFile(); } catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false; throw error; } }),
    run: io.run || spawnSync
  };
}

export function runtimeDiscoveryEnvironment(item) {
  const value = childPaths.get(item);
  return value ? { ...value } : {};
}

export function carryRuntimeDiscoveryEnvironment(source, target) {
  if (childPaths.has(source)) childPaths.set(target, childPaths.get(source));
  return target;
}

function runProbe(context, command, args, timeout) {
  try {
    return context.run(command, args, { encoding: 'utf8', timeout, maxBuffer: MAX_PROBE_BYTES, windowsHide: true, shell: false, env: context.probeEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) { return { status: null, error }; }
}

function versionToken(value, runtime = null) {
  // Only a public version identifier can leave this boundary. Raw stdout and
  // stderr may contain local configuration, so neither is retained in results.
  for (const line of String(value || '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').split(/\r?\n/)) {
    const text = line.trim();
    const lower = text.toLowerCase();
    if (!/^v?\d+\.\d+\.\d+\b/i.test(text) && !/^cli\b/i.test(text) && !(runtime && lower.startsWith(String(runtime).toLowerCase()))) continue;
    const match = text.match(/\bv?(\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?)\b/);
    if (match) return match[1];
  }
  return null;
}

export function discoverRuntimeCli(definition, context = createCliDiscoveryContext()) {
  const { runtime, aliases, versionArgs = ['--version'] } = definition;
  const name = aliases?.[0] || String(runtime || '').toLowerCase();
  const detection = { state: 'not_found', installed: false, reasonCode: 'cli_not_found', reason: REASONS.cli_not_found, source: null, versionSource: null, checkedAt: new Date(context.now()).toISOString(), platform: context.platform, arch: context.arch };
  const candidates = [];
  const seen = new Set();
  let lookupFailed = false;
  const add = (file, source) => {
    const value = String(file || '').trim();
    if (!context.paths.isAbsolute(value) || value.length > 4096 || candidates.length >= 512) return;
    const key = context.platform === 'win32' ? value.toLowerCase() : value;
    if (seen.has(key)) return;
    try {
      if (!context.exists(value)) return;
      seen.add(key); candidates.push({ binary: value, source });
    } catch { lookupFailed = true; }
  };
  try { for (const file of context.extraCandidates(name)) add(file, 'windows_installation'); } catch { lookupFailed = true; }
  const locator = runProbe(context, context.platform === 'win32' ? 'where.exe' : 'which', [name], LOCATOR_TIMEOUT_MS);
  if (locator.status === 0) {
    for (const file of String(locator.stdout || '').split(/\r?\n/)) {
      add(file, 'path');
      if (context.platform === 'win32' && !/\.ps1$/i.test(file)) add(`${file.trim()}.ps1`, 'path');
    }
  } else if (locator.error || (locator.status !== 1 && locator.status !== 0)) lookupFailed = true;
  if (context.platform === 'win32') {
    for (const { dir, source } of context.dirs) {
      for (const extension of ['.exe', '.cmd', '.ps1', '.bat', '']) add(context.paths.join(dir, `${name}${extension}`), source);
    }
  }
  // Retain the existing Windows preference for real executables over shims.
  const chosen = context.platform === 'win32'
    ? candidates.find(item => /\.exe$/i.test(item.binary)) || candidates.find(item => /\.(ps1|cmd|bat)$/i.test(item.binary)) || candidates[0]
    : candidates[0];
  if (!chosen) {
    if (lookupFailed) Object.assign(detection, { state: 'failed', installed: null, reasonCode: 'cli_lookup_failed', reason: REASONS.cli_lookup_failed });
    return { binary: null, version: null, status: 'unavailable', detection };
  }
  Object.assign(detection, { installed: true, source: chosen.source });
  let probe;
  try {
    const spec = context.spawnSpec(chosen.binary, versionArgs);
    probe = runProbe(context, spec.command, spec.args, VERSION_TIMEOUT_MS);
  } catch (error) { probe = { status: null, error }; }
  const actualVersion = probe.status === 0 ? versionToken(probe.stdout, runtime) || versionToken(probe.stderr, runtime) : null;
  if (actualVersion) {
    Object.assign(detection, { state: 'available', reasonCode: null, reason: null, versionSource: 'cli' });
    const result = { binary: chosen.binary, version: actualVersion, status: 'available', detection };
    if (context.platform === 'win32') childPaths.set(result, { PATH: context.probeEnv.PATH });
    return result;
  }
  const errorCode = SAFE_ERRORS.has(probe.error?.code) ? probe.error.code : null;
  const reasonCode = errorCode === 'ETIMEDOUT' ? 'cli_version_timeout' : errorCode === 'ENOENT' ? 'cli_dependency_missing' : probe.status === 0 ? 'cli_version_unrecognized' : 'cli_version_failed';
  Object.assign(detection, { state: 'failed', reasonCode, reason: REASONS[reasonCode], ...(errorCode ? { errorCode } : {}), ...(Number.isInteger(probe.status) ? { exitCode: probe.status } : {}) });
  let hint = null;
  try { hint = versionToken(context.metadataVersion(chosen.binary)); } catch {}
  if (hint) detection.versionSource = 'installed_metadata';
  return { binary: chosen.binary, version: hint, status: 'unavailable', detection };
}
