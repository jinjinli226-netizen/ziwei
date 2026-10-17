import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { acquireUpdateMaintenanceLock, releaseUpdateMaintenanceLock, maintenanceOwnerStatus, readUpdateResult, writeMaintenanceResult, describeUpdateFailure, updateFailureResult, recoverBeforeClientUpdateStop, inspectMaintenanceProcess, retireMaintenanceLock } from '../scripts/client-update.mjs';
import { runClientUpdateWorker } from '../scripts/client-update-worker.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const run = promisify(execFile);
function fixture(t) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-worker-lock-')));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const maintenance = path.join(home, 'maintenance'), directory = path.join(maintenance, 'update-' + randomUUID());
  fs.mkdirSync(directory, { recursive: true });
  const jobFile = path.join(directory, 'job.json'), resultFile = path.join(directory, 'result.json'), lockFile = path.join(maintenance, 'operation.lock');
  fs.writeFileSync(jobFile, JSON.stringify({ root: path.join(home, 'root'), directory, parentPid: 123 }));
  fs.writeFileSync(path.join(maintenance, 'latest-update.json'), JSON.stringify({ directory, resultFile }));
  const identity = (pid = process.pid, job = jobFile, creationTime = '2026-10-17T16:00:00.0000000Z') => ({ pid, creationTime, executable: process.execPath, command: [process.execPath, path.join(path.dirname(job), 'helper/scripts/client-update-worker.mjs'), job].map(value => JSON.stringify(value)).join(' ') });
  const legacy = (pid = 61536) => ({pid, operation:'update',jobFile});
  const inspect = async pid => pid === process.pid ? {state:'present',record:identity()} : {state:'exited'};
  const retired = [];
  const retire = async input => {
    if (digest(fs.readFileSync(input.file)) !== input.sha256) return false;
    fs.renameSync(input.file, input.archive); retired.push(input); return true;
  };
  return {home, maintenance, directory, jobFile, resultFile, lockFile, identity, legacy, inspect, retire, retired};
}

test('a dead legacy worker lock is archived once and the new worker obtains an owned lease', async t => {
  const f = fixture(t), old = JSON.stringify(f.legacy()); fs.writeFileSync(f.lockFile, old);
  const lease = await acquireUpdateMaintenanceLock({home:f.home,jobFile:f.jobFile,inspectProcess:f.inspect,retireLock:f.retire});
  assert.equal(f.retired.length, 1); assert.equal(f.retired[0].owner.state, 'exited');
  assert.equal(fs.readFileSync(f.retired[0].archive, 'utf8'), old);
  assert.equal(JSON.parse(fs.readFileSync(f.lockFile)).pid, process.pid);
  assert.equal(lease.lock.version, 2); assert.equal(releaseUpdateMaintenanceLock(lease), true);
  assert.equal(fs.existsSync(f.lockFile), false);
});

test('a living legacy worker and an uninspectable worker never lose their lock', async t => {
  for (const unknown of [false, true]) {
    const f = fixture(t), old = JSON.stringify(f.legacy()); fs.writeFileSync(f.lockFile, old);
    const inspectProcess = async pid => pid === process.pid ? f.inspect(pid) : unknown ? {state:'unknown'} : {state:'present',record:f.identity(pid)};
    await assert.rejects(acquireUpdateMaintenanceLock({home:f.home,jobFile:f.jobFile,inspectProcess,retireLock:f.retire}), error => error.code === (unknown ? 'MAINTENANCE_OWNER_UNVERIFIED' : 'MAINTENANCE_BUSY'));
    assert.equal(f.retired.length, 0); assert.equal(fs.readFileSync(f.lockFile, 'utf8'), old);
  }
});

test('PID reuse is distinguished by creation time and the exact worker argv, including old-format locks', async t => {
  const f = fixture(t), current = f.identity(61536), base = {...f.legacy(),version:2,creationTime:current.creationTime,executable:current.executable,commandHash:digest(current.command)};
  assert.equal((await maintenanceOwnerStatus(base,{inspectProcess:async()=>({state:'present',record:current})})).state, 'alive');
  for (const changed of [{...current,creationTime:'2026-10-17T17:00:00.0000000Z'},{...current,command:'"unrelated.exe" --private-token SECRET'}]) {
    assert.equal((await maintenanceOwnerStatus(base,{inspectProcess:async()=>({state:'present',record:changed})})).state, 'pid_reused');
  }
  const legacyStatus = await maintenanceOwnerStatus(f.legacy(),{inspectProcess:async()=>({state:'present',record:{...current,command:'"unrelated.exe"'}})});
  assert.equal(legacyStatus.state, 'pid_reused');
});

test('a contender changing the lock between observation and native retirement cannot be removed', async t => {
  const f = fixture(t); fs.writeFileSync(f.lockFile, JSON.stringify(f.legacy()));
  let changed = false;
  const retireLock = async input => {
    if (!changed) { changed = true; fs.writeFileSync(f.lockFile, JSON.stringify(f.legacy(process.pid))); }
    return f.retire(input);
  };
  await assert.rejects(acquireUpdateMaintenanceLock({home:f.home,jobFile:f.jobFile,inspectProcess:f.inspect,retireLock}), error=>error.code==='MAINTENANCE_BUSY');
  assert.equal(f.retired.length,0); assert.equal(JSON.parse(fs.readFileSync(f.lockFile)).pid,process.pid);
});

test('malformed locks and maintenance paths are refused without deleting their bytes', async t => {
  const f = fixture(t); fs.writeFileSync(f.lockFile, '{broken');
  await assert.rejects(acquireUpdateMaintenanceLock({home:f.home,jobFile:f.jobFile,inspectProcess:f.inspect,retireLock:f.retire}), error=>error.code==='MAINTENANCE_OWNER_UNVERIFIED');
  assert.equal(fs.readFileSync(f.lockFile,'utf8'),'{broken'); assert.equal(f.retired.length,0);
  await assert.rejects(acquireUpdateMaintenanceLock({home:f.home,jobFile:path.join(f.home,'job.json'),inspectProcess:f.inspect,retireLock:f.retire}), error=>error.code==='UNSAFE_PATH');
});

test('a crashed worker is interrupted and an unknown probe remains explicitly unknown', async t => {
  const f = fixture(t); fs.writeFileSync(f.resultFile,JSON.stringify({state:'running',operation:'update',finishedAt:'stale-time'}));
  fs.writeFileSync(f.lockFile,JSON.stringify(f.legacy()));
  let status = await readUpdateResult({env:{ZIWEI_USER_HOME:f.home},inspectProcess:f.inspect});
  assert.equal(status.state,'interrupted'); assert.equal(status.workerStatus,'exited'); assert.equal(status.workerPid,61536);
  status = await readUpdateResult({env:{ZIWEI_USER_HOME:f.home},inspectProcess:async()=>({state:'unknown'})});
  assert.equal(status.state,'running'); assert.equal(status.workerStatus,'unknown'); assert.equal(Object.hasOwn(status,'finishedAt'),false);
});

test('a worker finishing during the awaited native probe reports its exact new terminal result', async t => {
  for (const source of ['result', 'terminal', 'log']) {
    for (const outcome of source === 'log' ? ['failed'] : ['complete', 'failed']) {
      const f = fixture(t), before = JSON.stringify({state:'running',operation:'update',workerPid:61536});
      fs.writeFileSync(f.resultFile,before);fs.writeFileSync(f.lockFile,JSON.stringify(f.legacy()));
      const expected = {state:outcome,operation:'update',code:outcome==='failed'?'UPDATE_FAILED':undefined,reasonCode:outcome==='failed'?'CLIENT_FORCE_ABANDON_REFUSED':undefined,recoveryPhase:outcome==='failed'?'offline_prepare':undefined,finishedAt:'2026-10-18T01:00:00.000Z'};
      let probes=0;
      const inspectProcess=async()=>{
        probes++;await new Promise(resolve=>setImmediate(resolve));
        if(source==='log') fs.writeFileSync(path.join(f.directory,'maintenance.jsonl'),JSON.stringify({at:expected.finishedAt,pid:61536,event:'maintenance_failed',failureStage:'recover_history',reasonCode:'CLIENT_FORCE_ABANDON_REFUSED'})+'\n');
        else writeMaintenanceResult(source==='result'?f.resultFile:path.join(f.directory,'terminal.json'),expected);
        return {state:'exited'};
      };
      const status=await readUpdateResult({env:{ZIWEI_USER_HOME:f.home},inspectProcess});
      assert.equal(probes,1);assert.equal(status.state,outcome);assert.equal(status.workerStatus,'exited');assert.equal(status.finishedAt,expected.finishedAt);
      assert.notEqual(status.code,'MAINTENANCE_WORKER_EXITED');
      if(source==='log') {assert.equal(status.recoveredFrom,'maintenance-log');assert.equal(status.reasonCode,'CLIENT_FORCE_ABANDON_REFUSED');}
      else {assert.equal(status.recoveryPhase,expected.recoveryPhase);assert.equal(status.reasonCode,expected.reasonCode);}
      if(source!=='result') assert.equal(fs.readFileSync(f.resultFile,'utf8'),before,'reading status never rewrites the original running snapshot');
      assert.deepEqual(JSON.parse(fs.readFileSync(f.lockFile)),f.legacy(),'reading status never retires a maintenance lock');
    }
  }
});

test('the reported old failure is recovered from a safe log projection while stale result says running', async t => {
  const f = fixture(t), at = '2026-10-17T16:08:15.684Z';
  fs.writeFileSync(f.resultFile,JSON.stringify({state:'running',operation:'update'}));fs.writeFileSync(f.lockFile,JSON.stringify(f.legacy()));
  fs.writeFileSync(path.join(f.directory,'maintenance.jsonl'),JSON.stringify({at,pid:61536,event:'update_failed',failureStage:'recover_history',reasonCode:'RECOVER_HISTORY_FAILED',reason:'PRIVATE_ACCESS_TOKEN',originalRestored:true})+'\n'+ '{"event":"maintenance_failed","reason":"BROKEN');
  const status = await readUpdateResult({env:{ZIWEI_USER_HOME:f.home},inspectProcess:f.inspect});
  assert.equal(status.state,'failed');assert.equal(status.failureStage,'recover_history');assert.equal(status.reasonCode,'RECOVER_HISTORY_FAILED');
  assert.equal(status.finishedAt,at);assert.equal(status.workerStatus,'exited');assert.equal(status.recoveredFrom,'maintenance-log');
  assert.doesNotMatch(JSON.stringify(status),/PRIVATE_ACCESS_TOKEN|BROKEN/);
});

test('worker logging failures do not skip terminal status or releasing the owned lock',async t=>{
  const f=fixture(t);let releases=0;
  const result=await runClientUpdateWorker({jobFile:f.jobFile,env:{ZIWEI_USER_HOME:f.home},waitParent:async()=>{},acquireLock:async()=>({lock:f.legacy(process.pid)}),releaseLock:()=>{releases++;return true;},appendLog:()=>{throw Object.assign(new Error('PRIVATE_LOG_DETAIL'),{code:'ENOSPC'});},performUpdate:async()=>{throw Object.assign(new Error('PRIVATE_PROVIDER_TOKEN'),{code:'EACCES'});}});
  assert.equal(result.exitCode,1);assert.equal(releases,1);assert.equal(result.loggingFailed,true);
  for(const name of ['terminal.json','result.json']){const saved=JSON.parse(fs.readFileSync(path.join(f.directory,name)));assert.equal(saved.state,'failed');assert.equal(saved.reasonCode,'EACCES');assert.doesNotMatch(JSON.stringify(saved),/PRIVATE_/);}
});

test('a failed result.json replacement retains the independent terminal ledger and always releases the lease',async t=>{
  const f=fixture(t);let writes=0,releases=0;
  const result=await runClientUpdateWorker({jobFile:f.jobFile,env:{ZIWEI_USER_HOME:f.home},waitParent:async()=>{},acquireLock:async()=>({lock:f.legacy(process.pid)}),releaseLock:()=>{releases++;return true;},writeResult:(file,value)=>{if(file===f.resultFile&&++writes>1)throw Object.assign(new Error('PRIVATE_FS_DETAIL'),{code:'EACCES'});writeMaintenanceResult(file,value);},performUpdate:async()=>{throw Object.assign(new Error('PRIVATE'),{code:'ECONNRESET'});}});
  assert.equal(result.exitCode,1);assert.equal(releases,1);assert.equal(JSON.parse(fs.readFileSync(f.resultFile)).state,'running');
  const status=await readUpdateResult({env:{ZIWEI_USER_HOME:f.home},inspectProcess:f.inspect});assert.equal(status.state,'failed');assert.equal(status.reasonCode,'ECONNRESET');
});

test('status CLI awaits liveness and accepts only an exact job under the user maintenance root',async t=>{
  const f=fixture(t);fs.writeFileSync(f.resultFile,JSON.stringify({state:'failed',operation:'update',reason:'已保留'}));
  const {stdout}=await run(process.execPath,[path.resolve('scripts/ziwei-user.mjs'),'update-status','--result',f.resultFile,'--json'],{env:{...process.env,ZIWEI_USER_HOME:f.home}}).catch(error=>error);
  const status=JSON.parse(stdout);assert.equal(status.state,'failed');assert.equal(status.resultFile,f.resultFile);assert.equal(status.reason,'已保留');assert.doesNotMatch(stdout,/已/);
  await assert.rejects(readUpdateResult({env:{ZIWEI_USER_HOME:f.home},resultFile:path.join(f.home,'outside.json')}),error=>error.code==='UNSAFE_PATH');
});

test('offline operator abandonment is accepted only with explicit false exit facts and passes logger to candidate',async()=>{
  const absent={recovered:true,operatorAbandoned:true,currentDaemonAbsent:true,stopped:false,wasRunning:false,originalExecutionExitConfirmed:false,executionConfirmedStopped:false};let received;
  const result=await recoverBeforeClientUpdateStop({candidate:process.cwd(),root:process.cwd(),log:()=>{},load:async()=>({recoverHistoricalPrelaunchForUpdate:async input=>{received=input;return absent;}})});
  assert.deepEqual(result,absent);assert.equal(typeof received.log,'function');
  for (const contradictory of [{...absent,executionConfirmedStopped:undefined},{...absent,stopped:true,wasRunning:true},{...absent,stopped:true},{...absent,wasRunning:true},{...absent,operatorAbandoned:false}]) {
    await assert.rejects(recoverBeforeClientUpdateStop({candidate:process.cwd(),root:process.cwd(),load:async()=>({recoverHistoricalPrelaunchForUpdate:async()=>contradictory})}),error=>error.code==='HISTORICAL_PRELAUNCH_RECOVERY_REFUSED');
  }
});

test('only allowlisted recovery phase, reason and precise local rule reach public update diagnostics',()=>{
  const error={code:'CLIENT_FORCE_ABANDON_REFUSED',recoveryPhase:'offline_observation',reasonCode:'EVIDENCE_MISMATCH',recoveryRule:'JOURNAL_TERMINAL',message:'PRIVATE',stdout:'PRIVATE',configuration:'PRIVATE'};
  const safe=describeUpdateFailure(error,'recover_history');
  assert.equal(safe.recoveryPhase,'offline_observation');assert.equal(safe.recoveryReasonCode,'EVIDENCE_MISMATCH');assert.equal(safe.recoveryRule,'JOURNAL_TERMINAL');assert.doesNotMatch(JSON.stringify(safe),/PRIVATE/);
  const result=updateFailureResult(error,'recover_history');assert.equal(result.recoveryRule,'JOURNAL_TERMINAL');assert.match(result.message,/JOURNAL_TERMINAL/);assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
  const unsafe=describeUpdateFailure({code:'CLIENT_FORCE_ABANDON_REFUSED',recoveryPhase:'PRIVATE_TOKEN',reasonCode:'PRIVATE_TOKEN',recoveryRule:'PRIVATE_TOKEN'},'recover_history');assert.equal(Object.hasOwn(unsafe,'recoveryPhase'),false);assert.equal(Object.hasOwn(unsafe,'recoveryReasonCode'),false);assert.equal(Object.hasOwn(unsafe,'recoveryRule'),false);
  const nested=describeUpdateFailure({code:'CLIENT_FORCE_ABANDON_REFUSED',cause:{recoveryRule:'ACTION_BLOB_DIGEST',stdout:'PRIVATE'}},'recover_history');assert.equal(nested.recoveryRule,'ACTION_BLOB_DIGEST');assert.doesNotMatch(JSON.stringify(nested),/PRIVATE/);
});

test('Windows native stale retirement holds the exact file and rejects live worker or changed bytes',{skip:process.platform!=='win32',timeout:30000},async t=>{
  const f=fixture(t),child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});t.after(()=>{try{child.kill();}catch{}});
  const raw=JSON.stringify(f.legacy(child.pid));fs.writeFileSync(f.lockFile,raw);const archive=path.join(f.maintenance,'retired-native.json');
  assert.equal(await retireMaintenanceLock({file:f.lockFile,archive,sha256:digest(raw),owner:{state:'exited',pid:child.pid,probe:{state:'exited'}}}),false);
  child.kill();await new Promise(resolve=>child.once('exit',resolve));assert.equal((await inspectMaintenanceProcess(child.pid)).state,'exited');
  assert.equal(await retireMaintenanceLock({file:f.lockFile,archive,sha256:'0'.repeat(64),owner:{state:'exited',pid:child.pid,probe:{state:'exited'}}}),false);
  assert.equal(await retireMaintenanceLock({file:f.lockFile,archive,sha256:digest(raw),owner:{state:'exited',pid:child.pid,probe:{state:'exited'}}}),true);
  assert.equal(fs.readFileSync(archive,'utf8'),raw);assert.equal(fs.existsSync(f.lockFile),false);
});
