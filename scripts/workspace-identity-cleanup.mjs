import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {probeWorkspaceSource} from '../backend/identity-cleanup/probe.mjs';
import {prepareCleanupManifest} from '../backend/identity-cleanup/manifest.mjs';

const evidenceRoot='D:/AINavtie/ops/cli-standard/identity-readiness/workspace';
const usage='Usage: node scripts/workspace-identity-cleanup.mjs probe|prepare --db <explicit-absolute-SQLite-path> [--label <safe-label>]\nRead-only preparation only. Outputs go to the controlled workspace identity-readiness evidence directory. No apply/delete/restore/production-write command exists.\n';
const writeExclusive=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{encoding:'utf8',flag:'wx',mode:0o600});
const countBy=(rows,select)=>rows.reduce((counts,row)=>{const key=select(row);counts[key]=(counts[key]||0)+1;return counts;},{});

export function writePreparationEvidence({databasePath,label='candidate'}={}){
  if(!/^[A-Za-z0-9_-]{1,64}$/.test(label))throw new TypeError('Evidence label must use letters, digits, hyphens or underscores');
  const runId=new Date().toISOString().replaceAll(':','-').replaceAll('.','-')+'-'+crypto.randomBytes(3).toString('hex');
  const directory=path.join(evidenceRoot,label,runId);
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  fs.chmodSync(directory,0o700);
  const probe=probeWorkspaceSource({databasePath,evidenceRef:label+'/'+runId+'/probe.json'});
  const preparation=prepareCleanupManifest(probe);
  const dryRun={schemaVersion:1,status:preparation.status,dryRun:true,productionVerified:false,sourceVersion:probe.sourceVersion,sourceFingerprint:probe.sourceFingerprint,sourceFingerprintComplete:probe.sourceFingerprintComplete,metadataInventoryFingerprint:probe.metadataInventoryFingerprint,fingerprintScope:probe.fingerprintScope,inventoryFingerprint:probe.inventoryFingerprint,tableCount:probe.tables.length,stableReferenceCount:probe.stableIds.length,tableCounts:probe.tables.map(table=>({table:table.name,count:table.count,kind:table.kind,coverage:table.coverage})),workspaces:probe.resources.filter(row=>row.table==='workspaces').length,loginAccounts:probe.resources.filter(row=>row.ref.kind==='login-account').length,protectedLoginMatches:probe.administrator.loginAccountRefs.length,administratorResolution:probe.administrator.accountResolution,dispositions:preparation.proposedManifest.batch.summary,ownershipCounts:countBy(probe.resources,row=>row.ownership.classification),kindCounts:countBy(probe.resources,row=>row.ref.kind),blockers:preparation.blockers,sharedValidation:preparation.validation,objectStorage:probe.objectStorage,sourceFileMetadata:probe.fileIdentity,centralIdentityOperations:[],backup:'not-created-for-real-source',restore:'fixture-only-not-a-real-source-restore',boundary:'Old local candidate is not verified production. No source rows, directories, credentials, pairings or central subjects were changed.'};
  writeExclusive(path.join(directory,'probe.json'),probe);
  writeExclusive(path.join(directory,'proposed-manifest.json'),preparation);
  writeExclusive(path.join(directory,'dry-run.json'),dryRun);
  return {status:preparation.status,dryRun:true,directory,sourceFingerprint:probe.sourceFingerprint,sourceFingerprintComplete:probe.sourceFingerprintComplete,metadataInventoryFingerprint:probe.metadataInventoryFingerprint,tableCount:probe.tables.length,stableReferenceCount:probe.stableIds.length,loginAccounts:dryRun.loginAccounts,protectedLoginMatches:dryRun.protectedLoginMatches,proposedDeletes:dryRun.dispositions.delete,validationStatus:preparation.validation.status};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const argv=process.argv.slice(2);
    if(argv.includes('--help')||argv.length===0){process.stdout.write(usage);}
    else{
      const action=argv.shift();
      if(!['probe','prepare'].includes(action))throw new TypeError('Only read-only probe or prepare is supported');
      const options={};
      for(let index=0;index<argv.length;index+=2){const flag=argv[index];if(!['--db','--label'].includes(flag)||!argv[index+1]||Object.hasOwn(options,flag))throw new TypeError('Invalid or duplicate preparation option');options[flag]=argv[index+1];}
      if(!path.isAbsolute(options['--db']||''))throw new TypeError('An explicit absolute database path is required');
      process.stdout.write(JSON.stringify(writePreparationEvidence({databasePath:options['--db'],label:options['--label']}))+'\n');
    }
  }catch(error){process.stderr.write(JSON.stringify({ok:false,code:error.code||'PREPARATION_ERROR',message:error instanceof TypeError?error.message:'Native source could not be safely prepared; no production mutation was attempted.'})+'\n');process.exitCode=2;}
}
