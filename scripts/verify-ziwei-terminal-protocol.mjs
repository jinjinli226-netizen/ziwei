// Isolated integration of the real source controller and main-site session API.
// No production endpoints, credentials, daemon, or physical phones are used.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../backend/app.mjs';
import { createRepository } from '../backend/repository.mjs';

const sourceRoot = process.argv[2] || process.env.ZIWEI_CONTROL_SOURCE;
if (!sourceRoot) throw new Error('Pass the original controller source directory as the first argument.');
const root = resolve(import.meta.dirname, '..');
mkdirSync(resolve(root, '.local/terminal-protocol-evidence'), { recursive: true });
const dir = mkdtempSync(resolve(root, '.local/terminal-protocol-evidence/run-'));
const source = spawn(process.execPath, ['server/index.mjs'], {
  cwd: resolve(sourceRoot), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, CONTROL_API_MODE: '', CONTROL_API_PORT: '0', CONTROL_DATA_DIR: resolve(dir, 'data'), CONTROL_LOGS_DIR: resolve(dir, 'logs'), CONTROL_ANDROID_HEARTBEAT_TIMEOUT_MS: '5000' },
});
let sourceOutput = '', server;
source.stdout.on('data', chunk => { sourceOutput += chunk; });
source.stderr.on('data', chunk => { sourceOutput += chunk; });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const evidence = { isolated: true, realController: true, realMainSession: true, realPhone: false, checks: [] };
const pass = name => evidence.checks.push(name);
try {
  let start;
  for (let i = 0; i < 150; i++) {
    if (source.exitCode !== null) throw new Error(`Isolated controller exited: ${sourceOutput.slice(-1500)}`);
    start = sourceOutput.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }).find(item => item.event === 'server_start');
    if (start) break;
    await delay(30);
  }
  assert.ok(start?.port, 'isolated controller started on an ephemeral port');
  const upstream = `http://127.0.0.1:${start.port}/api`;
  const app = createApp({ repository: createRepository({ memory: true }), requireAuth: true, enableScheduler: false, ziweiConnectApiBase: upstream });
  server = app.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  async function req(url, body, cookie = '', token = '') {
    const response = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000),
    });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const setup = await req(`${base}/api/auth/setup`, { name: 'Isolated owner', email: 'terminal-owner@example.test', password: 'fixture-password-2026' });
  assert.equal(setup.status, 201);
  const cookie = setup.cookie;
  const created = await req(`${base}/api/workspaces`, { name: 'Isolated phone workspace', slug: 'fixture-phone', kind: 'team' }, cookie);
  assert.equal(created.status, 201);
  const ws = created.data.workspace.slug;
  const prefix = `${base}/api/workspaces/${encodeURIComponent(ws)}/ziwei-connect`;
  const terminal = `${prefix}/terminal/android-devices`;
  assert.equal((await req(terminal)).status, 401);
  pass('unauthenticated access rejected; normal main-site owner cookie accepted');

  const common = { alias: 'Isolated approval phone', pairingId: 'fixture-pairing-approved-2026', versionCode: 15, versionName: '0.4.4' };
  const enroll = role => req(`${upstream}/device/v1/enrollment/requests`, { ...common, role, instanceId: `fixture-${role}` });
  const agent = await enroll('agent'), updater = await enroll('updater');
  assert.equal(agent.status, 201); assert.equal(updater.status, 201);
  const pending = await req(`${terminal}/enrollment-requests`, undefined, cookie);
  assert.equal(pending.status, 200); assert.equal(pending.data.requests.length, 2);
  assert.equal(JSON.stringify(pending.data).includes('zwi_device_'), false);
  const approved = await req(`${terminal}/enrollment-requests/${agent.data.requestId}/approve`, {}, cookie);
  assert.equal(approved.status, 200); assert.equal(approved.data.request.status, 'approved');
  const deviceId = approved.data.device.id;
  const delivered = {};
  for (const [role, item] of [['agent', agent], ['updater', updater]]) {
    const status = await req(`${upstream}/device/v1/enrollment/status`, { requestId: item.data.requestId, requestSecret: item.data.requestSecret });
    assert.equal(status.data.status, 'approved'); assert.equal(status.data.deviceId, deviceId);
    assert.ok(/^zwi_device_/.test(status.data.token));
    delivered[role] = status.data.token;
    const session = await req(`${upstream}/device/v1/sessions`, { instanceId: `fixture-${role}`, versionCode: 15, versionName: '0.4.4' }, '', status.data.token);
    assert.equal(session.status, 200); assert.equal(session.data.deviceId, deviceId);
  }
  assert.ok(delivered.agent !== delivered.updater);
  const repeated = await req(`${terminal}/enrollment-requests/${agent.data.requestId}/approve`, {}, cookie);
  assert.equal(repeated.data.device.id, deviceId);
  assert.equal((await req(terminal, undefined, cookie)).data.devices.length, 1);
  assert.equal((await req(`${terminal}/enrollment-requests`, undefined, cookie)).data.requests.length, 0);
  pass('approval reuses pairing_hash: two distinct role credentials, one phone, repeat approval creates no duplicate');

  const rejected = await req(`${upstream}/device/v1/enrollment/requests`, { ...common, pairingId: 'fixture-pairing-rejected-2026', role: 'agent', instanceId: 'fixture-rejected' });
  const rejection = await req(`${terminal}/enrollment-requests/${rejected.data.requestId}/reject`, {}, cookie);
  assert.equal(rejection.status, 200); assert.equal(rejection.data.request.status, 'rejected');
  assert.equal((await req(`${upstream}/device/v1/enrollment/status`, { requestId: rejected.data.requestId, requestSecret: rejected.data.requestSecret })).data.status, 'rejected');
  pass('rejection propagates to the device enrollment polling protocol');

  const expired = await req(`${upstream}/device/v1/enrollment/requests`, { ...common, pairingId: 'fixture-pairing-expired-2026', role: 'agent', instanceId: 'fixture-expired' });
  const fixtureDb = new DatabaseSync(resolve(dir, 'data/control-plane.sqlite'));
  fixtureDb.prepare('UPDATE android_enrollment_requests SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z', expired.data.requestId);
  fixtureDb.close();
  const expiredResult = await req(`${terminal}/enrollment-requests/${expired.data.requestId}/approve`, {}, cookie);
  assert.ok(expiredResult.status === 409 || expiredResult.data.request?.status === 'expired');
  assert.equal((await req(terminal, undefined, cookie)).data.devices.length, 1);
  assert.equal((await req(`${terminal}/enrollment-requests/nonexistent/approve`, {}, cookie)).status, 404);
  pass('expired and missing approval return explicit failures and create no phone');

  const manual = await req(terminal, { alias: 'Isolated manual fallback' }, cookie);
  assert.equal(manual.status, 201); assert.ok(manual.data.tokens.agent && manual.data.tokens.updater);
  const detail = await req(`${terminal}/${manual.data.device.id}`, undefined, cookie);
  assert.equal(detail.status, 200); assert.equal(JSON.stringify(detail.data).includes(manual.data.tokens.agent), false);
  const archive = await req(`${terminal}/${manual.data.device.id}/archive`, { confirm: true }, cookie);
  assert.equal(archive.status, 200); assert.equal((await req(terminal, undefined, cookie)).data.devices.length, 1);
  pass('manual registration returns one-time configs; normal detail hides tokens; archive preserves original source behavior');

  const employee = await req(`${base}/api/workspaces/${ws}/employees`, { name: 'Existing employee', runtime: 'hermes' }, cookie);
  assert.equal(employee.status, 201);
  const binding = await req(`${prefix}/bindings`, { employeeId: employee.data.id, deviceId, accountId: 'fixture-account', accountLabel: 'Fixture account' }, cookie);
  assert.equal(binding.status, 201);
  const removed = await fetch(`${prefix}/bindings/${binding.data.id}`, { method: 'DELETE', headers: { cookie } });
  assert.ok(removed.ok); assert.equal((await req(`${prefix}/bindings`, undefined, cookie)).data.bindings?.length ?? (await req(`${prefix}/bindings`, undefined, cookie)).data.length, 0);
  assert.equal((await req(terminal, undefined, cookie)).data.devices.length, 1);
  pass('existing main-site employee/account binds and unbinds without deleting source phone');

  evidence.ok = true;
  evidence.observedAt = new Date().toISOString();
  writeFileSync(resolve(dir, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ ...evidence, evidenceDirectory: dir }, null, 2));
} finally {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  if (source.exitCode === null) { const exited = once(source, 'exit'); source.kill(); await exited; }
}
