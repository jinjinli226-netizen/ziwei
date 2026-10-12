import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import * as lifecycle from '../scripts/client-lifecycle.mjs';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const windows = { skip: process.platform !== 'win32', timeout: 45000 };

async function earlyFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-early-stop-'));
  const root = path.join(directory, 'node_modules', 'ziwei');
  const home = path.join(directory, 'userdata');
  fs.mkdirSync(path.join(root, 'daemon'), { recursive: true });
  fs.mkdirSync(home);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'ziwei', version: '0.1.0', type: 'module', bin: { ziwei_user: 'scripts/ziwei-user.mjs' } }));
  const probe = http.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const healthPort = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const configPath = path.join(home, 'ziwei_user.json');
  const config = JSON.stringify({ workspace: 'isolated-legacy', deviceId: 'device_early_fixture', deviceToken: 'synthetic-early-private-token', healthHost: '127.0.0.1', healthPort, apiBase: 'http://127.0.0.1:1', heartbeatMs: 15000, pollMs: 5000 });
  fs.writeFileSync(configPath, config);
  fs.writeFileSync(path.join(home, 'health-patch.json'), '{}');
  const entry = path.join(root, 'daemon', 'ziwei_user.mjs');
  // The actual pre467 entry bytes are unchanged. Its isolated imported runtime
  // stubs keep every business request in this child process and simulate one
  // unresolved action which the historical health protocol cannot disclose.
  fs.copyFileSync(path.join(import.meta.dirname, 'fixtures', 'legacy-pre467-daemon.mjs.fixture'), entry);
  fs.mkdirSync(path.join(root, 'src')); fs.mkdirSync(path.join(root, 'backend'));
  fs.writeFileSync(path.join(root, 'src', 'daemon.mjs'), `import http from 'node:http';import fs from 'node:fs';import path from 'node:path';
const home=process.env.ZIWEI_USER_HOME;const create=http.createServer;
http.createServer=function(listener){return create.call(this,(req,res)=>{if(req.url!=='/healthz')fs.appendFileSync(path.join(home,'control-requests'),req.method+' '+req.url+'\\n');const end=res.end;res.end=function(body,...args){if(req.url==='/healthz'&&body)body=JSON.stringify({...JSON.parse(body),...JSON.parse(fs.readFileSync(path.join(home,'health-patch.json')))});return end.call(this,body,...args)};listener(req,res)});};
globalThis.fetch=async url=>({ok:true,status:200,json:async()=>({ok:true,actions:String(url).includes('/a2a/v1/actions?')?[{id:'isolated-busy-action',type:'fixture'}]:[]})});
export class ActionDispatcher{async dispatch(){setInterval(()=>fs.appendFileSync(path.join(home,'unknown-active-work'),'tick\\n'),50);await new Promise(()=>{});}}`);
  fs.writeFileSync(path.join(root, 'src', 'local-action.mjs'), 'export const createLocalActionExecutor=()=>async()=>({status:"succeeded"});');
  fs.writeFileSync(path.join(root, 'src', 'redaction.mjs'), 'export const redactSecrets=value=>value;');
  fs.writeFileSync(path.join(root, 'src', 'runtime-adapters.mjs'), 'export const discoverInstalledRuntimes=()=>({runtimes:{}});export const managementMcpStatus=()=>({configured:false});export const terminalMcpStatus=()=>({configured:false});');
  fs.writeFileSync(path.join(root, 'backend', 'a2a-auth.mjs'), 'export const readA2AToken=()=>null;');
  fs.copyFileSync(path.join(import.meta.dirname, 'fixtures', 'legacy-pre467-config.mjs.fixture'), path.join(root, 'daemon', 'config.mjs'));
  const env = { ...process.env, ZIWEI_USER_HOME: home, ZIWEI_CONFIG: configPath };
  const child = spawn(process.execPath, [entry], { env, cwd: home, windowsHide: true, stdio: 'ignore' });
  const origin = `http://127.0.0.1:${healthPort}`;
  t.after(async () => {
    if (child.exitCode === null) child.kill();
    await wait(100);
    const resolved = path.resolve(directory), expected = path.resolve(os.tmpdir()) + path.sep;
    assert.ok(resolved.startsWith(expected) && path.basename(resolved).startsWith('ziwei-early-stop-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  for (let n = 0; n < 100; n++) {
    try { if ((await fetch(origin + '/healthz')).ok) return { root, home, env, configPath, config, child, origin }; } catch {}
    await wait(30);
  }
  throw new Error('Isolated early daemon did not start');
}

test('pre-identity daemon with unknown active work requires explicit confirmation without control requests', windows, async t => {
  const item = await earlyFixture(t);
  await assert.rejects(lifecycle.stopClient({ root: item.root, env: item.env }), error => error.code === 'LEGACY_STOP_CONFIRMATION_REQUIRED');
  assert.doesNotThrow(() => process.kill(item.child.pid, 0));
  assert.equal(fs.existsSync(path.join(item.home, 'control-requests')), false);
  const previous = fs.statSync(path.join(item.home, 'unknown-active-work')).size;
  await wait(100);
  assert.ok(fs.statSync(path.join(item.home, 'unknown-active-work')).size > previous);
  assert.equal(fs.readFileSync(item.configPath, 'utf8'), item.config);
});

test('read-only preflight proof allows only explicit termination and never claims a legacy drain', windows, async t => {
  const item = await earlyFixture(t);
  assert.equal(typeof lifecycle.inspectClientMaintenance, 'function');
  const inspected = await lifecycle.inspectClientMaintenance({ root: item.root, env: item.env });
  assert.equal(inspected.state, 'legacy_confirmation_required');
  assert.equal(inspected.activeActionCount, null); assert.equal(inspected.pollingCount, null);
  assert.equal(inspected.legacyProtocol, 'pre-identity'); assert.ok(inspected.legacyProof);
  assert.equal(fs.existsSync(path.join(item.home, 'control-requests')), false);
  await assert.rejects(lifecycle.stopClient({ root: item.root, env: item.env, allowLegacyStop: true }), error => error.code === 'LEGACY_STOP_PROOF_REQUIRED');
  await assert.rejects(lifecycle.stopClient({ root: item.root, env: item.env, allowLegacyStop: true, legacyProof: inspected.legacyProof, expectedBuild: 'a'.repeat(64) }), error => error.code === 'LEGACY_IDENTITY_CHANGED' && !error.stoppedClientReceipt);
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: 'ignore' });
  t.after(() => unrelated.kill());
  const result = await lifecycle.stopClient({ root: item.root, env: item.env, allowLegacyStop: true, legacyProof: inspected.legacyProof });
  assert.equal(result.stopped, true); assert.equal(result.pid, item.child.pid);
  assert.equal(result.activeActionCount, null); assert.equal(result.pollingCount, null);
  assert.equal(result.legacyProtocol, 'pre-identity'); assert.notEqual(result.drained, true);
  assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
  assert.equal(fs.existsSync(path.join(item.home, 'control-requests')), false);
  assert.equal(fs.readFileSync(item.configPath, 'utf8'), item.config);
  assert.doesNotMatch(JSON.stringify({ inspected, result }), /synthetic-early-private-token/);
});

test('partial identity fields and modern lifecycle cannot downgrade to pre-identity stopping', windows, async t => {
  const item = await earlyFixture(t);
  for (const patch of [{ clientBuild: 'f'.repeat(64) }, { activeActionCount: 0 }, { pollingCount: 0 }, { deviceId: 'device_early_fixture' }, { lifecycle: null }, { connectionState: 'draining' }]) {
    fs.writeFileSync(path.join(item.home, 'health-patch.json'), JSON.stringify(patch));
    await assert.rejects(lifecycle.stopClient({ root: item.root, env: item.env, allowLegacyStop: true, legacyProof: {} }), error => error.code !== 'LEGACY_STOP_CONFIRMATION_REQUIRED');
    assert.doesNotThrow(() => process.kill(item.child.pid, 0));
  }
  assert.equal(fs.existsSync(path.join(item.home, 'control-requests')), false);
});

test('confirmation proof cannot be reused after a config change or for another exact daemon', windows, async t => {
  const first = await earlyFixture(t), second = await earlyFixture(t);
  assert.equal(typeof lifecycle.inspectClientMaintenance, 'function');
  const inspected = await lifecycle.inspectClientMaintenance({ root: first.root, env: first.env });
  await assert.rejects(lifecycle.stopClient({ root: second.root, env: second.env, allowLegacyStop: true, legacyProof: inspected.legacyProof }));
  fs.appendFileSync(first.configPath, '\n');
  await assert.rejects(lifecycle.stopClient({ root: first.root, env: first.env, allowLegacyStop: true, legacyProof: inspected.legacyProof }));
  assert.doesNotThrow(() => process.kill(first.child.pid, 0)); assert.doesNotThrow(() => process.kill(second.child.pid, 0));
  assert.equal(fs.existsSync(path.join(first.home, 'control-requests')), false);
  assert.equal(fs.existsSync(path.join(second.home, 'control-requests')), false);
});

test('confirmed legacy exit carries a private stop receipt if the following config check fails', windows, async t => {
  const item = await earlyFixture(t);
  const inspected = await lifecycle.inspectClientMaintenance({ root: item.root, env: item.env });
  item.child.once('exit', () => fs.appendFileSync(item.configPath, '\n'));
  await assert.rejects(lifecycle.stopClient({ root: item.root, env: item.env, allowLegacyStop: true, legacyProof: inspected.legacyProof }), error => {
    assert.equal(error.code, 'LEGACY_IDENTITY_CHANGED');
    assert.equal(error.stoppedClientReceipt?.stopped, true);
    assert.equal(error.stoppedClientReceipt.pid, item.child.pid);
    assert.equal(error.stoppedClientReceipt.legacyProtocol, 'pre-identity');
    assert.equal(error.stoppedClientReceipt.activeActionCount, null);
    return true;
  });
  assert.equal(fs.readFileSync(item.configPath, 'utf8'), item.config + '\n');
  assert.equal(fs.existsSync(path.join(item.home, 'control-requests')), false);
});
