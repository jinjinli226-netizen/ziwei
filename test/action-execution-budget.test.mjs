import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as flush} from 'node:timers/promises';
import {ActionDispatcher} from '../src/daemon.mjs';
import {createRepository} from '../backend/repository.mjs';
import {actionExecutionTimeoutMs,actionExecutionLeaseMs,NATIVE_LONG_TASK_TIMEOUT_MS,DEFAULT_ACTION_EXECUTION_TIMEOUT_MS,ACTION_EXECUTION_LEASE_BUFFER_MS} from '../src/action-execution-budget.mjs';

const hour=60*60*1000,epoch=Date.parse('2026-10-16T10:00:00Z');
const tree={platform:'win32',supervisor:'windows-job',launched:true,rootPid:1234,rootConfirmed:true,rootExitCode:1,treeConfirmed:true,activeProcesses:0,cancelled:true};
const action=(payload={},type='conversation.execute')=>({id:'budget-action',type,payload:{runtime:'Hermes',prompt:'fixture only',...payload}});

test('only native model task families get the 24-hour default, while maintenance keeps its budget',()=>{
  for(const type of ['conversation.execute','agent.execute','runtime.execute','automation.execute'])assert.equal(actionExecutionTimeoutMs({type}),24*hour,type);
  for(const payload of [{runtime:'Hermes'},{agent:'Hermes'},{modelId:'fixture'},{prompt:'fixture'}])assert.equal(actionExecutionTimeoutMs({type:'task.execute',payload}),24*hour);
  for(const [resource,operation] of [['groups','step'],['goals','step'],['heartbeat','step'],['kanban','dispatch']])assert.equal(actionExecutionTimeoutMs({type:'hermes.bot.native',payload:{nativeOperation:{resource,operation}}}),24*hour);
  assert.equal(actionExecutionTimeoutMs({type:'hermes.bot.native',payload:{nativeOperation:{resource:'collaboration',operation:'message',input:{mode:'group'}}}}),24*hour);
  for(const [resource,operation] of [['goals','start'],['heartbeat','status'],['kanban','claim'],['gateway','connect'],['voice','transcribe'],['mcp','call'],['groups','status']])assert.equal(actionExecutionTimeoutMs({type:'hermes.bot.native',payload:{nativeOperation:{resource,operation}}}),15*60*1000);
  assert.equal(actionExecutionTimeoutMs({type:'hermes.bot.native',payload:{nativeOperation:{resource:'collaboration',operation:'message',input:{mode:'delegate'}}}}),15*60*1000);
  for(const type of ['hermes.bot.provision','hermes.bot.validate','hermes.bot.native','directory.inspect','phone.command','command.execute','action.cancel','task.execute'])assert.equal(actionExecutionTimeoutMs({type}),15*60*1000,type);
  assert.equal(NATIVE_LONG_TASK_TIMEOUT_MS,24*hour);assert.equal(DEFAULT_ACTION_EXECUTION_TIMEOUT_MS,15*60*1000);assert.equal(ACTION_EXECUTION_LEASE_BUFFER_MS,60000);
});

test('explicit shorter execution limits remain effective and retain the result-upload lease floor',()=>{
  for(const payload of [{timeoutMs:100},{timeout_ms:'100'},{timeoutMs:0},{timeoutMs:-100}]){
    assert.equal(actionExecutionTimeoutMs(action(payload)),100);assert.equal(actionExecutionLeaseMs(action(payload)),16*60*1000);
  }
  assert.equal(actionExecutionTimeoutMs(action({timeoutMs:30*60*1000})),30*60*1000);
  assert.equal(actionExecutionTimeoutMs(action({timeoutMs:Number.MAX_VALUE})),2**31-1);
  for(const value of [undefined,null,'','invalid',Infinity])assert.equal(actionExecutionTimeoutMs(action({timeoutMs:value})),24*hour);
});

test('repository create, ACK, progress and delivery renewal share the long-task budget without replay',t=>{
  t.mock.timers.enable({apis:['Date'],now:epoch});
  const repo=createRepository({memory:true});t.after(()=>repo.db.close());
  const original=repo.createA2AAction('test-111',{type:'conversation.execute',dedupeKey:'budget-long',payload:{runtime:'Hermes',deviceId:'fixture-pc'}});
  assert.equal(Date.parse(original.expires_at)-Date.parse(original.created_at),24*hour+60000);
  t.mock.timers.tick(20*60*1000);
  const ack=repo.ackA2AAction(original.id,{deviceId:'fixture-pc'});
  assert.equal(Date.parse(ack.expires_at)-Date.parse(ack.acked_at),24*hour+60000);
  t.mock.timers.tick(hour);
  const event=repo.recordA2AEvent(original.id,{deviceId:'fixture-pc',type:'action.progress',message:'fixture',data:{bytes:1}});
  assert.equal(Date.parse(repo.listA2AActions('test-111',{status:'acked'})[0].expires_at)-Date.parse(event.created_at),24*hour+60000);
  t.mock.timers.tick(hour);
  const renewed=repo.ackA2AAction(original.id,{deviceId:'fixture-pc',receiptOnly:true,renewLease:true});
  assert.equal(Date.parse(renewed.expires_at)-Date.now(),24*hour+60000);assert.equal(renewed.acked_at,ack.acked_at);
  assert.equal(repo.createA2AAction('test-111',{type:'conversation.execute',dedupeKey:'budget-long'}).id,original.id);
  repo.resultA2AAction(original.id,{deviceId:'fixture-pc',status:'succeeded',result:{output:'fixture completed'}});
  t.mock.timers.tick(hour);
  const terminal=repo.ackA2AAction(original.id,{deviceId:'fixture-pc',receiptOnly:true,renewLease:true});
  assert.equal(terminal.status,'succeeded');assert.equal(terminal.expires_at,renewed.expires_at);assert.notEqual(terminal.leaseRenewed,true);
});

test('short explicit actions and non-model commands keep their original server delivery windows',t=>{
  t.mock.timers.enable({apis:['Date'],now:epoch});
  const repo=createRepository({memory:true});t.after(()=>repo.db.close());
  for(const input of [{type:'conversation.execute',payload:{timeout_ms:100}},{type:'command.execute',payload:{}},{type:'task.execute',payload:{title:'ordinary local task'}}]){
    const current=repo.createA2AAction('test-111',input),ack=repo.ackA2AAction(current.id);
    assert.equal(Date.parse(current.expires_at)-Date.parse(current.created_at),16*60*1000);
    assert.equal(Date.parse(ack.expires_at)-Date.parse(ack.acked_at),16*60*1000);
  }
});

async function running(t,requested=action(),expiresIn){
  t.mock.timers.enable({apis:['Date','setTimeout'],now:epoch});
  let execution,resolveExit,resolveExecution,calls=0,stops=0;
  const completionEvidence=new Promise(resolve=>{resolveExit=resolve;});
  const dispatcher=new ActionDispatcher({stopGraceMs:100,execute:async(_action,context)=>{
    calls++;execution=context;
    context.onSupervision({completionEvidence,stop:async()=>{stops++;resolveExit(tree);return tree;}});
    return new Promise(resolve=>{resolveExecution=resolve;context.signal.addEventListener('abort',()=>resolve({status:'failed',code:'cancelled'}),{once:true});});
  }});
  const original={...requested,...(expiresIn!==undefined?{expires_at:new Date(epoch+expiresIn).toISOString()}:{})},pending=dispatcher.dispatch(original);
  t.after(()=>{dispatcher.cancel(original.id);resolveExecution?.({status:'failed',code:'cancelled'});resolveExit(tree);});
  await flush();assert.ok(execution);
  return{dispatcher,original,pending,get signal(){return execution.signal;},get calls(){return calls;},get stops(){return stops;}};
}

test('a native conversation stays alive beyond 15 minutes and stops at the fixed 24-hour deadline with tree proof',async t=>{
  const f=await running(t);
  t.mock.timers.tick(16*60*1000);await flush();assert.equal(f.signal.aborted,false);
  t.mock.timers.tick(24*hour-16*60*1000-1);await flush();assert.equal(f.signal.aborted,false);
  t.mock.timers.tick(1);const result=await f.pending;
  assert.equal(result.code,'action_timeout');assert.match(result.error,/86400000ms/);assert.equal(f.stops,1);
  assert.deepEqual(result.result.processExit,tree);assert.equal(f.dispatcher.quarantined,false);
});

test('a caller can still request a shorter native deadline',async t=>{
  const f=await running(t,action({timeoutMs:100}));
  t.mock.timers.tick(99);await flush();assert.equal(f.signal.aborted,false);
  t.mock.timers.tick(1);const result=await f.pending;assert.equal(result.code,'action_timeout');assert.match(result.error,/100ms/);assert.equal(f.stops,1);
});

test('an existing short ACK lease still clamps a new long default and preserves its shutdown reserve',async t=>{
  const f=await running(t,action(),60250);
  t.mock.timers.tick(249);await flush();assert.equal(f.signal.aborted,false);
  t.mock.timers.tick(1);const result=await f.pending;assert.equal(result.code,'action_timeout');assert.match(result.error,/250ms/);assert.equal(f.stops,1);
});

test('manual stop still confirms the original action and a retry never executes it a second time',async t=>{
  const f=await running(t);t.mock.timers.tick(16*60*1000);await flush();
  assert.equal(f.dispatcher.cancel(f.original.id),true);
  const result=await f.pending;assert.equal(result.code,'cancelled');assert.equal(result.result.processExit.treeConfirmed,true);assert.equal(f.stops,1);
  const duplicate=await f.dispatcher.dispatch(f.original);assert.equal(duplicate.status,'duplicate');assert.equal(duplicate.originalStatus,'failed');assert.equal(f.calls,1);
});
