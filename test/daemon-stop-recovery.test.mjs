import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {ActionDispatcher} from '../src/daemon.mjs';
import {createActionDelivery} from '../src/daemon-action-delivery.mjs';

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const identity={apiBase:'https://example.invalid',workspace:'fixture',deviceId:'device-A'};
const action=(id='target')=>({id,type:'conversation.execute',workspace_id:'ws-fixture',payload:{deviceId:'device-A',employeeId:'bot-fixture',conversationId:'conversation-fixture'}});
const exit={platform:'win32',supervisor:'windows-job',launched:true,rootPid:12345,rootConfirmed:true,rootExitCode:null,treeConfirmed:true,activeProcesses:0,cancelled:true,failureCode:null};
const definitive={status:'failed',code:'cancelled',error:'cancelled with verified exit',result:{processExit:exit,partialEffectsPossible:true}};
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-stop-recovery-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const states=new Map(),calls=[],ackedAt=new Date().toISOString();
 const post=async(url,body)=>{
  const id=decodeURIComponent(url.split('/')[4]),state=states.get(id)||{status:'pending'};
  states.set(id,state);calls.push({id,url,body});
  if(url.endsWith('/events'))return {id:body.eventId};
  if(url.endsWith('/ack')){
   if(state.status==='pending')state.status='acked';
   return {id,status:state.status,acked_at:ackedAt,deviceId:identity.deviceId,expires_at:new Date(Date.now()+(state.status==='expired'?-1000:16*60*1000)).toISOString(),...(state.status==='expired'||state.uncertain?{reconciliationRequired:true}: {})};
  }
  if(state.failUpload)throw new Error('upload interrupted');
  state.status=body.status;state.uncertain=body.result?.code==='EXECUTION_UNCERTAIN';
  return {id,status:state.status,deviceId:identity.deviceId};
 };
 return {root,states,calls,post,create:options=>createActionDelivery({directory:path.join(root,'delivery'),identity,post,retryDelays:[],...options})};
}

test('expired ACK restores a verified durable result under its original ID without execution or lease renewal',async t=>{
 const f=fixture(t);let executions=0;
 f.states.set('target',{status:'pending',failUpload:true});
 await assert.rejects(f.create({dispatch:async()=>{executions++;return definitive;}}).execute(action()),/interrupted/);
 Object.assign(f.states.get('target'),{status:'expired',failUpload:false});
 const before=f.calls.length,e=f.create({dispatch:async()=>{throw new Error('must never reexecute');}});
 const receipt=await e.execute(e.recoverActions()[0]);
 assert.deepEqual(receipt,{state:'confirmed',status:'failed'});assert.equal(executions,1);
 const resumed=f.calls.slice(before);assert.equal(resumed.length,2);
 assert.ok(resumed.every(row=>row.id==='target'));
 assert.equal(resumed[0].url.endsWith('/ack'),true);assert.equal(resumed[1].url.endsWith('/result'),true);
 assert.deepEqual(resumed[1].body.result.processExit,exit);assert.equal(resumed[1].body.result.code,undefined);
});

test('expired actions with absent or uncertain exit proof stay unconfirmed and never execute',async t=>{
 for(const result of [{status:'succeeded',result:{output:'no proof'}},{...definitive,result:{processExit:{...exit,treeConfirmed:false}}},{...definitive,code:'EXECUTION_UNCERTAIN',executionState:'uncertain'}]){
  const f=fixture(t);f.states.set('target',{status:'pending',failUpload:true});let executions=0;
  await assert.rejects(f.create({dispatch:async()=>{executions++;return result;}}).execute(action()),/interrupted/);
  Object.assign(f.states.get('target'),{status:'expired',failUpload:false});
  const before=f.calls.length,e=f.create({dispatch:async()=>{throw new Error('expired action must not execute');}});
  assert.deepEqual(await e.execute(action()),{state:'unconfirmed',status:'expired'});
  assert.equal(executions,1);assert.equal(f.calls.slice(before).some(row=>row.url.endsWith('/result')),false);
  assert.equal(e.recoverActions().length,1);
 }
});

test('late Windows completion proof persists a failure and redelivers the original uncertain action',async t=>{
 const f=fixture(t),stopped=deferred();let delivery,recovered,executions=0;
 const dispatcher=new ActionDispatcher({workspace:identity.workspace,deviceId:identity.deviceId,workdir:f.root,stateFile:path.join(f.root,'state.json'),stopGraceMs:10,onEvent:(event,data)=>{
  if(event==='action.result_recovered')recovered=delivery.recoverOriginal(data.actionId);
 },execute:async(_a,context)=>{
  executions++;context.onSupervision({completionEvidence:stopped.promise,stop:()=>stopped.promise});
  await new Promise(resolve=>context.signal.addEventListener('abort',resolve,{once:true}));return {};
 }});
 delivery=f.create({dispatch:a=>dispatcher.dispatch(a),recoverResult:a=>dispatcher.completedResult(a)});
 await delivery.execute({...action(),payload:{...action().payload,idleTimeoutMs:100}});
 assert.equal(f.states.get('target').uncertain,true);assert.equal(dispatcher.quarantined,true);
 stopped.resolve(exit);for(let i=0;i<50&&!recovered;i++)await delay(5);
 assert.ok(recovered);assert.deepEqual(await recovered,{state:'confirmed',status:'failed'});
 assert.equal(dispatcher.quarantined,false);assert.equal(executions,1);
 const results=f.calls.filter(row=>row.url.endsWith('/result'));
 assert.equal(results.length,2);assert.equal(results[0].body.result.code,'EXECUTION_UNCERTAIN');
 assert.equal(results[1].body.result.code,undefined);assert.equal(results[1].body.result.processExit.treeConfirmed,true);
 const saved=JSON.parse(fs.readFileSync(path.join(f.root,'state.json')));
 assert.equal(saved.completed[0].result.status,'failed');assert.equal(saved.started[0].quarantine.stopConfirmed,true);
 const restarted=new ActionDispatcher({workspace:identity.workspace,deviceId:identity.deviceId,workdir:f.root,stateFile:path.join(f.root,'state.json'),execute:async()=>{throw new Error('must not reexecute');}});
 assert.equal(restarted.completedResult(action()).originalStatus,'failed');
});

test('cancel with a cached terminal exit confirms the original result before claiming stop confirmation',async t=>{
 const f=fixture(t);let executions=0;
 const dispatcher=new ActionDispatcher({workspace:identity.workspace,deviceId:identity.deviceId,workdir:f.root,stateFile:path.join(f.root,'state.json'),execute:async(_a,context)=>{
  executions++;context.onSupervision({completionEvidence:Promise.resolve(exit),stop:async()=>exit});return definitive;
 }});
 const delivery=f.create({dispatch:a=>dispatcher.dispatch(a),recoverResult:a=>dispatcher.completedResult(a)});
 f.states.set('target',{status:'pending',failUpload:true});await assert.rejects(delivery.execute(action()),/interrupted/);
 Object.assign(f.states.get('target'),{status:'expired',failUpload:false});
 await delivery.execute({id:'stop',type:'action.cancel',payload:{deviceId:identity.deviceId,actionId:'target'}});
 const results=f.calls.filter(row=>row.url.endsWith('/result'));
 assert.deepEqual(results.map(row=>row.id),['target','target','stop']);
 assert.equal(results[2].body.result.stopConfirmed,true);assert.equal(results[2].body.result.targetReceipt.status,'failed');
 assert.equal(executions,1);
});

test('cancel without a controller or exit evidence records a verifiable unconfirmed outcome',async t=>{
 const f=fixture(t),dispatcher=new ActionDispatcher({workdir:f.root,execute:async()=>{throw new Error('must not run');}});
 const delivery=f.create({dispatch:a=>dispatcher.dispatch(a),recoverResult:a=>dispatcher.completedResult(a)});
 await delivery.execute({id:'stop',type:'action.cancel',payload:{deviceId:identity.deviceId,actionId:'unknown'}});
 const result=f.calls.find(row=>row.url.endsWith('/result')).body;
 assert.equal(result.status,'failed');assert.equal(result.result.stopConfirmed,false);
 assert.equal(result.result.cancellationRequested,false);assert.equal(result.result.targetReceipt.state,'unconfirmed');
 assert.equal(f.calls.some(row=>row.id==='unknown'),false);
});

test('an old client expired confirmation can recover from a bound dispatcher final after its delivery blobs were pruned',async t=>{
 const f=fixture(t),stateFile=path.join(f.root,'state.json');let executions=0;
 const dispatcher=new ActionDispatcher({workspace:identity.workspace,deviceId:identity.deviceId,workdir:f.root,stateFile,execute:async(_a,context)=>{
  executions++;context.onSupervision({completionEvidence:Promise.resolve(exit),stop:async()=>exit});return definitive;
 }});
 f.states.set('target',{status:'pending',failUpload:true});
 await assert.rejects(f.create({dispatch:a=>dispatcher.dispatch(a)}).execute(action()),/interrupted/);
 const directory=path.join(f.root,'delivery'),metadata=fs.readdirSync(directory).find(name=>/^[a-f0-9]{64}\.json$/.test(name));
 const record=JSON.parse(fs.readFileSync(path.join(directory,metadata)));
 Object.assign(record,{state:'confirmed',serverStatus:'expired',confirmedAt:new Date().toISOString(),events:[]});
 delete record.actionDigest;delete record.resultDigest;
 fs.writeFileSync(path.join(directory,metadata),JSON.stringify(record));
 for(const name of fs.readdirSync(directory).filter(name=>/\.(action|result)\.json$/.test(name)))fs.unlinkSync(path.join(directory,name));
 Object.assign(f.states.get('target'),{status:'expired',failUpload:false});
 const restarted=new ActionDispatcher({workspace:identity.workspace,deviceId:identity.deviceId,workdir:f.root,stateFile,execute:async()=>{throw new Error('must not reexecute');}});
 const delivery=f.create({dispatch:async()=>{throw new Error('must not dispatch');},recoverResult:a=>restarted.completedResult(a)});
 const actions=delivery.recoverActions();assert.equal(actions.length,1);
 assert.deepEqual(await delivery.execute(actions[0]),{state:'confirmed',status:'failed'});assert.equal(executions,1);
});

test('a restart redelivers a late durable final even when its first recovery notification was unavailable',async t=>{
 const f=fixture(t),stopped=deferred(),stateFile=path.join(f.root,'state.json');
 const dispatcher=new ActionDispatcher({workspace:identity.workspace,deviceId:identity.deviceId,workdir:f.root,stateFile,stopGraceMs:10,execute:async(_a,context)=>{
  context.onSupervision({completionEvidence:stopped.promise,stop:()=>stopped.promise});
  await new Promise(resolve=>context.signal.addEventListener('abort',resolve,{once:true}));return {};
 }});
 await f.create({dispatch:a=>dispatcher.dispatch(a)}).execute({...action(),payload:{...action().payload,idleTimeoutMs:100}});
 stopped.resolve(exit);for(let i=0;i<50&&dispatcher.quarantined;i++)await delay(5);
 assert.equal(dispatcher.quarantined,false);
 const restarted=new ActionDispatcher({workspace:identity.workspace,deviceId:identity.deviceId,workdir:f.root,stateFile,execute:async()=>{throw new Error('must not run');}});
 const delivery=f.create({dispatch:async()=>{throw new Error('must not dispatch');},recoverResult:a=>restarted.completedResult(a)});
 const actions=delivery.recoverActions();assert.equal(actions.length,1);
 assert.deepEqual(await delivery.execute(actions[0]),{state:'confirmed',status:'failed'});
 assert.equal(f.calls.filter(row=>row.url.endsWith('/result')).length,2);
});
