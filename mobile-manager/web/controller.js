import { accountId, workspaceId, scopeKey, list, id, executionUncertain, initialResources, initialEmployeeResources } from './model.js';
import { createBotSettings } from './bot-settings.js';
import { createDeviceSettings } from './device-settings.js';
import { createChatInbox } from './chat-inbox.js';
import { createForwarding } from './forwarding.js';
import { createChatPreferences } from './chat-preferences.js';
import { searchChatMessages } from './chat-search.js';
import { createMobileGroups } from './mobile-groups.js';
import { createMobileTasks } from './mobile-tasks.js';
import { createMobileNotifications } from './mobile-notifications.js';
import { createNotificationPresence } from './notification-presence.js';

const IMAGE_LIMIT = 10 * 1024 * 1024;
const avatarLimit = 2 * 1024 * 1024;
const botReadWarning = value => [value?.mobileReadError,value?.latest_run?.mobileReadError,
  ...['groups','collaboration'].map(key=>value?.nativeResources?.[key]?.readError||value?.nativeResources?.[key]?.mobileReadError)]
  .find(error=>typeof error?.message==='string'&&error.message)?.message||'';
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
export function createController({ state, api, render = () => {}, storage = globalThis.localStorage, reporting, nativeNotifications = globalThis.ZiweiNotifications } = {}) {
  let epoch = 0, accountGeneration = 0, employeeEpoch = 0, chatReadEpoch = 0, chatConversationId = null, employeeReadEpoch = 0, phoneEpoch = 0, phoneRead = null, disposed = false, timer = null, attachmentEpoch = 0, nativePaused = false;
  const composers = new Map(), pendingMutations = new Set(), routineRequests = new Map(), messageKeys = new Set(), conversationReads = new Map();
  const resourceReads = new Map(), employeeReads = new Map(), employeeWrites = new Map();
  let employeeGets = new AbortController(), chatWriteEpoch = 0;
  const preferences = createChatPreferences({storage}), draftTimers = new Map();
  const notificationPresence = createNotificationPresence({ state, native: nativeNotifications, visible: () => !nativePaused && !globalThis.document?.hidden });
  let preferencesScope = '';
  const localScope = () => ({accountId:accountId(state),workspaceId:workspaceId(state)});
  function syncChatPreferences(force = false) {
    const scope = localScope(), key = JSON.stringify([scope.accountId,scope.workspaceId]);
    if (!force && key === preferencesScope) return;
    preferencesScope = key;
    state.pinnedChatIds = scope.accountId && scope.workspaceId ? preferences.pinnedIds(scope) : [];
    state.chatDraftPreviews = scope.accountId && scope.workspaceId ? preferences.draftPreviews(scope) : {};
    state.chatPreferencesError = scope.accountId && scope.workspaceId ? preferences.status(scope).error : '';
  }
  state.resources ||= initialResources();
  state.employeeResources ||= initialEmployeeResources();
  const workspaceKey = userId => `ziwei.mobile.workspace:${userId}`;
  const messageKey = () => `ziwei.manager.message.v1:${encodeURIComponent(accountId(state))}:${encodeURIComponent(workspaceId(state))}:${encodeURIComponent(state.selectedEmployee?.id || '')}`;
  const current = () => ({ epoch, scope: scopeKey(state), employeeEpoch, employeeId: state.selectedEmployee?.id });
  const valid = (token, employee = false) => !disposed && token.epoch === epoch && token.scope === scopeKey(state) && (!employee || (token.employeeEpoch === employeeEpoch && token.employeeId === state.selectedEmployee?.id));
  const validChat = (token, readEpoch) => valid(token, true) && readEpoch === chatReadEpoch;
  const draw = () => { if (!disposed) { syncChatPreferences(); syncLoading(); notificationPresence.sync(); render(state); } };
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
  const composerKey = () => JSON.stringify([accountId(state),workspaceId(state),state.selectedEmployee?.id || '']);
  function composer() {
    const key = composerKey();
    if (!composers.has(key)) {
      const scope = localScope(), employeeId = state.selectedEmployee?.id || '';
      composers.set(key, { draft:preferences.getDraft(scope,employeeId),attachments:[],request:null,revision:0,scope,employeeId,accountGeneration });
    }
    return composers.get(key);
  }
  function persistComposer(item) {
    const pending = draftTimers.get(item); if (pending) clearTimeout(pending); draftTimers.delete(item);
    if (disposed || item.accountGeneration !== accountGeneration || item.scope.accountId !== accountId(state)) return;
    const result = preferences.saveDraft(item.scope,item.employeeId,item.draft);
    if (item.scope.workspaceId === workspaceId(state)) {
      syncChatPreferences(true);
      if (!result.ok) state.chatPreferencesError = result.error;
    }
    return result;
  }
  function flushDrafts() {
    for (const item of [...draftTimers.keys()]) persistComposer(item);
  }
  function stashComposer(defer = false) {
    if (!state.selectedEmployee || state.page !== 'chat') return;
    const item = composer(); item.draft = state.draft || ''; item.attachments = state.attachments || [];
    if (defer) {
      clearTimeout(draftTimers.get(item));
      const pending = setTimeout(() => { const result=persistComposer(item); if(result&&!result.ok)draw(); },250);
      pending.unref?.(); draftTimers.set(item,pending);
    } else persistComposer(item);
  }
  function restoreComposer() {
    const item = composer(); state.draft = item.draft; state.attachments = item.attachments;
  }
  function renewEmployeeGets() {
    const previous = employeeGets;
    employeeGets = new AbortController();
    previous.abort();
  }
  function clearSelection() {
    employeeEpoch++; chatReadEpoch++; chatWriteEpoch++; phoneEpoch++; attachmentEpoch++;
    renewEmployeeGets();
    chatConversationId = null; forwarding.reset(); state.forwardDetail = null; state.chatReadError = ''; state.chatFind = null; state.chatJump = null;
    conversationReads.clear(); employeeReadEpoch++; employeeReads.clear(); state.employeeResources = initialEmployeeResources();
    state.selectedEmployee = null; state.bot = null; state.conversation = null; state.messages = [];
    state.runs = []; state.routines = []; state.phone = null; state.draft = ''; state.attachments = [];
    state.sending = false; state.attachmentReading = false; state.employeeSaving = false; state.stopBusy = false;
    state.employeeAvatar = undefined; state.phoneLoading = false; state.busy = false; state.task = null; state.chatLoading = false;
  }
  function clearWorkspace() {
    clearSelection(); state.employees = []; state.bots = []; state.tasks = []; state.devices = []; state.phones = [];
    inbox.reset(); groups.reset(); mobileTasks.reset(); notifications.reset(); state.chatSearch = '';
    resourceReads.clear(); employeeWrites.clear(); phoneRead = null; state.resources = initialResources();
    state.report = null; state.reportSelection = []; state.page = 'home'; state.tab = 'chat'; state.imagePreview = null;
    state.phoneCommand = null; state.phoneError = ''; state.loading = false; state.busy = false;
    state.botSettings = null; state.deviceSettings = null; state.settingsTrail = [];
  }
  function requireLogin(message = '', explicitLogout = false) {
    const userId = accountId(state);
    notifications.reset({clearNative:true,clearAccount:explicitLogout});
    if (!explicitLogout) { stashComposer(); flushDrafts(); }
    for (const pending of draftTimers.values()) clearTimeout(pending); draftTimers.clear();
    accountGeneration++;
    reporting?.clear?.(state);
    if (explicitLogout && userId) {
      clearAccountRequests(userId); forwarding.reset({ clearAccount: true }); groups.reset({clearAccount:true});
      const cleared = preferences.clearAccount(userId); if(!cleared.ok)message = cleared.error;
    }
    if (userId) { try { storage?.removeItem(workspaceKey(userId)); } catch {} }
    epoch++; composers.clear(); pendingMutations.clear(); routineRequests.clear(); clearWorkspace();
    state.user = null; state.workspace = null; state.workspaces = []; state.phase = 'login'; state.error = message; state.notice = ''; draw();
  }
  function fail(error, token = current(), employee = false) {
    if (error?.status === 401) { if (valid(token)) requireLogin('登录已过期，请重新登录'); return false; }
    if (!valid(token, employee)) return false;
    state.error = error?.message || '操作未完成，请稍后重试'; draw();
    return false;
  }
  function employeeReadFailed(name, error, token, live) {
    // Session expiry belongs to the account even when a different employee is now open.
    if (error?.status === 401) { if (valid(token)) requireLogin('登录已过期，请重新登录'); return; }
    if (!live()) return;
    const resource = state.employeeResources[name];
    resource.phase = 'error'; resource.error = error?.message || '读取失败，请刷新重试';
    resource.diagnostic = Object.fromEntries(['requestPath','method','elapsedMs','status','code'].filter(key => error?.[key] !== undefined).map(key => [key,error[key]]));
    draw();
  }
  function employeeReadSucceeded(name) {
    Object.assign(state.employeeResources[name], {phase:'ready',error:'',lastUpdated:new Date().toISOString(),diagnostic:null});
  }
  function invalidateEmployeeReads() {
    employeeReadEpoch++; employeeReads.clear();
    for (const name of ['bot','runs','routines']) {
      const resource = state.employeeResources[name];
      if (resource.phase === 'loading') resource.phase = resource.error ? 'error' : resource.lastUpdated ? 'ready' : 'idle';
    }
  }
  const employeeWriteKey = (token, employeeId = token.employeeId) => `${token.epoch}:${token.scope}:${employeeId}`;
  function beginEmployeeWrite(token, employeeId = token.employeeId) {
    const key = employeeWriteKey(token, employeeId);
    let released = false;
    employeeWrites.set(key, (employeeWrites.get(key) || 0) + 1);
    if (state.selectedEmployee?.id === employeeId) invalidateEmployeeReads();
    return () => {
      if (released) return;
      released = true;
      const count = (employeeWrites.get(key) || 0) - 1;
      if (count > 0) employeeWrites.set(key,count); else employeeWrites.delete(key);
      if (valid(token) && state.selectedEmployee?.id === employeeId) invalidateEmployeeReads();
    };
  }
  function readEmployeeResource(name, token, fetchValue, accept) {
    if (!valid(token,true) || employeeWrites.has(employeeWriteKey(token))) return Promise.resolve(false);
    const existing = employeeReads.get(name);
    if (existing && valid(existing.token,true) && existing.generation === employeeReadEpoch) return existing.promise;
    const entry = {token,generation:employeeReadEpoch,signal:employeeGets.signal}; employeeReads.set(name,entry);
    const live = () => valid(token,true) && entry.generation === employeeReadEpoch && employeeReads.get(name) === entry;
    state.employeeResources[name].phase = 'loading'; draw();
    entry.promise = Promise.resolve().then(async () => {
      if (!live()) return false;
      try {
        const value = await fetchValue({ signal:entry.signal });
        if (!live()) return false;
        const warning=accept(value); employeeReadSucceeded(name);
        if(typeof warning==='string'&&warning)Object.assign(state.employeeResources[name],{phase:'error',error:warning});
        draw(); return true;
      } catch (error) { employeeReadFailed(name,error,token,live); return false; }
      finally { if (employeeReads.get(name) === entry) employeeReads.delete(name); }
    });
    return entry.promise;
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
  function invalidateResources(...names) {
    for (const name of names) {
      resourceReads.delete(name);
      const resource = state.resources[name];
      if (resource?.phase === 'loading') resource.phase = resource.lastUpdated ? 'ready' : 'idle';
    }
  }
  function acceptSavedBot(bot) {
    invalidateResources('employees', 'bots');
    if (state.selectedEmployee?.id === (bot.employee_id || bot.id)) invalidateEmployeeReads();
    acceptBot(bot);
  }
  const botSettings = createBotSettings({ state, api, current, valid, fail, draw, acceptBot: acceptSavedBot });
  const deviceSettings = createDeviceSettings({ state, api, current, valid, fail, draw });
  const inbox = createChatInbox({ state, api, current, valid, draw, fail,
    canMarkVisible: () => !nativePaused && !globalThis.document?.hidden && !state.forward && !state.forwardDetail && !state.imagePreview && !state.chatFind,
  });
  const forwarding = createForwarding({ state, api, current, valid, draw, fail, storage,
    onAccepted: (_result, { token }) => { if (valid(token)) { inbox.invalidate(); void inbox.load(token); } },
    onOpenTarget: ({ employeeId, conversationId }) => {
      if (typeof conversationId !== 'string' || !conversationId.trim()) return fail(new Error('转发回执未提供目标聊天，请刷新后核对'));
      return openEmployee(employeeId, 'chat', { conversationId });
    },
  });
  const groups = createMobileGroups({state,api,current,valid,draw,fail,storage});
  const mobileTasks = createMobileTasks({state,api,current,valid,draw,fail,
    onSaved: (_task, token) => { if(valid(token))invalidateResources('tasks'); },
  });
  const notifications = createMobileNotifications({state,api,current,valid,draw,fail,storage,native:nativeNotifications,
    onPendingPush: token => {
      if (!valid(token)) return;
      stashComposer(); clearSelection(); state.page = 'notifications'; state.tab = 'me'; draw();
    },
    onTarget: async (item,token) => {
      if(!valid(token))return false;
      const target=item.target;
      if(target.kind==='conversation') {
        if(!state.employees.some(row=>row.id===target.employeeId))await readWorkspaceResource('employees',token);
        if(!valid(token))return false;
        await openEmployee(target.employeeId,'chat',{conversationId:target.id});
        if(!valid(token)||state.conversation?.id!==target.id||state.page!=='chat')return false;
        if(target.messageId&&state.messages.some(row=>row.id===target.messageId)) {
          state.chatJump={conversationId:target.id,messageId:target.messageId,quoteIndex:null,serial:id()};draw();
        }
        return true;
      }
      const detail=await api.task(target.id);
      if(!valid(token))return false;
      if(detail?.id!==target.id||detail.workspace_id&&detail.workspace_id!==state.workspace?.id)throw new Error('工作详情与提醒归属不一致，请重新读取');
      stashComposer();clearSelection();state.task=detail;state.tab='work';state.page='task';state.error='';draw();return true;
    },
    onWorkspaceTarget: async (pending,token) => {
      if(!valid(token)||accountId(state)!==pending.accountId)return false;
      const workspace=state.workspaces.find(row=>row.slug===pending.workspaceSlug&&row.id===pending.workspaceId);
      if(!workspace)throw new Error('提醒所属工作区当前不可查看');
      await chooseWorkspace(workspace);
      if(accountId(state)!==pending.accountId||workspaceId(state)!==pending.workspaceSlug)return false;
      return notifications.resolvePending(pending);
    },
  });
  function primaryResource() { return ['phones', 'devices'].includes(state.tab) || state.page === 'phone' ? 'devices' : ['work', 'tasks'].includes(state.tab) ? 'tasks' : state.tab === 'chat' ? 'chats' : 'employees'; }
  function syncLoading() { state.loading = (primaryResource() === 'chats' ? state.chatThreadsResource : state.resources[primaryResource()])?.phase === 'loading'; }
  function readWorkspaceResource(name, token = current()) {
    if (!valid(token)) return Promise.resolve(false);
    // A pending mutation owns these rows until its authoritative response is accepted.
    if (['employees', 'bots'].includes(name) && (state.employeeSaving || state.stopBusy || (state.page === 'bot-settings' && state.botSettings?.saving))) return Promise.resolve(false);
    if (name === 'tasks' && (state.page === 'task' && state.busy || state.mobileTaskForm?.saving)) return Promise.resolve(false);
    const existing = resourceReads.get(name);
    if (existing && valid(existing.token)) return existing.promise;
    const workspace = workspaceId(state), resource = state.resources[name] ||= {phase:'idle',error:'',lastUpdated:null};
    const entry = {token};
    resourceReads.set(name, entry);
    resource.phase = 'loading'; resource.error = ''; syncLoading(); draw();
    entry.promise = Promise.resolve().then(() => api[name](workspace)).then(result => {
      if (!valid(token) || resourceReads.get(name) !== entry) return false;
      const values = list(result, name);
      let partialError='';
      if (name === 'employees') {
        state.employees = mergeEmployees(values);
        if (state.selectedEmployee) state.selectedEmployee = state.employees.find(employee => employee.id === state.selectedEmployee.id) || state.selectedEmployee;
      } else if (name === 'bots') {
        const previous=new Map(state.bots.map(bot=>[bot.id,bot])),accepted=[];
        for(const value of values) {
          if(value?.resourceState==='unavailable') {
            partialError='部分员工运行状态暂时无法读取，已保留上次状态；请进入员工页核对';
            if(previous.has(value.id))accepted.push(previous.get(value.id));
          } else {accepted.push(value);partialError ||= botReadWarning(value);}
        }
        state.bots = accepted; state.employees = mergeEmployees();
        if (state.selectedEmployee) state.selectedEmployee = state.employees.find(employee => employee.id === state.selectedEmployee.id) || state.selectedEmployee;
      } else state[name] = values;
      resource.phase = partialError?'error':'ready'; resource.error = partialError; resource.lastUpdated = new Date().toISOString();
      state.lastRefreshed = resource.lastUpdated;
      syncLoading(); draw(); return true;
    }).catch(error => {
      if (!valid(token) || resourceReads.get(name) !== entry) return false;
      if (error?.status === 401) requireLogin('登录已过期，请重新登录');
      else { resource.phase = 'error'; resource.error = error?.message || '读取失败，请刷新重试'; syncLoading(); draw(); }
      return false;
    }).finally(() => { if (resourceReads.get(name) === entry) resourceReads.delete(name); });
    return entry.promise;
  }
  async function refresh({ silent = false } = {}) {
    if (disposed || nativePaused || globalThis.document?.hidden || !state.user || !workspaceId(state) || state.phase !== 'ready') return false;
    const token = current(), primary = primaryResource();
    void groups.poll();
    if(typeof api.mobileNotifications==='function')void notifications.poll();
    if (!silent) draw();
    // The inbox has its own lifecycle. A slow index cannot hold employee/history reads open.
    void inbox.load(token);
    const employees = readWorkspaceResource('employees', token);
    // The initial employee response is useful on its own. Full Bot histories are supplementary.
    void employees.then(ok => {
      if (ok && valid(token) && state.page === 'home' && state.tab === 'employees') return readWorkspaceResource('bots', token);
    });
    const primaryWork = primary === 'chats' ? Promise.resolve() : primary === 'employees' ? employees : readWorkspaceResource(primary, token);
    const chatWork = state.page === 'chat' ? readChat(token) : Promise.resolve();
    if (['chat', 'detail', 'employee-detail'].includes(state.page)) void refreshEmployee(token, {skipConversation:true});
    const settingsWork = state.page === 'bot-settings' ? botSettings.load() : state.page === 'device-settings' ? deviceSettings.load() : Promise.resolve();
    if (['phones', 'devices'].includes(state.tab) || state.page === 'phone') void refreshPhones(token).then(() => { if (valid(token)) draw(); }).catch(error => fail(error, token));
    try {
      await Promise.all([primaryWork, chatWork, settingsWork]);
      if (!valid(token)) return false;
      if (state.page.startsWith('report') && state.report?.status !== 'selecting') await reporting?.refresh?.(state);
      return true;
    } catch (error) { return fail(error, token); }
    finally { if (valid(token)) { syncLoading(); draw(); } }
  }
  function readChat(token = current()) {
    const employee = state.selectedEmployee;
    if (!employee || state.page !== 'chat' || state.sending || !valid(token, true)) return Promise.resolve();
    const readEpoch = chatReadEpoch;
    const options = { signal:employeeGets.signal };
    const key = `${token.epoch}:${token.scope}:${token.employeeEpoch}:${employee.id}:${readEpoch}`;
    if (conversationReads.has(key)) return conversationReads.get(key);
    const workspace = workspaceId(state), initial = !state.conversation?.id;
    const cachedBot = state.bot?.id === employee.id ? state.bot : employee.bot;
    const conversationId = state.conversation?.id || chatConversationId || cachedBot?.main_conversation_id || employee.main_conversation_id;
    state.employeeResources.conversation.phase = 'loading';
    if (initial) state.chatLoading = true;
    draw();
    const request = (async () => {
      try {
        // A cached authoritative main ID needs no Bot round-trip. Failed reads never create a replacement.
        if (initial && !conversationId && cachedBot?.configuration_state === 'initialized' && !cachedBot.main_conversation_id) throw new Error('这位员工的主聊天尚未就绪，请在电脑版核对');
        const conversation = conversationId ? await api.conversation(conversationId, options) : await api.getEmployeeConversation(workspace, { ...employee, ...(cachedBot ? { bot: cachedBot } : {}) }, options);
        if (!validChat(token, readEpoch)) return;
        if (conversation.employee_id && conversation.employee_id !== employee.id) throw new Error('聊天与当前员工身份不一致，请刷新核对');
        state.conversation = conversation; state.messages = conversation.messages || [];
        forwarding.synchronize();
        employeeReadSucceeded('conversation');
        state.chatLoading = false;
        if (initial) state.busy = false;
        draw();
      } catch (error) { employeeReadFailed('conversation',error,token,() => validChat(token,readEpoch)); }
      finally {
        if (validChat(token, readEpoch) && initial) { state.chatLoading = false; state.busy = false; draw(); }
      }
    })();
    conversationReads.set(key, request);
    void request.finally(() => { if (conversationReads.get(key) === request) conversationReads.delete(key); });
    return request;
  }
  async function refreshEmployee(token = current(), { skipConversation = false } = {}) {
    const employee = state.selectedEmployee;
    if (!employee || !valid(token, true)) return;
    const workspace = workspaceId(state), cachedBot = state.bot?.id === employee.id ? state.bot : employee.bot;
    const hasBot = cachedBot?.configuration_state === 'initialized';
    const read = (name, fetchValue, accept) => readEmployeeResource(name,token,fetchValue,accept);
    const work = !skipConversation && state.page === 'chat' ? [readChat(token)] : [];
    const readRuns = () => read('runs',options => api.botRuns(workspace, employee.id, options), value => { state.runs = list(value, 'runs'); });
    const readRoutines = () => read('routines',options => api.botRoutines(workspace, employee.id, options), value => { state.routines = list(value, 'routines'); });
    if (hasBot) work.push(readRuns(), readRoutines());
    if (employee.runtime === 'Hermes' || cachedBot) work.push(read('bot',options => api.bot(workspace, employee.id, options), bot => {
      if(bot?.resourceState==='unavailable')throw new Error(bot.readError?.message||'员工运行状态暂时无法读取，请保留原记录核对');
      if (bot) acceptBot(bot);
      return botReadWarning(bot);
    }).then(async ok => {
      // The first read can discover an initialized Bot that was not in the employee cache.
      if (ok && valid(token, true) && !hasBot && state.bot?.configuration_state === 'initialized') await Promise.all([readRuns(), readRoutines()]);
    }));
    await Promise.all(work);
  }
  function refreshPhones(token = current()) {
    if (!valid(token)) return Promise.resolve();
    if (!canUsePhones()) { state.phones = []; state.phone = null; state.phoneError = '手机互联需要工作区 Owner 或管理员权限'; state.resources.phones = {phase:'error',error:state.phoneError,lastUpdated:null}; draw(); return Promise.resolve(); }
    const workspace = workspaceId(state), phoneId = state.page === 'phone' ? state.phone?.id : '', visit = phoneEpoch, commandId = state.phoneCommand?.id || '';
    const key = `${token.epoch}:${token.scope}:${visit}:${phoneId}:${commandId}`;
    if (phoneRead?.key === key) return phoneRead.promise;
    const entry = {key}; phoneRead = entry;
    const live = () => valid(token) && phoneRead === entry && visit === phoneEpoch && (!phoneId || (state.page === 'phone' && state.phone?.id === phoneId));
    const resource = state.resources.phones;
    resource.phase = 'loading'; resource.error = ''; draw();
    entry.promise = (async () => { try {
      const result = await api.phones(workspace);
      if (!live()) return;
      state.phones = list(result, 'devices'); state.phoneError = '';
      resource.phase = 'ready'; resource.lastUpdated = new Date().toISOString(); draw();
      if (phoneId) {
        const [detail, snapshot] = await Promise.all([api.phone(workspace, phoneId, commandId), api.phoneSnapshot(workspace, phoneId)]);
        if (!live()) return;
        state.phone = { ...(detail.device || {}), snapshot: snapshot.snapshot || null };
        if (state.phoneCommand) {
          const receipt = state.phone.commands?.find(command => command.id === state.phoneCommand.id);
          if (receipt) state.phoneCommand = receipt;
        }
        draw();
      }
    } catch (error) {
      if (error?.status === 401) throw error;
      if (live()) { state.phoneError = error.message; resource.phase = 'error'; resource.error = error.message; draw(); }
    } finally { if (phoneRead === entry) phoneRead = null; } })();
    return entry.promise;
  }
  async function chooseWorkspace(workspace) {
    if (!workspace) throw new Error('工作区不存在或尚未授权');
    stashComposer(); epoch++; clearWorkspace(); state.workspace = workspace;
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
    if(state.phase==='ready')void notifications.handleNative();
  }
  function enterEmployeePage(employeeId, page, busy = true, { conversationId } = {}) {
    const thread = state.chatThreads?.find(item => item.employeeId === employeeId && item.employee?.id === employeeId);
    const employee = state.employees.find(item => item.id === employeeId) || thread?.employee;
    if (!employee) throw new Error('这位员工不在当前工作区中，请刷新');
    stashComposer(); clearSelection(); state.selectedEmployee = employee;
    if (page === 'chat') chatConversationId = conversationId || thread?.conversationId || null;
    state.bot = employee.bot || state.bots.find(bot => (bot.employee_id || bot.id) === employeeId) || null;
    state.page = page; state.error = ''; state.busy = busy; state.chatLoading = page === 'chat'; restoreComposer(); draw();
    return current();
  }
  async function openEmployee(employeeId, page, options) {
    const token = enterEmployeePage(employeeId, page, true, options);
    try {
      if (page === 'chat') {
        const primary = readChat(token);
        // These reads handle their own errors and scope guards; none may delay history or typing.
        void refreshEmployee(token, { skipConversation: true });
        await primary;
      } else await refreshEmployee(token, { skipConversation: true });
    } catch (error) { fail(error, token, true); }
    finally { if (valid(token, true)) { state.busy = false; state.chatLoading = false; draw(); } }
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
    const sendEpoch = ++chatWriteEpoch;
    const validSend = () => valid(token, true) && sendEpoch === chatWriteEpoch;
    chatReadEpoch++;
    conversationReads.clear();
    const primaryResource = state.employeeResources.conversation;
    if (primaryResource.phase === 'loading') primaryResource.phase = primaryResource.error ? 'error' : primaryResource.lastUpdated ? 'ready' : 'idle';
    const finishWrite = beginEmployeeWrite(token);
    state.sending = true; state.error = ''; draw();
    try {
      const fingerprintHash = await digest(fingerprint);
      if (!validSend()) return;
      let stored = null;
      try { stored = JSON.parse(storeGet(requestKey) || 'null'); } catch {}
      if (item.request?.fingerprintHash !== fingerprintHash) {
        item.request = { conversationId, fingerprintHash, clientMessageId: stored?.conversationId === conversationId && stored?.fingerprintHash === fingerprintHash ? stored.clientMessageId : id() };
      }
      const request = item.request;
      // Store only a hash and request identity, never the message or its image bytes.
      persistMessage(requestKey, request);
      await api.sendMessage(conversationId, { content, attachments, clientMessageId: request.clientMessageId });
      if (valid(token)) { inbox.invalidate(); void inbox.load(token); }
      // A different employee may now be open. Complete only the original composer's draft.
      if (item.request === request) {
        if (item.revision === revision) { item.draft = ''; item.attachments = []; persistComposer(item); }
        item.request = null;
      }
      try {
        if (JSON.parse(storeGet(requestKey) || 'null')?.clientMessageId === request.clientMessageId) storage?.removeItem(requestKey);
      } catch {}
      if (!validSend()) return;
      restoreComposer();
      finishWrite();
      if (nativePaused || globalThis.document?.hidden) return;
      const readEpoch = chatReadEpoch, options = { signal:employeeGets.signal };
      state.employeeResources.conversation.phase = 'loading';
      try {
        const conversation = await api.conversation(conversationId, options);
        if (validChat(token, readEpoch)) { state.conversation = conversation; state.messages = conversation.messages || []; forwarding.synchronize(); employeeReadSucceeded('conversation'); }
      } catch (error) { employeeReadFailed('conversation',error,token,() => validChat(token,readEpoch)); }
    } catch (error) { if (error?.status === 401 || validSend()) fail(error, token, true); }
    finally { finishWrite(); if (validSend()) { state.sending = false; draw(); } }
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
    const finishWrite = beginEmployeeWrite(token);
    invalidateResources('employees', 'bots'); state.employeeSaving = true; state.error = ''; draw();
    try {
      if (state.bot?.configuration_state === 'initialized') {
        const bot = await api.updateBot(workspace, employee.id, { expectedRevision: state.bot.revision, employee: body });
        if (valid(token, true)) acceptSavedBot(bot);
      } else {
        const saved = await api.updateEmployee(workspace, employee.id, body);
        if (valid(token, true)) { state.employees = state.employees.map(row => row.id === employee.id ? { ...row, ...saved } : row); state.selectedEmployee = state.employees.find(row => row.id === employee.id); }
      }
      if (valid(token, true)) { state.employeeAvatar = undefined; state.notice = '已保存'; }
    } catch (error) { fail(error, token, true); }
    finally { finishWrite(); if (valid(token, true)) { invalidateResources('employees', 'bots'); state.employeeSaving = false; syncLoading(); draw(); } }
  }
  async function mutateRoutine(routineId, run = false) {
    if (!state.selectedEmployee || !routineId) throw new Error('请先选择例行工作');
    const token = current(), workspace = workspaceId(state), employeeId = state.selectedEmployee.id, key = `${scopeKey(state)}:${employeeId}:routine:${routineId}`;
    if (pendingMutations.has(key)) return;
    const routine = state.routines.find(item => item.id === routineId || item.automation_id === routineId);
    if (!routine) throw new Error('例行工作已变化，请刷新');
    const finishWrite = beginEmployeeWrite(token);
    pendingMutations.add(key); state.busy = true; state.error = ''; draw();
    try {
      if (run) {
        if (!routineRequests.has(key)) routineRequests.set(key, id());
        await api.runRoutine(workspace, employeeId, routineId, { idempotencyKey: routineRequests.get(key) });
        routineRequests.delete(key);
      }
      else await api.updateRoutine(workspace, employeeId, routineId, { status: routine.status === 'active' ? 'paused' : 'active' });
      finishWrite();
      if (valid(token, true)) { await refreshEmployee(token); state.notice = run ? '已提交运行请求，请查看实际回执' : '例行工作已更新'; }
    } catch (error) { fail(error, token, true); }
    finally { finishWrite(); pendingMutations.delete(key); if (valid(token, true)) { state.busy = false; draw(); } }
  }
  async function saveTask(form) {
    const task = state.task;
    if (!task || state.busy) return;
    const token = current(), title = String(form.get('title') || '').trim(), description = String(form.get('description') || '');
    if (!title) throw new Error('请输入任务名称');
    invalidateResources('tasks'); state.busy = true; state.error = ''; draw();
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
    finally { if (valid(token)) { invalidateResources('tasks'); state.busy = false; syncLoading(); draw(); } }
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
    const finishWrite = beginEmployeeWrite(token);
    state.busy = true; state.error = ''; draw();
    try {
      await api.createRoutine(workspace, employeeId, { ...input, idempotencyKey: request.idempotencyKey });
      routineRequests.delete(key);
      finishWrite();
      if (valid(token, true)) { state.notice = '例行工作已保存'; await refreshEmployee(token); }
    } catch (error) { fail(error, token, true); }
    finally { finishWrite(); if (valid(token, true)) { state.busy = false; draw(); } }
  }
  const actions = {
    navigate: action(async ({ tab }) => {
      if (!['chat', 'employees', 'work', 'tasks', 'phones', 'devices', 'me'].includes(tab)) return;
      stashComposer(); clearSelection(); state.settingsTrail = []; state.tab = tab; state.page = 'home'; state.error = ''; draw();
      await refresh({ silent: true });
    }),
    back: action(async () => {
      if (state.imagePreview) { state.imagePreview = null; draw(); return; }
      if (state.forwardDetail) { state.forwardDetail = null; draw(); return; }
      if (state.chatFind) { state.chatFind = null; draw(); return; }
      if (state.forward) { await forwarding.actions['forward-back'](); return; }
      if (state.page === 'group') { state.page='groups';draw();return; }
      if (['settings', 'bot-settings', 'device-settings'].includes(state.page)) {
        const previous = state.settingsTrail?.pop() || { page: 'home', tab: 'me' };
        stashComposer(); clearSelection(); state.error = ''; state.tab = previous.tab || state.tab;
        if (['detail', 'bot-settings'].includes(previous.page) && previous.employeeId) {
          if (previous.page === 'detail') await openEmployee(previous.employeeId, 'detail');
          else { enterEmployeePage(previous.employeeId, 'bot-settings', false); await botSettings.load(); }
        } else {
          state.page = previous.page || 'home'; draw();
          if (state.page === 'device-settings') await deviceSettings.load();
        }
        return;
      }
      stashComposer(); clearSelection(); state.settingsTrail = []; state.page = 'home'; state.phase = workspaceId(state) ? 'ready' : 'workspace'; state.error = ''; draw();
    }),
    refresh: action(() => state.page === 'bot-settings' ? botSettings.load() : state.page === 'device-settings' ? deviceSettings.load() : refresh()),
    'switch-workspace': action(() => { stashComposer(); clearSelection(); state.phase = 'workspace'; state.page = 'workspaces'; draw(); }),
    'select-workspace': action(({ id: slug }) => chooseWorkspace(state.workspaces.find(item => item.slug === slug || item.workspace_id === slug))),
    chat: action(({ id: employeeId }) => { state.settingsTrail = []; return openEmployee(employeeId, 'chat'); }),
    'chat-pin': action(({id:conversationId=state.conversation?.id}) => {
      if (!state.chatThreads.some(thread=>thread.conversationId===conversationId) && state.conversation?.id!==conversationId) return false;
      const result=preferences.togglePin(localScope(),conversationId);syncChatPreferences(true);
      if(!result.ok)state.chatPreferencesError=result.error;
      draw();return result.accepted;
    }),
    'chat-find-open': action(() => {
      if(state.page!=='chat'||!state.conversation?.id||state.forward)return false;
      state.chatFind={query:''};draw();return true;
    }),
    'chat-find-close': action(() => { state.chatFind=null;draw(); }),
    'chat-find-result': action(({id:messageId}) => {
      if(state.page!=='chat'||!state.chatFind)return false;
      const found=searchChatMessages(state.messages,state.chatFind.query).results.find(item=>item.messageId===messageId);
      if(!found)return false;
      state.chatFind=null;
      if(found.source==='forward')state.forwardDetail={messageId:found.messageId};
      state.chatJump={conversationId:state.conversation.id,messageId:found.messageId,quoteIndex:found.quoteIndex,serial:id()};
      draw();return true;
    }),
    'mark-thread-read': action(({ conversationId, messageId }) => {
      if (nativePaused || globalThis.document?.hidden || state.forward || state.forwardDetail || state.imagePreview || state.chatFind) return false;
      return inbox.markVisible({ conversationId, messageId });
    }),
    ...forwarding.actions,
    ...Object.fromEntries(Object.entries(groups.actions).map(([name, fn]) => [name, action(fn)])),
    'groups-open': action(async () => { stashComposer();clearSelection();await groups.open(); }),
    'groups-settings': action(async ({id:employeeId}) => {
      if(state.groups?.busy)return false;
      rememberSettingsPage();enterEmployeePage(employeeId,'bot-settings',false);await botSettings.load();
    }),
    ...Object.fromEntries(Object.entries(mobileTasks.actions).map(([name, fn]) => [name, action(fn)])),
    'mobile-task-new': action(() => { stashComposer();clearSelection();return mobileTasks.open(); }),
    ...Object.fromEntries(Object.entries(notifications.actions).map(([name, fn]) => [name, action(fn)])),
    'notifications-open': action(() => { stashComposer();clearSelection();return notifications.open(); }),
    'forward-detail': action(({ id: messageId }) => {
      if (state.page !== 'chat' || !state.conversation?.id) return false;
      const message = state.messages.find(item => item.id === messageId);
      if (message?.forward?.schemaVersion !== 1 || !Array.isArray(message.forward.messages)) return false;
      state.forwardDetail = { messageId }; draw(); return true;
    }),
    'forward-detail-close': action(() => { state.forwardDetail = null; draw(); }),
    'employee-detail': action(({ id: employeeId }) => { state.settingsTrail = []; return openEmployee(employeeId, 'detail'); }),
    settings: action(() => {
      rememberSettingsPage(); stashComposer(); clearSelection(); state.page = 'settings'; state.error = ''; draw();
    }),
    'bot-settings': action(async ({ id: employeeId }) => {
      rememberSettingsPage(); enterEmployeePage(employeeId, 'bot-settings', false); await botSettings.load();
    }),
    'device-settings': action(async () => {
      rememberSettingsPage(); stashComposer(); clearSelection(); state.page = 'device-settings'; state.error = ''; draw(); await deviceSettings.load();
    }),
    ...Object.fromEntries(Object.entries(botSettings.actions || {}).map(([name, fn]) => [name, action(fn)])),
    ...Object.fromEntries(Object.entries(deviceSettings.actions || {}).map(([name, fn]) => [name, action(fn)])),
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
      const finishWrite = beginEmployeeWrite(token, employeeId);
      pendingMutations.add(key); invalidateResources('employees', 'bots'); state.stopBusy = true; state.error = ''; draw();
      try {
        const bot = await api.bot(workspace, employeeId);
        if (!valid(token)) return;
        if (bot.configuration_state !== 'initialized') throw new Error('这位员工尚未提供手机端停止入口，请在电脑版处理');
        const result = await api.controlBot(workspace, employeeId, { operation: 'stop', expectedRevision: bot.revision, expectedControlEpoch: bot.control_epoch });
        finishWrite();
        if (valid(token)) acceptSavedBot(result);
        if (valid(token,true)) { state.notice = '停止请求已提交，以电脑回执为准'; await refresh({ silent: true }); }
      } catch (error) { fail(error, token); }
      finally { finishWrite(); pendingMutations.delete(key); if (valid(token,true)) { invalidateResources('employees', 'bots'); state.stopBusy = false; syncLoading(); draw(); } }
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
    'routine-toggle': action(({ id: routineId }) => mutateRoutine(routineId)),
    'routine-run': action(({ id: routineId }) => mutateRoutine(routineId, true)),
  };
  function rememberSettingsPage() {
    state.settingsTrail ||= [];
    state.settingsTrail.push({ page: state.page, tab: state.tab, employeeId: state.selectedEmployee?.id });
  }
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
      } else if (name === 'forward') await forwarding.submit(data);
      else if (name === 'chat') await sendChat(data);
      else if (name === 'employee') await saveEmployee(data);
      else if (name === 'routine') {
        const routineId = String(data.get('routineId') || data.get('id') || '');
        if (routineId) await mutateRoutine(routineId, true); else await createRoutine(data);
      }
      else if (name === 'task') await saveTask(data);
      else if (name === 'mobile-task') await mobileTasks.submit(data);
      else if (name === 'bot-settings') await botSettings.submit(data);
      else if (name === 'bot-phone-mcp') await botSettings.submitPhone(data);
      else if (['device-pairing', 'device-binding', 'device-phone-control'].includes(name)) await deviceSettings.submit(name, data);
    } catch (error) { fail(error, token); }
    finally { if (!disposed && name === 'login') { state.busy = false; draw(); } }
  }
  async function change(event) {
    const target = event?.target || event;
    if (!target) return;
    if (forwarding.change(event)) return;
    if (mobileTasks.change(event)) return;
    if (['groups','group'].includes(state.page)) { await groups.change(event);return; }
    if (state.page === 'bot-settings') { await botSettings.change(event); return; }
    if (state.page === 'device-settings') { await deviceSettings.change(event); return; }
    if (target.name === 'search') { state.search = target.value; draw(); return; }
    if (target.name === 'chatSearch') { state.chatSearch = String(target.value || ''); draw(); return; }
    if (target.name === 'chatFind' && state.chatFind) { state.chatFind.query = String(target.value || ''); draw(); return; }
    if (['message','content','draft'].includes(target.name)) { state.draft = target.value; if (state.selectedEmployee && state.page === 'chat') { stashComposer(true); composer().revision++; } return; }
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
  const resume = () => { nativePaused = false; if (!disposed) {void refresh({ silent: true });if(state.phase==='ready')void notifications.handleNative();} };
  const notificationEvent = event => { if(!disposed&&!nativePaused&&state.phase==='ready')void notifications.handleNative(event?.detail); };
  const pause = () => {
    if (disposed || nativePaused) return;
    stashComposer(); flushDrafts();
    nativePaused = true;
    notificationPresence.pause();
    notifications.pause?.();
    chatReadEpoch++; conversationReads.clear(); invalidateEmployeeReads(); renewEmployeeGets();
    const resource = state.employeeResources.conversation;
    if (resource.phase === 'loading') resource.phase = resource.error ? 'error' : resource.lastUpdated ? 'ready' : 'idle';
    state.chatLoading = false;
    if (state.page === 'chat') state.busy = false;
  };
  const visibility = () => { if (globalThis.document?.hidden) pause(); else resume(); };
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
    globalThis.addEventListener?.('ziwei:notifications', notificationEvent);
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
    stashComposer(); flushDrafts();
    for (const pending of draftTimers.values()) clearTimeout(pending); draftTimers.clear();
    disposed = true; epoch++; clearInterval(timer); timer = null; composers.clear(); pendingMutations.clear(); routineRequests.clear(); resourceReads.clear(); employeeReads.clear(); employeeWrites.clear(); phoneRead = null;
    employeeGets.abort();
    botSettings.dispose?.(); deviceSettings.dispose?.();
    inbox.dispose(); forwarding.dispose(); groups.dispose(); mobileTasks.dispose(); notifications.dispose(); notificationPresence.dispose();
    globalThis.document?.removeEventListener('visibilitychange', visibility);
    globalThis.removeEventListener?.('ziwei:resume', resume);
    globalThis.removeEventListener?.('ziwei:pause', pause);
    globalThis.removeEventListener?.('ziwei:notifications', notificationEvent);
  }
  return { actions, submit, change, refresh, boot, dispose };
}
