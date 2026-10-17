import test from 'node:test';
import assert from 'node:assert/strict';
import {createMcpConnections,mcpAuthorizationUrl,mcpConnectionActive,mcpConnectionLabel,sameMcpServer} from './bot-mcp-connections.js';

const scope={workspace:'team',actorId:'actor',botId:'bot'};
const binding={revision:3,controlEpoch:7};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const row=(status='connected',overrides={})=>({id:'connection-1',workspace:'team',employeeId:'bot',server:'library',idempotencyKey:'key-1',status,...overrides});
function fixture(overrides={}){
  let key=0,timerId=0;const timers=new Map(),calls={reads:[],posts:[],cancels:[]},values=new Map();
  const storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const behavior={read:async()=>({connections:[]}),connect:async(_id,body)=>({connection:row('connected',{idempotencyKey:body.idempotencyKey})}),cancel:async(_id,id)=>({connection:row('cancelled',{id})}),...overrides};
  const api={botMcpConnections:(...args)=>{calls.reads.push(args);return behavior.read(...args);},connectBotMcp:(...args)=>{calls.posts.push(args);return behavior.connect(...args);},cancelBotMcpConnection:(...args)=>{calls.cancels.push(args);return behavior.cancel(...args);}};
  const store=createMcpConnections({api,keyFactory:()=>`key-${++key}`,storage,timeoutMs:1000,pollMs:25,setTimer:callback=>{const id=++timerId;timers.set(id,callback);return id;},clearTimer:id=>timers.delete(id)});
  return {store,timers,calls,behavior,storage,values,keys:()=>key,async select(next=scope){store.select(next);await store.refresh();},async tick(){const [id,callback]=timers.entries().next().value||[];assert.ok(callback,'expected a poll timer');timers.delete(id);callback();await store.refresh();}};
}

test('select restores authorization and connected receipts through GET, polling only active connections',async()=>{
  const f=fixture({read:async()=>({connections:[row('authorization_required',{authorizationUrl:'https://auth.example.invalid/authorize?state=public'})]})});
  await f.select();assert.equal(f.calls.reads.length,1);assert.equal(f.store.state.ready,true);assert.equal(mcpConnectionLabel(f.store.state.connections.library),'等待授权');assert.equal(f.timers.size,1);
  f.behavior.read=async()=>({connections:[row('connected')]});await f.tick();assert.equal(f.store.state.connections.library.status,'connected');assert.equal(f.timers.size,0);f.store.dispose();
});

test('workspace, Bot and actor scope switches ignore the previous GET response and abort its request',async()=>{
  for(const change of [{workspace:'other'},{botId:'other-bot'},{actorId:'other-actor'}]){
    const old=deferred(),next={...scope,...change};let count=0;
    const f=fixture({read:()=>++count===1?old.promise:Promise.resolve({connections:[row('connected',{id:'new',workspace:next.workspace,employeeId:next.botId})]})});
    f.store.select(scope);const oldRead=f.store.refresh();f.store.select(next);await f.store.refresh();
    assert.equal(f.calls.reads[0][2].signal.aborted,true);old.resolve({connections:[row('connected',{id:'old'})]});await oldRead;
    assert.equal(f.store.state.connections.library.id,'new');assert.deepEqual(f.store.state.scope,next);f.store.dispose();
  }
});

test('scope changes cancel existing polling and a late old timer cannot read the new scope',async()=>{
  const f=fixture({read:async()=>({connections:[row('connecting')]})});await f.select();const late=f.timers.values().next().value;
  f.behavior.read=async()=>({connections:[]});await f.select({...scope,actorId:'another'});assert.equal(f.timers.size,0);
  const reads=f.calls.reads.length;late();await Promise.resolve();assert.equal(f.calls.reads.length,reads);f.store.dispose();
});

test('dispose ignores late POST responses and prevents a queued poll callback from reading again',async()=>{
  const post=deferred(),f=fixture({connect:()=>post.promise});await f.select();const pending=f.store.connect('library',binding);f.store.dispose();
  post.resolve({connection:row('connected')});assert.equal(await pending,false);assert.deepEqual(f.store.state.connections,{});assert.equal(f.calls.posts[0][3].signal.aborted,true);assert.equal(f.timers.size,0);
  const g=fixture({read:async()=>({connections:[row('connecting')]})});await g.select();const late=g.timers.values().next().value;g.store.dispose();late();await Promise.resolve();assert.equal(g.calls.reads.length,1);assert.equal(g.timers.size,0);
});

test('unknown POST performs GET and a matching idempotency key restores it without a second POST',async()=>{
  let reads=0;const f=fixture({read:async()=>{if(++reads===2)throw new Error('GET offline');return {connections:reads>=3?[row('authorization_required')]:[]};},connect:async()=>{throw new TypeError('response lost');}});
  await f.select();assert.equal(await f.store.connect('library',binding),false);assert.equal(f.store.state.pending.library.unknown,true);
  assert.equal(await f.store.connect('library',{revision:9,controlEpoch:10}),true);assert.equal(f.calls.posts.length,1);assert.equal(f.keys(),1);assert.equal(f.store.state.pending.library,undefined);assert.equal(f.store.state.connections.library.status,'authorization_required');f.store.dispose();
});

test('GET misses retain a lost POST identity and manual 403 retry uses its exact original body',async()=>{
  let posts=0;const f=fixture({connect:async()=>{if(++posts===1)throw new TypeError('lost');throw Object.assign(new Error('forbidden now'),{status:403});}});
  await f.select();await f.store.connect('library',binding);const original=structuredClone(f.calls.posts[0][1]);
  await f.store.connect('library',{revision:99,controlEpoch:99});assert.equal(f.keys(),1);assert.deepEqual(f.calls.posts[1][1],original);assert.equal(f.store.state.pending.library.unknown,true);
  assert.deepEqual(f.store.state.pending.library.body,original);assert.ok(f.values.size);f.store.dispose();
});

test('an explicit first 4xx rejection releases its identity for a corrected new request',async()=>{
  let posts=0;const f=fixture({connect:async(_id,body)=>{if(++posts===1)throw Object.assign(new Error('stale revision'),{status:409});return {connection:row('connected',{idempotencyKey:body.idempotencyKey})};}});
  await f.select();await f.store.connect('library',binding);assert.equal(f.store.state.pending.library,undefined);
  assert.equal(await f.store.connect('library',{revision:4,controlEpoch:8}),true);assert.equal(f.keys(),2);assert.equal(f.calls.posts[1][1].idempotencyKey,'key-2');assert.equal(f.calls.posts[1][1].expectedRevision,4);f.store.dispose();
});

test('double connect clicks dispatch once and the accepted response retains the exact request binding',async()=>{
  const post=deferred(),f=fixture({connect:()=>post.promise});await f.select();const first=f.store.connect('library',binding);
  assert.equal(await f.store.connect('library',binding),false);assert.equal(f.calls.posts.length,1);assert.deepEqual(f.calls.posts[0].slice(0,3),['bot',{server:'library',expectedRevision:3,expectedControlEpoch:7,idempotencyKey:'key-1'},'team']);
  post.resolve({connection:row('connected')});assert.equal(await first,true);assert.equal(f.store.state.busy.library,false);f.store.dispose();
});

test('a GET started before a new POST cannot overwrite the newer connection receipt',async()=>{
  const old=deferred(),f=fixture();await f.select();f.behavior.read=()=>old.promise;const oldRead=f.store.refresh();
  f.behavior.connect=async(_id,body)=>({connection:row('connected',{id:'new',idempotencyKey:body.idempotencyKey})});assert.equal(await f.store.connect('library',binding),true);
  old.resolve({connections:[row('connecting',{id:'old',idempotencyKey:'older-key'})]});await oldRead;assert.equal(f.store.state.connections.library.id,'new');assert.equal(f.store.state.connections.library.status,'connected');assert.equal(f.timers.size,0);f.store.dispose();
});

test('cancel uses the original connection ID and a terminal receipt ends polling',async()=>{
  const f=fixture({read:async()=>({connections:[row('authorization_required')]})});await f.select();assert.equal(f.timers.size,1);
  assert.equal(await f.store.cancel('library'),true);assert.deepEqual(f.calls.cancels[0].slice(0,3),['bot','connection-1','team']);assert.equal(f.store.state.connections.library.status,'cancelled');assert.equal(f.timers.size,0);f.store.dispose();
});

test('restored pending requests stay actor-scoped and never store authorization URLs',async()=>{
  const f=fixture({connect:async()=>{throw new Error('lost');}});await f.select();await f.store.connect('library',binding);
  const original=structuredClone(f.store.state.pending.library.body);await f.select({...scope,actorId:'other'});assert.deepEqual(f.store.state.pending,{});
  await f.select(scope);assert.deepEqual(f.store.state.pending.library.body,original);assert.equal(f.store.state.pending.library.unknown,true);
  for(const stored of f.values.values()){assert.doesNotMatch(stored,/authorizationUrl|access_token|refresh_token/);assert.deepEqual(JSON.parse(stored),[{body:original,unknown:true}]);}f.store.dispose();
});

test('malformed or wrong-scope GET rows never become connection status',async()=>{
  for(const bad of [row('connected',{workspace:'other'}),row('connected',{employeeId:'other'}),row('unknown'),row('connected',{idempotencyKey:''}),row('connected',{idempotencyKey:undefined})]){
    const f=fixture({read:async()=>({connections:[bad]})});await f.select();assert.equal(f.store.state.ready,false);assert.deepEqual(f.store.state.connections,{});assert.ok(f.store.state.error);f.store.dispose();
  }
});

test('authorization URLs reject executable protocols, userinfo, whitespace and controls',()=>{
  for(const bad of ['javascript:alert(1)','data:text/html,hi','https://user:password@example.invalid/auth','https://user%40example.invalid@example.invalid/auth','https://example.invalid/\nauth','https://example.invalid/auth\r',' https://example.invalid/auth','https://example.invalid/auth\u007f',null])assert.equal(mcpAuthorizationUrl(bad),'');
  assert.equal(mcpAuthorizationUrl('https://auth.example.invalid/authorize?state=public&code_challenge=challenge'),'https://auth.example.invalid/authorize?state=public&code_challenge=challenge');
  assert.equal(mcpAuthorizationUrl('http://127.0.0.1:4567/auth'),'http://127.0.0.1:4567/auth');
});

test('saved MCP comparison ignores object key order while preserving array order and option changes',()=>{
  const a={transport:'http',url:'https://mcp.invalid',oauth:{cimd:false,scope:'read'},tools:{include:['a','b'],prompts:true}};
  const b={tools:{prompts:true,include:['a','b']},oauth:{scope:'read',cimd:false},url:'https://mcp.invalid',transport:'http'};
  assert.equal(sameMcpServer(a,b),true);assert.equal(sameMcpServer(a,{...b,tools:{...b.tools,include:['b','a']}}),false);assert.equal(sameMcpServer(a,{...b,oauth:{scope:'read',cimd:true}}),false);assert.equal(sameMcpServer(null,b),false);
  for(const status of ['queued','connecting','authorization_required'])assert.equal(mcpConnectionActive({status}),true);
  for(const status of ['connected','failed','expired','cancelled','client_required'])assert.equal(mcpConnectionActive({status}),false);
});
