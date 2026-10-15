import test from 'node:test';
import assert from 'node:assert/strict';
import {createRepository} from '../backend/repository.mjs';
import {createManagementService} from '../backend/management.mjs';
import {completeOwnedProfile} from '../test-support/owned-profile.mjs';

const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6gAAAABJRU5ErkJggg==';
const image=()=>({name:'task-result.png',mimeType:'image/png',contentEncoding:'base64',content:png});
function fixture(t){
  const repo=createRepository({memory:true,envEncryptionKey:'task-conversation-fixture-only'});t.after(()=>repo.db.close());
  const management=createManagementService(repo),bots=management.bots;
  const heartbeat=profiles=>repo.heartbeatDevice('test-111',{deviceId:'task-bot-pc',runtimes:{Hermes:{status:'available',version:'0.21.3',profiles:profiles.map(name=>({name,provider_configured:true,authentication_configured:true}))}}});
  heartbeat(['default']);let bot=bots.create('test-111',{name:'Task image Bot',sourceProfile:'default',targetDeviceId:'task-bot-pc',idempotencyKey:'task-image-bot'});
  completeOwnedProfile(repo,bot);heartbeat(['default',bot.instance.profile]);
  const {action}=bots.validate('test-111',bot.id,{expectedRevision:bot.revision,idempotencyKey:'validate-task-bot'});repo.ackA2AAction(action.id,{deviceId:'task-bot-pc'});repo.resultA2AAction(action.id,{deviceId:'task-bot-pc',status:'succeeded',result:{botValidation:{schemaVersion:1,valid:true,employeeId:bot.id,revision:bot.revision}}});
  bot=bots.control('test-111',bot.id,{expectedRevision:bot.revision,expectedControlEpoch:bot.control_epoch,operation:'activate'});
  const task=(key,extra={})=>management.createTask('test-111',{title:key,description:'Return an image',employeeId:bot.id,execute:true,idempotencyKey:key,...extra});
  const snapshot=()=>Object.fromEntries(['tasks','a2a_actions','conversation_messages','management_requests'].map(table=>[table,repo.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  return{repo,management,bot,task,snapshot};
}

test('Bot task without an explicit conversation binds its authoritative main conversation and returns images there once',t=>{
  const f=fixture(t),created=f.task('implicit-main'),action=f.repo.getA2AAction(created.execution.id);
  assert.equal(action.type,'task.execute');assert.equal(action.payload.conversationId,f.bot.main_conversation_id);assert.equal(action.payload.hermesBot.conversationId,f.bot.main_conversation_id);assert.equal(action.payload.employeeId,f.bot.id);
  f.repo.ackA2AAction(action.id,{deviceId:'task-bot-pc'});
  const completed=f.repo.resultA2AAction(action.id,{deviceId:'task-bot-pc',status:'succeeded',result:{output:'Task image returned',outputArtifacts:[image()]}});assert.equal(completed.status,'succeeded');
  const history=f.repo.getConversation(f.bot.main_conversation_id);assert.equal(history.messages.length,1);assert.equal(history.messages[0].role,'assistant');assert.equal(history.messages[0].attachments[0].content,png);
  assert.equal(history.execution.id,action.id);assert.equal(history.execution.payload.conversationId,f.bot.main_conversation_id);
  const before=f.snapshot();assert.equal(f.task('implicit-main').id,created.id);assert.equal(f.repo.resultA2AAction(action.id,{deviceId:'task-bot-pc',status:'succeeded',result:{outputArtifacts:[image()]}}).duplicate,true);assert.deepEqual(f.snapshot(),before);
});

test('an explicit conversation belonging to the same Bot remains authoritative, including its input alias',t=>{
  const f=fixture(t),conversation=f.repo.createConversation('test-111',{employeeId:f.bot.id,title:'Explicit task thread'}),created=f.task('explicit-thread',{conversation_id:conversation.id}),action=f.repo.getA2AAction(created.execution.id);
  assert.equal(action.payload.conversationId,conversation.id);assert.equal(action.payload.hermesBot.conversationId,conversation.id);
  const result=f.repo.resultA2AAction(action.id,{status:'succeeded',result:{outputArtifacts:[image()]}});assert.equal(result.status,'succeeded');assert.equal(f.repo.getConversation(conversation.id).messages[0].attachments[0].content,png);assert.equal(f.repo.getConversation(f.bot.main_conversation_id).messages.length,0);
});

test('foreign employee or workspace conversations and an invalid Bot main are rejected before any task or dispatch write',t=>{
  const f=fixture(t),other=f.repo.createEmployee('test-111',{name:'Other employee',runtime:'Hermes'}),otherConversation=f.repo.createConversation('test-111',{employeeId:other.id});
  f.repo.db.prepare('INSERT INTO workspaces(id,slug,name,kind,plan,timezone,created_at) VALUES(?,?,?,?,?,?,?)').run('task-image-other','task-image-other','Other workspace','team','free','Asia/Shanghai',new Date().toISOString());
  const outside=f.repo.createEmployee('task-image-other',{name:'Outside employee',runtime:'Hermes'}),outsideConversation=f.repo.createConversation('task-image-other',{employeeId:outside.id});
  for(const conversation of [otherConversation,outsideConversation]){const before=f.snapshot();assert.throws(()=>f.task('foreign-'+conversation.id,{conversationId:conversation.id}),/会话与当前员工或工作区不一致/);assert.deepEqual(f.snapshot(),before);}
  for(const main of [otherConversation.id,outsideConversation.id,null]){
    f.repo.db.prepare('UPDATE hermes_bots SET main_conversation_id=? WHERE employee_id=?').run(main,f.bot.id);const before=f.snapshot();assert.throws(()=>f.task('invalid-main-'+String(main)),error=>error.code==='BOT_CONVERSATION_CONFLICT'||/会话与当前员工或工作区不一致/.test(error.message));assert.deepEqual(f.snapshot(),before);
  }
});

test('ordinary non-Bot tasks retain their missing-conversation behavior and cannot attach images to a nearby Bot chat',t=>{
  const f=fixture(t),employee=f.repo.createEmployee('test-111',{name:'Ordinary Hermes worker',runtime:'Hermes',runtimeProfile:'default',targetDeviceId:'task-bot-pc'}),conversation=f.repo.createConversation('test-111',{employeeId:employee.id}),created=f.management.createTask('test-111',{title:'ordinary-no-thread',employeeId:employee.id,execute:true,idempotencyKey:'ordinary-no-thread'}),action=f.repo.getA2AAction(created.execution.id);
  assert.equal(action.payload.conversationId,undefined);assert.equal(action.payload.hermesBot,undefined);
  const result=f.repo.resultA2AAction(action.id,{status:'succeeded',result:{outputArtifacts:[image()]}});assert.equal(result.status,'failed');assert.match(result.error,/图片回传缺少当前执行绑定的持久会话/);
  assert.equal(f.repo.getConversation(conversation.id).messages.length,0);assert.equal(f.repo.getConversation(f.bot.main_conversation_id).messages.length,0);
});
