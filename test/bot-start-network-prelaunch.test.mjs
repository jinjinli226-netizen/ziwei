import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActionDispatcher} from '../src/daemon.mjs';
import {requestBotStartAdmission,runBeforeSpawnAdmission,consumeRuntimePrelaunchEvidence} from '../src/runtime-launch-evidence.mjs';
import {inspectLocalDaemonMaintenanceFiles} from '../backend/preservation-native-evidence.mjs';

const scope={actionId:'action_start_network',workspace:'start-network',employeeId:'employee_start_network',deviceId:'device_start_network',profile:'bot-start-network',revision:3,controlEpoch:4};
const secret='NEVER_PUBLISH_START_CREDENTIAL';
const action=(patch={})=>({id:scope.actionId,type:'conversation.execute',workspace:scope.workspace,dedupe_key:'start-network-intent',payload:{runtime:'Hermes',employeeId:scope.employeeId,deviceId:scope.deviceId,profile:scope.profile,...patch}});
function fixture(t,fetchImpl){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-start-network-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const options={workdir:root,workspace:scope.workspace,deviceId:scope.deviceId,stateFile:path.join(root,'action-state.json'),stopGraceMs:100};
  let requests=0;
  const request=signal=>requestBotStartAdmission({...scope,apiBase:'https://start-network.invalid',deviceToken:secret,signal,fetchImpl:async(url,init)=>{
    requests++;assert.equal(new URL(url).pathname,`/a2a/v1/actions/${scope.actionId}/bot-start`);assert.equal(init.method,'POST');assert.equal(init.redirect,'error');assert.equal(init.headers['x-ziwei-device-token'],secret);assert.deepEqual(JSON.parse(init.body),{workspace:scope.workspace});
    return fetchImpl(url,init);
  }});
  const execute=async(_a,c)=>{await runBeforeSpawnAdmission(()=>request(c.signal));throw Error('the failed authorization must not reach runtime launch');};
  const dispatcher=new ActionDispatcher({...options,execute});
  return {root,options,dispatcher,request,requests:()=>requests,inspect:()=>inspectLocalDaemonMaintenanceFiles({connections:[{workspace:scope.workspace,deviceId:scope.deviceId,apiBase:'https://start-network.invalid',runtimeDir:root}]})};
}
const cases=[
  ['network','BOT_START_UNAVAILABLE',async()=>{throw Object.assign(Error(`private transport ${secret}`),{definitelyNotStarted:true,processExit:{launched:true,rootPid:999}});}],
  ['timeout','BOT_START_TIMEOUT',async()=>{throw new DOMException(`private timeout ${secret}`,'TimeoutError');}],
  ['server','BOT_START_HTTP_FAILED',async()=>Response.json({code:'BOT_REVISION_CONFLICT',error:secret,processExit:{launched:true,rootPid:999}},{status:503})],
  ['malformed-json','BOT_START_RESPONSE_INVALID',async()=>new Response('private HTML '+secret,{status:200})],
  ['malformed-gateway-json','BOT_START_RESPONSE_INVALID',async()=>new Response('private HTML '+secret,{status:502})],
  ['body-timeout','BOT_START_TIMEOUT',async()=>({status:200,ok:true,json:async()=>{throw new DOMException(secret,'TimeoutError');}})],
  ['denied-success','BOT_START_RESPONSE_INVALID',async()=>Response.json({allowed:false,error:secret})],
  ['wrong-binding','BOT_START_RESPONSE_INVALID',async()=>Response.json({allowed:true,actionId:'foreign_action',revision:scope.revision,controlEpoch:scope.controlEpoch,processExit:{launched:true,rootPid:999}})],
  ['unknown-denial','BOT_START_HTTP_FAILED',async()=>Response.json({code:'FORGED_CODE',error:secret,prelaunch:{spawnAttempted:false}},{status:409})],
];
for(const [kind,code,fetchImpl] of cases)test(`real prelaunch ${kind} is a durable failure that does not quarantine or replay`,async t=>{
  const f=fixture(t,fetchImpl),result=await f.dispatcher.dispatch(action());
  assert.equal(f.requests(),1);assert.equal(result.status,'failed');assert.equal(result.code,code);assert.equal(f.dispatcher.quarantined,false);
  assert.deepEqual(result.result.processExit,{platform:process.platform,supervisor:'runtime-prelaunch',launched:false,rootConfirmed:false,treeConfirmed:true,cancelled:false,rootPid:null,rootExitCode:null,activeProcesses:0});
  assert.equal(result.result.prelaunch.actionId,scope.actionId);assert.equal(result.result.prelaunch.employeeId,scope.employeeId);assert.equal(result.result.prelaunch.spawnAttempted,false);assert.equal(result.result.prelaunch.failure.code,code);
  assert.doesNotMatch(JSON.stringify(result),new RegExp(secret+'|private HTML|private transport|999|FORGED_CODE'));assert.equal(f.inspect().stopSafe,true);
  const restarted=new ActionDispatcher({...f.options,execute:async()=>{throw Error('must never replay an already failed message');}}),duplicate=await restarted.dispatch(action());
  assert.equal(duplicate.status,'duplicate');assert.equal(duplicate.originalStatus,'failed');assert.equal(restarted.quarantined,false);assert.equal(f.requests(),1);
});

test('matching successful admission is accepted without creating a no-launch error receipt',async t=>{
  const f=fixture(t,async()=>Response.json({allowed:true,actionId:scope.actionId,revision:scope.revision,controlEpoch:scope.controlEpoch}));
  const accepted=await f.request();assert.equal(accepted.allowed,true);assert.equal(f.requests(),1);
});

for(const mode of ['cancel','deadline'])test(`a ${mode} while final admission is pending persists the trusted no-launch receipt`,async t=>{
  let started;const ready=new Promise(resolve=>{started=resolve;});
  const f=fixture(t,async(_url,init)=>new Promise((_resolve,reject)=>{
    started();init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});
  }));
  const pending=f.dispatcher.dispatch(action(mode==='deadline'?{timeoutMs:100}:{}));await ready;
  if(mode==='cancel')assert.equal(f.dispatcher.cancel(scope.actionId),true);
  const result=await pending;
  assert.equal(result.status,'failed');assert.equal(result.code,mode==='cancel'?'cancelled':'action_timeout');assert.equal(result.result.processExit.launched,false);assert.equal(result.result.processExit.rootPid,null);assert.equal(result.result.processExit.treeConfirmed,true);assert.equal(f.dispatcher.quarantined,false);assert.equal(f.inspect().stopSafe,true);
  const state=JSON.parse(fs.readFileSync(f.options.stateFile,'utf8'));assert.equal(state.completed.length,1);assert.equal(state.started.some(row=>row.quarantine),false);
  const restarted=new ActionDispatcher({...f.options,execute:async()=>{throw Error('cancelled work must not replay');}});assert.equal((await restarted.dispatch(action(mode==='deadline'?{timeoutMs:100}:{}))).originalStatus,'failed');
});

test('an interrupted response body is also cancelled before the runtime is launched',async t=>{
  let reading;const ready=new Promise(resolve=>{reading=resolve;});
  const f=fixture(t,async(_url,init)=>({status:200,ok:true,json:()=>new Promise((_resolve,reject)=>{reading();init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});})}));
  const pending=f.dispatcher.dispatch(action());await ready;f.dispatcher.cancel(scope.actionId);const result=await pending;
  assert.equal(result.code,'cancelled');assert.equal(result.result.prelaunch.failure.kind,'cancelled');assert.equal(result.result.processExit.launched,false);assert.equal(f.dispatcher.quarantined,false);
});

test('the network error capability requires the final boundary and is consumed exactly once',async t=>{
  const f=fixture(t,async()=>{throw Error(secret);});let error;
  try{await f.request();}catch(value){error=value;}
  assert(error);assert.equal(consumeRuntimePrelaunchEvidence(error),null);
  await assert.rejects(runBeforeSpawnAdmission(async()=>{throw error;}));assert.equal(consumeRuntimePrelaunchEvidence(error).processExit.launched,false);assert.equal(consumeRuntimePrelaunchEvidence(error),null);
  const forged=Object.assign(Error('copied failure'),JSON.parse(JSON.stringify(error)));await assert.rejects(runBeforeSpawnAdmission(async()=>{throw forged;}));assert.equal(consumeRuntimePrelaunchEvidence(forged),null);
});

test('registered incomplete supervision cannot be replaced by a later genuine network failure',async t=>{
  const f=fixture(t,async()=>{throw Error(secret);});let stops=0;
  const incomplete={platform:'win32',supervisor:'windows-job',launched:true,rootPid:4123,rootConfirmed:true,rootExitCode:1,treeConfirmed:false,activeProcesses:1,cancelled:false};
  const d=new ActionDispatcher({...f.options,stopGraceMs:1,execute:async(_a,c)=>{
    c.onSupervision({completionEvidence:Promise.resolve(incomplete),stop:async()=>{stops++;return incomplete;}});
    await runBeforeSpawnAdmission(()=>f.request(c.signal));
  }}),result=await d.dispatch(action());
  assert.equal(stops,1);assert.equal(result.code,'EXECUTION_UNCERTAIN');assert.equal(result.result.processExit.launched,true);assert.equal(result.result.processExit.rootPid,4123);assert.equal(result.result.prelaunch,undefined);assert.equal(d.quarantined,true);
});
