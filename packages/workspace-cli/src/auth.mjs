import fs from 'node:fs/promises';
import {fail,CliError} from './errors.mjs';
import {parseJsonStrict} from './input.mjs';
import {assertCredential,publicCredential,validateOrigin,validateWorkspace,validateManagedToken} from './config.mjs';
import {unifiedCommand,logoutUnified,requireLegacy} from './unified.mjs';
export async function authCommand(action,options,context){
  const{store,selection,request,readStdin,secrets}=context;
  if(options.mode==='machine')fail('NOT_SUPPORTED','Explicit registered per-employee per-site machine clients are not supported by this CLI version');
  if(action==='login'&&(options.mode||'unified')==='unified'){
    if(options.local)fail('USAGE','--local applies only to auth status/logout');
    return unifiedCommand(action,options,context);
  }
  if(['complete','wait','refresh'].includes(action))return unifiedCommand(action,options,context);
  if(action==='login'){
    if(options.local)fail('USAGE','--local applies only to auth status/logout');
    const mode=options.mode;
    if(!['native','managed'].includes(mode))fail('USAGE','--mode must be native, managed or unified');
    if(mode==='managed'){
      if(selection.purpose!=='employee')fail('USAGE','Managed device credentials require an explicit --purpose employee storage slot; this selector does not assert employee identity');
      const sources=['managed-file','managed-stdin'].filter(k=>Object.hasOwn(options,k));if(sources.length!==1||options.email||options['password-stdin'])fail('USAGE','Managed login requires exactly --managed-file or --managed-stdin');
      await requireLegacy(context);
      let raw;try{raw=sources[0]==='managed-file'?await fs.readFile(options['managed-file'],'utf8'):await readStdin();}catch(error){if(error instanceof CliError)throw error;fail('USAGE','Cannot read the explicit managed credential source');}
      const value=parseJsonStrict(raw);if(value?.token)secrets.push(value.token);
      const allowed=new Set(['token','bearerToken','managed','workspace','workspaces','audience','apiBase','deviceId','credentialId','expiresAt']);
      if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.has(k)))fail('USAGE','Managed import must use the original restricted credential JSON schema');
      const workspaces=Array.isArray(value.workspaces)?value.workspaces:(value.workspace?[value.workspace]:[]);
      if(value.managed!==true||value.audience!=='ziwei-management'||workspaces.length!==1||typeof value.deviceId!=='string'||!value.deviceId.trim()||typeof(value.token||value.bearerToken)!=='string'||!(value.token||value.bearerToken).trim()||!(Date.parse(value.expiresAt)>Date.now()))fail('USAGE','Managed import requires a valid audience, one workspace, deviceId, token and future expiresAt');
      const workspace=validateWorkspace(workspaces[0]);if(options.workspace&&options.workspace!==workspace)fail('USAGE','Managed import workspace does not match --workspace');
      if(typeof value.apiBase!=='string'||validateOrigin(value.apiBase)!==selection.origin||value.apiBase.replace(/\/$/,'')!==selection.origin)fail('USAGE','Managed import API scope does not match this selected origin');
      if(value.workspace&&value.workspace!==workspace)fail('USAGE','Managed import workspace fields conflict');
      if(value.token&&value.bearerToken&&value.token!==value.bearerToken)fail('USAGE','Managed import token fields conflict');
      const claims=validateManagedToken(value.token||value.bearerToken,{...value,workspace});
      const credential={mode:'managed',legacyCompatibility:true,identitySource:'legacy-managed',token:value.token||value.bearerToken,workspace,audience:value.audience,apiBase:selection.origin,deviceId:value.deviceId,credentialId:claims.credentialId,expiresAt:value.expiresAt,identity:{kind:'original-managed-device-scope',signatureVerified:false}};
      secrets.push(credential.token);await store.save(selection,credential);
      return{...publicCredential(credential,selection),verification:'local',serverVerified:false,imported:true,note:'Imported an explicitly supplied original credential; no server authorization or employee identity was inferred.'};
    }
    if(selection.purpose!=='person')fail('USAGE','Native email/password login requires a person storage slot');
    if(!options.email||!options.email.includes('@')||!options['password-stdin']||options['managed-file']||options['managed-stdin'])fail('USAGE','Native login requires --email, --workspace and --password-stdin; no interactive prompt is opened');
    const workspace=validateWorkspace(options.workspace);
    await requireLegacy(context);
    let password;try{password=(await readStdin()).replace(/\r?\n$/,'');}catch(error){if(error instanceof CliError)throw error;fail('USAGE','Cannot read password from stdin');}
    if(!password)fail('USAGE','Password stdin must not be empty');secrets.push(password);
    let result;try{result=await request({path:'/api/auth/login',method:'POST',body:{email:options.email,password}});}
    catch(error){if(error instanceof CliError&&error.details.httpStatus===400)throw new CliError('UNAUTHENTICATED','The original native server rejected the login',error.details);throw error;}
    const cookies=result.headers?.getSetCookie?.()||[result.headers?.get?.('set-cookie')||''];
    let session;for(const cookie of cookies){const match=cookie.match(/(?:^|,\s*)ziwei_session=([^;\s,]+)/);if(match){try{session=decodeURIComponent(match[1]);}catch{fail('SERVICE_UNAVAILABLE','Server returned an invalid native session cookie');}}}
    if(!session)fail('SERVICE_UNAVAILABLE','Native login did not return the original ziwei_session Set-Cookie');secrets.push(session);
    if(!result.payload?.user?.id)fail('SERVICE_UNAVAILABLE','Native login did not return an authenticated user');
    if(!Array.isArray(result.payload.memberships)||!result.payload.memberships.some(m=>m.slug===workspace))fail('FORBIDDEN','This native identity has no membership in the selected workspace');
    const credential={mode:'native',legacyCompatibility:true,identitySource:'legacy-native',session,workspace,expiresAt:result.payload?.session?.expires_at||null,identity:{id:result.payload.user.id,email:result.payload.user.email}};
    await store.save(selection,credential);return{...publicCredential(credential,selection),verification:'server',serverVerified:true,note:'Explicit native compatibility login; this selected API declares legacy identity mode.'};
  }
  if(!['status','logout'].includes(action))fail('USAGE','Use auth login, auth status or auth logout');
  if(action==='logout'){
    const credential=await store.take(selection),localCleared=Boolean(credential);
    if(!credential)return{localCleared,remoteRevocation:'not_attempted',scope:'current CLI credential slot',allSitesLoggedOut:false};
    if(credential.mode==='unified')return logoutUnified(context,credential,options);
    secrets.push(credential.session||credential.token);
    if(credential.mode==='managed')return{localCleared,remoteRevocation:'unsupported',scope:'current CLI credential slot',allSitesLoggedOut:false};
    if(options.local)return{localCleared,remoteRevocation:'not_requested',scope:'current CLI credential slot',allSitesLoggedOut:false};
    try{await requireLegacy(context,credential);await request({path:'/api/auth/logout',method:'POST',credential});return{localCleared,remoteRevocation:'succeeded',scope:'this original native session and current CLI credential slot',allSitesLoggedOut:false};}
    catch(error){if(error instanceof CliError){error.details={...error.details,localCleared,remoteRevocation:error.details.outcomeUnknown?'unknown':error.code==='CANCELLED'?'not_attempted':'failed',allSitesLoggedOut:false};}throw error;}
  }
  const credential=await store.load(selection);
  if(credential?.mode==='unified')return unifiedCommand(action,options,context);
  assertCredential(credential);secrets.push(credential.session||credential.token);
  const summary=publicCredential(credential,selection);
  if(options.local)return{...summary,verification:'local',serverVerified:false};
  await requireLegacy(context,credential);
  const result=await request({path:credential.mode==='native'?'/api/auth/me':`/mcp/v1/workspaces/${encodeURIComponent(credential.workspace)}/health`,credential});
  if(credential.mode==='native'&&!result.payload?.user?.id)fail('UNAUTHENTICATED','The native server did not verify the original user session');
  if(credential.mode==='managed'&&(result.payload?.ok!==true||result.payload?.workspace!==credential.workspace))fail('UNAUTHENTICATED','The managed server did not verify the original workspace credential');
  return{...summary,verification:'server',serverVerified:true,server:result.payload};
}
