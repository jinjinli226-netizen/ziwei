import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {sealSecret,openSecret,canonicalSecretBinding} from '../src/bot-secret-crypto.mjs';
import {claimDshNativeSecret} from '../src/dsh-native-secret-client.mjs';
import {DSH_NATIVE_TYPE} from '../src/dsh-native-contract.mjs';

const keys=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}}),keyId=createHash('sha256').update(keys.publicKey).digest('hex');
const config={apiBase:'https://workspace.fixture',workspace:'test',deviceId:'pc',deviceToken:'synthetic-device-token'};
const subject={workspace:'test',workspaceId:'ws',employeeId:'employee',ownerUserId:'owner',deviceId:'pc',runtime:'DSH',profile:'alpha',configFingerprint:'fixture'},scope={kind:'bot'};
const actionFor=(resource='credentials',operation='set',input={ref:'NATIVE_API_KEY'})=>({id:'native-action',type:DSH_NATIVE_TYPE,payload:{workspace:'test',workspaceId:'ws',deviceId:'pc',dshOperation:{schemaVersion:1,subject,scope,resource,operation,input:{...input,secretRequestId:'secret-request'}}}});
function fixture({action=actionFor(),plaintext={value:'synthetic-private-value'},bindingPatch={},waiting=false}={}){
 const calls=[],op=action.payload.dshOperation,{secretRequestId,...metadata}=op.input;
 const binding={schemaVersion:1,purpose:'dsh-native-secret',workspace:config.workspace,workspaceId:subject.workspaceId,employeeId:subject.employeeId,ownerUserId:subject.ownerUserId,deviceId:subject.deviceId,profile:subject.profile,subjectHash:createHash('sha256').update(canonicalSecretBinding({subject:op.subject,scope:op.scope})).digest('hex'),resource:op.resource,operation:op.operation,input:metadata,actionId:action.id,requestId:secretRequestId,keyId,deviceCredentialId:'device-credential',expiresAt:new Date(Date.now()+120000).toISOString(),...bindingPatch};
 const envelope=sealSecret(keys.publicKey,binding,typeof plaintext==='string'?plaintext:JSON.stringify(plaintext));let wait=waiting,opens=0;
 const options={...config,store:{deviceIdentity:()=>({publicKey:keys.publicKey}),openBoundSecret:(actualBinding,actualEnvelope)=>{opens++;return openSecret(keys.privateKey,actualBinding,actualEnvelope);},applyDelivery:()=>assert.fail('transient plaintext must not be stored')},fetchImpl:async(url,options)=>{
  calls.push({url,options});
  if(url.endsWith('/device/register'))return Response.json({keyId});
  if(wait){wait=false;return Response.json({requestId:secretRequestId,state:'waiting'});}
  return Response.json({requestId:secretRequestId,state:'claimed',binding,envelope});
 }};
 return{action,options,calls,binding,envelope,get opens(){return opens;}};
}

test('client registers only its public key and decrypts one original bound claim without persisting plaintext',async()=>{
 const f=fixture(),value=await claimDshNativeSecret(f.action,f.options);assert.deepEqual(value,{value:'synthetic-private-value'});assert.equal(f.opens,1);
 assert.equal(f.calls.length,2);assert.equal(f.calls[0].url,'https://workspace.fixture/api/workspaces/test/bot-provider-credentials/device/register');
 assert.deepEqual(JSON.parse(f.calls[0].options.body),{publicKey:keys.publicKey});assert.equal(f.calls[1].url,'https://workspace.fixture/a2a/v1/actions/native-action/dsh-native/secrets/secret-request/claim');
 assert.deepEqual(JSON.parse(f.calls[1].options.body),{workspace:'test'});assert.equal(f.calls[1].options.headers['x-ziwei-device-token'],config.deviceToken);assert.equal(f.calls[1].options.redirect,'error');
 assert.doesNotMatch(JSON.stringify(f.calls),/synthetic-private-value|BEGIN PRIVATE KEY/);
});

test('client validates secure settings and discovery plaintext types after real decryption',async()=>{
 for(const [action,plaintext] of [
  [actionFor('settings','mutateSecure',{ns:'native',expectedRevision:2}),{ops:[{op:'set',path:['privateSetting'],value:'synthetic-private-value'}]}],
  [actionFor('providers','discoverModelsSecure',{api:'openai-completions',baseURL:'https://provider.fixture'}),{apiKey:'synthetic-private-value'}],
 ]){
  const f=fixture({action,plaintext});assert.deepEqual(await claimDshNativeSecret(action,f.options),plaintext);
 }
});

test('waiting claims poll the same action only and stop when an explicit envelope is ready',async()=>{
 const f=fixture({waiting:true}),value=await claimDshNativeSecret(f.action,f.options);assert.equal(value.value,'synthetic-private-value');
 assert.equal(f.calls.length,3);assert.equal(f.calls[1].url,f.calls[2].url);assert.equal(f.opens,1);
});

test('client rejects changed subject owner profile action metadata key and expiry before opening the envelope',async()=>{
 for(const bindingPatch of [{subjectHash:'changed'},{ownerUserId:'other'},{profile:'beta'},{actionId:'other-action'},{requestId:'other-request'},{resource:'settings'},{input:{ref:'OTHER_KEY'}},{keyId:'other-key'},{expiresAt:new Date(Date.now()-1).toISOString()}]){
  const f=fixture({bindingPatch});await assert.rejects(claimDshNativeSecret(f.action,f.options),{code:'DSH_SECRET_BINDING_INVALID'});assert.equal(f.opens,0);
 }
});

test('AAD tampering and malformed plaintext fail with codes that never echo secrets',async()=>{
 const tampered=fixture(),cipher=sealSecret(keys.publicKey,{...tampered.binding,profile:'beta'},JSON.stringify({value:'synthetic-private-value'}));
 tampered.options.fetchImpl=async url=>Response.json(url.endsWith('/device/register')?{keyId}:{state:'claimed',requestId:'secret-request',binding:tampered.binding,envelope:cipher});
 await assert.rejects(claimDshNativeSecret(tampered.action,tampered.options),{code:'DSH_SECRET_DECRYPT_FAILED'});
 for(const plaintext of ['not JSON synthetic-private-value',{value:12},{value:'synthetic-private-value',apiKey:'extra'}]){
  const f=fixture({plaintext});await assert.rejects(claimDshNativeSecret(f.action,f.options),error=>error.code==='DSH_SECRET_PAYLOAD_INVALID'&&!error.message.includes('synthetic-private-value'));
 }
});

test('claim transport loss is not retried and native echoed error text is not exposed',async()=>{
 const f=fixture();let claims=0;
 f.options.fetchImpl=async url=>{if(url.endsWith('/device/register'))return Response.json({keyId});claims++;throw Error('synthetic-private-value');};
 await assert.rejects(claimDshNativeSecret(f.action,f.options),error=>error.code==='DSH_SECRET_CLAIM_FAILED'&&!error.message.includes('synthetic-private-value'));assert.equal(claims,1);
});

test('wrong local identity and unsupported actions are refused before transport or local secret access',async()=>{
 const f=fixture();let identities=0;
 const options={...f.options,store:{deviceIdentity:()=>{identities++;throw Error('should not load key');}}};
 await assert.rejects(claimDshNativeSecret(f.action,{...options,deviceId:'other'}),{code:'DSH_SECRET_BINDING_INVALID'});
 await assert.rejects(claimDshNativeSecret(actionFor('plugins','installBundle',{}),options),{code:'DSH_SECRET_BINDING_INVALID'});assert.equal(f.calls.length,0);assert.equal(identities,0);
});

test('waiting is cancellable without another claim or exposing cancellation text',async()=>{
 const f=fixture(),controller=new AbortController();let claims=0;
 f.options.fetchImpl=async url=>{if(url.endsWith('/device/register'))return Response.json({keyId});claims++;controller.abort(Error('synthetic-private-value'));return Response.json({state:'waiting',requestId:'secret-request'});};
 await assert.rejects(claimDshNativeSecret(f.action,{...f.options,signal:controller.signal}),error=>error.code==='DSH_SECRET_CANCELLED'&&!error.message.includes('synthetic-private-value'));assert.equal(claims,1);
});
