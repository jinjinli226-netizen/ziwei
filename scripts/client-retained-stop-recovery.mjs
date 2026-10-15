import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';

const run=promisify(execFile);
const digest=value=>createHash('sha256').update(value).digest('hex');
const samePath=(left,right)=>typeof left==='string'&&typeof right==='string'&&path.resolve(left).toLowerCase()===path.resolve(right).toLowerCase();
const fail=()=>Object.assign(new Error('旧客户端不符合仅保留已退出回执的升级条件；未强制停止'),{code:'RETAINED_STOP_RECOVERY_REFUSED'});
const requireFact=value=>{if(!value)throw fail();};
const within=(file,root)=>{const relative=path.relative(root,file);return !relative||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};

function assertOldIdleHealth(body,context,pinned){
  const config=context.snapshot.config,lifecycle=body?.lifecycle,maintenance=body?.maintenance;
  requireFact(body?.service==='ziwei_user'&&body.agentId==='ziwei_user'&&body.pid===pinned.pid&&body.clientBuild===context.build&&body.workspace===config.workspace&&body.deviceId===config.deviceId);
  requireFact(body.connectionState==='draining'&&body.activeActionCount===0&&body.pollingCount===0&&body.quarantinedActionCount===0&&body.executionQuarantined!==true);
  requireFact(lifecycle&&lifecycle.nonce===pinned.lifecycle.nonce&&samePath(lifecycle.root,context.root)&&samePath(lifecycle.configPath,context.file)&&lifecycle.configSha256===context.snapshot.hash&&samePath(lifecycle.runtimeDir,pinned.lifecycle.runtimeDir)&&lifecycle.managedAuxiliaryCount===0&&lifecycle.startedAt===pinned.lifecycle.startedAt);
  requireFact(maintenance?.safe===false&&!Object.hasOwn(maintenance,'stopSafe')&&Array.isArray(maintenance.fileIssues)&&maintenance.fileIssues.length>0&&maintenance.fileIssues.every(issue=>issue?.code==='DELIVERY_NOT_DRAINED'));
  requireFact(Array.isArray(maintenance.gatewayWorkers)&&maintenance.gatewayWorkers.every(worker=>worker?.processAlive===false&&worker.pendingCommands===0&&worker.inFlight===0&&worker.pendingInbound===0));
}

function connectionsFor(context,health){
  const config=context.snapshot.config,base=health.lifecycle.runtimeDir;
  requireFact(path.isAbsolute(base)&&Array.isArray(health.connections));
  const entries=[{...config,primary:true},...(Array.isArray(config.sharedWorkspaces)?config.sharedWorkspaces:[]).filter(item=>item.enabled!==false).map(item=>({...item,apiBase:item.apiBase||config.apiBase,primary:false}))];
  const keys=new Set();
  return entries.map(entry=>{
    requireFact(typeof entry.workspace==='string'&&/^[a-z0-9][a-z0-9_-]{1,62}$/i.test(entry.workspace)&&typeof entry.deviceId==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(entry.deviceId)&&!keys.has(entry.workspace));keys.add(entry.workspace);
    const observed=health.connections.filter(row=>row.workspace===entry.workspace&&row.deviceId===entry.deviceId&&row.primary===entry.primary);
    requireFact(observed.length===1&&health.connections.length===entries.length);
    const api=new URL(entry.apiBase);requireFact(api.protocol==='https:'&&!api.username&&!api.password&&!api.search&&!api.hash&&api.pathname==='/');
    return {workspace:entry.workspace,deviceId:entry.deviceId,apiBase:api.origin,runtimeDir:entry.primary?base:path.join(base,'shared-workspaces',entry.workspace,entry.deviceId)};
  });
}

function verifiedEvidence(inspect,connections,runtimeDir){
  const evidence=inspect({connections});
  requireFact(evidence.safe===false&&evidence.stopSafe===true&&Number.isSafeInteger(evidence.retainedDeliveryCount)&&evidence.retainedDeliveryCount>0&&Array.isArray(evidence.stopIssues)&&evidence.stopIssues.length===0&&Array.isArray(evidence.issues)&&evidence.issues.length>0&&evidence.issues.every(issue=>issue.code==='DELIVERY_NOT_DRAINED'));
  requireFact(Array.isArray(evidence.files)&&evidence.files.length>0&&Array.isArray(evidence.directories)&&evidence.directories.length>0);
  for(const item of [...evidence.files,...evidence.directories])requireFact(typeof item.path==='string'&&path.isAbsolute(item.path)&&within(item.path,runtimeDir)&&typeof item.exists==='boolean');
  for(const item of evidence.files)if(item.exists)requireFact(/^[a-f0-9]{64}$/.test(item.sha256)&&Number.isSafeInteger(item.bytes)&&item.bytes>=0);
  for(const item of evidence.directories)requireFact(Array.isArray(item.names)&&item.names.every(name=>typeof name==='string'));
  return evidence;
}
const evidenceFingerprint=evidence=>digest(JSON.stringify({files:evidence.files,directories:evidence.directories,retainedDeliveryCount:evidence.retainedDeliveryCount}));

// All final checks occur while this exact System.Diagnostics.Process handle is
// held. Neither Stop-Process nor taskkill is allowed to resolve a fresh PID.
export const RETAINED_STOP_HANDLE_PROGRAM=String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding=[System.Text.UTF8Encoding]::new($false)
$d=([Console]::In.ReadToEnd() | ConvertFrom-Json)
function Assert-Fact($value){if(!$value){throw 'Retained stop identity or evidence changed'}}
function File-Hash($file){$h=[Security.Cryptography.SHA256]::Create();try{return [BitConverter]::ToString($h.ComputeHash([IO.File]::ReadAllBytes($file))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}}
function Text-Hash($value){$h=[Security.Cryptography.SHA256]::Create();try{return [BitConverter]::ToString($h.ComputeHash([Text.Encoding]::UTF8.GetBytes($value))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}}
function No-Link($file){$item=Get-Item -LiteralPath $file -Force -ErrorAction Stop;while($item){Assert-Fact (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0);$parent=Split-Path -Parent $item.FullName;if(!$parent -or $parent -eq $item.FullName){break};$item=Get-Item -LiteralPath $parent -Force -ErrorAction Stop}}
$p=Get-Process -Id $d.pid -ErrorAction Stop
try{
 $heldHandle=$p.Handle
 $native=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$d.pid)
 Assert-Fact ($native -and $native.CreationDate.ToUniversalTime().ToString('o') -ceq $d.creationTime)
 Assert-Fact ([Math]::Abs(($p.StartTime.ToUniversalTime()-$native.CreationDate.ToUniversalTime()).TotalMilliseconds) -le 2)
 Assert-Fact ($native.ExecutablePath -ieq $d.executable)
 Assert-Fact ((Text-Hash $native.CommandLine) -ceq $d.commandHash)
 $listeners=@(Get-NetTCPConnection -State Listen -LocalPort $d.port -ErrorAction Stop | Where-Object {$_.LocalAddress -eq $d.host})
 Assert-Fact ($listeners.Count -eq 1 -and $listeners[0].OwningProcess -eq $d.pid)
 No-Link $d.configPath
 Assert-Fact ((File-Hash $d.configPath) -ceq $d.configSha256)
 $request=[Net.HttpWebRequest]::Create($d.origin+'/healthz');$request.Proxy=$null;$request.Timeout=3000;$response=$request.GetResponse()
 try{$reader=[IO.StreamReader]::new($response.GetResponseStream());try{$health=$reader.ReadToEnd()|ConvertFrom-Json}finally{$reader.Dispose()}}finally{$response.Dispose()}
 Assert-Fact ($health.service -ceq 'ziwei_user' -and $health.agentId -ceq 'ziwei_user' -and $health.pid -eq $d.pid -and $health.clientBuild -ceq $d.build -and $health.workspace -ceq $d.workspace -and $health.deviceId -ceq $d.deviceId)
 Assert-Fact ($health.connectionState -ceq 'draining' -and $health.activeActionCount -eq 0 -and $health.pollingCount -eq 0 -and $health.quarantinedActionCount -eq 0 -and $health.executionQuarantined -ne $true)
 Assert-Fact ($health.lifecycle.nonce -ceq $d.nonce -and $health.lifecycle.root -ieq $d.root -and $health.lifecycle.configPath -ieq $d.configPath -and $health.lifecycle.configSha256 -ceq $d.configSha256 -and $health.lifecycle.runtimeDir -ieq $d.runtimeDir -and $health.lifecycle.startedAt -ceq $d.startedAt -and $health.lifecycle.managedAuxiliaryCount -eq 0)
 Assert-Fact ($health.maintenance.safe -eq $false -and !($health.maintenance.PSObject.Properties.Name -contains 'stopSafe'))
 Assert-Fact ($health.maintenance.fileIssues -is [Array] -and $health.maintenance.gatewayWorkers -is [Array])
 Assert-Fact (@($health.maintenance.fileIssues).Count -gt 0 -and @($health.maintenance.fileIssues|Where-Object {$_.code -cne 'DELIVERY_NOT_DRAINED'}).Count -eq 0)
 Assert-Fact (@($health.maintenance.gatewayWorkers|Where-Object {$_.processAlive -ne $false -or $_.pendingCommands -ne 0 -or $_.inFlight -ne 0 -or $_.pendingInbound -ne 0}).Count -eq 0)
 foreach($item in $d.directories){if(!$item.exists){Assert-Fact (!(Test-Path -LiteralPath $item.path));continue};No-Link $item.path;$actual=@(Get-ChildItem -LiteralPath $item.path -Force|ForEach-Object {$_.Name}|Sort-Object);$expected=@($item.names|Sort-Object);Assert-Fact ($actual.Count -eq $expected.Count);for($i=0;$i -lt $actual.Count;$i++){Assert-Fact ($actual[$i] -ceq $expected[$i])}}
 foreach($item in $d.files){if(!$item.exists){Assert-Fact (!(Test-Path -LiteralPath $item.path));continue};No-Link $item.path;Assert-Fact ((File-Hash $item.path) -ceq $item.sha256)}
 Assert-Fact ((File-Hash $d.configPath) -ceq $d.configSha256)
 Assert-Fact (!$p.HasExited)
 $p.Kill()
 Assert-Fact ($p.WaitForExit($d.waitMs) -and $p.HasExited)
 [pscustomobject]@{stopped=$true;pid=[int]$d.pid;creationTime=$d.creationTime}|ConvertTo-Json -Compress
}finally{$p.Dispose()}
`;

export function createRetainedHandleTerminator({runCommand=run}={}){
  return async data=>{
    const pending=runCommand('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(RETAINED_STOP_HANDLE_PROGRAM,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:data.waitMs+15_000,maxBuffer:64*1024});
    if(!pending.child?.stdin){await pending;throw fail();}
    pending.child.stdin.on('error',()=>{});
    pending.child.stdin.end(JSON.stringify(data));
    const {stdout}=await pending;
    return JSON.parse(stdout.replace(/^\uFEFF/,'').trim());
  };
}
const terminateWithHeldHandle=createRetainedHandleTerminator();

/** Dependencies are injected only by isolated tests; the official entry uses defaults. */
export function createRetainedClientStopRecovery({platform=process.platform,importInspector=async root=>import(pathToFileURL(path.join(root,'backend/preservation-native-evidence.mjs')).href),terminate=terminateWithHeldHandle}={}){
  return async function recover({recoveryRoot,context,record,health,assertCurrent,timeoutMs=8000}={}){
    if(platform!=='win32')throw Object.assign(new Error('仅 Windows 旧客户端升级可使用回执保留恢复'),{code:'WINDOWS_ONLY'});
    requireFact(typeof assertCurrent==='function'&&context?.snapshot?.config&&typeof recoveryRoot==='string'&&path.isAbsolute(recoveryRoot)&&record&&Number.isSafeInteger(record.pid)&&record.pid>0&&/^[a-f0-9]{64}$/.test(record.commandHash)&&/^[a-f0-9]{64}$/.test(context.build)&&/^[a-f0-9]{64}$/.test(context.snapshot.hash)&&typeof record.executable==='string'&&Number.isFinite(Date.parse(record.creationTime))&&Number.isFinite(timeoutMs)&&timeoutMs>=1&&timeoutMs<=30_000);
    requireFact(health?.pid===record.pid&&health.lifecycle&&/^[A-Za-z0-9_-]{16,128}$/.test(health.lifecycle.nonce||'')&&Math.abs(Date.parse(health.lifecycle.startedAt)-Date.parse(record.creationTime))<=15_000);
    assertOldIdleHealth(health,context,health);
    requireFact(digest(fs.readFileSync(context.file))===context.snapshot.hash);
    const pinned=structuredClone(health),connections=connectionsFor(context,pinned),module=await importInspector(recoveryRoot);
    requireFact(typeof module.inspectLocalDaemonMaintenanceFiles==='function');
    const evidence=verifiedEvidence(module.inspectLocalDaemonMaintenanceFiles,connections,pinned.lifecycle.runtimeDir),fingerprint=evidenceFingerprint(evidence);
    const current=await assertCurrent();assertOldIdleHealth(current,context,pinned);
    const second=verifiedEvidence(module.inspectLocalDaemonMaintenanceFiles,connections,pinned.lifecycle.runtimeDir);requireFact(evidenceFingerprint(second)===fingerprint);
    requireFact(digest(fs.readFileSync(context.file))===context.snapshot.hash);
    const url=new URL(context.origin),host=url.hostname.replace(/^\[|\]$/g,'');requireFact(url.protocol==='http:'&&['127.0.0.1','::1'].includes(host)&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/'&&Number(url.port)>0);
    let output;
    try{output=await terminate({pid:record.pid,creationTime:record.creationTime,commandHash:record.commandHash,executable:record.executable,host,port:Number(url.port),origin:url.origin,root:context.root,configPath:context.file,configSha256:context.snapshot.hash,build:context.build,workspace:context.snapshot.config.workspace,deviceId:context.snapshot.config.deviceId,nonce:pinned.lifecycle.nonce,runtimeDir:pinned.lifecycle.runtimeDir,startedAt:pinned.lifecycle.startedAt,files:evidence.files,directories:evidence.directories,waitMs:Math.floor(timeoutMs)});}catch{throw fail();}
    requireFact(output?.stopped===true&&output.pid===record.pid&&output.creationTime===record.creationTime);
    const stoppedClientReceipt={stopped:true,wasRunning:true,pid:record.pid,creationTime:record.creationTime,retainedDeliveryCount:evidence.retainedDeliveryCount,retainedReceiptRecovery:true,executionConfirmedStopped:false};
    try{
      requireFact(evidenceFingerprint(verifiedEvidence(module.inspectLocalDaemonMaintenanceFiles,connections,pinned.lifecycle.runtimeDir))===fingerprint);
      requireFact(digest(fs.readFileSync(context.file))===context.snapshot.hash);
    }catch{const error=fail();error.stoppedClientReceipt=stoppedClientReceipt;throw error;}
    return stoppedClientReceipt;
  };
}

export const recoverRetainedClientStop=createRetainedClientStopRecovery();
