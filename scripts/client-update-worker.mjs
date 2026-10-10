import fs from 'node:fs';
import path from 'node:path';
import { performClientUpdate, waitForParentExit } from './client-update.mjs';

const jobFile = path.resolve(process.argv[2]);
const job = JSON.parse(fs.readFileSync(jobFile));
const resultFile = path.join(job.directory, 'result.json');
const logFile = path.join(job.directory, 'maintenance.jsonl');
const log = (event, data = {}) => fs.appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), pid: process.pid, event, ...data }) + '\n', { mode: 0o600 });
const result = value => { const staged = resultFile + '.next-' + process.pid; fs.writeFileSync(staged, JSON.stringify({ ...value, finishedAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(staged, resultFile); };
const lockFile = path.join(process.env.ZIWEI_USER_HOME, 'maintenance', 'operation.lock');
const lock = JSON.stringify({ pid: process.pid, operation: 'update', jobFile });
let ownsLock = false;
const heartbeat = setInterval(() => log('maintenance_heartbeat'), 10_000); heartbeat.unref();
try {
  await waitForParentExit(job.parentPid);
  try { fs.writeFileSync(lockFile, lock, { flag: 'wx', mode: 0o600 }); ownsLock = true; }
  catch (error) { if (error.code === 'EEXIST') throw new Error('已有客户端维护任务或待核实的维护锁；未同时更新/卸载，请查看上一任务结果。'); throw error; }
  log('update_started');
  result({ state: 'running', operation: 'update' });
  result(await performClientUpdate({ ...job, env: process.env, log }));
} catch (error) {
  log('maintenance_failed', { code: error.code || 'UPDATE_FAILED' });
  result({ state: 'failed', operation: 'update', message: error.message });
  process.exitCode = 1;
} finally {
  clearInterval(heartbeat);
  log('maintenance_exit', { exitCode: process.exitCode || 0 });
  if (ownsLock && fs.readFileSync(lockFile, 'utf8') === lock) fs.unlinkSync(lockFile);
}
