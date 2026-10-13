import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {runPreservation} from '../scripts/v2-preservation.mjs';

test('production routes before rehearsal path checks and cannot take trust from spec JSON',async()=>{
  const spec={mode:'production',database:{path:'not-a-rehearsal-string'},trust:{approved:true}};
  await assert.rejects(runPreservation({...spec,command:'prepare',apply:true}),{code:'PRODUCTION_INDEPENDENT_TRUST_REQUIRED'});
  await assert.rejects(runPreservation({...spec,command:'drain',apply:true},{trust:{}}),{code:'PRODUCTION_COMMAND_INVALID'});
});

test('production CLI requires a separate trust file without changing original bytes or creating sidecars',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-production-cli-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const file=path.join(root,'original.db'),specFile=path.join(root,'spec.json');fs.writeFileSync(file,'original immutable sentinel');
  fs.writeFileSync(specFile,JSON.stringify({mode:'production',database:{path:file},trust:{approved:true}}));
  const before=fs.readFileSync(file),names=fs.readdirSync(root).sort();
  const output=spawnSync(process.execPath,[path.resolve(import.meta.dirname,'../scripts/v2-preservation.mjs'),'prepare','--spec',specFile,'--apply'],{cwd:root,encoding:'utf8',windowsHide:true});
  assert.equal(output.status,1);assert.equal(JSON.parse(output.stderr.split('\n').find(line=>line.startsWith('{'))).code,'PRODUCTION_INDEPENDENT_TRUST_REQUIRED');
  assert.deepEqual(fs.readFileSync(file),before);assert.deepEqual(fs.readdirSync(root).sort(),names);
  const sameFile=spawnSync(process.execPath,[path.resolve(import.meta.dirname,'../scripts/v2-preservation.mjs'),'inspect','--spec',specFile,'--trust',specFile],{cwd:root,encoding:'utf8',windowsHide:true});
  assert.equal(sameFile.status,1);assert.equal(JSON.parse(sameFile.stderr.split('\n').find(line=>line.startsWith('{'))).code,'PRODUCTION_INDEPENDENT_TRUST_REQUIRED');
  assert.deepEqual(fs.readFileSync(file),before);assert.deepEqual(fs.readdirSync(root).sort(),names);
});
