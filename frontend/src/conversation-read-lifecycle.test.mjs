import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('./App.vue',import.meta.url),'utf8');
const handler=source.slice(source.indexOf('function markVisibleConversationMessage('),source.indexOf('function attachConversationRead('));
function fixture(send){
  const page={value:'inbox'},selectedConversation={value:{id:'conversation',messages:[{id:'one'},{id:'two'},{id:'three'}]}},authState={value:{user:{id:'actor'}}},document={visibilityState:'visible'},conversationReadReceipts=new Map();
  let workspace='team';const scope=()=>JSON.stringify([workspace,authState.value.user.id,selectedConversation.value.id]),conversationReadScope={get value(){return page.value==='inbox'?scope():'';}};
  const run=new Function('api','page','selectedConversation','authState','document','conversationReadReceipts','conversationReadScope','workspaceSlug',`${handler};return markVisibleConversationMessage;`)({markConversationRead:send},page,selectedConversation,authState,document,conversationReadReceipts,conversationReadScope,()=>workspace);
  return {run,scope,page,selectedConversation,authState,document,conversationReadReceipts,setWorkspace:value=>{workspace=value;}};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('actual read handler refuses hidden, stale-scope and non-message observations',()=>{
  let calls=0;const f=fixture(async()=>{calls++;return {};});
  assert.equal(f.run({scope:'old',messageId:'one'}),false);assert.equal(f.run({scope:f.scope(),messageId:'foreign'}),false);
  f.document.visibilityState='hidden';assert.equal(f.run({scope:f.scope(),messageId:'one'}),false);assert.equal(calls,0);
});
test('actual read handler serializes and deduplicates the newest visible watermark',async()=>{
  const waits=[],calls=[];const f=fixture((id,messageId)=>{calls.push({id,messageId});const wait=deferred();waits.push(wait);return wait.promise;});
  const first=f.run({scope:f.scope(),messageId:'one'});f.run({scope:f.scope(),messageId:'one'});f.run({scope:f.scope(),messageId:'two'});f.run({scope:f.scope(),messageId:'three'});
  assert.equal(calls.length,1);waits[0].resolve({lastReadMessageId:'one'});assert.equal(await first,true);
  assert.deepEqual(calls.map(call=>call.messageId),['one','three']);waits[1].resolve({lastReadMessageId:'three'});await Promise.resolve();await Promise.resolve();
  assert.equal(f.run({scope:f.scope(),messageId:'two'}),true);assert.equal(calls.length,2);
});
test('old actor read completion cannot flush queued IDs into a new actor scope',async()=>{
  const wait=deferred(),calls=[];const f=fixture((id,messageId)=>{calls.push({id,messageId});return wait.promise;});
  const oldScope=f.scope(),first=f.run({scope:oldScope,messageId:'one'});f.run({scope:oldScope,messageId:'three'});
  f.authState.value.user.id='another-user';assert.equal(f.run({scope:oldScope,messageId:'three'}),false);
  wait.resolve({lastReadMessageId:'one'});await first;assert.equal(calls.length,1);
});
test('failed read never marks success or blocks a later observed retry',async()=>{
  let calls=0;const f=fixture(async()=>{if(++calls===1)throw new Error('offline');return {lastReadMessageId:'two'};});
  assert.equal(await f.run({scope:f.scope(),messageId:'two'}),false);assert.equal(await f.run({scope:f.scope(),messageId:'two'}),true);assert.equal(calls,2);
});
