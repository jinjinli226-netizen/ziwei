import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRepository } from '../backend/repository.mjs';
import { createManagementBootstrap } from '../backend/management-bootstrap.mjs';
import { createManagementService } from '../backend/management.mjs';
import { createPhoneMcpService } from '../backend/phone-mcp.mjs';

const secret = 'isolated-management-security-signing-key';
function fixture(t, { kind = 'team', owned = true } = {}) {
  const repo = createRepository({ memory: true, envEncryptionKey: 'isolated-security-encryption-key' });
  t.after(() => repo.db.close());
  const workspaceId = 'security-workspace';
  repo.db.prepare('INSERT INTO workspaces(id,slug,name,kind,created_at) VALUES(?,?,?,?,?)').run(workspaceId, 'security', '隔离安全测试', kind, new Date().toISOString());
  repo.db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run('security-member', workspaceId, 'security-user', '隔离成员', 'security@example.test', 'member', new Date().toISOString());
  const pair = repo.createDevicePairing('security', { name: '隔离电脑', createdBy: owned ? 'security-user' : null });
  const device = repo.claimDevicePairing({ code: pair.code });
  if (owned) repo.db.prepare('UPDATE devices SET owner_user_id=? WHERE id=?').run('security-user', device.deviceId);
  const runtimes = { Hermes: { status: 'available', profiles: [{ name: 'default', provider_configured: true, authentication_configured: true }] } };
  repo.heartbeatDevice('security', { deviceId: device.deviceId, runtimes });
  const identity = repo.authenticateDeviceToken(device.deviceToken);
  let clock = Date.now();
  const service = createManagementBootstrap(repo, { memory: true, managementMcpSecret: secret, managementMcpNow: () => clock });
  return { repo, device, identity, service, management: createManagementService(repo), advance: ms => { clock += ms; }, clock: () => clock, runtimes };
}
function signed(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const key = crypto.createHash('sha256').update(secret).update('ziwei-management-capability-v1').digest();
  return `zmcp1.${body}.${crypto.createHmac('sha256', key).update('zmcp1.' + body).digest('base64url')}`;
}

test('management signing persists privately across service recreation and rotation rejects old credentials', t => {
  const f = fixture(t);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-management-key-security-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const options = { managementMcpSecretFile: path.join(directory, 'management.key') };
  const first = createManagementBootstrap(f.repo, options);
  const issued = first.bootstrap('security', f.identity);
  assert.equal(createManagementBootstrap(f.repo, options).authorize(issued.token, 'security').actorRole, 'member');
  fs.renameSync(options.managementMcpSecretFile, path.join(directory, 'previous.key'));
  assert.throws(() => createManagementBootstrap(f.repo, options).authorize(issued.token, 'security'), error => error.status === 401);
});

test('management capability rejects wrong audience, invalid expiry and expiry beyond its one-hour limit', t => {
  const f = fixture(t);
  const { token: _token, apiBase: _apiBase, managed: _managed, ...issued } = f.service.bootstrap('security', f.identity);
  for (const replacement of [
    { audience: 'ziwei-phone' }, { expiresAt: 'invalid-date' }, { expiresAt: null },
    { expiresAt: new Date(f.clock()).toISOString() },
    { expiresAt: new Date(f.clock() + 3600001).toISOString() }
  ]) assert.throws(() => f.service.authorize(signed({ ...issued, ...replacement }), 'security'), error => error.status === 401);
  const token = signed(issued);
  f.advance(3600000);
  assert.throws(() => f.service.authorize(token, 'security'), error => error.status === 401);
});

test('management credentials never authorize phone execution and phone credentials never authorize management', async t => {
  const f = fixture(t);
  const cap = f.service.bootstrap('security', f.identity);
  const phoneBody = Buffer.from(JSON.stringify({ workspace: 'security', employeeId: 'isolated-phone-employee', expiresAt: cap.expiresAt })).toString('base64url');
  const phoneKey = crypto.createHash('sha256').update('isolated-phone-security-key').update('ziwei-phone-capability-v1').digest();
  const phoneToken = `${phoneBody}.${crypto.createHmac('sha256', phoneKey).update(phoneBody).digest('base64url')}`;
  assert.equal(f.service.authorize(phoneToken, 'security'), null);
  const phone = createPhoneMcpService(f.repo, {}, f.management, { memory: true, phoneMcpSecret: 'isolated-phone-security-key' });
  await assert.rejects(phone.call('security', 'isolated-phone-employee', cap.token, { name: 'ziwei_phone_list' }), error => error.status === 401);
});

test('live device membership overrides caller role and immediately follows member downgrade or removal', t => {
  const f = fixture(t);
  const issued = f.service.bootstrap('security', { ...f.identity, actorRole: 'owner', actorUserId: 'other-user', workspaceId: 'other-workspace' });
  assert.equal(f.service.authorize(issued.token, 'security').actorRole, 'member');
  assert.equal(f.service.authorize(issued.token, 'security').actorUserId, 'security-user');
  f.repo.db.prepare("UPDATE members SET role='admin' WHERE id='security-member'").run();
  assert.equal(f.service.authorize(issued.token, 'security').actorRole, 'admin');
  f.repo.db.prepare("UPDATE members SET role='member' WHERE id='security-member'").run();
  assert.equal(f.service.authorize(issued.token, 'security').actorRole, 'member');
  f.repo.db.prepare("DELETE FROM members WHERE id='security-member'").run();
  assert.throws(() => f.service.authorize(issued.token, 'security'), error => error.status === 403);
});

test('member bodies cannot claim another user identity when creating a Hermes profile action', t => {
  const f = fixture(t);
  f.repo.db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run('forged-existing-member', 'security-workspace', 'forged-other-user', '另一位隔离成员', 'forged@example.test', 'member', new Date().toISOString());
  const context = f.service.authorize(f.service.bootstrap('security', f.identity).token, 'security');
  const action = f.management.createProfile('security', { profile: 'isolated-identity-check', soul: '# isolated', deviceId: f.device.deviceId, userId: 'forged-other-user', user_id: 'forged-other-user', actorUserId: 'forged-other-user', actorRole: 'owner' }, context);
  assert.equal(action.payload.userId, 'security-user');
});

test('ownerless paired computers can create their own profile only through a trusted credential context', t => {
  const f = fixture(t, { kind: 'personal', owned: false });
  const other = f.repo.createDevice('security', { name: '另一台隔离个人电脑', ownerUserId: 'other-user' });
  f.repo.heartbeatDevice('security', { deviceId: other.id, runtimes: f.runtimes });
  const input = { profile: 'isolated-legacy-profile', soul: '# isolated', deviceId: f.device.deviceId, actorRole: 'member' };
  assert.throws(() => f.repo.createHermesProfileAction('security', { ...input, deviceCredentialDeviceId: f.device.deviceId }), error => error.status === 403);
  const action = f.repo.createHermesProfileAction('security', input, { deviceCredentialDeviceId: f.device.deviceId });
  assert.equal(action.payload.deviceId, f.device.deviceId);
  assert.throws(() => f.repo.createHermesProfileAction('security', { ...input, deviceId: other.id }, { deviceCredentialDeviceId: f.device.deviceId }), error => error.status === 403);
});

test('member management hides private employees and their action receipts from other users', t => {
  const f = fixture(t);
  const context = f.service.authorize(f.service.bootstrap('security', f.identity).token, 'security');
  const employee = f.repo.createEmployee('security', { name: '其他用户私人', visibility: 'personal', ownerUserId: 'private-other-user', instructions: 'ISOLATED_PRIVATE_INSTRUCTIONS' });
  assert.throws(() => f.management.employee('security', employee.id, context), error => error.status === 404);
  const action = f.repo.createA2AAction('security', { type: 'conversation.execute', payload: { employeeId: employee.id, prompt: 'ISOLATED_PRIVATE_PROMPT', deviceId: f.device.deviceId } });
  assert.throws(() => f.management.action('security', action.id, context), error => error.status === 404);
  const task = f.repo.createTask('security', { title: '私人员工关联任务', assignee: employee.id });
  assert.throws(() => f.management.task('security', task.id, context), error => error.status === 404);
  assert.equal(f.management.tasks('security', {}, context).some(row => row.id === task.id), false);
});

test('ownerless personal device credentials discover and report only their own computer', t => {
  const f = fixture(t, { kind: 'personal', owned: false });
  const other = f.repo.createDevice('security', { name: '其他个人电脑', ownerUserId: 'other-private-user' });
  f.repo.heartbeatDevice('security', { deviceId: other.id, runtimes: f.runtimes, workdir: '/isolated-private-directory' });
  const context = f.service.authorize(f.service.bootstrap('security', f.identity).token, 'security');
  assert.equal(context.actorRole, 'member'); assert.equal(context.actorUserId, null); assert.equal(context.deviceScope, f.device.deviceId);
  const discovered = f.management.discovery('security', { userId: context.actorUserId, deviceScope: context.deviceScope });
  assert.deepEqual(discovered.devices.map(row => row.id), [f.device.deviceId]);
  const employee = f.repo.createEmployee('security', { name: '工作区共享员工', targetDeviceId: other.id, runtime: 'Hermes', runtimeProfile: 'default' });
  assert.equal(f.management.employeeStatus('security', employee.id, context).device, null);
  assert.deepEqual(f.service.connections('security', context).map(row => row.device_id), [f.device.deviceId]);
  const otherAction = f.repo.createA2AAction('security', { type: 'conversation.execute', payload: { employeeId: employee.id, deviceId: other.id, cwd: '/isolated-private-directory', prompt: 'ISOLATED_OTHER_COMPUTER_PROMPT' } });
  assert.throws(() => f.management.action('security', otherAction.id, context), error => error.status === 404);
  const ownEmployee = f.repo.createEmployee('security', { name: '旧连接本机员工', targetDeviceId: f.device.deviceId, runtime: 'Hermes', runtimeProfile: 'default' });
  const ownTask = f.management.createTask('security', { title: '旧连接本机隔离任务', employeeId: ownEmployee.id, execute: true }, context);
  assert.equal(ownTask.assignee, ownEmployee.id);
  assert.throws(() => f.management.createTask('security', { title: '伪造其他电脑目标', employeeId: ownEmployee.id, execute: true, targetDeviceId: other.id, actorRole: 'owner', deviceScope: other.id, deviceCredentialDeviceId: other.id }, context), error => error.code === 'DEVICE_NOT_IN_WORKSPACE');
});
