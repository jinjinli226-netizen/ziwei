import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const mod=await import('./bot-native-transport.js').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
const receipt=(resource='memory',data={content:'native content',hash:'h1'})=>({schemaVersion:2,resource,operation:'read',employeeId:'bot',revision:4,nativeVersion:'0.21.3',status:'succeeded',data});
const done=result=>({id:'native-action',status:'succeeded',result:{nativeOperation:result}});

test('collaboration progress resolves exact target actions and checks their source lineage',async()=>{
  const source={id:'source',status:'succeeded',payload:{nativeOperation:{resource:'collaboration'}},result:{collaboration:{actions:[{id:'child',employeeId:'target',status:'pending'}]}}};
  const child={id:'child',status:'failed',error:'target failed',payload:{employeeId:'target',hermesBot:{employeeId:'target',workspace:'a'},collaboration:{sourceEmployeeId:'bot',sourceActionId:'source'}}};
  const {transport}=fixture({botRuns:async id=>({runs:id==='bot'?[source]:[child]})});
  const value=await transport.read({workspace:'a',botId:'bot',resource:'collaboration'});
  assert.equal(value.data.runs.find(row=>row.id==='child').status,'failed');
  child.payload.collaboration.sourceEmployeeId='other';await assert.rejects(transport.read({workspace:'a',botId:'bot',resource:'collaboration'}),/归属/);
});
test('in-flight source collaboration accepts its array of child receipts without inventing a source action',async()=>{
  const child={id:'child',status:'pending',payload:{employeeId:'target',hermesBot:{employeeId:'target',workspace:'a'},collaboration:{sourceEmployeeId:'bot',sourceActionId:'source'}}};
  const {transport}=fixture({collaborateBot:async()=>({actions:[child]})});
  const result=await transport.submit({workspace:'a',botId:'bot',resource:'collaboration',operation:'delegate',idempotencyKey:'original',input:{sourceActionId:'source',targetEmployeeIds:['target'],content:'task'}});
  assert.equal(result.kind,'collaboration');assert.equal(result.actions[0].id,'child');assert.equal(result.action,undefined);
});
test('bounded driver receipts accept only known internal stages tied to the exact public action',async()=>{
  const value=done({...receipt('goals'),operation:'_settle'});value.payload={hermesBot:{revision:4},nativeOperation:{resource:'goals',operation:'step',requestId:'driver'}};
  const {transport}=fixture({botRuns:async()=>({runs:[value]})});
  assert.equal((await transport.action({workspace:'a',botId:'bot',resource:'goals',operation:'step',expectedRevision:4,idempotencyKey:'driver',actionId:value.id})).result.nativeOperation.operation,'_settle');
  value.result.nativeOperation.operation='_unrecognized';await assert.rejects(transport.action({workspace:'a',botId:'bot',resource:'goals',operation:'step',expectedRevision:4,idempotencyKey:'driver',actionId:value.id}),/归属/);
  value.result.nativeOperation.operation='_settle';value.payload.nativeOperation.operation='stop';await assert.rejects(transport.action({workspace:'a',botId:'bot',resource:'goals',operation:'step',expectedRevision:4,idempotencyKey:'driver',actionId:value.id}),/归属/);
});
test('group publish receipts keep their raw native stage and require the exact group action lineage',async()=>{
  const value=done({...receipt('collaboration'),operation:'publish'});value.payload={hermesBot:{revision:4},nativeOperation:{resource:'groups',operation:'step',requestId:'group'}};
  const {transport}=fixture({botRuns:async()=>({runs:[value]})});
  assert.equal((await transport.action({workspace:'a',botId:'bot',resource:'groups',operation:'step',expectedRevision:4,idempotencyKey:'group',actionId:value.id})).result.nativeOperation.resource,'collaboration');
  value.payload.nativeOperation.resource='memory';await assert.rejects(transport.action({workspace:'a',botId:'bot',resource:'groups',operation:'step',expectedRevision:4,idempotencyKey:'group',actionId:value.id}),/归属/);
});
test('lost sourced collaboration lookup finds only the original dedupe batch after source completion',async()=>{
  const prefix='bot-target:'+createHash('sha256').update(JSON.stringify(['bot','completed-source','original-key'])).digest('hex')+':';
  const child={id:'exact-child',dedupe_key:prefix+'target',status:'pending',payload:{employeeId:'target',hermesBot:{employeeId:'target',workspace:'a'},collaboration:{sourceEmployeeId:'bot',sourceActionId:'completed-source'}}};
  const unrelated={...child,id:'different-request',dedupe_key:'bot-target:different:target'};
  const {transport}=fixture({botRuns:async id=>({runs:id==='target'?[unrelated,child]:[]})});
  const value=await transport.lookup({workspace:'a',botId:'bot',resource:'collaboration',operation:'delegate',idempotencyKey:'original-key',readHints:{sourceActionId:'completed-source',targetEmployeeIds:['target']}});
  assert.equal(value.kind,'collaboration');assert.deepEqual(value.actions.map(row=>row.id),['exact-child']);
});
function fixture(overrides={}){const calls=[];return {calls,transport:mod.createNativeBotTransport({getBot:()=>({id:'bot',workspace:'a',revision:4,control_epoch:7}),api:{botNativeAction:async(id,body,workspace)=>{calls.push({id,body,workspace});return {action:done({...receipt(body.resource),operation:body.operation,revision:body.expectedRevision})};},botRuns:async()=>({runs:[done(receipt())]}),...overrides},keyFactory:()=> 'native-read-key',wait:async()=>{}})};}
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
  const {transport}=fixture({botNativeAction:async()=>({action:done({...receipt('voice'),operation:'status',status:'requires_authorization',data:{reason:'STT credentials missing'}})})});
  await assert.rejects(transport.read({workspace:'a',botId:'bot',resource:'voice'}),error=>error.code==='NATIVE_REQUIRES_AUTHORIZATION'&&error.status===412);
});
test('submit preserves the original idempotency key and expected version without guessing an endpoint',async()=>{
  const {transport,calls}=fixture();const response=await transport.submit({workspace:'a',botId:'bot',resource:'skills',operation:'install',input:{name:'notes',content:'body'},expectedRevision:3,idempotencyKey:'same-intent'});
  assert.equal(response.kind,'action');assert.equal(calls[0].body.expectedRevision,3);assert.equal(calls[0].body.expectedControlEpoch,7);assert.equal(calls[0].body.idempotencyKey,'same-intent');
});
test('a frozen native intent retains exactly the original control epoch when the Bot later changes',async()=>{
  let epoch=7;const calls=[];
  const transport=mod.createNativeBotTransport({getBot:()=>({id:'bot',workspace:'a',revision:4,control_epoch:epoch}),api:{botNativeAction:async(_id,body)=>{calls.push(body);return {action:done({...receipt('skills'),operation:'install'})};}}});
  const intent=transport.freeze({workspace:'a',botId:'bot',resource:'skills',operation:'install',input:{name:'x'},idempotencyKey:'same-intent'});
  await transport.submit(intent);epoch=8;await transport.submit(intent);assert.deepEqual(calls[0],calls[1]);assert.equal(calls[1].expectedControlEpoch,7);
});
