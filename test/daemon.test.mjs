import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActionDispatcher} from '../src/daemon.mjs';

test('acknowledges an action once and deduplicates retries', async () => {
  const events = [];
  const dispatcher = new ActionDispatcher({
    execute: async action => { events.push(action.id); return {ok: true}; },
    now: () => 1000
  });
  const action = {id: 'a-1', dedupeKey: 'task-1:attempt-1', type: 'task.execute'};
  assert.equal((await dispatcher.dispatch(action)).status, 'succeeded');
  assert.equal((await dispatcher.dispatch(action)).status, 'duplicate');
  assert.deepEqual(events, ['a-1']);
});

test('agent actions default to the registered project workdir for local CLI access', async t => {
  let received;
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-default-workdir-'));
  t.after(() => fs.rmSync(workdir, { recursive: true, force: true }));
  const dispatcher = new ActionDispatcher({
    workdir,
    execute: async action => { received = action; return {ok: true}; },
    now: () => 1000
  });
  const result = await dispatcher.dispatch({ id:'a-project', dedupeKey:'project', type:'agent.execute', payload:{prompt:'inspect the project'} });
  assert.equal(result.status, 'succeeded');
  assert.equal(received.payload.workdir, fs.realpathSync.native(workdir));
});

test('rejects A2A workdirs outside the registered runtime directory', async () => {
  const dispatcher = new ActionDispatcher({ workdir: 'C:/ziwei-runtime', execute: async () => ({ok:true}) });
  const result = await dispatcher.dispatch({ id:'a-escape', dedupeKey:'escape', type:'command.execute', payload:{cwd:'../secrets'} });
  assert.equal(result.status, 'failed');
  assert.match(result.error, /outside the registered runtime directory/);
});

test('summarizes CLI output as a safe execution stage instead of a generic update', async () => {
  const events = [];
  const dispatcher = new ActionDispatcher({
    execute: async (_action, context) => { context.onOutput('running command: rg --files'); return {ok:true}; },
    onEvent: (type, payload) => events.push({type, payload}),
    now: () => 1000
  });
  const result = await dispatcher.dispatch({ id:'a-stage', dedupeKey:'stage', type:'agent.execute', payload:{prompt:'inspect'} });
  assert.equal(result.status, 'succeeded');
  const output = events.find(event => event.type === 'action.output');
  assert.equal(output?.payload?.message, '运行命令');
  assert.equal(output?.payload?.stage, 'command');
});

test('forwards the provider public reasoning summary without exposing raw reasoning tokens', async () => {
  const events = [];
  const dispatcher = new ActionDispatcher({
    execute: async (_action, context) => {
      context.onStage({
        stage: 'reasoning',
        message: '思考摘要',
        detail: '公开推理摘要',
        summary: '先检查任务状态，再运行验证。 token=[REDACTED]'
      });
      return {ok: true};
    },
    onEvent: (type, payload) => events.push({type, payload}),
    now: () => 1000
  });
  const result = await dispatcher.dispatch({ id:'a-reasoning', dedupeKey:'reasoning', type:'agent.execute', payload:{prompt:'inspect'} });
  assert.equal(result.status, 'succeeded');
  const reasoning = events.find(event => event.type === 'action.stage' && event.payload.stage === 'reasoning');
  assert.equal(reasoning?.payload?.detail, '公开推理摘要');
  assert.equal(reasoning?.payload?.summary, '先检查任务状态，再运行验证。 token=[REDACTED]');
});

test('fails an action after the configured idle timeout even before the hard deadline', async () => {
  const dispatcher = new ActionDispatcher({
    execute: async () => new Promise(resolve => setTimeout(() => resolve({ok: true}), 180)),
    now: () => Date.now()
  });
  const result = await dispatcher.dispatch({
    id: 'a-idle-timeout', dedupeKey: 'idle-timeout', type: 'agent.execute',
    payload: {prompt: 'wait', timeoutMs: 400, idleTimeoutMs: 100}
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.code, 'action_timeout');
  assert.match(result.error, /no activity/i);
});

test('keeps an active action alive when progress arrives before the idle timeout', async () => {
  const dispatcher = new ActionDispatcher({
    execute: async (_action, context) => {
      for (let index = 0; index < 4; index += 1) {
        await new Promise(resolve => setTimeout(resolve, 60));
        context.onProgress({runtime: 'Codex', bytes: index + 1});
      }
      return {ok: true};
    },
    now: () => Date.now()
  });
  const result = await dispatcher.dispatch({
    id: 'a-active-timeout', dedupeKey: 'active-timeout', type: 'agent.execute',
    payload: {prompt: 'progress', timeoutMs: 400, idleTimeoutMs: 100}
  });
  assert.equal(result.status, 'succeeded');
});
