import test from 'node:test';
import assert from 'node:assert/strict';
import { createForwarding, isForwardableMessage, orderedForwardMessages, FORWARD_MESSAGE_LIMIT, FORWARD_NOTE_LIMIT } from '../web/forwarding.js';
import { initialState, scopeKey } from '../web/model.js';

const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
async function called(f) {
  let timer;
  try { await Promise.race([f.called, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('forward endpoint was not called')), 1000); })]); }
  finally { clearTimeout(timer); }
}
const form = values => { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; };
function memoryStorage() {
  const values = new Map();
  return { values, get length() { return values.size; }, key: index => [...values.keys()][index] || null, getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
function receipt(sourceConversationId, body, extra = {}) {
  return { forward: { id: 'receipt', sourceConversationId, targetConversationId: 'target-main', targetEmployeeId: body.targetEmployeeId, mode: body.mode }, message: { id: 'saved', conversation_id: 'target-main' },
    ...(body.mode === 'execute' ? { execution: { id: 'execution', type: 'conversation.message', status: 'pending', created_at: '2026-10-17T00:00:00.000Z', acked_at: null, completed_at: null, expires_at: null, error: null } } : {}), ...extra };
}
const receiptFor = (f, extra) => receipt(...f.calls[0], extra);
function fixture({ state: overrides = {}, storage = memoryStorage(), forward, accepted, opened } = {}) {
  const source = { id: 'source', name: '原员工', runtime: 'Hermes' }, target = { id: 'target', name: '目标员工', config: { permissions: { mode: 'read_only' } } };
  const messages = [{ id: 'first', role: 'user', content: '原文：请整理方案' }, { id: 'second', role: 'assistant', content: '真实回执', attachments: [{ name: '原图片.png', mimeType: 'image/png', contentEncoding: 'base64', content: 'YWJjZA==' }] }];
  const state = { ...initialState(), phase: 'ready', page: 'chat', user: { user_id: 'account' }, workspace: { slug: 'work', role: 'owner' }, employees: [source, target], selectedEmployee: source,
    conversation: { id: 'original', employee_id: source.id, execution: { status: 'running' } }, messages, draft: '未发送草稿', attachments: [{ content: 'draft-image' }], ...overrides };
  let epoch = 0, rendered = 0, module;
  const calls = [], failed = [], acceptedCalls = [], openedCalls = [], forbidden = [], started = deferred();
  const current = () => ({ epoch, scope: scopeKey(state), employeeId: state.selectedEmployee?.id });
  const valid = (token, employee = false) => token.epoch === epoch && token.scope === scopeKey(state) && (!employee || token.employeeId === state.selectedEmployee?.id);
  const fail = (error, token, employee) => {
    failed.push({ error, token, employee });
    if (error.status === 401 && valid(token, false)) { epoch++; module.reset(); state.phase = 'login'; state.user = null; state.workspace = null; }
  };
  const api = { forwardMessages: async (...args) => { calls.push(args); started.resolve(); return forward ? forward(...args) : receipt(...args); },
    sendMessage: (...args) => { forbidden.push(['sendMessage', args]); throw new Error('不应普通发送'); }, getEmployeeConversation: (...args) => { forbidden.push(['getEmployeeConversation', args]); throw new Error('不应创建目标会话'); } };
  module = createForwarding({ state, api, current, valid, fail, storage, draw: () => rendered++, onAccepted: async (...args) => { acceptedCalls.push(args); await accepted?.(...args); }, onOpenTarget: async (...args) => { openedCalls.push(args); await opened?.(...args); } });
  return { module, state, storage, calls, failed, acceptedCalls, openedCalls, forbidden, source, target, called: started.promise, get rendered() { return rendered; }, invalidate() { epoch++; }, valid, current };
}
async function prepare(f, ids = ['first']) {
  await f.module.actions['message-menu']({ id: ids[0] });
  if (ids.length > 1) { await f.module.actions['forward-select'](); for (const id of ids.slice(1)) await f.module.actions['forward-toggle']({ id }); await f.module.actions['forward-next'](); }
  else await f.module.actions['forward-single']();
  await f.module.actions['forward-target']({ id: 'target' });
  assert.equal(f.state.forward.phase, 'confirm');
}

test('only stable ordinary user/assistant messages can be forwarded, and selection follows source order', () => {
  const source = [{ id: 'a', role: 'user' }, { id: 'b', role: 'assistant' }];
  for (const message of [{ role: 'user' }, { id: 1, role: 'user' }, { id: ' a ', role: 'user' }, { id: 'x\ny', role: 'user' }, { id: 'c', role: 'system' }, { id: 'd', role: 'tool' }, { id: 'e', role: 'user', status: 'failed' }, { id: 'f', role: 'assistant', status: 'sending' }, { id: 'g', role: 'user', forward: {} }, { id: 'h', role: 'user', type: 'forward' }, { id: 'i', role: 'assistant', metadata: { forward: {} } }]) assert.equal(isForwardableMessage(message), false);
  assert(source.every(isForwardableMessage));
  assert.deepEqual(orderedForwardMessages(source, ['b', 'a', 'b', 'missing']).map(message => message.id), ['a', 'b']);
});

test('single and multi-select navigation preserve source draft and attachments without any writes', async t => {
  const f = fixture(); t.after(() => f.module.dispose()); const attachments = f.state.attachments;
  await f.module.actions['message-menu']({ id: 'second' }); assert.equal(f.state.forward.phase, 'menu'); assert.deepEqual(f.state.forward.selectedIds, ['second']);
  await f.module.actions['forward-select'](); await f.module.actions['forward-toggle']({ id: 'first' });
  assert.deepEqual(f.module.selectedMessages().map(message => message.id), ['first', 'second']);
  await f.module.actions['forward-next'](); assert.equal(f.state.forward.phase, 'target');
  await f.module.actions['forward-target']({ id: 'target' }); await f.module.actions['forward-back'](); assert.equal(f.state.forward.phase, 'target');
  await f.module.actions['forward-back'](); assert.equal(f.state.forward.phase, 'select');
  await f.module.actions['forward-cancel'](); assert.equal(f.state.forward, null); assert.equal(f.state.draft, '未发送草稿'); assert.equal(f.state.attachments, attachments);
  assert.equal(f.calls.length, 0); assert.equal(f.forbidden.length, 0);
});

test('reference is the default and makes exactly one atomic forward call without dispatch or target creation', async t => {
  const f = fixture(); t.after(() => f.module.dispose()); await prepare(f, ['second', 'first']);
  const sourceConversation = f.state.conversation, messages = f.state.messages;
  assert.equal(await f.module.submit(form({ 'forward-note': '  仅供参考  ', 'forward-mode': 'reference', targetEmployeeId: 'target' })), true);
  assert.equal(f.calls.length, 1); const [sourceId, body] = f.calls[0];
  assert.equal(sourceId, 'original'); assert.deepEqual(body.messageIds, ['first', 'second']); assert.equal(body.targetEmployeeId, 'target'); assert.equal(body.mode, 'reference'); assert.equal(body.note, '仅供参考'); assert.match(body.clientRequestId, /^[A-Za-z0-9._:-]{1,128}$/);
  assert.deepEqual(Object.keys(body).sort(), ['clientRequestId', 'messageIds', 'mode', 'note', 'targetEmployeeId'].sort());
  assert.equal(f.forbidden.length, 0); assert.equal(f.state.sending, undefined); assert.equal(f.state.busy, false); assert.equal(f.state.conversation, sourceConversation); assert.equal(f.state.messages, messages); assert.equal(f.state.draft, '未发送草稿');
  assert.equal(f.state.forward.phase, 'complete'); assert.match(f.state.notice, /仅保存记录/); assert.equal(f.acceptedCalls.length, 1); assert.equal(f.openedCalls.length, 0); assert.equal(f.storage.length, 0);
});

test('execute is an explicit mode on the same atomic endpoint and respects a server permission rejection', async t => {
  const f = fixture({ forward: async () => { throw Object.assign(new Error('目标员工不能执行'), { status: 403 }); } }); t.after(() => f.module.dispose()); await prepare(f);
  f.module.change({ name: 'forward-mode', value: 'execute' });
  assert.equal(await f.module.submit(), false); assert.equal(f.calls.length, 1); assert.equal(f.calls[0][1].mode, 'execute'); assert.equal(f.forbidden.length, 0); assert.equal(f.state.forward.phase, 'confirm'); assert.match(f.state.forward.error, /不能执行/); assert.equal(f.acceptedCalls.length, 0);
});

test('source execution and read-only target tools do not block storing a reference', async t => {
  const f = fixture(); t.after(() => f.module.dispose()); await prepare(f); assert.equal(await f.module.submit(), true); assert.equal(f.calls[0][1].mode, 'reference'); assert.equal(f.state.conversation.execution.status, 'running');
});

test('a double submit while the receipt is pending issues only one POST', async t => {
  const pending = deferred(), f = fixture({ forward: () => pending.promise }); t.after(() => { f.module.dispose(); pending.resolve({}); }); await prepare(f);
  const first = f.module.submit(); await called(f); assert.equal(f.calls.length, 1); assert.equal(f.state.forward.phase, 'submitting');
  assert.equal(await f.module.submit(), false); assert.equal(await f.module.actions['forward-retry'](), false); assert.equal(f.calls.length, 1);
  pending.resolve(receiptFor(f)); assert.equal(await first, true);
});

test('uncertain receipt uses the same persisted request ID on an explicit retry and never persists chat content', async t => {
  let attempts = 0; const f = fixture({ forward: async (...args) => { if (++attempts === 1) throw Object.assign(new Error('network vanished'), { uncertain: true }); return receipt(...args, { duplicate: true }); } }); t.after(() => f.module.dispose()); await prepare(f);
  assert.equal(await f.module.submit({ note: '记得看看原图片' }), false); assert.equal(f.state.forward.phase, 'uncertain'); assert.match(f.state.forward.error, /核对目标聊天.*原转发标识/); assert.equal(f.calls.length, 1); await tick(); assert.equal(f.calls.length, 1);
  const saved = JSON.parse([...f.storage.values.values()][0]); assert.deepEqual(Object.keys(saved).sort(), ['clientRequestId', 'fingerprintHash']); assert.match(saved.fingerprintHash, /^[a-f0-9]{64}$/); assert.equal(saved.clientRequestId, f.calls[0][1].clientRequestId);
  assert.doesNotMatch([...f.storage.values.values()].join(''), /记得|原文|原图片|YWJjZA|target|first/);
  assert.equal(await f.module.actions['forward-retry'](), true); assert.equal(f.calls.length, 2); assert.deepEqual(f.calls[1], f.calls[0]); assert.equal(f.storage.length, 0);
});

test('retry after re-opening the source reuses the saved hash identity, while changed payloads get a new ID', async t => {
  const storage = memoryStorage(), f = fixture({ storage, forward: async () => { throw Object.assign(new Error('lost'), { uncertain: true }); } }); t.after(() => f.module.dispose());
  await prepare(f); await f.module.submit({ note: 'same note' }); const originalId = f.calls[0][1].clientRequestId;
  f.module.reset(); await prepare(f); await f.module.submit({ note: 'same note' }); assert.equal(f.calls[1][1].clientRequestId, originalId);
  assert.equal(f.module.change({ name: 'forward-note', value: 'different note' }), false); assert.equal(await f.module.submit({ note: 'different note' }), false); assert.equal(f.calls.length, 2);
  f.module.reset(); await prepare(f); await f.module.submit({ note: 'different note' }); assert.notEqual(f.calls[2][1].clientRequestId, originalId);
  const noteId = f.calls[2][1].clientRequestId; f.module.reset(); await prepare(f); f.module.change({ name: 'forward-mode', value: 'execute' }); await f.module.submit({ note: 'different note' }); assert.notEqual(f.calls[3][1].clientRequestId, noteId);
});

test('current selection is validated against visible source messages and another visible employee', async t => {
  const f = fixture(); t.after(() => f.module.dispose());
  assert.deepEqual(f.module.targets().map(employee => employee.id), ['target']);
  assert.equal(await f.module.actions['message-menu']({ id: 'not-a-message' }), false); assert(f.state.forward == null);
  await prepare(f); assert.equal(await f.module.submit({ targetEmployeeId: 'source' }), false); assert.equal(f.calls.length, 0); assert.match(f.state.forward.error, /另一位员工/);
  assert.equal(await f.module.submit({ targetEmployeeId: 'unseen' }), false); assert.equal(f.calls.length, 0);
  await f.module.actions['forward-target']({ id: 'target' }); f.state.forward.selectedIds.push('forged'); assert.equal(await f.module.submit(), false); assert.equal(f.calls.length, 0); assert.match(f.state.forward.error, /已更新或不可转发/);
});

test('source polling retains selected IDs and removes only selections that are no longer eligible', async t => {
  const f = fixture(); t.after(() => f.module.dispose()); await prepare(f, ['second', 'first']); const data = f.state.forward;
  f.state.messages = f.state.messages.map(message => ({ ...message })); f.state.messages.push({ id: 'new', role: 'assistant', content: '新消息' });
  assert.equal(f.module.synchronize(), false); assert.equal(f.state.forward, data); assert.deepEqual(f.module.selectedMessages().map(message => message.id), ['first', 'second']);
  f.state.messages = f.state.messages.filter(message => message.id !== 'first'); assert.equal(f.module.synchronize(), true); assert.deepEqual(data.selectedIds, ['second']); assert.equal(data.phase, 'select'); assert.match(data.error, /重新选择/); assert.equal(f.calls.length, 0);
});

test('an uncertain request is not silently changed by a source poll', async t => {
  const f = fixture({ forward: async () => { throw Object.assign(new Error('lost'), { uncertain: true }); } }); t.after(() => f.module.dispose()); await prepare(f, ['first', 'second']); await f.module.submit();
  const request = f.state.forward.request; f.state.messages = f.state.messages.slice(1); assert.equal(f.module.synchronize(), false); assert.deepEqual(f.state.forward.selectedIds, ['first', 'second']); assert.equal(f.state.forward.request, request);
  assert.equal(await f.module.actions['forward-retry'](), false); assert.equal(f.calls.length, 2); assert.deepEqual(f.calls[1], f.calls[0]); assert.equal(f.state.forward.phase, 'uncertain');
});

test('late acceptance after cancellation or another employee opens does not affect the current view', async t => {
  for (const leave of [f => f.module.actions['forward-cancel'](), f => { f.state.selectedEmployee = f.target; f.state.conversation = { id: 'other', employee_id: 'target' }; f.module.reset(); }]) {
    const pending = deferred(), f = fixture({ forward: () => pending.promise }); t.after(() => f.module.dispose()); await prepare(f); const submission = f.module.submit(); await called(f);
    await leave(f); f.state.notice = '当前界面提示'; pending.resolve(receiptFor(f)); assert.equal(await submission, false);
    assert.equal(f.state.notice, '当前界面提示'); assert.equal(f.state.forward, null); assert.equal(f.acceptedCalls.length, 0); assert.equal(f.openedCalls.length, 0); assert.equal(f.state.draft, '未发送草稿');
  }
});

test('late non-authentication failure after a workspace change is ignored', async t => {
  const pending = deferred(), f = fixture({ forward: () => pending.promise }); t.after(() => f.module.dispose()); await prepare(f); const submission = f.module.submit(); await called(f);
  f.invalidate(); f.module.reset(); f.state.workspace = { slug: 'another' }; f.state.error = '新工作区';
  pending.reject(new Error('旧工作区转发失败')); assert.equal(await submission, false); assert.equal(f.state.error, '新工作区'); assert.equal(f.state.forward, null); assert.equal(f.failed.length, 0);
});

test('late 401 after modal cancellation still invalidates the current account, but never a later login', async t => {
  for (const laterLogin of [false, true]) {
    const pending = deferred(), f = fixture({ forward: () => pending.promise }); t.after(() => f.module.dispose()); await prepare(f); const submission = f.module.submit(); await called(f); await f.module.actions['forward-cancel']();
    if (laterLogin) { f.invalidate(); f.state.user = { user_id: 'new-account' }; }
    pending.reject(Object.assign(new Error('expired'), { status: 401 })); assert.equal(await submission, false); assert.equal(f.failed.length, 1); assert.equal(f.failed[0].employee, false);
    assert.equal(f.state.phase, laterLogin ? 'ready' : 'login'); if (laterLogin) assert.equal(f.state.user.user_id, 'new-account');
  }
});

test('only an explicit accepted-target action opens the other conversation', async t => {
  const f = fixture(); t.after(() => f.module.dispose()); await prepare(f); assert.equal(await f.module.actions['forward-open-target'](), false); await f.module.submit();
  assert.equal(f.openedCalls.length, 0); assert.equal(await f.module.actions['forward-open-target'](), true); assert.equal(f.state.forward, null); assert.equal(f.openedCalls.length, 1); assert.equal(f.openedCalls[0][0].employeeId, 'target'); assert.equal(f.openedCalls[0][0].conversationId, 'target-main');
});

test('refresh failure after accepted forwarding never converts success to a retry', async t => {
  const f = fixture({ accepted: async () => { throw new Error('列表读取失败'); } }); t.after(() => f.module.dispose()); await prepare(f); assert.equal(await f.module.submit(), true); assert.equal(f.state.forward.phase, 'complete'); assert.equal(f.calls.length, 1); assert.equal(await f.module.submit(), false); assert.equal(f.storage.length, 0);
});

test('target removal while a request is in flight cannot undo its accepted receipt', async t => {
  const pending = deferred(), f = fixture({ forward: () => pending.promise }); t.after(() => f.module.dispose()); await prepare(f); const submission = f.module.submit(); await called(f); f.state.employees = [f.source];
  pending.resolve(receiptFor(f)); assert.equal(await submission, true); assert.equal(f.state.forward.phase, 'complete'); assert.equal(f.acceptedCalls.length, 1); assert.match(f.state.notice, /目标员工/); assert.equal(f.storage.length, 0);
});

test('selection, text, image and note limits reject the whole forward without clipping or a POST', async t => {
  assert.equal(FORWARD_MESSAGE_LIMIT, 20); assert.equal(FORWARD_NOTE_LIMIT, 4000);
  const cases = [
    { messages: Array.from({ length: 21 }, (_, i) => ({ id: `m${i}`, role: 'user', content: 'a' })) },
    { messages: [{ id: 'm0', role: 'user', content: 'a'.repeat(100001) }] },
    { messages: [{ id: 'm0', role: 'user', attachments: Array.from({ length: 21 }, () => ({ url: 'https://example.invalid/image.png' })) }] },
    { messages: [{ id: 'm0', role: 'user', attachments: [{ url: 'https://example.invalid/image.png', size: 10 * 1024 * 1024 + 1 }] }] },
    { messages: [{ id: 'm0', role: 'user', content: 'a' }], note: 'a'.repeat(4001) },
  ];
  for (const { messages, note = '' } of cases) {
    const f = fixture({ state: { messages } }); t.after(() => f.module.dispose()); await prepare(f, [messages[0].id]); f.state.forward.selectedIds = messages.map(message => message.id);
    assert.equal(await f.module.submit({ note }), false); assert.equal(f.calls.length, 0); assert.equal(f.state.messages, messages); assert.deepEqual(f.state.forward.selectedIds, messages.map(message => message.id)); assert.match(f.state.forward.error, /最多|超过|不能超过/);
  }
});

test('unavailable request persistence blocks the write and explicit logout clears only the current account keys', async t => {
  const broken = fixture({ storage: { getItem: () => null, setItem: () => { throw new Error('quota'); } } }); t.after(() => broken.module.dispose()); await prepare(broken); assert.equal(await broken.module.submit(), false); assert.equal(broken.calls.length, 0); assert.match(broken.state.forward.error, /无法保存转发标识/);
  const f = fixture({ forward: async () => { throw Object.assign(new Error('lost'), { uncertain: true }); } }); t.after(() => f.module.dispose()); await prepare(f); await f.module.submit(); f.storage.setItem('ziwei.manager.forward.v1:another-account:work:original', 'unrelated'); f.storage.setItem('other-setting', 'kept');
  f.module.reset({ clearAccount: true }); assert.equal(f.state.forward, null); assert.equal(f.storage.length, 2); assert.equal(f.storage.getItem('other-setting'), 'kept'); assert.equal(f.storage.getItem('ziwei.manager.forward.v1:another-account:work:original'), 'unrelated');
});

test('leaving the source before hashing completes prevents the POST', async t => {
  const f = fixture(); t.after(() => f.module.dispose()); await prepare(f); const submission = f.module.submit(); f.module.reset(); f.invalidate(); f.state.page = 'home'; assert.equal(await submission, false); assert.equal(f.calls.length, 0); assert.equal(f.state.forward, null);
});

test('non-chat pages and employee/conversation mismatches cannot open a forwarding selection', async t => {
  for (const overrides of [{ page: 'report' }, { page: 'home' }, { conversation: { id: 'wrong', employee_id: 'another' } }, { phase: 'login' }]) {
    const f = fixture({ state: overrides }); t.after(() => f.module.dispose()); assert.equal(await f.module.actions['message-menu']({ id: 'first' }), false); assert.equal(f.calls.length, 0); assert(f.state.forward == null);
  }
});

for (const refusal of [
  { status: 403, code: 'FORBIDDEN' },
  { status: 404, code: 'NOT_FOUND' },
  { status: 409, code: 'FORWARD_REQUEST_CONFLICT' },
  { status: 409, code: 'FORWARD_RECEIPT_INVALID' },
]) test(`an unknown attempt remains locked after retry ${refusal.status}/${refusal.code} until its matching receipt returns`, async t => {
  let attempts = 0;
  const f = fixture({ forward: async (...args) => {
    if (++attempts === 1) throw Object.assign(new Error('receipt lost'), { uncertain: true });
    if (attempts === 2) throw Object.assign(new Error('later refusal'), refusal);
    return receipt(...args, { duplicate: true });
  } }); t.after(() => f.module.dispose()); await prepare(f, ['first', 'second']);
  assert.equal(await f.module.submit({ note: '原附言', mode: 'execute' }), false);
  const originalRequest = f.state.forward.request, originalBody = JSON.stringify(originalRequest.body), saved = [...f.storage.values.values()][0];
  assert.equal(await f.module.actions['forward-retry'](), false);
  assert.equal(f.state.forward.phase, 'uncertain'); assert.equal(f.state.forward.request, originalRequest); assert.equal(JSON.stringify(originalRequest.body), originalBody); assert.equal([...f.storage.values.values()][0], saved);
  assert.equal(f.module.change({ name: 'forward-note', value: '新任务' }), false); assert.equal(f.module.change({ name: 'forward-mode', value: 'reference' }), false); assert.equal(await f.module.actions['forward-target']({ id: 'source' }), false); assert.equal(await f.module.submit({ note: '新任务', mode: 'reference' }), false);
  assert.equal(f.calls.length, 2); assert.deepEqual(f.calls[1], f.calls[0]); assert.equal(f.acceptedCalls.length, 0); assert.equal(f.state.draft, '未发送草稿');
  assert.equal(await f.module.actions['forward-retry'](), true); assert.deepEqual(f.calls[2], f.calls[0]); assert.equal(f.state.forward.phase, 'complete'); assert.equal(f.storage.length, 0); assert.equal(f.acceptedCalls.length, 1);
});

for (const code of ['FORWARD_REQUEST_CONFLICT', 'FORWARD_RECEIPT_INVALID']) test(`the first ${code} response preserves the original request and body`, async t => {
  let attempts = 0;
  const f = fixture({ forward: async (...args) => { if (++attempts === 1) throw Object.assign(new Error('conflicting receipt'), { status: 409, code }); return receipt(...args, { duplicate: true }); } }); t.after(() => f.module.dispose()); await prepare(f);
  assert.equal(await f.module.submit({ note: '保留原请求' }), false); assert.equal(f.state.forward.phase, 'uncertain'); assert.equal(f.storage.length, 1);
  const originalRequest = f.state.forward.request; assert.equal(originalRequest.body.note, '保留原请求'); assert.equal(f.module.change({ name: 'forward-note', value: '另一个请求' }), false);
  assert.equal(await f.module.actions['forward-retry'](), true); assert.equal(f.calls[0][1].clientRequestId, originalRequest.clientRequestId); assert.deepEqual(f.calls[1], f.calls[0]); assert.equal(f.storage.length, 0);
});

test('a first known typed 4xx rejection can be edited and uses a new key for changed parameters', async t => {
  for (const status of [403, 404, 409, 413]) {
    let attempts = 0;
    const f = fixture({ forward: async (...args) => { if (++attempts === 1) throw Object.assign(new Error('known refusal'), { status, code: status === 409 ? 'TARGET_BUSY' : 'REQUEST_REJECTED' }); return receipt(...args); } }); t.after(() => f.module.dispose()); await prepare(f);
    assert.equal(await f.module.submit({ note: '原参数' }), false); assert.equal(f.state.forward.phase, 'confirm'); assert.equal(f.state.forward.request, null); assert.equal(f.storage.length, 0);
    assert.equal(f.module.change({ name: 'forward-note', value: '新参数' }), true); assert.equal(await f.module.submit(), true); assert.notEqual(f.calls[1][1].clientRequestId, f.calls[0][1].clientRequestId); assert.equal(f.calls[1][1].note, '新参数');
  }
});

test('closing and reopening an unknown request cannot clear its identity when the old API now returns 404', async t => {
  let attempts = 0;
  const f = fixture({ forward: async (...args) => { if (++attempts === 1) throw Object.assign(new Error('unknown'), { uncertain: true }); if (attempts === 2) throw Object.assign(new Error('API rolled back'), { status: 404 }); return receipt(...args, { duplicate: true }); } }); t.after(() => f.module.dispose()); await prepare(f); await f.module.submit({ note: 'same' });
  const saved = [...f.storage.values.values()][0]; await f.module.actions['forward-cancel'](); await prepare(f); assert.equal(await f.module.submit({ note: 'same' }), false);
  assert.equal(f.state.forward.phase, 'uncertain'); assert.equal([...f.storage.values.values()][0], saved); assert.deepEqual(f.calls[1], f.calls[0]);
  assert.equal(await f.module.actions['forward-retry'](), true); assert.deepEqual(f.calls[2], f.calls[0]); assert.equal(f.storage.length, 0);
});

test('a server 5xx or unclassified failure after posting is uncertain rather than an editable rejection', async t => {
  for (const error of [new Error('unclassified failure'), Object.assign(new Error('server failed after commit'), { status: 500 })]) {
    const f = fixture({ forward: async () => { throw error; } }); t.after(() => f.module.dispose()); await prepare(f); assert.equal(await f.module.submit(), false); assert.equal(f.state.forward.phase, 'uncertain'); assert.equal(f.storage.length, 1); assert.equal(f.module.change({ name: 'forward-note', value: 'new' }), false);
  }
});

test('a malformed or mismatched success cannot clear the original request identity', async t => {
  const invalidResults = [
    () => ({}),
    (source, body) => receipt(source, body, { forward: { id: 'wrong', sourceConversationId: 'another', targetConversationId: 'target-main', targetEmployeeId: body.targetEmployeeId, mode: body.mode } }),
    (source, body) => receipt(source, body, { message: { id: 'saved', conversation_id: 'another' } }),
    (source, body) => receipt(source, body, { execution: { id: 'unexpected', type: 'conversation.message', status: 'pending' } }),
  ];
  for (const invalidResult of invalidResults) {
    let attempts = 0;
    const f = fixture({ forward: async (...args) => ++attempts === 1 ? invalidResult(...args) : receipt(...args, { duplicate: true }) }); t.after(() => f.module.dispose()); await prepare(f);
    assert.equal(await f.module.submit(), false); assert.equal(f.state.forward.phase, 'uncertain'); assert.equal(f.storage.length, 1); assert.equal(f.acceptedCalls.length, 0);
    assert.equal(await f.module.actions['forward-retry'](), true); assert.deepEqual(f.calls[1], f.calls[0]); assert.equal(f.storage.length, 0);
  }
});

test('an execute receipt accepts the compact execution contract without events or expanded payloads', async t => {
  const f = fixture(); t.after(() => f.module.dispose()); await prepare(f); assert.equal(await f.module.submit({ mode: 'execute' }), true);
  assert.deepEqual(Object.keys(f.state.forward.result.execution).sort(), ['id', 'type', 'status', 'created_at', 'acked_at', 'completed_at', 'expires_at', 'error'].sort());
  assert.equal(f.state.forward.phase, 'complete'); assert.match(f.state.notice, /请求处理/); assert.equal(f.storage.length, 0);
});

test('starting another forward after closing an unknown one cannot overwrite its retained identity', async t => {
  let accept = false;
  const f = fixture({ forward: async (...args) => { if (!accept) throw Object.assign(new Error('lost'), { uncertain: true }); return receipt(...args, { duplicate: true }); } }); t.after(() => f.module.dispose());
  await prepare(f); await f.module.submit({ note: '原请求' }); const originalId = f.calls[0][1].clientRequestId, originalRecord = [...f.storage.values.values()][0];
  await f.module.actions['forward-cancel'](); await prepare(f); await f.module.submit({ note: '另一请求' }); const secondId = f.calls[1][1].clientRequestId;
  assert.notEqual(secondId, originalId); assert.equal(f.storage.length, 2); assert([...f.storage.values.values()].includes(originalRecord));
  await f.module.actions['forward-cancel'](); await prepare(f); accept = true; assert.equal(await f.module.submit({ note: '原请求' }), true);
  assert.equal(f.calls[2][1].clientRequestId, originalId); assert.equal(f.storage.length, 1); assert.equal(JSON.parse([...f.storage.values.values()][0]).clientRequestId, secondId);
});

test('an unclassified initial conflict cannot clear the retained forward identity', async t => {
  const f=fixture({forward:async()=>{throw Object.assign(new Error('unclassified conflict'),{status:409});}});
  t.after(()=>f.module.dispose());await prepare(f);assert.equal(await f.module.submit(),false);
  assert.equal(f.state.forward.phase,'uncertain');assert.equal(f.storage.length,1);
});

test('starting a new forward clears a previous acceptance notice',async t=>{
  const f=fixture({state:{notice:'earlier forward was accepted'}});t.after(()=>f.module.dispose());
  await prepare(f);assert.equal(f.state.notice,'');
});
