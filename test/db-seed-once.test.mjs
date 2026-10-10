import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../backend/db.mjs';

const seedMarker = '2026-10-10-initial-seed-once';
const workspaceSchema = `CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,slug TEXT UNIQUE NOT NULL,name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'personal',plan TEXT NOT NULL DEFAULT 'free',
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',created_at TEXT NOT NULL
)`;
function fixture() {
  // Keep the isolated fixture for inspection; never remove user/runtime files.
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-seed-once-')), 'fixture.sqlite');
}
const count = (db, table) => db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total;

test('a fresh database initializes demo data once, and clearing all workspaces does not recreate it', () => {
  const filename = fixture();
  let db = openDatabase({ filename });
  assert.equal(count(db, 'workspaces'), 1);
  assert.equal(count(db, 'members'), 1);
  assert.equal(count(db, 'devices'), 1);
  assert.equal(count(db, 'runtimes'), 4);
  assert.equal(count(db, 'skills'), 6);
  const applied = db.prepare('SELECT applied_at FROM schema_migrations WHERE version=?').get(seedMarker);
  assert.ok(applied, 'a durable marker must exist before cleanup');
  db.exec('DELETE FROM workspaces');
  db.close();
  for (let attempt = 0; attempt < 2; attempt++) {
    db = openDatabase({ filename });
    for (const table of ['workspaces', 'members', 'devices', 'runtimes', 'skills']) {
      assert.equal(count(db, table), 0, `${table} must remain empty on restart`);
    }
    assert.deepEqual(db.prepare('SELECT applied_at FROM schema_migrations WHERE version=?').get(seedMarker), applied);
    db.close();
  }
});

test('a historical empty installation without the marker is not mistaken for a fresh database', () => {
  const filename = fixture();
  const historical = new DatabaseSync(filename);
  historical.exec(workspaceSchema);
  historical.close();
  for (let attempt = 0; attempt < 2; attempt++) {
    const db = openDatabase({ filename });
    assert.equal(count(db, 'workspaces'), 0);
    assert.equal(count(db, 'devices'), 0);
    assert.equal(count(db, 'skills'), 0);
    assert.ok(db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(seedMarker));
    db.close();
  }
});

test('legacy audit notifications backfill once and stay cleared even while audit history remains', () => {
  const filename = fixture();
  const historical = new DatabaseSync(filename);
  historical.exec(`${workspaceSchema}; CREATE TABLE audit_events (
    id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,actor TEXT NOT NULL,
    action TEXT NOT NULL,payload_json TEXT NOT NULL,created_at TEXT NOT NULL
  )`);
  historical.prepare('INSERT INTO workspaces(id,slug,name,created_at) VALUES(?,?,?,?)')
    .run('ws-real', 'real', 'Real workspace', '2026-01-01T00:00:00.000Z');
  historical.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?,?)')
    .run('legacy-event', 'ws-real', 'user', 'historical.event', '{}', '2026-01-01T00:00:00.000Z');
  historical.close();
  let db = openDatabase({ filename });
  assert.equal(count(db, 'workspaces'), 1, 'existing installations must not add the example workspace');
  assert.equal(count(db, 'members'), 0);
  assert.equal(count(db, 'devices'), 0);
  assert.equal(count(db, 'skills'), 0);
  assert.equal(count(db, 'notifications'), 1, 'the legacy inbox migration still runs once');
  const applied = db.prepare('SELECT applied_at FROM schema_migrations WHERE version=?').get(seedMarker);
  db.exec('DELETE FROM notifications');
  db.close();
  db = openDatabase({ filename });
  assert.equal(count(db, 'notifications'), 0, 'deleted notifications must not be rehydrated from audits');
  assert.equal(count(db, 'audit_events'), 1, 'the seed must not delete audit records');
  assert.deepEqual(db.prepare('SELECT applied_at FROM schema_migrations WHERE version=?').get(seedMarker), applied);
  db.close();
});

test('upgrading an existing installation preserves phone configuration and real device identities', () => {
  const filename = fixture();
  let db = openDatabase({ filename });
  db.prepare('INSERT INTO workspaces(id,slug,name,kind,created_at) VALUES(?,?,?,?,?)')
    .run('ws-phone', 'phone', 'Phone workspace', 'team', '2026-01-01T00:00:00.000Z');
  db.prepare('INSERT INTO devices(id,workspace_id,owner_user_id,name,os,status,created_at) VALUES(?,?,?,?,?,?,?)')
    .run('real-computer', 'ws-phone', 'real-owner', 'Real computer', 'Windows', 'offline', '2026-01-01T00:00:00.000Z');
  db.prepare('INSERT INTO employees(id,workspace_id,owner_user_id,name,runtime,runtime_profile,target_device_id,skills_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run('phone-employee', 'ws-phone', 'real-owner', 'Phone employee', 'Hermes', 'phone-profile', 'real-computer', '["saved-phone-skill"]', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
  db.prepare('INSERT INTO employee_phone_mcp VALUES(?,?,?,?,?)')
    .run('phone-employee', 'ws-phone', 1, 'saved-phone-revision', '2026-01-02T00:00:00.000Z');
  db.prepare('DELETE FROM schema_migrations WHERE version=?').run(seedMarker);
  db.prepare("DELETE FROM workspaces WHERE id='ws-test-111'").run();
  const before = {
    device: db.prepare("SELECT * FROM devices WHERE id='real-computer'").get(),
    employee: db.prepare("SELECT * FROM employees WHERE id='phone-employee'").get(),
    phone: db.prepare("SELECT * FROM employee_phone_mcp WHERE employee_id='phone-employee'").get(),
  };
  db.close();
  db = openDatabase({ filename });
  assert.equal(count(db, 'workspaces'), 1);
  assert.equal(count(db, 'members'), 0);
  assert.equal(count(db, 'devices'), 1);
  assert.deepEqual(db.prepare("SELECT * FROM devices WHERE id='real-computer'").get(), before.device);
  assert.deepEqual(db.prepare("SELECT * FROM employees WHERE id='phone-employee'").get(), before.employee);
  assert.deepEqual(db.prepare("SELECT * FROM employee_phone_mcp WHERE employee_id='phone-employee'").get(), before.phone);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  db.close();
});
