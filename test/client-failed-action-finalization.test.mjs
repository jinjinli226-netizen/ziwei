import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {archiveFailureFinalization,createClientFailureFinalizations,inspectFailureFinalizationLocal} from '../src/client-failed-action-finalization.mjs';
import {finalizationDigest,validateFailureFinalizationReceipt} from '../src/bot-failure-finalization-contract.mjs';
import {inspectLocalDaemonMaintenanceFiles} from '../backend/preservation-native-evidence.mjs';
import {createActionDelivery} from '../src/daemon-action-delivery.mjs';
import {ActionDispatcher} from '../src/daemon.mjs';
import {clientBuildIdentity} from '../src/management-bootstrap.mjs';
import {clientBuildIdentity as legacyBuildIdentity} from './helpers/client-build-156874.mjs';
import {fixture} from './helpers/failed-finalization-fixture.mjs';

const options=f=>({runtimeDir:f.runtimeDir,identity:f.identity,receipt:f.receipt,receiptDigest:f.receiptDigest});
test('archives exact failed source bytes, releases quarantine and keeps failed tombstone without fake exit',t=>{
 const f=fixture(t);assert.equal(validateFailureFinalizationReceipt(f.receipt),true);
 const applied=archiveFailureFinalization(options(f));assert.equal(applied.originalExecutionExitConfirmed,false);assert.equal(applied.localProcessDisposition,'unobservable');
 const archive=path.join(f.runtimeDir,'failure-finalizations',f.base);
 assert.deepEqual(fs.readFileSync(path.join(archive,'state.original.json')),f.stateBytes);
 assert.deepEqual(fs.readFileSync(path.join(archive,'action.original.json')),f.actionBytes);
 assert.deepEqual(fs.readFileSync(path.join(archive,'result.original.json')),f.resultBytes);
 const state=JSON.parse(fs.readFileSync(path.join(f.runtimeDir,'action-state.json')));
 assert.equal(state.started.length,0);assert.equal(state.completed[0].result.status,'failed');assert.equal(state.completed[0].result.code,'FAILURE_FINALIZED');assert.equal(state.completed[0].result.result.partialEffectsPossible,true);
 assert.equal(Object.hasOwn(state.completed[0].result.result,'processExit'),false);
 const evidence=inspectLocalDaemonMaintenanceFiles({connections:[{...f.identity,runtimeDir:f.runtimeDir}]});
 assert.equal(evidence.stopSafe,true,JSON.stringify(evidence));
 assert.equal(archiveFailureFinalization(options(f)).archiveSha256,applied.archiveSha256);
});
for(const stage of ['archive_saved','state_applied','delivery_applied','local_complete'])test('resumes a crash at '+stage+' without replay or deleting archives',t=>{
 const f=fixture(t);assert.throws(()=>archiveFailureFinalization({...options(f),checkpoint:current=>{if(current===stage)throw Error('crash');}}),/crash/);
 const result=archiveFailureFinalization(options(f));assert.equal(result.applied,true);
 assert.equal(inspectFailureFinalizationLocal(options(f)).alreadyApplied,true);
 assert.deepEqual(fs.readFileSync(path.join(f.runtimeDir,'failure-finalizations',f.base,'result.original.json')),f.resultBytes);
});
test('rejects different employee, profile or device with no local mutation',t=>{
 const f=fixture(t);
 for(const key of ['employeeId','profile','deviceId','originalRevision','originalControlEpoch','profileBindingDigest','originalResultDigest']){
  const body={...f.receipt,subject:{...f.receipt.subject,[key]:['originalRevision','originalControlEpoch'].includes(key)?123:key.endsWith('Digest')?'a'.repeat(64):'different'}};delete body.id;
  const receipt={...body,id:finalizationDigest(body)};
  assert.throws(()=>archiveFailureFinalization({...options(f),receipt,receiptDigest:finalizationDigest(receipt)}),{code:key==='deviceId'?'FAILURE_FINALIZATION_SCOPE_MISMATCH':'FAILURE_FINALIZATION_LOCAL_MISMATCH'});
  assert.deepEqual(fs.readFileSync(path.join(f.runtimeDir,'action-state.json')),f.stateBytes);
 }
});
test('preserves another employee changes when resuming an interrupted snapshot',t=>{
 const f=fixture(t);assert.throws(()=>archiveFailureFinalization({...options(f),checkpoint:stage=>{if(stage==='archive_saved')throw Error('crash');}}));
 const current={...f.state,started:[...f.state.started,{key:'other',actionId:'action_other',identity:f.started.identity,startedAt:Date.now(),nativeRuntime:false}]};
 fs.writeFileSync(path.join(f.runtimeDir,'action-state.json'),JSON.stringify(current));archiveFailureFinalization(options(f));
 const next=JSON.parse(fs.readFileSync(path.join(f.runtimeDir,'action-state.json')));assert.deepEqual(next.started,[current.started[1]]);
});
test('in-memory callback refusal never removes the active journal or source blobs',t=>{
 const f=fixture(t);assert.throws(()=>archiveFailureFinalization({...options(f),applyLocal:()=>false}),{code:'FAILURE_FINALIZATION_BUSY'});
 assert.deepEqual(fs.readFileSync(path.join(f.runtimeDir,'action-state.json')),f.stateBytes);
 assert.deepEqual(fs.readFileSync(path.join(f.deliveryDir,f.base+'.result.json')),f.resultBytes);
});
test('ACK loss is retried with the same archive and source task is never dispatched',async t=>{
 const f=fixture(t);let acknowledgements=0,prepare=0;
 const client=createClientFailureFinalizations({...options(f),prepareLocal:async()=>{prepare++;return {localProcessDisposition:'unobservable'};},request:async(pathname,body)=>{
  if(!body)return {finalizations:[{receipt:f.receipt,receiptDigest:f.receiptDigest,state:'awaiting_client'}]};
  acknowledgements++;if(acknowledgements===1)throw Error('network');
  assert.equal(body.receiptDigest,f.receiptDigest);return {receipt:f.receipt,receiptDigest:f.receiptDigest,state:'client_archived'};
 }});
 const first=await client.reconcile();assert.deepEqual(first.pending,['action_old']);assert.deepEqual(first.locallyApplied,['action_old']);
 assert.deepEqual((await client.reconcile()).applied,['action_old']);assert.equal(prepare,2);assert.equal(acknowledgements,2);
});
test('delivery memory is dropped only after its exact journal is finalized',t=>{
 const f=fixture(t),delivery=createActionDelivery({directory:f.deliveryDir,identity:f.identity,post:async()=>{throw Error('unexpected network');},dispatch:async()=>{throw Error('must not replay');}});
 assert.equal(delivery.getMaintenancePause(f.action.id),null);
 assert.equal(delivery.failureFinalizationReady(f.receipt),true);
 archiveFailureFinalization(options(f));assert.equal(delivery.failureFinalizationApplied(f.receipt),true);
 assert.equal(delivery.getMaintenancePause(f.action.id),null);
 assert.deepEqual(delivery.recoverActions(),[]);assert.equal(delivery.pendingCount,0);assert.equal(delivery.blockedCount,0);
});
test('a real restarted dispatcher settles memory and persistent dedupe together before authenticated ACK',async t=>{
 const f=fixture(t);let executions=0;
 const make=()=>new ActionDispatcher({workspace:f.identity.workspace,deviceId:f.identity.deviceId,stateFile:path.join(f.runtimeDir,'action-state.json'),execute:async()=>{executions++;throw Error('must never replay');}});
 const dispatcher=make();assert.equal(dispatcher.quarantined,true);
 const client=createClientFailureFinalizations({...options(f),prepareLocal:receipt=>dispatcher.prepareFailureFinalization(receipt),applyLocal:options=>dispatcher.applyFailureFinalization(options),request:async(_pathname,body)=>body?{state:'client_archived',receiptDigest:f.receiptDigest}:{finalizations:[{receipt:f.receipt,receiptDigest:f.receiptDigest}]}});
 assert.deepEqual((await client.reconcile()).applied,['action_old']);assert.equal(dispatcher.quarantined,false);
 assert.equal((await dispatcher.dispatch(f.action)).originalStatus,'failed');
 const restarted=make();assert.equal(restarted.quarantined,false);assert.equal((await restarted.dispatch(f.action)).originalStatus,'failed');assert.equal(executions,0);
});
test('an owned stop that settles without complete exit is consumed once instead of creating an endless recovery gate',async t=>{
 const f=fixture(t),stateFile=path.join(f.runtimeDir,'action-state.json');fs.writeFileSync(stateFile,JSON.stringify({version:2,started:[],completed:[]}));
 let stops=0;
 const incomplete={platform:'win32',supervisor:'windows-job',launched:true,rootPid:12345,rootConfirmed:true,rootExitCode:1,treeConfirmed:false,activeProcesses:null};
 const dispatcher=new ActionDispatcher({workspace:f.identity.workspace,deviceId:f.identity.deviceId,stateFile,workdir:f.runtimeDir,stopGraceMs:30,
  execute:async(_action,context)=>{context.onSupervision({completionEvidence:Promise.resolve(incomplete),stop:async()=>{stops++;return incomplete;}});throw Error('fixture native failure');}});
 const failed=await dispatcher.dispatch(f.action);assert.equal(failed.code,'EXECUTION_UNCERTAIN');assert.equal(dispatcher.quarantined,true);
 const prepared=await dispatcher.prepareFailureFinalization(f.receipt);assert.equal(prepared.localProcessDisposition,'unobservable');assert(stops>0);
 const afterStops=stops;assert.equal((await dispatcher.prepareFailureFinalization(f.receipt)).localProcessDisposition,'unobservable');assert.equal(stops,afterStops);
 archiveFailureFinalization({...options(f),applyLocal:options=>dispatcher.applyFailureFinalization(options)});assert.equal(dispatcher.quarantined,false);
});
test('the standalone failure-finalization recovery helper contributes to the actual packaged build identity',t=>{
 const f=fixture(t),directory=path.join(f.runtimeDir,'package'),file=path.join(directory,'src/client-failed-action-finalization-recovery.mjs');fs.mkdirSync(path.dirname(file),{recursive:true});
 fs.writeFileSync(file,'// first candidate\n');const before=clientBuildIdentity(directory);fs.appendFileSync(file,'// revised candidate\n');assert.notEqual(clientBuildIdentity(directory),before);
 assert.equal(legacyBuildIdentity(directory),clientBuildIdentity(directory),'the old worker and new daemon must agree on the identical verified candidate');
 const previous=legacyBuildIdentity(directory);fs.appendFileSync(file,'// another candidate\n');assert.notEqual(legacyBuildIdentity(directory),previous);assert.equal(legacyBuildIdentity(directory),clientBuildIdentity(directory));
});
