import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../backend/repository.mjs';

test('API keys return the secret once and store only a hash', () => {
  const repo = createRepository({ memory: true });
  const created = repo.createApiKey('test-111', { name: '本地开发' });
  assert.match(created.token, /^zwi_/);
  assert.equal('token_hash' in created, false);
  const listed = repo.listApiKeys('test-111');
  assert.equal(listed[0].prefix, created.prefix);
  assert.equal('token_hash' in listed[0], false);
  assert.equal(repo.revokeApiKey(created.id).status, 'revoked');
  assert.equal(repo.verifyApiKey(created.token), null);
});

test('API key expiry is enforced before external access', () => {
  const repo = createRepository({ memory: true });
  const created = repo.createApiKey('test-111', { name: '过期', expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal(repo.verifyApiKey(created.token), null);
  assert.equal(repo.listApiKeys('test-111')[0].status, 'expired');
});
