import test from 'node:test';
import assert from 'node:assert/strict';
import { localControlRejection } from '../scripts/client-lifecycle.mjs';
import {describeUpdateFailure,updateFailureResult} from '../scripts/client-update.mjs';

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

test('updater retains the actual unmapped execution blocker and HTTP status without private fields',()=>{
  const original=localControlRejection(409,{error:'CLIENT_STOP_UNSAFE',reasons:[{code:'UNMAPPED_NATIVE_EXECUTION',count:1,path:'PRIVATE_PATH',actionId:'PRIVATE_ACTION'}],token:'PRIVATE_TOKEN'});
  assert.deepEqual(original.stopReasons,[{code:'UNMAPPED_NATIVE_EXECUTION',count:1}]);
  const recovery=Object.assign(new Error('PRIVATE_ERROR',{cause:original}),{code:'RETAINED_STOP_RECOVERY_REFUSED'});
  for(const error of [original,recovery]) {
    const result=updateFailureResult(error,'stop_client');
    assert.equal(result.httpStatus,409);assert.equal(result.reasonCode,error.code);
    assert.deepEqual(result.stopReasons,original.stopReasons);
    assert.match(result.message,/历史原生任务缺少进程状态记录（1）/);
    assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|STOP_CLIENT_FAILED/);
  }
});

test('update failure projects only known stop codes and bounded counts from a nested refusal',()=>{
  const original=Object.assign(new Error('PRIVATE_ERROR'),{code:'CONTROL_REJECTED',httpStatus:409,stopReasons:[{code:'PRIVATE_CODE',count:1,path:'PRIVATE_PATH'},{code:'ACTIVE_ACTIONS',count:1e20}]});
  const result=describeUpdateFailure(new Error('PRIVATE_OUTER',{cause:original}),'stop_client');
  assert.deepEqual(result.stopReasons,[{code:'FILE_EVIDENCE_UNSAFE',count:1},{code:'ACTIVE_ACTIONS'}]);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|100000/);
});
