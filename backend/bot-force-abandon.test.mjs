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
import {createActionDelivery} from '../src/daemon-action-delivery.mjs';
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
  const absentInput=()=>({mode:contract.BOT_FORCE_ABANDON_ABSENT_POLICY.mode,installation:{build:POLICY.holderBuild,root:holder.root,configSha256:holder.configSha256,stateSha256:holder.stateSha256},absence:{scope:'current-daemon-holder',state:'absent',health:'connection_refused',nativeDaemonCount:0,healthListenerCount:0,checkedAt:new Date(clock).toISOString()}}),absentPrepare=()=>service.prepare(actionId,credential,absentInput()),absentEvidence=p=>({schemaVersion:2,mode:contract.BOT_FORCE_ABANDON_ABSENT_POLICY.mode,policy:contract.BOT_FORCE_ABANDON_ABSENT_POLICY.id,policyDigest:contract.BOT_FORCE_ABANDON_ABSENT_POLICY_DIGEST,subjectDigest:p.subjectDigest,currentDaemonAbsence:absentInput().absence,localArchive:evidence(p).localArchive,quarantineCount:1});
  return{repo,db,auth,owner,context,ws,bot,pair,credential,actionId,eventId,stamp,rawPayload,rawResult,rawEvent,raw,originalEvent,service,contract,input,holder,authorize,prepare,evidence,absentInput,absentPrepare,absentEvidence,directory,contractFile,clockNow:()=>clock,reader:()=>serviceModule.readForceAbandonRecovery(db,db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(actionId)),advance:n=>{clock+=n;},app:async()=>{const {createApp}=await import(pathToFileURL(appFile));return createApp({memory:true,requireAuth:true,requireDeviceAuth:true,repository:repo,publicApiBase:'https://force.fixture.invalid',enableScheduler:false});}};
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

test('absent current daemon reuses the actual owner grant despite stale or null heartbeat without inventing an exit',async t=>{
  const f=await fixture(t),grant=f.authorize();f.db.prepare("UPDATE devices SET status='offline',pid=NULL,last_seen=NULL,heartbeat_at=NULL WHERE id=?").run(f.pair.deviceId);
  const p=f.absentPrepare(),e=f.absentEvidence(p),n=f.db.prepare('SELECT count(*) n FROM a2a_actions').get().n,{receipt}=f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:e});
  assert.equal(receipt.schemaVersion,2);assert.equal(receipt.grantId,grant.grantId);assert.equal(receipt.mode,'no_current_daemon');assert(f.contract.validateForceAbandonReceipt(receipt));assert.deepEqual(f.reader(),receipt);assert.equal(receipt.executionState,'uncertain');assert.equal(receipt.executionConfirmedStopped,false);assert.equal(receipt.partialEffectsPossible,true);
  for(const key of ['currentDaemonExit','processExit','rootPid','launched','stopped'])assert.equal(Object.hasOwn(receipt,key),false);
  assert.deepEqual(f.db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(f.actionId),f.raw);assert.deepEqual(f.db.prepare('SELECT * FROM a2a_action_events WHERE id=?').get(f.eventId),f.originalEvent);assert.equal(f.db.prepare('SELECT count(*) n FROM a2a_actions').get().n,n);assert.deepEqual({...f.db.prepare('SELECT revision,control_epoch,control_state,active_action_id FROM hermes_bots WHERE employee_id=?').get(f.bot.id)},{revision:3,control_epoch:9,control_state:'paused',active_action_id:null});
});
test('absence requires native no-holder, free listener and connection refusal, fixed installation and exact local archive',async t=>{
  const f=await fixture(t);f.authorize();const original=f.absentInput();
  for(const edit of [input=>{input.absence.health='timeout';},input=>{input.absence.nativeDaemonCount=1;},input=>{input.absence.healthListenerCount=1;},input=>{input.absence.stopped=true;},input=>{input.installation.build='0'.repeat(64);},input=>{input.absence.checkedAt=f.stamp(-300000);},input=>{input.absence.checkedAt=new Date(Date.now()+30000).toISOString();}]){const input=structuredClone(original);edit(input);assert.throws(()=>f.service.prepare(f.actionId,f.credential,input),{code:'BOT_FORCE_ABANDON_ABSENCE_REQUIRED'});}
  const p=f.absentPrepare(),valid=f.absentEvidence(p);
  for(const edit of [e=>{e.currentDaemonAbsence.scope='execution-tree';},e=>{e.currentDaemonAbsence.nativeDaemonCount=1;},e=>{e.currentDaemonAbsence.healthListenerCount=1;},e=>{e.currentDaemonAbsence.health='unknown';},e=>{e.currentDaemonExit={stopped:true};},e=>{e.localArchive.stateSha256='0'.repeat(64);},e=>{e.quarantineCount=2;}]){const e=structuredClone(valid);edit(e);assert.throws(()=>f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:e}),{code:'BOT_FORCE_ABANDON_EVIDENCE_INVALID'});}
});
test('fresh absence challenge expires strictly, and renewed heartbeat, raw evidence, grant, slot or epoch blocks first commit',async t=>{
  const f=await fixture(t);f.authorize();const p=f.absentPrepare(),e=f.absentEvidence(p),commit=()=>f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:e});
  f.db.prepare('UPDATE devices SET heartbeat_at=? WHERE id=?').run(f.stamp(-1000),f.pair.deviceId);assert.throws(commit,{code:'BOT_FORCE_ABANDON_SUBJECT_CHANGED'});f.db.prepare('UPDATE devices SET heartbeat_at=? WHERE id=?').run(p.subject.serverHeartbeat.heartbeatAt,f.pair.deviceId);
  f.db.prepare('UPDATE devices SET pid=99999 WHERE id=?').run(f.pair.deviceId);assert.throws(commit,{code:'BOT_FORCE_ABANDON_SUBJECT_CHANGED'});f.db.prepare('UPDATE devices SET pid=? WHERE id=?').run(p.subject.serverHeartbeat.pid,f.pair.deviceId);
  f.db.prepare('UPDATE hermes_bots SET control_epoch=9 WHERE employee_id=?').run(f.bot.id);assert.throws(commit,{code:'BOT_FORCE_ABANDON_CONTROL_CONFLICT'});f.db.prepare('UPDATE hermes_bots SET control_epoch=8 WHERE employee_id=?').run(f.bot.id);
  f.db.prepare('UPDATE a2a_actions SET result_json=? WHERE id=?').run(f.rawResult+' ',f.actionId);assert.throws(commit,{code:'BOT_FORCE_ABANDON_SUBJECT_INVALID'});f.db.prepare('UPDATE a2a_actions SET result_json=? WHERE id=?').run(f.rawResult,f.actionId);
  f.advance(120001);assert.throws(commit,{code:'BOT_FORCE_ABANDON_CHALLENGE_EXPIRED'});const renewed=f.absentPrepare();assert(f.service.commit(f.actionId,f.credential,{challenge:renewed.challenge,evidence:f.absentEvidence(renewed)}).receipt);
});
test('schema2 repeated evidence and read proof survive later active, build and profile changes but reject altered evidence and false exit',async t=>{
  const f=await fixture(t);f.authorize();const p=f.absentPrepare(),e=f.absentEvidence(p),first=f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:e});f.advance(500000);
  f.db.prepare("UPDATE hermes_bots SET control_epoch=12,revision=4,active_action_id='other-new-action',control_state='active' WHERE employee_id=?").run(f.bot.id);f.db.prepare("UPDATE employees SET runtime_profile='another-profile',status='active' WHERE id=?").run(f.bot.id);f.db.prepare('UPDATE devices SET client_build=?,pid=55555,heartbeat_at=? WHERE id=?').run('0'.repeat(64),new Date().toISOString(),f.pair.deviceId);
  assert.deepEqual(f.reader(),first.receipt);assert.deepEqual(f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:e}),first);assert.deepEqual(f.service.prepare(f.actionId,f.credential,{holder:null}),{applicable:true,completed:true,receipt:first.receipt});assert.equal(f.db.prepare('SELECT active_action_id FROM hermes_bots WHERE employee_id=?').get(f.bot.id).active_action_id,'other-new-action');
  const changed=structuredClone(e);changed.localArchive.startedSha256='0'.repeat(64);assert.throws(()=>f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:changed}),{code:'BOT_FORCE_ABANDON_IDEMPOTENCY_CONFLICT'});
  const event=f.db.prepare('SELECT * FROM a2a_action_events WHERE id=?').get(`action-event_${first.receipt.id}`),data=JSON.parse(event.data_json);data.receipt.currentDaemonExit={scope:'daemon-root-only',stopped:true};f.db.prepare('UPDATE a2a_action_events SET data_json=? WHERE id=?').run(JSON.stringify(data),event.id);assert.equal(f.reader(),null);
});
test('schema variants cannot substitute each other and malformed mixed subjects return false rather than throw',async t=>{
  const f=await fixture(t);f.authorize();const old=f.prepare(),p=f.absentPrepare(),v1=f.evidence(old),v2=f.absentEvidence(p);
  assert.equal(f.contract.validateForceAbandonEvidence(v1,p.subject),false);assert.equal(f.contract.validateForceAbandonEvidence(v2,old.subject),false);
  assert.throws(()=>f.service.commit(f.actionId,f.credential,{challenge:old.challenge,evidence:v2}),{code:'BOT_FORCE_ABANDON_EVIDENCE_INVALID'});assert.throws(()=>f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:v1}),{code:'BOT_FORCE_ABANDON_EVIDENCE_INVALID'});
  const {receipt}=f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:v2}),wrong={...receipt,schemaVersion:1};assert.equal(f.contract.validateForceAbandonReceipt(wrong),false);
  const forged=structuredClone(receipt);forged.subject.holder={pid:123};assert.equal(f.contract.validateForceAbandonReceipt(forged),false);
});
test('real device HTTP schema2 permits only the fixed original paired identity and actual grant, preserving original row bytes',async t=>{
  const f=await fixture(t),previous=process.env.ZIWEI_A2A_TOKEN;process.env.ZIWEI_A2A_TOKEN=secret;t.after(()=>{if(previous===undefined)delete process.env.ZIWEI_A2A_TOKEN;else process.env.ZIWEI_A2A_TOKEN=previous;});const app=await f.app(),base=`/a2a/v1/actions/${f.actionId}/force-abandon/`;
  assert.equal((await request(app,base+'prepare',{body:f.absentInput()})).status,401);assert.deepEqual((await request(app,base+'prepare',{token:f.pair.deviceToken,body:f.absentInput()})).body,{applicable:false});f.authorize();const prepared=await request(app,base+'prepare',{token:f.pair.deviceToken,body:f.absentInput()});assert.equal(prepared.status,200,JSON.stringify(prepared.body));const evidence=f.absentEvidence(prepared.body);evidence.currentDaemonAbsence.checkedAt=new Date().toISOString();const result=await request(app,base+'commit',{token:f.pair.deviceToken,body:{challenge:prepared.body.challenge,evidence}});assert.equal(result.status,200,JSON.stringify(result.body));assert(f.contract.validateForceAbandonReceipt(result.body.receipt));assert.deepEqual(f.reader(),result.body.receipt);assert.deepEqual(f.db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(f.actionId),f.raw);
});

// This protocol regression uses the real server factory, device-token verifier,
// delivery journal writer, helper and strict receipt reader. Native Windows
// absence observation is injected; no socket is opened or process terminated.
async function skewedClockProtocol(t,{offset,blocked=false}){
  const f=await fixture(t),installed=path.join(fs.realpathSync(f.directory),'installed'),runtime=path.join(installed,'.local/runtime'),configPath=path.join(installed,'data/ziwei_user.json'),write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));};
  const config={apiBase:'https://force-protocol.fixture',workspace:f.ws.slug,deviceId:f.pair.deviceId,deviceToken:f.pair.deviceToken,healthPort:20242};
  write(configPath,config);write(path.join(installed,'package.json'),{name:'ziwei',fixture:true});fs.mkdirSync(path.join(installed,'src'));fs.mkdirSync(path.join(installed,'daemon'));fs.writeFileSync(path.join(installed,'src/fixture.mjs'),'// immutable installed fixture\n');fs.writeFileSync(path.join(installed,'daemon/ziwei_user.mjs'),'// immutable installed fixture daemon\n');
  const {payload_json:_payload,result_json:_result,...row}=f.raw,payload=JSON.parse(f.rawPayload),{managementMcp:_management,...rest}=payload,action={...row,payload:{...rest,managementMcp:{enabled:true,workspace:f.ws.slug}}};
  const originalStarted={key:action.dedupe_key,actionId:action.id,startedAt:Date.parse(f.stamp(1500)),nativeRuntime:true,identity:{workspace:f.ws.slug,deviceId:f.pair.deviceId,workspaceId:f.ws.id,targetDeviceId:f.pair.deviceId},resourceBinding:{type:action.type,employeeId:f.bot.id,revision:3,controlEpoch:5,resource:null,operation:null,platform:null},quarantine:{reason:'EXECUTOR_WITHOUT_EXIT_EVIDENCE',stopConfirmed:false,recordedAt:Date.parse(f.stamp(2500))}},otherStarted={key:'other-completed-history',actionId:'other-completed-history',startedAt:Date.parse(f.stamp(0)),identity:{workspace:f.ws.slug,deviceId:f.pair.deviceId}},otherCompleted={key:otherStarted.key,identity:otherStarted.identity,result:{status:'succeeded',actionId:otherStarted.actionId,completedAt:Date.parse(f.stamp(500)),result:{output:'preserve this history'}}},state={version:2,updatedAt:f.stamp(2500),started:[otherStarted,originalStarted],completed:[otherCompleted]},statePath=path.join(runtime,'action-state.json');write(statePath,state);
  const deliveryDir=path.join(runtime,'action-delivery'),base=bytesDigest(JSON.stringify(f.actionId)),journalPath=path.join(deliveryDir,base+'.json'),actionPath=path.join(deliveryDir,base+'.action.json'),resultPath=path.join(deliveryDir,base+'.result.json');let executions=0;
  const delivery=createActionDelivery({directory:deliveryDir,identity:{apiBase:config.apiBase,workspace:f.ws.slug,deviceId:f.pair.deviceId},now:f.clockNow,retryDelays:[],post:async route=>{
    if(route.endsWith('/ack'))return{id:f.actionId,status:'acked',deviceId:f.pair.deviceId,acked_at:f.raw.acked_at,expires_at:new Date(f.clockNow()+86400000).toISOString()};
    if(route.endsWith('/events'))return{};
    if(route.endsWith('/result'))throw Object.assign(new Error('fixture original result delivery was not acknowledged'),blocked?{status:409}:{});
    throw new Error('Unexpected original delivery fixture route');
  },dispatch:async()=>{executions++;return{status:'failed',actionId:f.actionId,error:POLICY.originalError,code:'EXECUTION_UNCERTAIN',executionState:'uncertain',reason:POLICY.originalResult.reason,result:{processExit:null,partialEffectsPossible:true}};}});
  await assert.rejects(delivery.execute(action));await delivery.whenIdle();assert.equal(executions,1);
  const journal=JSON.parse(fs.readFileSync(journalPath));assert.equal(journal.state,blocked?'blocked':'result_pending');assert.equal(journal.retainEvidence,true);assert.equal(journal.dispatcherStatus,'failed');assert.equal(Object.hasOwn(journal,'serverStatus'),false);
  const originals=new Map([['action-state',statePath],['delivery-journal',journalPath],['delivery-action',actionPath],['delivery-result',resultPath]].map(([role,file])=>[role,fs.readFileSync(file)])),helperFile=path.join(f.directory,'real-helper.mjs');
  const helperSource=fs.readFileSync(path.join(root,'scripts/client-force-abandon-recovery.mjs'),'utf8').replace(/from (['"])([^'"]+)\1/g,(_all,q,specifier)=>`from ${q}${specifier==='../src/bot-force-abandon-contract.mjs'?pathToFileURL(f.contractFile).href:specifier.startsWith('.')?new URL(specifier,pathToFileURL(path.join(root,'scripts/client-force-abandon-recovery.mjs'))).href:specifier}${q}`);fs.writeFileSync(helperFile,helperSource);const helper=await import(pathToFileURL(helperFile));
  const observed=[];let mono=0,commits=0,nativeObservations=0;const advance=ms=>{mono+=ms;f.advance(ms);};
  const fetchImpl=async(url,options={})=>{
    advance(25);if(url.endsWith('/healthz'))throw Object.assign(new Error('no local holder'),{cause:{code:'ECONNREFUSED'}});
    assert.equal(new URL(url).origin,config.apiBase);assert.equal(options.method,'POST');
    const credential=f.repo.authenticateDeviceToken(options.headers['x-ziwei-device-token']);assert(credential,'the actual repository must authenticate the actual paired device token');const body=JSON.parse(options.body);let status=200,value;
    try{
      if(url.endsWith('/prepare'))value=f.service.prepare(f.actionId,credential,body);
      else if(url.endsWith('/commit')){commits++;value=f.service.commit(f.actionId,credential,body);}
      else throw Error('Unexpected force protocol route');
    }catch(error){status=error.status||500;value={error:error.message,code:error.code};}
    observed.push({operation:url.split('/').at(-1),status,code:value.code??null,body,serverAt:f.clockNow(),issuedAt:value.expiresAt?Date.parse(value.expiresAt)-f.contract.BOT_FORCE_ABANDON_TTL_MS:null});
    return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json',Date:new Date(f.clockNow()).toUTCString()}});
  };
  f.authorize();const recover=helper.createForceAbandonRecovery({platform:'win32',installedBuild:()=>POLICY.holderBuild,now:()=>f.clockNow()+offset,monotonicNow:()=>mono,inspectInstalledProcesses:async()=>{nativeObservations++;advance(5);return[];},inspectListenerCount:async()=>{advance(5);return 0;},terminate:async()=>{throw Error('An absent holder must never be terminated');}});
  const recovered=await recover({root:installed,env:{},configPath,fetchImpl});assert.equal(recovered.recovered,true);assert.equal(recovered.currentDaemonAbsent,true);assert.equal(recovered.stopped,false);assert.equal(recovered.wasRunning,false);assert.equal(recovered.executionConfirmedStopped,false);assert.equal(commits,1);assert(nativeObservations>=2);
  assert.deepEqual(observed.map(row=>[row.operation,row.status]),[['prepare',409],['prepare',200],['commit',200]]);assert.equal(observed[0].code,'BOT_FORCE_ABANDON_HOLDER_REQUIRED');
  const receipt=f.reader();assert(receipt);assert.equal(receipt.schemaVersion,2);assert.equal(receipt.executionState,'uncertain');assert.equal(receipt.partialEffectsPossible,true);assert.equal(receipt.executionConfirmedStopped,false);assert.equal(receipt.currentDaemonAbsence.state,'absent');assert.equal(Object.hasOwn(receipt,'currentDaemonExit'),false);assert.equal(Object.hasOwn(receipt,'processExit'),false);
  assert.deepEqual({...f.db.prepare('SELECT revision,control_epoch,control_state,active_action_id FROM hermes_bots WHERE employee_id=?').get(f.bot.id)},{revision:3,control_epoch:9,control_state:'paused',active_action_id:null});assert.deepEqual(f.db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(f.actionId),f.raw);assert.deepEqual(f.db.prepare('SELECT * FROM a2a_action_events WHERE id=?').get(f.eventId),f.originalEvent);
  const archive=path.join(runtime,'force-abandon',base);for(const [role,bytes]of originals)assert.deepEqual(fs.readFileSync(path.join(archive,role+'.original.json')),bytes,role+' original bytes must be preserved');assert.deepEqual(JSON.parse(fs.readFileSync(statePath)),{...state,started:[otherStarted]});for(const file of[journalPath,actionPath,resultPath])assert.equal(fs.existsSync(file),false);
  assert.equal(observed[1].body.mode,'no_current_daemon');const initialAt=Date.parse(observed[1].body.absence.checkedAt),finalAt=Date.parse(observed[2].body.evidence.currentDaemonAbsence.checkedAt);assert(initialAt<=observed[1].serverAt&&observed[1].serverAt-initialAt<1025,'initial observation follows the Date lower bound plus this request latency');assert(finalAt>=observed[1].issuedAt&&finalAt<=observed[2].serverAt,'the later observation remains inside the real signed server interval');
}
test('real strict backend and real helper recover a pending journal with the client wall clock five minutes fast',async t=>skewedClockProtocol(t,{offset:300000}));
test('real strict backend and real helper recover a blocked journal with the client wall clock five minutes slow',async t=>skewedClockProtocol(t,{offset:-300000,blocked:true}));
