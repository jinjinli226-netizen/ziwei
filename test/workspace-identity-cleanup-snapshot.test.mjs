import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createSyntheticFixture,disposeSyntheticFixture} from '../backend/identity-cleanup/fixtures.mjs';

test('server snapshot module exists without importing the business application',()=>assert.ok(fs.existsSync(new URL('../backend/identity-cleanup/server-snapshot.mjs',import.meta.url))));
test('private consistent snapshot copies referenced content-addressed objects and only disables website auth in isolation',async t=>{
  const fixture=createSyntheticFixture();let writer;t.after(()=>{writer?.close();disposeSyntheticFixture(fixture);});
  const store=path.join(fixture.directory,'objects');fs.mkdirSync(store,{mode:0o700});
  const bytes=Buffer.from('SYNTHETIC_OBJECT_BODY');const digest=crypto.createHash('sha256').update(bytes).digest('hex');
  const key='sha256/'+digest.slice(0,2)+'/'+digest;fs.mkdirSync(path.join(store,'sha256',digest.slice(0,2)),{recursive:true,mode:0o700});fs.writeFileSync(path.join(store,key),bytes,{mode:0o600});
  writer=new DatabaseSync(fixture.databasePath);writer.exec('PRAGMA journal_mode=WAL');writer.prepare('UPDATE documents SET storage_key=? WHERE id=?').run(key,'owned-admin');
  const {captureReadOnlySnapshot,verifyIsolatedSnapshot}=await import('../backend/identity-cleanup/server-snapshot.mjs');
  const capture=await captureReadOnlySnapshot({databasePath:fixture.databasePath,objectRoot:store,privateRoot:path.join(fixture.directory,'private-evidence'),provenance:{authority:'synthetic-offline-fixture'}});
  assert.equal(capture.summary.sourceFingerprintComplete,true);assert.equal(capture.summary.objects.verifiedReferences,1);assert.equal(capture.summary.objects.missingReferences,0);
  assert.ok(!JSON.stringify(capture.summary).includes('SYNTHETIC_OBJECT_BODY'));
  assert.ok(!JSON.stringify(capture.summary).includes(key));
  const restored=await verifyIsolatedSnapshot(capture);
  assert.equal(restored.websiteLegacyCredentialsDisabled,true);assert.equal(restored.operationalPairingStatePreserved,true);assert.equal(restored.tableCountsPreserved,true);assert.equal(restored.liveRestoreReady,false);
  assert.equal(writer.prepare("SELECT revoked_at FROM device_credentials WHERE id='paired-credential'").get().revoked_at,null);
  assert.equal(writer.prepare("SELECT password_hash FROM local_users WHERE id='admin'").get().password_hash,'SYNTHETIC_PASSWORD_MATERIAL');
  await assert.rejects(verifyIsolatedSnapshot({...capture}),/issued isolated snapshot/i);
});
test('missing referenced objects prevent a complete source fingerprint',async t=>{
  const fixture=createSyntheticFixture({objectStorage:true});t.after(()=>disposeSyntheticFixture(fixture));
  const store=path.join(fixture.directory,'objects');fs.mkdirSync(store);
  const {captureReadOnlySnapshot}=await import('../backend/identity-cleanup/server-snapshot.mjs');
  const capture=await captureReadOnlySnapshot({databasePath:fixture.databasePath,objectRoot:store,privateRoot:path.join(fixture.directory,'private-evidence'),provenance:{authority:'synthetic-offline-fixture'}});
  assert.equal(capture.summary.sourceFingerprintComplete,false);assert.equal(capture.summary.objects.invalidReferences,1);
});
test('private evidence refuses equal object root and either parent/child direction before writing',async t=>{
  const fixture=createSyntheticFixture();t.after(()=>disposeSyntheticFixture(fixture));
  const store=path.join(fixture.directory,'objects');fs.mkdirSync(store);
  const {captureReadOnlySnapshot}=await import('../backend/identity-cleanup/server-snapshot.mjs');
  for(const privateRoot of [store,path.join(store,'nested'),fixture.directory,...(process.platform==='win32'?[store.toUpperCase()]:[])])await assert.rejects(captureReadOnlySnapshot({databasePath:fixture.databasePath,objectRoot:store,privateRoot}),/disjoint/i);
  assert.deepEqual(fs.readdirSync(store),[]);
});
test('foreign-key violations prevent complete snapshots and isolated restore verification',async t=>{
  const fixture=createSyntheticFixture();t.after(()=>disposeSyntheticFixture(fixture));
  const writer=new DatabaseSync(fixture.databasePath);try{writer.exec("PRAGMA foreign_keys=OFF; UPDATE documents SET workspace_id='missing-workspace' WHERE id='owned-admin'");}finally{writer.close();}
  const store=path.join(fixture.directory,'objects');fs.mkdirSync(store);
  const {captureReadOnlySnapshot,verifyIsolatedSnapshot}=await import('../backend/identity-cleanup/server-snapshot.mjs');
  const capture=await captureReadOnlySnapshot({databasePath:fixture.databasePath,objectRoot:store,privateRoot:path.join(fixture.directory,'private-evidence')});
  assert.equal(capture.summary.integrity.ok,false);assert.equal(capture.summary.sourceFingerprintComplete,false);
  assert.equal(capture.summary.integrity.foreignKeyViolationCount,1);
  await assert.rejects(verifyIsolatedSnapshot(capture),/invariant/i);
});
test('unreferenced object changes alter the complete source baseline and entire store is privately backed up',async t=>{
  const fixture=createSyntheticFixture();t.after(()=>disposeSyntheticFixture(fixture));
  const objectRoot=path.join(fixture.directory,'objects');fs.mkdirSync(objectRoot);fs.writeFileSync(path.join(objectRoot,'orphan.bin'),'SYNTHETIC_ORPHAN_A');
  const {captureReadOnlySnapshot}=await import('../backend/identity-cleanup/server-snapshot.mjs');
  const first=await captureReadOnlySnapshot({databasePath:fixture.databasePath,objectRoot,privateRoot:path.join(fixture.directory,'private')});
  fs.writeFileSync(path.join(objectRoot,'orphan.bin'),'SYNTHETIC_ORPHAN_B');
  const second=await captureReadOnlySnapshot({databasePath:fixture.databasePath,objectRoot,privateRoot:path.join(fixture.directory,'private')});
  assert.notEqual(first.summary.sourceFingerprint,second.summary.sourceFingerprint);
  assert.equal(second.summary.objects.allStoreFilesCopied,1);
  assert.equal(second.summary.objects.backupObjectScopeComplete,true);
  const {extendClosedSnapshotObjectCoverage,verifyExtendedObjectRestore}=await import('../backend/identity-cleanup/object-store-extension.mjs');
  const extension=extendClosedSnapshotObjectCoverage({directory:second.directory,objectRoot,expectedArtifactFingerprint:second.summary.databaseArtifactFingerprint});
  assert.equal(extension.matchesOriginalCaptureStore,true);assert.equal(extension.sourceFingerprintComplete,true);assert.equal(extension.copiedFiles,1);
  assert.throws(()=>verifyExtendedObjectRestore({...extension}),/issued/i);
  const restored=verifyExtendedObjectRestore(extension);assert.equal(restored.objectsVerified,true);assert.equal(restored.files,1);
  assert.equal(hashProtectedFileForTest(second.artifactPath),second.summary.databaseArtifactFingerprint);
});
function hashProtectedFileForTest(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
test('restore refuses missing or tampered object artifacts instead of trusting capture booleans',async t=>{
  const fixture=createSyntheticFixture();t.after(()=>disposeSyntheticFixture(fixture));
  const objectRoot=path.join(fixture.directory,'objects');fs.mkdirSync(objectRoot);fs.writeFileSync(path.join(objectRoot,'orphan.bin'),'SYNTHETIC_ORPHAN');
  const {captureReadOnlySnapshot,verifyIsolatedSnapshot}=await import('../backend/identity-cleanup/server-snapshot.mjs');
  const capture=await captureReadOnlySnapshot({databasePath:fixture.databasePath,objectRoot,privateRoot:path.join(fixture.directory,'private')});
  for(const name of fs.readdirSync(path.join(capture.directory,'objects-all')))fs.writeFileSync(path.join(capture.directory,'objects-all',name),'SYNTHETIC_TAMPER');
  await assert.rejects(verifyIsolatedSnapshot(capture),/object/i);
});
