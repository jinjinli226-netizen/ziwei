/**
 * Local chat preferences, isolated by account and workspace. Only unsent text
 * and canonical conversation IDs belong here; never attachments or history.
 *
 * Limits apply to the entire account record: 2 MiB of serialized UTF-8,
 * 100 nonempty drafts, 100 pins and 32 workspaces. A draft may contain at most
 * 50,000 UTF-16 code units, matching the composer. Nothing is silently evicted.
 * Valid edits remain in memory when storage is unavailable or full. Edits
 * exceeding these limits are rejected without replacing the previous value.
 * Corrupt/unreadable records are never overwritten by an ordinary edit.
 */
export const CHAT_PREFERENCE_LIMITS = Object.freeze({
  draftLength: 50000, bytes: 2 * 1024 * 1024, drafts: 100, pins: 100, workspaces: 32,
});

const PREFIX = 'ziwei.manager.chat-preferences.v1:';
const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && value.trim() === value;
const recordKey = accountId => `${PREFIX}${JSON.stringify([accountId])}`;
const unavailable = '无法保存到本机，新修改仅在本次使用中保留';
const corrupt = '本机聊天偏好数据损坏，新修改仅在本次使用中保留；退出账号可清理';
const unreadable = '无法读取本机聊天偏好，新修改仅在本次使用中保留';
const limitError = '本机聊天偏好已达容量上限，请清理草稿或取消置顶后重试';
const emptyRecord = accountId => ({ accountId, workspaces: new Map(), persisted: true, error: '', blocked: false });
const result = (record, extra = {}) => ({ ok: !record.error, persisted: record.persisted, error: record.error, ...extra });

function scopeIds(scope) {
  try {
    return identity(scope?.accountId) && identity(scope?.workspaceId)
      ? { accountId: scope.accountId, workspaceId: scope.workspaceId } : null;
  } catch { return null; }
}

function utf8Bytes(text) {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) { bytes += 4; index++; }
    else bytes += 3;
  }
  return bytes;
}

function serialized(record) {
  return JSON.stringify({ version: 1, accountId: record.accountId, workspaces: [...record.workspaces].map(([workspaceId, value]) => [workspaceId, { drafts: [...value.drafts], pinnedIds: [...value.pins] }]) });
}

function bounded(record, text = serialized(record)) {
  let drafts = 0, pins = 0;
  for (const value of record.workspaces.values()) { drafts += value.drafts.size; pins += value.pins.size; }
  return record.workspaces.size <= CHAT_PREFERENCE_LIMITS.workspaces && drafts <= CHAT_PREFERENCE_LIMITS.drafts && pins <= CHAT_PREFERENCE_LIMITS.pins && utf8Bytes(text) <= CHAT_PREFERENCE_LIMITS.bytes;
}

function parseRecord(raw, accountId) {
  if (typeof raw !== 'string' || utf8Bytes(raw) > CHAT_PREFERENCE_LIMITS.bytes) return null;
  const value = JSON.parse(raw);
  if (!value || Array.isArray(value) || value.version !== 1 || value.accountId !== accountId || !Array.isArray(value.workspaces) ||
      Object.keys(value).some(key => !['version', 'accountId', 'workspaces'].includes(key))) return null;
  const record = emptyRecord(accountId);
  for (const row of value.workspaces) {
    if (!Array.isArray(row) || row.length !== 2 || !identity(row[0]) || record.workspaces.has(row[0])) return null;
    const workspace = row[1];
    if (!workspace || Array.isArray(workspace) || !Array.isArray(workspace.drafts) || !Array.isArray(workspace.pinnedIds) ||
        Object.keys(workspace).some(key => !['drafts', 'pinnedIds'].includes(key))) return null;
    const drafts = new Map(), pins = new Set();
    for (const draft of workspace.drafts) {
      if (!Array.isArray(draft) || draft.length !== 2 || !identity(draft[0]) || drafts.has(draft[0]) ||
          typeof draft[1] !== 'string' || !draft[1].length || draft[1].length > CHAT_PREFERENCE_LIMITS.draftLength) return null;
      drafts.set(draft[0], draft[1]);
    }
    for (const id of workspace.pinnedIds) { if (!identity(id) || pins.has(id)) return null; pins.add(id); }
    record.workspaces.set(row[0], { drafts, pins });
  }
  return bounded(record, raw) ? record : null;
}

function copyRecord(record) {
  return { ...record, workspaces: new Map([...record.workspaces].map(([id, value]) => [id, { drafts: new Map(value.drafts), pins: new Set(value.pins) }])) };
}

export function createChatPreferences({ storage } = {}) {
  if (storage === undefined) { try { storage = globalThis.localStorage; } catch {} }
  const accounts = new Map();
  const invalid = () => ({ ok: false, persisted: false, error: '账号、工作区或聊天标识无效', accepted: false });

  function account(accountId) {
    if (accounts.has(accountId)) return accounts.get(accountId);
    let record = emptyRecord(accountId);
    try {
      if (typeof storage?.getItem !== 'function') Object.assign(record, { persisted: false, error: unavailable, blocked: true });
      else {
        const raw = storage.getItem(recordKey(accountId));
        if (raw !== null) {
          let parsed = null;
          try { parsed = parseRecord(raw, accountId); } catch {}
          if (parsed) record = parsed;
          else Object.assign(record, { persisted: false, error: corrupt, blocked: true });
        }
      }
    } catch { Object.assign(record, { persisted: false, error: unreadable, blocked: true }); }
    accounts.set(accountId, record);
    return record;
  }

  function write(record) {
    record.persisted = false;
    if (record.blocked) return result(record, { accepted: true });
    try {
      if (typeof storage?.setItem !== 'function') throw new Error('unavailable');
      storage.setItem(recordKey(record.accountId), serialized(record));
      record.persisted = true; record.error = '';
    } catch { record.error = unavailable; }
    return result(record, { accepted: true });
  }

  function edit(scope, mutate) {
    const ids = scopeIds(scope);
    if (!ids) return invalid();
    const previous = account(ids.accountId), record = copyRecord(previous);
    let workspace = record.workspaces.get(ids.workspaceId);
    if (!workspace) { workspace = { drafts: new Map(), pins: new Set() }; record.workspaces.set(ids.workspaceId, workspace); }
    mutate(workspace);
    if (!workspace.drafts.size && !workspace.pins.size) record.workspaces.delete(ids.workspaceId);
    if (!bounded(record)) return { ok: false, persisted: false, error: limitError, accepted: false };
    accounts.set(ids.accountId, record);
    return write(record);
  }

  function getDraft(scope, employeeId) {
    const ids = scopeIds(scope);
    return ids && identity(employeeId) ? account(ids.accountId).workspaces.get(ids.workspaceId)?.drafts.get(employeeId) || '' : '';
  }

  function draftPreviews(scope) {
    const ids = scopeIds(scope);
    return ids ? Object.fromEntries(account(ids.accountId).workspaces.get(ids.workspaceId)?.drafts || []) : {};
  }

  function pinnedIds(scope) {
    const ids = scopeIds(scope);
    return ids ? [...(account(ids.accountId).workspaces.get(ids.workspaceId)?.pins || [])] : [];
  }

  function saveDraft(scope, employeeId, text) {
    if (!identity(employeeId) || typeof text !== 'string') return invalid();
    if (text.length > CHAT_PREFERENCE_LIMITS.draftLength) return { ok: false, persisted: false, error: '草稿最多保留 50000 个字符', accepted: false };
    return edit(scope, workspace => { if (text) workspace.drafts.set(employeeId, text); else workspace.drafts.delete(employeeId); });
  }

  function togglePin(scope, conversationId) {
    if (!identity(conversationId)) return { ...invalid(), pinned: false, pinnedIds: pinnedIds(scope) };
    const saved = edit(scope, workspace => { if (workspace.pins.has(conversationId)) workspace.pins.delete(conversationId); else workspace.pins.add(conversationId); });
    const ids = pinnedIds(scope);
    return { ...saved, pinned: ids.includes(conversationId), pinnedIds: ids };
  }

  function clearAccount(accountId) {
    if (!identity(accountId)) return invalid();
    // Keep an empty in-memory tombstone even if removal fails. An explicit logout
    // must never re-expose this instance's old account data on a subsequent read.
    const record = emptyRecord(accountId);
    accounts.set(accountId, record);
    try {
      if (typeof storage?.removeItem !== 'function') throw new Error('unavailable');
      storage.removeItem(recordKey(accountId));
    } catch { Object.assign(record, { persisted: false, error: '无法清理本机聊天偏好，本次使用中的数据已清除' }); }
    return result(record, { accepted: true });
  }

  function status(scope) {
    const ids = scopeIds(scope);
    return ids ? result(account(ids.accountId)) : invalid();
  }

  return { getDraft, saveDraft, draftPreviews, pinnedIds, togglePin, clearAccount, status };
}
