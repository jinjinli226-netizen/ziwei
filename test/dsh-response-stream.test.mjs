import test from 'node:test';
import assert from 'node:assert/strict';
import {executeDshRuntime} from '../src/dsh-runtime.mjs';
import {dshFixture} from './fixtures/dsh-protocol.mjs';

test('DSH publishes native assistant increments immediately, then reconciles completed snapshots',async t=>{
  const stages=[];
  const f=await dshFixture(t,{onPrompt:({request,turn,transient,event,complete})=>{
    transient(request.sessionId,{type:'start',attemptId:1,turn,step:0});
    transient(request.sessionId,{type:'chunk',attemptId:1,index:0,chunk:{type:'text-delta',text:'第一'}});
    assert.equal(stages.at(-1)?.text,'第一');
    transient(request.sessionId,{type:'chunk',attemptId:1,index:1,chunk:{type:'text-delta',text:'段'}});
    event(request.sessionId,'assistant/message',{turn,step:0,message:{role:'assistant',content:[{type:'text',text:'更正后的第一段'}]}});
    complete(request,{reply:'最终正文'});
  }});
  const result=await executeDshRuntime({baseUrl:f.baseUrl,...f.transport,botName:'fixture',prompt:'fixture',onStage:s=>stages.push(s)});
  assert.equal(result.status,'succeeded');
  assert.deepEqual(stages.filter(x=>x.stage==='response').map(x=>x.text),['第一','第一段','更正后的第一段','最终正文']);
  assert.equal(result.output,'最终正文');
});

test('DSH hides raw reasoning and tool arguments while publishing redacted assistant snapshots',async t=>{
  const f=await dshFixture(t,{onPrompt:({request,turn,transient,event,complete})=>{
    transient(request.sessionId,{type:'start',attemptId:1,turn,step:0});
    transient(request.sessionId,{type:'chunk',attemptId:1,index:0,chunk:{type:'reasoning-delta',text:'HIDDEN_REASONING'}});
    event(request.sessionId,'tool/call',{turn,step:0,callId:'call-1',name:'terminal',arguments:'secret-value'});
    complete(request,{reply:'公开回答 token=secret-value'});
  }});
  const stages=[];
  await executeDshRuntime({baseUrl:f.baseUrl,...f.transport,botName:'fixture',prompt:'fixture',onStage:s=>stages.push(s)});
  assert.deepEqual(stages.filter(x=>x.stage==='response').map(x=>x.text),['公开回答 token=[REDACTED]']);
  assert.doesNotMatch(JSON.stringify(stages),/HIDDEN_REASONING|secret-value/);
});
