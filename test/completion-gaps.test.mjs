import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../backend/repository.mjs';
import { createApp } from '../backend/app.mjs';

test('automation actions write results and schedule a bounded retry', () => {
  const repo = createRepository({ memory: true });
  const automation = repo.createAutomation('test-111', { name: '每小时', schedule: '每小时', maxRetries: 1 });
  assert.ok(automation.next_run);
  const run = repo.runAutomation(automation.id);
  repo.ackA2AAction(run.action_id);
  repo.resultA2AAction(run.action_id, { status: 'failed', error: 'temporary', result: { code: 503 } });
  const retry = repo.listAutomationRuns(automation.id)[0];
  assert.equal(retry.status, 'queued');
  assert.equal(retry.attempt, 1);
  assert.ok(retry.next_retry_at);
  assert.ok(retry.action_id);
  repo.ackA2AAction(retry.action_id);
  repo.resultA2AAction(retry.action_id, { status: 'succeeded', result: { ok: true } });
  assert.equal(repo.listAutomationRuns(automation.id)[0].status, 'completed');
  assert.deepEqual(repo.listAutomationRuns(automation.id)[0].result, { ok: true });
});

test('notifications, conversations, binary documents, skills and key rotation persist', async () => {
  const repo = createRepository({ memory: true });
  const task = repo.createTask('test-111', { title: '通知' });
  assert.ok(task.id);
  assert.equal(repo.notificationStats('test-111').unread, 1);
  repo.markNotificationsRead('test-111');
  assert.equal(repo.notificationStats('test-111').unread, 0);
  const conversation = repo.createConversation('test-111', { title: '新对话' });
  repo.addConversationMessage(conversation.id, { content: '你好', attachments: [{ name: 'a.txt', size: 2 }] });
  assert.equal(repo.getConversation(conversation.id).messages.length, 1);
  const document = repo.createDocument('test-111', { name: 'a.bin', data: Buffer.from('ok').toString('base64'), contentEncoding: 'base64', mimeType: 'application/octet-stream' });
  assert.equal(repo.downloadDocument(document.id).size, 2);
  repo.deleteDocument(document.id);
  assert.equal(repo.listDocumentTrash('test-111').length, 1);
  repo.restoreDocument(document.id);
  const imported = await repo.importSkill('test-111', { content: '---\nname: rollback-skill\nversion: 1.0.0\n---\n\n# One' });
  repo.setSkillInstalled(imported.id, true);
  assert.equal(repo.uninstallSkill(imported.id).uninstalled, true);
  assert.equal(repo.rollbackSkill(imported.id).name, 'rollback-skill');
  const key = repo.createApiKey('test-111', { name: 'rotate' });
  const rotated = repo.rotateApiKey(key.id);
  assert.equal(repo.verifyApiKey(key.token), null);
  assert.ok(repo.verifyApiKey(rotated.token));
});

test('conversation execution ignores unrelated A2A actions that share its conversation id', () => {
  const repo = createRepository({ memory: true });
  const conversation = repo.createConversation('test-111', { title: '执行状态隔离' });
  const taskAction = repo.createA2AAction('test-111', {
    type: 'task.execute',
    taskId: 'task-execution-state',
    payload: { conversationId: conversation.id, prompt: '持续执行' }
  });
  repo.ackA2AAction(taskAction.id);
  const directoryAction = repo.createA2AAction('test-111', {
    type: 'directory.inspect',
    payload: { conversationId: conversation.id, path: 'C:\\Users\\25941' }
  });
  repo.ackA2AAction(directoryAction.id);
  repo.resultA2AAction(directoryAction.id, { status: 'succeeded', result: { exists: true } });

  const execution = repo.getConversation(conversation.id).execution;
  assert.equal(execution.id, taskAction.id);
  assert.equal(execution.type, 'task.execute');
  assert.equal(execution.status, 'acked');
});

test('settings role guard and notification API expose durable state', async () => {
  const app = createApp({ memory: true });
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const denied = await fetch(`${base}/api/workspaces/test-111/settings`, { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-workspace-role': 'member' }, body: JSON.stringify({ name: '不应保存' }) });
    assert.equal(denied.status, 403);
    const saved = await fetch(`${base}/api/workspaces/test-111/settings`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '新名称', description: '上下文' }) });
    assert.equal(saved.status, 200);
    const notifications = await fetch(`${base}/api/workspaces/test-111/notifications`).then(response => response.json());
    assert.equal(notifications.stats.unread >= 1, true);
  } finally { server.close(); }
});
