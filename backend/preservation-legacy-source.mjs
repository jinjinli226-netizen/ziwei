import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {verifyLegacyArchive} from './preservation-legacy-archive.mjs';
import {nativeActionDigest} from './preservation-native-databases.mjs';
import {digest, uncertain, exitedTree, executionExit} from './version-preservation.mjs';

const capabilities = new WeakSet();
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const equal = (a, b) => digest(a) === digest(b);
const fail = () => {throw Object.assign(new Error('Approved legacy source relationships are unproven'), {code: 'LEGACY_SOURCE_UNPROVEN'});};
const require = condition => {if (!condition) fail();};
const apiFor = value => /^[a-z]:[\\/]/i.test(value) ? path.win32 : path.posix;
const plainPath = value => typeof value === 'string' && !value.startsWith('\\\\') && apiFor(value).isAbsolute(value) && apiFor(value).normalize(value) === value;
const samePath = (a, b) => typeof a === 'string' && typeof b === 'string' && (apiFor(a) === path.win32 ? a.toLowerCase() === b.toLowerCase() : a === b);
const finalPath = value => typeof value === 'string' ? value.replace(/^\\\\\?\\/, '') : value;
const parse = bytes => {try {return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));} catch {fail();}};
const timestamp = value => {const microsoft = typeof value === 'string' && /^\/Date\((\d+)\)\/$/.exec(value); return microsoft ? Number(microsoft[1]) : Date.parse(value);};
function freeze(value) {if (value && typeof value === 'object') {Object.values(value).forEach(freeze); Object.freeze(value);} return value;}
function unknown(value) {
  if (!value || typeof value !== 'object') return false;
  if (uncertain(value) || value.retainEvidence === true || ['executionState', 'execution_state'].some(key => ['pending', 'running', 'started', 'unknown', 'uncertain', 'blocked', 'unconfirmed'].includes(value[key])) || Object.hasOwn(value, 'processExit') && !exitedTree(value.processExit)) return true;
  return Object.values(value).some(item => Array.isArray(item) ? item.some(unknown) : unknown(item));
}
function validateState(state, scope) {
  require(state && [1, 2].includes(state.version) && Array.isArray(state.completed) && (state.version === 1 ? Object.keys(state).every(key => ['version', 'updatedAt', 'completed'].includes(key)) : Array.isArray(state.started)));
  const keys = new Set(), ids = new Set();
  for (const row of state.completed) {
    require(row && typeof row.key === 'string' && row.key && !keys.has(row.key) && typeof row.result?.actionId === 'string' && row.result.actionId && !ids.has(row.result.actionId) && ['succeeded', 'failed'].includes(row.result.status) && !unknown(row) && (!row.result.result?.nativeOperation?.data?.residentWorker || exitedTree(executionExit(row.result))));
    keys.add(row.key); ids.add(row.result.actionId);
    if (state.version === 1 || row.legacy === true) require(Object.keys(row).every(key => ['key', 'result', ...(state.version === 2 ? ['legacy'] : [])].includes(key)) && Number.isFinite(row.result.completedAt));
    else require(row.identity && row.identity.workspace === scope.workspace && row.identity.deviceId === scope.deviceId && state.started.some(start => start.key === row.key && start.actionId === row.result.actionId && equal(start.identity, row.identity)));
  }
  const startedKeys = new Set();
  for (const start of state.started || []) {
    require(start && typeof start.key === 'string' && start.key && !startedKeys.has(start.key) && start.identity && Object.values(start.identity).every(value=>typeof value==='string') && start.identity.workspace === scope.workspace && start.identity.deviceId === scope.deviceId && Number.isFinite(start.startedAt) && (start.nativeRuntime===undefined||typeof start.nativeRuntime==='boolean') && (start.quarantine===undefined||start.quarantine?.stopConfirmed===true) && state.completed.some(row => row.key === start.key && row.result.actionId === start.actionId && equal(row.identity, start.identity)));
    startedKeys.add(start.key);
  }
}
function readLocal(file) {
  const stat = fs.lstatSync(file);
  require(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 8 * 1024 * 1024 && samePath(fs.realpathSync.native(file), file));
  const bytes = fs.readFileSync(file);
  const after = fs.lstatSync(file); require(stat.dev === after.dev && stat.ino === after.ino && stat.size === after.size && stat.mtimeMs === after.mtimeMs);
  return {bytes, identity: {dev: String(stat.dev), ino: String(stat.ino)}};
}

/** Constructed only by independently approved source code. Neither a signed
 * request nor an assessment JSON can select this capability or a reader. */
export function createLegacySourceInterpreter({authorization, requestBinding, readBytes = readLocal} = {}) {
  require(typeof readBytes === 'function' && readBytes.constructor?.name !== 'AsyncFunction');
  const policy = freeze(structuredClone(authorization));
  const expectedRequest=freeze(structuredClone(requestBinding));
  require(expectedRequest&&typeof expectedRequest.operationId==='string'&&expectedRequest.operationId&&hex(expectedRequest.specHash)&&hex(expectedRequest.freezeDigest)&&typeof expectedRequest.challenge==='string'&&expectedRequest.challenge.length>=16);
  require(policy?.schemaVersion === 1 && policy.kind === 'ziwei-approved-legacy-source-v1' && typeof policy.hostId === 'string' && policy.hostId && typeof policy.workspace === 'string' && policy.workspace && typeof policy.workspaceId === 'string' && policy.workspaceId && typeof policy.deviceId === 'string' && policy.deviceId && new URL(policy.origin).origin === policy.origin);
  const generation = policy.generation, subject = policy.subject, historical = policy.historicalCache;
  require(generation && Number.isInteger(generation.pid) && generation.pid > 0 && Number.isFinite(timestamp(generation.createdAt)) && generation.workspace === policy.workspace && generation.deviceId === policy.deviceId && hex(generation.installedBuild) && hex(generation.configSha256) && hex(generation.commandSha256));
  for (const field of ['root', 'executable', 'configPath', 'runtimeDir', 'logDir']) require(plainPath(generation[field]));
  const nativePaths=apiFor(generation.runtimeDir);
  require(nativePaths.basename(generation.runtimeDir)==='runtime'&&nativePaths.basename(generation.logDir)==='logs'&&samePath(nativePaths.dirname(generation.runtimeDir),nativePaths.dirname(generation.logDir)));
  require(subject && typeof subject.actionId === 'string' && subject.actionId && ['actionDigest', 'payloadSha256', 'resultSha256', 'dedupeKeySha256', 'failureErrorSha256'].every(key => hex(subject[key])) && subject.resultSha256 === hash('') && subject.fields?.workspace_id === policy.workspaceId && subject.fields.status === 'expired' && ['acked_at', 'completed_at', 'created_at'].every(key => Number.isFinite(timestamp(subject.fields[key]))));
  require(historical && Number.isSafeInteger(historical.completedCount) && historical.completedCount > 0 && Number.isSafeInteger(historical.bytes) && historical.bytes > 0 && hex(historical.sha256) && Number.isFinite(timestamp(historical.updatedAt)));
  const roles = ['archive', 'context', 'inspect', 'snapshot', 'cache', 'loggerStart', 'loggerEnd'];
  require(policy.artifacts && equal(Object.keys(policy.artifacts).sort(), [...roles].sort()));
  const paths = new Set();
  for (const role of roles) {const file = policy.artifacts[role]; require(file && plainPath(file.path) && plainPath(file.sourcePath) && !paths.has(file.path.toLowerCase()) && hex(file.sha256) && Number.isSafeInteger(file.bytes) && file.bytes > 0 && file.bytes <= 8 * 1024 * 1024); paths.add(file.path.toLowerCase());}
  require(policy.archivePolicy?.expectedSha256 === policy.artifacts.archive.sha256 && policy.archivePolicy.expectedBytes === policy.artifacts.archive.bytes && policy.archivePolicy.expectedInstalledBuild === generation.installedBuild);
  const authorizationDigest = digest(policy);

  function approvedRead(file) {
    const read = readBytes(file.path); require(read && !read.then && Buffer.isBuffer(read.bytes) && read.bytes.length === file.bytes && hash(read.bytes) === file.sha256 && read.identity && typeof read.identity.dev === 'string' && typeof read.identity.ino === 'string');
    if (read.nativeFinalPath !== undefined) require(samePath(finalPath(read.nativeFinalPath), file.path));
    return {bytes: read.bytes, record: {path: file.path, exists: true, sha256: file.sha256, bytes: file.bytes, identity: read.identity}};
  }
  function inspect({productionRequest: request, connection, state}, historicalOnly=false) {
    // A live configuration hash is checked independently of the old capture.
    // Its exact size is read through the same approved local reader.
    let configRead,configDescriptor;
    const requestScope = historicalOnly?{}:(() => {
      require(request?.schemaVersion === 1 && request.domain === 'ziwei-production-request-v1' && ['collect', 'recheck'].includes(request.kind) && typeof request.operationId === 'string' && request.operationId && hex(request.specHash) && hex(request.freezeDigest) && typeof request.challenge === 'string' && request.challenge.length >= 16 && request.binding?.hostId === policy.hostId);
      require(Object.entries(expectedRequest).every(([key,value])=>request[key]===value));
      require(connection?.workspace === policy.workspace && connection.deviceId === policy.deviceId && samePath(connection.runtimeDir, generation.runtimeDir) && new URL(connection.apiBase).origin === policy.origin && request.targetOrigins?.includes(policy.origin) && request.binding.workspaceIds?.includes(policy.workspaceId) && request.binding.deviceIds?.includes(policy.deviceId));
      require(request.actionProjection?.tables?.workspaces?.rows?.filter(row => row.id === policy.workspaceId && row.slug === policy.workspace).length === 1);
      const clients = request.binding.clients?.filter(client => typeof client.runtimeDir === 'string' && (samePath(client.runtimeDir, connection.runtimeDir) || samePath(apiFor(client.runtimeDir).join(client.runtimeDir, 'shared-workspaces', connection.workspace, connection.deviceId), connection.runtimeDir)));
      require(clients?.length === 1); const client = clients[0]; require(samePath(client.configPath, generation.configPath) && client.configSha256 === generation.configSha256 && ['v1', 'v2'].includes(client.installedRole) && client.originalInstance);
      return {client};
    })();
    if(!historicalOnly){
      configRead=readBytes(generation.configPath);require(configRead&&!configRead.then&&Buffer.isBuffer(configRead.bytes)&&hash(configRead.bytes)===generation.configSha256&&configRead.identity&&typeof configRead.identity.dev==='string'&&typeof configRead.identity.ino==='string');
      if(configRead.nativeFinalPath!==undefined)require(samePath(finalPath(configRead.nativeFinalPath),generation.configPath));
      configDescriptor={path:generation.configPath,bytes:configRead.bytes.length,sha256:generation.configSha256};
      const config=parse(configRead.bytes),entries=[config,...(config.sharedWorkspaces||[]).filter(row=>row.enabled!==false)];
      require(entries.filter(row=>row.workspace===policy.workspace&&row.deviceId===policy.deviceId&&new URL(row.apiBase||config.apiBase).origin===policy.origin).length===1);
      validateState(state,policy);
    }
    const raw = {}, files = historicalOnly?[]:[{...configDescriptor, exists: true, identity: configRead.identity}];
    for (const role of roles) {const read = approvedRead(policy.artifacts[role]); raw[role] = read.bytes; files.push(read.record);}
    const archive = verifyLegacyArchive(raw.archive, policy.archivePolicy), snapshot = parse(raw.snapshot), captured = parse(raw.inspect), context = parse(raw.context), retained = parse(raw.cache);
    validateState(retained, policy);
    if(historicalOnly)state=retained;
    require(retained.completed.length >= historical.completedCount && state.completed.length >= historical.completedCount);
    const historicalRows = retained.completed.slice(0, historical.completedCount).map(({key, result}) => ({key, result}));
    const historicalBytes = Buffer.from(JSON.stringify({version: 1, updatedAt: historical.updatedAt, completed: historicalRows}));
    require(historicalBytes.length === historical.bytes && hash(historicalBytes) === historical.sha256 && equal(state.completed.slice(0, historical.completedCount).map(({key, result}) => ({key, result})), historicalRows));
    const expectedCachePath = apiFor(generation.runtimeDir).join(generation.runtimeDir, 'action-state.json');
    require(samePath(policy.artifacts.cache.sourcePath, expectedCachePath));
    const snapshotState = snapshot.actionStates?.filter(row => samePath(row.path, expectedCachePath) && samePath(finalPath(row.finalPath), expectedCachePath));
    require(snapshotState?.length === 1 && snapshotState[0].sha256 === historical.sha256 && snapshotState[0].bytes === historical.bytes);
    require(snapshot.installedBuild === generation.installedBuild && snapshot.health?.clientBuild === generation.installedBuild && snapshot.health.pid === generation.pid && snapshot.nativeProcess?.pid === generation.pid && timestamp(snapshot.nativeProcess.creationDate) === timestamp(generation.createdAt) && samePath(snapshot.nativeProcess.executable, generation.executable) && snapshot.nativeProcess.commandSha256 === generation.commandSha256);
    require(snapshot.health.workspace === policy.workspace && snapshot.health.deviceId === policy.deviceId && samePath(snapshot.health.lifecycle?.root, generation.root) && samePath(snapshot.health.lifecycle.configPath, generation.configPath) && snapshot.health.lifecycle.configSha256 === generation.configSha256 && Math.abs(timestamp(snapshot.health.lifecycle.startedAt) - timestamp(generation.createdAt)) < 15000);
    for (const cfg of [snapshot.config, captured.config]) require(cfg && samePath(finalPath(cfg.finalPath), generation.configPath) && cfg.workspace === policy.workspace && cfg.deviceId === policy.deviceId && new URL(cfg.apiBase).origin === policy.origin);
    require(samePath(snapshot.config.path, generation.configPath) && snapshot.config.sha256 === generation.configSha256 && Array.isArray(snapshot.config.sharedBindings) && snapshot.config.sharedBindings.length === 0);
    require(captured.actionStates?.filter(row => samePath(row.path, expectedCachePath) && samePath(finalPath(row.finalPath), expectedCachePath)).length === 1);
    const capturedRotation=captured.logs?.filter(row=>samePath(row.path,policy.artifacts.loggerStart.sourcePath)&&samePath(finalPath(row.finalPath),row.path));
    const activeLogPath=apiFor(generation.logDir).join(generation.logDir,'daemon.log'),capturedActive=captured.logs?.filter(row=>samePath(row.path,activeLogPath)&&samePath(finalPath(row.finalPath),activeLogPath));
    require(capturedRotation?.length===1&&capturedRotation[0].bytes===raw.loggerStart.length&&capturedActive?.length===1&&Number.isSafeInteger(capturedActive[0].bytes)&&capturedActive[0].bytes>0&&capturedActive[0].bytes<raw.loggerEnd.length);
    const activePrefix=raw.loggerEnd.subarray(0,capturedActive[0].bytes);require(activePrefix.at(-1)===10);
    const activeRows=new TextDecoder('utf-8',{fatal:true}).decode(activePrefix).split(/\r?\n/).filter(Boolean).map(line=>parse(Buffer.from(line)));
    require(activeRows.at(-1)?.at===capturedActive[0].lastAt);
    const rows = [], ranges = [];
    for (const role of ['loggerStart', 'loggerEnd']) {
      const file = policy.artifacts[role]; require(samePath(apiFor(file.sourcePath).dirname(file.sourcePath), generation.logDir) && /^daemon\.log\.\d+$/.test(apiFor(file.sourcePath).basename(file.sourcePath)));
      const lines = new TextDecoder('utf-8', {fatal: true}).decode(raw[role]).split(/\r?\n/).filter(Boolean), records = lines.map(line => parse(Buffer.from(line)));
      require(records.length > 0 && records.every(row => row && Number.isInteger(row.pid) && row.pid > 0 && typeof row.event === 'string' && row.event && Number.isFinite(timestamp(row.at))));
      // Preserve append order. The reviewed logger spreads native event fields
      // after its timestamp, so progress events can retain an earlier `at`.
      // Their timestamps cannot reorder mandatory start/exit records.
      ranges.push({first: timestamp(records[0].at), last: timestamp(records.at(-1).at)}); rows.push(...records);
    }
    require(ranges[1].first >= ranges[0].last && ranges[1].first - ranges[0].last <= 1000);
    const boot = rows.filter(row => row.pid === generation.pid), starts = boot.filter(row => row.event === 'started'), exits = boot.filter(row => row.event === 'exited');
    require(boot.every(row => row.workspace === undefined || row.workspace === policy.workspace) && starts.length === 1 && exits.length === 1 && boot.indexOf(starts[0])===0 && boot.indexOf(exits[0])===boot.length-1 && Math.abs(timestamp(starts[0].at) - timestamp(generation.createdAt)) < 15000 && timestamp(exits[0].at) > timestamp(starts[0].at) && boot.every(row => timestamp(row.at) >= timestamp(starts[0].at) && timestamp(row.at) <= timestamp(exits[0].at)));
    require([snapshot.captureUTC, captured.captureUTC, context.captureUTC].every(value => timestamp(value) > timestamp(subject.fields.acked_at) && timestamp(value) < timestamp(exits[0].at)));
    const loggerDigest = digest(['loggerStart', 'loggerEnd'].map(role => ({path: policy.artifacts[role].sourcePath, sha256: hash(raw[role]), bytes: raw[role].length})));
    const recordDigests = historicalRows.map(row => digest(row));
    return {client: requestScope.client, workspaceId: policy.workspaceId, policyDigest: archive.policyDigest, sourceDigest: digest({archive: archive.archiveSha256, build: archive.installedBuild, authorizationDigest}), authorizationDigest, historicalGenerationDigest: digest(generation), cacheDigest: historical.sha256, loggerDigest, artifactDigest: digest(files), recordDigests, files, boot, targetRecords:rows.filter(row=>row.actionId===subject.actionId), context, retained};
  }
  const capability = Object.freeze({
    subjectActionId: subject.actionId,
    auditHistoricalSource() {const {policyDigest,sourceDigest,historicalGenerationDigest,cacheDigest,loggerDigest,recordDigests,files}=inspect({},true);return freeze({scope:'historical-source-only',policyDigest,sourceDigest,historicalGenerationDigest,cacheDigest,loggerDigest,recordCount:recordDigests.length,files,currentConfigVerified:false,namespaceComplete:null});},
    connectionProof(input) {const {boot, targetRecords, context, retained, ...evidence} = inspect(input); return freeze(evidence);},
    neverDispatchedProof(input) {
      const evidence = inspect(input), {action, state, productionRequest: request} = input;
      require(action?.id === subject.actionId && nativeActionDigest(action) === subject.actionDigest && typeof action.payload_json === 'string' && hash(action.payload_json) === subject.payloadSha256 && action.result_json === '' && hash(action.result_json) === subject.resultSha256 && typeof action.dedupe_key === 'string' && hash(action.dedupe_key) === subject.dedupeKeySha256 && Object.entries(subject.fields).every(([key, value]) => equal(action[key], value)));
      const projected = request.actionProjection.tables.a2a_actions.rows.filter(row => row.id === action.id); require(projected.length === 1 && nativeActionDigest(projected[0]) === subject.actionDigest);
      const payload = parse(Buffer.from(action.payload_json)), devices = ['deviceId', 'device_id', 'targetDeviceId', 'target_device_id'].map(key => payload[key]).filter(value => value !== undefined && value !== null && value !== '');
      if (!devices.length) {const employee = request.actionProjection.tables.employees?.rows?.filter(row => row.id === (payload.employeeId || payload.employee_id || payload.assignee) && row.workspace_id === policy.workspaceId); require(employee?.length === 1); devices.push(employee[0].target_device_id);}
      require(devices.every(value => value === policy.deviceId));
      for (const cache of [state, evidence.retained]) require(!cache.completed.some(row => row.key === action.dedupe_key || row.result.actionId === action.id) && !(cache.started || []).some(row => row.key === action.dedupe_key || row.actionId === action.id));
      const target = evidence.targetRecords; require(target.length === 1 && target[0].pid===generation.pid && target[0].event === 'a2a_action_failed' && target[0].workspace === policy.workspace && hash(target[0].error || '') === subject.failureErrorSha256 && timestamp(target[0].at) > timestamp(action.acked_at) && timestamp(target[0].at) < timestamp(action.completed_at));
      require(evidence.context.sameActionRecords?.length === 1 && Object.entries(evidence.context.sameActionRecords[0]).every(([key, value]) => equal(target[0][key], value)));
      for (const record of evidence.context.nearbyRecords || []) require(evidence.boot.some(row => Object.entries(record).every(([key, value]) => equal(row[key], value))));
      require(evidence.boot.some(row => row.event === 'a2a_poll' && row.pending === 1 && row.ok === true && timestamp(row.at) >= timestamp(action.created_at) && timestamp(row.at) < timestamp(target[0].at)) && evidence.boot.some(row => row.event === 'a2a_poll' && row.pending === 0 && row.ok === true && timestamp(row.at) > timestamp(target[0].at) && timestamp(row.at) <= timestamp(evidence.context.captureUTC)));
      return freeze({schemaVersion: 1, kind: 'legacy-never-dispatched-v1', actionId: action.id, actionDigest: subject.actionDigest, operationId: request.operationId, specHash: request.specHash, challenge: request.challenge, freezeDigest: request.freezeDigest, hostId: policy.hostId, workspaceId: policy.workspaceId, workspace: policy.workspace, deviceId: policy.deviceId, origin: policy.origin, authorizationDigest, historicalGenerationDigest: evidence.historicalGenerationDigest, policyDigest: evidence.policyDigest, sourceDigest: evidence.sourceDigest, cacheDigest: evidence.cacheDigest, loggerDigest: evidence.loggerDigest, artifactDigest: evidence.artifactDigest, conclusion: 'never-dispatched', verified: true});
    }
  });
  capabilities.add(capability); return capability;
}
export const isLegacySourceInterpreter = value => capabilities.has(value);
