import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { ActionDispatcher } from '../src/daemon.mjs';
import { createLocalActionExecutor } from '../src/local-action.mjs';
import { redactSecrets } from '../src/redaction.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const packageMeta = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = process.env.ZIWEI_USER_VERSION || packageMeta.version;
if (process.argv.includes('--version')) { console.log(`ziwei_user ${VERSION}`); process.exit(0); }
const dataDir = path.join(ROOT, 'data');
const logDir = path.join(ROOT, '.local', 'logs');
const runtimeDir = path.join(ROOT, '.local', 'runtime');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(logDir, { recursive: true });
fs.mkdirSync(runtimeDir, { recursive: true });
const configPath = process.env.ZIWEI_CONFIG || path.join(dataDir, 'ziwei_user.json');
const config = fs.existsSync(configPath)
  ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
  : { agentId: 'ziwei_user', serviceName: 'ziwei_user', workspace: 'test-111', apiBase: process.env.ZIWEI_API_BASE || 'http://127.0.0.1:4178', healthHost: '127.0.0.1', healthPort: 20242, heartbeatMs: 15000, pollMs: 5000 };
const logPath = path.join(logDir, 'daemon.log');
function log(event, extra = {}) {
  const line = redactSecrets(JSON.stringify({ at: new Date().toISOString(), pid: process.pid, event, service: 'ziwei_user', version: VERSION, agentId: config.agentId, ...extra }));
  fs.appendFileSync(logPath, line + '\n');
  console.log(line);
}
function rotate() { try { if (fs.statSync(logPath).size > 5 * 1024 * 1024) fs.renameSync(logPath, `${logPath}.${Date.now()}`); } catch {} }
const localExecutor = createLocalActionExecutor({
  runtimeDir,
  allowedExecutables: Array.isArray(config.allowedExecutables) ? config.allowedExecutables : [],
  executorCommand: config.executorCommand || process.env.ZIWEI_EXECUTOR_COMMAND || null,
  executorArgs: Array.isArray(config.executorArgs) ? config.executorArgs : []
});
const dispatcher = new ActionDispatcher({
  workdir: runtimeDir,
  execute: localExecutor,
  onEvent: (event, extra) => log(event, extra)
});
const processing = new Set();
let lastHeartbeat = null;
let lastHeartbeatAt = 0;
let lastPoll = null;
let heartbeatTimer;
let pollTimer;
process.on('uncaughtException', error => log('uncaught_exception', { error: error.stack || error.message }));
process.on('unhandledRejection', error => log('unhandled_rejection', { error: error?.stack || String(error) }));
async function heartbeat() {
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
    ipHint: '127.0.0.1',
    heartbeatMs: Number(config.heartbeatMs) || 15000,
    status: 'online'
  };
  try {
    const response = await fetch(`${config.apiBase}/api/workspaces/${encodeURIComponent(config.workspace)}/heartbeat`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(3000)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok !== true) throw new Error(body.error || `heartbeat HTTP ${response.status}`);
    lastHeartbeat = new Date().toISOString();
    lastHeartbeatAt = Date.now();
    log('heartbeat', { ok: true, apiBase: config.apiBase, deviceId: body.device?.id || payload.deviceId, status: body.device?.status || 'online' });
  } catch (error) { log('heartbeat_failed', { error: error.message, apiBase: config.apiBase }); } finally { rotate(); }
}
async function postAction(pathname, body) {
  const response = await fetch(`${config.apiBase}${pathname}`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body), signal:AbortSignal.timeout(3000) });
  const payload=await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || `A2A HTTP ${response.status}`); return payload;
}
async function poll() {
  try {
    const response = await fetch(`${config.apiBase}/a2a/v1/actions?workspace=${encodeURIComponent(config.workspace)}&agent=ziwei_user&status=pending&includeAcked=1`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`A2A poll HTTP ${response.status}`);
    const payload = await response.json().catch(() => ({ actions: [] }));
    lastPoll = new Date().toISOString();
    const actions=payload.actions || [];
    log('a2a_poll', { ok: response.ok, pending: actions.length });
    for (const action of actions) {
      if (processing.has(action.id)) continue;
      processing.add(action.id);
      try {
        await postAction(`/a2a/v1/actions/${encodeURIComponent(action.id)}/ack`, { agentId:'ziwei_user' });
        const result=await dispatcher.dispatch(action);
        const terminalStatus = result.status === 'succeeded' || (result.status === 'duplicate' && result.originalStatus === 'succeeded') ? 'succeeded' : 'failed';
        await postAction(`/a2a/v1/actions/${encodeURIComponent(action.id)}/result`, { status:terminalStatus, result:result.result ?? result, error:terminalStatus === 'failed' ? (result.error || 'ziwei_user execution failed') : null });
        log('a2a_result', { actionId:action.id, status:terminalStatus, dispatcherStatus:result.status });
      } catch (error) { log('a2a_action_failed', { actionId:action.id, error:error.message }); }
      finally { processing.delete(action.id); }
    }
  } catch (error) {
    log('a2a_poll_failed', { error: error.message });
  }
}
function heartbeatFresh() {
  if (!lastHeartbeatAt) return false;
  const interval = Math.max(1000, Number(config.heartbeatMs) || 15000);
  const timeout = Math.max(interval * 3, Number(config.heartbeatTimeoutMs) || 45000);
  return Date.now() >= lastHeartbeatAt && Date.now() - lastHeartbeatAt <= timeout;
}
const health = http.createServer((req, res) => { if (req.url === '/healthz') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, service: 'ziwei_user', version: VERSION, bridge: 'ziwei_user', agentId: config.agentId, workspace: config.workspace, lastHeartbeat, lastHeartbeatAgeMs: lastHeartbeatAt ? Math.max(0, Date.now() - lastHeartbeatAt) : null, lastPoll, pid: process.pid })); return; } if (req.url === '/readyz') { const ready = heartbeatFresh(); res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ready, service: 'ziwei_user', version: VERSION, agentId: config.agentId, workspace: config.workspace, lastHeartbeat, lastHeartbeatAgeMs: lastHeartbeatAt ? Math.max(0, Date.now() - lastHeartbeatAt) : null, pid: process.pid })); return; } res.writeHead(404); res.end(); });
health.on('error', error => log('health_server_error', { error: error.message }));
health.listen(config.healthPort, config.healthHost, () => log('started', { health: `http://${config.healthHost}:${config.healthPort}`, apiBase: config.apiBase, heartbeatMs: config.heartbeatMs, pollMs: config.pollMs }));
await heartbeat();
await poll();
heartbeatTimer = setInterval(heartbeat, Math.max(1000, Number(config.heartbeatMs) || 15000));
pollTimer = setInterval(poll, Math.max(1000, Number(config.pollMs) || 5000));
function stop(signal) { clearInterval(heartbeatTimer); clearInterval(pollTimer); health.close(() => { log('stopped', { signal }); process.exit(0); }); }
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

