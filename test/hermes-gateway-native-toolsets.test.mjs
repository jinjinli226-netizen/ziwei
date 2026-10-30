import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('the installed native Gateway parser accepts mapped private MCP without losing native tools',t=>{
  const python=process.env.ZIWEI_TEST_PYTHON,nativeRoot=process.env.ZIWEI_TEST_HERMES_ROOT;
  if(!python||!nativeRoot){t.skip('Set ZIWEI_TEST_PYTHON and ZIWEI_TEST_HERMES_ROOT for native no-network verification');return;}
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-native-toolsets-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const env={PYTHONUTF8:'1',PYTHONDONTWRITEBYTECODE:'1',TEMP:root,TMP:root};
  for(const key of ['SystemRoot','WINDIR','COMSPEC'])if(process.env[key])env[key]=process.env[key];
  const result=spawnSync(python,['-I','-B',path.join(import.meta.dirname,'fixtures/hermes-gateway-toolsets.py')],{
    input:JSON.stringify({root,nativeRoot,bridge:path.resolve(import.meta.dirname,'../src/hermes-gateway-session.py')}),
    env,encoding:'utf8',windowsHide:true,timeout:20000});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  const proof=JSON.parse(result.stdout);
  assert.equal(proof.rawRefusal.field,'toolsets');assert.match(proof.rawRefusal.detail,/ziwei_autonomy/);
  assert.match(proof.managementRefusal.detail,/ziwei_management/);assert.match(proof.unknownRefusal.detail,/custom-unmapped/);
  assert.equal(proof.adapted,true);assert.equal(proof.scopeChanged,true);assert.equal(proof.externalCalls,0);
  assert.equal(proof.nativeToolsets.length,10);assert.deepEqual(proof.privateServers,['ziwei_autonomy','ziwei_management']);
});
