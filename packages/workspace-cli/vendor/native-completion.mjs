// Generated from backend/repository.mjs; pure original completion semantics only.
import {terminalMcpExecutionFailure} from './phone-completion.mjs';
export const uncertainCompletion = value => Boolean(value && typeof value === 'object' && (value.code === 'EXECUTION_UNCERTAIN' || value.executionState === 'uncertain' || value.status === 'uncertain' || Object.entries(value).some(([key, item]) => {
  // Phone audit calls are observations over time. A later receipt for the same
  // submitted ID supersedes its earlier uncertainty; an unrelated success does not.
  if (key === 'terminalMcp' && item?.loaded === true && Array.isArray(item.toolCalls || item.tool_calls) && (item.toolCalls || item.tool_calls).some(call => ['ziwei_phone_action', 'ziwei_phone_screenshot', 'ziwei_phone_upgrade'].includes(call.toolName)))
    return terminalMcpExecutionFailure(item)?.phoneExecutionState === 'uncertain';
  return uncertainCompletion(item);
})));
