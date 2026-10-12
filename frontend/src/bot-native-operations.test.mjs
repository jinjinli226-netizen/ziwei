import test from 'node:test';
import assert from 'node:assert/strict';
const mod=await import('./bot-native-operations.js').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};

test('a terminal staged memory review retains private-free evidence without occupying execution',async()=>{
  const data=new Map(),storage={getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
  const ui=mod.createBotNativeOperations({namespace:'review-test',storage,transport:{submit:async()=>({kind:'action',action:{id:'review-action',status:'succeeded',result:{nativeOperation:{status:'requires_authorization',data:{scope:'user',saved:false,mutation:{staged:true,pending_id:'review-1'}}}}}})}});
  ui.select('a','bot');await ui.submit('memory','write',{scope:'user',content:'private-body'});
  assert.equal(ui.resource('memory').phase,'staged');assert.equal(ui.resource('memory').review.pendingId,'review-1');assert.equal(ui.blocked(),false);assert.equal(ui.resource('memory').pending,null);
  assert.doesNotMatch([...data.values()].join(''),/private-body/);
});
test('successful write with failed readback keeps the original result and retries only read',async()=>{
  let submits=0,reads=0;const ui=mod.createBotNativeOperations({transport:{submit:async()=>{submits++;return {kind:'action',action:{id:'original',status:'succeeded',result:{output:'completed'}}};},read:async()=>{if(++reads===1)throw new TypeError('offline');return {data:{content:'read back'}};}}});
  ui.select('a','bot');assert.equal(await ui.submit('memory','write',{content:'new'}),false);assert.equal(ui.resource('memory').phase,'readback_required');assert.equal(ui.resource('memory').action.id,'original');assert.equal(ui.blocked(),false);
  await ui.read('memory');assert.equal(submits,1);assert.equal(ui.resource('memory').phase,'succeeded');
});
test('fresh module reload restores only metadata and locates the original action without POST replay',async()=>{
  const rows=new Map(),storage={getItem:key=>rows.get(key),setItem:(key,value)=>rows.set(key,value),removeItem:key=>rows.delete(key)};
  const ui=mod.createBotNativeOperations({namespace:'fresh-reload',storage,transport:{submit:async()=>{throw new TypeError('lost response');}}});
  ui.select('a','bot');await ui.submit('memory','write',{scope:'user',content:'never persist this body'});
  const fresh=await import('./bot-native-operations.js?fresh='+Date.now());let posts=0;
  const reloaded=fresh.createBotNativeOperations({namespace:'fresh-reload',storage,transport:{submit:async()=>posts++,lookup:async intent=>{assert.equal(intent.input,undefined);return {id:'original',status:'succeeded'};},read:async()=>({data:{scope:'user',content:'confirmed'}})}});
  reloaded.select('a','bot');await reloaded.recover('memory');assert.equal(posts,0);assert.equal(reloaded.resource('memory').data.data.content,'confirmed');
});
test('a collaboration receipt array records each target without treating dispatch as target completion',async()=>{
  let reads=0;const ui=mod.createBotNativeOperations({transport:{submit:async()=>({kind:'collaboration',actions:[{id:'child-a',status:'pending',payload:{employeeId:'a'}},{id:'child-b',status:'failed',payload:{employeeId:'b'}}]}),read:async context=>{reads++;assert.equal(context.query.actionRefs.length,2);return {data:{runs:[{id:'child-a',status:'pending'},{id:'child-b',status:'failed'}]}};}}});
  ui.select('ws','source');await ui.submit('collaboration','delegate',{sourceActionId:'source-action',targetEmployeeIds:['a','b'],content:'private task'});
  assert.equal(ui.resource('collaboration').phase,'dispatched');assert.equal(ui.resource('collaboration').action,null);assert.equal(ui.blocked(),false);assert.equal(reads,1);
});
test('fresh sourced collaboration recovery transfers exact child metadata to tracking without replay',async()=>{
  const rows=new Map(),storage={getItem:key=>rows.get(key),setItem:(key,value)=>rows.set(key,value),removeItem:key=>rows.delete(key)};
  const ui=mod.createBotNativeOperations({namespace:'fresh-sourced',storage,transport:{submit:async()=>{throw new TypeError('lost dispatch');}}});ui.select('ws','source');await ui.submit('collaboration','delegate',{sourceActionId:'parent',targetEmployeeIds:['target'],content:'private delegate body'});
  const fresh=await import('./bot-native-operations.js?source-reload='+Date.now());let posts=0;
  const reloaded=fresh.createBotNativeOperations({namespace:'fresh-sourced',storage,transport:{submit:async()=>posts++,lookup:async()=>({kind:'collaboration',actions:[{id:'original-child',status:'pending',payload:{employeeId:'target'}}]}),read:async context=>{assert.equal(context.query.actionRefs[0].sourceActionId,'parent');return {data:{runs:[{id:'original-child',status:'pending'}]}};}}});reloaded.select('ws','source');await reloaded.recover('collaboration');assert.equal(posts,0);assert.equal(reloaded.blocked(),false);assert.equal(reloaded.resource('collaboration').phase,'dispatched');assert.doesNotMatch([...rows.values()].join(''),/private delegate body/);
});
test('native review evidence survives a later independent memory intent without creating a permanent scope lock',async()=>{
  const rows=new Map(),storage={getItem:key=>rows.get(key),setItem:(key,value)=>rows.set(key,value),removeItem:key=>rows.delete(key)};let calls=0;
  const ui=mod.createBotNativeOperations({namespace:'review-later',storage,transport:{submit:async()=>({kind:'action',action:{id:'action-'+(++calls),status:'succeeded',result:{nativeOperation:{status:calls===1?'requires_authorization':'succeeded',data:calls===1?{scope:'memory',saved:false,mutation:{staged:true,pending_id:'review-original'}}:{saved:true}}}}}),read:async()=>({data:{scope:'memory',hash:'new-hash'}})}});ui.select('ws','bot');await ui.submit('memory','write',{scope:'memory',content:'first'});await ui.read('memory');assert.equal(await ui.submit('memory','write',{scope:'memory',content:'independent second intent'}),true);assert.equal(calls,2);assert.match([...rows.values()].join(''),/review-original/);assert.equal(ui.resource('memory').review.pendingId,'review-original');
});
function fixture(overrides={}){
  const calls=[];let value={revision:1,documents:[]};
  const transport={read:async()=>value,submit:async intent=>{calls.push(intent);value={revision:2,documents:[{id:'memory',content:intent.input.content}]};return {kind:'snapshot',snapshot:value};},action:async()=>({id:'action-a',status:'succeeded',result:{executionSource:'native'}}),...overrides};
  return {ui:mod.createBotNativeOperations({transport,keyFactory:()=>`intent-${calls.length+1}`}),calls};
}
test('native resource reads are scoped to the current visit and independent resource channel',async()=>{
  const old=deferred(),{ui}=fixture({read:async({workspace,resource})=>workspace==='a'&&resource==='memory'?old.promise:{revision:3,workspace,resource}});
  ui.select('a','bot');const read=ui.read('memory');ui.select('b','bot');await ui.read('skills');old.resolve({revision:1,privateContent:'a'});await read;
  assert.equal(ui.resource('memory').data,null);assert.equal(ui.resource('skills').data.workspace,'b');
  ui.select('a','bot');assert.equal(ui.resource('memory').data,null);
});
test('native configuration save uses the read version and confirms actual persisted readback',async()=>{
  const {ui,calls}=fixture();ui.select('a','bot');await ui.read('memory');ui.draft('memory',{content:'edited'});
  assert.equal(await ui.submit('memory','save',ui.resource('memory').draft),true);
  assert.equal(calls[0].expectedRevision,1);assert.equal(calls[0].workspace,'a');assert.equal(calls[0].botId,'bot');assert.equal(ui.resource('memory').data.revision,2);assert.equal(ui.resource('memory').phase,'succeeded');
});
test('a read begun before saving cannot roll confirmed native data back',async()=>{
  const delayed=deferred();let reads=0;
  const {ui}=fixture({read:async()=>++reads===2?delayed.promise:{revision:reads>2?2:1}});
  ui.select('a','bot');await ui.read('memory');const old=ui.read('memory');await ui.submit('memory','save',{content:'new'});delayed.resolve({revision:1});await old;
  assert.equal(ui.resource('memory').data.revision,2);
});
test('a native operation conflict preserves its draft and never retries automatically',async()=>{
  let calls=0;const {ui}=fixture({submit:async()=>{calls++;throw Object.assign(new Error('revision conflict'),{status:409,code:'NATIVE_REVISION_CONFLICT'});}});
  ui.select('a','bot');await ui.read('memory');ui.draft('memory',{content:'keep'});await ui.submit('memory','save',ui.resource('memory').draft);
  assert.equal(calls,1);assert.equal(ui.resource('memory').draft.content,'keep');assert.equal(ui.resource('memory').phase,'conflict');assert.equal(ui.resource('memory').pending,null);
});
test('unknown native write keeps its original intent through GET and explicit recovery',async()=>{
  const intents=[];let count=0;const {ui}=fixture({submit:async intent=>{intents.push(intent);if(++count===1)throw new TypeError('lost acceptance response');return {kind:'action',action:{id:'action-a',status:'pending'}};}});
  ui.select('a','bot');await ui.read('memory');await ui.submit('memory','save',{content:'original'});await ui.read('memory');
  assert.equal(ui.resource('memory').phase,'unknown');await ui.submit('memory','save',{content:'second'});assert.equal(intents.length,1);
  await ui.recover('memory');assert.equal(intents.length,2);assert.equal(intents[0].idempotencyKey,intents[1].idempotencyKey);assert.equal(intents[1].input.content,'original');assert.equal(ui.resource('memory').phase,'accepted');
});
test('async native receipts never count accepted as completed and preserve execution evidence',async()=>{
  const {ui}=fixture({submit:async()=>({kind:'action',action:{id:'action-a',status:'acked'}})});ui.select('a','bot');await ui.submit('skills','install',{name:'example'});
  assert.equal(ui.resource('skills').phase,'accepted');assert.equal(ui.resource('skills').result,null);await ui.poll('skills');
  assert.equal(ui.resource('skills').phase,'succeeded');assert.equal(ui.resource('skills').result.executionSource,'native');assert.equal(ui.resource('skills').pending,null);
});
test('uncertain native execution only queries its existing action and blocks another business intent',async()=>{
  let submissions=0,queries=0;const {ui}=fixture({submit:async()=>{submissions++;return {kind:'action',action:{id:'action-a',status:'failed',result:{code:'EXECUTION_UNCERTAIN'}}};},action:async()=>{queries++;return {id:'action-a',status:'failed',result:{code:'EXECUTION_UNCERTAIN'}};}});
  ui.select('a','bot');await ui.submit('collaboration','delegate',{targetId:'other'});assert.equal(ui.resource('collaboration').phase,'uncertain');
  await ui.submit('collaboration','delegate',{targetId:'other'});await ui.recover('collaboration');assert.equal(submissions,1);assert.equal(queries,1);assert.equal(ui.resource('collaboration').phase,'uncertain');
});
test('an accepted operation from a previous visit cannot affect another Bot and remains recoverable on return',async()=>{
  const accepted=deferred(),{ui}=fixture({submit:()=>accepted.promise});ui.select('a','bot-a');const submission=ui.submit('memory','save',{content:'original'});ui.select('a','bot-b');accepted.resolve({kind:'action',action:{id:'action-a',status:'pending'}});await submission;
  assert.equal(ui.resource('memory').action,null);assert.equal(ui.resource('memory').data,null);ui.select('a','bot-a');assert.equal(ui.resource('memory').pending.idempotencyKey,'intent-1');
});
test('native read failure never creates a write-unknown marker or claims operation success',async()=>{
  const {ui}=fixture({read:async()=>{throw new TypeError('network');}});ui.select('a','bot');await ui.read('memory');
  assert.equal(ui.resource('memory').phase,'idle');assert.equal(ui.resource('memory').pending,null);assert.ok(ui.resource('memory').error);
});
test('native dependency and staged outcomes never become committed success merely because the action ended',async()=>{
  for(const [receipt,phase] of [[{status:'requires_dependency',data:{reason:'SDK missing'}},'requires_dependency'],[{status:'succeeded',data:{staged:true,pending_id:'pending-memory'}},'staged']]){
    const {ui}=fixture({submit:async()=>({kind:'action',action:{id:'action-a',status:'succeeded',result:{nativeOperation:receipt}}})});ui.select('a','bot');await ui.submit('memory','save',{content:'new'});
    assert.equal(ui.resource('memory').phase,phase);assert.notEqual(ui.resource('memory').phase,'succeeded');
  }
});
test('unknown recovery preserves its marker after idempotency conflict or HTTP 500',async()=>{
  let count=0;const {ui}=fixture({submit:async()=>{if(++count===1)throw new TypeError('lost response');throw Object.assign(new Error('fingerprint conflict'),{status:409,code:'BOT_IDEMPOTENCY_CONFLICT'});}});
  ui.select('a','bot');await ui.submit('skills','install',{name:'x'});const key=ui.resource('skills').pending.idempotencyKey;await ui.recover('skills');
  assert.equal(ui.resource('skills').phase,'unknown');assert.equal(ui.resource('skills').pending.idempotencyKey,key);
  const server=fixture({submit:async()=>{throw Object.assign(new Error('server error after acceptance'),{status:500});}}).ui;server.select('a','bot');await server.submit('skills','install',{name:'x'});assert.equal(server.resource('skills').phase,'unknown');assert.ok(server.resource('skills').pending);
});
test('returning to a Bot cannot bypass a pending native operation before a resource is hydrated',async()=>{
  let calls=0;const {ui}=fixture({submit:async()=>{calls++;throw new TypeError('lost response');}});ui.select('a','bot-a');await ui.submit('memory','write',{content:'first'});
  ui.select('a','bot-b');ui.select('a','bot-a');await ui.submit('skills','install',{name:'second'});assert.equal(calls,1);assert.equal(ui.resource('memory').phase,'unknown');
});
test('controller reconstruction retains unknown identity metadata without persisting private memory content',async()=>{
  const values=new Map(),storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const transport={read:async()=>({revision:1}),submit:async()=>{throw new TypeError('lost response');},lookup:async()=>({id:'original',status:'pending'}),action:async()=>({id:'original',status:'pending'})};
  const first=mod.createBotNativeOperations({transport,namespace:'test-account-recovery',storage,keyFactory:()=> 'original-key'});first.select('a','bot');await first.submit('memory','write',{content:'PRIVATE_BODY_DO_NOT_CACHE'});first.dispose();
  assert.doesNotMatch([...values.values()].join(''),/PRIVATE_BODY_DO_NOT_CACHE/);
  const second=mod.createBotNativeOperations({transport,namespace:'test-account-recovery',storage});second.select('a','bot');assert.equal(second.blocked(),true);assert.equal(second.resource('memory').pending.idempotencyKey,'original-key');
});
