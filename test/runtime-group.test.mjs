import test from 'node:test';
import assert from 'node:assert/strict';
import * as module from '../src/hermes-group-runtime.mjs';
import {ActionDispatcher} from '../src/daemon.mjs';

function child(){let resolve;const completionEvidence=new Promise(done=>{resolve=done;});let stops=0;return{completionEvidence,stop:()=>{stops++;resolve({launched:true,rootConfirmed:true,treeConfirmed:true,activeProcesses:0,cancelled:true});return completionEvidence;},finish:(extra={})=>resolve({launched:true,rootConfirmed:true,treeConfirmed:true,activeProcesses:0,...extra}),stops:()=>stops};}
test('group completion stays pending between source turns and stops the second child',async()=>{
  const group=module.createGroupSupervision(),one=child(),two=child();let settled=false;
  group.completionEvidence.then(()=>{settled=true;});group.add(one);one.finish();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);
  group.add(two);const stopping=group.stop();assert.throws(()=>group.assertRunning(),/GROUP_STOPPED/);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);assert.equal(two.stops(),1);
  group.seal();const evidence=await stopping;assert.equal(evidence.treeConfirmed,true);assert.equal(evidence.supervisor,'runtime-group');assert.equal(evidence.rootPid,null);assert.equal(evidence.cancelled,true);
});
test('late child is stopped and uncertain tree evidence is never promoted',async()=>{
  const group=module.createGroupSupervision();const stopping=group.stop(),late=child();
  late.finish({treeConfirmed:false,activeProcesses:null});group.add(late);group.seal();
  const evidence=await stopping;assert.equal(late.stops(),1);assert.equal(evidence.treeConfirmed,false);assert.equal(evidence.activeProcesses,null);
});
test('never-launched without confirmed cleanup remains uncertain',async()=>{
  const group=module.createGroupSupervision(),one=child();group.add(one);one.finish({launched:false,rootConfirmed:false,treeConfirmed:false,activeProcesses:null});group.seal();
  const evidence=await group.completionEvidence;assert.equal(evidence.treeConfirmed,false);assert.equal(evidence.rootConfirmed,false);assert.equal(evidence.activeProcesses,null);
});

for(const confirmed of [true,false])test(`dispatcher stop on second source requires its tree proof (${confirmed}) and never replays`,async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async()=>({ok:true,json:async()=>({allowed:true,allowEvaluation:true})});
  let turns=0,registrations=0,secondReady,releaseSecond,stopCalled,resolveStop;
  const ready=new Promise(resolve=>{secondReady=resolve;}),stopped=new Promise(resolve=>{resolveStop=resolve;});
  const options={context:{employeeId:'source',config:{drivers:{maxTotalTurns:3}}},workspace:'test',apiBase:'http://fixture.invalid',operation:{resource:'groups',operation:'step',input:{groupId:'room'}}};
  const dispatcher=new ActionDispatcher({workdir:process.cwd(),stopGraceMs:50,execute:(action,execution)=>module.executeBotGroup(action,{...options,onSupervision:supervision=>{registrations++;execution.onSupervision(supervision);}},{signal:execution.signal,authorize:async()=>{},native:async()=>({status:'succeeded',result:{nativeOperation:{data:{room:{room_id:'room'},plan:{identity:{task_id:`turn-${turns}`},payload:{target_member_id:'source',prompt:'one'}}}}}}),runSource:async(plan,supervision)=>{
    await supervision.beforeSpawn();turns++;
    if(turns===1){const one=child();supervision.onSupervision(one);one.finish();return{status:'succeeded',result:{output:'@source again'}};}
    const completionEvidence=new Promise(resolve=>{releaseSecond=()=>resolve({platform:'win32',launched:true,rootConfirmed:true,treeConfirmed:confirmed,activeProcesses:confirmed?0:null});});
    supervision.onSupervision({completionEvidence,stop:()=>{stopCalled=true;resolveStop();return completionEvidence;}});secondReady();await completionEvidence;return{status:'failed',code:'cancelled'};
  }})});
  const parent={id:'parent',idempotencyKey:'original-group',type:'hermes.bot.native',payload:{workdir:process.cwd()}},pending=dispatcher.dispatch(parent);let terminal=false;pending.then(()=>{terminal=true;});
  await ready;assert.equal(dispatcher.cancel('parent'),true);await stopped;assert.equal(stopCalled,true);assert.equal(terminal,false);assert.equal(registrations,1);releaseSecond();
  const result=await pending;assert.equal(result.code,confirmed?'cancelled':'EXECUTION_UNCERTAIN');assert.equal(result.result.processExit.treeConfirmed,confirmed);assert.equal(turns,2);
  const replay=await dispatcher.dispatch(parent);assert.equal(replay.code,confirmed?'cancelled':'EXECUTION_UNCERTAIN');assert.equal(turns,2);
});
