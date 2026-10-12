import test from 'node:test';
import assert from 'node:assert/strict';

const state = await import('./bot-state.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});

test('Bot request scopes reject late reads and writes after workspace or Bot navigation', () => {
  const scope = state.createBotRequestScope();
  scope.select('workspace-a', 'bot-a');
  const old = scope.begin('detail');
  scope.select('workspace-b', 'bot-a');
  assert.equal(scope.current(old), false);
  const first = scope.begin('detail'), second = scope.begin('detail');
  assert.equal(scope.current(first), false);
  assert.equal(scope.current(second), true);
  const saving = scope.begin('save');
  scope.select('workspace-b', 'bot-b');
  assert.equal(scope.current(saving), false);
  scope.select('workspace-b', 'bot-a');
  assert.equal(scope.current(saving), false, 'returning to the same Bot must not revive old requests');
});

test('loading channels remain independent and disposal rejects all outstanding effects', () => {
  const scope = state.createBotRequestScope();
  scope.select('workspace-a', 'bot-a');
  const read = scope.begin('detail'), control = scope.begin('control');
  assert.equal(scope.current(read), true);
  assert.equal(scope.current(control), true);
  scope.dispose();
  assert.equal(scope.current(read), false);
  assert.equal(scope.current(control), false);
});

test('Bot errors distinguish conflicts, uncertain outcomes, missing APIs and validation failure', () => {
  assert.match(state.botErrorMessage({status:409}), /版本|冲突/);
  assert.match(state.botErrorMessage({status:404}), /接口|不存在/);
  assert.match(state.botErrorMessage({status:400,message:'请选择真实设备'}), /请选择真实设备/);
  assert.match(state.botErrorMessage(new TypeError('Failed to fetch'), {mutation:true}), /未确认|结果未知/);
  assert.doesNotMatch(state.botErrorMessage(new TypeError('Failed to fetch'), {mutation:true}), /重试/);
});

test('unknown timestamps stay unknown and valid times include the chosen timezone', () => {
  assert.equal(state.botTime(null), '尚未返回');
  assert.equal(state.botTime('invalid'), '尚未返回');
  assert.match(state.botTime('2026-10-12T01:00:00Z', 'Asia/Shanghai'), /09:00/);
  assert.match(state.botTime('2026-10-12T01:00:00Z', 'Asia/Shanghai'), /Asia\/Shanghai/);
});
