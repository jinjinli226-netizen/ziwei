import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const file=fileURLToPath(new URL('../scripts/remove-hermes-test-home.ps1',import.meta.url));
const bytes=fs.readFileSync(file),source=bytes.toString('utf8');
const literal=name=>{const match=source.match(new RegExp(`^\\$${name} = '([^']+)'$`,'m'));assert.ok(match,`${name} is fixed in the shipped script`);return match[1];};
const binding={version:1,templateId:'ziwei-hermes-bot',key:literal('targetKey'),origin:literal('targetOrigin'),workspace:literal('targetWorkspace'),employeeId:literal('targetEmployee'),sourceHome:literal('sourceHomeExpected'),sourceProfile:'default'};

test('the standalone PowerShell cleanup preserves ASCII decoding and the verified production marker hash',()=>{
 assert.equal(bytes.toString('latin1'),source,'PowerShell 5.1 must receive identical text without UTF-8 assumptions');
 assert.equal(binding.employeeId,'employee_af9cc485-b8b5-472e-bf8e-70abb88b912e');
 assert.equal(binding.origin,'https://qzelynth.top');assert.equal(binding.workspace,'bigtron');
 assert.equal(binding.sourceHome,'C:\\Users\\25941\\AppData\\Local\\hermes');
 assert.equal(createHash('sha256').update(JSON.stringify([binding.origin,binding.workspace,binding.employeeId])).digest('hex'),binding.key);
});

test('cleanup has one literal target deletion guarded by Apply, marker recheck and a bounded junction-safe tree check',()=>{
 assert.match(source,/param\([^\n]*\[string\]\$RuntimeDir = ''[^\n]*\[switch\]\$Apply\)/);
 assert.equal([...source.matchAll(/^\s*Remove-Item\b/gm)].length,1);
 assert.match(source,/if \(\$Apply\) \{[\s\S]*?Confirm-Target \$verified\.path[\s\S]*?TARGET_MARKER_CHANGED[\s\S]*?Assert-SafeTree \$verified\.path[\s\S]*?Remove-Item -LiteralPath \$verified\.path -Recurse -Force -ErrorAction Stop[\s\S]*?TARGET_HOME_STILL_EXISTS/);
 assert.match(source,/MULTIPLE_TARGET_HOMES_REFUSED/);assert.match(source,/SHARED_SOURCE_REFUSED/);
 assert.match(source,/REPARSE_POINT_REFUSED/);assert.match(source,/TREE_TOO_LARGE_FOR_BOUNDED_CHECK/);
 assert.match(source,/executionConfirmedStopped = \$false/);assert.match(source,/processTerminationAttempted = \$false/);
 assert.doesNotMatch(source,/Stop-Process|taskkill|\.Kill\(|Invoke-WebRequest|Invoke-RestMethod|Start-Process|allowedExecutables|deviceToken/);
 assert.doesNotMatch(source,/Get-ChildItem[^\r\n]*-Recurse/,'discovery must not recurse through the disk or a junction');
 assert.match(source,/\[Console\]::Error\.WriteLine\(\$_\.Exception\.Message\)/);
});

test('the marker fixture identifies only the legacy private HOME and preserves its shared default source',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-cleanup-fixture-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const target=path.join(root,'runtime','bot-instances',binding.key),shared=path.join(root,'shared-default');
 fs.mkdirSync(target,{recursive:true});fs.mkdirSync(shared);fs.writeFileSync(path.join(shared,'sentinel'),'keep shared source');
 fs.writeFileSync(path.join(target,'ziwei-instance.json'),JSON.stringify(binding));
 const actual=JSON.parse(fs.readFileSync(path.join(target,'ziwei-instance.json')));
 assert.deepEqual(actual,binding);assert.equal(Object.hasOwn(actual,'mode'),false);
 assert.equal(path.basename(target),actual.key);assert.notEqual(target,shared);
 assert.equal(fs.readFileSync(path.join(shared,'sentinel'),'utf8'),'keep shared source');
 // Portable fixture/contract verification only; the Windows implementation is
 // exercised below when Windows PowerShell is available.
});

test('Windows PowerShell parses and executes the actual marker, junction, inspect and Apply guards on an isolated fixture',{skip:process.platform!=='win32'},t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-cleanup-native-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const target=path.join(root,'bot-instances',binding.key),shared=path.join(root,'shared-default');
 fs.mkdirSync(target,{recursive:true});fs.mkdirSync(shared);fs.writeFileSync(path.join(shared,'sentinel'),'preserve');
 fs.writeFileSync(path.join(target,'ziwei-instance.json'),JSON.stringify(binding));
 fs.writeFileSync(path.join(target,'memory.txt'),'only the test HOME is deletable');
 const constants=['targetOrigin','targetWorkspace','targetEmployee','targetKey','sourceHomeExpected'].map(name=>`$${name} = '${literal(name).replaceAll("'","''")}'`).join('\n');
 const code=`$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile($env:ZIWEI_CLEANUP_TEST_SCRIPT,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'PowerShell parser errors'}
$definitions=$ast.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst]},$true)
. ([scriptblock]::Create(($definitions | ForEach-Object {$_.Extent.Text}) -join "\n"))
${constants}
$verified=Confirm-Target $env:ZIWEI_CLEANUP_TEST_HOME
Assert-SafeTree $verified.path
$marker=Join-Path $verified.path 'ziwei-instance.json'
$original=[IO.File]::ReadAllText($marker)
$wrong=$original | ConvertFrom-Json;$wrong.employeeId='employee_wrong'
[IO.File]::WriteAllText($marker,($wrong | ConvertTo-Json -Compress))
$refused=$false;try{$null=Confirm-Target $verified.path}catch{if($_.Exception.Message -eq 'TARGET_MARKER_MISMATCH'){$refused=$true}else{throw}}
if(-not $refused){throw 'Wrong employee accepted'}
[IO.File]::WriteAllText($marker,$original)
$null=New-Item -ItemType Junction -Path (Join-Path $verified.path 'escape') -Target $env:ZIWEI_CLEANUP_TEST_SHARED
$refused=$false;try{Assert-SafeTree $verified.path}catch{if($_.Exception.Message -eq 'REPARSE_POINT_REFUSED'){$refused=$true}else{throw}}
if(-not $refused){throw 'Junction accepted'}
[IO.Directory]::Delete((Join-Path $verified.path 'escape'))
$branch=$ast.FindAll({param($n) $n -is [System.Management.Automation.Language.IfStatementAst] -and $n.Extent.Text.StartsWith('if ($Apply) {')},$true) | Select-Object -First 1
if(-not $branch){throw 'Apply guard missing'}
$Apply=$false;. ([scriptblock]::Create($branch.Extent.Text))
if(-not (Test-Path -LiteralPath $verified.path)){throw 'Inspect deleted HOME'}
$Apply=$true;. ([scriptblock]::Create($branch.Extent.Text))
if(Test-Path -LiteralPath $verified.path){throw 'Apply retained HOME'}
if(-not (Test-Path -LiteralPath (Join-Path $env:ZIWEI_CLEANUP_TEST_SHARED 'sentinel'))){throw 'Shared source changed'}
[Console]::Write('verified')`;
 const stdout=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],{env:{...process.env,ZIWEI_CLEANUP_TEST_SCRIPT:file,ZIWEI_CLEANUP_TEST_HOME:target,ZIWEI_CLEANUP_TEST_SHARED:shared},encoding:'utf8',windowsHide:true,timeout:15000});
 assert.equal(stdout,'verified');
});
