import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {v1Overlay} from '../scripts/build-preservation-packages.mjs';
import {productionSemanticIssues} from '../backend/production-preservation.mjs';
import {FROZEN_VERSIONS} from '../backend/version-preservation.mjs';
const ROOT=path.resolve(import.meta.dirname,'..'),sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const rows=repo=>repo.db.prepare('SELECT * FROM a2a_actions ORDER BY id').all();
const snapshot=file=>Object.fromEntries(['','-wal','-shm'].map(suffix=>[suffix,fs.existsSync(file+suffix)?sha(fs.readFileSync(file+suffix)):null]));
const files=(root,prefix='')=>fs.readdirSync(path.join(root,prefix),{withFileTypes:true}).flatMap(entry=>{if(entry.name==='node_modules')return [];const relative=path.posix.join(prefix,entry.name);return entry.isDirectory()?files(root,relative):[{path:relative,sha256:sha(fs.readFileSync(path.join(root,relative)))}];});
async function fixture(t){
 const base=fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'ziwei-server-rollout-')),packages=path.join(base,'packages'),objects=path.join(base,'objects'),database=path.join(base,'main.sqlite'),roots={};fs.mkdirSync(packages);fs.mkdirSync(objects);
 t.after(()=>{try{repo.db.close();}catch{}assert.ok(base.startsWith(path.join(fs.realpathSync.native(os.tmpdir()),'ziwei-server-rollout-')));fs.rmSync(base,{recursive:true,force:true});});
 for(const role of ['v2','v1-compat']){
  const root=path.join(base,role);roots[role]=root;fs.mkdirSync(root);
  for(const name of ['backend','src','scripts','skills','daemon'])fs.cpSync(path.join(ROOT,name),path.join(root,name),{recursive:true});for(const name of ['package.json','package-lock.json'])fs.copyFileSync(path.join(ROOT,name),path.join(root,name));fs.symlinkSync(path.join(ROOT,'node_modules'),path.join(root,'node_modules'),'dir');
  const admission=path.join(root,'src/execution-admission.mjs');fs.writeFileSync(admission,fs.readFileSync(admission,'utf8').replace("PRODUCT_ROLE='v2'",`PRODUCT_ROLE='${role}'`));
  const descriptor={schemaVersion:1,productRole:role,candidateCommit:'5'.repeat(40),versions:FROZEN_VERSIONS,productionApplied:false};fs.writeFileSync(path.join(root,'preservation-package.json'),JSON.stringify(descriptor));
  const contents=files(root).sort((a,b)=>a.path.localeCompare(b.path)),artifact=path.join(packages,role+'-api.zip'),bytes=Buffer.from('isolated artifact fixture '+role);fs.writeFileSync(artifact,bytes);fs.writeFileSync(path.join(packages,role+'-manifest.json'),JSON.stringify({...descriptor,contents,buildDigest:sha(JSON.stringify(contents)),artifacts:[{path:artifact,sha256:sha(bytes),bytes:bytes.length}]}));
 }
 const api=await import(pathToFileURL(path.join(roots.v2,'backend/server-code-rollout.mjs'))),repository=await import(pathToFileURL(path.join(roots.v2,'backend/repository.mjs'))),managementModule=await import(pathToFileURL(path.join(roots.v2,'backend/management.mjs'))),appModule=await import(pathToFileURL(path.join(roots.v2,'backend/app.mjs')));
 // Unit IO seam models the already-open handle; production startup uses the
 // existing Linux fstat/pread reader. This is not native Windows/Mac evidence.
 const io={serverCodeRolloutIo:{readConnectionIdentity(file){const stat=fs.lstatSync(file,{bigint:true});return {canonicalPath:file,identity:{dev:String(stat.dev),ino:String(stat.ino)}};}}};
 const common={filename:database,envEncryptionKey:'isolated-rollout-key',objectStoreDir:objects,discoverLocalVersions:()=>{throw new Error('native discovery must not run');}},legacy=repository.createRepository(common);
 legacy.heartbeatDevice('test-111',{deviceId:'old-pc',clientBuild:'a'.repeat(64),runtimes:{Hermes:{status:'available',version:'999',readiness:{authentication:'configured',provider:'configured',ready:true},profiles:[{name:'default'}]}}});
 const pending=legacy.createA2AAction('test-111',{type:'runtime.execute',payload:{deviceId:'old-pc',prompt:'do not deliver'}}),acked=legacy.createA2AAction('test-111',{type:'runtime.execute',payload:{deviceId:'old-pc',prompt:'original result'}});legacy.ackA2AAction(acked.id,{deviceId:'old-pc'});
 const expired=legacy.createA2AAction('test-111',{type:'runtime.execute',payload:{deviceId:'old-pc',prompt:'original expired ACK'}});legacy.ackA2AAction(expired.id,{deviceId:'old-pc'});legacy.db.prepare("UPDATE a2a_actions SET status='expired',expires_at='2020-01-01T00:00:00.000Z',result_json='' WHERE id=?").run(expired.id);
 // Historical migration must not toggle this existing configuration at mode boot.
 legacy.db.prepare('UPDATE employees SET management_mcp_enabled=0').run();legacy.db.prepare('DELETE FROM schema_migrations WHERE version=?').run('2026-10-09-default-management-mcp');
 const employees=legacy.db.prepare('SELECT * FROM employees ORDER BY id').all(),before=rows(legacy);legacy.db.close();
 const config=api.planServerCodeRollout({databasePath:database,packagesDirectory:packages,objectStoreDir:objects,envEncryptionKey:common.envEncryptionKey}),configFile=path.join(base,'rollout.json');fs.writeFileSync(configFile,JSON.stringify(config),{mode:0o600});const options={...common,serverCodeRolloutConfigPath:configFile,serverCodeRolloutConfigSha256:sha(fs.readFileSync(configFile))},repo=repository.createRepository(options,io),management=managementModule.createManagementService(repo);

 return {base,roots,api,repository,management,appModule,repo,common,options,config,configFile,before,employees,pending,acked,expired,database,objects,io};
}
test('persistent startup binds DB/package before writes; missing/spoofed/altered input has no DB or path effects',async t=>{
 const f=await fixture(t);assert.deepEqual(rows(f.repo),f.before);assert.deepEqual(f.repo.db.prepare('SELECT * FROM employees ORDER BY id').all(),f.employees);
 const before=snapshot(f.database);assert.throws(()=>f.repository.createRepository(f.common,f.io),{code:'SERVER_CODE_ROLLOUT_REQUIRED'});assert.deepEqual(snapshot(f.database),before);
 const wrong=path.join(f.base,'wrong','empty.sqlite');assert.throws(()=>f.repository.createRepository({...f.options,filename:wrong},f.io),{code:'SERVER_CODE_ROLLOUT_DATABASE'});assert.equal(fs.existsSync(path.dirname(wrong)),false);
 assert.throws(()=>f.repository.createRepository({...f.options,serverCodeRolloutConfigSha256:'0'.repeat(64)},f.io),{code:'SERVER_CODE_ROLLOUT_AUTHORIZATION'});assert.throws(()=>f.repo.db.prepare('DELETE FROM server_code_rollout').run(),/SERVER_CODE_ROLLOUT_CONTROL_PRIVATE/);
 assert.throws(()=>f.repository.createRepository(f.options,{serverCodeRolloutIo:{readConnectionIdentity:()=>({canonicalPath:f.database,identity:{dev:'0',ino:'0'}})}}),{code:'SERVER_CODE_ROLLOUT_DATABASE_HANDLE'});
 fs.appendFileSync(path.join(f.roots.v2,'backend/app.mjs'),'\n// changed');assert.throws(()=>f.repository.createRepository(f.options,f.io),{code:'SERVER_CODE_ROLLOUT_SOURCE'});assert.deepEqual(rows(f.repo),f.before);
});
test('old/missing/self-reported clients cannot create, poll, ACK, renew, GET or start; receipts do not execute',async t=>{
 const f=await fixture(t);f.repo.heartbeatDevice('test-111',{deviceId:'spoofed',clientBuild:'f'.repeat(64),qualified:true,protocol:'server-code-rollout-v1',runtimes:{Hermes:{status:'available',version:'999',readiness:{ready:true,authentication:'configured',provider:'configured'}}}});
 for(const deviceId of [undefined,'old-pc','spoofed']){assert.throws(()=>f.repo.createA2AAction('test-111',{type:'directory.inspect',payload:{deviceId,qualified:true}}),{code:'SERVER_CODE_ROLLOUT_CLIENT_REQUIRED'});assert.deepEqual(f.repo.listA2AActions('test-111',{status:'all',deviceId,executionDelivery:true}),[]);assert.throws(()=>f.repo.ackA2AAction(f.pending.id,{deviceId,qualified:true}),{code:'SERVER_CODE_ROLLOUT_CLIENT_REQUIRED'});assert.throws(()=>f.repo.authorizeActionExecution(f.acked.id,{deviceId,qualified:true}),{code:'SERVER_CODE_ROLLOUT_CLIENT_REQUIRED'});}
 assert.throws(()=>f.repo.ackA2AAction(f.acked.id,{deviceId:'old-pc',receiptOnly:true,renewLease:true}),{code:'SERVER_CODE_ROLLOUT_CLIENT_REQUIRED'});const receipt=f.repo.ackA2AAction(f.acked.id,{deviceId:'old-pc',receiptOnly:true});assert.equal(receipt.leaseRenewed,false);assert.equal(Object.hasOwn(receipt,'payload'),false);assert.throws(()=>f.repo.deviceAction(f.pending.id,{deviceId:'old-pc'}),{code:'SERVER_CODE_ROLLOUT_CLIENT_REQUIRED'});
 assert.throws(()=>f.repo.db.prepare("UPDATE a2a_actions SET status='acked' WHERE id=?").run(f.pending.id),/SERVER_CODE_ROLLOUT_ACTION_PRESERVED/);assert.deepEqual(rows(f.repo),f.before);assert.doesNotThrow(()=>f.repo.listModels('test-111'));
});
test('Bot draft keeps one employee and independent profile plan with zero native action; execution blocked and pure pause allowed',async t=>{
 const f=await fixture(t),count=rows(f.repo).length,context={authenticatedMcp:true,actorRole:'owner'},bot=f.management.bots.create('test-111',{name:'Server draft',targetDeviceId:'old-pc',sourceProfile:'default',idempotencyKey:'draft'},context);
 assert.equal(bot.employee_id,bot.employee.id);assert.equal(bot.control_state,'draft');assert.equal(bot.instance.mode,'owned_profile');assert.equal(bot.instance.provisioning.status,'waiting_client');assert.equal(bot.instance.home,null);assert.match(bot.instance.profile,/^bot-/);assert.equal(rows(f.repo).length,count);assert.match(bot.effect.pendingReason,/等待客户端/);
 for(const call of [()=>f.management.bots.provision('test-111',bot.id,{expectedRevision:bot.revision},context),()=>f.management.bots.validate('test-111',bot.id,{expectedRevision:bot.revision},context),()=>f.management.bots.control('test-111',bot.id,{expectedRevision:bot.revision,expectedControlEpoch:bot.control_epoch,operation:'activate'},context),()=>f.repo.addConversationMessage(bot.main_conversation_id,{content:'run'}),()=>f.repo.createTask('test-111',{title:'run',execute:true,targetDeviceId:'old-pc'}),()=>f.repo.runAutomation('missing')])assert.throws(call,{code:'SERVER_CODE_ROLLOUT_CLIENT_REQUIRED'});
 const paused=f.management.bots.control('test-111',bot.id,{expectedRevision:bot.revision,expectedControlEpoch:bot.control_epoch,operation:'pause'},context);assert.equal(paused.control_state,'paused');assert.equal(rows(f.repo).length,count);assert.equal(f.repo.getConversation(bot.main_conversation_id).messages.length,0);assert.equal(f.repo.db.prepare('SELECT COUNT(*) n FROM tasks WHERE title=?').get('run').n,0);
});
test('scheduler stays off; legitimate original result/history/debt survive, injected unbranded repo refuses',async t=>{
 const f=await fixture(t),app=f.appModule.createApp({...f.options,repository:f.repo,memory:true,enableScheduler:true});assert.equal(app.locals.scheduler,null);assert.deepEqual(f.repo.tickAutomations(),[]);assert.equal(await f.repo.dispatchWebhookDeliveries(),0);assert.equal(f.repo.listA2AActions('test-111',{status:'all'}).length,f.before.length);
 assert.throws(()=>f.appModule.createApp({...f.options,repository:{...f.repo},memory:true}),{code:'SERVER_CODE_ROLLOUT_REPOSITORY'});
 const before=f.repo.db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(f.expired.id);assert.equal(f.repo.resultA2AAction(f.expired.id,{deviceId:'old-pc',status:'succeeded',result:{output:'ignored'}}).duplicate,true);assert.deepEqual(f.repo.db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(f.expired.id),before);
 const result={output:'actual old result'};f.repo.resultA2AAction(f.acked.id,{deviceId:'old-pc',status:'succeeded',result});assert.deepEqual(f.repo.getA2AAction(f.acked.id).result,result);assert.equal(rows(f.repo).length,f.before.length);assert.throws(()=>f.repo.resultA2AAction(f.pending.id,{deviceId:'old-pc',status:'succeeded',result}),{code:'SERVER_CODE_ROLLOUT_CLIENT_REQUIRED'});assert.ok(productionSemanticIssues({tables:{a2a_actions:{rows:[before]}}}).some(row=>row.code==='PRODUCTION_ORIGINAL_ACTION_DEBT'));
});
test('same-batch compatibility code uses current DB and preserves new documents, deletion tombstones, objects and old rows',async t=>{
 const f=await fixture(t),doc=f.repo.createDocument('test-111',{name:'trial',data:'keep current data',contentEncoding:'utf8'}),removed=f.repo.createDocument('test-111',{name:'deleted',data:'never resurrect',contentEncoding:'utf8'});f.repo.deleteDocument(removed.id);const before=rows(f.repo),control=f.repo.db.prepare('SELECT * FROM server_code_rollout').get();f.repo.db.close();
 const compat=await import(pathToFileURL(path.join(f.roots['v1-compat'],'backend/repository.mjs'))),repo=compat.createRepository(f.options,f.io);
 try{assert.equal(repo.serverCodeRollout.status().productRole,'v1-compat');assert.deepEqual(rows(repo),before);assert.deepEqual(repo.db.prepare('SELECT * FROM server_code_rollout').get(),control);assert.equal(Buffer.from(repo.downloadDocument(doc.id).content,'base64').toString(),'keep current data');assert.ok(repo.db.prepare('SELECT deleted_at FROM documents WHERE id=?').get(removed.id).deleted_at);assert.equal(repo.listDocuments('test-111').some(row=>row.id===removed.id),false);assert.throws(()=>repo.createA2AAction('test-111',{payload:{deviceId:'old-pc'}}),{code:'SERVER_CODE_ROLLOUT_CLIENT_REQUIRED'});}finally{repo.db.close();}
});

test('borrowed completion methods cannot queue retries or webhooks with a spoofed receiver',async t=>{
 const f=await fixture(t),auto=f.repo.createAutomation('test-111',{name:'old generic schedule',prompt:'original',schedule:'每天 9:00'}),runId='old_run_fixture';
 f.repo.db.prepare('INSERT INTO automation_runs(id,automation_id,workspace_id,status,mode,created_at,max_attempts) VALUES(?,?,?,?,?,?,?)').run(runId,auto.id,auto.workspace_id,'running','manual',new Date().toISOString(),3);
 let dispatched=0;const receiver={queueAutomationRetry(){dispatched++;return{queued:true};},queueWebhookDelivery(){dispatched++;return{queued:true};},dispatchWebhookDeliveries(){dispatched++;}};
 const result=f.repo.completeAutomationRun.call(receiver,runId,{status:'failed',error:'original failure'});assert.equal(dispatched,0);assert.equal(result.status,'failed');assert.equal(result.attempt,0);assert.equal(result.next_retry_at,null);
});

test('public guard cannot brand copied, descriptor-copied or changed storage closures',async t=>{
 const f=await fixture(t);let foreign=0;const foreignWrite=()=>{foreign++;};
 assert.equal(f.api.guardServerCodeRolloutRepository(f.repo),f.repo);
 for(const copy of [{...f.repo,createDocument:foreignWrite},Object.create(Object.getPrototypeOf(f.repo),Object.getOwnPropertyDescriptors(f.repo)),{db:f.repo.db,createDocument:foreignWrite}]){
  assert.throws(()=>f.api.guardServerCodeRolloutRepository(copy),{code:'SERVER_CODE_ROLLOUT_REPOSITORY'});
  assert.throws(()=>f.appModule.createApp({...f.options,repository:copy,memory:true}),{code:'SERVER_CODE_ROLLOUT_REPOSITORY'});
 }
 const original=f.repo.createDocument;f.repo.createDocument=foreignWrite;
 assert.throws(()=>f.api.guardServerCodeRolloutRepository(f.repo),{code:'SERVER_CODE_ROLLOUT_REPOSITORY'});
 assert.throws(()=>f.appModule.createApp({...f.options,repository:f.repo,memory:true}),{code:'SERVER_CODE_ROLLOUT_REPOSITORY'});
 f.repo.createDocument=original;assert.equal(foreign,0);
});
test('frozen V1 overlay has strict event lease and draft anchors and refuses management bootstrap',async t=>{
 const f=await fixture(t),directory=path.join(f.base,'actual-v1'),archive=path.join(f.base,'v1.tar');fs.mkdirSync(directory);
 execFileSync('git',['archive','--format=tar',FROZEN_VERSIONS.v1,'--output='+archive],{cwd:ROOT});execFileSync('tar',['-xf',archive,'-C',directory]);
 v1Overlay(directory);
 const source=fs.readFileSync(path.join(directory,'backend/repository.mjs'),'utf8');
 assert.match(source,/if\(!rollout\)db\.prepare\("UPDATE a2a_actions SET expires_at=\?/);
 assert.match(source,/return finishRepository\(guardRepository/);
 const management=fs.readFileSync(path.join(directory,'backend/management.mjs'),'utf8');assert.match(management,/if\(repo\.serverCodeRollout\)\{const device=discovery/);
 const bootstrap=await import(pathToFileURL(path.join(directory,'backend/management-bootstrap.mjs')));
 assert.throws(()=>bootstrap.createManagementBootstrap(f.repo,{memory:true}).bootstrap('test-111',{workspace:'test-111'}),{code:'SERVER_CODE_ROLLOUT_CLIENT_REQUIRED'});
});
