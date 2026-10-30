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
import {createApp} from './app.mjs';
import {botSnapshot} from './bots.mjs';
import {HISTORICAL_PRELAUNCH_POLICY as POLICY,historicalPrelaunchDigest as digest,historicalPrelaunchBytesDigest as bytesDigest,historicalPrelaunchDeliveredPayload} from '../src/bot-historical-prelaunch-policy.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),secret='isolated-historical-recovery-secret-0123456789';
const parse=JSON.parse;
async function request(app,url,{body={},token='',headers={}}={}){
  const socket=new Duplex({read(){},write(_chunk,_encoding,done){done();}}),req=new IncomingMessage(socket),res=new ServerResponse(req),chunks=[],bytes=Buffer.from(JSON.stringify(body));
  req.method='POST';req.url=url;req.headers={host:'prelaunch.fixture','content-type':'application/json','content-length':String(bytes.length),...(token?{'x-ziwei-device-token':token}:{}),...headers};
  try{return await new Promise((resolve,reject)=>{
    res.write=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk,encoding));done?.();return true;};
    res.end=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));done?.();const data=Buffer.concat(chunks);resolve({status:res.statusCode,body:parse(data),cache:res.getHeader('Cache-Control')});res.emit('finish');return res;};
    req.on('error',reject);res.on('error',reject);app.handle(req,res,error=>reject(error||new Error('Unhandled in-memory request')));req.push(bytes);req.push(null);
  });}finally{socket.destroy();}
}
function dataFixture(t){
  const repo=createRepository({memory:true}),db=repo.db,bots=createManagementService(repo).bots;
  t.after(()=>db.close());
  const pair=repo.claimDevicePairing({code:repo.createDevicePairing('test-111',{name:'Recovery fixture'}).code});
  repo.heartbeatDevice('test-111',{deviceId:pair.deviceId,runtimes:{Hermes:{status:'available',version:'0.22.0',profiles:[{name:'default'}],models:[{id:'fixture'}]}}});
  const bot=bots.create('test-111',{name:'Historical fixture',targetDeviceId:pair.deviceId,runtimeProfile:'default',idempotencyKey:'create'}),ws=repo.getWorkspace('test-111');
  db.prepare("UPDATE hermes_bots SET revision=3,control_epoch=5 WHERE employee_id=?").run(bot.id);
  const snapshot=botSnapshot(db,bot.id,ws.id),actionId='action_historical-fixture',eventId='action-event_original-failure',time=Date.now()-90_000,stamp=n=>new Date(time+n).toISOString();
  const payload={runtime:'Hermes',deviceId:pair.deviceId,employeeId:bot.id,profile:snapshot.sourceProfile,conversationId:snapshot.conversationId,prompt:'private fixture prompt must not be returned',managementMcp:{enabled:true,workspace:ws.slug},unknownPreserved:{keep:true},hermesBot:snapshot};
  const result=structuredClone(POLICY.originalResult),error=POLICY.error,eventData={error,result},rawPayload=JSON.stringify(payload),rawResult=JSON.stringify(result),rawEvent=JSON.stringify(eventData);
  db.prepare('INSERT INTO a2a_actions(id,workspace_id,agent_id,type,payload_json,dedupe_key,status,created_at,acked_at,completed_at,result_json,error) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(actionId,ws.id,'ziwei_user','conversation.execute',rawPayload,'historical-fixture-key','acked',stamp(0),stamp(1000),stamp(3000),rawResult,error);
  const deliveredPayload=repo.listA2AActions(ws.slug,{status:'all',includeAcked:true,executionDelivery:true,deviceId:pair.deviceId}).find(action=>action.id===actionId).payload;
  db.prepare("UPDATE a2a_actions SET status='failed' WHERE id=?").run(actionId);
  db.prepare('INSERT INTO a2a_action_events(id,action_id,type,message,data_json,created_at) VALUES(?,?,?,?,?,?)').run(eventId,actionId,'failed','Original retained message',rawEvent,stamp(2000));
  db.prepare("UPDATE hermes_bots SET active_action_id=?,control_state='paused',control_epoch=8 WHERE employee_id=?").run(actionId,bot.id);
  db.prepare("UPDATE employees SET status='paused' WHERE id=?").run(bot.id);
  const credential=repo.authenticateDeviceToken(pair.deviceToken),raw=db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(actionId);
  return{repo,db,bots,bot,ws,pair,credential,actionId,eventId,stamp,time,rawPayload,rawResult,rawEvent,raw,deliveredPayload};
}
async function compiledFixture(t){
  const f=dataFixture(t),directory=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-historical-recovery-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  // Production has no request/env/constructor policy override. Compile the same
  // implementation against synthetic source pins in an isolated fixture module.
  const fixturePolicy={...POLICY,enabled:true,sourceBuild:'a'.repeat(64),sourceFiles:{'src/hermes-runtime.mjs':'b'.repeat(64)},auditedSubject:{originalRevision:3,originalControlEpoch:5,currentRevision:3,currentControlEpoch:8,actionId:f.actionId,workspace:'test-111',workspaceId:f.ws.id,deviceId:f.pair.deviceId,employeeId:f.bot.id,profile:f.rawPayload?parse(f.rawPayload).profile:null,originalPayloadSha256:bytesDigest(f.rawPayload),originalResultSha256:bytesDigest(f.rawResult),failedEventId:f.eventId,failedEventDataSha256:bytesDigest(f.rawEvent)}};
  const policyFile=path.join(directory,'policy.mjs'),recoveryFile=path.join(directory,'recovery.mjs'),appFile=path.join(directory,'app.mjs'),viewFile=path.join(directory,'view.mjs'),botsFile=path.join(directory,'bots.mjs'),capsFile=path.join(directory,'caps.mjs');
  let policySource=fs.readFileSync(path.join(root,'src/bot-historical-prelaunch-policy.mjs'),'utf8');
  const start=policySource.indexOf('export const HISTORICAL_PRELAUNCH_POLICY='),end=policySource.indexOf('\nexport const HISTORICAL_PRELAUNCH_POLICY_DIGEST=',start);
  assert(start>=0&&end>start);policySource=policySource.slice(0,start)+`export const HISTORICAL_PRELAUNCH_POLICY=freeze(${JSON.stringify(fixturePolicy)});`+policySource.slice(end);fs.writeFileSync(policyFile,policySource);
  function imports(source,base){return source.replace(/from (['"])([^'"]+)\1/g,(_full,quote,specifier)=>{
    const target=specifier==='../src/bot-historical-prelaunch-policy.mjs'?pathToFileURL(policyFile).href:specifier==='./bot-historical-recovery.mjs'?pathToFileURL(recoveryFile).href:specifier==='./bot-historical-recovery-view.mjs'?pathToFileURL(viewFile).href:specifier==='./bot-capabilities.mjs'?pathToFileURL(capsFile).href:specifier.startsWith('.')?new URL(specifier,base).href:specifier.startsWith('node:')?specifier:import.meta.resolve(specifier);
    return`from ${quote}${target}${quote}`;
  });}
  fs.writeFileSync(viewFile,imports(fs.readFileSync(path.join(root,'backend/bot-historical-recovery-view.mjs'),'utf8'),pathToFileURL(path.join(root,'backend/bot-historical-recovery-view.mjs'))));
  fs.writeFileSync(capsFile,imports(fs.readFileSync(path.join(root,'backend/bot-capabilities.mjs'),'utf8'),pathToFileURL(path.join(root,'backend/bot-capabilities.mjs'))));
  fs.writeFileSync(botsFile,imports(fs.readFileSync(path.join(root,'backend/bots.mjs'),'utf8'),pathToFileURL(path.join(root,'backend/bots.mjs'))));
  fs.writeFileSync(recoveryFile,imports(fs.readFileSync(path.join(root,'backend/bot-historical-recovery.mjs'),'utf8'),pathToFileURL(path.join(root,'backend/bot-historical-recovery.mjs'))));
  fs.writeFileSync(appFile,imports(fs.readFileSync(path.join(root,'backend/app.mjs'),'utf8'),pathToFileURL(path.join(root,'backend/app.mjs'))));
  const {createBotHistoricalRecovery}=await import(pathToFileURL(recoveryFile)),policy=await import(pathToFileURL(policyFile));
  let clock=Date.now();const service=createBotHistoricalRecovery(f.repo,{readA2AToken:()=>secret,now:()=>clock});
  const prepared=()=>service.prepare(f.actionId,f.credential,{});
  const evidence=challenge=>({schemaVersion:1,policy:fixturePolicy.id,sourceBuild:fixturePolicy.sourceBuild,sourcePolicyDigest:policy.HISTORICAL_PRELAUNCH_POLICY_DIGEST,subjectDigest:challenge.subjectDigest,daemonExit:{stopped:true,pid:41001,creationTime:f.stamp(-1000),exitedAt:f.stamp(4000)},localEvidence:{sourceFiles:Object.entries(fixturePolicy.sourceFiles).map(([path,sha256])=>({path,sha256})),quarantine:{actionId:f.actionId,dedupeKey:'historical-fixture-key',startedAt:f.time+1500,startedSha256:'1'.repeat(64),stateSha256:'2'.repeat(64),deliverySha256:'3'.repeat(64),actionSha256:'4'.repeat(64),resultSha256:'5'.repeat(64),serverResultDigest:challenge.subject.originalWireBodyDigest},noSupervision:true,quarantineCount:1}});
  return{...f,service,prepared,evidence,policy,appModule:()=>import(pathToFileURL(appFile)),viewModule:()=>import(pathToFileURL(viewFile)),botsModule:()=>import(pathToFileURL(botsFile)),capsModule:()=>import(pathToFileURL(capsFile)),advance:n=>{clock+=n;}};
}

test('production pinned policy stays closed for an unaudited historical action and body claims cannot grant device identity',async t=>{
  const f=dataFixture(t),app=createApp({memory:true,requireAuth:true,requireDeviceAuth:true,repository:f.repo,publicApiBase:'https://ziwei.fixture.invalid',enableScheduler:false});
  const url=`/a2a/v1/actions/${f.actionId}/prelaunch-recovery/prepare`,before=f.db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(f.actionId);
  const denied=await request(app,url,{body:{credentialId:f.credential.credentialId,deviceCredential:f.credential}});assert.equal(denied.status,401);
  const authenticated=await request(app,url,{token:f.pair.deviceToken});assert.equal(authenticated.status,409);assert.equal(authenticated.body.code,'BOT_PRELAUNCH_POLICY_UNAVAILABLE');
  assert.deepEqual(f.db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(f.actionId),before);
});

test('prepared challenge contains only immutable identity and failure proof; real device HTTP completes once without dispatch',async t=>{
  const f=await compiledFixture(t),{createApp}=await f.appModule(),app=createApp({memory:true,requireAuth:true,requireDeviceAuth:true,repository:f.repo,publicApiBase:'https://ziwei.fixture.invalid',enableScheduler:false});
  const oldSecret=process.env.ZIWEI_A2A_TOKEN;process.env.ZIWEI_A2A_TOKEN=secret;t.after(()=>{if(oldSecret===undefined)delete process.env.ZIWEI_A2A_TOKEN;else process.env.ZIWEI_A2A_TOKEN=oldSecret;});
  const base=`/a2a/v1/actions/${f.actionId}/prelaunch-recovery/`,counts=()=>({actions:f.db.prepare('SELECT count(*) n FROM a2a_actions').get().n,messages:f.db.prepare('SELECT count(*) n FROM conversation_messages').get().n}),before=counts(),originalEvent=f.db.prepare('SELECT * FROM a2a_action_events WHERE id=?').get(f.eventId);
  const p=await request(app,base+'prepare',{token:f.pair.deviceToken});assert.equal(p.status,200);assert.equal(p.cache,'no-store');assert(!JSON.stringify(p.body).includes('private fixture prompt'));assert.equal(p.body.subject.currentControlEpoch,8);assert.equal(p.body.subject.originalControlEpoch,5);
  const e=f.evidence(p.body),commit=await request(app,base+'commit',{token:f.pair.deviceToken,body:{challenge:p.body.challenge,evidence:e}});assert.equal(commit.status,200);assert(f.policy.validateHistoricalPrelaunchReceipt(commit.body.receipt,{actionId:f.actionId,subject:p.body.subject,evidenceDigest:digest(e)}));
  const row=f.db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(f.actionId),bot=f.db.prepare('SELECT * FROM hermes_bots WHERE employee_id=?').get(f.bot.id);
  assert.equal(row.status,'failed');assert.equal(row.payload_json,f.rawPayload);assert.equal(row.error,POLICY.error);assert.deepEqual(row,f.raw);assert.equal(commit.body.receipt.executionState,'not_started');assert.equal(commit.body.receipt.admissionProof.launched,false);assert.equal(commit.body.receipt.admissionProof.partialEffectsPossible,true);assert.equal(Object.hasOwn(commit.body.receipt,'processExit'),false);assert.equal(bot.active_action_id,null);assert.equal(bot.control_state,'paused');assert.equal(bot.revision,3);assert.equal(bot.control_epoch,8);assert.deepEqual(counts(),before);assert.deepEqual(f.db.prepare('SELECT * FROM a2a_action_events WHERE id=?').get(f.eventId),originalEvent);
  const again=await request(app,base+'commit',{token:f.pair.deviceToken,body:{challenge:p.body.challenge,evidence:e}});assert.equal(again.status,200);assert.deepEqual(again.body,commit.body);
  const resumed=await request(app,base+'prepare',{token:f.pair.deviceToken});assert.equal(resumed.body.recovered,true);assert.deepEqual(resumed.body.receipt,commit.body.receipt);
});

test('challenge binds signature, lifetime, exact credential and the current paused epoch',async t=>{
  const f=await compiledFixture(t),p=f.prepared(),e=f.evidence(p);
  assert.throws(()=>f.service.commit(f.actionId,f.credential,{challenge:p.challenge.slice(0,-1)+(p.challenge.endsWith('A')?'B':'A'),evidence:e}),{code:'BOT_PRELAUNCH_CHALLENGE_INVALID'});
  const other=f.repo.claimDevicePairing({code:f.repo.createDevicePairing('test-111',{name:'Other computer'}).code}),otherCredential=f.repo.authenticateDeviceToken(other.deviceToken);
  assert.throws(()=>f.service.commit(f.actionId,otherCredential,{challenge:p.challenge,evidence:e}),{code:'BOT_PRELAUNCH_BINDING_CONFLICT'});
  f.db.prepare('UPDATE hermes_bots SET control_epoch=9 WHERE employee_id=?').run(f.bot.id);
  assert.throws(()=>f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:e}),{code:'BOT_PRELAUNCH_SUBJECT_CHANGED'});
  f.db.prepare('UPDATE hermes_bots SET control_epoch=8 WHERE employee_id=?').run(f.bot.id);f.advance(120_001);
  assert.throws(()=>f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:e}),{code:'BOT_PRELAUNCH_CHALLENGE_EXPIRED'});
});

test('same evidence retry is immutable after expiry and later Bot edits; changed evidence cannot overwrite the original receipt',async t=>{
  const f=await compiledFixture(t),p=f.prepared(),e=f.evidence(p),first=f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:e});f.advance(120_001);
  assert.deepEqual(f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:e}),first);
  const changed=structuredClone(e);changed.localEvidence.quarantine.stateSha256='9'.repeat(64);
  assert.throws(()=>f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:changed}),{code:'BOT_PRELAUNCH_IDEMPOTENCY_CONFLICT'});
  f.db.prepare("UPDATE hermes_bots SET active_action_id='another-inflight-action' WHERE employee_id=?").run(f.bot.id);
  f.db.prepare("UPDATE hermes_bots SET revision=4,control_epoch=9,control_state='active' WHERE employee_id=?").run(f.bot.id);f.db.prepare("UPDATE employees SET status='active' WHERE id=?").run(f.bot.id);
  assert.deepEqual(f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:e}),first);
  assert.deepEqual(f.service.prepare(f.actionId,f.credential,{}),{recovered:true,receipt:first.receipt});
  assert.equal(f.db.prepare('SELECT active_action_id FROM hermes_bots WHERE employee_id=?').get(f.bot.id).active_action_id,'another-inflight-action');
});

test('no generic prelaunch flag substitutes for pinned source, original failure, unique quarantine and exact daemon exit',async t=>{
  const f=await compiledFixture(t),p=f.prepared(),valid=f.evidence(p);
  for(const change of [e=>{e.localEvidence.noSupervision=false;},e=>{e.localEvidence.quarantineCount=2;},e=>{e.localEvidence.sourceFiles[0].sha256='0'.repeat(64);},e=>{e.daemonExit.stopped=false;},e=>{e.daemonExit.creationTime=f.stamp(1600);},e=>{e.localEvidence.quarantine.serverResultDigest='0'.repeat(64);},e=>{e.localEvidence.quarantine.actionId='another-action';},e=>{e.prelaunch=true;}]){
    const e=structuredClone(valid);change(e);assert.throws(()=>f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:e}));
  }
  f.db.prepare("UPDATE a2a_actions SET error='another runtime failed' WHERE id=?").run(f.actionId);assert.throws(()=>f.prepared(),{code:'BOT_PRELAUNCH_ORIGINAL_FAILURE_REQUIRED'});
  f.db.prepare('UPDATE a2a_actions SET error=? WHERE id=?').run(POLICY.error,f.actionId);
  f.db.prepare('UPDATE a2a_action_events SET data_json=? WHERE id=?').run(JSON.stringify({error:POLICY.error,result:{...POLICY.originalResult,processExit:{launched:true,rootPid:100}}}),f.eventId);assert.throws(()=>f.prepared(),{code:'BOT_PRELAUNCH_ORIGINAL_FAILURE_REQUIRED'});
  assert.equal(f.db.prepare('SELECT active_action_id FROM hermes_bots WHERE employee_id=?').get(f.bot.id).active_action_id,f.actionId);
});

test('V2 admission blocks recovery and durable marker failure rolls back the active slot and new audit event',async t=>{
  const f=await compiledFixture(t),p=f.prepared(),e=f.evidence(p),before=f.db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(f.actionId),events=f.db.prepare('SELECT count(*) n FROM a2a_action_events WHERE action_id=?').get(f.actionId).n;
  f.db.function('ziwei_v2_admitted',_actionId=>0);
  assert.throws(()=>f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:e}),{code:'V2_OBJECT_SEALED'});
  f.db.function('ziwei_v2_admitted',_actionId=>1);
  f.db.exec("CREATE TRIGGER fixture_recovery_marker_failure BEFORE INSERT ON management_requests WHEN NEW.kind='bot-historical-prelaunch-recovery-v1' BEGIN SELECT RAISE(ABORT,'fixture marker unavailable'); END");
  assert.throws(()=>f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:e}),/fixture marker unavailable/);
  assert.equal(f.db.prepare('SELECT active_action_id FROM hermes_bots WHERE employee_id=?').get(f.bot.id).active_action_id,f.actionId);
  assert.equal(f.db.prepare('SELECT count(*) n FROM a2a_action_events WHERE action_id=?').get(f.actionId).n,events);
  assert.deepEqual(f.db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(f.actionId),before);
  f.db.exec('DROP TRIGGER fixture_recovery_marker_failure');assert(f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:e}).receipt);
});

test('profile ownership, current active slot and conflicting terminal events fail closed before a challenge is issued',async t=>{
  const f=await compiledFixture(t),binding=f.db.prepare('SELECT profile_binding_json FROM hermes_bots WHERE employee_id=?').get(f.bot.id).profile_binding_json;
  f.db.prepare('UPDATE hermes_bots SET profile_binding_json=? WHERE employee_id=?').run(JSON.stringify({...parse(binding),ownershipId:'changed-owner'}),f.bot.id);
  assert.throws(()=>f.prepared(),{code:'BOT_PRELAUNCH_BINDING_CONFLICT'});f.db.prepare('UPDATE hermes_bots SET profile_binding_json=? WHERE employee_id=?').run(binding,f.bot.id);
  f.db.prepare("UPDATE hermes_bots SET active_action_id='other-active' WHERE employee_id=?").run(f.bot.id);assert.throws(()=>f.prepared(),{code:'BOT_PRELAUNCH_CONTROL_CONFLICT'});
  f.db.prepare('UPDATE hermes_bots SET active_action_id=? WHERE employee_id=?').run(f.actionId,f.bot.id);
  f.db.prepare('INSERT INTO employee_template_instances(id,workspace_id,owner_user_id,employee_id,template_id,origin,initial_config_hash,created_at) VALUES(?,?,?,?,?,?,?,?)').run('creator-fixture',f.ws.id,'fixture-owner',f.bot.id,'ziwei-employee-creator','template','0'.repeat(64),f.stamp(0));
  assert.throws(()=>f.prepared(),{code:'BOT_PRELAUNCH_POLICY_UNAVAILABLE'});f.db.prepare('DELETE FROM employee_template_instances WHERE id=?').run('creator-fixture');
  f.db.prepare('INSERT INTO a2a_action_events(id,action_id,type,message,data_json,created_at) VALUES(?,?,?,?,?,?)').run('unexpected-success',f.actionId,'succeeded','Conflicting event','{}',f.stamp(2500));
  assert.throws(()=>f.prepared(),{code:'BOT_PRELAUNCH_ORIGINAL_FAILURE_REQUIRED'});
});

test('historical read proof rejects altered raw evidence, scope and markers, and survives later Bot control changes',async t=>{
  const f=await compiledFixture(t),{readHistoricalPrelaunchRecovery}=await f.viewModule(),p=f.prepared(),e=f.evidence(p),{receipt}=f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:e}),read=()=>readHistoricalPrelaunchRecovery(f.db,f.db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(f.actionId));
  assert.deepEqual(read(),receipt);
  const recoveryEvent=f.db.prepare('SELECT * FROM a2a_action_events WHERE id=?').get(`action-event_${receipt.id}`),marker=f.db.prepare("SELECT * FROM management_requests WHERE kind='bot-historical-prelaunch-recovery-v1'").get();
  const edits=[
    [()=>f.db.prepare('UPDATE a2a_actions SET payload_json=? WHERE id=?').run(f.rawPayload+' ',f.actionId),()=>f.db.prepare('UPDATE a2a_actions SET payload_json=? WHERE id=?').run(f.rawPayload,f.actionId)],
    [()=>f.db.prepare('UPDATE a2a_actions SET result_json=? WHERE id=?').run(f.rawResult+' ',f.actionId),()=>f.db.prepare('UPDATE a2a_actions SET result_json=? WHERE id=?').run(f.rawResult,f.actionId)],
    [()=>f.db.prepare('UPDATE a2a_action_events SET data_json=? WHERE id=?').run(f.rawEvent+' ',f.eventId),()=>f.db.prepare('UPDATE a2a_action_events SET data_json=? WHERE id=?').run(f.rawEvent,f.eventId)],
    [()=>{const altered=parse(recoveryEvent.data_json);altered.receipt.admissionProof.scope='native-process-tree';f.db.prepare('UPDATE a2a_action_events SET data_json=? WHERE id=?').run(JSON.stringify(altered),recoveryEvent.id);},()=>f.db.prepare('UPDATE a2a_action_events SET data_json=? WHERE id=?').run(recoveryEvent.data_json,recoveryEvent.id)],
    [()=>{const altered=parse(recoveryEvent.data_json);altered.evidence.localEvidence.sourceFiles[0].sha256='0'.repeat(64);f.db.prepare('UPDATE a2a_action_events SET data_json=? WHERE id=?').run(JSON.stringify(altered),recoveryEvent.id);},()=>f.db.prepare('UPDATE a2a_action_events SET data_json=? WHERE id=?').run(recoveryEvent.data_json,recoveryEvent.id)],
    [()=>f.db.prepare('UPDATE management_requests SET fingerprint=? WHERE kind=? AND request_key=?').run('0'.repeat(64),marker.kind,marker.request_key),()=>f.db.prepare('UPDATE management_requests SET fingerprint=? WHERE kind=? AND request_key=?').run(marker.fingerprint,marker.kind,marker.request_key)],
  ];
  for(const [change,restore]of edits){change();assert.equal(read(),null);assert.throws(()=>f.service.prepare(f.actionId,f.credential,{}),{code:'BOT_PRELAUNCH_RECOVERY_CONFLICT'});restore();assert.deepEqual(read(),receipt);}
  f.db.prepare("UPDATE hermes_bots SET revision=4,control_epoch=9,control_state='active' WHERE employee_id=?").run(f.bot.id);
  assert.deepEqual(read(),receipt);
});

test('only positive live-process evidence reserves the Bot slot, while independently verified history still releases recovery',async t=>{
  const f=await compiledFixture(t),{assertBotExecution}=await f.botsModule(),{deriveBotCapabilities}=await f.capsModule(),{readHistoricalPrelaunchRecovery}=await f.viewModule(),options={validation:true,requireProfile:false};
  // A failed action without positive live-process evidence is already released
  // by the immediate-stop policy; it must not keep the Bot slot occupied.
  assert.doesNotThrow(()=>assertBotExecution(f.db,f.ws.id,{employeeId:f.bot.id},options));
  const p=f.prepared(),e=f.evidence(p),{receipt}=f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:e});
  // Even a stale active pointer cannot turn an immutable proved prelaunch back
  // into an unconfirmed model invocation. Unproved actions remain fenced.
  f.db.prepare('UPDATE hermes_bots SET active_action_id=? WHERE employee_id=?').run(f.actionId,f.bot.id);
  assert(assertBotExecution(f.db,f.ws.id,{employeeId:f.bot.id},options));
  const payload=parse(f.rawPayload),action={id:f.actionId,type:'conversation.execute',status:'failed',payload,result:parse(f.rawResult),acked_at:f.raw.acked_at},bot={id:f.bot.id,workspace:'test-111',configuration_state:'initialized',employee:{target_device_id:f.pair.deviceId,runtime_profile:payload.profile,status:'active'},config:{},revision:3,control_epoch:8,control_state:'active',validation:{status:'succeeded',revision:3},instance:{mode:'legacy_private_home'},active_action_id:f.actionId},capabilityInput={bot,device:{id:f.pair.deviceId,status:'online'},runtime:{cli_status:'available',available:true,profiles:[{name:payload.profile}]},capabilities:[{id:'model_provider',label:'模型',status:'available'}],actions:[action],activeAction:action};
  assert.equal(deriveBotCapabilities(capabilityInput).capabilityGate.state,'ready');
  action.prelaunchRecovery=readHistoricalPrelaunchRecovery(f.db,f.raw);assert.deepEqual(action.prelaunchRecovery,receipt);
  const accepted=deriveBotCapabilities(capabilityInput);assert.equal(accepted.capabilityGate.state,'ready');assert.equal(accepted.capabilities[0].state,'needs_check');
  action.prelaunchRecovery={...receipt,admissionProof:{...receipt.admissionProof,scope:'arbitrary-prelaunch'}};assert.equal(deriveBotCapabilities(capabilityInput).capabilityGate.state,'ready');
  f.db.prepare("UPDATE management_requests SET fingerprint='altered' WHERE kind='bot-historical-prelaunch-recovery-v1'").run();assert.doesNotThrow(()=>assertBotExecution(f.db,f.ws.id,{employeeId:f.bot.id},options));
});

test('the signed subject binds the actual ACK poll payload after legacy management metadata reordering',async t=>{
  const f=await compiledFixture(t),rawPayload=parse(f.rawPayload),delivered=f.deliveredPayload;
  assert(Object.keys(rawPayload).indexOf('managementMcp')<Object.keys(rawPayload).indexOf('hermesBot'));
  assert.equal(Object.keys(delivered).at(-1),'managementMcp');
  assert.notEqual(bytesDigest(JSON.stringify(delivered)),bytesDigest(f.rawPayload),'wire property ordering must differ from the immutable stored payload');
  assert.deepEqual(delivered,historicalPrelaunchDeliveredPayload(rawPayload));
  const p=f.prepared(),deliveredDigest=digest(delivered),claim=parse(Buffer.from(p.challenge.split('.')[0],'base64url').toString('utf8'));
  assert.equal(p.subject.originalPayloadSha256,bytesDigest(f.rawPayload));assert.equal(p.subject.originalDeliveredPayloadDigest,deliveredDigest);assert.equal(p.originalDeliveredPayloadDigest,deliveredDigest);assert.equal(claim.subject.originalDeliveredPayloadDigest,deliveredDigest);
  const e=f.evidence(p),{receipt}=f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:e});assert(f.policy.validateHistoricalPrelaunchReceipt(receipt,{subject:p.subject,evidenceDigest:digest(e)}));
  assert.equal(f.db.prepare('SELECT payload_json FROM a2a_actions WHERE id=?').get(f.actionId).payload_json,f.rawPayload);
  const changed=structuredClone(delivered);changed.managementMcp.enabled=false;assert.notEqual(digest(changed),p.subject.originalDeliveredPayloadDigest);changed.managementMcp.enabled=true;changed.employeeInstructions='untrusted injected field';assert.notEqual(digest(changed),p.subject.originalDeliveredPayloadDigest);
});

async function postUpdateFixture(t){
  const f=await compiledFixture(t),post=f.policy.HISTORICAL_POST_UPDATE_HOLDER_POLICY,postDigest=f.policy.HISTORICAL_POST_UPDATE_HOLDER_POLICY_DIGEST;
  f.db.prepare('UPDATE devices SET client_build=?,pid=? WHERE id=?').run(post.maintenanceHolderBuild,62001,f.pair.deviceId);
  const prepare=()=>f.service.prepare(f.actionId,f.credential,{mode:post.mode});
  const evidence=p=>({schemaVersion:2,mode:post.mode,policy:post.id,sourceBuild:post.sourceBuild,sourcePolicyDigest:postDigest,subjectDigest:p.subjectDigest,maintenanceHolderExit:{stopped:true,pid:62001,creationTime:f.stamp(6000),exitedAt:f.stamp(7000)},migrationEvidence:{schemaVersion:1,operation:'update',state:'complete',oldBuild:post.sourceBuild,clientBuild:post.maintenanceHolderBuild,archiveSha256:post.archiveSha256,configurationPreserved:true,restoredRunning:false,finishedAt:f.stamp(5000),updateResultSha256:'6'.repeat(64),backupRoot:'C:\\Users\\fixture\\AppData\\Roaming\\npm\\node_modules\\.ziwei-backup-11111111-2222-4333-8444-555555555555',backupSourceFiles:Object.entries(f.policy.HISTORICAL_PRELAUNCH_POLICY.sourceFiles).map(([path,sha256])=>({path,sha256})),currentSourceFiles:Object.entries(post.currentSourceFiles).map(([path,sha256])=>({path,sha256}))},localEvidence:f.evidence(p).localEvidence});
  return{...f,post,postDigest,postPrepare:prepare,postEvidence:evidence};
}

test('post-update holder proves only maintenance generation exit while preserving the original failure and V1 chronology',async t=>{
  const f=await postUpdateFixture(t),p=f.postPrepare(),e=f.postEvidence(p),{receipt}=f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:e}),{readHistoricalPrelaunchRecovery}=await f.viewModule();
  assert.equal(parse(Buffer.from(p.challenge.split('.')[0],'base64url')).mode,'post_update_holder');assert.equal(p.subject.maintenanceHolderBuild,f.post.maintenanceHolderBuild);assert.equal(p.subject.maintenanceHolderPid,62001);
  assert.equal(receipt.schemaVersion,2);assert.equal(receipt.mode,f.post.mode);assert.equal(receipt.verifiedUpdateFinishedAt,e.migrationEvidence.finishedAt);assert.equal(receipt.migrationEvidenceDigest,digest(e.migrationEvidence));assert.equal(Object.hasOwn(receipt,'daemonExit'),false);assert.equal(Object.hasOwn(receipt,'processExit'),false);assert.equal(receipt.admissionProof.scope,'conversation-runtime-root');
  assert(f.policy.validateHistoricalPrelaunchReceipt(receipt,{subject:p.subject,evidenceDigest:digest(e)}));assert.deepEqual(readHistoricalPrelaunchRecovery(f.db,f.raw),receipt);assert.deepEqual(f.db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(f.actionId),f.raw);assert.equal(f.db.prepare('SELECT active_action_id FROM hermes_bots WHERE employee_id=?').get(f.bot.id).active_action_id,null);
  const oldProof={...receipt,schemaVersion:1,policy:f.policy.HISTORICAL_PRELAUNCH_POLICY.id,sourcePolicyDigest:f.policy.HISTORICAL_PRELAUNCH_POLICY_DIGEST,daemonExit:receipt.maintenanceHolderExit};for(const key of ['mode','maintenanceHolderExit','migrationEvidenceDigest','verifiedUpdateFinishedAt'])delete oldProof[key];assert.equal(f.policy.validateHistoricalPrelaunchReceipt(oldProof),false,'a new maintenance process must never become an original daemon exit proof');
});

test('migration archive, backup sources, current holder identity and separate V1/V2 challenges fail closed',async t=>{
  const f=await postUpdateFixture(t),p=f.postPrepare(),valid=f.postEvidence(p);
  const changes=[e=>{e.migrationEvidence.oldBuild='0'.repeat(64);},e=>{e.migrationEvidence.clientBuild='0'.repeat(64);},e=>{e.migrationEvidence.archiveSha256='0'.repeat(64);},e=>{e.migrationEvidence.configurationPreserved=false;},e=>{e.migrationEvidence.restoredRunning=true;},e=>{e.migrationEvidence.finishedAt=f.stamp(6500);},e=>{e.migrationEvidence.finishedAt=f.stamp(1000);},e=>{e.migrationEvidence.backupRoot='C:\\unrelated\\.ziwei-backup-11111111-2222-4333-8444-555555555555';},e=>{e.migrationEvidence.backupSourceFiles[0].sha256='0'.repeat(64);},e=>{e.migrationEvidence.currentSourceFiles[0].sha256='0'.repeat(64);},e=>{e.maintenanceHolderExit.pid=62002;},e=>{e.maintenanceHolderExit.creationTime=f.stamp(1400);},e=>{e.daemonExit=e.maintenanceHolderExit;delete e.maintenanceHolderExit;}];
  for(const change of changes){const e=structuredClone(valid);change(e);assert.throws(()=>f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:e}),{code:'BOT_PRELAUNCH_MIGRATION_EVIDENCE_INVALID'});}
  assert.throws(()=>f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:f.evidence(p)}),{code:'BOT_PRELAUNCH_MIGRATION_EVIDENCE_INVALID'});
  const v1=f.prepared(),old=f.evidence(v1);old.daemonExit=valid.maintenanceHolderExit;assert.throws(()=>f.service.commit(f.actionId,f.credential,{challenge:v1.challenge,evidence:old}),{code:'BOT_PRELAUNCH_DAEMON_EXIT_REQUIRED'});
  f.db.prepare('UPDATE devices SET pid=62002 WHERE id=?').run(f.pair.deviceId);assert.throws(()=>f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:valid}),{code:'BOT_PRELAUNCH_SUBJECT_CHANGED'});assert.equal(f.db.prepare('SELECT active_action_id FROM hermes_bots WHERE employee_id=?').get(f.bot.id).active_action_id,f.actionId);
});

test('schema2 readback rejects migration tampering and stays idempotent after a new active slot or device generation',async t=>{
  const f=await postUpdateFixture(t),p=f.postPrepare(),e=f.postEvidence(p),first=f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:e}),{readHistoricalPrelaunchRecovery}=await f.viewModule(),event=f.db.prepare('SELECT * FROM a2a_action_events WHERE id=?').get(`action-event_${first.receipt.id}`);
  for(const change of [d=>{d.evidence.migrationEvidence.currentSourceFiles[0].sha256='0'.repeat(64);},d=>{d.evidence.migrationEvidence.finishedAt=f.stamp(6500);},d=>{d.receipt.daemonExit=d.receipt.maintenanceHolderExit;delete d.receipt.maintenanceHolderExit;},d=>{d.receipt.verifiedUpdateFinishedAt=f.stamp(6000);}]){const data=parse(event.data_json);change(data);f.db.prepare('UPDATE a2a_action_events SET data_json=? WHERE id=?').run(JSON.stringify(data),event.id);assert.equal(readHistoricalPrelaunchRecovery(f.db,f.raw),null);f.db.prepare('UPDATE a2a_action_events SET data_json=? WHERE id=?').run(event.data_json,event.id);}
  f.db.prepare("UPDATE hermes_bots SET revision=4,control_epoch=9,control_state='active',active_action_id='new-work' WHERE employee_id=?").run(f.bot.id);f.db.prepare('UPDATE devices SET pid=62003 WHERE id=?').run(f.pair.deviceId);f.advance(120001);
  assert.deepEqual(f.service.prepare(f.actionId,f.credential,{mode:f.post.mode}),{recovered:true,receipt:first.receipt});assert.deepEqual(f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:e}),first);assert.equal(f.db.prepare('SELECT active_action_id FROM hermes_bots WHERE employee_id=?').get(f.bot.id).active_action_id,'new-work');const changed=structuredClone(e);changed.migrationEvidence.updateResultSha256='8'.repeat(64);assert.throws(()=>f.service.commit(f.actionId,f.credential,{challenge:p.challenge,evidence:changed}),{code:'BOT_PRELAUNCH_IDEMPOTENCY_CONFLICT'});
});

test('diagnostics record only bounded enums and can never clear a slot or substitute recovery proof',async t=>{
  const f=await postUpdateFixture(t),input={mode:f.post.mode,phase:'applied',reasonCode:null,holderBuild:f.post.maintenanceHolderBuild,attemptId:'11111111-2222-4333-8444-555555555555'},before=f.db.prepare('SELECT * FROM hermes_bots WHERE employee_id=?').get(f.bot.id),a=f.service.status(f.actionId,f.credential,input),b=f.service.status(f.actionId,f.credential,input);
  assert.deepEqual(a,b);assert.equal(f.db.prepare("SELECT count(*) n FROM a2a_action_events WHERE action_id=? AND type='bot.historical_prelaunch_diagnostic'").get(f.actionId).n,1);assert.deepEqual(f.db.prepare('SELECT * FROM hermes_bots WHERE employee_id=?').get(f.bot.id),before);assert.deepEqual(f.db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(f.actionId),f.raw);assert.equal(f.postPrepare().recovered,false);assert.equal((await f.viewModule()).readHistoricalPrelaunchRecovery(f.db,f.raw),null);
  for(const change of [i=>{i.path='private-path';},i=>{i.reasonCode='PRIVATE raw message';},i=>{i.phase='clear_active';},i=>{i.holderBuild='0'.repeat(64);},i=>{i.mode='force';}]){const i=structuredClone(input);change(i);assert.throws(()=>f.service.status(f.actionId,f.credential,i),{code:'BOT_PRELAUNCH_DIAGNOSTIC_INVALID'});}
});

test('diagnostic HTTP requires the real original device and rejects body identity or another paired device',async t=>{
  const f=await postUpdateFixture(t),{createApp}=await f.appModule(),app=createApp({memory:true,requireAuth:true,requireDeviceAuth:true,repository:f.repo,publicApiBase:'https://ziwei.fixture.invalid',enableScheduler:false}),url=`/a2a/v1/actions/${f.actionId}/prelaunch-recovery/status`,input={mode:f.post.mode,phase:'failed',reasonCode:'EVIDENCE_MISMATCH',holderBuild:f.post.maintenanceHolderBuild,attemptId:'11111111-2222-4333-8444-555555555555'};
  assert.equal((await request(app,url,{body:{...input,deviceCredential:f.credential}})).status,401);const other=f.repo.claimDevicePairing({code:f.repo.createDevicePairing('test-111',{name:'Diagnostic other'}).code});assert.equal((await request(app,url,{token:other.deviceToken,body:input})).status,403);assert.equal((await request(app,url,{token:f.pair.deviceToken,body:{...input,config:{}}})).status,400);const accepted=await request(app,url,{token:f.pair.deviceToken,body:input});assert.equal(accepted.status,200);assert.equal(accepted.body.recorded,true);assert.equal(accepted.cache,'no-store');assert.equal(f.db.prepare('SELECT active_action_id FROM hermes_bots WHERE employee_id=?').get(f.bot.id).active_action_id,f.actionId);
});
