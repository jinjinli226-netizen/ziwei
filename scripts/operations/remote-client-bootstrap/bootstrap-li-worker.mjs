// Explicitly authorized first-install bridge only. This is not the new remote
// update protocol and must not be used as its acceptance evidence.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const WORKSPACE = 'bigtron', DEVICE = 'device_bfd9a3d2-c2cc-4a36-8bd8-465bea492493';
const USER = 'C:\\Users\\25941';
export const LI_BOOTSTRAP_ROOT = 'D:\\work\\nodejs\\node_global\\node_modules\\ziwei';
export const LI_BOOTSTRAP_PREFIX = 'D:\\work\\nodejs\\node_global';
const need = (value, code) => { if (!value) throw Object.assign(new Error(code), { code }); };
const sha = value => createHash('sha256').update(value).digest('hex');
const samePath = (a, b) => typeof a === 'string' && typeof b === 'string' && path.win32.normalize(a).toLowerCase() === path.win32.normalize(b).toLowerCase();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function noLinks(file) { for (let current = path.resolve(file); ; current = path.dirname(current)) { try { need(!fs.lstatSync(current).isSymbolicLink(), 'BOOTSTRAP_PATH_UNSAFE'); } catch (error) { if (error.code !== 'ENOENT') throw error; } if (current === path.dirname(current)) break; } }
function read(file) { noLinks(file); need(fs.statSync(file).size < 1024 * 1024, 'BOOTSTRAP_FILE_TOO_LARGE'); return JSON.parse(fs.readFileSync(file, 'utf8')); }
function write(file, value) { noLinks(file); fs.writeFileSync(file, JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 }); }
export function validateLiBootstrapPins(plan, { platform = process.platform, env = process.env, nodeExe = process.execPath } = {}) {
  need(plan.schemaVersion === 1 && plan.workspace === WORKSPACE && plan.deviceId === DEVICE && plan.acceptanceStage === 'bootstrap-validation', 'BOOTSTRAP_SCOPE_INVALID');
  need(platform === 'win32' && samePath(env.USERPROFILE, USER) && samePath(plan.userProfile, USER), 'BOOTSTRAP_USER_INVALID');
  need(samePath(plan.userDirectory, path.win32.join(USER, 'AppData/Local/Ziwei/ziwei_user')) && samePath(plan.configPath, path.win32.join(plan.userDirectory, 'ziwei_user.json')), 'BOOTSTRAP_SCOPE_INVALID');
  need(samePath(plan.root, LI_BOOTSTRAP_ROOT) && samePath(nodeExe, plan.nodeExe) && samePath(plan.nodeExe, 'C:\\Program Files\\nodejs\\node.exe') && samePath(plan.jobDirectory, path.win32.join(plan.userDirectory, 'maintenance', 'remote-bootstrap-' + plan.nonce)), 'BOOTSTRAP_SCOPE_INVALID');
  need(/^[a-f0-9-]{36}$/.test(plan.nonce) && /^S-[0-9-]+$/.test(plan.ownerSid) && Number.isSafeInteger(plan.sourcePid) && plan.sourcePid > 0 && /^[a-f0-9]{40}$/.test(plan.candidateCommit) && digest(plan.sourceBuild) && digest(plan.targetBuild) && digest(plan.archiveSha256) && digest(plan.configSha256), 'BOOTSTRAP_PIN_INVALID');
  need(plan.targetBuild !== plan.sourceBuild && /^[A-Za-z0-9_-]{16,128}$/.test(plan.sourceNonce), 'BOOTSTRAP_PIN_INVALID');
  const url = new URL(plan.archiveUrl);
  need(url.origin === 'https://qzelynth.top' && /^\/downloads\/cli\/remote-client-bootstrap-[a-f0-9]{40}-[a-f0-9]{12}\.tgz$/.test(url.pathname) && !url.search && !url.hash && !url.username && !url.password, 'BOOTSTRAP_SOURCE_INVALID');
  need(url.pathname.endsWith('-' + plan.archiveSha256.slice(0, 12) + '.tgz'), 'BOOTSTRAP_SOURCE_INVALID');
  need(plan.ownerSid === 'S-1-5-21-4019069998-341204304-2024549848-1001', 'BOOTSTRAP_USER_INVALID');
}
function validate(plan) {
  validateLiBootstrapPins(plan);
  noLinks(plan.root); noLinks(plan.userDirectory); noLinks(plan.configPath); noLinks(plan.jobDirectory);
}
/** Child/process scope only. Never edit npmrc, registry, user or system env. */
export function normalizedLiBootstrapEnvironment(plan, inherited = process.env) {
  need(samePath(plan.root, LI_BOOTSTRAP_ROOT), 'BOOTSTRAP_SCOPE_INVALID');
  const env = { ...inherited };
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'npm_config_prefix') delete env[key];
  env.npm_config_prefix = LI_BOOTSTRAP_PREFIX;
  env.ZIWEI_USER_HOME = plan.userDirectory; env.ZIWEI_CONFIG = plan.configPath;
  return env;
}
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000 ? value : null;
export function bootstrapIdleObservation(row, phase) {
  need(['waiting_idle', 'before_pause', 'paused_idle', 'downloaded', 'updater_queued', 'updater_failed', 'target_ready'].includes(phase), 'BOOTSTRAP_OBSERVATION_PHASE_INVALID');
  return { schemaVersion: 1, phase, connectionState: ['connected', 'draining', 'quarantined'].includes(row?.connectionState) ? row.connectionState : 'unknown', pid: count(row?.pid), clientBuild: digest(row?.clientBuild) ? row.clientBuild : null, activeActionCount: count(row?.activeActionCount), pollingCount: count(row?.pollingCount), quarantinedActionCount: count(row?.quarantinedActionCount), stopSafe: typeof row?.maintenance?.stopSafe === 'boolean' ? row.maintenance.stopSafe : null, gatewaySafe: typeof row?.maintenance?.gatewaySafe === 'boolean' ? row.maintenance.gatewaySafe : null, stopIssues: Array.isArray(row?.maintenance?.stopIssues) ? row.maintenance.stopIssues.slice(0, 16).filter(issue => /^[A-Z][A-Z0-9_]{0,63}$/.test(issue?.code || '')).map(issue => ({ code: issue.code, ...(count(issue.count) !== null ? { count: issue.count } : {}) })) : [] };
}
export function writeBootstrapIdleObservation(plan, row, phase) {
  const observation = bootstrapIdleObservation(row, phase), latest = path.join(plan.jobDirectory, 'idle-observation.json');
  noLinks(plan.jobDirectory); noLinks(latest);
  try { const previous = read(latest); delete previous.at; if (JSON.stringify(previous) === JSON.stringify(observation)) return false; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const value = { ...observation, at: new Date().toISOString() }, event = path.join(plan.jobDirectory, 'idle-observation-' + Date.now() + '-' + randomUUID() + '.json');
  write(event, value);
  const temporary = latest + '.' + randomUUID() + '.tmp'; write(temporary, value);
  try { fs.renameSync(temporary, latest); } finally { fs.rmSync(temporary, { force: true }); }
  return true;
}
async function health() { const response = await fetch('http://127.0.0.1:20242/healthz', { redirect: 'error', signal: AbortSignal.timeout(3000) }); need(response.ok, 'BOOTSTRAP_HEALTH_UNAVAILABLE'); return response.json(); }
function sameClient(row, plan) { return row?.service === 'ziwei_user' && row.agentId === 'ziwei_user' && row.workspace === WORKSPACE && row.deviceId === DEVICE && samePath(row.lifecycle?.root, plan.root) && samePath(row.lifecycle?.configPath, plan.configPath) && row.lifecycle?.configSha256 === plan.configSha256; }
function source(row, plan) { return sameClient(row, plan) && row.clientBuild === plan.sourceBuild && row.pid === plan.sourcePid && row.lifecycle?.nonce === plan.sourceNonce; }
export function liBootstrapIdle(row) {
  // Historical file/receipt safety belongs to the trusted official updater's
  // recover_history and stop phases. Do not block that recovery in this bridge.
  // This permits no process termination: every live execution/uncertainty gate
  // remains strict and the official updater still decides whether stop is safe.
  return row.activeActionCount === 0 && row.pollingCount === 0 && row.quarantinedActionCount === 0 && row.executionQuarantined === false && row.maintenance?.gatewaySafe === true && Array.isArray(row.connectionErrors) && row.connectionErrors.length === 0;
}
const idle = liBootstrapIdle;
function connection(plan) {
  const bytes = fs.readFileSync(plan.configPath); need(sha(bytes) === plan.configSha256, 'BOOTSTRAP_CONFIG_CHANGED');
  const config = JSON.parse(bytes); need(config.workspace === WORKSPACE && config.deviceId === DEVICE && config.deviceToken && config.apiBase === 'https://qzelynth.top' && config.healthHost === '127.0.0.1' && config.healthPort === 20242, 'BOOTSTRAP_CONFIG_CHANGED'); return config;
}
async function control(plan, operation) {
  const config = connection(plan), response = await fetch('http://127.0.0.1:20242/local/connection-control', { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', 'x-ziwei-local-control': config.deviceToken }, body: JSON.stringify({ operation, nonce: plan.sourceNonce }), signal: AbortSignal.timeout(3000) });
  need(response.ok, 'BOOTSTRAP_CONTROL_REFUSED'); const row = await response.json(); need(source(row, plan), 'BOOTSTRAP_INSTANCE_CHANGED'); return row;
}
export async function resumeOriginalBootstrap(plan, { healthImpl = health, controlImpl = control } = {}) {
  try { const row = await healthImpl(); if (source(row, plan) && row.connectionState === 'draining') await controlImpl(plan, 'resume'); }
  catch {} // Never resume a different/new daemon or report a fabricated success.
}
export async function withBootstrapPause(plan, body, { controlImpl = control, resumeImpl = resumeOriginalBootstrap } = {}) {
  // A timed-out response does not prove that pause was rejected. The pause
  // request itself belongs inside the same exact-boot recovery boundary.
  try { await controlImpl(plan, 'pause'); return await body(); }
  catch (error) { await resumeImpl(plan); throw error; }
}
export async function startLiBootstrap(plan, { readConnection = connection, readHealth = health, recordObservation = writeBootstrapIdleObservation, pauseBoundary = withBootstrapPause, loadUpdater = () => import(pathToFileURL(path.join(plan.root, 'scripts/client-update.mjs'))), writeRecord = write, exists = fs.existsSync, now = Date.now, wait = pause, idleTimeoutMs = 24 * 60 * 60_000 } = {}) {
  const attemptFile = path.join(plan.jobDirectory, 'attempt.json');
  need(!exists(attemptFile), 'BOOTSTRAP_ALREADY_ATTEMPTED');
  const deadline = now() + idleTimeoutMs;
  while (now() < deadline) {
    readConnection(plan); const row = await readHealth(); need(source(row, plan), 'BOOTSTRAP_INSTANCE_CHANGED');
    recordObservation(plan, row, 'waiting_idle');
    if (idle(row) && row.connectionState === 'connected') break;
    await wait(5000);
  }
  let row = await readHealth(); need(source(row, plan) && idle(row), 'BOOTSTRAP_IDLE_TIMEOUT');
  recordObservation(plan, row, 'before_pause');
  return pauseBoundary(plan, async () => {
    const pausedDeadline = now() + 15_000;
    do { row = await readHealth(); need(source(row, plan), 'BOOTSTRAP_INSTANCE_CHANGED'); recordObservation(plan, row, 'paused_idle'); if (idle(row) && row.connectionState === 'draining') break; await wait(200); } while (now() < pausedDeadline);
    need(idle(row) && row.connectionState === 'draining', 'BOOTSTRAP_BUSY_AFTER_PAUSE');
    const updater = await loadUpdater();
    const packageFile = path.join(plan.jobDirectory, 'bootstrap-client.tgz');
    await updater.downloadVerifiedPackage({ url: plan.archiveUrl, sha256: plan.archiveSha256, destination: packageFile });
    // A brief pause can overlap outside arrivals. No stop is attempted without
    // a second exact-boot idle observation after the bounded pinned download.
    row = await readHealth(); need(source(row, plan) && idle(row) && row.connectionState === 'draining', 'BOOTSTRAP_BUSY_AFTER_PAUSE');
    recordObservation(plan, row, 'downloaded');
    writeRecord(attemptFile, { schemaVersion: 1, sourceBuild: plan.sourceBuild, targetBuild: plan.targetBuild, candidateCommit: plan.candidateCommit, archiveSha256: plan.archiveSha256, sourcePid: plan.sourcePid, at: new Date().toISOString() });
    const queued = await updater.launchClientUpdate({ codeRoot: plan.root, root: plan.root, env: normalizedLiBootstrapEnvironment(plan), args: { package: packageFile, sha256: plan.archiveSha256 } });
    writeRecord(path.join(plan.jobDirectory, 'owned-update.json'), { resultFile: queued.resultFile, workerPid: queued.workerPid, queuedAt: new Date().toISOString() });
    recordObservation(plan, row, 'updater_queued');
    // Exit this Node parent now; only then can the official worker start.
    return { state: 'queued', workerPid: queued.workerPid };
  });
}
async function observe(plan) {
  const own = read(path.join(plan.jobDirectory, 'owned-update.json'));
  need(samePath(path.win32.dirname(path.win32.dirname(own.resultFile)), path.win32.join(plan.userDirectory, 'maintenance')) && /^update-[a-f0-9-]{36}$/.test(path.win32.basename(path.win32.dirname(own.resultFile))) && path.win32.basename(own.resultFile) === 'result.json', 'BOOTSTRAP_RESULT_SCOPE_INVALID');
  const updater = await import(pathToFileURL(path.join(plan.root, 'scripts/client-update.mjs')));
  const result = await updater.readUpdateResult({ env: normalizedLiBootstrapEnvironment(plan), resultFile: own.resultFile });
  if (['failed', 'interrupted'].includes(result.state)) { await resumeOriginalBootstrap(plan); return { state: 'failed', code: 'BOOTSTRAP_OFFICIAL_UPDATE_FAILED', failureStage: result.failureStage || null, reasonCode: result.reasonCode || null }; }
  if (result.state === 'complete') {
    const row = await health(); need(sameClient(row, plan) && row.clientBuild === plan.targetBuild && row.pid !== plan.sourcePid, 'BOOTSTRAP_TARGET_NOT_READY');
    writeBootstrapIdleObservation(plan, row, 'target_ready');
    return { state: 'complete', code: 'BOOTSTRAP_TARGET_READY', clientBuild: row.clientBuild, pid: row.pid, bootstrapOnly: true, dedicatedRemoteProtocolVerified: false };
  }
  return { state: 'updating' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) try {
  const plan = read(path.resolve(process.argv[2])); validate(plan);
  need(['--start', '--observe'].includes(process.argv[3]), 'BOOTSTRAP_MODE_INVALID');
  const result = await (process.argv[3] === '--start' ? startLiBootstrap(plan) : observe(plan)); console.log(JSON.stringify(result)); process.exitCode = result.state === 'failed' ? 1 : 0;
} catch (error) { console.log(JSON.stringify({ state: 'failed', code: /^BOOTSTRAP_[A-Z0-9_]{1,64}$/.test(error?.code || '') ? error.code : 'BOOTSTRAP_FAILED', dedicatedRemoteProtocolVerified: false })); process.exitCode = 1; }
