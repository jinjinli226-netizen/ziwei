import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {defaultUserDir,resolveConfigPath} from '../daemon/config.mjs';
import {clientBuildIdentity} from '../src/management-bootstrap.mjs';
import {inspectNativeClientProcess,inspectNativeHealthListener,windowsCommandArguments} from './client-lifecycle.mjs';
import {BOT_FORCE_ABANDON_TTL_MS,BOT_FORCE_ABANDON_POLICY as POLICY,BOT_FORCE_ABANDON_POLICY_DIGEST as POLICY_DIGEST,BOT_FORCE_ABANDON_ABSENT_POLICY as ABSENT_POLICY,BOT_FORCE_ABANDON_ABSENT_POLICY_DIGEST as ABSENT_DIGEST,canonicalForceAbandonValue as canonical,forceAbandonDigest as digest,forceAbandonBytesDigest as hash,forceAbandonExactKeys as exact,forceAbandonHex as hex,forceAbandonSubjectAllowed,validateForceAbandonEvidence,validateForceAbandonReceipt} from '../src/bot-force-abandon-contract.mjs';
const run=promisify(execFile),ACTION=POLICY.subject.actionId,same=(a,b)=>canonical(a)===canonical(b),samePath=(a,b)=>typeof a==='string'&&typeof b==='string'&&path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
export const FORCE_ABANDON_REFUSED='CLIENT_FORCE_ABANDON_REFUSED';
export const FORCE_ABANDON_SERVER_CODES=Object.freeze(['BOT_FORCE_ABANDON_ABSENCE_REQUIRED','BOT_FORCE_ABANDON_ALREADY_REQUESTED','BOT_FORCE_ABANDON_BINDING_CONFLICT','BOT_FORCE_ABANDON_CHALLENGE_EXPIRED','BOT_FORCE_ABANDON_CHALLENGE_INVALID','BOT_FORCE_ABANDON_CONTROL_CONFLICT','BOT_FORCE_ABANDON_DEVICE_REQUIRED','BOT_FORCE_ABANDON_EVIDENCE_INVALID','BOT_FORCE_ABANDON_GRANT_INVALID','BOT_FORCE_ABANDON_GRANT_REQUIRED','BOT_FORCE_ABANDON_HOLDER_CONFLICT','BOT_FORCE_ABANDON_HOLDER_REQUIRED','BOT_FORCE_ABANDON_IDEMPOTENCY_CONFLICT','BOT_FORCE_ABANDON_INPUT_INVALID','BOT_FORCE_ABANDON_RECEIPT_INVALID','BOT_FORCE_ABANDON_RECOVERY_CONFLICT','BOT_FORCE_ABANDON_SIGNING_UNAVAILABLE','BOT_FORCE_ABANDON_SUBJECT_CHANGED','BOT_FORCE_ABANDON_SUBJECT_INVALID','BOT_FORCE_ABANDON_USER_REQUIRED','EMPLOYEE_NOT_FOUND','V2_OBJECT_SEALED']);
const serverCodes=new Set(FORCE_ABANDON_SERVER_CODES);
const serverFailure=(reasonCode,response,value)=>Object.assign(fail(reasonCode),{...(Number.isInteger(response?.status)&&response.status>=100&&response.status<=599?{httpStatus:response.status}:{}),...(serverCodes.has(value?.code)?{serverCode:value.code}:{})});
const fail=(reasonCode='EVIDENCE_MISMATCH')=>Object.assign(new Error('已授权的旧任务放弃尚未完成；原记录已保留'),{code:FORCE_ABANDON_REFUSED,reasonCode});
const fact=value=>{if(!value)throw fail();},notApplicable=()=>({recovered:false,reason:'not_applicable'});
function noLinks(file){for(let current=path.resolve(file);;current=path.dirname(current)){let st;try{st=fs.lstatSync(current);}catch(error){if(error.code!=='ENOENT')throw error;}fact(!st?.isSymbolicLink());if(current===path.dirname(current))break;}}
function read(file,{optional=false}={}){noLinks(file);let stat;try{stat=fs.lstatSync(file);}catch(error){if(optional&&error.code==='ENOENT')return{path:file,exists:false,sha256:null,bytes:null,value:null};throw error;}fact(stat.isFile()&&stat.nlink===1);const bytes=fs.readFileSync(file);return{path:file,exists:true,sha256:hash(bytes),bytes,value:JSON.parse(bytes)};}
function durable(file,bytes,{exclusive=false}={}){noLinks(file);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const temporary=file+'.'+randomUUID()+'.tmp';let fd;try{fd=fs.openSync(temporary,'wx',0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;if(exclusive){fs.linkSync(temporary,file);fs.unlinkSync(temporary);}else fs.renameSync(temporary,file);fd=fs.openSync(file,'r+');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;if(process.platform!=='win32'){fd=fs.openSync(path.dirname(file),'r');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;}}finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temporary);}catch{}}}
const write=(file,value,options)=>durable(file,canonical(value),options);
function originFor(config,env){const host=String(config.healthHost||env.ZIWEI_HEALTH_HOST||'127.0.0.1').replace(/^localhost$/,'127.0.0.1'),port=Number(config.healthPort||env.ZIWEI_HEALTH_PORT||20242);fact(['127.0.0.1','::1','[::1]'].includes(host)&&Number.isSafeInteger(port)&&port>0&&port<65536);return`http://${host.includes(':')?'[::1]':host}:${port}`;}
function targetFiles(runtimeDir){const base=hash(JSON.stringify(ACTION)),delivery=path.join(runtimeDir,'action-delivery');return[['action-state',path.join(runtimeDir,'action-state.json')],['delivery-journal',path.join(delivery,base+'.json')],['delivery-action',path.join(delivery,base+'.action.json')],['delivery-result',path.join(delivery,base+'.result.json')]];}
export const FORCE_ABANDON_LOCAL_RULES=Object.freeze([
 'LOCAL_STATE_READ','LOCAL_JOURNAL_READ','LOCAL_ACTION_READ','LOCAL_RESULT_READ','STATE_SCHEMA','STARTED_KEY','STARTED_ACTION_ID','STARTED_IDENTITY','STARTED_TIMESTAMP','STARTED_NATIVE_FLAG','STARTED_QUARANTINE','COMPLETED_KEY','COMPLETED_RESULT','COMPLETED_IDENTITY','TARGET_STARTED_COUNT','TARGET_COMPLETED_COUNT','TARGET_NATIVE_RECORD','TARGET_WORKSPACE','TARGET_DEVICE','TARGET_BINDING','TARGET_QUARANTINE','ACTIVE_NATIVE_COUNT','LOCAL_SCOPE_URL','JOURNAL_SCHEMA','JOURNAL_ACTION','JOURNAL_IDENTITY','JOURNAL_BINDING','JOURNAL_EVENTS','JOURNAL_TERMINAL','JOURNAL_TARGET','JOURNAL_DEDUPE','ORPHAN_DELIVERY_BLOBS','ACTION_BLOB_DIGEST','ACTION_IDENTITY','ACTION_BINDING','ACTION_TARGET','ACTION_PROFILE','ACTION_HERMES_BINDING','ACTION_BINDING_DIGEST','RESULT_BLOB_DIGEST','RESULT_RECEIPT','RESULT_STATUS','RESULT_UNCERTAIN_BODY'
]);
const localFact=(value,ruleId)=>{if(!value){const error=fail();error.recoveryRule=ruleId;throw error;}};
function readLocal(runtimeDir,config,{saved}={}){
 const rules=['LOCAL_STATE_READ','LOCAL_JOURNAL_READ','LOCAL_ACTION_READ','LOCAL_RESULT_READ'];
 const rows=targetFiles(runtimeDir).map(([role,file],i)=>{try{return{role,...(saved?.[role]||read(file,{optional:i>0}))};}catch(error){if(!FORCE_ABANDON_LOCAL_RULES.includes(error.recoveryRule))error.recoveryRule=rules[i];throw error;}}),state=rows[0],value=state.value;
 localFact(value?.version===2&&Array.isArray(value.started)&&Array.isArray(value.completed),'STATE_SCHEMA');
 const validIdentity=item=>item===undefined||item&&typeof item==='object'&&!Array.isArray(item)&&Object.values(item).every(v=>typeof v==='string'),startedKeys=new Set(),completedKeys=new Set();
 for(const item of value.started){
  localFact(item&&typeof item.key==='string'&&item.key&&!startedKeys.has(item.key),'STARTED_KEY');
  localFact(['string','number'].includes(typeof item.actionId)||item.actionId===null,'STARTED_ACTION_ID');
  localFact(item.identity&&validIdentity(item.identity),'STARTED_IDENTITY');
  localFact(Number.isFinite(item.startedAt),'STARTED_TIMESTAMP');
  localFact(item.nativeRuntime===undefined||typeof item.nativeRuntime==='boolean','STARTED_NATIVE_FLAG');
  localFact(item.quarantine===undefined||item.quarantine&&typeof item.quarantine.stopConfirmed==='boolean','STARTED_QUARANTINE');startedKeys.add(item.key);
 }
 for(const item of value.completed){
  localFact(item&&typeof item.key==='string'&&item.key&&!completedKeys.has(item.key),'COMPLETED_KEY');
  localFact(item.result&&['succeeded','failed'].includes(item.result.status),'COMPLETED_RESULT');
  localFact(validIdentity(item.identity)&&(item.identity||item.legacy===true),'COMPLETED_IDENTITY');completedKeys.add(item.key);
 }
 const targets=value.started.filter(item=>item?.actionId===ACTION);
 localFact(targets.length===1,'TARGET_STARTED_COUNT');localFact(value.completed.filter(item=>item?.result?.actionId===ACTION).length===0,'TARGET_COMPLETED_COUNT');const started=targets[0];
 localFact(typeof started.key==='string'&&started.key&&started.nativeRuntime===true&&Number.isFinite(started.startedAt),'TARGET_NATIVE_RECORD');
 localFact(started.identity?.workspace===config.workspace,'TARGET_WORKSPACE');
 localFact(started.identity.deviceId===config.deviceId&&started.identity.targetDeviceId===config.deviceId,'TARGET_DEVICE');
 localFact(started.resourceBinding?.type==='conversation.execute'&&started.resourceBinding.employeeId===POLICY.subject.employeeId&&started.resourceBinding.revision===POLICY.subject.originalRevision&&started.resourceBinding.controlEpoch===POLICY.subject.originalControlEpoch,'TARGET_BINDING');
 localFact(started.quarantine?.stopConfirmed===false,'TARGET_QUARANTINE');
 localFact(value.started.filter(item=>!value.completed.some(done=>done?.key===item?.key)&&(item?.nativeRuntime===true||item?.quarantine)&&item.quarantine?.stopConfirmed!==true).length===1,'ACTIVE_NATIVE_COUNT');
 const journal=rows[1],action=rows[2],result=rows[3];let scope;try{scope={apiBase:new URL(config.apiBase).origin,workspace:config.workspace,deviceId:config.deviceId};}catch(error){error.recoveryRule='LOCAL_SCOPE_URL';throw error;}
 if(journal.exists){
  const j=journal.value;localFact(j?.version===2,'JOURNAL_SCHEMA');localFact(j.action?.id===ACTION&&j.action.type==='conversation.execute','JOURNAL_ACTION');localFact(same(j.identity,scope),'JOURNAL_IDENTITY');localFact(hex(j.binding),'JOURNAL_BINDING');localFact(Array.isArray(j.events),'JOURNAL_EVENTS');
  // A durable uncertain result is staged before its transport ACK. A lost ACK
  // leaves result_pending; a permanent HTTP rejection leaves blocked. The
  // explicit abandonment grant, not a fabricated local confirmation, releases
  // this original task. Keep these retained bytes and their unconfirmed state.
  const confirmedFailed=j.state==='confirmed'&&j.serverStatus==='failed';
  const retainedUnconfirmed=['result_pending','blocked'].includes(j.state)&&j.retainEvidence===true&&j.dispatcherStatus==='failed'&&(j.serverStatus===undefined||j.serverStatus===null||j.serverStatus==='failed')&&action.exists&&result.exists&&hex(j.actionDigest)&&hex(j.resultDigest)&&(j.state!=='blocked'||Number.isInteger(j.blockedStatus)&&j.blockedStatus>=400&&j.blockedStatus<=499&&![408,429].includes(j.blockedStatus));
  localFact(confirmedFailed||retainedUnconfirmed,'JOURNAL_TERMINAL');const p=j.action.payload||{};
  localFact(p.deviceId===config.deviceId&&p.employeeId===POLICY.subject.employeeId,'JOURNAL_TARGET');localFact(String(j.action.dedupe_key??j.action.dedupeKey??j.action.id)===started.key,'JOURNAL_DEDUPE');
 }else localFact(!action.exists&&!result.exists,'ORPHAN_DELIVERY_BLOBS');
 if(action.exists){
  const a=action.value,j=journal.value,p=a?.action?.payload,b=p?.hermesBot;
  localFact(j.actionDigest===action.sha256,'ACTION_BLOB_DIGEST');localFact(same(a?.identity,scope),'ACTION_IDENTITY');localFact(a.binding===j.binding,'ACTION_BINDING');localFact(a.action.id===ACTION&&a.action.type==='conversation.execute'&&p?.deviceId===config.deviceId&&p.employeeId===POLICY.subject.employeeId,'ACTION_TARGET');localFact(p.profile===POLICY.subject.profile,'ACTION_PROFILE');
  localFact(b?.workspace===config.workspace&&b.deviceId===config.deviceId&&b.employeeId===POLICY.subject.employeeId&&b.revision===POLICY.subject.originalRevision&&b.controlEpoch===POLICY.subject.originalControlEpoch,'ACTION_HERMES_BINDING');
  const binding=hash(JSON.stringify({id:ACTION,type:a.action.type,agent:a.action.agent_id||a.action.agentId||'ziwei_user',workspace:a.action.workspace_id||config.workspace,device:config.deviceId,employee:p.employeeId||null,conversation:p.conversationId||p.conversation_id||null,message:p.messageId||p.message_id||null,dedupe:a.action.dedupe_key||a.action.dedupeKey||null}));localFact(binding===j.binding&&started.key===String(a.action.dedupe_key??a.action.dedupeKey??ACTION),'ACTION_BINDING_DIGEST');
 }
 if(result.exists){localFact(journal.value.resultDigest===result.sha256,'RESULT_BLOB_DIGEST');localFact(result.value?.receiptOnly===true,'RESULT_RECEIPT');localFact(result.value.status==='failed','RESULT_STATUS');if(journal.value.state!=='confirmed')localFact(result.value.error===POLICY.originalError&&same(result.value.result,POLICY.originalResult),'RESULT_UNCERTAIN_BODY');}
 return{rows,state,started,journal,action,result};
}
export function inspectForceAbandonLocalFacts(runtimeDir,config,{saved}={}){
 try{const local=readLocal(runtimeDir,config,{saved});return{state:'passed',startedCount:local.state.value.started.length,completedCount:local.state.value.completed.length,files:local.rows.map(row=>({role:row.role,present:row.exists}))};}
 catch(error){return{state:'failed',reasonCode:'EVIDENCE_MISMATCH',ruleId:FORCE_ABANDON_LOCAL_RULES.includes(error?.recoveryRule)?error.recoveryRule:'LOCAL_STATE_READ'};}
}
function assertHealth(body,c,pinned,{draining=false}={}){const l=body?.lifecycle,m=body?.maintenance;fact(body?.service==='ziwei_user'&&body.agentId==='ziwei_user'&&body.clientBuild===POLICY.holderBuild&&body.pid===c.record.pid&&body.workspace===c.config.workspace&&body.deviceId===c.config.deviceId&&l&&l.nonce===pinned.lifecycle.nonce&&/^[a-f0-9]{48}$/.test(l.nonce)&&samePath(l.root,c.root)&&samePath(l.configPath,c.configPath)&&l.configSha256===c.configHash&&samePath(l.runtimeDir,c.runtimeDir)&&l.startedAt===pinned.lifecycle.startedAt&&Math.abs(Date.parse(l.startedAt)-Date.parse(c.record.creationTime))<=15000&&l.managedAuxiliaryCount===0);fact(body.executionQuarantined===true&&body.quarantinedActionCount===1&&Number.isSafeInteger(body.activeActionCount)&&body.activeActionCount-body.quarantinedActionCount===0&&Number.isSafeInteger(body.pollingCount)&&body.pollingCount>=0);if(draining)fact(body.connectionState==='draining'&&body.pollingCount===0);fact(m?.gatewaySafe===true&&Array.isArray(m.gatewayWorkers)&&m.gatewayWorkers.length===0&&m.pendingDeliveryCount===0&&m.blockedDeliveryCount===0);}
function sourceSnapshot(root){const files=[];for(const directory of ['src','daemon']){const walk=folder=>{noLinks(folder);for(const row of fs.readdirSync(folder,{withFileTypes:true})){const file=path.join(folder,row.name);noLinks(file);if(row.isDirectory())walk(file);else if(/\.(mjs|py|ps1)$/.test(row.name)){const st=fs.lstatSync(file);fact(st.isFile()&&st.nlink===1);files.push({path:file,exists:true,sha256:hash(fs.readFileSync(file))});}}};walk(path.join(root,directory));}const file=path.join(root,'package.json');noLinks(file);files.push({path:file,exists:true,sha256:hash(fs.readFileSync(file))});return files.sort((a,b)=>a.path.localeCompare(b.path));}
export const FORCE_ABANDON_INVENTORY_PROGRAM = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $rows=@(Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" -ErrorAction Stop | ForEach-Object {[pscustomobject]@{pid=[int]$_.ProcessId;executable=$_.ExecutablePath;command=$_.CommandLine;creationTime=$_.CreationDate.ToUniversalTime().ToString('o')}}); ConvertTo-Json -InputObject $rows -Compress";
export const FORCE_ABANDON_NATIVE_RULES=Object.freeze(['NATIVE_COMMAND_UNAVAILABLE','NATIVE_COMMAND_FAILED','NATIVE_JSON_EMPTY','NATIVE_JSON_INVALID','NATIVE_ARRAY_REQUIRED','NATIVE_PID_INVALID','NATIVE_COMMAND_UNREADABLE','NATIVE_EXECUTABLE_UNREADABLE','NATIVE_CREATION_INVALID','NATIVE_ENTRY_ARGUMENTS','NATIVE_SOURCE_EXECUTABLE','LISTENER_COUNT_EMPTY','LISTENER_COUNT_INVALID']);
const nativeFailure=(ruleId,unreadableCount)=>Object.assign(fail(),{recoveryRule:ruleId,...(Number.isSafeInteger(unreadableCount)&&unreadableCount>0?{unreadableCount}:{})});
export function createForceAbandonInventory({runCommand=run}={}) {return async root=>{
 let stdout;try{({stdout}=await runCommand('powershell.exe',['-NoProfile','-NonInteractive','-Command',FORCE_ABANDON_INVENTORY_PROGRAM],{encoding:'utf8',windowsHide:true,timeout:8000,maxBuffer:4*1024*1024}));}catch(error){throw nativeFailure(error?.code==='ENOENT'?'NATIVE_COMMAND_UNAVAILABLE':'NATIVE_COMMAND_FAILED');}
 const output=stdout.replace(/^\uFEFF/,'').trim();if(!output)throw nativeFailure('NATIVE_JSON_EMPTY');let parsed;try{parsed=JSON.parse(output);}catch{throw nativeFailure('NATIVE_JSON_INVALID');}if(!Array.isArray(parsed))throw nativeFailure('NATIVE_ARRAY_REQUIRED');
 const unreadableCount=parsed.filter(row=>!(Number.isSafeInteger(row?.pid)&&row.pid>0&&typeof row.command==='string'&&row.command.length>0&&typeof row.executable==='string'&&row.executable.length>0&&Number.isFinite(Date.parse(row.creationTime)))).length;
 for(const row of parsed){if(!Number.isSafeInteger(row?.pid)||row.pid<=0)throw nativeFailure('NATIVE_PID_INVALID',unreadableCount);if(typeof row.command!=='string'||!row.command)throw nativeFailure('NATIVE_COMMAND_UNREADABLE',unreadableCount);if(typeof row.executable!=='string'||!row.executable)throw nativeFailure('NATIVE_EXECUTABLE_UNREADABLE',unreadableCount);if(!Number.isFinite(Date.parse(row.creationTime)))throw nativeFailure('NATIVE_CREATION_INVALID',unreadableCount);}
 return parsed.filter(row=>windowsCommandArguments(row.command).some(arg=>samePath(arg,path.join(root,'daemon/ziwei_user.mjs')))).map(row=>{const args=windowsCommandArguments(row.command);if(!samePath(row.executable,process.execPath)||!samePath(args[0],process.execPath))throw nativeFailure('NATIVE_SOURCE_EXECUTABLE');if(args.length!==2)throw nativeFailure('NATIVE_ENTRY_ARGUMENTS');return{pid:row.pid,creationTime:row.creationTime,commandHash:hash(row.command),executable:row.executable};});
};}
const inventory=createForceAbandonInventory();

export const FORCE_ABANDON_HANDLE_PROGRAM=String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
$d=([Console]::In.ReadToEnd()|ConvertFrom-Json)
function Assert-Fact($v){if(!$v){throw 'Force abandon holder or archive changed'}}
function File-Hash($f){$h=[Security.Cryptography.SHA256]::Create();try{return [BitConverter]::ToString($h.ComputeHash([IO.File]::ReadAllBytes($f))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}}
function Text-Hash($v){$h=[Security.Cryptography.SHA256]::Create();try{return [BitConverter]::ToString($h.ComputeHash([Text.Encoding]::UTF8.GetBytes($v))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}}
function No-Link($f){$i=Get-Item -LiteralPath $f -Force;while($i){Assert-Fact (($i.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0);$parent=Split-Path -Parent $i.FullName;if(!$parent -or $parent -eq $i.FullName){break};$i=Get-Item -LiteralPath $parent -Force}}
$p=Get-Process -Id $d.pid -ErrorAction Stop
try{
 $heldHandle=$p.Handle
 $native=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$d.pid)
 Assert-Fact ($native -and $native.CreationDate.ToUniversalTime().ToString('o') -ceq $d.creationTime -and [Math]::Abs(($p.StartTime.ToUniversalTime()-$native.CreationDate.ToUniversalTime()).TotalMilliseconds) -le 2 -and $native.ExecutablePath -ieq $d.executable -and (Text-Hash $native.CommandLine) -ceq $d.commandHash)
 $listeners=@(Get-NetTCPConnection -State Listen -LocalPort $d.port|Where-Object {$_.LocalAddress -eq $d.host});Assert-Fact ($listeners.Count -eq 1 -and $listeners[0].OwningProcess -eq $d.pid)
 $request=[Net.HttpWebRequest]::Create($d.origin+'/healthz');$request.Proxy=$null;$request.Timeout=3000;$response=$request.GetResponse()
 try{$reader=[IO.StreamReader]::new($response.GetResponseStream());try{$h=$reader.ReadToEnd()|ConvertFrom-Json}finally{$reader.Dispose()}}finally{$response.Dispose()}
 Assert-Fact ($h.service -ceq 'ziwei_user' -and $h.agentId -ceq 'ziwei_user' -and $h.pid -eq $d.pid -and $h.clientBuild -ceq $d.build -and $h.workspace -ceq $d.workspace -and $h.deviceId -ceq $d.deviceId)
 Assert-Fact ($h.connectionState -ceq 'draining' -and $h.pollingCount -eq 0 -and $h.executionQuarantined -eq $true -and $h.quarantinedActionCount -eq 1 -and ($h.activeActionCount - $h.quarantinedActionCount) -eq 0)
 Assert-Fact ($h.lifecycle.nonce -ceq $d.nonce -and $h.lifecycle.root -ieq $d.root -and $h.lifecycle.configPath -ieq $d.configPath -and $h.lifecycle.configSha256 -ceq $d.configSha256 -and $h.lifecycle.runtimeDir -ieq $d.runtimeDir -and $h.lifecycle.startedAt -ceq $d.startedAt -and $h.lifecycle.managedAuxiliaryCount -eq 0)
 Assert-Fact ($h.maintenance.gatewaySafe -eq $true -and $h.maintenance.gatewayWorkers -is [Array] -and @($h.maintenance.gatewayWorkers).Count -eq 0 -and $h.maintenance.pendingDeliveryCount -eq 0 -and $h.maintenance.blockedDeliveryCount -eq 0)
 foreach($item in $d.files){if(!$item.exists){Assert-Fact (!(Test-Path -LiteralPath $item.path));continue};No-Link $item.path;Assert-Fact ((File-Hash $item.path) -ceq $item.sha256)}
 Assert-Fact (@(Get-CimInstance Win32_Process -Filter ('ParentProcessId = '+$d.pid)).Count -eq 0 -and !$p.HasExited)
 $stopDeadline=[DateTime]::Parse($d.stopNotAfter).ToUniversalTime();Assert-Fact ([DateTime]::UtcNow.AddMilliseconds(([double]$d.waitMs)+1000) -lt $stopDeadline)
 $p.Kill();Assert-Fact ($p.WaitForExit($d.waitMs) -and $p.HasExited)
 $exit=[pscustomobject]@{scope='daemon-root-only';stopped=$true;pid=[int]$d.pid;creationTime=$d.creationTime;exitedAt=$p.ExitTime.ToUniversalTime().ToString('o')}
 No-Link (Split-Path -Parent $d.exitFile)
 $bytes=[Text.Encoding]::UTF8.GetBytes(($exit|ConvertTo-Json -Compress));$stream=[IO.File]::Open($d.exitFile,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None);try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
 $exit|ConvertTo-Json -Compress
}finally{$p.Dispose()}
`;
export function createForceAbandonHandleTerminator({runCommand=run}={}){return async data=>{const pending=runCommand('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(FORCE_ABANDON_HANDLE_PROGRAM,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:data.waitMs+15000,maxBuffer:64*1024});if(!pending.child?.stdin){await pending;throw fail();}pending.child.stdin.on('error',()=>{});pending.child.stdin.end(JSON.stringify(data));const{stdout}=await pending;return JSON.parse(stdout.replace(/^\uFEFF/,'').trim());};}
const nativeTerminate=createForceAbandonHandleTerminator();
function verifyArchive(directory,wal,runtimeDir){fact((wal?.schemaVersion===1&&wal.policyDigest===POLICY_DIGEST||wal?.schemaVersion===2&&wal.policyDigest===ABSENT_DIGEST)&&wal.actionId===ACTION&&Array.isArray(wal.files)&&wal.files.length===4);const expected=targetFiles(runtimeDir);return Object.fromEntries(wal.files.map((item,index)=>{fact(item.role===expected[index][0]&&samePath(item.path,expected[index][1])&&typeof item.exists==='boolean');if(!item.exists){fact(item.sha256===null&&item.bytes===null);return[item.role,{...item,value:null}];}const original=read(path.join(directory,item.role+'.original.json'));fact(original.sha256===item.sha256&&original.bytes.length===item.bytes);return[item.role,{...original,path:item.path}];}));}
const OFFLINE_WAL_STAGES=new Set(['prepared','stopping','daemon_exited','receipt_saved','applied']);
export function inspectForceAbandonOfflineArtifacts({root,configPath,configHash,config,runtimeDir}={}){
 const directory=path.join(runtimeDir,'force-abandon',hash(JSON.stringify(ACTION))),walFile=path.join(directory,'journal.json'),exitFile=path.join(directory,'current-daemon-exit.json'),checks=[];
 const check=(ruleId,value)=>{checks.push({ruleId,state:value?'passed':'failed'});return value;};
 let wal=null,original=null,saved;
 try{if(fs.existsSync(walFile)){original=read(walFile);wal=original.value;check('WAL_READ',true);}else check('WAL_ABSENT',true);}catch{check('WAL_READ',false);}
 const summary={present:original!==null,schemaVersion:wal?.schemaVersion===1||wal?.schemaVersion===2?wal.schemaVersion:null,stage:OFFLINE_WAL_STAGES.has(wal?.stage)?wal.stage:wal?'unknown':null,hasReceipt:Boolean(wal?.receipt),exitEvidencePresent:fs.existsSync(exitFile),previousHolderJournalPresent:fs.existsSync(path.join(directory,'previous-holder-journal.original.json'))};
 if(original){
  check('WAL_SCOPE',samePath(wal?.root,root)&&samePath(wal?.runtimeDir,runtimeDir)&&samePath(wal?.configPath,configPath));
  check('WAL_CONFIG',wal?.stage==='applied'||wal?.configHash===configHash);
  try{saved=verifyArchive(directory,wal,runtimeDir);check('WAL_ARCHIVE',true);}catch{check('WAL_ARCHIVE',false);}
  if(wal?.schemaVersion===1){
   check('WAL_OFFLINE_TRANSITION',!wal.receipt&&!summary.exitEvidencePresent);
   if(summary.previousHolderJournalPresent){try{check('WAL_PREVIOUS_HOLDER_MATCH',read(path.join(directory,'previous-holder-journal.original.json')).sha256===original.sha256);}catch{check('WAL_PREVIOUS_HOLDER_MATCH',false);}}
   saved=undefined; // The real absent-holder branch retains v1, then reads live files.
  }
 }
 const local=inspectForceAbandonLocalFacts(runtimeDir,config,{saved:wal?.schemaVersion===2?saved:undefined});
 return{wal:summary,checks,local,remoteGrantCheck:'not_queried'};
}

function assertPrepared(prepared,holder,local,config){const s=prepared?.subject;fact(prepared?.applicable===true&&prepared.completed===false&&typeof prepared.challenge==='string'&&Number.isFinite(Date.parse(prepared.expiresAt))&&same(prepared.policy,POLICY)&&prepared.policyDigest===POLICY_DIGEST&&prepared.subjectDigest===digest(s)&&forceAbandonSubjectAllowed(s)&&same(s.holder,holder)&&s.deviceId===config.deviceId&&s.workspace===config.workspace&&s.dedupeKey===local.started.key&&s.employeeId===local.started.resourceBinding.employeeId);if(local.action.exists)fact(digest(local.action.value.action.payload)===s.originalDeliveredPayloadDigest&&same(local.action.value.action.payload.hermesBot.instance,s.profileBinding));}

export function createForceAbandonListenerCount({runCommand=run}={}){return async origin=>{
 const port=Number(new URL(origin).port);fact(Number.isSafeInteger(port)&&port>0&&port<65536);
 let stdout;try{({stdout}=await runCommand('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); @(Get-NetTCPConnection -State Listen | Where-Object {$_.LocalPort -eq ${port}}).Count`],{encoding:'utf8',windowsHide:true,timeout:8000,maxBuffer:64*1024}));}catch(error){throw nativeFailure(error?.code==='ENOENT'?'NATIVE_COMMAND_UNAVAILABLE':'NATIVE_COMMAND_FAILED');}
 const output=stdout.replace(/^\uFEFF/,'').trim();if(!output)throw nativeFailure('LISTENER_COUNT_EMPTY');if(!/^\d+$/.test(output)||!Number.isSafeInteger(Number(output)))throw nativeFailure('LISTENER_COUNT_INVALID');return Number(output);
};}
const nativeListenerCount=createForceAbandonListenerCount();

// HTTPS response time and monotonic elapsed time are the only clock sources for
// new offline evidence. No performance epoch or replacement old timestamp is
// persisted. A received HTTP Date is a seconds-precision server lower bound.
export function createForceAbandonServerClock({monotonicNow=()=>performance.now()}={}){
 let anchor=null,unavailableRule='SERVER_DATE_MISSING',lastMonotonic=null;const received=new WeakMap();
 const unavailable=rule=>Object.assign(fail('SERVER_TIME_UNAVAILABLE'),{recoveryRule:rule});
 const sample=()=>{let value;try{value=monotonicNow();}catch{throw unavailable('MONOTONIC_TIME_INVALID');}if(!Number.isFinite(value)||value<0||lastMonotonic!==null&&value<lastMonotonic)throw unavailable('MONOTONIC_TIME_INVALID');lastMonotonic=value;return value;};
 const validateAnchor=(value,current)=>{if(!value||!Number.isFinite(value.epoch)||!Number.isFinite(value.receivedAt)||value.receivedAt<0||value.receivedAt>current||!Number.isFinite(value.startedAt)||value.startedAt<0||value.startedAt>value.receivedAt)throw unavailable('MONOTONIC_TIME_INVALID');};
 return{
  captureProbeDate(value,startedAt,receivedAt){
   if(typeof value!=='string'||!value){anchor=null;unavailableRule='SERVER_DATE_MISSING';return;}
   const epoch=Date.parse(value);if(!Number.isFinite(epoch)||new Date(epoch).toUTCString()!==value){anchor=null;unavailableRule='SERVER_DATE_INVALID';return;}
   anchor={epoch,startedAt,receivedAt,prepared:false};
  },
  captureResponse(value,startedAt,receivedAt){if(value&&typeof value==='object')received.set(value,{startedAt,receivedAt});},
  acceptPrepared(prepared){
   const timing=received.get(prepared),epoch=Date.parse(prepared.expiresAt)-BOT_FORCE_ABANDON_TTL_MS,current=sample();
   if(!timing||!Number.isFinite(epoch))throw unavailable('SERVER_PREPARED_TIME_INVALID');
   const next={epoch,...timing,prepared:true};validateAnchor(next,current);anchor=next;
  },
  now(){if(!anchor)throw unavailable(unavailableRule);const current=sample();validateAnchor(anchor,current);return Math.floor(anchor.epoch+current-anchor.receivedAt);},
  beforeDeadline(expiresAt){if(!anchor?.prepared)throw unavailable('SERVER_PREPARED_TIME_INVALID');const current=sample();validateAnchor(anchor,current);return anchor.epoch+current-anchor.startedAt<Date.parse(expiresAt);}
 };
}

// This branch observes an already absent daemon. It does not manufacture an
// exit receipt, restart the old instance, or claim the old execution stopped.
async function recoverAbsentHolder(context,deps) {
 const {root,configPath,configHash,config,runtimeDir,directory,walFile,request,origin,probe,sources,phase}=context;
 const {installedBuild,inspectInstalledProcesses,inspectListenerCount,serverClock,checkpoint}=deps;
 const now=()=>serverClock.now();
 let wal=context.wal;
 const observe=async({timestamp=true}={})=>{
  fact(await request(origin+'/healthz')===null);
  fact((await inspectInstalledProcesses(root)).length===0);
  fact(await inspectListenerCount(origin)===0);
  fact(await request(origin+'/healthz')===null);
  return timestamp?{scope:'current-daemon-holder',state:'absent',health:'connection_refused',nativeDaemonCount:0,healthListenerCount:0,checkedAt:new Date(now()).toISOString()}:{state:'absent'};
 };
 const unchanged=()=>fact(read(configPath).sha256===configHash&&installedBuild(root)===POLICY.holderBuild&&same(sourceSnapshot(root),sources));
 phase('offline_observation');const initialAbsence=await observe({timestamp:probe.completed!==true});unchanged();
 if(wal?.schemaVersion===1){
  fact(!wal.receipt&&!fs.existsSync(path.join(directory,'current-daemon-exit.json'))&&probe.completed!==true);
  const original=read(walFile),retained=path.join(directory,'previous-holder-journal.original.json');
  if(fs.existsSync(retained))fact(read(retained).sha256===original.sha256);else durable(retained,original.bytes,{exclusive:true});
  wal=null;
 }
 const saved=wal?verifyArchive(directory,wal,runtimeDir):undefined,local=readLocal(runtimeDir,config,{saved});
 const installation={build:POLICY.holderBuild,root,configSha256:configHash,stateSha256:local.state.sha256};
 const manifest={schemaVersion:1,actionId:ACTION,files:local.rows.map(row=>({role:row.role,sha256:row.sha256,bytes:row.exists?row.bytes.length:null}))};
 const assertAbsentPrepared=prepared=>{
  const s=prepared?.subject;
  fact(prepared?.applicable===true&&prepared.completed===false&&typeof prepared.challenge==='string'&&Number.isFinite(Date.parse(prepared.expiresAt))&&same(prepared.policy,ABSENT_POLICY)&&prepared.policyDigest===ABSENT_DIGEST&&prepared.subjectDigest===digest(s)&&s?.schemaVersion===2&&forceAbandonSubjectAllowed(s)&&same(s.installation,installation)&&s.deviceId===config.deviceId&&s.workspace===config.workspace&&s.dedupeKey===local.started.key&&s.employeeId===local.started.resourceBinding.employeeId);
  if(local.action.exists)fact(digest(local.action.value.action.payload)===s.originalDeliveredPayloadDigest&&same(local.action.value.action.payload.hermesBot.instance,s.profileBinding));
 };
 if(probe.completed!==true){
  phase('offline_prepare');const prepared=await request(context.remote('prepare'),{mode:ABSENT_POLICY.mode,installation,absence:initialAbsence});assertAbsentPrepared(prepared);serverClock.acceptPrepared(prepared);
  phase('offline_archive');fs.mkdirSync(directory,{recursive:true,mode:0o700});
  for(const row of local.rows){if(!row.exists)continue;const file=path.join(directory,row.role+'.original.json');if(fs.existsSync(file))fact(read(file).sha256===row.sha256);else durable(file,row.bytes,{exclusive:true});}
  for(const [name,value]of [['target-started.original.json',local.started],['archive-manifest.json',manifest]]){const file=path.join(directory,name);if(fs.existsSync(file))fact(same(read(file).value,value));else write(file,value,{exclusive:true});}
  wal={schemaVersion:2,policyDigest:ABSENT_DIGEST,actionId:ACTION,stage:'prepared',root,runtimeDir,configPath,configHash,installation,prepared,manifest,files:local.rows.map(({role,path,exists,sha256,bytes})=>({role,path,exists,sha256,bytes:exists?bytes.length:null}))};
  write(walFile,wal);checkpoint('offline_prepared',wal);
 }else fact(wal?.schemaVersion===2&&wal.evidence&&validateForceAbandonReceipt(probe.receipt,{actionId:ACTION,subject:wal.prepared.subject,evidenceDigest:digest(wal.evidence)}));
 assertAbsentPrepared(wal.prepared);fact(same(wal.manifest,manifest)&&same(read(path.join(directory,'archive-manifest.json')).value,manifest)&&digest(read(path.join(directory,'target-started.original.json')).value)===digest(local.started));
 const localArchive={actionId:ACTION,dedupeKey:local.started.key,stateSha256:local.state.sha256,startedSha256:digest(local.started),deliverySha256:local.journal.sha256,actionSha256:local.action.sha256,resultSha256:local.result.sha256,manifest,archiveManifestSha256:digest(manifest)};
 if(probe.completed!==true){
  phase('offline_revalidation');unchanged();for(const row of local.rows)fact(read(row.path,{optional:row.role!=='action-state'}).sha256===row.sha256);
  const currentDaemonAbsence=await observe();fact(Date.parse(currentDaemonAbsence.checkedAt)<Date.parse(wal.prepared.expiresAt)&&serverClock.beforeDeadline(wal.prepared.expiresAt));
  const evidence={schemaVersion:2,mode:ABSENT_POLICY.mode,policy:ABSENT_POLICY.id,policyDigest:ABSENT_DIGEST,subjectDigest:wal.prepared.subjectDigest,currentDaemonAbsence,localArchive,quarantineCount:1};
  fact(validateForceAbandonEvidence(evidence,wal.prepared.subject,{recordedAt:now()}));wal.evidence=evidence;write(walFile,wal);checkpoint('offline_before_commit',wal);
  phase('offline_commit');fact(serverClock.beforeDeadline(wal.prepared.expiresAt));const result=await request(context.remote('commit'),{challenge:wal.prepared.challenge,evidence});
  fact(validateForceAbandonReceipt(result?.receipt,{actionId:ACTION,subject:wal.prepared.subject,evidenceDigest:digest(evidence)})&&result.receipt.localArchiveDigest===digest(localArchive)&&same(result.receipt.currentDaemonAbsence,evidence.currentDaemonAbsence));
  wal.receipt=result.receipt;wal.stage='receipt_saved';write(walFile,wal);checkpoint('offline_receipt_saved',wal);
 }else{fact(probe.receipt.localArchiveDigest===digest(localArchive));wal.receipt=probe.receipt;wal.stage='receipt_saved';write(walFile,wal);}
 phase('offline_apply');await observe({timestamp:false});unchanged();
 const nextState={...local.state.value,started:local.state.value.started.filter(row=>row.actionId!==ACTION)},nextBytes=JSON.stringify(nextState),current=read(local.state.path);
 fact(current.sha256===local.state.sha256||current.sha256===hash(nextBytes));if(current.sha256!==hash(nextBytes)){durable(local.state.path,nextBytes);checkpoint('offline_state_archived',wal);}
 for(const row of local.rows.slice(1)){const present=read(row.path,{optional:true});if(!present.exists)continue;fact(row.exists&&present.sha256===row.sha256);fs.unlinkSync(row.path);checkpoint('offline_removed_'+row.role,wal);}
 wal.stage='applied';write(walFile,wal);checkpoint('offline_applied',wal);
 return {recovered:true,actionId:ACTION,operatorAbandoned:true,currentDaemonAbsent:true,stopped:false,wasRunning:false,originalExecutionExitConfirmed:false,executionConfirmedStopped:false,receiptId:wal.receipt.id};
}

export function createForceAbandonRecovery({platform=process.platform,installedBuild=clientBuildIdentity,inspectProcess=inspectNativeClientProcess,inspectListener=inspectNativeHealthListener,inspectInstalledProcesses=inventory,inspectListenerCount=nativeListenerCount,terminate=nativeTerminate,now=Date.now,monotonicNow=()=>performance.now(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),checkpoint=()=>{}}={}){const recover=async({root,env=process.env,configPath,fetchImpl=globalThis.fetch,timeoutMs=15000,log=()=>{},progress={}}={})=>{
 const phase=value=>{progress.phase=value;try{log('force_abandon_phase',{phase:value});}catch{}};phase('configuration');
 if(platform!=='win32')return notApplicable();fact(typeof root==='string'&&path.isAbsolute(root)&&Number.isFinite(timeoutMs)&&timeoutMs>0&&timeoutMs<=120000);root=path.resolve(root);configPath=configPath?path.resolve(configPath):resolveConfigPath({root,env});let snapshot;try{snapshot=read(configPath);}catch(error){if(error.code==='ENOENT')return notApplicable();throw error;}const config=snapshot.value,configHash=snapshot.sha256;if(config.workspace!==POLICY.subject.workspace||config.deviceId!==POLICY.subject.deviceId)return notApplicable();
 const api=new URL(config.apiBase);fact(api.protocol==='https:'&&!api.username&&!api.password&&!api.search&&!api.hash&&api.pathname==='/'&&typeof config.deviceToken==='string'&&config.deviceToken.length>0);const remote=operation=>`${api.origin}/a2a/v1/actions/${encodeURIComponent(ACTION)}/force-abandon/${operation}`,origin=originFor(config,env),runtimeDir=env.ZIWEI_USER_HOME?path.join(defaultUserDir({env}),'runtime'):path.join(root,'.local','runtime'),directory=path.join(runtimeDir,'force-abandon',hash(JSON.stringify(ACTION))),walFile=path.join(directory,'journal.json'),exitFile=path.join(directory,'current-daemon-exit.json');noLinks(directory);
 const serverClock=createForceAbandonServerClock({monotonicNow});
 const request=async(url,body,{local=false,probe=false}={})=>{let response;const remoteRequest=!local&&body!==undefined&&url.startsWith(api.origin+'/a2a/'),requestStartedAt=remoteRequest?monotonicNow():null;let receivedAt;try{response=await fetchImpl(url,{...(body===undefined?{}:{method:'POST',headers:{'content-type':'application/json',[local?'x-ziwei-local-control':'x-ziwei-device-token']:config.deviceToken},body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(8000)});receivedAt=remoteRequest?monotonicNow():null;}catch(error){if(body===undefined&&(error.cause?.code==='ECONNREFUSED'||error.code==='ECONNREFUSED'))return null;throw fail('TRANSPORT_FAILED');}if(remoteRequest&&probe){let date;try{date=response.headers?.get?.('date');}catch{}serverClock.captureProbeDate(date,requestStartedAt,receivedAt);}let value;try{value=await response.json();}catch{throw serverFailure('INVALID_SERVER_RESPONSE',response);}if(remoteRequest)serverClock.captureResponse(value,requestStartedAt,receivedAt);if(body===undefined&&value===null)throw serverFailure('INVALID_SERVER_RESPONSE',response);if(!response.ok){if(probe&&response.status===409&&value?.code==='BOT_FORCE_ABANDON_HOLDER_REQUIRED')return{applicable:true,holderRequired:true};throw serverFailure('SERVER_REFUSED',response,value);}return value;};
 let wal=fs.existsSync(walFile)?read(walFile).value:null,stoppedReceipt,pauseAttempted=false,pauseIdentity;
 try{
  phase('grant_probe');const probe=await request(remote('prepare'),{holder:null},{probe:true});if(probe?.applicable===false){fact(!wal);return notApplicable();}fact(probe?.applicable===true);if(probe.completed===true)fact(wal&&validateForceAbandonReceipt(probe.receipt,{actionId:ACTION}));
  phase('archive_validation');if(wal){fact(samePath(wal.root,root)&&samePath(wal.runtimeDir,runtimeDir)&&samePath(wal.configPath,configPath)&&(wal.stage==='applied'||wal.configHash===configHash));verifyArchive(directory,wal,runtimeDir);}
  phase('current_health');let health=await request(origin+'/healthz');if(wal?.stage==='applied'){fact(validateForceAbandonReceipt(wal.receipt,{actionId:ACTION,evidenceDigest:digest(wal.evidence)})&&probe.completed===true&&same(wal.receipt,probe.receipt));const currentState=read(path.join(runtimeDir,'action-state.json')).value;fact(Array.isArray(currentState.started)&&!currentState.started.some(item=>item?.actionId===ACTION)&&targetFiles(runtimeDir).slice(1).every(([,file])=>!read(file,{optional:true}).exists));return notApplicable();}
  phase('source_validation');fact(installedBuild(root)===POLICY.holderBuild);const sources=sourceSnapshot(root);
  if(health===null&&(!wal||wal.schemaVersion===2||!fs.existsSync(exitFile)&&!wal.receipt))return await recoverAbsentHolder({root,configPath,configHash,config,runtimeDir,directory,walFile,request,origin,remote,probe,sources,phase,wal},{installedBuild,inspectInstalledProcesses,inspectListenerCount,serverClock,checkpoint});
  fact(wal?.schemaVersion!==2);
  if(!wal||!fs.existsSync(exitFile)){
   phase('holder_validation');fact(probe.holderRequired===true&&health);const record=await inspectProcess(health.pid,root);fact(record&&hex(record.commandHash)&&typeof record.executable==='string'&&Number.isFinite(Date.parse(record.creationTime)));const pinned=structuredClone(health),context={root,configPath,configHash,config,runtimeDir,record};assertHealth(health,context,pinned);await inspectListener(origin,record.pid);fact(same(await inspectInstalledProcesses(root),[record]));
   phase('pause_drain');pauseIdentity={record,pinned};pauseAttempted=true;health=await request(origin+'/local/connection-control',{operation:'pause',nonce:pinned.lifecycle.nonce},{local:true});const deadline=now()+timeoutMs;while(health?.pollingCount){if(now()>=deadline)throw fail('DRAIN_TIMEOUT');await sleep(100);health=await request(origin+'/healthz');}assertHealth(health,context,pinned,{draining:true});phase('local_archive_validation');const local=readLocal(runtimeDir,config),holder={pid:record.pid,creationTime:record.creationTime,nonce:pinned.lifecycle.nonce,root,configSha256:configHash,stateSha256:local.state.sha256};phase('prepare');const prepared=await request(remote('prepare'),{holder});assertPrepared(prepared,holder,local,config);
   phase('archive_backup');const manifest={schemaVersion:1,actionId:ACTION,files:local.rows.map(row=>({role:row.role,sha256:row.sha256,bytes:row.exists?row.bytes.length:null}))};
   if(!wal){fs.mkdirSync(directory,{recursive:true,mode:0o700});for(const row of local.rows){if(!row.exists)continue;const file=path.join(directory,row.role+'.original.json');if(fs.existsSync(file))fact(read(file).sha256===row.sha256);else durable(file,row.bytes,{exclusive:true});checkpoint('backup_'+row.role,{actionId:ACTION});}for(const [name,value]of [['target-started.original.json',local.started],['archive-manifest.json',manifest]]){const file=path.join(directory,name);if(fs.existsSync(file))fact(same(read(file).value,value));else write(file,value,{exclusive:true});}wal={schemaVersion:1,policyDigest:POLICY_DIGEST,actionId:ACTION,stage:'prepared',root,runtimeDir,configPath,configHash,record,pinned,holder,prepared,manifest,files:local.rows.map(({role,path,exists,sha256,bytes})=>({role,path,exists,sha256,bytes:exists?bytes.length:null}))};write(walFile,wal,{exclusive:true});}
   else{fact(same(wal.record,record)&&same(wal.holder,holder)&&same(wal.manifest,manifest)&&same(wal.pinned.lifecycle.nonce,pinned.lifecycle.nonce));wal.prepared=prepared;write(walFile,wal);}
   phase('holder_revalidation');checkpoint('prepared',wal);fact(read(configPath).sha256===configHash&&installedBuild(root)===POLICY.holderBuild&&same(sourceSnapshot(root),sources));fact(same(await inspectProcess(record.pid,root),record));await inspectListener(origin,record.pid);assertHealth(await request(origin+'/healthz'),context,pinned,{draining:true});for(const row of local.rows)fact(same(read(row.path,{optional:row.role!=='action-state'}).sha256,row.sha256));
   phase('terminate');wal.stage='stopping';write(walFile,wal);checkpoint('stopping',wal);const remaining=Date.parse(wal.prepared.expiresAt)-now();if(!Number.isFinite(remaining)||remaining<30000)throw fail('CHALLENGE_EXPIRED_BEFORE_STOP');const url=new URL(origin),output=await terminate({pid:record.pid,creationTime:record.creationTime,commandHash:record.commandHash,executable:record.executable,origin,host:url.hostname.replace(/^\[|\]$/g,''),port:Number(url.port),root,configPath,configSha256:configHash,build:POLICY.holderBuild,workspace:config.workspace,deviceId:config.deviceId,nonce:pinned.lifecycle.nonce,runtimeDir,startedAt:pinned.lifecycle.startedAt,files:[{path:configPath,exists:true,sha256:configHash},...local.rows.map(row=>({path:row.path,exists:row.exists,sha256:row.sha256})),...sources,{path:path.join(directory,'archive-manifest.json'),exists:true,sha256:hash(canonical(manifest))}],exitFile,stopNotAfter:wal.prepared.expiresAt,waitMs:Math.min(8000,timeoutMs)});
   fact(same(output,read(exitFile).value)&&output?.scope==='daemon-root-only'&&output.stopped===true&&output.pid===record.pid&&output.creationTime===record.creationTime);stoppedReceipt={stopped:true,wasRunning:true,pid:record.pid,creationTime:record.creationTime};checkpoint('daemon_exited',wal);
  }
  phase('exit_validation');const saved=verifyArchive(directory,wal,runtimeDir),local=readLocal(runtimeDir,config,{saved}),currentDaemonExit=read(exitFile).value;stoppedReceipt={stopped:true,wasRunning:true,pid:wal.record.pid,creationTime:wal.record.creationTime};fact(currentDaemonExit?.scope==='daemon-root-only'&&currentDaemonExit.stopped===true&&currentDaemonExit.pid===wal.record.pid&&currentDaemonExit.creationTime===wal.record.creationTime&&Number.isFinite(Date.parse(currentDaemonExit.exitedAt))&&Date.parse(currentDaemonExit.exitedAt)<=now());assertPrepared(wal.prepared,wal.holder,local,config);fact(same(read(path.join(directory,'archive-manifest.json')).value,wal.manifest)&&digest(local.started)===digest(read(path.join(directory,'target-started.original.json')).value));
  phase('post_exit_validation');fact(!(await request(origin+'/healthz'))&&!(await inspectProcess(wal.record.pid,root))&&(await inspectInstalledProcesses(root)).length===0&&read(configPath).sha256===configHash&&installedBuild(root)===POLICY.holderBuild&&same(sourceSnapshot(root),sources));
  const localArchive={actionId:ACTION,dedupeKey:local.started.key,stateSha256:local.state.sha256,startedSha256:digest(local.started),deliverySha256:local.journal.sha256,actionSha256:local.action.sha256,resultSha256:local.result.sha256,manifest:wal.manifest,archiveManifestSha256:digest(wal.manifest)},evidence={schemaVersion:1,policy:POLICY.id,policyDigest:POLICY_DIGEST,subjectDigest:wal.prepared.subjectDigest,currentDaemonExit,localArchive,quarantineCount:1};fact(validateForceAbandonEvidence(evidence,wal.prepared.subject,{recordedAt:now()}));if(wal.evidence)fact(same(wal.evidence,evidence));else{wal.evidence=evidence;wal.stage='daemon_exited';write(walFile,wal);}
  const valid=receipt=>validateForceAbandonReceipt(receipt,{actionId:ACTION,subject:wal.prepared.subject,evidenceDigest:digest(evidence)})&&receipt.localArchiveDigest===digest(localArchive)&&same(receipt.currentDaemonExit,currentDaemonExit);
  phase('receipt_commit');if(!wal.receipt){for(const row of local.rows)fact(read(row.path,{optional:row.role!=='action-state'}).sha256===row.sha256);if(probe.completed===true){fact(valid(probe.receipt));wal.receipt=probe.receipt;}else{checkpoint('before_commit',wal);const result=await request(remote('commit'),{challenge:wal.prepared.challenge,evidence});fact(valid(result?.receipt));wal.receipt=result.receipt;}wal.stage='receipt_saved';write(walFile,wal);checkpoint('receipt_saved',wal);}fact(valid(wal.receipt));
  phase('local_apply');fact(!(await request(origin+'/healthz'))&&(await inspectInstalledProcesses(root)).length===0&&read(configPath).sha256===configHash&&installedBuild(root)===POLICY.holderBuild);const nextState={...local.state.value,started:local.state.value.started.filter(row=>row.actionId!==ACTION)},nextBytes=JSON.stringify(nextState),current=read(local.state.path);fact(current.sha256===local.state.sha256||current.sha256===hash(nextBytes));if(current.sha256!==hash(nextBytes)){durable(local.state.path,nextBytes);checkpoint('state_archived',wal);}
  for(const row of local.rows.slice(1)){const present=read(row.path,{optional:true});if(!present.exists)continue;fact(row.exists&&present.sha256===row.sha256);fs.unlinkSync(row.path);checkpoint('removed_'+row.role,wal);}wal.stage='applied';write(walFile,wal);checkpoint('applied',wal);return{recovered:true,actionId:ACTION,...stoppedReceipt,operatorAbandoned:true,originalExecutionExitConfirmed:false,executionConfirmedStopped:false,receiptId:wal.receipt.id};
 }catch(error){const result=error?.code===FORCE_ABANDON_REFUSED?error:fail();if(!stoppedReceipt&&wal&&fs.existsSync(exitFile)){try{const exit=read(exitFile).value;fact(exit.scope==='daemon-root-only'&&exit.stopped===true&&exit.pid===wal.record.pid&&exit.creationTime===wal.record.creationTime&&Date.parse(exit.exitedAt)<=now());stoppedReceipt={stopped:true,wasRunning:true,pid:exit.pid,creationTime:exit.creationTime};}catch{}}if(stoppedReceipt)result.stoppedClientReceipt=stoppedReceipt;else if(pauseAttempted){try{const record=wal?.record||pauseIdentity?.record,pinned=wal?.pinned||pauseIdentity?.pinned;fact(record&&same(await inspectProcess(record.pid,root),record)&&read(configPath).sha256===configHash);await inspectListener(origin,record.pid);const h=await request(origin+'/healthz');fact(h?.lifecycle?.nonce===pinned.lifecycle.nonce);await request(origin+'/local/connection-control',{operation:'resume',nonce:pinned.lifecycle.nonce},{local:true});result.resumed=true;}catch{result.resumeFailed=true;}}throw result;}
};return async input=>{const progress={phase:'configuration'};try{return await recover({...input,progress});}catch(error){const result=error?.code===FORCE_ABANDON_REFUSED?error:fail();result.recoveryPhase=progress.phase;throw result;}};}
export const recoverForceAbandonForUpdate=createForceAbandonRecovery();

export {inventory as inspectForceAbandonInstalledProcesses,nativeListenerCount as inspectForceAbandonListenerCount,sourceSnapshot as inspectForceAbandonSourceSnapshot,originFor as forceAbandonHealthOrigin};
