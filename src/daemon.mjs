import fs from 'node:fs';
import path from 'node:path';
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

export class ActionDispatcher {
  #completed = new Map();
  #completedIdentity = new Map();
  #legacyCompleted = new Set();
  #started = new Map();
  #inFlight = new Map();
  #controllers = new Map();
  #execute;
  #now;
  #workdir;
  #onEvent;
  #stateFile;
  #stateError = null;
  #workspace;
  #deviceId;
  constructor({execute, now = () => Date.now(), workdir = process.cwd(), onEvent = () => {}, stateFile = null, workspace = '', deviceId = ''} = {}) {
    if (typeof execute !== 'function') throw new TypeError('ActionDispatcher requires an execute function');
    this.#execute = execute; this.#now = now; this.#workdir = process.platform === 'win32' ? resolveWindowsWorkdirPath(process.cwd(), workdir) : path.resolve(workdir); this.#onEvent = onEvent;
    this.#workspace = String(workspace || ''); this.#deviceId = String(deviceId || '');
    this.#stateFile = stateFile ? path.resolve(stateFile) : null; this.#loadState();
  }
  #loadState() {
    if (!this.#stateFile) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.#stateFile, 'utf8'));
      if (![1, 2].includes(parsed?.version) || !Array.isArray(parsed.completed) || (parsed.version === 2 && !Array.isArray(parsed.started))) throw new Error('Invalid action state structure');
      const validIdentity = value => value === undefined || (value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(item => typeof item === 'string'));
      const completed = new Map(); const identities = new Map(); const legacy = new Set(); const started = new Map();
      for (const item of parsed.completed) {
        if (!item || typeof item.key !== 'string' || !item.key || !item.result || !['succeeded', 'failed'].includes(item.result.status) || !validIdentity(item.identity) || (parsed.version === 2 && !item.identity && item.legacy !== true) || completed.has(item.key)) throw new Error('Invalid completed action state');
        completed.set(item.key, item.result); if (item.identity) identities.set(item.key, item.identity);
        else legacy.add(item.key);
      }
      for (const item of parsed.version === 2 ? parsed.started : []) {
        if (!item || typeof item.key !== 'string' || !item.key || (!['string', 'number'].includes(typeof item.actionId) && item.actionId !== null) || !item.identity || !validIdentity(item.identity) || !Number.isFinite(item.startedAt) || started.has(item.key)) throw new Error('Invalid started action state');
        started.set(item.key, item);
      }
      this.#completed = completed; this.#completedIdentity = identities; this.#legacyCompleted = legacy; this.#started = started;
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
      const payload = JSON.stringify({version: 2, updatedAt: new Date(this.#now()).toISOString(), completed: [...this.#completed.entries()].map(([key, result]) => ({key, result, ...(this.#completedIdentity.has(key) ? {identity: this.#completedIdentity.get(key)} : {}), ...(this.#legacyCompleted.has(key) ? {legacy: true} : {})})), started: [...this.#started.values()]});
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
  #uncertain(action, reason, error) {
    return this.#failure(action, `执行状态无法安全确认，需人工核实后处理：${error instanceof Error ? error.message : String(error)}`, {code: 'EXECUTION_UNCERTAIN', executionState: 'uncertain', reason});
  }
  #duplicate(action, result) {
    return {status: 'duplicate', actionId: action?.id, originalStatus: result.status, result: result.result, error: result.error, completedAt: result.completedAt, ...(result.code ? {code: result.code} : {}), ...(result.reason ? {reason: result.reason} : {}), ...(result.executionState ? {executionState: result.executionState} : {})};
  }
  #markStarted(action, key, identity) {
    this.#started.set(key, {key, actionId: action?.id ?? null, identity, startedAt: this.#now()});
    try { this.#saveState(); }
    catch (error) { throw Object.assign(new Error(error?.message || String(error)), {code: 'ACTION_STATE_WRITE_FAILED'}); }
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
  async #run(action, key, identity) {
    const actionId = action?.id; const controller = new AbortController(); let hardTimeoutHandle = null; let idleWatchdogHandle = null; this.#controllers.set(String(actionId), controller);
    try {
      if (!action || typeof action !== 'object') throw new Error('A2A action must be an object');
      const actionType = String(action.type || '').toLowerCase();
      if (actionType === 'agent.cancel' || actionType === 'action.cancel') {
        this.#markStarted(action, key, identity);
        const target = String(action.payload?.actionId || action.payload?.action_id || ''); const cancelled = this.cancel(target);
        return {status: cancelled ? 'succeeded' : 'failed', actionId, result: {targetActionId: target, cancelled}, completedAt: this.#now(), ...(cancelled ? {} : {error: 'target action is not running'})};
      }
      const expiresAt = action.expiresAt ?? action.expires_at;
      if (expiresAt && Number.isFinite(Date.parse(String(expiresAt))) && Date.parse(String(expiresAt)) <= Date.now()) throw new Error('A2A action expired');
      const workdir = this.#validateWorkdir(action);
      const executableAction = process.platform === 'win32' || (action.payload && typeof action.payload === 'object') ? {...action, payload: {
        ...(action.payload && typeof action.payload === 'object' ? action.payload : {}),
        workdir, ...(needsNativeCwd(action) ? { cwd: workdir } : {})
      }} : action;
      this.#markStarted(action, key, identity);
      this.#onEvent('action.started', {actionId, type: action.type});
      const requestedTimeout = action.payload?.timeoutMs ?? action.payload?.timeout_ms;
      const hasHardTimeout = requestedTimeout !== undefined && requestedTimeout !== null && String(requestedTimeout).trim() !== '' && Number.isFinite(Number(requestedTimeout));
      const hardTimeoutMs = hasHardTimeout ? Math.max(100, Number(requestedTimeout)) : null;
      const requestedIdleTimeout = action.payload?.idleTimeoutMs ?? action.payload?.idle_timeout_ms;
      const idleTimeoutMs = Math.max(100, Number.isFinite(Number(requestedIdleTimeout)) ? Number(requestedIdleTimeout) : 2 * 60 * 1000);
      let timedOut = false;
      let resolveTimeout;
      const failForTimeout = (reason) => {
        if (timedOut) return;
        timedOut = true;
        controller.abort();
        const message = reason === 'idle'
          ? `A2A action timed out after no activity for ${idleTimeoutMs}ms`
          : `A2A action timed out after ${hardTimeoutMs}ms`;
        resolveTimeout?.({status: 'failed', code: 'action_timeout', error: message});
      };
      let lastActivityAt = this.#now();
      const refreshIdleTimeout = () => { if (!timedOut) lastActivityAt = this.#now(); };
      const clearTimeouts = () => {
        if (hardTimeoutHandle) clearTimeout(hardTimeoutHandle);
        if (idleWatchdogHandle) clearInterval(idleWatchdogHandle);
        hardTimeoutHandle = null;
        idleWatchdogHandle = null;
      };
      const timeout = new Promise(resolve => {
        resolveTimeout = resolve;
        if (hardTimeoutMs !== null) hardTimeoutHandle = setTimeout(() => failForTimeout('hard'), hardTimeoutMs);
        const intervalMs = Math.max(25, Math.min(1000, Math.floor(idleTimeoutMs / 4)));
        idleWatchdogHandle = setInterval(() => {
          if (!timedOut && this.#now() - lastActivityAt >= idleTimeoutMs) failForTimeout('idle');
        }, intervalMs);
      });
      const execution = Promise.resolve().then(() => this.#execute(executableAction, {
        signal: controller.signal,
        onOutput: chunk => {
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
        onStage: stage => { refreshIdleTimeout(); this.#onEvent('action.stage', {
          actionId,
          type: action.type,
          stage: stage?.stage || 'output',
          message: stage?.message || '执行活动',
          detail: stage?.detail || '结构化运行时活动',
          ...(stage?.summary ? { summary: stage.summary } : {}),
          progress: { phase: 'stage', ...stage }
        }); },
        onProgress: progress => { refreshIdleTimeout(); this.#onEvent('action.progress', {
          actionId,
          type: action.type,
          message: progress?.runtime ? `${progress.runtime} 正在执行` : 'CLI 正在执行',
          detail: Number(progress?.bytes) > 0 ? `已接收 ${Number(progress.bytes).toLocaleString()} B 输出` : '正在接收 CLI 输出',
          progress: { phase: 'running', ...progress }
        }); },
      }));
      const result = await Promise.race([execution, timeout]); clearTimeouts();
      if (timedOut) return {...result, actionId, completedAt: this.#now()};
      if (controller.signal.aborted) return {status: 'failed', actionId, code: 'cancelled', error: 'A2A action cancelled', completedAt: this.#now()};
      const executorStatus = result && typeof result === 'object' ? String(result.status || '') : '';
      if (executorStatus && executorStatus !== 'succeeded') {
        if (executorStatus === 'failed') return this.#failure(action, result.error || 'Local executor failed', {result: result.result, code: result.code || 'executor_failed'});
        return this.#failure(action, `Local executor returned non-terminal status: ${executorStatus}`, {result, code: 'execution_not_completed'});
      }
      const output = executorStatus === 'succeeded' && Object.prototype.hasOwnProperty.call(result, 'result') ? result.result : result;
      return {status: 'succeeded', actionId, result: output, completedAt: this.#now()};
    } catch (error) { const failed = error?.code === 'ACTION_STATE_WRITE_FAILED' ? this.#uncertain(action, error.code, error) : this.#failure(action, error); this.#onEvent('action.failed', {actionId, type: action?.type, error: failed.error}); return failed; }
    finally { if (hardTimeoutHandle) clearTimeout(hardTimeoutHandle); if (idleWatchdogHandle) clearInterval(idleWatchdogHandle); this.#controllers.delete(String(actionId)); }
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
      return this.#duplicate(action, await inFlight.promise);
    }
    const started = this.#started.get(key) || this.#findByActionId(this.#started, action?.id, item => item.actionId)?.[1];
    if (started) {
      if (!this.#sameIdentity(started.identity, identity, started.actionId, action)) return this.#uncertain(action, 'ACTION_IDENTITY_MISMATCH', '未确认完成的动作属于不同的工作区、设备或动作标识');
      return this.#uncertain(action, 'STARTED_WITHOUT_RESULT', '已有执行开始记录，但没有持久化终态；不会重新执行');
    }
    const entry = {actionId: action?.id, identity, promise: null};
    entry.promise = Promise.resolve().then(async () => {
      const result = await this.#run(action, key, identity);
      if (result.code === 'EXECUTION_UNCERTAIN') return result;
      this.#completed.set(key, result); this.#completedIdentity.set(key, identity);
      try { this.#saveState(); }
      catch (error) {
        this.#completed.delete(key); this.#completedIdentity.delete(key);
        return this.#uncertain(action, 'ACTION_STATE_WRITE_FAILED', error);
      }
      if (result.status === 'succeeded') this.#onEvent('action.succeeded', {actionId: action?.id, type: action?.type});
      return result;
    });
    this.#inFlight.set(key, entry);
    try { return await entry.promise; }
    finally { if (this.#inFlight.get(key) === entry) this.#inFlight.delete(key); }
  }
  cancel(actionId) { const controller = this.#controllers.get(String(actionId)); if (!controller) return false; controller.abort(); this.#onEvent('action.cancelled', {actionId}); return true; }
  status(actionId) { const id = String(actionId); return {actionId: id, running: this.#controllers.has(id), completed: [...this.#completed.values()].find(item => String(item.actionId) === id) || null}; }
}
