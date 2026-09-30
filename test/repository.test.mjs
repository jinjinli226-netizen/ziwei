import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../backend/repository.mjs';

test('repository seeds workspace and supports task lifecycle', () => {
  const repo = createRepository({ memory: true });
  const summary = repo.getSummary('test-111');
  assert.equal(summary.workspace.slug, 'test-111');
  assert.equal(summary.counts.runtimes, 0);
  repo.heartbeatDevice('test-111', { agentId: 'ziwei_user', version: '0.1.0', bridgeVersion: '0.1.0' });
  assert.equal(repo.getSummary('test-111').counts.runtimes, 4);
  const task = repo.createTask('test-111', { title: '检查首页', description: '验证空状态', priority: 'high' });
  assert.equal(task.state, 'planned');
  const moved = repo.transitionTask(task.id, 'todo');
  assert.equal(moved.state, 'todo');
  assert.equal(repo.listTasks('test-111').length, 1);
});

test('repository exposes A2A agent cards and documents', () => {
  const repo = createRepository({ memory: true });
  const agents = repo.listRuntimes('test-111');
  assert.equal(agents.length, 4);
  assert.equal(repo.listModels('test-111', { q: 'sonnet' })[0].provider, 'Anthropic');
  const doc = repo.createDocument('test-111', { name: '复刻说明.md', type: 'file', content: '# hello' });
  assert.equal(doc.type, 'file');
  assert.equal(repo.listDocuments('test-111')[0].name, '复刻说明.md');
  const folder = repo.createDocument('test-111', { name: '资料', type: 'folder' });
  const nested = repo.createDocument('test-111', { name: 'notes.md', type: 'file', parentId: folder.id, content: 'v1' });
  const saved = repo.updateDocument(nested.id, { name: 'notes-final.md', content: 'v2' });
  assert.equal(saved.name, 'notes-final.md');
  assert.equal(saved.size, 2);
  assert.equal(repo.listDocumentVersions(nested.id).length, 2);
  repo.restoreDocumentVersion(nested.id, 1);
  assert.equal(repo.getDocument(nested.id).content, 'v1');
  repo.deleteDocument(folder.id);
  assert.equal(repo.getDocument(nested.id), null);
});

test('repository persists invitations, devices, and digital employees', () => {
  const repo = createRepository({ memory: true });
  const member = repo.createMember('test-111', { email: 'new@example.com', role: 'admin' });
  const device = repo.createDevice('test-111', { name: 'office-pc' });
  const employee = repo.createEmployee('test-111', { name: '日报整理员', runtime: 'Codex', model: 'openai:gpt-6', visibility: 'personal', skills: ['skill-code'], instructions: '整理日报' });
  assert.equal(repo.listMembers('test-111').some(item => item.id === member.id), true);
  assert.equal(repo.listDevices('test-111').some(item => item.id === device.id), true);
  assert.equal(repo.listEmployees('test-111')[0].name, employee.name);
  assert.equal(repo.listEmployees('test-111')[0].model_id, 'openai:gpt-6');
  assert.deepEqual(repo.listEmployees('test-111')[0].skills, ['skill-code']);
});

test('repository updates task details and stores task messages', () => {
  const repo = createRepository({ memory: true });
  const task = repo.createTask('test-111', { title: '初始标题', description: '初始描述' });
  const updated = repo.updateTask(task.id, { title: '更新标题', priority: 'high', dueDate: '2026-10-01', state: 'in_progress' });
  assert.equal(updated.title, '更新标题');
  assert.equal(updated.priority, 'high');
  assert.equal(updated.due_date, '2026-10-01');
  assert.equal(repo.getTask(task.id).state, 'in_progress');
  const message = repo.addTaskMessage(task.id, { role: 'user', content: '请补充验收标准' });
  assert.equal(repo.getTaskMessages(task.id)[0].id, message.id);
});

test('tasks support creator, tag and due date filters plus durable attachments', () => {
  const repo = createRepository({ memory: true });
  const task = repo.createTask('test-111', {
    title: '带附件的任务', description: '**验收**', descriptionFormat: 'markdown',
    createdBy: 'member-1', labels: ['验收', '附件'], dueDate: '2026-10-03'
  });
  repo.createTask('test-111', { title: '其他任务', createdBy: 'member-2', labels: ['其他'], dueDate: '2026-10-04' });
  assert.equal(repo.listTasks('test-111', { creator: 'member-1', tag: '附件', dateFrom: '2026-10-03', dateTo: '2026-10-03' }).length, 1);
  assert.equal(repo.getTask(task.id).description_format, 'markdown');
  const attachment = repo.createTaskAttachment(task.id, { name: '验收.txt', mimeType: 'text/plain', data: Buffer.from('ok').toString('base64') });
  assert.equal(attachment.size, 2);
  assert.equal(repo.listTaskAttachments(task.id)[0].name, '验收.txt');
  assert.equal(repo.getTaskAttachment(attachment.id).content, Buffer.from('ok').toString('base64'));
  repo.deleteTaskAttachment(attachment.id);
  assert.equal(repo.listTaskAttachments(task.id).length, 0);
});
