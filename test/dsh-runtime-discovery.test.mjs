import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const module=await import('../src/dsh-runtime-discovery.mjs').catch(error=>{
  if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;
  return {};
});
const cli={bridge:{name:'ziwei_user',platform:'win32',arch:'x64'},discoveredAt:'2026-10-29T00:00:00.000Z',runtimes:{Codex:{status:'available',version:'fixture-version'}}};
const response=bots=>({ok:true,status:200,json:async()=>({root:'PRIVATE_ROOT',serverCmd:'PRIVATE_COMMAND',bots})});
function discover(options={}){
  assert.equal(typeof module.createRuntimeDiscovery,'function','native DSH runtime discovery must be implemented');
  return module.createRuntimeDiscovery({discoverCli:()=>cli,...options});
}

test('DSH discovery reads only the native Hub state and publishes Bot names with honest readiness',async()=>{
  const calls=[],read=discover({env:{ZIWEI_DSH_BASE_URL:'http://native.fixture:7878'},fetchImpl:async(url,options)=>{
    calls.push({url,options});
    return response([{name:'research-bot',running:true,ready:true,url:'http://private/?token=PRIVATE_TOKEN',proxyUrl:'PRIVATE_PROXY',folder:'PRIVATE_FOLDER',workdir:'PRIVATE_WORKDIR',logTail:'PRIVATE_LOG',metadata:{model:'PRIVATE_MODEL'},port:9876,runtimeBase:'PRIVATE_RUNTIME'},
      {name:'starting-bot',running:true,ready:false},{name:'stopped-bot',running:false,ready:true}]);
  }});
  const result=await read({force:true}),dsh=result.runtimes.DSH;
  assert.equal(calls[0].url,'http://native.fixture:7878/api/state');assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.redirect,'error');
  assert.ok(calls[0].options.signal instanceof AbortSignal);assert.equal(calls.length,1);
  assert.equal(dsh.status,'available');assert.equal(dsh.version,null);assert.equal(dsh.source,'dsh-native-http');assert.equal(dsh.detection.source,'dsh-native-http');
  assert.deepEqual(dsh.profiles.map(profile=>[profile.name,profile.readiness.ready]),[['research-bot',true],['starting-bot',false],['stopped-bot',false]]);
  assert.match(dsh.profiles[1].readiness.reason,/就绪/);assert.match(dsh.profiles[2].readiness.reason,/运行/);
  assert.equal(dsh.readiness.provider,'native');assert.equal(dsh.readiness.authentication,'native');
  assert.equal(JSON.stringify(dsh).includes('PRIVATE_'),false);assert.equal(Object.keys(dsh.profiles[0]).sort().join(','),'name,readiness');
  assert.equal(result.bridge,cli.bridge);assert.equal(result.discoveredAt,cli.discoveredAt);assert.equal(result.runtimes.Codex,cli.runtimes.Codex);assert.equal(cli.runtimes.DSH,undefined);
});

test('a reachable Hub with no Bots is available while reporting no bindable Bot',async()=>{
  const read=discover({env:{},fetchImpl:async url=>{assert.equal(url,'http://127.0.0.1:7878/api/state');return response([]);}});
  const dsh=(await read()).runtimes.DSH;
  assert.equal(dsh.status,'available');assert.deepEqual(dsh.profiles,[]);assert.equal(dsh.readiness.ready,false);assert.match(dsh.readiness.reason,/尚无.*Bot/);
});

test('DSH refresh has its own ten-second TTL and force preserves CLI discovery options and timestamps',async()=>{
  let now=1000,calls=0;const options=[];
  const read=discover({env:{},now:()=>now,discoverCli:value=>{options.push(value);return cli;},fetchImpl:async()=>{calls++;return response([{name:'bot',running:true,ready:calls>1}]);}});
  const first=await read(),cached=await read();assert.equal(calls,1);assert.equal(first.runtimes.DSH,cached.runtimes.DSH);
  now+=9999;await read();assert.equal(calls,1);
  now++;const renewed=await read();assert.equal(calls,2);assert.equal(renewed.runtimes.DSH.profiles[0].readiness.ready,true);
  await read({force:true});assert.equal(calls,3);assert.equal(options.at(-1).force,true);
  assert.ok(options.slice(0,-1).every(value=>value.force===false));assert.equal(renewed.discoveredAt,cli.discoveredAt);
});

test('unreachable, rejected, invalid and timed-out Hub state is explicit and never exposes raw diagnostics',async()=>{
  for(const fetchImpl of [async()=>{throw new Error('PRIVATE_NETWORK_URL_TOKEN');},async()=>({ok:false,status:503,json:async()=>({error:'PRIVATE_SERVER_ERROR'})}),async()=>({ok:true,json:async()=>{throw new Error('PRIVATE_JSON');}}),async()=>({ok:true,json:async()=>({bots:'PRIVATE_INVALID_BOTS'})})]){
    const dsh=(await discover({env:{},fetchImpl})()).runtimes.DSH;
    assert.equal(dsh.status,'unavailable');assert.equal(dsh.readiness.ready,false);assert.deepEqual(dsh.profiles,[]);assert.equal(dsh.readiness.provider,'unknown');assert.ok(dsh.detection.reasonCode);assert.equal(JSON.stringify(dsh).includes('PRIVATE_'),false);
  }
  let cliCalls=0;
  const read=discover({env:{},timeoutMs:20,discoverCli:()=>{cliCalls++;return cli;},fetchImpl:(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))});
  const pending=read();assert.equal(cliCalls,1,'a waiting Hub cannot prevent CLI discovery');
  const dsh=(await pending).runtimes.DSH;assert.equal(dsh.status,'unavailable');assert.equal(dsh.detection.reasonCode,'DSH_HUB_TIMEOUT');
});

test('daemon startup, periodic heartbeat and explicit refresh publish the same sanitized discovery',async()=>{
  const daemon=fs.readFileSync(new URL('../daemon/ziwei_user.mjs',import.meta.url),'utf8');
  const initialization=daemon.match(/const discoverRuntimes=createRuntimeDiscovery\(\);\r?\nlet runtimeDiscovery = await discoverRuntimes\([^\n]+/);
  assert.ok(initialization,'daemon must initialize its runtime coordinator');
  const source=name=>{const start=daemon.indexOf(`async function ${name}(`);return daemon.slice(start,daemon.indexOf('\n}',start)+2);};
  const options=[],published=[],registered=[],read=discover({env:{},discoverCli:value=>{options.push(value);return cli;},fetchImpl:async()=>response([{name:'native-bot',running:true,ready:true,logTail:'PRIVATE_LOG'}])});
  let harness;
  const bindings={createRuntimeDiscovery:()=>read,draining:false,config:{workspace:'fixture'},connections:new Map([['fixture',{}]]),
    heartbeatConnection:async()=>published.push(harness.snapshot()),log:()=>{},CLIENT_BUILD:'fixture-build',clientRuntimeDiscovery:()=>({}),
    fetch:async(_url,{body})=>{registered.push(JSON.parse(body));return{ok:true};},daemonHeaders:()=>({})};
  harness=await Function(...Object.keys(bindings),`return (async()=>{let missingWorkspaceLogged=false;${initialization[0]}\n${source('heartbeat')}\n${source('refreshRuntimeDiscovery')}\nreturn {snapshot:()=>runtimeDiscovery,heartbeat,refreshRuntimeDiscovery};})();`)(...Object.values(bindings));
  assert.equal(harness.snapshot().runtimes.DSH.profiles[0].name,'native-bot');
  await harness.heartbeat();await harness.refreshRuntimeDiscovery({config:{workspace:'fixture',apiBase:'http://api.fixture',deviceId:'pc'}});
  assert.deepEqual(options.map(value=>value.force),[true,false,true]);
  assert.equal(published[0].runtimes.DSH.status,'available');assert.equal(registered[0].runtimes.DSH.profiles[0].name,'native-bot');
  assert.equal(registered[0].runtimeDiscovery!==undefined,true);assert.equal(JSON.stringify(registered).includes('PRIVATE_'),false);
});

test('the real daemon action transport preserves server error codes without loosening HTTP failures',async()=>{
  const daemon=fs.readFileSync(new URL('../daemon/ziwei_user.mjs',import.meta.url),'utf8'),start=daemon.indexOf('async function postAction('),end=daemon.indexOf('\n}',start);
  for(const [status,code] of [[409,'CONVERSATION_QUEUE_PAUSED'],[403,'BOT_BINDING_CONFLICT']]){
    const post=Function('fetch','daemonHeaders','ACTION_TRANSPORT_BUDGETS',`return (${daemon.slice(start,end+2)});`)(async()=>({ok:false,status,json:async()=>({error:'fixture rejection',code})}),()=>({}),{ack:1000});
    await assert.rejects(post({config:{apiBase:'http://transport.fixture'}},'/a2a/v1/actions/fixture/ack',{}),error=>error.status===status&&error.code===code&&error.message==='fixture rejection');
  }
});
