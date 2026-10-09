import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createRepository } from '../backend/repository.mjs';
import { openDatabase } from '../backend/db.mjs';
import { createManagementBootstrap } from '../backend/management-bootstrap.mjs';

const repository = () => createRepository({ memory: true, envEncryptionKey: 'management-default-test-only-key' });
function addWorkspace(repo, slug, kind = 'team') {
  const workspaceId = `ws-${slug}`;
  repo.db.prepare('INSERT INTO workspaces(id,slug,name,kind,created_at) VALUES(?,?,?,?,?)').run(workspaceId, slug, slug, kind, new Date().toISOString());
  return workspaceId;
}

test('new employees always use default management, including old false options', t => {
  const repo = repository(); t.after(() => repo.db.close());
  const column = repo.db.prepare('PRAGMA table_info(employees)').all().find(row => row.name === 'management_mcp_enabled');
  assert.equal(column.dflt_value, '1');
  for (const input of [{}, { managementMcpEnabled: false }, { management_mcp_enabled: false }, { managementMcp: { enabled: false } }]) {
    const employee = repo.createEmployee('test-111', { name: '默认成员', ...input });
    assert.equal(employee.management_mcp_enabled, true);
    assert.equal(repo.updateEmployee(employee.id, input).management_mcp_enabled, true);
    assert.equal(repo.db.prepare('SELECT management_mcp_enabled FROM employees WHERE id=?').get(employee.id).management_mcp_enabled, 1);
  }
});

test('legacy false and null employees migrate once without changing timestamps or phone configuration', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-management-default-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'legacy.sqlite');
  const legacy = new DatabaseSync(filename);
  legacy.exec(`CREATE TABLE workspaces (id TEXT PRIMARY KEY,slug TEXT UNIQUE NOT NULL,name TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'team',plan TEXT NOT NULL DEFAULT 'free',timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',created_at TEXT NOT NULL);
    CREATE TABLE employees (id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,owner_user_id TEXT,name TEXT NOT NULL,runtime TEXT NOT NULL,model_id TEXT,description TEXT NOT NULL DEFAULT '',visibility TEXT NOT NULL DEFAULT 'workspace',skills_json TEXT NOT NULL DEFAULT '[]',instructions TEXT NOT NULL DEFAULT '',runtime_profile TEXT,avatar TEXT,status TEXT NOT NULL DEFAULT 'active',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,persona TEXT NOT NULL DEFAULT '',target_device_id TEXT,management_mcp_enabled INTEGER DEFAULT 0);
    CREATE TABLE employee_phone_mcp (employee_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,revision TEXT NOT NULL,updated_at TEXT NOT NULL);`);
  legacy.prepare('INSERT INTO workspaces(id,slug,name,created_at) VALUES(?,?,?,?)').run('legacy-workspace', 'legacy', '旧工作区', '2026-01-01T00:00:00.000Z');
  const insert = legacy.prepare('INSERT INTO employees(id,workspace_id,name,runtime,created_at,updated_at,management_mcp_enabled) VALUES(?,?,?,?,?,?,?)');
  for (const [id, enabled] of [['false', 0], ['null', null], ['true', 1]]) insert.run(id, 'legacy-workspace', id, 'Codex', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', enabled);
  legacy.prepare('INSERT INTO employee_phone_mcp VALUES(?,?,?,?,?)').run('false', 'legacy-workspace', 0, 'phone-untouched', '2026-01-03T00:00:00.000Z');
  legacy.close();
  let db = openDatabase({ filename });
  for (const row of db.prepare("SELECT * FROM employees WHERE workspace_id='legacy-workspace'").all()) {
    assert.equal(row.management_mcp_enabled, 1);
    assert.equal(row.updated_at, '2026-01-02T00:00:00.000Z');
  }
  const phone = db.prepare("SELECT * FROM employee_phone_mcp WHERE employee_id='false'").get();
  db.prepare("UPDATE employees SET management_mcp_enabled=0,updated_at='migration-repeat-sentinel' WHERE id='false'").run();
  db.close();
  db = openDatabase({ filename });
  assert.equal(db.prepare("SELECT management_mcp_enabled FROM employees WHERE id='false'").get().management_mcp_enabled, 0, 'the migration must not repeat');
  assert.equal(db.prepare("SELECT updated_at FROM employees WHERE id='false'").get().updated_at, 'migration-repeat-sentinel');
  assert.deepEqual(db.prepare("SELECT * FROM employee_phone_mcp WHERE employee_id='false'").get(), phone);
  db.close();
});

test('new execution payloads include management using only the employee workspace', t => {
  const repo = repository(); t.after(() => repo.db.close());
  addWorkspace(repo, 'new-default');
  const employee = repo.createEmployee('new-default', { name: '新员工', managementMcpEnabled: false });
  const conversation = repo.createConversation('new-default', { employeeId: employee.id });
  repo.addConversationMessage(conversation.id, { content: '只读管理状态' });
  const action = repo.listA2AActions('new-default')[0];
  assert.deepEqual(action.payload.managementMcp, { enabled: true, workspace: 'new-default' });
  assert.equal(action.payload.terminalMcp, undefined);
});

test('pending and acked legacy execution actions recover management without mutating stored payloads', t => {
  const repo = repository(); t.after(() => repo.db.close());
  const employee = repo.createEmployee('test-111', { name: '旧员工' });
  const action = repo.createA2AAction('test-111', { type: 'conversation.execute', payload: { employeeId: employee.id, runtime: 'Codex', managementMcp: { enabled: false, workspace: 'other' } } });
  const original = repo.db.prepare('SELECT payload_json FROM a2a_actions WHERE id=?').get(action.id).payload_json;
  assert.deepEqual(repo.listA2AActions('test-111')[0].payload.managementMcp, { enabled: true, workspace: 'test-111' });
  assert.deepEqual(repo.getA2AAction(action.id, { workspaceSlug: 'test-111' }).payload.managementMcp, { enabled: true, workspace: 'test-111' });
  repo.ackA2AAction(action.id);
  assert.deepEqual(repo.listA2AActions('test-111', { includeAcked: true })[0].payload.managementMcp, { enabled: true, workspace: 'test-111' });
  assert.equal(repo.db.prepare('SELECT payload_json FROM a2a_actions WHERE id=?').get(action.id).payload_json, original);
});

test('legacy actions never recover a management request from an employee in another workspace', t => {
  const repo = repository(); t.after(() => repo.db.close());
  addWorkspace(repo, 'outside');
  const outside = repo.createEmployee('outside', { name: '外区员工' });
  const action = repo.createA2AAction('test-111', { type: 'task.execute', payload: { employeeId: outside.id, managementMcp: { enabled: true, workspace: 'outside' } } });
  assert.equal(repo.listA2AActions('test-111')[0].payload.managementMcp, undefined);
  assert.equal(repo.getA2AAction(action.id).payload.managementMcp, undefined);
});

test('completed actions retain historical management configuration and receipt facts', t => {
  const repo = repository(); t.after(() => repo.db.close());
  const employee = repo.createEmployee('test-111', { name: '历史员工' });
  const payload = { employeeId: employee.id, managementMcp: { enabled: false, workspace: 'test-111' } };
  const action = repo.createA2AAction('test-111', { type: 'conversation.execute', payload });
  const result = { managementMcp: { injected: false, loaded: false, toolCalls: [] } };
  repo.resultA2AAction(action.id, { status: 'succeeded', result });
  const historical = repo.getA2AAction(action.id);
  assert.deepEqual(historical.payload, payload);
  assert.deepEqual(historical.result, result);
  assert.deepEqual(repo.listA2AActions('test-111', { status: 'all' })[0].payload, payload);
});

test('management heartbeat persists safe preparation fields and pins its workspace', t => {
  const repo = repository(); t.after(() => repo.db.close());
  const expiresAt = new Date(Date.now() + 3600000).toISOString();
  const device = repo.heartbeatDevice('test-111', { deviceId: 'default-mcp-pc', managementMcp: { configured: true, managed: true, state: 'ready', workspace: 'outside', supportedRuntimes: ['Codex', 'Hermes'], reasonCode: 'BOOTSTRAP_READY', expiresAt, token: 'fixture-private-token', env: { PRIVATE: 'fixture-secret' }, credentialFile: '/private/token.json' } });
  assert.deepEqual(JSON.parse(device.management_mcp_json), { configured: true, managed: true, state: 'ready', workspace: 'test-111', transport: 'stdio', supportedRuntimes: ['Codex', 'Hermes'], reasonCode: 'BOOTSTRAP_READY', expiresAt });
  assert.doesNotMatch(device.management_mcp_json, /fixture-private-token|fixture-secret|private\/token/);
  const invalid = repo.heartbeatDevice('test-111', { deviceId: device.id, managementMcp: { state: 'forged', expiresAt: 'invalid-date' } });
  assert.equal(JSON.parse(invalid.management_mcp_json).state, 'pending');
  assert.equal(JSON.parse(invalid.management_mcp_json).expiresAt, undefined);
});

test('member retry requests target a visible current-workspace device without creating actions', t => {
  const repo = repository(); t.after(() => repo.db.close());
  const device = repo.createDevice('test-111', { name: '成员电脑', ownerUserId: 'other-member' });
  const before = repo.listA2AActions('test-111', { status: 'all' }).length;
  const result = repo.requestManagementMcpRetry('test-111', device.id, { actorRole: 'member', actorUserId: 'requesting-member' });
  assert.equal(result.accepted, true); assert.equal(result.deviceId, device.id); assert.equal(result.state, 'pending');
  assert.equal(new Date(result.retryRequestedAt).toISOString(), result.retryRequestedAt);
  const saved = repo.listDevices('test-111').find(row => row.id === device.id);
  assert.equal(saved.management_mcp_retry_at, result.retryRequestedAt);
  assert.equal(JSON.parse(saved.management_mcp_json).state, 'pending');
  assert.equal(repo.heartbeatDevice('test-111', { deviceId: device.id }).management_mcp_retry_at, result.retryRequestedAt);
  assert.equal(repo.listA2AActions('test-111', { status: 'all' }).length, before);
  const again = repo.requestManagementMcpRetry('test-111', device.id, { actorRole: 'member', actorUserId: 'requesting-member' });
  assert.ok(Date.parse(again.retryRequestedAt) > Date.parse(result.retryRequestedAt), 'each retry must be observable even within one millisecond');
});

test('retry rejects cross-workspace, hidden personal, disabled and unauthorized targets', t => {
  const repo = repository(); t.after(() => repo.db.close());
  addWorkspace(repo, 'personal-default', 'personal');
  const personal = repo.createDevice('personal-default', { name: '个人电脑', ownerUserId: 'owner-user' });
  const member = { actorRole: 'member', actorUserId: 'other-user' };
  assert.throws(() => repo.requestManagementMcpRetry('test-111', personal.id, member), error => error.status === 404);
  assert.throws(() => repo.requestManagementMcpRetry('personal-default', personal.id, member), error => error.status === 404);
  assert.throws(() => repo.requestManagementMcpRetry('personal-default', personal.id, {}), error => error.status === 403);
  repo.db.prepare("UPDATE devices SET status='disabled' WHERE id=?").run(personal.id);
  assert.throws(() => repo.requestManagementMcpRetry('personal-default', personal.id, { actorRole: 'owner', actorUserId: 'owner-user' }), error => error.status === 409);
  assert.equal(repo.db.prepare('SELECT management_mcp_retry_at FROM devices WHERE id=?').get(personal.id).management_mcp_retry_at, null);
});

test('production management signing identity cannot be derived from a legacy A2A bearer', t => {
  const repo = repository(); t.after(() => repo.db.close());
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-management-signing-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const previous = process.env.ZIWEI_A2A_TOKEN;
  const legacyToken = 'isolated-test-legacy-a2a-token';
  process.env.ZIWEI_A2A_TOKEN = legacyToken;
  try {
    const pair = repo.createDevicePairing('test-111', { name: '独立签名测试' });
    const device = repo.claimDevicePairing({ code: pair.code });
    const identity = repo.authenticateDeviceToken(device.deviceToken);
    const service = createManagementBootstrap(repo, { managementMcpSecretFile: path.join(directory, 'management-signing.key') });
    const issued = service.bootstrap('test-111', identity);
    const payload = { audience: issued.audience, workspace: issued.workspace, deviceId: issued.deviceId, credentialId: issued.credentialId, expiresAt: issued.expiresAt };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const legacyDerivedKey = crypto.createHash('sha256').update(legacyToken).update('ziwei-management-capability-v1').digest();
    const forged = `zmcp1.${body}.${crypto.createHmac('sha256', legacyDerivedKey).update('zmcp1.' + body).digest('base64url')}`;
    assert.throws(() => service.authorize(forged, 'test-111'), error => error.status === 401);
  } finally {
    if (previous === undefined) delete process.env.ZIWEI_A2A_TOKEN;
    else process.env.ZIWEI_A2A_TOKEN = previous;
  }
});
