import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ActionDispatcher } from '../src/daemon.mjs';
import { createActionScheduler } from '../src/daemon-action-scheduler.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const action = (id, payload = {}) => ({ id, type: 'agent.execute', payload: { prompt: 'fixture only', ...payload } });
const evidence = treeConfirmed => ({ platform: 'win32', supervisor: 'windows-job', launched: true, rootPid: 12345, rootConfirmed: true, treeConfirmed, activeProcesses: treeConfirmed ? 0 : null });
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-supervision-'));
  t.after(() => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert(path.basename(root).startsWith('ziwei-supervision-')); fs.rmSync(root, { recursive: true, force: true }); });
  return { workdir: root, stateFile: path.join(root, 'state.json') };
}

test('native default silence emits one honest waiting event and does not fail or fabricate progress', async () => {
  let clock = Date.now(); const events = [];
  const dispatcher = new ActionDispatcher({ now: () => clock, onEvent: (type, data) => events.push({ type, data }), execute: async () => {
    clock += 120001; await delay(1120); return { ok: true };
  } });
  const result = await dispatcher.dispatch(action('silent'));
  assert.equal(result.status, 'succeeded');
  assert.equal(events.filter(e => e.type === 'action.waiting').length, 1);
  assert.match(events.find(e => e.type === 'action.waiting').data.message, /未收到.*输出/);
  assert.equal(events.filter(e => e.type === 'action.progress').length, 0);
});

test('native execution refuses an ACK lease with less than sixty seconds of shutdown reserve', async () => {
  let calls = 0;
  const dispatcher = new ActionDispatcher({ execute: async () => { calls++; return {}; } });
  const result = await dispatcher.dispatch({ ...action('short-lease'), expires_at: new Date(Date.now() + 30000).toISOString() });
  assert.equal(result.code, 'ACTION_LEASE_INSUFFICIENT'); assert.equal(calls, 0);
});

test('raw activity refreshes explicit idle without creating a progress event', async () => {
  const events = [];
  const dispatcher = new ActionDispatcher({ onEvent: type => events.push(type), execute: async (_a, context) => {
    for (let index = 0; index < 6; index++) { await delay(35); context.onActivity({ stream: 'stderr', bytes: 1 }); }
    return {};
  } });
  assert.equal((await dispatcher.dispatch(action('stderr', { idleTimeoutMs: 100 }))).status, 'succeeded');
  assert.equal(events.includes('action.progress'), false);
});

test('hard deadline stays fixed despite output and waits for an unsupervised executor to settle', async () => {
  let ended = false; let aborted = false;
  const dispatcher = new ActionDispatcher({ stopGraceMs: 500, execute: async (_a, context) => {
    context.signal.addEventListener('abort', () => { aborted = true; });
    for (let index = 0; index < 8; index++) { await delay(30); context.onActivity?.({ stream: 'stdout', bytes: 1 }); }
    ended = true; return {};
  } });
  const result = await dispatcher.dispatch(action('hard', { timeoutMs: 100 }));
  assert.equal(result.code, 'action_timeout'); assert.equal(aborted, true); assert.equal(ended, true);
});

test('Windows unconfirmed tree persists quarantine and blocks other actions after restart', async t => {
  const f = fixture(t); let calls = 0;
  const dispatcher = new ActionDispatcher({ ...f, stopGraceMs: 25, execute: async (_a, context) => {
    calls++; context.onSupervision({ completionEvidence: Promise.resolve(evidence(false)), stop: async () => evidence(false) });
    await new Promise(resolve => context.signal.addEventListener('abort', resolve, { once: true })); return {};
  } });
  const result = await dispatcher.dispatch(action('unknown', { idleTimeoutMs: 100 }));
  assert.equal(result.code, 'EXECUTION_UNCERTAIN'); assert.equal(dispatcher.quarantined, true);
  assert.equal(dispatcher.status('unknown').running, true);
  const saved = JSON.parse(fs.readFileSync(f.stateFile));
  assert.equal(saved.completed.length, 0); assert.equal(saved.started[0].quarantine.stopConfirmed, false);
  assert.equal((await dispatcher.dispatch(action('next'))).reason, 'EXECUTION_QUARANTINED'); assert.equal(calls, 1);
  const recovered = new ActionDispatcher({ ...f, execute: async () => { calls++; return {}; } });
  assert.equal(recovered.quarantined, true);
  assert.equal((await recovered.dispatch(action('after-restart'))).reason, 'EXECUTION_QUARANTINED'); assert.equal(calls, 1);
});

test('timeout waits for a reliable Windows tree receipt before reporting the terminal timeout', async () => {
  const stopped = deferred(); let receipt = false;
  const dispatcher = new ActionDispatcher({ stopGraceMs: 500, execute: async (_a, context) => {
    context.onSupervision({ completionEvidence: stopped.promise, stop: async () => { await delay(70); receipt = true; stopped.resolve(evidence(true)); return evidence(true); } });
    await new Promise(resolve => context.signal.addEventListener('abort', resolve, { once: true })); return {};
  } });
  const result = await dispatcher.dispatch(action('confirmed', { idleTimeoutMs: 100 }));
  assert.equal(result.code, 'action_timeout'); assert.equal(receipt, true); assert.equal(dispatcher.quarantined, false);
});

test('late reliable stop evidence releases quarantine durably without turning the uncertain action into success', async t => {
  const f = fixture(t); const stopped = deferred();
  const dispatcher = new ActionDispatcher({ ...f, stopGraceMs: 25, execute: async (_a, context) => {
    if (_a.id !== 'late') return {};
    context.onSupervision({ completionEvidence: stopped.promise, stop: () => stopped.promise });
    await new Promise(resolve => context.signal.addEventListener('abort', resolve, { once: true })); return {};
  } });
  assert.equal((await dispatcher.dispatch(action('late', { idleTimeoutMs: 100 }))).code, 'EXECUTION_UNCERTAIN');
  assert.equal(dispatcher.quarantined, true);
  stopped.resolve(evidence(true)); await delay(20);
  assert.equal(dispatcher.quarantined, false);
  const saved = JSON.parse(fs.readFileSync(f.stateFile));
  assert.equal(saved.completed.length, 1); assert.equal(saved.started[0].quarantine.stopConfirmed, true);
  assert.equal(saved.completed[0].result.status, 'failed'); assert.equal(saved.completed[0].result.result.processExit.treeConfirmed, true);
  const duplicate = await dispatcher.dispatch(action('late')); assert.equal(duplicate.status, 'duplicate'); assert.equal(duplicate.originalStatus, 'failed');
  assert.equal((await dispatcher.dispatch(action('new'))).status, 'succeeded');
  const recovered = new ActionDispatcher({ ...f, execute: async () => ({}) }); assert.equal(recovered.quarantined, false);
});

test('explicit cancellation uses the same bounded stop confirmation instead of immediately releasing execution', async () => {
  const entered = deferred(); const stopped = deferred(); let confirmed = false;
  const dispatcher = new ActionDispatcher({ stopGraceMs: 500, execute: async (_a, context) => {
    entered.resolve();
    context.onSupervision({ completionEvidence: stopped.promise, stop: async () => { await delay(60); confirmed = true; stopped.resolve(evidence(true)); return evidence(true); } });
    await new Promise(resolve => context.signal.addEventListener('abort', resolve, { once: true })); return {};
  } });
  const running = dispatcher.dispatch(action('cancel')); await entered.promise; assert.equal(dispatcher.cancel('cancel'), true);
  assert.equal((await running).code, 'cancelled'); assert.equal(confirmed, true);
});

test('quarantine remains occupied across schedulers until confirmed and blocks actions already queued', async () => {
  let blocked = false; const ids = new Set(); const calls = [];
  const options = { canStart: () => !blocked, quarantinedActionIds: () => [...ids] };
  const a = createActionScheduler({ ...options, execute: async item => { calls.push(item.id); blocked = true; ids.add(item.id); } });
  const b = createActionScheduler({ ...options, execute: async item => { calls.push(item.id); } });
  a.schedule([action('one')]); await delay(0);
  assert.equal(a.activeCount, 1); assert.deepEqual(b.schedule([action('two')]), []);
  blocked = false; ids.clear(); assert.equal(a.activeCount, 0);
  b.schedule([action('three')]); blocked = true; await b.whenIdle(); assert.deepEqual(calls, ['one']);
});

test('a root that never launched with a confirmed empty tree does not quarantine a launch failure', async () => {
  const dispatcher = new ActionDispatcher({ execute: async (_a, context) => {
    const failed = { ...evidence(true), launched: false, rootConfirmed: false, rootPid: null };
    context.onSupervision({ completionEvidence: Promise.resolve(failed), stop: async () => failed });
    return { status: 'failed', code: 'runtime_failed', error: 'isolated launch failure' };
  } });
  assert.equal((await dispatcher.dispatch(action('never-launched'))).code, 'runtime_failed');
  assert.equal(dispatcher.quarantined, false);
});

test('normal successful root exit can intentionally leave background children', async () => {
  let stops = 0;
  const dispatcher = new ActionDispatcher({ execute: async (_a, context) => {
    context.onSupervision({ completionEvidence: Promise.resolve({ ...evidence(false), activeProcesses: 1 }), stop: async () => { stops++; return evidence(true); } });
    return { status: 'succeeded', result: { backgroundStarted: true } };
  } });
  assert.equal((await dispatcher.dispatch(action('background'))).status, 'succeeded');
  assert.equal(stops, 0); assert.equal(dispatcher.quarantined, false);
});

test('stop receipt alone cannot release executor cleanup or permit late output events', async () => {
  let cleaned = false; const events = [];
  const dispatcher = new ActionDispatcher({ stopGraceMs: 500, onEvent: type => events.push(type), execute: async (_a, context) => {
    context.onSupervision({ completionEvidence: new Promise(() => {}), stop: async () => evidence(true) });
    await new Promise(resolve => context.signal.addEventListener('abort', resolve, { once: true }));
    context.onOutput('late output'); context.onStage({ stage: 'tool' }); context.onProgress({ bytes: 1 });
    await delay(80); cleaned = true; return {};
  } });
  const result = await dispatcher.dispatch(action('cleanup', { idleTimeoutMs: 100 }));
  assert.equal(result.code, 'action_timeout'); assert.equal(cleaned, true);
  assert.equal(events.some(type => ['action.output', 'action.stage', 'action.progress'].includes(type)), false);
  assert.equal(result.result.processExit.treeConfirmed, true);
  assert.match(result.error, /写入/);
});

test('late proof needs executor cleanup before releasing quarantine and keeps only safe receipt fields', async t => {
  const f = fixture(t); const cleanup = deferred();
  const dispatcher = new ActionDispatcher({ ...f, stopGraceMs: 25, execute: async (_a, context) => {
    context.onSupervision({ completionEvidence: Promise.resolve({ ...evidence(true), secret: 'do-not-store' }), stop: async () => ({ ...evidence(true), secret: 'do-not-store' }) });
    await new Promise(resolve => context.signal.addEventListener('abort', resolve, { once: true })); await cleanup.promise; return {};
  } });
  const result = await dispatcher.dispatch(action('late-cleanup', { idleTimeoutMs: 100 }));
  assert.equal(result.code, 'EXECUTION_UNCERTAIN'); assert.equal(dispatcher.quarantined, true);
  assert.equal(result.result.processExit.treeConfirmed, true); assert.equal(JSON.stringify(result).includes('do-not-store'), false);
  cleanup.resolve(); await delay(20); assert.equal(dispatcher.quarantined, false);
});

test('actual ACK expiry clamps an explicit longer native deadline with sixty-second reserve', async () => {
  let aborted = false;
  const dispatcher = new ActionDispatcher({ stopGraceMs: 500, execute: async (_a, context) => {
    context.signal.addEventListener('abort', () => { aborted = true; }); await delay(300); return {};
  } });
  const result = await dispatcher.dispatch({ ...action('lease-clamp', { timeoutMs: 5000 }), expires_at: new Date(Date.now() + 60150).toISOString() });
  assert.equal(result.code, 'action_timeout'); assert.equal(aborted, true);
});

test('cancel control receipt describes only the accepted request while target shutdown is unconfirmed', async () => {
  const entered = deferred(); const stopped = deferred(); const events = [];
  const dispatcher = new ActionDispatcher({ stopGraceMs: 30, onEvent: type => events.push(type), execute: async (_a, context) => {
    context.onSupervision({ completionEvidence: stopped.promise, stop: () => stopped.promise });
    entered.resolve(); await new Promise(resolve => context.signal.addEventListener('abort', resolve, { once: true })); return {};
  } });
  const running=dispatcher.dispatch(action('target-control'));await entered.promise;
  const response=await dispatcher.dispatch({id:'cancel-control',type:'action.cancel',payload:{actionId:'target-control'}});
  assert.equal(response.status,'succeeded');assert.equal(response.result.cancellationRequested,true);assert.equal(response.result.stopConfirmed,false);
  assert.notEqual(response.result.cancelled,true);assert.equal(events.includes('action.cancelled'),false);
  assert.equal((await running).code,'EXECUTION_UNCERTAIN');stopped.resolve(evidence(true));await delay(10);
});

test('a missing controller cannot claim a target stopped after an uncertain restart',async t=>{
 const f=fixture(t),stopped=deferred();
 const first=new ActionDispatcher({...f,stopGraceMs:10,execute:async(_a,context)=>{
  context.onSupervision({completionEvidence:stopped.promise,stop:()=>stopped.promise});
  await new Promise(resolve=>context.signal.addEventListener('abort',resolve,{once:true}));return {};
 }});
 await first.dispatch(action('unknown-restart',{idleTimeoutMs:100}));
 const recovered=new ActionDispatcher({...f,execute:async()=>{throw new Error('no execution');}});
 const response=await recovered.dispatch({id:'unknown-stop',type:'action.cancel',payload:{actionId:'unknown-restart'}});
 assert.equal(response.status,'failed');assert.equal(response.code,'CANCEL_TARGET_UNCONFIRMED');
 assert.equal(response.result.stopConfirmed,false);assert.equal(response.result.cancellationRequested,false);
 assert.equal(recovered.quarantined,true);assert.match(response.result.message,/无法确认/);
 stopped.resolve(evidence(true));await delay(10);
});

test('cancellation can stop a quarantined runtime after its controller has been removed',async()=>{
 const stopped=deferred();let stops=0;
 const dispatcher=new ActionDispatcher({stopGraceMs:10,execute:async(_a,context)=>{
  context.onSupervision({completionEvidence:stopped.promise,stop:async()=>{stops++;stopped.resolve({...evidence(true),cancelled:true,rootExitCode:null});return stopped.promise;}});
  return {};
 }});
 assert.equal((await dispatcher.dispatch(action('root-unknown'))).code,'EXECUTION_UNCERTAIN');
 assert.equal(dispatcher.quarantined,true);
 const response=await dispatcher.dispatch({id:'root-stop',type:'action.cancel',payload:{actionId:'root-unknown'}});
 assert.equal(response.result.cancellationRequested,true);await delay(10);
 assert.equal(stops,1);assert.equal(dispatcher.quarantined,false);
 assert.equal(dispatcher.completedResult(action('root-unknown')).originalStatus,'failed');
});

test('a new cancel can retry a settled unconfirmed stop without executing the original action again',async()=>{
 let stops=0,executions=0;
 const dispatcher=new ActionDispatcher({stopGraceMs:10,execute:async(_a,context)=>{
  executions++;context.onSupervision({completionEvidence:new Promise(()=>{}),stop:async()=>{
   stops++;return {...evidence(stops>1),rootExitCode:null,cancelled:true};
  }});
  await new Promise(resolve=>context.signal.addEventListener('abort',resolve,{once:true}));return {};
 }});
 assert.equal((await dispatcher.dispatch(action('stop-retry',{idleTimeoutMs:100}))).code,'EXECUTION_UNCERTAIN');
 assert.equal(stops,1);assert.equal(dispatcher.quarantined,true);
 const response=await dispatcher.dispatch({id:'retry-stop-control',type:'action.cancel',payload:{actionId:'stop-retry'}});
 assert.equal(response.result.cancellationRequested,true);await delay(10);
 assert.equal(stops,2);assert.equal(executions,1);assert.equal(dispatcher.quarantined,false);
 assert.equal(dispatcher.completedResult(action('stop-retry')).originalStatus,'failed');
});
