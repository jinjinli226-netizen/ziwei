import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performClientUpdate, waitForParentExit, updateFailureResult, acquireUpdateMaintenanceLock, releaseUpdateMaintenanceLock, writeMaintenanceResult } from './client-update.mjs';

/** The detached worker must finish its result and release its own lease even
 * when logging, a result replacement or the update itself throws. */
export async function runClientUpdateWorker({ jobFile, env = process.env, waitParent = waitForParentExit, performUpdate = performClientUpdate, acquireLock = acquireUpdateMaintenanceLock, releaseLock = releaseUpdateMaintenanceLock, writeResult = writeMaintenanceResult, appendLog = fs.appendFileSync, clock = () => new Date().toISOString() } = {}) {
  jobFile = path.resolve(jobFile);
  const job = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
  if (path.resolve(job.directory) !== path.dirname(jobFile)) throw Object.assign(new Error('维护任务目录不匹配'), { code: 'UNSAFE_PATH' });
  const resultFile = path.join(job.directory, 'result.json'), terminalFile = path.join(job.directory, 'terminal.json');
  const logFile = path.join(job.directory, 'maintenance.jsonl');
  let loggingFailed = false, resultFailed = false, lease, failureStage = 'wait_parent';
  const log = (event, data = {}) => {
    try { appendLog(logFile, JSON.stringify({ at: clock(), pid: process.pid, event, ...data }).replace(/[\u007f-\uffff]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0')) + '\n', { mode: 0o600 }); }
    catch { loggingFailed = true; }
  };
  const terminal = value => {
    const record = { ...value, finishedAt: clock(), ...(loggingFailed ? { loggingFailed: true } : {}) };
    let persisted = false;
    // terminal.json is a second, independent terminal ledger. update-status can
    // use it when Windows refuses to replace result.json or the process crashes
    // after this write. Neither contains raw child output or credentials.
    for (const file of [terminalFile, resultFile]) {
      try { writeResult(file, record); persisted = true; }
      catch { resultFailed = true; log('maintenance_result_write_failed', { code: 'MAINTENANCE_RESULT_WRITE_FAILED' }); }
    }
    return persisted;
  };
  let exitCode = 0;
  const heartbeat = setInterval(() => log('maintenance_heartbeat'), 10000); heartbeat.unref();
  try {
    await waitParent(job.parentPid);
    failureStage = 'acquire_lock';
    lease = await acquireLock({ home: env.ZIWEI_USER_HOME, jobFile, log });
    writeResult(path.join(job.directory, 'worker.json'), lease.lock);
    failureStage = 'validate_installation';
    log('update_started');
    writeResult(resultFile, { state: 'running', operation: 'update', startedAt: clock(), workerPid: process.pid });
    const updated = await performUpdate({ ...job, env, log });
    if (!terminal(updated)) exitCode = 1;
  } catch (error) {
    const failed = updateFailureResult(error, failureStage);
    const { message: _message, state: _state, operation: _operation, ...diagnostic } = failed;
    // Write the terminal state before best-effort logging; a log I/O failure
    // must not leave the last visible result as "running".
    terminal(failed);
    log('maintenance_failed', diagnostic);
    exitCode = 1;
  } finally {
    clearInterval(heartbeat);
    try { log('maintenance_exit', { exitCode }); }
    finally {
      if (lease) { try { if (!releaseLock(lease)) throw new Error('LEASE_RELEASE_FAILED'); } catch { log('maintenance_lock_release_failed', { code: 'MAINTENANCE_LOCK_RELEASE_FAILED' }); exitCode = 1; } }
    }
  }
  return { exitCode: resultFailed ? 1 : exitCode, loggingFailed, resultFailed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = (await runClientUpdateWorker({ jobFile: process.argv[2] })).exitCode; }
  catch { process.exitCode = 1; } // Never echo arbitrary startup errors or job data.
}
