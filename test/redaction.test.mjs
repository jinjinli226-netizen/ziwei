import test from 'node:test';
import assert from 'node:assert/strict';
import {redactSecrets} from '../src/redaction.mjs';

test('redacts token-like values while preserving operational context', () => {
  const input = 'server=https://api.example.test token=secret-value authorization=Bearer abc123';
  const output = redactSecrets(input);
  assert.match(output, /server=https:\/\/api\.example\.test/);
  assert.doesNotMatch(output, /secret-value|abc123/);
  assert.match(output, /REDACTED/);
});
