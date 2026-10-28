import crypto from 'node:crypto';
import {CliError,fail} from './errors.mjs';
import {assertCredential,publicCredential,validateWorkspace} from './config.mjs';
import {workerCredentialSource} from './machine.mjs';
const CLIENT='ziwei-workspace-cli',AUDIENCE='ziwei-workspace-api';
const SCOPES=['openid','workspace:read','workspace:write'];
const loopback=url=>url.protocol==='http:'&&['127.0.0.1','[::1]'].includes(url.hostname);
function trustedUrl(value,env){
  let url;try{url=new URL(value);}catch{fail('SERVICE_UNAVAILABLE','Trusted identity configuration has an invalid URL');}
  if(url.username||url.password||url.hash||url.search||!(url.protocol==='https:'||env.ZIWEI_WORKSPACE_ALLOW_LOOPBACK_HTTP==='1'&&loopback(url)))fail('SERVICE_UNAVAILABLE','Identity URLs require HTTPS; HTTP loopback requires explicit isolated-test configuration');
  return url;
}
async function publicConfiguration(context,init){
  try{return await context.request(init);}
  catch(error){
    if(error instanceof CliError&&[404,501].includes(error.details?.httpStatus))throw new CliError('SERVICE_UNAVAILABLE','Required public identity configuration or discovery is unavailable',{httpStatus:error.details.httpStatus,outcomeUnknown:false});
    throw error;
  }
}
export async function identityConfig(context,credential){
  const{request,env,selection}=context;
  const{payload:config}=await publicConfiguration(context,{path:'/api/identity/config'});
  if(!config||config.service!=='workspace'||!['legacy','unified'].includes(config.mode))fail('SERVICE_UNAVAILABLE','The selected API has no supported public workspace identity configuration');
  if(config.mode==='legacy'){
    if(credential?.mode==='unified')fail('SERVICE_UNAVAILABLE','This API is not configured for the stored unified identity');
    return config;
  }
  if(config.ready!==true)fail('SERVICE_UNAVAILABLE','Unified identity is not ready on the selected API',{status:'pending'});
  if(config.cliClientId!==CLIENT||config.audience!==AUDIENCE||!Array.isArray(config.scopes)||!SCOPES.every(scope=>config.scopes.includes(scope))||config.scopes.some(scope=>!SCOPES.includes(scope))||!Array.isArray(config.cliTransports)||!config.cliTransports.some(mode=>['native','mcp'].includes(mode)))fail('SERVICE_UNAVAILABLE','The public workspace identity client, audience, scopes or transports conflict with the common contract');
  const issuer=trustedUrl(config.issuer,env).href.replace(/\/$/,'');
  if(config.issuer!==issuer||env.ZIWEI_IDENTITY_ISSUER&&env.ZIWEI_IDENTITY_ISSUER!==issuer)fail('SERVICE_UNAVAILABLE','The selected API issuer conflicts with the explicit trusted issuer configuration');
  if(credential&&(credential.mode!=='unified'||credential.issuer!==issuer||credential.apiBase!==selection.origin||!(credential.clientId===CLIENT||credential.identitySource==='unified-oidc-machine'&&selection.purpose==='employee'&&/^ziwei-workspace-worker-[A-Za-z0-9_-]{1,128}$/.test(credential.clientId))||credential.audience!==AUDIENCE))fail('UNAUTHENTICATED','The stored identity does not match the selected workspace API configuration');
  return{...config,issuer};
}
export async function requireLegacy(context,credential){
  const config=await identityConfig(context);
  if(config.mode!=='legacy'||config.legacyAllowed!==true)fail('NOT_SUPPORTED','The server does not allow legacy authentication; use unified device authorization');
  if(credential&&credential.legacyCompatibility!==true)fail('UNAUTHENTICATED','Explicitly authorize this legacy compatibility slot again with --mode native or --mode managed');
  return config;
}
async function discover(context,config){
  const base=trustedUrl(config.issuer,context.env);
  const{payload}=await publicConfiguration(context,{origin:base.origin,path:config.issuer+'/.well-known/openid-configuration'});
  if(payload?.issuer!==config.issuer)fail('SERVICE_UNAVAILABLE','Identity discovery issuer does not match trusted configuration');
  const endpoints={};
  for(const name of ['device_authorization_endpoint','token_endpoint','revocation_endpoint']){
    if(name==='revocation_endpoint'&&!payload[name])continue;
    const endpoint=trustedUrl(payload[name],context.env);
    if(endpoint.origin!==base.origin||!endpoint.pathname.startsWith(base.pathname.replace(/\/$/,'')+'/'))fail('SERVICE_UNAVAILABLE','Identity discovery endpoint leaves the configured issuer realm');
    endpoints[name]=endpoint.href;
  }
  return endpoints;
}
async function oauth(context,url,form,timeout){const endpoint=trustedUrl(url,context.env);return context.request({origin:endpoint.origin,path:endpoint.href,method:'POST',form,acceptErrors:true,...(timeout?{timeout}:{})});}
function remember(credential,secrets){for(const value of [credential?.accessToken,credential?.refreshToken,credential?.pending?.deviceCode,credential?.pending?.codeVerifier])if(typeof value==='string'&&value)secrets.push(value);}
function oauthFailure(result){
  const error=result.payload?.error;
  const code=['access_denied','expired_token','invalid_grant','invalid_token'].includes(error)?'UNAUTHENTICATED':result.status===401?'UNAUTHENTICATED':result.status===403?'FORBIDDEN':result.status>=500||result.status===429?'SERVICE_UNAVAILABLE':'SERVICE_UNAVAILABLE';
  // Provider descriptions and arbitrary payloads are never copied into auth errors.
  return new CliError(code,'The trusted identity provider rejected the authorization request',{httpStatus:result.status,...(typeof error==='string'&&/^[a-z_]{1,64}$/.test(error)?{nativeCode:error}:{})});
}
function pendingView(credential,selection,extra={}){return{...publicCredential(credential,selection),verification:'local',serverVerified:false,state:credential.pending.outcomeUnknown?'unknown':credential.pending.exchangeState||'pending',completed:false,userCode:credential.pending.userCode,verificationUri:credential.pending.verificationUri,intervalSeconds:credential.pending.intervalSeconds,...extra};}
function tokenCredential(payload,previous,secrets){
  for(const key of ['access_token','refresh_token','id_token'])if(typeof payload?.[key]==='string')secrets.push(payload[key]);
  if(!payload||typeof payload.access_token!=='string'||!payload.access_token||payload.access_token.length>65536||typeof payload.token_type!=='string'||payload.token_type.toLowerCase()!=='bearer'||!Number.isFinite(payload.expires_in)||payload.expires_in<=0||payload.expires_in>86400||payload.refresh_token!==undefined&&(typeof payload.refresh_token!=='string'||!payload.refresh_token||payload.refresh_token.length>65536))fail('SERVICE_UNAVAILABLE','Identity provider returned an incomplete access-token response');
  if(typeof payload.scope!=='string'||payload.scope.split(/\s+/).filter(Boolean).some(scope=>!SCOPES.includes(scope)))fail('SERVICE_UNAVAILABLE','Identity provider returned invalid or unexpected site scopes');
  return{mode:'unified',identitySource:'unified-oidc-device',issuer:previous.issuer,clientId:CLIENT,audience:AUDIENCE,apiBase:previous.apiBase,workspace:previous.workspace,accessToken:payload.access_token,refreshToken:payload.refresh_token||previous.refreshToken||null,expiresAt:new Date(Date.now()+payload.expires_in*1000).toISOString(),scopes:payload.scope.split(/\s+/).filter(Boolean),identity:previous.identity||null};
}
async function verifyMe(context,credential,previous){
  const result=await context.request({path:'/api/identity/me',credential});
  const native=result.payload;
  if(native?.verified!==true||native.verification!=='server'||native.identity?.issuer!==credential.issuer||typeof native.identity?.subject!=='string'||!native.identity.subject||!native.user?.id||!Array.isArray(native.memberships)||!Array.isArray(native.scopes)||native.scopes.some(scope=>typeof scope!=='string'||!SCOPES.includes(scope)))fail('UNAUTHENTICATED','The workspace API did not verify the unified identity and native binding');
  if(previous?.identity?.subject&&native.identity.subject!==previous.identity.subject)fail('UNAUTHENTICATED','The verified subject changed during token refresh');
  if(!native.memberships.some(member=>member.slug===credential.workspace))fail('FORBIDDEN','The verified unified identity has no native membership in the selected workspace');
  credential.identity={issuer:credential.issuer,subject:native.identity.subject,nativeUserId:native.user.id};
  credential.scopes=credential.scopes.filter(scope=>native.scopes.includes(scope)||scope==='openid');
  return native;
}
export async function revokeUnified(context,endpoints,credential){
  remember(credential,context.secrets);
  const entries=[['refresh',credential.refreshToken,'refresh_token'],['access',credential.accessToken,'access_token']].filter(([,value])=>value);
  if(!entries.length)return{remoteRevocation:'not_attempted',revocationConfirmed:false,results:{}};
  if(!endpoints.revocation_endpoint)return{remoteRevocation:'unsupported',revocationConfirmed:false,results:{}};
  const results={};let cancelled=false;
  for(const[name,value,hint]of entries){
    try{const worker=credential.identitySource==='unified-oidc-machine'?workerCredentialSource(credential,context):null;const result=await oauth(context,endpoints.revocation_endpoint,{client_id:worker?.clientId||CLIENT,...(worker?{client_secret:worker.clientSecret}:{}),token:value,token_type_hint:hint});results[name]=result.ok?'accepted':'failed';}
    catch(error){results[name]=error.details?.outcomeUnknown?'unknown':error.code==='CANCELLED'?'not_attempted':'failed';cancelled||=error.code==='CANCELLED';}
  }
  const values=Object.values(results),remoteRevocation=values.includes('unknown')?'unknown':values.every(value=>value==='accepted')?'accepted':'failed';
  return{remoteRevocation,revocationConfirmed:false,results,...(cancelled?{cancelled:true}:{})};
}
async function discardTokens(context,endpoints,credential){return revokeUnified(context,endpoints,credential);}
async function settle(context,version,credential,error){
  try{return await context.store.compareAndSwap(context.selection,version,credential,{settleAfterCancellation:true});}
  catch{if(error instanceof CliError)error.details={...error.details,localStateFinalization:'failed'};return null;}
}
async function returnedCredential(context,endpoints,payload,previous){
  try{return tokenCredential(payload,previous,context.secrets);}
  catch(error){
    const returned={accessToken:typeof payload?.access_token==='string'?payload.access_token:null,refreshToken:typeof payload?.refresh_token==='string'?payload.refresh_token:null};
    const cleanup=await discardTokens(context,endpoints,returned);
    if(error instanceof CliError)error.details={...error.details,returnedGrantRevocation:cleanup,...(cleanup.remoteRevocation!=='accepted'?{outcomeUnknown:true}:{})};
    throw error;
  }
}
async function persistVerified(context,endpoints,snapshot,credential){
  try{
    const server=await verifyMe(context,credential,snapshot.credential);
    const saved=await context.store.compareAndSwap(context.selection,snapshot.version,credential);
    if(!saved){const cleanup=await discardTokens(context,endpoints,credential);fail('CONFLICT','Authorization changed while the identity provider was responding; returned tokens were not saved',{lateRevocation:cleanup,outcomeUnknown:cleanup.remoteRevocation!=='accepted',localSessionRestored:false});}
    return{...publicCredential(credential,context.selection),state:'succeeded',completed:true,verification:'server',serverVerified:true,server};
  }catch(error){
    if(error.code==='CONFLICT')throw error;
    const cleanup=await discardTokens(context,endpoints,credential);
    if(error instanceof CliError)error.details={...error.details,returnedGrantRevocation:cleanup,...(cleanup.remoteRevocation!=='accepted'?{outcomeUnknown:true}:{})};
    throw error;
  }
}
async function begin(context,options){
  if(context.selection.purpose==='employee'&&options.mode==='machine')fail('NOT_SUPPORTED','Explicit registered employee machine clients are not supported by this CLI version');
  for(const key of ['email','password-stdin','managed-file','managed-stdin'])if(options[key])fail('USAGE','Unified device login does not accept passwords or imported bearer credentials');
  const workspace=validateWorkspace(options.workspace);
  const snapshot=await context.store.snapshot(context.selection);
  if(snapshot.credential)fail('CONFLICT','This credential slot is occupied; logout explicitly before starting another authorization');
  const config=await identityConfig(context);
  if(config.mode!=='unified')fail('NOT_SUPPORTED','The selected server is not in unified identity mode; legacy compatibility requires explicit --mode native or --mode managed');
  const endpoints=await discover(context,config);
  const codeVerifier=crypto.randomBytes(32).toString('base64url');context.secrets.push(codeVerifier);
  const codeChallenge=crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const result=await oauth(context,endpoints.device_authorization_endpoint,{client_id:CLIENT,scope:SCOPES.join(' '),code_challenge:codeChallenge,code_challenge_method:'S256'});
  if(!result.ok)throw oauthFailure(result);
  const body=result.payload;if(typeof body?.device_code==='string')context.secrets.push(body.device_code);
  if(!body||typeof body.device_code!=='string'||!body.device_code||body.device_code.length>8192||typeof body.user_code!=='string'||!body.user_code||body.user_code.length>1024||!Number.isFinite(body.expires_in)||body.expires_in<=0||body.expires_in>3600||body.interval!==undefined&&(!Number.isInteger(body.interval)||body.interval<1||body.interval>300))fail('SERVICE_UNAVAILABLE','Identity provider returned an invalid device authorization response');
  const uri=trustedUrl(body.verification_uri,context.env),base=new URL(config.issuer);
  if(uri.origin!==base.origin||!uri.pathname.startsWith(base.pathname.replace(/\/$/,'')+'/'))fail('SERVICE_UNAVAILABLE','Device verification URI leaves the trusted issuer realm');
  const intervalSeconds=body.interval||5;
  const credential={mode:'unified',identitySource:'unified-oidc-device',issuer:config.issuer,clientId:CLIENT,audience:AUDIENCE,apiBase:context.selection.origin,workspace,scopes:[],expiresAt:new Date(Date.now()+body.expires_in*1000).toISOString(),pending:{deviceCode:body.device_code,codeVerifier,userCode:body.user_code,verificationUri:uri.href,intervalSeconds,nextPollAt:Date.now()+intervalSeconds*1000}};
  const saved=await context.store.compareAndSwap(context.selection,snapshot.version,credential);
  if(!saved)fail('CONFLICT','The credential slot changed while device authorization was starting; no local pending authorization was saved');
  return pendingView(credential,context.selection,{state:'authorization_required'});
}
async function complete(context,options,wait){
  const deadline=context.deadline||Date.now()+options.timeout;let endpoints,config;
  while(true){
    if(context.signal?.aborted)fail('CANCELLED','Device authorization wait was cancelled',{outcomeUnknown:false});
    let snapshot=await context.store.snapshot(context.selection),credential=snapshot.credential;
    if(!credential?.pending||credential.mode!=='unified')fail('UNAUTHENTICATED','No pending unified authorization in this slot; use auth login');
    remember(credential,context.secrets);
    if(typeof credential.pending.codeVerifier!=='string'||!/^[A-Za-z0-9_-]{43,128}$/.test(credential.pending.codeVerifier))fail('UNAUTHENTICATED','Pending device authorization lacks its protected PKCE verifier; logout and authorize again');
    if(credential.pending.outcomeUnknown)fail('OUTCOME_UNKNOWN','The previous token exchange outcome is unknown; logout and start a new authorization',{outcomeUnknown:true});
    if(credential.pending.exchangeState==='running')fail('CONFLICT','A device exchange is already running; inspect status or explicitly logout before authorizing again',{state:'running'});
    if(Date.parse(credential.expiresAt)<=Date.now()){
      await context.store.compareAndSwap(context.selection,snapshot.version,null);fail('UNAUTHENTICATED','Device authorization expired; start a new explicit login');
    }
    if(!config){config=await identityConfig(context,credential);endpoints=await discover(context,config);}
    if(Date.now()>=deadline)return pendingView(credential,context.selection,{timedOut:true});
    const next=credential.pending.nextPollAt||0;
    if(next>Date.now()){
      if(!wait||Date.now()>=deadline)return pendingView(credential,context.selection,{...(wait?{timedOut:true}:{})});
      await boundedDelay(Math.min(next-Date.now(),Math.max(0,deadline-Date.now())),context.signal);continue;
    }
    const claimed={...credential,pending:{...credential.pending,exchangeState:'running',nextPollAt:Date.now()+credential.pending.intervalSeconds*1000}};
    const claim=await context.store.compareAndSwap(context.selection,snapshot.version,claimed);
    if(!claim)fail('CONFLICT','Another process changed this authorization; inspect auth status');
    snapshot=claim;credential=claimed;
    let result;
    try{result=await oauth(context,endpoints.token_endpoint,{client_id:CLIENT,grant_type:'urn:ietf:params:oauth:grant-type:device_code',device_code:credential.pending.deviceCode,code_verifier:credential.pending.codeVerifier},Math.max(1,deadline-Date.now()));}
    catch(error){await settle(context,snapshot.version,{...credential,pending:{...credential.pending,exchangeState:error.details?.outcomeUnknown?'unknown':undefined,...(error.details?.outcomeUnknown?{outcomeUnknown:true}:{})}},error);throw error;}
    if(!result.ok){
      if(['authorization_pending','slow_down'].includes(result.payload?.error)){
        const intervalSeconds=credential.pending.intervalSeconds+(result.payload.error==='slow_down'?5:0);
        const updated={...credential,pending:{...credential.pending,exchangeState:undefined,intervalSeconds,nextPollAt:Date.now()+intervalSeconds*1000}};
        if(!await settle(context,snapshot.version,updated))fail('CONFLICT','Pending authorization was cancelled or changed while polling');
        if(!wait||Date.now()>=deadline)return pendingView(updated,context.selection,{...(wait?{timedOut:true}:{})});
        continue;
      }
      if(['access_denied','expired_token','invalid_grant'].includes(result.payload?.error))await settle(context,snapshot.version,null);
      else await settle(context,snapshot.version,{...credential,pending:{...credential.pending,exchangeState:undefined}});
      throw oauthFailure(result);
    }
    try{
      const nextCredential=await returnedCredential(context,endpoints,result.payload,credential);
      return await persistVerified(context,endpoints,snapshot,nextCredential);
    }catch(error){
      await settle(context,snapshot.version,{...credential,pending:{...credential.pending,exchangeState:'unknown',outcomeUnknown:true}},error);
      throw error;
    }
  }
}
async function refresh(context){
  const snapshot=await context.store.snapshot(context.selection),credential=snapshot.credential;
  if(credential?.mode!=='unified'||!credential.accessToken||!credential.refreshToken||credential.pending)fail('UNAUTHENTICATED','This slot has no online unified refresh grant');
  remember(credential,context.secrets);
  if(credential.refreshState)fail('CONFLICT','A refresh is running or its outcome is unknown; inspect status and logout before authorizing again',{state:credential.refreshState});
  const config=await identityConfig(context,credential),endpoints=await discover(context,config);
  const running={...credential,refreshState:'running'};
  const claimed=await context.store.compareAndSwap(context.selection,snapshot.version,running);
  if(!claimed)fail('CONFLICT','The credential changed before refresh dispatch');
  let result;
  try{result=await oauth(context,endpoints.token_endpoint,{client_id:CLIENT,grant_type:'refresh_token',refresh_token:credential.refreshToken});}
  catch(error){await settle(context,claimed.version,error.details?.outcomeUnknown?{...credential,refreshState:'unknown'}:credential,error);throw error;}
  if(!result.ok){await settle(context,claimed.version,result.payload?.error==='invalid_grant'?null:credential);throw oauthFailure(result);}
  let next;
  try{next=await returnedCredential(context,endpoints,result.payload,credential);}catch(error){await settle(context,claimed.version,{...credential,refreshState:'unknown'},error);throw error;}
  try{return await persistVerified(context,endpoints,claimed,next);}
  catch(error){await settle(context,claimed.version,{...credential,refreshState:'unknown'},error);throw error;}
}
export async function logoutUnified(context,credential,options){
  const base={localCleared:true,scope:'current CLI credential slot and this site client grant',allSitesLoggedOut:false};
  remember(credential,context.secrets);
  if(options.local)return{...base,remoteRevocation:'not_requested',revocationConfirmed:false};
  if(!credential.accessToken&&!credential.refreshToken)return{...base,remoteRevocation:'not_attempted',revocationConfirmed:false,note:'Local device authorization removed; provider device code expires at its original deadline.'};
  try{
    const config=await identityConfig(context,credential),endpoints=await discover(context,config);
    const result=await revokeUnified(context,endpoints,credential);
    if(['unknown','failed'].includes(result.remoteRevocation))fail(result.cancelled?'CANCELLED':result.remoteRevocation==='unknown'?'OUTCOME_UNKNOWN':'SERVICE_UNAVAILABLE','Local logout completed; remote grant revocation could not be confirmed',{...base,...result,outcomeUnknown:result.remoteRevocation==='unknown'});
    return{...base,...result,note:'An accepted RFC 7009 response does not prove the grant was previously valid or is now inactive.'};
  }catch(error){if(error instanceof CliError)error.details={...base,remoteRevocation:'not_attempted',revocationConfirmed:false,...error.details};throw error;}
}
export async function unifiedCommand(action,options,context){
  if(action==='login')return begin(context,options);
  if(action==='complete'||action==='wait'){
    const deadline=Date.now()+options.timeout;
    const boundedContext={...context,deadline,request:init=>{
      const remaining=deadline-Date.now();
      if(remaining<=0)fail('SERVICE_UNAVAILABLE','Device authorization deadline reached before request dispatch',{outcomeUnknown:false});
      return context.request({...init,timeout:Math.min(init.timeout||options.timeout,remaining)});
    }};
    return complete(boundedContext,options,action==='wait');
  }
  if(action==='refresh')return refresh(context);
  const credential=await context.store.load(context.selection);remember(credential,context.secrets);
  if(action==='status'){
    if(!credential)fail('UNAUTHENTICATED','No identity in the selected slot; use auth login');
    if(options.local)return{...publicCredential(credential,context.selection),verification:'local',serverVerified:false};
    if(credential.pending)return pendingView(credential,context.selection);
    assertCredential(credential);await identityConfig(context,credential);
    const server=await verifyMe(context,{...credential},credential);
    return{...publicCredential(credential,context.selection),verification:'server',serverVerified:true,server};
  }
  fail('USAGE','Use auth login, complete, wait, refresh, status or logout');
}
async function boundedDelay(ms,signal){
  if(signal?.aborted)fail('CANCELLED','Authorization wait cancelled',{outcomeUnknown:false});
  return new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(new CliError('CANCELLED','Authorization wait cancelled',{outcomeUnknown:false}));};const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},Math.max(1,ms));signal?.addEventListener('abort',abort,{once:true});});
}
