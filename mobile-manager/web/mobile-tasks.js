import { accountId, workspaceId, list } from './model.js';

export const MOBILE_TASK_LIMITS = Object.freeze({ title: 200, description: 10000 });
export const MOBILE_TASK_FILTERS = Object.freeze([
  Object.freeze({ id: 'all', label: '全部' }), Object.freeze({ id: 'pending', label: '待处理' }),
  Object.freeze({ id: 'running', label: '进行中' }), Object.freeze({ id: 'completed', label: '已完成' }),
]);
const pendingStates = new Set(['planned', 'todo', 'blocked', 'review', 'failed', 'expired', 'uncertain', 'paused']);
const runningStates = new Set(['in_progress', 'running', 'executing', 'pending', 'queued', 'acked', 'delivered', 'acknowledged']);
const completedStates = new Set(['completed', 'succeeded', 'done']);
const identity = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 512;
const scopeOf = state => ({ accountId: accountId(state), workspaceId: workspaceId(state) });
const scopeKey = scope => JSON.stringify([scope.accountId, scope.workspaceId]);
const fingerprint = body => JSON.stringify([body.title, body.description, body.assignee]);
const roleOf = state => state.workspace?.role || state.workspaces?.find(workspace => workspace.slug === workspaceId(state))?.role || '';
const fresh = scope => ({ scope: scopeKey(scope), workspace: scope.workspaceId, title: '', description: '', assignee: '', saving: false, unknown: false, reviewed: false, error: '', refreshError: '', savedTask: null });

/** Canonical task states are kept distinct; cancelled/stopped/unknown remain in All. */
export function taskBucket(task) {
  const status = task?.state ?? task?.status;
  return pendingStates.has(status) ? 'pending' : runningStates.has(status) ? 'running' : completedStates.has(status) ? 'completed' : 'other';
}
export function filterMobileTasks(tasks, filter = 'all') {
  const rows = Array.isArray(tasks) ? tasks.filter(task => task && typeof task === 'object' && !Array.isArray(task)) : [];
  return MOBILE_TASK_FILTERS.some(item => item.id === filter) && filter !== 'all' ? rows.filter(task => taskBucket(task) === filter) : rows.slice();
}
export function canCreateMobileTask(state) { return ['owner', 'admin', 'member'].includes(roleOf(state)); }

/**
 * The ordinary task POST has no idempotency contract. One explicit save sends
 * only a planned record. Unknown writes stay locked by scope and form content
 * during this controller's lifetime; reading or reopening never repeats them.
 * These memory guards are not a cross-restart idempotency guarantee.
 */
export function createMobileTasks({ state, api, current = () => ({}), valid = () => true, draw = () => {}, fail = () => {}, onSaved = () => {} } = {}) {
  let disposed = false, refreshSequence = 0;
  const forms = new Map(), unknownWrites = new Map();
  const scopeMatches = data => data.scope === scopeKey(scopeOf(state));
  const authorized = token => !disposed && valid(token) && Boolean(accountId(state) && workspaceId(state));
  const active = (data, token) => authorized(token) && scopeMatches(data) && state.mobileTaskForm === data && state.page === 'mobile-task-new';
  function unknownSet(scope) { if (!unknownWrites.has(scope)) unknownWrites.set(scope, new Set()); return unknownWrites.get(scope); }
  function showError(data, message) { data.error = message; draw(); return false; }

  function open() {
    if (disposed || state.phase !== 'ready' || !accountId(state) || !workspaceId(state)) return false;
    if (!canCreateMobileTask(state)) { fail(Object.assign(new Error('当前工作区角色不能记录待办'), { status: 403 }), current()); return false; }
    const scope = scopeOf(state), key = scopeKey(scope);
    let data = forms.get(key);
    if (!data || data.savedTask) { data = fresh(scope); forms.set(key, data); }
    state.mobileTaskForm = data; state.page = 'mobile-task-new'; state.tab = 'work'; draw(); return true;
  }

  function change(event) {
    const target = event?.target || event, data = state.mobileTaskForm;
    if (disposed || !target || !data || state.page !== 'mobile-task-new' || !scopeMatches(data)) return false;
    const names = { 'mobile-task-title': 'title', 'mobile-task-description': 'description', 'mobile-task-assignee': 'assignee' };
    const key = names[target.name];
    if (!key) return false;
    if (!data.saving && !data.unknown && !data.savedTask) { data[key] = String(target.value || ''); data.error = ''; }
    return true;
  }

  async function refreshList(data, token, { savedTask } = {}) {
    if (!authorized(token) || !scopeMatches(data)) return false;
    state.page = 'home'; state.tab = 'work'; state.mobileTaskForm = null;
    if (savedTask) {
      state.taskFilter = 'pending'; state.notice = '待办已记录';
      state.tasks = [savedTask, ...list(state.tasks).filter(task => task.id !== savedTask.id)];
    }
    const sequence = ++refreshSequence;
    const resource = state.resources?.tasks;
    if (resource) { resource.phase = 'loading'; resource.error = ''; }
    data.refreshError = ''; draw();
    try {
      const response = await api.tasks(data.workspace);
      if (!authorized(token) || !scopeMatches(data) || sequence !== refreshSequence) return false;
      if (!Array.isArray(response?.tasks)) throw new Error('工作列表返回无效，请刷新核对');
      // A readback does not prove which same-named task belongs to an unknown POST.
      data.reviewed = true; state.tasks = response.tasks;
      if (resource) Object.assign(resource, { phase: 'ready', error: '', lastUpdated: new Date().toISOString() });
      draw(); return true;
    } catch (error) {
      if (!authorized(token) || !scopeMatches(data) || sequence !== refreshSequence) return false;
      data.refreshError = savedTask ? '待办已记录，工作列表刷新失败，请刷新核对' : '工作列表刷新失败，请恢复连接后核对';
      if (resource) Object.assign(resource, { phase: 'error', error: data.refreshError });
      if (error?.status === 401) fail(error, token); else draw();
      return false;
    }
  }

  async function submit(form) {
    const data = state.mobileTaskForm, token = current();
    if (!data || !active(data, token) || data.saving || data.savedTask) return false;
    if (data.unknown) return showError(data, '这次保存尚未确认，请先到工作列表核对，避免重复记录');
    if (form?.get) {
      for (const [name, field] of [['title', 'mobile-task-title'], ['description', 'mobile-task-description'], ['assignee', 'mobile-task-assignee']]) {
        if (form.has(field)) data[name] = String(form.get(field) || '');
      }
    }
    if (!canCreateMobileTask(state)) return showError(data, '当前工作区角色不能记录待办');
    const title = data.title.trim(), description = data.description, assignee = data.assignee || null;
    if (!title || title.length > MOBILE_TASK_LIMITS.title) return showError(data, '请输入 200 字以内的待办名称');
    if (description.length > MOBILE_TASK_LIMITS.description) return showError(data, '待办说明最多 10000 个字符');
    if (assignee && !list(state.employees).some(employee => employee?.id === assignee && employee.status !== 'deleted')) return showError(data, '请选择当前工作区可见的员工');
    const body = { title, description, assignee, state: 'planned' }, key = fingerprint(body), expectedWorkspaceId = state.workspace?.id;
    if (unknownSet(data.scope).has(key)) { data.unknown = true; return showError(data, '这项待办的上次保存尚未确认，请到工作列表核对，不能重复提交'); }
    data.saving = true; data.error = ''; data.refreshError = ''; draw();
    let savedTask;
    try {
      savedTask = await api.createTask(data.workspace, body);
      if (disposed) return false;
      if (!savedTask || !identity(savedTask.id) || savedTask.title !== title || savedTask.description !== description ||
          (savedTask.assignee || null) !== assignee || savedTask.state !== 'planned' || (expectedWorkspaceId && savedTask.workspace_id !== expectedWorkspaceId)) {
        throw Object.assign(new Error('待办保存回执无法核对，请到工作列表确认'), { uncertain: true });
      }
      data.savedTask = savedTask; data.saving = false;
    } catch (error) {
      if (disposed) return false;
      data.saving = false;
      const status = Number(error?.status), unknown = error?.uncertain || !Number.isFinite(status) || status < 400 || status >= 500;
      if (unknown) { data.unknown = true; unknownSet(data.scope).add(key); }
      data.error = unknown ? '这次保存尚未确认，请先到工作列表核对，避免重复记录' : error?.message || '待办未保存，请检查后重试';
      if (authorized(token) && scopeMatches(data)) { if (error?.status === 401) fail(error, token); else draw(); }
      return false;
    }
    if (!active(data, token)) return true;
    onSaved(savedTask, token);
    await refreshList(data, token, { savedTask });
    return true;
  }

  const actions = {
    'mobile-task-new': open,
    'mobile-task-save': () => submit(),
    'mobile-task-review': async () => {
      const data = state.mobileTaskForm, token = current();
      if (!data || !active(data, token) || data.saving) return false;
      return refreshList(data, token);
    },
    'mobile-task-another': () => {
      const data = state.mobileTaskForm;
      if (!data || !active(data, current()) || data.saving || !data.unknown || !data.reviewed) return false;
      const next = fresh(scopeOf(state)); forms.set(next.scope, next); state.mobileTaskForm = next; state.page = 'mobile-task-new'; state.tab = 'work'; draw(); return true;
    },
    'work-filter': ({ id, filter } = {}) => {
      const selected = id || filter;
      if (disposed || !MOBILE_TASK_FILTERS.some(item => item.id === selected)) return false;
      state.taskFilter = selected; draw(); return true;
    },
  };
  function reset() { refreshSequence++; state.mobileTaskForm = null; state.taskFilter = 'all'; }
  function dispose() { disposed = true; refreshSequence++; forms.clear(); unknownWrites.clear(); }
  return { actions, change, submit, open, reset, dispose };
}
