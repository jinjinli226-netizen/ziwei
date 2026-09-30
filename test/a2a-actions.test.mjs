import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../backend/repository.mjs';

test('A2A actions support dedupe, ack, result and expiry', () => {
  const repo = createRepository({ memory: true });
  const first = repo.createA2AAction('test-111', { agentId: 'ziwei_user', type: 'task.execute', dedupeKey: 'task-1:attempt-1', payload: { title: 'hello' } });
  const duplicate = repo.createA2AAction('test-111', { agentId: 'ziwei_user', type: 'task.execute', dedupeKey: 'task-1:attempt-1' });
  assert.equal(duplicate.id, first.id);
  assert.equal(duplicate.duplicate, true);
  assert.equal(repo.listA2AActions('test-111').length, 1);
  assert.equal(repo.ackA2AAction(first.id).status, 'acked');
  assert.equal(repo.resultA2AAction(first.id, { status: 'succeeded', result: { ok: true } }).status, 'succeeded');
  assert.equal(repo.listA2AActions('test-111', { status: 'pending' }).length, 0);
  assert.equal(repo.listA2AActions('test-111', { status: 'all' })[0].result.ok, true);
});

test('expired A2A actions are not delivered', () => {
  const repo = createRepository({ memory: true });
  const action = repo.createA2AAction('test-111', { expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal(repo.listA2AActions('test-111').length, 0);
  assert.equal(repo.listA2AActions('test-111', { status: 'expired' })[0].id, action.id);
});
