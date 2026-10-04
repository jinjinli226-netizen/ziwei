import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../backend/app.mjs';
import { createRepository } from '../backend/repository.mjs';

async function startApp() {
  const app = createApp({ repository: createRepository({ memory: true }), requireAuth: true, enableScheduler: false });
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  return { app, server, base: `http://127.0.0.1:${server.address().port}` };
}

test('registered users can create an account after first-run setup and join the requested workspace', async () => {
  const { server, base } = await startApp();
  try {
    const setup = await fetch(`${base}/api/auth/setup`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '首个用户', email: 'owner@example.com', password: 'password-123', workspaceSlug: 'bjc-ops' })
    });
    assert.equal(setup.status, 201);

    const registered = await fetch(`${base}/api/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '新用户', email: 'new@example.com', password: 'password-456', workspaceSlug: 'bjc-ops' })
    });
    assert.equal(registered.status, 201);
    const body = await registered.json();
    assert.equal(body.user.email, 'new@example.com');
    assert.equal(body.memberships[0].slug, 'bjc-ops');
    assert.equal(body.memberships[0].role, 'member');
    const cookie = String(registered.headers.get('set-cookie')).split(';')[0];
    const status = await fetch(`${base}/api/auth/status`, { headers: { cookie } }).then(response => response.json());
    assert.equal(status.authenticated, true);
    assert.equal(status.user.email, 'new@example.com');

    const duplicate = await fetch(`${base}/api/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '重复用户', email: 'new@example.com', password: 'password-789', workspaceSlug: 'bjc-ops' })
    });
    assert.equal(duplicate.status, 400);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
