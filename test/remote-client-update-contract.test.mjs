// Exercise the real server/client maintenance protocol without a listener,
// installed package mutation, child process, or live device credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRepository} from '../backend/repository.mjs';
import {createAuthService} from '../backend/auth.mjs';
import {createDeviceUpdateService, REMOTE_UPDATE_FEATURE, OFFICIAL_CLIENT_SOURCE} from '../backend/device-updates.mjs';
import {createRemoteClientUpdates} from '../src/client-remote-update.mjs';

const sourceBuild = '1'.repeat(64), targetBuild = '2'.repeat(64), hostId = '3'.repeat(64);

async function fixture(t) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-remote-contract-')));
  const repo = createRepository({memory: true});
  t.after(() => { repo.db.close(); fs.rmSync(home, {recursive: true, force: true}); });
  const auth = createAuthService(repo.db);
  const owner = auth.setup({email: 'remote-contract@fixture.invalid', password: 'isolated-remote-contract-password'});
  const workspace = 'remote-contract';
  auth.createWorkspace(owner.user_id, {slug: workspace, name: 'Remote upgrade contract', kind: 'team'});
  const pair = repo.claimDevicePairing({code: repo.createDevicePairing(workspace, {name: 'Isolated Windows'}).code});
  const context = {actorUserId: owner.user_id};
  const heartbeat = (build = sourceBuild, pid = 401) => repo.heartbeatDevice(workspace, {
    deviceId: pair.deviceId, os: 'Windows', pid, clientBuild: build,
    runtimeDiscovery: {features: [REMOTE_UPDATE_FEATURE], maintenanceHostId: hostId},
  });
  heartbeat();
  const service = createDeviceUpdateService(repo, {readRelease: async () => ({
    url: OFFICIAL_CLIENT_SOURCE, version: '0.1.0', clientBuild: targetBuild, sha256: '4'.repeat(64),
  })});
  const credential = () => repo.authenticateDeviceToken(pair.deviceToken);
  const created = await service.create(workspace, pair.deviceId, {idempotencyKey: 'remote-contract-once', waitForIdle: true}, context);
  const connection = {workspace, deviceId: pair.deviceId};
  let allWorkspacesIdle = false, launches = 0, polls = 0;
  const diagnostics = [];
  const request = async (_connection, route, body) => {
    const url = new URL(route, 'https://fixture.invalid');
    const slug = url.searchParams.get('workspace'), deviceId = url.searchParams.get('deviceId');
    assert.equal(slug, workspace); assert.equal(deviceId, pair.deviceId);
    const match = url.pathname.match(/^\/a2a\/v1\/device-updates\/([^/]+)\/(claim|progress)$/);
    if (!match) { polls++; return service.pending(slug, deviceId, credential()); }
    if (match[2] === 'claim') return service.claim(slug, deviceId, match[1], body, credential());
    return service.progress(slug, deviceId, match[1], body, credential());
  };
  const makeClient = (clientBuild = sourceBuild, extra = {}) => createRemoteClientUpdates({
    home, hostId, clientBuild, enabled: true, pid: clientBuild === sourceBuild ? 401 : 402,
    connections: () => [connection], idle: () => allWorkspacesIdle, request,
    launch: async () => { launches++; return {workerPid: 403, startedAt: Date.now(), directory: path.join(home, 'maintenance', 'isolated-worker')}; },
    inspectWorker: async () => ({state: 'updating'}), log: (event, data) => diagnostics.push({event, ...data}), ...extra,
  });
  return {repo, service, created, context, workspace, pair, heartbeat, makeClient, request, diagnostics,
    idle: value => { allWorkspacesIdle = value; }, launches: () => launches, polls: () => polls,
    read: async () => (await service.get(workspace, pair.deviceId, created.request.id, context)).request};
}

test('real protocol waits for every workspace, launches once, and succeeds only after a new-build heartbeat', async t => {
  const f = await fixture(t), client = f.makeClient();
  await client.tick();
  assert.equal((await f.read()).state, 'waiting_idle', JSON.stringify(f.diagnostics));
  assert.equal(client.blocksNewActions, true); assert.equal(f.launches(), 0);
  await client.tick(); assert.equal(f.launches(), 0);
  f.idle(true); await client.tick();
  assert.equal((await f.read()).state, 'updating'); assert.equal(f.launches(), 1);
  await client.tick(); assert.equal(f.launches(), 1);
  // A replacement daemon retains the same local ledger but computes its own
  // actual source digest on startup. The old worker cannot report success.
  const replacement = f.makeClient(targetBuild);
  await replacement.tick();
  assert.equal((await f.read()).state, 'awaiting_heartbeat');
  assert.equal((await f.read()).heartbeatVerified, false);
  f.heartbeat(targetBuild, 402);
  await replacement.tick();
  assert.equal((await f.read()).state, 'succeeded');
  assert.equal((await f.read()).heartbeatVerified, true);
  // A fresh daemon can heartbeat while the installer still owns its lease.
  assert.equal(replacement.blocksNewActions, true);
  const settled = f.makeClient(targetBuild, {inspectWorker: async () => ({state:'complete'})});
  await settled.tick();
  assert.equal(settled.blocksNewActions, false);
  assert.equal(replacement.status().state, 'succeeded');
  assert.equal(f.launches(), 1);
});

test('an already idle host still follows the server phase contract instead of skipping waiting_idle', async t => {
  const f = await fixture(t); f.idle(true);
  const client = f.makeClient(); await client.tick();
  assert.equal((await f.read()).state, 'updating', JSON.stringify(f.diagnostics));
  assert.equal(f.launches(), 1);
});

test('cancelling a queued request releases the client admission gate without starting a worker', async t => {
  const f = await fixture(t), client = f.makeClient(); await client.tick();
  assert.equal(client.blocksNewActions, true);
  f.service.cancel(f.workspace, f.pair.deviceId, f.created.request.id, f.context);
  await client.tick();
  assert.equal(client.blocksNewActions, false);
  assert.equal(client.status().state, 'cancelled');
  assert.equal(f.launches(), 0);
});

test('a fresh target-build heartbeat before claim satisfies the goal without running a second updater', async t => {
  const f = await fixture(t);
  f.heartbeat(targetBuild, 402);
  const status = await f.read();
  assert.equal(status.state, 'succeeded');
  assert.equal(status.completionSource, 'heartbeat');
  const client = f.makeClient(targetBuild);
  await client.tick();
  assert.equal(client.blocksNewActions, false);
  assert.equal(f.launches(), 0);
});

test('a native worker startup error becomes an accepted terminal receipt instead of an invalid error-code loop', async t => {
  const f = await fixture(t); f.idle(true);
  // Use the real client/server protocol with a failed OS spawn, without ever
  // spawning a process or calling the updater in this fixture.
  const failing = f.makeClient(sourceBuild, {launch: async () => { throw Object.assign(new Error('do not forward raw process output'), {code: 'EACCES'}); }});
  await failing.tick();
  const status = await f.read();
  assert.equal(status.state, 'failed');
  assert.equal(status.code, 'CLIENT_UPDATE_EACCES');
  assert.equal(failing.blocksNewActions, false);
});

test('revoking the requesting administrator while queued cannot close a gateway or start the updater', async t => {
  const f = await fixture(t);
  let prepared = false;
  const client = f.makeClient(sourceBuild, {prepareIdle: async () => { prepared = true; }});
  await client.tick();
  assert.equal(client.blocksNewActions, true);
  f.repo.db.prepare("UPDATE members SET role='member' WHERE user_id=? AND workspace_id=(SELECT id FROM workspaces WHERE slug=?)").run(f.context.actorUserId, f.workspace);
  f.idle(true);
  await client.tick();
  assert.equal((await f.read()).state, 'failed');
  assert.equal((await f.read()).code, 'CLIENT_UPDATE_AUTHORITY_REVOKED');
  assert.equal(prepared, false);
  assert.equal(f.launches(), 0);
  assert.equal(client.blocksNewActions, false);
});
