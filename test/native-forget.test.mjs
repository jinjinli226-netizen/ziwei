import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { createHash } from 'node:crypto';
import * as configApi from '../daemon/config.mjs';

const run = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));

test('disconnected connection tombstone defeats legacy workspace/token environment and shares', () => {
  const previous = { connectionState: 'disconnected', workspace: 'test_222', deviceId: 'device_old', deviceToken: 'test-private-token', sharedWorkspaces: [{ workspace: 'phone_ai', deviceId: 'device_shared' }] };
  assert.deepEqual(configApi.resolveWorkspaceConnections(previous), { connections: [], errors: [] });
});

test('forget config removes only connection identities and credentials while preserving runtime and provider settings', () => {
  assert.equal(typeof configApi.disconnectedConfiguration, 'function');
  const previous = { workspace: 'test_222', deviceId: 'device_old', deviceToken: 'test-private-token', sharedWorkspaces: [{ workspace: 'phone_ai', deviceTokenFile: 'private.json' }], managementMcp: { tokenFile: 'private-mcp.json' }, healthPort: 20242, workdir: 'unchanged-workdir', hermesHome: 'unchanged-profile', runtimeStorageBinding: { preserve: true }, allowedExecutables: ['safe.exe'], unknown: { keep: true } };
  const result = configApi.disconnectedConfiguration(previous, '2026-10-10T00:00:00Z');
  assert.equal(result.connectionState, 'disconnected');
  assert.equal(result.workspace, ''); assert.equal(result.deviceId, '');
  assert.deepEqual(result.sharedWorkspaces, []);
  assert.equal('deviceToken' in result, false); assert.equal('managementMcp' in result, false);
  for (const key of ['healthPort', 'workdir', 'hermesHome', 'runtimeStorageBinding', 'allowedExecutables', 'unknown']) assert.deepEqual(result[key], previous[key]);
  assert.equal(previous.workspace, 'test_222');
});

test('native forget is an idempotent offline disconnect, removes only owned connection credential files and retains all runtime data', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-forget-offline-'));
  const file = path.join(directory, 'ziwei_user.json');
  fs.mkdirSync(path.join(directory, 'workspace-credentials'));
  fs.mkdirSync(path.join(directory, 'management-mcp-credentials'));
  fs.mkdirSync(path.join(directory, 'mcp'));
  fs.mkdirSync(path.join(directory, 'runtime', 'creator-instances'), { recursive: true });
  const tokenFile = path.join(directory, 'workspace-credentials', 'phone.json');
  fs.writeFileSync(tokenFile, JSON.stringify({ workspace: 'phone_ai', deviceId: 'device_shared', deviceToken: 'test-phone-private-token' }));
  fs.writeFileSync(path.join(directory, 'mcp', 'primary.json'), '{"token":"test-mcp-private-token"}');
  fs.writeFileSync(path.join(directory, 'management-mcp-credentials', 'owned.json'), JSON.stringify({ managed: true, audience: 'ziwei-management', workspace: 'phone_ai', deviceId: 'device_shared', token: 'test-managed-private-token' }));
  fs.writeFileSync(path.join(directory, 'management-mcp-credentials', 'unrelated.json'), JSON.stringify({ managed: true, audience: 'ziwei-management', workspace: 'elsewhere', deviceId: 'device_other', token: 'test-unrelated-private-token' }));
  const memoryFile = path.join(directory, 'runtime', 'creator-instances', 'MEMORY.md'); fs.writeFileSync(memoryFile, 'retain history');
  fs.writeFileSync(file, JSON.stringify({ workspace: 'test_222', deviceId: 'device_primary', deviceToken: 'test-primary-private-token', healthPort: 1, workdir: 'keep', hermesHome: 'keep-source-auth', managementMcp: { tokenFile: path.join(directory, 'mcp', 'primary.json') }, sharedWorkspaces: [{ workspace: 'phone_ai', deviceId: 'device_shared', deviceTokenFile: tokenFile }] }));
  const env = { ...process.env, ZIWEI_USER_HOME: directory, ZIWEI_CONFIG: file, ZIWEI_WORKSPACE: 'bjc-ops' };
  try {
    const first = await run(process.execPath, [path.join(root, 'scripts/ziwei-cli.mjs'), 'forget', '--json'], { env, timeout: 5000, windowsHide: true });
    const summary = JSON.parse(first.stdout);
    assert.equal(summary.connectionState, 'disconnected'); assert.equal(summary.connectionCount, 0); assert.equal(summary.credentialFilesRemoved, 3);
    assert.equal(fs.existsSync(tokenFile), false);
    assert.equal(fs.existsSync(path.join(directory, 'management-mcp-credentials', 'unrelated.json')), true);
    assert.equal(fs.readFileSync(memoryFile, 'utf8'), 'retain history');
    const config = JSON.parse(fs.readFileSync(file)); assert.equal(config.hermesHome, 'keep-source-auth'); assert.equal(config.workdir, 'keep');
    assert.doesNotMatch(JSON.stringify(config) + first.stdout + fs.readFileSync(path.join(directory, 'logs', 'daemon.log')), /test-.*private-token|bjc-ops/);
    const second = await run(process.execPath, [path.join(root, 'scripts/ziwei-cli.mjs'), 'forget', '--json'], { env, timeout: 3000, windowsHide: true });
    assert.equal(JSON.parse(second.stdout).alreadyDisconnected, true);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('start, change and status never restore disconnected identity from bjc-ops environment', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-forget-'));
  const file = path.join(directory, 'ziwei_user.json');
  let requests = 0;
  const server = http.createServer((_, res) => { requests++; res.writeHead(503); res.end('{}'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  fs.writeFileSync(file, JSON.stringify({ connectionState: 'disconnected', workspace: '', deviceId: '', sharedWorkspaces: [], healthPort: server.address().port }));
  const env = { ...process.env, ZIWEI_CONFIG: file, ZIWEI_USER_HOME: directory, ZIWEI_WORKSPACE: 'bjc-ops', ZIWEI_DEVICE_TOKEN: 'test-untrusted-env' };
  try {
    for (const command of ['start', 'change']) await assert.rejects(run(process.execPath, [path.join(root, 'scripts/ziwei-cli.mjs'), command], { env, timeout: 3000, windowsHide: true }), error => error.code === 1 && /断开|disconnected/.test(error.stderr));
    const result = await run(process.execPath, [path.join(root, 'scripts/ziwei-cli.mjs'), 'status', '--json'], { env, timeout: 3000, windowsHide: true });
    const status = JSON.parse(result.stdout);
    assert.equal(status.connectionState, 'disconnected'); assert.equal(status.connectionCount, 0); assert.equal(status.configured, false);
    assert.doesNotMatch(result.stdout, /bjc-ops|test-untrusted-env/);
    assert.deepEqual(fs.readdirSync(directory), ['ziwei_user.json'], 'status/start must not create runtime or daemon log directories');
    await assert.rejects(run(process.execPath, [path.join(root, 'daemon/ziwei_user.mjs')], { env, timeout: 3000, windowsHide: true }), error => error.code === 1 && /断开|disconnected/.test(error.stderr));
    assert.equal(requests, 0, 'Disconnected native entrypoints must not even probe a health/network endpoint');
  } finally { await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('pending disconnect cleanup resumes exact credential deletion instead of falsely reporting already disconnected', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-forget-resume-'));
  const file = path.join(directory, 'ziwei_user.json');
  fs.mkdirSync(path.join(directory, 'management-mcp-credentials'));
  const credential = path.join(directory, 'management-mcp-credentials', 'residual.json');
  fs.writeFileSync(credential, JSON.stringify({ managed: true, audience: 'ziwei-management', workspace: 'phone_ai', deviceId: 'device_shared', token: 'test-residual-private-token' }));
  const sha256 = createHash('sha256').update(fs.readFileSync(credential)).digest('hex');
  fs.writeFileSync(file, JSON.stringify({ connectionState: 'disconnected', workspace: '', deviceId: '', sharedWorkspaces: [], healthPort: 1, connectionCleanup: { version: 1, state: 'pending', stoppedPid: null, identities: [{ workspace: 'phone_ai', deviceId: 'device_shared' }], credentialFiles: [{ file: credential, sha256 }] } }));
  try {
    await assert.rejects(run(process.execPath, [path.join(root, 'scripts/ziwei-cli.mjs'), 'status', '--json'], { env: { ...process.env, ZIWEI_CONFIG: file }, timeout: 3000, windowsHide: true }), error => error.code === 1 && JSON.parse(error.stdout).cleanupPending === true);
    const result = await run(process.execPath, [path.join(root, 'scripts/ziwei-cli.mjs'), 'forget', '--json'], { env: { ...process.env, ZIWEI_CONFIG: file }, timeout: 5000, windowsHide: true });
    assert.equal(JSON.parse(result.stdout).credentialFilesRemoved, 1); assert.equal(fs.existsSync(credential), false);
    assert.equal(JSON.parse(fs.readFileSync(file)).connectionCleanup.state, 'complete');
    assert.doesNotMatch(result.stdout + fs.readFileSync(file, 'utf8'), /test-residual-private-token/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('forget refuses a credential reference outside its private connection stores without changing config or source authentication', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-forget-outside-'));
  const file = path.join(directory, 'ziwei_user.json'); const auth = path.join(directory, 'auth.json');
  fs.writeFileSync(auth, '{"token":"test-source-auth-private-token"}');
  const original = JSON.stringify({ workspace: 'fixture', deviceId: 'device_fixture', deviceToken: 'test-daemon-private-token', healthPort: 1, managementMcp: { tokenFile: auth } }); fs.writeFileSync(file, original);
  try {
    await assert.rejects(run(process.execPath, [path.join(root, 'scripts/ziwei-cli.mjs'), 'forget', '--json'], { env: { ...process.env, ZIWEI_CONFIG: file }, timeout: 3000, windowsHide: true }), /专用目录/);
    assert.equal(fs.readFileSync(file, 'utf8'), original); assert.match(fs.readFileSync(auth, 'utf8'), /test-source-auth-private-token/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('a disconnected tombstone with an unverified old listener fails without stopping or reporting cleanup complete', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-forget-listener-'));
  const file = path.join(directory, 'ziwei_user.json'); let requests = 0;
  const server = http.createServer((_, res) => { requests++; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, ready: true, service: 'ziwei_user', pid: process.pid, workspace: 'old_workspace', deviceId: 'device_old' })); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const original = JSON.stringify({ connectionState: 'disconnected', workspace: '', deviceId: '', sharedWorkspaces: [], healthPort: server.address().port }); fs.writeFileSync(file, original);
  try {
    await assert.rejects(run(process.execPath, [path.join(root, 'scripts/ziwei-cli.mjs'), 'forget', '--json'], { env: { ...process.env, ZIWEI_CONFIG: file }, timeout: 5000, windowsHide: true }), /不匹配|listener/);
    assert.equal(fs.readFileSync(file, 'utf8'), original); assert.ok(requests > 0); assert.equal(server.listening, true);
  } finally { await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('only explicit native connect removes the disconnect tombstone and uses the new paired identity', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-forget-repair-'));
  const file = path.join(directory, 'ziwei_user.json');
  const backend = http.createServer((_, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ workspace: 'new_workspace', deviceId: 'device_new', deviceToken: 'test-new-private-token' })); });
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  fs.writeFileSync(file, JSON.stringify({ connectionState: 'disconnected', workspace: '', deviceId: '', sharedWorkspaces: [], healthPort: 20242, hermesHome: 'keep-source-auth', workdir: 'keep-workdir', connectionCleanup: { state: 'complete' }, disconnectedAt: 'old' }));
  try {
    const env = { ...process.env, ZIWEI_CONFIG: file, ZIWEI_WORKSPACE: 'bjc-ops' };
    await run(process.execPath, [path.join(root, 'scripts/ziwei-cli.mjs'), 'setup', '--workspace', 'bjc-ops'], { env, timeout: 5000, windowsHide: true });
    assert.equal(JSON.parse(fs.readFileSync(file)).connectionState, 'disconnected');
    const result = await run(process.execPath, [path.join(root, 'scripts/ziwei-cli.mjs'), 'connect', '--api', `http://127.0.0.1:${backend.address().port}`, '--code', 'fixture-once'], { env, timeout: 5000, windowsHide: true });
    const paired = JSON.parse(fs.readFileSync(file));
    assert.equal(paired.connectionState, 'connected'); assert.equal(paired.workspace, 'new_workspace'); assert.equal(paired.deviceId, 'device_new');
    assert.equal(paired.hermesHome, 'keep-source-auth'); assert.equal(paired.workdir, 'keep-workdir');
    assert.equal('connectionCleanup' in paired, false); assert.equal('disconnectedAt' in paired, false);
    assert.doesNotMatch(result.stdout, /test-new-private-token/);
  } finally { await new Promise(resolve => backend.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('native forget authenticates loopback pause, drains an isolated in-flight action and stops only its exact daemon', { timeout: 25_000 }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-forget-drain-'));
  const file = path.join(directory, 'ziwei_user.json'); let delivered = false, calls = 0;
  const backend = http.createServer((req, res) => {
    calls++;
    let body = { ok: true };
    if (req.url.endsWith('/mcp/bootstrap')) body = { managed: true, audience: 'ziwei-management', token: 'test-management-private-token', workspace: 'fixture', deviceId: 'device_fixture', credentialId: 'credential_fixture', apiBase: `http://127.0.0.1:${backend.address().port}`, expiresAt: new Date(Date.now() + 3600000).toISOString() };
    if (req.url.startsWith('/a2a/v1/actions?')) { body = { actions: delivered ? [] : [{ id: 'action_fixture', workspace: 'fixture', type: 'command.execute', payload: { executable: 'node', args: ['-e', "setTimeout(()=>console.log('isolated fixture done'),4000)"] } }] }; delivered = true; }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body));
  });
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  const portProbe = http.createServer(); await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve)); const port = portProbe.address().port; await new Promise(resolve => portProbe.close(resolve));
  const env = { ...process.env, ZIWEI_CONFIG: file, ZIWEI_USER_HOME: directory };
  fs.mkdirSync(path.join(directory, 'runtime'));
  fs.writeFileSync(file, JSON.stringify({ workspace: 'fixture', deviceId: 'device_fixture', deviceToken: 'test-device-private-token', apiBase: `http://127.0.0.1:${backend.address().port}`, healthHost: '127.0.0.1', healthPort: port, heartbeatMs: 1000, pollMs: 1000, workdir: path.join(directory, 'runtime'), allowedExecutables: ['node'] }));
  const daemon = spawn(process.execPath, [path.join(root, 'daemon/ziwei_user.mjs')], { env, windowsHide: true, stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}`;
  try {
    let health; const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) { try { health = await (await fetch(`${url}/healthz`)).json(); if (health.activeActionCount === 1) break; } catch {} await new Promise(resolve => setTimeout(resolve, 50)); }
    assert.equal(health.activeActionCount, 1, 'Health must report actual scheduler work, not completed history');
    const unauthorized = await fetch(`${url}/local/connection-control`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"operation":"pause"}' });
    assert.equal(unauthorized.status, 401);
    await assert.rejects(run(process.execPath, [path.join(root, 'scripts/ziwei-cli.mjs'), 'forget', '--expected-pid', String(process.pid)], { env, timeout: 3000, windowsHide: true }), /PID/);
    const started = Date.now();
    const result = await run(process.execPath, [path.join(root, 'scripts/ziwei-cli.mjs'), 'forget', '--expected-pid', String(daemon.pid), '--json'], { env, timeout: 12_000, windowsHide: true });
    const summary = JSON.parse(result.stdout); assert.equal(summary.stoppedPid, daemon.pid); assert.equal(summary.connectionCount, 0);
    assert.ok(Date.now() - started > 500, 'Forget must wait for the executing command to finish');
    const state = JSON.parse(fs.readFileSync(path.join(directory, 'runtime', 'action-state.json')));
    assert.equal(state.completed[0].result.status, 'succeeded');
    const after = calls; await new Promise(resolve => setTimeout(resolve, 1100)); assert.equal(calls, after, 'No poll/heartbeat or automatic restart after forget');
    const logs = fs.readFileSync(path.join(directory, 'logs', 'daemon.log'), 'utf8');
    assert.match(logs, /connection_drain_requested/); assert.match(logs, /connections_forgotten/);
    assert.doesNotMatch(logs + result.stdout, /test-device-private-token|test-management-private-token/);
  } finally { if (daemon.exitCode === null) daemon.kill('SIGTERM'); await new Promise(resolve => backend.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); }
});
