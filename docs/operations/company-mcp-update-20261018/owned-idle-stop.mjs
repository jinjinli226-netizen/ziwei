// One Company daemon-root stop for the already authorized official update.
// No business settlement, history repair, replay, deletion, or process-tree proof.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL,fileURLToPath} from 'node:url';

export const OLD_BUILD='161cc99010d6cdee4e3d8834135ac2ed4e8fb2031b746755b7d53de0b76dfb0b';
export const WORKSPACE='bigtron',DEVICE='device_11af6d85-6c5c-4cbe-9a25-31599a474e5d';
const HANDLE_SHA='de27f9e0fe8eec94ab113141b3db1e46c1cb6bf48f92a45248a7b074d78110b2';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const samePath=(a,b)=>typeof a==='string'&&typeof b==='string'&&path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const need=(x,code)=>{if(!x)throw Object.assign(new Error(code),{code});};
const canon=x=>JSON.stringify(x);
const identities=h=>h.connections?.map(x=>({workspace:x.workspace,deviceId:x.deviceId,primary:x.primary})).sort((a,b)=>canon(a).localeCompare(canon(b)));

export function assertOwnedIdentity(value,scope,pinned=null){
 const {health:h,record:r,ownerSid,configSha256}=value||{},l=h?.lifecycle;
 need(h?.service==='ziwei_user'&&h.agentId==='ziwei_user'&&h.workspace===WORKSPACE&&h.deviceId===DEVICE&&h.clientBuild===OLD_BUILD,'IDENTITY_CHANGED');
 need(ownerSid===scope.ownerSid&&hex(configSha256)&&l?.configSha256===configSha256&&samePath(l.root,scope.root)&&samePath(l.configPath,scope.configPath)&&samePath(l.runtimeDir,scope.runtimeDir),'IDENTITY_CHANGED');
 need(r&&Number.isSafeInteger(r.pid)&&r.pid>0&&r.pid===h.pid&&hex(r.commandHash)&&samePath(r.executable,scope.executable)&&Number.isFinite(Date.parse(r.creationTime)),'IDENTITY_CHANGED');
 need(/^[a-f0-9]{48}$/.test(l.nonce||'')&&Number.isFinite(Date.parse(l.startedAt))&&Math.abs(Date.parse(l.startedAt)-Date.parse(r.creationTime))<=15000,'IDENTITY_CHANGED');
 need(Array.isArray(h.connections)&&h.connections.length>0&&h.connections.every(x=>typeof x.workspace==='string'&&typeof x.deviceId==='string'&&typeof x.primary==='boolean'&&x.configured===true)&&Array.isArray(h.connectionErrors)&&h.connectionErrors.length===0,'CONNECTIONS_CHANGED');
 need(canon(identities(h))===canon(scope.connections),'CONNECTIONS_CHANGED');
 if(pinned)need(canon(r)===canon(pinned.record)&&ownerSid===pinned.ownerSid&&configSha256===pinned.configSha256&&l.nonce===pinned.health.lifecycle.nonce&&l.startedAt===pinned.health.lifecycle.startedAt,'IDENTITY_CHANGED');
 return value;
}
export function ownedIdle(h){
 const m=h?.maintenance,l=h?.lifecycle;
 return h?.connectionState==='draining'&&h.activeActionCount===0&&h.pollingCount===0&&h.quarantinedActionCount===0&&h.executionQuarantined===false&&l?.managedAuxiliaryCount===0&&m?.pendingDeliveryCount===0&&m.blockedDeliveryCount===0&&m.gatewaySafe===true&&Array.isArray(m.gatewayWorkers)&&m.gatewayWorkers.length===0;
}
function snapshotKey(snapshot){
 need(snapshot&&Array.isArray(snapshot.files)&&Array.isArray(snapshot.directories),'SNAPSHOT_INVALID');
 for(const row of snapshot.files)if(row.exists)need(Buffer.isBuffer(row.data)&&sha(row.data)===row.sha256,'SNAPSHOT_INVALID');
 return canon({files:snapshot.files.map(({data,...row})=>row),directories:snapshot.directories});
}

// Dependencies isolate the high-impact boundary for file/memory-only tests.
export async function stopOwnedIdle(scope,deps){
 let pinned,paused=false,terminated=false;
 try{
  pinned=assertOwnedIdentity(await deps.inspect(),scope);
  need(pinned.health.connectionState==='connected','CLIENT_ALREADY_DRAINING');
  paused=true;await deps.control('pause',pinned);
  const until=deps.now()+600000;
  while(true){
   const current=assertOwnedIdentity(await deps.inspect(),scope,pinned);
   if(ownedIdle(current.health))break;
   need(deps.now()<until,'DRAIN_TIMEOUT');await deps.sleep(250);
  }
  need(await deps.children(pinned.record.pid)===0,'CHILDREN_PRESENT');
  const snapshot=await deps.snapshot(),key=snapshotKey(snapshot);
  const archive=await deps.archive(snapshot,pinned);
  need(snapshotKey(await deps.snapshot())===key,'SNAPSHOT_CHANGED');
  const final=assertOwnedIdentity(await deps.inspect(),scope,pinned);
  need(ownedIdle(final.health),'NO_LONGER_IDLE');
  need(await deps.children(pinned.record.pid)===0,'CHILDREN_PRESENT');
  need(snapshotKey(await deps.snapshot())===key,'SNAPSHOT_CHANGED');
  const exit=await deps.terminate(pinned,archive);
  need(exit?.scope==='owned-daemon-root-only'&&exit.stopped===true&&exit.pid===pinned.record.pid&&exit.creationTime===pinned.record.creationTime&&Number.isFinite(Date.parse(exit.exitedAt)),'ROOT_EXIT_UNCONFIRMED');
  terminated=true;
  need(snapshotKey(await deps.snapshot())===key,'POST_EXIT_SNAPSHOT_CHANGED');
  need(await deps.absent(pinned),'ROOT_EXIT_UNCONFIRMED');
  return {scope:'owned-daemon-root-only',stopped:true,pid:exit.pid,creationTime:exit.creationTime,exitedAt:exit.exitedAt,archiveDigest:archive.digest,historyRecordsUnchanged:true};
 }catch(error){
  // Resume only after re-proving that the exact original boot is still alive.
  if(paused&&!terminated&&pinned)try{const current=assertOwnedIdentity(await deps.inspect(),scope,pinned);await deps.control('resume',current);}catch{}
  throw error;
 }
}

function plain(file,{directory=false}={}){
 for(let at=path.resolve(file);;at=path.dirname(at)){
  const st=fs.lstatSync(at);need(!st.isSymbolicLink(),'PATH_UNSAFE');
  if(at===path.resolve(file))need(directory?st.isDirectory():st.isFile()&&st.nlink===1,'PATH_UNSAFE');
  if(path.dirname(at)===at)break;
 }
}
export function readStateSnapshot(runtimeDir){
 const files=[],directories=[];let total=0;
 const directory=dir=>{try{plain(dir,{directory:true});const names=fs.readdirSync(dir).sort();directories.push({path:dir,exists:true,names});return names;}catch(error){if(error.code==='ENOENT'){directories.push({path:dir,exists:false,names:[]});return null;}throw error;}};
 const file=p=>{try{plain(p);const st=fs.statSync(p),data=fs.readFileSync(p);total+=data.length;need(data.length<=32*1024*1024&&total<=512*1024*1024&&files.length<10000,'SNAPSHOT_TOO_LARGE');files.push({path:p,exists:true,sha256:sha(data),bytes:data.length,identity:{dev:String(st.dev),ino:String(st.ino)},data});}catch(error){if(error.code==='ENOENT')files.push({path:p,exists:false});else throw error;}};
 const connection=dir=>{directory(dir);file(path.join(dir,'action-state.json'));const delivery=path.join(dir,'action-delivery'),names=directory(delivery);if(names)for(const name of names)file(path.join(delivery,name));};
 connection(runtimeDir);
 const shared=path.join(runtimeDir,'shared-workspaces'),workspaces=directory(shared);
 if(workspaces)for(const workspace of workspaces){const devices=directory(path.join(shared,workspace));if(devices)for(const device of devices)connection(path.join(shared,workspace,device));}
 return {files:files.sort((a,b)=>a.path.localeCompare(b.path)),directories:directories.sort((a,b)=>a.path.localeCompare(b.path))};
}
function durableNew(file,data){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
const run=promisify(execFile);
export async function runJsonChild(file,args,input,options={}){
 const pending=run(file,args,{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:128*1024,...options});
 pending.child.stdin.on('error',()=>{});pending.child.stdin.end(input===undefined?'':JSON.stringify(input));
 const {stdout}=await pending;return JSON.parse(stdout.replace(/^\uFEFF/,'').trim());
}
async function ps(code,input){
 return runJsonChild('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from("[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);"+code,'utf16le').toString('base64')],input);
}
async function jsonHttp(origin,endpoint,{body,token}={}){
 const response=await fetch(origin+endpoint,{method:body?'POST':'GET',redirect:'error',headers:body?{'content-type':'application/json','x-ziwei-local-control':token}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(3000)});
 need(response.ok,'LOCAL_CONTROL_REFUSED');const result=await response.json();need(result&&typeof result==='object','HEALTH_INVALID');return result;
}
export async function productionStop(planFile){
 need(process.platform==='win32','WINDOWS_ONLY');plain(planFile);
 const plan=JSON.parse(fs.readFileSync(planFile,'utf8')),directory=path.dirname(planFile),root=plan.root;
 need(plan.task==='Ziwei.TK.Update.fbb52e2'&&plan.workspace===WORKSPACE&&plan.deviceId===DEVICE&&samePath(root,'C:\\Users\\PC\\AppData\\Roaming\\npm\\node_modules\\ziwei')&&samePath(plan.configPath,path.join(process.env.LOCALAPPDATA,'Ziwei','ziwei_user','ziwei_user.json')),'PLAN_MISMATCH');
 const configBytes=fs.readFileSync(plan.configPath),configHash=sha(configBytes),config=JSON.parse(configBytes);
 const official=await import(pathToFileURL(path.join(root,'scripts/client-lifecycle.mjs'))),configuration=await import(pathToFileURL(path.join(root,'daemon/config.mjs'))),bootstrap=await import(pathToFileURL(path.join(root,'src/management-bootstrap.mjs')));
 need(bootstrap.clientBuildIdentity(root)===OLD_BUILD&&config.workspace===WORKSPACE&&config.deviceId===DEVICE&&config.deviceToken&&config.healthHost==='127.0.0.1'&&config.healthPort===20242,'IDENTITY_CHANGED');
 const resolved=configuration.resolveWorkspaceConnections(config,{configPath:plan.configPath,root});need(resolved.errors.length===0,'CONNECTIONS_CHANGED');
 const connections=resolved.connections.map(x=>({workspace:x.workspace,deviceId:x.deviceId,primary:x.primary})).sort((a,b)=>canon(a).localeCompare(canon(b)));
 const runtimeDir=path.join(plan.userDirectory,'runtime'),origin='http://127.0.0.1:20242';
 const scope={root,configPath:plan.configPath,runtimeDir,ownerSid:plan.ownerSid,connections,executable:process.execPath};
 const archiveDir=path.join(directory,'owned-idle-archive'),exitFile=path.join(archiveDir,'service-exit.json'),handleFile=path.join(directory,'owned-idle-handle.ps1');
 plain(handleFile);need(sha(fs.readFileSync(handleFile))===HANDLE_SHA,'HELPER_SHA_MISMATCH');
 const currentSid=await ps("$ErrorActionPreference='Stop';[pscustomobject]@{sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value}|ConvertTo-Json -Compress");need(currentSid.sid===scope.ownerSid,'OWNER_CHANGED');
 const inspect=async()=>{
  need(sha(fs.readFileSync(plan.configPath))===configHash&&bootstrap.clientBuildIdentity(root)===OLD_BUILD,'IDENTITY_CHANGED');
  const proof=await official.inspectClientMaintenance({root,configPath:plan.configPath,env:process.env});need(proof.wasRunning===true&&proof.state==='ready','IDENTITY_CHANGED');
  const health=await jsonHttp(origin,'/healthz');need(health.pid===proof.pid,'IDENTITY_CHANGED');
  const record=await official.inspectNativeClientProcess(health.pid,root);await official.inspectNativeHealthListener(origin,health.pid);
  const owner=await ps("$ErrorActionPreference='Stop';$p=Get-CimInstance Win32_Process -Filter 'ProcessId = "+health.pid+"';$o=Invoke-CimMethod -InputObject $p -MethodName GetOwnerSid -ErrorAction Stop;if($o.ReturnValue -ne 0){throw 'OWNER_CHANGED'};[pscustomobject]@{sid=$o.Sid}|ConvertTo-Json -Compress");
  return {health,record,ownerSid:owner.sid,configSha256:configHash};
 };
 const deps={inspect,now:()=>performance.now(),sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms)),children:async pid=>(await ps("$ErrorActionPreference='Stop';[pscustomobject]@{count=@(Get-CimInstance Win32_Process -Filter 'ParentProcessId = "+pid+"' -Property ProcessId -ErrorAction Stop).Count}|ConvertTo-Json -Compress")).count,
  control:async(operation,pinned)=>{const h=await jsonHttp(origin,'/local/connection-control',{body:{operation,nonce:pinned.health.lifecycle.nonce},token:config.deviceToken});need(h.lifecycle?.nonce===pinned.health.lifecycle.nonce,'IDENTITY_CHANGED');},
  snapshot:async()=>readStateSnapshot(runtimeDir),
  archive:async(snapshot,pinned)=>{
   need(!fs.existsSync(archiveDir),'ARCHIVE_EXISTS');fs.mkdirSync(archiveDir,{mode:0o700});plain(archiveDir,{directory:true});
   const copies=[];
   for(const [i,row]of snapshot.files.entries())if(row.exists){const target=path.join(archiveDir,`file-${i}.original`);durableNew(target,row.data);need(sha(fs.readFileSync(target))===row.sha256,'ARCHIVE_CHANGED');copies.push({path:target,exists:true,sha256:row.sha256});}
   const manifest={schemaVersion:1,scope:'owned-daemon-root-only',record:pinned.record,configSha256:configHash,nonce:pinned.health.lifecycle.nonce,files:snapshot.files.map(({data,...x})=>x),directories:snapshot.directories};
   const bytes=Buffer.from(JSON.stringify(manifest)),file=path.join(archiveDir,'manifest.json');durableNew(file,bytes);return {digest:sha(bytes),copies,manifest:{path:file,exists:true,sha256:sha(bytes)},snapshot};
  },
  terminate:async(pinned,archive)=>{
   const l=pinned.health.lifecycle;
   const spec={...pinned.record,ownerSid:scope.ownerSid,origin,host:'127.0.0.1',port:20242,root,configPath:plan.configPath,configSha256:configHash,build:OLD_BUILD,workspace:WORKSPACE,deviceId:DEVICE,nonce:l.nonce,runtimeDir,startedAt:l.startedAt,connections,files:[...archive.snapshot.files.map(({data,...x})=>x),...archive.copies,archive.manifest],directories:archive.snapshot.directories,exitFile,waitMs:8000};
   need(sha(fs.readFileSync(handleFile))===HANDLE_SHA,'HELPER_SHA_MISMATCH');
   const output=await ps(fs.readFileSync(handleFile,'utf8'),spec);need(output?.stopped===true,'ROOT_EXIT_UNCONFIRMED');
   plain(exitFile);const saved=JSON.parse(fs.readFileSync(exitFile));need(canon(saved)===canon(output),'ROOT_EXIT_UNCONFIRMED');return output;
  },
  absent:async pinned=>{need(!await official.inspectNativeClientProcess(pinned.record.pid,root),'ROOT_EXIT_UNCONFIRMED');return await strictAbsent(official,root,plan.configPath,origin);}
 };
 const result=await stopOwnedIdle(scope,deps);
 durableNew(path.join(directory,'owned-idle-stop-complete.json'),JSON.stringify(result));return result;
}
async function strictAbsent(official,root,configPath,origin){
 const status=await official.inspectClientMaintenance({root,configPath,env:process.env});need(status.state==='stopped'&&status.wasRunning===false,'ROOT_EXIT_UNCONFIRMED');
 // Inventory every Node executable, including a replacement using another Node installation.
 const nodes=await ps("$ErrorActionPreference='Stop';$rows=@(Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" -ErrorAction Stop | ForEach-Object {if(-not $_.ExecutablePath -or -not $_.CommandLine){throw 'UNKNOWN_NODE'};[pscustomobject]@{command=$_.CommandLine}});ConvertTo-Json -InputObject $rows -Compress");
 need(Array.isArray(nodes),'ROOT_EXIT_UNCONFIRMED');
 for(const row of nodes){const args=official.windowsCommandArguments(String(row.command||''));need(args.length>0&&!args.some(x=>samePath(x,path.join(root,'daemon/ziwei_user.mjs'))),'ROOT_EXIT_UNCONFIRMED');}
 const listeners=await ps("$ErrorActionPreference='Stop';$rows=@(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object {$_.LocalPort -eq 20242} | ForEach-Object {[int]$_.OwningProcess});ConvertTo-Json -InputObject $rows -Compress");need(Array.isArray(listeners)&&listeners.length===0,'ROOT_EXIT_UNCONFIRMED');
 try{await jsonHttp(origin,'/healthz');return false;}catch(error){return error?.cause?.code==='ECONNREFUSED';}
}
export async function restoreOriginal(deps){
 const proof=await deps.verify();
 need(proof?.exit?.scope==='owned-daemon-root-only'&&proof.exit.stopped===true&&proof.exit.pid===proof.record?.pid&&proof.exit.creationTime===proof.record.creationTime&&Number.isFinite(Date.parse(proof.exit.exitedAt))&&proof.build===OLD_BUILD&&proof.configUnchanged===true&&proof.archiveVerified===true,'ORIGINAL_RESTART_UNVERIFIED');
 need(await deps.absent(),'ORIGINAL_RESTART_UNVERIFIED');
 await deps.start(); // Normal official start; never another termination or update.
 need(await deps.ready(),'ORIGINAL_RESTART_UNVERIFIED');
 return {state:'original_restarted',clientBuild:OLD_BUILD,originalFailurePreserved:true};
}
export async function productionRestore(planFile){
 need(process.platform==='win32','WINDOWS_ONLY');plain(planFile);
 const plan=JSON.parse(fs.readFileSync(planFile)),root=plan.root,directory=path.dirname(planFile),archive=path.join(directory,'owned-idle-archive');
 need(plan.task==='Ziwei.TK.Update.fbb52e2'&&plan.workspace===WORKSPACE&&plan.deviceId===DEVICE&&samePath(root,'C:\\Users\\PC\\AppData\\Roaming\\npm\\node_modules\\ziwei')&&samePath(plan.configPath,path.join(process.env.LOCALAPPDATA,'Ziwei','ziwei_user','ziwei_user.json'))&&samePath(process.execPath,path.join(plan.nodeDirectory,'node.exe')),'PLAN_MISMATCH');
 const manifestFile=path.join(archive,'manifest.json'),exitFile=path.join(archive,'service-exit.json');plain(manifestFile);plain(exitFile);
 const manifest=JSON.parse(fs.readFileSync(manifestFile)),exit=JSON.parse(fs.readFileSync(exitFile));
 const bootstrap=await import(pathToFileURL(path.join(root,'src/management-bootstrap.mjs'))),official=await import(pathToFileURL(path.join(root,'scripts/client-lifecycle.mjs')));
 const configHash=sha(fs.readFileSync(plan.configPath)),config=JSON.parse(fs.readFileSync(plan.configPath));
 const owner=await ps("$ErrorActionPreference='Stop';[pscustomobject]@{sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value}|ConvertTo-Json -Compress");
 need(owner.sid===plan.ownerSid&&manifest.scope==='owned-daemon-root-only'&&samePath(manifest.record?.executable,process.execPath)&&config.workspace===WORKSPACE&&config.deviceId===DEVICE&&config.deviceToken&&configHash===manifest.configSha256,'ORIGINAL_RESTART_UNVERIFIED');
 for(const [i,row]of manifest.files.entries())if(row.exists){const file=path.join(archive,`file-${i}.original`);plain(file);need(sha(fs.readFileSync(file))===row.sha256,'ORIGINAL_RESTART_UNVERIFIED');}
 const origin='http://127.0.0.1:20242';
 return restoreOriginal({verify:async()=>({exit,record:manifest.record,build:bootstrap.clientBuildIdentity(root),configUnchanged:sha(fs.readFileSync(plan.configPath))===manifest.configSha256,archiveVerified:true}),absent:()=>strictAbsent(official,root,plan.configPath,origin),start:async()=>{await run(process.execPath,[path.join(root,'scripts/ziwei-user.mjs'),'start'],{env:process.env,windowsHide:true,timeout:60000,maxBuffer:128*1024});},ready:async()=>{for(let i=0;i<40;i++){try{const h=await jsonHttp(origin,'/readyz');if(h.ready===true&&h.service==='ziwei_user'&&h.workspace===WORKSPACE&&h.deviceId===DEVICE&&h.clientBuild===OLD_BUILD&&h.lifecycle?.configSha256===manifest.configSha256&&samePath(h.lifecycle.root,root)){await official.inspectClientMaintenance({root,configPath:plan.configPath,env:process.env});return true;}}catch{}await new Promise(resolve=>setTimeout(resolve,500));}return false;}});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const restoring=process.argv[2]==='--restore-original',result=await(restoring?productionRestore(path.resolve(process.argv[3])):productionStop(path.resolve(process.argv[2])));process.stdout.write(JSON.stringify(restoring?result:{state:'complete',scope:result.scope,stopped:true,historyRecordsUnchanged:true})+'\n');}
 catch(error){const codes=['IDENTITY_CHANGED','CONNECTIONS_CHANGED','CLIENT_ALREADY_DRAINING','DRAIN_TIMEOUT','CHILDREN_PRESENT','SNAPSHOT_INVALID','SNAPSHOT_CHANGED','NO_LONGER_IDLE','POST_EXIT_SNAPSHOT_CHANGED','ROOT_EXIT_UNCONFIRMED','PATH_UNSAFE','SNAPSHOT_TOO_LARGE','LOCAL_CONTROL_REFUSED','HEALTH_INVALID','WINDOWS_ONLY','PLAN_MISMATCH','HELPER_SHA_MISMATCH','OWNER_CHANGED','ARCHIVE_EXISTS','ARCHIVE_CHANGED','ORIGINAL_RESTART_UNVERIFIED'];const safe={state:'failed',code:codes.includes(error?.code)?error.code:'OWNED_IDLE_STOP_REFUSED'};try{const detail=JSON.parse(error?.stdout);if(detail?.code==='OWNED_IDLE_STOP_REFUSED'){for(const key of ['line','hresult'])if(Number.isSafeInteger(detail[key]))safe[key]=detail[key];for(const key of ['terminationRequested','exitObserved'])if(typeof detail[key]==='boolean')safe[key]=detail[key];}}catch{}process.stdout.write(JSON.stringify(safe)+'\n');process.exitCode=1;}
}
