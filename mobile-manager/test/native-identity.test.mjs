import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeIdentity} from '../web/native-identity.js';
import {createApi} from '../web/api.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const signedIn={available:true,mode:'oidc',configured:true,authenticated:true};
function fixture(options={}) {
  const events=new EventTarget(),calls=[];let status={...signedIn};
  const emit=(name,detail)=>{const event=new Event(name);Object.defineProperty(event,'detail',{value:detail});events.dispatchEvent(event);};
  const bridge={getStatus:()=>JSON.stringify(status),request:(...args)=>calls.push(args),login:()=>JSON.stringify({...status,authenticated:false}),logout:()=>{status={...status,authenticated:false};return JSON.stringify(status);}};
  const identity=createNativeIdentity({bridge,events,...options});
  const respond=(call,body,status=200,headers={'content-type':'application/json'})=>emit('ziwei:identity-response',{id:call[0],status,headers,body:typeof body==='string'?body:JSON.stringify(body)});
  return {identity,events,bridge,calls,respond,emit,setStatus:value=>{status=value;emit('ziwei:identity',value);}};
}

test('native JSON responses correlate by request id, including out of order and duplicate events',async t=>{
  const f=fixture();t.after(()=>f.identity.dispose());
  const a=f.identity.fetch('/api/auth/me'),b=f.identity.fetch('/api/workspaces');await tick();
  assert.equal(f.calls.length,2);assert.notEqual(f.calls[0][0],f.calls[1][0]);
  f.respond(['unknown'],{ignored:true});f.respond(f.calls[1],{workspaces:[]});f.respond(f.calls[0],{user_id:'native-server-id'});f.respond(f.calls[0],{wrong:true});
  assert.deepEqual(await (await a).json(),{user_id:'native-server-id'});assert.deepEqual(await (await b).json(),{workspaces:[]});
});

test('present but malformed or unregistered bridge fails closed without browser fetch',async t=>{
  assert.equal(createNativeIdentity({bridge:null}),null);
  for(const bridge of [{},{getStatus:()=>'{bad-json',request(){},login(){},logout(){}},{getStatus:async()=>JSON.stringify({...signedIn,configured:false,message:'客户端尚未注册'}),request(){},login(){},logout(){}}]){
    const identity=createNativeIdentity({bridge,events:new EventTarget()}),api=createApi({identity,fetchImpl:()=>assert.fail('cookie fallback')});t.after(()=>api.dispose());
    assert.equal((await api.getIdentityStatus()).authenticated,false);
    await assert.rejects(api.authMe(),e=>e.code==='NATIVE_IDENTITY_UNCONFIGURED'&&e.uncertain===false);
    await assert.rejects(api.login({email:'legacy@example.test',password:'unused'}),e=>e.code==='NATIVE_IDENTITY_UNCONFIGURED');
  }
});

test('native pending requests and deadlines are bounded and mutation timeouts never replay',async t=>{
  const f=fixture({maxPending:1,readTimeoutMs:15,mutationTimeoutMs:15});t.after(()=>f.identity.dispose());
  const read=f.identity.fetch('/api/workspaces');const rejected=assert.rejects(read,e=>e.code==='READ_TIMEOUT'&&e.uncertain===false);await tick();
  await assert.rejects(f.identity.fetch('/api/auth/me'),e=>e.code==='NATIVE_PENDING_LIMIT');await rejected;
  const write=f.identity.fetch('/api/conversations/original/messages',{method:'POST',body:JSON.stringify({clientMessageId:'same-id'})});
  await assert.rejects(write,e=>e.code==='NATIVE_REQUEST_TIMEOUT'&&e.uncertain===true);
  assert.equal(f.calls.length,2);assert.equal(JSON.parse(f.calls[1][4]).clientMessageId,'same-id');
});

test('abort prevents an undispatched read and removes dispatched read correlation',async t=>{
  const f=fixture();t.after(()=>f.identity.dispose());
  const before=new AbortController();before.abort();
  await assert.rejects(f.identity.fetch('/api/workspaces',{signal:before.signal}),e=>e.code==='READ_CANCELLED');assert.equal(f.calls.length,0);
  const after=new AbortController(),pending=f.identity.fetch('/api/workspaces',{signal:after.signal});const rejection=assert.rejects(pending,e=>e.code==='READ_CANCELLED');await tick();after.abort();await rejection;
  f.respond(f.calls[0],{workspaces:[{slug:'late'}]});assert.equal(f.calls.length,1);
});

test('identity changes invalidate pending responses and unread response bodies from the old account',async t=>{
  const f=fixture();t.after(()=>f.identity.dispose());
  const pending=f.identity.fetch('/api/workspaces'),rejected=assert.rejects(pending,e=>e.code==='AUTH_CHANGED');await tick();
  f.setStatus({...signedIn,authenticated:false});await rejected;f.respond(f.calls[0],{workspaces:[{slug:'old'}]});
  f.setStatus(signedIn);const next=f.identity.fetch('/api/auth/me');await tick();f.respond(f.calls.at(-1),{user_id:'old-account'});const response=await next;
  f.setStatus({...signedIn,authenticated:false});await assert.rejects(response.json(),e=>e.code==='AUTH_CHANGED');
});

test('native transport accepts only relative API JSON and never forwards credential headers',async t=>{
  const f=fixture();t.after(()=>f.identity.dispose());
  for(const path of ['https://ziwei.qzelynth.top/api/auth/me','//other.invalid/api/me','/other','/api/../auth','/api/%2e%2e/auth','/api/me#fragment','/api/\\other'])await assert.rejects(f.identity.fetch(path));
  for(const name of ['Authorization','Cookie','Host'])await assert.rejects(f.identity.fetch('/api/auth/me',{headers:{[name]:'do-not-forward'}}),e=>e.code==='NATIVE_HEADERS_INVALID');
  await assert.rejects(f.identity.fetch('/api/me',{method:'POST',body:{invalid:true}}),e=>e.code==='NATIVE_BODY_INVALID');
  assert.equal(f.calls.length,0);
});

test('createApi native mode retains ETags but resets snapshots and pending reads across account events',async t=>{
  const f=fixture(),api=createApi({identity:f.identity,fetchImpl:()=>assert.fail('browser fallback')});t.after(()=>api.dispose());
  let pending=api.employees('original');await tick();f.respond(f.calls.at(-1),{employees:[{id:'original'}]},200,{etag:'"old"'});await pending;
  pending=api.employees('original');await tick();assert.equal(JSON.parse(f.calls.at(-1)[3])['if-none-match'],'"old"');f.respond(f.calls.at(-1),'',304);assert.equal((await pending).employees[0].id,'original');
  pending=api.employees('original');const rejected=assert.rejects(pending,e=>e.code==='AUTH_CHANGED');await tick();f.setStatus(signedIn);await rejected;
  pending=api.employees('original');await tick();assert.equal(JSON.parse(f.calls.at(-1)[3])['if-none-match'],undefined);f.respond(f.calls.at(-1),{employees:[]});await pending;
});

test('native API preserves actual authorization failure without automatically enabling another service',async t=>{
  const f=fixture(),api=createApi({identity:f.identity});t.after(()=>api.dispose());
  const pending=api.mobileNotifications('original'),rejected=assert.rejects(pending,e=>e.status===403&&e.code==='UNIFIED_STREAM_DISABLED');await tick();
  f.respond(f.calls[0],{error:'当前通知不可用',code:'UNIFIED_STREAM_DISABLED'},403);await rejected;
  assert.equal(f.calls.length,1);assert.match(f.calls[0][1],/notifications-v2/);
});

// Run actual adapter output through the dependency-free Java policy, so native
// request-id/body changes cannot silently break an otherwise green JS mock.
test('generated bridge calls satisfy the actual Java request id, API path and no-body rules',async t=>{
  const {spawnSync}=await import('node:child_process'),fs=await import('node:fs/promises'),path=await import('node:path'),os=await import('node:os'),{fileURLToPath}=await import('node:url');
  const javaHome=process.env.ZIWEI_JAVA_HOME||process.env.JAVA_HOME;
  const javac=javaHome?path.join(javaHome,'bin','javac'): 'javac',java=javaHome?path.join(javaHome,'bin','java'): 'java';
  const probe=spawnSync(javac,['-version'],{encoding:'utf8'});
  if(probe.error||probe.status!==0){t.skip('Working JDK unavailable; set ZIWEI_JAVA_HOME');return;}
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'ziwei-bridge-contract-'));
  t.after(async()=>{const absolute=path.resolve(temporary),base=path.resolve(os.tmpdir())+path.sep;if(!absolute.startsWith(base)||!path.basename(absolute).startsWith('ziwei-bridge-contract-'))throw new Error('Unexpected test directory');await fs.rm(absolute,{recursive:true,force:true});});
  const f=fixture();t.after(()=>f.identity.dispose());
  const reads=[f.identity.fetch('/api/auth/me'),f.identity.fetch('/api/workspaces/original/conversations?employeeId=original'),f.identity.fetch('/api/conversations/main/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:'原消息',clientMessageId:'stable-request'})})];await tick();
  reads.forEach(read=>read.catch(()=>{}));
  for(const call of f.calls)assert.match(call[0],/^[A-Za-z0-9_-]{1,100}$/);
  const source=path.join(temporary,'BridgeContractProbe.java');
  await fs.writeFile(source,'package com.ziwei.manager; public class BridgeContractProbe { public static void main(String[] args) { for(int i=0;i<args.length;i+=4){ if(!OidcRules.requestId(args[i])) throw new AssertionError("id"); OidcRules.apiPath(args[i+1]); byte[] body=OidcRules.body(args[i+2],args[i+3]); if(args[i+2].equals("GET")&&body!=null) throw new AssertionError("GET body"); } System.out.println("Generated web bridge contract passed"); } }');
  const rules=fileURLToPath(new URL('../android/src/com/ziwei/manager/OidcRules.java',import.meta.url));
  let run=spawnSync(javac,['--release','8','-encoding','UTF-8','-d',temporary,rules,source],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);
  run=spawnSync(java,['-ea','-cp',temporary,'com.ziwei.manager.BridgeContractProbe',...f.calls.flatMap(call=>[call[0],call[1],call[2],call[4]])],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);assert.match(run.stdout,/contract passed/);
  f.calls.forEach(call=>f.respond(call,{}));await Promise.all(reads);
});

test('read abort, timeout and identity invalidation cancel native reads only, without cancelling mutations',async t=>{
  const f=fixture({readTimeoutMs:15,mutationTimeoutMs:20}),cancelled=[];f.bridge.cancel=id=>cancelled.push(id);t.after(()=>f.identity.dispose());
  const abort=new AbortController(),read=f.identity.fetch('/api/workspaces',{signal:abort.signal});const rejected=assert.rejects(read);await tick();abort.abort();await rejected;
  const timeout=f.identity.fetch('/api/auth/me');await assert.rejects(timeout,e=>e.code==='READ_TIMEOUT');
  const mutation=f.identity.fetch('/api/conversations/original/messages',{method:'POST',body:'{}'});const mutationRejected=assert.rejects(mutation,e=>e.code==='NATIVE_REQUEST_TIMEOUT');await mutationRejected;
  const stale=f.identity.fetch('/api/workspaces'),staleRejected=assert.rejects(stale,e=>e.code==='AUTH_CHANGED');await tick();f.setStatus({...signedIn,authenticated:false});await staleRejected;
  assert.deepEqual(cancelled,[f.calls[0][0],f.calls[1][0],f.calls[3][0]]);assert(!cancelled.includes(f.calls[2][0]));
});
