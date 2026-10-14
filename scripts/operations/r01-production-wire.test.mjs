import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {pathToFileURL} from 'node:url';
import {createProductionProofProvider,createSourceCliTransport,createProductionPhaseController,createNamespaceCaptureWriter} from './r01-production-wire.mjs';
// E02 clean cad5886 product bytes, LF-normalized for Git/package line endings.
// This is code ABI qualification; it does not assert native Windows execution.
const modulePath=process.env.R01_PRODUCT_MODULE||path.resolve(import.meta.dirname,'../../backend/production-preservation.mjs');
const codeSha=file=>crypto.createHash('sha256').update(fs.readFileSync(file,'utf8').replaceAll('\r\n','\n')).digest('hex');
assert.equal(codeSha(modulePath),'264c1a5d51ae0b896f363979f274ac405800f8f275e0d8ae94e6d0c93db29c6d');
const namespacePath=path.join(path.dirname(modulePath),'preservation-source-namespace.mjs');
assert.equal(codeSha(namespacePath),'ee332e50a78fd61a765ea2b721093e34311016be17d855ed2c71657611c4a6ac');
const product=await import(pathToFileURL(modulePath));const namespace=await import(pathToFileURL(namespacePath));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'r01-wire-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const keys=['api_fixture','windows_fixture'].map(hostId=>{const keyRef=path.join(root,hostId+'.key');fs.writeFileSync(keyRef,crypto.randomBytes(32),{mode:0o600});return{hostId,keyId:hostId+'_key',keyRef};});
 const bindings=keys.map(row=>({hostId:row.hostId,deviceIds:[],workspaceIds:[],clients:[],apiInstances:[]}));
 const trust={schemaVersion:1,algorithm:'hmac-sha256',hosts:keys.map((row,i)=>({...row,bindingDigest:product.digestProduction(bindings[i])})),approvedSpecs:[{operationId:'wire_fixture',specHash:'a'.repeat(64)}],backupHostId:keys[0].hostId};
 const context={operationId:'wire_fixture',specHash:'a'.repeat(64),databaseIdentity:{databaseId:crypto.randomUUID()},freezeDigest:'b'.repeat(64),requiredHosts:keys.map(row=>row.hostId)};
 const requests=(kind='collect',priorEvidenceDigest=null)=>{const issuedAt=new Date().toISOString(),challenge=crypto.randomUUID();return bindings.map(binding=>product.signProductionEnvelope({hostId:binding.hostId,trust,payload:{domain:'ziwei-production-request-v1',schemaVersion:1,kind,command:'seal',collector:'ziwei-production-source-v1',challenge,issuedAt,expiresAt:new Date(Date.parse(issuedAt)+60000).toISOString(),...Object.fromEntries(Object.entries(context).filter(([key])=>key!=='requiredHosts')),binding,actionProjection:{tables:{a2a_actions:{rows:[]}},numericKeys:{'10':'ten','2':'two'}},gatewayInbox:[],homes:[],priorEvidenceDigest,targetOrigins:['https://fixture.invalid'],installed:null,controlIdentity:{state:'sealed',operationId:context.operationId}}}));};
 const proof=request=>{const p=request.payload,result={domain:p.kind==='collect'?'ziwei-production-collect-proof-v1':'ziwei-production-recheck-proof-v1',schemaVersion:1,kind:p.kind,command:p.command,collector:p.collector,challenge:p.challenge,issuedAt:p.issuedAt,expiresAt:p.expiresAt,operationId:p.operationId,specHash:p.specHash,databaseIdentity:p.databaseIdentity,freezeDigest:p.freezeDigest,bindingDigest:product.digestProduction(p.binding),actionProjectionDigest:product.digestProduction(p.actionProjection),gatewayInboxDigest:product.digestProduction(p.gatewayInbox),homesDigest:product.digestProduction(p.homes),installedDigest:product.digestProduction(p.installed),priorEvidenceDigest:p.priorEvidenceDigest,observations:{},files:[],directories:[],nativeDatabases:[],nativeStateProofs:[],gatewayInboxProofs:[],actionBindings:[],issues:[],safe:true,runtimeProofs:[],evidenceDigest:'c'.repeat(64)};return product.signProductionEnvelope({hostId:request.hostId,trust,payload:result});};
 const transportTrust={schemaVersion:1,hosts:keys.map(row=>({hostId:row.hostId,collectorSha256:'d'.repeat(64)}))};
 return{root,product,namespace,bindings,trust,context,requests,proof,transportTrust};
}
test('actual product-signed requests and entire ordered previous array are forwarded without payload additions',async t=>{
 const f=fixture(t),calls=[],provider=createProductionProofProvider({...f,runTransport:async(host,input)=>{calls.push({host,input});return f.proof(input.request);}});
 const requests=f.requests(),first=await provider.collect({...f.context,requests,priorEvidenceDigest:null});
 assert.deepEqual(calls[0].input.request,requests[0]);assert.deepEqual(first.map(row=>row.hostId),f.context.requiredHosts);
 const priorEvidenceDigest=product.digestProduction(first),secondRequests=f.requests('recheck',priorEvidenceDigest);
 await provider.recheck({...f.context,requests:secondRequests,previous:first,priorEvidenceDigest});
 assert.deepEqual(calls[2].input.previous,first);assert.deepEqual(calls[3].input.previous,first);
 assert.equal('actionProjection' in calls[0].input,false);
});
test('wrong host order, peer key, changed context, and unsigned request refuse before dispatch',async t=>{
 const f=fixture(t);let calls=0;const provider=createProductionProofProvider({...f,runTransport:async()=>{calls++;}});
 const requests=f.requests();await assert.rejects(provider.collect({...f.context,requests:requests.toReversed(),priorEvidenceDigest:null}),/OPS_HOST_REQUEST_INVALID/);
 await assert.rejects(provider.collect({...f.context,specHash:'0'.repeat(64),requests,priorEvidenceDigest:null}),/OPS_REQUEST_BINDING_INVALID/);
 const changed=structuredClone(requests);changed[0].keyId='peer_key';await assert.rejects(provider.collect({...f.context,requests:changed,priorEvidenceDigest:null}));assert.equal(calls,0);
});
test('partial, reordered or altered previous cannot replace the product aggregate digest',async t=>{
 const f=fixture(t),provider=createProductionProofProvider({...f,runTransport:async(_host,input)=>f.proof(input.request)}),first=await provider.collect({...f.context,requests:f.requests(),priorEvidenceDigest:null}),priorEvidenceDigest=product.digestProduction(first);
 for(const previous of [first.slice(0,1),first.toReversed(),[{...first[0],signature:'0'.repeat(64)},first[1]]])await assert.rejects(provider.recheck({...f.context,requests:f.requests('recheck',priorEvidenceDigest),previous,priorEvidenceDigest}),/OPS_PREVIOUS_INVALID/);
});
test('timeout consumes accepted challenge, and payload-return verifier is used without boolean coercion',async t=>{
 const f=fixture(t);let calls=0;const provider=createProductionProofProvider({...f,runTransport:async()=>{calls++;throw Error('fixture timeout');}}),input={...f.context,requests:f.requests(),priorEvidenceDigest:null};
 await assert.rejects(provider.collect(input),/fixture timeout/);await assert.rejects(provider.collect(input),/OPS_CHALLENGE_REUSED/);assert.equal(calls,1);
});
test('numeric keys use actual product encoder; getter input does not execute',async t=>{
 const f=fixture(t);assert.notEqual(product.canonicalProduction({'10':'ten','2':'two'}),JSON.stringify({'10':'ten','2':'two'}));let getter=0;
 const provider=createProductionProofProvider({...f,runTransport:async(_host,input)=>f.proof(input.request)}),input={...f.context,requests:f.requests(),priorEvidenceDigest:null};Object.defineProperty(input,'hidden',{enumerable:true,get(){getter++;return true;}});
 await assert.rejects(provider.collect(input));assert.equal(getter,0);
});
test('fixed file CLI writes exact signed request and full previous; changed code pin refuses',async t=>{
 const f=fixture(t),entry=path.join(f.root,'fixture-source.mjs'),trustFile=path.join(f.root,'source-trust.json');
 const outputEnvelope=f.proof(f.requests()[0]);const response=path.join(f.root,'prepared-envelope.json');fs.writeFileSync(response,product.canonicalProduction(outputEnvelope));
 fs.writeFileSync(trustFile,JSON.stringify({fixture:true}));
 fs.writeFileSync(entry,`import fs from 'node:fs';const args=process.argv.slice(2),options={};for(let i=1;i<args.length;i+=2)options[args[i]]=args[i+1];const request=JSON.parse(fs.readFileSync(options['--request']));const previous=options['--previous']?JSON.parse(fs.readFileSync(options['--previous'])):null;fs.writeFileSync(options['--output'],fs.readFileSync(${JSON.stringify(response)}),{flag:'wx'});console.log(JSON.stringify({complete:true,path:options['--output'],hostId:request.hostId,operationId:request.payload.operationId,evidenceDigest:'c'.repeat(64)}));`);
 const host={hostId:'api_fixture',transport:{kind:'source-cli-files',entry,cwd:f.root,executable:process.execPath,trustFile,trustSha256:sha(fs.readFileSync(trustFile)),codePins:[{path:entry,sha256:sha(fs.readFileSync(entry))}],executableSha256:sha(fs.readFileSync(process.execPath))}};
 const transport=createSourceCliTransport({privateRoot:f.root,product}),request=f.requests()[0],previous=[outputEnvelope,{...outputEnvelope,hostId:'windows_fixture'}];
 assert.deepEqual(await transport(host,{stage:'recheck',request,previous}),outputEnvelope);
 const attempt=fs.readdirSync(f.root).find(name=>name.startsWith('source-attempt-'));assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root,attempt,'previous.json'))),previous);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root,attempt,'request.json'))),request);
 fs.appendFileSync(entry,'\n// changed');await assert.rejects(transport(host,{stage:'collect',request,previous:null}),/OPS_COLLECTOR_CHANGED/);
});
test('phase accepts absent plan and recovers only exact pending command persisted receipt',async t=>{
 const f=fixture(t),spec={schemaVersion:1,mode:'production',operationId:f.context.operationId};spec.specHash=product.digestProduction(spec);
 let state='absent',saved=null,lost=true;const calls=[];
 const adapter={...product,validateProductionSpec:()=>({spec}),async runProductionPreservation(input){calls.push({command:input.command,apply:input.apply});if(!input.apply)return{mode:'plan',willApply:false,command:input.command,operationId:spec.operationId,specHash:spec.specHash,databaseId:f.context.databaseIdentity.databaseId,role:'v2',state,receipt:saved?.command===input.command?saved:null};state='preparing';saved={mode:'applied',command:'prepare',operationId:spec.operationId,specHash:spec.specHash,databaseId:f.context.databaseIdentity.databaseId,role:'v2',state,freezeDigest:'b'.repeat(64),evidenceDigest:'c'.repeat(64)};if(lost){lost=false;throw Error('lost response');}return saved;}};
 const controller=createProductionPhaseController({privateRoot:f.root,journalDirectory:path.join(f.root,'journal'),product:adapter,proofProvider:{collect(){},recheck(){}},verifyReleaseGate:async()=>true});
 const plan=await controller.run({command:'inspect',spec,trust:f.trust});assert.equal(plan.result.state,'absent');
 await assert.rejects(controller.run({command:'prepare',apply:true,spec,trust:f.trust}),/OPS_PRODUCT_OUTCOME_UNKNOWN/);
 await controller.run({command:'inspect',spec,trust:f.trust});assert.deepEqual(calls.at(-1),{command:'prepare',apply:false});assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'journal/ledger.json'))).pending,null);assert.equal(calls.filter(row=>row.apply).length,1);
});
test('phase state alone never clears missing stored receipt; default release gate denies apply',async t=>{
 const f=fixture(t),spec={schemaVersion:1,mode:'production',operationId:f.context.operationId};spec.specHash=product.digestProduction(spec);let state='absent';const adapter={...product,validateProductionSpec:()=>({spec}),async runProductionPreservation(input){if(input.apply){state='preparing';throw Error('lost');}return{mode:'plan',willApply:false,command:input.command,operationId:spec.operationId,specHash:spec.specHash,role:'v2',state,receipt:null};}};
 const controller=createProductionPhaseController({privateRoot:f.root,journalDirectory:path.join(f.root,'journal'),product:adapter,proofProvider:{collect(){},recheck(){}},verifyReleaseGate:async()=>true});
 await assert.rejects(controller.run({command:'prepare',apply:true,spec,trust:f.trust}));await controller.run({command:'inspect',spec,trust:f.trust});assert.notEqual(JSON.parse(fs.readFileSync(path.join(f.root,'journal/ledger.json'))).pending,null);
 const closed=createProductionPhaseController({privateRoot:f.root,journalDirectory:path.join(f.root,'other'),product:adapter});await assert.rejects(closed.run({command:'prepare',apply:true,spec,trust:f.trust}),/OPS_RELEASE_GATE_NOT_ACCEPTED/);
});
test('product namespace capture uses fixed files, host/original digests and complete before envelope chain',async t=>{
 const f=fixture(t),directory=path.join(f.root,'captures');fs.mkdirSync(directory);const producer=path.join(f.root,'producer.mjs');fs.writeFileSync(producer,'// fixture producer');const producerSha256=sha(fs.readFileSync(producer));
 const nativeBirth={bootId:crypto.randomUUID(),startTicks:'1000'},InvocationID='1234567890abcdef1234567890abcdef',original={entryPath:path.join(f.root,'original.mjs'),originalInstance:{pid:7,createdAt:null,nativeBirth,identityKind:'systemd-invocation',nonceDigest:sha(InvocationID)}};f.bindings[0].apiInstances=[original];
 const policy={schemaVersion:1,kind:'source-namespace-policy-v1',instances:[{kind:'api',bindingDigest:product.digestProduction(original),namespace:{kind:'systemd-cgroup',unit:'fixture.service',controlGroup:'/fixture.service'},identityOrigin:'http://127.0.0.1:41999'}]},policyPath=path.join(f.root,'policy.json');fs.writeFileSync(policyPath,product.canonicalProduction(policy));
 f.bindings[0].nativeSourceRefs=[{kind:'namespace-policy-v1',canonicalPath:policyPath,sha256:sha(fs.readFileSync(policyPath))},{kind:'namespace-capture-directory-v1',canonicalPath:directory,producerSha256}];f.trust.hosts[0].bindingDigest=product.digestProduction(f.bindings[0]);
 const request=f.requests()[0],writer=createNamespaceCaptureWriter({product,namespace,trust:f.trust,binding:f.bindings[0],producerPath:producer,producerSha256,observeNative:async({phase})=>({instances:[{kind:'api',bindingDigest:product.digestProduction(original),originalInstance:original.originalInstance,process:phase==='before-stop'?{pid:7,createdAt:null,nativeBirth,entryPath:original.entryPath}:null,namespace:{kind:'systemd-cgroup',unit:'fixture.service',controlGroup:'/fixture.service',InvocationID,KillMode:'control-group',Delegate:false,SendSIGKILL:true,ActiveState:phase==='before-stop'?'active':'inactive',members:phase==='before-stop'?[7]:[],bootId:nativeBirth.bootId,NRestarts:0,ExecMainStartTimestampMonotonic:'1000',ActiveEnterTimestampMonotonic:'1001'}}],workerFacts:null})});
 const before=await writer.capture({phase:'before-stop',request}),after=await writer.capture({phase:'after-stop',request});
 assert.equal(before.path,path.join(directory,'before-stop.json'));assert.equal(after.path,path.join(directory,'after-stop.json'));assert.equal(after.envelope.payload.previousCaptureDigest,product.digestProduction(before.envelope));assert.equal(before.envelope.payload.bindingDigest,product.digestProduction(f.bindings[0]));assert.equal(before.envelope.payload.instances[0].bindingDigest,product.digestProduction(original));assert.equal('safe' in before.envelope.payload,false);
 await assert.rejects(writer.capture({phase:'before-stop',request}),/OPS_CAPTURE_EXISTS/);
});
test('draft or unknown native observation cannot be signed as product capture',async t=>{
 const f=fixture(t),producer=path.join(f.root,'producer.mjs');fs.writeFileSync(producer,'// fixture');
 const writer=createNamespaceCaptureWriter({product,namespace,trust:f.trust,binding:f.bindings[0],producerPath:producer,producerSha256:sha(fs.readFileSync(producer)),observeNative:async()=>({kind:'r01-linux-source-observation',namespaceComplete:null})});
 await assert.rejects(writer.capture({phase:'before-stop',request:f.requests()[0]}));
});
test('default boot-nonce capture without nativeBirth binds actual createdAt and nonce',async t=>{
 const f=fixture(t),directory=path.join(f.root,'captures');fs.mkdirSync(directory);const producer=path.join(f.root,'producer.mjs');fs.writeFileSync(producer,'// fixture producer');const producerSha256=sha(fs.readFileSync(producer));
 const createdAt='2026-10-10T10:40:39.884Z',nonceDigest='e'.repeat(64),original={entryPath:path.join(f.root,'original.mjs'),originalInstance:{pid:7,createdAt,nonceDigest}};f.bindings[0].apiInstances=[original];
 const policy={schemaVersion:1,kind:'source-namespace-policy-v1',instances:[{kind:'api',bindingDigest:product.digestProduction(original),namespace:{kind:'systemd-cgroup',unit:'fixture.service',controlGroup:'/fixture.service'},identityOrigin:'http://127.0.0.1:41999'}]},policyPath=path.join(f.root,'policy.json');fs.writeFileSync(policyPath,product.canonicalProduction(policy));
 f.bindings[0].nativeSourceRefs=[{kind:'namespace-policy-v1',canonicalPath:policyPath,sha256:sha(fs.readFileSync(policyPath))},{kind:'namespace-capture-directory-v1',canonicalPath:directory,producerSha256}];f.trust.hosts[0].bindingDigest=product.digestProduction(f.bindings[0]);
 let observedCreatedAt=createdAt,observedNonce='f'.repeat(64);
 const writer=createNamespaceCaptureWriter({product,namespace,trust:f.trust,binding:f.bindings[0],producerPath:producer,producerSha256,observeNative:async()=>({instances:[{kind:'api',bindingDigest:product.digestProduction(original),originalInstance:original.originalInstance,nonceDigest:observedNonce,process:{pid:7,createdAt:observedCreatedAt,entryPath:original.entryPath},namespace:{kind:'systemd-cgroup',unit:'fixture.service',controlGroup:'/fixture.service',InvocationID:'1234567890abcdef1234567890abcdef',KillMode:'control-group',Delegate:false,SendSIGKILL:true,ActiveState:'active',members:[7],bootId:crypto.randomUUID(),NRestarts:0,ExecMainStartTimestampMonotonic:'1000',ActiveEnterTimestampMonotonic:'1001'}}],workerFacts:null})});
 const request=f.requests()[0];await assert.rejects(writer.capture({phase:'before-stop',request}),/OPS_NATIVE_CAPTURE_INCOMPLETE/);observedNonce=nonceDigest;observedCreatedAt='2026-10-10T10:40:39.885Z';await assert.rejects(writer.capture({phase:'before-stop',request}),/OPS_NATIVE_CAPTURE_INCOMPLETE/);
 observedCreatedAt=createdAt;const before=await writer.capture({phase:'before-stop',request});assert.equal(before.envelope.payload.instances[0].nonceDigest,nonceDigest);assert.equal('nativeBirth' in before.envelope.payload.instances[0].process,false);
});

test('trusted legacy policy reaches product second code argument without entering signed JSON',async t=>{
 const f=fixture(t),spec={schemaVersion:1,mode:'production',operationId:f.context.operationId};spec.specHash=product.digestProduction(spec);
 const policy=Object.freeze({actionId:'approved_legacy_fixture'});let received=null,request=null;
 const adapter={...product,validateProductionSpec:()=>({spec}),async runProductionPreservation(input,options){request=input;received=options;return{mode:'plan',willApply:false,command:input.command,operationId:spec.operationId,specHash:spec.specHash,role:'v2',state:'absent',receipt:null};}};
 const controller=createProductionPhaseController({privateRoot:f.root,journalDirectory:path.join(f.root,'journal'),product:adapter,legacyActionPolicy:policy});
 await controller.run({command:'inspect',spec,trust:f.trust});assert.equal(received.legacyActionPolicy,policy);assert.equal('legacyActionPolicy' in request,false);assert.equal('legacyActionPolicy' in request.spec,false);
});
