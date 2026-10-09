import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../backend/app.mjs';
import { createMcpClient,toolDefinitions as managementTools } from '../scripts/ziwei-mcp.mjs';

async function fixture(t) {
  const realFetch = globalThis.fetch; const upstream = [];const state={statusFailure:false,commandStatus:'succeeded',missingSnapshot:false,commandResponseFailure:false};
  globalThis.fetch = async (url, init = {}) => {
    if(String(url)==='https://qzelynth.top/downloads/android/index.json') return new Response(JSON.stringify({releases:[{versionCode:2,versionName:'0.2.0',packages:{agent:{path:'agent.apk',sha256:'a'.repeat(64),signerSha256:'b'.repeat(64)}}}]}),{status:200,headers:{'content-type':'application/json'}});
    if (!String(url).startsWith('http://127.0.0.1:5199/api')) return realFetch(url, init);
    const path = new URL(url).pathname; upstream.push({ path, method:init.method || 'GET', body:init.body ? JSON.parse(init.body) : null });
    if(state.commandResponseFailure && path.endsWith('/commands')) throw new Error('isolated command response failure');
    if(state.statusFailure && path.endsWith('/status')) throw new Error('isolated response read failure');
    const device = { id:'phone-one', alias:'QA phone', nodes:[{role:'agent',status:'online',versionCode:1}], commands:[{id:'command-one',status:state.commandStatus}],updates:[{id:'update-one',status:'succeeded'}] };
    const body = path.endsWith('/android-devices') ? { devices:[device,{id:'phone-other',nodes:[]}] } : path.endsWith('/enrollment-requests') ? {requests:[{id:'request-one',deviceId:'phone-one'},{id:'request-other',deviceId:'phone-other'},{id:'request-unknown',alias:'QA phone'}]} : path.endsWith('/commands') ? {command:{id:'command-one',status:'queued'}} : path.endsWith('/updates') ? {update:{id:'update-one',status:'queued'}} : path.endsWith('/snapshot') ? {snapshot:state.missingSnapshot?null:{mime:'image/jpeg',data:'aW1hZ2U='}} : {device};
    return new Response(JSON.stringify(body), {status:200,headers:{'content-type':'application/json'}});
  };
  const app = createApp({ memory:true, enableScheduler:false, ziweiConnectApiBase:'http://127.0.0.1:5199/api', mcpOptions:{token:'owner-builder-token',workspaces:['test-111','phone_ai']} });
  const server=app.listen(0); await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>{server.close();globalThis.fetch=realFetch;});
  const base=`http://127.0.0.1:${server.address().port}`; const repo=app.locals.repo;
  const device=repo.claimDevicePairing({code:repo.createDevicePairing('test-111',{name:'shared QA pc'}).code});
  repo.heartbeatDevice('test-111',{deviceId:device.deviceId,terminalMcp:{configured:true,workspace:'test-111',supportedRuntimes:['Codex','Hermes']},runtimes:{Codex:{status:'available',version:'1',readiness:{ready:true,authentication:'configured',provider:'configured'},profiles:[{name:'default'}]},Hermes:{status:'available',version:'2',profiles:[{name:'qa-independent',provider_configured:true,authentication_configured:true}]}}});
  const employee=repo.createEmployee('test-111',{name:'phone QA',runtime:'Codex',targetDeviceId:device.deviceId,persona:'retain persona',instructions:'retain instructions',skills:['skill-code'],status:'active'});
  const request=async(path,body,method=body?'POST':'GET',headers={})=>{const response=await realFetch(base+path,{method,headers:{'content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});return{status:response.status,body:await response.json()};};
  return {app,repo,base,request,upstream,employee,device,state};
}
async function configured(t) {const f=await fixture(t);const skill=f.repo.listSkills('test-111').find(row=>row.catalog_id==='ziwei-phone-control');f.repo.setSkillInstalled(skill.id,true);const route=`/api/workspaces/test-111/employees/${f.employee.id}/phone-mcp`;await f.request(route,{enabled:true,phoneDeviceId:'phone-one',targetDeviceId:f.device.deviceId,runtime:'Codex'},'PUT');return{...f,skill,route};}
async function capability(f,check=false) {const trial=await f.request(f.route+(check?'/check':'/trial'),{action:'screenshot',idempotencyKey:check?'check-one':'trial-one'});assert.equal(trial.status,202);const action=trial.body.action;f.repo.ackA2AAction(action.id,{deviceId:f.device.deviceId});const response=await f.request('/api/workspaces/test-111/terminal-mcp/bootstrap',{employeeId:f.employee.id,deviceId:'phone-one',actionId:action.id},'POST',{'x-ziwei-device-token':f.device.deviceToken});assert.equal(response.status,200);const call=(name,args={})=>f.request(`/terminal-mcp/v1/workspaces/test-111/employees/${f.employee.id}/call`,{name,arguments:args},'POST',{authorization:'Bearer '+response.body.token});return{...response.body,action,call};}
test('phone platform skill has real catalog version and uninstall preserves employee persona and other skills',async t=>{
  const f=await fixture(t); const skills=await f.request('/api/workspaces/test-111/skills');
  const skill=skills.body.skills.find(row=>row.catalog_id==='ziwei-phone-control');
  assert.ok(skill,'phone MCP is registered in the platform catalog'); assert.equal(skill.scope,'platform');assert.equal(skill.integration.kind,'phone_mcp');
  assert.equal((await f.request('/api/skills/'+skill.id,{installed:true},'PATCH')).status,200);
  const config=await f.request(`/api/workspaces/test-111/employees/${f.employee.id}/phone-mcp`,{enabled:true,phoneDeviceId:'phone-one',targetDeviceId:f.device.deviceId,runtime:'Codex',runtimeProfile:null},'PUT');
  assert.equal(config.status,200);assert.equal(config.body.configuration.enabled,true);
  assert.ok(f.repo.listSkillVersions(skill.id).some(row=>row.version===skill.version));
  await f.request(`/api/skills/${skill.id}/uninstall`,{});
  const employee=f.repo.listEmployees('test-111').find(row=>row.id===f.employee.id);assert.deepEqual(employee.skills,['skill-code']);assert.equal(employee.persona,'retain persona');assert.equal(employee.instructions,'retain instructions');
  assert.equal(f.app.locals.ziweiConnect.listBindings('test-111').length,1);
  const task=f.repo.createTask('test-111',{title:'after uninstall',employeeId:employee.id,execute:true});assert.equal(task.execution?.payload?.terminalMcp,undefined);
});
test('phone configuration refuses uninstalled skill and unknown phone without partially changing employee',async t=>{
  const f=await fixture(t);const route=`/api/workspaces/test-111/employees/${f.employee.id}/phone-mcp`;
  const input={enabled:true,phoneDeviceId:'phone-one',targetDeviceId:f.device.deviceId,runtime:'Codex'};
  assert.equal((await f.request(route,input,'PUT')).body.code,'PHONE_SKILL_NOT_INSTALLED');
  const skill=f.repo.listSkills('test-111').find(row=>row.catalog_id==='ziwei-phone-control');f.repo.setSkillInstalled(skill.id,true);
  assert.equal((await f.request(route,{...input,phoneDeviceId:'unlisted'},'PUT')).status,404);
  assert.equal(f.app.locals.ziweiConnect.listBindings('test-111').length,0);
});
test('bootstrap grants only exact employee phone and execution and configuration changes revoke capabilities',async t=>{
  const f=await fixture(t);const skill=f.repo.listSkills('test-111').find(row=>row.catalog_id==='ziwei-phone-control');f.repo.setSkillInstalled(skill.id,true);
  const route=`/api/workspaces/test-111/employees/${f.employee.id}/phone-mcp`;await f.request(route,{enabled:true,phoneDeviceId:'phone-one',targetDeviceId:f.device.deviceId,runtime:'Codex'},'PUT');
  const trial=await f.request(route+'/trial',{action:'screenshot',idempotencyKey:'phone-trial-one'});assert.equal(trial.status,202);const action=trial.body.action;assert.equal(action.payload.terminalMcp.deviceId,'phone-one');assert.equal(action.payload.deviceId,f.device.deviceId);
  f.repo.ackA2AAction(action.id,{deviceId:f.device.deviceId});
  const bootstrap=await f.request('/api/workspaces/test-111/terminal-mcp/bootstrap',{employeeId:f.employee.id,deviceId:'phone-one',actionId:action.id},'POST',{'x-ziwei-device-token':f.device.deviceToken});assert.equal(bootstrap.status,200);assert.ok(bootstrap.body.token);
  const call=(args)=>f.request(`/terminal-mcp/v1/workspaces/test-111/employees/${f.employee.id}/call`,{name:'ziwei_phone_list',arguments:args},'POST',{authorization:'Bearer '+bootstrap.body.token});
  const list=await call({});assert.equal(list.status,200);assert.deepEqual(list.body.devices.map(row=>row.id),['phone-one']);
  assert.equal((await f.request(`/terminal-mcp/v1/workspaces/test-111/employees/${f.employee.id}/call`,{name:'ziwei_phone_status',arguments:{deviceId:'phone-other'}},'POST',{authorization:'Bearer '+bootstrap.body.token})).status,403);
  const wrongEmployee=await f.request('/terminal-mcp/v1/workspaces/test-111/employees/other/call',{name:'ziwei_phone_list',arguments:{}},'POST',{authorization:'Bearer '+bootstrap.body.token});assert.equal(wrongEmployee.status,403);
  assert.equal(JSON.stringify(action).includes(bootstrap.body.token),false);
  await f.request(route,{enabled:false},'PUT');assert.equal((await call({})).status,403);
});
test('workspace computer grant requires owner and creates a distinct scoped connection without moving source',async t=>{
  const f=await fixture(t);f.repo.db.prepare('INSERT INTO workspaces(id,slug,name,created_at,kind) VALUES(?,?,?,?,?)').run('ws-phone','phone_ai','phone AI',new Date().toISOString(),'team');
  const input={sourceWorkspace:'test-111',sourceDeviceId:f.device.deviceId};
  assert.equal((await f.request('/api/workspaces/phone_ai/device-workspace-grants',input,'POST',{'x-workspace-role':'member'})).status,403);
  const created=await f.request('/api/workspaces/phone_ai/device-workspace-grants',input,'POST',{'x-workspace-role':'owner'});assert.equal(created.status,201);
  assert.equal(created.body.action.type,'device.workspace.connect');assert.equal(created.body.action.payload.deviceId,f.device.deviceId);assert.equal(JSON.stringify(created.body).includes('zwd_'),false);
  const claim=await f.request('/api/daemon/workspace-grants/'+created.body.grant.id+'/claim',{},'POST',{'x-ziwei-device-token':f.device.deviceToken});assert.equal(claim.status,200);assert.notEqual(claim.body.deviceId,f.device.deviceId);assert.equal(claim.body.workspace,'phone_ai');assert.ok(claim.body.deviceToken);
  assert.equal(f.repo.authenticateDeviceToken(claim.body.deviceToken,{workspaceSlug:'test-111'}),null);assert.ok(f.repo.authenticateDeviceToken(claim.body.deviceToken,{workspaceSlug:'phone_ai'}));assert.ok(f.repo.authenticateDeviceToken(f.device.deviceToken,{workspaceSlug:'test-111'}));
  assert.equal(f.repo.db.prepare('SELECT workspace_id FROM devices WHERE id=?').get(f.device.deviceId).workspace_id,f.employee.workspace_id);
  const retry=await f.request('/api/workspaces/phone_ai/device-workspace-grants',input,'POST',{'x-workspace-role':'owner'});assert.equal(retry.body.grant.id,created.body.grant.id);assert.equal(retry.body.duplicate,true);
  const secondClaim=await f.request('/api/daemon/workspace-grants/'+created.body.grant.id+'/claim',{},'POST',{'x-ziwei-device-token':f.device.deviceToken});assert.equal(secondClaim.body.deviceToken,claim.body.deviceToken);
});
test('all ten phone tools proxy only the bound device and enrollment never uses nicknames',async t=>{
  const f=await configured(t);const cap=await capability(f);
  const calls=[['ziwei_phone_list',{}],['ziwei_phone_status',{deviceId:'phone-one'}],['ziwei_phone_receipt',{deviceId:'phone-one',commandId:'command-one'}],['ziwei_phone_action',{deviceId:'phone-one',action:'launch',args:{packageName:'com.android.settings'}}],['ziwei_phone_screenshot',{deviceId:'phone-one',waitSeconds:0}],['ziwei_phone_control',{deviceId:'phone-one',role:'agent'}],['ziwei_phone_upgrade',{deviceId:'phone-one',targetRole:'agent',versionCode:2,waitSeconds:0}],['ziwei_phone_wait',{deviceId:'phone-one',commandId:'command-one',waitSeconds:1}],['ziwei_enrollment_pending',{}],['ziwei_enrollment_approve',{requestId:'request-one'}]];
  for(const[name,args]of calls){const result=await cap.call(name,args);assert.equal(result.status,200,`${name}: ${JSON.stringify(result.body)}`);if(name==='ziwei_enrollment_pending')assert.deepEqual(result.body.requests.map(row=>row.id),['request-one']);}
  assert.equal((await cap.call('ziwei_enrollment_approve',{requestId:'request-other'})).status,403);assert.equal((await cap.call('ziwei_enrollment_approve',{requestId:'request-unknown'})).status,403);
  for(const action of ['health','tap','swipe','text','global']) assert.equal((await cap.call('ziwei_phone_action',{deviceId:'phone-one',action,args:{}})).status,200);
  const screenshot=await cap.call('ziwei_phone_screenshot',{deviceId:'phone-one',waitSeconds:0});assert.equal(screenshot.body.device.snapshot.mime,'image/jpeg');assert.ok(screenshot.body.command.id);
  assert.equal(f.upstream.some(row=>row.path.includes('/phone-other/')),false);assert.ok(f.upstream.some(row=>row.path.endsWith('/updates')));
});
test('check scope is read-only and changing configuration cannot inherit an old loaded receipt',async t=>{
  const f=await configured(t);const cap=await capability(f,true);assert.equal((await cap.call('ziwei_phone_status',{deviceId:'phone-one'})).status,200);assert.equal((await cap.call('ziwei_phone_action',{deviceId:'phone-one',action:'tap',args:{x:1,y:1}})).status,403);
  f.repo.resultA2AAction(cap.action.id,{deviceId:f.device.deviceId,status:'succeeded',result:{terminalMcp:{loaded:true,injected:true,toolCalls:[{toolName:'ziwei_phone_status',ok:true}]}}});
  assert.equal((await f.request(f.route+'/status')).body.receipt.loaded,true);
  const disabled=await f.request(f.route,{enabled:false},'PUT');assert.equal(disabled.status,200);assert.equal((await f.request(f.route+'/status')).body.receipt.status,'never_run');assert.equal((await cap.call('ziwei_phone_list')).status,403);
});
test('normal employee conversations inject the same current revision and trial retries do not duplicate sessions',async t=>{
  const f=await configured(t);const config=(await f.request(f.route+'/status')).body.configuration;
  const conversation=f.repo.createConversation('test-111',{employeeId:f.employee.id,actorRole:'owner'});const message=f.repo.addConversationMessage(conversation.id,{content:'read phone status',actorRole:'owner'});assert.equal(message.execution.payload.terminalMcp.configurationRevision,config.revision);
  const cap=await capability(f);const retry=await f.request(f.route+'/trial',{action:'screenshot',idempotencyKey:'trial-one'});assert.equal(retry.body.action.id,cap.action.id);assert.equal(retry.body.duplicate,true);
  const denied=await f.request('/api/workspaces/test-111/terminal-mcp/bootstrap',{employeeId:f.employee.id,deviceId:'phone-other',actionId:cap.action.id},'POST',{'x-ziwei-device-token':f.device.deviceToken});assert.equal(denied.status,403);
  f.repo.revokeDeviceCredential(f.device.deviceId);assert.equal((await cap.call('ziwei_phone_list')).status,403);
});
test('accepted phone commands retain their original ID on response failure and never replay',async t=>{
  const f=await configured(t);const cap=await capability(f);f.state.statusFailure=true;const result=await cap.call('ziwei_phone_action',{deviceId:'phone-one',action:'global',args:{key:'back'}});assert.equal(result.status,200);assert.equal(result.body.command.id,'command-one');assert.equal(result.body.command.status,'uncertain');assert.match(result.body.verificationError,/勿重复/);assert.equal(f.upstream.filter(row=>row.path.endsWith('/commands')).length,1);
  assert.equal((await f.request(f.route+'/status')).body.verification.status,'uncertain');
});
test('management builder explicitly selects authorized workspaces and receives the real phone skill contract',async t=>{
  const f=await fixture(t);f.repo.db.prepare('INSERT INTO workspaces(id,slug,name,created_at,kind) VALUES(?,?,?,?,?)').run('ws-phone','phone_ai','phone AI',new Date().toISOString(),'team');
  const client=createMcpClient({baseUrl:f.base,token:'owner-builder-token',workspace:'test-111'});const setup=await client.phoneMcpSetup({workspace:'phone_ai'});assert.equal(setup.workspace,'phone_ai');assert.equal(setup.skill.integration.kind,'phone_mcp');
  assert.ok(managementTools.every(row=>row.inputSchema.properties.workspace));assert.equal((await client.installSkill({workspace:'phone_ai',id:setup.skill.id})).installed,true);
  await assert.rejects(client.phoneMcpSetup({workspace:'unauthorized'}),/没有该工作区权限/);
});
test('phone wait refreshes the original run without replay and screenshots require image evidence',async t=>{
  const f=await configured(t);const cap=await capability(f);f.state.commandStatus='queued';await cap.call('ziwei_phone_action',{deviceId:'phone-one',action:'health',waitSeconds:0});assert.equal((await f.request(f.route+'/status')).body.verification.status,'pending');
  f.state.commandStatus='succeeded';await cap.call('ziwei_phone_wait',{deviceId:'phone-one',commandId:'command-one',waitSeconds:1});assert.equal((await f.request(f.route+'/status')).body.verification.status,'succeeded');assert.equal(f.upstream.filter(row=>row.path.endsWith('/commands')).length,1);
  f.state.missingSnapshot=true;await cap.call('ziwei_phone_screenshot',{deviceId:'phone-one',waitSeconds:0});const missing=await f.request(f.route+'/status');assert.equal(missing.body.verification.status,'failed');assert.match(missing.body.verification.error,/截图/);
});
test('members cannot expand phone bindings and cannot read private employee receipts through legacy routes',async t=>{
  const f=await configured(t);const member={'x-workspace-role':'member'};
  assert.equal((await f.request(f.route,{enabled:true,phoneDeviceId:'phone-other'},'PUT',member)).status,403);
  assert.equal((await f.request('/api/workspaces/test-111/ziwei-connect/bindings',{employeeId:f.employee.id,deviceId:'phone-other'},'POST',member)).status,403);
  f.repo.updateEmployee(f.employee.id,{visibility:'personal',ownerUserId:'private-owner'});
  assert.equal((await f.request(f.route+'/status',undefined,'GET',member)).status,404);
  assert.deepEqual((await f.request('/api/workspaces/test-111/ziwei-connect/bindings',undefined,'GET',member)).body.bindings,[]);
  assert.deepEqual((await f.request('/api/workspaces/test-111/ziwei-connect/status',undefined,'GET',member)).body.bindings,[]);
});
test('platform skill rollback remains selected after catalog reads and retains its installed history',async t=>{
  const f=await configured(t);const original=f.skill;const old='# historical phone skill';const hash='f'.repeat(64);
  f.repo.db.prepare('INSERT INTO skill_versions(id,skill_id,version,content,content_hash,metadata_json,created_at) VALUES(?,?,?,?,?,?,?)').run('historical-phone-version',original.id,'0.9.0',old,hash,JSON.stringify({name:original.name,description:original.description,category:original.category}),new Date().toISOString());
  f.repo.rollbackSkill(original.id,'historical-phone-version');const listed=f.repo.listSkills('test-111').find(row=>row.id===original.id);assert.equal(listed.version,'0.9.0');assert.equal(listed.content,old);assert.equal(listed.integration.kind,'phone_mcp');assert.equal(listed.installed,true);
});
test('a lost command submission response is explicitly uncertain and is never retried',async t=>{
  const f=await configured(t);const cap=await capability(f);f.state.commandResponseFailure=true;
  const result=await cap.call('ziwei_phone_action',{deviceId:'phone-one',action:'tap',args:{x:1,y:1}});assert.equal(result.status,502);assert.match(result.body.error,/不确定.*勿重复/);assert.equal(f.upstream.filter(row=>row.path.endsWith('/commands')).length,1);assert.equal((await f.request(f.route+'/status')).body.verification.status,'uncertain');
});
