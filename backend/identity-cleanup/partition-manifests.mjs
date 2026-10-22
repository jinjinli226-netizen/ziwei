import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {probeWorkspaceSource} from './probe.mjs';
import {TABLE_KINDS,SOFT_RELATIONS,INFRASTRUCTURE_TABLES,PRIVATE_IDENTIFIER_TABLES} from './catalog.mjs';
import {hashProtectedFile} from './server-snapshot.mjs';
import {prepareCleanupManifest} from './manifest.mjs';
import {fingerprintInventory,validateCleanupManifest} from './vendor/cleanup-manifest.mjs';

const quote=value=>'"'+value.replaceAll('"','""')+'"';
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const key=ref=>JSON.stringify([ref.kind,ref.type,ref.id]);
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});
const counts=rows=>rows.reduce((value,row)=>{value[row.code]=(value[row.code]||0)+1;return value;},{});

/** Partitions reference one already-closed artifact; no second backup or source write. */
export async function prepareSnapshotPartitions({databasePath,expectedArtifactFingerprint,sourceFingerprint,outputDirectory,partitionSize=1000,projectionThreshold=5000}={}){
  if(!path.isAbsolute(databasePath||'')||!path.isAbsolute(outputDirectory||'')||path.dirname(path.resolve(outputDirectory))!==path.dirname(fs.realpathSync(databasePath))||fs.lstatSync(databasePath).isSymbolicLink())throw new Error('An explicit closed artifact and sibling private output directory are required');
  if(!/^[a-f0-9]{64}$/.test(sourceFingerprint||'')||hashProtectedFile(databasePath)!==expectedArtifactFingerprint)throw new Error('Closed artifact fingerprint mismatch');
  if(!Number.isSafeInteger(partitionSize)||partitionSize<1||partitionSize>2000||!Number.isSafeInteger(projectionThreshold)||projectionThreshold<1||projectionThreshold>5000)throw new TypeError('Invalid bounded partition size');
  if(fs.existsSync(outputDirectory))throw new Error('Partition evidence already exists; never overwrite');
  fs.mkdirSync(outputDirectory,{mode:0o700});
  const probe=probeWorkspaceSource({databasePath,evidenceRef:'closed-artifact/probe',maxRows:100000,maxRowsPerTable:projectionThreshold});
  probe.sourceFingerprint=sourceFingerprint;probe.sourceFingerprintComplete=true;
  const tables=new Map(probe.tables.map(table=>[table.name,table]));
  const baseRows=new Map(probe.resources.map(row=>[key(row.ref),row]));
  const loginById=new Map(probe.resources.filter(row=>row.table==='local_users').map(row=>[row.ref.id,row.ref]));
  const adminIds=new Set(probe.administrator.loginAccountRefs.map(row=>row.id));
  const db=new DatabaseSync(databasePath,{readOnly:true});const partitions=[],primaryTableCounts=[],schemaAndCountOnlyTables=[];
  const dispositions={total:0,preserve:0,delete:0,pending:0};const validation={errors:0,statusCounts:{},errorsByCode:{},pendingByCode:{}};
  const collectionHash=crypto.createHash('sha256');let sequence=0;
  const protectedSchemaState=PRIVATE_IDENTIFIER_TABLES;
  const lookupStatements=new Map();
  function projectRow(table,values){
    const tuple=table.primaryKey.map(column=>values[column]);
    if(tuple.some(value=>value===undefined||value===null||String(value).length>512))throw new Error('Invalid safe stable key blocks partition');
    const id=tuple.length===1?String(tuple[0]):JSON.stringify(tuple.map(String));
    const ref={kind:table.kind,type:'sqlite:'+table.name,id};
    const ownerId=table.name==='local_users'?id:values.owner_user_id||(['members','local_sessions'].includes(table.name)?values.user_id:null);
    const owner=ownerId?loginById.get(String(ownerId)):null;
    const linkedOwners=new Map(owner?[[owner.id,owner]]:[]);
    if(table.name==='documents'&&values.user_id&&loginById.has(String(values.user_id)))linkedOwners.set(String(values.user_id),loginById.get(String(values.user_id)));
    let classification=table.name==='skills'?'global':owner?adminIds.has(owner.id)?'preserved-admin':'other-login-account':values.workspace_id?'shared':'unowned';
    if(linkedOwners.size>1)classification='mixed';
    if(table.name==='workspaces')classification='shared';
    return {ref,table:table.name,values,known:true,dependencies:[],cascadeTargets:[],ownership:{classification,loginAccountRefs:[...linkedOwners.values()],evidenceRefs:['closed-artifact#explicit-owner:'+table.name]}};
  }
  function lookup(tableName,column,value){
    const table=tables.get(tableName);
    if(!table||!table.kind||protectedSchemaState.has(tableName)||!table.selectedColumns.includes(column)||!table.primaryKey.every(key=>table.selectedColumns.includes(key)))return [];
    const statementKey=JSON.stringify([tableName,column]);
    if(!lookupStatements.has(statementKey))lookupStatements.set(statementKey,db.prepare('SELECT '+table.selectedColumns.map(quote).join(',')+' FROM '+quote(tableName)+' WHERE '+quote(column)+'=?'));
    return lookupStatements.get(statementKey).all(value).map(values=>baseRows.get(key(projectRow(table,values).ref))||projectRow(table,values));
  }
  function dependencies(row,table,rows,queue){
    const nativeColumns=new Set();
    const attach=(target,column,native)=>{
      if(!row.dependencies.some(value=>key(value.target)===key(target.ref)))row.dependencies.push({target:target.ref,relation:'references',onTargetDelete:'blocks',evidenceRefs:['closed-artifact#'+(native?'fk:':'native-soft-reference:')+table.name+':'+column]});
      if(!rows.has(key(target.ref))){rows.set(key(target.ref),structuredClone(target));queue.push(key(target.ref));}
    };
    for(const dependency of [...row.dependencies])if(!rows.has(key(dependency.target))){
      const targetTable=tables.get(dependency.target.type.replace(/^sqlite:/,''));
      const candidates=baseRows.has(key(dependency.target))?[baseRows.get(key(dependency.target))]:targetTable?.primaryKey.length===1?lookup(targetTable.name,targetTable.primaryKey[0],dependency.target.id):[];
      for(const target of candidates)if(key(target.ref)===key(dependency.target)){rows.set(key(target.ref),structuredClone(target));queue.push(key(target.ref));}
    }
    for(const fk of table.foreignKeys){
      nativeColumns.add(fk.from);const value=row.values[fk.from];if(value===null||value===undefined||value==='')continue;
      const targetColumn=fk.to||tables.get(fk.table)?.primaryKey[0];
      for(const target of lookup(fk.table,targetColumn,value))attach(target,fk.from,true);
    }
    for(const [column,targetTable] of Object.entries(SOFT_RELATIONS))if(!nativeColumns.has(column)&&row.values[column]!==null&&row.values[column]!==undefined&&row.values[column]!=='')for(const target of lookup(targetTable,'id',row.values[column]))attach(target,column,false);
  }
  function emit(primaryRows,label){
    const rows=new Map();
    for(const ref of [...probe.administrator.loginAccountRefs,...probe.administrator.associatedResourceRefs]){const row=baseRows.get(key(ref));if(row)rows.set(key(ref),structuredClone(row));}
    for(const row of primaryRows)rows.set(key(row.ref),structuredClone(row));
    const queue=[...rows.keys()],processed=new Set();
    while(queue.length){const id=queue.pop();if(processed.has(id))continue;processed.add(id);const row=rows.get(id),table=tables.get(row.table);dependencies(row,table,rows,queue);}
    const resources=[...rows.values()];
    // Cascades span partitions and security tables. Never claim no impact or expose a delete target set.
    const partialProbe={...probe,sourceFingerprint,complete:false,stableIds:resources.map(row=>row.ref),resources,inventoryFingerprint:fingerprintInventory(resources.map(row=>row.ref)),blockers:['partition-is-one-part-of-complete-native-source','independent-source-baseline-not-verified','cross-partition-cascade-and-owner-review-required']};
    const backupEvidence={status:'verified',evidenceRef:'snapshot-summary.json',artifactFingerprint:expectedArtifactFingerprint,sourceFingerprint,consistencyEvidenceRef:'node-sqlite-consistent-online-backup',accessPolicyRef:'root-only-0700-0600',retentionPolicyRef:'7-day-review-no-auto-purge'};
    const restoreEvidence={status:'not-run',evidenceRef:'pending:partition-specific-independent-restore-ID-review',backupArtifactFingerprint:expectedArtifactFingerprint,isolated:true,verifiedInventoryFingerprint:partialProbe.inventoryFingerprint,administratorPreserved:false,collaborationPreserved:null};
    const result=prepareCleanupManifest(partialProbe,{backupEvidence,restoreEvidence,batchId:'workspace-snapshot-part-'+String(++sequence).padStart(4,'0')});
    for(const row of result.proposedManifest.items)row.cascade={mode:'unresolved',targets:[],explanation:'Source FK topology is recorded; reverse cascades can cross this partition. No deletion or reassignment is proposed.',evidenceRefs:['closed-artifact#fk-topology']};
    // Recompute digest after the explicit unresolved cascade disposition, using the shared function.
    const manifest=result.proposedManifest;
    return finalize(manifest,primaryRows,label);
  }
  function finalize(manifest,primaryRows,label){
    // prepareCleanupManifest already emitted its initial digest; this records the final review draft.
    manifest.batch.summary.digest=fingerprintManifest(manifest);
    const checked=validateCleanupManifest(manifest,{});
    const file='part-'+String(sequence).padStart(4,'0')+'.json';
    const primaryReferences=primaryRows.map(row=>row.ref);
    const primaryDispositions={total:primaryRows.length,preserve:0,delete:0,pending:0};
    const byKey=new Map(manifest.items.map(row=>[key(row.resource),row]));
    for(const ref of primaryReferences){primaryDispositions[byKey.get(key(ref)).decision]++;collectionHash.update(JSON.stringify(ref)+'\n');}
    for(const name of Object.keys(dispositions))dispositions[name]+=primaryDispositions[name];
    const compact={status:checked.status,errorsByCode:counts(checked.errors),pendingByCode:counts(checked.pending)};
    validation.errors+=checked.errors.length;validation.statusCounts[checked.status]=(validation.statusCounts[checked.status]||0)+1;
    for(const [field,values] of Object.entries({errorsByCode:compact.errorsByCode,pendingByCode:compact.pendingByCode}))for(const [code,n] of Object.entries(values))validation[field][code]=(validation[field][code]||0)+n;
    write(path.join(outputDirectory,file),{schemaVersion:1,partition:{sequence,label,globalInventoryComplete:false},primaryReferences,manifest,validation:compact});
    partitions.push({file,label,primaryCount:primaryRows.length,contextCount:manifest.items.length-primaryRows.length,primaryDispositions,manifestDigest:manifest.batch.summary.digest,fileFingerprint:hashProtectedFile(path.join(outputDirectory,file)),validation:compact});
  }
  try{
    db.exec('PRAGMA query_only=ON; BEGIN');
    // The composite key contains a caller-supplied idempotency value. Hash it into an opaque stable reference.
    const management=tables.get('management_requests');
    if(management&&management.columns.some(column=>column.name==='request_key')){
      const mapFd=fs.openSync(path.join(outputDirectory,'opaque-request-key-map.jsonl'),'wx',0o600);
      try{for(const raw of db.prepare('SELECT workspace_id,kind,request_key,resource_id FROM management_requests ORDER BY workspace_id,kind,request_key').iterate()){
        const id='opaque-sha256:'+digest([raw.workspace_id,raw.kind,raw.request_key]);
        fs.writeSync(mapFd,JSON.stringify({opaqueId:id,nativeCompositeKey:[raw.workspace_id,raw.kind,raw.request_key]})+'\n');
        const row={ref:{kind:TABLE_KINDS.management_requests,type:'sqlite:management_requests',id},table:'management_requests',values:{workspace_id:raw.workspace_id},known:true,dependencies:[],cascadeTargets:[],ownership:{classification:'shared',loginAccountRefs:[],evidenceRefs:['backend/management.mjs#idempotency-record-not-login-owner']}};
        const targetTable=raw.kind==='employee'?'employees':raw.kind==='task'?'tasks':raw.kind==='hermes-profile'?'a2a_actions':String(raw.kind).startsWith('conversation:')?'conversations':null;
        if(targetTable)for(const target of lookup(targetTable,'id',raw.resource_id))row.dependencies.push({target:target.ref,relation:'references',onTargetDelete:'blocks',evidenceRefs:['backend/management.mjs#idempotent-resource-reference']});
        baseRows.set(key(row.ref),row);
      }}finally{fs.closeSync(mapFd);}
    }
    emit([...baseRows.values()],'core-small-tables');
    for(const table of probe.tables){
      if(INFRASTRUCTURE_TABLES.has(table.name)||table.name.startsWith('sqlite_')){primaryTableCounts.push({table:table.name,count:table.count,represented:0,coverage:'infrastructure-schema-count-preserved'});continue;}
      if(table.name==='management_requests'){primaryTableCounts.push({table:table.name,count:table.count,represented:[...baseRows.values()].filter(row=>row.table===table.name).length,coverage:'opaque-composite-stable-reference'});continue;}
      const coreCount=[...baseRows.values()].filter(row=>row.table===table.name).length;
      if(coreCount===table.count){primaryTableCounts.push({table:table.name,count:table.count,represented:coreCount,coverage:'all-stable-IDs-in-core'});continue;}
      if(!table.kind||protectedSchemaState.has(table.name)||!table.primaryKey.length||!table.primaryKey.every(column=>table.selectedColumns.includes(column))){schemaAndCountOnlyTables.push({table:table.name,count:table.count,reason:protectedSchemaState.has(table.name)?'private-security-key-not-projected':!table.kind?'unknown-source-family':'native-primary-key-not-safe-projectable'});primaryTableCounts.push({table:table.name,count:table.count,represented:coreCount,coverage:'schema-count-only-pending'});continue;}
      let batch=[],represented=coreCount;
      for(const values of db.prepare('SELECT '+table.selectedColumns.map(quote).join(',')+' FROM '+quote(table.name)+' ORDER BY '+table.primaryKey.map(quote).join(',')).iterate()){
        const row=projectRow(table,values);if(baseRows.has(key(row.ref)))continue;batch.push(row);represented++;
        if(batch.length>=partitionSize){emit(batch,table.name);batch=[];await new Promise(resolve=>setImmediate(resolve));}
      }
      if(batch.length)emit(batch,table.name);
      primaryTableCounts.push({table:table.name,count:table.count,represented,coverage:'all-stable-IDs-in-bounded-partitions'});
    }
    db.exec('ROLLBACK');
  }finally{db.close();}
  if(hashProtectedFile(databasePath)!==expectedArtifactFingerprint)throw new Error('Closed artifact fingerprint changed during partition preparation');
  const result={schemaVersion:1,status:'pending_source_baseline',directory:outputDirectory,sourceFingerprint,closedDatabaseArtifactFingerprint:expectedArtifactFingerprint,globalInventoryComplete:false,primaryTableCounts,schemaAndCountOnlyTables,dispositions,partitionCount:partitions.length,partitions,primaryCollectionFingerprint:collectionHash.digest('hex'),collectionFingerprintScope:'Ordered typed primary-reference JSONL across partitions; not a shared single-array inventory fingerprint.',validation,allPartitionManifestsValidatedWithoutTrustedContext:true,partitionContextRefsMayRepeat:true,primaryReferencesNeverRepeat:true,sourceDatabaseReadOnly:true,sourceArtifactHashUnchanged:true,latestOperationalRevocationLedger:'pending',centralIdentityOperations:[],productionMutations:0};
  write(path.join(outputDirectory,'index.json'),result);return result;
}

import {fingerprintCleanupManifest as fingerprintManifest} from './vendor/cleanup-manifest.mjs';
