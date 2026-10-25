import test from 'node:test';
import assert from 'node:assert/strict';
import {BOT_DEFAULT_TOOLSETS,createDefaultBotConfig,normalizeBotConfig} from '../src/hermes-bot-config.mjs';
import {createRepository} from '../backend/repository.mjs';
import {createManagementService} from '../backend/management.mjs';
import {completeOwnedProfile} from '../test-support/owned-profile.mjs';

function fixture(t){
  const repo=createRepository({memory:true,envEncryptionKey:'default-tools-test-only'});t.after(()=>repo.db.close());
  repo.heartbeatDevice('test-111',{deviceId:'default-tools-pc',runtimes:{Hermes:{status:'available',version:'0.21.3',profiles:[{name:'default',provider_configured:true,authentication_configured:true}]}}});
  const management=createManagementService(repo),bots=management.bots;
  const create=(key,config)=>bots.create('test-111',{name:key,sourceProfile:'default',targetDeviceId:'default-tools-pc',idempotencyKey:key,...(config===undefined?{}:{config})});
  const employee=name=>repo.createEmployee('test-111',{name,runtime:'Hermes',runtimeProfile:'default',targetDeviceId:'default-tools-pc'});
  return{repo,management,bots,create,employee};
}

test('new creation defaults enable the fixed core toolsets including missing permissions during normalization',()=>{
  const config=createDefaultBotConfig();assert.equal(config.permissions.mode,'execute');assert.deepEqual(config.toolsets,['web','browser','file','terminal','vision','skills','todo','memory','session_search','code_execution','ziwei_autonomy']);
  assert.deepEqual(normalizeBotConfig().toolsets,BOT_DEFAULT_TOOLSETS);assert.equal(normalizeBotConfig().permissions.mode,'execute');assert.deepEqual(normalizeBotConfig(config),config);
  assert.notEqual(config.toolsets,BOT_DEFAULT_TOOLSETS);config.toolsets.pop();assert.equal(createDefaultBotConfig().toolsets.length,11);
});

test('explicit chat-only, empty tool list and disabled settings remain authoritative',()=>{
  const readonly=createDefaultBotConfig({permissions:{mode:'read_only',management:false},memory:{enabled:false,userProfile:false}});
  assert.equal(readonly.permissions.mode,'read_only');assert.equal(readonly.permissions.management,false);assert.deepEqual(readonly.toolsets,[]);assert.equal(readonly.memory.enabled,false);assert.equal(readonly.memory.userProfile,false);
  assert.deepEqual(createDefaultBotConfig({toolsets:[]}).toolsets,[]);assert.equal(createDefaultBotConfig({toolsets:[]}).permissions.mode,'execute');
  assert.deepEqual(createDefaultBotConfig({toolsets:['file']}).toolsets,['file']);
  assert.throws(()=>createDefaultBotConfig({permissions:{mode:'read_only'},toolsets:['file']}),{code:'BOT_PERMISSION_CONFLICT'});
  assert.deepEqual(createDefaultBotConfig({toolsets:['cron']}).toolsets,['ziwei_autonomy']);assert.throws(()=>createDefaultBotConfig({toolsets:['delegation']}),{code:'BOT_TARGET_NOT_AUTHORIZED'});
  for(const input of [null,[],{permissions:[]},{permissions:'execute'},{unknown:true}])assert.throws(()=>createDefaultBotConfig(input));
});

test('new Bot create and first initialization use core defaults, including the uninitialized draft',t=>{
  const f=fixture(t),created=f.create('new-default');
  assert.deepEqual(created.config,createDefaultBotConfig());assert.deepEqual(f.repo.getA2AAction(created.instance.provisioning.actionId).payload.hermesBot.config,created.config);
  const employee=f.employee('existing ordinary employee'),draft=f.bots.get('test-111',employee.id);assert.equal(draft.configuration_state,'uninitialized');assert.deepEqual(draft.config,createDefaultBotConfig());
  const initialized=f.bots.initialize('test-111',employee.id,{idempotencyKey:'first-init'});assert.equal(initialized.configuration_state,'initialized');assert.deepEqual(initialized.config,createDefaultBotConfig());
});

test('new create and initialization preserve explicitly chat-only configurations',t=>{
  const f=fixture(t),config={permissions:{mode:'read_only'},toolsets:[]};
  assert.deepEqual(f.create('explicit-chat-only',config).config,normalizeBotConfig(config));
  const employee=f.employee('explicit init');assert.deepEqual(f.bots.initialize('test-111',employee.id,{idempotencyKey:'chat-only-init',config}).config,normalizeBotConfig(config));
});

test('existing saved configurations, ordinary updates and replayed old requests never acquire new defaults',t=>{
  const f=fixture(t),config=normalizeBotConfig({permissions:{mode:'read_only',management:false},toolsets:[],memory:{enabled:false}}),created=f.create('legacy-default-request');
  completeOwnedProfile(f.repo,created);
  // Simulate a request accepted before the new creation policy, retaining its raw create fingerprint.
  f.repo.db.prepare('UPDATE hermes_bots SET config_json=? WHERE employee_id=?').run(JSON.stringify(config),created.id);
  const replay=f.create('legacy-default-request');assert.equal(replay.id,created.id);assert.equal(replay.duplicate,true);assert.deepEqual(replay.config,config);
  const renamed=f.bots.update('test-111',created.id,{expectedRevision:1,employee:{name:'renamed'}});assert.deepEqual(renamed.config,config);assert.equal(renamed.revision,1);
  const explicitlySaved=f.bots.update('test-111',created.id,{expectedRevision:1,config});assert.deepEqual(explicitlySaved.config,config);assert.equal(explicitlySaved.revision,1);
  const partial=f.bots.update('test-111',created.id,{expectedRevision:1,config:{maxTurns:8}});assert.equal(partial.config.permissions.mode,'read_only');assert.deepEqual(partial.config.toolsets,[]);assert.equal(partial.config.maxTurns,8);
  assert.deepEqual(f.bots.get('test-111',created.id).config,partial.config);
});
