import test from 'node:test';
import assert from 'node:assert/strict';
import {safeProfileProvisionDiagnostic,profileProvisionFailure} from '../src/hermes-profile-diagnostic.mjs';
import {finalizeOwnedProfileProvision} from '../src/hermes-owned-profile.mjs';
import {createRepository} from '../backend/repository.mjs';
import {createManagementService} from '../backend/management.mjs';

const processExit={launched:true,rootConfirmed:true,rootExitCode:0,treeConfirmed:true,activeProcesses:0,cancelled:false};
test('profile creation preserves native failure stage and a useful Windows cause in the final receipt',()=>{
  const diagnostic={schemaVersion:1,stage:'publish',exception:'PermissionError',errno:13,winerror:32,source:{file:'hermes-owned-profile.py',function:'provision',line:71}};
  const failed=finalizeOwnedProfileProvision({receipt:{status:'failed',code:'BOT_PROFILE_CREATE_FAILED',diagnostic},processExit});
  assert.equal(failed.status,'failed');assert.equal(failed.code,'BOT_PROFILE_CREATE_FAILED');
  assert.match(failed.error,/保存 Profile 目录/);assert.match(failed.error,/Windows 32/);assert.match(failed.error,/被占用/);
  assert.deepEqual(failed.result,{processExit,diagnostic});
  assert.equal(finalizeOwnedProfileProvision({receipt:{status:'failed',code:'BOT_PROFILE_CREATE_FAILED',diagnostic},processExit:{...processExit,treeConfirmed:false}}).code,'EXECUTION_UNCERTAIN');
});
test('unknown and private diagnostic fields cannot escape the native boundary',()=>{
  const raw={schemaVersion:1,stage:'native_layout',exception:'OSError',errno:28,winerror:112,message:'PRIVATE',path:'PRIVATE',env:{token:'PRIVATE'},source:{file:'C:/PRIVATE/profiles.py',function:'PRIVATE',line:3},cleanupFailed:true};
  const clean=safeProfileProvisionDiagnostic(raw);
  assert.deepEqual(clean,{schemaVersion:1,stage:'native_layout',exception:'OSError',errno:28,winerror:112,cleanupFailed:true});
  assert.match(profileProvisionFailure({code:'BOT_PROFILE_CREATE_FAILED',diagnostic:raw}).error,/磁盘空间不足/);
  for(const patch of [{stage:'PRIVATE'},{exception:'PRIVATE'},{schemaVersion:2}])assert.equal(safeProfileProvisionDiagnostic({...raw,...patch}),null);
  assert.equal(JSON.stringify(profileProvisionFailure({code:'BOT_PROFILE_PRIVATE credential',diagnostic:raw})).includes('PRIVATE'),false);
  assert.equal(safeProfileProvisionDiagnostic({...raw,errno:-1,winerror:Infinity}).errno,undefined);
});
test('legacy and explicit ownership failures keep their code without claiming creation success',()=>{
  assert.deepEqual(profileProvisionFailure({code:'BOT_PROFILE_OWNERSHIP_CONFLICT'}),{code:'BOT_PROFILE_OWNERSHIP_CONFLICT',error:'BOT_PROFILE_OWNERSHIP_CONFLICT'});
  assert.deepEqual(profileProvisionFailure({code:'BOT_PROFILE_CREATE_FAILED'}),{code:'BOT_PROFILE_CREATE_FAILED',error:'BOT_PROFILE_CREATE_FAILED'});
});
test('a missing native module is bounded and preserved without paths or exception messages',()=>{
  const diagnostic={schemaVersion:1,stage:'native_imports',exception:'ModuleNotFoundError',missingModule:'yaml'};
  assert.equal(safeProfileProvisionDiagnostic(diagnostic).missingModule,'yaml');
  assert.match(profileProvisionFailure({code:'BOT_PROFILE_CREATE_FAILED',diagnostic}).error,/缺少 yaml/);
  for(const missingModule of ['C:/private/token','https://private?token=x','name\nsecret','a'.repeat(121),'..outside'])assert.equal(safeProfileProvisionDiagnostic({...diagnostic,missingModule}).missingModule,undefined);
  assert.equal(safeProfileProvisionDiagnostic({...diagnostic,exception:'PermissionError'}).missingModule,undefined);
});
test('the production result path retains diagnostic detail in the Bot view and retries the same profile',t=>{
  const repo=createRepository({memory:true}),bots=createManagementService(repo).bots;t.after(()=>repo.db.close());
  repo.heartbeatDevice('test-111',{deviceId:'diagnostic-pc',runtimes:{Hermes:{status:'available',profiles:[{name:'default'}]}}});
  const bot=bots.create('test-111',{name:'Diagnostic',targetDeviceId:'diagnostic-pc',runtimeProfile:'default',model:'fixture',idempotencyKey:'diagnostic-create'});
  const action=repo.getA2AAction(bot.instance.provisioning.actionId);repo.ackA2AAction(action.id,{deviceId:'diagnostic-pc'});
  const failed=finalizeOwnedProfileProvision({receipt:{status:'failed',code:'BOT_PROFILE_CREATE_FAILED',diagnostic:{schemaVersion:1,stage:'native_bootstrap',exception:'ModuleNotFoundError'}},processExit});
  repo.resultA2AAction(action.id,{...failed,deviceId:'diagnostic-pc'});
  const current=bots.get('test-111',bot.id);
  assert.equal(current.instance.provisioning.status,'failed');assert.match(current.instance.provisioning.error,/初始化原生 Profile/);assert.match(current.instance.provisioning.error,/组件加载失败/);
  assert.deepEqual(repo.getA2AAction(action.id).result.diagnostic,failed.result.diagnostic);
  const retry=bots.provision('test-111',bot.id,{expectedRevision:1,idempotencyKey:'diagnostic-retry'}).action;
  assert.notEqual(retry.id,action.id);assert.equal(retry.payload.hermesBot.instance.profile,bot.instance.profile);assert.equal(retry.payload.hermesBot.instance.ownershipId,bot.instance.ownershipId);
});
