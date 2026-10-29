import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {spawn} from 'node:child_process';

const moduleUrl = new URL('../src/runtime-process.mjs', import.meta.url);
let spawnSupervisedRuntime;
try { ({ spawnSupervisedRuntime } = await import(moduleUrl)); } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
const windows = process.platform === 'win32';
const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-runtime-test-'));
const exists = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(predicate, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = predicate(); if (value) return value; await delay(40); }
  assert.fail('isolated process condition was not observed before deadline');
}
function launch(spec) {
  assert.equal(typeof spawnSupervisedRuntime, 'function', 'runtime supervisor API must be implemented');
  const runtime = spawnSupervisedRuntime(spec);
  runtime.errors = [];
  runtime.child.on('error', error => runtime.errors.push(error));
  return runtime;
}

test('supervisor preserves root exit code, binary streams, cwd, environment and Windows argv', { timeout: 30000 }, async t => {
  const dir = scratch();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const entry = path.join(dir, 'io fixture.cjs');
  fs.writeFileSync(entry, `let input=[];process.stdin.on('data',c=>input.push(c));process.stdin.on('end',()=>{process.stdout.write(JSON.stringify({cwd:process.cwd(),value:process.env.ZIWEI_RUNTIME_TEST,args:process.argv.slice(2),input:Buffer.concat(input).toString('base64')}));process.stderr.write('stderr sentinel');process.exitCode=37;});`);
  const args = ['', 'space here', 'quote"here', 'ends\\', 'a\\\\"b', '中文'];
  const runtime = launch({ command: process.execPath, args: [entry, ...args], cwd: dir, env: { ...process.env, ZIWEI_RUNTIME_TEST: 'value 中文' } });
  t.after(() => runtime.stop());
  let stdout = '', stderr = '', closeCode;
  runtime.child.stdout.on('data', c => { stdout += c; });
  runtime.child.stderr.on('data', c => { stderr += c; });
  runtime.child.once('close', code => { closeCode = code; });
  const input = Buffer.from([0, 255, 13, 10, 1, 222]);
  runtime.child.stdin.end(input);
  const evidence = await runtime.completionEvidence;
  assert.deepEqual(runtime.errors, []);
  assert.equal(evidence.rootExitCode, 37);
  assert.equal(closeCode, 37);
  assert.equal(evidence.rootConfirmed, true);
  assert.equal(evidence.treeConfirmed, windows);
  assert.equal(evidence.activeProcesses, windows ? 0 : null);
  assert.equal(evidence.backgroundProcessesRetained, false);
  assert.deepEqual(JSON.parse(stdout), { cwd: dir, value: 'value 中文', args, input: input.toString('base64') });
  assert.equal(stderr, 'stderr sentinel');
});

test('failed native executable launch is explicit and never runs the requested program', { timeout: 30000 }, async t => {
  const dir = scratch();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const runtime = launch({ command: path.join(dir, 'does-not-exist.exe'), args: [], cwd: dir, env: process.env });
  runtime.child.stdin.end();
  const evidence = await runtime.completionEvidence;
  assert.equal(evidence.launched, false);
  assert.equal(evidence.rootPid, null);
  assert.equal(evidence.rootExitCode, null);
  assert.ok(evidence.failureCode);
  assert.equal(runtime.errors.length, 1);
});

test('Windows host OS spawn failure confirms that no runtime tree was created', { skip: !windows, timeout: 30000 }, async t => {
  const dir = scratch();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const runtime = launch({ command: process.execPath, args: ['-e', 'process.exit(0)'], cwd: path.join(dir, 'missing-cwd'), env: process.env });
  let closed = false;
  runtime.child.once('close', () => { closed = true; });
  runtime.child.stdin.end();
  const evidence = await runtime.completionEvidence;
  assert.equal(runtime.child.supervisorPid, undefined);
  assert.equal(evidence.failureCode, 'ENOENT');
  assert.equal(evidence.launched, false);
  assert.equal(evidence.rootPid, null);
  assert.equal(evidence.rootConfirmed, false);
  assert.equal(evidence.rootExitCode, null);
  assert.equal(evidence.treeConfirmed, true);
  assert.equal(evidence.activeProcesses, 0);
  assert.equal(closed, true);
  assert.equal(runtime.errors.length, 1);
});

test('Windows cancel terminates the owned root and detached descendant and confirms the Job is empty', { skip: !windows, timeout: 35000 }, async t => {
  const dir = scratch();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const child = path.join(dir, 'detached.cjs');
  const root = path.join(dir, 'root.cjs');
  const beat = path.join(dir, 'beat.txt');
  fs.writeFileSync(child, `require('fs').writeFileSync(${JSON.stringify(path.join(dir, 'grandchild.pid'))},String(process.pid));setInterval(()=>require('fs').appendFileSync(${JSON.stringify(beat)},'x'),35);`);
  fs.writeFileSync(root, `const p=require('child_process').spawn(process.execPath,[${JSON.stringify(child)}],{detached:true,stdio:'ignore',windowsHide:true});p.unref();require('fs').writeFileSync(${JSON.stringify(path.join(dir, 'root.pid'))},String(process.pid));setInterval(()=>{},1000);`);
  const runtime = launch({ command: process.execPath, args: [root], cwd: dir, env: process.env, cleanupOnFailure: true });
  t.after(() => runtime.stop());
  runtime.child.stdin.end();
  await until(() => fs.existsSync(beat) && fs.statSync(beat).size >= 3);
  const pids = ['root.pid', 'grandchild.pid'].map(file => Number(fs.readFileSync(path.join(dir, file), 'utf8')));
  assert.ok(pids.every(exists));
  const evidence = await runtime.stop();
  assert.equal(evidence.cancelled, true);
  assert.equal(evidence.backgroundProcessesRetained, false);
  assert.equal(evidence.rootConfirmed, true);
  assert.equal(evidence.treeConfirmed, true);
  assert.equal(evidence.activeProcesses, 0);
  await until(() => pids.every(pid => !exists(pid)), 5000);
  const size = fs.statSync(beat).size;
  await delay(180);
  assert.equal(fs.statSync(beat).size, size);
  assert.equal(await runtime.stop(), evidence);
});

test('Windows normal root exit preserves an intentional detached service and reports its presence honestly', { skip: !windows, timeout: 30000 }, async t => {
  const dir = scratch();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pidFile = path.join(dir, 'descendant.pid');
  const root = path.join(dir, 'root.cjs');
  fs.writeFileSync(root, `const fs=require('fs');const p=require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},2400)'],{detached:true,stdio:'ignore',windowsHide:true});p.unref();fs.writeFileSync(${JSON.stringify(pidFile)},String(p.pid));setTimeout(()=>process.exit(0),100);`);
  const runtime = launch({ command: process.execPath, args: [root], cwd: dir, env: process.env });
  t.after(() => runtime.stop());
  runtime.child.stdin.end();
  const evidence = await runtime.completionEvidence;
  assert.equal(evidence.rootExitCode, 0);
  assert.equal(evidence.rootConfirmed, true);
  assert.equal(evidence.treeConfirmed, false);
  assert.ok(evidence.activeProcesses > 0);
  assert.equal(evidence.backgroundProcessesRetained, true);
  assert.equal(evidence.cancelled, false);
  assert.equal(evidence.failureCode, null);
  const descendantPid = Number(fs.readFileSync(pidFile, 'utf8'));
  assert.equal(exists(descendantPid), true);
  await until(() => !exists(descendantPid), 5000);
  await runtime.stop();
});

test('Windows failed root cleans up its owned child tree by default and preserves the failed root exit', { skip: !windows, timeout: 30000 }, async t => {
  const dir=scratch();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const grandchild=path.join(dir,'grandchild.pid'),child=path.join(dir,'child.pid'),entry=path.join(dir,'failed-model.cjs');
  const childProgram=`const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(child)},String(process.pid));const p=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(`require('node:fs').writeFileSync(${JSON.stringify(grandchild)},String(process.pid));setTimeout(()=>{},15000);`)}],{detached:true,stdio:'ignore',windowsHide:true});p.unref();setTimeout(()=>{},15000);`;
  fs.writeFileSync(entry,`const p=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(childProgram)}],{detached:true,stdio:'ignore',windowsHide:true});p.unref();const fs=require('node:fs'),timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(grandchild)})){clearInterval(timer);process.exit(1);}},20);`);
  const runtime=launch({command:process.execPath,args:[entry],cwd:dir,env:process.env});runtime.child.stdin.end();
  const evidence=await runtime.completionEvidence;
  assert.equal(evidence.rootExitCode,1);assert.equal(evidence.rootConfirmed,true);assert.equal(evidence.cancelled,false);assert.equal(evidence.treeConfirmed,true);assert.equal(evidence.activeProcesses,0);assert.equal(evidence.backgroundProcessesRetained,false);assert.equal(evidence.failureCode,null);
  const pids=[child,grandchild].map(file=>Number(fs.readFileSync(file,'utf8')));
  await until(()=>pids.every(pid=>!exists(pid)),5000);
});

test('Windows success preserves an intentional background service until explicit stop reaps its original Job', { skip: !windows, timeout: 30000 }, async t => {
  const dir=scratch();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const pidFile=path.join(dir,'background.pid'),entry=path.join(dir,'successful-model.cjs');
  fs.writeFileSync(entry,`const p=require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},15000)'],{detached:true,stdio:'ignore',windowsHide:true});p.unref();require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(p.pid));setTimeout(()=>process.exit(0),100);`);
  const runtime=launch({command:process.execPath,args:[entry],cwd:dir,env:process.env,cleanupOnFailure:true});runtime.child.stdin.end();
  const evidence=await runtime.completionEvidence,pid=Number(fs.readFileSync(pidFile,'utf8'));
  assert.equal(evidence.rootExitCode,0);assert.equal(evidence.cancelled,false);assert.equal(evidence.backgroundProcessesRetained,true);assert.equal(evidence.treeConfirmed,false);assert.equal(exists(pid),true);
  await delay(150);assert.equal(exists(pid),true);
  const stopped=await runtime.stop();
  assert.equal(stopped.rootPid,evidence.rootPid);assert.equal(stopped.rootExitCode,0);assert.equal(stopped.cancelled,true);assert.equal(stopped.treeConfirmed,true);assert.equal(stopped.activeProcesses,0);assert.equal(stopped.backgroundProcessesRetained,false);assert.equal(stopped.failureCode,null);
  await until(()=>!exists(pid),5000);assert.equal(await runtime.stop(),stopped);assert.equal(evidence.backgroundProcessesRetained,true);
});

test('Windows business failure after a zero CLI exit can still stop the owned retained tree', { skip: !windows, timeout: 30000 }, async t => {
  const dir=scratch();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const unrelated=spawn(process.execPath,['-e','setTimeout(()=>{},15000)'],{stdio:'ignore',windowsHide:true});t.after(()=>{if(unrelated.exitCode===null)unrelated.kill();});
  const pidFile=path.join(dir,'business-child.pid'),entry=path.join(dir,'business-failure.cjs');
  fs.writeFileSync(entry,`const p=require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},15000)'],{detached:true,stdio:'ignore',windowsHide:true});p.unref();require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(p.pid));setTimeout(()=>process.exit(0),100);`);
  const runtime=launch({command:process.execPath,args:[entry],cwd:dir,env:process.env});runtime.child.stdin.end();
  const evidence=await runtime.completionEvidence,pid=Number(fs.readFileSync(pidFile,'utf8'));
  const failed={status:'failed',code:'MCP_RECEIPT_INCOMPLETE',processExit:evidence};
  assert.equal(failed.processExit.rootExitCode,0);assert.equal(exists(pid),true);
  const cleanup=await runtime.stop();
  assert.equal(cleanup.rootPid,evidence.rootPid);assert.equal(cleanup.rootConfirmed,true);assert.equal(cleanup.treeConfirmed,true);assert.equal(cleanup.activeProcesses,0);assert.equal(cleanup.backgroundProcessesRetained,false);assert.equal(cleanup.cancelled,true);
  await until(()=>!exists(pid),5000);assert.equal(exists(unrelated.pid),true);assert.equal(failed.status,'failed');assert.equal(failed.code,'MCP_RECEIPT_INCOMPLETE');assert.equal(evidence.activeProcesses>0,true);
});

test('Windows retained success does not keep its owner alive or kill the service when the owner exits', { skip: !windows, timeout: 30000 }, async t => {
  const dir=scratch();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const pidFile=path.join(dir,'service.pid'),receiptFile=path.join(dir,'owner-receipt.json');
  const root=`const p=require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},3500)'],{detached:true,stdio:'ignore',windowsHide:true});p.unref();require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(p.pid));setTimeout(()=>process.exit(0),100);`;
  const owner=`import fs from 'node:fs';const {spawnSupervisedRuntime}=await import(${JSON.stringify(moduleUrl.href)});const runtime=spawnSupervisedRuntime({command:process.execPath,args:['-e',${JSON.stringify(root)}],cwd:${JSON.stringify(dir)},env:process.env});runtime.child.on('error',()=>{});runtime.child.stdin.end();fs.writeFileSync(${JSON.stringify(receiptFile)},JSON.stringify(await runtime.completionEvidence));`;
  const child=spawn(process.execPath,['--input-type=module','-e',owner],{cwd:dir,stdio:'ignore',windowsHide:true});
  t.after(()=>{if(child.exitCode===null)child.kill();});
  await until(()=>fs.existsSync(receiptFile));await until(()=>child.exitCode!==null,3000);
  const receipt=JSON.parse(fs.readFileSync(receiptFile,'utf8')),pid=Number(fs.readFileSync(pidFile,'utf8'));
  assert.equal(child.exitCode,0);assert.equal(receipt.backgroundProcessesRetained,true);assert.equal(exists(pid),true);
  await until(()=>!exists(pid),6000);
});

test('Windows assignment failure terminates the still-suspended process without executing user code', { skip: !windows, timeout: 30000 }, async t => {
  const dir = scratch();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.copyFileSync(moduleUrl, path.join(dir, 'runtime-process.mjs'));
  const source = fs.readFileSync(new URL('../src/runtime-process.ps1', import.meta.url), 'utf8');
  const original = 'Check(AssignProcessToJobObject(job,process.process),step);';
  assert.equal(source.split(original).length, 2);
  // Fault only the copied helper: invoke the actual OS assignment API with an invalid Job.
  fs.writeFileSync(path.join(dir, 'runtime-process.ps1'), source.replace(original, 'Check(AssignProcessToJobObject(IntPtr.Zero,process.process),step);'));
  const copied = await import(new URL(`file:///${path.join(dir, 'runtime-process.mjs').replaceAll('\\', '/')}`));
  const marker = path.join(dir, 'must-not-run');
  const runtime = copied.spawnSupervisedRuntime({ command: process.execPath, args: ['-e', `require('fs').writeFileSync(${JSON.stringify(marker)},'ran')`], cwd: dir, env: process.env });
  const errors = [];
  runtime.child.on('error', e => errors.push(e));
  runtime.child.stdin.end();
  const evidence = await runtime.completionEvidence;
  assert.match(evidence.failureCode, /^RUNTIME_ASSIGN_JOB_/);
  assert.equal(evidence.launched, false);
  assert.equal(evidence.rootConfirmed, true);
  assert.equal(evidence.treeConfirmed, true);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(errors.length, 1);
});

test('Windows unexpected host termination closes its Job and kills owned detached descendants without inventing a receipt', { skip: !windows, timeout: 30000 }, async t => {
  const dir = scratch();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }));
  const pidsFile = path.join(dir, 'owned-pids.json');
  const script = `const p=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore',windowsHide:true});p.unref();require('fs').writeFileSync(${JSON.stringify(pidsFile)},JSON.stringify([process.pid,p.pid]));setInterval(()=>{},1000);`;
  const runtime = launch({ command: process.execPath, args: ['-e', script], cwd: dir, env: process.env });
  t.after(() => runtime.stop());
  runtime.child.stdin.end();
  await until(() => fs.existsSync(pidsFile));
  const pids = JSON.parse(fs.readFileSync(pidsFile, 'utf8'));
  assert.ok(pids.every(exists));
  assert.ok(Number.isSafeInteger(runtime.child.supervisorPid));
  process.kill(runtime.child.supervisorPid);
  const evidence = await runtime.completionEvidence;
  assert.equal(evidence.rootConfirmed, false);
  assert.equal(evidence.treeConfirmed, false);
  assert.equal(evidence.rootExitCode, null);
  assert.equal(evidence.failureCode, 'RUNTIME_SUPERVISOR_UNCONFIRMED');
  await until(() => pids.every(pid => !exists(pid)), 5000);
});

test('Windows cancellation before supervisor readiness prevents the requested runtime from launching', { skip: !windows, timeout: 30000 }, async t => {
  const dir = scratch();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const marker = path.join(dir, 'must-not-run');
  const runtime = launch({ command: process.execPath, args: ['-e', `require('fs').writeFileSync(${JSON.stringify(marker)},'ran')`], cwd: dir, env: process.env });
  const evidence = await runtime.stop();
  assert.equal(evidence.cancelled, true);
  assert.equal(evidence.backgroundProcessesRetained, false);
  assert.equal(evidence.launched, false);
  assert.equal(evidence.treeConfirmed, true);
  assert.equal(fs.existsSync(marker), false);
});

test('Windows cancel arriving during root-exit bookkeeping still empties the owned Job', { skip: !windows, timeout: 30000 }, async t => {
  const dir = scratch();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pidsFile = path.join(dir, 'owned-pids.json');
  const script = `const p=require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},5000)'],{detached:true,stdio:'ignore',windowsHide:true});p.unref();require('fs').writeFileSync(${JSON.stringify(pidsFile)},JSON.stringify([process.pid,p.pid]));setTimeout(()=>process.exit(0),50);`;
  const runtime = launch({ command: process.execPath, args: ['-e', script], cwd: dir, env: process.env });
  t.after(() => runtime.stop());
  runtime.child.stdin.end();
  await until(() => fs.existsSync(pidsFile));
  const [rootPid, descendantPid] = JSON.parse(fs.readFileSync(pidsFile, 'utf8'));
  await until(() => !exists(rootPid), 3000);
  const evidence = await runtime.stop();
  assert.equal(evidence.cancelled, true);
  assert.equal(evidence.backgroundProcessesRetained, false);
  assert.equal(evidence.rootConfirmed, true);
  assert.equal(evidence.treeConfirmed, true);
  assert.equal(evidence.activeProcesses, 0);
  await until(() => !exists(descendantPid), 5000);
});
