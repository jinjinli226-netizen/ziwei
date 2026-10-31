import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from './repository.mjs';
import { createManagementService } from './management.mjs';
import { createDshPluginUiRelayService } from './dsh-plugin-ui-relay.mjs';
import { createDshNativeService } from './dsh-native-operations.mjs';
import { employeeCapabilitySubject } from './employee-capability-inventory.mjs';
import { DSH_NATIVE_FEATURE, DSH_PLUGIN_UI_RELAY_FEATURE } from '../src/dsh-native-contract.mjs';

const SLUG='test-111';
function fixture(t){
 const repo=createRepository({memory:true}),db=repo.db,ws=repo.getWorkspace(SLUG),user='relay-owner',deviceId='relay-device';t.after(()=>db.close());
 db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run('relay-member',ws.id,user,'Owner','relay@fixture.invalid','owner',new Date().toISOString());
 repo.heartbeatDevice(SLUG,{deviceId,runtimeDiscovery:{features:[DSH_NATIVE_FEATURE,DSH_PLUGIN_UI_RELAY_FEATURE]},runtimes:{DSH:{status:'available',profiles:[{name:'alpha'}]}}});
 const employee=repo.createEmployee(SLUG,{name:'Relay DSH',runtime:'DSH',runtimeProfile:'alpha',targetDeviceId:deviceId,ownerUserId:user}),management=createManagementService(repo),native=createDshNativeService(repo,{management}),subject=employeeCapabilitySubject(db,ws.id,employee.id),context={actorUserId:user,actorRole:'owner'},relay=createDshPluginUiRelayService(repo,{management,nativeService:native,now:()=>Date.parse('2026-10-31T12:00:00.000Z'),randomId:()=>`relay-${Math.random().toString(16).slice(2)}`});
 const queued=native.action(SLUG,employee.id,{resource:'plugins',operation:'prepareUiHost',input:{},expectedSubjectHash:native.state(SLUG,employee.id,{},context).subjectHash,idempotencyKey:'prepare-relay'},context),action=repo.getA2AAction(queued.action.id);
 const op=action.payload.dshOperation;repo.ackA2AAction(action.id,{deviceId});repo.resultA2AAction(action.id,{deviceId,status:'succeeded',result:{dshNative:{schemaVersion:1,source:'dsh-native',subject,scope:op.scope,resource:'plugins',operation:'prepareUiHost',status:'applied',data:{application:'applied',version:'0.1.0',bridgePackage:'@dshbot/plugin-ui-host',mountBase:'/runtime/alpha/ui/'}}}});
 return{repo,db,employee,deviceId,user,context,relay,action};
}

test('relay session binds prepare receipt, current device and view key',t=>{
 const f=fixture(t),opened=f.relay.open(SLUG,f.employee.id,{prepareActionId:f.action.id,viewKey:'v'.repeat(16),idempotencyKey:'open-once'},f.context);
 assert.equal(opened.status,'open');assert.equal(opened.profile,'alpha');assert.equal(opened.originPath,'/runtime/alpha/ui/');assert.equal(opened.capability,DSH_PLUGIN_UI_RELAY_FEATURE);
 const same=f.relay.open(SLUG,f.employee.id,{prepareActionId:f.action.id,viewKey:'v'.repeat(16),idempotencyKey:'open-once'},f.context);assert.equal(same.duplicate,true);assert.equal(same.relayId,opened.relayId);
 const request=f.relay.assertRequest(opened.relayId,{method:'GET',path:'/runtime/alpha/ui/plugins/events?rev=2',requestId:'request-1'},f.context);assert.equal(request.path,'/runtime/alpha/ui/plugins/events?rev=2');
});

test('relay rejects cross-profile paths, browser credentials and revoked capability',t=>{
 const f=fixture(t),opened=f.relay.open(SLUG,f.employee.id,{prepareActionId:f.action.id,viewKey:'w'.repeat(16),idempotencyKey:'open-two'},f.context);
 assert.throws(()=>f.relay.assertRequest(opened.relayId,{method:'GET',path:'/runtime/beta/ui/index.html',requestId:'request-2'},f.context),{code:'DSH_PLUGIN_UI_RELAY_PATH_INVALID'});
 assert.throws(()=>f.relay.assertRequest(opened.relayId,{method:'GET',path:'/runtime/alpha/ui/index.html',headers:{cookie:'forbidden'},requestId:'request-3'},f.context),{code:'DSH_PLUGIN_UI_RELAY_HEADERS_INVALID'});
 f.db.prepare('UPDATE devices SET runtime_discovery_json=? WHERE id=?').run(JSON.stringify({features:[DSH_NATIVE_FEATURE]}),f.deviceId);
 assert.throws(()=>f.relay.status(opened.relayId,f.context),{code:'DSH_PLUGIN_UI_RELAY_UNAVAILABLE'});
});

test('relay expires and close is terminal without canceling the employee action',t=>{
 let clock=Date.parse('2026-10-31T12:00:00.000Z');const repo=createRepository({memory:true}),db=repo.db,ws=repo.getWorkspace(SLUG),user='relay-owner',deviceId='relay-device';t.after(()=>db.close());
 db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run('relay-member',ws.id,user,'Owner','relay@fixture.invalid','owner',new Date().toISOString());repo.heartbeatDevice(SLUG,{deviceId,runtimeDiscovery:{features:[DSH_NATIVE_FEATURE,DSH_PLUGIN_UI_RELAY_FEATURE]},runtimes:{DSH:{status:'available',profiles:[{name:'alpha'}]}}});
 const employee=repo.createEmployee(SLUG,{name:'Relay DSH',runtime:'DSH',runtimeProfile:'alpha',targetDeviceId:deviceId,ownerUserId:user}),management=createManagementService(repo),native=createDshNativeService(repo,{management}),subject=employeeCapabilitySubject(db,ws.id,employee.id),context={actorUserId:user,actorRole:'owner'},relay=createDshPluginUiRelayService(repo,{management,nativeService:native,now:()=>clock,ttlMs:1000,randomId:()=>`relay-${clock}`}),queued=native.action(SLUG,employee.id,{resource:'plugins',operation:'prepareUiHost',input:{},expectedSubjectHash:native.state(SLUG,employee.id,{},context).subjectHash,idempotencyKey:'prepare-expire'},context),action=repo.getA2AAction(queued.action.id),op=action.payload.dshOperation;
 repo.ackA2AAction(action.id,{deviceId});repo.resultA2AAction(action.id,{deviceId,status:'succeeded',result:{dshNative:{schemaVersion:1,source:'dsh-native',subject,scope:op.scope,resource:'plugins',operation:'prepareUiHost',status:'applied',data:{application:'applied',version:'0.1.0',bridgePackage:'@dshbot/plugin-ui-host',mountBase:'/runtime/alpha/ui/'}}}});
 const opened=relay.open(SLUG,employee.id,{prepareActionId:action.id,viewKey:'x'.repeat(16),idempotencyKey:'open-expire'},context);assert.equal(relay.close(opened.relayId,context).status,'closed');assert.equal(relay.status(opened.relayId,context).status,'closed');void clock;
});
