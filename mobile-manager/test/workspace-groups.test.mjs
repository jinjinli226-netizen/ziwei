import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceGroups } from '../web/workspace-groups.js';
import { renderWorkspaceGroups } from '../web/workspace-groups-view.js';
import { createApi } from '../web/api.js';
import { createController } from '../web/controller.js';
import { initialState } from '../web/model.js';

const employees = ['Hermes', 'DSH', 'Codex'].map((runtime, index) => ({ id: `employee-${index}`, name: `${runtime}伙伴`, runtime, runtime_profile: `profile-${index}`, target_device_id: 'pc-one', main_conversation_id: `chat-${index}`, status: 'active' }));
const members = employees.map(employee => ({ employeeId: employee.id, name: employee.name, runtime: employee.runtime, profile: employee.runtime_profile, deviceId: employee.target_device_id, conversationId: employee.main_conversation_id }));
const group = () => ({ id: 'mix_current', title: '真实工作区混合群', workspace: 'work-one', members, messages: [{ id: 'message-one', role: 'assistant', employeeId: employees[1].id, runtime: 'DSH', status: 'succeeded', text: '<script>原群消息</script>' }], runs: [] });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { resolve, reject, promise }; };
function fixture(overrides = {}) {
  const state = { user: { user_id: 'account-one' }, workspace: { slug: 'work-one', role: 'owner' }, employees, bots: [], page: 'home' }, calls = [];
  let currentGroup = group();
  const api = {
    mixedGroups: async workspace => { calls.push(['list', workspace]); return { groups: [currentGroup] }; },
    mixedGroup: async (workspace, id) => { calls.push(['detail', workspace, id]); return currentGroup; },
    createMixedGroup: async (workspace, body) => { calls.push(['create', workspace, body]); return currentGroup = { ...body, workspace, messages: [], runs: [] }; },
    sendMixedGroupMessage: async (workspace, id, body) => { calls.push(['send', workspace, id, body]); currentGroup = { ...currentGroup, messages: [...currentGroup.messages, { id: body.messageId, role: 'user', text: body.content }], runs: [{ actionId: 'original-action', employeeId: employees[1].id, runtime: 'DSH', status: 'acked' }] }; return { state: 'dispatched', group: currentGroup }; },
    cancelMixedGroup: async (workspace, id, body) => { calls.push(['cancel', workspace, id, body]); return { state: 'cancel_requested', groupId: id, controls: [{ actionId: 'original-action', cancellationRequested: true }] }; },
    ...overrides,
  };
  const current = () => ({ scope: `${state.user.user_id}:${state.workspace.slug}` });
  const valid = token => token.scope === current().scope;
  const failures = [];
  const module = createWorkspaceGroups({ state, api, current, valid, fail: error => failures.push(error) });
  return { state, api, calls, module, failures, setGroup: value => { currentGroup = value; } };
}

test('workspace group entry reads the shared list immediately and shows all three runtimes and original messages', async () => {
  const f = fixture(); await f.module.open();
  assert.equal(f.state.page, 'workspace-groups'); assert.deepEqual(f.calls, [['list', 'work-one']]);
  assert.match(renderWorkspaceGroups(f.state), /真实工作区混合群/);
  await f.module.actions['workspace-group-open']({ id: 'mix_current' });
  const html = renderWorkspaceGroups(f.state);
  for (const runtime of ['Hermes', 'DSH', 'Codex']) assert.match(html, new RegExp(runtime));
  assert.match(html, /&lt;script&gt;原群消息&lt;\/script&gt;/); assert(!html.includes('<script>'));
  assert.deepEqual(f.calls[1], ['detail', 'work-one', 'mix_current']);
});

test('the real controller groups-open enters shared groups and keeps the native group page as a secondary entry', async t => {
  const f = fixture(), state = { ...initialState(), ...f.state, phase: 'ready' };
  const controller = createController({ state, api: f.api }); t.after(() => controller.dispose());
  await controller.actions['groups-open'](); assert.equal(state.page, 'workspace-groups'); assert.deepEqual(f.calls, [['list', 'work-one']]);
  await controller.actions['workspace-group-open']({ id: 'mix_current' }); assert.equal(state.page, 'workspace-group');
  await controller.actions.back(); assert.equal(state.page, 'workspace-groups');
  await controller.actions['native-groups-open'](); assert.equal(state.page, 'groups');
});

test('create freezes existing employee bindings without creating profiles, devices or sessions', async () => {
  const f = fixture(); await f.module.open(); await f.module.actions['workspace-group-new']();
  for (const employee of employees) f.module.actions['workspace-group-member']({ id: employee.id });
  f.module.change({ name: 'workspaceGroupTitle', value: '一起工作' });
  assert.equal(await f.module.actions['workspace-group-create'](), true);
  const body = f.calls.find(call => call[0] === 'create')[2];
  assert.match(body.id, /^mix_/); assert.equal(body.title, '一起工作'); assert.deepEqual(body.members, members);
  assert.equal(f.state.page, 'workspace-group'); assert.equal(f.state.workspaceGroups.group.id, body.id);
});

test('incomplete bindings and viewers cannot create a group', async () => {
  const f = fixture(); f.state.employees = [employees[0], { ...employees[1], main_conversation_id: null }];
  await f.module.open(); f.module.actions['workspace-group-new']();
  for (const employee of f.state.employees) f.module.actions['workspace-group-member']({ id: employee.id });
  assert.equal(await f.module.actions['workspace-group-create'](), false); assert.equal(f.calls.filter(call => call[0] === 'create').length, 0);
  f.state.workspace.role = 'viewer'; assert.equal(await f.module.actions['workspace-group-new'](), false);
});

test('explicit member send and cancellation use the unified group route and preserve actual member status', async () => {
  const f = fixture(); await f.module.open(); await f.module.actions['workspace-group-open']({ id: 'mix_current' });
  f.module.actions['workspace-group-mention']({ id: employees[1].id });
  f.module.change({ name: 'workspaceGroupContent', value: '请查一下资料' });
  assert.equal(await f.module.actions['workspace-group-send'](), true);
  const sent = f.calls.find(call => call[0] === 'send');
  assert.equal(sent[1], 'work-one'); assert.equal(sent[2], 'mix_current'); assert.deepEqual(sent[3].targetEmployeeIds, [employees[1].id]);
  assert.equal(sent[3].content, '请查一下资料'); assert.equal(f.state.workspaceGroups.content, '');
  assert.equal(await f.module.actions['workspace-group-cancel'](), true);
  assert.equal(f.state.workspaceGroups.group.runs[0].status, 'acked');
  assert.match(f.state.workspaceGroups.notice, /取消请求已提交/);
});

test('an unknown send stays locked on reopen and a refresh resolves only its actual message id without resending', async () => {
  const f = fixture({ sendMixedGroupMessage: async (...args) => { f.calls.push(['send', ...args]); throw Object.assign(new Error('连接中断'), { uncertain: true }); } });
  await f.module.open(); await f.module.actions['workspace-group-open']({ id: 'mix_current' });
  f.module.change({ name: 'workspaceGroupContent', value: '保留原消息' });
  assert.equal(await f.module.actions['workspace-group-send'](), false); const body = f.calls.find(call => call[0] === 'send')[3];
  await f.module.open(); await f.module.actions['workspace-group-open']({ id: 'mix_current' });
  assert.equal(await f.module.actions['workspace-group-send'](), false);
  f.setGroup({ ...group(), messages: [{ id: body.messageId, role: 'user', text: body.content }] });
  await f.module.actions['workspace-group-refresh'](); assert.equal(f.state.workspaceGroups.pending, null);
  assert.equal(f.calls.filter(call => call[0] === 'send').length, 1);
});

test('leaving a submitted creation retains its original group id until the returned group is read', async () => {
  const hold = deferred(), f = fixture({ createMixedGroup: async (_workspace, body) => { f.calls.push(['create', body]); return hold.promise; } });
  await f.module.open(); f.module.actions['workspace-group-new']();
  for (const employee of employees) f.module.actions['workspace-group-member']({ id: employee.id });
  const submitted = f.module.actions['workspace-group-create']();
  await f.module.open(); f.module.actions['workspace-group-new']();
  assert.equal(f.state.workspaceGroups.pending.id, f.calls.find(call => call[0] === 'create')[1].id);
  assert.equal(await f.module.actions['workspace-group-create'](), false);
  hold.reject(Object.assign(new Error('连接中断'), { uncertain: true })); await submitted;
  const created = f.calls.find(call => call[0] === 'create')[1]; f.setGroup({ ...created, workspace: 'work-one', messages: [], runs: [] });
  await f.module.actions['workspace-groups-refresh'](); assert.equal(f.state.workspaceGroups.pending, null);
  assert.equal(f.calls.filter(call => call[0] === 'create').length, 1);
});

test('a late successful creation cannot orphan the reopened form pending state before list confirmation', async () => {
  const hold = deferred(), f = fixture({ createMixedGroup: async (_workspace, body) => { f.calls.push(['create', body]); return hold.promise; } });
  await f.module.open(); f.module.actions['workspace-group-new']();
  for (const employee of employees) f.module.actions['workspace-group-member']({ id: employee.id });
  const submitted = f.module.actions['workspace-group-create']();
  await f.module.open(); f.module.actions['workspace-group-new']();
  const reopened = f.state.workspaceGroups, body = f.calls.find(call => call[0] === 'create')[1];
  const created = { ...body, workspace: 'work-one', messages: [], runs: [] };
  hold.resolve(created); await submitted;
  assert.equal(f.state.workspaceGroups, reopened); assert.equal(reopened.pending.id, body.id);
  assert.equal(await f.module.actions['workspace-group-create'](), false);
  f.setGroup(created); await f.module.actions['workspace-groups-refresh']();
  assert.equal(reopened.pending, null); assert.match(reopened.notice, /原群聊已在列表中确认/);
  assert.equal(f.calls.filter(call => call[0] === 'create').length, 1);
});

test('late list and detail responses cannot repopulate another workspace or departed screen', async () => {
  const hold = deferred(), f = fixture({ mixedGroup: () => hold.promise });
  await f.module.open(); const reading = f.module.actions['workspace-group-open']({ id: 'mix_current' });
  f.state.workspace = { slug: 'work-two', role: 'owner' }; f.module.reset(); hold.resolve(group()); await reading;
  assert.equal(f.state.workspaceGroups, null);
});

test('mobile history and group-list cursors load more real records and latest polls preserve earlier pages', async () => {
  const latest = { ...group(), pagination: { limit: 10, nextBefore: 'message-one', hasMore: true } };
  const f = fixture({
    mixedGroups: async (workspace, filters) => ({ groups: filters?.before ? [{ ...group(), id: 'mix_older', title: '更早的群聊' }] : [latest], pagination: filters?.before ? { hasMore: false } : { hasMore: true, nextBefore: 'mix_current' } }),
    mixedGroup: async (_workspace, _id, filters) => filters?.before ? { ...group(), messages: [{ id: 'older-message', role: 'user', text: '较早的真实记录' }], pagination: { limit: 10, hasMore: false } } : latest,
  });
  await f.module.open(); await f.module.actions['workspace-groups-more']();
  assert.deepEqual(f.state.workspaceGroups.list.map(group => group.id), ['mix_current', 'mix_older']);
  await f.module.actions['workspace-group-open']({ id: 'mix_current' });
  await f.module.actions['workspace-group-history']();
  assert.deepEqual(f.state.workspaceGroups.group.messages.map(message => message.id), ['older-message', 'message-one']);
  await f.module.actions['workspace-group-refresh']();
  assert.deepEqual(f.state.workspaceGroups.group.messages.map(message => message.id), ['older-message', 'message-one']);
  assert.equal(f.state.workspaceGroups.historyPagination.hasMore, false);
});

test('mobile mixed API uses exact workspace paths, view projection and supplied message/cancel bodies', async () => {
  const calls = [], api = createApi({ identity: null, fetchImpl: async (url, options) => { calls.push({ url, options }); return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); } });
  await api.mixedGroups('work-one'); await api.mixedGroup('work-one', 'mix_current');
  await api.createMixedGroup('work-one', { id: 'mix_current' }); await api.sendMixedGroupMessage('work-one', 'mix_current', { content: '你好', messageId: 'original' }); await api.cancelMixedGroup('work-one', 'mix_current');
  assert.deepEqual(calls.map(call => [call.url, call.options.method]), [
    ['/api/workspaces/work-one/mixed-groups?view=mobile', 'GET'], ['/api/workspaces/work-one/mixed-groups/mix_current?view=mobile', 'GET'],
    ['/api/workspaces/work-one/mixed-groups?view=mobile', 'POST'], ['/api/workspaces/work-one/mixed-groups/mix_current/messages?view=mobile', 'POST'], ['/api/workspaces/work-one/mixed-groups/mix_current/cancel', 'POST'],
  ]);
  assert.deepEqual(JSON.parse(calls[3].options.body), { content: '你好', messageId: 'original' });
  api.dispose();
});
