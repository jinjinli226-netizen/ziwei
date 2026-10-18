import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveWorkspaceConnections } from '../daemon/config.mjs';
import { downloadVerifiedPackage, launchClientUpdate, readUpdateResult } from './client-update.mjs';
import { validateRemoteUpdateRequest, readRemoteUpdateJson, writeRemoteUpdateJson, remoteUpdatePath, remoteUpdateErrorCode } from '../src/client-remote-update.mjs';

export const REMOTE_UPDATE_HELPER_FILES = Object.freeze(['package.json', 'daemon/config.mjs', 'src/management-bootstrap.mjs', 'src/client-remote-update.mjs', 'scripts/client-remote-update-worker.mjs', 'scripts/client-update.mjs', 'scripts/client-update-worker.mjs', 'scripts/client-lifecycle.mjs', 'scripts/client-retained-stop-recovery.mjs', 'scripts/client-legacy-identity.mjs', 'scripts/client-legacy-identity.ps1']);
const failure = code => Object.assign(new Error(code), { code });
function outside(file, root) { const relative = path.relative(path.resolve(root), path.resolve(file)); return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative) ? false : Boolean(relative); }

/** Called only by the daemon, never from an employee action/Job. This outer
 * supervisor copies its whole import closure outside npm before spawning. */
export async function launchRemoteClientUpdate({ root, home, configPath, request, claimToken, env = process.env, spawnProcess = spawn } = {}) {
  if (process.platform !== 'win32') throw failure('WINDOWS_ONLY');
  if (!outside(home, root) || !outside(configPath, root)) throw failure('CLIENT_UPDATE_UNSAFE_PATH');
  const directory = path.join(path.resolve(home), 'maintenance', 'remote-update-' + randomUUID());
  const helper = path.join(directory, 'helper');
  fs.mkdirSync(helper, { recursive: true, mode: 0o700 });
  for (const relative of REMOTE_UPDATE_HELPER_FILES) {
    const source = path.join(root, relative), target = path.join(helper, relative);
    if (!fs.lstatSync(source).isFile() || fs.lstatSync(source).isSymbolicLink()) throw failure('CLIENT_UPDATE_HELPER_INVALID');
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 }); fs.copyFileSync(source, target);
  }
  const jobFile = path.join(directory, 'remote-job.json');
  writeRemoteUpdateJson(jobFile, { schemaVersion: 1, root: path.resolve(root), home: path.resolve(home), configPath: path.resolve(configPath), directory, request, claimToken });
  const statusFile = path.join(directory, 'supervisor-result.json');
  writeRemoteUpdateJson(statusFile, { state: 'starting', startedAt: Date.now() });
  const child = spawnProcess(process.execPath, [path.join(helper, 'scripts/client-remote-update-worker.mjs'), jobFile], { env: { ...env, ZIWEI_USER_HOME: path.resolve(home), ZIWEI_CONFIG: path.resolve(configPath) }, cwd: directory, detached: true, windowsHide: true, stdio: 'ignore' });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); }); child.unref();
  const identity = { directory, workerPid: child.pid, startedAt: Date.now() };
  writeRemoteUpdateJson(path.join(directory, 'supervisor-identity.json'), identity);
  return identity;
}

/** No sleeps waiting for the daemon parent: the existing official worker waits
 * for this short-lived supervisor to exit, then owns drain/stop/install/restart. */
export async function runRemoteClientUpdateWorker({ jobFile, download = downloadVerifiedPackage, launch = launchClientUpdate, fetchImpl = fetch, clock = Date.now, env = process.env } = {}) {
  const job = readRemoteUpdateJson(jobFile), statusFile = path.join(path.dirname(jobFile), 'supervisor-result.json');
  try {
    if (job.schemaVersion !== 1 || path.resolve(job.directory) !== path.dirname(path.resolve(jobFile)) || !outside(job.directory, job.root) || !outside(job.configPath, job.root) || !outside(job.home, job.root)) throw failure('CLIENT_UPDATE_JOB_INVALID');
    const request = validateRemoteUpdateRequest(job.request, job.request);
    writeRemoteUpdateJson(statusFile, { state: 'starting', workerPid: process.pid, startedAt: clock() });
    if (typeof job.claimToken !== 'string' || job.claimToken.length < 16 || job.claimToken.length > 512) throw failure('CLIENT_UPDATE_CLAIM_INVALID');
    const configuration = readRemoteUpdateJson(job.configPath);
    const connection = resolveWorkspaceConnections(configuration, { configPath: job.configPath, root: job.root }).connections.find(row => row.workspace === request.workspace && row.deviceId === request.deviceId);
    if (!connection?.deviceToken) throw failure('CLIENT_UPDATE_CONNECTION_MISSING');
    // Reconfirm cancellation and the immutable pin immediately before download.
    const response = await fetchImpl(connection.apiBase + remoteUpdatePath(request), { headers: { 'x-ziwei-device-token': connection.deviceToken }, redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw failure('CLIENT_UPDATE_AUTHORIZATION_FAILED');
    const latest = validateRemoteUpdateRequest((await response.json()).request, request);
    if (['complete', 'failed', 'canceled', 'cancelled'].includes(latest.state)) throw failure('CLIENT_UPDATE_CANCELED');
    if (['id', 'targetBuild', 'sha256', 'source'].some(key => latest[key] !== request[key])) throw failure('CLIENT_UPDATE_TARGET_CHANGED');
    const artifactFile = path.join(job.directory, 'remote-pinned-update.tgz');
    await download({ url: request.source, sha256: request.sha256, destination: artifactFile });
    const recheck = await fetchImpl(connection.apiBase + remoteUpdatePath(request), { headers: { 'x-ziwei-device-token': connection.deviceToken }, redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!recheck.ok) throw failure('CLIENT_UPDATE_AUTHORIZATION_FAILED');
    const afterDownload = validateRemoteUpdateRequest((await recheck.json()).request, request);
    if (['succeeded', 'complete', 'failed', 'canceled', 'cancelled'].includes(afterDownload.state)) throw failure('CLIENT_UPDATE_CANCELED');
    if (['id', 'targetBuild', 'sha256', 'source'].some(key => afterDownload[key] !== request[key])) throw failure('CLIENT_UPDATE_TARGET_CHANGED');
    const helperRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
    const queued = await launch({ codeRoot: helperRoot, root: job.root, env: { ...env, ZIWEI_USER_HOME: job.home, ZIWEI_CONFIG: job.configPath }, args: { package: artifactFile, sha256: request.sha256, expectedBuild: request.targetBuild } });
    writeRemoteUpdateJson(statusFile, { state: 'queued', workerPid: queued.workerPid, resultFile: queued.resultFile, queuedAt: clock() });
    return { state: 'queued' };
  } catch (error) {
    const code = remoteUpdateErrorCode(error);
    writeRemoteUpdateJson(statusFile, { state: 'failed', code, finishedAt: clock() });
    return { state: 'failed', code };
  }
}

export async function inspectRemoteClientUpdateWorker(worker, { home, env = process.env, readStatus = readUpdateResult, now = Date.now(), processAlive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } } } = {}) {
  if (!worker || !Number.isFinite(worker.startedAt)) return { state: 'interrupted', code: 'CLIENT_UPDATE_INTERRUPTED' };
  const parent = path.join(path.resolve(home), 'maintenance');
  if (path.dirname(path.resolve(worker.directory || '')) !== parent || !/^remote-update-[a-f0-9-]{36}$/.test(path.basename(worker.directory))) return { state: 'failed', code: 'CLIENT_UPDATE_STATE_INVALID' };
  let status;
  try { status = readRemoteUpdateJson(path.join(worker.directory, 'supervisor-result.json')); }
  catch (error) { if (error.code !== 'ENOENT') return { state: 'failed', code: 'CLIENT_UPDATE_STATE_INVALID' }; }
  if (status?.state === 'failed') return { state: 'failed', code: remoteUpdateErrorCode(status) };
  if (status?.state === 'queued') {
    const resultPath = path.resolve(status.resultFile || '');
    if (path.dirname(path.dirname(resultPath)) !== parent || !/^update-[a-f0-9-]{36}$/.test(path.basename(path.dirname(resultPath))) || path.basename(resultPath) !== 'result.json') return { state: 'failed', code: 'CLIENT_UPDATE_STATE_INVALID' };
    const result = await readStatus({ env: { ...env, ZIWEI_USER_HOME: home }, resultFile: resultPath });
    if (result.state === 'complete') return { state: 'complete' };
    if (['failed', 'interrupted'].includes(result.state)) return { state: 'failed', code: remoteUpdateErrorCode({ code: result.reasonCode || result.code }) };
    return { state: 'updating' };
  }
  if (!Number.isSafeInteger(worker.workerPid) || worker.workerPid < 1) return now - worker.startedAt < 10_000 ? { state: 'updating' } : { state: 'interrupted', code: 'CLIENT_UPDATE_INTERRUPTED' };
  if (!processAlive(worker.workerPid)) return { state: 'interrupted', code: 'CLIENT_UPDATE_INTERRUPTED' };
  // Download and initial worker staging are bounded. An unexplained supervisor
  // never creates an OS/global maintenance lock or blocks future update requests.
  if (now - worker.startedAt > 10 * 60_000) return { state: 'failed', code: 'CLIENT_UPDATE_SUPERVISOR_TIMEOUT' };
  return { state: 'updating' };
}

/** Recover the spawn/ledger crash window by matching only this immutable,
 * already-claimed request. An unrelated historical helper cannot be adopted. */
export function recoverRemoteClientUpdateWorker({ home, request, claimToken }) {
  const maintenance = path.join(path.resolve(home), 'maintenance'); let names;
  try { names = fs.readdirSync(maintenance).filter(name => /^remote-update-[a-f0-9-]{36}$/.test(name)).map(name => ({ name, time: fs.statSync(path.join(maintenance, name)).mtimeMs })).sort((a, b) => b.time - a.time).slice(0, 64); }
  catch { return null; }
  for (const { name, time } of names) {
    const directory = path.join(maintenance, name);
    try {
      const job = readRemoteUpdateJson(path.join(directory, 'remote-job.json'));
      if (job.claimToken !== claimToken || path.resolve(job.home) !== path.resolve(home) || ['id', 'workspace', 'deviceId', 'hostId', 'targetBuild', 'sha256', 'source'].some(key => job.request?.[key] !== request[key])) continue;
      let identity, status;
      try { identity = readRemoteUpdateJson(path.join(directory, 'supervisor-identity.json')); } catch {}
      try { status = readRemoteUpdateJson(path.join(directory, 'supervisor-result.json')); } catch {}
      return { directory, workerPid: identity?.workerPid || status?.workerPid || null, startedAt: identity?.startedAt || status?.startedAt || time };
    } catch {}
  }
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = (await runRemoteClientUpdateWorker({ jobFile: process.argv[2] })).state === 'queued' ? 0 : 1; }
  catch { process.exitCode = 1; }
}
