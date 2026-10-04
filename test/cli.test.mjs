import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { defaultUserDir, resolveConfigPath } from '../daemon/config.mjs';

const run = promisify(execFile);
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const cli = path.join(root, 'scripts', 'ziwei-cli.mjs');

test('ziwei_user CLI writes a token-free local configuration', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-cli-'));
  const config = path.join(temp, 'config.json');
  const env = { ...process.env, ZIWEI_CONFIG: config };
  const { stdout } = await run(process.execPath, [cli, 'setup', '--workspace', 'demo', '--api', 'http://127.0.0.1:4178/?token=do-not-store', '--health-port', '20243'], { cwd: root, env });
  const saved = JSON.parse(fs.readFileSync(config, 'utf8'));
  assert.equal(saved.workspace, 'demo');
  assert.equal(saved.apiBase, 'http://127.0.0.1:4178');
  assert.equal(saved.healthPort, 20243);
  assert.equal(Object.hasOwn(saved, 'token'), false);
  assert.match(stdout, /ziwei_user 已配置/);
  assert.doesNotMatch(stdout, /do-not-store/);
});

test('ziwei_user CLI persists and validates the pinned TLS CA file', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-cli-tls-'));
  const config = path.join(temp, 'config.json');
  const caFile = path.join(temp, 'server.crt');
  fs.writeFileSync(caFile, 'test certificate\n');
  const env = { ...process.env, ZIWEI_CONFIG: config };
  const { stdout } = await run(process.execPath, [
    cli,
    'setup',
    '--workspace',
    'secure-demo',
    '--api',
    'https://example.test',
    '--tls-ca-file',
    caFile,
  ], { cwd: root, env });
  const saved = JSON.parse(fs.readFileSync(config, 'utf8'));
  assert.equal(saved.tlsCaFile, path.normalize(caFile));
  assert.match(stdout, /TLS CA:/);

  await assert.rejects(
    run(process.execPath, [cli, 'setup', '--tls-ca-file', path.join(temp, 'missing.crt')], { cwd: root, env }),
    /--tls-ca-file 指向的文件不存在/,
  );
});

test('ziwei_user CLI reports its version', async () => {
  const { stdout } = await run(process.execPath, [cli, 'version'], { cwd: root });
  assert.match(stdout.trim(), /^ziwei_user \d+\.\d+\.\d+$/);
});

test('ziwei_user CLI exchanges a pairing code without requiring the project database', async t => {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/api/daemon/pair') return res.writeHead(404).end();
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      assert.equal(JSON.parse(body).code, 'zwi-demo-code');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ apiBase: 'http://127.0.0.1:4178', workspace: 'demo', deviceId: 'device_remote', deviceToken: 'zwd_secret-device-token', agentId: 'ziwei_user', serviceName: 'ziwei_user' }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-cli-connect-'));
  const config = path.join(temp, 'config.json');
  const env = { ...process.env, ZIWEI_CONFIG: config };
  const { stdout } = await run(process.execPath, [cli, 'connect', '--api', `http://127.0.0.1:${server.address().port}`, '--code', 'zwi-demo-code'], { cwd: root, env });
  const saved = JSON.parse(fs.readFileSync(config, 'utf8'));
  assert.equal(saved.workspace, 'demo');
  assert.equal(saved.deviceId, 'device_remote');
  assert.equal(saved.deviceToken, 'zwd_secret-device-token');
  assert.equal(saved.workdir, root);
  assert.doesNotMatch(stdout, /zwd_secret-device-token/);
  assert.match(stdout, /设备已连接/);
});

test('standalone daemon config resolves to the user directory without changing project mode', () => {
  const root = 'C:\\ziwei-bundle';
  assert.equal(resolveConfigPath({ root, env: { ZIWEI_USER_HOME: 'C:\\Users\\demo\\AppData\\Local\\Ziwei' } }), 'C:\\Users\\demo\\AppData\\Local\\Ziwei\\ziwei_user.json');
  assert.equal(resolveConfigPath({ root, env: {} }), 'C:\\ziwei-bundle\\data\\ziwei_user.json');
  assert.match(defaultUserDir({ platform: 'linux', home: '/home/demo', env: {} }), /\.local[\\/]state[\\/]ziwei_user$/);
});
