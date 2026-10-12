import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolveConfigPath } from '../daemon/config.mjs';
import { clientBuildIdentity } from '../src/management-bootstrap.mjs';

const run = promisify(execFile);
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (code = 'LEGACY_IDENTITY_UNVERIFIED') => Object.assign(new Error('旧版客户端的安装、进程、配置或监听身份无法完整核验；未停止任何进程'), { code });
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const samePath = (a, b) => typeof a === 'string' && typeof b === 'string' && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
// Git blobs of every published daemon revision before 467ad23. An absent
// health field does not by itself authorize treating arbitrary code as legacy.
const LEGACY_SOURCES = new Map([
  ['07540e25e683e40b6858b70c909f5c2279018519963fb7372788b136a54d37a0', 'user-home'], // 628482d
  ['b5d356bca5258a6650822e00de3d8a20db5ec1b23852f8835e3166e0ce2dd965', 'user-home'], // bef1944
  ['582b1ffef9680b0e30ded01ee8866f185303bb09598e9410c25ef21d1b05f057', 'user-home'], // 0884d7e
  ['eb0ad265784ad9d72c5ab03f4219a22a425ce9f0ee0e77617ae49b83260fe716', 'user-home'], // d18121e
  ['64c982a38af4740348f3a315b5fbb00c71d42c2d80baa852c8a10d2071ee0eae', 'user-home'], // 1fe9df7
  ['838ee37bf57ce0d50967b2d1f64a5f0a5aa59004c5efd468b83c3c5d644cdfba', 'user-home'], // 967e5fc
  ['9693aaac8d832ae7e71eecab1d4b0dcce1d8bfe113f66e1b0d353c79da399337', 'package-data'], // f37f396
  ['f242f59fdc5ec22098dcbab27385e32db465d1015c810a5bb12c13d29d7622db', 'package-data'], // cb7bfed
]);
const LEGACY_CONFIG_SOURCES = new Map([
  ['07540e25e683e40b6858b70c909f5c2279018519963fb7372788b136a54d37a0', '0be69b3bc36bbaeeff8fe1bd9990c09f13aaaf8b76f030382cfad5bcb66662fc'],
  ...['b5d356bca5258a6650822e00de3d8a20db5ec1b23852f8835e3166e0ce2dd965', '582b1ffef9680b0e30ded01ee8866f185303bb09598e9410c25ef21d1b05f057', 'eb0ad265784ad9d72c5ab03f4219a22a425ce9f0ee0e77617ae49b83260fe716', '64c982a38af4740348f3a315b5fbb00c71d42c2d80baa852c8a10d2071ee0eae', '838ee37bf57ce0d50967b2d1f64a5f0a5aa59004c5efd468b83c3c5d644cdfba'].map(daemon => [daemon, '8c73f4dcd0d48f6b592d7055359eae97b9be40148d655752ccbe7db9d678904f']),
]);
const PROOF_KEYS = ['kind', 'schema', 'observedAt', 'root', 'node', 'pid', 'creationTime', 'commandHash', 'installedBuild', 'daemonSha256', 'configPath', 'configSha256', 'healthOrigin', 'listenerPid', 'workspace', 'cwd', 'configPathSource', 'configNamespace', 'activeActionCount', 'pollingCount'].sort();
const MODERN_FIELDS = ['deviceId', 'clientBuild', 'activeActionCount', 'pollingCount', 'lifecycle', 'connectionState'];
const owns = (object, field) => Object.prototype.hasOwnProperty.call(object, field);

export function validateLegacyHealth(body, { workspace, expectedPid } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.service !== 'ziwei_user' || body.agentId !== 'ziwei_user' || body.workspace !== workspace || typeof workspace !== 'string' || !workspace || !Number.isSafeInteger(body.pid) || body.pid < 1 || MODERN_FIELDS.some(field => owns(body, field)) || (expectedPid !== undefined && body.pid !== expectedPid)) throw fail('LEGACY_PROTOCOL_MISMATCH');
  return body;
}

/** Resolve only the audited historical algorithms against the target's cwd. */
export function resolveLegacyConfigPath({ root, cwd, environment, daemonSha256 } = {}) {
  if (!LEGACY_SOURCES.has(daemonSha256) || !path.win32.isAbsolute(root || '') || !path.win32.isAbsolute(cwd || '') || !environment || typeof environment !== 'object' || Array.isArray(environment)) throw fail();
  const values = {};
  for (const [key, value] of Object.entries(environment)) {
    const name = key.toUpperCase();
    if (!['ZIWEI_CONFIG', 'ZIWEI_USER_HOME'].includes(name) || owns(values, name) || typeof value !== 'string' || value.length > 32766 || /[\r\n\0]/.test(value)) throw fail();
    // Windows drive-relative paths use the per-drive =D: environment state,
    // which is deliberately not captured. Never resolve them using our cwd.
    if (/^[a-z]:(?![\\/])/i.test(value)) throw fail('LEGACY_CONFIG_MISMATCH');
    values[name] = value;
  }
  if (values.ZIWEI_CONFIG) return { file: path.win32.resolve(cwd, values.ZIWEI_CONFIG), source: 'ZIWEI_CONFIG' };
  if (values.ZIWEI_USER_HOME && LEGACY_SOURCES.get(daemonSha256) === 'user-home') return { file: path.win32.resolve(cwd, values.ZIWEI_USER_HOME, 'ziwei_user.json'), source: 'ZIWEI_USER_HOME' };
  return { file: path.win32.join(root, 'data', 'ziwei_user.json'), source: 'package-data' };
}

function originFor(config, env) {
  let host = String(config.healthHost || env.ZIWEI_HEALTH_HOST || '127.0.0.1');
  if (host === 'localhost') host = '127.0.0.1';
  if (host === '[::1]') host = '::1';
  const port = Number(config.healthPort || env.ZIWEI_HEALTH_PORT || 20242);
  if (!['127.0.0.1', '::1'].includes(host) || !Number.isSafeInteger(port) || port < 1 || port > 65535) throw fail();
  return { host, port, origin: `http://${host === '::1' ? '[::1]' : host}:${port}` };
}

function validateProof(value, now, maxAgeMs) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(PROOF_KEYS) || value.kind !== 'ziwei-legacy-stop-proof' || value.schema !== 1) throw fail('LEGACY_PROOF_INVALID');
  for (const field of ['root', 'node', 'configPath', 'cwd']) if (typeof value[field] !== 'string' || value[field].length > 32766 || !path.win32.isAbsolute(value[field]) || /[\r\n\0]/.test(value[field])) throw fail('LEGACY_PROOF_INVALID');
  if (!Number.isSafeInteger(value.pid) || value.pid < 1 || value.listenerPid !== value.pid || !['commandHash', 'installedBuild', 'daemonSha256', 'configSha256'].every(field => hex(value[field])) || !LEGACY_SOURCES.has(value.daemonSha256) || typeof value.workspace !== 'string' || !value.workspace || value.workspace.length > 200 || /[\r\n\0]/.test(value.workspace) || !['ZIWEI_CONFIG', 'ZIWEI_USER_HOME', 'package-data'].includes(value.configPathSource) || !['same-package-context', 'explicit-msix-cache'].includes(value.configNamespace) || value.activeActionCount !== null || value.pollingCount !== null) throw fail('LEGACY_PROOF_INVALID');
  let url; try { url = new URL(value.healthOrigin); } catch { throw fail('LEGACY_PROOF_INVALID'); }
  if (!/^http:\/\/(127\.0\.0\.1|\[::1\]):[1-9][0-9]{0,4}$/.test(value.healthOrigin) || Number(url.port) > 65535 || url.origin !== value.healthOrigin) throw fail('LEGACY_PROOF_INVALID');
  const observed = Date.parse(value.observedAt), created = Date.parse(value.creationTime);
  if (typeof value.observedAt !== 'string' || !Number.isFinite(observed) || new Date(observed).toISOString() !== value.observedAt || typeof value.creationTime !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,7}Z$/.test(value.creationTime) || !Number.isFinite(created) || created > observed + 1000 || observed > now + 1000 || now - observed > maxAgeMs) throw fail('LEGACY_PROOF_EXPIRED');
}

/** Validate both schemas before comparing; self-comparison never skips checks. */
export function assertLegacyProof(expected, actual, { now = Date.now(), maxAgeMs = 300000 } = {}) {
  if (!Number.isFinite(now) || !Number.isFinite(maxAgeMs) || maxAgeMs < 1 || maxAgeMs > 300000) throw fail('LEGACY_PROOF_INVALID');
  validateProof(expected, now, maxAgeMs); validateProof(actual, now, maxAgeMs);
  for (const field of PROOF_KEYS) if (field !== 'observedAt' && expected[field] !== actual[field]) throw fail('LEGACY_IDENTITY_CHANGED');
  return true;
}

function noLinks(file) {
  for (let current = path.resolve(file); ; current = path.dirname(current)) {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw fail();
    if (current === path.dirname(current)) break;
  }
}

/** Read-only Windows identity evidence; never pauses, kills, starts or rewrites. */
export async function inspectLegacyClientIdentity({ root, env = process.env, configPath, body, expectedProof } = {}) {
  if (process.platform !== 'win32') throw fail('WINDOWS_ONLY');
  if (expectedProof) assertLegacyProof(expectedProof, expectedProof);
  try {
    root = path.resolve(root); const file = configPath ? path.resolve(configPath) : resolveConfigPath({ root, env });
    noLinks(root); noLinks(file); noLinks(path.join(root, 'daemon', 'ziwei_user.mjs'));
    const configBytes = fs.readFileSync(file), configSha256 = hash(configBytes), config = JSON.parse(configBytes);
    const daemonBytes = fs.readFileSync(path.join(root, 'daemon', 'ziwei_user.mjs'));
    // npm tarballs use the Git blob's LF bytes. Accept CRLF checkout encoding
    // only as the same inspected source, while the full build pins actual bytes.
    const daemonSha256 = hash(daemonBytes.toString('utf8').replaceAll('\r\n', '\n'));
    if (!LEGACY_SOURCES.has(daemonSha256)) throw fail('LEGACY_SOURCE_UNRECOGNIZED');
    if (LEGACY_CONFIG_SOURCES.has(daemonSha256)) {
      const historicalConfig = path.join(root, 'daemon', 'config.mjs'); noLinks(historicalConfig);
      if (hash(fs.readFileSync(historicalConfig, 'utf8').replaceAll('\r\n', '\n')) !== LEGACY_CONFIG_SOURCES.get(daemonSha256)) throw fail('LEGACY_SOURCE_UNRECOGNIZED');
    }
    const installedBuild = clientBuildIdentity(root), endpoint = originFor(config, env);
    const getHealth = async () => {
      const response = await fetch(endpoint.origin + '/healthz', { redirect: 'error', signal: AbortSignal.timeout(1500) });
      if (!response.ok) throw fail();
      const chunks = []; let length = 0;
      if (!response.body) throw fail();
      for await (const chunk of response.body) {
        length += chunk.length;
        if (length > 128 * 1024) throw fail();
        chunks.push(chunk);
      }
      return validateLegacyHealth(JSON.parse(Buffer.concat(chunks).toString('utf8')), { workspace: config.workspace, expectedPid: expectedProof?.pid });
    };
    const initial = validateLegacyHealth(body || await getHealth(), { workspace: config.workspace, expectedPid: expectedProof?.pid });
    const helper = fileURLToPath(new URL('./client-legacy-identity.ps1', import.meta.url));
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-TargetProcessId', String(initial.pid), '-ExpectedNode', process.execPath, '-ExpectedEntry', path.join(root, 'daemon', 'ziwei_user.mjs'), '-HealthHost', endpoint.host, '-HealthPort', String(endpoint.port)], { windowsHide: true, timeout: 15000, maxBuffer: 128 * 1024, encoding: 'utf8' });
    const record = JSON.parse(stdout.replace(/^\uFEFF/, ''));
    if (record.pid !== initial.pid || record.listenerPid !== initial.pid || !path.win32.isAbsolute(record.cwd) || !record.environment || typeof record.environment !== 'object') throw fail();
    const { file: resolved, source: configPathSource } = resolveLegacyConfigPath({ root, cwd: record.cwd, environment: record.environment, daemonSha256 });
    if (!samePath(resolved, file)) throw fail('LEGACY_CONFIG_MISMATCH');
    // Package virtualization can map identical logical AppData paths to different
    // files. Cross-context comparison is allowed only for the explicit physical
    // MSIX LocalCache path from the target's own selected environment variable.
    const explicitCache = configPathSource !== 'package-data' && /\\AppData\\Local\\Packages\\[^\\]+\\LocalCache\\(?:Local|Roaming)\\/i.test(resolved);
    if (record.samePackageContext !== true && !explicitCache) throw fail('LEGACY_CONFIG_NAMESPACE_UNVERIFIED');
    const final = await getHealth(); if (final.pid !== initial.pid || hash(fs.readFileSync(file)) !== configSha256 || clientBuildIdentity(root) !== installedBuild) throw fail('LEGACY_IDENTITY_CHANGED');
    const proof = { kind: 'ziwei-legacy-stop-proof', schema: 1, observedAt: new Date().toISOString(), root, node: process.execPath, pid: initial.pid, creationTime: record.creationTime, commandHash: record.commandHash, installedBuild, daemonSha256, configPath: file, configSha256, healthOrigin: endpoint.origin, listenerPid: record.listenerPid, workspace: config.workspace, cwd: record.cwd, configPathSource, configNamespace: record.samePackageContext ? 'same-package-context' : 'explicit-msix-cache', activeActionCount: null, pollingCount: null };
    assertLegacyProof(expectedProof || proof, proof);
    return proof;
  } catch (error) {
    if (typeof error?.code === 'string' && /^(LEGACY_|WINDOWS_ONLY)/.test(error.code)) throw error;
    // Process environment, configuration, command lines and child stderr stay private.
    throw fail();
  }
}
