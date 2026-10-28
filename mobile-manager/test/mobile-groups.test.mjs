import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as setDispatchDeadline, clearTimeout as clearDispatchDeadline } from 'node:timers';
import { createMobileGroups, GROUP_PAGE_SIZE, mobileGroupGate } from '../web/mobile-groups.js';
import { renderMobileGroups } from '../web/mobile-groups-view.js';

const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function waitForDispatch(dispatched) {
  let deadline;
  // The actual mocked API call follows asynchronous WebCrypto and persistence;
  // count neither event-loop turns nor CPU-dependent polling iterations.
  try {
    await Promise.race([dispatched.promise, new Promise((_, reject) => {
      deadline = setDispatchDeadline(() => reject(new Error('the explicit group action must reach the mocked API')), 5000);
    })]);
  } finally { clearDispatchDeadline(deadline); }
}
const storage = () => { const values = new Map(); return { values, get length() { return values.size; }, key: index => [...values.keys()][index] || null, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; };
const roomId = 'group_existing';
function fixture(overrides = {}) {
  let epoch = 1, serial = 0;
  const store = overrides.storage || storage(), posts = [], gets = [], actions = new Map();
  const employees = ['source', 'target', 'other', 'second'].map(id => ({ id, name: `姓名-${id}`, runtime: 'Hermes', status: 'active' }));
  const bot = id => ({ id, workspace: 'workspace-one', employee: employees.find(employee => employee.id === id), kind: 'employee', revision: 4, control_epoch: 7,
    configuration_state: 'initialized', control_state: 'active', validation: { status: 'succeeded' }, config: { permissions: { mode: 'execute' }, collaboration: { enabled: true, targetEmployeeIds: id === 'source' ? ['target'] : ['source'] } } });
  const state = { user: { user_id: 'account-one' }, workspace: { slug: 'workspace-one' }, page: 'home', employees, bots: employees.map(employee => bot(employee.id)), ...overrides.state };
  const room = { room_id: roomId, name: '持久协作群', members: ['source', 'target'].map(id => ({ member_id: id, profile: id, display_name: `姓名-${id}` })) };
  const pageData = (afterSeq = 0) => ({ room: clone(room), pagedRead: true, events: { events: [{ event_id: `event-${afterSeq + 1}`, seq: afterSeq + 1, kind: 'message.user', actor: { kind: 'user', id: 'source' }, payload: { text: `原生群记录${afterSeq + 1}` } }] }, pagination: { limit: GROUP_PAGE_SIZE, afterSeq, nextAfterSeq: afterSeq + 1, hasMore: afterSeq === 0 } });
  function makeAction(sourceId, body, status = 'succeeded', data) {
    const collaboration = body.mode === 'group';
    const input = collaboration ? { targets: body.targetEmployeeIds.map(id => ({ id, name: `姓名-${id}`, revision: 4, controlEpoch: 7, conversationId: `chat-${id}` })), content: body.content, mode: 'group', groupId: body.groupId } : clone(body.input);
    const request = { schemaVersion: 2, resource: collaboration ? 'collaboration' : body.resource, operation: collaboration ? 'message' : body.operation, requestId: body.idempotencyKey, input };
    const action = { id: `action-${++serial}`, status, payload: { employeeId: sourceId, hermesBot: { employeeId: sourceId, workspace: 'workspace-one', revision: body.expectedRevision, controlEpoch: body.expectedControlEpoch }, nativeOperation: request } };
    if (status === 'succeeded') action.result = { nativeOperation: { schemaVersion: 2, resource: request.resource, operation: request.operation, employeeId: sourceId, revision: body.expectedRevision, status: 'succeeded', data: data || (collaboration ? { room: { ...room, room_id: body.groupId } } : body.operation === 'list' ? { items: [room] } : pageData(body.input.afterSeq)) } };
    actions.set(action.id, action); return action;
  }
  const api = {
    bot: async (workspace, id) => { gets.push(['bot', workspace, id]); return clone(bot(id)); },
    botNativeAction: async (workspace, sourceId, body) => { posts.push({ workspace, sourceId, body: clone(body) }); return { action: makeAction(sourceId, body) }; },
    collaborateBot: async (workspace, sourceId, body) => { posts.push({ workspace, sourceId, body: clone(body) }); return { action: makeAction(sourceId, body) }; },
    managementAction: async (workspace, actionId) => { gets.push(['action', workspace, actionId]); return clone(actions.get(actionId)); },
    botRuns: async (workspace, sourceId) => { gets.push(['runs', workspace, sourceId]); return { runs: [...actions.values()].filter(action => action.payload.employeeId === sourceId).map(clone) }; },
    ...overrides.api,
  };
  const current = () => ({ epoch, scope: `${state.user.user_id}:${state.workspace.slug}` });
  const valid = token => token.epoch === epoch && token.scope === `${state.user.user_id}:${state.workspace.slug}`;
  const failures = [];
  const create = () => createMobileGroups({ state, api, current, valid, draw: () => {}, fail: error => failures.push(error), storage: store });
  const module = create();
  return { state, api, module, create, posts, gets, actions, makeAction, pageData, room, bot, store, failures, invalidate: () => { epoch++; } };
}
async function selected(f) { await f.module.open({ sourceEmployeeId: 'source' }); return f.state.groups; }
async function newDraft(f, content = '协作正文') { await selected(f); await f.module.actions['group-new'](); await f.module.actions['group-target']({ id: 'target' }); await f.module.change({ name: 'groupContent', value: content }); }

test('opening/selecting uses GET only, and explicit group list/read use one bounded native action each', async () => {
  const f = fixture(); await selected(f); assert.equal(f.posts.length, 0);
  assert.equal(await f.module.actions['groups-read'](), true); assert.equal(f.state.groups.rooms[0].room_id, roomId);
  assert.equal(await f.module.actions['group-open']({ id: roomId }), true);
  assert.deepEqual(f.posts[1].body.input, { groupId: roomId, limit: 30, afterSeq: 0 });
  assert.equal(f.state.groups.events[0].event_id, 'event-1'); assert.equal(f.state.groups.hasMore, true);
  assert.equal(await f.module.actions['group-more'](), true);
  assert.deepEqual(f.posts[2].body.input, { groupId: roomId, limit: 30, afterSeq: 1 });
  assert.deepEqual(f.state.groups.events.map(row => row.seq), [1, 2]);
  for (let i = 0; i < 5; i++) await f.module.poll();
  assert.equal(f.posts.length, 3, 'poll never creates a new native read');
});

test('legacy unpaged history is rejected visibly, without a whole-history fallback or fabricated timeline', async () => {
  const f = fixture(); await selected(f);
  f.api.botNativeAction = async (ws, sourceId, body) => { f.posts.push({ body }); return { action: f.makeAction(sourceId, body, 'succeeded', { room: f.room, events: { events: [{ event_id: 'old', seq: 1 }] } }) }; };
  assert.equal(await f.module.actions['group-open']({ id: roomId }), false);
  assert.equal(f.state.groups.phase, 'upgrade_required'); assert.match(f.state.groups.error, /更新电脑端/);
  assert.deepEqual(f.state.groups.events, []); assert.equal(f.posts.length, 1); assert.equal(f.state.groups.pending, null);
});

async function legacyRead(f,module=f.module) {
  f.api.botNativeAction=async(ws,sourceId,body)=>{f.posts.push({body});return {action:f.makeAction(sourceId,body,'succeeded',{room:f.room,events:{events:[{event_id:'old',seq:1}]}})};};
  await module.open({sourceEmployeeId:'source'});assert.equal(await module.actions['group-open']({id:roomId}),false);
}
async function tryNewGroupSend(f,module=f.module,target='target') {
  f.state.page='groups';await module.actions['group-new']();await module.actions['group-target']({id:target});await module.change({name:'groupContent',value:'新的协作正文'});
  return module.actions['group-send']();
}

test('legacy read then back/new/target/send keeps the host capability gate and sends no collaboration POST',async()=>{
  const f=fixture();let sends=0;f.api.collaborateBot=async()=>{sends++;throw new Error('must not dispatch');};
  await legacyRead(f);assert.equal(await tryNewGroupSend(f),false);assert.equal(sends,0);
  assert.match(f.state.groups.error,/更新电脑端/);assert.equal(f.state.groups.phase,'idle');
  assert.match(renderMobileGroups(f.state),/data-action="group-send" disabled/);
  const saved=[...f.store.values.entries()].find(([key])=>key.startsWith('ziwei.manager.group-capability.v1:'));
  assert(saved);const record=JSON.parse(saved[1]);assert.equal(record.binding.sourceId,'source');assert.equal(record.binding.revision,4);
  assert(!saved[1].includes('新的协作正文'));
});

test('unsupported source remains blocked after reselect/reopen/reset/logout and controller recreation',async()=>{
  const f=fixture();await legacyRead(f);
  await f.module.actions['groups-source']({id:'source'});assert.equal(await tryNewGroupSend(f),false);
  await f.module.open({sourceEmployeeId:'source'});assert.equal(await tryNewGroupSend(f),false);
  f.module.reset({clearAccount:true});await f.module.open({sourceEmployeeId:'source'});assert.equal(await tryNewGroupSend(f),false);
  f.module.dispose();const rebuilt=f.create();await rebuilt.open({sourceEmployeeId:'source'});assert.equal(await tryNewGroupSend(f,rebuilt),false);
  assert.equal(f.posts.filter(post=>post.body.mode==='group').length,0);
});

test('capability storage failure cannot lose the account-scoped negative gate on logout/relogin',async()=>{
  const store=storage(),write=store.setItem;
  store.setItem=(key,value)=>{if(key.startsWith('ziwei.manager.group-capability.v1:'))throw new Error('quota');write(key,value);};
  const f=fixture({storage:store});await legacyRead(f);f.module.reset({clearAccount:true});
  await f.module.open({sourceEmployeeId:'source'});assert.equal(await tryNewGroupSend(f),false);
  assert.equal(f.posts.filter(post=>post.body.mode==='group').length,0);
  f.state.user={user_id:'another-account'};await f.module.open({sourceEmployeeId:'source'});
  assert.equal(f.state.groups.capabilityError,null,'a different principal never inherits another account capability state');
});

test('revision/device/profile metadata changes alone cannot clear known unsupported capability',async()=>{
  const f=fixture(),original=f.api.bot;
  f.api.bot=async(ws,id)=>({...await original(ws,id),employee:{...f.bot(id).employee,target_device_id:'computer_one',runtime_profile:'physical_profile'},instance:{mode:'owned_profile',profile:'employee_profile',ownershipId:'owned_one'}});
  await legacyRead(f);
  const saved=JSON.parse([...f.store.values.entries()].find(([key])=>key.startsWith('ziwei.manager.group-capability.v1:'))[1]);
  assert.equal(saved.binding.deviceId,'computer_one');assert.equal(saved.binding.profile,'employee_profile');assert.equal(saved.binding.ownershipId,'owned_one');
  f.api.bot=async(ws,id)=>({...await original(ws,id),revision:5,employee:{...f.bot(id).employee,target_device_id:'computer_two',runtime_profile:'other_profile'}});
  await f.module.actions['groups-source']({id:'source'});assert.equal(await tryNewGroupSend(f),false);
});

test('a fresh matched paged read clears the unsupported capability and permits a subsequent explicit send',async()=>{
  const f=fixture();await legacyRead(f);
  f.api.botNativeAction=async(ws,sourceId,body)=>({action:f.makeAction(sourceId,body)});
  assert.equal(await f.module.actions['group-refresh'](),true);
  assert.equal(f.state.groups.capabilityError,null);assert.equal([...f.store.values.keys()].some(key=>key.startsWith('ziwei.manager.group-capability.v1:')),false);
  assert.equal(await tryNewGroupSend(f),true);assert.equal(f.posts.filter(post=>post.body.mode==='group').length,1);
});

test('another freshly verified source can send while the original unsupported source remains blocked',async()=>{
  const f=fixture();await legacyRead(f);
  await f.module.actions['groups-source']({id:'second'});assert.equal(await tryNewGroupSend(f,f.module,'source'),true);
  await f.module.actions['groups-source']({id:'source'});assert.equal(await tryNewGroupSend(f),false);
});

test('typed old-host errors from the exact pending action poll persist across a new group',async()=>{
  const f=fixture();await selected(f);
  f.api.botNativeAction=async(ws,sourceId,body)=>({action:f.makeAction(sourceId,body,'pending')});
  await f.module.actions['group-open']({id:roomId});
  f.api.managementAction=async()=>{throw Object.assign(new Error('需要更新电脑端'),{status:409,code:'GROUP_HOST_UPGRADE_REQUIRED'});};
  assert.equal(await f.module.poll(),false);assert.equal(f.state.groups.pending,null);
  assert.equal(await tryNewGroupSend(f),false);assert.equal(f.posts.filter(post=>post.body.mode==='group').length,0);
});

test('read pages validate original scope, epoch, request identity, cursor and event order before display', async () => {
  for (const change of [action => { action.payload.hermesBot.workspace = 'other'; }, action => { action.payload.hermesBot.controlEpoch = 99; }, action => { action.payload.nativeOperation.requestId = 'other'; }, action => { action.result.nativeOperation.revision = 3; }, action => { action.result.nativeOperation.data.pagination.afterSeq = 6; }, action => { action.result.nativeOperation.data.events.events[0].seq = 0; }]) {
    const f = fixture(); await selected(f);
    f.api.botNativeAction = async (ws, sourceId, body) => { const action = f.makeAction(sourceId, body); change(action); return { action }; };
    assert.equal(await f.module.actions['group-open']({ id: roomId }), false);
    assert.deepEqual(f.state.groups.events, []); assert.ok(f.state.groups.error);
  }
});

test('queued 202 is only accepted; polling GETs the same action until its complete native receipt arrives', async () => {
  const f = fixture(); await selected(f);
  let pending;
  f.api.botNativeAction = async (ws, sourceId, body) => ({ action: pending = f.makeAction(sourceId, body, 'pending') });
  assert.equal(await f.module.actions['groups-read'](), true); assert.equal(f.state.groups.phase, 'queued'); assert.deepEqual(f.state.groups.rooms, []);
  const body = { expectedRevision: 4, expectedControlEpoch: 7, idempotencyKey: pending.payload.nativeOperation.requestId, resource: 'groups', operation: 'list', input: {} };
  const completed = f.makeAction('source', body); completed.id = pending.id; f.actions.set(completed.id, completed);
  await f.module.poll(); assert.equal(f.state.groups.phase, 'succeeded'); assert.equal(f.state.groups.rooms.length, 1);
  assert.equal(f.state.groups.notice, '', 'A terminal read cannot keep the queued waiting notice');
  assert.deepEqual(f.gets.at(-1), ['action', 'workspace-one', pending.id]);
});

test('creating a group is clearly one explicit send, authorizes exact saved targets and maps name chips to exact mentions', async () => {
  const f = fixture(); await newDraft(f, '请处理，不替换手写@unknown');
  assert.equal(await f.module.actions['group-target']({ id: 'other' }), false);
  await f.module.actions['group-mention']({ id: 'target' });
  assert.equal(f.posts.length, 0, 'selecting members or mentions cannot dispatch work');
  const before = renderMobileGroups(f.state);
  assert.match(before, /创建并发送/); assert.match(before, /@姓名-target/); assert.doesNotMatch(before, /保存并自动启用/);
  assert.equal(await f.module.actions['group-send'](), true);
  assert.equal(f.posts.length, 1); const body = f.posts[0].body;
  assert.equal(body.mode, 'group'); assert.deepEqual(body.targetEmployeeIds, ['target']);
  assert.equal(body.content, '@target\n请处理，不替换手写@unknown');
  assert.match(body.groupId, /^group_/); assert.equal(f.state.page, 'group');
  assert.deepEqual(f.state.groups.events, [], 'send receipt history is not silently substituted for paginated group records');
});

test('existing group keeps its complete roster while mentions select a single speaker', async () => {
  const f = fixture(); await selected(f); await f.module.actions['group-open']({ id: roomId });
  assert.equal(await f.module.actions['group-target']({ id: 'other' }), false);
  await f.module.actions['group-mention']({ id: 'source' }); await f.module.change({ name: 'groupContent', value: '负责员工回答' });
  assert.equal(await f.module.actions['group-send'](), true);
  const sent = f.posts.at(-1).body; assert.equal(sent.groupId, roomId); assert.deepEqual(sent.targetEmployeeIds, ['target']); assert.equal(sent.content, '@source\n负责员工回答');
});

test('permissions, inactive validation and unresolved stop evidence never automatically save, validate or activate', async () => {
  for (const patch of [bot => { bot.config.permissions.mode = 'read_only'; }, bot => { bot.config.collaboration.enabled = false; }, bot => { bot.control_state = 'draft'; }, bot => { bot.validation.status = 'stale'; }, bot => { bot.latest_run = { status: 'expired', acked_at: 'date' }; }]) {
    const f = fixture(); await newDraft(f); patch(f.state.groups.bot);
    assert.equal(await f.module.actions['group-send'](), false); assert.equal(f.posts.length, 0); assert.ok(f.state.groups.error);
    assert.ok(mobileGroupGate(f.state.groups.bot, { sending: true }));
  }
});

test('unavailable auxiliary group history and a legacy paging warning block new execution',async()=>{
  for(const patch of [bot=>{bot.latest_run={status:'succeeded',mobileReadError:{code:'GROUP_HOST_UPGRADE_REQUIRED',message:'请先更新电脑端'}};},bot=>{bot.nativeResources={collaboration:{resourceState:'unavailable',readError:{message:'原群组不可核对'}}};}]) {
    const f=fixture();await newDraft(f);patch(f.state.groups.bot);
    assert.equal(await f.module.actions['group-send'](),false);assert.equal(f.posts.length,0);assert(mobileGroupGate(f.state.groups.bot,{sending:true}));
  }
});

test('double submit is single-flight, a lost receipt retains only a hash and IDs, and reload recovers without resending', async () => {
  const held = deferred(), dispatched = deferred(), f = fixture(); await newDraft(f, 'PRIVATE GROUP BODY 不可写入存储');
  let original;
  f.api.collaborateBot = async (ws, sourceId, body) => { f.posts.push({ body }); original = f.makeAction(sourceId, body); dispatched.resolve(); return held.promise; };
  const sending = f.module.actions['group-send']();
  await waitForDispatch(dispatched);
  assert.equal(await f.module.actions['group-send'](), false); assert.equal(f.posts.length, 1);
  held.reject(new TypeError('Network lost')); await sending;
  assert.equal(f.state.groups.phase, 'unknown'); const persisted = [...f.store.values.values()].join('');
  assert.doesNotMatch(persisted, /PRIVATE GROUP BODY|不可写入存储/); assert.match(persisted, /fingerprint/);
  f.module.dispose(); const restored = f.create(); f.module = restored; await restored.open({ sourceEmployeeId: 'source' });
  assert.equal(f.state.groups.phase, 'unknown'); assert.equal(await restored.actions['group-retry'](), true);
  assert.equal(f.posts.length, 1); assert.equal(f.state.groups.lastAction.id, original.id); assert.equal(f.state.groups.pending, null);
});

test('unknown requests missing from bounded run lookup remain blocked instead of receiving a new key', async () => {
  const f = fixture(); await newDraft(f);
  f.api.collaborateBot = async () => { throw new TypeError('lost'); };
  await f.module.actions['group-send'](); const requestId = f.state.groups.pending.requestId;
  assert.equal(await f.module.poll(), false); assert.match(f.state.groups.error, /勿重复发送/);
  assert.equal(await f.module.actions['group-send'](), false); assert.equal(f.state.groups.pending.requestId, requestId);
});

test('request fingerprint rejects a source-correct receipt whose original content or targets changed', async () => {
  for (const mutate of [action => { action.payload.nativeOperation.input.content = 'modified content'; }, action => { action.payload.nativeOperation.input.targets[0].id = 'other'; }]) {
    const f = fixture(); await newDraft(f);
    f.api.collaborateBot = async (ws, sourceId, body) => { const action = f.makeAction(sourceId, body); mutate(action); return { action }; };
    assert.equal(await f.module.actions['group-send'](), false); assert.equal(f.state.groups.phase, 'unknown'); assert.match(f.state.groups.error, /请求摘要/);
  }
});

test('employee switches, account invalidation and explicit logout reject late UI or storage writes', async () => {
  const held = deferred(), dispatched = deferred(), f = fixture(); await newDraft(f);
  f.api.collaborateBot = async (ws, sourceId, body) => { f.posts.push({ body }); dispatched.resolve(); return held.promise.then(() => ({ action: f.makeAction(sourceId, body) })); };
  const sending = f.module.actions['group-send'](); await waitForDispatch(dispatched);
  f.module.reset({ clearAccount: true }); f.invalidate(); held.resolve(); await sending;
  assert.equal(f.state.groups, null); assert.equal(f.store.length, 0, 'logout cannot be undone by the late POST receipt');
});

test('a delayed read cannot replace another responsible employee or workspace', async () => {
  const held = deferred(), dispatched = deferred(), f = fixture(); await selected(f);
  f.api.botNativeAction = async (ws, sourceId, body) => { dispatched.resolve(); return held.promise.then(() => ({ action: f.makeAction(sourceId, body) })); };
  const reading = f.module.actions['group-open']({ id: roomId });
  await waitForDispatch(dispatched);
  await f.module.actions['groups-source']({ id: 'second' }); held.resolve(); await reading;
  assert.equal(f.state.groups.sourceId, 'second'); assert.deepEqual(f.state.groups.events, []);
});

test('only exact child action identities show member status and wrong source/target receipts remain unresolved', async () => {
  const f = fixture(); await newDraft(f);
  f.api.collaborateBot = async (ws, sourceId, body) => {
    const parent = f.makeAction(sourceId, body), child = { id: 'child-run', status: 'succeeded', payload: { employeeId: 'target', hermesBot: { employeeId: 'target', workspace: ws, revision: 4, controlEpoch: 7 }, collaboration: { sourceEmployeeId: 'source', sourceActionId: parent.id, groupId: body.groupId } } };
    f.actions.set(child.id, child); parent.result.nativeGroup = { runs: [{ actionId: child.id, employeeId: 'target', status: 'succeeded' }] }; return { action: parent };
  };
  assert.equal(await f.module.actions['group-send'](), true); assert.equal(f.state.groups.memberRuns[0].status, 'succeeded');
  const wrong = fixture(); await newDraft(wrong); wrong.api.collaborateBot = f.api.collaborateBot;
  wrong.api.managementAction = async () => ({ id: 'child-run', status: 'succeeded', payload: { employeeId: 'other' } });
  await wrong.module.actions['group-send'](); assert.equal(wrong.state.groups.memberRuns[0].status, 'unresolved');
});

test('storage failure blocks a dispatch, while presentation escapes names, messages, event payloads and errors', async () => {
  const f = fixture({ storage: { getItem: () => null, setItem: () => { throw new Error('quota'); } } }); await newDraft(f);
  assert.equal(await f.module.actions['group-send'](), false); assert.equal(f.posts.length, 0); assert.match(f.state.groups.error, /存储/);
  f.state.groups.content = '<script>injection()</script>'; f.state.groups.error = '<img src=x onerror=run()>';
  f.state.groups.events = [{ event_id: 'event-safe', kind: 'message.user', payload: { text: '<iframe src=external>' } }];
  f.state.groups.members = [{ id: 'target', name: '<script>name()</script>' }];
  const html = renderMobileGroups(f.state); assert.doesNotMatch(html, /<script>|<img src=x|<iframe src=external/); assert.match(html, /&lt;script&gt;/);
});

test('a failed different-room read cannot retain the previous roster or enable sending into the new room', async () => {
  const f = fixture(); await selected(f); await f.module.actions['group-open']({ id: roomId });
  assert.equal(f.state.groups.roomVerified, true); assert.deepEqual(f.state.groups.selectedTargetIds, ['target']);
  f.api.botNativeAction = async () => { throw Object.assign(new Error('群记录暂不可用'), { status: 404 }); };
  await f.module.actions['group-open']({ id: 'group_different' });
  assert.equal(f.state.groups.roomVerified, false); assert.deepEqual(f.state.groups.selectedTargetIds, []); assert.deepEqual(f.state.groups.members, []);
  await f.module.change({ name: 'groupContent', value: '不要发到错误群组' });
  const before = f.posts.length; assert.equal(await f.module.actions['group-send'](), false); assert.equal(f.posts.length, before); assert.match(f.state.groups.error, /读取并核对/);
  await f.module.actions['group-new'](); assert.equal(f.state.groups.phase, 'idle'); assert.equal(f.state.groups.notice, ''); assert.equal(f.state.groups.error, '');
});

test('same-room refresh and paging preserve a composed message and still-valid name-chip mentions', async () => {
  const f = fixture(); await selected(f); await f.module.actions['group-open']({ id: roomId });
  await f.module.change({ name: 'groupContent', value: '未发送的群草稿' }); await f.module.actions['group-mention']({ id: 'target' });
  await f.module.actions['group-more'](); assert.equal(f.state.groups.content, '未发送的群草稿'); assert.deepEqual(f.state.groups.mentionIds, ['target']);
  await f.module.actions['group-refresh'](); assert.equal(f.state.groups.content, '未发送的群草稿'); assert.deepEqual(f.state.groups.mentionIds, ['target']);
  const html = renderMobileGroups(f.state); assert.match(html, /<form class="panel group-compose" data-state-fields>/);
});

test('nested native receipts and the exact group publish terminal stage retain their original request binding', async () => {
  const f = fixture(); await newDraft(f);
  f.api.collaborateBot = async (workspace, sourceId, body) => {
    const action = f.makeAction(sourceId, body), receipt = action.result.nativeOperation;
    receipt.operation = 'publish'; action.result = { result: { nativeOperation: receipt }, nativeGroup: { groupId: body.groupId, runs: [{ actionId: action.id, employeeId: sourceId, status: 'succeeded' }] } };
    return { action };
  };
  assert.equal(await f.module.actions['group-send'](), true); assert.equal(f.state.groups.memberRuns[0].source, true); assert.equal(f.state.groups.phase, 'succeeded');
  const wrong = fixture(); await selected(wrong);
  wrong.api.botNativeAction = async (workspace, sourceId, body) => { const action = wrong.makeAction(sourceId, body); action.result.nativeOperation.operation = 'publish'; return { action }; };
  assert.equal(await wrong.module.actions['group-open']({ id: roomId }), false); assert.deepEqual(wrong.state.groups.events, []);
});

test('an acknowledged expiry keeps the original action pending for verification and never allows a fresh send', async () => {
  const f = fixture(); await newDraft(f);
  f.api.collaborateBot = async (workspace, sourceId, body) => { const action = f.makeAction(sourceId, body, 'expired'); action.acked_at = '2026-10-17T00:00:00Z'; return { action }; };
  assert.equal(await f.module.actions['group-send'](), false); assert.equal(f.state.groups.phase, 'uncertain'); assert.ok(f.state.groups.pending.actionId);
  const requestId = f.state.groups.pending.requestId;
  assert.equal(await f.module.actions['group-send'](), false); await f.module.poll(); assert.equal(f.state.groups.pending.requestId, requestId); assert.equal(f.state.groups.phase, 'uncertain');
});

test('corrupt stored intent remains byte-for-byte preserved and blocked across new-group, source reselect and reopen', async () => {
  const f = fixture(), key = 'ziwei.manager.groups.v1:' + JSON.stringify(['account-one', 'workspace-one', 'source']), original = '{invalid original request marker';
  f.store.setItem(key, original);
  for (let visit = 0; visit < 2; visit++) {
    await selected(f); assert.equal(f.state.groups.storageBlocked, true); assert.match(f.state.groups.error, /原记录已保留/);
    assert.equal(await f.module.actions['group-new'](), false); assert.equal(await f.module.actions['groups-read'](), false);
    assert.equal(await f.module.actions['group-open']({ id: roomId }), false); assert.equal(await f.module.actions['group-send'](), false);
    await f.module.actions['groups-source']({ id: 'source' }); assert.equal(f.state.groups.storageBlocked, true);
    assert.equal(f.store.getItem(key), original); assert.equal(f.posts.length, 0);
    assert.match(renderMobileGroups(f.state), /data-action="group-new" disabled/);
    f.module.reset();
  }
});

test('an unreadable intent store remains blocked across controller recreation and is never overwritten', async () => {
  let writes = 0;
  const store = { getItem: () => { throw new Error('storage unreadable'); }, setItem: () => { writes++; }, removeItem: () => { throw new Error('must preserve'); } }, f = fixture({ storage: store });
  for (let visit = 0; visit < 2; visit++) {
    await selected(f); assert.equal(f.state.groups.storageBlocked, true); assert.match(f.state.groups.error, /不会覆盖原请求/);
    assert.equal(await f.module.actions['group-new'](), false); assert.equal(await f.module.actions['groups-read'](), false); assert.equal(await f.module.actions['group-send'](), false);
    f.module.dispose(); f.module = f.create();
  }
  assert.equal(writes, 0); assert.equal(f.posts.length, 0);
});

test('settings navigation is disabled throughout deferred source selection, native read dispatch and polling', async () => {
  const chooseHeld = deferred(), choose = fixture();
  choose.api.bot = () => chooseHeld.promise;
  const selecting = choose.module.open({ sourceEmployeeId: 'source' });
  assert.match(renderMobileGroups(choose.state), /data-action="groups-settings" data-id="source" disabled/);
  chooseHeld.resolve(choose.bot('source')); await selecting;

  const f = fixture(); await selected(f); f.state.groups.bot.config.permissions.mode = 'read_only';
  const dispatchHeld = deferred(), dispatched = deferred(); let queued;
  f.api.botNativeAction = (ws, sourceId, body) => { queued = f.makeAction(sourceId, body, 'pending'); dispatched.resolve(); return dispatchHeld.promise; };
  const reading = f.module.actions['groups-read']();
  assert.match(renderMobileGroups(f.state), /data-action="groups-settings" data-id="source" disabled/);
  await waitForDispatch(dispatched);
  dispatchHeld.resolve({ action: queued }); await reading;
  assert.match(renderMobileGroups(f.state), /data-action="groups-settings" data-id="source">/, 'A queued receipt with no active UI read may navigate to settings');

  const pollHeld = deferred(); f.api.managementAction = () => pollHeld.promise;
  const polling = f.module.poll();
  assert.match(renderMobileGroups(f.state), /data-action="groups-settings" data-id="source" disabled/);
  pollHeld.resolve(queued); await polling;
  assert.match(renderMobileGroups(f.state), /data-action="groups-settings" data-id="source">/);
});
