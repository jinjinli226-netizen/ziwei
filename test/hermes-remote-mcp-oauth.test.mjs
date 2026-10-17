import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('remote MCP OAuth preserves native target HOME credentials and relays callbacks without listeners',t=>{
  const root=path.resolve(import.meta.dirname,'..');
  const sources=[process.env.HERMES_NATIVE_TEST_SOURCE||path.join(root,'.local/hermes-022-official-launcher/source'),path.join(os.homedir(),'.hermes/hermes-agent')];
  const available=[...new Set(sources)].filter(source=>fs.existsSync(path.join(source,'tools/mcp_dashboard_oauth.py')));
  if(!available.length){t.skip('Offline Hermes dashboard OAuth source required');return;}
  const python=process.env.HERMES_NATIVE_TEST_PYTHON||(['.hermes/hermes-agent/venv/bin/python'].map(value=>path.join(os.homedir(),value)).find(value=>fs.existsSync(value)))||'python3';
  for(const source of available){
    const result=spawnSync(python,['-I','-B',path.join(import.meta.dirname,'fixtures/hermes-remote-mcp-oauth.py'),root,source],{encoding:'utf8',windowsHide:true,timeout:30000});
    assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
    assert.match(result.stderr,/Ran \d+ tests/);assert.match(result.stderr,/\bOK\b/);
    t.diagnostic(`Native dashboard callback source: ${source}; ${result.stderr.match(/Ran \d+ tests/)?.[0]}`);
    const sdkResult=spawnSync(python,['-I','-B',path.join(import.meta.dirname,'fixtures/hermes-remote-mcp-oauth-sdk.py'),root,source],{encoding:'utf8',windowsHide:true,timeout:60000});
    assert.equal(sdkResult.status,0,sdkResult.stdout+'\n'+sdkResult.stderr);
    assert.match(sdkResult.stdout,/Native SDK integration passed/);
    t.diagnostic(`Real native probe/SDK + isolated HOME, mocked HTTP only: ${source}`);
  }
});
