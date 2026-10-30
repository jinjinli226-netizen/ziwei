import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {createRepository} from './repository.mjs';
import {createManagementService} from './management.mjs';
import {createDshNativeService} from './dsh-native-operations.mjs';
import {createBotProviderCredentialService} from './bot-provider-credentials.mjs';
import {createDshNativeSecrets} from './dsh-native-secrets.mjs';
import {sealSecret,openSecret} from '../src/bot-secret-crypto.mjs';
import {DSH_NATIVE_FEATURE} from '../src/dsh-native-contract.mjs';
import {claimDshNativeSecret} from '../src/dsh-native-secret-client.mjs';

const SLUG='test-111',keys=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
function fixture(t){
 const repo=createRepository({memory:true}),db=repo.db,workspace=repo.getWorkspace(SLUG),context={actorUserId:'secret-owner',actorRole:'owner'};let at=Date.now();
 db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run('secret-owner-member',workspace.id,context.actorUserId,'Owner','owner@fixture.invalid','owner',new Date(at).toISOString());
 const pairing=repo.claimDevicePairing({code:repo.createDevicePairing(SLUG,{createdBy:context.actorUserId,name:'Secret fixture'}).code}),credential=repo.authenticateDeviceToken(pairing.deviceToken);
 repo.heartbeatDevice(SLUG,{deviceId:pairing.deviceId,runtimeDiscovery:{features:[DSH_NATIVE_FEATURE]},runtimes:{DSH:{status:'available',profiles:[{name:'alpha'},{name:'beta'}]}}});
 const employee=repo.createEmployee(SLUG,{name:'Secure native employee',runtime:'DSH',runtimeProfile:'alpha',targetDeviceId:pairing.deviceId,ownerUserId:context.actorUserId}),management=createManagementService(repo),nativeService=createDshNativeService(repo,{management,now:()=>at});
 createBotProviderCredentialService(repo,{bots:management.bots}).register(SLUG,credential,{publicKey:keys.publicKey});
 const service=createDshNativeSecrets(repo,{management,nativeService,now:()=>at}),body=(patch={})=>({resource:'credentials',operation:'set',input:{ref:'NATIVE_API_KEY'},expectedSubjectHash:nativeService.state(SLUG,employee.id,{},context).subjectHash,idempotencyKey:'secure-write',...patch});
 const prepare=(patch={})=>service.prepare(SLUG,employee.id,body(patch),context),answer=(prepared,plaintext={value:'synthetic-native-secret'})=>service.answer(SLUG,employee.id,prepared.requestId,{envelope:sealSecret(prepared.devicePublicKey,prepared.binding,JSON.stringify(plaintext))},context),ack=prepared=>repo.ackA2AAction(prepared.action.id,{deviceId:credential.deviceId});
 t.after(()=>{service.close();db.close();});return{repo,db,workspace,employee,context,credential,deviceToken:pairing.deviceToken,service,nativeService,body,prepare,answer,ack,advance:ms=>{at+=ms;}};
}

test('DSH secrets stay encrypted outside the one authorized claim and never enter action or public responses',t=>{
 const f=fixture(t),prepared=f.prepare();assert.equal(prepared.state,'waiting');assert.equal(prepared.binding.actionId,prepared.action.id);assert.equal(prepared.binding.subjectHash,f.body().expectedSubjectHash);
 assert.equal(f.repo.getA2AAction(prepared.action.id).payload.dshOperation.input.secretRequestId,prepared.requestId);
 assert.deepEqual(f.prepare(),prepared);f.ack(prepared);
 assert.equal(f.service.claim(prepared.action.id,prepared.requestId,f.credential).state,'waiting');
 const answered=f.answer(prepared);assert.equal(answered.state,'ready');assert.equal(answered.envelope,undefined);
 const claimed=f.service.claim(prepared.action.id,prepared.requestId,f.credential);assert.equal(claimed.state,'claimed');
 assert.deepEqual(JSON.parse(openSecret(keys.privateKey,claimed.binding,claimed.envelope)),{value:'synthetic-native-secret'});
 const stored=f.db.prepare('SELECT payload_json,result_json FROM a2a_actions WHERE id=?').get(prepared.action.id),events=f.db.prepare('SELECT data_json FROM a2a_action_events WHERE action_id=?').all(prepared.action.id);
 assert.doesNotMatch(JSON.stringify({prepared,answered,stored,events}),/synthetic-native-secret|ciphertext|wrappedKey/);
 assert.throws(()=>f.service.claim(prepared.action.id,prepared.requestId,f.credential),{code:'DSH_SECRET_ALREADY_CLAIMED'});
});

test('AAD authenticates the exact owner Bot action metadata key and expiry',t=>{
 const f=fixture(t),prepared=f.prepare();f.ack(prepared);f.answer(prepared);const claimed=f.service.claim(prepared.action.id,prepared.requestId,f.credential);
 for(const patch of [{ownerUserId:'other'},{profile:'beta'},{actionId:'other-action'},{requestId:'other-request'},{subjectHash:'changed'},{keyId:'other-key'},{expiresAt:'2099-01-01T00:00:00.000Z'},{input:{ref:'OTHER_KEY'}}])assert.throws(()=>openSecret(keys.privateKey,{...claimed.binding,...patch},claimed.envelope),/BOT_SECRET_DECRYPT_FAILED/);
});

test('only the current employee owner can prepare or answer, even if another actor is a workspace administrator',t=>{
 const f=fixture(t),other={actorUserId:'other-admin',actorRole:'admin'};
 f.db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run('other-admin-member',f.workspace.id,other.actorUserId,'Admin','admin@fixture.invalid','admin',new Date().toISOString());
 assert.throws(()=>f.service.prepare(SLUG,f.employee.id,f.body(),other),{code:'DSH_SECRET_OWNER_REQUIRED'});
 const prepared=f.prepare(),envelope=sealSecret(prepared.devicePublicKey,prepared.binding,'{}');
 assert.throws(()=>f.service.answer(SLUG,f.employee.id,prepared.requestId,{envelope},other),{code:'DSH_SECRET_OWNER_REQUIRED'});
 assert.throws(()=>f.service.answer(SLUG,'other-employee',prepared.requestId,{envelope},f.context));
});

test('claims require the original authenticated ACKed action and device credential',t=>{
 const f=fixture(t),prepared=f.prepare();f.answer(prepared);
 assert.throws(()=>f.service.claim(prepared.action.id,prepared.requestId,f.credential),{code:'DSH_SECRET_ACTION_NOT_ACKED'});
 f.ack(prepared);
 for(const credential of [{...f.credential,deviceId:'foreign'},{...f.credential,workspaceId:'foreign'},{...f.credential,credentialId:'foreign'}])assert.throws(()=>f.service.claim(prepared.action.id,prepared.requestId,credential));
 assert.throws(()=>f.service.claim('foreign-action',prepared.requestId,f.credential));
 assert.equal(f.service.claim(prepared.action.id,prepared.requestId,f.credential).state,'claimed');
});

test('subject changes, device revocation, changed keys and expiry invalidate encrypted deliveries',t=>{
 for(const mutation of ['subject','owner','credential','key','expiry']){
  const f=fixture(t),prepared=f.prepare();f.ack(prepared);f.answer(prepared);
  if(mutation==='subject')f.db.prepare("UPDATE employees SET runtime_profile='beta' WHERE id=?").run(f.employee.id);
  if(mutation==='owner')f.db.prepare('UPDATE employees SET owner_user_id=? WHERE id=?').run('new-owner',f.employee.id);
  if(mutation==='credential')f.repo.revokeDeviceCredential(f.credential.deviceId);
  if(mutation==='key')f.db.prepare('UPDATE bot_secret_devices SET key_id=? WHERE workspace_id=? AND device_id=?').run('changed-key',f.workspace.id,f.credential.deviceId);
  if(mutation==='expiry')f.advance(300001);
  assert.throws(()=>f.service.claim(prepared.action.id,prepared.requestId,f.credential));
 }
});

test('server accepts only encrypted envelopes and approved non-secret operation metadata',t=>{
 const f=fixture(t),before=f.db.prepare('SELECT count(*) n FROM a2a_actions').get().n;
 for(const patch of [{input:{ref:'NATIVE_API_KEY',value:'plain'}},{resource:'settings',operation:'mutateSecure',input:{ns:'namespace',expectedRevision:1,ops:[{op:'set',path:['token'],value:'plain'}]}},{resource:'providers',operation:'discoverModelsSecure',input:{api:'openai-completions',baseURL:'https://provider.fixture',apiKey:'plain'}},{resource:'plugins',operation:'set',input:{}}])assert.throws(()=>f.prepare(patch),{code:'DSH_SECRET_INPUT_INVALID'});
 assert.equal(f.db.prepare('SELECT count(*) n FROM a2a_actions').get().n,before);
 const prepared=f.prepare();assert.throws(()=>f.service.answer(SLUG,f.employee.id,prepared.requestId,{value:'plain'},f.context),{code:'DSH_SECRET_INPUT_INVALID'});
 assert.throws(()=>f.service.answer(SLUG,f.employee.id,prepared.requestId,{envelope:{ciphertext:'plain'}},f.context),{code:'DSH_SECRET_ENVELOPE_INVALID'});
});

test('secure settings and discovery queue only metadata and an opaque secret request reference',t=>{
 for(const input of [
  {resource:'settings',operation:'mutateSecure',input:{ns:'native-namespace',expectedRevision:3},plaintext:{ops:[{op:'set',path:['privateSetting'],value:'synthetic-native-secret'}]}},
  {resource:'providers',operation:'discoverModelsSecure',input:{provider:'custom',api:'openai-completions',baseURL:'https://provider.fixture/v1'},plaintext:{apiKey:'synthetic-native-secret'}},
 ]){
  const f=fixture(t),{plaintext,...metadata}=input,prepared=f.prepare(metadata);f.ack(prepared);f.answer(prepared,plaintext);
  const action=f.repo.getA2AAction(prepared.action.id);assert.deepEqual(action.payload.dshOperation.input,{...metadata.input,secretRequestId:prepared.requestId});
  assert.doesNotMatch(JSON.stringify(action),/synthetic-native-secret|ciphertext|wrappedKey/);
  const claimed=f.service.claim(prepared.action.id,prepared.requestId,f.credential);assert.deepEqual(JSON.parse(openSecret(keys.privateKey,claimed.binding,claimed.envelope)),plaintext);
 }
});

test('an accepted envelope can be retried unchanged but cannot be replaced after acceptance',t=>{
 const f=fixture(t),prepared=f.prepare(),envelope=sealSecret(prepared.devicePublicKey,prepared.binding,'{}');
 assert.deepEqual(f.service.answer(SLUG,f.employee.id,prepared.requestId,{envelope},f.context),{requestId:prepared.requestId,state:'ready'});
 assert.deepEqual(f.service.answer(SLUG,f.employee.id,prepared.requestId,{envelope},f.context),{requestId:prepared.requestId,state:'ready'});
 assert.throws(()=>f.service.answer(SLUG,f.employee.id,prepared.requestId,{envelope:sealSecret(prepared.devicePublicKey,prepared.binding,'{}')},f.context),{code:'DSH_SECRET_ALREADY_ANSWERED'});
});

test('terminal actions clear ciphertext and a restarted relay cannot replay old secret requests',t=>{
 const f=fixture(t),prepared=f.prepare();f.ack(prepared);f.answer(prepared);
 f.repo.resultA2AAction(prepared.action.id,{deviceId:f.credential.deviceId,status:'failed',error:'isolated failure',result:{code:'fixture'}});
 assert.equal(f.service.clearAction(prepared.action.id),1);assert.throws(()=>f.service.claim(prepared.action.id,prepared.requestId,f.credential),{code:'DSH_SECRET_REQUEST_NOT_FOUND'});
 const restarted=createDshNativeSecrets(f.repo,{management:createManagementService(f.repo),nativeService:f.nativeService});t.after(()=>restarted.close());
 assert.throws(()=>restarted.answer(SLUG,f.employee.id,prepared.requestId,{envelope:sealSecret(keys.publicKey,prepared.binding,'{}')},f.context),{code:'DSH_SECRET_REQUEST_NOT_FOUND'});
 const count=f.db.prepare('SELECT count(*) n FROM a2a_actions').get().n;assert.throws(()=>restarted.prepare(SLUG,f.employee.id,f.body(),f.context),{code:'IDEMPOTENCY_CONFLICT'});assert.equal(f.db.prepare('SELECT count(*) n FROM a2a_actions').get().n,count);
});

test('preparing the same request cannot extend the five minute encrypted input window',t=>{
 const f=fixture(t),prepared=f.prepare();f.ack(prepared);f.advance(1000);
 assert.equal(f.prepare().binding.expiresAt,prepared.binding.expiresAt);f.advance(299001);
 assert.throws(()=>f.answer(prepared),{code:'DSH_SECRET_EXPIRED'});
});

test('the relay admits at most 500 outstanding requests without creating an overflow action',t=>{
 const f=fixture(t);
 for(let index=0;index<500;index++)f.prepare({idempotencyKey:`capacity-${index}`});
 const count=f.db.prepare('SELECT count(*) n FROM a2a_actions').get().n;
 assert.throws(()=>f.prepare({idempotencyKey:'overflow'}),{code:'DSH_SECRET_CAPACITY',status:429});
 assert.equal(f.db.prepare('SELECT count(*) n FROM a2a_actions').get().n,count);
});

test('the real relay and device client agree on one encrypted binding and plaintext type for all secure operations',async t=>{
 for(const [metadata,plaintext] of [
  [{resource:'credentials',operation:'set',input:{ref:'NATIVE_API_KEY'}},{value:'synthetic-end-to-end-secret'}],
  [{resource:'settings',operation:'mutateSecure',input:{ns:'native',expectedRevision:2}},{ops:[{op:'set',path:['privateSetting'],value:'synthetic-end-to-end-secret'}]}],
  [{resource:'providers',operation:'discoverModelsSecure',input:{provider:'custom',api:'openai-completions',baseURL:'https://provider.fixture'}},{apiKey:'synthetic-end-to-end-secret'}],
 ]){
  const f=fixture(t),prepared=f.prepare(metadata);f.answer(prepared,plaintext);f.ack(prepared);let claims=0;
  const genericKeys=createBotProviderCredentialService(f.repo,{bots:createManagementService(f.repo).bots});
  const value=await claimDshNativeSecret(f.repo.getA2AAction(prepared.action.id),{apiBase:'https://workspace.fixture',workspace:SLUG,deviceId:f.credential.deviceId,deviceToken:f.deviceToken,store:{deviceIdentity:()=>({publicKey:keys.publicKey}),openBoundSecret:(binding,envelope)=>openSecret(keys.privateKey,binding,envelope)},fetchImpl:async(url,init)=>{
   const credential=f.repo.authenticateDeviceToken(init.headers['x-ziwei-device-token'],{workspaceSlug:SLUG});assert.ok(credential);
   if(url.endsWith('/device/register'))return Response.json(genericKeys.register(SLUG,credential,JSON.parse(init.body)));
   assert.equal(JSON.parse(init.body).workspace,SLUG);claims++;
   return Response.json(f.service.claim(prepared.action.id,prepared.requestId,credential));
  }});
  assert.deepEqual(value,plaintext);assert.equal(claims,1);assert.doesNotMatch(JSON.stringify(f.repo.getA2AAction(prepared.action.id)),/synthetic-end-to-end-secret|ciphertext|wrappedKey/);
 }
});
