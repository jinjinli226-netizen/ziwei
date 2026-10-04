import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createApp } from '../backend/app.mjs';
import { createRepository } from '../backend/repository.mjs';
import { execFile } from 'node:child_process';

const exec = promisify(execFile);
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const cli = path.join(root, 'scripts', 'ziwei-cli.mjs');
const daemon = path.join(root, 'daemon', 'ziwei_user.mjs');

function listen(server) {
  return new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
}

async function waitForDevice(repo, deviceName, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const device = repo.listDevices('test-111').find(item => item.name === deviceName);
    if (device?.status === 'online') return device;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return repo.listDevices('test-111').find(item => item.name === deviceName) || null;
}

test('paired ziwei_user daemon sends a real heartbeat and four-runtime discovery to the API', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-daemon-link-'));
  const repo = createRepository({ memory: true });
  const app = createApp({ repository: repo, requireAuth: true, requireDeviceAuth: true, enableScheduler: false });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const apiBase = `http://127.0.0.1:${server.address().port}`;
  const pairing = repo.createDevicePairing('test-111', { name: '链路验证电脑', os: process.platform });
  const healthServer = http.createServer();
  await listen(healthServer);
  const healthPort = healthServer.address().port;
  await new Promise(resolve => healthServer.close(resolve));
  const configPath = path.join(temp, 'ziwei_user.json');
  const userHome = path.join(temp, 'user-home');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({
    healthHost: '127.0.0.1', healthPort, heartbeatMs: 1000, pollMs: 1000,
    workdir: root
  }));
  const env = { ...process.env, ZIWEI_CONFIG: configPath, ZIWEI_USER_HOME: userHome };
  let child;
  let output = '';
  t.after(async () => {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 1000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
      if (child.exitCode === null && child.pid) {
        try { await exec('taskkill', ['/PID', String(child.pid), '/T', '/F']); } catch {}
      }
    }
    if (healthServer.listening) await new Promise(resolve => healthServer.close(resolve));
    if (server.listening) await new Promise(resolve => server.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  });
  try {
    await exec(process.execPath, [cli, 'connect', '--api', apiBase, '--code', pairing.code, '--name', '链路验证电脑'], { cwd: root, env });
    child = spawn(process.execPath, [daemon], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.stderr.on('data', chunk => { output += chunk.toString(); });
    child.on('exit', (code, signal) => { output += `\nchild_exit code=${code} signal=${signal}`; });
    const connected = await waitForDevice(repo, '链路验证电脑');
    assert.equal(connected?.status, 'online');
    const runtimes = repo.listRuntimes('test-111');
    assert.deepEqual(runtimes.map(item => item.name), ['Claude', 'Codex', 'Gemini', 'Hermes']);
    assert.ok(output.includes('heartbeat') || connected?.last_seen);
  } catch (error) {
    throw new Error(`${error.message}\n${output || ''}`);
  }
});
