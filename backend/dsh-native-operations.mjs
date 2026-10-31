import {createHash,randomUUID} from 'node:crypto';
import {BOT_INTERNAL} from './bots.mjs';
import {employeeCapabilitySubject,assertEmployeeCapabilityAuthority} from './employee-capability-inventory.mjs';
import {DSH_NATIVE_FEATURE,DSH_PLUGIN_UI_RELAY_FEATURE,DSH_NATIVE_TYPE,DSH_NATIVE_OPERATIONS,DSH_NATIVE_REFRESH_RESOURCES,getDshNativeOperation,normalizeDshNativeInput} from '../src/dsh-native-contract.mjs';
import {redactSecrets} from '../src/redaction.mjs';
import {publicDshSettings} from '../src/dsh-native-settings.mjs';
import {normalizeConversationAttachments} from './conversation-attachments.mjs';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
const canonical=value=>JSON.stringify(value,(_key,item)=>object(item)?Object.fromEntries(Object.entries(item).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b))):item);
const same=(left,right)=>canonical(left)===canonical(right);
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const fail=(code,status=409,details)=>{throw Object.assign(new Error(code),{code,status,...(details?{details}:{})});};
const actor=context=>({userId:context.actorUserId||null,role:context.actorRole||'owner',deviceScope:context.deviceScope||null});
const supports=device=>{const features=parse(device?.runtime_discovery_json)?.features;return Array.isArray(features)&&features.includes(DSH_NATIVE_FEATURE);};
const keyValid=value=>typeof value==='string'&&/^[-A-Za-z0-9_.:]{1,128}$/.test(value);
const sensitiveKey=key=>/^(?:api[_-]?key|token|password|passwd|secrets?|credentials?|client[_-]?secret|auth|authorization|cookie|headers|private[_-]?key|access[_-]?token|refresh[_-]?token)$/i.test(key);
const privateFields=new Set(['rawDiagnostic','rawConfig','rawError','argv','cwd','logPath','environment','envelope','ciphertext','wrappedKey','privateKey']);
const resources=[...new Set(DSH_NATIVE_OPERATIONS.filter(entry=>entry.implemented&&entry.resource!=='state').map(entry=>entry.resource))];
const applications=new Set(['observed','applied','restart-required','overridden','failed','unknown','cancelled','partial','unavailable']);
export const dshNativeSubjectHash=(subject,scope={kind:'bot'})=>digest({subject,scope});
const runtimeContext=employee=>({cwd:employee.default_working_directory_device_id===employee.target_device_id?employee.default_working_directory||null:null});

function currentSubject(db,workspaceId,employeeId){
 const subject=employeeCapabilitySubject(db,workspaceId,employeeId);
 if(subject.runtime!=='DSH')fail('DSH_NATIVE_RUNTIME_UNSUPPORTED',400);
 if(typeof subject.profile!=='string'||!/^[a-z0-9][a-z0-9-]{0,23}$/.test(subject.profile))fail('DSH_NATIVE_PROFILE_INVALID',400);
 const metadata=db.prepare("SELECT profiles_json FROM runtime_device_metadata WHERE workspace_id=? AND device_id=? AND runtime_name='DSH'").get(workspaceId,subject.deviceId);
 if(!(parse(metadata?.profiles_json)||[]).some(profile=>profile.name===subject.profile))fail('DSH_NATIVE_PROFILE_NOT_DISCOVERED');
 return subject;
}
function resolveScope(db,workspaceId,subject,conversationId){
 if(conversationId===undefined||conversationId===null)return{kind:'bot'};
 if(typeof conversationId!=='string'||!conversationId||conversationId.length>200)fail('DSH_NATIVE_INPUT_INVALID',400);
 const conversation=db.prepare('SELECT employee_id,device_id FROM conversations WHERE id=? AND workspace_id=?').get(conversationId,workspaceId);
 if(!conversation||conversation.employee_id!==subject.employeeId||conversation.device_id&&conversation.device_id!==subject.deviceId)fail('DSH_NATIVE_CONVERSATION_NOT_FOUND',404);
 const binding=db.prepare('SELECT session_id FROM conversation_dsh_sessions WHERE conversation_id=? AND workspace_id=? AND employee_id=? AND device_id=? AND bot_name=?').get(conversationId,workspaceId,subject.employeeId,subject.deviceId,subject.profile);
 return{kind:'conversation',conversationId,nativeSessionId:binding?.session_id||null};
}
function installOrigin(db,workspaceId,subject,input,requester){
 const row=db.prepare('SELECT * FROM a2a_actions WHERE id=? AND workspace_id=?').get(input.sourceActionId,workspaceId),payload=parse(row?.payload_json),op=payload?.dshOperation;
 if(row?.type!==DSH_NATIVE_TYPE||op?.resource!=='plugins'||!['inspectSource','installBundle'].includes(op.operation)||!same(op.subject,subject))fail('DSH_NATIVE_INSTALL_SOURCE_INVALID');
 if(requester.userId&&payload.userId&&requester.userId!==payload.userId){const member=db.prepare('SELECT role FROM members WHERE workspace_id=? AND user_id=?').get(workspaceId,requester.userId);if(!['owner','admin'].includes(requester.role)||!['owner','admin'].includes(member?.role))fail('DSH_NATIVE_SOURCE_ACTION_FORBIDDEN',403);}
 return{row,op};
}
function installSource(db,workspaceId,subject,input,requester){
 const{row,op}=installOrigin(db,workspaceId,subject,input,requester),result=parse(row.result_json),value=projectReceipt(result?.dshNative||result?.result?.dshNative,op);
 if(input.approvedBuilds?.length){
  if(op.operation!=='installBundle'||!['succeeded','failed'].includes(row.status)||!value||!object(op.installSource))fail('DSH_NATIVE_INSTALL_SOURCE_INVALID');
  if(value.status==='unknown')fail('DSH_NATIVE_INSTALL_OUTCOME_UNKNOWN');
  const packages=value.data?.receipt?.pendingBuilds;
  if(!Array.isArray(packages)||new Set(input.approvedBuilds).size!==input.approvedBuilds.length||input.approvedBuilds.some(name=>!packages.includes(name)))fail('DSH_NATIVE_BUILD_APPROVAL_INVALID',400);
  return op.installSource;
 }
 if(op.operation!=='inspectSource'||row.status!=='succeeded'||value?.status!=='observed'||value.data?.status!=='accepted'||value.data.bundle===false)fail('DSH_NATIVE_INSTALL_SOURCE_INVALID');
 return{spec:op.input.spec,registry:op.input.registry??null};
}
export function assertDshNativeGroupMembers(db,workspaceId,subject,members,requester){
 if(!Array.isArray(members)||!members.length||new Set(members.map(member=>member?.employeeId)).size!==members.length||!members.some(member=>member.employeeId===subject.employeeId&&member.profile===subject.profile))fail('DSH_NATIVE_GROUP_MEMBERS_INVALID',400);
 for(const member of members){
  const current=currentSubject(db,workspaceId,member.employeeId);
  if(current.deviceId!==subject.deviceId||current.profile!==member.profile)fail('DSH_NATIVE_GROUP_MEMBERS_CHANGED');
  assertEmployeeCapabilityAuthority(db,workspaceId,current,requester);
 }
 return members;
}
function assertGroupBinding(subject,binding,members){
 if(!object(binding)||typeof binding.groupId!=='string'||!Array.isArray(binding.members)||binding.members.length<2||binding.members.length>6||new Set(binding.members).size!==binding.members.length||!binding.members.includes(subject.profile)||binding.members.some(profile=>!members.some(member=>member.profile===profile)))fail('DSH_NATIVE_GROUP_MEMBERS_INVALID',400);
}
export function dshNativeGroupTargets(subject,members,binding,input){
 let ids=input.targetEmployeeIds;
 if(ids===undefined){
  const mentions=[...(input.content||'').matchAll(/(?<![A-Za-z0-9._%+-])@([A-Za-z0-9_-]+|[^\x00-\x7F\s,，.。:：;；!?！？()（）]+)/g)].map(match=>match[1].toLowerCase()),targets=!mentions.length||mentions.some(name=>['all','everyone'].includes(name))?binding.members:[...new Set(mentions)];
  if(mentions.some(profile=>!['all','everyone'].includes(profile)&&!binding.members.includes(profile)))fail('DSH_NATIVE_GROUP_TARGET_UNKNOWN',400);
  ids=targets.map(profile=>{const candidates=members.filter(member=>member.profile===profile);if(profile===subject.profile)return subject.employeeId;if(candidates.length!==1)fail('DSH_NATIVE_GROUP_MEMBER_AMBIGUOUS');return candidates[0].employeeId;});
 }
 const profiles=ids.map(id=>members.find(member=>member.employeeId===id)?.profile);
 if(!ids.length||ids.length>6||new Set(ids).size!==ids.length||profiles.some(profile=>!binding.members.includes(profile))||new Set(profiles).size!==profiles.length)fail('DSH_NATIVE_GROUP_MEMBERS_INVALID',400);
 return[...ids];
}
function groupSendSource(db,workspaceId,subject,sourceActionId,requester){
 const row=db.prepare('SELECT * FROM a2a_actions WHERE id=? AND workspace_id=?').get(sourceActionId,workspaceId),payload=parse(row?.payload_json),op=payload?.dshOperation;
 if(row?.type!==DSH_NATIVE_TYPE||op?.resource!=='groups'||op.operation!=='send'||!same(op.subject,subject))fail('DSH_NATIVE_GROUP_SOURCE_INVALID');
 if(requester.userId&&payload.userId&&requester.userId!==payload.userId){const member=db.prepare('SELECT role FROM members WHERE workspace_id=? AND user_id=?').get(workspaceId,requester.userId);if(!['owner','admin'].includes(requester.role)||!['owner','admin'].includes(member?.role))fail('DSH_NATIVE_SOURCE_ACTION_FORBIDDEN',403);}
 assertDshNativeSubject(db,workspaceId,payload);
 return op;
}
function assertCurrentAuthority(db,workspaceId,payload){
 const op=payload?.dshOperation;
 if(!object(op)||op.schemaVersion!==1||!object(op.subject)||!object(op.scope))fail('DSH_NATIVE_SUBJECT_INVALID');
 const entry=getDshNativeOperation(op.resource,op.operation);
 if(!entry?.implemented)fail('DSH_NATIVE_OPERATION_UNSUPPORTED',400);
 const current=currentSubject(db,workspaceId,op.subject.employeeId);
 if(!same(current,op.subject)||payload.workspace!==current.workspace||payload.workspaceId!==workspaceId||payload.deviceId!==current.deviceId||payload.employeeId!==undefined||payload.runtime!==undefined)fail('DSH_NATIVE_SUBJECT_CHANGED');
 if(op.resource==='sessions'&&op.operation==='create'&&!same(op.runtimeContext,runtimeContext(db.prepare('SELECT * FROM employees WHERE id=? AND workspace_id=?').get(current.employeeId,workspaceId))))fail('DSH_NATIVE_RUNTIME_CONTEXT_CHANGED');
 const device=db.prepare('SELECT * FROM devices WHERE id=? AND workspace_id=?').get(current.deviceId,workspaceId),credential=db.prepare('SELECT revoked_at FROM device_credentials WHERE device_id=? AND workspace_id=?').get(current.deviceId,workspaceId);
 if(!device||device.status==='disabled'||credential?.revoked_at)fail('DSH_NATIVE_DEVICE_REVOKED',403);
 if(!supports(device))fail('DSH_NATIVE_CLIENT_NOT_REPORTED');
 if(!object(op.requestedBy)||(op.requestedBy.userId||null)!==(payload.userId||null))fail('DSH_NATIVE_AUTHORITY_CHANGED',403);
 assertEmployeeCapabilityAuthority(db,workspaceId,current,op.requestedBy);
 if(op.resource==='groups'||op.resource==='state'&&op.operation==='refresh'&&op.input.resources.includes('groups')){
  assertDshNativeGroupMembers(db,workspaceId,current,op.groupMembers,op.requestedBy);
  if(op.scope.kind==='group'){assertGroupBinding(current,op.groupBinding,op.groupMembers);if(op.groupBinding.groupId!==op.scope.groupId)fail('DSH_NATIVE_SCOPE_CHANGED');}
  if(op.resource==='groups'&&op.operation==='send'&&!same(op.groupTargets,dshNativeGroupTargets(current,op.groupMembers,op.groupBinding,op.input)))fail('DSH_NATIVE_GROUP_TARGETS_CHANGED');
  if(op.resource==='groups'&&op.operation==='cancel'){const source=groupSendSource(db,workspaceId,current,op.input.sourceActionId,op.requestedBy);if(!same(source.groupMembers,op.groupMembers)||!same(source.groupBinding,op.groupBinding))fail('DSH_NATIVE_GROUP_SOURCE_CHANGED');}
 }
 if(op.resource==='plugins'&&op.operation==='installBundle'&&!same(op.installSource,installSource(db,workspaceId,current,op.input,op.requestedBy)))fail('DSH_NATIVE_INSTALL_SOURCE_CHANGED');
 if(entry.scope==='attempt'){const source=installOrigin(db,workspaceId,current,op.input,op.requestedBy);if(source.op.operation!=='installBundle')fail('DSH_NATIVE_INSTALL_SOURCE_INVALID');}
 return current;
}
function assertOperationScope(db,workspaceId,subject,scope,entry,input){
 if(entry.scope==='attempt'){if(!same(scope,{kind:'attempt',sourceActionId:input?.sourceActionId}))fail('DSH_NATIVE_SCOPE_CHANGED');return;}
 if(entry.scope==='group'){if(scope.kind!=='group'||typeof scope.groupId!=='string'||input.groupId!==undefined&&scope.groupId!==input.groupId)fail('DSH_NATIVE_SCOPE_CHANGED');return;}
 const current=resolveScope(db,workspaceId,subject,scope.kind==='conversation'?scope.conversationId:undefined);
 if(!same(current,scope)||entry.scope!==scope.kind&&entry.scope!=='either')fail('DSH_NATIVE_SCOPE_CHANGED');
 if(scope.kind!=='conversation')return;
 if(entry.resource==='state'&&entry.operation==='refresh')return;
 if(entry.resource==='sessions'&&entry.operation==='create'){
  if(scope.nativeSessionId!==null)fail('DSH_NATIVE_SESSION_ALREADY_BOUND');
  if(db.prepare('SELECT 1 FROM conversation_messages WHERE conversation_id=? LIMIT 1').get(scope.conversationId))fail('DSH_NATIVE_CONVERSATION_NOT_EMPTY');
 }else if(!scope.nativeSessionId)fail('DSH_NATIVE_SESSION_NOT_BOUND');
 if(entry.resource==='presets'&&entry.operation==='select'&&db.prepare('SELECT 1 FROM conversation_messages WHERE conversation_id=? LIMIT 1').get(scope.conversationId))fail('DSH_PRESET_REQUIRES_NEW_CONVERSATION');
}
export function assertDshNativeSubject(db,workspaceId,payload){
 const current=assertCurrentAuthority(db,workspaceId,payload),op=payload.dshOperation;
 assertOperationScope(db,workspaceId,current,op.scope,getDshNativeOperation(op.resource,op.operation),op.input);
 return current;
}
export function registerDshNativeResult(db,row,input){
 const payload=parse(row?.payload_json),op=payload?.dshOperation;
 if(row?.type!==DSH_NATIVE_TYPE||op?.resource!=='sessions'||op?.operation!=='create'||input?.status!=='succeeded')return null;
 if(!row.acked_at||input.deviceId!==payload.deviceId)fail('DSH_NATIVE_DEVICE_MISMATCH',403);
 const receipt=projectReceipt(input.result?.dshNative||input.result?.result?.dshNative,op);
 if(!receipt||receipt.status!=='applied'||typeof receipt.data?.sessionId!=='string'||!receipt.data.sessionId||receipt.data.sessionId.length>600)fail('DSH_NATIVE_SESSION_RECEIPT_INVALID');
 const subject=assertCurrentAuthority(db,row.workspace_id,payload),scope=op.scope;
 if(scope.kind!=='conversation'||scope.nativeSessionId!==null)fail('DSH_NATIVE_SCOPE_CHANGED');
 const current=resolveScope(db,row.workspace_id,subject,scope.conversationId);
 if(current.nativeSessionId){if(current.nativeSessionId!==receipt.data.sessionId)fail('DSH_NATIVE_SESSION_BINDING_CONFLICT');}
 else assertOperationScope(db,row.workspace_id,subject,scope,getDshNativeOperation('sessions','create'));
 db.prepare(`INSERT INTO conversation_dsh_sessions(conversation_id,workspace_id,employee_id,device_id,bot_name,session_id,updated_at) VALUES(?,?,?,?,?,?,?)
  ON CONFLICT(conversation_id,employee_id,device_id,bot_name) DO NOTHING`).run(scope.conversationId,row.workspace_id,subject.employeeId,subject.deviceId,subject.profile,receipt.data.sessionId,new Date().toISOString());
 return{registered:true,conversationId:scope.conversationId,nativeSessionId:receipt.data.sessionId};
}
function createdSessionScope(db,workspaceId,payload,value){
 const op=payload?.dshOperation;
 if(op?.resource!=='sessions'||op.operation!=='create'||op.scope?.kind!=='conversation'||op.scope.nativeSessionId!==null||value?.status!=='applied'||typeof value.data?.sessionId!=='string')return null;
 try{const scope=resolveScope(db,workspaceId,op.subject,op.scope.conversationId);return scope.nativeSessionId===value.data.sessionId?scope:null;}catch{return null;}
}
export function assertDshNativeActionVisible(db,workspaceId,action,requester){
 const payload=action.payload||parse(action.payload_json),op=payload?.dshOperation;
 if(requester){assertEmployeeCapabilityAuthority(db,workspaceId,currentSubject(db,workspaceId,op.subject.employeeId),requester);if(op.groupMembers)assertDshNativeGroupMembers(db,workspaceId,op.subject,op.groupMembers,requester);}
 if(action.type===DSH_NATIVE_TYPE&&action.status==='succeeded'){
  const result=action.result||parse(action.result_json),value=projectReceipt(result?.dshNative||result?.result?.dshNative,op);
  if(createdSessionScope(db,workspaceId,payload,value))return assertCurrentAuthority(db,workspaceId,payload);
 }
 return assertDshNativeSubject(db,workspaceId,payload);
}
function safeValue(value){
 if(typeof value==='string')return redactSecrets(value);
 if(Array.isArray(value))return value.map(safeValue);
 if(!object(value))return value;
 return Object.fromEntries(Object.entries(value).filter(([key])=>!sensitiveKey(key)&&!privateFields.has(key)&&key!=='secrets').map(([key,item])=>[key,key==='error'?publicError(item):safeValue(item)]));
}
function schemaNode(schema,path){
 const resolve=node=>typeof node==='number'||typeof node==='string'?schema?.refs?.[node]:node;
 function visit(node,parts,seen=new Set()){
  node=resolve(node);if(!object(node)||seen.has(node))return null;
  if(!parts.length)return node;
  const next=new Set(seen);next.add(node);
  if(node.type==='union')return(node.list||[]).map(ref=>visit(ref,parts,next)).find(Boolean)||null;
  const [head,...tail]=parts;
  if(node.type==='object'&&Object.hasOwn(node.dict||{},head))return visit(node.dict[head],tail,next);
  if(node.type==='dict')return visit(node.inner,tail,next);
  if(node.type==='array'&&/^\d+$/.test(head))return visit(node.inner,tail,next);
  if(object(node.properties)&&Object.hasOwn(node.properties,head))return visit(node.properties[head],tail,next);
  return null;
 }
 return visit(schema?.refs?schema.uid:schema,path);
}
const secretRole=node=>['secret','password'].includes(node?.meta?.role)||node?.meta?.secret===true||node?.meta?.sensitive===true||node?.writeOnly===true;
function nodeHasSecret(schema,node,seen=new Set()){
 if(!object(node)||seen.has(node))return false;if(secretRole(node))return true;seen.add(node);
 const children=[...Object.values(node.dict||{}),...(node.list||[]),node.inner,...Object.values(node.properties||{})].filter(value=>value!==undefined);
 return children.some(value=>nodeHasSecret(schema,object(value)?value:schema.refs?.[value],seen));
}
const overlaps=(left,right)=>left.slice(0,Math.min(left.length,right.length)).every((item,index)=>item===right[index]);
function secretPaths(namespace){return(Array.isArray(namespace.secrets)?namespace.secrets:[]).filter(item=>object(item)&&Array.isArray(item.path)&&item.path.every(part=>typeof part==='string')).map(item=>item.path);}
function projectSchema(schema){
 if(!object(schema))return safeValue(schema);
 // Schema field names and reference IDs describe the editor, including its
 // secret fields; only secret defaults and diagnostics are removed here.
 function copy(value){
  if(Array.isArray(value))return value.map(copy);if(!object(value))return typeof value==='string'?redactSecrets(value):value;
  const out=Object.fromEntries(Object.entries(value).filter(([key])=>!privateFields.has(key)).map(([key,item])=>[key,copy(item)]));
  if(secretRole(value)&&object(out.meta)){delete out.meta.default;delete out.meta.examples;}
  return out;
 }
 return copy(schema);
}
function projectSettings(data){
 if(!object(data))return null;
 try{data=publicDshSettings(data);}catch{return null;}
 const out=Object.fromEntries(['writable','hasDocument','schemaFormat'].filter(key=>Object.hasOwn(data,key)).map(key=>[key,safeValue(data[key])]));
 out.namespaces=(Array.isArray(data.namespaces)?data.namespaces:[]).filter(object).map(namespace=>{
  const item=Object.fromEntries(['autoGenerate','ns','applies','revision'].filter(key=>Object.hasOwn(namespace,key)).map(key=>[key,safeValue(namespace[key])]));
  item.schema=projectSchema(namespace.schema);
  item.secrets=(Array.isArray(namespace.secrets)?namespace.secrets:[]).filter(entry=>object(entry)&&Array.isArray(entry.path)).map(entry=>({path:[...entry.path],set:entry.set===true}));
  for(const key of ['value','base','user'])if(Object.hasOwn(namespace,key))item[key]=safeValue(namespace[key]);
  return item;
 });
 return out;
}
export function projectDshNativeData(resource,data){
 if(resource==='settings')return projectSettings(data);
 if(resource==='plugins'&&object(data)&&Object.hasOwn(data,'mountBase')){
  const out={};
  for(const key of ['application','bridgePackage','version','requestId'])if(typeof data[key]==='string'&&data[key].length<=240)out[key]=redactSecrets(data[key]);
  if(typeof data.mountBase==='string'&&/^\/runtime\/[a-z0-9][a-z0-9-]{0,23}\/ui\/$/.test(data.mountBase))out.mountBase=data.mountBase;
  if(object(data.receipt))out.receipt=safeValue(data.receipt);
  if(typeof data.error==='string')out.error=redactSecrets(data.error).slice(0,400);
  return out;
 }
 if(resource==='providers'&&object(data))return{...safeValue(data),...(object(data.settings)?{settings:projectSettings(data.settings)}:{}),...(object(data.credentials)?{credentials:Object.fromEntries(Object.entries(data.credentials).filter(([,value])=>object(value)).map(([ref,value])=>[ref,{configured:value.configured===true,writable:value.writable===true,...(typeof value.source==='string'?{source:redactSecrets(value.source)}:{})}]))}:{})};
 if(resource==='state'){
  const source=object(data?.resources)?data.resources:{};
  return{resources:Object.fromEntries(Object.entries(source).filter(([name,value])=>resources.includes(name)&&object(value)).map(([name,value])=>[name,{status:applications.has(value.status)?value.status:'unknown',data:projectDshNativeData(name,value.data),...(typeof value.reasonCode==='string'&&/^[A-Z][A-Z0-9_]{0,99}$/.test(value.reasonCode)?{reasonCode:value.reasonCode}:{})}]))};
 }
 return safeValue(data);
}
function publicError(value){
 if(!object(value))return null;
 const out={};if(typeof value.code==='string'&&/^(?:DSH_[A-Z0-9_]+|(?:settings|pluginManager|agentPresets|llm|credentials|session|pluginMarket|commands)\/[a-z][a-z0-9-]+)$/.test(value.code))out.code=value.code;
 for(const key of ['expectedRevision','actualRevision'])if(Number.isSafeInteger(value[key]))out[key]=value[key];
 if(object(value.details)){const details={};for(const key of ['expected','actual'])if(Number.isSafeInteger(value.details[key]))details[key]=value.details[key];for(const key of ['ns','ref'])if(typeof value.details[key]==='string')details[key]=value.details[key];if(Object.keys(details).length)out.details=details;}
 return Object.keys(out).length?out:null;
}
function projectReceipt(value,operation){
 if(!object(value)||value.schemaVersion!==1||value.source!=='dsh-native'||!same(value.subject,operation.subject)||!same(value.scope,operation.scope)||value.resource!==operation.resource||value.operation!==operation.operation||!applications.has(value.status)||!Number.isFinite(Date.parse(value.checkedAt)))return null;
 const observations=object(value.observations)?projectDshNativeData('state',{resources:value.observations}).resources:null;
 return{schemaVersion:1,subject:operation.subject,scope:operation.scope,resource:value.resource,operation:value.operation,source:'dsh-native',checkedAt:new Date(value.checkedAt).toISOString(),status:value.status,data:projectDshNativeData(value.resource,value.data),...(typeof value.reasonCode==='string'&&/^DSH_[A-Z0-9_]+$/.test(value.reasonCode)?{reasonCode:value.reasonCode}:{}),...(observations?{observations}:{}),...(publicError(value.error)?{error:publicError(value.error)}:{}),...(object(value.application)?{application:safeValue(value.application)}:{})};
}
export function projectDshNativeAction(action){
 if(action?.type!==DSH_NATIVE_TYPE)return action;
 const payload=action.payload,op=payload.dshOperation,receipt=projectReceipt(action.result?.dshNative||action.result?.result?.dshNative,op);
 const out=Object.fromEntries(['id','task_id','agent_id','type','status','dedupe_key','created_at','acked_at','completed_at'].filter(key=>Object.hasOwn(action,key)).map(key=>[key,action[key]]));
 out.payload={workspace:payload.workspace,workspaceId:payload.workspaceId,userId:payload.userId||null,deviceId:payload.deviceId,dshOperation:{schemaVersion:1,subject:op.subject,scope:op.scope,resource:op.resource,operation:op.operation}};
 out.result=receipt?{dshNative:receipt}:null;out.error=action.error?'DSH_NATIVE_OPERATION_FAILED':null;
 if(Array.isArray(action.events))out.events=action.events.map(event=>({id:event.id,action_id:action.id,type:['created','acked','progress','succeeded','failed','expired','cancelled'].includes(event.type)?event.type:'event',created_at:event.created_at}));
 return out;
}
function assertPlainInput(value){
 if(Array.isArray(value)){for(const item of value)assertPlainInput(item);return;}
 if(!object(value))return;
 for(const[key,item]of Object.entries(value)){if(sensitiveKey(key))fail('DSH_SECURE_INPUT_REQUIRED',400);assertPlainInput(item);}
}
function normalizeGroupSend(input){
 let attachments;
 try{attachments=normalizeConversationAttachments(input.attachments);}catch{fail('DSH_NATIVE_GROUP_ATTACHMENT_INVALID',400);}
 if(attachments.some(item=>item.size>2*1024*1024))fail('DSH_NATIVE_GROUP_ATTACHMENT_INVALID',400);
 if(!input.content.trim()&&!attachments.length)fail('DSH_NATIVE_INPUT_INVALID',400);
 const{attachments:_raw,...rest}=input;
 return attachments.length?{...rest,attachments}:rest;
}
function assertSettingsMutation(input,descriptor){
 if(!descriptor||descriptor.status!=='observed')fail('DSH_NATIVE_REFRESH_REQUIRED');
 const description=descriptor.data,namespace=description?.namespaces?.find(item=>item.ns===input.ns);
 if(!namespace)fail('DSH_NATIVE_SETTINGS_NAMESPACE_UNKNOWN',400);
 if(description.writable!==true)fail('DSH_NATIVE_SETTINGS_READ_ONLY',403);
 if(input.expectedRevision!==namespace.revision)fail('settings/conflict',409,{expectedRevision:input.expectedRevision,actualRevision:namespace.revision});
 const secrets=secretPaths(namespace);
 for(const operation of input.ops){
  if(operation.path.some(sensitiveKey)||secrets.some(path=>overlaps(path,operation.path)))fail('DSH_SECURE_INPUT_REQUIRED',400);
  const node=schemaNode(namespace.schema,operation.path);
  if(!node)fail('DSH_NATIVE_SETTINGS_PATH_INVALID',400);
  if(nodeHasSecret(namespace.schema,node))fail('DSH_SECURE_INPUT_REQUIRED',400);
 }
}
export function createDshNativeService(repo,{management,now=Date.now,ttlMs=300000,actionTimeoutMs=60000}={}){
 const db=repo.db;
 function scoped(slug,id,query,context){
  const employee=management.employee(slug,id,context),ws=db.prepare('SELECT * FROM workspaces WHERE id=? AND slug=?').get(employee.workspace_id,slug);if(!ws)fail('EMPLOYEE_NOT_FOUND',404);
  const subject=currentSubject(db,ws.id,id);assertEmployeeCapabilityAuthority(db,ws.id,subject,actor(context));
  return{ws,subject,scope:resolveScope(db,ws.id,subject,query.conversationId),runtimeContext:runtimeContext(employee),device:db.prepare('SELECT * FROM devices WHERE id=? AND workspace_id=?').get(subject.deviceId,ws.id)};
 }
 function deviceReason(device){
  if(!device)return'DEVICE_UNASSIGNED';if(device.status==='disabled'||db.prepare('SELECT revoked_at FROM device_credentials WHERE device_id=? AND workspace_id=?').get(device.id,device.workspace_id)?.revoked_at)return'DEVICE_REVOKED';
  const seen=Date.parse(device.last_seen||'');if(device.status!=='online'||!Number.isFinite(seen)||now()-seen>Math.max(45000,Number(device.heartbeat_interval_ms||10000)*4))return'DEVICE_OFFLINE';
  return supports(device)?null:'CLIENT_NOT_REPORTED';
 }
 function rows(data,requester){return db.prepare("SELECT * FROM a2a_actions WHERE workspace_id=? AND type=? AND json_valid(payload_json) AND json_extract(payload_json,'$.dshOperation.subject.employeeId')=? ORDER BY rowid DESC LIMIT 100").all(data.ws.id,DSH_NATIVE_TYPE,data.subject.employeeId).filter(row=>{const payload=parse(row.payload_json),op=payload?.dshOperation,scope=row.status==='succeeded'?createdSessionScope(db,data.ws.id,payload,receipt(row)):null;if(op?.groupMembers)try{assertDshNativeActionVisible(db,data.ws.id,row,requester);}catch{return false;}return(op?.subject?.ownerUserId??null)===data.subject.ownerUserId&&(op?.scope?.kind==='bot'||data.scope.kind==='bot'&&['attempt','group'].includes(op?.scope?.kind)||same(scope||op?.scope,data.scope));});}
 function receipt(row){
  if(!['succeeded','failed'].includes(row.status)||typeof row.result_json!=='string'||row.result_json.length>2097152)return null;
  const payload=parse(row.payload_json),result=parse(row.result_json),value=projectReceipt(result?.dshNative||result?.result?.dshNative,payload?.dshOperation||{});if(!value)return null;
  const at=Date.parse(value.checkedAt);if(at<Date.parse(row.created_at)-30000||at>now()+30000)return null;
  return{...value,actionId:row.id,late:!Number.isFinite(Date.parse(row.completed_at))||Date.parse(row.completed_at)>Date.parse(row.expires_at)||at>Date.parse(row.expires_at)};
 }
 function touches(row,resource){const op=parse(row.payload_json)?.dshOperation;return op?.resource==='state'&&op.operation==='refresh'&&(op.input?.resources||DSH_NATIVE_REFRESH_RESOURCES).includes(resource)||Boolean(receipt(row)?.observations?.[resource])||op?.resource===resource&&!getDshNativeOperation(op.resource,op.operation)?.readOnly;}
 function observation(row,resource){
  let value=receipt(row);if(!value)return null;
  const created=row.status==='succeeded'?createdSessionScope(db,row.workspace_id,parse(row.payload_json),value):null;
  if(created)value={...value,scope:created};
  if(value.resource==='state'){const part=value.data.resources[resource];return part?{...value,resource,status:part.status,data:part.data,...(part.reasonCode?{reasonCode:part.reasonCode}:{})}:null;}
  const part=value.observations?.[resource];return part?{...value,resource,status:part.status,application:value.status,data:part.data,...(part.reasonCode?{reasonCode:part.reasonCode}:{})}:null;
 }
 function resourceState(resource,data,history,issue){
  const matchingRows=history.filter(row=>touches(row,resource)),visible=row=>{if(resource!=='groups')return true;try{assertDshNativeActionVisible(db,data.ws.id,row);return true;}catch{return false;}},snapshots=matchingRows.filter(row=>row.status==='succeeded'&&visible(row)).map(row=>observation(row,resource)).filter(value=>value&&['observed','applied','restart-required','overridden'].includes(value.status)),snapshot=snapshots.find(value=>same(value.subject,data.subject)&&!value.late)||snapshots.find(value=>!value.late)||snapshots[0]||null;
  let reason=issue,fresh=Boolean(snapshot&&!snapshot.late&&same(snapshot.subject,data.subject)&&['observed','applied','restart-required','overridden'].includes(snapshot.status)&&now()-Date.parse(snapshot.checkedAt)<=ttlMs&&!reason);
  const latest=matchingRows.find(row=>same(parse(row.payload_json)?.dshOperation?.subject,data.subject)),latestReceipt=latest?observation(latest,resource):null,latestResult=latest?receipt(latest):null;
  if(latest&&!visible(latest)){fresh=false;reason ||= 'AUTHORITY_REVOKED';}
  const pending=matchingRows.filter(row=>['pending','acked'].includes(row.status)&&Date.parse(row.expires_at)>now()&&same(parse(row.payload_json)?.dshOperation?.subject,data.subject)).flatMap(row=>{try{assertDshNativeSubject(db,data.ws.id,parse(row.payload_json));const op=parse(row.payload_json).dshOperation;return[{actionId:row.id,status:row.status,resource:op.resource,operation:op.operation,expiresAt:row.expires_at}];}catch{return[];}});
  if(fresh){try{assertDshNativeActionVisible(db,data.ws.id,history.find(row=>row.id===snapshot.actionId));}catch{fresh=false;reason='AUTHORITY_REVOKED';}}
  const attemptReason=!latest?null:latest.status==='failed'?'OPERATION_FAILED':latest.status==='expired'||['pending','acked'].includes(latest.status)&&Date.parse(latest.expires_at)<=now()?'OPERATION_TIMEOUT':latest.status==='succeeded'?(!latestResult?'RECEIPT_INVALID':latestResult.late?'LATE_RECEIPT':latestReceipt?['unknown','failed','cancelled','partial','unavailable'].includes(latestReceipt.status)?latestReceipt.reasonCode||'NATIVE_APPLICATION_UNCONFIRMED':null:latestResult.reasonCode||(['unknown','failed','cancelled','partial','unavailable'].includes(latestResult.status)?'NATIVE_APPLICATION_UNCONFIRMED':'READBACK_NOT_REPORTED')):null;
  if(attemptReason){fresh=false;reason ||=attemptReason;}
  if(!fresh&&!reason)reason=snapshot&&!same(snapshot.subject,data.subject)?'CONFIGURATION_CHANGED':snapshot?.late?'LATE_RECEIPT':snapshot?'SNAPSHOT_EXPIRED':'NOT_REPORTED';
  return{status:pending.length?'pending':fresh?'observed':'unknown',reasonCode:pending.length?'REFRESH_PENDING':fresh?null:reason,checkedAt:fresh?snapshot.checkedAt:null,data:fresh?snapshot.data:null,application:fresh?snapshot.application||snapshot.status:null,stale:Boolean(snapshot&&!fresh),snapshot:snapshot?{...snapshot,stale:!fresh}:null,pending,lastAttempt:latest?{actionId:latest.id,status:latest.status,operation:parse(latest.payload_json).dshOperation.operation,createdAt:latest.created_at,completedAt:latest.completed_at||null,reasonCode:attemptReason}:null};
 }
 function read(slug,id,query,context,data=scoped(slug,id,query,context)){
  const history=rows(data,actor(context)),issue=deviceReason(data.device),sections=Object.fromEntries(resources.map(resource=>[resource,resourceState(resource,data,history,issue)])),pending=history.filter(row=>['pending','acked'].includes(row.status)&&Date.parse(row.expires_at)>now()&&same(parse(row.payload_json)?.dshOperation?.subject,data.subject)).flatMap(row=>{try{assertDshNativeSubject(db,data.ws.id,parse(row.payload_json));const op=parse(row.payload_json).dshOperation;return[{actionId:row.id,status:row.status,resource:op.resource,operation:op.operation,expiresAt:row.expires_at}];}catch{return[];}}),ready=Object.values(sections).some(section=>section.status==='observed'),latest=history.find(row=>same(parse(row.payload_json)?.dshOperation?.subject,data.subject));
  return{schemaVersion:1,workspace:slug,employeeId:id,subject:data.subject,scope:data.scope,subjectHash:dshNativeSubjectHash(data.subject,data.scope),status:pending.length?'pending':ready?'ready':'unknown',reasonCode:pending.length?'REFRESH_PENDING':issue||(!ready?'NOT_REPORTED':null),resources:sections,pending,lastAttempt:latest?{actionId:latest.id,status:latest.status,resource:parse(latest.payload_json).dshOperation.resource,operation:parse(latest.payload_json).dshOperation.operation,createdAt:latest.created_at,completedAt:latest.completed_at||null}:null};
 }
 function capabilities(slug,id,context={}){
  const data=scoped(slug,id,{},context),reported=supports(data.device);
  const features=parse(data.device?.runtime_discovery_json)?.features;
  const pluginUiRelayReported=Array.isArray(features)&&features.includes(DSH_PLUGIN_UI_RELAY_FEATURE);
  return{schemaVersion:1,workspace:slug,employeeId:id,subject:data.subject,scope:data.scope,subjectHash:dshNativeSubjectHash(data.subject,data.scope),feature:DSH_NATIVE_FEATURE,clientReported:reported,pluginUiRelayReported,reasonCode:deviceReason(data.device),operations:DSH_NATIVE_OPERATIONS.map(entry=>({...entry,status:entry.implemented?(reported?'implemented':'client_required'):'unsupported',supported:entry.implemented&&reported}))};
 }
 function groupRoster(slug,data,context){
  return db.prepare("SELECT id FROM employees WHERE workspace_id=? AND target_device_id=? AND runtime='DSH' AND status<>'deleted' ORDER BY id").all(data.ws.id,data.subject.deviceId).flatMap(row=>{
   try{management.employee(slug,row.id,context);const subject=currentSubject(db,data.ws.id,row.id);assertEmployeeCapabilityAuthority(db,data.ws.id,subject,actor(context));return[{employeeId:subject.employeeId,profile:subject.profile}];}catch(error){if([400,403,404,409].includes(error.status))return[];throw error;}
  });
 }
 function groupOperation(slug,data,before,operation,input,context){
  if(operation==='cancel'){const source=groupSendSource(db,data.ws.id,data.subject,input.sourceActionId,actor(context));return{groupMembers:source.groupMembers,groupBinding:source.groupBinding};}
  const groupMembers=groupRoster(slug,data,context);assertDshNativeGroupMembers(db,data.ws.id,data.subject,groupMembers,actor(context));
  if(input.memberEmployeeIds!==undefined){const ids=input.memberEmployeeIds,profiles=ids.map(id=>groupMembers.find(member=>member.employeeId===id)?.profile);if(ids.length<2||ids.length>6||new Set(ids).size!==ids.length||!ids.includes(data.subject.employeeId)||profiles.some(profile=>!profile)||new Set(profiles).size!==profiles.length)fail('DSH_NATIVE_GROUP_MEMBERS_INVALID',400);}
  if(['list','create'].includes(operation))return{groupMembers};
  const section=before.resources.groups,view=section?.data,group=[...(Array.isArray(view?.items)?view.items:[]),...(object(view?.item)?[view.item]:[])].find(item=>item.id===input.groupId);
  if(!group)fail('DSH_NATIVE_GROUP_NOT_OBSERVED');
  const groupBinding={groupId:group.id,members:[...group.members]};assertGroupBinding(data.subject,groupBinding,groupMembers);
  if(input.targetEmployeeIds!==undefined&&(input.targetEmployeeIds.length<1||new Set(input.targetEmployeeIds).size!==input.targetEmployeeIds.length||input.targetEmployeeIds.some(id=>!groupMembers.some(member=>member.employeeId===id&&groupBinding.members.includes(member.profile)))))fail('DSH_NATIVE_GROUP_MEMBERS_INVALID',400);
  return{groupMembers,groupBinding,...(operation==='send'?{groupTargets:dshNativeGroupTargets(data.subject,groupMembers,groupBinding,input)}:{})};
 }
 function queue(slug,id,input,context,{refresh=false}={}){
  const allowed=refresh?['resources','conversationId','idempotencyKey']:['resource','operation','input','conversationId','expectedSubjectHash','idempotencyKey'];
  if(!object(input)||Object.keys(input).some(key=>!allowed.includes(key))||!refresh&&!keyValid(input.idempotencyKey)||input.idempotencyKey!==undefined&&!keyValid(input.idempotencyKey))fail('DSH_NATIVE_INPUT_INVALID',400);
  const resource=refresh?'state':input.resource,operation=refresh?'refresh':input.operation,entry=getDshNativeOperation(resource,operation);
  if(!entry?.implemented)fail('DSH_NATIVE_OPERATION_UNSUPPORTED',400);
  const validated=normalizeDshNativeInput(resource,operation,refresh?Object.hasOwn(input,'resources')?{resources:input.resources}:{}:input.input??{}),normalized=resource==='groups'&&operation==='send'?normalizeGroupSend(validated):validated;assertPlainInput(normalized);
  const data=scoped(slug,id,input,context),groupId=resource==='groups'&&operation==='cancel'?groupSendSource(db,data.ws.id,data.subject,normalized.sourceActionId,actor(context)).scope.groupId:normalized.groupId,scope=entry.scope==='attempt'&&data.scope.kind==='bot'?{kind:'attempt',sourceActionId:normalized.sourceActionId}:entry.scope==='group'&&data.scope.kind==='bot'?{kind:'group',groupId}:data.scope;if(entry.scope!==scope.kind&&entry.scope!=='either')fail('DSH_NATIVE_SCOPE_UNSUPPORTED',400);
  const before=read(slug,id,input,context,data),dedupeKey=`dsh-native:${id}:${resource}:${operation}:${digest(input.idempotencyKey||randomUUID())}`,previous=db.prepare('SELECT * FROM a2a_actions WHERE workspace_id=? AND dedupe_key=?').get(data.ws.id,dedupeKey);
  if(previous){const saved=parse(previous.payload_json)?.dshOperation;if(!same(saved?.input,normalized))fail('IDEMPOTENCY_CONFLICT');if(!same(saved?.subject,data.subject))fail('DSH_NATIVE_SUBJECT_CHANGED');if(!same(saved?.scope,scope))fail('DSH_NATIVE_SCOPE_CHANGED');if(saved.groupMembers)assertDshNativeActionVisible(db,data.ws.id,previous,actor(context));return{...before,duplicate:true,action:projectDshNativeAction(repo.getA2AAction(previous.id))};}
  if(!refresh&&input.expectedSubjectHash!==before.subjectHash)fail('DSH_NATIVE_SUBJECT_CHANGED');
  if(deviceReason(data.device))return{...before,action:null};
  assertOperationScope(db,data.ws.id,data.subject,scope,entry,normalized);
  if(resource==='settings'&&operation==='mutate')assertSettingsMutation(normalized,before.resources.settings);
  const origin=resource==='plugins'&&operation==='installBundle'?installSource(db,data.ws.id,data.subject,normalized,actor(context)):null;
  const group=resource==='groups'?groupOperation(slug,data,before,operation,normalized,context):resource==='state'&&normalized.resources.includes('groups')?{groupMembers:groupRoster(slug,data,context)}:{};
  const payload={workspace:slug,workspaceId:data.ws.id,userId:context.actorUserId||null,deviceId:data.subject.deviceId,dshOperation:{schemaVersion:1,subject:data.subject,scope,resource,operation,input:normalized,...(resource==='sessions'&&operation==='create'?{runtimeContext:data.runtimeContext}:{}),...(origin?{installSource:origin}:{}),...group,requestedBy:actor(context)}};
  assertDshNativeSubject(db,data.ws.id,payload);
  const action=repo.createA2AAction(slug,{agentId:'ziwei_user',type:DSH_NATIVE_TYPE,botInternal:BOT_INTERNAL,dedupeKey,expiresAt:new Date(now()+actionTimeoutMs).toISOString(),payload});
  return{...read(slug,id,input,context,data),action:projectDshNativeAction(repo.getA2AAction(action.id))};
 }
 return{capabilities,state:(slug,id,query={},context={})=>{if(!object(query)||Object.keys(query).some(key=>key!=='conversationId'))fail('DSH_NATIVE_INPUT_INVALID',400);return read(slug,id,query,context);},refresh:(slug,id,input={},context={})=>queue(slug,id,input,context,{refresh:true}),action:(slug,id,input,context={})=>queue(slug,id,input,context)};
}
