import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {CredentialStore, publicCredential} from '../src/config.mjs';
import {ensureUnifiedCredential, unifiedCommand} from '../src/unified.mjs';
import {CliError} from '../src/errors.mjs';
import {runCli} from '../src/main.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const issuer='https://auth.example/realms/ziwei';
const selection={origin:'https://workspace.example',profile:'test',account:'test',purpose:'person'};
const initial=()=>({mode:'unified',identitySource:'unified-oidc-device',issuer,clientId:'ziwei-workspace-cli',audience:'ziwei-workspace-api',apiBase:selection.origin,workspace:'bigtron',accessToken:'old-access',refreshToken:'old-refresh',expiresAt:new Date(Date.now()-1000).toISOString(),scopes:['openid','workspace:read','workspace:write'],identity:{subject:'test-subject'}});
async function fixture(t,handler){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'workspace-session-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const store=new CredentialStore(root);await store.save(selection,initial());
 const calls=[];
 const context={store,selection,env:{},secrets:[],request:async init=>{
  calls.push(init);
  if(init.path==='/api/identity/config')return{payload:{service:'workspace',mode:'unified',ready:true,issuer,cliClientId:'ziwei-workspace-cli',audience:'ziwei-workspace-api',scopes:['openid','workspace:read','workspace:write'],cliTransports:['native']}};
  if(init.path.endsWith('/.well-known/openid-configuration'))return{payload:{issuer,device_authorization_endpoint:issuer+'/device',token_endpoint:issuer+'/token',revocation_endpoint:issuer+'/revoke'}};
  return handler(init,store);
 }};
 return{context,calls,store};
}
const tokenReply=scope=>({ok:true,status:200,payload:{access_token:'new-access',refresh_token:'new-refresh',token_type:'Bearer',expires_in:300,refresh_expires_in:604800,scope:scope||'openid workspace:read workspace:write'}});
const me=()=>({payload:{verified:true,verification:'server',identity:{issuer,subject:'test-subject'},user:{id:'native-user'},memberships:[{slug:'bigtron'}],scopes:['openid','workspace:read','workspace:write']}});

test('expired access token automatically refreshes once across concurrent callers',async t=>{
 let exchanges=0;const {context,store}=await fixture(t,async init=>{
  if(init.path===issuer+'/token'){exchanges++;await new Promise(r=>setTimeout(r,60));return tokenReply();}return me();
 });
 const results=await Promise.all([ensureUnifiedCredential(context),ensureUnifiedCredential(context)]);
 assert.equal(exchanges,1);assert.ok(results.every(v=>v.accessToken==='new-access'));
 assert.equal((await store.load(selection)).refreshToken,'new-refresh');
});
test('503 preserves the recoverable refresh grant and does not force new login',async t=>{
 const {context,store}=await fixture(t,async()=>({ok:false,status:503,payload:{error:'temporarily_unavailable'}}));
 await assert.rejects(ensureUnifiedCredential(context),e=>e.code==='SERVICE_UNAVAILABLE');
 assert.equal((await store.load(selection)).refreshToken,'old-refresh');assert.equal((await store.load(selection)).refreshState,undefined);
});
test('save rotated refresh token before API verification; transient /me failure loses nothing',async t=>{
 let exchanges=0,meCalls=0;
 const {context,store}=await fixture(t,async(init,s)=>{
  if(init.path===issuer+'/token'){exchanges++;return tokenReply();}
  const persisted=await s.load(selection);
  assert.equal(persisted.refreshToken,'new-refresh');assert.equal(persisted.serverVerificationPending,true);
  if(++meCalls===1)throw new CliError('SERVICE_UNAVAILABLE','temporary');
  return me();
 });
 await assert.rejects(ensureUnifiedCredential(context),e=>e.code==='SERVICE_UNAVAILABLE');
 const saved=await store.load(selection);assert.equal(saved.refreshToken,'new-refresh');assert.equal(saved.accessToken,'new-access');assert.notEqual(saved.refreshState,'unknown');
 assert.equal(saved.serverVerificationPending,true);
 assert.equal((await ensureUnifiedCredential(context)).accessToken,'new-access');
 assert.equal(exchanges,1);assert.equal(meCalls,2);assert.equal((await store.load(selection)).serverVerificationPending,undefined);
});
test('unknown refresh outcome fences only the same generation, never replays RT',async t=>{
 let exchanges=0;const {context,store}=await fixture(t,async()=>{exchanges++;throw new CliError('OUTCOME_UNKNOWN','timeout',{outcomeUnknown:true});});
 await assert.rejects(ensureUnifiedCredential(context),e=>e.code==='OUTCOME_UNKNOWN');
 await assert.rejects(ensureUnifiedCredential(context),e=>e.code==='OUTCOME_UNKNOWN');assert.equal(exchanges,1);
 const saved=await store.load(selection);assert.equal(saved.refreshToken,'old-refresh');
 await store.save(selection,{...initial(),accessToken:'fresh-login',refreshToken:'fresh-grant',expiresAt:new Date(Date.now()+300000).toISOString()});
 assert.equal((await ensureUnifiedCredential(context)).accessToken,'fresh-login');
});
test('invalid_grant cannot delete a newer generation saved by another operation',async t=>{
 const {context,store}=await fixture(t,async(init,s)=>{await s.save(selection,{...initial(),accessToken:'other-access',refreshToken:'other-refresh',expiresAt:new Date(Date.now()+300000).toISOString()});return{ok:false,status:400,payload:{error:'invalid_grant'}};});
 assert.equal((await ensureUnifiedCredential(context)).accessToken,'other-access');assert.equal((await store.load(selection)).refreshToken,'other-refresh');
});

test('invalid_grant preserves this generation as reauthorization_required and never replays it',async t=>{
 let exchanges=0;
 const {context,store}=await fixture(t,async()=>{exchanges++;return{ok:false,status:400,payload:{error:'invalid_grant'}};});
 await assert.rejects(ensureUnifiedCredential(context),error=>error.code==='UNAUTHENTICATED');
 const saved=await store.load(selection);
 assert.equal(saved.refreshToken,'old-refresh');assert.equal(saved.accessToken,'old-access');assert.equal(saved.refreshState,'reauthorization_required');
 const view=publicCredential(saved,selection);assert.equal(view.state,'reauthorization_required');assert.equal(view.completed,false);
 await assert.rejects(ensureUnifiedCredential(context),error=>error.code==='UNAUTHENTICATED'&&error.details.state==='reauthorization_required');
 assert.equal(exchanges,1);assert.deepEqual(await store.load(selection),saved);
});

test('refresh network wait in one selector does not block another selector',async t=>{
 let release,reached;const waiting=new Promise(resolve=>release=resolve),barrier=new Promise(resolve=>reached=resolve);
 const {context,store}=await fixture(t,async init=>{if(init.path===issuer+'/token'){reached();await waiting;return tokenReply();}return me();});
 const otherSelection={...selection,account:'independent'};await store.save(otherSelection,initial());
 const first=ensureUnifiedCredential(context);await barrier;
 const second=ensureUnifiedCredential({...context,selection:otherSelection,request:async init=>init.path===issuer+'/token'?tokenReply():init.path==='/api/identity/me'?me():context.request(init)});
 let timer;
 try{
  const next=await Promise.race([second,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('another selector was blocked by refresh I/O')),2000);})]);
  assert.equal(next.refreshToken,'new-refresh');assert.equal((await store.load(selection)).refreshState,'running');
 }finally{clearTimeout(timer);release();await Promise.allSettled([first,second]);}
 assert.equal((await first).refreshToken,'new-refresh');
});
test('long-lived mode is opt-in and preserves native site scopes',async t=>{
 for(const longLived of [false,true]){
  let requested;const {context,store}=await fixture(t,async init=>{requested=init.form.scope;return{ok:true,payload:{device_code:'private-code',user_code:'PUBLIC',verification_uri:issuer+'/verify',expires_in:300,interval:5}};});
  await store.clear(selection);await unifiedCommand('login',{workspace:'bigtron','long-lived':longLived},context);
  assert.equal(requested,'openid workspace:read workspace:write'+(longLived?' offline_access':''));
 }
});
test('scope offline_access accepted only for explicitly opted-in credential and idle is rolling',async t=>{
 const idleSeconds=1234567,started=Date.now();
 const {context,store}=await fixture(t,async init=>init.path===issuer+'/token'?({...tokenReply('openid workspace:read workspace:write offline_access'),payload:{...tokenReply('openid workspace:read workspace:write offline_access').payload,refresh_expires_in:idleSeconds}}):me());
 await store.save(selection,{...initial(),loginMode:'long-lived'});await ensureUnifiedCredential(context);
 const saved=await store.load(selection),view=publicCredential(saved,selection);
 assert.equal(view.loginMode,'long-lived');
 assert.ok(Date.parse(view.refreshIdleExpiresAt)>=started+idleSeconds*1000);
 assert.ok(Date.parse(view.refreshIdleExpiresAt)<=Date.now()+idleSeconds*1000);
 assert.equal(view.accessExpiresAt,saved.expiresAt);assert.equal(view.loginSessionExpiresAt,null);assert.equal(view.longLivedIdleDays,idleSeconds/86400);
 assert.equal(view.refreshToken,undefined);assert.equal(view.accessToken,undefined);
});
test('two actual CLI processes consume a rotating RT once under the per-profile lock',async t=>{
 const {store}=await fixture(t,async()=>{});
 const invoke=promisify(execFile),worker=new URL('./refresh-process-worker.mjs',import.meta.url);
 const {fileURLToPath}=await import('node:url');
 await Promise.all([invoke(process.execPath,[fileURLToPath(worker),store.root]),invoke(process.execPath,[fileURLToPath(worker),store.root])]);
 assert.equal((await fs.readFile(path.join(store.root,'test-exchange-count.txt'),'utf8')).trim(),'exchange');
 assert.equal((await store.load(selection)).refreshToken,'process-refresh');
});
test('actual business dispatch refreshes before a single write; 401 never replays the write',async t=>{
 const {store}=await fixture(t,async()=>{});let writes=0,exchanges=0,output='';
 const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
 const fetchImpl=async(url,init)=>{
  url=new URL(url);
  if(url.pathname==='/api/identity/config')return response({service:'workspace',mode:'unified',ready:true,issuer,cliClientId:'ziwei-workspace-cli',audience:'ziwei-workspace-api',scopes:['openid','workspace:read','workspace:write'],cliTransports:['native']});
  if(url.pathname.endsWith('/.well-known/openid-configuration'))return response({issuer,device_authorization_endpoint:issuer+'/device',token_endpoint:issuer+'/token'});
  if(url.href===issuer+'/token'){exchanges++;return response(tokenReply().payload);}
  if(url.pathname==='/api/identity/me')return response(me().payload);
  writes++;assert.equal(init.headers.authorization,'Bearer new-access');return response({error:'expired'},401);
 };
 // Select an existing native write with a small, valid schema rather than invent an API.
 const nativeOp=(await import('../src/registry.mjs')).operations.find(o=>o.name==='conversations.create');
 assert.ok(nativeOp&&!nativeOp.readOnly);
 const result=await runCli(['conversations','create','--employeeId','fixture-employee','--workspace','bigtron','--api',selection.origin,'--profile','test','--account','test'],{env:{ZIWEI_WORKSPACE_CONFIG_DIR:store.root},fetchImpl,stdout:s=>output+=s,stderr:()=>{}});
 assert.equal(result.exitCode,3,output);assert.equal(exchanges,1);assert.equal(writes,1);
 assert.equal(output.includes('new-refresh'),false);assert.equal(output.includes('new-access'),false);
});
