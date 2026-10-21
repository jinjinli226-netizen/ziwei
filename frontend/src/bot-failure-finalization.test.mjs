import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {computed,ref} from 'vue';
import {finalizationDigest,validateFailureFinalizationReceipt} from '../../src/bot-failure-finalization-contract.mjs';
import * as finalization from './bot-failure-finalization.mjs';
import * as presentation from './bot-presentation.js';
import {executionPresentation,executionNeedsPolling} from './conversation-execution-state.mjs';
import {historicalPrelaunchRecovery} from './historical-prelaunch-recovery.mjs';
import {operatorForceAbandonRecovery} from './operator-force-abandon-recovery.mjs';
import {ownedBotChatBlockReason} from './bot-owned-profile.js';
import {chatLocalTime,conversationFiles} from './bot-main-chat.js';
import {createBotWorkbench} from './bot-workbench.js';

const clone=value=>JSON.parse(JSON.stringify(value)),hex='a'.repeat(64),deferred=()=>{let resolve;return{promise:new Promise(done=>resolve=done),resolve};};
const runFixture=()=>({id:'action-original',agent_id:'ziwei_user',type:'conversation.execute',status:'failed',acked_at:'2026-10-21T10:00:01Z',completed_at:'2026-10-21T10:00:02Z',payload:{runtime:'Hermes',employeeId:'employee',deviceId:'device',profile:'bot-profile'},error:'原始失败：未知执行结果',result:{code:'EXECUTION_UNCERTAIN',executionState:'uncertain',partialEffectsPossible:true,processExit:null},events:[]});
const botFixture=(run=runFixture())=>({id:'employee',workspace:'qa',revision:7,control_epoch:25,control_state:'active',configuration_state:'initialized',active_action_id:run.id,employee:{id:'employee',name:'Fixture employee',runtime:'Hermes',target_device_id:'device',runtime_profile:'bot-profile'},main_conversation_id:'conversation',config:{toolsets:[],permissions:{mode:'execute'}},latest_run:run});
function metadata(state='awaiting_client'){
  const body={schemaVersion:1,kind:'bot.failed_execution_finalization',subject:{actionId:'action-original',actionType:'conversation.execute',workspace:'qa',workspaceId:'ws-qa',deviceId:'device',employeeId:'employee',profile:'bot-profile',dedupeKey:null,originalRevision:7,originalControlEpoch:25,profileBindingDigest:hex,originalPayloadDigest:hex,originalResultDigest:hex,originalActionSha256:hex,failedEvent:null},actorUserId:null,actorRole:'system',expectedRevision:7,expectedControlEpoch:25,resultingControlEpoch:26,disposition:'failed_automatically',status:'failed',executionState:'uncertain',executionConfirmedStopped:false,partialEffectsPossible:true,recordedAt:'2026-10-21T10:00:03Z'};
  const receipt={...body,id:finalizationDigest(body)},receiptDigest=finalizationDigest(receipt);
  assert.equal(validateFailureFinalizationReceipt(receipt),true);
  return{receipt,receiptDigest,state,...(state==='client_archived'?{acknowledgement:{deviceId:'device',credentialId:'credential',recordedAt:'2026-10-21T10:00:04Z',ack:{receiptId:receipt.id,receiptDigest,archiveSha256:hex,localProcessDisposition:'unobservable'}}}:{})};
}
const withFinalization=(state='awaiting_client')=>({...runFixture(),failureFinalization:metadata(state)});

test('separate disposition changes the failed presentation and polling without confirming business or process exit',()=>{
  const original=runFixture();assert.equal(executionPresentation(original).summary,'失败');assert.equal(executionNeedsPolling(original),true);
  const pending=withFinalization();assert.equal(finalization.failureFinalization(pending),pending.failureFinalization);assert.equal(executionPresentation(pending).summary,'失败，正在自动收尾');assert.equal(executionNeedsPolling(pending),true);
  const archived=withFinalization('client_archived');assert.equal(executionPresentation(archived).summary,'失败 · 已结束本次执行');assert.equal(executionNeedsPolling(archived),false);assert.equal(executionPresentation(archived).retryable,false);
  assert.equal(presentation.executionUncertain(archived),true);assert.equal(presentation.processExitConfirmed(archived.result),false);assert.equal(presentation.botStopPresentation(botFixture(archived)).confirmed,false);assert.equal(presentation.botRecoveryEvent(archived),null);
  assert.deepEqual(archived.result,original.result);assert.equal(archived.error,original.error);
});
test('cross-action, nested result flags and incomplete ACKs never unlock the failed execution',()=>{
  const candidates=[{...runFixture(),result:{...runFixture().result,failureFinalization:metadata('client_archived')}},{...runFixture(),events:[{type:'bot.failed_execution_finalization',data:metadata('client_archived')}]},withFinalization('client_archived'),withFinalization('client_archived'),withFinalization('client_archived')];
  candidates[2].failureFinalization.receipt.subject.actionId='other';candidates[3].failureFinalization.acknowledgement.ack.receiptDigest='b'.repeat(64);delete candidates[4].failureFinalization.acknowledgement;
  for(const run of candidates){assert.equal(finalization.failureFinalization(run),null);assert.equal(executionNeedsPolling(run),true);assert.equal(presentation.executionUncertain(run),true);}
});
test('pending Bot disposition remains visible and polls when a readonly action is newer',()=>{
  const bot={...botFixture(),active_action_id:null,failureFinalization:metadata(),latest_run:{id:'read-only-inspection',status:'succeeded'}};
  assert.equal(executionNeedsPolling(bot.latest_run,bot),true);assert.equal(presentation.botPresence(bot).label,'失败，正在自动收尾');assert.equal(finalization.finalizationPresentation(finalization.pendingBotFailureFinalization(bot),{offline:true}).summary,'失败，等待电脑连接');
  assert.equal(finalization.pendingBotFailureFinalization({...bot,id:'another'}),null);
});
test('legacy request pins active action, employee, computer, profile and current control version with a stable key',()=>{
  const run=runFixture(),bot=botFixture(run),body=finalization.failureFinalizationRequest(bot,run);
  assert.deepEqual(body,{expectedActionId:run.id,expectedRevision:7,expectedControlEpoch:25,acknowledgeUncertain:true,idempotencyKey:'bot-failure-finalize-action-original-r7-e25'});assert.deepEqual(finalization.failureFinalizationRequest(clone(bot),clone(run)),body);
  for(const changed of [{...bot,active_action_id:'another'},{...bot,revision:0},{...bot,employee:{...bot.employee,target_device_id:'another'}},{...bot,employee:{...bot.employee,runtime_profile:'another'}}])assert.equal(finalization.failureFinalizationRequest(changed,run),null);
  for(const changed of [null,{...run,status:'acked'},{...run,acked_at:null},{...run,result:{}},{...run,payload:{...run.payload,runtime:'Codex'}},withFinalization()])assert.equal(finalization.failureFinalizationRequest(bot,changed),null);
});

const app=await readFile(new URL('./App.vue',import.meta.url),'utf8'),component=await readFile(new URL('./components/BotMainChat.vue',import.meta.url),'utf8');
function actualFunction(source,name,bindings,declarations=''){
  const start=source.indexOf(`async function ${name}(`),end=source.indexOf('\n}',start);assert.ok(start>=0);
  return new Function(...Object.keys(bindings),`${declarations};return (${source.slice(start,end+2)});`)(...Object.values(bindings));
}
function chatHarness(overrides={}){
  const original=runFixture(),initial=botFixture(original),writes=[],notices=[],refreshes=[],reads=[];
  const persisted={...initial,active_action_id:null,control_epoch:26,failureFinalization:metadata(),latest_run:withFinalization()};
  let readCount=0;
  const refs={conversationExecution:{value:original},conversationBotBinding:{value:initial},selectedConversation:{value:{id:'conversation'}},authState:{value:{user:{id:'owner'}}},botChatView:{value:{ready:true}},botChatFinalizationBusy:{value:false},botChatStopBusy:{value:false},botChatReconcileBusy:{value:false},botBindingPending:{value:false}};
  const bindings={...refs,...finalization,workspaceSlug:()=> 'qa',api:{bot:async(...args)=>{reads.push(args);return ++readCount===1?initial:persisted;},finalizeBotFailure:async(...args)=>{writes.push(args);return metadata();},...overrides},notify:(...args)=>notices.push(args),refreshConversationState:async options=>refreshes.push(options),startConversationPolling:()=>{},loadBotChatWork:async()=>{}};
  return{refs,writes,notices,refreshes,reads,initial,persisted,run:actualFunction(app,'finalizeBotChatFailure',bindings,'let conversationOpenGeneration=0,botChatBindingGeneration=0')};
}
test('actual chat ends the exact failed action through finalization API, then rereads server state without replaying or fake stopping',async()=>{
  const ui=chatHarness();await ui.run();assert.deepEqual(ui.writes,[['employee',finalization.failureFinalizationRequest(ui.initial,ui.initial.latest_run),'qa']]);assert.equal(ui.reads.length,2);assert.deepEqual(ui.refreshes,[{force:true}]);assert.equal(ui.refs.conversationBotBinding.value,ui.persisted);assert.equal(ui.refs.conversationExecution.value.status,'failed');assert.equal(ui.refs.botChatFinalizationBusy.value,false);assert.match(ui.notices[0][0],/自动收尾/);assert.doesNotMatch(ui.notices[0][0],/已停止|已成功|已完成/);
});
test('actual chat rechecks current occupancy before mutation and does not target a newer action',async()=>{
  const ui=chatHarness({bot:async()=>({...botFixture(),active_action_id:'newer'})});await ui.run();assert.equal(ui.writes.length,0);assert.deepEqual(ui.refreshes,[{force:true}]);assert.equal(ui.refs.botChatFinalizationBusy.value,false);
});
test('actual chat network loss refreshes original state once and never retries an unknown finalization write',async()=>{
  let calls=0;const ui=chatHarness({finalizeBotFailure:async()=>{calls++;throw new TypeError('network lost');}});await ui.run();assert.equal(calls,1);assert.equal(ui.reads.length,2);assert.deepEqual(ui.refreshes,[{force:true}]);assert.equal(ui.refs.conversationExecution.value.status,'failed');assert.equal(ui.refs.botChatFinalizationBusy.value,false);assert.deepEqual(ui.notices,[['network lost','error']]);
});
test('late finalization completion cannot overwrite another employee or toast on its screen',async()=>{
  const response=deferred(),ui=chatHarness({finalizeBotFailure:()=>response.promise});const pending=ui.run();await new Promise(done=>setImmediate(done));ui.refs.conversationBotBinding.value={id:'other'};ui.refs.selectedConversation.value={id:'other-conversation'};response.resolve(metadata());await pending;assert.equal(ui.refs.conversationBotBinding.value.id,'other');assert.deepEqual(ui.notices,[]);assert.deepEqual(ui.refreshes,[]);
});
function componentState(run,bot=botFixture(run),device={status:'online'}){
  const source=component.slice(component.indexOf('<script setup>')+14,component.indexOf('function closeMenus(')).replace(/^import .*;\r?\n/gm,'');
  const sent=[],bindings={computed,ref,defineProps:()=>({bot,execution:run,conversation:{id:'conversation',messages:[]},device,draft:'next work',attachments:[]}),defineEmits:()=>name=>sent.push(name),...finalization,...presentation,chatLocalTime,conversationFiles,historicalPrelaunchRecovery,operatorForceAbandonRecovery,ownedBotChatBlockReason};
  return new Function(...Object.keys(bindings),`${source};return {blocksSending,canFinalize,executionState,status,keydown,sent:arguments[arguments.length-1]};`)(...Object.values(bindings),sent);
}
test('actual composer shows a real legacy end button, blocks during cleanup, and accepts Enter only after client archive',()=>{
  const legacy=componentState(runFixture());assert.equal(legacy.canFinalize.value,true);assert.equal(legacy.blocksSending.value,true);
  const pending=componentState(withFinalization(),{...botFixture(withFinalization()),failureFinalization:metadata(),active_action_id:null},{status:'offline'});assert.equal(pending.canFinalize.value,false);assert.equal(pending.blocksSending.value,true);assert.equal(pending.status.value,'失败，等待电脑连接');pending.keydown({key:'Enter',preventDefault(){}});assert.deepEqual(pending.sent,[]);
  const archived=componentState(withFinalization('client_archived'),{...botFixture(withFinalization('client_archived')),active_action_id:null});assert.equal(archived.blocksSending.value,false);assert.equal(archived.executionState.value.tone,'error');archived.keydown({key:'Enter',preventDefault(){}});assert.deepEqual(archived.sent,['send']);
  assert.match(component,/@click="emit\('finalize-failure'\)"/);assert.match(app,/@finalize-failure="finalizeBotChatFailure"/);
});
test('actual failure polling rereads Bot binding so a client ACK cannot leave a stale send lock',async()=>{
  const reads=[],bot={...botFixture(),active_action_id:null,failureFinalization:metadata()},bindings={conversationBotBinding:{value:bot},conversationExecution:{value:{id:'newer-readonly',status:'succeeded'}},botChatView:{value:{ready:true}},selectedConversation:{value:{id:'conversation'}},...presentation,...finalization,refreshBotChatBinding:async(...args)=>reads.push(args)};
  await actualFunction(app,'refreshBotChatFailureState',bindings)();assert.deepEqual(reads,[['employee','conversation']]);
});
test('workbench finalization keeps drafts and original failed result, and refreshes server disposition',async()=>{
  const original=runFixture();let bot=botFixture(original),writes=[];const ui=createBotWorkbench({api:{bots:async()=>({bots:[bot]}),bot:async()=>bot,botRuns:async()=>({runs:[bot.latest_run]}),botRoutines:async()=>({routines:[]}),finalizeBotFailure:async(...args)=>{writes.push(args);bot={...bot,active_action_id:null,control_epoch:26,failureFinalization:metadata(),latest_run:withFinalization()};return metadata();}}});
  await ui.setWorkspace('qa','employee');ui.state.draft.employee.name='Keep unsaved name';assert.equal(await ui.finalizeFailure(original),true);assert.equal(writes.length,1);assert.equal(writes[0][1].expectedActionId,'action-original');assert.equal(ui.state.draft.employee.name,'Keep unsaved name');assert.equal(ui.state.bot.latest_run.status,'failed');assert.deepEqual(ui.state.bot.latest_run.result,original.result);assert.match(ui.state.notice,/自动收尾/);
});
