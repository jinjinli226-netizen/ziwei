import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {DatabaseSync,backup} from 'node:sqlite';
import test from 'node:test';
import {cleanupManifestSchema, validateCleanupManifest, fingerprintCleanupManifest} from '../backend/identity-cleanup/vendor/cleanup-manifest.mjs';

const source = new URL('../backend/identity-cleanup/probe.mjs', import.meta.url);
const fixtureModule = new URL('../backend/identity-cleanup/fixtures.mjs', import.meta.url);
const manifestModule = new URL('../backend/identity-cleanup/manifest.mjs', import.meta.url);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

test('native cleanup probe implementation exists', () => assert.ok(fs.existsSync(source)));
test('shared schema and validator are vendored without divergence', () => {
  const directory = fileURLToPath(new URL('../backend/identity-cleanup/vendor/', import.meta.url));
  const provenance = JSON.parse(fs.readFileSync(path.join(directory, 'provenance.json'), 'utf8'));
  for (const entry of provenance.sources) assert.equal(hash(fs.readFileSync(path.join(directory, entry.file))), entry.sha256);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'cleanup-manifest.schema.json'), 'utf8')), cleanupManifestSchema);
});

async function fixture(t, options) {
  const helpers = await import(fixtureModule);
  const result = helpers.createSyntheticFixture(options);
  t.after(() => helpers.disposeSyntheticFixture(result));
  return {...helpers, fixture:result};
}

test('readonly projection covers schema/FKs/ownership and never selects credential or business bodies', async t => {
  const f = await fixture(t);
  const {probeWorkspaceSource} = await import(source);
  const before = hash(fs.readFileSync(f.fixture.databasePath));
  const result = probeWorkspaceSource({databasePath:f.fixture.databasePath});
  assert.equal(hash(fs.readFileSync(f.fixture.databasePath)), before);
  assert.equal(result.readOnly, true);
  assert.equal(result.queryOnly, true);
  assert.equal(result.transaction, 'consistent-read-transaction');
  assert.equal(result.provenance.authority, 'unverified-local-candidate');
  assert.equal(result.administrator.loginAccountRefs.length, 1);
  assert.ok(result.tables.every(table => ['enumerated','unresolved','infrastructure'].includes(table.coverage)));
  const serialized = JSON.stringify(result);
  for (const sentinel of ['SYNTHETIC_PASSWORD_MATERIAL','SYNTHETIC_COOKIE_MATERIAL','SYNTHETIC_DEVICE_MATERIAL','SYNTHETIC_BUSINESS_BODY']) assert.ok(!serialized.includes(sentinel));
  for (const table of result.tables) for (const column of table.selectedColumns) assert.ok(!/password|hash|token|secret|content|cipher|cookie/i.test(column));
  assert.ok(result.relationships.some(relation => relation.kind === 'foreign-key' && relation.onDelete === 'CASCADE'));
  assert.ok(result.resources.some(row => row.table === 'devices' && row.ref.kind === 'device-pairing'));
  assert.ok(result.resources.some(row => row.table === 'platform_accounts' && row.ref.kind === 'platform-account'));
});

test('actual non-authoritative candidates cannot create deletion plans or self-assert trusted baselines', async t => {
  const f = await fixture(t);
  const {probeWorkspaceSource} = await import(source);
  const {prepareCleanupManifest} = await import(manifestModule);
  const probe = probeWorkspaceSource({databasePath:f.fixture.databasePath});
  const result = prepareCleanupManifest(probe);
  assert.equal(result.status, 'pending_source_baseline');
  assert.equal(result.proposedManifest.dryRun, true);
  assert.equal(result.proposedManifest.items.filter(row => row.decision === 'delete').length, 0);
  assert.ok(result.blockers.includes('independent-source-baseline-not-verified'));
  assert.equal(result.validation.status, 'errors');
  assert.ok(!Object.hasOwn(result.proposedManifest.backup, 'artifactFingerprint'));
  assert.equal(result.centralIdentityOperations.length, 0);
});

test('same-email conflicts are protected as separate IDs and remain pending without merge', async t => {
  const f = await fixture(t, {emailConflict:true});
  const {probeWorkspaceSource} = await import(source);
  const result = probeWorkspaceSource({databasePath:f.fixture.databasePath});
  assert.equal(result.administrator.accountResolution, 'pending');
  assert.equal(result.administrator.loginAccountRefs.length, 2);
  assert.equal(new Set(result.administrator.loginAccountRefs.map(row => row.id)).size, 2);
  assert.ok(result.blockers.includes('protected-email-conflict'));
});

test('seed without a login table and unclassified tables stay concretely incomplete', async t => {
  const f = await fixture(t, {seed:true, unknown:true});
  const {probeWorkspaceSource} = await import(source);
  const result = probeWorkspaceSource({databasePath:f.fixture.databasePath});
  assert.equal(result.administrator.accountResolution, 'pending');
  assert.ok(result.blockers.includes('local-login-table-missing'));
  assert.equal(result.complete, false);
  assert.ok(result.tables.some(table => table.name === 'future_unknown' && table.coverage === 'unresolved'));
});

test('fingerprint changes when an ownership edge changes although stable IDs stay the same', async t => {
  const f = await fixture(t);
  const {probeWorkspaceSource} = await import(source);
  const before = probeWorkspaceSource({databasePath:f.fixture.databasePath});
  const db = new DatabaseSync(f.fixture.databasePath);
  try {db.prepare("UPDATE documents SET owner_user_id='other' WHERE id='owned-admin'").run();} finally {db.close();}
  const after = probeWorkspaceSource({databasePath:f.fixture.databasePath});
  assert.equal(before.inventoryFingerprint, after.inventoryFingerprint);
  assert.notEqual(before.sourceFingerprint, after.sourceFingerprint);
});

test('shared, global, unowned and mixed resources never turn into delete or administrator assets', async t => {
  const f = await fixture(t);
  const result = await f.snapshotSyntheticFixture(f.fixture);
  const byId = new Map(result.preparation.proposedManifest.items.map(row => [row.resource.id, row]));
  for (const id of ['mixed-document','global-skill','unowned-document','shared-workspace']) assert.equal(byId.get(id).decision, 'pending', id);
  assert.equal(byId.get('owned-admin').decision, 'preserve');
  assert.equal(byId.get('owned-other').decision, 'delete');
  assert.equal(result.preparation.centralIdentityOperations.length, 0);
});

test('cascade across retained/mixed boundary prevents deletion rather than broadening its set', async t => {
  const f = await fixture(t, {crossCascade:true});
  const result = await f.snapshotSyntheticFixture(f.fixture);
  assert.equal(result.preparation.proposedManifest.items.find(row => row.resource.id === 'other').decision, 'pending');
  assert.ok(result.preparation.blockers.some(value => value.includes('retained-dependency')));
});

test('object storage is counted without reading keys/bytes and remains pending', async t => {
  const f = await fixture(t, {objectStorage:true});
  const {probeWorkspaceSource} = await import(source);
  const result = probeWorkspaceSource({databasePath:f.fixture.databasePath});
  assert.equal(result.objectStorage.referenceCount, 1);
  assert.equal(result.objectStorage.status, 'pending-not-enumerated');
  assert.ok(!JSON.stringify(result).includes('SYNTHETIC_OBJECT_KEY'));
});

test('snapshot uses SQLite backup, isolated restore preserves business/IDs/pairings but disables old auth', async t => {
  const f = await fixture(t);
  const snapshot = await f.snapshotSyntheticFixture(f.fixture);
  const restored = await f.restoreSyntheticFixture(f.fixture, snapshot);
  assert.equal(snapshot.backup.method, 'node:sqlite.backup');
  assert.equal(snapshot.backup.status, 'verified');
  assert.equal(restored.restore.status, 'verified');
  assert.equal(restored.restore.administratorPreserved, true);
  assert.equal(restored.pairingIdsPreserved, true);
  assert.equal(restored.pairingStatesPreserved, true);
  assert.equal(restored.operationalCredentialPolicy, 'snapshot-state-only; latest revocation ledger required before any live use');
  assert.equal(restored.legacyCredentialsInactive, true);
  assert.equal(restored.businessBodyPreserved, true);
  assert.equal(restored.restore.verifiedInventoryFingerprint, snapshot.probe.inventoryFingerprint);
  assert.equal(restored.centralSubjectOperations, 0);
  assert.equal(restored.validation.status, 'pending');
  assert.ok(restored.validation.pending.some(row => row.code === 'SOURCE_BASELINE_REQUIRED'));
  assert.ok(restored.validation.pending.some(row => row.code === 'REVIEW_ANCHOR_REQUIRED'));
});

test('isolated restore keeps valid operational pairing and never revives a revoked credential or consumed code', async t => {
  const f=await fixture(t);
  const writer=new DatabaseSync(f.fixture.databasePath);
  try {writer.exec("INSERT INTO device_credentials VALUES('revoked-credential','paired-device','shared-workspace','SYNTHETIC_REVOKED_MATERIAL','2026-01-01'); INSERT INTO device_pairing_codes VALUES('consumed-code','shared-workspace','SYNTHETIC_CONSUMED_MATERIAL','2026-01-01','2025-12-31')");} finally {writer.close();}
  const snapshot=await f.snapshotSyntheticFixture(f.fixture);
  const restored=await f.restoreSyntheticFixture(f.fixture,snapshot);
  const check=new DatabaseSync(restored.restoredPath,{readOnly:true});
  try {
    assert.equal(check.prepare("SELECT revoked_at FROM device_credentials WHERE id='paired-credential'").get().revoked_at,null);
    assert.equal(check.prepare("SELECT revoked_at FROM device_credentials WHERE id='revoked-credential'").get().revoked_at,'2026-01-01');
    assert.equal(check.prepare("SELECT consumed_at FROM device_pairing_codes WHERE id='pairing-record'").get().consumed_at,null);
    assert.equal(check.prepare("SELECT consumed_at FROM device_pairing_codes WHERE id='consumed-code'").get().consumed_at,'2025-12-31');
    assert.equal(check.prepare("SELECT token_hash FROM device_credentials WHERE id='paired-credential'").get().token_hash,'SYNTHETIC_DEVICE_MATERIAL');
  } finally {check.close();}
});

test('body-only change keeps metadata digest but changes full snapshot fingerprint and rejects the old proposal baseline', async t => {
  const f=await fixture(t);
  const {probeWorkspaceSource}=await import(source);
  const first=await f.snapshotSyntheticFixture(f.fixture);
  const before=probeWorkspaceSource({databasePath:f.fixture.databasePath});
  const writer=new DatabaseSync(f.fixture.databasePath);
  try {writer.exec("UPDATE documents SET content='SYNTHETIC_CHANGED_BODY' WHERE id='owned-admin'");}finally{writer.close();}
  const after=probeWorkspaceSource({databasePath:f.fixture.databasePath});
  assert.equal(after.metadataInventoryFingerprint,before.metadataInventoryFingerprint);
  assert.equal(after.sourceFingerprintComplete,false);
  const {fingerprintConsistentSnapshot}=await import('../backend/identity-cleanup/snapshot-fingerprint.mjs');
  const secondArtifact=path.join(f.fixture.directory,'second.snapshot.sqlite');
  const reader=new DatabaseSync(f.fixture.databasePath,{readOnly:true});
  try {reader.exec('PRAGMA query_only=ON; BEGIN');await backup(reader,secondArtifact);reader.exec('ROLLBACK');}finally{reader.close();}
  const different=fingerprintConsistentSnapshot({databaseArtifactFingerprint:hash(fs.readFileSync(secondArtifact)),objectReferenceFingerprint:hash('[]'),objectContentFingerprint:hash('[]')});
  assert.notEqual(first.probe.sourceFingerprint,different);
  const restored=await f.restoreSyntheticFixture(f.fixture,first);
  const manifest=restored.proposedManifest;
  const context={sourceBaseline:{serviceId:'workspace',sourceVersion:manifest.service.sourceVersion,sourceFingerprint:different,inventoryFingerprint:manifest.service.inventoryFingerprint,probe:{kind:'native-read-only',evidenceRef:'independent-snapshot-review'}}};
  assert.ok(validateCleanupManifest(manifest,context).errors.some(row=>row.code==='SOURCE_BASELINE_MISMATCH'));
});

test('guard refuses real paths, fabricated fixture contexts and changed backup artifacts', async t => {
  const f = await fixture(t);
  await assert.rejects(f.snapshotSyntheticFixture({databasePath:f.fixture.databasePath}), /synthetic fixture/i);
  const snapshot = await f.snapshotSyntheticFixture(f.fixture);
  fs.appendFileSync(snapshot.artifactPath, 'changed');
  await assert.rejects(f.restoreSyntheticFixture(f.fixture, snapshot), /fingerprint/i);
});

test('shared validator rejects a modified ownership baseline and central collaboration is never targeted', async t => {
  const f = await fixture(t);
  const snapshot = await f.snapshotSyntheticFixture(f.fixture);
  const restored = await f.restoreSyntheticFixture(f.fixture, snapshot);
  const manifest = restored.proposedManifest;
  const context = {sourceBaseline:{serviceId:'workspace',sourceVersion:manifest.service.sourceVersion,sourceFingerprint:'f'.repeat(64),inventoryFingerprint:manifest.service.inventoryFingerprint,probe:{kind:'native-read-only',evidenceRef:'independent-fixture-review'}},reviewedBatchDigest:fingerprintCleanupManifest(manifest)};
  assert.ok(validateCleanupManifest(manifest, context).errors.some(row => row.code === 'SOURCE_BASELINE_MISMATCH'));
  assert.deepEqual(restored.centralIdentityOperations, []);
});

test('SQLite backup includes committed WAL rows without copying only the main database file', async t => {
  const f = await fixture(t);
  const writer = new DatabaseSync(f.fixture.databasePath);
  try {
    writer.exec("PRAGMA journal_mode=WAL; INSERT INTO documents VALUES('wal-row',NULL,NULL,NULL,'SYNTHETIC_WAL_BODY',NULL)");
    assert.ok(fs.existsSync(f.fixture.databasePath+'-wal'));
    const snapshot=await f.snapshotSyntheticFixture(f.fixture);
    const restored=await f.restoreSyntheticFixture(f.fixture,snapshot);
    assert.equal(restored.businessBodyPreserved,true);
    const check=new DatabaseSync(restored.restoredPath,{readOnly:true});
    try{assert.equal(check.prepare("SELECT count(*) AS n FROM documents WHERE id='wal-row'").get().n,1);}finally{check.close();}
  } finally {writer.close();}
});

test('unknown token-like primary keys are schema/count-only and never read as stable IDs', async t => {
  const f = await fixture(t);
  const db=new DatabaseSync(f.fixture.databasePath);
  try{db.exec("CREATE TABLE future_sessions(id TEXT PRIMARY KEY,tokens TEXT); INSERT INTO future_sessions VALUES('SYNTHETIC_COOKIE_MATERIAL','SYNTHETIC_PASSWORD_MATERIAL')");}finally{db.close();}
  const {probeWorkspaceSource}=await import(source);
  const probe=probeWorkspaceSource({databasePath:f.fixture.databasePath});
  assert.deepEqual(probe.tables.find(table=>table.name==='future_sessions').selectedColumns,[]);
  assert.equal(probe.complete,false);
  assert.ok(!JSON.stringify(probe).includes('SYNTHETIC_COOKIE_MATERIAL'));
  await assert.rejects(f.snapshotSyntheticFixture(f.fixture),/unreviewed synthetic fixture schema/i);
});
