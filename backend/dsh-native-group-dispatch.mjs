import {createHash} from 'node:crypto';
import {BOT_INTERNAL} from './bots.mjs';
import {assertDshNativeSubject,assertDshNativeActionVisible,assertDshNativeGroupMembers,dshNativeGroupTargets} from './dsh-native-operations.mjs';
import {employeeCapabilitySubject} from './employee-capability-inventory.mjs';
import {DSH_NATIVE_TYPE} from '../src/dsh-native-contract.mjs';
import {confirmedDshSessionExit,confirmedDshPrePromptFailure} from '../src/dsh-session-receipt.mjs';

export const DSH_GROUP_MESSAGE_INTERNAL=Symbol('dsh-group-message');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
const canonical=value=>JSON.stringify(value,(_key,item)=>object(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const same=(left,right)=>canonical(left)===canonical(right);
const hash=value=>createHash('sha256').update(canonical(value)).digest('hex');
const fail=(code,status=409)=>{throw Object.assign(new Error(code),{code,status});};
const conversationKind='dsh.group.conversation';
const actionView=row=>({...row,payload:row.payload||parse(row.payload_json),result:row.result||parse(row.result_json)});
const trusted=op=>({actorUserId:op.requestedBy.userId,actorRole:op.requestedBy.role,deviceScope:op.requestedBy.deviceScope,enforceDeviceOwnership:true});
const conversationKey=(subject,groupId,member)=>hash([subject.workspaceId,subject.deviceId,groupId,member.employeeId,member.profile]);

function source(db,sourceActionId){
 const row=db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(sourceActionId),action=row&&actionView(row),op=action?.payload?.dshOperation;
 if(action?.type!==DSH_NATIVE_TYPE||op?.resource!=='groups'||op.operation!=='send'||op.scope?.kind!=='group'||!row.acked_at)fail('DSH_NATIVE_GROUP_SOURCE_INVALID');
 assertDshNativeSubject(db,row.workspace_id,action.payload);
 return{row,action,op};
}
function children(db,workspaceId,sourceActionId){return db.prepare("SELECT * FROM a2a_actions WHERE workspace_id=? AND type='conversation.execute' AND json_valid(payload_json) AND json_extract(payload_json,'$.dshGroup.sourceActionId')=? ORDER BY rowid").all(workspaceId,sourceActionId).map(actionView);}
function memberView(action){return{employeeId:action.payload.employeeId,profile:action.payload.profile,conversationId:action.payload.conversationId,actionId:action.id};}
function assertDedicatedConversation(db,subject,groupId,member,conversationId){
 const key=conversationKey(subject,groupId,member),link=db.prepare('SELECT * FROM management_requests WHERE workspace_id=? AND kind=? AND request_key=?').get(subject.workspaceId,conversationKind,key),conversation=db.prepare('SELECT * FROM conversations WHERE id=? AND workspace_id=?').get(conversationId,subject.workspaceId);
 if(link?.resource_id!==conversationId||link.fingerprint!==key||!conversation||conversation.employee_id!==member.employeeId||conversation.device_id!==subject.deviceId||conversation.status!=='active')fail('DSH_NATIVE_GROUP_CONVERSATION_CHANGED');
 return conversation;
}

export function assertDshNativeGroupConversationVisible(db,workspaceId,conversationId,requester){
 if(!requester||!requester.userId&&!requester.role&&!requester.deviceScope)return null;
 const link=db.prepare('SELECT request_key,fingerprint FROM management_requests WHERE workspace_id=? AND kind=? AND resource_id=?').get(workspaceId,conversationKind,conversationId);
 if(!link)return null;
 const history=db.prepare("SELECT payload_json FROM a2a_actions WHERE workspace_id=? AND type='conversation.execute' AND json_valid(payload_json) AND json_extract(payload_json,'$.conversationId')=? AND json_extract(payload_json,'$.dshGroup.sourceActionId') IS NOT NULL").all(workspaceId,conversationId),checked=new Set();
 if(!history.length)fail('DSH_NATIVE_GROUP_CONVERSATION_FORBIDDEN',403);
 for(const child of history){
  const payload=parse(child.payload_json),marker=payload.dshGroup;
  if(checked.has(marker.sourceActionId))continue;
  const original=db.prepare('SELECT type,payload_json,acked_at FROM a2a_actions WHERE id=? AND workspace_id=?').get(marker.sourceActionId,workspaceId),op=parse(original?.payload_json)?.dshOperation,member=op?.groupMembers?.find(item=>item.employeeId===payload.employeeId&&item.profile===marker.memberProfile);
  if(original?.type!==DSH_NATIVE_TYPE||!original.acked_at||op?.resource!=='groups'||op.operation!=='send'||op.scope?.kind!=='group'||op.scope.groupId!==marker.groupId||!member||link.request_key!==conversationKey(op.subject,marker.groupId,member)||link.fingerprint!==link.request_key)fail('DSH_NATIVE_GROUP_CONVERSATION_FORBIDDEN',403);
  // Read all historical grants with the current viewer's authority. Later
  // legitimate configuration changes must not invalidate history by fingerprint.
  assertDshNativeGroupMembers(db,workspaceId,op.subject,op.groupMembers,requester);checked.add(marker.sourceActionId);
 }
 return true;
}

// Parent completion ends coordination, not an already issued supervised task.
// Its original grant remains subject to current member and employee authority.
export function assertDshNativeGroupChild(db,actionOrRow,requester){
 const action=actionView(actionOrRow),p=action.payload,marker=p?.dshGroup;
 if(!object(marker)||marker.schemaVersion!==1||!['conversation.execute','action.cancel'].includes(action.type))fail('DSH_NATIVE_GROUP_CHILD_INVALID');
 const{op,row}=source(db,marker.sourceActionId),member=op.groupMembers.find(item=>item.profile===marker.memberProfile&&item.employeeId===p.employeeId);
 if(requester)assertDshNativeActionVisible(db,row.workspace_id,row,requester);
 if(!member||marker.groupId!==op.scope.groupId||!op.groupTargets.includes(member.employeeId)||p.deviceId!==op.subject.deviceId||p.workspace!==op.subject.workspace||p.workspaceId!==undefined&&p.workspaceId!==row.workspace_id)fail('DSH_NATIVE_GROUP_CHILD_INVALID');
 if(action.type==='action.cancel'){
  const control=db.prepare('SELECT * FROM a2a_actions WHERE id=? AND workspace_id=?').get(marker.controlActionId,row.workspace_id),payload=parse(control?.payload_json),controlOp=payload?.dshOperation;
  if(control?.type!==DSH_NATIVE_TYPE||!control.acked_at||controlOp?.resource!=='groups'||controlOp.operation!=='cancel'||controlOp.input.sourceActionId!==row.id)fail('DSH_NATIVE_GROUP_CONTROL_INVALID');
  assertDshNativeSubject(db,row.workspace_id,payload);
  const target=db.prepare('SELECT * FROM a2a_actions WHERE id=? AND workspace_id=?').get(p.actionId,row.workspace_id);
  if(!target||parse(target.payload_json)?.dshGroup?.sourceActionId!==row.id||parse(target.payload_json)?.employeeId!==member.employeeId)fail('DSH_NATIVE_GROUP_CHILD_INVALID');
  return assertDshNativeGroupChild(db,target,requester);
 }
 if(p.runtime!=='DSH'||p.profile!==member.profile||!Number.isFinite(p.timeoutMs)||p.timeoutMs<100||p.timeoutMs>900000)fail('DSH_NATIVE_GROUP_CHILD_INVALID');
 assertDedicatedConversation(db,op.subject,marker.groupId,member,p.conversationId);
 const current=employeeCapabilitySubject(db,row.workspace_id,member.employeeId),binding=db.prepare('SELECT session_id FROM conversation_dsh_sessions WHERE conversation_id=? AND workspace_id=? AND employee_id=? AND device_id=? AND bot_name=?').get(p.conversationId,row.workspace_id,member.employeeId,op.subject.deviceId,member.profile);
 if(p.runtimeSessionId&&binding?.session_id!==p.runtimeSessionId)fail('DSH_NATIVE_GROUP_SESSION_CONFLICT');
 return current;
}

export function createDshNativeGroupDispatch(repo,{management,now=Date.now}={}){
 const db=repo.db;
 function deviceAction(sourceActionId,input,credential,{active=false}={}){
  const value=source(db,sourceActionId),{op,row}=value;
  if(input.workspace!==op.subject.workspace||credential?.deviceId!==op.subject.deviceId||credential?.workspaceId!==row.workspace_id)fail('DSH_NATIVE_GROUP_DEVICE_MISMATCH',403);
  const key=db.prepare('SELECT id,revoked_at FROM device_credentials WHERE workspace_id=? AND device_id=?').get(row.workspace_id,op.subject.deviceId);
  if(!key||key.revoked_at||key.id!==credential.credentialId)fail('DSH_NATIVE_GROUP_DEVICE_MISMATCH',403);
  if(active&&(row.status!=='acked'||Date.parse(row.expires_at)<=now()))fail('DSH_NATIVE_GROUP_SOURCE_NOT_ACTIVE');
  return value;
 }
 function transaction(run){db.exec('SAVEPOINT dsh_group_dispatch');try{const result=run();db.exec('RELEASE dsh_group_dispatch');return result;}catch(error){db.exec('ROLLBACK TO dsh_group_dispatch; RELEASE dsh_group_dispatch');throw error;}}
 function conversation(subject,group,member,op){
  const key=conversationKey(subject,group.id,member),link=db.prepare('SELECT * FROM management_requests WHERE workspace_id=? AND kind=? AND request_key=?').get(subject.workspaceId,conversationKind,key);
  const employee=management.employee(subject.workspace,member.employeeId,trusted(op)),cwd=employee.default_working_directory_device_id===subject.deviceId?employee.default_working_directory||null:null;
  let value;
  if(link)value=assertDedicatedConversation(db,subject,group.id,member,link.resource_id);
  else{
   value=repo.createConversation(subject.workspace,{employeeId:member.employeeId,title:`DSH Group: ${group.title||group.id}`,...trusted(op)});
   db.prepare('INSERT INTO management_requests(workspace_id,kind,request_key,fingerprint,resource_id,created_at) VALUES(?,?,?,?,?,?)').run(subject.workspaceId,conversationKind,key,key,value.id,new Date(now()).toISOString());
  }
  // Group work uses this member's employee default or the native Bot's workdir,
  // never the device heartbeat directory selected for ordinary legacy chats.
  db.prepare('UPDATE conversations SET working_directory=? WHERE id=?').run(cwd,value.id);
  const session=group.sessions[member.profile],existing=db.prepare('SELECT session_id FROM conversation_dsh_sessions WHERE conversation_id=? AND employee_id=? AND device_id=? AND bot_name=?').get(value.id,member.employeeId,subject.deviceId,member.profile);
  if(session){
   const collision=db.prepare('SELECT conversation_id FROM conversation_dsh_sessions WHERE workspace_id=? AND device_id=? AND bot_name=? AND session_id=? AND conversation_id<>?').get(subject.workspaceId,subject.deviceId,member.profile,session,value.id);
   if(collision||existing&&existing.session_id!==session)fail('DSH_NATIVE_GROUP_SESSION_CONFLICT');
   db.prepare('INSERT INTO conversation_dsh_sessions(conversation_id,workspace_id,employee_id,device_id,bot_name,session_id,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(conversation_id,employee_id,device_id,bot_name) DO NOTHING').run(value.id,subject.workspaceId,member.employeeId,subject.deviceId,member.profile,session,new Date(now()).toISOString());
  }
  return value;
 }
 function dispatch(sourceActionId,input,credential){
  validateDispatch(input);const{op,row}=deviceAction(sourceActionId,input,credential),group=input.group;
  if(group.id!==op.scope.groupId||!same(group.members,op.groupBinding.members))fail('DSH_NATIVE_GROUP_SOURCE_CHANGED');
  const targets=dshNativeGroupTargets(op.subject,op.groupMembers,op.groupBinding,op.input),old=children(db,row.workspace_id,row.id);
  if(old.length){if(old.length!==targets.length||old.some(child=>!targets.includes(child.payload.employeeId)))fail('DSH_NATIVE_GROUP_DISPATCH_INCOMPLETE');for(const child of old)assertDshNativeGroupChild(db,child);return{sourceActionId,groupId:group.id,members:old.map(memberView),duplicate:true};}
  deviceAction(sourceActionId,input,credential,{active:true});
  const timeoutMs=Math.floor(Math.min(900000,Date.parse(row.expires_at)-now()));if(timeoutMs<100)fail('DSH_NATIVE_GROUP_SOURCE_NOT_ACTIVE');
  return transaction(()=>{
   const members=targets.map(employeeId=>{
    const member=op.groupMembers.find(item=>item.employeeId===employeeId),thread=conversation(op.subject,group,member,op),marker={schemaVersion:1,sourceActionId,groupId:group.id,memberProfile:member.profile};
    const attachments=op.input.attachments,request=op.input.content||(attachments?.some(item=>item.mimeType.startsWith('image/'))?'请分析所附图片，说明其中的内容并回复用户。':'请阅读所附文件并回复用户。');
    const history=group.messages.map(message=>`[${message.botName||message.role}] ${message.text||''}`).join('\n'),content=`[DSH native group: ${group.title||group.id}]\n${history}\n\n[Current group message]\n${request}`;
    const message=repo.addConversationMessage(thread.id,{content,...(attachments?{attachments}:{}),clientMessageId:`dsh-group:${hash([sourceActionId,employeeId])}`,...trusted(op),[DSH_GROUP_MESSAGE_INTERNAL]:{...marker,timeoutMs}}),action=repo.getA2AAction(message.execution.id);
    assertDshNativeGroupChild(db,action);return memberView(action);
   });
   return{sourceActionId,groupId:group.id,members,duplicate:false};
  });
 }
 function cancel(sourceActionId,input,credential){
  if(!object(input)||Object.keys(input).some(key=>!['workspace','controlActionId'].includes(key))||typeof input.controlActionId!=='string')fail('DSH_NATIVE_GROUP_INPUT_INVALID',400);
  const{op,row}=deviceAction(sourceActionId,input,credential),control=db.prepare('SELECT * FROM a2a_actions WHERE id=? AND workspace_id=?').get(input.controlActionId,row.workspace_id),payload=parse(control?.payload_json),controlOp=payload?.dshOperation;
  if(control?.type!==DSH_NATIVE_TYPE||control.status!=='acked'||Date.parse(control.expires_at)<=now()||controlOp?.resource!=='groups'||controlOp.operation!=='cancel'||controlOp.input.sourceActionId!==sourceActionId)fail('DSH_NATIVE_GROUP_CONTROL_INVALID');
  assertDshNativeSubject(db,row.workspace_id,payload);
  return transaction(()=>({sourceActionId,controlActionId:control.id,groupId:op.scope.groupId,requested:true,cancelRequested:true,stopConfirmed:false,members:children(db,row.workspace_id,sourceActionId).map(child=>{
   assertDshNativeGroupChild(db,child);
   const targetResultAvailable=Boolean(confirmedDshSessionExit(child,child)||confirmedDshPrePromptFailure(child,child)),base={employeeId:child.payload.employeeId,profile:child.payload.profile,actionId:child.id,targetActionId:child.id,targetResultAvailable};
   if(child.status==='pending'){
    repo.removeConversationQueueItem(child.payload.conversationId,child.id,trusted(controlOp));
    return{...base,queuedCancelled:true,cancellationRequested:true,targetResultAvailable:true};
   }
   if(child.status==='failed'&&child.acked_at===null&&child.error==='CONVERSATION_QUEUE_REMOVED'&&child.result?.queueRemoved===true&&!child.result.sessionExit)return{...base,queuedCancelled:true,cancellationRequested:true,targetResultAvailable:true};
   if(targetResultAvailable)return{...base,cancellationRequested:false};
   const action=repo.createA2AAction(op.subject.workspace,{type:'action.cancel',botInternal:BOT_INTERNAL,dedupeKey:`dsh-group-cancel:${control.id}:${child.id}`,payload:{workspace:op.subject.workspace,workspaceId:row.workspace_id,userId:payload.userId||null,deviceId:op.subject.deviceId,employeeId:child.payload.employeeId,actionId:child.id,dshGroup:{...child.payload.dshGroup,controlActionId:control.id}}});
   return{...base,cancelActionId:action.id,cancellationRequested:true};
  })}));
 }
 return{dispatch,cancel};
}

function validateDispatch(input){
 const group=input?.group;
 if(!object(input)||Object.keys(input).some(key=>!['workspace','group'].includes(key))||typeof input.workspace!=='string'||!object(group)||Object.keys(group).some(key=>!['id','title','createdAt','updatedAt','members','sessions','messages'].includes(key))||typeof group.id!=='string'||typeof group.title!=='string'||!Array.isArray(group.members)||!group.members.every(value=>typeof value==='string')||!object(group.sessions)||Object.entries(group.sessions).some(([profile,value])=>!group.members.includes(profile)||typeof value!=='string'||!value||value.length>600)||!Array.isArray(group.messages)||group.messages.length>300||group.messages.some(message=>!object(message)||typeof message.role!=='string'||message.text!==undefined&&typeof message.text!=='string')||Buffer.byteLength(JSON.stringify(group))>2097152)fail('DSH_NATIVE_GROUP_INPUT_INVALID',400);
}
