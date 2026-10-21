import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../backend/repository.mjs';
import { createManagementService } from '../backend/management.mjs';
import {completeOwnedProfile} from '../test-support/owned-profile.mjs';

test('ordinary Hermes conversation carries only its own bounded prior turns into execution', () => {
  const repo = createRepository({ memory: true });
  try {
    const employee = repo.createEmployee('test-111', { name:'Bot continuity',runtime:'Hermes',runtimeProfile:'default' });
    const conversation = repo.createConversation('test-111', { employeeId:employee.id });
    const other = repo.createConversation('test-111', { employeeId:employee.id });
    repo.addConversationMessage(other.id, { content:'OTHER-CONVERSATION-PRIVATE',dispatch:false });
    repo.addConversationMessage(conversation.id, { content:'The project marker is AZURE-42',dispatch:false });
    repo.addConversationMessage(conversation.id, { content:'I recorded the marker',role:'assistant',dispatch:false });
    const message = repo.addConversationMessage(conversation.id, { content:'What was the marker?' });
    const action = repo.getA2AAction(message.execution.id);
    assert.match(action.payload.prompt, /AZURE-42/);
    assert.match(action.payload.prompt, /I recorded the marker/);
    assert.doesNotMatch(action.payload.prompt, /OTHER-CONVERSATION-PRIVATE/);
  } finally { repo.db.close(); }
});

function fixture() {
  const repo=createRepository({memory:true}),management=createManagementService(repo);
  repo.heartbeatDevice('test-111',{deviceId:'bot-pc',runtimes:{Hermes:{status:'available',version:'0.21.3',profiles:[{name:'default'}],models:[{id:'test-model'}]}}});
  const input={name:'独立岗位',runtimeProfile:'default',targetDeviceId:'bot-pc',model:'test-model',persona:'保留项目证据',idempotencyKey:'create-one'};
  return {repo,management,bots:management.bots,input};
}
function activate(f,bot) {
  completeOwnedProfile(f.repo,bot);
  const {action}=f.bots.validate('test-111',bot.id,{expectedRevision:bot.revision,idempotencyKey:`validate-${bot.revision}`});
  f.repo.ackA2AAction(action.id,{deviceId:'bot-pc'});
  f.repo.resultA2AAction(action.id,{status:'succeeded',result:{botValidation:{valid:true,schemaVersion:1,employeeId:bot.id,revision:bot.revision,sourceProfile:'default',nativeVersion:'0.21.3'}}});
  return f.bots.control('test-111',bot.id,{expectedRevision:bot.revision,expectedControlEpoch:1,operation:'activate'});
}

test('Bot create is idempotent, supports multiple independent instances, and deleted intent cannot revive',()=>{
  const f=fixture();try {
    const one=f.bots.create('test-111',f.input), same=f.bots.create('test-111',f.input);
    assert.throws(()=>f.bots.create('test-111',{...f.input,idempotencyKey:'bad-owner',owner_user_id:'forged-owner'}),{code:'BOT_CREATE_UNSUPPORTED'});
    assert.equal(same.id,one.id);assert.equal(same.duplicate,true);assert.equal(one.control_state,'draft');
    const two=f.bots.create('test-111',{...f.input,idempotencyKey:'create-two'});
    assert.notEqual(one.id,two.id);assert.notEqual(one.main_conversation_id,two.main_conversation_id);
    completeOwnedProfile(f.repo,one);
    f.repo.deleteEmployee(one.id);
    assert.throws(()=>f.bots.create('test-111',f.input),{code:'IDEMPOTENCY_RESOURCE_GONE'});
  } finally {f.repo.db.close();}
});

test('Bot activation, paused and raw execution routes share the same gate and trusted config',()=>{
  const f=fixture();try {
    let bot=f.bots.create('test-111',f.input);
    assert.throws(()=>f.repo.addConversationMessage(bot.main_conversation_id,{content:'not yet'}),{code:'BOT_PROFILE_NOT_PROVISIONED'});
    completeOwnedProfile(f.repo,bot);
    assert.throws(()=>f.bots.control('test-111',bot.id,{expectedRevision:1,expectedControlEpoch:1,operation:'activate'}),{code:'BOT_NOT_VALIDATED'});
    bot=activate(f,bot);
    const message=f.repo.addConversationMessage(bot.main_conversation_id,{content:'first',clientMessageId:'first'});
    const action=f.repo.getA2AAction(message.execution.id);
    assert.equal(action.payload.hermesBot.employeeId,bot.id);assert.equal(action.payload.hermesBot.config.maxTurns,20);
    assert.equal(action.payload.model,'test-model');assert.equal(action.payload.profile,bot.instance.profile);assert.equal(action.payload.deviceId,'bot-pc');
    assert.throws(()=>f.repo.createA2AAction('test-111',{type:'runtime.execute',payload:{employeeId:bot.id,prompt:'bypass'}}),{code:'BOT_BUSY'});
    f.repo.resultA2AAction(action.id,{status:'succeeded',result:{output:'first answer'}});
    f.bots.control('test-111',bot.id,{expectedRevision:1,expectedControlEpoch:2,operation:'pause'});
    assert.throws(()=>f.repo.createA2AAction('test-111',{type:'runtime.execute',payload:{employeeId:bot.id,prompt:'bypass'}}),{code:'BOT_NOT_ACTIVE'});
    assert.equal(f.repo.getConversation(bot.main_conversation_id).messages.filter(item=>item.content==='not yet').length,0);
  } finally {f.repo.db.close();}
});

test('Bot Routine retains unknown business receipt while failure finalization awaits the original computer',()=>{
  const f=fixture();try {
    const bot=activate(f,f.bots.create('test-111',f.input));
    const routine=f.bots.createRoutine('test-111',bot.id,{name:'daily',prompt:'report',schedule:'每天 9:00',timezone:'Asia/Shanghai',idempotencyKey:'routine'});
    const run=f.bots.runRoutine('test-111',bot.id,routine.id,{idempotencyKey:'run'});
    const action=f.repo.getA2AAction(run.action_id);
    assert.equal(action.payload.employeeId,bot.id);assert.equal(action.payload.conversationId,bot.main_conversation_id);assert.equal(action.payload.hermesBot.revision,1);
    f.repo.ackA2AAction(action.id,{deviceId:'bot-pc'});
    f.repo.resultA2AAction(action.id,{status:'failed',error:'not confirmed',result:{code:'EXECUTION_UNCERTAIN',executionState:'uncertain'}});
    assert.equal(f.repo.listAutomationRuns(routine.id)[0].status,'failed');
    assert.equal(f.repo.getA2AAction(action.id).failureFinalization.state,'awaiting_client');
    assert.throws(()=>f.repo.queueAutomationRetry(run.id),{code:'BOT_RETRY_FORBIDDEN'});
    assert.throws(()=>f.repo.runAutomation(routine.id),{code:'BOT_FAILURE_FINALIZATION_PENDING'});
    assert.equal(f.repo.getConversation(bot.main_conversation_id).messages.filter(item=>item.role==='assistant').length,1);
  } finally {f.repo.db.close();}
});

test('Bot service is a workspace scoped management capability', () => {
  const repo = createRepository({ memory:true });
  try { assert.equal(typeof createManagementService(repo).bots, 'object'); }
  finally { repo.db.close(); }
});

test('paused Bot accepts original device results while rejecting new starts and stale control',()=>{
  const f=fixture();try{
    const bot=activate(f,f.bots.create('test-111',f.input));
    const msg=f.repo.addConversationMessage(bot.main_conversation_id,{content:'running'});const action=f.repo.getA2AAction(msg.execution.id);
    f.repo.ackA2AAction(action.id,{deviceId:'bot-pc'});
    f.bots.control('test-111',bot.id,{expectedRevision:1,expectedControlEpoch:2,operation:'pause'});
    assert.throws(()=>f.repo.authorizeBotStart(action.id,{deviceId:'bot-pc'}),{code:'BOT_REVISION_CONFLICT'});
    assert.throws(()=>f.bots.control('test-111',bot.id,{expectedRevision:1,expectedControlEpoch:1,operation:'activate'}),{code:'BOT_CONTROL_CONFLICT'});
    assert.equal(f.repo.ackA2AAction(action.id,{deviceId:'bot-pc',renewLease:true}).leaseRenewed,true);
    f.repo.resultA2AAction(action.id,{deviceId:'bot-pc',status:'succeeded',result:{output:'completed before pause'}});
    assert.equal(f.repo.getConversation(bot.main_conversation_id).messages.filter(item=>item.content==='completed before pause').length,1);
  }finally{f.repo.db.close();}
});

test('Bot identity cannot be hidden behind ordinary employee, missing employee, or foreign workspace',()=>{
  const f=fixture();try{
    const bot=f.bots.create('test-111',f.input),other=f.repo.createEmployee('test-111',{name:'ordinary'});
    completeOwnedProfile(f.repo,bot);
    assert.throws(()=>f.repo.createA2AAction('test-111',{type:'conversation.execute',payload:{employeeId:other.id,conversationId:bot.main_conversation_id,prompt:'bypass'}}),{code:'BOT_BINDING_CONFLICT'});
    assert.throws(()=>f.repo.createA2AAction('test-111',{type:'conversation.execute',payload:{conversationId:bot.main_conversation_id,prompt:'bypass'}}),{code:'BOT_NOT_ACTIVE'});
    const routine=f.bots.createRoutine('test-111',bot.id,{name:'routine',prompt:'work',schedule:'每小时',idempotencyKey:'routine'});
    assert.throws(()=>f.repo.createA2AAction('test-111',{type:'automation.execute',payload:{automationId:routine.id,prompt:'bypass'}}),{code:'BOT_RUN_BINDING_CONFLICT'});
    assert.throws(()=>f.bots.get('test-111',bot.id,{actorUserId:'unrelated-user',actorRole:'owner'}),{code:'WORKSPACE_FORBIDDEN'});
  }finally{f.repo.db.close();}
});

test('Bot deletion leaves a non-executable routine tombstone and stable create intent',()=>{
  const f=fixture();try{
    const bot=activate(f,f.bots.create('test-111',f.input));const routine=f.bots.createRoutine('test-111',bot.id,{name:'daily',prompt:'work',schedule:'每小时',idempotencyKey:'routine'});
    f.repo.deleteEmployee(bot.id);
    assert.equal(f.repo.getAutomationById(routine.id).status,'paused');
    assert.throws(()=>f.repo.runAutomation(routine.id),{code:'BOT_NOT_FOUND'});
    f.repo.updateAutomation(routine.id,{status:'active'});
    assert.throws(()=>f.repo.runAutomation(routine.id),{code:'BOT_NOT_FOUND'});
  }finally{f.repo.db.close();}
});

test('display changes retain activation; execution changes require revalidation; migration aliases rejected',()=>{
  const f=fixture();try{
    const bot=activate(f,f.bots.create('test-111',f.input));
    const display=f.bots.update('test-111',bot.id,{expectedRevision:1,employee:{name:'New display',avatar:'A',description:'New display description'}});
    assert.equal(display.revision,1);assert.equal(display.control_state,'active');assert.equal(display.validation.status,'succeeded');
    for(const key of ['runtime_profile','runtimeProfile','profile','target_device_id','targetDeviceId','deviceId'])assert.throws(()=>f.bots.update('test-111',bot.id,{expectedRevision:1,employee:{[key]:null}}),{code:'BOT_PATCH_UNSUPPORTED'});
    const changed=f.bots.update('test-111',bot.id,{expectedRevision:1,config:{maxTurns:8}});
    assert.equal(changed.revision,2);assert.equal(changed.control_state,'draft');assert.equal(changed.validation.status,'stale');
  }finally{f.repo.db.close();}
});

test('team employee and Bot views share one identity and state through both editing and initialization',()=>{
  const f=fixture();try {
    const created=f.bots.create('test-111',f.input);
    assert.equal(f.repo.getEmployee(created.id).status,'draft');
    const enabled=activate(f,created);assert.equal(f.repo.getEmployee(enabled.id).status,'active');
    f.management.updateEmployee('test-111',enabled.id,{name:'Team changed name'});
    assert.equal(f.bots.get('test-111',enabled.id).employee.name,'Team changed name');assert.equal(f.bots.get('test-111',enabled.id).control_state,'active');
    f.management.updateEmployee('test-111',enabled.id,{status:'paused'});assert.equal(f.bots.get('test-111',enabled.id).control_state,'paused');
    const ordinary=f.management.createEmployee('test-111',{name:'Existing Hermes',runtime:'Hermes',targetDeviceId:'bot-pc',runtimeProfile:'default',idempotencyKey:'ordinary'});
    const existingChat=f.repo.createConversation('test-111',{employeeId:ordinary.id});f.repo.addConversationMessage(existingChat.id,{content:'Existing conversation preserved',dispatch:false});
    const before=f.repo.listEmployees('test-111').length;
    assert.equal(f.bots.get('test-111',ordinary.id).configuration_state,'uninitialized');
    const attached=f.bots.initialize('test-111',ordinary.id,{idempotencyKey:'initialize'});
    const duplicate=f.bots.initialize('test-111',ordinary.id,{idempotencyKey:'initialize'});
    assert.equal(attached.id,ordinary.id);assert.equal(attached.main_conversation_id,existingChat.id);assert.equal(duplicate.id,ordinary.id);assert.equal(f.repo.listEmployees('test-111').length,before);
    assert.equal(f.repo.getConversation(existingChat.id).messages[0].content,'Existing conversation preserved');
    assert.ok(f.bots.list('test-111').some(bot=>bot.id===ordinary.id));
  } finally {f.repo.db.close();}
});

test('existing employee initialization preserves uncertain execution quarantine',()=>{
  for(const state of ['uncertain','expired']) {
    const f=fixture();try {
      const employee=f.management.createEmployee('test-111',{name:'Existing',runtime:'Hermes',targetDeviceId:'bot-pc',runtimeProfile:'default',idempotencyKey:'existing'});
      const action=f.repo.createA2AAction('test-111',{type:'runtime.execute',payload:{employeeId:employee.id,runtime:'Hermes',deviceId:'bot-pc',prompt:'work'}});
      f.repo.ackA2AAction(action.id,{deviceId:'bot-pc'});
      if(state==='uncertain')f.repo.resultA2AAction(action.id,{status:'failed',error:'not confirmed',result:{code:'EXECUTION_UNCERTAIN',executionState:'uncertain'}});
      else f.repo.db.prepare("UPDATE a2a_actions SET status='expired' WHERE id=?").run(action.id);
      assert.throws(()=>f.bots.initialize('test-111',employee.id,{idempotencyKey:'init'}),{code:'BOT_BUSY'});
      assert.equal(f.repo.db.prepare('SELECT COUNT(*) AS n FROM hermes_bots WHERE employee_id=?').get(employee.id).n,0);
    } finally {f.repo.db.close();}
  }
});

test('old employee state route cannot give a stale activation request the latest control epoch',()=>{
  const f=fixture();try {
    const bot=activate(f,f.bots.create('test-111',f.input));
    f.management.updateEmployee('test-111',bot.id,{status:'paused'});
    assert.throws(()=>f.management.updateEmployee('test-111',bot.id,{status:'active',expectedRevision:1,expectedControlEpoch:1}),{code:'BOT_CONTROL_CONFLICT'});
    assert.throws(()=>f.management.updateEmployee('test-111',bot.id,{status:'active'}),{code:'BOT_CONTROL_CONFLICT'});
    assert.equal(f.bots.get('test-111',bot.id).control_state,'paused');
    const current=f.bots.get('test-111',bot.id);f.management.updateEmployee('test-111',bot.id,{status:'active',expectedRevision:current.revision,expectedControlEpoch:current.control_epoch});
    assert.equal(f.bots.get('test-111',bot.id).control_state,'active');
  } finally {f.repo.db.close();}
});
