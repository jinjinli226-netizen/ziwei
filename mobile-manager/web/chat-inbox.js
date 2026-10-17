import { workspaceId } from './model.js';

const RETRY_AFTER_MS = 8000;
const identity = value => typeof value === 'string' && value.trim() === value && value.length > 0;
const count = value => Number.isSafeInteger(value) && value >= 0;
const initialResource = () => ({ phase: 'idle', error: '', lastUpdated: null });

function threadView(row) {
  if (!row || !identity(row.conversationId) || !identity(row.employeeId) ||
      !row.employee || row.employee.id !== row.employeeId ||
      typeof row.employee.name !== 'string' || !row.employee.name.trim() ||
      !count(row.unreadCount) || !count(row.messageCount) ||
      typeof row.title !== 'string' || typeof row.preview !== 'string' ||
      typeof row.updatedAt !== 'string' || !Number.isFinite(Date.parse(row.updatedAt)) ||
      !(row.latestMessageId === null || identity(row.latestMessageId))) return null;
  return {
    conversationId: row.conversationId, employeeId: row.employeeId,
    employee: { ...row.employee }, title: row.title, preview: row.preview.slice(0, 180),
    updatedAt: row.updatedAt, unreadCount: row.unreadCount,
    latestMessageId: row.latestMessageId, messageCount: row.messageCount,
  };
}

/** The inbox is independent of employee loading and never writes conversation content. */
export function createChatInbox({ state, api, current, valid, draw = () => {}, fail = () => {}, now = Date.now, canMarkVisible = () => true }) {
  let disposed = false, generation = 0, scopeGeneration = 0, indexRead = null;
  const cursors = new Map();
  state.chatThreads ||= [];
  state.chatThreadsResource ||= initialResource();
  if (!count(state.unreadCount)) state.unreadCount = 0;
  state.chatReadError ||= '';

  const inScope = (token, scope) => !disposed && scope === scopeGeneration && valid(token);
  const timestamp = () => new Date(now()).toISOString();
  const visible = ({ conversationId, messageId }) => canMarkVisible() && state.page === 'chat' &&
    state.conversation?.id === conversationId &&
    Array.isArray(state.messages) && state.messages.some(message => message?.id === messageId);
  const messageIds = () => state.messages.map(message => message?.id).filter(identity);
  function compare(a, b, ids = messageIds()) {
    if (a === b) return 0;
    const first = ids.indexOf(a), second = ids.indexOf(b);
    return first < 0 || second < 0 ? null : Math.sign(first - second);
  }
  function rememberPrefix(record, ids, messageId) {
    const end = ids.indexOf(messageId);
    if (end >= 0) for (const id of ids.slice(0, end + 1)) record.covered.add(id);
    record.covered.add(messageId);
  }
  function covered(record, messageId) {
    if (record.covered.has(messageId)) return true;
    const order = record.ackId ? compare(messageId, record.ackId) : null;
    if (order !== null && order <= 0) {
      rememberPrefix(record, messageIds(), record.ackId);
      return true;
    }
    return false;
  }
  function invalidate() {
    generation++;
    indexRead = null;
    const resource = state.chatThreadsResource;
    if (resource.phase === 'loading') resource.phase = resource.lastUpdated ? 'ready' : 'idle';
  }
  function reset() {
    scopeGeneration++;
    invalidate(); cursors.clear();
    state.chatThreads = []; state.unreadCount = 0; state.chatReadError = '';
    state.chatThreadsResource = initialResource();
  }
  function load(token = current()) {
    if (disposed || !valid(token)) return Promise.resolve(false);
    if (indexRead && indexRead.generation === generation && valid(indexRead.token)) return indexRead.promise;
    const entry = { token, generation, scope: scopeGeneration };
    indexRead = entry;
    const live = () => inScope(token, entry.scope) && entry.generation === generation && indexRead === entry;
    state.chatThreadsResource.phase = 'loading'; state.chatThreadsResource.error = ''; draw();
    entry.promise = Promise.resolve().then(async () => {
      if (!live()) return false;
      try {
        const result = await api.chats(workspaceId(state));
        if (!live()) return false;
        if (!Array.isArray(result?.chats) || !count(result.unreadCount)) throw new Error('聊天列表数据无效，请刷新重试');
        const ids = new Set(), rows = [];
        for (const row of result.chats) {
          const thread = threadView(row);
          if (!thread || ids.has(thread.conversationId)) continue;
          ids.add(thread.conversationId); rows.push(thread);
        }
        state.chatThreads = rows; state.unreadCount = result.unreadCount;
        Object.assign(state.chatThreadsResource, { phase: 'ready', error: '', lastUpdated: timestamp() });
        draw(); return true;
      } catch (error) {
        if (error?.status === 401) {
          if (inScope(token, entry.scope)) fail(error, token);
        } else if (live()) {
          Object.assign(state.chatThreadsResource, { phase: 'error', error: error?.message || '聊天列表读取失败，请刷新重试' });
          draw();
        }
        return false;
      } finally { if (indexRead === entry) indexRead = null; }
    });
    return entry.promise;
  }
  function applyRead(result) {
    const row = state.chatThreads.find(thread => thread.conversationId === result.conversationId);
    if (row) {
      const previous = row.unreadCount;
      state.chatThreads = state.chatThreads.map(thread => thread === row ? { ...thread, unreadCount: result.unreadCount } : thread);
      state.unreadCount = Math.max(0, state.unreadCount - previous + result.unreadCount);
    }
    // An index request may have captured its unread snapshot before this receipt.
    invalidate();
    return Boolean(row);
  }
  function sendRead(record, target, token) {
    const entry = { target, token, scope: scopeGeneration, ids: messageIds() };
    record.pending = entry;
    if (visible(target)) state.chatReadError = '';
    entry.promise = Promise.resolve().then(async () => {
      if (!inScope(token, entry.scope) || !visible(target)) return false;
      try {
        const result = await api.markConversationRead(target.conversationId, { messageId: target.messageId });
        if (!inScope(token, entry.scope)) return false;
        if (result?.conversationId !== target.conversationId || !identity(result.lastReadMessageId) || !count(result.unreadCount)) throw new Error('已读状态返回无效，请稍后重试');
        rememberPrefix(record, entry.ids, target.messageId);
        rememberPrefix(record, entry.ids, result.lastReadMessageId);
        if (!record.ackId || compare(result.lastReadMessageId, record.ackId, entry.ids) !== -1) record.ackId = result.lastReadMessageId;
        record.failures.delete(target.messageId);
        const hasRow = applyRead(result);
        if (visible(target)) state.chatReadError = '';
        draw();
        if (!hasRow) void load(token);
        return true;
      } catch (error) {
        if (error?.status === 401) {
          // A session expiry still matters after switching the open employee.
          if (inScope(token, entry.scope)) fail(error, token);
        } else if (inScope(token, entry.scope)) {
          record.failures.set(target.messageId, now());
          if (visible(target)) { state.chatReadError = error?.message || '已读状态暂未同步'; draw(); }
        }
        return false;
      }
    }).then(async result => {
      if (record.pending !== entry) return result;
      record.pending = null;
      const queued = record.queued; record.queued = null;
      if (queued && inScope(queued.token, entry.scope) && visible(queued.target) && !covered(record, queued.target.messageId)) {
        const next = await sendRead(record, queued.target, queued.token);
        return result && next;
      }
      return result;
    });
    return entry.promise;
  }
  function markVisible(target = {}, token = current()) {
    if (disposed || !valid(token) || !identity(target.conversationId) || !identity(target.messageId) || !visible(target)) return Promise.resolve(false);
    let record = cursors.get(target.conversationId);
    if (record && !inScope(record.token, record.scope)) { cursors.delete(target.conversationId); record = null; }
    if (!record) {
      record = { token, scope: scopeGeneration, ackId: null, covered: new Set(), failures: new Map(), pending: null, queued: null };
      cursors.set(target.conversationId, record);
    }
    if (covered(record, target.messageId)) return Promise.resolve(false);
    const failedAt = record.failures.get(target.messageId);
    if (failedAt !== undefined && now() - failedAt < RETRY_AFTER_MS) return Promise.resolve(false);
    if (record.pending) {
      if (target.messageId === record.pending.target.messageId) return record.pending.promise;
      const afterPending = compare(target.messageId, record.pending.target.messageId);
      const afterQueued = record.queued ? compare(target.messageId, record.queued.target.messageId) : 1;
      if (afterPending === 1 && afterQueued === 1) record.queued = { target: { ...target }, token };
      return record.pending.promise;
    }
    return sendRead(record, { ...target }, token);
  }
  function dispose() {
    disposed = true; generation++; scopeGeneration++; indexRead = null; cursors.clear();
  }
  return { load, markVisible, invalidate, reset, dispose };
}
