#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveConfigPath, resolveDaemonDataDirectory, disconnectedConfiguration, connectionCredentialFiles, isNativeDaemonProcess } from '../daemon/config.mjs';
import { createHash } from 'node:crypto';
import { clientBuildIdentity, clientBuildMismatch } from '../src/management-bootstrap.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PACKAGE_PATH = path.join(ROOT, 'package.json');
const PACKAGE_META = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8'));
const VERSION = process.env.ZIWEI_USER_VERSION || PACKAGE_META.version || '0.1.0';

function usage() {
  console.log(`紫薇 ziwei_user CLI ${VERSION}

用法:
  npm run ziwei:setup -- [--workspace <slug>] [--api <url>] [--health-port <port>] [--tls-ca-file <path>]
  ziwei_user connect --api <url> --code <一次性配对码> [--name <设备名>]
  ziwei_user start
  ziwei_user stop [--expected-pid <PID>] [--json]    Windows：停止本客户端，保留所有连接与数据
  ziwei_user update [--json]                      Windows：验证官方包后升级，保留连接和身份
  ziwei_user update-status [--json]               查看包外升级任务的真实完成/失败结果
  ziwei_user uninstall [--json]                   Windows：卸载本客户端，保留配置、认证和记忆
  ziwei_user remove                              uninstall 的别名
  ziwei_user change
  ziwei_user forget [--expected-pid <PID>]
  npm run ziwei:status [--json]
  npm run ziwei:version

环境变量:
  ZIWEI_CONFIG  配置文件路径，默认 data/ziwei_user.json
`);
}

function configPath() {
  return resolveConfigPath({ root: ROOT, env: process.env });
}

function parseArgs(argv) {
  const values = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') continue;
    if (!token.startsWith('--')) {
      values._.push(token);
      continue;
    }
    const equal = token.indexOf('=');
    const key = equal >= 0 ? token.slice(2, equal) : token.slice(2);
    const value = equal >= 0 ? token.slice(equal + 1) : argv[index + 1];
    if (equal < 0 && value && !value.startsWith('--')) index += 1;
    else if (equal < 0 && (!value || value.startsWith('--'))) values[key] = true;
    if (equal >= 0 || (value && !value.startsWith('--'))) values[key] = value;
  }
  return values;
}

function cleanApiBase(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return 'http://127.0.0.1:4178';
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('--api 必须是完整的 http(s) URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('--api 只支持 http 或 https');
  }
  // API 基地址不接受查询串、凭据或片段，避免把 token 等敏感值写入本地配置。
  parsed.username = '';
  parsed.password = '';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('--health-port 必须是 1-65535 的整数');
  }
  return port;
}

function cleanTlsCaFile(value) {
  const candidate = String(value ?? '').trim();
  if (!candidate) throw new Error('--tls-ca-file 不能为空');
  const resolved = path.isAbsolute(candidate)
    ? path.normalize(candidate)
    : path.resolve(ROOT, candidate);
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new Error(`--tls-ca-file 指向的文件不存在：${resolved}`);
  }
  if (!stat.isFile()) {
    throw new Error(`--tls-ca-file 必须指向文件：${resolved}`);
  }
  // Keep relative paths portable when setup is run from the project root;
  // start-ziwei-user.mjs resolves them against the same root at launch.
  return path.isAbsolute(candidate) ? resolved : path.normalize(candidate);
}

function rejectSecrets(args) {
  for (const key of ['token', 'api-token', 'auth', 'authorization', 'password', 'secret', 'key']) {
    if (Object.prototype.hasOwnProperty.call(args, key)) {
      throw new Error(`不支持 --${key}；ziwei_user 不接收或保存访问令牌`);
    }
  }
}

function readConfig() {
  const file = configPath();
  if (!fs.existsSync(file)) return null;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`配置文件格式错误：${file}`);
  }
  return { file, value: parsed };
}

function writeConfig(input) {
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(input, null, 2)}${os.EOL}`, { mode: 0o600 });
  fs.renameSync(temp, file);
  return file;
}

async function probeLocal(config = {}) {
  const host = config.healthHost || process.env.ZIWEI_HEALTH_HOST || '127.0.0.1';
  const port = config.healthPort || process.env.ZIWEI_HEALTH_PORT || 20242;
  const expectedWorkspace = String(config.workspace || process.env.ZIWEI_WORKSPACE || '').trim();
  const expectedAgent = String(config.agentId || 'ziwei_user');
  const healthUrl = `http://${host}:${port}/healthz`;
  const readyUrl = `http://${host}:${port}/readyz`;
  let liveness = { ok: false, url: healthUrl };
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1500) });
    const body = await response.json().catch(() => ({}));
    const identityOk = body.service === 'ziwei_user'
      && (!body.agentId || body.agentId === expectedAgent)
      && (!body.workspace || body.workspace === expectedWorkspace);
    liveness = { ...body, ok: response.ok && identityOk, status: response.status, url: healthUrl };
  } catch (error) {
    liveness.error = error.code || error.message;
  }
  let readiness = { ok: false, url: readyUrl };
  try {
    const response = await fetch(readyUrl, { signal: AbortSignal.timeout(1500) });
    const body = await response.json().catch(() => ({}));
    const identityOk = body.service === 'ziwei_user'
      && (!body.agentId || body.agentId === expectedAgent)
      && (!body.workspace || body.workspace === expectedWorkspace);
    readiness = { ...body, ok: response.ok && identityOk && body.ready === true, status: response.status, url: readyUrl };
  } catch (error) {
    readiness.error = error.code || error.message;
  }
  // `health` is intentionally readiness-based: the CLI answers whether the
  // device can serve the workspace, while liveness is retained for diagnosis.
  return { ...readiness, processAlive: liveness.ok, liveness };
}

function makeConfig(args, previous = {}) {
  const workspace = String(args.workspace || previous.workspace || process.env.ZIWEI_WORKSPACE || '').trim();
  if (!workspace) throw new Error('--workspace 不能为空');
  const healthPort = args['health-port'] !== undefined
    ? parsePort(args['health-port'])
    : parsePort(previous.healthPort || 20242);
  const tlsCaFile = args['tls-ca-file'] !== undefined
    ? cleanTlsCaFile(args['tls-ca-file'])
    : (previous.tlsCaFile ? String(previous.tlsCaFile) : undefined);
  return {
    ...previous,
    agentId: 'ziwei_user',
    serviceName: 'ziwei_user',
    workspace,
    apiBase: cleanApiBase(args.api || previous.apiBase || process.env.ZIWEI_API_BASE),
    healthHost: String(previous.healthHost || '127.0.0.1'),
    healthPort,
    heartbeatMs: Number(previous.heartbeatMs) > 0 ? Number(previous.heartbeatMs) : 15000,
    pollMs: Number(previous.pollMs) > 0 ? Number(previous.pollMs) : 5000,
    deviceId: String(previous.deviceId || 'device-ziwei-user'),
    ...(previous.deviceToken ? { deviceToken: String(previous.deviceToken) } : {}),
    ...(tlsCaFile ? { tlsCaFile } : {}),
  };
}

async function setup(args) {
  rejectSecrets(args);
  const previous = readConfig()?.value || {};
  const config = makeConfig(args, previous);
  const file = writeConfig(config);
  console.log(`ziwei_user 已配置`);
  console.log(`工作区: ${config.workspace}`);
  console.log(`API: ${config.apiBase}`);
  if (config.tlsCaFile) console.log(`TLS CA: ${config.tlsCaFile}`);
  console.log(`本地存活检查: http://${config.healthHost}:${config.healthPort}/healthz`);
  console.log(`本地就绪检查: http://${config.healthHost}:${config.healthPort}/readyz`);
  console.log(`配置文件: ${file}`);
  console.log('启动 daemon: npm run ziwei:start');
}

async function connect(args) {
  const code = String(args.code || '').trim();
  if (!code) throw new Error('connect 需要 --code <一次性配对码>');
  const apiBase = cleanApiBase(args.api || process.env.ZIWEI_API_BASE);
  const response = await fetch(`${apiBase}/api/daemon/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code,
      apiBase,
      name: String(args.name || args.device || '').trim() || undefined,
      os: process.platform === 'win32' ? 'Windows' : process.platform,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.deviceToken || !body.deviceId || !body.workspace) {
    throw new Error(body.error || `设备配对失败（HTTP ${response.status}）`);
  }
  const previous = readConfig()?.value || {};
  const config = {
    ...previous,
    connectionState: 'connected',
    agentId: 'ziwei_user',
    serviceName: 'ziwei_user',
    workspace: String(body.workspace),
    apiBase: cleanApiBase(body.apiBase || apiBase),
    healthHost: String(previous.healthHost || '127.0.0.1'),
    healthPort: parsePort(previous.healthPort || 20242),
    heartbeatMs: Number(previous.heartbeatMs) > 0 ? Number(previous.heartbeatMs) : 15000,
    pollMs: Number(previous.pollMs) > 0 ? Number(previous.pollMs) : 5000,
    deviceId: String(body.deviceId),
    deviceToken: String(body.deviceToken),
    workdir: String(previous.workdir || process.cwd()),
    ...(previous.tlsCaFile ? { tlsCaFile: String(previous.tlsCaFile) } : {}),
  };
  delete config.connectionCleanup; delete config.disconnectedAt;
  const file = writeConfig(config);
  console.log(`设备已连接：${config.workspace}`);
  console.log(`设备 ID：${config.deviceId}`);
  console.log(`配置文件：${file}`);
  console.log('下一步：运行 ziwei_user change 切换并启动当前配置，然后在网页刷新设备状态。');
}

async function status(args) {
  rejectSecrets(args);
  const current = readConfig();
  if (!current) {
    const health = await probeLocal();
    const result = { configured: false, service: 'ziwei_user', version: VERSION, config: configPath(), health };
    if (args.json) console.log(JSON.stringify(result));
    else console.log(`ziwei_user ${health.ok ? '在线（使用默认配置）' : '未配置'}\n配置文件: ${result.config}\n健康状态: ${health.ok ? '在线' : '离线'} (${health.url})`);
    process.exitCode = health.ok ? 0 : 1;
    return;
  }
  const config = current.value;
  if (config.connectionState === 'disconnected') {
    const cleanupPending = config.connectionCleanup?.state === 'pending';
    const result = { configured: false, connectionState: 'disconnected', connectionCount: 0, cleanupPending, service: 'ziwei_user', version: VERSION, config: current.file };
    console.log(args.json ? JSON.stringify(result) : `ziwei_user 已断开全部工作区（0 个连接），未配对。${cleanupPending ? ' 原进程或凭据清理待完成，请重试 forget。' : ''}\n配置文件: ${current.file}`);
    if (cleanupPending) process.exitCode = 1;
    return;
  }
  const health = await probeLocal(config);
  const result = {
    configured: true,
    service: 'ziwei_user',
    version: VERSION,
    config: current.file,
    workspace: config.workspace,
    apiBase: config.apiBase,
    ...(config.tlsCaFile ? { tlsCaFile: config.tlsCaFile } : {}),
    health,
  };
  if (args.json) {
    console.log(JSON.stringify(result));
  } else {
    console.log(`ziwei_user ${VERSION}`);
    console.log(`工作区: ${config.workspace}`);
    console.log(`配置文件: ${current.file}`);
    console.log(`健康状态: ${health.ok ? '在线' : '离线'} (${health.url})`);
    if (health.lastHeartbeat) console.log(`最近心跳: ${health.lastHeartbeat}`);
  }
  process.exitCode = health.ok ? 0 : 1;
}

async function start() {
  // Keep the process manager in one place so the same command works from the
  // npm-installed standalone bundle and from a source checkout.
  await import('./start-ziwei-user.mjs');
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForDaemonExit(config, pid) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const health = await probeLocal(config);
    const observedPid = Number(health.liveness?.pid || health.pid || 0);
    let alive = true; try { process.kill(pid, 0); } catch (error) { alive = error.code !== 'ESRCH'; }
    if (!alive && observedPid !== pid) return true;
    await wait(100);
  }
  return false;
}

async function change() {
  const current = readConfig();
  if (!current) throw new Error('change 需要先运行 ziwei_user connect，当前没有本机配置');
  const config = current.value;
  if (config.connectionState === 'disconnected') throw new Error('ziwei_user 已断开；请使用 connect 重新配对，不会恢复旧工作区');
  const health = await probeLocal(config);
  const live = health.liveness || {};
  const liveService = String(live.service || health.service || '').trim();
  const livePid = Number(live.pid || health.pid || 0);

  if (liveService && liveService !== 'ziwei_user') {
    throw new Error(`端口 ${config.healthPort || 20242} 已被其他服务占用，未停止该服务`);
  }
  if (liveService === 'ziwei_user' && health.ok && String(live.workspace || '') === String(config.workspace || '')) {
    if (clientBuildMismatch(live, VERSION, clientBuildIdentity(ROOT))) return start();
    console.log(`ziwei_user 已是当前工作区：${config.workspace}`);
    return;
  }
  if (liveService === 'ziwei_user' && livePid > 0 && livePid !== process.pid) {
    try {
      process.kill(livePid, 'SIGTERM');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw new Error(`无法停止旧 ziwei_user 进程（PID ${livePid}）：${error.message}`);
    }
    if (!await waitForDaemonExit(config, livePid)) {
      throw new Error(`旧 ziwei_user 进程（PID ${livePid}）未在 5 秒内退出，请手动结束后重试`);
    }
    console.log(`已停止旧 ziwei_user（PID ${livePid}）`);
  } else if (liveService === 'ziwei_user' && (live.ok || health.processAlive)) {
    throw new Error(`检测到 ziwei_user 正在运行，但没有可安全停止的 PID；请手动释放端口 ${config.healthPort || 20242}`);
  }

  console.log(`正在切换到工作区：${config.workspace}`);
  return start();
}

async function forget(args) {
  rejectSecrets(args);
  const current = readConfig(); const config = current?.value || {};
  const file = current?.file || configPath();
  function report(extra = {}) {
    const result = { connectionState: 'disconnected', connectionCount: 0, config: file, runtimePreserved: true, ...extra };
    console.log(args.json ? JSON.stringify(result) : 'ziwei_user 已断开全部工作区（0 个连接）；本机 runtime、Creator 记忆、CLI 与认证均保留。');
  }
  if (current && fs.lstatSync(file).isSymbolicLink()) throw new Error('本机配置为链接；拒绝清除连接');
  const alreadyDisconnected = config.connectionState === 'disconnected';
  const previousCleanup = alreadyDisconnected ? config.connectionCleanup : null;
  if (previousCleanup && (previousCleanup.version !== 1 || !Array.isArray(previousCleanup.identities) || !Array.isArray(previousCleanup.credentialFiles))) throw new Error('断开清理记录无效；未报告完成或停止进程');
  const identityConfig = previousCleanup ? { ...config, ...previousCleanup.identities[0], sharedWorkspaces: [...previousCleanup.identities.slice(1), ...previousCleanup.credentialFiles.map(item => ({ deviceTokenFile: item.file }))] } : config;
  const credentialOptions = { configPath: file, root: ROOT, dataDirectory: resolveDaemonDataDirectory({ root: ROOT, env: process.env }) };
  const credentials = connectionCredentialFiles(identityConfig, credentialOptions);
  for (const credential of credentials) {
    const recorded = previousCleanup?.credentialFiles.find(item => item.file === credential.file);
    if (recorded && recorded.sha256 !== credential.sha256) throw new Error('残余连接凭据已变化；未删除或报告断开清理完成');
  }
  const previousHash = current ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;
  const expectedPid = args['expected-pid'] === undefined ? null : Number(args['expected-pid']);
  if (expectedPid !== null && (!Number.isSafeInteger(expectedPid) || expectedPid <= 0 || expectedPid === process.pid)) throw new Error('--expected-pid 必须是待断开的原生 daemon PID');
  const host = config.healthHost || '127.0.0.1';
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('forget 仅接受本机 loopback 健康入口');
  const health = await probeLocal(identityConfig); const live = health.liveness || {};
  let pid = null, paused = false;
  async function control(operation) {
    const response = await fetch(`http://${host === '::1' ? '[::1]' : host}:${config.healthPort || 20242}/local/connection-control`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ziwei-local-control': config.deviceToken || '' }, body: JSON.stringify({ operation }), signal: AbortSignal.timeout(3000), redirect: 'error' });
    if (!response.ok) throw new Error('当前 daemon 尚不支持安全断开；请沿原安装入口更新/start 后重试，未停止进程');
    const body = await response.json();
    if (body.pid !== pid || body.service !== 'ziwei_user') throw new Error('断开控制响应 PID 身份不一致');
    return body;
  }
  try {
    if (live.service && live.service !== 'ziwei_user') throw new Error('健康端口由其他项目占用；未停止或修改该服务');
    if (live.service === 'ziwei_user') {
      pid = Number(live.pid);
      if (live.workspace !== identityConfig.workspace || live.deviceId !== identityConfig.deviceId || (expectedPid !== null && pid !== expectedPid) || !isNativeDaemonProcess(pid, ROOT)) throw new Error('原生 daemon 工作区、设备、PID 或安装入口不匹配；未停止进程');
      if (alreadyDisconnected) {
        if (previousCleanup?.state !== 'pending' || previousCleanup.stoppedPid !== pid || live.connectionState !== 'draining') throw new Error('断开配置仍有未核实的旧 listener；未停止或报告清理完成');
      } else { await control('pause'); paused = true; }
      const deadline = Date.now() + 30_000;
      let idle = false;
      while (Date.now() < deadline) {
        const observed = (await probeLocal(identityConfig)).liveness || {};
        if (observed.pid !== pid || observed.workspace !== identityConfig.workspace || observed.deviceId !== identityConfig.deviceId) throw new Error('等待断开时 daemon 身份变化；未停止其他进程');
        if (observed.connectionState === 'draining' && observed.activeActionCount === 0 && observed.pollingCount === 0) { idle = true; break; }
        await wait(100);
      }
      if (!idle) throw new Error('在途任务尚未结束；连接已恢复，未停止 daemon，请等待任务终态后重试');
      if (!isNativeDaemonProcess(pid, ROOT)) throw new Error('停止前原生进程身份已变化；未发送信号');
    } else if (expectedPid !== null) {
      let alive = true; try { process.kill(expectedPid, 0); } catch (error) { alive = error.code !== 'ESRCH'; }
      if (alive) throw new Error('指定 PID 仍存活但无法核实健康身份；未停止进程或清除连接');
    }
    if (current && createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== previousHash) throw new Error('有效配置已变化；未清除新连接');
    for (const credential of credentials) if (createHash('sha256').update(fs.readFileSync(credential.file)).digest('hex') !== credential.sha256) throw new Error('连接凭据已变化；请重新核实备份后断开');
    if (alreadyDisconnected && !pid && !credentials.length && (!previousCleanup || previousCleanup.state === 'complete')) { report({ alreadyDisconnected: true, credentialFilesRemoved: 0 }); return; }
    const cleanup = { version: 1, state: 'pending', identities: previousCleanup?.identities || [config, ...(config.sharedWorkspaces || [])].map(({ workspace, deviceId }) => ({ workspace, deviceId })), credentialFiles: [...new Map([...(previousCleanup?.credentialFiles || []), ...credentials].map(item => [item.file, item])).values()], stoppedPid: pid ?? previousCleanup?.stoppedPid ?? null };
    const pending = { ...disconnectedConfiguration(config), connectionCleanup: cleanup };
    writeConfig(pending);
    const pendingHash = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (pid !== null) {
      process.kill(pid, 'SIGTERM'); paused = false;
      if (!await waitForDaemonExit(identityConfig, pid)) throw new Error('断开配置已保存但原 PID 未退出；清理仍pending，未启动或停止其他进程');
    }
    let removed = 0;
    if (createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== pendingHash) throw new Error('断开等待期间配置已被显式修改；未清除新连接或报告完成');
    const finalCredentials = connectionCredentialFiles(identityConfig, credentialOptions);
    for (const credential of credentials) {
      if (!finalCredentials.some(item => item.file === credential.file && item.sha256 === credential.sha256)) throw new Error('停止后连接凭据路径或内容变化；清理仍pending');
      fs.unlinkSync(credential.file); removed++;
    }
    if (connectionCredentialFiles(identityConfig, credentialOptions).length) throw new Error('断开期间新增本机管理凭据；清理仍pending，请重试 forget，不会恢复连接');
    if (createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== pendingHash) throw new Error('清理期间配置被显式修改；未覆盖新配置或报告完成');
    writeConfig({ ...pending, connectionCleanup: { ...cleanup, state: 'complete', completedAt: new Date().toISOString() } });
    const logDir = path.join(path.dirname(file), 'logs'); fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'daemon.log'), JSON.stringify({ at: new Date().toISOString(), event: 'connections_forgotten', pid: process.pid, stoppedPid: pid, connectionCount: 0, credentialFilesRemoved: removed, runtimePreserved: true }) + '\n', { mode: 0o600 });
    report({ stoppedPid: pid, credentialFilesRemoved: removed });
  } catch (error) {
    if (paused) { let saved; try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {} if (saved?.connectionState !== 'disconnected') await control('resume').catch(() => {}); }
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'help';
  if (command === 'version' || command === '--version' || command === '-v' || args.version === true || args.v === true) {
    console.log(`ziwei_user ${VERSION}`);
    return;
  }
  if (command === 'setup') return setup(args);
  if (command === 'connect') return connect(args);
  if (command === 'start') return start();
  if (command === 'stop') {
    rejectSecrets(args);
    const { stopClient } = await import('./client-lifecycle.mjs');
    const result = await stopClient({ root: ROOT, env: process.env, ...(args['expected-pid'] ? { expectedPid: Number(args['expected-pid']) } : {}) });
    console.log(args.json ? JSON.stringify(result) : result.alreadyStopped ? 'ziwei_user 已停止；连接配置、身份和用户数据保留。' : `ziwei_user 已停止（PID ${result.pid}）；使用 start 可恢复原连接。`);
    return;
  }
  if (command === 'update') {
    rejectSecrets(args);
    const { launchClientUpdate } = await import('./client-update.mjs');
    const result = await launchClientUpdate({ codeRoot: ROOT, root: args.target ? path.resolve(String(args.target)) : ROOT, args, env: process.env });
    console.log(args.json ? JSON.stringify(result) : `Windows 升级任务已提交，CLI 退出后开始。请运行 ziwei_user update-status 查看真实完成结果。\n维护日志: ${result.logFile}`);
    return;
  }
  if (command === 'update-status') {
    const { readUpdateResult } = await import('./client-update.mjs');
    const result = readUpdateResult({ env: process.env });
    console.log(args.json ? JSON.stringify(result) : JSON.stringify(result, null, 2));
    if (result.state === 'failed') process.exitCode = 1;
    return;
  }
  if (command === 'uninstall' || command === 'remove') {
    rejectSecrets(args);
    const { launchClientUninstall } = await import('./client-lifecycle.mjs');
    const result = await launchClientUninstall({ root: ROOT, env: process.env });
    console.log(args.json ? JSON.stringify(result) : `Windows 卸载任务已提交，CLI 退出后开始；用户配置、认证、工作目录和 Creator 记忆保留。\n维护结果: ${result.resultFile}`);
    return;
  }
  if (command === 'change') return change();
  if (command === 'forget' || command === 'reset') return forget(args);
  if (command === 'status') return status(args);
  if (command === 'help' || command === '--help' || command === '-h') return usage();
  throw new Error(`未知命令: ${command}`);
}

main().catch(error => {
  console.error(`ziwei_user: ${error.message}`);
  process.exitCode = 1;
});
