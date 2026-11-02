import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as deadline,clearTimeout as clearDeadline} from 'node:timers';
import {createActionDelivery} from '../src/daemon-action-delivery.mjs';
import {markMaintenancePaused} from '../src/maintenance-checkpoint.mjs';
import {executionBinding} from '../src/execution-admission.mjs';
import {inspectLocalDaemonMaintenanceFiles} from '../backend/preservation-native-evidence.mjs';
import {createActionScheduler} from '../src/daemon-action-scheduler.mjs';
import {confirmedDshSessionExit} from '../src/dsh-session-receipt.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{resolve,promise};};
const identity={apiBase:'https://stream.invalid',workspace:'stream-fixture',deviceId:'stream-device'};
const action={id:'response-action',type:'conversation.execute',workspace_id:'workspace-fixture',payload:{employeeId:'employee-fixture',conversationId:'conversation-fixture',deviceId:identity.deviceId}};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function withoutProgress(promise){
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=deadline(()=>reject(new Error('terminal delivery waited for disposable progress')),300);})]);}
  finally{clearDeadline(timer);}
}
function fixture(t,{holdResponse=false,holdEventTypes=[],postPatch,dispatchResult={status:'succeeded',result:{output:'最终正文'}},retryDelays=[]}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-response-delivery-'));
  const directory=path.join(root,'action-delivery'),ready=deferred(),done=deferred(),held=deferred(),calls=[],reports=[];
  const metadata=path.join(directory,createHash('sha256').update(JSON.stringify(action.id)).digest('hex')+'.json');
  const post=async(url,body)=>{
    const call={url,body,encoded:JSON.stringify(body)};calls.push(call);
    if(postPatch){const patched=await postPatch(url,body);if(patched)return patched;}
    const id=decodeURIComponent(url.split('/')[4]);
    if(url.endsWith('/ack'))return{id,status:'acked',expires_at:new Date(Date.now()+16*60*1000).toISOString(),deviceId:identity.deviceId};
    if(url.endsWith('/events')){if(holdResponse&&body.type==='action.response'||holdEventTypes.includes(body.type))await held.promise;return{id:body.eventId};}
    return{id,status:body.status,deviceId:identity.deviceId};
  };
  const dispatches=[];
  const options={directory,identity,post,retryDelays,onEvent:(...args)=>reports.push(args),dispatch:async value=>{dispatches.push(value.id);ready.resolve();await done.promise;return dispatchResult;}};
  const engine=createActionDelivery(options);let running;
  t.after(async()=>{held.resolve();done.resolve();await Promise.allSettled([running]);await engine.whenIdle();fs.rmSync(root,{recursive:true,force:true});});
  return{root,directory,options,engine,calls,reports,metadata,ready,done,held,dispatches,start(value=action){running=engine.execute(value);return running;},journal:()=>JSON.parse(fs.readFileSync(metadata,'utf8')),responses:()=>calls.filter(call=>call.body.type==='action.response')};
}

test('the first structured response is immediately durable and posted with the exact public snapshot contract',async t=>{
  const f=fixture(t,{holdResponse:true});const running=f.start();await f.ready.promise;
  assert.equal(f.engine.recordEvent(action.id,'action.response',{text:'真实第一段',stdout:'PRIVATE',message:'正在生成回答'}),true);
  assert.equal(f.responses().length,1);
  assert.deepEqual(f.responses()[0].body.data,{schemaVersion:1,responseId:`${action.id}:assistant`,sequence:1,phase:'streaming',text:'真实第一段',format:'markdown'});
  assert.equal(f.journal().responseSequence,1);
  assert.equal(f.journal().events[0].data.text,'真实第一段');
  assert.equal(f.engine.recordEvent(action.id,'action.response',{stdout:'PRIVATE'}),false);
  f.held.resolve();f.done.resolve();await running;
});

test('one thousand backpressured updates coalesce to the latest pending response while the in-flight event stays immutable',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture(t,{holdResponse:true});const running=f.start();await f.ready.promise;
  f.engine.recordEvent(action.id,'action.response',{text:'first'});
  const first=f.responses()[0];let writes=0;const write=fs.writeFileSync;
  t.mock.method(fs,'writeFileSync',(...args)=>{writes++;return write(...args);});
  for(let index=1;index<=1000;index++)assert.equal(f.engine.recordEvent(action.id,'action.response',{text:`latest-${index}`}),true);
  assert.ok(writes<=1,`response updates wrote ${writes} journals before the batch interval`);
  t.mock.timers.tick(100);await tick();
  const queued=f.journal().events.filter(event=>event.type==='action.response');
  assert.equal(queued.length,2);assert.equal(queued.at(-1).data.text,'latest-1000');
  assert.equal(JSON.stringify(first.body),first.encoded);assert.equal(f.responses().length,1);
  f.held.resolve();await f.engine.flushActionEvents(action.id);
  assert.deepEqual(f.responses().map(call=>call.body.data.text),['first','latest-1000']);
  assert.notEqual(f.responses()[0].body.eventId,f.responses()[1].body.eventId);
  f.done.resolve();await running;
});

test('the newest response can replace queued progress at the 256-event cap',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const hold=deferred();let first=true;
  t.after(()=>hold.resolve());
  const f=fixture(t,{postPatch:async(url)=>{if(url.endsWith('/events')&&first){first=false;await hold.promise;}return null;}});
  const running=f.start();await f.ready.promise;
  f.engine.recordEvent(action.id,'action.stage',{message:'first tool',stage:'tool'});
  for(let index=1;index<256;index++)f.engine.recordEvent(action.id,'action.stage',{message:`tool-${index}`,stage:'tool'});
  assert.equal(f.engine.recordEvent(action.id,'action.response',{text:'latest answer'}),true);
  assert.ok(f.journal().events.length<=256);assert.equal(f.journal().events.at(-1).data.text,'latest answer');
  hold.resolve();await f.engine.flushActionEvents(action.id);f.done.resolve();await running;
});

test('response text bypasses the 128KiB artifact envelope and respects the 1MiB UTF-8 boundary',async t=>{
  const f=fixture(t);const running=f.start();await f.ready.promise;
  const long='a'.repeat(1024*1024-1)+'😀尾部';
  f.engine.recordEvent(action.id,'action.response',{text:long});await f.engine.flushActionEvents(action.id);
  const text=f.responses()[0].body.data.text;
  assert.equal(Buffer.byteLength(text),1024*1024-1);assert.equal(text,'a'.repeat(1024*1024-1));assert.ok(!text.includes('\uFFFD'));
  f.done.resolve();await running;
});

test('a restarted delivery continues its durable sequence without reusing an acknowledged snapshot id',async t=>{
  const f=fixture(t);const running=f.start();await f.ready.promise;
  f.engine.recordEvent(action.id,'action.response',{text:'before restart'});await f.engine.flushActionEvents(action.id);
  const prior=f.journal().responseSequence;
  const restarted=createActionDelivery({...f.options,dispatch:async()=>{throw new Error('no model launch');}});
  restarted.recoverActions();assert.equal(restarted.recordEvent(action.id,'action.response',{text:'after restart'}),true);
  await restarted.flushActionEvents(action.id);
  assert.ok(f.responses().at(-1).body.data.sequence>prior);assert.equal(f.responses().at(-1).body.data.text,'after restart');
  f.done.resolve();await running;
});

test('terminal result flushes the last buffer and settles without waiting for a held progress POST or leaving a timer',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture(t,{holdResponse:true});const running=f.start();await f.ready.promise;
  f.engine.recordEvent(action.id,'action.response',{text:'first'});f.engine.recordEvent(action.id,'action.response',{text:'last buffer'});
  f.done.resolve();let timer;
  try{await Promise.race([running,new Promise((_,reject)=>{timer=deadline(()=>reject(new Error('terminal result blocked by response delivery')),300);})]);}finally{clearDeadline(timer);}
  assert.equal(f.journal().state,'confirmed');assert.equal(f.journal().responseSequence,undefined);assert.deepEqual(f.journal().events,[]);
  assert.equal(f.calls.filter(call=>call.url.endsWith('/result')).length,1);
  t.mock.timers.tick(1000);f.held.resolve();await tick();
  assert.equal(f.responses().length,1);assert.equal(f.journal().state,'confirmed');
});

for(const type of ['action.output','action.progress','action.stage'])test(`a full queue behind held ${type} cannot delay the durable result or retain retired progress`,async t=>{
  const f=fixture(t,{holdEventTypes:[type]});const running=f.start();await f.ready.promise;
  f.engine.recordEvent(action.id,type,{message:'held',stage:'tool'});
  const first=f.calls.find(call=>call.url.endsWith('/events'));
  for(let index=1;index<256;index++)f.engine.recordEvent(action.id,'action.output',{message:`queued-${index}`});
  assert.equal(f.journal().events.length,256);
  f.done.resolve();await withoutProgress(running);
  assert.equal(f.journal().state,'confirmed');assert.deepEqual(f.journal().events,[]);
  assert.equal(f.calls.filter(call=>call.url.endsWith('/result')).length,1);
  assert.equal(f.calls.find(call=>call.url.endsWith('/result')).body.result.output,'最终正文');
  assert.equal(JSON.stringify(first.body),first.encoded);
  await withoutProgress(f.engine.whenIdle());
  f.held.resolve();await tick();
  assert.equal(f.calls.filter(call=>call.url.endsWith('/events')).length,1);
  assert.equal(f.journal().state,'confirmed');
});

test('a completed scheduler slot admits the next employee action while an obsolete progress POST is still held',async t=>{
  const f=fixture(t,{holdEventTypes:['action.output']});
  const scheduler=createActionScheduler({concurrency:1,execute:value=>f.engine.execute(value)});
  scheduler.schedule([action]);await f.ready.promise;
  f.engine.recordEvent(action.id,'action.output',{message:'held'});f.done.resolve();
  await withoutProgress(scheduler.whenIdle());
  const next={...action,id:'next-response-action'};
  assert.deepEqual(scheduler.schedule([next]),[next.id]);await withoutProgress(scheduler.whenIdle());
  assert.deepEqual(f.dispatches,[action.id,next.id]);
  assert.equal(f.calls.filter(call=>call.url.endsWith('/result')).length,2);
});

test('a lost result receipt retains its exact durable blob and retries only delivery despite held progress',async t=>{
  let lose=true;
  const f=fixture(t,{holdEventTypes:['action.output'],postPatch:async url=>{if(url.endsWith('/result')&&lose){lose=false;throw new Error('result receipt lost');}}});
  const running=f.start();await f.ready.promise;
  f.engine.recordEvent(action.id,'action.output',{message:'held'});f.done.resolve();
  await assert.rejects(withoutProgress(running),/result receipt lost/);
  assert.equal(f.journal().state,'result_pending');
  const blob=fs.readFileSync(f.metadata.replace(/\.json$/,'.result.json'),'utf8');
  assert.equal(JSON.parse(blob).result.output,'最终正文');
  await withoutProgress(f.engine.execute(action));
  assert.deepEqual(f.dispatches,[action.id]);
  const uploads=f.calls.filter(call=>call.url.endsWith('/result'));
  assert.equal(uploads.length,2);assert.equal(uploads[0].encoded,uploads[1].encoded);assert.equal(uploads[0].encoded,blob);
  assert.equal(f.journal().state,'confirmed');
});

test('a late failed progress receipt cannot restart stale retries after result confirmation',async t=>{
  const f=fixture(t,{retryDelays:[0,0],postPatch:async(url,body)=>{if(url.endsWith('/events')&&body.type==='action.output'){await f.held.promise;throw Object.assign(new Error('late progress unavailable'),{status:503});}}});
  const running=f.start();await f.ready.promise;
  f.engine.recordEvent(action.id,'action.output',{message:'held'});f.done.resolve();await withoutProgress(running);
  f.held.resolve();await new Promise(resolve=>deadline(resolve,20));
  assert.equal(f.calls.filter(call=>call.url.endsWith('/events')).length,1);
  assert.equal(f.journal().state,'confirmed');assert.deepEqual(f.journal().events,[]);
});

test('a full progress queue still durably registers the exact DSH binding before its result',async t=>{
  const nativeAction={...action,payload:{...action.payload,runtime:'DSH',profile:'fixture-bot'}};
  const binding={actionId:action.id,employeeId:action.payload.employeeId,conversationId:action.payload.conversationId,botName:'fixture-bot',sessionId:'native-session',requestId:'native-request'};
  const result={status:'succeeded',result:{sessionId:binding.sessionId,sessionExit:{...binding,schemaVersion:1,source:'dsh-native-session',terminalConfirmed:true,turn:1,reason:'completed'}}};
  let registered;
  const f=fixture(t,{holdEventTypes:['action.output'],dispatchResult:result,postPatch:async(url,body)=>{
    if(url.endsWith('/events')&&body.data?.progress?.dshSessionBinding){assert.deepEqual(f.journal().dshSessionBinding,binding);registered=body.data.progress.dshSessionBinding;}
    if(url.endsWith('/result'))assert.ok(confirmedDshSessionExit({...nativeAction,payload:{...nativeAction.payload,dshSessionBinding:registered}},body));
  }});
  const running=f.start(nativeAction);await f.ready.promise;
  for(let index=0;index<256;index++)f.engine.recordEvent(action.id,'action.output',{message:`queued-${index}`});
  assert.equal(f.engine.recordEvent(action.id,'action.stage',{stage:'session',progress:{phase:'stage',dshSessionBinding:binding}}),true);
  assert.equal(f.engine.recordEvent(action.id,'action.response',{text:'latest DSH answer'}),true);
  assert.ok(f.journal().events.some(event=>event.data?.progress?.dshSessionBinding));
  f.done.resolve();await withoutProgress(running);
  assert.deepEqual(registered,binding);assert.equal(f.journal().state,'confirmed');
});

test('a refused required DSH binding keeps the result pending and retries its original event without reexecution',async t=>{
  const nativeAction={...action,payload:{...action.payload,runtime:'DSH',profile:'fixture-bot'}};
  const binding={actionId:action.id,employeeId:action.payload.employeeId,conversationId:action.payload.conversationId,botName:'fixture-bot',sessionId:'native-session',requestId:'native-request'};
  let refuse=true;
  const f=fixture(t,{holdEventTypes:['action.output'],postPatch:async(url,body)=>{if(url.endsWith('/events')&&body.data?.progress?.dshSessionBinding&&refuse)throw Object.assign(new Error('required binding unavailable'),{status:503});}});
  const running=f.start(nativeAction);await f.ready.promise;
  f.engine.recordEvent(action.id,'action.output',{message:'held'});
  f.engine.recordEvent(action.id,'action.stage',{stage:'session',progress:{phase:'stage',dshSessionBinding:binding}});
  f.done.resolve();await assert.rejects(withoutProgress(running),/required binding unavailable/);
  assert.equal(f.journal().state,'result_pending');assert.equal(f.calls.some(call=>call.url.endsWith('/result')),false);
  const queued=f.journal().events.find(event=>event.data?.progress?.dshSessionBinding);
  assert.ok(queued);refuse=false;
  await withoutProgress(f.engine.execute(nativeAction));assert.deepEqual(f.dispatches,[action.id]);
  const bindings=f.calls.filter(call=>call.body.data?.progress?.dshSessionBinding);
  assert.equal(bindings.length,2);assert.equal(bindings[0].encoded,bindings[1].encoded);assert.equal(bindings[0].body.eventId,queued.eventId);
});

test('an unsupported required binding endpoint cannot be skipped as optional progress',async t=>{
  const nativeAction={...action,payload:{...action.payload,runtime:'DSH',profile:'fixture-bot'}};
  const binding={actionId:action.id,employeeId:action.payload.employeeId,conversationId:action.payload.conversationId,botName:'fixture-bot',sessionId:'native-session',requestId:'native-request'};
  const f=fixture(t,{holdEventTypes:['action.output'],postPatch:async(url,body)=>{if(url.endsWith('/events')&&body.data?.progress?.dshSessionBinding)throw Object.assign(new Error('required endpoint missing'),{status:404});}});
  const running=f.start(nativeAction);await f.ready.promise;
  f.engine.recordEvent(action.id,'action.output',{message:'held'});
  f.engine.recordEvent(action.id,'action.stage',{stage:'session',progress:{phase:'stage',dshSessionBinding:binding}});
  f.done.resolve();await assert.rejects(withoutProgress(running),/required endpoint missing/);
  assert.equal(f.journal().state,'blocked');assert.ok(f.journal().resultDigest);
  assert.ok(f.journal().events.some(event=>event.data?.progress?.dshSessionBinding));
  assert.equal(f.calls.some(call=>call.url.endsWith('/result')),false);
});

test('an in-flight DSH binding remains a required pre-result receipt',async t=>{
  const nativeAction={...action,payload:{...action.payload,runtime:'DSH',profile:'fixture-bot'}};
  const binding={actionId:action.id,employeeId:action.payload.employeeId,conversationId:action.payload.conversationId,botName:'fixture-bot',sessionId:'native-session',requestId:'native-request'};
  const f=fixture(t,{holdEventTypes:['action.stage']});const running=f.start(nativeAction);await f.ready.promise;
  f.engine.recordEvent(action.id,'action.stage',{stage:'session',progress:{phase:'stage',dshSessionBinding:binding}});
  f.done.resolve();await tick();
  assert.equal(f.journal().state,'result_pending');assert.equal(f.calls.some(call=>call.url.endsWith('/result')),false);
  f.held.resolve();await withoutProgress(running);assert.equal(f.journal().state,'confirmed');
});

test('response sequence survives a drained native maintenance pause and remains compatible with the maintenance evidence reader',async t=>{
  const f=fixture(t),pausedAction={...action,payload:{...action.payload,runtime:'Hermes',profile:'default',cwd:f.root}};
  const receipt={schemaVersion:1,actionId:action.id,executionBinding:executionBinding(pausedAction),updateId:'update-fixture',targetBuild:'a'.repeat(64),runtime:'Hermes',profile:'default',home:f.root,cwd:f.root,sessionId:'session-fixture',checkpointDigest:'b'.repeat(64),messageCount:2,pendingTools:0,processExit:{platform:'linux',supervisor:'direct',launched:true,rootPid:42,rootConfirmed:true,rootExitCode:0,treeConfirmed:true,activeProcesses:0,cancelled:false}};
  let engine;
  engine=createActionDelivery({...f.options,dispatch:async()=>{
    engine.recordEvent(action.id,'action.response',{text:'before pause'});engine.recordEvent(action.id,'action.response',{text:'last paused snapshot'});
    return markMaintenancePaused({status:'maintenance_paused'},receipt);
  }});
  assert.equal((await engine.execute(pausedAction)).state,'maintenance_paused');
  assert.deepEqual(f.journal().events,[]);assert.equal(f.journal().responseSequence,2);
  fs.writeFileSync(path.join(f.root,'action-state.json'),JSON.stringify({version:2,completed:[],started:[{key:action.id,actionId:action.id,identity:{workspace:identity.workspace,deviceId:identity.deviceId,workspaceId:action.workspace_id,targetDeviceId:identity.deviceId},startedAt:1,hardDeadline:1000,nativeRuntime:true,resourceBinding:{type:action.type,employeeId:action.payload.employeeId,revision:null,controlEpoch:null,resource:null,operation:null,platform:null},maintenancePause:receipt}]}));
  const evidence=inspectLocalDaemonMaintenanceFiles({connections:[{...identity,runtimeDir:f.root}]});
  assert.equal(evidence.stopSafe,true,JSON.stringify(evidence.issues));assert.equal(evidence.maintenancePausedCount,1);
  const restarted=createActionDelivery({...f.options,dispatch:async()=>assert.fail('paused replay must not execute')});
  assert.deepEqual(restarted.recoverActions().map(value=>value.id),[action.id]);
  assert.deepEqual(restarted.getMaintenancePause(action.id),receipt);
  restarted.recordEvent(action.id,'action.response',{text:'after pause'});await restarted.flushActionEvents(action.id);
  assert.ok(f.responses().at(-1).body.data.sequence>2);
});
