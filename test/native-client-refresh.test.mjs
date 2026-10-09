import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const run = promisify(execFile);
async function waitReady(url, predicate = () => true) {
  const end = Date.now() + 10000;
  while (Date.now() < end) { try { const body = await (await fetch(url)).json(); if (predicate(body)) return body; } catch {} await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error('Isolated refresh fixture did not become ready');
}

test('native start refreshes the exact old daemon when source changed at the same package version', { timeout: 30000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-native-refresh-'));
  for (const file of ['daemon/config.mjs', 'src/management-bootstrap.mjs', 'scripts/start-ziwei-user.mjs']) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true }); fs.copyFileSync(path.join(root, file), path.join(directory, file));
  }
  fs.writeFileSync(path.join(directory, 'package.json'), '{"type":"module","version":"0.1.0"}');
  const probe = http.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const configPath = path.join(directory, 'config.json'); fs.writeFileSync(configPath, JSON.stringify({ workspace: 'demo', deviceId: 'device_demo', healthPort: port }));
  const entry = path.join(directory, 'daemon', 'ziwei_user.mjs');
  const serve = build => `import http from 'node:http';import fs from 'node:fs';import {clientBuildIdentity} from '../src/management-bootstrap.mjs';const config=JSON.parse(fs.readFileSync(process.env.ZIWEI_CONFIG));const server=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,ready:true,service:'ziwei_user',version:'0.1.0',agentId:'ziwei_user',workspace:config.workspace,deviceId:config.deviceId,pid:process.pid,clientBuild:${build}}));});server.listen(config.healthPort,'127.0.0.1');process.on('SIGTERM',()=>server.close(()=>process.exit(0)));`;
  fs.writeFileSync(entry, serve("'old-build'"));
  const child = spawn(process.execPath, [entry], { env: { ...process.env, ZIWEI_CONFIG: configPath }, windowsHide: true, stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}/readyz`;
  t.after(async () => {
    try { const current = await (await fetch(url)).json(); if (current.pid !== process.pid) process.kill(current.pid, 'SIGTERM'); } catch {}
    try { child.kill('SIGTERM'); } catch {}
    await new Promise(resolve => setTimeout(resolve, 200)); fs.rmSync(directory, { recursive: true, force: true });
  });
  await waitReady(url); fs.writeFileSync(entry, serve(`clientBuildIdentity(${JSON.stringify(directory)})`));
  await run(process.execPath, [path.join(directory, 'scripts', 'start-ziwei-user.mjs')], { env: { ...process.env, ZIWEI_CONFIG: configPath }, windowsHide: true, timeout: 20000 });
  const current = await waitReady(url); assert.notEqual(current.pid, child.pid, 'Old ready process must not hide an upgrade');
  assert.notEqual(current.clientBuild, 'old-build'); assert.equal(current.workspace, 'demo'); assert.equal(current.deviceId, 'device_demo');
  const repeated = await run(process.execPath, [path.join(directory, 'scripts', 'start-ziwei-user.mjs')], { env: { ...process.env, ZIWEI_CONFIG: configPath }, windowsHide: true, timeout: 20000 });
  assert.match(repeated.stdout, /已就绪/); assert.equal((await waitReady(url)).pid, current.pid, 'Same build start must not restart');
});

test('native start refuses to claim readiness when the newly launched process reports the wrong build', { timeout: 20000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-native-build-'));
  for (const file of ['daemon/config.mjs', 'src/management-bootstrap.mjs', 'scripts/start-ziwei-user.mjs']) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true }); fs.copyFileSync(path.join(root, file), path.join(directory, file));
  }
  fs.writeFileSync(path.join(directory, 'package.json'), '{"type":"module","version":"0.1.0"}');
  const probe = http.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const configPath = path.join(directory, 'config.json'); fs.writeFileSync(configPath, JSON.stringify({ workspace: 'demo', deviceId: 'device_demo', healthPort: port }));
  fs.writeFileSync(path.join(directory, 'daemon', 'ziwei_user.mjs'), `import http from 'node:http';const server=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ready:true,service:'ziwei_user',agentId:'ziwei_user',workspace:'demo',deviceId:'device_demo',pid:process.pid,clientBuild:'unexpected-build'}));});server.listen(${port},'127.0.0.1');process.on('SIGTERM',()=>server.close(()=>process.exit(0)));`);
  const url = `http://127.0.0.1:${port}/readyz`;
  t.after(async () => { try { const current = await (await fetch(url)).json(); process.kill(current.pid, 'SIGTERM'); } catch {} await new Promise(resolve => setTimeout(resolve, 150)); fs.rmSync(directory, { recursive: true, force: true }); });
  await assert.rejects(() => run(process.execPath, [path.join(directory, 'scripts', 'start-ziwei-user.mjs')], { env: { ...process.env, ZIWEI_CONFIG: configPath }, windowsHide: true, timeout: 18000 }), error => error.code === 1 && /运行代码|build/.test(error.stderr));
});
