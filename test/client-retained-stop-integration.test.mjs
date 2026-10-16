import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { localControlRejection } from '../scripts/client-lifecycle.mjs';

// Run the production stop flow with an in-memory HTTP/native process boundary.
// No listener or Windows process is created by these protocol tests.
const source = fs.readFileSync(new URL('../scripts/client-lifecycle.mjs', import.meta.url), 'utf8');
const start = source.indexOf('export async function stopClient(');
const end = source.indexOf('/** Only the installed ziwei', start);
const body = source.slice(start, end).replace('export async function', 'async function').replace("await import('./client-retained-stop-recovery.mjs')", 'await recoveryModule()');
function fixture({ status = 409, recoveryError,modern=false } = {}) {
  const operations = [], recoveries = [], build = 'a'.repeat(64), command = 'verified-node verified-entry';
  const digest = value => createHash('sha256').update(value).digest('hex');
  const record = { pid: 4242, creationTime: '2026-10-15T00:00:00Z', commandHash: digest(command) };
  let alive = true;
  const health = { pid: record.pid, connectionState: 'connected', lifecycle: { nonce: 'bound-boot' }, activeActionCount: 0, pollingCount: 0, quarantinedActionCount: 0, maintenance: { safe: false, blockedDeliveryCount: 1 } };
  if(modern)health.maintenance.stopSafe=false;
  const ctx = vm.createContext({ process: { env: {} }, path, Date, Number, AbortSignal,
    failure: (code, message) => Object.assign(new Error(message), { code }),
    windowsOnly() {}, noLinks() {}, resolveConfigPath: () => '/private/config',
    readConfiguration: () => ({ hash: 'config-hash', config: { deviceToken: 'private-token' } }),
    healthOrigin: () => 'http://127.0.0.1:20242', clientBuildIdentity: () => build,
    health: async () => ({ ...health }), isPreIdentityHealth: () => false,
    validateHealth: value => value, inspectNativeClientProcess: async () => alive ? record : null,
    assertProcessUnchanged: async () => { assert.equal(alive, true); return record; },
    inspectNativeHealthListener: async () => ({ listenerPid: record.pid }),
    powershell: async () => ({ CommandLine: command }), digest,
    findNativePids: async () => alive ? [record.pid] : [], sleep: async () => {}, localControlRejection,
    fetch: async (_url, request) => {
      const { operation } = JSON.parse(request.body); operations.push(operation);
      if (operation === 'stop') return { ok: false, status, json: async () => null };
      health.connectionState = operation === 'pause' ? 'draining' : 'connected';
      return { ok: true, json: async () => ({ ...health }) };
    },
    recoveryModule: async () => ({ shouldAttemptRetainedClientStopRecovery:value=>!Object.hasOwn(value.maintenance,'stopSafe'),recoverRetainedClientStop: async input => {
      recoveries.push(input); assert.equal(health.connectionState, 'draining');
      assert.equal((await input.assertCurrent()).pid, record.pid);
      if (recoveryError) throw recoveryError;
      alive = false; return { stopped: true };
    } }),
  });
  vm.runInContext(body, ctx);
  return { stop: options => ctx.stopClient({ root: '/installed/ziwei', ...options }), operations, recoveries, get alive() { return alive; } };
}

test('verified update candidate recovers a refused old stop while remaining drained', async () => {
  const f = fixture(), result = await f.stop({ retainedRecoveryRoot: '/verified/candidate' });
  assert.equal(result.stopped, true); assert.equal(f.alive, false);
  assert.deepEqual(f.operations, ['pause', 'stop']); assert.equal(f.recoveries.length, 1);
  assert.equal(f.recoveries[0].recoveryRoot, '/verified/candidate');
  assert.equal(f.recoveries[0].context.snapshot.hash, 'config-hash');
});

test('ordinary stop never terminates a daemon refusing maintenance', async () => {
  const f = fixture(); await assert.rejects(f.stop(), error => error.code === 'CONTROL_REJECTED' && error.resumed === true);
  assert.equal(f.alive, true); assert.equal(f.recoveries.length, 0); assert.deepEqual(f.operations, ['pause', 'stop', 'resume']);
});

for (const status of [401, 403, 500]) test(`HTTP ${status} cannot trigger retained stop recovery`, async () => {
  const f = fixture({ status }); await assert.rejects(f.stop({ retainedRecoveryRoot: '/verified/candidate' }), error => error.code === 'CONTROL_REJECTED');
  assert.equal(f.alive, true); assert.equal(f.recoveries.length, 0); assert.deepEqual(f.operations, ['pause', 'stop', 'resume']);
});

test('failed recovery validation preserves the original process and resumes reception', async () => {
  const f = fixture({ recoveryError: Object.assign(new Error('evidence changed'), { code: 'PROCESS_CHANGED' }) });
  await assert.rejects(f.stop({ retainedRecoveryRoot: '/verified/candidate' }), error => error.code === 'PROCESS_CHANGED' && error.resumed === true && error.cause?.code==='CONTROL_REJECTED');
  assert.equal(f.alive, true); assert.deepEqual(f.operations, ['pause', 'stop', 'resume']);
});

test('an unsupported modern refusal preserves the original 409 instead of entering legacy recovery',async()=>{
  const f=fixture({modern:true});
  await assert.rejects(f.stop({retainedRecoveryRoot:'/verified/candidate'}),error=>error.code==='CONTROL_REJECTED'&&error.httpStatus===409&&error.resumed===true);
  assert.equal(f.alive,true);assert.equal(f.recoveries.length,0);assert.deepEqual(f.operations,['pause','stop','resume']);
});
