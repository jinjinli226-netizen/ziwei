import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createRepository} from '../backend/repository.mjs';
import {createManagementService} from '../backend/management.mjs';
import {FROZEN_VERSIONS} from '../backend/version-preservation.mjs';
import {createConversationForwarding} from '../backend/conversation-forwarding.mjs';
import {completeOwnedProfile} from '../test-support/owned-profile.mjs';
import {rasterFixtures} from './fixtures/raster-images.mjs';

const slug='test-111',actor={actorUserId:'forward-owner',actorRole:'member',enforceEmployeeVisibility:true};
const image=(bytes=rasterFixtures.png)=>({name:'history.png',mimeType:'image/png',content:bytes.toString('base64'),contentEncoding:'base64',size:1});

function fixture(t,{targetChat=true}={}){
  const events=[],repo=createRepository({memory:true,onEvent:event=>events.push(event)});t.after(()=>repo.db.close());
  const workspace=repo.db.prepare('SELECT * FROM workspaces WHERE slug=?').get(slug);
  repo.db.prepare("UPDATE workspaces SET kind='team' WHERE id=?").run(workspace.id);
  repo.db.exec('CREATE TABLE local_users(id TEXT PRIMARY KEY,name TEXT,email TEXT)');
  for(const [user,name] of [['forward-owner','真实用户'],['forward-other','另一位用户']]){
    repo.db.prepare('INSERT INTO local_users VALUES(?,?,?)').run(user,name,user+'@example.test');
    repo.db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run(user,workspace.id,user,name,user+'@example.test','member',new Date().toISOString());
  }
  repo.heartbeatDevice(slug,{deviceId:'forward-pc',ownerUserId:actor.actorUserId,workdir:'C:/Work',runtimes:{Codex:{status:'available'},Hermes:{status:'available',profiles:[{name:'default'}],models:[{id:'test-model'}]}}});
  const sourceEmployee=repo.createEmployee(slug,{name:'原员工',runtime:'Codex',targetDeviceId:'forward-pc',visibility:'personal',ownerUserId:actor.actorUserId});
  const targetEmployee=repo.createEmployee(slug,{name:'接收员工',runtime:'Codex',targetDeviceId:'forward-pc',visibility:'workspace',ownerUserId:'forward-other'});
  const source=repo.createConversation(slug,{employeeId:sourceEmployee.id,...actor});
  const target=targetChat?repo.createConversation(slug,{employeeId:targetEmployee.id,...actor}):null;
  const add=(content,extra={})=>repo.addConversationMessage(source.id,{...actor,content,dispatch:false,...extra});
  const request=(messages,extra={},context=actor)=>repo.forwardConversationMessages(source.id,{messageIds:messages.map(row=>row.id),targetEmployeeId:targetEmployee.id,clientRequestId:'forward-request',...extra},context);
  const snapshot=()=>Object.fromEntries(['conversations','conversation_messages','management_requests','a2a_actions','audit_events','notifications','hermes_bots'].map(table=>[table,repo.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  return {repo,workspace,sourceEmployee,targetEmployee,source,target,add,request,snapshot,events};
}

function botFor(f,name='目标Bot'){
  const bots=createManagementService(f.repo).bots;
  const key=Buffer.from(name).toString('base64url');
  let bot=bots.create(slug,{name,targetDeviceId:'forward-pc',runtimeProfile:'default',model:'test-model',idempotencyKey:key},actor);
  completeOwnedProfile(f.repo,bot);
  const validation=bots.validate(slug,bot.id,{expectedRevision:bot.revision,idempotencyKey:'validate-'+key},actor).action;
  f.repo.ackA2AAction(validation.id,{deviceId:'forward-pc'});
  f.repo.resultA2AAction(validation.id,{deviceId:'forward-pc',status:'succeeded',result:{botValidation:{schemaVersion:1,valid:true,employeeId:bot.id,revision:bot.revision}}});
  bot=bots.control(slug,bot.id,{expectedRevision:bot.revision,expectedControlEpoch:bot.control_epoch,operation:'activate'},actor);
  return {bots,bot};
}

test('server snapshots selected IDs in chat order with real authors and a non-executing legacy fallback',t=>{
  const f=fixture(t),first=f.add('历史用户文本'),second=f.add('员工答复',{role:'assistant'});
  f.repo.db.prepare('UPDATE conversation_messages SET created_at=? WHERE conversation_id=?').run('2026-10-17T00:00:00.000Z',f.source.id);
  const beforeActions=f.repo.listA2AActions(slug,{status:'all'}).length;
  const result=f.request([second,first],{note:'请留存'});
  assert.equal(result.forward.targetConversationId,f.target.id);assert.equal(result.forward.targetEmployeeId,f.targetEmployee.id);
  assert.equal(result.forward.mode,'reference');assert.equal(result.duplicate,false);assert.equal(result.execution,undefined);
  assert.equal(result.message.role,'user');assert.equal(result.message.sender_user_id,actor.actorUserId);
  const quoted=result.message.forward;
  assert.equal(quoted.schemaVersion,1);assert.equal(quoted.id,result.forward.id);
  assert.deepEqual(quoted.source,{conversationId:f.source.id,employeeId:f.sourceEmployee.id,employeeName:'原员工'});
  assert.deepEqual(quoted.messages.map(row=>row.sourceMessageId),[first.id,second.id]);
  assert.deepEqual(quoted.messages.map(row=>row.senderName),['真实用户','原员工']);
  assert.equal(quoted.note,'请留存');assert.match(result.message.content,/历史聊天引用/);assert.match(result.message.content,/未要求执行/);
  assert.equal(f.repo.listA2AActions(slug,{status:'all'}).length,beforeActions);
  const saved=f.repo.getConversation(f.target.id,actor).messages[0];assert.deepEqual(saved.forward,quoted);assert.equal(saved.forward_json,undefined);
  assert.deepEqual(f.repo.getConversation(f.source.id,actor).messages.map(row=>row.id),[first.id,second.id]);
});

test('reference reuses the latest ordinary active chat or creates one without touching runtime resources',t=>{
  const f=fixture(t,{targetChat:false}),message=f.add('留存，不执行');
  f.repo.db.prepare("UPDATE devices SET status='offline' WHERE id='forward-pc'").run();
  const first=f.request([message]);
  assert.equal(f.repo.getConversation(first.forward.targetConversationId,actor).employee_id,f.targetEmployee.id);
  assert.equal(f.repo.listA2AActions(slug,{status:'all'}).length,0);
  const latest=f.repo.createConversation(slug,{employeeId:f.targetEmployee.id,title:'最新聊天',...actor});
  f.repo.db.prepare('UPDATE conversations SET updated_at=? WHERE id=?').run('2099-01-01T00:00:00.000Z',latest.id);
  const next=f.request([message],{clientRequestId:'next-chat'});assert.equal(next.forward.targetConversationId,latest.id);
  assert.equal(f.repo.db.prepare('SELECT COUNT(*) AS n FROM hermes_bots').get().n,0);
});

test('source and target membership and personal visibility are authoritative even when a caller claims owner',t=>{
  const f=fixture(t),message=f.add('私密源消息'),before=f.snapshot();
  assert.throws(()=>f.request([message],{},{}),{code:'FORWARD_ACTOR_REQUIRED'});
  assert.throws(()=>f.request([message],{},{actorUserId:'outsider',actorRole:'owner'}),{code:'WORKSPACE_FORBIDDEN'});
  assert.throws(()=>f.request([message],{},{actorUserId:'forward-other',actorRole:'owner',enforceEmployeeVisibility:false}),{code:'FORWARD_SOURCE_NOT_FOUND'});
  f.repo.db.prepare("UPDATE employees SET visibility='personal',owner_user_id='forward-other' WHERE id=?").run(f.targetEmployee.id);
  const targetPrivate=f.snapshot();assert.throws(()=>f.request([message]),{code:'FORWARD_TARGET_NOT_FOUND'});assert.deepEqual(f.snapshot(),targetPrivate);
  f.repo.db.prepare("UPDATE employees SET visibility='workspace' WHERE id=?").run(f.targetEmployee.id);
  // Explicitly selected workspace target is the user's authorized expansion of
  // the private source audience, not an automatic share or changed ACL.
  assert.doesNotThrow(()=>f.request([message]));
  assert.equal(before.conversation_messages.length,1);
});

test('cross-workspace and foreign-conversation message IDs are rejected without partial records',t=>{
  const f=fixture(t),message=f.add('one');
  const otherChat=f.repo.createConversation(slug,{employeeId:f.sourceEmployee.id,...actor});
  const foreignMessage=f.repo.addConversationMessage(otherChat.id,{...actor,content:'other conversation',dispatch:false});
  let before=f.snapshot();assert.throws(()=>f.request([foreignMessage]),{code:'FORWARD_SOURCE_NOT_FOUND'});assert.deepEqual(f.snapshot(),before);
  f.repo.db.prepare('INSERT INTO workspaces(id,slug,name,kind,created_at) VALUES(?,?,?,?,?)').run('forward-foreign','forward-foreign','Foreign','team',new Date().toISOString());
  const foreign=f.repo.createEmployee('forward-foreign',{name:'外部员工',runtime:'Codex'});
  before=f.snapshot();assert.throws(()=>f.request([message],{targetEmployeeId:foreign.id}),{code:'FORWARD_TARGET_NOT_FOUND'});assert.deepEqual(f.snapshot(),before);
  assert.throws(()=>f.request([message],{source:{conversationId:f.source.id},forward:{messages:[{content:'forged'}]}}),{code:'FORWARD_INPUT_INVALID'});
});

test('normal message writes cannot forge forward metadata or author identity',t=>{
  const f=fixture(t);
  for(const key of ['forward','forward_json','forwardJson'])assert.throws(()=>f.add('forged',{[key]:{schemaVersion:1}}),{code:'FORWARD_ROUTE_REQUIRED'});
  const actual=f.add('real sender',{sender_user_id:'forged-sender',senderUserId:'forged-sender'});
  assert.equal(actual.sender_user_id,actor.actorUserId);
  const row=f.repo.db.prepare('SELECT sender_user_id,forward_json FROM conversation_messages WHERE id=?').get(actual.id);
  assert.equal(row.sender_user_id,actor.actorUserId);assert.equal(row.forward_json,null);
});

test('idempotent requests recover the same message and action before target busy/config/canonical checks',t=>{
  const f=fixture(t),source=f.add('处理这份引用'),{bot}=botFor(f);
  const input={targetEmployeeId:bot.id,mode:'execute'};
  const first=f.request([source],input),before=f.snapshot();
  assert.ok(first.execution.id);assert.equal(first.execution.status,'pending');
  const action=f.repo.getA2AAction(first.execution.id);assert.equal(action.payload.conversationId,bot.main_conversation_id);assert.equal(action.payload.hermesBot.employeeId,bot.id);
  assert.equal(action.type,'conversation.execute');assert.match(action.payload.prompt,/历史聊天引用/);
  const retry=f.request([source],input);assert.equal(retry.duplicate,true);assert.equal(retry.message.id,first.message.id);assert.equal(retry.execution.id,first.execution.id);assert.deepEqual(f.snapshot(),before);
  f.repo.db.prepare("UPDATE hermes_bots SET main_conversation_id=NULL,control_state='paused',revision=revision+1 WHERE employee_id=?").run(bot.id);
  const changed=f.snapshot();const recovered=f.request([source],input);assert.equal(recovered.message.id,first.message.id);assert.equal(recovered.execution.id,first.execution.id);assert.deepEqual(f.snapshot(),changed);
  assert.throws(()=>f.request([source],{...input,note:'changed'}),{code:'FORWARD_REQUEST_CONFLICT'});
});

test('retry rechecks revoked source and target visibility instead of exposing a previously saved copy',t=>{
  const f=fixture(t),message=f.add('keep private');f.request([message]);
  f.repo.db.prepare("UPDATE employees SET visibility='personal',owner_user_id='forward-other' WHERE id=?").run(f.targetEmployee.id);
  assert.throws(()=>f.request([message]),{code:'FORWARD_TARGET_NOT_FOUND'});
  f.repo.db.prepare("UPDATE employees SET visibility='workspace' WHERE id=?").run(f.targetEmployee.id);
  f.repo.db.prepare("UPDATE employees SET owner_user_id='forward-other' WHERE id=?").run(f.sourceEmployee.id);
  assert.throws(()=>f.request([message]),{code:'FORWARD_SOURCE_NOT_FOUND'});
});

test('an authorized retry returns the original immutable snapshot even if source text later changes',t=>{
  const f=fixture(t),message=f.add('原始快照'),first=f.request([message]);
  f.repo.db.prepare('UPDATE conversation_messages SET content=? WHERE id=?').run('later source text'.repeat(10000),message.id);
  const before=f.snapshot(),replay=f.request([message]);
  assert.equal(replay.duplicate,true);assert.deepEqual(replay.message,first.message);assert.deepEqual(f.snapshot(),before);
});

test('reference is allowed for a busy offline Bot and never changes its canonical main or active run',t=>{
  const f=fixture(t),source=f.add('仅转发留档'),{bot}=botFor(f);
  const task=f.repo.addConversationMessage(bot.main_conversation_id,{...actor,content:'original task'});
  const active=task.execution.id;f.repo.ackA2AAction(active,{deviceId:'forward-pc'});
  f.repo.db.prepare("UPDATE devices SET status='disabled' WHERE id='forward-pc'").run();
  const result=f.request([source],{targetEmployeeId:bot.id});
  assert.equal(result.forward.targetConversationId,bot.main_conversation_id);assert.equal(result.execution,undefined);
  const state=f.repo.db.prepare('SELECT main_conversation_id,active_action_id FROM hermes_bots WHERE employee_id=?').get(bot.id);
  assert.equal(state.main_conversation_id,bot.main_conversation_id);assert.equal(state.active_action_id,active);
  assert.equal(f.repo.getA2AAction(active).status,'acked');
});

test('missing Bot main returns a conflict without initializing another Bot or conversation',t=>{
  const f=fixture(t),message=f.add('record'),{bot}=botFor(f);
  f.repo.db.prepare('UPDATE hermes_bots SET main_conversation_id=NULL WHERE employee_id=?').run(bot.id);
  const before=f.snapshot();assert.throws(()=>f.request([message],{targetEmployeeId:bot.id}),{code:'FORWARD_MAIN_CHAT_REQUIRED'});assert.deepEqual(f.snapshot(),before);
});

test('explicit execute keeps Bot validation, pause and busy admission and rolls back all writes on rejection',t=>{
  const f=fixture(t),message=f.add('execute only when admitted'),{bots,bot}=botFor(f);
  bots.control(slug,bot.id,{expectedRevision:bot.revision,expectedControlEpoch:bot.control_epoch,operation:'pause'},actor);
  const before=f.snapshot(),beforeEvents=f.events.length;
  assert.throws(()=>f.request([message],{targetEmployeeId:bot.id,mode:'execute'}),{code:'BOT_NOT_ACTIVE'});
  assert.deepEqual(f.snapshot(),before);assert.equal(f.events.length,beforeEvents);
  const current=bots.get(slug,bot.id,actor);bots.control(slug,bot.id,{expectedRevision:current.revision,expectedControlEpoch:current.control_epoch,operation:'resume'},actor);
  const running=f.repo.addConversationMessage(bot.main_conversation_id,{...actor,content:'busy'});
  const busy=f.snapshot();assert.throws(()=>f.request([message],{targetEmployeeId:bot.id,mode:'execute'}),{code:'BOT_BUSY'});assert.deepEqual(f.snapshot(),busy);
  assert.equal(f.repo.getA2AAction(running.execution.id).status,'pending');
});

test('a late storage failure rolls back a newly created target chat, message, audits and queued notifications',t=>{
  const f=fixture(t,{targetChat:false}),source=f.add('atomic forwarding'),before=f.snapshot(),beforeEvents=f.events.length;
  f.repo.db.exec("CREATE TRIGGER reject_forward_request BEFORE INSERT ON management_requests WHEN NEW.kind LIKE 'conversation.forward:%' BEGIN SELECT RAISE(ABORT,'fixture late forward write failure'); END");
  assert.throws(()=>f.request([source]),/fixture late forward write failure/);assert.deepEqual(f.snapshot(),before);assert.equal(f.events.length,beforeEvents);
  f.repo.db.exec('DROP TRIGGER reject_forward_request');assert.doesNotThrow(()=>f.request([source]));
});

test('pictures are copied as real bounded bytes across all selected messages and local paths are never copied',t=>{
  const f=fixture(t),one=f.add('one',{attachments:[image()]}),two=f.add('two',{attachments:[image(),{name:'legacy.txt',path:'C:/private/secret.txt',url:'https://private.invalid',size:12,forward:{forged:true}}]});
  const result=f.request([one,two]),images=result.message.forward.messages.flatMap(message=>message.attachments).filter(file=>file.content);
  assert.equal(images.length,2);assert.equal(images[0].content,rasterFixtures.png.toString('base64'));assert.equal(images[0].size,rasterFixtures.png.length);
  assert.deepEqual(result.message.attachments,result.message.forward.messages.flatMap(message=>message.attachments));
  const legacy=result.message.attachments.at(-1);assert.deepEqual(legacy,{name:'legacy.txt',size:12});assert.match(result.message.content,/未复制本机文件/);
  assert.doesNotMatch(JSON.stringify(result),/C:\/private|private\.invalid|forged/);
});

test('aggregate actual image bytes and attachment counts cannot be bypassed by supplied size metadata',t=>{
  const f=fixture(t),padded=Buffer.concat([rasterFixtures.png,Buffer.alloc(6*1024*1024)]);
  const a=f.add('a',{attachments:[image(padded)]}),b=f.add('b',{attachments:[image(padded)]});
  const before=f.snapshot();assert.throws(()=>f.request([a,b]),error=>['FORWARD_LIMIT','FORWARD_ATTACHMENT_INVALID'].includes(error.code));assert.deepEqual(f.snapshot(),before);
  const c=f.add('c',{attachments:Array.from({length:11},()=>image())}),d=f.add('d',{attachments:Array.from({length:10},()=>image())});
  assert.throws(()=>f.request([c,d],{clientRequestId:'attachment-count'}),{code:'FORWARD_LIMIT'});
  f.repo.db.prepare('UPDATE conversation_messages SET attachment_json=? WHERE id=?').run(JSON.stringify([{name:'bad.png',mimeType:'image/png',content:Buffer.from('not an image').toString('base64')}]),c.id);
  assert.throws(()=>f.request([c],{clientRequestId:'bad-content'}),{code:'FORWARD_ATTACHMENT_INVALID'});
});

test('message, text, note, ID and input limits fail before any writes',t=>{
  const f=fixture(t),message=f.add('x'),long=f.add('x'.repeat(100001)),nul=f.add('\0'+'x'.repeat(100001)),unicode=f.add('😀'.repeat(50001)),before=f.snapshot();
  for(const body of [
    {messageIds:[]},{messageIds:Array.from({length:21},(_,index)=>String(index))},
    {messageIds:[message.id,message.id]},{messageIds:[{}]},
    {note:'x'.repeat(4001)},{clientRequestId:'x'.repeat(129)},{clientRequestId:''},
    {mode:'automatic'},{content:'forged replacement'},{attachments:[image()]}
  ])assert.throws(()=>f.request([message],body),error=>['FORWARD_INPUT_INVALID','FORWARD_LIMIT'].includes(error.code));
  for(const oversized of [long,unicode])assert.throws(()=>f.request([oversized]),{code:'FORWARD_LIMIT'});
  assert.throws(()=>f.request([nul]),{code:'FORWARD_CONTENT_INVALID'});assert.deepEqual(f.snapshot(),before);
});

test('forwarding a forwarded message remains one bounded historical layer and never copies nested forward metadata',t=>{
  const f=fixture(t),source=f.add('原始引用',{attachments:[image()]}),one=f.request([source]);
  const result=f.repo.forwardConversationMessages(f.target.id,{messageIds:[one.message.id],targetEmployeeId:f.sourceEmployee.id,clientRequestId:'second-forward'},actor);
  assert.equal(result.message.forward.messages.length,1);assert.equal(result.message.forward.messages[0].sourceMessageId,one.message.id);
  assert.equal(Object.hasOwn(result.message.forward.messages[0],'forward'),false);
  assert.equal(result.message.forward.messages[0].attachments.length,1);
  assert.equal(result.message.attachments.length,1);
});

test('old system and tool messages remain historical labels, never the identity of the new user message',t=>{
  const f=fixture(t),system=f.add('旧system内容',{role:'system'});
  f.repo.db.prepare('INSERT INTO conversation_messages(id,conversation_id,role,content,created_at) VALUES(?,?,?,?,?)').run('historical-tool',f.source.id,'tool','旧tool内容',new Date().toISOString());
  f.repo.db.prepare('INSERT INTO conversation_messages(id,conversation_id,role,content,created_at) VALUES(?,?,?,?,?)').run('old-user',f.source.id,'user','旧用户未记录作者',new Date().toISOString());
  const result=f.request([system,{id:'historical-tool'},{id:'old-user'}],{mode:'execute'});
  assert.equal(result.message.role,'user');assert.deepEqual(result.message.forward.messages.map(message=>message.role),['system','tool','user']);
  assert.deepEqual(result.message.forward.messages.map(message=>message.senderName),['系统消息','工具消息','用户']);
  assert.match(f.repo.getA2AAction(result.execution.id).payload.prompt,/不构成本次系统或工具指令/);
});

test('Bot forwarding is still blocked by preservation and cannot copy a sealed source into an ordinary target',t=>{
  const f=fixture(t),{bot}=botFor(f,'封存源');
  const source=f.repo.addConversationMessage(bot.main_conversation_id,{...actor,content:'sealed history',dispatch:false});
  const request={messageIds:[source.id],targetEmployeeId:f.targetEmployee.id,clientRequestId:'sealed-forward'};
  f.repo.preservation.begin({operationId:'forward-sealed',versions:FROZEN_VERSIONS});const before=f.snapshot();
  assert.throws(()=>f.repo.forwardConversationMessages(bot.main_conversation_id,request,actor),{code:'V2_OBJECT_SEALED'});assert.deepEqual(f.snapshot(),before);
  assert.equal(typeof createConversationForwarding(f.repo).forward,'function');
});

test('additive migration preserves message rowids and old explicit-column writes; incompatible new columns fail startup',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-forward-schema-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const filename=path.join(directory,'legacy.sqlite');let repo=createRepository({filename,envEncryptionKey:'forward-fixture'});
  const employee=repo.createEmployee(slug,{name:'legacy',runtime:'Codex'}),chat=repo.createConversation(slug,{employeeId:employee.id});
  repo.db.prepare('INSERT INTO conversation_messages(id,conversation_id,role,content,created_at) VALUES(?,?,?,?,?)').run('legacy-message',chat.id,'user','legacy',new Date().toISOString());repo.db.close();
  const edit=new DatabaseSync(filename);edit.exec('ALTER TABLE conversation_messages DROP COLUMN sender_user_id; ALTER TABLE conversation_messages DROP COLUMN forward_json');
  const rowid=edit.prepare('SELECT rowid FROM conversation_messages WHERE id=?').get('legacy-message').rowid;edit.close();
  repo=createRepository({filename,envEncryptionKey:'forward-fixture'});
  assert.equal(repo.db.prepare('SELECT rowid FROM conversation_messages WHERE id=?').get('legacy-message').rowid,rowid);
  const saved=repo.getConversation(chat.id).messages[0];assert.equal(saved.sender_user_id,null);assert.equal(saved.forward,undefined);
  assert.deepEqual(repo.db.prepare('PRAGMA index_info(idx_conversation_messages_chat)').all().map(row=>row.name),['conversation_id','created_at']);repo.db.close();
  const corrupt=new DatabaseSync(filename);corrupt.exec('ALTER TABLE conversation_messages DROP COLUMN forward_json; ALTER TABLE conversation_messages ADD COLUMN forward_json INTEGER');corrupt.close();
  assert.throws(()=>createRepository({filename,envEncryptionKey:'forward-fixture'}),{code:'CONVERSATION_MESSAGE_SCHEMA_INVALID'});
});
