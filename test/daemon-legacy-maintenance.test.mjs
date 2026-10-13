import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

for (const updatedAt of [undefined, '2026-10-12T00:00:00.000Z']) {
  test(`real isolated daemon drains and stops with retained V1 and migrated legacy history (updatedAt ${updatedAt ? 'present' : 'absent'})`, {timeout: 15000}, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-legacy-maintenance-'));
    const home = path.join(root, 'user'); let child; const calls = [];
    const server = http.createServer((req, res) => {
      calls.push(req.url); let body = {ok: true};
      if (req.url.endsWith('/mcp/bootstrap')) {
        const workspace = req.url.split('/')[3];
        body = {token: 'isolated-management-fixture', workspace, deviceId: `device_${workspace}`, credentialId: `fixture_${workspace}`, expiresAt: new Date(Date.now() + 3600000).toISOString(), apiBase: `http://127.0.0.1:${server.address().port}`, audience: 'ziwei-management', managed: true};
      } else if (req.url.startsWith('/a2a/v1/actions?')) body = {actions: []};
      res.writeHead(200, {'content-type': 'application/json'}); res.end(JSON.stringify(body));
    });
    t.after(async () => {
      if (child && child.exitCode === null) {
        const exited = new Promise(resolve => child.once('exit', resolve)); child.kill();
        await Promise.race([exited, delay(1000)]);
        if (child.exitCode === null) {child.kill('SIGKILL'); await exited;}
      }
      if (server.listening) {server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}
      assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert(path.basename(root).startsWith('ziwei-legacy-maintenance-'));
      fs.rmSync(root, {recursive: true, force: true});
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const probe = http.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
    const configPath = path.join(root, 'config.json'), tokenFile = path.join(root, 'shared.json'), apiBase = `http://127.0.0.1:${server.address().port}`;
    fs.writeFileSync(tokenFile, JSON.stringify({workspace: 'shared', deviceId: 'device_shared', deviceToken: 'isolated-shared-token'}));
    const config = JSON.stringify({workspace: 'primary', deviceId: 'device_primary', deviceToken: 'isolated-primary-token', apiBase, workdir: root, healthHost: '127.0.0.1', healthPort: port, heartbeatMs: 1000, pollMs: 1000, sharedWorkspaces: [{workspace: 'shared', deviceId: 'device_shared', deviceTokenFile: tokenFile, apiBase}]});
    fs.writeFileSync(configPath, config);
    const legacy = {key: 'retained-dedupe', result: {status: 'succeeded', actionId: 'retained-action', result: {output: 'isolated-old-history'}, completedAt: 1}};
    const states = [
      [path.join(home, 'runtime', 'action-state.json'), JSON.stringify({version: 1, ...(updatedAt ? {updatedAt} : {}), completed: [legacy]})],
      [path.join(home, 'runtime', 'shared-workspaces', 'shared', 'device_shared', 'action-state.json'), JSON.stringify({version: 2, started: [], completed: [{...legacy, legacy: true}]})]
    ];
    for (const [file, contents] of states) {fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, contents);}
    const systemRoot = process.env.SystemRoot || 'C:\\Windows';
    const env = {SystemRoot: systemRoot, WINDIR: systemRoot, PATH: path.join(systemRoot, 'System32'), PATHEXT: '.COM;.EXE;.BAT;.CMD', USERPROFILE: root, HOME: root, APPDATA: path.join(root, 'AppData/Roaming'), LOCALAPPDATA: path.join(root, 'AppData/Local'), TEMP: root, TMP: root, ZIWEI_CONFIG: configPath, ZIWEI_USER_HOME: home};
    child = spawn(process.execPath, [fileURLToPath(new URL('../daemon/ziwei_user.mjs', import.meta.url))], {cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({code, signal})));
    let diagnostics = ''; child.stdout.on('data', data => {diagnostics += data;}); child.stderr.on('data', data => {diagnostics += data;});
    const healthUrl = `http://127.0.0.1:${port}/healthz`; let health;
    for (let i = 0; i < 100; i++) {
      try {health = await (await fetch(healthUrl)).json();} catch {}
      if (health?.lastHeartbeat && calls.filter(url => url.startsWith('/a2a/v1/actions?')).length >= 2) break;
      await delay(50);
    }
    assert.equal(health?.pid, child.pid, diagnostics); assert.equal(health.executionQuarantined, false);
    const control = (operation, nonce = health.lifecycle.nonce) => fetch(`http://127.0.0.1:${port}/local/connection-control`, {method: 'POST', headers: {'content-type': 'application/json', 'x-ziwei-local-control': 'isolated-primary-token'}, body: JSON.stringify({operation, nonce})});
    assert.equal((await control('pause')).status, 200);
    for (let i = 0; i < 100; i++) {health = await (await fetch(healthUrl)).json(); if (!health.pollingCount) break; await delay(25);}
    assert.equal(health.activeActionCount, 0); assert.equal(health.pollingCount, 0);
    assert.equal(health.maintenance.safe, true, JSON.stringify(health.maintenance.fileIssues));
    assert.equal((await control('stop', 'wrong-original-boot')).status, 409);
    assert.equal((await control('stop')).status, 200);
    assert.deepEqual(await Promise.race([exited, delay(3000).then(() => ({timeout: true}))]), {code: 0, signal: null});
    for (const [file, contents] of states) assert.equal(fs.readFileSync(file, 'utf8'), contents);
    assert.equal(fs.readFileSync(configPath, 'utf8'), config); assert.equal(calls.some(url => url.endsWith('/ack') || url.endsWith('/result')), false);
  });
}
