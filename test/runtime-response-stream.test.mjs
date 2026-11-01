import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRuntimeStreamLine} from '../src/runtime-adapters.mjs';

function stream() {
  const state={output:'',response:'',bytes:0,truncated:false};
  const stages=[];
  return {state,stages,accept:value=>parseRuntimeStreamLine(typeof value==='string'?value:JSON.stringify(value),state,()=>{},stage=>stages.push(stage))};
}

test('Hermes native text deltas publish real response snapshots and the final result replaces them',()=>{
  const s=stream();
  s.accept({type:'text',text:'正在检查'});
  assert.deepEqual(s.stages.filter(x=>x.stage==='response').map(x=>x.text),['正在检查']);
  s.accept({type:'text',text:' '});
  s.accept({type:'text',text:'目录。'});
  assert.equal(s.state.response,'正在检查 目录。');
  s.accept({type:'result',text:'已确认目录。',session_id:'native-fixture',replay_gap:true});
  s.accept({type:'result',text:'已确认目录。'});
  assert.deepEqual(s.stages.filter(x=>x.stage==='response').map(x=>x.text),['正在检查','正在检查 ','正在检查 目录。','已确认目录。']);
  assert.equal(s.state.response,'已确认目录。');
  assert.equal(s.state.sessionId,'native-fixture');
});

test('Codex assistant item snapshots update by native item id without replaying their prefix',()=>{
  const s=stream();
  for(const [type,text] of [['item.started','第一'],['item.updated','第一段'],['item.completed','第一段']])s.accept({type,item:{id:'answer-1',type:'agent_message',text}});
  s.accept({type:'item.completed',item:{id:'answer-2',type:'agent_message',text:'第二段'}});
  assert.deepEqual(s.stages.filter(x=>x.stage==='response').map(x=>x.text),['第一','第一段','第一段\n第二段']);
  assert.equal(s.state.response,'第一段\n第二段');
});

test('response stages accept only public assistant text and redact secrets from complete snapshots',()=>{
  const s=stream();
  for(const event of [
    'stdout diagnostic token=secret-value',
    {type:'tool_result',text:'tool output token=secret-value'},
    {type:'item.completed',item:{type:'command_execution',command:'sh secret-value',text:'command result'}},
    {type:'item.completed',item:{type:'reasoning',text:'HIDDEN_REASONING'}},
    {type:'item.completed',item:{type:'reasoning',role:'assistant',text:'HIDDEN_REASONING'}},
    {type:'message',role:'user',content:'USER_ECHO'}
  ])s.accept(event);
  assert.deepEqual(s.stages.filter(x=>x.stage==='response'),[]);
  assert.doesNotMatch(JSON.stringify(s.stages),/HIDDEN_REASONING|secret-value|USER_ECHO/);
  s.accept({type:'text',text:'answer token='});
  s.accept({type:'text',text:'secret-value'});
  assert.equal(s.stages.at(-1).text,'answer token=[REDACTED]');
});

test('assistant content blocks omit thinking and tool content',()=>{
  const s=stream();
  s.accept({type:'item.completed',item:{id:'answer-1',type:'message',role:'assistant',content:[{type:'text',text:'公开正文'},{type:'thinking',text:'HIDDEN_REASONING'},{type:'tool_use',text:'secret-value'}]}});
  assert.equal(s.stages.at(-1)?.text,'公开正文');
  assert.equal(s.state.response,'公开正文');
});
