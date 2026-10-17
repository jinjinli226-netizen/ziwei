import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {computed,ref,watch} from 'vue';

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
  const state={selectedConversation:ref(null),conversationBotBinding:ref(null),botBindingPending:ref(false),botChatIntent:ref(null),conversationBotId:ref(''),authState:ref({user:{id:'owner'}}),employees:ref([]),page:ref('bots')};
  const context={...state,watch,workspaceSlug:()=>workspace.value,workspaceSlugValue:computed(()=>workspace.value),
    api:{bot:(employeeId,slug)=>{const request={...deferred(),employeeId,workspace:slug,actor:state.authState.value.user?.id};requests.push(request);return request.promise;}},
    navigate:key=>{state.botChatIntent.value=null;state.selectedConversation.value=null;state.page.value=key;},
    openConversation:(conversation,options)=>{const request={...deferred(),conversation,options};opens.push(request);return request.promise;},
    history:{replaceState:(_state,_title,path)=>historyWrites.push(path)},routePath:(page,id)=>`/${workspace.value}/${page}/${id}`,
  };
  const functions=new Function(...Object.keys(context),`let botChatBindingGeneration=0,botChatBindingActor='';\n${source('refreshBotChatBinding')}\n${source('openBotConversation')}\nconst stop=${bindingWatch.trim()}\nreturn {openBotConversation,stop};`)(...Object.values(context));
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
