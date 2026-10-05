#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveConfigPath } from '../daemon/config.mjs';

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
  const expectedWorkspace = String(config.workspace || process.env.ZIWEI_WORKSPACE || 'test-111');
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
  const workspace = String(args.workspace || previous.workspace || 'test-111').trim();
  if (!workspace) throw new Error('--workspace 不能为空');
  const healthPort = args['health-port'] !== undefined
    ? parsePort(args['health-port'])
    : parsePort(previous.healthPort || 20242);
  const tlsCaFile = args['tls-ca-file'] !== undefined
    ? cleanTlsCaFile(args['tls-ca-file'])
    : (previous.tlsCaFile ? String(previous.tlsCaFile) : undefined);
  return {
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
  const file = writeConfig(config);
  console.log(`设备已连接：${config.workspace}`);
  console.log(`设备 ID：${config.deviceId}`);
  console.log(`配置文件：${file}`);
  console.log('下一步：启动 ziwei_user daemon，然后在网页刷新设备状态。');
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
  if (command === 'status') return status(args);
  if (command === 'help' || command === '--help' || command === '-h') return usage();
  throw new Error(`未知命令: ${command}`);
}

main().catch(error => {
  console.error(`ziwei_user: ${error.message}`);
  process.exitCode = 1;
});
