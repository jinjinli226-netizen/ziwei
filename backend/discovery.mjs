import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const BRIDGE_VERSION = process.env.ZIWEI_USER_VERSION || JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const CLI_BINARIES = { Claude: 'claude', Codex: 'codex', Gemini: 'gemini', Hermes: 'hermes' };
let cache = { expiresAt: 0, value: null };

function safeJson(file) {
  try {
    if (!file || !fs.existsSync(file) || fs.statSync(file).size > 2 * 1024 * 1024) return null;
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch { return null; }
}

function uniqueModels(items, source = 'local-config') {
  const seen = new Set();
  return items.flatMap(item => {
    const id = String(item?.id || item?.model || item || '').trim();
    if (!id || id.length > 180 || seen.has(id)) return [];
    seen.add(id);
    return [{ id, label: String(item?.label || id), source }];
  }).slice(0, 100);
}

function configModels(runtime) {
  const home = os.homedir();
  const rootConfig = safeJson(path.join(ROOT, 'data', 'models.json'));
  const env = (() => {
    try { const parsed = JSON.parse(String(process.env.ZIWEI_MODELS_JSON || '')); return parsed && typeof parsed === 'object' ? parsed : null; } catch { return null; }
  })();
  const candidates = [];
  const appendValue = value => {
    if (Array.isArray(value)) candidates.push(...value);
    else if (typeof value === 'string') candidates.push(value);
    else if (value && typeof value === 'object') candidates.push(...Object.entries(value).map(([id, label]) => ({ id, label: typeof label === 'string' ? label : id })));
  };
  appendValue(rootConfig?.[runtime] || rootConfig?.models);
  appendValue(env?.[runtime] || env?.models);
  const files = {
    Claude: [path.join(home, '.claude', 'settings.json'), path.join(home, '.claude', 'settings.local.json')],
    Codex: [path.join(home, '.codex', 'config.toml'), path.join(home, '.codex', 'models_cache.json')],
    Gemini: [path.join(home, '.gemini', 'settings.json')],
    Hermes: [path.join(home, '.hermes', 'config.json'), path.join(home, '.hermes', 'settings.json')]
  }[runtime] || [];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    if (/\.toml$/i.test(file)) {
      const text = fs.readFileSync(file, 'utf8');
      const match = text.match(/^\s*model\s*=\s*["']([^"']+)["']/mi);
      if (match) candidates.push(match[1]);
      continue;
    }
    const json = safeJson(file);
    if (!json) continue;
    for (const key of ['model', 'model_id', 'modelId', 'defaultModel', 'default_model']) appendValue(json[key]);
    if (/models_cache\.json$/i.test(file)) {
      // Codex exposes a signed local cache whose top-level `models` records
      // have stable slug/display_name fields. Do not recursively harvest
      // arbitrary config labels such as priority or service tier names.
      for (const model of Array.isArray(json.models) ? json.models.slice(0, 100) : []) {
        if (model && typeof model.slug === 'string') candidates.push({ id: model.slug, label: model.display_name || model.slug });
      }
    }
  }
  return uniqueModels(candidates);
}

function resolveBinary(binary) {
  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(locator, [binary], { encoding: 'utf8', timeout: 1200, windowsHide: true });
  if (result.status !== 0) return null;
  const candidates = String(result.stdout || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean);
  const first = candidates[0];
  if (first && process.platform === 'win32' && fs.existsSync(`${first}.ps1`)) return `${first}.ps1`;
  return first || null;
}

function readVersion(binaryPath) {
  if (!binaryPath) return { version: null, binary: null, status: 'unavailable' };
  try {
    const isPowerShellScript = /\.ps1$/i.test(binaryPath);
    const command = isPowerShellScript ? 'powershell.exe' : binaryPath;
    const args = isPowerShellScript
      ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', binaryPath, '--version']
      : ['--version'];
    const output = execFileSync(command, args, { encoding: 'utf8', timeout: 2500, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const lines = String(output).split(/\r?\n/).map(item => item.trim()).filter(Boolean);
    return { version: lines[0] || null, binary: binaryPath, status: lines.length ? 'available' : 'unknown' };
  } catch (error) {
    return { version: null, binary: binaryPath, status: 'unavailable', error: error.code || error.message };
  }
}

function readBridgeVersion() {
  const installed = readVersion(resolveBinary('ziwei_user'));
  if (installed.version) return installed;
  try {
    const script = path.join(ROOT, 'daemon', 'ziwei_user.mjs');
    const output = execFileSync(process.execPath, [script, '--version'], { encoding: 'utf8', timeout: 1500, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const version = (String(output).split(/\r?\n/).map(item => item.trim()).find(Boolean) || '').replace(/^ziwei_user\s+/i, '') || null;
    return { version, binary: `${process.execPath} ${script}`, status: version ? 'available' : 'unknown' };
  } catch { return { version: null, binary: null, status: 'unavailable' }; }
}

export function discoverLocalVersions({ force = false } = {}) {
  if (!force && cache.value && cache.expiresAt > Date.now()) return cache.value;
  const agents = Object.fromEntries(Object.entries(CLI_BINARIES).map(([runtime, binary]) => {
    const details = readVersion(resolveBinary(binary));
    return [runtime, { ...details, models: configModels(runtime) }];
  }));
  const bridgeDiscovery = readBridgeVersion();
  const value = {
    bridge: { name: 'ziwei_user', version: bridgeDiscovery.version || BRIDGE_VERSION, binary: bridgeDiscovery.binary, status: bridgeDiscovery.version ? bridgeDiscovery.status : 'package-fallback', host: os.hostname() },
    agents,
    discovered_at: new Date().toISOString()
  };
  cache = { value, expiresAt: Date.now() + 30_000 };
  return value;
}

export function resetDiscoveryCache() { cache = { expiresAt: 0, value: null }; }
