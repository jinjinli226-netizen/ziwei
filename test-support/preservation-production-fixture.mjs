import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {canonicalProduction,digestProduction,signProductionEnvelope,validateProductionSpec,runProductionPreservation,readProductionProjection,productionEvidenceDigest,validateProductionFreshness} from '../backend/production-preservation.mjs';
import {createPreservation,FROZEN_VERSIONS} from '../backend/version-preservation.mjs';
import {readDatabaseSnapshot} from '../backend/preservation-native-databases.mjs';
import {nativeActionDigest} from '../backend/preservation-native-databases.mjs';
import {clientBuildIdentity} from '../src/management-bootstrap.mjs';
import {collectProductionSourceProof,runProductionSourceCli} from '../scripts/production-source-proof.mjs';
import {createProductionApiIdentityHandler,createApiIdentityRequest} from '../backend/preservation-source-namespace.mjs';

const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const nonce='c'.repeat(64);
export function productionFixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-production-entry-')),nativeRuntimeConnections=[];t.after(()=>{for(const connection of nativeRuntimeConnections)connection.close();fs.rmSync(root,{recursive:true,force:true});});
 const databaseFile=path.join(root,'current.sqlite'),db=new DatabaseSync(databaseFile);
 db.exec("CREATE TABLE workspaces(id TEXT PRIMARY KEY,slug TEXT); INSERT INTO workspaces VALUES('ws_fixture','fixture'); CREATE TABLE employees(id TEXT PRIMARY KEY,workspace_id TEXT,runtime TEXT,status TEXT); CREATE TABLE tasks(id TEXT PRIMARY KEY,assignee TEXT); CREATE TABLE conversations(id TEXT PRIMARY KEY,employee_id TEXT); CREATE TABLE a2a_actions(id TEXT PRIMARY KEY,workspace_id TEXT,type TEXT,payload_json TEXT,result_json TEXT,status TEXT,acked_at TEXT); CREATE TABLE management_requests(workspace_id TEXT,kind TEXT,request_key TEXT,fingerprint TEXT,resource_id TEXT,PRIMARY KEY(workspace_id,kind,request_key));");db.close();
 const packages=path.join(root,'packages'),packageRoot=path.join(root,'staged-v2');fs.mkdirSync(packages);fs.mkdirSync(packageRoot);
 const files=['backend/server.mjs','backend/production-preservation.mjs','backend/preservation-source-namespace.mjs','backend/version-preservation.mjs','backend/preservation-native-evidence.mjs','backend/preservation-native-databases.mjs','backend/preservation-legacy-archive.mjs','backend/preservation-legacy-source.mjs','backend/preservation-legacy-coverage.mjs','backend/preservation-legacy-integration.mjs','scripts/production-source-proof.mjs','scripts/v2-preservation.mjs','scripts/verify-preservation-packages.mjs','src/execution-admission.mjs','scripts/client-lifecycle.mjs','scripts/client-legacy-identity.mjs','src/management-bootstrap.mjs','daemon/config.mjs'];
 for(const file of files){const target=path.join(packageRoot,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(repository,file),target);}
 const candidateCommit='a'.repeat(40),manifests=[],artifacts=[];
 for(const productRole of ['v1-compat','v2']){
  const descriptor={schemaVersion:1,productRole,candidateCommit,versions:FROZEN_VERSIONS};
  if(productRole==='v2')fs.writeFileSync(path.join(packageRoot,'preservation-package.json'),JSON.stringify(descriptor));
  const contents=[...files.map(file=>({path:file,sha256:sha(fs.readFileSync(path.join(packageRoot,file)))})),{path:'preservation-package.json',sha256:sha(JSON.stringify(descriptor))}];
  const entries=['windows-client.tgz','api.zip','frontend.zip'].map(suffix=>{const name=productRole+'-'+suffix,bytes=Buffer.from('isolated fixture artifact '+name);fs.writeFileSync(path.join(packages,name),bytes);artifacts.push({name,bytes:bytes.length,sha256:sha(bytes)});return {path:path.join(packages,name),bytes:bytes.length,sha256:sha(bytes)};});
  const manifest={...descriptor,contents,buildDigest:sha(JSON.stringify(contents)),artifacts:entries,clientBuild:nonce};
  const manifestFile=path.join(packages,productRole+'-manifest.json');fs.writeFileSync(manifestFile,JSON.stringify(manifest));manifests.push({productRole,sha256:sha(fs.readFileSync(manifestFile))});
 }
 const apiRoot=path.join(root,'original-api');fs.mkdirSync(path.join(apiRoot,'backend'),{recursive:true});const entryPath=path.join(apiRoot,'backend','server.mjs');fs.writeFileSync(entryPath,'// stopped original V1 fixture\n');
 const host={hostId:'host_fixture',deviceIds:[],workspaceIds:['ws_fixture'],clients:[],apiInstances:[{root:apiRoot,entryPath,role:'v1',buildDigest:sha(JSON.stringify([{path:'backend/server.mjs',sha256:sha(fs.readFileSync(entryPath))}])),serviceManager:'isolated-fixture',originalInstance:{pid:999999999,createdAt:'2026-10-01T00:00:00.000Z',nonceDigest:nonce}}]};
 for(const original of host.apiInstances)original.installTargets=Object.fromEntries(['v1-compat','v2'].map(role=>{const manifest=JSON.parse(fs.readFileSync(path.join(packages,role+'-manifest.json'))),targetRoot=path.join(root,'releases',role);return [role,{root:targetRoot,entryPath:path.join(targetRoot,'backend/server.mjs'),manifestSha256:manifests.find(row=>row.productRole===role).sha256,buildDigest:manifest.buildDigest}];}));
 const stat=fs.lstatSync(databaseFile,{bigint:true}),database={path:databaseFile,canonicalPath:fs.realpathSync.native(databaseFile),identity:{dev:String(stat.dev),ino:String(stat.ino)},databaseId:crypto.randomUUID()};
 const spec={schemaVersion:1,mode:'production',operationId:'fixture-production',authorization:{executor:'R01',targetOrigins:['https://fixture.invalid'],allowedCommands:['inspect','prepare','seal','restore','abort']},database,packages:{directory:packages,manifests,artifacts},candidateCommit,qa:{commit:'b'.repeat(40),evidenceSha256:nonce},versions:FROZEN_VERSIONS,hosts:[host],backupScope:{mainDatabase:databaseFile,controlDatabases:[],objectRoots:[],homes:[],journals:[],configs:[],privateReferences:[]},bootstrap:{fromRole:'v1',offline:true,allOriginalWritersStopped:true}};
 spec.specHash=digestProduction(spec);
 const keyRef=path.join(root,'private-key');fs.writeFileSync(keyRef,crypto.randomBytes(32),{mode:0o600});
 const trust={schemaVersion:1,algorithm:'hmac-sha256',hosts:[{hostId:host.hostId,keyId:'ops_fixture',keyRef,bindingDigest:digestProduction(host)}],approvedSpecs:[{operationId:spec.operationId,specHash:spec.specHash}],backupHostId:host.hostId};
 const observe=binding=>({namespace:process.platform,namespaceComplete:true,workerScopeComplete:true,originalStopped:true,restarted:false,unresolved:[],instances:[...binding.clients,...binding.apiInstances].map(row=>({bindingDigest:digestProduction(row),originalInstance:row.originalInstance,stopped:true}))});
 const calls=[],provider={
  collect(input){calls.push('collect');return input.requests.map(request=>collectProductionSourceProof({request,trust,observe}));},
  recheck(input){calls.push('recheck');return input.requests.map(request=>collectProductionSourceProof({request,trust,previous:input.previous,observe}));},
  backup(input){calls.push('backup');const issuedAt=new Date().toISOString(),payload={domain:'ziwei-production-backup-proof-v1',schemaVersion:1,kind:'backup-restore-read',command:'seal',challenge:crypto.randomUUID(),issuedAt,expiresAt:new Date(Date.parse(issuedAt)+60000).toISOString(),operationId:input.operationId,specHash:input.specHash,databaseIdentity:input.databaseIdentity,freezeDigest:input.freezeDigest,scopeDigest:digestProduction(input.scope),manifestDigest:nonce,restoreReadDigest:nonce,mainDatabase:{path:input.scope.mainDatabase,integrity:'ok',foreignKeys:'ok',stablePrimaryKeysDigest:nonce,fileDigest:nonce},controlDatabases:[],objectsDigest:nonce,homesDigest:nonce,journalsDigest:nonce,configsDigest:nonce,privateReferencesDigest:nonce,originalWritersStopped:true,safe:true};return signProductionEnvelope({hostId:host.hostId,payload,trust});}
 };
 return {root,spec,trust,packageRoot,provider,calls,observe,entryPath,nativeRuntimeConnections};
}
