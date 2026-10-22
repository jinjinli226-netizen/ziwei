import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fail} from './errors.mjs';
export function validateOrigin(value,{allowLoopbackHttp=false}={}){
  let url;try{url=new URL(value);}catch{fail('USAGE','--api must be an HTTPS origin');}
  if((url.protocol!=='https:'&&!(allowLoopbackHttp&&url.protocol==='http:'&&['127.0.0.1','[::1]'].includes(url.hostname)))||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname))fail('USAGE','--api must be a credential-free HTTPS origin; loopback HTTP requires explicit isolated-test configuration');
  return url.origin;
}
export function configurationRoot(env=process.env){
  const value=env.ZIWEI_WORKSPACE_CONFIG_DIR;
  if(value&&!path.isAbsolute(value))fail('USAGE','ZIWEI_WORKSPACE_CONFIG_DIR must be absolute');
  return value||path.join(os.homedir(),'.config','ziwei-workspace');
}
export function selector(options,origin){
  const result={origin,profile:options.profile||'default',account:options.account||'default',purpose:options.purpose||'person'};
  for(const key of ['profile','account'])if(!result[key].trim()||result[key].length>320||/[\x00-\x1f]/.test(result[key]))fail('USAGE',`Invalid --${key}`);
  if(!['person','employee'].includes(result.purpose))fail('USAGE','--purpose must be person or employee');
  return result;
}
export function validateWorkspace(value){if(typeof value!=='string'||!/^[a-z0-9][a-z0-9_-]{1,62}$/i.test(value))fail('USAGE','A valid 2–63 character workspace slug is required');return value;}
const keyFor=selection=>crypto.createHash('sha256').update(JSON.stringify(['workspace',selection.origin,selection.profile,selection.account,selection.purpose])).digest('hex');
const recordVersion=item=>item?.version|| (item?crypto.createHash('sha256').update(JSON.stringify(item)).digest('hex'):null);
const slotVersion=(data,key)=>recordVersion(data.slots[key])||data.versions?.[key]||null;
function bumpVersion(data,key){data.versions??={};const version=crypto.randomUUID();data.versions[key]=version;return version;}
export class CredentialStore{
  constructor(root,{lockTimeoutMs=5000,signal}={}){this.root=root;this.file=path.join(root,'credentials.json');this.lockDirectory=path.join(root,'credentials.lock');this.lockTimeoutMs=lockTimeoutMs;this.signal=signal;}
  async read(){try{const parsed=JSON.parse(await fs.readFile(this.file,'utf8'));if(parsed.schemaVersion!==1||parsed.service!=='workspace'||!parsed.slots||typeof parsed.slots!=='object')fail('SERVICE_UNAVAILABLE','Workspace credential store has an unsupported format');return parsed;}catch(error){if(error.code==='ENOENT')return{schemaVersion:1,service:'workspace',slots:{}};if(error.code==='SERVICE_UNAVAILABLE')throw error;fail('SERVICE_UNAVAILABLE','Workspace credential store is unreadable');}}
  async load(selection){const data=await this.read();const item=data.slots[keyFor(selection)];if(!item)return null;if(JSON.stringify(item.selector)!==JSON.stringify(selection))fail('SERVICE_UNAVAILABLE','Credential selector mismatch');return item.credential;}
  async snapshot(selection){const data=await this.read(),key=keyFor(selection),item=data.slots[key];if(item&&JSON.stringify(item.selector)!==JSON.stringify(selection))fail('SERVICE_UNAVAILABLE','Credential selector mismatch');return{credential:item?.credential||null,version:slotVersion(data,key)};}
  async #write(data){
    await fs.mkdir(this.root,{recursive:true,mode:0o700});
    const temp=path.join(this.root,`.credentials-${crypto.randomUUID()}.tmp`);
    try{await fs.writeFile(temp,JSON.stringify(data),{encoding:'utf8',mode:0o600,flag:'wx'});await fs.rename(temp,this.file);await fs.chmod(this.file,0o600);}catch{await fs.rm(temp,{force:true}).catch(()=>{});fail('SERVICE_UNAVAILABLE','Cannot save workspace credential store');}
  }
  async #mutate(change,{settleAfterCancellation=false}={}){
    // Settling an already dispatched authorization only records its known/unknown
    // local state. It never sends a request or starts business work after SIGINT.
    const signal=settleAfterCancellation?undefined:this.signal;
    if(signal?.aborted)fail('CANCELLED','Cancelled before changing local credentials',{outcomeUnknown:false});
    try{await fs.mkdir(this.root,{recursive:true,mode:0o700});}catch{fail('SERVICE_UNAVAILABLE','Cannot open the workspace credential directory');}
    const deadline=Date.now()+this.lockTimeoutMs;let acquired=false;
    while(!acquired){
      if(signal?.aborted)fail('CANCELLED','Cancelled while waiting for the credential transaction lock',{outcomeUnknown:false});
      try{await fs.mkdir(this.lockDirectory,{mode:0o700});acquired=true;}
      catch(error){
        if(error.code!=='EEXIST')fail('SERVICE_UNAVAILABLE','Cannot acquire the workspace credential transaction lock');
        if(Date.now()>=deadline)fail('SERVICE_UNAVAILABLE','Workspace credential store is locked; retry after the other CLI exits. An abandoned lock requires checking the original process before manual recovery.',{lockBusy:true});
        await new Promise(resolve=>setTimeout(resolve,10));
      }
    }
    const ownerFile=path.join(this.lockDirectory,'owner.json');
    try{
      try{await fs.writeFile(ownerFile,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}),{mode:0o600,flag:'wx'});}catch{fail('SERVICE_UNAVAILABLE','Cannot record the credential transaction lock owner');}
      // The lock covers the read as well as the atomic replacement, so a
      // different-slot save cannot overwrite a later save or resurrect logout.
      const data=await this.read();if(signal?.aborted)fail('CANCELLED','Cancelled before changing local credentials',{outcomeUnknown:false});const result=change(data);if(result.changed)await this.#write(data);return result.value;
    }finally{
      // Never break or steal an existing lock, including by age or PID reuse.
      // Cleanup only this transaction's two exact paths; no recursive delete.
      try{await fs.rm(ownerFile,{force:true});await fs.rmdir(this.lockDirectory);}catch{fail('SERVICE_UNAVAILABLE','The credential transaction lock could not be released; verify the original process before manual recovery');}
    }
  }
  async save(selection,credential){return this.#mutate(data=>{const key=keyFor(selection);data.slots[key]={selector:selection,credential,version:bumpVersion(data,key)};return{changed:true};});}
  async compareAndSwap(selection,expectedVersion,credential,options){return this.#mutate(data=>{const key=keyFor(selection);if(slotVersion(data,key)!==expectedVersion)return{changed:false,value:null};const version=bumpVersion(data,key);if(credential===null)delete data.slots[key];else data.slots[key]={selector:selection,credential,version};return{changed:true,value:{version,credential}};},options);}
  async take(selection){return this.#mutate(data=>{const key=keyFor(selection),item=data.slots[key];if(item&&JSON.stringify(item.selector)!==JSON.stringify(selection))fail('SERVICE_UNAVAILABLE','Credential selector mismatch');delete data.slots[key];bumpVersion(data,key);return{changed:true,value:item?.credential||null};});}
  async clear(selection){return this.#mutate(data=>{const key=keyFor(selection),existed=Object.hasOwn(data.slots,key);delete data.slots[key];bumpVersion(data,key);return{changed:true,value:existed};});}
}
export function publicCredential(credential,selection){return{service:'workspace',...selection,mode:credential.mode,identitySource:credential.identitySource,identity:credential.identity||null,workspace:credential.workspace,expiresAt:credential.expiresAt||null,...(credential.mode==='unified'?{issuer:credential.issuer,audience:credential.audience,scopes:credential.scopes||[],scopeSource:credential.pending?'not verified; awaiting authorization':'last server-verified site identity; scopes never grant native permissions',state:credential.pending?(credential.pending.outcomeUnknown?'unknown':credential.pending.exchangeState||'authorization_required'):credential.refreshState||'succeeded',completed:!credential.pending&&!credential.refreshState}:{}),...(credential.deviceId?{deviceId:credential.deviceId}:{}),unified:credential.mode==='unified'?'implemented_requires_configured_server':'pending'};}
export function validateManagedToken(token,metadata,errorCode='USAGE'){
  const invalid=()=>fail(errorCode,'Expected an original restricted zmcp1 managed credential; static owner tokens and conflicting claims are not accepted');
  if(typeof token!=='string'||token.length>8192)invalid();
  const match=token.match(/^zmcp1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/);if(!match)invalid();
  let claims;try{claims=JSON.parse(Buffer.from(match[1],'base64url').toString('utf8'));}catch{invalid();}
  if(!claims||claims.audience!=='ziwei-management'||claims.audience!==metadata.audience||claims.workspace!==metadata.workspace||claims.deviceId!==metadata.deviceId||claims.expiresAt!==metadata.expiresAt||typeof claims.credentialId!=='string'||!claims.credentialId||metadata.credentialId&&claims.credentialId!==metadata.credentialId)invalid();
  if(!/^[A-Za-z0-9._:-]{1,512}$/.test(claims.deviceId)||!/^[A-Za-z0-9._:-]{1,512}$/.test(claims.credentialId))invalid();
  // This is wire/metadata validation, never a local signature or grant verification.
  // Only the original backend can verify the signature and live membership/device state.
  return claims;
}
export function assertCredential(credential){
  if(!credential)fail('UNAUTHENTICATED','No credential in this workspace/origin/profile/account/purpose slot; use auth login');
  if(credential.expiresAt&&!(Date.parse(credential.expiresAt)>Date.now()))fail('UNAUTHENTICATED','The selected credential has expired; explicitly authorize this slot again');
  validateWorkspace(credential.workspace);
  if(!['native','managed','unified'].includes(credential.mode)||!(credential.mode==='native'?credential.session:credential.mode==='unified'?credential.accessToken:credential.token))fail('UNAUTHENTICATED','The selected credential is incomplete; finish device authorization or authorize this slot');
  if(credential.mode==='unified'&&(!credential.issuer||credential.audience!=='ziwei-workspace-api'||credential.clientId!=='ziwei-workspace-cli'||!credential.identity?.subject))fail('UNAUTHENTICATED','The unified credential is incomplete');
  if(credential.mode==='managed'){
    if(!credential.expiresAt||!credential.deviceId||!credential.apiBase)fail('UNAUTHENTICATED','The selected managed credential is incomplete');
    validateManagedToken(credential.token,credential,'UNAUTHENTICATED');
  }
}
