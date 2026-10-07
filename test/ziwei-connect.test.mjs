import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../backend/app.mjs';

test('紫薇·互联连接入口 keeps device authority external and persists binding/run receipts', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    if (!String(url).startsWith('http://127.0.0.1:5199/')) return realFetch(url, init);
    const path = new URL(url).pathname;
    const query = new URL(url).searchParams;
    calls.push({ path, init });
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
    if (path.endsWith('/android-devices')) return json({ devices: [{ id: 'android-real-1', alias: '测试真机', nodes: [{ role: 'agent', status: 'online', lastSeen: new Date().toISOString() }] }] });
    if (path.endsWith('/commands')) return json({ command: { id: 'command-real-1', status: 'queued', action: 'health' } }, 201);
    if (path.endsWith('/status')) return json({ device: { id: 'android-real-1', commands: [{ id: query.get('commandId'), status: 'queued' }] } });
    throw new Error(`unexpected external call ${path}`);
  };
  const app = createApp({ memory: true, ziweiConnectApiBase: 'http://127.0.0.1:5199/api' });
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, options = {}) => realFetch(`${base}${path}`, { headers: { 'content-type': 'application/json' }, ...options });
  try {
    const employeeResponse = await request('/api/workspaces/test-111/employees', { method: 'POST', body: JSON.stringify({ name: '真机员工' }) });
    const employee = await employeeResponse.json();
    assert.equal(employeeResponse.status, 201);
    const status = await (await request('/api/workspaces/test-111/ziwei-connect/status')).json();
    assert.equal(status.source.product, '紫薇·互联');
    assert.equal(status.devices[0].id, 'android-real-1');
    const bindingResponse = await request('/api/workspaces/test-111/ziwei-connect/bindings', { method: 'POST', body: JSON.stringify({ employeeId: employee.id, deviceId: 'android-real-1', accountId: 'douyin-main' }) });
    assert.equal(bindingResponse.status, 201);
    const binding = await bindingResponse.json();
    assert.equal(binding.accountId, 'douyin-main');
    const dryRun = await (await request('/api/workspaces/test-111/ziwei-connect/actions', { method: 'POST', body: JSON.stringify({ employeeId: employee.id, action: 'dry-run' }) })).json();
    assert.equal(dryRun.run.status, 'dry_run');
    const actionResponse = await request('/api/workspaces/test-111/ziwei-connect/actions', { method: 'POST', body: JSON.stringify({ employeeId: employee.id, action: 'health' }) });
    assert.equal(actionResponse.status, 202);
    const action = await actionResponse.json();
    assert.equal(action.run.commandId, 'command-real-1');
    assert.equal(action.run.status, 'queued');
    assert.ok(calls.some(call => call.path.endsWith('/commands')));
    const notifications = await (await request('/api/workspaces/test-111/notifications')).json();
    assert.ok(notifications.notifications.some(item => item.action === 'ziwei_connect.run.queued'));
  } finally {
    server.close();
    globalThis.fetch = realFetch;
  }
});

test('remote 紫薇·互联 provider blocks unauthenticated access and forwards configured session', async () => {
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init = {}) => {
    seen.push({ url: String(url), headers: init.headers });
    return new Response(JSON.stringify({ devices: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const blocked = createApp({ memory: true, ziweiConnectApiBase: 'https://remote-ziwei.test/api' });
    const blockedServer = blocked.listen(0);
    await new Promise(resolve => blockedServer.once('listening', resolve));
    const blockedBase = `http://127.0.0.1:${blockedServer.address().port}`;
    const blockedResponse = await realFetch(`${blockedBase}/api/workspaces/test-111/ziwei-connect/status`);
    assert.equal(blockedResponse.status, 401);
    assert.match((await blockedResponse.json()).error, /需要认证/u);
    blockedServer.close();

    const authenticated = createApp({
      memory: true,
      ziweiConnectApiBase: 'https://remote-ziwei.test/api',
      ziweiConnectCookie: '__Host-ziwei_session=test-session',
      ziweiConnectOrigin: 'https://remote-ziwei.test',
    });
    const authenticatedServer = authenticated.listen(0);
    await new Promise(resolve => authenticatedServer.once('listening', resolve));
    const authenticatedBase = `http://127.0.0.1:${authenticatedServer.address().port}`;
    const response = await realFetch(`${authenticatedBase}/api/workspaces/test-111/ziwei-connect/status`);
    assert.equal(response.status, 200);
    assert.equal(seen.at(-1).headers.cookie, '__Host-ziwei_session=test-session');
    assert.equal(seen.at(-1).headers.origin, 'https://remote-ziwei.test');
    authenticatedServer.close();
  } finally {
    globalThis.fetch = realFetch;
  }
});
