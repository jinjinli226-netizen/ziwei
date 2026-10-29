import test from 'node:test';
import assert from 'node:assert/strict';
import {createRepository} from './repository.mjs';
import {createManagementService} from './management.mjs';
import {createRuntimeDiscovery} from '../src/dsh-runtime-discovery.mjs';
import {employeeReadiness} from '../frontend/src/management-mcp.js';

async function fixture(t){
  const repo=createRepository({memory:true});t.after(()=>repo.db.close());
  const discovery=createRuntimeDiscovery({discoverCli:()=>({bridge:{platform:'win32'},discoveredAt:new Date().toISOString(),runtimes:{}}),fetchImpl:async()=>({ok:true,json:async()=>({root:'PRIVATE_HOME',serverCmd:'PRIVATE_EXECUTABLE',bots:[{name:'alpha',running:true,ready:true,url:'http://private/?token=PRIVATE_TOKEN',logTail:'PRIVATE_LOG'},{name:'sleeping',running:false,ready:false}]})})});
  const runtime=await discovery();
  repo.heartbeatDevice('test-111',{deviceId:'dsh-pc',workdir:process.cwd(),runtimes:runtime.runtimes});
  return{repo,service:createManagementService(repo)};
}

test('native DSH discovery passes the actual web readiness and management creation gates',async t=>{
  const {repo,service}=await fixture(t),discovery=service.discovery('test-111');
  assert.equal(employeeReadiness(discovery,{deviceId:'dsh-pc',runtime:'DSH',profile:'alpha'}).ready,true);
  assert.doesNotMatch(JSON.stringify(discovery),/PRIVATE_HOME|PRIVATE_EXECUTABLE|PRIVATE_TOKEN|PRIVATE_LOG/);
  const employee=service.createEmployee('test-111',{name:'Web DSH',runtime:'DSH',targetDeviceId:'dsh-pc',runtimeProfile:'alpha',idempotencyKey:'create-alpha'});
  assert.equal(employee.runtime,'DSH');assert.equal(employee.runtime_profile,'alpha');assert.equal(employee.model_id,null);
  const conversation=repo.createConversation('test-111',{employeeId:employee.id}),message=repo.addConversationMessage(conversation.id,{content:'hello'});
  assert.equal(message.execution.payload.profile,'alpha');assert.equal(message.execution.payload.runtime,'DSH');
});

test('DSH requires a real ready native Bot and never treats a display alias as its binding',async t=>{
  const {service}=await fixture(t),discovery=service.discovery('test-111');
  for(const [profile,code] of [['','PROFILE_REQUIRED'],['alias','PROFILE_NOT_FOUND'],['sleeping','PROFILE_NOT_READY']]){
    assert.equal(employeeReadiness(discovery,{deviceId:'dsh-pc',runtime:'DSH',profile}).ready,false);
    assert.throws(()=>service.createEmployee('test-111',{name:'alias',runtime:'DSH',targetDeviceId:'dsh-pc',runtimeProfile:profile,idempotencyKey:'bad-'+(profile||'empty')}),{code});
  }
});

test('DSH selection rejects another device, unknown model overrides and disconnected Hub evidence',async t=>{
  const {repo,service}=await fixture(t),body={name:'Web DSH',runtime:'DSH',targetDeviceId:'dsh-pc',runtimeProfile:'alpha'};
  assert.throws(()=>service.createEmployee('test-111',{...body,targetDeviceId:'another-device'}),{code:'DEVICE_NOT_IN_WORKSPACE'});
  assert.throws(()=>service.createEmployee('test-111',{...body,targetDeviceId:undefined}),{code:'DEVICE_REQUIRED'});
  assert.throws(()=>service.createEmployee('test-111',{...body,model:'unapplied-model'}),{code:'DSH_NATIVE_MODEL_REQUIRED'});
  repo.heartbeatDevice('test-111',{deviceId:'dsh-pc',runtimes:{DSH:{status:'unavailable',profiles:[],readiness:{ready:false}}}});
  assert.equal(employeeReadiness(service.discovery('test-111'),{deviceId:'dsh-pc',runtime:'DSH',profile:'alpha'}).ready,false);
  assert.throws(()=>service.createEmployee('test-111',body),{code:'CLI_UNAVAILABLE'});
});

test('DSH employee updates cannot bypass native model policy or clear the explicit bound computer',async t=>{
  const {repo,service}=await fixture(t),employee=service.createEmployee('test-111',{name:'DSH',runtime:'DSH',targetDeviceId:'dsh-pc',runtimeProfile:'alpha'});
  for(const key of ['model','modelId','model_id'])assert.throws(()=>service.updateEmployee('test-111',employee.id,{[key]:'not-applied-model'}),{code:'DSH_NATIVE_MODEL_REQUIRED'});
  assert.throws(()=>service.updateEmployee('test-111',employee.id,{targetDeviceId:null}),{code:'DEVICE_REQUIRED'});
  const saved=repo.listEmployees('test-111').find(row=>row.id===employee.id);assert.equal(saved.model_id,null);assert.equal(saved.target_device_id,'dsh-pc');
});
