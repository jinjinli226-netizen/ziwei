import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {reactive} from 'vue';
import {createRepository} from '../../backend/repository.mjs';
import {createManagementService} from '../../backend/management.mjs';
import {createDshNativeService,projectDshNativeAction} from '../../backend/dsh-native-operations.mjs';
import {createDshNativeSecrets} from '../../backend/dsh-native-secrets.mjs';
import {createBotProviderCredentialService} from '../../backend/bot-provider-credentials.mjs';
import {DSH_NATIVE_FEATURE} from '../../src/dsh-native-contract.mjs';
import {openSecret} from '../../src/bot-secret-crypto.mjs';
import {createDshNative} from './dsh-native.js';
const secure=await import('./dsh-native-secure.js').catch(()=>({}));
const keys=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});

async function fixture(t,{prepare,answer,receiptStatus='applied',withProviders=false,withPlugins=false,nativeSubmit}={}){
  const repo=createRepository({memory:true}),db=repo.db,workspace='test-111',ws=repo.getWorkspace(workspace),context={actorUserId:'owner-secure',actorRole:'owner'};
  db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run('owner-secure-member',ws.id,context.actorUserId,'Owner','owner@fixture.invalid','owner',new Date().toISOString());
  const pairing=repo.claimDevicePairing({code:repo.createDevicePairing(workspace,{createdBy:context.actorUserId,name:'Secure fixture'}).code}),credential=repo.authenticateDeviceToken(pairing.deviceToken);
  repo.heartbeatDevice(workspace,{deviceId:pairing.deviceId,runtimeDiscovery:{features:[DSH_NATIVE_FEATURE]},runtimes:{DSH:{status:'available',profiles:[{name:'alpha'}]}}});
  const employee=repo.createEmployee(workspace,{name:'Secure employee',runtime:'DSH',runtimeProfile:'alpha',targetDeviceId:pairing.deviceId,ownerUserId:context.actorUserId}),management=createManagementService(repo),native=createDshNativeService(repo,{management});
  createBotProviderCredentialService(repo,{bots:management.bots}).register(workspace,credential,{publicKey:keys.publicKey});
  const service=createDshNativeSecrets(repo,{management,nativeService:native}),calls=[],plaintext=[];
  const providerData={settings:{writable:true,namespaces:[{ns:'llm-pi-ai',revision:3,value:{providers:{}},user:{providers:{}},base:{}}]},providers:[],directory:[],modelCatalog:{groups:[]},credentials:{}};
  function complete(actionId,data={},status='applied',observations){const row=repo.getA2AAction(actionId),op=row.payload.dshOperation;repo.ackA2AAction(actionId,{deviceId:credential.deviceId});repo.resultA2AAction(actionId,{deviceId:credential.deviceId,status:'succeeded',result:{dshNative:{schemaVersion:1,source:'dsh-native',subject:op.subject,scope:op.scope,resource:op.resource,operation:op.operation,status,checkedAt:new Date().toISOString(),data,...(observations?{observations}:{} )}}});}
  if(withProviders){const queued=native.refresh(workspace,employee.id,{resources:['providers'],idempotencyKey:'initial-provider-observation'},context);complete(queued.action.id,{resources:{providers:{status:'observed',data:providerData}}},'observed');}
  if(withPlugins){const queued=native.refresh(workspace,employee.id,{resources:['plugins'],idempotencyKey:'initial-plugin-observation'},context);complete(queued.action.id,{resources:{plugins:{status:'observed',data:{bundles:[],plugins:[],inventory:{}}}}},'observed');}
  const api={dshNativeCapabilities:async(id,slug)=>native.capabilities(slug,id,context),dshNativeState:async(id,query,slug)=>native.state(slug,id,query,context),dshNativeAction:async(id)=>{calls.push(['get-action',id]);return projectDshNativeAction(repo.getA2AAction(id));},prepareDshNativeSecret:async(id,body,slug)=>{calls.push(['prepare',id,structuredClone(body),slug]);return prepare?prepare({id,body,slug,service}):service.prepare(slug,id,body,context);},answerDshNativeSecret:async(id,requestId,body,slug)=>{
    calls.push(['answer',id,requestId,structuredClone(body),slug]);if(answer)return answer({id,requestId,body,slug,service});
    const result=service.answer(slug,id,requestId,body,context),row=[...db.prepare("SELECT id FROM a2a_actions WHERE type='employee.dsh.operation'").all()].map(row=>repo.getA2AAction(row.id)).find(row=>row.payload.dshOperation.input.secretRequestId===requestId);
    repo.ackA2AAction(row.id,{deviceId:credential.deviceId});const claim=service.claim(row.id,requestId,credential);plaintext.push(JSON.parse(openSecret(keys.privateKey,claim.binding,claim.envelope)));
    const op=row.payload.dshOperation;repo.resultA2AAction(row.id,{deviceId:credential.deviceId,status:'succeeded',result:{dshNative:{schemaVersion:1,source:'dsh-native',subject:op.subject,scope:op.scope,resource:op.resource,operation:op.operation,status:receiptStatus,checkedAt:new Date().toISOString(),data:op.operation==='discoverModelsSecure'?[{id:'native-model'}]:{credentials:{NATIVE_API_KEY:{configured:true}}}}}});return result;
  }};
  api.submitDshNative=async(id,body,slug)=>{calls.push(['native-submit',id,structuredClone(body),slug]);const queued=native.action(slug,id,body,context);if(nativeSubmit)return nativeSubmit({id,body,slug,queued,native,repo,complete,context});complete(queued.action.id,providerData,'applied',{providers:{status:'observed',data:providerData}});return{...native.state(slug,id,{},context),action:repo.getA2AAction(queued.action.id)};};
  const controller=createDshNative({api,wrap:reactive,storage:null,setTimer:()=>0,clearTimer(){}});await controller.select({actorId:context.actorUserId,workspace,employeeId:employee.id},{active:true});
  const broker=secure.createDshNativeSecure({api,controller,wrap:reactive,keyFactory:()=> 'original-secure-key',pollLimit:2,pause:async()=>{}});
  t.after(()=>{broker.dispose();controller.dispose();service.close();db.close();});return{repo,db,service,native,complete,api,controller,broker,calls,plaintext,context,employee,workspace};
}
test('the browser broker uses real prepare/AAD encryption/answer/claim without exposing plaintext',async t=>{
  assert.equal(typeof secure.createDshNativeSecure,'function');const f=await fixture(t),payload={kind:'credential',ref:'NATIVE_API_KEY',secret:'synthetic-browser-secret'};await f.broker.submit(payload);
  assert.deepEqual(f.plaintext,[{value:'synthetic-browser-secret'}]);assert.equal(payload.secret,'');assert.equal(f.broker.state.status,'applied');assert.equal(f.broker.state.busy,false);assert.doesNotMatch(JSON.stringify({state:f.broker.state,calls:f.calls}),/synthetic-browser-secret/);assert.ok(f.calls.some(row=>row[0]==='get-action'));
});
test('secure settings and model discovery separate metadata from their exact encrypted payload',async t=>{
  for(const payload of [{resource:'settings',operation:'mutateSecure',input:{ns:'native',expectedRevision:2},secret:{ops:[{op:'set',path:['credential'],value:'synthetic-private-value'}]}},{kind:'discover-models',resource:'providers',operation:'discoverModelsSecure',input:{api:'openai-completions',baseURL:'https://provider.fixture/v1'},secret:'synthetic-private-value'}]){
    const f=await fixture(t);await f.broker.submit(payload);assert.doesNotMatch(JSON.stringify(f.calls),/synthetic-private-value|"ops"/);assert.equal(f.plaintext.length,1);assert.doesNotMatch(JSON.stringify(f.broker.state),/synthetic-private-value/);
  }
});
test('a lost prepare preserves its safe identity and does not replay prepare or retain its secret',async t=>{
  const f=await fixture(t,{prepare:()=>{throw Error('synthetic-secret-in-error');}}),payload={kind:'credential',ref:'NATIVE_API_KEY',secret:'synthetic-secret-in-error'};await f.broker.submit(payload);const original=structuredClone(JSON.parse(JSON.stringify(f.broker.state.request)));await f.broker.readAction();await f.broker.submit({kind:'credential',ref:'OTHER_KEY',secret:'discard-me'});assert.equal(f.calls.filter(row=>row[0]==='prepare').length,1);assert.equal(original.idempotencyKey,'original-secure-key');assert.equal(f.broker.state.unknown,true);assert.doesNotMatch(JSON.stringify(f.broker.state),/synthetic-secret-in-error|discard-me/);
});
test('answer uncertainty retains only original request/action references and never resends ciphertext',async t=>{
  const f=await fixture(t,{answer:()=>{throw Error('lost answer');}});await f.broker.submit({kind:'credential',ref:'NATIVE_API_KEY',secret:'synthetic-answer-secret'});assert.ok(f.broker.state.request.actionId);assert.ok(f.broker.state.request.requestId);await f.broker.readAction();assert.equal(f.calls.filter(row=>row[0]==='answer').length,1);assert.equal(f.broker.state.unknown,true);assert.doesNotMatch(JSON.stringify(f.broker.state),/synthetic-answer-secret|ciphertext|wrappedKey/);
});
test('scope changes during prepare erase the caller secret and never answer for the old employee',async t=>{
  let resolve;const waiting=new Promise(done=>resolve=done),f=await fixture(t,{prepare:({id,body,slug,service})=>{const prepared=service.prepare(slug,id,body,f.context);return waiting.then(()=>prepared);}}),payload={kind:'credential',ref:'NATIVE_API_KEY',secret:'old-scope-secret'},pending=f.broker.submit(payload);
  await new Promise(setImmediate);f.controller.state.subject={...f.controller.state.subject,actorId:'different-owner'};resolve();await pending;assert.equal(payload.secret,'');assert.equal(f.calls.filter(row=>row[0]==='answer').length,0);assert.doesNotMatch(JSON.stringify(f.broker.state),/old-scope-secret/);
});
test('Provider configuration is confirmed before secret delivery and a credential failure remains partial',async t=>{
  const f=await fixture(t,{withProviders:true,answer:()=>{throw Error('answer lost');}}),input={provider:'custom',expectedRevision:3,api:'openai-completions',baseURL:'https://provider.fixture/v1',models:[{id:'native-model'}],credentialRef:'NATIVE_API_KEY'};
  await f.broker.submit({kind:'provider',ref:'NATIVE_API_KEY',secret:'synthetic-provider-secret',mutation:{resource:'providers',operation:'upsert',input}});
  assert.deepEqual(f.calls.filter(row=>['native-submit','prepare','answer'].includes(row[0])).map(row=>row[0]),['native-submit','prepare','answer']);assert.equal(f.broker.state.steps.provider,'applied');assert.equal(f.broker.state.status,'partial');assert.match(f.broker.state.notice,/Provider.*已应用/);assert.doesNotMatch(JSON.stringify({calls:f.calls,state:f.broker.state}),/synthetic-provider-secret/);
});
test('a forged prepared binding and plain secrets in metadata never reach the answer transport',async t=>{
  const f=await fixture(t,{prepare:({id,body,slug,service})=>{const result=service.prepare(slug,id,body,f.context);result.binding.ownerUserId='foreign';return result;}});await f.broker.submit({kind:'credential',ref:'NATIVE_API_KEY',secret:'synthetic-forged-secret'});assert.equal(f.calls.some(row=>row[0]==='answer'),false);assert.doesNotMatch(JSON.stringify(f.broker.state),/synthetic-forged-secret/);
  const plain=await fixture(t);await plain.broker.submit({resource:'settings',operation:'mutateSecure',input:{ns:'native',expectedRevision:1,ops:[{value:'must-not-be-metadata'}]},secret:{ops:[]}});assert.equal(plain.calls.some(row=>row[0]==='prepare'),false);assert.doesNotMatch(JSON.stringify(plain.broker.state),/must-not-be-metadata/);
});
test('an observed-only write receipt cannot claim the credential was applied',async t=>{
  const f=await fixture(t,{receiptStatus:'observed'});await f.broker.submit({kind:'credential',ref:'NATIVE_API_KEY',secret:'synthetic-observation-secret'});assert.equal(f.broker.state.status,'unknown');assert.equal(f.broker.state.unknown,true);assert.equal(f.broker.state.steps.credential,'unknown');assert.match(f.broker.state.notice,/尚未证明/);
});
test('clear during encryption wipes input immediately and prevents the old encrypted answer',async t=>{
  const f=await fixture(t);let release,entered;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);let held;
  const broker=secure.createDshNativeSecure({api:f.api,controller:f.controller,wrap:reactive,seal:async(_key,_binding,value)=>{held=value;entered();await gate;return{};},pollLimit:1});t.after(()=>broker.dispose());const pending=broker.submit({kind:'credential',ref:'NATIVE_API_KEY',secret:'close-before-answer'});await started;broker.clear();assert.equal(held.value,null);release();await pending;assert.equal(f.calls.some(row=>row[0]==='answer'),false);assert.doesNotMatch(JSON.stringify(broker.state),/close-before-answer/);
});
test('attempt controls use the actual backend derived scope and Bot-state hash without replacing the install request',async t=>{
  const f=await fixture(t,{withPlugins:true,nativeSubmit:({id,body,slug,queued,native,repo,complete,context})=>{if(body.operation==='cancelInstall')complete(queued.action.id,{installActionId:body.input.sourceActionId,cancelRequested:true,nativeCancellation:{status:'cancelled'}},'observed');return{...native.state(slug,id,{},context),action:repo.getA2AAction(queued.action.id)};}});
  const inspected=f.native.action(f.workspace,f.employee.id,{resource:'plugins',operation:'inspectSource',input:{spec:'@fixture/native-safe'},expectedSubjectHash:f.controller.state.value.subjectHash,idempotencyKey:'native-inspection'},f.context);f.complete(inspected.action.id,{status:'accepted',bundle:true,name:'@fixture/native-safe'},'observed');
  await f.controller.submit('plugins','installBundle',{sourceActionId:inspected.action.id,enabled:false});const original=JSON.parse(JSON.stringify(f.controller.state.request));await f.controller.control('cancelInstall',{sourceActionId:original.actionId});const action=f.controller.state.controlAction;
  assert.deepEqual(action.payload.dshOperation.scope,{kind:'attempt',sourceActionId:original.actionId});assert.deepEqual(JSON.parse(JSON.stringify(f.controller.state.request)),original);assert.equal(f.calls.filter(row=>row[0]==='native-submit'&&row[2].operation==='installBundle').length,1);assert.match(f.controller.state.controlNotice,/终态/);
});
test('group controls use the actual backend member binding and keep the pending original send separate',async t=>{
  const group={id:'native-group',title:'Native group',members:['alpha','beta'],sessions:{},messages:[]};
  const f=await fixture(t,{nativeSubmit:({id,body,slug,queued,native,repo,complete,context})=>{if(body.operation==='get')complete(queued.action.id,{item:group,sourceOperation:'get'},'observed',{groups:{status:'observed',data:{items:[group]}}});if(body.operation==='cancel')complete(queued.action.id,{sourceActionId:body.input.sourceActionId,groupId:group.id,cancelRequested:true,stopConfirmed:false,members:[]},'observed');return{...native.state(slug,id,{},context),action:projectDshNativeAction(repo.getA2AAction(queued.action.id))};}});
  f.repo.heartbeatDevice(f.workspace,{deviceId:f.employee.target_device_id,runtimeDiscovery:{features:[DSH_NATIVE_FEATURE]},runtimes:{DSH:{status:'available',profiles:[{name:'alpha'},{name:'beta'}]}}});f.repo.createEmployee(f.workspace,{name:'Group peer',runtime:'DSH',runtimeProfile:'beta',targetDeviceId:f.employee.target_device_id,ownerUserId:'group-peer-owner'});
  const listed=f.native.action(f.workspace,f.employee.id,{resource:'groups',operation:'list',input:{},expectedSubjectHash:f.controller.state.value.subjectHash,idempotencyKey:'group-observation'},f.context);assert.deepEqual(f.repo.getA2AAction(listed.action.id).payload.dshOperation.groupMembers.map(member=>member.profile).sort(),['alpha','beta']);f.complete(listed.action.id,{items:[group]},'observed',{groups:{status:'observed',data:{items:[group]}}});await f.controller.load();
  await f.controller.submit('groups','get',{groupId:group.id});assert.equal(f.controller.state.request,null);assert.equal(f.controller.state.error,'',f.controller.state.errorCode);await f.controller.submit('groups','send',{groupId:group.id,content:'Native group fixture'});const original=JSON.parse(JSON.stringify(f.controller.state.request)),source=f.repo.getA2AAction(original.actionId);
  assert.deepEqual(source.payload.dshOperation.groupBinding,original.groupBinding);assert.deepEqual(original.scope,{kind:'group',groupId:group.id});assert.equal(f.controller.state.groupAction.id,source.id);await f.controller.control('cancelGroup',{sourceActionId:source.id});assert.deepEqual(JSON.parse(JSON.stringify(f.controller.state.request)),original);assert.equal(f.controller.state.action.id,source.id);assert.equal(f.controller.state.controlAction.payload.dshOperation.operation,'cancel');assert.equal(f.controller.state.controlAction.payload.dshOperation.groupMembers,undefined);assert.match(f.controller.state.controlNotice,/终态/);assert.equal(f.calls.filter(row=>row[0]==='native-submit'&&row[2].operation==='send').length,1);
  const posts=f.calls.filter(row=>row[0]==='native-submit');assert.equal(posts.at(-1)[2].expectedSubjectHash,original.subjectHash);await f.controller.control('cancelGroup',{sourceActionId:'foreign-group-send'});assert.equal(f.calls.filter(row=>row[0]==='native-submit').length,posts.length);
});
