import { randomUUID } from 'node:crypto';
import { fail, FORMAL_ISSUER, ROLES, rolesForSite, SITES, validateContext, uncertain } from './contract.mjs';
const table=(db,name)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
function transaction(db,run){db.exec('BEGIN IMMEDIATE');try{const result=run();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
const unknown=c=>uncertain(c);
const disabled=()=>fail(503,'NATIVE_PROVISIONING_NOT_CONFIGURED');

/** This gate is shared by online resolution and the two-database coordinator.
 * Identity-store markers survive an older business backup. A missing ledger
 * therefore denies a managed identity rather than reviving it. */
export function managedTeamBindingAllowed(db,identityDb,issuer,subject,nativeId){
 try{
  if(!table(identityDb,'member_enrollment_managed'))return true;
  const managed=identityDb.prepare('SELECT * FROM member_enrollment_managed WHERE issuer=? AND subject=?').get(issuer,subject);
  if(!managed)return true;
  if(!table(db,'member_enrollment_members'))return false;
  const row=db.prepare("SELECT * FROM member_enrollment_members WHERE site='collaboration' AND member_id=?").get(managed.member_id);
  return !!row&&row.issuer===issuer&&row.subject===subject&&row.native_id===nativeId&&managed.native_id===nativeId&&row.generation===managed.generation&&row.phase==='active';
 }catch{return false;}
}
export function managedWorkspaceBindingAllowed(db,issuer,subject,nativeUserId){
 try{if(!table(db,'member_enrollment_members'))return true;const rows=db.prepare("SELECT * FROM member_enrollment_members WHERE site='workspace' AND (native_id=? OR (issuer=? AND subject=?))").all(nativeUserId,issuer,subject);if(!rows.length)return true;return rows.length===1&&rows[0].issuer===issuer&&rows[0].subject===subject&&rows[0].native_id===nativeUserId&&rows[0].phase==='active';}catch{return false;}
}

/** Inject only the native process-owned connections. Never opens files or calls
 * offline migration/provisioning tools. All business writes are synchronous. */
export function createNativeEnrollment({db,identityDb,config,fault=()=>{}}={}){
 if(config?.enabled!==true)return Object.freeze({configured:false,roles:ROLES,supportsEnsure:false,grant:disabled,revoke:disabled,status:disabled});
 const {site,issuer,workspaceId}=config;
 if(!SITES.includes(site)||issuer!==FORMAL_ISSUER||typeof workspaceId!=='string'||!workspaceId||!db?.prepare||site==='collaboration'&&(!identityDb?.prepare||workspaceId!=='team'))fail(503,'NATIVE_PROVISIONING_CONFIGURATION');
 if(!table(db,'workspaces')||!db.prepare('SELECT id FROM workspaces WHERE id=?').get(workspaceId))fail(503,'EXISTING_WORKSPACE_REQUIRED');
 const needed=site==='workspace'?['members','local_users','unified_identity_bindings','audit_events']:['members','activity'];
 if(needed.some(t=>!table(db,t))||site==='collaboration'&&!table(identityDb,'identity_bindings'))fail(503,'NATIVE_SCHEMA_NOT_READY');
 const columns=(connection,name,expected)=>{const found=new Set(connection.prepare(`PRAGMA table_info(${name})`).all().map(row=>row.name));if(expected.some(name=>!found.has(name)))fail(503,'NATIVE_SCHEMA_NOT_READY');};
 columns(db,'members',site==='workspace'?['id','user_id','workspace_id','name','email','role','avatar','joined_at']:['id','user_id','workspace_id','email','role','active','revision','payload','mutation_id']);
 if(site==='workspace'){columns(db,'local_users',['id','email','name','password_hash','created_at','last_login_at']);columns(db,'unified_identity_bindings',['issuer','subject','native_user_id','kind','employee_id','client_id','workspace_ids','enabled','version']);columns(db,'audit_events',['id','workspace_id','actor','action','payload_json','created_at']);}
 else{columns(db,'workspaces',['graph_revision','graph_mutation_id']);columns(db,'activity',['id','workspace_id','actor_id','payload','created_at']);columns(identityDb,'identity_bindings',['issuer','subject','workspace_id','member_id','native_user_id','verified_by','evidence_ref','enabled','revision','created_at']);columns(identityDb,'identity_employee_clients',['issuer','subject']);}
 db.exec(`CREATE TABLE IF NOT EXISTS member_enrollment_members(site TEXT NOT NULL,member_id TEXT NOT NULL,issuer TEXT NOT NULL,subject TEXT NOT NULL,native_id TEXT NOT NULL,native_user_id TEXT NOT NULL,native_member_id TEXT NOT NULL,workspace_id TEXT NOT NULL,generation TEXT NOT NULL,phase TEXT NOT NULL,role TEXT NOT NULL,binding_version INTEGER NOT NULL,PRIMARY KEY(site,member_id),UNIQUE(site,issuer,subject),UNIQUE(site,native_id));
 CREATE TABLE IF NOT EXISTS member_enrollment_operations(operation_id TEXT PRIMARY KEY,request_digest TEXT NOT NULL,site TEXT NOT NULL,member_id TEXT NOT NULL,generation TEXT NOT NULL,action TEXT NOT NULL,context_json TEXT NOT NULL,phase TEXT NOT NULL,receipt_json TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);`);
 if(site==='collaboration')identityDb.exec('CREATE TABLE IF NOT EXISTS member_enrollment_managed(issuer TEXT NOT NULL,subject TEXT NOT NULL,member_id TEXT NOT NULL,native_id TEXT NOT NULL,generation TEXT NOT NULL,PRIMARY KEY(issuer,subject),UNIQUE(native_id));');
 const getMember=c=>db.prepare('SELECT * FROM member_enrollment_members WHERE site=? AND member_id=?').get(site,c.memberId);
 const getOp=c=>db.prepare('SELECT * FROM member_enrollment_operations WHERE operation_id=?').get(c.operationId);
 const checked=c=>{const old=getOp(c);if(old&&old.request_digest!==c.requestDigest)fail(409,'OPERATION_DIGEST_CONFLICT');return old;};
 const receipt=(c,row,phase)=>({issuer:c.issuer,subject:c.subject,nativeId:row.native_id,operationId:c.operationId,requestDigest:c.requestDigest,bindingVersion:String(row.binding_version),phase});
 function checkRow(c,row){if(!row||row.issuer!==c.issuer||row.subject!==c.subject||row.workspace_id!==workspaceId||c.nativeId!==undefined&&c.nativeId!==row.native_id)fail(409,'NATIVE_IDENTITY_CONFLICT');}
 function audit(c,action,row){
  const payload=JSON.stringify({action,memberId:row.native_member_id,operationId:c.operationId,generation:c.generation,source:'unified-member-provisioner'}),time=new Date().toISOString();
  if(site==='workspace')db.prepare('INSERT INTO audit_events(id,workspace_id,actor,action,payload_json,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(),workspaceId,'unified-member-provisioner',action,payload,time);
  else db.prepare('INSERT INTO activity(id,workspace_id,actor_id,payload,created_at) VALUES(?,?,?,?,?)').run(randomUUID(),workspaceId,'unified-member-provisioner',payload,time);
 }
 function newNative(c){
  if(c.nativeId!==undefined)fail(409,'UNREVIEWED_NATIVE_ID');
  if(db.prepare('SELECT 1 FROM members WHERE workspace_id=? AND lower(email)=?').get(workspaceId,c.display.email)||site==='workspace'&&db.prepare('SELECT 1 FROM local_users WHERE lower(email)=?').get(c.display.email))fail(409,'NATIVE_EMAIL_REVIEW_REQUIRED');
  if((site==='workspace'?db:identityDb).prepare(`SELECT 1 FROM ${site==='workspace'?'unified_identity_bindings':'identity_bindings'} WHERE issuer=? AND subject=?`).get(c.issuer,c.subject)||site==='collaboration'&&table(identityDb,'identity_employee_clients')&&identityDb.prepare('SELECT 1 FROM identity_employee_clients WHERE issuer=? AND subject=?').get(c.issuer,c.subject))fail(409,'EXISTING_SUBJECT_REVIEW_REQUIRED');
  const userId=`unified-user-${randomUUID()}`,memberId=`member_${randomUUID()}`,time=new Date().toISOString();
  if(site==='workspace'){
   db.prepare('INSERT INTO local_users(id,email,name,password_hash,created_at,last_login_at) VALUES(?,?,?,?,?,NULL)').run(userId,c.display.email,c.display.realName,`!unified-only:${randomUUID()}`,time);
   db.prepare('INSERT INTO members(id,user_id,workspace_id,name,email,role,avatar,joined_at) VALUES(?,?,?,?,?,?,NULL,?)').run(memberId,userId,workspaceId,c.display.realName,c.display.email,c.role,time);
  }else{
   const payload={id:memberId,userId,email:c.display.email,name:c.display.realName,role:c.role,capacityHours:40,color:'#4F6BF6',active:true,revision:1,createdAt:time,jobTitle:''};
   db.prepare('INSERT INTO members(id,workspace_id,user_id,email,role,active,revision,payload,mutation_id) VALUES(?,?,?,?,?,1,1,?,?)').run(memberId,workspaceId,userId,c.display.email,c.role,JSON.stringify(payload),c.operationId);
   db.prepare('UPDATE workspaces SET graph_revision=graph_revision+1,graph_mutation_id=? WHERE id=?').run(c.operationId,workspaceId);
  }
  return {site,member_id:c.memberId,issuer:c.issuer,subject:c.subject,native_id:site==='workspace'?userId:memberId,native_user_id:userId,native_member_id:memberId,workspace_id:workspaceId,generation:c.generation,phase:'prepared',role:c.role,binding_version:1};
 }
 function writeNativeRole(c,row){
  const member=db.prepare('SELECT * FROM members WHERE id=? AND workspace_id=? AND user_id=?').get(row.native_member_id,workspaceId,row.native_user_id);
  if(!member)fail(409,'NATIVE_MEMBER_CHANGED');
  if(site==='workspace')db.prepare('UPDATE members SET role=? WHERE id=? AND workspace_id=? AND user_id=?').run(c.role,member.id,workspaceId,row.native_user_id);
  else {
   let p;try{p=JSON.parse(member.payload);}catch{fail(409,'NATIVE_MEMBER_CHANGED');}
   const revision=member.revision+1;Object.assign(p,{id:member.id,userId:member.user_id,email:member.email,role:c.role,active:member.active===1,revision});
   db.prepare('UPDATE members SET role=?,revision=?,payload=?,mutation_id=? WHERE id=? AND workspace_id=? AND revision=?').run(c.role,revision,JSON.stringify(p),c.operationId,member.id,workspaceId,member.revision);
   db.prepare('UPDATE workspaces SET graph_revision=graph_revision+1,graph_mutation_id=? WHERE id=?').run(c.operationId,workspaceId);
  }
 }
 function saveMember(row){db.prepare('INSERT INTO member_enrollment_members VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(site,member_id) DO UPDATE SET generation=excluded.generation,phase=excluded.phase,role=excluded.role,binding_version=excluded.binding_version').run(...['site','member_id','issuer','subject','native_id','native_user_id','native_member_id','workspace_id','generation','phase','role','binding_version'].map(k=>row[k]));}
 function prepare(c,action){
  let row=getMember(c);if(row)checkRow(c,row);
  if(action==='grant'){
   if(row){if(row.generation===c.generation)fail(409,'GENERATION_TOMBSTONE');if(row.phase!=='revoked'||c.nativeId!==row.native_id)fail(409,'EXACT_RETAINED_NATIVE_ID_REQUIRED');row={...row,generation:c.generation,phase:'prepared',role:c.role,binding_version:row.binding_version+1};writeNativeRole(c,row);}
   else row=newNative(c);
  }else{
   if(!row||row.generation!==c.generation||!['active','prepared'].includes(row.phase))fail(409,'ACTIVE_GENERATION_REQUIRED');row={...row,phase:'revoking',binding_version:row.binding_version+1};
  }
  saveMember(row);const time=new Date().toISOString();db.prepare('INSERT INTO member_enrollment_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(c.operationId,c.requestDigest,site,c.memberId,c.generation,action,JSON.stringify(c),'prepared',null,time,time);audit(c,`${action}.prepared`,row);return row;
 }
 function workspaceBinding(c,row,action){
  const old=db.prepare('SELECT * FROM unified_identity_bindings WHERE issuer=? AND subject=?').get(c.issuer,c.subject);
  if(old&&(old.native_user_id!==row.native_user_id||old.kind!=='human'||old.employee_id!==null||old.client_id!==null||old.workspace_ids!==JSON.stringify([workspaceId])))fail(409,'BINDING_CONFLICT');
  if(old)db.prepare('UPDATE unified_identity_bindings SET enabled=?,version=? WHERE issuer=? AND subject=?').run(action==='grant'?1:0,String(row.binding_version),c.issuer,c.subject);
  else{if(action!=='grant')fail(409,'BINDING_REQUIRED');db.prepare('INSERT INTO unified_identity_bindings VALUES(?,?,?,?,?,?,?,1,?)').run(c.issuer,c.subject,row.native_user_id,'human',null,null,JSON.stringify([workspaceId]),String(row.binding_version));}
 }
 function teamBinding(c,row,action){
  transaction(identityDb,()=>{
   const current=getMember(c);if(!current||current.generation!==c.generation||current.phase!==(action==='grant'?'prepared':'revoking'))fail(409,'GENERATION_CONFLICT');
   const native=db.prepare('SELECT * FROM members WHERE id=? AND workspace_id=? AND user_id=?').get(row.native_member_id,workspaceId,row.native_user_id);if(!native||action==='grant'&&native.active!==1)fail(409,'NATIVE_MEMBER_CHANGED');
   const old=identityDb.prepare('SELECT * FROM identity_bindings WHERE issuer=? AND subject=?').get(c.issuer,c.subject);
   if(old&&(old.member_id!==row.native_member_id||old.native_user_id!==row.native_user_id||old.workspace_id!==workspaceId))fail(409,'BINDING_CONFLICT');
   const marker=identityDb.prepare('SELECT * FROM member_enrollment_managed WHERE issuer=? AND subject=?').get(c.issuer,c.subject);
   if(old&&!marker)fail(409,'UNMANAGED_BINDING_CONFLICT');
   if(marker&&(marker.member_id!==c.memberId||marker.native_id!==row.native_id))fail(409,'BINDING_CONFLICT');
   if(old)identityDb.prepare('UPDATE identity_bindings SET enabled=?,revision=?,verified_by=?,evidence_ref=? WHERE issuer=? AND subject=?').run(action==='grant'?1:0,row.binding_version,'unified-member-provisioner',c.operationId,c.issuer,c.subject);
   else{identityDb.prepare('INSERT INTO identity_bindings(issuer,subject,workspace_id,member_id,native_user_id,verified_by,evidence_ref,enabled,revision,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(c.issuer,c.subject,workspaceId,row.native_member_id,row.native_user_id,'unified-member-provisioner',c.operationId,action==='grant'?1:0,row.binding_version,new Date().toISOString());}
   identityDb.prepare('INSERT INTO member_enrollment_managed VALUES(?,?,?,?,?) ON CONFLICT(issuer,subject) DO UPDATE SET generation=excluded.generation').run(c.issuer,c.subject,c.memberId,row.native_id,c.generation);
  });
 }
 function finish(c,action){
  const row=getMember(c);checkRow(c,row);if(row.generation!==c.generation||row.phase!==(action==='grant'?'prepared':'revoking'))fail(409,'GENERATION_CONFLICT');
  const result=receipt(c,row,action==='grant'?'active':'revoked');
  db.prepare('UPDATE member_enrollment_members SET phase=? WHERE site=? AND member_id=? AND generation=?').run(result.phase,site,c.memberId,c.generation);
  if(action==='grant'&&!liveNativeAccess(c,{...row,phase:'active'}))fail(409,'NATIVE_ACL_CHANGED');
  db.prepare("UPDATE member_enrollment_operations SET phase=?,receipt_json=?,updated_at=? WHERE operation_id=? AND request_digest=?").run(result.phase,JSON.stringify(result),new Date().toISOString(),c.operationId,c.requestDigest);audit(c,result.phase,row);return result;
 }
 function reconcile(c,action){
  const row=getMember(c);checkRow(c,row);if(row.generation!==c.generation||row.phase!==(action==='grant'?'prepared':'revoking'))return unknown(c);
  try{teamBinding(c,row,action);fault('after_identity_commit');return transaction(db,()=>{fault('before_finish_commit');return finish(c,action);});}catch{return unknown(c);}
 }
 async function run(input,action){
  const {context:c}=validateContext(input,site,action);
  const replay=()=>{const prior=checked(c);if(!prior)return null;const row=getMember(c);checkRow(c,row);if(row.generation!==c.generation||action==='grant'&&row.phase==='revoked')fail(409,'GENERATION_TOMBSTONE');if(action==='grant'&&prior.receipt_json&&(row.phase!=='active'||!liveNativeAccess(c,row)))return unknown(c);return prior.receipt_json?JSON.parse(prior.receipt_json):unknown(c);};
  const existing=replay();if(existing){if(existing.phase!=='unknown'||site!=='collaboration')return existing;const saved=checked(c);const stored=validateContext(JSON.parse(saved.context_json),site,action).context;if(stored.requestDigest!==c.requestDigest)fail(409,'OPERATION_DIGEST_CONFLICT');return reconcile(stored,action);}
  if(site==='workspace')return transaction(db,()=>{const duplicate=replay();if(duplicate)return duplicate;const r=prepare(c,action);workspaceBinding(c,r,action);fault('before_prepare_commit');const result=finish(c,action);fault('before_finish_commit');return result;});
  const duplicate=transaction(db,()=>{const repeated=replay();if(repeated)return repeated;prepare(c,action);fault('before_prepare_commit');return null;});return duplicate??reconcile(c,action);
 }
 function liveNativeAccess(c,row){
  try{
   if(!db.prepare('SELECT id FROM workspaces WHERE id=?').get(workspaceId))return false;
   const native=db.prepare('SELECT * FROM members WHERE id=? AND workspace_id=? AND user_id=?').get(row.native_member_id,workspaceId,row.native_user_id);if(!native||native.role!==row.role)return false;
   if(site==='workspace'){
    const binding=db.prepare('SELECT * FROM unified_identity_bindings WHERE issuer=? AND subject=?').get(c.issuer,c.subject);
    return !!db.prepare('SELECT id FROM local_users WHERE id=?').get(row.native_user_id)&&!!binding&&binding.enabled===1&&binding.kind==='human'&&binding.native_user_id===row.native_user_id&&binding.workspace_ids===JSON.stringify([workspaceId])&&binding.version===String(row.binding_version)&&managedWorkspaceBindingAllowed(db,c.issuer,c.subject,row.native_id);
   }
   const payload=JSON.parse(native.payload),binding=identityDb.prepare('SELECT * FROM identity_bindings WHERE issuer=? AND subject=?').get(c.issuer,c.subject);
   return native.active===1&&payload.id===native.id&&payload.userId===native.user_id&&payload.role===native.role&&payload.revision===native.revision&&payload.active===true&&!!binding&&binding.enabled===1&&binding.member_id===row.native_member_id&&binding.native_user_id===row.native_user_id&&binding.workspace_id===workspaceId&&binding.revision===row.binding_version&&managedTeamBindingAllowed(db,identityDb,c.issuer,c.subject,row.native_id);
  }catch{return false;}
 }
 return Object.freeze({configured:true,roles:rolesForSite(site),supportsEnsure:false,grant:c=>run(c,'grant'),revoke:c=>run(c,'revoke'),async status(input){const {context:c}=validateContext(input,site,'status');const old=checked(c);if(!old)return {phase:'not_found',operationId:c.operationId,requestDigest:c.requestDigest};const row=getMember(c);checkRow(c,row);if(row.generation!==c.generation)return unknown(c);if(row.phase==='revoked')return receipt(c,row,'revoked');if(row.phase!=='active'||!old.receipt_json||!liveNativeAccess(c,row))return unknown(c);return JSON.parse(old.receipt_json);}});
}
