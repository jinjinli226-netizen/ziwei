import test from 'node:test';
import assert from 'node:assert/strict';
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

test('rejects A2A workdirs outside the registered runtime directory', async () => {
  const dispatcher = new ActionDispatcher({ workdir: 'C:/ziwei-runtime', execute: async () => ({ok:true}) });
  const result = await dispatcher.dispatch({ id:'a-escape', dedupeKey:'escape', type:'command.execute', payload:{cwd:'../secrets'} });
  assert.equal(result.status, 'failed');
  assert.match(result.error, /outside the registered runtime directory/);
});
