import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../backend/repository.mjs';
import { createApp } from '../backend/app.mjs';

test('repository supports device rename, disable, enable and delete without reviving disabled heartbeats', () => {
  const repo = createRepository({ memory: true });
  const device = repo.createDevice('test-111', { name: '办公室电脑', os: 'Windows' });
  assert.match(device.created_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(repo.updateDevice(device.id, { name: '会议室电脑' }).name, '会议室电脑');
  assert.equal(repo.setDeviceStatus(device.id, 'disabled').status, 'disabled');
  assert.equal(repo.heartbeatDevice('test-111', { deviceId: device.id }).status, 'disabled');
  assert.equal(repo.setDeviceStatus(device.id, 'pending').status, 'offline');
  assert.equal(repo.deleteDevice(device.id).deleted, true);
  assert.equal(repo.listDevices('test-111').some(item => item.id === device.id), false);
});

test('historical seed device can be removed and paired devices keep their custom name', () => {
  const repo = createRepository({ memory: true });
  const seed = repo.listDevices('test-111').find(item => item.id === 'device-ziwei-user');
  assert.equal(repo.deleteDevice(seed.id).deleted, true);
  const pairing = repo.createDevicePairing('test-111', { name: '研发工作站', os: 'Windows' });
  const claimed = repo.claimDevicePairing({ code: pairing.code });
  const paired = repo.listDevices('test-111').find(item => item.id === claimed.deviceId);
  assert.equal(paired.name, '研发工作站');
  assert.match(paired.created_at, /^\d{4}-\d{2}-\d{2}T/);
});

test('workspace resource matrix protects device and API key mutations by role', async () => {
  const app = createApp({ memory: true });
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, role, options = {}) => fetch(`${base}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(role ? { 'x-workspace-role': role } : {}), ...(options.headers || {}) } });
  try {
    const created = await request('/api/workspaces/test-111/devices', 'owner', { method: 'POST', body: JSON.stringify({ name: '权限设备' }) });
    assert.equal(created.status, 201);
    const device = await created.json();
    assert.equal((await request(`/api/devices/${device.id}`, 'member', { method: 'PATCH', body: JSON.stringify({ name: '越权' }) })).status, 403);
    assert.equal((await request(`/api/devices/${device.id}/disable`, 'admin', { method: 'POST', body: '{}' })).status, 200);
    assert.equal((await request(`/api/devices/${device.id}`, 'member', { method: 'DELETE' })).status, 403);
    assert.equal((await request('/api/workspaces/test-111/api-keys', 'member')).status, 403);
    const matrix = await request('/api/workspaces/test-111/permissions', 'member');
    assert.equal(matrix.status, 200);
    assert.ok((await matrix.json()).roles.member.read.includes('runtimes'));
  } finally { server.close(); }
});
