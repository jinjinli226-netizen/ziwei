import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {runRemoteClientUpdateWorker,inspectRemoteClientUpdateWorker} from '../scripts/client-remote-update-worker.mjs';
import {REMOTE_CLIENT_UPDATE_SOURCE,writeRemoteUpdateJson,readRemoteUpdateJson} from '../src/client-remote-update.mjs';

function fixture(t){
 const base=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-rollback-evidence-')));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const root=path.join(base,'installed'),home=path.join(base,'user'),directory=path.join(home,'maintenance','remote-update-'+randomUUID()),configPath=path.join(home,'ziwei_user.json'),jobFile=path.join(directory,'remote-job.json');
 fs.mkdirSync(root);const request={id:'client-update-fixture',workspace:'fixture',deviceId:'device-fixture',hostId:'a'.repeat(64),targetBuild:'b'.repeat(64),sha256:'c'.repeat(64),source:REMOTE_CLIENT_UPDATE_SOURCE,state:'waiting_idle'};
 writeRemoteUpdateJson(configPath,{apiBase:'https://example.invalid',workspace:request.workspace,deviceId:request.deviceId,deviceToken:'fixture-only-token'});
 writeRemoteUpdateJson(jobFile,{schemaVersion:1,root,home,configPath,directory,request,claimToken:'fixture-only-claim-token'});
 const worker={directory,workerPid:12345,startedAt:Date.now()},statusFile=path.join(directory,'supervisor-result.json');
 const fetchImpl=async()=>({ok:true,json:async()=>({request})});
 return {root,home,directory,jobFile,statusFile,worker,fetchImpl};
}
test('download failure explicitly preserves untouched installation without launching official update',async t=>{
 const f=fixture(t);let launched=0;const result=await runRemoteClientUpdateWorker({jobFile:f.jobFile,fetchImpl:f.fetchImpl,download:async()=>{throw Object.assign(new Error('download unavailable'),{code:'DOWNLOAD_FAILED'});},launch:async()=>{launched++;}});
 assert.equal(result.state,'failed');assert.equal(launched,0);const status=readRemoteUpdateJson(f.statusFile);assert.equal(status.installationUnchanged,true);assert.equal(status.officialLaunchStarted,false);
 const inspected=await inspectRemoteClientUpdateWorker(f.worker,{home:f.home,processAlive:()=>false});assert.equal(inspected.state,'failed');assert.equal(inspected.originalInstallationRestored,true);
});
test('failure within official launch is an ambiguous installation window and cannot claim rollback',async t=>{
 const f=fixture(t);let invoked=0;await runRemoteClientUpdateWorker({jobFile:f.jobFile,fetchImpl:f.fetchImpl,download:async()=>{},launch:async()=>{invoked++;const before=readRemoteUpdateJson(f.statusFile);assert.equal(before.state,'launching');assert.equal(before.officialLaunchStarted,true);throw Object.assign(new Error('spawned but receipt lost'),{code:'LAUNCH_FAILED'});}});
 assert.equal(invoked,1);const status=readRemoteUpdateJson(f.statusFile);assert.equal(status.installationUnchanged,false);assert.equal(status.officialLaunchStarted,true);assert.equal((await inspectRemoteClientUpdateWorker(f.worker,{home:f.home,processAlive:()=>false})).originalInstallationRestored,false);
});
for(const [name,result,expected]of [
 ['official original installation restored',{state:'failed',operation:'update',reasonCode:'RESTART_FAILED',originalInstallationRestored:true,originalRestored:false},true],
 ['official rollback incomplete',{state:'failed',operation:'update',reasonCode:'RESTORE_FAILED',originalInstallationRestored:false,originalRestored:false},false],
 ['generic failed result has no restore proof',{state:'failed',operation:'update',reasonCode:'UPDATE_FAILED'},false],
 ['legacy broad restored flag alone is insufficient',{state:'failed',operation:'update',originalRestored:true},false],
 ['interrupted worker is not a terminal restoration proof',{state:'interrupted',operation:'update',originalInstallationRestored:true},false],
 ['different maintenance operation cannot attest an update',{state:'failed',operation:'stop',originalInstallationRestored:true},false],
])test(name,async t=>{
 const f=fixture(t),resultFile=path.join(f.home,'maintenance','update-'+randomUUID(),'result.json');writeRemoteUpdateJson(f.statusFile,{state:'queued',workerPid:23456,resultFile});let reads=0;
 const inspected=await inspectRemoteClientUpdateWorker(f.worker,{home:f.home,readStatus:async options=>{reads++;assert.equal(options.resultFile,resultFile);return result;},processAlive:()=>assert.fail('terminal result must not infer live state')});assert.equal(reads,1);assert.equal(inspected.state,'failed');assert.equal(inspected.originalInstallationRestored,expected);
});
test('supervisor failed without an explicit untouched-installation signal cannot attest rollback',async t=>{
 const f=fixture(t);for(const status of [{state:'failed',code:'CLIENT_UPDATE_FAILED'},{state:'failed',installationUnchanged:false},{state:'failed',installationUnchanged:true,officialLaunchStarted:true}]){writeRemoteUpdateJson(f.statusFile,status);assert.equal((await inspectRemoteClientUpdateWorker(f.worker,{home:f.home,processAlive:()=>false})).originalInstallationRestored,false);}
});
