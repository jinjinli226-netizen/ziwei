import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {IncomingMessage,ServerResponse} from 'node:http';
import {Duplex} from 'node:stream';
import {createRepository} from './repository.mjs';
import {createManagementService} from './management.mjs';
import {createAuthService} from './auth.mjs';
import {botSnapshot} from './bots.mjs';
import {BOT_FORCE_ABANDON_POLICY as POLICY,forceAbandonDigest as digest,forceAbandonBytesDigest as bytesDigest} from '../src/bot-force-abandon-contract.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),secret='force-abandon-isolated-test-signing-secret-0123456789';
async function request(app,url,{method='POST',body={},token='',cookie='',headers={}}={}){
  const socket=new Duplex({read(){},write(_chunk,_encoding,done){done();}}),req=new IncomingMessage(socket),res=new ServerResponse(req),chunks=[],bytes=Buffer.from(JSON.stringify(body));
  req.method=method;req.url=url;req.headers={host:'force.fixture','content-type':'application/json','content-length':String(bytes.length),cookie,...(token?{'x-ziwei-device-token':token}:{}),...headers};
  try{return await new Promise((resolve,reject)=>{res.write=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk,encoding));done?.();return true;};res.end=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));done?.();resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks)),cache:res.getHeader('Cache-Control')});res.emit('finish');return res;};req.on('error',reject);res.on('error',reject);app.handle(req,res,error=>reject(error||new Error('Unhandled memory request')));req.push(bytes);req.push(null);});}finally{socket.destroy();}
}
async function fixture(t){
  const repo=createRepository({memory:true}),db=repo.db,auth=createAuthService(db),owner=auth.setup({email:'force-owner@fixture.test',password:'force-owner-fixture-password'}),ws=repo.getWorkspace('test-111');t.after(()=>db.close());
  db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run('force-owner-member',ws.id,owner.user_id,'Owner','force-owner@fixture.test','owner',new Date().toISOString());
  const context={actorUserId:owner.user_id,actorRole:'member'},pair=repo.claimDevicePairing({code:repo.createDevicePairing(ws.slug,{name:'Force holder'}).code});
  repo.heartbeatDevice(ws.slug,{deviceId:pair.deviceId,runtimes:{Hermes:{status:'available',version:'0.22',profiles:[{name:'default'}]}}});
  const bot=createManagementService(repo).bots.create(ws.slug,{name:'Force abandon fixture',targetDeviceId:pair.deviceId,runtimeProfile:'default',visibility:'workspace',idempotencyKey:'create'},context);
  db.prepare('UPDATE hermes_bots SET revision=3,control_epoch=5 WHERE employee_id=?').run(bot.id);
  const snapshot=botSnapshot(db,bot.id,ws.id),actionId='action_force-fixture',eventId='event_force-original',base=Date.now()-60000,stamp=n=>new Date(base+n).toISOString(),payload={runtime:'Hermes',deviceId:pair.deviceId,employeeId:bot.id,profile:snapshot.sourceProfile,managementMcp:{enabled:true,workspace:ws.slug},prompt:'private prompt must not leak',hermesBot:snapshot},rawPayload=JSON.stringify(payload),rawResult=JSON.stringify(POLICY.originalResult),rawEvent=JSON.stringify({error:POLICY.originalError,result:POLICY.originalResult});
  db.prepare('INSERT INTO a2a_actions(id,workspace_id,agent_id,type,payload_json,dedupe_key,status,created_at,acked_at,completed_at,result_json,error) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(actionId,ws.id,'ziwei_user','conversation.execute',rawPayload,'force-dedupe','failed',stamp(0),stamp(1000),stamp(3000),rawResult,POLICY.originalError);
  db.prepare('INSERT INTO a2a_action_events(id,action_id,type,message,data_json,created_at) VALUES(?,?,?,?,?,?)').run(eventId,actionId,'failed','Original retained failure',rawEvent,stamp(2000));
  db.prepare("UPDATE hermes_bots SET active_action_id=?,control_state='paused',control_epoch=8 WHERE employee_id=?").run(actionId,bot.id);db.prepare("UPDATE employees SET status='paused' WHERE id=?").run(bot.id);
  db.prepare("UPDATE devices SET client_build=?,pid=?,heartbeat_at=?,last_seen=? WHERE id=?").run(POLICY.holderBuild,23456,new Date().toISOString(),new Date().toISOString(),pair.deviceId);
  const raw=db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(actionId),originalEvent=db.prepare('SELECT * FROM a2a_action_events WHERE id=?').get(eventId),credential=repo.authenticateDeviceToken(pair.deviceToken),directory=fs.mkdtempSync(path.join(os.tmpdir(),'force-abandon-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const fixturePolicy={...POLICY,subject:{...POLICY.subject,actionId,workspace:ws.slug,workspaceId:ws.id,employeeId:bot.id,deviceId:pair.deviceId,profile:payload.profile,originalPayloadSha256:bytesDigest(rawPayload),originalResultSha256:bytesDigest(rawResult),failedEventId:eventId,failedEventDataSha256:bytesDigest(rawEvent)}};
  const contractFile=path.join(directory,'contract.mjs'),serviceFile=path.join(directory,'service.mjs'),appFile=path.join(directory,'app.mjs');let source=fs.readFileSync(path.join(root,'src/bot-force-abandon-contract.mjs'),'utf8');
  const start=source.indexOf('export const BOT_FORCE_ABANDON_POLICY='),end=source.indexOf('\nexport const BOT_FORCE_ABANDON_POLICY_DIGEST=',start);assert(start>=0&&end>start);fs.writeFileSync(contractFile,source.slice(0,start)+`export const BOT_FORCE_ABANDON_POLICY=freeze(${JSON.stringify(fixturePolicy)});`+source.slice(end));
  const imports=(source,base)=>source.replace(/from (['"])([^'"]+)\1/g,(_all,q,spec)=>`from ${q}${spec==='../src/bot-force-abandon-contract.mjs'?pathToFileURL(contractFile).href:spec==='./bot-force-abandon.mjs'?pathToFileURL(serviceFile).href:spec.startsWith('.')?new URL(spec,base).href:spec.startsWith('node:')?spec:import.meta.resolve(spec)}${q}`);
  fs.writeFileSync(serviceFile,imports(fs.readFileSync(path.join(root,'backend/bot-force-abandon.mjs'),'utf8'),pathToFileURL(path.join(root,'backend/bot-force-abandon.mjs'))));fs.writeFileSync(appFile,imports(fs.readFileSync(path.join(root,'backend/app.mjs'),'utf8'),pathToFileURL(path.join(root,'backend/app.mjs'))));
  const serviceModule=await import(pathToFileURL(serviceFile)),contract=await import(pathToFileURL(contractFile));let clock=Date.now();const service=serviceModule.createBotForceAbandon(repo,{readA2AToken:()=>secret,now:()=>clock}),input={expectedActionId:actionId,expectedRevision:3,expectedControlEpoch:8,acknowledgeUncertain:true,idempotencyKey:'force-request'},holder={pid:23456,creationTime:stamp(5000),nonce:'a'.repeat(48),root:'C:\\Users\\fixture\\ziwei',configSha256:'1'.repeat(64),stateSha256:'2'.repeat(64)};
  const authorize=()=>service.authorize(ws.slug,bot.id,input,context),prepare=()=>service.prepare(actionId,credential,{holder}),evidence=p=>{
    const files=['action-state','delivery-journal','delivery-action','delivery-result'].map((role,index)=>({role,sha256:String(index+2).repeat(64),bytes:100+index})),manifest={schemaVersion:1,actionId,files};
    return{schemaVersion:1,policy:fixturePolicy.id,policyDigest:contract.BOT_FORCE_ABANDON_POLICY_DIGEST,subjectDigest:p.subjectDigest,currentDaemonExit:{scope:'daemon-root-only',stopped:true,pid:holder.pid,creationTime:holder.creationTime,exitedAt:new Date(clock).toISOString()},localArchive:{actionId,dedupeKey:'force-dedupe',stateSha256:holder.stateSha256,startedSha256:'6'.repeat(64),deliverySha256:files[1].sha256,actionSha256:files[2].sha256,resultSha256:files[3].sha256,manifest,archiveManifestSha256:digest(manifest)},quarantineCount:1};
  };
  return{repo,db,auth,owner,context,ws,bot,pair,credential,actionId,eventId,stamp,rawPayload,rawResult,rawEvent,raw,originalEvent,service,contract,input,holder,authorize,prepare,evidence,reader:()=>serviceModule.readForceAbandonRecovery(db,db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(actionId)),advance:n=>{clock+=n;},app:async()=>{const {createApp}=await import(pathToFileURL(appFile));return createApp({memory:true,requireAuth:true,requireDeviceAuth:true,repository:repo,publicApiBase:'https://force.fixture.invalid',enableScheduler:false});}};
}

test('actual browser owner can request only, with no action, message, profile, result or slot mutation',async t=>{
  const f=await fixture(t),app=await f.app(),base=`/api/workspaces/${f.ws.slug}/bots/${f.bot.id}/force-abandon`,cookie=`ziwei_session=${f.owner.session.token}`,before=f.db.prepare('SELECT * FROM hermes_bots WHERE employee_id=?').get(f.bot.id),counts=()=>f.db.prepare('SELECT (SELECT count(*) FROM a2a_actions) actions,(SELECT count(*) FROM conversation_messages) messages').get(),n=counts();
  assert.deepEqual((await request(app,base,{method:'GET',cookie})).body,{eligible:true,state:'available'});
  assert.equal((await request(app,base,{body:f.input,headers:{'x-ziwei-role':'owner'}})).status,401);
  const r=await request(app,base,{body:f.input,cookie});assert.equal(r.status,200);assert.equal(r.body.state,'requested');assert.equal(r.cache,'no-store');assert.deepEqual((await request(app,base,{body:f.input,cookie})).body,r.body);
  assert.deepEqual(f.db.prepare('SELECT * FROM hermes_bots WHERE employee_id=?').get(f.bot.id),before);assert.deepEqual(counts(),n);assert.deepEqual(f.db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(f.actionId),f.raw);assert.deepEqual(f.db.prepare('SELECT * FROM a2a_action_events WHERE id=?').get(f.eventId),f.originalEvent);
});
test('member, fabricated actor role, missing real user, hidden employee and uncertain acknowledgement are rejected',async t=>{
  const f=await fixture(t);assert.throws(()=>f.service.authorize(f.ws.slug,f.bot.id,f.input,{actorRole:'owner'}),{code:'BOT_FORCE_ABANDON_USER_REQUIRED'});
  f.db.prepare("UPDATE members SET role='member' WHERE user_id=? AND workspace_id=?").run(f.owner.user_id,f.ws.id);assert.throws(()=>f.authorize(),{code:'BOT_FORCE_ABANDON_USER_REQUIRED'});f.db.prepare("UPDATE members SET role='admin' WHERE user_id=? AND workspace_id=?").run(f.owner.user_id,f.ws.id);
  assert.throws(()=>f.service.authorize(f.ws.slug,'invisible-employee',f.input,f.context),{code:'EMPLOYEE_NOT_FOUND'});
  for(const input of [{...f.input,acknowledgeUncertain:false},{...f.input,expectedControlEpoch:9},{...f.input,actorUserId:f.owner.user_id}])assert.throws(()=>f.service.authorize(f.ws.slug,f.bot.id,input,f.context),{code:'BOT_FORCE_ABANDON_INPUT_INVALID'});
  assert.equal(f.authorize().state,'requested');
});
test('no grant is explicitly inapplicable only with actual paired original device; true HTTP credentials are required',async t=>{
  const f=await fixture(t),app=await f.app(),url=`/a2a/v1/actions/${f.actionId}/force-abandon/prepare`;
  assert.equal((await request(app,url,{body:{holder:null,deviceCredential:f.credential}})).status,401);
  assert.deepEqual((await request(app,url,{token:f.pair.deviceToken,body:{holder:null}})).body,{applicable:false});f.authorize();
  const r=await request(app,url,{token:f.pair.deviceToken,body:{holder:null}});assert.equal(r.status,409);assert.equal(r.body.code,'BOT_FORCE_ABANDON_HOLDER_REQUIRED');
  const other=f.repo.claimDevicePairing({code:f.repo.createDevicePairing(f.ws.slug,{name:'Other'}).code});assert.equal((await request(app,url,{token:other.deviceToken,body:{holder:null}})).status,403);
});
test('grant, current heartbeat build/PID, measured holder and exact paused active epoch are required',async t=>{
  const f=await fixture(t);f.authorize();const p=f.prepare();assert.equal(p.subject.holder.pid,23456);assert(!JSON.stringify(p).includes('private prompt'));
  for(const [sql,args]of [["UPDATE devices SET client_build=? WHERE id=?",['0'.repeat(64),f.pair.deviceId]],["UPDATE devices SET pid=? WHERE id=?",[9876,f.pair.deviceId]],["UPDATE devices SET heartbeat_at=? WHERE id=?",[f.stamp(-999999),f.pair.deviceId]]]){
    f.db.prepare(sql).run(...args);assert.throws(()=>f.prepare(),{code:'BOT_FORCE_ABANDON_HOLDER_CONFLICT'});f.db.prepare('UPDATE devices SET client_build=?,pid=?,heartbeat_at=? WHERE id=?').run(POLICY.holderBuild,23456,new Date().toISOString(),f.pair.deviceId);
  }
  f.db.prepare('UPDATE hermes_bots SET control_epoch=9 WHERE employee_id=?').run(f.bot.id);assert.throws(()=>f.prepare(),{code:'BOT_FORCE_ABANDON_CONTROL_CONFLICT'});
});
test('signed prepare binds holder fields, grant and raw evidence and rejects tampered, expired or cross-device commit',async t=>{
  const f=await fixture(t);f.authorize();const p=f.prepare(),e=f.evidence(p);
  assert.throws(()=>f.service.commit(f.actionId,f.credential,{challenge:p.challenge.slice(0,-2)+'xx',evidence:e}),{code:'BOT_FORCE_ABANDON_CHALLENGE_INVALID'});
  const changed=structuredClone(e);changed.currentDaemonExit.creationTime=f.stamp(5001);assert.throws(()=>f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:changed}),{code:'BOT_FORCE_ABANDON_EVIDENCE_INVALID'});
  const other=f.repo.claimDevicePairing({code:f.repo.createDevicePairing(f.ws.slug,{name:'Other'}).code});assert.throws(()=>f.service.commit(f.actionId,f.repo.authenticateDeviceToken(other.deviceToken),{challenge:p.challenge,evidence:e}),{code:'BOT_FORCE_ABANDON_BINDING_CONFLICT'});
  f.advance(120001);e.currentDaemonExit.exitedAt=new Date(Date.parse(e.currentDaemonExit.exitedAt)+120001).toISOString();assert.throws(()=>f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:e}),{code:'BOT_FORCE_ABANDON_CHALLENGE_EXPIRED'});
});
test('stopped within the original signed window can arrive late from WAL, only while the original holder and control binding remain exact',async t=>{
  const f=await fixture(t);f.authorize();const p=f.prepare(),e=f.evidence(p);f.advance(600000);
  f.db.prepare('UPDATE devices SET pid=99999 WHERE id=?').run(f.pair.deviceId);assert.throws(()=>f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:e}),{code:'BOT_FORCE_ABANDON_HOLDER_CONFLICT'});f.db.prepare('UPDATE devices SET pid=? WHERE id=?').run(f.holder.pid,f.pair.deviceId);
  f.db.prepare("UPDATE hermes_bots SET active_action_id='new-active' WHERE employee_id=?").run(f.bot.id);assert.throws(()=>f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:e}),{code:'BOT_FORCE_ABANDON_CONTROL_CONFLICT'});f.db.prepare('UPDATE hermes_bots SET active_action_id=? WHERE employee_id=?').run(f.actionId,f.bot.id);
  assert(f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:e}).receipt);
});
test('commit clears only exact old active, increments epoch and leaves paused, preserving all original evidence and no dispatch',async t=>{
  const f=await fixture(t);f.authorize();const p=f.prepare(),e=f.evidence(p),n=f.db.prepare('SELECT count(*) n FROM a2a_actions').get().n,profile=f.db.prepare('SELECT runtime_profile FROM employees WHERE id=?').get(f.bot.id),{receipt}=f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:e});
  assert(f.contract.validateForceAbandonReceipt(receipt,{actionId:f.actionId}));assert.equal(receipt.executionState,'uncertain');assert.equal(receipt.executionConfirmedStopped,false);assert.equal(receipt.partialEffectsPossible,true);assert.equal(receipt.disposition,'abandoned_by_user');assert.equal(Object.hasOwn(receipt,'processExit'),false);assert.equal(Object.hasOwn(receipt,'admissionProof'),false);
  const bot=f.db.prepare('SELECT active_action_id,control_epoch,revision,control_state FROM hermes_bots WHERE employee_id=?').get(f.bot.id);assert.deepEqual({...bot},{active_action_id:null,control_epoch:9,revision:3,control_state:'paused'});assert.deepEqual(f.db.prepare('SELECT runtime_profile FROM employees WHERE id=?').get(f.bot.id),profile);assert.equal(f.db.prepare('SELECT count(*) n FROM a2a_actions').get().n,n);assert.deepEqual(f.db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(f.actionId),f.raw);assert.deepEqual(f.db.prepare('SELECT * FROM a2a_action_events WHERE id=?').get(f.eventId),f.originalEvent);assert.deepEqual(f.reader(),receipt);assert.equal(f.service.status(f.ws.slug,f.bot.id,f.context).state,'completed');
});
test('archive missing files are explicit nulls; generic exit, extra flags, multiple quarantines and manifest mismatches fail closed',async t=>{
  const f=await fixture(t);f.authorize();const p=f.prepare(),valid=f.evidence(p);
  for(const edit of [e=>{e.currentDaemonExit.scope='execution-tree';},e=>{e.currentDaemonExit.stopped=false;},e=>{e.originalExecutionExitConfirmed=true;},e=>{e.quarantineCount=2;},e=>{e.localArchive.stateSha256='0'.repeat(64);},e=>{e.localArchive.actionId='another';},e=>{e.localArchive.manifest.files[0].bytes=null;},e=>{e.localArchive.archiveManifestSha256='0'.repeat(64);}]){const e=structuredClone(valid);edit(e);assert.throws(()=>f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:e}),{code:'BOT_FORCE_ABANDON_EVIDENCE_INVALID'});}
  for(const key of ['deliverySha256','actionSha256','resultSha256'])valid.localArchive[key]=null;
  for(const file of valid.localArchive.manifest.files.slice(1)){file.sha256=null;file.bytes=null;}valid.localArchive.archiveManifestSha256=digest(valid.localArchive.manifest);assert(f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:valid}).receipt);
});
test('same receipt retry after expiry, new active, new epoch and new holder returns immutable receipt without clearing anything again',async t=>{
  const f=await fixture(t);f.authorize();const p=f.prepare(),e=f.evidence(p),first=f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:e});f.advance(200000);
  f.db.prepare("UPDATE hermes_bots SET active_action_id='new-action',control_epoch=12,revision=4,control_state='active' WHERE employee_id=?").run(f.bot.id);f.db.prepare("UPDATE employees SET status='active',runtime_profile='new-profile' WHERE id=?").run(f.bot.id);f.db.prepare('UPDATE devices SET pid=99999,client_build=? WHERE id=?').run('0'.repeat(64),f.pair.deviceId);
  assert.deepEqual(f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:e}),first);assert.deepEqual(f.service.prepare(f.actionId,f.credential,{holder:null}),{applicable:true,completed:true,receipt:first.receipt});assert.deepEqual(f.reader(),first.receipt);assert.equal(f.db.prepare('SELECT active_action_id FROM hermes_bots WHERE employee_id=?').get(f.bot.id).active_action_id,'new-action');
  const other=structuredClone(e);other.localArchive.startedSha256='0'.repeat(64);assert.throws(()=>f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:other}),{code:'BOT_FORCE_ABANDON_IDEMPOTENCY_CONFLICT'});
});
test('CAS changes, revoked user membership and V2 seal stop first commit; marker failure rolls back slot and epoch',async t=>{
  const f=await fixture(t);f.authorize();const p=f.prepare(),e=f.evidence(p),commit=()=>f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:e});
  f.db.prepare("UPDATE hermes_bots SET active_action_id='other' WHERE employee_id=?").run(f.bot.id);assert.throws(commit,{code:'BOT_FORCE_ABANDON_CONTROL_CONFLICT'});f.db.prepare('UPDATE hermes_bots SET active_action_id=? WHERE employee_id=?').run(f.actionId,f.bot.id);
  f.db.prepare("UPDATE members SET role='member' WHERE user_id=? AND workspace_id=?").run(f.owner.user_id,f.ws.id);assert.throws(commit,{code:'BOT_FORCE_ABANDON_USER_REQUIRED'});f.db.prepare("UPDATE members SET role='owner' WHERE user_id=? AND workspace_id=?").run(f.owner.user_id,f.ws.id);
  f.db.function('ziwei_v2_admitted',_actionId=>0);assert.throws(commit,{code:'V2_OBJECT_SEALED'});f.db.function('ziwei_v2_admitted',_actionId=>1);
  f.db.exec("CREATE TRIGGER force_marker_failure BEFORE INSERT ON management_requests WHEN NEW.kind='bot-force-abandon-recovery-v1' BEGIN SELECT RAISE(ABORT,'force marker unavailable'); END");assert.throws(commit,/force marker unavailable/);assert.equal(f.db.prepare('SELECT control_epoch FROM hermes_bots WHERE employee_id=?').get(f.bot.id).control_epoch,8);assert.equal(f.db.prepare("SELECT count(*) n FROM a2a_action_events WHERE type='bot.operator_force_abandon'").get().n,0);f.db.exec('DROP TRIGGER force_marker_failure');assert(commit().receipt);
});
test('strict reader rejects tampered original bytes, failed event, grant, evidence, receipt claims or marker; controls later do not erase proof',async t=>{
  const f=await fixture(t);f.authorize();const p=f.prepare(),e=f.evidence(p),{receipt}=f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:e}),event=f.db.prepare('SELECT * FROM a2a_action_events WHERE id=?').get(`action-event_${receipt.id}`),grant=f.db.prepare("SELECT * FROM a2a_action_events WHERE type='bot.operator_force_abandon_requested'").get();
  const changes=[
    [()=>f.db.prepare('UPDATE a2a_actions SET payload_json=? WHERE id=?').run(f.rawPayload+' ',f.actionId),()=>f.db.prepare('UPDATE a2a_actions SET payload_json=? WHERE id=?').run(f.rawPayload,f.actionId)],
    [()=>f.db.prepare('UPDATE a2a_actions SET result_json=? WHERE id=?').run(f.rawResult+' ',f.actionId),()=>f.db.prepare('UPDATE a2a_actions SET result_json=? WHERE id=?').run(f.rawResult,f.actionId)],
    [()=>f.db.prepare('UPDATE a2a_action_events SET data_json=? WHERE id=?').run(f.rawEvent+' ',f.eventId),()=>f.db.prepare('UPDATE a2a_action_events SET data_json=? WHERE id=?').run(f.rawEvent,f.eventId)],
    [()=>f.db.prepare('UPDATE a2a_action_events SET data_json=? WHERE id=?').run(grant.data_json.replace('owner','member'),grant.id),()=>f.db.prepare('UPDATE a2a_action_events SET data_json=? WHERE id=?').run(grant.data_json,grant.id)],
  ];
  for(const mutation of [data=>{data.receipt.executionConfirmedStopped=true;},data=>{data.receipt.executionState='not_started';},data=>{data.evidence.currentDaemonExit.scope='execution-tree';},data=>{data.evidence.localArchive.startedSha256='0'.repeat(64);}])changes.push([()=>{const data=JSON.parse(event.data_json);mutation(data);f.db.prepare('UPDATE a2a_action_events SET data_json=? WHERE id=?').run(JSON.stringify(data),event.id);},()=>f.db.prepare('UPDATE a2a_action_events SET data_json=? WHERE id=?').run(event.data_json,event.id)]);
  for(const [change,restore]of changes){change();assert.equal(f.reader(),null);restore();assert.deepEqual(f.reader(),receipt);}
  f.db.prepare("UPDATE management_requests SET fingerprint='tampered' WHERE kind='bot-force-abandon-recovery-v1'").run();assert.equal(f.reader(),null);assert.throws(()=>f.service.prepare(f.actionId,f.credential,{holder:null}),{code:'BOT_FORCE_ABANDON_RECOVERY_CONFLICT'});
});
test('full device HTTP prepare/commit uses real credentials and returns independently validated completion',async t=>{
  const f=await fixture(t),old=process.env.ZIWEI_A2A_TOKEN;process.env.ZIWEI_A2A_TOKEN=secret;t.after(()=>{if(old===undefined)delete process.env.ZIWEI_A2A_TOKEN;else process.env.ZIWEI_A2A_TOKEN=old;});const app=await f.app();f.authorize();const base=`/a2a/v1/actions/${f.actionId}/force-abandon/`,p=await request(app,base+'prepare',{token:f.pair.deviceToken,body:{holder:f.holder}});assert.equal(p.status,200,JSON.stringify(p.body));const e=f.evidence(p.body);e.currentDaemonExit.exitedAt=new Date().toISOString();const r=await request(app,base+'commit',{token:f.pair.deviceToken,body:{challenge:p.body.challenge,evidence:e}});assert.equal(r.status,200,JSON.stringify(r.body));assert(f.contract.validateForceAbandonReceipt(r.body.receipt));assert.deepEqual(f.reader(),r.body.receipt);
});
