import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileGroupCandidates, mobileGroupMemberDescriptors } from '../web/mobile-groups.js';

test('mobile group candidates include Hermes, DSH and Codex employees', () => {
  const state = { employees: [
    { id: 'hermes-one', runtime: 'Hermes', status: 'active' },
    { id: 'dsh-one', runtime: 'DSH', status: 'active' },
    { id: 'codex-one', runtime: 'Codex', status: 'active' },
    { id: 'unknown-one', runtime: 'Claude', status: 'active' },
    { id: 'deleted-one', runtime: 'DSH', status: 'deleted' },
  ], bots: [] };
  assert.deepEqual(mobileGroupCandidates(state).map(employee => employee.id), ['hermes-one', 'dsh-one', 'codex-one']);
  assert.deepEqual(mobileGroupMemberDescriptors(state, ['hermes-one', 'dsh-one', 'codex-one']), [
    { employeeId: 'hermes-one', runtime: 'Hermes' },
    { employeeId: 'dsh-one', runtime: 'DSH' },
    { employeeId: 'codex-one', runtime: 'Codex' },
  ]);
});
