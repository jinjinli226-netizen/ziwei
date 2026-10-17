import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatInbox } from '../web/chat-inbox.js';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const row = (overrides = {}) => ({
  conversationId: 'conversation-one', employeeId: 'employee-one',
  employee: { id: 'employee-one', name: '员工一', runtime: 'Hermes', avatar: '/employee-avatar', visibility: 'workspace' },
  title: '原主聊天', preview: '最新消息', updatedAt: '2026-10-17T05:00:00.000Z',
  unreadCount: 3, latestMessageId: 'm3', messageCount: 3, ...overrides,
});
function fixture(apiOverrides = {}, stateOverrides = {}, canMarkVisible = () => true) {
  let epoch = 1, clock = 10000;
  const calls = [], failures = [], frames = [];
  const state = { user: { user_id: 'user-one' }, workspace: { slug: 'workspace-one' }, page: 'chat',
    selectedEmployee: { id: 'employee-one' }, conversation: { id: 'conversation-one' },
    messages: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }], employees: [],
    chatThreads: [row()], unreadCount: 3, error: '', ...stateOverrides };
  const current = () => ({ epoch, scope: `${state.user?.user_id}:${state.workspace.slug}`, employeeId: state.selectedEmployee?.id });
  const valid = token => token?.epoch === epoch && token.scope === `${state.user?.user_id}:${state.workspace.slug}`;
  const api = { chats: async () => ({ chats: [row()], unreadCount: 3 }),
    markConversationRead: async (conversationId, body) => { calls.push({ conversationId, ...body }); return { conversationId, lastReadMessageId: body.messageId, unreadCount: 0 }; }, ...apiOverrides };
  const inbox = createChatInbox({ state, api, current, valid, draw: () => frames.push(state.chatThreadsResource.phase), fail: (error, token) => failures.push({ error, token }), now: () => clock, canMarkVisible });
  return { state, inbox, api, current, calls, failures, frames,
    advance: amount => { clock += amount; }, expire: () => { epoch++; } };
}
const target = messageId => ({ conversationId: 'conversation-one', messageId });

test('the inbox is single-flight and displays server identities without waiting for employees', async t => {
  const response = deferred(), workspaces = [];
  const f = fixture({ chats: workspace => { workspaces.push(workspace); return response.promise; } }, { chatThreads: [], unreadCount: 0 });
  t.after(() => f.inbox.dispose());
  const first = f.inbox.load(), same = f.inbox.load();
  assert.equal(first, same); assert.equal(f.state.chatThreadsResource.phase, 'loading');
  await tick(); assert.deepEqual(workspaces, ['workspace-one']);
  response.resolve({ chats: [row()], unreadCount: 3 }); await first;
  assert.equal(f.state.chatThreads[0].employee.id, 'employee-one');
  assert.equal(f.state.chatThreads[0].conversationId, 'conversation-one');
  assert.deepEqual(f.state.employees, []); assert.equal(f.state.unreadCount, 3);
  assert.deepEqual(f.state.chatThreadsResource, { phase: 'ready', error: '', lastUpdated: '1970-01-01T00:00:10.000Z' });
});

test('malformed rows cannot invent a conversation or employee identity', async t => {
  const f = fixture({ chats: async () => ({ chats: [row({ conversationId: '' }), row({ employee: { id: 'another', name: 'wrong' } }), row({ unreadCount: -1 }), row(), row({ title: 'duplicate' }), row({ conversationId: 'other', preview: 'x'.repeat(300) })], unreadCount: 6 }) });
  t.after(() => f.inbox.dispose()); await f.inbox.load();
  assert.deepEqual(f.state.chatThreads.map(thread => thread.conversationId), ['conversation-one', 'other']);
  assert.equal(f.state.chatThreads[0].title, '原主聊天'); assert.equal(f.state.chatThreads[1].preview.length, 180);
  assert.equal(f.state.unreadCount, 6);
  f.api.chats = async () => ({ chats: [], unreadCount: -1 }); await f.inbox.load();
  assert.equal(f.state.chatThreads.length, 2); assert.equal(f.state.unreadCount, 6);
  assert.equal(f.state.chatThreadsResource.phase, 'error'); assert.equal(f.state.error, '');
});

test('old workspace and disposed list responses cannot repopulate the inbox', async () => {
  const old = deferred(), fresh = deferred();
  const f = fixture({ chats: workspace => workspace === 'workspace-one' ? old.promise : fresh.promise });
  const before = f.inbox.load(); await tick();
  f.state.workspace = { slug: 'workspace-two' }; f.inbox.reset();
  const after = f.inbox.load(); await tick();
  fresh.resolve({ chats: [row({ conversationId: 'new-conversation' })], unreadCount: 4 }); await after;
  old.resolve({ chats: [row({ conversationId: 'stale-conversation' })], unreadCount: 19 }); await before;
  assert.equal(f.state.chatThreads[0].conversationId, 'new-conversation'); assert.equal(f.state.unreadCount, 4);
  const stopped = deferred(); f.api.chats = () => stopped.promise;
  const pending = f.inbox.load(); await tick(); f.inbox.dispose();
  stopped.resolve({ chats: [], unreadCount: 0 }); await pending;
  assert.equal(f.state.chatThreads[0].conversationId, 'new-conversation');
});

test('list errors preserve cached rows and remain separate from global errors', async t => {
  const f = fixture({ chats: async () => { throw new Error('列表暂不可用'); } }); t.after(() => f.inbox.dispose());
  const messages = f.state.messages; await f.inbox.load();
  assert.equal(f.state.chatThreads[0].conversationId, 'conversation-one'); assert.equal(f.state.unreadCount, 3);
  assert.equal(f.state.chatThreadsResource.phase, 'error'); assert.equal(f.state.chatThreadsResource.error, '列表暂不可用');
  assert.equal(f.state.error, ''); assert.equal(f.state.messages, messages);
});

test('only a message in the currently open chat may be marked visible', async t => {
  const f = fixture(); t.after(() => f.inbox.dispose());
  assert.equal(await f.inbox.markVisible(target('absent')), false);
  assert.equal(await f.inbox.markVisible({ conversationId: 'another', messageId: 'm1' }), false);
  f.state.page = 'home'; assert.equal(await f.inbox.markVisible(target('m1')), false);
  f.state.page = 'chat'; f.state.messages = []; assert.equal(await f.inbox.markVisible(target('m1')), false);
  assert.deepEqual(f.calls, []);
});

test('successful visibility acknowledgements never edit history and do not repeat or regress', async t => {
  const f = fixture(); t.after(() => f.inbox.dispose());
  const messages = f.state.messages, conversation = f.state.conversation;
  assert.equal(await f.inbox.markVisible(target('m3')), true);
  assert.equal(await f.inbox.markVisible(target('m3')), false);
  assert.equal(await f.inbox.markVisible(target('m1')), false);
  assert.deepEqual(f.calls, [{ conversationId: 'conversation-one', messageId: 'm3' }]);
  assert.equal(f.state.unreadCount, 0); assert.equal(f.state.chatThreads[0].unreadCount, 0);
  assert.equal(f.state.messages, messages); assert.equal(f.state.conversation, conversation);
});

test('a pending read coalesces only newer cursors from the same visible message list', async t => {
  const first = deferred(), calls = [];
  const f = fixture({ markConversationRead: (conversationId, { messageId }) => {
    calls.push(messageId); return calls.length === 1 ? first.promise : Promise.resolve({ conversationId, lastReadMessageId: messageId, unreadCount: 0 });
  } }); t.after(() => f.inbox.dispose());
  const pending = f.inbox.markVisible(target('m1')); await tick();
  assert.equal(f.inbox.markVisible(target('m1')), pending);
  f.inbox.markVisible(target('m2')); f.inbox.markVisible(target('m3')); f.inbox.markVisible(target('m2'));
  assert.deepEqual(calls, ['m1']);
  first.resolve({ conversationId: 'conversation-one', lastReadMessageId: 'm1', unreadCount: 2 }); await pending;
  assert.deepEqual(calls, ['m1', 'm3']); assert.equal(f.state.unreadCount, 0);
});

test('an uncomparable cursor is not queued behind an in-flight read or dispatched after leaving', async t => {
  const first = deferred(), calls = [];
  const f = fixture({ markConversationRead: (_conversationId, { messageId }) => { calls.push(messageId); return first.promise; } }); t.after(() => f.inbox.dispose());
  const pending = f.inbox.markVisible(target('m1')); await tick();
  f.state.messages = [{ id: 'm3' }]; f.inbox.markVisible(target('m3'));
  f.state.messages = [{ id: 'm1' }, { id: 'm3' }]; f.inbox.markVisible(target('m3'));
  f.state.page = 'home';
  first.resolve({ conversationId: 'conversation-one', lastReadMessageId: 'm1', unreadCount: 2 }); await pending;
  assert.deepEqual(calls, ['m1']); assert.equal(f.state.unreadCount, 2);
});

test('a visibility gate blocks queued read dispatch until a later actual-visible event', async t => {
  const first = deferred(), calls = []; let allowed = true;
  const f = fixture({ markConversationRead: (conversationId, { messageId }) => {
    calls.push(messageId); return calls.length === 1 ? first.promise : Promise.resolve({ conversationId, lastReadMessageId: messageId, unreadCount: 0 });
  } }, {}, () => allowed); t.after(() => f.inbox.dispose());
  const pending = f.inbox.markVisible(target('m1')); await tick(); f.inbox.markVisible(target('m3'));
  allowed = false;
  first.resolve({ conversationId: 'conversation-one', lastReadMessageId: 'm1', unreadCount: 2 }); await pending;
  assert.deepEqual(calls, ['m1']); assert.equal(f.state.unreadCount, 2);
  await f.inbox.markVisible(target('m3')); assert.deepEqual(calls, ['m1']);
  allowed = true; await tick(); assert.deepEqual(calls, ['m1'], 'restoring visibility alone must not create a read POST');
  await f.inbox.markVisible(target('m3')); assert.deepEqual(calls, ['m1', 'm3']);
});

test('the visibility gate is checked again immediately before a scheduled read POST starts', async t => {
  let allowed = true; const f = fixture({}, {}, () => allowed); t.after(() => f.inbox.dispose());
  const scheduled = f.inbox.markVisible(target('m3')); allowed = false;
  assert.equal(await scheduled, false); assert.deepEqual(f.calls, []);
  allowed = true; await f.inbox.markVisible(target('m3')); assert.equal(f.calls.length, 1);
});

test('a server cursor ahead of this viewport also suppresses older visible cursors', async t => {
  const calls = [];
  const f = fixture({ markConversationRead: async (conversationId, { messageId }) => { calls.push(messageId); return { conversationId, lastReadMessageId: 'm3', unreadCount: 0 }; } }); t.after(() => f.inbox.dispose());
  await f.inbox.markVisible(target('m1')); await f.inbox.markVisible(target('m2'));
  assert.deepEqual(calls, ['m1']);
});

test('uncomparable history uses the server monotonic cursor but still deduplicates each accepted id', async t => {
  const calls = [];
  const f = fixture({ markConversationRead: async (conversationId, { messageId }) => { calls.push(messageId); return { conversationId, lastReadMessageId: 'newer-on-another-client', unreadCount: 0 }; } }, { messages: [{ id: 'm3' }] }); t.after(() => f.inbox.dispose());
  await f.inbox.markVisible(target('m3'));
  f.state.messages = [{ id: 'old-unknown' }]; await f.inbox.markVisible(target('old-unknown')); await f.inbox.markVisible(target('old-unknown'));
  assert.deepEqual(calls, ['m3', 'old-unknown']); assert.equal(f.state.unreadCount, 0);
});

test('a list snapshot that began before a successful read cannot restore stale unread badges', async t => {
  const index = deferred(), read = deferred();
  const f = fixture({ chats: () => index.promise, markConversationRead: () => read.promise }); t.after(() => f.inbox.dispose());
  const loading = f.inbox.load(); await tick(); const marking = f.inbox.markVisible(target('m3')); await tick();
  read.resolve({ conversationId: 'conversation-one', lastReadMessageId: 'm3', unreadCount: 0 }); await marking;
  index.resolve({ chats: [row()], unreadCount: 3 }); await loading;
  assert.equal(f.state.unreadCount, 0); assert.equal(f.state.chatThreads[0].unreadCount, 0);
  assert.notEqual(f.state.chatThreadsResource.phase, 'loading');
  f.api.chats = async () => ({ chats: [row({ unreadCount: 1 })], unreadCount: 1 });
  await f.inbox.load(); assert.equal(f.state.unreadCount, 1);
});

test('an accepted forward can invalidate a pending inbox read without blocking a fresh read', async t => {
  const old = deferred(); let calls = 0;
  const f = fixture({ chats: () => ++calls === 1 ? old.promise : Promise.resolve({ chats: [row({ preview: '已转发记录' })], unreadCount: 1 }) }); t.after(() => f.inbox.dispose());
  const before = f.inbox.load(); await tick(); f.inbox.invalidate();
  await f.inbox.load(); old.resolve({ chats: [row()], unreadCount: 3 }); await before;
  assert.equal(f.state.chatThreads[0].preview, '已转发记录'); assert.equal(f.state.unreadCount, 1);
});

test('failed reads do not block history or set a global error and retry only after cooldown plus an event', async t => {
  let attempts = 0;
  const f = fixture({ markConversationRead: async () => { attempts++; throw new Error('已读接口暂不可用'); } }); t.after(() => f.inbox.dispose());
  const messages = f.state.messages; await f.inbox.markVisible(target('m3'));
  assert.equal(f.state.error, ''); assert.equal(f.state.messages, messages); assert.equal(f.state.chatReadError, '已读接口暂不可用');
  assert.equal(f.state.unreadCount, 3);
  await f.inbox.markVisible(target('m3')); f.advance(7999); await f.inbox.markVisible(target('m3')); assert.equal(attempts, 1);
  f.advance(1); await tick(); assert.equal(attempts, 1, 'elapsed time alone must never issue a POST');
  await f.inbox.markVisible(target('m3')); assert.equal(attempts, 2);
});

test('malformed read receipts retain badges and use the same retry cooldown', async t => {
  let attempts = 0;
  const f = fixture({ markConversationRead: async () => { attempts++; return { conversationId: 'wrong-conversation', lastReadMessageId: 'm3', unreadCount: 0 }; } }); t.after(() => f.inbox.dispose());
  assert.equal(await f.inbox.markVisible(target('m3')), false);
  assert.equal(f.state.unreadCount, 3); assert.equal(f.state.chatThreads[0].unreadCount, 3);
  assert.match(f.state.chatReadError, /返回无效/); assert.equal(f.state.error, '');
  await f.inbox.markVisible(target('m3')); assert.equal(attempts, 1);
});

test('a receipt for an unloaded thread refreshes authoritative inbox counts without creating rows', async t => {
  const index = deferred(); let reads = 0;
  const f = fixture({ chats: () => { reads++; return index.promise; } }, { chatThreads: [], unreadCount: 7 }); t.after(() => f.inbox.dispose());
  await f.inbox.markVisible(target('m3')); await tick();
  assert.equal(reads, 1); assert.deepEqual(f.state.chatThreads, []); assert.equal(f.state.unreadCount, 7);
  index.resolve({ chats: [row({ unreadCount: 0 })], unreadCount: 4 }); await tick();
  assert.equal(f.state.chatThreads.length, 1); assert.equal(f.state.unreadCount, 4);
});

test('an old employee read 401 still expires the same account, while old workspace 401 is ignored', async t => {
  const response = deferred(); const f = fixture({ markConversationRead: () => response.promise }); t.after(() => f.inbox.dispose());
  const pending = f.inbox.markVisible(target('m1')); await tick();
  f.state.selectedEmployee = { id: 'employee-two' }; f.state.conversation = { id: 'conversation-two' };
  response.reject(Object.assign(new Error('expired'), { status: 401 })); await pending;
  assert.equal(f.failures.length, 1); assert.equal(f.failures[0].error.status, 401);

  const other = deferred(); f.state.conversation = { id: 'conversation-one' }; f.api.markConversationRead = () => other.promise;
  const old = f.inbox.markVisible(target('m2')); await tick(); f.state.workspace = { slug: 'workspace-two' }; f.inbox.reset();
  other.reject(Object.assign(new Error('old expired'), { status: 401 })); await old;
  assert.equal(f.failures.length, 1); assert.deepEqual(f.state.chatThreads, []); assert.equal(f.state.unreadCount, 0);
});

test('a stale read success after scope reset cannot change a new workspace badge', async t => {
  const read = deferred(); const f = fixture({ markConversationRead: () => read.promise }); t.after(() => f.inbox.dispose());
  const pending = f.inbox.markVisible(target('m3')); await tick(); f.expire(); f.inbox.reset();
  f.state.chatThreads = [row({ unreadCount: 8 })]; f.state.unreadCount = 8;
  read.resolve({ conversationId: 'conversation-one', lastReadMessageId: 'm3', unreadCount: 0 }); await pending;
  assert.equal(f.state.unreadCount, 8); assert.equal(f.state.chatThreads[0].unreadCount, 8);
});

test('list 401 is handled for the current scope even after invalidation, and ignored after scope reset', async t => {
  const old = deferred(); const f = fixture({ chats: () => old.promise }); t.after(() => f.inbox.dispose());
  const pending = f.inbox.load(); await tick(); f.inbox.invalidate();
  old.reject(Object.assign(new Error('expired'), { status: 401 })); await pending; assert.equal(f.failures.length, 1);
  const another = deferred(); f.api.chats = () => another.promise; const stale = f.inbox.load(); await tick();
  f.state.workspace = { slug: 'workspace-two' }; f.inbox.reset();
  another.reject(Object.assign(new Error('old expired'), { status: 401 })); await stale; assert.equal(f.failures.length, 1);
});
