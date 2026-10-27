import {createHash,randomUUID} from 'node:crypto';
import {BOT_INTERNAL} from './bots.mjs';
import {redactSecrets} from '../src/redaction.mjs';

export const EMPLOYEE_CAPABILITY_INSPECTION_FEATURE='employee_capabilities_inspect_v2';
export const EMPLOYEE_CAPABILITY_INSPECTION_TYPE='employee.capabilities.inspect';
const parse=(value,fallback=null)=>{try{return JSON.parse(value)??fallback;}catch{return fallback;}};
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b))):item);
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const same=(a,b)=>canonical(a)===canonical(b);
const fail=(code,status=409)=>{throw Object.assign(new Error(code),{code,status});};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const supportsInspection=device=>{const features=parse(device?.runtime_discovery_json,{})?.features;return Array.isArray(features)&&features.includes(EMPLOYEE_CAPABILITY_INSPECTION_FEATURE);};
const safeText=(value,max=200)=>typeof value==='string'?redactSecrets(value).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/https?:\/\/\S+/gi,'[link]').replace(/\b(?:sk-|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{8,}/g,'[REDACTED]').replace(/\b[A-Za-z0-9_+/-]{40,}={0,2}\b/g,'[REDACTED]').replace(/(?:[A-Za-z]:[\\/]|\/(?:home|Users|tmp|etc)\/)[^\s]+/g,'[path]').slice(0,max):null;

export function employeeCapabilitySubject(db,workspaceId,employeeId){
 const employee=db.prepare("SELECT * FROM employees WHERE id=? AND workspace_id=? AND status<>'deleted'").get(employeeId,workspaceId);
 if(!employee)fail('EMPLOYEE_NOT_FOUND',404);
 const workspace=db.prepare('SELECT slug FROM workspaces WHERE id=?').get(workspaceId);
 if(!workspace)fail('WORKSPACE_NOT_FOUND',404);
 const bot=employee.runtime==='Hermes'?db.prepare('SELECT revision,control_epoch,config_json,profile_binding_json FROM hermes_bots WHERE employee_id=? AND workspace_id=?').get(employeeId,workspaceId):null;
 const rawAssignedSkills=parse(employee.skills_json,[]),assignedSkills=Array.isArray(rawAssignedSkills)?rawAssignedSkills.filter(value=>typeof value==='string'):[];
 const config={runtime:employee.runtime,profile:employee.runtime_profile||null,deviceId:employee.target_device_id||null,model:employee.model_id||null,skills:assignedSkills,skillVersions:db.prepare('SELECT id,installed,version,content_hash,validation_status FROM skills WHERE workspace_id=? ORDER BY id').all(workspaceId).filter(row=>assignedSkills.includes(row.id)),managementEnabled:employee.management_mcp_enabled!==0,status:employee.status,visibility:employee.visibility,defaultDirectory:employee.default_working_directory||null,directoryDevice:employee.default_working_directory_device_id||null,botConfig:parse(bot?.config_json),botProfile:parse(bot?.profile_binding_json),environment:db.prepare('SELECT key,sensitive,updated_at FROM employee_environment_variables WHERE employee_id=? ORDER BY key').all(employeeId),customParams:db.prepare('SELECT key,updated_at FROM employee_custom_params WHERE employee_id=? ORDER BY key').all(employeeId)};
 return{workspace:workspace.slug,workspaceId,employeeId,ownerUserId:employee.owner_user_id||null,deviceId:employee.target_device_id||null,runtime:employee.runtime||null,profile:employee.runtime_profile||null,revision:bot?.revision??null,controlEpoch:bot?.control_epoch??null,configFingerprint:digest(config)};
}

// Apply the same current membership, personal visibility and device-owner
// predicates to cached reads and the original requester's later execution.
export function assertEmployeeCapabilityAuthority(db,workspaceId,current,requester){
 if(!object(requester))fail('EMPLOYEE_CAPABILITIES_AUTHORITY_UNKNOWN',403);
 if(requester.deviceScope&&requester.deviceScope!==current.deviceId)fail('DEVICE_SCOPE_MISMATCH',403);
 if(requester.userId){
  const member=db.prepare('SELECT role FROM members WHERE workspace_id=? AND user_id=?').get(workspaceId,requester.userId);
  if(!member)fail('EMPLOYEE_CAPABILITIES_AUTHORITY_REVOKED',403);
  const role=['owner','admin'].includes(member.role)&&['owner','admin'].includes(requester.role)?member.role:'member';
  const privileged=['owner','admin'].includes(role),employee=db.prepare('SELECT visibility,owner_user_id FROM employees WHERE id=? AND workspace_id=?').get(current.employeeId,workspaceId);
  if(!employee||employee.visibility==='personal'&&employee.owner_user_id!==requester.userId&&!privileged)fail('EMPLOYEE_CAPABILITIES_AUTHORITY_REVOKED',403);
  const workspace=db.prepare('SELECT kind FROM workspaces WHERE id=?').get(workspaceId);
  const device=current.deviceId?db.prepare('SELECT owner_user_id FROM devices WHERE id=? AND workspace_id=?').get(current.deviceId,workspaceId):null;
  if(device&&workspace?.kind!=='team'&&!privileged&&device.owner_user_id!==requester.userId)fail('EMPLOYEE_CAPABILITIES_AUTHORITY_REVOKED',403);
 }else if(!['owner','admin'].includes(requester.role)&&!requester.deviceScope)fail('EMPLOYEE_CAPABILITIES_AUTHORITY_UNKNOWN',403);
}

// Shared by create, ACK, device admission and readback. No writes, runtime
// startup, profile initialization or process/model probing belong in this helper.
export function assertEmployeeCapabilitySubject(db,workspaceId,payload){
 const inspection=payload?.capabilityInspection;
 if(!object(inspection)||inspection.schemaVersion!==1||!object(inspection.subject))fail('EMPLOYEE_CAPABILITIES_SUBJECT_INVALID');
 const current=employeeCapabilitySubject(db,workspaceId,inspection.subject.employeeId);
 if(!same(current,inspection.subject)||payload.workspace!==current.workspace||payload.workspaceId!==workspaceId||payload.deviceId!==current.deviceId||payload.runtime!==current.runtime||(payload.profile??null)!==current.profile)fail('EMPLOYEE_CAPABILITIES_SUBJECT_CHANGED');
 if(!current.deviceId)fail('EMPLOYEE_CAPABILITIES_DEVICE_UNKNOWN');
 const device=db.prepare('SELECT status,runtime_discovery_json FROM devices WHERE id=? AND workspace_id=?').get(current.deviceId,workspaceId);
 if(!device||device.status==='disabled')fail('EMPLOYEE_CAPABILITIES_DEVICE_REVOKED',403);
 if(!supportsInspection(device))fail('EMPLOYEE_CAPABILITIES_CLIENT_NOT_REPORTED');
 const deviceCredential=db.prepare('SELECT revoked_at FROM device_credentials WHERE device_id=? AND workspace_id=?').get(current.deviceId,workspaceId);
 if(deviceCredential?.revoked_at)fail('EMPLOYEE_CAPABILITIES_DEVICE_REVOKED',403);
 const requester=inspection.requestedBy;
 if(!object(requester))fail('EMPLOYEE_CAPABILITIES_AUTHORITY_UNKNOWN',403);
 if((requester.userId||null)!==(payload.userId||null))fail('EMPLOYEE_CAPABILITIES_AUTHORITY_CHANGED',403);
 assertEmployeeCapabilityAuthority(db,workspaceId,current,requester);
 return current;
}

const states=new Set(['available','configured','installed','loaded','ready','disabled','unknown','not_installed','not_configured','not_loaded','requires_auth','needs_auth','requires_authorization','authorization_required','unsupported','forbidden','pending','error','unavailable','missing','empty','partial','blocked']);
const status=value=>states.has(value)?value:'unknown';
function projectItem(item){
 if(!object(item))return null;
 const name=safeText(item.name||item.id,200);if(!name)return null;
 const out={name,status:status(item.status)};
 for(const key of ['id','type','source','version','reason','description'])if(typeof item[key]==='string')out[key]=safeText(item[key],key==='description'?500:200);
 if(['@ziwei/team-planner-cli','@larksuite/cli','@ziwei/workspace-cli','@qzelynth/bkl','@qzelynth/ziwei-memory-cli'].includes(item.packageName))out.packageName=item.packageName;
 if(['stdio','http','sse','unknown'].includes(item.transport))out.transport=item.transport;
 for(const key of ['enabled','configured','installed','loaded','available'])if(typeof item[key]==='boolean')out[key]=item[key];
 const layers={installation:['installed','missing','unknown'],visibility:['visible','not_visible','unknown'],configuration:['configured','not_configured','unknown','not_applicable'],assigned:['assigned','not_assigned','unknown'],enabled:['enabled','disabled','unknown'],onDemand:['available','unavailable','unknown'],authorization:['authorized','denied','authorization_required','unknown'],loaded:['loaded','not_loaded','unknown']};
 for(const[key,allowed]of Object.entries(layers))if(typeof item[key]==='string')out[key]=allowed.includes(item[key])?item[key]:'unknown';
 if(typeof item.hash==='string'&&/^[a-fA-F0-9]{64}$/.test(item.hash))out.hash=item.hash;
 if(Array.isArray(item.tools))out.tools=item.tools.slice(0,200).filter(object).map(tool=>({name:safeText(tool.name,200),...(typeof tool.description==='string'?{description:safeText(tool.description,500)}:{})})).filter(tool=>tool.name);
 return out;
}
function projectSections(sections){
 if(!object(sections)||!['skills','mcp','cli'].every(key=>object(sections[key])&&Array.isArray(sections[key].items)))return null;
 return Object.fromEntries(['skills','mcp','cli'].map(key=>{const section=sections[key];return[key,{status:status(section.status),reason:section.reason===null?null:safeText(section.reason,300)||'UNKNOWN',items:section.items.slice(0,300).map(projectItem).filter(Boolean)}];}));
}
const unknownSections=reason=>Object.fromEntries(['skills','mcp','cli'].map(key=>[key,{status:'unknown',reason,items:[]}]));
const sectionSummary=sections=>Object.fromEntries(['skills','mcp','cli'].map(key=>[key,sections[key]?.status==='ready'?sections[key].items.length:null]));

export function createEmployeeCapabilityInventory(repo,{management,now=Date.now,ttlMs=300000,actionTimeoutMs=60000}={}){
 const db=repo.db;if(!management?.employee)throw Error('Employee inventory requires scoped management service');
 function scoped(slug,id,context){
  const employee=management.employee(slug,id,context);
  const ws=db.prepare('SELECT * FROM workspaces WHERE id=? AND slug=?').get(employee.workspace_id,slug);if(!ws)fail('EMPLOYEE_NOT_FOUND',404);
  const device=employee.target_device_id?db.prepare('SELECT * FROM devices WHERE id=? AND workspace_id=?').get(employee.target_device_id,ws.id):null;
  const subject=employeeCapabilitySubject(db,ws.id,id);
  assertEmployeeCapabilityAuthority(db,ws.id,subject,{userId:context.actorUserId||null,role:context.actorRole||'owner',deviceScope:context.deviceScope||null});
  return{employee,ws,device,subject};
 }
 const rowsFor=(ws,id)=>db.prepare("SELECT * FROM a2a_actions WHERE workspace_id=? AND type=? AND json_valid(payload_json) AND json_extract(payload_json,'$.capabilityInspection.subject.employeeId')=? ORDER BY rowid DESC LIMIT 50").all(ws.id,EMPLOYEE_CAPABILITY_INSPECTION_TYPE,id);
 function deviceReason(device){
  if(!device)return'DEVICE_UNASSIGNED';if(device.status==='disabled')return'DEVICE_REVOKED';
  const credential=db.prepare('SELECT revoked_at FROM device_credentials WHERE device_id=? AND workspace_id=?').get(device.id,device.workspace_id);if(credential?.revoked_at)return'DEVICE_REVOKED';
  const seen=Date.parse(device.last_seen||device.heartbeat_at||'');if(device.status!=='online'||!Number.isFinite(seen)||now()-seen>Math.max(45000,Number(device.heartbeat_interval_ms||10000)*4))return'DEVICE_OFFLINE';
  if(!supportsInspection(device))return'CLIENT_NOT_REPORTED';return null;
 }
 function receipt(row){
  if(row.status!=='succeeded'||typeof row.result_json!=='string'||row.result_json.length>524288)return null;
  const payload=parse(row.payload_json),result=parse(row.result_json),value=result?.employeeCapabilities||result?.result?.employeeCapabilities;
  if(!object(value)||value.schemaVersion!==1||value.source!=='device_readonly'||!same(value.subject,payload?.capabilityInspection?.subject))return null;
  const at=Date.parse(value.checkedAt),created=Date.parse(row.created_at),expires=Date.parse(row.expires_at),completed=Date.parse(row.completed_at);
  if(!Number.isFinite(at)||at<created-30000||at>now()+30000)return null;
  const sections=projectSections(value.sections);if(!sections)return null;
  return{schemaVersion:1,subject:value.subject,source:'device_readonly',checkedAt:new Date(at).toISOString(),sections,summary:sectionSummary(sections),late:!Number.isFinite(completed)||completed>expires||at>expires,actionId:row.id};
 }
 function read(slug,id,context,subjectData){
  const data=subjectData||scoped(slug,id,context),{ws,device,subject}=data;
  // Ownership transfer is a privacy boundary, not merely a stale config. A new
  // owner must never receive the previous owner's personal inventory or even
  // its pending/failed request metadata through the history fallback.
  const rows=rowsFor(ws,id).filter(row=>{const saved=parse(row.payload_json)?.capabilityInspection?.subject;return saved?.workspaceId===subject.workspaceId&&saved?.employeeId===subject.employeeId&&(saved?.ownerUserId??null)===subject.ownerUserId;});
  const deviceIssue=deviceReason(device),latest=rows[0]||null;
  const snapshots=rows.map(receipt).filter(Boolean);let snapshot=snapshots.find(s=>same(s.subject,subject)&&!s.late)||snapshots.find(s=>!s.late)||snapshots[0]||null;
  const pendingRow=rows.find(row=>['pending','acked'].includes(row.status)&&same(parse(row.payload_json)?.capabilityInspection?.subject,subject)&&Date.parse(row.expires_at)>now());
  let pending=null,reason=deviceIssue;
  if(pendingRow&&!deviceIssue){try{assertEmployeeCapabilitySubject(db,ws.id,parse(pendingRow.payload_json));pending={actionId:pendingRow.id,status:pendingRow.status,expiresAt:pendingRow.expires_at};}catch{reason='AUTHORITY_REVOKED';}}
  let fresh=Boolean(snapshot&&!snapshot.late&&same(snapshot.subject,subject)&&now()-Date.parse(snapshot.checkedAt)<=ttlMs&&!deviceIssue);
  if(fresh){const raw=rows.find(row=>row.id===snapshot.actionId);try{assertEmployeeCapabilitySubject(db,ws.id,parse(raw.payload_json));}catch{fresh=false;reason='AUTHORITY_REVOKED';}}
  const matchingLatest=latest&&same(parse(latest.payload_json)?.capabilityInspection?.subject,subject);
  const attemptReason=!matchingLatest?null:latest.status==='failed'?'INSPECTION_FAILED':latest.status==='expired'||['pending','acked'].includes(latest.status)&&Date.parse(latest.expires_at)<=now()?'INSPECTION_TIMEOUT':latest.status==='succeeded'&&!receipt(latest)?'INSPECTION_RECEIPT_INVALID':null;
  if(attemptReason){fresh=false;if(!reason)reason=attemptReason;}
  if(!fresh&&!reason){
   if(snapshot&&!same(snapshot.subject,subject))reason='CONFIGURATION_CHANGED';
   else if(snapshot?.late)reason='LATE_RECEIPT';
   else if(snapshot&&now()-Date.parse(snapshot.checkedAt)>ttlMs)reason='SNAPSHOT_EXPIRED';
   else if(latest&&same(parse(latest.payload_json)?.capabilityInspection?.subject,subject)&&(['expired','failed'].includes(latest.status)||Date.parse(latest.expires_at)<=now()))reason=latest.status==='failed'?'INSPECTION_FAILED':'INSPECTION_TIMEOUT';
   else reason='NOT_REPORTED';
  }
  const sections=fresh?snapshot.sections:unknownSections(reason||'REFRESH_PENDING');
  const summary=fresh?sectionSummary(sections):{skills:null,mcp:null,cli:null};
  const lastAttempt=latest?{actionId:latest.id,status:latest.status,createdAt:latest.created_at,completedAt:latest.completed_at||null,reasonCode:attemptReason}:null;
  return{schemaVersion:1,workspace:slug,employeeId:id,subject,status:pending?'pending':fresh?'ready':'unknown',reasonCode:pending?'REFRESH_PENDING':fresh?null:reason,stale:Boolean(snapshot&&!fresh),snapshot:snapshot?{...snapshot,stale:!fresh}:null,sections,pending,summary,lastAttempt,countsAreObserved:true};
 }
 function get(slug,id,context={}){return read(slug,id,context);}
 function refresh(slug,id,input={},context={}){
  if(!object(input)||Object.keys(input).some(key=>key!=='idempotencyKey')||input.idempotencyKey!==undefined&&(typeof input.idempotencyKey!=='string'||!/^[-A-Za-z0-9_.:]{1,128}$/.test(input.idempotencyKey)))fail('EMPLOYEE_CAPABILITIES_INPUT_INVALID',400);
  const data=scoped(slug,id,context),before=read(slug,id,context,data);if(before.pending)return{...before,duplicate:true};
  if(deviceReason(data.device))return before;
  const{employee,ws,subject}=data,bot=employee.runtime==='Hermes'?db.prepare('SELECT config_json FROM hermes_bots WHERE employee_id=? AND workspace_id=?').get(id,ws.id):null,config=parse(bot?.config_json,{});
  const metadata={skills:Array.isArray(employee.skills)?employee.skills.filter(value=>typeof value==='string').slice(0,300):[],disabledSkills:Array.isArray(config.skills?.disabled)?config.skills.disabled.filter(value=>typeof value==='string').slice(0,300):[],mcpServers:Object.entries(config.mcpServers||{}).filter(([,value])=>object(value)).slice(0,200).map(([name,value])=>({name,enabled:value.enabled!==false,transport:typeof value.command==='string'?'stdio':'http'})),toolsets:Array.isArray(config.toolsets)?config.toolsets:[],permissionMode:config.permissions?.mode||null,managementEnabled:employee.management_mcp_enabled!==0&&config.permissions?.management!==false};
  const runtimeContext={cwd:employee.default_working_directory_device_id===employee.target_device_id?employee.default_working_directory||null:null};
  const key=input.idempotencyKey||randomUUID(),payload={workspace:slug,workspaceId:ws.id,userId:context.actorUserId||null,deviceId:subject.deviceId,runtime:subject.runtime,profile:subject.profile,capabilityInspection:{schemaVersion:1,subject,config:metadata,runtimeContext,requestedBy:{userId:context.actorUserId||null,role:context.actorRole||'owner',deviceScope:context.deviceScope||null}}};
  assertEmployeeCapabilitySubject(db,ws.id,payload);
  repo.createA2AAction(slug,{agentId:'ziwei_user',type:EMPLOYEE_CAPABILITY_INSPECTION_TYPE,botInternal:BOT_INTERNAL,dedupeKey:`employee-capabilities:${id}:${digest(subject)}:${digest(key)}`,expiresAt:new Date(now()+actionTimeoutMs).toISOString(),payload});
  return read(slug,id,context,data);
 }
 return{get,refresh};
}
