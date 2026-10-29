import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRepository} from './repository.mjs';
import {createManagementService} from './management.mjs';
import {completeOwnedProfile} from '../test-support/owned-profile.mjs';
import {createActionDelivery} from '../src/daemon-action-delivery.mjs';
import {executionBinding} from '../src/execution-admission.mjs';
import {rasterFixtures} from '../test/fixtures/raster-images.mjs';

function fixture(t){
 const repo=createRepository({memory:true,envEncryptionKey:'queue-recovery-fixture'});t.after(()=>repo.db.close());
 repo.heartbeatDevice('test-111',{deviceId:'queue-pc',runtimes:{Hermes:{status:'available',version:'0.22.5',profiles:[{name:'default',provider_configured:true,authentication_configured:true}]}}});
 const employee=repo.createEmployee('test-111',{name:'Queue recovery',runtime:'Codex',targetDeviceId:'queue-pc'}),conversation=repo.createConversation('test-111',{employeeId:employee.id});
 const send=content=>repo.addConversationMessage(conversation.id,{content});
 return{repo,employee,conversation,send};
}
function activeBot(repo){
 const bots=createManagementService(repo).bots;
 let bot=bots.create('test-111',{name:'Queue Hermes',sourceProfile:'default',targetDeviceId:'queue-pc',idempotencyKey:'queue-recovery'});
 completeOwnedProfile(repo,bot);
 const validation=bots.validate('test-111',bot.id,{expectedRevision:bot.revision,idempotencyKey:'queue-validation'}).action;
 repo.ackA2AAction(validation.id,{deviceId:'queue-pc'});repo.resultA2AAction(validation.id,{status:'succeeded',result:{botValidation:{schemaVersion:1,valid:true,employeeId:bot.id,revision:bot.revision}}});
 const control=operation=>bot=bots.control('test-111',bot.id,{expectedRevision:bot.revision,expectedControlEpoch:bot.control_epoch,operation});
 control('activate');
 return{get bot(){return bot;},control};
}
function delivery(t,repo,dispatch){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-queue-recovery-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const calls=[];
 const post=async(url,input)=>{
  const [,id,operation]=url.match(/actions\/([^/]+)\/(ack|events|result)$/)||[];calls.push({operation,input});
  if(operation==='ack')return repo.ackA2AAction(id,{...input,deviceId:'queue-pc'});
  if(operation==='events')return repo.recordA2AEvent(id,{...input,deviceId:'queue-pc'});
  return repo.resultA2AAction(id,{...input,deviceId:'queue-pc'});
 };
 const create=()=>createActionDelivery({directory,identity:{workspace:'test-111',deviceId:'queue-pc',apiBase:'offline://queue-recovery'},retryDelays:[],post,dispatch});
 return{engine:create(),create,calls,directory};
}

test('failure leaves the queue enabled and a new message explicitly resumes paused pending input',t=>{
 const f=fixture(t),first=f.send('FIRST');f.repo.ackA2AAction(first.execution.id,{deviceId:'queue-pc'});const next=f.send('NEXT');
 f.repo.resultA2AAction(first.execution.id,{status:'failed',error:'provider failed'});
 assert.equal(f.repo.getConversation(f.conversation.id).queue.paused,false);
 f.repo.pauseConversationQueue(f.conversation.id);const last=f.send('LAST');
 assert.equal(f.repo.getConversation(f.conversation.id).queue.paused,false);
 assert.deepEqual(f.repo.getConversation(f.conversation.id).queue.items.map(item=>item.id),[next.execution.id,last.execution.id]);
});

test('a pause between poll and ACK stays retryable across delivery restart',async t=>{
 const f=fixture(t),message=f.send('WORK'),polled=f.repo.listA2AActions('test-111',{executionDelivery:true,deviceId:'queue-pc'})[0];
 let executions=0;const d=delivery(t,f.repo,async()=>{executions++;return{status:'succeeded',result:{output:'DONE'}};});
 f.repo.pauseConversationQueue(f.conversation.id);
 await assert.rejects(d.engine.execute(polled),error=>error.code==='CONVERSATION_QUEUE_PAUSED');
 assert.equal(d.engine.blockedCount,0);
 f.repo.resumeConversationQueue(f.conversation.id);
 const restarted=d.create();assert.equal(restarted.recoverActions().length,1);
 await restarted.execute(polled);
 assert.equal(executions,1);assert.equal(f.repo.getA2AAction(message.execution.id).status,'succeeded');
});

test('Bot pause retains current and queued work, then compact ACK authorizes an already polled message after resume',async t=>{
 const f=fixture(t),b=activeBot(f.repo),id=b.bot.main_conversation_id;
 const first=f.repo.addConversationMessage(id,{content:'FIRST'});f.repo.ackA2AAction(first.execution.id,{deviceId:'queue-pc'});
 const image=rasterFixtures.png.toString('base64'),next=f.repo.addConversationMessage(id,{content:'NEXT',attachments:[{name:'queue.png',mimeType:'image/png',contentEncoding:'base64',content:image}]});
 const polled=f.repo.listA2AActions('test-111',{executionDelivery:true,deviceId:'queue-pc'}).find(action=>action.id===next.execution.id),oldEpoch=polled.payload.hermesBot.controlEpoch;
 let seen;const d=delivery(t,f.repo,async action=>{
  seen=action;
  assert.equal(f.repo.authorizeActionExecution(action.id,{deviceId:'queue-pc'}).executionBinding,executionBinding(action));
  assert.equal(f.repo.authorizeBotStart(action.id,{deviceId:'queue-pc'}).controlEpoch,b.bot.control_epoch);
  return{status:'succeeded',result:{output:'NEXT_REPLY'}};
 });
 b.control('pause');
 assert.equal(f.repo.getA2AAction(first.execution.id).status,'acked');assert.equal(f.repo.getA2AAction(next.execution.id).status,'pending');
 assert.equal(f.repo.getConversation(id).queue.paused,true);
 await assert.rejects(d.engine.execute(polled),error=>error.code==='CONVERSATION_QUEUE_PAUSED');assert.equal(d.engine.blockedCount,0);
 f.repo.resultA2AAction(first.execution.id,{status:'succeeded',result:{output:'FIRST_REPLY'}});
 f.repo.resumeConversationQueue(id);
 await assert.rejects(d.engine.execute(polled),error=>error.code==='BOT_NOT_ACTIVE');assert.equal(d.engine.blockedCount,0);
 b.control('resume');
 assert.ok(b.bot.control_epoch>oldEpoch);assert.equal(f.repo.getConversation(id).queue.paused,false);
 await d.engine.execute(polled);
 assert.equal(seen.payload.hermesBot.controlEpoch,b.bot.control_epoch);assert.match(seen.payload.prompt,/FIRST_REPLY/);
 assert.equal(seen.payload.attachments[0].content,image);assert.equal(f.repo.getA2AAction(next.execution.id).status,'succeeded');
 const ack=f.repo.ackA2AAction(next.execution.id,{deviceId:'queue-pc',receiptOnly:true});assert.equal(ack.payload,undefined);
});

test('compact ACK retries retain refreshed input without repeating queued image bytes',t=>{
 const f=fixture(t),first=f.send('FIRST');f.repo.ackA2AAction(first.execution.id,{deviceId:'queue-pc'});
 const image=rasterFixtures.png.toString('base64'),next=f.repo.addConversationMessage(f.conversation.id,{content:'NEXT',attachments:[{name:'queue.png',mimeType:'image/png',contentEncoding:'base64',content:image}]});
 f.repo.resultA2AAction(first.execution.id,{status:'succeeded',result:{output:'LATE_REPLY'}});
 const ack=f.repo.ackA2AAction(next.execution.id,{deviceId:'queue-pc',receiptOnly:true});
 assert.equal(ack.payload,undefined);assert.match(ack.executionInput.prompt,/LATE_REPLY/);assert.equal(ack.executionInput.attachments,undefined);
 assert.equal(JSON.stringify(ack).includes(image),false);
 const duplicate=f.repo.ackA2AAction(next.execution.id,{deviceId:'queue-pc',receiptOnly:true});assert.deepEqual(duplicate.executionInput,ack.executionInput);
 assert.equal(f.repo.ackA2AAction(next.execution.id,{receiptOnly:true}).executionInput,undefined);
 assert.throws(()=>f.repo.ackA2AAction(next.execution.id,{deviceId:'other-pc',receiptOnly:true}),/another device/);
});

test('Bot resume cannot authorize another revision, profile, device, workspace, employee or provider config',t=>{
 for(const mutate of [p=>p.hermesBot.revision++,p=>p.profile='other-profile',p=>p.deviceId='other-pc',p=>p.hermesBot.workspace='other-workspace',p=>p.hermesBot.employeeId='other-employee',p=>p.hermesBot.config.provider='other-provider',p=>p.hermesBot.instance.ownershipId='other-owner']){
  const f=fixture(t),b=activeBot(f.repo),message=f.repo.addConversationMessage(b.bot.main_conversation_id,{content:'QUEUED'}),raw=f.repo.db.prepare('SELECT payload_json FROM a2a_actions WHERE id=?').get(message.execution.id),payload=JSON.parse(raw.payload_json);
  b.control('pause');
  mutate(payload);f.repo.db.prepare('UPDATE a2a_actions SET payload_json=? WHERE id=?').run(JSON.stringify(payload),message.execution.id);
  try{b.control('resume');}catch(error){assert.equal(error.code,'EXECUTION_HISTORY_BINDING_MISMATCH');}
  const saved=JSON.parse(f.repo.db.prepare('SELECT payload_json FROM a2a_actions WHERE id=?').get(message.execution.id).payload_json);
  assert.equal(saved.hermesBot.controlEpoch,payload.hermesBot.controlEpoch,'a changed execution binding must not receive a new epoch');
  assert.throws(()=>f.repo.ackA2AAction(message.execution.id,{deviceId:'queue-pc'}));
 }
});

test('only named transient admission errors remain retryable; authorization and unknown conflicts remain blocked',async t=>{
 for(const code of ['CONVERSATION_QUEUE_BLOCKED','BOT_BUSY','DSH_SESSION_UNCONFIRMED','BOT_NOT_ACTIVE','BOT_DEFERRED_CONFIG_BUSY']){
  const f=fixture(t),message=f.send('WORK'),polled=f.repo.getA2AAction(message.execution.id);let blocked=true,executions=0;
  const d=delivery(t,f.repo,async()=>{executions++;return{status:'succeeded',result:{output:'DONE'}};});
  const create=()=>createActionDelivery({directory:d.directory,identity:{workspace:'test-111',deviceId:'queue-pc',apiBase:'offline://queue-recovery'},retryDelays:[],post:async(url,input)=>{if(blocked)throw Object.assign(new Error(code),{status:409,code});const [,id,operation]=url.match(/actions\/([^/]+)\/(ack|events|result)$/);return operation==='ack'?f.repo.ackA2AAction(id,{...input,deviceId:'queue-pc'}):operation==='events'?f.repo.recordA2AEvent(id,{...input,deviceId:'queue-pc'}):f.repo.resultA2AAction(id,{...input,deviceId:'queue-pc'});},dispatch:async()=>{executions++;return{status:'succeeded',result:{output:'DONE'}};}});
  const engine=create();await assert.rejects(engine.execute(polled));assert.equal(engine.blockedCount,0,code);blocked=false;await create().execute(polled);assert.equal(executions,1,code);
 }
 for(const [status,code] of [[403,'BOT_BINDING_CONFLICT'],[409,'BOT_REVISION_CONFLICT'],[409,'UNKNOWN_CONFLICT'],[403,'CONVERSATION_QUEUE_PAUSED']]){
  const f=fixture(t),message=f.send('WORK');const d=delivery(t,f.repo,async()=>assert.fail('permanent errors cannot dispatch'));
  const engine=createActionDelivery({directory:d.directory,identity:{workspace:'test-111',deviceId:'queue-pc',apiBase:'offline://queue-recovery'},retryDelays:[],post:async()=>{throw Object.assign(new Error(code),{status,code});},dispatch:async()=>assert.fail('must not execute')});
  await assert.rejects(engine.execute(message.execution));assert.equal(engine.blockedCount,1,code);
 }
});
