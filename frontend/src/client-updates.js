const activeStates = new Set(['requested', 'accepted', 'waiting_idle', 'updating', 'awaiting_heartbeat']);
const cancellableStates = new Set(['requested', 'accepted', 'waiting_idle']);
const labels = {
  requested: '等待电脑接收', accepted: '电脑已接收', waiting_idle: '等待员工空闲',
  updating: '正在升级', awaiting_heartbeat: '等待新版重新上线', succeeded: '升级完成',
  failed: '升级失败', cancelled: '已取消',
};
const scopeKey = ({ workspace, actorId }) => JSON.stringify([workspace, actorId]);
const rowKey = (scope, deviceId) => `ziwei.client-update.${encodeURIComponent(scope.workspace)}.${encodeURIComponent(scope.actorId)}.${encodeURIComponent(deviceId)}`;

export function clientUpdateView(device, { submitting = false, cancelling = false, uncertain = false } = {}) {
  const operation = device?.operation;
  const reportedState = operation?.state;
  // Only a matched heartbeat can make an accepted maintenance request successful.
  const state = reportedState === 'succeeded' && operation.heartbeatVerified !== true ? 'awaiting_heartbeat' : reportedState;
  const stalled = operation?.stalled === true && ['updating', 'awaiting_heartbeat'].includes(state);
  const active = activeStates.has(state) || Boolean(state && !['failed', 'cancelled', 'succeeded'].includes(state));
  const latest = Boolean(device?.currentBuild && device.currentBuild === device.targetBuild);
  const online = device?.status === 'online';
  const manageable = device?.canManage === true;
  const available = manageable && device?.supported === true && online && Boolean(device?.targetBuild) && !latest && (!active || stalled);
  const busy = submitting || cancelling;
  const reason = device?.reason || (device?.reasonCode === 'REMOTE_UPDATE_CLIENT_REQUIRED' ? '此电脑需要先安装一次支持远程升级的新版客户端。' : !online ? '电脑离线，重新上线后才能发起升级。' : !manageable ? '需要工作区管理员发起升级。' : '');
  return {
    state: state || (latest ? 'current' : 'ready'), active, stalled, latest, available,
    label: uncertain ? '正在核对更新请求' : busy ? (cancelling ? '取消中…' : '提交中…') : stalled ? '维护回执超时' : state ? (labels[state] || '更新状态待确认') : latest ? '已是目标版本' : device?.supported === true ? '可远程升级' : '暂不可远程升级',
    tone: state === 'succeeded' && operation?.heartbeatVerified === true ? 'success' : state === 'failed' ? 'danger' : active || uncertain ? 'pending' : 'neutral',
    reason,
    canUpdate: available && !busy && !uncertain,
    canCancel: manageable && cancellableStates.has(state) && !busy && !uncertain,
    updateLabel: stalled ? '重新请求官方升级' : state === 'failed' ? '重新升级' : '远程升级',
    legacyRequired: device?.reasonCode === 'REMOTE_UPDATE_CLIENT_REQUIRED',
    failure: state === 'failed' ? [operation?.reason || operation?.message, operation?.code].filter(Boolean).join(' · ') || '升级失败，请刷新查看具体回执。' : '',
  };
}

/** A page refresh only reads the durable request; it never submits maintenance. */
export function createClientUpdateController({ scope, read, submit, cancel, storage, makeKey = () => `client-update-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`, wrap = value => value }) {
  const state = wrap({ devices: [], release: null, releaseError: '', loading: false, error: '', rowErrors: {}, submitting: {}, cancelling: {}, uncertain: {}, readReady: false });
  let epoch = 0, readGeneration = 0;
  const pending = new Map();
  const current = (frozen, token) => token === epoch && scopeKey(frozen) === scopeKey(scope());
  function save(frozen, id, value) {
    pending.set(id, value);
    try { storage?.setItem(rowKey(frozen, id), JSON.stringify(value)); } catch {}
  }
  function forget(frozen, id) {
    pending.delete(id); delete state.uncertain[id];
    try { storage?.removeItem(rowKey(frozen, id)); } catch {}
  }
  function load(frozen, id) {
    if (pending.has(id)) return pending.get(id);
    try {
      const item = JSON.parse(storage?.getItem(rowKey(frozen, id)) || 'null');
      if (item && typeof item.key === 'string' && item.key.startsWith('client-update-')) { pending.set(id, item); return item; }
    } catch {}
    return null;
  }
  function invalidate() {
    epoch++; readGeneration++; pending.clear();
    Object.assign(state, { devices: [], release: null, releaseError: '', loading: false, error: '', rowErrors: {}, submitting: {}, cancelling: {}, uncertain: {}, readReady: false });
  }
  async function refresh({ silent = false } = {}) {
    const frozen = { ...scope() }, token = epoch, request = ++readGeneration;
    if (!frozen.workspace || !frozen.actorId) return null;
    if (!silent) state.loading = true;
    state.error = '';
    try {
      const result = await read(frozen.workspace);
      if (!current(frozen, token) || request !== readGeneration) return null;
      if (!Array.isArray(result?.devices)) throw new Error('服务器未返回设备升级状态，请稍后刷新。');
      state.devices = result.devices;
      state.release = result.release || null;
      state.releaseError = typeof result.releaseError === 'string' ? result.releaseError : result.releaseError?.code || '';
      state.readReady = true;
      for (const device of state.devices) {
        const item = load(frozen, device.id);
        const operation = device.operation;
        if (item && operation && (operation.idempotencyKey === item.key || operation.id === item.operationId)) { forget(frozen, device.id); delete state.rowErrors[device.id]; }
        else if (item?.uncertain) state.uncertain[device.id] = true;
      }
      return result;
    } catch (cause) {
      if (current(frozen, token) && request === readGeneration) { state.error = cause.message || '读取升级状态失败'; state.readReady = false; }
      return null;
    } finally { if (current(frozen, token) && request === readGeneration) state.loading = false; }
  }
  async function update(deviceId) {
    const device = state.devices.find(item => item.id === deviceId);
    const frozen = { ...scope() }, token = epoch;
    if (!state.readReady || !frozen.actorId || !clientUpdateView(device, { submitting: state.submitting[deviceId], cancelling: state.cancelling[deviceId], uncertain: state.uncertain[deviceId] }).canUpdate) return null;
    const prior = load(frozen, deviceId);
    const item = prior || { key: makeKey(), uncertain: false };
    save(frozen, deviceId, { ...item, uncertain: true });
    state.submitting[deviceId] = true; state.rowErrors[deviceId] = ''; readGeneration++;
    try {
      const result = await submit(deviceId, { idempotencyKey: item.key, waitForIdle: true }, frozen.workspace);
      if (!current(frozen, token)) return null;
      if (result?.alreadyCurrent === true) { forget(frozen, deviceId); await refresh({ silent: true }); return null; }
      if (!result?.request?.id) throw new Error('更新请求回执不完整，正在查询原请求，请勿重复提交。');
      device.operation = result.request;
      save(frozen, deviceId, { key: item.key, operationId: result.request.id, uncertain: false });
      delete state.uncertain[deviceId];
      await refresh({ silent: true });
      return result.request;
    } catch (cause) {
      if (!current(frozen, token)) return null;
      state.rowErrors[deviceId] = cause.message || '提交结果未确认，请查询原请求。';
      state.uncertain[deviceId] = true;
      // A GET can recover an accepted request even when its POST response was lost.
      await refresh({ silent: true });
      return null;
    } finally { if (current(frozen, token)) delete state.submitting[deviceId]; }
  }
  async function cancelUpdate(deviceId) {
    const device = state.devices.find(item => item.id === deviceId);
    const frozen = { ...scope() }, token = epoch;
    if (!state.readReady || !clientUpdateView(device, { submitting: state.submitting[deviceId], cancelling: state.cancelling[deviceId], uncertain: state.uncertain[deviceId] }).canCancel) return null;
    state.cancelling[deviceId] = true; state.rowErrors[deviceId] = ''; readGeneration++;
    try {
      const result = await cancel(deviceId, device.operation.id, frozen.workspace);
      if (!current(frozen, token)) return null;
      if (result?.request?.id === device.operation.id) device.operation = result.request;
      await refresh({ silent: true });
      return result;
    } catch (cause) { if (current(frozen, token)) { state.rowErrors[deviceId] = cause.message || '取消结果未确认，请刷新原请求。'; await refresh({ silent: true }); } return null; }
    finally { if (current(frozen, token)) delete state.cancelling[deviceId]; }
  }
  async function retry(deviceId) {
    const device = state.devices.find(item => item.id === deviceId);
    if (!state.readReady || !state.uncertain[deviceId] || !load(scope(), deviceId) || !clientUpdateView(device, { submitting: state.submitting[deviceId], cancelling: state.cancelling[deviceId] }).canUpdate) return null;
    // This is an explicit retry of the SAME idempotent request, never a new key.
    delete state.uncertain[deviceId];
    return update(deviceId);
  }
  return { state, refresh, update, retry, cancel: cancelUpdate, invalidate };
}
