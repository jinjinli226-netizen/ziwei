import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const BRIDGE_VERSION = process.env.ZIWEI_USER_VERSION || JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const CLI_BINARIES = { Claude: 'claude', Codex: 'codex', Gemini: 'gemini', Hermes: 'hermes' };
let cache = { expiresAt: 0, value: null };

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
  const agents = Object.fromEntries(Object.entries(CLI_BINARIES).map(([runtime, binary]) => [runtime, readVersion(resolveBinary(binary))]));
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
