import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MIXED_GROUP_RUNTIMES,
  normalizeMixedGroup,
  resolveMixedGroupTargets,
  planMixedGroupDispatch,
  appendMixedGroupTurn,
} from './mixed-groups.mjs';

const members = [
  { employeeId: 'hermes-1', name: 'Hermes', runtime: 'Hermes', profile: 'bot-hermes', deviceId: 'pc-1', conversationId: 'conv-hermes' },
  { employeeId: 'dsh-1', name: 'DSH', runtime: 'DSH', profile: 'community-lead', deviceId: 'pc-1', conversationId: 'conv-dsh', sessionId: 'dsh-session-1' },
  { employeeId: 'codex-1', name: 'Codex', runtime: 'Codex', profile: 'default', deviceId: 'pc-1', conversationId: 'conv-codex' },
];

const group = () => normalizeMixedGroup({
  id: 'mix_demo', title: '混合群', workspace: 'bigtron', members,
});

test('mixed group normalizes Hermes, DSH and Codex members into one frozen roster', () => {
  const value = group();
  assert.deepEqual(MIXED_GROUP_RUNTIMES, ['Hermes', 'DSH', 'Codex']);
  assert.deepEqual(value.members.map(member => member.runtime), MIXED_GROUP_RUNTIMES);
  assert.equal(value.members.every(member => member.workspace === 'bigtron'), true);
  assert.notEqual(value.rosterHash, undefined);
});

test('mixed group rejects duplicate employees, cross-workspace bindings and invalid runtimes', () => {
  assert.throws(() => normalizeMixedGroup({ id: 'mix_g', title: 'g', workspace: 'w', members: [members[0]] }), /2–6/);
  assert.throws(() => normalizeMixedGroup({ id: 'mix_g', title: 'g', workspace: 'w', members: [members[0], { ...members[1], employeeId: members[0].employeeId }] }), /唯一/);
  assert.throws(() => normalizeMixedGroup({ id: 'mix_g', title: 'g', workspace: 'w', members: [members[0], { ...members[1], workspace: 'other' }] }), /工作区/);
  assert.throws(() => normalizeMixedGroup({ id: 'mix_g', title: 'g', workspace: 'w', members: [members[0], { ...members[1], runtime: 'Unknown' }] }), /runtime/);
});

test('mixed group target resolution supports @profile, @name, @all and defaults to all members', () => {
  const value = group();
  assert.deepEqual(resolveMixedGroupTargets(value, '请 @community-lead 先看'), ['dsh-1']);
  assert.deepEqual(resolveMixedGroupTargets(value, '@Codex 处理'), ['codex-1']);
  assert.deepEqual(resolveMixedGroupTargets(value, '@all 同步'), ['hermes-1', 'dsh-1', 'codex-1']);
  assert.deepEqual(resolveMixedGroupTargets(value, '没有点名'), ['hermes-1', 'dsh-1', 'codex-1']);
  assert.throws(() => resolveMixedGroupTargets(value, '@unknown 处理'), /不是混合群成员/);
});

test('mixed group planner emits runtime-specific child bindings without borrowing private chats', () => {
  const value = group();
  const plan = planMixedGroupDispatch({ group: value, content: '请分别给出结论', targetEmployeeIds: ['hermes-1', 'dsh-1', 'codex-1'], source: { type: 'user', messageId: 'm1' } });
  assert.equal(plan.groupId, value.id);
  assert.equal(plan.members.length, 3);
  assert.deepEqual(plan.members.map(member => member.runtime), MIXED_GROUP_RUNTIMES);
  assert.equal(plan.members.every(member => member.groupId === value.id), true);
  assert.equal(plan.members.every(member => member.conversationId.startsWith('conv-')), true);
  assert.equal(plan.members.some(member => member.conversationId === 'private'), false);
  assert.equal(plan.members.every(member => member.prompt.includes('混合群')), true);
});

test('mixed group history appends bounded user and member outcomes while preserving unknown status', () => {
  const value = group();
  const next = appendMixedGroupTurn(value, {
    messageId: 'm1', content: '讨论',
    runs: [
      { employeeId: 'hermes-1', runtime: 'Hermes', actionId: 'a1', status: 'succeeded', output: 'H' },
      { employeeId: 'dsh-1', runtime: 'DSH', actionId: 'a2', status: 'unknown', error: '未确认' },
      { employeeId: 'codex-1', runtime: 'Codex', actionId: 'a3', status: 'failed', error: '失败' },
    ],
  });
  assert.equal(next.messages.length, 4);
  assert.equal(next.messages.at(-3).runtime, 'Hermes');
  assert.equal(next.messages.at(-2).status, 'unknown');
  assert.equal(next.messages.at(-1).runtime, 'Codex');
  assert.equal(next.members.length, value.members.length);
});
