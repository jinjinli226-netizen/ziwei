/** R01 operations wire for the frozen product ABI. Product functions are
 * independently pinned code dependencies. No product schema/guard, lifecycle
 * control, deployment, endpoint selection or default release approval here.
 */
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawn} from 'node:child_process';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const equalPath=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
function plain(file){
 if(typeof file!=='string'||!path.isAbsolute(file)||path.resolve(file)!==file)fail('OPS_PATH_INVALID');
 for(let cursor=file;;cursor=path.dirname(cursor)){if(fs.lstatSync(cursor).isSymbolicLink())fail('OPS_PATH_LINKED');if(cursor===path.dirname(cursor))break;}
 if(!equalPath(fs.realpathSync.native(file),file))fail('OPS_PATH_REDIRECTED');return file;
}
const inside=(root,file)=>{const relative=path.relative(root,file);return relative!==''&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
function pin(file,digest,code='OPS_COLLECTOR_CHANGED'){plain(file);if(!hex(digest)||sha(fs.readFileSync(file))!==digest)fail(code);}
function productCode(product,names){if(!product||names.some(name=>typeof product[name]!=='function'))fail('OPS_PRODUCT_ABI_REQUIRED');}
function copy(product,value){return JSON.parse(product.canonicalProduction(value));}
function frozen(product,value){const result=copy(product,value);const freeze=item=>{if(item&&typeof item==='object'){Object.values(item).forEach(freeze);Object.freeze(item);}return item;};return freeze(result);}
function fields(value,keys){if(!value||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))fail('OPS_WIRE_FIELDS');}
function newJson(product,file,value){fs.writeFileSync(file,product.canonicalProduction(value)+'\n',{flag:'wx',mode:0o600});}
const sourceDomain=kind=>kind==='collect'?'ziwei-production-collect-proof-v1':'ziwei-production-recheck-proof-v1';

export function createProductionProofProvider({product,trust,transportTrust,runTransport}){
 productCode(product,['canonicalProduction','digestProduction','validateProductionRequest','verifyProductionEnvelope']);
 if(typeof runTransport!=='function'||transportTrust===trust)fail('OPS_INDEPENDENT_TRANSPORT_REQUIRED');
 const trusted=frozen(product,trust),transports=frozen(product,transportTrust),used=new Set();let prior=null;
 if(transports.schemaVersion!==1||!Array.isArray(transports.hosts)||new Set(transports.hosts.map(host=>host.hostId)).size!==transports.hosts.length)fail('OPS_TRANSPORT_TRUST_INVALID');
 async function dispatch(input,stage){
  const value=frozen(product,input);fields(value,stage==='collect'?['operationId','specHash','databaseIdentity','freezeDigest','requiredHosts','requests','priorEvidenceDigest']:['operationId','specHash','databaseIdentity','freezeDigest','requiredHosts','requests','priorEvidenceDigest','previous']);
  if(!Array.isArray(value.requiredHosts)||!value.requiredHosts.length||new Set(value.requiredHosts).size!==value.requiredHosts.length||!Array.isArray(value.requests)||value.requests.length!==value.requiredHosts.length)fail('OPS_HOST_REQUEST_INVALID');
  const payloads=value.requests.map((request,index)=>{
   if(request.hostId!==value.requiredHosts[index])fail('OPS_HOST_REQUEST_INVALID');
   const payload=product.validateProductionRequest({request,trust:trusted,kind:stage});
   if(['operationId','specHash','databaseIdentity','freezeDigest','priorEvidenceDigest'].some(key=>product.digestProduction(payload[key])!==product.digestProduction(value[key])))fail('OPS_REQUEST_BINDING_INVALID');
   const host=transports.hosts.find(row=>row.hostId===request.hostId);if(!host||!hex(host.collectorSha256))fail('OPS_HOST_NOT_TRUSTED');return payload;
  });
  const challenge=payloads[0].challenge;if(payloads.some(payload=>payload.challenge!==challenge||payload.command!==payloads[0].command))fail('OPS_REQUEST_BINDING_INVALID');
  if(stage==='collect'&&value.priorEvidenceDigest!==null)fail('OPS_PREVIOUS_INVALID');
  if(stage==='recheck'){
   if(!Array.isArray(value.previous)||value.previous.length!==value.requiredHosts.length||product.digestProduction(value.previous)!==value.priorEvidenceDigest||value.previous.some((envelope,index)=>envelope.hostId!==value.requiredHosts[index]))fail('OPS_PREVIOUS_INVALID');
   if(!prior||prior.digest!==value.priorEvidenceDigest||product.digestProduction(value.previous)!==product.digestProduction(prior.envelopes))fail('OPS_PREVIOUS_INVALID');
   for(let index=0;index<value.previous.length;index++)product.verifyProductionEnvelope({envelope:value.previous[index],trust:trusted,expected:{domain:sourceDomain('collect'),kind:'collect',operationId:value.operationId,specHash:value.specHash,databaseIdentity:value.databaseIdentity,freezeDigest:value.freezeDigest,bindingDigest:product.digestProduction(payloads[index].binding)}});
  }
  if(used.has(challenge))fail('OPS_CHALLENGE_REUSED');used.add(challenge);
  const envelopes=[];
  for(let index=0;index<value.requests.length;index++){
   const request=value.requests[index],payload=payloads[index],host=transports.hosts.find(row=>row.hostId===request.hostId);
   const response=await runTransport(copy(product,host),frozen(product,{stage,request,previous:stage==='recheck'?value.previous:null}));
   const envelope=frozen(product,response),verified=product.verifyProductionEnvelope({envelope,trust:trusted,expected:{domain:sourceDomain(stage),schemaVersion:1,kind:stage,command:payload.command,collector:payload.collector,challenge:payload.challenge,issuedAt:payload.issuedAt,expiresAt:payload.expiresAt,operationId:value.operationId,specHash:value.specHash,databaseIdentity:value.databaseIdentity,freezeDigest:value.freezeDigest,bindingDigest:product.digestProduction(payload.binding),actionProjectionDigest:product.digestProduction(payload.actionProjection),gatewayInboxDigest:product.digestProduction(payload.gatewayInbox),homesDigest:product.digestProduction(payload.homes),installedDigest:product.digestProduction(payload.installed),priorEvidenceDigest:value.priorEvidenceDigest}});
   if(envelope.hostId!==request.hostId||product.digestProduction(verified)!==product.digestProduction(envelope.payload))fail('OPS_ENVELOPE_REJECTED');envelopes.push(copy(product,envelope));
  }
  if(stage==='collect')prior={digest:product.digestProduction(envelopes),envelopes:frozen(product,envelopes)};
  return envelopes;
 }
 return Object.freeze({collect:input=>dispatch(input,'collect'),recheck:input=>dispatch(input,'recheck')});
}

export function createSourceCliTransport({privateRoot,product,timeoutMs=30000,maxBytes=16*1024*1024}){
 productCode(product,['canonicalProduction']);const root=plain(privateRoot);
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>64*1024*1024)fail('OPS_TRANSPORT_BOUNDS_INVALID');
 return async(host,input)=>{
  const source=frozen(product,host.transport),value=frozen(product,input);fields(value,['stage','request','previous']);
  if(source.kind!=='source-cli-files'||!['collect','recheck'].includes(value.stage))fail('OPS_TRANSPORT_KIND_INVALID');
  const {entry,cwd,executable,trustFile}=source;
  if(!inside(root,entry)||cwd!==root&&!inside(root,cwd)||!inside(root,trustFile)||!Array.isArray(source.codePins)||!source.codePins.some(row=>row.path===entry))fail('OPS_TRANSPORT_SCOPE_INVALID');
  plain(cwd);pin(executable,source.executableSha256,'OPS_EXECUTABLE_CHANGED');pin(trustFile,source.trustSha256,'OPS_TRUST_FILE_CHANGED');
  for(const row of source.codePins){if(!inside(root,row.path))fail('OPS_TRANSPORT_SCOPE_INVALID');pin(row.path,row.sha256);}
  const requestBytes=Buffer.from(product.canonicalProduction(value.request));if(requestBytes.length>maxBytes)fail('OPS_REQUEST_TOO_LARGE');
  if(value.stage==='collect'&&value.previous!==null||value.stage==='recheck'&&!Array.isArray(value.previous))fail('OPS_PREVIOUS_INVALID');
  const directory=path.join(root,'source-attempt-'+crypto.randomUUID());fs.mkdirSync(directory,{mode:0o700});
  const requestFile=path.join(directory,'request.json'),previousFile=path.join(directory,'previous.json'),output=path.join(directory,'envelope.json');
  newJson(product,requestFile,value.request);if(value.stage==='recheck')newJson(product,previousFile,value.previous);
  const args=[entry,value.stage,'--request',requestFile,'--trust',trustFile,'--output',output,...(value.stage==='recheck'?['--previous',previousFile]:[])];
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>['PATH','SYSTEMROOT','SYSTEMDRIVE','COMSPEC','TEMP','TMP','USERPROFILE','HOME','LOCALAPPDATA','APPDATA'].includes(key.toUpperCase())));
  try{
   const summary=await new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{cwd,env,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});let ended=false,length=0,chunks=[];
    const finish=code=>{if(ended)return;ended=true;clearTimeout(timer);child.kill();reject(Object.assign(new Error(code),{code}));};
    const timer=setTimeout(()=>finish('OPS_SOURCE_OUTCOME_UNKNOWN'),timeoutMs);child.on('error',()=>finish('OPS_SOURCE_START_FAILED'));child.stderr.on('data',()=>{});
    child.stdout.on('data',chunk=>{length+=chunk.length;if(length>64*1024)finish('OPS_SOURCE_SUMMARY_INVALID');else chunks.push(chunk);});
    child.on('close',code=>{if(ended)return;ended=true;clearTimeout(timer);if(code!==0)return reject(Object.assign(new Error('OPS_SOURCE_REFUSED'),{code:'OPS_SOURCE_REFUSED'}));try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(Object.assign(new Error('OPS_SOURCE_SUMMARY_INVALID'),{code:'OPS_SOURCE_SUMMARY_INVALID'}));}});
   });
   fields(summary,['complete','path','hostId','operationId','evidenceDigest']);if(summary.path!==output||summary.hostId!==host.hostId||summary.operationId!==value.request.payload.operationId||typeof summary.complete!=='boolean'||!hex(summary.evidenceDigest))fail('OPS_SOURCE_SUMMARY_INVALID');
   plain(output);if(fs.statSync(output).size>maxBytes)fail('OPS_RESPONSE_TOO_LARGE');const envelope=JSON.parse(fs.readFileSync(output,'utf8'));
   for(const row of source.codePins)pin(row.path,row.sha256);pin(trustFile,source.trustSha256,'OPS_TRUST_FILE_CHANGED');
   newJson(product,path.join(directory,'receipt.json'),{outcome:'source-returned',hostId:host.hostId,requestSha256:sha(requestBytes),envelopeSha256:sha(fs.readFileSync(output)),summary});return envelope;
  }catch(error){newJson(product,path.join(directory,'unknown.json'),{outcome:'refused-or-unknown',hostId:host.hostId,code:/^OPS_[A-Z_]+$/.test(error.code||'')?error.code:'OPS_SOURCE_FAILED'});throw error;}
 };
}

export function createProductionPhaseController({privateRoot,journalDirectory,product,packageRoot,proofProvider,verifyReleaseGate,verifyBackupProof}){
 productCode(product,['canonicalProduction','digestProduction','validateProductionSpec','runProductionPreservation']);
 const root=plain(privateRoot),directory=path.resolve(journalDirectory||'');if(!inside(root,directory))fail('OPS_PRIVATE_OUTPUT_REQUIRED');plain(path.dirname(directory));if(packageRoot!==undefined)plain(packageRoot);
 const ledgerFile=path.join(directory,'ledger.json'),read=()=>fs.existsSync(ledgerFile)?JSON.parse(fs.readFileSync(plain(ledgerFile),'utf8')):null;
 const save=value=>{const temporary=path.join(directory,crypto.randomUUID()+'.next');newJson(product,temporary,value);fs.renameSync(temporary,ledgerFile);};
 function receipt(value,command,spec){if(!value||value.mode!=='applied'||value.command!==command||value.operationId!==spec.operationId||value.specHash!==spec.specHash||value.role!=='v2'||value.state!==({prepare:'preparing',seal:'sealed',restore:'restored',abort:'restored'})[command]||!value.databaseId||!hex(value.freezeDigest)||!hex(value.evidenceDigest))fail('OPS_RECEIPT_INVALID');return copy(product,value);}
 function lock(){fs.mkdirSync(directory,{recursive:true,mode:0o700});plain(directory);const file=path.join(directory,'controller.lock'),nonce=crypto.randomUUID();let fd;try{fd=fs.openSync(file,'wx',0o600);}catch{fail('OPS_CONTROLLER_LOCKED');}try{fs.writeFileSync(fd,JSON.stringify({pid:process.pid,nonce}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}return()=>{const own=JSON.parse(fs.readFileSync(file,'utf8'));if(own.pid!==process.pid||own.nonce!==nonce)fail('OPS_CONTROLLER_LOCK_CHANGED');fs.unlinkSync(file);};}
 async function run({command='inspect',apply=false,spec:raw,trust:rawTrust,backupProof}={}){
  if(!['inspect','prepare','seal','restore','abort'].includes(command)||typeof apply!=='boolean'||command==='inspect'&&apply)fail('OPS_COMMAND_INVALID');
  if(!rawTrust||rawTrust===raw)fail('OPS_INDEPENDENT_TRUST_REQUIRED');const spec=frozen(product,raw),trust=frozen(product,rawTrust),backup=backupProof===undefined?undefined:frozen(product,backupProof);
  const {specHash,...body}=spec;if(product.digestProduction(body)!==specHash)fail('OPS_SPEC_HASH_MISMATCH');product.validateProductionSpec({spec,trust,...(packageRoot?{packageRoot}:{})});
  const prior=read();if(prior&&(prior.operationId!==spec.operationId||prior.specHash!==specHash))fail('OPS_JOURNAL_OPERATION_CONFLICT');if(apply&&prior?.pending)fail('OPS_INSPECT_REQUIRED');
  const call=(requested,willApply)=>product.runProductionPreservation({command:requested,apply:willApply,spec,trust,proofProvider,...(backup?{backupProof:backup}:{}),...(packageRoot?{packageRoot}:{})});
  if(!apply){
   const requested=command==='inspect'&&prior?.pending?prior.pending.command:command,result=await call(requested,false);
   if(result.mode!=='plan'||result.willApply!==false||result.command!==requested||result.operationId!==spec.operationId||result.specHash!==specHash||!['absent','preparing','sealed','restored'].includes(result.state))fail('OPS_PLAN_INVALID');
   let recovered=false;
   if(prior?.pending&&command==='inspect'&&result.receipt){const original=receipt(result.receipt,prior.pending.command,spec),release=lock();try{const latest=read();if(latest?.pending?.attempt===prior.pending.attempt){newJson(product,path.join(directory,crypto.randomUUID()+'-recovered.json'),{recoveredByOriginalCommandReadOnlyReceipt:true,command:requested,receiptDigest:product.digestProduction(original)});save({...latest,pending:null,lastReceipt:original});recovered=true;}}finally{release();}}
   return{mode:'plan',willApply:false,result,recovered};
  }
  if(typeof verifyReleaseGate!=='function'||await verifyReleaseGate({spec,trust})!==true)fail('OPS_RELEASE_GATE_NOT_ACCEPTED');
  if(typeof proofProvider?.collect!=='function'||typeof proofProvider?.recheck!=='function')fail('OPS_PROOF_PROVIDER_REQUIRED');
  if(command==='seal'&&(!backup||typeof verifyBackupProof!=='function'||await verifyBackupProof(backup,{spec,trust})!==true)&&typeof proofProvider.backup!=='function')fail('OPS_BACKUP_PROOF_REQUIRED');
  const release=lock(),attempt=crypto.randomUUID();try{
   const latest=read();if(latest?.pending||latest&&(latest.operationId!==spec.operationId||latest.specHash!==specHash))fail('OPS_INSPECT_REQUIRED');
   const pending={command,attempt};newJson(product,path.join(directory,attempt+'-request.json'),{operationId:spec.operationId,specHash,pending,at:new Date().toISOString()});save({operationId:spec.operationId,specHash,pending,lastReceipt:latest?.lastReceipt||null});
   try{const result=await call(command,true),original=receipt(result,command,spec);newJson(product,path.join(directory,attempt+'-receipt.json'),original);save({operationId:spec.operationId,specHash,pending:null,lastReceipt:original});return{mode:'applied',command,result};}
   catch{newJson(product,path.join(directory,attempt+'-unknown.json'),{operationId:spec.operationId,specHash,command,outcome:'unknown'});fail('OPS_PRODUCT_OUTCOME_UNKNOWN');}
  }finally{release();}
 }
 return Object.freeze({run});
}

export function createNamespaceCaptureWriter({product,namespace,trust,binding,producerPath,producerSha256,observeNative}){
 productCode(product,['canonicalProduction','digestProduction','validateProductionRequest','verifyProductionEnvelope']);productCode(namespace,['validateNativeSourceRefs','namespaceCaptureFile','createNamespaceCaptureEnvelope']);
 if(typeof observeNative!=='function')fail('OPS_NATIVE_OBSERVER_REQUIRED');const trusted=frozen(product,trust),bound=frozen(product,binding);
 const refs=namespace.validateNativeSourceRefs(bound),directory=refs.find(row=>row.kind==='namespace-capture-directory-v1'),policyRef=refs.find(row=>row.kind==='namespace-policy-v1');
 async function capture({phase,request}){
  const source=frozen(product,request),payload=product.validateProductionRequest({request:source,trust:trusted});
  if(source.hostId!==bound.hostId||product.digestProduction(payload.binding)!==product.digestProduction(bound)||!directory||!policyRef||!['before-stop','after-stop'].includes(phase))fail('OPS_CAPTURE_SCOPE_INVALID');
  pin(producerPath,producerSha256,'OPS_PRODUCER_CHANGED');if(directory.producerSha256!==producerSha256)fail('OPS_PRODUCER_CHANGED');pin(policyRef.canonicalPath,policyRef.sha256,'OPS_POLICY_CHANGED');plain(directory.canonicalPath);
  const policy=JSON.parse(fs.readFileSync(policyRef.canonicalPath,'utf8')),output=namespace.namespaceCaptureFile(directory,phase);if(fs.existsSync(output))fail('OPS_CAPTURE_EXISTS');
  if(policy.kind!=='source-namespace-policy-v1'||policy.schemaVersion!==1||!Array.isArray(policy.instances))fail('OPS_CAPTURE_SCOPE_INVALID');
  const originals=[...(bound.apiInstances||[]).map(original=>({kind:'api',original})),...(bound.clients||[]).map(original=>({kind:'client',original}))];
  if(!originals.length||policy.instances.length!==originals.length)fail('OPS_NATIVE_CAPTURE_INCOMPLETE');
  const observed=frozen(product,await observeNative({phase,binding:bound,request:payload,policy}));fields(observed,['instances','workerFacts']);
  if(!Array.isArray(observed.instances)||observed.instances.length!==policy.instances.length)fail('OPS_NATIVE_CAPTURE_INCOMPLETE');
  for(const item of policy.instances)if(observed.instances.filter(row=>row.kind===item.kind&&row.bindingDigest===item.bindingDigest).length!==1)fail('OPS_NATIVE_CAPTURE_INCOMPLETE');
  for(const {kind,original} of originals){
   const record=observed.instances.find(row=>row.kind===kind&&row.bindingDigest===product.digestProduction(original));
   if(!record||product.digestProduction(record.originalInstance)!==product.digestProduction(original.originalInstance)||!record.namespace)fail('OPS_NATIVE_CAPTURE_INCOMPLETE');
   if(phase==='before-stop'){
    const instance=original.originalInstance,process=record.process;
    const birthMatches=process&&(instance.nativeBirth?process.nativeBirth&&product.digestProduction(process.nativeBirth)===product.digestProduction(instance.nativeBirth):typeof process.createdAt==='string'&&Number.isFinite(Date.parse(process.createdAt))&&Date.parse(process.createdAt)===Date.parse(instance.createdAt));
    if(!process||process.pid!==instance.pid||process.entryPath!==original.entryPath||!birthMatches||(instance.identityKind||'boot-nonce')==='boot-nonce'&&record.nonceDigest!==instance.nonceDigest)fail('OPS_NATIVE_CAPTURE_INCOMPLETE');
   }
   if(record.namespace.kind==='systemd-cgroup'){
    const n=record.namespace;
    if(typeof n.InvocationID!=='string'||n.InvocationID!==''&&!/^[a-f0-9]{32}$/.test(n.InvocationID)||n.KillMode!=='control-group'||n.Delegate!==false||n.SendSIGKILL!==true||!Array.isArray(n.members)||!Number.isSafeInteger(n.NRestarts)||n.NRestarts<0||!/^\d+$/.test(n.ExecMainStartTimestampMonotonic||'')||!/^\d+$/.test(n.ActiveEnterTimestampMonotonic||'')||!n.bootId)fail('OPS_NATIVE_CAPTURE_INCOMPLETE');
    if(phase==='before-stop'&&(!n.members.includes(original.originalInstance.pid)||original.originalInstance.identityKind==='systemd-invocation'&&sha(n.InvocationID)!==original.originalInstance.nonceDigest))fail('OPS_NATIVE_CAPTURE_INCOMPLETE');
    if(phase==='after-stop'&&(n.members.length||!['inactive','failed'].includes(n.ActiveState)))fail('OPS_NATIVE_CAPTURE_INCOMPLETE');
   }else if(record.namespace.kind==='windows-source'){
    if(record.namespace.visibility!=='native-memory-and-registry'||!Array.isArray(record.namespace.members)||!Array.isArray(record.namespace.unresolved)||record.namespace.unresolved.length||!observed.workerFacts)fail('OPS_NATIVE_CAPTURE_INCOMPLETE');
   }else fail('OPS_NATIVE_CAPTURE_INCOMPLETE');
  }
  let previousCaptureDigest=null;
  if(phase==='after-stop'){const beforeFile=namespace.namespaceCaptureFile(directory,'before-stop');plain(beforeFile);const before=JSON.parse(fs.readFileSync(beforeFile,'utf8'));product.verifyProductionEnvelope({envelope:before,trust:trusted,expected:{domain:'ziwei-production-namespace-capture-v1',phase:'before-stop',operationId:payload.operationId,specHash:payload.specHash,databaseIdentity:payload.databaseIdentity,freezeDigest:payload.freezeDigest,bindingDigest:product.digestProduction(bound),producerSha256,policyDigest:product.digestProduction(policy)}});if(before.hostId!==bound.hostId)fail('OPS_CAPTURE_CHAIN_INVALID');previousCaptureDigest=product.digestProduction(before);}
  pin(producerPath,producerSha256,'OPS_PRODUCER_CHANGED');pin(policyRef.canonicalPath,policyRef.sha256,'OPS_POLICY_CHANGED');
  const envelope=namespace.createNamespaceCaptureEnvelope({hostId:bound.hostId,trust:trusted,payload:{domain:'ziwei-production-namespace-capture-v1',schemaVersion:1,producer:'ziwei-source-namespace-v1',producerSha256,phase,challenge:payload.challenge,capturedAt:new Date().toISOString(),operationId:payload.operationId,specHash:payload.specHash,databaseIdentity:payload.databaseIdentity,freezeDigest:payload.freezeDigest,bindingDigest:product.digestProduction(bound),policyDigest:product.digestProduction(policy),previousCaptureDigest,instances:observed.instances,workerFacts:observed.workerFacts}});
  newJson(product,output,envelope);return{path:output,sha256:sha(fs.readFileSync(output)),envelope};
 }
 return Object.freeze({capture});
}
