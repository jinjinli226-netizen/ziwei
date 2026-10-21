import test from 'node:test';
import assert from 'node:assert/strict';
import {createRepository} from './repository.mjs';

const snapshot=db=>Object.fromEntries(['devices','runtimes','runtime_metadata','runtime_device_metadata'].map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
const runtimes=version=>({Codex:{version,status:'available'},Hermes:{version,status:'available',profiles:[{name:'default'}]}});

// Preserve the two atomic wrappers observed in the migrated production source
// on 2026-10-21; an individual runtime failure must not leave half a heartbeat.
test('standalone runtime registration rolls all related runtime rows back on a later CLI metadata failure',t=>{
  const repo=createRepository({memory:true}),db=repo.db;t.after(()=>db.close());
  repo.heartbeatDevice('test-111',{deviceId:'atomic-device',runtimes:runtimes('before')});
  const before=snapshot(db);
  db.exec("CREATE TRIGGER atomic_runtime_failure BEFORE UPDATE ON runtime_device_metadata WHEN NEW.runtime_name='Hermes' BEGIN SELECT RAISE(ABORT,'fixture runtime failure'); END");
  assert.throws(()=>repo.registerRuntimes('test-111',{deviceId:'atomic-device',runtimes:runtimes('after')}),/fixture runtime failure/);
  assert.deepEqual(snapshot(db),before);
  db.exec('DROP TRIGGER atomic_runtime_failure');
  assert(repo.registerRuntimes('test-111',{deviceId:'atomic-device',runtimes:runtimes('after')}).some(runtime=>runtime.name==='Hermes'&&runtime.cli_version==='after'));
});
test('heartbeat rolls device identity and nested runtime registration back together without breaking the next heartbeat',t=>{
  const repo=createRepository({memory:true}),db=repo.db;t.after(()=>db.close());
  repo.heartbeatDevice('test-111',{deviceId:'atomic-device',name:'Before',version:'before',runtimes:runtimes('before')});
  const before=snapshot(db);
  db.exec("CREATE TRIGGER atomic_heartbeat_failure BEFORE UPDATE ON runtime_device_metadata WHEN NEW.runtime_name='Hermes' BEGIN SELECT RAISE(ABORT,'fixture heartbeat failure'); END");
  assert.throws(()=>repo.heartbeatDevice('test-111',{deviceId:'atomic-device',name:'After',version:'after',pid:4321,clientBuild:'a'.repeat(64),runtimes:runtimes('after')}),/fixture heartbeat failure/);
  assert.deepEqual(snapshot(db),before);
  db.exec('DROP TRIGGER atomic_heartbeat_failure');
  const updated=repo.heartbeatDevice('test-111',{deviceId:'atomic-device',name:'After',version:'after',runtimes:runtimes('after')});
  assert.equal(updated.name,'After');assert.equal(updated.runtimes.find(runtime=>runtime.name==='Hermes').version,'after');
});
