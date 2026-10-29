import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRepository} from './repository.mjs';
import {createManagementService} from './management.mjs';
import {completeOwnedProfile} from '../test-support/owned-profile.mjs';
import {createActionScheduler} from '../src/daemon-action-scheduler.mjs';
import {rasterFixtures} from '../test/fixtures/raster-images.mjs';

function fixture(t,options={}){
 const repo=createRepository({memory:true,envEncryptionKey:'queue-fixture-only',...options});t.after(()=>{if(repo.db.isOpen)repo.db.close();});
 repo.heartbeatDevice('test-111',{deviceId:'queue-pc',runtimes:{Hermes:{status:'available',version:'0.22.5',profiles:[{name:'default',provider_configured:true,authentication_configured:true}]}}});
 const employee=repo.createEmployee('test-111',{name:'Queue employee',runtime:'Codex',targetDeviceId:'queue-pc'});
 const conversation=repo.createConversation('test-111',{employeeId:employee.id});
 const send=(content,extra={})=>repo.addConversationMessage(conversation.id,{content,...extra});
 const poll=()=>repo.listA2AActions('test-111',{executionDelivery:true,deviceId:'queue-pc'});
 return{repo,employee,conversation,send,poll};
}

test('pending actions project a persistent FIFO without interrupting the current execution',t=>{
 const f=fixture(t),first=f.send('FIRST');f.repo.ackA2AAction(first.execution.id,{deviceId:'queue-pc'});
 const second=f.send('SECOND'),third=f.send('THIRD');
 f.repo.db.prepare('UPDATE a2a_actions SET created_at=? WHERE id IN (?,?,?)').run('2026-01-01T00:00:00.000Z',first.execution.id,second.execution.id,third.execution.id);
 const detail=f.repo.getConversation(f.conversation.id);
 assert.equal(detail.execution.id,first.execution.id);
 assert.deepEqual(detail.queue.items.map(item=>item.id),[second.execution.id,third.execution.id]);
 assert.deepEqual(detail.queue.items.map(item=>item.message_id),[second.id,third.id]);
 assert.deepEqual(detail.messages.map(item=>item.queue_status),['running','queued','queued']);
 assert.throws(()=>f.repo.ackA2AAction(third.execution.id,{deviceId:'queue-pc'}),error=>error.code==='CONVERSATION_QUEUE_BLOCKED');
 f.repo.resultA2AAction(first.execution.id,{status:'succeeded',result:{output:'FIRST_REPLY'}});
 const ack=f.repo.ackA2AAction(second.execution.id,{deviceId:'queue-pc'});
 assert.match(ack.payload.prompt,/FIRST_REPLY/);assert.doesNotMatch(ack.payload.prompt,/THIRD/);
 assert.equal(f.repo.getConversation(f.conversation.id).queue.count,1);
});

test('attachments and idempotency stay on the original queued action until its execution lease begins',t=>{
 const f=fixture(t),attachments=[{name:'queued.png',mimeType:'image/png',content:rasterFixtures.png.toString('base64'),contentEncoding:'base64'}];
 f.repo.pauseConversationQueue(f.conversation.id);
 const first=f.send('ATTACHMENT',{attachments,clientMessageId:'queue-image'}),duplicate=f.send('ATTACHMENT',{attachments,clientMessageId:'queue-image'});
 assert.equal(duplicate.id,first.id);assert.equal(duplicate.execution.id,first.execution.id);assert.equal(duplicate.duplicate,true);
 assert.equal(first.queue.items[0].attachments[0].name,'queued.png');assert.equal('content' in first.queue.items[0].attachments[0],false);assert.equal(f.repo.db.prepare('SELECT expires_at FROM a2a_actions WHERE id=?').get(first.execution.id).expires_at,null);
 assert.equal(f.repo.getConversation(f.conversation.id,{},{view:'thread'}).queue.count,1);
 assert.equal(f.poll().length,0);f.repo.resumeConversationQueue(f.conversation.id);
 const ack=f.repo.ackA2AAction(first.execution.id,{deviceId:'queue-pc'});
 assert.ok(Date.parse(ack.expires_at)>Date.now());assert.equal(ack.payload.attachments[0].content,attachments[0].content);
});

test('pause retains pending input, removal never cancels current execution or enters later history',t=>{
 const f=fixture(t),first=f.send('FIRST');f.repo.ackA2AAction(first.execution.id,{deviceId:'queue-pc'});
 const removed=f.send('REMOVED_SECRET'),last=f.send('LAST');
 assert.throws(()=>f.repo.removeConversationQueueItem(f.conversation.id,first.execution.id),error=>error.status===409);
 f.repo.pauseConversationQueue(f.conversation.id);
 assert.equal(f.poll().some(action=>action.id===last.execution.id),false);
 assert.throws(()=>f.repo.ackA2AAction(last.execution.id,{deviceId:'queue-pc'}),error=>error.code==='CONVERSATION_QUEUE_PAUSED');
 f.repo.removeConversationQueueItem(f.conversation.id,removed.execution.id);
 assert.equal(f.repo.getConversation(f.conversation.id).messages.find(item=>item.id===removed.id).queue_status,'cancelled');
 assert.equal(f.repo.getA2AAction(first.execution.id).status,'acked');
 f.repo.resultA2AAction(first.execution.id,{status:'succeeded',result:{output:'FIRST_REPLY'}});
 assert.equal(f.repo.getConversation(f.conversation.id).queue.paused,true);
 f.repo.resumeConversationQueue(f.conversation.id);
 const ack=f.repo.ackA2AAction(last.execution.id,{deviceId:'queue-pc'});
 assert.doesNotMatch(ack.payload.prompt,/REMOVED_SECRET/);assert.match(ack.payload.prompt,/FIRST_REPLY/);
});

test('removing the last queued message cannot replace its execution with another workspace action',t=>{
 const f=fixture(t),message=f.send('ONLY');
 f.repo.db.prepare('INSERT INTO workspaces(id,slug,name,kind,plan,timezone,created_at) VALUES(?,?,?,?,?,?,?)').run('queue-foreign','queue-foreign','Foreign','team','free','UTC',new Date().toISOString());
 const foreign=f.repo.createEmployee('queue-foreign',{name:'Foreign',runtime:'Codex'});
 f.repo.createA2AAction('queue-foreign',{type:'conversation.execute',payload:{employeeId:foreign.id,conversationId:f.conversation.id,messageId:message.id,runtime:'Codex',prompt:'Unrelated action'}});
 f.repo.removeConversationQueueItem(f.conversation.id,message.execution.id);
 const detail=f.repo.getConversation(f.conversation.id,{},{view:'thread'});
 assert.equal(detail.queue.count,0);assert.equal(detail.execution,null);assert.equal(detail.messages[0].queue_status,'cancelled');
});

test('foreign or incorrectly bound terminal actions cannot pause another conversation queue',t=>{
 const f=fixture(t),message=f.send('LOCAL');
 f.repo.db.prepare('INSERT INTO workspaces(id,slug,name,kind,plan,timezone,created_at) VALUES(?,?,?,?,?,?,?)').run('queue-terminal-foreign','queue-terminal-foreign','Foreign','team','free','UTC',new Date().toISOString());
 const foreign=f.repo.createEmployee('queue-terminal-foreign',{name:'Foreign',runtime:'Codex'}),localOther=f.repo.createEmployee('test-111',{name:'Other local',runtime:'Codex'});
 for(const [slug,employee,messageId] of [['queue-terminal-foreign',foreign,message.id],['test-111',localOther,message.id],['test-111',f.employee,'nonexistent-message']]){
  const action=f.repo.createA2AAction(slug,{type:'conversation.execute',payload:{employeeId:employee.id,conversationId:f.conversation.id,messageId,runtime:'Codex',prompt:'Invalid binding'}});
  f.repo.db.prepare('UPDATE a2a_actions SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z',action.id);
  f.repo.listA2AActions(slug,{executionDelivery:true});
  assert.equal(f.repo.getConversation(f.conversation.id).queue.paused,false,'only the actual queued message may pause its conversation');
 }
 assert.equal(f.repo.getConversation(f.conversation.id).queue.count,1);
});

test('terminal failure pauses only its queue and resume never replays the failed action',t=>{
 const f=fixture(t),first=f.send('FAIL');f.repo.ackA2AAction(first.execution.id,{deviceId:'queue-pc'});
 const next=f.send('NEXT'),other=f.repo.createEmployee('test-111',{name:'Other',runtime:'Codex',targetDeviceId:'queue-pc'});
 const otherConversation=f.repo.createConversation('test-111',{employeeId:other.id}),independent=f.repo.addConversationMessage(otherConversation.id,{content:'OTHER'});
 f.repo.resultA2AAction(first.execution.id,{status:'failed',error:'provider failed',result:{output:'FAILED_REPLY'}});
 assert.equal(f.repo.getA2AAction(first.execution.id).status,'failed');
 assert.equal(f.repo.getConversation(f.conversation.id).queue.paused,true);
 assert.deepEqual(f.poll().map(action=>action.id),[independent.execution.id]);
 f.repo.resumeConversationQueue(f.conversation.id);
 assert.deepEqual(f.poll().map(action=>action.id),[next.execution.id,independent.execution.id]);
});

test('Hermes accepts queued input without replacing its occupied action or bypassing live-process admission',t=>{
 const f=fixture(t),bots=createManagementService(f.repo).bots;
 let bot=bots.create('test-111',{name:'Queue Hermes',sourceProfile:'default',targetDeviceId:'queue-pc',idempotencyKey:'queue-hermes'});
 completeOwnedProfile(f.repo,bot);
 const validation=bots.validate('test-111',bot.id,{expectedRevision:bot.revision,idempotencyKey:'validate-queue'}).action;
 f.repo.ackA2AAction(validation.id,{deviceId:'queue-pc'});f.repo.resultA2AAction(validation.id,{status:'succeeded',result:{botValidation:{schemaVersion:1,valid:true,employeeId:bot.id,revision:bot.revision}}});
 bot=bots.control('test-111',bot.id,{expectedRevision:bot.revision,expectedControlEpoch:bot.control_epoch,operation:'activate'});
 const first=f.repo.addConversationMessage(bot.main_conversation_id,{content:'FIRST'});f.repo.ackA2AAction(first.execution.id,{deviceId:'queue-pc'});
 const next=f.repo.addConversationMessage(bot.main_conversation_id,{content:'NEXT'});
 assert.equal(f.repo.db.prepare('SELECT active_action_id FROM hermes_bots WHERE employee_id=?').get(bot.id).active_action_id,first.execution.id);
 assert.throws(()=>f.repo.ackA2AAction(next.execution.id,{deviceId:'queue-pc'}),error=>['CONVERSATION_QUEUE_BLOCKED','BOT_BUSY'].includes(error.code));
 const removed=f.repo.addConversationMessage(bot.main_conversation_id,{content:'HERMES_REMOVED_SECRET'}),last=f.repo.addConversationMessage(bot.main_conversation_id,{content:'AFTER_REMOVAL'});
 f.repo.removeConversationQueueItem(bot.main_conversation_id,removed.execution.id);
 f.repo.resultA2AAction(first.execution.id,{status:'succeeded',result:{output:'FIRST_REPLY',nativeSessionId:'fixture-hermes-session'}});
 const continued=f.repo.ackA2AAction(next.execution.id,{deviceId:'queue-pc'});
 assert.equal(continued.payload.hermesBot.conversationId,bot.main_conversation_id);assert.equal(continued.payload.profile,first.execution.payload.profile);
 assert.equal(f.repo.db.prepare('SELECT active_action_id FROM hermes_bots WHERE employee_id=?').get(bot.id).active_action_id,next.execution.id);
 assert.doesNotMatch(f.repo.getA2AAction(last.execution.id).payload.prompt,/HERMES_REMOVED_SECRET/);
 assert.match(continued.payload.prompt,/FIRST_REPLY/);
 f.repo.resultA2AAction(next.execution.id,{status:'failed',error:'failed with live root',result:{processExit:{launched:true,rootPid:4242,rootConfirmed:false,treeConfirmed:false,activeProcesses:1}}});
 assert.equal(f.repo.getA2AAction(next.execution.id).status,'failed');
 f.repo.resumeConversationQueue(bot.main_conversation_id);
 assert.throws(()=>f.repo.ackA2AAction(last.execution.id,{deviceId:'queue-pc'}),error=>error.code==='BOT_BUSY');
});

test('an expired active turn pauses once and an explicit resume keeps later input available',t=>{
 const f=fixture(t),first=f.send('FIRST');f.repo.ackA2AAction(first.execution.id,{deviceId:'queue-pc'});const second=f.send('SECOND');
 f.repo.db.prepare('UPDATE a2a_actions SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z',first.execution.id);
 assert.equal(f.poll().length,0);assert.equal(f.repo.getA2AAction(first.execution.id).status,'expired');assert.equal(f.repo.getConversation(f.conversation.id).queue.paused,true);
 f.repo.resumeConversationQueue(f.conversation.id);assert.deepEqual(f.poll().map(action=>action.id),[second.execution.id]);assert.equal(f.repo.getConversation(f.conversation.id).queue.paused,false);
});

test('queue controls and pending actions survive reopening their database',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-queue-'));
 const filename=path.join(root,'queue.sqlite'),f=fixture(t,{memory:false,filename});
 const first=f.send('PERSISTED');f.repo.pauseConversationQueue(f.conversation.id);f.repo.db.close();
 const reopened=createRepository({filename,envEncryptionKey:'queue-fixture-only'});t.after(()=>{reopened.db.close();fs.rmSync(root,{recursive:true,force:true});});
 const detail=reopened.getConversation(f.conversation.id);
 assert.equal(detail.queue.paused,true);assert.equal(detail.queue.items[0].id,first.execution.id);
 reopened.resumeConversationQueue(f.conversation.id);assert.equal(reopened.listA2AActions('test-111',{executionDelivery:true}).some(action=>action.id===first.execution.id),true);
});

test('real scheduler preserves FIFO per employee while independent employees run together',async t=>{
 const f=fixture(t),a=f.send('A'),b=f.send('B'),other=f.repo.createEmployee('test-111',{name:'Parallel',runtime:'Codex',targetDeviceId:'queue-pc'}),conversation=f.repo.createConversation('test-111',{employeeId:other.id}),c=f.repo.addConversationMessage(conversation.id,{content:'C'});
 let release;const hold=new Promise(resolve=>release=resolve),calls=[];
 const scheduler=createActionScheduler({execute:async action=>{f.repo.ackA2AAction(action.id,{deviceId:'queue-pc'});calls.push(action.id);if(action.id===a.execution.id)await hold;f.repo.resultA2AAction(action.id,{status:'succeeded',result:{output:action.id}});}});
 scheduler.schedule(f.poll());await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,[a.execution.id,c.execution.id]);
 release();await scheduler.whenIdle();scheduler.schedule(f.poll());await scheduler.whenIdle();assert.deepEqual(calls,[a.execution.id,c.execution.id,b.execution.id]);
});
