import {createHash} from 'node:crypto';
import {setTimeout as wait} from 'node:timers/promises';
import {botSecretDirectory,createBotDeviceSecretStore} from './bot-device-secret-store.mjs';
import {canonicalSecretBinding,validateSecretPublicKey} from './bot-secret-crypto.mjs';
import {DSH_NATIVE_TYPE,normalizeDshNativeInput} from './dsh-native-contract.mjs';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const hash=value=>createHash('sha256').update(canonicalSecretBinding(value)).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const secretOperations=['credentials.set','settings.mutateSecure','providers.discoverModelsSecure'];

export async function claimDshNativeSecret(action,{apiBase,workspace,deviceId,deviceToken,signal,fetchImpl=fetch,store}={}){
 const op=validateAction(action,{apiBase,workspace,deviceId,deviceToken}),deadline=Date.now()+300000;
 if(signal?.aborted)fail('DSH_SECRET_CANCELLED');
 const config={apiBase,workspace,deviceId},identityStore=store||createBotDeviceSecretStore({directory:botSecretDirectory(config)}),identity=identityStore.deviceIdentity();
 let publicKey;try{publicKey=validateSecretPublicKey(identity.publicKey).export({type:'spki',format:'pem'});}catch{fail('DSH_SECRET_DEVICE_KEY_INVALID');}
 const keyId=createHash('sha256').update(publicKey).digest('hex');
 const request=async(path,body)=>{
  if(signal?.aborted)fail('DSH_SECRET_CANCELLED');
  const remaining=deadline-Date.now();if(remaining<=0)fail('DSH_SECRET_WAIT_TIMEOUT');
  try{
   const response=await fetchImpl(`${apiBase.replace(/\/$/,'')}${path}`,{method:'POST',redirect:'error',headers:{'content-type':'application/json','x-ziwei-device-token':deviceToken},body:JSON.stringify(body),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(Math.min(8000,remaining))]):AbortSignal.timeout(Math.min(8000,remaining))});
   if(!response.ok)fail('DSH_SECRET_CLAIM_FAILED');
   return await response.json();
  }catch{if(signal?.aborted)fail('DSH_SECRET_CANCELLED');fail('DSH_SECRET_CLAIM_FAILED');}
 };
 const registered=await request(`/api/workspaces/${encodeURIComponent(workspace)}/bot-provider-credentials/device/register`,{publicKey});
 if(registered?.keyId!==keyId)fail('DSH_SECRET_DEVICE_KEY_INVALID');
 const requestId=op.input.secretRequestId,path=`/a2a/v1/actions/${encodeURIComponent(action.id)}/dsh-native/secrets/${encodeURIComponent(requestId)}/claim`;
 while(Date.now()<deadline){
  const claim=await request(path,{workspace});
  if(claim?.requestId!==requestId)fail('DSH_SECRET_BINDING_INVALID');
  if(claim.state==='waiting'){
   if(signal?.aborted)fail('DSH_SECRET_CANCELLED');
   try{await wait(Math.min(400,Math.max(0,deadline-Date.now())),undefined,{signal});}catch{fail('DSH_SECRET_CANCELLED');}
   continue;
  }
  if(claim.state!=='claimed'||!claim.envelope)fail('DSH_SECRET_CLAIM_FAILED');
  validateBinding(claim.binding,action,op,{workspace,deviceId,keyId});
  let plaintext;
  try{plaintext=identityStore.openBoundSecret(claim.binding,claim.envelope);}catch{fail('DSH_SECRET_DECRYPT_FAILED');}
  try{return secretPayload(JSON.parse(plaintext),op);}catch{fail('DSH_SECRET_PAYLOAD_INVALID');}finally{plaintext=null;}
 }
 fail('DSH_SECRET_WAIT_TIMEOUT');
}

function validateAction(action,{apiBase,workspace,deviceId,deviceToken}){
 const payload=action?.payload,op=payload?.dshOperation,subject=op?.subject;
 if(action?.type!==DSH_NATIVE_TYPE||!action.id||!object(op?.input)||!subject||op.scope?.kind!=='bot'||!secretOperations.includes(`${op.resource}.${op.operation}`)||typeof op.input.secretRequestId!=='string'||!op.input.secretRequestId||subject.runtime!=='DSH'||subject.workspace!==workspace||payload.workspace!==workspace||subject.workspaceId!==payload.workspaceId||subject.deviceId!==deviceId||payload.deviceId!==deviceId||typeof subject.profile!=='string'||!subject.profile||!deviceToken)fail('DSH_SECRET_BINDING_INVALID');
 let endpoint;try{endpoint=new URL(apiBase);}catch{fail('DSH_SECRET_BINDING_INVALID');}
 if(endpoint.username||endpoint.password||endpoint.protocol!=='https:'&&!(endpoint.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname)))fail('DSH_SECRET_TLS_REQUIRED');
 return op;
}
function validateBinding(binding,action,op,{workspace,deviceId,keyId}){
 if(!object(binding)||typeof binding.deviceCredentialId!=='string'||!binding.deviceCredentialId||!Number.isFinite(Date.parse(binding.expiresAt))||Date.parse(binding.expiresAt)<=Date.now())fail('DSH_SECRET_BINDING_INVALID');
 const {secretRequestId,...input}=op.input,subject=op.subject;
 const expected={schemaVersion:1,purpose:'dsh-native-secret',workspace,workspaceId:subject.workspaceId,employeeId:subject.employeeId,ownerUserId:subject.ownerUserId,deviceId,profile:subject.profile,subjectHash:hash({subject,scope:op.scope}),resource:op.resource,operation:op.operation,input,actionId:action.id,requestId:secretRequestId,keyId,deviceCredentialId:binding.deviceCredentialId,expiresAt:binding.expiresAt};
 if(canonicalSecretBinding(expected)!==canonicalSecretBinding(binding))fail('DSH_SECRET_BINDING_INVALID');
}
function secretPayload(value,op){
 const field=op.resource==='credentials'?'value':op.resource==='settings'?'ops':'apiKey';
 if(!object(value)||Object.keys(value).length!==1||!Object.hasOwn(value,field))fail('DSH_SECRET_PAYLOAD_INVALID');
 if(field==='ops')return{ops:normalizeDshNativeInput('settings','mutate',{ns:op.input.ns,expectedRevision:op.input.expectedRevision,ops:value.ops}).ops};
 if(typeof value[field]!=='string'||!value[field])fail('DSH_SECRET_PAYLOAD_INVALID');
 return value;
}
