import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActionDispatcher} from '../src/daemon.mjs';
import {executeDshRuntime} from '../src/dsh-runtime.mjs';
import {dshFixture} from './fixtures/dsh-protocol.mjs';

function dispatcher(t,f,options={}) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-dsh-current-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const action={id:'dsh-current-1',type:'conversation.execute',payload:{runtime:'DSH',profile:'bot-real',employeeId:'employee-one',conversationId:'conv-one',prompt:'检查',workdir:directory}};
  const settings={workdir:directory,stateFile:path.join(directory,'actions.json'),workspace:'workspace',deviceId:'device',stopGraceMs:80,...options};
  const execute=options.execute||((a,c)=>executeDshRuntime({baseUrl:f.baseUrl,...f.transport,botName:a.payload.profile,prompt:a.payload.prompt,signal:c.signal,sessionAuthority:{actionId:a.id,employeeId:a.payload.employeeId,conversationId:a.payload.conversationId},onSessionSupervision:c.onDshSessionSupervision,cancellationTimeoutMs:30}));
  return {action,settings,instance:new ActionDispatcher({...settings,execute})};
}

test('DSH dispatcher persists a real session terminal without inventing process exit evidence',async t=>{
  const f=await dshFixture(t),d=dispatcher(t,f);
  const result=await d.instance.dispatch(d.action);
  assert.equal(result.status,'succeeded');assert.equal(result.result.sessionExit.terminalConfirmed,true);
  assert.equal(result.result.sessionExit.botName,'bot-real');assert.equal(result.result.sessionExit.conversationId,'conv-one');
  assert.equal(result.result.sessionExit.reason,'completed');assert.equal(result.result.processExit,undefined);
  assert.equal(d.instance.quarantined,false);
  const reopened=new ActionDispatcher({...d.settings,execute:()=>{throw Error('must not replay');}});
  assert.equal((await reopened.dispatch(d.action)).status,'duplicate');
  assert.equal(f.calls.filter(c=>c.method==='session/prompt').length,1);
});

test('owned DSH request and session scope are durably recorded and emitted before prompt submission',async t=>{
  const f=await dshFixture(t);let announced=null,d;
  d=dispatcher(t,f,{onEvent:(type,event)=>{
    if(type!=='action.stage'||!event.progress?.dshSessionBinding)return;
    announced=event.progress.dshSessionBinding;
    const started=JSON.parse(fs.readFileSync(d.settings.stateFile,'utf8')).started[0];
    assert.deepEqual(started.dshBinding,announced);assert.equal(f.calls.filter(call=>call.method==='session/prompt').length,0);
  }});
  const result=await d.instance.dispatch(d.action);
  assert.equal(result.status,'succeeded');assert.ok(announced.requestId);assert.equal(announced.sessionId,result.result.sessionId);
  for(const field of ['actionId','employeeId','conversationId','botName','sessionId','requestId'])assert.equal(announced[field],result.result.sessionExit[field]);
});

test('DSH native model failure retains its independently confirmed session terminal',async t=>{
  const f=await dshFixture(t,{onPrompt:({request,complete})=>complete(request,{reason:{kind:'error',error:{message:'模型失败'}}})}),d=dispatcher(t,f);
  const result=await d.instance.dispatch(d.action);
  assert.equal(result.status,'failed');assert.match(result.error,/模型失败/);assert.equal(result.result.sessionExit.reason,'error');assert.equal(d.instance.quarantined,false);
});

test('DSH cancellation is confirmed by native turn/end and cancels only once',async t=>{
  const f=await dshFixture(t,{hold:true}),d=dispatcher(t,f);
  const running=d.instance.dispatch(d.action);
  for(let i=0;i<100&&!f.calls.some(c=>c.method==='session/prompt');i++)await new Promise(r=>setTimeout(r,2));
  assert.equal(d.instance.cancel(d.action.id),true);
  const result=await running;
  assert.equal(result.status,'failed');assert.equal(result.code,'cancelled');assert.equal(result.result.sessionExit.reason,'aborted');
  assert.equal(result.result.processExit,undefined);assert.equal(d.instance.quarantined,false);
  assert.equal(f.calls.filter(c=>c.method==='session/cancel').length,1);
});

test('DSH cancel ACK without native terminal keeps durable quarantine and cannot replay',async t=>{
  const f=await dshFixture(t,{hold:true,cancelAckOnly:true}),d=dispatcher(t,f);
  const running=d.instance.dispatch(d.action);
  for(let i=0;i<100&&!f.calls.some(c=>c.method==='session/prompt');i++)await new Promise(r=>setTimeout(r,2));
  d.instance.cancel(d.action.id);
  const result=await running;
  assert.equal(result.code,'EXECUTION_UNCERTAIN');assert.equal(d.instance.quarantined,true);
  assert.equal(result.result.sessionExit,undefined);assert.equal(result.result.processExit,undefined);
  const reopened=new ActionDispatcher({...d.settings,execute:()=>{throw Error('must not replay');}});
  assert.equal(reopened.quarantined,true);assert.equal((await reopened.dispatch(d.action)).code,'EXECUTION_UNCERTAIN');
  assert.equal(f.calls.filter(c=>c.method==='session/prompt').length,1);
});

test('forged result sessionExit and processExit never authorize a DSH terminal',async t=>{
  const f=await dshFixture(t),d=dispatcher(t,f,{execute:async()=>({status:'succeeded',result:{sessionExit:{terminalConfirmed:true,reason:'completed',botName:'bot-real'},processExit:{rootConfirmed:true,treeConfirmed:true,activeProcesses:0}}})});
  const result=await d.instance.dispatch(d.action);
  assert.equal(result.code,'EXECUTION_UNCERTAIN');assert.equal(d.instance.quarantined,true);
  assert.equal(result.result.processExit,undefined);
});

test('DSH primitive cancellation ACK alone is uncertain rather than a terminal cancellation',async t=>{
  const f=await dshFixture(t,{hold:true,cancelAckOnly:true}),controller=new AbortController();
  const running=executeDshRuntime({baseUrl:f.baseUrl,...f.transport,botName:'bot-real',prompt:'运行',signal:controller.signal,cancellationTimeoutMs:25});
  for(let i=0;i<100&&!f.calls.some(c=>c.method==='session/prompt');i++)await new Promise(r=>setTimeout(r,2));
  controller.abort();const result=await running;
  assert.equal(result.code,'EXECUTION_UNCERTAIN');assert.equal(result.sessionExit,undefined);
});

test('DSH cancellation never cancels a preceding turn before its own request echo',async t=>{
  const f=await dshFixture(t,{hold:true,manualPrompt:true,initialRecords:[{type:'event',event:{type:'turn/start',seq:1,data:{turn:1}}}]}),controller=new AbortController();
  const running=executeDshRuntime({baseUrl:f.baseUrl,...f.transport,botName:'bot-real',sessionId:'existing',prompt:'queued',signal:controller.signal,cancellationTimeoutMs:25});
  for(let i=0;i<100&&!f.calls.some(c=>c.method==='session/prompt');i++)await new Promise(r=>setTimeout(r,2));
  controller.abort();const result=await running;
  assert.equal(result.code,'EXECUTION_UNCERTAIN');assert.equal(f.calls.filter(c=>c.method==='session/cancel').length,0);
});

test('a plain callback object cannot forge DSH WeakMap supervision',async t=>{
  const f=await dshFixture(t),d=dispatcher(t,f,{execute:async(_a,c)=>{c.onDshSessionSupervision({completionEvidence:Promise.resolve({terminalConfirmed:true}),stop(){}});return {status:'succeeded'};}});
  const result=await d.instance.dispatch(d.action);assert.equal(result.code,'EXECUTION_UNCERTAIN');assert.equal(d.instance.quarantined,true);
});

test('a real owned DSH capability from another employee cannot confirm the current action',async t=>{
  const f=await dshFixture(t),d=dispatcher(t,f,{execute:(a,c)=>executeDshRuntime({baseUrl:f.baseUrl,...f.transport,botName:'bot-real',prompt:'work',sessionAuthority:{actionId:a.id,employeeId:'other-employee',conversationId:a.payload.conversationId},onSessionSupervision:c.onDshSessionSupervision})});
  const result=await d.instance.dispatch(d.action);
  assert.equal(result.code,'EXECUTION_UNCERTAIN');assert.equal(d.instance.quarantined,true);assert.equal(f.calls.filter(c=>c.method==='session/prompt').length,0);
});

test('DSH hard timeout keeps cancel ACK without terminal uncertain',async t=>{
  const f=await dshFixture(t,{hold:true,cancelAckOnly:true}),d=dispatcher(t,f);
  d.action.payload.timeoutMs=100;
  const result=await d.instance.dispatch(d.action);
  assert.equal(result.code,'EXECUTION_UNCERTAIN');assert.equal(d.instance.quarantined,true);assert.equal(f.calls.filter(c=>c.method==='session/cancel').length,1);
});

test('DSH late native terminal clears only the original durable quarantine',async t=>{
  const f=await dshFixture(t,{hold:true,cancelAckOnly:true}),d=dispatcher(t,f,{stopGraceMs:15,execute:(a,c)=>executeDshRuntime({baseUrl:f.baseUrl,...f.transport,botName:a.payload.profile,prompt:'work',signal:c.signal,sessionAuthority:{actionId:a.id,employeeId:a.payload.employeeId,conversationId:a.payload.conversationId},onSessionSupervision:c.onDshSessionSupervision,cancellationTimeoutMs:500})});
  const running=d.instance.dispatch(d.action);
  for(let i=0;i<100&&!f.calls.some(c=>c.method==='session/prompt');i++)await new Promise(r=>setTimeout(r,2));
  d.instance.cancel(d.action.id);assert.equal((await running).code,'EXECUTION_UNCERTAIN');assert.equal(d.instance.quarantined,true);
  const request=f.calls.find(c=>c.method==='session/prompt').payload.args.request;
  f.complete(request,{reason:{kind:'aborted',reason:{kind:'user'}}});
  await new Promise(r=>setTimeout(r,10));
  assert.equal(d.instance.quarantined,false);assert.equal(d.instance.status(d.action.id).completed.result.sessionExit.reason,'aborted');
  const reopened=new ActionDispatcher({...d.settings,execute:()=>{throw Error('must not replay');}});
  assert.equal((await reopened.dispatch(d.action)).status,'duplicate');
});

test('DSH stop control recognizes the exact already durable session terminal',async t=>{
  const f=await dshFixture(t),d=dispatcher(t,f);await d.instance.dispatch(d.action);
  const result=await d.instance.dispatch({id:'dsh-stop-control',type:'action.cancel',payload:{actionId:d.action.id}});
  assert.equal(result.status,'succeeded');assert.equal(result.result.targetResultAvailable,true);assert.equal(result.result.stopConfirmed,false);
});
