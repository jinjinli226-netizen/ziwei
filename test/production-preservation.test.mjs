import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {canonicalProduction,digestProduction,signProductionEnvelope,validateProductionSpec,runProductionPreservation,readProductionProjection,productionEvidenceDigest,validateProductionFreshness} from '../backend/production-preservation.mjs';
import {createPreservation,FROZEN_VERSIONS} from '../backend/version-preservation.mjs';
import {readDatabaseSnapshot} from '../backend/preservation-native-databases.mjs';
import {nativeActionDigest} from '../backend/preservation-native-databases.mjs';
import {clientBuildIdentity} from '../src/management-bootstrap.mjs';
import {collectProductionSourceProof,runProductionSourceCli} from '../scripts/production-source-proof.mjs';
import {createProductionApiIdentityHandler,createApiIdentityRequest} from '../backend/preservation-source-namespace.mjs';

const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const nonce='c'.repeat(64);
import {productionFixture as fixture} from '../test-support/preservation-production-fixture.mjs';

const options=f=>({spec:f.spec,trust:f.trust,packageRoot:f.packageRoot,proofProvider:f.provider});
const sourceBytes=f=>sha(fs.readFileSync(f.spec.database.path));
const reapprove=f=>{delete f.spec.specHash;f.spec.specHash=digestProduction(f.spec);f.trust.approvedSpecs=[{operationId:f.spec.operationId,specHash:f.spec.specHash}];for(const host of f.spec.hosts)f.trust.hosts.find(row=>row.hostId===host.hostId).bindingDigest=digestProduction(host);};
function privateApiRuntimeProvider(f,t){
 const host=f.spec.hosts[0],directory=path.join(f.root,'private-runtime');fs.mkdirSync(directory);host.nativeSourceRefs=[{kind:'runtime-identity-directory-v1',canonicalPath:directory,producerSha256:'b'.repeat(64)}];reapprove(f);let handler,db;
 const collect=(input,previous=null)=>input.requests.map(request=>{
  if(request.payload.command!=='restore')return collectProductionSourceProof({request,trust:f.trust,previous,observe:f.observe});
  const payload=request.payload,target=payload.installed.targets[0];if(!handler){db=new DatabaseSync(f.spec.database.path);f.nativeRuntimeConnections.push(db);handler=createProductionApiIdentityHandler({db,trust:f.trust,hostId:host.hostId},{readBootstrap:()=>({root:target.root,entryPath:target.entryPath,descriptor:{productRole:'v2'},sources:payload.installed.apiContents}),readDatabaseConnectionIdentity:()=>{const stat=fs.lstatSync(f.spec.database.path,{bigint:true});return {canonicalPath:f.spec.database.canonicalPath,identity:{dev:String(stat.dev),ino:String(stat.ino)}};}});}
  const response={statusCode:200,setHeader(){},status(code){this.statusCode=code;return this;},json(value){this.value=value;return this;}};handler({body:createApiIdentityRequest({sourceRequest:request,trust:f.trust,target}),socket:{remoteAddress:'127.0.0.1'}},response);assert.equal(response.statusCode,200);const identity=response.value,proof=identity.payload,nativeBirth={bootId:'a'.repeat(64),createdAt:proof.startedAt},sample={kind:'api',bindingDigest:target.bindingDigest,targetDigest:target.targetDigest,root:target.root,entryPath:target.entryPath,productRole:'v2',buildDigest:target.buildDigest,pid:process.pid,nativeBirth,nonceDigest:proof.nonceDigest,apiIdentity:identity},running={...sample,running:true,createdAt:proof.startedAt};delete running.apiIdentity;
  const observe=binding=>({...f.observe(binding),runningV2:{fenceState:proof.fenceState,productRole:'v2',buildDigest:proof.buildDigest,databaseId:proof.databaseIdentity.databaseId,instances:[running]}}),envelope=collectProductionSourceProof({request,trust:f.trust,previous,observe});envelope.payload.runtimeProofs=[signProductionEnvelope({hostId:host.hostId,trust:f.trust,payload:{domain:'ziwei-production-runtime-capture-v1',schemaVersion:1,producer:'ziwei-source-namespace-v1',producerSha256:'b'.repeat(64),command:'restore',challenge:payload.challenge,issuedAt:payload.issuedAt,expiresAt:payload.expiresAt,operationId:payload.operationId,specHash:payload.specHash,databaseIdentity:payload.databaseIdentity,freezeDigest:payload.freezeDigest,bindingDigest:digestProduction(host),installedDigest:digestProduction(payload.installed),instances:[sample]}})];envelope.payload.evidenceDigest=productionEvidenceDigest(envelope.payload);return signProductionEnvelope({hostId:host.hostId,trust:f.trust,payload:envelope.payload});
 });f.provider.collect=input=>collect(input);f.provider.recheck=input=>collect(input,input.previous);
}
test('schema-aware old V1 inspection is absent and does not initialize or touch bytes',async t=>{
 const f=fixture(t),before=sourceBytes(f);const plan=await runProductionPreservation({...options(f),command:'inspect'});
 assert.equal(plan.state,'absent');assert.equal(plan.willApply,false);assert.equal(sourceBytes(f),before);assert.deepEqual(f.calls,[]);
 assert.equal(readDatabaseSnapshot(f.spec.database.path,db=>db.prepare("SELECT 1 FROM sqlite_master WHERE name='version_preservation'").get()),undefined);
});
test('invalid spec/trust/package/DB reject before source callbacks and first write',async t=>{
 const cases=[
  f=>{f.trust.approvedSpecs=[];},
  f=>{f.spec.qa.evidenceSha256='d'.repeat(64);},
  f=>{f.trust.hosts[0].bindingDigest='d'.repeat(64);},
  f=>{fs.appendFileSync(path.join(f.packageRoot,'backend/version-preservation.mjs'),'// changed');},
  f=>{f.spec.database.identity.ino='0';delete f.spec.specHash;f.spec.specHash=digestProduction(f.spec);f.trust.approvedSpecs[0].specHash=f.spec.specHash;}
 ];
 for(const change of cases){const f=fixture(t),before=sourceBytes(f);change(f);await assert.rejects(runProductionPreservation({...options(f),command:'prepare',apply:true}));assert.equal(sourceBytes(f),before);assert.deepEqual(f.calls,[]);}
});
test('signed wrong domain/unknown host/unsafe stopped proof reject before first write',async t=>{
 for(const mutation of [p=>{p.domain='ziwei-production-backup-proof-v1';},p=>{p.observations.originalStopped=false;p.evidenceDigest=productionEvidenceDigest(p);},p=>{p.challenge=crypto.randomUUID();}]){
  const f=fixture(t),before=sourceBytes(f),collect=f.provider.collect;
  f.provider.collect=input=>collect(input).map(envelope=>{mutation(envelope.payload);return signProductionEnvelope({hostId:envelope.hostId,payload:envelope.payload,trust:f.trust});});
  await assert.rejects(runProductionPreservation({...options(f),command:'prepare',apply:true}));assert.equal(sourceBytes(f),before);
 }
});
test('stopped original V1 bootstraps current DB and same-op lost receipt does not collect again',async t=>{
 const f=fixture(t);assert.equal(fs.existsSync(path.join(f.root,'preservation-rehearsal.json')),false);
 const prepared=await runProductionPreservation({...options(f),command:'prepare',apply:true});assert.equal(prepared.state,'preparing');
 const first=JSON.stringify(prepared),count=f.calls.length;
 const retried=await runProductionPreservation({...options(f),command:'prepare',apply:true});assert.equal(JSON.stringify(retried),first);assert.equal(f.calls.length,count);
 const sealed=await runProductionPreservation({...options(f),command:'seal',apply:true});assert.equal(sealed.state,'sealed');assert.equal(f.calls.includes('backup'),true);
 const afterSeal=await runProductionPreservation({...options(f),command:'prepare',apply:true});assert.equal(afterSeal.state,'preparing');assert.equal(JSON.stringify(afterSeal),first);
});
test('backup refusal leaves preparing, no seal receipt, preserves current business data',async t=>{
 const f=fixture(t);await runProductionPreservation({...options(f),command:'prepare',apply:true});
 f.provider.backup=()=>null;await assert.rejects(runProductionPreservation({...options(f),command:'seal',apply:true}),{code:'PRODUCTION_BACKUP_REQUIRED'});
 const inspected=await runProductionPreservation({...options(f),command:'inspect'});assert.equal(inspected.state,'preparing');
 assert.equal(readDatabaseSnapshot(f.spec.database.path,db=>db.prepare("SELECT count(*) n FROM production_preservation_receipts WHERE command='seal'").get().n),0);
});
test('recheck verifies original file set and full raw action/projection content',async t=>{
 const f=fixture(t),before=sourceBytes(f),recheck=f.provider.recheck;
 f.provider.recheck=input=>{fs.appendFileSync(f.entryPath,'// changed');return recheck(input);};
 await assert.rejects(runProductionPreservation({...options(f),command:'prepare',apply:true}),{code:'SOURCE_FILE_CHANGED'});assert.equal(sourceBytes(f),before);
});
test('DB business race after collection refuses without phase/schema writes',async t=>{
 const f=fixture(t),recheck=f.provider.recheck;
 f.provider.recheck=input=>{const response=recheck(input);const db=new DatabaseSync(f.spec.database.path);db.exec("INSERT INTO management_requests VALUES('ws_fixture','fixture','key','fingerprint','resource')");db.close();return response;};
 await assert.rejects(runProductionPreservation({...options(f),command:'prepare',apply:true}),{code:'PRODUCTION_PROJECTION_CHANGED'});
 assert.equal(readDatabaseSnapshot(f.spec.database.path,db=>db.prepare("SELECT 1 FROM sqlite_master WHERE name='version_preservation'").get()),undefined);
});
test('same operation with independently approved different spec cannot replace receipt',async t=>{
 const f=fixture(t);await runProductionPreservation({...options(f),command:'prepare',apply:true});
 f.spec.qa.commit='d'.repeat(40);delete f.spec.specHash;f.spec.specHash=digestProduction(f.spec);f.trust.approvedSpecs.push({operationId:f.spec.operationId,specHash:f.spec.specHash});
 await assert.rejects(runProductionPreservation({...options(f),command:'prepare',apply:true}),{code:'PRODUCTION_OPERATION_CONFLICT'});
});
test('restore requires running matching V2 evidence and keeps sealed on stopped-old proof',async t=>{
 const f=fixture(t);await runProductionPreservation({...options(f),command:'prepare',apply:true});await runProductionPreservation({...options(f),command:'seal',apply:true});
 fs.cpSync(f.packageRoot,f.spec.hosts[0].apiInstances[0].installTargets.v2.root,{recursive:true});
 await assert.rejects(runProductionPreservation({...options(f),command:'restore',apply:true}),{code:'PRODUCTION_RESTORE_RUNNING_V2_REQUIRED'});
 assert.equal((await runProductionPreservation({...options(f),command:'inspect'})).state,'sealed');
});
test('persisted original receipts cannot be replaced by untrusted raw SQL writers',async t=>{
 const f=fixture(t);const original=await runProductionPreservation({...options(f),command:'prepare',apply:true}),db=new DatabaseSync(f.spec.database.path);
 try{assert.throws(()=>db.exec("UPDATE production_preservation_receipts SET receipt_json='{}'"));assert.throws(()=>db.exec("DELETE FROM production_preservation_identity"));}finally{db.close();}
 assert.deepEqual(await runProductionPreservation({...options(f),command:'prepare',apply:true}),original);
});
test('freshness enforces exact TTL, UTC ISO, one fresh challenge and bounded skew',()=>{
 const now=Date.now(),payload={challenge:crypto.randomUUID(),issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+60000).toISOString()};
 assert.doesNotThrow(()=>validateProductionFreshness(payload,now-5000));assert.doesNotThrow(()=>validateProductionFreshness(payload,now+65000));
 for(const value of [{...payload,expiresAt:new Date(now+60001).toISOString()},{...payload,issuedAt:'2026-10-14'},{...payload,challenge:'fixed'}])assert.throws(()=>validateProductionFreshness(value,now),{code:'PRODUCTION_PROOF_EXPIRED'});
 assert.throws(()=>validateProductionFreshness(payload,now-5001),{code:'PRODUCTION_PROOF_EXPIRED'});assert.throws(()=>validateProductionFreshness(payload,now+65001),{code:'PRODUCTION_PROOF_EXPIRED'});
});
test('raw result/dedupe debt and optional old tables participate in semantic projection',t=>{
 const f=fixture(t),before=readDatabaseSnapshot(f.spec.database.path,readProductionProjection),db=new DatabaseSync(f.spec.database.path);
 db.exec("INSERT INTO a2a_actions VALUES('old','ws_fixture','command','{}','','expired','2026-10-01'); CREATE TABLE original_extra(id TEXT PRIMARY KEY,payload TEXT); INSERT INTO original_extra VALUES('retained','raw')");db.close();
 const after=readDatabaseSnapshot(f.spec.database.path,readProductionProjection);assert.notEqual(digestProduction(before),digestProduction(after));assert.equal(after.tables.a2a_actions.rows[0].result_json,'');assert.equal(after.tables.original_extra.rows.length,1);assert.equal(before.tables.hermes_bots.present,false);
});
test('API-only old ACK/pending debt cannot use empty journal/HOME coverage to bootstrap',async t=>{
 for(const status of ['pending','acked','expired']){
  const f=fixture(t),db=new DatabaseSync(f.spec.database.path);db.prepare("INSERT INTO a2a_actions VALUES('old_job','ws_fixture','command','{}','',?,?)").run(status,status==='pending'?null:'2026-10-01');db.close();const before=sourceBytes(f);
  await assert.rejects(runProductionPreservation({...options(f),command:'prepare',apply:true}),error=>['PRODUCTION_SOURCE_UNSAFE','PRODUCTION_ACTION_SCOPE_UNKNOWN'].includes(error.code));assert.equal(sourceBytes(f),before);
 }
});
test('signed backup for another main path refuses even with integrity and matching digests',async t=>{
 const f=fixture(t);await runProductionPreservation({...options(f),command:'prepare',apply:true});const backup=f.provider.backup;
 f.provider.backup=input=>{const envelope=backup(input);envelope.payload.mainDatabase.path=path.join(f.root,'wrong.sqlite');return signProductionEnvelope({hostId:envelope.hostId,payload:envelope.payload,trust:f.trust});};
 await assert.rejects(runProductionPreservation({...options(f),command:'seal',apply:true}),{code:'PRODUCTION_BACKUP_INVALID'});assert.equal((await runProductionPreservation({...options(f),command:'inspect'})).state,'preparing');
});
test('default native observation refuses an absent original PID without complete worker namespace proof',async t=>{
 const f=fixture(t),before=sourceBytes(f);f.provider.collect=input=>input.requests.map(request=>collectProductionSourceProof({request,trust:f.trust}));
 await assert.rejects(runProductionPreservation({...options(f),command:'prepare',apply:true}),{code:'PRODUCTION_SOURCE_UNSAFE'});assert.equal(sourceBytes(f),before);
});
test('matching installed V2 fixture restores same current DB with compat increments and tombstones intact',async t=>{
 const f=fixture(t);privateApiRuntimeProvider(f,t);await runProductionPreservation({...options(f),command:'prepare',apply:true});await runProductionPreservation({...options(f),command:'seal',apply:true});
 const db=new DatabaseSync(f.spec.database.path);createPreservation(db,{role:'v1-compat'});db.exec("INSERT INTO employees VALUES('ordinary','ws_fixture','codex','active'); INSERT INTO tasks VALUES('v1_increment','ordinary'); CREATE TABLE ordinary_tombstones(id TEXT PRIMARY KEY); INSERT INTO ordinary_tombstones VALUES('deleted_during_compat')");db.close();
 const apiRoot=f.spec.hosts[0].apiInstances[0].installTargets.v2.root;fs.cpSync(f.packageRoot,apiRoot,{recursive:true});
 const restored=await runProductionPreservation({...options(f),command:'restore',apply:true});assert.equal(restored.state,'restored');
 assert.deepEqual(readDatabaseSnapshot(f.spec.database.path,db=>({task:db.prepare("SELECT id FROM tasks WHERE id='v1_increment'").get().id,tombstone:db.prepare("SELECT id FROM ordinary_tombstones").get().id})),{task:'v1_increment',tombstone:'deleted_during_compat'});
 assert.equal(restored.databaseId,f.spec.database.databaseId);
});
test('source CLI rejects output reuse and bad HMAC before inspecting native processes',async t=>{
 const f=fixture(t),requestFile=path.join(f.root,'request.json'),trustFile=path.join(f.root,'trust.json'),output=path.join(f.root,'source-proof.json');
 fs.writeFileSync(trustFile,JSON.stringify(f.trust));fs.writeFileSync(output,'retained-original-envelope');
 await assert.rejects(runProductionSourceCli(['collect','--request',requestFile,'--trust',trustFile,'--output',output]),{code:'SOURCE_OUTPUT_EXISTS'});
 assert.equal(fs.readFileSync(output,'utf8'),'retained-original-envelope');
 fs.unlinkSync(output);
 f.provider.collect=async input=>{const request=input.requests[0];request.signature='0'.repeat(64);fs.writeFileSync(requestFile,JSON.stringify(request));await assert.rejects(runProductionSourceCli(['collect','--request',requestFile,'--trust',trustFile,'--output',output]),{code:'PRODUCTION_SIGNATURE_INVALID'});assert.equal(fs.existsSync(output),false);throw Object.assign(new Error('fixture finished'),{code:'FIXTURE_END'});};
 await assert.rejects(runProductionPreservation({...options(f),command:'prepare',apply:true}),{code:'FIXTURE_END'});
});
test('late backup cannot make an expired source proof reach any schema or phase write',async t=>{
 const f=fixture(t);await runProductionPreservation({...options(f),command:'prepare',apply:true});const before=sourceBytes(f),backup=f.provider.backup;
 f.provider.backup=input=>{
  const envelope=backup(input),future=Date.now()+70000;
  envelope.payload.issuedAt=new Date(future).toISOString();envelope.payload.expiresAt=new Date(future+60000).toISOString();
  t.mock.method(Date,'now',()=>future);
  return signProductionEnvelope({hostId:envelope.hostId,payload:envelope.payload,trust:f.trust});
 };
 await assert.rejects(runProductionPreservation({...options(f),command:'seal',apply:true}),{code:'PRODUCTION_PROOF_EXPIRED'});
 assert.equal(sourceBytes(f),before);
});
test('an approved staged root cannot lend identity to a different loaded security dependency',async t=>{
 const f=fixture(t),relative='backend/version-preservation.mjs',file=path.join(f.packageRoot,relative);fs.appendFileSync(file,'\n// different approved staged implementation\n');
 const manifestFile=path.join(f.spec.packages.directory,'v2-manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestFile));manifest.contents.find(row=>row.path===relative).sha256=sha(fs.readFileSync(file));manifest.buildDigest=sha(JSON.stringify(manifest.contents));fs.writeFileSync(manifestFile,JSON.stringify(manifest));
 f.spec.packages.manifests.find(row=>row.productRole==='v2').sha256=sha(fs.readFileSync(manifestFile));delete f.spec.specHash;f.spec.specHash=digestProduction(f.spec);f.trust.approvedSpecs[0].specHash=f.spec.specHash;
 const before=sourceBytes(f);await assert.rejects(runProductionPreservation({...options(f),command:'prepare',apply:true}),{code:'PRODUCTION_LOADED_CLOSURE_CHANGED'});assert.equal(sourceBytes(f),before);assert.deepEqual(f.calls,[]);
});
test('unknown/uncertain old action and queued delivery debt refuse before first schema write',async t=>{
 const mutations=[
  db=>db.exec("INSERT INTO a2a_actions VALUES('old_unknown','ws_fixture','command','{}',NULL,'uncertain',NULL)"),
  db=>db.exec("INSERT INTO a2a_actions VALUES('old_unknown','ws_fixture','command','{}','{\"code\":\"EXECUTION_UNCERTAIN\"}','succeeded',NULL)"),
  db=>db.exec("CREATE TABLE automation_runs(id TEXT,status TEXT,result_json TEXT); INSERT INTO automation_runs VALUES('old_run','running',NULL)"),
  db=>db.exec("CREATE TABLE webhook_deliveries(id TEXT,status TEXT); INSERT INTO webhook_deliveries VALUES('old_delivery','sending')")
 ];
 for(const mutate of mutations){const f=fixture(t),db=new DatabaseSync(f.spec.database.path);mutate(db);db.close();const before=sourceBytes(f);await assert.rejects(runProductionPreservation({...options(f),command:'prepare',apply:true}),{code:'PRODUCTION_SOURCE_UNSAFE'});assert.equal(sourceBytes(f),before);}
});
test('a signed running-V2 exemption cannot authorize offline prepare',async t=>{
 const f=fixture(t),before=sourceBytes(f),observe=binding=>({...f.observe(binding),runningV2:{instances:[]}});
 f.provider.collect=input=>input.requests.map(request=>collectProductionSourceProof({request,trust:f.trust,observe}));
 await assert.rejects(runProductionPreservation({...options(f),command:'prepare',apply:true}),{code:'PRODUCTION_SOURCE_NOT_STOPPED'});assert.equal(sourceBytes(f),before);
});
test('restore uses approved new physical API release while old release stays unchanged',async t=>{
 const f=fixture(t),original=f.spec.hosts[0].apiInstances[0],oldBytes=sha(fs.readFileSync(original.entryPath));
 original.installTargets=Object.fromEntries(['v1-compat','v2'].map(role=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(f.spec.packages.directory,role+'-manifest.json'))),root=path.join(f.root,'releases',role);
  return [role,{root,entryPath:path.join(root,'backend/server.mjs'),manifestSha256:f.spec.packages.manifests.find(row=>row.productRole===role).sha256,buildDigest:manifest.buildDigest}];
 }));
 reapprove(f);privateApiRuntimeProvider(f,t);await runProductionPreservation({...options(f),command:'prepare',apply:true});await runProductionPreservation({...options(f),command:'seal',apply:true});
 const target=original.installTargets.v2;assert.notEqual(target.root,original.root);fs.cpSync(f.packageRoot,target.root,{recursive:true});
 const restored=await runProductionPreservation({...options(f),command:'restore',apply:true});assert.equal(restored.state,'restored');assert.equal(restored.databaseId,f.spec.database.databaseId);assert.equal(sha(fs.readFileSync(original.entryPath)),oldBytes);
});
test('approved target pins reject wrong role manifest/build/entry before transport or first write',async t=>{
 for(const mutation of [target=>{target.manifestSha256='e'.repeat(64);},target=>{target.buildDigest='e'.repeat(64);},target=>{target.entryPath=path.join(target.root,'unmanifested.mjs');}]){
  const f=fixture(t),before=sourceBytes(f);mutation(f.spec.hosts[0].apiInstances[0].installTargets.v2);reapprove(f);
  await assert.rejects(runProductionPreservation({...options(f),command:'prepare',apply:true}),{code:'PRODUCTION_INSTALL_TARGET_INVALID'});assert.equal(sourceBytes(f),before);assert.deepEqual(f.calls,[]);
 }
});
test('HMAC-valid restore request cannot replace the immutable approved target',async t=>{
 const f=fixture(t);await runProductionPreservation({...options(f),command:'prepare',apply:true});await runProductionPreservation({...options(f),command:'seal',apply:true});
 const before=sourceBytes(f);let observed=0;
 f.provider.collect=input=>input.requests.map(request=>{request.payload.installed.targets[0].root=path.join(f.root,'wrong-release');request.payload.installed.targets[0].entryPath=path.join(f.root,'wrong-release','backend/server.mjs');const forged=signProductionEnvelope({hostId:request.hostId,payload:request.payload,trust:f.trust});return collectProductionSourceProof({request:forged,trust:f.trust,observe(){observed++;return f.observe(f.spec.hosts[0]);}});});
 await assert.rejects(runProductionPreservation({...options(f),command:'restore',apply:true}),{code:'PRODUCTION_INSTALL_TARGET_INVALID'});assert.equal(observed,0);assert.equal(sourceBytes(f),before);
});
test('running proof with old physical root or wrong new entry cannot authorize restore',async t=>{
 for(const mutation of [(row,original)=>{row.root=original.root;row.entryPath=original.entryPath;},row=>{row.entryPath=path.join(row.root,'src','execution-admission.mjs');}]){
  const f=fixture(t);await runProductionPreservation({...options(f),command:'prepare',apply:true});await runProductionPreservation({...options(f),command:'seal',apply:true});
  const original=f.spec.hosts[0].apiInstances[0];fs.cpSync(f.packageRoot,original.installTargets.v2.root,{recursive:true});const before=sourceBytes(f);
  const observe=(binding,request)=>{const instances=request.installed.targets.map(target=>({kind:target.kind,bindingDigest:target.bindingDigest,targetDigest:target.targetDigest,root:target.root,entryPath:target.entryPath,running:true,productRole:'v2',buildDigest:target.buildDigest,pid:999999998,createdAt:'2026-10-14T00:00:00.000Z',nonceDigest:nonce}));mutation(instances[0],original);return {...f.observe(binding),runningV2:{fenceState:'sealed',productRole:'v2',buildDigest:request.installed.apiBuildDigest,databaseId:f.spec.database.databaseId,instances}};};
  f.provider.collect=input=>input.requests.map(request=>collectProductionSourceProof({request,trust:f.trust,observe}));
  await assert.rejects(runProductionPreservation({...options(f),command:'restore',apply:true}),{code:'PRODUCTION_RESTORE_RUNNING_V2_REQUIRED'});assert.equal(sourceBytes(f),before);
 }
});
test('approved Windows client targets may retain the same global physical install root',t=>{
 const f=fixture(t),clientRoot=path.join(f.root,'global-client'),entryPath=path.join(clientRoot,'daemon/ziwei_user.mjs'),clientContents=[{path:'daemon/ziwei_user.mjs',sha256:nonce}];
 for(const role of ['v1-compat','v2']){const file=path.join(f.spec.packages.directory,role+'-manifest.json'),manifest=JSON.parse(fs.readFileSync(file));manifest.clientContents=clientContents;fs.writeFileSync(file,JSON.stringify(manifest));const pin=f.spec.packages.manifests.find(row=>row.productRole===role);pin.sha256=sha(fs.readFileSync(file));f.spec.hosts[0].apiInstances[0].installTargets[role].manifestSha256=pin.sha256;}
 const userHome=path.join(f.root,'client-user'),client={root:clientRoot,entryPath,configPath:path.join(userHome,'config.json'),userHome,runtimeDir:path.join(userHome,'runtime'),baseHome:path.join(f.root,'hermes-home'),configSha256:nonce,installedRole:'v1',clientBuild:nonce,originalInstance:{pid:999999997,createdAt:'2026-10-01T00:00:00.000Z',nonceDigest:nonce},installTargets:Object.fromEntries(['v1-compat','v2'].map(role=>[role,{root:clientRoot,entryPath,manifestSha256:f.spec.packages.manifests.find(row=>row.productRole===role).sha256,buildDigest:nonce}]))};
 f.spec.hosts[0].clients.push(client);f.spec.backupScope.homes.push(client.baseHome,client.userHome);f.spec.backupScope.configs.push(client.configPath);f.spec.backupScope.journals.push(client.runtimeDir);reapprove(f);
 const validated=validateProductionSpec({spec:f.spec,trust:f.trust,packageRoot:f.packageRoot});assert.equal(validated.spec.hosts[0].clients[0].installTargets.v2.root,clientRoot);
});
function twoHostFixture(t){
 const f=fixture(t),root=path.join(f.root,'windows-client'),userHome=path.join(f.root,'windows-user'),runtimeDir=path.join(userHome,'runtime'),baseHome=path.join(f.root,'windows-hermes'),entryPath=path.join(root,'daemon/ziwei_user.mjs');fs.mkdirSync(path.dirname(entryPath),{recursive:true});fs.writeFileSync(entryPath,'// isolated stopped Windows client source\n');for(const dir of [runtimeDir,baseHome])fs.mkdirSync(dir,{recursive:true});
 const configPath=path.join(userHome,'config.json');fs.writeFileSync(configPath,JSON.stringify({workspace:'fixture',deviceId:'windows_device',apiBase:'https://fixture.invalid',hermesHome:baseHome,sharedWorkspaces:[]}));const clientBuild=clientBuildIdentity(root);
 for(const role of ['v1-compat','v2']){const file=path.join(f.spec.packages.directory,role+'-manifest.json'),manifest=JSON.parse(fs.readFileSync(file));manifest.clientContents=[{path:'daemon/ziwei_user.mjs',sha256:sha(fs.readFileSync(entryPath))}];manifest.clientBuild=clientBuild;fs.writeFileSync(file,JSON.stringify(manifest));const pin=f.spec.packages.manifests.find(row=>row.productRole===role);pin.sha256=sha(fs.readFileSync(file));f.spec.hosts[0].apiInstances[0].installTargets[role].manifestSha256=pin.sha256;}
 const client={root,entryPath,configPath,userHome,runtimeDir,baseHome,configSha256:sha(fs.readFileSync(configPath)),installedRole:'v1',clientBuild,originalInstance:{pid:999999997,createdAt:'2026-10-01T00:00:00.000Z',nonceDigest:nonce},installTargets:Object.fromEntries(['v1-compat','v2'].map(role=>[role,{root,entryPath,manifestSha256:f.spec.packages.manifests.find(row=>row.productRole===role).sha256,buildDigest:clientBuild}]))};
 const host={hostId:'windows_fixture',deviceIds:['windows_device'],workspaceIds:['ws_fixture'],clients:[client],apiInstances:[]},keyRef=path.join(f.root,'windows.key');fs.writeFileSync(keyRef,crypto.randomBytes(32),{mode:0o600});f.spec.hosts.push(host);f.trust.hosts.push({hostId:host.hostId,keyId:'windows_key',keyRef,bindingDigest:digestProduction(host)});f.spec.backupScope.homes.push(baseHome,userHome);f.spec.backupScope.journals.push(runtimeDir);f.spec.backupScope.configs.push(configPath);reapprove(f);
 const action={id:'legacy_windows',workspace_id:'ws_fixture',type:'command',payload_json:JSON.stringify({deviceId:'windows_device'}),result_json:null,status:'expired',acked_at:'2026-10-01T00:00:00.000Z'},db=new DatabaseSync(f.spec.database.path);db.prepare('INSERT INTO a2a_actions VALUES(?,?,?,?,?,?,?)').run(...Object.values(action));db.close();
 const collected=[],scanFiles=({actions,productionRequest})=>({issues:[],files:[],directories:[],gatewayExits:[],originalActionProofs:actions.map(row=>({kind:'legacy-never-dispatched-v1',actionId:row.id,actionDigest:nativeActionDigest(row),operationId:productionRequest.operationId,specHash:productionRequest.specHash,challenge:productionRequest.challenge,hostId:productionRequest.binding.hostId,verified:true}))}),scanDatabases=()=>({issues:[],files:[],directories:[],nativeDatabases:[],nativeStateProofs:[],gatewayInboxProofs:[]});
 const collect=(input,previous)=>input.requests.map(request=>{if(request.hostId==='host_fixture')assert.deepEqual(request.payload.binding.deviceIds,[]);return collectProductionSourceProof({request,trust:f.trust,previous,observe:f.observe,scanFiles:args=>{if(request.hostId==='host_fixture')assert.equal(args.actions.some(row=>row.id==='legacy_windows'),false);return scanFiles(args);},scanDatabases});});
 f.provider.collect=input=>{const result=collect(input);collected.push(...result);return result;};f.provider.recheck=input=>collect(input,input.previous);return {...f,host,action,collected};
}
test('two hosts keep legacy interpretation local but incomplete assessment JSON cannot authorize first write',async t=>{
 const f=twoHostFixture(t),before=sourceBytes(f);await assert.rejects(runProductionPreservation({...options(f),command:'prepare',apply:true}),{code:'PRODUCTION_ACTION_COVERAGE'});assert.equal(sourceBytes(f),before);assert.equal(f.collected[0].payload.actionBindings.length,0);assert.equal(f.collected[0].payload.nativeStateProofs.length,0);assert.equal(f.collected[1].payload.actionBindings[0].id,f.action.id);assert.equal(f.collected[1].payload.nativeStateProofs[0].hostId,f.host.hostId);
});
test('two-host signed wrong host/digest/device and global pending debt refuse before first write',async t=>{
 for(const change of ['wrong-host','wrong-digest','wrong-device','global-pending']){
  const f=twoHostFixture(t),collect=f.provider.collect;
  if(change==='wrong-device'||change==='global-pending'){const db=new DatabaseSync(f.spec.database.path);if(change==='wrong-device')db.prepare('UPDATE a2a_actions SET payload_json=?,acked_at=NULL').run(JSON.stringify({deviceId:'unowned_device'}));else db.exec("INSERT INTO a2a_actions VALUES('global_pending','ws_fixture','command','{}',NULL,'pending',NULL)");db.close();}
  const before=sourceBytes(f);f.provider.collect=input=>collect(input).map(envelope=>{
   if(change==='wrong-host'&&envelope.hostId===f.host.hostId)envelope.payload.nativeStateProofs[0].hostId='host_fixture';
   if(change==='wrong-digest'&&envelope.hostId===f.host.hostId)envelope.payload.actionBindings[0].digest='0'.repeat(64);
   if(change==='wrong-device'&&envelope.hostId==='host_fixture'){const row=input.requests[0].payload.actionProjection.tables.a2a_actions.rows[0];envelope.payload.actionBindings.push({id:row.id,digest:nativeActionDigest(row)});}
   if(change==='global-pending'){envelope.payload.issues=[];envelope.payload.safe=true;}
   envelope.payload.evidenceDigest=productionEvidenceDigest(envelope.payload);return signProductionEnvelope({hostId:envelope.hostId,payload:envelope.payload,trust:f.trust});
  });
  await assert.rejects(runProductionPreservation({...options(f),command:'prepare',apply:true}),{code:'PRODUCTION_ACTION_COVERAGE'});assert.equal(sourceBytes(f),before);assert.equal(readDatabaseSnapshot(f.spec.database.path,db=>db.prepare("SELECT 1 FROM sqlite_master WHERE name='version_preservation'").get()),undefined);
 }
});
test('private namespace evidence directories do not authorize arbitrary descendants',async t=>{
 const f=fixture(t),outside=path.join(f.root,'native-evidence');fs.mkdirSync(outside);f.spec.hosts[0].nativeSourceRefs=[{kind:'namespace-capture-directory-v1',canonicalPath:outside,producerSha256:nonce}];reapprove(f);const collect=f.provider.collect,before=sourceBytes(f);
 f.provider.collect=input=>collect(input).map(envelope=>{envelope.payload.files.push({path:path.join(outside,'unapproved.sqlite'),exists:false});envelope.payload.evidenceDigest=productionEvidenceDigest(envelope.payload);return signProductionEnvelope({hostId:envelope.hostId,payload:envelope.payload,trust:f.trust});});
 await assert.rejects(runProductionPreservation({...options(f),command:'prepare',apply:true}),{code:'PRODUCTION_RECORD_SCOPE'});assert.equal(sourceBytes(f),before);
});
