import test from 'node:test';
import assert from 'node:assert/strict';
import {runBotValidationProcess} from '../src/runtime-adapters.mjs';
test('config-only validation retains real supervised exit proof',async()=>{
  assert.equal(typeof runBotValidationProcess,'function');
  const result=await runBotValidationProcess({command:process.execPath,args:['-e','console.log(JSON.stringify({botValidation:{valid:true}}))'],cwd:process.cwd(),env:process.env});
  assert.equal(result.processExit.rootConfirmed,true);assert.equal(result.processExit.treeConfirmed,true);assert.equal(result.processExit.activeProcesses,0);assert.ok(result.output.includes('botValidation'));
});
