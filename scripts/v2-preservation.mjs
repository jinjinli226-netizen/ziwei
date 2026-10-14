import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createPreservation,FROZEN_VERSIONS} from '../backend/version-preservation.mjs';
import {readDatabaseSnapshot} from '../backend/preservation-native-databases.mjs';
import {collectNativeEvidence} from '../backend/preservation-native-evidence.mjs';
import {inspectClientMaintenance} from './client-lifecycle.mjs';
import {verifyPreservationPackages} from './verify-preservation-packages.mjs';
import {clientBuildIdentity} from '../src/management-bootstrap.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const inside=(root,value)=>{const relative=path.relative(path.resolve(root),path.resolve(value));return relative!==''&&relative!=='..'&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative);};
function scope(spec){const root=path.resolve(spec.isolatedRoot||''),marker=JSON.parse(fs.readFileSync(path.join(root,'preservation-rehearsal.json'),'utf8'));if(marker.purpose!=='ziwei-data-preserving-rehearsal'||!inside(root,spec.database))throw new Error('Apply requires an owned rehearsal root and its existing DB');for(const client of spec.clients||[])for(const value of [client.root,client.configPath,client.userHome].filter(Boolean))if(!inside(root,value))throw new Error('Client path is outside isolated rehearsal root');return root;}
const productionFailure=code=>{throw Object.assign(new Error(code),{code});};
async function productionRun({command,apply,spec},{trust,proofProvider,backupProof,packageRoot,legacyActionPolicy=null}={}){
  if(!['inspect','prepare','seal','restore','abort'].includes(command))productionFailure('PRODUCTION_COMMAND_INVALID');
  if(!trust||typeof trust!=='object'||Array.isArray(trust))productionFailure('PRODUCTION_INDEPENDENT_TRUST_REQUIRED');
  const {runProductionPreservation}=await import('../backend/production-preservation.mjs');
  return runProductionPreservation({command,apply,spec,trust,...(proofProvider?{proofProvider}:{}),...(backupProof?{backupProof}:{}),...(packageRoot?{packageRoot}:{})},{legacyActionPolicy});
}
export async function runPreservation({command='inspect',apply=false,...spec}={},productionInputs={}) {
  // Production uses its immutable typed spec and independently supplied trust.
  // Trusted providers are code arguments, never fields removed from spec JSON.
  if(spec.mode==='production')return productionRun({command,apply,spec},productionInputs);
  if(!spec.database||!fs.existsSync(spec.database))throw new Error('An existing explicit database is required');
  if(!['inspect','prepare','seal','restore','abort','drain'].includes(command))throw new Error('Unknown operation');
  if(!apply){const report=readDatabaseSnapshot(path.resolve(spec.database),db=>createPreservation(db,{readOnly:true}).inspect());return {mode:'plan',command,willApply:false,versions:FROZEN_VERSIONS,report,next:command==='inspect'?null:'Re-run with --apply and an owned isolated rehearsal specification'};}
  const root=scope(spec);
  if(!spec.packages)throw new Error('Apply requires verified preservation packages');
  const manifests=verifyPreservationPackages(spec.packages,{candidateCommit:spec.candidateCommit}),manifest=manifests.find(row=>row.productRole==='v2');
  for(const client of spec.clients||[]){if(clientBuildIdentity(client.root)!==manifest.clientBuild)throw new Error('Installed V2 protection client build does not match manifest');for(const row of manifest.clientContents)if(sha(fs.readFileSync(path.join(client.root,row.path)))!==row.sha256)throw new Error('Installed protection client source differs from package');}
  if(command==='drain'){
    const proofs=[];
    for(const client of spec.clients||[]){const env={...process.env,ZIWEI_USER_HOME:client.userHome,ZIWEI_CONFIG:client.configPath},inspected=await inspectClientMaintenance({root:client.root,env,configPath:client.configPath}),config=JSON.parse(fs.readFileSync(client.configPath));if(!inspected.wasRunning)throw new Error('Only the verified original running client can be drained');const origin=`http://${config.healthHost||'127.0.0.1'}:${config.healthPort}`;const response=await fetch(`${origin}/healthz`),body=await response.json();if(body.pid!==inspected.pid)throw new Error('Client instance changed');const paused=await fetch(`${origin}/local/connection-control`,{method:'POST',headers:{'content-type':'application/json','x-ziwei-local-control':config.deviceToken},body:JSON.stringify({operation:'pause',nonce:body.lifecycle.nonce}),signal:AbortSignal.timeout(3000),redirect:'error'});if(!paused.ok)throw new Error('Native drain refused');proofs.push({pid:body.pid,root:client.root,nonce:body.lifecycle.nonce});}
    return {mode:'applied',command,proofs};
  }
  const db=new DatabaseSync(path.resolve(spec.database));db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON');
  try {
    const guard=createPreservation(db,{collectNativeEvidence});
    if(command==='inspect')return {mode:'applied',command,report:guard.inspect()};
    let backup;
    if(command==='prepare'){
      const directory=path.join(root,'backups');fs.mkdirSync(directory,{recursive:true});const file=path.join(directory,`${spec.operationId}-${Date.now()}.sqlite`);db.prepare('VACUUM INTO ?').run(file);fs.chmodSync(file,0o600);backup={path:file,sha256:sha(fs.readFileSync(file)),purpose:'evidence/recovery copy; never restore whole DB during a version switch'};
    }
    const method={prepare:'begin',seal:'seal',restore:'restore',abort:'abort'}[command];const report=await guard[method]({operationId:spec.operationId,versions:FROZEN_VERSIONS,clients:spec.clients});
    return {mode:'applied',command,...(backup?{backup}:{}),report};
  } finally {db.close();}
}
async function main(){
  const args=process.argv.slice(2),command=args.find(value=>!value.startsWith('--'))||'inspect',index=args.indexOf('--spec');
  if(index<0||!args[index+1])throw new Error('Usage: node scripts/v2-preservation.mjs inspect|prepare|drain|seal|restore|abort --spec <local.json> [--trust <independent.json>] [--apply]');
  const specPath=path.resolve(args[index+1]),spec=JSON.parse(fs.readFileSync(specPath,'utf8')),apply=args.includes('--apply');
  let result;
  if(spec.mode==='production'){
    const trustIndex=args.indexOf('--trust');
    if(trustIndex<0||!args[trustIndex+1]||args.filter(value=>value==='--trust').length!==1)productionFailure('PRODUCTION_INDEPENDENT_TRUST_REQUIRED');
    const trustPath=path.resolve(args[trustIndex+1]);
    if(fs.realpathSync.native(trustPath)===fs.realpathSync.native(specPath))productionFailure('PRODUCTION_INDEPENDENT_TRUST_REQUIRED');
    const trust=JSON.parse(fs.readFileSync(trustPath,'utf8'));
    // Preserve the complete raw production spec for its strict field validator.
    const{loadPrivateLegacyGuardPolicy}=await import('../backend/preservation-legacy-integration.mjs');
    result=await productionRun({command,apply,spec},{trust,legacyActionPolicy:loadPrivateLegacyGuardPolicy()});
  }else result=await runPreservation({...spec,command,apply});
  console.log(JSON.stringify(result,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{console.error(JSON.stringify({code:error.code||'PRESERVATION_FAILED',error:error.message,details:error.details||null}));process.exitCode=1;});
