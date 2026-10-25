import test from 'node:test';
import assert from 'node:assert/strict';
import {createBotAutonomyService} from '../backend/bot-autonomy.mjs';
const binding={workspace:'ws',employeeId:'employee_one',revision:3,controlEpoch:4};
function fixture(){let calls=[];let bot={revision:3,control_epoch:4,control_state:'active',config:{permissions:{mode:'execute'},toolsets:['file'],mcpServers:{},collaboration:{enabled:false}}};const action={id:'action_one',status:'acked',workspace_id:'ws-id',payload:{employeeId:'employee_one',deviceId:'pc',profile:'bot-one',hermesBot:binding}};const repo={deviceAction:()=>action};const bots={get:()=>bot,routines:()=>[{id:'routine_one',status:'paused'}],createRoutine:(...args)=>{calls.push(args);return{id:'routine_new',executor:'ziwei_bot'};},update:(...args)=>{calls.push(args);return{deferredConfig:{state:'queued'}};}};return{service:createBotAutonomyService(repo,{bots}),calls,bot,action,credential:{deviceId:'pc',workspaceId:'ws-id'}};}
test('scoped autonomous calls bind device, active action and current version',()=>{
 const f=fixture();assert.deepEqual(f.service.dispatch('action_one',{operation:'routines'},f.credential),{scheduler:'ziwei',routines:[{id:'routine_one',status:'paused'}]});
 for(const change of [f=>f.credential.deviceId='other',f=>f.action.status='succeeded',f=>f.bot.revision++,f=>f.bot.control_epoch++,f=>f.bot.control_state='paused',f=>f.credential.workspaceId='other']){
  const g=fixture();change(g);assert.throws(()=>g.service.dispatch('action_one',{operation:'routines'},g.credential),{code:'BOT_AUTONOMY_BINDING_CHANGED'});
 }
 assert.throws(()=>f.service.dispatch('action_one',{operation:'routines',employeeId:'employee_other'},f.credential),{code:'BOT_AUTONOMY_INPUT_INVALID'});
});
test('autonomous configuration only narrows existing grants and queues after current turn',()=>{const f=fixture();f.service.dispatch('action_one',{operation:'configure',idempotencyKey:'one',input:{toolsets:[]}},f.credential);assert.equal(f.calls[0][2].deferUntilIdle,true);assert.throws(()=>f.service.dispatch('action_one',{operation:'configure',idempotencyKey:'two',input:{toolsets:['terminal']}},f.credential),{code:'BOT_AUTONOMY_USER_GRANT_REQUIRED'});assert.throws(()=>f.service.dispatch('action_one',{operation:'configure',idempotencyKey:'three',input:{permissions:{mode:'execute'}}},f.credential),{code:'BOT_AUTONOMY_USER_GRANT_REQUIRED'});});
test('read_only and management denial cannot create work',()=>{for(const permissions of [{mode:'read_only'},{mode:'execute',management:false}]){const f=fixture();f.bot.config.permissions=permissions;assert.throws(()=>f.service.dispatch('action_one',{operation:'createRoutine',idempotencyKey:'one',input:{name:'fixture',prompt:'fixture',schedule:'0 0 * * *'}},f.credential),{code:'BOT_PERMISSION_CONFLICT'});assert.equal(f.calls.length,0);}});
import {createRepository} from '../backend/repository.mjs';
import {createManagementService} from '../backend/management.mjs';
import {completeOwnedProfile} from '../test-support/owned-profile.mjs';
test('real repository creates one platform routine and isolates another employee',t=>{
 const repo=createRepository({memory:true});t.after(()=>repo.db.close());
 repo.heartbeatDevice('test-111',{deviceId:'autonomy-pc',runtimes:{Hermes:{status:'available',version:'0.21.3',profiles:[{name:'default',provider_configured:true,authentication_configured:true}]}}});
 const bots=createManagementService(repo).bots;let bot=bots.create('test-111',{name:'Autonomy fixture',targetDeviceId:'autonomy-pc',sourceProfile:'default',model:'fixture',idempotencyKey:'self-create'});completeOwnedProfile(repo,bot);
 const validation=bots.validate('test-111',bot.id,{expectedRevision:1,idempotencyKey:'validation'}).action;
 repo.ackA2AAction(validation.id,{deviceId:'autonomy-pc'});repo.resultA2AAction(validation.id,{status:'succeeded',result:{botValidation:{schemaVersion:1,valid:true,employeeId:bot.id,revision:1}}});
 bot=bots.control('test-111',bot.id,{expectedRevision:1,expectedControlEpoch:1,operation:'activate'});
 const message=repo.addConversationMessage(bot.main_conversation_id,{content:'synthetic work',clientMessageId:'self-chat'});
 const action=repo.getA2AAction(message.execution.id);repo.ackA2AAction(action.id,{deviceId:'autonomy-pc'});
 const service=createBotAutonomyService(repo,{bots}),credential={deviceId:'autonomy-pc',workspaceId:repo.db.prepare('SELECT workspace_id FROM a2a_actions WHERE id=?').get(action.id).workspace_id},input={operation:'createRoutine',idempotencyKey:'routine',input:{name:'synthetic routine',prompt:'fixture only',schedule:'每天 9:00',timezone:'Asia/Shanghai'}};
 const first=service.dispatch(action.id,input,credential),replay=service.dispatch(action.id,input,credential);assert.equal(first.id,replay.id);assert.equal(first.authority,'ziwei');assert.equal(first.employee_id,bot.id);
 assert.equal(repo.db.prepare('SELECT count(*) n FROM bot_routines WHERE employee_id=?').get(bot.id).n,1);
 const other=bots.create('test-111',{name:'Untouched peer',targetDeviceId:'autonomy-pc',sourceProfile:'default',idempotencyKey:'peer-create'});
 assert.equal(repo.db.prepare('SELECT count(*) n FROM bot_routines WHERE employee_id=?').get(other.id).n,0);
 service.dispatch(action.id,{operation:'pauseRoutine',routineId:first.id,idempotencyKey:'pause'},credential);
 assert.equal(bots.routines('test-111',bot.id)[0].status,'paused');
 assert.throws(()=>service.dispatch(action.id,{operation:'resumeRoutine',routineId:first.id,idempotencyKey:'resume'},credential),{code:'BOT_AUTONOMY_OPERATION_PENDING'});
});
