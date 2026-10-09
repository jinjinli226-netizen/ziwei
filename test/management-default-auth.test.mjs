import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../backend/app.mjs';

async function fixture(options = {}) {
  let clock = Date.now();
  const app = createApp({ memory: true, enableScheduler: false, managementMcpSecret: 'test-management-signing-secret', managementMcpNow: () => clock, ...options });
  const repo = app.locals.repo;
  const pair = repo.createDevicePairing('test-111', { name: '管理测试电脑' });
  const device = repo.claimDevicePairing({ code: pair.code });
  repo.heartbeatDevice('test-111', { deviceId: device.deviceId, runtimes: { Hermes: { status: 'available', profiles: [{ name: 'default', provider_configured: true, authentication_configured: true }] } } });
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (url, init = {}) => fetch(base + url, init);
  const bootstrap = (slug = 'test-111', token = device.deviceToken, body = {}) => request(`/api/workspaces/${slug}/mcp/bootstrap`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ziwei-device-token': token }, body: JSON.stringify(body) });
  const managed = (token, url = '/mcp/v1/workspaces/test-111/employees', init = {}) => request(url, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers || {}) } });
  return { repo, device, request, bootstrap, managed, advance: ms => { clock += ms; }, close: () => new Promise(resolve => server.close(resolve)) };
}

test('paired device acquires one workspace management credential without static MCP configuration', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.bootstrap('test-111', '')).status, 401);
    assert.equal((await f.bootstrap('test-111', 'global-a2a-token')).status, 401);
    assert.equal((await f.bootstrap('other')).status, 401);
    const response = await f.bootstrap('test-111', f.device.deviceToken, { workspace: '*', actorRole: 'owner', deviceId: 'other' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const credential = await response.json();
    assert.equal(credential.workspace, 'test-111');
    assert.equal(credential.deviceId, f.device.deviceId);
    assert.equal(credential.audience, 'ziwei-management');
    assert.equal(credential.managed, true);
    assert.equal((await f.managed(credential.token)).status, 200);
    assert.equal((await f.managed(f.device.deviceToken)).status, 401);
    assert.equal((await f.managed(credential.token, '/mcp/v1/workspaces/other/employees')).status, 403);
    assert.equal((await f.managed(credential.token + 'x')).status, 401);
    f.advance(60 * 60 * 1000 + 1);
    assert.equal((await f.managed(credential.token)).status, 401);
  } finally { await f.close(); }
});

test('management credential stops working immediately after device revocation or disable', async () => {
  const f = await fixture();
  try {
    const credential = await (await f.bootstrap()).json();
    f.repo.db.prepare('UPDATE device_credentials SET revoked_at=? WHERE device_id=?').run(new Date().toISOString(), f.device.deviceId);
    assert.equal((await f.managed(credential.token)).status, 401);
    f.repo.db.prepare('UPDATE device_credentials SET revoked_at=NULL WHERE device_id=?').run(f.device.deviceId);
    f.repo.setDeviceStatus(f.device.deviceId, 'disabled');
    assert.equal((await f.managed(credential.token)).status, 401);
    assert.equal((await f.bootstrap()).status, 401);
  } finally { await f.close(); }
});

test('default management preparation permits employee save and reports actual pending device state', async () => {
  const f = await fixture();
  try {
    const credential = await (await f.bootstrap()).json();
    const created = await f.managed(credential.token, '/mcp/v1/workspaces/test-111/employees', { method: 'POST', body: JSON.stringify({ name: '默认管理员工', runtime: 'Hermes', runtimeProfile: 'default', targetDeviceId: f.device.deviceId, managementMcpEnabled: false, actorRole: 'owner' }) });
    assert.equal(created.status, 201, await created.clone().text());
    const employee = await created.json();
    assert.equal(employee.management_mcp_enabled, true);
    const status = await (await f.request('/api/workspaces/test-111/mcp/status')).json();
    assert.equal(status.managed, true);
    assert.equal(status.default_enabled, true);
    assert.equal(status.scope_allowed, true);
    assert.ok(status.connections.some(row => row.device_id === f.device.deviceId && row.state !== 'ready'));
    assert.equal(status.employees.find(row => row.employee_id === employee.id).receipt.loaded, false);
    assert.equal(JSON.stringify(status).includes(credential.token), false);
    assert.equal(JSON.stringify(status).includes(f.device.deviceToken), false);
  } finally { await f.close(); }
});

test('management device credentials derive membership on every request and cannot read another member personal employee', async () => {
  const f = await fixture();
  try {
    const db = f.repo.db;
    const workspace = f.repo.getWorkspace('test-111');
    db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run('member_manage_qa', workspace.id, 'user_manage_qa', '普通成员', 'manage-qa@example.test', 'member', new Date().toISOString());
    db.prepare('UPDATE devices SET owner_user_id=? WHERE id=?').run('user_manage_qa', f.device.deviceId);
    const privateEmployee = f.repo.createEmployee('test-111', { name: '其他成员私人', visibility: 'personal', ownerUserId: 'user_other' });
    const credential = await (await f.bootstrap()).json();
    const rows = await (await f.managed(credential.token)).json();
    assert.equal(rows.employees.some(row => row.id === privateEmployee.id), false);
    assert.equal((await f.managed(credential.token, `/mcp/v1/workspaces/test-111/employees/${privateEmployee.id}`)).status, 404);
    db.prepare('DELETE FROM members WHERE id=?').run('member_manage_qa');
    assert.equal((await f.managed(credential.token)).status, 403);
  } finally { await f.close(); }
});
