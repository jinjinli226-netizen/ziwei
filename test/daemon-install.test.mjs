import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const cli = path.join(root, 'scripts', 'ziwei-cli.mjs');
const starter = path.join(root, 'scripts', 'start-ziwei-user.mjs');

function responseFor(state, pathname) {
  if (pathname === '/healthz') return { status: 200, body: { ok: true, service: 'ziwei_user', agentId: 'ziwei_user', workspace: 'test-111', pid: 4321 } };
  if (pathname === '/readyz') return state.ready
    ? { status: 200, body: { ready: true, service: 'ziwei_user', agentId: 'ziwei_user', workspace: 'test-111', pid: 4321 } }
    : { status: 503, body: { ready: false, service: 'ziwei_user', agentId: 'ziwei_user', workspace: 'test-111', pid: 4321 } };
  return { status: 404, body: {} };
}

test('status and installer require a fresh daemon heartbeat, not healthz alone', async t => {
  const state = { ready: false };
  const server = http.createServer((req, res) => {
    const response = responseFor(state, req.url);
    res.writeHead(response.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(response.body));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const port = server.address().port;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-daemon-install-'));
  const config = path.join(temp, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ agentId: 'ziwei_user', workspace: 'test-111', apiBase: 'http://127.0.0.1:4178', healthHost: '127.0.0.1', healthPort: port }));
  const env = { ...process.env, ZIWEI_CONFIG: config };

  await assert.rejects(
    () => run(process.execPath, [cli, 'status', '--json'], { cwd: root, env }),
    error => {
      const result = JSON.parse(error.stdout);
      assert.equal(result.health.ok, false);
      assert.equal(result.health.processAlive, true);
      assert.equal(result.health.liveness.ok, true);
      assert.equal(result.health.ready, false);
      return error.code === 1;
    }
  );

  await assert.rejects(
    () => run(process.execPath, [starter], { cwd: root, env }),
    error => error.code === 1 && /进程在线但尚未接入工作区/.test(error.stderr)
  );

  state.ready = true;
  const status = await run(process.execPath, [cli, 'status', '--json'], { cwd: root, env });
  assert.equal(JSON.parse(status.stdout).health.ok, true);
  const started = await run(process.execPath, [starter], { cwd: root, env });
  assert.match(started.stdout, /已就绪/);

  fs.writeFileSync(config, JSON.stringify({ agentId: 'ziwei_user', workspace: 'another-workspace', apiBase: 'http://127.0.0.1:4178', healthHost: '127.0.0.1', healthPort: port }));
  await assert.rejects(
    () => run(process.execPath, [cli, 'status', '--json'], { cwd: root, env }),
    error => {
      const result = JSON.parse(error.stdout);
      return result.health.ok === false && result.health.processAlive === false;
    }
  );
  await assert.rejects(
    () => run(process.execPath, [starter], { cwd: root, env }),
    error => /其他 ziwei_user 工作区/.test(error.stderr)
  );
});
