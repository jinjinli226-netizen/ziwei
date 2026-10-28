import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {initialState,blockingChatExecution} from '../web/model.js';
import {createController} from '../web/controller.js';
import {render} from '../web/view.js';
import {failureFinalization,pendingBotFailureFinalization} from '../web/failure-finalization.mjs';
import {executionUncertain,executionOccupiesSlot,botPresence,botStopPresentation,processExitConfirmed} from '../web/bot-presentation.js';

const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
function original(state='client_archived'){
  const run={id:'action_mobile-finalization',type:'conversation.execute',workspace_id:'ws_finalization',status:'failed',dedupe_key:'finalization-key',acked_at:'2026-10-21T01:00:00Z',completed_at:'2026-10-21T01:01:00Z',error:'Original failed execution',payload:{runtime:'Hermes',employeeId:'employee_finalization',deviceId:'device_finalization',profile:'bot-finalization',hermesBot:{schemaVersion:1,workspace:'finalization',employeeId:'employee_finalization',deviceId:'device_finalization',sourceProfile:'bot-finalization',revision:7,controlEpoch:25}},result:{code:'EXECUTION_UNCERTAIN',executionState:'uncertain',processExit:null,partialEffectsPossible:true}};
  const subject={actionId:run.id,actionType:run.type,workspace:'finalization',workspaceId:run.workspace_id,employeeId:run.payload.employeeId,deviceId:run.payload.deviceId,profile:run.payload.profile,dedupeKey:run.dedupe_key,originalRevision:7,originalControlEpoch:25,profileBindingDigest:digest(null),originalPayloadDigest:digest(run.payload),originalResultDigest:digest(run.result),originalActionSha256:digest(run),failedEvent:null};
  const body={schemaVersion:1,kind:'bot.failed_execution_finalization',subject,actorUserId:null,actorRole:'system',expectedRevision:7,expectedControlEpoch:25,resultingControlEpoch:26,disposition:'failed_automatically',status:'failed',executionState:'uncertain',executionConfirmedStopped:false,partialEffectsPossible:true,recordedAt:'2026-10-21T01:02:00Z'},receipt={...body,id:digest(body)},receiptDigest=digest(receipt);
  run.failureFinalization={receipt,receiptDigest,state,...(state==='client_archived'?{acknowledgement:{deviceId:subject.deviceId,credentialId:'devicecred_finalization',recordedAt:'2026-10-21T01:03:00Z',ack:{receiptId:receipt.id,receiptDigest,archiveSha256:'a'.repeat(64),localProcessDisposition:'unobservable'}}}:{})};
  return run;
}
function fixture(old=original()){
  const employee={id:old.payload.employeeId,name:'运营员工',runtime:'Hermes',target_device_id:old.payload.deviceId,runtime_profile:old.payload.profile},workspace={slug:'finalization',workspace_id:'ws_finalization',role:'owner'};
  const latest={id:'action_new-confirmed',type:'conversation.execute',status:'succeeded',payload:{employeeId:employee.id,hermesBot:{workspace:workspace.slug}},result:{output:'New reply'}};
  const messages=[{id:'message_old',role:'assistant',content:'Original history is preserved'},{id:'message_new',role:'assistant',content:'New reply'}],conversation={id:'conversation_finalization',employee_id:employee.id,execution:latest,messages};
  const bot={id:employee.id,workspace:workspace.slug,configuration_state:'initialized',control_state:'active',employee,main_conversation_id:conversation.id,latest_run:latest};
  const state={...initialState(),phase:'ready',user:{user_id:'user_fixture'},workspace,page:'chat',tab:'chat',selectedEmployee:employee,employees:[employee],bot,bots:[bot],conversation,messages,runs:[latest,old],draft:'A new task'};
  const sent=[],values=new Map(),api={sendMessage:async(id,body)=>{sent.push({id,body});return{id:'new-message',execution:latest};},conversation:async()=>conversation,bot:async()=>bot,botRuns:async()=>({runs:[latest,old]}),botRoutines:async()=>({routines:[]}),chats:async()=>({chats:[],unreadCount:0})};
  const storage={get length(){return values.size;},key:index=>[...values.keys()][index]||null,getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const controller=createController({state,api,storage,render:()=>{}}),submit=()=>{const form=new FormData();form.set('draft',state.draft);return controller.submit('chat',form);};
  return{old,latest,employee,bot,state,sent,controller,submit};
}
const sendButton=state=>render(state).match(/<button class="send-button"[^>]*>/)?.[0];

test('archived failed history plus a newer successful reply does not lock the original composer or dispatch',async t=>{
  const f=fixture(),before=canonical(f.old);t.after(()=>f.controller.dispose());
  assert(failureFinalization(f.old));assert.equal(executionUncertain(f.old),false);assert.equal(executionOccupiesSlot(f.old),false);assert.equal(blockingChatExecution(f.state),null);assert.doesNotMatch(sendButton(f.state),/disabled/);
  await f.submit();assert.equal(f.sent.length,1);assert.equal(f.sent[0].id,f.state.conversation.id);assert.equal(f.sent[0].body.content,'A new task');assert.equal(canonical(f.old),before);
  assert.equal(f.old.result.executionState,'uncertain');assert.equal(f.old.result.processExit,null);assert.equal(processExitConfirmed(f.old.result),false);assert.equal(botStopPresentation({},f.old).confirmed,false);assert.equal(botStopPresentation({},f.old).ended,true);
});
test('awaiting original computer archival still blocks while showing automatic cleanup rather than manual verification',async t=>{
  const f=fixture(original('awaiting_client'));t.after(()=>f.controller.dispose());
  assert.equal(blockingChatExecution(f.state),f.old);assert.match(sendButton(f.state),/disabled/);assert.equal(executionUncertain(f.old),false);
  f.state.devices=[{id:f.employee.target_device_id,status:'offline'}];const html=render(f.state);assert.match(html,/执行失败，等待电脑连接/);assert.doesNotMatch(html,/执行待核实|data-action="stop-run"/);
  await f.submit();assert.equal(f.sent.length,0);assert.match(f.state.error,/自动结束并归档/);assert.doesNotMatch(f.state.error,/使用停止入口|请检查原电脑/);
});
test('pending Bot receipt remains visible and blocking when several newer read-only runs hide its original action',t=>{
  const f=fixture(original('awaiting_client'));t.after(()=>f.controller.dispose());f.bot.failureFinalization=f.old.failureFinalization;f.state.runs=[f.latest];
  assert(pendingBotFailureFinalization(f.bot));assert.equal(blockingChatExecution(f.state)?.id,f.old.id);assert.match(render(f.state),/执行失败，正在自动收尾/);assert.match(sendButton(f.state),/disabled/);
});
for(const field of ['actionId','actionType','employeeId','deviceId','profile','workspace','workspaceId','originalRevision','originalControlEpoch'])test('different receipt '+field+' never releases the failed action',async t=>{
  const run=original();run.failureFinalization.receipt.subject[field]=field.startsWith('original')?88:'different';const f=fixture(run);t.after(()=>f.controller.dispose());
  assert.equal(failureFinalization(run),null);assert.equal(blockingChatExecution(f.state),run);assert.match(sendButton(f.state),/disabled/);await f.submit();assert.equal(f.sent.length,0);
});
for(const [name,edit] of [
  ['missing',run=>{delete run.failureFinalization;}],
  ['nested result',run=>{run.result.failureFinalization=run.failureFinalization;delete run.failureFinalization;}],
  ['event only',run=>{run.events=[{type:'bot.failed_execution_finalization',data:run.failureFinalization}];delete run.failureFinalization;}],
  ['malformed id',run=>{run.failureFinalization.receipt.id='invalid';}],
  ['wrong kind',run=>{run.failureFinalization.receipt.kind='bot.operator_force_abandon';}],
  ['missing ACK',run=>{delete run.failureFinalization.acknowledgement;}],
  ['mismatched ACK',run=>{run.failureFinalization.acknowledgement.ack.receiptDigest='b'.repeat(64);}],
  ['fake exit',run=>{run.failureFinalization.receipt.executionConfirmedStopped=true;}],
  ['missing payload binding',run=>{delete run.payload.profile;}],
])test(name+' disposition cannot bypass original execution blocking',t=>{
  const run=original();edit(run);const f=fixture(run);t.after(()=>f.controller.dispose());assert.equal(failureFinalization(run),null);assert.equal(blockingChatExecution(f.state),run);assert.match(sendButton(f.state),/disabled/);
});
test('a different actual in-flight task still blocks after this historical failure has been archived',t=>{
  const f=fixture();t.after(()=>f.controller.dispose());const active={...f.latest,id:'action_actual-live',status:'acked'};f.state.runs.unshift(active);assert.equal(blockingChatExecution(f.state),active);assert.match(sendButton(f.state),/disabled/);
});
test('an archived failed latest action is presented as failed without claiming process exit or success',t=>{
  const f=fixture();t.after(()=>f.controller.dispose());f.bot.latest_run=f.old;f.state.conversation.execution=f.old;
  assert.match(botPresence(f.bot).label,/失败/);assert.equal(botPresence(f.bot).tone,'error');assert.equal(blockingChatExecution(f.state),null);assert.equal(botStopPresentation(f.bot).confirmed,false);assert.doesNotMatch(sendButton(f.state),/disabled/);
});
test('ordinary owner-authorized abandonment uses the same archived contract without borrowing the old pinned recovery',t=>{
  const run=original(),value=run.failureFinalization,{id,...body}=value.receipt;
  Object.assign(body,{actorUserId:'user_owner',actorRole:'owner',disposition:'abandoned_by_user'});value.receipt={...body,id:digest(body)};value.receiptDigest=digest(value.receipt);Object.assign(value.acknowledgement.ack,{receiptId:value.receipt.id,receiptDigest:value.receiptDigest});
  const f=fixture(run);t.after(()=>f.controller.dispose());assert(failureFinalization(run));assert.equal(blockingChatExecution(f.state),null);assert.equal(run.forceAbandonRecovery,undefined);assert.equal(run.result.executionState,'uncertain');
});
test('a fabricated member authorization cannot become a completed operational disposition',t=>{
  const run=original();Object.assign(run.failureFinalization.receipt,{actorRole:'member',actorUserId:'user_member',disposition:'abandoned_by_user'});const f=fixture(run);t.after(()=>f.controller.dispose());assert.equal(failureFinalization(run),null);assert.equal(blockingChatExecution(f.state),run);
});
