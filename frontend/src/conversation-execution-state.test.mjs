import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {IncomingMessage,ServerResponse} from 'node:http';
import {Duplex} from 'node:stream';
import { createRepository } from '../../backend/repository.mjs';
import { createApp } from '../../backend/app.mjs';
import {conversationSettingsSnapshot,mergeConversationSettingsDraft} from './workdir.js';

const app = await readFile(new URL('./App.vue', import.meta.url), 'utf8');
const state = await import('./conversation-execution-state.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const execution = (id, status, second=1) => ({ id, status, created_at:`2026-10-12T01:00:0${second}.000Z`, events:[] });
const conversation = action => ({ id:'conversation', employee_id:'employee', title:'Fixture', messages:[], execution:action });
const deferred = () => { let resolve; const promise = new Promise(accept => resolve=accept); return { promise, resolve }; };

async function readApi(app,path,cookie) {
  const socket=new Duplex({read(){},write(_chunk,_encoding,done){done();}}),req=new IncomingMessage(socket),res=new ServerResponse(req),chunks=[];
  req.method='GET';req.url=path;req.headers={host:'conversation-state.fixture',cookie};
  try{return await new Promise((resolve,reject)=>{
    res.write=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk,encoding));done?.();return true;};
    res.end=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));done?.();assert.equal(res.statusCode,200);resolve(JSON.parse(Buffer.concat(chunks)));res.emit('finish');return res;};
    req.on('error',reject);res.on('error',reject);app.handle(req,res,error=>reject(error||new Error('Unhandled fixture request')));req.push(null);
  });}finally{socket.destroy();}
}

function harness(overrides={}, { realOpen=false,realtime=false }={}) {
  const selectedConversation = { value:conversation(execution('A','succeeded')) };
  const conversations = { value:[conversation(execution('A','succeeded'))] };
  const workspace = { value:'workspace' };
  const reopened = [];
  const polling = [];
  const bindings = {
    botChatIntent:{value:null},botBindingPending:{value:false},selectedConversation, conversations, conversationExecution:{ value:selectedConversation.value.execution }, conversationEmployeeId:{ value:'employee' }, conversationStatusLoading:{ value:false },
    workspaceSlug:()=>workspace.value, conversationIdFromPath:()=> 'conversation', conversationRouteId:{ value:'conversation' },
    api:{ conversation:async()=>selectedConversation.value, conversations:async()=>({conversations:conversations.value}), ...overrides },
    openConversation:async item=>reopened.push(item), stopConversationPolling:()=>polling.push('stop'), startConversationPolling:()=>polling.push('start'), notify:()=>{},
    conversationModelId:{value:'draft-model'},conversationDeviceId:{value:'draft-device'},conversationWorkingDirectory:{value:'C:/draft'},conversationDraft:{value:'unsent draft'},devices:{value:[]},page:{value:'inbox'},
    clearConversationAttachment:()=>reopened.push('clear-attachments'),history:{pushState:()=>reopened.push('route')},routePath:()=>'/workspace/inbox',
    closeRealtime:()=>{},authState:{value:{authenticated:true}},eventSource:{value:null},loadNotifications:()=>{},refreshTasks:()=>{},
    realtimeSubscription:{value:null},connectWorkspaceRealtime:callbacks=>{bindings.realtimeSubscription.value=callbacks;return {close(){}};},
    ...state,
    conversationSettingsSnapshot,mergeConversationSettingsDraft,
  };
  bindings.api.websocketUrl=()=> 'ws://fixture';bindings.api.streamUrl=()=> '/fixture';
  const names = ['conversationRequestScope','applyConversationDetail','loadConversationExecution','loadConversations','refreshSelectedConversation','refreshConversationState',...(realOpen?['openConversation','refreshConversationFromRoute']:[]),...(realtime?['openRealtime']:[])];
  const functions = names.map(name => {
    const pattern = new RegExp(`(?:async )?function ${name}\\(`);
    const start = app.search(pattern);
    if (start < 0) return '';
    const end = app.indexOf('\n}',start);
    return app.slice(start,end+2);
  }).join('\n');
  const api = new Function(...Object.keys(bindings),`let conversationOpenGeneration=0,conversationListGeneration=0,conversationPollTimer=null,conversationRefresh=null;const conversationExecutionBusy={get value(){return executionPresentation(conversationExecution.value).busy}}; const conversationRequests=typeof createConversationRequestSequence==='function'?createConversationRequestSequence():null; ${functions}; return {loadConversations,refreshSelectedConversation,refreshConversationState${realOpen?',openConversation,refreshConversationFromRoute':''}${realtime?',openRealtime':''}};`)(...Object.values(bindings));
  return { ...bindings, ...api, workspace, reopened, polling };
}

test('opening an uncertain conversation starts receipt polling even though execution is not busy',async()=>{
  const unknown={...execution('original','failed'),result:{code:'EXECUTION_UNCERTAIN',executionState:'uncertain'}};
  const ui=harness({conversation:async()=>conversation(unknown)},{realOpen:true});
  ui.selectedConversation.value=null;
  assert.equal(await ui.openConversation('conversation'),true);
  assert.equal(state.executionPresentation(ui.conversationExecution.value).busy,false);
  assert.deepEqual(ui.polling,['start']);
});

test('opening a confirmed failed conversation does not keep receipt polling alive',async()=>{
  const ui=harness({conversation:async()=>conversation(execution('confirmed','failed'))},{realOpen:true});
  ui.selectedConversation.value=null;
  assert.equal(await ui.openConversation('conversation'),true);
  assert.deepEqual(ui.polling,['stop']);
});

test('restoring the same conversation route refreshes details and restarts unresolved receipt polling',async()=>{
  const unknown={...execution('original','failed'),result:{code:'EXECUTION_UNCERTAIN',executionState:'uncertain'}};
  let detailReads=0;
  const ui=harness({conversation:async()=>{detailReads++;return conversation(unknown);}},{realOpen:true});
  await ui.refreshConversationFromRoute();
  assert.equal(detailReads,1);
  assert.deepEqual(ui.polling,['start']);
  assert.equal(ui.conversationDraft.value,'unsent draft');
  const popstate=app.slice(app.indexOf("window.addEventListener('popstate'"),app.indexOf("window.addEventListener('ziwei:auth-required'"));
  assert.match(popstate,/page\.value==='inbox'\) void refreshConversationFromRoute\(\)/);
});

test('same-conversation detail cannot regress when an earlier request finishes last', async()=>{
  const first=deferred(),second=deferred();let calls=0;
  const ui=harness({conversation:()=> (++calls===1?first:second).promise});
  const old=ui.refreshSelectedConversation(),current=ui.refreshSelectedConversation();
  second.resolve(conversation(execution('B','acked',2)));await current;
  first.resolve(conversation(execution('A','succeeded')));await old;
  assert.equal(ui.selectedConversation.value.execution.id,'B');
  assert.equal(ui.conversationExecution.value.id,'B');
});

for(const status of ['pending','acked','succeeded','failed','expired']) {
  test(`accepted latest detail synchronizes left and right to B ${status}`,async()=>{
    const ui=harness({conversation:async()=>conversation(execution('B',status,2))});
    await ui.refreshSelectedConversation();
    assert.equal(ui.conversationExecution.value.id,'B');
    assert.equal(ui.conversations.value[0].execution.id,'B');
    assert.equal(ui.conversations.value[0].execution.status,status);
  });
}

test('list refresh does not reopen the already selected routed conversation',async()=>{
  const ui=harness();await ui.loadConversations();
  assert.deepEqual(ui.reopened,[]);
  assert.equal(ui.selectedConversation.value.id,'conversation');
});

test('late list snapshot cannot restore action A after newer detail B',async()=>{
  const list=deferred();
  const ui=harness({conversations:()=>list.promise,conversation:async()=>conversation(execution('B','failed',2))});
  const pending=ui.loadConversations({autoSelect:false});
  await ui.refreshSelectedConversation();
  list.resolve({conversations:[conversation(execution('A','succeeded'))]});await pending;
  assert.equal(ui.conversations.value[0].execution.id,'B');
  assert.equal(ui.conversationExecution.value.id,'B');
  assert.deepEqual(ui.reopened,[]);
});

test('workspace and employee changes reject old detail responses',async()=>{
  for(const change of ['workspace','employee']) {
    const response=deferred();const ui=harness({conversation:()=>response.promise});
    const pending=ui.refreshSelectedConversation();
    if(change==='workspace')ui.workspace.value='other';else ui.conversationEmployeeId.value='other';
    response.resolve(conversation(execution('B','acked',2)));await pending;
    assert.equal(ui.selectedConversation.value.execution.id,'A',change);
    assert.equal(ui.conversations.value[0].execution.id,'A',change);
  }
});

test('expired presentation is terminal error on both sides',()=>{
  assert.equal(typeof state.executionPresentation,'function','state presentation helper must exist');
  const expired=state.executionPresentation(execution('B','expired'));
  assert.equal(expired.busy,false);assert.equal(expired.tone,'error');
  assert.match(expired.label,/超时/);assert.match(expired.summary,/超时/);
});

test('request sequence independently rejects late list/detail and changed scopes',()=>{
  assert.equal(typeof state.createConversationRequestSequence,'function','request sequence helper must exist');
  const requests=state.createConversationRequestSequence(),scope={workspace:'one',employee:'employee',generation:1};
  const oldDetail=requests.begin(scope,'detail','conversation'),oldList=requests.begin(scope,'list');
  const currentDetail=requests.begin(scope,'detail','conversation'),currentList=requests.begin(scope,'list');
  assert.equal(requests.isCurrent(oldDetail,scope),false);assert.equal(requests.isCurrent(oldList,scope),false);
  assert.equal(requests.isCurrent(currentDetail,scope),true);assert.equal(requests.isCurrent(currentList,scope),true);
  for(const next of [{...scope,workspace:'two'},{...scope,employee:'other'},{...scope,generation:2}])assert.equal(requests.isCurrent(currentDetail,next),false);
});

test('new action replaces completed A in every B state without downgrading the same terminal B',()=>{
  assert.equal(typeof state.mergeConversationDetail,'function','detail merge helper must exist');
  for(const status of ['pending','acked','succeeded','failed','expired']) {
    const next=state.mergeConversationDetail(conversation(execution('A','succeeded')),conversation(execution('B',status,2)));
    assert.equal(next.execution.id,'B');assert.equal(next.execution.status,status);
  }
  const terminal=conversation(execution('B','expired',2));
  assert.equal(state.mergeConversationDetail(terminal,conversation(execution('B','acked',2))).execution.status,'expired');
});

test('same-route actual open preserves composer and edited settings while refreshing state',async()=>{
  const ui=harness({conversation:async()=>conversation(execution('B','pending',2))},{realOpen:true});
  assert.equal(await ui.openConversation('conversation'),true);
  assert.deepEqual(ui.reopened,[]);
  assert.equal(ui.conversationDraft.value,'unsent draft');
  assert.equal(ui.conversationModelId.value,'draft-model');assert.equal(ui.conversationDeviceId.value,'draft-device');assert.equal(ui.conversationWorkingDirectory.value,'C:/draft');
  assert.equal(ui.conversationExecution.value.id,'B');assert.equal(ui.conversations.value[0].execution.id,'B');
});

for(const callback of ['onReady','onEvent']) {
  test(`actual realtime ${callback} compensates left and right from the latest action`,async()=>{
    const ui=harness({conversation:async()=>conversation(execution('B','expired',2))},{realtime:true});
    ui.openRealtime();
    // The real callback starts the asynchronous state requests; no UI service is started.
    ui.realtimeSubscription.value[callback]({type:'fixture'});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(ui.conversationExecution.value.id,'B');assert.equal(ui.conversations.value[0].execution.id,'B');
    assert.equal(ui.conversations.value[0].execution.status,'expired');
  });
}

test('real isolated conversation API keeps list/detail on the next action after a completed reply',async t=>{
  const repo=createRepository({memory:true});
  t.after(()=>repo.db.close());
  const app=createApp({repository:repo,requireAuth:true,enableScheduler:false});
  const owner=app.locals.auth.setup({name:'UI fixture owner',email:'ui-state@example.test',password:'isolated-fixture-password'});
  const workspace=app.locals.auth.createWorkspace(owner.user_id,{name:'UI state fixture',slug:'ui-state-fixture',kind:'team'}).workspace;
  const employee=repo.createEmployee(workspace.slug,{name:'UI state fixture',runtime:'Codex',ownerUserId:owner.user_id});
  const session=repo.createConversation(workspace.slug,{employeeId:employee.id});
  const first=repo.addConversationMessage(session.id,{content:'fixture A'});
  repo.ackA2AAction(first.execution.id);
  repo.resultA2AAction(first.execution.id,{result:{output:'fixture A completed'}});
  const read=path=>readApi(app,path,`ziwei_session=${owner.session.token}`);
  const initial=await read(`/api/conversations/${session.id}`);
  const ui=harness({conversation:id=>read(`/api/conversations/${id}`),conversations:()=>read(`/api/workspaces/${workspace.slug}/conversations`)});
  ui.selectedConversation.value=initial;ui.conversationExecution.value=initial.execution;ui.conversations.value=[initial];
  const second=repo.addConversationMessage(session.id,{content:'fixture B'});
  await Promise.all([ui.loadConversations({autoSelect:false}),ui.refreshSelectedConversation()]);
  assert.equal(ui.conversationExecution.value.id,second.execution.id);assert.equal(ui.conversationExecution.value.status,'pending');
  assert.equal(ui.conversations.value[0].execution.id,second.execution.id);
  repo.ackA2AAction(second.execution.id);
  await ui.refreshSelectedConversation();
  assert.equal(ui.conversationExecution.value.status,'acked');assert.equal(ui.conversations.value[0].execution.status,'acked');
  repo.resultA2AAction(second.execution.id,{result:{output:'fixture B completed'}});
  await ui.refreshSelectedConversation();
  assert.equal(ui.conversationExecution.value.status,'succeeded');assert.equal(ui.conversations.value[0].execution.status,'succeeded');
  assert.equal(ui.selectedConversation.value.messages.filter(message=>message.role==='assistant').length,2);
});

test('actual polling waits for its current slow request instead of starving accepted responses',async()=>{
  let tick,requests=0;
  const response=deferred();
  const start=app.indexOf('function startConversationPolling('),end=app.indexOf('\n}',start);
  const begin=new Function('selectedConversation','page','setInterval','clearInterval','refreshSelectedConversation','refreshConversationState','conversationExecutionBusy','executionNeedsPolling','conversationExecution',`let conversationPollTimer=null,conversationOpenGeneration=0;function stopConversationPolling(){conversationPollTimer=null;}return (${app.slice(start,end+2)});`)(
    {value:{id:'conversation'}},{value:'inbox'},callback=>{tick=callback;return 'fixture-timer';},()=>{},()=>{requests++;return response.promise;},()=>{requests++;return response.promise;},{value:true},state.executionNeedsPolling,{value:execution('running','acked')},
  );
  begin();const first=tick(),overlap=tick();
  assert.equal(requests,1);
  response.resolve();await Promise.all([first,overlap]);await tick();
  assert.equal(requests,2);
});

test('actual realtime and polling share one slow refresh and accept it before a single trailing refresh',async()=>{
  const first=deferred(),trailing=deferred();let detailRequests=0,listRequests=0;
  const ui=harness({conversation:()=> (++detailRequests===1?first:trailing).promise,conversations:async()=>{listRequests++;return {conversations:ui.conversations.value};}},{realtime:true});
  ui.openRealtime();const current=ui.refreshConversationState();
  assert.equal(ui.refreshConversationState(),current,'same-scope refresh callers share the actual promise');
  ui.realtimeSubscription.value.onReady();for(let i=0;i<30;i++)ui.realtimeSubscription.value.onEvent({type:'fixture.progress'});
  assert.equal(detailRequests,1,'progress events must not supersede the in-flight slow detail');assert.equal(listRequests,1);
  first.resolve(conversation(execution('B','acked',2)));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ui.conversationExecution.value.id,'B','the first response is accepted while events are queued');assert.equal(ui.conversations.value[0].execution.id,'B');
  assert.equal(detailRequests,2);assert.equal(listRequests,2,'the event burst schedules exactly one trailing list/detail refresh');
  trailing.resolve(conversation(execution('B','succeeded',2)));await current;
  assert.equal(ui.conversationExecution.value.status,'succeeded');assert.equal(ui.conversations.value[0].execution.status,'succeeded');assert.equal(detailRequests,2);
});

test('a new workspace refresh starts immediately and old realtime refreshes cannot commit or run a trailing request',async()=>{
  const old=deferred(),current=deferred();let detailRequests=0;
  const ui=harness({conversation:()=> (++detailRequests===1?old:current).promise});
  const previous=ui.refreshConversationState();const queued=ui.refreshConversationState();
  ui.workspace.value='next-workspace';const next=ui.refreshConversationState();assert.equal(detailRequests,2,'a new scope cannot wait for the previous workspace promise');
  current.resolve(conversation(execution('B','succeeded',2)));await next;
  old.resolve(conversation(execution('A','failed')));await Promise.all([previous,queued]);
  assert.equal(ui.conversationExecution.value.id,'B');assert.equal(ui.conversations.value[0].execution.id,'B');assert.equal(detailRequests,2,'obsolete queued refreshes must not issue new requests');
});

test('a user reopening the current conversation starts its own refresh without waiting for old background work',async()=>{
  const background=deferred(),user=deferred();let detailRequests=0;
  const ui=harness({conversation:()=> (++detailRequests===1?background:user).promise},{realOpen:true});
  const old=ui.refreshConversationState();const opening=ui.openConversation('conversation');assert.equal(detailRequests,2);
  user.resolve(conversation(execution('B','pending',2)));assert.equal(await opening,true);assert.equal(ui.conversationExecution.value.id,'B');
  background.resolve(conversation(execution('A','succeeded')));await old;
  assert.equal(ui.conversationExecution.value.id,'B');assert.equal(ui.conversations.value[0].execution.id,'B');assert.equal(ui.conversationDraft.value,'unsent draft');
});
