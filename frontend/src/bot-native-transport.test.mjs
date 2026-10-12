import test from 'node:test';import assert from 'node:assert/strict';
const mod=await import('./bot-native-transport.js').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
const receipt=(resource='memory',data={content:'native content',hash:'h1'})=>({schemaVersion:2,resource,operation:'read',employeeId:'bot',revision:4,nativeVersion:'0.21.3',status:'succeeded',data});
const done=result=>({id:'native-action',status:'succeeded',result:{nativeOperation:result}});
function fixture(overrides={}){const calls=[];return {calls,transport:mod.createNativeBotTransport({getBot:()=>({id:'bot',workspace:'a',revision:4,control_epoch:7}),api:{botNativeAction:async(id,body,workspace)=>{calls.push({id,body,workspace});return {action:done(receipt(body.resource))};},botRuns:async()=>({runs:[done(receipt())]}),...overrides},keyFactory:()=> 'native-read-key',wait:async()=>{}})};}
test('native read uses the documented action endpoint, Bot revision/epoch and requested memory scope',async()=>{
  const {transport,calls}=fixture();const value=await transport.read({workspace:'a',botId:'bot',resource:'memory',query:{scope:'user'}});
  assert.equal(calls[0].workspace,'a');assert.equal(calls[0].id,'bot');assert.deepEqual(calls[0].body,{expectedRevision:4,expectedControlEpoch:7,idempotencyKey:'native-read-key',resource:'memory',operation:'read',input:{scope:'user'}});
  assert.equal(value.data.content,'native content');assert.equal(value.revision,4);assert.equal(value.receipt.nativeVersion,'0.21.3');
});
test('native read polls only its exact accepted action and never adopts another Bot result',async()=>{
  let queries=0;const {transport}=fixture({botNativeAction:async()=>({action:{id:'native-action',status:'pending'}}),botRuns:async()=>{queries++;return {runs:[{id:'unrelated',status:'succeeded',result:{nativeOperation:receipt('memory',{content:'other'})}},done(receipt())]};}});
  const value=await transport.read({workspace:'a',botId:'bot',resource:'memory'});assert.equal(queries,1);assert.equal(value.data.content,'native content');
});
test('a native receipt for another employee is rejected before exposing private data',async()=>{
  const {transport}=fixture({botNativeAction:async()=>({action:done({...receipt(),employeeId:'other'})})});
  await assert.rejects(transport.read({workspace:'a',botId:'bot',resource:'memory'}),/员工|归属/);
});
test('missing authorization and dependency are explicit completed management outcomes, never native success',async()=>{
  const {transport}=fixture({botNativeAction:async()=>({action:done({...receipt('voice'),status:'requires_authorization',data:{reason:'STT credentials missing'}})})});
  await assert.rejects(transport.read({workspace:'a',botId:'bot',resource:'voice'}),error=>error.code==='NATIVE_REQUIRES_AUTHORIZATION'&&error.status===412);
});
test('submit preserves the original idempotency key and expected version without guessing an endpoint',async()=>{
  const {transport,calls}=fixture();const response=await transport.submit({workspace:'a',botId:'bot',resource:'skills',operation:'install',input:{name:'notes',content:'body'},expectedRevision:3,idempotencyKey:'same-intent'});
  assert.equal(response.kind,'action');assert.equal(calls[0].body.expectedRevision,3);assert.equal(calls[0].body.expectedControlEpoch,7);assert.equal(calls[0].body.idempotencyKey,'same-intent');
});
