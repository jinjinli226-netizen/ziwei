import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {DSH_NATIVE_TYPE} from './dsh-native-contract.mjs';
import {redactSecrets} from './redaction.mjs';

const applications=new Set(['applied','restart-required','overridden','failed','cancelled']);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
const canonical=value=>JSON.stringify(value,(_key,item)=>object(item)?Object.fromEntries(Object.entries(item).filter(([,value])=>value!==undefined).sort(([a],[b])=>a.localeCompare(b))):item);
const same=(left,right)=>canonical(left)===canonical(right);
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const safeText=value=>redactSecrets(String(value)).replace(/(authorization["']?\s*[:=]\s*)[^\r\n]+/gi,'$1[REDACTED]').replace(/(https?:\/\/)[^\s/@]+@/gi,'$1[REDACTED]@');

export function createDshNativeInstallManager({directory,now=Date.now}={}){
 if(!directory)throw new TypeError('DSH installation journal directory is required');
 const records=new Map(),active=new Map();
 const fileFor=id=>path.join(directory,`${hash(id)}.json`);
 function read(id){
  if(records.has(id))return records.get(id);
  let record;try{record=JSON.parse(fs.readFileSync(fileFor(id),'utf8'));}catch(error){if(error.code==='ENOENT')return null;fail('DSH_NATIVE_INSTALL_JOURNAL_INVALID');}
  if(record?.version!==1||record.actionId!==id||typeof record.nativeRequestId!=='string'||!object(record.subject)||!object(record.input)||!object(record.installSource))fail('DSH_NATIVE_INSTALL_JOURNAL_INVALID');
  records.set(id,record);return record;
 }
 function save(record){
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const target=fileFor(record.actionId),temporary=`${target}.${randomUUID()}.tmp`;let fd;
  try{fd=fs.openSync(temporary,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(record));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temporary,target);}
  finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
  records.set(record.actionId,record);
 }
 const response=(record,status,data={},reasonCode)=>({status,data:{installActionId:record.actionId,sourceActionId:record.input.sourceActionId,nativeRequestId:record.nativeRequestId,requestId:record.nativeRequestId,log:record.log||'',...(record.nativePhase?{nativePhase:record.nativePhase}:{}),...(record.removalReceipt?{removalReceipt:record.removalReceipt}:{}),...data},...(reasonCode?{reasonCode}:{})});
 function unknown(record,reasonCode='DSH_NATIVE_INSTALL_UNCONFIRMED'){
  const partial=record.removalReceipt&&['applied','restart-required'].includes(record.removalReceipt.application);
  record.result=response(record,partial?'partial':'unknown',{installationStatus:'unknown',stage:record.phase==='remove-submitted'?'remove':'install'},reasonCode);
  save(record);return record.result;
 }
 function settle(record,raw){
  if(record.phase==='settled')return record.result;
  if(!object(raw)||!applications.has(raw.application)||typeof raw.changed!=='boolean')return unknown(record);
  const receipt=receiptView(raw),partial=record.removalReceipt&&['applied','restart-required'].includes(record.removalReceipt.application)&&!['applied','restart-required'].includes(receipt.application);
  return finish(record,response(record,partial?'partial':receipt.application,{receipt,installationStatus:receipt.application}),receipt);
 }
 function finish(record,result,nativeReceipt){
  const completed={...record,phase:'settled',completedAt:new Date(now()).toISOString(),result,...(nativeReceipt?{nativeReceipt}:{})};
  save(completed);Object.assign(record,completed);return result;
 }
 async function wait(record,rpc){
  if(record.phase==='settled')return record.result;
  try{const receipt=await rpc('pluginManager/waitForInstall',{requestId:record.nativeRequestId});return receipt===null?unknown(record):settle(record,receipt);}
  catch{return unknown(record);}
 }
 function sourceRecord(action,op){
  const record=read(op.input.sourceActionId);if(!record)fail('DSH_NATIVE_INSTALL_SOURCE_UNKNOWN');
  if(!same(record.subject,op.subject))fail('DSH_NATIVE_INSTALL_SUBJECT_CHANGED');
  if(op.scope.sourceActionId&&op.scope.sourceActionId!==record.actionId)fail('DSH_NATIVE_INSTALL_SUBJECT_CHANGED');
  return record;
 }
 function prepare(action,op){
  const {subject,scope,input,installSource}=op;
  if(typeof installSource?.spec!=='string'||!installSource.spec||typeof input.enabled!=='boolean')fail('DSH_NATIVE_INSTALL_SOURCE_INVALID');
  const binding=hash(canonical({subject,scope,input,installSource})),previous=read(action.id);
  if(previous){if(previous.binding!==binding)fail('DSH_NATIVE_INSTALL_SUBJECT_CHANGED');return{record:previous,existing:true};}
  let prior;
  if(input.approvedBuilds!==undefined){
   const approved=input.approvedBuilds;
   if(!Array.isArray(approved)||!approved.length||new Set(approved).size!==approved.length||input.sourceActionId===action.id)fail('DSH_NATIVE_BUILD_APPROVAL_INVALID');
   prior=sourceRecord(action,op);
   const pending=prior.nativeReceipt?.pendingBuilds;
   if(!same(prior.installSource,installSource)||!Array.isArray(pending)||approved.some(name=>typeof name!=='string'||!pending.includes(name))||input.replaceName&&input.replaceName!==prior.input.replaceName)fail('DSH_NATIVE_BUILD_APPROVAL_INVALID');
  }
  const record={version:1,actionId:action.id,nativeRequestId:action.id,binding,subject:structuredClone(subject),scope:structuredClone(scope),input:structuredClone(input),installSource:structuredClone(installSource),phase:'prepared',createdAt:new Date(now()).toISOString(),log:'',...(prior?.removalReceipt?{removalReceipt:prior.removalReceipt}:{})};
  save(record);return{record,existing:false};
 }
 async function observe(record,{subscribeEvents,onStage}){
  const emit=stage=>{try{onStage?.(stage);}catch{}};
  const event=frame=>{
   if(record.phase==='settled'||frame?.type!=='emit')return;
   const value=frame.args?.[0];if(value?.requestId!==record.nativeRequestId)return;
   if(frame.event==='plugin-manager/install-state'&&['installing','applying','cancelling'].includes(value.phase)){
    record.nativePhase=value.phase;save(record);
    emit({stage:'plugin-install',event:'install-state',requestId:record.nativeRequestId,phase:value.phase,...object(value.attempt)?{attempt:{...pick(value.attempt,['index','total']),registry:value.attempt.registry===null?null:safeText(value.attempt.registry)}}:{}});
   }else if(frame.event==='plugin-manager/install-log'&&['stdout','stderr'].includes(value.stream)){
    const text=safeText(value.text||'').slice(-48000);record.log=`${record.log||''}${text}`.slice(-48000);save(record);
    emit({stage:'plugin-install',event:'install-log',requestId:record.nativeRequestId,...pick(value,['jobId','stream']),text,...(value.exitCode===null||Number.isSafeInteger(value.exitCode)?{exitCode:value.exitCode}:{})});
   }
  };
  return subscribeEvents?await subscribeEvents(event):undefined;
 }
 async function start(record,{rpc,subscribeEvents,signal,onStage}){
  let detach;
  try{
   signal?.throwIfAborted();
   detach=await observe(record,{subscribeEvents,onStage});
   if(record.input.replaceName&&!record.removalReceipt){
    record.phase='remove-submitted';save(record);
    const removed=await rpc('pluginManager/removeBundle',{name:record.input.replaceName});
    if(!object(removed)||!applications.has(removed.application)||typeof removed.changed!=='boolean')return unknown(record,'DSH_NATIVE_REPLACE_OUTCOME_UNKNOWN');
    record.removalReceipt=receiptView(removed);save(record);
    if(removed.error||!['applied','restart-required'].includes(removed.application)){
     return finish(record,response(record,removed.application,{installationStatus:'not-started',stage:'remove'},'DSH_NATIVE_REPLACE_NOT_CONFIRMED'));
    }
   }
   signal?.throwIfAborted();
   record.phase='install-submitted';save(record);
   const options={enabled:record.input.enabled,saveExact:true,requestId:record.nativeRequestId,...Object.hasOwn(record.installSource,'registry')?{registry:record.installSource.registry}:{},...(record.input.approvedBuilds?{approvedBuilds:record.input.approvedBuilds}:{})};
   const receipt=await rpc('pluginManager/installBundle',{spec:record.installSource.spec,options});
   return settle(record,receipt);
  }catch{
   if(record.phase==='settled')return record.result;
   if(record.phase!=='install-submitted')return unknown(record,record.phase==='remove-submitted'?'DSH_NATIVE_REPLACE_OUTCOME_UNKNOWN':'DSH_NATIVE_INSTALL_UNCONFIRMED');
   return await wait(record,rpc);
  }finally{try{await detach?.();}catch{}}
 }
 async function recover(record,context){
  if(record.phase==='settled')return record.result;
  let detach;
  try{detach=await observe(record,context);return await wait(record,context.rpc);}
  finally{try{await detach?.();}catch{}}
 }
 async function execute(action,context={}){
  const payload=action?.payload,op=payload?.dshOperation;
  if(action?.type!==DSH_NATIVE_TYPE||typeof action.id!=='string'||!action.id||op?.schemaVersion!==1||op.resource!=='plugins'||!['installBundle','waitForInstall','cancelInstall'].includes(op.operation)||!object(op.subject)||op.subject.runtime!=='DSH'||payload.workspace!==op.subject.workspace||payload.workspaceId!==op.subject.workspaceId||payload.deviceId!==op.subject.deviceId||!object(op.scope)||!object(op.input)||typeof op.input.sourceActionId!=='string'||typeof context.rpc!=='function')fail('DSH_NATIVE_INSTALL_SUBJECT_INVALID');
  if(op.operation!=='installBundle'){
   if(op.scope.kind!=='attempt')fail('DSH_NATIVE_INSTALL_SUBJECT_INVALID');
   const record=sourceRecord(action,op);
   if(op.operation==='waitForInstall')return active.get(record.actionId)||recover(record,context);
   try{
    const nativeCancellation=await context.rpc('pluginManager/cancelInstall',{requestId:record.nativeRequestId});
    if(!['cancelled','too-late','not-running'].includes(nativeCancellation?.status))return response(record,'unknown',{cancelRequested:true},'DSH_NATIVE_CANCEL_UNCONFIRMED');
    return response(record,'observed',{cancelRequested:true,nativeCancellation:{status:nativeCancellation.status}});
   }catch{return response(record,'unknown',{cancelRequested:true},'DSH_NATIVE_CANCEL_UNCONFIRMED');}
  }
  if(op.scope.kind!=='bot')fail('DSH_NATIVE_INSTALL_SUBJECT_INVALID');
  const {record,existing}=prepare(action,op);
  if(record.phase==='settled')return record.result;
  if(active.has(record.actionId))return active.get(record.actionId);
  if(existing)return recover(record,context);
  const pending=start(record,context).finally(()=>active.delete(record.actionId));active.set(record.actionId,pending);return pending;
 }
 return{execute};
}

function receiptView(value){
 const out=pick(value,['changed','application','restartReason','stage','target','enabled','bundle','version','pendingBuilds','approvedBuilds','failedAt']);
 if(value.error)out.error=pick(value.error,['code','incompatible']);
 if(value.warnings)out.warnings=value.warnings.map(safeText);
 if(value.registries)out.registries=value.registries.map(value=>value===null?null:safeText(value));
 if(value.packageResult)out.packageResult={...pick(value.packageResult,['exitCode','truncated','kind','timedOut','incompatible']),output:safeText(value.packageResult.output||'').slice(-48000)};
 return out;
}
