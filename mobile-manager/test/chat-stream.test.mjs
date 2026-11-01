import test from 'node:test';
import assert from 'node:assert/strict';
import {createController} from '../web/controller.js';
import {initialState,blockingChatExecution} from '../web/model.js';
import {render} from '../web/view.js';
import {renderWorkspaceGroups} from '../web/workspace-groups-view.js';

const stream=(text,sequence=1,extra={})=>({schemaVersion:1,responseId:'action-one:assistant',sequence,phase:'streaming',format:'markdown',text,...extra});
const execution=(text,extra={})=>({id:'action-one',status:'running',stream:stream(text),...extra});
const history=[{id:'saved-one',role:'user',content:'请继续',created_at:'2026-11-01T00:00:00Z'}];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{resolve,promise};};
function fixture(t) {
  const employees=[{id:'one',name:'员工甲',runtime:'Other',main_conversation_id:'chat-one'},{id:'two',name:'员工乙',runtime:'Other',main_conversation_id:'chat-two'}];
  const workspace={slug:'workspace-one',role:'owner'};
  const state={...initialState(),phase:'ready',user:{user_id:'account-one'},workspace,workspaces:[workspace],employees};
  const calls={chat:[],employees:0,activity:0,read:[],writes:[]};
  let current=execution('第一段');
  const page=id=>({id,employee_id:id==='chat-one'?'one':'two',messages:[...history],execution:current,messagePage:{hasMore:false,total:history.length}});
  const api={authMe:async()=>state.user,workspaces:async()=>({workspaces:[workspace]}),
    employees:async()=>{calls.employees++;return{employees};},bots:async()=>({bots:[]}),tasks:async()=>({tasks:[]}),devices:async()=>({devices:[]}),chats:async()=>({chats:[],unreadCount:0}),
    conversationPage:async(id,options)=>{calls.chat.push({id,signal:options.signal});return page(id);},
    conversationActivity:async()=>{calls.activity++;return{id:'action-one',events:[]};},
    markConversationRead:async(...args)=>{calls.read.push(args);},sendMessage:async(...args)=>{calls.writes.push(args);},
  };
  const controller=createController({state,api,storage:null});
  t.after(()=>controller.dispose());
  return{state,api,calls,controller,page,setExecution:value=>{current=value;}};
}

test('mobile main chat updates one temporary Markdown response without adding saved messages or forward/read targets',async t=>{
  const f=fixture(t);await f.controller.actions.chat({id:'one'});
  let html=render(f.state);
  assert.match(html,/data-response-id="action-one:assistant"/);
  assert.match(html,/第一段/);
  f.setExecution(execution('第一段\n\n**第二段**'));await f.controller.refresh();
  html=render(f.state);
  assert.equal((html.match(/data-response-id=/g)||[]).length,1);
  assert.match(html,/<strong>第二段<\/strong>/);
  const bubble=html.match(/<article[^>]+data-response-id=[\s\S]*?<\/article>/)?.[0]||'';
  assert.doesNotMatch(bubble,/data-message-id|data-forwardable-message|message-menu|forward-toggle/);
  assert.deepEqual(f.state.messages,history);
  await f.controller.actions['mark-thread-read']({conversationId:'chat-one',messageId:'action-one:assistant'});
  await f.controller.actions['message-menu']({id:'action-one:assistant'});
  assert.deepEqual(f.calls.read,[]);assert.deepEqual(f.calls.writes,[]);assert.equal(f.state.forward,null);
});

test('terminal snapshots remove temporary text and display the saved answer exactly once',async t=>{
  const f=fixture(t);await f.controller.actions.chat({id:'one'});
  f.setExecution(execution('最终正文',{status:'succeeded'}));
  f.api.conversationPage=async id=>({...f.page(id),messages:[...history,{id:'saved-answer',role:'assistant',content:'最终正文'}]});
  await f.controller.refresh();const html=render(f.state);
  assert.doesNotMatch(html,/data-response-id=/);assert.equal((html.match(/最终正文/g)||[]).length,1);
  for(const status of ['failed','cancelled','expired','unknown']){
    f.state.conversation.execution=execution('终态旧片段',{status});assert.doesNotMatch(render(f.state),/终态旧片段/);
  }
});

test('mobile response projection excludes non-assistant channels and escapes untrusted Markdown HTML',async t=>{
  const f=fixture(t);await f.controller.actions.chat({id:'one'});
  for(const channel of ['reasoning','tool','stdout']){
    f.state.conversation.execution=execution('PRIVATE',{stream:stream('PRIVATE',1,{channel})});
    assert.doesNotMatch(render(f.state),/PRIVATE|data-response-id=/);
  }
  f.state.conversation.execution=execution('<script>unsafe</script>');
  assert.match(render(f.state),/&lt;script&gt;unsafe&lt;\/script&gt;/);assert.doesNotMatch(render(f.state),/<script>/);
});

test('workspace group renders active member streams and lets saved member outcomes replace them',()=>{
  const members=[{employeeId:'one',name:'员工甲',runtime:'Hermes'},{employeeId:'two',name:'员工乙',runtime:'DSH'}];
  const one={actionId:'action-one',employeeId:'one',runtime:'Hermes',status:'running',stream:stream('第一位正文')};
  const two={actionId:'action-two',employeeId:'two',runtime:'DSH',status:'acked',stream:stream('第二位正文',2,{responseId:'action-two:assistant'})};
  const state={page:'workspace-group',workspace:{role:'member'},workspaceGroups:{group:{id:'mix_one',title:'一起工作',members,messages:[],runs:[one,two]}}};
  let html=renderWorkspaceGroups(state);
  assert.equal((html.match(/data-response-id=/g)||[]).length,2);assert.match(html,/第一位正文/);assert.match(html,/第二位正文/);
  one.status='succeeded';state.workspaceGroups.group.messages=[{id:'saved-result',role:'assistant',employeeId:'one',actionId:'action-one',text:'第一位最终正文'}];
  html=renderWorkspaceGroups(state);assert.equal((html.match(/data-response-id=/g)||[]).length,1);assert.doesNotMatch(html,/第一位正文/);assert.equal((html.match(/第一位最终正文/g)||[]).length,1);
});

test('one scheduler polls active chat snapshots each second while workspace and activity refresh keep their eight-second cadence',async t=>{
  t.mock.timers.enable({apis:['setInterval']});
  const f=fixture(t);await f.controller.boot();await f.controller.actions.chat({id:'one'});await tick();
  const initial={chat:f.calls.chat.length,employees:f.calls.employees,activity:f.calls.activity};
  f.setExecution(execution('第二秒新正文'));
  t.mock.timers.tick(1000);await tick();
  assert.equal(f.calls.chat.length,initial.chat+1);assert.match(render(f.state),/第二秒新正文/);
  assert.equal(f.calls.employees,initial.employees);assert.equal(f.calls.activity,initial.activity);
  f.state.chatInteractions.requests=[{requestId:'waiting-fixture'}];
  f.setExecution(execution('已完成',{status:'succeeded'}));
  t.mock.timers.tick(1000);await tick();const settled=f.calls.chat.length;
  assert.deepEqual(f.state.chatInteractions.requests,[]);
  t.mock.timers.tick(1000);await tick();assert.equal(f.calls.chat.length,settled);
  t.mock.timers.tick(5000);await tick();
  assert.equal(f.calls.employees,initial.employees+1);assert.equal(f.calls.chat.length,settled+1);
});

test('fast snapshot reads are deduplicated and a late answer cannot populate a different employee',async t=>{
  t.mock.timers.enable({apis:['setInterval']});
  const f=fixture(t);await f.controller.boot();await f.controller.actions.chat({id:'one'});await tick();
  const pending=deferred();f.api.conversationPage=(id,options)=>{f.calls.chat.push({id,signal:options.signal});return id==='chat-one'?pending.promise:Promise.resolve({...f.page(id),execution:null});};
  const before=f.calls.chat.length;t.mock.timers.tick(1000);await tick();
  const old=f.calls.chat.at(-1);t.mock.timers.tick(1000);await tick();assert.equal(f.calls.chat.length,before+1);
  await f.controller.actions.chat({id:'two'});assert.equal(old.signal.aborted,true);
  pending.resolve({...f.page('chat-one'),execution:execution('OLD_SCOPE_REPLY')});await tick();
  assert.equal(f.state.conversation.id,'chat-two');assert.doesNotMatch(render(f.state),/OLD_SCOPE_REPLY|data-response-id=/);
});

test('the shared scheduler also updates running workspace group members each second and stops fast polling at settlement',async t=>{
  t.mock.timers.enable({apis:['setInterval']});
  const f=fixture(t);let reads=0;
  let group={id:'mix_one',title:'一起工作',workspace:'workspace-one',members:[{employeeId:'one',name:'员工甲',runtime:'DSH'}],messages:[],runs:[{actionId:'action-one',employeeId:'one',runtime:'DSH',status:'running',stream:stream('群回复第一段')}]};
  f.api.mixedGroups=async()=>({groups:[group]});f.api.mixedGroup=async()=>{reads++;return group;};
  await f.controller.boot();await f.controller.actions['groups-open']();await f.controller.actions['workspace-group-open']({id:'mix_one'});
  assert.match(renderWorkspaceGroups(f.state),/群回复第一段/);
  group={...group,runs:[{...group.runs[0],stream:stream('群回复第一段和第二段',2)}]};
  t.mock.timers.tick(1000);await tick();assert.equal(reads,2);assert.match(renderWorkspaceGroups(f.state),/群回复第一段和第二段/);
  group={...group,runs:[{...group.runs[0],status:'succeeded'}],messages:[{id:'saved-group',role:'assistant',employeeId:'one',actionId:'action-one',text:'正式群回复'}]};
  t.mock.timers.tick(1000);await tick();assert.equal(reads,3);
  const html=renderWorkspaceGroups(f.state);assert.doesNotMatch(html,/data-response-id=/);assert.equal((html.match(/正式群回复/g)||[]).length,1);
  t.mock.timers.tick(1000);await tick();assert.equal(reads,3);
});

test('a terminal fast snapshot immediately settles same-action activity, runs and Bot caches before auxiliary reads return',async t=>{
  t.mock.timers.enable({apis:['setInterval']});
  const f=fixture(t);await f.controller.boot();await f.controller.actions.chat({id:'one'});await tick();
  const cached={id:'action-one',type:'conversation.execute',status:'acked',payload:{employeeId:'one',conversationId:'chat-one'},events:[{type:'action.started',message:'开始工作'}]};
  const bot={id:'one',employee_id:'one',configuration_state:'initialized',control_state:'active',latest_run:cached,employee:{id:'one',name:'员工甲',runtime:'Hermes'}};
  f.state.bot=bot;f.state.bots=[bot];f.state.runs=[cached];f.state.selectedEmployee={...f.state.selectedEmployee,runtime:'Hermes',bot};
  f.state.chatActivity={actionId:'action-one',phase:'ready',action:cached,error:''};
  const held=deferred(),reads={bot:0,runs:0,routines:0,activity:0};
  f.api.bot=()=>{reads.bot++;return held.promise;};f.api.botRuns=()=>{reads.runs++;return held.promise;};f.api.botRoutines=()=>{reads.routines++;return held.promise;};
  f.api.conversationActivity=()=>{reads.activity++;return held.promise;};
  const complete=execution('正式回复',{status:'succeeded',events:[{type:'succeeded',message:'完成'}]});
  f.setExecution(complete);t.mock.timers.tick(1000);await tick();
  assert.equal(f.state.chatActivity.action.status,'succeeded');assert.equal(f.state.runs[0].status,'succeeded');assert.equal(f.state.bot.latest_run.status,'succeeded');
  assert.equal(blockingChatExecution(f.state),null);
  const html=render(f.state);assert.doesNotMatch(html,/class="run-panel|data-action="stop-run"|data-action-id="action-one" open/);
  assert.match(html,/执行已完成/);assert.deepEqual(reads,{bot:1,runs:1,routines:1,activity:1});
  t.mock.timers.tick(1000);await tick();assert.deepEqual(reads,{bot:1,runs:1,routines:1,activity:1});
  held.resolve(complete);
});

test('an old activity GET cannot resurrect a terminal action and another live action keeps its own occupancy',async t=>{
  t.mock.timers.enable({apis:['setInterval']});
  const f=fixture(t),old=deferred(),fresh=deferred();let reads=0;
  f.api.conversationActivity=()=>++reads===1?old.promise:fresh.promise;
  await f.controller.boot();await f.controller.actions.chat({id:'one'});
  const run={id:'action-one',status:'acked',payload:{employeeId:'one',conversationId:'chat-one'},events:[]};
  f.state.runs=[run,{...run,id:'other-action',payload:{employeeId:'one',conversationId:'another-chat'}}];
  const complete=execution('正式回复',{status:'succeeded',events:[{type:'succeeded'}]});
  f.setExecution(complete);t.mock.timers.tick(1000);await tick();
  assert.equal(reads,2);assert.equal(f.state.runs[0].status,'succeeded');assert.equal(f.state.runs[1].status,'acked');assert.equal(blockingChatExecution(f.state).id,'other-action');
  old.resolve(run);await tick();assert.equal(f.state.chatActivity.action.status,'succeeded');
  fresh.resolve(complete);await tick();assert.equal(f.state.chatActivity.action.status,'succeeded');
});
