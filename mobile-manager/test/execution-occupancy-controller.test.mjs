import test from 'node:test';
import assert from 'node:assert/strict';
import {createController} from '../web/controller.js';
import {initialState, blockingChatExecution} from '../web/model.js';
import {render} from '../web/view.js';
import {readOnlyObservationFixture} from './fixtures/historical-recovery.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const settle=async()=>{for(let i=0;i<8;i++)await tick();};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const old=()=>readOnlyObservationFixture();
function fixture(t, overrides={}) {
  const history=old(),workspace={slug:history.payload.hermesBot.workspace,workspace_id:history.workspace_id,role:'owner'};
  const employee={id:history.payload.employeeId,name:'原员工',runtime:'Hermes',target_device_id:history.payload.deviceId,runtime_profile:history.payload.profile};
  const latest={...structuredClone(history),id:'latest-success',status:'succeeded',error:null,result:{runtime:'Hermes',output:'新版恢复验收通过'}};
  const bot={id:employee.id,employee_id:employee.id,workspace:workspace.slug,employee,configuration_state:'initialized',control_state:'active',main_conversation_id:history.payload.conversationId,latest_run:latest};
  const state={...initialState(),phase:'ready',tab:'chat',user:{user_id:'occupancy-user'},workspace,workspaces:[workspace],employees:[{...employee,bot}],bots:[bot]};
  const writes=[],values=new Map(),storage={get length(){return values.size;},key:index=>[...values.keys()][index]??null,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
  const api={employees:async()=>({employees:[{...employee,bot}]}),bots:async()=>({bots:[bot]}),tasks:async()=>({tasks:[]}),devices:async()=>({devices:[]}),chats:async()=>({chats:[],unreadCount:0}),
    bot:async()=>structuredClone(bot),botRuns:async()=>({runs:[old()]}),botRoutines:async()=>({routines:[]}),
    conversation:async id=>({id,employee_id:employee.id,workspace_id:workspace.workspace_id,messages:[{id:'original-history',role:'assistant',content:'新版恢复验收通过'}],execution:structuredClone(latest)}),
    sendMessage:async(...args)=>{writes.push(args);throw new Error('This fixture must never dispatch work');},...overrides};
  const controller=createController({state,api,storage});t.after(()=>controller.dispose());
  return{state,api,controller,history,latest,bot,employee,workspace,writes};
}
function assertReady(f) {
  assert.equal(blockingChatExecution(f.state),null);
  const html=render(f.state);assert.doesNotMatch(html,/class="run-panel/);
  assert.match(html,/class="send-button"(?![^>]*disabled)/);
  assert.equal(f.state.conversation.id,f.history.payload.conversationId);
}
async function open(f){await f.controller.actions.chat({id:f.employee.id});await settle();await f.controller.change({name:'draft',value:'只保留未发送草稿'});}

test('released observation stays historical while original chat is usable through refresh and reentry',async t=>{
  const f=fixture(t),before=JSON.stringify(f.history);await open(f);assertReady(f);
  for(let i=0;i<3;i++){await f.controller.refresh({silent:true});await settle();assertReady(f);}
  await f.controller.actions['employee-detail']({id:f.employee.id});await f.controller.actions.back();await settle();assertReady(f);
  assert.equal(f.state.draft,'只保留未发送草稿');assert.equal(JSON.stringify(f.state.runs[0]),before);
  assert.equal(f.state.runs[0].result.processExit.treeConfirmed,false);assert.equal(f.state.runs[0].result.processExit.activeProcesses,3);
  assert.deepEqual(f.writes,[]);
});

test('latest successful reply and released observation cannot clear another current unknown',async t=>{
  const busy={...old(),id:'different-live-action',status:'acked',payload:{...old().payload,conversationId:'another-chat'},result:{executionState:'uncertain'}};
  const f=fixture(t,{botRuns:async()=>({runs:[old(),structuredClone(busy)]})});await open(f);
  assert.equal(blockingChatExecution(f.state).id,busy.id);assert.match(render(f.state),/class="run-panel/);
  const form=new FormData();form.set('draft','不可派发的草稿');await f.controller.submit('chat',form);
  assert.match(f.state.error,/当前工作尚未结束/);assert.deepEqual(f.writes,[]);
  f.api.botRuns=async()=>{throw new Error('只读运行记录失败');};await f.controller.refresh();await settle();
  assert.equal(blockingChatExecution(f.state).id,busy.id,'failed auxiliary reads retain the real blocker');
  assert.deepEqual(f.writes,[]);
});

test('a late old-visit polling response cannot resurrect a blocker after returning to the same chat',async t=>{
  const held=deferred();let count=0;
  const f=fixture(t,{botRuns:()=>++count===1?held.promise:Promise.resolve({runs:[old()]})});
  await open(f);await f.controller.actions.back();await open(f);assertReady(f);
  held.resolve({runs:[{...old(),id:'obsolete-running',status:'acked',result:null}]});await settle();
  assertReady(f);assert.equal(f.state.draft,'只保留未发送草稿');assert.deepEqual(f.writes,[]);
});

test('late prior-visit released data cannot clear a real blocker of the new visit',async t=>{
  const held=deferred();let count=0;
  const busy={...old(),id:'new-real-unknown',status:'failed',result:{executionState:'uncertain'}};
  const f=fixture(t,{botRuns:()=>++count===1?held.promise:Promise.resolve({runs:[busy]})});
  await open(f);await f.controller.actions.back();await open(f);
  assert.equal(blockingChatExecution(f.state).id,busy.id);
  held.resolve({runs:[old()]});await settle();
  assert.equal(blockingChatExecution(f.state).id,busy.id);assert.deepEqual(f.writes,[]);
});

test('same-slug workspace replacement rejects the old database visit response',async t=>{
  const held=deferred();let count=0;
  const f=fixture(t,{botRuns:()=>++count===1?held.promise:Promise.resolve({runs:[{...old(),workspace_id:'replacement-workspace-id'}]})});
  await open(f);
  const replacement={...f.workspace,workspace_id:'replacement-workspace-id'};f.state.workspaces=[replacement];
  await f.controller.actions['select-workspace']({id:replacement.workspace_id});await open(f);assertReady(f);
  held.resolve({runs:[{...old(),id:'old-workspace-busy',status:'acked',result:null}]});await settle();
  assertReady(f);assert.equal(f.state.workspace.workspace_id,replacement.workspace_id);assert.deepEqual(f.writes,[]);
});
