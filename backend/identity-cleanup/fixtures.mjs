import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync, backup} from 'node:sqlite';
import {probeWorkspaceSource} from './probe.mjs';
import {prepareCleanupManifest} from './manifest.mjs';
import {PRESERVED_ADMIN_EMAIL} from './vendor/cleanup-manifest.mjs';
import {fingerprintConsistentSnapshot} from './snapshot-fingerprint.mjs';

const issued = new WeakSet();
const hashFile = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const quote = value => '"' + value.replaceAll('"','""') + '"';
const allowedFixtureTables=new Set(['cleanup_fixture_guard','workspaces','members','documents','skills','devices','device_credentials','device_pairing_codes','platform_accounts','local_users','local_sessions','api_keys','future_unknown','retained_dependency']);
const reviewedCredentialFields=new Set(['local_users.password_hash','local_sessions.token_hash','api_keys.token_hash','device_credentials.token_hash','device_pairing_codes.code_hash']);
function assertSyntheticSchema(db){
  for(const {name} of db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all()){
    if(!allowedFixtureTables.has(name))throw new Error('Unreviewed synthetic fixture schema cannot be backed up or restored');
    for(const column of db.prepare('PRAGMA table_info('+quote(name)+')').all())if(/password|token|secret|cookie|authorization|private_key|credential/i.test(column.name)&&!reviewedCredentialFields.has(name+'.'+column.name))throw new Error('Unreviewed synthetic credential column cannot be restored');
  }
}
function assertFixture(context) {
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  if (!context || !issued.has(context) || !path.basename(context.directory).startsWith('workspace-cleanup-fixture-') || path.dirname(fs.realpathSync(context.directory)) !== temporaryRoot || path.dirname(fs.realpathSync(context.databasePath)) !== fs.realpathSync(context.directory)) throw new Error('Only an issued isolated synthetic fixture context is accepted');
  const db = new DatabaseSync(context.databasePath,{readOnly:true});
  try {if(db.prepare('SELECT nonce FROM cleanup_fixture_guard').get()?.nonce!==context.nonce)throw new Error('Synthetic fixture marker mismatch');}finally{db.close();}
}

export function createSyntheticFixture({emailConflict=false,seed=false,unknown=false,crossCascade=false,objectStorage=false} = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'workspace-cleanup-fixture-'));
  fs.chmodSync(directory,0o700);
  const databasePath=path.join(directory,'source.sqlite');
  const nonce=crypto.randomBytes(24).toString('hex');
  const context=Object.freeze({directory,databasePath,nonce});
  const db=new DatabaseSync(databasePath);
  try {
    db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE cleanup_fixture_guard(nonce TEXT PRIMARY KEY);
      CREATE TABLE workspaces(id TEXT PRIMARY KEY);
      CREATE TABLE members(id TEXT PRIMARY KEY,workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,user_id TEXT);
      CREATE TABLE documents(id TEXT PRIMARY KEY,workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,owner_user_id TEXT,user_id TEXT,content TEXT,storage_key TEXT);
      CREATE TABLE skills(id TEXT PRIMARY KEY,workspace_id TEXT);
      CREATE TABLE devices(id TEXT PRIMARY KEY,workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,owner_user_id TEXT);
      CREATE TABLE device_credentials(id TEXT PRIMARY KEY,device_id TEXT REFERENCES devices(id) ON DELETE CASCADE,workspace_id TEXT,token_hash TEXT,revoked_at TEXT);
      CREATE TABLE device_pairing_codes(id TEXT PRIMARY KEY,workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,code_hash TEXT,expires_at TEXT,consumed_at TEXT);
      CREATE TABLE platform_accounts(id TEXT PRIMARY KEY,workspace_id TEXT,owner_user_id TEXT);
      INSERT INTO workspaces VALUES('shared-workspace');
      INSERT INTO devices VALUES('paired-device','shared-workspace','admin');
      INSERT INTO device_credentials VALUES('paired-credential','paired-device','shared-workspace','SYNTHETIC_DEVICE_MATERIAL',NULL);
      INSERT INTO device_pairing_codes VALUES('pairing-record','shared-workspace','SYNTHETIC_DEVICE_MATERIAL','2999-01-01',NULL);
      INSERT INTO platform_accounts VALUES('external-platform-record','shared-workspace','admin');
      INSERT INTO skills VALUES('global-skill',NULL);
      INSERT INTO documents VALUES('owned-admin','shared-workspace','admin',NULL,'SYNTHETIC_BUSINESS_BODY',NULL);
      INSERT INTO documents VALUES('owned-other','shared-workspace','other',NULL,'SYNTHETIC_BUSINESS_BODY',NULL);
      INSERT INTO documents VALUES('mixed-document','shared-workspace','admin','third','SYNTHETIC_BUSINESS_BODY',NULL);
      INSERT INTO documents VALUES('unowned-document',NULL,NULL,NULL,'SYNTHETIC_BUSINESS_BODY',NULL);`);
    db.prepare('INSERT INTO cleanup_fixture_guard VALUES(?)').run(nonce);
    if(!seed){
      db.exec(`CREATE TABLE local_users(id TEXT PRIMARY KEY,email TEXT,password_hash TEXT);
        CREATE TABLE local_sessions(id TEXT PRIMARY KEY,user_id TEXT REFERENCES local_users(id) ON DELETE CASCADE,token_hash TEXT,expires_at TEXT);
        CREATE TABLE api_keys(id TEXT PRIMARY KEY,workspace_id TEXT,token_hash TEXT,status TEXT,revoked_at TEXT);
        INSERT INTO local_users VALUES('other','other@example.test','SYNTHETIC_PASSWORD_MATERIAL');
        INSERT INTO local_users VALUES('third','third@example.test','SYNTHETIC_PASSWORD_MATERIAL');
        INSERT INTO members VALUES('admin-membership','shared-workspace','admin');
        INSERT INTO members VALUES('other-membership','shared-workspace','other');
        INSERT INTO api_keys VALUES('old-api-key','shared-workspace','SYNTHETIC_COOKIE_MATERIAL','active',NULL);`);
      db.prepare('INSERT INTO local_users VALUES(?,?,?)').run('admin',PRESERVED_ADMIN_EMAIL,'SYNTHETIC_PASSWORD_MATERIAL');
      db.exec("INSERT INTO local_sessions VALUES('old-session','admin','SYNTHETIC_COOKIE_MATERIAL','2999-01-01')");
      if(emailConflict)db.prepare('INSERT INTO local_users VALUES(?,?,?)').run('admin-conflict',PRESERVED_ADMIN_EMAIL.toUpperCase(),'SYNTHETIC_PASSWORD_MATERIAL');
    }
    if(unknown)db.exec("CREATE TABLE future_unknown(id TEXT PRIMARY KEY,content TEXT);INSERT INTO future_unknown VALUES('unknown-resource','SYNTHETIC_BUSINESS_BODY')");
    if(crossCascade)db.exec("CREATE TABLE retained_dependency(id TEXT PRIMARY KEY,user_id TEXT REFERENCES local_users(id) ON DELETE CASCADE);INSERT INTO retained_dependency VALUES('mixed-dependent','other')");
    if(objectStorage)db.exec("UPDATE documents SET storage_key='SYNTHETIC_OBJECT_KEY' WHERE id='owned-admin'");
  }finally{db.close();}
  issued.add(context);
  return context;
}

export async function snapshotSyntheticFixture(context) {
  assertFixture(context);
  const probe=probeWorkspaceSource({databasePath:context.databasePath,evidenceRef:'synthetic-fixture/probe.json'});
  const artifactPath=path.join(context.directory,'snapshot.sqlite');
  if(fs.existsSync(artifactPath))throw new Error('Synthetic snapshot already exists; never overwrite an artifact');
  const source=new DatabaseSync(context.databasePath,{readOnly:true});
  let businessFingerprint,operationalFingerprint;
  const operationalState=db=>crypto.createHash('sha256').update(JSON.stringify(['devices','device_credentials','device_pairing_codes','platform_accounts'].map(table=>[table,db.prepare('SELECT * FROM '+quote(table)+' ORDER BY id').all()]))).digest('hex');
  try{source.exec('PRAGMA query_only=ON');assertSyntheticSchema(source);businessFingerprint=crypto.createHash('sha256').update(JSON.stringify(source.prepare('SELECT id,content FROM documents ORDER BY id').all())).digest('hex');operationalFingerprint=operationalState(source);await backup(source,artifactPath);}finally{source.close();}
  fs.chmodSync(artifactPath,0o600);
  const current=probeWorkspaceSource({databasePath:context.databasePath,evidenceRef:'synthetic-fixture/probe.json'});
  if(current.metadataInventoryFingerprint!==probe.metadataInventoryFingerprint)throw new Error('Source metadata changed during isolated snapshot');
  probe.sourceFingerprint=fingerprintConsistentSnapshot({databaseArtifactFingerprint:hashFile(artifactPath),objectReferenceFingerprint:crypto.createHash('sha256').update('[]').digest('hex'),objectContentFingerprint:crypto.createHash('sha256').update('[]').digest('hex')});
  probe.sourceFingerprintComplete=probe.objectStorage.referenceCount===0;
  probe.fingerprintScope='Consistent SQLite backup bytes (includes business content and credential bytes without exposing them) plus empty object-reference/content sets; nonempty objects remain incomplete.';
  if(probe.sourceFingerprintComplete)probe.blockers=probe.blockers.filter(value=>value!=='content-fingerprint-not-captured');
  const backupEvidence={status:'verified',method:'node:sqlite.backup',evidenceRef:'synthetic-fixture/backup-evidence.json',artifactFingerprint:hashFile(artifactPath),sourceFingerprint:probe.sourceFingerprint,consistencyEvidenceRef:'synthetic-fixture/sqlite-backup-api',accessPolicyRef:'synthetic-fixture/mode-0700-0600-windows-acl-not-production-verified',retentionPolicyRef:'synthetic-fixture/test-lifetime-no-auto-production-retention'};
  const {method,...sharedBackup}=backupEvidence;
  const preparation=prepareCleanupManifest(probe,{syntheticFixture:true,backupEvidence:sharedBackup});
  const result={probe,artifactPath,backup:backupEvidence,businessFingerprint,operationalFingerprint,preparation,retention:{scope:'synthetic-only',neverPackageRealDatabase:true,restrictedPath:context.directory,expiresAt:new Date(Date.now()+86400000).toISOString()}};
  fs.writeFileSync(path.join(context.directory,'backup-evidence.json'),JSON.stringify({...result,probe:undefined,preparation:undefined},null,2));
  return result;
}

export async function restoreSyntheticFixture(context,snapshot) {
  assertFixture(context);
  const artifactPath=path.join(context.directory,'snapshot.sqlite');
  if(snapshot?.artifactPath!==artifactPath||fs.lstatSync(artifactPath).isSymbolicLink()||path.dirname(fs.realpathSync(artifactPath))!==fs.realpathSync(context.directory)||hashFile(artifactPath)!==snapshot?.backup?.artifactFingerprint)throw new Error('Backup artifact fingerprint mismatch');
  const restoredPath=path.join(context.directory,'restored.sqlite');
  if(fs.existsSync(restoredPath))throw new Error('Synthetic restore destination already exists');
  const source=new DatabaseSync(artifactPath,{readOnly:true});
  try{assertSyntheticSchema(source);await backup(source,restoredPath);}finally{source.close();}
  fs.chmodSync(restoredPath,0o600);
  const db=new DatabaseSync(restoredPath);
  let businessBodyPreserved=false,legacyCredentialsInactive=false,pairingIdsPreserved=false,pairingStatesPreserved=false;
  try{
    db.exec('BEGIN IMMEDIATE');
    const tableNames=new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row=>row.name));
    if(tableNames.has('local_users'))db.exec("UPDATE local_users SET password_hash='!unified-identity-required-disabled!'");
    if(tableNames.has('local_sessions'))db.exec("UPDATE local_sessions SET token_hash='disabled:'||id,expires_at='1970-01-01T00:00:00Z'");
    if(tableNames.has('api_keys'))db.exec("UPDATE api_keys SET token_hash='disabled:'||id,status='revoked',revoked_at='1970-01-01T00:00:00Z'");
    db.exec('COMMIT');
    businessBodyPreserved=crypto.createHash('sha256').update(JSON.stringify(db.prepare('SELECT id,content FROM documents ORDER BY id').all())).digest('hex')===snapshot.businessFingerprint;
    pairingIdsPreserved=db.prepare("SELECT id FROM devices WHERE id='paired-device'").get()?.id==='paired-device'&&db.prepare("SELECT id FROM device_credentials WHERE id='paired-credential'").get()?.id==='paired-credential'&&db.prepare("SELECT id FROM device_pairing_codes WHERE id='pairing-record'").get()?.id==='pairing-record';
    pairingStatesPreserved=crypto.createHash('sha256').update(JSON.stringify(['devices','device_credentials','device_pairing_codes','platform_accounts'].map(table=>[table,db.prepare('SELECT * FROM '+quote(table)+' ORDER BY id').all()]))).digest('hex')===snapshot.operationalFingerprint;
    legacyCredentialsInactive=(!tableNames.has('local_users')||db.prepare("SELECT count(*) AS n FROM local_users WHERE password_hash<>'!unified-identity-required-disabled!'").get().n===0)&&(!tableNames.has('local_sessions')||db.prepare("SELECT count(*) AS n FROM local_sessions WHERE expires_at>'1970-01-01T00:00:00Z'").get().n===0)&&(!tableNames.has('api_keys')||db.prepare("SELECT count(*) AS n FROM api_keys WHERE status<>'revoked' OR revoked_at IS NULL").get().n===0);
  }finally{db.close();}
  const restoredProbe=probeWorkspaceSource({databasePath:restoredPath,evidenceRef:'synthetic-fixture/restore-probe.json'});
  const restore={status:'verified',evidenceRef:'synthetic-fixture/restore-evidence.json',backupArtifactFingerprint:snapshot.backup.artifactFingerprint,isolated:true,verifiedInventoryFingerprint:restoredProbe.inventoryFingerprint,administratorPreserved:snapshot.probe.administrator.loginAccountRefs.every(ref=>restoredProbe.stableIds.some(candidate=>candidate.type===ref.type&&candidate.id===ref.id))&&businessBodyPreserved,collaborationPreserved:null};
  if(restoredProbe.inventoryFingerprint!==snapshot.probe.inventoryFingerprint||!restore.administratorPreserved||!legacyCredentialsInactive||!pairingIdsPreserved||!pairingStatesPreserved)throw new Error('Isolated restore verification failed');
  const {method,...sharedBackup}=snapshot.backup;
  const preparation=prepareCleanupManifest(snapshot.probe,{syntheticFixture:true,backupEvidence:sharedBackup,restoreEvidence:restore});
  const result={...preparation,restore,businessBodyPreserved,legacyCredentialsInactive,pairingIdsPreserved,pairingStatesPreserved,operationalCredentialPolicy:'snapshot-state-only; latest revocation ledger required before any live use',restoredPath,centralSubjectOperations:0};
  fs.writeFileSync(path.join(context.directory,'restore-evidence.json'),JSON.stringify(result,null,2));
  return result;
}

export function disposeSyntheticFixture(context) {
  assertFixture(context);
  const target=fs.realpathSync(context.directory),temporaryRoot=fs.realpathSync(os.tmpdir());
  if(path.dirname(target)!==temporaryRoot||!path.basename(target).startsWith('workspace-cleanup-fixture-'))throw new Error('Unsafe synthetic fixture cleanup path');
  issued.delete(context);
  fs.rmSync(target,{recursive:true,force:false});
}
