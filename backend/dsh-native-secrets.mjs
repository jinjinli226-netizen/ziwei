import {createHash,randomUUID} from 'node:crypto';
import {canonicalSecretBinding,validateSecretPublicKey,validateSecretEnvelope} from '../src/bot-secret-crypto.mjs';
import {assertDshNativeSubject,dshNativeSubjectHash,projectDshNativeAction} from './dsh-native-operations.mjs';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const same=(left,right)=>canonicalSecretBinding(left)===canonicalSecretBinding(right);
const hash=value=>createHash('sha256').update(canonicalSecretBinding(value)).digest('hex');
const fail=(code,status=409)=>{throw Object.assign(new Error(code),{code,status});};
const terminal=new Set(['succeeded','failed','expired','cancelled']);
const ttlMs=5*60*1000,maxRequests=500;

export function createDshNativeSecrets(repo,{management,nativeService,now=Date.now}={}){
 const db=repo.db,requests=new Map(),requestKeys=new Map();
 db.exec('CREATE TABLE IF NOT EXISTS bot_secret_devices(workspace_id TEXT NOT NULL,device_id TEXT NOT NULL,key_id TEXT NOT NULL,public_key TEXT NOT NULL,PRIMARY KEY(workspace_id,device_id))');
 function forget(row){row.envelope=null;requests.delete(row.requestId);if(requestKeys.get(row.requestKey)===row.requestId)requestKeys.delete(row.requestKey);}
 function prune(){
  for(const row of requests.values()){
   const action=db.prepare('SELECT status,expires_at FROM a2a_actions WHERE id=?').get(row.binding.actionId);
   if(now()>=Date.parse(row.binding.expiresAt)||!action||terminal.has(action.status)||Date.parse(action.expires_at)<=now())forget(row);
  }
 }
 function owner(slug,id,context){
  const employee=management.employee(slug,id,context);
  if(!context?.actorUserId||employee.owner_user_id!==context.actorUserId)fail('DSH_SECRET_OWNER_REQUIRED',403);
  return employee;
 }
 function deviceKey(subject){
  const credential=db.prepare('SELECT id,revoked_at FROM device_credentials WHERE workspace_id=? AND device_id=?').get(subject.workspaceId,subject.deviceId);
  if(!credential||credential.revoked_at)fail('DSH_SECRET_DEVICE_REVOKED',403);
  const key=db.prepare('SELECT key_id,public_key FROM bot_secret_devices WHERE workspace_id=? AND device_id=?').get(subject.workspaceId,subject.deviceId);
  if(!key)fail('DSH_SECRET_DEVICE_KEY_REQUIRED');
  let publicKey;try{publicKey=validateSecretPublicKey(key.public_key).export({type:'spki',format:'pem'});}catch{fail('DSH_SECRET_DEVICE_KEY_INVALID');}
  if(createHash('sha256').update(publicKey).digest('hex')!==key.key_id)fail('DSH_SECRET_DEVICE_KEY_INVALID');
  return{keyId:key.key_id,publicKey,credentialId:credential.id};
 }
 function live(row){
  if(now()>=Date.parse(row.binding.expiresAt)){forget(row);fail('DSH_SECRET_EXPIRED');}
  const raw=db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(row.binding.actionId);
  if(!raw||terminal.has(raw.status)||Date.parse(raw.expires_at)<=now()){forget(row);fail('DSH_SECRET_ACTION_TERMINAL');}
  const payload=JSON.parse(raw.payload_json),op=payload.dshOperation;
  let current,key;
  try{
   current=assertDshNativeSubject(db,row.binding.workspaceId,payload);key=deviceKey(current);
   if(current.ownerUserId!==row.binding.ownerUserId||dshNativeSubjectHash(current,op.scope)!==row.binding.subjectHash)fail('DSH_SECRET_SUBJECT_CHANGED');
   if(key.keyId!==row.binding.keyId||key.credentialId!==row.binding.deviceCredentialId)fail('DSH_SECRET_DEVICE_KEY_CHANGED');
   if(op.resource!==row.binding.resource||op.operation!==row.binding.operation||!same(op.input,{...row.binding.input,secretRequestId:row.requestId}))fail('DSH_SECRET_ACTION_CHANGED');
  }catch(error){forget(row);throw error;}
  return raw;
 }
 function find(requestId,slug,id){
  const row=requests.get(requestId);
  if(!row||slug!==undefined&&row.binding.workspace!==slug||id!==undefined&&row.binding.employeeId!==id)fail('DSH_SECRET_REQUEST_NOT_FOUND',404);
  return row;
 }
 function view(row){return{requestId:row.requestId,state:row.state,binding:structuredClone(row.binding),devicePublicKey:row.publicKey,action:projectDshNativeAction(repo.getA2AAction(row.binding.actionId))};}
 function prepare(slug,id,input,context={}){
  const metadata=prepareInput(input);owner(slug,id,context);
  const current=nativeService.state(slug,id,{},context);
  if(input.expectedSubjectHash!==current.subjectHash)fail('DSH_NATIVE_SUBJECT_CHANGED');
  const key=deviceKey(current.subject),requestKey=hash([current.subject.workspaceId,id,input.resource,input.operation,input.idempotencyKey]);
  prune();
  const existing=requests.get(requestKeys.get(requestKey));
  if(existing){
   if(!same(existing.binding.input,metadata))fail('IDEMPOTENCY_CONFLICT');
   if(existing.binding.subjectHash!==current.subjectHash)fail('DSH_NATIVE_SUBJECT_CHANGED');
   live(existing);return view(existing);
  }
  if(requests.size>=maxRequests)fail('DSH_SECRET_CAPACITY',429);
  const requestId=randomUUID(),queued=nativeService.action(slug,id,{resource:input.resource,operation:input.operation,input:{...metadata,secretRequestId:requestId},expectedSubjectHash:current.subjectHash,idempotencyKey:`secret:${hash(input.idempotencyKey)}`},context);
  if(!queued.action?.id)fail('DSH_SECRET_DEVICE_UNAVAILABLE');
  const action=repo.getA2AAction(queued.action.id),op=action.payload.dshOperation;
  if(op.input.secretRequestId!==requestId)fail('DSH_SECRET_REQUEST_LOST');
  assertDshNativeSubject(db,current.subject.workspaceId,action.payload);
  const binding={schemaVersion:1,purpose:'dsh-native-secret',workspace:slug,workspaceId:current.subject.workspaceId,employeeId:id,ownerUserId:context.actorUserId,deviceId:current.subject.deviceId,profile:current.subject.profile,subjectHash:current.subjectHash,resource:input.resource,operation:input.operation,input:metadata,actionId:action.id,requestId,keyId:key.keyId,deviceCredentialId:key.credentialId,expiresAt:new Date(now()+ttlMs).toISOString()};
  const row={requestId,requestKey,binding,publicKey:key.publicKey,state:'waiting',envelope:null};requests.set(requestId,row);requestKeys.set(requestKey,requestId);return view(row);
 }
 function answer(slug,id,requestId,input,context={}){
  if(!object(input)||Object.keys(input).length!==1||!Object.hasOwn(input,'envelope'))fail('DSH_SECRET_INPUT_INVALID',400);
  owner(slug,id,context);const row=find(requestId,slug,id);
  if(row.binding.ownerUserId!==context.actorUserId)fail('DSH_SECRET_OWNER_REQUIRED',403);
  live(row);let envelope;try{envelope=validateSecretEnvelope(input.envelope);}catch{fail('DSH_SECRET_ENVELOPE_INVALID',400);}
  if(row.state==='claimed')fail('DSH_SECRET_ALREADY_CLAIMED');
  if(row.state==='ready'){if(!same(row.envelope,envelope))fail('DSH_SECRET_ALREADY_ANSWERED');return{requestId,state:'ready'};}
  row.envelope=structuredClone(envelope);row.state='ready';return{requestId,state:'ready'};
 }
 function claim(actionId,requestId,deviceCredential){
  const row=find(requestId),binding=row.binding;
  if(actionId!==binding.actionId||deviceCredential?.workspaceId!==binding.workspaceId||deviceCredential?.deviceId!==binding.deviceId||deviceCredential?.credentialId!==binding.deviceCredentialId)fail('DSH_SECRET_DEVICE_MISMATCH',403);
  const action=repo.deviceAction(actionId,{deviceId:deviceCredential.deviceId}),raw=live(row);
  if(action.status!=='acked'||raw.status!=='acked')fail('DSH_SECRET_ACTION_NOT_ACKED');
  if(row.state==='claimed')fail('DSH_SECRET_ALREADY_CLAIMED');
  if(row.state==='waiting')return{requestId,state:'waiting'};
  const envelope=row.envelope;row.envelope=null;row.state='claimed';return{requestId,state:'claimed',binding:structuredClone(binding),envelope};
 }
 function clearAction(actionId){let cleared=0;for(const row of requests.values())if(row.binding.actionId===actionId){forget(row);cleared++;}return cleared;}
 return{prepare,answer,claim,clearAction,close(){for(const row of requests.values())forget(row);}};
}

function prepareInput(value){
 if(!object(value)||Object.keys(value).some(key=>!['resource','operation','input','expectedSubjectHash','idempotencyKey'].includes(key))||typeof value.expectedSubjectHash!=='string'||!/^[a-f0-9]{64}$/.test(value.expectedSubjectHash)||typeof value.idempotencyKey!=='string'||!/^[-A-Za-z0-9_.:]{1,128}$/.test(value.idempotencyKey)||!object(value.input))fail('DSH_SECRET_INPUT_INVALID',400);
 const kinds={'credentials.set':{allowed:['ref'],required:['ref']},'settings.mutateSecure':{allowed:['ns','expectedRevision'],required:['ns','expectedRevision']},'providers.discoverModelsSecure':{allowed:['provider','api','baseURL'],required:[]}},kind=kinds[`${value.resource}.${value.operation}`];
 if(!kind||Object.keys(value.input).some(key=>!kind.allowed.includes(key))||kind.required.some(key=>!Object.hasOwn(value.input,key)))fail('DSH_SECRET_INPUT_INVALID',400);
 for(const [key,item] of Object.entries(value.input)){
  if(key==='expectedRevision'){if(!Number.isSafeInteger(item)||item<0)fail('DSH_SECRET_INPUT_INVALID',400);}
  else if(typeof item!=='string'||!item||item.length>(key==='baseURL'?2000:240)||/[\u0000-\u001f\u007f]/.test(item))fail('DSH_SECRET_INPUT_INVALID',400);
 }
 return structuredClone(value.input);
}
