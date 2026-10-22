import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {PRESERVED_ADMIN_EMAIL, fingerprintInventory} from './vendor/cleanup-manifest.mjs';
import {TABLE_KINDS, INFRASTRUCTURE_TABLES, SAFE_COLUMNS, PRIVATE_IDENTIFIER_TABLES, SOFT_RELATIONS, OWNERSHIP_NOTES} from './catalog.mjs';

const quote = value => '"' + value.replaceAll('"','""') + '"';
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
export const metadataFingerprint = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');
const refKey = ref => JSON.stringify([ref.kind,ref.type,ref.id]);
const fileMetadata = file => {try {const stat=fs.statSync(file);return {size:stat.size,mtimeMs:stat.mtimeMs,device:String(stat.dev),inode:String(stat.ino)};} catch(error) {if(error.code==='ENOENT')return null;throw error;}};
const safeRow = row => Object.fromEntries(Object.entries(row).map(([key,value]) => [key,typeof value==='bigint'?value.toString():value]));

/** No auth/repository startup, no content/credential values, no whole database hash. */
export function probeWorkspaceSource({databasePath, evidenceRef = 'native-probe', maxRows = 50000, maxRowsPerTable = maxRows} = {}) {
  if (!path.isAbsolute(databasePath || '')) throw new TypeError('An explicit absolute SQLite path is required');
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 100000) throw new TypeError('Invalid bounded inventory limit');
  if (!Number.isSafeInteger(maxRowsPerTable) || maxRowsPerTable < 1 || maxRowsPerTable > maxRows) throw new TypeError('Invalid per-table projection limit');
  const resolved = fs.realpathSync(databasePath);
  const before = {database:fileMetadata(resolved),wal:fileMetadata(resolved+'-wal')};
  if (!before.database || !fs.statSync(resolved).isFile()) throw new Error('Source is not a regular SQLite file');
  const blockers = new Set(['independent-source-baseline-not-verified','content-fingerprint-not-captured']);
  const tables = [], resources = [], relationships = [];
  let db;
  try {
    db = new DatabaseSync(resolved, {readOnly:true});
    db.exec('PRAGMA query_only=ON');
    db.exec('BEGIN');
    const queryOnly = db.prepare('PRAGMA query_only').get().query_only === 1;
    if (!queryOnly) throw new Error('SQLite query_only was not enabled');
    const schemaObjects = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_autoindex_%' ORDER BY type,name").all().map(row => ({type:row.type,name:row.name,table:row.tbl_name,definitionFingerprint:metadataFingerprint(row.sql || '')}));
    const userVersion = db.prepare('PRAGMA user_version').get().user_version;
    const names = schemaObjects.filter(row => row.type === 'table').map(row => row.name).sort();
    let remaining = maxRows;
    for (const name of names) {
      const columns = db.prepare('PRAGMA table_info(' + quote(name) + ')').all().map(column => ({name:column.name,type:column.type,notNull:Boolean(column.notnull),primaryKeyOrder:column.pk}));
      const foreignKeys = db.prepare('PRAGMA foreign_key_list(' + quote(name) + ')').all().map(key => ({id:key.id,sequence:key.seq,table:key.table,from:key.from,to:key.to || null,onDelete:key.on_delete,onUpdate:key.on_update}));
      const count = db.prepare('SELECT COUNT(*) AS count FROM ' + quote(name)).get().count;
      const infrastructure = INFRASTRUCTURE_TABLES.has(name) || name.startsWith('sqlite_');
      const privateId = PRIVATE_IDENTIFIER_TABLES.has(name);
      const known = Boolean(TABLE_KINDS[name]);
      const selectedColumns = privateId || infrastructure || !known ? [] : columns.filter(column => SAFE_COLUMNS.has(column.name)).map(column => column.name);
      const primaryKey = columns.filter(column => column.primaryKeyOrder).sort((a,b) => a.primaryKeyOrder-b.primaryKeyOrder).map(column => column.name);
      const enumerable = primaryKey.length > 0 && primaryKey.every(key => selectedColumns.includes(key)) && count <= remaining && count <= maxRowsPerTable;
      const table = {name,count,columns,foreignKeys,selectedColumns,primaryKey,kind:TABLE_KINDS[name] || null,coverage:infrastructure?'infrastructure':known&&enumerable?'enumerated':'unresolved',ownershipSource:OWNERSHIP_NOTES[name] || (known?'Only explicit stable owner/reference fields; never workspace-wide owner inheritance.':'Unknown native table; owner and cascade require source review.')};
      tables.push(table);
      if (table.coverage === 'unresolved') blockers.add('unclassified-or-unenumerated-table:' + name);
      if (!enumerable || infrastructure) continue;
      remaining -= count;
      const statement = db.prepare('SELECT ' + selectedColumns.map(quote).join(',') + ' FROM ' + quote(name) + ' ORDER BY ' + primaryKey.map(quote).join(','));
      statement.setReadBigInts(true);
      for (const value of statement.all()) {
        const values = safeRow(value);
        const tuple = primaryKey.map(key => values[key]);
        if (tuple.some(item => item === null || item === undefined || String(item).length > 512)) {blockers.add('invalid-stable-key:' + name);continue;}
        const id = tuple.length === 1 ? String(tuple[0]) : JSON.stringify(tuple.map(String));
        resources.push({ref:{kind:TABLE_KINDS[name] || 'business-resource',type:'sqlite:' + name,id},table:name,values,known,dependencies:[],cascadeTargets:[]});
      }
    }
    const loginTable = tables.find(table => table.name === 'local_users');
    let protectedIds = [];
    if (loginTable?.columns.some(column => column.name === 'email') && loginTable.columns.some(column => column.name === 'id')) protectedIds = db.prepare('SELECT id FROM local_users WHERE email = ? COLLATE NOCASE ORDER BY id').all(PRESERVED_ADMIN_EMAIL).map(row => String(row.id));
    else blockers.add('local-login-table-missing');
    if (protectedIds.length === 0) blockers.add('protected-administrator-not-resolved');
    if (protectedIds.length > 1) blockers.add('protected-email-conflict');
    const adminRefs = resources.filter(row => row.table === 'local_users' && protectedIds.includes(row.ref.id)).map(row => row.ref);
    const loginById = new Map(resources.filter(row => row.table === 'local_users').map(row => [row.ref.id,row.ref]));
    const protectedSet = new Set(protectedIds);
    const members = resources.filter(row => row.table === 'members');
    const workspaceMembers = new Map();
    for (const member of members) {
      const key = member.values.workspace_id;
      if (!workspaceMembers.has(key)) workspaceMembers.set(key,[]);
      workspaceMembers.get(key).push(member.values.user_id || null);
    }
    const targetIndexes = new Map();
    const findTargets = (table, column, value) => {
      const indexKey=JSON.stringify([table,column]);
      if(!targetIndexes.has(indexKey)){
        const index=new Map();
        for(const row of resources)if(row.table===table&&row.values[column]!==null&&row.values[column]!==undefined){const key=String(row.values[column]);if(!index.has(key))index.set(key,[]);index.get(key).push(row);}
        targetIndexes.set(indexKey,index);
      }
      return targetIndexes.get(indexKey).get(String(value))||[];
    };
    for (const row of resources) {
      const table = tables.find(table => table.name === row.table);
      const nativeKeys = new Set();
      for (const key of table.foreignKeys) {
        const value = row.values[key.from];
        const targetColumn = key.to || tables.find(target => target.name === key.table)?.primaryKey[0];
        if (value === undefined) {blockers.add('unprojected-foreign-key:' + row.table + ':' + key.from);continue;}
        nativeKeys.add(key.from);
        if (value === null || value === '') continue;
        const targets = findTargets(key.table,targetColumn,value);
        if (key.sequence !== 0 || table.foreignKeys.some(other => other.id === key.id && other.sequence !== 0)) blockers.add('composite-foreign-key-review:' + row.table);
        if (!targets.length) blockers.add('unresolved-foreign-key:' + row.table + ':' + key.from);
        for (const target of targets) {
          row.dependencies.push({target:target.ref,relation:'references',onTargetDelete:key.onDelete === 'NO ACTION' || key.onDelete === 'RESTRICT' || key.onDelete === 'CASCADE' || key.onDelete === 'SET NULL' ? 'blocks':'unknown',evidenceRefs:[evidenceRef + '#fk:' + row.table + ':' + key.from]});
          if (key.onDelete === 'CASCADE') target.cascadeTargets.push(row.ref);
          relationships.push({kind:'foreign-key',source:row.ref,target:target.ref,from:key.from,to:targetColumn,onDelete:key.onDelete});
        }
      }
      for (const [column,targetTable] of Object.entries(SOFT_RELATIONS)) {
        if (nativeKeys.has(column) || row.values[column] === null || row.values[column] === undefined || row.values[column] === '') continue;
        const targets = findTargets(targetTable,'id',row.values[column]);
        for (const target of targets) {
          const key = refKey(target.ref);
          if (!row.dependencies.some(value => refKey(value.target) === key)) row.dependencies.push({target:target.ref,relation:'references',onTargetDelete:'blocks',evidenceRefs:[evidenceRef + '#native-reference:' + row.table + ':' + column]});
          relationships.push({kind:'native-soft-reference',source:row.ref,target:target.ref,from:column,to:'id',onDelete:'manual-review'});
        }
      }
      const explicitOwner = row.table === 'local_users' ? row.ref.id : row.values.owner_user_id || (row.table === 'members' || row.table === 'local_sessions' ? row.values.user_id : null);
      const owner = explicitOwner ? loginById.get(String(explicitOwner)) : null;
      const memberIds = workspaceMembers.get(row.values.workspace_id) || [];
      const workspaceHasOther = memberIds.some(id => id && protectedSet.has(String(id))) && memberIds.some(id => !id || !protectedSet.has(String(id)));
      let classification = !row.known ? 'unknown' : row.table === 'skills' ? 'global' : !owner ? row.table === 'workspaces' ? 'shared' : memberIds.length ? 'shared':'unowned' : protectedSet.has(owner.id)?'preserved-admin':'other-login-account';
      // Explicitly owned objects in a shared tenant can still have a real owner.
      // Resources with several proven owner references are mixed; no admin reassignment.
      const linkedOwners = new Map(owner ? [[owner.id,owner]] : []);
      if (row.table === 'documents' && row.values.user_id && loginById.has(String(row.values.user_id))) linkedOwners.set(String(row.values.user_id),loginById.get(String(row.values.user_id)));
      if (linkedOwners.size > 1) classification = 'mixed';
      if (row.table === 'workspaces') {const ids=workspaceMembers.get(row.ref.id)||[];classification=ids.length>1||workspaceHasOther?'mixed':'shared';}
      row.ownership = {classification,loginAccountRefs:[...linkedOwners.values()],evidenceRefs:[evidenceRef + '#ownership:' + row.table]};
    }
    const objectStorage = {status:'pending-not-enumerated',referenceCount:0,tableCounts:[],policy:'Count only. No storage key values, object bytes or filesystem traversal. Shared content-addressed objects require independent reference inventory.'};
    for (const table of tables) if (['documents','document_versions','task_attachments'].includes(table.name) && table.columns.some(column => column.name === 'storage_key')) {
      const count = db.prepare('SELECT COUNT(*) AS count FROM ' + quote(table.name) + " WHERE storage_key IS NOT NULL AND storage_key<>''").get().count;
      objectStorage.referenceCount += count;
      objectStorage.tableCounts.push({table:table.name,count});
    }
    if (objectStorage.referenceCount) blockers.add('object-storage-references-unresolved');
    const triggers = schemaObjects.filter(row => row.type === 'trigger');
    if (triggers.length) blockers.add('trigger-effects-require-review');
    const after = {database:fileMetadata(resolved),wal:fileMetadata(resolved+'-wal')};
    if (canonical(before) !== canonical(after)) blockers.add('source-changed-during-probe');
    const administrator = {email:PRESERVED_ADMIN_EMAIL,accountResolution:protectedIds.length===1?'verified':'pending',loginAccountRefs:adminRefs,associatedResourceRefs:resources.filter(row => row.ref.kind !== 'login-account' && row.ownership.classification === 'preserved-admin').map(row => row.ref),evidenceRefs:[evidenceRef + '#protected-email-exact-lookup']};
    const stableIds = resources.map(row => row.ref);
    const inventoryFingerprint = fingerprintInventory(stableIds);
    const sourceVersion = 'sqlite-user-version:' + userVersion + ';schema:' + metadataFingerprint(schemaObjects);
    const snapshot = {scope:'explicit-local-file-safe-projection-v1',sourceVersion,fileIdentity:{before,after},tables,resources,relationships,administrator,objectStorage,schemaObjects};
    const sourceFingerprint = metadataFingerprint(snapshot);
    const metadataInventoryFingerprint = metadataFingerprint({sourceVersion,tables,resources,relationships,administrator,objectStorage,schemaObjects});
    db.exec('ROLLBACK');
    const completenessBlocked=[...blockers].some(value=>!['independent-source-baseline-not-verified','content-fingerprint-not-captured','protected-administrator-not-resolved','protected-email-conflict'].includes(value));
    return {schemaVersion:1,service:'workspace',capturedAt:new Date().toISOString(),databasePath:resolved,readOnly:true,queryOnly:true,transaction:'consistent-read-transaction',provenance:{authority:'unverified-local-candidate',productionVerified:false,codeBuildProvenance:'unknown; current checkout is not evidence of database release'},sourceVersion,sourceFingerprint,sourceFingerprintComplete:false,metadataInventoryFingerprint,inventoryFingerprint,complete:!completenessBlocked,administrator,stableIds,tables,resources,relationships,objectStorage,schemaObjects,fileIdentity:{before,after},blockers:[...blockers],fingerprintScope:'METADATA ONLY compatibility placeholder; no content-complete source baseline. Schema/IDs/ownership/relations/counts plus file metadata, excluding content and credential values. metadataInventoryFingerprint excludes changing file metadata.',centralIdentityOperations:[]};
  } finally {if(db){try{db.exec('ROLLBACK');}catch{}db.close();}}
}
