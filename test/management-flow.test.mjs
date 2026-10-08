import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../backend/app.mjs';

const headers = { authorization: 'Bearer flow-token', 'content-type': 'application/json' };
async function fixture(t) {
  const app = createApp({ memory: true, enableScheduler: false, mcpOptions: { token: 'flow-token', workspaces: ['test-111'] } });
  const server = app.listen(0); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const repo = app.locals.repo;
  repo.heartbeatDevice('test-111', { deviceId: 'builder-pc', managementMcp: { configured: true, workspace: 'test-111', supportedRuntimes: ['Codex', 'Hermes'] }, runtimes: {
    Codex: { version: '1.2', binary: 'codex', status: 'available', profiles: [{ name: 'default' }, { name: 'qa-codex-profile', readiness: { ready: true } }], readiness: { authentication: 'configured', provider: 'configured' } },
    Hermes: { version: '2.3', binary: 'hermes', status: 'available', readiness: { authentication: 'configured', provider: 'configured' }, profiles: [{ name: 'default', provider_configured: true, authentication_configured: true }, { name: 'qa-independent', provider_configured: true, authentication_configured: true }] }
  } });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, body, method = body ? 'POST' : 'GET') => {
    const response = await fetch(`${base}/mcp/v1/workspaces/test-111${route}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  return { repo, base, request };
}

test('management discovery uses only the selected workspace device heartbeat', async t => {
  const { repo, request } = await fixture(t);
  repo.heartbeatDevice('test-111', { deviceId: 'other-pc', runtimes: { Hermes: { status: 'unavailable', profiles: [{ name: 'other-only' }] } } });
  const result = await request('/discovery');
  assert.equal(result.status, 200);
  assert.equal(result.body.source, 'device_heartbeat');
  const device = result.body.devices.find(item => item.id === 'builder-pc');
  assert.deepEqual(device.runtimes.map(item => item.name), ['Codex', 'Hermes']);
  assert.deepEqual(device.runtimes.find(item => item.name === 'Hermes').profiles.map(item => item.name), ['default', 'qa-independent']);
  assert.equal(device.runtimes.find(item => item.name === 'Codex').readiness.authentication, 'configured');
});

test('MCP creates exact runtime, persona, skills and target; repeated requests return one employee', async t => {
  const { repo, request } = await fixture(t);
  const input = { name: 'QA Codex', runtime: 'Codex', targetDeviceId: 'builder-pc', description: '检查证据', persona: '严谨耐心', instructions: '只读验证', skills: ['skill-code'], managementMcpEnabled: true, idempotencyKey: 'qa-codex' };
  const first = await request('/employees', input);
  assert.equal(first.status, 201);
  assert.equal(first.body.runtime, 'Codex'); assert.equal(first.body.persona, input.persona);
  assert.equal(first.body.target_device_id, 'builder-pc'); assert.equal(first.body.management_mcp_enabled, true);
  const retry = await request('/employees', input);
  assert.equal(retry.status, 200); assert.equal(retry.body.id, first.body.id); assert.equal(retry.body.duplicate, true);
  const conflict = await request('/employees', { ...input, name: 'Different intent' });
  assert.equal(conflict.status, 409);
  assert.equal(repo.listEmployees('test-111').filter(item => item.name === input.name).length, 1);
  const read = await request(`/employees/${first.body.id}`); assert.equal(read.body.id, first.body.id);
});

test('MCP creation reports offline, unavailable CLI, authentication and missing profile without fallback', async t => {
  const { repo, request } = await fixture(t);
  const base = { name: 'QA rejected', runtime: 'Codex', targetDeviceId: 'builder-pc' };
  const missingDevice = await request('/employees', { ...base, targetDeviceId: 'not-this-workspace' });
  assert.equal(missingDevice.status, 400); assert.match(missingDevice.body.error, /当前工作区/);
  repo.db.prepare('UPDATE devices SET last_seen=? WHERE id=?').run('2000-01-01T00:00:00.000Z', 'builder-pc');
  assert.match((await request('/employees', base)).body.error, /离线/);
  repo.heartbeatDevice('test-111', { deviceId: 'builder-pc', runtimes: { Codex: { status: 'unavailable' } } });
  assert.match((await request('/employees', base)).body.error, /CLI/);
  repo.heartbeatDevice('test-111', { deviceId: 'builder-pc', runtimes: { Codex: { status: 'available', readiness: { authentication: 'missing' } } } });
  assert.match((await request('/employees', base)).body.error, /认证/);
  assert.match((await request('/employees', { ...base, runtime: 'Hermes', runtimeProfile: 'typo' })).body.error, /profile.*不存在/);
  assert.equal(repo.listEmployees('test-111').some(item => item.name === base.name), false);
});

test('MCP prepares independent Hermes profile, schedules idempotent trial and reads exact terminal result', async t => {
  const { repo, base, request } = await fixture(t);
  const profile = await request('/hermes/profiles/requests', { profile: 'qa-new', deviceId: 'builder-pc', soul: '# QA', idempotencyKey: 'qa-profile' });
  assert.equal(profile.status, 202); assert.equal(profile.body.type, 'hermes.profile.create');
  assert.equal((await request('/actions/' + profile.body.id)).body.status, 'pending');
  const created = await request('/employees', { name: 'QA Hermes', runtime: 'Hermes', runtimeProfile: 'qa-independent', targetDeviceId: 'builder-pc', managementMcpEnabled: true });
  assert.equal(created.status, 201);
  const input = { title: 'QA trial', employeeId: created.body.id, description: '回复 QA_OK；调用 ziwei_mcp_health', execute: true, idempotencyKey: 'trial-1' };
  const trial = await request('/tasks', input); assert.equal(trial.status, 201);
  const duplicate = await request('/tasks', input); assert.equal(duplicate.body.id, trial.body.id);
  const task = await request('/tasks/' + trial.body.id);
  assert.equal(task.body.execution.payload.runtime, 'Hermes'); assert.equal(task.body.execution.payload.profile, 'qa-independent');
  assert.equal(task.body.execution.payload.deviceId, 'builder-pc');
  assert.deepEqual(task.body.execution.payload.managementMcp, { enabled: true, workspace: 'test-111' });
  const actionId = task.body.execution.id;
  repo.resultA2AAction(actionId, { status: 'failed', error: 'profile provider unavailable', deviceId: 'builder-pc' });
  const result = await request('/tasks/' + trial.body.id);
  assert.equal(result.body.execution.status, 'failed'); assert.match(result.body.execution.error, /provider/);
  const status = await fetch(`${base}/api/workspaces/test-111/employees/${created.body.id}/mcp/status`).then(response => response.json());
  assert.ok(status.receipt, JSON.stringify(status));
  assert.equal(status.receipt.status, 'failed'); assert.equal(status.receipt.loaded, false);
});

test('browser creation shares idempotency and supports discovered Codex profiles without changing runtime', async t => {
  const { repo, base, request } = await fixture(t);
  const input = { name: 'QA browser employee', runtime: 'Codex', runtimeProfile: 'qa-codex-profile', targetDeviceId: 'builder-pc', persona: '谨慎', idempotencyKey: 'browser-1' };
  const post = () => fetch(`${base}/api/workspaces/test-111/employees`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  const first = await post(); assert.equal(first.status, 201); const saved = await first.json();
  const second = await post(); assert.equal(second.status, 200); assert.equal((await second.json()).id, saved.id);
  assert.equal(saved.runtime, 'Codex'); assert.equal(saved.runtime_profile, 'qa-codex-profile');
  assert.equal(repo.listEmployees('test-111').filter(item => item.name === input.name).length, 1);
  assert.equal((await request('/employees', { ...input, runtimeProfile: 'not-discovered', idempotencyKey: 'bad-profile' })).body.code, 'PROFILE_NOT_FOUND');
  assert.equal((await request('/employees', { ...input, runtime: 'Hermes', runtimeProfile: 'default', managementMcpEnabled: true, idempotencyKey: 'bad-main' })).body.code, 'INDEPENDENT_PROFILE_REQUIRED');
});

test('independent Hermes readiness is authoritative and profile retries reject changed intent', async t => {
  const { repo, request } = await fixture(t);
  repo.registerRuntimes('test-111', { deviceId: 'builder-pc', runtimes: { Hermes: { status: 'available', readiness: { authentication: 'missing', provider: 'missing', ready: false }, profiles: [{ name: 'isolated-ready', provider_configured: true, authentication_configured: true, readiness: { ready: true } }, { name: 'isolated-no-provider', provider_configured: false }] } } });
  const created = await request('/employees', { name: 'QA independent configured', runtime: 'Hermes', targetDeviceId: 'builder-pc', runtimeProfile: 'isolated-ready' });
  assert.equal(created.status, 201);
  const rejected = await request('/employees', { name: 'QA no provider', runtime: 'Hermes', targetDeviceId: 'builder-pc', runtimeProfile: 'isolated-no-provider' });
  assert.equal(rejected.body.code, 'PROFILE_PROVIDER_MISSING');
  const profile = { profile: 'qa-safe-retry', deviceId: 'builder-pc', soul: '# A', idempotencyKey: 'profile-safe' };
  const one = await request('/hermes/profiles/requests', profile); assert.equal(one.status, 202);
  const retry = await request('/hermes/profiles/requests', profile); assert.equal(retry.status, 200); assert.equal(retry.body.id, one.body.id);
  assert.equal((await request('/hermes/profiles/requests', { ...profile, soul: '# B' })).status, 409);
});

test('employee MCP status separates actual handshake receipts from API health', async t => {
  const { repo, request } = await fixture(t);
  const employee = (await request('/employees', { name: 'QA evidence', runtime: 'Codex', targetDeviceId: 'builder-pc', managementMcpEnabled: true })).body;
  const trial = (await request('/tasks', { title: 'QA handshake', employeeId: employee.id, execute: true })).body;
  repo.resultA2AAction(trial.execution.id, { status: 'succeeded', result: { output: 'OK', managementMcp: { injected: true, loaded: true, toolCalls: [{ toolName: 'ziwei_discover_environment', ok: true }] } } });
  const status = await request(`/employees/${employee.id}/mcp/status`);
  assert.equal(status.body.receipt.status, 'loaded'); assert.equal(status.body.receipt.tool_calls[0].toolName, 'ziwei_discover_environment');
  const badTrial = (await request('/tasks', { title: 'QA missing receipt', employeeId: employee.id, execute: true })).body;
  repo.resultA2AAction(badTrial.execution.id, { status: 'succeeded', result: { output: 'CLI exit zero alone' } });
  const missing = await request(`/employees/${employee.id}/mcp/status`);
  assert.equal(missing.body.receipt.status, 'failed'); assert.equal(missing.body.receipt.loaded, false); assert.match(missing.body.receipt.error, /缺少/);
  const changed = await request(`/employees/${employee.id}`, { runtimeProfile: 'qa-codex-profile' }, 'PATCH'); assert.equal(changed.status, 200);
  const changedStatus = await request(`/employees/${employee.id}/mcp/status`);
  assert.equal(changedStatus.body.receipt.status, 'never_run'); assert.equal(changedStatus.body.receipt.loaded, false);
});

test('explicit null profile clears Hermes profile when switching runtime and legacy update validates selection', async t => {
  const { base, request } = await fixture(t);
  const created = (await request('/employees', { name: 'QA switch runtime', runtime: 'Hermes', targetDeviceId: 'builder-pc', runtimeProfile: 'qa-independent' })).body;
  const changed = await request(`/employees/${created.id}`, { runtime: 'Codex', runtimeProfile: null }, 'PATCH');
  assert.equal(changed.status, 200); assert.equal(changed.body.runtime, 'Codex'); assert.equal(changed.body.runtime_profile, null);
  const invalid = await fetch(`${base}/api/employees/${created.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runtime: 'MissingCLI' }) });
  assert.equal(invalid.status, 400); assert.equal((await invalid.json()).code, 'RUNTIME_NOT_DISCOVERED');
});
