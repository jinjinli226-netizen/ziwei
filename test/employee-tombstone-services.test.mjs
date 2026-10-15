import test from 'node:test';
import assert from 'node:assert/strict';
import {createRepository} from '../backend/repository.mjs';
import {createAuthService} from '../backend/auth.mjs';
import {createManagementService} from '../backend/management.mjs';
import {createEmployeeTemplateService} from '../backend/employees/templates.mjs';
import {createZiweiConnect} from '../backend/ziwei-connect.mjs';

const templateId='ziwei-employee-creator';
const readyProfile=name=>({name,provider_configured:true,authentication_configured:true,readiness:{ready:true,provider:'configured',authentication:'configured'}});
function fixture(t){
  const repo=createRepository({memory:true});t.after(()=>repo.db.close());
  const auth=createAuthService(repo.db),owner=auth.setup({name:'Tombstone fixture',email:'tombstone@example.test',password:'fixture-password'});
  const workspace=auth.createWorkspace(owner.user_id,{name:'Tombstone team',slug:'tombstone-team',kind:'team'}).workspace;
  const context={actorUserId:owner.user_id,actorRole:'owner',enforceEmployeeVisibility:true};
  const heartbeat=(deviceId,profiles=[readyProfile('default')])=>repo.heartbeatDevice(workspace.slug,{deviceId,ownerUserId:owner.user_id,runtimes:{Hermes:{status:'available',binary:'fixture-hermes',profiles,readiness:{ready:true,provider:'configured',authentication:'configured'}}}});
  heartbeat('tombstone-pc');
  const management=createManagementService(repo),templates=createEmployeeTemplateService(repo,management);
  const deleted=id=>repo.db.prepare("UPDATE employees SET status='deleted' WHERE id=?").run(id);
  return{repo,owner,workspace,context,heartbeat,management,templates,deleted};
}

test('removed template instances disappear from the catalog while provenance blocks implicit reinstall',t=>{
  const f=fixture(t),input={runtime:'Hermes',targetDeviceId:'tombstone-pc',runtimeProfile:'default'};
  const installed=f.templates.install(f.workspace.slug,templateId,input,f.context),provenance=f.repo.getEmployeeTemplateInstance(f.workspace.slug,f.owner.user_id,templateId);
  f.deleted(installed.employee.id);
  const item=f.templates.list(f.workspace.slug,f.context).templates.find(row=>row.id===templateId);
  assert.equal(item.installed,false);assert.equal(item.instance,null);
  const count=f.repo.db.prepare('SELECT COUNT(*) n FROM employees').get().n;
  for(const body of [input,{...input,runtimeProfile:'different',idempotencyKey:'new-intent'}])assert.throws(()=>f.templates.install(f.workspace.slug,templateId,body,f.context),{code:'TEMPLATE_INSTANCE_DELETED',status:409});
  assert.equal(f.repo.db.prepare('SELECT COUNT(*) n FROM employees').get().n,count);
  assert.deepEqual(f.repo.getEmployeeTemplateInstance(f.workspace.slug,f.owner.user_id,templateId),provenance);
  assert.ok(f.repo.db.prepare('SELECT id FROM conversations WHERE id=?').get(installed.conversation.id));
});

test('management cannot revive a removed employee through an original create key or update',t=>{
  const f=fixture(t),body={name:'Original employee',runtime:'Hermes',targetDeviceId:'tombstone-pc',runtimeProfile:'default',idempotencyKey:'original-create'};
  const employee=f.management.createEmployee(f.workspace.slug,body,f.context);f.deleted(employee.id);
  const count=f.repo.db.prepare('SELECT COUNT(*) n FROM employees').get().n;
  assert.throws(()=>f.management.createEmployee(f.workspace.slug,body,f.context),{code:'IDEMPOTENCY_RESOURCE_GONE',status:409});
  assert.throws(()=>f.management.updateEmployee(f.workspace.slug,employee.id,{status:'active'},f.context),{code:'EMPLOYEE_NOT_FOUND',status:404});
  assert.equal(f.repo.db.prepare('SELECT status FROM employees WHERE id=?').get(employee.id).status,'deleted');
  assert.equal(f.repo.db.prepare('SELECT COUNT(*) n FROM employees').get().n,count);
});

test('only a deleted owned Profile on the same computer is reserved against employee and template reuse',t=>{
  const f=fixture(t),bot=f.management.bots.create(f.workspace.slug,{name:'Owned original',sourceProfile:'default',targetDeviceId:'tombstone-pc',idempotencyKey:'owned'},f.context);
  const profile=bot.instance.profile;f.deleted(bot.id);f.heartbeat('tombstone-pc',[readyProfile('default'),readyProfile(profile)]);
  const body={name:'Attempted reuse',runtime:'Hermes',targetDeviceId:'tombstone-pc',runtimeProfile:profile,idempotencyKey:'reuse'};
  assert.throws(()=>f.management.validateSelection(f.workspace.slug,body,{requireProfile:false,context:f.context}),{code:'EMPLOYEE_PROFILE_DELETED',status:409});
  assert.throws(()=>f.management.createEmployee(f.workspace.slug,body,f.context),{code:'EMPLOYEE_PROFILE_DELETED',status:409});
  assert.throws(()=>f.templates.install(f.workspace.slug,templateId,body,f.context),{code:'EMPLOYEE_PROFILE_DELETED',status:409});
  const ordinary=f.management.createEmployee(f.workspace.slug,{...body,runtimeProfile:'default',idempotencyKey:'ordinary'},f.context);
  assert.throws(()=>f.management.updateEmployee(f.workspace.slug,ordinary.id,{runtimeProfile:profile},f.context),{code:'EMPLOYEE_PROFILE_DELETED',status:409});
  f.heartbeat('different-pc',[readyProfile('default'),readyProfile(profile)]);
  assert.equal(f.management.createEmployee(f.workspace.slug,{...body,targetDeviceId:'different-pc',idempotencyKey:'different-computer'},f.context).runtime_profile,profile);
  const legacy=f.management.createEmployee(f.workspace.slug,{name:'Legacy default',runtime:'Hermes',targetDeviceId:'tombstone-pc',runtimeProfile:'default',idempotencyKey:'legacy'},f.context);
  f.management.bots.initialize(f.workspace.slug,legacy.id,{idempotencyKey:'legacy-bot'},f.context);f.deleted(legacy.id);
  assert.equal(f.management.validateSelection(f.workspace.slug,{runtime:'Hermes',targetDeviceId:'tombstone-pc',runtimeProfile:'default'},{context:f.context}).runtimeProfile,'default');
});

test('removed employees cannot bind or start phone operations, while original run receipts remain readable',async t=>{
  const f=fixture(t),employee=f.management.createEmployee(f.workspace.slug,{name:'Phone original',runtime:'Hermes',targetDeviceId:'tombstone-pc',runtimeProfile:'default',idempotencyKey:'phone'},f.context);
  const calls=[];let completed=false;
  t.mock.method(globalThis,'fetch',async(url,options={})=>{
    calls.push({url:String(url),method:options.method||'GET'});
    const path=new URL(url).pathname;
    const data=path.endsWith('/commands')?{command:{id:'original-command',status:'queued'}}:{device:{id:'phone-1',commands:[{id:'original-command',status:completed?'succeeded':'queued'}]}};
    return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
  });
  const connect=createZiweiConnect(f.repo,{apiBase:'https://phones.example.test/api',cookie:'fixture_session=fixture-only'});
  const binding=connect.bindVerified(f.workspace.slug,{employeeId:employee.id,deviceId:'phone-1'},[{id:'phone-1'}]);
  const run=await connect.run(f.workspace.slug,{employeeId:employee.id,action:'health'});assert.equal(run.status,'queued');
  f.deleted(employee.id);const before=calls.length;
  assert.deepEqual(connect.listBindings(f.workspace.slug),[]);
  assert.throws(()=>connect.bindVerified(f.workspace.slug,{employeeId:employee.id,deviceId:'phone-1'},[{id:'phone-1'}]),{status:404,code:'EMPLOYEE_NOT_FOUND'});
  await assert.rejects(connect.bind(f.workspace.slug,{employeeId:employee.id,deviceId:'phone-1'}),{status:404,code:'EMPLOYEE_NOT_FOUND'});
  await assert.rejects(connect.run(f.workspace.slug,{employeeId:employee.id,action:'health'}),{status:404,code:'EMPLOYEE_NOT_FOUND'});
  await assert.rejects(connect.toolCall(f.workspace.slug,{employeeId:employee.id,phoneDeviceId:'phone-1'},'ziwei_phone_control',{role:'agent'}),{status:404,code:'EMPLOYEE_NOT_FOUND'});
  assert.equal(calls.length,before);
  assert.ok(f.repo.db.prepare('SELECT id FROM ziwei_connect_bindings WHERE id=?').get(binding.id));
  completed=true;const refreshed=await connect.refresh(f.workspace.slug,run.id);
  assert.equal(refreshed.status,'succeeded');assert.equal(refreshed.commandId,'original-command');
  assert.equal(calls.length,before+1);assert.equal(calls.at(-1).method,'GET');
});
