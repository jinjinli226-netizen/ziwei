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
import {collectProductionSourceProof,runProductionSourceCli} from '../scripts/production-source-proof.mjs';

const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const nonce='c'.repeat(64);
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-production-entry-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const databaseFile=path.join(root,'current.sqlite'),db=new DatabaseSync(databaseFile);
 db.exec("CREATE TABLE workspaces(id TEXT PRIMARY KEY,slug TEXT); INSERT INTO workspaces VALUES('ws_fixture','fixture'); CREATE TABLE employees(id TEXT PRIMARY KEY,workspace_id TEXT,runtime TEXT,status TEXT); CREATE TABLE tasks(id TEXT PRIMARY KEY,assignee TEXT); CREATE TABLE conversations(id TEXT PRIMARY KEY,employee_id TEXT); CREATE TABLE a2a_actions(id TEXT PRIMARY KEY,workspace_id TEXT,type TEXT,payload_json TEXT,result_json TEXT,status TEXT,acked_at TEXT); CREATE TABLE management_requests(workspace_id TEXT,kind TEXT,request_key TEXT,fingerprint TEXT,resource_id TEXT,PRIMARY KEY(workspace_id,kind,request_key));");db.close();
 const packages=path.join(root,'packages'),packageRoot=path.join(root,'staged-v2');fs.mkdirSync(packages);fs.mkdirSync(packageRoot);
 const files=['backend/server.mjs','backend/production-preservation.mjs','backend/version-preservation.mjs','backend/preservation-native-evidence.mjs','backend/preservation-native-databases.mjs','scripts/production-source-proof.mjs','scripts/v2-preservation.mjs','scripts/verify-preservation-packages.mjs','src/execution-admission.mjs'];
 for(const file of files){const target=path.join(packageRoot,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(repository,file),target);}
 const candidateCommit='a'.repeat(40),manifests=[],artifacts=[];
 for(const productRole of ['v1-compat','v2']){
  const descriptor={schemaVersion:1,productRole,candidateCommit,versions:FROZEN_VERSIONS};
  if(productRole==='v2')fs.writeFileSync(path.join(packageRoot,'preservation-package.json'),JSON.stringify(descriptor));
  const contents=[...files.map(file=>({path:file,sha256:sha(fs.readFileSync(path.join(packageRoot,file)))})),{path:'preservation-package.json',sha256:sha(JSON.stringify(descriptor))}];
  const entries=['windows-client.tgz','api.zip','frontend.zip'].map(suffix=>{const name=productRole+'-'+suffix,bytes=Buffer.from('isolated fixture artifact '+name);fs.writeFileSync(path.join(packages,name),bytes);artifacts.push({name,bytes:bytes.length,sha256:sha(bytes)});return {path:path.join(packages,name),bytes:bytes.length,sha256:sha(bytes)};});
  const manifest={...descriptor,contents,buildDigest:sha(JSON.stringify(contents)),artifacts:entries,clientBuild:nonce};
  const manifestFile=path.join(packages,productRole+'-manifest.json');fs.writeFileSync(manifestFile,JSON.stringify(manifest));manifests.push({productRole,sha256:sha(fs.readFileSync(manifestFile))});
 }
 const apiRoot=path.join(root,'original-api');fs.mkdirSync(path.join(apiRoot,'backend'),{recursive:true});const entryPath=path.join(apiRoot,'backend','server.mjs');fs.writeFileSync(entryPath,'// stopped original V1 fixture\n');
 const host={hostId:'host_fixture',deviceIds:[],workspaceIds:['ws_fixture'],clients:[],apiInstances:[{root:apiRoot,entryPath,role:'v1',buildDigest:sha(JSON.stringify([{path:'backend/server.mjs',sha256:sha(fs.readFileSync(entryPath))}])),serviceManager:'isolated-fixture',originalInstance:{pid:999999999,createdAt:'2026-10-01T00:00:00.000Z',nonceDigest:nonce}}]};
 const stat=fs.lstatSync(databaseFile,{bigint:true}),database={path:databaseFile,canonicalPath:fs.realpathSync.native(databaseFile),identity:{dev:String(stat.dev),ino:String(stat.ino)},databaseId:crypto.randomUUID()};
 const spec={schemaVersion:1,mode:'production',operationId:'fixture-production',authorization:{executor:'R01',targetOrigins:['https://fixture.invalid'],allowedCommands:['inspect','prepare','seal','restore','abort']},database,packages:{directory:packages,manifests,artifacts},candidateCommit,qa:{commit:'b'.repeat(40),evidenceSha256:nonce},versions:FROZEN_VERSIONS,hosts:[host],backupScope:{mainDatabase:databaseFile,controlDatabases:[],objectRoots:[],homes:[],journals:[],configs:[],privateReferences:[]},bootstrap:{fromRole:'v1',offline:true,allOriginalWritersStopped:true}};
 spec.specHash=digestProduction(spec);
 const keyRef=path.join(root,'private-key');fs.writeFileSync(keyRef,crypto.randomBytes(32),{mode:0o600});
 const trust={schemaVersion:1,algorithm:'hmac-sha256',hosts:[{hostId:host.hostId,keyId:'ops_fixture',keyRef,bindingDigest:digestProduction(host)}],approvedSpecs:[{operationId:spec.operationId,specHash:spec.specHash}],backupHostId:host.hostId};
 const observe=binding=>({namespace:process.platform,namespaceComplete:true,workerScopeComplete:true,originalStopped:true,restarted:false,unresolved:[],instances:[...binding.clients,...binding.apiInstances].map(row=>({bindingDigest:digestProduction(row),originalInstance:row.originalInstance,stopped:true}))});
 const calls=[],provider={
  collect(input){calls.push('collect');return input.requests.map(request=>collectProductionSourceProof({request,trust,observe}));},
  recheck(input){calls.push('recheck');return input.requests.map(request=>collectProductionSourceProof({request,trust,previous:input.previous,observe}));},
  backup(input){calls.push('backup');const issuedAt=new Date().toISOString(),payload={domain:'ziwei-production-backup-proof-v1',schemaVersion:1,kind:'backup-restore-read',command:'seal',challenge:crypto.randomUUID(),issuedAt,expiresAt:new Date(Date.parse(issuedAt)+60000).toISOString(),operationId:input.operationId,specHash:input.specHash,databaseIdentity:input.databaseIdentity,freezeDigest:input.freezeDigest,scopeDigest:digestProduction(input.scope),manifestDigest:nonce,restoreReadDigest:nonce,mainDatabase:{path:input.scope.mainDatabase,integrity:'ok',foreignKeys:'ok',stablePrimaryKeysDigest:nonce,fileDigest:nonce},controlDatabases:[],objectsDigest:nonce,homesDigest:nonce,journalsDigest:nonce,configsDigest:nonce,privateReferencesDigest:nonce,originalWritersStopped:true,safe:true};return signProductionEnvelope({hostId:host.hostId,payload,trust});}
 };
 return {root,spec,trust,packageRoot,provider,calls,observe,entryPath};
}
const options=f=>({spec:f.spec,trust:f.trust,packageRoot:f.packageRoot,proofProvider:f.provider});
const sourceBytes=f=>sha(fs.readFileSync(f.spec.database.path));
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
 fs.cpSync(f.packageRoot,f.spec.hosts[0].apiInstances[0].root,{recursive:true});
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
 const f=fixture(t);await runProductionPreservation({...options(f),command:'prepare',apply:true});await runProductionPreservation({...options(f),command:'seal',apply:true});
 const db=new DatabaseSync(f.spec.database.path);createPreservation(db,{role:'v1-compat'});db.exec("INSERT INTO employees VALUES('ordinary','ws_fixture','codex','active'); INSERT INTO tasks VALUES('v1_increment','ordinary'); CREATE TABLE ordinary_tombstones(id TEXT PRIMARY KEY); INSERT INTO ordinary_tombstones VALUES('deleted_during_compat')");db.close();
 const apiRoot=f.spec.hosts[0].apiInstances[0].root;fs.cpSync(f.packageRoot,apiRoot,{recursive:true});
 const manifest=JSON.parse(fs.readFileSync(path.join(f.spec.packages.directory,'v2-manifest.json')));
 const observe=(binding,request)=>({...f.observe(binding),runningV2:{fenceState:'sealed',productRole:'v2',buildDigest:manifest.buildDigest,databaseId:f.spec.database.databaseId,instances:binding.apiInstances.map(original=>({bindingDigest:digestProduction(original),root:original.root,entryPath:original.entryPath,running:true,productRole:'v2',buildDigest:manifest.buildDigest,pid:999999998,createdAt:'2026-10-14T00:00:00.000Z',nonceDigest:nonce}))}});
 f.provider.collect=input=>input.requests.map(request=>collectProductionSourceProof({request,trust:f.trust,observe}));
 f.provider.recheck=input=>input.requests.map(request=>collectProductionSourceProof({request,trust:f.trust,previous:input.previous,observe}));
 const restored=await runProductionPreservation({...options(f),command:'restore',apply:true});assert.equal(restored.state,'restored');
 assert.deepEqual(readDatabaseSnapshot(f.spec.database.path,db=>({task:db.prepare("SELECT id FROM tasks WHERE id='v1_increment'").get().id,tombstone:db.prepare("SELECT id FROM ordinary_tombstones").get().id})),{task:'v1_increment',tombstone:'deleted_during_compat'});
 assert.equal(restored.databaseId,f.spec.database.databaseId);
});
test('source CLI rejects output reuse and bad HMAC before inspecting native processes',async t=>{
 const f=fixture(t),requestFile=path.join(f.root,'request.json'),trustFile=path.join(f.root,'trust.json'),output=path.join(f.root,'source-proof.json');
 fs.writeFileSync(trustFile,JSON.stringify(f.trust));fs.writeFileSync(output,'retained-original-envelope');
 assert.throws(()=>runProductionSourceCli(['collect','--request',requestFile,'--trust',trustFile,'--output',output]),{code:'SOURCE_OUTPUT_EXISTS'});
 assert.equal(fs.readFileSync(output,'utf8'),'retained-original-envelope');
 fs.unlinkSync(output);
 f.provider.collect=input=>{const request=input.requests[0];request.signature='0'.repeat(64);fs.writeFileSync(requestFile,JSON.stringify(request));assert.throws(()=>runProductionSourceCli(['collect','--request',requestFile,'--trust',trustFile,'--output',output]),{code:'PRODUCTION_SIGNATURE_INVALID'});assert.equal(fs.existsSync(output),false);throw Object.assign(new Error('fixture finished'),{code:'FIXTURE_END'});};
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
