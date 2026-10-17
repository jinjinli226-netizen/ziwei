import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationForwarder} from './conversation-forward.mjs';
import {readFile} from 'node:fs/promises';
import {createConversationRequestSequence,mergeConversationLists} from './conversation-execution-state.mjs';
const scope={workspace:'team',actor:'owner',employeeId:'source-employee',conversationId:'source'};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const accepted=body=>({forward:{id:'fwd-1',sourceConversationId:'source',targetConversationId:'target-conversation',targetEmployeeId:body.targetEmployeeId,mode:body.mode},message:{id:'message'}});
function setup(send,options={}){let n=0;const store=createConversationForwarder({send,makeId:()=>`request-${++n}`,...options});store.setScope(scope);store.begin(['m1']);store.update({targetEmployeeId:'target'});return store;}
test('reference is default and a pending request cannot dispatch twice or change its payload',async()=>{
  const wait=deferred(),calls=[];const store=setup((id,body)=>{calls.push({id,body});return wait.promise;});
  assert.equal(store.state.mode,'reference');const pending=store.submit(['target']);
  assert.equal(store.update({mode:'execute'}),false);assert.equal(await store.submit(['target']),null);assert.equal(calls.length,1);
  wait.resolve(accepted(calls[0].body));assert.equal((await pending).current,true);assert.equal(store.state.dialog,false);
});
test('unknown network outcome retries the exact request and cannot become a new execution',async()=>{
  const calls=[];let failed=true;const store=setup(async(id,body)=>{calls.push(body);if(failed)throw new TypeError('network');return accepted(body);});
  store.update({mode:'execute',note:'Please summarize'});await store.submit(['target']);assert.equal(store.state.status,'unknown');
  assert.equal(store.update({targetEmployeeId:'other',note:'changed'}),false);
  store.cancel();store.begin(['different-message']);assert.deepEqual(store.state.messageIds,['m1']);
  failed=false;await store.submit(['target']);assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].clientRequestId,'request-1');
});
test('scope change clears selection and ignores old response; returning can resume the same request',async()=>{
  const wait=deferred();let body;const store=setup((_id,value)=>{body=value;return wait.promise;});const pending=store.submit(['target']);
  store.setScope({...scope,conversationId:'other'});store.begin(['other-message']);store.update({targetEmployeeId:'other'});
  wait.resolve(accepted(body));assert.equal((await pending).current,false);assert.deepEqual(store.state.messageIds,['other-message']);assert.equal(store.state.dialog,true);
});
test('closing and reopening pending dialog follows the original response',async()=>{
  const wait=deferred();let body;const store=setup((_id,value)=>{body=value;return wait.promise;});const pending=store.submit(['target']);
  store.cancel();store.begin(['m2']);assert.equal(store.state.status,'pending');assert.equal(await store.submit(['target']),null);
  wait.resolve(accepted(body));await pending;assert.equal(store.state.dialog,false);assert.equal(store.state.result.forward.id,'fwd-1');
});
test('unmount and actor switch discard draft; stored unknown request resumes only its original actor scope',async()=>{
  const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const first=setup(async()=>{throw new Error('lost');},{storage});await first.submit(['target']);first.dispose();assert.equal(first.state.dialog,false);
  const restored=setup(async(_id,body)=>accepted(body),{storage});assert.equal(restored.state.status,'unknown');assert.equal(restored.state.clientRequestId,'request-1');
  restored.setScope({...scope,actor:'other'});restored.begin(['m2']);assert.equal(restored.state.status,'idle');assert.deepEqual(restored.state.messageIds,['m2']);
});
test('20-message and visible target limits reject locally, notes are bounded',async()=>{
  let calls=0;const store=setup(async()=>{calls++;});store.begin([],{selecting:true});for(let i=0;i<20;i++)assert.equal(store.toggle('m'+i),true);
  assert.equal(store.toggle('m20'),false);store.open();store.update({targetEmployeeId:'invisible'});await store.submit(['target']);assert.equal(calls,0);
  store.update({targetEmployeeId:'target',note:'x'.repeat(4001)});await store.submit(['target']);assert.equal(calls,0);
});
test('explicit busy or permission rejection permits correction, server failures stay unknown',async()=>{
  for(const status of [403,404,409,413]){
    const store=setup(async()=>{throw Object.assign(new Error('rejected'),{status});});await store.submit(['target']);assert.equal(store.state.status,'error');assert.equal(store.update({note:'fixed'}),true);
  }
  for(const status of [408,500,502]){
    const store=setup(async()=>{throw Object.assign(new Error('lost'),{status});});await store.submit(['target']);assert.equal(store.state.status,'unknown');assert.equal(store.update({note:'no'}),false);
  }
});
test('malformed success and idempotency conflicts cannot silently create a fresh request',async()=>{
  for(const send of [async()=>({}),...['IDEMPOTENCY_CONFLICT','FORWARD_REQUEST_CONFLICT','FORWARD_RECEIPT_INVALID'].map(code=>async()=>{throw Object.assign(new Error('conflict'),{status:409,code});})]){
    const store=setup(send);await store.submit(['target']);assert.equal(store.state.status,'unknown');store.cancel();store.begin(['different']);assert.deepEqual(store.state.messageIds,['m1']);
  }
});
test('a later 4xx cannot release an unknown original request that may already have committed',async()=>{
  for(const status of [403,404,409,413]){
    const bodies=[];let attempt=0;const store=setup(async(_id,body)=>{bodies.push(body);if(++attempt===1)throw new TypeError('response lost');throw Object.assign(new Error('later rejection'),{status});});
    await store.submit(['target']);await store.submit(['target']);assert.equal(store.state.status,'unknown');assert.equal(store.update({note:'second dispatch'}),false);
    store.cancel();store.begin(['other']);await store.submit(['target']);assert.equal(bodies.length,3);assert.deepEqual(bodies[0],bodies[1]);assert.deepEqual(bodies[0],bodies[2]);
  }
});
test('view recipient uses only the existing receipt conversation and retains explicit target ownership',async()=>{
  const source=await readFile(new URL('./App.vue',import.meta.url),'utf8');
  const handler=source.slice(source.indexOf('async function openForwardTargetConversation('),source.indexOf('const conversationReadReceipts='));
  const state={result:{forward:{sourceConversationId:'source',targetConversationId:'existing-target',targetEmployeeId:'target'}}};
  const selected={value:{id:'source'}},employee={value:'source-employee'},list={value:[{id:'old',employee_id:'source-employee'}]},intent={value:null},pending={value:false},calls=[];
  const run=new Function('conversationForward','workspaceSlug','selectedConversation','navigate','conversationEmployeeId','conversations','botChatIntent','botBindingPending','openConversation','loadConversations',`${handler};return openForwardTargetConversation;`)(state,()=> 'team',selected,page=>{calls.push(page);selected.value=null;state.result=null;},employee,list,intent,pending,async(item,options)=>{assert.equal(employee.value,'target');assert.equal(intent.value.opening,true);assert.deepEqual(item,{id:'existing-target'});assert.equal(options.workspace,'team');calls.push(item.id);selected.value={id:item.id};return true;},async options=>{assert.equal(options.autoSelect,false);assert.equal(intent.value.opening,true);calls.push('target-list');});
  assert.equal(await run(),true);assert.deepEqual(calls,['inbox','existing-target','target-list']);assert.equal(intent.value,null);assert.deepEqual(list.value,[]);
});
for(const switchWhileLoading of [false,true])test(`recipient list refresh keeps its explicit selection${switchWhileLoading?' and ignores a late prior-employee list':''}`,async()=>{
  const source=await readFile(new URL('./App.vue',import.meta.url),'utf8');
  const open=source.slice(source.indexOf('async function openForwardTargetConversation('),source.indexOf('const conversationReadReceipts='));
  const load=source.slice(source.indexOf('async function loadConversations('),source.indexOf('async function loadConversationExecution('));
  const state={result:{forward:{sourceConversationId:'source',targetConversationId:'new-canonical',targetEmployeeId:'target'}}};
  const selected={value:{id:'source'}},employee={value:'source-employee'},list={value:[]},intent={value:null},pending={value:false},gate=deferred(),calls=[];
  const requestScope=()=>({workspace:'team',employee:employee.value,generation:1});
  const run=new Function('conversationForward','workspaceSlug','selectedConversation','navigate','conversationEmployeeId','conversations','botChatIntent','botBindingPending','openConversation','api','conversationRequests','conversationRequestScope','mergeConversationLists','conversationIdFromPath',`let conversationListGeneration=0;${load}\n${open};return openForwardTargetConversation;`)(state,()=> 'team',selected,()=>{selected.value=null;state.result=null;},employee,list,intent,pending,async item=>{calls.push(item.id);selected.value={id:item.id,employee_id:employee.value};return true;},{conversations:async id=>{assert.equal(id,'target');return gate.promise;}},createConversationRequestSequence(),requestScope,mergeConversationLists,()=> 'older-target-chat');
  const operation=run();await Promise.resolve();await Promise.resolve();assert.equal(intent.value.opening,true);
  if(switchWhileLoading){employee.value='another-employee';selected.value={id:'user-selected',employee_id:employee.value};list.value=[selected.value];intent.value=null;}
  gate.resolve({conversations:[{id:'older-target-chat',employee_id:'target'},{id:'new-canonical',employee_id:'target',message_count:1}]});await operation;
  assert.deepEqual(calls,['new-canonical']);assert.equal(selected.value.id,switchWhileLoading?'user-selected':'new-canonical');
  assert.deepEqual(list.value.map(item=>item.id),switchWhileLoading?['user-selected']:['older-target-chat','new-canonical']);assert.equal(intent.value,null);
});
