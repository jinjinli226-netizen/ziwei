import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {canonicalProduction,digestProduction,signProductionEnvelope,verifyProductionEnvelope,validateProductionRequest,validateProductionFreshness,productionEvidenceDigest,productionHostActions,productionSemanticIssues} from '../backend/production-preservation.mjs';
import * as nativeEvidence from '../backend/preservation-native-evidence.mjs';
import {scanOwnedNativeDatabases,nativeActionDigest,attestNativeVersion} from '../backend/preservation-native-databases.mjs';
import {clientBuildIdentity} from '../src/management-bootstrap.mjs';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const equal=(a,b)=>digestProduction(a)===digestProduction(b);
const scanNativeFiles=nativeEvidence.scanNativeFiles;
const sourceScopeRecords=new WeakMap();
const decode=text=>{try{return JSON.parse(text);}catch{fail('SOURCE_JSON_INVALID');}};
const privateRead=file=>{if(typeof file!=='string'||!path.isAbsolute(file)||path.resolve(file)!==file)fail('SOURCE_PATH_INVALID');let current=file;while(true){if(fs.lstatSync(current).isSymbolicLink())fail('SOURCE_PATH_LINKED');const parent=path.dirname(current);if(parent===current)break;current=parent;}const stat=fs.lstatSync(file);if(!stat.isFile()||stat.nlink!==1||fs.realpathSync.native(file)!==file)fail('SOURCE_PATH_INVALID');return fs.readFileSync(file);};
function fileProof(file,files){
 try{const bytes=privateRead(file),stat=fs.lstatSync(file,{bigint:true});const proof={path:file,exists:true,sha256:sha(bytes),bytes:bytes.length,identity:{dev:String(stat.dev),ino:String(stat.ino)}};files.push(proof);return bytes;}
 catch(error){if(error.code==='ENOENT'){files.push({path:file,exists:false});return null;}throw error;}
}
function directoryProof(directory,directories){
 try{const stat=fs.lstatSync(directory,{bigint:true});if(!stat.isDirectory()||stat.isSymbolicLink()||fs.realpathSync.native(directory)!==directory)fail('SOURCE_PATH_INVALID');const names=fs.readdirSync(directory).sort((a,b)=>a<b?-1:a>b?1:0);directories.push({path:directory,exists:true,names,identity:{dev:String(stat.dev),ino:String(stat.ino)}});return names;}
 catch(error){if(error.code==='ENOENT'){directories.push({path:directory,exists:false,names:[]});return [];}throw error;}
}
function namespaceCheck(binding){
 const paths=[...binding.clients.flatMap(row=>[row.root,row.entryPath,row.configPath,row.userHome,row.runtimeDir,row.baseHome]),...binding.apiInstances.flatMap(row=>[row.root,row.entryPath])];
 if(!['win32','linux'].includes(process.platform)||paths.some(value=>!path.isAbsolute(value)||process.platform==='linux'&&path.win32.isAbsolute(value))||process.platform==='win32'&&/WindowsApps|AppData[\\/]Local[\\/]Packages/i.test(process.execPath))fail('SOURCE_NAMESPACE_INVALID');
}
/** Native observation only. No network, stop/start, model or helper client. */
export function observeSourceProcesses(binding,request){
 namespaceCheck(binding);let inventory;
 if(process.platform==='win32'){
  const script="$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{pid=[int]$_.ProcessId;parentPid=[int]$_.ParentProcessId;name=$_.Name;executable=$_.ExecutablePath;command=$_.CommandLine;createdAt=$_.CreationDate.ToUniversalTime().ToString('o')} }) | ConvertTo-Json -Compress -Depth 4";
  inventory=decode(execFileSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:16*1024*1024}));
  if(!Array.isArray(inventory))fail('SOURCE_PROCESS_INVENTORY_UNKNOWN');
 }else{
  inventory=[];
  for(const name of fs.readdirSync('/proc').filter(value=>/^[0-9]+$/.test(value)))try{
   const pid=Number(name),stat=fs.readFileSync('/proc/'+name+'/stat','utf8'),end=stat.lastIndexOf(')'),fields=stat.slice(end+2).split(' '),command=fs.readFileSync('/proc/'+name+'/cmdline').toString().replaceAll('\0',' ');
   inventory.push({pid,parentPid:Number(fields[1]),name:stat.slice(stat.indexOf('(')+1,end),command,createdAt:fields[19]});
  }catch(error){if(error.code!=='ENOENT'&&error.code!=='ESRCH')fail('SOURCE_PROCESS_VISIBILITY_UNKNOWN');}
 }
 const ignored=new Set([process.pid,process.ppid]),roots=[...binding.clients.flatMap(row=>[row.root,row.userHome,row.runtimeDir,row.baseHome]),...binding.apiInstances.map(row=>row.root)].map(value=>process.platform==='win32'?value.toLowerCase():value);
 const unresolved=[],originals=[...binding.clients,...binding.apiInstances];
 for(const original of originals)if(inventory.some(row=>row.pid===original.originalInstance.pid))unresolved.push({code:'ORIGINAL_PID_PRESENT',pid:original.originalInstance.pid});
 const complete=nativeEvidence.observeOriginalNativeScopes?.({binding,inventory,request});
 const runningPids=new Set(request?.command==='restore'?(complete?.runningV2?.instances||[]).filter(row=>row.running===true&&row.productRole==='v2'&&row.root&&row.entryPath&&row.bindingDigest).map(row=>row.pid):[]),matches=new Set();
 if(request?.command!=='restore'&&complete?.runningV2)unresolved.push({code:'SOURCE_NEW_WRITER_PRESENT'});
 for(const row of inventory){
  if(ignored.has(row.pid)||runningPids.has(row.pid))continue;
  const command=process.platform==='win32'?String(row.command||'').toLowerCase():String(row.command||'');
  if(roots.some(root=>command.includes(root)))matches.add(row.pid);
  if(!command&&/^(node|python|pythonw|hermes|powershell|pwsh|cmd|bash|sh)(\.exe)?$/i.test(row.name||''))unresolved.push({code:'PROCESS_COMMAND_UNREADABLE',pid:row.pid});
 }
 let changed=true;while(changed){changed=false;for(const row of inventory)if(matches.has(row.parentPid)&&!matches.has(row.pid)){matches.add(row.pid);changed=true;}}
 for(const pid of matches)unresolved.push({code:'SOURCE_PROCESS_OR_WORKER_PRESENT',pid});
 // A command substring and an absent parent PID cannot account for detached
 // raw-spawn workers. E02's native observer must establish complete original
 // registry/namespace coverage; absence of that capability stays unknown.
 if(complete?.safe!==true||complete?.workerScopeComplete!==true||complete?.namespaceComplete!==true||['files','directories','homes','connections','proofs'].some(key=>!Array.isArray(complete?.[key])))unresolved.push({code:'SOURCE_ORIGINAL_WORKER_NAMESPACE_UNPROVEN'});
 const scoped=complete&&['files','directories','homes','connections','proofs'].every(key=>Array.isArray(complete[key]))?Object.fromEntries(['files','directories','homes','connections','proofs'].map(key=>[key,complete[key]])):null;
 const observation={namespace:process.platform,namespaceComplete:complete?.namespaceComplete===true,workerScopeComplete:complete?.workerScopeComplete===true&&unresolved.length===0,originalStopped:originals.every(original=>!inventory.some(row=>row.pid===original.originalInstance.pid)),restarted:matches.size>0,unresolved,instances:complete?.instances||[],...(complete?.runningV2?{runningV2:complete.runningV2}:{}),...(scoped?{scopeDigest:digestProduction(scoped)}:{})};
 if(scoped)sourceScopeRecords.set(observation,scoped);
 return observation;
}
function connectionsFor(payload,files,directories,issues){
 const connections=[];
 for(const client of payload.binding.clients){
  const bytes=fileProof(client.configPath,files);
  const expectedBuild=payload.command==='restore'?payload.installed?.clientBuild:client.clientBuild;
  if(!bytes||sha(bytes)!==client.configSha256||clientBuildIdentity(client.root)!==expectedBuild){issues.push({code:'SOURCE_CLIENT_IDENTITY_CHANGED'});continue;}
  if(!fileProof(client.entryPath,files))issues.push({code:'SOURCE_CLIENT_ENTRY_MISSING'});directoryProof(client.runtimeDir,directories);
  const config=decode(bytes),entries=[config,...(config.sharedWorkspaces||[]).filter(row=>row.enabled!==false)];
  const configured=new Set();
  for(const entry of entries){
   const workspace=payload.actionProjection.tables.workspaces.rows.find(row=>row.slug===entry.workspace);
   if(!workspace||!payload.binding.workspaceIds.includes(workspace.id)||!payload.binding.deviceIds.includes(entry.deviceId)||configured.has(workspace.id+'|'+entry.deviceId)){issues.push({code:'SOURCE_CONNECTION_SCOPE_UNKNOWN'});continue;}configured.add(workspace.id+'|'+entry.deviceId);
   let origin;try{origin=new URL(entry.apiBase||config.apiBase).origin;}catch{issues.push({code:'SOURCE_ORIGIN_INVALID'});continue;}
   const home=entry.hermesHome||config.hermesHome;
   if(!payload.targetOrigins.includes(origin)||home!==client.baseHome){issues.push({code:'SOURCE_CONNECTION_SCOPE_UNKNOWN'});continue;}
   connections.push({workspace:entry.workspace,deviceId:entry.deviceId,apiBase:origin,hermesHome:home,runtimeDir:entry===config?client.runtimeDir:path.join(client.runtimeDir,'shared-workspaces',entry.workspace,entry.deviceId)});
  }
  for(const home of [client.baseHome,client.userHome])directoryProof(home,directories);
 }
 return connections;
}
function recheckRecords(previous){
 for(const record of previous.files){
  if(record.exists){const bytes=privateRead(record.path),stat=fs.lstatSync(record.path,{bigint:true});if(sha(bytes)!==record.sha256||record.identity&&(String(stat.dev)!==record.identity.dev||String(stat.ino)!==record.identity.ino))fail('SOURCE_FILE_CHANGED');}
  else if(fs.existsSync(record.path))fail('SOURCE_FILE_CHANGED');
 }
 for(const record of previous.directories){
  if(record.exists){const stat=fs.lstatSync(record.path,{bigint:true});if(stat.isSymbolicLink()||!stat.isDirectory()||record.identity&&(String(stat.dev)!==record.identity.dev||String(stat.ino)!==record.identity.ino)||!equal(fs.readdirSync(record.path).sort((a,b)=>a<b?-1:a>b?1:0),record.names))fail('SOURCE_DIRECTORY_CHANGED');}
  else if(fs.existsSync(record.path))fail('SOURCE_DIRECTORY_CHANGED');
 }
}
/** Trusted observation/scanner injection is code-only, for isolated fixtures and
 * native platform adapters. CLI never reads callback names from request JSON. */
export function collectProductionSourceProof({request,trust,previous=null,observe=observeSourceProcesses,scanFiles=scanNativeFiles,scanDatabases=scanOwnedNativeDatabases}={}){
 const payload=validateProductionRequest({request,trust});
 namespaceCheck(payload.binding);
 let prior=null;
 if(payload.kind==='recheck'){
  if(!previous)fail('SOURCE_PREVIOUS_REQUIRED');
  // priorEvidenceDigest binds the product's whole ordered host-envelope set.
  if(!Array.isArray(previous)||digestProduction(previous)!==payload.priorEvidenceDigest)fail('SOURCE_PREVIOUS_BINDING');
  const envelope=previous.find(row=>row.hostId===request.hostId);if(!envelope)fail('SOURCE_PREVIOUS_BINDING');
  prior=verifyProductionEnvelope({envelope,trust,expected:{domain:'ziwei-production-collect-proof-v1',kind:'collect',command:payload.command,operationId:payload.operationId,specHash:payload.specHash,databaseIdentity:payload.databaseIdentity,freezeDigest:payload.freezeDigest,bindingDigest:digestProduction(payload.binding),actionProjectionDigest:digestProduction(payload.actionProjection),gatewayInboxDigest:digestProduction(payload.gatewayInbox),homesDigest:digestProduction(payload.homes)}});
  if(prior.challenge===payload.challenge||prior.evidenceDigest!==productionEvidenceDigest(prior))fail('SOURCE_PREVIOUS_BINDING');
  recheckRecords(prior);
 }
 const files=[],directories=[],issues=[],actions=productionHostActions(payload.binding,payload.actionProjection),connections=connectionsFor(payload,files,directories,issues);
 const observations=observe(payload.binding,payload);
 if(observations.originalStopped!==true||observations.workerScopeComplete!==true||observations.namespaceComplete!==true||observations.restarted!==false||observations.unresolved?.length)issues.push({code:'SOURCE_WORKERS_NOT_PROVEN_STOPPED'});
 const scoped=sourceScopeRecords.get(observations);
 if(scoped){files.push(...scoped.files);directories.push(...scoped.directories);connections.push(...scoped.connections.filter(row=>!connections.some(existing=>equal(existing,row))));}
 const homes=(scoped?.homes||payload.homes).map(scope=>({...scope,...attestNativeVersion(scope,actions)}));
 const scanned=scanFiles({connections,actions,homes,productionRequest:payload});
 const native=scanDatabases({homes,actions,gatewayInbox:payload.gatewayInbox,gatewayExits:scanned.gatewayExits,operationId:payload.operationId});
 issues.push(...productionSemanticIssues(payload.actionProjection,scanned.originalActionProofs||[]));
 for(const action of actions){
  const assessment=(scanned.originalActionProofs||[]).find(proof=>proof.kind==='legacy-never-dispatched-v1'&&proof.actionId===action.id&&proof.actionDigest===nativeActionDigest(action)&&proof.operationId===payload.operationId&&proof.specHash===payload.specHash&&proof.challenge===payload.challenge&&proof.hostId===request.hostId&&proof.verified===true);
  if(['pending','acked'].includes(action.status)||action.status==='expired'&&action.acked_at&&!assessment)issues.push({code:'SOURCE_ORIGINAL_ACTION_DEBT',actionId:action.id});
  if(action.acked_at&&!connections.length&&!assessment)issues.push({code:'SOURCE_ACTION_JOURNAL_SCOPE_MISSING',actionId:action.id});
 }
 issues.push(...scanned.issues,...native.issues);files.push(...scanned.files,...native.files);directories.push(...scanned.directories,...native.directories);
 for(const api of payload.binding.apiInstances){
  const entry=fileProof(api.entryPath,files);if(!entry)issues.push({code:'SOURCE_API_ENTRY_MISSING'});
  const descriptorFile=path.join(api.root,'preservation-package.json'),descriptor=fileProof(descriptorFile,files);
  if(descriptor){const data=decode(descriptor);if(data.productRole!==api.role&&payload.command!=='restore')issues.push({code:'SOURCE_API_ROLE_CHANGED'});}else if(api.role!=='v1')issues.push({code:'SOURCE_API_IDENTITY_UNKNOWN'});
  if(payload.command!=='restore'){
   // The immutable original build pin is a digest of its complete source list.
   const contents=[];function walk(directory,prefix=''){for(const name of directoryProof(directory,directories)){if(['node_modules','.git','.local','data'].includes(name))continue;const file=path.join(directory,name),relative=prefix?prefix+'/'+name:name,stat=fs.lstatSync(file);if(stat.isSymbolicLink())fail('SOURCE_PATH_LINKED');if(stat.isDirectory())walk(file,relative);else{const bytes=fileProof(file,files);contents.push({path:relative,sha256:sha(bytes)});}}}
   walk(api.root);
   if(sha(JSON.stringify(contents))!==api.buildDigest)issues.push({code:'SOURCE_API_BUILD_CHANGED'});
  }
 }
 if(payload.command==='restore'){
  const installed=payload.installed;
  if(!installed||installed.productRole!=='v2')issues.push({code:'SOURCE_RESTORE_IDENTITY_REQUIRED'});
  else for(const [root,contents,isApi] of [...payload.binding.apiInstances.map(row=>[row.root,installed.apiContents,true]),...payload.binding.clients.map(row=>[row.root,installed.clientContents,false])]){
   if(!Array.isArray(contents)||!contents.length){issues.push({code:'SOURCE_RESTORE_SOURCE_REQUIRED'});continue;}
   const approved=new Set();
   for(const row of contents){
    if(!row||typeof row.path!=='string'||row.path.includes('\\')||row.path.split('/').some(part=>!part||part==='.'||part==='..')||path.posix.isAbsolute(row.path))fail('SOURCE_RESTORE_SCOPE_INVALID');
    if(isApi&&!['backend','src','scripts','skills','daemon','package.json','package-lock.json','preservation-package.json'].includes(row.path.split('/')[0]))continue;
    if(approved.has(row.path))fail('SOURCE_RESTORE_SCOPE_INVALID');approved.add(row.path);
    const bytes=fileProof(path.join(root,row.path),files);if(!bytes||sha(bytes)!==row.sha256)issues.push({code:'SOURCE_RESTORE_SOURCE_CHANGED'});
   }
   function installedWalk(directory,prefix=''){
    for(const name of directoryProof(directory,directories)){
     if(!prefix&&['node_modules','.git','.local','data'].includes(name))continue;
     if(isApi&&!prefix&&!['backend','src','scripts','skills','daemon','package.json','package-lock.json','preservation-package.json'].includes(name))continue;
     const file=path.join(directory,name),relative=prefix?prefix+'/'+name:name,stat=fs.lstatSync(file);
     if(stat.isSymbolicLink())fail('SOURCE_PATH_LINKED');
     if(stat.isDirectory())installedWalk(file,relative);else if(!approved.has(relative))issues.push({code:'SOURCE_RESTORE_EXTRA_SOURCE'});
    }
   }
   installedWalk(root);
   const descriptor=decode(privateRead(path.join(root,'preservation-package.json')));if(descriptor.productRole!=='v2'||descriptor.candidateCommit!==installed.candidateCommit)issues.push({code:'SOURCE_RESTORE_ROLE_CHANGED'});
  }
 }
 recheckRecords({files,directories});
 const after=observe(payload.binding,payload);if(!equal(observations,after))issues.push({code:'SOURCE_PROCESS_OBSERVATION_CHANGED'});
 const result={domain:payload.kind==='collect'?'ziwei-production-collect-proof-v1':'ziwei-production-recheck-proof-v1',schemaVersion:1,kind:payload.kind,command:payload.command,collector:payload.collector,challenge:payload.challenge,issuedAt:payload.issuedAt,expiresAt:payload.expiresAt,operationId:payload.operationId,specHash:payload.specHash,databaseIdentity:payload.databaseIdentity,freezeDigest:payload.freezeDigest,bindingDigest:digestProduction(payload.binding),actionProjectionDigest:digestProduction(payload.actionProjection),gatewayInboxDigest:digestProduction(payload.gatewayInbox),homesDigest:digestProduction(payload.homes),priorEvidenceDigest:payload.priorEvidenceDigest,observations,files,directories,nativeDatabases:native.nativeDatabases,nativeStateProofs:[...native.nativeStateProofs,...(scoped?.proofs||[]),...(scanned.originalActionProofs||[]).map(proof=>{const stable=JSON.parse(canonicalProduction(proof));delete stable.challenge;return stable;})],gatewayInboxProofs:native.gatewayInboxProofs,actionBindings:actions.map(row=>({id:row.id,digest:nativeActionDigest(row)})),issues,safe:issues.length===0,evidenceDigest:null};
 result.evidenceDigest=productionEvidenceDigest(result);
 if(prior&&result.evidenceDigest!==prior.evidenceDigest)fail('SOURCE_EVIDENCE_CHANGED');
 validateProductionFreshness(payload);
 return signProductionEnvelope({hostId:request.hostId,trust,payload:result});
}
export function runProductionSourceCli(args){
 if(!Array.isArray(args)||!['collect','recheck'].includes(args[0]))fail('SOURCE_ARGUMENT_INVALID');
 const options={},allowed=new Set(['--request','--trust','--output','--previous']);
 for(let index=1;index<args.length;index+=2){const key=args[index],value=args[index+1];if(!allowed.has(key)||Object.hasOwn(options,key)||typeof value!=='string'||value.startsWith('--'))fail('SOURCE_ARGUMENT_INVALID');options[key]=value;}
 if(!options['--request']||!options['--trust']||!options['--output']||args[0]==='recheck'&&!options['--previous']||args[0]==='collect'&&options['--previous'])fail('SOURCE_ARGUMENT_INVALID');
 const output=options['--output'];if(!path.isAbsolute(output)||path.resolve(output)!==output||fs.existsSync(output))fail('SOURCE_OUTPUT_EXISTS');
 const parent=fs.realpathSync.native(path.dirname(output));if(parent!==path.dirname(output)||fs.lstatSync(parent).isSymbolicLink())fail('SOURCE_PATH_INVALID');
 const request=decode(privateRead(options['--request'])),trust=decode(privateRead(options['--trust']));
 validateProductionRequest({request,trust,kind:args[0]});
 const previous=options['--previous']?decode(privateRead(options['--previous'])):null,envelope=collectProductionSourceProof({request,trust,previous});
 fs.writeFileSync(output,canonicalProduction(envelope),{flag:'wx',mode:0o600});
 return {complete:envelope.payload.safe,path:output,hostId:envelope.hostId,operationId:envelope.payload.operationId,evidenceDigest:envelope.payload.evidenceDigest};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{console.log(JSON.stringify(runProductionSourceCli(process.argv.slice(2))));}catch(error){console.error(JSON.stringify({code:/^(SOURCE|PRODUCTION)_[A-Z0-9_]+$/.test(error.code||'')?error.code:'SOURCE_PROOF_FAILED',reason:'Read-only source proof refused'}));process.exitCode=1;}
}
