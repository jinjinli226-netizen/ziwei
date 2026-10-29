import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRepository} from './repository.mjs';
import {ActionDispatcher} from '../src/daemon.mjs';
import {createActionDelivery} from '../src/daemon-action-delivery.mjs';
import {executeDshRuntime} from '../src/dsh-runtime.mjs';
import {dshFixture} from '../test/fixtures/dsh-protocol.mjs';

async function fixture(t,options={}){
 const protocol=await dshFixture(t,options.protocol),repo=createRepository({memory:true,envEncryptionKey:'dsh-receipt-fixture'}),directory=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-dsh-receipts-'));
 t.after(()=>{repo.db.close();fs.rmSync(directory,{recursive:true,force:true});});
 repo.heartbeatDevice('test-111',{deviceId:'dsh-receipt-pc',runtimes:{DSH:{status:'available',version:'0.2.1'}}});
 const employee=repo.createEmployee('test-111',{name:'DSH receipt employee',runtime:'DSH',runtimeProfile:'bot-real',targetDeviceId:'dsh-receipt-pc'}),conversation=repo.createConversation('test-111',{employeeId:employee.id});
 let delivery,uploads=0;const dispatcher=new ActionDispatcher({workdir:directory,stateFile:path.join(directory,'dispatcher.json'),workspace:'test-111',deviceId:'dsh-receipt-pc',stopGraceMs:80,
  onEvent:(type,event)=>{if(['action.started','action.output','action.stage','action.progress'].includes(type))delivery?.recordEvent(event.actionId,type,event);},
  execute:(action,context)=>executeDshRuntime({baseUrl:protocol.baseUrl,...protocol.transport,botName:action.payload.profile,prompt:action.payload.prompt,sessionId:action.payload.runtimeSessionId,signal:context.signal,sessionAuthority:{actionId:action.id,employeeId:action.payload.employeeId,conversationId:action.payload.conversationId},onSessionSupervision:context.onDshSessionSupervision,onStage:context.onStage,cancellationTimeoutMs:30})});
 const createDelivery=()=>createActionDelivery({directory:path.join(directory,'delivery'),identity:{apiBase:'https://dsh-fixture.invalid',workspace:'test-111',deviceId:'dsh-receipt-pc'},retryDelays:[],dispatch:action=>dispatcher.dispatch(action),recoverResult:action=>options.recoverResult?options.recoverResult(action,dispatcher.completedResult(action)):dispatcher.completedResult(action),post:async(url,body)=>{
  const id=decodeURIComponent(url.split('/')[4]),input={...body,deviceId:'dsh-receipt-pc'};
  if(url.endsWith('/ack'))return repo.ackA2AAction(id,input);
  if(url.endsWith('/events'))return repo.recordA2AEvent(id,input);
  if(options.failFirstResult&&uploads++===0){repo.db.prepare("UPDATE a2a_actions SET status='expired',expires_at=? WHERE id=?").run('2000-01-01T00:00:00.000Z',id);throw Error('lost terminal upload');}
  return repo.resultA2AAction(id,input);
 }});
 delivery=createDelivery();return{repo,protocol,employee,conversation,dispatcher,get delivery(){return delivery;},restartDelivery(){delivery=createDelivery();return delivery;},send:content=>repo.addConversationMessage(conversation.id,{content}),action:id=>repo.getA2AAction(id),directory};
}

test('DSH generic employee submission, native receipts and queued ACKs reuse one authoritative session',async t=>{
 const f=await fixture(t),first=f.send('FIRST'),second=f.send('SECOND'),third=f.send('THIRD');
 const initial=[first,second,third].map(message=>f.action(message.execution.id));
 assert.equal(initial[0].payload.runtime,'DSH');assert.equal(initial[0].payload.profile,'bot-real');
 for(const action of initial)await f.delivery.execute(action);
 const detail=f.repo.getConversation(f.conversation.id);
 assert.equal(detail.runtime_session_runtime,'DSH');assert.equal(detail.runtime_session_id,'bot-real-session-1');assert.equal(detail.queue.count,0);
 assert.equal(f.protocol.calls.filter(call=>call.method==='session/create').length,1);
 assert.equal(f.protocol.calls.filter(call=>call.method==='session/prompt').length,3);
 for(const message of [first,second,third]){
  const action=f.action(message.execution.id);assert.equal(action.status,'succeeded');assert.equal(action.result.sessionId,detail.runtime_session_id);assert.equal(action.result.processExit,undefined);
  assert.deepEqual(action.payload.dshSessionBinding,Object.fromEntries(['actionId','employeeId','conversationId','botName','sessionId','requestId'].map(key=>[key,action.result.sessionExit[key]])));
 }
});

test('a saved DSH terminal survives upload loss and expired delivery without invoking the model again',async t=>{
 const f=await fixture(t,{failFirstResult:true}),message=f.send('ONCE'),action=f.action(message.execution.id);
 await assert.rejects(f.delivery.execute(action),/lost terminal upload/);
 assert.equal(f.protocol.calls.filter(call=>call.method==='session/prompt').length,1);
 const restored=f.restartDelivery();assert.equal((await restored.recoverOriginal(action.id)).status,'succeeded');
 assert.equal(f.action(action.id).status,'succeeded');assert.equal(f.protocol.calls.filter(call=>call.method==='session/prompt').length,1);
});

test('DSH success cannot self-register a receipt or borrow another action, request, session or profile',async t=>{
 const f=await fixture(t),message=f.send('GUARDED'),action=f.action(message.execution.id);f.repo.ackA2AAction(action.id,{deviceId:'dsh-receipt-pc'});
 const binding={actionId:action.id,employeeId:f.employee.id,conversationId:f.conversation.id,botName:'bot-real',sessionId:'real-session',requestId:'253671ec-d991-4dbc-ad4b-4821b737ff43'};
 const result={sessionId:binding.sessionId,sessionExit:{schemaVersion:1,source:'dsh-native-session',...binding,turn:1,reason:'completed',terminalConfirmed:true}};
 assert.throws(()=>f.repo.resultA2AAction(action.id,{deviceId:'dsh-receipt-pc',status:'succeeded',result}),error=>error.code==='DSH_SESSION_RECEIPT_REQUIRED');
 f.repo.recordA2AEvent(action.id,{deviceId:'dsh-receipt-pc',type:'action.stage',data:{stage:'session',progress:{phase:'stage',dshSessionBinding:binding}}});
 for(const field of ['actionId','employeeId','conversationId','botName','sessionId','requestId'])assert.throws(()=>f.repo.resultA2AAction(action.id,{deviceId:'dsh-receipt-pc',status:'succeeded',result:{...result,sessionExit:{...result.sessionExit,[field]:'foreign'}}}),error=>error.code==='DSH_SESSION_RECEIPT_REQUIRED',field);
 assert.throws(()=>f.repo.resultA2AAction(action.id,{deviceId:'dsh-receipt-pc',status:'succeeded',result:{...result,processExit:{launched:true,rootPid:1234,rootConfirmed:true,treeConfirmed:true,activeProcesses:0,rootExitCode:0}}}),error=>error.code==='DSH_SESSION_RECEIPT_REQUIRED');
 assert.throws(()=>f.repo.resultA2AAction(action.id,{deviceId:'dsh-receipt-pc',status:'failed',error:'fake process cancellation',result:{processExit:{launched:true,rootPid:1234,rootConfirmed:true,treeConfirmed:true,activeProcesses:0,rootExitCode:null,cancelled:true}}}),error=>error.code==='DSH_SESSION_RECEIPT_REQUIRED');
 assert.throws(()=>f.repo.resultA2AAction(action.id,{deviceId:'dsh-receipt-pc',status:'succeeded',result:{...result,sessionExit:{...result.sessionExit,reason:'error'}}}),error=>error.code==='DSH_SESSION_RECEIPT_REQUIRED');
 assert.throws(()=>f.repo.recordA2AEvent(action.id,{deviceId:'dsh-receipt-pc',type:'action.stage',data:{stage:'session',progress:{phase:'stage',dshSessionBinding:{...binding,requestId:'153671ec-d991-4dbc-ad4b-4821b737ff43'}}}}),error=>error.code==='DSH_SESSION_BINDING_CONFLICT');
 assert.throws(()=>f.repo.resultA2AAction(action.id,{deviceId:'other-device',status:'succeeded',result}),/another device/);
 assert.equal(f.repo.resultA2AAction(action.id,{deviceId:'dsh-receipt-pc',status:'succeeded',result}).status,'succeeded');
});

test('durable DSH recovery rejects a serialized cached exit that disagrees with the saved native request',async t=>{
 let injected=null;const f=await fixture(t,{protocol:{hold:true,cancelAckOnly:true},recoverResult:(_action,original)=>injected||original});
 const message=f.send('UNKNOWN'),action=f.action(message.execution.id),running=f.delivery.execute(action);
 while(!f.protocol.calls.some(call=>call.method==='session/prompt'))await new Promise(resolve=>setImmediate(resolve));
 f.dispatcher.cancel(action.id);await running;
 const saved=f.action(action.id);assert.equal(saved.result.code,'EXECUTION_UNCERTAIN');assert.equal(f.dispatcher.quarantined,true);
 const scope=saved.payload.dshSessionBinding;
 injected={status:'succeeded',result:{sessionId:scope.sessionId,sessionExit:{schemaVersion:1,source:'dsh-native-session',...scope,requestId:'another-request',turn:2,reason:'completed',terminalConfirmed:true}}};
 assert.equal((await f.restartDelivery().recoverOriginal(action.id)).state,'unconfirmed');
 assert.equal(f.action(action.id).status,'failed');assert.equal(f.protocol.calls.filter(call=>call.method==='session/prompt').length,1);
});

test('a real DSH cancelled turn and confirmed target delivery settle stop without process evidence',async t=>{
 const f=await fixture(t,{protocol:{hold:true}}),message=f.send('CANCEL'),action=f.action(message.execution.id),running=f.delivery.execute(action);
 while(!f.protocol.calls.some(call=>call.method==='session/prompt'))await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.dispatcher.cancel(action.id),true);await running;
 const target=f.action(action.id);assert.equal(target.status,'failed');assert.equal(target.result.sessionExit.reason,'aborted');assert.equal(target.result.stopConfirmed,true);assert.equal(target.result.processExit,undefined);
 const control=f.repo.createA2AAction('test-111',{type:'action.cancel',payload:{actionId:action.id,deviceId:'dsh-receipt-pc'}});
 await f.delivery.execute(control);const stopped=f.action(control.id);
 assert.equal(stopped.result.stopConfirmed,true);assert.equal(stopped.result.targetReceipt.state,'confirmed');assert.equal(f.protocol.calls.filter(call=>call.method==='session/cancel').length,1);
});

test('DSH unknown failures remain final but cannot release the next turn until exact late native evidence arrives',async t=>{
 const f=await fixture(t),first=f.send('UNKNOWN'),next=f.send('NEXT'),action=f.action(first.execution.id);f.repo.ackA2AAction(action.id,{deviceId:'dsh-receipt-pc'});
 const binding={actionId:action.id,employeeId:f.employee.id,conversationId:f.conversation.id,botName:'bot-real',sessionId:'unknown-session',requestId:'253671ec-d991-4dbc-ad4b-4821b737ff43'};
 f.repo.recordA2AEvent(action.id,{deviceId:'dsh-receipt-pc',type:'action.stage',data:{stage:'session',progress:{phase:'stage',dshSessionBinding:binding}}});
 f.repo.resultA2AAction(action.id,{deviceId:'dsh-receipt-pc',status:'failed',error:'cancel ACK without turn/end',result:{code:'EXECUTION_UNCERTAIN',executionState:'uncertain'}});
 assert.equal(f.action(action.id).status,'failed');f.repo.resumeConversationQueue(f.conversation.id);
 assert.throws(()=>f.repo.ackA2AAction(next.execution.id,{deviceId:'dsh-receipt-pc'}),error=>error.code==='DSH_SESSION_UNCONFIRMED');
 const result={sessionId:binding.sessionId,sessionExit:{schemaVersion:1,source:'dsh-native-session',...binding,turn:1,reason:'aborted',terminalConfirmed:true}};
 assert.equal(f.repo.resultA2AAction(action.id,{deviceId:'dsh-receipt-pc',status:'failed',error:'confirmed cancelled turn',result}).status,'failed');
 f.repo.resumeConversationQueue(f.conversation.id);assert.equal(f.repo.ackA2AAction(next.execution.id,{deviceId:'dsh-receipt-pc'}).payload.runtimeSessionId,binding.sessionId);
});
