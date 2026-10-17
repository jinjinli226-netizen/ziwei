import { accountId, workspaceId, scopeKey, employeeName, id } from './model.js';

export const FORWARD_MESSAGE_LIMIT = 20;
export const FORWARD_NOTE_LIMIT = 4000;
const imageLimit = 20, imageByteLimit = 10 * 1024 * 1024, textLimit = 100000;
const modes = new Set(['reference', 'execute']);
const uncertainCodes = new Set(['FORWARD_REQUEST_CONFLICT', 'FORWARD_RECEIPT_INVALID']);
const rows = value => Array.isArray(value) ? value : [];
const messageId = message => typeof message?.id === 'string' && message.id === message.id.trim() ? message.id : '';
const storagePrefix = userId => `ziwei.manager.forward.v1:${encodeURIComponent(userId)}:`;

/** Only persisted ordinary messages can be selected. Never invent an ID from a row index. */
export function isForwardableMessage(message) {
  const stableId = messageId(message);
  const role = message?.role || message?.sender_role || message?.senderRole;
  return Boolean(stableId && stableId.length <= 200 && !/[\0\r\n]/.test(stableId)
    && ['user', 'assistant'].includes(role)
    && !['failed', 'sending', 'pending'].includes(message.status)
    && message.type !== 'forward' && !message.forward && !message.metadata?.forward);
}

/** A selection is always sent in source-history order, independent of tap order. */
export function orderedForwardMessages(messages, selectedIds) {
  const selected = new Set(rows(selectedIds)), seen = new Set();
  return rows(messages).filter(message => {
    const stableId = messageId(message);
    if (!selected.has(stableId) || seen.has(stableId) || !isForwardableMessage(message)) return false;
    seen.add(stableId); return true;
  });
}

const field = (values, name) => typeof values?.get === 'function' ? values.get(name) : values?.[name];
const hasField = (values, name) => typeof values?.has === 'function' ? values.has(name) : Boolean(values && Object.hasOwn(values, name));
async function fingerprint(body) {
  if (!globalThis.crypto?.subtle) throw new Error('当前环境无法安全保存转发标识，请重新打开应用');
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(body)));
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}
function imageBytes(attachment) {
  const item = typeof attachment === 'string' ? { url: attachment } : attachment || {};
  let encoded = item.contentEncoding === 'base64' ? item.content : item.data && item.mime ? item.data : '';
  for (const candidate of [item.url, item.dataUrl, item.data_url, item.src, item.preview, item.previewUrl, item.download_url, item.downloadUrl]) {
    if (typeof candidate === 'string' && /^data:image\/[^;,]+;base64,/i.test(candidate)) { encoded = candidate.slice(candidate.indexOf(',') + 1); break; }
  }
  if (typeof encoded === 'string' && encoded) {
    const text = encoded.replace(/\s/g, '');
    return Math.max(0, Math.floor(text.length * 3 / 4) - (text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0));
  }
  return Number.isFinite(item.size) && item.size > 0 ? item.size : 0;
}
function preflight(messages) {
  if (messages.reduce((sum, message) => sum + String(message.content ?? message.text ?? '').length, 0) > textLimit) throw new Error('所选聊天文本超过 100000 字，请减少选择');
  const images = messages.flatMap(message => rows(message.attachments || message.images || message.metadata?.attachments));
  if (images.length > imageLimit) throw new Error('所选聊天图片超过 20 张，请减少选择');
  if (images.reduce((sum, attachment) => sum + imageBytes(attachment), 0) > imageByteLimit) throw new Error('所选聊天图片合计超过 10 MiB，请减少选择');
}
function requireReceipt(result, body) {
  const receipt = result?.forward, execution = result?.execution;
  const nonempty = value => typeof value === 'string' && Boolean(value.trim());
  const invalid = !nonempty(receipt?.id) || receipt.sourceConversationId !== body.sourceConversationId || receipt.targetEmployeeId !== body.targetEmployeeId || receipt.mode !== body.mode
    || !nonempty(receipt.targetConversationId) || receipt.targetConversationId === body.sourceConversationId || !nonempty(result?.message?.id)
    || result.message.conversation_id !== undefined && result.message.conversation_id !== receipt.targetConversationId
    || body.mode === 'reference' && execution != null
    || body.mode === 'execute' && (!nonempty(execution?.id) || !nonempty(execution?.type) || !nonempty(execution?.status));
  if (invalid) throw Object.assign(new Error('转发回执与原请求不一致，请保留原标识核对'), { status: 409, code: 'FORWARD_RECEIPT_INVALID', uncertain: true });
}

/** Forwarding is separate from the source composer and never calls a message-dispatch API. */
export function createForwarding({ state, api, current, valid, draw = () => {}, fail = () => {}, storage = globalThis.localStorage, onAccepted = () => {}, onOpenTarget = () => {} } = {}) {
  let forwardEpoch = 0, disposed = false;
  const inFlight = new Map();
  const capture = () => current?.() || { scope: scopeKey(state), employeeId: state.selectedEmployee?.id };
  const currentToken = (token, employee = true) => valid ? valid(token, employee) : token.scope === scopeKey(state) && (!employee || token.employeeId === state.selectedEmployee?.id);
  const sourceReady = () => !disposed && state.phase === 'ready' && state.page === 'chat' && Boolean(accountId(state) && workspaceId(state) && state.selectedEmployee?.id && state.conversation?.id)
    && (!state.conversation.employee_id || state.conversation.employee_id === state.selectedEmployee.id)
    && rows(state.employees).some(employee => employee.id === state.selectedEmployee.id);
  const sourceMatches = data => sourceReady() && data?.scope === scopeKey(state) && data.sourceEmployeeId === state.selectedEmployee.id && data.sourceConversationId === state.conversation.id;
  const live = (data, token, generation = forwardEpoch) => !disposed && generation === forwardEpoch && state.forward === data && sourceMatches(data) && currentToken(token, true);
  const render = () => { if (!disposed) draw(); };
  const requestKey = (data, fingerprintHash) => `${storagePrefix(accountId(state))}${encodeURIComponent(workspaceId(state))}:${encodeURIComponent(data.sourceConversationId)}:${fingerprintHash}`;
  const targets = () => rows(state.employees).filter(employee => employee.id && employee.id !== state.selectedEmployee?.id);

  function report(error, token, data, generation) {
    // Authentication belongs to the account even after a modal is cancelled or another employee opens.
    if (error?.status === 401) { fail(error, token, false); return false; }
    if (data ? !live(data, token, generation) : !currentToken(token, false)) return false;
    if (data) data.error = data.phase === 'uncertain' ? '尚未收到转发回执，请先核对目标聊天；重试会沿用原转发标识' : error?.message || '转发未完成，请稍后重试';
    else fail(error, token, false);
    render(); return false;
  }
  const action = operation => async (values = {}) => {
    const token = capture(), data = state.forward, generation = forwardEpoch;
    try { return await operation(values); }
    catch (error) { return report(error, token, data, generation); }
  };
  function requireSource() {
    if (state.page === 'chat' && state.conversation?.id && state.selectedEmployee?.id && !rows(state.employees).some(employee => employee.id === state.selectedEmployee.id)) throw new Error('员工列表尚未加载，请在员工页刷新后再转发');
    if (!sourceReady()) throw new Error('请先打开已加载的员工聊天');
  }
  function ensure() {
    requireSource();
    if (!sourceMatches(state.forward)) throw new Error('转发来源已变化，请重新选择消息');
    return state.forward;
  }
  function begin(selectedId, phase) {
    requireSource();
    if (['submitting', 'uncertain'].includes(state.forward?.phase) && sourceMatches(state.forward)) return false;
    const selectedIds = selectedId ? [String(selectedId)] : [];
    if (selectedIds.length && !orderedForwardMessages(state.messages, selectedIds).length) throw new Error('这条消息暂不支持转发');
    forwardEpoch++;
    state.notice = '';
    state.forward = { phase, scope: scopeKey(state), sourceConversationId: state.conversation.id, sourceEmployeeId: state.selectedEmployee.id,
      selectedIds, targetEmployeeId: '', note: '', mode: 'reference', error: '', request: null, result: null };
    render(); return true;
  }
  function editable(data) { return !['submitting', 'uncertain', 'complete'].includes(data.phase); }
  function changed(data) {
    data.request = null; data.error = ''; data.result = null;
    if (data.phase === 'uncertain') data.phase = 'confirm';
  }
  function selection(data) {
    const selected = [...new Set(rows(data.selectedIds))];
    if (!selected.length) throw new Error('请至少选择一条聊天消息');
    if (selected.length > FORWARD_MESSAGE_LIMIT) throw new Error(`一次最多转发 ${FORWARD_MESSAGE_LIMIT} 条消息`);
    const ordered = orderedForwardMessages(state.messages, selected);
    if (ordered.length !== selected.length) throw new Error('部分所选消息已更新或不可转发，请重新选择');
    return ordered.map(messageId);
  }
  function target(data) {
    const employee = targets().find(employee => employee.id === data.targetEmployeeId);
    if (!employee) throw new Error('请选择当前工作区中的另一位员工');
    return employee;
  }
  function applyFields(data, values) {
    const next = {};
    for (const [key, names] of Object.entries({ targetEmployeeId: ['targetEmployeeId', 'forward-target'], note: ['note', 'forward-note'], mode: ['mode', 'forward-mode'] })) {
      const name = names.find(name => hasField(values, name));
      if (name) next[key] = String(field(values, name) || '');
    }
    if (Object.entries(next).some(([key, value]) => value !== data[key])) { changed(data); Object.assign(data, next); }
  }
  function storedRequest(key) {
    try {
      const value = JSON.parse(storage?.getItem(key) || 'null');
      return /^[a-f0-9]{64}$/.test(value?.fingerprintHash || '') && /^[A-Za-z0-9._:-]{1,128}$/.test(value?.clientRequestId || '') ? value : null;
    } catch { return null; }
  }
  function persistRequest(key, request) {
    if (!storage?.setItem) throw new Error('无法保存转发标识，请启用应用存储后再转发');
    try { storage.setItem(key, JSON.stringify({ fingerprintHash: request.fingerprintHash, clientRequestId: request.clientRequestId })); }
    catch { throw new Error('无法保存转发标识，请释放应用存储空间后再转发'); }
  }
  function removeRequest(key, request) {
    try { if (storedRequest(key)?.clientRequestId === request.clientRequestId) storage?.removeItem(key); } catch {}
  }

  async function submit(values, { retry = false } = {}) {
    const token = capture(), data = state.forward, generation = forwardEpoch;
    if (!data || !sourceMatches(data) || !(editable(data) || retry && data.phase === 'uncertain')) return false;
    let operationRequest = null, operationStorageKey = '', operationStarted = false;
    try {
      if (!retry) applyFields(data, values);
      if (retry && !data.request?.body) throw new Error('原转发请求标识不可用，请关闭后重新打开原聊天核对');
      const targetEmployee = retry ? rows(state.employees).find(employee => employee.id === data.request.body.targetEmployeeId) || { id: data.request.body.targetEmployeeId, name: data.targetEmployeeName || '目标员工' } : target(data);
      const body = retry ? { ...data.request.body, messageIds: [...data.request.body.messageIds] }
        : { sourceConversationId: data.sourceConversationId, messageIds: selection(data), targetEmployeeId: targetEmployee.id, note: data.note.trim(), mode: data.mode };
      if (!retry) {
        if (!modes.has(body.mode)) throw new Error('请选择仅转发记录或转发并请他处理');
        if (body.note.length > FORWARD_NOTE_LIMIT) throw new Error(`附言不能超过 ${FORWARD_NOTE_LIMIT} 字`);
        preflight(orderedForwardMessages(state.messages, body.messageIds));
      }
      if (typeof api?.forwardMessages !== 'function') throw new Error('当前服务暂不支持转发，请更新后重试');
      data.phase = 'submitting'; data.error = ''; render();
      const fingerprintHash = await fingerprint(body);
      if (!live(data, token, generation)) return false;
      // Distinct pending forwards must not overwrite each other's retained identity.
      const key = requestKey(data, fingerprintHash);
      if (!retry) {
        if (JSON.stringify(selection(data)) !== JSON.stringify(body.messageIds)) throw new Error('所选消息顺序已更新，请核对后重新转发');
        target(data);
      }
      if (data.request?.fingerprintHash !== fingerprintHash) {
        const saved = storedRequest(key);
        const previous = saved?.fingerprintHash === fingerprintHash;
        data.request = { fingerprintHash, clientRequestId: previous ? saved.clientRequestId : id(), body, unknown: previous };
      }
      const request = data.request;
      operationRequest = request; operationStorageKey = key;
      data.targetEmployeeName = employeeName(targetEmployee);
      persistRequest(key, request);
      const operationKey = `${key}:${request.clientRequestId}`;
      operationStarted = true;
      if (!inFlight.has(operationKey)) {
        const { sourceConversationId, ...payload } = body;
        const operation = Promise.resolve().then(() => api.forwardMessages(sourceConversationId, { ...payload, clientRequestId: request.clientRequestId }));
        inFlight.set(operationKey, operation);
        void operation.finally(() => { if (inFlight.get(operationKey) === operation) inFlight.delete(operationKey); }).catch(() => {});
      }
      const result = await inFlight.get(operationKey);
      requireReceipt(result, body);
      removeRequest(key, request);
      if (!live(data, token, generation)) return false;
      data.phase = 'complete'; data.result = result; data.error = ''; data.request = null;
      state.notice = body.mode === 'reference' ? `已转发给${employeeName(targetEmployee)}，仅保存记录` : `已转发给${employeeName(targetEmployee)}并请求处理`;
      render();
      // Refresh is separate from acceptance: a refresh failure must never turn a committed write into a retry.
      try { await onAccepted(result, { token, scope: data.scope, sourceConversationId: body.sourceConversationId, sourceEmployeeId: data.sourceEmployeeId, targetEmployeeId: body.targetEmployeeId, mode: body.mode, clientRequestId: request.clientRequestId }); }
      catch (error) { if (error?.status === 401) fail(error, token, false); }
      return true;
    } catch (error) {
      const knownRejection = Number.isInteger(error?.status) && error.status >= 400 && error.status < 500 &&
        (error.status !== 409 || typeof error.code === 'string' && error.code.length > 0) && !error.uncertain && !uncertainCodes.has(error.code);
      const unknown = Boolean(operationRequest?.unknown || retry || error?.uncertain || uncertainCodes.has(error?.code) || operationStarted && !knownRejection);
      if (operationRequest && unknown) operationRequest.unknown = true;
      // A later refusal says nothing about whether an earlier unknown attempt committed.
      if (operationRequest && operationStarted && knownRejection && !unknown) {
        removeRequest(operationStorageKey, operationRequest);
        if (data.request === operationRequest) data.request = null;
      }
      if (live(data, token, generation)) {
        data.phase = unknown ? 'uncertain' : 'confirm';
        data.error = error?.message || '转发未完成，请稍后重试';
        if (unknown) data.error = '尚未收到转发回执，请先核对目标聊天；重试会沿用原转发标识';
      }
      return report(error, token, data, generation);
    }
  }

  function change(event) {
    const input = event?.target || event, data = state.forward;
    if (!data || !sourceMatches(data) || !editable(data)) return false;
    const name = { 'forward-note': 'note', 'forward-mode': 'mode', 'forward-target': 'targetEmployeeId' }[input?.name];
    if (!name || String(input.value || '') === data[name]) return false;
    changed(data); data[name] = String(input.value || ''); render(); return true;
  }
  function reset({ clearAccount = false } = {}) {
    if (clearAccount && accountId(state)) {
      const prefix = storagePrefix(accountId(state)), keys = [];
      try { for (let index = 0; index < storage.length; index++) { const key = storage.key(index); if (key?.startsWith(prefix)) keys.push(key); } } catch {}
      for (const key of keys) { try { storage.removeItem(key); } catch {} }
    }
    forwardEpoch++; state.forward = null;
  }
  /** Call after a source poll. This never silently changes an in-flight or uncertain submission. */
  function synchronize() {
    const data = state.forward;
    if (!data) return false;
    if (!sourceMatches(data)) { reset(); return true; }
    if (['submitting', 'uncertain', 'complete'].includes(data.phase)) return false;
    const remaining = orderedForwardMessages(state.messages, data.selectedIds).map(messageId);
    if (remaining.length === data.selectedIds.length) return false;
    data.selectedIds = remaining; changed(data); data.phase = 'select'; data.error = '部分所选消息已更新，请核对后重新选择'; return true;
  }
  const actions = {
    'message-menu': action(({ id: selectedId }) => begin(selectedId, 'menu')),
    'forward-single': action(() => { const data = ensure(); if (!editable(data)) return false; selection(data); data.phase = 'target'; data.error = ''; render(); return true; }),
    'forward-select': action(({ id: selectedId }) => {
      if (!state.forward || !sourceMatches(state.forward)) return begin(selectedId, 'select');
      const data = ensure(); if (!editable(data)) return false;
      if (selectedId) { if (!orderedForwardMessages(state.messages, [selectedId]).length) throw new Error('这条消息暂不支持转发'); data.selectedIds = [selectedId]; }
      changed(data); data.phase = 'select'; render(); return true;
    }),
    'forward-toggle': action(({ id: selectedId }) => {
      const data = ensure(); if (data.phase !== 'select') return false;
      if (!orderedForwardMessages(state.messages, [selectedId]).length) throw new Error('这条消息暂不支持转发');
      if (data.selectedIds.includes(selectedId)) data.selectedIds = data.selectedIds.filter(value => value !== selectedId);
      else { if (data.selectedIds.length >= FORWARD_MESSAGE_LIMIT) throw new Error(`一次最多转发 ${FORWARD_MESSAGE_LIMIT} 条消息`); data.selectedIds = [...data.selectedIds, selectedId]; }
      changed(data); render(); return true;
    }),
    'forward-next': action(() => { const data = ensure(); if (!editable(data)) return false; selection(data); if (data.phase === 'target') { target(data); data.phase = 'confirm'; } else data.phase = 'target'; data.error = ''; render(); return true; }),
    'forward-target': action(({ id: targetEmployeeId }) => { const data = ensure(); if (!editable(data)) return false; if (data.targetEmployeeId !== targetEmployeeId) { changed(data); data.targetEmployeeId = targetEmployeeId; } target(data); selection(data); data.phase = 'confirm'; render(); return true; }),
    'forward-back': action(() => { const data = ensure(); if (data.phase === 'submitting') return false; if (['menu', 'select', 'uncertain', 'complete'].includes(data.phase)) reset(); else { data.phase = data.phase === 'target' ? 'select' : 'target'; data.error = ''; } render(); return true; }),
    'forward-cancel': action(() => { reset(); render(); return true; }),
    'forward-retry': action(() => state.forward?.phase === 'uncertain' ? submit(undefined, { retry: true }) : false),
    'forward-open-target': action(async () => {
      const data = ensure(); if (data.phase !== 'complete') return false;
      const employee = target(data), result = data.result;
      const conversationId = result?.targetConversationId || result?.forward?.targetConversationId || result?.target_conversation_id || '';
      reset(); render(); await onOpenTarget({ employeeId: employee.id, conversationId, result }); return true;
    }),
  };
  return { actions, submit, change, reset, synchronize, targets, selectedMessages: () => orderedForwardMessages(state.messages, state.forward?.selectedIds), dispose: () => { disposed = true; reset(); inFlight.clear(); } };
}
