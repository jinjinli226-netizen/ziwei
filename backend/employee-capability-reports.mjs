import {createHash,randomUUID} from 'node:crypto';
import {redactSecrets} from '../src/redaction.mjs';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const invalid=()=>{throw Object.assign(Error('EMPLOYEE_CAPABILITY_REPORT_INVALID'),{code:'EMPLOYEE_CAPABILITY_REPORT_INVALID',status:400});};
const binding=['workspaceId','employeeId','ownerUserId','deviceId','runtime','profile'];
const fields=['kind','id','name','description','version','command','status','evidenceActionId'];
const text=(value,max)=>{
 if(typeof value!=='string'||!value.trim()||value.length>max)invalid();
 return redactSecrets(value).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/https?:\/\/\S+/gi,'[link]').replace(/(?:[A-Za-z]:[\\/]|\/(?:home|Users|tmp|etc)\/)[^\s]+/g,'[path]');
};

export function createEmployeeCapabilityReports(db,{now=Date.now}={}){
 function read(subject){
  const rows=db.prepare('SELECT * FROM employee_capability_reports WHERE workspace_id=? AND employee_id=? ORDER BY rowid DESC').all(subject.workspaceId,subject.employeeId),seen=new Set(),entries=[];
  for(const row of rows){
   const original=JSON.parse(row.subject_json);if(binding.some(key=>original[key]!==subject[key]))continue;
   for(const item of JSON.parse(row.entries_json)){
    const key=item.kind+':'+item.id;if(seen.has(key))continue;seen.add(key);
    if(item.status==='removed')continue;
    entries.push({...item,source:'agent_reported',verified:false,reportId:row.id,reportedAt:row.created_at,stale:original.configFingerprint!==subject.configFingerprint});
    if(entries.length===300)return entries;
   }
  }
  return entries;
 }
 function save(subject,input,context){
  const entries=normalize(input,subject),requestKey=hash([context.actorUserId||null,context.deviceScope||null,input.idempotencyKey]),fingerprint=hash(entries);
  const old=db.prepare('SELECT id,fingerprint FROM employee_capability_reports WHERE workspace_id=? AND employee_id=? AND request_key=?').get(subject.workspaceId,subject.employeeId,requestKey);
  if(old){if(old.fingerprint!==fingerprint)throw Object.assign(Error('IDEMPOTENCY_CONFLICT'),{code:'IDEMPOTENCY_CONFLICT',status:409});return{id:old.id,source:'agent_reported',duplicate:true,reported:read(subject)};}
  const id='capability-report_'+randomUUID(),createdAt=new Date(now()).toISOString();
  db.prepare('INSERT INTO employee_capability_reports(id,workspace_id,employee_id,subject_json,entries_json,actor_user_id,request_key,fingerprint,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,subject.workspaceId,subject.employeeId,JSON.stringify(subject),JSON.stringify(entries),context.actorUserId||null,requestKey,fingerprint,createdAt);
  return{id,source:'agent_reported',duplicate:false,reported:read(subject)};
 }
 function normalize(input,subject){
  if(!input||Array.isArray(input)||Object.keys(input).some(key=>!['entries','idempotencyKey'].includes(key))||typeof input.idempotencyKey!=='string'||!/^[-A-Za-z0-9_.:]{1,128}$/.test(input.idempotencyKey)||!Array.isArray(input.entries)||!input.entries.length||input.entries.length>100)invalid();
  const seen=new Set();
  return input.entries.map(item=>{
   if(!item||Array.isArray(item)||Object.keys(item).some(key=>!fields.includes(key))||!['skill','mcp','cli'].includes(item.kind)||typeof item.id!=='string'||!/^[-A-Za-z0-9_.:/]{1,160}$/.test(item.id)||!['declared','working','failed','removed'].includes(item.status))invalid();
   const key=item.kind+':'+item.id;if(seen.has(key))invalid();seen.add(key);
   const entry={kind:item.kind,id:item.id,name:text(item.name,160),status:item.status};
   for(const [key,max]of [['description',500],['version',40],['command',100]])if(item[key]!==undefined)entry[key]=text(item[key],max);
   if(entry.command&&!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(entry.command))invalid();
   if(item.evidenceActionId!==undefined){
    if(typeof item.evidenceActionId!=='string'||item.evidenceActionId.length>200)invalid();
    const action=db.prepare('SELECT workspace_id,status,payload_json FROM a2a_actions WHERE id=?').get(item.evidenceActionId),payload=action?JSON.parse(action.payload_json):null;
    if(!action||action.workspace_id!==subject.workspaceId||!['succeeded','failed'].includes(action.status)||payload.employeeId!==subject.employeeId||payload.deviceId!==subject.deviceId||(payload.profile??null)!==subject.profile)invalid();
    entry.evidenceActionId=item.evidenceActionId;
   }
   return entry;
  });
 }
 return{read,save};
}
