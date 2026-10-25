// Pure producer/replay policy shared by runtime and local history inspection.
import {redactSecrets} from './redaction.mjs';
const phoneExecutionStates = new Set(['not_started', 'succeeded', 'failed', 'uncertain', 'pending']);
export const phoneDiagnostic = value => typeof value === 'string' ? redactSecrets(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, 800) : '';
export const phoneReceiptMetadata = (value, prefix = '') => {
  const error = phoneDiagnostic(value?.[`${prefix}Error`] ?? value?.error);
  const executionState = value?.[`${prefix}ExecutionState`] ?? value?.executionState;
  const executingConfirmed = value?.[`${prefix}ExecutingConfirmed`] ?? value?.executingConfirmed;
  const errorCode = value?.[`${prefix}ErrorCode`] ?? value?.errorCode;
  return { ...(error ? { error } : {}), ...(phoneExecutionStates.has(executionState) ? { executionState } : {}), ...(typeof executingConfirmed === 'boolean' ? { executingConfirmed } : {}), ...(typeof errorCode === 'string' && /^[A-Z0-9_]{1,100}$/.test(errorCode) ? { errorCode } : {}) };
};
export function terminalMcpExecutionFailure(receipt) {
  if (!receipt) return null;
  if (!receipt.loaded) return { code: 'terminal_mcp_not_loaded', error: `${receipt.runtime} 已退出但未收到手机 MCP 实际握手；恢复目标为独立 profile、工具配置及本机 MCP 连接` };
  const calls = receipt.toolCalls || receipt.tool_calls || [];
  const issued = new Map();
  const unconfirmedSubmissions = [];
  for (const call of calls) {
    const submits = ['ziwei_phone_action', 'ziwei_phone_screenshot', 'ziwei_phone_upgrade'].includes(call.toolName);
    if (submits && call.ok !== true && !call.commandId && !call.updateId && !call.ids?.commandId && !call.ids?.updateId) unconfirmedSubmissions.push({ toolName: call.toolName, ...phoneReceiptMetadata(call, 'command'), error: phoneDiagnostic(call.error) || '工具请求未成功' });
    for (const kind of ['command', 'update']) {
      const id = call[`${kind}Id`] || call.ids?.[`${kind}Id`];
      if (!id) continue;
      const key = `${kind}:${id}`;
      if (submits && !issued.has(key)) issued.set(key, { kind, id, status: null });
      const item = issued.get(key);
      if (item && call.ok === true && (call[`${kind}Status`] || call.status)) Object.assign(item, { status: call[`${kind}Status`] || call.status }, kind === 'command' ? phoneReceiptMetadata(call, 'command') : {});
    }
    if (call.ok === true) for (const original of call.receipts || []) {
      for (const kind of ['command', 'update']) {
        const item = issued.get(`${kind}:${original[`${kind}Id`]}`);
        if (item && original.status) Object.assign(item, { status: original.status }, kind === 'command' ? phoneReceiptMetadata(original) : {});
      }
    }
  }
  const failureStatuses = new Set(['failed', 'expired', 'cancelled', 'superseded', 'aborted', 'rejected', 'timed_out']);
  const incomplete = [...issued.values()].filter(item => item.status !== (item.kind === 'update' ? 'committed' : 'succeeded'));
  const unresolved = incomplete.some(item => !failureStatuses.has(item.status) || item.executionState === 'uncertain') || unconfirmedSubmissions.some(item => item.executionState !== 'not_started');
  if (incomplete.length || unconfirmedSubmissions.length) {
    // A known failure must not hide a second command whose effects are unknown.
    const phoneExecutionState = unresolved ? 'uncertain' : issued.size === incomplete.length && [...incomplete, ...unconfirmedSubmissions].every(item => item.executionState === 'not_started') ? 'not_started' : 'failed';
    const ids = { commandIds: incomplete.filter(item => item.kind === 'command').map(item => item.id), updateIds: incomplete.filter(item => item.kind === 'update').map(item => item.id) };
    const observationErrors = calls.filter(call => !call.ok && !['ziwei_phone_action', 'ziwei_phone_screenshot', 'ziwei_phone_upgrade'].includes(call.toolName)).map(call => phoneDiagnostic(call.error)).filter(Boolean);
    const detail = [...incomplete.map(item => `${item.id}: ${item.executionState === 'not_started' ? '未执行' : item.status || 'unknown'}${item.error ? `，${item.error}` : ''}`), ...unconfirmedSubmissions.map(item => `${item.toolName}: ${item.error}`), ...observationErrors.map(error => `回执观察：${error}`)].join('、');
    return { code: unresolved ? 'terminal_mcp_receipt_incomplete' : 'terminal_mcp_receipt_failed', phoneExecutionState, retryAllowed: false, nextAction: 'observe', error: `${receipt.runtime} 手机动作${phoneExecutionState === 'uncertain' ? '执行结果未确认' : phoneExecutionState === 'not_started' ? '未执行' : '执行失败'}（${detail}）；${unresolved ? '系统继续读取原回执和当前页面，不重放动作' : '已保留原回执，恢复时只补未完成步骤，不重跑整轮业务'}`, ...ids };
  }
  if (calls.length && !calls.some(item => item.ok === true)) return { code: 'terminal_mcp_tools_failed', nextAction: 'observe', error: `${receipt.runtime} 手机 MCP 已加载，但实际尝试的工具全部失败；${calls.map(item => phoneDiagnostic(item.error)).filter(Boolean).join('、') || '手机绑定、技能安装或执行授权尚未恢复'}` };
  return null;
}

