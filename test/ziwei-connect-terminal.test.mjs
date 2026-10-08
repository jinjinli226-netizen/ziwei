import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../backend/app.mjs';
import { createRepository } from '../backend/repository.mjs';
import { createZiweiConnect } from '../backend/ziwei-connect.mjs';

async function fixture(t, options = {}) {
  const calls = [];
  const state = { handler: options.handler };
  const upstream = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const call = { method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null };
    calls.push(call);
    const reply = await state.handler?.(call) || { status: 200, body: { devices: [] } };
    res.writeHead(reply.status || 200, { 'content-type': 'application/json', ...reply.headers });
    if (reply.bodyDelayMs) {
      res.flushHeaders();
      await new Promise(resolve => setTimeout(resolve, reply.bodyDelayMs));
    }
    res.end(JSON.stringify(reply.body));
  });
  upstream.listen(0, '127.0.0.1');
  await new Promise(resolve => upstream.once('listening', resolve));
  const apiBase = `http://127.0.0.1:${upstream.address().port}/api`;
  const repository = createRepository({ memory: true });
  const app = createApp({ repository, ziweiConnectApiBase: apiBase, ...options.appOptions });
  const owner = app.locals.auth.setup({ email: 'terminal-owner@example.test', password: 'main-test-password', name: 'Owner' });
  app.locals.auth.createWorkspace(owner.user_id, { slug: 'phone-qa', name: 'Phone QA', kind: 'team' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const cookie = `ziwei_session=${owner.session.token}`;
  const terminal = '/api/workspaces/phone-qa/ziwei-connect/terminal';
  const request = (suffix = '/android-devices', init = {}) => fetch(`${base}${terminal}${suffix}`, {
    ...init, headers: { 'content-type': 'application/json', cookie, ...init.headers },
  });
  t.after(async () => {
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => upstream.close(resolve))]);
    repository.db.close();
  });
  return { request, app, repository, calls, state, base, cookie, terminal, owner, apiBase };
}

test('terminal management requires a main-site session and workspace Owner/Admin, without requiring an employee binding', async t => {
  const fx = await fixture(t);
  assert.equal((await fx.request('/android-devices', { headers: { cookie: '' } })).status, 401);
  assert.equal((await fetch(`${fx.base}/api/workspaces/test-111/ziwei-connect/terminal/android-devices`, { headers: { cookie: fx.cookie } })).status, 403);
  assert.equal((await fx.request()).status, 200);
  fx.repository.db.prepare("UPDATE members SET role='admin' WHERE user_id=?").run(fx.owner.user_id);
  assert.equal((await fx.request('/android-devices/enrollment-requests')).status, 200);
  fx.repository.db.prepare("UPDATE members SET role='member' WHERE user_id=?").run(fx.owner.user_id);
  assert.equal((await fx.request('/android-devices', { headers: { 'x-workspace-role': 'owner' } })).status, 403);
  assert.equal((await fx.request('/android-devices/enrollment-requests/request-1/approve', { method: 'POST', body: '{}' })).status, 403);
  assert.equal(fx.calls.length, 2);
});

test('terminal enrollment forwards pending, approval, rejection, and expired/conflict responses with their original structure', async t => {
  const fx = await fixture(t, { handler(call) {
    if (call.url.endsWith('/enrollment-requests')) return { body: { requests: [{ id: 'request-1', role: 'agent', alias: '手机一', status: 'pending' }] } };
    if (call.url.endsWith('/request-1/approve')) return { body: { request: { id: 'request-1', status: 'approved' }, device: { id: 'phone-1', nodes: [] } } };
    if (call.url.endsWith('/request-2/reject')) return { body: { request: { id: 'request-2', status: 'rejected' } } };
    return { status: 409, body: { message: '入网申请已过期', code: 'enrollment_expired', details: { status: 'expired' } } };
  } });
  const pending = await (await fx.request('/android-devices/enrollment-requests')).json();
  assert.equal(pending.requests[0].role, 'agent');
  const approved = await fx.request('/android-devices/enrollment-requests/request-1/approve', { method: 'POST', body: '{}' });
  assert.equal(approved.status, 200);
  assert.deepEqual(await approved.json(), { request: { id: 'request-1', status: 'approved' }, device: { id: 'phone-1', nodes: [] } });
  const rejected = await fx.request('/android-devices/enrollment-requests/request-2/reject', { method: 'POST', body: '{}' });
  assert.equal((await rejected.json()).request.status, 'rejected');
  const expired = await fx.request('/android-devices/enrollment-requests/expired/approve', { method: 'POST', body: '{}' });
  assert.equal(expired.status, 409);
  assert.deepEqual(await expired.json(), { message: '入网申请已过期', code: 'enrollment_expired', details: { status: 'expired' } });
});

test('terminal proxies the original device routes and receipts, including manual credentials and a 2 MiB screenshot', async t => {
  const screenshot = Buffer.alloc(2 * 1024 * 1024, 1).toString('base64');
  const fx = await fixture(t, { handler(call) {
    if (call.url.endsWith('/snapshot')) return { body: { deviceId: 'phone-1', snapshot: { data: screenshot, width: 1080, height: 2400 } } };
    if (call.method === 'POST' && call.url === '/api/android-devices') return { status: 201, body: { device: { id: 'phone-1' }, tokens: { agent: 'manual-agent-config', updater: 'manual-updater-config' } } };
    return { status: call.method === 'POST' ? 201 : 200, body: { device: { id: 'phone-1' }, command: { id: 'command-1', status: 'uncertain' }, update: { id: 'update-1', status: 'planned' } } };
  } });
  const routes = [
    ['/android-devices?summary=1'], ['/android-devices/phone-1'],
    ['/android-devices/phone-1/status?commandId=command-1&updateId=update-1'],
    ['/android-devices', { alias: '备选登记' }],
    ['/android-devices/phone-1/control', { role: null }],
    ...['health', 'screenshot', 'tap', 'swipe', 'text', 'global', 'launch'].map(action => ['/android-devices/phone-1/commands', { action, args: {} }]),
    ['/android-devices/phone-1/commands/command-1/resolve', { resolution: 'acknowledged', note: '已核实手机屏幕' }],
    ['/android-devices/phone-1/updates', { targetRole: 'agent', apkUrl: 'https://qzelynth.top/downloads/android/agent.apk', versionCode: 16 }],
    ['/android-devices/phone-1/updates/update-1/resolve', { resolution: 'cancel' }],
    ['/android-devices/phone-1/archive', { confirm: true }],
  ];
  for (const [route, body] of routes) {
    const response = await fx.request(route, body ? { method: 'POST', body: JSON.stringify(body) } : {});
    assert.equal(response.status, body ? 201 : 200, route);
    const payload = await response.json();
    if (route === '/android-devices' && body) assert.equal(payload.tokens.agent, 'manual-agent-config');
  }
  assert.equal((await (await fx.request('/android-devices/phone-1/snapshot')).json()).snapshot.data, screenshot);
  assert.ok(fx.calls.some(call => call.url.includes('commandId=command-1&updateId=update-1')));
});

test('terminal allowlist blocks unrelated APIs, redirects, invalid paths/actions, and oversized writes before forwarding', async t => {
  const fx = await fixture(t);
  const invalid = [
    ['/admin-auth/login', { username: 'ignored', password: 'ignored' }],
    ['/device/v1/enrollment/requests', {}],
    ['/android-devices/phone-1/commands', { action: 'shell', args: { command: 'ignored' } }],
    ['/android-devices/phone-1/commands', { action: 'tap', args: {}, endpoint: 'http://other.test' }],
    ['/android-devices/phone-1/%2e%2e%2fadmin-auth'],
    ['/android-devices?url=http%3A%2F%2Fother.test'],
    ['/android-devices/phone-1/status?commandId=command-1&commandId=command-2'],
    ['/android-devices/phone-1/control', { role: 'agent', data: 'a'.repeat(65536) }],
  ];
  for (const [route, body] of invalid) {
    const response = await fx.request(route, body ? { method: 'POST', body: JSON.stringify(body) } : {});
    assert.ok([400, 404, 413].includes(response.status), `${route}: ${response.status}`);
  }
  assert.equal((await fx.request('/android-devices', { method: 'DELETE' })).status, 405);
  assert.equal(fx.calls.length, 0);
  fx.state.handler = () => ({ status: 302, headers: { location: 'http://127.0.0.1:1/secret' }, body: {} });
  assert.equal((await fx.request()).status, 502);
  assert.equal(fx.calls.length, 1);
});

test('terminal authenticates upstream once, refreshes expired upstream sessions, and never forwards browser secrets or upstream cookies', async t => {
  let logins = 0;
  let invalidated = false;
  const sourcePassword = 'source-private-password-123';
  const fx = await fixture(t, { appOptions: {
    ziweiConnectUsername: 'bridge', ziweiConnectPassword: sourcePassword, ziweiConnectOrigin: 'https://qzelynth.top',
  }, handler(call) {
    if (call.url === '/api/admin-auth/login') {
      logins += 1;
      assert.deepEqual(call.body, { username: 'bridge', password: sourcePassword });
      assert.equal(call.headers.origin, 'https://qzelynth.top');
      return { body: { authenticated: true }, headers: { 'set-cookie': `__Host-ziwei_session=source-session-${logins}; Path=/; Secure; HttpOnly` } };
    }
    assert.notEqual(call.headers.cookie, fx.cookie);
    assert.equal(call.headers.authorization, undefined);
    assert.equal(call.headers['x-ziwei-session'], undefined);
    assert.equal(call.headers.origin, undefined); // loopback management has its own Origin whitelist
    if (invalidated && call.headers.cookie === '__Host-ziwei_session=source-session-1') return { status: 401, body: { message: 'expired' } };
    return { body: { devices: [] }, headers: { 'set-cookie': '__Host-ziwei_session=must-not-reach-browser' } };
  } });
  const init = { headers: { authorization: 'Bearer browser-only-secret', 'x-ziwei-session': 'browser-session-secret', origin: 'https://evil.test' } };
  const first = await fx.request('/android-devices', init);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('set-cookie'), null);
  assert.equal(logins, 1);
  assert.equal((await fx.request()).status, 200);
  assert.equal(logins, 1);
  invalidated = true;
  assert.equal((await fx.request()).status, 200);
  assert.equal(logins, 2);
  fx.state.handler = () => ({ status: 409, body: { message: `upstream leaked ${sourcePassword}`, debug: '__Host-ziwei_session=source-session-2' } });
  const error = await fx.request();
  assert.equal(error.status, 409);
  const body = await error.text();
  assert.ok(!body.includes(sourcePassword));
  assert.ok(!body.includes('source-session-2'));
});

test('terminal accepts a private plaintext credential file and rejects the source password-hash file without leaking its contents', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'ziwei-terminal-credentials-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const credentialsFile = path.join(directory, 'bridge.json');
  writeFileSync(credentialsFile, JSON.stringify({ username: 'bridge', password: 'file-private-password' }), { mode: 0o600 });
  const fx = await fixture(t, { appOptions: { ziweiConnectCredentialsFile: credentialsFile }, handler(call) {
    if (call.url === '/api/admin-auth/login') return { body: { authenticated: true }, headers: { 'set-cookie': '__Host-ziwei_session=file-session; Path=/; Secure; HttpOnly' } };
    return { body: { devices: [] } };
  } });
  assert.equal((await fx.request()).status, 200);
  assert.equal(fx.calls[0].body.password, 'file-private-password');
  const hashFile = path.join(directory, 'hash.json');
  writeFileSync(hashFile, JSON.stringify({ username: 'bridge', passwordHash: 'not-a-login-password', salt: 'private-salt' }), { mode: 0o600 });
  const blocked = await fixture(t, { appOptions: { ziweiConnectCredentialsFile: hashFile } });
  const response = await blocked.request();
  assert.equal(response.status, 503);
  const body = await response.text();
  assert.ok(!body.includes('private-salt'));
  assert.ok(!body.includes(hashFile));
  assert.equal(blocked.calls.length, 0);
});

test('deleting employee bindings scopes the binding to its workspace and retains execution history', async t => {
  const fx = await fixture(t, { handler: () => ({ body: { devices: [{ id: 'phone-1', alias: '手机一', nodes: [] }] } }) });
  const employee = fx.repository.createEmployee('phone-qa', { name: '独立员工' });
  const binding = await fx.app.locals.ziweiConnect.bind('phone-qa', { employeeId: employee.id, deviceId: 'phone-1', accountId: 'account-1' });
  const run = await fx.app.locals.ziweiConnect.run('phone-qa', { employeeId: employee.id, action: 'dry-run' });
  fx.app.locals.auth.createWorkspace(fx.owner.user_id, { slug: 'other-qa', name: 'Other QA' });
  const wrong = await fetch(`${fx.base}/api/workspaces/other-qa/ziwei-connect/bindings/${binding.id}`, { method: 'DELETE', headers: { cookie: fx.cookie } });
  assert.equal(wrong.status, 404);
  const deleted = await fetch(`${fx.base}/api/workspaces/phone-qa/ziwei-connect/bindings/${binding.id}`, { method: 'DELETE', headers: { cookie: fx.cookie } });
  assert.equal(deleted.status, 200);
  assert.equal((await deleted.json()).deleted, true);
  assert.equal(fx.app.locals.ziweiConnect.listBindings('phone-qa').length, 0);
  assert.equal(fx.app.locals.ziweiConnect.listRuns('phone-qa')[0].id, run.id);
  assert.equal((await fetch(`${fx.base}/api/workspaces/phone-qa/ziwei-connect/bindings/${binding.id}`, { method: 'DELETE', headers: { cookie: fx.cookie } })).status, 404);
});

test('terminal source is server-configured, validates its origin, and never follows a caller supplied address', async t => {
  const fx = await fixture(t);
  for (const apiBase of ['not-a-url', 'http://remote.example.test/api', 'https://admin:private-password@example.test/api', 'https://example.test/api?key=private', 'https://example.test/other', 'file:///api']) {
    assert.throws(() => createZiweiConnect(fx.repository, { apiBase }), error => error.status === 503 && !error.message.includes('private'));
  }
  const response = await fx.request('/android-devices', { headers: { 'x-forwarded-host': 'malicious.test', 'x-api-base': 'http://malicious.test/api' } });
  assert.equal(response.status, 200);
  assert.equal(fx.calls[0].headers['x-api-base'], undefined);
  assert.equal(fx.calls[0].headers['x-forwarded-host'], undefined);
  assert.equal(fx.calls[0].headers.host, new URL(fx.apiBase).host);
});

test('terminal does not replay mutations after uncertainty, upstream failure, or response timeout', async t => {
  const fx = await fixture(t, { appOptions: { ziweiConnectTimeoutMs: 40 } });
  const action = () => fx.request('/android-devices/phone-1/commands', { method: 'POST', body: JSON.stringify({ action: 'tap', args: { x: 1, y: 2 } }) });
  fx.state.handler = () => ({ body: { command: { id: 'command-1', status: 'uncertain' } } });
  assert.equal((await (await action()).json()).command.status, 'uncertain');
  assert.equal(fx.calls.length, 1);
  fx.state.handler = () => ({ status: 503, body: { message: '手机暂不可用', retryable: false } });
  const failed = await action();
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { message: '手机暂不可用', retryable: false });
  assert.equal(fx.calls.length, 2);
  fx.state.handler = async () => {
    await new Promise(resolve => setTimeout(resolve, 100));
    return { body: { command: { id: 'late-command', status: 'queued' } } };
  };
  assert.equal((await action()).status, 502);
  assert.equal(fx.calls.length, 3);
  fx.state.handler = () => ({ bodyDelayMs: 100, body: { command: { id: 'late-body', status: 'queued' } } });
  assert.equal((await action()).status, 502);
  assert.equal(fx.calls.length, 4);
});

test('main run receipts preserve executing/delivered and follow source uncertain to manually acknowledged without replay', async t => {
  let commandStatus = 'executing';
  let resolutionNote;
  const fx = await fixture(t, { handler(call) {
    if (call.url === '/api/android-devices?summary=1') return { body: { devices: [{ id: 'phone-1', alias: '手机一', nodes: [] }] } };
    if (call.url.endsWith('/commands/command-1/resolve')) {
      commandStatus = 'acknowledged';
      resolutionNote = call.body.note;
      return { body: { command: { id: 'command-1', status: commandStatus, resolutionNote } } };
    }
    if (call.url.endsWith('/commands')) return { status: 201, body: { command: { id: 'command-1', status: 'queued' } } };
    return { body: { device: { id: 'phone-1', commands: [{ id: 'command-1', status: commandStatus, resolutionNote }] } } };
  } });
  const employee = fx.repository.createEmployee('phone-qa', { name: '回执员工' });
  await fx.app.locals.ziweiConnect.bind('phone-qa', { employeeId: employee.id, deviceId: 'phone-1' });
  const run = await fx.app.locals.ziweiConnect.run('phone-qa', { employeeId: employee.id, action: 'health' });
  assert.equal(run.status, 'executing');
  commandStatus = 'delivered';
  assert.equal((await fx.app.locals.ziweiConnect.refresh('phone-qa', run.id)).status, 'delivered');
  commandStatus = 'uncertain';
  assert.equal((await fx.app.locals.ziweiConnect.refresh('phone-qa', run.id)).status, 'uncertain');
  const resolved = await fx.request('/android-devices/phone-1/commands/command-1/resolve', { method: 'POST', body: JSON.stringify({ resolution: 'acknowledged', note: '已经检查手机实际结果' }) });
  assert.equal(resolved.status, 200);
  const refreshed = await fetch(`${fx.base}/api/workspaces/phone-qa/ziwei-connect/runs/${run.id}`, { headers: { cookie: fx.cookie } });
  const acknowledged = await refreshed.json();
  assert.equal(acknowledged.status, 'acknowledged');
  assert.equal(acknowledged.result.command.resolutionNote, '已经检查手机实际结果');
  assert.equal(fx.app.locals.ziweiConnect.listRuns('phone-qa')[0].status, 'acknowledged');
  const callsAtSettlement = fx.calls.length;
  assert.equal((await fx.app.locals.ziweiConnect.refresh('phone-qa', run.id)).status, 'acknowledged');
  assert.equal(fx.calls.length, callsAtSettlement);
  assert.equal(fx.calls.filter(call => call.method === 'POST' && call.url.endsWith('/commands')).length, 1);
});
