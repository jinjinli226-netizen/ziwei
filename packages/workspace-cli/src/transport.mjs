import {CliError,fail,httpFailure} from './errors.mjs';
import {uncertainCompletion} from '../vendor/native-completion.mjs';
export async function requestJson({origin,path,method='GET',body,query,credential,timeout=30000,signal,fetchImpl=globalThis.fetch,resultQuery=null,idempotencyKey}){
  const mutation=!['GET','HEAD'].includes(method);let sent=false,timer,abortListener;
  const controller=new AbortController();
  const uncertain=()=>({outcomeUnknown:mutation&&sent,resultQuery,...(idempotencyKey?{idempotencyKey}:{}),reconciliation:mutation&&sent?'Do not repeat the mutation automatically. Read the original resource or original server action; retain the original idempotency key.':null});
  if(signal?.aborted)fail('CANCELLED','Cancelled before request dispatch',uncertain());
  if(typeof fetchImpl!=='function')fail('SERVICE_UNAVAILABLE','This Node runtime does not provide fetch');
  const url=new URL(path,origin);for(const[key,value]of Object.entries(query||{}))if(value!==undefined&&value!==null&&value!=='')url.searchParams.set(key,String(value));
  if(url.origin!==origin)fail('USAGE','A workspace request cannot leave its selected origin');
  const headers={accept:'application/json'};
  if(credential?.mode==='native')headers.cookie=`ziwei_session=${encodeURIComponent(credential.session)}`;
  if(credential?.mode==='managed')headers.authorization=`Bearer ${credential.token}`;
  if(body!==undefined)headers['content-type']='application/json';
  // One dispatch only. The end-to-end deadline includes response-body consumption.
  const abortPromise=new Promise((_,reject)=>{
    timer=setTimeout(()=>{controller.abort();reject(new CliError(mutation&&sent?'OUTCOME_UNKNOWN':'SERVICE_UNAVAILABLE','Workspace request timed out',uncertain()));},timeout);
    abortListener=()=>{controller.abort();reject(new CliError('CANCELLED','Cancelled by user',uncertain()));};
    signal?.addEventListener('abort',abortListener,{once:true});
  });
  const work=async()=>{
    sent=true;
    const response=await fetchImpl(url,{method,headers,redirect:'error',signal:controller.signal,...(body!==undefined?{body:JSON.stringify(body)}:{})});
    const text=await response.text();let payload;
    try{payload=text?JSON.parse(text):null;}catch{if(!response.ok)throw httpFailure(response.status,{error:`Workspace API returned a non-JSON error (HTTP ${response.status})`});throw new CliError(mutation?'OUTCOME_UNKNOWN':'SERVICE_UNAVAILABLE','Workspace API returned an invalid JSON response',uncertain());}
    if(!response.ok)throw httpFailure(response.status,payload);
    return{payload,status:response.status,headers:response.headers};
  };
  try{return await Promise.race([work(),abortPromise]);}
  catch(error){if(error instanceof CliError)throw error;if(signal?.aborted)throw new CliError('CANCELLED','Cancelled by user',uncertain());throw new CliError(mutation&&sent?'OUTCOME_UNKNOWN':'SERVICE_UNAVAILABLE','Workspace transport failed',uncertain());}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abortListener);}
}
const states={pending:'accepted',queued:'accepted',accepted:'accepted',waiting_client:'accepted',not_started:'accepted',acked:'running',running:'running',applying:'running',validating:'running',connecting:'running',authorization_required:'running',connected:'succeeded',provisioned:'succeeded',succeeded:'succeeded',success:'succeeded',completed:'succeeded',failed:'failed',expired:'failed',cancelled:'failed',canceled:'failed',uncertain:'unknown',unknown:'unknown'};
export function nativeOperationView(native,operation,httpStatus,input={}){
  let receipt=native?.action||native?.connection||native;
  if(operation.name.startsWith('bots.')&&operation.name!=='bots.runRoutine'&&!native?.action&&!native?.connection)receipt=['bots.create','bots.get','bots.provision'].includes(operation.name)?native?.instance?.provisioning||null:null;
  let query=operation.resultQuery?structuredClone(operation.resultQuery):null;
  let receiptKind='action';
  if(operation.name==='bots.control'&&input.data?.operation==='stop'&&native?.active_action_id&&native?.stop_action?.payload?.actionId===native.active_action_id){receipt=native.stop_action;query={command:'ziwei-workspace actions get --id <actionId>',idField:'stop_action.id',note:'This is only the original correlated stop action; it is not proof that all downstream effects were cancelled.'};}
  if(native?.deferredConfig&&['bots.update','bots.get'].includes(operation.name)){receipt=native.deferredConfig;receiptKind='deferred-configuration';query={command:`ziwei-workspace bots get --id ${JSON.stringify(input.id)}`,idField:'deferredConfig.id'};}
  if(['tasks.get','tasks.create'].includes(operation.name)&&native?.execution){receipt=native.execution;query={command:'ziwei-workspace actions get --id <actionId>',idField:'execution.id'};}
  if(operation.name==='bots.runRoutine'){receipt=native;receiptKind=native?.action_id?'action':'automation-run';if(native?.action_id)query={command:`ziwei-workspace actions get --id ${JSON.stringify(String(native.action_id))}`,idField:'action_id'};}
  const rawState=typeof receipt?.status==='string'?receipt.status:typeof receipt?.state==='string'?receipt.state:null;
  const recognized=states[rawState];
  if(!recognized&&httpStatus!==202)return{native};
  // repository.uncertainCompletion recursively follows arbitrary containers and
  // preserves the original phone-receipt supersession rules. A Bot action that
  // was acknowledged before expiry remains recoverable/unknown (repository and
  // bot-profiles); an expiry before acknowledgement remains a known failure.
  const acknowledgedExpiredBot=rawState==='expired'&&Boolean(receipt?.acked_at)&&Boolean(receipt?.payload?.hermesBot||receipt?.type?.startsWith('hermes.bot.'));
  // The repository applies recursive completion evidence to result_json, not
  // to the original request payload (which may contain arbitrary user values).
  const uncertainResult=uncertainCompletion(receipt?.result)||receipt?.code==='EXECUTION_UNCERTAIN'||receipt?.executionState==='uncertain';
  const state=uncertainResult||acknowledgedExpiredBot?'unknown':recognized||'accepted';
  const id=receipt?.actionId||receipt?.action_id||receipt?.id||null;
  if(id&&query?.command){
    if(query.command.includes('<actionId>'))query.command=query.command.replace('<actionId>',JSON.stringify(String(id)));
    if(query.command.includes('<taskId>'))query.command=query.command.replace('<taskId>',JSON.stringify(String(id)));
    if(query.command.includes('<employeeId>')&&input.id)query.command=query.command.replace('<employeeId>',JSON.stringify(input.id));
  }
  return{native,operation:{state,completed:['succeeded','failed'].includes(state),nativeState:rawState,serverReceiptId:id,receiptKind,...(operation.name==='bots.runRoutine'&&native?.id?{nativeRunId:native.id}:{}),resultQuery:query}};
}
