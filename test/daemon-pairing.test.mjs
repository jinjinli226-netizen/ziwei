import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../backend/repository.mjs';
import { createApp } from '../backend/app.mjs';

test('device pairing codes are single-use and issue a workspace-bound credential', () => {
  const repo = createRepository({ memory: true });
  const pairing = repo.createDevicePairing('test-111', { name: '远程电脑', os: 'Windows' });
  assert.match(pairing.code, /^zwi-[a-z0-9-]+$/);
  assert.equal(pairing.workspace, 'test-111');

  const claimed = repo.claimDevicePairing({ code: pairing.code, name: '远程电脑', os: 'Windows' });
  assert.match(claimed.deviceId, /^device_/);
  assert.match(claimed.deviceToken, /^zwd_/);
  assert.equal(claimed.workspace, 'test-111');

  assert.throws(() => repo.claimDevicePairing({ code: pairing.code }), /配对码无效|已使用|已过期/);
  assert.ok(repo.authenticateDeviceToken(claimed.deviceToken, { workspaceSlug: 'test-111', deviceId: claimed.deviceId }));
  assert.equal(repo.authenticateDeviceToken(claimed.deviceToken, { workspaceSlug: 'other-workspace', deviceId: claimed.deviceId }), null);
  repo.revokeDeviceCredential(claimed.deviceId);
  assert.equal(repo.authenticateDeviceToken(claimed.deviceToken, { workspaceSlug: 'test-111', deviceId: claimed.deviceId }), null);
});

test('daemon pairing exchange is public while heartbeat requires the issued device credential', async () => {
  const repo = createRepository({ memory: true });
  const app = createApp({ repository: repo, memory: true, requireDeviceAuth: true, enableScheduler: false });
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const created = await fetch(`${base}/api/workspaces/test-111/devices/pairing`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '远程 Windows', os: 'Windows' })
    });
    assert.equal(created.status, 201);
    const pairing = await created.json();

    const exchanged = await fetch(`${base}/api/daemon/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: pairing.code, name: '远程 Windows', os: 'Windows' })
    });
    assert.equal(exchanged.status, 200);
    const credential = await exchanged.json();
    assert.match(credential.deviceToken, /^zwd_/);

    const heartbeatWithoutToken = await fetch(`${base}/api/workspaces/test-111/heartbeat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: credential.deviceId, agentId: 'ziwei_user' })
    });
    assert.equal(heartbeatWithoutToken.status, 401);

    const legacyHeartbeatWithoutToken = await fetch(`${base}/api/daemon/heartbeat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspace: 'test-111', deviceId: credential.deviceId, agentId: 'ziwei_user' })
    });
    assert.equal(legacyHeartbeatWithoutToken.status, 401);

    const heartbeat = await fetch(`${base}/api/workspaces/test-111/heartbeat`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-ziwei-device-token': credential.deviceToken },
      body: JSON.stringify({ deviceId: credential.deviceId, agentId: 'ziwei_user', runtimes: { Claude: { status: 'available', version: '1.0.0' }, Codex: { status: 'unavailable' }, Gemini: { status: 'unavailable' }, Hermes: { status: 'unavailable' } } })
    });
    assert.equal(heartbeat.status, 200);
    assert.equal((await heartbeat.json()).device.id, credential.deviceId);

    const reused = await fetch(`${base}/api/daemon/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: pairing.code })
    });
    assert.equal(reused.status, 400);
  } finally {
    server.close();
  }
});

test('A2A actions can be scoped to one paired computer without hiding unassigned work', () => {
  const repo = createRepository({ memory: true });
  const first = repo.claimDevicePairing({ code: repo.createDevicePairing('test-111').code });
  const second = repo.claimDevicePairing({ code: repo.createDevicePairing('test-111').code });
  const targeted = repo.createA2AAction('test-111', { type: 'task.execute', payload: { prompt: 'only first', deviceId: first.deviceId } });
  const unassigned = repo.createA2AAction('test-111', { type: 'task.execute', payload: { prompt: 'any paired daemon' } });
  assert.deepEqual(repo.listA2AActions('test-111', { deviceId: first.deviceId }).map(item => item.id), [targeted.id, unassigned.id]);
  assert.deepEqual(repo.listA2AActions('test-111', { deviceId: second.deviceId }).map(item => item.id), [unassigned.id]);
  assert.throws(() => repo.ackA2AAction(targeted.id, { agentId: 'ziwei_user', deviceId: second.deviceId }), /another device/);
});
