import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {imageArtifactDeliveryBody,imageArtifactEventResult} from './conversation-image-artifacts.mjs';

// The production 10 MiB image roundtrip took 472 seconds. Polling can also
// contain full image input. Small authenticated receipts have a separate budget.
export const ACTION_TRANSPORT_BUDGETS=Object.freeze({poll:600_000,ack:15_000,event:15_000,result:600_000});
const terminal=new Set(['succeeded','failed','expired']);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const permanent=error=>Number.isInteger(error?.status)&&error.status>=400&&error.status<500&&![408,429].includes(error.status);
const scope=identity=>({apiBase:String(identity.apiBase||'').replace(/\/$/,''),workspace:String(identity.workspace||''),deviceId:String(identity.deviceId||'')});
function binding(action,identity){const p=action.payload||{};return hash({id:action.id,type:action.type,agent:action.agent_id||action.agentId||'ziwei_user',workspace:action.workspace_id||identity.workspace,device:identity.deviceId,employee:p.employeeId||p.employee_id||p.assignee||null,conversation:p.conversationId||p.conversation_id||null,message:p.messageId||p.message_id||null,dedupe:action.dedupe_key||action.dedupeKey||null});}
function durableBytes(file,bytes){
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 const temp=`${file}.${randomUUID()}.tmp`;let fd;
 try {fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temp,file);
  // Windows requires a writable handle for FlushFileBuffers.
  const saved=fs.openSync(file,'r+');try{fs.fsyncSync(saved);}finally{fs.closeSync(saved);}
  if(process.platform!=='win32'){const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}
 } finally {if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
const durableWrite=(file,value)=>durableBytes(file,JSON.stringify(value));
function minimalAction(action){const p=action.payload||{};return {...Object.fromEntries(['id','type','workspace_id','workspaceId','workspace','workspace_slug','agent_id','agentId','status','dedupe_key','dedupeKey','expires_at','expiresAt','acked_at'].filter(key=>action[key]!==undefined).map(key=>[key,action[key]])),payload:Object.fromEntries(['deviceId','device_id','targetDeviceId','target_device_id','employeeId','employee_id','assignee','conversationId','conversation_id','messageId','message_id'].filter(key=>p[key]!==undefined).map(key=>[key,p[key]]))};}

/** Durable ACK/result delivery. Execution durability belongs to ActionDispatcher.
 * A journal cannot authorize execution: every recovery first checks an authenticated
 * server ACK, and terminal ACKs never reach the executor.
 */
export function createActionDelivery({directory,identity,post,dispatch,retryDelays=[250,1000],onEvent=()=>{},onSuccess=async()=>{},maxConfirmedRecords=1000,confirmedRetentionMs=7*24*60*60*1000,now=()=>Date.now()}={}){
 if(!directory||typeof post!=='function'||typeof dispatch!=='function')throw new TypeError('Action delivery requires directory, transport and dispatcher');
 const connection=scope(identity||{}),records=new Map(),active=new Map(),activeBindings=new Map(),eventFlushes=new Map();
 const fileFor=id=>path.join(directory,`${hash(String(id))}.json`);
 const blobFor=(id,kind)=>path.join(directory,`${hash(String(id))}.${kind}.json`);
 const report=(event,data)=>{try{onEvent(event,data);}catch{}};
 function save(record){durableWrite(fileFor(record.action.id),record);}
 function writeBlob(id,kind,value){const bytes=JSON.stringify(value);durableBytes(blobFor(id,kind),bytes);return createHash('sha256').update(bytes).digest('hex');}
 function readBlob(record,kind){try{const bytes=fs.readFileSync(blobFor(record.action.id,kind));if(createHash('sha256').update(bytes).digest('hex')!==record[`${kind}Digest`])throw new Error('Digest mismatch');return JSON.parse(bytes);}catch{throw new Error(`Action delivery journal corrupt (${kind}): ${record.action.id}`);}}
 function removeBlobs(id){let removed=true;for(const kind of ['action','result']){try{fs.unlinkSync(blobFor(id,kind));}catch(error){if(error.code!=='ENOENT'){removed=false;report('a2a_confirmed_blob_cleanup_pending',{actionId:id,kind,error:error.message});}}}return removed;}
 function pruneConfirmed(){
  const confirmed=[...records.values()].filter(record=>record.state==='confirmed'&&!record.retainEvidence).sort((a,b)=>Date.parse(b.confirmedAt)-Date.parse(a.confirmedAt));
  for(const [index,record] of confirmed.entries()){if(!removeBlobs(record.action.id))continue;if(index<maxConfirmedRecords&&now()-Date.parse(record.confirmedAt)<confirmedRetentionMs)continue;try{fs.unlinkSync(fileFor(record.action.id));records.delete(record.action.id);}catch(error){if(error.code==='ENOENT')records.delete(record.action.id);else report('a2a_confirmed_journal_cleanup_pending',{actionId:record.action.id,error:error.message});}}
 }
 function validateTarget(action){const p=action.payload||{};const target=p.deviceId||p.device_id||p.targetDeviceId||p.target_device_id;if(target&&connection.deviceId&&String(target)!==connection.deviceId)throw new Error(`Action delivery identity mismatch: ${action.id}`);}
 function confirm(record,status){
  const confirmed={...record,state:'confirmed',serverStatus:status,events:[],confirmedAt:new Date(now()).toISOString(),action:minimalAction(record.action)};
  // Once the authenticated server owns the terminal result, the delivery
  // journal needs only identity and confirmation. Keep large images in the
  // existing dispatcher cache and server history, not another retained copy.
  // An uncertain execution keeps its original input and outcome for manual
  // verification even when the server has accepted its explicit failure.
  if(!confirmed.retainEvidence){delete confirmed.actionDigest;delete confirmed.resultDigest;}
  // Confirmation must be durable before the shared in-memory record changes.
  // A failed save must remain recoverable and must never enter retention.
  save(confirmed);
  for(const key of Object.keys(record))if(!Object.hasOwn(confirmed,key))delete record[key];
  Object.assign(record,confirmed);
  if(!record.retainEvidence)removeBlobs(record.action.id);pruneConfirmed();
 }
 function read(action,{create=true}={}){
  validateTarget(action);
  let record=records.get(action.id);const file=fileFor(action.id);
  if(!record&&fs.existsSync(file)){
   try{record=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw new Error(`Action delivery journal corrupt: ${action.id}`);}
  }
  if(record){
   if(record.version!==2||record.action?.id!==action.id||!Array.isArray(record.events)||!['awaiting_ack','acked','result_pending','confirmed','blocked'].includes(record.state))throw new Error(`Action delivery journal corrupt: ${action.id}`);
   if(record.state==='confirmed'&&(!terminal.has(record.serverStatus)||!Number.isFinite(Date.parse(record.confirmedAt))))throw new Error(`Action delivery journal corrupt: ${action.id}`);
   if(record.state!=='confirmed'||record.retainEvidence){
    const original=readBlob(record,'action');if(hash(original.identity)!==hash(connection)||original.binding!==record.binding||binding(original.action,connection)!==record.binding)throw new Error(`Action delivery identity mismatch: ${action.id}`);
    if(record.state==='result_pending'||record.resultDigest){const delivery=readBlob(record,'result');if(!delivery||!['succeeded','failed'].includes(delivery.status)||!Object.hasOwn(delivery,'result')||delivery.receiptOnly!==true)throw new Error(`Action delivery journal corrupt: ${action.id}`);}
   }
   const eventIds=new Set();
   for(const event of record.events){if(!event||!/^[-a-f0-9]{36}$/i.test(event.eventId||'')||event.agentId!=='ziwei_user'||typeof event.type!=='string'||!event.type||typeof event.message!=='string'||!event.data||typeof event.data!=='object'||Array.isArray(event.data)||eventIds.has(event.eventId))throw new Error(`Action delivery journal corrupt: ${action.id}`);eventIds.add(event.eventId);}
   if(hash(record.identity)!==hash(connection)||record.binding!==binding(action,connection))throw new Error(`Action delivery identity mismatch: ${action.id}`);
   records.set(action.id,record);return record;
  }
  if(!create)return null;
  const actionBinding=binding(action,connection);
  const actionDigest=writeBlob(action.id,'action',{identity:connection,binding:actionBinding,action});
  record={version:2,identity:connection,binding:actionBinding,action:minimalAction(action),actionDigest,state:'awaiting_ack',events:[],createdAt:new Date(now()).toISOString()};
  save(record);records.set(action.id,record);return record;
 }
 async function retry(operation,{attempts=retryDelays.length+1}={}){
  for(let i=0;i<attempts;i++){try{return await operation();}catch(error){if(permanent(error)||i===attempts-1)throw error;await wait(retryDelays[i]||0);}}
 }
 async function flushEvents(record){
  const id=record.action.id;if(eventFlushes.has(id))return eventFlushes.get(id);
  const promise=(async()=>{
   while(record.events.length&&!['confirmed','blocked'].includes(record.state)){
    const event=record.events[0];
    try{await retry(()=>post(`/a2a/v1/actions/${encodeURIComponent(id)}/events`,event,{timeoutMs:ACTION_TRANSPORT_BUDGETS.event}));}
    catch(error){if(error.status!==404)throw error;report('a2a_events_unsupported',{actionId:id});}
    record.events=record.events.filter(item=>item.eventId!==event.eventId);save(record);
   }
  })().finally(()=>eventFlushes.delete(id));
  eventFlushes.set(id,promise);return promise;
 }
 function recordEvent(id,type,data={}){
  const record=records.get(id);if(!record||['confirmed','blocked'].includes(record.state))return false;
  // Bound progress storage; completed results and image bytes use the result
  // envelope. An overflow is explicit in diagnostics, never unbounded retries.
  if(record.events.length>=256){report('a2a_event_queue_full',{actionId:id,type});return false;}
  const safeData=imageArtifactEventResult(data);
  record.events.push({agentId:'ziwei_user',eventId:randomUUID(),type,message:String(data?.message||'').slice(0,8192),data:safeData});
  try{save(record);}catch(error){record.events.pop();report('a2a_event_persistence_failed',{actionId:id,type,error:error.message});return false;}
  void flushEvents(record).catch(error=>report('a2a_event_pending',{actionId:id,error:error.message}));
  return true;
 }
 async function run(action){
  const record=read(action);
  if(['confirmed','blocked'].includes(record.state))return {state:record.state,status:record.serverStatus||null};
  try{
   const resumingResult=record.state==='result_pending';
   const receipt=await retry(()=>post(`/a2a/v1/actions/${encodeURIComponent(action.id)}/ack`,{agentId:'ziwei_user',receiptOnly:true,renewLease:resumingResult&&Boolean(connection.deviceId)},{timeoutMs:ACTION_TRANSPORT_BUDGETS.ack}));
   if(receipt?.id!==action.id||!['acked',...terminal].includes(receipt?.status))throw new Error('Invalid action ACK receipt; execution was not authorized');
   if(receipt.deviceId&&connection.deviceId&&receipt.deviceId!==connection.deviceId)throw new Error('Action ACK identity mismatch');
   if(terminal.has(receipt.status)){
    confirm(record,receipt.status);
    report('a2a_terminal_confirmed',{actionId:action.id,status:receipt.status});return {state:'confirmed',status:receipt.status};
   }
   const lease=receipt.expires_at||receipt.expiresAt;
   if(!lease||!Number.isFinite(Date.parse(lease))||Date.parse(lease)<=now())throw new Error('Invalid or expired action ACK lease; execution was not authorized');
   record.action={...record.action,status:'acked',acked_at:receipt.acked_at||record.action.acked_at,expires_at:lease,expiresAt:lease,...(receipt.deviceId?{payload:{...record.action.payload,deviceId:receipt.deviceId}}:{})};
   if(record.state!=='result_pending'){record.state='acked';save(record);
    const original=readBlob(record,'action').action;
    const result=await dispatch({...original,...record.action,payload:{...original.payload,...record.action.payload}});
    const status=result.status==='succeeded'||(result.status==='duplicate'&&result.originalStatus==='succeeded')?'succeeded':'failed';
    const delivery=imageArtifactDeliveryBody({status,result:result.result??result,error:status==='failed'?(result.error||'ziwei_user execution failed'):null,receiptOnly:true});
    record.resultDigest=writeBlob(action.id,'result',delivery);
    record.retainEvidence=result.code==='EXECUTION_UNCERTAIN'||result.executionState==='uncertain'||delivery.result?.code==='EXECUTION_UNCERTAIN'||delivery.result?.executionState==='uncertain';
    record.dispatcherStatus=result.status;record.state='result_pending';save(record);
    recordEvent(action.id,delivery.status,{result:imageArtifactEventResult(delivery.result),error:delivery.error});
    if(status==='succeeded')await onSuccess(record.action,result);
   }
   try{await flushEvents(record);}catch(error){report('a2a_progress_delivery_incomplete',{actionId:action.id,pendingEvents:record.events.length,error:error.message});}
   if(!resumingResult&&connection.deviceId){
    // A model may have used most of its original lease. The authenticated ACK
    // renewal marks delivery of a durable completed result, not fake execution
    // progress, and leaves the original ACK timestamp intact.
    const renewal=await retry(()=>post(`/a2a/v1/actions/${encodeURIComponent(action.id)}/ack`,{agentId:'ziwei_user',receiptOnly:true,renewLease:true},{timeoutMs:ACTION_TRANSPORT_BUDGETS.ack}));
    if(renewal?.id!==action.id||!['acked',...terminal].includes(renewal?.status)|| (renewal.deviceId&&connection.deviceId&&renewal.deviceId!==connection.deviceId))throw new Error('Invalid result delivery ACK receipt');
    if(terminal.has(renewal.status)){confirm(record,renewal.status);return {state:'confirmed',status:renewal.status};}
    record.action={...record.action,expires_at:renewal.expires_at,expiresAt:renewal.expires_at};save(record);
   }
   const remainingLease=Date.parse(record.action.expires_at)-now();
   if(!Number.isFinite(remainingLease)||remainingLease<ACTION_TRANSPORT_BUDGETS.result+30_000)throw new Error('Insufficient result delivery lease; durable result retained');
   // One full upload per scheduling pass. After an ambiguous failure the next
   // pass ACKs again, which can observe a committed terminal result. This avoids
   // blindly sending a 10 MiB body repeatedly while its receipt is missing.
   const confirmation=await retry(()=>post(`/a2a/v1/actions/${encodeURIComponent(action.id)}/result`,readBlob(record,'result'),{timeoutMs:ACTION_TRANSPORT_BUDGETS.result}),{attempts:1});
   if(confirmation?.id!==action.id||!terminal.has(confirmation.status))throw new Error('Invalid action result receipt; durable result retained');
   if(confirmation.deviceId&&connection.deviceId&&confirmation.deviceId!==connection.deviceId)throw new Error('Action result identity mismatch; durable result retained');
   confirm(record,confirmation.status);
   report('a2a_result',{actionId:action.id,status:confirmation.status,dispatcherStatus:record.dispatcherStatus});return {state:'confirmed',status:confirmation.status};
  }catch(error){
   if(permanent(error)){record.state='blocked';record.blockedStatus=error.status;save(record);report('a2a_delivery_blocked',{actionId:action.id,httpStatus:error.status,error:error.message});}
   else report('a2a_delivery_pending',{actionId:action.id,state:record.state,error:error.message});
   throw error;
  }
 }
 return {
  execute(action){if(!action?.id)return Promise.reject(new TypeError('Action ID required'));try{validateTarget(action);}catch(error){return Promise.reject(error);}const actionBinding=binding(action,connection);if(active.has(action.id))return activeBindings.get(action.id)===actionBinding?active.get(action.id):Promise.reject(new Error(`Action delivery identity mismatch: ${action.id}`));const promise=Promise.resolve().then(()=>run(action)).finally(()=>{active.delete(action.id);activeBindings.delete(action.id);});active.set(action.id,promise);activeBindings.set(action.id,actionBinding);return promise;},
  recordEvent,
  recoverActions(){
   if(!fs.existsSync(directory))return [];
   const actions=[];
   for(const name of fs.readdirSync(directory).filter(n=>/^[a-f0-9]{64}\.json$/.test(n))){
    try{const data=JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));if(!data.action?.id||name!==path.basename(fileFor(data.action.id)))throw new Error('Action delivery journal corrupt');const record=read(data.action,{create:false});if(record&&!['confirmed','blocked'].includes(record.state))actions.push(record.action);}
    catch(error){report('a2a_journal_recovery_refused',{file:name,error:error.message});}
   }
   pruneConfirmed();return actions;
  },
  get pendingCount(){return [...records.values()].filter(r=>!['confirmed','blocked'].includes(r.state)).length;},
  get blockedCount(){return [...records.values()].filter(r=>r.state==='blocked').length;},
  async whenIdle(){await Promise.allSettled([...active.values(),...eventFlushes.values()]);},
 };
}
