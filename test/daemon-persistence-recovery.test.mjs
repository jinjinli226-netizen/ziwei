import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ActionDispatcher } from '../src/daemon.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-dispatch-recovery-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('ziwei-dispatch-recovery-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, stateFile: path.join(root, 'action-state.json') };
}
const action = (extra = {}) => ({ id: 'action-recovery', dedupe_key: 'dedupe-recovery', type: 'task.execute', workspace_id: 'workspace-a', payload: { deviceId: 'device-a' }, ...extra });

test('dispatcher flushes a durable started record before invoking the executor', async t => {
  const f = fixture(t);
  const originalFsync = fs.fsyncSync;
  let flushes = 0;
  t.mock.method(fs, 'fsyncSync', descriptor => { flushes += 1; return originalFsync(descriptor); });
  const dispatcher = new ActionDispatcher({ ...f, workdir: f.root, execute: async () => {
    const state = JSON.parse(fs.readFileSync(f.stateFile, 'utf8'));
    assert.equal(state.version, 2);
    assert.equal(state.started[0].actionId, 'action-recovery');
    assert.equal(state.started[0].key, 'dedupe-recovery');
    assert.equal(state.completed.length, 0);
    assert.ok(flushes > 0, 'execution cannot begin before a successful filesystem flush');
    return { output: 'fixture-only' };
  } });
  const result = await dispatcher.dispatch(action());
  assert.equal(result.status, 'succeeded');
  const saved = JSON.parse(fs.readFileSync(f.stateFile, 'utf8'));
  assert.equal(saved.completed[0].result.result.output, 'fixture-only');
});

test('a restart after durable started without a terminal result refuses to execute again', async t => {
  const f = fixture(t);
  fs.writeFileSync(f.stateFile, JSON.stringify({ version: 2, completed: [], started: [{ key: 'dedupe-recovery', actionId: 'action-recovery', identity: { workspaceId: 'workspace-a', targetDeviceId: 'device-a' }, startedAt: 1 }] }));
  let executions = 0;
  const dispatcher = new ActionDispatcher({ ...f, workdir: f.root, execute: async () => { executions += 1; return {}; } });
  const result = await dispatcher.dispatch(action());
  assert.equal(result.status, 'failed');
  assert.equal(result.code, 'EXECUTION_UNCERTAIN');
  assert.equal(result.reason, 'STARTED_WITHOUT_RESULT');
  assert.match(result.error, /人工|核实|uncertain/i);
  assert.equal(executions, 0);
  assert.equal(JSON.parse(fs.readFileSync(f.stateFile, 'utf8')).started.length, 1);
});

test('completed results survive a restart and replay only the original T9 image output', async t => {
  const f = fixture(t);
  const imageResult = { output: 'fixture image', imageArtifacts: [{ filename: 'fixture.png', contentBase64: 'cG5n', mimeType: 'image/png' }] };
  const first = new ActionDispatcher({ ...f, workdir: f.root, execute: async () => imageResult });
  assert.equal((await first.dispatch(action())).status, 'succeeded');
  let executions = 0;
  const restarted = new ActionDispatcher({ ...f, workdir: f.root, execute: async () => { executions += 1; return {}; } });
  const result = await restarted.dispatch(action());
  assert.equal(result.status, 'duplicate');
  assert.equal(result.originalStatus, 'succeeded');
  assert.deepEqual(result.result, imageResult);
  assert.equal(executions, 0);
});

test('legacy v1 completed state remains a duplicate without clearing its history', async t => {
  const f = fixture(t);
  fs.writeFileSync(f.stateFile, JSON.stringify({ version: 1, completed: [{ key: 'dedupe-recovery', result: { status: 'succeeded', actionId: 'action-recovery', result: { output: 'legacy-result' }, completedAt: 1 } }] }));
  const before = fs.readFileSync(f.stateFile, 'utf8');
  let executions = 0;
  const dispatcher = new ActionDispatcher({ ...f, workdir: f.root, execute: async () => { executions += 1; return {}; } });
  const result = await dispatcher.dispatch(action());
  assert.equal(result.status, 'duplicate');
  assert.equal(result.result.output, 'legacy-result');
  assert.equal(executions, 0);
  assert.equal(fs.readFileSync(f.stateFile, 'utf8'), before);
});

test('corrupt or invalid persisted state blocks all execution and is preserved', async t => {
  for (const contents of ['{broken-json', JSON.stringify({ version: 2, completed: 'lost', started: [] }), JSON.stringify({ version: 2, completed: [{ key: 'x', result: null }], started: [] }), JSON.stringify({ version: 2, completed: [{ key: 'dedupe-recovery', result: { status: 'succeeded', actionId: 'action-recovery' } }], started: [] })]) {
    const f = fixture(t);
    fs.writeFileSync(f.stateFile, contents);
    let executions = 0;
    const dispatcher = new ActionDispatcher({ ...f, workdir: f.root, execute: async () => { executions += 1; return {}; } });
    const result = await dispatcher.dispatch(action());
    assert.equal(result.status, 'failed');
    assert.equal(result.code, 'EXECUTION_UNCERTAIN');
    assert.equal(result.reason, 'ACTION_STATE_CORRUPT');
    assert.equal(executions, 0);
    assert.equal(fs.readFileSync(f.stateFile, 'utf8'), contents);
  }
});

test('an isolated process crash after execution starts cannot replay the side effect after restart', async t => {
  const f = fixture(t);
  const source = new URL('../src/daemon.mjs', import.meta.url).href;
  const sideEffect = path.join(f.root, 'fixture-side-effect.txt');
  const script = `import fs from 'node:fs'; import { ActionDispatcher } from ${JSON.stringify(source)}; const f = JSON.parse(process.argv[1]); const dispatcher = new ActionDispatcher({ workdir: f.root, stateFile: f.stateFile, execute: async () => { fs.appendFileSync(f.sideEffect, 'executed\\n'); process.exit(86); } }); await dispatcher.dispatch(f.action);`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify({ ...f, sideEffect, action: action() })], { encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 86, child.stderr);
  const restarted = new ActionDispatcher({ ...f, workdir: f.root, execute: async () => { fs.appendFileSync(sideEffect, 'replayed\n'); return {}; } });
  const result = await restarted.dispatch(action());
  assert.equal(result.code, 'EXECUTION_UNCERTAIN');
  assert.equal(result.reason, 'STARTED_WITHOUT_RESULT');
  assert.equal(fs.readFileSync(sideEffect, 'utf8'), 'executed\n');
});

test('concurrent retries with one action ID and different dedupe keys share one execution', async t => {
  const f = fixture(t);
  let executions = 0; let release; let entered;
  const began = new Promise(resolve => { entered = resolve; });
  const dispatcher = new ActionDispatcher({ ...f, workdir: f.root, execute: async () => { executions += 1; entered(); return await new Promise(resolve => { release = resolve; }); } });
  const first = dispatcher.dispatch(action());
  await began;
  const retry = dispatcher.dispatch(action({ dedupe_key: 'concurrent-retry-key' }));
  release({ output: 'fixture-only' });
  assert.equal((await first).status, 'succeeded');
  assert.equal((await retry).status, 'duplicate');
  assert.equal(executions, 1);
});

test('a dedupe key reused for another action ID cannot expose the cached result or execute', async t => {
  const f = fixture(t);
  let executions = 0;
  const dispatcher = new ActionDispatcher({ ...f, workdir: f.root, execute: async () => { executions += 1; return { privateResult: 'fixture-only' }; } });
  assert.equal((await dispatcher.dispatch(action())).status, 'succeeded');
  const result = await dispatcher.dispatch(action({ id: 'different-action' }));
  assert.equal(result.reason, 'ACTION_IDENTITY_MISMATCH');
  assert.equal(result.result, undefined);
  assert.equal(executions, 1);
});

test('an expired unstarted action is terminally rejected rather than replayed', async t => {
  const f = fixture(t);
  let executions = 0;
  const dispatcher = new ActionDispatcher({ ...f, workdir: f.root, execute: async () => { executions += 1; return {}; } });
  const expired = action({ expires_at: '2000-01-01T00:00:00Z' });
  const result = await dispatcher.dispatch(expired);
  assert.equal(result.status, 'failed');
  assert.match(result.error, /expired/);
  const saved = JSON.parse(fs.readFileSync(f.stateFile, 'utf8'));
  assert.equal(saved.started.length, 0);
  const restarted = new ActionDispatcher({ ...f, workdir: f.root, execute: async () => { executions += 1; return {}; } });
  assert.equal((await restarted.dispatch(expired)).originalStatus, 'failed');
  assert.equal(executions, 0);
});

test('v1 completed history remains recoverable when a new action upgrades the snapshot to v2', async t => {
  const f = fixture(t);
  fs.writeFileSync(f.stateFile, JSON.stringify({ version: 1, completed: [{ key: 'legacy-key', result: { status: 'succeeded', actionId: 'legacy-action', result: { output: 'legacy-result' }, completedAt: 1 } }] }));
  const dispatcher = new ActionDispatcher({ ...f, workdir: f.root, execute: async () => ({ output: 'new-result' }) });
  assert.equal((await dispatcher.dispatch(action())).status, 'succeeded');
  let executions = 0;
  const restarted = new ActionDispatcher({ ...f, workdir: f.root, execute: async () => { executions += 1; return {}; } });
  const legacy = await restarted.dispatch({ id: 'legacy-action', dedupe_key: 'legacy-key', type: 'task.execute' });
  assert.equal(legacy.status, 'duplicate');
  assert.equal(legacy.result.output, 'legacy-result');
  assert.equal(executions, 0);
});

test('a started-state flush failure cannot launch the executor or claim success', async t => {
  const f = fixture(t);
  let executions = 0;
  t.mock.method(fs, 'fsyncSync', () => { throw new Error('fixture flush failure'); });
  const dispatcher = new ActionDispatcher({ ...f, workdir: f.root, execute: async () => { executions += 1; return {}; } });
  const result = await dispatcher.dispatch(action());
  assert.equal(result.status, 'failed');
  assert.equal(result.code, 'EXECUTION_UNCERTAIN');
  assert.equal(result.reason, 'ACTION_STATE_WRITE_FAILED');
  assert.equal(executions, 0);
});

test('a terminal-state write failure retains started and refuses re-execution in memory or after restart', async t => {
  const f = fixture(t);
  const originalRename = fs.renameSync;
  let renames = 0;
  t.mock.method(fs, 'renameSync', (...args) => { if (++renames === 2) throw new Error('fixture terminal rename failure'); return originalRename(...args); });
  let executions = 0;
  const dispatcher = new ActionDispatcher({ ...f, workdir: f.root, execute: async () => { executions += 1; return { sideEffect: 'fixture-only' }; } });
  const result = await dispatcher.dispatch(action());
  assert.equal(result.status, 'failed');
  assert.equal(result.code, 'EXECUTION_UNCERTAIN');
  assert.equal(result.reason, 'ACTION_STATE_WRITE_FAILED');
  const saved = JSON.parse(fs.readFileSync(f.stateFile, 'utf8'));
  assert.equal(saved.started.length, 1);
  assert.equal(saved.completed.length, 0);
  assert.equal((await dispatcher.dispatch(action())).code, 'EXECUTION_UNCERTAIN');
  const restarted = new ActionDispatcher({ ...f, workdir: f.root, execute: async () => { executions += 1; return {}; } });
  assert.equal((await restarted.dispatch(action())).code, 'EXECUTION_UNCERTAIN');
  assert.equal(executions, 1);
});

test('one completed action ID cannot execute again under an altered dedupe key', async t => {
  const f = fixture(t);
  let executions = 0;
  const dispatcher = new ActionDispatcher({ ...f, workdir: f.root, execute: async () => { executions += 1; return {}; } });
  assert.equal((await dispatcher.dispatch(action())).status, 'succeeded');
  const result = await dispatcher.dispatch(action({ dedupe_key: 'changed-dedupe' }));
  assert.equal(result.status, 'duplicate');
  assert.equal(executions, 1);
});

test('cached result cannot cross a different workspace or paired-device binding', async t => {
  const f = fixture(t);
  let executions = 0;
  const first = new ActionDispatcher({ ...f, workdir: f.root, workspace: 'workspace-a', deviceId: 'paired-a', execute: async () => { executions += 1; return { privateResult: 'fixture-only' }; } });
  assert.equal((await first.dispatch(action())).status, 'succeeded');
  for (const options of [{ workspace: 'workspace-b', deviceId: 'paired-a' }, { workspace: 'workspace-a', deviceId: 'paired-b' }]) {
    const restarted = new ActionDispatcher({ ...f, ...options, workdir: f.root, execute: async () => { executions += 1; return {}; } });
    const result = await restarted.dispatch(action());
    assert.equal(result.status, 'failed');
    assert.equal(result.code, 'EXECUTION_UNCERTAIN');
    assert.equal(result.reason, 'ACTION_IDENTITY_MISMATCH');
    assert.equal(result.result, undefined);
  }
  assert.equal(executions, 1);
});
