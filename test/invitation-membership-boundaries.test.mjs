import assert from 'node:assert/strict';
import test from 'node:test';
import { createRepository } from '../backend/repository.mjs';
import { createAuthService } from '../backend/auth.mjs';

const account = email => ({ name:'Recipient', email, password:'test-password' });
const counts = db => Object.fromEntries(['local_users', 'local_sessions', 'workspaces', 'members'].map(table => [table, db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n]));

for (const kind of ['personal', 'team']) {
  for (const role of ['member', 'admin']) {
    for (const status of ['pending', 'accepted']) {
      test(`${kind} ${status} ${role} invitations bind the matching legacy owner without removing ownership`, () => {
        const repo = createRepository({ memory:true });
        const auth = createAuthService(repo.db);
        try {
          repo.db.prepare("UPDATE workspaces SET kind=? WHERE slug='test-111'").run(kind);
          const invitation = repo.createInvitation('test-111', { email:'owner@example.com', role });
          if (status === 'accepted') repo.acceptInvitation(invitation.code, { email:'owner@example.com' });
          const joined = auth.register({ ...account('owner@example.com'), invitationCode:invitation.code });
          const owner = repo.db.prepare("SELECT * FROM members WHERE id='member-owner'").get();
          assert.equal(joined.memberships[0].id, 'member-owner');
          assert.equal(owner.user_id, joined.user.id);
          assert.equal(owner.role, 'owner');
          assert.equal(repo.listMembers('test-111').length, 1);
          assert.equal(auth.canAccess(joined.user.id, 'test-111').role, 'owner');
          assert.equal(repo.getInvitationByCode(invitation.code).status, 'accepted');
        } finally { repo.db.close(); }
      });
    }

    test(`new ${kind} recipients retain the invited ${role} role`, () => {
      const repo = createRepository({ memory:true });
      const auth = createAuthService(repo.db);
      try {
        repo.db.prepare("UPDATE workspaces SET kind=? WHERE slug='test-111'").run(kind);
        const invitation = repo.createInvitation('test-111', { email:'new@example.test', role });
        const joined = auth.register({ ...account('new@example.test'), invitationCode:invitation.code });
        assert.equal(joined.memberships[0].role, role);
        assert.equal(repo.listMembers('test-111').filter(member => member.role === 'owner').length, 1);
      } finally { repo.db.close(); }
    });
  }
}

test('an unknown workspace without an invitation is rejected without retaining account or workspace data', () => {
  const repo = createRepository({ memory:true });
  const auth = createAuthService(repo.db);
  try {
    const before = counts(repo.db);
    assert.throws(() => auth.register({ ...account('unknown@example.test'), workspaceSlug:'missing-workspace' }), /工作区.*不存在/);
    assert.deepEqual(counts(repo.db), before);
    assert.equal(repo.getWorkspace('missing-workspace'), undefined);
  } finally { repo.db.close(); }
});

test('blank workspace registration still creates a personal workspace with its owner', () => {
  const repo = createRepository({ memory:true });
  const auth = createAuthService(repo.db);
  try {
    const joined = auth.register({ ...account('ordinary@example.test'), workspaceSlug:'  ' });
    assert.equal(joined.memberships.length, 1);
    assert.equal(joined.memberships[0].kind, 'personal');
    assert.equal(joined.memberships[0].role, 'owner');
    assert.equal(auth.canAccess(joined.user.id, joined.memberships[0].slug).role, 'owner');
  } finally { repo.db.close(); }
});

test('invitation workspace mismatches reject unknown or different slugs and roll back registration', () => {
  const repo = createRepository({ memory:true });
  const auth = createAuthService(repo.db);
  try {
    const manager = auth.setup(account('manager@example.test'));
    auth.createWorkspace(manager.user.id, { name:'Other', slug:'other-workspace', kind:'team' });
    const invitation = repo.createInvitation('test-111', {});
    const before = counts(repo.db);
    for (const workspaceSlug of ['missing-workspace', 'other-workspace']) {
      assert.throws(() => auth.register({ ...account(`${workspaceSlug}@example.test`), workspaceSlug, invitationCode:invitation.code }), /工作区.*不匹配/);
      assert.deepEqual(counts(repo.db), before);
      assert.equal(repo.getInvitationByCode(invitation.code).status, 'pending');
      assert.equal(repo.getInvitationByCode(invitation.code).member_id, null);
    }
    assert.throws(() => auth.register({ ...account('invalid-code@example.test'), workspaceSlug:'missing-workspace', invitationCode:'invalid-code' }), /无效/);
    assert.deepEqual(counts(repo.db), before);
  } finally { repo.db.close(); }
});
