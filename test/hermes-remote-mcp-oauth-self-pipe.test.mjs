import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('OAuth guard allows only the Windows stdlib event-loop self-pipe and still rejects callback listeners',()=>{
  const root=path.resolve(import.meta.dirname,'..');
  const python=process.env.HERMES_NATIVE_TEST_PYTHON||'python3';
  const result=spawnSync(python,['-I','-B',path.join(import.meta.dirname,'fixtures/hermes-remote-mcp-oauth-self-pipe.py'),root],{encoding:'utf8',windowsHide:true,timeout:10000});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  assert.match(result.stderr,/Ran 6 tests/);
  assert.match(result.stderr,/\bOK\b/);
});
