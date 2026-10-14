import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import {digestProduction} from '../backend/production-preservation.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
/** Real archive entry, external cwd, no QA marker or dependency symlink. */
export function verifyApiEntries(directory){
 directory=path.resolve(directory);
 const results=[];
 for(const role of ['v1-compat','v2']){
  const manifest=JSON.parse(fs.readFileSync(path.join(directory,role+'-manifest.json'))),archive=path.join(directory,role+'-api.zip'),artifact=manifest.artifacts.find(row=>path.basename(row.path)===role+'-api.zip');
  if(!artifact||sha(fs.readFileSync(archive))!==artifact.sha256)throw Error('Archive hash mismatch');
  let db;const temp=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-api-entry-'))),extracted=path.join(temp,'api');fs.mkdirSync(extracted);
  try{
   execFileSync('tar',['-xf',archive,'-C',extracted],{windowsHide:true});
   const file=path.join(temp,'original.sqlite');db=new DatabaseSync(file);db.exec('CREATE TABLE sentinel(id TEXT PRIMARY KEY,value TEXT);INSERT INTO sentinel VALUES(\'original\',\'retained\');CREATE TABLE workspaces(id TEXT PRIMARY KEY,slug TEXT);INSERT INTO workspaces VALUES(\'ws_archive_fixture\',\'archive-fixture\');CREATE TABLE employees(id TEXT PRIMARY KEY,workspace_id TEXT,runtime TEXT,status TEXT);CREATE TABLE tasks(id TEXT PRIMARY KEY,assignee TEXT);CREATE TABLE conversations(id TEXT PRIMARY KEY,employee_id TEXT);CREATE TABLE a2a_actions(id TEXT PRIMARY KEY,workspace_id TEXT,type TEXT,payload_json TEXT,result_json TEXT,status TEXT,acked_at TEXT);CREATE TABLE management_requests(workspace_id TEXT,kind TEXT,request_key TEXT,fingerprint TEXT,resource_id TEXT,PRIMARY KEY(workspace_id,kind,request_key));PRAGMA journal_mode=WAL;PRAGMA wal_autocheckpoint=0;INSERT INTO sentinel VALUES(\'wal-original\',\'retained in WAL\')');
   const spec=path.join(temp,'spec.json');fs.writeFileSync(spec,JSON.stringify({database:file,operationId:'archive-readonly-original'}));
   const guard=path.join(temp,'guard.cjs');fs.writeFileSync(guard,"const deny=()=>{throw Error('Readonly plan must not execute a helper or use network')};global.fetch=deny;require('node:net').Socket.prototype.connect=deny;for(const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])require('node:child_process')[name]=deny;");
   const productionCommands=[];let productionSpec,productionTrust;
   if(fs.existsSync(path.join(extracted,'backend/production-preservation.mjs'))){
    const originalRoot=path.join(temp,'stopped-original-api'),entryPath=path.join(originalRoot,'backend/server.mjs');fs.mkdirSync(path.dirname(entryPath),{recursive:true});fs.writeFileSync(entryPath,'// isolated original archive fixture\n');
    const nonce='c'.repeat(64),host={hostId:'archive_fixture',deviceIds:[],workspaceIds:['ws_archive_fixture'],clients:[],apiInstances:[{root:originalRoot,entryPath,role:'v1',buildDigest:sha(JSON.stringify([{path:'backend/server.mjs',sha256:sha(fs.readFileSync(entryPath))}])),serviceManager:'isolated-plan-fixture',originalInstance:{pid:999999999,createdAt:'2026-10-01T00:00:00.000Z',nonceDigest:nonce}}]};
    const manifests=['v1-compat','v2'].map(productRole=>({productRole,sha256:sha(fs.readFileSync(path.join(directory,productRole+'-manifest.json')))})),artifacts=['v1-compat','v2'].flatMap(productRole=>JSON.parse(fs.readFileSync(path.join(directory,productRole+'-manifest.json'))).artifacts.map(row=>({name:path.basename(row.path),sha256:row.sha256,bytes:row.bytes}))),stat=fs.lstatSync(file,{bigint:true});
    host.apiInstances[0].installTargets=Object.fromEntries(['v1-compat','v2'].map(productRole=>{
      const targetRoot=productRole===role?extracted:path.join(temp,'approved-'+productRole),targetManifest=JSON.parse(fs.readFileSync(path.join(directory,productRole+'-manifest.json')));fs.mkdirSync(targetRoot,{recursive:true});
      return [productRole,{root:targetRoot,entryPath:path.join(targetRoot,'backend/server.mjs'),manifestSha256:manifests.find(row=>row.productRole===productRole).sha256,buildDigest:targetManifest.buildDigest}];
    }));
    const value={schemaVersion:1,mode:'production',operationId:'archive-production-plan',authorization:{executor:'R01',targetOrigins:['https://fixture.invalid'],allowedCommands:['inspect','prepare','seal','restore','abort']},database:{path:file,canonicalPath:fs.realpathSync.native(file),identity:{dev:String(stat.dev),ino:String(stat.ino)},databaseId:randomUUID()},packages:{directory,manifests,artifacts},candidateCommit:manifest.candidateCommit,qa:{commit:'b'.repeat(40),evidenceSha256:nonce},versions:manifest.versions,hosts:[host],backupScope:{mainDatabase:file,controlDatabases:[],objectRoots:[],homes:[],journals:[],configs:[],privateReferences:[]},bootstrap:{fromRole:'v1',offline:true,allOriginalWritersStopped:true}};
    value.specHash=digestProduction(value);productionSpec=path.join(temp,'production-spec.json');fs.writeFileSync(productionSpec,JSON.stringify(value));
    const keyRef=path.join(temp,'private-fixture-key');fs.writeFileSync(keyRef,randomBytes(32),{mode:0o600});productionTrust=path.join(temp,'independent-trust.json');fs.writeFileSync(productionTrust,JSON.stringify({schemaVersion:1,algorithm:'hmac-sha256',hosts:[{hostId:host.hostId,keyId:'archive_fixture',keyRef,bindingDigest:digestProduction(host)}],approvedSpecs:[{operationId:value.operationId,specHash:value.specHash}],backupHostId:host.hostId}));
   }
   const sourceHashes=()=>['','-wal','-shm'].map(suffix=>({suffix,sha256:sha(fs.readFileSync(file+suffix))}));const beforeSource=JSON.stringify(sourceHashes()),names=fs.readdirSync(temp).sort(),commands=[];
   for(const command of ['inspect','prepare']){
    const output=execFileSync(process.execPath,['--require',guard,path.join(extracted,'scripts/v2-preservation.mjs'),command,'--spec',spec],{cwd:temp,encoding:'utf8',windowsHide:true,maxBuffer:2*1024*1024}),report=JSON.parse(output);
    if(report.mode!=='plan'||report.willApply!==false||report.report.role!==role)throw Error('Readonly archive role mismatch');
    if(JSON.stringify(sourceHashes())!==beforeSource||JSON.stringify(fs.readdirSync(temp).sort())!==JSON.stringify(names))throw Error('Readonly archive modified original files');
    commands.push({command,mode:report.mode,willApply:report.willApply,role:report.report.role});
   }
   if(productionSpec){
    for(const command of ['inspect','prepare']){
     const output=execFileSync(process.execPath,['--require',guard,path.join(extracted,'scripts/v2-preservation.mjs'),command,'--spec',productionSpec,'--trust',productionTrust],{cwd:temp,encoding:'utf8',windowsHide:true,maxBuffer:2*1024*1024}),report=JSON.parse(output);
     if(report.mode!=='plan'||report.willApply!==false||report.role!==role||report.state!=='absent')throw Error('Production archive plan mismatch');
     if(JSON.stringify(sourceHashes())!==beforeSource||JSON.stringify(fs.readdirSync(temp).sort())!==JSON.stringify(names))throw Error('Production archive plan modified original files');
     productionCommands.push({command,mode:report.mode,willApply:false,role:report.role});
    }
    let refused;
    try{execFileSync(process.execPath,['--require',guard,path.join(extracted,'scripts/v2-preservation.mjs'),'prepare','--spec',productionSpec,'--trust',productionTrust,'--apply'],{cwd:temp,encoding:'utf8',windowsHide:true,stdio:'pipe'});}catch(error){refused=JSON.parse(String(error.stderr).split('\n').find(line=>line.startsWith('{'))||'{}').code;}
    if(refused!==(role==='v1-compat'?'PRODUCTION_COMPAT_READ_ONLY':'PRODUCTION_TRANSPORT_REQUIRED')||JSON.stringify(sourceHashes())!==beforeSource||JSON.stringify(fs.readdirSync(temp).sort())!==JSON.stringify(names))throw Error('Production archive first-write refusal failed: '+refused);
    productionCommands.push({command:'prepare',apply:true,refused});
   }
   // Unchanged main+WAL bytes prove that the source schema remains sentinel-only.
   // A new parent read transaction would itself alter the fixture SHM read mark.
   // Negative control removes only this disposable archive's dependency.
   fs.unlinkSync(path.join(extracted,'daemon/config.mjs'));let missing=false;
   try{execFileSync(process.execPath,['--require',guard,path.join(extracted,'scripts/v2-preservation.mjs'),'inspect','--spec',spec],{cwd:temp,encoding:'utf8',windowsHide:true,stdio:'pipe'});}catch(error){missing=String(error.stderr).includes('ERR_MODULE_NOT_FOUND');}
   if(!missing||JSON.stringify(sourceHashes())!==beforeSource)throw Error('Missing dependency negative control failed');
   results.push({role,archiveSha256:artifact.sha256,commands,...(productionSpec?{productionCommands,productionScope:'Exact actual artifact pins and independent ephemeral key/spec; readonly plan and no-transport/compat first-write refusal only; not native namespace approval'}:{}),sourceDatabaseUnchanged:true,sourceWalShmUnchanged:true,noNewSchema:true,noQaMarker:true,noNetworkOrHelper:true,missingDependencyRefused:true});
  }finally{
   db?.close();
   const target=path.resolve(temp),parent=fs.realpathSync.native(os.tmpdir());if(path.dirname(target)!==parent||!path.basename(target).startsWith('ziwei-api-entry-'))throw Error('Cleanup scope invalid');
   fs.rmSync(target,{recursive:true,force:true,maxRetries:8,retryDelay:100});
  }
 }
 return{schemaVersion:1,kind:'actual-extracted-api-readonly-entry',results};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){if(!process.argv[2])throw Error('Provide frozen package directory');const receipt=verifyApiEntries(path.resolve(process.argv[2]));fs.writeFileSync(path.join(path.resolve(process.argv[2]),'api-entry-proof.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt,null,2));}
