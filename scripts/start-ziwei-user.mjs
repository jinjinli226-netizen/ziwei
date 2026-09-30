#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const configPath = path.resolve(process.env.ZIWEI_CONFIG || path.join(ROOT, 'data', 'ziwei_user.json'));
let config = {};
let configError = null;
try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (error) {
  if (fs.existsSync(configPath)) configError = error;
}
const host = config.healthHost || process.env.ZIWEI_HEALTH_HOST || '127.0.0.1';
const port = Number(config.healthPort || process.env.ZIWEI_HEALTH_PORT || 20242);
const expectedWorkspace = String(config.workspace || process.env.ZIWEI_WORKSPACE || 'test-111');
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
      && (!body.workspace || body.workspace === expectedWorkspace);
    return { ok: response.ok && identityOk, identityOk, body, status: response.status };
  } catch (error) { return { ok: false, body: {}, error: error?.message || String(error) }; }
}

async function probeReady() {
  const result = await probe(readyUrl);
  return { ...result, ok: result.ok && result.body.ready === true };
}

async function main() {
  if (configError) {
    console.error(`ziwei_user 配置文件无法读取：${configPath}`);
    console.error(configError?.message || String(configError));
    return 1;
  }
  const existingReady = await probeReady();
  if (existingReady.ok) {
    const identity = await probe(healthUrl);
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
  const child = spawn(process.execPath, [path.join(ROOT, 'daemon', 'ziwei_user.mjs')], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  console.log(`已启动 ziwei_user（PID ${child.pid || '后台进程'}），等待首次心跳...`);

  for (let attempt = 0; attempt < 15; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    if ((await probeReady()).ok) {
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
