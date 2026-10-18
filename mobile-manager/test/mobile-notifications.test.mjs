import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../web/model.js';
import { createMobileNotifications, MOBILE_NOTIFICATION_LIMITS } from '../web/mobile-notifications.js';
import { renderMobileNotifications } from '../web/mobile-notifications-view.js';

const prefix = 'ziwei.manager.notification-read.v1:';
const storeKey = account => prefix + JSON.stringify(account);
const wsKey = (slug = 'one', id = `workspace-db-${slug}`) => JSON.stringify([slug, id]);
const item = (id = 'event-one', overrides = {}) => ({ id, kind: 'execution.completed', createdAt: '2026-10-17T10:00:00.000Z', title: '员工 · 执行完成', summary: '查看原聊天结果。',
  executionState: 'confirmed', target: { kind: 'conversation', id: 'chat-one', employeeId: 'employee-one', messageId: 'message-one', actionId: 'action-one' }, ...overrides });
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function memoryStorage() { const rows = new Map(); return { rows, getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, value), removeItem: key => rows.delete(key) }; }
function fixture(t, overrides = {}) {
  let epoch = 0;
  const state = { ...initialState(), phase: 'ready', user: { user_id: 'user-one' }, workspace: { id: 'workspace-db-one', slug: 'one', role: 'owner' },
    workspaces: [{ id: 'workspace-db-one', slug: 'one' }, { id: 'workspace-db-two', slug: 'two' }] };
  const calls = [], failures = [], opened = [], frames = [], storage = overrides.storage || memoryStorage();
  const envelope = (values = {}, scope = {}) => ({ schemaVersion: 2, accountId: scope.account || state.user.user_id, workspaceId: scope.db || state.workspace.id, workspaceSlug: scope.slug || state.workspace.slug,
    nextCursor: 'cursor1', hasMore: false, historyWindow: true, items: [item()], ...values });
  const api = { mobileNotifications: async (workspace, query, options) => { calls.push({ kind: 'list', workspace, query, options }); return envelope(query.cursor ? { historyWindow: undefined, nextCursor: query.cursor, items: [] } : {}); },
    mobileNotification: async (workspace, id, options) => { calls.push({ kind: 'resolve', workspace, id, options }); const result = envelope({ item: item(id) }); delete result.items; return result; }, ...overrides.api };
  const current = () => ({ epoch, account: state.user?.user_id, workspace: state.workspace?.slug });
  const valid = token => token.epoch === epoch && token.account === state.user?.user_id && token.workspace === state.workspace?.slug;
  const mobile = createMobileNotifications({ state, api, storage, current, valid, native: overrides.native, draw: () => frames.push(renderMobileNotifications(state)),
    fail: (error, token) => failures.push({ error, token }), onTarget: overrides.onTarget || ((value, token) => { opened.push({ value, token }); return true; }), onWorkspaceTarget: overrides.onWorkspaceTarget });
  t.after(() => mobile.dispose());
  const switchScope = (account = 'user-one', slug = 'two', { reset = true } = {}) => {
    epoch++; if (reset) mobile.reset(); state.user = { user_id: account }; state.workspace = { id: `workspace-db-${slug}`, slug, role: 'owner' }; state.page = 'home';
  };
  return { state, api, mobile, calls, failures, opened, frames, storage, envelope, switchScope, current };
}
function nativeStub(initial = {}) {
  const status = { available: true, enabled: false, subscriptionState: 'disabled', permission: 'granted', workspaceSlug: '', accountId: '', message: '关闭', pendingTarget: false, ...initial };
  const calls = [], pending = [];
  const native = { status, calls, pending, getStatus: () => { calls.push(['status']); return JSON.stringify(status); },
    configure: (workspace, enabled) => { calls.push(['configure', workspace, enabled]); Object.assign(status, { enabled, subscriptionState: enabled ? 'enabling' : 'disabled', workspaceSlug: enabled ? workspace : '' }); return JSON.stringify(status); },
    requestPermission: () => { calls.push(['permission']); return JSON.stringify(status); },
    openSystemSettings: () => { calls.push(['settings']); return JSON.stringify(status); },
    clear: () => { calls.push(['clear']); Object.assign(status, { enabled: false, subscriptionState: 'disabled', accountId: '', pendingTarget: false }); return JSON.stringify(status); },
    consumePendingTarget: () => { calls.push(['consume']); status.pendingTarget = false; return JSON.stringify(pending.shift() || null); } };
  return native;
}

// All API traffic below is fixture-only. No notification/server read marker or business action is written.
test('recent feed is a bounded window, sorted newest first and exposes personal unread count', async t => {
  const f = fixture(t, { api: { mobileNotifications: async () => f.envelope({ items: [item('older'), item('newer', { createdAt: '2026-10-17T11:00:00Z' })] }) } });
  assert.equal(await f.mobile.open(), true); assert.equal(f.state.page, 'notifications');
  assert.deepEqual(f.state.notifications.items.map(row => row.id), ['newer', 'older']); assert.equal(f.state.notifications.unreadCount, 2); assert.equal(f.state.notifications.historyWindow, true);
  assert.match(renderMobileNotifications(f.state), /最近 2 条 · 2 条未读/); assert.match(renderMobileNotifications(f.state), /可能延后/); assert.doesNotMatch(renderMobileNotifications(f.state), /即时推送|全部历史/);
});

test('poll only performs one bounded GET and incremental empty scan advances cursor with hasMore', async t => {
  const f = fixture(t); await f.mobile.poll();
  f.api.mobileNotifications = async (workspace, query) => { f.calls.push({ kind: 'list', workspace, query }); return f.envelope({ items: [], nextCursor: 'cursor2', hasMore: true, historyWindow: undefined }); };
  assert.equal(await f.mobile.poll(), true); assert.equal(f.state.notifications.cursor, 'cursor2'); assert.equal(f.state.notifications.hasMore, true); assert.equal(f.state.notifications.items.length, 1);
  assert.deepEqual(f.calls.map(call => [call.kind, call.query]), [['list', { limit: 20 }], ['list', { limit: 20, cursor: 'cursor1' }]]);
});

test('incremental merge replaces duplicate event rows without duplicating and more is explicit', async t => {
  const f = fixture(t); await f.mobile.poll(); let reads = 0;
  f.api.mobileNotifications = async (_workspace, query) => { reads++; return f.envelope({ historyWindow: undefined, nextCursor: `next${reads}`, hasMore: reads === 1,
    items: [item('event-one', { title: '更新后的可见提醒' }), item('event-two')] }); };
  await f.mobile.poll(); assert.equal(reads, 1); assert.equal(f.state.notifications.items.length, 2); assert.equal(f.state.notifications.items.find(row => row.id === 'event-one').title, '更新后的可见提醒');
  await f.mobile.actions['notifications-more'](); assert.equal(reads, 2); assert.equal(f.state.notifications.hasMore, false); assert.equal(await f.mobile.actions['notifications-more'](), false);
});

test('list GET is single-flight and reset aborts the owned request without applying its late receipt', async t => {
  const delayed = deferred(); let signal;
  const f = fixture(t, { api: { mobileNotifications: async (_ws, _query, options) => { signal = options.signal; return delayed.promise; } } });
  const reading = f.mobile.poll(); assert.equal(await f.mobile.poll(), false); f.switchScope(); assert.equal(signal.aborted, true);
  delayed.resolve(f.envelope({}, { account: 'user-one', slug: 'one', db: 'workspace-db-one' })); assert.equal(await reading, false); assert.equal(f.state.notifications, null); assert.deepEqual(f.opened, []);
});

test('scope changes are guarded even when the root forgot reset; account change clears native subscription', async t => {
  const delayed = deferred(), native = nativeStub(); const f = fixture(t, { native, api: { mobileNotifications: () => delayed.promise } });
  const reading = f.mobile.poll(); f.switchScope('user-two', 'two', { reset: false }); delayed.resolve(f.envelope({}, { account: 'user-one', slug: 'one', db: 'workspace-db-one' }));
  assert.equal(await reading, false); f.api.mobileNotifications = async () => f.envelope(); await f.mobile.poll(); assert(native.calls.some(call => call[0] === 'clear'));
  assert.equal(f.state.notifications.scope, JSON.stringify(['user-two', 'two']));
});

test('workspace DB identity is required and a recreated slug cannot inherit old local read markers', async t => {
  const f = fixture(t); await f.mobile.poll(); f.mobile.actions['notifications-read-all'](); assert.equal(f.state.notifications.unreadCount, 0);
  f.state.workspace.id = 'replacement-db'; await f.mobile.poll(); assert.equal(f.state.notifications.unreadCount, 1);
  f.state.workspace.id = ''; f.mobile.reset(); assert.equal(await f.mobile.poll(), false); assert.equal(f.state.notifications, null);
});

for (const [label, mutate] of [
  ['account', value => { value.accountId = 'other-user'; }], ['workspace slug', value => { value.workspaceSlug = 'two'; }],
  ['workspace DB id', value => { value.workspaceId = 'other-db'; }], ['schema', value => { value.schemaVersion = 1; }],
  ['cursor', value => { value.nextCursor = 'https://evil.invalid'; }], ['cursor size', value => { value.nextCursor = 'a'.repeat(2049); }],
  ['recent hasMore', value => { value.hasMore = true; }], ['recent history claim', value => { delete value.historyWindow; }],
  ['item bounds', value => { value.items = Array.from({ length: 51 }, (_, index) => item(`event-${index}`)); }],
  ['duplicate events', value => { value.items = [item(), item()]; }], ['byte title', value => { value.items[0].title = '中'.repeat(54); }],
  ['byte summary', value => { value.items[0].summary = '中'.repeat(342); }], ['unknown kind', value => { value.items[0].kind = 'group.mention'; }],
  ['completion proof label', value => { value.items[0].executionState = 'uncertain'; }], ['invalid event id', value => { value.items[0].id = '../event'; }],
  ['date', value => { value.items[0].createdAt = 'not-date'; }], ['target URL', value => { value.items[0].target.url = 'https://evil.invalid'; }],
  ['target kind', value => { value.items[0].target.kind = 'group'; }], ['conversation owner', value => { delete value.items[0].target.employeeId; }],
  ['control text', value => { value.items[0].summary = 'a\u202Eb'; }], ['unpaired UTF16', value => { value.items[0].title = '\ud800'; }],
  ['response bytes', value => { value.unknown = 'x'.repeat(65536); }],
]) test(`malformed ${label} keeps prior rows/cursor and blocks automatic retry`, async t => {
  const f = fixture(t); await f.mobile.poll(); const before = f.state.notifications.items;
  f.api.mobileNotifications = async () => { const value = f.envelope(); mutate(value); return value; };
  assert.equal(await f.mobile.actions['notifications-refresh'](), false); assert.equal(f.state.notifications.items, before); assert.equal(f.state.notifications.cursor, 'cursor1'); assert(f.state.notifications.error); assert.equal(f.state.notifications.blocked, true);
  assert.equal(await f.mobile.poll(), false);
});

test('emoji scalar text remains valid while rendering escapes all HTML and never creates links', async t => {
  const f = fixture(t, { api: { mobileNotifications: async () => f.envelope({ items: [item('safe', { title: '😊 <img src=x>', summary: '<a href="https://evil.invalid">打开</a>' })] }) } });
  await f.mobile.poll(); const html = renderMobileNotifications(f.state);
  assert.match(html, /😊 &lt;img src=x&gt;/); assert.match(html, /&lt;a href=&quot;/); assert.doesNotMatch(html, /<img|<a href=/);
});

test('401 clears native and forwards authentication failure; 403/409 stop polling and explicit refresh can recover', async t => {
  const native = nativeStub(), f = fixture(t, { native }); await f.mobile.poll();
  f.api.mobileNotifications = async () => { throw Object.assign(new Error('expired'), { status: 401 }); };
  await f.mobile.poll(); assert.equal(f.failures.length, 1); assert(native.calls.some(call => call[0] === 'clear')); assert.equal(f.state.notifications.items.length, 1);
  for (const status of [403, 409]) {
    f.api.mobileNotifications = async () => { throw Object.assign(new Error('scope error'), { status }); };
    await f.mobile.actions['notifications-refresh'](); assert.equal(f.state.notifications.blocked, true); assert.equal(await f.mobile.poll(), false);
    if (status === 409) assert.match(f.state.notifications.error, /位置已失效/);
    f.api.mobileNotifications = async () => f.envelope({ nextCursor: 'restored' }); assert.equal(await f.mobile.actions['notifications-refresh'](), true); assert.equal(f.state.notifications.blocked, false);
  }
});

test('network failure keeps rows/cursor and later foreground poll can recover without issuing writes', async t => {
  const f = fixture(t); await f.mobile.poll(); f.api.mobileNotifications = async () => { throw new Error('读取超时'); }; await f.mobile.poll();
  assert.equal(f.state.notifications.cursor, 'cursor1'); assert.equal(f.state.notifications.items.length, 1); assert.equal(f.state.notifications.blocked, false);
  f.api.mobileNotifications = async () => f.envelope({ historyWindow: undefined, items: [], nextCursor: 'restored' }); assert.equal(await f.mobile.poll(), true); assert.equal(f.state.notifications.error, '');
});

test('incremental hasMore cannot keep an unchanged cursor and history window cannot be forged', async t => {
  const f = fixture(t); await f.mobile.poll();
  f.api.mobileNotifications = async () => f.envelope({ historyWindow: undefined, hasMore: true }); assert.equal(await f.mobile.poll(), false); assert.match(f.state.notifications.error, /没有前进/);
  await f.mobile.actions['notifications-refresh'](); assert.equal(f.state.notifications.cursor, 'cursor1');
});

test('click freshly resolves the exact original event and navigates only the new authorized target', async t => {
  const f = fixture(t); await f.mobile.poll(); f.api.mobileNotification = async (_ws, eventId) => f.envelope({ item: item(eventId, { target: { kind: 'task', id: 'fresh-task' } }) });
  assert.equal(await f.mobile.actions['notifications-target']({ id: 'event-one' }), true); assert.equal(f.opened[0].value.target.id, 'fresh-task'); assert.equal(f.state.notifications.unreadCount, 0);
  assert.equal(await f.mobile.actions['notifications-target']({ id: 'foreign-event' }), false); assert.equal(f.opened.length, 1);
});

for (const [name, reply] of [['wrong event', f => f.envelope({ item: item('other-event') })], ['foreign scope', f => f.envelope({ accountId: 'user-two', item: item() })],
  ['revoked target', () => { throw Object.assign(new Error('提醒不存在或已无权查看'), { status: 404 }); }]]) test(`${name} cannot open the cached target or mark it read`, async t => {
  const f = fixture(t); await f.mobile.poll(); f.api.mobileNotification = async () => reply(f);
  assert.equal(await f.mobile.actions['notifications-target']({ id: 'event-one' }), false); assert.deepEqual(f.opened, []); assert.equal(f.state.notifications.unreadCount, 1); assert(f.state.notifications.error);
});

test('target reads are single-flight and late scope/dispose receipts cannot navigate or save local reads', async t => {
  const delayed = deferred(), f = fixture(t); await f.mobile.poll(); f.api.mobileNotification = () => delayed.promise;
  const opening = f.mobile.actions['notifications-target']({ id: 'event-one' }); assert.equal(await f.mobile.actions['notifications-target']({ id: 'event-one' }), false);
  f.switchScope(); delayed.resolve(f.envelope({ item: item() }, { account: 'user-one', slug: 'one', db: 'workspace-db-one' })); assert.equal(await opening, false); assert.deepEqual(f.opened, []); assert.equal(f.storage.rows.size, 0);
});

test('navigation failure leaves item unread', async t => {
  const f = fixture(t, { onTarget: () => false }); await f.mobile.poll(); assert.equal(await f.mobile.actions['notifications-target']({ id: 'event-one' }), false); assert.equal(f.state.notifications.unreadCount, 1);
});

test('read markers persist across reload, isolate account and actual workspace, and never use shared read_at', async t => {
  const storage = memoryStorage(), f = fixture(t, { storage }); await f.mobile.poll(); assert.equal(f.mobile.actions['notifications-read-all'](), true);
  const saved = JSON.parse(storage.getItem(storeKey('user-one'))); assert.deepEqual(saved.workspaces[wsKey()], ['event-one']); assert.equal(Object.hasOwn(saved, 'read_at'), false);
  const again = fixture(t, { storage }); await again.mobile.poll(); assert.equal(again.state.notifications.unreadCount, 0);
  again.switchScope(); await again.mobile.poll(); assert.equal(again.state.notifications.unreadCount, 1);
  again.switchScope('user-two', 'one'); await again.mobile.poll(); assert.equal(again.state.notifications.unreadCount, 1);
  assert(f.calls.every(call => ['list', 'resolve'].includes(call.kind)));
});

test('read marker retention keeps only the most recent 200 unique IDs', async t => {
  const storage = memoryStorage(); storage.setItem(storeKey('user-one'), JSON.stringify({ schemaVersion: 1, accountId: 'user-one', workspaces: { [wsKey()]: Array.from({ length: 200 }, (_, index) => `read-${index}`) } }));
  const f = fixture(t, { storage }); await f.mobile.poll(); f.mobile.actions['notifications-read-all']();
  const ids = JSON.parse(storage.getItem(storeKey('user-one'))).workspaces[wsKey()]; assert.equal(ids.length, 200); assert.equal(ids[0], 'read-1'); assert.equal(ids.at(-1), 'event-one');
});

for (const [label, payload] of [['invalid JSON', '{bad'], ['foreign account', JSON.stringify({ schemaVersion: 1, accountId: 'other', workspaces: {} })],
  ['extra field', JSON.stringify({ schemaVersion: 1, accountId: 'user-one', workspaces: {}, leaked: true })],
  ['duplicate ids', JSON.stringify({ schemaVersion: 1, accountId: 'user-one', workspaces: { [wsKey()]: ['event-one', 'event-one'] } })],
  ['workspace key', JSON.stringify({ schemaVersion: 1, accountId: 'user-one', workspaces: { '__proto__': ['event-one'], [wsKey()]: ['event-one'], invalid: [] } })],
  ['oversize', 'x'.repeat(128 * 1024 + 1)]]) test(`corrupt ${label} storage is not overwritten and local memory still works with visible error`, async t => {
  const storage = memoryStorage(); storage.setItem(storeKey('user-one'), payload); const f = fixture(t, { storage }); await f.mobile.poll();
  assert.equal(f.state.notifications.unreadCount, 1); assert(f.state.notifications.storageError); assert.equal(f.mobile.actions['notifications-read-all'](), false);
  assert.equal(f.state.notifications.unreadCount, 0); assert.equal(storage.getItem(storeKey('user-one')), payload); assert.match(renderMobileNotifications(f.state), /原记录/);
});

test('storage IO and capacity failures keep original data, reject overflow and remain visible', async t => {
  const storage = memoryStorage(), workspaces = Object.fromEntries(Array.from({ length: 16 }, (_, index) => [wsKey(`other-${index}`, `db-${index}`), []]));
  storage.setItem(storeKey('user-one'), JSON.stringify({ schemaVersion: 1, accountId: 'user-one', workspaces })); const before = storage.getItem(storeKey('user-one'));
  const f = fixture(t, { storage }); await f.mobile.poll(); assert.equal(f.mobile.actions['notifications-read-all'](), false); assert.match(f.state.notifications.storageError, /16 个/); assert.equal(storage.getItem(storeKey('user-one')), before);
  const throwing = fixture(t, { storage: { getItem: () => null, setItem: () => { throw new Error('full'); } } }); await throwing.mobile.poll(); assert.equal(throwing.mobile.actions['notifications-read-all'](), false); assert.match(throwing.state.notifications.storageError, /保存失败/);
});

test('explicit logout clears only its own read preference and system subscription; 401-style reset retains reads', async t => {
  const native = nativeStub(), storage = memoryStorage(), f = fixture(t, { native, storage }); await f.mobile.poll(); f.mobile.actions['notifications-read-all'](); storage.setItem(storeKey('user-two'), 'keep');
  f.mobile.reset({ clearNative: true }); assert(storage.getItem(storeKey('user-one'))); assert.equal(storage.getItem(storeKey('user-two')), 'keep');
  f.mobile.reset({ clearNative: true, clearAccount: true }); assert.equal(storage.getItem(storeKey('user-one')), null); assert.equal(storage.getItem(storeKey('user-two')), 'keep'); assert.equal(native.calls.filter(call => call[0] === 'clear').length, 2);
});

test('permission must be granted before configure and asynchronous permission event completes only the current intent', async t => {
  const native = nativeStub({ permission: 'denied' }), f = fixture(t, { native }); await f.mobile.actions['notifications-enable']();
  assert.deepEqual(native.calls, [['permission']]); assert.equal(f.state.notifications.native.permission, 'denied');
  native.status.permission = 'granted'; await f.mobile.handleNative(JSON.stringify(native.status)); assert.deepEqual(native.calls[1], ['configure', 'one', true]); assert.equal(f.state.notifications.native.subscriptionState, 'enabling');
  await f.mobile.handleNative(JSON.stringify(native.status)); assert.equal(native.calls.filter(call => call[0] === 'configure').length, 1);
});

test('channel disabled directs user to fixed app settings and never silently enables', async t => {
  const native = nativeStub({ permission: 'channel_disabled' }), f = fixture(t, { native }); assert.equal(await f.mobile.actions['notifications-enable'](), false);
  assert.match(f.state.notifications.nativeError, /频道已关闭/); assert.equal(native.calls.filter(call => call[0] === 'configure').length, 0);
  await f.mobile.actions['notifications-settings'](); assert(native.calls.some(call => call[0] === 'settings'));
});

test('reset, disable and account changes revoke a waiting permission intent', async t => {
  const native = nativeStub({ permission: 'denied' }), f = fixture(t, { native }); await f.mobile.actions['notifications-enable'](); f.switchScope();
  native.status.permission = 'granted'; await f.mobile.handleNative(JSON.stringify(native.status)); assert.equal(native.calls.filter(call => call[0] === 'configure' && call[2]).length, 0);
  await f.mobile.actions['notifications-disable'](); assert.deepEqual(native.calls.at(-1), ['configure', 'two', false]);
});

test('native status and unsupported environment errors are local and keep the feed usable', async t => {
  const f = fixture(t); await f.mobile.poll(); assert.equal(await f.mobile.actions['notifications-enable'](), false); assert.match(f.state.notifications.nativeError, /Android/); assert.equal(f.state.notifications.items.length, 1);
  const native = nativeStub(), g = fixture(t, { native }); await g.mobile.handleNative('{broken'); assert(g.state.notifications.nativeError); assert.equal(g.state.notifications.items.length, 0);
  await g.mobile.handleNative({ available: false, enabled: false }); assert.equal(g.state.notifications.native.available, false);
});

test('old native subscription for another account is cleared before any pending click is consumed', async t => {
  const native = nativeStub({ enabled: true, subscriptionState: 'enabled', accountId: 'old-account', pendingTarget: true }), f = fixture(t, { native });
  await f.mobile.handleNative(); assert(native.calls.some(call => call[0] === 'clear')); assert.equal(native.calls.some(call => call[0] === 'consume'), false); assert.equal(f.state.notifications.native.enabled, false);
});

test('native same-workspace click consumes once and resolves event anew; cached Intent target is ignored', async t => {
  const native = nativeStub({ pendingTarget: true, accountId: 'user-one' }); native.pending.push({ accountId: 'user-one', workspaceId: 'workspace-db-one', workspaceSlug: 'one', eventId: 'native-event', target: { kind: 'task', id: 'untrusted-cached-task' } });
  const f = fixture(t, { native }); assert.equal(await f.mobile.handleNative(), true); assert.equal(f.calls[0].kind, 'resolve'); assert.equal(f.calls[0].id, 'native-event'); assert.equal(f.opened[0].value.target.id, 'chat-one');
  await f.mobile.handleNative(); assert.equal(native.calls.filter(call => call[0] === 'consume').length, 1);
});

for (const change of [{ accountId: 'foreign' }, { workspaceId: 'foreign-db' }, { workspaceSlug: 'not-visible' }, { eventId: 'https://evil.invalid' }]) test(`native click scope ${JSON.stringify(change)} is rejected without resolving`, async t => {
  const native = nativeStub({ pendingTarget: true }); native.pending.push({ accountId: 'user-one', workspaceId: 'workspace-db-one', workspaceSlug: 'one', eventId: 'event-one', ...change });
  const f = fixture(t, { native }); assert.equal(await f.mobile.handleNative(), false); assert.deepEqual(f.calls, []); assert.deepEqual(f.opened, []); assert(f.state.notifications.nativeError);
});

test('cross-workspace native click uses root authorization hook, then resolvePending fresh-resolves only after switching', async t => {
  const native = nativeStub({ pendingTarget: true }); native.pending.push({ accountId: 'user-one', workspaceId: 'workspace-db-two', workspaceSlug: 'two', eventId: 'event-two' });
  let held;
  const f = fixture(t, { native, onWorkspaceTarget: (pending, token) => { held = { pending, token }; return true; } });
  assert.equal(await f.mobile.handleNative(), true); assert.equal(held.pending.workspaceSlug, 'two'); assert.deepEqual(f.calls, []);
  assert.equal(await f.mobile.resolvePending(held.pending), false); f.switchScope(); assert.equal(await f.mobile.resolvePending(held.pending), true);
  assert.equal(f.calls[0].workspace, 'two'); assert.equal(f.calls[0].kind, 'resolve'); assert.equal(f.opened[0].value.id, 'event-two');
});

test('without a workspace hook the consumed target stays visible and can be passed back after explicit switching', async t => {
  const native = nativeStub({ pendingTarget: true }); native.pending.push({ accountId: 'user-one', workspaceId: 'workspace-db-two', workspaceSlug: 'two', eventId: 'event-two' });
  const f = fixture(t, { native }); await f.mobile.handleNative(); assert.equal(f.state.notifications.pendingTarget.eventId, 'event-two'); assert.match(f.state.notifications.nativeError, /其他工作区/);
  assert.match(renderMobileNotifications(f.state), /系统提醒等待查看/); assert.deepEqual(f.calls, []);
});

test('late native permission or click reads cannot configure/navigate after dispose', async t => {
  const permission = deferred(), native = nativeStub(), f = fixture(t, { native }); native.requestPermission = () => permission.promise;
  const enabling = f.mobile.actions['notifications-enable'](); f.mobile.dispose(); permission.resolve(JSON.stringify(native.status)); assert.equal(await enabling, false); assert.equal(native.calls.some(call => call[0] === 'configure'), false);
  assert.equal(await f.mobile.poll(), false); assert.equal(await f.mobile.handleNative(), false);
});

test('view includes accessible actions, unread labels and fixed delay guidance without exposing IDs as URLs', async t => {
  const native = nativeStub(), f = fixture(t, { native }); await f.mobile.open(); const html = renderMobileNotifications(f.state);
  for (const label of ['最近提醒', '全部标为已读', '开启消息通知', '系统通知设置', '未读：员工', '查看原聊天', '15 分钟', '重启手机后需重新打开']) assert(html.includes(label));
  assert.doesNotMatch(html, /href=/); assert.match(html, /data-action="notifications-target"/); assert.match(html, /aria-label="最近提醒"/);
});


test('pause aborts pending feed and target GETs while preserving existing rows/read/native settings', async t => {
  const native = nativeStub({ enabled: true, subscriptionState: 'enabled', accountId: 'user-one', workspaceSlug: 'one' }), f = fixture(t, { native });
  await f.mobile.open(); f.mobile.actions['notifications-read-all']();
  const original = f.state.notifications, rows = original.items, reads = original.readIds, subscription = original.native;
  const listReply = deferred(), targetReply = deferred(); let listSignal, targetSignal;
  f.api.mobileNotifications = (_ws, _query, options) => { listSignal = options.signal; return listReply.promise; };
  f.api.mobileNotification = (_ws, _eventId, options) => { targetSignal = options.signal; return targetReply.promise; };
  const listing = f.mobile.poll(), opening = f.mobile.actions['notifications-target']({ id: 'event-one' });
  f.mobile.pause(); assert.equal(listSignal.aborted, true); assert.equal(targetSignal.aborted, true);
  assert.equal(original.items, rows); assert.equal(original.readIds, reads); assert.equal(original.native, subscription);
  assert.equal(original.phase, 'ready'); assert.equal(original.resolvingId, ''); assert.equal(native.calls.some(call => call[0] === 'clear'), false);
  listReply.resolve(f.envelope({ items: [item('late')], nextCursor: 'late', historyWindow: undefined })); targetReply.resolve(f.envelope({ item: item() }));
  assert.equal(await listing, false); assert.equal(await opening, false); assert.equal(original.items, rows); assert.deepEqual(f.opened, []);
  f.api.mobileNotifications = async () => f.envelope({ historyWindow: undefined, items: [item('after-resume')], nextCursor: 'resume' });
  assert.equal(await f.mobile.poll(), true); assert(original.items.some(row => row.id === 'after-resume'));
});

test('a permission dialog pause preserves the short user enable intent without disabling the subscription', async t => {
  const native = nativeStub({ permission: 'denied' }), f = fixture(t, { native }); await f.mobile.actions['notifications-enable']();
  f.mobile.pause(); native.status.permission = 'granted'; await f.mobile.handleNative(JSON.stringify(native.status));
  assert.deepEqual(native.calls.filter(call => call[0] === 'configure'),[['configure','one',true]]);
  assert.equal(native.calls.some(call => call[0] === 'clear'), false);
});

test('a permission intent expires after two minutes even when the Activity pauses', async t => {
  t.mock.timers.enable({apis:['Date'],now:Date.now()});
  const native=nativeStub({permission:'denied'}),f=fixture(t,{native});await f.mobile.actions['notifications-enable']();
  f.mobile.pause();t.mock.timers.tick(120001);native.status.permission='granted';await f.mobile.handleNative(JSON.stringify(native.status));
  assert.equal(native.calls.some(call=>call[0]==='configure'||call[0]==='clear'),false);
});

test('a self-hosted message click resolves its exact event and ignores cached targets', async t => {
  const native = nativeStub({ pendingTarget: true, accountId: 'user-one' });
  native.pending.push({ accountId: 'user-one', workspaceId: 'workspace-db-one', workspaceSlug: 'one', eventId: 'message-event', target: { id: 'forged-chat' } });
  let f; f = fixture(t, { native, api: { mobileNotification: async (_slug, id, options) => {
    f.calls.push({ kind: 'resolve', id, options });
    return f.envelope({ item: item(id, { kind: 'message.received', title: '闲鱼运营大神', summary: '检查完成😊\n请确认：https://example.invalid/work', executionState: 'not_applicable', target: { kind: 'conversation', id: 'original-chat', employeeId: 'original-employee', messageId: 'original-message' } }) });
  } } });
  assert.equal(await f.mobile.handleNative(), true);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].kind, 'resolve'); assert.equal(f.calls[0].id, 'message-event');
  assert.equal(f.opened[0].value.target.id, 'original-chat'); assert(f.state.notifications.readIds.includes('message-event'));
});

test('a first-party message click cannot navigate after account switch, pause or permission loss', async t => {
  for (const change of ['account', 'pause', 'denied', 'wrong-scope']) {
    const delayed = deferred(), f = fixture(t, { api: { mobileNotification: () => delayed.promise } });
    const pending = { accountId: 'user-one', workspaceId: 'workspace-db-one', workspaceSlug: 'one', eventId: 'event-one' };
    const opening = f.mobile.resolvePending(pending);
    if (change === 'account') f.switchScope('user-two');
    if (change === 'pause') f.mobile.pause();
    if (change === 'denied') delayed.reject(Object.assign(new Error('not found'), { status: 404 }));
    else delayed.resolve(f.envelope({ item: item() }, change === 'wrong-scope' ? { account: 'other-account' } : { account: 'user-one', slug: 'one', db: 'workspace-db-one' }));
    assert.equal(await opening, false); assert.deepEqual(f.opened, []);
  }
});

test('old third-party delivery tickets and malformed message targets never grant navigation', async t => {
  for (const extra of [{ deliveryId: 'a'.repeat(32) }, { deliveryId: 'c'.repeat(32), eventId: 'event-one' }, { eventId: '' }]) {
    const f = fixture(t); assert.equal(await f.mobile.resolvePending({ accountId: 'user-one', workspaceId: 'workspace-db-one', workspaceSlug: 'one', ...extra }), false);
    assert.deepEqual(f.calls, []); assert.deepEqual(f.opened, []);
  }
  let f; f = fixture(t, { api: { mobileNotification: async () => f.envelope({ item: item('new-message', { kind: 'message.received', executionState: 'not_applicable', target: { kind: 'task', id: 'unrelated' } }) }) } });
  assert.equal(await f.mobile.resolvePending({ accountId: 'user-one', workspaceId: 'workspace-db-one', workspaceSlug: 'one', eventId: 'new-message' }), false); assert.deepEqual(f.opened, []);
});

test('connection state is accurate and the battery settings action remains explicit', async t => {
  const native = nativeStub({ enabled: true, subscriptionState: 'enabled', deliveryMode: 'selfhost', foregroundServiceRunning: true, connectionState: 'connected', batterySettingsAvailable: true });
  native.openBatterySettings = () => { native.calls.push(['battery']); return JSON.stringify(native.status); };
  const f = fixture(t, { native }); await f.mobile.handleNative();
  let html = renderMobileNotifications(f.state);
  assert.match(html, /消息通知已连接/); assert.match(html, /员工名字和消息内容/); assert.match(html, /后台与电池设置/);
  assert.equal(native.calls.some(row => row[0] === 'battery'), false);
  await f.mobile.actions['notifications-battery'](); assert(native.calls.some(row => row[0] === 'battery'));
  native.status.connectionState = 'backoff'; await f.mobile.handleNative(); assert.match(renderMobileNotifications(f.state), /正在连接消息通知/);
  native.status.foregroundServiceRunning = false; await f.mobile.handleNative(); assert.doesNotMatch(renderMobileNotifications(f.state), /消息通知已连接/);
  native.status.deliveryMode='unavailable'; await f.mobile.handleNative();
  assert.match(renderMobileNotifications(f.state), /消息接收当前未运行/); assert.doesNotMatch(renderMobileNotifications(f.state), /补充提醒已开启/);
  delete native.status.deliveryMode; await f.mobile.handleNative(); assert.match(renderMobileNotifications(f.state), /补充提醒已开启/);
});

test('v2 permits bounded real multiline message previews but rejects legacy schema and bad cursor aliases', async t => {
  let f; f = fixture(t, { api: { mobileNotifications: async () => f.envelope({ items: [item('reply', { kind: 'message.received', executionState: 'not_applicable', title: '员'.repeat(50), summary: '消息正文😊\n'.repeat(45) })] }) } });
  assert.equal(await f.mobile.poll(), true); assert.match(renderMobileNotifications(f.state), /新消息/);
  for (const extra of [{schemaVersion: 1}, {cursor: 'different'}, {items:[item('reply',{summary:'x'.repeat(1025)})]}]) {
    f.api.mobileNotifications=async()=>f.envelope(extra); assert.equal(await f.mobile.actions['notifications-refresh'](), false);
  }
});

test('an outdated server stops automatic notification polling with an actionable message', async t => {
  const f=fixture(t, {api:{mobileNotifications:async()=>{throw Object.assign(new Error('请求失败（404）'),{status:404});}}});
  assert.equal(await f.mobile.poll(),false); assert.match(f.state.notifications.error,/服务尚未更新/);
  assert.equal(f.state.notifications.blocked,true); assert.equal(await f.mobile.poll(),false);
});
