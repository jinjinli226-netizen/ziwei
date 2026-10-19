import test from 'node:test';
import assert from 'node:assert/strict';
import {IncomingMessage,ServerResponse} from 'node:http';
import {Duplex} from 'node:stream';
import {createRepository} from './repository.mjs';
import {createAuthService} from './auth.mjs';
import {createDeviceUpdateService,OFFICIAL_CLIENT_SOURCE,REMOTE_UPDATE_FEATURE} from './device-updates.mjs';
import {createActionMaintenanceService} from './action-maintenance.mjs';
import {createApp} from './app.mjs';
import {createManagementService} from './management.mjs';
import {completeOwnedProfile} from '../test-support/owned-profile.mjs';

const OLD='1'.repeat(64),TARGET='2'.repeat(64),HOST='4'.repeat(64),DIGEST='5'.repeat(64),SLUG='pause-fixture';
function fixture(t,{bot=false}={}){
 const repo=createRepository({memory:true}),db=repo.db,auth=createAuthService(db),owner=auth.setup({email:'pause@fixture.invalid',password:'fixture-pause-password'});
 auth.createWorkspace(owner.user_id,{slug:SLUG,name:'Pause',kind:'team'});
 const pair=repo.claimDevicePairing({code:repo.createDevicePairing(SLUG,{name:'Windows fixture'}).code}),actor={actorUserId:owner.user_id,actorRole:'owner'};
 const heartbeat=(extra={})=>repo.heartbeatDevice(SLUG,{deviceId:pair.deviceId,os:'Windows',pid:1001,clientBuild:OLD,runtimes:{Hermes:{status:'available',profiles:[{name:'default'}],readiness:{authentication:'configured',provider:'configured'}}},runtimeDiscovery:{features:[REMOTE_UPDATE_FEATURE],maintenanceHostId:HOST},...extra});
 heartbeat();const metadata={url:OFFICIAL_CLIENT_SOURCE,clientBuild:TARGET,sha256:'3'.repeat(64),version:'0.1.0'},updates=createDeviceUpdateService(repo,{readRelease:async()=>metadata});
 let employee,home='C:\\Users\\fixture\\.hermes';
 if(bot){const bots=createManagementService(repo).bots;let b=bots.create(SLUG,{name:'Paused Bot',targetDeviceId:pair.deviceId,sourceProfile:'default',idempotencyKey:'paused-bot-fixture'},actor);completeOwnedProfile(repo,b);b=bots.get(SLUG,b.id);home=b.instance.home;const validation=bots.validate(SLUG,b.id,{expectedRevision:b.revision,idempotencyKey:'pause-validate'}).action;repo.ackA2AAction(validation.id,{deviceId:pair.deviceId});repo.resultA2AAction(validation.id,{deviceId:pair.deviceId,status:'succeeded',result:{botValidation:{schemaVersion:1,valid:true,employeeId:b.id,revision:b.revision}}});b=bots.control(SLUG,b.id,{expectedRevision:b.revision,expectedControlEpoch:b.control_epoch,operation:'activate'});employee=b.employee;}
 else employee=repo.createEmployee(SLUG,{name:'Hermes worker',runtime:'Hermes',runtimeProfile:'default',targetDeviceId:pair.deviceId},actor);
 const task=repo.createTask(SLUG,{title:'Continue tools without replay',employeeId:employee.id,execute:true,cwd:'D:\\AIUSE\\worker'}),action=repo.listTasks(SLUG).find(item=>item.id===task.id).execution;
 repo.ackA2AAction(action.id,{deviceId:pair.deviceId});
 const service=createActionMaintenanceService(repo),credential=()=>repo.authenticateDeviceToken(pair.deviceToken);
 const receipt=update=>({schemaVersion:1,actionId:action.id,executionBinding:repo.authorizeActionExecution(action.id,{deviceId:pair.deviceId}).executionBinding,updateId:update.id,targetBuild:update.targetBuild,runtime:'Hermes',profile:employee.runtime_profile||'default',home,cwd:'D:\\AIUSE\\worker',sessionId:'20261019_fixture',checkpointDigest:DIGEST,messageCount:12,pendingTools:0,processExit:{platform:'win32',supervisor:'windows-job',launched:true,rootPid:4001,rootConfirmed:true,rootExitCode:0,treeConfirmed:true,activeProcesses:0,cancelled:false,hostExitCode:0}});
 const prepare=async(key='fixture-pause-update')=>{const {request}=await updates.create(SLUG,pair.deviceId,{idempotencyKey:key,waitForIdle:true},actor),claim=updates.claim(SLUG,pair.deviceId,request.id,{hostId:HOST,clientBuild:OLD,pid:1001},credential());updates.progress(SLUG,pair.deviceId,request.id,{state:'waiting_idle',hostId:HOST,clientBuild:OLD,claimToken:claim.claimToken},credential());return{update:request,claimToken:claim.claimToken,receipt:receipt(request)};};
 const commit=p=>service.checkpoint(action.id,{workspace:SLUG,updateId:p.update.id,claimToken:p.claimToken,receipt:p.receipt},credential());
 const installed=p=>{for(const state of ['updating','awaiting_heartbeat'])updates.progress(SLUG,pair.deviceId,p.update.id,{state,hostId:HOST,clientBuild:OLD,claimToken:p.claimToken,workerPid:3001},credential());heartbeat({clientBuild:p.update.targetBuild,pid:1002});};
 const resume=p=>service.resume(action.id,{workspace:SLUG,updateId:p.update.id,checkpointDigest:p.receipt.checkpointDigest,clientBuild:p.update.targetBuild},credential());
 const raw=()=>db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(action.id);
 t.after(()=>db.close());return{repo,db,auth,owner,pair,actor,employee,task,action,metadata,updates,heartbeat,service,credential,prepare,commit,installed,resume,raw};
}

test('checkpoint preserves one ACKed action, logical task, Bot lock and original deadline; replay is stable',async t=>{
 const f=fixture(t,{bot:true}),p=await f.prepare(),before=f.raw(),count=f.db.prepare('SELECT count(*) n FROM a2a_actions').get().n;
 const paused=f.commit(p);assert.equal(paused.committed,true);assert.equal(paused.state,'paused');assert.equal(paused.generation,1);assert.deepEqual(f.raw(),before);
 assert.equal(f.db.prepare('SELECT active_action_id FROM hermes_bots WHERE employee_id=?').get(f.employee.id).active_action_id,f.action.id);
 assert.equal(f.db.prepare('SELECT state FROM tasks WHERE id=?').get(f.task.id).state,'in_progress');assert.equal(f.db.prepare('SELECT count(*) n FROM a2a_actions').get().n,count);
 assert.deepEqual(f.commit(p),paused);assert.equal(f.db.prepare("SELECT count(*) n FROM a2a_action_events WHERE action_id=? AND type='maintenance.checkpoint'").get(f.action.id).n,1);
 assert.throws(()=>f.commit({...p,receipt:{...p.receipt,checkpointDigest:'6'.repeat(64)}}),{code:'MAINTENANCE_IDEMPOTENCY_CONFLICT'});
 assert.equal(f.repo.ackA2AAction(f.action.id,{deviceId:f.pair.deviceId,renewLease:true}).leaseRenewed,undefined);assert.equal(f.raw().expires_at,before.expires_at);
});

test('resume requires target authenticated heartbeat, survives lost response and fences events/results',async t=>{
 const f=fixture(t),p=await f.prepare();f.commit(p);
 assert.throws(()=>f.repo.authorizeActionExecution(f.action.id,{deviceId:f.pair.deviceId}),{code:'MAINTENANCE_ATTEMPT_REQUIRED'});
 assert.throws(()=>f.resume(p),{code:'MAINTENANCE_SOURCE_IDLE_REQUIRED'});
 for(const input of [{type:'action.started'},{status:'succeeded',result:{output:'stale'}}])assert.throws(()=>input.type?f.repo.recordA2AEvent(f.action.id,{deviceId:f.pair.deviceId,...input}):f.repo.resultA2AAction(f.action.id,{deviceId:f.pair.deviceId,...input}),{code:'MAINTENANCE_ATTEMPT_REQUIRED'});
 f.installed(p);const allowed=f.resume(p);assert.equal(allowed.allowed,true);assert.match(allowed.maintenanceAttempt.token,/^[a-f0-9]{64}$/);
 assert.equal(f.repo.authorizeActionExecution(f.action.id,{deviceId:f.pair.deviceId,maintenanceAttempt:allowed.maintenanceAttempt}).allowed,true);
 const restarted=createActionMaintenanceService(f.repo);assert.deepEqual(restarted.resume(f.action.id,{updateId:p.update.id,checkpointDigest:DIGEST,clientBuild:TARGET},f.credential()),allowed);
 assert.throws(()=>f.repo.recordA2AEvent(f.action.id,{deviceId:f.pair.deviceId,type:'progress',maintenanceAttempt:{...allowed.maintenanceAttempt,generation:0}}),{code:'MAINTENANCE_ATTEMPT_REQUIRED'});
 const expiry=f.raw().expires_at,event=f.repo.recordA2AEvent(f.action.id,{deviceId:f.pair.deviceId,eventId:'resume-start',type:'action.started',maintenanceAttempt:allowed.maintenanceAttempt,data:{message:'resumed'}});assert.equal(event.data.maintenanceGeneration,1);assert.equal(f.raw().expires_at,expiry);
 const body={deviceId:f.pair.deviceId,status:'succeeded',maintenanceAttempt:allowed.maintenanceAttempt,result:{output:'Done'}};assert.equal(f.repo.resultA2AAction(f.action.id,body).status,'succeeded');assert.equal(f.repo.resultA2AAction(f.action.id,body).duplicate,true);
 assert.throws(()=>f.repo.resultA2AAction(f.action.id,{...body,maintenanceAttempt:undefined}),{code:'MAINTENANCE_ATTEMPT_REQUIRED'});
});

test('ordinary event APIs cannot manufacture maintenance and all public event projections redact the permit',async t=>{
 const f=fixture(t),p=await f.prepare();assert.throws(()=>f.repo.recordA2AEvent(f.action.id,{type:'maintenance.resume',data:{token:'f'.repeat(64)}}),{code:'MAINTENANCE_EVENT_RESERVED'});f.commit(p);f.installed(p);const {maintenanceAttempt}=f.resume(p);
 for(const value of [f.repo.getA2AAction(f.action.id),f.repo.getA2AAction(f.action.id,{eventView:'mobile'}),f.repo.listA2AEvents(f.action.id),f.repo.listTasks(SLUG)]){assert.equal(JSON.stringify(value).includes(maintenanceAttempt.token),false);assert.equal(JSON.stringify(value).includes('data_json'),false);}
 assert.deepEqual(f.service.status(f.action.id,f.credential()).maintenanceAttempt,maintenanceAttempt);
});

test('read-only employee audits and another assigned task do not revoke a maintenance checkpoint',async t=>{
 const f=fixture(t),p=await f.prepare(),audit=(id,action)=>f.db.prepare('INSERT INTO audit_events(id,workspace_id,actor,action,payload_json,created_at) VALUES(?,?,?,?,?,?)').run(id,f.raw().workspace_id,'fixture',action,JSON.stringify({employeeId:f.employee.id}),new Date().toISOString());
 audit('fixture-before-pause-read','employee.read');assert.equal(f.commit(p).committed,true);
 f.repo.createTask(SLUG,{title:'A different task for the same employee',employeeId:f.employee.id,execute:false});audit('fixture-after-pause-read','employee.read');audit('fixture-other-task-audit','task.employee.assigned');f.installed(p);
 assert.equal(f.resume(p).allowed,true);assert.equal(f.raw().status,'acked');
});

test('employee configuration restored to its original bytes still revokes a paused generation',async t=>{
 const f=fixture(t),p=await f.prepare();f.commit(p);const before=f.db.prepare('SELECT * FROM employees WHERE id=?').get(f.employee.id);
 f.repo.updateEmployee(f.employee.id,{description:'Temporary configuration'},f.actor);f.repo.updateEmployee(f.employee.id,{description:before.description},f.actor);f.db.prepare('UPDATE employees SET updated_at=? WHERE id=?').run(before.updated_at,f.employee.id);assert.deepEqual(f.db.prepare('SELECT * FROM employees WHERE id=?').get(f.employee.id),before);f.installed(p);
 assert.equal(f.resume(p).reasonCode,'MAINTENANCE_BINDING_CHANGED');assert.equal(f.raw().status,'failed');
});

test('cancelled upgrade arriving between native pause and commit can resume the original daemon with strict idle proof',async t=>{
 const f=fixture(t),p=await f.prepare();f.updates.cancel(SLUG,f.pair.deviceId,p.update.id,f.actor);assert.equal(f.commit(p).committed,true);
 const input={updateId:p.update.id,checkpointDigest:DIGEST,clientBuild:OLD,sourceIdle:{workerAbsent:true,maintenanceLockAbsent:true,installedBuild:OLD,pid:1001}};
 assert.throws(()=>f.service.resume(f.action.id,{...input,sourceIdle:{...input.sourceIdle,maintenanceLockAbsent:false}},f.credential()),{code:'MAINTENANCE_SOURCE_IDLE_REQUIRED'});
 assert.equal(f.service.resume(f.action.id,input,f.credential()).allowed,true);
});

test('failed update with a launched worker or a different rollback process cannot authorize source resurrection',async t=>{
 const f=fixture(t),p=await f.prepare();f.commit(p);f.updates.progress(SLUG,f.pair.deviceId,p.update.id,{state:'updating',hostId:HOST,clientBuild:OLD,claimToken:p.claimToken,workerPid:3001},f.credential());f.updates.progress(SLUG,f.pair.deviceId,p.update.id,{state:'failed',hostId:HOST,clientBuild:OLD,claimToken:p.claimToken,code:'CLIENT_UPDATE_WORKER_FAILED'},f.credential());
 const input={updateId:p.update.id,checkpointDigest:DIGEST,clientBuild:OLD,sourceIdle:{workerAbsent:true,maintenanceLockAbsent:true,installedBuild:OLD,pid:1001}};
 assert.throws(()=>f.service.resume(f.action.id,input,f.credential()),{code:'MAINTENANCE_SOURCE_IDLE_REQUIRED'});f.heartbeat({pid:1003});assert.throws(()=>f.service.resume(f.action.id,input,f.credential()),{code:'MAINTENANCE_SOURCE_IDLE_REQUIRED'});
});

test('a failed launched worker can resume only a verified restored source installation with the current daemon heartbeat',async t=>{
 const f=fixture(t),p=await f.prepare();f.commit(p);f.updates.progress(SLUG,f.pair.deviceId,p.update.id,{state:'updating',hostId:HOST,clientBuild:OLD,claimToken:p.claimToken,workerPid:3001},f.credential());f.updates.progress(SLUG,f.pair.deviceId,p.update.id,{state:'failed',hostId:HOST,clientBuild:OLD,claimToken:p.claimToken,code:'CLIENT_UPDATE_WORKER_FAILED'},f.credential());f.heartbeat({clientBuild:OLD,pid:1003});
 const sourceIdle={workerTerminal:true,originalInstallationRestored:true,maintenanceLockAbsent:true,installedBuild:OLD,pid:1003},input={updateId:p.update.id,checkpointDigest:DIGEST,clientBuild:OLD,sourceIdle};
 for(const value of [{...sourceIdle,workerTerminal:false},{...sourceIdle,originalInstallationRestored:false},{...sourceIdle,maintenanceLockAbsent:false},{...sourceIdle,pid:1001},{...sourceIdle,installedBuild:TARGET},{...sourceIdle,workerAbsent:true}])assert.throws(()=>f.service.resume(f.action.id,{...input,sourceIdle:value},f.credential()),{code:'MAINTENANCE_SOURCE_IDLE_REQUIRED'});
 f.db.prepare('UPDATE devices SET heartbeat_at=? WHERE id=?').run(new Date(Date.now()-100_000).toISOString(),f.pair.deviceId);assert.throws(()=>f.service.resume(f.action.id,input,f.credential()),{code:'MAINTENANCE_HEARTBEAT_REQUIRED'});f.heartbeat({clientBuild:OLD,pid:1003});
 const allowed=f.service.resume(f.action.id,input,f.credential());assert.equal(allowed.allowed,true);assert.equal(allowed.receipt.sessionId,p.receipt.sessionId);assert.equal(f.raw().status,'acked');assert.deepEqual(f.service.resume(f.action.id,input,f.credential()).maintenanceAttempt,allowed.maintenanceAttempt);
});

test('rollback terminal proof cannot stand in for an updating/unknown worker or target build',async t=>{
 const f=fixture(t),p=await f.prepare();f.commit(p);const sourceIdle={workerTerminal:true,originalInstallationRestored:true,maintenanceLockAbsent:true,installedBuild:OLD,pid:1001},input={updateId:p.update.id,checkpointDigest:DIGEST,clientBuild:OLD,sourceIdle};
 assert.throws(()=>f.service.resume(f.action.id,input,f.credential()),{code:'MAINTENANCE_SOURCE_IDLE_REQUIRED'});
 f.updates.progress(SLUG,f.pair.deviceId,p.update.id,{state:'updating',hostId:HOST,clientBuild:OLD,claimToken:p.claimToken,workerPid:3001},f.credential());assert.throws(()=>f.service.resume(f.action.id,input,f.credential()),{code:'MAINTENANCE_SOURCE_IDLE_REQUIRED'});
 f.updates.progress(SLUG,f.pair.deviceId,p.update.id,{state:'failed',hostId:HOST,clientBuild:OLD,claimToken:p.claimToken,code:'CLIENT_UPDATE_WORKER_FAILED'},f.credential());f.heartbeat({clientBuild:TARGET,pid:1003});assert.throws(()=>f.service.resume(f.action.id,{...input,sourceIdle:{...sourceIdle,pid:1003}},f.credential()),{code:'MAINTENANCE_SOURCE_IDLE_REQUIRED'});
});

for(const mutation of ['employee','profile','model','cwd','deleted','expired','cancel'])test(`resume refuses changed ${mutation} and safely closes only verified stopped work`,async t=>{
 const f=fixture(t),p=await f.prepare();f.commit(p);f.installed(p);
 if(mutation==='employee')f.repo.updateEmployee(f.employee.id,{name:'Renamed'},f.actor);
 if(mutation==='profile')f.db.prepare("UPDATE employees SET runtime_profile='other' WHERE id=?").run(f.employee.id);
 if(mutation==='model')f.db.prepare("UPDATE employees SET model_id='other' WHERE id=?").run(f.employee.id);
 if(mutation==='cwd'){const payload=JSON.parse(f.raw().payload_json);payload.cwd='D:\\different';f.db.prepare('UPDATE a2a_actions SET payload_json=? WHERE id=?').run(JSON.stringify(payload),f.action.id);}
 if(mutation==='deleted')f.db.prepare("UPDATE employees SET status='deleted' WHERE id=?").run(f.employee.id);
 if(mutation==='expired')f.db.prepare('UPDATE a2a_actions SET expires_at=? WHERE id=?').run(new Date(Date.now()-1000).toISOString(),f.action.id);
 if(mutation==='cancel'){const cancel=f.repo.createA2AAction(SLUG,{type:'action.cancel',payload:{actionId:f.action.id,deviceId:f.pair.deviceId}});f.repo.resultA2AAction(cancel.id,{status:'succeeded',deviceId:f.pair.deviceId,result:{cancelRequested:true}});}
 const before=f.raw();if(mutation==='cwd'||mutation==='expired'){assert.throws(()=>f.resume(p));assert.deepEqual(f.raw(),before);}else{assert.equal(f.resume(p).terminal,true);assert.equal(f.raw().status,'failed');assert.equal(JSON.parse(f.raw().result_json).code,'maintenance_resume_revoked');}assert.equal(f.db.prepare("SELECT count(*) n FROM a2a_action_events WHERE action_id=? AND type='maintenance.resume'").get(f.action.id).n,0);
});

test('manual cancel may terminalize the exact paused checkpoint, but cannot reuse it after resumed execution started',async t=>{
 const f=fixture(t),p=await f.prepare();f.commit(p);const body={deviceId:f.pair.deviceId,status:'failed',error:'Cancelled by user',result:{maintenanceCancelled:true,maintenanceCheckpoint:p.receipt,processExit:p.receipt.processExit}};
 assert.throws(()=>f.repo.resultA2AAction(f.action.id,body),{code:'MAINTENANCE_ATTEMPT_REQUIRED'});
 const cancel=f.repo.createA2AAction(SLUG,{type:'action.cancel',payload:{actionId:f.action.id,deviceId:f.pair.deviceId}});f.repo.resultA2AAction(cancel.id,{status:'succeeded',deviceId:f.pair.deviceId});
 assert.throws(()=>f.repo.resultA2AAction(f.action.id,{...body,result:{...body.result,processExit:{...p.receipt.processExit,rootPid:9999}}}),{code:'MAINTENANCE_ATTEMPT_REQUIRED'});
 assert.equal(f.repo.resultA2AAction(f.action.id,body).status,'failed');
 const g=fixture(t),q=await g.prepare();g.commit(q);g.installed(q);const {maintenanceAttempt}=g.resume(q);g.repo.recordA2AEvent(g.action.id,{type:'action.started',maintenanceAttempt,deviceId:g.pair.deviceId});g.repo.createA2AAction(SLUG,{type:'action.cancel',payload:{actionId:g.action.id,deviceId:g.pair.deviceId}});
 assert.throws(()=>g.repo.resultA2AAction(g.action.id,{...body,deviceId:g.pair.deviceId,result:{maintenanceCancelled:true,maintenanceCheckpoint:q.receipt,processExit:q.receipt.processExit}}),{code:'MAINTENANCE_ATTEMPT_REQUIRED'});
});

test('same installation may checkpoint an action from another paired workspace; another host cannot',async t=>{
 const f=fixture(t),p=await f.prepare();f.auth.createWorkspace(f.owner.user_id,{slug:'shared-pause',name:'Shared',kind:'team'});const pair=f.repo.claimDevicePairing({code:f.repo.createDevicePairing('shared-pause',{name:'Shared installation'}).code});
 f.repo.heartbeatDevice('shared-pause',{deviceId:pair.deviceId,os:'Windows',pid:1001,clientBuild:OLD,runtimeDiscovery:{features:[REMOTE_UPDATE_FEATURE],maintenanceHostId:HOST}});
 const employee=f.repo.createEmployee('shared-pause',{name:'Other workspace worker',runtime:'Hermes',runtimeProfile:'default',targetDeviceId:pair.deviceId}),action=f.repo.createA2AAction('shared-pause',{type:'conversation.execute',payload:{employeeId:employee.id,runtime:'Hermes',profile:'default',deviceId:pair.deviceId,cwd:p.receipt.cwd}});f.repo.ackA2AAction(action.id,{deviceId:pair.deviceId});const credential=f.repo.authenticateDeviceToken(pair.deviceToken),receipt={...p.receipt,actionId:action.id,executionBinding:f.repo.authorizeActionExecution(action.id,{deviceId:pair.deviceId}).executionBinding};
 const body={workspace:'shared-pause',updateId:p.update.id,claimToken:p.claimToken,receipt};assert.equal(f.service.checkpoint(action.id,body,credential).committed,true);
 f.db.prepare('UPDATE devices SET runtime_discovery_json=? WHERE id=?').run(JSON.stringify({maintenanceHostId:'9'.repeat(64)}),pair.deviceId);assert.throws(()=>f.service.checkpoint(action.id,body,credential),{code:'MAINTENANCE_UPDATE_BINDING_CONFLICT'});
});

test('wrong claim token, authority, credential and workspace are denied before persistence',async t=>{
 const f=fixture(t),p=await f.prepare(),body={updateId:p.update.id,claimToken:p.claimToken,receipt:p.receipt};
 assert.throws(()=>f.service.checkpoint(f.action.id,{...body,claimToken:'f'.repeat(64)},f.credential()),{code:'MAINTENANCE_UPDATE_NOT_WAITING'});
 assert.throws(()=>f.service.checkpoint(f.action.id,{...body,workspace:'other'},f.credential()),{code:'MAINTENANCE_BINDING_CONFLICT'});
 const credential=f.credential();f.repo.revokeDeviceCredential(f.pair.deviceId);assert.throws(()=>f.service.checkpoint(f.action.id,body,credential),{code:'MAINTENANCE_DEVICE_REQUIRED'});assert.equal(f.db.prepare("SELECT count(*) n FROM a2a_action_events WHERE type LIKE 'maintenance.%'").get().n,0);
});

test('second upgrade advances one generation, retains the first deadline and rejects every old permit and checkpoint',async t=>{
 const f=fixture(t),p=await f.prepare();f.commit(p);f.installed(p);const first=f.resume(p),deadline=f.raw().expires_at;
 const target='6'.repeat(64),updates=createDeviceUpdateService(f.repo,{readRelease:async()=>({...f.metadata,clientBuild:target})}),next=await updates.create(SLUG,f.pair.deviceId,{idempotencyKey:'fixture-second-upgrade',waitForIdle:true},f.actor),claimed=updates.claim(SLUG,f.pair.deviceId,next.request.id,{hostId:HOST,clientBuild:TARGET,pid:1002},f.credential());
 updates.progress(SLUG,f.pair.deviceId,next.request.id,{state:'waiting_idle',hostId:HOST,clientBuild:TARGET,claimToken:claimed.claimToken},f.credential());
 const receipt={...p.receipt,updateId:next.request.id,targetBuild:target,sessionId:'20261019_compressed_child',checkpointDigest:'7'.repeat(64),messageCount:17,processExit:{...p.receipt.processExit,rootPid:5001}},body={updateId:next.request.id,claimToken:claimed.claimToken,receipt};
 assert.throws(()=>f.service.checkpoint(f.action.id,body,f.credential()),{code:'MAINTENANCE_ATTEMPT_REQUIRED'});
 assert.equal(f.service.checkpoint(f.action.id,{...body,maintenanceAttempt:first.maintenanceAttempt},f.credential()).generation,2);
 assert.throws(()=>f.commit(p),{code:'MAINTENANCE_CHECKPOINT_SUPERSEDED'});assert.throws(()=>f.repo.resultA2AAction(f.action.id,{deviceId:f.pair.deviceId,status:'succeeded',maintenanceAttempt:first.maintenanceAttempt}),{code:'MAINTENANCE_ATTEMPT_REQUIRED'});
 for(const state of ['updating','awaiting_heartbeat'])updates.progress(SLUG,f.pair.deviceId,next.request.id,{state,hostId:HOST,clientBuild:TARGET,claimToken:claimed.claimToken,workerPid:3002},f.credential());f.heartbeat({clientBuild:target,pid:1003});
 const second=f.service.resume(f.action.id,{updateId:next.request.id,checkpointDigest:receipt.checkpointDigest,clientBuild:target},f.credential());assert.equal(second.maintenanceAttempt.generation,2);assert.notEqual(second.maintenanceAttempt.token,first.maintenanceAttempt.token);assert.equal(f.raw().expires_at,deadline);
 assert.equal(second.receipt.sessionId,'20261019_compressed_child');
 f.repo.recordA2AEvent(f.action.id,{deviceId:f.pair.deviceId,type:'progress',maintenanceAttempt:second.maintenanceAttempt});assert.equal(f.raw().expires_at,deadline);
 assert.throws(()=>f.repo.resultA2AAction(f.action.id,{deviceId:f.pair.deviceId,status:'succeeded',maintenanceAttempt:first.maintenanceAttempt}),{code:'MAINTENANCE_ATTEMPT_REQUIRED'});
 assert.equal(f.repo.resultA2AAction(f.action.id,{deviceId:f.pair.deviceId,status:'succeeded',maintenanceAttempt:second.maintenanceAttempt,result:{output:'exact second generation'}}).status,'succeeded');
});

test('a genuine ordinary conversation model override is retained without requiring the employee default model',async t=>{
 const f=fixture(t),p=await f.prepare();f.repo.updateEmployee(f.employee.id,{model:'m1'},f.actor);
 const conversation=f.repo.createConversation(SLUG,{employeeId:f.employee.id,modelId:'m2',workingDirectory:p.receipt.cwd}),sent=f.repo.addConversationMessage(conversation.id,{content:'Keep the conversation model'}),action=f.repo.getA2AAction(sent.execution.id);assert.equal(action.payload.model,'m2');assert.equal(f.repo.getEmployee(f.employee.id).model_id,'m1');f.repo.ackA2AAction(action.id,{deviceId:f.pair.deviceId});
 const receipt={...p.receipt,actionId:action.id,executionBinding:f.repo.authorizeActionExecution(action.id,{deviceId:f.pair.deviceId}).executionBinding};assert.equal(f.service.checkpoint(action.id,{updateId:p.update.id,claimToken:p.claimToken,receipt},f.credential()).committed,true);f.installed(p);
 assert.equal(f.service.resume(action.id,{updateId:p.update.id,checkpointDigest:DIGEST,clientBuild:TARGET},f.credential()).allowed,true);
 f.repo.updateEmployee(f.employee.id,{model:'m3'},f.actor);assert.equal(f.service.resume(action.id,{updateId:p.update.id,checkpointDigest:DIGEST,clientBuild:TARGET},f.credential()).reasonCode,'MAINTENANCE_BINDING_CHANGED');
});

for(const override of ['profile','device'])test(`ordinary message ${override} override follows its genuine wire/admission rather than employee defaults`,async t=>{
 const f=fixture(t),p=await f.prepare();let pair=f.pair,host=HOST,update=p.update,claimToken=p.claimToken,profile='other';
 if(override==='device'){
  profile='default';host='8'.repeat(64);pair=f.repo.claimDevicePairing({code:f.repo.createDevicePairing(SLUG,{name:'Different authorized computer'}).code});f.repo.heartbeatDevice(SLUG,{deviceId:pair.deviceId,os:'Windows',pid:1001,clientBuild:OLD,runtimeDiscovery:{features:[REMOTE_UPDATE_FEATURE],maintenanceHostId:host}});
  update=(await f.updates.create(SLUG,pair.deviceId,{idempotencyKey:'message-device-override-update',waitForIdle:true},f.actor)).request;const credential=f.repo.authenticateDeviceToken(pair.deviceToken);claimToken=f.updates.claim(SLUG,pair.deviceId,update.id,{hostId:host,clientBuild:OLD,pid:1001},credential).claimToken;f.updates.progress(SLUG,pair.deviceId,update.id,{state:'waiting_idle',hostId:host,clientBuild:OLD,claimToken},credential);
 }
 const credential=()=>f.repo.authenticateDeviceToken(pair.deviceToken),conversation=f.repo.createConversation(SLUG,{employeeId:f.employee.id,deviceId:pair.deviceId,workingDirectory:p.receipt.cwd}),sent=f.repo.addConversationMessage(conversation.id,{content:'Run with this authorized override',runtimeProfile:profile,targetDeviceId:pair.deviceId}),action=f.repo.getA2AAction(sent.execution.id);assert.equal(action.payload.profile,profile);assert.equal(action.payload.deviceId,pair.deviceId);assert.equal(f.repo.getEmployee(f.employee.id).runtime_profile,'default');assert.equal(f.repo.getEmployee(f.employee.id).target_device_id,f.pair.deviceId);f.repo.ackA2AAction(action.id,{deviceId:pair.deviceId});
 const receipt={...p.receipt,actionId:action.id,updateId:update.id,targetBuild:update.targetBuild,profile,home:'C:\\Profiles\\'+profile,executionBinding:f.repo.authorizeActionExecution(action.id,{deviceId:pair.deviceId}).executionBinding};assert.equal(f.service.checkpoint(action.id,{updateId:update.id,claimToken,receipt},credential()).committed,true);
 for(const state of ['updating','awaiting_heartbeat'])f.updates.progress(SLUG,pair.deviceId,update.id,{state,hostId:host,clientBuild:OLD,claimToken,workerPid:3001},credential());f.repo.heartbeatDevice(SLUG,{deviceId:pair.deviceId,os:'Windows',pid:1002,clientBuild:TARGET,runtimeDiscovery:{features:[REMOTE_UPDATE_FEATURE],maintenanceHostId:host}});assert.equal(f.service.resume(action.id,{updateId:update.id,checkpointDigest:DIGEST,clientBuild:TARGET},credential()).allowed,true);
});

test('checkpoint and final CAS have only one winner; repeated submissions and SQL failure cannot partially mutate work',async t=>{
 const f=fixture(t),p=await f.prepare(),before=f.raw();
 f.db.exec("CREATE TRIGGER reject_checkpoint BEFORE INSERT ON a2a_action_events WHEN NEW.type='maintenance.checkpoint' BEGIN SELECT RAISE(ABORT,'fixture disk failure'); END");
 assert.throws(()=>f.commit(p),/fixture disk failure/);assert.deepEqual(f.raw(),before);assert.equal(f.db.prepare("SELECT count(*) n FROM a2a_action_events WHERE type LIKE 'maintenance.%'").get().n,0);f.db.exec('DROP TRIGGER reject_checkpoint');
 const results=await Promise.all(Array.from({length:8},()=>Promise.resolve().then(()=>f.commit(p))));assert.equal(new Set(results.map(x=>JSON.stringify(x))).size,1);assert.equal(f.db.prepare("SELECT count(*) n FROM a2a_action_events WHERE type='maintenance.checkpoint'").get().n,1);
 assert.throws(()=>f.repo.resultA2AAction(f.action.id,{status:'succeeded',deviceId:f.pair.deviceId,result:{output:'late final'}}),{code:'MAINTENANCE_ATTEMPT_REQUIRED'});assert.deepEqual(f.raw(),before);
 const g=fixture(t),q=await g.prepare();g.repo.resultA2AAction(g.action.id,{status:'succeeded',deviceId:g.pair.deviceId,result:{output:'finished before pause'}});const final=g.raw();assert.throws(()=>g.commit(q),{code:'MAINTENANCE_ACTION_NOT_ACKED'});assert.deepEqual(g.raw(),final);
});

for(const mutation of ['botRevision','botEpoch','deviceOwner','authority','heartbeat'])test(`resume rechecks ${mutation} rather than trusting a saved checkpoint`,async t=>{
 const f=fixture(t,{bot:true}),p=await f.prepare();f.commit(p);f.installed(p);
 if(mutation==='botRevision')f.db.prepare('UPDATE hermes_bots SET revision=revision+1 WHERE employee_id=?').run(f.employee.id);
 if(mutation==='botEpoch')f.db.prepare('UPDATE hermes_bots SET control_epoch=control_epoch+1 WHERE employee_id=?').run(f.employee.id);
 if(mutation==='deviceOwner')f.db.prepare("UPDATE devices SET owner_user_id='other-owner' WHERE id=?").run(f.pair.deviceId);
 if(mutation==='authority')f.db.prepare("UPDATE members SET role='member' WHERE user_id=? AND workspace_id=?").run(f.owner.user_id,f.raw().workspace_id);
 if(mutation==='heartbeat')f.db.prepare('UPDATE devices SET heartbeat_at=? WHERE id=?').run(new Date(Date.now()-100_000).toISOString(),f.pair.deviceId);
 if(mutation==='heartbeat'){assert.throws(()=>f.resume(p));assert.equal(f.raw().status,'acked');}else{assert.equal(f.resume(p).terminal,true);assert.equal(f.raw().status,'failed');}
});

for(const alreadyExpired of [false,true])test(`paused budget expiry settles the original action and task once without native restart (poll already expired: ${alreadyExpired})`,async t=>{
 const f=fixture(t,{bot:true}),p=await f.prepare();f.commit(p);const before=f.raw(),at=Date.parse(before.expires_at)+1,service=createActionMaintenanceService(f.repo,{now:()=>at}),count=f.db.prepare('SELECT count(*) n FROM a2a_actions').get().n;
 if(alreadyExpired)f.db.prepare("UPDATE a2a_actions SET status='expired',completed_at=? WHERE id=?").run(new Date(at).toISOString(),f.action.id);
 const input={updateId:p.update.id,checkpointDigest:DIGEST,clientBuild:OLD},response=service.resume(f.action.id,input,f.credential());assert.deepEqual(response,{allowed:false,terminal:true,reasonCode:'MAINTENANCE_BUDGET_EXPIRED',actionId:f.action.id,status:'failed'});
 assert.equal(f.raw().status,'failed');assert.equal(f.raw().expires_at,before.expires_at);assert.equal(f.db.prepare('SELECT count(*) n FROM a2a_actions').get().n,count);assert.equal(f.db.prepare('SELECT state FROM tasks WHERE id=?').get(f.task.id).state,'blocked');assert.equal(f.db.prepare('SELECT active_action_id FROM hermes_bots WHERE employee_id=?').get(f.employee.id).active_action_id,null);
 const result=JSON.parse(f.raw().result_json);assert.equal(result.code,'action_timeout');assert.deepEqual(result.processExit,p.receipt.processExit);assert.deepEqual(result.maintenanceCheckpoint,p.receipt);assert.equal(result.processExit.cancelled,false);
 const messages=f.db.prepare('SELECT * FROM task_messages WHERE task_id=?').all(f.task.id),terminal=f.raw();assert.deepEqual(service.resume(f.action.id,input,f.credential()),response);assert.deepEqual(f.raw(),terminal);assert.deepEqual(f.db.prepare('SELECT * FROM task_messages WHERE task_id=?').all(f.task.id),messages);
 assert.throws(()=>f.repo.authorizeActionExecution(f.action.id,{deviceId:f.pair.deviceId}),{code:'MAINTENANCE_ATTEMPT_REQUIRED'});
});

test('wire timeout flags cannot manufacture maintenance expiry, and an already resumed process needs its own exit proof',async t=>{
 const f=fixture(t),p=await f.prepare();f.commit(p);const forged={status:'failed',deviceId:f.pair.deviceId,result:{code:'action_timeout',maintenanceBudgetExpired:true,maintenanceCheckpoint:p.receipt,processExit:p.receipt.processExit}};assert.throws(()=>f.repo.resultA2AAction(f.action.id,forged),{code:'MAINTENANCE_ATTEMPT_REQUIRED'});
 f.installed(p);const {maintenanceAttempt}=f.resume(p);f.repo.recordA2AEvent(f.action.id,{deviceId:f.pair.deviceId,type:'action.started',maintenanceAttempt});const at=Date.parse(f.raw().expires_at)+1,service=createActionMaintenanceService(f.repo,{now:()=>at}),before=f.raw();assert.throws(()=>service.resume(f.action.id,{updateId:p.update.id,checkpointDigest:DIGEST,clientBuild:TARGET},f.credential()),{code:'MAINTENANCE_RESUMED_EXIT_REQUIRED'});assert.deepEqual(f.raw(),before);
});

test('revoked update administrator cannot resume business work and does not strand already exited work',async t=>{
 const f=fixture(t),p=await f.prepare();f.commit(p);f.db.prepare("UPDATE members SET role='member' WHERE user_id=? AND workspace_id=?").run(f.owner.user_id,f.raw().workspace_id);
 assert.equal(f.resume(p).reasonCode,'MAINTENANCE_AUTHORITY_REVOKED');assert.equal(f.raw().status,'failed');
});

for(const mutation of ['employeeConfig','admin','botPause','botRevision','deleted','cancel'])test(`a verified native pause after permanent ${mutation} fence is committed and terminalized without replay`,async t=>{
 const f=fixture(t,{bot:['botPause','botRevision','deleted'].includes(mutation)}),p=await f.prepare(),before=f.raw(),count=f.db.prepare('SELECT count(*) n FROM a2a_actions').get().n;
 if(mutation==='employeeConfig')f.repo.updateEmployee(f.employee.id,{description:'Changed while the last tool completed'},f.actor);
 if(mutation==='admin')f.db.prepare("UPDATE members SET role='member' WHERE user_id=? AND workspace_id=?").run(f.owner.user_id,before.workspace_id);
 if(mutation==='botPause'){const bots=createManagementService(f.repo).bots,b=bots.get(SLUG,f.employee.id);bots.control(SLUG,b.id,{operation:'pause',expectedRevision:b.revision,expectedControlEpoch:b.control_epoch});}
 if(mutation==='botRevision')f.db.prepare('UPDATE hermes_bots SET revision=revision+1 WHERE employee_id=?').run(f.employee.id);
 if(mutation==='deleted')f.db.prepare("UPDATE employees SET status='deleted' WHERE id=?").run(f.employee.id);
 if(mutation==='cancel')f.repo.createA2AAction(SLUG,{type:'action.cancel',payload:{actionId:f.action.id,deviceId:f.pair.deviceId}});
 const response=f.commit(p);assert.equal(response.committed,true);assert.equal(response.terminal,true);assert.equal(response.actionId,f.action.id);assert.equal(response.status,'failed');assert.equal(f.raw().status,'failed');assert.equal(f.raw().expires_at,before.expires_at);
 const result=JSON.parse(f.raw().result_json);assert.equal(result.code,'maintenance_resume_revoked');assert.equal(result.maintenanceRevokedReason,response.reasonCode);assert.deepEqual(result.maintenanceCheckpoint,p.receipt);assert.deepEqual(result.processExit,p.receipt.processExit);assert.equal(f.db.prepare('SELECT state FROM tasks WHERE id=?').get(f.task.id).state,'blocked');
 assert.equal(f.db.prepare('SELECT count(*) n FROM a2a_actions').get().n,count+(mutation==='cancel'?1:0));if(['botPause','botRevision','deleted'].includes(mutation))assert.equal(f.db.prepare('SELECT active_action_id FROM hermes_bots WHERE employee_id=?').get(f.employee.id).active_action_id,null);
 const messages=f.db.prepare('SELECT * FROM task_messages WHERE task_id=?').all(f.task.id);assert.equal(f.commit(p).terminal,true);assert.deepEqual(f.db.prepare('SELECT * FROM task_messages WHERE task_id=?').all(f.task.id),messages);
});

test('permanent config changes cannot turn a wrong-device or mismatched receipt into a terminal grant',async t=>{
 const f=fixture(t),p=await f.prepare();f.repo.updateEmployee(f.employee.id,{description:'Change config'},f.actor);const before=f.raw(),body={updateId:p.update.id,claimToken:p.claimToken,receipt:p.receipt},other=f.repo.claimDevicePairing({code:f.repo.createDevicePairing(SLUG,{name:'Other device'}).code}),credential=f.repo.authenticateDeviceToken(other.deviceToken);
 assert.throws(()=>f.service.checkpoint(f.action.id,body,credential),{code:'MAINTENANCE_BINDING_CONFLICT'});assert.throws(()=>f.commit({...p,receipt:{...p.receipt,executionBinding:'f'.repeat(64)}}),{code:'MAINTENANCE_BINDING_CONFLICT'});assert.throws(()=>f.commit({...p,receipt:{...p.receipt,processExit:{...p.receipt.processExit,treeConfirmed:false}}}),{code:'MAINTENANCE_CHECKPOINT_INVALID'});assert.deepEqual(f.raw(),before);assert.equal(f.db.prepare("SELECT count(*) n FROM a2a_action_events WHERE action_id=? AND type LIKE 'maintenance.%'").get(f.action.id).n,0);
});

for(const expiredStatus of [false,true])test(`first checkpoint received after the original deadline closes from exact exit evidence (already expired: ${expiredStatus})`,async t=>{
 const f=fixture(t),p=await f.prepare(),before=f.raw(),at=Date.parse(before.expires_at)+1,service=createActionMaintenanceService(f.repo,{now:()=>at});f.db.prepare('UPDATE devices SET heartbeat_at=? WHERE id=?').run(new Date(at).toISOString(),f.pair.deviceId);if(expiredStatus)f.db.prepare("UPDATE a2a_actions SET status='expired' WHERE id=?").run(f.action.id);
 const response=service.checkpoint(f.action.id,{updateId:p.update.id,claimToken:p.claimToken,receipt:p.receipt},f.credential());assert.equal(response.committed,true);assert.equal(response.terminal,true);assert.equal(response.reasonCode,'MAINTENANCE_BUDGET_EXPIRED');assert.equal(f.raw().status,'failed');assert.deepEqual(JSON.parse(f.raw().result_json).processExit,p.receipt.processExit);
});

test('revoked checkpoint and task finalization roll back together when the terminal write fails',async t=>{
 const f=fixture(t),p=await f.prepare();f.repo.updateEmployee(f.employee.id,{description:'Changed'},f.actor);const before=f.raw(),messages=f.db.prepare('SELECT * FROM task_messages WHERE task_id=?').all(f.task.id);f.db.exec("CREATE TRIGGER terminal_disk_failure BEFORE UPDATE ON a2a_actions WHEN NEW.id='"+f.action.id+"' AND NEW.status='failed' BEGIN SELECT RAISE(ABORT,'terminal disk failure'); END");
 assert.throws(()=>f.commit(p),/terminal disk failure/);assert.deepEqual(f.raw(),before);assert.deepEqual(f.db.prepare('SELECT * FROM task_messages WHERE task_id=?').all(f.task.id),messages);assert.equal(f.db.prepare("SELECT count(*) n FROM a2a_action_events WHERE action_id=? AND type LIKE 'maintenance.%'").get(f.action.id).n,0);f.db.exec('DROP TRIGGER terminal_disk_failure');assert.equal(f.commit(p).terminal,true);
});

test('same daemon ACK after a committed pause budget expires terminalizes the task and Bot before confirming delivery',async t=>{
 const f=fixture(t,{bot:true}),p=await f.prepare();f.commit(p);const before=f.raw(),at=Date.parse(before.expires_at)+1;createActionMaintenanceService(f.repo,{now:()=>at});const count=f.db.prepare('SELECT count(*) n FROM a2a_actions').get().n;
 const ack=f.repo.ackA2AAction(f.action.id,{deviceId:f.pair.deviceId,receiptOnly:true});assert.equal(ack.status,'failed');assert.equal(f.raw().status,'failed');assert.equal(f.db.prepare('SELECT active_action_id FROM hermes_bots WHERE employee_id=?').get(f.employee.id).active_action_id,null);assert.equal(f.db.prepare('SELECT state FROM tasks WHERE id=?').get(f.task.id).state,'blocked');assert.deepEqual(JSON.parse(f.raw().result_json).processExit,p.receipt.processExit);assert.equal(JSON.parse(f.raw().result_json).code,'action_timeout');assert.equal(f.db.prepare('SELECT count(*) n FROM a2a_actions').get().n,count);assert.equal(f.repo.ackA2AAction(f.action.id,{deviceId:f.pair.deviceId,receiptOnly:true}).status,'failed');
});

test('failed upgrade without a verified restored installation closes the checkpoint, leaving room for a new repair intent',async t=>{
 const f=fixture(t,{bot:true}),p=await f.prepare();f.commit(p);f.updates.progress(SLUG,f.pair.deviceId,p.update.id,{state:'updating',hostId:HOST,clientBuild:OLD,claimToken:p.claimToken,workerPid:3001},f.credential());f.updates.progress(SLUG,f.pair.deviceId,p.update.id,{state:'failed',hostId:HOST,clientBuild:OLD,claimToken:p.claimToken,code:'CLIENT_UPDATE_WORKER_FAILED'},f.credential());f.heartbeat({pid:1003});
 const maintenanceFailure={workerTerminal:true,maintenanceLockAbsent:true,installedBuild:OLD,pid:1003},input={updateId:p.update.id,checkpointDigest:DIGEST,clientBuild:OLD,maintenanceFailure};
 for(const value of [{...maintenanceFailure,workerTerminal:false},{...maintenanceFailure,maintenanceLockAbsent:false},{...maintenanceFailure,pid:1001},{...maintenanceFailure,installedBuild:TARGET},{...maintenanceFailure,originalInstallationRestored:false}])assert.throws(()=>f.service.resume(f.action.id,{...input,maintenanceFailure:value},f.credential()),{code:'MAINTENANCE_UPDATE_FAILURE_INVALID'});
 const response=f.service.resume(f.action.id,input,f.credential());assert.deepEqual(response,{allowed:false,terminal:true,reasonCode:'MAINTENANCE_UPDATE_FAILED',actionId:f.action.id,status:'failed'});assert.equal(f.db.prepare('SELECT active_action_id FROM hermes_bots WHERE employee_id=?').get(f.employee.id).active_action_id,null);assert.deepEqual(JSON.parse(f.raw().result_json).processExit,p.receipt.processExit);assert.equal(f.raw().status,'failed');assert.equal((await f.updates.create(SLUG,f.pair.deviceId,{idempotencyKey:'repair-after-unrestored-failure',waitForIdle:true},f.actor)).request.state,'requested');
});

function request(app,url,{cookie='',token='',method='GET',body}={}){
 const socket=new Duplex({read(){},write(_chunk,_encoding,done){done();}}),req=new IncomingMessage(socket),res=new ServerResponse(req),chunks=[],bytes=body===undefined?null:Buffer.from(JSON.stringify(body));req.method=method;req.url=url;req.headers={host:'pause.fixture',cookie,...(token?{'x-ziwei-device-token':token}:{}),...(bytes?{'content-type':'application/json','content-length':String(bytes.length)}:{})};
 return new Promise((resolve,reject)=>{res.write=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));done?.();return true;};res.end=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));done?.();resolve({status:res.statusCode,json:chunks.length?JSON.parse(Buffer.concat(chunks).toString()):null});res.emit('finish');socket.destroy();return res;};req.on('error',reject);res.on('error',reject);app.handle(req,res,error=>reject(error||new Error('Unhandled fixture route')));if(bytes)req.push(bytes);req.push(null);});
}

test('dedicated HTTP contract is device-only and ordinary result route rejects stale generation before repository entry',async t=>{
 const f=fixture(t),p=await f.prepare(),app=createApp({memory:true,requireAuth:true,requireDeviceAuth:true,enableScheduler:false,repository:f.repo,auth:f.auth,deviceUpdates:{readRelease:async()=>f.metadata}}),base=`/a2a/v1/actions/${f.action.id}`,body={workspace:SLUG,updateId:p.update.id,claimToken:p.claimToken,receipt:p.receipt},cookie=`ziwei_session=${f.owner.session.token}`;
 assert.equal((await request(app,base+'/maintenance-checkpoint',{method:'POST',cookie,body})).status,401);
 const paused=await request(app,base+'/maintenance-checkpoint',{method:'POST',token:f.pair.deviceToken,body});assert.equal(paused.status,200,JSON.stringify(paused.json));assert.equal(paused.json.committed,true);f.installed(p);
 assert.equal((await request(app,base+'/execution-admission',{method:'POST',token:f.pair.deviceToken,body:{workspace:SLUG}})).json.code,'MAINTENANCE_ATTEMPT_REQUIRED');
 const resumed=await request(app,base+'/authorize-maintenance-resume',{method:'POST',token:f.pair.deviceToken,body:{workspace:SLUG,updateId:p.update.id,checkpointDigest:DIGEST,clientBuild:TARGET}});assert.equal(resumed.status,200,JSON.stringify(resumed.json));assert.equal(resumed.json.allowed,true);
 assert.equal((await request(app,base+'/execution-admission',{method:'POST',token:f.pair.deviceToken,body:{workspace:SLUG,maintenanceAttempt:resumed.json.maintenanceAttempt}})).json.allowed,true);
 assert.deepEqual((await request(app,base+'/maintenance-checkpoint',{token:f.pair.deviceToken})).json.maintenanceAttempt,resumed.json.maintenanceAttempt);
 const original=f.repo.resultA2AAction;let called=false;f.repo.resultA2AAction=()=>{called=true;throw Error('must not call');};assert.equal((await request(app,base+'/result',{method:'POST',token:f.pair.deviceToken,body:{workspace:SLUG,status:'succeeded'}})).json.code,'MAINTENANCE_ATTEMPT_REQUIRED');assert.equal(called,false);f.repo.resultA2AAction=original;
 const events=await request(app,base+'/events',{token:f.pair.deviceToken});assert.equal(JSON.stringify(events.json).includes(resumed.json.maintenanceAttempt.token),false);
});
