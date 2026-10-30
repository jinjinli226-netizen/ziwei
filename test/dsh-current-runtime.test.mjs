import test from 'node:test';
import assert from 'node:assert/strict';
import { executeDshRuntime,listDshSessions } from '../src/dsh-runtime.mjs';
import { dshFixture } from './fixtures/dsh-protocol.mjs';

test('DSH uses native method URLs, value frames, tool events, streaming text and durable turn completion',{timeout:4000},async t=>{
  const f=await dshFixture(t);const stages=[];const output=[];
  const result=await executeDshRuntime({baseUrl:f.baseUrl,...f.transport,botName:'research-bot',prompt:'检查状态',onStage:s=>stages.push(s),onOutput:c=>output.push(c)});
  assert.equal(result.status,'succeeded');assert.equal(result.output,'DSH 完成');assert.equal(result.sessionId,'research-bot-session-1');
  assert.ok(stages.some(s=>s.stage==='reasoning' && s.summary==='先读取状态'));
  assert.ok(stages.some(s=>s.stage==='tool' && s.detail.includes('read')));
  assert.equal(output.join(''),'DSH 完成');assert.ok(f.calls.some(c=>c.path.endsWith('/api/session/prompt')));
});
test('DSH list and resume retain the selected bot and exclude old session history',{timeout:4000},async t=>{
  const old=[{type:'event',event:{type:'turn/start',seq:1,time:1,data:{turn:1}}},{type:'event',event:{type:'assistant/message',seq:2,time:2,data:{turn:1,step:0,message:{content:[{type:'text',text:'旧回复'}]}}}},{type:'event',event:{type:'turn/end',seq:3,time:3,data:{turn:1,reason:{kind:'completed'}}}}];
  const f=await dshFixture(t,{initialRecords:old});const listing=await listDshSessions({baseUrl:f.baseUrl,...f.transport,botName:'research-bot'});assert.equal(listing.items[0].sessionId,'dsh-session-1');
  const result=await executeDshRuntime({baseUrl:f.baseUrl,...f.transport,botName:'research-bot',sessionId:'existing-session',prompt:'继续'});
  assert.equal(result.status,'succeeded');assert.equal(result.sessionId,'existing-session');assert.equal(result.output,'DSH 完成');
  assert.equal(f.calls.some(c=>c.method==='session/create'),false);assert.ok(f.calls.every(c=>c.bot==='research-bot'));
  assert.deepEqual(f.calls.find(c=>c.method==='session/list').payload.args,{_request:{}});
});
test('DSH native turn errors are failed results with readable structured error text',{timeout:4000},async t=>{
  const f=await dshFixture(t,{onPrompt:({request,complete})=>complete(request,{reply:'部分结果',reason:{kind:'error',error:{code:'MODEL_FAILED',message:'模型服务不可用'}}})});
  const result=await executeDshRuntime({baseUrl:f.baseUrl,...f.transport,botName:'research-bot',prompt:'检查'});
  assert.equal(result.status,'failed');assert.match(result.error,/模型服务不可用/);assert.equal(result.output,'部分结果');
});
test('DSH cancellation uses native cancel RPC and returns a cancelled terminal result',{timeout:4000},async t=>{
  const f=await dshFixture(t,{hold:true});const controller=new AbortController();
  const running=executeDshRuntime({baseUrl:f.baseUrl,...f.transport,botName:'research-bot',prompt:'长任务',signal:controller.signal});
  for(let attempt=0;attempt<100&&!f.calls.some(c=>c.method==='session/prompt');attempt++)await new Promise(r=>setTimeout(r,5));controller.abort();
  const result=await running;assert.equal(result.status,'failed');assert.equal(result.code,'cancelled');assert.ok(f.calls.some(c=>c.path.endsWith('/session/cancel')));
});
test('DSH remote user cancellation and max-token termination do not claim success',{timeout:4000},async t=>{
  for(const reason of [{kind:'aborted',reason:{kind:'user'}},{kind:'max-tokens'}]){
    const f=await dshFixture(t,{onPrompt:({request,complete})=>complete(request,{reply:'未完成',reason})});
    const result=await executeDshRuntime({baseUrl:f.baseUrl,...f.transport,botName:'research-bot',prompt:'工作'});
    assert.equal(result.status,'failed');assert.equal(result.code,reason.kind==='aborted'?'cancelled':'max_tokens');
  }
});
test('DSH disconnect cancels the current turn then follows its terminal without resubmitting or replaying output',{timeout:5000},async t=>{
  let request;let completed=false;
  const f=await dshFixture(t,{onPrompt:ctx=>{request=ctx.request;ctx.event(request.sessionId,'assistant/message',{turn:ctx.turn,step:0,message:{content:[{type:'text',text:'第一步'}]}});ctx.connections.at(-1).close();},onFollow:ctx=>{if(ctx.connections.length>1&&!completed){completed=true;setImmediate(()=>ctx.event(request.sessionId,'turn/end',{turn:ctx.session.turn,reason:{kind:'completed'}}));}}});
  const out=[];const result=await executeDshRuntime({baseUrl:f.baseUrl,...f.transport,botName:'research-bot',prompt:'继续到完成',onOutput:c=>out.push(c)});
  assert.equal(result.status,'failed');assert.equal(result.sessionExit.reason,'aborted');assert.equal(result.output,'第一步');assert.equal(out.join(''),'第一步');
  assert.equal(f.calls.filter(c=>c.method==='session/prompt').length,1);assert.equal(f.sessions.size,1);assert.ok(f.connections.length>1);
  assert.equal(f.calls.filter(c=>c.method==='session/cancel').length,1);
});
test('native follow error frame is a failure rather than a successful empty answer',{timeout:4000},async t=>{
  const f=await dshFixture(t,{onPrompt:({connections})=>{const ws=connections.at(-1);ws.deliver({type:'error',streamId:ws.followId,error:{code:'session/not-found',message:'会话不存在'}});}});
  const result=await executeDshRuntime({baseUrl:f.baseUrl,...f.transport,botName:'research-bot',prompt:'工作'});
  assert.equal(result.status,'failed');assert.match(result.error,/会话不存在/);
});
test('a native follow end without turn/end never reports successful execution',{timeout:5000},async t=>{
  const f=await dshFixture(t,{hold:true,onFollow:({ws})=>setImmediate(()=>ws.deliver({type:'end',streamId:ws.followId}))});
  const result=await executeDshRuntime({baseUrl:f.baseUrl,...f.transport,botName:'research-bot',prompt:'工作'});
  assert.equal(result.status,'failed');assert.match(result.error,/连接|stream|订阅/i);
  assert.ok(f.calls.filter(c=>c.method==='session/prompt').length<=1);
});

test('a queued request ignores the preceding active turn until its own prompt echo arrives',{timeout:4000},async t=>{
  const f=await dshFixture(t,{manualPrompt:true,initialRecords:[{type:'event',event:{type:'turn/start',seq:1,time:1,data:{turn:1}}}],onPrompt:({request,event,begin,complete})=>{
    event(request.sessionId,'assistant/message',{turn:1,step:0,message:{content:[{type:'text',text:'此前工作结果'}]}});
    event(request.sessionId,'turn/end',{turn:1,reason:{kind:'completed'}});
    begin(request);complete(request,{reply:'本次工作结果'});
  }});
  const out=[];const result=await executeDshRuntime({baseUrl:f.baseUrl,...f.transport,botName:'research-bot',sessionId:'existing-session',prompt:'排队工作',onOutput:c=>out.push(c)});
  assert.equal(result.output,'本次工作结果');assert.equal(out.join(''),'本次工作结果');
});

test('stop confirmation reconnect restores native compressed assistant prefix without duplicate streamed text',{timeout:5000},async t=>{
  let request;let restored=false;
  const f=await dshFixture(t,{cancelAckOnly:true,onPrompt:ctx=>{
    request=ctx.request;ctx.transient(request.sessionId,{type:'start',attemptId:3,turn:ctx.turn,step:0});
    ctx.transient(request.sessionId,{type:'chunk',attemptId:3,index:0,chunk:{type:'text-delta',text:'前'}});ctx.connections.at(-1).close();
  },onFollow:ctx=>{
    if(ctx.connections.length<2||restored)return;restored=true;
    ctx.value(ctx.ws,{type:'snapshot',records:ctx.session.records,assistantStream:{revision:3,activeAttempt:{attemptId:3,turn:ctx.session.turn,step:0,nextIndex:2,stream:[{type:'text-chunks',index:0,texts:['前','半']}]}}});
    setImmediate(()=>{ctx.transient(request.sessionId,{type:'chunk',attemptId:3,index:2,chunk:{type:'text-delta',text:'后'}});f.complete(request,{reply:'前半后'});});
  }});
  const out=[];const result=await executeDshRuntime({baseUrl:f.baseUrl,...f.transport,botName:'research-bot',prompt:'流式工作',onOutput:c=>out.push(c)});
  assert.equal(result.status,'failed');assert.equal(result.sessionExit.reason,'completed');assert.equal(result.output,'前半后');assert.equal(out.join(''),'前半后');assert.equal(f.calls.filter(c=>c.method==='session/prompt').length,1);assert.equal(f.calls.filter(c=>c.method==='session/cancel').length,1);
});

test('native command failure and approval frames project real activity with matching session',{timeout:4000},async t=>{
  const f=await dshFixture(t,{onPrompt:({request,turn,event,connections,complete})=>{
    event(request.sessionId,'tool/call',{turn,step:0,callId:'pwsh-1',name:'pwsh',arguments:'Get-Date'});
    event(request.sessionId,'tool/result',{turn,step:0,error:true,message:{source:{toolName:'pwsh'},content:[{type:'tool-result',toolCallId:'pwsh-1',isError:true,content:[{type:'text',text:'执行失败'}]}]}});
    const ws=connections.at(-1);ws.deliver({type:'item',streamId:ws.eventsId,value:{type:'waterfall',event:'approval/request',agentId:request.sessionId,eventId:'approval-1',request:{toolName:'pwsh'}}});
    complete(request,{reply:'已说明工具错误'});
  }});
  const stages=[];const result=await executeDshRuntime({baseUrl:f.baseUrl,...f.transport,botName:'research-bot',prompt:'查看错误',onStage:s=>stages.push(s)});
  assert.equal(result.status,'succeeded');assert.ok(stages.some(s=>s.stage==='command' && s.status==='running'));
  assert.ok(stages.some(s=>s.stage==='tool' && s.status==='failed'));
  assert.ok(stages.some(s=>s.stage==='approval' && s.requestId==='approval-1' && s.sessionId===result.sessionId));
});

test('native tool results retain a bounded redacted summary for the activity view',{timeout:4000},async t=>{
  const f=await dshFixture(t,{onPrompt:({request,turn,event,complete})=>{
    event(request.sessionId,'tool/result',{turn,step:0,message:{source:{toolName:'read'},content:[{type:'tool-result',toolCallId:'read-1',content:[{type:'text',text:'visible result token=sk-secret-tool-output'}]}]}});
    complete(request,{reply:'已完成'});
  }});
  const stages=[];const result=await executeDshRuntime({baseUrl:f.baseUrl,...f.transport,botName:'research-bot',prompt:'读取',onStage:s=>stages.push(s)});
  assert.equal(result.status,'succeeded');
  const tool=stages.find(stage=>stage.stage==='tool'&&stage.callId==='read-1');
  assert.equal(tool.summary,'visible result token=[REDACTED]');
  assert.ok(tool.summary.length<=4000);
});

test('resuming a DSH session refuses a different requested cwd before any prompt or replacement session',async t=>{
 const f=await dshFixture(t,{routes:(_request,body,reply)=>{
  if(body.method!=='session/projections')return false;
  reply({type:'server-response',rpcId:body.rpcId,result:{ok:true,value:{values:{workingDirectory:'D:/old-project'}}}});return true;
 }});
 await assert.rejects(executeDshRuntime({baseUrl:f.baseUrl,...f.transport,botName:'real-bot',sessionId:'retained-session',cwd:'D:/new-project',prompt:'continue'}),{code:'DSH_SESSION_CWD_CONFLICT'});
 assert.equal(f.calls.some(call=>['session/create','session/prompt','session/cancel'].includes(call.method)),false);
});

test('a live DSH approval answers only its owned event connection and explicit single-use choice',async t=>{
 let channel,finish;
 const f=await dshFixture(t,{onPrompt:ctx=>{
  finish=()=>ctx.complete(ctx.request);const ws=ctx.connections.at(-1);
  ws.deliver({type:'item',streamId:ws.eventsId,value:{type:'waterfall',event:'approval/request',agentId:ctx.request.sessionId,eventId:'native-event',request:{toolName:'pwsh',callId:'tool-call',reason:'read workspace'}}});
 }});
 const running=executeDshRuntime({baseUrl:f.baseUrl,...f.transport,botName:'alpha',prompt:'check',onInteractionChannel:value=>{channel=value;}});
 for(let attempt=0;attempt<20&&!channel?.list().length;attempt++)await new Promise(resolve=>setImmediate(resolve));
 assert.ok(channel?.list().length,'owned live interaction channel must expose the native request');
 const pending=channel.list()[0];assert.equal(pending.kind,'approval');assert.notEqual(pending.interactionId,'native-event');
 await assert.rejects(channel.answer({interactionId:pending.interactionId,decision:'always'}));
 await channel.answer({interactionId:pending.interactionId,decision:'allowed-once'});
 const call=f.calls.find(item=>item.method==='$events/result');assert.deepEqual(call.payload.args,{clientId:'fixture-client',eventId:'native-event',outcome:{kind:'result',value:'allowed-once'}});
 assert.equal(channel.list().length,0);finish();assert.equal((await running).status,'succeeded');
 await assert.rejects(channel.answer({interactionId:pending.interactionId,decision:'allowed-once'}));
});
