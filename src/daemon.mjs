import {executionBinding} from './execution-admission.mjs';
import {markMaintenancePaused,consumeMaintenancePaused,validateMaintenancePause} from './maintenance-checkpoint.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {actionExecutionTimeoutMs,ACTION_EXECUTION_LEASE_BUFFER_MS} from './action-execution-budget.mjs';
import {consumeRuntimePrelaunchEvidence,completeRuntimeExit} from './runtime-launch-evidence.mjs';
import {markDispatcherAdmissionRejected,consumeDispatcherAdmissionRejected,isDispatcherAdmissionRejected} from './dispatcher-admission-evidence.mjs';
import { isNativeRuntimeAction, resolveWindowsWorkdir, resolveWindowsWorkdirPath } from './windows-workdir.mjs';

function needsNativeCwd(action) {
  if (process.platform === 'win32') return isNativeRuntimeAction(action);
  const type = String(action?.type || '').toLowerCase();
  return ['agent.execute', 'conversation.execute', 'runtime.execute'].includes(type)
    || (type === 'task.execute' && (action?.payload?.runtime || action?.payload?.agent));
}

// Convert raw CLI chunks into a small, auditable stage label. The chunk itself
// is never sent to the UI: model reasoning and prompt contents stay private.
function classifyOutputStage(chunk) {
  const text = String(chunk || '').toLowerCase();
  if (/compact|compaction|context window|上下文|token/.test(text)) return { stage: 'context', message: '处理上下文', detail: '上下文窗口整理' };
  if (/mcp|plugin|tool|function[_ -]?call|browser|search|apply[_ -]?patch/.test(text)) return { stage: 'tool', message: '调用工具', detail: 'CLI 工具活动' };
  if (/command|shell|powershell|cmd(?:\.exe)?|bash|\b(?:rg|git|npm|pnpm|yarn|node|test|build|lint)\b|get-content|set-content|cat\s|ls\s|dir\s|running\s+command/.test(text)) return { stage: 'command', message: '运行命令', detail: 'CLI 命令活动' };
  return { stage: 'response', message: '生成结果', detail: 'CLI 输出' };
}

function safeProcessExit(value,depth=0) {
  if (!value || typeof value !== 'object' || depth>4) return null;
  const result = {};
  for (const key of ['launched', 'rootConfirmed', 'treeConfirmed', 'cancelled', 'backgroundProcessesRetained']) if (typeof value[key] === 'boolean') result[key] = value[key];
  for (const key of ['rootPid', 'rootExitCode', 'activeProcesses', 'hostExitCode']) if (value[key] === null || Number.isSafeInteger(value[key])) result[key] = value[key];
  for (const key of ['platform', 'supervisor', 'failureCode', 'signal', 'hostSignal']) if (typeof value[key] === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value[key])) result[key] = value[key];
  if(value.supervisor==='runtime-group'&&Array.isArray(value.children)&&value.children.length<=64)result.children=value.children.map(child=>safeProcessExit(child,depth+1));
  return result;
}

export class ActionDispatcher {
  #completed = new Map();
  #completedIdentity = new Map();
  #admissionRejected = new Map();
  #residentExits = new Map();
  #legacyCompleted = new Set();
  #started = new Map();
  #inFlight = new Map();
  #controllers = new Map();
  #stopHandlers = new Map();
  #maintenanceControls=new Map();
  #maintenanceRequests=new Map();
  #maintenanceActions=new Map();
  #maintenanceCommitted=new Set();
  #authorizeResume;
  #onMaintenancePaused;
  #execute;
  #authorizeExecute;
  #now;
  #workdir;
  #onEvent;
  #stateFile;
  #stateError = null;
  #workspace;
  #deviceId;
  #stopGraceMs;
  #canExecute;
  #quarantines = new Set();
  constructor({execute, authorizeExecute = async()=>{}, now = () => Date.now(), workdir = process.cwd(), onEvent = () => {}, stateFile = null, workspace = '', deviceId = '', stopGraceMs = 10000, canExecute = () => true,authorizeResume=async()=>false,onMaintenancePaused=async()=>false} = {}) {
    if (typeof execute !== 'function') throw new TypeError('ActionDispatcher requires an execute function');
    this.#execute = execute; this.#now = now; this.#workdir = process.platform === 'win32' ? resolveWindowsWorkdirPath(process.cwd(), workdir) : path.resolve(workdir); this.#onEvent = onEvent;
    this.#authorizeExecute=authorizeExecute;
    if(typeof authorizeResume!=='function'||typeof onMaintenancePaused!=='function')throw new TypeError('Invalid maintenance callbacks');
    this.#authorizeResume=authorizeResume;this.#onMaintenancePaused=onMaintenancePaused;
    this.#workspace = String(workspace || ''); this.#deviceId = String(deviceId || '');
    this.#stopGraceMs = Math.max(1, Number(stopGraceMs) || 10000); this.#canExecute = canExecute;
    this.#stateFile = stateFile ? path.resolve(stateFile) : null; this.#loadState();
  }
  #loadState() {
    if (!this.#stateFile) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.#stateFile, 'utf8'));
      if (![1, 2].includes(parsed?.version) || !Array.isArray(parsed.completed) || (parsed.version === 2 && !Array.isArray(parsed.started))) throw new Error('Invalid action state structure');
      const validIdentity = value => value === undefined || (value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(item => typeof item === 'string'));
      const completed = new Map(); const identities = new Map(); const admissions = new Map(); const legacy = new Set(); const started = new Map();
      for (const item of parsed.completed) {
        if (!item || typeof item.key !== 'string' || !item.key || !item.result || !['succeeded', 'failed'].includes(item.result.status) || !validIdentity(item.identity) || (parsed.version === 2 && !item.identity && item.legacy !== true) || completed.has(item.key)) throw new Error('Invalid completed action state');
        if (Object.hasOwn(item,'admissionRejected')) {
          if (parsed.version !== 2 || !isDispatcherAdmissionRejected({completed:item,identity:{workspace:this.#workspace,deviceId:this.#deviceId},started:parsed.started})) throw new Error('Invalid admission rejection state');
          admissions.set(item.key,item.admissionRejected);
        }
        completed.set(item.key, item.result); if (item.identity) identities.set(item.key, item.identity);
        else legacy.add(item.key);
      }
      for (const item of parsed.version === 2 ? parsed.started : []) {
        if (!item || typeof item.key !== 'string' || !item.key || (!['string', 'number'].includes(typeof item.actionId) && item.actionId !== null) || !item.identity || !validIdentity(item.identity) || !Number.isFinite(item.startedAt) || started.has(item.key)) throw new Error('Invalid started action state');
        if (item.nativeRuntime !== undefined && typeof item.nativeRuntime !== 'boolean') throw new Error('Invalid runtime ownership state');
        if (item.quarantine !== undefined && (!item.quarantine || typeof item.quarantine.stopConfirmed !== 'boolean')) throw new Error('Invalid execution quarantine state');
        started.set(item.key, item);
      }
      this.#completed = completed; this.#completedIdentity = identities; this.#admissionRejected = admissions; this.#legacyCompleted = legacy; this.#started = started;
      for (const [key, item] of started) {
        if(item.maintenancePause!==undefined&&this.#validPaused(item))continue;
        if (!completed.has(key) && (item.nativeRuntime || item.quarantine) && item.quarantine?.stopConfirmed !== true) this.#quarantines.add(key);
      }
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      this.#stateError = error;
      this.#onEvent('action.state_load_failed', {error: error?.message || String(error)});
    }
  }
  #saveState() {
    if (!this.#stateFile) return;
    let descriptor; const temporary = `${this.#stateFile}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.#stateFile), {recursive: true});
      const payload = JSON.stringify({version: 2, updatedAt: new Date(this.#now()).toISOString(), completed: [...this.#completed.entries()].map(([key, result]) => ({key, result, ...(this.#completedIdentity.has(key) ? {identity: this.#completedIdentity.get(key)} : {}), ...(this.#admissionRejected.has(key) ? {admissionRejected:this.#admissionRejected.get(key)} : {}), ...(this.#legacyCompleted.has(key) ? {legacy: true} : {})})), started: [...this.#started.values()]});
      descriptor = fs.openSync(temporary, 'w', 0o600);
      fs.writeFileSync(descriptor, payload, 'utf8'); fs.fsyncSync(descriptor);
      fs.closeSync(descriptor); descriptor = undefined;
      fs.renameSync(temporary, this.#stateFile);
      descriptor = fs.openSync(this.#stateFile, 'r+'); fs.fsyncSync(descriptor);
      fs.closeSync(descriptor); descriptor = undefined;
      // Windows cannot open a directory for fsync. The file itself was flushed
      // before and after the atomic replacement; POSIX also flushes its entry.
      if (process.platform !== 'win32') {
        descriptor = fs.openSync(path.dirname(this.#stateFile), 'r'); fs.fsyncSync(descriptor);
        fs.closeSync(descriptor); descriptor = undefined;
      }
    } catch (error) {
      this.#onEvent('action.state_save_failed', {error: error?.message || String(error)});
      throw error;
    } finally {
      if (descriptor !== undefined) { try { fs.closeSync(descriptor); } catch {} }
      try { fs.unlinkSync(temporary); } catch {}
    }
  }
  #identity(action) {
    const values = {
      workspace: this.#workspace, deviceId: this.#deviceId,
      workspaceId: action?.workspace_id ?? action?.workspaceId,
      actionWorkspace: action?.workspace ?? action?.workspace_slug,
      targetDeviceId: action?.payload?.deviceId ?? action?.payload?.device_id ?? action?.payload?.targetDeviceId ?? action?.payload?.target_device_id,
    };
    return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== null && String(value) !== '').map(([key, value]) => [key, String(value)]));
  }
  #sameIdentity(stored, identity, storedActionId, action) {
    if (storedActionId !== undefined && storedActionId !== null && String(storedActionId) !== String(action?.id ?? '')) return false;
    // v1 completed entries did not record their connection binding. Preserve
    // those results in place; every new entry records the full identity.
    if (!stored) return true;
    return JSON.stringify(Object.entries(stored).sort()) === JSON.stringify(Object.entries(identity).sort());
  }
  #findByActionId(entries, actionId, getActionId) {
    if (actionId === undefined || actionId === null || String(actionId) === '') return null;
    return [...entries.entries()].find(([, item]) => String(getActionId(item) ?? '') === String(actionId)) || null;
  }
  #uncertain(action, reason, error, extra = {}) {
    return this.#failure(action, `执行状态无法安全确认，需人工核实后处理：${error instanceof Error ? error.message : String(error)}`, {code: 'EXECUTION_UNCERTAIN', executionState: 'uncertain', reason, ...extra});
  }
  #duplicate(action, result) {
    return {status: 'duplicate', actionId: action?.id, originalStatus: result.status, result: result.result, error: result.error, completedAt: result.completedAt, ...(result.code ? {code: result.code} : {}), ...(result.reason ? {reason: result.reason} : {}), ...(result.executionState ? {executionState: result.executionState} : {})};
  }
  #markStarted(action, key, identity,timing={}) {
    this.#started.set(key, {key, actionId: action?.id ?? null, identity, startedAt: timing.startedAt??this.#now(),...(timing.hardDeadline!==undefined?{hardDeadline:timing.hardDeadline}:{}), ...(isNativeRuntimeAction(action) ? {nativeRuntime: true,resourceBinding:{type:action.type,employeeId:action.payload?.employeeId||null,revision:action.payload?.hermesBot?.revision||null,controlEpoch:action.payload?.hermesBot?.controlEpoch||null,resource:action.payload?.nativeOperation?.resource||null,operation:action.payload?.nativeOperation?.operation||null,platform:action.payload?.nativeOperation?.input?.platform||null}} : {})});
    try { this.#saveState(); }
    catch (error) { throw Object.assign(new Error(error?.message || String(error)), {code: 'ACTION_STATE_WRITE_FAILED'}); }
  }
  #quarantine(key, reason) {
    const item = this.#started.get(key); if (!item) return;
    this.#quarantines.add(key);
    item.quarantine = {reason, recordedAt: this.#now(), stopConfirmed: false};
    try { this.#saveState(); } catch {} // The durable native started record also blocks restart.
    this.#onEvent('action.quarantined', {actionId: item.actionId, reason});
  }
  #confirmQuarantineStopped(key, result) {
    if (!this.#quarantines.has(key)) return;
    const item = this.#started.get(key); if (!item) return;
    if (!result || result.status !== 'failed') return;
    const previous = item.quarantine;
    item.quarantine = {...previous, stopConfirmed: true, confirmedAt: this.#now(), processExit: result.result.processExit};
    this.#completed.set(key, result); this.#completedIdentity.set(key, item.identity);
    try { this.#saveState(); }
    catch { item.quarantine = previous; this.#completed.delete(key); this.#completedIdentity.delete(key); return; }
    this.#quarantines.delete(key);
    this.#stopHandlers.delete(String(item.actionId));
    this.#onEvent('action.quarantine_cleared', {actionId: item.actionId, reason: 'STOP_CONFIRMED'});
    this.#onEvent('action.result_recovered', {actionId: item.actionId, status: result.status});
  }
  get quarantined() { return this.#stateError !== null || this.#quarantines.size > 0; }
  get quarantinedActionIds() { return [...this.#quarantines].map(key => String(this.#started.get(key)?.actionId ?? key)).concat(this.#stateError ? ['state-corrupt'] : []); }
  #validPaused(item,action=null){
    const receipt=item?.maintenancePause;
    if(!item||item.nativeRuntime!==true||item.quarantine||item.maintenanceResumeStarted===true||!Number.isFinite(item.hardDeadline)||item.hardDeadline<item.startedAt||!item.identity||item.identity.workspace!==this.#workspace||item.identity.deviceId!==this.#deviceId||!validateMaintenancePause(receipt,{actionId:String(item.actionId)}))return false;
    const b=item.resourceBinding;
    if(!b||!['conversation.execute','task.execute','agent.execute','runtime.execute','automation.execute'].includes(b.type)||b.resource!==null||b.operation!==null||b.platform!==null)return false;
    return !action||(item.key===String(action.dedupeKey??action.dedupe_key??action.id)&&b.type===action.type&&b.employeeId===(action.payload?.employeeId||null)&&b.revision===(action.payload?.hermesBot?.revision||null)&&b.controlEpoch===(action.payload?.hermesBot?.controlEpoch||null)&&item.hardDeadline<=item.startedAt+actionExecutionTimeoutMs(action)&&this.#sameIdentity(item.identity,this.#identity(action),item.actionId,action)&&validateMaintenancePause(receipt,{actionId:action.id,executionBinding:executionBinding(action),profile:action.payload?.profile||action.payload?.hermesBot?.sourceProfile||'default'}));
  }
  #pausedResult(action,receipt){return markMaintenancePaused({status:'maintenance_paused',actionId:action.id,result:{maintenanceCheckpoint:receipt,processExit:receipt.processExit}},receipt);}
  async #commitPause(action,key,receipt){
    if(this.#maintenanceCommitted.has(key))return true;
    try{const value=await this.#onMaintenancePaused(action,receipt);if(value===true||value?.committed===true){if(!this.#completed.has(key))this.#maintenanceCommitted.add(key);return true;}}catch{}
    this.#onEvent('action.maintenance_commit_pending',{actionId:action.id});return false;
  }
  get maintenancePausedActions(){return [...this.#started.values()].filter(item=>!this.#completed.has(item.key)&&this.#validPaused(item)).map(item=>({actionId:item.actionId,employeeId:item.resourceBinding?.employeeId||null,receipt:JSON.parse(JSON.stringify(item.maintenancePause))}));}
  get maintenancePendingCommits(){return this.maintenancePausedActions.filter(row=>!this.#maintenanceCommitted.has(this.#findByActionId(this.#started,row.actionId,item=>item.actionId)?.[0]));}
  getMaintenancePause(actionId){return this.maintenancePausedActions.find(row=>String(row.actionId)===String(actionId))?.receipt||null;}
  hasPausedEmployee(employeeId){return this.maintenancePausedActions.some(row=>row.employeeId===employeeId);}
  async retryMaintenanceCommits(actions=[]){
    for(const action of actions){const entry=this.#findByActionId(this.#started,action?.id,item=>item.actionId);if(entry&&this.#validPaused(entry[1],action))this.#maintenanceActions.set(entry[0],action);}
    for(const row of this.maintenancePendingCommits){const entry=this.#findByActionId(this.#started,row.actionId,item=>item.actionId),action=entry&&this.#maintenanceActions.get(entry[0]);if(action&&this.#validPaused(entry[1],action))await this.#commitPause(action,entry[0],entry[1].maintenancePause);}
    return {pending:this.maintenancePendingCommits.length};
  }
  async requestMaintenancePause(update){
    if(!update||typeof update.id!=='string'||!update.id||!/^[a-f0-9]{64}$/.test(update.targetBuild||''))throw new TypeError('Invalid maintenance update');
    const results=[];
    for(const [actionId,controller]of this.#controllers){if(controller.signal.aborted)continue;const request={id:update.id,targetBuild:update.targetBuild};this.#maintenanceRequests.set(actionId,request);const handler=this.#maintenanceControls.get(actionId);let value={accepted:false,reasonCode:'MAINTENANCE_NOT_READY'};if(handler)try{value=await handler(request);}catch{}results.push({actionId,...(value&&typeof value==='object'?value:{accepted:false})});}
    return results;
  }
  #inside(root, candidate) {
    const relative = path.relative(root, candidate);
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  }
  #validateWorkdir(action) {
    const requested = action?.payload?.workdir ?? action?.payload?.workingDirectory ?? (process.platform === 'win32' ? action?.payload?.working_directory : undefined) ?? action?.payload?.cwd;
    if (process.platform === 'win32' && isNativeRuntimeAction(action)) {
      const payload = action.payload || {};
      const base = resolveWindowsWorkdirPath(this.#workdir, payload.workdir || '.');
      return resolveWindowsWorkdir(base, payload.cwd ?? payload.workingDirectory ?? payload.working_directory ?? '.');
    }
    if (process.platform === 'win32' && ['directory.inspect', 'device.directory.inspect'].includes(String(action?.type || ''))) {
      // The directory target is resolved by the inspector. Keep its explicit
      // relative base even when the daemon process itself lives in user data.
      return resolveWindowsWorkdirPath(this.#workdir, action?.payload?.workdir || '.');
    }
    const candidate = path.resolve(this.#workdir, String(requested || this.#workdir));
    if (!this.#inside(this.#workdir, candidate)) throw new Error('A2A action workdir is outside the registered runtime directory');
    // Realpath containment closes junction/symlink escapes for existing roots.
    // A configured root may be created by the target workstation later; keep
    // lexical containment for that compatibility case until it exists.
    if (fs.existsSync(this.#workdir)) {
      const rootReal = fs.realpathSync.native(this.#workdir); let existing = candidate;
      while (!fs.existsSync(existing)) { const parent = path.dirname(existing); if (parent === existing) break; existing = parent; }
      const existingReal = fs.realpathSync.native(existing);
      if (!this.#inside(rootReal, existingReal)) throw new Error('A2A action workdir resolves outside the registered runtime directory');
    }
    return candidate;
  }
  #failure(action, error, extra = {}) {
    const message = error instanceof Error ? error.message : String(error);
    return {status: 'failed', actionId: action?.id, error: message, completedAt: this.#now(), ...extra};
  }
  #rejectAdmission(action,key,identity,phase,error,code='ACTION_ADMISSION_REJECTED') {
    return markDispatcherAdmissionRejected(this.#failure(action,error,{code,executionState:'not_dispatched',admissionRejected:true,result:{admissionRejected:true,executionState:'not_dispatched'}}),{key,identity,phase});
  }
  async #run(action, key, identity,maintenanceResume=null,resumeTiming=null) {
    const actionId = action?.id; const controller = new AbortController(); let hardTimeoutHandle = null; let idleWatchdogHandle = null; this.#controllers.set(String(actionId), controller);
    let admissionPhase='authorization';
    try {
      if (!action || typeof action !== 'object') throw new Error('A2A action must be an object');
      // Verify the original wire payload before this trusted dispatcher adds
      // local working-directory defaults or handles an action.cancel itself.
      await this.#authorizeExecute(action);
      if(maintenanceResume&&controller.signal.aborted)return this.#failure(action,'A2A action cancelled before maintenance resume launch',{code:'cancelled',result:{maintenanceCancelled:true,maintenanceCheckpoint:maintenanceResume,processExit:maintenanceResume.processExit,partialEffectsPossible:true}});
      const actionType = String(action.type || '').toLowerCase();
      if (actionType === 'agent.cancel' || actionType === 'action.cancel') {
        admissionPhase=null;
        this.#markStarted(action, key, identity);
        const target = String(action.payload?.actionId || action.payload?.action_id || ''); const cancellationRequested = target !== String(actionId) && this.cancel(target);
        const completed = this.status(target).completed, exit = completed?.result?.processExit;
        const targetResultAvailable = Boolean(completed && exit?.rootConfirmed === true && exit.treeConfirmed === true && exit.activeProcesses === 0);
        return {status: cancellationRequested || targetResultAvailable ? 'succeeded' : 'failed', actionId, result: {targetActionId: target, cancellationRequested, targetResultAvailable, stopConfirmed: false, message: cancellationRequested ? '取消请求已接受；目标是否停止须以目标动作的停止回执为准' : targetResultAvailable ? '已有目标动作退出终态，正在核实原动作回执' : '没有可用的目标动作控制器或可信退出终态，无法确认目标是否停止'}, completedAt: this.#now(), ...(cancellationRequested || targetResultAvailable ? {} : {code: 'CANCEL_TARGET_UNCONFIRMED', error: 'target execution stop is unconfirmed'})};
      }
      admissionPhase='expiry';
      const expiresAt = action.expiresAt ?? action.expires_at;
      if (expiresAt && Number.isFinite(Date.parse(String(expiresAt))) && Date.parse(String(expiresAt)) <= Date.now()) throw new Error('A2A action expired');
      admissionPhase='workdir';
      const workdir = this.#validateWorkdir(action);
      const executableAction = process.platform === 'win32' || (action.payload && typeof action.payload === 'object') ? {...action, payload: {
        ...(action.payload && typeof action.payload === 'object' ? action.payload : {}),
        workdir, ...(needsNativeCwd(action) ? { cwd: workdir } : {})
      }} : action;
      if (this.quarantined || !this.#canExecute(action)) return this.#uncertain(action, 'EXECUTION_QUARANTINED', '本机仍有未确认停止的执行；未启动新动作');
      admissionPhase='budget';
      const nativeRuntime = isNativeRuntimeAction(action);
      const requestedTimeout = action.payload?.timeoutMs ?? action.payload?.timeout_ms;
      const hasHardTimeout = requestedTimeout !== undefined && requestedTimeout !== null && String(requestedTimeout).trim() !== '' && Number.isFinite(Number(requestedTimeout));
      let hardTimeoutMs = hasHardTimeout || nativeRuntime ? actionExecutionTimeoutMs(action) : null;
      if (nativeRuntime && expiresAt) {
        const remaining = Date.parse(String(expiresAt)) - this.#now() - ACTION_EXECUTION_LEASE_BUFFER_MS;
        if (!Number.isFinite(remaining) || remaining < 100) return this.#rejectAdmission(action,key,identity,'lease','A2A action lease leaves insufficient time for execution and confirmed shutdown','ACTION_LEASE_INSUFFICIENT');
        hardTimeoutMs = Math.min(hardTimeoutMs, remaining);
      }
      const hardDeadline = resumeTiming ? Math.min(resumeTiming.hardDeadline,this.#now()+hardTimeoutMs) : (hardTimeoutMs === null ? null : this.#now()+hardTimeoutMs);
      if(resumeTiming){hardTimeoutMs=hardDeadline-this.#now();if(hardTimeoutMs<=0)return this.#failure(action,'A2A action original execution budget expired during maintenance',{code:'action_timeout',result:{processExit:maintenanceResume.processExit,maintenanceCheckpoint:maintenanceResume}});}
      const requestedIdleTimeout = action.payload?.idleTimeoutMs ?? action.payload?.idle_timeout_ms;
      const hasIdleTimeout = requestedIdleTimeout !== undefined && requestedIdleTimeout !== null && String(requestedIdleTimeout).trim() !== '' && Number.isFinite(Number(requestedIdleTimeout));
      const idleTimeoutMs = hasIdleTimeout ? Math.max(100, Number(requestedIdleTimeout)) : 2 * 60 * 1000;
      const enforceIdle = !nativeRuntime || hasIdleTimeout;
      admissionPhase=null;
      this.#markStarted(action, key, identity,{startedAt:resumeTiming?.startedAt,hardDeadline});
      if(maintenanceResume)this.#onEvent('action.maintenance_resumed',{actionId,updateId:maintenanceResume.updateId,targetBuild:maintenanceResume.targetBuild});
      this.#onEvent('action.started', {actionId, type: action.type});
      let stopReason = null; let resolveStop; let supervision = null; let stopInvoked = false; let stopInFlight = false;
      let residentExit=null;
      const onResidentExit=proof=>{
        const worker=proof?.worker,p=action.payload||{};
        if(!worker||!proof.processExit||action.type!=='hermes.bot.native'||p.nativeOperation?.resource!=='gateway'||worker.workspace!==identity.workspace||worker.employeeId!==p.employeeId||worker.revision!==p.hermesBot?.revision||worker.controlEpoch!==p.hermesBot?.controlEpoch||worker.platform!==p.nativeOperation.input?.platform||p.nativeOperation.operation==='connect'&&worker.sourceActionId!==action.id)return;
        residentExit=proof;
        this.#residentExits.set(key,proof);
        const completed=this.#completed.get(key);
        if(completed&&this.#sameIdentity(this.#completedIdentity.get(key),identity,completed.actionId,action)){
          completed.result={...completed.result,residentExit:proof};
          try{this.#saveState();}catch(error){this.#stateError=error;this.#onEvent('action.state_write_failed',{actionId,error:error.message});}
        }
      };
      let executionSettled = false; let stoppedEvidence = null; let latestEvidence = null; let resolveConfirmed;
      let executionError=null,completeEvidence=null,resolveComplete,supervisionRejected=false;
      const completeConfirmed=new Promise(resolve=>{resolveComplete=resolve;});
      const stopRequested = new Promise(resolve => { resolveStop = resolve; });
      const confirmed = new Promise(resolve => { resolveConfirmed = resolve; });
      const rootFinished = value => value?.rootConfirmed === true || (value?.launched === false && value.treeConfirmed === true);
      const reliableStop = value => rootFinished(value) && (value.treeConfirmed === true || (process.platform !== 'win32' && value.platform && value.platform !== 'win32'));
      const finalizeStopped = () => {
        if (!executionSettled || (supervision ? !stoppedEvidence : !stopReason) || executionError&&(supervisionRejected||!completeEvidence)) return;
        const cancelled = stopReason === 'cancelled';
        this.#confirmQuarantineStopped(key, this.#failure(action, executionError || '原动作已确认退出；工具可能已经产生影响，请核实后再决定是否重新提交', {code: executionError ? 'executor_failed' : cancelled ? 'cancelled' : stopReason ? 'action_timeout' : 'execution_stopped', result: {processExit: safeProcessExit(executionError?completeEvidence:stoppedEvidence), partialEffectsPossible: true}}));
      };
      const observeEvidence = promise => Promise.resolve(promise).then(value => {
        latestEvidence = value;
        if(completeRuntimeExit(value)){completeEvidence=value;resolveComplete(true);}
        if (reliableStop(value)) {
          stoppedEvidence = value; resolveConfirmed(true); finalizeStopped();
        }
        return value;
      }, () => null);
      const invokeStop = (retry = false) => {
        if (!supervision || stopInFlight || (stopInvoked && !retry)) return;
        stopInvoked = true; stopInFlight = true;
        void observeEvidence(Promise.resolve().then(() => supervision.stop())).finally(() => { stopInFlight = false; });
      };
      const requestStop = reason => {
        if (stopReason) return;
        stopReason = reason; controller.abort(); invokeStop(); resolveStop({kind: 'stop'});
      };
      controller.signal.addEventListener('abort', () => { if (!stopReason) requestStop('cancelled'); }, {once: true});
      const bounded = async promise => {
        let timer;
        try { return await Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(null), this.#stopGraceMs); })]); }
        finally { clearTimeout(timer); }
      };
      let lastActivityAt = this.#now();
      const refreshIdleTimeout = () => { if (!stopReason) lastActivityAt = this.#now(); };
      let waitingEmitted = false;
      const clearTimeouts = () => {
        if (hardTimeoutHandle) clearTimeout(hardTimeoutHandle);
        if (idleWatchdogHandle) clearInterval(idleWatchdogHandle);
        hardTimeoutHandle = null;
        idleWatchdogHandle = null;
      };
      if (hardDeadline !== null) hardTimeoutHandle = setTimeout(() => requestStop('hard'), Math.max(0, hardDeadline - this.#now()));
      const intervalMs = Math.max(25, Math.min(1000, Math.floor(idleTimeoutMs / 4)));
      idleWatchdogHandle = setInterval(() => {
        if (stopReason || this.#now() - lastActivityAt < idleTimeoutMs) return;
        if (enforceIdle) requestStop('idle');
        else if (!waitingEmitted) {
          waitingEmitted = true;
          this.#onEvent('action.waiting', {actionId, type: action.type, message: '未收到新输出，仍在等待 CLI；无法据此确认执行进度', detail: '静默不等于执行停止，本地执行截止时间保持不变', idleMs: this.#now() - lastActivityAt});
        }
      }, intervalMs);
      const execution = Promise.resolve().then(() => controller.signal.aborted ? {status: 'failed', code: 'cancelled'} : this.#execute(executableAction, {
        signal: controller.signal,
        maintenanceResume:maintenanceResume?JSON.parse(JSON.stringify(maintenanceResume)):null,
        maintenanceExecutionBinding:executionBinding(action),
        onMaintenancePauseControl:handler=>{if(typeof handler!=='function'||this.#maintenanceControls.has(String(actionId)))throw new Error('Invalid maintenance pause control');this.#maintenanceControls.set(String(actionId),handler);const update=this.#maintenanceRequests.get(String(actionId));if(update&&!controller.signal.aborted)void Promise.resolve().then(()=>handler(update)).catch(()=>{});},
        onResidentExit,
        onActivity: refreshIdleTimeout,
        onSupervision: value => {
          if (supervision || !value || typeof value.stop !== 'function' || !value.completionEvidence || typeof value.completionEvidence.then !== 'function') {supervisionRejected=true;throw new Error('Invalid runtime supervision registration');}
          supervision = value; observeEvidence(value.completionEvidence);
          this.#stopHandlers.set(String(actionId), () => stopReason ? invokeStop(true) : requestStop('cancelled'));
          if (stopReason) invokeStop();
        },
        onOutput: chunk => {
          if (stopReason) return;
          refreshIdleTimeout();
          const bytes = Buffer.byteLength(String(chunk || ''));
          const stage = classifyOutputStage(chunk);
          this.#onEvent('action.output', {
            actionId,
            type: action.type,
            ...stage,
            message: stage.message,
            bytes,
            detail: stage.detail,
            progress: { phase: 'output', bytes, detail: stage.detail }
          });
        },
        onStage: stage => { if (stopReason) return; refreshIdleTimeout(); this.#onEvent('action.stage', {
          actionId,
          type: action.type,
          stage: stage?.stage || 'output',
          message: stage?.message || '执行活动',
          detail: stage?.detail || '结构化运行时活动',
          ...(stage?.summary ? { summary: stage.summary } : {}),
          progress: { phase: 'stage', ...stage }
        }); },
        onProgress: progress => { if (stopReason) return; refreshIdleTimeout(); this.#onEvent('action.progress', {
          actionId,
          type: action.type,
          message: progress?.runtime ? `${progress.runtime} 正在执行` : 'CLI 正在执行',
          detail: Number(progress?.bytes) > 0 ? `已接收 ${Number(progress.bytes).toLocaleString()} B 输出` : '正在接收 CLI 输出',
          progress: { phase: 'running', ...progress }
        }); },
      })).then(value => ({kind: 'execution', value}), error => ({kind: 'execution', error})).then(outcome => {
        executionSettled = true;
        if (!supervision) resolveConfirmed(true);
        finalizeStopped();
        return outcome;
      });
      const outcome = await Promise.race([execution, stopRequested]); clearTimeouts();
      if (stopReason) {
        invokeStop();
        const stopped = await bounded(Promise.all([execution, confirmed]));
        const receipt = {result: {processExit: safeProcessExit(stoppedEvidence || latestEvidence), partialEffectsPossible: true}};
        if (!stopped || (supervision ? !stoppedEvidence : !executionSettled)) {
          this.#quarantine(key, 'STOP_UNCONFIRMED');
          return this.#uncertain(action, 'STOP_UNCONFIRMED', '已请求停止，但无法确认运行进程及任务树已退出；工具可能已经写入，请核实后再决定是否重新提交', receipt);
        }
        const cancelled = stopReason === 'cancelled';
        const error = cancelled ? 'A2A action cancelled' : stopReason === 'idle' ? `A2A action timed out after no activity for ${idleTimeoutMs}ms` : `A2A action timed out after ${hardTimeoutMs}ms`;
        return this.#failure(action, `${error}；工具可能已经写入或产生其他影响，请核实后再决定是否重新提交`, {code: cancelled ? 'cancelled' : 'action_timeout', ...receipt});
      }
      if (Object.hasOwn(outcome,'error')) {
        const error=outcome.error instanceof Error?outcome.error:new Error(String(outcome.error)),prelaunch=!supervision&&!supervisionRejected?consumeRuntimePrelaunchEvidence(error):null;
        let failed;
        if(prelaunch)failed=this.#failure(action,error,{code:error.code || 'RUNTIME_PRELAUNCH_REJECTED',result:{...prelaunch,processExit:safeProcessExit(prelaunch.processExit)}});
        else if(supervision){
          executionError=error;
          if(supervisionRejected||!completeEvidence){requestStop('executor_error');if(!supervisionRejected)await bounded(completeConfirmed);}
          if(supervisionRejected||!completeEvidence){
            this.#quarantine(key,'EXECUTOR_EXIT_UNCONFIRMED');
            failed=this.#uncertain(action,'EXECUTOR_EXIT_UNCONFIRMED',error,{result:{processExit:safeProcessExit(latestEvidence),partialEffectsPossible:true}});
          }else failed=this.#failure(action,error,{code:'executor_failed',result:{processExit:safeProcessExit(completeEvidence),partialEffectsPossible:true}});
        }else if(nativeRuntime){
          this.#quarantine(key,'EXECUTOR_WITHOUT_EXIT_EVIDENCE');
          failed=this.#uncertain(action,'EXECUTOR_WITHOUT_EXIT_EVIDENCE',error,{result:{processExit:null,partialEffectsPossible:true}});
        }else throw error;
        try{this.#onEvent('action.failed',{actionId,type:action?.type,error:failed.error});}catch{}
        return failed;
      }
      if (supervision && !rootFinished(latestEvidence)) {
        await bounded(observeEvidence(supervision.completionEvidence));
        if (!rootFinished(latestEvidence)) {
          this.#quarantine(key, 'ROOT_EXIT_UNCONFIRMED');
          return this.#uncertain(action, 'ROOT_EXIT_UNCONFIRMED', '运行时返回但未能确认原进程退出', {result: {processExit: safeProcessExit(latestEvidence), partialEffectsPossible: true}});
        }
      }
      const result = outcome.value;
      const pause=consumeMaintenancePaused(result);
      if(pause){
        const requested=this.#maintenanceRequests.get(String(actionId));
        if(!['conversation.execute','task.execute','agent.execute','runtime.execute','automation.execute'].includes(action.type)||!requested||!supervision||!latestEvidence||!validateMaintenancePause(pause,{actionId,executionBinding:executionBinding(action),updateId:requested.id,targetBuild:requested.targetBuild,profile:action.payload?.profile||action.payload?.hermesBot?.sourceProfile||'default',cwd:workdir,processExit:latestEvidence})){this.#quarantine(key,'MAINTENANCE_CHECKPOINT_UNCONFIRMED');return this.#uncertain(action,'MAINTENANCE_CHECKPOINT_UNCONFIRMED','维护暂停缺少匹配的原生退出证据');}
        return this.#pausedResult(action,pause);
      }
      const executorStatus = result && typeof result === 'object' ? String(result.status || '') : '';
      if (executorStatus && executorStatus !== 'succeeded') {
        if (result.code === 'EXECUTION_UNCERTAIN' || result.executionState === 'uncertain') {
          this.#quarantine(key, result.reason || 'EXECUTOR_UNCERTAIN');
          finalizeStopped();
          return this.#uncertain(action, result.reason || 'EXECUTOR_UNCERTAIN', result.error || '运行时执行状态未确认', {result: {processExit: safeProcessExit(stoppedEvidence || latestEvidence), partialEffectsPossible: true}});
        }
        if (executorStatus === 'failed') return this.#failure(action, result.error || 'Local executor failed', {result: supervision ? {...result.result, processExit: safeProcessExit(latestEvidence)} : result.result, code: result.code || 'executor_failed'});
        return this.#failure(action, `Local executor returned non-terminal status: ${executorStatus}`, {result, code: 'execution_not_completed'});
      }
      const output = executorStatus === 'succeeded' && Object.prototype.hasOwnProperty.call(result, 'result') ? result.result : result;
      return {status: 'succeeded', actionId, result: supervision ? {...(output && typeof output === 'object' && !Array.isArray(output) ? output : {output}), processExit: safeProcessExit(latestEvidence), ...(residentExit ? {residentExit} : {})} : residentExit?{...output,residentExit}:output, completedAt: this.#now()};
    } catch (error) { const failed = admissionPhase ? this.#rejectAdmission(action,key,identity,admissionPhase,error) : error?.code === 'ACTION_STATE_WRITE_FAILED' ? this.#uncertain(action, error.code, error) : this.#failure(action, error); this.#onEvent('action.failed', {actionId, type: action?.type, error: failed.error}); return failed; }
    finally { if (hardTimeoutHandle) clearTimeout(hardTimeoutHandle); if (idleWatchdogHandle) clearInterval(idleWatchdogHandle); this.#controllers.delete(String(actionId)); this.#maintenanceControls.delete(String(actionId));this.#maintenanceRequests.delete(String(actionId)); if (!this.quarantinedActionIds.includes(String(actionId))) this.#stopHandlers.delete(String(actionId)); }
  }
  async dispatch(action) {
    const key = String(action?.dedupeKey ?? action?.dedupe_key ?? action?.id ?? ''); if (!key) return this.#failure(action, 'A2A action requires id or dedupeKey');
    if (this.#stateError) return this.#uncertain(action, 'ACTION_STATE_CORRUPT', this.#stateError);
    const identity = this.#identity(action);
    const completedEntry = this.#completed.has(key) ? [key, this.#completed.get(key)] : this.#findByActionId(this.#completed, action?.id, item => item.actionId);
    if (completedEntry) {
      const [savedKey, completed] = completedEntry;
      if (!this.#sameIdentity(this.#completedIdentity.get(savedKey), identity, completed.actionId, action)) return this.#uncertain(action, 'ACTION_IDENTITY_MISMATCH', '历史动作属于不同的工作区、设备或动作标识');
      return this.#duplicate(action, completed);
    }
    const inFlight = this.#inFlight.get(key) || this.#findByActionId(this.#inFlight, action?.id, item => item.actionId)?.[1];
    if (inFlight) {
      if (!this.#sameIdentity(inFlight.identity, identity, inFlight.actionId, action)) return this.#uncertain(action, 'ACTION_IDENTITY_MISMATCH', '正在执行的动作属于不同的工作区、设备或动作标识');
      const value=await inFlight.promise;const pause=this.getMaintenancePause(action.id);return value.status==='maintenance_paused'&&pause?this.#pausedResult(action,pause):this.#duplicate(action,value);
    }
    const started = this.#started.get(key) || this.#findByActionId(this.#started, action?.id, item => item.actionId)?.[1];
    if (started) {
      if (!this.#sameIdentity(started.identity, identity, started.actionId, action)) return this.#uncertain(action, 'ACTION_IDENTITY_MISMATCH', '未确认完成的动作属于不同的工作区、设备或动作标识');
      if(!this.#validPaused(started,action))return this.#uncertain(action, 'STARTED_WITHOUT_RESULT', '已有执行开始记录，但没有持久化终态；不会重新执行');
    }
    const entry = {actionId: action?.id, identity, promise: null};
    entry.promise = Promise.resolve().then(async () => {
      let resume=null;
      if(started){
        this.#maintenanceActions.set(key,action);resume=started.maintenancePause;
        const committed=await this.#commitPause(action,key,resume),settled=this.#completed.get(key);
        if(settled)return this.#duplicate(action,settled);
        if(!committed)return this.#pausedResult(action,resume);
        let allowed=false;try{const value=await this.#authorizeResume(action,resume);allowed=value===true||value?.allowed===true;}catch{}
        const completed=this.#completed.get(key);if(completed)return this.#duplicate(action,completed);
        if(!allowed)return this.#pausedResult(action,resume);
        if(this.#started.get(key)!==started||!this.#validPaused(started,action))return this.#uncertain(action,'MAINTENANCE_RESUME_CHANGED','维护暂停状态已变化');
        started.maintenanceResumeStarted=true;try{this.#saveState();}catch(error){this.#quarantine(key,'MAINTENANCE_RESUME_WRITE_FAILED');return this.#uncertain(action,'ACTION_STATE_WRITE_FAILED',error);}
      }
      const result = await this.#run(action, key, identity,resume,started?{startedAt:started.startedAt,hardDeadline:started.hardDeadline}:null);
      const pause=consumeMaintenancePaused(result);
      if(pause){
        const item=this.#started.get(key);if(!item)return this.#uncertain(action,'MAINTENANCE_STATE_MISSING','维护暂停原始执行记录缺失');
        item.maintenancePause=pause;delete item.maintenanceResumeStarted;this.#maintenanceCommitted.delete(key);this.#maintenanceActions.set(key,action);
        try{this.#saveState();}catch(error){this.#quarantine(key,'MAINTENANCE_PAUSE_WRITE_FAILED');return this.#uncertain(action,'ACTION_STATE_WRITE_FAILED',error);}
        await this.#commitPause(action,key,pause);const completed=this.#completed.get(key);if(completed)return this.#duplicate(action,completed);this.#onEvent('action.maintenance_paused',{actionId:action.id,updateId:pause.updateId,targetBuild:pause.targetBuild});return this.#pausedResult(action,pause);
      }
      if (result.code === 'EXECUTION_UNCERTAIN') return result;
      if(this.#residentExits.has(key))result.result={...result.result,residentExit:this.#residentExits.get(key)};
      this.#completed.set(key, result); this.#completedIdentity.set(key, identity);
      const admission=consumeDispatcherAdmissionRejected(result);if(admission)this.#admissionRejected.set(key,admission);
      try { this.#saveState(); }
      catch (error) {
        this.#completed.delete(key); this.#completedIdentity.delete(key); this.#admissionRejected.delete(key);
        return this.#uncertain(action, 'ACTION_STATE_WRITE_FAILED', error);
      }
      if (result.status === 'succeeded') this.#onEvent('action.succeeded', {actionId: action?.id, type: action?.type});
      return result;
    });
    this.#inFlight.set(key, entry);
    try { return await entry.promise; }
    finally { if (this.#inFlight.get(key) === entry) this.#inFlight.delete(key); }
  }
  settleMaintenanceFromServer(action,status,reason='MAINTENANCE_SERVER_TERMINAL') {
    if(this.#stateError||!['succeeded','failed','expired'].includes(status)||typeof reason!=='string'||!/^[A-Z0-9_]{1,100}$/.test(reason))return false;
    const entry=this.#findByActionId(this.#started,action?.id,item=>item.actionId);
    if(!entry||this.#completed.has(entry[0])||this.#controllers.has(String(action.id))||this.#stopHandlers.has(String(action.id))||!this.#validPaused(entry[1],action))return false;
    const [key,item]=entry,receipt=item.maintenancePause;
    // The server owns this terminal decision. Retain the invocation's actual
    // checkpoint exit; it is not evidence of a cancelled or completed business task.
    const result=this.#failure(action,'服务器已确认原动作终止；未恢复执行',{
      code:reason==='MAINTENANCE_BUDGET_EXPIRED'||status==='expired'?'action_timeout':'maintenance_server_terminal',
      result:{maintenanceServerTerminal:{status,reasonCode:reason},maintenanceCheckpoint:receipt,processExit:receipt.processExit,partialEffectsPossible:true},
    });
    this.#completed.set(key,result);this.#completedIdentity.set(key,item.identity);
    try{this.#saveState();}catch(error){this.#completed.delete(key);this.#completedIdentity.delete(key);throw error;}
    this.#maintenanceCommitted.delete(key);this.#maintenanceActions.delete(key);
    this.#onEvent('action.maintenance_server_terminal',{actionId:action.id,status,reasonCode:reason});return true;
  }
  completedResult(action) {
    if (this.#stateError) return null;
    const entry = this.#findByActionId(this.#completed, action?.id, item => item.actionId);
    if (!entry || this.#legacyCompleted.has(entry[0]) || !this.#sameIdentity(this.#completedIdentity.get(entry[0]), this.#identity(action), entry[1].actionId, action)) return null;
    return this.#duplicate(action, entry[1]);
  }
  cancel(actionId) { const id = String(actionId), controller = this.#controllers.get(id), stop = this.#stopHandlers.get(id);if(!controller&&!stop){const entry=this.#findByActionId(this.#started,id,item=>item.actionId);if(!entry||this.#completed.has(entry[0])||!this.#validPaused(entry[1]))return false;const result=this.#failure({id},'A2A action cancelled after maintenance pause; completed tool effects remain',{code:'cancelled',result:{maintenanceCancelled:true,processExit:entry[1].maintenancePause.processExit,maintenanceCheckpoint:entry[1].maintenancePause,partialEffectsPossible:true}});this.#completed.set(entry[0],result);this.#completedIdentity.set(entry[0],entry[1].identity);try{this.#saveState();}catch{this.#completed.delete(entry[0]);this.#completedIdentity.delete(entry[0]);return false;}this.#onEvent('action.result_recovered',{actionId:id,status:'failed'});return true;} if (controller && !controller.signal.aborted) controller.abort(); else if (stop) stop(); this.#onEvent('action.cancel_requested', {actionId, stopConfirmed: false}); return true; }
  status(actionId) { const id = String(actionId); return {actionId: id, running: this.#controllers.has(id) || this.quarantinedActionIds.includes(id), quarantined: this.quarantinedActionIds.includes(id),paused:Boolean(this.getMaintenancePause(id)), completed: [...this.#completed.values()].find(item => String(item.actionId) === id) || null}; }
}
