import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../daemon/ziwei_user.mjs',import.meta.url),'utf8');
function between(start,end){const from=source.indexOf(start),to=source.indexOf(end,from);assert(from>=0&&to>from);return source.slice(from,to);}

test('readyz stays ready and exposes archived-unconfirmed evidence as a non-blocking diagnostic',()=>{
  const archived={actionId:'archive-action',code:'DELIVERY_ARCHIVED_UNCONFIRMED',message:'服务器终态未确认；原始 action/result 证据已本地归档，不阻塞维护',reason:'SERVER_LEASE_EXPIRED',httpStatus:null,archivedAt:'2026-10-31T00:00:00.000Z',evidencePath:'C:\\private\\action-delivery\\archive.json',blocking:false,resultUnknown:true};
  let handler;
  const connection={config:{workspace:'archive-workspace',deviceId:'archive-device',primary:true,heartbeatMs:15000},dispatcher:{maintenancePausedActions:[],maintenancePendingCommits:[],quarantinedActionIds:[]},localExecutor:{maintenanceStatus:()=>({safe:true,workers:[]})},actionScheduler:{activeCount:0},actionDelivery:{pendingCount:0,blockedCount:0},managementBootstrap:{status:()=>({})},terminalStatus:null,polling:false,lastHeartbeatAt:Date.now(),lastHeartbeat:null};
  const context=vm.createContext({
    Map,Date,process:{pid:1234},config:connection.config,connections:new Map([['archive-workspace',connection]]),executionAllowed:()=>true,inspectLocalDaemonMaintenanceFiles:()=>({safe:true,stopSafe:true,retainedDeliveryCount:1,retainedBackgroundCount:0,archivedUnconfirmedCount:1,archivedUnconfirmed:[archived],issues:[],stopIssues:[]}),runtimeDiscovery:{runtimes:[]},primaryConnection:connection,VERSION:'test',CLIENT_BUILD:'test-build',ROOT:'C:\\ziwei',configPath:'C:\\ziwei\\config.json',runtimeDir:'C:\\ziwei\\runtime',lifecycleNonce:'nonce',lifecycleStartedAt:'2026-10-31T00:00:00.000Z',lifecycleConfigurationHash:()=>null,lastHeartbeat:null,lastHeartbeatAt:Date.now(),lastPoll:null,connectionErrors:[],draining:false,heartbeatFresh:()=>true,remoteClientUpdates:{status:()=>({})},privateIdentityRoute:()=>false,http:{createServer:callback=>{handler=callback;return{};}},setImmediate:()=>{},stop:()=>{}
  });
  vm.runInContext(`${between('function healthPayload() {','\nconst privateIdentityHandler=')}\n${between('const health = http.createServer(','\nlet stopping = false;')}`,context);
  const request={url:'/readyz',method:'GET',headers:{},socket:{remoteAddress:'127.0.0.1'}};
  const response={writeHead(status){this.status=status;},end(body){this.body=JSON.parse(body);}};
  handler(request,response);
  assert.equal(response.status,200);assert.equal(response.body.ready,true);assert.equal(response.body.maintenance.safe,true);assert.equal(response.body.maintenance.stopSafe,true);assert.deepEqual(response.body.diagnostics.delivery,[archived]);assert.deepEqual(response.body.maintenance.deliveryDiagnostics,[archived]);
});
