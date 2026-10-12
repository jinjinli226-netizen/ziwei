import {executionUncertain} from './bot-presentation.js';

export const nativeReceipt=action=>action?.result?.nativeOperation||action?.result?.result?.nativeOperation||null;
function failure(message,status=422,code='NATIVE_RECEIPT_INVALID'){return Object.assign(new Error(message),{status,code});}
const readDescriptors={memory:['memory','read'],sessions:['sessions','list'],skills:['skills','list'],skillDetail:['skills','read'],skillHub:['skills','hub_search'],mcp:['mcp','inspect'],goals:['goals','status'],heartbeat:['heartbeat','status'],kanban:['kanban','list'],kanbanDetail:['kanban','show'],gateway:['gateway','status'],voice:['voice','status'],groups:['groups','list'],groupDetail:['groups','read']};

export function createNativeBotTransport({api,getBot,onBotChanged=async()=>{},keyFactory=()=>crypto.randomUUID(),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),pollLimit=80}){
  function snapshot(context){
    const bot=getBot();
    if(!bot||bot.id!==context.botId||bot.workspace&&bot.workspace!==context.workspace)throw failure('当前员工归属已变化，请重新读取',409,'NATIVE_SCOPE_CHANGED');
    return {expectedRevision:context.expectedRevision??bot.revision,expectedControlEpoch:context.expectedControlEpoch??bot.control_epoch};
  }
  function checked(action,context,expectedResource){
    const receipt=nativeReceipt(action);
    const operation=context.resource==='collaboration'?'message':context.operation;
    const revision=action?.payload?.hermesBot?.revision??context.expectedRevision;
    const binding=action?.payload?.hermesBot;if(binding&&(binding.employeeId&&binding.employeeId!==context.botId||binding.workspace&&binding.workspace!==context.workspace))throw failure('原执行的员工或工作区归属不一致');
    const request=action?.payload?.nativeOperation;
    if(request&&(expectedResource&&request.resource!==expectedResource||operation&&request.operation!==operation))throw failure('原生动作的资源或操作归属与原意图不一致');
    let matched=(!expectedResource||receipt?.resource===expectedResource)&&(!operation||receipt?.operation===operation);
    // E02 controlled drivers return their final native stage. Only these exact
    // documented stages may differ, and only with the original public payload.
    // Keep the raw native receipt for evidence; never rewrite it into success.
    if(receipt&&request&&request.resource===expectedResource&&request.operation===operation){
      if(['goals.step','heartbeat.step','kanban.dispatch'].includes(expectedResource+'.'+operation)&&receipt.resource===expectedResource&&['_prepare','_settle','_fail'].includes(receipt.operation))matched=true;
      if(expectedResource==='groups'&&operation==='step'&&(receipt.resource==='groups'&&receipt.operation==='read'||receipt.resource==='collaboration'&&receipt.operation==='publish'))matched=true;
      if(expectedResource==='collaboration'&&operation==='message'&&request.input?.mode==='group'&&receipt.resource==='collaboration'&&receipt.operation==='publish')matched=true;
    }
    if(receipt&&(receipt.schemaVersion!==2||receipt.employeeId!==context.botId||!matched||revision!=null&&receipt.revision!==revision))throw failure('原生回执版本、员工、资源或操作归属不一致');
    if(request&&context.idempotencyKey&&request.requestId!==context.idempotencyKey)throw failure('原生动作的请求标识与原意图不一致');
    if(action?.status==='succeeded'&&!receipt)throw failure('执行已结束但没有原生能力回执，请查看原动作证据');
    return action;
  }
  async function action(context){
    const list=await api.botRuns(context.botId,context.workspace),found=(list.runs||[]).find(item=>item.id===context.actionId);
    if(!found)throw failure('尚未找到原执行回执；保留原请求标识，勿重发新意图',404,'NATIVE_ACTION_NOT_FOUND');
    return checked(found,context,context.resource==='collaboration'?'collaboration':readDescriptors[context.resource]?.[0]);
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
    if(context.resource==='collaboration'){
      const list=await api.botRuns(context.botId,context.workspace);
      const roots=(list.runs||[]).filter(item=>item.payload?.nativeOperation?.resource==='collaboration'||item.payload?.nativeOperation?.resource==='groups'||item.payload?.collaboration?.sourceEmployeeId===context.botId||item.id===context.query?.sourceActionId),references=[...(context.query?.actionRefs||[])];
      for(const root of roots){for(const row of root.result?.collaboration?.actions||[])references.push({...row,sourceActionId:root.id});for(const row of root.result?.nativeGroup?.runs||[])references.push({id:row.actionId,employeeId:row.employeeId,sourceActionId:root.id});}
      const targets=new Set([...references.map(row=>row.employeeId),...(context.query?.targetEmployeeIds||[]),...(getBot()?.config?.collaboration?.targetEmployeeIds||[])]),children=[];
      for(const target of targets){if(!target||target===context.botId)continue;if(context.current&&!context.current())throw failure('已离开原员工',499,'NATIVE_SCOPE_CHANGED');const result=await api.botRuns(target,context.workspace),expected=references.filter(row=>row.employeeId===target);
        for(const reference of expected){const found=(result.runs||[]).find(row=>row.id===reference.id);if(!found){children.push({...reference,status:'unresolved',error:'最近运行记录未找到原执行，请保留原 ID 核对。'});continue;}checkedChild(found,context,{sourceActionId:reference.sourceActionId,targetEmployeeIds:[target]});children.push(found);}
        if(context.query?.sourceActionId)for(const row of result.runs||[])if(row.payload?.collaboration?.sourceActionId===context.query.sourceActionId&&row.payload?.collaboration?.sourceEmployeeId===context.botId&&!children.some(child=>child.id===row.id)){checkedChild(row,context,{...context.query,targetEmployeeIds:[target]});children.push(row);}
      }
      return {workspace:context.workspace,botId:context.botId,revision:getBot()?.revision,data:{runs:[...roots.map(row=>({...row,collaborationRole:'source'})),...children.map(row=>({...row,collaborationRole:'target'}))]}};
    }
    const descriptor=readDescriptors[context.resource];if(!descriptor)throw failure('此原生资源读取尚未接入',400,'NATIVE_RESOURCE_UNSUPPORTED');
    const [resource,defaultOperation]=descriptor,input={...(context.query||{})};let operation=defaultOperation;
    if(context.resource==='sessions')operation=input.sessionId?'read':input.query?'search':'list';
    const body={...snapshot(context),idempotencyKey:keyFactory(),resource,operation,input};
    if(context.current&&!context.current())throw failure('已离开原员工',499,'NATIVE_SCOPE_CHANGED');
    const response=await api.botNativeAction(context.botId,body,context.workspace);
    return settle(response.action,{...context,expectedRevision:body.expectedRevision,expectedControlEpoch:body.expectedControlEpoch,idempotencyKey:body.idempotencyKey,operation},resource);
  }
  async function submit(context){
    const resource=context.resource==='collaboration'?'collaboration':readDescriptors[context.resource]?.[0];if(!resource)throw failure('此原生操作尚未接入',400,'NATIVE_RESOURCE_UNSUPPORTED');
    const response=resource==='collaboration'?await api.collaborateBot(context.botId,{...snapshot(context),idempotencyKey:context.idempotencyKey,mode:context.operation,...context.input},context.workspace):await api.botNativeAction(context.botId,{...snapshot(context),idempotencyKey:context.idempotencyKey,resource,operation:context.operation,input:context.input||{}},context.workspace);
    try{
      if(resource==='collaboration'&&Array.isArray(response.actions)){
        if(!response.actions.length||response.actions.length!==new Set(context.input?.targetEmployeeIds||[]).size)throw failure('协作派发回执未包含全部精确目标');
        const targets=new Set();for(const child of response.actions){checkedChild(child,context,context.input);targets.add(child.payload.employeeId);}if(targets.size!==response.actions.length)throw failure('协作目标回执重复');
        return {kind:'collaboration',actions:response.actions};
      }
      const accepted=checked(response.action,context,resource);
      if(!accepted?.id||!accepted.status)throw failure('操作已受理，但没有可核对的执行标识');
      if(accepted?.payload?.hermesBot?.revision!=null&&accepted.payload.hermesBot.revision!==getBot()?.revision)await onBotChanged(context);
      return {kind:'action',action:accepted};
    }catch(error){error.accepted=true;throw error;}
  }
  function checkedChild(child,context,lineage){const payload=child?.payload,relation=payload?.collaboration;if(!child?.id||!child.status||payload?.hermesBot?.workspace!==context.workspace||payload.hermesBot.employeeId!==payload.employeeId||!lineage.targetEmployeeIds?.includes(payload.employeeId)||relation?.sourceEmployeeId!==context.botId||relation.sourceActionId!==lineage.sourceActionId)throw failure('协作目标、工作区或来源执行归属不一致');return child;}
  async function lookup(context){
    const lineage=context.readHints;if(context.resource==='collaboration'&&lineage?.sourceActionId){
      // repository.dispatchBotCollaboration persists this exact public A2A
      // dedupe key. It remains readable after the source ends. Never infer a
      // batch merely from a shared sourceActionId or replay a lost dispatch.
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([context.botId,lineage.sourceActionId,context.idempotencyKey]))),prefix='bot-target:'+Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('')+':',actions=[];
      for(const target of lineage.targetEmployeeIds||[]){const list=await api.botRuns(target,context.workspace),found=(list.runs||[]).find(row=>row.dedupe_key===prefix+target);if(!found)throw failure('最近运行记录尚未定位原协作批次；保留原请求，不重新派发',404,'NATIVE_ACTION_NOT_FOUND');checkedChild(found,context,lineage);actions.push(found);}
      if(!actions.length)throw failure('原协作缺少精确目标元数据',422);return {kind:'collaboration',actions};
    }
    const list=await api.botRuns(context.botId,context.workspace),found=(list.runs||[]).find(item=>item.payload?.nativeOperation?.requestId===context.idempotencyKey);if(!found)throw failure('尚未定位原请求；原意图保留，请在运行记录核对',404,'NATIVE_ACTION_NOT_FOUND');return checked(found,context,context.resource==='collaboration'?'collaboration':readDescriptors[context.resource]?.[0]);
  }
  return {read,submit,action,lookup,freeze:context=>({...context,...snapshot(context)})};
}
