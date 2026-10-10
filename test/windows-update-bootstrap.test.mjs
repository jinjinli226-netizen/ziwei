import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

test('official update bootstrap parses in Windows PowerShell 5.1 with its Chinese messages intact', {skip:process.platform!=='win32'}, async()=>{
  const file=fileURLToPath(new URL('../scripts/update-windows.ps1',import.meta.url));
  const code="$tokens=$null; $errors=$null; $ast=[System.Management.Automation.Language.Parser]::ParseFile($env:ZIWEI_BOOTSTRAP_TEST_FILE,[ref]$tokens,[ref]$errors); if($errors.Count){throw 'Bootstrap has parser errors'}; if(-not $ast.Extent.Text.Contains('紫薇更新完成')){throw 'Bootstrap text encoding changed'}; [Console]::Write('parsed')";
  const result=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],{env:{...process.env,ZIWEI_BOOTSTRAP_TEST_FILE:file},windowsHide:true,timeout:10000});
  assert.equal(result.stdout,'parsed');
});
