import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { clientUpdateView, createClientUpdateController } from './client-updates.js';

const targetBuild = 'b'.repeat(64), currentBuild = 'a'.repeat(64);
function device(overrides = {}) { return { id: 'pc-1', name: '公司台式', os: 'win32', status: 'online', currentVersion: '0.1.0', currentBuild, targetBuild, version: '0.1.0', supported: true, canManage: true, operation: null, ...overrides }; }
const release = { targetBuild, version: '0.1.0' };
const operation = (state, extra = {}) => ({ id: 'update-1', state, idempotencyKey: 'client-update-1', targetBuild, heartbeatVerified: false, ...extra });
function memoryStorage() { const items = new Map(); return { getItem: key => items.get(key), setItem: (key, value) => items.set(key, value), removeItem: key => items.delete(key) }; }
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function setup(options = {}) {
  let scope = { workspace: 'bigtron', actorId: 'owner' };
  let rows = [device()]; const submissions = [], cancellations = [], reads = [];
  const controller = createClientUpdateController({ scope: () => scope, storage: options.storage || memoryStorage(), makeKey: () => 'client-update-1',
    read: async workspace => { reads.push(workspace); return options.read ? options.read(workspace) : { release, devices: structuredClone(rows) }; },
    submit: async (...args) => { submissions.push(args); return options.submit ? options.submit(...args) : { request: operation('requested') }; },
    cancel: async (...args) => { cancellations.push(args); return options.cancel ? options.cancel(...args) : { request: operation('cancelled') }; },
  });
  return { controller, state: controller.state, submissions, cancellations, reads, scope: value => { scope = value; }, rows: value => { rows = value; } };
}

test('only an online supported manageable exact device can request an update', () => {
  assert.equal(clientUpdateView(device()).canUpdate, true);
  for (const override of [{ status: 'offline' }, { supported: false }, { canManage: false }, { targetBuild: null }, { currentBuild: targetBuild }]) assert.equal(clientUpdateView(device(override)).canUpdate, false);
  assert.equal(clientUpdateView(device({ supported: false, reasonCode: 'REMOTE_UPDATE_CLIENT_REQUIRED' })).legacyRequired, true);
  assert.equal(clientUpdateView(device({ currentBuild: targetBuild })).label, '已是目标版本');
});

test('all maintenance stages stay busy and cancellation is restricted to pre-update waiting', () => {
  for (const state of ['requested', 'accepted', 'waiting_idle', 'updating', 'awaiting_heartbeat']) {
    const view = clientUpdateView(device({ operation: operation(state) }));
    assert.equal(view.canUpdate, false, state);
    assert.equal(view.canCancel, ['requested', 'accepted', 'waiting_idle'].includes(state), state);
  }
  assert.equal(clientUpdateView(device({ operation: operation('unknown') })).canUpdate, false);
  assert.equal(clientUpdateView(device({ operation: operation('failed', { reason: '官方包校验失败', code: 'PACKAGE_MISMATCH' }) })).failure, '官方包校验失败 · PACKAGE_MISMATCH');
});

test('success requires the server-verified target heartbeat rather than worker acceptance', () => {
  const unverified = clientUpdateView(device({ operation: operation('succeeded') }));
  assert.equal(unverified.state, 'awaiting_heartbeat'); assert.equal(unverified.canUpdate, false);
  const verified = clientUpdateView(device({ operation: operation('succeeded', { heartbeatVerified: true }) }));
  assert.equal(verified.label, '升级完成'); assert.equal(verified.tone, 'success');
});

test('an explicitly stalled operation permits a new request but never implies an old worker exited', () => {
  const stalled = clientUpdateView(device({ operation: operation('updating', { stalled: true }) }));
  assert.equal(stalled.active, true); assert.equal(stalled.stalled, true); assert.equal(stalled.canUpdate, true);
  assert.equal(stalled.label, '维护回执超时'); assert.equal(stalled.updateLabel, '重新请求官方升级');
  assert.equal(clientUpdateView(device({ operation: operation('waiting_idle', { stalled: true }) })).canUpdate, false);
  assert.equal(clientUpdateView(device({ operation: operation('updating', { stalled: true }), status: 'offline' })).canUpdate, false);
});

test('already-current race only refreshes and does not keep an unconfirmed request', async () => {
  let current = false;
  const f = setup({ read: async () => ({ release, devices: [device({ currentBuild: current ? targetBuild : currentBuild })] }), submit: async () => { current = true; return { alreadyCurrent: true, request: null }; } });
  await f.controller.refresh(); await f.controller.update('pc-1');
  assert.equal(f.submissions.length, 1); assert.equal(f.state.uncertain['pc-1'], undefined);
  assert.equal(clientUpdateView(f.state.devices[0]).latest, true);
});

test('reading and re-opening the panel never creates update requests', async () => {
  const f = setup(); await f.controller.refresh(); await f.controller.refresh();
  assert.equal(f.submissions.length, 0); assert.equal(f.state.devices.length, 1);
});

test('one click targets only the chosen device and always waits for all employees to become idle', async () => {
  const hold = deferred(); const f = setup({ submit: () => hold.promise });
  f.rows([device(), device({ id: 'pc-2' })]); await f.controller.refresh();
  const update = f.controller.update('pc-2'); await f.controller.update('pc-2');
  assert.deepEqual(f.submissions, [['pc-2', { idempotencyKey: 'client-update-1', waitForIdle: true }, 'bigtron']]);
  hold.resolve({ request: operation('waiting_idle') }); await update;
});

test('lost POST receipt recovers through GET without silently resubmitting maintenance', async () => {
  let accepted = false;
  const f = setup({ read: async () => ({ release, devices: [device({ operation: accepted ? operation('waiting_idle') : null })] }), submit: async () => { accepted = true; throw new Error('网络断开'); } });
  await f.controller.refresh(); await f.controller.update('pc-1');
  assert.equal(f.submissions.length, 1); assert.equal(f.state.devices[0].operation.state, 'waiting_idle');
  assert.equal(f.state.uncertain['pc-1'], undefined); assert.equal(f.state.rowErrors['pc-1'], undefined);
  await f.controller.refresh(); assert.equal(f.submissions.length, 1);
});

test('an unresolved network failure keeps a stable key across page re-opening and explicit retry', async () => {
  const storage = memoryStorage(); const f = setup({ storage, submit: async () => { throw new Error('网络断开'); } });
  await f.controller.refresh(); await f.controller.update('pc-1');
  assert.equal(f.state.uncertain['pc-1'], true); await f.controller.update('pc-1'); assert.equal(f.submissions.length, 1);
  const reopened = setup({ storage }); await reopened.controller.refresh();
  assert.equal(reopened.submissions.length, 0); assert.equal(reopened.state.uncertain['pc-1'], true);
  await reopened.controller.retry('pc-1');
  assert.equal(reopened.submissions.length, 1); assert.equal(reopened.submissions[0][1].idempotencyKey, f.submissions[0][1].idempotencyKey);
});

test('changing workspace or signed-in user invalidates old reads and update responses', async () => {
  const hold = deferred(); const f = setup({ read: () => hold.promise });
  const read = f.controller.refresh(); f.scope({ workspace: 'elsewhere', actorId: 'different' }); f.controller.invalidate();
  hold.resolve({ release, devices: [device()] }); await read;
  assert.equal(f.state.devices.length, 0); assert.equal(f.state.readReady, false);
  const post = deferred(); const g = setup({ submit: () => post.promise }); await g.controller.refresh(); const update = g.controller.update('pc-1');
  g.scope({ workspace: 'elsewhere', actorId: 'different' }); g.controller.invalidate();
  post.resolve({ request: operation('requested') }); await update;
  assert.equal(g.state.devices.length, 0); assert.deepEqual(g.state.submitting, {});
});

test('a stale poll cannot overwrite the newly accepted operation', async () => {
  const hold = deferred(); let reads = 0;
  const f = setup({ read: async () => { reads++; return reads === 2 ? hold.promise : { release, devices: [device({ operation: reads > 2 ? operation('updating') : null })] }; } });
  await f.controller.refresh(); const stale = f.controller.refresh(); await f.controller.update('pc-1');
  hold.resolve({ release, devices: [device()] }); await stale;
  assert.equal(f.state.devices[0].operation.state, 'updating'); assert.equal(f.state.loading, false);
});

test('failed status reads block mutations and cross-user storage never triggers another user request', async () => {
  const f = setup({ read: async () => { throw new Error('权限已失效'); } }); await f.controller.refresh(); await f.controller.update('pc-1');
  assert.equal(f.submissions.length, 0); assert.equal(f.state.readReady, false);
  const storage = memoryStorage(); const g = setup({ storage, submit: async () => { throw new Error('网络断开'); } });
  await g.controller.refresh(); await g.controller.update('pc-1');
  const other = setup({ storage }); other.scope({ workspace: 'bigtron', actorId: 'another-owner' }); await other.controller.refresh();
  assert.equal(other.state.uncertain['pc-1'], undefined); assert.equal(other.submissions.length, 0);
});

test('cancellation addresses the exact waiting request and cannot cancel an updater already running', async () => {
  const f = setup(); f.rows([device({ operation: operation('waiting_idle') })]); await f.controller.refresh(); await f.controller.cancel('pc-1');
  assert.deepEqual(f.cancellations, [['pc-1', 'update-1', 'bigtron']]);
  f.rows([device({ operation: operation('updating') })]); await f.controller.refresh(); await f.controller.cancel('pc-1'); assert.equal(f.cancellations.length, 1);
});

test('UI uses the existing credentialed API, exposes exact device cards and collapses local commands', async () => {
  const [panel, app, api] = await Promise.all(['./components/ClientMaintenancePanel.vue', './App.vue', './api.js'].map(path => readFile(new URL(path, import.meta.url), 'utf8')));
  assert.match(panel, /v-for="device in state\.devices"/); assert.match(panel, /data-device-id="device\.id"/);
  assert.match(panel, /controller\.update\(device\.id\)/); assert.match(panel, /client-local-maintenance/); assert.match(panel, /@media \(max-width:640px\)/);
  assert.match(app, /<ClientMaintenancePanel :workspace="workspaceSlugValue" :actor-id="authState\.user\?\.id/);
  assert.match(api, /clientUpdates:.*boundedRequest\(`/); assert.match(api, /updateClient:.*request\(`/);
  assert.doesNotMatch(panel, /fetch\(|createDevicePairing|setInterval|force:\s*true/);
});
