import test from 'node:test';
import assert from 'node:assert/strict';
import {createClientMaintenanceResume} from '../src/client-maintenance-resume.mjs';
import {authorizeNativeExecution,executionBinding} from '../src/execution-admission.mjs';

function fixture(){
  const calls=[],action={id:'action-maintenance-fixture'},receipt={updateId:'update-fixture',targetBuild:'2'.repeat(64),checkpointDigest:'3'.repeat(64)},permit={generation:1,token:'fixture-permit-'.repeat(3)};
  let ready=false,pending=0,flushFailure=false,stored=null;
  const delivery={maintenanceAttempt:()=>stored,flushActionEvents:async()=>{calls.push('flush');if(flushFailure)throw new Error('offline');return{pending};},setMaintenanceAttempt:(id,value)=>{assert.equal(id,action.id);calls.push('persist');stored=value;}};
  const updates={checkpointAuthority:()=>({updateId:receipt.updateId,claimToken:'private-fixture-claim'}),maintenanceResumeReadiness:async()=>({ready})};
  const client=createClientMaintenanceResume({clientBuild:'2'.repeat(64),updates:()=>updates,delivery:()=>delivery,post:async(route,body)=>{calls.push({route,body});return route.endsWith('maintenance-checkpoint')?{committed:true}:{allowed:true,maintenanceAttempt:permit};}});
  return {action,receipt,calls,client,permit,ready:v=>ready=v,pending:v=>pending=v,flushFailure:v=>flushFailure=v};
}
test('checkpoint waits for original progress delivery and never dispatches another task',async()=>{
  const f=fixture();f.pending(1);assert.equal(await f.client.commit(f.action,f.receipt),false);assert.deepEqual(f.calls,['flush']);
  f.pending(0);assert.equal(await f.client.commit(f.action,f.receipt),true);assert.equal(f.calls[2].route,'/a2a/v1/actions/action-maintenance-fixture/maintenance-checkpoint');
});
test('a failed event upload preserves the pause for retry rather than fencing its old outbox',async()=>{
  const f=fixture();f.flushFailure(true);await assert.rejects(f.client.commit(f.action,f.receipt),/offline/);assert.deepEqual(f.calls,['flush']);
  f.flushFailure(false);assert.equal(await f.client.commit(f.action,f.receipt),true);
});
test('resume waits for the installation, authorizes the exact checkpoint and persists the attempt first',async()=>{
  const f=fixture();assert.equal(await f.client.authorize(f.action,f.receipt),false);assert.deepEqual(f.calls,[]);
  f.ready(true);assert.equal(await f.client.authorize(f.action,f.receipt),true);
  assert.equal(f.calls[0].body.checkpointDigest,f.receipt.checkpointDigest);assert.equal(f.calls[1],'persist');
  assert.equal(await f.client.commit(f.action,f.receipt),true);assert.deepEqual(f.calls.at(-1).body.maintenanceAttempt,f.permit);
});
test('a terminal checkpoint response closes the paused task without requesting another execution',async()=>{
  const action={id:'terminal-action'},receipt={updateId:'terminal-update'},calls=[];
  const c=createClientMaintenanceResume({clientBuild:'2'.repeat(64),updates:()=>({checkpointAuthority:()=>({updateId:receipt.updateId,claimToken:'private-fixture'})}),delivery:()=>({flushActionEvents:async()=>({pending:0})}),post:async(route)=>{calls.push(route);return{committed:true,terminal:true,actionId:action.id,status:'failed',reasonCode:'MAINTENANCE_BINDING_CHANGED'};},onTerminal:(a,status,reason)=>calls.push({id:a.id,status,reason})});
  assert.equal(await c.commit(action,receipt),true);assert.equal(calls.length,2);assert.equal(calls[1].reason,'MAINTENANCE_BINDING_CHANGED');
});
test('the resumed native admission carries the durable attempt instead of silently dropping its fence',async()=>{
  const action={id:'admission-fixture',type:'task.execute',payload:{runtime:'Hermes'}},attempt={generation:2,token:'f'.repeat(64)},original=global.fetch;let body;
  global.fetch=async(_url,init)=>{body=JSON.parse(init.body);return{ok:true,json:async()=>({allowed:true,actionId:action.id,executionBinding:executionBinding(action)})};};
  try{await authorizeNativeExecution(action,{apiBase:'https://fixture.invalid',workspace:'fixture',deviceId:'device-fixture',deviceToken:'private-fixture',maintenanceAttempt:attempt});assert.deepEqual(body.maintenanceAttempt,attempt);}
  finally{global.fetch=original;}
});
test('an ordinary delivery without a checkpoint returns null and still passes native admission',async()=>{
  const action={id:'ordinary-admission-fixture',type:'task.execute',payload:{runtime:'Hermes'}},original=global.fetch;let body;
  global.fetch=async(_url,init)=>{body=JSON.parse(init.body);return{ok:true,json:async()=>({allowed:true,actionId:action.id,executionBinding:executionBinding(action)})};};
  try{await authorizeNativeExecution(action,{apiBase:'https://fixture.invalid',workspace:'fixture',deviceId:'device-fixture',deviceToken:'private-fixture',maintenanceAttempt:null});assert.deepEqual(body,{workspace:'fixture'});}
  finally{global.fetch=original;}
});
