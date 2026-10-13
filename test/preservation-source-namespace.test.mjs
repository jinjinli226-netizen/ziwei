import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {canonicalProduction,digestProduction,signProductionEnvelope} from '../backend/production-preservation.mjs';
import {FROZEN_VERSIONS,digest} from '../backend/version-preservation.mjs';
import {nativeActionDigest} from '../backend/preservation-native-databases.mjs';
import * as api from '../backend/preservation-source-namespace.mjs';
import {collectVerifiedProductionSourceProof} from '../scripts/production-source-proof.mjs';
test('namespace observer refuses missing native provenance instead of certifying vanished PID',async()=>{
 assert.equal(typeof api.observePreservationSourceNamespace,'function');
 const result=await api.observePreservationSourceNamespace({binding:{hostId:'fixture',clients:[],apiInstances:[],nativeSourceRefs:[]},request:{operationId:'fixture'}});
 assert.equal(result.safe,false);assert.equal(result.namespaceComplete,false);assert.equal(result.workerScopeComplete,false);
});
test('native Linux birth retains actual bootId/startTicks without treating ticks as an ISO date',()=>{
 assert.equal(typeof api.parseLinuxProcessBirth,'function');
 const stat='123 (node worker) S '+Array.from({length:19},(_,index)=>index===18?'7654321':'0').join(' ');
 assert.deepEqual(api.parseLinuxProcessBirth(stat,'e5d1e146-60d6-49d2-82d5-3987000b54a2'),{bootId:'e5d1e146-60d6-49d2-82d5-3987000b54a2',startTicks:'7654321'});
});
test('signed stopped parent capture cannot clear a surviving child or unsupported raw spawn',()=>{
 assert.equal(typeof api.verifyWindowsWorkerFacts,'function');
 const facts={kind:'windows-source-facts-v1',completeConnections:true,completeSameBootLogger:true,completeMaintenance:true,unresolved:[],sourceBindings:['a'.repeat(64)],actions:[{actionId:'original',actionDigest:'b'.repeat(64),kind:'job',jobName:'Local\\Ziwei.Runtime.fixture',nonce:'fixture',hostPid:123,processExit:{treeConfirmed:true,activeProcesses:1,rootConfirmed:true,launched:true,rootPid:124,rootExitCode:0}}]};
 assert.equal(api.verifyWindowsWorkerFacts(facts,[{id:'original',digest:'b'.repeat(64)}]).safe,false);
 facts.actions[0].kind='raw-spawn';facts.actions[0].processExit.activeProcesses=0;assert.equal(api.verifyWindowsWorkerFacts(facts,[{id:'original',digest:'b'.repeat(64)}]).safe,false);
});
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-source-namespace-'));
 const keyRef=path.join(root,'private.key');fs.writeFileSync(keyRef,crypto.randomBytes(32),{mode:0o600});
 const databaseFile=path.join(root,'current.sqlite'),db=new DatabaseSync(databaseFile),databaseId=crypto.randomUUID();db.exec("CREATE TABLE production_preservation_identity(singleton INTEGER,database_id TEXT); CREATE TABLE version_preservation(singleton INTEGER,operation_id TEXT,state TEXT,versions_json TEXT,intent_json TEXT,snapshot_json TEXT);");db.prepare('INSERT INTO production_preservation_identity VALUES(1,?)').run(databaseId);db.prepare('INSERT INTO version_preservation VALUES(1,?,?,?,?,?)').run('namespace_fixture','sealed',JSON.stringify(FROZEN_VERSIONS),'{}','{}');t.after(()=>{db.close();assert.ok(root.startsWith(path.join(os.tmpdir(),'ziwei-source-namespace-')));fs.rmSync(root,{recursive:true,force:true});});
 const stat=fs.lstatSync(databaseFile,{bigint:true}),databaseIdentity={path:databaseFile,canonicalPath:databaseFile,identity:{dev:String(stat.dev),ino:String(stat.ino)},databaseId};
 const oldRoot=path.join(root,'old-api'),newRoot=path.join(root,'new-api');fs.mkdirSync(oldRoot);fs.mkdirSync(newRoot);
 const sources=[{path:'backend/server.mjs',sha256:'d'.repeat(64)}],buildDigest=sha(JSON.stringify(sources)),target={root:newRoot,entryPath:path.join(newRoot,'backend/server.mjs'),manifestSha256:'c'.repeat(64),buildDigest};
 const original={root:oldRoot,entryPath:path.join(oldRoot,'backend/server.mjs'),role:'v1',buildDigest:'a'.repeat(64),serviceManager:'systemd',originalInstance:{pid:999999999,createdAt:null,identityKind:'systemd-invocation',nonceDigest:sha('1234567890abcdef1234567890abcdef'),nativeBirth:{bootId:'e5d1e146-60d6-49d2-82d5-3987000b54a2',startTicks:'1000'}},installTargets:{v2:target,'v1-compat':{...target,root:path.join(root,'compat'),entryPath:path.join(root,'compat/backend/server.mjs')}}};
 const namespace={kind:'systemd-cgroup',unit:'ziwei-api.service',controlGroup:'/system.slice/ziwei-api.service'},policy={schemaVersion:1,kind:'source-namespace-policy-v1',instances:[{kind:'api',bindingDigest:digestProduction(original),namespace,identityOrigin:'http://127.0.0.1:3000'}]},policyFile=path.join(root,'policy.json');fs.writeFileSync(policyFile,canonicalProduction(policy));
 const captures=path.join(root,'captures'),runtimeDirectory=path.join(root,'runtime');fs.mkdirSync(captures);fs.mkdirSync(runtimeDirectory);
 const binding={hostId:'fixture_host',deviceIds:[],workspaceIds:['ws_fixture'],clients:[],apiInstances:[original],nativeSourceRefs:[{kind:'namespace-policy-v1',canonicalPath:policyFile,sha256:sha(fs.readFileSync(policyFile))},{kind:'namespace-capture-directory-v1',canonicalPath:captures,producerSha256:'b'.repeat(64)},{kind:'runtime-identity-directory-v1',canonicalPath:runtimeDirectory,producerSha256:'b'.repeat(64)}]};
 const trust={schemaVersion:1,algorithm:'hmac-sha256',hosts:[{hostId:binding.hostId,keyId:'fixture_key',keyRef,bindingDigest:digestProduction(binding)}],approvedSpecs:[{operationId:'namespace_fixture',specHash:'e'.repeat(64)}],backupHostId:binding.hostId};
 const issuedAt=new Date().toISOString(),request={domain:'ziwei-production-request-v1',schemaVersion:1,kind:'collect',command:'prepare',collector:'ziwei-production-source-v1',challenge:crypto.randomUUID(),issuedAt,expiresAt:new Date(Date.parse(issuedAt)+60000).toISOString(),operationId:'namespace_fixture',specHash:'e'.repeat(64),databaseIdentity,freezeDigest:'f'.repeat(64),binding,actionProjection:{tables:{a2a_actions:{rows:[]}}},gatewayInbox:[],homes:[],priorEvidenceDigest:null,targetOrigins:['https://fixture.invalid'],installed:null,controlIdentity:{state:'sealed',operationId:'namespace_fixture',intentDigest:digest('{}'),snapshotDigest:digest('{}'),versionsDigest:digest(JSON.stringify(FROZEN_VERSIONS))}};
 const beforeNamespace={...namespace,InvocationID:'1234567890abcdef1234567890abcdef',KillMode:'control-group',Delegate:false,SendSIGKILL:true,ActiveState:'active',members:[original.originalInstance.pid],bootId:original.originalInstance.nativeBirth.bootId,NRestarts:0,ExecMainStartTimestampMonotonic:'1000',ActiveEnterTimestampMonotonic:'1001'},afterNamespace={...beforeNamespace,ActiveState:'inactive',members:[]};
 const producerBase={domain:'ziwei-production-namespace-capture-v1',schemaVersion:1,producer:'ziwei-source-namespace-v1',producerSha256:'b'.repeat(64),challenge:request.challenge,capturedAt:issuedAt,operationId:request.operationId,specHash:request.specHash,databaseIdentity,freezeDigest:request.freezeDigest,bindingDigest:digestProduction(binding),policyDigest:digestProduction(policy),workerFacts:null};
 const before=api.createNamespaceCaptureEnvelope({hostId:binding.hostId,trust,payload:{...producerBase,phase:'before-stop',previousCaptureDigest:null,instances:[{kind:'api',bindingDigest:digestProduction(original),originalInstance:original.originalInstance,process:{pid:original.originalInstance.pid,createdAt:null,nativeBirth:original.originalInstance.nativeBirth,entryPath:original.entryPath},namespace:beforeNamespace}]}});
 const after=api.createNamespaceCaptureEnvelope({hostId:binding.hostId,trust,payload:{...producerBase,phase:'after-stop',previousCaptureDigest:digestProduction(before),instances:[{kind:'api',bindingDigest:digestProduction(original),originalInstance:original.originalInstance,process:null,namespace:afterNamespace}]}});
 fs.writeFileSync(api.namespaceCaptureFile(binding.nativeSourceRefs[1],'before-stop'),canonicalProduction(before));fs.writeFileSync(api.namespaceCaptureFile(binding.nativeSourceRefs[1],'after-stop'),canonicalProduction(after));
 const native={async readProcess(){return null;},async readNamespace(){return afterNamespace;},async readListener(origin,pid){return {listenerPid:pid};}};
 return {root,db,trust,binding,request,original,target,sources,before,after,afterNamespace,native};
}
test('independent signed pre/post captures plus current empty service cgroup establish stopped original',async t=>{
 const f=setup(t),beforeBytes=sha(fs.readFileSync(f.request.databaseIdentity.path));
 const result=await api.observePreservationSourceNamespace({binding:f.binding,request:f.request,trust:f.trust},f.native);
 assert.equal(result.safe,true);assert.equal(result.instances[0].stopped,true);assert.equal(result.files.length,3);assert.equal(sha(fs.readFileSync(f.request.databaseIdentity.path)),beforeBytes);
});
test('capture bad signature/foreign instance/surviving member/current restart stays unknown',async t=>{
 for(const change of ['signature','instance','child','restart','restart-then-exit']){
  const f=setup(t);
  if(change==='signature'){f.after.signature='0'.repeat(64);fs.writeFileSync(api.namespaceCaptureFile(f.binding.nativeSourceRefs[1],'after-stop'),canonicalProduction(f.after));}
  if(change==='instance'){f.after.payload.instances[0].originalInstance.nativeBirth.startTicks='900';f.after=signProductionEnvelope({hostId:f.binding.hostId,payload:f.after.payload,trust:f.trust});fs.writeFileSync(api.namespaceCaptureFile(f.binding.nativeSourceRefs[1],'after-stop'),canonicalProduction(f.after));}
  if(change==='child')f.native.readNamespace=async()=>({...f.afterNamespace,members:[5555555]});
  if(change==='restart')f.native.readProcess=async()=>({pid:f.original.originalInstance.pid,nativeBirth:f.original.originalInstance.nativeBirth,createdAt:null,entryPath:f.original.entryPath});
  if(change==='restart-then-exit')f.native.readNamespace=async()=>({...f.afterNamespace,InvocationID:'',ExecMainStartTimestampMonotonic:'2000',ActiveEnterTimestampMonotonic:'2001'});
  const result=await api.observePreservationSourceNamespace({binding:f.binding,request:f.request,trust:f.trust},f.native);assert.equal(result.safe,false);assert.equal(result.workerScopeComplete,false);
 }
});
function apiSetup(f){
 f.request.command='restore';f.request.installed={productRole:'v2',candidateCommit:'a'.repeat(40),databaseId:f.request.databaseIdentity.databaseId,apiBuildDigest:f.target.buildDigest,clientBuild:'a'.repeat(64),apiContents:f.sources,clientContents:[],targets:[{kind:'api',bindingDigest:digestProduction(f.original),productRole:'v2',...f.target,targetDigest:digestProduction(f.target)}]};
 const sourceRequest=signProductionEnvelope({hostId:f.binding.hostId,payload:f.request,trust:f.trust}),signed=api.createApiIdentityRequest({sourceRequest,trust:f.trust,target:f.request.installed.targets[0]});
 const bootstrap={root:f.target.root,entryPath:f.target.entryPath,descriptor:{productRole:'v2'},sources:f.sources},connectionIdentity={canonicalPath:f.request.databaseIdentity.canonicalPath,identity:{...f.request.databaseIdentity.identity}},handler=api.createProductionApiIdentityHandler({db:f.db,trust:f.trust,hostId:f.binding.hostId},{readBootstrap:()=>bootstrap,readDatabaseConnectionIdentity:()=>connectionIdentity});
 const response={statusCode:200,headers:{},setHeader(key,value){this.headers[key]=value;},status(value){this.statusCode=value;return this;},json(value){this.value=value;return this;}};
 handler({body:signed,socket:{remoteAddress:'127.0.0.1'}},response);return {signed,response,handler,bootstrap,connectionIdentity};
}
test('private API handler reports actual same DB/fence and per-process nonce, no-store and no writes',t=>{
 const f=setup(t),before=sha(fs.readFileSync(f.request.databaseIdentity.path)),result=apiSetup(f);
 assert.equal(result.response.statusCode,200);assert.equal(result.response.headers['Cache-Control'],'no-store');assert.equal(result.response.value.payload.pid,process.pid);assert.equal(result.response.value.payload.fenceState,'sealed');assert.equal(result.response.value.payload.databaseIdentity.databaseId,f.request.databaseIdentity.databaseId);assert.equal(sha(fs.readFileSync(f.request.databaseIdentity.path)),before);
 const proof=api.verifyApiIdentityProof({envelope:result.response.value,trust:f.trust,request:f.request,target:f.request.installed.targets[0],process:{pid:process.pid}});assert.equal(proof.root,f.target.root);
});
test('private API identity refuses mismatched DB/fence and cannot borrow a later mutated bootstrap',t=>{
 const f=setup(t),result=apiSetup(f);
 result.signed.payload.databaseIdentity.databaseId=crypto.randomUUID();const signed=signProductionEnvelope({hostId:f.binding.hostId,payload:result.signed.payload,trust:f.trust});result.handler({body:signed,socket:{remoteAddress:'127.0.0.1'}},result.response);assert.equal(result.response.statusCode,403);
 result.bootstrap.root=f.original.root;result.handler({body:api.createApiIdentityRequest({sourceRequest:signProductionEnvelope({hostId:f.binding.hostId,payload:f.request,trust:f.trust}),trust:f.trust,target:f.request.installed.targets[0]}),socket:{remoteAddress:'127.0.0.1'}},result.response);assert.equal(result.response.value.payload.root,f.target.root);
 f.db.prepare("UPDATE version_preservation SET state='restored'").run();result.handler({body:api.createApiIdentityRequest({sourceRequest:signProductionEnvelope({hostId:f.binding.hostId,payload:f.request,trust:f.trust}),trust:f.trust,target:f.request.installed.targets[0]}),socket:{remoteAddress:'127.0.0.1'}},result.response);assert.equal(result.response.statusCode,403);
});
test('actual new runtime proof, listening owner and native birth are independently bound to approved target',async t=>{
 const f=setup(t),result=apiSetup(f),proof=result.response.value,live={pid:process.pid,createdAt:null,nativeBirth:{...f.original.originalInstance.nativeBirth,startTicks:'2000'},entryPath:f.target.entryPath};
 const sample={kind:'api',bindingDigest:digestProduction(f.original),targetDigest:digestProduction(f.target),root:f.target.root,entryPath:f.target.entryPath,productRole:'v2',buildDigest:f.target.buildDigest,pid:process.pid,nativeBirth:live.nativeBirth,nonceDigest:proof.payload.nonceDigest,apiIdentity:proof};
 const runtime=signProductionEnvelope({hostId:f.binding.hostId,trust:f.trust,payload:{domain:'ziwei-production-runtime-capture-v1',schemaVersion:1,producer:'ziwei-source-namespace-v1',producerSha256:'b'.repeat(64),command:'restore',challenge:f.request.challenge,issuedAt:f.request.issuedAt,expiresAt:f.request.expiresAt,operationId:f.request.operationId,specHash:f.request.specHash,databaseIdentity:f.request.databaseIdentity,freezeDigest:f.request.freezeDigest,bindingDigest:digestProduction(f.binding),installedDigest:digestProduction(f.request.installed),instances:[sample]}});
 fs.writeFileSync(api.runtimeCaptureFile(f.binding.nativeSourceRefs[2],f.request.challenge),canonicalProduction(runtime));
 f.native.readProcess=async pid=>pid===process.pid?live:null;f.native.readNamespace=async()=>({...f.afterNamespace,ActiveState:'active',members:[process.pid]});
 const input={binding:f.binding,request:f.request,trust:f.trust};const ready=await api.observePreservationSourceNamespace(input,f.native);assert.equal(ready.safe,true);assert.equal(ready.observations.runningV2.instances[0].pid,process.pid);
 f.native.readListener=async()=>({listenerPid:55555});const refused=await api.observePreservationSourceNamespace(input,f.native);assert.equal(refused.safe,false);
});
test('API identity rejects foreign signer, unknown fields, remote callers and changed open connection identity',t=>{
 const f=setup(t),result=apiSetup(f),proof=result.response.value,target=f.request.installed.targets[0];
 const keyRef=path.join(f.root,'other.key');fs.writeFileSync(keyRef,crypto.randomBytes(32),{mode:0o600});f.trust.hosts.push({hostId:'other_host',keyId:'other_key',keyRef,bindingDigest:'a'.repeat(64)});
 const foreign=signProductionEnvelope({hostId:'other_host',trust:f.trust,payload:proof.payload});assert.throws(()=>api.verifyApiIdentityProof({envelope:foreign,trust:f.trust,request:f.request,target,process:{pid:process.pid}}),{code:'SOURCE_RUNTIME_API'});
 const extra=signProductionEnvelope({hostId:f.binding.hostId,trust:f.trust,payload:{...proof.payload,safe:true}});assert.throws(()=>api.verifyApiIdentityProof({envelope:extra,trust:f.trust,request:f.request,target,process:{pid:process.pid}}),{code:'SOURCE_NAMESPACE_FIELDS'});
 result.handler({body:result.signed,socket:{remoteAddress:'192.0.2.1'}},result.response);assert.equal(result.response.statusCode,403);
 result.connectionIdentity.identity.ino='0';result.handler({body:result.signed,socket:{remoteAddress:'127.0.0.1'}},result.response);assert.equal(result.response.statusCode,403);
});
test('runtime ABI rejects nonce disagreement and unattested client health JSON',t=>{
 const f=setup(t),result=apiSetup(f),target=f.request.installed.targets[0],sample={kind:'api',bindingDigest:target.bindingDigest,targetDigest:target.targetDigest,root:target.root,entryPath:target.entryPath,productRole:'v2',buildDigest:target.buildDigest,pid:process.pid,nativeBirth:{bootId:'a'.repeat(64),createdAt:new Date().toISOString()},nonceDigest:'0'.repeat(64),apiIdentity:result.response.value};
 const payload={domain:'ziwei-production-runtime-capture-v1',schemaVersion:1,producer:'ziwei-source-namespace-v1',producerSha256:'b'.repeat(64),command:'restore',challenge:f.request.challenge,issuedAt:f.request.issuedAt,expiresAt:f.request.expiresAt,operationId:f.request.operationId,specHash:f.request.specHash,databaseIdentity:f.request.databaseIdentity,freezeDigest:f.request.freezeDigest,bindingDigest:digestProduction(f.binding),installedDigest:digestProduction(f.request.installed),instances:[sample]};
 const signed=()=>signProductionEnvelope({hostId:f.binding.hostId,trust:f.trust,payload});assert.throws(()=>api.verifyRuntimeCaptureEnvelope({envelope:signed(),trust:f.trust,request:f.request}),{code:'SOURCE_RUNTIME_API'});
 f.request.installed.targets[0].kind='client';sample.kind='client';sample.clientIdentity={pid:process.pid,maintenance:{safe:true}};delete sample.apiIdentity;payload.installedDigest=digestProduction(f.request.installed);assert.throws(()=>api.verifyRuntimeCaptureEnvelope({envelope:signed(),trust:f.trust,request:f.request}),{code:'SOURCE_RUNTIME_CLIENT_IDENTITY_UNSUPPORTED'});
});
test('Windows original daemon scope can use exact finite no-dispatch sources without inventing a persistent Job',async t=>{
 const f=setup(t),createdAt='2026-10-01T00:00:00.000Z';f.original.originalInstance={pid:999999999,createdAt,identityKind:'legacy-os-start',nonceDigest:null,nativeBirth:{bootId:'a'.repeat(64),createdAt}};
 f.binding.clients=[f.original];f.binding.apiInstances=[];f.binding.deviceIds=['device_fixture'];const action={id:'expired_old',workspace_id:'ws_fixture',type:'command',payload_json:JSON.stringify({deviceId:'device_fixture'}),result_json:null,status:'expired',acked_at:createdAt};f.request.actionProjection.tables.a2a_actions.rows=[action];
 const kinds=['legacy-source-code','legacy-action-cache','legacy-action-logger','legacy-action-assessment'],refs=kinds.map((kind,index)=>{const canonicalPath=path.join(f.root,kind+'.txt');fs.writeFileSync(canonicalPath,'isolated fixture source '+index);return {kind,canonicalPath,sha256:sha(fs.readFileSync(canonicalPath)),actionId:action.id,bindingDigest:digestProduction(f.original),originalInstance:{pid:f.original.originalInstance.pid,createdAt}};});f.binding.nativeSourceRefs.push(...refs);
 const namespace={kind:'windows-source'},policy={schemaVersion:1,kind:'source-namespace-policy-v1',instances:[{kind:'client',bindingDigest:digestProduction(f.original),namespace,identityOrigin:'http://127.0.0.1:20242'}]};fs.writeFileSync(f.binding.nativeSourceRefs[0].canonicalPath,canonicalProduction(policy));f.binding.nativeSourceRefs[0].sha256=sha(fs.readFileSync(f.binding.nativeSourceRefs[0].canonicalPath));f.trust.hosts[0].bindingDigest=digestProduction(f.binding);
 const facts={kind:'windows-source-facts-v1',completeConnections:true,completeSameBootLogger:true,completeMaintenance:true,unresolved:[],sourceBindings:refs.map(row=>row.sha256),actions:[{actionId:action.id,actionDigest:nativeActionDigest(action),kind:'never-dispatched',bindingDigest:digestProduction(f.original),originalInstance:{pid:f.original.originalInstance.pid,createdAt},interpreterVerified:true,codeDigest:refs[0].sha256,cachePrefixDigest:refs[1].sha256,sameBootLoggerDigest:refs[2].sha256,assessmentDigest:refs[3].sha256}]};
 const currentNamespace={kind:'windows-source',visibility:'native-memory-and-registry',members:[],unresolved:[]},base={...f.before.payload,bindingDigest:digestProduction(f.binding),policyDigest:digestProduction(policy),workerFacts:facts};
 const before=api.createNamespaceCaptureEnvelope({hostId:f.binding.hostId,trust:f.trust,payload:{...base,phase:'before-stop',previousCaptureDigest:null,instances:[{kind:'client',bindingDigest:digestProduction(f.original),originalInstance:f.original.originalInstance,process:{pid:f.original.originalInstance.pid,createdAt,nativeBirth:f.original.originalInstance.nativeBirth,entryPath:f.original.entryPath},namespace:{...currentNamespace,members:[f.original.originalInstance.pid]}}]}}),after=api.createNamespaceCaptureEnvelope({hostId:f.binding.hostId,trust:f.trust,payload:{...base,phase:'after-stop',previousCaptureDigest:digestProduction(before),instances:[{kind:'client',bindingDigest:digestProduction(f.original),originalInstance:f.original.originalInstance,process:null,namespace:currentNamespace}]}});
 fs.writeFileSync(api.namespaceCaptureFile(f.binding.nativeSourceRefs[1],'before-stop'),canonicalProduction(before));fs.writeFileSync(api.namespaceCaptureFile(f.binding.nativeSourceRefs[1],'after-stop'),canonicalProduction(after));f.native.readNamespace=async()=>currentNamespace;
 const result=await api.observePreservationSourceNamespace({binding:f.binding,request:f.request,trust:f.trust},f.native);assert.equal(result.safe,true);assert.equal(result.proofs[0].kind,'original-namespace-proof-v1');assert.equal(Object.hasOwn(currentNamespace,'jobName'),false);
 const foreignRefs=JSON.parse(canonicalProduction(refs));foreignRefs[1].originalInstance.pid=12345;assert.equal(api.verifyWindowsWorkerFacts(facts,[{id:action.id,digest:nativeActionDigest(action),bindingDigest:digestProduction(f.original)}],foreignRefs).safe,false);
 after.payload.workerFacts.actions[0].cachePrefixDigest=refs[0].sha256;fs.writeFileSync(api.namespaceCaptureFile(f.binding.nativeSourceRefs[1],'after-stop'),canonicalProduction(signProductionEnvelope({hostId:f.binding.hostId,trust:f.trust,payload:after.payload})));assert.equal((await api.observePreservationSourceNamespace({binding:f.binding,request:f.request,trust:f.trust},f.native)).safe,false);
});
test('async source integration retains original capture scope across fresh recheck and refuses a native race',async t=>{
 const f=setup(t);fs.mkdirSync(path.dirname(f.original.entryPath),{recursive:true});fs.writeFileSync(f.original.entryPath,'// immutable stopped original fixture\n');f.original.buildDigest=sha(JSON.stringify([{path:'backend/server.mjs',sha256:sha(fs.readFileSync(f.original.entryPath))}]));
 const policy=JSON.parse(fs.readFileSync(f.binding.nativeSourceRefs[0].canonicalPath));policy.instances[0].bindingDigest=digestProduction(f.original);fs.writeFileSync(f.binding.nativeSourceRefs[0].canonicalPath,canonicalProduction(policy));f.binding.nativeSourceRefs[0].sha256=sha(fs.readFileSync(f.binding.nativeSourceRefs[0].canonicalPath));f.trust.hosts[0].bindingDigest=digestProduction(f.binding);
 for(const envelope of [f.before,f.after]){envelope.payload.bindingDigest=digestProduction(f.binding);envelope.payload.policyDigest=digestProduction(policy);envelope.payload.instances[0].bindingDigest=digestProduction(f.original);}
 f.before=api.createNamespaceCaptureEnvelope({hostId:f.binding.hostId,trust:f.trust,payload:f.before.payload});f.after.payload.previousCaptureDigest=digestProduction(f.before);f.after=api.createNamespaceCaptureEnvelope({hostId:f.binding.hostId,trust:f.trust,payload:f.after.payload});for(const envelope of [f.before,f.after])fs.writeFileSync(api.namespaceCaptureFile(f.binding.nativeSourceRefs[1],envelope.payload.phase),canonicalProduction(envelope));
 const sign=()=>signProductionEnvelope({hostId:f.binding.hostId,trust:f.trust,payload:f.request}),first=await collectVerifiedProductionSourceProof({request:sign(),trust:f.trust},f.native);assert.equal(first.payload.safe,true);
 const previous=[first];f.request.kind='recheck';f.request.priorEvidenceDigest=digestProduction(previous);f.request.challenge=crypto.randomUUID();const fresh=await collectVerifiedProductionSourceProof({request:sign(),trust:f.trust,previous},f.native);assert.equal(fresh.payload.safe,true);assert.equal(fresh.payload.evidenceDigest,first.payload.evidenceDigest);
 f.request.kind='collect';f.request.priorEvidenceDigest=null;f.request.challenge=crypto.randomUUID();let probes=0;f.native.readNamespace=async()=>++probes===1?f.afterNamespace:{...f.afterNamespace,members:[55555],ActiveState:'active'};await assert.rejects(collectVerifiedProductionSourceProof({request:sign(),trust:f.trust},f.native),{code:'SOURCE_NAMESPACE_CHANGED'});
});
