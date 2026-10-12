import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

test('real isolated daemon retains recovered quarantine across workspaces, reports unready and refuses drained stop', { timeout: 15000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-quarantine-health-'));
  const home = path.join(root, 'user'); const calls = []; let child;
  const server = http.createServer((req, res) => {
    calls.push(req.url);
    let body = { ok: true };
    if (req.url.endsWith('/mcp/bootstrap')) {
      const workspace = req.url.split('/')[3];
      body = { token: 'isolated-management-fixture', workspace, deviceId: `device_${workspace}`, credentialId: `fixture_${workspace}`, expiresAt: new Date(Date.now() + 3600000).toISOString(), apiBase: `http://127.0.0.1:${server.address().port}`, audience: 'ziwei-management', managed: true };
    } else if (req.url.startsWith('/a2a/v1/actions?')) {
      const workspace = new URL(req.url, 'http://fixture').searchParams.get('workspace');
      body = { actions: [{ id: `blocked_${workspace}`, workspace, type: 'directory.inspect', payload: { path: root, deviceId: `device_${workspace}` } }] };
    }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body));
  });
  t.after(async () => {
    if (child && child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve)); child.kill();
      await Promise.race([exited, delay(1000)]);
      if (child.exitCode === null) { child.kill('SIGKILL'); await exited; }
    }
    if (server.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert(path.basename(root).startsWith('ziwei-quarantine-health-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const probe = http.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const configPath = path.join(root, 'config.json'); const tokenFile = path.join(root, 'shared.json');
  const apiBase = `http://127.0.0.1:${server.address().port}`;
  fs.writeFileSync(tokenFile, JSON.stringify({ workspace: 'shared', deviceId: 'device_shared', deviceToken: 'isolated-shared-token' }));
  const config = JSON.stringify({ workspace: 'primary', deviceId: 'device_primary', deviceToken: 'isolated-primary-token', apiBase, workdir: root, healthHost: '127.0.0.1', healthPort: port, heartbeatMs: 1000, pollMs: 1000, sharedWorkspaces: [{ workspace: 'shared', deviceId: 'device_shared', deviceTokenFile: tokenFile, apiBase }] });
  fs.writeFileSync(configPath, config);
  fs.mkdirSync(path.join(home, 'runtime'), { recursive: true });
  const stateFile = path.join(home, 'runtime', 'action-state.json');
  const originalState = JSON.stringify({ version: 2, completed: [], started: [{ key: 'unfinished', actionId: 'unfinished', identity: { workspace: 'primary', deviceId: 'device_primary' }, startedAt: Date.now() - 1000, nativeRuntime: true, quarantine: { reason: 'STOP_UNCONFIRMED', recordedAt: Date.now(), stopConfirmed: false } }] });
  fs.writeFileSync(stateFile, originalState);
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const env = { SystemRoot: systemRoot, WINDIR: systemRoot, PATH: path.join(systemRoot, 'System32'), PATHEXT: '.COM;.EXE;.BAT;.CMD', USERPROFILE: root, HOME: root, APPDATA: path.join(root, 'AppData/Roaming'), LOCALAPPDATA: path.join(root, 'AppData/Local'), TEMP: root, TMP: root, ZIWEI_CONFIG: configPath, ZIWEI_USER_HOME: home };
  child = spawn(process.execPath, [fileURLToPath(new URL('../daemon/ziwei_user.mjs', import.meta.url))], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let diagnostics = ''; child.stdout.on('data', value => { diagnostics += value; }); child.stderr.on('data', value => { diagnostics += value; });
  let health;
  for (let index = 0; index < 100; index++) {
    try { health = await (await fetch(`http://127.0.0.1:${port}/healthz`)).json(); } catch {}
    if (health?.lastHeartbeat && calls.filter(url => url.startsWith('/a2a/v1/actions?')).length >= 4) break;
    await delay(50);
  }
  assert.equal(health?.pid, child.pid, diagnostics);
  assert.equal(health.executionQuarantined, true); assert.equal(health.quarantinedActionCount, 1); assert.equal(health.activeActionCount, 1);
  assert.equal(health.connectionState, 'quarantined'); assert.equal(health.connections.length, 2);
  assert(health.connections.every(item => item.ready === false));
  assert(calls.includes('/api/workspaces/primary/heartbeat')); assert(calls.includes('/api/workspaces/shared/heartbeat'));
  assert.equal(calls.some(url => url.endsWith('/ack')), false);
  const ready = await fetch(`http://127.0.0.1:${port}/readyz`); assert.equal(ready.status, 503); assert.equal((await ready.json()).ready, false);
  const control = operation => fetch(`http://127.0.0.1:${port}/local/connection-control`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ziwei-local-control': 'isolated-primary-token' }, body: JSON.stringify({ operation, nonce: health.lifecycle.nonce }) });
  assert.equal((await control('pause')).status, 200);
  assert.equal((await control('stop')).status, 409);
  assert.doesNotThrow(() => process.kill(child.pid, 0));
  assert.equal((await control('resume')).status, 200);
  assert.equal(fs.readFileSync(stateFile, 'utf8'), originalState); assert.equal(fs.readFileSync(configPath, 'utf8'), config);
});
