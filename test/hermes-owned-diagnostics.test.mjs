import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {finalizeOwnedProfileProvision} from '../src/hermes-owned-profile.mjs';

test('owned Profile Python receipts keep bounded diagnostics, primary failure and UTF-8 JSON',t=>{
  let python;
  for(const command of ['python3','python']){
    const result=spawnSync(command,['-I','-c','import sys;print(sys.executable)'],{encoding:'utf8',windowsHide:true,timeout:5000});
    if(result.status===0&&path.isAbsolute(result.stdout.trim())){python=result.stdout.trim();break;}
  }
  if(!python){t.skip('Python is required for the isolated provision receipt fixture');return;}
  const result=spawnSync(python,['-I','-B',path.resolve(import.meta.dirname,'fixtures/hermes-owned-diagnostics.py')],{encoding:'utf8',windowsHide:true,timeout:20000});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  assert.match(result.stderr,/Ran 14 tests/);
  assert.match(result.stderr,/\bOK\b/);
  const line=result.stdout.split(/\r?\n/).find(value=>value.startsWith('ZIWEI_DIAGNOSTIC_RECEIPTS:'));
  assert.ok(line,'The actual Python receipt must reach the JS finalizer');
  const receipts=JSON.parse(line.slice('ZIWEI_DIAGNOSTIC_RECEIPTS:'.length));assert.equal(receipts.length,2);
  const processExit={launched:true,rootConfirmed:true,rootExitCode:0,treeConfirmed:true,activeProcesses:0,cancelled:false};
  const permission=receipts.find(receipt=>receipt.diagnostic.exception==='PermissionError'),failed=finalizeOwnedProfileProvision({receipt:permission,processExit});
  assert.equal(failed.code,'BOT_PROFILE_CREATE_FAILED');assert.deepEqual(failed.result.diagnostic,permission.diagnostic);
  assert.match(failed.error,/初始化原生 Profile/);assert.match(failed.error,/Windows 5/);assert.match(failed.error,/权限/);
  const missing=receipts.find(receipt=>receipt.diagnostic.exception==='ModuleNotFoundError'),missingFinal=finalizeOwnedProfileProvision({receipt:missing,processExit});
  assert.deepEqual(missingFinal.result.diagnostic,missing.diagnostic);assert.equal(missingFinal.result.diagnostic.missingModule,'yaml');
});
