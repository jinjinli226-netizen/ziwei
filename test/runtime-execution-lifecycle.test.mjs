import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLocalActionExecutor } from '../src/local-action.mjs';
import { discoverInstalledRuntimes, resetRuntimeDiscovery, executeRuntime } from '../src/runtime-adapters.mjs';

const windowsOnly = { skip: process.platform !== 'win32' };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-execution-lifecycle-'));
  const bin = path.join(root, 'bin'), cwd = path.join(root, 'cwd'), codexHome = path.join(root, 'codex');
  fs.mkdirSync(cwd); fs.mkdirSync(codexHome);
  const entry = path.join(bin, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(path.join(bin, 'codex.cmd'), '@echo off\r\nexit /b 99\r\n');
  fs.writeFileSync(path.join(codexHome, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'ISOLATED_FIXTURE_NO_REAL_CREDENTIAL' }));
  fs.writeFileSync(entry, `const fs=require('node:fs'),{spawn}=require('node:child_process');
if(process.argv[2]==='--version'){console.log('codex-cli 0.162.0');process.exit(0);}
let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{
 fs.writeFileSync('invoked',input);
 const mode=process.env.ZIWEI_FIXTURE_MODE;
 if(mode==='detached'){
  const grandchild=spawn(process.execPath,['-e',"const fs=require('node:fs');fs.writeFileSync('grandchild.pid',String(process.pid));let n=0;const timer=setInterval(()=>fs.writeFileSync('counter',String(++n)),30);setTimeout(()=>{clearInterval(timer);process.exit(0)},4000)"],{cwd:process.cwd(),detached:true,stdio:'ignore'});grandchild.unref();
  console.log(JSON.stringify({type:'item.started',item:{type:'mcp_tool_call',name:'fixture.wait'}}));
  setTimeout(()=>process.exit(0),4500);return;
 }
 if(mode==='stderr'){
  let n=0;const timer=setInterval(()=>{process.stderr.write(n++%2?'partial':'{"type":"unrecognized_fixture"}\\n');if(n===5){clearInterval(timer);setTimeout(()=>{console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'fixture-finished'}}));},60)}},80);return;
 }
 console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:input}}));
});`);
  const env = { CODEX_HOME: codexHome, HERMES_HOME: path.join(root, 'hermes'), NPM_CONFIG_USERCONFIG: path.join(root, 'empty.npmrc'),
    PATH: [bin, path.join(process.env.SystemRoot, 'System32')].join(';'), APPDATA: root, npm_config_prefix: bin };
  fs.writeFileSync(env.NPM_CONFIG_USERCONFIG, '');
  const original = new Map(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env); t.mock.method(os, 'homedir', () => root); resetRuntimeDiscovery();
  t.after(() => { for (const [key, value] of original) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } resetRuntimeDiscovery(); fs.rmSync(root, { recursive: true, force: true }); });
  assert.equal(discoverInstalledRuntimes({ force: true }).runtimes.Codex.binary, path.join(bin, 'codex.cmd'));
  return { root, cwd, options: { runtime: 'Codex', cwd, prompt: 'isolated fixture only' } };
}

test('native runtime forwards every stderr packet as activity without fabricating progress', windowsOnly, async t => {
  const f = fixture(t), packets = [], progress = [];
  const result = await executeRuntime({ ...f.options, env: { ZIWEI_FIXTURE_MODE: 'stderr' }, onActivity: data => packets.push(data), onProgress: data => progress.push(data) });
  assert.equal(result.status, 'succeeded');
  assert.ok(packets.filter(item => item.stream === 'stderr').length >= 5, 'partial and unknown JSON stderr are real received activity');
  assert.ok(packets.every(item => item.bytes > 0 && !Object.hasOwn(item, 'text')), 'activity contains byte counts, never private raw output');
  assert.equal(result.result.output, 'fixture-finished');
  assert.equal(progress.length, 1, 'only stdout currently emits semantic progress');
});

test('local action forwards supervision and normal completion records verified process exit', windowsOnly, async t => {
  const f = fixture(t); let supervision;
  const execute = createLocalActionExecutor({ runtimeDir: path.join(f.root, 'runtime'), defaultWorkdir: f.cwd });
  const result = await execute({ id: 'isolated-supervision', type: 'conversation.execute', payload: { runtime: 'Codex', prompt: 'fixture exact response' } }, { onSupervision: value => { supervision = value; } });
  assert.equal(result.status, 'succeeded');
  assert.ok(supervision, 'dispatcher must receive the owned process supervisor before it may cancel');
  const evidence = await supervision.completionEvidence;
  assert.equal(evidence.rootConfirmed, true); assert.equal(evidence.treeConfirmed, true);
  assert.equal(result.result.processExit.treeConfirmed, true);
  assert.equal(result.result.processExit.rootExitCode, 0);
});

test('abort waits until an owned detached descendant stops before returning cancelled', windowsOnly, async t => {
  const f = fixture(t), controller = new AbortController(); let supervision;
  const resultPromise = executeRuntime({ ...f.options, env: { ZIWEI_FIXTURE_MODE: 'detached' }, signal: controller.signal, onSupervision: value => { supervision = value; } });
  const deadline = Date.now() + 10_000;
  while (!fs.existsSync(path.join(f.cwd, 'counter')) && Date.now() < deadline) await sleep(25);
  assert.ok(fs.existsSync(path.join(f.cwd, 'counter')), 'detached fixture must actually execute');
  controller.abort(); const result = await resultPromise;
  const atReturn = fs.readFileSync(path.join(f.cwd, 'counter'), 'utf8'); await sleep(150);
  assert.equal(fs.readFileSync(path.join(f.cwd, 'counter'), 'utf8'), atReturn, 'no descendant work after terminal cancellation');
  assert.equal(result.status, 'failed'); assert.equal(result.code, 'cancelled');
  assert.equal((await supervision.completionEvidence).treeConfirmed, true);
  assert.equal(result.result.processExit.activeProcesses, 0);
});

test('pre-aborted execution refuses to launch the CLI', windowsOnly, async t => {
  const f = fixture(t), controller = new AbortController(); controller.abort(); let launches = 0;
  const result = await executeRuntime({ ...f.options, signal: controller.signal, onSupervision: () => launches++ });
  assert.equal(result.code, 'cancelled'); assert.equal(launches, 0);
  assert.equal(fs.existsSync(path.join(f.cwd, 'invoked')), false);
});
