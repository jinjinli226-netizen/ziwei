/** First-party session API. All workspace identifiers are explicit to avoid stale-tab routing. */
export function createApi({ fetchImpl = globalThis.fetch?.bind(globalThis), origin = '', onUnauthorized, readTimeoutMs = 20000 } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('缺少网络请求支持');
  const base = String(origin || '').replace(/\/$/, '');
  // Keep only bounded, first-party response text. Revalidate every read against
  // the authenticated server; no cached response is accepted without its 304.
  const readCache = new Map(), openingConversations = new Map(), creatingConversations = new Map(), cacheLimit = 32 * 1024 * 1024;
  let cacheBytes = 0, cacheEpoch = 0, authEpoch = 0;
  function clearReads() { cacheEpoch++; readCache.clear(); cacheBytes = 0; }
  function clearAuthenticationReads() { authEpoch++; clearReads(); openingConversations.clear(); creatingConversations.clear(); }
  function requireSameAuthentication(epoch) { if (epoch !== authEpoch) throw new Error('登录状态已变化，请重新打开聊天'); }
  function forgetRead(key) { const previous = readCache.get(key); if (previous) cacheBytes -= previous.text.length * 2; readCache.delete(key); }
  function touchRead(key, entry, epoch) {
    // A concurrent read may already have replaced or evicted this snapshot.
    if (epoch !== cacheEpoch || readCache.get(key) !== entry) return;
    readCache.delete(key); readCache.set(key, entry);
  }
  function rememberRead(key, etag, data, epoch) {
    if (epoch !== cacheEpoch) return;
    forgetRead(key);
    if (!etag) return;
    const text = JSON.stringify(data), bytes = text.length * 2;
    if (bytes > cacheLimit) return;
    while (readCache.size >= 8 || cacheBytes + bytes > cacheLimit) forgetRead(readCache.keys().next().value);
    readCache.set(key, { etag, text }); cacheBytes += bytes;
  }
  const enc = value => encodeURIComponent(String(value ?? ''));
  const ws = workspace => `/api/workspaces/${enc(typeof workspace === 'object' ? workspace?.slug : workspace)}`;
  const botPath = (workspace, id) => `${ws(workspace)}/bots/${enc(id)}`;
  const phonePath = (workspace, id = '') => `${ws(workspace)}/ziwei-connect/terminal/android-devices${id ? `/${enc(id)}` : ''}`;
  const query = value => {
    const text = typeof value === 'string' ? value.replace(/^\?/, '') : new URLSearchParams(Object.entries(value || {}).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
    return text ? `?${text}` : '';
  };
  const readOptions = options => ({ signal: options?.signal });
  function requireActiveRead(signal, path, startedAt) {
    if (signal?.aborted) throw Object.assign(new Error('读取已取消'), {
      code: 'READ_CANCELLED', uncertain: false, requestPath: path, method: 'GET', elapsedMs: Math.max(0, Date.now() - startedAt),
    });
  }
  async function request(path, { method = 'GET', body, signal, invalidateReads = true } = {}) {
    const startedAt = Date.now();
    const epoch = cacheEpoch, cached = method === 'GET' ? readCache.get(path) : null;
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
        if (method === 'GET') requireActiveRead(signal, path, startedAt);
        response = await fetchImpl(`${base}${path}`, {
          method, credentials: 'include', cache: 'no-store',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(cached ? { 'If-None-Match': cached.etag } : {}) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          ...((readController?.signal || signal) ? { signal: readController?.signal || signal } : {}),
        });
        if (response.status === 304) {
          if (!cached || epoch !== cacheEpoch) throw new Error('No current authenticated snapshot for 304');
          // Parse fresh text so callers cannot mutate the retained snapshot.
          touchRead(path, cached, epoch);
          return JSON.parse(cached.text);
        }
        data = response.status === 204 ? {} : await response.json().catch(cause => {
          if (!response.ok && !readController?.signal.aborted) return {};
          throw cause;
        });
      } catch (cause) {
        const cancelled = method === 'GET' && signal?.aborted && !timedOut;
        const error = new Error(timedOut ? '读取超时，请刷新重试' : cancelled ? '读取已取消' : method === 'GET' ? '连接失败或返回内容无法读取，请刷新重试' : '尚未收到操作回执，请先刷新核对；重试消息会沿用原请求标识');
        error.cause = cause;
        error.uncertain = method !== 'GET';
        if (timedOut) error.code = 'READ_TIMEOUT';
        else if (cancelled) error.code = 'READ_CANCELLED';
        throw error;
      }
      if (!response.ok) {
        const error = new Error(data.error || data.message || (response.status === 413 ? '图片内容超过服务器限制，请选择更小的图片' : `请求失败（${response.status}）`));
        error.status = response.status;
        error.code = data.code;
        error.data = data;
        if (response.status === 401) { if (epoch === cacheEpoch) clearAuthenticationReads(); onUnauthorized?.(error); }
        throw error;
      }
      if (method === 'GET') rememberRead(path, response.headers?.get?.('etag'), data, epoch);
      else if (invalidateReads && epoch === cacheEpoch) clearReads();
      return data;
    } catch (error) {
      // Metadata only: never retain request bodies, credentials or response text
      // in the read diagnostics shown by individual resource states.
      error.requestPath = path; error.method = method;
      error.elapsedMs = Math.max(0, Date.now() - startedAt);
      throw error;
    } finally {
      if (timeout !== null) clearTimeout(timeout);
      if (readController && signal) signal.removeEventListener('abort', forwardAbort);
    }
  }
  const get = (path, options) => request(path, options);
  const mobile = path => `${path}${path.includes('?') ? '&' : '?'}view=mobile`;
  const post = (path, body = {}) => request(path, { method: 'POST', body });
  const patch = (path, body) => request(path, { method: 'PATCH', body });
  const api = {
    authMe: () => get('/api/auth/me'),
    authStatus: () => get('/api/auth/status'),
    login: body => { clearAuthenticationReads(); return post('/api/auth/login', { email: body.email || body.username, password: body.password }); },
    logout: () => { clearAuthenticationReads(); return post('/api/auth/logout'); },
    workspaces: () => get('/api/workspaces'),
    employees: workspace => get(mobile(`${ws(workspace)}/employees`)),
    runtimes: workspace => get(`${ws(workspace)}/runtimes`),
    models: (workspace, filters = {}) => get(`${ws(workspace)}/models${query(filters)}`),
    skills: (workspace, filters = {}) => get(`${ws(workspace)}/skills${query(filters)}`),
    hermesProfiles: (workspace, deviceId) => get(`${ws(workspace)}/hermes/profiles${query({ deviceId })}`),
    employeeMcpStatus: (workspace, id) => get(`${ws(workspace)}/employees/${enc(id)}/mcp/status`),
    bots: workspace => get(mobile(`${ws(workspace)}/bots`)),
    bot: (workspace, id, options) => get(mobile(botPath(workspace, id)), readOptions(options)),
    botRuns: (workspace, id, options) => get(mobile(`${botPath(workspace, id)}/runs`), readOptions(options)),
    botCapabilities: (workspace, deviceId) => get(`${ws(workspace)}/bots/capabilities${query({ deviceId })}`),
    validateBot: (workspace, id, body) => post(`${botPath(workspace, id)}/validate`, body),
    updateBot: (workspace, id, body) => patch(botPath(workspace, id), body),
    controlBot: (workspace, id, body) => post(`${botPath(workspace, id)}/control`, body),
    updateEmployee: (workspace, id, body) => patch(`${ws(workspace)}/employees/${enc(id)}`, body),
    phoneMcpSetup: workspace => get(mobile(`${ws(workspace)}/phone-mcp/setup`)),
    phoneMcpStatus: (workspace, id) => get(`${ws(workspace)}/employees/${enc(id)}/phone-mcp/status`),
    savePhoneMcp: (workspace, id, body) => request(`${ws(workspace)}/employees/${enc(id)}/phone-mcp`, { method: 'PUT', body }),
    checkPhoneMcp: (workspace, id) => post(`${ws(workspace)}/employees/${enc(id)}/phone-mcp/check`),
    tasks: (workspace, filters = '') => get(`${ws(workspace)}/tasks${query(filters)}`),
    createTask: (workspace, body) => post(`${ws(workspace)}/tasks`, body),
    task: taskId => get(`/api/tasks/${enc(taskId)}`),
    updateTask: (taskId, body) => patch(`/api/tasks/${enc(taskId)}`, body),
    changeTaskState: (taskId, state) => post(`/api/tasks/${enc(taskId)}/state`, { state }),
    devices: workspace => get(`${ws(workspace)}/devices`),
    createDevicePairing: (workspace, body) => post(`${ws(workspace)}/devices/pairing`, body),
    connectStatus: workspace => get(`${ws(workspace)}/ziwei-connect/status`),
    connectDevices: workspace => get(`${ws(workspace)}/ziwei-connect/devices`),
    phoneBindings: workspace => get(`${ws(workspace)}/ziwei-connect/bindings`),
    savePhoneBinding: (workspace, body) => post(`${ws(workspace)}/ziwei-connect/bindings`, body),
    deletePhoneBinding: (workspace, id) => request(`${ws(workspace)}/ziwei-connect/bindings/${enc(id)}`, { method: 'DELETE' }),
    phoneEnrollmentRequests: workspace => get(`${phonePath(workspace)}/enrollment-requests`),
    approvePhoneEnrollment: (workspace, id) => post(`${phonePath(workspace)}/enrollment-requests/${enc(id)}/approve`),
    rejectPhoneEnrollment: (workspace, id) => post(`${phonePath(workspace)}/enrollment-requests/${enc(id)}/reject`),
    phoneControl: (workspace, id, body) => post(`${phonePath(workspace, id)}/control`, body),
    conversations: (workspace, employeeId, options) => get(`${ws(workspace)}/conversations${query({ employeeId })}`, readOptions(options)),
    chats: workspace => get(`${ws(workspace)}/chats`),
    markConversationRead: (id, { messageId }) => request(`/api/conversations/${enc(id)}/read`, { method: 'POST', body: { messageId }, invalidateReads: false }),
    forwardMessages: async (id, body) => {
      const value = await post(`/api/conversations/${enc(id)}/forwards`, body);
      const forward = value?.forward, message = value?.message, snapshot = message?.forward;
      const stable = value => typeof value === 'string' && value.length > 0 && value.trim() === value;
      const expectedIds = body?.messageIds;
      const valid = stable(forward?.id) && forward.sourceConversationId === id && stable(forward.targetConversationId) &&
        forward.targetEmployeeId === body?.targetEmployeeId && forward.mode === body?.mode && stable(message?.id) &&
        snapshot?.schemaVersion === 1 && snapshot.id === forward.id && snapshot.source?.conversationId === id &&
        (snapshot.source?.employeeId === null || stable(snapshot.source?.employeeId)) && typeof snapshot.source?.employeeName === 'string' && snapshot.mode === body.mode &&
        (snapshot.note || '') === (body.note || '').trim() && Array.isArray(snapshot.messages) && Array.isArray(expectedIds) &&
        snapshot.messages.length === expectedIds.length && new Set(snapshot.messages.map(item => item?.sourceMessageId)).size === expectedIds.length &&
        snapshot.messages.every(item => expectedIds.includes(item?.sourceMessageId) &&
          ['user', 'assistant'].includes(item.role) && typeof item.senderName === 'string' && typeof item.createdAt === 'string' &&
          typeof item.content === 'string' && Array.isArray(item.attachments)) &&
        (body.mode !== 'execute' || stable(value.execution?.id) && typeof value.execution.type === 'string' && typeof value.execution.status === 'string');
      if (!valid) throw Object.assign(new Error('转发回执无法核对，请重试同一请求确认结果'), { code: 'FORWARD_RECEIPT_INVALID', uncertain: true });
      return value;
    },
    createConversation: (workspace, body) => post(`${ws(workspace)}/conversations`, body),
    conversation: async (id, options) => {
      const conversation = await get(mobile(`/api/conversations/${enc(id)}`), readOptions(options));
      if (conversation?.id !== id || !Array.isArray(conversation.messages)) throw new Error('聊天记录返回异常，请刷新重试');
      return conversation;
    },
    sendMessage: (id, body) => post(`/api/conversations/${enc(id)}/messages`, {
      content: body.content || '', attachments: body.attachments || [], clientMessageId: body.clientMessageId,
    }),
    botRoutines: (workspace, id, options) => get(`${botPath(workspace, id)}/routines`, readOptions(options)),
    createRoutine: (workspace, id, body) => post(`${botPath(workspace, id)}/routines`, body),
    updateRoutine: (workspace, id, routineId, body) => patch(`${botPath(workspace, id)}/routines/${enc(routineId)}`, body),
    runRoutine: (workspace, id, routineId, body) => post(`${botPath(workspace, id)}/routines/${enc(routineId)}/run`, body),
    phones: workspace => get(`${phonePath(workspace)}?summary=1`),
    phone: (workspace, id, commandId = '') => get(`${phonePath(workspace, id)}/status${query({ commandId })}`),
    phoneSnapshot: (workspace, id) => get(`${phonePath(workspace, id)}/snapshot`),
    phoneCommand: (workspace, id, action, args = {}) => post(`${phonePath(workspace, id)}/commands`, { action, args }),
  };
  /** Resolves the existing identity; this never initializes a Bot or provisions a Profile/HOME. */
  async function resolveEmployeeConversation(workspace, employee, expectedAuthentication, options, key) {
    if (!employee?.id) throw new Error('请先选择数字员工');
    const startedAt = Date.now(), lookupPath = `${ws(workspace)}/conversations${query({ employeeId: employee.id })}`;
    let bot = employee.bot || (Object.hasOwn(employee, 'configuration_state') ? employee : null);
    if (!bot && !employee.main_conversation_id && employee.runtime === 'Hermes') bot = await api.bot(workspace, employee.id, options);
    requireSameAuthentication(expectedAuthentication);
    const mainId = employee.main_conversation_id || bot?.main_conversation_id;
    if (mainId) return api.conversation(mainId, options);
    if (bot?.configuration_state === 'initialized') throw new Error('这位员工的主聊天尚未就绪，请在电脑版核对');
    const result = await api.conversations(workspace, employee.id, options);
    requireSameAuthentication(expectedAuthentication);
    requireActiveRead(options.signal, lookupPath, startedAt);
    const existing = (result.conversations || []).find(row => row.employee_id === employee.id && row.status === 'active');
    if (existing) return api.conversation(existing.id, options);
    // Share a submitted creation until all concurrent opening scopes finish.
    // A lookup may have captured an empty result before that creation committed.
    if (!creatingConversations.has(key)) {
      const creation = api.createConversation(workspace, { employeeId: employee.id, title: `${employee.name || employee.employee?.name || '数字员工'} · 长期聊天` });
      creatingConversations.set(key, creation);
    }
    return creatingConversations.get(key);
  }
  api.getEmployeeConversation = (workspace, employee, options = {}) => {
    const expectedAuthentication = authEpoch;
    const key = `${expectedAuthentication}:${typeof workspace === 'object' ? workspace?.slug : workspace}:${employee?.id}`;
    let scopes = openingConversations.get(key);
    if (!scopes) { scopes = new Map(); openingConversations.set(key, scopes); }
    const signal = options.signal || null;
    if (!scopes.has(signal)) {
      const opening = resolveEmployeeConversation(workspace, employee, expectedAuthentication, readOptions(options), key).then(value => { requireSameAuthentication(expectedAuthentication); return value; }).finally(() => {
        if (scopes.get(signal) === opening) scopes.delete(signal);
        if (!scopes.size && openingConversations.get(key) === scopes) { openingConversations.delete(key); creatingConversations.delete(key); }
      });
      scopes.set(signal, opening);
    }
    return scopes.get(signal);
  };
  return api;
}
