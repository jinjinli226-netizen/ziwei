import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync,backup} from 'node:sqlite';
import {canonicalDigest} from './r01-proof-provider.mjs';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const equal=(a,b)=>canonicalDigest(a)===canonicalDigest(b);
function plain(file){
  if(!path.isAbsolute(file)||process.platform!=='win32'&&/^[a-z]:|^\\\\/i.test(file))fail('OPS_ABSOLUTE_PATH_REQUIRED');
  const absolute=path.resolve(file);let cursor=absolute;
  while(true){if(fs.lstatSync(cursor).isSymbolicLink())fail('OPS_PATH_LINKED');const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;}
  if(fs.realpathSync.native(absolute).toLowerCase()!==absolute.toLowerCase())fail('OPS_PATH_REDIRECTED');
  return absolute;
}
const inside=(root,file)=>{const relative=path.relative(root,file);return relative!==''&&relative!=='..'&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative);};
function relativePath(value){if(typeof value!=='string'||!value||path.isAbsolute(value)||/^[a-z]:|^\\\\/i.test(value)||value.split(/[\\/]/).some(part=>!part||part==='.'||part==='..'))fail('OPS_SOURCE_RELATIVE_PATH_INVALID');return value;}
function inventory(root,prefix=''){
  const rows=[];
  for(const entry of fs.readdirSync(path.join(root,prefix),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    const relative=path.join(prefix,entry.name),file=plain(path.join(root,relative));
    if(entry.isDirectory())rows.push({path:relative,kind:'directory'},...inventory(root,relative));
    else if(entry.isFile())rows.push({path:relative,kind:'file',bytes:fs.statSync(file).size,sha256:sha(file)});
    else fail('OPS_SOURCE_TYPE_UNSUPPORTED');
  }
  return rows;
}
const quote=value=>'"'+value.replaceAll('"','""')+'"';
function dbProjection(db){
  if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)fail('OPS_SQLITE_INTEGRITY_FAILED');
  const tables=[];
  for(const row of db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()){
    const keys=db.prepare(`PRAGMA table_info(${quote(row.name)})`).all().filter(column=>column.pk).sort((a,b)=>a.pk-b.pk).map(column=>column.name);
    const statement=db.prepare(`SELECT * FROM ${quote(row.name)}`);statement.setReadBigInts(true);
    const rows=statement.all().map(value=>Object.fromEntries(Object.entries(value).map(([key,item])=>[key,item instanceof Uint8Array?{blobSha256:crypto.createHash('sha256').update(item).digest('hex')}:typeof item==='bigint'?{integer:item.toString()}:item])));
    tables.push({name:row.name,count:rows.length,schemaDigest:canonicalDigest(row.sql),primaryKeys:keys,primaryKeysDigest:canonicalDigest(rows.map(value=>canonicalDigest(Object.fromEntries(keys.map(key=>[key,value[key]])))).sort()),allRowsDigest:canonicalDigest(rows.map(canonicalDigest).sort())});
  }
  return {tables,digest:canonicalDigest(tables),integrity:'ok',foreignKeyErrors:0};
}
function writeNew(file,value){fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});}
function copyInventory(source,target,rows){fs.mkdirSync(target,{recursive:true,mode:0o700});for(const row of rows){const file=path.join(target,row.path);if(row.kind==='directory')fs.mkdirSync(file,{recursive:true,mode:0o700});else{fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.copyFileSync(plain(path.join(source,row.path)),file,fs.constants.COPYFILE_EXCL);fs.chmodSync(file,0o600);if(sha(file)!==row.sha256)fail('OPS_BACKUP_COPY_CHANGED');}}}

/** Owning-host only. The stopped proof must already have been independently
 * verified; counters, caller boolean fields and a backup file alone are not
 * proof. This routine never restores a live DB or starts a business process.
 * Windows production use requires a verified native worker/ACL contract.
 */
export async function backupAndRestoreRead({privateRoot,outputDirectory,operationId,specHash,databaseIdentity,sourceRoots,stoppedProof,verifyStoppedProof,recheckStoppedProof}={}){
  const immutable=value=>{canonicalDigest(value);const result=JSON.parse(JSON.stringify(value));const freeze=item=>{if(item&&typeof item==='object'){Object.values(item).forEach(freeze);Object.freeze(item);}return item;};return freeze(result);};
  databaseIdentity=immutable(databaseIdentity);sourceRoots=immutable(sourceRoots);stoppedProof=immutable(stoppedProof);
  const root=plain(privateRoot),output=path.resolve(outputDirectory||'');
  if(!inside(root,output))fail('OPS_PRIVATE_OUTPUT_REQUIRED');
  plain(path.dirname(output));if(fs.existsSync(output))fail('OPS_OUTPUT_ALREADY_EXISTS');
  if(!/^[-a-zA-Z0-9_]{1,128}$/.test(operationId||'')||!/^[a-f0-9]{64}$/.test(specHash||'')||!databaseIdentity)fail('OPS_BACKUP_BINDING_INVALID');
  if(!Array.isArray(sourceRoots)||!sourceRoots.length||new Set(sourceRoots.map(value=>value.id)).size!==sourceRoots.length)fail('OPS_SOURCE_ROOTS_INVALID');
  const ids=sourceRoots.map(value=>value.id).sort();
  if(stoppedProof?.allWritersStopped!==true||stoppedProof.nativeTreesConfirmed!==true||stoppedProof.namespaceVerified!==true)fail('OPS_WRITERS_NOT_PROVEN_STOPPED');
  if(stoppedProof.operationId!==operationId||stoppedProof.specHash!==specHash||!equal(stoppedProof.databaseIdentity,databaseIdentity)||!equal(stoppedProof.sourceRootIds,ids))fail('OPS_STOP_PROOF_BINDING_INVALID');
  if(typeof verifyStoppedProof!=='function'||typeof recheckStoppedProof!=='function'||await verifyStoppedProof(stoppedProof)!==true)fail('OPS_STOP_PROOF_REJECTED');
  const sources=[];
  for(const source of sourceRoots){
    if(!/^[-a-zA-Z0-9_]{1,64}$/.test(source.id||'')||!Array.isArray(source.databases)||!Array.isArray(source.requiredFiles))fail('OPS_SOURCE_ROOTS_INVALID');
    let absolute;try{absolute=plain(source.path);}catch(error){if(error.code==='ENOENT')fail('OPS_REQUIRED_SOURCE_MISSING');throw error;}
    if(!fs.statSync(absolute).isDirectory()||absolute===root||inside(absolute,output)||absolute===output)fail('OPS_SOURCE_SCOPE_INVALID');
    for(const relative of [...source.requiredFiles,...source.databases]){relativePath(relative);if(!fs.existsSync(path.join(absolute,relative)))fail('OPS_REQUIRED_SOURCE_MISSING');plain(path.join(absolute,relative));}
    const rows=inventory(absolute),databaseNames=new Set(source.databases.map(relativePath));
    if(rows.some(row=>row.kind==='file'&&/\.(?:sqlite|db)$/i.test(row.path)&&!databaseNames.has(row.path)))fail('OPS_DATABASE_COVERAGE_INCOMPLETE');
    sources.push({id:source.id,path:absolute,databases:[...databaseNames],rows});
  }
  const actualBindings=sources.map(source=>({id:source.id,canonicalRoot:source.path,databases:[...source.databases].sort(),requiredFiles:[...sourceRoots.find(item=>item.id===source.id).requiredFiles].sort()})).sort((a,b)=>a.id.localeCompare(b.id));
  const expectedBindings=stoppedProof.sourceRoots;
  if(!Array.isArray(expectedBindings)||!equal(actualBindings,expectedBindings.map(source=>({id:source.id,canonicalRoot:source.canonicalRoot,databases:[...(source.databases||[])].sort(),requiredFiles:[...(source.requiredFiles||[])].sort()})).sort((a,b)=>a.id.localeCompare(b.id))))fail('OPS_STOP_PROOF_SOURCE_BINDING_INVALID');
  fs.mkdirSync(output,{mode:0o700});
  const startedAt=new Date().toISOString(),snapshots=[];
  try{
    writeNew(path.join(output,'request.json'),{schemaVersion:1,operationId,specHash,databaseIdentity,sourceRootIds:ids,stopProofDigest:canonicalDigest(stoppedProof),startedAt});
    const store=path.join(output,'backup'),restore=path.join(output,'restore-read');fs.mkdirSync(store,{mode:0o700});fs.mkdirSync(restore,{mode:0o700});
    fs.mkdirSync(path.join(store,'sqlite'),{mode:0o700});fs.mkdirSync(path.join(restore,'sqlite'),{mode:0o700});
    for(const source of sources){
      const target=path.join(store,'sources',source.id);copyInventory(source.path,target,source.rows);
      if(!equal(inventory(target),source.rows))fail('OPS_BACKUP_COPY_CHANGED');
      copyInventory(target,path.join(restore,'sources',source.id),source.rows);
      for(const relative of source.databases){
        const name=source.id+'-'+crypto.createHash('sha256').update(relative).digest('hex')+'.sqlite';
        const snapshotPath=path.join(store,'sqlite',name),restoredPath=path.join(restore,'sqlite',name);
        const db=new DatabaseSync(plain(path.join(source.path,relative)),{readOnly:true});db.exec('PRAGMA query_only=ON');
        let projection;try{projection=dbProjection(db);await backup(db,snapshotPath);}finally{db.close();}
        fs.chmodSync(snapshotPath,0o600);fs.copyFileSync(snapshotPath,restoredPath,fs.constants.COPYFILE_EXCL);fs.chmodSync(restoredPath,0o600);
        const restored=new DatabaseSync(restoredPath,{readOnly:true});let actual;try{restored.exec('PRAGMA query_only=ON');actual=dbProjection(restored);}finally{restored.close();}
        if(!equal(projection,actual)||sha(snapshotPath)!==sha(restoredPath))fail('OPS_RESTORE_READ_MISMATCH');
        snapshots.push({rootId:source.id,relativePath:relative,snapshotPath,restoredPath,sha256:sha(snapshotPath),projectionDigest:projection.digest,tableCount:projection.tables.length,integrity:'ok',foreignKeyErrors:0});
      }
    }
    if(await recheckStoppedProof(stoppedProof)!==true)fail('OPS_STOP_RECHECK_REJECTED');
    for(const source of sources)if(!equal(inventory(source.path),source.rows))fail('OPS_SOURCE_CHANGED');
    const manifest={schemaVersion:1,operationId,specHash,databaseIdentity,sourceRootIds:ids,sourceInventories:sources.map(({id,path:sourcePath,rows})=>({id,path:sourcePath,rows})),databaseSnapshots:snapshots,restoreDirectory:restore,stopProofDigest:canonicalDigest(stoppedProof),originalSourceStable:true,backupRestoreReadVerified:true,startedAt,completedAt:new Date().toISOString(),businessProcessesStarted:0,wholeLiveDatabaseRestores:0,productionAcceptance:false};
    writeNew(path.join(output,'manifest.json'),manifest);
    return {...manifest,manifestPath:path.join(output,'manifest.json'),manifestDigest:canonicalDigest(manifest)};
  }catch(error){writeNew(path.join(output,'failure.json'),{operationId,specHash,code:/^OPS_[A-Z0-9_]+$/.test(error.code||'')?error.code:'OPS_BACKUP_FAILED',failedAt:new Date().toISOString(),originalSourcesRetained:true});throw error;}
}
