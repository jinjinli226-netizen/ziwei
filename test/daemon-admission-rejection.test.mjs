import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActionDispatcher} from '../src/daemon.mjs';
import {createActionDelivery} from '../src/daemon-action-delivery.mjs';
import {isDispatcherAdmissionRejected,consumeDispatcherAdmissionRejected} from '../src/dispatcher-admission-evidence.mjs';
import {inspectLocalDaemonMaintenanceFiles,scanNativeFiles} from '../backend/preservation-native-evidence.mjs';

const identity={workspace:'admission-test',deviceId:'admission-device',apiBase:'https://admission.invalid'};
const action=()=>({id:'admission-action',dedupe_key:'admission-key',type:'conversation.execute',workspace:identity.workspace,payload:{deviceId:identity.deviceId,employeeId:'employee-admission'}});
function fixture(t){
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-admission-rejection-')));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const options={workspace:identity.workspace,deviceId:identity.deviceId,workdir:root,stateFile:path.join(root,'action-state.json')},connections=[{...identity,runtimeDir:root}];
  return{root,options,connections,state:()=>JSON.parse(fs.readFileSync(options.stateFile,'utf8')),inspect:()=>inspectLocalDaemonMaintenanceFiles({connections})};
}

for(const phase of ['authorization','expiry','workdir','lease'])test(`a real ${phase} rejection records no dispatch, survives restart, and never executes`,async t=>{
  const f=fixture(t),original=action();let calls=0,authorizations=0;
  const authorizeExecute=async()=>{authorizations++;if(phase==='authorization')throw Object.assign(Error('admission HTTP timeout'),{admissionRejected:false,processExit:{launched:true,rootPid:9999}});};
  if(phase==='expiry')original.expires_at=new Date(Date.now()-1000).toISOString();
  if(phase==='workdir')original.payload.workdir=path.join(f.root,'..','outside');
  if(phase==='lease')original.expires_at=new Date(Date.now()+30000).toISOString();
  const execute=async()=>{calls++;throw Error('must not execute');};
  const dispatcher=new ActionDispatcher({...f.options,authorizeExecute,execute}),result=await dispatcher.dispatch(original),saved=f.state(),completed=saved.completed[0];
  assert.equal(result.status,'failed');assert.equal(result.executionState,'not_dispatched');assert.equal(result.admissionRejected,true);
  assert.equal(saved.started.length,0);assert.equal(saved.completed.length,1);assert.equal(calls,0);assert.equal(authorizations,1);
  assert.equal(completed.admissionRejected.phase,phase);assert.equal(completed.admissionRejected.executorInvoked,false);
  assert.equal(isDispatcherAdmissionRejected({completed,identity,started:saved.started}),true);
  assert.equal(JSON.stringify(saved).includes('processExit'),false);assert.equal(JSON.stringify(saved).includes('9999'),false);
  assert.equal(f.inspect().stopSafe,true);assert.equal(f.inspect().safe,true);assert.equal(dispatcher.quarantined,false);
  const before=fs.readFileSync(f.options.stateFile),restarted=new ActionDispatcher({...f.options,authorizeExecute,execute}),duplicate=await restarted.dispatch(original);
  assert.equal(duplicate.status,'duplicate');assert.equal(duplicate.originalStatus,'failed');assert.equal(duplicate.executionState,'not_dispatched');assert.equal(calls,0);assert.equal(authorizations,1);assert.deepEqual(fs.readFileSync(f.options.stateFile),before);
  assert.equal(scanNativeFiles({connections:f.connections}).safe,false,'local no-dispatch history is not a formal rollback attestation');
});

test('typed rejection metadata survives subsequent durable writes without converting old history',async t=>{
  const f=fixture(t);const first=new ActionDispatcher({...f.options,authorizeExecute:async()=>{throw Error('rejected');},execute:async()=>{throw Error('must not execute');}});
  await first.dispatch(action());const saved=f.state().completed[0];
  const restarted=new ActionDispatcher({...f.options,execute:async()=>({output:'new ordinary inspection'})});
  await restarted.dispatch({...action(),id:'another-action',dedupe_key:'another-key',type:'directory.inspect'});
  assert.deepEqual(f.state().completed.find(row=>row.key===saved.key),saved);assert.equal(f.inspect().stopSafe,true);
});

test('a blocked delivery of a genuine admission rejection retains its original bytes and can stop locally',async t=>{
  const f=fixture(t);let calls=0;
  const dispatcher=new ActionDispatcher({...f.options,authorizeExecute:async()=>{throw Error('rejected before dispatch');},execute:async()=>{calls++;}});
  const delivery=createActionDelivery({directory:path.join(f.root,'action-delivery'),identity,retryDelays:[],dispatch:value=>dispatcher.dispatch(value),recoverResult:value=>dispatcher.completedResult(value),post:async(url,body)=>{
    if(url.endsWith('/ack'))return{id:action().id,status:'acked',acked_at:new Date().toISOString(),expires_at:new Date(Date.now()+1000000).toISOString(),deviceId:identity.deviceId};
    if(url.endsWith('/events'))return{id:body.eventId};
    throw Object.assign(Error('permanent result transport rejection'),{status:400});
  }});
  await assert.rejects(delivery.execute(action()),/permanent/);await delivery.whenIdle();
  const before=fs.readFileSync(f.options.stateFile),evidence=f.inspect();
  assert.equal(calls,0);assert.equal(evidence.safe,false);assert.equal(evidence.stopSafe,true);assert.equal(evidence.retainedDeliveryCount,1);assert.deepEqual(evidence.stopIssues,[]);assert.deepEqual(fs.readFileSync(f.options.stateFile),before);
  const restarted=new ActionDispatcher({...f.options,execute:async()=>{calls++;}});assert.equal((await restarted.dispatch(action())).status,'duplicate');assert.equal(calls,0);
});

test('plain executor or error fields cannot mint dispatcher admission evidence after started',async t=>{
  const f=fixture(t);let calls=0;
  assert.equal(consumeDispatcherAdmissionRejected({admissionRejected:true,executionState:'not_dispatched'}),null);
  const dispatcher=new ActionDispatcher({...f.options,execute:async()=>{calls++;throw Object.assign(Error('post-start unknown exit'),{admissionRejected:true,executionState:'not_dispatched',processExit:{launched:false,rootPid:null,rootExitCode:null,treeConfirmed:true,activeProcesses:0}});}});
  const result=await dispatcher.dispatch(action());assert.equal(calls,1);assert.equal(result.code,'EXECUTION_UNCERTAIN');assert.equal(result.result.processExit,null);assert.equal(f.state().started.length,1);assert.equal(f.state().completed.length,0);assert.equal(dispatcher.quarantined,true);assert.equal(f.inspect().stopSafe,false);
});

for(const change of [row=>{row.admissionRejected=true;},row=>{row.admissionRejected.key='different-key';},row=>{row.admissionRejected.identity.deviceId='other-device';},row=>{row.result.error='changed';},row=>{row.admissionRejected.executorInvoked=true;}])test('malformed, copied or changed admission records fail closed on disk',async t=>{
  const f=fixture(t),dispatcher=new ActionDispatcher({...f.options,authorizeExecute:async()=>{throw Error('rejected');},execute:async()=>{throw Error('must not run');}});
  await dispatcher.dispatch(action());const state=f.state();change(state.completed[0]);fs.writeFileSync(f.options.stateFile,JSON.stringify(state));
  let calls=0;const restarted=new ActionDispatcher({...f.options,execute:async()=>{calls++;}}),result=await restarted.dispatch(action());
  assert.equal(result.reason,'ACTION_STATE_CORRUPT');assert.equal(calls,0);assert.equal(f.inspect().stopSafe,false);
});

test('a started collision cannot be hidden by a valid no-dispatch record',async t=>{
  const f=fixture(t),dispatcher=new ActionDispatcher({...f.options,authorizeExecute:async()=>{throw Error('rejected');},execute:async()=>{}});await dispatcher.dispatch(action());
  const state=f.state(),completed=state.completed[0];state.started.push({key:completed.key,actionId:completed.result.actionId,identity:completed.identity,startedAt:1,nativeRuntime:true});fs.writeFileSync(f.options.stateFile,JSON.stringify(state));
  assert.equal(isDispatcherAdmissionRejected({completed,identity,started:state.started}),false);assert.equal(f.inspect().stopSafe,false);
});
