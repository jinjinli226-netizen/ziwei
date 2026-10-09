import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { ActionDispatcher } from '../src/daemon.mjs';
import { createActionScheduler } from '../src/daemon-action-scheduler.mjs';
import { createLocalActionExecutor } from '../src/local-action.mjs';
import { redactSecrets } from '../src/redaction.mjs';
import { discoverInstalledRuntimes, terminalMcpStatus } from '../src/runtime-adapters.mjs';
import { readA2AToken } from '../backend/a2a-auth.mjs';
import { createManagementBootstrap, clientBuildIdentity } from '../src/management-bootstrap.mjs';
import { defaultUserDir, resolveConfigPath, resolveWorkspaceConnections, claimWorkspaceGrant } from './config.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const packageMeta = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = process.env.ZIWEI_USER_VERSION || packageMeta.version;
const CLIENT_BUILD = clientBuildIdentity(ROOT);
if (process.argv.includes('--version')) { console.log(`ziwei_user ${VERSION}`); process.exit(0); }
const standaloneHome = process.env.ZIWEI_USER_HOME ? defaultUserDir({ env: process.env }) : null;
const dataDir = standaloneHome || path.join(ROOT, 'data');
const logDir = standaloneHome ? path.join(standaloneHome, 'logs') : path.join(ROOT, '.local', 'logs');
const runtimeDir = standaloneHome ? path.join(standaloneHome, 'runtime') : path.join(ROOT, '.local', 'runtime');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(logDir, { recursive: true });
fs.mkdirSync(runtimeDir, { recursive: true });
const configPath = resolveConfigPath({ root: ROOT, env: process.env });
const config = fs.existsSync(configPath)
  ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
  : { agentId: 'ziwei_user', serviceName: 'ziwei_user', workspace: process.env.ZIWEI_WORKSPACE || '', apiBase: process.env.ZIWEI_API_BASE || 'http://127.0.0.1:4178', healthHost: '127.0.0.1', healthPort: 20242, heartbeatMs: 15000, pollMs: 5000 };
if (config.hermesHome) process.env.HERMES_HOME = String(config.hermesHome);
const logPath = path.join(logDir, 'daemon.log');
function log(event, extra = {}) {
  const line = redactSecrets(JSON.stringify({ at: new Date().toISOString(), pid: process.pid, event, service: 'ziwei_user', version: VERSION, agentId: 'ziwei_user', ...extra }));
  fs.appendFileSync(logPath, line + '\n');
  console.log(line);
}
function rotate() { try { if (fs.statSync(logPath).size > 5 * 1024 * 1024) fs.renameSync(logPath, `${logPath}.${Date.now()}`); } catch {} }
const connections = new Map();
let connectionErrors = [];
function installConnections() {
  const resolved = resolveWorkspaceConnections(config, { configPath, root: ROOT });
  connectionErrors = resolved.errors;
  for (const error of connectionErrors) log('workspace_connection_invalid', error);
  for (const config of resolved.connections) {
    if (connections.has(config.workspace)) continue;
    const connectionRuntimeDir = config.primary ? runtimeDir : path.join(runtimeDir, 'shared-workspaces', config.workspace, config.deviceId);
    const state = { config, polling: false, lastHeartbeat: null, lastHeartbeatAt: 0, lastPoll: null };
    state.managementBootstrap = createManagementBootstrap({ workspace: config.workspace, deviceId: config.deviceId, deviceToken: config.deviceToken, apiBase: config.apiBase, cacheDirectory: path.join(dataDir, 'management-mcp-credentials') });
    const localExecutor = createLocalActionExecutor({
      runtimeDir: connectionRuntimeDir,
      allowedExecutables: Array.isArray(config.allowedExecutables) ? config.allowedExecutables : [],
      executorCommand: config.executorCommand || process.env.ZIWEI_EXECUTOR_COMMAND || null,
      executorArgs: Array.isArray(config.executorArgs) ? config.executorArgs : [],
      defaultRuntime: config.defaultRuntime || process.env.ZIWEI_DEFAULT_RUNTIME || null,
      hermesHomePath: config.hermesHome || process.env.HERMES_HOME || null,
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
    state.dispatcher = new ActionDispatcher({
      // Keep primary state in place and isolate every explicitly shared workspace.
      workdir: config.workdir || process.cwd() || ROOT,
      stateFile: path.join(connectionRuntimeDir, 'action-state.json'), execute: localExecutor,
      onEvent: (event, extra) => {
        log(event, { workspace: config.workspace, ...extra });
        if (extra?.actionId && ['action.started', 'action.output', 'action.progress', 'action.stage'].includes(event)) void postActionEvent(state, extra.actionId, event, extra);
      },
    });
    state.actionScheduler = createActionScheduler({
      execute: action => executePolledAction(state, action),
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
process.on('uncaughtException', error => log('uncaught_exception', { error: error.stack || error.message }));
process.on('unhandledRejection', error => log('unhandled_rejection', { error: error?.stack || String(error) }));
async function heartbeat() {
  if (!String(config.workspace || '').trim()) {
    if (!missingWorkspaceLogged) { log('configuration_error', { error: '未配置 workspace，已停止发送心跳' }); missingWorkspaceLogged = true; }
    return;
  }
  runtimeDiscovery = discoverInstalledRuntimes({ force: true });
  await Promise.allSettled([...connections.values()].map(heartbeatConnection));
}
async function heartbeatConnection(connection) {
  const config = connection.config;
  try { await connection.managementBootstrap.prepare(); } catch {}
  connection.managementStatus = connection.managementBootstrap.status();
  connection.terminalStatus = terminalMcpStatus({ config: config.terminalMcp, workspace: config.workspace, apiBase: config.apiBase, deviceToken: config.deviceToken });
  const payload = {
    workspace: config.workspace,
    agentId: 'ziwei_user',
    serviceName: 'ziwei_user',
    deviceId: config.deviceId || 'device-ziwei-user',
    name: config.serviceName || 'ziwei_user',
    os: process.platform === 'win32' ? 'Windows' : process.platform,
    version: VERSION,
    bridge: 'ziwei_user',
    bridgeVersion: VERSION,
    pid: process.pid,
    workdir: config.workdir || process.cwd() || ROOT,
    ipHint: '127.0.0.1',
    heartbeatMs: Number(config.heartbeatMs) || 15000,
    status: 'online',
    runtimes: runtimeDiscovery.runtimes,
    runtimeMetadata: runtimeDiscovery.runtimes,
    managementMcp: connection.managementStatus,
    terminalMcp: connection.terminalStatus,
    agentVersions: Object.fromEntries(Object.entries(runtimeDiscovery.runtimes).map(([name, item]) => [name, item.version || null]))
  };
  try {
    const response = await fetch(`${config.apiBase}/api/workspaces/${encodeURIComponent(config.workspace)}/heartbeat`, {
      method: 'POST', headers: daemonHeaders(connection, { json: true }), body: JSON.stringify(payload), signal: AbortSignal.timeout(3000)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok !== true) throw new Error(body.error || `heartbeat HTTP ${response.status}`);
    if (connection.managementBootstrap.noteRetry(body.device?.management_mcp_retry_at)) {
      try { await connection.managementBootstrap.prepare(); } catch {}
      connection.managementStatus = connection.managementBootstrap.status();
    }
    connection.lastHeartbeat = new Date().toISOString();
    connection.lastHeartbeatAt = Date.now();
    if (config.primary) { lastHeartbeat = connection.lastHeartbeat; lastHeartbeatAt = connection.lastHeartbeatAt; }
    // New servers persist runtime discovery separately. Older local servers
    // may not expose this endpoint; a heartbeat remains sufficient for them.
    try {
      await fetch(`${config.apiBase}/api/workspaces/${encodeURIComponent(config.workspace)}/runtimes/register`, {
        method: 'POST', headers: daemonHeaders(connection, { json: true }),
        body: JSON.stringify({ agentId: 'ziwei_user', deviceId: payload.deviceId, runtimes: runtimeDiscovery.runtimes }),
        signal: AbortSignal.timeout(3000)
      });
    } catch {}
    log('heartbeat', { ok: true, workspace: config.workspace, apiBase: config.apiBase, deviceId: body.device?.id || payload.deviceId, status: body.device?.status || 'online', runtimes: Object.fromEntries(Object.entries(runtimeDiscovery.runtimes).map(([name, item]) => [name, item.version || item.status])) });
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
async function postAction(connection, pathname, body) {
  const config = connection.config;
  const headers = daemonHeaders(connection, { json: true, a2a: true });
  const response = await fetch(`${config.apiBase}${pathname}`, { method:'POST', headers, body:JSON.stringify(body), signal:AbortSignal.timeout(3000) });
  const payload=await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || `A2A HTTP ${response.status}`); return payload;
}
async function postActionEvent(connection, actionId, event, data = {}) {
  try {
    await postAction(connection, `/a2a/v1/actions/${encodeURIComponent(actionId)}/events`, { agentId: 'ziwei_user', type: event, message: data?.message || '', data });
  } catch (error) {
    // Event streaming was added after the initial local bridge API. A 404 is
    // expected against an older server and must not interrupt execution.
    if (!/404|A2A HTTP 404/.test(String(error?.message || error))) log('a2a_event_failed', { actionId, event, error: error.message });
  }
}
async function refreshRuntimeDiscovery(connection) {
  const config = connection.config;
  runtimeDiscovery = discoverInstalledRuntimes({ force: true });
  if (!String(config.workspace || '').trim()) return;
  try {
    await fetch(`${config.apiBase}/api/workspaces/${encodeURIComponent(config.workspace)}/runtimes/register`, {
      method: 'POST', headers: daemonHeaders(connection, { json: true }),
      body: JSON.stringify({ agentId: 'ziwei_user', deviceId: config.deviceId || 'device-ziwei-user', runtimes: runtimeDiscovery.runtimes }),
      signal: AbortSignal.timeout(3000)
    });
  } catch (error) { log('runtime_discovery_refresh_failed', { error: error.message }); }
}
async function poll() {
  await Promise.allSettled([...connections.values()].map(pollConnection));
}
async function pollConnection(connection) {
  const config = connection.config;
  if (!String(config.workspace || '').trim()) return;
  if (connection.polling) return;
  connection.polling = true;
  try {
    const headers = daemonHeaders(connection, { a2a: true });
    const response = await fetch(`${config.apiBase}/a2a/v1/actions?workspace=${encodeURIComponent(config.workspace)}&agent=ziwei_user&status=pending&includeAcked=1`, { headers, signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`A2A poll HTTP ${response.status}`);
    const payload = await response.json().catch(() => ({ actions: [] }));
    connection.lastPoll = new Date().toISOString();
    if (config.primary) lastPoll = connection.lastPoll;
    const actions=payload.actions || [];
    log('a2a_poll', { ok: response.ok, workspace: config.workspace, pending: actions.length });
    connection.actionScheduler.schedule(actions);
  } catch (error) {
    log('a2a_poll_failed', { error: error.message });
  } finally { connection.polling = false; }
}
async function executePolledAction(connection, action) {
  await postAction(connection, `/a2a/v1/actions/${encodeURIComponent(action.id)}/ack`, { agentId:'ziwei_user' });
  const result=await connection.dispatcher.dispatch(action);
  const terminalStatus = result.status === 'succeeded' || (result.status === 'duplicate' && result.originalStatus === 'succeeded') ? 'succeeded' : 'failed';
  if (terminalStatus === 'succeeded' && action.type === 'hermes.profile.create') await refreshRuntimeDiscovery(connection);
  await postActionEvent(connection, action.id, terminalStatus, { result: result.result ?? null, error: terminalStatus === 'failed' ? (result.error || 'ziwei_user execution failed') : null });
  await postAction(connection, `/a2a/v1/actions/${encodeURIComponent(action.id)}/result`, { status:terminalStatus, result:result.result ?? result, error:terminalStatus === 'failed' ? (result.error || 'ziwei_user execution failed') : null });
  log('a2a_result', { workspace: connection.config.workspace, actionId:action.id, status:terminalStatus, dispatcherStatus:result.status });
}
function heartbeatFresh() {
  if (!lastHeartbeatAt) return false;
  const interval = Math.max(1000, Number(config.heartbeatMs) || 15000);
  const timeout = Math.max(interval * 3, Number(config.heartbeatTimeoutMs) || 45000);
  return Date.now() >= lastHeartbeatAt && Date.now() - lastHeartbeatAt <= timeout;
}
function healthPayload() {
  return { service: 'ziwei_user', version: VERSION, clientBuild: CLIENT_BUILD, bridge: 'ziwei_user', agentId: 'ziwei_user', workspace: config.workspace, deviceId: config.deviceId, runtimes: runtimeDiscovery.runtimes, managementMcp: primaryConnection?.managementBootstrap.status(), terminalMcp: primaryConnection?.terminalStatus, lastHeartbeat, lastHeartbeatAgeMs: lastHeartbeatAt ? Math.max(0, Date.now() - lastHeartbeatAt) : null, lastPoll, pid: process.pid,
    connections: [...connections.values()].map(connection => ({ workspace: connection.config.workspace, deviceId: connection.config.deviceId, primary: connection.config.primary, configured: true, ready: connection.lastHeartbeatAt > 0 && Date.now() - connection.lastHeartbeatAt <= Math.max(45_000, (Number(config.heartbeatMs) || 15_000) * 3), lastHeartbeat: connection.lastHeartbeat, managementMcp: connection.managementBootstrap.status(), terminalMcp: connection.terminalStatus })), connectionErrors,
  };
}
const health = http.createServer((req, res) => {
  if (req.url === '/healthz') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, ...healthPayload() })); return; }
  if (req.url === '/readyz') { const ready = heartbeatFresh(); res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ready, ...healthPayload() })); return; }
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
await poll();
heartbeatTimer = setInterval(heartbeat, Math.max(1000, Number(config.heartbeatMs) || 15000));
pollTimer = setInterval(poll, Math.max(1000, Number(config.pollMs) || 5000));
function stop(signal) {
  if (stopping) return;
  stopping = true;
  clearInterval(heartbeatTimer); clearInterval(pollTimer);
  const finish = () => { log('stopped', { signal }); process.exit(0); };
  if (health.listening) health.close(finish); else finish();
}
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('exit', code => { try { log('exited', { code }); } catch {} });
