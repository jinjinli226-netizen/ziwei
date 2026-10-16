import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRepository} from '../backend/repository.mjs';
import {createAuthService} from '../backend/auth.mjs';
import {createManagementService} from '../backend/management.mjs';
import {createZiweiConnect} from '../backend/ziwei-connect.mjs';
import {createPhoneMcpService} from '../backend/phone-mcp.mjs';

const minute=60000,hour=60*minute,epoch=Date.parse('2026-10-16T10:00:00Z');
async function fixture(t,{type='conversation.execute',timeoutMs,expiresIn}={}){
  t.mock.timers.enable({apis:['Date'],now:epoch});
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-phone-budget-'));
  const options={filename:path.join(directory,'fixture.sqlite'),envEncryptionKey:'phone-budget-fixture-only',phoneMcpSecret:'phone-budget-signing-fixture-only'};
  const repo=createRepository(options);t.after(()=>{repo.db.close();fs.rmSync(directory,{recursive:true,force:true});});
  const auth=createAuthService(repo.db),owner=auth.setup({name:'Phone budget fixture',email:'phone-budget@example.test',password:'fixture-password-only'});
  const workspace=auth.createWorkspace(owner.user_id,{name:'Phone budget',slug:'phone-budget',kind:'team'}).workspace;
  const context={actorUserId:owner.user_id,actorRole:'owner',enforceEmployeeVisibility:true,enforceDeviceOwnership:true};
  const paired=repo.claimDevicePairing({code:repo.createDevicePairing(workspace.slug,{createdBy:owner.user_id,name:'Fixture computer'}).code});
  repo.heartbeatDevice(workspace.slug,{deviceId:paired.deviceId,terminalMcp:{configured:true,workspace:workspace.slug,supportedRuntimes:['Hermes']},runtimes:{Hermes:{status:'available',version:'0.22.0',profiles:[{name:'independent-fixture',provider_configured:true,authentication_configured:true}]}}});
  const management=createManagementService(repo);
  const employee=management.createEmployee(workspace.slug,{name:'Phone budget employee',runtime:'Hermes',targetDeviceId:paired.deviceId,runtimeProfile:'independent-fixture',status:'active'},context);
  const skill=repo.listSkills(workspace.slug).find(item=>item.catalog_id==='ziwei-phone-control');repo.setSkillInstalled(skill.id,true);
  const connect=createZiweiConnect(repo,{apiBase:'https://phones.invalid/api',cookie:'fixture_session=synthetic-only'});
  t.mock.method(globalThis,'fetch',async()=>{throw new Error('This fixture forbids network requests');});
  t.mock.method(connect,'listDevices',async()=>[{id:'phone-one',online:true}]);
  let upstreamCalls=0;t.mock.method(connect,'toolCall',async(_slug,scope,name,args)=>{assert.equal(scope.phoneDeviceId,'phone-one');assert.equal(name,'ziwei_phone_status');assert.equal(args.deviceId,'phone-one');upstreamCalls++;return{deviceId:'phone-one',status:'fixture-read-only'};});
  const phone=createPhoneMcpService(repo,connect,management,options);
  const {configuration}=await phone.save(workspace.slug,employee.id,{enabled:true,phoneDeviceId:'phone-one'},context);
  const created=repo.createA2AAction(workspace.slug,{type,...(expiresIn===undefined?{}:{expiresAt:new Date(epoch+expiresIn).toISOString()}),payload:{employeeId:employee.id,deviceId:paired.deviceId,runtime:'Hermes',profile:'independent-fixture',...(timeoutMs===undefined?{}:{timeoutMs}),terminalMcp:{enabled:true,workspace:workspace.slug,deviceId:'phone-one',configurationRevision:configuration.revision}}});
  const action=repo.ackA2AAction(created.id,{deviceId:paired.deviceId});
  const credential=repo.authenticateDeviceToken(paired.deviceToken,{workspaceSlug:workspace.slug});assert.ok(credential);
  const cap=phone.bootstrap(workspace.slug,{employeeId:employee.id,deviceId:'phone-one',actionId:action.id},credential);
  const call=(name='ziwei_phone_status',args={deviceId:'phone-one'},slug=workspace.slug,id=employee.id)=>phone.call(slug,id,cap.token,{name,arguments:args});
  return{repo,phone,workspace,employee,paired,credential,context,action,cap,call,upstreamCalls:()=>upstreamCalls};
}

test('long-running phone capability remains valid after 30 minutes and expires at the 24-hour execution budget',async t=>{
  const f=await fixture(t);assert.equal(Date.parse(f.cap.expiresAt),epoch+24*hour);
  t.mock.timers.tick(31*minute);assert.equal((await f.call()).status,'fixture-read-only');
  t.mock.timers.tick(24*hour-31*minute-1);assert.equal((await f.call()).status,'fixture-read-only');
  t.mock.timers.tick(1);await assert.rejects(f.call(),{code:'PHONE_CAPABILITY_SCOPE',status:403});assert.equal(f.upstreamCalls(),2);
});

test('ordinary executions retain the 30-minute phone cap and action expiry always bounds it',async t=>{
  await t.test('ordinary',async t=>{const f=await fixture(t,{type:'command.execute',expiresIn:2*hour});assert.equal(Date.parse(f.cap.expiresAt),epoch+30*minute);t.mock.timers.tick(30*minute);await assert.rejects(f.call(),{code:'PHONE_CAPABILITY_SCOPE',status:403});assert.equal(f.upstreamCalls(),0);});
  await t.test('short explicit action',async t=>{const f=await fixture(t,{timeoutMs:100});assert.equal(Date.parse(f.cap.expiresAt),Date.parse(f.action.expires_at));assert.equal(Date.parse(f.cap.expiresAt),epoch+16*minute);});
  await t.test('long explicit action',async t=>{const f=await fixture(t,{timeoutMs:2*hour});assert.equal(Date.parse(f.cap.expiresAt),epoch+2*hour);});
});

test('a long phone capability never overrides terminal, credential or configuration revocation',async t=>{
  for(const kind of ['terminal','credential','configuration','expired action','missing action expiry'])await t.test(kind,async t=>{
    const f=await fixture(t);t.mock.timers.tick(31*minute);await f.call();
    if(kind==='terminal')f.repo.resultA2AAction(f.action.id,{deviceId:f.paired.deviceId,status:'succeeded',result:{output:'fixture complete'}});
    else if(kind==='credential')f.repo.revokeDeviceCredential(f.paired.deviceId);
    else if(kind==='configuration')await f.phone.save(f.workspace.slug,f.employee.id,{enabled:false},f.context);
    else f.repo.db.prepare('UPDATE a2a_actions SET expires_at=? WHERE id=?').run(kind==='expired action'?new Date(Date.now()-1).toISOString():null,f.action.id);
    await assert.rejects(f.call(),{code:'PHONE_CAPABILITY_REVOKED',status:403});assert.equal(f.upstreamCalls(),1);
    if(kind.includes('expiry')||kind==='expired action')assert.throws(()=>f.phone.bootstrap(f.workspace.slug,{employeeId:f.employee.id,deviceId:'phone-one',actionId:f.action.id},f.credential),{code:'PHONE_EXECUTION_SCOPE_MISMATCH',status:403});
  });
});

test('long phone capability still rejects another phone, employee and workspace',async t=>{
  const f=await fixture(t);t.mock.timers.tick(31*minute);
  await assert.rejects(f.call('ziwei_phone_status',{deviceId:'other-phone'}),{code:'PHONE_DEVICE_SCOPE',status:403});
  await assert.rejects(f.call('ziwei_phone_status',{deviceId:'phone-one'},f.workspace.slug,'other-employee'),{code:'PHONE_CAPABILITY_SCOPE',status:403});
  await assert.rejects(f.call('ziwei_phone_status',{deviceId:'phone-one'},'other-workspace'),{code:'PHONE_CAPABILITY_SCOPE',status:403});
  assert.equal(f.upstreamCalls(),0);
});
