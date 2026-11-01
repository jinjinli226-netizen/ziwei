import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {ActionDispatcher} from '../src/daemon.mjs';
import {spawnSupervisedRuntime} from '../src/runtime-process.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const action=id=>({id,type:'conversation.execute',payload:{runtime:'Hermes',employeeId:'employee-atlas',profile:'atlas',conversationId:'conversation-atlas',prompt:'isolated fixture only'}});
const turn=(a,home,status='unknown')=>({schemaVersion:1,source:'native_gateway',actionId:a.id,employeeId:a.payload.employeeId,profileHome:home,sessionId:'local-atlas-fixture',inputId:'input-atlas-fixture',admissionId:'admission-atlas-fixture',authorityEpoch:1,executionGeneration:3,phase:'cleanup',status,outcome:status==='terminal'?'interrupted':null,cancelRequested:true,verified:status==='terminal'});
const failure=(a,home,processExit,status='unknown')=>({status:'failed',code:status==='unknown'?'EXECUTION_UNCERTAIN':'runtime_failed',error:'original Gateway turn outcome',...(status==='unknown'?{executionState:'uncertain'}:{}),result:{runtime:'Hermes',gatewayTurns:[turn(a,home,status)],processExit,output:'original diagnostic',...(status==='unknown'?{executionState:'uncertain'}:{})}});
async function until(check,label){const deadline=Date.now()+10000;while(!check()){if(Date.now()>deadline)assert.fail('Timed out waiting for '+label);await delay(5);}}
function fixture(t,{stopGraceMs=2000,execute,now}={}) {
  const root=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-gateway-stop-'))),stateFile=path.join(root,'state.json'),runtimes=[],events=[];
  t.after(async()=>{for(const runtime of runtimes)await runtime.stop();assert.equal(path.dirname(root),path.resolve(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
  const spawn=()=>{
    const runtime=spawnSupervisedRuntime({command:process.execPath,args:['-e',"process.stdout.write('ready\\n');process.stdin.resume();process.stdin.on('end',()=>process.exit(0));"],cwd:root,env:{...process.env},cleanupOnFailure:true});
    let ready=false;runtime.child.stdout.on('data',()=>{ready=true;});runtime.child.stderr.resume();runtimes.push(runtime);
    return{runtime,ready:()=>ready};
  };
  const dispatcher=new ActionDispatcher({workdir:root,stateFile,stopGraceMs,...(now?{now}:{}),onEvent:(name,data)=>events.push({name,data}),execute:(a,context)=>execute(a,context,{root,spawn})});
  return{root,stateFile,dispatcher,events,state:()=>JSON.parse(fs.readFileSync(stateFile,'utf8'))};
}

test('an exited CLI cannot clear an unknown Hermes Gateway turn or discard its native identity',async t=>{
  let actualExit;
  const f=fixture(t,{execute:async(a,context,{root,spawn})=>{
    const{runtime,ready}=spawn();context.onSupervision(runtime);await until(ready,'native CLI ready');runtime.child.stdin.end();actualExit=await runtime.completionEvidence;return failure(a,root,actualExit);
  }}),a=action('natural-unknown'),result=await f.dispatcher.dispatch(a);
  assert.equal(result.code,'EXECUTION_UNCERTAIN');assert.deepEqual(result.result.gatewayTurns,[turn(a,f.root)]);assert.equal(result.result.processExit.rootPid,actualExit.rootPid);assert.equal(result.result.processExit.treeConfirmed,true);
  assert.equal(f.dispatcher.quarantined,true);assert.equal(f.dispatcher.status(a.id).completed,null);assert.equal(f.state().completed.length,0);
  assert.deepEqual(f.state().started[0].quarantine.gatewayTurns,result.result.gatewayTurns);assert.equal(f.state().started[0].quarantine.stopConfirmed,false);
  assert.equal(f.events.some(event=>event.name==='action.quarantine_cleared'),false);
});

for(const reason of ['cancel','timeout'])test(`${reason} retains a returned Gateway unknown after actual owned CLI cleanup`,async t=>{
  let ready,actualExit,now=Date.now();
  const f=fixture(t,{...(reason==='timeout'?{now:()=>now}:{}),execute:async(a,context,{root,spawn})=>{
    const native=spawn();ready=native.ready;context.onSupervision(native.runtime);actualExit=await native.runtime.completionEvidence;return failure(a,root,actualExit);
  }}),a=action(reason+'-unknown');
  if(reason==='timeout')a.payload.idleTimeoutMs=150;
  const pending=f.dispatcher.dispatch(a);await until(()=>ready?.(),'native CLI ready');if(reason==='cancel')assert.equal(f.dispatcher.cancel(a.id),true);else now+=1000;
  const result=await pending;
  assert.equal(result.code,'EXECUTION_UNCERTAIN');assert.deepEqual(result.result.gatewayTurns,[turn(a,f.root)]);assert.equal(result.result.processExit.rootPid,actualExit.rootPid);assert.equal(result.result.processExit.activeProcesses,0);
  assert.equal(f.dispatcher.quarantined,true);assert.equal(f.state().started[0].quarantine.stopConfirmed,false);assert.equal(f.state().completed.length,0);
});

test('a late owned CLI tree exit cannot settle an already unknown Gateway turn',async t=>{
  const release=deferred();let actual,ready;
  const f=fixture(t,{stopGraceMs:20,execute:async(a,context,{root,spawn})=>{
    const native=spawn();actual=native.runtime;ready=native.ready;
    context.onSupervision({completionEvidence:actual.completionEvidence,stop:async()=>{await release.promise;return actual.stop();}});
    await until(ready,'native CLI ready');return failure(a,root,null);
  }}),a=action('late-cli-exit'),result=await f.dispatcher.dispatch(a);
  assert.equal(result.code,'EXECUTION_UNCERTAIN');assert.equal(f.dispatcher.quarantined,true);assert.deepEqual(result.result.gatewayTurns,[turn(a,f.root)]);
  release.resolve();const actualExit=await actual.completionEvidence;await delay(20);
  assert.equal(actualExit.activeProcesses,0);assert.equal(f.dispatcher.quarantined,true);assert.equal(f.dispatcher.status(a.id).completed,null);
  const saved=f.state().started[0].quarantine;assert.equal(saved.stopConfirmed,false);assert.equal(saved.processExit.rootPid,actualExit.rootPid);assert.equal(saved.processExit.treeConfirmed,true);assert.deepEqual(saved.gatewayTurns,[turn(a,f.root)]);
  assert.equal(f.events.some(event=>event.name==='action.result_recovered'),false);
});

test('Gateway unknown arriving after cancellation grace is retained durably without being cleared by its exited CLI',async t=>{
  const settled=deferred();let actual,ready;
  const f=fixture(t,{stopGraceMs:20,execute:async(a,context,{root,spawn})=>{
    const native=spawn();actual=native.runtime;ready=native.ready;context.onSupervision(actual);
    const exit=await actual.completionEvidence;await settled.promise;return failure(a,root,exit);
  }}),a=action('late-executor-unknown'),pending=f.dispatcher.dispatch(a);
  await until(()=>ready?.(),'native CLI ready');f.dispatcher.cancel(a.id);const first=await pending;assert.equal(first.code,'EXECUTION_UNCERTAIN');
  const actualExit=await actual.completionEvidence;settled.resolve();await delay(20);
  assert.equal(f.dispatcher.quarantined,true);assert.equal(f.state().completed.length,0);
  assert.deepEqual(f.state().started[0].quarantine.gatewayTurns,[turn(a,f.root)]);assert.equal(f.state().started[0].quarantine.processExit.rootPid,actualExit.rootPid);assert.equal(f.state().started[0].quarantine.stopConfirmed,false);
  const restarted=new ActionDispatcher({stateFile:f.stateFile,workdir:f.root,execute:async()=>assert.fail('must not repeat original task')});assert.equal(restarted.quarantined,true);assert.equal((await restarted.dispatch(a)).code,'EXECUTION_UNCERTAIN');
});

test('an explicitly terminal Gateway business failure finishes normally after its actual CLI exit',async t=>{
  const f=fixture(t,{execute:async(a,context,{root,spawn})=>{
    const{runtime,ready}=spawn();context.onSupervision(runtime);await until(ready,'native CLI ready');runtime.child.stdin.end();return failure(a,root,await runtime.completionEvidence,'terminal');
  }}),a=action('terminal-failure'),result=await f.dispatcher.dispatch(a);
  assert.equal(result.status,'failed');assert.equal(result.code,'runtime_failed');assert.deepEqual(result.result.gatewayTurns,[turn(a,f.root,'terminal')]);assert.equal(result.result.processExit.treeConfirmed,true);
  assert.equal(f.dispatcher.quarantined,false);assert.equal(f.state().completed.length,1);assert.equal((await f.dispatcher.dispatch(a)).status,'duplicate');
});
