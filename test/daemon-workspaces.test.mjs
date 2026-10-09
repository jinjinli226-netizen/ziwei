import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as configuration from '../daemon/config.mjs';

test('one daemon resolves explicitly shared workspaces with separate credentials and preserves its primary identity', () => {
  assert.equal(typeof configuration.resolveWorkspaceConnections, 'function');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-shared-workspaces-'));
  const secret = path.join(root, 'phone-device.json');
  fs.writeFileSync(secret, JSON.stringify({ workspace: 'phone_ai', deviceId: 'device_phone', deviceToken: 'private-phone-device-token' }));
  const config = { workspace: 'test_222', deviceId: 'device_primary', deviceToken: 'private-primary-token', healthPort: 20242, apiBase: 'https://example.test', workdir: root, sharedWorkspaces: [{ workspace: 'phone_ai', deviceId: 'device_phone', deviceTokenFile: secret, apiBase: 'https://example.test' }, { workspace: 'unavailable', deviceId: 'device_missing', deviceTokenFile: 'missing.json' }] };
  const before = JSON.stringify(config);
  try {
    const result = configuration.resolveWorkspaceConnections(config, { configPath: path.join(root, 'config.json') });
    assert.equal(result.connections.length, 2);
    assert.equal(result.connections[0].workspace, 'test_222');
    assert.equal(result.connections[0].deviceToken, 'private-primary-token');
    assert.equal(result.connections[1].deviceToken, 'private-phone-device-token');
    assert.equal(result.connections[1].primary, false);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].reason, /凭据/);
    assert.doesNotMatch(JSON.stringify(result.errors), /private-/);
    assert.equal(JSON.stringify(config), before);
    assert.equal(config.healthPort, 20242);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a running isolated daemon accepts a grant and serves two identities without switching primary health', { timeout: 35_000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-multi-daemon-'));
  const calls = [];
  let delivered = false;
  let claimed = false;
  const server = http.createServer((req, res) => {
    calls.push({ url: req.url, token: req.headers['x-ziwei-device-token'] });
    let response = { ok: true };
    if (req.url === '/api/daemon/workspace-grants/grant_dynamic/claim') {
      claimed = true;
      response = { workspace: 'phone_ai', deviceId: 'device_shared', deviceToken: 'test-shared-private-token', apiBase: `http://127.0.0.1:${server.address().port}` };
    } else if (req.url?.startsWith('/a2a/v1/actions?')) {
      const workspace = new URL(req.url, 'http://localhost').searchParams.get('workspace');
      response = { actions: workspace === 'test_222' && !delivered ? [{ id: 'action_share', workspace: 'test_222', type: 'device.workspace.connect', payload: { grantId: 'grant_dynamic', deviceId: 'device_primary' } }] : [] };
      if (response.actions.length) delivered = true;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(response));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const healthProbe = http.createServer();
  await new Promise(resolve => healthProbe.listen(0, '127.0.0.1', resolve));
  const healthPort = healthProbe.address().port;
  await new Promise(resolve => healthProbe.close(resolve));
  const configPath = path.join(root, 'ziwei_user.json');
  fs.writeFileSync(configPath, JSON.stringify({ workspace: 'test_222', deviceId: 'device_primary', deviceToken: 'test-primary-private-token', apiBase: `http://127.0.0.1:${server.address().port}`, healthHost: '127.0.0.1', healthPort, heartbeatMs: 1000, pollMs: 1000, workdir: root }));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../daemon/ziwei_user.mjs', import.meta.url))], { env: { ...process.env, ZIWEI_CONFIG: configPath, ZIWEI_USER_HOME: path.join(root, 'user') }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  try {
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline && !calls.some(call => call.url === '/api/workspaces/phone_ai/heartbeat')) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(claimed, true, output);
    const heartbeat = calls.find(call => call.url === '/api/workspaces/phone_ai/heartbeat');
    assert.equal(heartbeat?.token, 'test-shared-private-token', output);
    assert.ok(calls.some(call => call.url === '/api/workspaces/test_222/heartbeat' && call.token === 'test-primary-private-token'));
    const health = await (await fetch(`http://127.0.0.1:${healthPort}/readyz`)).json();
    assert.equal(health.workspace, 'test_222');
    assert.equal(health.pid, child.pid);
    assert.equal(health.ready, true);
    assert.ok(health.connections.some(item => item.workspace === 'phone_ai' && item.deviceId === 'device_shared'));
    assert.doesNotMatch(output + JSON.stringify(health), /test-primary-private-token|test-shared-private-token/);
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(saved.workspace, 'test_222');
    assert.equal(saved.healthPort, healthPort);
  } finally {
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGTERM');
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 1000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('workspace grant claim persists only a private independent credential and never changes primary config', async () => {
  assert.equal(typeof configuration.claimWorkspaceGrant, 'function');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-workspace-claim-'));
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, authorized: req.headers['x-ziwei-device-token'] === 'private-primary-token' });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ workspace: 'phone_ai', deviceId: 'device_shared', deviceToken: 'private-new-device-token', apiBase: `http://127.0.0.1:${server.address().port}` }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const configPath = path.join(root, 'ziwei_user.json');
  const config = { workspace: 'test_222', deviceId: 'device_primary', deviceToken: 'private-primary-token', apiBase: `http://127.0.0.1:${server.address().port}`, healthPort: 20242, managementMcp: { enabled: true, tokenFile: 'keep.json' }, workdir: root, unknownPreserved: 'keep-this-field' };
  fs.writeFileSync(configPath, JSON.stringify(config));
  try {
    const result = await configuration.claimWorkspaceGrant({ config, configPath, privateDirectory: path.join(root, 'credentials'), grantId: 'grant_phone' });
    assert.deepEqual(requests, [{ url: '/api/daemon/workspace-grants/grant_phone/claim', authorized: true }]);
    assert.equal(result.workspace, 'phone_ai');
    assert.equal(result.deviceId, 'device_shared');
    assert.doesNotMatch(JSON.stringify(result), /private-new-device-token/);
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    for (const [key, value] of Object.entries(config)) assert.deepEqual(saved[key], value);
    assert.equal(saved.sharedWorkspaces.length, 1);
    assert.equal('deviceToken' in saved.sharedWorkspaces[0], false);
    assert.equal(JSON.parse(fs.readFileSync(saved.sharedWorkspaces[0].deviceTokenFile, 'utf8')).deviceToken, 'private-new-device-token');
    const again = await configuration.claimWorkspaceGrant({ config: saved, configPath, privateDirectory: path.join(root, 'credentials'), grantId: 'grant_phone' });
    assert.equal(again.duplicate, true);
    assert.equal(requests.length, 1, 'an accepted local grant must not be replayed');
  } finally { await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); }
});
