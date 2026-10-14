import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createPrivateClientStateReader,loadPrivateClientIdentityConfiguration,createPrivateIdentityHttpRoute} from '../daemon/private-preservation-identity.mjs';

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-private-drain-'));t.after(()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert(path.basename(root).startsWith('ziwei-private-drain-'));fs.rmSync(root,{recursive:true,force:true});});
 const runtimeDir=path.join(root,'runtime');fs.mkdirSync(runtimeDir);fs.writeFileSync(path.join(runtimeDir,'action-state.json'),JSON.stringify({version:1,completed:[]}));
 const worker={processAlive:false,pendingCommands:0,inFlight:0,pendingInbound:0};
 const connection={config:{workspace:'fixture',deviceId:'device_fixture',apiBase:'http://127.0.0.1:6387',primary:true},hermesHomePath:root,runtimeDir,actionScheduler:{activeCount:0},dispatcher:{quarantinedActionIds:[]},actionDelivery:{pendingCount:0,blockedCount:0},localExecutor:{maintenanceStatus:()=>({safe:worker.processAlive===false&&!worker.pendingCommands&&!worker.inFlight&&!worker.pendingInbound,workers:[worker]})},polling:false};
 let draining=true,errors=[];const connections=new Map([['fixture',connection]]),read=createPrivateClientStateReader({connections,isDraining:()=>draining,connectionErrors:()=>errors});
 return{root,runtimeDir,connection,connections,worker,read,setDraining:value=>{draining=value;},setErrors:value=>{errors=value;}};
}
test('private state reader observes complete live Map and actual registered counters without changing disk',t=>{
 const f=fixture(t),before=fs.readFileSync(path.join(f.runtimeDir,'action-state.json'));const state=f.read();assert.equal(state.connectionState,'draining');assert.deepEqual(state.issues,[]);
 assert.deepEqual(state.connections,[{workspace:'fixture',deviceId:'device_fixture',apiBase:'http://127.0.0.1:6387',hermesHome:f.root,runtimeDir:f.runtimeDir,primary:true}]);
 for(const key of ['activeActionCount','pollingCount','quarantinedActionCount','pendingDeliveryCount','blockedDeliveryCount','managedAuxiliaryCount','gatewayPendingCount','gatewayInFlightCount','gatewayInboundCount'])assert.equal(state[key],0);
 f.connection.actionScheduler.activeCount=2;f.connection.polling=true;f.connection.dispatcher.quarantinedActionIds.push('unknown');f.connection.actionDelivery.pendingCount=3;f.connection.actionDelivery.blockedCount=4;Object.assign(f.worker,{processAlive:null,pendingCommands:5,inFlight:6,pendingInbound:7});
 const debt=f.read();assert.deepEqual([debt.activeActionCount,debt.pollingCount,debt.quarantinedActionCount,debt.pendingDeliveryCount,debt.blockedDeliveryCount,debt.managedAuxiliaryCount,debt.gatewayPendingCount,debt.gatewayInFlightCount,debt.gatewayInboundCount],[2,1,1,3,4,1,5,6,7]);assert(debt.issues.length);
 assert.deepEqual(fs.readFileSync(path.join(f.runtimeDir,'action-state.json')),before);
});
test('unrecovered corrupt delivery journal and connection errors cannot borrow zero in-memory counters',t=>{
 const f=fixture(t);fs.mkdirSync(path.join(f.runtimeDir,'action-delivery'));fs.writeFileSync(path.join(f.runtimeDir,'action-delivery','a'.repeat(64)+'.json'),'{');f.setErrors([{code:'fixture_connection_error'}]);
 assert.equal(f.read().pendingDeliveryCount,0);assert(f.read().issues.length>=2);f.setDraining(false);assert.equal(f.read().connectionState,'connected');
});
for(const value of [undefined,null,-1,NaN,'0',0.5])test(`unknown scheduler counter ${String(value)} is refused`,t=>{const f=fixture(t);f.connection.actionScheduler.activeCount=value;assert.throws(()=>f.read(),{code:'SOURCE_CLIENT_STATE_UNPROVEN'});});
test('throwing or malformed manager cannot be treated as no workers',t=>{
 const f=fixture(t);f.connection.localExecutor.maintenanceStatus=()=>{throw Error('fixture');};assert.throws(()=>f.read());f.connection.localExecutor.maintenanceStatus=()=>({safe:true});assert.throws(()=>f.read());
});
test('configuration is explicit private file only and invalid shape/read/link errors are finite',t=>{
 const f=fixture(t);assert.equal(loadPrivateClientIdentityConfiguration({}),null);const file=path.join(f.root,'identity.json');fs.writeFileSync(file,JSON.stringify({schemaVersion:1,hostId:'fixture',trust:{}}));
 assert.deepEqual(loadPrivateClientIdentityConfiguration({ZIWEI_PRODUCTION_CLIENT_IDENTITY_CONFIG:file}),{hostId:'fixture',trust:{}});
 fs.writeFileSync(file,JSON.stringify({schemaVersion:1,hostId:'fixture',trust:{},reader:'request-callback'}));assert.throws(()=>loadPrivateClientIdentityConfiguration({ZIWEI_PRODUCTION_CLIENT_IDENTITY_CONFIG:file}),{code:'SOURCE_CLIENT_CONFIGURATION'});
 for(const input of ['relative.json',file+'-missing'])assert.throws(()=>loadPrivateClientIdentityConfiguration({ZIWEI_PRODUCTION_CLIENT_IDENTITY_CONFIG:input}),{code:'SOURCE_CLIENT_CONFIGURATION'});
});
test('private raw HTTP adapter bounds JSON, only invokes loopback POST and adapts finite no-store errors',async t=>{
 let called=0;const route=createPrivateIdentityHttpRoute((req,res)=>{called++;assert.equal(req.body.hostId,'fixture');res.setHeader('Cache-Control','no-store');res.json({proof:'isolated'});}),server=http.createServer((req,res)=>{if(!route(req,res)){res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});const url=`http://127.0.0.1:${server.address().port}/internal/preservation/identity`;
 assert.equal((await fetch(url)).status,404);let response=await fetch(url,{method:'POST',body:'{'});assert.equal(response.status,403);assert.equal(response.headers.get('cache-control'),'no-store');
 response=await fetch(url,{method:'POST',body:JSON.stringify({hostId:'fixture'})});assert.equal(response.status,200);assert.deepEqual(await response.json(),{proof:'isolated'});assert.equal(called,1);
 response=await fetch(url,{method:'POST',body:'x'.repeat(1024*1024+1)});assert.equal(response.status,403);assert.equal(called,1);
});
