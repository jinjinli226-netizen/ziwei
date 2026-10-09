#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveConfigFile, resolveConfigPath, isNativeDaemonProcess } from '../daemon/config.mjs';
import { clientBuildIdentity, clientBuildMismatch } from '../src/management-bootstrap.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const VERSION = process.env.ZIWEI_USER_VERSION || JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const CLIENT_BUILD = clientBuildIdentity(ROOT);
const configPath = resolveConfigPath({ root: ROOT, env: process.env });
let config = {};
let configError = null;
try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (error) {
  if (fs.existsSync(configPath)) configError = error;
}
const host = config.healthHost || process.env.ZIWEI_HEALTH_HOST || '127.0.0.1';
const port = Number(config.healthPort || process.env.ZIWEI_HEALTH_PORT || 20242);
const expectedWorkspace = String(config.workspace || process.env.ZIWEI_WORKSPACE || '').trim();
const expectedAgent = String(config.agentId || 'ziwei_user');
const healthUrl = `http://${host}:${port}/healthz`;
const readyUrl = `http://${host}:${port}/readyz`;

async function probe(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
    const body = await response.json().catch(() => ({}));
    // Older daemons did not expose identity on /readyz.  Accept omitted
    // fields for upgrade compatibility, while rejecting an explicit mismatch.
    const identityOk = body.service === 'ziwei_user'
      && (!body.agentId || body.agentId === expectedAgent)
      && (!body.workspace || body.workspace === expectedWorkspace)
      && (!body.deviceId || !config.deviceId || body.deviceId === config.deviceId);
    return { ok: response.ok && identityOk, identityOk, body, status: response.status };
  } catch (error) { return { ok: false, body: {}, error: error?.message || String(error) }; }
}

async function probeReady() {
  const result = await probe(readyUrl);
  return { ...result, ok: result.ok && result.body.ready === true };
}

function childEnvironment() {
  const env = { ...process.env };
  const configuredCa = config.tlsCaFile || process.env.ZIWEI_TLS_CA_FILE;
  if (!configuredCa) return env;
  const caFile = resolveConfigFile(configuredCa, { configPath, root: ROOT });
  if (!fs.existsSync(caFile)) {
    throw new Error(`TLS CA 文件不存在：${caFile}`);
  }
  // NODE_EXTRA_CA_CERTS is read by the child Node process at startup. Prefer
  // the pinned server certificate over the temporary insecure override.
  env.NODE_EXTRA_CA_CERTS = caFile;
  delete env.NODE_TLS_REJECT_UNAUTHORIZED;
  return env;
}

async function main() {
  if (configError) {
    console.error(`ziwei_user 配置文件无法读取：${configPath}`);
    console.error(configError?.message || String(configError));
    return 1;
  }
  const existingReady = await probeReady();
  const identity = await probe(healthUrl);
  const oldBuild = identity.ok && clientBuildMismatch(identity.body, VERSION, CLIENT_BUILD);
  if (oldBuild) {
    const pid = Number(identity.body.pid);
    if (!isNativeDaemonProcess(pid, ROOT)) {
      console.error('已运行旧版本 ziwei_user，但无法核实当前安装目录的进程身份；未停止进程，请使用原安装入口完成客户端更新。');
      return 1;
    }
    // Recheck immediately before signalling, without trusting a stale port/PID observation.
    const current = await probe(healthUrl);
    if (!current.ok || Number(current.body.pid) !== pid) { console.error('ziwei_user 进程身份已变化，未执行升级刷新。'); return 1; }
    process.kill(pid, 'SIGTERM');
    console.log(`已停止旧版本 ziwei_user（PID ${pid}），沿原生入口加载当前安装代码。`);
    let exited = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      let alive = true;
      try { process.kill(pid, 0); } catch (error) { alive = error.code !== 'ESRCH'; }
      if (!alive && !(await probe(healthUrl)).ok) { exited = true; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!exited) { console.error('旧 ziwei_user 未退出，未启动第二实例。'); return 1; }
  } else if (existingReady.ok) {
    if (identity.body?.service === 'ziwei_user' && identity.identityOk === false) {
      console.error(`端口 ${port} 已连接到其他 ziwei_user 工作区，未启动当前配置。`);
      return 1;
    }
    console.log(`ziwei_user 已就绪 (${readyUrl})`);
    return 0;
  }

  // A live but unready daemon is normally waiting for the backend to recover.
  // Do not launch a second process, which would race for the same health port.
  const existing = await probe(healthUrl);
  if (existing.ok) {
    console.error(`ziwei_user 进程在线但尚未接入工作区，请检查后端和配置：${readyUrl}`);
    return 1;
  }
  if (existing.body?.service === 'ziwei_user' && existing.identityOk === false) {
    console.error(`端口 ${port} 已连接到其他 ziwei_user 工作区，未启动当前配置。`);
    return 1;
  }

  // Launch the daemon entrypoint directly.  Spawning npm.cmd with detached=true
  // raises EINVAL on some Windows installations and leaves the UI disconnected.
  // Using the current Node executable also avoids an extra npm shim process.
  const child = spawn(process.execPath, [path.join(ROOT, 'daemon', 'ziwei_user.mjs')], { cwd: ROOT, env: childEnvironment(), detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  console.log(`已启动 ziwei_user（PID ${child.pid || '后台进程'}），等待首次心跳...`);

  for (let attempt = 0; attempt < 15; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const ready = await probeReady();
    if (ready.ok) {
      if (Number(ready.body.pid) !== child.pid || ready.body.clientBuild !== CLIENT_BUILD) {
        console.error('ziwei_user 接口响应就绪，但 PID 或实际运行代码 build 不匹配；未报告客户端升级成功，请查看用户目录诊断日志。');
        return 1;
      }
      console.log(`ziwei_user 已就绪 (${readyUrl})`);
      return 0;
    }
  }

  console.error(`ziwei_user 未能在 15 秒内就绪，请查看 .local/logs/daemon.log：${readyUrl}`);
  return 1;
}

main().then(code => { process.exitCode = code; }).catch(error => {
  console.error(`ziwei_user 启动失败：${error?.message || String(error)}`);
  process.exitCode = 1;
});
