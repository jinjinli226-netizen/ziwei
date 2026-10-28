import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync,backup,constants} from 'node:sqlite';
import {TABLE_KINDS,SAFE_COLUMNS,PRIVATE_IDENTIFIER_TABLES,INFRASTRUCTURE_TABLES} from './catalog.mjs';
import {fingerprintConsistentSnapshot} from './snapshot-fingerprint.mjs';

const issued=new WeakSet();
const quote=value=>'"'+value.replaceAll('"','""')+'"';
const digest=value=>crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const now=()=>new Date().toISOString();
const json=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
export function hashProtectedFile(file){
  const hash=crypto.createHash('sha256'),buffer=Buffer.alloc(1024*1024),fd=fs.openSync(file,'r');
  try{let size;while((size=fs.readSync(fd,buffer,0,buffer.length,null)))hash.update(buffer.subarray(0,size));}finally{fs.closeSync(fd);}
  return hash.digest('hex');
}
function regular(file){const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink())throw new Error('A regular non-symbolic file is required');return s;}
function metadata(file){try{const s=regular(file);return {size:s.size,mtimeMs:s.mtimeMs,device:String(s.dev),inode:String(s.ino),mode:(s.mode&0o777).toString(8),uid:s.uid,gid:s.gid};}catch(error){if(error.code==='ENOENT')return null;throw error;}}
function noSymlinkAncestors(file){let current=path.resolve(file);while(true){if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw new Error('Symbolic path component is forbidden');const parent=path.dirname(current);if(parent===current)break;current=parent;}}
function privateDirectory(directory){
  noSymlinkAncestors(directory);
  if(!fs.existsSync(directory))fs.mkdirSync(directory,{mode:0o700});
  const s=fs.lstatSync(directory);
  if(!s.isDirectory()||s.isSymbolicLink()||(process.platform!=='win32'&&((s.mode&0o077)!==0||s.uid!==process.getuid())))throw new Error('Private directory must be owned by this user and deny group/other access');
}
const within=(parent,file)=>{const relative=path.relative(parent,file);return relative!==''&&!relative.startsWith('..')&&!path.isAbsolute(relative);};
const websiteTables=new Set(['local_users','local_sessions','api_keys']);
const operationalTables=['devices','device_credentials','device_pairing_codes','device_workspace_grants','employee_phone_mcp','ziwei_connect_bindings'];
function tableNames(db){return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(row=>row.name);}
function counts(db){return tableNames(db).map(name=>({name,count:db.prepare('SELECT count(*) AS n FROM '+quote(name)).get().n}));}
function operationalStates(db){
  const names=new Set(tableNames(db));
  return operationalTables.filter(name=>names.has(name)).map(name=>{
    const available=db.prepare('PRAGMA table_info('+quote(name)+')').all().map(row=>row.name);
    const columns=['id','device_id','workspace_id','employee_id','revoked_at','expires_at','consumed_at','status','enabled'].filter(name=>available.includes(name));
    return {table:name,columns,rows:db.prepare('SELECT '+columns.map(quote).join(',')+' FROM '+quote(name)+' ORDER BY '+columns.map(quote).join(',')).all()};
  });
}
function quickIntegrity(db){const rows=db.prepare('PRAGMA integrity_check').all(),sqliteIntegrityOk=rows.length===1&&Object.values(rows[0])[0]==='ok',foreignKeyViolationCount=db.prepare('PRAGMA foreign_key_check').all().length;return {ok:sqliteIntegrityOk&&foreignKeyViolationCount===0,sqliteIntegrityOk,diagnosticCount:rows.length,foreignKeyViolationCount};}

/** Source handle is always readOnly + query_only. No business module is imported. */
export async function captureReadOnlySnapshot({databasePath,objectRoot,privateRoot,provenance}={}){
  for(const value of [databasePath,objectRoot,privateRoot])if(!path.isAbsolute(value||''))throw new TypeError('Explicit absolute source, object and private evidence paths are required');
  noSymlinkAncestors(databasePath);noSymlinkAncestors(objectRoot);noSymlinkAncestors(privateRoot);
  const sourcePath=fs.realpathSync(databasePath),objectsPath=fs.realpathSync(objectRoot),privatePath=path.resolve(privateRoot);
  regular(sourcePath);
  if(path.relative(sourcePath,privatePath)===''||path.relative(objectsPath,privatePath)===''||within(objectsPath,privatePath)||within(privatePath,sourcePath)||within(privatePath,objectsPath))throw new Error('Private evidence must be disjoint from the source database/object tree');
  privateDirectory(privatePath);
  const directory=path.join(privatePath,'snapshot-'+now().replaceAll(':','-').replaceAll('.','-')+'-'+crypto.randomBytes(5).toString('hex'));
  fs.mkdirSync(directory,{mode:0o700});
  const nonce=crypto.randomBytes(32).toString('hex');json(path.join(directory,'isolation-guard.json'),{nonce,purpose:'readonly-source-backup-and-sql-only-isolated-restore'});
  const artifactPath=path.join(directory,'source.snapshot.sqlite'),startedAt=now(),before={database:metadata(sourcePath),wal:metadata(sourcePath+'-wal')};
  const source=new DatabaseSync(sourcePath,{readOnly:true});let sourceSchemaFingerprint;
  try{
    source.exec('PRAGMA query_only=ON; BEGIN');
    sourceSchemaFingerprint=digest(source.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all());
    await backup(source,artifactPath); // SQLite online backup includes committed WAL pages in the pinned read snapshot.
    source.exec('ROLLBACK');
  }finally{source.close();}
  fs.chmodSync(artifactPath,0o600);
  const backupCompletedAt=now(),databaseArtifactFingerprint=hashProtectedFile(artifactPath);
  const snapshot=new DatabaseSync(artifactPath,{readOnly:true});const tables=[],referenceRecords=[],objectRecords=[],blockers=[];
  let integrity,adminIds,operationalStateFingerprint,totalStableIds=0,unknownTables=0;
  try{
    snapshot.exec('PRAGMA query_only=ON; BEGIN');integrity=quickIntegrity(snapshot);
    const names=tableNames(snapshot);
    adminIds=names.includes('local_users')?snapshot.prepare('SELECT id FROM local_users WHERE email=? COLLATE NOCASE ORDER BY id').all('2594156182@qq.com').map(row=>row.id):[];
    operationalStateFingerprint=digest(operationalStates(snapshot));
    const inventoryDir=path.join(directory,'inventory');fs.mkdirSync(inventoryDir,{mode:0o700});
    for(const name of names){
      const columns=snapshot.prepare('PRAGMA table_info('+quote(name)+')').all().map(row=>({name:row.name,type:row.type,notNull:Boolean(row.notnull),pkOrder:row.pk}));
      const foreignKeys=snapshot.prepare('PRAGMA foreign_key_list('+quote(name)+')').all();
      const count=snapshot.prepare('SELECT count(*) AS n FROM '+quote(name)).get().n;
      const infrastructure=INFRASTRUCTURE_TABLES.has(name)||name.startsWith('sqlite_');
      const known=Object.hasOwn(TABLE_KINDS,name),privateId=PRIVATE_IDENTIFIER_TABLES.has(name);
      const selected=known&&!privateId&&!infrastructure?columns.filter(column=>SAFE_COLUMNS.has(column.name)).map(column=>column.name):[];
      const primaryKey=columns.filter(column=>column.pkOrder).sort((a,b)=>a.pkOrder-b.pkOrder).map(column=>column.name);
      const enumerable=primaryKey.length>0&&primaryKey.every(column=>selected.includes(column));
      let projected=0,projectionFingerprint=null;
      if(enumerable){
        const target=path.join(inventoryDir,digest(name)+'.jsonl');const fd=fs.openSync(target,'wx',0o600),hash=crypto.createHash('sha256');
        try{for(const value of snapshot.prepare('SELECT '+selected.map(quote).join(',')+' FROM '+quote(name)+' ORDER BY '+primaryKey.map(quote).join(',')).iterate()){
          const line=JSON.stringify({table:name,kind:TABLE_KINDS[name],values:value})+'\n';fs.writeSync(fd,line);hash.update(line);projected++;
        }}finally{fs.closeSync(fd);}projectionFingerprint=hash.digest('hex');totalStableIds+=projected;
      }
      if(!known&&!infrastructure){unknownTables++;blockers.push('unknown-native-table:'+name);}
      tables.push({name,count,kind:TABLE_KINDS[name]||null,coverage:infrastructure?'infrastructure':enumerable?'safe-projection-complete':'schema-count-only-pending',columns,foreignKeys,selectedColumns:selected,primaryKey,projected,projectionFingerprint});
      if(columns.some(column=>column.name==='storage_key')){
        if(!['documents','document_versions','task_attachments'].includes(name)){blockers.push('unknown-object-reference-table:'+name);continue;}
        const withChecksum=columns.some(column=>column.name==='checksum');
        const query='SELECT id,storage_key'+(withChecksum?',checksum':'')+' FROM '+quote(name)+" WHERE storage_key IS NOT NULL AND storage_key<>'' ORDER BY id";
        for(const row of snapshot.prepare(query).iterate())referenceRecords.push({table:name,id:row.id,key:row.storage_key,checksum:row.checksum||null});
      }
    }
    snapshot.exec('ROLLBACK');
  }finally{snapshot.close();}
  const copiedDir=path.join(directory,'objects');fs.mkdirSync(copiedDir,{mode:0o700});
  let verifiedReferences=0,invalidReferences=0,missingReferences=0,changedReferences=0,totalBytes=0;
  for(const record of referenceRecords){
    const key=String(record.key),keyDigest=digest(key);
    if(!/^sha256\/[0-9a-f]{2}\/[0-9a-f]{64}$/.test(key)){invalidReferences++;continue;}
    const sourceFile=path.join(objectsPath,...key.split('/'));let originalHash;
    try{noSymlinkAncestors(sourceFile);regular(sourceFile);originalHash=hashProtectedFile(sourceFile);}catch(error){if(error.code==='ENOENT')missingReferences++;else invalidReferences++;continue;}
    const expected=key.split('/')[2];
    if(expected!==originalHash||(record.checksum&&record.checksum!==originalHash)){invalidReferences++;continue;}
    const destination=path.join(copiedDir,keyDigest);
    if(!fs.existsSync(destination)){fs.copyFileSync(sourceFile,destination,fs.constants.COPYFILE_EXCL);fs.chmodSync(destination,0o600);totalBytes+=fs.statSync(destination).size;}
    const copiedHash=hashProtectedFile(destination),afterHash=hashProtectedFile(sourceFile);
    if(originalHash!==copiedHash||originalHash!==afterHash){changedReferences++;continue;}
    objectRecords.push({keyDigest,checksum:copiedHash,size:fs.statSync(destination).size});verifiedReferences++;
  }
  // Check all files in the explicit store without outputting keys, paths or bytes.
  const storeRecords=[],storeMap=[];let storeLinks=0,storeChanges=0;
  const allStoreDirectory=path.join(directory,'objects-all');fs.mkdirSync(allStoreDirectory,{mode:0o700});
  const walk=folder=>{for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const target=path.join(folder,entry.name);if(entry.isSymbolicLink()){storeLinks++;continue;}if(entry.isDirectory())walk(target);else if(entry.isFile()){
    const relativePath=path.relative(objectsPath,target).split(path.sep).join('/'),relativePathDigest=digest(relativePath),checksum=hashProtectedFile(target),copied=path.join(allStoreDirectory,relativePathDigest);
    fs.copyFileSync(target,copied,fs.constants.COPYFILE_EXCL);fs.chmodSync(copied,0o600);
    if(hashProtectedFile(copied)!==checksum||hashProtectedFile(target)!==checksum)storeChanges++;
    const size=fs.statSync(copied).size;storeRecords.push({relativePathDigest,size,checksum});storeMap.push({relativePath,artifact:relativePathDigest,size,checksum});
  }}};
  walk(objectsPath);storeRecords.sort((a,b)=>a.relativePathDigest.localeCompare(b.relativePathDigest));
  json(path.join(directory,'private-object-restore-map.json'),storeMap);
  const objectReferenceFingerprint=digest(referenceRecords),objectContentFingerprint=digest(objectRecords.sort((a,b)=>a.keyDigest.localeCompare(b.keyDigest)));
  const referencedPathDigests=new Set(referenceRecords.map(row=>digest(String(row.key))));
  const unreferencedStoreFiles=storeRecords.filter(row=>!referencedPathDigests.has(row.relativePathDigest)).length;
  if(unreferencedStoreFiles)blockers.push('unreferenced-object-files-pending:'+unreferencedStoreFiles);
  const objectsComplete=!invalidReferences&&!missingReferences&&!changedReferences&&!storeLinks&&!storeChanges&&!blockers.some(value=>value.startsWith('unknown-object-reference'));
  if(!objectsComplete)blockers.push('object-references-incomplete');
  if(adminIds.length!==1)blockers.push('protected-admin-not-uniquely-resolved');
  if(!integrity.ok)blockers.push('database-integrity-check-failed');
  const sourceFingerprint=fingerprintConsistentSnapshot({databaseArtifactFingerprint,objectReferenceFingerprint,objectContentFingerprint,objectStoreFingerprint:digest(storeRecords)});
  const summary={schemaVersion:1,service:'workspace',startedAt,backupCompletedAt,completedAt:now(),source:{databasePath:sourcePath,objectRoot:objectsPath,readOnly:true,queryOnly:true,method:'node:sqlite.backup-pinned-read-transaction',before,after:{database:metadata(sourcePath),wal:metadata(sourcePath+'-wal')},schemaFingerprint:sourceSchemaFingerprint,provenance},databaseArtifactFingerprint,sourceFingerprint,sourceFingerprintComplete:objectsComplete&&integrity.ok,metadataInventoryFingerprint:digest(tables),fingerprintScope:'Closed consistent SQLite backup bytes plus SQL referenced-object linkage/content and entire store path/size/content digests, including unreferenced objects; active main-file hash is not used.',tableCount:tables.length,totalRows:tables.reduce((n,row)=>n+row.count,0),stableIdProjectionCount:totalStableIds,unknownTables,protectedAdminMatches:adminIds.length,tables,integrity,objects:{referenceCount:referenceRecords.length,verifiedReferences,invalidReferences,missingReferences,changedReferences,copiedUniqueObjects:new Set(objectRecords.map(row=>row.keyDigest)).size,copiedBytes:totalBytes,objectReferenceFingerprint,objectContentFingerprint,objectRestoreMapFingerprint:digest(storeMap),allStoreFilesCopied:storeRecords.length,backupObjectScopeComplete:objectsComplete,storeChangesDuringCopy:storeChanges,storeRegularFiles:storeRecords.length,storeBytes:storeRecords.reduce((n,row)=>n+row.size,0),unreferencedStoreFiles,storeMetadataFingerprint:digest(storeRecords),symlinksSkipped:storeLinks,scope:'All explicit-store regular files are privately copied and hashed; SQL references are verified separately. Unreferenced ownership stays pending, never deleted or reassigned.'},privateDirectory:directory,accessPolicy:{directoryMode:'0700',fileMode:'0600',uid:process.getuid?.()??null,groupOtherDenied:process.platform!=='win32',localWindowsAclVerified:false,rawDatabaseTransferred:false},retention:{policy:'Retain protected artifact for independent identity review; review due in 7 days; no automatic purge or production restore authorization.',reviewDue:new Date(Date.now()+7*86400000).toISOString()},blockers,independentReviewRequired:true,centralIdentityOperations:[],productionMutations:0};
  json(path.join(directory,'snapshot-summary.json'),summary);
  const context=Object.freeze({directory,artifactPath,nonce,summary,operationalStateFingerprint,sourcePath,adminIds});issued.add(context);return context;
}

function restoreObjectArtifacts(context){
  const {directory,summary}=context,mapFile=path.join(directory,'private-object-restore-map.json');
  noSymlinkAncestors(mapFile);regular(mapFile);
  const mapping=JSON.parse(fs.readFileSync(mapFile,'utf8'));
  if(!Array.isArray(mapping)||digest(mapping)!==summary.objects.objectRestoreMapFingerprint)throw new Error('Private object restore map fingerprint mismatch');
  const output=path.join(directory,'isolated.objects');if(fs.existsSync(output))throw new Error('Isolated object restore destination already exists');
  fs.mkdirSync(output,{mode:0o700});let verified=0;
  for(const record of mapping){
    if(typeof record.relativePath!=='string'||record.relativePath.includes('\\')||record.relativePath.includes('\0')||record.relativePath.split('/').some(part=>!part||part==='.'||part==='..'||part.includes(':'))||!(/^[a-f0-9]{64}$/).test(record.artifact)||!(/^[a-f0-9]{64}$/).test(record.checksum))throw new Error('Invalid private object restore path');
    const source=path.join(directory,'objects-all',record.artifact),target=path.resolve(output,...record.relativePath.split('/'));
    if(!within(output,target))throw new Error('Object restore escaped the isolated directory');
    noSymlinkAncestors(source);const sourceStat=regular(source);
    if(sourceStat.size!==record.size||hashProtectedFile(source)!==record.checksum)throw new Error('Object artifact fingerprint mismatch');
    fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
    fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);fs.chmodSync(target,0o600);
    if(hashProtectedFile(target)!==record.checksum)throw new Error('Isolated restored object fingerprint mismatch');verified++;
  }
  return {verified:verified===summary.objects.allStoreFilesCopied,files:verified,mapFingerprint:summary.objects.objectRestoreMapFingerprint};
}

/** Only the fresh issued private snapshot is writable. Never opens the live path writable. */
export async function verifyIsolatedSnapshot(context){
  if(!context||!issued.has(context))throw new Error('An issued isolated snapshot context is required');
  const {directory,artifactPath,summary}=context;
  privateDirectory(directory);
  if(JSON.parse(fs.readFileSync(path.join(directory,'isolation-guard.json'),'utf8')).nonce!==context.nonce||path.dirname(fs.realpathSync(artifactPath))!==fs.realpathSync(directory)||hashProtectedFile(artifactPath)!==summary.databaseArtifactFingerprint)throw new Error('Isolated snapshot guard or artifact hash mismatch');
  if(!summary.sourceFingerprintComplete)throw new Error('Snapshot coverage invariant is incomplete; isolated restore cannot be verified');
  const objectRestore=restoreObjectArtifacts(context);
  const restoredPath=path.join(directory,'isolated.restore.sqlite');
  if(fs.existsSync(restoredPath)||!within(directory,restoredPath)||restoredPath===context.sourcePath)throw new Error('An unused isolated restore destination is required');
  fs.copyFileSync(artifactPath,restoredPath,fs.constants.COPYFILE_EXCL);fs.chmodSync(restoredPath,0o600);
  if(hashProtectedFile(restoredPath)!==summary.databaseArtifactFingerprint)throw new Error('Isolated restore initial copy hash mismatch');
  const db=new DatabaseSync(restoredPath);let result;
  try{
    const beforeCounts=counts(db),beforeSchema=digest(db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all());
    const names=new Set(tableNames(db));
    const authTriggers=db.prepare("SELECT tbl_name FROM sqlite_schema WHERE type='trigger'").all().filter(row=>websiteTables.has(row.tbl_name));
    if(authTriggers.length)throw new Error('Unreviewed website-auth triggers block isolated credential changes');
    const allowedColumns={local_users:new Set(['password_hash']),local_sessions:new Set(['token_hash','expires_at']),api_keys:new Set(['token_hash','status','revoked_at'])};
    db.setAuthorizer((action,table,column)=>{
      if(action===constants.SQLITE_UPDATE)return allowedColumns[table]?.has(column)?constants.SQLITE_OK:constants.SQLITE_DENY;
      if(action===constants.SQLITE_INSERT||action===constants.SQLITE_DELETE)return constants.SQLITE_DENY;
      return constants.SQLITE_OK;
    });
    db.exec('BEGIN IMMEDIATE');
    const changes=[];
    if(names.has('local_users'))changes.push({table:'local_users',changed:db.prepare("UPDATE local_users SET password_hash='!isolated-unified-required-disabled!'").run().changes});
    if(names.has('local_sessions'))changes.push({table:'local_sessions',changed:db.prepare("UPDATE local_sessions SET token_hash='isolated-disabled:'||id,expires_at='1970-01-01T00:00:00Z'").run().changes});
    if(names.has('api_keys'))changes.push({table:'api_keys',changed:db.prepare("UPDATE api_keys SET token_hash='isolated-disabled:'||id,status='revoked',revoked_at=COALESCE(revoked_at,'1970-01-01T00:00:00Z')").run().changes});
    db.exec('COMMIT');
    const afterCounts=counts(db),afterSchema=digest(db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all());
    const operationalPairingStatePreserved=digest(operationalStates(db))===context.operationalStateFingerprint;
    const adminIds=names.has('local_users')?db.prepare('SELECT id FROM local_users WHERE email=? COLLATE NOCASE ORDER BY id').all('2594156182@qq.com').map(row=>row.id):[];
    const websiteLegacyCredentialsDisabled=changes.every(row=>row.changed===beforeCounts.find(table=>table.name===row.table).count)&&(!names.has('local_users')||db.prepare("SELECT count(*) AS n FROM local_users WHERE password_hash<>'!isolated-unified-required-disabled!'").get().n===0)&&(!names.has('local_sessions')||db.prepare("SELECT count(*) AS n FROM local_sessions WHERE expires_at>'1970-01-01T00:00:00Z' OR token_hash<>'isolated-disabled:'||id").get().n===0)&&(!names.has('api_keys')||db.prepare("SELECT count(*) AS n FROM api_keys WHERE status<>'revoked' OR revoked_at IS NULL OR token_hash<>'isolated-disabled:'||id").get().n===0);
    const tableCountsPreserved=JSON.stringify(beforeCounts)===JSON.stringify(afterCounts);
    result={schemaVersion:1,startedFromBackupFingerprint:summary.databaseArtifactFingerprint,isolated:true,sqlOnly:true,appStarted:false,sourceWritableHandleOpened:false,websiteLegacyCredentialsDisabled,websiteAuthChanges:changes,operationalPairingStatePreserved,operationalCredentialMaterialUnchangedByPolicy:true,businessContentPreservedByCopyAndSqlAuthorizer:true,mutationAllowlist:{local_users:['password_hash'],local_sessions:['token_hash','expires_at'],api_keys:['token_hash','status','revoked_at']},operationalPolicy:'No UPDATE on operational/device/platform tables is authorized. Snapshot state only; latest revocation ledger required before live use.',tableCountsPreserved,schemaPreserved:beforeSchema===afterSchema,administratorStableIdsPreserved:JSON.stringify(adminIds)===JSON.stringify(context.adminIds),integrity:quickIntegrity(db),objectsVerified:objectRestore.verified,objectRestore,liveRestoreReady:false,pending:['independent-source-and-batch-review','unknown-ownership-and-cascades','latest-operational-revocation-ledger-before-any-live-use','central-collaboration-preservation-review'],centralIdentityOperations:[],productionMutations:0,completedAt:now()};
    if(!objectRestore.verified||!tableCountsPreserved||!websiteLegacyCredentialsDisabled||!operationalPairingStatePreserved||!result.schemaPreserved||!result.administratorStableIdsPreserved||!result.integrity.ok)throw new Error('SQL-only isolated restore invariant failed');
  }finally{db.close();}
  json(path.join(directory,'isolated-restore-evidence.json'),result);return result;
}
