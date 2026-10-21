import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fixture} from './helpers/failed-finalization-fixture.mjs';
import {createFailedActionFinalizationRecovery} from '../src/client-failed-action-finalization-recovery.mjs';
import {recoverFailureFinalizationsBeforeUpdateStop,recoverBeforeClientUpdateStop} from '../scripts/client-update.mjs';
import {createHistoricalUpdateRecoveryEntry} from '../scripts/client-historical-prelaunch-recovery.mjs';
import {archiveFailureFinalization,createClientFailureFinalizations} from '../src/client-failed-action-finalization.mjs';
import {createActionDelivery} from '../src/daemon-action-delivery.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
function updater(t,{online=false,newDaemon=false}={}){
 const f=fixture(t),home=path.join(f.runtimeDir,'home'),runtimeDir=path.join(home,'runtime');
 fs.mkdirSync(home);for(const name of ['action-state.json','action-delivery'])fs.renameSync(path.join(f.runtimeDir,name),path.join(home,name));
 fs.mkdirSync(runtimeDir);for(const name of ['action-state.json','action-delivery'])fs.renameSync(path.join(home,name),path.join(runtimeDir,name));
 const root=path.join(home,'node_modules','ziwei'),configPath=path.join(home,'ziwei_user.json');
 const config={workspace:f.identity.workspace,deviceId:f.identity.deviceId,apiBase:f.identity.apiBase,deviceToken:'fixture-device-credential',healthHost:'127.0.0.1',healthPort:20242};fs.writeFileSync(configPath,JSON.stringify(config));
 const creationTime=new Date(Date.now()-20000).toISOString(),build='a'.repeat(64),nonce='b'.repeat(48),record={pid:10001,creationTime,executable:'C:\\node.exe',commandHash:'c'.repeat(64)};
 const life={nonce,root,configPath,configSha256:hash(fs.readFileSync(configPath)),runtimeDir,startedAt:creationTime,managedAuxiliaryCount:0};
 let alive=online,draining=false,terminated=0,acknowledgements=0;
 const health=()=>({service:'ziwei_user',agentId:'ziwei_user',pid:record.pid,clientBuild:build,workspace:config.workspace,deviceId:config.deviceId,
  activeActionCount:1,quarantinedActionCount:1,executionQuarantined:true,pollingCount:0,connectionState:draining?'draining':'connected',
  lifecycle:life,connections:[{workspace:config.workspace,deviceId:config.deviceId,primary:true}],connectionErrors:[],
  maintenance:{safe:false,stopSafe:false,gatewaySafe:true,gatewayWorkers:[],
   pendingDeliveryCount:['awaiting_ack','acked','result_pending'].includes(JSON.parse(fs.readFileSync(path.join(runtimeDir,'action-delivery',f.base+'.json'))).state)?1:0,
   blockedDeliveryCount:JSON.parse(fs.readFileSync(path.join(runtimeDir,'action-delivery',f.base+'.json'))).state==='blocked'?1:0}});
 const fetchImpl=async(input,options={})=>{
  const url=new URL(input),body=options.body?JSON.parse(options.body):null;
  if(url.pathname==='/a2a/v1/failure-finalizations')return Response.json({finalizations:[{receipt:f.receipt,receiptDigest:f.receiptDigest,state:'awaiting_client'}]});
  if(url.pathname.endsWith('/failure-finalization/ack')){acknowledgements++;assert.equal(body.receiptId,f.receipt.id);return Response.json({receipt:f.receipt,receiptDigest:f.receiptDigest,state:'client_archived'});}
  if(url.pathname==='/healthz'){if(!alive)throw Object.assign(Error('refused'),{cause:{code:'ECONNREFUSED'}});return Response.json(health());}
  if(url.pathname==='/local/failure-finalizations')return newDaemon?Response.json({ok:true,pending:0,applied:1}):new Response(null,{status:404});
  if(url.pathname==='/local/connection-control'){assert.equal(body.nonce,nonce);draining=body.operation==='pause';return Response.json(health());}
  throw Error('Unexpected test request');
 };
 const deps={platform:'win32',installedBuild:()=>build,inspectProcess:async()=>alive?record:null,inspectListener:async()=>({listenerPid:record.pid}),
  inventory:async()=>alive?[record]:[],listenerCount:async()=>alive?1:0,terminate:async data=>{
   terminated++;assert.equal(data.expectedQuarantineCount,1);assert.equal(data.authorizedFinalizations[0].actionId,f.receipt.subject.actionId);
   const exitedAt=new Date().toISOString(),output={stopped:true,pid:record.pid,creationTime,exitedAt,maintenanceCleanup:{schemaVersion:1,scope:'held-daemon-descendant-closure',rootPid:record.pid,rootCreationTime:creationTime,rootExitedAt:exitedAt,nonce,complete:true,descendantCount:0,terminatedCount:0,processes:[]}};
   fs.writeFileSync(data.exitFile,JSON.stringify(output));alive=false;return output;
  }};
 return {f,home,runtimeDir,root,fetchImpl,deps,env:{ZIWEI_USER_HOME:home,ZIWEI_CONFIG:configPath},health,counts:()=>({terminated,acknowledgements,alive,draining})};
}
test('official candidate can archive an authorized failed record while the client is already stopped',async t=>{
 const f=updater(t),recover=createFailedActionFinalizationRecovery(f.deps),result=await recover(f);
 assert.deepEqual(result,{recovered:false,finalizationsApplied:1});assert.equal(f.counts().terminated,0);assert.equal(f.counts().acknowledgements,1);
 const state=JSON.parse(fs.readFileSync(path.join(f.runtimeDir,'action-state.json')));assert.equal(state.started.length,0);assert.equal(state.completed[0].result.code,'FAILURE_FINALIZED');
});
test('legacy quarantine is stopped through the held exact instance before applying the local archive',async t=>{
 const f=updater(t,{online:true}),result=await createFailedActionFinalizationRecovery(f.deps)(f);
 assert.equal(f.counts().terminated,1);assert.equal(result.stopped,true);assert.equal(result.wasRunning,true);assert.equal(result.originalExecutionExitConfirmed,false);assert.equal(result.executionConfirmedStopped,false);assert.equal(result.finalizationsApplied,1);
 assert.deepEqual(fs.readFileSync(path.join(f.runtimeDir,'failure-finalizations',f.f.base,'state.original.json')),f.f.stateBytes);
});
test('an unrelated employee in flight is never killed and original records remain unchanged',async t=>{
 const f=updater(t,{online:true}),file=path.join(f.runtimeDir,'action-state.json'),state=JSON.parse(fs.readFileSync(file));
 state.started.push({...state.started[0],key:'other',actionId:'action_unrelated'});const before=JSON.stringify(state);fs.writeFileSync(file,before);
 await assert.rejects(createFailedActionFinalizationRecovery(f.deps)(f),{code:'FAILURE_FINALIZATION_BUSY'});
 assert.equal(f.counts().terminated,0);assert.equal(f.counts().draining,false);assert.equal(fs.readFileSync(file,'utf8'),before);
});
test('a new daemon applies its own memory state and the updater retains normal graceful stop',async t=>{
 const f=updater(t,{online:true,newDaemon:true}),result=await createFailedActionFinalizationRecovery(f.deps)(f);
 assert.deepEqual(result,{recovered:false,finalizationsApplied:1});assert.equal(f.counts().terminated,0);
});
test('an interrupted post-stop response resumes offline without executing the original action',async t=>{
 const f=updater(t,{online:true}),recover=createFailedActionFinalizationRecovery({...f.deps,checkpoint:stage=>{if(stage==='legacy_stopped')throw Error('interrupted');}});
 await assert.rejects(recover(f),error=>error.stoppedClientReceipt?.stopped===true&&error.stoppedClientReceipt.originalExecutionExitConfirmed===false);
 const result=await createFailedActionFinalizationRecovery(f.deps)(f);assert.equal(result.finalizationsApplied,1);assert.equal(f.counts().terminated,1);
});
for(const state of ['blocked','result_pending'])test('legacy update drains only the exact authorized '+state+' receipt',async t=>{
 const f=updater(t,{online:true}),file=path.join(f.runtimeDir,'action-delivery',f.f.base+'.json'),journal=JSON.parse(fs.readFileSync(file));
 journal.state=state;fs.writeFileSync(file,JSON.stringify(journal));
 const result=await createFailedActionFinalizationRecovery(f.deps)(f);assert.equal(result.finalizationsApplied,1);assert.equal(f.counts().terminated,1);
});
test('an ACK-lost archive already applied on a restarted old daemon is acknowledged without killing it',async t=>{
 const f=updater(t,{online:true});
 archiveFailureFinalization({runtimeDir:f.runtimeDir,identity:f.f.identity,receipt:f.f.receipt,receiptDigest:f.f.receiptDigest});
 const result=await createFailedActionFinalizationRecovery(f.deps)(f);
 assert.deepEqual(result,{recovered:false,finalizationsApplied:1});assert.equal(f.counts().terminated,0);assert.equal(f.counts().acknowledgements,1);
});
test('a new daemon losing only its archive ACK is never treated as an obsolete process to kill',async t=>{
 const f=updater(t,{online:true}),fetchImpl=async(input,options)=>{
  if(new URL(input).pathname==='/local/failure-finalizations'){
   archiveFailureFinalization({runtimeDir:f.runtimeDir,identity:f.f.identity,receipt:f.f.receipt,receiptDigest:f.f.receiptDigest});
   return Response.json({ok:true,applied:0,pending:1,localPending:0});
  }
  return f.fetchImpl(input,options);
 };
 const result=await createFailedActionFinalizationRecovery(f.deps)({...f,fetchImpl});
 assert.deepEqual(result,{recovered:false,finalizationsApplied:1});assert.equal(f.counts().terminated,0);
});
test('already-applied disk state first notifies a live new daemon to drop stale blocked delivery memory before ACK',async t=>{
 const f=updater(t,{online:true}),directory=path.join(f.runtimeDir,'action-delivery'),journalFile=path.join(directory,f.f.base+'.json');
 const journal=JSON.parse(fs.readFileSync(journalFile));journal.state='blocked';fs.writeFileSync(journalFile,JSON.stringify(journal));
 const delivery=createActionDelivery({directory,identity:f.f.identity,post:async()=>{throw Error('unexpected post');},dispatch:async()=>{throw Error('must not replay');}});
 delivery.getMaintenancePause(f.f.action.id);assert.equal(delivery.blockedCount,1);
 archiveFailureFinalization({runtimeDir:f.runtimeDir,identity:f.f.identity,receipt:f.f.receipt,receiptDigest:f.f.receiptDigest});
 assert.equal(delivery.blockedCount,1,'simulates IO failure after applyLocal but before deliveryApplied');let notifications=0;
 const client=createClientFailureFinalizations({runtimeDir:f.runtimeDir,identity:f.f.identity,
  prepareLocal:async()=>({localProcessDisposition:'no_live_instance'}),deliveryReady:receipt=>delivery.failureFinalizationReady(receipt),deliveryApplied:receipt=>delivery.failureFinalizationApplied(receipt),
  request:async(pathname,body)=>{if(body)assert.equal(delivery.blockedCount,0,'ACK follows live memory settlement');return (await f.fetchImpl(f.f.identity.apiBase+pathname,{...(body?{body:JSON.stringify(body)}:{})})).json();}});
 const fetchImpl=async(input,options)=>{
  if(new URL(input).pathname==='/local/failure-finalizations'){notifications++;const outcome=await client.reconcile();return Response.json({ok:true,applied:outcome.applied.length,pending:outcome.pending.length,localPending:outcome.pending.filter(id=>!outcome.locallyApplied.includes(id)).length});}
  return f.fetchImpl(input,options);
 };
 const result=await createFailedActionFinalizationRecovery(f.deps)({...f,fetchImpl});
 assert.equal(result.recovered,false);assert.equal(result.finalizationsApplied,1);assert.equal(notifications,1);assert.equal(delivery.blockedCount,0);assert.equal(f.counts().terminated,0);
});
test('a live daemon still reporting local IO cleanup pending is not ACKed or killed based only on its disk tombstone',async t=>{
 const f=updater(t,{online:true});archiveFailureFinalization({runtimeDir:f.runtimeDir,identity:f.f.identity,receipt:f.f.receipt,receiptDigest:f.f.receiptDigest});
 const fetchImpl=async(input,options)=>new URL(input).pathname==='/local/failure-finalizations'?Response.json({ok:true,applied:0,pending:1,localPending:1}):f.fetchImpl(input,options);
 await assert.rejects(createFailedActionFinalizationRecovery(f.deps)({...f,fetchImpl}),{code:'FAILURE_FINALIZATION_BUSY'});
 assert.equal(f.counts().acknowledgements,0);assert.equal(f.counts().terminated,0);
});
test('failure-finalization update hook only loads the verified candidate and rejects invented original exit',async()=>{
 const calls=[];const receipt={recovered:true,stopped:true,wasRunning:true,originalExecutionExitConfirmed:false,executionConfirmedStopped:false};
 assert.deepEqual(await recoverFailureFinalizationsBeforeUpdateStop({candidate:'/verified candidate',root:'/old',load:async url=>{calls.push(url);return{recoverFailedActionFinalizationsForUpdate:async options=>{assert.equal(options.root,'/old');return receipt;}};}}),receipt);
 assert.deepEqual(calls,['file:///verified%20candidate/src/client-failed-action-finalization-recovery.mjs']);
 await assert.rejects(recoverFailureFinalizationsBeforeUpdateStop({candidate:'/verified',load:async()=>({recoverFailedActionFinalizationsForUpdate:async()=>({...receipt,originalExecutionExitConfirmed:true})})}),{code:'FAILURE_FINALIZATION_STOP_UNCONFIRMED'});
});
test('the old worker candidate entry reaches generic recovery and returns an accepted exact-instance receipt',async t=>{
 const f=updater(t,{online:true}),calls=[];
 const entry=createHistoricalUpdateRecoveryEntry({finalize:async input=>{calls.push('generic');return createFailedActionFinalizationRecovery(f.deps)({...input,fetchImpl:f.fetchImpl});},
  retain:async()=>{throw Error('must not enter historical fallback');},force:async()=>{throw Error('must not enter hardcoded force fallback');},original:async()=>{throw Error('must not enter original historical factory');}});
 const result=await recoverBeforeClientUpdateStop({candidate:'/verified candidate',root:f.root,env:f.env,load:async url=>{
  assert.equal(url,'file:///verified%20candidate/scripts/client-historical-prelaunch-recovery.mjs');return {recoverHistoricalPrelaunchForUpdate:entry};}});
 assert.deepEqual(calls,['generic']);assert.equal(result.recovered,true);assert.equal(result.wasRunning,true);assert.equal(result.stopped,true);assert.equal(result.originalExecutionExitConfirmed,false);assert.equal(f.counts().terminated,1);
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.runtimeDir,'action-state.json'))).completed[0].result.code,'FAILURE_FINALIZED');
});
test('the stable old worker entry preserves every original fallback when no generic stop is needed',async()=>{
 const calls=[],input={root:'/old-install'},entry=createHistoricalUpdateRecoveryEntry({finalize:async value=>{assert.equal(value,input);calls.push('generic');return {recovered:false};},retain:async()=>{calls.push('retained');return {recovered:false};},force:async()=>{calls.push('force');return {recovered:false};},original:async()=>{calls.push('original');return {recovered:false,reason:'not_applicable'};}});
 assert.deepEqual(await entry(input),{recovered:false,reason:'not_applicable'});assert.deepEqual(calls,['generic','retained','force','original']);
});
