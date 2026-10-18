import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRemoteClientUpdates, remoteMaintenanceHostId, validateRemoteUpdateRequest, writeRemoteUpdateJson, readRemoteUpdateJson, remoteUpdateErrorCode, REMOTE_CLIENT_UPDATE_SOURCE } from '../src/client-remote-update.mjs';
import { runRemoteClientUpdateWorker, inspectRemoteClientUpdateWorker, recoverRemoteClientUpdateWorker } from '../scripts/client-remote-update-worker.mjs';
import { clientBuildIdentity } from '../src/management-bootstrap.mjs';
import { createActionScheduler } from '../src/daemon-action-scheduler.mjs';

const hostId = 'a'.repeat(64), oldBuild = 'b'.repeat(64), targetBuild = 'c'.repeat(64), sha256 = 'd'.repeat(64), claimToken = 'e'.repeat(64);
function temporary(t) { const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-remote-client-'))); t.after(() => fs.rmSync(home, { recursive: true, force: true })); return home; }
function fixture(t, overrides = {}) {
  const home = temporary(t), connection = { workspace: 'one', deviceId: 'device_one' };
  const requestValue = { id: 'client-update_' + randomUUID(), ...connection, hostId, targetBuild, sha256, source: REMOTE_CLIENT_UPDATE_SOURCE, state: 'requested' };
  let remote = requestValue, idle = false, launches = 0, observation = { state: 'updating' }, failReports = 0;
  const phases = [], logs = [];
  const request = async (connection, route, body) => {
    if (route.includes('/claim?')) { remote = { ...remote, state: 'accepted' }; return { request: remote, claimToken }; }
    if (route.includes('/progress?')) {
      if (failReports > 0) { failReports--; throw Object.assign(new Error('NEVER_LOG_THIS_SECRET'), { code: 'ECONNRESET' }); }
      phases.push(body.state); remote = { ...remote, state: body.state }; return { request: remote };
    }
    return { request: connection.workspace === remote?.workspace ? remote : null };
  };
  const make = extra => createRemoteClientUpdates({ home, hostId, clientBuild: oldBuild, enabled: true, connections: () => [connection], idle: () => idle, request, inspectWorker: async () => observation, launch: async () => { launches++; return { directory: path.join(home, 'maintenance', 'remote-update-' + randomUUID()), workerPid: 20, startedAt: Date.now() }; }, log: (event, value) => logs.push({ event, ...value }), ...overrides, ...extra });
  return { home, requestValue, make, phases, logs, launches: () => launches, setIdle: value => { idle = value; }, remote: value => { remote = value; }, observe: value => { observation = value; }, failReports: value => { failReports = value; } };
}

test('one stable maintenance host identity is reused and corruption is not silently replaced', t => {
  const home = temporary(t), a = remoteMaintenanceHostId(home);
  assert.match(a, /^[a-f0-9]{64}$/); assert.equal(remoteMaintenanceHostId(home), a);
  fs.writeFileSync(path.join(home, 'maintenance-host-id'), 'corrupt');
  assert.throws(() => remoteMaintenanceHostId(home), { code: 'CLIENT_UPDATE_HOST_INVALID' });
  assert.equal(fs.readFileSync(path.join(home, 'maintenance-host-id'), 'utf8'), 'corrupt');
});

test('remote request accepts only the exact host/device/workspace and official pin', () => {
  const scope = { workspace: 'one', deviceId: 'device_one', hostId };
  const request = { ...scope, id: 'client-update_123', targetBuild, sha256, source: REMOTE_CLIENT_UPDATE_SOURCE, state: 'requested', command: 'UNTRUSTED' };
  assert.equal('command' in validateRemoteUpdateRequest(request, scope), false);
  for (const change of [{ hostId: 'f'.repeat(64) }, { workspace: 'other' }, { deviceId: 'other' }, { source: 'https://evil.invalid/update.tgz' }, { sha256: 'no' }, { targetBuild: 'no' }, { id: '../../escape' }]) assert.throws(() => validateRemoteUpdateRequest({ ...request, ...change }, scope), { code: 'CLIENT_UPDATE_REQUEST_INVALID' });
});

test('old/non-Windows capability does not poll, pause or launch', async t => {
  const f = fixture(t, { enabled: false, request: () => { throw new Error('must not poll'); } }), client = f.make();
  await client.tick(); assert.equal(client.blocksNewActions, false); assert.equal(f.launches(), 0);
});

test('waiting ledger survives daemon restart and preserves the same claim without another launch', async t => {
  const f = fixture(t), first = f.make(); await first.tick();
  assert.equal(first.status().state, 'waiting_idle'); assert.equal(first.blocksNewActions, true);
  const restarted = f.make(); await restarted.tick(); assert.equal(restarted.status().state, 'waiting_idle');
  f.setIdle(true); await restarted.tick(); await restarted.tick();
  assert.deepEqual(f.phases, ['accepted', 'waiting_idle', 'updating']); assert.equal(f.launches(), 1);
});

test('waiting cancellation releases the host gate without launching and permits a new request', async t => {
  const f = fixture(t), client = f.make(); await client.tick();
  f.remote({ ...f.requestValue, state: 'cancelled' }); await client.tick();
  assert.equal(client.blocksNewActions, false); assert.equal(f.launches(), 0);
  f.remote({ ...f.requestValue, id: 'client-update_' + randomUUID() }); await client.tick();
  assert.equal(client.status().state, 'waiting_idle'); assert.equal(client.blocksNewActions, true);
});

test('crash between persisting updating and creating a worker becomes a failed retryable receipt', async t => {
  const f = fixture(t), client = f.make(); await client.tick();
  const file = path.join(f.home, 'maintenance', 'remote-client-update.json'), persisted = readRemoteUpdateJson(file);
  writeRemoteUpdateJson(file, { ...persisted, state: 'updating', reported: 'updating' });
  f.observe({ state: 'interrupted', code: 'CLIENT_UPDATE_INTERRUPTED' });
  const restarted = f.make(); await restarted.tick();
  assert.equal(restarted.status().state, 'failed'); assert.equal(restarted.blocksNewActions, false);
  assert.equal(restarted.status().code, 'CLIENT_UPDATE_INTERRUPTED'); assert.equal(f.launches(), 0);
});

test('worker failure releases admission even when its first server report fails, then retries the report', async t => {
  const f = fixture(t), client = f.make(); f.setIdle(true); await client.tick();
  f.observe({ state: 'failed', code: 'CLIENT_UPDATE_WORKER_FAILED' }); f.failReports(1); await client.tick();
  assert.equal(client.blocksNewActions, false); assert.equal(client.status().state, 'failed');
  await client.tick(); assert.equal(f.phases.at(-1), 'failed'); assert.equal(f.launches(), 1);
  assert.doesNotMatch(JSON.stringify(f.logs), /NEVER_LOG_THIS_SECRET|eeeeeeee/);
});

test('server timeout cannot release a locally verified active updater or launch another one', async t => {
  const f = fixture(t), client = f.make(); f.setIdle(true); await client.tick();
  f.remote({ ...f.requestValue, state: 'failed' }); await client.tick();
  assert.equal(client.blocksNewActions, true); assert.equal(f.launches(), 1);
});

test('a received terminal request in one workspace does not hide another workspace pending upgrade', async t => {
  const f = fixture(t), other = { workspace: 'other', deviceId: 'device_other' };
  const client = f.make({ connections: () => [other, { workspace: 'one', deviceId: 'device_one' }], request: async (connection, route, body) => {
    if (connection.workspace === 'other') return { request: { ...f.requestValue, ...other, state: 'succeeded' } };
    if (route.includes('/claim?')) return { request: { ...f.requestValue, state: 'accepted' }, claimToken };
    if (body) return { request: { ...f.requestValue, state: body.state } };
    return { request: { ...f.requestValue, state: body?.state || 'requested' } };
  } });
  await client.tick(); assert.equal(client.status().state, 'waiting_idle');
});

test('an unavailable first workspace does not hide a valid second workspace upgrade', async t => {
  const f = fixture(t), calls = [];
  const client = f.make({ connections: () => [{ workspace: 'revoked', deviceId: 'device_revoked' }, { workspace: 'one', deviceId: 'device_one' }], request: async (connection, route, body) => {
    calls.push(connection.workspace);
    if (connection.workspace === 'revoked') throw Object.assign(new Error('SECRET_REVOKED_CREDENTIAL'), { code: 'CLIENT_UPDATE_TRANSPORT_FAILED' });
    if (route.includes('/claim?')) return { request: { ...f.requestValue, state: 'accepted' }, claimToken };
    return { request: { ...f.requestValue, state: body?.state || 'requested' } };
  } });
  await client.tick(); assert.equal(client.status().state, 'waiting_idle'); assert(calls.includes('one'));
  assert.doesNotMatch(JSON.stringify(f.logs), /SECRET_REVOKED_CREDENTIAL/);
});

test('only an admitted parents authenticated collaboration child can finish while new business is paused', async t => {
  const f = fixture(t); let client, resolveParent, children = 0;
  const parentCompleted = new Promise(resolve => { resolveParent = resolve; });
  const scheduler = createActionScheduler({
    execute: async action => { if (action.id === 'parent') await parentCompleted; else if (action.id === 'child') { children++; resolveParent(); } else throw new Error('unrelated work admitted'); },
    canStart: (action, admission) => !client?.blocksNewActions || admission.collaborationChild,
  });
  const parent = { id: 'parent', type: 'conversation.execute', workspace_id: 'ws_one', payload: { employeeId: 'employee_parent', deviceId: 'device_one' } };
  scheduler.schedule([parent]); await Promise.resolve();
  client = f.make({ idle: () => scheduler.activeCount === 0 }); await client.tick();
  assert.equal(client.status().state, 'waiting_idle');
  const child = { id: 'child', type: 'conversation.execute', workspace_id: 'ws_one', payload: { employeeId: 'employee_child', deviceId: 'device_one', collaboration: { sourceActionId: 'parent', sourceEmployeeId: 'employee_parent', mode: 'delegate', messageId: 'message_child', fingerprint: 'a'.repeat(64) } } };
  const unrelated = { ...child, id: 'unrelated', payload: { employeeId: 'employee_other', deviceId: 'device_one' } };
  const forged = { ...child, id: 'forged', workspace_id: 'ws_other' };
  assert.deepEqual(scheduler.schedule([unrelated, forged, child]), ['child']);
  await scheduler.whenIdle(); await client.tick();
  assert.equal(children, 1); assert.equal(f.launches(), 1);
});

test('an idle resident gateway is closed under supervision before the updater is launched', async t => {
  const f = fixture(t), calls = []; let gatewayBusy = true;
  const client = f.make({ idle: () => !gatewayBusy, prepareIdle: async () => { calls.push('close-gateway'); }, launch: async () => { calls.push('launch-official'); return { workerPid: 20, directory: 'fixture', startedAt: Date.now() }; } });
  await client.tick(); assert.deepEqual(calls, []);
  gatewayBusy = false; await client.tick(); assert.deepEqual(calls, ['close-gateway', 'launch-official']);
});

test('a Gateway event arriving during the updating report is never closed or installed over', async t => {
  const f = fixture(t); let busy = false, closed = false, launched = false;
  const client = f.make({ idle: () => !busy, request: async (_connection, route, body) => {
    if (route.includes('/claim?')) return { request: { ...f.requestValue, state: 'accepted' }, claimToken };
    if (body?.state === 'updating') busy = true;
    return { request: { ...f.requestValue, state: body?.state || 'requested' } };
  }, prepareIdle: async () => { closed = true; }, launch: async () => { launched = true; } });
  await client.tick(); assert.equal(closed, false); assert.equal(launched, false); assert.equal(client.blocksNewActions, false); assert.equal(client.status().code, 'CLIENT_UPDATE_BUSY_AT_DRAIN');
});

test('a failed old scope keeps its delivery outbox while new valid scopes remain discoverable', async t => {
  const f = fixture(t), old = f.make(); await old.tick(); f.setIdle(true); await old.tick();
  f.observe({ state: 'failed', code: 'CLIENT_UPDATE_WORKER_FAILED' }); f.failReports(1); await old.tick();
  const other = { workspace: 'active', deviceId: 'device_active' }, next = { ...f.requestValue, ...other, id: 'client-update_' + randomUUID() }, polled = [];
  const restarted = f.make({ connections: () => [{ workspace: 'one', deviceId: 'device_one' }, other], idle: () => false, request: async (connection, route, body) => {
    polled.push(connection.workspace);
    if (connection.workspace === 'one') throw Object.assign(new Error('revoked'), { status: 401, code: 'CLIENT_UPDATE_AUTHORIZATION_FAILED' });
    if (route.includes('/claim?')) return { request: { ...next, state: 'accepted' }, claimToken };
    return { request: { ...next, state: body?.state || 'requested' } };
  } });
  await restarted.tick(); assert(polled.includes('active')); assert.equal(restarted.status().id, next.id); assert.equal(restarted.status().state, 'waiting_idle');
  const outbox = readRemoteUpdateJson(path.join(f.home, 'maintenance', 'remote-client-update-reports.json'));
  assert.equal(outbox.length, 1); assert.equal(outbox[0].request.id, f.requestValue.id);
});

test('removing an already failed scope cannot suppress another workspace pending request', async t => {
  const f = fixture(t), client = f.make(); await client.tick();
  f.setIdle(true); await client.tick(); f.observe({ state: 'failed', code: 'CLIENT_UPDATE_WORKER_FAILED' }); await client.tick();
  const other = { workspace: 'other', deviceId: 'device_other' }, pending = { ...f.requestValue, ...other, id: 'client-update_' + randomUUID() };
  const next = f.make({ connections: () => [other], idle: () => false, request: async (_connection, route, body) => ({ request: { ...pending, state: route.includes('/claim?') ? 'accepted' : body?.state || 'requested' }, ...(route.includes('/claim?') ? { claimToken } : {}) }) });
  await next.tick(); assert.equal(next.status().id, pending.id); assert.equal(next.status().state, 'waiting_idle');
});

test('pre-worker 401 and 403 release the gate while temporary transport loss retains it', async t => {
  for (const status of [401, 403, 503]) {
    const f = fixture(t), first = f.make(); await first.tick();
    const restarted = f.make({ request: async () => { throw Object.assign(new Error('PRIVATE_AUTH'), { code: status === 503 ? 'CLIENT_UPDATE_TRANSPORT_FAILED' : 'CLIENT_UPDATE_AUTHORIZATION_FAILED', status }); } });
    await restarted.tick(); assert.equal(restarted.blocksNewActions, status === 503); assert.equal(restarted.status().state, status === 503 ? 'waiting_idle' : 'failed');
  }
});

test('a terminal server refusal to enter updating never closes Gateways or launches a worker', async t => {
  for (const state of ['failed', 'cancelled']) {
    const f = fixture(t); let closed = false, launched = false;
    const client = f.make({ idle: () => true, request: async (_connection, route, body) => {
      if (route.includes('/claim?')) return { request: { ...f.requestValue, state: 'accepted' }, claimToken };
      return { request: { ...f.requestValue, state: body?.state === 'updating' ? state : body?.state || 'requested', ...(body?.state === 'updating' ? { code: 'CLIENT_UPDATE_AUTHORITY_REVOKED' } : {}) } };
    }, prepareIdle: async () => { closed = true; }, launch: async () => { launched = true; } });
    await client.tick(); assert.equal(client.status().state, state); assert.equal(client.blocksNewActions, false); assert.equal(closed, false); assert.equal(launched, false);
  }
});

test('a gateway without confirmed exit fails explicitly without launching the updater', async t => {
  const f = fixture(t); f.setIdle(true);
  const client = f.make({ prepareIdle: async () => { throw Object.assign(new Error('SECRET_GATEWAY_OUTPUT'), { code: 'CLIENT_UPDATE_GATEWAY_EXIT_UNCONFIRMED' }); } });
  await client.tick(); assert.equal(client.status().state, 'failed'); assert.equal(client.status().code, 'CLIENT_UPDATE_GATEWAY_EXIT_UNCONFIRMED'); assert.equal(f.launches(), 0); assert.equal(client.blocksNewActions, false);
});

test('worker observation rejects absent/dead supervisors and paths outside its user maintenance root', async t => {
  const home = temporary(t);
  assert.equal((await inspectRemoteClientUpdateWorker(undefined, { home })).state, 'interrupted');
  assert.equal((await inspectRemoteClientUpdateWorker({ workerPid: 12, startedAt: Date.now(), directory: home }, { home })).code, 'CLIENT_UPDATE_STATE_INVALID');
  const directory = path.join(home, 'maintenance', 'remote-update-' + randomUUID()); fs.mkdirSync(directory, { recursive: true });
  const worker = { workerPid: 12, startedAt: Date.now(), directory };
  assert.equal((await inspectRemoteClientUpdateWorker(worker, { home, processAlive: () => false })).state, 'interrupted');
  writeRemoteUpdateJson(path.join(directory, 'supervisor-result.json'), { state: 'queued', resultFile: path.join(home, 'not-an-updater.json') });
  assert.equal((await inspectRemoteClientUpdateWorker(worker, { home, readStatus: () => { throw new Error('must not read arbitrary path'); } })).code, 'CLIENT_UPDATE_STATE_INVALID');
});

test('official detached update result is observed without treating its receipt as a new-build heartbeat', async t => {
  const home = temporary(t), directory = path.join(home, 'maintenance', 'remote-update-' + randomUUID()); fs.mkdirSync(directory, { recursive: true });
  const resultFile = path.join(home, 'maintenance', 'update-' + randomUUID(), 'result.json');
  writeRemoteUpdateJson(path.join(directory, 'supervisor-result.json'), { state: 'queued', resultFile });
  assert.equal((await inspectRemoteClientUpdateWorker({ directory, workerPid: 12, startedAt: Date.now() }, { home, readStatus: async value => { assert.equal(value.resultFile, resultFile); return { state: 'complete' }; } })).state, 'complete');
});

function workerFixture(t) {
  const home = temporary(t), root = path.join(home, 'installation'), data = path.join(home, 'user-data'), directory = path.join(data, 'maintenance', 'remote-update-' + randomUUID());
  fs.mkdirSync(root); fs.mkdirSync(directory, { recursive: true });
  const configPath = path.join(data, 'ziwei_user.json'), request = { id: 'client-update_' + randomUUID(), workspace: 'one', deviceId: 'device_one', hostId, targetBuild, sha256, source: REMOTE_CLIENT_UPDATE_SOURCE, state: 'updating' };
  fs.writeFileSync(configPath, JSON.stringify({ workspace: 'one', deviceId: 'device_one', deviceToken: 'isolated-device-credential', apiBase: 'https://fixture.invalid' }));
  const jobFile = path.join(directory, 'remote-job.json'); writeRemoteUpdateJson(jobFile, { schemaVersion: 1, root, home: data, configPath, directory, request, claimToken });
  return { home: data, root, directory, configPath, request, jobFile };
}

test('package-outside supervisor pins download SHA and target build and exits after queuing the official worker', async t => {
  const f = workerFixture(t), calls = []; const original = fs.readFileSync(f.configPath, 'utf8');
  const result = await runRemoteClientUpdateWorker({ jobFile: f.jobFile, fetchImpl: async (url, options) => { assert.match(url, /^https:\/\/fixture.invalid\/a2a\/v1\/device-updates\?/); assert.equal(options.headers['x-ziwei-device-token'], 'isolated-device-credential'); return { ok: true, json: async () => ({ request: f.request }) }; }, download: async value => { calls.push(['download', value]); }, launch: async value => { calls.push(['launch', value]); return { workerPid: 20, resultFile: path.join(f.home, 'maintenance', 'update-' + randomUUID(), 'result.json') }; } });
  assert.equal(result.state, 'queued'); assert.equal(calls[0][1].url, REMOTE_CLIENT_UPDATE_SOURCE); assert.equal(calls[0][1].sha256, sha256);
  assert.equal(calls[1][1].args.expectedBuild, targetBuild); assert.equal(calls[1][1].args.sha256, sha256); assert.equal(calls[1][1].root, f.root);
  assert.equal(fs.readFileSync(f.configPath, 'utf8'), original);
  assert.doesNotMatch(JSON.stringify(readRemoteUpdateJson(path.join(f.directory, 'supervisor-result.json'))), /isolated-device-credential|eeeeeeee/);
});

test('supervisor refuses replaced release or cancelled intent before any install work', async t => {
  for (const change of [{ targetBuild: 'f'.repeat(64) }, { sha256: 'f'.repeat(64) }, { state: 'cancelled' }]) {
    const f = workerFixture(t), result = await runRemoteClientUpdateWorker({ jobFile: f.jobFile, fetchImpl: async () => ({ ok: true, json: async () => ({ request: { ...f.request, ...change } }) }), download: () => { throw new Error('must not download'); }, launch: () => { throw new Error('must not install'); } });
    assert.equal(result.state, 'failed'); assert.match(result.code, /^CLIENT_UPDATE_(TARGET_CHANGED|CANCELED)$/);
  }
});

test('a request cancelled during download is checked again before queuing any updater', async t => {
  const f = workerFixture(t); let polls = 0, launches = 0;
  const result = await runRemoteClientUpdateWorker({ jobFile: f.jobFile, fetchImpl: async () => ({ ok: true, json: async () => ({ request: { ...f.request, state: ++polls === 1 ? 'updating' : 'cancelled' } }) }), download: async () => {}, launch: () => { launches++; } });
  assert.equal(result.state, 'failed'); assert.equal(result.code, 'CLIENT_UPDATE_CANCELED'); assert.equal(launches, 0);
});

test('the spawn-ledger crash window recovers only the exact immutable claimed helper', async t => {
  const f = workerFixture(t);
  writeRemoteUpdateJson(path.join(f.directory, 'supervisor-identity.json'), { workerPid: 20, startedAt: Date.now() });
  assert.equal(recoverRemoteClientUpdateWorker({ home: f.home, request: f.request, claimToken }).directory, f.directory);
  assert.equal(recoverRemoteClientUpdateWorker({ home: f.home, request: { ...f.request, targetBuild: 'f'.repeat(64) }, claimToken }), null);
  assert.equal(recoverRemoteClientUpdateWorker({ home: f.home, request: f.request, claimToken: 'wrong' }), null);
});

test('remote worker source participates in actual packaged client build identity', t => {
  const root = temporary(t); fs.mkdirSync(path.join(root, 'scripts')); fs.writeFileSync(path.join(root, 'package.json'), '{}');
  const before = clientBuildIdentity(root); fs.writeFileSync(path.join(root, 'scripts', 'client-remote-update-worker.mjs'), 'export const revision=1;');
  assert.notEqual(clientBuildIdentity(root), before);
});

test('bounded remote diagnostics never include arbitrary exception messages', () => {
  assert.equal(remoteUpdateErrorCode({ code: 'UPDATE_HASH_INVALID', message: 'SECRET' }), 'CLIENT_UPDATE_UPDATE_HASH_INVALID');
  assert.equal(remoteUpdateErrorCode({ code: '../../SECRET', message: 'SECRET' }), 'CLIENT_UPDATE_FAILED');
});
