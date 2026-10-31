import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActionDispatcher} from '../src/daemon.mjs';
import {MAINTENANCE_COMMIT_TTL_MS} from '../src/daemon.mjs';
import {createActionDelivery} from '../src/daemon-action-delivery.mjs';
import {executionBinding} from '../src/execution-admission.mjs';
import {validateMaintenancePause,markMaintenancePaused,consumeMaintenancePaused} from '../src/maintenance-checkpoint.mjs';

const update={id:'client-update_fixture',targetBuild:'a'.repeat(64)};
const identity={apiBase:'https://example.invalid',workspace:'fixture',deviceId:'device-fixture'};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const exit=()=>({platform:'win32',supervisor:'windows-job',launched:true,rootPid:123,rootExitCode:0,rootConfirmed:true,treeConfirmed:true,activeProcesses:0,cancelled:false,hostExitCode:0,backgroundProcessesRetained:false});
const action=(cwd,id='action-fixture')=>({id,type:'conversation.execute',workspace_id:'ws-fixture',payload:{cwd,workdir:cwd,profile:'bot-fixture',runtime:'Hermes',deviceId:identity.deviceId,employeeId:'employee-fixture',conversationId:'conv-fixture',messageId:'msg-fixture',hermesBot:{revision:2,controlEpoch:3}}});
const receipt=(a,e=exit())=>({schemaVersion:1,actionId:a.id,executionBinding:executionBinding(a),updateId:update.id,targetBuild:update.targetBuild,runtime:'Hermes',profile:a.payload.profile,home:path.join(a.payload.cwd,'home'),cwd:a.payload.cwd,sessionId:'20261019_123456_fixture',checkpointDigest:'b'.repeat(64),messageCount:4,pendingTools:0,processExit:e});
const paused=r=>markMaintenancePaused({status:'maintenance_paused',result:{maintenanceCheckpoint:r}},r);
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-checkpoint-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,stateFile:path.join(root,'state.json'),directory:path.join(root,'delivery'),workdir:root,workspace:identity.workspace,deviceId:identity.deviceId};}
function controlledExecutor(a,{onResume}={}){
 const ready=deferred(),boundary=deferred();let context;
 return {ready,context:()=>context,finish:()=>boundary.resolve(),execute:async(_action,c)=>{
  context=c;
  if(c.maintenanceResume){onResume?.(c.maintenanceResume);c.onSupervision({completionEvidence:Promise.resolve(exit()),stop:async()=>exit()});return {status:'succeeded',result:{resumed:true}};}
  const proof=deferred();c.onSupervision({completionEvidence:proof.promise,stop:async()=>{proof.resolve(exit());return exit();}});
  c.onMaintenancePauseControl(request=>{assert.deepEqual(request,update);return {accepted:true};});ready.resolve();
  await boundary.promise;const e=exit();proof.resolve(e);return paused(receipt(a,e));
 }};
}
async function pauseDispatcher(t,options={}){const f=fixture(t),a=action(f.root),native=controlledExecutor(a,options);const d=new ActionDispatcher({...f,execute:native.execute,onMaintenancePaused:async()=>true,...options});const running=d.dispatch(a);await native.ready.promise;await d.requestMaintenancePause(update);native.finish();const value=await running;assert.equal(value.status,'maintenance_paused');return {f,a,d,native,value};}

test('checkpoint brand is private, cloned, immutable and single consumption',()=>{
 const a=action('/fixture'),r=receipt(a),value=paused(r);r.sessionId='changed';
 const saved=consumeMaintenancePaused(value);assert.equal(saved.sessionId,'20261019_123456_fixture');assert.equal(Object.isFrozen(saved.processExit),true);
 assert.equal(consumeMaintenancePaused(value),null);assert.equal(consumeMaintenancePaused(JSON.parse(JSON.stringify(value))),null);
 assert.throws(()=>markMaintenancePaused({status:'maintenance_paused'}, {...receipt(a),pendingTools:1}),/Invalid maintenance/);
});
for(const [name,mutate]of [
 ['pending tool',r=>r.pendingTools=1],['unknown root',r=>r.processExit.rootConfirmed=false],['live tree',r=>r.processExit.activeProcesses=1],
 ['retained background',r=>r.processExit.backgroundProcessesRetained=true],['failed root',r=>r.processExit.rootExitCode=1],['cancelled',r=>r.processExit.cancelled=true],
 ['failed host',r=>r.processExit.hostExitCode=1],['unknown property',r=>r.extra=true],['relative home',r=>r.home='relative'],['empty session',r=>r.sessionId=''],
 ['failure marker',r=>r.processExit.failureCode='UNCONFIRMED'],['unknown exit field',r=>r.processExit.children=[]],['root not integer',r=>r.processExit.rootPid=0]
])test(`checkpoint rejects ${name}`,()=>{const r=receipt(action('/fixture'));mutate(r);assert.equal(validateMaintenancePause(r),false);});
test('checkpoint rejects getters without evaluating them and binds each expected value',()=>{let read=false;const r=receipt(action('/fixture'));Object.defineProperty(r,'sessionId',{enumerable:true,get(){read=true;return 'session';}});assert.equal(validateMaintenancePause(r),false);assert.equal(read,false);assert.equal(validateMaintenancePause(receipt(action('/fixture')),{targetBuild:'c'.repeat(64)}),false);});

test('maintenance waits for native tool boundary without abort and persists no terminal result',async t=>{
 const f=fixture(t),a=action(f.root),native=controlledExecutor(a),d=new ActionDispatcher({...f,execute:native.execute,onMaintenancePaused:async()=>true});
 const running=d.dispatch(a);await native.ready.promise;
 assert.deepEqual(await d.requestMaintenancePause(update),[{actionId:a.id,accepted:true}]);assert.equal(native.context().signal.aborted,false);assert.equal(d.status(a.id).running,true);
 native.finish();const value=await running;assert.equal(value.status,'maintenance_paused');assert.equal(d.status(a.id).running,false);assert.equal(d.status(a.id).paused,true);assert.equal(d.completedResult(a),null);assert.equal(d.quarantined,false);
 const saved=JSON.parse(fs.readFileSync(f.stateFile));assert.equal(saved.completed.length,0);assert.deepEqual(saved.started[0].maintenancePause,receipt(a));assert.equal(Number.isFinite(saved.started[0].hardDeadline),true);assert.equal(d.maintenancePendingCommits.length,0);
});
test('restart denies resume by default, then authorized same-session resume executes once with original budget',async t=>{
 let clock=Date.now();const {f,a,d}=await pauseDispatcher(t,{now:()=>clock});const before=JSON.parse(fs.readFileSync(f.stateFile)).started[0];clock+=10_000;let calls=0;
 const blocked=new ActionDispatcher({...f,now:()=>clock,execute:async()=>{calls++;},onMaintenancePaused:async()=>true});assert.equal(blocked.quarantined,false);assert.equal((await blocked.dispatch(a)).status,'maintenance_paused');assert.equal(calls,0);
 let resume;const allowed=new ActionDispatcher({...f,now:()=>clock,onMaintenancePaused:async()=>true,authorizeResume:async()=>true,execute:async(_a,c)=>{calls++;resume=c.maintenanceResume;const during=JSON.parse(fs.readFileSync(f.stateFile)).started[0];assert.equal(during.hardDeadline,before.hardDeadline);assert.equal(during.startedAt,before.startedAt);c.onSupervision({completionEvidence:Promise.resolve(exit()),stop:async()=>exit()});return {status:'succeeded',result:{ok:true}};}});
 const results=await Promise.all([allowed.dispatch(a),allowed.dispatch(a)]);assert.equal(calls,1);assert.deepEqual(resume,receipt(a));assert.equal(results[0].status,'succeeded');assert.equal(results[1].status,'duplicate');assert.equal(allowed.status(a.id).paused,false);assert.equal((await allowed.dispatch(a)).status,'duplicate');assert.equal(calls,1);
 assert.equal(d.completedResult(a),null,'old daemon instance never invents a terminal result');
});
test('pause server commit is retried and cannot authorize execution until durable acceptance',async t=>{
 let commits=0,allow=false,calls=0;const {f,a,d}=await pauseDispatcher(t,{onMaintenancePaused:async()=>{commits++;return allow;}});
 assert.equal(d.maintenancePendingCommits.length,1);assert.equal((await d.dispatch(a)).status,'maintenance_paused');assert.equal(d.maintenancePendingCommits.length,1);allow=true;assert.deepEqual(await d.retryMaintenanceCommits([a]),{pending:0});assert.equal(commits,3);
 const restarted=new ActionDispatcher({...f,onMaintenancePaused:async()=>false,authorizeResume:async()=>{calls++;return true;},execute:async()=>{calls++;}});assert.equal((await restarted.dispatch(a)).status,'maintenance_paused');assert.equal(calls,0);
});

test('a maintenance commit that never reaches the server is archived after its deadline',async t=>{
 let clock=Date.now();const {f,a,d}=await pauseDispatcher(t,{now:()=>clock,onMaintenancePaused:async()=>false});
 assert.equal(d.maintenancePendingCommits.length,1);clock+=MAINTENANCE_COMMIT_TTL_MS+1;
 assert.deepEqual(await d.retryMaintenanceCommits([a]),{pending:0});
 const result=d.completedResult(a);assert.equal(result.code,'MAINTENANCE_COMMIT_TIMEOUT');assert.equal(result.executionState,'uncertain');assert.equal(result.result.maintenanceCommitUnknown,true);assert.equal(d.maintenancePausedActions.length,0);assert.equal(d.quarantined,false);
});
test('modified payload, device, profile or resume window cannot reuse checkpoint after restart',async t=>{
 const {f,a}=await pauseDispatcher(t);const base=fs.readFileSync(f.stateFile);
 for(const changed of [{...a,payload:{...a.payload,prompt:'different'}},{...a,payload:{...a.payload,profile:'other'}},{...a,payload:{...a.payload,deviceId:'other'}}]){let calls=0;const d=new ActionDispatcher({...f,onMaintenancePaused:async()=>true,authorizeResume:async()=>true,execute:async()=>{calls++;}});assert.equal((await d.dispatch(changed)).code,'EXECUTION_UNCERTAIN');assert.equal(calls,0);}
 const state=JSON.parse(base);state.started[0].maintenanceResumeStarted=true;fs.writeFileSync(f.stateFile,JSON.stringify(state));const d=new ActionDispatcher({...f,execute:async()=>assert.fail('resume window may have spawned')});assert.equal(d.quarantined,true);assert.equal((await d.dispatch(a)).code,'EXECUTION_UNCERTAIN');
});
test('cancel while paused persists cancellation with original honest exit and cannot resume',async t=>{
 const {f,a,d}=await pauseDispatcher(t);assert.equal(d.cancel(a.id),true);const result=d.completedResult(a);assert.equal(result.code,'cancelled');assert.equal(result.result.maintenanceCancelled,true);assert.equal(result.result.processExit.cancelled,false);assert.deepEqual(result.result.maintenanceCheckpoint,receipt(a));assert.equal(d.maintenancePausedActions.length,0);
 const after=new ActionDispatcher({...f,authorizeResume:async()=>true,execute:async()=>assert.fail('cancelled pause may not resume')});assert.equal((await after.dispatch(a)).code,'cancelled');assert.equal(after.quarantined,false);
});
test('cancel wins while checkpoint server commit is awaiting response',async t=>{
 const commit=deferred(),entered=deferred(),f=fixture(t),a=action(f.root),native=controlledExecutor(a);const d=new ActionDispatcher({...f,execute:native.execute,onMaintenancePaused:async()=>{entered.resolve();return commit.promise;}});
 const running=d.dispatch(a);await native.ready.promise;await d.requestMaintenancePause(update);native.finish();await entered.promise;assert.equal(d.cancel(a.id),true);commit.resolve(true);const result=await running;assert.equal(result.code,'cancelled');assert.equal(result.status,'duplicate');assert.equal(d.maintenancePausedActions.length,0);
});
test('cancel during resumed admission uses existing paused tree proof without launching a new process',async t=>{
 const {f,a}=await pauseDispatcher(t),admission=deferred(),entered=deferred();let calls=0;
 const after=new ActionDispatcher({...f,onMaintenancePaused:async()=>true,authorizeResume:async()=>true,authorizeExecute:async()=>{entered.resolve();await admission.promise;},execute:async()=>{calls++;assert.fail('cancelled admission must not launch');}});
 const pending=after.dispatch(a);await entered.promise;assert.equal(JSON.parse(fs.readFileSync(f.stateFile)).started[0].maintenanceResumeStarted,true);assert.equal(after.cancel(a.id),true);admission.resolve();const value=await pending;assert.equal(value.code,'cancelled');assert.equal(value.result.maintenanceCancelled,true);assert.deepEqual(value.result.processExit,receipt(a).processExit);assert.equal(calls,0);assert.equal(after.quarantined,false);
});
test('resume never renews exhausted original execution deadline',async t=>{
 let clock=Date.now();const {f,a}=await pauseDispatcher(t,{now:()=>clock});const old=JSON.parse(fs.readFileSync(f.stateFile));clock=old.started[0].hardDeadline+1;let calls=0;
 const after=new ActionDispatcher({...f,now:()=>clock,onMaintenancePaused:async()=>true,authorizeResume:async()=>true,execute:async()=>{calls++;}});const result=await after.dispatch(a);assert.equal(result.code,'action_timeout');assert.equal(calls,0);assert.deepEqual(result.result.processExit,receipt(a).processExit);
});
test('unbranded pause and mismatched actual native exit never produce valid pause',async t=>{
 for(const branded of [false,true]){const f=fixture(t),a=action(f.root),ready=deferred(),finish=deferred();const d=new ActionDispatcher({...f,execute:async(_a,c)=>{c.onMaintenancePauseControl(()=>({accepted:true}));const actual={...exit(),rootPid:124};c.onSupervision({completionEvidence:Promise.resolve(actual),stop:async()=>actual});ready.resolve();await finish.promise;return branded?paused(receipt(a)):{status:'maintenance_paused',result:{maintenanceCheckpoint:receipt(a)}};}});const pending=d.dispatch(a);await ready.promise;await d.requestMaintenancePause(update);finish.resolve();const result=await pending;assert.notEqual(result.status,'maintenance_paused');assert.equal(d.maintenancePausedActions.length,0);assert.equal(branded?result.code:result.code,branded?'EXECUTION_UNCERTAIN':'execution_not_completed');}
});

function deliveryFixture(t,dispatch){const f=fixture(t),a=action(f.root),calls=[];let status='acked';const post=async(url,body)=>{calls.push({url,body:structuredClone(body)});if(url.endsWith('/ack'))return {id:a.id,status,deviceId:identity.deviceId,expires_at:new Date(Date.now()+60*60*1000).toISOString()};if(url.endsWith('/events'))return {id:body.eventId};status=body.status;return {id:a.id,status};};const create=extra=>createActionDelivery({directory:f.directory,identity,dispatch,post,retryDelays:[],...extra});return {...f,a,calls,create,setStatus:v=>status=v};}
test('delivery pauses durably without final upload, recovers original action and excludes maintenance pending',async t=>{
 const f=deliveryFixture(t,async()=>paused(receipt(f.a)));const delivery=f.create();assert.deepEqual(await delivery.execute(f.a),{state:'maintenance_paused',status:null});assert.equal(delivery.pendingCount,0);assert.equal(delivery.pausedCount,1);assert.deepEqual(delivery.pausedActionIds,[f.a.id]);assert.equal(delivery.canDeliverWithoutExecution(f.a),false);assert.equal(f.calls.some(c=>c.url.endsWith('/result')),false);
 const restart=f.create();assert.deepEqual(restart.recoverActions().map(a=>a.id),[f.a.id]);assert.equal(restart.pausedCount,1);assert.deepEqual(restart.getMaintenancePause(f.a.id),receipt(f.a));assert.equal(fs.readdirSync(f.directory).filter(n=>n.endsWith('.pause.json')).length,1);assert.equal(fs.readdirSync(f.directory).some(n=>n.endsWith('.result.json')),false);
});
test('delivery verifies checkpoint digest and exact original wire payload after restart',async t=>{
 const f=deliveryFixture(t,async()=>paused(receipt(f.a)));await f.create().execute(f.a);const file=path.join(f.directory,fs.readdirSync(f.directory).find(n=>n.endsWith('.pause.json')));const r=JSON.parse(fs.readFileSync(file));r.sessionId='other';fs.writeFileSync(file,JSON.stringify(r));const events=[];const d=f.create({onEvent:(...args)=>events.push(args)});assert.deepEqual(d.recoverActions(),[]);assert.equal(events[0][0],'a2a_journal_recovery_refused');await assert.rejects(d.execute(f.a),/corrupt/);
});
test('terminal server ACK on paused action never dispatches or resumes',async t=>{
 const f=deliveryFixture(t,async()=>paused(receipt(f.a)));await f.create().execute(f.a);f.setStatus('succeeded');const after=f.create({dispatch:async()=>assert.fail('server terminal cannot resume')});assert.equal((await after.execute(f.a)).state,'confirmed');assert.equal(after.pausedCount,0);assert.equal(fs.readdirSync(f.directory).some(n=>n.endsWith('.pause.json')),false);
});
test('resume permit persists, generations cannot regress and old queued events keep original attempt',async t=>{
 const f=deliveryFixture(t,async()=>paused(receipt(f.a)));let online=false;
 const post=async(url,body)=>{f.calls.push({url,body:structuredClone(body)});if(url.endsWith('/events')){if(!online)throw new Error('offline progress');return {}; }if(url.endsWith('/ack'))return {id:f.a.id,status:'acked',expires_at:new Date(Date.now()+60*60*1000).toISOString()};return {id:f.a.id,status:body.status};};
 const d=f.create({post});await d.execute(f.a);d.recordEvent(f.a.id,'old',{message:'old generation'});await d.whenIdle();const permit={generation:1,token:'fixture-only-secret-token'};assert.equal(d.setMaintenanceAttempt(f.a.id,permit),true);assert.deepEqual(d.maintenanceAttempt(f.a.id),permit);const restart=f.create({post});restart.recoverActions();assert.deepEqual(restart.maintenanceAttempt(f.a.id),permit);assert.throws(()=>restart.setMaintenanceAttempt(f.a.id,{generation:1,token:'different-fixture-token'}),/generation/);assert.throws(()=>restart.setMaintenanceAttempt(f.a.id,{generation:0,token:'fixture-only-secret-token'}),/Invalid/);
 restart.recordEvent(f.a.id,'new',{message:'new generation'});await restart.whenIdle();online=true;await restart.execute(f.a);const events=f.calls.filter(c=>c.url.endsWith('/events'));assert.equal(events.findLast(c=>c.body.type==='old').body.maintenanceAttempt,undefined);assert.deepEqual(events.findLast(c=>c.body.type==='new').body.maintenanceAttempt,permit);
});
test('resumed terminal body freezes permit in result blob, never retrofits later generations',async t=>{
 let resume=false,failUpload=true;const f=deliveryFixture(t,async()=>resume?{status:'succeeded',result:{ok:true}}:paused(receipt(f.a)));const basePost=async(url,body)=>{f.calls.push({url,body:structuredClone(body)});if(url.endsWith('/ack'))return {id:f.a.id,status:'acked',expires_at:new Date(Date.now()+60*60*1000).toISOString()};if(url.endsWith('/events'))return {};if(failUpload)throw new Error('upload offline');return {id:f.a.id,status:body.status};};const d=f.create({post:basePost});await d.execute(f.a);const permit={generation:2,token:'fixture-only-secret-token'};d.setMaintenanceAttempt(f.a.id,permit);resume=true;await assert.rejects(d.execute(f.a),/upload offline/);assert.throws(()=>d.setMaintenanceAttempt(f.a.id,{generation:3,token:'another-fixture-token'}),/durable paused/);failUpload=false;await d.execute(f.a);assert.deepEqual(f.calls.findLast(c=>c.url.endsWith('/result')).body.maintenanceAttempt,permit);
});

test('maintenance progress retries without dispatch and stays visible to upgrade idle gate',async t=>{
 let calls=0,online=false;const f=deliveryFixture(t,async()=>{calls++;return paused(receipt(f.a));});const post=async(url,body)=>{if(url.endsWith('/ack'))return {id:f.a.id,status:'acked',expires_at:new Date(Date.now()+60*60*1000).toISOString()};if(url.endsWith('/events')){if(!online)throw new Error('network unavailable');return {}; }assert.fail('maintenance must not finalize');};const d=f.create({post});await d.execute(f.a);assert.equal(d.recordEvent(f.a.id,'action.maintenance_paused',{message:'saved'}),true);await d.whenIdle();assert.equal(d.pendingEventCount,1);assert.equal(d.maintenanceEventsPending,1);assert.deepEqual(await d.flushMaintenanceEvents(),{pending:1});online=true;assert.deepEqual(await d.flushMaintenanceEvents(),{pending:0});assert.equal(d.pendingEventCount,0);assert.equal(calls,1);assert.equal(d.pausedCount,1);assert.equal(d.pendingCount,0);
});
test('checkpoint commit drains old-generation events after network retry without dispatch',async t=>{
 const f=deliveryFixture(t,async()=>paused(receipt(f.a)));let delivery,checkpoint=false,online=false,dispatches=0;
 const post=async(url,body)=>{if(url.endsWith('/ack'))return {id:f.a.id,status:'acked',expires_at:new Date(Date.now()+60*60*1000).toISOString()};if(url.endsWith('/events')){assert.equal(checkpoint,false);if(!online)throw new Error('network unavailable');return {}; }assert.fail('no final');};
 delivery=f.create({post,dispatch:async()=>{dispatches++;return paused(receipt(f.a));}});await delivery.execute(f.a);delivery.recordEvent(f.a.id,'action.output',{message:'last old generation progress'});await delivery.whenIdle();await assert.rejects(delivery.flushActionEvents(f.a.id),/network unavailable/);assert.equal(delivery.pendingEventCount,1);online=true;assert.deepEqual(await delivery.flushActionEvents(f.a.id),{pending:0});checkpoint=true;assert.equal(delivery.pendingEventCount,0);assert.equal(dispatches,1);assert.deepEqual(await delivery.flushActionEvents('absent-action'),{pending:0});
});
test('full recovery provides original wire payload for commit after crash before pause delivery persisted',async t=>{
 const f=fixture(t),a=action(f.root),native=controlledExecutor(a);let commit=false;const d=new ActionDispatcher({...f,execute:native.execute,onMaintenancePaused:async()=>commit});let reject=true;const delivery=createActionDelivery({directory:f.directory,identity,dispatch:async wire=>{const value=await d.dispatch(wire);if(reject)throw new Error('fixture crash before pause envelope');return value;},retryDelays:[],post:async()=>({id:a.id,status:'acked',expires_at:new Date(Date.now()+60*60*1000).toISOString()})});const running=delivery.execute(a);await native.ready.promise;await d.requestMaintenancePause(update);native.finish();await assert.rejects(running,/fixture crash/);assert.equal(d.maintenancePendingCommits.length,1);
 const restarted=new ActionDispatcher({...f,execute:async()=>assert.fail('not authorized'),onMaintenancePaused:async wire=>{assert.equal(executionBinding(wire),executionBinding(a));return true;}});const full=delivery.recoverActions({full:true});assert.equal(full[0].payload.profile,a.payload.profile);assert.equal(full[0].payload.hermesBot.revision,2);assert.deepEqual(await restarted.retryMaintenanceCommits(full),{pending:0});assert.equal(restarted.quarantined,false);
});
test('real dispatcher and delivery preserve one action across restart, permission save and terminal upload',async t=>{
 const f=fixture(t),a=action(f.root),native=controlledExecutor(a),posts=[];let daemon,delivery,serverStatus='acked',ready=false,resumes=0;
 const post=async(url,body)=>{posts.push({url,body:structuredClone(body)});if(url.endsWith('/ack'))return {id:a.id,status:serverStatus,expires_at:new Date(Date.now()+60*60*1000).toISOString()};if(url.endsWith('/events'))return {};serverStatus=body.status;return {id:a.id,status:serverStatus};};
 const makeDelivery=()=>createActionDelivery({directory:f.directory,identity,post,dispatch:wire=>daemon.dispatch(wire),recoverResult:wire=>daemon.completedResult(wire),retryDelays:[]});
 daemon=new ActionDispatcher({...f,execute:native.execute,onMaintenancePaused:async()=>true});delivery=makeDelivery();const running=delivery.execute(a);await native.ready.promise;await daemon.requestMaintenancePause(update);native.finish();assert.equal((await running).state,'maintenance_paused');assert.equal(posts.some(p=>p.url.endsWith('/result')),false);
 daemon=new ActionDispatcher({...f,onMaintenancePaused:async wire=>{assert.equal(executionBinding(wire),executionBinding(a));return true;},authorizeResume:async()=>{if(!ready)return false;delivery.setMaintenanceAttempt(a.id,{generation:1,token:'fixture-only-resume-token'});return true;},execute:async(_a,c)=>{resumes++;assert.deepEqual(c.maintenanceResume,receipt(a));assert.deepEqual(delivery.maintenanceAttempt(a.id),{generation:1,token:'fixture-only-resume-token'});c.onSupervision({completionEvidence:Promise.resolve(exit()),stop:async()=>exit()});return {status:'succeeded',result:{answer:'continued from original session'}};}});delivery=makeDelivery();const recovered=delivery.recoverActions({full:true});await daemon.retryMaintenanceCommits(recovered);assert.equal((await delivery.execute(recovered[0])).state,'maintenance_paused');assert.equal(resumes,0);ready=true;assert.equal((await delivery.execute(recovered[0])).state,'confirmed');assert.equal(resumes,1);assert.equal(serverStatus,'succeeded');assert.equal(posts.filter(p=>p.url.endsWith('/result')).length,1);assert.deepEqual(posts.find(p=>p.url.endsWith('/result')).body.maintenanceAttempt,{generation:1,token:'fixture-only-resume-token'});assert.equal((await delivery.execute(a)).state,'confirmed');assert.equal(resumes,1);
});

test('authenticated server terminal settles only an intact paused action without claiming new process exit',async t=>{
 const {f,a,d}=await pauseDispatcher(t);assert.equal(d.settleMaintenanceFromServer({...a,payload:{...a.payload,profile:'different'}},'failed','MAINTENANCE_BUDGET_EXPIRED'),false);assert.equal(d.settleMaintenanceFromServer(a,'acked','MAINTENANCE_BUDGET_EXPIRED'),false);assert.equal(d.maintenancePausedActions.length,1);
 assert.equal(d.settleMaintenanceFromServer(a,'failed','MAINTENANCE_BUDGET_EXPIRED'),true);assert.equal(d.maintenancePausedActions.length,0);assert.equal(d.maintenancePendingCommits.length,0);const saved=d.completedResult(a);assert.equal(saved.code,'action_timeout');assert.deepEqual(saved.result.maintenanceServerTerminal,{status:'failed',reasonCode:'MAINTENANCE_BUDGET_EXPIRED'});assert.deepEqual(saved.result.processExit,receipt(a).processExit);assert.equal(saved.result.processExit.cancelled,false);
 const restarted=new ActionDispatcher({...f,execute:async()=>assert.fail('settled action may not resume'),authorizeResume:async()=>true});assert.equal(restarted.quarantined,false);assert.equal((await restarted.dispatch(a)).status,'duplicate');assert.equal(restarted.settleMaintenanceFromServer(a,'failed','MAINTENANCE_BUDGET_EXPIRED'),false);
});
test('server terminal cannot settle active or ambiguous resume launch window',async t=>{
 const f=fixture(t),a=action(f.root),native=controlledExecutor(a),d=new ActionDispatcher({...f,execute:native.execute});const running=d.dispatch(a);await native.ready.promise;assert.equal(d.settleMaintenanceFromServer(a,'failed','MAINTENANCE_SERVER_TERMINAL'),false);await d.requestMaintenancePause(update);native.finish();await running;
 const state=JSON.parse(fs.readFileSync(f.stateFile));state.started[0].maintenanceResumeStarted=true;fs.writeFileSync(f.stateFile,JSON.stringify(state));const after=new ActionDispatcher({...f,execute:async()=>assert.fail('unknown process')});assert.equal(after.settleMaintenanceFromServer(a,'failed','MAINTENANCE_SERVER_TERMINAL'),false);assert.equal(after.quarantined,true);assert.equal(after.completedResult(a),null);
});
test('terminal ACK invokes local settlement using full original action before removing retained pause evidence',async t=>{
 const f=deliveryFixture(t,async()=>paused(receipt(f.a)));await f.create().execute(f.a);f.setStatus('failed');let confirmed=0;const after=f.create({dispatch:async()=>assert.fail('terminal must not execute'),onConfirmed:async(a,status)=>{confirmed++;assert.equal(executionBinding(a),executionBinding(f.a));assert.equal(status,'failed');assert.equal(fs.readdirSync(f.directory).some(n=>n.endsWith('.pause.json')),true);}});assert.equal((await after.execute(f.a)).state,'confirmed');assert.equal(confirmed,1);assert.equal(fs.readdirSync(f.directory).some(n=>n.endsWith('.pause.json')),false);assert.equal(f.calls.filter(c=>c.url.endsWith('/result')).length,0);
});
test('expired authenticated ACK settles a stopped pause instead of waiting for a nonexistent final upload',async t=>{
 const f=deliveryFixture(t,async()=>paused(receipt(f.a)));await f.create().execute(f.a);f.setStatus('expired');let called=false;const after=f.create({dispatch:async()=>assert.fail('expired pause must not resume'),onConfirmed:async(a,status)=>{assert.equal(executionBinding(a),executionBinding(f.a));assert.equal(status,'expired');called=true;}});assert.deepEqual(await after.execute(f.a),{state:'confirmed',status:'expired'});assert.equal(called,true);assert.equal(after.pausedCount,0);assert.equal(f.calls.filter(c=>c.url.endsWith('/result')).length,0);
});
test('confirmed server-expired maintenance cannot reopen as a late completed-result upload',async t=>{
 const f=deliveryFixture(t,async()=>paused(receipt(f.a)));await f.create().execute(f.a);f.setStatus('expired');const cached={status:'duplicate',originalStatus:'failed',code:'action_timeout',result:{maintenanceServerTerminal:{status:'expired',reasonCode:'MAINTENANCE_SERVER_TERMINAL'},maintenanceCheckpoint:receipt(f.a),processExit:receipt(f.a).processExit}};const after=f.create({recoverResult:()=>cached});await after.execute(f.a);const restarted=f.create({recoverResult:()=>cached,dispatch:async()=>assert.fail('settled expired action cannot resume')});assert.deepEqual(restarted.recoverActions(),[]);assert.equal(restarted.pendingCount,0);assert.equal(fs.readdirSync(f.directory).some(n=>n.endsWith('.result.json')),false);assert.equal(f.calls.filter(c=>c.url.endsWith('/result')).length,0);
});
test('local settlement write failure keeps original terminal ACK pause evidence for retry',async t=>{
 const f=deliveryFixture(t,async()=>paused(receipt(f.a)));await f.create().execute(f.a);f.setStatus('failed');let fail=true,confirmed=0;const after=f.create({onConfirmed:async()=>{confirmed++;if(fail)throw new Error('local settlement write failed');}});await assert.rejects(after.execute(f.a),/local settlement write failed/);assert.equal(after.pausedCount,1);assert.equal(fs.readdirSync(f.directory).some(n=>n.endsWith('.pause.json')),true);fail=false;assert.equal((await after.execute(f.a)).state,'confirmed');assert.equal(confirmed,2);assert.equal(f.calls.filter(c=>c.url.endsWith('/result')).length,0);
});
test('server budget settlement during resume requests only terminal ACK and never a second final upload',async t=>{
 const f=fixture(t),a=action(f.root),native=controlledExecutor(a);let daemon,delivery,status='acked',nativeCalls=0;const posts=[];
 const post=async(url,body)=>{posts.push({url,body});if(url.endsWith('/ack'))return {id:a.id,status,expires_at:new Date(Date.now()+60*60*1000).toISOString()};if(url.endsWith('/events'))return {};assert.fail('server settled original action; no second final allowed');};const create=()=>createActionDelivery({directory:f.directory,identity,post,retryDelays:[],dispatch:wire=>daemon.dispatch(wire),recoverResult:wire=>daemon.completedResult(wire),onConfirmed:(wire,s)=>daemon.settleMaintenanceFromServer(wire,s,'MAINTENANCE_SERVER_TERMINAL')});
 daemon=new ActionDispatcher({...f,execute:native.execute,onMaintenancePaused:async()=>true});delivery=create();const running=delivery.execute(a);await native.ready.promise;await daemon.requestMaintenancePause(update);native.finish();await running;
 daemon=new ActionDispatcher({...f,onMaintenancePaused:async()=>true,authorizeResume:async wire=>{status='failed';assert.equal(daemon.settleMaintenanceFromServer(wire,status,'MAINTENANCE_BUDGET_EXPIRED'),true);return false;},execute:async()=>{nativeCalls++;assert.fail('expired pause cannot launch native');}});delivery=create();delivery.recoverActions();assert.equal((await delivery.execute(a)).state,'confirmed');assert.equal(nativeCalls,0);assert.equal(daemon.maintenancePausedActions.length,0);assert.equal(delivery.pausedCount,0);assert.equal(posts.filter(p=>p.url.endsWith('/result')).length,0);assert.equal(posts.filter(p=>p.url.endsWith('/ack')).length,3);
});

for(const mode of ['initial_commit','retry_commit','dispatch_recommit'])test(`permanent checkpoint rejection settles in ${mode} without resurrecting pause or posting another final`,async t=>{
 const f=fixture(t),a=action(f.root),native=controlledExecutor(a),calls=[];let daemon,delivery,status='acked',terminate=mode==='initial_commit',authorizeCalls=0,commits=0;
 const post=async(url,body)=>{calls.push({url,body});if(url.endsWith('/ack'))return {id:a.id,status,expires_at:new Date(Date.now()+60*60*1000).toISOString()};if(url.endsWith('/events'))return {};assert.fail('server commit already terminated action; no second final');};
 daemon=new ActionDispatcher({...f,execute:native.execute,authorizeResume:async()=>{authorizeCalls++;return true;},onMaintenancePaused:async wire=>{commits++;if(!terminate)return false;status='failed';assert.equal(daemon.settleMaintenanceFromServer(wire,status,'MAINTENANCE_EMPLOYEE_CHANGED'),true);return true;}});
 delivery=createActionDelivery({directory:f.directory,identity,post,dispatch:wire=>daemon.dispatch(wire),recoverResult:wire=>daemon.completedResult(wire),retryDelays:[],onConfirmed:(wire,s)=>daemon.settleMaintenanceFromServer(wire,s)});
 const running=delivery.execute(a);await native.ready.promise;await daemon.requestMaintenancePause(update);native.finish();const first=await running;
 if(mode==='initial_commit')assert.equal(first.state,'confirmed');else{
  assert.equal(first.state,'maintenance_paused');assert.equal(daemon.maintenancePendingCommits.length,1);terminate=true;
  if(mode==='retry_commit'){assert.deepEqual(await daemon.retryMaintenanceCommits(delivery.recoverActions({full:true})),{pending:0});assert.equal(daemon.maintenancePausedActions.length,0);}
  assert.equal((await delivery.execute(a)).state,'confirmed');
 }
 assert.equal(authorizeCalls,0);assert.equal(commits,mode==='initial_commit'?1:2);assert.equal(daemon.maintenancePausedActions.length,0);assert.equal(daemon.maintenancePendingCommits.length,0);assert.equal(delivery.pausedCount,0);assert.equal(delivery.pendingCount,0);assert.equal(calls.filter(c=>c.url.endsWith('/result')).length,0);assert.equal(fs.readdirSync(f.directory).some(n=>n.endsWith('.pause.json')||n.endsWith('.result.json')),false);const saved=JSON.parse(fs.readFileSync(f.stateFile));assert.equal(saved.completed.length,1);assert.deepEqual(saved.completed[0].result.result.processExit,receipt(a).processExit);assert.equal(saved.completed[0].result.result.maintenanceServerTerminal.reasonCode,'MAINTENANCE_EMPLOYEE_CHANGED');
 const restarted=new ActionDispatcher({...f,execute:async()=>assert.fail('completed terminal cannot resume')});assert.equal((await restarted.dispatch(a)).status,'duplicate');assert.equal(restarted.quarantined,false);
});
