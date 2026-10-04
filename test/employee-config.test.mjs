import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../backend/repository.mjs';

test('employee configuration stores redacted environment variables and durable custom params', () => {
  const repo = createRepository({ memory: true, envEncryptionKey: 'test-key-for-employee-config' });
  const employee = repo.createEmployee('test-111', { name: '配置员工', runtime: 'Hermes' });
  const savedSecret = repo.upsertEmployeeEnvironment(employee.id, { key: 'API_TOKEN', value: 'super-secret', sensitive: true });
  const savedPublic = repo.upsertEmployeeEnvironment(employee.id, { key: 'LOG_LEVEL', value: 'debug', sensitive: false });
  assert.equal(savedSecret.masked_value, '••••••••'); assert.equal('value' in savedSecret, false); assert.equal(savedPublic.value, 'debug');
  const storedSecret = repo.db.prepare('SELECT value_ciphertext FROM employee_environment_variables WHERE employee_id=? AND key=?').get(employee.id, 'API_TOKEN');
  assert.ok(storedSecret?.value_ciphertext); assert.doesNotMatch(storedSecret.value_ciphertext, /super-secret/);
  const listed = repo.listEmployeeEnvironment(employee.id);
  assert.equal(listed.variables.some(item => item.key === 'API_TOKEN' && !('value' in item)), true); assert.equal(listed.variables.find(item => item.key === 'LOG_LEVEL').value, 'debug');
  assert.equal(listed.local_source.source, 'ziwei_user'); assert.ok(listed.local_source.variables.includes('ZIWEI_WORKSPACE'));
  const params = repo.replaceEmployeeCustomParams(employee.id, { temperature: 0.2, enabled: true, labels: ['daily'] });
  assert.deepEqual(params.values, { temperature: 0.2, enabled: true, labels: ['daily'] }); assert.deepEqual(repo.getEmployeeCustomParams(employee.id).values, params.values); assert.throws(() => repo.replaceEmployeeCustomParams(employee.id, { bad: undefined }), /JSON/);
});

test('employee configuration rejects invalid keys and prevents cross-employee access', () => {
  const repo = createRepository({ memory: true, envEncryptionKey: 'test-key-for-employee-config' });
  const first = repo.createEmployee('test-111', { name: '一号' }); const second = repo.createEmployee('test-111', { name: '二号' });
  assert.throws(() => repo.upsertEmployeeEnvironment(first.id, { key: 'bad key', value: 'x' }), /变量名/); assert.throws(() => repo.getEmployeeCustomParams('missing'), /数字员工不存在/);
  repo.upsertEmployeeEnvironment(first.id, { key: 'SAFE', value: 'x' }); assert.equal(repo.listEmployeeEnvironment(second.id).variables.find(item => item.key === 'SAFE'), undefined);
});

test('employee configuration tables and runtime profile metadata migrate an older SQLite file', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-old-db-')), 'ziwei.sqlite');
  let oldRepo; let repo;
  try {
    oldRepo = createRepository({ filename: file, envEncryptionKey: 'migration-test-key' });
    oldRepo.db.exec('ALTER TABLE runtime_metadata DROP COLUMN profiles_json');
    oldRepo.db.exec('DROP TABLE employee_environment_variables; DROP TABLE employee_custom_params;');
    repo = createRepository({ filename: file, envEncryptionKey: 'migration-test-key' });
    const employee = repo.createEmployee('test-111', { name: '旧库员工' });
    repo.upsertEmployeeEnvironment(employee.id, { key: 'MIGRATED', value: 'ok', sensitive: false });
    assert.equal(repo.listEmployeeEnvironment(employee.id).variables[0].value, 'ok');
    assert.deepEqual(repo.listHermesProfiles('test-111').runtime, 'Hermes');
  } finally { try { oldRepo?.db.close(); } catch {} try { repo?.db.close(); } catch {} try { fs.rmSync(path.dirname(file), { recursive: true, force: true }); } catch {} }
});


