import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as setDispatchDeadline, clearTimeout as clearDispatchDeadline } from 'node:timers';
import { createController } from '../web/controller.js';
import { createChatPreferences } from '../web/chat-preferences.js';
import { initialState } from '../web/model.js';
import { render } from '../web/view.js';

const employees = [{ id: 'one', name: '员工甲', runtime: 'Other' }, { id: 'two', name: '员工乙', runtime: 'Other' }];
const workspaces = [{ slug: 'workspace-one', role: 'owner' }, { slug: 'workspace-two', role: 'member' }];
const canonical = (workspace, employee) => `canonical/${workspace}/${employee}`;
const local = (accountId = 'user-one', workspaceId = 'workspace-one') => ({ accountId, workspaceId });
const principal = user_id => ({ user_id });
const tick = () => new Promise(resolve => setImmediate(resolve));
const form = text => { const values = new FormData(); values.set('draft', text); return values; };
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function storageFixture() {
  const values = new Map();
  return { values, get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
    getItem: key => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
}
function threads(workspace = 'workspace-one') {
  return employees.map(employee => ({ conversationId: canonical(workspace, employee.id), employeeId: employee.id, employee: { ...employee },
    title: '长期聊天', preview: '已存历史', updatedAt: '2026-10-17T10:00:00.000Z', unreadCount: 0, latestMessageId: `history-${employee.id}`, messageCount: 1 }));
}
function history(id) { const employee = id.split('/').at(-1); return { id, employee_id: employee, messages: [{ id: `history-${employee}`, role: 'assistant', content: '已存历史' }] }; }
function fixture(t, { storage = storageFixture(), userId = 'user-one', workspaceId = 'workspace-one', overrides = {}, stateOverrides = {} } = {}) {
  const state = { ...initialState(), phase: 'ready', user: principal(userId), workspace: workspaces.find(workspace => workspace.slug === workspaceId),
    workspaces, employees: employees.map(employee => ({ ...employee })), chatThreads: threads(workspaceId), ...stateOverrides };
  const posts = [], frames = [];
  const api = {
    authMe: async () => principal(userId), login: async () => principal(userId), workspaces: async () => ({ workspaces }), logout: async () => ({ ok: true }),
    employees: async () => ({ employees: employees.map(employee => ({ ...employee })) }), bots: async () => ({ bots: [] }), tasks: async () => ({ tasks: [] }), devices: async () => ({ devices: [] }),
    chats: async workspace => ({ chats: threads(workspace), unreadCount: 0 }), conversation: async id => history(id),
    getEmployeeConversation: async (workspace, employee) => history(canonical(workspace, employee.id)),
    sendMessage: async (id, body) => { posts.push({ id, body }); return { id: 'saved-message' }; },
    ...overrides,
  };
  const controller = createController({ state, api, storage, render: value => frames.push(render(value)) });
  t.after(() => controller.dispose());
  return { state, api, storage, controller, posts, frames };
}
const readDraft = (storage, employee = 'one', scope = local()) => createChatPreferences({ storage }).getDraft(scope, employee);
async function pendingSend(fixture, text, receipt) {
  let sent = false, deadline;
  const dispatched = deferred();
  fixture.api.sendMessage = async (id, body) => { fixture.posts.push({ id, body }); sent = true; dispatched.resolve(); return receipt.promise; };
  const promise = fixture.controller.submit('chat', form(text));
  // WebCrypto runs outside the JS event loop: immediate turns do not measure
  // whether the original explicit send has passed its real digest and storage.
  try {
    await Promise.race([dispatched.promise, new Promise((_, reject) => {
      deadline = setDispatchDeadline(() => reject(new Error('the original explicit send must reach the mocked API')), 5000);
    })]);
  } finally { clearDispatchDeadline(deadline); }
  assert.equal(sent, true, 'the original explicit send must reach the mocked API');
  return { promise };
}
function nativeEvents(t) {
  const events = new EventTarget(), add = Object.getOwnPropertyDescriptor(globalThis, 'addEventListener'), remove = Object.getOwnPropertyDescriptor(globalThis, 'removeEventListener');
  Object.defineProperty(globalThis, 'addEventListener', { configurable: true, value: events.addEventListener.bind(events) });
  Object.defineProperty(globalThis, 'removeEventListener', { configurable: true, value: events.removeEventListener.bind(events) });
  t.after(() => { if (add) Object.defineProperty(globalThis, 'addEventListener', add); else delete globalThis.addEventListener; if (remove) Object.defineProperty(globalThis, 'removeEventListener', remove); else delete globalThis.removeEventListener; });
  return events;
}

test('pending typing flushes on dispose and a rebuilt controller restores only text', async t => {
  const storage = storageFixture(), first = fixture(t, { storage });
  await first.controller.actions.chat({ id: 'one' });
  await first.controller.change({ name: 'draft', value: '重启后继续写 😀' });
  first.state.attachments = [{ name: 'not-persisted.png', content: 'image-bytes' }];
  first.controller.dispose();
  const second = fixture(t, { storage }); await second.controller.actions.chat({ id: 'one' });
  assert.equal(second.state.draft, '重启后继续写 😀'); assert.deepEqual(second.state.attachments, []);
  assert.equal(second.state.chatDraftPreviews.one, '重启后继续写 😀');
  assert(![...storage.values.values()].some(value => value.includes('image-bytes')));
  assert.equal(first.posts.length + second.posts.length, 0);
});

test('typing waits 250ms and edits replace the pending debounce without losing text', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t); await f.controller.actions.chat({ id: 'one' });
  await f.controller.change({ name: 'draft', value: '初稿' });
  t.mock.timers.tick(249); assert.equal(readDraft(f.storage), '');
  await f.controller.change({ name: 'draft', value: '修改后的初稿' });
  t.mock.timers.tick(249); assert.equal(readDraft(f.storage), '');
  t.mock.timers.tick(1); assert.equal(readDraft(f.storage), '修改后的初稿');
  assert.equal(f.state.chatDraftPreviews.one, '修改后的初稿');
});

test('back flushes typing immediately before its debounce expires', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t); await f.controller.actions.chat({ id: 'one' });
  await f.controller.change({ name: 'draft', value: '返回前未停顿的文字' });
  assert.equal(readDraft(f.storage), '');
  await f.controller.actions.back();
  assert.equal(f.state.page, 'home'); assert.equal(readDraft(f.storage), '返回前未停顿的文字');
  assert.equal(f.state.chatDraftPreviews.one, '返回前未停顿的文字');
});

test('chat detail and model settings return to the exact original conversation and draft', async t => {
  const original = 'historical-conversation-one';
  const f = fixture(t, {
    stateOverrides: { chatThreads: [{ ...threads()[0], conversationId: original }] },
    overrides: { conversation: async id => ({ id, employee_id: 'one', messages: [] }) },
  });
  await f.controller.actions.chat({ id: 'one' });
  await f.controller.change({ name: 'draft', value: '查看设置后继续写' });
  await f.controller.actions['employee-detail']({ id: 'one' });
  assert.equal(f.state.page, 'detail');
  await f.controller.actions['bot-settings']({ id: 'one' });
  await f.controller.actions.back(); assert.equal(f.state.page, 'detail');
  await f.controller.actions.back();
  assert.equal(f.state.page, 'chat'); assert.equal(f.state.selectedEmployee.id, 'one');
  assert.equal(f.state.conversation.id, original); assert.equal(f.state.draft, '查看设置后继续写');
  await f.controller.actions.back(); assert.equal(f.state.page, 'home');
  assert.equal(f.posts.length, 0);
});

test('repeated detail and settings taps cannot add duplicate return pages', async t => {
  const f = fixture(t); await f.controller.actions.chat({ id: 'one' });
  await f.controller.actions['employee-detail']({ id: 'one' });
  await f.controller.actions['employee-detail']({ id: 'one' });
  assert.equal(f.state.settingsTrail.length, 1);
  await f.controller.actions.settings(); await f.controller.actions.settings();
  assert.equal(f.state.settingsTrail.length, 2);
  await f.controller.actions.back(); assert.equal(f.state.page, 'detail');
  await f.controller.actions.back(); assert.equal(f.state.page, 'chat');
});

test('a detached old composer input cannot replace another employee draft', async t => {
  const f = fixture(t); await f.controller.actions.chat({ id: 'one' });
  await f.controller.actions.chat({ id: 'two' });
  await f.controller.change({ name: 'draft', value: '乙的草稿' });
  await f.controller.change({ target: { name: 'draft', value: '甲的迟到输入', isConnected: false } });
  assert.equal(f.state.draft, '乙的草稿');
  await f.controller.actions.back(); assert.equal(readDraft(f.storage, 'two'), '乙的草稿');
});

test('native pause flushes typing immediately and resume keeps the original chat and draft', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const events = nativeEvents(t), f = fixture(t);
  await f.controller.boot(); await f.controller.actions.chat({ id: 'one' });
  await f.controller.change({ name: 'draft', value: '切后台之前的文字' });
  assert.equal(readDraft(f.storage), '');
  events.dispatchEvent(new Event('ziwei:pause'));
  assert.equal(readDraft(f.storage), '切后台之前的文字');
  events.dispatchEvent(new Event('ziwei:resume')); await tick();
  assert.equal(f.state.draft, '切后台之前的文字'); assert.equal(f.state.conversation.id, canonical('workspace-one', 'one'));
  assert.equal(f.posts.length, 0);
});

test('employee and workspace switching retain isolated draft text and never dispatch it', async t => {
  const f = fixture(t); await f.controller.actions.chat({ id: 'one' });
  await f.controller.change({ name: 'draft', value: '一号工作区甲' });
  await f.controller.actions.chat({ id: 'two' }); assert.equal(f.state.draft, '');
  await f.controller.change({ name: 'draft', value: '一号工作区乙' });
  await f.controller.actions['select-workspace']({ id: 'workspace-two' });
  await f.controller.actions.chat({ id: 'one' }); assert.equal(f.state.draft, ''); assert.equal(f.state.chatDraftPreviews.one, undefined);
  await f.controller.change({ name: 'draft', value: '二号工作区甲' });
  await f.controller.actions['select-workspace']({ id: 'workspace-one' });
  await f.controller.actions.chat({ id: 'one' }); assert.equal(f.state.draft, '一号工作区甲');
  await f.controller.actions.chat({ id: 'two' }); assert.equal(f.state.draft, '一号工作区乙');
  assert.equal(readDraft(f.storage, 'one', local('user-one', 'workspace-two')), '二号工作区甲');
  assert.equal(f.posts.length, 0);
});

test('a different account cannot see former drafts or pins, while session expiry keeps recovery for the original account', async t => {
  const storage = storageFixture(), first = fixture(t, { storage });
  await first.controller.actions.chat({ id: 'one' }); await first.controller.change({ name: 'draft', value: '原账号待发送' });
  await first.controller.actions['chat-pin']({ id: canonical('workspace-one', 'one') });
  first.api.chats = async () => { throw Object.assign(new Error('session expired'), { status: 401 }); };
  await first.controller.refresh(); await tick();
  assert.equal(first.state.phase, 'login'); assert.equal(first.state.user, null);
  assert.equal(readDraft(storage), '原账号待发送');
  const other = fixture(t, { storage, userId: 'other-user' }); await other.controller.actions.chat({ id: 'one' });
  assert.equal(other.state.draft, ''); assert.deepEqual(other.state.pinnedChatIds, []); assert.deepEqual(other.state.chatDraftPreviews, {});
  const recovered = fixture(t, { storage }); await recovered.controller.actions.chat({ id: 'one' });
  assert.equal(recovered.state.draft, '原账号待发送'); assert.deepEqual(recovered.state.pinnedChatIds, [canonical('workspace-one', 'one')]);
});

test('explicit logout clears this account across workspaces and leaves another account intact', async t => {
  const storage = storageFixture(), prefs = createChatPreferences({ storage });
  for (const scope of [local(), local('user-one', 'workspace-two'), local('other-user')]) { prefs.saveDraft(scope, 'one', scope.accountId); prefs.togglePin(scope, canonical(scope.workspaceId, 'one')); }
  const f = fixture(t, { storage }); await f.controller.actions.chat({ id: 'one' });
  await f.controller.change({ name: 'draft', value: '退出前新的未落盘文字' });
  await f.controller.actions.logout(); assert.equal(f.state.phase, 'login');
  const fresh = createChatPreferences({ storage });
  for (const scope of [local(), local('user-one', 'workspace-two')]) { assert.equal(fresh.getDraft(scope, 'one'), ''); assert.deepEqual(fresh.pinnedIds(scope), []); }
  assert.equal(fresh.getDraft(local('other-user'), 'one'), 'other-user');
  assert.deepEqual(fresh.pinnedIds(local('other-user')), [canonical('workspace-one', 'one')]);
});

test('an accepted send clears its unchanged original draft durably', async t => {
  const f = fixture(t); await f.controller.actions.chat({ id: 'one' });
  await f.controller.change({ name: 'draft', value: '明确发送的文字' });
  await f.controller.submit('chat', form('明确发送的文字'));
  assert.equal(f.posts.length, 1); assert.equal(f.state.draft, ''); assert.equal(readDraft(f.storage), '');
  assert.equal(f.state.chatDraftPreviews.one, undefined);
});

test('a late accepted send cannot clear text edited while that send was pending', async t => {
  const f = fixture(t), receipt = deferred(); await f.controller.actions.chat({ id: 'one' });
  const sending = await pendingSend(f, '第一次发送', receipt);
  await f.controller.change({ name: 'draft', value: '正在写下一条' });
  receipt.resolve({ id: 'accepted' }); await sending.promise;
  assert.equal(f.state.draft, '正在写下一条'); assert.equal(f.posts.length, 1);
  await f.controller.actions.back(); assert.equal(readDraft(f.storage), '正在写下一条');
});

test('a send receipt for a previous employee clears only its original draft', async t => {
  const f = fixture(t), receipt = deferred(); await f.controller.actions.chat({ id: 'one' });
  const sending = await pendingSend(f, '甲的消息', receipt);
  await f.controller.actions.chat({ id: 'two' }); await f.controller.change({ name: 'draft', value: '乙的独立草稿' }); await f.controller.actions.back();
  receipt.resolve({ id: 'accepted' }); await sending.promise;
  assert.equal(readDraft(f.storage, 'one'), ''); assert.equal(readDraft(f.storage, 'two'), '乙的独立草稿');
  assert.equal(f.posts.length, 1);
});

test('a late accepted send clears the visible original composer after leaving and returning', async t => {
  const f = fixture(t), receipt = deferred(); await f.controller.actions.chat({ id: 'one' });
  const sending = await pendingSend(f, '已经明确发送的原文', receipt);
  await f.controller.actions.back(); await f.controller.actions.chat({ id: 'one' });
  await f.controller.change({ name: 'draft', value: '已经明确发送的原文' });
  receipt.resolve({ id: 'accepted' }); await sending.promise;
  assert.equal(f.state.draft, '');
  await f.controller.actions.back();
  assert.equal(readDraft(f.storage), ''); assert.equal(f.posts.length, 1);
});

test('returning to the original employee and editing before its receipt keeps the new draft', async t => {
  const f = fixture(t), receipt = deferred(); await f.controller.actions.chat({ id: 'one' });
  const sending = await pendingSend(f, '明确发送的原文', receipt);
  await f.controller.actions.chat({ id: 'two' }); await f.controller.actions.chat({ id: 'one' });
  await f.controller.change({ name: 'draft', value: '返回后写的下一条' });
  receipt.resolve({ id: 'accepted' }); await sending.promise;
  assert.equal(f.state.draft, '返回后写的下一条');
  await f.controller.actions.back();
  assert.equal(readDraft(f.storage), '返回后写的下一条'); assert.equal(f.posts.length, 1);
});

test('composition start protects a new IME edit even before its first changed input value', async t => {
  const f = fixture(t), receipt = deferred(); await f.controller.actions.chat({ id: 'one' });
  const sending = await pendingSend(f, '正在发送的文字', receipt);
  await f.controller.change({ type: 'compositionstart', target: { name: 'draft', value: '正在发送的文字', isConnected: true } });
  receipt.resolve({ id: 'accepted' }); await sending.promise;
  assert.equal(f.state.draft, '正在发送的文字');
  await f.controller.change({ type: 'compositionend', target: { name: 'draft', value: '输入法刚提交的新文字', isConnected: true } });
  await f.controller.actions.back();
  assert.equal(readDraft(f.storage), '输入法刚提交的新文字'); assert.equal(f.posts.length, 1);
});

test('a previous workspace send receipt never deletes the current workspace draft', async t => {
  const f = fixture(t), receipt = deferred(); await f.controller.actions.chat({ id: 'one' });
  const sending = await pendingSend(f, '原工作区明确发送', receipt);
  await f.controller.actions['select-workspace']({ id: 'workspace-two' }); await f.controller.actions.chat({ id: 'one' });
  await f.controller.change({ name: 'draft', value: '另一个工作区未发送' }); await f.controller.actions.back();
  receipt.resolve({ id: 'accepted' }); await sending.promise;
  assert.equal(readDraft(f.storage), '');
  assert.equal(readDraft(f.storage, 'one', local('user-one', 'workspace-two')), '另一个工作区未发送');
});

test('a failed send keeps the original draft durably and neither navigation nor reload resends it', async t => {
  const storage = storageFixture(), f = fixture(t, { storage }); await f.controller.actions.chat({ id: 'one' });
  f.api.sendMessage = async (id, body) => { f.posts.push({ id, body }); throw new Error('尚未收到发送回执'); };
  await f.controller.submit('chat', form('需要保留以便核对的原消息'));
  assert.match(f.state.error, /尚未收到/); assert.equal(f.state.draft, '需要保留以便核对的原消息');
  await f.controller.actions.back(); f.controller.dispose();
  const fresh = fixture(t, { storage }); await fresh.controller.actions.chat({ id: 'one' });
  assert.equal(fresh.state.draft, '需要保留以便核对的原消息'); assert.equal(f.posts.length, 1); assert.equal(fresh.posts.length, 0);
});

test('disposing an old controller prevents its late send receipt from deleting a newer controller draft', async t => {
  const storage = storageFixture(), old = fixture(t, { storage }), receipt = deferred();
  await old.controller.actions.chat({ id: 'one' }); const sending = await pendingSend(old, '旧实例发送', receipt);
  old.controller.dispose();
  const fresh = fixture(t, { storage }); await fresh.controller.actions.chat({ id: 'one' });
  await fresh.controller.change({ name: 'draft', value: '新实例未发送文字' }); await fresh.controller.actions.back();
  receipt.resolve({ id: 'accepted' }); await sending.promise;
  assert.equal(readDraft(storage), '新实例未发送文字');
  assert.equal(fresh.posts.length, 0);
});

test('expiry and relogin in the same controller prevent an old send from clearing the new generation draft', async t => {
  const f = fixture(t), receipt = deferred(); await f.controller.actions.chat({ id: 'one' });
  const sending = await pendingSend(f, '过期前的发送', receipt), chats = f.api.chats;
  f.api.chats = async () => { throw Object.assign(new Error('expired'), { status: 401 }); };
  await f.controller.refresh(); await tick(); assert.equal(f.state.phase, 'login');
  f.api.chats = chats;
  await f.controller.submit('login', new FormData()); await f.controller.actions.chat({ id: 'one' });
  await f.controller.change({ name: 'draft', value: '重新登录后下一条' }); await f.controller.actions.back();
  receipt.resolve({ id: 'accepted' }); await sending.promise;
  assert.equal(readDraft(f.storage), '重新登录后下一条');
});

test('full storage reports a visible local error but leaves history and in-memory draft usable', async t => {
  const storage = storageFixture(); storage.setItem = () => { throw new Error('quota full'); };
  const f = fixture(t, { storage }); await f.controller.actions.chat({ id: 'one' });
  await f.controller.change({ name: 'draft', value: '还可以写的文字' }); await f.controller.actions.back();
  assert.match(f.state.chatPreferencesError, /仅在本次使用/);
  assert(f.frames.some(markup => markup.includes('仅在本次使用')));
  await f.controller.actions.chat({ id: 'one' });
  assert.equal(f.state.conversation.id, canonical('workspace-one', 'one')); assert.equal(f.state.messages[0].content, '已存历史');
  assert.equal(f.state.draft, '还可以写的文字'); assert.equal(f.state.error, ''); assert.equal(f.posts.length, 0);
});

test('corrupt preferences remain visible as a local problem while the authorized history still opens', async t => {
  const storage = storageFixture();
  createChatPreferences({ storage }).saveDraft(local(), 'one', 'seed');
  const key = [...storage.values.keys()][0]; storage.values.set(key, '{malformed preferences');
  const f = fixture(t, { storage }); await f.controller.actions.chat({ id: 'one' });
  assert.equal(f.state.conversation.id, canonical('workspace-one', 'one')); assert.equal(f.state.messages.length, 1);
  assert.match(f.state.chatPreferencesError, /数据损坏/); assert(f.frames.some(markup => markup.includes('数据损坏')));
  await f.controller.change({ name: 'draft', value: '当前仍能编辑' }); await f.controller.actions.back();
  assert.equal(storage.values.get(key), '{malformed preferences');
  await f.controller.actions.chat({ id: 'one' }); assert.equal(f.state.draft, '当前仍能编辑');
  assert.equal(f.posts.length, 0);
});

test('pinning accepts authorized canonical IDs, rejects arbitrary IDs and survives a rebuilt controller', async t => {
  const storage = storageFixture(), f = fixture(t, { storage });
  await f.controller.actions.navigate({ tab: 'chat' });
  assert.equal(await f.controller.actions['chat-pin']({ id: 'foreign-conversation' }), false);
  assert.equal(await f.controller.actions['chat-pin']({ id: 'one' }), false, 'an employee identity is not a conversation identity');
  assert.deepEqual(f.state.pinnedChatIds, []);
  const id = canonical('workspace-one', 'one');
  assert.equal(await f.controller.actions['chat-pin']({ id }), true); assert.deepEqual(f.state.pinnedChatIds, [id]);
  f.controller.dispose();
  const fresh = fixture(t, { storage }); await fresh.controller.actions.navigate({ tab: 'chat' });
  assert.deepEqual(fresh.state.pinnedChatIds, [id]);
  assert.equal(await fresh.controller.actions['chat-pin']({ id }), true); assert.deepEqual(fresh.state.pinnedChatIds, []);
  assert.equal(f.posts.length + fresh.posts.length, 0);
});
