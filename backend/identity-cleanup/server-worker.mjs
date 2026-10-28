// Explicit 186 Workspace preparation worker. Never import backend app/auth/repository.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {captureReadOnlySnapshot,verifyIsolatedSnapshot,hashProtectedFile} from './server-snapshot.mjs';
import {probeWorkspaceSource} from './probe.mjs';
import {prepareCleanupManifest} from './manifest.mjs';

const unit='ziwei-workspace-api.service';
const databasePath='/opt/ziwei/data/ziwei.sqlite';
const objectRoot='/opt/ziwei/data/objects';
const privateRoot='/var/lib/ziwei-workspace-identity-prep';
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
const group=rows=>rows.reduce((result,row)=>{result[row.ownership.classification]=(result[row.ownership.classification]||0)+1;return result;},{});
function provenance(){
  const pid=Number(execFileSync('systemctl',['show',unit,'--property=MainPID','--value'],{encoding:'utf8'}).trim());
  if(!Number.isSafeInteger(pid)||pid<2)throw new Error('Observed active Workspace PID is required');
  const cwd=fs.readlinkSync('/proc/'+pid+'/cwd');
  const safeRuntimeConfiguration={};
  for(const item of fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0')){
    const separator=item.indexOf('=');const key=item.slice(0,separator);
    if(['ZIWEI_DB_FILE','ZIWEI_OBJECT_STORE_DIR','NODE_ENV','API_HOST','API_PORT'].includes(key))safeRuntimeConfiguration[key]=item.slice(separator+1);
  }
  if(safeRuntimeConfiguration.ZIWEI_DB_FILE!==databasePath||safeRuntimeConfiguration.ZIWEI_OBJECT_STORE_DIR!==objectRoot||safeRuntimeConfiguration.NODE_ENV!=='production')throw new Error('Observed Workspace runtime paths must match the explicit target');
  const fds=fs.readdirSync('/proc/'+pid+'/fd').flatMap(name=>{try{return [fs.readlinkSync('/proc/'+pid+'/fd/'+name)];}catch{return [];}});
  if(!fds.includes(databasePath)||!fds.includes(databasePath+'-wal'))throw new Error('Observed process must hold the explicit database and WAL');
  const sourceCodeHashes=Object.fromEntries(['backend/app.mjs','backend/db.mjs','backend/auth.mjs','backend/repository.mjs','backend/storage.mjs','package.json'].map(name=>[name,hashProtectedFile(path.join(cwd,name))]));
  return {observedAt:new Date().toISOString(),authority:'observed-systemd-pid-runtime-config-fd-and-deployed-file-hashes',unit,pid,cwd,executable:fs.readlinkSync('/proc/'+pid+'/exe'),safeRuntimeConfiguration,sourceCodeHashes,gitCommit:'not-authoritative-for-production-overlay',sharedValidatorTrustedContextProvided:false};
}

export async function runServerPreparation(){
  if(process.platform!=='linux'||process.getuid?.()!==0)throw new Error('This exact server worker requires the reviewed root-only Linux environment');
  process.umask(0o077);
  if(fs.existsSync(privateRoot))for(const entry of fs.readdirSync(privateRoot,{withFileTypes:true}))if(entry.isDirectory()&&entry.name.startsWith('snapshot-')&&fs.existsSync(path.join(privateRoot,entry.name,'source.snapshot.sqlite')))throw new Error('An existing snapshot requires independent inspection; this worker never repeats a large backup automatically');
  const sourceProvenance=provenance();
  const capture=await captureReadOnlySnapshot({databasePath,objectRoot,privateRoot,provenance:sourceProvenance});
  const afterProvenance=provenance();
  write(path.join(capture.directory,'provenance-after-capture.json'),afterProvenance);
  const restored=await verifyIsolatedSnapshot(capture);
  const probe=probeWorkspaceSource({databasePath:capture.artifactPath,evidenceRef:'protected-server-snapshot/probe.json',maxRows:100000,maxRowsPerTable:5000});
  probe.sourceFingerprint=capture.summary.sourceFingerprint;
  probe.sourceFingerprintComplete=capture.summary.sourceFingerprintComplete;
  probe.fingerprintScope=capture.summary.fingerprintScope;
  probe.provenance={authority:'observed-production-process-bound-consistent-backup',productionVerified:true,independentSourceReviewStillRequired:true,source:sourceProvenance,after:afterProvenance};
  if(probe.sourceFingerprintComplete)probe.blockers=probe.blockers.filter(value=>value!=='content-fingerprint-not-captured'&&value!=='object-storage-references-unresolved');
  probe.objectStorage={...capture.summary.objects,status:probe.sourceFingerprintComplete?'referenced-objects-verified':'pending-object-content'};
  if(sourceProvenance.pid!==afterProvenance.pid||sourceProvenance.cwd!==afterProvenance.cwd||JSON.stringify(sourceProvenance.sourceCodeHashes)!==JSON.stringify(afterProvenance.sourceCodeHashes))probe.blockers.push('running-source-changed-during-capture');
  const backupEvidence={status:'verified',evidenceRef:'protected-server-snapshot/snapshot-summary.json',artifactFingerprint:capture.summary.databaseArtifactFingerprint,sourceFingerprint:capture.summary.sourceFingerprint,consistencyEvidenceRef:'protected-server-snapshot/node-sqlite-backup-pinned-read-transaction',accessPolicyRef:'protected-server-snapshot/root-0700-files-0600',retentionPolicyRef:'protected-server-snapshot/7-day-review-no-auto-purge'};
  const restoreEvidence={status:'verified',evidenceRef:'protected-server-snapshot/isolated-restore-evidence.json',backupArtifactFingerprint:capture.summary.databaseArtifactFingerprint,isolated:true,verifiedInventoryFingerprint:probe.inventoryFingerprint,administratorPreserved:restored.administratorStableIdsPreserved,collaborationPreserved:null};
  const proposal=prepareCleanupManifest(probe,{backupEvidence,restoreEvidence});
  write(path.join(capture.directory,'probe.json'),probe);
  write(path.join(capture.directory,'proposed-manifest.json'),proposal);
  const excludedTables=probe.tables.filter(table=>table.coverage==='unresolved').map(table=>({table:table.name,count:table.count,reason:table.count>5000?'large-table-safe-projection-is-partitioned-in-separate-native-artifact':table.kind?'stable-key-or-private-security-state-review':'unknown-native-table'}));
  const dryRun={schemaVersion:1,status:'pending_source_baseline',dryRun:true,productionSourceObserved:true,sourceFingerprint:capture.summary.sourceFingerprint,sourceFingerprintComplete:capture.summary.sourceFingerprintComplete,backupArtifactFingerprint:capture.summary.databaseArtifactFingerprint,metadataInventoryFingerprint:probe.metadataInventoryFingerprint,proposalInventoryFingerprint:probe.inventoryFingerprint,tableCount:capture.summary.tableCount,totalRows:capture.summary.totalRows,fullNativeProjectionCount:capture.summary.stableIdProjectionCount,proposedManifestProjectionCount:probe.stableIds.length,excludedTables,dispositions:proposal.proposedManifest.batch.summary,ownershipCounts:group(probe.resources),protectedAdministratorMatches:probe.administrator.loginAccountRefs.length,workspaceCount:probe.resources.filter(row=>row.table==='workspaces').length,loginAccountCount:probe.resources.filter(row=>row.table==='local_users').length,blockers:[...new Set([...capture.summary.blockers,...proposal.blockers])],validation:{status:proposal.validation.status,errors:proposal.validation.errors.map(row=>({code:row.code,path:row.path})),pending:proposal.validation.pending.map(row=>({code:row.code,path:row.path}))},restore:{...restored,restoredArtifactFingerprint:hashProtectedFile(path.join(capture.directory,'isolated.restore.sqlite'))},objects:capture.summary.objects,privateDirectory:capture.directory,serverFiles:{closedDatabase:'source.snapshot.sqlite',snapshotSummary:'snapshot-summary.json',proposedManifest:'proposed-manifest.json',restoreEvidence:'isolated-restore-evidence.json',fullSafeProjectionDirectory:'inventory'},accessPolicy:capture.summary.accessPolicy,retention:capture.summary.retention,centralIdentityOperations:[],xianyuScope:'excluded; no account/tenant/identity operations',liveRestoreReady:false,productionMutations:0};
  write(path.join(capture.directory,'dry-run-summary.json'),dryRun);
  const scriptDirectory=path.dirname(fileURLToPath(import.meta.url));
  write(path.join(capture.directory,'tool-source-hashes.json'),Object.fromEntries(['server-worker.mjs','server-snapshot.mjs','snapshot-fingerprint.mjs','catalog.mjs','probe.mjs','manifest.mjs','vendor/cleanup-manifest.mjs','vendor/cleanup-manifest.schema.json'].map(name=>[name,hashProtectedFile(path.join(scriptDirectory,name))])));
  return dryRun;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{process.stdout.write(JSON.stringify(await runServerPreparation())+'\n');}
  catch(error){process.stderr.write(JSON.stringify({ok:false,code:error.code||'SAFE_PREPARATION_FAILED',message:'Preparation stopped safely. Inspect root-only server evidence; no production write handle or business process was started.'})+'\n');process.exitCode=2;}
}
