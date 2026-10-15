import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveBotCapabilities} from '../backend/bot-capabilities.mjs';
import {BOT_CAPABILITY_CATALOG} from '../src/hermes-bot-config.mjs';
import {createRepository} from '../backend/repository.mjs';
import {createManagementService} from '../backend/management.mjs';
import {completeOwnedProfile} from '../test-support/owned-profile.mjs';

const now=Date.parse('2026-10-15T04:00:00Z');
const exit={platform:'win32',supervisor:'windows-job',launched:true,rootPid:99,rootConfirmed:true,rootExitCode:0,treeConfirmed:true,activeProcesses:0,cancelled:false,failureCode:null};
function fixture(){
  return {now,bot:{id:'employee-one',workspace:'workspace',configuration_state:'initialized',revision:3,control_epoch:6,control_state:'active',main_conversation_id:'conversation',employee:{target_device_id:'pc',runtime_profile:'bot-one',model_id:null,instructions:'记录证据'},instance:{mode:'owned_profile',home:'/profiles/bot-one',provisioning:{status:'provisioned',authentication:'configured'}},validation:{status:'succeeded',revision:3},config:{memory:{enabled:true},permissions:{mode:'execute'},mcpServers:{demo:{enabled:true}},collaboration:{enabled:false,targetEmployeeIds:[]},gateway:{platforms:{telegram:{enabled:true}}},voice:{tts:{provider:'openai',enabled:true}}}},device:{id:'pc',status:'online',healthy:true},runtime:{cli_status:'available',available:true,profiles:[{name:'bot-one'}],readiness:{authentication:'missing',provider:'missing'}},capabilities:BOT_CAPABILITY_CATALOG.map(([id,label])=>({id,label,status:'requires_configuration',evidence:[]})),actions:[]};
}
function native(f,resource,operation,data={},overrides={}){
  const action={id:`${resource}-${operation}`,type:'hermes.bot.native',status:'succeeded',created_at:'2026-10-15T03:59:00Z',completed_at:'2026-10-15T03:59:01Z',payload:{employeeId:f.bot.id,deviceId:'pc',profile:'bot-one',hermesBot:{employeeId:f.bot.id,deviceId:'pc',workspace:f.bot.workspace,revision:3,controlEpoch:6},nativeOperation:{resource,operation}},result:{nativeOperation:{schemaVersion:2,employeeId:f.bot.id,revision:3,resource,operation,status:'succeeded',nativeVersion:'0.21.3',data},processExit:{...exit}},...overrides};
  f.actions.push(action);return action;
}
const derive=f=>deriveBotCapabilities(f),cap=(f,id)=>derive(f).capabilities.find(item=>item.id===id);

test('configuration validation preserves legacy status without claiming tools, audio or model execution',()=>{
  const f=fixture(),view=derive(f);
  assert.equal(view.capabilityGate.state,'ready');
  for(const id of ['tools_mcp','voice','gateway','model_provider','multimodal'])assert.equal(cap(f,id).state,'needs_check',id);
  assert.equal(cap(f,'profile_memory').state,'enabled');
  assert.equal(cap(f,'model_provider').status,'requires_configuration');
  assert.equal(cap(f,'model_provider').enabled,null);
});

test('model and image readiness require a real successful turn of this exact Bot scope',()=>{
  const f=fixture(),a=native(f,'memory','read',{});a.type='conversation.execute';delete a.payload.nativeOperation;delete a.result.nativeOperation;
  a.payload.attachments=[{mimeType:'image/png'}];assert.equal(cap(f,'model_provider').state,'ready');assert.equal(cap(f,'multimodal').state,'ready');
  assert.equal(cap(f,'model_provider').evidence.at(-1).actionId,a.id);
  a.result={result:{processExit:exit}};assert.equal(cap(f,'model_provider').state,'ready');
  a.payload.hermesBot.revision=2;assert.equal(cap(f,'model_provider').state,'needs_check');assert.equal(cap(f,'multimodal').state,'needs_check');
});

test('one-click actions only enable saved simple switches with their prerequisites',()=>{
  const f=fixture();f.bot.config.memory.enabled=false;f.bot.config.permissions.mode='read_only';
  assert.deepEqual(cap(f,'profile_memory').action,{kind:'enable',key:'memory',label:'开启记忆',tab:'knowledge'});
  assert.equal(cap(f,'tools_mcp').action.key,'tools_permission');
  assert.equal(cap(f,'tools_mcp').action.label,'允许使用工具');
  assert.equal(cap(f,'delegation').action.kind,'navigate');
  f.bot.config.collaboration.targetEmployeeIds=['partner'];assert.equal(cap(f,'delegation').action.kind,'navigate');
  f.bot.config.permissions.mode='execute';assert.equal(cap(f,'delegation').action.key,'collaboration');
  f.bot.config.collaboration.enabled=true;assert.equal(cap(f,'delegation').state,'enabled');
  assert.equal(cap(f,'voice').action.kind,'navigate');assert.equal(cap(f,'gateway').action.kind,'navigate');
});

test('native success requires the bound receipt and controlled completion, excluding fixtures and old scope',()=>{
  const f=fixture(),action=native(f,'mcp','inspect',{connected:true,tools:[{name:'read'}]});
  assert.equal(cap(f,'tools_mcp').state,'ready');assert.equal(cap(f,'tools_mcp').checkedAt,action.completed_at);
  action.result.nativeOperation.employeeId='someone-else';assert.equal(cap(f,'tools_mcp').state,'needs_check');
  action.result.nativeOperation.employeeId=f.bot.id;delete action.result.processExit;assert.equal(cap(f,'tools_mcp').state,'needs_check');
  action.result.processExit={...exit,treeConfirmed:false,activeProcesses:1};assert.equal(cap(f,'tools_mcp').state,'needs_check');
  action.result.processExit={...exit,platform:'darwin',supervisor:'direct',treeConfirmed:false,activeProcesses:null};assert.equal(cap(f,'tools_mcp').state,'ready');
  action.result.executionSource='fixture';assert.equal(cap(f,'tools_mcp').state,'needs_check');
  delete action.result.executionSource;action.payload.hermesBot.controlEpoch=5;assert.equal(cap(f,'tools_mcp').state,'needs_check');assert.equal(cap(f,'tools_mcp').checkedAt,null);
  action.payload.hermesBot.controlEpoch=6;action.payload.deviceId='foreign-pc';assert.equal(cap(f,'tools_mcp').state,'needs_check');
});

test('native unsupported, authorization, dependency and failure get distinct actionable states',()=>{
  for(const [status,state]of [['unsupported','unavailable'],['requires_authorization','needs_configuration'],['requires_dependency','unavailable'],['failed','failed']]){
    const f=fixture(),a=native(f,'skills','list',{});a.result.nativeOperation.status=status;
    assert.equal(cap(f,'skills').state,state,status);assert.ok(cap(f,'skills').reason);assert.ok(cap(f,'skills').action.label);
  }
});

test('gateway list/configure and old connect are not live connection proof; actual heartbeat shape is accepted',()=>{
  const f=fixture(),connect=native(f,'gateway','connect',{connected:true});
  assert.equal(cap(f,'gateway').state,'needs_check');
  const status=native(f,'gateway','status',{configuredPlatforms:['telegram'],configuredIsConnected:false,runtime:[]},{created_at:'2026-10-15T03:59:05Z'});
  assert.equal(cap(f,'gateway').state,'needs_check');
  // bridge gateway_observations has no workspace; outer action carries that binding.
  status.result.nativeOperation.data.runtime=[{platform:'telegram',employeeId:f.bot.id,revision:3,controlEpoch:6,status:'connected',pid:99,lastHeartbeat:now/1000-5,sourceActionId:connect.id}];
  assert.equal(cap(f,'gateway').state,'ready');
  const worker=status.result.nativeOperation.data.runtime[0];worker.lastHeartbeat=now/1000-21;assert.equal(cap(f,'gateway').state,'needs_check');
  worker.lastHeartbeat=now/1000-5;worker.controlEpoch=5;assert.equal(cap(f,'gateway').state,'needs_check');
  worker.controlEpoch=6;worker.workspace='foreign';assert.equal(cap(f,'gateway').state,'needs_check');
  delete worker.workspace;connect.result.residentExit={code:0};assert.equal(cap(f,'gateway').state,'needs_check');
});

test('voice status and empty success never claim usable audio, while actual products do',()=>{
  const f=fixture(),a=native(f,'voice','status',{tts:{configured:true,enabled:true,provider:'openai'}});
  assert.equal(cap(f,'voice').state,'needs_check');
  a.payload.nativeOperation.operation='synthesize';a.result.nativeOperation.operation='synthesize';a.result.nativeOperation.data={success:true,files:[]};
  assert.equal(cap(f,'voice').state,'needs_check');
  a.result.nativeOperation.data.files=[{mimeType:'audio/wav',audioBase64:'YQ=='}];assert.equal(cap(f,'voice').state,'ready');
  a.payload.nativeOperation.operation='transcribe';a.result.nativeOperation.operation='transcribe';a.result.nativeOperation.data={success:true,text:'识别到的原始文本'};assert.equal(cap(f,'voice').state,'ready');
});

test('goals, heartbeat and kanban successful reads do not claim that a model tick ran',()=>{
  for(const id of ['goals','heartbeat']){
    const f=fixture();native(f,id,'status',{state:{status:'active'},run:false});
    assert.equal(cap(f,id).state,'enabled');assert.match(cap(f,id).reason,/未触发模型/);assert.equal(cap(f,'model_provider').state,'needs_check');
  }
  const f=fixture();native(f,'kanban','list',{items:[{id:'task',status:'blocked'}]});assert.equal(cap(f,'kanban').state,'ready');assert.match(cap(f,'kanban').reason,/按每次派发/);
});

test('shared global gate reflects saved-but-unvalidated settings and paused state without repeating generic reasons',()=>{
  const f=fixture();f.bot.validation={status:'stale',revision:2};
  assert.equal(derive(f).capabilityGate.state,'needs_check');assert.equal(derive(f).capabilityGate.action.kind,'validate');
  assert.equal(cap(f,'profile_memory').state,'needs_check');assert.equal(cap(f,'profile_memory').enabled,true);assert.equal(cap(f,'profile_memory').reason,'独立记忆已开启。');
  f.bot.validation={status:'pending',revision:3};assert.equal(derive(f).capabilityGate.state,'checking');
  f.bot.validation={status:'succeeded',revision:3};f.bot.control_state='paused';assert.equal(derive(f).capabilityGate.action.kind,'activate');
  f.device.status='offline';assert.equal(derive(f).capabilityGate.state,'offline');
  f.device.status='online';f.runtime.profiles=[];assert.equal(derive(f).capabilityGate.state,'needs_check');
});

test('only the actual active lock blocks globally, including expired ACK from an old epoch',()=>{
  const f=fixture(),a=native(f,'memory','read',{});a.status='expired';a.acked_at='2026-10-15T03:59:00Z';a.payload.hermesBot.controlEpoch=5;
  assert.equal(derive(f).capabilityGate.state,'ready');
  f.activeAction=a;assert.equal(derive(f).capabilityGate.state,'failed');assert.equal(derive(f).capabilityGate.action.tab,'activity');
  f.activeAction={...a,status:'acked'};assert.equal(derive(f).capabilityGate.state,'checking');
  f.activeAction={...a,status:'failed',result:{code:'EXECUTION_UNCERTAIN'}};assert.equal(derive(f).capabilityGate.state,'failed');
});

test('routines report actual saved schedule and do not imply a successful model execution',()=>{
  const f=fixture();assert.equal(cap(f,'routines').state,'needs_configuration');
  f.routines=[{id:'routine',status:'active',next_run:'2026-10-16T04:00:00Z'}];assert.equal(cap(f,'routines').state,'enabled');assert.equal(cap(f,'model_provider').state,'needs_check');
  delete f.routines[0].next_run;assert.equal(cap(f,'routines').state,'failed');f.routines[0].status='paused';assert.equal(cap(f,'routines').state,'disabled');
});

test('real in-memory Bot facade reports profile validation, oneclick save and old active occupancy',()=>{
  const repo=createRepository({memory:true}),management=createManagementService(repo),bots=management.bots;
  try{
    const heartbeat=profiles=>repo.heartbeatDevice('test-111',{deviceId:'bot-pc',runtimes:{Hermes:{status:'available',version:'0.21.3',profiles:profiles.map(name=>({name})),models:[{id:'test-model'}]}}});
    heartbeat(['default']);let bot=bots.create('test-111',{name:'能力证据',runtimeProfile:'default',targetDeviceId:'bot-pc',model:'test-model',instructions:'保存证据',idempotencyKey:'capability-create'});
    assert.equal(bot.capabilityGate.state,'checking');completeOwnedProfile(repo,bot);heartbeat(['default',bot.instance.profile]);
    const {action}=bots.validate('test-111',bot.id,{expectedRevision:1,idempotencyKey:'validate'});repo.ackA2AAction(action.id,{deviceId:'bot-pc'});repo.resultA2AAction(action.id,{status:'succeeded',result:{botValidation:{valid:true,schemaVersion:1,employeeId:bot.id,revision:1,sourceProfile:'default',nativeVersion:'0.21.3'}}});
    bot=bots.control('test-111',bot.id,{expectedRevision:1,expectedControlEpoch:1,operation:'activate'});assert.equal(bot.capabilityGate.state,'ready');assert.equal(bot.capabilities.find(item=>item.id==='model_provider').state,'needs_check');
    const msg=repo.addConversationMessage(bot.main_conversation_id,{content:'等待原回执'});repo.ackA2AAction(msg.execution.id,{deviceId:'bot-pc'});
    bots.control('test-111',bot.id,{expectedRevision:1,expectedControlEpoch:2,operation:'pause'});
    repo.db.prepare("UPDATE a2a_actions SET status='expired' WHERE id=?").run(msg.execution.id);
    bot=bots.get('test-111',bot.id);assert.equal(bot.capabilityGate.state,'failed');assert.match(bot.capabilityGate.reason,/原执行/);
  }finally{repo.db.close();}
});
