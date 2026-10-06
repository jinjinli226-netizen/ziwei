import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../backend/app.mjs';
import { createRepository } from '../backend/repository.mjs';
import { createLocalActionExecutor, materializeRuntimeAttachments } from '../src/local-action.mjs';

test('Hermes profile creation is workspace/device bound and idempotent', async () => {
  const repo = createRepository({ memory: true });
  repo.heartbeatDevice('test-111', { agentId: 'ziwei_user', deviceId: 'hermes-device', runtimes: { Hermes: { version: '1.0.0', status: 'available' } } });
  const app = createApp({ repository: repo, memory: true, enableScheduler: false });
  const server = app.listen(0); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const body = { profile: 'researcher', deviceId: 'hermes-device', soul: '# Researcher' };
    const first = await fetch(`${base}/api/workspaces/test-111/hermes/profiles/requests`, { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'profile-1' }, body: JSON.stringify(body) });
    assert.equal(first.status, 202);
    const firstBody = await first.json();
    const second = await fetch(`${base}/api/workspaces/test-111/hermes/profiles/requests`, { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'profile-1' }, body: JSON.stringify(body) });
    assert.equal(second.status, 200);
    const secondBody = await second.json();
    assert.equal(secondBody.duplicate, true);
    assert.equal(secondBody.id, firstBody.id);

    const invalid = await fetch(`${base}/api/workspaces/test-111/hermes/profiles/requests`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, profile: '../escape', deviceId: 'hermes-device' }) });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /profile 名称无效/);
    const foreign = await fetch(`${base}/api/workspaces/test-111/hermes/profiles/requests`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, profile: 'foreign', deviceId: 'missing-device' }) });
    assert.equal(foreign.status, 400);
    assert.match((await foreign.json()).error, /不属于当前工作区/);
    const offlineDevice = repo.createDevice('test-111', { name: 'offline' });
    const offline = await fetch(`${base}/api/workspaces/test-111/hermes/profiles/requests`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, profile: 'offline', deviceId: offlineDevice.id }) });
    assert.equal(offline.status, 400);
    assert.match((await offline.json()).error, /当前离线/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('Hermes discovery stays scoped to the selected device', () => {
  const repo = createRepository({ memory: true });
  repo.heartbeatDevice('test-111', { agentId: 'ziwei_user', deviceId: 'hermes-one', runtimes: { Hermes: { version: '1.0.0', status: 'available', profiles: [{ name: 'one' }] } } });
  repo.heartbeatDevice('test-111', { agentId: 'ziwei_user', deviceId: 'hermes-two', runtimes: { Hermes: { version: '1.0.0', status: 'available', profiles: [{ name: 'two' }] } } });
  assert.deepEqual(repo.listHermesProfiles('test-111', { deviceId: 'hermes-one' }).profiles.map(item => item.name), ['one']);
  assert.deepEqual(repo.listHermesProfiles('test-111', { deviceId: 'hermes-two' }).profiles.map(item => item.name), ['two']);
});

test('ziwei_user writes Hermes profile files locally and repeats safely', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-hermes-profile-'));
  try {
    fs.mkdirSync(path.join(temp, 'hermes'), { recursive: true });
    fs.writeFileSync(path.join(temp, 'hermes', 'auth.json'), '{"active_provider":"openai-codex"}', { mode: 0o600 });
    fs.writeFileSync(path.join(temp, 'hermes', 'config.yaml'), 'model:\n  provider: openai-codex\n', { mode: 0o600 });
    const executor = createLocalActionExecutor({ runtimeDir: path.join(temp, 'runtime'), hermesHomePath: path.join(temp, 'hermes') });
    const action = { id: 'action-hermes-profile', type: 'hermes.profile.create', payload: { profile: 'researcher', soul: '# Researcher', memory: 'Keep sources.', deviceId: 'device-1' } };
    const result = await executor(action);
    assert.equal(result.status, 'succeeded');
    assert.equal(fs.readFileSync(path.join(temp, 'hermes', 'profiles', 'researcher', 'SOUL.md'), 'utf8'), '# Researcher');
    assert.equal(fs.readFileSync(path.join(temp, 'hermes', 'profiles', 'researcher', 'MEMORY.md'), 'utf8'), 'Keep sources.');
    assert.equal(fs.readFileSync(path.join(temp, 'hermes', 'profiles', 'researcher', 'auth.json'), 'utf8'), '{"active_provider":"openai-codex"}');
    assert.equal(fs.readFileSync(path.join(temp, 'hermes', 'profiles', 'researcher', 'config.yaml'), 'utf8'), 'model:\n  provider: openai-codex\n');
    const duplicate = await executor(action);
    assert.equal(duplicate.result.duplicate, true);
    await assert.rejects(() => executor({ ...action, payload: { ...action.payload, soul: '# Changed' } }), /内容不同/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('ziwei_user materializes conversation attachments below the selected workdir', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-conversation-attachments-'));
  try {
    const files = materializeRuntimeAttachments({
      cwd: temp,
      actionId: 'conversation-1',
      attachments: [{ name: '../brief.txt', mimeType: 'text/plain', content: Buffer.from('调查资料', 'utf8').toString('base64'), contentEncoding: 'base64' }]
    });
    assert.equal(files.length, 1);
    assert.equal(fs.readFileSync(files[0].path, 'utf8'), '调查资料');
    assert.ok(files[0].path.startsWith(path.join(temp, '.ziwei', 'attachments')));
    const duplicate = materializeRuntimeAttachments({
      cwd: temp,
      actionId: 'conversation-1',
      attachments: [{ name: '../brief.txt', mimeType: 'text/plain', content: Buffer.from('调查资料', 'utf8').toString('base64'), contentEncoding: 'base64' }]
    });
    assert.equal(duplicate[0].path, files[0].path);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
