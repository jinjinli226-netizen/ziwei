import { accountId, workspaceId, scopeKey, id, executionUncertain } from './model.js';

export const GROUP_PAGE_SIZE = 30;
const rows = value => Array.isArray(value) ? value : [];
const stable = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value);
const groupId = value => typeof value === 'string' && /^group_[A-Za-z0-9_-]{1,80}$/.test(value);
const clone = value => JSON.parse(JSON.stringify(value));
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'expired', 'rejected']);
const active = new Set(['pending', 'acked', 'queued', 'running']);
const prefix = 'ziwei.manager.groups.v1:';
const capabilityPrefix = 'ziwei.manager.group-capability.v1:';
const upgradeIssue = Object.freeze({code:'GROUP_HOST_UPGRADE_REQUIRED',message:'目标电脑暂不支持手机分页群记录，请先更新电脑端并成功读取群记录后再发送'});
const failure = (message, code = 'GROUP_RECEIPT_INVALID') => Object.assign(new Error(message), { code });
const receiptOf = action => action?.result?.nativeOperation || action?.result?.result?.nativeOperation;
const keyFor = (account, workspace, source) => prefix + JSON.stringify([account, workspace, source]);
const canonical = value => value && typeof value === 'object' ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;

export function mobileGroupCandidates(state) {
  const map = new Map();
  for (const bot of rows(state.bots)) if (bot?.employee?.id && bot.kind !== 'creator') map.set(bot.employee.id, { ...bot.employee, bot });
  for (const employee of rows(state.employees)) if (employee?.id) map.set(employee.id, { ...map.get(employee.id), ...employee });
  return [...map.values()].filter(employee => employee.runtime === 'Hermes' && employee.bot?.kind !== 'creator' && employee.kind !== 'creator' && stable(employee.id) && employee.status !== 'deleted');
}

function capabilityBinding(bot) {
  return {sourceId:bot?.id||'',deviceId:bot?.employee?.target_device_id??null,
    profileMode:bot?.instance?.mode||'legacy_private_home',profile:bot?.instance?.profile??bot?.employee?.runtime_profile??null,
    ownershipId:bot?.instance?.ownershipId??null,revision:bot?.revision??null};
}
const capabilityBindingKey = bot => JSON.stringify(capabilityBinding(bot));
export function mobileGroupGate(bot, { sending = false, capabilityError = null, paginationVerified = false } = {}) {
  if (!bot || bot.configuration_state !== 'initialized') return '这位员工尚未完成 Bot 配置';
  if (!Number.isSafeInteger(bot.revision) || !Number.isSafeInteger(bot.control_epoch)) return '员工版本尚未读全，请重新选择员工';
  if (!sending) return '';
  if(capabilityError)return capabilityError.message;
  const readIssue=[bot.mobileReadError,bot.latest_run?.mobileReadError,bot.nativeResources?.groups?.readError,bot.nativeResources?.groups?.mobileReadError,bot.nativeResources?.collaboration?.readError,bot.nativeResources?.collaboration?.mobileReadError]
    .find(issue=>issue&&!(paginationVerified&&issue.code==='GROUP_HOST_UPGRADE_REQUIRED'));
  if(readIssue)return readIssue.message||'群组原记录暂时无法核对，请先更新电脑端并刷新';
  if (bot.config?.permissions?.mode !== 'execute' || bot.config?.collaboration?.enabled !== true) return '请先在模型与能力中保存伙伴协作和工具权限';
  if (bot.control_state !== 'active' || bot.validation?.status !== 'succeeded') return '请先检查并启用当前员工配置';
  const run = bot.active_run || bot.latest_run;
  if (executionUncertain(run) || run?.status === 'expired' && run.acked_at) return '员工原执行仍待核实，请先核对原回执';
  if (active.has(run?.status)) return '员工正在执行，请先等待本次工作结束';
  return '';
}
export function mobileGroupStateGate(g, {sending=true}={}) {
  return mobileGroupGate(g?.bot,{sending,capabilityError:g?.capabilityError,
    paginationVerified:g?.verifiedCapabilityKey===capabilityBindingKey(g?.bot)});
}

async function fingerprint(body) {
  if (!globalThis.crypto?.subtle) throw failure('无法保存本次请求标识，请更新应用后重试', 'GROUP_STORAGE_UNAVAILABLE');
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical(body))));
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}

function checkedAction(action, pending) {
  const binding = action?.payload?.hermesBot, request = action?.payload?.nativeOperation;
  if (!stable(action?.id) || pending.actionId && action.id !== pending.actionId || !active.has(action.status) && !terminal.has(action.status)
      || action.payload?.employeeId !== pending.sourceId || binding?.employeeId !== pending.sourceId || binding.workspace !== pending.workspace
      || binding.revision !== pending.revision || binding.controlEpoch !== pending.controlEpoch
      || request?.schemaVersion !== 2 || request.resource !== pending.resource || request.operation !== pending.operation || request.requestId !== pending.requestId) {
    throw failure('原执行的员工、工作区、版本或请求标识无法核对，请查询原请求');
  }
  if (pending.resource === 'groups' && request.input?.groupId !== pending.groupId && pending.operation !== 'list') throw failure('原群组标识与本次读取不一致');
  if (pending.resource === 'groups' && pending.operation === 'read' && (request.input.limit !== GROUP_PAGE_SIZE || request.input.afterSeq !== pending.afterSeq)) throw failure('原群记录分页与本次请求不一致');
  if (pending.resource === 'collaboration' && (request.input?.mode !== 'group' || request.input.groupId !== pending.groupId)) throw failure('原执行不是本次群组发送');
  const receipt = receiptOf(action);
  if (receipt) {
    const compatible = receipt.resource === pending.resource && receipt.operation === pending.operation
      || pending.resource === 'collaboration' && pending.operation === 'message' && receipt.resource === 'collaboration' && receipt.operation === 'publish'
      || pending.resource === 'groups' && pending.operation === 'step' && (receipt.resource === 'groups' && receipt.operation === 'read' || receipt.resource === 'collaboration' && receipt.operation === 'publish');
    if (receipt.schemaVersion !== 2 || receipt.employeeId !== pending.sourceId || receipt.revision !== pending.revision || !compatible) throw failure('原生回执的员工、版本或资源归属不一致');
  }
  if (action.status === 'succeeded' && !receipt) throw failure('原执行已结束但缺少原生回执，请保留原请求核对');
  return action;
}

function checkedPage(data, pending) {
  const pagination = data?.pagination, log = data?.events;
  if (data?.pagedRead !== true || !pagination || pagination.limit !== GROUP_PAGE_SIZE || pagination.afterSeq !== pending.afterSeq
      || !Number.isSafeInteger(pagination.nextAfterSeq) || pagination.nextAfterSeq < pending.afterSeq || typeof pagination.hasMore !== 'boolean'
      || !Array.isArray(log?.events) || log.events.length > GROUP_PAGE_SIZE || data.room?.room_id !== pending.groupId
      || !Array.isArray(data.room.members)) throw failure('目标电脑暂不支持手机分页群记录，请先更新电脑端', 'GROUP_HOST_UPGRADE_REQUIRED');
  let previous = pending.afterSeq;
  const ids = new Set();
  for (const event of log.events) {
    if (!Number.isSafeInteger(event?.seq) || event.seq <= previous || !stable(event.event_id) || ids.has(event.event_id)) throw failure('群记录顺序或事件标识无法核对');
    ids.add(event.event_id); previous = event.seq;
  }
  if (pagination.nextAfterSeq !== previous || pagination.hasMore && !log.events.length) throw failure('群记录游标没有正确前进');
  return { room: data.room, events: log.events, cursor: pagination.nextAfterSeq, hasMore: pagination.hasMore };
}

/** No timers or scheduler: refresh/paging are explicit native reads; poll only GETs original actions. */
export function createMobileGroups({ state, api, current, valid, draw = () => {}, fail = () => {}, storage = globalThis.localStorage } = {}) {
  let generation = 0, disposed = false, lastAccount = '';
  const registry = new Map(), capabilityErrors = new Map();
  const capture = () => current?.() || { scope: scopeKey(state) };
  const scope = () => ({ account: accountId(state), workspace: workspaceId(state) });
  const live = (g, token, visit) => !disposed && state.groups === g && generation === visit && ['groups', 'group'].includes(state.page)
    && (valid ? valid(token) : token.scope === scopeKey(state)) && g.scope === scopeKey(state);
  const initial = () => ({ scope: scopeKey(state), sourceId: '', bot: null, rooms: [], room: null, roomVerified: false, events: [], members: [], cursor: 0, hasMore: false,
    selectedTargetIds: [], mentionIds: [], content: '', newGroup: false, busy: false, storageBlocked: false, capabilityError:null,verifiedCapabilityKey:null,phase: 'idle', error: '', notice: '', pending: null, lastAction: null, memberRuns: [] });
  const ensure = () => state.groups ||= initial();
  const pendingKey = g => keyFor(accountId(state), workspaceId(state), g.sourceId);
  const capabilityKey = sourceId => capabilityPrefix+JSON.stringify([accountId(state),workspaceId(state),sourceId]);
  function restoreCapability(g) {
    const key=capabilityKey(g.sourceId);
    if(!capabilityErrors.has(key)) {
      try {
        if(!storage?.getItem)throw new Error();
        const raw=storage.getItem(key);
        if(raw!==null&&raw!==undefined) {
          if(typeof raw!=='string')throw new Error();
          if(raw.length>4096)throw new Error();
          const value=JSON.parse(raw),binding=value.binding;
          if(value.schemaVersion!==1||value.accountId!==accountId(state)||value.workspace!==workspaceId(state)||value.sourceId!==g.sourceId||value.code!=='GROUP_HOST_UPGRADE_REQUIRED'
              ||!binding||binding.sourceId!==g.sourceId||!Number.isSafeInteger(binding.revision)||binding.revision<0
              ||['deviceId','profileMode','profile','ownershipId'].some(name=>binding[name]!==null&&(typeof binding[name]!=='string'||binding[name].length>512)))throw new Error();
          capabilityErrors.set(key,{...upgradeIssue,binding});
        } else capabilityErrors.set(key,null);
      } catch {
        capabilityErrors.set(key,{code:'GROUP_CAPABILITY_STATE_UNAVAILABLE',message:'本机群能力记录无法读取，请先成功读取当前群记录后再发送'});
      }
    }
    // A revision/configuration change alone does not prove that the host was updated.
    g.capabilityError=capabilityErrors.get(key);
    if(g.capabilityError)g.phase='upgrade_required';
  }
  function rememberUpgrade(g,pending,token) {
    if(disposed||!(valid?valid(token):token.scope===scopeKey(state))||g.scope!==scopeKey(state)||!pending)return;
    const binding=pending.capabilityBinding||capabilityBinding(g.bot),key=capabilityKey(pending.sourceId);
    const value={schemaVersion:1,accountId:accountId(state),workspace:workspaceId(state),sourceId:pending.sourceId,code:upgradeIssue.code,binding};
    capabilityErrors.set(key,{...upgradeIssue,binding});g.capabilityError=capabilityErrors.get(key);g.verifiedCapabilityKey=null;
    try {if(!storage?.setItem)throw new Error();storage.setItem(key,JSON.stringify(value));}
    catch {g.capabilityError={...g.capabilityError,message:'本机无法保存群能力检查，暂不能发送，请恢复存储后重新读取群记录'};}
  }
  function confirmPagination(g,pending) {
    if(!pending.capabilityBinding||JSON.stringify(pending.capabilityBinding)!==capabilityBindingKey(g.bot))return;
    const key=capabilityKey(g.sourceId);capabilityErrors.set(key,null);g.capabilityError=null;g.verifiedCapabilityKey=capabilityBindingKey(g.bot);
    try {storage?.removeItem(key);}catch {g.notice='当前群分页已核实；本机旧能力记录未清理，重启后需重新核对';}
  }
  function store(pending) {
    const value = Object.fromEntries(Object.entries(pending).filter(([key]) => !['body', 'action'].includes(key)));
    try { if (!storage?.setItem) throw new Error(); storage.setItem(pending.storageKey, JSON.stringify(value)); }
    catch { throw failure('无法保存本次群聊请求标识，请先恢复应用存储', 'GROUP_STORAGE_UNAVAILABLE'); }
  }
  function remove(pending) { registry.delete(pending.storageKey); try { storage?.removeItem(pending.storageKey); } catch {} }
  function restore(g) {
    const key = pendingKey(g);
    if (registry.has(key)) return registry.get(key);
    let raw;
    try { raw = storage?.getItem(key); } catch { g.storageBlocked = true; g.error = '无法读取本机原请求，恢复应用存储后再发送；不会覆盖原请求'; g.phase = 'unknown'; return null; }
    if (!raw) return null;
    try {
      const value = JSON.parse(raw);
      if (value.storageKey !== key || value.workspace !== workspaceId(state) || value.sourceId !== g.sourceId
          || !stable(value.requestId) || !/^[a-f0-9]{64}$/.test(value.fingerprint) || !Number.isSafeInteger(value.revision)
          || !Number.isSafeInteger(value.controlEpoch) || !['groups', 'collaboration'].includes(value.resource)
          || !['list', 'read', 'step', 'message'].includes(value.operation) || value.actionId !== null && !stable(value.actionId)
          || !Array.isArray(value.targetIds) || value.targetIds.some(id => !stable(id)) || value.targetIds.length > 5) throw new Error();
      registry.set(key, value); return value;
    } catch { g.storageBlocked = true; g.error = '本机原请求标识损坏，请先核对运行记录，不能重发未知任务；原记录已保留'; g.phase = 'unknown'; return null; }
  }
  const pendingFor = g => registry.get(pendingKey(g));
  const targets = g => {
    const authorized = new Set(rows(g.bot?.config?.collaboration?.targetEmployeeIds));
    return mobileGroupCandidates(state).filter(employee => employee.id !== g.sourceId && authorized.has(employee.id));
  };
  function displayPending(g, pending) { g.pending = pending ? Object.fromEntries(Object.entries(pending).filter(([key]) => !['body', 'action', 'storageKey'].includes(key))) : null; }
  function report(g, error, token, visit) {
    if (!live(g, token, visit)) return;
    g.error = error?.message || '群组读取失败，请核对原请求';
    if (error?.status === 401) fail(error, token);
    draw();
  }
  async function choose(sourceId) {
    if (disposed) return false;
    if (!sourceId) { generation++; state.groups = initial(); state.page = 'groups'; draw(); return true; }
    if (!mobileGroupCandidates(state).some(employee => employee.id === sourceId)) { ensure().error = '请选择当前工作区可见的 Hermes 员工'; draw(); return false; }
    generation++; const visit = generation, token = capture(), g = initial(); state.groups = g; g.sourceId = sourceId; state.page = 'groups'; g.busy = true; draw();
    try {
      const bot = await api.bot(workspaceId(state), sourceId);
      if (!live(g, token, visit)) return false;
      if (bot?.id !== sourceId || bot.workspace !== workspaceId(state) || bot.kind === 'creator') throw failure('员工归属无法核对');
      g.bot = bot;
      restoreCapability(g);
      const pending = restore(g); displayPending(g, pending);
      if (pending) { g.phase = pending.actionId ? 'queued' : 'unknown'; g.notice = '保留了原请求，请先查询本次回执'; }
      return true;
    } catch (error) { report(g, error, token, visit); return false; }
    finally { if (live(g, token, visit)) { g.busy = false; draw(); } }
  }
  async function open({ sourceEmployeeId, groupId: roomId } = {}) {
    if (disposed) return false;
    generation++; state.groups = initial(); state.page = 'groups'; lastAccount = accountId(state); draw();
    if (sourceEmployeeId && await choose(sourceEmployeeId) && roomId) return openRoom(roomId);
    return true;
  }
  function setMembers(g, room) {
    const known = new Map(mobileGroupCandidates(state).map(employee => [employee.id, employee]));
    g.members = rows(room.members).filter(member => stable(member?.member_id)).map(member => ({ id: member.member_id, name: known.get(member.member_id)?.name || member.display_name || member.member_id }));
    g.selectedTargetIds = g.members.map(member => member.id).filter(id => id !== g.sourceId);
    g.mentionIds = rows(g.mentionIds).filter(id => g.members.some(member => member.id === id));
  }
  async function memberStates(g, pending, parent, token, visit) {
    const references = rows(parent.result?.nativeGroup?.runs), manifest = rows(parent.payload?.nativeOperation?.input?.targets);
    const found = [];
    for (const reference of references) {
      if (!stable(reference?.actionId) || ![pending.sourceId, ...pending.targetIds].includes(reference.employeeId)) throw failure('成员执行回执不属于本次明确目标');
      if (reference.employeeId === pending.sourceId) { if (reference.actionId !== parent.id) throw failure('负责员工的群回合归属无法核对'); found.push({ id: parent.id, employeeId: reference.employeeId, status: parent.status, source: true }); continue; }
      try {
        const value = await api.managementAction(pending.workspace, reference.actionId), child = value?.action || value, target = manifest.find(item => item.id === reference.employeeId), binding = child?.payload?.hermesBot, relation = child?.payload?.collaboration;
        if (child?.id !== reference.actionId || child.payload?.employeeId !== reference.employeeId || !target
            || binding?.workspace !== pending.workspace || binding.employeeId !== reference.employeeId || binding.revision !== target.revision || binding.controlEpoch !== target.controlEpoch
            || relation?.sourceEmployeeId !== pending.sourceId || relation.sourceActionId !== parent.id || relation.groupId !== pending.groupId) throw failure('成员执行的来源、工作区或目标归属不一致');
        found.push({ id: child.id, employeeId: reference.employeeId, status: executionUncertain(child) || child.status === 'expired' && child.acked_at ? 'uncertain' : child.status, error: child.error || '' });
      } catch (error) { found.push({ id: reference.actionId, employeeId: reference.employeeId, status: 'unresolved', error: error?.message || '原成员结果尚未读回' }); }
      if (!live(g, token, visit)) return;
    }
    if (live(g, token, visit)) g.memberRuns = found;
  }
  async function accept(g, pending, raw, token, visit) {
    if (registry.get(pending.storageKey) !== pending) return false;
    const action = checkedAction(raw?.action || raw, pending);
    const request = action.payload.nativeOperation, body = pending.resource === 'collaboration'
      ? { expectedRevision: pending.revision, expectedControlEpoch: pending.controlEpoch, idempotencyKey: pending.requestId, mode: request.input.mode, groupId: request.input.groupId, targetEmployeeIds: rows(request.input.targets).map(target => target.id), content: request.input.content }
      : { expectedRevision: pending.revision, expectedControlEpoch: pending.controlEpoch, idempotencyKey: pending.requestId, resource: request.resource, operation: request.operation, input: request.input };
    if (await fingerprint(body) !== pending.fingerprint) throw failure('原执行内容与本机保存的请求摘要不一致，请核对原请求');
    if (registry.get(pending.storageKey) !== pending) return false;
    pending.actionId = action.id; pending.action = action; store(pending);
    if (!live(g, token, visit)) return false;
    displayPending(g, pending); g.lastAction = action; g.error = ''; g.notice = '';
    if (executionUncertain(action) || action.status === 'expired' && action.acked_at) { g.phase = 'uncertain'; g.error = '执行结果或停止状态待核实，只查询原执行'; return false; }
    if (active.has(action.status)) { g.phase = 'queued'; g.notice = '请求已受理，等待目标电脑回执'; return true; }
    if (action.status !== 'succeeded') { g.phase = 'failed'; g.error = action.error || '原生群组操作未完成'; remove(pending); displayPending(g, null); return false; }
    const receipt = receiptOf(action);
    if (receipt.status !== 'succeeded') { g.phase = receipt.status || 'failed'; g.error = receipt.data?.reason || receipt.data?.error || '原生能力需要补齐依赖或授权'; remove(pending); displayPending(g, null); return false; }
    if (pending.resource === 'groups' && pending.operation === 'list') {
      if (!Array.isArray(receipt.data?.items)) throw failure('群组列表回执无效');
      g.rooms = receipt.data.items.filter(room => groupId(room?.room_id));
    } else if (pending.resource === 'groups' && pending.operation === 'read') {
      const page = checkedPage(receipt.data, pending);
      if (pending.afterSeq !== 0 && (g.room?.room_id !== pending.groupId || g.cursor !== pending.afterSeq)) throw failure('群记录已变化，请重新读取这段群记录');
      g.room = page.room; g.events = pending.afterSeq === 0 ? page.events : [...g.events, ...page.events]; g.cursor = page.cursor; g.hasMore = page.hasMore;
      g.roomVerified = true;
      confirmPagination(g,pending);
      setMembers(g, page.room); state.page = 'group'; g.newGroup = false;
    } else {
      // A send/step receipt may carry the native manager's complete history.
      // Never substitute it for the explicitly paginated conversation timeline.
      if (receipt.data?.room?.room_id !== pending.groupId && action.result?.nativeGroup?.groupId !== pending.groupId) throw failure('群组发送已结束但原生群标识尚未核实，请查询原请求');
      if (!g.room || g.room.room_id !== pending.groupId) g.room = { room_id: pending.groupId, name: '员工协作群', members: [pending.sourceId, ...pending.targetIds].map(id => ({ member_id: id })) };
      g.roomVerified = true;
      setMembers(g, g.room); state.page = 'group'; g.newGroup = false; g.content = '';
      await memberStates(g, pending, action, token, visit);
      if (!live(g, token, visit)) return false;
      g.notice = '这次群组执行已结束；成员结果分别列出，群记录可点击刷新读取';
    }
    g.phase = 'succeeded'; remove(pending); displayPending(g, null); return true;
  }
  async function dispatch(resource, operation, input, { sending = false, afterSeq = 0 } = {}) {
    if (disposed || !['groups', 'group'].includes(state.page)) return false;
    const g = ensure(), token = capture(), visit = generation, workspace = workspaceId(state);
    if (g.busy || g.storageBlocked || pendingFor(g) || g.phase === 'unknown' && !g.pending) return false;
    const gate = mobileGroupStateGate(g, { sending });
    if (gate) { g.error = gate; draw(); return false; }
    g.busy = true; g.error = ''; g.notice = ''; g.phase = sending ? 'submitting' : 'reading'; draw();
    let pending, started = false;
    try {
      const requestId = `mobile-group-${id()}`;
      let body;
      if (sending) {
        if (!g.newGroup && !g.roomVerified) throw failure('请先读取并核对当前群记录，再发送群消息');
        const ids = [...new Set(g.selectedTargetIds)], authorized = new Set(targets(g).map(employee => employee.id));
        if (!ids.length || ids.length > 5 || ids.some(id => !authorized.has(id))) throw failure('只可选择已保存授权的1–5位伙伴');
        const members = new Set([g.sourceId, ...ids]);
        if (g.mentionIds.some(id => !members.has(id))) throw failure('提及对象已不属于这次群组');
        if (!g.content.trim()) throw failure('请先输入群消息');
        const content = `${g.mentionIds.length ? g.mentionIds.map(id => '@' + id).join(' ') + '\n' : ''}${g.content.trim()}`;
        if (content.length > 20000) throw failure('群消息最多20000字');
        const roomId = g.newGroup ? `group_${(await fingerprint([g.sourceId, requestId])).slice(0, 20)}` : g.room?.room_id;
        if (!groupId(roomId)) throw failure('请先读取当前原生群组');
        body = { expectedRevision: g.bot.revision, expectedControlEpoch: g.bot.control_epoch, idempotencyKey: requestId, mode: 'group', groupId: roomId, targetEmployeeIds: ids, content };
        input = { groupId: roomId };
      } else body = { expectedRevision: g.bot.revision, expectedControlEpoch: g.bot.control_epoch, idempotencyKey: requestId, resource, operation, input };
      pending = { storageKey: pendingKey(g), workspace, sourceId: g.sourceId, revision: g.bot.revision, controlEpoch: g.bot.control_epoch,
        capabilityBinding:capabilityBinding(g.bot),
        requestId, resource, operation, groupId: input?.groupId || null, afterSeq, targetIds: sending ? body.targetEmployeeIds : [], fingerprint: await fingerprint(body), actionId: null, body };
      if (!live(g, token, visit)) return false;
      store(pending); registry.set(pending.storageKey, pending); displayPending(g, pending); draw(); started = true;
      const response = sending ? await api.collaborateBot(workspace, g.sourceId, clone(body)) : await api.botNativeAction(workspace, g.sourceId, clone(body));
      return await accept(g, pending, response, token, visit);
    } catch (error) {
      if (pending && error.code === 'GROUP_HOST_UPGRADE_REQUIRED') remove(pending);
      if(error.code==='GROUP_HOST_UPGRADE_REQUIRED')rememberUpgrade(g,pending,token);
      if (pending && started && error.status && error.status < 500 && error.status !== 408 && !/IDEMPOTENCY.*CONFLICT/.test(error.code || '')) remove(pending);
      if (live(g, token, visit)) { g.phase = error.code === 'GROUP_HOST_UPGRADE_REQUIRED' ? 'upgrade_required' : pending && registry.has(pending.storageKey) ? 'unknown' : 'failed'; displayPending(g, pendingFor(g)); }
      report(g, error, token, visit); return false;
    } finally { if (live(g, token, visit)) { g.busy = false; draw(); } }
  }
  async function poll() {
    if (disposed || !['groups', 'group'].includes(state.page)) return false;
    const g = ensure(), pending = pendingFor(g), token = capture(), visit = generation;
    if (!pending || g.busy) return false;
    g.busy = true; g.error = ''; draw();
    try {
      let response;
      if (pending.actionId) response = await api.managementAction(pending.workspace, pending.actionId);
      else {
        const value = await api.botRuns(pending.workspace, pending.sourceId);
        response = rows(value?.runs).find(action => action.payload?.nativeOperation?.requestId === pending.requestId);
        if (!response) throw failure('最近运行记录还未找到原请求，请保留本次标识核对，勿重复发送');
      }
      return await accept(g, pending, response, token, visit);
    } catch (error) {
      if (error.code === 'GROUP_HOST_UPGRADE_REQUIRED') { remove(pending); if (live(g, token, visit)) { g.phase = 'upgrade_required'; displayPending(g, null); } }
      if(error.code==='GROUP_HOST_UPGRADE_REQUIRED')rememberUpgrade(g,pending,token);
      report(g, error, token, visit); return false;
    }
    finally { if (live(g, token, visit)) { g.busy = false; draw(); } }
  }
  async function openRoom(roomId) {
    if (!groupId(roomId)) return false;
    const g = ensure();
    if (g.storageBlocked) return false;
    if (g.busy || pendingFor(g)) { g.error = '请先查询这位员工的原请求'; draw(); return false; }
    if (g.room?.room_id !== roomId || !g.roomVerified) {
      g.room = { room_id: roomId, name: rows(g.rooms).find(room => room.room_id === roomId)?.name || '员工协作群' }; g.roomVerified = false;
      g.events = []; g.members = []; g.selectedTargetIds = []; g.cursor = 0; g.hasMore = false; g.content = ''; g.mentionIds = []; g.memberRuns = [];
    }
    g.newGroup = false; state.page = 'group';
    return dispatch('groups', 'read', { groupId: roomId, limit: GROUP_PAGE_SIZE, afterSeq: 0 });
  }
  const actions = {
    'groups-open': () => open(),
    'groups-source': ({ id }) => choose(id),
    'groups-read': () => dispatch('groups', 'list', {}),
    'group-open': ({ id }) => openRoom(id),
    'group-refresh': () => openRoom(ensure().room?.room_id),
    'group-more': () => { const g = ensure(); return g.hasMore ? dispatch('groups', 'read', { groupId: g.room?.room_id, limit: GROUP_PAGE_SIZE, afterSeq: g.cursor }, { afterSeq: g.cursor }) : false; },
    'group-new': () => { const g = ensure(); if (g.busy || g.storageBlocked || pendingFor(g)) return false; g.newGroup = true; g.room = null; g.roomVerified = false; g.events = []; g.members = []; g.selectedTargetIds = []; g.mentionIds = []; g.content = ''; g.error = ''; g.notice = ''; g.phase = 'idle'; g.lastAction = null; g.memberRuns = []; state.page = 'group'; draw(); return true; },
    'group-target': ({ id: targetId }) => { const g = ensure(); if (!g.newGroup || g.busy || g.storageBlocked || pendingFor(g) || !targets(g).some(employee => employee.id === targetId)) return false; g.selectedTargetIds = g.selectedTargetIds.includes(targetId) ? g.selectedTargetIds.filter(id => id !== targetId) : g.selectedTargetIds.length < 5 ? [...g.selectedTargetIds, targetId] : g.selectedTargetIds; g.mentionIds = g.mentionIds.filter(id => id === g.sourceId || g.selectedTargetIds.includes(id)); draw(); return true; },
    'group-mention': ({ id: targetId }) => { const g = ensure(); if (g.busy || g.storageBlocked || pendingFor(g) || ![g.sourceId, ...g.selectedTargetIds].includes(targetId)) return false; g.mentionIds = g.mentionIds.includes(targetId) ? g.mentionIds.filter(id => id !== targetId) : [...g.mentionIds, targetId]; draw(); return true; },
    'group-send': () => dispatch('collaboration', 'message', {}, { sending: true }),
    'group-check': poll,
    'group-retry': poll,
  };
  function change(event) {
    const target = event?.target || event, g = ensure();
    if (target.name === 'groupSource') return choose(String(target.value || ''));
    if (target.name === 'groupContent' && !g.busy && !g.storageBlocked && !pendingFor(g)) { g.content = String(target.value || ''); draw(); return true; }
    return false;
  }
  function reset({ clearAccount = false } = {}) {
    generation++;
    if (clearAccount && lastAccount) {
      try { const keys = []; for (let index = 0; index < storage.length; index++) keys.push(storage.key(index)); for (const key of keys) { try { if (key?.startsWith(prefix) && JSON.parse(key.slice(prefix.length))[0] === lastAccount) storage.removeItem(key); } catch {} } } catch {}
      for (const [key] of registry) { try { if (JSON.parse(key.slice(prefix.length))[0] === lastAccount) registry.delete(key); } catch {} }
      // Host incompatibility is capability evidence, not a pending business
      // request. Logging out cannot turn an unsupported host into a supported one.
    }
    state.groups = null;
  }
  return { open, actions, change, poll, reset, targets: () => targets(ensure()), dispose: () => { disposed = true; generation++; state.groups = null; } };
}
