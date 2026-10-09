import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createApp } from '../backend/app.mjs';

const TEMPLATE = 'ziwei-employee-creator';
const templateName = '数字员工·Creator';
const profileReady = name => ({ name, provider_configured: true, authentication_configured: true, readiness: { ready: true, authentication: 'configured', provider: 'configured' } });

async function fixture(t, { profiles = [profileReady('default'), profileReady('independent')], hermesReadiness = {}, kind = 'team' } = {}) {
  const app = createApp({ memory: true, requireAuth: true, enableScheduler: false });
  const repo = app.locals.repo, auth = app.locals.auth;
  const owner = auth.setup({ name: 'Template fixture owner', email: 'template-owner@example.test', password: 'fixture-password' });
  const workspace = auth.createWorkspace(owner.user_id, { name: 'Template fixture team', slug: 'template-team', kind }).workspace;
  const otherWorkspace = auth.createWorkspace(owner.user_id, { name: 'Other fixture team', slug: 'template-other', kind: 'team' }).workspace;
  const member = auth.register({ name: 'Member fixture', email: 'template-member@example.test', password: 'fixture-password' });
  const second = auth.register({ name: 'Second fixture', email: 'template-second@example.test', password: 'fixture-password' });
  const outsider = auth.register({ name: 'Outsider fixture', email: 'template-outsider@example.test', password: 'fixture-password' });
  for (const person of [member, second]) repo.db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run(`member_${randomUUID()}`, workspace.id, person.user_id, person.user.name, person.user.email, 'member', new Date().toISOString());
  repo.heartbeatDevice(workspace.slug, { deviceId: 'creator-pc', ownerUserId: member.user_id, runtimes: {
    Codex: { status: 'available', binary: 'fixture-codex', readiness: { ready: true, authentication: 'configured', provider: 'configured' }, profiles: [] },
    Hermes: { status: 'available', binary: 'fixture-hermes', readiness: { ready: true, authentication: 'configured', provider: 'configured', ...hermesReadiness }, profiles },
  } });
  repo.heartbeatDevice(otherWorkspace.slug, { deviceId: 'foreign-pc', runtimes: { Codex: { status: 'available', readiness: { authentication: 'configured', provider: 'configured' } } } });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(() => { repo.db.close(); resolve(); })));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, body, person = member, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(person ? { cookie: `ziwei_session=${person.session.token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  const catalog = (person = member) => request(`/api/workspaces/${workspace.slug}/employee-templates`, undefined, person);
  const install = (input = {}, person = member, slug = workspace.slug) => request(`/api/workspaces/${slug}/employee-templates/${TEMPLATE}/instances`, input, person);
  const input = { targetDeviceId: 'creator-pc', runtime: 'Hermes' };
  return { app, repo, auth, workspace, otherWorkspace, owner, member, second, outsider, base, request, catalog, install, input };
}

test('template catalog is authenticated, workspace scoped and includes only the caller instance', async t => {
  const f = await fixture(t);
  assert.equal((await f.catalog(null)).status, 401);
  assert.equal((await f.catalog(f.outsider)).status, 403);
  const before = await f.catalog();
  assert.equal(before.status, 200);
  const item = before.body.templates.find(row => row.id === TEMPLATE);
  assert.equal(item.name, templateName); assert.equal(item.version, '1.0.0');
  assert.deepEqual(item.supportedRuntimes, ['Codex', 'Hermes']); assert.ok(item.workflow.length);
  assert.equal(item.installed, false); assert.equal(item.instance, null);
  const created = await f.install(f.input); assert.equal(created.status, 201);
  const mine = (await f.catalog()).body.templates.find(row => row.id === TEMPLATE);
  assert.equal(mine.instance.employeeId, created.body.employee.id);
  assert.equal(mine.instance.conversationId, created.body.conversation.id);
  assert.equal(mine.instance.templateVersion, '1.0.0'); assert.equal(mine.updatePolicy, 'new-instances-only');
  const others = (await f.catalog(f.second)).body.templates.find(row => row.id === TEMPLATE);
  assert.equal(others.installed, false); assert.equal(others.instance, null);
  assert.equal(JSON.stringify(others).includes(created.body.employee.id), false);
});

test('member Creator uses the authenticated actor, default personal visibility and existing chat flow', async t => {
  const f = await fixture(t);
  const created = await f.install({ ...f.input, actorUserId: f.owner.user_id, ownerUserId: f.owner.user_id, owner_user_id: f.owner.user_id, userId: f.owner.user_id, actorRole: 'owner', actor_role: 'owner', workspace: f.otherWorkspace.slug });
  assert.equal(created.status, 201);
  const { employee, conversation, template, duplicate } = created.body;
  assert.equal(employee.owner_user_id, f.member.user_id); assert.equal(employee.workspace_id, f.workspace.id);
  assert.equal(employee.visibility, 'personal'); assert.equal(employee.runtime, 'Hermes'); assert.equal(employee.runtime_profile, 'default'); assert.equal(employee.target_device_id, 'creator-pc'); assert.equal(employee.management_mcp_enabled, true);
  assert.equal(conversation.employee_id, employee.id); assert.equal(conversation.device_id, 'creator-pc'); assert.equal(conversation.model_id, employee.model_id);
  assert.equal(template.version, '1.0.0'); assert.equal(template.origin, 'template'); assert.equal(duplicate, false);
  assert.equal((await f.request(`/api/conversations/${conversation.id}`, undefined, f.second)).status, 404);
  const sent = await f.request(`/api/conversations/${conversation.id}/messages`, { content: 'Isolated fixture conversation, no real runtime starts.' });
  assert.equal(sent.status, 201);
  const action = f.repo.listA2AActions(f.workspace.slug, { includeAll: true }).find(row => row.payload.conversationId === conversation.id);
  assert.ok(action); assert.equal(action.payload.employeeId, employee.id); assert.equal(action.payload.managementMcp.workspace, f.workspace.slug);
});

test('concurrent retries reuse one per-owner instance and persistent conversation without overwriting customization', async t => {
  const f = await fixture(t);
  const responses = await Promise.all(Array.from({ length: 6 }, () => f.install(f.input)));
  assert.deepEqual(responses.map(row => row.status).sort(), [200, 200, 200, 200, 200, 201]);
  const ids = new Set(responses.map(row => row.body.employee.id)); assert.equal(ids.size, 1);
  assert.equal(new Set(responses.map(row => row.body.conversation.id)).size, 1);
  const employee = responses[0].body.employee;
  f.repo.updateEmployee(employee.id, { name: 'My customized Creator', persona: 'My saved personality', instructions: 'Keep my saved operating rules', skills: ['custom-fixture-skill'], description: 'My saved description' });
  const previous = f.repo.getEmployee(employee.id);
  const retry = await f.install({}); assert.equal(retry.status, 200); assert.equal(retry.body.duplicate, true);
  assert.deepEqual(retry.body.employee, previous); assert.equal(retry.body.template.customized, true);
  assert.equal(f.repo.db.prepare('SELECT COUNT(*) AS count FROM employee_template_instances WHERE workspace_id=? AND owner_user_id=?').get(f.workspace.id, f.member.user_id).count, 1);
});

test('explicit changes to installed runtime, device, profile, model or visibility return a conflict', async t => {
  const f = await fixture(t); const first = await f.install(f.input); assert.equal(first.status, 201);
  for (const input of [{ runtime: 'Codex' }, { targetDeviceId: 'foreign-pc' }, { runtimeProfile: 'independent' }, { model: 'different-model' }, { visibility: 'workspace' }]) {
    const response = await f.install(input); assert.equal(response.status, 409); assert.equal(response.body.code, 'TEMPLATE_INSTANCE_CONFIG_CONFLICT');
  }
  assert.equal(f.repo.getEmployee(first.body.employee.id).runtime_profile, 'default');
  assert.equal((await f.install({}, f.second)).status, 400, 'A different caller has no existing instance to reuse');
  const second = await f.install(f.input, f.second); assert.equal(second.status, 201); assert.notEqual(second.body.employee.id, first.body.employee.id);
});

test('new template instances reject foreign devices, offline devices and missing CLI/auth/provider evidence', async t => {
  const f = await fixture(t);
  assert.equal((await f.install({ ...f.input, targetDeviceId: 'foreign-pc' })).body.code, 'DEVICE_NOT_IN_WORKSPACE');
  f.repo.db.prepare('UPDATE devices SET last_seen=? WHERE id=?').run('2000-01-01T00:00:00.000Z', 'creator-pc');
  assert.equal((await f.install(f.input)).body.code, 'DEVICE_OFFLINE');
  f.repo.heartbeatDevice(f.workspace.slug, { deviceId: 'creator-pc', runtimes: { Codex: { status: 'available', readiness: { authentication: 'missing', provider: 'configured' } } } });
  assert.equal((await f.install({ ...f.input, runtime: 'Codex' })).body.code, 'AUTHENTICATION_MISSING');
  f.repo.heartbeatDevice(f.workspace.slug, { deviceId: 'creator-pc', runtimes: { Codex: { status: 'available', readiness: { authentication: 'configured', provider: 'missing' } } } });
  assert.equal((await f.install({ ...f.input, runtime: 'Codex' })).body.code, 'PROVIDER_MISSING');
  f.repo.heartbeatDevice(f.workspace.slug, { deviceId: 'creator-pc', runtimes: { Codex: { status: 'available', readiness: {} } } });
  assert.equal((await f.install({ ...f.input, runtime: 'Codex' })).body.code, 'READINESS_UNKNOWN');
  assert.equal(f.repo.listEmployees(f.workspace.slug).length, 0);
});

test('Hermes profile defaults use actual ready default or the only ready profile, never an explicit fallback', async t => {
  const f = await fixture(t, { profiles: [profileReady('only-independent'), { name: 'default', provider_configured: false, authentication_configured: false, readiness: { ready: false } }] });
  const invalid = await f.install({ ...f.input, runtimeProfile: 'missing-profile' }); assert.equal(invalid.status, 400); assert.equal(invalid.body.code, 'PROFILE_NOT_FOUND');
  const created = await f.install(f.input); assert.equal(created.status, 201); assert.equal(created.body.employee.runtime_profile, 'only-independent');
});

test('ambiguous or unknown Hermes profile readiness refuses installation with a readable choice error', async t => {
  const f = await fixture(t, { profiles: [profileReady('first'), profileReady('second')] });
  const ambiguous = await f.install(f.input); assert.equal(ambiguous.status, 400); assert.equal(ambiguous.body.code, 'TEMPLATE_PROFILE_SELECTION_REQUIRED'); assert.match(ambiguous.body.error, /profile|选择/);
  f.repo.heartbeatDevice(f.workspace.slug, { deviceId: 'creator-pc', runtimes: { Hermes: { status: 'available', profiles: [{ name: 'default' }], readiness: { authentication: 'configured', provider: 'configured' } } } });
  const unknown = await f.install(f.input); assert.equal(unknown.status, 400); assert.equal(unknown.body.code, 'TEMPLATE_PROFILE_NOT_READY');
  assert.equal(f.repo.listEmployees(f.workspace.slug).length, 0);
});

test('Codex instance retains requested runtime and model with no inferred Hermes profile', async t => {
  const f = await fixture(t);
  const created = await f.install({ targetDeviceId: 'creator-pc', runtime: 'Codex', model: 'fixture-model', visibility: 'workspace' });
  assert.equal(created.status, 201); assert.equal(created.body.employee.runtime, 'Codex'); assert.equal(created.body.employee.runtime_profile, null); assert.equal(created.body.employee.model_id, 'fixture-model'); assert.equal(created.body.employee.visibility, 'workspace');
  assert.equal((await f.request(`/api/conversations/${created.body.conversation.id}`, undefined, f.second)).status, 200);
});

test('same-owner compatible historical Creator is adopted with truthful provenance and no content rewrite', async t => {
  const f = await fixture(t);
  const legacy = f.repo.createEmployee(f.workspace.slug, { name: templateName, runtime: 'Hermes', runtimeProfile: 'default', targetDeviceId: 'creator-pc', ownerUserId: f.member.user_id, visibility: 'personal', instructions: 'Historical user instructions', persona: 'Historical user persona', skills: ['saved-skill'] });
  const adopted = await f.install(f.input); assert.equal(adopted.status, 200); assert.equal(adopted.body.employee.id, legacy.id); assert.equal(adopted.body.employee.instructions, legacy.instructions); assert.equal(adopted.body.template.origin, 'adopted-existing'); assert.equal(adopted.body.template.version, null); assert.equal(adopted.body.template.templateApplied, false); assert.equal(adopted.body.template.customized, true);
  assert.equal(f.repo.listEmployees(f.workspace.slug).length, 1);
  const catalog = (await f.catalog()).body.templates.find(row => row.id === TEMPLATE); assert.equal(catalog.instance.templateVersion, null); assert.equal(catalog.instance.customized, true);
});

test('same-owner historical Creator conflicts never overwrite or adopt another owner employee', async t => {
  const f = await fixture(t);
  f.repo.createEmployee(f.workspace.slug, { name: templateName, runtime: 'Codex', targetDeviceId: 'creator-pc', ownerUserId: f.member.user_id, visibility: 'personal', instructions: 'Keep historical fields' });
  const conflict = await f.install(f.input); assert.equal(conflict.status, 409); assert.equal(conflict.body.code, 'TEMPLATE_EXISTING_EMPLOYEE_CONFLICT');
  const second = await f.install(f.input, f.second); assert.equal(second.status, 201); assert.equal(second.body.employee.owner_user_id, f.second.user_id);
  assert.equal(f.repo.listEmployees(f.workspace.slug).length, 2);
});

test('employee, template provenance, conversation and management idempotency all roll back together', async t => {
  const f = await fixture(t);
  const published=[];const unsubscribe=f.app.locals.realtime.subscribe(f.workspace.slug,event=>published.push(event));t.after(unsubscribe);
  const before = Object.fromEntries(['employees','conversations','audit_events','notifications','management_requests'].map(table => [table, f.repo.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));
  f.repo.db.exec("CREATE TRIGGER template_fixture_fail BEFORE INSERT ON conversations BEGIN SELECT RAISE(ABORT,'isolated conversation insertion failure'); END");
  const failed = await f.install(f.input); assert.equal(failed.status, 400);
  for (const [table,count] of Object.entries(before)) assert.equal(f.repo.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, count, `${table} must roll back`);
  assert.equal(f.repo.db.prepare('SELECT COUNT(*) AS count FROM employee_template_instances').get().count, 0);
  assert.equal(published.length,0,'Rolled-back template resources must not emit committed notifications');
  f.repo.db.exec('DROP TRIGGER template_fixture_fail');
  const retry = await f.install(f.input); assert.equal(retry.status, 201); assert.equal(retry.body.duplicate, false);
  assert.deepEqual(published.map(event=>event.action),['employee.created','conversation.created']);
});

test('missing persistent conversation is repaired without changing saved employee and deletion clears provenance', async t => {
  const f = await fixture(t); const first = await f.install(f.input); assert.equal(first.status, 201);
  f.repo.db.prepare('DELETE FROM conversations WHERE id=?').run(first.body.conversation.id);
  const previous = f.repo.getEmployee(first.body.employee.id);
  const repaired = await f.install({}); assert.equal(repaired.status, 200); assert.notEqual(repaired.body.conversation.id, first.body.conversation.id); assert.deepEqual(repaired.body.employee, previous);
  f.repo.deleteEmployee(previous.id);
  assert.equal(f.repo.db.prepare('SELECT COUNT(*) AS count FROM employee_template_instances').get().count, 0);
  assert.equal((await f.install(f.input)).status, 201);
});

test('personal workspace members cannot install on unowned devices or elevate using role aliases', async t => {
  const f=await fixture(t,{kind:'personal'});
  // Ownership comes from authenticated pairing, never from heartbeat body.
  f.repo.db.prepare('UPDATE devices SET owner_user_id=? WHERE id=?').run(f.second.user_id,'creator-pc');
  const denied=await f.install({...f.input,actorRole:'owner',actor_role:'owner',ownerUserId:f.second.user_id});
  assert.equal(denied.status,400);assert.equal(denied.body.code,'DEVICE_NOT_IN_WORKSPACE');
  assert.throws(()=>f.app.locals.employeeTemplates.install(f.workspace.slug,TEMPLATE,f.input,{actorUserId:f.member.user_id,actorRole:'owner'}),error=>error.code==='DEVICE_NOT_IN_WORKSPACE');
  assert.equal(f.repo.listEmployees(f.workspace.slug).length,0);
  f.repo.db.prepare('UPDATE devices SET owner_user_id=? WHERE id=?').run(f.member.user_id,'creator-pc');
  const own=await f.install(f.input);assert.equal(own.status,201);assert.equal(own.body.employee.owner_user_id,f.member.user_id);
  assert.throws(()=>f.app.locals.employeeTemplates.list(f.workspace.slug,{actorUserId:f.outsider.user_id,actorRole:'owner'}),error=>error.status===403);
});

test('unavailable CLI, stale discovery and unsupported runtime are reported without substituting environments', async t => {
  const f=await fixture(t);
  const unsupported=await f.install({...f.input,runtime:'Gemini'});assert.equal(unsupported.status,400);assert.equal(unsupported.body.code,'TEMPLATE_RUNTIME_UNSUPPORTED');
  f.repo.heartbeatDevice(f.workspace.slug,{deviceId:'creator-pc',runtimes:{Hermes:{status:'missing',profiles:[profileReady('default')],readiness:{authentication:'configured',provider:'configured'}}}});
  assert.equal((await f.install(f.input)).body.code,'CLI_UNAVAILABLE');
  f.repo.heartbeatDevice(f.workspace.slug,{deviceId:'creator-pc',runtimes:{Hermes:{status:'available',profiles:[profileReady('default')],readiness:{authentication:'configured',provider:'configured'}}}});
  f.repo.db.prepare('UPDATE runtime_device_metadata SET last_seen=? WHERE device_id=?').run('2000-01-01T00:00:00Z','creator-pc');
  assert.equal((await f.install(f.input)).body.code,'DISCOVERY_STALE');
  assert.equal(f.repo.listEmployees(f.workspace.slug).length,0);
});

test('explicit Hermes profiles use their own auth/provider evidence and never silently choose ready default', async t => {
  const f=await fixture(t,{hermesReadiness:{authentication:'missing',provider:'missing'},profiles:[profileReady('default'),{name:'no-auth',provider_configured:true,authentication_configured:false},{name:'no-provider',provider_configured:false,authentication_configured:true}]});
  assert.equal((await f.install({...f.input,runtimeProfile:'no-auth'})).body.code,'PROFILE_AUTHENTICATION_MISSING');
  assert.equal((await f.install({...f.input,runtimeProfile:'no-provider'})).body.code,'PROFILE_PROVIDER_MISSING');
  const ready=await f.install({...f.input,runtimeProfile:'default'});assert.equal(ready.status,201);assert.equal(ready.body.employee.runtime_profile,'default');
});

test('multiple historical same-owner names are a conflict and adoption reuses existing conversation', async t => {
  const f=await fixture(t);
  const config={name:templateName,runtime:'Hermes',runtimeProfile:'default',targetDeviceId:'creator-pc',ownerUserId:f.member.user_id,visibility:'personal',instructions:'Retain history'};
  const first=f.repo.createEmployee(f.workspace.slug,config);const second=f.repo.createEmployee(f.workspace.slug,config);
  const conflict=await f.install(f.input);assert.equal(conflict.status,409);assert.equal(conflict.body.code,'TEMPLATE_EXISTING_EMPLOYEE_CONFLICT');
  f.repo.deleteEmployee(second.id);
  const conversation=f.repo.createConversation(f.workspace.slug,{employeeId:first.id,title:'Saved history conversation'});
  f.repo.addConversationMessage(conversation.id,{role:'user',content:'Saved history only',dispatch:false});
  const adopted=await f.install(f.input);assert.equal(adopted.status,200);assert.equal(adopted.body.conversation.id,conversation.id);assert.equal(adopted.body.conversation.messages[0].content,'Saved history only');
  assert.equal(f.repo.listConversations(f.workspace.slug).length,1);
});

test('catalog updates do not modify installed employee config, its applied version or private provenance', async t => {
  const f=await fixture(t);const created=await f.install(f.input);assert.equal(created.status,201);
  f.repo.db.prepare('UPDATE employee_template_instances SET template_version=? WHERE employee_id=?').run('0.9.0',created.body.employee.id);
  const before=f.repo.getEmployee(created.body.employee.id);
  const catalog=(await f.catalog()).body.templates.find(row=>row.id===TEMPLATE);
  assert.equal(catalog.updateAvailable,true);assert.equal(catalog.instance.templateVersion,'0.9.0');
  const reused=await f.install({});assert.equal(reused.status,200);assert.equal(reused.body.template.version,'0.9.0');assert.equal(reused.body.template.catalogVersion,'1.0.0');assert.deepEqual(reused.body.employee,before);
  assert.equal((await f.catalog(f.owner)).body.templates.find(row=>row.id===TEMPLATE).instance,null,'Even workspace owner receives only their own template installation');
});

test('browser template endpoints do not accept API-key actors or body credential/device capabilities', async t => {
  const f=await fixture(t);const key=f.repo.createApiKey(f.workspace.slug,{name:'Isolated fixture member key',role:'member'});
  const request=await fetch(f.base+`/api/workspaces/${f.workspace.slug}/employee-templates/${TEMPLATE}/instances`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${key.token}`},body:JSON.stringify({...f.input,actorUserId:f.member.user_id,deviceCredentialDeviceId:'creator-pc'})});
  assert.equal(request.status,401);
  assert.throws(()=>f.app.locals.employeeTemplates.install(f.workspace.slug,TEMPLATE,{...f.input,actorUserId:f.owner.user_id,deviceCredentialDeviceId:'creator-pc'},{}),error=>error.code==='AUTH_REQUIRED');
  const foreign=await f.install(f.input,f.member,f.otherWorkspace.slug);assert.equal(foreign.status,403);
  const missing=await f.request(`/api/workspaces/${f.workspace.slug}/employee-templates/unknown/instances`,f.input);assert.equal(missing.status,404);assert.equal(missing.body.code,'TEMPLATE_NOT_FOUND');
  assert.equal(f.repo.listEmployees(f.workspace.slug).length,0);
});

test('Creator conversation and task actions use server template provenance, including recovered pending actions', async t => {
  const f=await fixture(t);const created=await f.install(f.input);assert.equal(created.status,201);
  const sent=await f.request(`/api/conversations/${created.body.conversation.id}/messages`,{content:'Fixture template marker',employeeTemplateId:'forged-template'});assert.equal(sent.status,201);
  const task=f.repo.createTask(f.workspace.slug,{title:'Fixture task marker',employeeId:created.body.employee.id,execute:true,employeeTemplateId:'forged-template'});
  const ownActions=f.repo.listA2AActions(f.workspace.slug,{status:'all'}).filter(row=>row.payload.employeeId===created.body.employee.id);
  assert.ok(ownActions.some(row=>row.type==='conversation.execute'));assert.ok(ownActions.some(row=>row.task_id===task.id));
  for(const action of ownActions)assert.equal(action.payload.employeeTemplateId,TEMPLATE);
  const normal=f.repo.createEmployee(f.workspace.slug,{name:'Ordinary fixture',runtime:'Codex',targetDeviceId:'creator-pc',ownerUserId:f.member.user_id});
  const forged=f.repo.createA2AAction(f.workspace.slug,{type:'agent.execute',payload:{employeeId:normal.id,employeeTemplateId:TEMPLATE}});
  assert.equal(Object.hasOwn(forged.payload,'employeeTemplateId'),false);
  const recovered=f.repo.createA2AAction(f.workspace.slug,{type:'runtime.execute',payload:{employeeId:created.body.employee.id,employeeTemplateId:'forged-template'}});
  const raw=JSON.parse(f.repo.db.prepare('SELECT payload_json FROM a2a_actions WHERE id=?').get(recovered.id).payload_json);delete raw.employeeTemplateId;
  f.repo.db.prepare('UPDATE a2a_actions SET payload_json=? WHERE id=?').run(JSON.stringify(raw),recovered.id);
  assert.equal(f.repo.listA2AActions(f.workspace.slug).find(row=>row.id===recovered.id).payload.employeeTemplateId,TEMPLATE);
  const foreign=f.repo.createA2AAction(f.otherWorkspace.slug,{type:'runtime.execute',payload:{employeeId:created.body.employee.id,employeeTemplateId:TEMPLATE}});
  assert.equal(Object.hasOwn(foreign.payload,'employeeTemplateId'),false);
});

test('Creator role payload uses current saved configuration, ignores forged roles and preserves terminal history', async t => {
  const f=await fixture(t);const created=await f.install(f.input);assert.equal(created.status,201);
  const employeeId=created.body.employee.id;
  const saved={name:'Saved custom Creator',persona:'Saved personal speaking style',instructions:'Saved custom instructions',description:'Saved custom responsibilities'};
  f.repo.updateEmployee(employeeId,saved);
  const forged={employeeTemplateId:'forged-template',employeePersona:'forged persona',employeeInstructions:'forged instructions',employeeDescription:'forged description',employeeName:'forged name'};
  const sent=await f.request(`/api/conversations/${created.body.conversation.id}/messages`,{content:'Fixture saved role payload',...forged});assert.equal(sent.status,201);
  const task=f.repo.createTask(f.workspace.slug,{title:'Fixture saved role task',employeeId,execute:true,...forged});
  const agent=f.repo.createA2AAction(f.workspace.slug,{type:'agent.execute',payload:{employeeId,...forged}});
  const runtime=f.repo.createA2AAction(f.workspace.slug,{type:'runtime.execute',payload:{employeeId,...forged}});
  const matchesSaved=payload=>{
    assert.equal(payload.employeeTemplateId,TEMPLATE);assert.equal(payload.employeeName,saved.name);
    assert.equal(payload.employeePersona,saved.persona);assert.equal(payload.employeeInstructions,saved.instructions);assert.equal(payload.employeeDescription,saved.description);
  };
  const actions=f.repo.listA2AActions(f.workspace.slug).filter(row=>row.payload.employeeId===employeeId);
  assert.equal(actions.length,4);for(const action of actions)matchesSaved(action.payload);
  assert.ok(actions.some(row=>row.task_id===task.id));matchesSaved(agent.payload);matchesSaved(runtime.payload);
  const terminalBefore=f.repo.db.prepare('SELECT payload_json FROM a2a_actions WHERE id=?').get(runtime.id).payload_json;
  f.repo.db.prepare("UPDATE a2a_actions SET status='succeeded' WHERE id=?").run(runtime.id);
  f.repo.db.prepare("UPDATE a2a_actions SET status='acked' WHERE id=?").run(agent.id);
  saved.persona='Updated saved speaking style';saved.instructions='Updated saved operating rules';saved.description='Updated saved responsibilities';
  f.repo.updateEmployee(employeeId,saved);
  const refreshed=f.repo.listA2AActions(f.workspace.slug,{status:'all'}).filter(row=>row.payload.employeeId===employeeId);
  for(const action of refreshed)if(action.status!=='succeeded')matchesSaved(action.payload);
  assert.deepEqual(refreshed.find(row=>row.id===runtime.id).payload,JSON.parse(terminalBefore));
  const normal=f.repo.createEmployee(f.workspace.slug,{name:'Ordinary fixture role',runtime:'Hermes',runtimeProfile:'default',targetDeviceId:'creator-pc',ownerUserId:f.member.user_id});
  const ordinary=f.repo.createA2AAction(f.workspace.slug,{type:'agent.execute',payload:{employeeId:normal.id,...forged}});
  const foreign=f.repo.createA2AAction(f.otherWorkspace.slug,{type:'runtime.execute',payload:{employeeId,...forged}});
  for(const action of [ordinary,foreign])for(const key of ['employeeTemplateId','employeePersona','employeeInstructions','employeeDescription'])assert.equal(Object.hasOwn(action.payload,key),false);
});

test('Creator second chat receives its own prior request and completed assistant IDs as reference only', async t => {
  const f=await fixture(t);const installed=await f.install(f.input);assert.equal(installed.status,201);
  const {employee,conversation}=installed.body;
  const first=await f.request(`/api/conversations/${conversation.id}/messages`,{content:'Create the isolated worker from my first request.'});assert.equal(first.status,201);
  f.repo.resultA2AAction(first.body.execution.id,{status:'succeeded',result:{output:'Created employee_history_fixture and task_history_fixture. Action action_history_fixture completed.'}});
  const qa=f.repo.createConversation(f.workspace.slug,{employeeId:employee.id,title:'Other independent QA chat'});
  f.repo.addConversationMessage(qa.id,{role:'user',content:'OTHER_QA_CONVERSATION_DO_NOT_IMPORT',dispatch:false});
  f.repo.addConversationMessage(conversation.id,{role:'system',content:'SYSTEM_MESSAGE_DO_NOT_IMPORT',dispatch:false});
  const second=await f.request(`/api/conversations/${conversation.id}/messages`,{content:'Read back the worker and task IDs from our previous reply.'});assert.equal(second.status,201);
  const payload=second.body.execution.payload;
  assert.match(payload.prompt,/Create the isolated worker from my first request/);
  assert.match(payload.prompt,/employee_history_fixture/);assert.match(payload.prompt,/task_history_fixture/);assert.match(payload.prompt,/action_history_fixture/);
  assert.doesNotMatch(payload.prompt,/OTHER_QA_CONVERSATION_DO_NOT_IMPORT|SYSTEM_MESSAGE_DO_NOT_IMPORT/);
  assert.match(payload.prompt,/历史.*不.*授权/);assert.match(payload.prompt,/\[当前用户请求\]\nRead back the worker and task IDs from our previous reply\.$/);
  assert.equal(payload.prompt.split('Read back the worker and task IDs from our previous reply.').length-1,1);
  assert.equal(payload.messageId,second.body.id);
});

test('Creator history is bounded and ordinary employee chat keeps current-request behavior', async t => {
  const f=await fixture(t);const installed=await f.install(f.input);assert.equal(installed.status,201);
  const conversation=installed.body.conversation;
  for(let index=0;index<22;index++)f.repo.addConversationMessage(conversation.id,{role:index%2?'assistant':'user',content:`history_${index} `+'x'.repeat(1800),dispatch:false});
  const sent=await f.request(`/api/conversations/${conversation.id}/messages`,{content:'CURRENT_HISTORY_BOUND_REQUEST'});assert.equal(sent.status,201);
  const history=sent.body.execution.payload.prompt.split('[历史会话记录 JSON]\n')[1]?.split('\n[当前用户请求]')[0];
  assert.ok(history);assert.ok(history.length<=12000);const entries=JSON.parse(history);assert.ok(entries.length<=16);assert.ok(entries.length>0);
  assert.equal(entries.some(row=>row.content.includes('CURRENT_HISTORY_BOUND_REQUEST')),false);
  assert.equal(entries.some(row=>row.content.includes('history_0 ')),false);assert.ok(entries.some(row=>row.content.includes('history_21 ')));
  const ordinary=f.repo.createEmployee(f.workspace.slug,{name:'Ordinary no history',runtime:'Hermes',runtimeProfile:'default',targetDeviceId:'creator-pc',ownerUserId:f.member.user_id});
  const ordinaryChat=f.repo.createConversation(f.workspace.slug,{employeeId:ordinary.id});
  f.repo.addConversationMessage(ordinaryChat.id,{role:'assistant',content:'ORDINARY_PAST_SHOULD_STAY_OUT',dispatch:false});
  const normal=await f.request(`/api/conversations/${ordinaryChat.id}/messages`,{content:'Ordinary current request'});assert.equal(normal.status,201);
  assert.doesNotMatch(normal.body.execution.payload.prompt,/ORDINARY_PAST_SHOULD_STAY_OUT|历史会话记录/);
});

test('Creator task conversation binding rejects another employee or workspace before any task write', async t => {
  const f=await fixture(t);const installed=await f.install(f.input);assert.equal(installed.status,201);
  const other=f.repo.createEmployee(f.workspace.slug,{name:'Other bound employee',runtime:'Hermes',targetDeviceId:'creator-pc',ownerUserId:f.member.user_id});
  const wrongEmployee=f.repo.createConversation(f.workspace.slug,{employeeId:other.id});
  const foreign=f.repo.createConversation(f.otherWorkspace.slug,{title:'Foreign history'});
  const before=f.repo.db.prepare('SELECT COUNT(*) AS count FROM tasks').get().count;
  for(const conversationId of [wrongEmployee.id,foreign.id])assert.throws(()=>f.repo.createTask(f.workspace.slug,{title:'Reject unsafe Creator history binding',employeeId:installed.body.employee.id,conversationId,execute:true}),/Creator.*会话.*不一致/);
  assert.equal(f.repo.db.prepare('SELECT COUNT(*) AS count FROM tasks').get().count,before);
  const task=f.repo.createTask(f.workspace.slug,{title:'Valid Creator task binding',employeeId:installed.body.employee.id,conversationId:installed.body.conversation.id,execute:true});
  const action=f.repo.listA2AActions(f.workspace.slug).find(row=>row.task_id===task.id);assert.ok(action);assert.doesNotMatch(action.payload.prompt,/历史会话记录/);
});
