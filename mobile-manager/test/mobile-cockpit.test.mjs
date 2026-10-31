import test from 'node:test';
import assert from 'node:assert/strict';
import {createApi} from '../web/api.js';
import {createController} from '../web/controller.js';
import {initialState, blockingChatExecution} from '../web/model.js';
import {createChatPreferences} from '../web/chat-preferences.js';

const response = data => new Response(JSON.stringify(data), {headers:{'content-type':'application/json'}});
const deferred = () => {let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const form = draft => {const value=new FormData();value.set('draft',draft);return value;};
const message = number => ({id:`m${number}`,role:'assistant',content:`消息${number}`,created_at:new Date(1700000000000+number*1000).toISOString()});
const queue = (paused=false, items=[]) => ({paused,items,count:items.length});
function page(first=1,last=10,{id='main',employeeId='employee',total=last,hasMore=first>1,...extra}={}) {
  const messages=Array.from({length:Math.max(0,last-first+1)},(_,index)=>message(first+index));
  return {id,employee_id:employeeId,messages,messagePage:{total,hasMore,beforeCursor:messages[0]?.id||null},queue:queue(),...extra};
}
function memoryStorage() {
  const values=new Map();
  return {get length(){return values.size;},key:index=>[...values.keys()][index]??null,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
}
function fixture(t,{state:overrides={},api:apiOverrides={},storage=memoryStorage()}={}) {
  const employee={id:'employee',name:'员工甲',runtime:'Other',main_conversation_id:'main'};
  const workspace={slug:'workspace',workspace_id:'workspace-id',role:'owner'};
  const state={...initialState(),phase:'ready',user:{user_id:'user'},workspace,workspaces:[workspace,{slug:'other',workspace_id:'other-id',role:'owner'}],employees:[employee],...overrides};
  const api={employees:async()=>({employees:state.employees}),bots:async()=>({bots:[]}),tasks:async()=>({tasks:[]}),devices:async()=>({devices:[]}),chats:async()=>({chats:[],unreadCount:0}),
    conversationPage:async id=>page(1,10,{id}),
    conversation:async()=>{throw new Error('移动聊天不应读取全历史');},
    getEmployeeConversation:async()=>{throw new Error('已有主会话不应创建或重新解析会话');},
    createConversation:async()=>{throw new Error('会话切换不能创建会话');},
    conversations:async()=>({conversations:[{id:'main',employee_id:'employee',status:'active'},{id:'second',employee_id:'employee',status:'active'}]}),
    ...apiOverrides};
  const controller=createController({state,api,storage});
  t.after(()=>controller.dispose());
  return {state,api,storage,controller};
}
const open = fixture => fixture.controller.actions.chat({id:'employee'});
async function switchSession(f,id) {
  await f.controller.actions['chat-sessions']();
  await f.controller.actions['chat-session-open']({id});
}

test('mobile API encodes thread cursors and queue/stop operations with exact methods and bodies',async t=>{
  const calls=[],id='chat/a',scope=new AbortController();
  const api=createApi({identity:null,readTimeoutMs:0,fetchImpl:async(url,options)=>{
    calls.push({url,options});return response(url.includes('?')?page(1,2,{id}):{queue:queue()});
  }});t.after(()=>api.dispose());
  await api.conversationPage(id,{before:'message/b',limit:20,signal:scope.signal});
  await api.pauseConversationQueue(id);await api.resumeConversationQueue(id);
  await api.removeConversationQueueItem(id,'action/c');await api.stopConversationExecution(id,'original-action');
  assert.deepEqual(calls.map(({url,options})=>[url,options.method]),[
    ['/api/conversations/chat%2Fa?view=thread&limit=20&before=message%2Fb','GET'],
    ['/api/conversations/chat%2Fa/queue/pause','POST'],['/api/conversations/chat%2Fa/queue/resume','POST'],
    ['/api/conversations/chat%2Fa/queue/action%2Fc','DELETE'],['/api/conversations/chat%2Fa/execution/stop','POST'],
  ]);
  assert.equal(calls[0].options.signal,scope.signal);
  assert.deepEqual(JSON.parse(calls[1].options.body),{});assert.equal(calls[3].options.body,undefined);
  assert.deepEqual(JSON.parse(calls[4].options.body),{expectedActionId:'original-action'});
});

for(const authoritative of [true,false])test(`page-enabled employee resolution reads ten messages without creating a session (main ID ${authoritative})`,async t=>{
  const calls=[];
  const api=createApi({identity:null,readTimeoutMs:0,fetchImpl:async(url,options)=>{
    calls.push([url,options.method]);
    return response(url.includes('?employeeId=')?{conversations:[{id:'main',employee_id:'employee',status:'active'}]}:page(11,20,{total:20}));
  }});t.after(()=>api.dispose());
  const result=await api.getEmployeeConversation('workspace',{id:'employee',runtime:'Other',...(authoritative?{main_conversation_id:'main'}:{})},{page:true});
  assert.equal(result.messages.length,10);assert.equal(result.messagePage.beforeCursor,'m11');
  assert.deepEqual(calls,authoritative?[['/api/conversations/main?view=thread&limit=10','GET']]:[
    ['/api/workspaces/workspace/conversations?employeeId=employee','GET'],['/api/conversations/main?view=thread&limit=10','GET'],
  ]);
});

test('controller first load requests a thread page and ordinary resolver opts into pagination',async t=>{
  const calls=[];const f=fixture(t,{api:{conversationPage:async(id,options)=>{calls.push([id,options]);return page(11,20);}}});
  await open(f);assert.equal(calls.length,1);assert.equal(calls[0][0],'main');assert(calls[0][1].signal instanceof AbortSignal);
  assert.equal(f.state.messages.length,10);assert.equal(f.state.conversation.messagePage.hasMore,true);
  const ordinary=fixture(t,{state:{employees:[{id:'employee',runtime:'Other'}]},api:{getEmployeeConversation:async(_workspace,_employee,options)=>{
    assert.equal(options.page,true);assert(options.signal instanceof AbortSignal);return page(11,20);
  }}});
  await open(ordinary);assert.equal(ordinary.state.messages.length,10);assert.equal(ordinary.state.primaryConversationId,'main');
});

test('earlier pages remain ordered and deduplicated when the overlapping latest page is polled',async t=>{
  let latest=page(11,20,{total:20});const calls=[];
  const f=fixture(t,{api:{conversationPage:async(id,options)=>{
    calls.push({id,before:options.before});return options.before?page(1,10,{total:20,hasMore:false}):structuredClone(latest);
  }}});await open(f);await f.controller.actions['chat-history']();
  assert.equal(f.state.messages.length,20);assert.equal(f.state.conversation.messagePage.hasMore,false);
  latest=page(13,22,{total:22});latest.messages[0].content='服务端更新后的消息';
  await f.controller.refresh();
  assert.deepEqual(f.state.messages.map(item=>item.id),Array.from({length:22},(_,index)=>`m${index+1}`));
  assert.equal(f.state.messages.find(item=>item.id==='m13').content,'服务端更新后的消息');
  assert.equal(f.state.conversation.messagePage.beforeCursor,'m1');assert.equal(f.state.conversation.messagePage.total,22);
  assert.equal(f.state.conversation.messagePage.hasMore,false);assert.equal(calls[1].before,'m11');
});

test('more than ten replies during disconnect reset a discontinuous window and all missing history can reload',async t=>{
  let latest=page(1,10,{hasMore:false});const cursors=[];
  const f=fixture(t,{api:{conversationPage:async(_id,options)=>{
    if(options.before){cursors.push(options.before);return options.before==='m21'?page(11,20,{total:30}):page(1,10,{total:30,hasMore:false});}
    return structuredClone(latest);
  }}});await open(f);latest=page(21,30,{total:30});await f.controller.refresh();
  assert.deepEqual(f.state.messages.map(item=>item.id),latest.messages.map(item=>item.id));
  assert.equal(f.state.conversation.messagePage.hasMore,true);assert.equal(f.state.conversation.messagePage.beforeCursor,'m21');
  await f.controller.actions['chat-history']();await f.controller.actions['chat-history']();
  assert.deepEqual(cursors,['m21','m11']);assert.equal(f.state.messages.length,30);
  assert.deepEqual(f.state.messages.map(item=>item.id),Array.from({length:30},(_,index)=>`m${index+1}`));
  assert.equal(f.state.conversation.messagePage.hasMore,false);
});

test('an earlier-page response from a previous employee visit cannot merge into the new conversation',async t=>{
  const old=deferred();t.after(()=>old.resolve(page(1,10)));
  const f=fixture(t,{state:{employees:[{id:'employee',runtime:'Other',main_conversation_id:'main'},{id:'other',runtime:'Other',main_conversation_id:'other-chat'}]},api:{conversationPage:async(id,options)=>{
    if(options.before)return old.promise;return page(11,20,{id,employeeId:id==='main'?'employee':'other'});
  }}});await open(f);const loading=f.controller.actions['chat-history']();
  await f.controller.actions.chat({id:'other'});old.resolve(page(1,10));await loading;
  assert.equal(f.state.conversation.id,'other-chat');assert.equal(f.state.messages.length,10);assert.equal(f.state.historyLoading,false);
});

test('a running employee accepts consecutive queued messages without stopping the original action',async t=>{
  const execution={id:'running',type:'conversation.execute',status:'acked',payload:{employeeId:'employee',conversationId:'main'}};
  const sent=[];let stopCalls=0;
  const f=fixture(t,{api:{conversationPage:async()=>page(1,10,{execution}),sendMessage:async(id,body)=>{
    sent.push({id,body});return {id:`sent-${sent.length}`,role:'user',content:body.content,queue:queue(false,[{id:`queued-${sent.length}`}])};
  },stopConversationExecution:async()=>{stopCalls++;}}});await open(f);
  assert.equal(blockingChatExecution(f.state).id,'running');
  await f.controller.submit('chat',form('第一条追加工作'));await f.controller.submit('chat',form('第二条追加工作'));
  assert.deepEqual(sent.map(value=>value.body.content),['第一条追加工作','第二条追加工作']);
  assert(sent.every(value=>value.id==='main'&&value.body.clientMessageId));assert.notEqual(sent[0].body.clientMessageId,sent[1].body.clientMessageId);
  assert.equal(stopCalls,0);assert.equal(f.state.draft,'');assert.equal(f.state.sending,false);assert.equal(f.state.error,'');
});

for(const unknown of [{status:'acked',result:{executionState:'uncertain'}},{status:'expired',acked_at:'2026-10-31T00:00:00Z'}])test(`queue support does not release a genuine unknown execution (${unknown.status})`,async t=>{
  let writes=0;const execution={id:'unknown',type:'conversation.execute',payload:{employeeId:'employee',conversationId:'main'},...unknown};
  const f=fixture(t,{api:{conversationPage:async()=>page(1,10,{execution}),sendMessage:async()=>{writes++;}}});await open(f);
  assert.equal(blockingChatExecution(f.state).id,'unknown');await f.controller.submit('chat',form('保留未发送内容'));
  assert.equal(writes,0);assert.equal(f.state.draft,'保留未发送内容');assert.match(f.state.error,/当前工作尚未结束/);
});

for(const operation of ['pause','remove'])test(`${operation} queue receipt survives polls started both before and during the mutation`,async t=>{
  const before=deferred(),during=deferred(),write=deferred();
  t.after(()=>{before.resolve(page());during.resolve(page());write.resolve({queue:queue()});});
  let reads=0;const initialQueue=queue(false,[{id:'queued',message_id:'m1'}]);
  const acceptedQueue=operation==='pause'?queue(true,initialQueue.items):queue(false,[]);
  const writes=[];
  const f=fixture(t,{api:{conversationPage:async()=>{
    reads++;if(reads===2)return before.promise;if(reads===3)return during.promise;
    return page(1,10,{queue:reads===1?initialQueue:acceptedQueue});
  },pauseConversationQueue:id=>{writes.push([id]);return write.promise;},removeConversationQueueItem:(id,actionId)=>{writes.push([id,actionId]);return write.promise;}}});
  await open(f);const pollingBefore=f.controller.refresh();
  const mutation=f.controller.actions[`queue-${operation}`]({id:'queued'});const pollingDuring=f.controller.refresh();
  assert.equal(reads,3);assert.equal(f.state.queueBusy,true);
  write.resolve({queue:acceptedQueue});await mutation;
  assert.deepEqual(f.state.conversation.queue,acceptedQueue);assert.equal(reads,4,'post-write read must not reuse a pre-write request');
  before.resolve(page(1,10,{queue:initialQueue}));during.resolve(page(1,10,{queue:initialQueue}));
  await Promise.all([pollingBefore,pollingDuring]);
  assert.deepEqual(f.state.conversation.queue,acceptedQueue);assert.equal(f.state.queueBusy,false);
  assert.deepEqual(writes,operation==='pause'?[['main']]:[['main','queued']]);
});

test('late queue receipt cannot overwrite a newly selected employee',async t=>{
  const receipt=deferred();t.after(()=>receipt.resolve({queue:queue(true)}));
  const f=fixture(t,{state:{employees:[{id:'employee',runtime:'Other',main_conversation_id:'main'},{id:'other',runtime:'Other',main_conversation_id:'other-chat'}]},api:{
    conversationPage:async id=>page(1,10,{id,employeeId:id==='main'?'employee':'other'}),pauseConversationQueue:()=>receipt.promise,
  }});await open(f);const mutation=f.controller.actions['queue-pause']();await f.controller.actions.chat({id:'other'});
  receipt.resolve({queue:queue(true)});await mutation;
  assert.equal(f.state.conversation.id,'other-chat');assert.equal(f.state.conversation.queue.paused,false);assert.equal(f.state.queueBusy,false);
});

for(const mainIdKnown of [true,false])test(`main and secondary drafts survive settings and restart (employee carries main ID ${mainIdKnown})`,async t=>{
  const storage=memoryStorage(),scope={accountId:'user',workspaceId:'workspace'};
  createChatPreferences({storage}).saveDraft(scope,'employee','旧版本主会话草稿');
  const sessionApi={conversationPage:async id=>page(1,2,{id}),getEmployeeConversation:async()=>page(1,2)};
  const state=mainIdKnown?{}:{employees:[{id:'employee',runtime:'Other'}]};
  const f=fixture(t,{storage,api:sessionApi,state});await open(f);assert.equal(f.state.draft,'旧版本主会话草稿');
  await f.controller.change({name:'draft',value:'主会话独立草稿'});await switchSession(f,'second');
  assert.equal(f.state.conversation.id,'second');assert.equal(f.state.draft,'');
  await f.controller.change({name:'draft',value:'第二会话独立草稿'});await f.controller.actions.settings();await f.controller.actions.back();
  assert.equal(f.state.conversation.id,'second');assert.equal(f.state.draft,'第二会话独立草稿');
  await switchSession(f,'main');assert.equal(f.state.draft,'主会话独立草稿');
  await f.controller.actions.settings();await f.controller.actions.back();assert.equal(f.state.draft,'主会话独立草稿');
  f.controller.dispose();
  const restored=fixture(t,{storage,api:sessionApi,state});await open(restored);assert.equal(restored.state.draft,'主会话独立草稿');
  await switchSession(restored,'second');assert.equal(restored.state.draft,'第二会话独立草稿');
});

test('session picker admits only existing active conversations for the selected employee',async t=>{
  const f=fixture(t,{api:{conversations:async()=>({conversations:[
    {id:'main',employee_id:'employee',status:'active'},{id:'second',employee_id:'employee',status:'active'},
    {id:'archived',employee_id:'employee',status:'archived'},{id:'foreign',employee_id:'another',status:'active'},
  ]})}});await open(f);await f.controller.actions['chat-sessions']();
  assert.deepEqual(f.state.chatSessions.items.map(item=>item.id),['main','second']);
  await f.controller.actions['chat-session-open']({id:'foreign'});assert.equal(f.state.conversation.id,'main');
  await f.controller.actions['chat-session-open']({id:'second'});assert.equal(f.state.conversation.id,'second');assert.equal(f.state.chatSessions,null);
});

test('DSH stop targets the original running conversation action and keeps confirmation pending',async t=>{
  const execution={id:'original-running',type:'conversation.execute',status:'acked',payload:{employeeId:'employee',conversationId:'main',runtime:'DSH'}};
  const requests=[];const receipt={sourceActionId:execution.id,stopRequested:true,stopConfirmed:false,action:{id:'stop-control',status:'pending'}};
  const f=fixture(t,{state:{employees:[{id:'employee',runtime:'DSH',main_conversation_id:'main'}]},api:{
    conversationPage:async()=>page(1,10,{execution}),stopConversationExecution:async(...args)=>{requests.push(args);return receipt;},
  }});await open(f);await f.controller.actions['stop-run']();
  assert.deepEqual(requests,[['main','original-running']]);assert.equal(f.state.conversationStop.stopConfirmed,false);
  assert.equal(blockingChatExecution(f.state).id,'original-running');assert.match(f.state.notice,/等待原执行终态确认/);
});
