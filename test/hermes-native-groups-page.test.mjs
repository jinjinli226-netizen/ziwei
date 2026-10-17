import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {normalizeNativeOperation,nativeIsExecution} from '../src/hermes-native-contract.mjs';

test('groups.read opt-in pagination validates safe cursor and bounded limit; old full read is unchanged',()=>{
  const normalize=input=>normalizeNativeOperation({resource:'groups',operation:'read',input});
  assert.deepEqual(normalize({groupId:'room-one'}),{schemaVersion:2,resource:'groups',operation:'read',input:{groupId:'room-one'}});
  assert.deepEqual(normalize({groupId:'room-one',limit:30,afterSeq:0}).input,{groupId:'room-one',limit:30,afterSeq:0});
  assert.equal(normalize({groupId:'room-one',limit:100,afterSeq:Number.MAX_SAFE_INTEGER}).input.afterSeq,Number.MAX_SAFE_INTEGER);
  assert.equal(nativeIsExecution(normalize({groupId:'room-one',limit:1})),false);
  for(const limit of [0,-1,101,1.5,'30',true,null,Infinity,Number.MAX_SAFE_INTEGER])assert.throws(()=>normalize({groupId:'room-one',limit}),{code:'BOT_NATIVE_INPUT_INVALID'});
  for(const afterSeq of [-1,1.5,'0',true,null,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>normalize({groupId:'room-one',limit:30,afterSeq}),{code:'BOT_NATIVE_INPUT_INVALID'});
  assert.throws(()=>normalize({groupId:'room-one',afterSeq:0}),{code:'BOT_NATIVE_INPUT_INVALID'});
  for(const operation of ['list','step'])assert.throws(()=>normalizeNativeOperation({resource:'groups',operation,input:{groupId:'room-one',limit:30,afterSeq:0}}),{code:'BOT_NATIVE_INPUT_INVALID'});
});

test('Python group pages are one native storage read with no planning, default and step remain full-log reads',t=>{
  let python;
  for(const command of [process.env.HERMES_NATIVE_TEST_PYTHON,path.join(os.homedir(),'.hermes/hermes-agent/venv/bin/python'),'python3','python'].filter(Boolean)){
    const probe=spawnSync(command,['-I','-B','-c','import sys; assert sys.version_info >= (3,11); print(sys.executable)'],{encoding:'utf8',timeout:5000});
    if(probe.status===0&&path.isAbsolute(probe.stdout.trim())){python=probe.stdout.trim();break;}
  }
  assert(python,'Python is required for isolated group pagination tests');
  const root=path.resolve(import.meta.dirname,'..'),source=process.env.HERMES_NATIVE_TEST_SOURCE||path.join(root,'.local/hermes-022-official-launcher/source');
  const result=spawnSync(python,['-I','-B',path.join(import.meta.dirname,'fixtures/hermes-native-groups-page.py'),path.join(root,'src/hermes-native-bridge.py'),fs.existsSync(path.join(source,'gateway/hosted_rooms.py'))?source:''],{encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);assert.match(result.stderr,/\bOK\b/);
  t.diagnostic(result.stderr.trim());
});
