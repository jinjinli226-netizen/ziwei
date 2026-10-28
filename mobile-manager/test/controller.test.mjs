import test from 'node:test';
import assert from 'node:assert/strict';
import {createController} from '../web/controller.js';
import {initialState} from '../web/model.js';
import {render as renderView} from '../web/view.js';

function memoryStorage() {
  const values = new Map();
  return {values, get length(){return values.size;}, key:index=>[...values.keys()][index] || null, getItem:key=>values.get(key) || null, setItem:(key,value)=>values.set(key,value), removeItem:key=>values.delete(key)};
}
function fixture(overrides = {}, apiOverrides = {}, storage = memoryStorage(), render = () => {}) {
  const employee = {id:'one', name:'员工甲', runtime:'Other'};
  const state = {...initialState(), phase:'ready', tab:'employees', user:{user_id:'user-one'}, workspace:{slug:'workspace-one',role:'owner'}, workspaces:[{slug:'workspace-one',role:'owner'},{slug:'workspace-two',role:'member'}], employees:[employee], ...overrides};
  const api = {
    employees:async()=>({employees:[employee]}), bots:async()=>({bots:[]}), tasks:async()=>({tasks:[]}), devices:async()=>({devices:[]}),
    chats:async()=>({chats:[],unreadCount:0}), markConversationRead:async(conversationId,{messageId})=>({conversationId,lastReadMessageId:messageId,unreadCount:0}),
    getEmployeeConversation:async(_workspace,value)=>({id:`conversation-${value.id}`, employee_id:value.id, messages:[]}),
    conversation:async conversationId=>({id:conversationId,employee_id:conversationId.replace('conversation-',''),messages:[]}),
    bot:async()=>{throw new Error('普通员工不应读取 Bot');}, logout:async()=>({ok:true}),
    ...apiOverrides,
  };
  const controller = createController({state,api,storage,render});
  return {state,api,storage,controller};
}
const form = values => {const data = new FormData();for(const [key,value] of Object.entries(values))data.set(key,value);return data;};
const deferred = () => {let resolve;const promise = new Promise(done=>resolve=done);return {promise,resolve};};
const tick = () => new Promise(resolve=>setImmediate(resolve));
async function promptly(promise) {
  let timer;
  try { return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('unrelated read blocked chat')),500);})]); }
  finally { clearTimeout(timer); }
}
function initializedFixture(apiOverrides = {}, render = () => {}) {
  const employee = {id:'one',name:'员工甲',runtime:'Hermes'};
  const bot = {id:'one',employee_id:'one',employee,configuration_state:'initialized',main_conversation_id:'original-main',revision:3,control_epoch:2};
  const f = fixture({employees:[{...employee,bot}],bots:[bot]}, {
    employees:async()=>({employees:[employee]}),bots:async()=>({bots:[bot]}),bot:async()=>bot,botRuns:async()=>({runs:[]}),botRoutines:async()=>({routines:[]}),
    conversation:async conversationId=>({id:conversationId,employee_id:employee.id,messages:[{id:'history',role:'assistant',content:'原主聊天历史'}]}),
    getEmployeeConversation:async()=>{throw new Error('已有 main ID 不应再次解析或创建会话');},
    ...apiOverrides,
  }, memoryStorage(), render);
  return {...f,bot};
}
const chatThread = (overrides = {}) => ({ conversationId:'original-main',employeeId:'one',employee:{id:'one',name:'员工甲',runtime:'Other'},title:'长期聊天',preview:'最新消息',updatedAt:'2026-10-17T08:00:00.000Z',unreadCount:1,latestMessageId:'history',messageCount:1,...overrides });

test('the initial product state opens the chat tab with explicit empty read and forward state', () => {
  const state = initialState();
  assert.equal(state.tab,'chat'); assert.deepEqual(state.chatThreads,[]); assert.equal(state.unreadCount,0);
  assert.deepEqual(state.chatThreadsResource,{phase:'idle',error:'',lastUpdated:null});
  assert.equal(state.forward,null); assert.equal(state.forwardDetail,null); assert.equal(state.chatReadError,'');
});

test('server inbox rows can open the canonical history before employees arrive, without resolving or creating a chat', async t => {
  const employees = deferred(), calls = [];
  const f = fixture({tab:'chat',employees:[]}, {
    employees:()=>employees.promise,
    chats:async()=>({chats:[chatThread()],unreadCount:1}),
    conversation:async conversationId=>{calls.push(conversationId);return {id:conversationId,employee_id:'one',messages:[{id:'history',role:'assistant',content:'原聊天'}]};},
    getEmployeeConversation:async()=>{throw new Error('不能新建替代聊天');},
  }); t.after(()=>{f.controller.dispose();employees.resolve({employees:[]});});
  await promptly(f.controller.refresh()); await tick();
  assert.equal(f.state.employees.length,0); assert.equal(f.state.chatThreads[0].employee.name,'员工甲');
  await promptly(f.controller.actions.chat({id:'one'}));
  assert.deepEqual(calls,['original-main']); assert.equal(f.state.conversation.id,'original-main'); assert.equal(f.state.messages[0].content,'原聊天');
  assert.equal(f.state.error,''); assert.equal(f.state.busy,false);
  employees.resolve({employees:[{id:'one',name:'员工更新名',runtime:'Other'}]}); await tick();
  assert.equal(f.state.selectedEmployee.name,'员工更新名'); assert.equal(f.state.conversation.id,'original-main');
});

test('inbox loading controls the chat tab spinner while neither employee rows nor opened history wait on it', async t => {
  const inbox = deferred();
  const f = fixture({tab:'chat'}, {chats:()=>inbox.promise});
  t.after(()=>{f.controller.dispose();inbox.resolve({chats:[],unreadCount:0});});
  await promptly(f.controller.refresh());
  assert.equal(f.state.chatThreadsResource.phase,'loading'); assert.equal(f.state.loading,true);
  await promptly(f.controller.actions.navigate({tab:'employees'}));
  assert.equal(f.state.loading,false); assert.equal(f.state.employees[0].id,'one');
  await promptly(f.controller.actions.chat({id:'one'}));
  assert.equal(f.state.conversation.id,'conversation-one'); assert.equal(f.state.chatLoading,false);
  await f.controller.change({name:'draft',value:'可以继续输入'}); assert.equal(f.state.draft,'可以继续输入');
  inbox.resolve({chats:[chatThread()],unreadCount:1}); await tick();
  assert.equal(f.state.messages.length,0); assert.equal(f.state.draft,'可以继续输入');
});

test('chat search is independent of employee search and navigation accepts the chat tab', async t => {
  const f = fixture({search:'员工筛选'}); t.after(()=>f.controller.dispose());
  await f.controller.actions.navigate({tab:'chat'}); await f.controller.change({name:'chatSearch',value:'最近话题'});
  assert.equal(f.state.tab,'chat'); assert.equal(f.state.chatSearch,'最近话题'); assert.equal(f.state.search,'员工筛选');
});

test('opening and polling history never mark it read until a guarded visible-message action arrives', async t => {
  const receipt = deferred(), reads = [], history = [{id:'history',role:'assistant',content:'保留的历史'}];
  const f = fixture({}, {
    conversation:async id=>({id,employee_id:'one',messages:history}),
    getEmployeeConversation:async()=>({id:'conversation-one',employee_id:'one',messages:history}),
    markConversationRead:(id,body)=>{reads.push([id,body]);return receipt.promise;},
  }); t.after(()=>{f.controller.dispose();receipt.resolve({conversationId:'conversation-one',lastReadMessageId:'history',unreadCount:0});});
  await f.controller.actions.chat({id:'one'}); await f.controller.refresh(); assert.deepEqual(reads,[]);
  for (const patch of [{imagePreview:'https://example.invalid/image.png'},{forwardDetail:{messageId:'history'}},{forward:{phase:'menu'}}]) {
    Object.assign(f.state,patch); await f.controller.actions['mark-thread-read']({conversationId:'conversation-one',messageId:'history'});
    f.state.imagePreview=null;f.state.forwardDetail=null;f.state.forward=null;
  }
  await f.controller.actions['mark-thread-read']({conversationId:'another',messageId:'history'});
  await f.controller.actions['mark-thread-read']({conversationId:'conversation-one',messageId:'absent'}); assert.deepEqual(reads,[]);
  const marking=f.controller.actions['mark-thread-read']({conversationId:'conversation-one',messageId:'history'});await tick();
  await promptly(f.controller.refresh()); assert.equal(f.state.messages,history); assert.equal(reads.length,1);
  receipt.resolve({conversationId:'conversation-one',lastReadMessageId:'history',unreadCount:0});await marking;
  await f.controller.actions['mark-thread-read']({conversationId:'conversation-one',messageId:'history'});assert.equal(reads.length,1);
});

test('a read receipt failure is local to the chat and cannot block loaded history', async t => {
  const f = fixture({}, {
    getEmployeeConversation:async()=>({id:'conversation-one',employee_id:'one',messages:[{id:'history',role:'assistant',content:'真实历史'}]}),
    markConversationRead:async()=>{throw new Error('已读同步暂不可用');},
  }); t.after(()=>f.controller.dispose()); await f.controller.actions.chat({id:'one'});
  const messages=f.state.messages;
  await f.controller.actions['mark-thread-read']({conversationId:'conversation-one',messageId:'history'});
  assert.equal(f.state.messages,messages);assert.equal(f.state.error,'');assert.equal(f.state.chatReadError,'已读同步暂不可用');
  await f.controller.actions.back();assert.equal(f.state.chatReadError,'');
});

test('a read 401 after opening another employee still clears the current account and all inbox state', async t => {
  const receipt=deferred();
  const f=fixture({employees:[{id:'one',runtime:'Other'},{id:'two',runtime:'Other'}]}, {
    getEmployeeConversation:async(_workspace,employee)=>({id:`conversation-${employee.id}`,employee_id:employee.id,messages:[{id:`history-${employee.id}`,role:'assistant',content:'历史'}]}),
    markConversationRead:()=>receipt.promise,
  });t.after(()=>f.controller.dispose());
  await f.controller.actions.chat({id:'one'});const pending=f.controller.actions['mark-thread-read']({conversationId:'conversation-one',messageId:'history-one'});await tick();
  await f.controller.actions.chat({id:'two'});
  receipt.resolve(Promise.reject(Object.assign(new Error('expired'),{status:401})));await pending;
  assert.equal(f.state.phase,'login');assert.equal(f.state.user,null);assert.deepEqual(f.state.chatThreads,[]);assert.equal(f.state.unreadCount,0);assert.equal(f.state.forward,null);
});

test('a native pause or hidden document prevents visible-message acknowledgements', async t => {
  const oldDocument=globalThis.document, oldAdd=globalThis.addEventListener, oldRemove=globalThis.removeEventListener;
  const handlers=new Map(),reads=[];
  globalThis.document={hidden:false,addEventListener(){},removeEventListener(){}};
  globalThis.addEventListener=(name,handler)=>handlers.set(name,handler);globalThis.removeEventListener=(name)=>handlers.delete(name);
  const f=fixture({}, {
    authMe:async()=>({user_id:'user-one'}),workspaces:async()=>({workspaces:[{slug:'workspace-one',role:'owner'}]}),
    getEmployeeConversation:async()=>({id:'conversation-one',employee_id:'one',messages:[{id:'history',role:'assistant',content:'历史'}]}),
    conversation:async id=>({id,employee_id:'one',messages:[{id:'history',role:'assistant',content:'历史'}]}),
    markConversationRead:async(id,{messageId})=>{reads.push(messageId);return {conversationId:id,lastReadMessageId:messageId,unreadCount:0};},
  });
  t.after(()=>{f.controller.dispose();globalThis.document=oldDocument;globalThis.addEventListener=oldAdd;globalThis.removeEventListener=oldRemove;});
  await f.controller.boot();await tick();await f.controller.actions.chat({id:'one'});
  handlers.get('ziwei:pause')();await f.controller.actions['mark-thread-read']({conversationId:'conversation-one',messageId:'history'});assert.deepEqual(reads,[]);
  handlers.get('ziwei:resume')();globalThis.document.hidden=true;await f.controller.actions['mark-thread-read']({conversationId:'conversation-one',messageId:'history'});assert.deepEqual(reads,[]);
  globalThis.document.hidden=false;await f.controller.actions['mark-thread-read']({conversationId:'conversation-one',messageId:'history'});assert.deepEqual(reads,['history']);
});

test('queued visibility acknowledgements stop when an overlay opens or the app pauses before the receipt', async t => {
  const oldDocument=globalThis.document,oldAdd=globalThis.addEventListener,oldRemove=globalThis.removeEventListener;
  const handlers=new Map();
  globalThis.document={hidden:false,addEventListener(){},removeEventListener(){}};
  globalThis.addEventListener=(name,handler)=>handlers.set(name,handler);globalThis.removeEventListener=name=>handlers.delete(name);
  t.after(()=>{globalThis.document=oldDocument;globalThis.addEventListener=oldAdd;globalThis.removeEventListener=oldRemove;});
  for (const blocker of ['forward','forwardDetail','imagePreview','hidden','paused']) {
    const first=deferred(),reads=[],messages=[{id:'m1',role:'assistant',content:'较早消息'},{id:'m3',role:'assistant',content:'较新消息'}];
    const f=fixture({}, {
      authMe:async()=>({user_id:'user-one'}),workspaces:async()=>({workspaces:[{slug:'workspace-one',role:'owner'}]}),
      getEmployeeConversation:async()=>({id:'conversation-one',employee_id:'one',messages}),
      conversation:async id=>({id,employee_id:'one',messages}),
      markConversationRead:(conversationId,{messageId})=>{reads.push(messageId);return reads.length===1?first.promise:Promise.resolve({conversationId,lastReadMessageId:messageId,unreadCount:0});},
    });
    try {
      await f.controller.boot();await tick();await f.controller.actions.chat({id:'one'});
      const pending=f.controller.actions['mark-thread-read']({conversationId:'conversation-one',messageId:'m1'});await tick();
      void f.controller.actions['mark-thread-read']({conversationId:'conversation-one',messageId:'m3'});
      if (blocker==='hidden') globalThis.document.hidden=true;
      else if (blocker==='paused') handlers.get('ziwei:pause')();
      else f.state[blocker]=blocker==='imagePreview'?'https://example.invalid/image.png':{phase:'menu',messageId:'m1'};
      first.resolve({conversationId:'conversation-one',lastReadMessageId:'m1',unreadCount:1});await pending;
      assert.deepEqual(reads,['m1'],`${blocker} must prevent the queued newer cursor from being sent`);
      if (blocker==='hidden') globalThis.document.hidden=false;
      else if (blocker==='paused') handlers.get('ziwei:resume')();
      else f.state[blocker]=null;
      await tick();assert.deepEqual(reads,['m1'],'restoring visibility alone must not mark the queued message');
      await f.controller.actions['mark-thread-read']({conversationId:'conversation-one',messageId:'m3'});assert.deepEqual(reads,['m1','m3']);
    } finally {f.controller.dispose();globalThis.document.hidden=false;}
  }
});

async function preparedForwardFixture(apiOverrides={}) {
  const source={id:'one',name:'源员工',runtime:'Other',main_conversation_id:'source-main'},target={id:'two',name:'目标员工',runtime:'Other'};
  const histories=[],forwards=[],sends=[],resolves=[];let inboxLoads=0;
  const sourceMessages=[{id:'first',role:'user',content:'原问题'},{id:'second',role:'assistant',content:'原回复'}];
  const f=fixture({employees:[source,target]}, {
    employees:async()=>({employees:[source,target]}),
    chats:async()=>{inboxLoads++;return {chats:[],unreadCount:0};},
    conversation:async id=>{histories.push(id);return {id,employee_id:id==='source-main'?'one':'two',messages:id==='source-main'?sourceMessages:[{id:'forward-saved',role:'user',content:'聊天记录'}]};},
    getEmployeeConversation:async(...args)=>{resolves.push(args);throw new Error('不能另建目标聊天');},
    forwardMessages:async(id,body)=>{forwards.push([id,body]);return {forward:{id:'forward-receipt',sourceConversationId:id,targetConversationId:'canonical-target-main',targetEmployeeId:'two',mode:body.mode},message:{id:'forward-saved',conversation_id:'canonical-target-main'}};},
    sendMessage:async(...args)=>{sends.push(args);throw new Error('转发不能走普通消息发送');},
    ...apiOverrides,
  });
  await f.controller.actions.chat({id:'one'});await f.controller.change({name:'draft',value:'保留源草稿'});
  await f.controller.actions['message-menu']({id:'second'});await f.controller.actions['forward-single']();await f.controller.actions['forward-target']({id:'two'});
  return {...f,sourceMessages,histories,forwards,sends,resolves,get inboxLoads(){return inboxLoads;}};
}

test('reference forwarding uses its atomic API, preserves the source composer and only explicitly opens the returned canonical target', async t => {
  const f=await preparedForwardFixture();t.after(()=>f.controller.dispose());
  const messages=f.state.messages,conversation=f.state.conversation;
  await f.controller.change({name:'forward-note',value:'先参考这段记录'});
  assert.equal(f.state.draft,'保留源草稿');
  await f.controller.submit('forward',form({'forward-note':'先参考这段记录','forward-mode':'reference',targetEmployeeId:'two'}));await tick();
  assert.equal(f.forwards.length,1);assert.equal(f.forwards[0][0],'source-main');assert.equal(f.forwards[0][1].mode,'reference');assert.deepEqual(f.forwards[0][1].messageIds,['second']);
  assert.equal(f.sends.length,0);assert.equal(f.resolves.length,0);assert.equal(f.state.messages,messages);assert.equal(f.state.conversation,conversation);assert.equal(f.state.draft,'保留源草稿');assert.equal(f.state.forward.phase,'complete');assert.equal(f.inboxLoads,1);
  assert.deepEqual(f.histories,['source-main']);
  f.state.chatThreads=[chatThread({employeeId:'two',employee:{id:'two',name:'目标员工',runtime:'Other'},conversationId:'stale-target-id'})];
  await f.controller.actions['forward-open-target']();
  assert.deepEqual(f.histories,['source-main','canonical-target-main']);assert.equal(f.resolves.length,0);assert.equal(f.state.selectedEmployee.id,'two');assert.equal(f.state.forward,null);
});

test('missing target identity in a forward receipt cannot fall back to resolving or creating another chat', async t => {
  const f=await preparedForwardFixture({forwardMessages:async()=>({forward:{targetEmployeeId:'two'}})});t.after(()=>f.controller.dispose());
  await f.controller.submit('forward',form({targetEmployeeId:'two'}));await f.controller.actions['forward-open-target']();
  assert.equal(f.resolves.length,0);assert.equal(f.state.conversation.id,'source-main');assert.equal(f.state.forward.phase,'uncertain');assert.match(f.state.forward.error,/保留原转发标识|原转发标识/);
});

test('source history polling synchronizes forward selections without touching the draft or dispatching', async t => {
  const f=await preparedForwardFixture();t.after(()=>f.controller.dispose());
  await f.controller.actions['forward-back']();await f.controller.actions['forward-back']();
  assert.equal(f.state.forward.phase,'select');
  f.api.conversation=async id=>({id,employee_id:'one',messages:[{id:'first',role:'user',content:'原问题'}]});
  await f.controller.refresh();assert.deepEqual(f.state.forward.selectedIds,[]);assert.match(f.state.forward.error,/重新选择/);
  assert.equal(f.state.draft,'保留源草稿');assert.equal(f.sends.length,0);assert.equal(f.forwards.length,0);
});

test('forward detail resolves only a current message id and back closes image, detail, forwarding then chat', async t => {
  const f=await preparedForwardFixture();t.after(()=>f.controller.dispose());
  await f.controller.actions['forward-cancel']();
  const record={id:'forward-record',role:'user',forward:{schemaVersion:1,source:{employeeName:'原员工'},messages:[{content:'只读快照'}]}};
  f.state.messages.push(record);
  assert.equal(await f.controller.actions['forward-detail']({id:'another'}),false);assert.equal(f.state.forwardDetail,null);
  await f.controller.actions['message-menu']({id:'first'});
  await f.controller.actions['forward-detail']({id:record.id});assert.deepEqual(f.state.forwardDetail,{messageId:'forward-record'});
  await f.controller.actions.image({src:'https://example.invalid/image.png'});
  await f.controller.actions.back();assert.equal(f.state.imagePreview,null);assert.equal(f.state.forwardDetail.messageId,record.id);assert.equal(f.state.forward.phase,'menu');
  await f.controller.actions.back();assert.equal(f.state.forwardDetail,null);assert.equal(f.state.forward.phase,'menu');
  await f.controller.actions.back();assert.equal(f.state.forward,null);assert.equal(f.state.page,'chat');assert.equal(f.state.draft,'保留源草稿');
  await f.controller.actions.back();assert.equal(f.state.page,'home');assert.equal(f.state.selectedEmployee,null);
});

test('switching workspace or logging out clears inbox, selection and only the explicitly logged-out account request keys', async t => {
  const f=await preparedForwardFixture();t.after(()=>f.controller.dispose());
  f.state.forwardDetail={messageId:'first'};f.state.chatReadError='old';f.state.chatSearch='old';f.state.chatThreads=[chatThread()];f.state.unreadCount=7;
  await f.controller.actions['select-workspace']({id:'workspace-two'});await tick();
  assert.equal(f.state.tab,'chat');assert.equal(f.state.forward,null);assert.equal(f.state.forwardDetail,null);assert.equal(f.state.chatReadError,'');assert.equal(f.state.chatSearch,'');assert.equal(f.state.unreadCount,0);
  f.storage.setItem('ziwei.manager.forward.v1:user-one:workspace-one:source-main','own');f.storage.setItem('ziwei.manager.forward.v1:another-user:workspace-one:source-main','kept');
  await f.controller.actions.logout();
  assert.equal(f.storage.getItem('ziwei.manager.forward.v1:user-one:workspace-one:source-main'),null);assert.equal(f.storage.getItem('ziwei.manager.forward.v1:another-user:workspace-one:source-main'),'kept');
  assert.equal(f.state.phase,'login');assert.deepEqual(f.state.chatThreads,[]);assert.equal(f.state.unreadCount,0);assert.equal(f.state.forward,null);
});

test('controller workspace changes invalidate an old inbox snapshot before the new one draws', async t => {
  const stale=deferred();
  const f=fixture({tab:'chat'}, {
    chats:workspace=>workspace==='workspace-one'?stale.promise:Promise.resolve({chats:[chatThread({conversationId:'new-workspace-chat'})],unreadCount:4}),
  });t.after(()=>f.controller.dispose());
  await f.controller.refresh();await tick();await f.controller.actions['select-workspace']({id:'workspace-two'});await tick();
  stale.resolve({chats:[chatThread({conversationId:'old-workspace-chat'})],unreadCount:99});await tick();
  assert.equal(f.state.chatThreads[0].conversationId,'new-workspace-chat');assert.equal(f.state.unreadCount,4);assert.equal(f.state.workspace.slug,'workspace-two');
});

test('accepted ordinary sends refresh the inbox independently even when the post-send history fails', async t => {
  const stale=deferred();let loads=0,sends=0;
  const f=fixture({}, {
    chats:()=>++loads===1?stale.promise:Promise.resolve({chats:[chatThread({preview:'已接受的新消息',unreadCount:0})],unreadCount:0}),
    sendMessage:async()=>{sends++;return {id:'accepted'};},
    conversation:async()=>{throw new Error('发送后的历史暂时不可用');},
  });t.after(()=>f.controller.dispose());
  await f.controller.refresh();await f.controller.actions.chat({id:'one'});
  await f.controller.submit('chat',form({draft:'新的普通消息'}));await tick();
  stale.resolve({chats:[chatThread({preview:'发送前的旧消息'})],unreadCount:1});await tick();
  assert.equal(sends,1);assert.equal(loads,2);assert.equal(f.state.chatThreads[0].preview,'已接受的新消息');assert.equal(f.state.unreadCount,0);
  assert.equal(f.state.employeeResources.conversation.phase,'error');assert.equal(f.state.error,'');assert.equal(f.state.draft,'');
});

test('a failed business send keeps the composer retry intent without treating it as an accepted inbox update', async t => {
  let loads=0;
  const f=fixture({}, {chats:async()=>{loads++;return {chats:[],unreadCount:0};},sendMessage:async()=>{throw new TypeError('发送回执丢失');}});t.after(()=>f.controller.dispose());
  await f.controller.actions.chat({id:'one'});await f.controller.submit('chat',form({draft:'待核对的原消息'}));
  assert.equal(loads,0);assert.equal(f.state.draft,'待核对的原消息');assert.match(f.state.error,/发送回执丢失/);
  assert([...f.storage.values.values()].some(value=>value.includes('clientMessageId')));
});

test('employee rows render before a deferred Bot status read and unrelated lists are lazy', async t => {
  const status = deferred(), frames = [], calls = [];
  const employee = {id:'loaded',name:'已返回的员工',runtime:'Other'};
  const f = fixture({employees:[]}, {
    employees:async()=>({employees:[employee]}), bots:()=>{calls.push('bots');return status.promise;},
    tasks:async()=>{calls.push('tasks');return {tasks:[]};}, devices:async()=>{calls.push('devices');return {devices:[]};},
  }, memoryStorage(), state=>frames.push(renderView(state)));
  t.after(()=>{f.controller.dispose();status.resolve({bots:[]});});
  const refreshing = f.controller.refresh();await tick();
  assert.equal(f.state.employees[0]?.id,'loaded','the employee response must be applied before auxiliary status settles');
  assert(frames.some(html=>html.includes('已返回的员工')&&html.includes('打开聊天')));
  assert.equal(f.state.loading,false);assert.deepEqual(calls,['bots']);
  await promptly(refreshing);
});

test('first employee load distinguishes pending, failed, genuinely empty and retained rows', async t => {
  const response=deferred();let attempts=0;
  const f=fixture({employees:[]},{employees:async()=>++attempts===1?response.promise:{employees:[]}});
  t.after(()=>f.controller.dispose());
  const loading=f.controller.refresh();
  assert.match(renderView(f.state),/正在读取员工/);assert.doesNotMatch(renderView(f.state),/还没有数字员工/);
  response.resolve(Promise.reject(new Error('员工接口暂时失败')));await loading;
  assert.match(renderView(f.state),/员工列表读取失败/);assert.match(renderView(f.state),/员工接口暂时失败/);assert.doesNotMatch(renderView(f.state),/还没有数字员工/);
  await f.controller.refresh();assert.match(renderView(f.state),/还没有数字员工/);
  f.state.employees=[{id:'cached',name:'缓存员工'}];f.api.employees=async()=>{throw new Error('员工列表超时');};
  await f.controller.refresh();assert.match(renderView(f.state),/缓存员工/);assert.match(renderView(f.state),/员工列表超时/);
});

test('Bot status failure keeps employee rows visible with a separate retryable error', async t => {
  const status=deferred();let attempts=0;
  const f=fixture({}, {bots:async()=>++attempts===1?status.promise:{bots:[]}});t.after(()=>f.controller.dispose());
  await f.controller.refresh();status.resolve(Promise.reject(new Error('状态读取超时')));await tick();
  assert.equal(f.state.resources.employees.phase,'ready');assert.equal(f.state.resources.bots.phase,'error');assert.equal(f.state.error,'');
  assert.match(renderView(f.state),/员工甲/);assert.match(renderView(f.state),/员工运行状态读取失败：状态读取超时/);
  await f.controller.refresh();await tick();assert.equal(attempts,2);assert.equal(f.state.resources.bots.phase,'ready');
});

for(const [tab,resource] of [['work','tasks'],['devices','devices']]) test(`pending ${resource} reads cannot block returning to the employee tab`, async t => {
  const slow=deferred();let reads=0;
  const f=fixture({}, {[resource]:()=>{reads++;return slow.promise;},phones:async()=>({devices:[]})});
  t.after(()=>{f.controller.dispose();slow.resolve({[resource]:[]});});
  const navigation=f.controller.actions.navigate({tab});await tick();assert.equal(reads,1);assert.equal(f.state.resources[resource].phase,'loading');
  assert.match(renderView(f.state),resource==='tasks'?/正在读取工作任务/:/正在读取运行电脑/);
  assert.doesNotMatch(renderView(f.state),resource==='tasks'?/暂无工作任务/:/暂无运行电脑/);
  await promptly(f.controller.actions.navigate({tab:'employees'}));assert.match(renderView(f.state),/员工甲/);assert.equal(f.state.loading,false);
  slow.resolve(Promise.reject(new Error('该页面资源超时')));await navigation;
  assert.equal(f.state.resources[resource].phase,'error');assert.equal(f.state.error,'');assert.doesNotMatch(renderView(f.state),/该页面资源超时/);
  assert.match(renderView({...f.state,tab}),resource==='tasks'?/工作任务读取失败：该页面资源超时/:/运行电脑读取失败：该页面资源超时/);
});

test('a late Bot list cannot repopulate another workspace, while a current auxiliary 401 still requires login', async t => {
  const old=deferred();const fresh={id:'fresh-bot',employee_id:'new-employee'};
  const f=fixture({}, {bots:workspace=>workspace==='workspace-one'?old.promise:Promise.resolve({bots:[fresh]}),employees:async workspace=>({employees:[{id:workspace==='workspace-one'?'one':'new-employee'}]})});
  t.after(()=>f.controller.dispose());
  await f.controller.refresh();await f.controller.actions['select-workspace']({id:'workspace-two'});await f.controller.actions.navigate({tab:'employees'});await tick();
  old.resolve(Promise.reject(new Error('旧工作区状态超时')));await tick();
  assert.equal(f.state.workspace.slug,'workspace-two');assert.equal(f.state.bots[0].id,'fresh-bot');assert.equal(f.state.resources.bots.phase,'ready');assert.equal(f.state.error,'');
  f.api.bots=async()=>{throw Object.assign(new Error('expired'),{status:401});};
  await f.controller.refresh();await tick();assert.equal(f.state.phase,'login');assert.equal(f.state.user,null);assert.deepEqual(f.state.employees,[]);assert.equal(f.state.resources.bots.phase,'idle');
});

for(const resource of ['employees','bots']) test(`an old ${resource} list cannot replace a saved employee or Bot revision`, async t => {
  const old=deferred();let f;
  f=initializedFixture({[resource]:()=>old.promise,updateBot:async(_workspace,_employee,body)=>({...f.bot,revision:4,employee:{...f.bot.employee,...body.employee}})});
  t.after(()=>f.controller.dispose());
  const refreshing=f.controller.refresh();await tick();
  await f.controller.actions['employee-detail']({id:'one'});
  await f.controller.submit('employee',form({name:'已保存的新名字',description:'新说明'}));
  assert.equal(f.state.bot.revision,4);
  old.resolve(resource==='employees'?{employees:[f.bot.employee]}:{bots:[f.bot]});await refreshing;await tick();
  assert.equal(f.state.selectedEmployee.name,'已保存的新名字');assert.equal(f.state.employees[0].name,'已保存的新名字');assert.equal(f.state.bot.revision,4);assert.equal(f.state.bots[0].revision,4);
});

test('ordinary employee chat uses its existing identity and an employee switch ignores the old response', async t => {
  const old = deferred();
  const f = fixture({employees:[{id:'one',runtime:'Other'},{id:'two',runtime:'Other'}]}, {getEmployeeConversation:async(_ws,employee)=>employee.id==='one'?old.promise:{id:'conversation-two',employee_id:'two',messages:[]}});
  t.after(()=>f.controller.dispose());
  const pending = f.controller.actions.chat({id:'one'});
  await f.controller.actions.chat({id:'two'});
  old.resolve({id:'conversation-one',employee_id:'one',messages:[]});await pending;
  assert.equal(f.state.selectedEmployee.id,'two');assert.equal(f.state.conversation.id,'conversation-two');assert.equal(f.state.busy,false);
});

test('late workspace reads cannot populate another workspace', async t => {
  const old = deferred();
  const f = fixture({}, {employees:async workspace=>workspace==='workspace-one'?old.promise:{employees:[{id:'new-employee',runtime:'Other'}]}});
  t.after(()=>f.controller.dispose());
  const pending = f.controller.refresh();
  await f.controller.actions['select-workspace']({id:'workspace-two'});
  old.resolve({employees:[{id:'old-employee'}]});await pending;
  assert.equal(f.state.workspace.slug,'workspace-two');assert.equal(f.state.employees[0].id,'new-employee');
});

test('lost message response preserves the request ID across an app restart without storing message bytes', async t => {
  const storage = memoryStorage(), sent = [];
  const a = fixture({}, {sendMessage:async(_id,body)=>{sent.push(body);throw new TypeError('response lost');}}, storage);
  await a.controller.actions.chat({id:'one'});
  await a.controller.submit('chat',form({draft:'测试内容，只能保留摘要哈希'}));
  assert.equal(sent.length,1);assert.equal(a.state.draft,'测试内容，只能保留摘要哈希');
  const persisted = [...storage.values.values()].find(value=>value.includes('fingerprintHash'));
  assert(persisted);assert(!persisted.includes('测试内容'));assert.match(JSON.parse(persisted).fingerprintHash,/^[a-f0-9]{64}$/);
  a.controller.dispose();
  const b = fixture({}, {sendMessage:async(_id,body)=>{sent.push(body);return {id:'saved-message'};}}, storage);
  t.after(()=>b.controller.dispose());
  await b.controller.actions.chat({id:'one'});await b.controller.submit('chat',form({draft:'测试内容，只能保留摘要哈希'}));
  assert.equal(sent[0].clientMessageId,sent[1].clientMessageId);assert.equal(b.state.draft,'');
  assert(![...storage.values.values()].some(value=>value.includes('fingerprintHash')));
});

test('new message content gets a new ID, while unavailable storage prevents dispatch', async t => {
  const sent=[];
  const f=fixture({}, {sendMessage:async(_id,body)=>{sent.push(body);throw new TypeError('response lost');}});t.after(()=>f.controller.dispose());
  await f.controller.actions.chat({id:'one'});await f.controller.submit('chat',form({draft:'first'}));await f.controller.submit('chat',form({draft:'edited'}));
  assert.notEqual(sent[0].clientMessageId,sent[1].clientMessageId);
  const blocked=fixture({}, {sendMessage:async()=>{throw new Error('must not dispatch');}}, {getItem:()=>null,setItem:()=>{throw new Error('quota');}});t.after(()=>blocked.controller.dispose());
  await blocked.controller.actions.chat({id:'one'});await blocked.controller.submit('chat',form({draft:'keep this'}));
  assert.match(blocked.state.error,/无法保存发送标识/);assert.equal(blocked.state.draft,'keep this');
});

test('401 clears account-specific UI and member permissions cannot invoke phone commands', async t => {
  const f=fixture({}, {employees:async()=>{throw Object.assign(new Error('expired'),{status:401});}});t.after(()=>f.controller.dispose());
  await f.controller.refresh();assert.equal(f.state.phase,'login');assert.equal(f.state.user,null);assert.deepEqual(f.state.employees,[]);assert.deepEqual(f.state.messages,[]);
  let commands=0;const member=fixture({workspace:{slug:'workspace-one',role:'member'}}, {phoneCommand:async()=>{commands++;}});t.after(()=>member.controller.dispose());
  await member.controller.actions['phone-refresh']({id:'phone-one'});assert.equal(commands,0);assert.match(member.state.error,/管理员权限/);
});

test('image byte verification rejects spoofed files and limits the total attachment count', async t => {
  const f=fixture();t.after(()=>f.controller.dispose());await f.controller.actions.chat({id:'one'});
  await f.controller.change({name:'images',files:[{name:'fake.png',size:2,arrayBuffer:async()=>new Uint8Array([1,2]).buffer}],value:''});
  assert.match(f.state.error,/请选择 PNG/);assert.deepEqual(f.state.attachments,[]);
  f.state.attachments=Array.from({length:20},()=>({size:1}));
  await f.controller.change({name:'images',files:[{name:'new.png',size:1}],value:''});assert.match(f.state.error,/最多附加 20/);
});

test('existing report resumes with reads and explicit new report resets selection', async t => {
  let reads=0, selects=0;
  const f=fixture({report:{status:'active',queue:[{employeeId:'one'}],index:0}});
  const report=f.state.report;f.controller.dispose();
  const controller=createController({state:f.state,api:f.api,storage:f.storage,reporting:{refresh:async()=>{reads++;},select:(state,ids)=>{selects++;state.report={status:'selecting',queue:ids.map(employeeId=>({employeeId}))};}}});t.after(()=>controller.dispose());
  await controller.actions['report-setup']();assert.equal(f.state.report,report);assert.equal(f.state.page,'report');assert.equal(reads,1);assert.equal(selects,0);
  await controller.actions['report-new']();assert.equal(f.state.page,'report-setup');assert.equal(selects,1);
});

test('stop uses fresh revision and epoch, then refreshes only; routine retries keep an idempotency key', async t => {
  const bot={id:'one',employee_id:'one',configuration_state:'initialized',revision:9,control_epoch:4,employee:{id:'one',runtime:'Hermes'}}, controls=[], keys=[];
  let attempts=0;
  const f=fixture({employees:[{id:'one',runtime:'Hermes',bot}],selectedEmployee:{id:'one',runtime:'Hermes',bot},bot,routines:[{id:'r-one',status:'active'}],page:'detail'}, {
    bot:async()=>bot,bots:async()=>({bots:[bot]}),botRuns:async()=>({runs:[]}),botRoutines:async()=>({routines:[{id:'r-one',status:'active'}]}),
    controlBot:async(_ws,_id,body)=>{controls.push(body);return bot;},runRoutine:async(_ws,_id,_routine,body)=>{keys.push(body.idempotencyKey);if(!attempts++)throw new TypeError('lost');return {id:'run-one'};},
  });t.after(()=>f.controller.dispose());
  await f.controller.actions['stop-run']({id:'one'});assert.deepEqual(controls,[{operation:'stop',expectedRevision:9,expectedControlEpoch:4}]);
  await f.controller.actions['routine-run']({id:'r-one'});await f.controller.actions['routine-run']({id:'r-one'});assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);
});

test('refresh reads an existing screenshot command without sending the command again', async t => {
  let writes=0;const phone={id:'phone-one',commands:[{id:'command-one',status:'queued'}],nodes:[]};
  const f=fixture({tab:'devices',page:'phone',phone,phoneCommand:{id:'command-one',status:'queued'}}, {phones:async()=>({devices:[phone]}),phone:async()=>({device:phone}),phoneSnapshot:async()=>({snapshot:null}),phoneCommand:async()=>{writes++;return {command:{id:'unexpected'}};}});t.after(()=>f.controller.dispose());
  await f.controller.actions['phone-refresh']({id:phone.id});await f.controller.refresh();assert.equal(writes,0);
});

test('repeated device polling shares a pending phone read instead of overlapping snapshots', async t => {
  const pending=deferred();let reads=0;
  const f=fixture({tab:'devices'},{phones:()=>{reads++;return pending.promise;}});
  t.after(()=>{f.controller.dispose();pending.resolve({devices:[]});});
  await f.controller.refresh();await f.controller.refresh();
  assert.equal(reads,1,'the phone list must have its own in-flight guard');
  pending.resolve({devices:[]});await tick();
  await f.controller.refresh();assert.equal(reads,2,'a settled read must allow the next poll');
});

for(const lateFailure of [false,true]) test(`a pre-command phone ${lateFailure?'error':'snapshot'} cannot roll back a new screenshot or its receipt`, async t => {
  const old=deferred();let snapshots=0,details=0;
  const phone={id:'phone-one',commands:[],nodes:[]},command={id:'new-command',status:'succeeded',action:'screenshot'};
  const f=fixture({tab:'devices',page:'phone',phone,phones:[phone]}, {
    phones:async()=>({devices:[phone]}),phone:async()=>({device:{...phone,alias:++details===1?'旧状态':'新状态',commands:details===1?[]:[command]}}),
    phoneSnapshot:()=>++snapshots===1?old.promise:Promise.resolve({snapshot:{capturedAt:'new-snapshot'}}),
    phoneCommand:async()=>({command:{...command,status:'queued'}}),
  });t.after(()=>{f.controller.dispose();old.resolve({snapshot:{capturedAt:'old-snapshot'}});});
  await f.controller.refresh();await tick();assert.equal(snapshots,1);
  await f.controller.actions['phone-refresh']({id:phone.id});assert.equal(snapshots,2);
  assert.equal(f.state.phone.snapshot.capturedAt,'new-snapshot');assert.equal(f.state.phoneCommand.status,'succeeded');
  old.resolve(lateFailure?Promise.reject(new Error('旧截图超时')):{snapshot:{capturedAt:'old-snapshot'}});await tick();
  assert.equal(f.state.phone.snapshot.capturedAt,'new-snapshot');assert.equal(f.state.phone.alias,'新状态');assert.deepEqual(f.state.phone.commands,[command]);assert.equal(f.state.phoneCommand.status,'succeeded');
  assert.equal(f.state.phoneError,'');assert.equal(f.state.resources.phones.phase,'ready');
});

test('a deduplicated phone 401 clears the authenticated UI and allows no late phone write', async t => {
  const pending=deferred();const f=fixture({tab:'devices'},{phones:()=>pending.promise});t.after(()=>f.controller.dispose());
  await f.controller.refresh();await f.controller.refresh();pending.resolve(Promise.reject(Object.assign(new Error('expired'),{status:401})));await tick();
  assert.equal(f.state.phase,'login');assert.equal(f.state.user,null);assert.deepEqual(f.state.phones,[]);assert.equal(f.state.resources.phones.phase,'idle');
});

test('background refresh keeps loaded rows in place without inserting a loading banner', async t => {
  const pending=deferred();let attempts=0;
  const f=fixture({}, {employees:async()=>++attempts===1?{employees:[{id:'one',name:'员工甲'}]}:pending.promise});
  t.after(()=>{f.controller.dispose();pending.resolve({employees:[]});});
  await f.controller.refresh();await tick();const polling=f.controller.refresh({silent:true});
  assert.match(renderView(f.state),/员工甲/);assert.doesNotMatch(renderView(f.state),/正在更新员工列表/);
  pending.resolve({employees:[{id:'one',name:'员工甲'}]});await polling;
});

for (const resource of ['bot','botRuns','botRoutines']) test(`cached main history renders and input unlocks while ${resource} remains pending`, async t => {
  const slow=deferred(),drawn=[],calls=[];
  const f=initializedFixture({[resource]:()=>slow.promise,conversation:async conversationId=>{calls.push(conversationId);return {id:conversationId,employee_id:'one',messages:[{id:'history',role:'assistant',content:'原聊天内容'}]};}},state=>drawn.push({messages:[...state.messages],busy:state.busy,chatLoading:state.chatLoading}));
  t.after(()=>{slow.resolve(resource==='bot'?f.bot:resource==='botRuns'?{runs:[]}:{routines:[]});f.controller.dispose();});
  await promptly(f.controller.actions.chat({id:'one'}));
  assert.deepEqual(calls,['original-main'],'first screen must not issue a second conversation GET');
  assert.equal(f.state.conversation.id,'original-main');assert.equal(f.state.busy,false);assert.equal(f.state.chatLoading,false);
  assert(drawn.some(frame=>frame.messages.some(message=>message.id==='history')&&!frame.busy&&!frame.chatLoading),'visible history must not wait for auxiliary status');
  await f.controller.change({name:'draft',value:'仍然可以输入'});assert.equal(f.state.draft,'仍然可以输入');
});

test('history refresh draws independently of workspace lists, Bot state, runs and routines', async t => {
  const slow=deferred(),drawn=[];let calls=0,hold=false;
  const f=initializedFixture({
    employees:async()=>hold?slow.promise:{employees:[{id:'one',runtime:'Hermes'}]},
    bot:async()=>hold?slow.promise:f.bot,botRuns:async()=>hold?slow.promise:{runs:[]},botRoutines:async()=>hold?slow.promise:{routines:[]},
    conversation:async conversationId=>({id:conversationId,employee_id:'one',messages:[{id:`history-${++calls}`,role:'assistant',content:`历史第${calls}次读取`}]}),
  },state=>drawn.push(state.messages.map(message=>message.id)));
  t.after(()=>{f.controller.dispose();slow.resolve({});});
  await f.controller.actions.chat({id:'one'});await tick();hold=true;
  const pending=f.controller.refresh();await tick();
  assert.equal(f.state.messages[0].id,'history-2');assert(drawn.some(ids=>ids.includes('history-2')));
  assert.equal(f.state.busy,false);assert.equal(f.state.chatLoading,false);
  await f.controller.actions.back();slow.resolve({});await pending;
});

test('failed initial main read clears loading and refresh retries that original main without creating a replacement', async t => {
  let attempts=0;
  const f=initializedFixture({conversation:async conversationId=>{assert.equal(conversationId,'original-main');if(!attempts++)throw new Error('聊天读取暂时失败');return {id:conversationId,employee_id:'one',messages:[{id:'recovered',role:'assistant',content:'历史已恢复'}]};}});
  t.after(()=>f.controller.dispose());
  await f.controller.actions.chat({id:'one'});assert.equal(f.state.conversation,null);assert.equal(f.state.chatLoading,false);assert.equal(f.state.busy,false);assert.match(f.state.employeeResources.conversation.error,/读取暂时失败/);assert.equal(f.state.error,'');assert.match(renderView(f.state),/聊天记录同步失败：聊天读取暂时失败/);
  await f.controller.refresh();assert.equal(attempts,2);assert.equal(f.state.conversation.id,'original-main');assert.equal(f.state.messages[0].id,'recovered');assert.equal(f.state.error,'');assert.equal(f.state.employeeResources.conversation.error,'');
});

test('pending primary and auxiliary results cannot write after leaving the employee chat', async t => {
  const primary=deferred(),aux=deferred();
  const f=initializedFixture({conversation:()=>primary.promise,bot:()=>aux.promise,botRuns:()=>aux.promise,botRoutines:()=>aux.promise});t.after(()=>f.controller.dispose());
  const opening=f.controller.actions.chat({id:'one'});assert.equal(f.state.chatLoading,true);
  await f.controller.actions.back();
  primary.resolve({id:'original-main',employee_id:'one',messages:[{id:'too-late'}]});aux.resolve({...f.bot,runs:[{id:'late-run'}],routines:[{id:'late-routine'}]});
  await opening;await tick();
  assert.equal(f.state.page,'home');assert.equal(f.state.selectedEmployee,null);assert.equal(f.state.bot,null);assert.equal(f.state.conversation,null);assert.deepEqual(f.state.messages,[]);assert.deepEqual(f.state.runs,[]);assert.deepEqual(f.state.routines,[]);assert.equal(f.state.chatLoading,false);
});

test('late history refresh and status errors cannot replace a newly selected employee', async t => {
  const old=deferred(),oldRuns=deferred();let readingOld=false;
  const f=initializedFixture({conversation:async conversationId=>readingOld&&conversationId==='original-main'?old.promise:{id:conversationId,employee_id:conversationId==='original-main'?'one':'two',messages:[{id:conversationId}]},botRuns:async()=>readingOld?oldRuns.promise:{runs:[]},getEmployeeConversation:async(_workspace,employee)=>({id:'second-chat',employee_id:employee.id,messages:[{id:'second-history'}]})});
  f.state.employees.push({id:'two',runtime:'Other'});t.after(()=>f.controller.dispose());
  await f.controller.actions.chat({id:'one'});await tick();readingOld=true;
  const pending=f.controller.refresh();await tick();
  // The workspace list was refreshed while the old read is in flight.
  f.state.employees.push({id:'two',runtime:'Other'});await f.controller.actions.chat({id:'two'});
  old.resolve({id:'original-main',employee_id:'one',messages:[{id:'late-old-history'}]});oldRuns.resolve({runs:[{id:'late-old-run'}]});await pending;
  assert.equal(f.state.selectedEmployee.id,'two');assert.equal(f.state.conversation.id,'second-chat');assert.equal(f.state.messages[0].id,'second-history');assert.deepEqual(f.state.runs,[]);
});

test('auxiliary failures remain visible and an auxiliary 401 still clears the loaded chat', async t => {
  const failure=deferred();
  const f=initializedFixture({botRuns:()=>failure.promise});t.after(()=>f.controller.dispose());
  await f.controller.actions.chat({id:'one'});failure.resolve(Promise.reject(new Error('真实运行记录读取失败')));await tick();
  assert.equal(f.state.messages[0].id,'history');assert.match(f.state.employeeResources.runs.error,/运行记录读取失败/);assert.equal(f.state.error,'');assert.match(renderView(f.state),/运行记录更新失败：真实运行记录读取失败/);assert.equal(f.state.busy,false);
  const expired=initializedFixture({botRoutines:async()=>{throw Object.assign(new Error('expired'),{status:401});}});t.after(()=>expired.controller.dispose());
  await expired.controller.actions.chat({id:'one'});await tick();assert.equal(expired.state.phase,'login');assert.equal(expired.state.user,null);assert.deepEqual(expired.state.messages,[]);assert.equal(expired.state.chatLoading,false);
});

test('opening and repeated polling share one pending read for each employee auxiliary resource', async t => {
  const pending={bot:deferred(),runs:deferred(),routines:deferred()},calls={bot:0,runs:0,routines:0};
  const read=(name)=>{calls[name]++;return pending[name].promise;};
  const f=initializedFixture({bot:()=>read('bot'),botRuns:()=>read('runs'),botRoutines:()=>read('routines')});
  t.after(()=>{f.controller.dispose();pending.bot.resolve(f.bot);pending.runs.resolve({runs:[]});pending.routines.resolve({routines:[]});});
  await f.controller.actions.chat({id:'one'});
  await Promise.all([f.controller.refresh({silent:true}),f.controller.refresh({silent:true}),f.controller.refresh({silent:true})]);
  assert.deepEqual(calls,{bot:1,runs:1,routines:1});assert.equal(f.state.employeeResources.conversation.phase,'ready');assert.equal(f.state.messages[0].id,'history');
  pending.bot.resolve(f.bot);pending.runs.resolve({runs:[{id:'run'}]});pending.routines.resolve({routines:[{id:'routine'}]});await tick();
  for(const name of ['bot','runs','routines'])assert.equal(f.state.employeeResources[name].phase,'ready');
  await f.controller.refresh({silent:true});await tick();assert.deepEqual(calls,{bot:2,runs:2,routines:2});
});

for(const [name,method,label] of [['bot','bot','员工运行状态'],['runs','botRuns','运行记录'],['routines','botRoutines','例行工作']]) test(`${name} timeout is classified, visible and clears on recovery without changing loaded history`, async t => {
  const pending=deferred();let attempts=0;
  let f;const value=()=>name==='bot'?f.bot:{[name]:[{id:`fresh-${name}`} ]};
  f=initializedFixture({[method]:()=>++attempts===1?pending.promise:Promise.resolve(value())});
  t.after(()=>f.controller.dispose());
  await f.controller.actions.chat({id:'one'});await f.controller.refresh({silent:true});assert.equal(attempts,1);
  const requestPath=`/api/workspaces/workspace-one/bots/one/${name}`;
  pending.resolve(Promise.reject(Object.assign(new Error('读取超时，请刷新重试'),{code:'READ_TIMEOUT',requestPath,method:'GET',elapsedMs:20000,body:'must not retain body'})));await tick();
  const resource=f.state.employeeResources[name];
  assert.equal(resource.phase,'error');assert.equal(f.state.error,'');assert.equal(f.state.messages[0].id,'history');assert.match(renderView(f.state),new RegExp(`${label}更新失败：读取超时`));
  assert.deepEqual(resource.diagnostic,{requestPath,method:'GET',elapsedMs:20000,code:'READ_TIMEOUT'});
  await f.controller.refresh({silent:true});await tick();assert.equal(attempts,2);assert.equal(resource.phase,'ready');assert.equal(resource.error,'');assert.equal(resource.diagnostic,null);assert.doesNotMatch(renderView(f.state),new RegExp(`${label}更新失败`));
});

test('chat read timeout and recovery preserve the actual send failure and its retry intent', async t => {
  let readFails=false,sends=0;
  const f=initializedFixture({conversation:async()=>{if(readFails)throw Object.assign(new Error('读取超时，请刷新重试'),{code:'READ_TIMEOUT'});return {id:'original-main',employee_id:'one',messages:[{id:'kept-history'}]};},sendMessage:async()=>{sends++;throw new Error('发送未收到回执');}});t.after(()=>f.controller.dispose());
  await f.controller.actions.chat({id:'one'});await f.controller.submit('chat',form({draft:'保留并可按原标识重试'}));assert.equal(f.state.error,'发送未收到回执');
  readFails=true;await f.controller.refresh({silent:true});
  assert.equal(f.state.messages[0].id,'kept-history');assert.match(f.state.employeeResources.conversation.error,/读取超时/);assert.equal(f.state.error,'发送未收到回执');assert.match(renderView(f.state),/聊天记录同步失败：读取超时/);
  readFails=false;await f.controller.refresh();await tick();
  assert.equal(f.state.employeeResources.conversation.error,'');assert.equal(f.state.employeeResources.conversation.phase,'ready');assert.equal(f.state.error,'发送未收到回执');assert.equal(f.state.draft,'保留并可按原标识重试');assert.equal(sends,1);
});

test('an accepted send followed by a failed history read reports only a recoverable chat read error', async t => {
  let reads=0,sends=0;
  const f=initializedFixture({conversation:async()=>{if(++reads===2)throw new Error('发送后聊天回读超时');return {id:'original-main',employee_id:'one',messages:[{id:reads===1?'before':'sent'}]};},sendMessage:async()=>{sends++;return {id:'sent'};}});t.after(()=>f.controller.dispose());
  await f.controller.actions.chat({id:'one'});await f.controller.submit('chat',form({draft:'已接收的内容'}));
  assert.equal(sends,1);assert.equal(f.state.error,'');assert.equal(f.state.draft,'');assert.equal(f.state.employeeResources.conversation.error,'发送后聊天回读超时');assert.equal(f.state.messages[0].id,'before');
  await f.controller.refresh({silent:true});assert.equal(f.state.employeeResources.conversation.error,'');assert.equal(f.state.messages[0].id,'sent');assert.equal(sends,1);
});

test('successful reads preserve a failed employee save and the selected unsaved avatar', async t => {
  let writes=0;
  const f=initializedFixture({updateBot:async()=>{writes++;throw new Error('员工资料保存未收到回执');}});t.after(()=>f.controller.dispose());
  await f.controller.actions.chat({id:'one'});f.state.employeeAvatar='data:image/png;base64,cGVuZGluZw==';
  await f.controller.submit('employee',form({name:'未确认的名字',description:'保留草稿'}));assert.equal(f.state.error,'员工资料保存未收到回执');
  await f.controller.refresh({silent:true});await f.controller.refresh();await tick();
  assert.equal(f.state.error,'员工资料保存未收到回执');assert.equal(f.state.employeeSaving,false);assert.equal(f.state.employeeAvatar,'data:image/png;base64,cGVuZGluZw==');assert.equal(writes,1);
  for(const resource of Object.values(f.state.employeeResources))assert.equal(resource.error,'');
});

for(const change of ['employee','workspace']) test(`a late auxiliary 401 after switching ${change} observes the account and workspace boundary`, async t => {
  const pending=deferred();let reads=0;
  const f=initializedFixture({botRuns:()=>++reads===1?pending.promise:Promise.resolve({runs:[]}),getEmployeeConversation:async(_workspace,employee)=>({id:'second-main',employee_id:employee.id,messages:[{id:'second-history'}]})});t.after(()=>f.controller.dispose());
  await f.controller.actions.chat({id:'one'});
  if(change==='employee'){f.state.employees.push({id:'two',name:'员工乙',runtime:'Other'});await f.controller.actions.chat({id:'two'});}
  else await f.controller.actions['select-workspace']({id:'workspace-two'});
  pending.resolve(Promise.reject(Object.assign(new Error('expired'),{status:401})));await tick();
  if(change==='employee'){assert.equal(f.state.phase,'login');assert.equal(f.state.user,null);assert.deepEqual(f.state.messages,[]);}
  else {assert.equal(f.state.phase,'ready');assert.equal(f.state.workspace.slug,'workspace-two');assert.equal(f.state.error,'');}
});

for(const operation of ['save','stop']) for(const lateFailure of [false,true]) test(`old auxiliary ${lateFailure?'errors':'snapshots'} cannot roll back an accepted ${operation}`, async t => {
  const pending={bot:deferred(),runs:deferred(),routines:deferred()},calls={bot:0,runs:0,routines:0};let remote, f;
  const values=name=>name==='bot'?remote:{[name]:[{id:`current-${name}`}]};
  const read=name=>++calls[name]===1?pending[name].promise:Promise.resolve(values(name));
  const write=async()=>{remote={...f.bot,revision:4,control_epoch:3,employee:{...f.bot.employee,name:'写入后的名字'}};return remote;};
  f=initializedFixture({employees:async()=>({employees:[remote.employee]}),bot:()=>read('bot'),botRuns:()=>read('runs'),botRoutines:()=>read('routines'),updateBot:write,controlBot:write});remote=f.bot;t.after(()=>f.controller.dispose());
  await f.controller.actions.chat({id:'one'});
  if(operation==='save')await f.controller.submit('employee',form({name:'写入后的名字',description:'新简介'}));
  else await f.controller.actions['stop-run']({id:'one'});
  await f.controller.refresh({silent:true});await tick();assert.equal(f.state.bot.revision,4);assert.equal(f.state.selectedEmployee.name,'写入后的名字');
  for(const name of ['bot','runs','routines'])pending[name].resolve(lateFailure?Promise.reject(new Error('旧辅助读取超时')):name==='bot'?f.bot:{[name]:[]});
  await tick();
  assert.equal(f.state.bot.revision,4);assert.equal(f.state.bot.control_epoch,3);assert.equal(f.state.selectedEmployee.name,'写入后的名字');assert.equal(f.state.runs[0].id,'current-runs');assert.equal(f.state.routines[0].id,'current-routines');
  for(const name of ['bot','runs','routines'])assert.equal(f.state.employeeResources[name].error,'');assert.equal(f.state.error,'');
});

test('pending employee save prevents polling from starting replacement auxiliary reads', async t => {
  const save=deferred(),old=deferred();let reads=0;
  const f=initializedFixture({bot:()=>{reads++;return old.promise;},botRuns:()=>old.promise,botRoutines:()=>old.promise,updateBot:()=>save.promise});t.after(()=>{f.controller.dispose();old.resolve(f.bot);});
  await f.controller.actions.chat({id:'one'});const writing=f.controller.submit('employee',form({name:'已保存',description:''}));
  await f.controller.refresh({silent:true});await f.controller.refresh({silent:true});assert.equal(reads,1);assert.equal(f.state.employeeSaving,true);
  save.resolve({...f.bot,revision:4,employee:{...f.bot.employee,name:'已保存'}});await writing;
  old.resolve(f.bot);await tick();assert.equal(f.state.bot.revision,4);assert.equal(f.state.selectedEmployee.name,'已保存');assert.equal(f.state.employeeSaving,false);
});

test('an earlier employee stop cannot unlock or invalidate the current employee stop', async t => {
  const first=deferred(),second=deferred(),posts=[];let f;
  const remote=new Map();
  f=initializedFixture({
    employees:async()=>({employees:[...remote.values()].map(bot=>bot.employee)}),
    bot:async(_workspace,employeeId)=>remote.get(employeeId),
    conversation:async conversationId=>({id:conversationId,employee_id:conversationId==='original-main'?'one':'two',messages:[]}),
    controlBot:async(_workspace,employeeId)=>{posts.push(employeeId);const saved=await(employeeId==='one'?first.promise:second.promise);remote.set(employeeId,saved);return saved;},
  });
  const other={...f.bot,id:'two',employee_id:'two',employee:{id:'two',name:'员工乙',runtime:'Hermes'},main_conversation_id:'second-main'};
  remote.set('one',f.bot);remote.set('two',other);f.state.employees.push({...other.employee,bot:other});t.after(()=>f.controller.dispose());
  await f.controller.actions.chat({id:'one'});const oldStop=f.controller.actions['stop-run']({id:'one'});await tick();
  await f.controller.actions.chat({id:'two'});const newStop=f.controller.actions['stop-run']({id:'two'});await tick();assert.deepEqual(posts,['one','two']);
  first.resolve({...f.bot,revision:4,control_epoch:3});await oldStop;
  assert.equal(f.state.selectedEmployee.id,'two');assert.equal(f.state.stopBusy,true);assert.equal(f.state.notice,'');
  second.resolve({...other,revision:5,control_epoch:4});await newStop;
  assert.equal(f.state.stopBusy,false);assert.equal(f.state.bot.id,'two');assert.equal(f.state.bot.revision,5);assert.equal(f.state.employeeResources.bot.phase,'ready');
});

for (const lateFailure of [false,true]) test(`a pre-send history ${lateFailure?'error':'snapshot'} cannot replace the accepted message or its running execution`, async t => {
  const old=deferred();let reads=0;
  const before={id:'original-main',employee_id:'one',messages:[{id:'before',role:'assistant',content:'原消息'}]};
  const after={...before,messages:[...before.messages,{id:'sent',role:'user',content:'新消息'}],execution:{id:'new-execution',status:'acked'}};
  const drawn=[];
  const f=initializedFixture({conversation:async()=>++reads===1?structuredClone(before):reads===2?old.promise:structuredClone(after),sendMessage:async()=>({id:'sent',execution:after.execution})},state=>drawn.push({ids:state.messages.map(message=>message.id),execution:state.conversation?.execution?.id}));
  t.after(()=>f.controller.dispose());
  await f.controller.actions.chat({id:'one'});await tick();
  const pending=f.controller.refresh();await tick();assert.equal(reads,2);
  await f.controller.submit('chat',form({draft:'新消息'}));
  assert.deepEqual(f.state.messages.map(message=>message.id),['before','sent']);assert.equal(f.state.conversation.execution.id,'new-execution');assert.equal(f.state.conversation.execution.status,'acked');
  const acceptedDraws=drawn.length;
  old.resolve(lateFailure?Promise.reject(new Error('旧请求超时')):structuredClone(before));await pending;
  assert.deepEqual(f.state.messages.map(message=>message.id),['before','sent']);assert.equal(f.state.conversation.execution.id,'new-execution');assert.equal(f.state.error,'');assert.equal(f.state.employeeResources.conversation.error,'');
  assert(drawn.slice(acceptedDraws).every(frame=>frame.ids.includes('sent')&&frame.execution==='new-execution'));
});

test('polling skips conversation reads during a pending send and resumes after a failed send', async t => {
  const post=deferred(),posted=deferred();let reads=0;
  const f=initializedFixture({conversation:async()=>({id:'original-main',employee_id:'one',messages:[{id:`history-${++reads}`,role:'assistant',content:'已有历史'}]}),sendMessage:()=>{posted.resolve();return post.promise;}});t.after(()=>f.controller.dispose());
  await f.controller.actions.chat({id:'one'});await tick();
  const sending=f.controller.submit('chat',form({draft:'保留待发送消息'}));assert.equal(f.state.sending,true);await posted.promise;
  await f.controller.refresh();assert.equal(reads,1,'a polling GET during send must not capture a pre-send snapshot');
  post.resolve(Promise.reject(new Error('发送未获得确认')));await sending;
  assert.equal(f.state.sending,false);assert.equal(f.state.messages[0].id,'history-1');assert.equal(f.state.draft,'保留待发送消息');assert.match(f.state.error,/发送未获得确认/);
  await f.controller.refresh();assert.equal(reads,2);assert.equal(f.state.messages[0].id,'history-2');
});

function waitForAbort(signal) {
  assert(signal instanceof AbortSignal);
  return new Promise((_resolve,reject) => {
    const abort=()=>reject(Object.assign(new Error('读取已取消'),{code:'READ_CANCELLED'}));
    if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
  });
}

test('switching employees cancels every old employee GET before opening the new history', async t => {
  const oldSignals=[],newSignals=[];
  let f;
  const read=(employeeId,options,value)=>{
    (employeeId==='one'?oldSignals:newSignals).push(options.signal);
    return employeeId==='one'?waitForAbort(options.signal):Promise.resolve(value);
  };
  f=initializedFixture({
    conversation:(id,options)=>read(id==='original-main'?'one':'two',options,{id,employee_id:'two',messages:[{id:'new-history',content:'员工乙原历史'}]}),
    bot:(_workspace,id,options)=>read(id,options,id==='one'?f.bot:other),
    botRuns:(_workspace,id,options)=>read(id,options,{runs:[]}),
    botRoutines:(_workspace,id,options)=>read(id,options,{routines:[]}),
  });
  const other={...f.bot,id:'two',employee_id:'two',employee:{id:'two',name:'员工乙',runtime:'Hermes'},main_conversation_id:'second-main'};
  f.state.employees.push({...other.employee,bot:other});t.after(()=>f.controller.dispose());
  const old=f.controller.actions.chat({id:'one'});await tick();
  assert.equal(oldSignals.length,4);assert(oldSignals.every(signal=>!signal.aborted));
  await promptly(f.controller.actions.chat({id:'two'}));await promptly(old);await tick();
  assert(oldSignals.every(signal=>signal.aborted));assert(newSignals.every(signal=>!signal.aborted));
  assert.equal(f.state.conversation.id,'second-main');assert.equal(f.state.messages[0].id,'new-history');
  assert.equal(f.state.error,'');assert.equal(f.state.employeeResources.conversation.error,'');
});

test('leaving an unresolved ordinary chat cancels its canonical conversation lookup', async t => {
  let lookupSignal;
  const f=fixture({}, {getEmployeeConversation:(_workspace,_employee,options)=>{lookupSignal=options.signal;return waitForAbort(lookupSignal);}});
  t.after(()=>f.controller.dispose());
  const opening=f.controller.actions.chat({id:'one'});await tick();assert(!lookupSignal.aborted);
  await f.controller.actions.navigate({tab:'chat'});await promptly(opening);
  assert(lookupSignal.aborted);assert.equal(f.state.page,'home');assert.equal(f.state.conversation,null);assert.equal(f.state.error,'');
});

for(const kind of ['native','hidden'])test(`${kind} pause cancels stale GETs and resumes the same history without a timeout banner`,async t=>{
  const oldDocument=globalThis.document,oldAdd=globalThis.addEventListener,oldRemove=globalThis.removeEventListener;
  const native=new Map(),documentEvents=new Map();
  globalThis.document={hidden:false,addEventListener:(name,handler)=>documentEvents.set(name,handler),removeEventListener(){}};
  globalThis.addEventListener=(name,handler)=>native.set(name,handler);globalThis.removeEventListener=()=>{};
  let calls=0,staleSignal;
  const f=initializedFixture({
    authMe:async()=>({user_id:'user-one'}),workspaces:async()=>({workspaces:[{slug:'workspace-one',role:'owner'}]}),
    conversation:(id,options)=>{
      calls++;
      if(calls===2){staleSignal=options.signal;return waitForAbort(staleSignal);}
      return Promise.resolve({id,employee_id:'one',messages:[{id:'history',content:`原历史${calls}`} ]});
    },
  });
  t.after(()=>{f.controller.dispose();globalThis.document=oldDocument;globalThis.addEventListener=oldAdd;globalThis.removeEventListener=oldRemove;});
  await f.controller.boot();f.state.employees=[{...f.bot.employee,bot:f.bot}];f.state.bots=[f.bot];
  await f.controller.actions.chat({id:'one'});await tick();
  const polling=f.controller.refresh();await tick();assert.equal(calls,2);
  if(kind==='native')native.get('ziwei:pause')();else{globalThis.document.hidden=true;documentEvents.get('visibilitychange')();}
  await promptly(polling);assert(staleSignal.aborted);
  assert.equal(f.state.messages[0].content,'原历史1');assert.equal(f.state.employeeResources.conversation.phase,'ready');assert.equal(f.state.employeeResources.conversation.error,'');
  await f.controller.refresh();assert.equal(calls,2,'paused app must not begin another background sync');
  if(kind==='native')native.get('ziwei:resume')();else{globalThis.document.hidden=false;documentEvents.get('visibilitychange')();}
  await tick();assert.equal(calls,3);assert.equal(f.state.conversation.id,'original-main');assert.equal(f.state.messages[0].content,'原历史3');assert.equal(f.state.error,'');
});

test('disposing the controller aborts outstanding employee reads',async()=>{
  let signal;
  const f=initializedFixture({conversation:(_id,options)=>{signal=options.signal;return waitForAbort(signal);}});
  const opening=f.controller.actions.chat({id:'one'});await tick();f.controller.dispose();await promptly(opening);assert(signal.aborted);
});

for(const succeeds of [false,true])for(const resumeFirst of [false,true])test(`a pending send ${succeeds?'success':'failure'} ${resumeFirst?'after':'before'} resume keeps its receipt and unlocks history`,async t=>{
  const oldAdd=globalThis.addEventListener,oldRemove=globalThis.removeEventListener,handlers=new Map();
  globalThis.addEventListener=(name,handler)=>handlers.set(name,handler);globalThis.removeEventListener=()=>{};
  const posted=deferred(),receipt=deferred();let reads=0,posts=0,clientMessageId;
  const f=initializedFixture({
    authMe:async()=>({user_id:'user-one'}),workspaces:async()=>({workspaces:[{slug:'workspace-one',role:'owner'}]}),
    conversation:async id=>({id,employee_id:'one',messages:[{id:`history-${++reads}`,content:'原聊天'}]}),
    sendMessage:(...args)=>{assert.equal(args.length,2);posts++;clientMessageId=args[1].clientMessageId;posted.resolve();return receipt.promise;},
  });
  t.after(()=>{f.controller.dispose();globalThis.addEventListener=oldAdd;globalThis.removeEventListener=oldRemove;});
  await f.controller.boot();f.state.employees=[{...f.bot.employee,bot:f.bot}];f.state.bots=[f.bot];
  await f.controller.actions.chat({id:'one'});await tick();
  const sending=f.controller.submit('chat',form({draft:'原请求正文'}));await posted.promise;
  handlers.get('ziwei:pause')();assert.equal(f.state.sending,true);
  if(resumeFirst){handlers.get('ziwei:resume')();await tick();assert.equal(reads,1);}
  receipt.resolve(succeeds?{id:'accepted'}:Promise.reject(new Error('发送未收到回执')));
  await promptly(sending);assert.equal(f.state.sending,false);assert.equal(posts,1);
  if(!resumeFirst){assert.equal(reads,1);handlers.get('ziwei:resume')();await tick();}
  else if(!succeeds)await f.controller.refresh();
  assert.equal(reads,2);assert.equal(f.state.conversation.id,'original-main');
  assert.equal(f.state.employeeResources.conversation.error,'');
  if(succeeds){assert.equal(f.state.draft,'');assert.equal(f.state.error,'');}
  else{assert.equal(f.state.draft,'原请求正文');assert.match(f.state.error,/发送未收到回执/);assert([...f.storage.values.values()].some(value=>value.includes(clientMessageId)));}
  assert.equal(posts,1,'foreground recovery must not resend a business request');
});

test('logout clears account UI immediately even if its receipt never arrives', async t=>{
  const pending=deferred(),f=fixture({}, {logout:()=>pending.promise});t.after(()=>f.controller.dispose());
  const loggingOut=f.controller.actions.logout();await tick();
  assert.equal(f.state.phase,'login');assert.equal(f.state.user,null);assert.deepEqual(f.state.employees,[]);
  pending.resolve(Promise.reject(new Error('offline')));await loggingOut;
  assert.equal(f.state.phase,'login');assert.equal(f.state.user,null);
});

test('multiple owner memberships select only authoritative workspace rows and retain per-account preference',async t=>{
  const storage=memoryStorage();storage.setItem('ziwei.mobile.workspace:user-one','workspace-two');
  const rows=[{slug:'workspace-one',workspace_id:'db-one',id:'member-one',role:'owner'},{slug:'workspace-two',workspace_id:'db-two',id:'member-two',role:'owner'}];
  const f=fixture({}, {authMe:async()=>({user_id:'user-one',sub:'central-sub',workspace:{slug:'workspace-one',id:'member-one'},memberships:rows}),workspaces:async()=>({workspaces:rows})},storage);t.after(()=>f.controller.dispose());
  await f.controller.boot();assert.equal(f.state.workspace,rows[1]);assert.equal(f.state.user.user_id,'user-one');
  storage.removeItem('ziwei.mobile.workspace:user-one');
  f.api.authMe=async()=>({user_id:'user-one',workspace:{slug:'workspace-two',id:'wrong-native-view'},memberships:rows});
  await f.controller.boot();assert.equal(f.state.workspace,rows[0]);
});

test('native boot blocks unregistered clients before auth reads or legacy login and uses a unified action',async t=>{
  let logins=0,authReads=0;const f=fixture({phase:'boot',user:null,workspace:null},{identityMode:'oidc',getIdentityStatus:async()=>({available:true,mode:'oidc',configured:false,authenticated:false,message:'尚未注册'}),authMe:async()=>{authReads++;},login:async()=>{logins++;}});t.after(()=>f.controller.dispose());
  await f.controller.boot();assert.equal(f.state.phase,'login');assert.equal(f.state.identity.configured,false);assert.equal(authReads,0);
  await f.controller.submit('login',form({email:'unused@example.test',password:'must-not-be-submitted'}));assert.equal(logins,0);
});

test('a native login event re-enters server principal boot and preserves the existing scoped draft and workspace choice',async t=>{
  let notify,authReads=0;const storage=memoryStorage();
  const f=fixture({}, {identityMode:'oidc',getIdentityStatus:async()=>({available:true,mode:'oidc',configured:true,authenticated:true}),subscribeIdentity:callback=>{notify=callback;return()=>{};},authMe:async()=>{authReads++;return {user_id:'user-one',sub:'central-sub'};},workspaces:async()=>({workspaces:[{slug:'workspace-two',workspace_id:'db-two'},{slug:'workspace-one',workspace_id:'db-one'}]})},storage);t.after(()=>f.controller.dispose());
  storage.setItem('ziwei.mobile.workspace:user-one','workspace-one');
  await f.controller.actions.chat({id:'one'});await f.controller.change({name:'draft',value:'已输入但未发送的原草稿'});
  notify({available:true,mode:'oidc',configured:true,authenticated:true});await tick();await tick();
  assert.equal(authReads,1);assert.equal(f.state.user.user_id,'user-one');assert.equal(f.state.phase,'ready');assert.equal(f.state.workspace.slug,'workspace-one');
  await f.controller.actions.chat({id:'one'});assert.equal(f.state.draft,'已输入但未发送的原草稿');
});

test('a late workspace response from principal boot cannot repopulate UI after logout',async t=>{
  const workspaces=deferred(),f=fixture({}, {authMe:async()=>({user_id:'user-one'}),workspaces:()=>workspaces.promise});t.after(()=>f.controller.dispose());
  const boot=f.controller.boot();await tick();await f.controller.actions.logout();workspaces.resolve({workspaces:[{slug:'old-account-workspace'}]});await boot;
  assert.equal(f.state.phase,'login');assert.equal(f.state.user,null);assert.deepEqual(f.state.workspaces,[]);assert.equal(f.state.workspace,null);
});

test('native boot rejects a central subject without the explicit mapped native user_id',async t=>{
  let workspaces=0;const f=fixture({phase:'boot',user:null,workspace:null},{identityMode:'oidc',getIdentityStatus:async()=>({available:true,mode:'oidc',configured:true,authenticated:true}),authMe:async()=>({id:'central-id',sub:'central-sub'}),workspaces:async()=>{workspaces++;return {workspaces:[]};}});t.after(()=>f.controller.dispose());
  await f.controller.boot();assert.equal(workspaces,0);assert.equal(f.state.user,null);assert.equal(f.state.phase,'login');assert.match(f.state.error,/服务端尚未确认账号身份/);
});
