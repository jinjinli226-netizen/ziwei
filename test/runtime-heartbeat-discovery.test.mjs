import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

test('periodic daemon heartbeat reuses actual CLI discovery without repeating a cold version command', { skip: process.platform !== 'win32', timeout: 20000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-heartbeat-discovery-'));
  const bin = path.join(directory, 'bin');
  fs.mkdirSync(bin);
  const trace = path.join(directory, 'version-count.txt');
  const probe = path.join(bin, 'gemini-version.mjs');
  fs.writeFileSync(probe, `import fs from 'node:fs';\nif(process.argv.slice(2).join(' ')!=='--version')process.exit(71);\nfs.appendFileSync(${JSON.stringify(trace)},'version\\n');\nsetTimeout(()=>console.log('0.51.0'),300);\n`);
  fs.writeFileSync(path.join(bin, 'gemini.cmd'), `@echo off\r\n"${process.execPath}" "${probe}" %*\r\n`);
  const heartbeats = [];
  const backend = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (req.url.endsWith('/heartbeat')) heartbeats.push(JSON.parse(body));
      // This fixture deliberately cannot issue a credential or business action.
      res.writeHead(req.url.endsWith('/mcp/bootstrap') ? 503 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(req.url.startsWith('/a2a/') ? { actions: [] } : { ok: !req.url.endsWith('/mcp/bootstrap') }));
    });
  });
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  const reserve = http.createServer();
  await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const port = reserve.address().port;
  await new Promise(resolve => reserve.close(resolve));
  const config = path.join(directory, 'ziwei_user.json');
  fs.writeFileSync(config, JSON.stringify({ workspace: 'fixture', deviceId: 'device_fixture', deviceToken: 'fixture-device-credential', apiBase: `http://127.0.0.1:${backend.address().port}`, healthHost: '127.0.0.1', healthPort: port, heartbeatMs: 1000, pollMs: 1000, workdir: directory }));
  const env = { ...process.env, ZIWEI_CONFIG: config, ZIWEI_USER_HOME: directory };
  const inheritedPath = Object.entries(env).find(([key]) => /^path$/i.test(key))?.[1] || '';
  for (const key of Object.keys(env)) if (/^path$/i.test(key)) delete env[key];
  env.PATH = `${bin};${inheritedPath}`;
  const daemon = spawn(process.execPath, [path.join(root, 'daemon/ziwei_user.mjs')], { env, windowsHide: true, stdio: 'ignore' });
  t.after(async () => {
    if (daemon.exitCode === null) {
      const exited = new Promise(resolve => daemon.once('exit', resolve));
      daemon.kill('SIGTERM');
      await exited;
    }
    await new Promise(resolve => backend.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const deadline = Date.now() + 16000;
  while (heartbeats.length < 3 && Date.now() < deadline && daemon.exitCode === null) await new Promise(resolve => setTimeout(resolve, 40));
  assert.ok(heartbeats.length >= 3, 'Real daemon must publish multiple periodic heartbeats');
  assert.equal(heartbeats[0].runtimes.Gemini.binary, path.join(bin, 'gemini.cmd'), 'The counted version command must be the actual discovered CLI');
  assert.equal(fs.readFileSync(trace, 'utf8').trim().split('\n').length, 1, 'Periodic heartbeats must not force a cold version process');
  const initial = heartbeats[0].runtimes.Gemini.detection.checkedAt;
  for (const body of heartbeats.slice(1)) assert.equal(body.runtimes.Gemini.detection.checkedAt, initial, 'A heartbeat cannot forge a new discovery timestamp');
  const started = Date.now();
  const health = await (await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(1000) })).json();
  assert.equal(health.service, 'ziwei_user');
  assert.ok(Date.now() - started < 1000, 'Warm periodic heartbeat must leave local health responsive');
});
