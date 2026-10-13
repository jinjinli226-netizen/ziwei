import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {canonicalProduction,digestProduction,signProductionEnvelope,verifyProductionEnvelope,validateProductionRequest,productionHostActions} from './production-preservation.mjs';
import {PRODUCT_ROLE,FROZEN_VERSIONS,digest,exitedTree,executionExit} from './version-preservation.mjs';
import {nativeActionDigest} from './preservation-native-databases.mjs';
import {windowsCommandArguments} from '../scripts/client-lifecycle.mjs';

const run=promisify(execFile),sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const copy=value=>JSON.parse(canonicalProduction(value));
const equal=(a,b)=>digestProduction(a)===digestProduction(b);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const fileKinds=new Set(['namespace-policy-v1','legacy-source-archive','legacy-source-code','legacy-action-cache','legacy-action-logger','legacy-action-assessment','native-job-result','maintenance-evidence']);
const directoryKinds=new Set(['namespace-capture-directory-v1','runtime-identity-directory-v1']);
const fields=(value,required,optional=[])=>{canonicalProduction(value);if(!value||Array.isArray(value)||typeof value!=='object'||required.some(key=>!Object.hasOwn(value,key))||Object.keys(value).some(key=>!required.includes(key)&&!optional.includes(key)))fail('SOURCE_NAMESPACE_FIELDS');};
export function validateNativeSourceRefs(binding){
 canonicalProduction(binding);
 const refs=binding.nativeSourceRefs||[];
 if(!Array.isArray(refs)||refs.length>512)fail('SOURCE_NAMESPACE_REFS');
 const seen=new Set(),singletons=new Set();
 for(const ref of refs){
  const directory=directoryKinds.has(ref.kind);fields(ref,directory?['kind','canonicalPath','producerSha256']:['kind','canonicalPath','sha256'],['actionId','bindingDigest','originalInstance']);
  const flavour=path.win32.isAbsolute(ref.canonicalPath||'')?path.win32:path.posix;
  if(!directory&&!fileKinds.has(ref.kind)||typeof ref.canonicalPath!=='string'||!flavour.isAbsolute(ref.canonicalPath)||flavour.resolve(ref.canonicalPath)!==ref.canonicalPath||seen.has(ref.canonicalPath)||!hex(directory?ref.producerSha256:ref.sha256))fail('SOURCE_NAMESPACE_REFS');seen.add(ref.canonicalPath);
  if(directory||ref.kind==='namespace-policy-v1'){if(singletons.has(ref.kind))fail('SOURCE_NAMESPACE_REFS');singletons.add(ref.kind);}
  if(ref.actionId!==undefined&&(typeof ref.actionId!=='string'||!ref.actionId)||ref.bindingDigest!==undefined&&(!hex(ref.bindingDigest)||![...(binding.clients||[]),...(binding.apiInstances||[])].some(original=>digestProduction(original)===ref.bindingDigest)))fail('SOURCE_NAMESPACE_REFS');
  if(ref.originalInstance){fields(ref.originalInstance,['pid','createdAt']);if(!Number.isSafeInteger(ref.originalInstance.pid)||ref.originalInstance.pid<=0||!iso(ref.originalInstance.createdAt))fail('SOURCE_NAMESPACE_REFS');}
 }
 return copy(refs);
}
function readPlain(file,files=[]){
 if(!path.isAbsolute(file)||path.resolve(file)!==file)fail('SOURCE_NAMESPACE_PATH');
 let parent=file;while(true){if(fs.lstatSync(parent).isSymbolicLink())fail('SOURCE_NAMESPACE_PATH');const next=path.dirname(parent);if(next===parent)break;parent=next;}
 const stat=fs.lstatSync(file,{bigint:true});if(!stat.isFile()||stat.nlink!==1n||fs.realpathSync.native(file)!==file||stat.size>16n*1024n*1024n)fail('SOURCE_NAMESPACE_PATH');
 const bytes=fs.readFileSync(file);files.push({path:file,exists:true,sha256:sha(bytes),bytes:bytes.length,identity:{dev:String(stat.dev),ino:String(stat.ino)}});return bytes;
}
const json=bytes=>{try{return JSON.parse(bytes);}catch{fail('SOURCE_NAMESPACE_JSON');}};
const privateEnvelope=(file,files)=>json(readPlain(file,files));
const originals=binding=>[...binding.clients.map(original=>({kind:'client',original})),...binding.apiInstances.map(original=>({kind:'api',original}))];
export function parseLinuxProcessBirth(stat,bootId){
 if(typeof stat!=='string'||typeof bootId!=='string'||!/^[a-f0-9-]{36}$/.test(bootId))fail('SOURCE_NATIVE_BIRTH');
 const end=stat.lastIndexOf(')'),parts=stat.slice(end+2).trim().split(/\s+/),startTicks=parts[19];
 if(end<0||!/^[1-9][0-9]*$/.test(startTicks||''))fail('SOURCE_NATIVE_BIRTH');
 return {bootId,startTicks};
}
function sameOriginalBirth(original,record){
 if(!record)return false;
 if(original.nativeBirth)return equal(original.nativeBirth,record.nativeBirth);
 return iso(record.createdAt)&&Number.isFinite(Date.parse(original.createdAt))&&Date.parse(record.createdAt)===Date.parse(original.createdAt);
}
/** Only exact saved original Job results or interpreter-verified no-dispatch
 * facts can establish execution disposition. Historical success is not a tree. */
export function verifyWindowsWorkerFacts(facts,actions,references=[]){
 const issues=[];
 try{
  fields(facts,['kind','completeConnections','completeSameBootLogger','completeMaintenance','unresolved','sourceBindings','actions']);
  if(facts.kind!=='windows-source-facts-v1'||facts.completeConnections!==true||facts.completeSameBootLogger!==true||facts.completeMaintenance!==true||!Array.isArray(facts.unresolved)||facts.unresolved.length||!Array.isArray(facts.sourceBindings)||facts.sourceBindings.some(value=>!hex(value))||!Array.isArray(facts.actions))fail('SOURCE_WINDOWS_COVERAGE');
  if(new Set(facts.actions.map(row=>row.actionId)).size!==facts.actions.length)fail('SOURCE_WINDOWS_COVERAGE');
  for(const action of actions){
   const proof=facts.actions.find(row=>row.actionId===action.id&&row.actionDigest===action.digest);
   if(!proof)fail('SOURCE_WINDOWS_ACTION_UNPROVEN');
   if(proof.kind==='job'){
    fields(proof,['actionId','actionDigest','kind','jobName','nonce','hostPid','processExit','evidenceSha256']);
    if(typeof proof.jobName!=='string'||!proof.jobName.startsWith('Local\\Ziwei.Runtime.')||typeof proof.nonce!=='string'||proof.jobName!=='Local\\Ziwei.Runtime.'+proof.nonce||!Number.isSafeInteger(proof.hostPid)||proof.hostPid<=0||!hex(proof.evidenceSha256)||!facts.sourceBindings.includes(proof.evidenceSha256)||!exitedTree(proof.processExit))fail('SOURCE_WINDOWS_JOB_UNPROVEN');
    const ref=references.find(row=>row.kind==='native-job-result'&&row.actionId===action.id&&row.sha256===proof.evidenceSha256),result=ref?.value;
    if(!result||result.schema!==1||result.nonce!==proof.nonce||result.jobName!==proof.jobName||result.hostPid!==proof.hostPid||!exitedTree(result)||!action.resultExit||!equal(action.resultExit,proof.processExit)||['launched','rootPid','rootConfirmed','rootExitCode','treeConfirmed','activeProcesses'].some(key=>result[key]!==proof.processExit[key]))fail('SOURCE_WINDOWS_JOB_UNPROVEN');
   }else if(proof.kind==='never-dispatched'){
    fields(proof,['actionId','actionDigest','kind','bindingDigest','originalInstance','interpreterVerified','codeDigest','cachePrefixDigest','sameBootLoggerDigest','assessmentDigest']);
    if(proof.interpreterVerified!==true||['codeDigest','cachePrefixDigest','sameBootLoggerDigest','assessmentDigest'].some(key=>!hex(proof[key])||!facts.sourceBindings.includes(proof[key])))fail('SOURCE_WINDOWS_ACTION_UNPROVEN');
    if(proof.bindingDigest!==action.bindingDigest||!proof.originalInstance)fail('SOURCE_WINDOWS_ACTION_UNPROVEN');
    for(const [key,kinds] of [['codeDigest',['legacy-source-archive','legacy-source-code']],['cachePrefixDigest',['legacy-action-cache']],['sameBootLoggerDigest',['legacy-action-logger']],['assessmentDigest',['legacy-action-assessment']]])if(!references.some(ref=>kinds.includes(ref.kind)&&ref.sha256===proof[key]&&(ref.actionId===action.id||key==='codeDigest')&&ref.bindingDigest===action.bindingDigest&&equal(ref.originalInstance,proof.originalInstance)))fail('SOURCE_WINDOWS_ACTION_UNPROVEN');
   }else fail('SOURCE_WINDOWS_ACTION_UNPROVEN');
  }
 }catch(error){issues.push({code:/^SOURCE_[A-Z0-9_]+$/.test(error.code||'')?error.code:'SOURCE_WINDOWS_COVERAGE'});}
 return {safe:issues.length===0,issues};
}
export function namespaceCaptureFile(ref,phase){if(ref.kind!=='namespace-capture-directory-v1'||!['before-stop','after-stop'].includes(phase))fail('SOURCE_NAMESPACE_REFS');return (path.win32.isAbsolute(ref.canonicalPath)?path.win32:path.posix).join(ref.canonicalPath,phase+'.json');}
export function runtimeCaptureFile(ref,challenge){if(ref.kind!=='runtime-identity-directory-v1'||!(/^[a-f0-9-]{36}$/).test(challenge||''))fail('SOURCE_NAMESPACE_REFS');return (path.win32.isAbsolute(ref.canonicalPath)?path.win32:path.posix).join(ref.canonicalPath,'runtime-'+challenge+'.json');}
const captureKeys=['domain','schemaVersion','producer','producerSha256','phase','challenge','capturedAt','operationId','specHash','databaseIdentity','freezeDigest','bindingDigest','policyDigest','previousCaptureDigest','instances','workerFacts'];
export function createNamespaceCaptureEnvelope(input){
 const value=copy(input),{payload,trust,hostId}=value;
 fields(payload,captureKeys);
 if(payload.domain!=='ziwei-production-namespace-capture-v1'||payload.schemaVersion!==1||payload.producer!=='ziwei-source-namespace-v1'||!['before-stop','after-stop'].includes(payload.phase)||!iso(payload.capturedAt)||Date.parse(payload.capturedAt)>Date.now()+5000||!hex(payload.producerSha256)||!hex(payload.policyDigest)||!Array.isArray(payload.instances)||!trust.hosts.some(row=>row.hostId===hostId&&row.bindingDigest===payload.bindingDigest)||!trust.approvedSpecs.some(row=>row.operationId===payload.operationId&&row.specHash===payload.specHash))fail('SOURCE_NAMESPACE_CAPTURE');
 // R's reviewed source producer supplies native observations; safe booleans
 // are not in this schema. The observer independently rechecks current native.
 return signProductionEnvelope({hostId,payload,trust});
}
function verifiedCapture(envelope,context,phase,producerSha256,policyDigest){
 const payload=verifyProductionEnvelope({envelope,trust:context.trust,expected:{domain:'ziwei-production-namespace-capture-v1',schemaVersion:1,producer:'ziwei-source-namespace-v1',producerSha256,phase,operationId:context.request.operationId,specHash:context.request.specHash,databaseIdentity:context.request.databaseIdentity,freezeDigest:context.request.freezeDigest,bindingDigest:digestProduction(context.binding),policyDigest}});
 fields(payload,captureKeys);if(!iso(payload.capturedAt)||Date.parse(payload.capturedAt)>Date.now()+5000||!Array.isArray(payload.instances)||envelope.hostId!==context.binding.hostId)fail('SOURCE_NAMESPACE_CAPTURE');
 return payload;
}
function policyFor(binding,refs,files){
 const ref=refs.find(row=>row.kind==='namespace-policy-v1');if(!ref)fail('SOURCE_NAMESPACE_POLICY');
 const bytes=readPlain(ref.canonicalPath,files);if(sha(bytes)!==ref.sha256)fail('SOURCE_NAMESPACE_REF_CHANGED');
 const policy=json(bytes);fields(policy,['schemaVersion','kind','instances']);
 if(policy.schemaVersion!==1||policy.kind!=='source-namespace-policy-v1'||!Array.isArray(policy.instances))fail('SOURCE_NAMESPACE_POLICY');
 const expected=originals(binding);
 if(policy.instances.length!==expected.length)fail('SOURCE_NAMESPACE_POLICY');
 for(const {kind,original} of expected){const matches=policy.instances.filter(row=>row.kind===kind&&row.bindingDigest===digestProduction(original));if(matches.length!==1)fail('SOURCE_NAMESPACE_POLICY');const row=matches[0];fields(row,['kind','bindingDigest','namespace','identityOrigin']);fields(row.namespace,row.namespace?.kind==='systemd-cgroup'?['kind','unit','controlGroup']:['kind']);if(!['systemd-cgroup','windows-source'].includes(row.namespace.kind))fail('SOURCE_NAMESPACE_POLICY');const origin=new URL(row.identityOrigin);if(origin.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(origin.hostname)||origin.origin!==row.identityOrigin||!origin.port)fail('SOURCE_NAMESPACE_POLICY');}
 return policy;
}
function checkOriginalCapture(original,record,policy,phase){
 fields(record,['kind','bindingDigest','originalInstance','process','namespace'],['nonceDigest']);
 if(!record||record.bindingDigest!==digestProduction(original)||record.kind!==policy.kind||!equal(record.originalInstance,original.originalInstance)||!record.namespace)fail('SOURCE_NAMESPACE_INSTANCE');
 if(phase==='before-stop'){
  if(!record.process||record.process.pid!==original.originalInstance.pid||!sameOriginalBirth(original.originalInstance,record.process)||record.process.entryPath!==original.entryPath)fail('SOURCE_NAMESPACE_BIRTH');
  const identityKind=original.originalInstance.identityKind||'boot-nonce';
  if(identityKind==='systemd-invocation'){if(record.namespace.kind!=='systemd-cgroup'||!(/^[a-f0-9]{32}$/).test(record.namespace.InvocationID||'')||sha(record.namespace.InvocationID)!==original.originalInstance.nonceDigest)fail('SOURCE_NAMESPACE_IDENTITY');}
  else if(identityKind==='boot-nonce'&&record.nonceDigest!==original.originalInstance.nonceDigest)fail('SOURCE_NAMESPACE_IDENTITY');
  else if(identityKind==='legacy-os-start'&&original.originalInstance.nonceDigest!==null)fail('SOURCE_NAMESPACE_IDENTITY');
 }
 if(record.namespace.kind!==policy.namespace.kind)fail('SOURCE_NAMESPACE_SCOPE');
 if(policy.namespace.kind==='systemd-cgroup'){
  validateSystemdSnapshot(record.namespace,policy.namespace);
  if(record.namespace.unit!==policy.namespace.unit||record.namespace.controlGroup!==policy.namespace.controlGroup||record.namespace.KillMode!=='control-group'||record.namespace.Delegate!==false||record.namespace.SendSIGKILL!==true||!Array.isArray(record.namespace.members))fail('SOURCE_NAMESPACE_SCOPE');
  if(phase==='before-stop'&&!record.namespace.members.includes(original.originalInstance.pid))fail('SOURCE_NAMESPACE_SCOPE');
  if(phase==='after-stop'&&(record.namespace.members.length||!['inactive','failed'].includes(record.namespace.ActiveState)))fail('SOURCE_NAMESPACE_NOT_STOPPED');
 }else if(policy.namespace.kind==='windows-source'){
  if(!Array.isArray(record.namespace.members)||!Array.isArray(record.namespace.unresolved)||record.namespace.unresolved.length||record.namespace.visibility!=='native-memory-and-registry')fail('SOURCE_WINDOWS_COVERAGE');
  if(phase==='before-stop'&&!record.namespace.members.includes(original.originalInstance.pid))fail('SOURCE_NAMESPACE_SCOPE');
  if(phase==='after-stop'&&record.namespace.members.length)fail('SOURCE_NAMESPACE_NOT_STOPPED');
 }else fail('SOURCE_NAMESPACE_SCOPE');
 if(phase==='after-stop'&&record.process&&sameOriginalBirth(original.originalInstance,record.process))fail('SOURCE_NAMESPACE_NOT_STOPPED');
}
function validateSystemdSnapshot(value,selector){
 fields(value,['kind','unit','controlGroup','InvocationID','KillMode','Delegate','SendSIGKILL','ActiveState','members','bootId','NRestarts','ExecMainStartTimestampMonotonic','ActiveEnterTimestampMonotonic'],['MainPID','FragmentPath']);
 if(value.kind!=='systemd-cgroup'||value.unit!==selector.unit||value.controlGroup!==selector.controlGroup||typeof value.InvocationID!=='string'||value.InvocationID!==''&&!/^[a-f0-9]{32}$/.test(value.InvocationID)||!(/^[a-f0-9-]{36}$/).test(value.bootId||'')||!Number.isSafeInteger(value.NRestarts)||value.NRestarts<0||!(/^[0-9]+$/).test(value.ExecMainStartTimestampMonotonic||'')||!(/^[0-9]+$/).test(value.ActiveEnterTimestampMonotonic||''))fail('SOURCE_NAMESPACE_SCOPE');
}
const systemdEpoch=value=>Object.fromEntries(['bootId','InvocationID','NRestarts','ExecMainStartTimestampMonotonic','ActiveEnterTimestampMonotonic'].map(key=>[key,value[key]]));
const runtimeKeys=['domain','schemaVersion','producer','producerSha256','command','challenge','issuedAt','expiresAt','operationId','specHash','databaseIdentity','freezeDigest','bindingDigest','installedDigest','instances'];
export function verifyRuntimeCaptureEnvelope({envelope,trust,request}){
 const ref=validateNativeSourceRefs(request.binding).find(row=>row.kind==='runtime-identity-directory-v1');if(!ref||envelope?.hostId!==request.binding.hostId)fail('SOURCE_RUNTIME_REQUIRED');
 const payload=verifyProductionEnvelope({envelope,trust,expected:{domain:'ziwei-production-runtime-capture-v1',schemaVersion:1,producer:'ziwei-source-namespace-v1',producerSha256:ref.producerSha256,command:'restore',challenge:request.challenge,issuedAt:request.issuedAt,expiresAt:request.expiresAt,operationId:request.operationId,specHash:request.specHash,databaseIdentity:request.databaseIdentity,freezeDigest:request.freezeDigest,bindingDigest:digestProduction(request.binding),installedDigest:digestProduction(request.installed)}});
 fields(payload,runtimeKeys);
 if(!Array.isArray(payload.instances)||payload.instances.length!==request.installed.targets.length)fail('SOURCE_RUNTIME_REQUIRED');
 for(const target of request.installed.targets){
  const matches=payload.instances.filter(row=>row.kind===target.kind&&row.bindingDigest===target.bindingDigest);if(matches.length!==1)fail('SOURCE_RUNTIME_TARGET');const sample=matches[0];
  fields(sample,['kind','bindingDigest','targetDigest','root','entryPath','productRole','buildDigest','pid','nativeBirth','nonceDigest',target.kind==='api'?'apiIdentity':'clientIdentity']);
  if(sample.targetDigest!==target.targetDigest||sample.root!==target.root||sample.entryPath!==target.entryPath||sample.buildDigest!==target.buildDigest||sample.productRole!=='v2'||!hex(sample.nonceDigest)||!Number.isSafeInteger(sample.pid)||sample.pid<=0)fail('SOURCE_RUNTIME_TARGET');
  if(target.kind==='api'){const proof=verifyApiIdentityProof({envelope:sample.apiIdentity,trust,request,target,process:sample});if(proof.nonceDigest!==sample.nonceDigest)fail('SOURCE_RUNTIME_API');}
  else fail('SOURCE_RUNTIME_CLIENT_IDENTITY_UNSUPPORTED');
 }
 return payload;
}
function errorObservation(code){
 return {safe:false,namespaceComplete:false,workerScopeComplete:false,instances:[],files:[],directories:[],homes:[],connections:[],proofs:[],issues:[{code}],observations:{namespace:process.platform,namespaceComplete:false,workerScopeComplete:false,originalStopped:false,restarted:false,unresolved:[{code}],instances:[]},runtimeProofs:[]};
}
/** Read only. Capture files are immutable references to original observations;
 * fresh native probes and runtime proofs bind each current command. */
export async function observePreservationSourceNamespace(input,native=defaultNativeSourceIO){
 let context;try{
  context={...copy(input)};const {binding,request,trust}=context,refs=validateNativeSourceRefs(binding);
  if(!refs.length)return errorObservation('SOURCE_NAMESPACE_EVIDENCE_REQUIRED');
  const files=[],nativeRefs=[],policy=policyFor(binding,refs,files),policyDigest=digestProduction(policy),captureRef=refs.find(row=>row.kind==='namespace-capture-directory-v1');
  if(!captureRef)fail('SOURCE_NAMESPACE_EVIDENCE_REQUIRED');
  for(const ref of refs.filter(row=>fileKinds.has(row.kind)&&row.kind!=='namespace-policy-v1')){const bytes=readPlain(ref.canonicalPath,files);if(sha(bytes)!==ref.sha256)fail('SOURCE_NAMESPACE_REF_CHANGED');nativeRefs.push({...ref,...(ref.kind==='native-job-result'?{value:json(bytes)}:{})});}
  const beforeEnvelope=privateEnvelope(namespaceCaptureFile(captureRef,'before-stop'),files),afterEnvelope=privateEnvelope(namespaceCaptureFile(captureRef,'after-stop'),files);
  const before=verifiedCapture(beforeEnvelope,context,'before-stop',captureRef.producerSha256,policyDigest),after=verifiedCapture(afterEnvelope,context,'after-stop',captureRef.producerSha256,policyDigest);
  if(after.previousCaptureDigest!==digestProduction(beforeEnvelope)||before.previousCaptureDigest!==null||Date.parse(after.capturedAt)<Date.parse(before.capturedAt))fail('SOURCE_NAMESPACE_CHAIN');
  const expected=originals(binding);if(before.instances.length!==expected.length||after.instances.length!==expected.length)fail('SOURCE_NAMESPACE_INSTANCE');
  let runtimeEnvelope=null,runtime=null;
  if(request.command==='restore'){
   const runtimeRef=refs.find(row=>row.kind==='runtime-identity-directory-v1');if(!runtimeRef)fail('SOURCE_RUNTIME_REQUIRED');
   // Volatile per-challenge evidence is retained by R, but is not mixed into
   // the stable original file manifest or directory listing used by recheck.
   runtimeEnvelope=privateEnvelope(runtimeCaptureFile(runtimeRef,request.challenge),[]);
   runtime=verifyRuntimeCaptureEnvelope({envelope:runtimeEnvelope,trust,request});
  }
  const instances=[],running=[],stableProofs=[];
  for(const {kind,original} of expected){
   const selector=policy.instances.find(row=>row.bindingDigest===digestProduction(original)),first=before.instances.find(row=>row.bindingDigest===selector.bindingDigest),last=after.instances.find(row=>row.bindingDigest===selector.bindingDigest);
   checkOriginalCapture(original,first,selector,'before-stop');checkOriginalCapture(original,last,selector,'after-stop');
   if(selector.namespace.kind==='systemd-cgroup'&&(first.namespace.bootId!==last.namespace.bootId||original.originalInstance.nativeBirth&&first.namespace.bootId!==original.originalInstance.nativeBirth.bootId))fail('SOURCE_NAMESPACE_BIRTH');
   const current=await native.readProcess(original.originalInstance.pid);
   if(current&&sameOriginalBirth(original.originalInstance,current))fail('SOURCE_ORIGINAL_INSTANCE_PRESENT');
   const namespace=await native.readNamespace(selector.namespace);
   if(namespace.kind==='systemd-cgroup'){
    validateSystemdSnapshot(namespace,selector.namespace);
    if(namespace.unit!==selector.namespace.unit||namespace.controlGroup!==selector.namespace.controlGroup||namespace.KillMode!=='control-group'||namespace.Delegate!==false||namespace.SendSIGKILL!==true||!Array.isArray(namespace.members))fail('SOURCE_NAMESPACE_SCOPE');
    if(namespace.bootId!==last.namespace.bootId||request.command!=='restore'&&(namespace.members.length||!['inactive','failed'].includes(namespace.ActiveState)||!equal(systemdEpoch(namespace),systemdEpoch(last.namespace))))fail('SOURCE_NAMESPACE_RESTARTED');
   }else if(namespace.kind==='windows-source'){
    if(namespace.visibility!=='native-memory-and-registry'||!Array.isArray(namespace.members)||request.command!=='restore'&&namespace.members.length||!Array.isArray(namespace.unresolved)||namespace.unresolved.length)fail('SOURCE_WINDOWS_COVERAGE');
    if(!Array.isArray(after.workerFacts?.sourceBindings)||after.workerFacts.sourceBindings.some(value=>!refs.some(ref=>ref.sha256===value)))fail('SOURCE_WINDOWS_COVERAGE');
    const verified=verifyWindowsWorkerFacts(after.workerFacts,productionHostActions(binding,request.actionProjection).filter(row=>row.acked_at).map(row=>({id:row.id,digest:nativeActionDigest(row),bindingDigest:selector.bindingDigest,resultExit:row.result_json?executionExit(json(row.result_json)):null})),nativeRefs);
    if(!verified.safe)fail(verified.issues[0].code);
   }else fail('SOURCE_NAMESPACE_SCOPE');
   instances.push({bindingDigest:selector.bindingDigest,originalInstance:copy(original.originalInstance),stopped:true});
   stableProofs.push({kind:'original-namespace-proof-v1',bindingDigest:selector.bindingDigest,beforeCaptureDigest:digestProduction(beforeEnvelope),afterCaptureDigest:digestProduction(afterEnvelope),policyDigest});
   if(runtime){
    const target=request.installed.targets.find(row=>row.kind===kind&&row.bindingDigest===selector.bindingDigest),sample=runtime.instances.find(row=>row.kind===kind&&row.bindingDigest===selector.bindingDigest);
    if(!target||!sample||sample.targetDigest!==target.targetDigest||sample.root!==target.root||sample.entryPath!==target.entryPath||sample.buildDigest!==target.buildDigest||sample.productRole!=='v2'||!hex(sample.nonceDigest))fail('SOURCE_RUNTIME_TARGET');
    const live=await native.readProcess(sample.pid);
    if(!live||live.entryPath!==target.entryPath||!equal(live.nativeBirth,sample.nativeBirth)||!Number.isSafeInteger(sample.pid)||sample.pid<=0||!Array.isArray(namespace.members)||namespace.members.length!==1||namespace.members[0]!==sample.pid)fail('SOURCE_RUNTIME_PROCESS');
    const listener=await native.readListener(selector.identityOrigin,sample.pid);if(listener.listenerPid!==sample.pid)fail('SOURCE_RUNTIME_LISTENER');
    if(kind==='api'){
     const identity=verifyApiIdentityProof({envelope:sample.apiIdentity,trust,request,target,process:live});if(identity.nonceDigest!==sample.nonceDigest)fail('SOURCE_RUNTIME_API');
    }else fail('SOURCE_RUNTIME_CLIENT_IDENTITY_UNSUPPORTED');
    running.push({kind,bindingDigest:selector.bindingDigest,targetDigest:target.targetDigest,root:target.root,entryPath:target.entryPath,running:true,productRole:'v2',buildDigest:target.buildDigest,pid:sample.pid,createdAt:live.createdAt,nativeBirth:live.nativeBirth,nonceDigest:sample.nonceDigest});
   }
  }
  const observations={namespace:process.platform,namespaceComplete:true,workerScopeComplete:true,originalStopped:true,restarted:false,unresolved:[],instances,scopeDigest:digestProduction({policyDigest,beforeCaptureDigest:digestProduction(beforeEnvelope),afterCaptureDigest:digestProduction(afterEnvelope)}),...(runtime?{runningV2:{fenceState:'sealed',productRole:'v2',buildDigest:request.installed.apiBuildDigest,databaseId:request.databaseIdentity.databaseId,instances:running}}:{})};
  return {safe:true,namespaceComplete:true,workerScopeComplete:true,instances,files,directories:[],homes:copy(request.homes||[]),connections:[],proofs:stableProofs,observations,runtimeProofs:runtimeEnvelope?[runtimeEnvelope]:[],issues:[]};
 }catch(error){return errorObservation(/^SOURCE_[A-Z0-9_]+$/.test(error.code||'')?error.code:'SOURCE_NAMESPACE_UNPROVEN');}
}

/** Private API request contains only identity expectations, not action text. */
export function createApiIdentityRequest({sourceRequest,trust,target}){
 const request=validateProductionRequest({request:sourceRequest,trust,command:'restore'});
 if(!request.installed.targets.some(row=>equal(row,target))||target.kind!=='api')fail('SOURCE_RUNTIME_TARGET');
 return signProductionEnvelope({hostId:sourceRequest.hostId,trust,payload:{domain:'ziwei-production-api-identity-request-v1',schemaVersion:1,kind:'api-runtime',command:'restore',challenge:request.challenge,issuedAt:request.issuedAt,expiresAt:request.expiresAt,operationId:request.operationId,specHash:request.specHash,databaseIdentity:request.databaseIdentity,freezeDigest:request.freezeDigest,binding:request.binding,target,expectedSources:request.installed.apiContents,controlIdentity:request.controlIdentity}});
}
const checkedSource=relative=>['backend','src','scripts','skills','daemon'].includes(relative.split('/')[0])||['package.json','package-lock.json','preservation-package.json'].includes(relative);
function bootSources(root){
 const entries=[];function walk(directory,prefix=''){for(const name of fs.readdirSync(directory).sort()){if(!prefix&&!checkedSource(name))continue;const relative=prefix?prefix+'/'+name:name,file=path.join(directory,name),stat=fs.lstatSync(file);if(stat.isSymbolicLink())fail('SOURCE_API_BOOT');if(stat.isDirectory())walk(file,relative);else entries.push({path:relative,sha256:sha(readPlain(file))});}}
 walk(root);return entries;
}
const sortedSources=entries=>entries.filter(row=>checkedSource(row.path)).map(row=>({path:row.path,sha256:row.sha256})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
/** Linux FD checks are conservative: every open SQLite main-file descriptor in
 * this API process must resolve to the same physical database. A path stat alone
 * cannot establish the identity of a handle opened before a rename/swap. */
export function readApiDatabaseConnectionIdentity(file){
 if(process.platform!=='linux')fail('SOURCE_API_DATABASE_HANDLE_UNSUPPORTED');
 const canonicalPath=fs.realpathSync.native(file),current=fs.lstatSync(canonicalPath,{bigint:true}),identities=[];
 for(const name of fs.readdirSync('/proc/self/fd')){
  // Observe the existing FD with fstat/pread. Never open or close a descriptor
  // for this inode: closing any such FD can release this process's POSIX locks.
  try{const descriptor=Number(name),stat=fs.fstatSync(descriptor,{bigint:true});if(!stat.isFile())continue;fs.readlinkSync('/proc/self/fd/'+name);const header=Buffer.alloc(16);if(fs.readSync(descriptor,header,0,16,0)===16&&header.toString()==='SQLite format 3\0')identities.push({dev:String(stat.dev),ino:String(stat.ino)});}
  catch(error){if(!['ENOENT','EBADF','ESPIPE'].includes(error.code))throw error;}
 }
 const identity={dev:String(current.dev),ino:String(current.ino)};
 if(!identities.length||identities.some(value=>!equal(value,identity)))fail('SOURCE_API_DATABASE_HANDLE');
 return {canonicalPath,identity};
}
export function createProductionApiIdentityHandler({db,trust,hostId},io={}){
 if(!db||!trust||typeof hostId!=='string')fail('SOURCE_API_CONFIGURATION');
 const snapshot=copy((io.readBootstrap||(()=>({root:ROOT,entryPath:fs.realpathSync.native(path.resolve(process.argv[1])),descriptor:json(readPlain(path.join(ROOT,'preservation-package.json'))),sources:bootSources(ROOT)})))());
 const startedAt=new Date().toISOString(),nonceDigest=sha(crypto.randomBytes(32)),pid=process.pid;
 if(snapshot.descriptor.productRole!==PRODUCT_ROLE||PRODUCT_ROLE!=='v2')fail('SOURCE_API_BOOT');
 const sourcesDigest=digestProduction(sortedSources(snapshot.sources));
 const filename=db.prepare('PRAGMA database_list').all().find(row=>row.name==='main')?.file;if(!filename)fail('SOURCE_API_DATABASE');
 const readConnectionIdentity=io.readDatabaseConnectionIdentity||readApiDatabaseConnectionIdentity,openedDatabase=copy(readConnectionIdentity(filename));
 return function identityHandler(req,res){
  res.setHeader('Cache-Control','no-store');
  try{
   if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket?.remoteAddress))fail('SOURCE_API_LOCAL_ONLY');
   const envelope=req.body;if(envelope?.hostId!==hostId)fail('SOURCE_API_SIGNER');
   const payload=verifyProductionEnvelope({envelope,trust,expected:{domain:'ziwei-production-api-identity-request-v1',schemaVersion:1,kind:'api-runtime',command:'restore'}});
   fields(payload,['domain','schemaVersion','kind','command','challenge','issuedAt','expiresAt','operationId','specHash','databaseIdentity','freezeDigest','binding','target','expectedSources','controlIdentity']);
   const authority=trust.hosts.find(row=>row.hostId===hostId),original=payload.binding.apiInstances.find(row=>digestProduction(row)===payload.target.bindingDigest);
   if(!authority||authority.bindingDigest!==digestProduction(payload.binding)||!trust.approvedSpecs.some(row=>row.operationId===payload.operationId&&row.specHash===payload.specHash)||!original||!equal(original.installTargets.v2,{root:payload.target.root,entryPath:payload.target.entryPath,manifestSha256:payload.target.manifestSha256,buildDigest:payload.target.buildDigest})||payload.target.targetDigest!==digestProduction(original.installTargets.v2)||payload.target.kind!=='api'||payload.target.productRole!=='v2'||payload.target.root!==snapshot.root||payload.target.entryPath!==snapshot.entryPath||sha(JSON.stringify(payload.expectedSources))!==payload.target.buildDigest||!equal(sortedSources(payload.expectedSources),sortedSources(snapshot.sources)))fail('SOURCE_API_BOOT');
   const list=db.prepare('PRAGMA database_list').all(),file=list.find(row=>row.name==='main')?.file;if(!file)fail('SOURCE_API_DATABASE');
   const canonical=fs.realpathSync.native(file),stat=fs.lstatSync(canonical,{bigint:true}),saved=db.prepare('SELECT * FROM production_preservation_identity WHERE singleton=1').get(),state=db.prepare('SELECT * FROM version_preservation WHERE singleton=1').get();
   const actualConnection=readConnectionIdentity(file);if(!equal(actualConnection,openedDatabase)||actualConnection.canonicalPath!==canonical||actualConnection.identity.dev!==String(stat.dev)||actualConnection.identity.ino!==String(stat.ino))fail('SOURCE_API_DATABASE_HANDLE');
   const databaseIdentity={path:canonical,canonicalPath:canonical,identity:{dev:String(stat.dev),ino:String(stat.ino)},databaseId:saved?.database_id};
   if(stat.isSymbolicLink()||stat.nlink!==1n||!equal(databaseIdentity,payload.databaseIdentity)||!state||state.state!=='sealed'||state.operation_id!==payload.operationId||!equal(JSON.parse(state.versions_json),FROZEN_VERSIONS))fail('SOURCE_API_DATABASE');
   const actualControl={state:state.state,operationId:state.operation_id,intentDigest:digest(state.intent_json),snapshotDigest:state.snapshot_json?digest(state.snapshot_json):null,versionsDigest:digest(state.versions_json)};
   if(!equal(actualControl,payload.controlIdentity))fail('SOURCE_API_FENCE');
   const proof={domain:'ziwei-production-api-identity-proof-v1',schemaVersion:1,service:'ziwei-api',command:'restore',challenge:payload.challenge,issuedAt:payload.issuedAt,expiresAt:payload.expiresAt,operationId:state.operation_id,specHash:payload.specHash,freezeDigest:payload.freezeDigest,targetDigest:payload.target.targetDigest,pid,startedAt,nonceDigest,root:snapshot.root,entryPath:snapshot.entryPath,productRole:PRODUCT_ROLE,buildDigest:payload.target.buildDigest,bootSourcesDigest:sourcesDigest,databaseIdentity,fenceState:state.state,intentDigest:actualControl.intentDigest,snapshotDigest:actualControl.snapshotDigest,versionsDigest:actualControl.versionsDigest};
   res.json(signProductionEnvelope({hostId,trust,payload:proof}));
  }catch{res.status(403).json({code:'SOURCE_API_IDENTITY_REFUSED'});}
 };
}
export function verifyApiIdentityProof({envelope,trust,request,target,process:record}){
 if(envelope?.hostId!==request.binding.hostId)fail('SOURCE_RUNTIME_API');
 const payload=verifyProductionEnvelope({envelope,trust,expected:{domain:'ziwei-production-api-identity-proof-v1',schemaVersion:1,service:'ziwei-api',command:'restore',challenge:request.challenge,issuedAt:request.issuedAt,expiresAt:request.expiresAt,operationId:request.operationId,specHash:request.specHash,freezeDigest:request.freezeDigest,targetDigest:target.targetDigest,pid:record.pid,root:target.root,entryPath:target.entryPath,productRole:'v2',buildDigest:target.buildDigest,databaseIdentity:request.databaseIdentity,fenceState:'sealed',bootSourcesDigest:digestProduction(sortedSources(request.installed.apiContents)),intentDigest:request.controlIdentity.intentDigest,snapshotDigest:request.controlIdentity.snapshotDigest,versionsDigest:request.controlIdentity.versionsDigest}});
 fields(payload,['domain','schemaVersion','service','command','challenge','issuedAt','expiresAt','operationId','specHash','freezeDigest','targetDigest','pid','startedAt','nonceDigest','root','entryPath','productRole','buildDigest','bootSourcesDigest','databaseIdentity','fenceState','intentDigest','snapshotDigest','versionsDigest']);
 if(!hex(payload.nonceDigest)||!iso(payload.startedAt))fail('SOURCE_RUNTIME_API');
 return payload;
}

async function readLinuxProcess(pid){
 if(!Number.isSafeInteger(pid)||pid<=0)fail('SOURCE_NATIVE_PROCESS');
 try{
  const directory='/proc/'+pid,stat=fs.readFileSync(directory+'/stat','utf8'),bootId=fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(),argv=fs.readFileSync(directory+'/cmdline').toString().split('\0').filter(Boolean),cwd=fs.readlinkSync(directory+'/cwd'),executable=fs.readlinkSync(directory+'/exe');
  if(argv.length!==2)fail('SOURCE_NATIVE_ENTRY');
  return {pid,createdAt:null,nativeBirth:parseLinuxProcessBirth(stat,bootId),entryPath:fs.realpathSync.native(path.resolve(cwd,argv[1])),executable,commandDigest:digestProduction(argv)};
 }catch(error){if(error.code==='ENOENT'||error.code==='ESRCH')return null;throw error;}
}
async function powershell(script){const {stdout}=await run('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,encoding:'utf8',timeout:10000,maxBuffer:8*1024*1024});return stdout.trim()?json(stdout.replace(/^\uFEFF/,'')):null;}
async function readWindowsProcess(pid){
 if(!Number.isSafeInteger(pid)||pid<=0)fail('SOURCE_NATIVE_PROCESS');
 const value=await powershell("$ErrorActionPreference='Stop'; $p=Get-CimInstance Win32_Process -Filter 'ProcessId = "+pid+"'; if($p){$b=(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o'); [pscustomobject]@{pid=[int]$p.ProcessId;command=$p.CommandLine;executable=$p.ExecutablePath;createdAt=$p.CreationDate.ToUniversalTime().ToString('o');boot=$b}|ConvertTo-Json -Compress}");
 if(!value)return null;const argv=windowsCommandArguments(value.command||'');if(argv.length!==2||!path.isAbsolute(argv[1]))fail('SOURCE_NATIVE_ENTRY');
 const createdAt=new Date(value.createdAt).toISOString();return {pid,createdAt,nativeBirth:{bootId:sha(value.boot),createdAt},entryPath:fs.realpathSync.native(argv[1]),executable:value.executable,commandDigest:sha(value.command)};
}
async function readSystemd(namespace){
 if(namespace.kind!=='systemd-cgroup'||!(/^[a-zA-Z0-9_.@-]+\.service$/).test(namespace.unit||'')||typeof namespace.controlGroup!=='string'||!namespace.controlGroup.startsWith('/')||namespace.controlGroup.split('/').includes('..'))fail('SOURCE_NAMESPACE_SCOPE');
 const names=['Id','MainPID','ActiveState','ControlGroup','InvocationID','KillMode','Delegate','SendSIGKILL','NRestarts','FragmentPath','ExecMainStartTimestampMonotonic','ActiveEnterTimestampMonotonic'],{stdout}=await run('/usr/bin/systemctl',['show',namespace.unit,'--no-pager',...names.map(name=>'--property='+name)],{encoding:'utf8',timeout:8000,maxBuffer:1024*1024}),values={};
 for(const line of stdout.split('\n')){const at=line.indexOf('=');if(at>=0)values[line.slice(0,at)]=line.slice(at+1);}
 const root='/sys/fs/cgroup'+namespace.controlGroup,members=[];
 function walk(directory){if(!fs.existsSync(directory))return;for(const name of fs.readdirSync(directory)){const file=path.join(directory,name),stat=fs.lstatSync(file);if(stat.isSymbolicLink())fail('SOURCE_NAMESPACE_SCOPE');if(stat.isDirectory())walk(file);else if(name==='cgroup.procs')for(const line of fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean)){if(!/^[1-9][0-9]*$/.test(line))fail('SOURCE_NAMESPACE_SCOPE');members.push(Number(line));}}}
 walk(root);if(values.Id!==namespace.unit||values.ControlGroup&&values.ControlGroup!==namespace.controlGroup)fail('SOURCE_NAMESPACE_SCOPE');
 return {kind:'systemd-cgroup',unit:values.Id,controlGroup:namespace.controlGroup,InvocationID:values.InvocationID,KillMode:values.KillMode,Delegate:values.Delegate==='yes',SendSIGKILL:values.SendSIGKILL==='yes',ActiveState:values.ActiveState,members:[...new Set(members)].sort((a,b)=>a-b),bootId:fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(),NRestarts:Number(values.NRestarts),ExecMainStartTimestampMonotonic:values.ExecMainStartTimestampMonotonic,ActiveEnterTimestampMonotonic:values.ActiveEnterTimestampMonotonic};
}
async function readListener(origin,pid){
 const url=new URL(origin),port=Number(url.port);if(url.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(url.hostname)||!Number.isSafeInteger(port)||port<=0||port>65535)fail('SOURCE_RUNTIME_LISTENER');
 if(process.platform==='win32'){const value=await powershell("$ErrorActionPreference='Stop'; @(Get-NetTCPConnection -State Listen -LocalPort "+port+" | ForEach-Object {[pscustomobject]@{listenerPid=[int]$_.OwningProcess}})|ConvertTo-Json -Compress");const rows=Array.isArray(value)?value:value?[value]:[];if(rows.length!==1||rows[0].listenerPid!==pid)fail('SOURCE_RUNTIME_LISTENER');return {listenerPid:pid};}
 const inodes=new Set(),owned=new Set();
 for(const file of ['/proc/net/tcp','/proc/net/tcp6'])for(const line of fs.readFileSync(file,'utf8').split('\n').slice(1)){const words=line.trim().split(/\s+/);if(words[3]==='0A'&&parseInt(words[1]?.split(':')[1],16)===port)inodes.add(words[9]);}
 for(const name of fs.readdirSync('/proc/'+pid+'/fd'))try{const target=fs.readlinkSync('/proc/'+pid+'/fd/'+name),match=/^socket:\[([0-9]+)\]$/.exec(target);if(match&&inodes.has(match[1]))owned.add(match[1]);}catch(error){if(error.code!=='ENOENT')throw error;}
 if(inodes.size!==1||owned.size!==1)fail('SOURCE_RUNTIME_LISTENER');return {listenerPid:pid};
}
export const defaultNativeSourceIO=Object.freeze({
 readProcess:pid=>process.platform==='linux'?readLinuxProcess(pid):process.platform==='win32'?readWindowsProcess(pid):Promise.reject(Object.assign(new Error('SOURCE_NATIVE_PLATFORM'),{code:'SOURCE_NATIVE_PLATFORM'})),
 readNamespace:namespace=>process.platform==='linux'?readSystemd(namespace):Promise.reject(Object.assign(new Error('SOURCE_WINDOWS_NATIVE_INSPECTION_REQUIRED'),{code:'SOURCE_WINDOWS_NATIVE_INSPECTION_REQUIRED'})),
 readListener
});
