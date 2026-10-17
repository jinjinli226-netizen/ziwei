import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createRepository } from '../backend/repository.mjs';
import { createManagementService } from '../backend/management.mjs';
import { createPreservation, FROZEN_VERSIONS } from '../backend/version-preservation.mjs';
import { completeOwnedProfile } from '../test-support/owned-profile.mjs';

function fixture(t) {
  const repo=createRepository({memory:true});t.after(()=>repo.db.close());
  repo.heartbeatDevice('test-111',{deviceId:'state-pc',runtimes:{Hermes:{status:'available',profiles:[{name:'default'}],models:[{id:'test-model'}]}}});
  const bots=createManagementService(repo).bots;
  const bot=bots.create('test-111',{name:'Preserved employee',targetDeviceId:'state-pc',runtimeProfile:'default',model:'test-model',idempotencyKey:'state-bot'});
  completeOwnedProfile(repo,bot);
  return {repo,bots,bot};
}

test('state reads exactly the persisted state for empty, preparing, sealed and restored stores',t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  const preservation=createPreservation(db,{readOnly:true});
  assert.equal(preservation.state(),'v2');assert.equal(preservation.frozen(),false);
  db.exec('CREATE TABLE version_preservation(singleton INTEGER PRIMARY KEY,state TEXT,intent_json TEXT,snapshot_json TEXT)');
  assert.equal(preservation.state(),'v2');
  const insert=db.prepare('INSERT OR REPLACE INTO version_preservation VALUES(1,?,?,?)');
  for(const state of ['preparing','sealed','restored']) {
    insert.run(state,'large rollback intent is not needed','large sealed snapshot is not needed');
    const prepare=db.prepare.bind(db);
    const spy=t.mock.method(db,'prepare',sql=>{
      assert.match(sql,/^(SELECT 1 FROM sqlite_master|SELECT state FROM version_preservation)/);
      return prepare(sql);
    });
    assert.equal(preservation.state(),state);
    assert.equal(preservation.frozen(),state!=='restored');
    spy.mock.restore();
  }
});

test('ordinary ACK and execution admission avoid rollback inventory, all actions and employee avatars',t=>{
  const {repo,bot}=fixture(t);
  const action=repo.createA2AAction('test-111',{type:'directory.inspect',payload:{deviceId:'state-pc',path:'C:/Work'}});
  const expectedHome=repo.getA2AAction(bot.instance.provisioning.actionId).result.botProvision.home;
  t.mock.method(repo.preservation,'inspect',()=>assert.fail('A request state check must not run the complete preservation audit'));
  const prepare=repo.db.prepare.bind(repo.db);
  t.mock.method(repo.db,'prepare',sql=>{
    assert.doesNotMatch(sql,/^SELECT \* FROM (?:employees|hermes_bots|bot_routines|a2a_actions)\s*$/i,'No complete rollback inventory on normal ACK/admission');
    assert.doesNotMatch(sql,/\bavatar\b/i);
    return prepare(sql);
  });
  assert.equal(repo.ackA2AAction(action.id,{deviceId:'state-pc'}).status,'acked');
  const permit=repo.authorizeActionExecution(action.id,{deviceId:'state-pc'});
  assert.equal(permit.productState,'v2');assert.equal(permit.productRole,'v2');assert.equal(permit.allowed,true);
  assert.deepEqual(permit.protectedHomes,[expectedHome]);assert.ok(permit.executionBinding);
  assert.throws(()=>repo.authorizeActionExecution(action.id,{deviceId:'other-pc'}),{code:'EXECUTION_DEVICE_MISMATCH'});
  const pending=repo.createA2AAction('test-111',{type:'directory.inspect',payload:{deviceId:'state-pc'}});
  assert.throws(()=>repo.authorizeActionExecution(pending.id,{deviceId:'state-pc'}),{code:'EXECUTION_NOT_ACKED'});
});

test('preparing still blocks Bot admission and starts while ordinary execution reports preparing',t=>{
  const {repo,bots,bot}=fixture(t);
  const botAction=bots.validate('test-111',bot.id,{expectedRevision:1,idempotencyKey:'state-validation'}).action;
  const action=repo.createA2AAction('test-111',{type:'runtime.execute',payload:{deviceId:'state-pc',runtime:'Codex'}});
  repo.preservation.begin({operationId:'state-preparing',versions:FROZEN_VERSIONS});
  t.mock.method(repo.preservation,'inspect',()=>assert.fail('Guard checks use state, not a fresh whole-database audit'));
  assert.equal(repo.preservation.state(),'preparing');
  assert.throws(()=>repo.ackA2AAction(botAction.id,{deviceId:'state-pc'}),{code:'V2_OBJECT_SEALED'});
  assert.throws(()=>repo.authorizeActionExecution(botAction.id,{deviceId:'state-pc'}),{code:'V2_OBJECT_SEALED'});
  repo.ackA2AAction(action.id,{deviceId:'state-pc'});
  assert.equal(repo.authorizeActionExecution(action.id,{deviceId:'state-pc'}).productState,'preparing');
  assert.equal(repo.getA2AAction(botAction.id).availability.state,'preparing');
});

test('sealed/restored transitions retain full audit and V1 compatibility remains frozen',async t=>{
  const {repo,bot}=fixture(t);
  const preservation=createPreservation(repo.db,{collectNativeEvidence:async()=>({safe:true,issues:[],files:[]})});
  preservation.begin({operationId:'state-roundtrip',versions:FROZEN_VERSIONS});
  assert.equal(preservation.state(),'preparing');
  await preservation.seal({operationId:'state-roundtrip'});
  assert.equal(preservation.state(),'sealed');
  assert.equal(preservation.inspect().state,'sealed');
  assert.throws(()=>preservation.assert({employeeId:bot.id}),{code:'V2_OBJECT_SEALED'});
  await preservation.restore({operationId:'state-roundtrip'});
  assert.equal(preservation.state(),'restored');assert.equal(preservation.frozen(),false);
  assert.equal(preservation.inspect().state,'restored');
  assert.doesNotThrow(()=>preservation.assert({employeeId:bot.id}));
  const compat=createPreservation(repo.db,{role:'v1-compat',readOnly:true});
  assert.equal(compat.state(),'restored');assert.equal(compat.frozen(),true);
  assert.throws(()=>compat.assert({employeeId:bot.id}),{code:'V2_OBJECT_SEALED'});
  assert.throws(()=>compat.assertAction(bot.instance.provisioning.actionId),{code:'V2_OBJECT_SEALED'});
});
