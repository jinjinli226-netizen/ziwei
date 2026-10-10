import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { performClientUninstall, waitForMaintenanceParent } from './client-lifecycle.mjs';

const jobFile = path.resolve(process.argv[2]);
const job = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
const resultFile = path.join(job.directory, 'result.json');
const log = (event, data = {}) => fs.appendFileSync(path.join(job.directory, 'maintenance.jsonl'), JSON.stringify({ at: new Date().toISOString(), pid: process.pid, event, ...data }) + '\n', { mode: 0o600 });
const result = value => {
  const temporary = path.join(job.directory, `result-${randomUUID()}.tmp`);
  fs.writeFileSync(temporary, JSON.stringify({ ...value, finishedAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, resultFile);
};
const heartbeat = setInterval(() => log('maintenance_heartbeat'), 10000); heartbeat.unref();
try {
  if (job.operation !== 'uninstall') throw new Error('未知维护操作');
  await waitForMaintenanceParent(job.parentPid);
  result({ state: 'running', operation: 'uninstall' });
  result(await performClientUninstall({ ...job, env: process.env, log }));
} catch (error) {
  log('maintenance_failed', { code: error.code || 'UNINSTALL_FAILED' });
  result({ state: 'failed', operation: 'uninstall', code: error.code || 'UNINSTALL_FAILED', message: error.message });
  process.exitCode = 1;
} finally {
  clearInterval(heartbeat);
  log('maintenance_exit', { exitCode: process.exitCode || 0 });
}
