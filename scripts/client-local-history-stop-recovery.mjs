import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolveConfigPath,defaultUserDir,resolveDaemonDataDirectory} from '../daemon/config.mjs';
import {clientBuildIdentity} from '../src/management-bootstrap.mjs';
import {inspectLocalDaemonMaintenanceFiles} from '../backend/preservation-native-evidence.mjs';
import {inspectNativeClientProcess,inspectNativeHealthListener} from './client-lifecycle.mjs';
import {createForceAbandonInventory,createForceAbandonListenerCount} from './client-force-abandon-recovery.mjs';

const run=promisify(execFile),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const samePath=(a,b)=>typeof a==='string'&&typeof b==='string'&&path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
const fail=()=>Object.assign(new Error('历史记录保留停止的实例或文件证据已变化；未修改原任务'),{code:'LOCAL_HISTORY_STOP_RECOVERY_REFUSED'});
const fact=value=>{if(!value)throw fail();},notApplicable=()=>({recovered:false,reason:'not_applicable'});
function within(file,root){const relative=path.relative(path.resolve(root),path.resolve(file));return !relative||!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep);}
function noLinks(file){for(let current=path.resolve(file);;current=path.dirname(current)){let st;try{st=fs.lstatSync(current);}catch(error){if(error.code!=='ENOENT')throw error;}fact(!st?.isSymbolicLink());if(current===path.dirname(current))break;}}
function original(file){noLinks(file);const st=fs.lstatSync(file);fact(st.isFile()&&st.nlink===1);const bytes=fs.readFileSync(file);return{bytes,sha256:sha(bytes)};}
function durable(file,value){noLinks(file);const bytes=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value));let fd;try{fd=fs.openSync(file,'wx',0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{if(fd!==undefined)fs.closeSync(fd);}if(process.platform!=='win32'){fd=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}}
function loopbackOrigin(config,env){const host=String(config.healthHost||env.ZIWEI_HEALTH_HOST||'127.0.0.1').replace(/^localhost$/,'127.0.0.1'),port=Number(config.healthPort||env.ZIWEI_HEALTH_PORT||20242);fact(['127.0.0.1','::1','[::1]'].includes(host)&&Number.isSafeInteger(port)&&port>0&&port<65536);return`http://${host.includes(':')?'[::1]':host}:${port}`;}
function connectionsFor(config,runtimeDir,health){
 const entries=[{...config,primary:true},...(Array.isArray(config.sharedWorkspaces)?config.sharedWorkspaces:[]).filter(v=>v.enabled!==false).map(v=>({...v,primary:false,apiBase:v.apiBase||config.apiBase}))];
 fact(Array.isArray(health.connections)&&entries.length===health.connections.length);const seen=new Set();
 return entries.map(row=>{fact(typeof row.workspace==='string'&&/^[a-z0-9][a-z0-9_-]{1,62}$/i.test(row.workspace)&&typeof row.deviceId==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(row.deviceId)&&!seen.has(row.workspace));seen.add(row.workspace);fact(health.connections.filter(v=>v.workspace===row.workspace&&v.deviceId===row.deviceId&&v.primary===row.primary).length===1);const api=new URL(row.apiBase);fact(api.protocol==='https:'&&!api.username&&!api.password&&!api.search&&!api.hash&&api.pathname==='/');return{workspace:row.workspace,deviceId:row.deviceId,apiBase:api.origin,runtimeDir:row.primary?runtimeDir:path.join(runtimeDir,'shared-workspaces',row.workspace,row.deviceId)};});
}
const idle=(health,{allowPending=false,retainedPendingCount=0,allowPolling=false,allowActive=false}={})=>(allowActive?Number.isSafeInteger(health?.activeActionCount)&&health.activeActionCount>=0&&Array.isArray(health.connections)&&health.activeActionCount<=9*health.connections.length:health?.activeActionCount===0)&&(allowPolling?Number.isSafeInteger(health.pollingCount)&&health.pollingCount>=0&&Array.isArray(health.connections)&&health.pollingCount<=health.connections.length:health.pollingCount===0)&&health.quarantinedActionCount===0&&health.executionQuarantined===false&&health.maintenance?.gatewaySafe===true&&Array.isArray(health.maintenance.gatewayWorkers)&&health.maintenance.gatewayWorkers.length===0&&(allowPending?Number.isSafeInteger(health.maintenance.pendingDeliveryCount)&&health.maintenance.pendingDeliveryCount>=0:health.maintenance.pendingDeliveryCount===retainedPendingCount);
function assertHealth(health,c,pinned,{drained=false,allowPending=false,allowPolling=false,allowActive=false,allowMaintenanceChange=false}={}){
 fact(health?.service==='ziwei_user'&&health.agentId==='ziwei_user'&&health.pid===c.record.pid&&health.clientBuild===c.build&&health.workspace===c.config.workspace&&health.deviceId===c.config.deviceId&&idle(health,{allowPending,retainedPendingCount:c.retainedPendingCount||0,allowPolling,allowActive}));
 fact(['connected','draining'].includes(health.connectionState)&&(!drained||health.connectionState==='draining'));
 const life=health.lifecycle;fact(life&&life.nonce===pinned.lifecycle.nonce&&/^[A-Za-z0-9_-]{16,128}$/.test(life.nonce)&&samePath(life.root,c.root)&&samePath(life.configPath,c.configPath)&&life.configSha256===c.configHash&&samePath(life.runtimeDir,c.runtimeDir)&&life.startedAt===pinned.lifecycle.startedAt&&life.managedAuxiliaryCount===0&&Math.abs(Date.parse(life.startedAt)-Date.parse(c.record.creationTime))<=15000);
 fact((allowMaintenanceChange?typeof health.maintenance.safe==='boolean':health.maintenance.safe===false)&&Array.isArray(health.maintenance.fileIssues)&&(allowMaintenanceChange||health.maintenance.fileIssues.length>0)&&Array.isArray(health.connectionErrors)&&health.connectionErrors.length===0);
 fact(same(connectionsFor(c.config,c.runtimeDir,health),c.connections));
}
function inspectEvidence(inspect,connections,runtimeDir){
 const evidence=inspect({connections}),issues=evidence?.issues;fact(evidence?.safe===false&&evidence.stopSafe===true&&Array.isArray(evidence.stopIssues)&&evidence.stopIssues.length===0&&Number.isSafeInteger(evidence.retainedHistoryCount)&&evidence.retainedHistoryCount>=0&&Number.isSafeInteger(evidence.retainedFailedBackgroundCount??0)&&(evidence.retainedFailedBackgroundCount??0)>=0&&evidence.retainedHistoryCount+(evidence.retainedFailedBackgroundCount??0)>0&&Array.isArray(issues)&&issues.length>0&&issues.every(v=>['LOCAL_HISTORY_RETAINED','DELIVERY_NOT_DRAINED','BACKGROUND_PROCESS_RETAINED','FAILED_BACKGROUND_HISTORY_RETAINED'].includes(v.code))&&issues.some(v=>['LOCAL_HISTORY_RETAINED','FAILED_BACKGROUND_HISTORY_RETAINED'].includes(v.code)));
 fact(Number.isSafeInteger(evidence.retainedPendingCount??0)&&(evidence.retainedPendingCount??0)>=0&&(evidence.retainedPendingCount??0)<=evidence.retainedDeliveryCount);
 fact(issues.filter(v=>v.code==='FAILED_BACKGROUND_HISTORY_RETAINED').length===(evidence.retainedFailedBackgroundCount??0));
 for(const [code,count]of [['DELIVERY_NOT_DRAINED','retainedDeliveryCount'],['BACKGROUND_PROCESS_RETAINED','retainedBackgroundCount']])fact(!issues.some(v=>v.code===code)||Number.isSafeInteger(evidence[count])&&evidence[count]>0);
 fact(Array.isArray(evidence.files)&&evidence.files.length>0&&Array.isArray(evidence.directories)&&evidence.directories.length>0);
 const seen=new Map();for(const item of [...evidence.files,...evidence.directories])fact(typeof item.path==='string'&&path.isAbsolute(item.path)&&within(item.path,runtimeDir)&&typeof item.exists==='boolean');
 for(const item of evidence.files){fact(!seen.has(item.path)||same(seen.get(item.path),item));seen.set(item.path,item);if(item.exists)fact(hex(item.sha256)&&Number.isSafeInteger(item.bytes)&&item.bytes>=0);}
 for(const item of evidence.directories)fact(Array.isArray(item.names)&&item.names.every(v=>typeof v==='string'&&!v.includes('/')&&!v.includes('\\')));
 return evidence;
}
const fingerprint=e=>sha(JSON.stringify({files:e.files,directories:e.directories,issues:e.issues,retainedHistoryCount:e.retainedHistoryCount,retainedDeliveryCount:e.retainedDeliveryCount,retainedBackgroundCount:e.retainedBackgroundCount,retainedFailedBackgroundCount:e.retainedFailedBackgroundCount??0,retainedPendingCount:e.retainedPendingCount??0}));

export const LOCAL_HISTORY_NATIVE_RULES=Object.freeze(["LH00_NATIVE_ERROR", "LH01_PATH_NO_REPARSE", "LH02_PROCESS_CREATION", "LH03_PROCESS_TIME", "LH04_PROCESS_COMMAND", "LH05_LISTENER", "LH06_CONFIG_HASH", "LH07_HEALTH_IDENTITY", "LH08_HEALTH_IDLE", "LH09_HEALTH_LIFECYCLE", "LH10_HEALTH_MAINTENANCE", "LH11_HEALTH_CONNECTIONS", "LH12_CONNECTION_SCOPE", "LH13_DIRECTORY_ABSENCE", "LH14_DIRECTORY_COUNT", "LH15_DIRECTORY_NAMES", "LH16_SOURCE_ABSENCE", "LH17_SOURCE_HASH", "LH18_SNAPSHOT_HASH", "LH19_EXIT_ABSENCE_PRESTOP", "LH20_DAEMON_CHILDREN", "LH21_LAST_IDENTITY", "LH22_DAEMON_EXIT", "LH23_EXIT_ABSENCE_POSTSTOP"]);
const nativeRules=new Set(LOCAL_HISTORY_NATIVE_RULES);
const nativeFailure=rule=>Object.assign(fail(),{reasonCode:rule==='LH00_NATIVE_ERROR'?'NATIVE_OBSERVATION_FAILED':'NATIVE_ASSERTION_FAILED',recoveryRule:rule});
function closedNativeRule(stdout){const text=typeof stdout==='string'?stdout.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').replace(/\n$/,''):'';const match=/^ZIWEI_LOCAL_HISTORY_RULE:(LH[0-9]{2}_[A-Z_]+)$/.exec(text);return match&&nativeRules.has(match[1])?match[1]:null;}

// Native identity, listener, local idle health and every original file are
// rechecked while one exact Windows Process handle is held across Kill/Wait.
export const LOCAL_HISTORY_STOP_HANDLE_PROGRAM=String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
$script:ziweiLocalHistoryRule=$null
try{
$d=([Console]::In.ReadToEnd()|ConvertFrom-Json)
function Assert-Fact([string]$rule,$v){if(!$v){$script:ziweiLocalHistoryRule=$rule;throw 'ZIWEI_LOCAL_HISTORY_ASSERTION_FAILED'}}
function File-Hash($f){$h=[Security.Cryptography.SHA256]::Create();try{return [BitConverter]::ToString($h.ComputeHash([IO.File]::ReadAllBytes($f))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}}
function Text-Hash($v){$h=[Security.Cryptography.SHA256]::Create();try{return [BitConverter]::ToString($h.ComputeHash([Text.Encoding]::UTF8.GetBytes($v))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}}
function No-Link($f){$i=Get-Item -LiteralPath $f -Force;while($i){Assert-Fact 'LH01_PATH_NO_REPARSE' (($i.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0);$parent=Split-Path -Parent $i.FullName;if(!$parent -or $parent -eq $i.FullName){break};$i=Get-Item -LiteralPath $parent -Force}}
$p=Get-Process -Id $d.pid -ErrorAction Stop
try{
 $heldHandle=$p.Handle
 $native=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$d.pid)
 Assert-Fact 'LH02_PROCESS_CREATION' ($native -and $native.CreationDate.ToUniversalTime().ToString('o') -ceq $d.creationTime)
 Assert-Fact 'LH03_PROCESS_TIME' ([Math]::Abs(($p.StartTime.ToUniversalTime()-$native.CreationDate.ToUniversalTime()).TotalMilliseconds) -le 2)
 Assert-Fact 'LH04_PROCESS_COMMAND' ($native.ExecutablePath -ieq $d.executable -and (Text-Hash $native.CommandLine) -ceq $d.commandHash)
 $listeners=@(Get-NetTCPConnection -State Listen -LocalPort $d.port -ErrorAction Stop|Where-Object {$_.LocalAddress -eq $d.host})
 Assert-Fact 'LH05_LISTENER' ($listeners.Count -eq 1 -and $listeners[0].OwningProcess -eq $d.pid)
 No-Link $d.configPath;Assert-Fact 'LH06_CONFIG_HASH' ((File-Hash $d.configPath) -ceq $d.configSha256)
 $request=[Net.HttpWebRequest]::Create($d.origin+'/healthz');$request.Proxy=$null;$request.Timeout=3000;$response=$request.GetResponse()
 try{$reader=[IO.StreamReader]::new($response.GetResponseStream());try{$h=$reader.ReadToEnd()|ConvertFrom-Json}finally{$reader.Dispose()}}finally{$response.Dispose()}
 Assert-Fact 'LH07_HEALTH_IDENTITY' ($h.service -ceq 'ziwei_user' -and $h.agentId -ceq 'ziwei_user' -and $h.pid -eq $d.pid -and $h.clientBuild -ceq $d.build -and $h.workspace -ceq $d.workspace -and $h.deviceId -ceq $d.deviceId)
 Assert-Fact 'LH08_HEALTH_IDLE' ($h.connectionState -ceq 'draining' -and $h.activeActionCount -eq 0 -and $h.pollingCount -eq 0 -and $h.quarantinedActionCount -eq 0 -and $h.executionQuarantined -eq $false)
 Assert-Fact 'LH09_HEALTH_LIFECYCLE' ($h.lifecycle.nonce -ceq $d.nonce -and $h.lifecycle.root -ieq $d.root -and $h.lifecycle.configPath -ieq $d.configPath -and $h.lifecycle.configSha256 -ceq $d.configSha256 -and $h.lifecycle.runtimeDir -ieq $d.runtimeDir -and $h.lifecycle.startedAt -ceq $d.startedAt -and $h.lifecycle.managedAuxiliaryCount -eq 0)
 Assert-Fact 'LH10_HEALTH_MAINTENANCE' ($h.maintenance.safe -eq $false -and $h.maintenance.gatewaySafe -eq $true -and $h.maintenance.gatewayWorkers -is [Array] -and @($h.maintenance.gatewayWorkers).Count -eq 0 -and $h.maintenance.pendingDeliveryCount -eq $d.retainedPendingCount)
 Assert-Fact 'LH11_HEALTH_CONNECTIONS' ($h.connectionErrors -is [Array] -and @($h.connectionErrors).Count -eq 0 -and $h.connections -is [Array] -and @($h.connections).Count -eq @($d.connections).Count)
 foreach($c in $d.connections){Assert-Fact 'LH12_CONNECTION_SCOPE' (@($h.connections|Where-Object {$_.workspace -ceq $c.workspace -and $_.deviceId -ceq $c.deviceId -and $_.primary -eq $c.primary}).Count -eq 1)}
 foreach($item in $d.directories){if(!$item.exists){Assert-Fact 'LH13_DIRECTORY_ABSENCE' (!(Test-Path -LiteralPath $item.path));continue};No-Link $item.path;$actual=@(Get-ChildItem -LiteralPath $item.path -Force|ForEach-Object {$_.Name}|Sort-Object);$expected=@($item.names|Sort-Object);Assert-Fact 'LH14_DIRECTORY_COUNT' ($actual.Count -eq $expected.Count);for($i=0;$i -lt $actual.Count;$i++){Assert-Fact 'LH15_DIRECTORY_NAMES' ($actual[$i] -ceq $expected[$i])}}
 foreach($item in $d.files){if(!$item.exists){Assert-Fact 'LH16_SOURCE_ABSENCE' (!(Test-Path -LiteralPath $item.path));continue};No-Link $item.path;Assert-Fact 'LH17_SOURCE_HASH' ((File-Hash $item.path) -ceq $item.sha256)}
 foreach($item in $d.snapshotFiles){No-Link $item.path;Assert-Fact 'LH18_SNAPSHOT_HASH' ((File-Hash $item.path) -ceq $item.sha256)}
 No-Link ([IO.Path]::GetDirectoryName($d.exitFile));Assert-Fact 'LH19_EXIT_ABSENCE_PRESTOP' (!(Test-Path -LiteralPath $d.exitFile))
 Assert-Fact 'LH20_DAEMON_CHILDREN' (@(Get-CimInstance Win32_Process -Filter ('ParentProcessId = '+$d.pid)).Count -eq 0)
 Assert-Fact 'LH21_LAST_IDENTITY' ((File-Hash $d.configPath) -ceq $d.configSha256 -and !$p.HasExited)
 $p.Kill();Assert-Fact 'LH22_DAEMON_EXIT' ($p.WaitForExit($d.waitMs) -and $p.HasExited)
 $exit=[ordered]@{stopped=$true;pid=[int]$d.pid;creationTime=$d.creationTime;exitedAt=[DateTime]::UtcNow.ToString('o')}
 No-Link ([IO.Path]::GetDirectoryName($d.exitFile));Assert-Fact 'LH23_EXIT_ABSENCE_POSTSTOP' (!(Test-Path -LiteralPath $d.exitFile))
 $bytes=[Text.UTF8Encoding]::new($false).GetBytes(($exit|ConvertTo-Json -Compress));$stream=[IO.File]::Open($d.exitFile,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None);try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
 $exit|ConvertTo-Json -Compress
}finally{$p.Dispose()}
}catch{
 $rule=if($script:ziweiLocalHistoryRule){$script:ziweiLocalHistoryRule}else{'LH00_NATIVE_ERROR'}
 [Console]::Out.WriteLine('ZIWEI_LOCAL_HISTORY_RULE:'+$rule)
 exit 1
}
`;
export function createLocalHistoryHandleTerminator({runCommand=run}={}){return async data=>{
 let output;
 try{const pending=runCommand('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(LOCAL_HISTORY_STOP_HANDLE_PROGRAM,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:data.waitMs+15000,maxBuffer:64*1024});if(!pending.child?.stdin){await pending;throw nativeFailure('LH00_NATIVE_ERROR');}pending.child.stdin.on('error',()=>{});pending.child.stdin.end(JSON.stringify(data));output=await pending;}
 catch(error){throw nativeFailure(closedNativeRule(error?.stdout)||'LH00_NATIVE_ERROR');}
 const rule=closedNativeRule(output?.stdout);if(rule)throw nativeFailure(rule);
 try{return JSON.parse(output.stdout.replace(/^\uFEFF/,'').trim());}catch{throw nativeFailure('LH00_NATIVE_ERROR');}
};}

const nativeTerminate=createLocalHistoryHandleTerminator(),nativeInventory=createForceAbandonInventory(),nativeListenerCount=createForceAbandonListenerCount();

/** Candidate-only update hook. History/dedupe/result bytes are never rewritten. */
export function createLocalHistoryStopRecovery({platform=process.platform,inspect=inspectLocalDaemonMaintenanceFiles,inspectProcess=inspectNativeClientProcess,inspectListener=inspectNativeHealthListener,inspectInstalledProcesses=nativeInventory,inspectListenerCount=nativeListenerCount,installedBuild=clientBuildIdentity,terminate=nativeTerminate,checkpoint=()=>{}}={}){
 return async function recover({root,env=process.env,configPath,fetchImpl=globalThis.fetch,timeoutMs=15000,log=()=>{}}={}){
  let currentPhase='configuration';const phase=value=>{currentPhase=value;try{log('local_history_recovery_phase',{phase:value});}catch{}};phase('configuration');
  try{
  if(platform!=='win32')return notApplicable();fact(typeof root==='string'&&path.isAbsolute(root)&&Number.isFinite(timeoutMs)&&timeoutMs>0&&timeoutMs<=120000);root=path.resolve(root);noLinks(root);configPath=configPath?path.resolve(configPath):resolveConfigPath({root,env});let configRead;try{configRead=original(configPath);}catch(error){if(error.code==='ENOENT')return notApplicable();throw fail();}
  let config;try{config=JSON.parse(configRead.bytes);}catch{throw fail();}if(typeof config.deviceToken!=='string'||!config.deviceToken||typeof config.workspace!=='string'||typeof config.deviceId!=='string')return notApplicable();const origin=loopbackOrigin(config,env),configHash=configRead.sha256,runtimeDir=env.ZIWEI_USER_HOME?path.join(defaultUserDir({env}),'runtime'):path.join(root,'.local','runtime');
  const request=async(operation)=>{let response;try{response=await fetchImpl(origin+(operation?'/local/connection-control':'/healthz'),{...(operation?{method:'POST',headers:{'content-type':'application/json','x-ziwei-local-control':config.deviceToken},body:JSON.stringify({operation,nonce:pinned.lifecycle.nonce})}:{}),redirect:'error',signal:AbortSignal.timeout(8000)});}catch(error){if(!operation&&(error.code==='ECONNREFUSED'||error.cause?.code==='ECONNREFUSED'))return null;throw fail();}fact(response.ok);try{return await response.json();}catch{throw fail();}};
  phase('current_health');let pinned=await request();if(!pinned||!idle(pinned,{allowPending:true,allowPolling:true,allowActive:true})||pinned.maintenance?.safe!==false||pinned.maintenance.stopSafe===true)return notApplicable();
  phase('source_validation');const build=installedBuild(root);fact(hex(build));const record=await inspectProcess(pinned.pid,root);fact(record&&Number.isSafeInteger(record.pid)&&record.pid>0&&hex(record.commandHash)&&typeof record.executable==='string'&&Number.isFinite(Date.parse(record.creationTime)));const connections=connectionsFor(config,runtimeDir,pinned),c={root,configPath,configHash,config,runtimeDir,record,build,connections};assertHealth(pinned,c,pinned,{allowPending:true,allowPolling:true,allowActive:true});await inspectListener(origin,record.pid);
  let paused=false,stoppedReceipt,archiveDirectory,exitFile,terminationIntent,nativeAttempted=false,initialEvidence,initialFingerprint,retainedBackground;
  const restoreConnection=async()=>{if(!paused||pinned.connectionState!=='connected')return;fact(original(configPath).sha256===configHash&&same(await inspectProcess(record.pid,root),record)&&installedBuild(root)===build);await inspectListener(origin,record.pid);assertHealth(await request(),c,pinned,{drained:true,allowPending:true,allowPolling:true,allowActive:true,allowMaintenanceChange:true});await request('resume');paused=false;};
  try{
   phase('holder_revalidation');fact(same(await inspectInstalledProcesses(root),[record]));const current=await inspectProcess(record.pid,root);fact(same(current,record)&&original(configPath).sha256===configHash&&installedBuild(root)===build);await inspectListener(origin,record.pid);assertHealth(await request(),c,pinned,{allowPending:true,allowPolling:true,allowActive:true,allowMaintenanceChange:true});
   // A scheduler slot can belong to an already finished result delivery.
   // Pause new admission and drain existing work before reading stable history;
   // neither a busy slot nor a changing pending count ever authorizes a stop.
   phase('pause_drain');paused=true;let drained=await request('pause');assertHealth(drained,c,pinned,{drained:true,allowPending:true,allowPolling:true,allowActive:true,allowMaintenanceChange:true});const drainDeadline=Date.now()+Math.min(timeoutMs,15_000);
   while(drained.activeActionCount||drained.pollingCount){fact(Date.now()<drainDeadline);await new Promise(resolve=>setTimeout(resolve,Math.max(1,Math.min(100,drainDeadline-Date.now()))));drained=await request();assertHealth(drained,c,pinned,{drained:true,allowPending:true,allowPolling:true,allowActive:true,allowMaintenanceChange:true});}
   assertHealth(drained,c,pinned,{drained:true,allowPending:true,allowMaintenanceChange:true});
   phase('local_archive_validation');try{initialEvidence=inspectEvidence(inspect,connections,runtimeDir);}catch{await restoreConnection();return notApplicable();}c.retainedPendingCount=initialEvidence.retainedPendingCount??0;if(drained.maintenance.pendingDeliveryCount!==c.retainedPendingCount){await restoreConnection();return notApplicable();}assertHealth(drained,c,pinned,{drained:true});
   retainedBackground={retainedFailedBackgroundCount:initialEvidence.retainedFailedBackgroundCount??0,retainedPendingCount:c.retainedPendingCount,backgroundProcessesPreserved:(initialEvidence.retainedFailedBackgroundCount??0)>0||initialEvidence.retainedBackgroundCount>0};initialFingerprint=fingerprint(initialEvidence);
   phase('archive_backup');const parent=path.join(resolveDaemonDataDirectory({root,env}),'maintenance');noLinks(parent);fs.mkdirSync(parent,{recursive:true,mode:0o700});archiveDirectory=path.join(parent,'retained-local-history-'+randomUUID());fs.mkdirSync(archiveDirectory,{mode:0o700});const copies=[];
   for(const [index,item]of initialEvidence.files.entries()){if(!item.exists)continue;const read=original(item.path);fact(read.sha256===item.sha256&&read.bytes.length===item.bytes);const name=String(index).padStart(5,'0')+'.original';durable(path.join(archiveDirectory,name),read.bytes);copies.push({path:item.path,sha256:item.sha256,bytes:item.bytes,snapshot:name});}
   exitFile=path.join(archiveDirectory,'daemon-exit.json');const manifest={schemaVersion:1,kind:'retained-local-history-stop',root,configPath,configSha256:configHash,runtimeDir,build,process:record,nonce:pinned.lifecycle.nonce,files:copies,observedFiles:initialEvidence.files,directories:initialEvidence.directories,retainedHistoryCount:initialEvidence.retainedHistoryCount,...retainedBackground,originalExecutionExitConfirmed:false};durable(path.join(archiveDirectory,'manifest.json'),manifest);const snapshotFiles=[...copies.map(item=>({path:path.join(archiveDirectory,item.snapshot),sha256:item.sha256})),{path:path.join(archiveDirectory,'manifest.json'),sha256:original(path.join(archiveDirectory,'manifest.json')).sha256}];checkpoint('snapshot',manifest);
   phase('holder_revalidation');fact(same(await inspectInstalledProcesses(root),[record]));fact(original(configPath).sha256===configHash&&installedBuild(root)===build&&same(await inspectProcess(record.pid,root),record));await inspectListener(origin,record.pid);assertHealth(await request(),c,pinned,{drained:true});fact(fingerprint(inspectEvidence(inspect,connections,runtimeDir))===initialFingerprint);
   terminationIntent={schemaVersion:1,kind:'exact-idle-daemon-stop-intent',process:record,root,configPath,configSha256:configHash,build,nonce:pinned.lifecycle.nonce,runtimeDir,evidenceFingerprint:initialFingerprint,snapshotFiles,originalExecutionExitConfirmed:false};durable(path.join(archiveDirectory,'termination-intent.json'),terminationIntent);const nativeSnapshotFiles=[...snapshotFiles,{path:path.join(archiveDirectory,'termination-intent.json'),sha256:original(path.join(archiveDirectory,'termination-intent.json')).sha256}];
   phase('terminate');nativeAttempted=true;const url=new URL(origin),output=await terminate({pid:record.pid,creationTime:record.creationTime,commandHash:record.commandHash,executable:record.executable,origin,host:url.hostname.replace(/^\[|\]$/g,''),port:Number(url.port),root,configPath,configSha256:configHash,build,workspace:config.workspace,deviceId:config.deviceId,nonce:pinned.lifecycle.nonce,runtimeDir,startedAt:pinned.lifecycle.startedAt,connections:[{workspace:config.workspace,deviceId:config.deviceId,primary:true},...(config.sharedWorkspaces||[]).filter(v=>v.enabled!==false).map(v=>({workspace:v.workspace,deviceId:v.deviceId,primary:false}))],files:initialEvidence.files,directories:initialEvidence.directories,snapshotFiles:nativeSnapshotFiles,retainedPendingCount:c.retainedPendingCount,exitFile,waitMs:Math.min(8000,timeoutMs)});
   phase('exit_validation');fact(output?.stopped===true&&output.pid===record.pid&&output.creationTime===record.creationTime&&Number.isFinite(Date.parse(output.exitedAt))&&same(JSON.parse(original(exitFile).bytes),output));stoppedReceipt={stopped:true,wasRunning:true,pid:record.pid,creationTime:record.creationTime,originalExecutionExitConfirmed:false,executionConfirmedStopped:false,localHistoryRetained:true,retainedHistoryCount:initialEvidence.retainedHistoryCount,...retainedBackground,archiveDirectory};checkpoint('daemon_exited',stoppedReceipt);
   phase('post_exit_validation');fact((await inspectInstalledProcesses(root)).length===0&&await inspectListenerCount(origin)===0&&!(await request())&&!(await inspectProcess(record.pid,root))&&original(configPath).sha256===configHash&&fingerprint(inspectEvidence(inspect,connections,runtimeDir))===initialFingerprint);for(const item of copies)fact(original(path.join(archiveDirectory,item.snapshot)).sha256===item.sha256&&original(item.path).sha256===item.sha256);phase('receipt_commit');durable(path.join(archiveDirectory,'receipt.json'),stoppedReceipt);return{recovered:true,...stoppedReceipt};
  }catch(error){const refused=fail();refused.recoveryPhase=currentPhase;if(['NATIVE_ASSERTION_FAILED','NATIVE_OBSERVATION_FAILED'].includes(error?.reasonCode)&&nativeRules.has(error?.recoveryRule)){refused.reasonCode=error.reasonCode;refused.recoveryRule=error.recoveryRule;}if(!stoppedReceipt&&exitFile&&fs.existsSync(exitFile)){try{const saved=JSON.parse(original(exitFile).bytes);fact(saved.stopped===true&&saved.pid===record.pid&&saved.creationTime===record.creationTime&&Number.isFinite(Date.parse(saved.exitedAt)));stoppedReceipt={stopped:true,wasRunning:true,pid:record.pid,creationTime:record.creationTime,originalExecutionExitConfirmed:false,executionConfirmedStopped:false,localHistoryRetained:true,retainedHistoryCount:initialEvidence.retainedHistoryCount,...retainedBackground,archiveDirectory};}catch{}}if(nativeAttempted&&terminationIntent&&archiveDirectory){try{
    phase('post_exit_validation');fact(same(JSON.parse(original(path.join(archiveDirectory,'termination-intent.json')).bytes),terminationIntent));fact(original(configPath).sha256===configHash&&installedBuild(root)===build&&fingerprint(inspectEvidence(inspect,connections,runtimeDir))===initialFingerprint);for(const item of terminationIntent.snapshotFiles)fact(original(item.path).sha256===item.sha256);
    fact(!(await inspectProcess(record.pid,root))&&(await inspectInstalledProcesses(root)).length===0&&await inspectListenerCount(origin)===0&&!(await request()));fact(original(configPath).sha256===configHash&&installedBuild(root)===build&&fingerprint(inspectEvidence(inspect,connections,runtimeDir))===initialFingerprint);fact((await inspectInstalledProcesses(root)).length===0&&await inspectListenerCount(origin)===0);
    stoppedReceipt={stopped:true,wasRunning:true,pid:record.pid,creationTime:record.creationTime,originalExecutionExitConfirmed:false,executionConfirmedStopped:false,localHistoryRetained:true,retainedHistoryCount:initialEvidence.retainedHistoryCount,...retainedBackground,archiveDirectory,daemonAbsenceObserved:true,stopObservationPersisted:false};
    try{durable(path.join(archiveDirectory,'daemon-absence-observation.json'),{schemaVersion:1,kind:'exact-daemon-absence-after-stop-attempt',process:record,nonce:pinned.lifecycle.nonce,configSha256:configHash,evidenceFingerprint:initialFingerprint,originalExecutionExitConfirmed:false});stoppedReceipt.stopObservationPersisted=true;}catch{}
   }catch{}}if(stoppedReceipt?.daemonAbsenceObserved===true&&stoppedReceipt.stopObservationPersisted===true){phase('receipt_commit');return{recovered:true,...stoppedReceipt};}if(stoppedReceipt)refused.stoppedClientReceipt=stoppedReceipt;else if(paused&&pinned.connectionState==='connected'){try{await restoreConnection();refused.resumed=true;}catch{refused.resumeFailed=true;}}throw refused;}
  }catch(error){const refused=error?.code==='LOCAL_HISTORY_STOP_RECOVERY_REFUSED'?error:fail();refused.recoveryPhase=refused.recoveryPhase||currentPhase;refused.reasonCode=['NATIVE_ASSERTION_FAILED','NATIVE_OBSERVATION_FAILED'].includes(refused.reasonCode)&&nativeRules.has(refused.recoveryRule)?refused.reasonCode:'EVIDENCE_MISMATCH';try{log('local_history_recovery_failed',{phase:refused.recoveryPhase,reasonCode:refused.reasonCode,...(nativeRules.has(refused.recoveryRule)?{recoveryRule:refused.recoveryRule}:{})});}catch{}throw refused;}
 };
}
export const recoverLocalHistoryStopForUpdate=createLocalHistoryStopRecovery();
