import test from 'node:test';
import assert from 'node:assert/strict';
const mod=await import('./bot-native-operations.js').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
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
