import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validateLegacyHealth, assertLegacyProof, inspectLegacyClientIdentity, resolveLegacyConfigPath } from '../scripts/client-legacy-identity.mjs';

const run = promisify(execFile);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const source = '07540e25e683e40b6858b70c909f5c2279018519963fb7372788b136a54d37a0';
function proof() {
  return { kind: 'ziwei-legacy-stop-proof', schema: 1, observedAt: new Date().toISOString(), root: 'C:\\fixture\\node_modules\\ziwei', node: 'C:\\nodejs\\node.exe', pid: 12345, creationTime: new Date(Date.now() - 20000).toISOString(), commandHash: '1'.repeat(64), installedBuild: '2'.repeat(64), daemonSha256: source, configPath: 'C:\\fixture\\data\\ziwei_user.json', configSha256: '3'.repeat(64), healthOrigin: 'http://127.0.0.1:33001', listenerPid: 12345, workspace: 'isolated', cwd: 'C:\\fixture', configPathSource: 'ZIWEI_CONFIG', configNamespace: 'same-package-context', activeActionCount: null, pollingCount: null };
}

test('historical config resolution uses target cwd and rejects unobserved per-drive cwd state', () => {
  const context = { root: 'C:\\program\\node_modules\\ziwei', cwd: 'C:\\actual-target-cwd', daemonSha256: source };
  assert.equal(resolveLegacyConfigPath({ ...context, environment: { ZIWEI_CONFIG: 'relative\\ziwei_user.json' } }).file, 'C:\\actual-target-cwd\\relative\\ziwei_user.json');
  assert.equal(resolveLegacyConfigPath({ ...context, environment: { ZIWEI_USER_HOME: 'D:\\absolute-user-home' } }).file, 'D:\\absolute-user-home\\ziwei_user.json');
  assert.equal(resolveLegacyConfigPath({ ...context, environment: {} }).file, 'C:\\program\\node_modules\\ziwei\\data\\ziwei_user.json');
  assert.equal(resolveLegacyConfigPath({ ...context, daemonSha256: 'f242f59fdc5ec22098dcbab27385e32db465d1015c810a5bb12c13d29d7622db', environment: { ZIWEI_USER_HOME: 'D:\\ignored-on-earliest-version' } }).source, 'package-data');
  for (const field of ['ZIWEI_CONFIG', 'ZIWEI_USER_HOME']) for (const value of ['D:relative', 'D:', 'c:another\\file']) assert.throws(() => resolveLegacyConfigPath({ ...context, environment: { [field]: value } }), error => error.code === 'LEGACY_CONFIG_MISMATCH');
});

test('the early protocol requires all four missing fields and rejects every modern marker', () => {
  const body = { service: 'ziwei_user', agentId: 'ziwei_user', workspace: 'isolated', pid: 12345 };
  assert.equal(validateLegacyHealth(body, { workspace: 'isolated' }), body);
  for (const field of ['deviceId', 'clientBuild', 'activeActionCount', 'pollingCount', 'lifecycle', 'connectionState']) {
    for (const value of [undefined, null, 0, '']) assert.throws(() => validateLegacyHealth({ ...body, [field]: value }, { workspace: 'isolated' }), error => error.code === 'LEGACY_PROTOCOL_MISMATCH');
  }
  assert.throws(() => validateLegacyHealth(body, { workspace: 'other' }));
  assert.throws(() => validateLegacyHealth(body, { workspace: 'isolated', expectedPid: 999 }));
});

test('proof self-comparison still rejects unbounded, malformed, expired and fabricated evidence', () => {
  const good = proof(); assert.equal(assertLegacyProof(good, good), true);
  const variants = [{}, { ...good, token: 'PRIVATE_SENTINEL' }, { ...good, activeActionCount: 0 }, { ...good, pollingCount: 0 }, { ...good, daemonSha256: '0'.repeat(64) }, { ...good, root: 'relative' }, { ...good, pid: -1 }, { ...good, listenerPid: 1 }, { ...good, healthOrigin: 'http://0.0.0.0:33001' }, { ...good, observedAt: new Date(Date.now() - 300001).toISOString() }, { ...good, observedAt: new Date(Date.now() + 20000).toISOString() }];
  for (const candidate of variants) assert.throws(() => assertLegacyProof(candidate, candidate));
});

test('the original confirmation binds every immutable identity fact', () => {
  const good = proof();
  for (const change of [{ configSha256: '4'.repeat(64) }, { commandHash: '4'.repeat(64) }, { installedBuild: '4'.repeat(64) }, { creationTime: new Date(Date.now() - 30000).toISOString() }, { healthOrigin: 'http://127.0.0.1:33002' }, { configPath: 'C:\\other\\ziwei_user.json' }, { cwd: 'C:\\other' }, { root: 'C:\\other\\node_modules\\ziwei' }, { node: 'C:\\other\\node.exe' }, { pid: 12346, listenerPid: 12346 }, { workspace: 'other' }]) {
    assert.throws(() => assertLegacyProof(good, { ...good, ...change }), error => error.code === 'LEGACY_IDENTITY_CHANGED');
  }
});

test('a missing-field server cannot authorize compatibility for unrecognized installed code', { skip: process.platform !== 'win32' }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-legacy-untrusted-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'node_modules', 'ziwei'); fs.mkdirSync(path.join(root, 'daemon'), { recursive: true });
  fs.writeFileSync(path.join(root, 'daemon', 'ziwei_user.mjs'), '// arbitrary code cannot be legacy');
  const configPath = path.join(dir, 'ziwei_user.json'); fs.writeFileSync(configPath, JSON.stringify({ workspace: 'isolated' }));
  await assert.rejects(inspectLegacyClientIdentity({ root, configPath }), error => error.code === 'LEGACY_SOURCE_UNRECOGNIZED');
});

test('a recognized daemon cannot authorize an altered historical configuration resolver', { skip: process.platform !== 'win32' }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-legacy-config-source-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'node_modules', 'ziwei'); fs.mkdirSync(path.join(root, 'daemon'), { recursive: true });
  fs.copyFileSync(path.join(import.meta.dirname, 'fixtures', 'legacy-pre467-daemon.mjs.fixture'), path.join(root, 'daemon', 'ziwei_user.mjs'));
  fs.writeFileSync(path.join(root, 'daemon', 'config.mjs'), 'export const resolveConfigPath=()=>"different-config";');
  const configPath = path.join(dir, 'ziwei_user.json'); fs.writeFileSync(configPath, JSON.stringify({ workspace: 'isolated' }));
  await assert.rejects(inspectLegacyClientIdentity({ root, configPath }), error => error.code === 'LEGACY_SOURCE_UNRECOGNIZED');
});

test('Windows reader binds the actual process cwd/environment and health listener without returning secrets', { skip: process.platform !== 'win32', timeout: 45000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-legacy-peb-'));
  const root = path.join(dir, 'node_modules', 'ziwei'), cwd = path.join(dir, 'different-working-directory');
  fs.mkdirSync(path.join(root, 'daemon'), { recursive: true }); fs.mkdirSync(cwd);
  const file = path.join(dir, 'ziwei_user.json'), ready = path.join(dir, 'ready.json'), entry = path.join(root, 'daemon', 'ziwei_user.mjs');
  fs.writeFileSync(file, '{}');
  fs.writeFileSync(entry, `import http from 'node:http';import fs from 'node:fs';const s=http.createServer((q,r)=>r.end('ok'));s.listen(0,'127.0.0.1',()=>fs.writeFileSync(${JSON.stringify(ready)},JSON.stringify({port:s.address().port,pid:process.pid})));`);
  const child = spawn(process.execPath, [entry], { cwd, env: { ...process.env, ZIWEI_CONFIG: file, ZIWEI_USER_HOME: dir, PRIVATE_LEGACY_SENTINEL: 'must-not-be-returned' }, windowsHide: true, stdio: 'ignore' });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await new Promise(resolve => child.once('exit', resolve)); } fs.rmSync(dir, { recursive: true, force: true }); });
  for (let attempt = 0; attempt < 100 && !fs.existsSync(ready); attempt++) await pause(30);
  const record = JSON.parse(fs.readFileSync(ready));
  const helper = path.resolve(import.meta.dirname, '../scripts/client-legacy-identity.ps1');
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-TargetProcessId', String(child.pid), '-ExpectedNode', process.execPath, '-ExpectedEntry', entry, '-HealthHost', '127.0.0.1', '-HealthPort', String(record.port)];
  const result = await run('powershell.exe', args, { encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 128 * 1024 });
  const actual = JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
  assert.equal(actual.pid, child.pid); assert.equal(actual.listenerPid, child.pid);
  assert.equal(path.resolve(actual.cwd), cwd); assert.equal(actual.environment.ZIWEI_CONFIG, file); assert.equal(actual.environment.ZIWEI_USER_HOME, dir);
  assert.match(actual.commandHash, /^[a-f0-9]{64}$/); assert.ok(Number.isFinite(Date.parse(actual.creationTime)));
  assert.doesNotMatch(result.stdout + result.stderr, /must-not-be-returned|PRIVATE_LEGACY_SENTINEL|"command"/);
  await assert.rejects(run('powershell.exe', [...args.slice(0, -1), String(record.port === 65535 ? 65534 : record.port + 1)], { windowsHide: true, timeout: 20000 }), error => error.stderr.trim() === 'LEGACY_PROCESS_IDENTITY_UNAVAILABLE');
  assert.doesNotThrow(() => process.kill(child.pid, 0));
});
