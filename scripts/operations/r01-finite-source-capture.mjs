// Operations capture container, deliberately separate from the product proof ABI.
// Reads native reader output and normal controller receipts. It cannot stop a
// service, sign an envelope, verify a product request or pronounce a scope safe.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)
  ?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b?-1:a>b?1:0)):item);
const digest=value=>sha(canonical(value));
const clone=value=>JSON.parse(canonical(value));
const equal=(a,b)=>canonical(a)===canonical(b);
const normal=file=>typeof file==='string'&&path.isAbsolute(file)&&path.resolve(file)===file;
const samePath=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
function plain(file){
  if(!normal(file))fail('CAPTURE_SCOPE_INVALID');
  if(!samePath(fs.realpathSync.native(file),file))fail('CAPTURE_PATH_LINKED');
  for(let cursor=file;;cursor=path.dirname(cursor)){
    if(fs.lstatSync(cursor).isSymbolicLink())fail('CAPTURE_PATH_LINKED');
    if(cursor===path.dirname(cursor))break;
  }
}
function inside(file,root){
  const relative=path.relative(root,file);
  return normal(file)&&relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);
}
function reference(ref,root=null,changed='CAPTURE_REFERENCE_CHANGED'){
  if(!ref||!normal(ref.path)||!hash(ref.sha256)||typeof ref.kind!=='string'||!ref.kind||typeof ref.scope!=='string'||!ref.scope)fail('CAPTURE_REFERENCE_INVALID');
  if(root&&!inside(ref.path,root))fail('CAPTURE_SCOPE_INVALID');
  plain(ref.path);const bytes=fs.readFileSync(ref.path);
  if(sha(bytes)!==ref.sha256)fail(changed);
  return {path:ref.path,sha256:ref.sha256,bytes:bytes.length,kind:ref.kind,scope:ref.scope};
}
export function codeDigest(code){
  if(!Array.isArray(code)||!code.length||code.some(ref=>!normal(ref.path)||!hash(ref.sha256)))fail('CAPTURE_PRODUCER_INVALID');
  if(code.some(ref=>!equal(Object.keys(ref).sort(),['path','sha256'])))fail('CAPTURE_PRODUCER_INVALID');
  if(new Set(code.map(ref=>ref.path)).size!==code.length)fail('CAPTURE_PRODUCER_INVALID');
  return digest(code.map(({path,sha256})=>({path,sha256})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0));
}
function staticNamespace(value){
  if(!value||typeof value!=='object')return;
  for(const [key,item] of Object.entries(value)){
    if(/^(captureSha256|captureDigest|specHash|challenge|operationId|freezeDigest|observedAt|databaseIdentity)$/.test(key))fail('CAPTURE_CIRCULAR_DESCRIPTOR');
    staticNamespace(item);
  }
}
function descriptorChecks(input){
  const d=clone(input),keys=Object.keys(d).sort();
  if(!equal(keys,['evidenceDirectory','hostId','namespace','producer','schemaVersion','staticReferences'])||d.schemaVersion!==1||typeof d.hostId!=='string'||!d.hostId||!normal(d.evidenceDirectory)||!Array.isArray(d.staticReferences)||!d.namespace||typeof d.namespace!=='object')fail('CAPTURE_DESCRIPTOR_INVALID');
  staticNamespace(d.namespace);plain(d.evidenceDirectory);
  if(!fs.statSync(d.evidenceDirectory).isDirectory())fail('CAPTURE_SCOPE_INVALID');
  if(!d.producer||!equal(Object.keys(d.producer).sort(),['code','codeDigest','id'])||d.producer.id!=='r01-finite-source-capture-v1'||!hash(d.producer.codeDigest)||codeDigest(d.producer.code)!==d.producer.codeDigest)fail('CAPTURE_PRODUCER_INVALID');
  for(const code of d.producer.code)reference({...code,kind:'producer-code',scope:d.producer.id},null,'CAPTURE_PRODUCER_CHANGED');
  if(new Set(d.staticReferences.map(ref=>ref.path)).size!==d.staticReferences.length)fail('CAPTURE_REFERENCE_INVALID');
  d.staticReferences=d.staticReferences.map(ref=>reference(ref));return d;
}
function bindingChecks(value,phase){
  if(phase==='baseline-readonly'){if(value!==null)fail('CAPTURE_BASELINE_BINDING_INVALID');return null;}
  if(!value||typeof value.operationId!=='string'||!value.operationId||typeof value.challenge!=='string'||!value.challenge||!hash(value.specHash)||!hash(value.freezeDigest)||!hash(value.bindingDigest)||!value.databaseIdentity||!['collect','recheck'].includes(value.kind)||!['prepare','seal','restore'].includes(value.command))fail('CAPTURE_BINDING_REQUIRED');
  // Authentication/freshness remains the independently pinned product verifier's
  // responsibility; this records exactly the verified payload projection passed
  // by the future controller adapter, without manufacturing product fields.
  return clone(value);
}
function sourceChecks(ref){
  const source=JSON.parse(fs.readFileSync(ref.path,'utf8'));
  if(!['r01-linux-source-observation','r01-windows-source-observation'].includes(source.kind)||source.serviceActions!==0||source.modelCalls!==0||source.phoneActions!==0)fail('CAPTURE_SOURCE_KIND_INVALID');
}
export function writeFiniteCapture({descriptor:input,binding=null,phase,observation,controllerReferences=[],output}){
  if(!['baseline-readonly','before-stop','after-stop','recheck'].includes(phase))fail('CAPTURE_PHASE_INVALID');
  const descriptor=descriptorChecks(input);binding=bindingChecks(binding,phase);
  if(!inside(output,descriptor.evidenceDirectory))fail('CAPTURE_SCOPE_INVALID');plain(path.dirname(output));
  if(fs.existsSync(output))fail('CAPTURE_OUTPUT_EXISTS');
  if(!Array.isArray(controllerReferences)||phase==='after-stop'&&!controllerReferences.length)fail('CAPTURE_CONTROLLER_REQUIRED');
  const source=reference(observation,descriptor.evidenceDirectory);sourceChecks(source);
  const controllers=controllerReferences.map(ref=>reference(ref,descriptor.evidenceDirectory));
  if(controllers.some(ref=>ref.kind!=='controller-receipt'))fail('CAPTURE_REFERENCE_INVALID');
  const capture={domain:'r01-finite-native-capture-draft-v1',schemaVersion:1,hostId:descriptor.hostId,
    producer:descriptor.producer,descriptorDigest:digest(descriptor),namespace:descriptor.namespace,binding,phase,
    capturedAt:new Date().toISOString(),observation:source,controllerReferences:controllers,staticReferences:descriptor.staticReferences,
    // Byte retention digest, not the product's stable evidenceDigest: a new
    // native observation has new timestamps/bytes. The source observer selects
    // and independently rechecks original generation/coverage semantics.
    retainedSourceDigest:digest({producer:descriptor.producer,namespace:descriptor.namespace,observation:source,staticReferences:descriptor.staticReferences}),
    controllerStatus:controllers.length?'RECORDED_UNVERIFIED':'NOT_RUN',namespaceComplete:null,workerScopeComplete:null,
    authentication:'not-performed-by-producer',formalGatePassed:false};
  const bytes=canonical(capture)+'\n';fs.writeFileSync(output,bytes,{flag:'wx',mode:0o600});
  return {path:output,sha256:sha(bytes),capture};
}
export function recheckFiniteCapture({descriptor:input,path:file,sha256,binding}){
  const descriptor=descriptorChecks(input);
  const record=reference({path:file,sha256,kind:'retained-capture',scope:descriptor.hostId},descriptor.evidenceDirectory);
  const capture=JSON.parse(fs.readFileSync(file,'utf8'));
  if(capture.domain!=='r01-finite-native-capture-draft-v1'||capture.descriptorDigest!==digest(descriptor)||!equal(capture.binding,binding))fail('CAPTURE_BINDING_CHANGED');
  reference(capture.observation,descriptor.evidenceDirectory);sourceChecks(capture.observation);
  for(const ref of capture.controllerReferences)reference(ref,descriptor.evidenceDirectory);
  if(!equal(capture.staticReferences,descriptor.staticReferences))fail('CAPTURE_REFERENCE_CHANGED');
  return record;
}
