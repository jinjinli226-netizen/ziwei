import test from 'node:test';
import assert from 'node:assert/strict';
import {exitedReadOnlyPhoneObservation,botExecutionOccupiesSlot} from '../backend/bot-execution-occupancy.mjs';
import {createRepository} from '../backend/repository.mjs';
import {createManagementService} from '../backend/management.mjs';
import {botUncertain} from '../backend/bots.mjs';
import {completeOwnedProfile} from '../test-support/owned-profile.mjs';

function fixtureAction(base={}){
  const scope={workspace:'test-111',employeeId:'employee-fixture',deviceId:'pc-fixture',profile:'bot-fixture',ownershipId:'ownership-fixture',revision:7};
  const payload={runtime:'Hermes',employeeId:scope.employeeId,deviceId:scope.deviceId,profile:scope.profile,hermesBot:{schemaVersion:1,employeeId:scope.employeeId,deviceId:scope.deviceId,workspace:scope.workspace,sourceProfile:scope.profile,revision:scope.revision,controlEpoch:9,instance:{mode:'owned_profile',profile:scope.profile,ownershipId:scope.ownershipId}},managementMcp:{enabled:true},...base.payload};
  const b=payload.hermesBot;payload.terminalMcp={enabled:true,workspace:b.workspace,employeeId:payload.employeeId,deviceId:'phone-fixture',configurationRevision:'a'.repeat(64)};
  const call=(toolName,commandId,status='succeeded',state='succeeded')=>({toolName,ok:true,deviceId:'phone-fixture',...(commandId?{commandId,ids:{deviceId:'phone-fixture',commandId},status,commandStatus:status,commandExecutionState:state}:{} )});
  const calls=[call('ziwei_phone_list'),call('ziwei_phone_status')];
  for(let i=0;i<187;i++)calls.push(call('ziwei_phone_action','write-'+i),call('ziwei_phone_screenshot','screen-'+i),call('ziwei_phone_receipt','write-'+i));
  calls.push(call('ziwei_phone_screenshot','screen-pending','executing','pending'),call('ziwei_phone_receipt','screen-pending','uncertain','uncertain'),call('ziwei_phone_receipt','screen-pending'));
  calls.splice(114,0,{toolName:'ziwei_phone_screenshot',ok:false,deviceId:'phone-fixture',ids:{deviceId:'phone-fixture'},commandExecutionState:'uncertain',error:'Synthetic read-only observation failed'});
  const phone={configured:true,injected:true,loaded:true,transport:'stdio',serverName:'ziwei-terminal',workspace:b.workspace,runtime:'Hermes',profile:payload.profile,runtimeProfile:payload.profile,employeeId:payload.employeeId,targetDeviceId:'phone-fixture',actionId:base.id||'action-fixture',status:'loaded',toolCalls:calls,tool_calls:calls,retryAllowed:false,executionState:'uncertain',failure:{code:'terminal_mcp_receipt_incomplete',phoneExecutionState:'uncertain',retryAllowed:false,nextAction:'observe',error:'Synthetic observation unknown',commandIds:[],updateIds:[]}};
  const managementCalls=[];
  return {...base,id:base.id||'action-fixture',workspace_id:base.workspace_id||'ws-fixture',type:'conversation.execute',status:'failed',acked_at:base.acked_at||'2026-10-18T10:00:00Z',completed_at:'2026-10-18T11:00:00Z',payload,result:{runtime:'Hermes',profile:payload.profile,code:1,signal:null,configurationRevision:b.revision,executionState:'uncertain',output:'Synthetic context capacity failure',botIsolation:{enabled:true,kind:'hermes-bot',mode:'owned_profile',workspace:b.workspace,employeeId:payload.employeeId,sourceProfile:payload.profile,profile:payload.profile,revision:b.revision,key:b.instance.ownershipId},processExit:{launched:true,rootConfirmed:true,treeConfirmed:false,cancelled:false,backgroundProcessesRetained:true,rootPid:12345,rootExitCode:1,activeProcesses:3,hostExitCode:0,platform:'win32',supervisor:'windows-job'},managementMcp:{configured:true,injected:true,loaded:true,transport:'stdio',status:'loaded',workspace:b.workspace,runtime:'Hermes',runtimeProfile:payload.profile,toolCalls:managementCalls,tool_calls:managementCalls},terminalMcp:phone}};
}

test('567 receipt history releases only occupancy while preserving the unknown observation and retained process evidence',()=>{
  const action=fixtureAction(),before=JSON.stringify(action);
  assert.equal(action.result.terminalMcp.toolCalls.length,567);
  assert.equal(exitedReadOnlyPhoneObservation(action),true);assert.equal(botExecutionOccupiesSlot(action),false);
  assert.equal(JSON.stringify(action),before);assert.equal(botUncertain(action.result),true);
  assert.equal(action.result.executionState,'uncertain');assert.equal(action.result.processExit.treeConfirmed,false);assert.equal(action.result.processExit.activeProcesses,3);
  const raw={...action,payload_json:JSON.stringify(action.payload),result_json:JSON.stringify(action.result)};delete raw.payload;delete raw.result;
  assert.equal(exitedReadOnlyPhoneObservation(raw),true);assert.equal(botExecutionOccupiesSlot(raw),false);
});

const keepBusy=(name,mutate)=>test(name,()=>{const action=fixtureAction();mutate(action);const before=JSON.stringify(action);assert.equal(exitedReadOnlyPhoneObservation(action),false);assert.equal(botExecutionOccupiesSlot(action),true);assert.equal(JSON.stringify(action),before);});
keepBusy('a write with no response ID remains busy even when later unrelated screenshots succeeded',a=>{const call=a.result.terminalMcp.toolCalls.find(c=>c.toolName==='ziwei_phone_action');delete call.commandId;delete call.ids.commandId;call.ok=false;call.commandExecutionState='uncertain';});
keepBusy('a write whose own last receipt is still pending remains busy',a=>{for(const call of a.result.terminalMcp.toolCalls)if(call.commandId==='write-0'){call.status=call.commandStatus='queued';call.commandExecutionState='pending';}});
keepBusy('a write with an uncertain original receipt remains busy despite its terminal label',a=>{a.result.terminalMcp.toolCalls.findLast(c=>c.commandId==='write-0').commandExecutionState='uncertain';});
keepBusy('a failed original write without a later authoritative receipt remains busy',a=>{for(const call of a.result.terminalMcp.toolCalls)if(call.commandId==='write-0')call.ok=false;});
keepBusy('an upgrade without its original update ID remains busy',a=>{a.result.terminalMcp.toolCalls.push({toolName:'ziwei_phone_upgrade',ok:false,error:'Synthetic response lost'});});
keepBusy('an admitted upgrade without a terminal original receipt remains busy',a=>{a.result.terminalMcp.toolCalls.push({toolName:'ziwei_phone_upgrade',ok:true,updateId:'upgrade-one',updateStatus:'awaiting_health'});});
keepBusy('unknown phone control or enrollment writes remain busy',a=>{a.result.terminalMcp.toolCalls.push({toolName:'ziwei_phone_control',ok:true});});
keepBusy('cancelled executions are not relabeled as normally exited observation failures',a=>{a.result.processExit.cancelled=true;});
keepBusy('a cancelled action with an unknown result keeps its original occupancy',a=>{a.status='cancelled';});
keepBusy('an explicit execution uncertainty code remains busy',a=>{a.result.code='EXECUTION_UNCERTAIN';});
keepBusy('missing root exit evidence remains busy',a=>{a.result.processExit.rootConfirmed=false;});
keepBusy('incomplete CLI streams cannot hide missing final audit records',a=>{a.result.processExit.streamsComplete=false;});
keepBusy('a still-running root remains busy',a=>{a.result.processExit.rootExitCode=null;a.result.code=null;});
keepBusy('a failed supervisor remains busy',a=>{a.result.processExit.failureCode='WINDOWS_JOB_UNKNOWN';});
keepBusy('a cancelled signal remains busy',a=>{a.result.processExit.signal='SIGTERM';});
keepBusy('an unclassified retained process tree remains busy',a=>{delete a.result.processExit.backgroundProcessesRetained;});
test('an empty process count does not hold a failed slot for an uncertain receipt',()=>{const action=fixtureAction();action.result.processExit.activeProcesses=0;assert.equal(botExecutionOccupiesSlot(action),false);});
keepBusy('unknown native execution evidence remains busy',a=>{a.result.nativeOperation={status:'uncertain'};});
keepBusy('unknown supervision evidence remains busy',a=>{a.result.supervision={rootConfirmed:false};});
keepBusy('unrecognized future runtime evidence remains busy',a=>{a.result.unrecognizedNativeEvidence={safe:true};});
keepBusy('unknown resident execution evidence remains busy',a=>{a.result.residentExit={treeConfirmed:false};});
keepBusy('quarantine evidence remains busy',a=>{a.result.quarantined=true;});
keepBusy('an unrelated nested uncertainty remains busy',a=>{a.result.other={executionState:'uncertain'};});
keepBusy('management write tools remain busy',a=>{a.result.managementMcp.toolCalls.push({toolName:'ziwei_update_employee',ok:true});});
keepBusy('failed management observations cannot be hidden by the phone exception',a=>{a.result.managementMcp.toolCalls.push({toolName:'ziwei_get_employee',ok:false});});
keepBusy('missing configured management audit remains busy',a=>{delete a.result.managementMcp;});
keepBusy('mismatched audit aliases remain busy',a=>{a.result.terminalMcp.tool_calls=[];});
keepBusy('an unknown phone tool remains busy',a=>{a.result.terminalMcp.toolCalls.push({toolName:'unknown_tool',ok:true});});
keepBusy('a phone audit from another action remains busy',a=>{a.result.terminalMcp.actionId='foreign-action';});
keepBusy('a phone audit from another employee remains busy',a=>{a.result.terminalMcp.employeeId='foreign-employee';});
keepBusy('a phone audit from another workspace remains busy',a=>{a.result.terminalMcp.workspace='foreign-workspace';});
keepBusy('a phone audit from another profile remains busy',a=>{a.result.terminalMcp.profile='foreign-profile';});
keepBusy('a phone receipt from another device remains busy',a=>{a.result.terminalMcp.toolCalls[0].deviceId='foreign-phone';});
keepBusy('a mismatched original phone target remains busy',a=>{a.payload.terminalMcp.deviceId='foreign-phone';});
keepBusy('a mismatched local computer remains busy',a=>{a.payload.deviceId='foreign-pc';});
keepBusy('a mismatched Bot ownership remains busy',a=>{a.result.botIsolation.key='foreign-owner';});
keepBusy('absent ownership on both sides does not count as a matching owned profile',a=>{delete a.result.botIsolation.key;delete a.payload.hermesBot.instance.ownershipId;});
keepBusy('malformed receipt evidence is not ignored after an earlier write success',a=>{a.result.terminalMcp.toolCalls.push({toolName:'ziwei_phone_status',ok:true,receipts:[{commandId:'write-0',status:'',executionState:'uncertain'}]});});
keepBusy('a missing actual phone handshake remains busy',a=>{a.result.terminalMcp.loaded=false;});
keepBusy('a synthetic source is not accepted as live exit evidence',a=>{a.result.fixture=true;});

test('explicit caller scope mismatch does not free an unrelated slot',()=>{
  const action=fixtureAction();for(const expected of [{workspace:'foreign'},{workspaceId:'foreign'},{employeeId:'foreign'},{deviceId:'foreign'},{profile:'foreign'}])assert.equal(botExecutionOccupiesSlot(action,expected),true);
});
test('ordinary pending, acknowledged and expired admitted actions keep the existing occupancy rule',()=>{
  for(const status of ['pending','acked','expired']){const action=fixtureAction();action.status=status;assert.equal(botExecutionOccupiesSlot(action),true);}
  assert.equal(botExecutionOccupiesSlot(null),false);assert.equal(botExecutionOccupiesSlot({status:'failed',result:{code:'runtime_failed'}}),false);
});

function liveRepositoryFixture(t){
  const repo=createRepository({memory:true}),management=createManagementService(repo);t.after(()=>repo.db.close());
  repo.heartbeatDevice('test-111',{deviceId:'bot-pc',runtimes:{Hermes:{status:'available',version:'0.22.0',profiles:[{name:'default'}],models:[{id:'fixture-model'}]}}});
  let bot=management.bots.create('test-111',{name:'Observation slot fixture',sourceProfile:'default',targetDeviceId:'bot-pc',model:'fixture-model',idempotencyKey:'observation-slot'});
  completeOwnedProfile(repo,bot);const validation=management.bots.validate('test-111',bot.id,{expectedRevision:bot.revision,idempotencyKey:'observation-slot-validate'}).action;
  repo.ackA2AAction(validation.id,{deviceId:'bot-pc'});repo.resultA2AAction(validation.id,{status:'succeeded',result:{botValidation:{valid:true,schemaVersion:1,employeeId:bot.id,revision:bot.revision,sourceProfile:'default',nativeVersion:'0.22.0'}}});
  bot=management.bots.control('test-111',bot.id,{expectedRevision:bot.revision,expectedControlEpoch:1,operation:'activate'});
  const submitted=repo.addConversationMessage(bot.main_conversation_id,{content:'Synthetic original task'}),action=repo.getA2AAction(submitted.execution.id);
  repo.ackA2AAction(action.id,{deviceId:'bot-pc'});
  const failure=fixtureAction({...action,acked_at:repo.getA2AAction(action.id).acked_at});failure.completed_at=new Date(Date.now()+1000).toISOString();
  repo.db.prepare('UPDATE a2a_actions SET payload_json=? WHERE id=?').run(JSON.stringify(failure.payload),action.id);
  return{repo,bots:management.bots,bot,action,failure};
}

test('a new Bot chat replaces occupancy without rewriting the original unknown result or old events',t=>{
  const f=liveRepositoryFixture(t);f.repo.resultA2AAction(f.action.id,{status:'failed',error:'Synthetic context capacity failure',result:f.failure.result});
  const before=f.repo.db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(f.action.id),events=f.repo.listA2AEvents(f.action.id);
  assert.equal(f.repo.db.prepare('SELECT active_action_id FROM hermes_bots WHERE employee_id=?').get(f.bot.id).active_action_id,null);
  const next=f.repo.addConversationMessage(f.bot.main_conversation_id,{content:'Read only current health; do not replay the previous business'});
  assert.notEqual(next.execution.id,f.action.id);assert.equal(f.repo.db.prepare('SELECT active_action_id FROM hermes_bots WHERE employee_id=?').get(f.bot.id).active_action_id,next.execution.id);
  assert.deepEqual(f.repo.db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(f.action.id),before);assert.deepEqual(f.repo.listA2AEvents(f.action.id),events);assert.equal(botUncertain(JSON.parse(before.result_json)),true);
});

test('native session maintenance can start without completing or retrying the old observation',t=>{
  const f=liveRepositoryFixture(t);f.repo.resultA2AAction(f.action.id,{status:'failed',error:'Synthetic context capacity failure',result:f.failure.result});
  const before=f.repo.db.prepare('SELECT result_json FROM a2a_actions WHERE id=?').get(f.action.id).result_json;
  const next=f.bots.native('test-111',f.bot.id,{expectedRevision:f.bot.revision,expectedControlEpoch:f.bot.control_epoch,idempotencyKey:'list-for-maintenance',resource:'sessions',operation:'list',input:{limit:1}}).action;
  assert.notEqual(next.id,f.action.id);assert.equal(next.type,'hermes.bot.native');assert.equal(f.repo.db.prepare('SELECT result_json FROM a2a_actions WHERE id=?').get(f.action.id).result_json,before);
});

test('the same Bot queues a new chat but cannot ACK it while the original write has no final receipt',t=>{
  const f=liveRepositoryFixture(t);for(const call of f.failure.result.terminalMcp.toolCalls)if(call.commandId==='write-0'){call.commandStatus=call.status='queued';call.commandExecutionState='pending';}
  f.repo.resultA2AAction(f.action.id,{status:'failed',error:'Original write not observed',result:f.failure.result});
  const queued=f.repo.addConversationMessage(f.bot.main_conversation_id,{content:'new work'});
  assert.equal(queued.queue_status,'queued');
  f.repo.resumeConversationQueue(f.bot.main_conversation_id);
  assert.throws(()=>f.repo.ackA2AAction(queued.execution.id,{deviceId:f.action.payload.deviceId}),{code:'BOT_BUSY'});
});
