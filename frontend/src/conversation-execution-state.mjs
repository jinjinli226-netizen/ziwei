import {mergeConversationLatest} from './conversation-history.mjs';
import {historicalPrelaunchRecovery,HISTORICAL_PRELAUNCH_RECOVERY_DETAIL} from './historical-prelaunch-recovery.mjs';
import {operatorForceAbandonRecovery,OPERATOR_FORCE_ABANDON_DETAIL} from './operator-force-abandon-recovery.mjs';
import {failureFinalization,finalizationPresentation} from './bot-failure-finalization.mjs';
const terminal = new Set(['succeeded','failed','expired','cancelled']);
const uncertainExecution = execution => execution?.result?.code === 'EXECUTION_UNCERTAIN' || execution?.code === 'EXECUTION_UNCERTAIN' || execution?.result?.executionState === 'uncertain' || execution?.status === 'uncertain' || (execution?.status === 'expired' && Boolean(execution?.acked_at));

// Background cleanup never keeps a failed conversation polling.
export function executionNeedsPolling(execution,bot) {
  return Boolean(execution && ['pending','acked'].includes(execution.status) && !uncertainExecution(execution));
}

export function executionPresentation(execution) {
  const finalization=finalizationPresentation(failureFinalization(execution));
  if(finalization)return finalization;
  if(operatorForceAbandonRecovery(execution))return {label:OPERATOR_FORCE_ABANDON_DETAIL,summary:'已强制放弃 · 原结果未知',busy:false,tone:'muted',retryable:false};
  if(historicalPrelaunchRecovery(execution))return {label:HISTORICAL_PRELAUNCH_RECOVERY_DETAIL,summary:'原模型未启动 · 已恢复',busy:false,tone:'muted',retryable:false};
  const status = execution?.status;
  const uncertain = uncertainExecution(execution);
  if (uncertain) return {label:'本轮执行失败',summary:'失败',busy:false,tone:'error',retryable:false};
  const labels = {
    pending:['已提交，等待 ziwei_user 接收','等待接收'],
    acked:['数字伙伴执行中','执行中'],
    succeeded:['数字伙伴已完成','已完成'],
    failed:['执行失败','失败'],
    expired:['执行已超时','已超时'],
    cancelled:['执行已取消','已取消'],
  };
  const [label,summary] = labels[status] || (status ? [`状态：${status}`,`状态：${status}`] : ['','']);
  return { label,summary,busy:['pending','acked'].includes(status),tone:status==='succeeded'?'success':terminal.has(status)?'error':['pending','acked'].includes(status)?'running':'idle',retryable:['failed','expired'].includes(status) };
}

function newestExecution(previous, incoming) {
  if (!previous) return incoming ?? null;
  if (!incoming) return previous;
  if (previous.id === incoming.id) {
    if (terminal.has(previous.status) && !terminal.has(incoming.status)) return previous;
    if (previous.status==='acked' && incoming.status==='pending') return previous;
    return incoming;
  }
  const before=Date.parse(previous.created_at),after=Date.parse(incoming.created_at);
  return Number.isFinite(before) && Number.isFinite(after) && before>after ? previous : incoming;
}

export function mergeConversationDetail(previous, incoming) {
  if (!previous || previous.id!==incoming?.id) return incoming;
  // A sequenced detail can explicitly clear execution; a list or omitted field cannot.
  const execution=incoming.execution===null?null:newestExecution(previous.execution,incoming.execution);
  const merged=mergeConversationLatest(previous,incoming);
  return execution===previous.execution && execution!==incoming.execution
    ? { ...merged,execution,messages:previous.messages }
    : { ...merged,execution };
}

// A list snapshot never becomes the selected detail authority. The selected
// execution is copied to its row until a sequenced detail refresh accepts more.
export function mergeConversationLists(previous, incoming, selected) {
  const known=new Map((previous || []).map(item=>[item.id,item]));
  return (incoming || []).map(item=>{
    const old=known.get(item.id);
    if (item.id===selected?.id) return { ...item,execution:selected.execution ?? null,message_count:Math.max(Number(item.message_count)||0,selected.messages?.length || 0) };
    return old ? { ...item,execution:newestExecution(old.execution,item.execution) } : item;
  });
}

const scopeKey = scope => JSON.stringify([scope.workspace,scope.employee,scope.generation]);
export function createConversationRequestSequence() {
  let sequence=0,currentScope='';
  const latest=new Map();
  return {
    begin(scope,channel,id='') {
      const key=scopeKey(scope);
      if (key!==currentScope) { currentScope=key;latest.clear(); }
      const request={scope:key,key:`${channel}\0${id}`,sequence:++sequence};
      latest.set(request.key,request.sequence);
      return request;
    },
    isCurrent(request,scope) {
      return request.scope===scopeKey(scope) && request.scope===currentScope && latest.get(request.key)===request.sequence;
    },
  };
}
