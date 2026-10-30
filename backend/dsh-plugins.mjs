import {createHash,randomUUID} from 'node:crypto';
import {BOT_INTERNAL} from './bots.mjs';
import {employeeCapabilitySubject,assertEmployeeCapabilityAuthority} from './employee-capability-inventory.mjs';
import {redactSecrets} from '../src/redaction.mjs';

export const DSH_PLUGINS_FEATURE='dsh_plugins_v1';
export const DSH_PLUGIN_ACTIONS=['employee.plugins.inspect','employee.plugins.apply'];
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
const canonical=value=>JSON.stringify(value,(_key,item)=>object(item)?Object.fromEntries(Object.entries(item).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b))):item);
const same=(a,b)=>canonical(a)===canonical(b);
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const fail=(code,status=409)=>{throw Object.assign(new Error(code),{code,status});};
const supports=device=>{const features=parse(device?.runtime_discovery_json)?.features;return Array.isArray(features)&&features.includes(DSH_PLUGINS_FEATURE);};
const safeText=(value,max=300)=>typeof value==='string'?redactSecrets(value).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/https?:\/\/\S+/gi,'[link]').replace(/\b(?:sk-|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{8,}/g,'[REDACTED]').replace(/\b[A-Za-z0-9_+/-]{40,}={0,2}\b/g,'[REDACTED]').replace(/(?:[A-Za-z]:[\\/]|\/(?:home|Users|tmp|etc)\/)[^\s]+/g,'[path]').slice(0,max):null;
const requester=context=>({userId:context.actorUserId||null,role:context.actorRole||'owner',deviceScope:context.deviceScope||null});
function assertDshBinding(db,workspaceId,subject){
 if(subject.runtime!=='DSH')fail('DSH_PLUGINS_RUNTIME_UNSUPPORTED',400);
 if(typeof subject.profile!=='string'||!/^[a-z0-9][a-z0-9-]{0,23}$/.test(subject.profile))fail('DSH_PLUGINS_PROFILE_INVALID',400);
 const metadata=db.prepare("SELECT profiles_json FROM runtime_device_metadata WHERE workspace_id=? AND device_id=? AND runtime_name='DSH'").get(workspaceId,subject.deviceId);
 if(!(parse(metadata?.profiles_json)||[]).some(profile=>profile.name===subject.profile))fail('DSH_PLUGINS_PROFILE_NOT_DISCOVERED');
}
export function assertDshPluginsSubject(db,workspaceId,payload){
 const operation=payload?.pluginOperation;
 if(!object(operation)||operation.schemaVersion!==1||!object(operation.subject)||!['inspect','apply'].includes(operation.operation))fail('DSH_PLUGINS_SUBJECT_INVALID');
 const current=employeeCapabilitySubject(db,workspaceId,operation.subject.employeeId);
 if(!same(current,operation.subject)||payload.workspace!==current.workspace||payload.workspaceId!==workspaceId||payload.deviceId!==current.deviceId||payload.runtime!==undefined||payload.employeeId!==undefined)fail('DSH_PLUGINS_SUBJECT_CHANGED');
 assertDshBinding(db,workspaceId,current);
 const device=db.prepare('SELECT status,runtime_discovery_json FROM devices WHERE id=? AND workspace_id=?').get(current.deviceId,workspaceId);
 const credential=db.prepare('SELECT revoked_at FROM device_credentials WHERE device_id=? AND workspace_id=?').get(current.deviceId,workspaceId);
 if(!device||device.status==='disabled'||credential?.revoked_at)fail('DSH_PLUGINS_DEVICE_REVOKED',403);
 if(!supports(device))fail('DSH_PLUGINS_CLIENT_NOT_REPORTED');
 if(!object(operation.requestedBy)||(operation.requestedBy.userId||null)!==(payload.userId||null))fail('DSH_PLUGINS_AUTHORITY_CHANGED',403);
 assertEmployeeCapabilityAuthority(db,workspaceId,current,operation.requestedBy);
 return current;
}
function projectSchema(schema,depth=0){
 if(typeof schema==='boolean')return schema;
 if(!object(schema)||depth>12)return {};
 const out={};
 for(const key of ['uid','inner','sKey'])if(typeof schema[key]==='number'&&Number.isFinite(schema[key])||typeof schema[key]==='string')out[key]=typeof schema[key]==='string'?safeText(schema[key],200):schema[key];
 if(object(schema.refs))out.refs=Object.fromEntries(Object.entries(schema.refs).slice(0,1000).filter(([key])=>/^\d+$/.test(key)).map(([key,value])=>[key,projectSchema(value,depth+1)]));
 if(object(schema.dict))out.dict=Object.fromEntries(Object.entries(schema.dict).slice(0,200).filter(([,value])=>typeof value==='number'&&Number.isFinite(value)||typeof value==='string').map(([key,value])=>[safeText(key,200),typeof value==='string'?safeText(value,200):value]));
 if(Array.isArray(schema.list))out.list=schema.list.slice(0,200).filter(value=>typeof value==='number'&&Number.isFinite(value)||typeof value==='string').map(value=>typeof value==='string'?safeText(value,200):value);
 if(schema.type==='const'&&(schema.value===null||['string','number','boolean'].includes(typeof schema.value)))out.value=typeof schema.value==='string'?safeText(schema.value):schema.value;
 if(object(schema.meta)){
  out.meta={};
  for(const key of ['required'])if(typeof schema.meta[key]==='boolean')out.meta[key]=schema.meta[key];
  for(const key of ['min','max','step'])if(typeof schema.meta[key]==='number'&&Number.isFinite(schema.meta[key]))out.meta[key]=schema.meta[key];
  for(const key of ['description','role'])if(typeof schema.meta[key]==='string')out.meta[key]=safeText(schema.meta[key],key==='description'?800:200);
 }
 for(const key of ['type','title','description','format'])if(typeof schema[key]==='string')out[key]=safeText(schema[key],key==='description'?800:200);
 for(const key of ['minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf','minLength','maxLength','minItems','maxItems','minProperties','maxProperties'])if(typeof schema[key]==='number'&&Number.isFinite(schema[key]))out[key]=schema[key];
 for(const key of ['readOnly','writeOnly','uniqueItems'])if(typeof schema[key]==='boolean')out[key]=schema[key];
 if(Array.isArray(schema.enum))out.enum=schema.enum.slice(0,100).filter(value=>value===null||['string','number','boolean'].includes(typeof value)).map(value=>typeof value==='string'?safeText(value):value);
 if(Array.isArray(schema.required))out.required=schema.required.slice(0,200).filter(value=>typeof value==='string').map(value=>safeText(value,200));
 if(object(schema.properties))out.properties=Object.fromEntries(Object.entries(schema.properties).slice(0,200).map(([key,value])=>[safeText(key,200),projectSchema(value,depth+1)]));
 for(const key of ['items','additionalProperties'])if(typeof schema[key]==='boolean'||object(schema[key]))out[key]=projectSchema(schema[key],depth+1);
 for(const key of ['oneOf','anyOf','allOf'])if(Array.isArray(schema[key]))out[key]=schema[key].slice(0,30).map(value=>projectSchema(value,depth+1));
 return out;
}
const referenceFields=new Set(['id','entryId','moduleName','patchId','rowId']);
const nativeReference=value=>value.length<=240&&/^(?:@[a-z0-9._-]+\/)?[a-z0-9._:-]+$/i.test(value);
const textFields=(item,keys)=>Object.fromEntries(keys.filter(key=>typeof item[key]==='string').map(key=>{
 const value=item[key],reference=referenceFields.has(key)||key==='name'&&value.startsWith('@');
 return[key,reference&&nativeReference(value)?value:safeText(value)];
}));
function projectEntry(item){return object(item)?{...textFields(item,['entryId','moduleName','fiberPhase','patchId','rowId']),...(typeof item.enabled==='boolean'||item.enabled==='conditional'?{enabled:item.enabled}:{}),...(item.fiberPhase===null?{fiberPhase:null}:{})}:null;}
function projectRuntime(value){
 if(!object(value)||!['observed','unavailable'].includes(value.status))return{status:'unavailable',reasonCode:'NOT_OBSERVED'};
 const out={status:value.status};
 if(value.status==='unavailable'){out.reasonCode='RUNTIME_UNAVAILABLE';return out;}
 out.bundles=(Array.isArray(value.bundles)?value.bundles:[]).slice(0,300).filter(object).map(item=>({...textFields(item,['name']),...Object.fromEntries(['enabled','installed','optional','removable'].filter(key=>typeof item[key]==='boolean').map(key=>[key,item[key]])),...(['profile','installation','missing'].includes(item.availability)?{availability:item.availability}:{}),rows:(Array.isArray(item.rows)?item.rows:[]).slice(0,300).filter(object).map(row=>textFields(row,['rowId','moduleName','entryId']))}));
 out.entries=(Array.isArray(value.entries)?value.entries:[]).slice(0,1000).map(projectEntry).filter(Boolean);
 out.agentPresets=(Array.isArray(value.agentPresets)?value.agentPresets:[]).slice(0,100).filter(object).map(item=>({...textFields(item,['id']),isDefault:item.isDefault===true,rows:(Array.isArray(item.rows)?item.rows:[]).slice(0,1000).map(projectEntry).filter(Boolean)}));
 return out;
}
function projectConfiguration(value){
 if(!object(value)||!['available','unavailable'].includes(value.status))return{status:'unavailable',writable:false,namespaces:[]};
 return{status:value.status,writable:value.writable===true,...(value.schemaFormat==='schemastery'?{schemaFormat:'schemastery'}:{}),namespaces:(Array.isArray(value.namespaces)?value.namespaces:[]).slice(0,200).filter(item=>object(item)&&typeof item.ns==='string').map(item=>({ns:safeText(item.ns,200),...(typeof item.applies==='string'?{applies:safeText(item.applies,100)}:{}),schema:projectSchema(item.schema),...(typeof item.revision==='number'&&Number.isFinite(item.revision)||typeof item.revision==='string'?{revision:typeof item.revision==='string'?safeText(item.revision,200):item.revision}:{})}))};
}
function projectReceipt(value,subject){
 if(!object(value)||value.schemaVersion!==1||value.source!=='dsh-native'||!same(value.subject,subject)||!Array.isArray(value.plugins)||value.plugins.length>300||value.plugins.some(item=>!object(item)||typeof item.id!=='string'||typeof item.name!=='string'||typeof item.enabled!=='boolean'||typeof item.required!=='boolean'))return null;
 const at=Date.parse(value.checkedAt);if(!Number.isFinite(at))return null;
 return{schemaVersion:1,subject,source:'dsh-native',checkedAt:new Date(at).toISOString(),plugins:value.plugins.map(item=>({...textFields(item,['id','name','description']),enabled:item.enabled,required:item.required})),running:typeof value.running==='boolean'?value.running:null,ready:typeof value.ready==='boolean'?value.ready:null,restartRequired:value.restartRequired===true,notice:safeText(value.notice,800),runtime:projectRuntime(value.runtime),configuration:projectConfiguration(value.configuration)};
}
export function projectDshPluginsAction(action){
 if(!DSH_PLUGIN_ACTIONS.includes(action?.type))return action;
 const payload=action.payload,operation=payload.pluginOperation,receipt=action.status==='succeeded'?projectReceipt(action.result?.dshPlugins||action.result?.result?.dshPlugins,operation.subject):null;
 const out=Object.fromEntries(['id','task_id','agent_id','type','status','dedupe_key','created_at','acked_at','completed_at'].filter(key=>Object.hasOwn(action,key)).map(key=>[key,action[key]]));
 out.payload={workspace:payload.workspace,workspaceId:payload.workspaceId,userId:payload.userId||null,deviceId:payload.deviceId,pluginOperation:{schemaVersion:1,subject:operation.subject,operation:operation.operation,...(Array.isArray(operation.enabled)?{enabled:operation.enabled}:{})}};
 out.result=receipt?{dshPlugins:receipt}:null;out.error=action.error?'DSH_PLUGINS_OPERATION_FAILED':null;
 if(Array.isArray(action.events))out.events=action.events.map(event=>({id:event.id,action_id:action.id,type:['created','acked','progress','succeeded','failed','expired','cancelled'].includes(event.type)?event.type:'event',created_at:event.created_at}));
 return out;
}
export function createDshPluginsService(repo,{management,now=Date.now,ttlMs=300000,actionTimeoutMs=60000}={}){
 const db=repo.db;
 function scoped(slug,id,context){
  const employee=management.employee(slug,id,context),ws=db.prepare('SELECT * FROM workspaces WHERE id=? AND slug=?').get(employee.workspace_id,slug);if(!ws)fail('EMPLOYEE_NOT_FOUND',404);
  const subject=employeeCapabilitySubject(db,ws.id,id);assertEmployeeCapabilityAuthority(db,ws.id,subject,requester(context));assertDshBinding(db,ws.id,subject);
  return{ws,subject,device:db.prepare('SELECT * FROM devices WHERE id=? AND workspace_id=?').get(subject.deviceId,ws.id)};
 }
 function deviceReason(device){
  if(!device)return'DEVICE_UNASSIGNED';if(device.status==='disabled'||db.prepare('SELECT revoked_at FROM device_credentials WHERE device_id=? AND workspace_id=?').get(device.id,device.workspace_id)?.revoked_at)return'DEVICE_REVOKED';
  const seen=Date.parse(device.last_seen||'');if(device.status!=='online'||!Number.isFinite(seen)||now()-seen>Math.max(45000,Number(device.heartbeat_interval_ms||10000)*4))return'DEVICE_OFFLINE';
  return supports(device)?null:'CLIENT_NOT_REPORTED';
 }
 function receipt(row){
  if(row.status!=='succeeded'||typeof row.result_json!=='string'||row.result_json.length>1048576)return null;
  const payload=parse(row.payload_json),result=parse(row.result_json),value=projectReceipt(result?.dshPlugins||result?.result?.dshPlugins,payload?.pluginOperation?.subject);if(!value)return null;
  const at=Date.parse(value.checkedAt),created=Date.parse(row.created_at),expires=Date.parse(row.expires_at),completed=Date.parse(row.completed_at);
  if(at<created-30000||at>now()+30000)return null;
  return{...value,actionId:row.id,late:!Number.isFinite(completed)||completed>expires||at>expires};
 }
 function read(slug,id,context,data=scoped(slug,id,context)){
  const{ws,subject,device}=data,rows=db.prepare("SELECT * FROM a2a_actions WHERE workspace_id=? AND type IN (?,?) AND json_valid(payload_json) AND json_extract(payload_json,'$.pluginOperation.subject.employeeId')=? ORDER BY rowid DESC LIMIT 50").all(ws.id,...DSH_PLUGIN_ACTIONS,id).filter(row=>{const saved=parse(row.payload_json)?.pluginOperation?.subject;return saved?.workspaceId===subject.workspaceId&&(saved.ownerUserId??null)===subject.ownerUserId;}),latest=rows[0]||null;
  const snapshots=rows.map(receipt).filter(Boolean),snapshot=snapshots.find(item=>same(item.subject,subject)&&!item.late)||snapshots.find(item=>!item.late)||snapshots[0]||null;
  let reason=deviceReason(device),pending=null,fresh=Boolean(snapshot&&!snapshot.late&&same(snapshot.subject,subject)&&now()-Date.parse(snapshot.checkedAt)<=ttlMs&&!reason);
  const pendingRow=rows.find(row=>['pending','acked'].includes(row.status)&&Date.parse(row.expires_at)>now()&&same(parse(row.payload_json)?.pluginOperation?.subject,subject));
  if(pendingRow&&!reason){try{assertDshPluginsSubject(db,ws.id,parse(pendingRow.payload_json));pending={actionId:pendingRow.id,status:pendingRow.status,operation:parse(pendingRow.payload_json).pluginOperation.operation,expiresAt:pendingRow.expires_at};}catch{reason='AUTHORITY_REVOKED';}}
  if(fresh){try{assertDshPluginsSubject(db,ws.id,parse(rows.find(row=>row.id===snapshot.actionId).payload_json));}catch{fresh=false;reason='AUTHORITY_REVOKED';}}
  const matching=latest&&same(parse(latest.payload_json)?.pluginOperation?.subject,subject),latestReceipt=matching?receipt(latest):null,attemptReason=!matching?null:latest.status==='failed'?'OPERATION_FAILED':latest.status==='expired'||['pending','acked'].includes(latest.status)&&Date.parse(latest.expires_at)<=now()?'OPERATION_TIMEOUT':latest.status==='succeeded'?(!latestReceipt?'RECEIPT_INVALID':latestReceipt.late?'LATE_RECEIPT':null):null;
  if(attemptReason){fresh=false;reason ||=attemptReason;}
  if(!fresh&&!reason)reason=snapshot&&!same(snapshot.subject,subject)?'CONFIGURATION_CHANGED':snapshot?.late?'LATE_RECEIPT':snapshot?'SNAPSHOT_EXPIRED':'NOT_REPORTED';
  return{schemaVersion:1,workspace:slug,employeeId:id,subject,status:pending?'pending':fresh?'ready':'unknown',reasonCode:pending?'REFRESH_PENDING':fresh?null:reason,stale:Boolean(snapshot&&!fresh),plugins:fresh?snapshot.plugins:[],runtime:fresh?snapshot.runtime:{status:'unavailable',reasonCode:'NOT_OBSERVED'},configuration:fresh?snapshot.configuration:{status:'unavailable',writable:false,namespaces:[]},running:fresh?snapshot.running:null,ready:fresh?snapshot.ready:null,restartRequired:fresh?snapshot.restartRequired:null,notice:fresh?snapshot.notice:null,snapshot:snapshot?{...snapshot,stale:!fresh}:null,pending,lastAttempt:latest?{actionId:latest.id,status:latest.status,operation:parse(latest.payload_json)?.pluginOperation?.operation,createdAt:latest.created_at,completedAt:latest.completed_at||null,reasonCode:attemptReason}:null};
 }
 function queue(slug,id,input,context,operation){
  const apply=operation==='apply',allowed=apply?['idempotencyKey','enabled']:['idempotencyKey'];
  if(!object(input)||Object.keys(input).some(key=>!allowed.includes(key))||apply&&typeof input.idempotencyKey!=='string'||input.idempotencyKey!==undefined&&(typeof input.idempotencyKey!=='string'||!/^[-A-Za-z0-9_.:]{1,128}$/.test(input.idempotencyKey))||apply&&(!Array.isArray(input.enabled)||input.enabled.length>128||input.enabled.some(item=>typeof item!=='string'||!item||item.length>240||/[\u0000-\u001f\u007f]/.test(item))||new Set(input.enabled).size!==input.enabled.length))fail('DSH_PLUGINS_INPUT_INVALID',400);
  const data=scoped(slug,id,context),before=read(slug,id,context,data),key=input.idempotencyKey||randomUUID(),dedupeKey=`dsh-plugins:${id}:${operation}:${digest(key)}`;
  const previous=db.prepare('SELECT * FROM a2a_actions WHERE workspace_id=? AND dedupe_key=?').get(data.ws.id,dedupeKey);
  if(previous){
   const saved=parse(previous.payload_json)?.pluginOperation;
   if(apply&&!same(saved?.enabled,input.enabled))fail('IDEMPOTENCY_CONFLICT');
   if(!same(saved?.subject,data.subject))fail('DSH_PLUGINS_SUBJECT_CHANGED');
   return{...before,duplicate:true,actionId:previous.id};
  }
  if(before.pending){if(!apply&&before.pending.operation==='inspect')return{...before,duplicate:true};fail('DSH_PLUGINS_OPERATION_PENDING');}
  if(deviceReason(data.device))return before;
  if(apply){if(before.status!=='ready')fail('DSH_PLUGINS_REFRESH_REQUIRED');if(input.enabled.some(id=>!before.plugins.some(item=>item.id===id))||before.plugins.some(item=>item.required&&!input.enabled.includes(item.id)))fail('DSH_PLUGINS_ENABLED_INVALID',400);}
  const payload={workspace:slug,workspaceId:data.ws.id,userId:context.actorUserId||null,deviceId:data.subject.deviceId,pluginOperation:{schemaVersion:1,subject:data.subject,operation,...(apply?{enabled:input.enabled}:{}),requestedBy:requester(context)}};
  assertDshPluginsSubject(db,data.ws.id,payload);
  repo.createA2AAction(slug,{agentId:'ziwei_user',type:apply?DSH_PLUGIN_ACTIONS[1]:DSH_PLUGIN_ACTIONS[0],botInternal:BOT_INTERNAL,dedupeKey,expiresAt:new Date(now()+actionTimeoutMs).toISOString(),payload});
  return read(slug,id,context,data);
 }
 return{get:(slug,id,context={})=>read(slug,id,context),refresh:(slug,id,input={},context={})=>queue(slug,id,input,context,'inspect'),apply:(slug,id,input,context={})=>queue(slug,id,input,context,'apply')};
}
