import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createSyntheticFixture,disposeSyntheticFixture} from '../backend/identity-cleanup/fixtures.mjs';
import {captureReadOnlySnapshot} from '../backend/identity-cleanup/server-snapshot.mjs';
import {validateCleanupManifest} from '../backend/identity-cleanup/vendor/cleanup-manifest.mjs';

test('partition preparation covers every known stable ID including large tables and hashes opaque request keys',async t=>{
  const fixture=createSyntheticFixture();t.after(()=>disposeSyntheticFixture(fixture));
  const db=new DatabaseSync(fixture.databasePath);
  try{
    db.exec(`CREATE TABLE audit_events(id TEXT PRIMARY KEY,workspace_id TEXT REFERENCES workspaces(id));
      CREATE TABLE notifications(id TEXT PRIMARY KEY,workspace_id TEXT REFERENCES workspaces(id),event_id TEXT);
      CREATE TABLE management_requests(workspace_id TEXT,kind TEXT,request_key TEXT,resource_id TEXT,PRIMARY KEY(workspace_id,kind,request_key));
      CREATE TABLE tasks(id TEXT PRIMARY KEY,workspace_id TEXT REFERENCES workspaces(id));`);
    for(let n=0;n<7;n++){db.prepare('INSERT INTO audit_events VALUES(?,?)').run('audit-'+n,'shared-workspace');db.prepare('INSERT INTO notifications VALUES(?,?,?)').run('note-'+n,'shared-workspace','audit-'+n);}
    for(let n=0;n<7;n++)db.prepare('INSERT INTO tasks VALUES(?,?)').run('task-'+n,'shared-workspace');
    db.prepare('INSERT INTO management_requests VALUES(?,?,?,?)').run('shared-workspace','task','SYNTHETIC_PRIVATE_REQUEST_KEY','task-6');
  }finally{db.close();}
  const objectRoot=path.join(fixture.directory,'objects');fs.mkdirSync(objectRoot);
  const capture=await captureReadOnlySnapshot({databasePath:fixture.databasePath,objectRoot,privateRoot:path.join(fixture.directory,'private')});
  const {prepareSnapshotPartitions}=await import('../backend/identity-cleanup/partition-manifests.mjs');
  const result=await prepareSnapshotPartitions({databasePath:capture.artifactPath,expectedArtifactFingerprint:capture.summary.databaseArtifactFingerprint,sourceFingerprint:capture.summary.sourceFingerprint,outputDirectory:path.join(capture.directory,'manifest-partitions'),partitionSize:3,projectionThreshold:3});
  assert.equal(result.schemaAndCountOnlyTables.length,0);
  assert.equal(result.primaryTableCounts.find(row=>row.table==='audit_events').represented,7);
  assert.equal(result.primaryTableCounts.find(row=>row.table==='notifications').represented,7);
  assert.equal(result.primaryTableCounts.find(row=>row.table==='management_requests').represented,1);
  assert.equal(result.dispositions.delete,0);
  assert.equal(result.validation.errors,0);
  const primary=new Set();
  for(const part of result.partitions){
    const wrapper=JSON.parse(fs.readFileSync(path.join(result.directory,part.file),'utf8'));
    assert.equal(validateCleanupManifest(wrapper.manifest,{}).errors.length,0);
    assert.ok(!JSON.stringify(wrapper.manifest).includes('SYNTHETIC_PRIVATE_REQUEST_KEY'));
    for(const ref of wrapper.primaryReferences){const key=JSON.stringify(ref);assert.ok(!primary.has(key));primary.add(key);}
  }
  assert.equal(primary.size,result.dispositions.total);
  await assert.rejects(prepareSnapshotPartitions({databasePath:capture.artifactPath,expectedArtifactFingerprint:'f'.repeat(64),sourceFingerprint:capture.summary.sourceFingerprint,outputDirectory:path.join(capture.directory,'other')}),/fingerprint/i);
});
