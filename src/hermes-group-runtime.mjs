import {executeHermesNative} from './hermes-native-runtime.mjs';
import {executionUncertain} from './hermes-driver-runtime.mjs';

/** One parent lifetime; completed children never close admission for later turns. */
export function createGroupSupervision(onStop=()=>{}) {
  const children=[];let sealed=false,stopping=false,resolveCompletion;
  const completionEvidence=new Promise(resolve=>{resolveCompletion=resolve;});
  const finish=()=>{
    if(!sealed||children.some(item=>!item.evidence))return;
    const evidence=children.map(item=>item.evidence),known=item=>item.treeConfirmed===true&&item.activeProcesses===0;
    resolveCompletion({platform:process.platform,supervisor:'runtime-group',launched:evidence.some(item=>item.launched!==false),rootPid:null,rootExitCode:null,rootConfirmed:evidence.every(item=>item.rootConfirmed===true||item.launched===false&&known(item)),treeConfirmed:evidence.every(known),activeProcesses:evidence.every(known)?0:null,cancelled:stopping||evidence.some(item=>item.cancelled),failureCode:evidence.some(item=>!known(item))?'RUNTIME_GROUP_UNCONFIRMED':null,children:evidence});
  };
  const stopChild=item=>{if(!item.stopped&&!item.evidence){item.stopped=true;Promise.resolve().then(()=>item.child.stop()).catch(()=>{});}};
  return {
    completionEvidence,
    assertRunning(){if(stopping||sealed)throw Object.assign(new Error('GROUP_STOPPED'),{code:'GROUP_STOPPED',definitive:true});},
    add(child){
      const item={child};children.push(item);
      Promise.resolve(child.completionEvidence).then(evidence=>{item.evidence=evidence;finish();},()=>{item.evidence={rootConfirmed:false,treeConfirmed:false,activeProcesses:null};finish();});
      if(stopping||sealed)stopChild(item);
    },
    stop(){if(!stopping){stopping=true;onStop();for(const item of children)stopChild(item);}return completionEvidence;},
    seal(){sealed=true;finish();},
  };
}

/** Replay native Discussion policy one target turn at a time through A2A. */
export async function executeBotGroup(action,options,dependencies={}) {
  const controller=new AbortController(),group=createGroupSupervision(()=>controller.abort());
  const signals=[controller.signal,dependencies.signal,options.signal].filter(Boolean),signal=AbortSignal.any(signals);
  const authorize=async()=>{group.assertRunning();signal.throwIfAborted();await dependencies.authorize?.();group.assertRunning();signal.throwIfAborted();};
  const beforeSpawn=async()=>{group.assertRunning();signal.throwIfAborted();await options.beforeSpawn?.();group.assertRunning();signal.throwIfAborted();};
  const stop=()=>void group.stop();signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop();
  try {
    options.onSupervision?.(group);
    const native=dependencies.native || executeHermesNative;
    const result=await executeGroupTurns(action,{...options,signal,onSupervision:group.add,beforeSpawn},{...dependencies,signal,authorize,
      native:request=>native({...request,beforeSpawn:async()=>{group.assertRunning();signal.throwIfAborted();await request.beforeSpawn?.();group.assertRunning();signal.throwIfAborted();},signal:AbortSignal.any([signal,request.signal].filter(Boolean))}),
      runSource:dependencies.runSource?plan=>dependencies.runSource(plan,{onSupervision:group.add,beforeSpawn:authorize,signal}):undefined});
    group.seal();return{...result,result:{...result.result,processExit:await group.completionEvidence}};
  } finally {group.seal();signal.removeEventListener('abort',stop);}
}

async function executeGroupTurns(action,options,{deviceToken,authorize,signal,native,runSource}) {
  const base=options.apiBase.replace(/\/$/,''),workspace=options.workspace;
  const request=async(path,body,method='POST')=>{const response=await fetch(base+path,{method,headers:{'content-type':'application/json','x-ziwei-device-token':deviceToken},...(body?{body:JSON.stringify({...body,workspace})}:{}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000),redirect:'error'});const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.code || 'GROUP_ADMISSION_REJECTED'),{code:result.code,definitive:true});return result;};
  let current=await native({...options,operation:options.operation.resource==='groups'?{...options.operation,operation:'read'}:options.operation});
  if(current.status!=='succeeded')return current;
  let data=current.result.nativeOperation.data;const groupId=data.room.room_id,runs=[];
  const maximum=Math.min(12,options.context.config.drivers?.maxTotalTurns || 100);
  let target;
  const uncertain=()=>({status:'failed',code:'EXECUTION_UNCERTAIN',executionState:'uncertain',error:'群聊成员或结算结果未知；只核对原 action',result:{code:'EXECUTION_UNCERTAIN',groupId,runs,memberActionId:target?.id}});
  try {
  for(let index=0;data.plan&&index<maximum;index++){
    const plan=data.plan;await authorize();
    target=null;
    try{
      if(plan.payload.target_member_id===options.context.employeeId){
        if(!runSource)throw Object.assign(new Error('GROUP_SOURCE_EXECUTOR_UNAVAILABLE'),{definitive:true});
        const turn=await runSource(plan);
        target={...turn,id:action.id,acked_at:action.acked_at || 'parent',local:true};
      }else{
      const admitted=await request(`/a2a/v1/actions/${action.id}/bot-collaboration`,{mode:'group',groupId,nativeTask:plan,targetEmployeeIds:[plan.payload.target_member_id],content:plan.payload.prompt,idempotencyKey:`group:${plan.identity.task_id}`});target=admitted.actions[0];
      }
    }catch(error){
      if(!error.definitive)return{status:'failed',code:'EXECUTION_UNCERTAIN',executionState:'uncertain',error:'群聊成员派发结果未知，请核对原 action',result:{code:'EXECUTION_UNCERTAIN',groupId,runs,nativeTask:plan.identity}};
      current=await native({...options,operation:{resource:'collaboration',operation:'publish',requestId:options.operation.requestId,input:{groupId,task:plan,status:'deferred',result:{reason:error.code || 'member_unavailable'}}}});
      return{...current,result:{...current.result,groupId,runs,deferred:true}};
    }
    if(executionUncertain(target)||target.status==='expired'&&target.acked_at)return uncertain();
    while(!['succeeded','failed','expired'].includes(target.status)){
      if(signal?.aborted)return{status:'failed',code:'EXECUTION_UNCERTAIN',executionState:'uncertain',error:'群聊仍有未确认终态的成员 action',result:{code:'EXECUTION_UNCERTAIN',groupId,runs,memberActionId:target.id}};
      await new Promise(resolve=>setTimeout(resolve,500));target=await request(`/a2a/v1/actions/${action.id}/bot-collaboration/${target.id}?workspace=${encodeURIComponent(workspace)}`,null,'GET');
    }
    if(executionUncertain(target)||target.status==='expired'&&target.acked_at)return uncertain();
    const text=target.result?.output || target.result?.result?.output || target.result?.text || '';
    runs.push({actionId:target.id,employeeId:plan.payload.target_member_id,nativeTask:plan.identity,status:target.status});
    const settlement=await request(`/a2a/v1/actions/${action.id}/bot-settle`,{});
    if(settlement.allowed!==true)return uncertain();
    current=await native({...options,beforeSpawn:null,signal:AbortSignal.timeout(60000),operation:{resource:'collaboration',operation:'publish',requestId:options.operation.requestId,input:{groupId,task:plan,status:target.status==='succeeded'?'settled':'failed',result:target.status==='succeeded'?{text}:{error:target.error || 'member_failed'}}}});
    if(current.status!=='succeeded')return{...current,code:'EXECUTION_UNCERTAIN',executionState:'uncertain',result:{...current.result,code:'EXECUTION_UNCERTAIN',groupId,runs}};
    data=current.result.nativeOperation.data;if(!settlement.allowEvaluation)break;
  }
  }catch{return uncertain();}
  return{...current,result:{...current.result,nativeGroup:{groupId,runs,bounded:Boolean(data.plan),decision:data.decision},output:runs.length?`群聊已完成 ${runs.length} 个成员回合`:''}};
}
