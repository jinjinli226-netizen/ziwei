import {DSH_NATIVE_TYPE} from './dsh-native-contract.mjs';
import {confirmedDshSessionExit} from './dsh-session-receipt.mjs';
import {redactSecrets} from './redaction.mjs';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=value=>typeof value==='string'&&value.length>0;
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
const fail=code=>{throw Object.assign(new Error(code),{code});};
const canonical=value=>JSON.stringify(value,(_key,item)=>object(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const same=(left,right)=>canonical(left)===canonical(right);
const transient=new Set(['streaming','running','sending','queued','approval']);

export async function executeDshNativeGroupRun(action,{request,devicePost,readMemberAction,signal,onStage,wait=delay,now=Date.now}={}){
 const op=action?.payload?.dshOperation,subject=op?.subject,scope=op?.scope,input=op?.input||{},roster=op?.groupMembers;
 if(action?.type!==DSH_NATIVE_TYPE||op?.schemaVersion!==1||op.resource!=='groups'||subject?.runtime!=='DSH'||action.payload.workspace!==subject.workspace||action.payload.workspaceId!==subject.workspaceId||action.payload.deviceId!==subject.deviceId||!['send','cancel'].includes(op.operation)||scope?.kind!=='group'||!text(scope.groupId)||typeof devicePost!=='function')fail('DSH_NATIVE_GROUP_SUBJECT_INVALID');
 if(op.operation==='cancel'){
  if(!text(input.sourceActionId)||Object.keys(input).some(key=>key!=='sourceActionId'))fail('DSH_NATIVE_GROUP_INPUT_INVALID');
  try{const receipt=await devicePost(`/a2a/v1/actions/${encodeURIComponent(input.sourceActionId)}/dsh-group/cancel`,{controlActionId:action.id});return{status:'observed',data:{groupId:scope.groupId,sourceActionId:input.sourceActionId,cancelRequested:receipt.cancelRequested===true||receipt.requested===true,stopConfirmed:false,members:(receipt.members||[]).map(member=>({actionId:member.actionId||member.targetActionId,...(member.cancelActionId?{cancelActionId:member.cancelActionId}:{}),cancellationRequested:member.cancellationRequested===true||Boolean(member.cancelActionId),targetResultAvailable:member.targetResultAvailable===true}))}};}
  catch{return{status:'unknown',reasonCode:'DSH_NATIVE_GROUP_CANCEL_UNKNOWN',data:{groupId:scope.groupId,sourceActionId:input.sourceActionId,cancelRequested:null}};}
 }
 if(input.groupId!==scope.groupId||typeof input.content!=='string'||!input.content.trim()&&!input.attachments?.length||Object.keys(input).some(key=>!['groupId','content','targetEmployeeIds','attachments'].includes(key))||typeof request!=='function'||typeof readMemberAction!=='function')fail('DSH_NATIVE_GROUP_INPUT_INVALID');
 if(!Array.isArray(roster)||!roster.some(member=>member.employeeId===subject.employeeId&&member.profile===subject.profile))fail('DSH_NATIVE_GROUP_SUBJECT_INVALID');
 const employees=new Map(roster.map(member=>[member.employeeId,member.profile])),profiles=new Set(employees.values()),path=`/api/groups/${encodeURIComponent(scope.groupId)}`;
 const visible=group=>group?.id===scope.groupId&&Array.isArray(group.members)&&group.members.length>=2&&group.members.length<=6&&new Set(group.members).size===group.members.length&&group.members.includes(subject.profile)&&group.members.every(profile=>profiles.has(profile));
 const readGroup=async()=>{const value=await request('GET',path),item=value?.item||value;if(value?.ok===false||!visible(item))fail('DSH_NATIVE_GROUP_FORBIDDEN');return groupView(item);};
 const group=await readGroup(),targets=op.groupTargets||input.targetEmployeeIds||roster.filter(member=>group.members.includes(member.profile)).map(member=>member.employeeId);
 if(!Array.isArray(targets)||!targets.length||new Set(targets).size!==targets.length||targets.some(id=>!group.members.includes(employees.get(id))))fail('DSH_NATIVE_GROUP_MEMBERS_INVALID');
 const budget=Number(action.payload.timeoutMs??action.payload.timeout_ms)||900000,deadline=Number(now())+Math.max(0,budget),data={groupId:group.id,sourceActionId:action.id,duplicate:false,members:[],historyPersisted:false};
 let dispatched=false;
 const finish=status=>({status,...status==='applied'?{}:{reasonCode:status==='failed'?'DSH_NATIVE_GROUP_MEMBERS_FAILED':status==='partial'?'DSH_NATIVE_GROUP_PARTIAL':'DSH_NATIVE_GROUP_OUTCOME_UNKNOWN'},data});
 try{
  if(signal?.aborted)return finish('unknown');
  dispatched=true;
  const dispatch=await devicePost(`/a2a/v1/actions/${encodeURIComponent(action.id)}/dsh-group/dispatch`,{group});
  if(dispatch?.sourceActionId!==action.id||dispatch.groupId!==group.id||!Array.isArray(dispatch.members)||dispatch.members.length!==targets.length||new Set(dispatch.members.map(member=>member.actionId)).size!==targets.length||new Set(dispatch.members.map(member=>member.employeeId)).size!==targets.length||dispatch.members.some(member=>!targets.includes(member.employeeId)||member.profile!==employees.get(member.employeeId)||!text(member.conversationId)||!text(member.actionId)))fail('DSH_NATIVE_GROUP_DISPATCH_INVALID');
  data.duplicate=dispatch.duplicate===true;data.members=dispatch.members.map(member=>({...pick(member,['employeeId','profile','conversationId','actionId']),status:'pending'}));
  onStage?.({stage:'group',message:'群成员动作已交给现有调度器',groupId:group.id,members:data.members.map(member=>pick(member,['employeeId','actionId']))});
  while(data.members.some(member=>member.status==='pending')&&!signal?.aborted&&Number(now())<deadline){
   await Promise.all(data.members.filter(member=>member.status==='pending').map(async member=>{
    try{const value=await readMemberAction(member.actionId),next=memberResult(value,member,subject);Object.assign(member,next);}
    catch{Object.assign(member,{status:'unknown',error:'DSH_NATIVE_GROUP_MEMBER_UNAVAILABLE'});}
   }));
   if(data.members.some(member=>member.status==='pending')&&!signal?.aborted&&Number(now())<deadline)await wait(Math.min(400,deadline-Number(now())),signal);
  }
  for(const member of data.members)if(member.status==='pending'){member.status='unknown';member.error=signal?.aborted?'DSH_NATIVE_GROUP_WAIT_CANCELLED':'DSH_NATIVE_GROUP_WAIT_EXPIRED';}
  onStage?.({stage:'group',message:'已核对群成员动作结果',groupId:group.id,members:data.members.map(member=>pick(member,['employeeId','actionId','status']))});
  const latest=await readGroup();
  if(!same(latest.members,group.members))fail('DSH_NATIVE_GROUP_MEMBERS_CHANGED');
  const attachmentText=(input.attachments||[]).map(file=>`[附件：${file.name}]`).join('\n');
  const sessions={...latest.sessions},added=[{id:`dsh-group:${action.id}:user`,role:'user',text:utf8([input.content,attachmentText].filter(Boolean).join('\n\n'),65536),status:'complete'}];
  for(const member of data.members){
   if(member.sessionId)sessions[member.profile]=member.sessionId;
   if(member.status==='succeeded')added.push({id:`dsh-group:${member.actionId}:assistant`,role:'assistant',text:utf8(member.output,65536),status:'complete',botName:member.profile,botDisplayName:member.profile});
   else added.push({id:`dsh-group:${member.actionId}:error`,role:'tool',text:member.error||'DSH_NATIVE_GROUP_MEMBER_OUTCOME_UNKNOWN',error:member.error||'DSH_NATIVE_GROUP_MEMBER_OUTCOME_UNKNOWN',status:member.status==='unknown'?'interrupted':'error',botName:member.profile,botDisplayName:member.profile});
  }
  const ids=new Set(added.map(message=>message.id)),messages=[...latest.messages.filter(message=>!ids.has(message.id)),...added].slice(-300);
  const written=await request('PUT',path,{sessions,messages});if(written?.ok===false)fail('DSH_NATIVE_GROUP_HISTORY_WRITE_FAILED');
  const saved=await readGroup();data.historyPersisted=same(saved.sessions,sessions)&&same(saved.messages,messages);
  const succeeded=data.members.filter(member=>member.status==='succeeded').length,status=data.historyPersisted&&succeeded===data.members.length?'applied':succeeded?'partial':data.members.every(member=>member.status==='failed')?'failed':'unknown';
  return{...finish(status),observations:{groups:{status:'observed',data:{item:saved,sourceOperation:'send'}}}};
 }catch(error){
  if(!dispatched)throw error;
  data.error={code:typeof error?.code==='string'&&/^DSH_NATIVE_GROUP_[A-Z_]+$/.test(error.code)?error.code:'DSH_NATIVE_GROUP_OUTCOME_UNKNOWN'};
  return finish(data.members.some(member=>member.status==='succeeded')?'partial':'unknown');
 }
}

function memberResult(value,member,subject){
 const action=value?.action||value,delivery=value?.delivery||action;
 if(!action||!['succeeded','failed','cancelled','expired','unknown'].includes(delivery.status))return{status:'pending'};
 const p=action.payload,exit=delivery.result?.sessionExit;
 if(action.id!==member.actionId||p?.runtime!=='DSH'||p.employeeId!==member.employeeId||p.conversationId!==member.conversationId||p.profile!==member.profile||p.deviceId!==subject.deviceId||p.workspace!==subject.workspace)return{status:'unknown',error:'DSH_NATIVE_GROUP_MEMBER_BINDING_CHANGED'};
 if(delivery.status==='failed'&&delivery.error==='CONVERSATION_QUEUE_REMOVED'&&action.acked_at===null&&!exit)return{status:'failed',error:'CONVERSATION_QUEUE_REMOVED'};
 const binding=p.dshSessionBinding||exit;
 if(!confirmedDshSessionExit(action,delivery,binding))return{status:'unknown',error:'DSH_NATIVE_GROUP_MEMBER_OUTCOME_UNKNOWN'};
 if(delivery.status==='succeeded')return{status:'succeeded',sessionId:exit.sessionId,output:utf8(delivery.result.output||'',65536)};
 return{status:'failed',sessionId:exit.sessionId,error:utf8(redactSecrets(delivery.error||delivery.result?.error||'DSH_NATIVE_GROUP_MEMBER_FAILED'),4000)};
}
function groupView(group){return{...pick(group,['id','title','createdAt','updatedAt']),members:[...group.members],sessions:Object.fromEntries(Object.entries(group.sessions||{}).filter(([profile,session])=>group.members.includes(profile)&&text(session))),messages:(group.messages||[]).map(message=>({...pick(message,['id','role','text','botName','botDisplayName','toolName','arguments','error']),status:transient.has(message.status)?'interrupted':message.status||'complete'}))};}
function utf8(value,limit){let result=String(value??'');if(Buffer.byteLength(result)>limit){result=Buffer.from(result).subarray(0,limit).toString('utf8');if(Buffer.byteLength(result)>limit)result=result.slice(0,-1);}return result;}
function delay(ms,signal){if(signal?.aborted)return Promise.resolve();return new Promise(resolve=>{const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);resolve();},timer=setTimeout(done,ms);signal?.addEventListener('abort',done,{once:true});});}
