import assert from 'node:assert/strict';
import test from 'node:test';
import { createRepository } from '../backend/repository.mjs';
import { createApp } from '../backend/app.mjs';

test('invitation lifecycle creates, resends, revokes and accepts links', () => {
  const repo = createRepository({ memory: true });
  const created = repo.createInvitation('test-111', { email: 'new@example.com', role: 'admin' });
  assert.equal(created.status, 'pending');
  assert.equal(created.role, 'admin');
  assert.match(created.link, /\/invite\?workspace=test-111&code=/);
  assert.equal(repo.listInvitations('test-111')[0].email, 'new@example.com');

  const resent = repo.resendInvitation(created.id);
  assert.notEqual(resent.code, created.code);
  assert.equal(resent.resend_count, 1);
  assert.equal(repo.getInvitationByCode(created.code), null);
  assert.equal(repo.getInvitationByCode(resent.code).status, 'pending');

  const accepted = repo.acceptInvitation(resent.code, { name: '新伙伴' });
  assert.equal(accepted.member.email, 'new@example.com');
  assert.equal(accepted.member.role, 'admin');
  assert.equal(repo.getInvitationByCode(resent.code).status, 'accepted');
  assert.throws(() => repo.resendInvitation(created.id), /已经被接受/);

  const linkOnly = repo.createInvitation('test-111', { role: 'member' });
  const linkAccepted = repo.acceptInvitation(linkOnly.code, { name: '链接伙伴', email: 'link@example.com' });
  assert.equal(linkAccepted.member.email, 'link@example.com');

  const revoked = repo.createInvitation('test-111', { email: 'revoked@example.com' });
  assert.equal(repo.revokeInvitation(revoked.id).status, 'revoked');
  assert.throws(() => repo.acceptInvitation(revoked.code, { name: '不会加入' }), /已撤销/);
});

test('invitation HTTP endpoints expose status and lifecycle actions', async () => {
  const app = createApp({ memory: true });
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;
  const url = path => `http://127.0.0.1:${port}${path}`;
  const json = (path, options) => fetch(url(path), { headers: { 'content-type': 'application/json' }, ...options }).then(async response => ({ response, body: await response.json() }));
  try {
    const created = await json('/api/workspaces/test-111/invitations', { method: 'POST', body: JSON.stringify({ email: 'http@example.com', role: 'member' }) });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.status, 'pending');
    const listed = await json('/api/workspaces/test-111/invitations');
    assert.equal(listed.body.invitations.length, 1);
    const resent = await json(`/api/invitations/${created.body.id}/resend`, { method: 'POST', body: '{}' });
    assert.equal(resent.body.resend_count, 1);
    const revoked = await json(`/api/invitations/${created.body.id}/revoke`, { method: 'POST', body: '{}' });
    assert.equal(revoked.body.status, 'revoked');
  } finally { server.close(); }
});
