import {executionUncertain} from './bot-presentation.js';

export const nativeReceipt=action=>action?.result?.nativeOperation||action?.result?.result?.nativeOperation||null;
function failure(message,status=422,code='NATIVE_RECEIPT_INVALID'){return Object.assign(new Error(message),{status,code});}
const readDescriptors={memory:['memory','read'],sessions:['sessions','list'],skills:['skills','list'],skillDetail:['skills','read'],skillHub:['skills','hub_search'],mcp:['mcp','inspect'],goals:['goals','status'],heartbeat:['heartbeat','status'],kanban:['kanban','list'],kanbanDetail:['kanban','show'],gateway:['gateway','status'],voice:['voice','status']};

export function createNativeBotTransport({api,getBot,keyFactory=()=>crypto.randomUUID(),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),pollLimit=80}){
  function snapshot(context){
    const bot=getBot();
    if(!bot||bot.id!==context.botId||bot.workspace&&bot.workspace!==context.workspace)throw failure('当前员工归属已变化，请重新读取',409,'NATIVE_SCOPE_CHANGED');
    return {expectedRevision:context.expectedRevision??bot.revision,expectedControlEpoch:bot.control_epoch};
  }
  function checked(action,context,expectedResource){
    const receipt=nativeReceipt(action);
    if(receipt&&(receipt.employeeId!==context.botId||expectedResource&&receipt.resource!==expectedResource))throw failure('原生回执员工或资源归属不一致');
    if(action?.status==='succeeded'&&!receipt)throw failure('执行已结束但没有原生能力回执，请查看原动作证据');
    return action;
  }
  async function action(context){
    const list=await api.botRuns(context.botId,context.workspace),found=(list.runs||[]).find(item=>item.id===context.actionId);
    if(!found)throw failure('尚未找到原执行回执；保留原请求标识，勿重发新意图',404,'NATIVE_ACTION_NOT_FOUND');
    return checked(found,context);
  }
  async function settle(accepted,context,resource){
    let current=checked(accepted,context,resource);
    for(let index=0;['pending','acked','queued','running'].includes(current?.status)&&index<pollLimit;index++){
      if(context.current&&!context.current())throw failure('已离开原员工，停止界面查询',499,'NATIVE_SCOPE_CHANGED');
      await wait(750);current=checked(await action({...context,actionId:accepted.id}),context,resource);
    }
    if(executionUncertain(current))throw failure('原执行结果待核实，请查看原动作，不提交新的意图',409,'EXECUTION_UNCERTAIN');
    if(current?.status!=='succeeded')throw failure(current?.error||'原生读取尚未完成，请查看运行回执',current?.status==='failed'?422:408,'NATIVE_READ_NOT_COMPLETED');
    const receipt=nativeReceipt(current);
    if(receipt.status!=='succeeded')throw failure(receipt.data?.reason||receipt.data?.error||'原生能力需要授权或依赖',412,'NATIVE_'+String(receipt.status).toUpperCase());
    return {workspace:context.workspace,botId:context.botId,revision:receipt.revision,data:receipt.data,receipt,action:current};
  }
  async function read(context){
    const descriptor=readDescriptors[context.resource];if(!descriptor)throw failure('此原生资源读取尚未接入',400,'NATIVE_RESOURCE_UNSUPPORTED');
    const [resource,defaultOperation]=descriptor,input={...(context.query||{})};let operation=defaultOperation;
    if(context.resource==='sessions')operation=input.sessionId?'read':input.query?'search':'list';
    const body={...snapshot(context),idempotencyKey:keyFactory(),resource,operation,input};
    if(context.current&&!context.current())throw failure('已离开原员工',499,'NATIVE_SCOPE_CHANGED');
    const response=await api.botNativeAction(context.botId,body,context.workspace);
    return settle(response.action,context,resource);
  }
  async function submit(context){
    const resource=readDescriptors[context.resource]?.[0];if(!resource)throw failure('此原生操作尚未接入',400,'NATIVE_RESOURCE_UNSUPPORTED');
    const response=await api.botNativeAction(context.botId,{...snapshot(context),idempotencyKey:context.idempotencyKey,resource,operation:context.operation,input:context.input||{}},context.workspace);
    return {kind:'action',action:checked(response.action,context,resource)};
  }
  return {read,submit,action};
}
