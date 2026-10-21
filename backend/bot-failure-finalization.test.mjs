import test from 'node:test';
import assert from 'node:assert/strict';
import {IncomingMessage,ServerResponse} from 'node:http';
import {Duplex} from 'node:stream';
import {createRepository} from './repository.mjs';
import {createManagementService} from './management.mjs';
import {createAuthService} from './auth.mjs';
import {createApp} from './app.mjs';
import {botSnapshot,assertBotExecution} from './bots.mjs';
import {createBotFailureFinalization,readBotFailureFinalization,pendingBotFailureFinalization} from './bot-failure-finalization.mjs';
import {finalizationDigest,validateFailureFinalizationReceipt} from '../src/bot-failure-finalization-contract.mjs';

// Express is exercised through in-memory HTTP objects: no local listener.
async function request(app,url,{method='POST',body={},token='',cookie=''}={}){
  const socket=new Duplex({read(){},write(_chunk,_encoding,done){done();}}),req=new IncomingMessage(socket),res=new ServerResponse(req),chunks=[],bytes=Buffer.from(JSON.stringify(body));
  req.method=method;req.url=url;req.headers={host:'finalization.fixture','content-type':'application/json','content-length':String(bytes.length),cookie,...(token?{'x-ziwei-device-token':token}:{})};
  try{return await new Promise((resolve,reject)=>{res.write=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk,encoding));done?.();return true;};res.end=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));done?.();resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks)),cache:res.getHeader('Cache-Control')});res.emit('finish');return res;};req.on('error',reject);res.on('error',reject);app.handle(req,res,error=>reject(error||new Error('Unhandled memory request')));req.push(bytes);req.push(null);});}finally{socket.destroy();}
}
function fixture(t,{status='failed',uncertain=true,event=true}={}){
  const repo=createRepository({memory:true}),db=repo.db,auth=createAuthService(db),owner=auth.setup({email:'finalization-owner@fixture.test',password:'finalization-owner-fixture-password'}),ws=repo.getWorkspace('test-111');t.after(()=>db.close());
  db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run('final-owner-member',ws.id,owner.user_id,'Owner','finalization-owner@fixture.test','owner',new Date().toISOString());
  const context={actorUserId:owner.user_id,actorRole:'member'},pair=repo.claimDevicePairing({code:repo.createDevicePairing(ws.slug,{name:'Original'}).code});
  repo.heartbeatDevice(ws.slug,{deviceId:pair.deviceId,runtimes:{Hermes:{status:'available',version:'0.22',profiles:[{name:'default'}]}}});
  const management=createManagementService(repo),bot=management.bots.create(ws.slug,{name:'Failure fixture',targetDeviceId:pair.deviceId,runtimeProfile:'default',idempotencyKey:'create'},context);
  db.prepare("UPDATE hermes_bots SET revision=7,validated_revision=7,control_epoch=25,control_state='active' WHERE employee_id=?").run(bot.id);db.prepare("UPDATE employees SET status='active' WHERE id=?").run(bot.id);
  const snapshot=botSnapshot(db,bot.id,ws.id),actionId='action_finalization-fixture',payload={runtime:'Hermes',deviceId:pair.deviceId,employeeId:bot.id,profile:snapshot.sourceProfile,prompt:'secret prompt must not be exposed in receipt',hermesBot:snapshot},result=uncertain?{code:'EXECUTION_UNCERTAIN',executionState:'uncertain',reason:'EXECUTOR_WITHOUT_EXIT_EVIDENCE',result:{processExit:null,partialEffectsPossible:true}}:{code:1,processExit:{launched:true,rootConfirmed:true,rootPid:123,rootExitCode:1,treeConfirmed:true,activeProcesses:0}},error='Original failure',stamp=n=>new Date(Date.now()-60000+n).toISOString();
  db.prepare('INSERT INTO a2a_actions(id,workspace_id,agent_id,type,payload_json,dedupe_key,status,created_at,acked_at,completed_at,result_json,error) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(actionId,ws.id,'ziwei_user','conversation.execute',JSON.stringify(payload),'original-dedupe',status,stamp(0),stamp(1000),status==='failed'?stamp(3000):null,status==='failed'?JSON.stringify(result):null,status==='failed'?error:null);
  if(event)db.prepare('INSERT INTO a2a_action_events(id,action_id,type,message,data_json,created_at) VALUES(?,?,?,?,?,?)').run('event_original',actionId,'failed','Original failure',JSON.stringify({error,result}),stamp(2000));
  db.prepare('UPDATE hermes_bots SET active_action_id=? WHERE employee_id=?').run(actionId,bot.id);
  const service=createBotFailureFinalization(repo,management),credential=repo.authenticateDeviceToken(pair.deviceToken),input={expectedActionId:actionId,expectedRevision:7,expectedControlEpoch:25,acknowledgeUncertain:true,idempotencyKey:'finalize-once'},raw=()=>db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(actionId),read=()=>readBotFailureFinalization(db,raw()),finalize=()=>service.finalize(ws.slug,bot.id,input,context),ack=value=>({receiptId:value.receipt.id,receiptDigest:value.receiptDigest,archiveSha256:'a'.repeat(64),localProcessDisposition:'unobservable'}),admit=()=>assertBotExecution(db,ws.id,{employeeId:bot.id},{requireProfile:false});
  return{repo,db,auth,owner,ws,pair,context,bot,service,credential,input,raw,read,finalize,ack,admit,result,error,app:()=>createApp({memory:true,requireAuth:true,requireDeviceAuth:true,repository:repo,enableScheduler:false})};
}

test('owner ends only the exact failed slot without changing its result, profile, state or messages',t=>{
  const f=fixture(t),original=f.raw(),event=f.db.prepare("SELECT * FROM a2a_action_events WHERE id='event_original'").get(),messages=f.db.prepare('SELECT count(*) n FROM conversation_messages').get().n,profile=f.db.prepare('SELECT runtime_profile FROM employees WHERE id=?').get(f.bot.id),value=f.finalize();
  assert(validateFailureFinalizationReceipt(value.receipt));assert.equal(value.state,'awaiting_client');assert.equal(value.receipt.disposition,'abandoned_by_user');assert.equal(value.receipt.executionConfirmedStopped,false);assert.equal(value.receipt.executionState,'uncertain');assert.equal(Object.hasOwn(value.receipt,'processExit'),false);assert(!JSON.stringify(value).includes('secret prompt'));
  assert.deepEqual(f.raw(),original);assert.deepEqual(f.db.prepare("SELECT * FROM a2a_action_events WHERE id='event_original'").get(),event);assert.deepEqual(f.db.prepare('SELECT runtime_profile FROM employees WHERE id=?').get(f.bot.id),profile);assert.equal(f.db.prepare('SELECT count(*) n FROM conversation_messages').get().n,messages);
  assert.deepEqual({...f.db.prepare('SELECT active_action_id,control_epoch,revision,control_state FROM hermes_bots WHERE employee_id=?').get(f.bot.id)},{active_action_id:null,control_epoch:26,revision:7,control_state:'active'});
  assert.deepEqual(f.finalize(),{...value,duplicate:true});assert.equal(f.repo.getA2AAction(f.input.expectedActionId).failureFinalization.receiptDigest,value.receiptDigest);
  assert.throws(()=>f.service.finalize(f.ws.slug,f.bot.id,{...f.input,expectedControlEpoch:26},f.context),{code:'IDEMPOTENCY_CONFLICT'});
});
test('real membership, original scope, expected control and explicit uncertainty acknowledgement are enforced',t=>{
  const f=fixture(t);assert.throws(()=>f.service.finalize(f.ws.slug,f.bot.id,f.input,{actorRole:'owner'}),{code:'BOT_FAILURE_FINALIZATION_USER_REQUIRED'});
  f.db.prepare("UPDATE members SET role='member' WHERE user_id=?").run(f.owner.user_id);assert.throws(()=>f.finalize(),{code:'BOT_FAILURE_FINALIZATION_USER_REQUIRED'});f.db.prepare("UPDATE members SET role='owner' WHERE user_id=?").run(f.owner.user_id);
  for(const input of[{...f.input,acknowledgeUncertain:false},{...f.input,extra:true}])assert.throws(()=>f.service.finalize(f.ws.slug,f.bot.id,input,f.context),{code:'BOT_FAILURE_FINALIZATION_INPUT_INVALID'});
  assert.throws(()=>f.service.finalize(f.ws.slug,f.bot.id,{...f.input,expectedControlEpoch:26},f.context),{code:'BOT_FAILURE_FINALIZATION_CONTROL_CONFLICT'});
  f.db.prepare('UPDATE employees SET runtime_profile=? WHERE id=?').run('another-profile',f.bot.id);assert.throws(()=>f.finalize(),{code:'BOT_FAILURE_FINALIZATION_BINDING_CONFLICT'});
});
test('normal browser API needs authenticated owner and device list/ack require real original device credentials',async t=>{
  const f=fixture(t),app=f.app(),url=`/api/workspaces/${f.ws.slug}/bots/${f.bot.id}/failure-finalization`,cookie=`ziwei_session=${f.owner.session.token}`;
  assert.equal((await request(app,url,{body:f.input})).status,401);
  const r=await request(app,url,{body:f.input,cookie});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.cache,'no-store');
  const list='/a2a/v1/failure-finalizations?workspace='+f.ws.slug+'&deviceId='+f.pair.deviceId;
  assert.equal((await request(app,list,{method:'GET'})).status,401);
  const listed=await request(app,list,{method:'GET',token:f.pair.deviceToken});assert.equal(listed.status,200,JSON.stringify(listed.body));assert.equal(listed.body.finalizations.length,1);
  const other=f.repo.claimDevicePairing({code:f.repo.createDevicePairing(f.ws.slug,{name:'Other'}).code});assert.deepEqual(f.service.pending(f.repo.authenticateDeviceToken(other.deviceToken)).finalizations,[]);
  const ackUrl=`/a2a/v1/actions/${f.input.expectedActionId}/failure-finalization/ack`;
  assert.equal((await request(app,ackUrl,{body:f.ack(r.body),token:other.deviceToken})).status,403);
  const acked=await request(app,ackUrl,{body:f.ack(r.body),token:f.pair.deviceToken});assert.equal(acked.status,200,JSON.stringify(acked.body));assert.equal(acked.body.state,'client_archived');
});
test('new execution waits for paired-client archival and becomes admissible after exact acknowledgement',t=>{
  const f=fixture(t),value=f.finalize();assert.throws(f.admit,{code:'BOT_FAILURE_FINALIZATION_PENDING'});assert.equal(pendingBotFailureFinalization(f.db,f.ws.id,f.bot.id).receipt.id,value.receipt.id);
  for(const patch of[{receiptDigest:'b'.repeat(64)},{receiptId:'b'.repeat(64)},{archiveSha256:'missing'},{localProcessDisposition:'tree_exited'},{executionConfirmedStopped:true}])assert.throws(()=>f.service.acknowledge(f.input.expectedActionId,f.credential,{...f.ack(value),...patch}),{code:'BOT_FAILURE_FINALIZATION_ACK_INVALID'});
  const result=f.service.acknowledge(f.input.expectedActionId,f.credential,f.ack(value));assert.equal(result.state,'client_archived');assert.equal(result.acknowledgement.ack.localProcessDisposition,'unobservable');assert(f.admit());assert.equal(pendingBotFailureFinalization(f.db,f.ws.id,f.bot.id),null);assert.deepEqual(f.service.pending(f.credential).finalizations,[]);
  assert.equal(f.service.acknowledge(f.input.expectedActionId,f.credential,f.ack(value)).duplicate,true);assert.throws(()=>f.service.acknowledge(f.input.expectedActionId,f.credential,{...f.ack(value),archiveSha256:'b'.repeat(64)}),{code:'BOT_FAILURE_FINALIZATION_ACK_CONFLICT'});
});
test('new failed ambiguous completion automatically ends admission bookkeeping and preserves exact original unknown result',t=>{
  const f=fixture(t,{status:'acked',event:false}),response=f.repo.resultA2AAction(f.input.expectedActionId,{status:'failed',error:f.error,result:f.result,deviceId:f.pair.deviceId});
  assert.equal(response.failureFinalization.receipt.disposition,'failed_automatically');assert.equal(response.failureFinalization.receipt.actorRole,'system');assert.equal(response.failureFinalization.receipt.actorUserId,null);assert.deepEqual(JSON.parse(f.raw().result_json),f.result);assert.equal(f.raw().status,'failed');assert.equal(f.read().receipt.subject.failedEvent,null);assert.throws(f.admit,{code:'BOT_FAILURE_FINALIZATION_PENDING'});
  // A late normal failed event does not erase the exact result-pinned intent.
  f.db.prepare('INSERT INTO a2a_action_events(id,action_id,type,message,data_json,created_at) VALUES(?,?,?,?,?,?)').run('late_failed',f.input.expectedActionId,'failed','late',JSON.stringify({result:f.result,error:f.error}),new Date().toISOString());assert(f.read());
  const original=f.raw(),repeated=f.repo.resultA2AAction(f.input.expectedActionId,{status:'failed',error:'must not replace',result:{code:'EXECUTION_UNCERTAIN'},deviceId:f.pair.deviceId});assert.equal(repeated.duplicate,true);assert.deepEqual(f.raw(),original);
});
test('ordinary complete-exit failure follows existing failed path and needs no finalization',t=>{
  const f=fixture(t,{status:'acked',uncertain:false,event:false}),response=f.repo.resultA2AAction(f.input.expectedActionId,{status:'failed',error:f.error,result:f.result,deviceId:f.pair.deviceId});assert.equal(response.failureFinalization,undefined);assert.equal(f.read(),null);assert.equal(f.db.prepare('SELECT active_action_id FROM hermes_bots WHERE employee_id=?').get(f.bot.id).active_action_id,null);assert(f.admit());
});
test('pending/succeeded and a different current execution cannot be force-ended',t=>{
  const f=fixture(t);f.db.prepare("UPDATE a2a_actions SET status='acked' WHERE id=?").run(f.input.expectedActionId);assert.throws(f.finalize,{code:'BOT_FAILURE_FINALIZATION_INELIGIBLE'});f.db.prepare("UPDATE a2a_actions SET status='failed' WHERE id=?").run(f.input.expectedActionId);f.db.prepare("UPDATE hermes_bots SET active_action_id='another' WHERE employee_id=?").run(f.bot.id);assert.throws(f.finalize,{code:'BOT_FAILURE_FINALIZATION_CONTROL_CONFLICT'});
});
test('event, marker, action and acknowledgement tampering fail closed',t=>{
  const f=fixture(t),value=f.finalize(),marker=f.db.prepare("SELECT * FROM management_requests WHERE kind='bot-failure-finalization-v1'").get();
  f.db.prepare("UPDATE management_requests SET fingerprint='tampered' WHERE kind='bot-failure-finalization-v1'").run();assert.equal(f.read(),null);assert.throws(f.admit,{code:'BOT_FAILURE_FINALIZATION_CONFLICT'});f.db.prepare("UPDATE management_requests SET fingerprint=? WHERE kind='bot-failure-finalization-v1'").run(marker.fingerprint);
  const original=f.raw();f.db.prepare('UPDATE a2a_actions SET error=? WHERE id=?').run('tampered',f.input.expectedActionId);assert.equal(f.read(),null);f.db.prepare('UPDATE a2a_actions SET error=? WHERE id=?').run(original.error,f.input.expectedActionId);
  f.service.acknowledge(f.input.expectedActionId,f.credential,f.ack(value));f.db.prepare("UPDATE management_requests SET fingerprint='tampered' WHERE kind='bot-failure-finalization-ack-v1'").run();assert.equal(f.read(),null);assert.throws(f.admit,{code:'BOT_FAILURE_FINALIZATION_CONFLICT'});
});
test('transaction failure restores the old slot and epoch instead of half-finalizing',t=>{
  const f=fixture(t),before=f.db.prepare('SELECT * FROM hermes_bots WHERE employee_id=?').get(f.bot.id);f.db.exec("CREATE TRIGGER fail_finalization BEFORE INSERT ON a2a_action_events WHEN NEW.type='bot.failed_execution_finalization' BEGIN SELECT RAISE(ABORT,'fixture event failure'); END");assert.throws(f.finalize,/fixture event failure/);assert.deepEqual(f.db.prepare('SELECT * FROM hermes_bots WHERE employee_id=?').get(f.bot.id),before);assert.equal(f.read(),null);
});
test('scope-matched owner intent is immutable across archive and receipt digest is deterministic',t=>{
  const f=fixture(t),value=f.finalize(),before=JSON.stringify(value.receipt),ack=f.ack(value);assert.equal(value.receiptDigest,finalizationDigest(value.receipt));f.service.acknowledge(f.input.expectedActionId,f.credential,ack);assert.equal(JSON.stringify(f.read().receipt),before);f.db.prepare('UPDATE device_credentials SET revoked_at=? WHERE id=?').run(new Date().toISOString(),f.credential.credentialId);assert.throws(()=>f.service.read(f.input.expectedActionId,f.credential),{code:'BOT_FAILURE_FINALIZATION_DEVICE_REQUIRED'});
});
test('mobile action and Bot projections retain finalization disposition and original unknown execution separately',async t=>{
  const f=fixture(t),value=f.finalize(),app=f.app(),cookie=`ziwei_session=${f.owner.session.token}`;
  const actionUrl=`/api/workspaces/${f.ws.slug}/actions/${f.input.expectedActionId}?view=mobile`,botUrl=`/api/workspaces/${f.ws.slug}/bots/${f.bot.id}?view=mobile`;
  const before=await request(app,actionUrl,{method:'GET',cookie});assert.equal(before.status,200,JSON.stringify(before.body));
  assert.deepEqual(before.body.failureFinalization,value);assert.equal(before.body.status,'failed');assert.equal(before.body.result.executionState,'uncertain');
  const botBefore=await request(app,botUrl,{method:'GET',cookie});assert.equal(botBefore.status,200,JSON.stringify(botBefore.body));assert.deepEqual(botBefore.body.failureFinalization,value);assert.equal(botBefore.body.active_action_id,null);
  f.service.acknowledge(f.input.expectedActionId,f.credential,f.ack(value));
  const after=await request(app,actionUrl,{method:'GET',cookie});assert.equal(after.status,200);assert.equal(after.body.failureFinalization.state,'client_archived');assert.equal(after.body.result.executionState,'uncertain');assert.equal(after.body.failureFinalization.receipt.executionConfirmedStopped,false);
  const botAfter=await request(app,botUrl,{method:'GET',cookie});assert.equal(botAfter.status,200);assert.equal(botAfter.body.failureFinalization,null);
});
