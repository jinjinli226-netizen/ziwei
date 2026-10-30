import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as daemon from '../src/daemon.mjs';
import {createActionScheduler} from '../src/daemon-action-scheduler.mjs';
import {createActionDelivery} from '../src/daemon-action-delivery.mjs';
import {createLocalActionExecutor} from '../src/local-action.mjs';
import {createDshSessionEvidence} from '../src/dsh-session-evidence.mjs';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const native=(resource,operation,input={})=>({id:`${resource}-${operation}`,type:'employee.dsh.operation',workspace_id:'ws',payload:{workspace:'test',workspaceId:'ws',deviceId:'pc',dshOperation:{schemaVersion:1,subject:{workspace:'test',workspaceId:'ws',employeeId:'employee',deviceId:'pc',runtime:'DSH',profile:'alpha'},scope:{kind:'bot'},resource,operation,input}}});

for(const[resource,operation]of[['plugins','installBundle'],['credentials','set'],['settings','mutateSecure']])test(`silent native ${resource}.${operation} follows its hard budget beyond two minutes`,async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:1800000000000});const entered=deferred(),release=deferred(),events=[];let signal;
 const dispatcher=new daemon.ActionDispatcher({execute:async(_action,context)=>{signal=context.signal;entered.resolve();await Promise.race([release.promise,new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}))]);return{status:'succeeded',result:{native:true}};},onEvent:(type,data)=>events.push({type,data})});
 const pending=dispatcher.dispatch(native(resource,operation));await entered.promise;t.mock.timers.tick(121000);await flush();assert.equal(signal.aborted,false);assert.equal(events.some(row=>row.type==='action.waiting'),true);release.resolve();assert.equal((await pending).status,'succeeded');
});

test('an explicit native idle timeout and an ordinary command default idle deadline remain enforced',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:1800000000000});
 for(const a of [{...native('plugins','installBundle'),payload:{...native('plugins','installBundle').payload,idleTimeoutMs:250}},{id:'ordinary',type:'command.execute',payload:{}}]){
  const entered=deferred();let signal;const dispatcher=new daemon.ActionDispatcher({stopGraceMs:1,execute:async(_action,context)=>{signal=context.signal;entered.resolve();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));return{};}}),pending=dispatcher.dispatch(a);await entered.promise;t.mock.timers.tick(a.id==='ordinary'?121000:300);await flush();assert.equal(signal.aborted,true);const result=await pending;assert.equal(result.code,'action_timeout');assert.match(result.error,/no activity/);
 }
});

test('native hard deadline still aborts execution when no explicit idle timeout is configured',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:1800000000000});const entered=deferred();let signal;
 const dispatcher=new daemon.ActionDispatcher({stopGraceMs:1,execute:async(_action,context)=>{signal=context.signal;entered.resolve();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));return{};}}),pending=dispatcher.dispatch(native('settings','mutate'));await entered.promise;t.mock.timers.tick(14999);await flush();assert.equal(signal.aborted,false);t.mock.timers.tick(1);assert.equal((await pending).code,'action_timeout');
});

test('production daemon gate admits only precise native controls during maintenance and keeps old pause and quarantine rules',()=>{
 const state={actionDelivery:{canDeliverWithoutExecution:a=>a.id==='cached'},dispatcher:{getMaintenancePause:()=>null,hasPausedEmployee:()=>false},maintenanceReady:new Set(),blocksNewActions:true,executionAllowed:()=>true};
 for(const[resource,operation]of[['interactions','list'],['interactions','approve'],['interactions','answer'],['interactions','dismiss'],['plugins','cancelInstall'],['groups','cancel']])assert.equal(daemon.canStartDaemonAction(native(resource,operation),{collaborationChild:false},state),true);
 assert.equal(daemon.canStartDaemonAction(native('interactions','claim'),{collaborationChild:false},state),false);assert.equal(daemon.canStartDaemonAction(native('plugins','installBundle'),{collaborationChild:false},state),false);
 assert.equal(daemon.canStartDaemonAction({id:'cached'},{},state),true);assert.equal(daemon.canStartDaemonAction({type:'action.cancel'},{},state),true);assert.equal(daemon.canStartDaemonAction({id:'child',payload:{employeeId:'child'}},{collaborationChild:true},state),true);
 state.dispatcher.hasPausedEmployee=()=>true;assert.equal(daemon.canStartDaemonAction({id:'paused-employee',payload:{employeeId:'child'}},{collaborationChild:true},state),false);assert.equal(daemon.canStartDaemonAction(native('settings','mutate'),{collaborationChild:true},state),false);state.dispatcher.hasPausedEmployee=()=>false;state.executionAllowed=()=>false;assert.equal(daemon.canStartDaemonAction({id:'child',payload:{employeeId:'child'}},{collaborationChild:true},state),false);
});

test('a maintenance native control still requires the ordinary ACK and dispatcher execution admission',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-control-admission-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const events=[],a=native('interactions','approve',{interactionId:'current',decision:'allowed-once'});let allowAck=false,executions=0;
 const dispatcher=new daemon.ActionDispatcher({authorizeExecute:async()=>{events.push('admission');throw Object.assign(Error('source revoked'),{code:'FIXTURE_REVOKED'});},execute:async()=>{executions++;return{};}}),delivery=createActionDelivery({directory,identity:{apiBase:'https://fixture.invalid',workspace:'test',deviceId:'pc'},retryDelays:[],dispatch:action=>dispatcher.dispatch(action),post:async(route,body)=>{
  const operation=route.split('/').at(-1);events.push(operation);if(operation==='ack'){if(!allowAck)throw Object.assign(Error('ACK refused'),{status:403});return{id:a.id,status:'acked',deviceId:'pc',acked_at:new Date().toISOString(),expires_at:new Date(Date.now()+960000).toISOString()};}return{id:a.id,status:body.status,deviceId:'pc',receiptOnly:true};
 }}),state={actionDelivery:delivery,dispatcher,maintenanceReady:new Set(),blocksNewActions:true,executionAllowed:()=>true},scheduler=createActionScheduler({concurrency:1,execute:action=>delivery.execute(action),canStart:(action,admission)=>daemon.canStartDaemonAction(action,admission,state)});
 assert.deepEqual(scheduler.schedule([a]),[a.id]);await scheduler.whenIdle();assert.equal(events.includes('admission'),false);assert.equal(executions,0);
 const second={...a,id:'second-control'};allowAck=true;
 const admitted=createActionDelivery({directory:path.join(directory,'admitted'),identity:{apiBase:'https://fixture.invalid',workspace:'test',deviceId:'pc'},retryDelays:[],dispatch:action=>dispatcher.dispatch(action),post:async(route,body)=>{const operation=route.split('/').at(-1);events.push(operation);return operation==='ack'?{id:second.id,status:'acked',deviceId:'pc',acked_at:new Date().toISOString(),expires_at:new Date(Date.now()+960000).toISOString()}:{id:second.id,status:body.status,deviceId:'pc',receiptOnly:true};}});
 await admitted.execute(second);assert.equal(events.includes('admission'),true);assert.equal(executions,0);
});

test('dispatcher preserves native group member cwd selection through the real local executor',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-dispatch-cwd-')),nativeCwd=path.join(directory,'native-bot'),employeeCwd=path.join(directory,'employee');fs.mkdirSync(nativeCwd);fs.mkdirSync(employeeCwd);t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const selected=[],reads=[],execute=createLocalActionExecutor({runtimeDir:path.join(directory,'runtime'),defaultWorkdir:directory,dshBaseUrl:'http://native.fixture',dshPluginFetch:async url=>{reads.push(url);return Response.json({bots:[{name:'alpha',workdir:nativeCwd}]});},dshRuntime:async options=>{
  selected.push(options.cwd);const evidence=createDshSessionEvidence({...options.sessionAuthority,botName:'alpha',sessionId:'native-session',requestId:'native-request'},async()=>null);options.onSessionSupervision(evidence.capability);evidence.acceptRequest(1);const sessionExit=evidence.finishTurn(1,'completed');return{status:'succeeded',sessionId:'native-session',sessionExit,output:'member complete'};
 }});t.after(()=>execute.close());const dispatcher=new daemon.ActionDispatcher({workdir:directory,execute});
 for(const[ending,extra]of[['native',{}],['employee',{cwd:employeeCwd}]]){
  const a={id:'group-child-'+ending,type:'conversation.execute',payload:{runtime:'DSH',profile:'alpha',employeeId:'employee',conversationId:'group-conversation',prompt:'group work',dshGroup:{schemaVersion:1,sourceActionId:'parent',groupId:'g-native',memberProfile:'alpha'},...extra}};
  assert.equal((await dispatcher.dispatch(a)).status,'succeeded');
 }
 assert.deepEqual(selected,[nativeCwd,employeeCwd]);assert.deepEqual(reads,['http://native.fixture/api/state']);
});
