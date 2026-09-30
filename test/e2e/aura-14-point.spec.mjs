import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../../backend/app.mjs';

async function listen(app) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  return server;
}

async function request(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = text; }
  return { response, body };
}

test('Aura 14-point HTTP acceptance covers core UI flows without restarting services', async () => {
  const app = createApp({ memory: true });
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = (value) => JSON.stringify(value);
  try {
    const health = await request(base, '/healthz');
    assert.equal(health.response.status, 200);
    assert.equal(health.body.cli, 'ziwei_user');

    const summary = await request(base, '/api/workspaces/test-111/summary');
    assert.equal(summary.response.status, 200);
    assert.equal(summary.body.workspace.slug, 'test-111');

    // Home/tasks and calendar: a task with a due date must become a calendar event.
    const createdTask = await request(base, '/api/workspaces/test-111/tasks', { method: 'POST', body: json({ title: '14 点验收任务', description: 'HTTP fallback', dueDate: '2026-10-01', priority: 'high' }) });
    assert.equal(createdTask.response.status, 201);
    assert.equal(createdTask.body.title, '14 点验收任务');
    const taskId = createdTask.body.id;
    const updatedTask = await request(base, `/api/tasks/${taskId}`, { method: 'PATCH', body: json({ state: 'in_progress', assignee: 'owner' }) });
    assert.equal(updatedTask.body.state, 'in_progress');
    const taskMessage = await request(base, `/api/tasks/${taskId}/messages`, { method: 'POST', body: json({ role: 'user', content: '验收记录' }) });
    assert.equal(taskMessage.response.status, 201);
    const calendar = await request(base, '/api/workspaces/test-111/calendar');
    assert.equal(calendar.response.status, 200);
    assert.ok(calendar.body.calendars[0].events.some(event => event.id === taskId && event.start_date === '2026-10-01'));

    // Documents: tree item, edit/version, download, trash and restore.
    const folder = await request(base, '/api/workspaces/test-111/documents', { method: 'POST', body: json({ name: '验收资料', type: 'folder' }) });
    const document = await request(base, '/api/workspaces/test-111/documents', { method: 'POST', body: json({ name: '验收.md', type: 'file', parentId: folder.body.id, content: '# v1' }) });
    assert.equal(document.response.status, 201);
    const docId = document.body.id;
    const savedDocument = await request(base, `/api/documents/${docId}`, { method: 'PATCH', body: json({ content: '# v2' }) });
    assert.equal(savedDocument.body.size, 4);
    const versions = await request(base, `/api/documents/${docId}/versions`);
    assert.equal(versions.body.versions.length, 2);
    const download = await fetch(`${base}/api/documents/${docId}/download`);
    assert.equal(download.status, 200);
    assert.equal(await download.text(), '# v2');
    const deleted = await request(base, `/api/documents/${folder.body.id}`, { method: 'DELETE' });
    assert.equal(deleted.body.ok, true);
    const trash = await request(base, '/api/workspaces/test-111/documents/trash');
    assert.ok(trash.body.documents.some(item => item.id === docId));
    const restored = await request(base, `/api/documents/${folder.body.id}/restore`, { method: 'POST', body: '{}' });
    assert.equal(restored.body.id, folder.body.id);

    // Team, devices, runtimes and digital employees.
    const member = await request(base, '/api/workspaces/test-111/members', { method: 'POST', body: json({ email: 'acceptance@example.com', role: 'member' }) });
    assert.equal(member.response.status, 201);
    const device = await request(base, '/api/workspaces/test-111/devices', { method: 'POST', body: json({ name: 'acceptance-pc', os: 'Windows' }) });
    assert.equal(device.response.status, 201);
    const heartbeat = await request(base, '/api/workspaces/test-111/heartbeat', { method: 'POST', body: json({ agentId: 'ziwei_user', version: '0.1.0', deviceId: device.body.id }) });
    assert.equal(heartbeat.body.ok, true);
    const runtimes = await request(base, '/api/workspaces/test-111/runtimes');
    assert.equal(runtimes.response.status, 200);
    const models = await request(base, '/api/workspaces/test-111/models?q=sonnet');
    assert.ok(models.body.models.length > 0);
    const employee = await request(base, '/api/workspaces/test-111/employees', { method: 'POST', body: json({ name: '验收伙伴', runtime: 'Codex', model: models.body.models[0].id, visibility: 'workspace' }) });
    assert.equal(employee.response.status, 201);
    assert.equal(employee.body.status, 'draft');

    // Skills: valid SKILL.md import, install and uninstall.
    const skill = await request(base, '/api/workspaces/test-111/skills/import', { method: 'POST', body: json({ content: '---\nname: acceptance-skill\nversion: 1.0.0\ncategory: testing\n---\n\n# Acceptance\n\nRun acceptance checks.' }) });
    assert.equal(skill.response.status, 201);
    assert.equal(skill.body.validation_status, 'valid');
    const installedSkill = await request(base, `/api/skills/${skill.body.id}`, { method: 'PATCH', body: json({ installed: true }) });
    assert.equal(installedSkill.body.installed, true);
    const uninstalledSkill = await request(base, `/api/skills/${skill.body.id}/uninstall`, { method: 'POST', body: '{}' });
    assert.equal(uninstalledSkill.body.uninstalled, true);

    // Automations and A2A action ack/result.
    const templates = await request(base, '/api/workspaces/test-111/automation-templates');
    assert.ok(templates.body.templates.length > 0);
    const automation = await request(base, '/api/workspaces/test-111/automations', { method: 'POST', body: json({ name: '验收自动化', schedule: '手动', prompt: '回写验收结果' }) });
    assert.equal(automation.response.status, 201);
    const run = await request(base, `/api/automations/${automation.body.id}/run`, { method: 'POST', body: json({ mode: 'manual' }) });
    assert.equal(run.response.status, 202);
    assert.ok(run.body.action_id);
    const ack = await request(base, `/a2a/v1/actions/${run.body.action_id}/ack`, { method: 'POST', body: json({ agentId: 'ziwei_user' }) });
    assert.equal(ack.body.status, 'acked');
    const result = await request(base, `/a2a/v1/actions/${run.body.action_id}/result`, { method: 'POST', body: json({ status: 'succeeded', result: { ok: true } }) });
    assert.equal(result.body.status, 'succeeded');
    const runs = await request(base, `/api/automations/${automation.body.id}/runs`);
    assert.equal(runs.body.runs[0].status, 'completed');

    // Settings, API key, external API auth, and immediate revocation.
    const settings = await request(base, '/api/workspaces/test-111/settings');
    assert.equal(settings.response.status, 200);
    const savedSettings = await request(base, '/api/workspaces/test-111/settings', { method: 'PATCH', body: json({ description: '验收工作区', timezone: 'Asia/Shanghai' }) });
    assert.equal(savedSettings.body.workspace.description, '验收工作区');
    const key = await request(base, '/api/workspaces/test-111/api-keys', { method: 'POST', body: json({ name: 'acceptance-key', role: 'owner' }) });
    assert.equal(key.response.status, 201);
    assert.match(key.body.token, /^zwi_/);
    const external = await request(base, '/api/external/workspaces/test-111/summary', { headers: { authorization: `Bearer ${key.body.token}` } });
    assert.equal(external.response.status, 200);
    const rotated = await request(base, `/api/api-keys/${key.body.id}/rotate`, { method: 'POST', body: '{}' });
    assert.equal(rotated.response.status, 201);
    const revokedExternal = await request(base, '/api/external/workspaces/test-111/summary', { headers: { authorization: `Bearer ${key.body.token}` } });
    assert.equal(revokedExternal.response.status, 401);

    // Invitation lifecycle and invitation acceptance page API.
    const invitation = await request(base, '/api/workspaces/test-111/invitations', { method: 'POST', body: json({ email: 'invitee@example.com', role: 'member' }) });
    assert.equal(invitation.response.status, 201);
    assert.ok(invitation.body.code);
    const lookup = await request(base, `/api/invitations/lookup/${encodeURIComponent(invitation.body.code)}`);
    assert.equal(lookup.response.status, 200);
    const accepted = await request(base, `/api/invitations/${encodeURIComponent(invitation.body.code)}/accept`, { method: 'POST', body: json({ name: '受邀成员', email: 'invitee@example.com' }) });
    assert.equal(accepted.response.status, 200);
    assert.equal(accepted.body.member.email, 'invitee@example.com');

    // Open platform and inbox/new conversation.
    const agents = await request(base, '/a2a/v1/agents');
    assert.equal(agents.body.agents[0].id, 'ziwei_user');
    const notices = await request(base, '/api/workspaces/test-111/notifications');
    assert.equal(notices.response.status, 200);
    assert.ok(notices.body.stats.total > 0);
    const conversation = await request(base, '/api/workspaces/test-111/conversations', { method: 'POST', body: json({ title: '验收对话', employeeId: employee.body.id }) });
    assert.equal(conversation.response.status, 201);
    const message = await request(base, `/api/conversations/${conversation.body.id}/messages`, { method: 'POST', body: json({ role: 'user', content: '请确认验收结果' }) });
    assert.equal(message.response.status, 201);
    const archivedConversation = await request(base, `/api/conversations/${conversation.body.id}/archive`, { method: 'POST', body: json({ archived: true }) });
    assert.equal(archivedConversation.body.status, 'archived');
    const read = await request(base, '/api/workspaces/test-111/notifications/read', { method: 'POST', body: '{}' });
    assert.equal(read.response.status, 200);

    // The browser route layer is covered by routes.test.mjs; this fallback intentionally
    // does not restart or attach to the user's existing frontend/backend processes.
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
