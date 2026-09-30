import fs from 'node:fs';
import path from 'node:path';

export class ActionDispatcher {
  #completed = new Map();
  #inFlight = new Map();
  #execute;
  #now;
  #workdir;
  #onEvent;
  constructor({execute, now = () => Date.now(), workdir = process.cwd(), onEvent = () => {}}) {
    if (typeof execute !== 'function') throw new TypeError('ActionDispatcher requires an execute function');
    this.#execute = execute;
    this.#now = now;
    this.#workdir = path.resolve(workdir);
    this.#onEvent = onEvent;
  }
  #inside(root, candidate) {
    const relative = path.relative(root, candidate);
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  }
  #validateWorkdir(action) {
    const requested = action?.payload?.workdir ?? action?.payload?.workingDirectory ?? action?.payload?.cwd;
    if (requested === undefined || requested === null || requested === '') return this.#workdir;
    const candidate = path.resolve(this.#workdir, String(requested));
    if (!this.#inside(this.#workdir, candidate)) {
      throw new Error('A2A action workdir is outside the registered runtime directory');
    }
    // Lexical checks are insufficient when a runtime directory contains a
    // symlink/junction. Resolve the existing part of the path and check that
    // physical location as well. Non-existent children remain safe because
    // their nearest existing parent is checked.
    const rootReal = fs.realpathSync.native(this.#workdir);
    let existing = candidate;
    while (!fs.existsSync(existing)) {
      const parent = path.dirname(existing);
      if (parent === existing) break;
      existing = parent;
    }
    const existingReal = fs.realpathSync.native(existing);
    if (!this.#inside(rootReal, existingReal)) {
      throw new Error('A2A action workdir resolves outside the registered runtime directory');
    }
    return candidate;
  }
  #failure(action, error, extra = {}) {
    const message = error instanceof Error ? error.message : String(error);
    return {status: 'failed', actionId: action?.id, error: message, completedAt: this.#now(), ...extra};
  }
  async #run(action) {
    const actionId = action?.id;
    try {
      if (!action || typeof action !== 'object') throw new Error('A2A action must be an object');
      const expiresAt = action.expiresAt ?? action.expires_at;
      if (expiresAt && Number.isFinite(Date.parse(String(expiresAt))) && Date.parse(String(expiresAt)) <= Date.now()) {
        throw new Error('A2A action expired');
      }
      const workdir = this.#validateWorkdir(action);
      const executableAction = action.payload && typeof action.payload === 'object'
        ? {...action, payload: {...action.payload, workdir}}
        : action;
      this.#onEvent('action.started', {actionId, type: action.type});
      const timeoutMs = Math.min(10 * 60 * 1000, Math.max(100, Number(action.payload?.timeoutMs ?? action.payload?.timeout_ms ?? 60_000)));
      let timeoutHandle;
      try {
        const timeout = new Promise((_, reject) => { timeoutHandle = setTimeout(() => reject(new Error(`A2A action timed out after ${timeoutMs}ms`)), timeoutMs); });
        const result = await Promise.race([Promise.resolve().then(() => this.#execute(executableAction)), timeout]);
        // An executor may return a structured terminal result. `accepted`,
        // `queued`, and `running` are transport states, never execution success.
        const executorStatus = result && typeof result === 'object' ? String(result.status || '') : '';
        if (executorStatus && executorStatus !== 'succeeded') {
          if (executorStatus === 'failed') return this.#failure(action, result.error || 'Local executor failed', {result: result.result, code: result.code || 'executor_failed'});
          return this.#failure(action, `Local executor returned non-terminal status: ${executorStatus}`, {result, code: 'execution_not_completed'});
        }
        const output = executorStatus === 'succeeded' && Object.prototype.hasOwnProperty.call(result, 'result') ? result.result : result;
        const completed = {status: 'succeeded', actionId, result: output, completedAt: this.#now()};
        this.#onEvent('action.succeeded', {actionId, type: action.type});
        return completed;
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      }
    } catch (error) {
      const failed = this.#failure(action, error);
      this.#onEvent('action.failed', {actionId, type: action?.type, error: failed.error});
      return failed;
    }
  }
  async dispatch(action) {
    const key = String(action?.dedupeKey ?? action?.dedupe_key ?? action?.id ?? '');
    if (!key) return this.#failure(action, 'A2A action requires id or dedupeKey');
    const completed = this.#completed.get(key);
    if (completed) return {status: 'duplicate', actionId: action?.id, originalStatus: completed.status, result: completed.result, completedAt: completed.completedAt};
    const inFlight = this.#inFlight.get(key);
    if (inFlight) {
      const result = await inFlight;
      return {status: 'duplicate', actionId: action?.id, originalStatus: result.status, result: result.result, error: result.error, completedAt: result.completedAt};
    }
    const run = this.#run(action);
    this.#inFlight.set(key, run);
    try {
      const result = await run;
      // Failed actions are deliberately not cached: a later delivery with the
      // same idempotency key can retry after a transient local failure. Only a
      // completed execution is a duplicate on subsequent delivery.
      if (result.status === 'succeeded') this.#completed.set(key, result);
      return result;
    } finally {
      if (this.#inFlight.get(key) === run) this.#inFlight.delete(key);
    }
  }
}
