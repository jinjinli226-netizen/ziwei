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
import {createApp} from '../backend/app.mjs';
import {completeOwnedProfile} from '../test-support/owned-profile.mjs';

const readyProfile=name=>({name,provider_configured:true,authentication_configured:true,readiness:{ready:true,authentication:'configured',provider:'configured'}});
function fixture(t,{withApp=false}={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-phone-bot-identity-'));
  const options={filename:path.join(directory,'fixture.sqlite'),envEncryptionKey:'phone-bot-fixture-env-only',phoneMcpSecret:'phone-bot-fixture-signing-only',managementMcpSecret:'phone-bot-fixture-management-only',enableScheduler:false,requireAuth:true,mcpOptions:{token:'phone-bot-fixture-static-only',workspaces:['phone-bot-identity']},ziweiConnectApiBase:'https://phones.invalid/api',ziweiConnectCookie:'fixture_session=synthetic-only'};
  const repo=createRepository(options);
  t.after(()=>{repo.db.close();fs.rmSync(directory,{recursive:true,force:true});});
  const auth=createAuthService(repo.db),owner=auth.setup({name:'Phone Bot fixture',email:'phone-bot@example.test',password:'fixture-password-only'});
  const workspace=auth.createWorkspace(owner.user_id,{name:'Phone Bot identity',slug:'phone-bot-identity',kind:'team'}).workspace;
  const otherWorkspace=auth.createWorkspace(owner.user_id,{name:'Other identity workspace',slug:'phone-bot-other',kind:'team'}).workspace;
  const context={actorUserId:owner.user_id,actorRole:'owner',enforceEmployeeVisibility:true,enforceDeviceOwnership:true};
  const heartbeat=(deviceId,profiles)=>repo.heartbeatDevice(workspace.slug,{deviceId,ownerUserId:owner.user_id,terminalMcp:{configured:true,workspace:workspace.slug,supportedRuntimes:['Hermes']},runtimes:{Hermes:{status:'available',version:'0.21.3',profiles:profiles.map(readyProfile),readiness:{ready:true,authentication:'configured',provider:'configured'}}}});
  heartbeat('identity-pc',['default']);
  const management=createManagementService(repo);
  let bot=management.bots.create(workspace.slug,{name:'Existing owned Hermes Bot',sourceProfile:'default',targetDeviceId:'identity-pc',idempotencyKey:'existing-owned-bot'},context);
  completeOwnedProfile(repo,bot);heartbeat('identity-pc',['default',bot.instance.profile]);heartbeat('other-pc',['default']);bot=management.bots.get(workspace.slug,bot.id,context);
  const skill=repo.listSkills(workspace.slug).find(item=>item.catalog_id==='ziwei-phone-control');assert.ok(skill);repo.setSkillInstalled(skill.id,true);
  const app=withApp?createApp({...options,repository:repo}):null;
  const connect=app?.locals.ziweiConnect||createZiweiConnect(repo,{apiBase:options.ziweiConnectApiBase,cookie:options.ziweiConnectCookie});
  let deviceReads=0;connect.listDevices=async()=>{deviceReads++;return[{id:'phone-one',online:true},{id:'phone-two',online:true}];};
  const phone=app?.locals.phoneMcp||createPhoneMcpService(repo,connect,management,options);
  // Any accidental upstream request fails locally; no listener or network is needed.
  t.mock.method(globalThis,'fetch',async()=>{throw new Error('unexpected network request in identity fixture');});
  const body={enabled:true,phoneDeviceId:'phone-one'};
  const snapshot=()=>Object.fromEntries(['employees','hermes_bots','employee_phone_mcp','ziwei_connect_bindings','a2a_actions','conversations','conversation_messages','management_requests'].map(table=>[table,repo.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  return{repo,app,phone,connect,management,owner,workspace,otherWorkspace,context,bot,skill,body,snapshot,deviceReads:()=>deviceReads};
}

test('a file-backed existing owned Hermes Bot saves phone MCP with the real authenticated actor',async t=>{
  const f=fixture(t),before=f.bot;
  assert.notEqual(f.repo.db.prepare('PRAGMA database_list').all().find(item=>item.name==='main').file,'');
  const saved=await f.phone.save(f.workspace.slug,f.bot.id,f.body,f.context);
  assert.equal(saved.configuration.enabled,true);assert.equal(saved.configuration.saved,true);assert.equal(saved.configuration.phone_device_id,'phone-one');
  assert.equal(saved.configuration.target_device_id,'identity-pc');assert.equal(saved.configuration.runtime_profile,before.instance.profile);
  const employee=f.management.employee(f.workspace.slug,f.bot.id,f.context);assert.ok(employee.skills.includes(f.skill.id));
  const bot=f.management.bots.get(f.workspace.slug,f.bot.id,f.context);assert.equal(bot.revision,before.revision+1);assert.equal(bot.control_state,'draft');assert.equal(bot.instance.profile,before.instance.profile);
  assert.equal(f.connect.listBindings(f.workspace.slug).find(item=>item.employeeId===f.bot.id).deviceId,'phone-one');assert.equal(f.deviceReads(),1);
});

async function prepareCheck(f){
  await f.phone.save(f.workspace.slug,f.bot.id,f.body,f.context);
  let bot=f.management.bots.get(f.workspace.slug,f.bot.id,f.context);
  const {action}=f.management.bots.validate(f.workspace.slug,bot.id,{expectedRevision:bot.revision,idempotencyKey:'phone-check-current-validation'},f.context);
  f.repo.ackA2AAction(action.id,{deviceId:'identity-pc'});
  f.repo.resultA2AAction(action.id,{deviceId:'identity-pc',status:'succeeded',result:{botValidation:{schemaVersion:1,valid:true,employeeId:bot.id,revision:bot.revision,sourceProfile:'default',nativeVersion:'0.21.3'}}});
  bot=f.management.bots.control(f.workspace.slug,bot.id,{expectedRevision:bot.revision,expectedControlEpoch:bot.control_epoch,operation:'activate'},f.context);
  assert.equal(bot.control_state,'active');return bot;
}
function addMember(f){
  const userId='phone-check-member';
  f.repo.db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run('phone-check-member-row',f.workspace.id,userId,'Check member','check-member@example.test','member',new Date().toISOString());
  return{actorUserId:userId,actorRole:'member',enforceEmployeeVisibility:true,enforceDeviceOwnership:true};
}

test('phone check dispatch preserves the actual authenticated user and scoped member device contexts',async t=>{
  for(const kind of ['user','device'])await t.test(kind,async t=>{
    const f=fixture(t),bot=await prepareCheck(f);
    const context=kind==='user'?f.context:{...addMember(f),authenticatedMcp:true,deviceScope:'identity-pc',deviceCredentialDeviceId:'identity-pc'};
    const create=f.management.createConversation,message=f.repo.addConversationMessage,calls=[];
    t.mock.method(f.management,'createConversation',(...args)=>{calls.push({kind:'conversation',context:args[2]});return create(...args);});
    t.mock.method(f.repo,'addConversationMessage',(...args)=>{calls.push({kind:'message',context:args[1]});return message.call(f.repo,...args);});
    const checked=f.phone.trial(f.workspace.slug,bot.id,{idempotencyKey:'context-check'},true,context);
    assert.equal(checked.action.status,'pending');assert.equal(checked.action.type,'conversation.execute');
    assert.equal(checked.action.payload.employeeId,bot.id);assert.equal(checked.action.payload.deviceId,'identity-pc');assert.equal(checked.action.payload.profile,bot.instance.profile);
    assert.equal(checked.action.payload.terminalMcp.checkOnly,true);assert.equal(checked.action.payload.terminalMcp.deviceId,'phone-one');assert.match(checked.action.payload.prompt,/只读取状态/);
    assert.equal(calls.length,2);
    for(const call of calls){assert.equal(call.context.actorUserId,context.actorUserId);assert.equal(call.context.actorRole,context.actorRole);}
    assert.equal(calls[1].context.enforceDeviceOwnership,kind==='user');
    assert.equal(f.repo.getConversation(checked.conversation_id,context).employee_id,bot.id);
    const before=f.snapshot(),duplicate=f.phone.trial(f.workspace.slug,bot.id,{idempotencyKey:'context-check'},true,context);
    assert.equal(duplicate.action.id,checked.action.id);assert.equal(duplicate.duplicate,true);assert.deepEqual(f.snapshot(),before);
  });
});

test('phone check rejects a member outside employee visibility and signed device or workspace scope before dispatch',async t=>{
  const f=fixture(t),bot=await prepareCheck(f),member=addMember(f);
  // The prior hardcoded owner role bypassed this member visibility boundary.
  f.management.updateEmployee(f.workspace.slug,bot.id,{visibility:'personal'},f.context);
  let before=f.snapshot();
  assert.throws(()=>f.phone.trial(f.workspace.slug,bot.id,{idempotencyKey:'private-member-check'},true,member),{code:'EMPLOYEE_NOT_FOUND',status:404});assert.deepEqual(f.snapshot(),before);
  const device={...f.context,authenticatedMcp:true,deviceScope:'other-pc',deviceCredentialDeviceId:'other-pc'};
  assert.throws(()=>f.phone.trial(f.workspace.slug,bot.id,{idempotencyKey:'other-device-check'},true,device),{code:'PHONE_DEVICE_SCOPE',status:403});assert.deepEqual(f.snapshot(),before);
  assert.throws(()=>f.phone.trial(f.otherWorkspace.slug,bot.id,{idempotencyKey:'other-workspace-check'},true,f.context),{code:'EMPLOYEE_NOT_FOUND',status:404});assert.deepEqual(f.snapshot(),before);
});

test('anonymous file-backed Bot save rejects without a partial phone binding, skill or configuration write',async t=>{
  const f=fixture(t),before=f.snapshot();
  await assert.rejects(f.phone.save(f.workspace.slug,f.bot.id,f.body),{code:'BOT_ACTOR_REQUIRED',status:403});
  assert.deepEqual(f.snapshot(),before);
  await f.phone.save(f.workspace.slug,f.bot.id,f.body,f.context);const configured=f.snapshot();
  await assert.rejects(f.phone.save(f.workspace.slug,f.bot.id,{enabled:true,phoneDeviceId:'phone-two'}),{code:'BOT_ACTOR_REQUIRED',status:403});
  assert.deepEqual(f.snapshot(),configured);
});

test('scoped device identities can save only their own Bot, not another device or workspace',async t=>{
  const f=fixture(t),before=f.snapshot(),mcp={...f.context,authenticatedMcp:true,deviceScope:'identity-pc',deviceCredentialDeviceId:'identity-pc'};
  for(const context of [{...mcp,deviceScope:'other-pc',deviceCredentialDeviceId:'other-pc'},{...mcp,deviceCredentialDeviceId:'other-pc'}]){
    await assert.rejects(f.phone.save(f.workspace.slug,f.bot.id,f.body,context),{code:'PHONE_DEVICE_SCOPE',status:403});assert.deepEqual(f.snapshot(),before);
  }
  await assert.rejects(f.phone.save(f.otherWorkspace.slug,f.bot.id,f.body,mcp),{code:'EMPLOYEE_NOT_FOUND',status:404});assert.deepEqual(f.snapshot(),before);
  const saved=await f.phone.save(f.workspace.slug,f.bot.id,f.body,mcp);assert.equal(saved.configuration.enabled,true);
});

async function invoke(handler,req){
  let response,error;await handler(req,{json:value=>{response=value;}},value=>{error=value;});if(error)throw error;return response;
}
function saveHandler(app,prefix){
  const layer=app.router.stack.find(item=>item.route?.path===`${prefix}/workspaces/:slug/employees/:id/phone-mcp`&&item.route.methods.put);
  assert.ok(layer);return layer.route.stack.at(-1).handle;
}

test('actual API and MCP PUT handlers pass their authenticated context through to the Bot save without listening',async t=>{
  const f=fixture(t,{withApp:true}),calls=[],save=f.phone.save;
  f.phone.save=async(...args)=>{calls.push(args[3]);return save(...args);};
  const request={params:{slug:f.workspace.slug,id:f.bot.id},body:f.body,app:f.app};
  const api=await invoke(saveHandler(f.app,'/api'),{...request,auth:{user_id:f.owner.user_id},workspaceRole:'owner'});
  assert.equal(api.configuration.enabled,true);assert.equal(calls.at(-1).actorUserId,f.owner.user_id);assert.equal(calls.at(-1).actorRole,'owner');
  const credential={workspace:f.workspace.slug,actorUserId:f.owner.user_id,actorRole:'owner',deviceScope:'identity-pc',deviceId:'identity-pc'};
  const mcp=await invoke(saveHandler(f.app,'/mcp/v1'),{...request,mcpCredential:credential});
  assert.equal(mcp.configuration.enabled,true);assert.equal(calls.at(-1).actorUserId,f.owner.user_id);assert.equal(calls.at(-1).authenticatedMcp,true);assert.equal(calls.at(-1).deviceScope,'identity-pc');assert.equal(calls.at(-1).deviceCredentialDeviceId,'identity-pc');
  const before=f.snapshot();await assert.rejects(invoke(saveHandler(f.app,'/api'),{...request,workspaceRole:'owner'}),{code:'BOT_ACTOR_REQUIRED',status:403});assert.deepEqual(f.snapshot(),before);
  await assert.rejects(invoke(saveHandler(f.app,'/mcp/v1'),{...request,mcpCredential:{...credential,deviceScope:'other-pc',deviceId:'other-pc'}}),{code:'PHONE_DEVICE_SCOPE',status:403});assert.deepEqual(f.snapshot(),before);
});
