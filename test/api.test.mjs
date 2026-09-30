import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../backend/app.mjs';

test('http api exposes summary and creates tasks', async () => {
  const app = createApp({ memory: true });
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;
  try {
    const summary = await fetch(`http://127.0.0.1:${port}/api/workspaces/test-111/summary`).then(r => r.json());
    assert.equal(summary.workspace.name, '紫薇');
    const created = await fetch(`http://127.0.0.1:${port}/api/workspaces/test-111/tasks`, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({title:'A2A 联调'})}).then(r => r.json());
    assert.equal(created.title, 'A2A 联调');
    const list = await fetch(`http://127.0.0.1:${port}/a2a/v1/tasks?workspace=test-111`).then(r => r.json());
    assert.equal(list.tasks.length, 1);
    const message = await fetch(`http://127.0.0.1:${port}/a2a/v1/tasks/${created.id}/messages`, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({role:'agent',content:'已接收'})}).then(r => r.json());
    assert.equal(message.accepted, true);
    const detail = await fetch(`http://127.0.0.1:${port}/a2a/v1/tasks/${created.id}`).then(r => r.json());
    assert.equal(detail.messages.length, 1);
    const card = await fetch(`http://127.0.0.1:${port}/a2a/v1/agents`).then(r => r.json());
    assert.equal(card.agents[0].id, 'ziwei_user');
    const member = await fetch(`http://127.0.0.1:${port}/api/workspaces/test-111/members`, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({email:'invite@example.com',role:'member'})}).then(r => r.json());
    assert.equal(member.email, 'invite@example.com');
    const device = await fetch(`http://127.0.0.1:${port}/api/workspaces/test-111/devices`, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({name:'office-pc'})}).then(r => r.json());
    assert.equal(device.name, 'office-pc');
    const employee = await fetch(`http://127.0.0.1:${port}/api/workspaces/test-111/employees`, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({name:'日报整理员'})}).then(r => r.json());
    assert.equal(employee.status, 'draft');
    const models = await fetch(`http://127.0.0.1:${port}/api/workspaces/test-111/models?q=sonnet`).then(r => r.json());
    assert.equal(models.models[0].id, 'anthropic:claude-sonnet-5');
  } finally { server.close(); }
});

test('external API requires a live Ziwei API key', async () => {
  const app = createApp({ memory: true });
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;
  try {
    const denied = await fetch(`http://127.0.0.1:${port}/api/external/workspaces/test-111/summary`);
    assert.equal(denied.status, 401);
    const created = app.locals.repo.createApiKey('test-111', { name: 'test' });
    const allowed = await fetch(`http://127.0.0.1:${port}/api/external/workspaces/test-111/summary`, { headers: { authorization: `Bearer ${created.token}` } });
    assert.equal(allowed.status, 200);
    assert.equal((await allowed.json()).workspace.slug, 'test-111');
    app.locals.repo.revokeApiKey(created.id);
    const revoked = await fetch(`http://127.0.0.1:${port}/api/external/workspaces/test-111/summary`, { headers: { 'x-ziwei-api-key': created.token } });
    assert.equal(revoked.status, 401);
  } finally { server.close(); }
});

