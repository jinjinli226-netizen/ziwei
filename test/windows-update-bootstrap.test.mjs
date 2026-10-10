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
