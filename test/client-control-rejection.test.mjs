import test from 'node:test';
import assert from 'node:assert/strict';
import { localControlRejection } from '../scripts/client-lifecycle.mjs';

test('local stop failures explain actual blockers without printing raw state', () => {
  const error = localControlRejection(409, { error: 'CLIENT_STOP_UNSAFE', reasons: [
    { code: 'ACTIVE_ACTIONS', count: 2 }, { code: 'DELIVERY_NOT_DRAINED', count: 1 },
  ], token: 'private-token', path: 'private-path' });
  assert.equal(error.code, 'CONTROL_REJECTED');
  assert.match(error.message, /仍有任务执行（2）/);
  assert.match(error.message, /历史回执缺少可核验的退出记录（1）/);
  assert.doesNotMatch(error.message, /private|token|path/);
});

test('old empty responses and unsupported bodies retain a generic rejection', () => {
  for (const body of [null, {}, { error: 'secret', reasons: [{ code: 'ACTIVE_ACTIONS', count: 2 }] }]) {
    assert.equal(localControlRejection(409, body).message, '本机控制请求被拒绝（HTTP 409）；未强制结束进程');
  }
  assert.doesNotMatch(localControlRejection(401, { error: 'CLIENT_STOP_UNSAFE', reasons: [{ code: 'ACTIVE_ACTIONS', count: 2 }] }).message, /仍有任务/);
});

test('stop diagnostic output remains bounded and rejects unsafe fields', () => {
  const body = { error: 'CLIENT_STOP_UNSAFE', reasons: [null, { code: '__proto__', count: 'secret' }, { code: 'private-path', count: -1 }, ...Array.from({ length: 100 }, () => ({ code: 'ACTIVE_ACTIONS', count: 1e20 }))] };
  const error = localControlRejection(409, body);
  assert.doesNotMatch(error.message, /private|secret|proto|100000/);
  assert.ok(error.message.length < 200);
  assert.match(localControlRejection(409, { error: 'CLIENT_CONTROL_IDENTITY_CHANGED', reasons: [{ code: 'BOOT_IDENTITY_MISMATCH', count: 1 }] }).message, /客户端已重启/);
});
