import { accountId, workspaceId } from './model.js';

export const MOBILE_NOTIFICATION_LIMITS = Object.freeze({ page: 20, items: 200, readIds: 200, workspaces: 16, storageBytes: 128 * 1024, responseBytes: 64 * 1024 });
const PREFIX = 'ziwei.manager.notification-read.v1:';
const ID = /^[A-Za-z0-9._:-]{1,160}$/;
const SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const identifier = value => typeof value === 'string' && ID.test(value);
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const bytes = value => new TextEncoder().encode(value).length;
const scopeOf = state => ({ account: accountId(state), workspace: workspaceId(state), workspaceDbId: workspaceRecord(state, workspaceId(state))?.id || '' });
const keyOf = scope => JSON.stringify([scope.account, scope.workspace]);
const storageKey = account => PREFIX + JSON.stringify(account);
const preferenceWorkspace = scope => JSON.stringify([scope.workspace, scope.workspaceDbId]);
const invalid = (message = '提醒返回内容无法核对，请重新读取') => Object.assign(new Error(message), { code: 'MOBILE_NOTIFICATION_RECEIPT_INVALID' });
const text = (value, max, multiline = false) => typeof value === 'string' && bytes(value) <= max && !(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ud800-\udfff]/u : /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ud800-\udfff]/u).test(value);
const workspaceRecord = (state, slug) => typeof state.workspace === 'object' && state.workspace?.slug === slug ? state.workspace : (state.workspaces || []).find(row => row?.slug === slug);

function checkedItem(value) {
  if (!plainObject(value) || !identifier(value.id) || !['execution.completed', 'execution.failed', 'attention.required', 'message.received'].includes(value.kind)
      || !text(value.title, 160) || !value.title || !text(value.summary, 1024, true)
      || typeof value.createdAt !== 'string' || value.createdAt.length > 40 || !Number.isFinite(Date.parse(value.createdAt))
      || !['confirmed', 'uncertain', 'not_applicable'].includes(value.executionState)
      || ['execution.completed', 'execution.failed'].includes(value.kind) && value.executionState !== 'confirmed'
      || value.kind === 'message.received' && value.executionState !== 'not_applicable') throw invalid();
  const target = value.target;
  if (!plainObject(target) || !['conversation', 'task'].includes(target.kind) || !identifier(target.id)
      || Object.keys(target).some(key => !['kind', 'id', 'employeeId', 'messageId', 'actionId'].includes(key))
      || ['employeeId', 'messageId', 'actionId'].some(key => target[key] !== undefined && !identifier(target[key]))
      || target.kind === 'conversation' && !identifier(target.employeeId)
      || value.kind === 'message.received' && (target.kind !== 'conversation' || !identifier(target.messageId))) throw invalid();
  return { id: value.id, kind: value.kind, title: value.title, summary: value.summary, createdAt: value.createdAt,
    executionState: value.executionState, target: { ...target } };
}

function checkedEnvelope(response, state, { eventId, incremental = false } = {}) {
  const scope = scopeOf(state), workspace = workspaceRecord(state, scope.workspace);
  let size; try { size = bytes(JSON.stringify(response)); } catch { throw invalid(); }
  if (!plainObject(response) || size > MOBILE_NOTIFICATION_LIMITS.responseBytes || response.schemaVersion !== 2
      || response.accountId !== scope.account || response.workspaceSlug !== scope.workspace || !identifier(response.workspaceId)
      || !identifier(workspace?.id) || response.workspaceId !== workspace.id) throw invalid('提醒账号或工作区归属无法核对，请重新读取');
  if (eventId) {
    const item = checkedItem(response.item);
    if (item.id !== eventId) throw invalid('提醒与原事件不一致，请重新读取');
    return { item };
  }
  if (!Array.isArray(response.items) || response.items.length > 50 || typeof response.hasMore !== 'boolean'
      || response.cursor !== undefined && response.cursor !== response.nextCursor
      || typeof response.nextCursor !== 'string' || response.nextCursor.length < 1 || response.nextCursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(response.nextCursor)
      || incremental && response.historyWindow !== undefined || !incremental && (response.historyWindow !== true || response.hasMore)) throw invalid();
  const items = response.items.map(value => checkedItem(value));
  if (new Set(items.map(item => item.id)).size !== items.length) throw invalid('提醒事件重复，请重新读取');
  return { items, cursor: response.nextCursor, hasMore: response.hasMore, historyWindow: response.historyWindow === true };
}

/** The read marker is a bounded, personal local preference, never the shared server read_at. */
export function createMobileNotifications({ state, api, current = () => ({}), valid = () => true, draw = () => {}, fail = () => {},
  storage = globalThis.localStorage, native = null, onTarget = () => false, onWorkspaceTarget = null, onPendingNotification = () => {} } = {}) {
  let generation = 0, disposed = false, pendingRead = null, pendingResolve = null, pendingEnable = null, handlingNative = false;
  let knownAccount = accountId(state), lastScope = null;
  const stores = new Map();
  const capture = () => ({ token: current(), scope: scopeOf(state), generation });
  const live = visit => !disposed && generation === visit.generation && valid(visit.token) && keyOf(scopeOf(state)) === keyOf(visit.scope) && scopeOf(state).workspaceDbId === visit.scope.workspaceDbId && state.phase === 'ready';
  const fresh = () => ({ scope: keyOf(scopeOf(state)), workspaceId: scopeOf(state).workspaceDbId, items: [], cursor: '', hasMore: false, historyWindow: false,
    phase: 'idle', error: '', targetError: '', storageError: '', nativeError: '', native: { available: false, enabled: false }, readIds: [], unreadCount: 0,
    resolvingId: '', lastUpdated: null, blocked: false, pendingTarget: null });
  function readStore(account) {
    if (stores.has(account)) return stores.get(account);
    const store = { workspaces: Object.create(null), blocked: false, error: '' }; stores.set(account, store);
    try {
      if (!storage?.getItem) throw new Error();
      const raw = storage.getItem(storageKey(account)); if (raw === null || raw === undefined) return store;
      if (typeof raw !== 'string' || bytes(raw) > MOBILE_NOTIFICATION_LIMITS.storageBytes) throw invalid();
      const parsed = JSON.parse(raw);
      if (!plainObject(parsed) || Object.keys(parsed).sort().join(',') !== 'accountId,schemaVersion,workspaces' || parsed.schemaVersion !== 1
          || parsed.accountId !== account || !plainObject(parsed.workspaces) || Object.keys(parsed.workspaces).length > MOBILE_NOTIFICATION_LIMITS.workspaces) throw invalid();
      for (const [workspaceKey, ids] of Object.entries(parsed.workspaces)) {
        let binding; try { binding = JSON.parse(workspaceKey); } catch { throw invalid(); }
        if (!Array.isArray(binding) || binding.length !== 2 || JSON.stringify(binding) !== workspaceKey || !SLUG.test(binding[0]) || !identifier(binding[1]) || !Array.isArray(ids) || ids.length > MOBILE_NOTIFICATION_LIMITS.readIds || ids.some(id => !identifier(id)) || new Set(ids).size !== ids.length) throw invalid();
        store.workspaces[workspaceKey] = ids.slice();
      }
    } catch { store.workspaces = Object.create(null); store.blocked = true; store.error = '本机提醒已读记录无法读取，已保留原记录；本次已读仅在当前会话生效'; }
    return store;
  }
  function ensure() {
    if (disposed || state.phase !== 'ready' || !identifier(accountId(state)) || !SLUG.test(workspaceId(state)) || !identifier(scopeOf(state).workspaceDbId)) return null;
    const scope = scopeOf(state), nextScope = keyOf(scope);
    if (knownAccount && knownAccount !== scope.account) clearNative();
    knownAccount = scope.account;
    if (!state.notifications || state.notifications.scope !== nextScope || state.notifications.workspaceId !== scope.workspaceDbId) {
      if (lastScope && (lastScope !== nextScope || state.notifications?.workspaceId !== scope.workspaceDbId)) { generation++; abortReads(); pendingEnable = null; }
      state.notifications = fresh();
      const store = readStore(scope.account); state.notifications.readIds = (store.workspaces[preferenceWorkspace(scope)] || []).slice(); state.notifications.storageError = store.error;
    }
    lastScope = nextScope; return state.notifications;
  }
  function updateUnread(data) { const read = new Set(data.readIds); data.unreadCount = data.items.filter(item => !read.has(item.id)).length; }
  function remember(ids) {
    const data = ensure(); if (!data) return false;
    const scope = scopeOf(state), store = readStore(scope.account), workspaceKey = preferenceWorkspace(scope);
    data.readIds = [...new Set([...data.readIds, ...ids.filter(identifier)])].slice(-MOBILE_NOTIFICATION_LIMITS.readIds); updateUnread(data);
    if (store.blocked) { data.storageError = store.error; draw(); return false; }
    if (!Object.hasOwn(store.workspaces, workspaceKey) && Object.keys(store.workspaces).length >= MOBILE_NOTIFICATION_LIMITS.workspaces) {
      data.storageError = '本机已读记录已达 16 个工作区上限；本次已读仅在当前会话生效'; draw(); return false;
    }
    const next = { schemaVersion: 1, accountId: scope.account, workspaces: { ...store.workspaces, [workspaceKey]: data.readIds.slice() } };
    const encoded = JSON.stringify(next);
    if (bytes(encoded) > MOBILE_NOTIFICATION_LIMITS.storageBytes) { data.storageError = '本机提醒已读记录已满；本次已读仅在当前会话生效'; draw(); return false; }
    try { if (!storage?.setItem) throw new Error(); storage.setItem(storageKey(scope.account), encoded); store.workspaces = next.workspaces; store.error = ''; data.storageError = ''; }
    catch { data.storageError = '本机提醒已读记录保存失败；本次已读仅在当前会话生效'; }
    draw(); return !data.storageError;
  }
  function clearNative() { pendingEnable = null; try { native?.clear?.(); } catch {} }
  function abortReads() { pendingRead?.controller?.abort(); pendingResolve?.controller?.abort(); pendingRead = null; pendingResolve = null; }
  function readError(error, visit, data) {
    if (!live(visit) || state.notifications !== data || error?.name === 'AbortError') return;
    if (error?.status === 401) { clearNative(); data.phase = 'error'; data.error = '登录已过期，请重新登录'; fail(error, visit.token); return; }
    data.phase = 'error'; data.error = Number(error?.status) === 409 ? '提醒同步位置已失效，请点击重新读取' : [404, 501].includes(Number(error?.status)) ? '消息提醒服务尚未更新，请稍后重新读取' : error?.message || '提醒读取失败，请重试';
    if (error?.status === 409 || error?.status === 403 || [404, 501].includes(Number(error?.status)) || error?.code === 'MOBILE_NOTIFICATION_RECEIPT_INVALID') data.blocked = true;
    draw();
  }
  async function load({ recent = false, explicit = false } = {}) {
    const data = ensure(); if (!data || pendingRead || data.blocked && !explicit) return false;
    const visit = capture(), controller = typeof AbortController === 'function' ? new AbortController() : null;
    const incremental = !recent && Boolean(data.cursor), beforeCursor = incremental ? data.cursor : '';
    const request = { controller }; pendingRead = request;
    data.phase = 'loading'; if (explicit) data.error = ''; draw();
    try {
      const response = await api.mobileNotifications(visit.scope.workspace, { limit: MOBILE_NOTIFICATION_LIMITS.page, ...(incremental ? { cursor: beforeCursor } : {}) }, controller ? { signal: controller.signal } : {});
      if (!live(visit) || state.notifications !== data || pendingRead !== request) return false;
      const page = checkedEnvelope(response, state, { incremental });
      if (incremental && page.hasMore && page.cursor === beforeCursor) throw invalid('提醒同步位置没有前进，请重新读取');
      const merged = new Map((incremental ? data.items : []).map(item => [item.id, item]));
      for (const item of page.items) merged.set(item.id, item);
      data.items = [...merged.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id)).slice(0, MOBILE_NOTIFICATION_LIMITS.items);
      data.cursor = page.cursor; data.hasMore = page.hasMore; data.historyWindow = data.historyWindow || page.historyWindow;
      data.phase = 'ready'; data.error = ''; data.blocked = false; data.lastUpdated = new Date().toISOString(); updateUnread(data); draw(); return true;
    } catch (error) { readError(error, visit, data); return false; }
    finally { if (pendingRead === request) pendingRead = null; }
  }
  async function open() {
    const data = ensure(); if (!data) return false;
    state.page = 'notifications'; state.tab = 'me'; draw();
    await handleNative();
    if (!disposed && state.page === 'notifications' && !data.cursor) await load({ recent: true, explicit: true });
    return true;
  }
  async function resolveEvent(eventId, { systemTarget = false } = {}) {
    const data = ensure(); if (!data || !identifier(eventId) || pendingResolve) return false;
    const visit = capture(), controller = typeof AbortController === 'function' ? new AbortController() : null;
    const request = { controller }; pendingResolve = request; data.resolvingId = eventId; data.error = ''; data.targetError = ''; draw();
    try {
      const response = await api.mobileNotification(visit.scope.workspace, eventId, controller ? { signal: controller.signal } : {});
      if (!live(visit) || state.notifications !== data || pendingResolve !== request) return false;
      const { item } = checkedEnvelope(response, state, { eventId });
      // Navigation receives the freshly authorized target, never the cached row or native Intent target.
      const opened = await onTarget(item, visit.token);
      if (!live(visit) || state.notifications !== data || pendingResolve !== request) return false;
      if (opened === false) return false;
      remember([item.id]); data.pendingTarget = null; return true;
    } catch (error) {
      if (systemTarget && error?.status !== 401 && live(visit) && state.notifications === data && error?.name !== 'AbortError') {
        data.targetError = error?.message || '这条消息暂不可查看'; draw();
      } else readError(error, visit, data);
      return false;
    }
    finally { if (pendingResolve === request) { pendingResolve = null; data.resolvingId = ''; if (live(visit) && state.notifications === data) draw(); } }
  }
  function parseNative(value) {
    if (typeof value === 'string') { if (bytes(value) > 16 * 1024) throw invalid(); value = JSON.parse(value); }
    if (!plainObject(value) || typeof value.available !== 'boolean' || typeof value.enabled !== 'boolean') throw invalid('系统提醒状态无法读取，请重新打开应用');
    if (!value.available) return { available: false, enabled: false };
    if (!['disabled', 'enabling', 'enabled', 'unavailable', 'error'].includes(value.subscriptionState)
        || !['granted', 'denied', 'channel_disabled'].includes(value.permission) || !text(value.message || '', 1000)
        || value.workspaceSlug && !SLUG.test(value.workspaceSlug) || value.accountId && !identifier(value.accountId)) throw invalid('系统提醒状态无法读取，请重新打开应用');
    const deliveryMode = value.deliveryMode === undefined ? 'supplement' : value.deliveryMode;
    if (!['selfhost', 'supplement', 'unavailable'].includes(deliveryMode)
        || value.connectionState !== undefined && !['connecting', 'connected', 'backoff', 'stopped'].includes(value.connectionState)
        || ['foregroundServiceRunning', 'batteryOptimizationExempt', 'batterySettingsAvailable'].some(key => value[key] !== undefined && typeof value[key] !== 'boolean')) throw invalid('系统提醒状态无法核对');
    return { available: true, enabled: value.enabled, subscriptionState: value.subscriptionState, permission: value.permission,
      workspaceSlug: value.workspaceSlug || '', accountId: value.accountId || '', message: value.message || '', intervalMinutes: 15, pendingTarget: value.pendingTarget === true,
      deliveryMode, connectionState: value.connectionState || 'stopped', foregroundServiceRunning: value.foregroundServiceRunning === true,
      batteryOptimizationExempt: value.batteryOptimizationExempt === true, batterySettingsAvailable: value.batterySettingsAvailable === true };
  }
  async function callNative(method, ...args) {
    if (!native || typeof native[method] !== 'function') throw new Error('请在 Android App 中使用系统提醒');
    return native[method](...args);
  }
  function checkedPending(value) {
    if (typeof value === 'string') { if (bytes(value) > 4096) throw invalid(); value = JSON.parse(value); }
    if (value === null || value === undefined) return null;
    if (!plainObject(value)) throw invalid('这条系统提醒的账号或工作区已不可用');
    const workspace = workspaceRecord(state, value.workspaceSlug);
    if (value.accountId !== accountId(state) || Object.hasOwn(value, 'deliveryId') || !identifier(value.eventId) || !SLUG.test(value.workspaceSlug)
        || !identifier(value.workspaceId) || !workspace || workspace.id !== value.workspaceId) throw invalid('这条系统提醒的账号或工作区已不可用');
    return { accountId: value.accountId, workspaceId: value.workspaceId, workspaceSlug: value.workspaceSlug, eventId: value.eventId };
  }
  async function resolvePending(value) {
    const data = ensure(); if (!data) return false;
    try {
      const pending = checkedPending(value); if (!pending) return false;
      if (pending.workspaceSlug !== workspaceId(state)) { data.pendingTarget = pending; data.nativeError = '请先切换到这条提醒所属的工作区'; draw(); return false; }
      data.pendingTarget = pending;
      onPendingNotification(current());
      return resolveEvent(pending.eventId, { systemTarget: true });
    } catch (error) { data.nativeError = error.message || '系统提醒已无法核对'; draw(); return false; }
  }
  async function handleNative(detail) {
    const data = ensure(); if (!data || !native || handlingNative) return false;
    const visit = capture(); handlingNative = true;
    try {
      let status = parseNative(detail === undefined ? await callNative('getStatus') : detail);
      if (!live(visit) || state.notifications !== data) return false;
      if (status.available && status.accountId && status.accountId !== visit.scope.account) {
        clearNative(); status = parseNative(await callNative('getStatus'));
        if (!live(visit) || state.notifications !== data) return false;
      }
      data.native = status; data.nativeError = '';
      if (pendingEnable && pendingEnable.expiresAt < Date.now()) pendingEnable = null;
      if (pendingEnable && pendingEnable.generation === generation && keyOf(pendingEnable.scope) === keyOf(visit.scope) && status.available && status.permission === 'granted') {
        pendingEnable = null; status = parseNative(await callNative('configure', visit.scope.workspace, true));
        if (!live(visit) || state.notifications !== data) return false; data.native = status;
      }
      draw();
      // Consume only after an authenticated principal and authorized workspace list exist.
      if (status.pendingTarget && typeof native.consumePendingTarget === 'function') {
        const pending = checkedPending(await callNative('consumePendingTarget'));
        if (!live(visit) || state.notifications !== data || !pending) return false;
        data.pendingTarget = pending;
        if (pending.workspaceSlug === visit.scope.workspace) return await resolvePending(pending);
        if (typeof onWorkspaceTarget === 'function') return await onWorkspaceTarget(pending, visit.token);
        data.nativeError = '这条提醒属于其他工作区，请切换后查看'; draw();
      }
      return true;
    } catch (error) { if (live(visit) && state.notifications === data) { data.nativeError = error.message || '系统提醒暂不可用'; draw(); } return false; }
    finally { handlingNative = false; }
  }
  async function enable() {
    const data = ensure(); if (!data) return false;
    const visit = capture(); data.nativeError = ''; pendingEnable = { scope: visit.scope, generation, expiresAt:Date.now()+120000 };
    try {
      // The permission prompt is asynchronous; its later native event can finish this user's enable intent.
      const status = parseNative(await callNative('requestPermission'));
      if (!live(visit) || state.notifications !== data) return false;
      if (!status.available) { pendingEnable = null; data.nativeError = '当前环境不支持系统提醒，请使用 App 内最近提醒'; draw(); return false; }
      if (status.permission === 'channel_disabled') { pendingEnable = null; data.native = status; data.nativeError = '提醒频道已关闭，请在系统通知设置中开启后重试'; draw(); return false; }
      return await handleNative(status);
    } catch (error) { pendingEnable = null; if (live(visit) && state.notifications === data) { data.nativeError = error.message; draw(); } return false; }
  }
  async function disable() {
    const data = ensure(); if (!data) return false;
    const visit = capture(); pendingEnable = null;
    try { const status = parseNative(await callNative('configure', workspaceId(state), false)); if (!live(visit) || state.notifications !== data) return false; data.native = status; data.nativeError = ''; draw(); return true; }
    catch (error) { if (live(visit) && state.notifications === data) { data.nativeError = error.message; draw(); } return false; }
  }
  const actions = {
    'notifications-open': open,
    'notifications-refresh': () => load({ recent: true, explicit: true }),
    'notifications-more': () => { const data = ensure(); return data?.hasMore ? load({ explicit: true }) : false; },
    'notifications-read-all': () => { const data = ensure(); return data ? remember(data.items.map(item => item.id)) : false; },
    'notifications-target': ({ id } = {}) => { const data = ensure(); return data?.items.some(item => item.id === id) ? resolveEvent(id) : false; },
    'notifications-enable': enable,
    'notifications-disable': disable,
    'notifications-settings': async () => {
      const data = ensure(), visit = capture(); if (!data) return false;
      try { const status = await callNative('openSystemSettings'); if (!live(visit) || state.notifications !== data) return false; return handleNative(status); }
      catch (error) { if (live(visit)) { data.nativeError = error.message; draw(); } return false; }
    },
    'notifications-battery': async () => {
      const data = ensure(), visit = capture(); if (!data) return false;
      try { const status = await callNative('openBatterySettings'); if (!live(visit) || state.notifications !== data) return false; return handleNative(status); }
      catch (error) { if (live(visit)) { data.nativeError = error.message || '请在系统应用设置中查看后台和电池限制'; draw(); } return false; }
    },
    'notifications-pending': () => { const data = ensure(); return data?.pendingTarget ? resolvePending(data.pendingTarget) : false; },
  };
  function reset({ clearNative: clearSystem = false, clearAccount = false } = {}) {
    generation++; abortReads(); pendingEnable = null;
    const account = knownAccount || accountId(state);
    if (clearSystem) clearNative();
    if (clearAccount && account) { stores.delete(account); try { storage?.removeItem(storageKey(account)); } catch {} }
    knownAccount = accountId(state); lastScope = null; state.notifications = null;
  }
  function pause() {
    generation++; abortReads();
    // Android may pause this Activity while its permission dialog is visible.
    // Preserve only that short-lived user intent; workspace/account reset still revokes it.
    if(pendingEnable && pendingEnable.expiresAt>=Date.now() && keyOf(pendingEnable.scope)===keyOf(scopeOf(state)))pendingEnable.generation=generation;
    else pendingEnable=null;
    const data = state.notifications;
    if (data) { if (data.phase === 'loading') data.phase = data.cursor ? 'ready' : 'idle'; data.resolvingId = ''; }
  }
  function dispose() { disposed = true; generation++; abortReads(); pendingEnable = null; stores.clear(); }
  return { actions, poll: () => load(), open, reset, pause, dispose, handleNative, resolvePending };
}
