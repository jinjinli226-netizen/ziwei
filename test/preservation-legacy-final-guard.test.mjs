import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createPreservation, digest, FROZEN_VERSIONS} from '../backend/version-preservation.mjs';
import {nativeActionDigest} from '../backend/preservation-native-databases.mjs';

const kind = 'legacy-never-dispatched-v1', operationId = 'isolated-legacy-seal';
const sha = value => createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const refusal = error => ['ROLLBACK_NOT_DRAINED', 'ROLLBACK_EVIDENCE_CHANGED'].includes(error.code);

function fixture(t, {rowPatch = {}, withPolicy = true, policyPatch = {}, proofPatch = {}} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-legacy-final-'));
  const db = new DatabaseSync(':memory:');
  t.after(() => {db.close(); assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert(path.basename(root).startsWith('ziwei-legacy-final-')); fs.rmSync(root, {recursive: true, force: true});});
  db.exec(`CREATE TABLE a2a_actions (
    id TEXT PRIMARY KEY,workspace_id TEXT,type TEXT,agent_id TEXT,task_id TEXT,
    payload_json TEXT,result_json TEXT,status TEXT,dedupe_key TEXT,created_at TEXT,
    acked_at TEXT,completed_at TEXT,expires_at TEXT,error TEXT
  ); CREATE TABLE action_mutations(operation TEXT);`);
  const original = {id: 'approved-old-action', workspace_id: 'fixture-workspace', type: 'runtime.execute', agent_id: 'ziwei_user', task_id: null,
    payload_json: '{"deviceId":"fixture-device", "runtime":"Hermes", "prompt":"original fixture"}', result_json: '', status: 'expired', dedupe_key: 'original-dedupe',
    created_at: '2026-01-01T00:00:00.000Z', acked_at: '2026-01-01T00:00:01.000Z', completed_at: '2026-01-01T00:00:02.000Z', expires_at: '2026-01-01T00:00:02.000Z', error: 'original expiry', ...rowPatch};
  db.prepare(`INSERT INTO a2a_actions (${Object.keys(original).join(',')}) VALUES (${Object.keys(original).map(() => '?').join(',')})`).run(...Object.values(original));
  for (const event of ['INSERT', 'UPDATE', 'DELETE']) db.exec(`CREATE TRIGGER test_action_${event.toLowerCase()} AFTER ${event} ON a2a_actions BEGIN INSERT INTO action_mutations VALUES('${event}'); END`);
  const row = () => db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(original.id);
  const files = ['archive.bin', 'logger.jsonl'].map(name => {
    const file = path.join(root, name), bytes = Buffer.from(`immutable fixture ${name}`); fs.writeFileSync(file, bytes);
    const stat = fs.lstatSync(file, {bigint: true});
    return {path: file, exists: true, sha256: sha(bytes), bytes: bytes.length, identity: {dev: String(stat.dev), ino: String(stat.ino)}};
  });
  const policy = {actionId: original.id, actionDigest: nativeActionDigest(row()), hostId: 'fixture-host', workspaceId: original.workspace_id, deviceId: 'fixture-device', origin: 'http://127.0.0.1:6387',
    specHash: sha('spec'), authorizationDigest: sha('authorization'), historicalGenerationDigest: sha('generation'), policyDigest: sha('protocol'), sourceDigest: sha('source'), cacheDigest: sha('cache'), loggerDigest: sha('logger'),
    requiredFiles: files.map(({path, sha256}) => ({path, sha256})), ...policyPatch};
  const {requiredFiles, ...pins} = policy;
  const proof = {schemaVersion: 1, kind, ...pins, operationId, verified: true, conclusion: 'never-dispatched', ...proofPatch};
  const trusted = new WeakMap([[proof, kind]]), calls = [], native = {safe: true, issues: [], files, directories: [], nativeDatabases: [], nativeStateProofs: [proof], gatewayInboxProofs: [], actionBindings: [{id: original.id, digest: nativeActionDigest(row())}]};
  const f = {root, db, row, original, files, policy, proof, trusted, calls, native, collectorCalls: 0, afterCollect: null, beforeSeal: null};
  f.guard = createPreservation(db, {
    ...(withPolicy ? {legacyActionPolicy: policy} : {}),
    collectNativeEvidence: () => {
      f.collectorCalls++;
      const freeze = db.prepare('SELECT * FROM version_preservation WHERE singleton=1').get();
      f.afterCollect?.();
      return {...native, operationId, intentDigest: digest(freeze.intent_json), versionsDigest: digest(freeze.versions_json)};
    },
    verifySourceRecord: ({kind: requestedKind, record}) => {
      assert.equal(db.isTransaction, true); calls.push({kind: requestedKind, record});
      return trusted.get(record) === requestedKind ? true : undefined;
    },
    beforeCommit: ({command}) => {assert.equal(db.isTransaction, true); if (command === 'seal') f.beforeSeal?.();},
  });
  f.guard.begin({operationId, versions: FROZEN_VERSIONS});
  return f;
}

async function refused(f, extra = {}) {
  const before = clone(f.db.prepare('SELECT * FROM a2a_actions ORDER BY id').all());
  await assert.rejects(f.guard.seal({operationId, ...extra}), refusal);
  assert.equal(f.guard.inspect().state, 'preparing');
  assert.deepEqual(clone(f.db.prepare('SELECT * FROM a2a_actions ORDER BY id').all()), before);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM version_preservation_events WHERE event='sealed'").get().n, 0);
}

test('trusted unique legacy proof seals without changing or replaying the original V1 action', async t => {
  const f = fixture(t), before = clone(f.row());
  assert.equal(f.guard.classifyAction(f.row()).isV2, false);
  assert.equal(Object.hasOwn(f.proof, 'challenge'), false, 'source strips the inner challenge before final seal');
  let finalChecks = 0; f.beforeSeal = () => {finalChecks++; assert.deepEqual(clone(f.row()), before);};
  assert.equal((await f.guard.seal({operationId})).state, 'sealed');
  assert.deepEqual(clone(f.row()), before);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM action_mutations').get().n, 0);
  assert.equal(f.guard.classifyAction(f.row()).isV2, false);
  assert.equal(f.calls.filter(call => call.kind === kind && call.record === f.proof).length, 1);
  assert.deepEqual(f.calls.filter(call => call.kind === 'file').map(call => call.record), f.files, 'pinned files still traverse the original final file checker');
  const retained = JSON.parse(f.db.prepare('SELECT evidence_json FROM version_preservation').get().evidence_json);
  assert.deepEqual(retained.actionBindings, f.native.actionBindings);
  assert.deepEqual(retained.nativeStateProofs, [f.proof]);
  assert.equal(JSON.stringify(retained).includes('processExit'), false);
  assert.equal((await f.guard.seal({operationId})).state, 'sealed');
  assert.equal(f.collectorCalls, 1); assert.equal(finalChecks, 1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM action_mutations').get().n, 0);
});

for (const [name, change] of [
  ['missing proof', f => {f.native.nativeStateProofs = [];}],
  ['duplicate proof reference', f => {f.native.nativeStateProofs.push(f.proof);}],
  ['registered second subject', f => {const proof = {...f.proof, actionId: 'another-action'}; f.trusted.set(proof, kind); f.native.nativeStateProofs.push(proof);}],
  ['JSON clone of trusted proof', f => {f.native.nativeStateProofs = [clone(f.proof)];}],
  ['JSON flags without registration', f => {f.trusted.delete(f.proof); Object.assign(f.proof, {trusted: true, approved: true});}],
  ['wrong source-record kind', f => {f.trusted.set(f.proof, 'file');}],
  ['wrong proof kind', f => {f.proof.kind = 'legacy-terminal-history-v1';}],
  ['wrong host', f => {f.proof.hostId = 'other-host';}],
  ['wrong workspace', f => {f.proof.workspaceId = 'other-workspace';}],
  ['wrong device', f => {f.proof.deviceId = 'other-device';}],
  ['wrong origin', f => {f.proof.origin = 'http://127.0.0.1:9999';}],
  ['wrong operation', f => {f.proof.operationId = 'other-operation';}],
  ['wrong spec', f => {f.proof.specHash = sha('other-spec');}],
  ['unverified conclusion', f => {f.proof.verified = false;}],
  ['wrong conclusion', f => {f.proof.conclusion = 'terminal-history-retained';}],
  ['missing original action binding', f => {f.native.actionBindings = [];}],
  ['duplicate original action binding', f => {f.native.actionBindings.push({...f.native.actionBindings[0]});}],
  ['missing pinned file', f => {f.native.files = f.files.slice(1);}],
  ['duplicate pinned file', f => {f.native.files = [...f.files, {...f.files[0]}];}],
  ['wrong file digest', f => {f.files[0].sha256 = sha('wrong');}],
  ['absent pinned file', f => {f.files[0].exists = false;}],
]) test(`final legacy predicate rejects ${name}`, async t => {const f = fixture(t); change(f); await refused(f);});

for (const field of ['actionDigest', 'authorizationDigest', 'historicalGenerationDigest', 'policyDigest', 'sourceDigest', 'cacheDigest', 'loggerDigest']) {
  test(`final legacy predicate binds ${field}`, async t => {const f = fixture(t); f.proof[field] = sha(`changed-${field}`); await refused(f);});
}

test('a special proof without independent constructor policy refuses even when registered', async t => {const f = fixture(t, {withPolicy: false}); await refused(f, {legacyActionPolicy: f.policy});});
for (const [name, rowPatch] of [
  ['pending', {status: 'pending'}], ['acked', {status: 'acked'}], ['no ACK', {acked_at: null}],
  ['null result', {result_json: null}], ['JSON null result', {result_json: 'null'}], ['whitespace result', {result_json: ' '}],
  ['explicit uncertain result', {result_json: '{"code":"EXECUTION_UNCERTAIN"}'}],
  ['V2 action', {type: 'hermes.bot.native'}],
  ['conflicting device alias', {payload_json: '{"deviceId":"fixture-device","device_id":"other-device"}'}],
]) test(`even a newly pinned ${name} row cannot qualify`, async t => {await refused(fixture(t, {rowPatch}));});

test('missing original SELECT row cannot be replaced by native proof JSON', async t => {
  const f = fixture(t); f.db.prepare('DELETE FROM a2a_actions WHERE id=?').run(f.original.id); await refused(f);
});
test('changed raw JSON formatting refuses even when semantic payload and fresh action binding agree', async t => {
  const f = fixture(t), semantic = JSON.parse(f.row().payload_json);
  f.db.prepare('UPDATE a2a_actions SET payload_json=? WHERE id=?').run(JSON.stringify(semantic), f.original.id);
  assert.deepEqual(JSON.parse(f.row().payload_json), semantic);
  f.native.actionBindings[0].digest = nativeActionDigest(f.row()); await refused(f);
});
test('file bytes changed after collection still fail the existing final file check', async t => {
  const f = fixture(t); fs.writeFileSync(f.files[0].path, 'changed after trusted collection'); await refused(f);
});
test('original beforeCommit projection hook retains its atomic veto', async t => {
  const f = fixture(t); f.db.exec('CREATE TABLE fixture_private(value TEXT)');
  f.beforeSeal = () => {f.db.exec("INSERT INTO fixture_private VALUES('must rollback')"); throw Object.assign(Error('projection changed'), {code: 'PRODUCTION_PROJECTION_CHANGED'});};
  await assert.rejects(f.guard.seal({operationId}), {code: 'PRODUCTION_PROJECTION_CHANGED'});
  assert.equal(f.guard.inspect().state, 'preparing'); assert.equal(f.db.prepare('SELECT COUNT(*) n FROM fixture_private').get().n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM action_mutations').get().n, 0);
});
test('constructor policy is copied so later caller mutation cannot relax final pins', async t => {
  const f = fixture(t); f.policy.hostId = f.proof.hostId = 'later-host'; f.policy.requiredFiles.length = 0; await refused(f);
});
test('nested required-file pins are copied independently of the caller', async t => {
  const f = fixture(t), replacement = 'caller attempted to replace its pinned archive';
  fs.writeFileSync(f.files[0].path, replacement);
  f.policy.requiredFiles[0].sha256 = f.files[0].sha256 = sha(replacement);
  await refused(f);
});
test('final transaction rereads the original row after asynchronous collection', async t => {
  const f = fixture(t);
  f.afterCollect = () => {
    f.db.prepare('UPDATE a2a_actions SET error=? WHERE id=?').run('changed during collection', f.original.id);
    f.native.actionBindings[0].digest = nativeActionDigest(f.row());
  };
  await assert.rejects(f.guard.seal({operationId}), refusal);
  assert.equal(f.guard.inspect().state, 'preparing');
  assert.equal(f.row().error, 'changed during collection');
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM version_preservation_events WHERE event='sealed'").get().n, 0);
});
test('legacy device fallback requires the original employee in the same workspace', async t => {
  const f = fixture(t, {rowPatch: {payload_json: '{"employeeId":"ordinary-employee","runtime":"Hermes"}'}});
  f.db.exec('CREATE TABLE employees(id TEXT PRIMARY KEY,workspace_id TEXT,target_device_id TEXT,name TEXT)');
  f.db.prepare('INSERT INTO employees VALUES(?,?,?,?)').run('ordinary-employee', 'fixture-workspace', 'fixture-device', 'Ordinary V1');
  assert.equal((await f.guard.seal({operationId})).state, 'sealed');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM action_mutations').get().n, 0);
});
test('a pinned row with unknown source device does not qualify', async t => {
  await refused(fixture(t, {rowPatch: {payload_json: '{"runtime":"Hermes"}'}}));
});
test('malformed policy refuses before schema creation', () => {
  for (const policy of [{}, {actionId: 'one'}, [], 'wire-selected']) {
    const db = new DatabaseSync(':memory:');
    try {assert.throws(() => createPreservation(db, {legacyActionPolicy: policy}), {code: 'ROLLBACK_LEGACY_POLICY_INVALID'}); assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='version_preservation'").get().n, 0);}
    finally {db.close();}
  }
});
