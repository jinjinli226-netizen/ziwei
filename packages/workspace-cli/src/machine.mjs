import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fail} from './errors.mjs';
import {validateWorkspace,publicCredential} from './config.mjs';
export function readWorkerFile(file){
  if(!path.isAbsolute(file||''))fail('USAGE','An absolute protected --worker-file is required');
  const st=fs.lstatSync(file);if(st.isSymbolicLink()||!st.isFile()||st.nlink!==1||st.size>16384||process.platform!=='win32'&&(st.mode&0o077))fail('USAGE','Worker credentials require a dedicated private regular file');
  if(process.platform==='win32'){
    const script="$ErrorActionPreference='Stop';$a=Get-Acl -LiteralPath $env:ZIWEI_WORKER_FILE;$s=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$ok=@($s,'S-1-5-18','S-1-5-32-544');if(-not $a.AreAccessRulesProtected){exit 4};foreach($r in $a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])){if($r.IsInherited -or ($r.AccessControlType -eq 'Allow' -and $ok -notcontains $r.IdentityReference.Value)){exit 4}};'protected'";
    try{if(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{env:{...process.env,ZIWEI_WORKER_FILE:file},windowsHide:true,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()!=='protected')throw Error();}catch{fail('USAGE','Worker file needs an explicit operator-only ACL without inheritance');}
  }
  let value;try{value=JSON.parse(fs.readFileSync(file,'utf8'));}catch{fail('USAGE','Worker credential file is invalid');}return value;
}
function endpoint(value,issuer){let u;try{u=new URL(value);}catch{fail('SERVICE_UNAVAILABLE','Trusted worker endpoint rejected');}const base=new URL(issuer);if(u.protocol!=='https:'||u.origin!==base.origin||!u.pathname.startsWith(base.pathname+'/')||u.username||u.password||u.hash||u.search)fail('SERVICE_UNAVAILABLE','Trusted worker endpoint rejected');return u;}
export async function machineLogin(context,options,read=readWorkerFile){
  if(context.selection.purpose!=='employee')fail('USAGE','Machine authorization requires --purpose employee');
  const workspace=validateWorkspace(options.workspace),source=read(options['worker-file']);
  if(!source||Object.keys(source).sort().join(',')!=='clientId,clientSecret,issuer,origin,subject'||!/^ziwei-workspace-worker-[A-Za-z0-9_-]{1,128}$/.test(source.clientId)||typeof source.clientSecret!=='string'||!source.clientSecret||typeof source.subject!=='string'||!source.subject||source.origin!==context.selection.origin)fail('USAGE','Use an explicitly provisioned single employee/site/client/subject worker file');
  context.secrets.push(source.clientSecret);
  const snap=await context.store.snapshot(context.selection);if(snap.credential)fail('CONFLICT','Logout the selected employee slot before machine authorization');
  const {payload:c}=await context.request({path:'/api/identity/config'});
  if(c?.service!=='workspace'||c.mode!=='unified'||c.ready!==true||c.issuer!==source.issuer||c.audience!=='ziwei-workspace-api'||context.env.ZIWEI_IDENTITY_ISSUER&&context.env.ZIWEI_IDENTITY_ISSUER!==c.issuer)fail('SERVICE_UNAVAILABLE','The selected site does not match the provisioned worker issuer');
  const {payload:m}=await context.request({origin:new URL(c.issuer).origin,path:c.issuer+'/.well-known/openid-configuration'});if(m?.issuer!==c.issuer)fail('SERVICE_UNAVAILABLE','Trusted worker discovery rejected');
  const token=endpoint(m.token_endpoint,c.issuer),revoke=m.revocation_endpoint?endpoint(m.revocation_endpoint,c.issuer):null;
  let raw;
  async function cleanup(){if(raw?.access_token&&revoke)try{await context.request({origin:revoke.origin,path:revoke.href,method:'POST',form:{client_id:source.clientId,client_secret:source.clientSecret,token:raw.access_token,token_type_hint:'access_token'}});}catch{}}
  try{
    raw=(await context.request({origin:token.origin,path:token.href,method:'POST',form:{grant_type:'client_credentials',client_id:source.clientId,client_secret:source.clientSecret,scope:'workspace:read workspace:write'}})).payload;
    if(typeof raw?.access_token==='string')context.secrets.push(raw.access_token);
    if(!raw||typeof raw.access_token!=='string'||raw.token_type?.toLowerCase()!=='bearer'||!Number.isFinite(raw.expires_in)||raw.expires_in<=0||raw.expires_in>300||raw.refresh_token)fail('UNAUTHENTICATED','The issuer returned an invalid short lived worker grant');
    const credential={mode:'unified',identitySource:'unified-oidc-machine',issuer:c.issuer,apiBase:source.origin,clientId:source.clientId,audience:c.audience,workspace,accessToken:raw.access_token,refreshToken:null,workerFile:options['worker-file'],expiresAt:new Date(Date.now()+raw.expires_in*1000).toISOString(),scopes:[],identity:{issuer:c.issuer,subject:source.subject}};
    const {payload:p}=await context.request({path:'/api/identity/me',credential});
    if(p?.verified!==true||p.verification!=='server'||p.identity?.issuer!==c.issuer||p.identity.subject!==source.subject||!p.user?.id||!p.memberships?.some(x=>x.slug===workspace)||!Array.isArray(p.scopes)||p.scopes.some(x=>!['openid','workspace:read','workspace:write'].includes(x)))fail('UNAUTHENTICATED','The server did not verify this registered worker and original native binding');
    credential.identity.nativeUserId=p.user.id;credential.scopes=p.scopes;
    if(!await context.store.compareAndSwap(context.selection,snap.version,credential))fail('CONFLICT','The selected employee slot changed while machine authorization was pending');
    return {...publicCredential(credential,context.selection),serverVerified:true,verification:'server',completed:true};
  }catch(e){await cleanup();throw e;}
}
export function workerCredentialSource(credential,context){const source=readWorkerFile(credential.workerFile);if(source.clientId!==credential.clientId||source.subject!==credential.identity?.subject||source.issuer!==credential.issuer||source.origin!==credential.apiBase)fail('UNAUTHENTICATED','Registered worker file no longer matches this credential');context.secrets.push(source.clientSecret);return source;}
