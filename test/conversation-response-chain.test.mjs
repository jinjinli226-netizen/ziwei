import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createRepository} from '../backend/repository.mjs';
import {ActionDispatcher} from '../src/daemon.mjs';
import {createActionDelivery} from '../src/daemon-action-delivery.mjs';
import {parseRuntimeStreamLine} from '../src/runtime-adapters.mjs';
import {conversationStreamMessages} from '../frontend/src/conversation-stream.js';

test('runtime parser, dispatcher, durable transport and conversation projection display the answer before its final result',async t=>{
  const temp=fs.realpathSync(os.tmpdir()),directory=fs.mkdtempSync(path.join(temp,'ziwei-response-chain-'));
  const repo=createRepository({memory:true}),slug='test-111',deviceId='stream-chain-pc';
  t.after(()=>{repo.db.close();assert.equal(path.dirname(directory),temp);assert(path.basename(directory).startsWith('ziwei-response-chain-'));fs.rmSync(directory,{recursive:true,force:true});});
  repo.heartbeatDevice(slug,{deviceId,runtimes:{Codex:{status:'available'}}});
  const employee=repo.createEmployee(slug,{name:'Stream',runtime:'Codex',runtimeProfile:'stream',targetDeviceId:deviceId,status:'active'});
  const conversation=repo.createConversation(slug,{employeeId:employee.id}),sent=repo.addConversationMessage(conversation.id,{content:'请逐步回答'}),actionId=sent.execution.id;
  let accept,finish,delivery;
  const done=new Promise(resolve=>{finish=resolve;}),dispatcher=new ActionDispatcher({workspace:slug,deviceId,
    execute:async(_action,context)=>{
      const state={output:'',response:'',bytes:0,truncated:false};
      accept=value=>parseRuntimeStreamLine(JSON.stringify(value),state,()=>{},context.onStage);
      accept({type:'text',text:'这是'});await done;
      return {output:'这是实时输出。'};
    },onEvent:(type,data)=>{if(['action.started','action.stage','action.response'].includes(type))delivery.recordEvent(actionId,type,data);}});
  delivery=createActionDelivery({directory:path.join(directory,'action-delivery'),identity:{apiBase:'https://stream.invalid',workspace:slug,deviceId},dispatch:action=>dispatcher.dispatch(action),retryDelays:[],
    post:async(url,body)=>{
      if(url.endsWith('/ack'))return repo.ackA2AAction(actionId,{...body,deviceId});
      if(url.endsWith('/events'))return repo.recordA2AEvent(actionId,{...body,deviceId});
      if(url.endsWith('/result'))return repo.resultA2AAction(actionId,{...body,deviceId});
      throw Error('Unexpected transport route');
    }});
  const running=delivery.execute(repo.getA2AAction(actionId));
  try{
    for(let i=0;i<50&&!repo.getConversation(conversation.id).execution.stream;i++)await delay(10);
    const first=repo.getConversation(conversation.id,{}, {view:'thread'});
    assert.equal(first.execution.stream?.text,'这是');assert.equal(first.execution.status,'acked');
    assert.equal(first.messages.filter(message=>message.role==='assistant').length,0);
    assert.equal(conversationStreamMessages(first.messages,first.execution).at(-1).content,'这是');
    accept({type:'text',text:'实时输出。'});
    for(let i=0;i<50&&repo.getConversation(conversation.id).execution.stream?.text!=='这是实时输出。';i++)await delay(10);
    const updated=repo.getConversation(conversation.id,{}, {view:'thread'});
    assert.equal(updated.execution.stream.text,'这是实时输出。');
    assert.equal(conversationStreamMessages(updated.messages,updated.execution).filter(message=>message.role==='assistant').length,1);
  }finally{finish();}
  assert.equal((await running).state,'confirmed');
  const final=repo.getConversation(conversation.id,{}, {view:'thread'});
  assert.equal(final.execution.stream,undefined);
  assert.deepEqual(conversationStreamMessages(final.messages,final.execution).filter(message=>message.role==='assistant').map(message=>message.content),['这是实时输出。']);
});
