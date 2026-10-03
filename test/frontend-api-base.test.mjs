import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveApiBase } from '../frontend/src/api-base.js';

test('production frontend defaults API requests to the page origin', () => {
  assert.equal(resolveApiBase({ origin: 'https://154.202.118.5' }), 'https://154.202.118.5');
});

test('explicit API URL overrides the page origin and removes trailing slashes', () => {
  assert.equal(resolveApiBase({ configured: 'https://api.example.test///', origin: 'https://page.example.test' }), 'https://api.example.test');
});

test('development frontend keeps the local API default', () => {
  assert.equal(resolveApiBase({ dev: true }), 'http://127.0.0.1:4178');
});
