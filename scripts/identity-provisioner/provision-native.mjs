import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { verifyOperatorPlan, applyProvisioning, digest } from './reviewed-provision.mjs';
const fail=()=>{throw Error('Protected native provisioning rejected.');};
export function readProtected(file){
  if(!path.isAbsolute(file||''))fail();const st=fs.lstatSync(file);
  if(st.isSymbolicLink()||!st.isFile()||st.nlink!==1||st.size>131072||process.platform!=='win32'&&((st.mode&0o077)||st.uid!==process.getuid()))fail();
  if(process.platform==='win32'){
    const script="$ErrorActionPreference='Stop'; $a=Get-Acl -LiteralPath $env:ZIWEI_PROVISION_FILE; $s=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $ok=@($s,'S-1-5-18','S-1-5-32-544'); if(-not $a.AreAccessRulesProtected){exit 4}; if($ok -notcontains $a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value){exit 4}; foreach($r in $a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])){if($r.IsInherited -or ($r.AccessControlType -eq 'Allow' -and $ok -notcontains $r.IdentityReference.Value)){exit 4}}; 'protected'";
    if(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{env:{...process.env,ZIWEI_PROVISION_FILE:file},encoding:'utf8',stdio:['ignore','pipe','ignore'],windowsHide:true}).trim()!=='protected')fail();
  }
  const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));try{const current=fs.fstatSync(fd);if(current.dev!==st.dev||current.ino!==st.ino)fail();return fs.readFileSync(fd,'utf8');}finally{fs.closeSync(fd);}
}
export function nativeProjection(db,service,row){
  if(service==='workspace'){
    const user=db.prepare('SELECT id FROM local_users WHERE id=?').get(row.nativeUserId);
    if(!user)fail();const memberships=row.workspaceIds.map(id=>db.prepare('SELECT id,workspace_id,user_id,role FROM members WHERE user_id=? AND workspace_id=?').get(row.nativeUserId,id));
    if(memberships.some(x=>!x))fail();
    const employee=row.kind==='employee'?db.prepare('SELECT id,owner_user_id,workspace_id FROM employees WHERE id=?').get(row.employeeId):null;
    return {user,memberships,employee};
  }
  const member=db.prepare('SELECT id,workspace_id,user_id,role,active,revision,payload FROM members WHERE id=? AND workspace_id=?').get(row.memberId,row.workspaceId);
  if(!member||member.user_id!==row.expectedUserId||member.active!==1)fail();return {member};
}
export async function provision({service,root,dbFile,identityDir,proof,config,inspect}){
  if(!['workspace','collaboration'].includes(service)||!path.isAbsolute(root)||!path.isAbsolute(dbFile))fail();
  if(inspect){const db=new DatabaseSync(dbFile,{readOnly:true});try{return {service,nativeDigest:digest(nativeProjection(db,service,inspect))};}finally{db.close();}}
  const claims=verifyOperatorPlan(proof,{service,issuer:config.issuer,planSha256:config.planSha256});
  const stat=fs.statSync(dbFile,{bigint:true});
  if(claims.database?.canonicalPath!==fs.realpathSync.native(dbFile)||claims.database?.dev!==String(stat.dev)||claims.database?.ino!==String(stat.ino)||claims.writersStopped!==true||!Number.isSafeInteger(claims.previousServicePid)||claims.previousServicePid<=0)fail();
  try{process.kill(claims.previousServicePid,0);fail();}catch(e){if(e.code!=='ESRCH')fail();}
  const lockFile=path.join(path.dirname(dbFile),'.identity-provision.lock'),fd=fs.openSync(lockFile,'wx',0o600);let db,store;
  try{
    fs.writeFileSync(fd,JSON.stringify({pid:process.pid,purpose:'reviewed-native-identity',at:new Date().toISOString()}));fs.fsyncSync(fd);
    if(service==='workspace'){
      const {createRepository}=await import(pathToFileURL(path.join(root,'backend/repository.mjs')));
      db=createRepository({filename:dbFile,enableScheduler:false}).db;
      const {createBindingStore}=await import(pathToFileURL(path.join(root,'backend/identity/bindings.mjs')));store=createBindingStore(db);
    }else{
      if(fs.existsSync(path.join(path.dirname(dbFile),'.service.lock')))fail();db=new DatabaseSync(dbFile,{readOnly:true});
      const {openIdentityBindings}=await import(pathToFileURL(path.join(root,'scripts/identity-bindings.mjs')));store=await openIdentityBindings({directory:identityDir,businessSqlite:db});
    }
    const securityDb=service==='workspace'?db:store.sqlite;
    securityDb.exec('CREATE TABLE IF NOT EXISTS reviewed_identity_proofs(jti TEXT PRIMARY KEY,digest TEXT NOT NULL,reviewer TEXT NOT NULL,consumed_at TEXT NOT NULL)');
    return applyProvisioning(claims,{
      transaction:fn=>{securityDb.exec('BEGIN IMMEDIATE');try{const result=fn();securityDb.exec('COMMIT');return result;}catch(e){securityDb.exec('ROLLBACK');throw e;}},
      nativeDigest:row=>digest(nativeProjection(db,service,row)),hasProof:jti=>securityDb.prepare('SELECT digest FROM reviewed_identity_proofs WHERE jti=?').get(jti),
      recordProof:(jti,hash,reviewer)=>securityDb.prepare('INSERT INTO reviewed_identity_proofs VALUES(?,?,?,?)').run(jti,hash,reviewer,new Date().toISOString()),
      bind:row=>{
        if(service==='workspace'){
          const old=db.prepare('SELECT subject FROM unified_identity_bindings WHERE issuer=? AND native_user_id=? AND kind=? AND employee_id IS ?').get(row.issuer,row.nativeUserId,row.kind,row.employeeId||null);
          if(old&&old.subject!==row.subject)fail();store.bind(row);
        }else{const input={...row,expectedUserId:row.expectedUserId};if(row.kind==='employee')store.registerEmployeeClient(input);else store.bindVerified(input);}
      }
    });
  }finally{if(service==='collaboration')store?.close();db?.close();fs.closeSync(fd);fs.unlinkSync(lockFile);}
}
async function main(){
  if(process.platform!=='win32'&&process.getuid()!==0)fail();
  const [command,service,...args]=process.argv.slice(2),o={};for(let i=0;i<args.length;i+=2){if(!['--root','--database','--identity-dir','--input','--plan-sha256'].includes(args[i])||!args[i+1]||o[args[i]])fail();o[args[i]]=args[i+1];}
  if(!['inspect','apply'].includes(command))fail();
  const value=readProtected(o['--input']);
  const result=await provision({service,root:o['--root'],dbFile:o['--database'],identityDir:o['--identity-dir'],...(command==='inspect'?{inspect:JSON.parse(value)}:{proof:value,config:{issuer:process.env.ZIWEI_IDENTITY_ISSUER,planSha256:o['--plan-sha256']}})});
  console.log(JSON.stringify({schemaVersion:1,service,ok:true,data:result}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{console.log(JSON.stringify({schemaVersion:1,ok:false,error:{code:'PROVISIONING_REJECTED',message:'Check offline native source, root-reviewed exact mapping, approved code and protected files.'}}));process.exitCode=1;});
