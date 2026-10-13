import test from 'node:test';
import assert from 'node:assert/strict';
import {createRepository} from '../backend/repository.mjs';
import {createManagementService} from '../backend/management.mjs';
import {completeOwnedProfile} from '../test-support/owned-profile.mjs';
import {executionBinding} from '../src/execution-admission.mjs';
import {createPreservation} from '../backend/version-preservation.mjs';

function fixture(t) {
  const repo=createRepository({memory:true}); t.after(()=>repo.db.close());
  repo.heartbeatDevice('test-111',{deviceId:'rollback-pc',runtimes:{Hermes:{status:'available',profiles:[{name:'default'}],models:[{id:'fixture'}]}}});
  const bots=createManagementService(repo).bots;
  const bot=bots.create('test-111',{name:'Retained Bot',targetDeviceId:'rollback-pc',runtimeProfile:'default',model:'fixture',idempotencyKey:'retained'});
  completeOwnedProfile(repo,bot);
  const legacy=repo.createEmployee('test-111',{name:'Ordinary employee',runtime:'Codex'});
  return {repo,bots,bot,legacy};
}
const versions={v1:'2ebe3dfee2f438a0b6aa3045d46c83bb67d7341b',v1Client:'324731e79c6a855fad1f501379630bbfa67e5d34',v2:'5643d5d36c3cd85d74ab849c77f52b6f69555093'};

test('preservation exposes durable planning without mutating product records',t=>{
  const f=fixture(t), before=JSON.stringify(f.repo.db.prepare('SELECT * FROM hermes_bots').all());
  assert.equal(typeof f.repo.preservation?.inspect,'function');
  const report=f.repo.preservation.inspect();
  assert.equal(report.state,'v2'); assert.equal(report.bots.length,1);
  assert.equal(JSON.stringify(f.repo.db.prepare('SELECT * FROM hermes_bots').all()),before);
});
test('original ACKed result-delivery receipt during prepare never renews its lease',t=>{
 const f=fixture(t),original=f.repo.getA2AAction(f.bot.instance.provisioning.actionId);f.repo.preservation.begin({operationId:'receipt-only',versions});
 const complete=f.repo.ackA2AAction(original.id,{deviceId:'rollback-pc',receiptOnly:true,renewLease:true});assert.equal(complete.status,'succeeded');
 const ordinary=f.repo.createA2AAction('test-111',{type:'runtime.execute',payload:{deviceId:'rollback-pc',runtime:'Codex'}});assert.equal(ordinary.status,'pending');
 assert.throws(()=>f.repo.ackA2AAction('missing',{deviceId:'rollback-pc',receiptOnly:true}));
});

test('preparing freezes trusted Bot routes and identity changes while legacy employee remains usable',t=>{
  const f=fixture(t);
  assert.equal(typeof f.repo.preservation?.begin,'function');
  f.repo.preservation.begin({operationId:'freeze-one',versions});
  const count=f.repo.db.prepare('SELECT COUNT(*) n FROM tasks').get().n;
  for(const execute of [
    ()=>f.repo.createTask('test-111',{title:'blocked',employeeId:f.bot.id,execute:true}),
    ()=>f.repo.addConversationMessage(f.bot.main_conversation_id,{content:'blocked',dispatch:false}),
    ()=>f.repo.createConversation('test-111',{employeeId:f.bot.id}),
    ()=>f.repo.updateEmployee(f.bot.id,{runtime:'Codex',runtimeProfile:null}),
    ()=>f.repo.deleteEmployee(f.bot.id),
    ()=>f.repo.createA2AAction('test-111',{type:'runtime.execute',payload:{conversationId:f.bot.main_conversation_id,profile:'default'}}),
    ()=>f.repo.createA2AAction('test-111',{type:'runtime.execute',payload:{profile:f.bot.instance.profile}})
  ]) assert.throws(execute,{code:'V2_OBJECT_SEALED'});
  assert.equal(f.repo.db.prepare('SELECT COUNT(*) n FROM tasks').get().n,count);
  assert.throws(()=>createManagementService(f.repo).createTask('test-111',{title:'blocked MCP',employeeId:f.bot.id,execute:true,idempotencyKey:'blocked-mcp'}),{code:'V2_OBJECT_SEALED'});
  const task=f.repo.createTask('test-111',{title:'legacy permitted',employeeId:f.legacy.id,execute:true});
  assert.ok(task.id); assert.equal(f.repo.preservation.inspect().state,'preparing');
});

test('pending original actions reject seal without expiry or half-switch',async t=>{
  const f=fixture(t);
  assert.equal(typeof f.repo.preservation?.seal,'function');
  const pending=f.bots.validate('test-111',f.bot.id,{expectedRevision:1,idempotencyKey:'pending-original'}).action;
  f.repo.preservation.begin({operationId:'pending-case',versions});
  await assert.rejects(()=>f.repo.preservation.seal({operationId:'pending-case'}),{code:'ROLLBACK_NOT_DRAINED'});
  assert.equal(f.repo.getA2AAction(pending.id).status,'pending');
  assert.equal(f.repo.preservation.inspect().state,'preparing');
  assert.equal(f.repo.preservation.begin({operationId:'pending-case',versions}).operationId,'pending-case');
  assert.throws(()=>f.repo.preservation.begin({operationId:'different',versions}),{code:'ROLLBACK_OPERATION_CONFLICT'});
});

test('prepare blocks new Bot initialization and all direct Bot configuration writes',t=>{
  const f=fixture(t);f.repo.preservation.begin({operationId:'configuration-case',versions});
  assert.throws(()=>f.bots.create('test-111',{name:'No new bot',targetDeviceId:'rollback-pc',runtimeProfile:'default',model:'fixture',idempotencyKey:'new'}),{code:'V2_OBJECT_SEALED'});
  assert.throws(()=>f.bots.initialize('test-111',f.legacy.id,{idempotencyKey:'initialize'}),{code:'V2_OBJECT_SEALED'});
  assert.throws(()=>f.bots.update('test-111',f.bot.id,{expectedRevision:1,employee:{name:'changed'}}),{code:'V2_OBJECT_SEALED'});
});

test('poll and history reads do not expire frozen original actions',t=>{
  const f=fixture(t);const action=f.bots.validate('test-111',f.bot.id,{expectedRevision:1,idempotencyKey:'expiry'}).action;
  f.repo.db.prepare("UPDATE a2a_actions SET expires_at='2000-01-01',type='conversation.execute' WHERE id=?").run(action.id);
  f.repo.preservation.begin({operationId:'expiry-case',versions});
  assert.equal(f.repo.listA2AActions('test-111',{includeAcked:true}).some(row=>row.id===action.id),false);
  f.repo.getConversation(f.bot.main_conversation_id);
  assert.equal(f.repo.getA2AAction(action.id).status,'pending');
});

test('database fence also rejects raw writes from another service after preparation',t=>{
  const f=fixture(t);f.repo.preservation.begin({operationId:'raw-service',versions});
  assert.throws(()=>f.repo.db.prepare('DELETE FROM employees WHERE id=?').run(f.bot.id),/V2_OBJECT_SEALED/);
  assert.throws(()=>f.repo.db.prepare("UPDATE employees SET runtime='Codex' WHERE id=?").run(f.bot.id),/V2_OBJECT_SEALED/);
  assert.equal(f.repo.db.prepare('SELECT employee_id FROM hermes_bots WHERE employee_id=?').get(f.bot.id).employee_id,f.bot.id);
});

test('native execution admission compares original identity and never trusts stripped payload',t=>{
  const f=fixture(t),action=f.repo.createA2AAction('test-111',{type:'runtime.execute',payload:{employeeId:f.legacy.id,runtime:'Codex',deviceId:'rollback-pc',prompt:'fixture'}});
  f.repo.ackA2AAction(action.id,{deviceId:'rollback-pc'});
  assert.equal(typeof f.repo.authorizeActionExecution,'function');
  const permit=f.repo.authorizeActionExecution(action.id,{deviceId:'rollback-pc'});assert.equal(permit.allowed,true);assert.ok(permit.executionBinding);
  assert.throws(()=>f.repo.authorizeActionExecution(action.id,{deviceId:'other'}),{code:'EXECUTION_DEVICE_MISMATCH'});
  f.repo.preservation.begin({operationId:'native-admission',versions});
  assert.throws(()=>f.repo.authorizeActionExecution(f.bot.instance.provisioning.actionId,{deviceId:'rollback-pc'}),{code:'V2_OBJECT_SEALED'});
});

test('execution binding changes for aliases, HOME, model and full Bot settings',()=>{
  const action={id:'original',type:'runtime.execute',payload:{runtime:'Hermes',prompt:'original'}};
  for(const patch of [{runtimeProfile:'bot-owned'},{env:{HERMES_HOME:'owned-home'}},{model:'changed'},{prompt:'changed'},{hermesBot:{employeeId:'one',revision:1,config:{maxTurns:99},instance:{profile:'bot-owned'}}}])assert.notEqual(executionBinding(action),executionBinding({...action,payload:{...action.payload,...patch}}));
});

test('frozen opaque V2 origin cannot authorize ordinary-looking child action',t=>{
  const f=fixture(t),action=f.bots.validate('test-111',f.bot.id,{expectedRevision:1,idempotencyKey:'opaque-origin'}).action;
  f.repo.preservation.begin({operationId:'opaque-child',versions});
  // Simulate a pre-existing opaque V2 source rather than mutate sealed data.
  const source={id:'opaque',type:'hermes.bot.native',payload:{}};
  assert.equal(f.repo.preservation.classifyAction(source).isV2,true);
  assert.throws(()=>f.repo.createA2AAction('test-111',{type:'runtime.execute',payload:{collaboration:{sourceActionId:'missing-original'},runtime:'Codex'}}),{code:'V2_OBJECT_SEALED'});
  assert.throws(()=>f.repo.db.prepare("UPDATE a2a_actions SET payload_json='{}',status='acked' WHERE id=?").run(action.id),/V2_OBJECT_SEALED/);
});

test('original ACKed completion settles during prepare but user writes stay sealed',t=>{
  const f=fixture(t),validation=f.bots.validate('test-111',f.bot.id,{expectedRevision:1,idempotencyKey:'completion-validation'}).action;
  const processExit={launched:true,rootPid:1,rootConfirmed:true,rootExitCode:0,treeConfirmed:true,activeProcesses:0};
  f.repo.ackA2AAction(validation.id,{deviceId:'rollback-pc'});f.repo.resultA2AAction(validation.id,{deviceId:'rollback-pc',status:'succeeded',result:{botValidation:{valid:true,schemaVersion:1,employeeId:f.bot.id,revision:1},processExit}});
  f.bots.control('test-111',f.bot.id,{expectedRevision:1,expectedControlEpoch:1,operation:'activate'});
  const message=f.repo.addConversationMessage(f.bot.main_conversation_id,{content:'already started'}),actionId=message.execution.id;
  f.repo.ackA2AAction(actionId,{deviceId:'rollback-pc'});f.repo.preservation.begin({operationId:'completion-settlement',versions});
  const before=f.repo.db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(actionId),receipt=f.repo.ackA2AAction(actionId,{deviceId:'rollback-pc',receiptOnly:true,renewLease:true});assert.equal(receipt.deliveryOnly,true);assert.equal(receipt.leaseRenewed,false);assert.deepEqual(f.repo.db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(actionId),before);assert.throws(()=>f.repo.ackA2AAction(actionId,{deviceId:'rollback-pc',renewLease:true}),{code:'V2_OBJECT_SEALED'});
  assert.throws(()=>f.repo.resultA2AAction(actionId,{deviceId:'wrong',status:'succeeded',result:{output:'forged',processExit}}),/another device|设备/);
  const result=f.repo.resultA2AAction(actionId,{deviceId:'rollback-pc',status:'succeeded',result:{output:'retained original answer',processExit}});assert.equal(result.status,'succeeded');
  assert.ok(f.repo.getConversation(f.bot.main_conversation_id).messages.some(row=>row.content==='retained original answer'));
  assert.throws(()=>f.repo.addConversationMessage(f.bot.main_conversation_id,{role:'assistant',content:'fake completion',dispatch:false}),{code:'V2_OBJECT_SEALED'});
  assert.equal(f.repo.resultA2AAction(actionId,{deviceId:'rollback-pc',status:'succeeded',result:{output:'different'}}).duplicate,true);
});

test('harmless legacy skill removal succeeds; protected dependency removal is atomic',t=>{
  const f=fixture(t);f.repo.db.prepare('UPDATE employees SET skills_json=? WHERE id=?').run(JSON.stringify(['skill-code']),f.bot.id);f.repo.db.prepare('UPDATE employees SET skills_json=? WHERE id=?').run(JSON.stringify(['skill-browser','skill-code']),f.legacy.id);
  f.repo.preservation.begin({operationId:'skill-removal',versions});
  assert.equal(f.repo.setSkillInstalled('skill-browser',false).installed,false);
  const before=JSON.stringify(f.repo.db.prepare('SELECT * FROM skills WHERE id=?').get('skill-code')),employees=JSON.stringify(f.repo.db.prepare('SELECT * FROM employees').all());
  assert.throws(()=>f.repo.setSkillInstalled('skill-code',false),{code:'V2_OBJECT_SEALED'});
  assert.equal(JSON.stringify(f.repo.db.prepare('SELECT * FROM skills WHERE id=?').get('skill-code')),before);assert.equal(JSON.stringify(f.repo.db.prepare('SELECT * FROM employees').all()),employees);
});
test('raw services cannot replace transition history; a missing original Bot refuses seal',async t=>{
 const f=fixture(t);f.repo.preservation.begin({operationId:'private-transition',versions});assert.throws(()=>f.repo.db.exec("UPDATE version_preservation SET state='restored'"),/ROLLBACK_TRANSITION_PRIVATE/);assert.throws(()=>f.repo.db.exec('DELETE FROM version_preservation_events'),/ROLLBACK_TRANSITION_PRIVATE/);
 for(const row of f.repo.db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='hermes_bots'").all())f.repo.db.exec('DROP TRIGGER '+row.name);f.repo.db.prepare('DELETE FROM hermes_bots WHERE employee_id=?').run(f.bot.id);
 assert.ok(f.repo.preservation.inspect().issues.some(row=>row.code==='BOT_IDENTITY_MISSING'));await assert.rejects(f.repo.preservation.seal({operationId:'private-transition'}),{code:'ROLLBACK_NOT_DRAINED'});assert.equal(f.repo.preservation.inspect().state,'preparing');
});
test('restoration checks employee device and runtime identity, leaving a corrupt snapshot sealed',async t=>{
 const f=fixture(t),guard=createPreservation(f.repo.db,{collectNativeEvidence:async()=>({safe:true,issues:[],files:[]})});guard.begin({operationId:'restore-identity',versions});await guard.seal({operationId:'restore-identity'});
 for(const row of f.repo.db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='employees'").all())f.repo.db.exec('DROP TRIGGER '+row.name);f.repo.db.prepare("UPDATE employees SET runtime='Codex' WHERE id=?").run(f.bot.id);
 assert.throws(()=>guard.restore({operationId:'restore-identity'}),{code:'ROLLBACK_IDENTITY_CHANGED'});assert.equal(guard.inspect().state,'sealed');
});
