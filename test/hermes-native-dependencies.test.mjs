import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('the official PM activates a real committed PyYAML generation before owned profile creation',t=>{
  const root=path.resolve(import.meta.dirname,'..'),source=process.env.HERMES_NATIVE_TEST_SOURCE||path.join(root,'.local/hermes-022-official-launcher/source');
  if(!fs.existsSync(path.join(source,'pm/environments.py'))){t.skip('Set HERMES_NATIVE_TEST_SOURCE to the offline official Hermes 0.22 source');return;}
  let native;
  for(const command of [process.env.HERMES_NATIVE_TEST_PYTHON,path.join(os.homedir(),'.hermes/hermes-agent/venv/bin/python'),'python3','python'].filter(Boolean)){
    const result=spawnSync(command,['-I','-B','-c','import importlib.util,json,sys; s=importlib.util.find_spec("yaml"); print(json.dumps({"python":sys.executable,"yaml":s.origin if s else None,"supported":sys.version_info >= (3,11)}))'],{encoding:'utf8',windowsHide:true,timeout:5000});
    if(result.status!==0)continue;const info=JSON.parse(result.stdout);if(info.supported&&info.yaml){native=info;break;}
  }
  if(!native){t.skip('Set HERMES_NATIVE_TEST_PYTHON to an offline Python >=3.11 with PyYAML to copy into the private generation');return;}
  const result=spawnSync(native.python,['-I','-B',path.join(import.meta.dirname,'fixtures/hermes-native-dependencies.py'),root,source,path.dirname(native.yaml)],{encoding:'utf8',windowsHide:true,timeout:60000});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);assert.match(result.stderr,/Ran 3 tests/);assert.match(result.stderr,/\bOK\b/);
});
