import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../backend/app.mjs';
import { createRepository } from '../backend/repository.mjs';

test('authenticated users can create a workspace and receive an independent route slug', async () => {
  const app = createApp({ repository: createRepository({ memory: true }), requireAuth: true, enableScheduler: false });
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const setup = await fetch(`${base}/api/auth/setup`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '项目所有者', email: 'workspace-owner@example.com', password: 'password-123' })
    });
    assert.equal(setup.status, 201);
    const cookie = String(setup.headers.get('set-cookie')).split(';')[0];
    const created = await fetch(`${base}/api/workspaces`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: '内容运营', slug: 'content-ops', kind: 'team' })
    });
    assert.equal(created.status, 201);
    const body = await created.json();
    assert.equal(body.workspace.slug, 'content-ops');
    assert.equal(body.workspace.kind, 'team');
    assert.equal(body.membership.role, 'owner');
    const listed = await fetch(`${base}/api/workspaces`, { headers: { cookie } }).then(response => response.json());
    assert.ok(listed.workspaces.some(item => item.slug === 'content-ops'));
    const summary = await fetch(`${base}/api/workspaces/content-ops/summary`, { headers: { cookie } });
    assert.equal(summary.status, 200);
    assert.equal((await summary.json()).workspace.slug, 'content-ops');
    const logout = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: '{}' });
    assert.equal(logout.status, 200);
    const me = await fetch(`${base}/api/auth/me`, { headers: { cookie } });
    assert.equal(me.status, 401);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
