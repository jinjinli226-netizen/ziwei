import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import {timingSafeEqual} from 'node:crypto';

// Exercise the actual daemon callbacks without importing its listener/startup.
const source=fs.readFileSync(new URL('../daemon/ziwei_user.mjs',import.meta.url),'utf8');
function between(start,end){const from=source.indexOf(start),to=source.indexOf(end,from);assert(from>=0&&to>from);return source.slice(from,to);}
const healthFunctions=between('function healthPayload() {','\nconst privateIdentityHandler=');
const routeSource=between('const health = http.createServer(','\nlet stopping = false;');
const shutdownSource=between('function stop(signal) {',"\nprocess.on('SIGINT'");
const deferred=()=>{let resolve;const promise=new Promise(value=>{resolve=value;});return{promise,resolve};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));

function fixture(){
  const stopped=[],scheduled=[],gateway={safe:true,workers:[]};
  const fileEvidence={safe:false,stopSafe:true,retainedDeliveryCount:2,issues:[{code:'DELIVERY_NOT_DRAINED',path:'private-path'}],stopIssues:[]};
  const config={workspace:'local-stop',deviceId:'local-pc',deviceToken:'private-token',heartbeatMs:15000};
  const connection={config,dispatcher:{quarantinedActionIds:[]},localExecutor:{maintenanceStatus:()=>gateway},actionScheduler:{activeCount:0},actionDelivery:{pendingCount:0,blockedCount:2},managementBootstrap:{status:()=>({})},polling:false};
  let handler;
  const context=vm.createContext({Buffer,Date,Map,Set,timingSafeEqual,config,connections:new Map([['local-stop',connection]]),executionAllowed:()=>true,inspectLocalDaemonMaintenanceFiles:()=>fileEvidence,runtimeDiscovery:{runtimes:[]},primaryConnection:connection,VERSION:'test',CLIENT_BUILD:'test-build',ROOT:'private-path',configPath:'private-config-path',runtimeDir:'private-runtime-path',lifecycleNonce:'private-nonce',lifecycleStartedAt:'2026-10-15',lifecycleConfigurationHash:()=>null,lastHeartbeat:null,lastHeartbeatAt:0,lastPoll:null,process:{pid:1234},connectionErrors:[],draining:true,privateIdentityRoute:()=>false,heartbeatFresh:()=>true,log:()=>{},setImmediate:callback=>scheduled.push(callback),stop:signal=>stopped.push(signal),http:{createServer:callback=>{handler=callback;return{};}}});
  vm.runInContext(`${healthFunctions}\n${routeSource}`,context);
  const request=(operation='stop',nonce='private-nonce')=>{
    const req=new EventEmitter();Object.assign(req,{url:'/local/connection-control',method:'POST',headers:{'x-ziwei-local-control':'private-token'},socket:{remoteAddress:'127.0.0.1'},destroy(){throw new Error('unexpected request destruction');}});
    const response={writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=body?JSON.parse(body):null;}};
    handler(req,response);req.emit('data',JSON.stringify({operation,nonce}));req.emit('end');return response;
  };
  return{context,connection,fileEvidence,gateway,request,stopped,scheduled,health:()=>vm.runInContext('healthPayload()',context)};
}

test('daemon health retains strict unsafe while a verified retained queue may stop',()=>{
  const f=fixture(),state=f.health();
  assert.equal(state.maintenance.safe,false);assert.equal(state.maintenance.stopSafe,true);assert.equal(state.maintenance.retainedDeliveryCount,2);assert.equal(state.maintenance.blockedDeliveryCount,2);
  const response=f.request();assert.equal(response.status,200);assert.equal(response.body.maintenance.safe,false);assert.equal(response.body.maintenance.stopSafe,true);
  assert.deepEqual(f.stopped,[]);assert.equal(f.scheduled.length,1);f.scheduled[0]();assert.deepEqual(f.stopped,['local_maintenance']);
});

for(const[reason,mutate]of [
  ['CONNECTION_NOT_DRAINING',f=>{f.context.draining=false;}],
  ['ACTIVE_ACTIONS',f=>{f.connection.actionScheduler.activeCount=1;}],
  ['ACTIVE_POLLS',f=>{f.connection.polling=true;}],
  ['EXECUTION_QUARANTINED',f=>{f.connection.dispatcher.quarantinedActionIds.push('unconfirmed');}],
  ['REGISTERED_GATEWAY_NOT_DRAINED',f=>{f.gateway.safe=false;f.gateway.workers.push({processAlive:true});}],
  ['DELIVERY_CORRUPT',f=>{f.fileEvidence.stopSafe=false;f.fileEvidence.stopIssues.push({code:'DELIVERY_CORRUPT',path:'private-path',message:'private-token'});}]
])test(`daemon refuses stop for ${reason} with finite safe diagnostics`,()=>{
  const f=fixture();mutate(f);const response=f.request();assert.equal(response.status,409);assert.equal(response.headers['cache-control'],'no-store');
  assert(response.body.reasons.some(row=>row.code===reason));assert.equal(response.body.error,'CLIENT_STOP_UNSAFE');
  assert.doesNotMatch(JSON.stringify(response.body),/private-token|private-nonce|private-path|private-config-path|private-runtime-path/);
  assert.equal(f.scheduled.length,0);assert.deepEqual(f.stopped,[]);
});

test('stop conflicts contain bounded reason codes and no private file or boot fields',()=>{
  const f=fixture();f.fileEvidence.stopSafe=false;
  f.fileEvidence.stopIssues=Array.from({length:30},(_,i)=>({code:`ISSUE_${i}`,path:'private-path',nonce:'private-nonce',token:'private-token'}));
  f.fileEvidence.stopIssues.push({code:'invalid/private-token',path:'private-path'});
  const response=f.request();assert.equal(response.status,409);assert.equal(response.body.reasons.length,16);assert.equal(response.body.moreReasonCount,15);assert(JSON.stringify(response.body).length<2500);
  assert.doesNotMatch(JSON.stringify(response.body),/private-|fileIssues|lifecycle|gatewayWorkers/);
  const mismatch=f.request('stop','different-boot');assert.equal(mismatch.status,409);assert.equal(mismatch.body.error,'CLIENT_CONTROL_IDENTITY_CHANGED');assert.doesNotMatch(JSON.stringify(mismatch.body),/private-/);
});

for(const gatewaySafe of [true,false])test(`shutdown waits for active actions, heartbeat and registered Gateway (confirmed ${gatewaySafe})`,async()=>{
  const actions=deferred(),gateway=deferred(),heartbeat=deferred(),closed=deferred(),events=[];let actionWaits=0,gatewayCloses=0;
  const processState={};
  const context=vm.createContext({Promise,stopping:false,draining:false,heartbeatTimer:null,pollTimer:null,clearInterval:()=>{},shutdownAbort:{abort:()=>events.push('abort')},health:{listening:true,close:callback=>{closed.promise.then(callback);}},connections:new Map([['local-stop',{actionScheduler:{whenIdle:()=>{actionWaits++;return actions.promise;}},localExecutor:{close:()=>{gatewayCloses++;return gateway.promise;},maintenanceStatus:()=>({safe:gatewaySafe})}}]]),activeHeartbeats:new Set([heartbeat.promise]),log:(event,details)=>events.push({event,details}),process:processState});
  vm.runInContext(shutdownSource,context);vm.runInContext("stop('local_maintenance')",context);await flush();
  assert.equal(actionWaits,1);assert.equal(gatewayCloses,1);assert.equal(context.draining,true);assert.equal(processState.exitCode,undefined);
  closed.resolve();gateway.resolve();await flush();assert.equal(processState.exitCode,undefined,'active original work must finish before exit');
  actions.resolve();await flush();assert.equal(processState.exitCode,undefined,'heartbeat still owns active IO');
  heartbeat.resolve();await flush();assert.equal(processState.exitCode,gatewaySafe?0:1);assert.equal(events.filter(row=>row?.event==='stopped').length,1);
  vm.runInContext("stop('SIGTERM')",context);assert.equal(actionWaits,1);assert.equal(gatewayCloses,1);
});
