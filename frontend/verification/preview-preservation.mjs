// Consistent SQLite backup and metadata proof; no secret or message body output.
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync,backup} from 'node:sqlite';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {previewStateDirectory} from '../preview/state-root.mjs';
const root=path.resolve(import.meta.dirname,'../..'),directory=previewStateDirectory(root),mode=process.argv[2];
assert.ok(process.env.ZIWEI_PREVIEW_DATA_ROOT,'Pass the verified owned state root explicitly');
const evidence=path.join(root,'.local/e03-native-preview-evidence');fs.mkdirSync(evidence,{recursive:true});const file=path.join(evidence,'preservation.json');
const db=new DatabaseSync(path.join(directory,'data/preview.sqlite'),{readOnly:true});
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
try{
  const rows=table=>db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
  const savedTables=['employees','conversations','conversation_messages','local_users','workspace_members'];
  if(mode==='capture'){
    const tables={};for(const table of savedTables){if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name=? AND type='table'").get(table))continue;tables[table]=rows(table).map(row=>({id:row.id,digest:digest(row)}));}
    const backups=path.join(directory,'backups');fs.mkdirSync(backups,{recursive:true});const backupFile=path.join(backups,`before-native-${Date.now()}.sqlite`);await backup(db,backupFile);
    fs.writeFileSync(file,JSON.stringify({capturedAt:new Date().toISOString(),stateRoot:directory,backup:backupFile,tables,opaqueKeyPreserved:fs.existsSync(path.join(directory,'../employee-env.key'))},null,2));console.log(JSON.stringify({captured:true,backup:backupFile,tables:Object.fromEntries(Object.entries(tables).map(([name,items])=>[name,items.length]))}));
  }else if(mode==='verify'){
    const saved=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(saved.stateRoot,directory);const results=[];
    const original=new DatabaseSync(saved.backup,{readOnly:true});
    try{for(const [table,items] of Object.entries(saved.tables)){const current=new Map(rows(table).map(row=>[row.id,row]));for(const item of items){assert.ok(current.has(item.id),`${table} ${item.id} must remain`);if(table==='local_users'){const before=original.prepare('SELECT * FROM local_users WHERE id=?').get(item.id),after={...current.get(item.id)};assert.equal(digest(before),item.digest);delete before.last_login_at;delete after.last_login_at;assert.equal(digest(after),digest(before),'Account and authentication fields must remain; login may update its timestamp');}else assert.equal(digest(current.get(item.id)),item.digest,`${table} ${item.id} content must remain unchanged`);}results.push({table,preserved:items.length,...(table==='local_users'?{allowedMetadataChange:'last_login_at'}:{})});}}finally{original.close();}
    saved.verifiedAt=new Date().toISOString();saved.results=results;fs.writeFileSync(file,JSON.stringify(saved,null,2));console.log(JSON.stringify({preserved:true,results}));
  }else throw new Error('Use capture or verify');
}finally{db.close();}
