import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../backend/app.mjs';
import { createRepository } from '../backend/repository.mjs';
import { createManagementService } from '../backend/management.mjs';
import { completeOwnedProfile } from '../test-support/owned-profile.mjs';
import { createActionScheduler } from '../src/daemon-action-scheduler.mjs';
import { FROZEN_VERSIONS } from '../backend/version-preservation.mjs';

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

function executingBot(t) {
  const state=fixture(t),{repo}=state,bots=createManagementService(repo).bots;
  let bot=bots.create(slug,{name:'Busy directory Bot',targetDeviceId:'directory-pc',runtimeProfile:'default',model:'test-model',visibility:'personal',idempotencyKey:'busy-directory-bot'},member);
  completeOwnedProfile(repo,bot);
  const validation=bots.validate(slug,bot.id,{expectedRevision:bot.revision,idempotencyKey:'busy-directory-validation'},member).action;
  repo.ackA2AAction(validation.id,{deviceId:'directory-pc'});
  repo.resultA2AAction(validation.id,{deviceId:'directory-pc',status:'succeeded',result:{botValidation:{valid:true,schemaVersion:1,employeeId:bot.id,revision:bot.revision}}});
  bot=bots.control(slug,bot.id,{expectedRevision:bot.revision,expectedControlEpoch:bot.control_epoch,operation:'activate'},member);
  const message=repo.addConversationMessage(bot.main_conversation_id,{...member,content:'Keep this original test task in flight'});
  const active=repo.getA2AAction(message.execution.id);
  repo.ackA2AAction(active.id,{deviceId:'directory-pc'});
  const input={...member,expectedRevision:bot.revision,expectedControlEpoch:bot.control_epoch,path:'C:/Work',createIfMissing:false,idempotencyKey:'busy-directory-read'};
  const activeId=()=>repo.db.prepare('SELECT active_action_id FROM hermes_bots WHERE employee_id=?').get(bot.id).active_action_id;
  return {...state,bots,bot,active,input,activeId};
}

test('busy Bot read-only inspection passes create, ACK, admission, before-execute and original receipt without taking its run slot',t=>{
  const {repo,bot,active,input,activeId}=executingBot(t);
  const conversationBefore=repo.getConversation(bot.main_conversation_id,member);
  const action=repo.createConversationDirectoryAction(bot.main_conversation_id,input);
  assert.equal(action.type,'directory.inspect');assert.equal(action.payload.createIfMissing,false);
  assert.equal(action.payload.employeeId,undefined);
  assert.equal(action.payload.inspectionEmployeeId,bot.id);
  assert.equal(action.payload.hermesBot.employeeId,bot.id);
  assert.equal(action.payload.conversationId,bot.main_conversation_id);
  assert.equal(activeId(),active.id);
  assert.equal(repo.preservation.classifyAction(repo.getA2AAction(action.id)).isV2,true);
  assert.equal(repo.ackA2AAction(action.id,{deviceId:'directory-pc'}).status,'acked');
  const permit=repo.authorizeActionExecution(action.id,{deviceId:'directory-pc'});
  assert.equal(permit.allowed,true);assert.ok(permit.executionBinding);
  assert.equal(repo.authorizeBotStart(action.id,{deviceId:'directory-pc'}).allowed,true);
  assert.throws(()=>repo.authorizeActionExecution(action.id,{deviceId:'foreign-device'}),{code:'EXECUTION_DEVICE_MISMATCH'});
  assert.throws(()=>repo.resultA2AAction(action.id,{deviceId:'foreign-device',status:'succeeded',result:{}}),/device/i);
  repo.resultA2AAction(action.id,{deviceId:'directory-pc',status:'succeeded',result:{path:'C:/Work',exists:true,isDirectory:true,children:[]}});
  assert.equal(repo.getConversationDirectoryAction(bot.main_conversation_id,action.id,member).status,'succeeded');
  assert.equal(repo.getConversationDirectoryAction(bot.main_conversation_id,action.id,stranger),null);
  const other=repo.createConversation(slug,{employeeId:bot.id,...member});
  assert.equal(repo.getConversationDirectoryAction(other.id,action.id,member),null);
  assert.equal(activeId(),active.id);assert.equal(repo.getA2AAction(active.id).status,'acked');
  assert.equal(repo.getConversation(bot.main_conversation_id,member).working_directory,conversationBefore.working_directory);
  assert.equal(repo.getEmployee(bot.id).default_working_directory,null);
  assert.throws(()=>repo.createA2AAction(slug,{type:'runtime.execute',payload:{employeeId:bot.id,prompt:'must stay blocked'}}),{code:'BOT_BUSY'});
});

test('read-only directory payload can run beside the original employee on the installed client scheduler',async t=>{
  const {repo,bot,active,input,activeId}=executingBot(t);
  const inspection=repo.createConversationDirectoryAction(bot.main_conversation_id,input);
  let release;const hold=new Promise(resolve=>{release=resolve;});t.after(()=>release());
  const calls=[],scheduler=createActionScheduler({concurrency:3,execute:async action=>{calls.push(action.id);if(action.id===active.id)await hold;}});
  assert.deepEqual(scheduler.schedule([active]),[active.id]);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(scheduler.schedule([inspection]),[inspection.id]);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,[active.id,inspection.id]);assert.equal(activeId(),active.id);
  release();await scheduler.whenIdle();
});

test('busy Bot still rejects actual directory changes and create requests while unchanged saves remain allowed',t=>{
  const {repo,bot,active,input,activeId}=executingBot(t);
  const current=repo.getConversation(bot.main_conversation_id,member).working_directory;
  assert.doesNotThrow(()=>repo.updateConversationSettings(bot.main_conversation_id,{...member,workingDirectory:current}));
  assert.doesNotThrow(()=>repo.updateEmployee(bot.id,{defaultWorkingDirectory:null},{...member,botConfigurationWrite:true}));
  assert.throws(()=>repo.updateConversationSettings(bot.main_conversation_id,{...member,workingDirectory:'C:/Changed'}),{code:'BOT_BUSY'});
  for(const value of [true,'true','yes',1])
    assert.throws(()=>repo.createConversationDirectoryAction(bot.main_conversation_id,{...input,createIfMissing:value,idempotencyKey:'create-'+value}),{code:'BOT_BUSY'});
  assert.throws(()=>repo.createConversationDirectoryAction(bot.main_conversation_id,{...input,createIfMissing:undefined,create_if_missing:true,idempotencyKey:'create-alias'}),{code:'BOT_BUSY'});
  assert.throws(()=>repo.createA2AAction(slug,{type:'directory.inspect',payload:{conversationId:bot.main_conversation_id,deviceId:'directory-pc',createIfMissing:false,readOnlyInspection:true}}),{code:'BOT_DIRECTORY_ROUTE_REQUIRED'});
  const receipt=repo.createConversationDirectoryAction(bot.main_conversation_id,input);
  repo.ackA2AAction(receipt.id,{deviceId:'directory-pc'});
  repo.resultA2AAction(receipt.id,{deviceId:'directory-pc',status:'succeeded',result:{path:'C:/Work',exists:true,isDirectory:true}});
  assert.throws(()=>repo.updateEmployee(bot.id,{defaultWorkingDirectory:'C:/Work',defaultWorkingDirectoryActionId:receipt.id},{...member,botConfigurationWrite:true}),{code:'BOT_BUSY'});
  assert.equal(repo.getEmployee(bot.id).default_working_directory,null);assert.equal(activeId(),active.id);
});

for(const column of ['revision','control_epoch'])test(`read-only inspection rejects stale ${column} at create, ACK and execution admission`,t=>{
  const {repo,bot,input,active,activeId}=executingBot(t);
  assert.throws(()=>repo.createConversationDirectoryAction(bot.main_conversation_id,{...input,[column==='revision'?'expectedRevision':'expectedControlEpoch']:0}),{code:'BOT_REVISION_CONFLICT'});
  const pending=repo.createConversationDirectoryAction(bot.main_conversation_id,input);
  const acked=repo.createConversationDirectoryAction(bot.main_conversation_id,{...input,idempotencyKey:'already-acked'});
  repo.ackA2AAction(acked.id,{deviceId:'directory-pc'});
  repo.db.prepare(`UPDATE hermes_bots SET ${column}=${column}+1 WHERE employee_id=?`).run(bot.id);
  assert.throws(()=>repo.ackA2AAction(pending.id,{deviceId:'directory-pc'}),{code:'BOT_REVISION_CONFLICT'});
  assert.throws(()=>repo.authorizeActionExecution(acked.id,{deviceId:'directory-pc'}),{code:'BOT_REVISION_CONFLICT'});
  assert.throws(()=>repo.authorizeBotStart(acked.id,{deviceId:'directory-pc'}),{code:'BOT_REVISION_CONFLICT'});
  assert.equal(activeId(),active.id);assert.equal(repo.getA2AAction(pending.id).status,'pending');
});

for(const [label,patch,type] of [
  ['true-create',{createIfMissing:true}],['string-create',{createIfMissing:'true'}],
  ['legacy-create-alias',{create_if_missing:true}],['other-inspection-employee',{inspectionEmployeeId:'another-employee'}],
  ['serial-employee-injection',{employeeId:'another-employee'}],['foreign-bot-snapshot',{hermesBot:{employeeId:'another-employee'}}],
  ['different-action-type',{},'runtime.execute']
])test(`inspection marker cannot bypass busy or identity checks after ${label} tampering`,t=>{
  const {repo,bot,input,activeId,active}=executingBot(t);
  const action=repo.createConversationDirectoryAction(bot.main_conversation_id,input);
  repo.ackA2AAction(action.id,{deviceId:'directory-pc'});
  const payload={...repo.getA2AAction(action.id).payload,...patch};
  repo.db.prepare('UPDATE a2a_actions SET type=?,payload_json=? WHERE id=?').run(type||action.type,JSON.stringify(payload),action.id);
  assert.throws(()=>repo.authorizeActionExecution(action.id,{deviceId:'directory-pc'}),{code:'BOT_BINDING_CONFLICT'});
  assert.equal(activeId(),active.id);
});

test('read-only directory inspection remains a sealed Bot action for preservation guards',t=>{
  const {repo,bot,input}=executingBot(t);
  const action=repo.createConversationDirectoryAction(bot.main_conversation_id,input);
  repo.ackA2AAction(action.id,{deviceId:'directory-pc'});
  repo.preservation.begin({operationId:'directory-read-sealed',versions:FROZEN_VERSIONS});
  assert.throws(()=>repo.authorizeActionExecution(action.id,{deviceId:'directory-pc'}),{code:'V2_OBJECT_SEALED'});
  assert.throws(()=>repo.authorizeBotStart(action.id,{deviceId:'directory-pc'}),{code:'V2_OBJECT_SEALED'});
});

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
