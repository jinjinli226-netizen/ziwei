import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRemoteClientUpdates, readRemoteUpdateJson, writeRemoteUpdateJson, REMOTE_CLIENT_UPDATE_SOURCE} from '../src/client-remote-update.mjs';

const sourceBuild='1'.repeat(64),targetBuild='2'.repeat(64),hostId='3'.repeat(64),sha256='4'.repeat(64);
function fixture(t,{state='succeeded',clientBuild=sourceBuild,sourceKnown=true,pending=false,protocol='native_worker_v1'}={}) {
  const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-update-terminal-')));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const connection={workspace:'terminal',deviceId:'device-terminal'},requestValue={id:'client-update_terminal',...connection,hostId,targetBuild,sha256,source:REMOTE_CLIENT_UPDATE_SOURCE,state,...(protocol?{completionProtocol:protocol}:{})};
  const worker={workerPid:401,startedAt:1,directory:'original-worker-directory'},claimToken='private-terminal-claim';
  const ledgerFile=path.join(home,'maintenance','remote-client-update.json'),outboxFile=path.join(home,'maintenance','remote-client-update-reports.json');
  const ledger={schemaVersion:1,request:requestValue,claimToken,state,stage:'worker_launch',reported:'awaiting_heartbeat',worker,...(sourceKnown?{sourceBuild}:{})};writeRemoteUpdateJson(ledgerFile,ledger);
  const receipt=kind=>({schemaVersion:1,operation:'update',state:kind,binding:{requestId:requestValue.id,hostId,deviceId:connection.deviceId,sourceBuild,targetBuild,sha256},supervisorPid:401,workerPid:402,daemonPid:403,installedBuild:kind==='complete'?targetBuild:sourceBuild,configSha256:'5'.repeat(64),terminalSha256:'6'.repeat(64),workerIdentitySha256:'7'.repeat(64),finishedAt:'2026-10-27T03:34:29.916Z',workerExited:true,maintenanceLockAbsent:true,configurationPreserved:true,nativeStartupVerified:true,...(kind==='complete'?{restoredRunning:true}:{originalInstallationRestored:true,runningStateRestored:true})});
  let observation={state:'updating'},serverState=state,polls=0,claims=0,launches=0,next=null,pendingResumes=pending,inspectionContext,supplementAck=false;
  const reports=[];
  const make=()=>createRemoteClientUpdates({home,hostId,clientBuild,enabled:true,pid:403,connections:()=>[connection],idle:()=>false,hasPendingResumes:()=>pendingResumes,
    request:async(_connection,route,body)=>{
      if(route.includes('/claim?')){claims++;return{request:{...next,state:'accepted'},claimToken:'private-next-claim'};}
      if(body){reports.push(body);return{request:{...requestValue,state:serverState},...(supplementAck?{observedFailureRecorded:true,requiresReconciliation:true}:{})};}
      polls++;return{request:next||{...requestValue,currentBuild:sourceBuild,state:serverState}};
    },
    inspectWorker:async(_worker,context)=>{inspectionContext=context;return observation;},recoverWorker:async()=>worker,
    launch:async()=>{launches++;throw new Error('must not relaunch the old request');},
  });
  return{home,client:make(),make,requestValue,worker,receipt,ledgerFile,outboxFile,reports,observe:value=>observation=value,server:value=>serverState=value,supplement:value=>supplementAck=value,pending:value=>pendingResumes=value,next:value=>next=value,polls:()=>polls,claims:()=>claims,launches:()=>launches,context:()=>inspectionContext,read:()=>readRemoteUpdateJson(ledgerFile)};
}

test('a restored source daemon reads a failed worker despite the earlier server success and preserves the original receipts',async t=>{
  const f=fixture(t);const rollbackEvidence=f.receipt('failed');f.observe({state:'failed',code:'CLIENT_UPDATE_PROCESS_EXIT_NONZERO',originalInstallationRestored:true,rollbackEvidence});f.server('failed');
  await f.client.tick();
  assert.equal(f.client.status().state,'failed');assert.equal(f.client.blocksNewActions,false);assert.equal(f.launches(),0);
  assert.deepEqual(f.read().request,f.requestValue);assert.deepEqual(f.read().worker,f.worker);assert.deepEqual(f.read().rollbackEvidence,rollbackEvidence);
  assert.equal(f.read().previousServerState,'succeeded');assert.deepEqual(f.reports[0].rollbackEvidence,rollbackEvidence);
  assert.equal(f.context().sourceBuild,sourceBuild);assert.equal(f.context().pid,403);
});

test('an old succeeded response cannot overwrite proven local failure or acknowledge its durable report outbox',async t=>{
  const f=fixture(t);f.observe({state:'failed',code:'CLIENT_UPDATE_RESTART_FAILED',originalInstallationRestored:true,rollbackEvidence:f.receipt('failed')});
  await f.client.tick();assert.equal(f.client.status().state,'failed');assert.equal(f.read().reported,'awaiting_heartbeat');
  let queued=readRemoteUpdateJson(f.outboxFile);assert.equal(queued.length,1);assert.deepEqual(queued[0].worker,f.worker);assert.deepEqual(queued[0].rollbackEvidence,f.receipt('failed'));
  await f.client.tick();assert.equal(readRemoteUpdateJson(f.outboxFile).length,1);assert.equal(f.client.status().state,'failed');
  f.server('failed');await f.client.tick();assert.deepEqual(readRemoteUpdateJson(f.outboxFile),[]);
});

test('worker failure without restoration proof, a live lease, or a mismatched binding cannot release a provisional success',async t=>{
  for(const invalid of ['missing','lock','request','daemon','worker','build']){
    const f=fixture(t);let rollbackEvidence=f.receipt('failed');
    if(invalid==='missing')rollbackEvidence=undefined;
    if(invalid==='lock')fs.writeFileSync(path.join(f.home,'maintenance','operation.lock'),'live-worker-lease');
    if(invalid==='request')rollbackEvidence.binding.requestId='other-request';
    if(invalid==='daemon')rollbackEvidence.daemonPid=999;
    if(invalid==='worker')rollbackEvidence.supervisorPid=999;
    if(invalid==='build')rollbackEvidence.installedBuild=targetBuild;
    f.observe({state:'failed',code:'CLIENT_UPDATE_RESTART_FAILED',originalInstallationRestored:true,rollbackEvidence});
    await f.client.tick();assert.equal(f.client.blocksNewActions,true,invalid);assert.equal(f.client.status().state,'succeeded',invalid);assert.equal(f.reports.length,0,invalid);assert.equal(f.claims(),0,invalid);
  }
});

test('old ledgers obtain the source build only from the same authenticated immutable request',async t=>{
  const f=fixture(t,{sourceKnown:false});f.observe({state:'failed',code:'CLIENT_UPDATE_RESTART_FAILED',originalInstallationRestored:true,rollbackEvidence:f.receipt('failed')});f.server('failed');
  await f.client.tick();assert.equal(f.read().sourceBuild,sourceBuild);assert.equal(f.context().sourceBuild,sourceBuild);assert.equal(f.client.status().state,'failed');
  const wrong=fixture(t,{sourceKnown:false});wrong.next({...wrong.requestValue,id:'another-request',currentBuild:sourceBuild});wrong.observe({state:'failed',rollbackEvidence:wrong.receipt('failed')});
  await wrong.client.tick();assert.equal(wrong.read().sourceBuild,undefined);assert.equal(wrong.client.blocksNewActions,true);assert.equal(wrong.reports.length,0);
});

test('paused actions keep the failed authority until resume and a newer request archives the complete original ledger',async t=>{
  const f=fixture(t,{pending:true});f.observe({state:'failed',code:'CLIENT_UPDATE_RESTART_FAILED',originalInstallationRestored:true,rollbackEvidence:f.receipt('failed')});f.server('failed');
  await f.client.tick();assert.equal(f.client.status().state,'failed');assert.equal(f.claims(),0);assert.equal(f.client.checkpointAuthority({updateId:f.requestValue.id,targetBuild}).updateId,f.requestValue.id);
  const next={...f.requestValue,id:'client-update_next',state:'requested'};f.next(next);await f.client.tick();assert.equal(f.claims(),0);
  f.pending(false);await f.client.tick();assert.equal(f.claims(),1);assert.equal(f.client.status().id,next.id);
  const archived=readRemoteUpdateJson(path.join(f.home,'maintenance','remote-client-update-history',f.requestValue.id+'.json'));
  assert.deepEqual(archived.request,f.requestValue);assert.deepEqual(archived.worker,f.worker);assert.deepEqual(archived.rollbackEvidence,f.receipt('failed'));
});

test('target startup reports awaiting heartbeat until an actual complete worker receipt exists',async t=>{
  const f=fixture(t,{state:'updating',clientBuild:targetBuild});f.server('awaiting_heartbeat');
  await f.client.tick();assert.equal(f.client.status().state,'awaiting_heartbeat');assert.equal(f.reports.some(row=>row.workerReceipt),false);assert.equal(f.client.blocksNewActions,true);
  const workerReceipt=f.receipt('complete');f.observe({state:'complete',workerReceipt});f.server('succeeded');await f.client.tick();
  assert.equal(f.client.status().state,'succeeded');assert.deepEqual(f.reports.at(-1).workerReceipt,workerReceipt);assert.equal(f.client.blocksNewActions,false);
  assert.doesNotMatch(JSON.stringify(f.client.status()),/private|claimToken|configSha256|workerIdentitySha256/);
});

test('an unproved complete observation never reports completion or releases the installer gate',async t=>{
  const f=fixture(t,{clientBuild:targetBuild});f.observe({state:'complete'});await f.client.tick();assert.equal(f.client.blocksNewActions,true);assert.equal(f.reports.length,0);
});

function historicalFailure(f){
  const strong=f.receipt('failed');
  return{schemaVersion:1,operation:'update',state:'failed',...strong.binding,supervisorPid:strong.supervisorPid,workerPid:strong.workerPid,workerIdentitySha256:strong.workerIdentitySha256,terminalSha256:strong.terminalSha256,finishedAt:strong.finishedAt,workerExited:true,maintenanceLockAbsent:true,originalInstallationRestored:true,runningStateRestored:true,reasonCode:'PROCESS_EXIT_NONZERO',failureStage:'restart_client',exitCode:1};
}
test('a later new installation records historical native failure without claiming that its current build is the old source',async t=>{
  const f=fixture(t,{clientBuild:'8'.repeat(64)}),observedFailure=historicalFailure(f);f.observe({state:'failed',code:'CLIENT_UPDATE_PROCESS_EXIT_NONZERO',observedFailure});f.supplement(true);
  await f.client.tick();assert.equal(f.client.status().state,'failed');assert.equal(f.client.blocksNewActions,false);assert.equal(f.read().sourceBuild,sourceBuild);assert.equal(f.read().previousServerState,'succeeded');
  assert.deepEqual(f.read().observedFailure,observedFailure);assert.equal(f.read().requiresReconciliation,true);assert.equal(f.read().reported,'failed');
  assert.deepEqual(f.reports[0].observedFailure,observedFailure);assert.equal(f.reports[0].clientBuild,'8'.repeat(64));assert.equal(f.reports[0].rollbackEvidence,undefined);assert.equal(fs.existsSync(f.outboxFile),false);
});
test('historical failure reports survive restart and old success is not a supplement acknowledgement',async t=>{
  const f=fixture(t,{clientBuild:'8'.repeat(64)}),observedFailure=historicalFailure(f);f.observe({state:'failed',code:'CLIENT_UPDATE_PROCESS_EXIT_NONZERO',observedFailure});
  await f.client.tick();assert.equal(f.client.status().state,'failed');assert.deepEqual(readRemoteUpdateJson(f.outboxFile)[0].observedFailure,observedFailure);
  const restarted=f.make();await restarted.tick();assert.equal(readRemoteUpdateJson(f.outboxFile).length,1);assert.equal(restarted.status().state,'failed');assert.equal(f.launches(),0);
  f.supplement(true);await restarted.tick();assert.deepEqual(readRemoteUpdateJson(f.outboxFile),[]);assert.equal(restarted.status().state,'failed');
});
test('historical observations lacking worker generation or restore proof cannot settle a former success',async t=>{
  for(const field of ['workerIdentitySha256','originalInstallationRestored','runningStateRestored','workerExited']){
    const f=fixture(t,{clientBuild:'8'.repeat(64)}),observedFailure=historicalFailure(f);delete observedFailure[field];f.observe({state:'failed',observedFailure});
    await f.client.tick();assert.equal(f.client.blocksNewActions,true,field);assert.equal(f.client.status().state,'succeeded',field);assert.equal(f.reports.length,0,field);
  }
});

test('only a request frozen to legacy heartbeat may use complete native legacy proof without a historical config hash',async t=>{
  for(const protocol of ['legacy_heartbeat','native_worker_v1',undefined]){
    const f=fixture(t,{clientBuild:targetBuild,protocol:protocol||null}),legacyCompletion=f.receipt('complete');delete legacyCompletion.configSha256;
    f.observe({state:'complete',legacyCompletion});await f.client.tick();
    assert.equal(f.client.blocksNewActions,protocol!=='legacy_heartbeat',String(protocol));
    assert.equal(f.read().workerReceipt,undefined);assert.equal(f.reports.some(row=>row.workerReceipt),false);
    if(protocol==='legacy_heartbeat')assert.deepEqual(f.read().legacyCompletion,legacyCompletion);
  }
});
test('an old ledger obtains its legacy contract only from the same authenticated immutable request',async t=>{
  const f=fixture(t,{clientBuild:targetBuild,protocol:null}),legacyCompletion=f.receipt('complete');delete legacyCompletion.configSha256;
  f.next({...f.requestValue,currentBuild:sourceBuild,completionProtocol:'legacy_heartbeat'});f.observe({state:'complete',legacyCompletion});
  await f.client.tick();assert.equal(f.read().request.completionProtocol,'legacy_heartbeat');assert.equal(f.context().request.completionProtocol,'legacy_heartbeat');assert.equal(f.client.blocksNewActions,false);
  const wrong=fixture(t,{clientBuild:targetBuild,protocol:null}),proof=wrong.receipt('complete');delete proof.configSha256;
  wrong.next({...wrong.requestValue,id:'another-request',currentBuild:sourceBuild,completionProtocol:'legacy_heartbeat'});wrong.observe({state:'complete',legacyCompletion:proof});
  await wrong.client.tick();assert.equal(wrong.read().request.completionProtocol,undefined);assert.equal(wrong.client.blocksNewActions,true);
});
test('a frozen native contract cannot be changed to legacy by a later server observation',async t=>{
  const f=fixture(t,{clientBuild:targetBuild,sourceKnown:false}),legacyCompletion=f.receipt('complete');delete legacyCompletion.configSha256;
  f.next({...f.requestValue,currentBuild:sourceBuild,completionProtocol:'legacy_heartbeat'});f.observe({state:'complete',legacyCompletion});await f.client.tick();
  assert.equal(f.read().request.completionProtocol,'native_worker_v1');assert.equal(f.client.blocksNewActions,true);assert.equal(f.reports.length,0);
});
