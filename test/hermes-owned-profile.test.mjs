import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createRepository} from '../backend/repository.mjs';
import {createManagementService} from '../backend/management.mjs';

function fixture(t){
  const repo=createRepository({memory:true}),management=createManagementService(repo);
  t.after(()=>repo.db.close());
  repo.heartbeatDevice('test-111',{deviceId:'owned-pc',runtimes:{Hermes:{status:'available',version:'0.21.3',profiles:[{name:'default'}],models:[{id:'fixture'}]}}});
  const input={name:'Owned A',targetDeviceId:'owned-pc',runtimeProfile:'default',model:'fixture',idempotencyKey:'create-a'};
  return{repo,management,bots:management.bots,input};
}
const exited={launched:true,rootConfirmed:true,rootExitCode:0,treeConfirmed:true,activeProcesses:0,cancelled:false};
function proof(bot){const home=path.resolve('fixture-root','profiles',bot.instance.profile);return{schemaVersion:1,mode:'owned_profile',workspace:bot.workspace,employeeId:bot.id,deviceId:bot.employee.target_device_id,ownershipId:bot.instance.ownershipId,profile:bot.instance.profile,templateProfile:bot.instance.templateProfile,provisionActionId:bot.instance.provisionActionId,authMode:'source-native-store',home,profileHome:home,authentication:'required',nativeVersion:'0.21.3'};}
function complete(f,bot,result=proof(bot)){
  const action=f.repo.getA2AAction(bot.instance.provisioning.actionId);
  f.repo.ackA2AAction(action.id,{deviceId:'owned-pc'});
  return f.repo.resultA2AAction(action.id,{deviceId:'owned-pc',status:'succeeded',result:{botProvision:result,processExit:exited}});
}

test('new Bots own distinct stable named profiles and one durable provisioning action',t=>{
  const f=fixture(t),a=f.bots.create('test-111',f.input),b=f.bots.create('test-111',{...f.input,idempotencyKey:'create-b'});
  assert.equal(a.instance?.mode,'owned_profile');
  assert.notEqual(a.instance.profile,b.instance.profile);assert.notEqual(a.instance.profile,'default');
  assert.equal(a.employee.runtime_profile,a.instance.profile);assert.equal(a.instance.templateProfile,'default');
  assert.equal(a.instance.home,null);assert.equal(a.instance.provisioning.status,'pending');
  const action=f.repo.getA2AAction(a.instance.provisioning.actionId);
  assert.equal(action.type,'hermes.bot.provision');assert.equal(action.payload.hermesBot.instance.ownershipId,a.instance.ownershipId);
  assert.equal(action.payload.deviceId,'owned-pc');
  const same=f.bots.create('test-111',f.input);assert.equal(same.id,a.id);assert.equal(same.instance.provisioning.actionId,action.id);
  assert.equal(f.repo.listA2AActions('test-111',{status:'all'}).length,2);
});

test('provisioning is separate from validation and exact native HOME proof is required',t=>{
  const f=fixture(t),bot=f.bots.create('test-111',f.input);
  assert.throws(()=>f.bots.validate('test-111',bot.id,{expectedRevision:1,idempotencyKey:'too-early'}),{code:'BOT_PROFILE_NOT_PROVISIONED'});
  complete(f,bot);
  const current=f.bots.get('test-111',bot.id);assert.equal(current.instance.provisioning.status,'provisioned');assert.equal(current.instance.provisioning.authentication,'required');
  assert.equal(current.instance.home,proof(bot).home);assert.equal(current.control_state,'draft');assert.equal(current.validation.status,'not_checked');
  const validation=f.bots.validate('test-111',bot.id,{expectedRevision:1,idempotencyKey:'validate'}).action;
  assert.equal(validation.payload.profile,bot.instance.profile);assert.equal(validation.payload.hermesBot.sourceProfile,bot.instance.profile);
});

test('mismatched HOME or ownership receipt cannot mark a profile provisioned',t=>{
  const f=fixture(t),bot=f.bots.create('test-111',f.input),receipt=proof(bot);
  const action=f.repo.getA2AAction(bot.instance.provisioning.actionId);f.repo.ackA2AAction(action.id,{deviceId:'owned-pc'});
  for(const patch of [{profileHome:path.resolve('other-home')},{ownershipId:'forged'},{profile:'default'},{deviceId:'other-pc'},{provisionActionId:'action_forged'}]){
    assert.throws(()=>f.repo.resultA2AAction(action.id,{deviceId:'owned-pc',status:'succeeded',result:{botProvision:{...receipt,...patch},processExit:exited}}),{code:'BOT_PROFILE_RECEIPT_INVALID'});
  }
  assert.equal(f.bots.get('test-111',bot.id).instance.home,null);
});

test('provisioning rejects contradictory or incomplete process exit proof',t=>{
  const f=fixture(t),bot=f.bots.create('test-111',f.input),action=f.repo.getA2AAction(bot.instance.provisioning.actionId);
  f.repo.ackA2AAction(action.id,{deviceId:'owned-pc'});
  for(const patch of [{launched:false},{rootConfirmed:false},{rootExitCode:7},{rootExitCode:null},{treeConfirmed:false},{activeProcesses:1},{cancelled:true},{failureCode:'SUPERVISOR_FAILED'}]){
    assert.throws(()=>f.repo.resultA2AAction(action.id,{deviceId:'owned-pc',status:'succeeded',result:{botProvision:proof(bot),processExit:{...exited,...patch}}}),{code:'BOT_PROFILE_RECEIPT_INVALID'});
  }
  assert.equal(f.bots.get('test-111',bot.id).instance.home,null);
});

test('unknown provisioning retains original action and cannot create a second profile',t=>{
  const f=fixture(t),bot=f.bots.create('test-111',f.input),id=bot.instance.provisioning.actionId;
  f.repo.ackA2AAction(id,{deviceId:'owned-pc'});
  f.repo.resultA2AAction(id,{deviceId:'owned-pc',status:'failed',result:{code:'EXECUTION_UNCERTAIN',processExit:{treeConfirmed:false}}});
  const state=f.bots.get('test-111',bot.id);assert.equal(state.instance.provisioning.status,'uncertain');
  const resumed=f.bots.provision('test-111',bot.id,{expectedRevision:1,idempotencyKey:'recover'});
  assert.equal(resumed.action.id,id);assert.equal(f.repo.listA2AActions('test-111',{status:'all'}).length,1);
  assert.throws(()=>f.bots.validate('test-111',bot.id,{expectedRevision:1,idempotencyKey:'blocked'}),{code:'BOT_PROFILE_NOT_PROVISIONED'});
});

test('definite provisioning failure can retry the same identity, and employee rename does not rename profile',t=>{
  const f=fixture(t),bot=f.bots.create('test-111',f.input),id=bot.instance.provisioning.actionId;
  f.repo.ackA2AAction(id,{deviceId:'owned-pc'});f.repo.resultA2AAction(id,{deviceId:'owned-pc',status:'failed',error:'fixture no space',result:{processExit:{treeConfirmed:true,activeProcesses:0}}});
  const retry=f.bots.provision('test-111',bot.id,{expectedRevision:1,idempotencyKey:'retry'}).action;
  assert.notEqual(retry.id,id);assert.equal(retry.payload.profile,bot.instance.profile);assert.equal(retry.payload.hermesBot.instance.ownershipId,bot.instance.ownershipId);
  const renamed=f.bots.update('test-111',bot.id,{expectedRevision:1,employee:{name:'Renamed'}});
  assert.equal(renamed.instance.profile,bot.instance.profile);
  assert.equal(f.bots.provision('test-111',bot.id,{expectedRevision:1,idempotencyKey:'retry'}).action.id,retry.id);
});

test('existing employee initialization stays legacy and arbitrary ownership fields are refused',t=>{
  const f=fixture(t),employee=f.management.createEmployee('test-111',{...f.input,runtime:'Hermes',idempotencyKey:'ordinary'});
  const bot=f.bots.initialize('test-111',employee.id,{idempotencyKey:'initialize'});
  assert.equal(bot.instance?.mode,'legacy_private_home');assert.equal(bot.employee.runtime_profile,'default');assert.equal(bot.instance.provisioning,null);
  for(const patch of [{home:'C:/arbitrary'},{ownershipId:'forged'},{isIndependent:true},{profileMode:'legacy_private_home'}])assert.throws(()=>f.bots.create('test-111',{...f.input,...patch}),{code:'BOT_CREATE_UNSUPPORTED'});
});

test('owned Bot profiles are marked and refused as initialization sources before creating another employee',t=>{
  const f=fixture(t),bot=f.bots.create('test-111',f.input);
  f.repo.heartbeatDevice('test-111',{deviceId:'owned-pc',runtimes:{Hermes:{status:'available',profiles:[{name:'default'},{name:bot.instance.profile},{name:'bot-foreign',owned_profile:true,initialization_source:false}]}}});
  const profiles=f.management.discovery('test-111',{deviceId:'owned-pc'}).devices[0].runtimes.find(item=>item.name==='Hermes').profiles;
  assert.equal(profiles.find(item=>item.name===bot.instance.profile).initialization_source,false);
  assert.equal(profiles.find(item=>item.name==='bot-foreign').owned_profile,true);
  const before=f.repo.listEmployees('test-111').length;
  for(const name of [bot.instance.profile,'bot-foreign'])assert.throws(()=>f.bots.create('test-111',{...f.input,runtimeProfile:name,idempotencyKey:'nested-'+name}),{code:'BOT_PROFILE_TEMPLATE_UNSUPPORTED'});
  assert.equal(f.repo.listEmployees('test-111').length,before);
});

test('a provisioned validated Bot can take a management task before the next discovery heartbeat',t=>{
  const f=fixture(t),bot=f.bots.create('test-111',{...f.input,sourceProfile:'default'});complete(f,bot);
  const validation=f.bots.validate('test-111',bot.id,{expectedRevision:1,idempotencyKey:'validate-task'}).action;
  f.repo.ackA2AAction(validation.id,{deviceId:'owned-pc'});f.repo.resultA2AAction(validation.id,{status:'succeeded',result:{botValidation:{valid:true,schemaVersion:1,employeeId:bot.id,revision:1}}});
  f.bots.control('test-111',bot.id,{expectedRevision:1,expectedControlEpoch:1,operation:'activate'});
  const task=f.management.createTask('test-111',{title:'First owned task',employeeId:bot.id,execute:true,idempotencyKey:'first-task'});
  const action=f.repo.listA2AActions('test-111',{status:'pending'}).find(item=>item.task_id===task.id);
  assert.equal(action.payload.profile,bot.instance.profile);assert.equal(action.payload.hermesBot.instance.ownershipId,bot.instance.ownershipId);
});
