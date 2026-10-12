import {executeHermesNative} from './hermes-native-runtime.mjs';

export const executionUncertain=value=>Boolean(value&&typeof value==='object'&&(value.code==='EXECUTION_UNCERTAIN'||value.executionState==='uncertain'||executionUncertain(value.result)));

/** A claimed native tick has one model turn and one settlement; never replay it. */
export async function executeNativeDriver(action,options,{prepareManagement,runTurn,settlement,native=executeHermesNative}={}) {
  const operation=options.operation;
  let prepared;
  try{prepared=await native({...options,operation:{...operation,operation:'_prepare'}});}
  catch(error){return{status:'failed',...(error.definitelyNotStarted===true?{}:{code:'EXECUTION_UNCERTAIN',executionState:'uncertain'}),error:'原生 prepare 没有可验证回执',result:{code:error.definitelyNotStarted===true?'NATIVE_OPERATION_REJECTED':'EXECUTION_UNCERTAIN'}};}
  if(prepared.status!=='succeeded'||!prepared.result.nativeOperation.data.run)return prepared;
  const data=prepared.result.nativeOperation.data;
  let turn,modelRequested=false;
  const uncertain=()=>({status:'failed',code:'EXECUTION_UNCERTAIN',executionState:'uncertain',error:'原生回合结算无法确认；只核对原回执，不重新执行',result:{code:'EXECUTION_UNCERTAIN',turn:turn?.result}});
  try {
    const management=await prepareManagement();
    modelRequested=true;
    turn=await runTurn(data,management);
  }catch(error){turn={status:'failed',error:'Native driver turn rejected',result:{neverStarted:!modelRequested||error.definitelyNotStarted===true}};}
  if(executionUncertain(turn))return {...turn,code:'EXECUTION_UNCERTAIN',executionState:'uncertain'};
  try {
    const authority=await settlement();
    if(authority.allowed!==true)return uncertain();
    const settled=await native({...options,beforeSpawn:null,signal:AbortSignal.timeout(60000),operation:{...operation,operation:turn.status==='succeeded'?'_settle':'_fail',input:{...operation.input,response:turn.result?.output || '',actionId:action.id,evaluate:authority.allowEvaluation,neverStarted:turn.result?.neverStarted===true||turn.result?.processExit?.launched===false,...(data.task?{runId:data.task.current_run_id}:{})}}});
    if(settled.status!=='succeeded')return {...settled,...uncertain(),result:{...settled.result,...uncertain().result}};
    return {...settled,...(turn.status!=='succeeded'?{status:'failed',error:turn.error}:{}),result:{...settled.result,turn:turn.result,didRun:turn.status==='succeeded',output:turn.result?.output || ''}};
  }catch{return uncertain();}
}
