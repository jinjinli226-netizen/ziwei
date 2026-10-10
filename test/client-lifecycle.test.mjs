import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { stopClient, validateInstalledClientLayout, performClientUninstall } from '../scripts/client-lifecycle.mjs';
import { clientBuildIdentity } from '../src/management-bootstrap.mjs';

const run = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(t, { busy = false, legacy = false, falseNonce = false, changeConfigurationOnPause = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-stop-fixture-'));
  const root = path.join(directory, 'node_modules', 'ziwei'), home = path.join(directory, 'user-data');
  fs.mkdirSync(path.join(root, 'daemon'), { recursive: true }); fs.mkdirSync(home);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'ziwei', type: 'module', bin: { ziwei_user: 'scripts/ziwei-user.mjs' } }));
  const server = http.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve));
  const file = path.join(home, 'ziwei_user.json');
  const config = JSON.stringify({ workspace: 'isolated', deviceId: 'device_fixture', deviceToken: 'synthetic-private-stop-token', healthHost: '127.0.0.1', healthPort: port });
  fs.writeFileSync(file, config); fs.writeFileSync(path.join(home, 'Creator-memory'), 'retain memory');
  fs.writeFileSync(path.join(root, 'daemon', 'ziwei_user.mjs'), `import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import {createHash} from 'node:crypto';
const input=JSON.parse(fs.readFileSync(process.env.ZIWEI_CONFIG)); let paused=false;
const record=()=>({service:'ziwei_user',agentId:'ziwei_user',pid:process.pid,clientBuild:process.env.FIXTURE_BUILD,workspace:input.workspace,deviceId:input.deviceId,connectionState:paused?'draining':'connected',activeActionCount:${busy ? 1 : 0},pollingCount:0,...(${legacy} ? {} : {lifecycle:{nonce:'fixture-nonce-0123456789abcdef',root:${JSON.stringify(root)},configPath:process.env.ZIWEI_CONFIG,configSha256:createHash('sha256').update(fs.readFileSync(process.env.ZIWEI_CONFIG)).digest('hex'),startedAt:new Date().toISOString(),managedAuxiliaryCount:0}})});
const server=http.createServer((req,res)=>{if(req.url==='/healthz'){res.end(JSON.stringify(record()));return;} if(req.url!='/local/connection-control'||req.method!=='POST'||req.headers['x-ziwei-local-control']!==input.deviceToken){res.writeHead(401);res.end();return;}
let text='';req.on('data',c=>text+=c);req.on('end',()=>{const body=JSON.parse(text);fs.appendFileSync(path.join(${JSON.stringify(home)},'operations'),body.operation+'\\n');if(!${legacy} && body.nonce!==${JSON.stringify(falseNonce ? 'different-nonce' : 'fixture-nonce-0123456789abcdef')}){res.writeHead(409);res.end();return;} if(body.operation==='stop'){if(!paused||${busy}){res.writeHead(409);res.end();return;}res.end(JSON.stringify(record()));setTimeout(()=>server.close(()=>process.exit(0)),20);return;}paused=body.operation==='pause';if(paused && ${changeConfigurationOnPause})fs.appendFileSync(process.env.ZIWEI_CONFIG,'\\n');res.end(JSON.stringify(record()));});});server.listen(input.healthPort,'127.0.0.1');`);
  const env = { ...process.env, ZIWEI_USER_HOME: home, ZIWEI_CONFIG: file, FIXTURE_BUILD: clientBuildIdentity(root) };
  const child = spawn(process.execPath, [path.join(root, 'daemon', 'ziwei_user.mjs')], { env, cwd: home, windowsHide: true, stdio: 'ignore' });
  t.after(async () => { if (child.exitCode === null) child.kill(); await pause(80); fs.rmSync(directory, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${port}/healthz`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(url)).ok) break; } catch {} await pause(30); }
  return { root, env, file, home, child, config, url };
}

test('stop drains and exits only the exact isolated daemon while preserving all userdata', { skip: process.platform !== 'win32', timeout: 15000 }, async t => {
  const item = await fixture(t);
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: 'ignore' }); t.after(() => unrelated.kill());
  const result = await stopClient({ root: item.root, env: item.env, expectedPid: item.child.pid, timeoutMs: 10000 });
  assert.equal(result.stopped, true); assert.equal(result.wasRunning, true); assert.equal(result.pid, item.child.pid);
  assert.equal(fs.readFileSync(item.file, 'utf8'), item.config); assert.equal(fs.readFileSync(path.join(item.home, 'Creator-memory'), 'utf8'), 'retain memory');
  assert.equal(fs.readFileSync(path.join(item.home, 'operations'), 'utf8'), 'pause\nstop\n');
  assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
  const second = await stopClient({ root: item.root, env: item.env }); assert.equal(second.alreadyStopped, true); assert.equal(second.wasRunning, false);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-private/);
});

test('busy stop resumes the original instance instead of killing or leaving it paused', { skip: process.platform !== 'win32', timeout: 15000 }, async t => {
  const item = await fixture(t, { busy: true });
  await assert.rejects(stopClient({ root: item.root, env: item.env, drainTimeoutMs: 100, timeoutMs: 10000 }), error => error.code === 'CLIENT_BUSY');
  assert.equal((await (await fetch(item.url)).json()).connectionState, 'connected');
  assert.equal(fs.readFileSync(path.join(item.home, 'operations'), 'utf8'), 'pause\nresume\n');
  assert.equal(fs.readFileSync(item.file, 'utf8'), item.config);
});

test('stop rejects forged PID, nonce and configuration identity without a kill', { skip: process.platform !== 'win32', timeout: 15000 }, async t => {
  const item = await fixture(t);
  await assert.rejects(stopClient({ root: item.root, env: item.env, expectedPid: process.pid }), /PID/);
  await assert.rejects(stopClient({ root: item.root, env: item.env, expectedNonce: 'foreign' }), /实例|nonce/);
  fs.writeFileSync(item.file, JSON.stringify({ ...JSON.parse(item.config), deviceId: 'foreign_device' }));
  await assert.rejects(stopClient({ root: item.root, env: item.env }), /设备|配置/);
  assert.doesNotThrow(() => process.kill(item.child.pid, 0)); assert.equal(fs.existsSync(path.join(item.home, 'operations')), false);
});

test('a configuration change after accepted pause fails safely and resumes the same boot', { skip: process.platform !== 'win32', timeout: 15000 }, async t => {
  const item = await fixture(t, { busy: true, changeConfigurationOnPause: true });
  await assert.rejects(stopClient({ root: item.root, env: item.env, timeoutMs: 10000 }), error => error.resumed === true && error.code === 'LIFECYCLE_IDENTITY_MISMATCH');
  assert.equal((await (await fetch(item.url)).json()).connectionState, 'connected');
  assert.equal(fs.readFileSync(item.file, 'utf8'), item.config + '\n');
  assert.equal(fs.readFileSync(path.join(item.home, 'operations'), 'utf8'), 'pause\nresume\n');
});

test('strict legacy compatibility drains a real pre-nonce daemon and terminates its bound Windows process handle', { skip: process.platform !== 'win32', timeout: 15000 }, async t => {
  const item = await fixture(t, { legacy: true });
  const result = await stopClient({ root: item.root, env: item.env, timeoutMs: 10000 });
  assert.equal(result.stopped, true); assert.equal(result.legacyIdentity, true);
  assert.equal(fs.readFileSync(path.join(item.home, 'operations'), 'utf8'), 'pause\n');
});

test('uninstall verifies exact npm package and bin ownership and rejects userdata within the package', { skip: process.platform !== 'win32' }, t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-uninstall-layout-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'node_modules', 'ziwei'); fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'ziwei', bin: { ziwei_user: 'scripts/ziwei-user.mjs' } })); fs.writeFileSync(path.join(root, 'scripts/ziwei-user.mjs'), '#!/usr/bin/env node');
  for (const suffix of ['', '.cmd', '.ps1']) fs.writeFileSync(path.join(directory, 'ziwei_user' + suffix), 'node_modules/ziwei/scripts/ziwei-user.mjs');
  assert.equal(validateInstalledClientLayout({ root, env: {} }).prefix, directory);
  fs.writeFileSync(path.join(directory, 'ziwei_user.cmd'), 'node_modules/other/scripts/run.mjs # node_modules/ziwei/scripts/ziwei-user.mjs'); assert.throws(() => validateInstalledClientLayout({ root, env: {} }), /入口|bin|shim/);
  fs.writeFileSync(path.join(directory, 'ziwei_user.cmd'), 'node_modules/ziwei/scripts/ziwei-user.mjs'); fs.mkdirSync(path.join(root, 'data')); fs.writeFileSync(path.join(root, 'data', 'keep'), 'user data');
  assert.throws(() => validateInstalledClientLayout({ root, env: {} }), /数据/);
  assert.equal(fs.readFileSync(path.join(root, 'data', 'keep'), 'utf8'), 'user data');
});

test('real isolated npm uninstall removes only ziwei and its bins while retaining config, auth and Creator', { skip: process.platform !== 'win32', timeout: 40000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-real-npm-uninstall-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const prefix = path.join(directory, 'prefix'), source = path.join(directory, 'source'), home = path.join(directory, 'userdata'); fs.mkdirSync(path.join(source, 'scripts'), { recursive: true }); fs.mkdirSync(home);
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: 'ziwei', version: '0.1.0', type: 'module', bin: { ziwei_user: 'scripts/ziwei-user.mjs' } })); fs.writeFileSync(path.join(source, 'scripts/ziwei-user.mjs'), '#!/usr/bin/env node\nconsole.log("fixture");');
  const npm = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  const packed = JSON.parse((await run(process.execPath, [npm, 'pack', '--json', '--pack-destination', directory], { cwd: source, windowsHide: true })).stdout)[0];
  await run(process.execPath, [npm, 'install', '--global', '--prefix', prefix, path.join(directory, packed.filename), '--ignore-scripts', '--offline', '--no-audit', '--no-fund'], { cwd: directory, windowsHide: true });
  const root = path.join(prefix, 'node_modules/ziwei'), other = path.join(prefix, 'node_modules/other-cli'); fs.mkdirSync(other); fs.writeFileSync(path.join(other, 'keep'), 'unrelated');
  fs.writeFileSync(path.join(prefix, 'other-cli.cmd'), 'unrelated bin');
  const portProbe = http.createServer(); await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve)); const healthPort = portProbe.address().port; await new Promise(resolve => portProbe.close(resolve));
  const config = JSON.stringify({ connectionState: 'disconnected', healthPort, workspace: '', deviceId: '' }); fs.writeFileSync(path.join(home, 'ziwei_user.json'), config);
  for (const file of ['auth.json', 'Creator-memory', 'device-identity']) fs.writeFileSync(path.join(home, file), 'retain ' + file);
  const result = await performClientUninstall({ root, env: { ...process.env, ZIWEI_USER_HOME: home }, directory: path.join(home, 'maintenance', 'fixture'), npmCli: npm });
  assert.equal(result.state, 'complete'); assert.equal(result.userdataPreserved, true); assert.equal(fs.existsSync(root), false);
  for (const suffix of ['', '.cmd', '.ps1']) assert.equal(fs.existsSync(path.join(prefix, 'ziwei_user' + suffix)), false);
  for (const file of ['auth.json', 'Creator-memory', 'device-identity']) assert.equal(fs.readFileSync(path.join(home, file), 'utf8'), 'retain ' + file);
  assert.equal(fs.readFileSync(path.join(home, 'ziwei_user.json'), 'utf8'), config); assert.equal(fs.readFileSync(path.join(other, 'keep'), 'utf8'), 'unrelated'); assert.equal(fs.readFileSync(path.join(prefix, 'other-cli.cmd'), 'utf8'), 'unrelated bin');
});
