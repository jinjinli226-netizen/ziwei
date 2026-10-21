import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {computed,ref,watch} from 'vue';
import {createConversationRequestSequence,mergeConversationDetail,mergeConversationLists,executionNeedsPolling} from './conversation-execution-state.mjs';
import {conversationSettingsSnapshot,mergeConversationSettingsDraft} from './workdir.js';

const app=await readFile(new URL('./App.vue',import.meta.url),'utf8');
function source(name){
  const start=app.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start>=0,`missing App.vue function ${name}`);
  return app.slice(start,app.indexOf('\n}',start)+2);
}
const bindingCallback=app.indexOf('void refreshBotChatBinding(employeeId,conversationId)');
assert.ok(bindingCallback>=0,'use the actual App.vue binding watcher');
const bindingWatch=app.slice(app.lastIndexOf('\nwatch(',bindingCallback)+1,app.indexOf('\n',bindingCallback));
const settle=async()=>{await Promise.resolve();await Promise.resolve();};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function bot(id,workspace='bigtron'){return{id,employee_id:id,workspace,main_conversation_id:`chat-${id}`,configuration_state:'configured',revision:1,control_epoch:1};}
function harness(){
  const workspace=ref('bigtron'),requests=[],opens=[],historyWrites=[];
  const state={conversationEmployeeId:ref(''),conversations:ref([]),selectedConversation:ref(null),conversationBotBinding:ref(null),botBindingPending:ref(false),botBindingError:ref(''),botChatIntent:ref(null),conversationBotId:ref(''),authState:ref({user:{id:'owner'}}),employees:ref([]),page:ref('inbox'),conversationDirectoryPickerOpen:ref(false),conversationDirectoryEditorVersion:ref(0),conversationDirectoryPathDraft:ref(''),conversationDirectoryCheck:ref(null),conversationDirectoryLoading:ref(false),conversationDirectoryError:ref(''),conversationWorkingDirectory:ref('/work'),selectedConversationDevice:ref({id:'device',status:'online',workdir:'/root'})};
  const context={...state,watch,workspaceSlug:()=>workspace.value,workspaceSlugValue:computed(()=>workspace.value),
    api:{bot:(employeeId,slug)=>{const request={...deferred(),employeeId,workspace:slug,actor:state.authState.value.user?.id};requests.push(request);return request.promise;}},
    navigate:key=>{state.botChatIntent.value=null;state.selectedConversation.value=null;state.page.value=key;},
    openConversation:(conversation,options)=>{const request={...deferred(),conversation,options};opens.push(request);return request.promise;},
    history:{replaceState:(_state,_title,path)=>historyWrites.push(path)},routePath:(page,id)=>`/${workspace.value}/${page}/${id}`,
  };
  const functions=new Function(...Object.keys(context),`let botChatBindingGeneration=0,botChatBindingActor='',botChatBindingResolvedScope='',botChatBindingRequest=null;\n${source('botChatBindingScope')}\n${source('refreshBotChatBinding')}\n${source('openConversationDirectoryPicker')}\n${source('loadConversationDirectoryBinding')}\n${source('closeConversationDirectoryPicker')}\n${source('openBotConversation')}\nconst stop=${bindingWatch.trim()}\nreturn {openBotConversation,openConversationDirectoryPicker,loadConversationDirectoryBinding,closeConversationDirectoryPicker,stop};`)(...Object.values(context));
  return{...state,...functions,workspace,requests,opens,historyWrites,
    select:id=>{state.selectedConversation.value={id:`chat-${id}`,employee_id:id,messages:[]};},
    enter:id=>functions.openBotConversation({workspace:workspace.value,employee:{id},conversation:{id:`chat-${id}`},botId:id}),
  };
}

test('same conversation detail refreshes do not supersede a slow binding request or restart a resolved binding',async t=>{
  const ui=harness();t.after(ui.stop);ui.select('tiktok');
  assert.equal(ui.botBindingPending.value,true);
  for(let index=0;index<5;index++)ui.selectedConversation.value={...ui.selectedConversation.value,messages:[{id:`message-${index}`}]};
  assert.equal(ui.requests.length,1,'message and execution refreshes must not restart identity lookup');
  ui.requests[0].resolve(bot('tiktok'));await settle();
  assert.equal(ui.botBindingPending.value,false);assert.equal(ui.conversationBotBinding.value.id,'tiktok');
  ui.selectedConversation.value={...ui.selectedConversation.value,execution:{status:'acked'}};
  assert.equal(ui.requests.length,1);assert.equal(ui.botBindingPending.value,false);
});

test('resolved ordinary employee remains unbound and usable across conversation refreshes',async t=>{
  const ui=harness();t.after(ui.stop);ui.select('secretary');
  ui.requests[0].resolve({...bot('secretary'),configuration_state:'uninitialized'});await settle();
  assert.equal(ui.conversationBotBinding.value,null);assert.equal(ui.botBindingPending.value,false);
  ui.selectedConversation.value={...ui.selectedConversation.value,messages:[{id:'reply'}]};
  assert.equal(ui.requests.length,1);assert.equal(ui.conversationBotBinding.value,null);assert.equal(ui.botBindingPending.value,false);
});

for(const outcome of ['success','failure'])test(`previous employee ${outcome} and finally cannot settle the new employee binding`,async t=>{
  const ui=harness();t.after(ui.stop);ui.select('tiktok');ui.select('secretary');
  ui.botChatIntent.value={workspace:'bigtron',botId:'secretary',conversationId:'chat-secretary',pending:true};
  assert.equal(ui.requests.length,2);
  if(outcome==='success')ui.requests[0].resolve(bot('tiktok'));else ui.requests[0].reject(new Error('old employee request failed'));
  await settle();
  assert.equal(ui.conversationBotBinding.value,null);assert.equal(ui.botBindingPending.value,true);
  assert.equal(ui.botChatIntent.value.botId,'secretary');assert.equal(ui.botChatIntent.value.pending,true);
  ui.requests[1].resolve(bot('secretary'));await settle();
  assert.equal(ui.botBindingPending.value,false);assert.equal(ui.conversationBotBinding.value.id,'secretary');
  assert.equal(ui.botChatIntent.value.pending,false);
});

test('late previous employee response cannot replace an already resolved new employee binding',async t=>{
  const ui=harness();t.after(ui.stop);ui.select('tiktok');ui.select('secretary');
  ui.requests[1].resolve(bot('secretary'));await settle();
  ui.requests[0].resolve(bot('tiktok'));await settle();
  assert.equal(ui.conversationBotBinding.value.id,'secretary');assert.equal(ui.conversationBotId.value,'secretary');assert.equal(ui.botBindingPending.value,false);
});

test('changing the authenticated actor invalidates a cached private employee binding',async t=>{
  const ui=harness();t.after(ui.stop);ui.select('secretary');ui.requests[0].resolve(bot('secretary'));await settle();
  ui.authState.value={user:{id:'other-member'}};
  assert.equal(ui.requests.length,2);assert.equal(ui.requests[1].actor,'other-member');
  assert.equal(ui.conversationBotBinding.value,null);assert.equal(ui.botBindingPending.value,true);
  ui.requests[1].reject(Object.assign(new Error('not visible to this member'),{status:403}));await settle();
  assert.equal(ui.conversationBotBinding.value,null);assert.equal(ui.botBindingPending.value,false);
});

test('old actor response cannot authorize a binding after the actor changes',async t=>{
  const ui=harness();t.after(ui.stop);ui.select('secretary');ui.authState.value={user:{id:'other-member'}};
  assert.equal(ui.requests.length,2);
  ui.requests[0].resolve(bot('secretary'));await settle();
  assert.equal(ui.conversationBotBinding.value,null);assert.equal(ui.botBindingPending.value,true);
  ui.requests[1].resolve({...bot('secretary'),configuration_state:'uninitialized'});await settle();
  assert.equal(ui.conversationBotBinding.value,null);assert.equal(ui.botBindingPending.value,false);
});

test('workspace changes invalidate the binding even if conversation and employee identifiers remain the same',async t=>{
  const ui=harness();t.after(ui.stop);ui.select('secretary');ui.requests[0].resolve(bot('secretary'));await settle();
  ui.workspace.value='private';assert.equal(ui.requests.length,2);assert.equal(ui.requests[1].workspace,'private');
  assert.equal(ui.conversationBotBinding.value,null);assert.equal(ui.botBindingPending.value,true);
  ui.requests[1].resolve(bot('secretary','private'));await settle();
  assert.equal(ui.conversationBotBinding.value.workspace,'private');assert.equal(ui.botBindingPending.value,false);
});

test('first Bot conversation load failure clears its reactive entry and manual pending state',async t=>{
  const ui=harness();t.after(ui.stop);const pending=ui.enter('tiktok');
  assert.equal(ui.botBindingPending.value,true);assert.equal(ui.botChatIntent.value.botId,'tiktok');
  ui.opens[0].resolve(false);await pending;
  assert.equal(ui.botChatIntent.value,null);assert.equal(ui.botBindingPending.value,false);assert.equal(ui.selectedConversation.value,null);
});

test('older failed Bot entry cannot clear the newer entry and the newer failure still clears itself',async t=>{
  const ui=harness();t.after(ui.stop);const first=ui.enter('tiktok'),second=ui.enter('secretary');
  ui.opens[0].resolve(false);await first;
  assert.equal(ui.botChatIntent.value.botId,'secretary');assert.equal(ui.botBindingPending.value,true);
  ui.opens[1].resolve(false);await second;
  assert.equal(ui.botChatIntent.value,null);assert.equal(ui.botBindingPending.value,false);
});


test('directory opens immediately during initial binding and shares its request while execution updates arrive',async t=>{
  const ui=harness();t.after(ui.stop);ui.select('tiktok');
  const opening=ui.openConversationDirectoryPicker();
  assert.equal(ui.conversationDirectoryPickerOpen.value,true);
  assert.equal(ui.conversationDirectoryLoading.value,true);
  assert.equal(ui.requests.length,1);
  for(let i=0;i<20;i++)ui.selectedConversation.value={...ui.selectedConversation.value,execution:{status:'running',events:[{id:i}]}};
  assert.equal(ui.requests.length,1);
  ui.requests[0].resolve(bot('tiktok'));await opening;
  assert.equal(ui.conversationDirectoryLoading.value,false);assert.equal(ui.conversationDirectoryError.value,'');
  assert.equal(ui.conversationBotBinding.value.revision,1);
});

test('repeated directory clicks share a pending refresh and the latest editor settles',async t=>{
  const ui=harness();t.after(ui.stop);ui.select('tiktok');ui.requests[0].resolve(bot('tiktok'));await settle();
  const first=ui.openConversationDirectoryPicker(),second=ui.openConversationDirectoryPicker({useDeviceDefault:true});
  assert.equal(ui.requests.length,2);assert.equal(ui.conversationDirectoryPickerOpen.value,true);
  ui.requests[1].resolve({...bot('tiktok'),revision:9,control_epoch:4});await Promise.all([first,second]);
  assert.equal(ui.conversationDirectoryLoading.value,false);assert.equal(ui.conversationDirectoryError.value,'');
  assert.equal(ui.conversationDirectoryPathDraft.value,'/root');assert.equal(ui.conversationBotBinding.value.revision,9);
});

test('failed initial binding is retried in the directory instead of authorizing an ordinary employee',async t=>{
  const ui=harness();t.after(ui.stop);ui.select('tiktok');ui.requests[0].reject(new Error('network unavailable'));await settle();
  assert.equal(ui.botBindingPending.value,false);
  const opening=ui.openConversationDirectoryPicker();
  assert.equal(ui.requests.length,2);assert.equal(ui.conversationDirectoryLoading.value,true);
  ui.requests[1].resolve(bot('tiktok'));await opening;
  assert.equal(ui.conversationDirectoryError.value,'');assert.equal(ui.botBindingError.value,'');assert.equal(ui.conversationBotBinding.value.id,'tiktok');
});

test('directory timeout releases pending and exposes a retry that preserves the entered path',async t=>{
  const ui=harness();t.after(ui.stop);ui.select('tiktok');ui.requests[0].resolve(bot('tiktok'));await settle();
  const opening=ui.openConversationDirectoryPicker();ui.requests[1].reject(new Error('读取超时，请重试'));await opening;
  assert.equal(ui.botBindingPending.value,false);assert.equal(ui.conversationDirectoryLoading.value,false);
  assert.match(ui.conversationDirectoryError.value,/超时/);assert.equal(ui.conversationDirectoryPickerOpen.value,true);
  ui.conversationDirectoryPathDraft.value='/my-draft';
  const retry=ui.loadConversationDirectoryBinding();assert.equal(ui.requests.length,3);
  ui.requests[2].resolve({...bot('tiktok'),revision:4});await retry;
  assert.equal(ui.conversationDirectoryPathDraft.value,'/my-draft');assert.equal(ui.conversationDirectoryError.value,'');
});

test('confirmed ordinary employee opens the directory without another binding lookup',async t=>{
  const ui=harness();t.after(ui.stop);ui.select('secretary');ui.requests[0].resolve({...bot('secretary'),configuration_state:'uninitialized'});await settle();
  await ui.openConversationDirectoryPicker();assert.equal(ui.requests.length,1);assert.equal(ui.conversationDirectoryLoading.value,false);assert.equal(ui.conversationDirectoryError.value,'');
});

for(const change of ['employee','page','closed'])test(`late directory result cannot reopen or update an abandoned editor: ${change}`,async t=>{
  const ui=harness();t.after(ui.stop);ui.select('tiktok');ui.requests[0].resolve(bot('tiktok'));await settle();
  const opening=ui.openConversationDirectoryPicker();
  if(change==='employee')ui.select('secretary');
  if(change==='page')ui.page.value='bots';
  ui.closeConversationDirectoryPicker();
  ui.requests[1].resolve(bot('tiktok'));await opening;
  assert.equal(ui.conversationDirectoryPickerOpen.value,false);assert.equal(ui.conversationDirectoryError.value,'');
});


test('both chat surfaces expose directory loading/retry rather than disable its entry',()=>{
  assert.doesNotMatch(app,/:disabled="botBindingPending" @click="openConversationDirectoryPicker/);
  assert.match(app,/v-if="conversationDirectoryLoading" role="status"/);
  assert.match(app,/v-else-if="conversationDirectoryError" role="alert"/);
  assert.match(app,/@click="loadConversationDirectoryBinding">重试读取/);
});


test('an explicitly non-Hermes employee remains usable without confusing visibility or transport failures',async t=>{
  const ui=harness();t.after(ui.stop);ui.select('codex');
  ui.requests[0].reject(Object.assign(new Error('此员工没有 Hermes Bot 能力'),{code:'BOT_RUNTIME_UNSUPPORTED',status:400}));await settle();
  assert.equal(ui.botBindingError.value,'');assert.equal(ui.botBindingPending.value,false);assert.equal(ui.conversationBotBinding.value,null);
  await ui.openConversationDirectoryPicker();assert.equal(ui.requests.length,1);assert.equal(ui.conversationDirectoryLoading.value,false);assert.equal(ui.conversationDirectoryError.value,'');
});

// Use the real navigation, detail/list request sequence and Vue identity watcher
// together. The simpler binding fixture deliberately stubs conversation opens.
function navigationHarness() {
  const names=['conversationRequestScope','applyConversationDetail','loadConversationExecution','loadConversations','openConversation','selectConversationEmployee','openBotConversation','botChatBindingScope','refreshBotChatBinding'];
  const navigateLine=app.split('\n').find(line=>line.startsWith('function navigate('));
  const sources=names.map(source).join('\n')+'\n'+navigateLine;
  const state=Object.fromEntries([...sources.matchAll(/(\w+)\.value/g)].map(match=>[match[1],ref(null)]));
  Object.assign(state,{authState:ref({user:{id:'owner'}}),conversationEmployeeId:ref('instrends'),conversations:ref([{id:'chat-instrends',employee_id:'instrends'}]),employees:ref([{id:'instrends'},{id:'secretary'},{id:'other'}]),devices:ref([{id:'device',status:'online',workdir:'D:/Work'}]),page:ref('bots'),selectedConversation:ref(null),conversationExecutionBusy:ref(false)});
  const details=[],lists=[],notices=[];let location='/bigtron/bots/secretary';
  const context={...state,watch,workspaceSlug:()=> 'bigtron',createConversationRequestSequence,mergeConversationDetail,mergeConversationLists,executionNeedsPolling,conversationSettingsSnapshot,mergeConversationSettingsDraft,
    api:{conversation:id=>{const request={id,...deferred()};details.push(request);return request.promise;},conversations:employee=>{const request={employee,...deferred()};lists.push(request);return request.promise;},bot:id=>Promise.resolve(bot(id))},
    history:{pushState:(_state,_title,url)=>{location=url;},replaceState:(_state,_title,url)=>{location=url;}},
    routePath:(page,id='')=>`/bigtron/${page}${id?'/'+id:''}`,
    conversationIdFromPath:()=>new URL(location,'https://fixture.test').pathname.split('/')[3]||'',
    clearConversationAttachment:()=>{},stopConversationPolling:()=>{},startConversationPolling:()=>{},refreshConversationState:async()=>{},notify:message=>notices.push(message),load:async()=>{},loadApiKeys:()=>{},loadZiweiConnect:async()=>{},
  };
  const functions=new Function(...Object.keys(context),`let conversationSettingsBaseline=null;let conversationOpenGeneration=0,conversationListGeneration=0;const conversationRequests=createConversationRequestSequence();let botChatBindingGeneration=0,botChatBindingActor='',botChatBindingResolvedScope='',botChatBindingRequest=null;${sources}\nconst stop=${bindingWatch.trim()}\nreturn {openBotConversation,openConversation,loadConversations,selectConversationEmployee,stop};`)(...Object.values(context));
  return {...state,...functions,details,lists,notices,location:()=>location,setLocation:value=>{location=value;},enter:()=>functions.openBotConversation({workspace:'bigtron',employee:{id:'secretary'},conversation:{id:'chat-secretary'},botId:'secretary'})};
}
const detail=(id,employee)=>({id,employee_id:employee,employee:{id:employee,target_device_id:'device'},device_id:'device',messages:[],execution:null});

test('manual main-chat entry owns target employee immediately and keeps it after detail failure',async t=>{
  const ui=navigationHarness();t.after(ui.stop);
  const opening=ui.enter();
  assert.equal(ui.conversationEmployeeId.value,'secretary');assert.deepEqual(ui.conversations.value,[]);
  assert.match(ui.location(),/chat-secretary\?employee=secretary&bot=secretary$/);
  ui.details[0].reject(new Error('detail timed out'));await opening;
  assert.equal(ui.conversationEmployeeId.value,'secretary');assert.equal(ui.selectedConversation.value,null);
  assert.equal(ui.botChatIntent.value,null);assert.equal(ui.botBindingPending.value,false);assert.deepEqual(ui.notices,['detail timed out']);
});

test('late old employee list cannot change the explicit main-chat scope or selection',async t=>{
  const ui=navigationHarness();t.after(ui.stop);
  const oldList=ui.loadConversations();assert.equal(ui.lists[0].employee,'instrends');
  const opening=ui.enter();
  ui.lists[0].resolve({conversations:[detail('chat-instrends','instrends')]});await oldList;
  assert.equal(ui.details.length,1);assert.equal(ui.conversationEmployeeId.value,'secretary');assert.deepEqual(ui.conversations.value,[]);
  ui.details[0].resolve(detail('chat-secretary','secretary'));await opening;await settle();
  assert.equal(ui.selectedConversation.value.id,'chat-secretary');assert.equal(ui.conversationEmployeeId.value,'secretary');assert.equal(ui.botChatIntent.value.opening,false);
});

for(const includesTarget of [true,false])test(`background list cannot supersede a manual open (${includesTarget?'route present':'another thread only'})`,async t=>{
  const ui=navigationHarness();t.after(ui.stop);const opening=ui.enter();
  const background=ui.loadConversations();assert.equal(ui.lists[0].employee,'secretary');
  ui.lists[0].resolve({conversations:[detail(includesTarget?'chat-secretary':'secretary-other-thread','secretary')]});await background;
  assert.equal(ui.details.length,1,'background routing/autoSelect must not start another detail request');
  ui.details[0].resolve(detail('chat-secretary','secretary'));await opening;await settle();
  assert.equal(ui.selectedConversation.value.id,'chat-secretary');assert.equal(ui.conversationEmployeeId.value,'secretary');
});

test('an explicit employee switch cancels main-chat intent and ignores its late response',async t=>{
  const ui=navigationHarness();t.after(ui.stop);const opening=ui.enter();
  const switchEmployee=ui.selectConversationEmployee('other');
  assert.equal(ui.botChatIntent.value,null);assert.equal(ui.botBindingPending.value,false);assert.equal(ui.lists[0].employee,'other');
  ui.lists[0].resolve({conversations:[detail('chat-other','other')]});await settle();
  assert.equal(ui.details[1].id,'chat-other');
  ui.details[1].resolve(detail('chat-other','other'));await switchEmployee;
  ui.details[0].resolve(detail('chat-secretary','secretary'));await opening;await settle();
  assert.equal(ui.selectedConversation.value.id,'chat-other');assert.equal(ui.conversationEmployeeId.value,'other');assert.doesNotMatch(ui.location(),/secretary/);
});

test('an explicit other conversation cancels main-chat intent and retains the latest selection',async t=>{
  const ui=navigationHarness();t.after(ui.stop);const opening=ui.enter();
  const other=ui.openConversation({id:'secretary-other-thread'});
  assert.equal(ui.botChatIntent.value,null);
  ui.details[1].resolve(detail('secretary-other-thread','secretary'));await other;
  ui.details[0].resolve(detail('chat-secretary','secretary'));await opening;await settle();
  assert.equal(ui.selectedConversation.value.id,'secretary-other-thread');assert.match(ui.location(),/secretary-other-thread/);
});

test('initial URL intent still opens its main conversation through the background list',async t=>{
  const ui=navigationHarness();t.after(ui.stop);
  ui.conversationEmployeeId.value='secretary';ui.page.value='inbox';ui.setLocation('/bigtron/inbox/chat-secretary?employee=secretary&bot=secretary');
  ui.botChatIntent.value={workspace:'bigtron',botId:'secretary',conversationId:'chat-secretary',pending:true};
  const loading=ui.loadConversations();ui.lists[0].resolve({conversations:[detail('chat-secretary','secretary')]});await settle();
  assert.equal(ui.details.length,1);ui.details[0].resolve(detail('chat-secretary','secretary'));await loading;await settle();
  assert.equal(ui.selectedConversation.value.id,'chat-secretary');assert.equal(ui.conversationEmployeeId.value,'secretary');
});
