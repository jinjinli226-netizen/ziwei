import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {CLI_VERSION,getCapabilities,getOperation} from '../src/registry.mjs';

const read=file=>fs.readFile(new URL(`../${file}`,import.meta.url),'utf8');

test('2.0.4 package, public catalog, build banner and documentation agree',async()=>{
  const pkg=JSON.parse(await read('package.json'));
  assert.equal(pkg.version,'2.0.4');
  assert.equal(CLI_VERSION,pkg.version);
  assert.equal(getCapabilities().cliVersion,pkg.version);
  assert.match(await read('scripts/build.mjs'),/workspace-cli 2\.0\.4: independent native schemas ready/);
  for(const file of ['README.md','COMPATIBILITY.md']){
    const text=await read(file);
    assert.match(text.split('\n')[0],/2\.0\.4/);
    assert.match(text,/49 (?:business )?operations/);
    assert.doesNotMatch(text,/2\.0\.0|2026-10-22|production deployment pending|deployment remains pending/);
  }
});

test('release catalog retains 49 operations, employee plugins and mixed runtime Bot schemas',()=>{
  const catalog=getCapabilities().operations;
  assert.equal(catalog.length,49);
  assert.equal(new Set(catalog.map(op=>op.name)).size,49);
  for(const action of ['get','refresh','apply'])assert.ok(getOperation(`employees.plugins.${action}`));
  assert.equal(catalog.some(op=>op.name.startsWith('mixedGroups.')),false);
  for(const name of ['bots.create','bots.initialize','bots.update','bots.collaboration']){
    const data=getOperation(name).inputSchema.properties.data.properties;
    assert.deepEqual(data.runtime.enum,['Hermes','DSH','Codex']);
    for(const field of ['members','memberDescriptors']){
      assert.deepEqual(data[field].items.properties.runtime.enum,['Hermes','DSH','Codex']);
      assert.deepEqual(data[field].items.required,['employeeId','runtime']);
      assert.equal(data[field].maxItems,6);
    }
  }
});

test('offline identity catalog describes implemented machine login and its real boundaries',()=>{
  const {identity,authorization}=getCapabilities();
  assert.equal(authorization.verification,'offline');
  assert.equal(authorization.grantsVerified,false);
  assert.match(identity.unified,/requires configured ready server/);
  assert.doesNotMatch(identity.unified,/deployment pending/);
  assert.match(identity.machine,/implemented/);
  for(const flag of ['--mode machine','--purpose employee','--worker-file'])assert.ok(identity.machine.includes(flag));
  assert.match(identity.machine,/<=300 seconds/);
  assert.match(identity.machine,/no refresh token/);
  assert.match(identity.machine,/single employee\/workspace/);
  assert.match(identity.machine,/no shared administrator credentials/);
  assert.doesNotMatch(identity.machine,/not_supported/);
});

test('release documentation distinguishes proposed distribution and human refresh from machine grants',async()=>{
  const readme=await read('README.md');
  assert.match(readme,/https:\/\/ziwei\.qzelynth\.top\/downloads\/workspace-cli\/2\.0\.4\/ziwei-workspace-cli-2\.0\.4\.tgz/);
  assert.match(readme,/not yet published/);
  for(const file of ['README.md','COMPATIBILITY.md']){
    const text=file==='README.md'?readme:await read(file);
    assert.match(text,/long-lived/);
    assert.match(text,/automatic refresh/);
    assert.match(text,/refresh_expires_in/);
    assert.match(text,/loginSessionExpiresAt/);
    assert.match(text,/<=300 seconds/);
    assert.match(text,/no refresh token/);
    assert.match(text,/mixedGroups\.\*/);
    assert.doesNotMatch(text,/offline_access` is never requested|Before saving login\/refresh|Concurrent refresh attempts fail with/);
  }
});
