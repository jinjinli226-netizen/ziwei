import { accountId, workspaceId, scopeKey, list, id, executionUncertain } from './model.js';

const IMAGE_LIMIT = 10 * 1024 * 1024;
const avatarLimit = 2 * 1024 * 1024;
async function digest(value) {
  if (!globalThis.crypto?.subtle) throw new Error('当前环境无法安全保存发送标识，请重新打开应用');
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}
const activeExecution = execution => ['pending', 'queued', 'acked', 'running', 'executing'].includes(execution?.status) || executionUncertain(execution);
const imageMime = bytes => {
  if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((v, i) => bytes[i] === v)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  const prefix = String.fromCharCode(...bytes.subarray(0, 12));
  if (prefix.startsWith('GIF87a') || prefix.startsWith('GIF89a')) return 'image/gif';
  if (prefix.startsWith('RIFF') && prefix.slice(8, 12) === 'WEBP') return 'image/webp';
  return '';
};
async function readImages(files) {
  if (files.length > 20) throw new Error('每条消息最多附加 20 张图片');
  if (files.reduce((sum, file) => sum + file.size, 0) > IMAGE_LIMIT) throw new Error('图片合计不能超过 10 MiB');
  const values = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mimeType = imageMime(bytes);
    if (!mimeType) throw new Error(`${file.name}：请选择 PNG、JPEG、GIF 或 WebP 图片`);
    if (bytes.length > IMAGE_LIMIT) throw new Error('图片合计不能超过 10 MiB');
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    values.push({ name: file.name || '图片', mimeType, size: bytes.length, content: btoa(binary), contentEncoding: 'base64' });
  }
  return values;
}

/** UI effects are scoped to the authenticated account, workspace and selected employee. */
export function createController({ state, api, render = () => {}, storage = globalThis.localStorage, reporting } = {}) {
  let epoch = 0, employeeEpoch = 0, phoneEpoch = 0, disposed = false, timer = null, refreshing = false, refreshToken = 0, attachmentEpoch = 0, nativePaused = false;
  const composers = new Map(), pendingMutations = new Set(), routineRequests = new Map(), messageKeys = new Set();
  const workspaceKey = userId => `ziwei.mobile.workspace:${userId}`;
  const messageKey = () => `ziwei.manager.message.v1:${encodeURIComponent(accountId(state))}:${encodeURIComponent(workspaceId(state))}:${encodeURIComponent(state.selectedEmployee?.id || '')}`;
  const current = () => ({ epoch, scope: scopeKey(state), employeeEpoch, employeeId: state.selectedEmployee?.id });
  const valid = (token, employee = false) => !disposed && token.epoch === epoch && token.scope === scopeKey(state) && (!employee || (token.employeeEpoch === employeeEpoch && token.employeeId === state.selectedEmployee?.id));
  const draw = () => { if (!disposed) render(state); };
  const storeGet = key => { try { return storage?.getItem(key); } catch { return null; } };
  const storeSet = (key, value) => { try { storage?.setItem(key, value); } catch {} };
  function persistMessage(key, value) {
    if (!storage?.setItem) throw new Error('无法保存发送标识，请启用应用存储后再发送');
    try { storage.setItem(key, JSON.stringify(value)); messageKeys.add(key); }
    catch { throw new Error('无法保存发送标识，请释放应用存储空间后再发送'); }
  }
  function clearAccountRequests(userId) {
    const prefix = `ziwei.manager.message.v1:${encodeURIComponent(userId)}:`;
    const keys = new Set(messageKeys);
    try { for (let index = 0; index < storage.length; index++) keys.add(storage.key(index)); } catch {}
    for (const key of keys) if (key?.startsWith(prefix)) { try { storage?.removeItem(key); } catch {} messageKeys.delete(key); }
  }
  const composerKey = () => `${scopeKey(state)}:${state.selectedEmployee?.id || ''}`;
  function composer() {
    const key = composerKey();
    if (!composers.has(key)) composers.set(key, { draft: '', attachments: [], request: null, revision: 0 });
    return composers.get(key);
  }
  function stashComposer() {
    if (!state.selectedEmployee || state.page !== 'chat') return;
    const item = composer(); item.draft = state.draft || ''; item.attachments = state.attachments || [];
  }
  function restoreComposer() {
    const item = composer(); state.draft = item.draft; state.attachments = item.attachments;
  }
  function clearSelection() {
    employeeEpoch++; phoneEpoch++; attachmentEpoch++;
    state.selectedEmployee = null; state.bot = null; state.conversation = null; state.messages = [];
    state.runs = []; state.routines = []; state.phone = null; state.draft = ''; state.attachments = [];
    state.sending = false; state.attachmentReading = false; state.employeeSaving = false; state.stopBusy = false;
    state.employeeAvatar = undefined; state.phoneLoading = false; state.busy = false; state.task = null;
  }
  function clearWorkspace() {
    clearSelection(); state.employees = []; state.bots = []; state.tasks = []; state.devices = []; state.phones = [];
    state.report = null; state.reportSelection = []; state.page = 'home'; state.tab = 'employees'; state.imagePreview = null;
    state.phoneCommand = null; state.phoneError = ''; state.loading = false; state.busy = false;
  }
  function requireLogin(message = '', explicitLogout = false) {
    const userId = accountId(state);
    reporting?.clear?.(state);
    if (explicitLogout && userId) clearAccountRequests(userId);
    if (userId) { try { storage?.removeItem(workspaceKey(userId)); } catch {} }
    epoch++; refreshing = false; refreshToken++; composers.clear(); pendingMutations.clear(); routineRequests.clear(); clearWorkspace();
    state.user = null; state.workspace = null; state.workspaces = []; state.phase = 'login'; state.error = message; state.notice = ''; draw();
  }
  function fail(error, token = current(), employee = false) {
    if (!valid(token, employee)) return false;
    if (error?.status === 401) requireLogin('登录已过期，请重新登录');
    else { state.error = error?.message || '操作未完成，请稍后重试'; draw(); }
    return false;
  }
  const action = fn => async data => {
    const token = current();
    try { return await fn(data || {}); } catch (error) { return fail(error, token); }
  };
  const role = () => typeof state.workspace === 'object' ? state.workspace?.role : state.workspaces.find(ws => ws.slug === workspaceId(state))?.role;
  const canUsePhones = () => ['owner', 'admin'].includes(role());
  function mergeEmployees(employees = state.employees, bots = state.bots) {
    const byId = new Map(bots.map(bot => [bot.employee_id || bot.id, bot]));
    return employees.map(employee => ({ ...employee, ...(byId.has(employee.id) ? { bot: byId.get(employee.id) } : {}) }));
  }
  function acceptBot(bot) {
    state.bots = state.bots.map(item => item.id === bot.id ? bot : item);
    if (!state.bots.some(item => item.id === bot.id)) state.bots.push(bot);
    state.employees = state.employees.map(employee => employee.id === bot.id ? { ...employee, ...(bot.employee || {}), bot } : employee);
    if (state.selectedEmployee?.id === bot.id) { state.bot = bot; state.selectedEmployee = state.employees.find(employee => employee.id === bot.id) || { ...state.selectedEmployee, ...bot.employee, bot }; }
  }
  async function refresh({ silent = false } = {}) {
    if (disposed || !state.user || !workspaceId(state) || refreshing) return false;
    const token = current(), workspace = workspaceId(state), requestId = ++refreshToken;
    refreshing = true;
    if (!silent) { state.loading = true; state.error = ''; draw(); }
    try {
      const results = await Promise.allSettled([api.employees(workspace), api.bots(workspace), api.tasks(workspace), api.devices(workspace)]);
      if (!valid(token)) return false;
      const authFailure = results.find(result => result.status === 'rejected' && result.reason?.status === 401);
      if (authFailure) throw authFailure.reason;
      const [employees, bots, tasks, devices] = results;
      if (bots.status === 'fulfilled') state.bots = list(bots.value, 'bots');
      if (employees.status === 'fulfilled') state.employees = mergeEmployees(list(employees.value, 'employees'), state.bots);
      else state.employees = mergeEmployees(state.employees, state.bots);
      if (tasks.status === 'fulfilled') state.tasks = list(tasks.value, 'tasks');
      if (devices.status === 'fulfilled') state.devices = list(devices.value, 'devices');
      if (state.selectedEmployee) state.selectedEmployee = state.employees.find(employee => employee.id === state.selectedEmployee.id) || state.selectedEmployee;
      const failures = results.filter(result => result.status === 'rejected');
      if (failures.length) state.error = failures.map(result => result.reason.message).join('；');
      state.lastRefreshed = new Date().toISOString();
      const selectedToken = current();
      if (state.page === 'chat' || state.page === 'detail' || state.page === 'employee-detail') await refreshEmployee(selectedToken);
      if (!valid(token)) return false;
      if (['phones', 'devices'].includes(state.tab) || state.page === 'phone') await refreshPhones(token);
      if (!valid(token)) return false;
      if (state.page.startsWith('report') && state.report?.status !== 'selecting') await reporting?.refresh?.(state);
      return true;
    } catch (error) { return fail(error, token); }
    finally { if (requestId === refreshToken) refreshing = false; if (valid(token)) { state.loading = false; draw(); } }
  }
  async function refreshEmployee(token = current()) {
    const employee = state.selectedEmployee;
    if (!employee) return;
    const workspace = workspaceId(state), conversationId = state.conversation?.id;
    const hasBot = employee.bot?.configuration_state === 'initialized' || state.bot?.id === employee.id && state.bot.configuration_state === 'initialized';
    const results = await Promise.allSettled([
      employee.runtime === 'Hermes' || employee.bot ? api.bot(workspace, employee.id) : Promise.resolve(null),
      hasBot ? api.botRuns(workspace, employee.id) : Promise.resolve({ runs: [] }),
      hasBot ? api.botRoutines(workspace, employee.id) : Promise.resolve({ routines: [] }),
      ...(conversationId ? [api.conversation(conversationId)] : []),
    ]);
    if (!valid(token, true)) return;
    const unauthorized = results.find(value => value.status === 'rejected' && value.reason?.status === 401);
    if (unauthorized) throw unauthorized.reason;
    if (results[0].status === 'fulfilled' && results[0].value) acceptBot(results[0].value);
    if (results[1].status === 'fulfilled') state.runs = list(results[1].value, 'runs');
    if (results[2].status === 'fulfilled') state.routines = list(results[2].value, 'routines');
    if (results[3]?.status === 'fulfilled' && state.conversation?.id === conversationId) { state.conversation = results[3].value; state.messages = state.conversation.messages || []; }
    const error = results.find(value => value.status === 'rejected');
    if (error) state.error = error.reason.message;
  }
  async function refreshPhones(token = current()) {
    if (!canUsePhones()) { if (valid(token)) { state.phones = []; state.phone = null; state.phoneError = '手机互联需要工作区 Owner 或管理员权限'; } return; }
    const workspace = workspaceId(state), phoneId = state.phone?.id, visit = phoneEpoch;
    try {
      const result = await api.phones(workspace);
      if (!valid(token)) return;
      state.phones = list(result, 'devices'); state.phoneError = '';
      if (state.page === 'phone' && phoneId) {
        const [detail, snapshot] = await Promise.all([api.phone(workspace, phoneId, state.phoneCommand?.id || ''), api.phoneSnapshot(workspace, phoneId)]);
        if (!valid(token) || visit !== phoneEpoch || state.phone?.id !== phoneId) return;
        state.phone = { ...(detail.device || {}), snapshot: snapshot.snapshot || null };
        if (state.phoneCommand) {
          const receipt = state.phone.commands?.find(command => command.id === state.phoneCommand.id);
          if (receipt) state.phoneCommand = receipt;
        }
      }
    } catch (error) {
      if (error?.status === 401) throw error;
      if (valid(token)) { state.phoneError = error.message; state.error = error.message; }
    }
  }
  async function chooseWorkspace(workspace) {
    if (!workspace) throw new Error('工作区不存在或尚未授权');
    stashComposer(); epoch++; refreshing = false; refreshToken++; clearWorkspace(); state.workspace = workspace;
    state.phase = 'ready'; state.error = ''; state.notice = '';
    storeSet(workspaceKey(accountId(state)), workspace.slug);
    state.report = reporting?.restore?.({ userId: accountId(state), workspace: workspace.slug }) || null;
    draw(); await refresh();
  }
  async function loadPrincipal(principal) {
    state.user = principal;
    const result = await api.workspaces();
    state.workspaces = list(result, 'workspaces');
    const preferred = storeGet(workspaceKey(accountId(state)));
    const workspace = state.workspaces.find(item => item.slug === preferred) || state.workspaces.find(item => item.slug === principal.workspace?.slug) || state.workspaces[0];
    if (workspace) await chooseWorkspace(workspace);
    else { state.phase = 'workspace'; state.page = 'workspaces'; state.workspace = null; draw(); }
  }
  async function openEmployee(employeeId, page) {
    const employee = state.employees.find(item => item.id === employeeId);
    if (!employee) throw new Error('这位员工不在当前工作区中，请刷新');
    stashComposer(); clearSelection(); state.selectedEmployee = employee; state.bot = employee.bot || null;
    state.page = page; state.error = ''; state.busy = true; restoreComposer(); draw();
    const token = current(), workspace = workspaceId(state);
    try {
      const bot = employee.runtime === 'Hermes' || employee.bot ? await api.bot(workspace, employeeId) : null;
      if (!valid(token, true)) return;
      if (bot) acceptBot(bot);
      if (page === 'chat') {
        const conversation = await api.getEmployeeConversation(workspace, { ...employee, bot });
        if (!valid(token, true)) return;
        state.conversation = conversation; state.messages = conversation.messages || [];
      }
      await refreshEmployee(token);
    } catch (error) { fail(error, token, true); }
    finally { if (valid(token, true)) { state.busy = false; draw(); } }
  }
  async function sendChat(form) {
    if (state.sending || state.attachmentReading) return;
    if (form.has('draft') || form.has('message') || form.has('content')) state.draft = String(form.get('draft') ?? form.get('message') ?? form.get('content') ?? '');
    if (state.page.startsWith('report')) {
      const token = current(), text = state.draft.trim(), attachments = [...state.attachments];
      if (!text && !attachments.length) return;
      state.sending = true; state.error = ''; draw();
      try {
        await reporting.ask(state, text, attachments);
        if (valid(token)) { state.draft = ''; state.attachments = []; }
      } catch (error) { fail(error, token); }
      finally { if (valid(token)) { state.sending = false; draw(); } }
      return;
    }
    if (!state.conversation?.id || !state.selectedEmployee) throw new Error('请先打开员工聊天');
    if (activeExecution(state.conversation.execution)) throw new Error('当前工作尚未结束，请等待回执或使用停止入口');
    stashComposer();
    const item = composer(), content = item.draft.trim(), attachments = [...item.attachments];
    if (!content && !attachments.length) return;
    const fingerprint = JSON.stringify([state.conversation.id, content, attachments]);
    const token = current(), conversationId = state.conversation.id, revision = item.revision, requestKey = messageKey();
    state.sending = true; state.error = ''; draw();
    try {
      const fingerprintHash = await digest(fingerprint);
      if (!valid(token, true)) return;
      let stored = null;
      try { stored = JSON.parse(storeGet(requestKey) || 'null'); } catch {}
      if (item.request?.fingerprintHash !== fingerprintHash) {
        item.request = { conversationId, fingerprintHash, clientMessageId: stored?.conversationId === conversationId && stored?.fingerprintHash === fingerprintHash ? stored.clientMessageId : id() };
      }
      const request = item.request;
      // Store only a hash and request identity, never the message or its image bytes.
      persistMessage(requestKey, request);
      await api.sendMessage(conversationId, { content, attachments, clientMessageId: request.clientMessageId });
      // A different employee may now be open. Complete only the original composer's draft.
      if (item.request === request) {
        if (item.revision === revision) { item.draft = ''; item.attachments = []; }
        item.request = null;
      }
      try {
        if (JSON.parse(storeGet(requestKey) || 'null')?.clientMessageId === request.clientMessageId) storage?.removeItem(requestKey);
      } catch {}
      if (!valid(token, true)) return;
      restoreComposer();
      const conversation = await api.conversation(conversationId);
      if (valid(token, true)) { state.conversation = conversation; state.messages = conversation.messages || []; }
    } catch (error) { fail(error, token, true); }
    finally { if (valid(token, true)) { state.sending = false; draw(); } }
  }
  async function saveEmployee(form) {
    const employee = state.selectedEmployee;
    if (!employee || state.employeeSaving) return;
    if (state.attachmentReading) throw new Error('头像还在读取，请稍后保存');
    const token = current(), workspace = workspaceId(state), body = {
      name: String(form.get('name') || '').trim(), description: String(form.get('description') || '').trim(),
    };
    if (!body.name) throw new Error('请输入员工名字');
    if (state.employeeAvatar !== undefined) body.avatar = state.employeeAvatar;
    else if (typeof form.get('avatar') === 'string') body.avatar = form.get('avatar');
    state.employeeSaving = true; state.error = ''; draw();
    try {
      if (state.bot?.configuration_state === 'initialized') {
        const bot = await api.updateBot(workspace, employee.id, { expectedRevision: state.bot.revision, employee: body });
        if (valid(token, true)) acceptBot(bot);
      } else {
        const saved = await api.updateEmployee(workspace, employee.id, body);
        if (valid(token, true)) { state.employees = state.employees.map(row => row.id === employee.id ? { ...row, ...saved } : row); state.selectedEmployee = state.employees.find(row => row.id === employee.id); }
      }
      if (valid(token, true)) { state.employeeAvatar = undefined; state.notice = '已保存'; }
    } catch (error) { fail(error, token, true); }
    finally { if (valid(token, true)) { state.employeeSaving = false; draw(); } }
  }
  async function mutateRoutine(routineId, run = false) {
    if (!state.selectedEmployee || !routineId) throw new Error('请先选择例行工作');
    const token = current(), workspace = workspaceId(state), employeeId = state.selectedEmployee.id, key = `${scopeKey(state)}:${employeeId}:routine:${routineId}`;
    if (pendingMutations.has(key)) return;
    const routine = state.routines.find(item => item.id === routineId || item.automation_id === routineId);
    if (!routine) throw new Error('例行工作已变化，请刷新');
    pendingMutations.add(key); state.busy = true; state.error = ''; draw();
    try {
      if (run) {
        if (!routineRequests.has(key)) routineRequests.set(key, id());
        await api.runRoutine(workspace, employeeId, routineId, { idempotencyKey: routineRequests.get(key) });
        routineRequests.delete(key);
      }
      else await api.updateRoutine(workspace, employeeId, routineId, { status: routine.status === 'active' ? 'paused' : 'active' });
      if (valid(token, true)) { await refreshEmployee(token); state.notice = run ? '已提交运行请求，请查看实际回执' : '例行工作已更新'; }
    } catch (error) { fail(error, token, true); }
    finally { pendingMutations.delete(key); if (valid(token, true)) { state.busy = false; draw(); } }
  }
  async function saveTask(form) {
    const task = state.task;
    if (!task || state.busy) return;
    const token = current(), title = String(form.get('title') || '').trim(), description = String(form.get('description') || '');
    if (!title) throw new Error('请输入任务名称');
    state.busy = true; state.error = ''; draw();
    try {
      let saved = await api.updateTask(task.id, { title, description });
      const status = String(form.get('status') || form.get('state') || '');
      if (valid(token) && status && status !== saved.state) saved = await api.changeTaskState(task.id, status);
      if (valid(token)) {
        state.tasks = state.tasks.map(row => row.id === task.id ? { ...row, ...saved } : row);
        if (state.page === 'task' && state.task?.id === task.id) state.task = { ...task, ...saved };
        state.notice = '任务已保存';
      }
    } catch (error) { fail(error, token); }
    finally { if (valid(token)) { state.busy = false; draw(); } }
  }
  async function createRoutine(form) {
    const employeeId = state.selectedEmployee?.id;
    if (!employeeId || state.busy) return;
    if (state.bot?.configuration_state !== 'initialized') throw new Error('请先在电脑版完成这位员工的 Bot 配置，再添加例行工作');
    const input = Object.fromEntries(['name', 'schedule', 'timezone', 'prompt'].map(key => [key, String(form.get(key) || '').trim()]));
    if (!input.name || !input.schedule || !input.prompt) throw new Error('请填写名称、执行计划和工作内容');
    input.timezone ||= 'Asia/Shanghai';
    const key = `${scopeKey(state)}:${employeeId}:routine:create`, fingerprint = JSON.stringify(input), previous = routineRequests.get(key);
    const request = previous?.fingerprint === fingerprint ? previous : { fingerprint, idempotencyKey: id() };
    routineRequests.set(key, request);
    const token = current(), workspace = workspaceId(state);
    state.busy = true; state.error = ''; draw();
    try {
      await api.createRoutine(workspace, employeeId, { ...input, idempotencyKey: request.idempotencyKey });
      routineRequests.delete(key);
      if (valid(token, true)) { state.notice = '例行工作已保存'; await refreshEmployee(token); }
    } catch (error) { fail(error, token, true); }
    finally { if (valid(token, true)) { state.busy = false; draw(); } }
  }
  const actions = {
    navigate: action(async ({ tab }) => {
      if (!['employees', 'work', 'tasks', 'phones', 'devices', 'me'].includes(tab)) return;
      stashComposer(); clearSelection(); state.tab = tab; state.page = 'home'; state.error = ''; draw();
      if (['phones', 'devices'].includes(tab)) { await refreshPhones(current()); draw(); } else await refresh({ silent: true });
    }),
    back: action(async () => {
      if (state.imagePreview) { state.imagePreview = null; draw(); return; }
      stashComposer(); clearSelection(); state.page = 'home'; state.phase = workspaceId(state) ? 'ready' : 'workspace'; state.error = ''; draw();
    }),
    refresh: action(() => refresh()),
    'switch-workspace': action(() => { stashComposer(); clearSelection(); state.phase = 'workspace'; state.page = 'workspaces'; draw(); }),
    'select-workspace': action(({ id: slug }) => chooseWorkspace(state.workspaces.find(item => item.slug === slug || item.workspace_id === slug))),
    chat: action(({ id: employeeId }) => openEmployee(employeeId, 'chat')),
    'employee-detail': action(({ id: employeeId }) => openEmployee(employeeId, 'detail')),
    task: action(async ({ id: taskId }) => {
      const task = state.tasks.find(item => item.id === taskId);
      if (!task) throw new Error('任务不存在，请刷新');
      stashComposer(); clearSelection(); state.task = task; state.page = 'task'; state.error = ''; draw();
      const token = current(), detail = await api.task(taskId);
      if (valid(token) && state.page === 'task' && state.task?.id === taskId) { state.task = detail; draw(); }
    }),
    filter: action(({ filter }) => { if (['all','running','attention'].includes(filter)) state.filter = filter; draw(); }),
    'report-setup': action(async () => {
      if (state.report?.status === 'active' || state.report?.status === 'finished') {
        stashComposer(); clearSelection(); state.page = state.report.status === 'finished' ? 'report-summary' : 'report'; state.draft = ''; state.attachments = [];
        draw(); if (state.report.status === 'active') { await reporting.refresh(state); draw(); } return;
      }
      newReport();
    }),
    'report-new': action(() => newReport()),
    'report-toggle': action(({ id: employeeId }) => {
      if (!state.employees.some(employee => employee.id === employeeId)) return;
      state.reportSelection = state.reportSelection.includes(employeeId) ? state.reportSelection.filter(value => value !== employeeId) : [...state.reportSelection, employeeId];
      reporting.select(state, state.reportSelection, state.employees); draw();
    }),
    'report-up': action(({ id: employeeId }) => reorderReport(employeeId, -1)),
    'report-down': action(({ id: employeeId }) => reorderReport(employeeId, 1)),
    'report-start': action(async () => { if (!state.reportSelection.length || state.busy) return; state.page = 'report'; return reportAction('start', state.reportSelection); }),
    'report-next': action(() => reportAction('next')),
    'report-skip': action(() => reportAction('skip')),
    'report-finish': action(() => reportAction('finish')),
    'report-todo': action(({id:index}) => reportAction('createTodo',Number(index))),
    'report-home': action(() => { clearSelection(); state.page = 'home'; state.tab = 'employees'; draw(); }),
    'stop-run': action(async ({ id: employeeId = state.selectedEmployee?.id }) => {
      const workspace = workspaceId(state), token = current(), key = `${scopeKey(state)}:${employeeId}:stop`;
      if (!employeeId || pendingMutations.has(key)) return;
      pendingMutations.add(key); state.stopBusy = true; state.error = ''; draw();
      try {
        const bot = await api.bot(workspace, employeeId);
        if (!valid(token)) return;
        if (bot.configuration_state !== 'initialized') throw new Error('这位员工尚未提供手机端停止入口，请在电脑版处理');
        const result = await api.controlBot(workspace, employeeId, { operation: 'stop', expectedRevision: bot.revision, expectedControlEpoch: bot.control_epoch });
        if (valid(token)) { acceptBot(result); state.notice = '停止请求已提交，以电脑回执为准'; await refresh({ silent: true }); }
      } catch (error) { fail(error, token); }
      finally { pendingMutations.delete(key); if (valid(token)) { state.stopBusy = false; draw(); } }
    }),
    'remove-attachment': action(({ id: index }) => { state.attachments = state.attachments.filter((_, i) => i !== Number(index)); if (state.selectedEmployee && state.page === 'chat') { stashComposer(); composer().revision++; } draw(); }),
    phone: action(async ({ id: phoneId }) => {
      if (!canUsePhones()) throw new Error('手机互联需要工作区 Owner 或管理员权限');
      const phone = state.phones.find(item => item.id === phoneId);
      if (!phone) throw new Error('手机不存在，请刷新');
      phoneEpoch++; state.phone = phone; state.phoneCommand = null; state.page = 'phone'; state.error = ''; draw(); await refreshPhones(current()); draw();
    }),
    'phone-refresh': action(async ({ id: phoneId = state.phone?.id }) => {
      if (!canUsePhones()) throw new Error('手机互联需要工作区 Owner 或管理员权限');
      if (!phoneId || state.phoneLoading) return;
      if (state.phoneError) throw new Error('手机状态尚未同步，请先刷新设备');
      if (state.phone?.id !== phoneId || state.page !== 'phone') {
        const phone = state.phones.find(item => item.id === phoneId);
        if (!phone) throw new Error('手机不存在，请刷新');
        stashComposer(); clearSelection(); phoneEpoch++; state.phone = phone; state.phoneCommand = null; state.page = 'phone';
      }
      const token = current(), workspace = workspaceId(state), visit = phoneEpoch;
      state.phoneLoading = true; state.error = ''; draw();
      try {
        if (state.phoneCommand && ['queued', 'delivered', 'executing', 'uncertain'].includes(state.phoneCommand.status)) { await refreshPhones(token); return; }
        const result = await api.phoneCommand(workspace, phoneId, 'screenshot', {});
        if (!valid(token) || visit !== phoneEpoch) return;
        state.phoneCommand = result.command; state.notice = '已请求截图，等待手机回执'; await refreshPhones(token);
      } catch (error) { fail(error, token); }
      finally { if (valid(token) && visit === phoneEpoch) { state.phoneLoading = false; draw(); } }
    }),
    image: action(({ src }) => { state.imagePreview = src; draw(); }),
    'close-image': action(() => { state.imagePreview = null; draw(); }),
    logout: action(async () => { await api.logout(); requireLogin('', true); }),
    'open-desktop': action(() => { globalThis.ZiweiManager?.openDesktop?.(); }),
    'routine-toggle': action(({ id: routineId }) => mutateRoutine(routineId)),
    'routine-run': action(({ id: routineId }) => mutateRoutine(routineId, true)),
  };
  function newReport() {
    if (state.busy || state.sending) return;
    stashComposer(); clearSelection(); state.page = 'report-setup'; state.draft = ''; state.attachments = [];
    state.reportSelection = state.reportSelection.filter(employeeId => state.employees.some(employee => employee.id === employeeId));
    reporting.select(state, state.reportSelection, state.employees); draw();
  }
  function reorderReport(employeeId, direction) {
    const index = state.reportSelection.indexOf(employeeId), target = index + direction;
    if (index < 0 || target < 0 || target >= state.reportSelection.length) return;
    [state.reportSelection[index], state.reportSelection[target]] = [state.reportSelection[target], state.reportSelection[index]];
    reporting.select(state, state.reportSelection, state.employees); draw();
  }
  async function reportAction(method, value) {
    if (state.busy) return;
    const token = current(); state.busy = true; state.error = ''; draw();
    try { await reporting[method](state, value); }
    catch (error) { fail(error, token); }
    finally { if (valid(token) && state.page.startsWith('report')) { state.busy = false; draw(); } }
  }
  async function submit(form, values) {
    const name = typeof form === 'string' ? form : form?.dataset?.form;
    const data = values || new FormData(form), token = current();
    try {
      if (name === 'login') {
        if (state.busy) return;
        state.busy = true; state.error = ''; draw();
        const principal = await api.login({ email: String(data.get('email') || data.get('username') || '').trim(), password: String(data.get('password') || '') });
        if (valid(token)) await loadPrincipal(principal);
      } else if (name === 'chat') await sendChat(data);
      else if (name === 'employee') await saveEmployee(data);
      else if (name === 'routine') {
        const routineId = String(data.get('routineId') || data.get('id') || '');
        if (routineId) await mutateRoutine(routineId, true); else await createRoutine(data);
      }
      else if (name === 'task') await saveTask(data);
    } catch (error) { fail(error, token); }
    finally { if (!disposed && name === 'login') { state.busy = false; draw(); } }
  }
  async function change(event) {
    const target = event?.target || event;
    if (!target) return;
    if (target.name === 'search') { state.search = target.value; draw(); return; }
    if (['message','content','draft'].includes(target.name)) { state.draft = target.value; if (state.selectedEmployee && state.page === 'chat') { stashComposer(); composer().revision++; } return; }
    if (!['images', 'attachments', 'avatar'].includes(target.name) || !target.files?.length) return;
    const token = current(), readToken = ++attachmentEpoch, avatar = target.name === 'avatar', page = state.page, reportIndex = state.report?.index;
    state.attachmentReading = true; state.error = ''; draw();
    try {
      const files = Array.from(target.files), original = [...state.attachments];
      if (!avatar && original.length + files.length > 20) throw new Error('每条消息最多附加 20 张图片');
      if (avatar && files.length !== 1) throw new Error('请选择一张头像');
      if (avatar && files[0].size > avatarLimit) throw new Error('头像不能超过 2 MiB');
      const images = await readImages(files);
      if (!valid(token, true) || state.page !== page || state.report?.index !== reportIndex || attachmentEpoch !== readToken) return;
      if (avatar) state.employeeAvatar = `data:${images[0].mimeType};base64,${images[0].content}`;
      else {
        if ([...original, ...images].reduce((sum, item) => sum + item.size, 0) > IMAGE_LIMIT) throw new Error('图片合计不能超过 10 MiB');
        state.attachments = [...original, ...images]; if (state.selectedEmployee && state.page === 'chat') { stashComposer(); composer().revision++; }
      }
    } catch (error) { fail(error, token); }
    finally { if (attachmentEpoch === readToken && valid(token)) { state.attachmentReading = false; draw(); } target.value = ''; }
  }
  const resume = () => { nativePaused = false; if (!disposed) void refresh({ silent: true }); };
  const pause = () => { nativePaused = true; };
  const visibility = () => { if (!globalThis.document?.hidden) resume(); };
  function schedule() {
    if (timer) clearInterval(timer);
    timer = setInterval(() => { if (!nativePaused && !globalThis.document?.hidden) void refresh({ silent: true }); }, 8000);
    timer.unref?.();
  }
  async function boot() {
    const token = current(); state.phase = 'boot'; state.error = ''; draw();
    globalThis.document?.addEventListener('visibilitychange', visibility);
    globalThis.addEventListener?.('ziwei:resume', resume);
    globalThis.addEventListener?.('ziwei:pause', pause);
    schedule();
    try {
      const principal = await api.authMe();
      if (valid(token)) await loadPrincipal(principal);
    } catch (error) {
      if (!disposed && token.epoch === epoch) {
        if (error.status === 401) requireLogin();
        else { state.phase = 'login'; state.error = error.message; draw(); }
      }
    }
  }
  function dispose() {
    disposed = true; epoch++; clearInterval(timer); timer = null; composers.clear(); pendingMutations.clear(); routineRequests.clear();
    globalThis.document?.removeEventListener('visibilitychange', visibility);
    globalThis.removeEventListener?.('ziwei:resume', resume);
    globalThis.removeEventListener?.('ziwei:pause', pause);
  }
  return { actions, submit, change, refresh, boot, dispose };
}
