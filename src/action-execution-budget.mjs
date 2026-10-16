export const NATIVE_LONG_TASK_TIMEOUT_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_ACTION_EXECUTION_TIMEOUT_MS = 15 * 60 * 1000;
export const ACTION_EXECUTION_LEASE_BUFFER_MS = 60 * 1000;

const longTasks = new Set(['conversation.execute', 'agent.execute', 'runtime.execute', 'automation.execute']);
export function actionExecutionTimeoutMs(action = {}) {
  const payload = action.payload || {}, value = payload.timeoutMs ?? payload.timeout_ms;
  if (value !== undefined && value !== null && String(value).trim() !== '' && Number.isFinite(Number(value))) {
    // Node timers accept signed 32-bit delays; an overflow would stop immediately.
    return Math.min(2 ** 31 - 1, Math.max(100, Number(value)));
  }
  const type = String(action.type || '').toLowerCase();
  const nativeTask = type === 'task.execute' && Boolean(payload.runtime || payload.agent || payload.modelId || payload.prompt);
  const operation = payload.nativeOperation || {};
  const nativeDriver = type === 'hermes.bot.native' && (
    ['groups.step', 'goals.step', 'heartbeat.step', 'kanban.dispatch'].includes(`${operation.resource}.${operation.operation}`)
    || operation.resource === 'collaboration' && operation.input?.mode === 'group'
  );
  return longTasks.has(type) || nativeTask || nativeDriver ? NATIVE_LONG_TASK_TIMEOUT_MS : DEFAULT_ACTION_EXECUTION_TIMEOUT_MS;
}

export function actionExecutionLeaseMs(action = {}) {
  // A deliberately short execution still needs the existing result-upload and
  // retry window. This lease does not extend the dispatcher's execution timer.
  return Math.max(DEFAULT_ACTION_EXECUTION_TIMEOUT_MS, actionExecutionTimeoutMs(action)) + ACTION_EXECUTION_LEASE_BUFFER_MS;
}
