import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';

test('official update bootstrap preserves identical text under Windows PowerShell legacy and UTF-8 decoding', {skip:process.platform!=='win32'}, async()=>{
  const file=fileURLToPath(new URL('../scripts/update-windows.ps1',import.meta.url));
  const bytes=fs.readFileSync(file);
  assert.equal(bytes.toString('utf8'),bytes.toString('latin1'),'octet-stream IRM must decode to the same executable text');
  const code="$tokens=$null; $errors=$null; $ast=[System.Management.Automation.Language.Parser]::ParseFile($env:ZIWEI_BOOTSTRAP_TEST_FILE,[ref]$tokens,[ref]$errors); if($errors.Count){throw 'Bootstrap has parser errors'}; if(-not $ast.Extent.Text.Contains('Ziwei update complete')){throw 'Bootstrap text encoding changed'}; [Console]::Write('parsed')";
  const result=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],{env:{...process.env,ZIWEI_BOOTSTRAP_TEST_FILE:file},windowsHide:true,timeout:10000});
  assert.equal(result.stdout,'parsed');
});

test('legacy confirmation accepts trimmed yes and treats every other answer as a normal cancellation', {skip:process.platform!=='win32'}, async()=>{
  const file=fileURLToPath(new URL('../scripts/update-windows.ps1',import.meta.url));
  // Execute the actual confirmation branch from the shipped script, without
  // running its network, staging or client-maintenance operations.
  const code=`$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile($env:ZIWEI_BOOTSTRAP_TEST_FILE,[ref]$tokens,[ref]$errors)
$branch=$ast.FindAll({param($n) $n -is [System.Management.Automation.Language.IfStatementAst] -and $n.Extent.Text -match '^if \\(\\$ziweiLegacyAnswer'},$true) | Select-Object -First 1
if(-not $branch){throw 'Confirmation branch missing'}
$script=[scriptblock]::Create($branch.Extent.Text+'; Write-Output CONTINUED')
$results=@()
foreach($answer in @('YES','yes','  YeS  ','','Y','no','anything')){
 $ziweiLegacyAnswer=$answer
 try{$output=(& $script 6>&1 | Out-String);$results+=@{answer=$answer;continued=$output.Contains('CONTINUED');error=$false;output=$output}}
 catch{$results+=@{answer=$answer;continued=$false;error=$true;output=$_.Exception.Message}}
}
$results | ConvertTo-Json -Compress`;
  const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],{env:{...process.env,ZIWEI_BOOTSTRAP_TEST_FILE:file},windowsHide:true,timeout:10000});
  const results=JSON.parse(stdout);
  for(const row of results){
    assert.equal(row.error,false,`cancellation must not throw: ${JSON.stringify(row.answer)}`);
    assert.equal(row.continued,['YES','yes','  YeS  '].includes(row.answer),`explicit consent only: ${JSON.stringify(row.answer)}`);
    if(!row.continued)assert.match(row.output,/preserved/i);
  }
});
