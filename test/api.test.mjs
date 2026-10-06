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
    assert.equal(employee.status, 'active');
    await fetch(`http://127.0.0.1:${port}/api/workspaces/test-111/devices/device-ziwei-user/heartbeat`, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({agentId:'ziwei_user',version:'0.1.0',bridgeVersion:'0.1.0'})});
    const models = await fetch(`http://127.0.0.1:${port}/api/workspaces/test-111/models?q=sonnet`).then(r => r.json());
    assert.equal(models.models[0].provider, 'Anthropic');
    assert.ok(models.models[0].id);
  } finally { server.close(); }
});

test('conversation API requires an employee and filters each employee workspace', async () => {
  const app = createApp({ memory: true });
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;
  try {
    const headers = { 'content-type': 'application/json' };
    const codex = await fetch(`http://127.0.0.1:${port}/api/workspaces/test-111/employees`, { method:'POST', headers, body:JSON.stringify({ name:'Codex', runtime:'Codex' }) }).then(r => r.json());
    const claude = await fetch(`http://127.0.0.1:${port}/api/workspaces/test-111/employees`, { method:'POST', headers, body:JSON.stringify({ name:'Claude', runtime:'Claude' }) }).then(r => r.json());
    const rejected = await fetch(`http://127.0.0.1:${port}/api/workspaces/test-111/conversations`, { method:'POST', headers, body:JSON.stringify({ title:'没有归属' }) });
    assert.equal(rejected.status, 400);
    const first = await fetch(`http://127.0.0.1:${port}/api/workspaces/test-111/conversations`, { method:'POST', headers, body:JSON.stringify({ title:'Codex 对话', employeeId:codex.id }) }).then(r => r.json());
    await fetch(`http://127.0.0.1:${port}/api/workspaces/test-111/conversations`, { method:'POST', headers, body:JSON.stringify({ title:'Claude 对话', employeeId:claude.id }) });
    const isolated = await fetch(`http://127.0.0.1:${port}/api/workspaces/test-111/conversations?employeeId=${encodeURIComponent(codex.id)}`).then(r => r.json());
    assert.deepEqual(isolated.conversations.map(item => item.id), [first.id]);
    assert.equal(isolated.conversations[0].employee.name, 'Codex');
  } finally { server.close(); }
});

test('conversation API accepts the 10 MiB attachment envelope behind the 16 MiB parser limit', async () => {
  const app = createApp({ memory: true });
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;
  try {
    const bytes = Buffer.alloc(10 * 1024 * 1024, 7);
    const body = JSON.stringify({ content: '图片说明', attachments: [{ name:'photo.png', mimeType:'image/png', content:bytes.toString('base64'), contentEncoding:'base64' }] });
    const response = await fetch(`http://127.0.0.1:${port}/api/conversations/unknown/messages`, { method:'POST', headers:{'content-type':'application/json'}, body });
    assert.equal(response.status, 404, 'the body must reach the route after JSON parsing');
    assert.notEqual(response.status, 413);
  } finally { server.close(); }
});

test('conversation workdir inspection is dispatched to the target device and exposes the real result', async () => {
  const app = createApp({ memory: true });
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;
  try {
    const headers = { 'content-type': 'application/json' };
    const device = app.locals.repo.heartbeatDevice('test-111', {
      agentId: 'ziwei_user', deviceId: 'directory-device', name: '目录电脑', workdir: 'C:/Users/test', version: '0.1.0'
    });
    const employee = await fetch(`http://127.0.0.1:${port}/api/workspaces/test-111/employees`, { method:'POST', headers, body:JSON.stringify({ name:'目录助手', runtime:'Codex' }) }).then(r => r.json());
    const conversation = await fetch(`http://127.0.0.1:${port}/api/workspaces/test-111/conversations`, { method:'POST', headers, body:JSON.stringify({ title:'目录选择', employeeId:employee.id, deviceId:device.id }) }).then(r => r.json());
    const submitted = await fetch(`http://127.0.0.1:${port}/api/conversations/${conversation.id}/workdir/inspect`, { method:'POST', headers, body:JSON.stringify({ deviceId:device.id, path:'C:/research/reports', createIfMissing:true }) });
    assert.equal(submitted.status, 202);
    const body = await submitted.json();
    assert.equal(body.action.type, 'directory.inspect');
    assert.equal(body.action.payload.deviceId, device.id);
    assert.equal(body.action.payload.path, 'C:/research/reports');
    assert.equal(body.action.payload.createIfMissing, true);
    const pending = await fetch(`http://127.0.0.1:${port}/api/conversations/${conversation.id}/workdir/actions/${body.action.id}`).then(r => r.json());
    assert.equal(pending.action.status, 'pending');
    app.locals.repo.resultA2AAction(body.action.id, { agentId:'ziwei_user', deviceId:device.id, status:'succeeded', result:{ path:'C:/research/reports', exists:true, isDirectory:true, created:true } });
    const complete = await fetch(`http://127.0.0.1:${port}/api/conversations/${conversation.id}/workdir/actions/${body.action.id}`).then(r => r.json());
    assert.equal(complete.action.status, 'succeeded');
    assert.equal(complete.action.result.path, 'C:/research/reports');
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

