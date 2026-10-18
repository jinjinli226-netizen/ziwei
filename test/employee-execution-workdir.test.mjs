import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRepository} from '../backend/repository.mjs';
import {createManagementService} from '../backend/management.mjs';
import {completeOwnedProfile} from '../test-support/owned-profile.mjs';
import {BOT_INTERNAL} from '../backend/bots.mjs';

const SLUG='test-111',actor={actorUserId:'workdir-owner',actorRole:'owner'};
function fixture(t) {
  const repo=createRepository({memory:true,envEncryptionKey:'execution-workdir-fixture'}),management=createManagementService(repo);
  t.after(()=>repo.db.close());
  for(const deviceId of ['workdir-pc-a','workdir-pc-b'])repo.heartbeatDevice(SLUG,{deviceId,ownerUserId:actor.actorUserId,workdir:'C:\\Users\\fixture',runtimes:{Codex:{status:'available',readiness:{authentication:'configured',provider:'configured'}},Hermes:{status:'available',profiles:[{name:'default'}],readiness:{authentication:'configured',provider:'configured'}}}});
  const receipt=(directory,deviceId='workdir-pc-a')=>{
    const action=repo.createDeviceDirectoryAction(SLUG,deviceId,{path:directory},actor);
    repo.resultA2AAction(action.id,{deviceId,status:'succeeded',result:{path:directory,exists:true,isDirectory:true}});
    return action.id;
  };
  const employee=(runtime='Codex',directory='D:\\AIUSE')=>repo.createEmployee(SLUG,{name:crypto.randomUUID(),runtime,targetDeviceId:'workdir-pc-a',...(runtime==='Hermes'?{runtimeProfile:'default'}:{}),...(directory?{defaultWorkingDirectory:directory,defaultWorkingDirectoryActionId:receipt(directory)}:{})},actor);
  const task=(employee,extra={})=>{
    const created=repo.createTask(SLUG,{title:'Read actual cwd',employeeId:employee.id,execute:true,...extra});
    return repo.listTasks(SLUG).find(row=>row.id===created.id).execution;
  };
  const snapshot=()=>Object.fromEntries(['tasks','a2a_actions','audit_events','notifications'].map(table=>[table,repo.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  return {repo,management,receipt,employee,task,snapshot};
}

for(const runtime of ['Codex','Hermes'])test(`Creator task dispatch inherits ${runtime} employee default instead of the computer launch directory`,t=>{
  const f=fixture(t),directory=runtime==='Codex'?'D:\\AIUSE':'D:\\AIUSE\\life-assistant',employee=f.employee(runtime,directory);
  const conversation=f.repo.createConversation(SLUG,{employeeId:employee.id});assert.equal(conversation.working_directory,directory);
  const created=f.management.createTask(SLUG,{title:'Creator cwd check',employeeId:employee.id,execute:true,idempotencyKey:'creator-cwd-'+runtime},actor);
  const action=f.repo.getA2AAction(created.execution.id);
  assert.equal(action.type,'task.execute');assert.equal(action.payload.cwd,directory);assert.equal(action.payload.deviceId,'workdir-pc-a');
  assert.equal(action.payload.conversationId,undefined,'an ordinary task need not invent a conversation to inherit its employee directory');
  assert.equal(f.management.createTask(SLUG,{title:'Creator cwd check',employeeId:employee.id,execute:true,idempotencyKey:'creator-cwd-'+runtime},actor).execution.id,action.id);
});

test('task directory priority is explicit alias, exact conversation snapshot, then same-device employee default',t=>{
  const f=fixture(t),employee=f.employee(),conversation=f.repo.createConversation(SLUG,{employeeId:employee.id,cwd:'D:\\chat-snapshot'});
  assert.equal(f.task(employee,{conversationId:conversation.id}).payload.cwd,'D:\\chat-snapshot');
  f.repo.updateEmployee(employee.id,{defaultWorkingDirectory:'D:\\future',defaultWorkingDirectoryActionId:f.receipt('D:\\future')},actor);
  assert.equal(f.task(employee,{conversation_id:conversation.id}).payload.cwd,'D:\\chat-snapshot');
  assert.equal(f.task(employee).payload.cwd,'D:\\future');
  for(const alias of ['cwd','workingDirectory','working_directory','workdir'])assert.equal(f.task(employee,{conversationId:conversation.id,[alias]:'D:\\explicit'}).payload.cwd,'D:\\explicit',alias);
  assert.equal(f.task(employee,{cwd:'D:\\first',workingDirectory:'D:\\second'}).payload.cwd,'D:\\first');
  f.repo.updateConversationSettings(conversation.id,{workingDirectory:null});
  assert.equal(f.task(employee,{conversationId:conversation.id}).payload.cwd,'D:\\future');
});

test('directory inheritance never borrows another employee, workspace, or target computer and rejection writes nothing',t=>{
  const f=fixture(t),employee=f.employee(),other=f.employee('Codex','D:\\private-other');
  const wrongEmployee=f.repo.createConversation(SLUG,{employeeId:other.id});
  f.repo.db.prepare('INSERT INTO workspaces(id,slug,name,plan,timezone,created_at) VALUES(?,?,?,?,?,?)').run('workdir-foreign','workdir-foreign','Foreign','free','Asia/Shanghai',new Date().toISOString());
  const foreign=f.repo.createEmployee('workdir-foreign',{name:'Foreign',runtime:'Codex'}),wrongWorkspace=f.repo.createConversation('workdir-foreign',{employeeId:foreign.id,cwd:'D:\\private-foreign'});
  const wrongDevice=f.repo.createConversation(SLUG,{employeeId:employee.id,deviceId:'workdir-pc-b',cwd:'E:\\other-machine'});
  for(const conversation of [wrongEmployee,wrongWorkspace,wrongDevice]){
    const before=f.snapshot();
    assert.throws(()=>f.task(employee,{conversationId:conversation.id,cwd:'D:\\explicit-does-not-authorize-a-foreign-thread'}),/会话与当前员工、工作区或目标电脑不一致/);
    assert.deepEqual(f.snapshot(),before);
  }
  const before=f.snapshot();
  assert.throws(()=>f.task(employee,{targetDeviceId:'workdir-pc-b'}),{code:'DEFAULT_WORKDIR_DEVICE_MISMATCH'});
  assert.deepEqual(f.snapshot(),before);
  const explicit=f.task(employee,{targetDeviceId:'workdir-pc-b',cwd:'E:\\explicit-b'});
  assert.equal(explicit.payload.cwd,'E:\\explicit-b');assert.equal(explicit.payload.deviceId,'workdir-pc-b');
  const matched=f.task(employee,{targetDeviceId:'workdir-pc-b',conversationId:wrongDevice.id});
  assert.equal(matched.payload.cwd,'E:\\other-machine');assert.equal(matched.payload.deviceId,'workdir-pc-b');
});

test('unset directories preserve the existing daemon fallback and malformed task directories fail before writes',t=>{
  const f=fixture(t),employee=f.employee('Codex',null);
  assert.equal(Object.hasOwn(f.task(employee).payload,'cwd'),false,'do not turn the device heartbeat C directory into an explicit override');
  const conversation=f.repo.createConversation(SLUG,{employeeId:employee.id});f.repo.updateConversationSettings(conversation.id,{workingDirectory:null});
  assert.equal(Object.hasOwn(f.task(employee,{conversationId:conversation.id}).payload,'cwd'),false);
  for(const cwd of [123,{},'D:\\bad\n','D:\\bad\u0000','D:\\'+'x'.repeat(4097)]){
    const before=f.snapshot();assert.throws(()=>f.task(employee,{cwd}),{code:'EXECUTION_WORKDIR_INVALID'});assert.deepEqual(f.snapshot(),before);
  }
});

function activeBot(f,key,directory) {
  const bots=f.management.bots;let bot=bots.create(SLUG,{name:key,targetDeviceId:'workdir-pc-a',sourceProfile:'default',idempotencyKey:key});
  completeOwnedProfile(f.repo,bot);
  f.repo.updateEmployee(bot.id,{defaultWorkingDirectory:directory,defaultWorkingDirectoryActionId:f.receipt(directory)}, {...actor,botConfigurationWrite:true});
  f.repo.updateConversationSettings(bot.main_conversation_id,{workingDirectory:directory});
  bot=bots.get(SLUG,bot.id);
  const {action}=bots.validate(SLUG,bot.id,{expectedRevision:bot.revision,idempotencyKey:'validate-'+key});
  f.repo.ackA2AAction(action.id,{deviceId:'workdir-pc-a'});f.repo.resultA2AAction(action.id,{deviceId:'workdir-pc-a',status:'succeeded',result:{botValidation:{schemaVersion:1,valid:true,employeeId:bot.id,revision:bot.revision}}});
  return bots.control(SLUG,bot.id,{expectedRevision:bot.revision,expectedControlEpoch:bot.control_epoch,operation:'activate'});
}

test('Routine and collaboration dispatch use each target Bot conversation directory',t=>{
  const f=fixture(t),bot=activeBot(f,'routine-worker','D:\\routine-chat');
  const routine=f.management.bots.createRoutine(SLUG,bot.id,{name:'cwd routine',prompt:'Read cwd',schedule:'手动',idempotencyKey:'cwd-routine'});
  const run=f.management.bots.runRoutine(SLUG,bot.id,routine.id,{idempotencyKey:'cwd-run'}),action=f.repo.getA2AAction(run.action_id);
  assert.equal(action.payload.cwd,'D:\\routine-chat');
  f.repo.resultA2AAction(action.id,{status:'succeeded',result:{output:'fixture'}});
  const target=activeBot(f,'collaboration-worker','D:\\target-chat');
  const [child]=f.repo.dispatchBotCollaboration(SLUG,{sourceEmployeeId:bot.id,sourceActionId:null,mode:'message',content:'Read cwd',targets:[{id:target.id,revision:target.revision,controlEpoch:target.control_epoch,conversationId:target.main_conversation_id}]},'cwd-collaboration');
  assert.equal(child.payload.cwd,'D:\\target-chat');assert.equal(child.payload.employeeId,target.id);
});

test('Gateway model delivery inherits the exact main chat directory',t=>{
  const f=fixture(t),bot=activeBot(f,'gateway-worker','D:\\gateway-chat');
  // A lease is a native action bound to this already active Bot; no socket is opened.
  const bots=f.management.bots,changed=bots.update(SLUG,bot.id,{expectedRevision:bot.revision,config:{permissions:{mode:'execute'},gateway:{platforms:{webhook:{enabled:true}}}}});
  const {action:validation}=bots.validate(SLUG,bot.id,{expectedRevision:changed.revision,idempotencyKey:'gateway-revalidate'});
  f.repo.ackA2AAction(validation.id,{deviceId:'workdir-pc-a'});f.repo.resultA2AAction(validation.id,{status:'succeeded',result:{botValidation:{schemaVersion:1,valid:true,employeeId:bot.id,revision:changed.revision}}});
  const current=bots.control(SLUG,bot.id,{expectedRevision:changed.revision,expectedControlEpoch:changed.control_epoch,operation:'activate'});
  const connect=bots.native(SLUG,bot.id,{expectedRevision:current.revision,expectedControlEpoch:current.control_epoch,idempotencyKey:'gateway-lease',resource:'gateway',operation:'connect',input:{platform:'webhook',durationSeconds:60}}).action;
  f.repo.ackA2AAction(connect.id,{deviceId:'workdir-pc-a'});f.repo.resultA2AAction(connect.id,{status:'succeeded',result:{connected:true}});
  const delivery=f.repo.receiveBotGateway(connect.id,{deviceId:'workdir-pc-a',platform:'webhook',chatId:'fixture-chat',messageId:'fixture-message',content:'Read cwd'}).delivery;
  assert.equal(delivery.action.payload.cwd,'D:\\gateway-chat');assert.equal(delivery.action.payload.conversationId,bot.main_conversation_id);
});

test('direct native operations inherit the main chat, preserve explicit cwd, and reject another device',t=>{
  const f=fixture(t),bot=activeBot(f,'native-worker','D:\\native-chat'),bots=f.management.bots;
  const status=bots.native(SLUG,bot.id,{expectedRevision:bot.revision,expectedControlEpoch:bot.control_epoch,idempotencyKey:'native-status',resource:'heartbeat',operation:'status'}).action;
  assert.equal(status.payload.cwd,'D:\\native-chat');
  f.repo.resultA2AAction(status.id,{status:'succeeded',result:{output:'fixture'}});
  const make=(key,extra)=>f.repo.createA2AAction(SLUG,{type:'hermes.bot.native',botInternal:BOT_INTERNAL,dedupeKey:key,payload:{employeeId:bot.id,nativeOperation:{schemaVersion:2,resource:'heartbeat',operation:'status',input:{},requestId:key},...extra}});
  const explicit=make('native-explicit',{cwd:'D:\\native-override'});assert.equal(explicit.payload.cwd,'D:\\native-override');
  f.repo.resultA2AAction(explicit.id,{status:'succeeded',result:{output:'fixture'}});
  for(const extra of [{deviceId:'workdir-pc-b'},{targetDeviceId:'workdir-pc-b'}]){
    const before=f.snapshot();assert.throws(()=>make('native-wrong-'+Object.keys(extra)[0],extra));assert.deepEqual(f.snapshot(),before);
  }
});

test('native group work uses the exact group thread directory after group binding, rather than the main chat',t=>{
  const f=fixture(t),bot=activeBot(f,'group-worker','D:\\main-chat');
  const group=f.repo.createConversation(SLUG,{employeeId:bot.id,title:'Group: cwd-group',workingDirectory:'D:\\group-chat'});
  const action=f.repo.createA2AAction(SLUG,{type:'hermes.bot.native',botInternal:BOT_INTERNAL,dedupeKey:'native-group-cwd',payload:{employeeId:bot.id,nativeOperation:{schemaVersion:2,resource:'groups',operation:'step',input:{groupId:'cwd-group'},requestId:'native-group-cwd'}}});
  assert.equal(action.payload.conversationId,group.id);assert.equal(action.payload.hermesBot.conversationId,group.id);assert.equal(action.payload.cwd,'D:\\group-chat');
});
