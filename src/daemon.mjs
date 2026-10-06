import fs from 'node:fs';
import path from 'node:path';

function isAgentAction(action) {
  const type = String(action?.type || '').toLowerCase();
  return type === 'agent.execute' || type === 'conversation.execute' || type === 'runtime.execute'
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
  #inFlight = new Map();
  #controllers = new Map();
  #execute;
  #now;
  #workdir;
  #onEvent;
  #stateFile;
  constructor({execute, now = () => Date.now(), workdir = process.cwd(), onEvent = () => {}, stateFile = null} = {}) {
    if (typeof execute !== 'function') throw new TypeError('ActionDispatcher requires an execute function');
    this.#execute = execute; this.#now = now; this.#workdir = path.resolve(workdir); this.#onEvent = onEvent;
    this.#stateFile = stateFile ? path.resolve(stateFile) : null; this.#loadState();
  }
  #loadState() {
    if (!this.#stateFile || !fs.existsSync(this.#stateFile)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.#stateFile, 'utf8'));
      for (const item of Array.isArray(parsed?.completed) ? parsed.completed : []) if (item?.key && item?.result) this.#completed.set(String(item.key), item.result);
    } catch (error) { this.#onEvent('action.state_load_failed', {error: error?.message || String(error)}); }
  }
  #saveState() {
    if (!this.#stateFile) return;
    try {
      fs.mkdirSync(path.dirname(this.#stateFile), {recursive: true});
      const payload = JSON.stringify({version: 1, updatedAt: new Date(this.#now()).toISOString(), completed: [...this.#completed.entries()].map(([key, result]) => ({key, result}))});
      const temporary = `${this.#stateFile}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(temporary, payload, {encoding: 'utf8', mode: 0o600}); fs.renameSync(temporary, this.#stateFile);
    } catch (error) { this.#onEvent('action.state_save_failed', {error: error?.message || String(error)}); }
  }
  #inside(root, candidate) {
    const relative = path.relative(root, candidate);
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  }
  #validateWorkdir(action) {
    const requested = action?.payload?.workdir ?? action?.payload?.workingDirectory ?? action?.payload?.cwd;
    if (isAgentAction(action)) return path.resolve(String(requested || this.#workdir));
    if (requested === undefined || requested === null || requested === '') return this.#workdir;
    const candidate = path.resolve(this.#workdir, String(requested));
    if (!this.#inside(this.#workdir, candidate)) throw new Error('A2A action workdir is outside the registered runtime directory');
    const rootReal = fs.realpathSync.native(this.#workdir); let existing = candidate;
    while (!fs.existsSync(existing)) { const parent = path.dirname(existing); if (parent === existing) break; existing = parent; }
    const existingReal = fs.realpathSync.native(existing);
    if (!this.#inside(rootReal, existingReal)) throw new Error('A2A action workdir resolves outside the registered runtime directory');
    return candidate;
  }
  #failure(action, error, extra = {}) {
    const message = error instanceof Error ? error.message : String(error);
    return {status: 'failed', actionId: action?.id, error: message, completedAt: this.#now(), ...extra};
  }
  async #run(action) {
    const actionId = action?.id; const controller = new AbortController(); let timeoutHandle = null; this.#controllers.set(String(actionId), controller);
    try {
      if (!action || typeof action !== 'object') throw new Error('A2A action must be an object');
      const actionType = String(action.type || '').toLowerCase();
      if (actionType === 'agent.cancel' || actionType === 'action.cancel') {
        const target = String(action.payload?.actionId || action.payload?.action_id || ''); const cancelled = this.cancel(target);
        return {status: cancelled ? 'succeeded' : 'failed', actionId, result: {targetActionId: target, cancelled}, completedAt: this.#now(), ...(cancelled ? {} : {error: 'target action is not running'})};
      }
      const expiresAt = action.expiresAt ?? action.expires_at;
      if (expiresAt && Number.isFinite(Date.parse(String(expiresAt))) && Date.parse(String(expiresAt)) <= Date.now()) throw new Error('A2A action expired');
      const workdir = this.#validateWorkdir(action);
      const executableAction = action.payload && typeof action.payload === 'object' ? {...action, payload: {...action.payload, workdir}} : action;
      this.#onEvent('action.started', {actionId, type: action.type});
      const timeoutMs = Math.min(60 * 60 * 1000, Math.max(100, Number(action.payload?.timeoutMs ?? action.payload?.timeout_ms ?? 10 * 60 * 1000)));
      let timedOut = false;
      const timeout = new Promise(resolve => { timeoutHandle = setTimeout(() => { timedOut = true; controller.abort(); resolve({status: 'failed', code: 'action_timeout', error: `A2A action timed out after ${timeoutMs}ms`}); }, timeoutMs); });
      const execution = Promise.resolve().then(() => this.#execute(executableAction, {
        signal: controller.signal,
        onOutput: chunk => {
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
        onStage: stage => this.#onEvent('action.stage', {
          actionId,
          type: action.type,
          stage: stage?.stage || 'output',
          message: stage?.message || '执行活动',
          detail: stage?.detail || '结构化运行时活动',
          ...(stage?.summary ? { summary: stage.summary } : {}),
          progress: { phase: 'stage', ...stage }
        }),
        onProgress: progress => this.#onEvent('action.progress', {
          actionId,
          type: action.type,
          message: progress?.runtime ? `${progress.runtime} 正在执行` : 'CLI 正在执行',
          detail: Number(progress?.bytes) > 0 ? `已接收 ${Number(progress.bytes).toLocaleString()} B 输出` : '正在接收 CLI 输出',
          progress: { phase: 'running', ...progress }
        }),
      }));
      const result = await Promise.race([execution, timeout]); if (timeoutHandle) clearTimeout(timeoutHandle);
      if (timedOut) return {...result, actionId, completedAt: this.#now()};
      if (controller.signal.aborted) return {status: 'failed', actionId, code: 'cancelled', error: 'A2A action cancelled', completedAt: this.#now()};
      const executorStatus = result && typeof result === 'object' ? String(result.status || '') : '';
      if (executorStatus && executorStatus !== 'succeeded') {
        if (executorStatus === 'failed') return this.#failure(action, result.error || 'Local executor failed', {result: result.result, code: result.code || 'executor_failed'});
        return this.#failure(action, `Local executor returned non-terminal status: ${executorStatus}`, {result, code: 'execution_not_completed'});
      }
      const output = executorStatus === 'succeeded' && Object.prototype.hasOwnProperty.call(result, 'result') ? result.result : result;
      const completed = {status: 'succeeded', actionId, result: output, completedAt: this.#now()}; this.#onEvent('action.succeeded', {actionId, type: action.type}); return completed;
    } catch (error) { const failed = this.#failure(action, error); this.#onEvent('action.failed', {actionId, type: action?.type, error: failed.error}); return failed; }
    finally { if (timeoutHandle) clearTimeout(timeoutHandle); this.#controllers.delete(String(actionId)); }
  }
  async dispatch(action) {
    const key = String(action?.dedupeKey ?? action?.dedupe_key ?? action?.id ?? ''); if (!key) return this.#failure(action, 'A2A action requires id or dedupeKey');
    const completed = this.#completed.get(key);
    if (completed) return {status: 'duplicate', actionId: action?.id, originalStatus: completed.status, result: completed.result, error: completed.error, completedAt: completed.completedAt};
    const inFlight = this.#inFlight.get(key);
    if (inFlight) { const result = await inFlight; return {status: 'duplicate', actionId: action?.id, originalStatus: result.status, result: result.result, error: result.error, completedAt: result.completedAt}; }
    const run = this.#run(action); this.#inFlight.set(key, run);
    try { const result = await run; this.#completed.set(key, result); this.#saveState(); return result; }
    finally { if (this.#inFlight.get(key) === run) this.#inFlight.delete(key); }
  }
  cancel(actionId) { const controller = this.#controllers.get(String(actionId)); if (!controller) return false; controller.abort(); this.#onEvent('action.cancelled', {actionId}); return true; }
  status(actionId) { const id = String(actionId); return {actionId: id, running: this.#controllers.has(id), completed: [...this.#completed.values()].find(item => String(item.actionId) === id) || null}; }
}
