import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRemoteClientUpdates,writeRemoteUpdateJson,REMOTE_CLIENT_UPDATE_SOURCE} from '../src/client-remote-update.mjs';
function fixture(t,{state='succeeded',stage='worker_launch',worker=true,source=false}={}){
  const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-maintenance-update-')));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const build='2'.repeat(64),hostId='3'.repeat(64),connection={workspace:'fixture',deviceId:'device-fixture'},request={id:'update-fixture',...connection,hostId,targetBuild:build,sha256:'4'.repeat(64),source:REMOTE_CLIENT_UPDATE_SOURCE,state};
  let observation='updating',pending=true,polls=0;
  const ledger={schemaVersion:1,request,claimToken:'private-fixture-claim',state,stage,...(worker?{worker:{workerPid:123,startedAt:1,directory:'fixture'}}:{})};
  writeRemoteUpdateJson(path.join(home,'maintenance','remote-client-update.json'),ledger);
    const client=createRemoteClientUpdates({home,hostId,clientBuild:source?'1'.repeat(64):build,enabled:true,pid:99,connections:()=>[connection],idle:()=>true,hasPendingResumes:()=>pending,request:async()=>{polls++;return{request:null};},inspectWorker:async()=>typeof observation==='string'?{state:observation}:observation,recoverWorker:async()=>null});
  return {home,client,receipt:{updateId:request.id,targetBuild:build},observation:v=>observation=v,pending:v=>pending=v,polls:()=>polls};
}
test('new-build heartbeat cannot resume while the installer holds its lease or has not finished',async t=>{
  const f=fixture(t),lock=path.join(f.home,'maintenance','operation.lock');fs.writeFileSync(lock,'fixture live lease');
  f.observation('complete');assert.equal((await f.client.maintenanceResumeReadiness(f.receipt)).ready,false);assert.equal(f.client.blocksNewActions,true);
  fs.unlinkSync(lock);f.observation('updating');assert.equal((await f.client.maintenanceResumeReadiness(f.receipt)).ready,false);
  f.observation('complete');await f.client.tick();assert.equal((await f.client.maintenanceResumeReadiness(f.receipt)).ready,true);assert.equal(f.client.blocksNewActions,false);
});
test('the current update authority is retained until its paused actions resume',async t=>{
  const f=fixture(t);f.observation('complete');await f.client.tick();assert.equal(f.polls(),0);assert.equal(f.client.checkpointAuthority(f.receipt).updateId,f.receipt.updateId);
  f.pending(false);await f.client.tick();assert.equal(f.polls(),1);
});
test('a heartbeat cannot admit a newer upgrade before the previous installer finishes, even without paused tasks',async t=>{
  const f=fixture(t);f.pending(false);await f.client.tick();assert.equal(f.polls(),0);
  f.observation('complete');await f.client.tick();assert.equal(f.polls(),1);
});
test('cancelled queued maintenance can continue in its original daemon without launching an updater',async t=>{
  const f=fixture(t,{state:'cancelled',stage:null,worker:false,source:true});
  assert.deepEqual(await f.client.maintenanceResumeReadiness(f.receipt),{ready:true,sourceIdle:{workerAbsent:true,maintenanceLockAbsent:true,installedBuild:'1'.repeat(64),pid:99}});
});
test('an ambiguous updater spawn or failed worker never authorizes source continuation',async t=>{
  const f=fixture(t,{state:'failed',stage:'worker_launch',worker:false,source:true});assert.equal((await f.client.maintenanceResumeReadiness(f.receipt)).ready,false);
});
test('a verified restored source installation can resume after failed maintenance, with a fresh daemon PID',async t=>{
  const f=fixture(t,{state:'failed',worker:true,source:true});f.observation({state:'failed',originalInstallationRestored:false});const failed=await f.client.maintenanceResumeReadiness(f.receipt);assert.equal(failed.ready,true);assert.equal(failed.sourceIdle,undefined);assert.equal(failed.maintenanceFailure.workerTerminal,true);
  f.observation({state:'failed',originalInstallationRestored:true});assert.deepEqual(await f.client.maintenanceResumeReadiness(f.receipt),{ready:true,sourceIdle:{workerTerminal:true,originalInstallationRestored:true,maintenanceLockAbsent:true,installedBuild:'1'.repeat(64),pid:99}});
  fs.writeFileSync(path.join(f.home,'maintenance','operation.lock'),'fixture lease');assert.equal((await f.client.maintenanceResumeReadiness(f.receipt)).ready,false);
});
