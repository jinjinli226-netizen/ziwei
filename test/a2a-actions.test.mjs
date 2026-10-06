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

test('acked A2A actions keep an execution lease after the original expiry', async () => {
  const repo = createRepository({ memory: true });
  const originalExpiresAt = new Date(Date.now() + 40).toISOString();
  const action = repo.createA2AAction('test-111', {
    agentId: 'ziwei_user',
    type: 'task.execute',
    dedupeKey: 'task-lease-after-ack',
    expiresAt: originalExpiresAt,
    payload: { timeout_ms: 100 }
  });

  const acked = repo.ackA2AAction(action.id, { agentId: 'ziwei_user' });
  assert.equal(acked.status, 'acked');
  assert.ok(Date.parse(acked.expires_at) >= Date.parse(acked.acked_at) + 16 * 60 * 1000);

  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(repo.listA2AActions('test-111', { status: 'acked' })[0].status, 'acked');
  assert.equal(repo.resultA2AAction(action.id, { agentId: 'ziwei_user', status: 'succeeded', result: { ok: true } }).status, 'succeeded');
  assert.equal(repo.listA2AActions('test-111', { status: 'all' })[0].status, 'succeeded');
});

test('A2A progress events renew the execution lease while an action is active', () => {
  const repo = createRepository({ memory: true });
  const action = repo.createA2AAction('test-111', {
    agentId: 'ziwei_user', type: 'task.execute', dedupeKey: 'task-lease-renewal',
    payload: { timeoutMs: 15 * 60 * 1000 }
  });
  repo.ackA2AAction(action.id, { agentId: 'ziwei_user' });
  const nearExpiry = new Date(Date.now() + 1_000).toISOString();
  repo.db.prepare('UPDATE a2a_actions SET expires_at=? WHERE id=?').run(nearExpiry, action.id);

  repo.recordA2AEvent(action.id, {
    agentId: 'ziwei_user', type: 'action.progress', message: '仍在执行', data: {bytes: 2048}
  });
  const renewed = repo.listA2AActions('test-111', { status: 'acked' })[0];
  assert.ok(Date.parse(renewed.expires_at) > Date.parse(nearExpiry));
});
