import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../backend/app.mjs';
import { createRepository } from '../backend/repository.mjs';
import { createManagementService } from '../backend/management.mjs';
import { completeOwnedProfile } from '../test-support/owned-profile.mjs';

const slug='test-111';
const owner={actorUserId:'directory-owner',actorRole:'owner',enforceEmployeeVisibility:true};
const member={...owner,actorRole:'member'};
const stranger={...member,actorUserId:'directory-stranger'};

function fixture(t,{app=false}={}) {
  const application=app?createApp({memory:true,enableScheduler:false}):null;
  const repo=application?.locals.repo||createRepository({memory:true});
  t.after(()=>repo.db.close());
  const workspace=repo.db.prepare('SELECT * FROM workspaces WHERE slug=?').get(slug);
  repo.db.prepare("UPDATE workspaces SET kind='team' WHERE id=?").run(workspace.id);
  repo.db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run('directory-member',workspace.id,member.actorUserId,'Directory owner','directory@example.test','member',new Date().toISOString());
  repo.heartbeatDevice(slug,{deviceId:'directory-pc',runtimes:{Hermes:{status:'available',version:'0.21.3',profiles:[{name:'default'}],models:[{id:'test-model'}]}}});
  const employee=repo.createEmployee(slug,{name:'Directory employee',runtime:'Hermes',runtimeProfile:'default',targetDeviceId:'directory-pc',visibility:'personal',ownerUserId:member.actorUserId});
  const conversation=repo.createConversation(slug,{employeeId:employee.id,...member});
  return {repo,application,workspace,employee,conversation};
}

function preventHistoryReads(t,repo) {
  t.mock.method(repo,'getConversation',()=>assert.fail('Directory access must not materialize conversation history'));
  const prepare=repo.db.prepare.bind(repo.db);
  t.mock.method(repo.db,'prepare',sql=>{
    assert.doesNotMatch(sql,/SELECT[\s\S]*FROM conversation_messages|payload_json LIKE/i,'Directory access must not scan history/execution payloads');
    return prepare(sql);
  });
}

function invokeRoute(app,method,path,request) {
  const route=app.router.stack.find(layer=>layer.route?.path===path&&layer.route.methods[method]).route;
  let status=200,body;
  const response={status(value){status=value;return this;},json(value){body=value;return this;}};
  route.stack.at(-1).handle(request,response,error=>{throw error;});
  return {status,body};
}

test('directory authorization matches conversation visibility without loading messages or images',t=>{
  const {repo,employee,conversation,workspace}=fixture(t);
  const unassigned=repo.createConversation(slug,{});
  for(const context of [member,stranger,owner,{...stranger,actorRole:'admin'},{}]) {
    assert.equal(Boolean(repo.getConversationAccess(conversation.id,context)),Boolean(repo.getConversation(conversation.id,context)));
    assert.equal(Boolean(repo.getConversationAccess(unassigned.id,context)),Boolean(repo.getConversation(unassigned.id,context)));
  }
  const visible=repo.getConversationAccess(conversation.id,member);
  assert.deepEqual({...visible},{id:conversation.id,workspace_id:workspace.id,employee_id:employee.id,device_id:'directory-pc'});
  preventHistoryReads(t,repo);
  assert.ok(repo.getConversationAccess(conversation.id,member));
  assert.equal(repo.getConversationAccess(conversation.id,stranger),null);
  assert.equal(repo.getConversationAccess('missing',owner),null);
  repo.db.prepare("UPDATE employees SET status='deleted' WHERE id=?").run(employee.id);
  assert.equal(repo.getConversationAccess(conversation.id,owner),null);
});

test('directory inspect and receipt routes keep actor visibility and use lightweight access',t=>{
  const {repo,application,conversation}=fixture(t,{app:true});
  repo.addConversationMessage(conversation.id,{content:'Long history is irrelevant to directory access',dispatch:false});
  preventHistoryReads(t,repo);
  const request={params:{id:conversation.id},body:{path:'C:/Work',idempotencyKey:'directory-request'},auth:{user_id:member.actorUserId},workspaceRole:'member'};
  const created=invokeRoute(application,'post','/api/conversations/:id/workdir/inspect',request);
  assert.equal(created.status,202);
  assert.equal(created.body.action.payload.path,'C:/Work');
  assert.equal(created.body.action.payload.userId,member.actorUserId);
  const readRequest={...request,params:{id:conversation.id,actionId:created.body.action.id}};
  const receipt=invokeRoute(application,'get','/api/conversations/:id/workdir/actions/:actionId',readRequest);
  assert.equal(receipt.status,200);assert.equal(receipt.body.action.id,created.body.action.id);
  for(const [method,path,req] of [['post','/api/conversations/:id/workdir/inspect',request],['get','/api/conversations/:id/workdir/actions/:actionId',readRequest]]) {
    const denied=invokeRoute(application,method,path,{...req,auth:{user_id:stranger.actorUserId}});
    assert.equal(denied.status,404);assert.deepEqual(denied.body,{error:'Conversation not found'});
  }
});

test('directory receipts retain conversation/workspace/action-actor checks and create retains device checks',t=>{
  const {repo,employee,conversation,workspace}=fixture(t);
  const action=repo.createConversationDirectoryAction(conversation.id,{...member,path:'C:/Work',idempotencyKey:'original'});
  const other=repo.createConversation(slug,{employeeId:employee.id,...member});
  preventHistoryReads(t,repo);
  assert.equal(repo.getConversationDirectoryAction(other.id,action.id,member),null);
  assert.equal(repo.getConversationDirectoryAction(conversation.id,action.id,stranger),null);
  assert.throws(()=>repo.getConversationDirectoryAction(conversation.id,action.id,{...stranger,actorRole:'admin'}),/无权查看/);
  repo.db.prepare('INSERT INTO workspaces(id,slug,name,kind,created_at) VALUES(?,?,?,?,?)').run('foreign-ws','directory-foreign','Foreign','team',new Date().toISOString());
  const foreign=repo.createA2AAction('directory-foreign',{type:'directory.inspect',payload:{conversationId:conversation.id,userId:member.actorUserId}});
  assert.throws(()=>repo.getConversationDirectoryAction(conversation.id,foreign.id,member),/不属于当前工作区/);
  assert.throws(()=>repo.createConversationDirectoryAction(conversation.id,{...member,deviceId:'foreign-device'}),/目标设备不属于/);
  assert.throws(()=>repo.createConversationDirectoryAction(conversation.id,{...stranger,enforceEmployeeVisibility:false}),/无权检查该设备/);
  repo.db.prepare("UPDATE workspaces SET kind='personal' WHERE id=?").run(workspace.id);
  assert.throws(()=>repo.createConversationDirectoryAction(conversation.id,member),/无权检查该设备/);
  repo.db.prepare("UPDATE devices SET status='disabled' WHERE id='directory-pc'").run();
  assert.throws(()=>repo.createConversationDirectoryAction(conversation.id,owner),/已停用/);
});

test('Bot directory inspection keeps configuration version and bound-device checks',t=>{
  const {repo}=fixture(t);
  const bots=createManagementService(repo).bots;
  const bot=bots.create(slug,{name:'Bot directory',targetDeviceId:'directory-pc',runtimeProfile:'default',model:'test-model',idempotencyKey:'directory-bot'});
  completeOwnedProfile(repo,bot);
  const input={...owner,expectedRevision:bot.revision,expectedControlEpoch:bot.control_epoch,idempotencyKey:'bound-directory'};
  preventHistoryReads(t,repo);
  assert.throws(()=>repo.createConversationDirectoryAction(bot.main_conversation_id,{...input,expectedRevision:0}),{code:'BOT_REVISION_CONFLICT'});
  repo.heartbeatDevice(slug,{deviceId:'directory-other',runtimes:{Hermes:{status:'available'}}});
  assert.throws(()=>repo.createConversationDirectoryAction(bot.main_conversation_id,{...input,deviceId:'directory-other'}),{code:'BOT_BINDING_CONFLICT'});
  const action=repo.createConversationDirectoryAction(bot.main_conversation_id,input);
  assert.equal(action.payload.deviceId,'directory-pc');
  assert.equal(repo.getConversationDirectoryAction(bot.main_conversation_id,action.id,owner).id,action.id);
});

test('Bot runs materialize only the newest 100 exact workspace and employee matches',t=>{
  const {repo,workspace}=fixture(t);
  const bots=createManagementService(repo).bots;
  const bot=bots.create(slug,{name:'Runs query',targetDeviceId:'directory-pc',runtimeProfile:'default',model:'test-model',idempotencyKey:'runs-bot'});
  const insert=repo.db.prepare('INSERT INTO a2a_actions(id,workspace_id,agent_id,type,payload_json,dedupe_key,status,created_at,result_json) VALUES(?,?,?,?,?,?,?,?,?)');
  const padding='x'.repeat(8192),expected=[];
  for(let index=0;index<125;index++) {
    const actionId=`matching-${index}`,payload={hermesBot:{employeeId:bot.id},padding};
    insert.run(actionId,workspace.id,'ziwei_user','conversation.execute',JSON.stringify(payload),actionId,'succeeded','2099-01-01T00:00:00.000Z',JSON.stringify({output:`result-${index}`}));
    expected.unshift(actionId);
    insert.run(`unrelated-${index}`,workspace.id,'ziwei_user','conversation.execute',JSON.stringify({hermesBot:{employeeId:`other-${index}`},prompt:bot.id,padding}),`unrelated-${index}`,'succeeded','2099-01-02T00:00:00.000Z','{}');
  }
  for(const [index,payload] of ['not-json',JSON.stringify({employeeId:bot.id}),JSON.stringify({hermesBot:{employeeId:[bot.id]}}),'null'].entries())
    insert.run(`nonmatching-${index}`,workspace.id,'ziwei_user','conversation.execute',payload,`nonmatching-${index}`,'succeeded','2099-01-03T00:00:00.000Z','{}');
  repo.db.prepare('INSERT INTO workspaces(id,slug,name,kind,created_at) VALUES(?,?,?,?,?)').run('foreign-runs','runs-foreign','Foreign runs','team',new Date().toISOString());
  insert.run('foreign-match','foreign-runs','ziwei_user','conversation.execute',JSON.stringify({hermesBot:{employeeId:bot.id},padding}),'foreign-match','succeeded','2099-01-04T00:00:00.000Z','{}');
  const prepare=repo.db.prepare.bind(repo.db),selected=[];
  t.mock.method(repo.db,'prepare',sql=>{
    const statement=prepare(sql);
    if(/SELECT[\s\S]*FROM a2a_actions WHERE workspace_id=\?/i.test(sql)) {
      const all=statement.all.bind(statement);
      statement.all=(...args)=>{const rows=all(...args);selected.push(rows);return rows;};
    }
    return statement;
  });
  const results=bots.runs(slug,bot.id);
  assert.deepEqual(results.map(action=>action.id),expected.slice(0,100));
  assert.equal(results[0].result.output,'result-124');
  assert.equal(results[0].payload.padding,padding);
  assert.equal(selected.length,1);assert.equal(selected[0].length,100);
  assert.ok(selected[0].every(row=>Object.keys(row).join(',')==='id'),'Unrelated payload bytes must stay out of JavaScript result rows');
  assert.throws(()=>bots.runs(slug,bot.id,{actorUserId:'outsider'}),{code:'WORKSPACE_FORBIDDEN'});
  assert.throws(()=>bots.runs(slug,bot.id,{deviceCredentialDeviceId:'different-pc',deviceScope:'different-pc'}),{code:'BOT_NOT_FOUND'});
  assert.throws(()=>bots.runs('runs-foreign',bot.id),{code:'EMPLOYEE_NOT_FOUND'});
});
