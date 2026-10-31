import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../backend/repository.mjs';
import { createZiweiConnect,ZIWEI_CONNECT_RUN_TTL_MS } from '../backend/ziwei-connect.mjs';

async function fixture(t, action = 'health', options = {}) {
  const repo = createRepository({ memory: true });
  t.after(() => repo.db.close());
  const employee = repo.createEmployee('test-111', { name: 'Receipt refresh fixture' });
  const state = { commandStatus: 'queued', statusFailure: false, missingReceipt: false, snapshotFailure: false, submissions: 0, reads: 0, snapshots: 0 };
  state.snapshotQueries = [];
  state.snapshotResponse = { deviceId: 'phone-fixture', snapshot: { commandId: 'command-original', mime: 'image/png', data: 'fixture-image', capturedAt: null } };
  t.mock.method(globalThis, 'fetch', async url => {
    const endpoint = new URL(url);
    assert.equal(endpoint.origin, 'https://phone.invalid');
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
    if (endpoint.pathname.endsWith('/android-devices')) return reply({ devices: [{ id: 'phone-fixture', nodes: [] }] });
    if (endpoint.pathname.endsWith('/commands')) {
      state.submissions++;
      return reply({ command: { id: 'command-original', status: 'queued' } }, 201);
    }
    if (endpoint.pathname.endsWith('/status')) {
      state.reads++;
      assert.equal(endpoint.searchParams.get('commandId'), 'command-original');
      if (state.statusFailure) return reply({ message: 'Original receipt temporarily unavailable' }, 503);
      return reply({ device: { id: 'phone-fixture', commands: state.missingReceipt ? [] : [{ id: 'command-original', action, status: state.commandStatus }] } });
    }
    if (endpoint.pathname.endsWith('/snapshot')) {
      state.snapshots++;
      state.snapshotQueries.push(endpoint.searchParams.get('commandId'));
      if (state.snapshotFailure) return reply({ message: 'Image temporarily unavailable' }, 503);
      return reply(state.snapshotResponse);
    }
    assert.fail(`Unexpected endpoint: ${endpoint.pathname}`);
  });
  const connect = createZiweiConnect(repo, { apiBase: 'https://phone.invalid/api', cookie: 'fixture_session=only-test', ...options });
  await connect.bind('test-111', { employeeId: employee.id, deviceId: 'phone-fixture' });
  return { repo, employee, connect, state, run: (options = {}) => connect.run('test-111', { employeeId: employee.id, action }, options) };
}

test('a transient refresh error stays observable and recovers the original command without resubmission', async t => {
  const f = await fixture(t);
  const run = await f.run();
  f.state.statusFailure = true;
  const unavailable = await f.connect.refresh('test-111', run.id);
  assert.equal(unavailable.status, 'uncertain');
  assert.equal(unavailable.commandId, 'command-original');
  assert.match(unavailable.error, /Original receipt temporarily unavailable/);
  assert.equal(unavailable.result.command.id, 'command-original');
  f.state.statusFailure = false;
  f.state.commandStatus = 'succeeded';
  const recovered = await f.connect.refresh('test-111', run.id);
  assert.equal(recovered.status, 'succeeded');
  assert.equal(recovered.error, null);
  assert.equal(f.state.reads, 3);
  assert.equal(f.state.submissions, 1);
});

test('direct screenshot runs preserve a successful phone receipt when image delivery fails', async t => {
  const f = await fixture(t, 'screenshot');
  f.state.commandStatus = 'succeeded';
  f.state.snapshotFailure = true;
  const run = await f.run();
  assert.equal(run.status, 'succeeded');
  assert.equal(run.result.command.status, 'succeeded');
  assert.match(run.result.snapshotError, /Image temporarily unavailable/);
  assert.equal(run.error, null);
  assert.equal(f.state.submissions, 1);
});

test('refresh keeps screenshot success and can retry image delivery without repeating the action', async t => {
  const f = await fixture(t, 'screenshot');
  const run = await f.run();
  f.state.commandStatus = 'succeeded';
  f.state.snapshotFailure = true;
  const captured = await f.connect.refresh('test-111', run.id);
  assert.equal(captured.status, 'succeeded');
  assert.equal(captured.result.command.status, 'succeeded');
  assert.match(captured.result.snapshotError, /Image temporarily unavailable/);
  f.state.snapshotFailure = false;
  const delivered = await f.connect.refresh('test-111', run.id);
  assert.equal(delivered.status, 'succeeded');
  assert.equal(delivered.result.snapshot.data, 'fixture-image');
  assert.equal(delivered.result.snapshotError, undefined);
  assert.equal(f.state.submissions, 1);
  assert.equal(f.state.snapshots, 2);
  assert.deepEqual(f.state.snapshotQueries, ['command-original', 'command-original']);
});

test('a missing original receipt stays uncertain until the same command is returned', async t => {
  const f = await fixture(t);
  const run = await f.run();
  f.state.missingReceipt = true;
  const missing = await f.connect.refresh('test-111', run.id);
  assert.equal(missing.status, 'uncertain');
  assert.equal(missing.result.command.id, 'command-original');
  assert.match(missing.error, /原命令回执/);
  f.state.missingReceipt = false;
  f.state.commandStatus = 'succeeded';
  assert.equal((await f.connect.refresh('test-111', run.id)).status, 'succeeded');
  assert.equal(f.state.submissions, 1);
});

test('a genuine failed phone receipt remains terminal when later observations are unavailable', async t => {
  const f = await fixture(t);
  const run = await f.run();
  f.state.commandStatus = 'failed';
  const failed = await f.connect.refresh('test-111', run.id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.result.command.status, 'failed');
  const reads = f.state.reads;
  f.state.statusFailure = true;
  assert.deepEqual(await f.connect.refresh('test-111', run.id), failed);
  assert.equal(f.state.reads, reads);
  assert.equal(f.state.submissions, 1);
});

test('a crashed pre-command run expires as unknown and remains readable without resubmission', async t => {
  const f = await fixture(t);
  const ws = f.repo.getWorkspace('test-111');
  const binding = f.repo.db.prepare('SELECT * FROM ziwei_connect_bindings WHERE workspace_id=? AND employee_id=?').get(ws.id, f.employee.id);
  const runId = 'stale-queued-run';
  f.repo.db.prepare('INSERT INTO ziwei_connect_runs(id,workspace_id,employee_id,binding_id,device_id,account_id,action,command_id,status,result_json,error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(runId,ws.id,f.employee.id,binding.id,binding.device_id,binding.account_id,'health',null,'queued',null,null,'2000-01-01T00:00:00.000Z','2000-01-01T00:00:00.000Z');
  assert.ok(ZIWEI_CONNECT_RUN_TTL_MS>0);
  const listed=f.connect.listRuns('test-111').find(row=>row.id===runId);
  assert.equal(listed.status,'expired');
  assert.equal(listed.result.code,'ZIWEI_CONNECT_RUN_TIMEOUT');
  assert.equal(listed.result.executionState,'uncertain');
  assert.equal(listed.result.archivedUnconfirmed,true);
  assert.match(listed.error,/未重复提交/);
  assert.equal(f.state.submissions,0);
  assert.equal((await f.connect.refresh('test-111',runId)).status,'expired');
  assert.equal(f.state.reads,0);
});

test('the snapshot proxy forwards an explicit original command ID', async t => {
  const f = await fixture(t, 'screenshot');
  const response = await f.connect.terminal('test-111', 'GET', '/android-devices/phone-fixture/snapshot?commandId=command-original');
  assert.equal(response.body.snapshot.commandId, 'command-original');
  assert.deepEqual(f.state.snapshotQueries, ['command-original']);
  assert.equal(f.state.submissions, 0);
});

test('a screenshot run retrieves pixels by its original command ID even without a historical capture time', async t => {
  const f = await fixture(t, 'screenshot');
  f.state.commandStatus = 'succeeded';
  const run = await f.run();
  assert.equal(run.status, 'succeeded');
  assert.equal(run.result.snapshot.commandId, run.commandId);
  assert.equal(run.result.snapshot.data, 'fixture-image');
  assert.equal(run.result.snapshot.capturedAt, null);
  assert.deepEqual(f.state.snapshotQueries, ['command-original']);
  assert.equal(f.state.submissions, 1);
});

for (const mismatch of ['command', 'device', 'legacy']) test(`a ${mismatch} snapshot cannot be delivered as the original screenshot`, async t => {
  const f = await fixture(t, 'screenshot');
  f.state.commandStatus = 'succeeded';
  if (mismatch === 'command') f.state.snapshotResponse.snapshot.commandId = 'command-later';
  if (mismatch === 'device') f.state.snapshotResponse.deviceId = 'another-phone';
  if (mismatch === 'legacy') delete f.state.snapshotResponse.snapshot.commandId;
  const result = await f.connect.toolCall('test-111', { employeeId: f.employee.id, phoneDeviceId: 'phone-fixture', actionId: 'action-fixture' }, 'ziwei_phone_screenshot', { waitSeconds: 0 });
  assert.equal(result.command.status, 'succeeded');
  assert.ok(!result.device.snapshot?.data);
  assert.match(result.verificationError, /关联|原命令|原 commandId/);
  const stored = f.connect.listRuns('test-111').find(row => row.id === result.runId);
  assert.equal(stored.status, 'succeeded');
  assert.ok(!stored.result.snapshot?.data);
  assert.match(stored.result.snapshotError, /关联|原命令|原 commandId/);
  assert.equal(f.state.submissions, 1);
});

test('receipt synchronization and later image refresh keep the original screenshot association', async t => {
  const f = await fixture(t, 'screenshot');
  const run = await f.run({ executionId: 'action-fixture' });
  f.state.commandStatus = 'succeeded';
  await f.connect.toolCall('test-111', { employeeId: f.employee.id, phoneDeviceId: 'phone-fixture', actionId: 'action-fixture' }, 'ziwei_phone_receipt', { commandId: 'command-original' });
  const stored = f.connect.listRuns('test-111').find(row => row.id === run.id);
  assert.equal(stored.result.snapshot.commandId, run.commandId);
  assert.deepEqual(f.state.snapshotQueries, ['command-original']);
  assert.equal(f.state.submissions, 1);
});

for (const scenario of [
  { name: 'default public index', expected: 'https://ziwei.qzelynth.top/downloads/android/index.json' },
  { name: 'environment index override', environment: 'https://release-env.invalid/android/index.json', expected: 'https://release-env.invalid/android/index.json' },
  { name: 'option index override ahead of the environment', environment: 'https://release-env.invalid/android/index.json', option: 'https://release-option.invalid/android/index.json', expected: 'https://release-option.invalid/android/index.json' },
]) test(`phone upgrade uses the ${scenario.name} through its release transport`, async t => {
  const previousIndex = process.env.ZIWEI_ANDROID_RELEASE_INDEX;
  t.after(() => {
    if (previousIndex === undefined) delete process.env.ZIWEI_ANDROID_RELEASE_INDEX;
    else process.env.ZIWEI_ANDROID_RELEASE_INDEX = previousIndex;
  });
  if (scenario.environment) process.env.ZIWEI_ANDROID_RELEASE_INDEX = scenario.environment;
  else delete process.env.ZIWEI_ANDROID_RELEASE_INDEX;

  const f = await fixture(t, 'screenshot', scenario.option ? { releaseIndex: scenario.option } : {});
  f.state.commandStatus = 'succeeded';
  const phoneFetch = globalThis.fetch;
  const indexReads = [], updateRequests = [];
  const packageInfo = { path: '/downloads/android/v0.4.11-code22/ziwei-agent-debug.apk', sha256: 'a'.repeat(64), signerSha256: 'b'.repeat(64) };
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    const endpoint = new URL(url);
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
    if (endpoint.origin !== 'https://phone.invalid') {
      indexReads.push(String(url));
      assert.equal(String(url), scenario.expected);
      assert.equal(init.redirect, 'error');
      return reply({ releases: [{ versionName: '0.4.11', versionCode: 22, packages: { agent: packageInfo } }] });
    }
    if (endpoint.pathname.endsWith('/status') && !endpoint.searchParams.has('commandId')) {
      return reply({ device: { id: 'phone-fixture', nodes: [{ role: 'agent', versionCode: 21 }], commands: [], updates: [{ id: 'update-original', targetRole: 'agent', versionCode: 22, status: 'committed' }] } });
    }
    if (endpoint.pathname.endsWith('/updates')) {
      assert.equal(init.method, 'POST');
      updateRequests.push(JSON.parse(init.body));
      return reply({ update: { id: 'update-original', status: 'planned' } }, 201);
    }
    return phoneFetch(url, init);
  });

  const result = await f.connect.toolCall('test-111', { employeeId: f.employee.id, phoneDeviceId: 'phone-fixture', actionId: 'action-fixture' }, 'ziwei_phone_upgrade', { targetRole: 'agent', waitSeconds: 0 });
  const apkUrl = new URL(packageInfo.path, scenario.expected).toString();
  assert.deepEqual(indexReads, [scenario.expected]);
  assert.deepEqual(updateRequests, [{ targetRole: 'agent', apkUrl, sha256: packageInfo.sha256, signerSha256: packageInfo.signerSha256, versionCode: 22, preflightCommandId: 'command-original' }]);
  assert.deepEqual(result.before, { targetRole: 'agent', versionCode: 21 });
  assert.equal(result.release.apkUrl, apkUrl);
  assert.equal(result.update.id, 'update-original');
  assert.equal(result.update.status, 'committed');
  assert.equal(f.state.submissions, 1);
});
