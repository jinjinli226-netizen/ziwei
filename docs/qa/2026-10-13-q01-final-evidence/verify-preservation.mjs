import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
const candidateRoot='C:/Users/25941/.codex/worktrees/v2-e03-hermes-full-ui/灵光爸爸拆解';
const manifestPath=path.join(candidateRoot,'.local/e03-native-preview-evidence/preservation.json');
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const output=path.join(import.meta.dirname,'preservation-fresh.json');
// Only the three requested non-authentication tables; no local_users, secrets,
// device credentials, environment keys or runtime HOME files are opened.
const columns={
 employees:['id','workspace_id','owner_user_id','name','runtime','model_id','description','visibility','skills_json','instructions','runtime_profile','avatar','status','management_mcp_enabled','default_working_directory','default_working_directory_device_id','created_at','updated_at','persona','target_device_id'],
 conversations:['id','workspace_id','employee_id','title','status','model_id','working_directory','device_id','created_at','updated_at'],
 conversation_messages:['id','conversation_id','role','content','attachment_json','created_at'],
};
const current=new DatabaseSync(path.join(manifest.stateRoot,'data/preview.sqlite'),{readOnly:true});
const before=new DatabaseSync(manifest.backup,{readOnly:true});
const digest=row=>createHash('sha256').update(JSON.stringify(row)).digest('hex');
const results=[];
try{
 current.exec('PRAGMA busy_timeout=10000');
 before.exec('PRAGMA busy_timeout=10000');
 for(const [table,fields] of Object.entries(columns)){
  const sql=`SELECT ${fields.join(',')} FROM ${table} WHERE id=?`;
  const nowQuery=current.prepare(sql),beforeQuery=before.prepare(sql);
  const rows=[];
  for(const item of manifest.tables[table]){
   const earlier=beforeQuery.get(item.id),now=nowQuery.get(item.id);
   rows.push({id:item.id,existsInBackup:!!earlier,existsNow:!!now,baselineManifestDigest:item.digest,backupDigest:earlier?digest(earlier):null,currentDigest:now?digest(now):null,backupMatchesManifest:!!earlier&&digest(earlier)===item.digest,currentMatchesManifest:!!now&&digest(now)===item.digest});
  }
  results.push({table,columns:fields,checked:rows.length,passed:rows.every(row=>row.backupMatchesManifest&&row.currentMatchesManifest),rows});
 }
}finally{before.close();current.close();}
const report={observedAtUtc:new Date().toISOString(),scope:'Read-only exact original employee/conversation/message IDs in local preview SQLite and its baseline backup; field bodies and all authentication tables excluded from output; no authentication/HOME/key files opened',manifestPath,manifestCapturedAt:manifest.capturedAt,authorVerifiedAt:manifest.verifiedAt,stateRoot:manifest.stateRoot,backup:manifest.backup,status:results.every(x=>x.passed)?'passed':'failed',results};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,status:report.status,observedAtUtc:report.observedAtUtc,results:results.map(({table,checked,passed})=>({table,checked,passed}))}));
if(report.status!=='passed')process.exitCode=1;
