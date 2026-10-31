import test from 'node:test';
import assert from 'node:assert/strict';
import { getOperation } from '../src/registry.mjs';

test('CLI collaboration schema exposes mixed Hermes, DSH and Codex members', () => {
  const operation = getOperation('bots.collaboration');
  const data = operation.inputSchema.properties.data;
  for (const field of ['members', 'memberDescriptors']) {
    const schema = data.properties[field];
    assert.equal(schema.type, 'array');
    assert.equal(schema.maxItems, 6);
    assert.deepEqual(schema.items.properties.runtime.enum, ['Hermes', 'DSH', 'Codex']);
    assert.deepEqual(schema.items.required, ['employeeId', 'runtime']);
  }
});
