import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,blockingChatExecution} from '../web/model.js';
import {createController} from '../web/controller.js';
import {render} from '../web/view.js';
import {prelaunchFixture,forceAbandonFixture} from './fixtures/historical-recovery.mjs';

function fixture(oldRun) {
  const employee={id:oldRun.payload.employeeId,name:'知微',runtime:'Hermes'};
  const slug=oldRun.payload.hermesBot.workspace;
  const workspace={slug,workspace_id:oldRun.workspace_id || oldRun.forceAbandonRecovery?.subject.workspaceId || oldRun.prelaunchRecovery?.subject.workspaceId || (slug==='bigtron'?'ws_52fa81da-ddeb-439a-9a74-ab4df4b2636e':'workspace-id'),role:'owner'};
  const latest={id:'latest-confirmed-reply',type:'conversation.execute',status:'succeeded',created_at:'2026-10-18T02:08:00Z',result:{output:'恢复后的原回复'}};
  const messages=[{id:'old-error-message',role:'assistant',content:'原执行结果待核实，保留原历史'},{id:'restored-message',role:'assistant',content:'知微恢复正常'}];
  const conversation={id:'zhiwei-original-conversation',employee_id:employee.id,execution:latest,messages};
  const bot={id:employee.id,employee_id:employee.id,configuration_state:'initialized',control_state:'active',main_conversation_id:conversation.id,latest_run:latest,stop_action:{id:'old-stop',status:'succeeded',payload:{actionId:oldRun.id}}};
  const state={...initialState(),phase:'ready',user:{user_id:'original-account'},workspace,page:'chat',tab:'chat',selectedEmployee:employee,employees:[employee],bot,bots:[bot],conversation,messages,runs:[latest,oldRun],draft:'恢复后的新消息'};
  const sent=[],values=new Map();
  const api={
    sendMessage:async(id,body)=>{sent.push({id,body});return {id:'saved-new-message',execution:latest};},
    conversation:async()=>conversation,bot:async()=>bot,botRuns:async()=>({runs:[latest,oldRun]}),botRoutines:async()=>({routines:[]}),
    chats:async()=>({chats:[],unreadCount:0}),
  };
  const storage={get length(){return values.size;},key:index=>[...values.keys()][index]||null,getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const controller=createController({state,api,storage,render:()=>{}});
  const submit=()=>{const form=new FormData();form.set('draft',state.draft);return controller.submit('chat',form);};
  return {state,oldRun,latest,conversation,messages,sent,controller,submit};
}
const sendButton=html=>html.match(/<button class="send-button"[^>]*>/)?.[0];
const recoveries=[
  ['prelaunch v1',()=>prelaunchFixture()],
  ['prelaunch v2',()=>prelaunchFixture({postUpdate:true})],
  ['operator disposition v1',()=>forceAbandonFixture()],
  ['operator disposition v2',()=>forceAbandonFixture({absent:true})],
];

for(const [name,make] of recoveries)test(`${name} history does not lock the original chat composer or dispatch`,async t=>{
  const f=fixture(make());t.after(()=>f.controller.dispose());
  const before=JSON.stringify(f.oldRun);
  assert.equal(blockingChatExecution(f.state),null);
  const html=render(f.state);
  assert.doesNotMatch(html,/class="run-panel|工作进行中，可先写下下一条/);
  assert.doesNotMatch(sendButton(html),/disabled/);
  assert.match(html,/知微恢复正常/);assert.match(html,/原执行结果待核实，保留原历史/);
  await f.submit();
  assert.equal(f.sent.length,1);assert.equal(f.sent[0].id,f.conversation.id);
  assert.equal(f.sent[0].body.content,'恢复后的新消息');assert.ok(f.sent[0].body.clientMessageId);
  assert.equal(f.state.conversation.id,f.conversation.id);
  assert.equal(JSON.stringify(f.oldRun),before,'classification never rewrites the old outcome or proof');
});

for(const [name,make] of recoveries)test(`${name} without its committed disposition blocks in the matching original scope`,async t=>{
  const old=make();delete old.prelaunchRecovery;delete old.forceAbandonRecovery;
  const f=fixture(old);t.after(()=>f.controller.dispose());
  assert.equal(f.state.workspace.slug,old.payload.hermesBot.workspace);
  assert.equal(blockingChatExecution(f.state),old);assert.match(sendButton(render(f.state)),/disabled/);
  await f.submit();assert.equal(f.sent.length,0);assert.match(f.state.error,/当前工作尚未结束/);
});

for(const authority of ['missing','nested-result','nested-event','invalid-top-level'])test(`a ${authority} disposition still blocks despite a newer successful reply`,async t=>{
  const old=forceAbandonFixture(),receipt=old.forceAbandonRecovery;delete old.forceAbandonRecovery;
  if(authority==='nested-result')old.result={...old.result,forceAbandonRecovery:receipt};
  if(authority==='nested-event')old.events=[{type:'bot.operator_force_abandon',data:{receipt}}];
  if(authority==='invalid-top-level')old.forceAbandonRecovery={...receipt,executionConfirmedStopped:true};
  const f=fixture(old);t.after(()=>f.controller.dispose());
  assert.equal(blockingChatExecution(f.state),old);
  const html=render(f.state);assert.match(html,/执行待核实/);assert.match(sendButton(html),/disabled/);
  await f.submit();assert.equal(f.sent.length,0);assert.match(f.state.error,/当前工作尚未结束/);
  assert.equal(f.state.draft,'恢复后的新消息');
});

for(const source of ['conversation','runs','latest'])for(const status of ['pending','acked','uncertain'])test(`${source} ${status} still blocks with verified historical recovery present`,async t=>{
  const f=fixture(forceAbandonFixture({absent:true}));t.after(()=>f.controller.dispose());
  const live={id:'new-original-live-run',type:'conversation.execute',status,created_at:'2026-10-18T04:30:00Z',payload:{employeeId:f.state.selectedEmployee.id,conversationId:'same-employee-other-original-chat',hermesBot:{employeeId:f.state.selectedEmployee.id,workspace:f.state.workspace.slug}}};
  if(source==='conversation')f.state.conversation={...f.state.conversation,execution:live};
  if(source==='runs')f.state.runs=[live,...f.state.runs];
  if(source==='latest')f.state.bot={...f.state.bot,latest_run:live};
  assert.equal(blockingChatExecution(f.state),live);
  assert.match(sendButton(render(f.state)),/disabled/);
  await f.submit();assert.equal(f.sent.length,0);assert.match(f.state.error,/当前工作尚未结束/);
});

for(const source of ['conversation','runs','latest'])for(const mismatch of ['employee','workspace','database'])test(`${source} from another ${mismatch} cannot lock the selected original chat`,async t=>{
  const f=fixture(forceAbandonFixture({absent:true}));t.after(()=>f.controller.dispose());
  const live={id:'stale-foreign-run',type:'conversation.execute',status:'acked',workspace_id:f.state.workspace.workspace_id,payload:{employeeId:f.state.selectedEmployee.id,hermesBot:{employeeId:f.state.selectedEmployee.id,workspace:f.state.workspace.slug}}};
  if(mismatch==='employee')live.payload={...live.payload,employeeId:'other-employee',hermesBot:{...live.payload.hermesBot,employeeId:'other-employee'}};
  if(mismatch==='workspace')live.payload.hermesBot.workspace='other-workspace';
  if(mismatch==='database')live.workspace_id='different-workspace-database';
  if(source==='conversation')f.state.conversation={...f.state.conversation,execution:live};
  if(source==='runs')f.state.runs=[live,...f.state.runs];
  if(source==='latest')f.state.bot={...f.state.bot,latest_run:live};
  assert.equal(blockingChatExecution(f.state),null);assert.doesNotMatch(sendButton(render(f.state)),/disabled/);
  await f.submit();assert.equal(f.sent.length,1);assert.equal(f.sent[0].id,f.conversation.id);
});

for(const source of ['conversation','latest'])test(`a stale ${source} owner cannot lend its execution to the current employee`,async t=>{
  const f=fixture(forceAbandonFixture({absent:true}));t.after(()=>f.controller.dispose());
  const live={id:'stale-unbound-run',status:'acked'};
  if(source==='conversation')f.state.conversation={...f.state.conversation,employee_id:'another-employee',execution:live};
  else f.state.bot={...f.state.bot,id:'another-employee',latest_run:live};
  assert.equal(blockingChatExecution(f.state),null);assert.doesNotMatch(sendButton(render(f.state)),/disabled/);
});
