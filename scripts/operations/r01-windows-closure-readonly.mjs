/** Finite current native identity, process superset and existing telemetry.
 * No stops, event/audit enabling, Jobs assigned, files/handles of unrelated
 * processes, business endpoints, arbitrary process environment or commands.
 */
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {execFile,execFileSync} from 'node:child_process';import {promisify} from 'node:util';import {pathToFileURL} from 'node:url';
const run=promisify(execFile),sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const productRoot='C:\\Users\\25941\\.codex\\worktrees\\v2-e03-production-preservation\\灵光爸爸拆解';
const helper=path.join(productRoot,'backend/preservation-source-native-windows.ps1'),modulePath=path.join(productRoot,'backend/preservation-source-namespace.mjs'),ps='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const output=path.resolve(process.argv[2]||''),root=path.resolve(import.meta.dirname,'../..'),privateRoot=path.join(root,'.local');
if(!output.startsWith(privateRoot+path.sep)||fs.existsSync(output)||process.platform!=='win32')throw Error('NEW_PRIVATE_OUTPUT_REQUIRED');
const helperText=fs.readFileSync(helper,'utf8').replaceAll('\r\n','\n'),moduleBytes=fs.readFileSync(modulePath);
if(sha(Buffer.from(helperText))!=='b8fd13d2c22c3ec25b081f4cb33157c24983f473264872ce0de3843f4016f643'||sha(moduleBytes)!=='e89bcc39609428ff4ad79a2a961d7c1ab57545680dff9fac377a10cf5db95c3e'||sha(fs.readFileSync(ps))!=='8bb6fa8c283b4d92120b1ef249a9b311b0f804d4cabbe9981159976c8be76a5e')throw Error('APPROVED_READER_CHANGED');
if(execFileSync('git',['rev-parse','HEAD'],{cwd:productRoot,encoding:'utf8',windowsHide:true}).trim()!=='9491d5e3d572fcb787cb1f7567cdfed393975942')throw Error('APPROVED_COMMIT_CHANGED');
// Only this current reader's finite static repo import graph is checked. This
// does not expand the historical installed SDK or OS provenance requirements.
const qualifiedImports=new Map();
function qualifyImport(file){
 if(qualifiedImports.has(file))return;if(!file.startsWith(productRoot+path.sep)||fs.lstatSync(file).isSymbolicLink()||fs.realpathSync.native(file)!==file)throw Error('READER_IMPORT_PATH_CHANGED');
 const relative=path.relative(productRoot,file).replaceAll('\\','/'),actual=fs.readFileSync(file),expected=execFileSync('git',['show','9491d5e3d572fcb787cb1f7567cdfed393975942:'+relative],{cwd:productRoot,windowsHide:true,maxBuffer:4*1024*1024});
 const text=actual.toString('utf8').replaceAll('\r\n','\n');if(text!==expected.toString('utf8').replaceAll('\r\n','\n'))throw Error('READER_IMPORT_CHANGED');qualifiedImports.set(file,sha(actual));
 const imports=[...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g)].map(match=>match[1]);
 for(const dependency of imports){if(dependency.startsWith('node:'))continue;if(!dependency.startsWith('.'))throw Error('READER_EXTERNAL_IMPORT_UNQUALIFIED');qualifyImport(path.resolve(path.dirname(file),dependency));}
}
qualifyImport(modulePath);
const marker='\n# ZIWEI_SYSTEM_MODULE_PRELUDE_END\n',boundary=helperText.indexOf(marker);if(boundary<0||boundary!==helperText.lastIndexOf(marker))throw Error('APPROVED_PRELUDE_REQUIRED');const prelude=helperText.slice(0,boundary);
const product=await import(pathToFileURL(modulePath)),original={pid:12132,createdAt:'2026-10-12T10:19:53.290Z',entryPath:'D:\\work\\nodejs\\node_global\\node_modules\\ziwei\\daemon\\ziwei_user.mjs'};
const before=await product.inspectWindowsSourceProcess(original),captureUTC=new Date().toISOString();
const script=prelude+String.raw`
 [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
 $rows=@(CimCmdlets\Get-CimInstance Win32_Process | Microsoft.PowerShell.Core\ForEach-Object {
  [pscustomobject]@{pid=[int]$_.ProcessId;parentPid=[int]$_.ParentProcessId;createdAt=if($_.CreationDate){$_.CreationDate.ToUniversalTime().ToString('o')}else{$null}}
 })
 $logs=@();$diagnosticsError=$null
 try {
  $manifest=[IO.Path]::Combine($ziweiSystemModuleRoot,'Microsoft.PowerShell.Diagnostics','Microsoft.PowerShell.Diagnostics.psd1')
  Microsoft.PowerShell.Core\Import-Module -Name $manifest -Scope Global -Force -ErrorAction Stop
  $command=Microsoft.PowerShell.Core\Get-Command -Name 'Microsoft.PowerShell.Diagnostics\Get-WinEvent' -ErrorAction Stop
  if($command.ModuleName -cne 'Microsoft.PowerShell.Diagnostics' -or [string]$command.CommandType -cne 'Cmdlet' -or !($command.Module.Path.StartsWith('C:\Windows\System32\WindowsPowerShell\v1.0\',[StringComparison]::OrdinalIgnoreCase) -or $command.Module.Path.StartsWith('C:\Windows\Microsoft.Net\assembly\GAC_MSIL\',[StringComparison]::OrdinalIgnoreCase))){throw 'DIAGNOSTICS_SOURCE_UNPROVEN'}
  foreach($name in @('Security','Microsoft-Windows-Sysmon/Operational')) {
   try {
    $info=Microsoft.PowerShell.Diagnostics\Get-WinEvent -ListLog $name -ErrorAction Stop
    $oldest=$null;$newest=$null
    if($info.RecordCount -gt 0){$oldest=Microsoft.PowerShell.Diagnostics\Get-WinEvent -LogName $name -Oldest -MaxEvents 1 -ErrorAction Stop;$newest=Microsoft.PowerShell.Diagnostics\Get-WinEvent -LogName $name -MaxEvents 1 -ErrorAction Stop}
    $logs+=[pscustomobject]@{name=$name;readable=$true;enabled=$info.IsEnabled;recordCount=$info.RecordCount;logMode=[string]$info.LogMode;oldestRecordNumber=$info.OldestRecordNumber;oldestAt=if($oldest){$oldest.TimeCreated.ToUniversalTime().ToString('o')}else{$null};newestAt=if($newest){$newest.TimeCreated.ToUniversalTime().ToString('o')}else{$null}}
   }catch{$logs+=[pscustomobject]@{name=$name;readable=$false;errorId=[string]$_.FullyQualifiedErrorId;exceptionType=$_.Exception.GetType().Name}}
  }
 }catch{$diagnosticsError=[string]$_.Exception.GetType().Name}
 [pscustomobject]@{observerPid=[int]$PID;processes=$rows;telemetry=$logs;diagnosticsError=$diagnosticsError}|Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 5 -Compress
`;
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>key.toLowerCase()!=='psmodulepath'));env.PSModulePath=path.join(path.dirname(ps),'Modules');
let snapshot;
try{const {stdout}=await run(ps,['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,env,encoding:'utf8',timeout:25000,maxBuffer:2*1024*1024});snapshot=JSON.parse(stdout.replace(/^\uFEFF/,''));}catch{throw Error('NATIVE_SCOPE_READ_REFUSED');}
const after=await product.inspectWindowsSourceProcess(original);
if(sha(fs.readFileSync(modulePath))!==sha(moduleBytes)||sha(Buffer.from(fs.readFileSync(helper,'utf8').replaceAll('\r\n','\n')))!==sha(Buffer.from(helperText)))throw Error('READER_CHANGED');
for(const [file,digest] of qualifiedImports)if(sha(fs.readFileSync(file))!==digest)throw Error('READER_IMPORT_CHANGED');
const rows=snapshot.processes,issues=[];if(!Array.isArray(rows)||rows.some(row=>!Number.isSafeInteger(row.pid)||!Number.isSafeInteger(row.parentPid)||!Number.isFinite(Date.parse(row.createdAt))))issues.push('CURRENT_BIRTH_INVENTORY_INCOMPLETE');
const originalBirth=Date.parse(original.createdAt),postBirth=rows.filter(row=>Date.parse(row.createdAt)>=originalBirth),currentChain=new Set([original.pid]);let changed=true;while(changed){changed=false;for(const row of rows)if(currentChain.has(row.parentPid)&&!currentChain.has(row.pid)){currentChain.add(row.pid);changed=true;}}
const stable=before&&after&&before.creationFileTime===after.creationFileTime&&before.nativeBirth.bootId===after.nativeBirth.bootId&&before.commandDigest===after.commandDigest;
const report={schemaVersion:1,kind:'r01-original12132-finite-current-closure-audit',captureUTC,completedUTC:new Date().toISOString(),readerSha256:sha(fs.readFileSync(import.meta.filename)),approvedProduct:{commit:'9491d5e3d572fcb787cb1f7567cdfed393975942',moduleSha256:sha(moduleBytes),helperNormalizedLfSha256:sha(Buffer.from(helperText)),readerImports:[...qualifiedImports].map(([file,sha256])=>({path:file,sha256}))},original,before,after,originalIdentityStable:!!stable,snapshot,inventoryIssues:issues,currentProcessCount:rows.length,postOriginalBirthSupersetCount:postBirth.length,postOriginalBirthSuperset:postBirth,currentParentChain:[...currentChain].sort((a,b)=>a-b),scopeClaim:'All currently readable processes born at/after original are a conservative superset, not an attributed descendant list or a stop allowlist.',historicParentChainQualified:false,namespaceComplete:null,sourceServiceActions:0,eventLogWrites:0,auditPolicyWrites:0,jobAssignments:0,modelCalls:0,phoneActions:0,formalGatePassed:false};
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({path:output,sha256:sha(fs.readFileSync(output)),originalIdentityStable:report.originalIdentityStable,currentProcessCount:rows.length,postOriginalBirthSupersetCount:postBirth.length,currentParentChain:report.currentParentChain,telemetry:snapshot.telemetry,inventoryIssues:issues,namespaceComplete:null,formalGatePassed:false}));
