/** Native owns all credentials. This adapter exposes only JSON API responses. */
export function createNativeIdentity({ bridge = globalThis.ZiweiIdentity, events = globalThis, readTimeoutMs = 60000, mutationTimeoutMs = 120000, maxPending = 32 } = {}) {
  if (bridge === undefined || bridge === null) return null;
  const pending = new Map(), listeners = new Set();
  let generation = 0, serial = 0, status = null, disposed = false;
  const prefix = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const error = (message, code, extra = {}) => Object.assign(new Error(message), { code, ...extra });
  const isRead = method => method === 'GET' || method === 'HEAD';
  function cancelRead(entry) {
    if (!isRead(entry.method) || typeof bridge.cancel !== 'function') return;
    try { Promise.resolve(bridge.cancel(entry.id)).catch(() => {}); } catch {}
  }
  const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
  function publicStatus(value) {
    const source = parse(value);
    return { available: true, mode: 'oidc', configured: source?.available === true && source?.mode === 'oidc' && source?.configured === true,
      authenticated: source?.available === true && source?.mode === 'oidc' && source?.configured === true && source?.authenticated === true,
      ...(typeof source?.message === 'string' ? { message: source.message.slice(0, 1000) } : {}) };
  }
  const unavailable = () => ({ available: true, mode: 'oidc', configured: false, authenticated: false, message: '统一登录暂不可用，请更新应用或联系管理员完成 Android 客户端注册。' });
  function invalidate() {
    generation++;
    for (const entry of [...pending.values()]) { cancelRead(entry); entry.reject(error('登录状态已变化，请重新打开聊天', 'AUTH_CHANGED', { uncertain: !isRead(entry.method) })); }
  }
  function notify(value) {
    status = value;
    for (const listener of listeners) listener({ ...value });
  }
  function identityEvent(event) {
    if (disposed) return;
    invalidate();
    try { notify(publicStatus(event.detail)); } catch { notify(unavailable()); }
  }
  function responseEvent(event) {
    let detail;
    try { detail = parse(event.detail); } catch { return; }
    const entry = pending.get(detail?.id);
    if (!entry) return;
    if (entry.generation !== generation) return entry.reject(error('登录状态已变化，请重新打开聊天', 'AUTH_CHANGED'));
    if (detail.error) return entry.reject(error('原生请求未完成，请刷新核对', 'NATIVE_REQUEST_FAILED', { uncertain: entry.method !== 'GET' }));
    const code = Number(detail.status);
    if (!Number.isInteger(code) || code < 200 || code > 599 || typeof detail.body !== 'string') return entry.reject(error('原生请求回执无效', 'NATIVE_RESPONSE_INVALID'));
    try {
      const headers = new Headers(detail.headers || {}), body = detail.body;
      const ensureLive = () => {
        if (entry.generation !== generation || disposed) throw error('登录状态已变化，请重新打开聊天', 'AUTH_CHANGED');
        if (entry.signal?.aborted) throw error('读取已取消', 'READ_CANCELLED', { name: 'AbortError' });
      };
      // Body parsing is deferred, as with fetch, and fenced against logout too.
      entry.resolve({ status: code, ok: code >= 200 && code < 300, headers,
        json: async () => { ensureLive(); return JSON.parse(body); },
        text: async () => { ensureLive(); return body; } });
    } catch { entry.reject(error('原生请求回执无效', 'NATIVE_RESPONSE_INVALID')); }
  }
  events.addEventListener?.('ziwei:identity', identityEvent);
  events.addEventListener?.('ziwei:identity-response', responseEvent);
  async function getStatus() {
    const expected = generation;
    try {
      if (disposed || typeof bridge.getStatus !== 'function' || typeof bridge.request !== 'function' || typeof bridge.login !== 'function' || typeof bridge.logout !== 'function') return status = unavailable();
      const next = publicStatus(await bridge.getStatus());
      if (expected === generation) status = next;
      return { ...(status || next) };
    } catch { if (expected === generation) status = unavailable(); return { ...(status || unavailable()) }; }
  }
  function requireConfigured(value) {
    if (!value.configured) throw error(value.message || '统一登录尚未配置，请联系管理员完成 Android 客户端注册。', 'NATIVE_IDENTITY_UNCONFIGURED', { status: 503 });
  }
  async function fetch(url, options = {}) {
    const method = String(options.method || 'GET').toUpperCase(), expected = generation;
    const value = status || await getStatus();
    if (expected !== generation || disposed) throw error('登录状态已变化，请重新打开聊天', 'AUTH_CHANGED');
    requireConfigured(value);
    if (!value.authenticated) throw error('请使用统一登录后继续', 'NATIVE_AUTH_REQUIRED', { status: 401 });
    const path = String(url);
    if (!path.startsWith('/api/') || path.includes('\\') || path.includes('#') || /(?:^|\/)\.{1,2}(?:\/|\?|$)/.test(decodeURIComponent(path))) throw error('仅允许第一方 API 请求', 'NATIVE_PATH_INVALID');
    const headers = new Headers(options.headers || {});
    for (const name of headers.keys()) if (!['accept', 'content-type', 'if-none-match'].includes(name.toLowerCase())) throw error('原生请求包含不支持的请求头', 'NATIVE_HEADERS_INVALID');
    if (options.body !== undefined && typeof options.body !== 'string') throw error('原生请求仅支持 JSON 文本', 'NATIVE_BODY_INVALID');
    if (options.body !== undefined) JSON.parse(options.body);
    if (options.signal?.aborted) throw error('读取已取消', 'READ_CANCELLED', { name: 'AbortError' });
    if (pending.size >= maxPending) throw error('当前请求较多，请稍后再试', 'NATIVE_PENDING_LIMIT', { uncertain: false });
    return new Promise((resolve, reject) => {
      const id = `${prefix}_${++serial}`;
      let timer;
      const abort = () => { cancelRead(entry); finish(reject, error('读取已取消', 'READ_CANCELLED', { name: 'AbortError', uncertain: !isRead(method) })); };
      function finish(done, result) { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); pending.delete(id); done(result); }
      const entry = { id, method, generation: expected, signal: options.signal, resolve: result => finish(resolve, result), reject: cause => finish(reject, cause) };
      pending.set(id, entry);
      const duration = isRead(method) ? readTimeoutMs : mutationTimeoutMs;
      timer = setTimeout(() => { cancelRead(entry); entry.reject(error(isRead(method) ? '读取超时，请刷新重试' : '尚未收到操作回执，请先刷新核对', isRead(method) ? 'READ_TIMEOUT' : 'NATIVE_REQUEST_TIMEOUT', { uncertain: !isRead(method) })); }, Math.max(1, duration));
      options.signal?.addEventListener('abort', abort, { once: true });
      try { Promise.resolve(bridge.request(id, path, method, JSON.stringify(Object.fromEntries(headers)), options.body || '')).catch(() => entry.reject(error('原生请求未完成，请刷新核对', 'NATIVE_REQUEST_FAILED', { uncertain: method !== 'GET' }))); }
      catch { entry.reject(error('原生请求未完成，请刷新核对', 'NATIVE_REQUEST_FAILED', { uncertain: method !== 'GET' })); }
    });
  }
  return {
    fetch, getStatus, invalidate,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async login() {
      const value = await getStatus(); requireConfigured(value);
      const result = publicStatus(await bridge.login());
      if (!result.configured) throw error(result.message || '统一登录尚未配置', 'NATIVE_IDENTITY_UNCONFIGURED');
      return result;
    },
    async logout() { invalidate(); status = { available: true, mode: 'oidc', configured: status?.configured === true, authenticated: false }; return publicStatus(await bridge.logout()); },
    dispose() { disposed = true; invalidate(); listeners.clear(); events.removeEventListener?.('ziwei:identity', identityEvent); events.removeEventListener?.('ziwei:identity-response', responseEvent); },
  };
}
