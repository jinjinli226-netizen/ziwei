import test from 'node:test';
import assert from 'node:assert/strict';
import {createRepository} from './repository.mjs';
import {createAuthService} from './auth.mjs';
import {createDeviceUpdateService,OFFICIAL_CLIENT_SOURCE,REMOTE_UPDATE_FEATURE,NATIVE_WORKER_UPDATE_VERIFICATION_FEATURE} from './device-updates.mjs';

const OLD='1'.repeat(64),TARGET='2'.repeat(64),PACKAGE='3'.repeat(64),HOST='4'.repeat(64),LATER='5'.repeat(64);
function fixture(t,{native=true}={}){
 const repo=createRepository({memory:true}),db=repo.db,auth=createAuthService(db);
 const owner=auth.setup({email:'verification@fixture.invalid',password:'synthetic-verification-password'});
 const slug='verification-fixture';auth.createWorkspace(owner.user_id,{slug,name:'Verification',kind:'team'});
 const pair=repo.claimDevicePairing({code:repo.createDevicePairing(slug,{name:'Windows fixture'}).code});
 const heartbeat=(build=OLD,pid=1001,features=[REMOTE_UPDATE_FEATURE,...(native?[NATIVE_WORKER_UPDATE_VERIFICATION_FEATURE]:[])])=>repo.heartbeatDevice(slug,{deviceId:pair.deviceId,os:'Windows',pid,clientBuild:build,runtimeDiscovery:{features,maintenanceHostId:HOST}});
 heartbeat();let clock=Date.now();const service=createDeviceUpdateService(repo,{now:()=>clock,readRelease:async()=>({url:OFFICIAL_CLIENT_SOURCE,clientBuild:TARGET,sha256:PACKAGE,version:'fixture'})});
 const context={actorUserId:owner.user_id},credential=()=>repo.authenticateDeviceToken(pair.deviceToken);
 t.after(()=>db.close());
 const f={repo,db,slug,pair,service,context,heartbeat,credential,advance:ms=>clock+=ms};
 f.begin=async()=>{const {request}=await service.create(slug,pair.deviceId,{idempotencyKey:'verification-request-v1',waitForIdle:true},context);f.request=request;f.claim=service.claim(slug,pair.deviceId,request.id,{hostId:HOST,clientBuild:OLD,pid:1001},credential());for(const state of ['waiting_idle','updating','awaiting_heartbeat'])f.progress(state);return f;};
 f.progress=(state,extra={})=>service.progress(slug,pair.deviceId,f.request.id,{state,hostId:HOST,clientBuild:OLD,claimToken:f.claim.claimToken,workerPid:3001,...extra},credential());
 f.read=async()=>(await service.get(slug,pair.deviceId,f.request.id,context)).request;
 f.raw=()=>db.prepare('SELECT * FROM device_updates WHERE id=?').get(f.request.id);
 f.receipt=(state='complete')=>({schemaVersion:1,operation:'update',state,binding:{requestId:f.request.id,hostId:HOST,deviceId:pair.deviceId,sourceBuild:OLD,targetBuild:TARGET,sha256:PACKAGE},supervisorPid:3001,workerPid:4001,daemonPid:state==='complete'?1002:1003,installedBuild:state==='complete'?TARGET:OLD,configSha256:'8'.repeat(64),terminalSha256:'7'.repeat(64),workerIdentitySha256:'6'.repeat(64),finishedAt:new Date().toISOString(),workerExited:true,maintenanceLockAbsent:true,configurationPreserved:true,nativeStartupVerified:true,...(state==='complete'?{restoredRunning:true}:{originalInstallationRestored:true,runningStateRestored:true,reasonCode:'PROCESS_EXIT_NONZERO',failureStage:'restart_client',exitCode:1})});
 f.observed=()=>{const strong=f.receipt('failed');return {...strong.binding,...Object.fromEntries(Object.entries(strong).filter(([key])=>!['binding','daemonPid','installedBuild','configSha256','configurationPreserved','nativeStartupVerified'].includes(key)))};};
 f.legacySuccess=()=>{const at=new Date().toISOString();db.prepare("UPDATE device_updates SET state='succeeded',verified_at=?,updated_at=?,evidence_json='{}' WHERE id=?").run(at,at,f.request.id);return at;};
 return f;
}

test('a target heartbeat cannot finalize an installer that is still running or later fails',async t=>{
 const f=await fixture(t).begin();f.heartbeat(TARGET,1002);
 assert.equal((await f.read()).state,'awaiting_heartbeat');assert.equal((await f.read()).heartbeatVerified,false);
 assert.equal((await f.read()).targetHeartbeatObserved,true);
 f.progress('failed',{code:'CLIENT_UPDATE_PROCESS_EXIT_NONZERO'});
 assert.equal((await f.read()).state,'failed');
});

for(const order of ['heartbeat-first','worker-first'])test('both authenticated heartbeat and native terminal completion are required: '+order,async t=>{
 const f=await fixture(t).begin(),receipt=f.receipt();
 if(order==='heartbeat-first')f.heartbeat(TARGET,1002);
 f.progress('awaiting_heartbeat',{workerReceipt:receipt});
 if(order==='worker-first'){assert.equal((await f.read()).state,'awaiting_heartbeat');f.heartbeat(TARGET,1002);}
 const status=await f.read();assert.equal(status.state,'succeeded');assert.equal(status.workerVerified,true);assert.equal(status.heartbeatVerified,true);assert.equal(status.completionSource,'heartbeat+native_worker');
 const before=f.raw();f.progress('awaiting_heartbeat',{workerReceipt:receipt});assert.deepEqual(f.raw(),before,'exact receipt replay leaves history and timestamps stable');
 assert.equal(JSON.stringify(status).includes(f.claim.claimToken),false);
});

test('native completion refuses partial, foreign, altered, running or unsafe evidence without changing state',async t=>{
 const f=await fixture(t).begin();f.heartbeat(TARGET,1002);
 for(const patch of [{requestId:'other-request'},{hostId:'9'.repeat(64)},{deviceId:'other-device'},{sourceBuild:TARGET},{targetBuild:OLD},{sha256:'9'.repeat(64)},{supervisorPid:9999},{workerPid:0},{workerExited:false},{maintenanceLockAbsent:false},{configurationPreserved:false},{nativeStartupVerified:false},{restoredRunning:false},{installedBuild:OLD},{daemonPid:1001},{terminalSha256:''},{workerIdentitySha256:''},{api_key:'synthetic-forbidden'},{finishedAt:'not-a-time'}]){
  const before=f.raw();assert.throws(()=>f.progress('awaiting_heartbeat',{workerReceipt:{...f.receipt(),...patch}}),{code:'CLIENT_UPDATE_RECEIPT_INVALID'},JSON.stringify(patch));assert.deepEqual(f.raw(),before);
 }
 const missing=f.receipt();delete missing.workerExited;assert.throws(()=>f.progress('awaiting_heartbeat',{workerReceipt:missing}),{code:'CLIENT_UPDATE_RECEIPT_INVALID'});
});

test('a restored source heartbeat and bound native rollback may correct legacy premature success while preserving its fact',async t=>{
 const f=await fixture(t).begin(),oldVerifiedAt=f.legacySuccess();f.heartbeat(OLD,1003);
 const proof=f.receipt('failed');const result=f.progress('failed',{rollbackEvidence:proof,code:'CLIENT_UPDATE_PROCESS_EXIT_NONZERO'}).request;
 assert.equal(result.state,'failed');assert.equal(result.rollbackVerified,true);assert.equal(result.previousSuccessVerifiedAt,oldVerifiedAt);
 assert.equal(f.raw().verified_at,oldVerifiedAt,'the old success observation is retained');
 assert.deepEqual(result.evidenceHistory.map(row=>row.type),['legacy_success_observed','native_rollback_verified']);
 const before=f.raw();f.progress('failed',{rollbackEvidence:proof,code:'CLIENT_UPDATE_PROCESS_EXIT_NONZERO'});assert.deepEqual(f.raw(),before);
 const next=await f.service.create(f.slug,f.pair.deviceId,{idempotencyKey:'verification-request-v2',waitForIdle:true},f.context);assert.equal(next.request.state,'requested');assert.notEqual(next.request.id,f.request.id);
});

test('late rollback refuses a stale, target-build, foreign-PID or incomplete restoration claim',async t=>{
 const f=await fixture(t).begin();f.legacySuccess();f.heartbeat(TARGET,1002);
 assert.throws(()=>f.progress('failed',{rollbackEvidence:f.receipt('failed')}),{code:'CLIENT_UPDATE_ROLLBACK_UNCONFIRMED'});
 f.heartbeat(OLD,1003);
 for(const patch of [{originalInstallationRestored:false},{runningStateRestored:false},{daemonPid:1002},{installedBuild:TARGET}])assert.throws(()=>f.progress('failed',{rollbackEvidence:{...f.receipt('failed'),...patch}}),{code:patch.daemonPid?'CLIENT_UPDATE_ROLLBACK_UNCONFIRMED':'CLIENT_UPDATE_RECEIPT_INVALID'});
 f.advance(100_000);assert.throws(()=>f.progress('failed',{rollbackEvidence:f.receipt('failed')}),{code:'CLIENT_UPDATE_ROLLBACK_UNCONFIRMED'});assert.equal((await f.read()).state,'succeeded');
});

test('historical native failure is appended without inventing missing old process/config proof on a later build',async t=>{
 const f=await fixture(t).begin(),oldVerifiedAt=f.legacySuccess();f.heartbeat(LATER,1004);
 const observed=f.observed();
 const result=f.progress('failed',{clientBuild:LATER,observedFailure:observed,code:'CLIENT_UPDATE_PROCESS_EXIT_NONZERO'});
 assert.equal(result.observedFailureRecorded,true);assert.equal(result.requiresReconciliation,true);assert.equal(result.request.state,'succeeded');assert.equal(result.request.requiresReconciliation,true);assert.equal(result.request.observedFailureRecorded,true);assert.equal(f.raw().verified_at,oldVerifiedAt);
 assert.deepEqual(result.request.evidenceHistory.map(row=>row.type),['legacy_success_observed','native_failure_observed']);
 assert.equal(result.request.rollbackVerified,false);
 const before=f.raw();f.progress('failed',{clientBuild:LATER,observedFailure:observed});assert.deepEqual(f.raw(),before);
 assert.throws(()=>f.progress('failed',{clientBuild:LATER,observedFailure:{...observed,workerIdentitySha256:''}}),{code:'CLIENT_UPDATE_RECEIPT_INVALID'});
});

test('claim and device credentials still protect completion and historical reconciliation',async t=>{
 const f=await fixture(t).begin();f.legacySuccess();f.heartbeat(OLD,1003);
 assert.throws(()=>f.service.progress(f.slug,f.pair.deviceId,f.request.id,{state:'failed',hostId:HOST,clientBuild:OLD,claimToken:'a'.repeat(64),workerPid:3001,rollbackEvidence:f.receipt('failed')},f.credential()),{code:'CLIENT_UPDATE_PROGRESS_INVALID'});
 const credential=f.credential();f.repo.revokeDeviceCredential(f.pair.deviceId);
 assert.throws(()=>f.service.progress(f.slug,f.pair.deviceId,f.request.id,{state:'failed',hostId:HOST,clientBuild:OLD,claimToken:f.claim.claimToken,workerPid:3001,rollbackEvidence:f.receipt('failed')},credential),{code:'CLIENT_UPDATE_DEVICE_CREDENTIAL_REQUIRED'});
});

test('historical supplements require a fresh heartbeat from the actual reporting build',async t=>{
 const f=await fixture(t).begin();f.legacySuccess();f.heartbeat(LATER,1004);
 const observed=f.observed();
 assert.throws(()=>f.progress('failed',{clientBuild:OLD,observedFailure:observed}),{code:'CLIENT_UPDATE_HISTORY_UNCONFIRMED'});
 f.advance(100_000);assert.throws(()=>f.progress('failed',{clientBuild:OLD,observedFailure:observed}),{code:'CLIENT_UPDATE_HISTORY_UNCONFIRMED'});
 assert.equal((await f.read()).observedFailureRecorded,false);
});

test('the source capability freezes completion protocol and a target heartbeat cannot upgrade or downgrade it',async t=>{
 const strong=await fixture(t).begin();strong.heartbeat(TARGET,1002,[REMOTE_UPDATE_FEATURE]);
 assert.equal((await strong.read()).completionProtocol,'native_worker_v1');assert.equal((await strong.read()).state,'awaiting_heartbeat');
 const legacy=await fixture(t,{native:false}).begin();legacy.heartbeat(TARGET,1002,[REMOTE_UPDATE_FEATURE,NATIVE_WORKER_UPDATE_VERIFICATION_FEATURE]);
 assert.equal((await legacy.read()).completionProtocol,'legacy_heartbeat');assert.equal((await legacy.read()).state,'succeeded');assert.equal((await legacy.read()).completionSource,'heartbeat');
 const old=legacy.raw();const restarted=createDeviceUpdateService(legacy.repo,{readRelease:async()=>({url:OFFICIAL_CLIENT_SOURCE,clientBuild:TARGET,sha256:PACKAGE,version:'fixture'})});
 assert.equal((await restarted.get(legacy.slug,legacy.pair.deviceId,legacy.request.id,legacy.context)).request.completionProtocol,'legacy_heartbeat');assert.deepEqual(legacy.raw(),old);
});

test('later native evidence never relabels the original legacy heartbeat success as worker-verified history',async t=>{
 const f=await fixture(t,{native:false}).begin();f.heartbeat(TARGET,1002);f.progress('awaiting_heartbeat',{workerReceipt:f.receipt()});
 f.heartbeat(OLD,1003);const status=f.progress('failed',{rollbackEvidence:f.receipt('failed')}).request;
 assert.equal(status.completionProtocol,'legacy_heartbeat');assert.equal(status.evidenceHistory.some(row=>row.type==='native_success_verified'),false);
 assert.equal(status.evidenceHistory.filter(row=>row.type==='legacy_success_observed').length,1);
});
