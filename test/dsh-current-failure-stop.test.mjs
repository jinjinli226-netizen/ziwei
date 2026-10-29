import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {executeDshRuntime} from '../src/dsh-runtime.mjs';
import {createDshSessionEvidence} from '../src/dsh-session-evidence.mjs';
import {ActionDispatcher} from '../src/daemon.mjs';
import {dshFixture} from './fixtures/dsh-protocol.mjs';

for(const failure of ['stream-error','invalid-frame','session-error','output-callback-error']){
  test(`DSH ${failure} immediately cancels only its matched session and retains the real terminal`,async t=>{
    let cancelObservedAtFailure=false;
    const f=await dshFixture(t,{onPrompt:({request,turn,event,connections})=>{
      const ws=connections.at(-1);
      if(failure==='stream-error')ws.deliver({type:'error',streamId:ws.followId,error:{message:'subscription failed'}});
      if(failure==='invalid-frame')ws.emit('message','invalid JSON');
      if(failure==='session-error')ws.deliver({type:'item',streamId:ws.eventsId,value:{type:'emit',event:'api-session/error',args:[request.sessionId,'session failed']}});
      if(failure==='output-callback-error')event(request.sessionId,'assistant/message',{turn,step:0,message:{content:[{type:'text',text:'partial'}]}});
      cancelObservedAtFailure=f.calls.filter(call=>call.method==='session/cancel').length===1;
    }});
    const result=await executeDshRuntime({baseUrl:f.baseUrl,...f.transport,botName:'owned-bot',prompt:'fixture',cancellationTimeoutMs:100,onOutput:failure==='output-callback-error'?()=>{throw Error('output adapter failed');}:undefined});
    assert.equal(result.status,'failed');assert.equal(result.sessionExit?.reason,'aborted');
    assert.equal(f.calls.filter(c=>c.method==='session/cancel').length,1);assert.equal(f.calls.find(c=>c.method==='session/cancel').payload.args.request.sessionId,result.sessionId);
    assert.equal(f.calls.filter(c=>c.method==='session/prompt').length,1);assert.equal(cancelObservedAtFailure,true);
  });
}

test('DSH failure with cancel ACK only never fabricates a confirmed stopped turn',async t=>{
  const f=await dshFixture(t,{cancelAckOnly:true,onPrompt:({connections})=>{const ws=connections.at(-1);ws.deliver({type:'error',streamId:ws.followId,error:{message:'subscription failed'}});}});
  const result=await executeDshRuntime({baseUrl:f.baseUrl,...f.transport,botName:'owned-bot',prompt:'fixture',cancellationTimeoutMs:30});
  assert.equal(result.code,'EXECUTION_UNCERTAIN');assert.equal(result.sessionExit,undefined);assert.equal(f.calls.filter(c=>c.method==='session/cancel').length,1);
});

test('DSH prompt transport failure immediately cancels an already echoed native request',async t=>{
  const f=await dshFixture(t,{hold:true});
  const fetchImpl=async(url,options)=>{
    const response=await f.transport.fetchImpl(url,options);
    if(url.endsWith('/session/prompt')){await new Promise(resolve=>setImmediate(resolve));throw Error('prompt transport interrupted');}
    return response;
  };
  const result=await executeDshRuntime({baseUrl:f.baseUrl,...f.transport,fetchImpl,botName:'owned-bot',prompt:'fixture',cancellationTimeoutMs:100});
  assert.equal(result.code,'prompt_failed');assert.equal(result.sessionExit.reason,'aborted');assert.equal(f.calls.filter(c=>c.method==='session/cancel').length,1);
});

test('DSH native error and token limit already ended the turn and never cancel a shared Bot',async t=>{
  for(const reason of [{kind:'error',error:{message:'model failed'}},{kind:'max-tokens'}]){
    const f=await dshFixture(t,{onPrompt:({request,complete})=>complete(request,{reason})});
    const result=await executeDshRuntime({baseUrl:f.baseUrl,...f.transport,botName:'owned-bot',prompt:'fixture'});
    assert.equal(result.status,'failed');assert.equal(result.sessionExit.reason,reason.kind);assert.equal(f.calls.filter(c=>c.method==='session/cancel').length,0);
  }
});

test('DSH dispatcher immediately requests its owned session stop when its executor throws',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-dsh-failure-stop-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  let stops=0;
  const action={id:'dsh-adapter-failed',type:'conversation.execute',payload:{runtime:'DSH',profile:'owned-bot',employeeId:'employee',conversationId:'conversation',prompt:'fixture'}};
  const dispatcher=new ActionDispatcher({workdir:directory,stopGraceMs:100,execute:async(a,context)=>{
    const evidence=createDshSessionEvidence({actionId:a.id,employeeId:'employee',conversationId:'conversation',botName:'owned-bot',sessionId:'owned-session',requestId:'request-owned'},async()=>{stops++;evidence.finishTurn(2,'aborted');});
    evidence.acceptRequest(2);context.onDshSessionSupervision(evidence.capability);throw Error('owned adapter failed');
  }});
  const result=await dispatcher.dispatch(action);
  assert.equal(stops,1);assert.equal(result.status,'failed');assert.equal(result.code,'executor_failed');assert.equal(result.result.sessionExit.reason,'aborted');assert.equal(dispatcher.quarantined,false);assert.equal(result.result.processExit,undefined);
});

test('DSH explicit idle budget immediately cancels its echoed native turn',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-dsh-idle-stop-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const f=await dshFixture(t,{hold:true});
  const action={id:'dsh-idle-stop',type:'conversation.execute',payload:{runtime:'DSH',profile:'owned-bot',employeeId:'employee',conversationId:'conversation',prompt:'fixture',idleTimeoutMs:100}};
  const dispatcher=new ActionDispatcher({workdir:directory,stopGraceMs:500,execute:(a,c)=>executeDshRuntime({baseUrl:f.baseUrl,...f.transport,botName:'owned-bot',prompt:'fixture',signal:c.signal,onSessionSupervision:c.onDshSessionSupervision,sessionAuthority:{actionId:a.id,employeeId:'employee',conversationId:'conversation'}})});
  const result=await dispatcher.dispatch(action);
  assert.equal(result.code,'action_timeout');assert.equal(result.result.sessionExit.reason,'aborted');assert.equal(f.calls.filter(c=>c.method==='session/cancel').length,1);assert.equal(dispatcher.quarantined,false);
});
