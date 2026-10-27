import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

export const REMOTE_CLIENT_UPDATE_FEATURE = 'remote_client_update_v1';
export const REMOTE_CLIENT_UPDATE_SOURCE = 'https://qzelynth.top/downloads/cli/ziwei-latest.tgz';
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(value);
const states = new Set(['requested', 'accepted', 'waiting_idle', 'updating', 'awaiting_heartbeat', 'succeeded', 'complete', 'failed', 'canceled', 'cancelled']);
const completionProtocols = new Set(['native_worker_v1', 'legacy_heartbeat']);
const fail = code => Object.assign(new Error(code), { code });
export const remoteUpdateErrorCode = error => {
  const code = error?.code || '';
  if (/^CLIENT_UPDATE_[A-Z0-9_]{1,50}$/.test(code)) return code;
  return /^[A-Z][A-Z0-9_]{0,49}$/.test(code) ? 'CLIENT_UPDATE_' + code : 'CLIENT_UPDATE_FAILED';
};

function noLinks(file) {
  for (let current = path.resolve(file); ; current = path.dirname(current)) {
    try { if (fs.lstatSync(current).isSymbolicLink()) throw fail('CLIENT_UPDATE_UNSAFE_PATH'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (current === path.dirname(current)) break;
  }
}
export function writeRemoteUpdateJson(file, value) {
  noLinks(file); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + '.' + randomUUID() + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
  try { fs.renameSync(temporary, file); } finally { fs.rmSync(temporary, { force: true }); }
}
export function readRemoteUpdateJson(file) {
  noLinks(file); const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > 64 * 1024) throw fail('CLIENT_UPDATE_STATE_INVALID');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
/** Stable for this client installation's user data, shared by every workspace. */
export function remoteMaintenanceHostId(home) {
  const file = path.join(path.resolve(home), 'maintenance-host-id'); noLinks(file);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try { fs.writeFileSync(file, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const value = fs.readFileSync(file, 'utf8');
  if (!digest(value)) throw fail('CLIENT_UPDATE_HOST_INVALID');
  return value;
}
export function validateRemoteUpdateRequest(request, { workspace, deviceId, hostId } = {}) {
  if (!request || !identifier(request.id) || request.workspace !== workspace || request.deviceId !== deviceId || request.hostId !== hostId || !digest(request.targetBuild) || !digest(request.sha256) || request.source !== REMOTE_CLIENT_UPDATE_SOURCE || !states.has(request.state) || request.completionProtocol !== undefined && !completionProtocols.has(request.completionProtocol)) throw fail('CLIENT_UPDATE_REQUEST_INVALID');
  // Never retain or execute additional server-supplied commands, arguments or URLs.
  return { id: request.id, workspace, deviceId, hostId, targetBuild: request.targetBuild, sha256: request.sha256, source: REMOTE_CLIENT_UPDATE_SOURCE, state: request.state, ...(digest(request.currentBuild) ? { currentBuild: request.currentBuild } : {}), ...(request.completionProtocol ? { completionProtocol: request.completionProtocol } : {}) };
}
export function remoteUpdatePath(request, operation) {
  const query = `workspace=${encodeURIComponent(request.workspace)}&deviceId=${encodeURIComponent(request.deviceId)}`;
  return operation ? `/a2a/v1/device-updates/${encodeURIComponent(request.id)}/${operation}?${query}` : `/a2a/v1/device-updates?${query}`;
}
const sameTarget = (a, b) => ['id', 'workspace', 'deviceId', 'hostId', 'targetBuild', 'sha256', 'source'].every(key => a?.[key] === b?.[key]);
const terminal = state => ['succeeded', 'complete', 'failed', 'canceled', 'cancelled'].includes(state);
const permanentFailure = error => [401, 403, 404, 410].includes(error?.status || error?.httpStatus) || ['CLIENT_UPDATE_CONNECTION_MISSING', 'CLIENT_UPDATE_AUTHORIZATION_FAILED', 'CLIENT_UPDATE_AUTHORITY_REVOKED'].includes(error?.code);

/** No business executor participates in maintenance. A single daemon gate covers
 * every paired workspace. Disk state is a retry ledger, never a process lock. */
export function createRemoteClientUpdates({ home, hostId, clientBuild, enabled = false, connections, idle, prepareActions = async () => {}, hasPendingResumes = () => false, prepareIdle = async () => {}, request, launch, inspectWorker, recoverWorker = async () => null, clock = Date.now, pid = process.pid, log = () => {} } = {}) {
  const file = path.join(path.resolve(home), 'maintenance', 'remote-client-update.json');
  const outboxFile = path.join(path.resolve(home), 'maintenance', 'remote-client-update-reports.json');
  let current = null, ticking = false, outbox = [], installationSettled = false;
  if (enabled) {
    try { current = readRemoteUpdateJson(file); }
    catch (error) { if (error.code !== 'ENOENT') log('remote_update_state_unreadable', { code: 'CLIENT_UPDATE_STATE_INVALID' }); }
    try { const saved = readRemoteUpdateJson(outboxFile); if (Array.isArray(saved)) outbox = saved.filter(row => row?.request?.hostId === hostId && sameTarget(row.request, validateStored(row.request)) && typeof row.claimToken === 'string'); }
    catch (error) { if (error.code !== 'ENOENT') log('remote_update_reports_unreadable', { code: 'CLIENT_UPDATE_STATE_INVALID' }); }
  }
  if (current && (!current.request || current.request.hostId !== hostId || !sameTarget(current.request, validateStored(current.request)) || typeof current.claimToken !== 'string')) current = null;
  function validateStored(value) { try { return validateRemoteUpdateRequest(value, value); } catch { return null; } }
  const save = () => writeRemoteUpdateJson(file, current);
  const saveOutbox = () => writeRemoteUpdateJson(outboxFile, outbox);
  const archive = () => { if (current) writeRemoteUpdateJson(path.join(path.dirname(file), 'remote-client-update-history', current.request.id + '.json'), current); };
  const connectionFor = value => connections().find(row => row.workspace === value.workspace && row.deviceId === value.deviceId);
  const progressBody = (row, state) => ({ state, hostId, clientBuild: row.observedFailure ? clientBuild : digest(row.reportBuild) ? row.reportBuild : clientBuild, claimToken: row.claimToken, ...(row.worker?.workerPid ? { workerPid: row.worker.workerPid } : {}), ...(row.code ? { code: row.code } : {}), ...(state === 'failed' && row.rollbackEvidence ? { rollbackEvidence: row.rollbackEvidence } : {}), ...(state === 'failed' && row.observedFailure ? { observedFailure: row.observedFailure } : {}), ...(state === 'awaiting_heartbeat' && row.workerReceipt ? { workerReceipt: row.workerReceipt } : {}) });
  const report = async state => {
    const connection = connectionFor(current.request); if (!connection) throw fail('CLIENT_UPDATE_CONNECTION_MISSING');
    const response = await request(connection, remoteUpdatePath(current.request, 'progress'), progressBody(current, state));
    if (response?.request?.id !== current.request.id) throw fail('CLIENT_UPDATE_RESPONSE_INVALID');
    if (state === 'failed' && current.observedFailure && response.observedFailureRecorded === true) {
      current.reported = 'failed'; current.requiresReconciliation = response.requiresReconciliation === true; save(); return true;
    }
    // A former heartbeat success is not an acknowledgement of a later native
    // rollback. Preserve the local terminal fact and retry its exact receipt.
    if (state === 'failed' && response.request.state !== 'failed') throw fail('CLIENT_UPDATE_PROGRESS_CONFLICT');
    if (terminal(response.request.state)) {
      current.state = response.request.state;
      if (response.request.code) current.code = remoteUpdateErrorCode({ code: response.request.code });
      current.reported = current.state; save(); return false;
    }
    if (response.request.state !== state) throw fail('CLIENT_UPDATE_PROGRESS_CONFLICT');
    current.reported = state; save();
    return true;
  };
  const queueFailedReport = () => {
    const entry = { request: current.request, claimToken: current.claimToken, reportBuild: clientBuild, code: current.code, ...(current.worker ? { worker: current.worker } : {}), ...(current.rollbackEvidence ? { rollbackEvidence: current.rollbackEvidence } : {}), ...(current.observedFailure ? { observedFailure: current.observedFailure } : {}) };
    const previous = outbox.findIndex(row => row.request.id === entry.request.id);
    if (previous < 0) outbox.push(entry); else outbox[previous] = entry;
    saveOutbox();
  };
  const flushFailedReports = async () => {
    for (const entry of outbox.slice(0, 4)) {
      const connection = connectionFor(entry.request); if (!connection) continue;
      try {
        const result = await request(connection, remoteUpdatePath(entry.request, 'progress'), progressBody(entry, 'failed'));
        if (result?.request?.id === entry.request.id && (result.request.state === 'failed' || entry.observedFailure && result.observedFailureRecorded === true)) {
          if (current?.request.id === entry.request.id && current.state === 'failed') { current.reported = 'failed'; if (entry.observedFailure) current.requiresReconciliation = result.requiresReconciliation === true; save(); }
          outbox = outbox.filter(row => row.request.id !== entry.request.id); saveOutbox();
        }
      } catch (error) { log('remote_update_failed_report_pending', { code: remoteUpdateErrorCode(error) }); }
    }
  };
  const finish = async (state, code) => {
    current.state = state; current.code = code || undefined; current.updatedAt = clock(); save();
    if (state === 'failed') { try { await report('failed'); } catch { queueFailedReport(); } }
  };
  const lockAbsent = () => {
    const lock = path.join(path.dirname(file), 'operation.lock');
    try { noLinks(lock); return !fs.existsSync(lock); } catch { return false; }
  };
  const inspect = () => inspectWorker(current.worker, { request: current.request, claimToken: current.claimToken, sourceBuild: current.sourceBuild, pid });
  const verifiedReceipt = (value, state, legacy = false) => {
    if (!value || value.schemaVersion !== 1 || value.operation !== 'update' || value.state !== state || !digest(current.sourceBuild)) return false;
    if (legacy && (state !== 'complete' || current.request.completionProtocol !== 'legacy_heartbeat')) return false;
    const binding = { requestId: current.request.id, hostId, deviceId: current.request.deviceId, sourceBuild: current.sourceBuild, targetBuild: current.request.targetBuild, sha256: current.request.sha256 };
    const allowed = ['schemaVersion', 'operation', 'state', 'binding', 'supervisorPid', 'workerPid', 'daemonPid', 'installedBuild', ...(!legacy ? ['configSha256'] : []), 'terminalSha256', 'workerIdentitySha256', 'finishedAt', 'workerExited', 'maintenanceLockAbsent', 'configurationPreserved', 'nativeStartupVerified', ...(state === 'complete' ? ['restoredRunning'] : ['originalInstallationRestored', 'runningStateRestored'])];
    if (Object.keys(value).some(key => !allowed.includes(key)) || Object.keys(value.binding || {}).some(key => !Object.hasOwn(binding, key)) || Object.keys(binding).some(key => value.binding?.[key] !== binding[key])) return false;
    if (value.supervisorPid !== current.worker?.workerPid || !Number.isSafeInteger(value.workerPid) || value.workerPid < 1 || value.daemonPid !== pid || value.installedBuild !== clientBuild || value.installedBuild !== (state === 'complete' ? current.request.targetBuild : current.sourceBuild)) return false;
    if (![...(!legacy ? ['configSha256'] : []), 'terminalSha256', 'workerIdentitySha256'].every(key => digest(value[key])) || !Number.isFinite(Date.parse(value.finishedAt))) return false;
    if (!['workerExited', 'maintenanceLockAbsent', 'configurationPreserved', 'nativeStartupVerified'].every(key => value[key] === true)) return false;
    return state === 'complete' ? value.restoredRunning === true : value.originalInstallationRestored === true && value.runningStateRestored === true;
  };
  const verifiedHistoricalFailure = value => {
    if (!value || value.schemaVersion !== 1 || value.operation !== 'update' || value.state !== 'failed' || !digest(current.sourceBuild)) return false;
    const binding = { requestId: current.request.id, hostId, deviceId: current.request.deviceId, sourceBuild: current.sourceBuild, targetBuild: current.request.targetBuild, sha256: current.request.sha256 };
    if (Object.keys(binding).some(key => value[key] !== binding[key])) return false;
    const allowed = ['schemaVersion', 'operation', 'state', ...Object.keys(binding), 'supervisorPid', 'workerPid', 'workerIdentitySha256', 'terminalSha256', 'finishedAt', 'workerExited', 'maintenanceLockAbsent', 'originalInstallationRestored', 'runningStateRestored', 'reasonCode', 'failureStage', 'exitCode'];
    if (Object.keys(value).some(key => !allowed.includes(key)) || value.supervisorPid !== current.worker?.workerPid || !Number.isSafeInteger(value.workerPid) || value.workerPid < 1 || !digest(value.workerIdentitySha256) || !digest(value.terminalSha256) || !Number.isFinite(Date.parse(value.finishedAt))) return false;
    if (value.reasonCode !== undefined && !/^[A-Z][A-Z0-9_]{0,63}$/.test(value.reasonCode) || value.failureStage !== undefined && !/^[a-z][a-z0-9_]{0,63}$/.test(value.failureStage) || value.exitCode !== undefined && !Number.isSafeInteger(value.exitCode)) return false;
    return ['workerExited', 'maintenanceLockAbsent', 'originalInstallationRestored', 'runningStateRestored'].every(key => value[key] === true);
  };
  const bindSourceBuild = async () => {
    if (!digest(current.sourceBuild) && digest(current.request.currentBuild)) { current.sourceBuild = current.request.currentBuild; save(); }
    if (digest(current.sourceBuild) && completionProtocols.has(current.request.completionProtocol)) return;
    const connection = connectionFor(current.request); if (!connection) return;
    const remote = (await request(connection, remoteUpdatePath(current.request)))?.request;
    if (!remote || !sameTarget(current.request, validateRemoteUpdateRequest(remote, { ...connection, hostId }))) return;
    if (current.request.completionProtocol && remote.completionProtocol && current.request.completionProtocol !== remote.completionProtocol) throw fail('CLIENT_UPDATE_TARGET_CHANGED');
    if (!digest(current.sourceBuild) && digest(remote.currentBuild)) current.sourceBuild = remote.currentBuild;
    if (!current.request.completionProtocol && completionProtocols.has(remote.completionProtocol)) current.request = { ...current.request, completionProtocol: remote.completionProtocol };
    save();
  };
  const observeInstallation = async () => {
    if (!current || current.stage !== 'worker_launch' || !['updating', 'awaiting_heartbeat', 'succeeded', 'complete'].includes(current.state)) return;
    await bindSourceBuild();
    if (!current.worker) { current.worker = await recoverWorker(current.request, current.claimToken); save(); }
    if (!current.worker) return;
    const observation = await inspect();
    if (observation.state === 'failed' && (verifiedReceipt(observation.rollbackEvidence, 'failed') || verifiedHistoricalFailure(observation.observedFailure)) && lockAbsent()) {
      if (['succeeded', 'complete'].includes(current.state)) current.previousServerState = current.state;
      if (verifiedReceipt(observation.rollbackEvidence, 'failed')) current.rollbackEvidence = observation.rollbackEvidence;
      if (verifiedHistoricalFailure(observation.observedFailure)) { current.observedFailure = observation.observedFailure; current.requiresReconciliation = true; }
      installationSettled = true;
      await finish('failed', observation.code || 'CLIENT_UPDATE_FAILED'); archive();
    } else if (observation.state === 'complete' && verifiedReceipt(observation.workerReceipt, 'complete') && lockAbsent()) {
      current.workerReceipt = observation.workerReceipt; save();
      if (current.workerReceiptReported !== current.workerReceipt.terminalSha256) {
        await report('awaiting_heartbeat');
        current.workerReceiptReported = current.workerReceipt.terminalSha256; save();
      }
      installationSettled = current.state === 'succeeded' || current.state === 'complete';
      if (installationSettled) archive();
    } else if (observation.state === 'complete' && verifiedReceipt(observation.legacyCompletion, 'complete', true) && lockAbsent()) {
      // This request was created under the old heartbeat protocol. Its native
      // terminal proof is local readiness evidence, never a full worker receipt.
      current.legacyCompletion = observation.legacyCompletion; save();
      installationSettled = current.state === 'succeeded' || current.state === 'complete';
      if (installationSettled) archive();
    }
  };
  return {
    get blocksNewActions() { return enabled && (['accepted', 'waiting_idle', 'updating','awaiting_heartbeat'].includes(current?.state)||['succeeded', 'complete'].includes(current?.state)&&current.stage==='worker_launch'&&!installationSettled); },
    status() { return current ? { id: current.request.id, state: current.state, targetBuild: current.request.targetBuild, ...(current.code ? { code: current.code } : {}) } : null; },
    checkpointAuthority(receipt) {
      if (!enabled || !current || current.request.id !== receipt?.updateId || current.request.targetBuild !== receipt?.targetBuild) return null;
      return { updateId: current.request.id, claimToken: current.claimToken };
    },
    async maintenanceResumeReadiness(receipt) {
      if (!enabled || !current || current.request.id !== receipt?.updateId || current.request.targetBuild !== receipt?.targetBuild) return { ready: false };
      // A verified new daemon can heartbeat before the package worker releases
      // its installation lease. Neither a heartbeat nor a result file alone
      // permits business execution in that window.
      if (!lockAbsent()) return { ready: false };
      if (['succeeded', 'complete'].includes(current.state) && current.request.targetBuild === clientBuild) {
        if (!current.worker) current.worker = await recoverWorker(current.request, current.claimToken);
        if (!current.worker) return { ready: false };
        const result = await inspect();
        if (result.state !== 'complete' || !(verifiedReceipt(result.workerReceipt, 'complete') || verifiedReceipt(result.legacyCompletion, 'complete', true))) return { ready: false };
        return { ready: true };
      }
      // A cancelled queued upgrade did not replace this still-running daemon.
      // An ambiguous spawn window or a failed rollback is not this case.
      if (['cancelled', 'canceled', 'failed'].includes(current.state) && !current.worker && !['worker_launch'].includes(current.stage)) {
        return { ready: true, sourceIdle: { workerAbsent: true, maintenanceLockAbsent: true, installedBuild: clientBuild, pid } };
      }
      if(current.state==='failed'&&current.worker){
        const result=await inspect();
        if(result.state==='failed'&&result.originalInstallationRestored===true)return {
          ready:true,sourceIdle:{workerTerminal:true,originalInstallationRestored:true,maintenanceLockAbsent:true,installedBuild:clientBuild,pid},
        };
        if(result.state==='failed')return{ready:true,maintenanceFailure:{workerTerminal:true,maintenanceLockAbsent:true,installedBuild:clientBuild,pid}};
      }
      return { ready: false };
    },
    async tick() {
      if (!enabled || ticking) return; ticking = true;
      try {
        await flushFailedReports();
        await observeInstallation();
        if(['succeeded', 'complete'].includes(current?.state)&&current.stage==='worker_launch'&&!installationSettled){
          installationSettled=(await this.maintenanceResumeReadiness({updateId:current.request.id,targetBuild:current.request.targetBuild})).ready===true;
          if(!installationSettled)return;
        }
        // The accepted update is also the immutable authority for its paused
        // actions. Do not overwrite it with a newer request before they resume.
        if(current&&terminal(current.state)&&hasPendingResumes(current.request))return;
        if (current && current.request.targetBuild === clientBuild && ['accepted', 'waiting_idle', 'updating', 'awaiting_heartbeat'].includes(current.state)) {
          // Startup is provisional until the worker's terminal receipt and a
          // matching fresh target-build heartbeat both reach the server.
          current.state = 'awaiting_heartbeat'; save();
          if (current.reported !== current.state && !await report(current.state)) return;
        }
        if (current?.state === 'updating') {
          if (!current.worker) { current.worker = await recoverWorker(current.request, current.claimToken); save(); }
          const observation = await inspect();
          if (observation.state === 'failed' || observation.state === 'interrupted') await finish('failed', observation.code || 'CLIENT_UPDATE_INTERRUPTED');
          // A worker's claimed success cannot replace a new daemon heartbeat.
          else if (observation.state === 'complete' && verifiedReceipt(observation.workerReceipt, 'complete') && lockAbsent()) { current.workerReceipt = observation.workerReceipt; current.state = 'awaiting_heartbeat'; save(); await report(current.state); }
          return;
        }
        let remote, connection;
        if (current && ['accepted', 'waiting_idle', 'awaiting_heartbeat'].includes(current.state)) {
          connection = connectionFor(current.request);
          if (!connection) { await finish('failed', 'CLIENT_UPDATE_CONNECTION_MISSING'); return; }
          const payload = await request(connection, remoteUpdatePath(current.request)); remote = payload.request;
          if (!remote) return; // A network/visibility gap must never release an accepted job.
        } else {
          for (const candidate of connections()) {
            try {
              const payload = await request(candidate, remoteUpdatePath(candidate));
              if (payload.request && !terminal(payload.request.state) && !(current?.state === 'failed' && payload.request.id === current.request.id)) { remote = payload.request; connection = candidate; break; }
            } catch (error) { log('remote_update_connection_retry', { code: remoteUpdateErrorCode(error) }); }
          }
          if (!remote) return;
        }
        remote = validateRemoteUpdateRequest(remote, { ...connection, hostId });
        if (current?.request.id === remote.id && !sameTarget(current.request, remote)) throw fail('CLIENT_UPDATE_TARGET_CHANGED');
        if (current?.request.id === remote.id && current.request.completionProtocol && remote.completionProtocol && current.request.completionProtocol !== remote.completionProtocol) throw fail('CLIENT_UPDATE_TARGET_CHANGED');
        if (['succeeded', 'complete', 'failed', 'canceled', 'cancelled'].includes(remote.state)) {
          if (current?.request.id === remote.id) { current.state = remote.state; save(); }
          return;
        }
        if (current?.request.id === remote.id && ['failed', 'awaiting_heartbeat'].includes(current.state)) {
          if (current.reported !== current.state) await report(current.state);
          return;
        }
        if (!current || current.request.id !== remote.id) {
          const claim = await request(connection, remoteUpdatePath(remote, 'claim'), { hostId, clientBuild, pid });
          const claimed = validateRemoteUpdateRequest(claim.request, { ...connection, hostId });
          if (!sameTarget(remote, claimed) || remote.completionProtocol && claimed.completionProtocol !== remote.completionProtocol || typeof claim.claimToken !== 'string' || claim.claimToken.length < 16 || claim.claimToken.length > 512) throw fail('CLIENT_UPDATE_CLAIM_INVALID');
          archive(); installationSettled = false;
          current = { schemaVersion: 1, request: claimed, claimToken: claim.claimToken, sourceBuild: digest(claimed.currentBuild) ? claimed.currentBuild : clientBuild, state: 'accepted', acceptedAt: clock(), updatedAt: clock() }; save();
          if (['updating', 'awaiting_heartbeat'].includes(remote.state)) {
            current.state = 'updating'; current.worker = await recoverWorker(current.request, current.claimToken); save();
            if (!current.worker) await finish('failed', 'CLIENT_UPDATE_LOCAL_STATE_MISSING');
            return;
          }
          if (!await report('accepted')) return;
        }
        current.state = 'waiting_idle'; current.updatedAt = clock(); save();
        if (current.reported !== current.state && !await report(current.state)) return;
        // Cooperative maintenance is separate from cancellation: a runtime
        // acknowledges only after its whole current tool batch is persisted.
        await prepareActions(current.request);
        if (!idle()) return;
        current.state = 'updating'; current.stage = 'before_worker'; current.updatedAt = clock(); save();
        if (!await report('updating')) return;
        // Reporting is asynchronous. A Gateway event or valid collaboration
        // child may have entered meanwhile; never close it based on old idle.
        if (!idle()) { await finish('failed', 'CLIENT_UPDATE_BUSY_AT_DRAIN'); return; }
        try { await prepareIdle(); current.stage = 'worker_launch'; save(); current.worker = await launch({ request: current.request, claimToken: current.claimToken, sourceBuild: current.sourceBuild }); save(); }
        catch (error) { await finish('failed', remoteUpdateErrorCode(error)); }
      } catch (error) {
        if (current && (['accepted', 'waiting_idle'].includes(current.state) || current.state === 'updating' && current.stage === 'before_worker') && permanentFailure(error)) await finish('failed', remoteUpdateErrorCode(error));
        // Retry transport failures without starting another worker or losing the gate.
        log('remote_update_retry', { code: remoteUpdateErrorCode(error) });
      } finally { ticking = false; }
    },
  };
}
