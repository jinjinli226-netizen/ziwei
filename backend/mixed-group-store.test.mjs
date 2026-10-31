import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from './repository.mjs';
import { createMixedGroupStore } from './mixed-group-store.mjs';

const roster = [
  { employeeId: 'hermes-1', name: 'Hermes', runtime: 'Hermes', profile: 'bot-hermes', deviceId: 'pc-1', conversationId: 'conv-hermes' },
  { employeeId: 'dsh-1', name: 'DSH', runtime: 'DSH', profile: 'community-lead', deviceId: 'pc-1', conversationId: 'conv-dsh', sessionId: 'session-dsh' },
  { employeeId: 'codex-1', name: 'Codex', runtime: 'Codex', profile: 'default', deviceId: 'pc-1', conversationId: 'conv-codex' },
];

test('mixed group store persists one workspace roster and exposes deterministic send plan', () => {
  const repo = createRepository({ memory: true });
  try {
    repo.heartbeatDevice('test-111', { deviceId: 'pc-1', runtimes: { Hermes: { status: 'available' }, DSH: { status: 'available' }, Codex: { status: 'available' } } });
    const actualRoster = roster.map(member => {
      const employee = repo.createEmployee('test-111', { name: member.name, runtime: member.runtime, runtimeProfile: member.profile, targetDeviceId: 'pc-1', status: 'active' });
      const conversation = repo.createConversation('test-111', { employeeId: employee.id, title: `${member.name} · 混合群` });
      return { ...member, employeeId: employee.id, conversationId: conversation.id };
    });
    const store = createMixedGroupStore(repo);
    const created = store.create('test-111', { id: 'mix_store', title: '混合群', members: actualRoster });
    assert.equal(created.members.length, 3);
    assert.equal(store.list('test-111')[0].id, 'mix_store');
    const planned = store.planSend('test-111', 'mix_store', { content: '@community-lead 请先回复' });
    assert.equal(planned.state, 'dispatched');
    assert.equal(planned.plan.members.length, 1);
    assert.equal(planned.execution, 'conversation_execute');
    assert.throws(() => store.create('test-111', { id: 'mix_store', title: '重复', members: actualRoster }), /已存在/);
  } finally { repo.db.close(); }
});

test('mixed group store keeps DSH native group storage separate', () => {
  const repo = createRepository({ memory: true });
  try {
    repo.heartbeatDevice('test-111', { deviceId: 'pc-1', runtimes: { Hermes: { status: 'available' }, DSH: { status: 'available' }, Codex: { status: 'available' } } });
    const actualRoster = roster.map(member => {
      const employee = repo.createEmployee('test-111', { name: member.name, runtime: member.runtime, runtimeProfile: member.profile, targetDeviceId: 'pc-1', status: 'active' });
      const conversation = repo.createConversation('test-111', { employeeId: employee.id, title: `${member.name} · 混合群` });
      return { ...member, employeeId: employee.id, conversationId: conversation.id };
    });
    const store = createMixedGroupStore(repo);
    store.create('test-111', { id: 'mix_separate', title: '独立混合群', members: actualRoster });
    assert.equal(repo.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='mixed_groups'").get().name, 'mixed_groups');
    assert.equal(repo.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='management_requests'").get().name, 'management_requests');
  } finally { repo.db.close(); }
});
