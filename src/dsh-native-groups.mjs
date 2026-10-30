import {DSH_NATIVE_TYPE} from './dsh-native-contract.mjs';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const allowedFields={list:[],get:['groupId'],create:['title','memberEmployeeIds'],update:['groupId','title','memberEmployeeIds'],delete:['groupId']};

export async function executeDshNativeGroupMetadata(action,{request}={}){
 const payload=action?.payload,op=payload?.dshOperation,subject=op?.subject,scope=op?.scope;
 if(action?.type!==DSH_NATIVE_TYPE||op?.schemaVersion!==1||op.resource!=='groups'||!object(subject)||subject.runtime!=='DSH'||payload.workspace!==subject.workspace||payload.workspaceId!==subject.workspaceId||payload.deviceId!==subject.deviceId||!object(scope)||typeof request!=='function')fail('DSH_NATIVE_GROUP_SUBJECT_INVALID');
 const {operation,input={},groupMembers}=op;
 if(!Object.hasOwn(allowedFields,operation))fail('DSH_NATIVE_OPERATION_UNSUPPORTED');
 if(!object(input)||Object.keys(input).some(key=>!allowedFields[operation].includes(key)))fail('DSH_NATIVE_GROUP_INPUT_INVALID');
 if(!Array.isArray(groupMembers)||!groupMembers.some(member=>member.employeeId===subject.employeeId&&member.profile===subject.profile))fail('DSH_NATIVE_GROUP_SUBJECT_INVALID');
 const employees=new Map(groupMembers.map(member=>[member.employeeId,member.profile])),profiles=new Set(groupMembers.map(member=>member.profile));
 const botScope=['list','create'].includes(operation);
 if(botScope?scope.kind!=='bot':scope.kind!=='group'||scope.groupId!==input.groupId||typeof input.groupId!=='string'||!input.groupId)fail('DSH_NATIVE_GROUP_SCOPE_CHANGED');
 let desiredMembers;
 if(input.memberEmployeeIds!==undefined){
  const ids=input.memberEmployeeIds;
  if(!Array.isArray(ids)||ids.length<2||ids.length>6||new Set(ids).size!==ids.length||!ids.includes(subject.employeeId))fail('DSH_NATIVE_GROUP_MEMBERS_INVALID');
  desiredMembers=ids.map(id=>employees.get(id));
  if(desiredMembers.some(profile=>typeof profile!=='string')||new Set(desiredMembers).size!==desiredMembers.length)fail('DSH_NATIVE_GROUP_MEMBERS_INVALID');
 }
 if(operation==='create'&&!desiredMembers)fail('DSH_NATIVE_GROUP_MEMBERS_INVALID');
 const visible=group=>object(group)&&Array.isArray(group.members)&&group.members.length>=2&&group.members.length<=6&&new Set(group.members).size===group.members.length&&group.members.includes(subject.profile)&&group.members.every(member=>profiles.has(member));
 const result=(status,data)=>({status,data,observations:{groups:{status:'observed',data}}});
 let mutationSent=false,writeAccepted=false,groupId=input.groupId;
 const call=async(method,path,body)=>{
  if(method!=='GET')mutationSent=true;
  const value=await request(method,path,body);
  if(value?.ok===false)fail('DSH_NATIVE_GROUP_REQUEST_FAILED');
  if(method!=='GET')writeAccepted=true;
  return value;
 };
 const readList=async()=>{
  const value=await call('GET','/api/groups');
  if(!Array.isArray(value.items))fail('DSH_NATIVE_GROUP_RESPONSE_INVALID');
  return value.items;
 };
 const readGroup=async id=>{
  const value=await call('GET',`/api/groups/${encodeURIComponent(id)}`),item=value.item||value;
  if(item.id!==id||!visible(item))fail('DSH_NATIVE_GROUP_FORBIDDEN');
  return item;
 };
 try{
  if(operation==='list')return result('observed',{items:(await readList()).filter(visible).map(groupView),sourceOperation:operation});
  if(operation==='get')return result('observed',{item:groupView(await readGroup(groupId)),sourceOperation:operation});
  if(operation!=='create')await readGroup(groupId);
  if(operation==='delete'){
   await call('DELETE',`/api/groups/${encodeURIComponent(groupId)}`);
   const remaining=await readList(),data={deletedId:groupId,items:remaining.filter(visible).map(groupView),sourceOperation:operation};
   return result(remaining.some(group=>group.id===groupId)?'unknown':'applied',data);
  }
  const body={...(input.title!==undefined?{title:input.title}:{}),...(desiredMembers?{members:desiredMembers}:{})};
  if(operation==='create'){
   const written=await call('POST','/api/groups',body),item=written.item||written;
   if(typeof item.id!=='string'||!item.id)fail('DSH_NATIVE_GROUP_RESPONSE_INVALID');
   groupId=item.id;
  }else await call('PUT',`/api/groups/${encodeURIComponent(groupId)}`,body);
  const observed=await readGroup(groupId),data={item:groupView(observed),sourceOperation:operation};
  return result(Object.entries(body).every(([key,value])=>same(observed[key],value))?'applied':'unknown',data);
 }catch(error){
  if(!mutationSent)throw error;
  return{status:'unknown',reasonCode:'DSH_NATIVE_GROUP_OUTCOME_UNKNOWN',data:{...(groupId?{groupId}:{}),writeAccepted,error:{code:'DSH_NATIVE_GROUP_OUTCOME_UNKNOWN'}}};
 }
}

function groupView(group){
 const members=[...group.members],transient=new Set(['streaming','running','sending','queued','approval']);
 return{...pick(group,['id','title','createdAt','updatedAt']),members,
  sessions:Object.fromEntries(Object.entries(group.sessions||{}).filter(([profile,session])=>members.includes(profile)&&typeof session==='string')),
  messages:(group.messages||[]).map(message=>({...pick(message,['id','role','text','botName','botDisplayName','toolName','arguments','error']),status:transient.has(message.status)?'interrupted':message.status||'complete'})),
 };
}
