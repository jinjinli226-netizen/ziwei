import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../backend/app.mjs';
import { createRepository } from '../backend/repository.mjs';

test('A2A action endpoints require the machine token while agent card stays discoverable', async () => {
  const tokenFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-a2a-')), 'token');
  const previous = process.env.ZIWEI_A2A_TOKEN_FILE;
  process.env.ZIWEI_A2A_TOKEN_FILE = tokenFile;
  const app = createApp({ repository: createRepository({ memory: true }), requireAuth: true, enableScheduler: false });
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/a2a/v1/agents`)).status, 200);
    assert.equal((await fetch(`${base}/a2a/v1/actions`, { headers: { accept: 'application/json' } })).status, 401);
    const token = fs.readFileSync(tokenFile, 'utf8').trim();
    assert.ok(token.length >= 40);
    assert.equal((await fetch(`${base}/a2a/v1/actions`, { headers: { authorization: `Bearer ${token}` } })).status, 400);
    const response = await fetch(`${base}/a2a/v1/actions`, {
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      method: 'POST', body: JSON.stringify({ workspace: 'test-111', agentId: 'ziwei_user', type: 'task.execute', payload: { prompt: 'auth test' } })
    });
    assert.equal(response.status, 201);
  } finally {
    server.close();
    if (previous === undefined) delete process.env.ZIWEI_A2A_TOKEN_FILE; else process.env.ZIWEI_A2A_TOKEN_FILE = previous;
    fs.rmSync(path.dirname(tokenFile), { recursive: true, force: true });
  }
});

test('A2A task details and messages stay bound to the task workspace', async () => {
  const app = createApp({ repository: createRepository({ memory: true }), requireAuth: false, enableScheduler: false });
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const task = app.locals.repo.createA2ATask('test-111', { title: 'scoped task' });
    const wrongDetail = await fetch(`${base}/a2a/v1/tasks/${task.id}?workspace=bjc-ops`);
    assert.equal(wrongDetail.status, 403);
    const wrongMessage = await fetch(`${base}/a2a/v1/tasks/${task.id}/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspace: 'bjc-ops', role: 'agent', content: 'cross workspace' })
    });
    assert.equal(wrongMessage.status, 403);
    const correctDetail = await fetch(`${base}/a2a/v1/tasks/${task.id}?workspace=test-111`);
    assert.equal(correctDetail.status, 200);
  } finally { server.close(); }
});

test('A2A action writes reject a device credential from another workspace', async () => {
  const repo = createRepository({ memory: true });
  repo.db.prepare('INSERT INTO workspaces(id,slug,name,kind,plan,timezone,created_at) VALUES(?,?,?,?,?,?,?)')
    .run('workspace-test-222', 'test-222', '第二工作区', 'personal', 'free', 'Asia/Shanghai', new Date().toISOString());
  const wrongPairing = repo.createDevicePairing('test-222', { name: 'other workspace device', os: 'Windows' });
  const wrongCredential = repo.claimDevicePairing({ code: wrongPairing.code });
  const correctPairing = repo.createDevicePairing('test-111', { name: 'test workspace device', os: 'Windows' });
  const correctCredential = repo.claimDevicePairing({ code: correctPairing.code });
  const action = repo.createA2AAction('test-111', { type: 'task.execute', payload: { prompt: 'scope test' } });
  const app = createApp({ repository: repo, requireDeviceAuth: true, enableScheduler: false });
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const wrong = await fetch(`${base}/a2a/v1/actions/${action.id}/ack`, {
      method: 'POST', headers: { 'x-ziwei-device-token': wrongCredential.deviceToken, 'content-type': 'application/json' }, body: '{}'
    });
    assert.equal(wrong.status, 401);
    assert.equal(repo.getA2AAction(action.id).status, 'pending');
    const correct = await fetch(`${base}/a2a/v1/actions/${action.id}/ack`, {
      method: 'POST', headers: { 'x-ziwei-device-token': correctCredential.deviceToken, 'content-type': 'application/json' }, body: '{}'
    });
    assert.equal(correct.status, 200);
  } finally { server.close(); }
});

