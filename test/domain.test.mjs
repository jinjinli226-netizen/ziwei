import test from 'node:test';
import assert from 'node:assert/strict';
import {transitionTask, TASK_STATES} from '../src/domain.mjs';

test('transitions a task through the valid workflow', () => {
  assert.equal(transitionTask('planned', 'todo'), 'todo');
  assert.equal(transitionTask('todo', 'in_progress'), 'in_progress');
  assert.equal(transitionTask('in_progress', 'review'), 'review');
  assert.equal(transitionTask('review', 'completed'), 'completed');
});

test('allows blocking and cancellation from active states', () => {
  assert.equal(transitionTask('in_progress', 'blocked'), 'blocked');
  assert.equal(transitionTask('blocked', 'cancelled'), 'cancelled');
});

test('rejects invalid task transitions', () => {
  assert.throws(() => transitionTask('completed', 'in_progress'), /Invalid task transition/);
  assert.deepEqual(TASK_STATES, ['planned','todo','in_progress','review','completed','blocked','cancelled']);
});
