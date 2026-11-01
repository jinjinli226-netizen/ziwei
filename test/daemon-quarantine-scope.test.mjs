import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {ActionDispatcher,canStartDaemonAction} from '../src/daemon.mjs';
import {createActionScheduler} from '../src/daemon-action-scheduler.mjs';

const action=(id,employeeId)=>({id,type:'agent.execute',payload:{prompt:'isolated fixture',...(employeeId?{employeeId}:{})}});
function temporaryRuntimeDirectory(t,prefix){
  const parent=fs.realpathSync(os.tmpdir()),directory=fs.mkdtempSync(path.join(parent,prefix));
  t.after(()=>{assert.equal(path.dirname(path.resolve(directory)),parent);assert(path.basename(directory).startsWith(prefix));fs.rmSync(directory,{recursive:true,force:true});});
  return directory;
}
function runtime(workspace='primary',stateFile=null){
  const calls=[];
  const dispatcher=new ActionDispatcher({workspace,deviceId:'device_'+workspace,stateFile,execute:async value=>{
    calls.push(value.id);if(value.id==='unknown')throw Error('isolated missing exit evidence');return {};
  }});
  return {dispatcher,calls};
}

test('an employee quarantine blocks only that employee and preserves the original action dedupe across restart',async t=>{
  const directory=temporaryRuntimeDirectory(t,'ziwei-quarantine-employee-');
  const stateFile=path.join(directory,'action-state.json'),{dispatcher,calls}=runtime('primary',stateFile);
  assert.equal((await dispatcher.dispatch(action('unknown','A'))).reason,'EXECUTOR_WITHOUT_EXIT_EVIDENCE');
  assert.equal((await dispatcher.dispatch(action('other-employee','B'))).status,'succeeded');
  assert.equal((await dispatcher.dispatch(action('same-employee','A'))).reason,'EXECUTION_QUARANTINED');
  assert.equal((await dispatcher.dispatch(action('unknown','B'))).reason,'STARTED_WITHOUT_RESULT');
  assert.equal(dispatcher.quarantined,true);
  assert.equal(dispatcher.workspaceQuarantined,false);
  assert.deepEqual(calls,['unknown','other-employee']);
  const restarted=runtime('primary',stateFile);
  assert.equal((await restarted.dispatcher.dispatch(action('after-restart-A','A'))).reason,'EXECUTION_QUARANTINED');
  assert.equal((await restarted.dispatcher.dispatch(action('after-restart-B','B'))).status,'succeeded');
  assert.equal((await restarted.dispatcher.dispatch(action('unknown','B'))).reason,'STARTED_WITHOUT_RESULT');
  assert.deepEqual(restarted.calls,['after-restart-B']);
});

test('scheduler admission uses the action employee while allowing controls and original receipt delivery',async()=>{
  const {dispatcher,calls}=runtime();await dispatcher.dispatch(action('unknown','A'));
  const state={dispatcher,maintenanceReady:new Set(),blocksNewActions:false,
    actionDelivery:{canDeliverWithoutExecution:value=>value.id==='receipt'},
    executionAllowed:value=>!dispatcher.isExecutionQuarantined(value)};
  const scheduler=createActionScheduler({execute:value=>dispatcher.dispatch(value),canStart:(value,admission)=>canStartDaemonAction(value,admission,state)});
  assert.deepEqual(scheduler.schedule([action('same-employee','A'),action('other-employee','B')]),['other-employee']);
  await scheduler.whenIdle();assert.deepEqual(calls,['unknown','other-employee']);
  assert.equal(canStartDaemonAction(action('receipt','A'),{},state),true);
  assert.equal(canStartDaemonAction({id:'cancel',type:'action.cancel',payload:{actionId:'unknown'}},{},state),true);
  const control={id:'approve',type:'employee.dsh.operation',payload:{dshOperation:{schemaVersion:1,subject:{employeeId:'A',runtime:'DSH'},resource:'interactions',operation:'approve',scope:{kind:'bot'},input:{}}}};
  assert.equal(canStartDaemonAction(control,{},state),true);
  assert.equal((await dispatcher.dispatch(control)).status,'succeeded');
  assert.equal(dispatcher.quarantined,true);
});

test('an unbound quarantine and a corrupt state block their own workspace without blocking another workspace',async t=>{
  const primary=runtime(),shared=runtime('shared');await primary.dispatcher.dispatch(action('unknown'));
  assert.equal((await primary.dispatcher.dispatch(action('primary-next','B'))).reason,'EXECUTION_QUARANTINED');
  assert.equal((await shared.dispatcher.dispatch(action('shared-next','B'))).status,'succeeded');
  assert.equal(primary.dispatcher.workspaceQuarantined,true);
  const directory=temporaryRuntimeDirectory(t,'ziwei-quarantine-scope-');
  const stateFile=path.join(directory,'action-state.json');fs.writeFileSync(stateFile,'{broken');
  const corrupt=new ActionDispatcher({workspace:'corrupt',stateFile,execute:async()=>{throw Error('must not execute');}});
  assert.equal(corrupt.workspaceQuarantined,true);
  assert.equal((await corrupt.dispatch(action('corrupt-next','B'))).reason,'ACTION_STATE_CORRUPT');
  assert.equal((await shared.dispatcher.dispatch(action('shared-after-corrupt','C'))).status,'succeeded');
});

for(const employeeId of [123,'   '])test(`an invalid saved employee binding ${JSON.stringify(employeeId)} cannot narrow quarantine`,async t=>{
  const directory=temporaryRuntimeDirectory(t,'ziwei-quarantine-binding-');
  const stateFile=path.join(directory,'action-state.json'),bytes=JSON.stringify({version:2,completed:[],started:[{key:'old',actionId:'old',identity:{workspace:'primary',deviceId:'device_primary'},startedAt:1,nativeRuntime:true,resourceBinding:{type:'agent.execute',employeeId}}]});
  fs.writeFileSync(stateFile,bytes);
  const primary=runtime('primary',stateFile),shared=runtime('shared');
  assert.equal(primary.dispatcher.workspaceQuarantined,true);
  assert.equal((await primary.dispatcher.dispatch(action('next','123'))).reason,'ACTION_STATE_CORRUPT');
  assert.deepEqual(primary.calls,[]);assert.equal(fs.readFileSync(stateFile,'utf8'),bytes);
  assert.equal((await shared.dispatcher.dispatch(action('shared-next','123'))).status,'succeeded');
});

for(const employeeId of [undefined,'A'])test(`daemon readiness admits unaffected ${employeeId?'employees':'workspaces'} while retaining quarantine and unsafe stop counters`,async()=>{
  const primary=runtime(),shared=runtime('shared');await primary.dispatcher.dispatch(action('unknown',employeeId));
  const now=Date.now(),makeConnection=(workspace,value)=>({config:{workspace,deviceId:'device_'+workspace,primary:workspace==='primary',heartbeatMs:15000},dispatcher:value.dispatcher,lastHeartbeatAt:now,lastHeartbeat:new Date(now).toISOString(),localExecutor:{maintenanceStatus:()=>({safe:true,workers:[]})},actionScheduler:{activeCount:value.dispatcher.quarantinedActionIds.length},actionDelivery:{pendingCount:0,blockedCount:0},managementBootstrap:{status:()=>({})},polling:false});
  const connections=new Map([['primary',makeConnection('primary',primary)],['shared',makeConnection('shared',shared)]]);
  const source=fs.readFileSync(new URL('../daemon/ziwei_user.mjs',import.meta.url),'utf8');
  const between=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
  let handler;
  const context=vm.createContext({Map,Set,Date,process:{pid:1234},config:connections.get('primary').config,connections,executionAllowed:()=>false,
    inspectLocalDaemonMaintenanceFiles:()=>({safe:false,stopSafe:false,retainedDeliveryCount:0,retainedBackgroundCount:0,issues:[],stopIssues:[]}),
    runtimeDiscovery:{runtimes:[]},primaryConnection:connections.get('primary'),VERSION:'test',CLIENT_BUILD:'test-build',ROOT:'fixture',configPath:'fixture',runtimeDir:'fixture',lifecycleNonce:'nonce',lifecycleStartedAt:new Date(now).toISOString(),lifecycleConfigurationHash:()=>null,lastHeartbeat:null,lastHeartbeatAt:now,lastPoll:null,connectionErrors:[],draining:false,heartbeatFresh:connection=>connection.lastHeartbeatAt===now,remoteClientUpdates:{status:()=>({})},privateIdentityRoute:()=>false,http:{createServer:callback=>{handler=callback;return{};}},setImmediate:()=>{},stop:()=>{}});
  vm.runInContext(`${between('function heartbeatFresh(','function lifecycleConfigurationHash()')}\n${between('function healthPayload() {','\nconst privateIdentityHandler=')}\n${between('const health = http.createServer(','\nlet stopping = false;')}`,context);
  const response={writeHead(status){this.status=status;},end(body){this.body=JSON.parse(body);}};
  handler({url:'/readyz',method:'GET',headers:{},socket:{remoteAddress:'127.0.0.1'}},response);
  assert.equal(response.status,200);assert.equal(response.body.ready,true);
  assert.deepEqual(response.body.connections.map(value=>value.ready),[Boolean(employeeId),true]);
  assert.equal(response.body.executionQuarantined,false);assert.equal(response.body.connectionState,'connected');assert.equal(response.body.quarantinedActionCount,1);
  assert.deepEqual(response.body.connections.map(value=>value.workspaceQuarantined),[!employeeId,false]);
  assert.equal(response.body.maintenance.stopSafe,false);
  connections.get('primary').lastHeartbeatAt=now-100000;
  handler({url:'/readyz'},response);assert.equal(response.status,200);
  connections.get('shared').lastHeartbeatAt=now-100000;
  handler({url:'/readyz'},response);assert.equal(response.status,503);
  if(!employeeId){
    await shared.dispatcher.dispatch(action('unknown'));
    handler({url:'/readyz'},response);assert.equal(response.status,503);
    assert.equal(response.body.executionQuarantined,true);assert.equal(response.body.connectionState,'quarantined');
  }
});
