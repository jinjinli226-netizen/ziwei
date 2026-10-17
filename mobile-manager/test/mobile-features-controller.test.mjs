import test from 'node:test';
import assert from 'node:assert/strict';
import {createController} from '../web/controller.js';
import {createApi} from '../web/api.js';
import {initialState} from '../web/model.js';
import {createChatPreferences} from '../web/chat-preferences.js';

const workspaces=[{id:'workspace_1',slug:'work-one',role:'owner'},{id:'workspace_2',slug:'work-two',role:'owner'}];
const employees=[{id:'employee_one',name:'员工甲',runtime:'Other'}];
const eventId='event_original';
const item=(target={kind:'conversation',id:'original_chat',employeeId:'employee_one',messageId:'original_message'})=>({id:eventId,kind:'execution.completed',title:'工作已完成',summary:'查看结果',createdAt:'2026-10-17T11:00:00.000Z',executionState:'confirmed',target});
const envelope=(slug='work-one',extra={})=>({schemaVersion:1,accountId:'user_one',workspaceId:workspaces.find(row=>row.slug===slug).id,workspaceSlug:slug,...extra});
function storageFixture(){const values=new Map();return {get length(){return values.size;},key:i=>[...values.keys()][i],getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k),values};}
function deferred(){let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};}
function fixture(t,overrides={}){
  const state={...initialState(),phase:'ready',user:{user_id:'user_one'},workspace:workspaces[0],workspaces,employees:[...employees]},storage=storageFixture(),calls=[],nativeCalls=[];
  const api={
    employees:async()=>({employees}),bots:async()=>({bots:[]}),tasks:async()=>({tasks:[]}),chats:async()=>({chats:[]}),
    conversation:async id=>{calls.push(['conversation',id]);return {id,employee_id:'employee_one',messages:[{id:'original_message',role:'user',content:'原消息'}]};},
    getEmployeeConversation:async()=>({id:'latest_chat',employee_id:'employee_one',messages:[]}),
    mobileNotifications:async slug=>envelope(slug,{items:[item()],nextCursor:'Zmlyc3Q',hasMore:false,historyWindow:true}),
    mobileNotification:async(slug,id)=>{calls.push(['resolve',slug,id]);return envelope(slug,{item:item()});},
    task:async id=>({id,workspace_id:'workspace_1',title:'原待办',state:'planned'}),logout:async()=>({ok:true}),
    ...overrides,
  };
  const native={getStatus:()=>JSON.stringify({available:false,enabled:false}),clear:()=>{nativeCalls.push('clear');}};
  const controller=createController({state,api,storage,nativeNotifications:native});t.after(()=>controller.dispose());return {state,storage,api,calls,nativeCalls,controller};
}

test('feature entries flush the current chat draft before leaving and keep their own page',async t=>{
  const f=fixture(t);await f.controller.actions.chat({id:'employee_one'});await f.controller.change({name:'draft',value:'继续写的草稿'});
  await f.controller.actions['groups-open']();assert.equal(f.state.page,'groups');assert.equal(f.state.selectedEmployee,null);
  assert.equal(createChatPreferences({storage:f.storage}).getDraft({accountId:'user_one',workspaceId:'work-one'},'employee_one'),'继续写的草稿');
  await f.controller.actions['mobile-task-new']();assert.equal(f.state.page,'mobile-task-new');
  await f.controller.actions['notifications-open']();assert.equal(f.state.page,'notifications');assert.equal(f.state.notifications.items.length,1);
});

test('notification resolves the original event before opening its exact chat and message',async t=>{
  const f=fixture(t);await f.controller.actions['notifications-open']();await f.controller.actions['notifications-target']({id:eventId});
  assert.deepEqual(f.calls,[['resolve','work-one',eventId],['conversation','original_chat']]);
  assert.equal(f.state.page,'chat');assert.equal(f.state.conversation.id,'original_chat');assert.equal(f.state.chatJump.messageId,'original_message');
  assert.deepEqual(f.state.notifications.readIds,[eventId]);
});

test('notification opens the fresh resolve target rather than its cached list target',async t=>{
  const f=fixture(t,{mobileNotification:async()=>envelope('work-one',{item:item({kind:'task',id:'original_task'})})});
  await f.controller.actions['notifications-open']();await f.controller.actions['notifications-target']({id:eventId});
  assert.equal(f.state.page,'task');assert.equal(f.state.task.id,'original_task');assert.equal(f.calls.length,0);
});

test('a revoked notification does not navigate or mark its cached target read',async t=>{
  const f=fixture(t,{mobileNotification:async()=>{throw Object.assign(new Error('当前无法查看此提醒'),{status:404});}});
  await f.controller.actions['notifications-open']();await f.controller.actions['notifications-target']({id:eventId});
  assert.equal(f.state.page,'notifications');assert.deepEqual(f.state.notifications.readIds,[]);assert.equal(f.calls.length,0);
});

test('logout clears the system subscription and rejects an old event resolve result',async t=>{
  const pending=deferred(),f=fixture(t,{mobileNotification:()=>pending.promise});
  await f.controller.actions['notifications-open']();const opening=f.controller.actions['notifications-target']({id:eventId});
  await f.controller.actions.logout();pending.resolve(envelope('work-one',{item:item()}));await opening;
  assert.equal(f.state.phase,'login');assert.equal(f.state.notifications,null);assert(f.nativeCalls.includes('clear'));assert.equal(f.calls.length,0);
});

test('old workspace resolve cannot open a conversation after choosing another workspace',async t=>{
  const pending=deferred(),f=fixture(t,{mobileNotification:()=>pending.promise});
  await f.controller.actions['notifications-open']();const opening=f.controller.actions['notifications-target']({id:eventId});
  await f.controller.actions['select-workspace']({id:'work-two'});pending.resolve(envelope('work-one',{item:item()}));await opening;
  assert.equal(f.state.workspace.slug,'work-two');assert.equal(f.state.page,'home');assert.equal(f.calls.length,0);
});

test('a task detail with mismatched identity cannot be opened from a notification',async t=>{
  const f=fixture(t,{mobileNotification:async()=>envelope('work-one',{item:item({kind:'task',id:'original_task'})}),task:async()=>({id:'another_task',workspace_id:'workspace_1'})});
  await f.controller.actions['notifications-open']();await f.controller.actions['notifications-target']({id:eventId});assert.equal(f.state.page,'notifications');assert.deepEqual(f.state.notifications.readIds,[]);
});

test('mobile APIs encode identifiers and request only explicit mobile action projection',async()=>{
  const calls=[],api=createApi({fetchImpl:async(path,options)=>{calls.push({path,method:options.method,body:options.body});return {ok:true,status:200,headers:{get:()=>null},json:async()=>({})};}});
  await api.managementAction('work/one','action?one');await api.mobileNotifications('work/one',{cursor:'a_b',limit:20});await api.mobileNotification('work/one','event?one');
  await api.botNativeAction('work/one','employee/one',{resource:'groups'});await api.collaborateBot('work/one','employee/one',{mode:'group'});
  assert.deepEqual(calls.map(row=>[row.path,row.method]),[
    ['/api/workspaces/work%2Fone/actions/action%3Fone?view=mobile','GET'],
    ['/api/workspaces/work%2Fone/mobile/notifications?cursor=a_b&limit=20','GET'],
    ['/api/workspaces/work%2Fone/mobile/notifications/event%3Fone','GET'],
    ['/api/workspaces/work%2Fone/bots/employee%2Fone/native/actions','POST'],
    ['/api/workspaces/work%2Fone/bots/employee%2Fone/collaboration','POST'],
  ]);
});

test('an unavailable Bot list item preserves its prior execution and other employees still refresh',async t=>{
  const old={id:'employee_one',configuration_state:'initialized',latest_run:{id:'original_action',status:'running'}},
    f=fixture(t,{bots:async()=>({bots:[{id:'employee_one',employee_id:'employee_one',workspace:'work-one',resourceState:'unavailable',readError:{code:'GROUP_MOBILE_SCOPE_REQUIRED',message:'群组暂不可读'}},{id:'employee_two',configuration_state:'initialized',latest_run:{id:'second_action',status:'succeeded'}}]})});
  f.state.bots=[old];f.state.employees=[{...employees[0],bot:old}];await f.controller.actions.navigate({tab:'employees'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.state.bots.find(row=>row.id==='employee_one'),old);assert.equal(f.state.employees[0].bot.latest_run.status,'running');
  assert.equal(f.state.bots.find(row=>row.id==='employee_two').latest_run.id,'second_action');assert.equal(f.state.resources.bots.phase,'error');
});
