import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {finalizationDigest, validateFailureFinalizationReceipt} from './bot-failure-finalization-contract.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const refuse = code => Object.assign(new Error(code), {code});
const fact = (condition, code = 'FAILURE_FINALIZATION_LOCAL_MISMATCH') => { if (!condition) throw refuse(code); };
const same = (a,b) => finalizationDigest(a) === finalizationDigest(b);
const processDispositions = new Set(['unobservable','no_live_instance','terminated_exact_instance']);
const actionFileBase = actionId => hash(JSON.stringify(actionId));

function noLinks(file) {
  for(let current=path.resolve(file);;current=path.dirname(current)) {
    let st;try {st=fs.lstatSync(current);} catch(error) {if(error.code!=='ENOENT')throw error;}
    fact(!st?.isSymbolicLink(), 'FAILURE_FINALIZATION_UNSAFE_PATH');
    if(current===path.dirname(current))break;
  }
}
function read(file, {optional=false}={}) {
  noLinks(file);let stat;
  try {stat=fs.lstatSync(file);} catch(error) {if(optional&&error.code==='ENOENT')return null;throw error;}
  fact(stat.isFile()&&stat.nlink===1&&stat.size<=128*1024*1024,'FAILURE_FINALIZATION_UNSAFE_PATH');
  const bytes=fs.readFileSync(file);return {file,bytes,sha256:hash(bytes),value:JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''))};
}
function durable(file, value) {
  noLinks(file);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const bytes=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value));
  const temporary=file+'.'+randomUUID()+'.tmp';let descriptor;
  try {
    descriptor=fs.openSync(temporary,'wx',0o600);fs.writeFileSync(descriptor,bytes);fs.fsyncSync(descriptor);fs.closeSync(descriptor);descriptor=undefined;
    fs.renameSync(temporary,file);descriptor=fs.openSync(file,'r+');fs.fsyncSync(descriptor);fs.closeSync(descriptor);descriptor=undefined;
    if(process.platform!=='win32'){descriptor=fs.openSync(path.dirname(file),'r');fs.fsyncSync(descriptor);fs.closeSync(descriptor);descriptor=undefined;}
  } finally {if(descriptor!==undefined)fs.closeSync(descriptor);try{fs.unlinkSync(temporary);}catch{}}
}
function scope(receipt, receiptDigest, identity) {
  const s=receipt?.subject;
  fact(validateFailureFinalizationReceipt(receipt)&&finalizationDigest(receipt)===receiptDigest,'FAILURE_FINALIZATION_RECEIPT_INVALID');
  fact(s.workspace===identity.workspace&&s.deviceId===identity.deviceId,'FAILURE_FINALIZATION_SCOPE_MISMATCH');
  return {...s,dedupeKey:s.dedupeKey??s.actionId};
}
function ownIdentity(value, identity, subject) {
  return value?.workspace===identity.workspace&&value.deviceId===identity.deviceId
    &&(!value.workspaceId||value.workspaceId===subject.workspaceId)
    &&(!value.targetDeviceId||value.targetDeviceId===identity.deviceId)
    &&(!value.actionWorkspace||value.actionWorkspace===identity.workspace);
}
function finalizedCompletion(receipt, receiptDigest, identity, now) {
  const s=receipt.subject;
  return {key:s.dedupeKey??s.actionId,identity,result:{status:'failed',actionId:s.actionId,code:'FAILURE_FINALIZED',
    error:'本轮已结束；原业务结果未确认，未重新执行',completedAt:now,
    result:{failureFinalization:{receiptId:receipt.id,receiptDigest,originalResultDigest:s.originalResultDigest},partialEffectsPossible:true}}};
}
const isTombstone = (completed, receipt, digest) => completed?.result?.status==='failed'
  &&completed.result.actionId===receipt.subject.actionId&&completed.key===(receipt.subject.dedupeKey??receipt.subject.actionId)
  &&completed.result.code==='FAILURE_FINALIZED'&&completed.result.result?.failureFinalization?.receiptId===receipt.id
  &&completed.result.result.failureFinalization.receiptDigest===digest;

/** Inspect only this disposition's original native record. Server digests are
 * retained as pins; the delivered payload can legitimately contain fresh MCP
 * credentials and is therefore bound through exact native identity instead. */
export function inspectFailureFinalizationLocal({runtimeDir,identity,receipt,receiptDigest}) {
  const subject=scope(receipt,receiptDigest,identity),state=read(path.join(runtimeDir,'action-state.json'));
  fact(state.value.version===2&&Array.isArray(state.value.started)&&Array.isArray(state.value.completed));
  const starts=state.value.started.filter(row=>row?.actionId===subject.actionId||row?.key===subject.dedupeKey);
  const completions=state.value.completed.filter(row=>row?.result?.actionId===subject.actionId||row?.key===subject.dedupeKey);
  fact(starts.length<=1&&completions.length<=1);
  const started=starts[0],completed=completions[0];
  if(!started&&isTombstone(completed,receipt,receiptDigest)) {
    fact(ownIdentity(completed.identity,identity,subject));return {subject,state,started:null,completed,alreadyApplied:true};
  }
  fact(started&&started.actionId===subject.actionId&&started.key===subject.dedupeKey&&started.nativeRuntime===true
    &&ownIdentity(started.identity,identity,subject)&&started.resourceBinding?.type===subject.actionType
    &&started.resourceBinding.employeeId===subject.employeeId
    &&started.resourceBinding.revision===subject.originalRevision&&started.resourceBinding.controlEpoch===subject.originalControlEpoch);
  if(completed)fact(completed.result?.status==='failed'&&completed.result.actionId===subject.actionId&&completed.key===subject.dedupeKey&&ownIdentity(completed.identity,identity,subject));
  const directory=path.join(runtimeDir,'action-delivery'),base=actionFileBase(subject.actionId);
  const delivery=read(path.join(directory,base+'.json')),action=read(path.join(directory,base+'.action.json')),
    result=read(path.join(directory,base+'.result.json'),{optional:true}),pause=read(path.join(directory,base+'.pause.json'),{optional:true});
  const journal=delivery.value,original=action.value?.action,p=original?.payload||{},bot=p.hermesBot;
  fact(journal.version===2&&journal.action?.id===subject.actionId&&ownIdentity(journal.identity,identity,subject)
    &&String(journal.identity.apiBase||'').replace(/\/$/,'')===String(identity.apiBase||'').replace(/\/$/,'')
    &&ownIdentity(action.value.identity,identity,subject)&&journal.actionDigest===action.sha256&&action.value.binding===journal.binding
    &&original.id===subject.actionId&&original.type===subject.actionType
    &&String(original.dedupe_key??original.dedupeKey??original.id)===subject.dedupeKey
    &&(p.deviceId||p.device_id||p.targetDeviceId||p.target_device_id)===identity.deviceId
    &&(p.employeeId||p.employee_id||p.assignee)===subject.employeeId
    &&(p.profile||bot?.sourceProfile||'default')===subject.profile
    &&bot?.revision===subject.originalRevision&&bot.controlEpoch===subject.originalControlEpoch
    &&finalizationDigest(bot.instance??null)===subject.profileBindingDigest);
  if(result)fact(journal.resultDigest===result.sha256&&result.value.status==='failed'&&result.value.receiptOnly===true
    &&finalizationDigest(result.value.result)===subject.originalResultDigest);
  else fact(!journal.resultDigest);
  if(pause)fact(journal.pauseDigest===pause.sha256);else fact(!journal.pauseDigest);
  return {subject,state,started,completed,delivery,action,result,pause,alreadyApplied:false};
}

/** Exact action cleanup, separate from its unknown business outcome. The raw
 * inputs, started/quarantine and result bytes remain in an immutable archive.
 * This operation never creates an original process-exit receipt. */
export function archiveFailureFinalization({runtimeDir,identity,receipt,receiptDigest,
  localProcessDisposition='unobservable',applyLocal=null,now=Date.now(),checkpoint=()=>{}}) {
  fact(processDispositions.has(localProcessDisposition));
  const local=inspectFailureFinalizationLocal({runtimeDir,identity,receipt,receiptDigest}),subject=local.subject;
  const directory=path.join(path.resolve(runtimeDir),'failure-finalizations',actionFileBase(subject.actionId));
  noLinks(directory);fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const receiptFile=path.join(directory,'receipt.json'),oldReceipt=read(receiptFile,{optional:true});
  if(oldReceipt)fact(same(oldReceipt.value,{receipt,receiptDigest}));else durable(receiptFile,{receipt,receiptDigest});
  const manifestFile=path.join(directory,'manifest.json');let manifest=read(manifestFile,{optional:true});
  if(!manifest) {
    fact(!local.alreadyApplied,'FAILURE_FINALIZATION_ARCHIVE_MISSING');
    const files=[];
    for(const [role,source] of [['state',local.state],['delivery',local.delivery],['action',local.action],['result',local.result],['pause',local.pause]]) {
      if(!source){files.push({role,present:false});continue;}
      const name=role+'.original.json',target=path.join(directory,name),saved=read(target,{optional:true});
      if(saved){
        if(role==='state'){
          const targetRows=value=>({started:value.started?.filter(row=>row.actionId===subject.actionId||row.key===subject.dedupeKey),completed:value.completed?.filter(row=>row.result?.actionId===subject.actionId||row.key===subject.dedupeKey)});
          fact(same(targetRows(saved.value),targetRows(source.value)));
        }else fact(saved.sha256===source.sha256);
      }else durable(target,source.bytes);
      files.push({role,present:true,file:name,sha256:saved?.sha256||source.sha256,bytes:saved?.bytes.length||source.bytes.length});
    }
    durable(manifestFile,{schemaVersion:1,kind:'failed-action-finalization-archive',receiptId:receipt.id,receiptDigest,
      actionId:subject.actionId,dedupeKey:subject.dedupeKey,identity:{workspace:identity.workspace,deviceId:identity.deviceId},
      originalExecutionExitConfirmed:false,files});
    manifest=read(manifestFile);checkpoint('archive_saved');
  }
  fact(manifest.value.schemaVersion===1&&manifest.value.kind==='failed-action-finalization-archive'
    &&manifest.value.receiptId===receipt.id&&manifest.value.receiptDigest===receiptDigest&&manifest.value.actionId===subject.actionId
    &&manifest.value.dedupeKey===subject.dedupeKey&&same(manifest.value.identity,{workspace:identity.workspace,deviceId:identity.deviceId})
    &&Array.isArray(manifest.value.files)&&manifest.value.files.length===5);
  for(const [index,role]of ['state','delivery','action','result','pause'].entries()){
    const source=manifest.value.files[index];fact(source?.role===role&&typeof source.present==='boolean');
    if(source.present)fact(source.file===role+'.original.json'&&read(path.join(directory,source.file)).sha256===source.sha256,'FAILURE_FINALIZATION_ARCHIVE_CHANGED');
  }
  const savedLocal=read(path.join(directory,'local.json'),{optional:true});
  if(savedLocal)fact(savedLocal.value.receiptDigest===receiptDigest&&savedLocal.value.archiveSha256===manifest.sha256&&processDispositions.has(savedLocal.value.localProcessDisposition));
  if(!local.alreadyApplied) {
    const completed=finalizedCompletion(receipt,receiptDigest,local.started.identity,now);
    // No await between the source read and this compare-and-swap. A running
    // daemon supplies its dispatcher callback so stale disk state cannot later
    // overwrite another employee's in-memory work.
    fact(read(local.state.file).sha256===local.state.sha256,'FAILURE_FINALIZATION_STATE_CHANGED');
    if(applyLocal)fact(applyLocal({receipt,receiptDigest,expectedStateSha256:local.state.sha256,completed})===true,'FAILURE_FINALIZATION_BUSY');
    else durable(local.state.file,{...local.state.value,updatedAt:new Date(now).toISOString(),
      started:local.state.value.started.filter(row=>row.actionId!==subject.actionId&&row.key!==subject.dedupeKey),
      completed:[...local.state.value.completed.filter(row=>row.result?.actionId!==subject.actionId&&row.key!==subject.dedupeKey),completed]});
    checkpoint('state_applied');
  }
  const base=actionFileBase(subject.actionId),deliveryFile=path.join(runtimeDir,'action-delivery',base+'.json');
  const originalJournal=read(path.join(directory,'delivery.original.json')).value;
  const compact={...originalJournal,state:'confirmed',serverStatus:'failed',confirmedAt:new Date(now).toISOString(),events:[],
    failureFinalization:{receiptId:receipt.id,receiptDigest,archiveSha256:manifest.sha256},
    action:originalJournal.action};
  for(const key of ['retainEvidence','actionDigest','resultDigest','pauseDigest','maintenanceAttempt','blockedStatus'])delete compact[key];
  durable(deliveryFile,compact);
  for(const kind of ['action','result','pause']){const file=path.join(runtimeDir,'action-delivery',base+'.'+kind+'.json');noLinks(file);try{fs.unlinkSync(file);}catch(error){if(error.code!=='ENOENT')throw error;}}
  checkpoint('delivery_applied');
  const disposition=savedLocal?.value.localProcessDisposition||localProcessDisposition;
  const applied={schemaVersion:1,receiptId:receipt.id,receiptDigest,actionId:subject.actionId,
    archiveSha256:manifest.sha256,localProcessDisposition:disposition,originalExecutionExitConfirmed:false,applied:true};
  durable(path.join(directory,'local.json'),applied);checkpoint('local_complete');return applied;
}

/** Authenticated per-connection recovery. Failures remain retryable; one old
 * malformed record cannot hold a global maintenance mutex or other employees. */
export function createClientFailureFinalizations({runtimeDir,identity,request,prepareLocal=async()=>({localProcessDisposition:'unobservable'}),applyLocal,
  deliveryReady=()=>true,deliveryApplied=()=>{},onEvent=()=>{}}) {
  let inFlight;
  async function reconcile() {
    if(inFlight)return inFlight;
    inFlight=(async()=>{
      const query=new URLSearchParams({workspace:identity.workspace,deviceId:identity.deviceId});
      const response=await request('/a2a/v1/failure-finalizations?'+query.toString());
      fact(Array.isArray(response?.finalizations),'FAILURE_FINALIZATION_RESPONSE_INVALID');
      const applied=[],pending=[],locallyApplied=[];
      for(const row of response.finalizations.slice(0,100)) {
        const actionId=row?.receipt?.subject?.actionId;
        try {
          scope(row.receipt,row.receiptDigest,identity);
          if(!deliveryReady(row.receipt)){pending.push(actionId);continue;}
          const preparation=await prepareLocal(row.receipt);
          fact(preparation&&processDispositions.has(preparation.localProcessDisposition),'FAILURE_FINALIZATION_BUSY');
          if(!deliveryReady(row.receipt)){pending.push(actionId);continue;}
          const receipt=archiveFailureFinalization({runtimeDir,identity,receipt:row.receipt,receiptDigest:row.receiptDigest,
            localProcessDisposition:preparation.localProcessDisposition,applyLocal});
          deliveryApplied(row.receipt);
          locallyApplied.push(actionId);
          const acknowledged=await request('/a2a/v1/actions/'+encodeURIComponent(actionId)+'/failure-finalization/ack',
            {receiptId:receipt.receiptId,receiptDigest:receipt.receiptDigest,archiveSha256:receipt.archiveSha256,localProcessDisposition:receipt.localProcessDisposition});
          fact(acknowledged?.state==='client_archived'&&acknowledged.receiptDigest===row.receiptDigest,'FAILURE_FINALIZATION_ACK_INVALID');
          applied.push(actionId);onEvent('action.failure_finalized',{actionId,localProcessDisposition:receipt.localProcessDisposition});
        } catch(error) {pending.push(actionId);onEvent('action.failure_finalization_pending',{actionId,code:/^FAILURE_FINALIZATION_[A-Z_]+$/.test(error.code||'')?error.code:'FAILURE_FINALIZATION_RETRY'});}
      }
      return {applied,pending,locallyApplied};
    })().finally(()=>{inFlight=null;});return inFlight;
  }
  return {reconcile};
}
