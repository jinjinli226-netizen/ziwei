/** First-party session API. All workspace identifiers are explicit to avoid stale-tab routing. */
export function createApi({ fetchImpl = globalThis.fetch?.bind(globalThis), origin = '', onUnauthorized, readTimeoutMs = 20000 } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('缺少网络请求支持');
  const base = String(origin || '').replace(/\/$/, '');
  const enc = value => encodeURIComponent(String(value ?? ''));
  const ws = workspace => `/api/workspaces/${enc(typeof workspace === 'object' ? workspace?.slug : workspace)}`;
  const botPath = (workspace, id) => `${ws(workspace)}/bots/${enc(id)}`;
  const phonePath = (workspace, id = '') => `${ws(workspace)}/ziwei-connect/terminal/android-devices${id ? `/${enc(id)}` : ''}`;
  const query = value => {
    const text = typeof value === 'string' ? value.replace(/^\?/, '') : new URLSearchParams(Object.entries(value || {}).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
    return text ? `?${text}` : '';
  };
  async function request(path, { method = 'GET', body, signal } = {}) {
    const readController = method === 'GET' && readTimeoutMs > 0 ? new AbortController() : null;
    const forwardAbort = () => readController?.abort(signal.reason);
    if (readController && signal) {
      if (signal.aborted) forwardAbort(); else signal.addEventListener('abort', forwardAbort, { once: true });
    }
    let timedOut = false;
    const timeout = readController ? setTimeout(() => { timedOut = true; readController.abort(); }, readTimeoutMs) : null;
    try {
      let response, data;
      try {
        response = await fetchImpl(`${base}${path}`, {
          method, credentials: 'include', cache: 'no-store',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          ...((readController?.signal || signal) ? { signal: readController?.signal || signal } : {}),
        });
        data = response.status === 204 ? {} : await response.json().catch(cause => {
          if (!response.ok && !readController?.signal.aborted) return {};
          throw cause;
        });
      } catch (cause) {
        const error = new Error(timedOut ? '读取超时，请刷新重试' : method === 'GET' ? '连接失败或返回内容无法读取，请刷新重试' : '尚未收到操作回执，请先刷新核对；重试消息会沿用原请求标识');
        error.cause = cause;
        error.uncertain = method !== 'GET';
        if (timedOut) error.code = 'READ_TIMEOUT';
        throw error;
      }
      if (!response.ok) {
        const error = new Error(data.error || data.message || (response.status === 413 ? '图片内容超过服务器限制，请选择更小的图片' : `请求失败（${response.status}）`));
        error.status = response.status;
        error.code = data.code;
        error.data = data;
        if (response.status === 401) onUnauthorized?.(error);
        throw error;
      }
      return data;
    } finally {
      if (timeout !== null) clearTimeout(timeout);
      if (readController && signal) signal.removeEventListener('abort', forwardAbort);
    }
  }
  const get = (path, options) => request(path, options);
  const post = (path, body = {}) => request(path, { method: 'POST', body });
  const patch = (path, body) => request(path, { method: 'PATCH', body });
  const api = {
    authMe: () => get('/api/auth/me'),
    authStatus: () => get('/api/auth/status'),
    login: body => post('/api/auth/login', { email: body.email || body.username, password: body.password }),
    logout: () => post('/api/auth/logout'),
    workspaces: () => get('/api/workspaces'),
    employees: workspace => get(`${ws(workspace)}/employees`),
    bots: workspace => get(`${ws(workspace)}/bots`),
    bot: (workspace, id) => get(botPath(workspace, id)),
    botRuns: (workspace, id) => get(`${botPath(workspace, id)}/runs`),
    updateBot: (workspace, id, body) => patch(botPath(workspace, id), body),
    controlBot: (workspace, id, body) => post(`${botPath(workspace, id)}/control`, body),
    updateEmployee: (workspace, id, body) => patch(`${ws(workspace)}/employees/${enc(id)}`, body),
    tasks: (workspace, filters = '') => get(`${ws(workspace)}/tasks${query(filters)}`),
    createTask: (workspace, body) => post(`${ws(workspace)}/tasks`, body),
    task: taskId => get(`/api/tasks/${enc(taskId)}`),
    updateTask: (taskId, body) => patch(`/api/tasks/${enc(taskId)}`, body),
    changeTaskState: (taskId, state) => post(`/api/tasks/${enc(taskId)}/state`, { state }),
    devices: workspace => get(`${ws(workspace)}/devices`),
    conversations: (workspace, employeeId) => get(`${ws(workspace)}/conversations${query({ employeeId })}`),
    createConversation: (workspace, body) => post(`${ws(workspace)}/conversations`, body),
    conversation: async id => {
      const conversation = await get(`/api/conversations/${enc(id)}`);
      if (conversation?.id !== id || !Array.isArray(conversation.messages)) throw new Error('聊天记录返回异常，请刷新重试');
      return conversation;
    },
    sendMessage: (id, body) => post(`/api/conversations/${enc(id)}/messages`, {
      content: body.content || '', attachments: body.attachments || [], clientMessageId: body.clientMessageId,
    }),
    botRoutines: (workspace, id) => get(`${botPath(workspace, id)}/routines`),
    createRoutine: (workspace, id, body) => post(`${botPath(workspace, id)}/routines`, body),
    updateRoutine: (workspace, id, routineId, body) => patch(`${botPath(workspace, id)}/routines/${enc(routineId)}`, body),
    runRoutine: (workspace, id, routineId, body) => post(`${botPath(workspace, id)}/routines/${enc(routineId)}/run`, body),
    phones: workspace => get(`${phonePath(workspace)}?summary=1`),
    phone: (workspace, id, commandId = '') => get(`${phonePath(workspace, id)}/status${query({ commandId })}`),
    phoneSnapshot: (workspace, id) => get(`${phonePath(workspace, id)}/snapshot`),
    phoneCommand: (workspace, id, action, args = {}) => post(`${phonePath(workspace, id)}/commands`, { action, args }),
  };
  const openingConversations = new Map();
  /** Resolves the existing identity; this never initializes a Bot or provisions a Profile/HOME. */
  async function resolveEmployeeConversation(workspace, employee) {
    if (!employee?.id) throw new Error('请先选择数字员工');
    let bot = employee.bot || (Object.hasOwn(employee, 'configuration_state') ? employee : null);
    if (!bot && !employee.main_conversation_id && employee.runtime === 'Hermes') bot = await api.bot(workspace, employee.id);
    const mainId = employee.main_conversation_id || bot?.main_conversation_id;
    if (mainId) return api.conversation(mainId);
    if (bot?.configuration_state === 'initialized') throw new Error('这位员工的主聊天尚未就绪，请在电脑版核对');
    const result = await api.conversations(workspace, employee.id);
    const existing = (result.conversations || []).find(row => row.employee_id === employee.id && row.status === 'active');
    if (existing) return api.conversation(existing.id);
    return api.createConversation(workspace, { employeeId: employee.id, title: `${employee.name || employee.employee?.name || '数字员工'} · 长期聊天` });
  }
  api.getEmployeeConversation = (workspace, employee) => {
    const key = `${typeof workspace === 'object' ? workspace?.slug : workspace}:${employee?.id}`;
    if (!openingConversations.has(key)) {
      const opening = resolveEmployeeConversation(workspace, employee).finally(() => { if (openingConversations.get(key) === opening) openingConversations.delete(key); });
      openingConversations.set(key, opening);
    }
    return openingConversations.get(key);
  };
  return api;
}
