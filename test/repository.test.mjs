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

test('ziwei_user heartbeat creates the runtime catalog for a fresh workspace', () => {
  const repo = createRepository({ memory: true });
  const timestamp = new Date().toISOString();
  repo.db.prepare('INSERT INTO workspaces(id,slug,name,plan,timezone,created_at) VALUES(?,?,?,?,?,?)')
    .run('ws-bjc-ops', 'bjc-ops', 'BJC Ops', 'free', 'Asia/Shanghai', timestamp);

  const heartbeat = repo.heartbeatDevice('bjc-ops', {
    agentId: 'ziwei_user',
    deviceId: 'device-bjc-ops',
    version: '0.1.0',
    runtimes: { Claude: { version: '4.5', status: 'available' } }
  });
  assert.equal(heartbeat.status, 'online');
  const runtimes = repo.listRuntimes('bjc-ops');
  assert.deepEqual(runtimes.map(item => item.name), ['Claude', 'Codex', 'Gemini', 'Hermes']);
  assert.equal(runtimes.every(item => item.status === 'online'), true);
});

test('repository exposes A2A agent cards and documents', () => {
  const repo = createRepository({ memory: true });
  const agents = repo.listRuntimes('test-111');
  assert.equal(agents.length, 4);
  repo.heartbeatDevice('test-111', { agentId: 'ziwei_user', version: '0.1.0', bridgeVersion: '0.1.0' });
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
  const employee = repo.createEmployee('test-111', { name: '日报整理员', runtime: 'Codex', model: 'openai:gpt-6', visibility: 'personal', skills: ['skill-code'], instructions: '整理日报', runtimeProfile: 'ziwei-aigc' });
  const paused = repo.createEmployee('test-111', { name: '暂停中的员工', status: 'paused' });
  const invalid = repo.createEmployee('test-111', { name: '未知状态员工', status: 'not-a-status' });
  assert.equal(repo.listMembers('test-111').some(item => item.id === member.id), true);
  assert.equal(repo.listDevices('test-111').some(item => item.id === device.id), true);
  const employees = repo.listEmployees('test-111');
  assert.equal(employees.some(item => item.id === employee.id && item.name === employee.name), true);
  assert.equal(employee.status, 'active');
  assert.equal(paused.status, 'paused');
  assert.equal(invalid.status, 'active');
  assert.equal(employees.find(item => item.id === employee.id).status, 'active');
  assert.equal(employees.find(item => item.id === employee.id).model_id, 'openai:gpt-6');
  assert.equal(employees.find(item => item.id === employee.id).runtime_profile, 'ziwei-aigc');
  assert.deepEqual(employees.find(item => item.id === employee.id).skills, ['skill-code']);
});

test('employee execution payload carries Hermes profile and role personality', () => {
  const repo = createRepository({ memory: true });
  const employee = repo.createEmployee('test-111', {
    name: '紫薇研究员',
    runtime: 'Hermes',
    runtimeProfile: 'ziwei-aigc',
    instructions: '你负责核对来源，输出结论和下一步。'
  });
  const conversation = repo.createConversation('test-111', { employeeId: employee.id, title: '独立人格测试' });
  const task = repo.createTask('test-111', {
    title: '执行独立人格测试', description: '只回复 PROFILE_PERSONA_OK', employeeId: employee.id,
    execute: true, runtime: 'Hermes', conversationId: conversation.id
  });
  const action = repo.listA2AActions('test-111', { status: 'pending' })[0];
  assert.equal(action.task_id, task.id);
  assert.equal(action.payload.profile, 'ziwei-aigc');
  assert.match(action.payload.prompt, /紫薇研究员/);
  assert.match(action.payload.prompt, /你负责核对来源/);
  assert.match(action.payload.prompt, /PROFILE_PERSONA_OK/);
});

test('employee conversation dispatch injects the configured role personality', () => {
  const repo = createRepository({ memory: true });
  const employee = repo.createEmployee('test-111', {
    name: '独立会话伙伴', runtime: 'Hermes', runtimeProfile: 'ziwei-aigc', instructions: '必须保持严谨口吻。'
  });
  const conversation = repo.createConversation('test-111', { employeeId: employee.id });
  repo.addConversationMessage(conversation.id, { role: 'user', content: '返回 CONVERSATION_PERSONA_OK' });
  const action = repo.listA2AActions('test-111', { status: 'pending' })[0];
  assert.equal(action.payload.profile, 'ziwei-aigc');
  assert.match(action.payload.prompt, /必须保持严谨口吻/);
  assert.match(action.payload.prompt, /CONVERSATION_PERSONA_OK/);
});

test('conversation lists are isolated by employee and legacy rows stay explicitly unassigned', () => {
  const repo = createRepository({ memory: true });
  const codex = repo.createEmployee('test-111', { name: 'Codex 助手', runtime: 'Codex', avatar: 'data:image/png;base64,codex' });
  const claude = repo.createEmployee('test-111', { name: 'Claude 助手', runtime: 'Claude' });
  const codexConversation = repo.createConversation('test-111', { employeeId: codex.id, title: 'Codex 独立会话' });
  const claudeConversation = repo.createConversation('test-111', { employeeId: claude.id, title: 'Claude 独立会话' });
  const legacyConversation = repo.createConversation('test-111', { title: '历史未归属会话' });
  const codexRows = repo.listConversations('test-111', { conversationEmployeeId: codex.id });
  assert.deepEqual(codexRows.map(row => row.id), [codexConversation.id]);
  assert.equal(codexRows[0].employee.name, 'Codex 助手');
  assert.equal(codexRows[0].employee.runtime, 'Codex');
  assert.equal(repo.listConversations('test-111', { conversationEmployeeId: claude.id })[0].id, claudeConversation.id);
  const legacyRows = repo.listConversations('test-111', { conversationEmployeeId: 'unassigned' });
  assert.equal(legacyRows[0].id, legacyConversation.id);
  assert.equal(legacyRows[0].employee_binding, 'unassigned_legacy');
  assert.equal(legacyRows[0].requires_employee_assignment, true);
});

test('conversation settings persist target device, model, directory and attachment dispatch metadata', () => {
  const repo = createRepository({ memory: true });
  const device = repo.heartbeatDevice('test-111', { agentId: 'ziwei_user', deviceId: 'conversation-device', name: '研究电脑', workdir: 'C:/research' });
  const employee = repo.createEmployee('test-111', { name: '调研员', runtime: 'Codex', model: 'openai:gpt-6' });
  const conversation = repo.createConversation('test-111', { employeeId: employee.id, deviceId: device.id, modelId: 'openai:gpt-6', workingDirectory: 'C:/research' });
  const updated = repo.updateConversationSettings(conversation.id, { deviceId: device.id, modelId: 'openai:gpt-6.1', workingDirectory: 'C:/research/reports' });
  assert.equal(updated.device_id, device.id);
  assert.equal(updated.model_id, 'openai:gpt-6.1');
  assert.equal(updated.working_directory, 'C:/research/reports');
  repo.addConversationMessage(conversation.id, { content: '读取附件', runtime: 'Codex', attachments: [{ name: 'brief.txt', content: Buffer.from('brief').toString('base64'), contentEncoding: 'base64' }] });
  const action = repo.listA2AActions('test-111', { status: 'pending' }).find(item => item.payload.conversationId === conversation.id);
  assert.equal(action.payload.deviceId, device.id);
  assert.equal(action.payload.cwd, 'C:/research/reports');
  assert.equal(action.payload.model, 'openai:gpt-6.1');
  assert.equal(action.payload.attachments[0].name, 'brief.txt');
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

test('execution-backed tasks are linked to ziwei_user and reflect terminal results', () => {
  const repo = createRepository({ memory: true });
  const task = repo.createTask('test-111', {
    title: '执行链路验收', description: '只验证任务状态回写', runtime: 'Codex', execute: true
  });
  const queued = repo.listA2AActions('test-111', { status: 'pending' })[0];
  assert.equal(queued.task_id, task.id);
  assert.equal(repo.listTasks('test-111')[0].execution.status, 'pending');
  repo.ackA2AAction(queued.id, { agentId: 'ziwei_user' });
  assert.equal(repo.getTask(task.id).state, 'in_progress');
  repo.recordA2AEvent(queued.id, { agentId: 'ziwei_user', type: 'action.progress', message: '已启动 Codex CLI', data: { phase: 'started' } });
  assert.equal(repo.getTask(task.id).execution.events[0].message, '已启动 Codex CLI');
  repo.resultA2AAction(queued.id, { agentId: 'ziwei_user', status: 'failed', error: 'CLI timeout' });
  const finished = repo.getTask(task.id);
  assert.equal(finished.state, 'blocked');
  assert.equal(finished.execution.status, 'failed');
  assert.match(repo.getTaskMessages(task.id)[0].content, /CLI timeout/);
});

test('conversation history can be recorded without dispatching a duplicate action', () => {
  const repo = createRepository({ memory: true });
  const conversation = repo.createConversation('test-111', { title: '任务历史' });
  repo.addConversationMessage(conversation.id, { role: 'user', content: '只保存这条历史', runtime: 'Codex', dispatch: false });
  assert.equal(repo.listA2AActions('test-111', { status: 'all' }).length, 0);
  assert.equal(repo.getConversation(conversation.id).messages[0].content, '只保存这条历史');
});

test('conversation exposes ziwei_user execution status, progress, and reply', () => {
  const repo = createRepository({ memory: true });
  const conversation = repo.createConversation('test-111', { title: '持久会话' });
  const submitted = repo.addConversationMessage(conversation.id, { role: 'user', content: '执行一次本地检查', runtime: 'Codex' });
  assert.equal(submitted.execution.status, 'pending');
  let current = repo.getConversation(conversation.id);
  assert.equal(current.execution.status, 'pending');
  assert.equal(current.messages.length, 1);
  const action = repo.listA2AActions('test-111', { status: 'pending' })[0];
  repo.ackA2AAction(action.id, { agentId: 'ziwei_user' });
  repo.recordA2AEvent(action.id, { agentId: 'ziwei_user', type: 'action.progress', message: '已启动 Codex' });
  current = repo.getConversation(conversation.id);
  assert.equal(current.execution.status, 'acked');
  assert.equal(current.execution.events[0].message, '已启动 Codex');
  repo.resultA2AAction(action.id, { agentId: 'ziwei_user', status: 'succeeded', result: { output: '检查完成' } });
  current = repo.getConversation(conversation.id);
  assert.equal(current.execution.status, 'succeeded');
  assert.equal(current.messages.at(-1).role, 'assistant');
  assert.match(current.messages.at(-1).content, /检查完成/);
});

test('conversation follows task.execute actions created for a digital employee', () => {
  const repo = createRepository({ memory: true });
  const conversation = repo.createConversation('test-111', { title: '任务型持久会话' });
  const task = repo.createTask('test-111', {
    title: '通过数字员工执行',
    description: '查询并返回结果',
    runtime: 'Codex',
    execute: true,
    conversationId: conversation.id
  });
  const action = repo.listA2AActions('test-111', { status: 'pending' }).find(item => item.task_id === task.id);
  assert.ok(action);
  assert.equal(repo.getConversation(conversation.id).execution.type, 'task.execute');
  repo.ackA2AAction(action.id, { agentId: 'ziwei_user' });
  repo.recordA2AEvent(action.id, { agentId: 'ziwei_user', type: 'action.stage', message: '正在查询', data: { stage: 'reasoning', summary: '规划查询步骤' } });
  assert.equal(repo.getConversation(conversation.id).execution.events.length, 1);
  repo.resultA2AAction(action.id, { agentId: 'ziwei_user', status: 'failed', error: 'A2A action timed out after 600000ms' });
  const current = repo.getConversation(conversation.id);
  assert.equal(current.execution.status, 'failed');
  assert.match(current.messages.at(-1).content, /600000ms/);
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
