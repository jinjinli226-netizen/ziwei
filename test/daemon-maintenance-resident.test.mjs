import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {createBotGatewayManager} from '../src/hermes-gateway-runtime.mjs';
import {spawnSupervisedRuntime} from '../src/runtime-process.mjs';

const windows = process.platform === 'win32';
const alive = pid => {try {process.kill(pid, 0); return true;} catch {return false;}};
async function until(predicate, message, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {const value = predicate(); if (value) return value; await delay(20);}
  assert.fail(message);
}

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-maintenance-resident-'));
  const home = path.join(root, 'home'); fs.mkdirSync(home);
  const requests = [], ingress = []; let manager, supervision;
  const server = http.createServer((req, res) => {
    requests.push({method: req.method, url: req.url}); req.resume();
    if (req.url.endsWith('/bot-gateway-ingress')) {ingress.push(res); return;}
    const lease = req.method === 'POST' && req.url === '/a2a/v1/actions/original-connect/bot-gateway-lease';
    res.writeHead(lease ? 200 : 404, {'content-type': 'application/json'});
    res.end(JSON.stringify(lease ? {allowed: true} : {code: 'UNEXPECTED_FIXTURE_ROUTE'}));
  });
  t.after(async () => {
    for (const res of ingress) if (!res.writableEnded) res.end(JSON.stringify({delivery: {status: 'rejected'}}));
    await manager?.close();
    if (supervision) await supervision.completionEvidence;
    if (server.listening) {server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith('ziwei-maintenance-resident-'));
    fs.rmSync(root, {recursive: true, force: true});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const worker = path.join(root, 'worker.mjs');
  fs.writeFileSync(worker, `
import fs from 'node:fs';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
const emit = event => process.stdout.write('ZIWEI_GATEWAY_EVENT:' + JSON.stringify(event) + '\\n');
const descendant = spawn(process.execPath, ['-e', 'process.stdin.resume();process.stdin.on("end",()=>process.exit(0));setTimeout(()=>process.exit(0),25000);'], {stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true});
const ready = new Promise(resolve => descendant.once('spawn', () => {
  fs.writeFileSync('owned-pids.json', JSON.stringify([process.pid, descendant.pid])); resolve();
}));
const lines = readline.createInterface({input: process.stdin});
lines.on('line', async line => {
  const command = JSON.parse(line); await ready;
  if (command.operation === 'connect') emit({event: 'connected', status: 'connected', pid: process.pid});
  else if (command.operation === 'inbound') {
    const incoming = {event: 'inbound', chatId: 'fixture-chat', messageId: 'one-original-message', content: 'fixture'};
    emit(incoming); emit(incoming);
    emit({event: 'command_result', commandId: command.commandId, success: true});
  } else if (command.operation === 'send') fs.writeFileSync('pending-command.json', JSON.stringify({commandId: command.commandId}));
  else if (command.operation === 'disconnect') {
    emit({event: 'disconnected', status: 'disconnected'});
    fs.writeFileSync('disconnect-requested', 'yes'); lines.close();
    const timer = setInterval(() => {
      if (!fs.existsSync('allow-exit')) return;
      clearInterval(timer); descendant.once('close', () => process.exit(0)); descendant.stdin.end();
    }, 20);
  }
});
setTimeout(() => process.exit(99), 25000).unref();
`);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(SystemRoot|WINDIR|PATH|PATHEXT|TEMP|TMP)$/i.test(key)));
  Object.assign(env, {HOME: home, USERPROFILE: home, HERMES_HOME: home, ZIWEI_USER_HOME: home});
  manager = createBotGatewayManager({apiBase: `http://127.0.0.1:${server.address().port}`, workspace: 'resident-fixture', deviceToken: 'isolated-fixture-token'}, {
    nativeSpawn: () => ({command: process.execPath, args: [worker], cwd: root, env, prepared: {home}, cleanup() {}}),
    // Observe the real supervisor; do not replace its child, stop, or receipts.
    spawnSupervisedRuntime: spec => {supervision = spawnSupervisedRuntime(spec); return supervision;},
  });
  const context = {employeeId: 'fixture-bot', revision: 3, controlEpoch: 7};
  const options = operation => ({context, operation: {resource: 'gateway', operation, input: {platform: 'fixture', chatId: 'fixture-chat', content: 'fixture'}}});
  const original = await manager.operate({id: 'original-connect'}, options('connect'));
  assert.equal(original.connected, true);
  const pids = JSON.parse(fs.readFileSync(path.join(root, 'owned-pids.json'), 'utf8'));
  assert.equal(pids[0], original.pid); assert(pids.every(alive));
  return {root, home, manager, supervision, context, options, original, pids, ingress, requests};
}

test('real resident maintenance requires original Job exit and drained commands and inbound observers', {skip: !windows, timeout: 40000}, async t => {
  const f = await fixture(t);
  let status = f.manager.maintenanceStatus();
  assert.equal(status.safe, false); assert.equal(status.workers[0].processAlive, true);
  assert.equal(status.workers[0].processExit, null);
  assert.equal((await f.manager.operate({id: 'emit-original-inbound'}, f.options('inbound'))).success, true);
  await until(() => f.ingress.length === 1 && f.manager.maintenanceStatus().workers[0].pendingInbound === 1, 'original inbound and buffered duplicate must be held');
  const sending = f.manager.operate({id: 'original-send'}, f.options('outbound'));
  await until(() => fs.existsSync(path.join(f.root, 'pending-command.json')), 'real worker must receive the pending command');
  status = f.manager.maintenanceStatus();
  assert.equal(status.safe, false);
  assert.equal(status.workers[0].pendingCommands, 1);
  assert.equal(status.workers[0].inFlight, 1);
  assert.equal(status.workers[0].pendingInbound, 1);

  const disconnecting = f.manager.operate({id: 'original-disconnect'}, f.options('disconnect'));
  await until(() => fs.existsSync(path.join(f.root, 'disconnect-requested')), 'worker must receive disconnect without exiting yet');
  assert.equal(f.manager.status(f.context)[0].status, 'disconnected');
  assert(f.pids.every(alive));
  status = f.manager.maintenanceStatus();
  assert.equal(status.safe, false); assert.equal(status.workers[0].processAlive, true);
  assert.equal(status.workers[0].processExit, null, 'channel disconnect is not process-tree evidence');

  fs.writeFileSync(path.join(f.root, 'allow-exit'), 'yes');
  const disconnected = await disconnecting, evidence = await f.supervision.completionEvidence;
  assert.equal(disconnected.stopConfirmed, true);
  assert.strictEqual(disconnected.processExit, evidence);
  assert.equal(evidence.supervisor, 'windows-job'); assert.equal(evidence.launched, true);
  assert.equal(evidence.rootPid, f.pids[0]); assert.equal(evidence.rootConfirmed, true);
  assert.equal(evidence.rootExitCode, 0); assert.equal(evidence.treeConfirmed, true);
  assert.equal(evidence.activeProcesses, 0); assert.equal(evidence.failureCode, null);
  await until(() => f.pids.every(pid => !alive(pid)), 'original root and descendant must actually exit');
  const sent = await sending;
  assert.equal(sent.success, false); assert.equal(sent.code, 'EXECUTION_UNCERTAIN');
  status = f.manager.maintenanceStatus();
  assert.equal(status.workers[0].processAlive, false); assert.equal(status.workers[0].pendingCommands, 0);
  assert.equal(status.workers[0].inFlight, 1); assert.equal(status.workers[0].pendingInbound, 1);
  assert.equal(status.safe, false, 'an empty Job must not hide an unresolved original inbound request');

  f.ingress[0].writeHead(200, {'content-type': 'application/json'});
  f.ingress[0].end(JSON.stringify({delivery: {id: 'original-delivery', status: 'dispatched', action: {id: 'original-inbound-action'}}}));
  await until(() => f.manager.maintenanceStatus().safe, 'maintenance may proceed only after the original observer drains');
  status = f.manager.maintenanceStatus();
  assert.equal(status.workers[0].inFlight, 0); assert.equal(status.workers[0].pendingInbound, 0);
  assert.equal(status.workers[0].sourceActionId, 'original-connect');
  assert.equal(status.workers[0].workerNonce, f.original.residentWorker.workerNonce);
  assert.equal(status.workers[0].revision, 3); assert.equal(status.workers[0].controlEpoch, 7);
  assert.strictEqual(status.workers[0].processExit, evidence);
  assert.equal(f.requests.filter(request => request.url.endsWith('/bot-gateway-ingress')).length, 1, 'buffered inbound must not replay after admission closes');
  assert.equal(f.requests.some(request => request.url.includes('original-inbound-action')), false);
});

test('real supervisor loss leaves resident maintenance unsafe even after owned PIDs disappear', {skip: !windows, timeout: 40000}, async t => {
  const f = await fixture(t);
  assert(Number.isSafeInteger(f.supervision.child.supervisorPid));
  assert.equal(f.manager.maintenanceStatus().safe, false);
  // Kill only this fixture's original supervisor; Job kill-on-close reaps its tree.
  process.kill(f.supervision.child.supervisorPid);
  const evidence = await f.supervision.completionEvidence;
  assert.equal(evidence.failureCode, 'RUNTIME_SUPERVISOR_UNCONFIRMED');
  assert.equal(evidence.rootConfirmed, false); assert.equal(evidence.treeConfirmed, false);
  assert.equal(evidence.rootExitCode, null); assert.equal(evidence.activeProcesses, null);
  await until(() => f.pids.every(pid => !alive(pid)), 'fixture Job must reap root and descendant after supervisor loss');
  const status = f.manager.maintenanceStatus();
  assert.equal(status.safe, false); assert.equal(status.workers[0].processAlive, null);
  assert.strictEqual(status.workers[0].processExit, evidence);
  assert.equal(status.workers[0].pendingCommands, 0); assert.equal(status.workers[0].inFlight, 0);
  assert.equal(status.workers[0].sourceActionId, 'original-connect');
  assert.equal(status.workers[0].workerNonce, f.original.residentWorker.workerNonce);
  const stopped = await f.manager.operate({id: 'stop-after-unknown'}, f.options('disconnect'));
  assert.equal(stopped.stopConfirmed, false); assert.equal(stopped.code, 'EXECUTION_UNCERTAIN');
  const replacement = await f.manager.operate({id: 'replacement-connect'}, f.options('connect'));
  assert.equal(replacement.connected, false); assert.equal(replacement.code, 'EXECUTION_UNCERTAIN');
  assert.equal(f.manager.maintenanceStatus().safe, false);
});
