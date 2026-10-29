import test from 'node:test';
import assert from 'node:assert/strict';
import * as module from '../src/hermes-group-runtime.mjs';
import {ActionDispatcher} from '../src/daemon.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {spawnSupervisedRuntime} from '../src/runtime-process.mjs';

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

test('stopping a sealed group uses new cleanup evidence and does not stop members already at tree zero',async()=>{
  const complete=child();let cleanups=0;
  const retained={launched:true,rootConfirmed:true,rootExitCode:0,treeConfirmed:false,activeProcesses:2,backgroundProcessesRetained:true};
  const cleanup={...retained,treeConfirmed:true,activeProcesses:0,backgroundProcessesRetained:false,cancelled:true};
  const group=module.createGroupSupervision();group.add(complete);complete.finish();
  group.add({completionEvidence:Promise.resolve(retained),stop:async()=>{cleanups++;return cleanup;}});group.seal();
  const prior=await group.completionEvidence;assert.equal(prior.treeConfirmed,false);assert.equal(cleanups,0);
  const stopped=await group.stop();assert.notEqual(stopped,prior);assert.equal(stopped.treeConfirmed,true);assert.equal(stopped.activeProcesses,0);assert.equal(stopped.children[1],cleanup);
  assert.equal(cleanups,1);assert.equal(complete.stops(),0);assert.equal(retained.backgroundProcessesRetained,true);
  assert.equal(await group.stop(),stopped);assert.equal(cleanups,1);
});

test('a failed cleanup returns its actual new uncertain tree rather than the old resolved group evidence',async()=>{
  const retained={launched:true,rootConfirmed:true,treeConfirmed:false,activeProcesses:3},cleanup={...retained,activeProcesses:1,failureCode:'FIXTURE_STOP_UNCONFIRMED'};
  const group=module.createGroupSupervision();group.add({completionEvidence:Promise.resolve(retained),stop:async()=>cleanup});group.seal();const prior=await group.completionEvidence;
  const stopped=await group.stop();assert.notEqual(stopped,prior);assert.equal(stopped.treeConfirmed,false);assert.equal(stopped.activeProcesses,null);assert.equal(stopped.children[0],cleanup);
});

test('Windows group stop reaps a real retained child tree after the successful root has exited', {skip:process.platform!=='win32',timeout:30000},async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-group-retained-')),pidFile=path.join(directory,'background.pid'),entry=path.join(directory,'root.cjs');let runtime;
  t.after(async()=>{if(runtime)await runtime.stop();fs.rmSync(directory,{recursive:true,force:true});});
  fs.writeFileSync(entry,`const p=require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},15000)'],{detached:true,stdio:'ignore',windowsHide:true});p.unref();require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(p.pid));setTimeout(()=>process.exit(0),100);`);
  runtime=spawnSupervisedRuntime({command:process.execPath,args:[entry],cwd:directory,env:process.env});runtime.child.on('error',()=>{});runtime.child.stdin.end();
  const group=module.createGroupSupervision();group.add(runtime);
  const retained=await runtime.completionEvidence;group.seal();const prior=await group.completionEvidence,pid=Number(fs.readFileSync(pidFile,'utf8'));
  const exists=()=>{try{process.kill(pid,0);return true;}catch{return false;}};
  assert.equal(retained.rootExitCode,0);assert.equal(retained.backgroundProcessesRetained,true);assert.equal(prior.treeConfirmed,false);assert.equal(exists(),true);
  await delay(100);assert.equal(exists(),true,'a successful group does not stop an intentional background service');
  const stopped=await group.stop();assert.notEqual(stopped,prior);assert.equal(stopped.treeConfirmed,true);assert.equal(stopped.activeProcesses,0);assert.equal(stopped.children[0].rootPid,retained.rootPid);assert.equal(stopped.children[0].backgroundProcessesRetained,false);
  assert.equal(exists(),false);assert.equal(retained.backgroundProcessesRetained,true);
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
