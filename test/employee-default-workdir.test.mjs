import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRepository } from '../backend/repository.mjs';
import { openDatabase } from '../backend/db.mjs';
import { createApp } from '../backend/app.mjs';
import { createManagementService } from '../backend/management.mjs';
import { createEmployeeTemplateService } from '../backend/employees/templates.mjs';
import { createMcpClient, createMcpHandler, toolDefinitions as managementTools } from '../scripts/ziwei-mcp.mjs';

const SLUG='test-111', DIR='D:\\digital';
const actor={actorUserId:'owner-fixture',actorRole:'owner'};
function fixture(t) {
  const repo=createRepository({memory:true,envEncryptionKey:'default-workdir-test-only'});
  t.after(()=>repo.db.close());
  for (const deviceId of ['pc-a','pc-b']) repo.heartbeatDevice(SLUG,{deviceId,ownerUserId:actor.actorUserId,workdir:'C:\\legacy',runtimes:{Codex:{status:'available',readiness:{authentication:'configured',provider:'configured'}}}});
  const receipt=(directory=DIR,deviceId='pc-a',options={})=>{
    const action=repo.createA2AAction(options.slug || SLUG,{type:options.type || 'directory.inspect',expiresAt:options.expiresAt,payload:{deviceId,userId:options.userId===undefined?actor.actorUserId:options.userId,path:directory}});
    if(options.status!=='pending') repo.resultA2AAction(action.id,{status:options.status || 'succeeded',deviceId,result:{path:options.canonical || directory,exists:true,isDirectory:true,...options.result}});
    return action.id;
  };
  const employee=(directory=DIR,deviceId='pc-a')=>repo.createEmployee(SLUG,{name:crypto.randomUUID(),runtime:'Codex',targetDeviceId:deviceId,...(directory?{defaultWorkingDirectory:directory,defaultWorkingDirectoryActionId:receipt(directory,deviceId)}:{})},actor);
  return {repo,receipt,employee};
}

test('legacy migration adds nullable directory pair without backfilling or changing existing rows',t=>{
  const filename=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-workdir-migration-')),'fixture.sqlite');
  t.after(()=>fs.rmSync(path.dirname(filename),{recursive:true,force:true}));
  const repo=createRepository({filename,envEncryptionKey:'migration-fixture'});
  let db=repo.db;
  const employee=repo.createEmployee(SLUG,{name:'legacy'});
  const conversation=repo.createConversation(SLUG,{employeeId:employee.id,cwd:'D:\\old'});
  const beforeEmployee=db.prepare('SELECT * FROM employees WHERE id=?').get(employee.id);
  const beforeConversation=db.prepare('SELECT * FROM conversations WHERE id=?').get(conversation.id);
  // Model a pre-feature schema by dropping just the additive nullable fields.
  const columns=db.prepare('PRAGMA table_info(employees)').all().map(row=>row.name);
  for(const column of ['default_working_directory','default_working_directory_device_id']) if(columns.includes(column)) db.exec(`ALTER TABLE employees DROP COLUMN ${column}`);
  db.close();
  for(let attempt=0;attempt<2;attempt++) {
    db=openDatabase({filename});
    const saved=db.prepare('SELECT * FROM employees WHERE id=?').get(employee.id);
    assert.equal(saved.default_working_directory,null);assert.equal(saved.default_working_directory_device_id,null);
    const {default_working_directory:_path,default_working_directory_device_id:_device,...old}=saved;
    const {default_working_directory:_oldPath,default_working_directory_device_id:_oldDevice,...expected}=beforeEmployee;
    assert.deepEqual(old,expected);assert.deepEqual(db.prepare('SELECT * FROM conversations WHERE id=?').get(conversation.id),beforeConversation);
    db.close();
  }
});

test('new conversations snapshot employee default, explicit overrides and device fallback independently',t=>{
  const {repo,employee,receipt}=fixture(t), a=employee(),b=employee('D:\\other'),legacy=employee(null);
  const first=repo.createConversation(SLUG,{employeeId:a.id}),second=repo.createConversation(SLUG,{employeeId:a.id,cwd:' '});
  assert.equal(first.working_directory,DIR);assert.equal(second.working_directory,DIR);
  const override=repo.createConversation(SLUG,{employeeId:a.id,cwd:'D:\\temporary'});
  const message=repo.addConversationMessage(first.id,{content:'snapshot retry',clientMessageId:'snapshot-original',dispatch:false});
  assert.equal(override.working_directory,'D:\\temporary');assert.equal(repo.createConversation(SLUG,{employeeId:b.id}).working_directory,'D:\\other');
  assert.equal(repo.createConversation(SLUG,{employeeId:legacy.id}).working_directory,'C:\\legacy');
  repo.updateEmployee(a.id,{defaultWorkingDirectory:'D:\\future',defaultWorkingDirectoryActionId:receipt('D:\\future')},actor);
  assert.equal(repo.createConversation(SLUG,{employeeId:a.id}).working_directory,'D:\\future');
  assert.equal(repo.getConversation(first.id).working_directory,DIR);assert.equal(repo.getConversation(override.id).working_directory,'D:\\temporary');
  assert.equal(repo.addConversationMessage(first.id,{content:'snapshot retry',clientMessageId:'snapshot-original',dispatch:false}).id,message.id,'changing employee default does not change historical message fingerprint');
  repo.updateConversationSettings(first.id,{cwd:'D:\\conversation-only'});
  assert.equal(repo.getEmployee(a.id).default_working_directory,'D:\\future');
  assert.throws(()=>repo.createConversation(SLUG,{employeeId:a.id,deviceId:'pc-b'}),{code:'DEFAULT_WORKDIR_DEVICE_MISMATCH'});
  assert.equal(repo.createConversation(SLUG,{employeeId:a.id,deviceId:'pc-b',cwd:'D:\\explicit-b'}).working_directory,'D:\\explicit-b');
});

test('new conversation rejects malformed explicit directory before writing snapshot or audit',t=>{
  const {repo,employee}=fixture(t),saved=employee();
  const counts=()=>['conversations','audit_events','notifications'].map(table=>repo.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n),before=counts();
  for(const workingDirectory of [123,{},'D:\\bad\u0000','D:\\bad\n','D:\\'+'x'.repeat(4097)]) assert.throws(()=>repo.createConversation(SLUG,{employeeId:saved.id,workingDirectory}),{code:'CONVERSATION_WORKDIR_INVALID'});
  assert.deepEqual(counts(),before);
});

test('saving directory requires actual scoped succeeded receipt and canonicalizes the persisted pair',t=>{
  const {repo,receipt}=fixture(t);
  const input={name:'canonical',targetDeviceId:'pc-a',defaultWorkingDirectory:'D:\\alias',defaultWorkingDirectoryActionId:receipt('D:\\alias','pc-a',{canonical:DIR}),defaultWorkingDirectoryDeviceId:'pc-b'};
  const saved=repo.createEmployee(SLUG,input,actor);
  assert.equal(saved.default_working_directory,DIR);assert.equal(saved.default_working_directory_device_id,'pc-a');
  assert.equal(repo.updateEmployee(saved.id,{description:'ordinary edit'},actor).default_working_directory,DIR);
  assert.equal(repo.updateEmployee(saved.id,{default_working_directory:DIR},actor).default_working_directory,DIR);
  for(const value of ['', '  ', 123, 'D:\\bad\u0000', 'D:\\'+ 'x'.repeat(4097)]) assert.throws(()=>repo.updateEmployee(saved.id,{defaultWorkingDirectory:value},actor),{code:'DEFAULT_WORKDIR_INVALID'});
  for(const options of [{status:'pending'},{status:'failed'},{type:'task.execute'},{userId:'another-user'},{result:{exists:false}},{result:{isDirectory:false}},{canonical:'relative'}]) {
    const actionId=receipt('D:\\change','pc-a',options);
    const before=repo.db.prepare('SELECT * FROM employees WHERE id=?').get(saved.id);
    const audits=repo.db.prepare('SELECT count(*) AS n FROM audit_events').get().n;
    assert.throws(()=>repo.updateEmployee(saved.id,{name:'forged',defaultWorkingDirectory:'D:\\change',defaultWorkingDirectoryActionId:actionId,checked:true,actorUserId:'another-user',actorRole:'owner'},actor),{code:'DEFAULT_WORKDIR_RECEIPT_INVALID'});
    assert.deepEqual(repo.db.prepare('SELECT * FROM employees WHERE id=?').get(saved.id),before);assert.equal(repo.db.prepare('SELECT count(*) AS n FROM audit_events').get().n,audits);
  }
  assert.throws(()=>repo.updateEmployee(saved.id,{defaultWorkingDirectory:'D:\\change',defaultWorkingDirectoryActionId:receipt('D:\\change','pc-b')},actor),{code:'DEFAULT_WORKDIR_RECEIPT_INVALID'});
  assert.throws(()=>repo.updateEmployee(saved.id,{defaultWorkingDirectory:'D:\\change',defaultWorkingDirectoryActionId:receipt('D:\\change')},{...actor,deviceScope:'pc-b'}),{code:'DEVICE_SCOPE_MISMATCH'});
  const stale=receipt('D:\\change');repo.db.prepare('UPDATE a2a_actions SET completed_at=? WHERE id=?').run(new Date(Date.now()-11*60*1000).toISOString(),stale);
  assert.throws(()=>repo.updateEmployee(saved.id,{defaultWorkingDirectory:'D:\\change',defaultWorkingDirectoryActionId:stale},actor),{code:'DEFAULT_WORKDIR_RECEIPT_INVALID'});
  const deadline=receipt('D:\\recent');repo.db.prepare('UPDATE a2a_actions SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z',deadline);
  assert.equal(repo.updateEmployee(saved.id,{defaultWorkingDirectory:'D:\\recent',defaultWorkingDirectoryActionId:deadline},actor).default_working_directory,'D:\\recent','completed_at controls evidence freshness, not dispatch deadline');
});

test('target-device changes reject atomically until explicit clear or newly validated directory',t=>{
  const {repo,employee,receipt}=fixture(t),saved=employee();
  const before=repo.db.prepare('SELECT * FROM employees WHERE id=?').get(saved.id);
  const counts=()=>['audit_events','notifications'].map(table=>repo.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n);
  const oldCounts=counts();
  assert.throws(()=>repo.updateEmployee(saved.id,{targetDeviceId:'pc-b',name:'must not save'},actor),{status:409,code:'DEFAULT_WORKDIR_REVALIDATION_REQUIRED'});
  assert.deepEqual(repo.db.prepare('SELECT * FROM employees WHERE id=?').get(saved.id),before);assert.deepEqual(counts(),oldCounts);
  const rebound=repo.updateEmployee(saved.id,{targetDeviceId:'pc-b',defaultWorkingDirectory:DIR,defaultWorkingDirectoryActionId:receipt(DIR,'pc-b')},actor);
  assert.equal(rebound.default_working_directory_device_id,'pc-b');
  const cleared=repo.updateEmployee(saved.id,{targetDeviceId:'pc-a',defaultWorkingDirectory:null},actor);
  assert.equal(cleared.default_working_directory,null);assert.equal(cleared.default_working_directory_device_id,null);
});

test('device inspection is conversation-free and explicit creation cannot be coerced',t=>{
  const {repo}=fixture(t),before=repo.db.prepare('SELECT count(*) AS n FROM conversations').get().n;
  assert.equal(typeof repo.createDeviceDirectoryAction,'function');
  for(const value of [undefined,false,'true',1]) {
    const action=repo.createDeviceDirectoryAction(SLUG,'pc-a',{path:DIR,createIfMissing:value},actor);
    assert.equal(action.payload.createIfMissing,false);assert.equal(action.payload.conversationId,undefined);
    assert.ok(repo.getDeviceDirectoryAction(SLUG,'pc-a',action.id,actor));assert.equal(repo.getDeviceDirectoryAction(SLUG,'pc-b',action.id,actor),null);
  }
  assert.equal(repo.createDeviceDirectoryAction(SLUG,'pc-a',{path:DIR,createIfMissing:true},actor).payload.createIfMissing,true);
  assert.equal(repo.db.prepare('SELECT count(*) AS n FROM conversations').get().n,before);
  assert.throws(()=>repo.createDeviceDirectoryAction(SLUG,'pc-b',{path:DIR},{...actor,deviceScope:'pc-a'}),{code:'DEVICE_SCOPE_MISMATCH'});
  repo.db.prepare("UPDATE devices SET status='disabled' WHERE id='pc-a'").run();
  assert.throws(()=>repo.createDeviceDirectoryAction(SLUG,'pc-a',{path:DIR},actor),/停用/);
});

test('directory save rechecks current device authorization and disabled status',t=>{
  const {repo,receipt}=fixture(t);
  const member={actorUserId:'unowned-personal-member',actorRole:'member'};
  const id=receipt(DIR,'pc-a',{userId:member.actorUserId});
  assert.throws(()=>repo.createEmployee(SLUG,{name:'must fail',targetDeviceId:'pc-a',defaultWorkingDirectory:DIR,defaultWorkingDirectoryActionId:id},member),{code:'DEFAULT_WORKDIR_DEVICE_FORBIDDEN'});
  const own=receipt();repo.db.prepare("UPDATE devices SET status='disabled' WHERE id='pc-a'").run();
  assert.throws(()=>repo.createEmployee(SLUG,{name:'must fail disabled',targetDeviceId:'pc-a',defaultWorkingDirectory:DIR,defaultWorkingDirectoryActionId:own},actor),/停用/);
});

test('Creator first conversation inherits default while duplicate install and legacy hash stay stable',t=>{
  const {repo,receipt}=fixture(t),management=createManagementService(repo),templates=createEmployeeTemplateService(repo,management);
  for(const userId of [actor.actorUserId,'other-owner']) repo.db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(),'ws-test-111',userId,userId,userId+'@example.test','owner',new Date().toISOString());
  const legacy=templates.install(SLUG,'ziwei-employee-creator',{runtime:'Codex',targetDeviceId:'pc-a'},actor);
  const e=legacy.employee;
  const oldHash=crypto.createHash('sha256').update(JSON.stringify([e.name,e.runtime,e.model_id,e.description,e.persona,e.visibility,e.skills,e.instructions,e.runtime_profile,e.avatar,e.status,e.target_device_id])).digest('hex');
  assert.equal(repo.db.prepare('SELECT initial_config_hash FROM employee_template_instances WHERE employee_id=?').get(e.id).initial_config_hash,oldHash);
  assert.equal(legacy.template.customized,false);
  // A separate authenticated owner creates an independent template instance.
  const other={actorUserId:'other-owner',actorRole:'owner'};
  const newReceipt=receipt(DIR,'pc-a',{userId:other.actorUserId});
  const created=templates.install(SLUG,'ziwei-employee-creator',{runtime:'Codex',targetDeviceId:'pc-a',defaultWorkingDirectory:DIR,defaultWorkingDirectoryActionId:newReceipt},other);
  assert.equal(created.employee.default_working_directory,DIR);assert.equal(created.conversation.working_directory,DIR);assert.equal(created.template.customized,false);
  const duplicate=templates.install(SLUG,'ziwei-employee-creator',{},other);
  assert.equal(duplicate.employee.default_working_directory,DIR);assert.equal(duplicate.conversation.id,created.conversation.id);
});

test('actual MCP handlers advertise and carry inspect, employee receipt and conversation inheritance over HTTP',async t=>{
  const app=createApp({memory:true,enableScheduler:false,mcpOptions:{token:'workdir-fixture-token',workspaces:[SLUG]}}),repo=app.locals.repo;
  repo.heartbeatDevice(SLUG,{deviceId:'mcp-pc',workdir:'C:\\legacy',runtimes:{Codex:{status:'available',readiness:{authentication:'configured',provider:'configured'}}}});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(()=>{repo.db.close();resolve();})));
  const client=createMcpClient({baseUrl:`http://127.0.0.1:${server.address().port}`,workspace:SLUG,token:'workdir-fixture-token'}),handler=createMcpHandler(client);
  for(const name of ['ziwei_inspect_workdir','ziwei_create_conversation']) assert.ok(managementTools.some(tool=>tool.name===name),name);
  assert.ok(managementTools.find(tool=>tool.name==='ziwei_update_employee').inputSchema.properties.defaultWorkingDirectory);
  const call=async(name,args)=>{const reply=await handler({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}});assert.equal(reply.error,undefined,JSON.stringify(reply));assert.equal(reply.result.isError,undefined,JSON.stringify(reply));return JSON.parse(reply.result.content[0].text);};
  const inspected=await call('ziwei_inspect_workdir',{deviceId:'mcp-pc',path:DIR});
  repo.resultA2AAction(inspected.id,{status:'succeeded',deviceId:'mcp-pc',result:{path:DIR,exists:true,isDirectory:true}});
  const e=await call('ziwei_create_employee',{name:'MCP default',runtime:'Codex',targetDeviceId:'mcp-pc',defaultWorkingDirectory:DIR,defaultWorkingDirectoryActionId:inspected.id});
  const c=await call('ziwei_create_conversation',{employeeId:e.id});assert.equal(c.working_directory,DIR);
  const second=await call('ziwei_create_conversation',{employeeId:e.id});assert.equal(second.working_directory,DIR);assert.notEqual(second.id,c.id,'new conversation without an explicit retry key is a new snapshot');
  const one=await call('ziwei_create_conversation',{employeeId:e.id,idempotencyKey:'conversation-retry'}),retry=await call('ziwei_create_conversation',{employeeId:e.id,idempotencyKey:'conversation-retry'});assert.equal(one.id,retry.id);
  const override=await call('ziwei_create_conversation',{employeeId:e.id,workingDirectory:'D:\\override'});assert.equal(override.working_directory,'D:\\override');
});

test('authenticated browser receipts cannot be borrowed across users or workspaces and rejected changes have no partial writes',async t=>{
  const app=createApp({memory:true,requireAuth:true,enableScheduler:false}),repo=app.locals.repo,auth=app.locals.auth;
  const owner=auth.setup({name:'owner',email:'wd-owner@example.test',password:'fixture-password'});
  const ws=auth.createWorkspace(owner.user_id,{name:'workdir team',slug:'wd-team',kind:'team'}).workspace;
  const otherWs=auth.createWorkspace(owner.user_id,{name:'foreign',slug:'wd-foreign',kind:'team'}).workspace;
  const member=auth.register({name:'member',email:'wd-member@example.test',password:'fixture-password'});
  repo.db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(),ws.id,member.user_id,'member','wd-member@example.test','member',new Date().toISOString());
  for(const slug of [ws.slug,otherWs.slug]) repo.heartbeatDevice(slug,{deviceId:slug+'-pc',ownerUserId:owner.user_id,workdir:'C:\\legacy',runtimes:{Codex:{status:'available',readiness:{authentication:'configured',provider:'configured'}}}});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(()=>{repo.db.close();resolve();})));
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=async(route,body,person=owner,method=body===undefined?'GET':'POST')=>{const response=await fetch(base+route,{method,headers:{'content-type':'application/json',cookie:`ziwei_session=${person.session.token}`},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,body:await response.json()};};
  const inspect=async(slug,person=owner)=>{
    const result=await request(`/api/workspaces/${slug}/devices/${slug}-pc/workdir/inspect`,{path:DIR,actorUserId:owner.user_id,actorRole:'owner'},person);assert.equal(result.status,202);
    repo.resultA2AAction(result.body.action.id,{status:'succeeded',deviceId:slug+'-pc',result:{path:DIR,exists:true,isDirectory:true}});return result.body.action.id;
  };
  const ownerAction=await inspect(ws.slug),foreign=await inspect(otherWs.slug);
  const fields={name:'member employee',runtime:'Codex',targetDeviceId:ws.slug+'-pc',defaultWorkingDirectory:DIR,defaultWorkingDirectoryActionId:ownerAction,actorUserId:owner.user_id,userId:owner.user_id,actorRole:'owner',actor_role:'owner',checked:true,defaultWorkingDirectoryDeviceId:ws.slug+'-pc'};
  const rejected=await request(`/api/workspaces/${ws.slug}/employees`,fields,member);assert.equal(rejected.status,400);assert.equal(rejected.body.code,'DEFAULT_WORKDIR_RECEIPT_INVALID');
  assert.equal(repo.listEmployees(ws.slug).length,0);
  assert.equal((await request(`/api/workspaces/${ws.slug}/devices/${ws.slug}-pc/workdir/actions/${ownerAction}`,undefined,member)).status,404);
  assert.equal((await request(`/api/workspaces/${ws.slug}/employees`,{...fields,defaultWorkingDirectoryActionId:foreign},owner)).body.code,'DEFAULT_WORKDIR_RECEIPT_INVALID');
  const memberReceipt=await inspect(ws.slug,member),saved=await request(`/api/workspaces/${ws.slug}/employees`,{...fields,defaultWorkingDirectoryActionId:memberReceipt},member);assert.equal(saved.status,201);assert.equal(saved.body.default_working_directory,DIR);
  const c1=await request(`/api/workspaces/${ws.slug}/conversations`,{employeeId:saved.body.id},member),c2=await request(`/api/workspaces/${ws.slug}/conversations`,{employeeId:saved.body.id,cwd:null},member);assert.equal(c1.body.working_directory,DIR);assert.equal(c2.body.working_directory,DIR);assert.notEqual(c1.body.id,c2.body.id);
  const before=repo.db.prepare('SELECT * FROM employees WHERE id=?').get(saved.body.id),counts=()=>['audit_events','notifications'].map(table=>repo.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n),originalCounts=counts();
  const badPatch=await request(`/api/workspaces/${ws.slug}/employees/${saved.body.id}`,{name:'not saved',defaultWorkingDirectory:'D:\\forged',defaultWorkingDirectoryActionId:ownerAction,actorUserId:owner.user_id,actorRole:'owner'},member,'PATCH');assert.equal(badPatch.body.code,'DEFAULT_WORKDIR_RECEIPT_INVALID');assert.deepEqual(repo.db.prepare('SELECT * FROM employees WHERE id=?').get(saved.body.id),before);assert.deepEqual(counts(),originalCounts);
});

test('actual device-bootstrap MCP can validate and inherit only its paired legacy personal computer',async t=>{
  const app=createApp({memory:true,enableScheduler:false,managementMcpSecret:'isolated-workdir-bootstrap'}),repo=app.locals.repo;
  repo.db.prepare("UPDATE workspaces SET kind='personal' WHERE slug=?").run(SLUG);
  const pair=repo.createDevicePairing(SLUG,{name:'legacy own'}),claim=repo.claimDevicePairing({code:pair.code});
  const runtime={Codex:{status:'available',readiness:{authentication:'configured',provider:'configured'}}};
  repo.heartbeatDevice(SLUG,{deviceId:claim.deviceId,workdir:'C:\\legacy',runtimes:runtime});
  const other=repo.createDevice(SLUG,{name:'other computer',ownerUserId:'private-other'});repo.heartbeatDevice(SLUG,{deviceId:other.id,runtimes:runtime});
  const identity=repo.authenticateDeviceToken(claim.deviceToken),issued=app.locals.managementBootstrap.bootstrap(SLUG,identity);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(()=>{repo.db.close();resolve();})));
  const client=createMcpClient({baseUrl:`http://127.0.0.1:${server.address().port}`,workspace:SLUG,token:issued.token});
  const inspected=await client.inspectWorkdir({deviceId:claim.deviceId,path:DIR,actorRole:'owner',deviceScope:other.id,deviceCredentialDeviceId:other.id});
  assert.equal(inspected.payload.deviceId,claim.deviceId);assert.equal(inspected.payload.userId,null);
  repo.resultA2AAction(inspected.id,{status:'succeeded',deviceId:claim.deviceId,result:{path:DIR,exists:true,isDirectory:true}});
  const own=await client.createEmployee({name:'legacy bound',runtime:'Codex',targetDeviceId:claim.deviceId,defaultWorkingDirectory:DIR,defaultWorkingDirectoryActionId:inspected.id});
  assert.equal((await client.createConversation({employeeId:own.id})).working_directory,DIR);
  await assert.rejects(()=>client.inspectWorkdir({deviceId:other.id,path:DIR,actorRole:'owner',deviceScope:other.id,deviceCredentialDeviceId:other.id}),/设备范围/);
  await assert.rejects(()=>client.createConversation({employeeId:own.id,deviceId:other.id,cwd:'D:\\other',actorRole:'owner',enforceDeviceOwnership:false,deviceScope:other.id}),/设备范围/);
});
