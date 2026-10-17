import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../web/model.js';
import { createMobileTasks, taskBucket, filterMobileTasks, MOBILE_TASK_FILTERS, MOBILE_TASK_LIMITS, canCreateMobileTask } from '../web/mobile-tasks.js';
import { renderMobileTaskForm, renderMobileTaskFilters } from '../web/mobile-tasks-view.js';

const scopeKey = state => JSON.stringify([state.user?.user_id, state.workspace?.slug]);
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function form(values = {}) { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(`mobile-task-${key}`, value); return data; }
function fixture(t, overrides = {}) {
  let epoch = 0;
  const state = { ...initialState(), phase: 'ready', user: { user_id: 'user-one' }, workspace: { id: 'workspace-db-one', slug: 'one', role: 'owner' },
    employees: [{ id: 'employee-one', name: '当前员工' }, { id: 'employee-deleted', name: '已删除', status: 'deleted' }], tasks: [] };
  const calls = [], failures = [], frames = [], accepted = [], records = new Map();
  const api = {
    createTask: async (workspace, body) => {
      calls.push({ kind: 'create', workspace, body: structuredClone(body) });
      const value = { id: `task-${calls.length}`, workspace_id: `workspace-db-${workspace}`, ...body };
      if (!records.has(workspace)) records.set(workspace, []); records.get(workspace).push(value); return value;
    },
    tasks: async workspace => { calls.push({ kind: 'read', workspace }); return { tasks: records.get(workspace) || [] }; },
    ...overrides,
  };
  const current = () => ({ epoch, scope: scopeKey(state) }), valid = token => token.epoch === epoch && token.scope === scopeKey(state);
  const mobile = createMobileTasks({ state, api, current, valid, draw: () => frames.push(renderMobileTaskForm(state)), fail: (error, token) => failures.push({ error, token }), onSaved: task => accepted.push(task) });
  t.after(() => mobile.dispose());
  function switchScope(userId = 'user-one', workspace = 'two') {
    epoch++; mobile.reset(); state.user = { user_id: userId }; state.workspace = { id: `workspace-db-${workspace}`, slug: workspace, role: 'owner' }; state.page = 'home'; state.tasks = []; state.employees = [];
  }
  return { state, api, mobile, calls, failures, frames, accepted, records, switchScope, current };
}
function fill(mobile, values) { for (const [key, value] of Object.entries(values)) assert.equal(mobile.change({ name: `mobile-task-${key}`, value }), true); }

test('task filters map canonical states explicitly without changing input order or hiding unknowns from All', () => {
  const cases = { planned: 'pending', todo: 'pending', blocked: 'pending', review: 'pending', failed: 'pending', expired: 'pending', uncertain: 'pending', paused: 'pending',
    in_progress: 'running', running: 'running', executing: 'running', pending: 'running', queued: 'running', acked: 'running', delivered: 'running', acknowledged: 'running',
    completed: 'completed', succeeded: 'completed', done: 'completed', cancelled: 'other', stopped: 'other', mystery: 'other' };
  const tasks = Object.keys(cases).map((state, index) => ({ id: String(index), state }));
  for (const [state, bucket] of Object.entries(cases)) assert.equal(taskBucket({ state }), bucket);
  for (const item of MOBILE_TASK_FILTERS) assert.deepEqual(filterMobileTasks(tasks, item.id), item.id === 'all' ? tasks : tasks.filter(task => cases[task.state] === item.id));
  assert.notEqual(filterMobileTasks(tasks), tasks); assert.equal(taskBucket({ status: 'completed' }), 'completed');
  assert.deepEqual(filterMobileTasks(tasks, 'invalid'), tasks); assert.deepEqual(filterMobileTasks(null), []);
});

test('opening or editing a planned task never performs reads, saves or employee execution', t => {
  const f = fixture(t); assert.equal(f.mobile.open(), true);
  fill(f.mobile, { title: '下一件事', description: '先记下来', assignee: 'employee-one' });
  assert.equal(f.state.page, 'mobile-task-new'); assert.equal(f.state.mobileTaskForm.title, '下一件事'); assert.deepEqual(f.calls, []);
  assert.equal(f.mobile.change({ name: 'unrelated', value: 'x' }), false);
});

test('a confirmed save sends only a planned record and refreshes the originating list', async t => {
  const f = fixture(t); f.mobile.open();
  assert.equal(await f.mobile.submit(form({ title: '  明天整理清单  ', description: '记录原说明', assignee: 'employee-one' })), true);
  assert.deepEqual(f.calls, [{ kind: 'create', workspace: 'one', body: { title: '明天整理清单', description: '记录原说明', assignee: 'employee-one', state: 'planned' } }, { kind: 'read', workspace: 'one' }]);
  assert.equal(f.accepted.length, 1); assert.equal(f.state.page, 'home'); assert.equal(f.state.tab, 'work'); assert.equal(f.state.taskFilter, 'pending');
  assert.equal(f.state.notice, '待办已记录'); assert.equal(f.state.tasks[0].state, 'planned'); assert.equal(f.state.resources.tasks.phase, 'ready');
  assert.equal(f.state.mobileTaskForm, null);
});

test('leaving assignee empty creates an unassigned planned record', async t => {
  const f = fixture(t); f.mobile.open(); await f.mobile.submit(form({ title: '不指定负责人' }));
  assert.deepEqual(f.calls[0].body, { title: '不指定负责人', description: '', assignee: null, state: 'planned' });
});

test('form bounds and visible employee identity are validated before any POST', async t => {
  const f = fixture(t); f.mobile.open();
  for (const values of [{ title: '   ' }, { title: 'x'.repeat(MOBILE_TASK_LIMITS.title + 1) }, { title: 'valid', description: 'x'.repeat(MOBILE_TASK_LIMITS.description + 1) },
    { title: 'valid', description: '', assignee: 'foreign-employee' }, { title: 'valid', assignee: '当前员工' }, { title: 'valid', assignee: 'employee-deleted' }]) {
    assert.equal(await f.mobile.submit(form(values)), false); assert(f.state.mobileTaskForm.error); assert.equal(f.calls.length, 0);
  }
  await f.mobile.submit(form({ title: '中'.repeat(200), description: '中'.repeat(10000), assignee: 'employee-one' })); assert.equal(f.calls.filter(call => call.kind === 'create').length, 1);
});

test('an employee removed from the current visible list cannot remain assigned from an earlier selection', async t => {
  const f = fixture(t); f.mobile.open(); fill(f.mobile, { title: '事项', assignee: 'employee-one' }); f.state.employees = [];
  assert.equal(await f.mobile.submit(), false); assert.match(f.state.mobileTaskForm.error, /当前工作区可见/); assert.deepEqual(f.calls, []);
});

test('double submission is single-flight and editing during the POST cannot change its saved body', async t => {
  const receipt = deferred(), seen = [];
  const f = fixture(t, { createTask: async (workspace, body) => { seen.push({ workspace, body }); return receipt.promise; } });
  f.mobile.open(); fill(f.mobile, { title: '明确的一次保存' }); const saving = f.mobile.submit();
  assert.equal(await f.mobile.submit(), false); fill(f.mobile, { title: '保存期间的替换' }); assert.equal(f.state.mobileTaskForm.title, '明确的一次保存');
  receipt.resolve({ id: 'task', workspace_id: 'workspace-db-one', title: '明确的一次保存', description: '', assignee: null, state: 'planned' });
  assert.equal(await saving, true); assert.equal(seen.length, 1); assert.equal(seen[0].body.title, '明确的一次保存');
});

for (const kind of ['network', 'server', 'receipt']) test(`${kind} uncertainty locks the original save across reopening and readback never repeats the POST`, async t => {
  let writes = 0, reads = 0;
  const f = fixture(t, { createTask: async () => { writes++; if (kind === 'receipt') return { id: 'wrong', state: 'running' }; throw Object.assign(new Error('lost result'), kind === 'server' ? { status: 503 } : {}); },
    tasks: async () => { reads++; return { tasks: [{ id: 'maybe-created', title: '原事项', state: 'planned' }] }; } });
  f.mobile.open(); fill(f.mobile, { title: '原事项' }); assert.equal(await f.mobile.submit(), false);
  assert.equal(f.state.mobileTaskForm.unknown, true); assert.match(renderMobileTaskForm(f.state), /保存结果待核对/);
  assert.equal(await f.mobile.submit(), false); f.state.page = 'home'; f.mobile.reset(); f.mobile.open(); assert.equal(f.state.mobileTaskForm.unknown, true);
  assert.equal(await f.mobile.actions['mobile-task-review'](), true); assert.equal(f.state.page, 'home'); assert.equal(reads, 1); assert.equal(writes, 1);
  f.mobile.open(); assert.equal(f.state.mobileTaskForm.unknown, true, 'same-named readback cannot prove original receipt');
  assert.equal(f.mobile.actions['mobile-task-another'](), true); fill(f.mobile, { title: '原事项' }); assert.equal(await f.mobile.submit(), false);
  assert.equal(writes, 1); assert.equal(f.state.mobileTaskForm.unknown, true);
});

test('after reviewing an unknown save, another distinct explicit task may be recorded', async t => {
  let writes = 0;
  const f = fixture(t, { createTask: async (workspace, body) => { writes++; if (writes === 1) throw new Error('lost'); return { id: 'second', workspace_id: 'workspace-db-one', ...body }; } });
  f.mobile.open(); fill(f.mobile, { title: '第一件事' }); await f.mobile.submit();
  assert.equal(f.mobile.actions['mobile-task-another'](), false); await f.mobile.actions['mobile-task-review'](); f.mobile.open();
  assert.equal(f.mobile.actions['mobile-task-another'](), true); fill(f.mobile, { title: '另一件事' });
  assert.equal(await f.mobile.submit(), true); assert.equal(writes, 2);
});

test('an explicit validation rejection remains editable, without automatic retries', async t => {
  let writes = 0;
  const f = fixture(t, { createTask: async (workspace, body) => { writes++; if (writes === 1) throw Object.assign(new Error('标题不合要求'), { status: 422 }); return { id: 'saved', workspace_id: 'workspace-db-one', ...body }; } });
  f.mobile.open(); fill(f.mobile, { title: '第一次' }); assert.equal(await f.mobile.submit(), false);
  assert.equal(f.state.mobileTaskForm.unknown, false); assert.equal(writes, 1); fill(f.mobile, { title: '第二次明确保存' });
  assert.equal(await f.mobile.submit(), true); assert.equal(writes, 2);
});

test('a successful save followed by list failure stays successful and preserves the known receipt', async t => {
  const f = fixture(t, { tasks: async () => { throw new Error('read timeout'); } }); f.mobile.open();
  assert.equal(await f.mobile.submit(form({ title: '已经保存' })), true);
  assert.equal(f.calls.filter(call => call.kind === 'create').length, 1); assert.equal(f.state.tasks[0].title, '已经保存');
  assert.equal(f.state.notice, '待办已记录'); assert.match(f.state.resources.tasks.error, /待办已记录.*刷新失败/);
  assert.equal(f.accepted.length, 1);
});

test('a late save receipt from another workspace cannot update its form, task list or current notice', async t => {
  const receipt = deferred(), f = fixture(t, { createTask: () => receipt.promise }); f.mobile.open();
  const saving = f.mobile.submit(form({ title: '原工作区记录' }));
  f.switchScope('user-one', 'two'); f.mobile.open(); fill(f.mobile, { title: '新工作区草稿' });
  receipt.resolve({ id: 'old-task', workspace_id: 'workspace-db-one', title: '原工作区记录', description: '', assignee: null, state: 'planned' }); await saving;
  assert.equal(f.state.mobileTaskForm.title, '新工作区草稿'); assert.deepEqual(f.state.tasks, []); assert.equal(f.state.notice, '');
  assert.equal(f.accepted.length, 0); assert.equal(f.calls.length, 0);
});

test('a stale account error cannot log out the current account or display another account form', async t => {
  const receipt = deferred(), f = fixture(t, { createTask: () => receipt.promise }); f.mobile.open();
  const old = f.state.mobileTaskForm, saving = f.mobile.submit(form({ title: '原账号记录' })); f.switchScope('user-two', 'one'); f.mobile.open();
  receipt.reject(Object.assign(new Error('expired old session'), { status: 401 })); await saving;
  assert.equal(f.failures.length, 0); assert.equal(f.state.mobileTaskForm.title, '');
  f.state.mobileTaskForm = old; assert.doesNotMatch(renderMobileTaskForm(f.state), /原账号记录/);
});

test('a current 401 is delegated to the authenticated controller exactly once', async t => {
  const f = fixture(t, { createTask: async () => { throw Object.assign(new Error('expired'), { status: 401 }); } }); f.mobile.open();
  assert.equal(await f.mobile.submit(form({ title: '事项' })), false); assert.equal(f.failures.length, 1); assert.equal(f.failures[0].error.status, 401);
});

test('unknown state is scope-isolated and returning to that scope keeps its lock', async t => {
  const f = fixture(t, { createTask: async () => { throw new Error('lost'); } }); f.mobile.open(); await f.mobile.submit(form({ title: '原工作区事项' }));
  f.switchScope('user-two', 'one'); f.mobile.open(); assert.equal(f.state.mobileTaskForm.title, ''); assert.equal(f.state.mobileTaskForm.unknown, false);
  f.switchScope('user-one', 'one'); f.mobile.open(); assert.equal(f.state.mobileTaskForm.title, '原工作区事项'); assert.equal(f.state.mobileTaskForm.unknown, true);
});

test('dispose suppresses pending effects without cancelling the already issued POST', async t => {
  let writes = 0; const receipt = deferred(), f = fixture(t, { createTask: async () => { writes++; return receipt.promise; } }); f.mobile.open();
  const saving = f.mobile.submit(form({ title: '一次明确提交' })), before = f.frames.length; f.mobile.dispose();
  receipt.resolve({ id: 'task', workspace_id: 'workspace-db-one', title: '一次明确提交', description: '', assignee: null, state: 'planned' }); await saving;
  assert.equal(writes, 1); assert.equal(f.frames.length, before); assert.equal(f.accepted.length, 0); assert.deepEqual(f.state.tasks, []);
  assert.equal(f.mobile.open(), false); assert.equal(f.mobile.change({ name: 'mobile-task-title', value: 'late' }), false);
});

test('unsupported roles cannot open or save a task and visible fields are escaped', async t => {
  const f = fixture(t); f.state.workspace.role = 'viewer'; assert.equal(canCreateMobileTask(f.state), false); assert.equal(f.mobile.open(), false); assert.equal(f.calls.length, 0);
  f.state.workspace.role = 'member'; assert.equal(f.mobile.open(), true);
  fill(f.mobile, { title: '<img onerror="x">', description: '</textarea><script>x</script>', assignee: '' }); f.state.employees[0].name = '<script>employee</script>';
  const markup = renderMobileTaskForm(f.state);
  assert.doesNotMatch(markup, /<script>|<img onerror/); assert.match(markup, /&lt;script&gt;employee/);
  assert.match(markup, /maxlength="200"/); assert.match(markup, /maxlength="10000"/); assert.match(markup, /员工不会立即执行/);
});

test('filter controls show exact buckets, safe fallback and usable counts', () => {
  const state = { tasks: [{ state: 'planned' }, { state: 'review' }, { state: 'in_progress' }, { state: 'completed' }, { state: 'cancelled' }], taskFilter: 'pending' };
  const markup = renderMobileTaskFilters(state);
  assert.match(markup, /data-id="pending" class="active" aria-pressed="true">待处理<span>2/);
  assert.match(markup, /data-id="all"[^>]*>全部<span>5/);
  assert.match(renderMobileTaskFilters({ ...state, taskFilter: '<bad>' }), /data-id="all" class="active"/);
});
