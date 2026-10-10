import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { clientBuildIdentity } from '../src/management-bootstrap.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const run = promisify(execFile);
const fixtureFiles = ['daemon/config.mjs', 'src/management-bootstrap.mjs', 'scripts/start-ziwei-user.mjs', 'scripts/client-lifecycle.mjs'];
function removeFixture(directory) {
  const resolved = path.resolve(directory);
  assert.equal(path.dirname(resolved).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
  assert.match(path.basename(resolved), /^ziwei-native-(?:refresh|build)-/);
  assert.equal(fs.lstatSync(resolved).isSymbolicLink(), false);
  fs.rmSync(resolved, { recursive: true, force: true });
}
async function waitReady(url, predicate = () => true) {
  const end = Date.now() + 10000;
  while (Date.now() < end) { try { const body = await (await fetch(url)).json(); if (predicate(body)) return body; } catch {} await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error('Isolated refresh fixture did not become ready');
}

test('native start refreshes the exact old daemon when source changed at the same package version', { timeout: 30000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-native-refresh-'));
  for (const file of fixtureFiles) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true }); fs.copyFileSync(path.join(root, file), path.join(directory, file));
  }
  fs.writeFileSync(path.join(directory, 'package.json'), '{"type":"module","version":"0.1.0"}');
  const probe = http.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const configPath = path.join(directory, 'config.json');
  const config = JSON.stringify({ workspace: 'demo', deviceId: 'device_demo', deviceToken: 'synthetic-refresh-private-token', healthHost: '127.0.0.1', healthPort: port }); fs.writeFileSync(configPath, config);
  const env = { ...process.env, ZIWEI_CONFIG: configPath, ZIWEI_USER_HOME: path.join(directory, 'userdata') };
  const entry = path.join(directory, 'daemon', 'ziwei_user.mjs');
  const operationsFile = path.join(directory, 'operations.log');
  const serve = generation => `import http from 'node:http';import fs from 'node:fs';import {clientBuildIdentity} from '../src/management-bootstrap.mjs';const config=JSON.parse(fs.readFileSync(process.env.ZIWEI_CONFIG));const CLIENT_BUILD=clientBuildIdentity(${JSON.stringify(directory)});let paused=false;const state=()=>({ok:true,ready:!paused,service:'ziwei_user',version:'0.1.0',agentId:'ziwei_user',workspace:config.workspace,deviceId:config.deviceId,pid:process.pid,clientBuild:CLIENT_BUILD,connectionState:paused?'draining':'connected',activeActionCount:0,pollingCount:0});const server=http.createServer((req,res)=>{if(req.url==='/local/connection-control'){if(req.method!=='POST'||req.headers['x-ziwei-local-control']!==config.deviceToken){res.writeHead(401);res.end();return;}let body='';req.on('data',c=>body+=c);req.on('end',()=>{const operation=JSON.parse(body).operation;if(!['pause','resume'].includes(operation)){res.writeHead(400);res.end();return;}paused=operation==='pause';fs.appendFileSync(${JSON.stringify(operationsFile)},operation+'\\n');res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(state()));});return;}res.writeHead(req.url==='/readyz'&&paused?503:200,{'content-type':'application/json'});res.end(JSON.stringify(state()));});server.listen(config.healthPort,'127.0.0.1');process.on('SIGTERM',()=>server.close(()=>process.exit(0)));\n// ${generation}\n`;
  fs.writeFileSync(entry, serve('old source generation'));
  const oldBuild = clientBuildIdentity(directory);
  const child = spawn(process.execPath, [entry], { env, windowsHide: true, stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}/readyz`;
  t.after(async () => {
    try { const current = await (await fetch(url)).json(); if (current.pid !== process.pid) process.kill(current.pid, 'SIGTERM'); } catch {}
    try { child.kill('SIGTERM'); } catch {}
    await new Promise(resolve => setTimeout(resolve, 200)); removeFixture(directory);
  });
  const old = await waitReady(url); assert.equal(old.clientBuild, oldBuild); assert.equal(old.version, '0.1.0');
  fs.writeFileSync(entry, serve('new source generation'));
  const newBuild = clientBuildIdentity(directory); assert.notEqual(newBuild, oldBuild);
  const refreshed = await run(process.execPath, [path.join(directory, 'scripts', 'start-ziwei-user.mjs')], { env, windowsHide: true, timeout: 20000 });
  const current = await waitReady(url); assert.notEqual(current.pid, child.pid, 'Old ready process must not hide an upgrade');
  assert.equal(current.clientBuild, newBuild); assert.equal(current.version, old.version); assert.equal(current.workspace, 'demo'); assert.equal(current.deviceId, 'device_demo');
  if (process.platform === 'win32') assert.equal(fs.readFileSync(operationsFile, 'utf8'), 'pause\n', 'Legacy upgrade must authenticate pause and drain before stopping');
  assert.throws(() => process.kill(child.pid, 0), error => error.code === 'ESRCH', 'The exact original daemon must truly exit');
  assert.equal(fs.readFileSync(configPath, 'utf8'), config); assert.doesNotMatch(refreshed.stdout + refreshed.stderr, /synthetic-refresh-private-token/);
  const repeated = await run(process.execPath, [path.join(directory, 'scripts', 'start-ziwei-user.mjs')], { env, windowsHide: true, timeout: 20000 });
  assert.match(repeated.stdout, /已就绪/); assert.equal((await waitReady(url)).pid, current.pid, 'Same build start must not restart');
});

test('native start refuses to claim readiness when the newly launched process reports the wrong build', { timeout: 20000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-native-build-'));
  for (const file of fixtureFiles) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true }); fs.copyFileSync(path.join(root, file), path.join(directory, file));
  }
  fs.writeFileSync(path.join(directory, 'package.json'), '{"type":"module","version":"0.1.0"}');
  const probe = http.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const configPath = path.join(directory, 'config.json'); fs.writeFileSync(configPath, JSON.stringify({ workspace: 'demo', deviceId: 'device_demo', deviceToken: 'synthetic-wrong-build-private-token', healthPort: port }));
  const env = { ...process.env, ZIWEI_CONFIG: configPath, ZIWEI_USER_HOME: path.join(directory, 'userdata') };
  fs.writeFileSync(path.join(directory, 'daemon', 'ziwei_user.mjs'), `import http from 'node:http';const server=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ready:true,service:'ziwei_user',agentId:'ziwei_user',workspace:'demo',deviceId:'device_demo',pid:process.pid,clientBuild:'unexpected-build'}));});server.listen(${port},'127.0.0.1');process.on('SIGTERM',()=>server.close(()=>process.exit(0)));`);
  const url = `http://127.0.0.1:${port}/readyz`;
  t.after(async () => { try { const current = await (await fetch(url)).json(); process.kill(current.pid, 'SIGTERM'); } catch {} await new Promise(resolve => setTimeout(resolve, 150)); removeFixture(directory); });
  await assert.rejects(() => run(process.execPath, [path.join(directory, 'scripts', 'start-ziwei-user.mjs')], { env, windowsHide: true, timeout: 18000 }), error => error.code === 1 && /接口响应就绪，但 PID 或实际运行代码 build 不匹配/.test(error.stderr) && /已启动 ziwei_user/.test(error.stdout));
  const wrong = await waitReady(url); assert.equal(wrong.clientBuild, 'unexpected-build'); assert.notEqual(wrong.pid, process.pid); assert.equal(wrong.deviceId, 'device_demo');
});
