import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {hashProtectedFile} from './server-snapshot.mjs';
import {fingerprintConsistentSnapshot} from './snapshot-fingerprint.mjs';
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const issuedExtensions=new WeakSet();
// server-snapshot uses plain string hashing for relative path identifiers.
const pathDigest=value=>crypto.createHash('sha256').update(value).digest('hex');
function noLinks(file){let current=path.resolve(file);while(true){if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw new Error('Symbolic paths are forbidden');const parent=path.dirname(current);if(current===parent)break;current=parent;}}
const same=(a,b)=>path.relative(a,b)==='';
const within=(a,b)=>{const value=path.relative(a,b);return value!==''&&!value.startsWith('..')&&!path.isAbsolute(value);};
/** Add all-store coverage to an existing closed artifact without rewriting it. */
export function extendClosedSnapshotObjectCoverage({directory,objectRoot,expectedArtifactFingerprint}={}){
  if(!path.isAbsolute(directory||'')||!path.isAbsolute(objectRoot||''))throw new TypeError('Explicit private snapshot and object source paths are required');
  noLinks(directory);noLinks(objectRoot);
  const privatePath=fs.realpathSync(directory),sourcePath=fs.realpathSync(objectRoot);
  if(same(privatePath,sourcePath)||within(privatePath,sourcePath)||within(sourcePath,privatePath))throw new Error('Object source and private snapshot must be disjoint');
  const mode=fs.statSync(privatePath);
  if(process.platform!=='win32'&&((mode.mode&0o077)!==0||mode.uid!==process.getuid()))throw new Error('Restricted snapshot directory policy required');
  const summary=JSON.parse(fs.readFileSync(path.join(privatePath,'snapshot-summary.json'),'utf8'));
  const database=path.join(privatePath,'source.snapshot.sqlite');noLinks(database);
  if(hashProtectedFile(database)!==expectedArtifactFingerprint||summary.databaseArtifactFingerprint!==expectedArtifactFingerprint)throw new Error('Closed snapshot fingerprint mismatch');
  const target=path.join(privatePath,'object-store-extension-v2');if(fs.existsSync(target))throw new Error('All-store extension already exists; never overwrite evidence');
  fs.mkdirSync(target,{mode:0o700});
  const records=[],mapping=[];let links=0,changed=0;
  function walk(folder){for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
    const file=path.join(folder,entry.name);if(entry.isSymbolicLink()){links++;continue;}if(entry.isDirectory()){walk(file);continue;}if(!entry.isFile())continue;
    const relativePath=path.relative(sourcePath,file).split(path.sep).join('/'),relativePathDigest=pathDigest(relativePath),before=hashProtectedFile(file),destination=path.join(target,relativePathDigest);
    fs.copyFileSync(file,destination,fs.constants.COPYFILE_EXCL);fs.chmodSync(destination,0o600);
    const copied=hashProtectedFile(destination),after=hashProtectedFile(file);if(before!==copied||before!==after)changed++;
    const size=fs.statSync(destination).size;records.push({relativePathDigest,size,checksum:copied});mapping.push({relativePath,artifact:relativePathDigest,size,checksum:copied});
  }}
  walk(sourcePath);records.sort((a,b)=>a.relativePathDigest.localeCompare(b.relativePathDigest));
  const objectStoreFingerprint=digest(records),matchesOriginalCaptureStore=objectStoreFingerprint===summary.objects.storeMetadataFingerprint;
  const sourceFingerprint=fingerprintConsistentSnapshot({databaseArtifactFingerprint:expectedArtifactFingerprint,objectReferenceFingerprint:summary.objects.objectReferenceFingerprint,objectContentFingerprint:summary.objects.objectContentFingerprint,objectStoreFingerprint});
  const complete=summary.sourceFingerprintComplete&&matchesOriginalCaptureStore&&!links&&!changed;
  const result={schemaVersion:2,sourceFingerprint,sourceFingerprintScope:'Closed database SHA256, SQL referenced-object linkage/content digests, and entire object-store path/size/content digest including unreferenced objects.',sourceFingerprintComplete:complete,backupObjectScopeComplete:complete,originalSourceFingerprint:summary.sourceFingerprint,closedDatabaseArtifactFingerprint:expectedArtifactFingerprint,objectStoreFingerprint,objectRestoreMapFingerprint:digest(mapping),matchesOriginalCaptureStore,copiedFiles:records.length,copiedBytes:records.reduce((sum,row)=>sum+row.size,0),linksSkipped:links,changedDuringCopy:changed,unreferencedFilesRemainPending:summary.objects.unreferencedStoreFiles,sourceDatabaseRebacked:false,closedArtifactHashUnchanged:true,rawObjectPathsAndBytesOutput:false,privateDirectory:target,productionMutations:0,pending:['independent-source-review','unreferenced-object-ownership','latest-operational-revocation-ledger'],capturedAt:new Date().toISOString()};
  fs.writeFileSync(path.join(target,'private-restore-object-map.json'),JSON.stringify(mapping),{flag:'wx',mode:0o600});
  fs.writeFileSync(path.join(target,'summary.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  issuedExtensions.add(result);return Object.freeze(result);
}

export function verifyExtendedObjectRestore(extension){
  if(!extension||!issuedExtensions.has(extension)||!extension.sourceFingerprintComplete)throw new Error('An issued complete all-store extension is required');
  const directory=extension.privateDirectory,mapFile=path.join(directory,'private-restore-object-map.json');noLinks(mapFile);
  const mapping=JSON.parse(fs.readFileSync(mapFile,'utf8'));
  if(digest(mapping)!==extension.objectRestoreMapFingerprint)throw new Error('Private object restore map fingerprint mismatch');
  const targetRoot=path.join(path.dirname(directory),'isolated.objects-v2');if(fs.existsSync(targetRoot))throw new Error('Isolated object destination exists');
  fs.mkdirSync(targetRoot,{mode:0o700});let files=0;
  for(const record of mapping){
    if(typeof record.relativePath!=='string'||record.relativePath.includes('\\')||record.relativePath.includes('\0')||record.relativePath.split('/').some(value=>!value||value==='.'||value==='..'||value.includes(':'))||!(/^[a-f0-9]{64}$/).test(record.artifact)||!(/^[a-f0-9]{64}$/).test(record.checksum))throw new Error('Invalid object restore path');
    const source=path.join(directory,record.artifact),target=path.resolve(targetRoot,...record.relativePath.split('/'));noLinks(source);
    if(!within(targetRoot,target)||!fs.lstatSync(source).isFile()||fs.statSync(source).size!==record.size||hashProtectedFile(source)!==record.checksum)throw new Error('Object artifact fingerprint mismatch');
    fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);fs.chmodSync(target,0o600);
    if(hashProtectedFile(target)!==record.checksum)throw new Error('Isolated object fingerprint mismatch');files++;
  }
  const closed=path.join(path.dirname(directory),'source.snapshot.sqlite');
  if(hashProtectedFile(closed)!==extension.closedDatabaseArtifactFingerprint)throw new Error('Closed database changed during object restore');
  const result={schemaVersion:2,isolated:true,appStarted:false,objectsVerified:files===extension.copiedFiles,files,bytes:extension.copiedBytes,objectRestoreMapFingerprint:extension.objectRestoreMapFingerprint,sourceFingerprint:extension.sourceFingerprint,closedDatabaseArtifactFingerprint:extension.closedDatabaseArtifactFingerprint,closedDatabaseUnchanged:true,productionMutations:0,liveRestoreReady:false,latestOperationalRevocationLedger:'pending',completedAt:new Date().toISOString()};
  fs.writeFileSync(path.join(directory,'isolated-object-restore-evidence.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});return result;
}
