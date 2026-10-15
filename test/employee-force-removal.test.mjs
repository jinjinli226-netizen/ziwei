import test from 'node:test';
import assert from 'node:assert/strict';
import {createRepository} from '../backend/repository.mjs';
import {createManagementService} from '../backend/management.mjs';
import {createApp} from '../backend/app.mjs';
import {BOT_INTERNAL} from '../backend/bots.mjs';
import {completeOwnedProfile} from '../test-support/owned-profile.mjs';

const slug='test-111',deviceId='force-removal-pc';
const exitProof={platform:'win32',supervisor:'windows-job',launched:true,rootPid:5678,rootConfirmed:true,rootExitCode:null,treeConfirmed:true,activeProcesses:0,cancelled:true};
function fixture(t,{validationOnly=false,repository=null}={}){
 const repo=repository||createRepository({memory:true}),management=createManagementService(repo),bots=management.bots;
 if(!repository)t.after(()=>repo.db.close());
 repo.heartbeatDevice(slug,{deviceId,runtimes:{Hermes:{status:'available',version:'0.21.3',profiles:[{name:'default'}]}}});
 const input={name:'Hermes removal fixture',sourceProfile:'default',targetDeviceId:deviceId,model:'gpt-6.1-sol',idempotencyKey:'force-removal-create'};
 let bot=bots.create(slug,input);completeOwnedProfile(repo,bot);
 const validation=bots.validate(slug,bot.id,{expectedRevision:1,idempotencyKey:'force-removal-validation'}).action;
 repo.ackA2AAction(validation.id,{deviceId});
 const validationResult={botValidation:{valid:true,schemaVersion:1,employeeId:bot.id,revision:1}};
 if(validationOnly)return {repo,management,bots,bot,input,action:validation,validationResult};
 repo.resultA2AAction(validation.id,{deviceId,status:'succeeded',result:validationResult});
 bot=bots.control(slug,bot.id,{expectedRevision:1,expectedControlEpoch:1,operation:'activate'});
 const routine=bots.createRoutine(slug,bot.id,{name:'Retained scheduled work',prompt:'Keep history',schedule:'每天 09:00',timezone:'Asia/Shanghai',idempotencyKey:'force-removal-routine'});
 repo.addConversationMessage(bot.main_conversation_id,{role:'assistant',content:'Retained original memory',dispatch:false});
 const message=repo.addConversationMessage(bot.main_conversation_id,{content:'Original in-flight work'}),action=repo.getA2AAction(message.execution.id);
 repo.ackA2AAction(action.id,{deviceId});
 return {repo,management,bots,bot,input,action,routine,validationResult};
}
const row=f=>f.repo.db.prepare('SELECT * FROM employees WHERE id=?').get(f.bot.id);
const botRow=f=>f.repo.db.prepare('SELECT * FROM hermes_bots WHERE employee_id=?').get(f.bot.id);
const expire=f=>f.repo.db.prepare("UPDATE a2a_actions SET status='expired',completed_at=?,expires_at=? WHERE id=?").run('2026-01-01T00:16:00.000Z','2026-01-01T00:15:00.000Z',f.action.id);

test('force removal hides the employee and Bot while retaining the original execution, profile, HOME and history',t=>{
 const f=fixture(t),beforeBot=botRow(f),beforeAction=f.repo.getA2AAction(f.action.id);
 const provision=f.repo.getA2AAction(beforeBot.provision_action_id),beforeProvision=JSON.stringify(provision);
 const messages=f.repo.db.prepare('SELECT * FROM conversation_messages WHERE conversation_id=? ORDER BY rowid').all(f.bot.main_conversation_id);
 const removed=f.repo.deleteEmployee(f.bot.id,{force:true});
 assert.equal(removed.id,f.bot.id);assert.equal(removed.deleted,true);assert.equal(removed.forced,true);assert.equal(removed.executionConfirmedStopped,false);assert.notEqual(removed.stopConfirmed,true);
 assert.deepEqual(removed.retained,{executionRecords:true,profile:true,home:true});
 assert.equal(row(f).status,'deleted');assert.equal(f.repo.getEmployee(f.bot.id),null);
 assert.equal(f.repo.listEmployees(slug).some(employee=>employee.id===f.bot.id),false);
 assert.equal(f.bots.list(slug).some(bot=>bot.id===f.bot.id),false);
 assert.throws(()=>f.bots.get(slug,f.bot.id));assert.throws(()=>f.management.employee(slug,f.bot.id));
 const saved=botRow(f);
 assert.equal(saved.control_state,'paused');assert.equal(saved.control_epoch,beforeBot.control_epoch+1);
 assert.equal(saved.active_action_id,f.action.id);assert.equal(saved.profile_binding_json,beforeBot.profile_binding_json);
 assert.equal(JSON.stringify(f.repo.getA2AAction(beforeBot.provision_action_id)),beforeProvision);
 assert.ok(provision.result.botProvision.home);assert.ok(provision.result.botProvision.profileHome);
 assert.equal(f.repo.getA2AAction(f.action.id).status,'acked');assert.deepEqual(f.repo.getA2AAction(f.action.id).result,beforeAction.result);
 assert.deepEqual(f.repo.db.prepare('SELECT * FROM conversation_messages WHERE conversation_id=? ORDER BY rowid').all(f.bot.main_conversation_id),messages);
 assert.equal(f.repo.db.prepare('SELECT employee_id FROM conversations WHERE id=?').get(f.bot.main_conversation_id).employee_id,f.bot.id);
 const automation=f.repo.getAutomationById(f.routine.id);
 assert.equal(automation.status,'paused');assert.equal(automation.next_run,null);
 assert.equal(f.repo.db.prepare('SELECT employee_id FROM bot_routines WHERE automation_id=?').get(f.routine.id).employee_id,f.bot.id);
});

test('a removed employee cannot be revived, reinitialized, validated or started through direct and management routes',t=>{
 const f=fixture(t);f.repo.deleteEmployee(f.bot.id,{force:true});
 const count=f.repo.db.prepare('SELECT COUNT(*) n FROM a2a_actions').get().n;
 for(const operation of [
  ()=>f.repo.updateEmployee(f.bot.id,{name:'Revived',status:'active'},{botConfigurationWrite:true}),
  ()=>f.management.updateEmployee(slug,f.bot.id,{status:'active',expectedRevision:1,expectedControlEpoch:botRow(f).control_epoch}),
  ()=>f.bots.update(slug,f.bot.id,{expectedRevision:1,employee:{name:'Revived'}}),
  ()=>f.bots.initialize(slug,f.bot.id,{idempotencyKey:'revive-initialize'}),
  ()=>f.bots.validate(slug,f.bot.id,{expectedRevision:1,idempotencyKey:'revive-validation'}),
  ()=>f.bots.control(slug,f.bot.id,{expectedRevision:1,expectedControlEpoch:botRow(f).control_epoch,operation:'activate'}),
  ()=>f.repo.authorizeBotStart(f.action.id,{deviceId}),
  ()=>f.repo.addConversationMessage(f.bot.main_conversation_id,{content:'New work'}),
  ()=>f.repo.createConversation(slug,{employeeId:f.bot.id}),
  ()=>f.repo.runAutomation(f.routine.id),
 ])assert.throws(operation);
 for(const type of ['runtime.execute','conversation.execute','hermes.bot.validate','hermes.bot.provision','directory.inspect']){
  assert.throws(()=>f.repo.createA2AAction(slug,{type,botInternal:BOT_INTERNAL,dedupeKey:`removed:${type}`,payload:{employeeId:f.bot.id,conversationId:f.bot.main_conversation_id,deviceId,prompt:'Must not execute'}}));
 }
 for(const payload of [{runtime:'Hermes',profile:f.bot.instance.profile,deviceId},{runtime:'Hermes',runtimeProfile:f.bot.instance.profile,targetDeviceId:deviceId}])assert.throws(()=>f.repo.createA2AAction(slug,{type:'runtime.execute',payload:{...payload,prompt:'Must not reuse the retired owned profile'}}),{code:'EMPLOYEE_PROFILE_DELETED'});
 assert.throws(()=>f.management.createEmployee(slug,{name:'Rebound profile',runtime:'Hermes',runtimeProfile:f.bot.instance.profile,targetDeviceId:deviceId,idempotencyKey:'reuse-retired-profile'}),{code:'EMPLOYEE_PROFILE_DELETED'});
 assert.throws(()=>f.bots.create(slug,f.input),{code:'IDEMPOTENCY_RESOURCE_GONE'});
 assert.equal(row(f).status,'deleted');assert.equal(botRow(f).control_state,'paused');
 assert.equal(f.repo.db.prepare('SELECT COUNT(*) n FROM a2a_actions').get().n,count);
});

test('force removal preserves expired occupancy until the original device supplies its real late terminal result',t=>{
 const f=fixture(t);expire(f);f.repo.deleteEmployee(f.bot.id,{force:true});
 const before=botRow(f),count=f.repo.db.prepare('SELECT COUNT(*) n FROM a2a_actions').get().n;
 assert.equal(before.active_action_id,f.action.id);assert.equal(f.repo.getA2AAction(f.action.id).status,'expired');
 assert.throws(()=>f.repo.resultA2AAction(f.action.id,{deviceId,status:'failed',error:'Claim without proof',result:{stopConfirmed:true}}));
 assert.equal(botRow(f).active_action_id,f.action.id);
 const settled=f.repo.resultA2AAction(f.action.id,{deviceId,status:'failed',error:'Original process tree exited',result:{processExit:exitProof,partialEffectsPossible:true}});
 assert.equal(settled.id,f.action.id);assert.equal(settled.status,'failed');assert.equal(settled.result.stopConfirmed,true);
 assert.equal(botRow(f).active_action_id,null);assert.equal(botRow(f).control_state,'paused');
 assert.equal(botRow(f).control_epoch,before.control_epoch);assert.equal(row(f).status,'deleted');
 assert.equal(f.repo.getEmployee(f.bot.id),null);assert.equal(f.bots.list(slug).some(bot=>bot.id===f.bot.id),false);
 assert.equal(f.repo.db.prepare('SELECT COUNT(*) n FROM a2a_actions').get().n,count);
 assert.ok(f.repo.getA2AAction(f.action.id).events.some(event=>event.type==='action.reconciled'));
});

test('an original validation receipt can settle after force removal without validating or reviving the tombstone',t=>{
 const f=fixture(t,{validationOnly:true});f.repo.deleteEmployee(f.bot.id,{force:true});
 const before=botRow(f),settled=f.repo.resultA2AAction(f.action.id,{deviceId,status:'succeeded',result:f.validationResult});
 assert.equal(settled.status,'succeeded');assert.equal(botRow(f).active_action_id,null);
 assert.equal(botRow(f).validated_revision,before.validated_revision);assert.equal(botRow(f).control_epoch,before.control_epoch);
 assert.equal(botRow(f).control_state,'paused');assert.equal(row(f).status,'deleted');assert.equal(f.repo.getEmployee(f.bot.id),null);
});

test('ordinary deletion still refuses busy Bot executions and a nonboolean force cannot bypass the guard',t=>{
 for(const state of ['acked','expired','uncertain']){
  const f=fixture(t);
  if(state==='expired')expire(f);
  if(state==='uncertain')f.repo.resultA2AAction(f.action.id,{deviceId,status:'failed',error:'Stop unconfirmed',result:{code:'EXECUTION_UNCERTAIN',executionState:'uncertain'}});
  const before=botRow(f);
  for(const input of [undefined,{force:false},{force:'true'},{force:1}])assert.throws(()=>f.repo.deleteEmployee(f.bot.id,input),{code:'BOT_BUSY'});
  assert.equal(row(f).status,'active');assert.equal(botRow(f).active_action_id,f.action.id);assert.equal(botRow(f).control_epoch,before.control_epoch);
 }
});

test('repeated force and ordinary deletion leave the same tombstone and all retained records intact',t=>{
 const f=fixture(t);f.repo.deleteEmployee(f.bot.id,{force:true});
 const before=botRow(f),messages=f.repo.db.prepare('SELECT COUNT(*) n FROM conversation_messages WHERE conversation_id=?').get(f.bot.main_conversation_id).n;
 const actions=f.repo.db.prepare('SELECT COUNT(*) n FROM a2a_actions').get().n;
 assert.equal(f.repo.deleteEmployee(f.bot.id,{force:true}).deleted,true);
 assert.equal(f.repo.deleteEmployee(f.bot.id).deleted,true);
 assert.equal(row(f).status,'deleted');assert.deepEqual(botRow(f),before);
 assert.equal(f.repo.db.prepare('SELECT COUNT(*) n FROM conversation_messages WHERE conversation_id=?').get(f.bot.main_conversation_id).n,messages);
 assert.equal(f.repo.db.prepare('SELECT COUNT(*) n FROM a2a_actions').get().n,actions);
 assert.equal(f.repo.db.prepare('SELECT employee_id FROM bot_routines WHERE automation_id=?').get(f.routine.id).employee_id,f.bot.id);
});

test('DELETE employee endpoints forward only an explicit boolean force from JSON without a listener',t=>{
 const app=createApp({memory:true});t.after(()=>app.locals.repo.db.close());
 const employee=app.locals.repo.createEmployee(slug,{name:'DELETE forwarding fixture'});
 const calls=[];app.locals.repo.deleteEmployee=(employeeId,options)=>{calls.push({employeeId,options});return {id:employeeId,deleted:true};};
 for(const routePath of ['/api/employees/:id','/api/workspaces/:slug/employees/:id']){
  const layer=app.router.stack.find(layer=>layer.route?.path===routePath&&layer.route.methods.delete);
  assert.ok(layer);const handler=layer.route.stack.at(-1).handle;
  for(const body of [{force:true},{force:'true'},{}]){
   let response;
   handler({params:{slug,id:employee.id},body,app},{json:value=>{response=value;}});
   assert.equal(response.deleted,true);assert.equal(calls.at(-1).employeeId,employee.id);
   assert.equal(calls.at(-1).options?.force===true,body.force===true);
  }
 }
});

test('DELETE handlers keep string force busy, reject foreign workspace and accept repeated boolean force removal',t=>{
 for(const routePath of ['/api/employees/:id','/api/workspaces/:slug/employees/:id']){
  const app=createApp({memory:true});t.after(()=>app.locals.repo.db.close());
  const f=fixture(t,{repository:app.locals.repo}),handler=app.router.stack.find(layer=>layer.route?.path===routePath&&layer.route.methods.delete).route.stack.at(-1).handle;
  const req={params:{id:f.bot.id,...(routePath.includes(':slug')?{slug}: {})},body:{force:'true'},app};
  let response;const res={json:value=>{response=value;}};
  assert.throws(()=>handler(req,res),{code:'BOT_BUSY'});assert.equal(row(f).status,'active');
  if(routePath.includes(':slug')){
   assert.throws(()=>handler({...req,params:{...req.params,slug:'foreign-workspace'},body:{force:true}},res),{status:404});
   assert.equal(row(f).status,'active');
  }
  req.body={force:true};handler(req,res);
  assert.equal(response.forced,true);assert.equal(response.executionConfirmedStopped,false);assert.equal(row(f).status,'deleted');
  const epoch=botRow(f).control_epoch;handler(req,res);
  assert.equal(row(f).status,'deleted');assert.equal(botRow(f).control_epoch,epoch);assert.equal(botRow(f).active_action_id,f.action.id);
 }
});

test('purge requires both exact boolean flags while ordinary force remains a soft tombstone',t=>{
 for(const input of [{purge:true},{force:'true',purge:true},{force:1,purge:true},{force:false,purge:true}]){
  const f=fixture(t);assert.throws(()=>f.repo.deleteEmployee(f.bot.id,input),{code:'BOT_BUSY'});assert.equal(row(f).status,'active');assert.ok(botRow(f));
 }
 for(const input of [{force:true},{force:true,purge:false},{force:true,purge:'true'},{force:true,purge:1}]){
  const f=fixture(t),before=botRow(f),result=f.repo.deleteEmployee(f.bot.id,input);
  assert.equal(result.forced,true);assert.notEqual(result.purged,true);assert.deepEqual(result.retained,{executionRecords:true,profile:true,home:true});
  assert.equal(row(f).status,'deleted');assert.equal(botRow(f).profile_binding_json,before.profile_binding_json);assert.equal(botRow(f).active_action_id,f.action.id);
 }
});

test('explicit purge removes server configuration, pauses routines and retains original action evidence without claiming native cleanup',t=>{
 for(const softFirst of [false,true]){
 const f=fixture(t);
 f.repo.upsertEmployeeEnvironment(f.bot.id,{key:'PURGE_FIXTURE_TOKEN',value:'fixture-only-secret',sensitive:true});
 f.repo.replaceEmployeeCustomParams(f.bot.id,{values:{fixture:'remove-server-config'}});
 // This original server-created Bot action has not yet been claimed by the device.
 f.repo.db.prepare("UPDATE a2a_actions SET status='pending',acked_at=NULL WHERE id=?").run(f.action.id);
 const beforeActions=f.repo.db.prepare('SELECT * FROM a2a_actions ORDER BY rowid').all(),beforeEvents=f.repo.db.prepare('SELECT * FROM a2a_action_events ORDER BY rowid').all();
 assert.equal(f.repo.db.prepare('SELECT COUNT(*) n FROM employee_environment_variables WHERE employee_id=?').get(f.bot.id).n,1);
 if(softFirst){f.repo.deleteEmployee(f.bot.id,{force:true});assert.equal(row(f).status,'deleted');}
 const result=f.repo.deleteEmployee(f.bot.id,{force:true,purge:true});
 assert.equal(result.deleted,true);assert.equal(result.forced,true);assert.equal(result.purged,true);assert.equal(result.executionConfirmedStopped,false);assert.equal(result.nativeCleanupConfirmed,false);assert.notEqual(result.stopConfirmed,true);
 assert.equal(row(f),undefined);assert.equal(botRow(f),undefined);
 for(const table of ['employee_environment_variables','employee_custom_params','bot_routines'])assert.equal(f.repo.db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE employee_id=?`).get(f.bot.id).n,0);
 const routine=f.repo.getAutomationById(f.routine.id);assert.equal(routine.status,'paused');assert.equal(routine.next_run,null);assert.equal(routine.executor,'ziwei_bot');
 assert.deepEqual(f.repo.db.prepare('SELECT * FROM a2a_actions ORDER BY rowid').all(),beforeActions);assert.deepEqual(f.repo.db.prepare('SELECT * FROM a2a_action_events ORDER BY rowid').all(),beforeEvents);
 assert.throws(()=>f.repo.ackA2AAction(f.action.id,{deviceId}),{code:'BOT_NOT_FOUND'});assert.equal(f.repo.getA2AAction(f.action.id).status,'pending');
 assert.throws(()=>f.repo.runAutomation(f.routine.id));assert.throws(()=>f.repo.createA2AAction(slug,{type:'runtime.execute',payload:f.action.payload}),{code:'BOT_NOT_FOUND'});
 assert.equal(f.repo.db.prepare('SELECT COUNT(*) n FROM a2a_actions').get().n,beforeActions.length);
 }
});

test('DELETE endpoints forward purge only for a strict boolean force and purge pair without a listener',t=>{
 const app=createApp({memory:true});t.after(()=>app.locals.repo.db.close());const employee=app.locals.repo.createEmployee(slug,{name:'Purge forwarding fixture'}),calls=[];
 app.locals.repo.deleteEmployee=(employeeId,options)=>{calls.push({employeeId,options});return {id:employeeId,deleted:true};};
 for(const path of ['/api/employees/:id','/api/workspaces/:slug/employees/:id']){
  const handler=app.router.stack.find(layer=>layer.route?.path===path&&layer.route.methods.delete).route.stack.at(-1).handle;
  for(const body of [{force:true,purge:true},{force:true,purge:'true'},{force:true,purge:1},{force:'true',purge:true},{purge:true},{}]){
   handler({params:{id:employee.id,...(path.includes(':slug')?{slug}:{})},body,app},{json:()=>{}});
   assert.equal(calls.at(-1).employeeId,employee.id);assert.deepEqual(calls.at(-1).options,{force:body.force===true,...(body.force===true&&body.purge===true?{purge:true}:{})});
  }
 }
});

test('retired owned profiles reject executor aliases and are checked again when an unbound action claims its device',t=>{
 const f=fixture(t),profile=f.bot.instance.profile;f.repo.deleteEmployee(f.bot.id,{force:true});
 for(const runtime of [{runtime:'hermes'},{runtime:' HERMES '},{agent:'Hermes'},{runtimeName:'Hermes'}]){
  for(const key of ['profile','runtimeProfile','runtime_profile','hermesProfile','hermes_profile']){
   assert.throws(()=>f.repo.createA2AAction(slug,{type:'runtime.execute',payload:{...runtime,deviceId,[key]:profile,prompt:'must not execute'}}),{code:'EMPLOYEE_PROFILE_DELETED'});
  }
 }
 for(const key of ['profile','runtimeProfile','runtime_profile','hermesProfile','hermes_profile']){
  const action=f.repo.createA2AAction(slug,{type:'runtime.execute',payload:{runtime:'Hermes',[key]:profile,prompt:'must not execute'}});
  assert.throws(()=>f.repo.ackA2AAction(action.id,{deviceId}),{code:'EMPLOYEE_PROFILE_DELETED'});
  assert.equal(f.repo.getA2AAction(action.id).status,'pending');
 }
});
