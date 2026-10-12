import test from 'node:test';
import assert from 'node:assert/strict';
import {executeNativeDriver} from '../src/hermes-driver-runtime.mjs';
import {executeBotGroup} from '../src/hermes-group-runtime.mjs';

const options={operation:{resource:'kanban',operation:'dispatch',requestId:'original',input:{taskId:'card'}},context:{employeeId:'source',config:{}},workspace:'test',apiBase:'http://fixture.invalid'};
const receipt=data=>({status:'succeeded',result:{nativeOperation:{data}}});
function driver(overrides={}){const calls=[];let turns=0;const deps={native:async request=>{calls.push(request.operation);return request.operation.operation==='_prepare'?receipt({run:true,prompt:'one turn',task:{current_run_id:7}}):receipt({});},prepareManagement:async()=>({}),runTurn:async()=>{turns++;return{status:'succeeded',result:{output:'original output'}};},settlement:async()=>({allowed:true,allowEvaluation:true}),...overrides};return{deps,calls,turns:()=>turns};}

test('management preparation failure settles the original claim as never started',async()=>{
  const f=driver({prepareManagement:async()=>{throw new Error('offline');}});
  const result=await executeNativeDriver({id:'parent'},options,f.deps);
  assert.equal(result.status,'failed');assert.equal(f.turns(),0);assert.deepEqual(f.calls.map(v=>v.operation),['_prepare','_fail']);
  assert.equal(f.calls[1].input.neverStarted,true);assert.equal(f.calls[1].input.runId,7);assert.equal(f.calls[1].input.actionId,'parent');
});
test('a launched prepare without a valid receipt never starts or replays a turn',async()=>{
  const f=driver({native:async request=>{f.calls.push(request.operation);return{status:'failed',code:'EXECUTION_UNCERTAIN',executionState:'uncertain',result:{processExit:{launched:true}}};}});
  const result=await executeNativeDriver({id:'parent'},options,f.deps);assert.equal(result.code,'EXECUTION_UNCERTAIN');assert.equal(f.turns(),0);assert.deepEqual(f.calls.map(v=>v.operation),['_prepare']);
});
for(const authority of [async()=>{throw new Error('transport');},async()=>({allowed:false})])test('unknown settlement retains the original execution without replay',async()=>{
  const f=driver({settlement:authority}),result=await executeNativeDriver({id:'parent'},options,f.deps);
  assert.equal(result.code,'EXECUTION_UNCERTAIN');assert.equal(result.executionState,'uncertain');assert.equal(f.turns(),1);assert.equal(f.calls.length,1);
});
for(const failure of ['throw','failed'])test(`native settlement ${failure} retains occupancy`,async()=>{
  const f=driver();const initial=f.deps.native;f.deps.native=async request=>{if(request.operation.operation==='_prepare')return initial(request);f.calls.push(request.operation);if(failure==='throw')throw new Error('native exit');return{status:'failed'};};
  const result=await executeNativeDriver({id:'parent'},options,f.deps);assert.equal(result.code,'EXECUTION_UNCERTAIN');assert.equal(f.turns(),1);assert.deepEqual(f.calls.map(v=>v.operation),['_prepare','_settle']);
});
test('revoked evaluation settles the original model turn without another judge',async()=>{
  const f=driver({settlement:async()=>({allowed:true,allowEvaluation:false})});await executeNativeDriver({id:'parent'},options,f.deps);assert.equal(f.turns(),1);assert.equal(f.calls[1].input.evaluate,false);
});

for(const terminal of [{status:'failed',result:{code:'EXECUTION_UNCERTAIN'}},{status:'failed',result:{result:{code:'EXECUTION_UNCERTAIN'}}},{status:'expired',acked_at:'started'},null])test(`Group retains a pending member when later result is ${terminal?.status || 'unreadable'}`,async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});const calls=[],requests=[];
  const plan={identity:{task_id:'one'},payload:{target_member_id:'peer',prompt:'one'}};
  globalThis.fetch=async(url,request)=>{requests.push(url);if(request.method==='POST')return{ok:true,json:async()=>({actions:[{id:'child',status:'pending'}]})};if(!terminal)throw new Error('network');return{ok:true,json:async()=>({id:'child',...terminal})};};
  const result=await executeBotGroup({id:'parent'},{...options,operation:{resource:'groups',operation:'step',input:{groupId:'room'}}},{authorize:async()=>{},native:async request=>{calls.push(request.operation.operation);return receipt({room:{room_id:'room'},plan});}});
  assert.equal(result.code,'EXECUTION_UNCERTAIN');assert.equal(result.result.memberActionId,'child');assert.deepEqual(calls,['read']);assert.equal(requests.length,2);
});
test('native Group may answer an authorized mention of its source in the parent turn',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});let turns=0,publications=0;
  globalThis.fetch=async(url)=>{assert.match(url,/bot-settle$/);return{ok:true,json:async()=>({allowed:true,allowEvaluation:true})};};
  const result=await executeBotGroup({id:'parent'},{...options,operation:{resource:'groups',operation:'step',input:{groupId:'room'}}},{authorize:async()=>{},runSource:async()=>{turns++;return{status:'succeeded',result:{output:'source response'}};},native:async request=>{if(request.operation.operation==='publish'){publications++;assert.equal(request.operation.input.result.text,'source response');return receipt({room:{room_id:'room'},plan:null});}return receipt({room:{room_id:'room'},plan:{identity:{task_id:'source-turn'},payload:{target_member_id:'source',prompt:'mention'}}});}});
  assert.equal(result.status,'succeeded');assert.equal(turns,1);assert.equal(publications,1);assert.equal(result.result.nativeGroup.runs[0].actionId,'parent');
});
