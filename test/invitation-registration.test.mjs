import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../backend/app.mjs';

async function fixture(run) {
  const app = createApp({ memory:true, requireAuth:true, enableScheduler:false });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body, cookie = '') => {
    const response = await fetch(base + path, { method:'POST', headers:{'content-type':'application/json', ...(cookie ? {cookie} : {})}, body:JSON.stringify(body) });
    return { status:response.status, body:await response.json(), cookie:String(response.headers.get('set-cookie') || '').split(';')[0] };
  };
  const owner = await post('/api/auth/setup', {name:'QA Owner', email:'owner@example.test', password:'test-password'});
  await post('/api/workspaces', {name:'Personal', slug:'qa-personal', kind:'personal'}, owner.cookie);
  await post('/api/workspaces', {name:'Team', slug:'qa-team', kind:'team'}, owner.cookie);
  try { await run({post, base, repo:app.locals.repo, owner}); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const registration = (email, invitation, workspaceSlug = invitation.workspace) => ({name:'QA Recipient', email, password:'test-password', workspaceSlug, invitationCode:invitation.code});

test('valid personal link invitations register with the invited role and immediate access', async () => fixture(async ({post, base, owner}) => {
  const invite = await post('/api/workspaces/qa-personal/invitations', {role:'admin'}, owner.cookie);
  const joined = await post('/api/auth/register', registration('personal@example.test', invite.body));
  assert.equal(joined.status, 201, joined.body.error);
  assert.equal(joined.body.memberships[0].slug, 'qa-personal');
  assert.equal(joined.body.memberships[0].role, 'admin');
  assert.equal((await fetch(base+'/api/workspaces/qa-personal/summary', {headers:{cookie:joined.cookie}})).status, 200);
}));

test('code-only registration resolves its workspace rather than creating an unrelated personal workspace', async () => fixture(async ({post, owner}) => {
  const invite = await post('/api/workspaces/qa-team/invitations', {}, owner.cookie);
  const body = registration('code-only@example.test', invite.body); delete body.workspaceSlug;
  const joined = await post('/api/auth/register', body);
  assert.equal(joined.status, 201, joined.body.error);
  assert.equal(joined.body.memberships[0].slug, 'qa-team');
  assert.equal(joined.body.memberships[0].role, 'member');
}));

test('existing recipients accept into the current session, with idempotence and no body impersonation', async () => fixture(async ({post, base, repo, owner}) => {
  const user = await post('/api/auth/register', {name:'Existing', email:'existing@example.test', password:'test-password'});
  const invite = await post('/api/workspaces/qa-team/invitations', {email:'existing@example.test'}, owner.cookie);
  const accepted = await post(`/api/invitations/${invite.body.code}/accept`, {email:'impersonation@example.test', userId:owner.body.user.id}, user.cookie);
  assert.equal(accepted.status, 200, accepted.body.error);
  assert.equal(accepted.body.member.user_id, user.body.user.id);
  assert.equal(accepted.body.member.email, user.body.user.email);
  assert.equal((await fetch(base+'/api/workspaces/qa-team/summary', {headers:{cookie:user.cookie}})).status, 200);
  const duplicate = await post(`/api/invitations/${invite.body.code}/accept`, {}, user.cookie);
  assert.equal(duplicate.status, 200); assert.equal(duplicate.body.duplicate, true);
  assert.equal(repo.listMembers('qa-team').filter(m => m.user_id === user.body.user.id).length, 1);
  const stranger = await post('/api/auth/register', {name:'Stranger', email:'stranger@example.test', password:'test-password'});
  assert.equal((await post(`/api/invitations/${invite.body.code}/accept`, {}, stranger.cookie)).status, 400);
  assert.equal((await post(`/api/invitations/${invite.body.code}/accept`, {})).status, 401);
}));

test('invitation failures return specific errors and roll back account creation', async () => fixture(async ({post, repo, owner}) => {
  const cases = [
    {name:'invalid', code:'not-a-real-invitation', message:/无效/},
    {name:'revoked', action:i=>repo.revokeInvitation(i.id), message:/撤销/},
    {name:'expired', action:i=>repo.db.prepare("UPDATE invitations SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(i.id), message:/过期/},
    {name:'email', email:'target@example.test', message:/邮箱.*不匹配/},
    {name:'workspace', workspaceSlug:'qa-personal', message:/工作区.*不匹配/},
  ];
  for (const entry of cases) {
    const invite = (await post('/api/workspaces/qa-team/invitations', entry.email ? {email:entry.email} : {}, owner.cookie)).body;
    entry.action?.(invite);
    const email = `${entry.name}@example.test`;
    const body = registration(email, invite, entry.workspaceSlug || 'qa-team');
    if (entry.code) body.invitationCode = entry.code;
    const result = await post('/api/auth/register', body);
    assert.equal(result.status, 400, entry.name); assert.match(result.body.error, entry.message, entry.name);
    assert.equal(repo.db.prepare('SELECT count(*) AS n FROM local_users WHERE email=?').get(email).n, 0);
  }
}));

test('accepted legacy link invitations can only bind the member email and cannot be reused by strangers', async () => fixture(async ({post, repo, owner}) => {
  const invite = (await post('/api/workspaces/qa-team/invitations', {}, owner.cookie)).body;
  const legacy = repo.acceptInvitation(invite.code, {name:'Legacy', email:'legacy@example.test'});
  const stranger = await post('/api/auth/register', registration('other@example.test', invite));
  assert.equal(stranger.status, 400); assert.match(stranger.body.error, /已经|已被/);
  const joined = await post('/api/auth/register', registration('legacy@example.test', invite));
  assert.equal(joined.status, 201, joined.body.error);
  assert.equal(joined.body.memberships[0].id, legacy.member.id);
  assert.equal(joined.body.memberships[0].role, 'member');
}));
