import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { timingSafeEqual, randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ActionDispatcher } from '../src/daemon.mjs';
import { createActionScheduler, isCancellationAction } from '../src/daemon-action-scheduler.mjs';
import { createActionDelivery, ACTION_TRANSPORT_BUDGETS } from '../src/daemon-action-delivery.mjs';
import { createLocalActionExecutor } from '../src/local-action.mjs';
import { redactSecrets } from '../src/redaction.mjs';
import { discoverInstalledRuntimes, terminalMcpStatus } from '../src/runtime-adapters.mjs';
import { readA2AToken } from '../backend/a2a-auth.mjs';
import { createManagementBootstrap, clientBuildIdentity } from '../src/management-bootstrap.mjs';
import { defaultUserDir, resolveConfigPath, resolveDaemonDataDirectory, resolveWorkspaceConnections, claimWorkspaceGrant } from './config.mjs';
import {inspectLocalDaemonMaintenanceFiles} from '../backend/preservation-native-evidence.mjs';
import {createProductionClientIdentityHandler} from '../backend/preservation-source-namespace.mjs';
import {loadPrivateClientIdentityConfiguration,privateClientConnections,createPrivateClientStateReader,createPrivateIdentityHttpRoute} from './private-preservation-identity.mjs';
import { createRemoteClientUpdates, remoteMaintenanceHostId, REMOTE_CLIENT_UPDATE_FEATURE } from '../src/client-remote-update.mjs';
import { launchRemoteClientUpdate, inspectRemoteClientUpdateWorker, recoverRemoteClientUpdateWorker } from '../scripts/client-remote-update-worker.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const packageMeta = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = process.env.ZIWEI_USER_VERSION || packageMeta.version;
const CLIENT_BUILD = clientBuildIdentity(ROOT);
if (process.argv.includes('--version')) { console.log(`ziwei_user ${VERSION}`); process.exit(0); }
const standaloneHome = process.env.ZIWEI_USER_HOME ? defaultUserDir({ env: process.env }) : null;
const dataDir = resolveDaemonDataDirectory({ root: ROOT, env: process.env });
const logDir = standaloneHome ? path.join(standaloneHome, 'logs') : path.join(ROOT, '.local', 'logs');
const runtimeDir = standaloneHome ? path.join(standaloneHome, 'runtime') : path.join(ROOT, '.local', 'runtime');
const configPath = resolveConfigPath({ root: ROOT, env: process.env });
const lifecycleNonce = randomBytes(24).toString('hex');
const lifecycleStartedAt = new Date().toISOString();
// Keep the digest of the exact bytes parsed at startup. A later disk read may
// inspect current configuration but cannot stand in for loaded configuration.
const loadedConfigBytes = fs.existsSync(configPath) ? fs.readFileSync(configPath) : null;
const loadedConfigSha256 = loadedConfigBytes ? createHash('sha256').update(loadedConfigBytes).digest('hex') : null;
const config = loadedConfigBytes
  ? JSON.parse(loadedConfigBytes.toString('utf8'))
  : { agentId: 'ziwei_user', serviceName: 'ziwei_user', workspace: process.env.ZIWEI_WORKSPACE || '', apiBase: process.env.ZIWEI_API_BASE || 'http://127.0.0.1:4178', healthHost: '127.0.0.1', healthPort: 20242, heartbeatMs: 15000, pollMs: 5000 };
const privateIdentityConfiguration=loadPrivateClientIdentityConfiguration();
if (config.connectionState === 'disconnected') { console.error('ziwei_user 已明确断开全部工作区；拒绝环境变量回退和轮询，请使用 connect 重新配对。'); process.exit(1); }
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(logDir, { recursive: true });
fs.mkdirSync(runtimeDir, { recursive: true });
if (config.hermesHome) process.env.HERMES_HOME = String(config.hermesHome);
const logPath = path.join(logDir, 'daemon.log');
function log(event, extra = {}) {
  const line = redactSecrets(JSON.stringify({ at: new Date().toISOString(), pid: process.pid, event, service: 'ziwei_user', version: VERSION, agentId: 'ziwei_user', ...extra }));
  fs.appendFileSync(logPath, line + '\n');
  // The exit event can only perform synchronous cleanup. Do not enqueue a
  // final pipe write while Node is tearing down native handles on Windows.
  if (event !== 'exited') console.log(line);
}
function rotate() { try { if (fs.statSync(logPath).size > 5 * 1024 * 1024) fs.renameSync(logPath, `${logPath}.${Date.now()}`); } catch {} }
const connections = new Map();
let remoteClientUpdates;
const remoteUpdateEnabled = process.platform === 'win32' && path.basename(ROOT) === 'ziwei' && path.basename(path.dirname(ROOT)) === 'node_modules' && Boolean(standaloneHome);
const maintenanceHostId = remoteUpdateEnabled ? remoteMaintenanceHostId(dataDir) : null;
const executionAllowed = () => ![...connections.values()].some(connection => connection.dispatcher?.quarantined);
let connectionErrors = [];
function installConnections() {
  const resolved = resolveWorkspaceConnections(config, { configPath, root: ROOT });
  connectionErrors = resolved.errors;
  for (const error of connectionErrors) log('workspace_connection_invalid', error);
  for (const config of resolved.connections) {
    if (connections.has(config.workspace)) continue;
    const connectionRuntimeDir = config.primary ? runtimeDir : path.join(runtimeDir, 'shared-workspaces', config.workspace, config.deviceId);
    const state = { config, runtimeDir:connectionRuntimeDir, hermesHomePath:config.hermesHome || process.env.HERMES_HOME || null, polling: false, lastHeartbeat: null, lastHeartbeatAt: 0, lastPoll: null };
    state.managementBootstrap = createManagementBootstrap({ workspace: config.workspace, deviceId: config.deviceId, deviceToken: config.deviceToken, apiBase: config.apiBase, cacheDirectory: path.join(dataDir, 'management-mcp-credentials') });
    const localExecutor = createLocalActionExecutor({
      runtimeDir: connectionRuntimeDir,
      admissionHandledByDispatcher:true,
      defaultWorkdir: config.workdir || process.cwd() || ROOT,
      allowedExecutables: Array.isArray(config.allowedExecutables) ? config.allowedExecutables : [],
      executorCommand: config.executorCommand || process.env.ZIWEI_EXECUTOR_COMMAND || null,
      executorArgs: Array.isArray(config.executorArgs) ? config.executorArgs : [],
      defaultRuntime: config.defaultRuntime || process.env.ZIWEI_DEFAULT_RUNTIME || null,
      hermesHomePath: state.hermesHomePath,
      managementBootstrap: state.managementBootstrap,
      terminalMcpConfig: config.terminalMcp || {},
      workspace: config.workspace, apiBase: config.apiBase,
      deviceId: config.deviceId || 'device-ziwei-user', deviceToken: config.deviceToken,
      onWorkspaceConnect: config.primary ? async (grantId, context) => {
        const result = await claimWorkspaceGrant({ config, configPath, grantId, privateDirectory: path.join(dataDir, 'workspace-credentials'), signal: context.signal });
        const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        // The shared list is the only configuration field changed by claiming a grant.
        globalConfigSharedWorkspaces(saved.sharedWorkspaces);
        installConnections();
        const added = connections.get(result.workspace);
        if (added) await heartbeatConnection(added);
        return result;
      } : null,
    });
    state.localExecutor=localExecutor;
    state.dispatcher = new ActionDispatcher({
      // Keep primary state in place and isolate every explicitly shared workspace.
      workdir: config.workdir || process.cwd() || ROOT,
      workspace: config.workspace, deviceId: config.deviceId,
      stateFile: path.join(connectionRuntimeDir, 'action-state.json'), execute: localExecutor,
      authorizeExecute:action=>localExecutor.authorizeExecution(action),
      canExecute: executionAllowed,
      onEvent: (event, extra) => {
        log(event, { workspace: config.workspace, ...extra });
        if (extra?.actionId && ['action.started', 'action.output', 'action.progress', 'action.stage', 'action.waiting'].includes(event)) state.actionDelivery?.recordEvent(extra.actionId, event, extra);
        if (extra?.actionId && event === 'action.result_recovered') void state.actionDelivery?.recoverOriginal(extra.actionId).catch(error => log('a2a_recovered_result_pending', { workspace: config.workspace, actionId: extra.actionId, error: error.message }));
      },
    });
    state.actionDelivery = createActionDelivery({
      directory: path.join(connectionRuntimeDir, 'action-delivery'),
      identity: { apiBase: config.apiBase, workspace: config.workspace, deviceId: config.deviceId },
      post: (pathname, body, options) => postAction(state, pathname, body, options),
      dispatch: action => state.dispatcher.dispatch(action),
      recoverResult: action => state.dispatcher.completedResult(action),
      onSuccess: async action => { if (action.type === 'hermes.profile.create') await refreshRuntimeDiscovery(state); },
      onEvent: (event, extra) => log(event, { workspace: config.workspace, ...extra }),
    });
    state.actionScheduler = createActionScheduler({
      execute: action => state.actionDelivery.execute(action),
      canStart: (action, admission) => isCancellationAction(action) || state.actionDelivery.canDeliverWithoutExecution(action) || ((!remoteClientUpdates?.blocksNewActions || admission.collaborationChild) && executionAllowed()),
      quarantinedActionIds: () => state.dispatcher.quarantinedActionIds,
      onError: (error, action) => log('a2a_action_failed', { workspace: config.workspace, actionId: action.id, error: error.message }),
    });
    state.managementStatus = state.managementBootstrap.status();
    state.terminalStatus = terminalMcpStatus({ config: config.terminalMcp, workspace: config.workspace, apiBase: config.apiBase, deviceToken: config.deviceToken });
    connections.set(config.workspace, state);
  }
}
function globalConfigSharedWorkspaces(sharedWorkspaces) { config.sharedWorkspaces = sharedWorkspaces; }
installConnections();
const primaryConnection = connections.get(config.workspace);
let lastHeartbeat = null;
let lastHeartbeatAt = 0;
let missingWorkspaceLogged = false;
let lastPoll = null;
let runtimeDiscovery = discoverInstalledRuntimes({ force: true });
let heartbeatTimer;
let pollTimer;
let draining = false;
const shutdownAbort = new AbortController();
const activeHeartbeats = new Set();
const remoteUpdateIdle = () => [...connections.values()].every(connection => !connection.polling && connection.actionScheduler.activeCount === 0 && connection.localExecutor.maintenanceStatus().workers.every(worker => worker.pendingCommands === 0 && worker.inFlight === 0 && worker.pendingInbound === 0));
remoteClientUpdates = createRemoteClientUpdates({
  home: dataDir, hostId: maintenanceHostId, clientBuild: CLIENT_BUILD, enabled: remoteUpdateEnabled,
  connections: () => [...connections.values()].map(connection => connection.config).filter(config => config.deviceToken),
  idle: remoteUpdateIdle,
  prepareIdle: async () => {
    if (!remoteUpdateIdle()) throw Object.assign(new Error('CLIENT_UPDATE_BUSY_AT_DRAIN'), { code: 'CLIENT_UPDATE_BUSY_AT_DRAIN' });
    await Promise.all([...connections.values()].map(connection => connection.localExecutor.close()));
    if ([...connections.values()].some(connection => !connection.localExecutor.maintenanceStatus().safe)) throw Object.assign(new Error('CLIENT_UPDATE_GATEWAY_EXIT_UNCONFIRMED'), { code: 'CLIENT_UPDATE_GATEWAY_EXIT_UNCONFIRMED' });
  },
  request: async (config, pathname, body) => {
    const response = await fetch(config.apiBase + pathname, { method: body ? 'POST' : 'GET', redirect: 'error', headers: { 'x-ziwei-device-token': config.deviceToken, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.any([AbortSignal.timeout(8000), shutdownAbort.signal]) });
    if (!response.ok) throw Object.assign(new Error('CLIENT_UPDATE_TRANSPORT_FAILED'), { code: [401, 403].includes(response.status) ? 'CLIENT_UPDATE_AUTHORIZATION_FAILED' : response.status === 404 ? 'CLIENT_UPDATE_SERVER_UNSUPPORTED' : 'CLIENT_UPDATE_TRANSPORT_FAILED', status: response.status });
    const payload = await response.json(); if (payload.ok !== true) throw Object.assign(new Error('CLIENT_UPDATE_RESPONSE_INVALID'), { code: 'CLIENT_UPDATE_RESPONSE_INVALID' });
    return payload;
  },
  launch: ({ request, claimToken }) => launchRemoteClientUpdate({ root: ROOT, home: dataDir, configPath, request, claimToken }),
  inspectWorker: worker => inspectRemoteClientUpdateWorker(worker, { home: dataDir }),
  recoverWorker: (request, claimToken) => recoverRemoteClientUpdateWorker({ home: dataDir, request, claimToken }),
  log,
});
function clientRuntimeDiscovery() {
  return { checkedAt: runtimeDiscovery.discoveredAt, platform: runtimeDiscovery.bridge.platform, arch: runtimeDiscovery.bridge.arch, clientBuild: CLIENT_BUILD, features: ['bot_mcp_oauth_relay_v1', ...(remoteUpdateEnabled ? [REMOTE_CLIENT_UPDATE_FEATURE] : [])], ...(maintenanceHostId ? { maintenanceHostId } : {}) };
}
process.on('uncaughtException', error => log('uncaught_exception', { error: error.stack || error.message }));
process.on('unhandledRejection', error => log('unhandled_rejection', { error: error?.stack || String(error) }));
async function heartbeat() {
  if (draining) return;
  if (!String(config.workspace || '').trim()) {
    if (!missingWorkspaceLogged) { log('configuration_error', { error: '未配置 workspace，已停止发送心跳' }); missingWorkspaceLogged = true; }
    return;
  }
  // Reuse the bounded discovery TTL on periodic heartbeats. Starting and
  // explicit profile refresh still force probes; cached checkedAt stays real.
  runtimeDiscovery = discoverInstalledRuntimes();
  await Promise.allSettled([...connections.values()].map(heartbeatConnection));
}
function heartbeatConnection(connection) {
  if (draining || shutdownAbort.signal.aborted) return Promise.resolve();
  const pending = performHeartbeatConnection(connection);
  activeHeartbeats.add(pending);
  pending.then(() => activeHeartbeats.delete(pending), () => activeHeartbeats.delete(pending));
  return pending;
}
async function performHeartbeatConnection(connection) {
  if (draining) return;
  const config = connection.config;
  try { await connection.managementBootstrap.prepare({signal: shutdownAbort.signal}); } catch {}
  if (draining || shutdownAbort.signal.aborted) return;
  connection.managementStatus = connection.managementBootstrap.status();
  connection.terminalStatus = terminalMcpStatus({ config: config.terminalMcp, workspace: config.workspace, apiBase: config.apiBase, deviceToken: config.deviceToken });
  const payload = {
    workspace: config.workspace,
    agentId: 'ziwei_user',
    serviceName: 'ziwei_user',
    deviceId: config.deviceId || 'device-ziwei-user',
    name: config.serviceName || 'ziwei_user',
    os: process.platform === 'win32' ? 'Windows' : process.platform,
    arch: process.arch,
    version: VERSION,
    bridge: 'ziwei_user',
    bridgeVersion: VERSION,
    clientBuild: CLIENT_BUILD,
    pid: process.pid,
    workdir: config.workdir || process.cwd() || ROOT,
    ipHint: '127.0.0.1',
    heartbeatMs: Number(config.heartbeatMs) || 15000,
    status: 'online',
    runtimes: runtimeDiscovery.runtimes,
    runtimeMetadata: runtimeDiscovery.runtimes,
    runtimeDiscovery: clientRuntimeDiscovery(),
    managementMcp: connection.managementStatus,
    terminalMcp: connection.terminalStatus,
    agentVersions: Object.fromEntries(Object.entries(runtimeDiscovery.runtimes).map(([name, item]) => [name, item.status === 'available' ? item.version || null : null]))
  };
  try {
    const response = await fetch(`${config.apiBase}/api/workspaces/${encodeURIComponent(config.workspace)}/heartbeat`, {
      method: 'POST', headers: daemonHeaders(connection, { json: true }), body: JSON.stringify(payload), signal: AbortSignal.any([AbortSignal.timeout(3000), shutdownAbort.signal])
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok !== true) throw new Error(body.error || `heartbeat HTTP ${response.status}`);
    if (connection.managementBootstrap.noteRetry(body.device?.management_mcp_retry_at)) {
      try { await connection.managementBootstrap.prepare({signal: shutdownAbort.signal}); } catch {}
      connection.managementStatus = connection.managementBootstrap.status();
    }
    connection.lastHeartbeat = new Date().toISOString();
    connection.lastHeartbeatAt = Date.now();
    if (config.primary) { lastHeartbeat = connection.lastHeartbeat; lastHeartbeatAt = connection.lastHeartbeatAt; }
    // New servers persist runtime discovery separately. Older local servers
    // may not expose this endpoint; a heartbeat remains sufficient for them.
    try {
      if (draining || shutdownAbort.signal.aborted) return;
      const registered = await fetch(`${config.apiBase}/api/workspaces/${encodeURIComponent(config.workspace)}/runtimes/register`, {
        method: 'POST', headers: daemonHeaders(connection, { json: true }),
        body: JSON.stringify({ agentId: 'ziwei_user', deviceId: payload.deviceId, clientBuild: CLIENT_BUILD, runtimeDiscovery: payload.runtimeDiscovery, runtimes: runtimeDiscovery.runtimes }),
        signal: AbortSignal.any([AbortSignal.timeout(3000), shutdownAbort.signal])
      });
      await registered.arrayBuffer();
    } catch {}
    log('heartbeat', { ok: true, workspace: config.workspace, apiBase: config.apiBase, deviceId: body.device?.id || payload.deviceId, status: body.device?.status || 'online', runtimes: Object.fromEntries(Object.entries(runtimeDiscovery.runtimes).map(([name, item]) => [name, item.status === 'available' ? item.version : item.detection?.reasonCode || item.status])) });
  } catch (error) { log('heartbeat_failed', { workspace: config.workspace, error: error.message, apiBase: config.apiBase }); } finally { rotate(); }
}
function daemonHeaders(connection, { json = false, a2a = false } = {}) {
  const config = connection.config;
  const headers = json ? { 'content-type': 'application/json' } : {};
  if (config.deviceToken) headers['x-ziwei-device-token'] = String(config.deviceToken);
  else if (a2a && config.primary) {
    const token = readA2AToken({ create: false });
    if (token) headers.authorization = `Bearer ${token}`;
  }
  return headers;
}
async function postAction(connection, pathname, body, { timeoutMs = ACTION_TRANSPORT_BUDGETS.ack } = {}) {
  const config = connection.config;
  const headers = daemonHeaders(connection, { json: true, a2a: true });
  const response = await fetch(`${config.apiBase}${pathname}`, { method:'POST', headers, body:JSON.stringify(body), signal:AbortSignal.timeout(timeoutMs) });
  let payload;try { payload=await response.json(); } catch { throw Object.assign(new Error(`Invalid A2A response (HTTP ${response.status})`), response.ok ? {} : {status:response.status}); }
  if (!response.ok) throw Object.assign(new Error(payload.error || `A2A HTTP ${response.status}`), {status:response.status});
  return payload;
}
async function refreshRuntimeDiscovery(connection) {
  const config = connection.config;
  runtimeDiscovery = discoverInstalledRuntimes({ force: true });
  if (!String(config.workspace || '').trim()) return;
  try {
    await fetch(`${config.apiBase}/api/workspaces/${encodeURIComponent(config.workspace)}/runtimes/register`, {
      method: 'POST', headers: daemonHeaders(connection, { json: true }),
      body: JSON.stringify({ agentId: 'ziwei_user', deviceId: config.deviceId || 'device-ziwei-user', clientBuild: CLIENT_BUILD, runtimeDiscovery: clientRuntimeDiscovery(), runtimes: runtimeDiscovery.runtimes }),
      signal: AbortSignal.timeout(3000)
    });
  } catch (error) { log('runtime_discovery_refresh_failed', { error: error.message }); }
}
async function poll() {
  await remoteClientUpdates.tick();
  if (draining || shutdownAbort.signal.aborted) return;
  await Promise.allSettled([...connections.values()].map(pollConnection));
}
async function pollConnection(connection) {
  const config = connection.config;
  if (draining || !String(config.workspace || '').trim()) return;
  if (connection.polling) return;
  connection.polling = true;
  connection.pollAbort = new AbortController();
  try {
    const headers = daemonHeaders(connection, { a2a: true });
    const response = await fetch(`${config.apiBase}/a2a/v1/actions?workspace=${encodeURIComponent(config.workspace)}&agent=ziwei_user&status=pending&includeAcked=1`, { headers, signal: AbortSignal.any([AbortSignal.timeout(ACTION_TRANSPORT_BUDGETS.poll), connection.pollAbort.signal]) });
    if (!response.ok) throw new Error(`A2A poll HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload.actions)) throw new Error('Invalid A2A poll response');
    connection.lastPoll = new Date().toISOString();
    if (config.primary) lastPoll = connection.lastPoll;
    const actions=payload.actions || [];
    log('a2a_poll', { ok: response.ok, workspace: config.workspace, pending: actions.length });
    if (!draining) {
      const byId=new Map(actions.map(action=>[action.id,action]));
      for (const action of connection.actionDelivery.recoverActions()) if (!byId.has(action.id)) byId.set(action.id,action);
      connection.actionScheduler.schedule([...byId.values()]);
    }
  } catch (error) {
    log('a2a_poll_failed', { error: error.message });
  } finally { connection.polling = false; connection.pollAbort = null; }
}
function heartbeatFresh() {
  if (!lastHeartbeatAt) return false;
  const interval = Math.max(1000, Number(config.heartbeatMs) || 15000);
  const timeout = Math.max(interval * 3, Number(config.heartbeatTimeoutMs) || 45000);
  return Date.now() >= lastHeartbeatAt && Date.now() - lastHeartbeatAt <= timeout;
}
function lifecycleConfigurationHash() { try { return createHash('sha256').update(fs.readFileSync(configPath)).digest('hex'); } catch { return null; } }
function healthPayload() {
  const executionQuarantined = !executionAllowed();
  const quarantinedActionCount = [...connections.values()].reduce((total, connection) => total + connection.dispatcher.quarantinedActionIds.length, 0);
  const gateway=[...connections.values()].map(connection=>connection.localExecutor.maintenanceStatus());
  const fileEvidence=inspectLocalDaemonMaintenanceFiles({connections:[...connections.values()].map(connection=>({workspace:connection.config.workspace,deviceId:connection.config.deviceId,apiBase:connection.config.apiBase,runtimeDir:connection.runtimeDir}))});
  const gatewaySafe=gateway.every(row=>row.safe===true);
  const maintenance={safe:fileEvidence.safe&&gatewaySafe&&quarantinedActionCount===0,stopSafe:fileEvidence.stopSafe&&gatewaySafe&&quarantinedActionCount===0,retainedDeliveryCount:fileEvidence.retainedDeliveryCount,retainedBackgroundCount:fileEvidence.retainedBackgroundCount,pendingDeliveryCount:[...connections.values()].reduce((n,c)=>n+c.actionDelivery.pendingCount,0),blockedDeliveryCount:[...connections.values()].reduce((n,c)=>n+c.actionDelivery.blockedCount,0),gatewaySafe,gatewayWorkers:gateway.flatMap(row=>row.workers),fileIssues:fileEvidence.issues,stopIssues:fileEvidence.stopIssues.map(({code})=>({code}))};
  return { service: 'ziwei_user', version: VERSION, clientBuild: CLIENT_BUILD, bridge: 'ziwei_user', agentId: 'ziwei_user', workspace: config.workspace, deviceId: config.deviceId, runtimes: runtimeDiscovery.runtimes, managementMcp: primaryConnection?.managementBootstrap.status(), terminalMcp: primaryConnection?.terminalStatus, lastHeartbeat, lastHeartbeatAgeMs: lastHeartbeatAt ? Math.max(0, Date.now() - lastHeartbeatAt) : null, lastPoll, pid: process.pid,
    lifecycle: { nonce: lifecycleNonce, root: ROOT, configPath, configSha256: lifecycleConfigurationHash(), runtimeDir, startedAt: lifecycleStartedAt, managedAuxiliaryCount: maintenance.gatewayWorkers.filter(row=>row.processAlive!==false).length }, maintenance, remoteClientUpdate: remoteClientUpdates.status(),
    connectionState: draining ? 'draining' : executionQuarantined ? 'quarantined' : 'connected', executionQuarantined, quarantinedActionCount, activeActionCount: [...connections.values()].reduce((total, connection) => total + connection.actionScheduler.activeCount, 0), pollingCount: [...connections.values()].filter(connection => connection.polling).length,
    connections: [...connections.values()].map(connection => ({ workspace: connection.config.workspace, deviceId: connection.config.deviceId, primary: connection.config.primary, configured: true, ready: !draining && !executionQuarantined && connection.lastHeartbeatAt > 0 && Date.now() - connection.lastHeartbeatAt <= Math.max(45_000, (Number(config.heartbeatMs) || 15_000) * 3), lastHeartbeat: connection.lastHeartbeat, managementMcp: connection.managementBootstrap.status(), terminalMcp: connection.terminalStatus })), connectionErrors,
  };
}
function localStopRefusal(state) {
  const reasons=new Map(),add=(code,count=1)=>reasons.set(code,(reasons.get(code)||0)+count);
  if(state.connectionState!=='draining')add('CONNECTION_NOT_DRAINING');
  if(state.activeActionCount)add('ACTIVE_ACTIONS',state.activeActionCount);
  if(state.pollingCount)add('ACTIVE_POLLS',state.pollingCount);
  if(state.quarantinedActionCount)add('EXECUTION_QUARANTINED',state.quarantinedActionCount);
  if(state.maintenance.gatewaySafe!==true)add('REGISTERED_GATEWAY_NOT_DRAINED');
  for(const issue of state.maintenance.stopIssues||[])add(/^[A-Z][A-Z0-9_]{0,63}$/.test(issue.code)?issue.code:'FILE_EVIDENCE_UNSAFE');
  if(state.maintenance.stopSafe!==true&&!reasons.size)add('MAINTENANCE_STOP_UNSAFE');
  const all=[...reasons].map(([code,count])=>({code,count}));
  return {error:'CLIENT_STOP_UNSAFE',activeActionCount:state.activeActionCount,pollingCount:state.pollingCount,quarantinedActionCount:state.quarantinedActionCount,maintenance:{safe:state.maintenance.safe,stopSafe:state.maintenance.stopSafe,pendingDeliveryCount:state.maintenance.pendingDeliveryCount,blockedDeliveryCount:state.maintenance.blockedDeliveryCount,retainedDeliveryCount:state.maintenance.retainedDeliveryCount},reasons:all.slice(0,16),...(all.length>16?{moreReasonCount:all.length-16}:{})};
}
const privateIdentityHandler=privateIdentityConfiguration?createProductionClientIdentityHandler({...privateIdentityConfiguration,boot:{nonce:lifecycleNonce,startedAt:lifecycleStartedAt,clientBuild:CLIENT_BUILD,configPath,runtimeDir,loadedConfigSha256,connections:privateClientConnections(connections)},readState:createPrivateClientStateReader({connections,isDraining:()=>draining,connectionErrors:()=>connectionErrors})}):null;
const privateIdentityRoute=createPrivateIdentityHttpRoute(privateIdentityHandler);
const health = http.createServer((req, res) => {
  if(privateIdentityRoute(req,res))return;
  if (req.url === '/local/connection-control') {
    const supplied = Buffer.from(String(req.headers['x-ziwei-local-control'] || '')); const expected = Buffer.from(String(config.deviceToken || ''));
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
    if (req.method !== 'POST' || !local || !expected.length || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { res.writeHead(401); res.end(); return; }
    let body = ''; req.on('data', chunk => { body += chunk; if (body.length > 1024) req.destroy(); });
    req.on('end', () => {
      let operation, nonce; try { ({ operation, nonce } = JSON.parse(body)); } catch {}
      if (!['pause', 'resume', 'stop'].includes(operation)) { res.writeHead(400); res.end(); return; }
      // Legacy pause/resume remains token authenticated. Stop always binds this
      // boot; supplying a wrong nonce can never silently use legacy behavior.
      if ((nonce !== undefined && nonce !== lifecycleNonce) || (operation === 'stop' && nonce !== lifecycleNonce)) { res.writeHead(409, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({error:'CLIENT_CONTROL_IDENTITY_CHANGED',reasons:[{code:'BOOT_IDENTITY_MISMATCH',count:1}]})); return; }
      if (operation === 'stop') {
        const state = healthPayload();
        if (!draining || state.activeActionCount || state.pollingCount || !state.maintenance.stopSafe) { res.writeHead(409, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(localStopRefusal(state))); return; }
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(state));
        setImmediate(() => stop('local_maintenance'));
        return;
      }
      draining = operation === 'pause';
      if (draining) for (const connection of connections.values()) connection.pollAbort?.abort();
      log(draining ? 'connection_drain_requested' : 'connection_drain_cancelled', { activeActionCount: healthPayload().activeActionCount, connectionCount: connections.size });
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(healthPayload()));
    });
    return;
  }
  if (req.url === '/healthz') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, ...healthPayload() })); return; }
  if (req.url === '/readyz') { const ready = !draining && executionAllowed() && heartbeatFresh(); res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ready, ...healthPayload() })); return; }
  res.writeHead(404); res.end();
});
let stopping = false;
health.on('error', error => {
  log('health_server_error', { error: error.message, code: error.code || null });
  // A second ziwei_user must fail closed. Leaving a duplicate process alive
  // would make its heartbeat and A2A poll indistinguishable from the owner.
  if (error.code === 'EADDRINUSE') {
    process.exitCode = 1;
    setImmediate(() => process.exit(1));
  }
});
health.listen(config.healthPort, config.healthHost, () => log('started', { health: `http://${config.healthHost}:${config.healthPort}`, apiBase: config.apiBase, heartbeatMs: config.heartbeatMs, pollMs: config.pollMs }));
await heartbeat();
// A local stop may arrive while the initial heartbeat is still awaiting IO.
// That continuation must not install timers after shutdown has begun.
if (!stopping) {
  heartbeatTimer = setInterval(heartbeat, Math.max(1000, Number(config.heartbeatMs) || 15000));
  pollTimer = setInterval(poll, Math.max(1000, Number(config.pollMs) || 5000));
  void poll();
}
function stop(signal) {
  if (stopping) return;
  stopping = true;
  draining = true;
  clearInterval(heartbeatTimer); clearInterval(pollTimer);
  shutdownAbort.abort();
  for (const connection of connections.values()) connection.pollAbort?.abort();
  const closed = new Promise(resolve => { if (health.listening) health.close(resolve); else resolve(); });
  // Signal shutdown also owns any registered resident Gateway. Its existing
  // close method waits for the supervised completion; no arbitrary PID is used.
  const executors = [...connections.values()].map(connection => Promise.resolve().then(async () => {
    await connection.localExecutor.close();
    // Supervision resolves even when a receipt/tree is unknown. Keep that
    // registered uncertainty visible instead of reporting successful shutdown.
    if (connection.localExecutor.maintenanceStatus()?.safe !== true) throw new Error('REGISTERED_GATEWAY_EXIT_UNCONFIRMED');
  }));
  const actions=[...connections.values()].map(connection=>connection.actionScheduler.whenIdle());
  void Promise.allSettled([closed, ...activeHeartbeats, ...actions, ...executors]).then(results => {
    const failed = results.filter(result => result.status === 'rejected').length;
    log('stopped', { signal, ...(failed ? { cleanupFailures: failed } : {}) });
    // Let outbound fetch, pipe writes and native close callbacks drain. The
    // server close callback alone is not a whole-process quiescence boundary.
    process.exitCode = failed ? 1 : 0;
  });
}
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('exit', code => { try { log('exited', { code }); } catch {} });
