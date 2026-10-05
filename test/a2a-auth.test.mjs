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

