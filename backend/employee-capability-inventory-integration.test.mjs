import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {IncomingMessage,ServerResponse} from 'node:http';
import {Duplex} from 'node:stream';
import {createRepository} from './repository.mjs';
import {createAuthService} from './auth.mjs';
import {createApp} from './app.mjs';
import {ActionDispatcher} from '../src/daemon.mjs';
import {createLocalActionExecutor} from '../src/local-action.mjs';
import {createMachineCapabilityInventory} from '../src/employee-capability-inventory.mjs';
import {executionBinding} from '../src/execution-admission.mjs';
import {EMPLOYEE_CAPABILITY_INSPECTION_FEATURE} from './employee-capability-inventory.mjs';

const SLUG='inventory-integration';
const FIXTURES='D:/AINavtie/ops/ziwei/employee-capability-inventory-rollout-20261027/test-fixtures';
function request(app,url,{cookie='',token='',method='GET',body}={}){
 const socket=new Duplex({read(){},write(_chunk,_encoding,done){done();}}),req=new IncomingMessage(socket),res=new ServerResponse(req),chunks=[],bytes=body===undefined?null:Buffer.from(JSON.stringify(body));
 req.method=method;req.url=url;req.headers={host:'inventory.fixture',cookie,...(token?{'x-ziwei-device-token':token}:{}),...(bytes?{'content-type':'application/json','content-length':String(bytes.length)}:{})};
 return new Promise((resolve,reject)=>{
  res.write=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));done?.();return true;};
  res.end=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));done?.();const text=Buffer.concat(chunks).toString();resolve({status:res.statusCode,headers:res.getHeaders(),json:text?JSON.parse(text):null});res.emit('finish');socket.destroy();return res;};
  req.on('error',reject);res.on('error',reject);app.handle(req,res,error=>reject(error||new Error('Unhandled isolated inventory route')));if(bytes)req.push(bytes);req.push(null);
 });
}
function fixture(t,{feature=true,features,kind='team'}={}){
 fs.mkdirSync(FIXTURES,{recursive:true});const root=fs.mkdtempSync(path.join(FIXTURES,'case-'));
 assert.ok(path.resolve(root).startsWith(path.resolve(FIXTURES)+path.sep));
 const repo=createRepository({memory:true}),db=repo.db,auth=createAuthService(db),owner=auth.setup({email:'inventory-owner@fixture.invalid',password:'fixture-owner-password'});
 auth.createWorkspace(owner.user_id,{slug:SLUG,name:'Inventory integration',kind});
 const member=auth.register({email:'inventory-member@fixture.invalid',password:'fixture-member-password'}),ws=repo.getWorkspace(SLUG);
 db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run('fixture-member',ws.id,member.user_id,'Member','member@fixture.invalid','member',new Date().toISOString());
 const pair=repo.claimDevicePairing({code:repo.createDevicePairing(SLUG,{createdBy:owner.user_id,name:'Inventory isolated device'}).code});
 repo.heartbeatDevice(SLUG,{deviceId:pair.deviceId,os:'Windows',runtimeDiscovery:{features:features??(feature?[EMPLOYEE_CAPABILITY_INSPECTION_FEATURE]:[])},runtimes:{Hermes:{status:'available',version:'fixture',profiles:[{name:'same-profile'}]}}});
 const actor={actorUserId:owner.user_id,actorRole:'owner'},employee=repo.createEmployee(SLUG,{name:'First isolated employee',runtime:'Hermes',runtimeProfile:'same-profile',targetDeviceId:pair.deviceId,ownerUserId:owner.user_id},actor);
 const hermesHome=path.join(root,'hermes'),profileHome=path.join(hermesHome,'profiles','same-profile'),project=path.join(root,'project');
 fs.mkdirSync(path.join(profileHome,'skills','local'),{recursive:true});fs.mkdirSync(project,{recursive:true});
 fs.writeFileSync(path.join(profileHome,'skills','local','SKILL.md'),'---\nname: fixture-local\ndescription: Safe metadata\n---\nPRIVATE_SKILL_BODY_NEVER_LEAK\n');
 fs.writeFileSync(path.join(profileHome,'config.yaml'),'mcp_servers:\n  fixture-service:\n    command: NEVER_EXECUTE_MCP\n    env:\n      TOKEN: PRIVATE_MCP_TOKEN_NEVER_LEAK\n');
 const app=createApp({memory:true,requireAuth:true,requireDeviceAuth:true,enableScheduler:false,repository:repo,auth});
 const url=id=>`/api/workspaces/${SLUG}/employees/${id}/capability-inventory`,cookie=`ziwei_session=${owner.session.token}`,memberCookie=`ziwei_session=${member.session.token}`;
 const counts=()=>Object.fromEntries(['a2a_actions','tasks','conversations','hermes_bots'].map(table=>[table,db.prepare(`SELECT count(*) n FROM ${table}`).get().n]));
 const read=(id=employee.id,c=cookie)=>request(app,url(id),{cookie:c});
 const refresh=(id=employee.id,{body={},c=cookie}={})=>request(app,url(id)+'/refresh',{method:'POST',cookie:c,body});
 const deviceRequest=(id,suffix,body={},token=pair.deviceToken)=>request(app,`/a2a/v1/actions/${id}/${suffix}`,{method:'POST',token,body:{workspace:SLUG,...body}});
 const execute=createLocalActionExecutor({runtimeDir:path.join(root,'runtime'),defaultWorkdir:project,hermesHomePath:hermesHome,workspace:SLUG,deviceId:pair.deviceId,deviceToken:pair.deviceToken,apiBase:'https://inventory.fixture',admissionHandledByDispatcher:true,machineCapabilityInventory:createMachineCapabilityInventory({npmRoots:[]})});
 const calls=[];
 t.mock.method(globalThis,'fetch',async(url,options={})=>{
  const parsed=new URL(url);assert.equal(parsed.origin,'https://inventory.fixture');assert.match(parsed.pathname,/^\/a2a\/v1\/actions\/action_[a-f0-9-]{36}\/execution-admission$/);
  calls.push({method:options.method,path:parsed.pathname});const r=await request(app,parsed.pathname,{method:options.method,token:options.headers['x-ziwei-device-token'],body:JSON.parse(options.body)});return Response.json(r.json,{status:r.status});
 });
 const dispatcher=new ActionDispatcher({execute,authorizeExecute:execute.authorizeExecution,workdir:project,workspace:SLUG,deviceId:pair.deviceId});
 const dispatch=async id=>{
  const ack=await deviceRequest(id,'ack');assert.equal(ack.status,200,JSON.stringify(ack.json));
  const polled=await request(app,`/a2a/v1/actions?workspace=${SLUG}&status=all`,{token:pair.deviceToken});assert.equal(polled.status,200);
  const action=polled.json.actions.find(value=>value.id===id);assert.ok(action,'dispatch the authenticated execution projection, not the historical API view');
  const admission=await deviceRequest(id,'execution-admission');assert.equal(admission.status,200);assert.equal(admission.json.executionBinding,executionBinding(action));
  const result=await dispatcher.dispatch(action);return{result,action};
 };
 t.after(async()=>{await execute.close();db.close();fs.rmSync(root,{recursive:true,force:true});});
 return{repo,db,auth,app,owner,member,actor,employee,pair,ws,root,profileHome,counts,url,cookie,memberCookie,read,refresh,deviceRequest,dispatch,calls};
}

test('real cached HTTP GET admits no work; explicit refresh completes via dispatcher, native file collector and authenticated result',async t=>{
 const f=fixture(t),before=f.counts();
 for(let i=0;i<3;i++){const read=await f.read();assert.equal(read.status,200);assert.equal(read.json.status,'unknown');assert.equal(read.headers['cache-control'],'no-store');}
 assert.deepEqual(f.counts(),before);
 const refreshed=await f.refresh();assert.equal(refreshed.status,202);const id=refreshed.json.pending.actionId;
 const repeated=await f.refresh();assert.equal(repeated.json.pending.actionId,id);
 assert.equal(f.repo.getA2AAction(id).type,'employee.capabilities.inspect');assert.equal(f.repo.getA2AAction(id).payload.prompt,undefined);
 const {result}=await f.dispatch(id);assert.equal(result.status,'succeeded',JSON.stringify(result));assert.equal(result.result.employeeCapabilities.subject.employeeId,f.employee.id);
 const completed=await f.deviceRequest(id,'result',{status:'succeeded',result:result.result});assert.equal(completed.status,200,JSON.stringify(completed.json));
 const view=await f.read();assert.equal(view.json.status,'ready');assert.equal(view.json.sections.skills.items[0].name,'fixture-local');assert.equal(view.json.sections.mcp.items[0].loaded,'unknown');assert.equal(view.json.sections.mcp.items[0].authorization,'unknown');
 for(const secret of ['PRIVATE_SKILL_BODY_NEVER_LEAK','PRIVATE_MCP_TOKEN_NEVER_LEAK','NEVER_EXECUTE_MCP',f.profileHome])assert.equal(JSON.stringify(view.json).includes(secret),false);
 assert.equal(f.calls.length,1);assert.deepEqual(f.counts(),{...before,a2a_actions:before.a2a_actions+1});
});

test('anonymous and non-owner personal access are denied without creating inspections',async t=>{
 const f=fixture(t);f.repo.updateEmployee(f.employee.id,{visibility:'personal'},f.actor);const before=f.counts();
 assert.equal((await request(f.app,f.url(f.employee.id))).status,401);
 assert.equal((await request(f.app,f.url(f.employee.id)+'/refresh',{method:'POST',body:{}})).status,401);
 for(const response of [await f.read(f.employee.id,f.memberCookie),await f.refresh(f.employee.id,{c:f.memberCookie})])assert.ok([403,404].includes(response.status),JSON.stringify(response));
 const forbidden=await request(f.app,`/api/workspaces/${SLUG}/employees/${f.employee.id}/capability-inventory`,{cookie:`ziwei_session=${f.auth.register({email:'outsider@fixture.invalid',password:'fixture-outsider-password'}).session.token}`});
 assert.equal(forbidden.status,403);assert.deepEqual(f.counts(),before);
});

test('two employee IDs with the same native profile cannot adopt each other inventory evidence',async t=>{
 const f=fixture(t),second=f.repo.createEmployee(SLUG,{name:'Second isolated employee',runtime:'Hermes',runtimeProfile:'same-profile',targetDeviceId:f.pair.deviceId,ownerUserId:f.owner.user_id},f.actor);
 const r=await f.refresh(),id=r.json.pending.actionId,{result}=await f.dispatch(id);assert.equal(result.status,'succeeded');assert.equal((await f.deviceRequest(id,'result',{status:'succeeded',result:result.result})).status,200);
 assert.equal((await f.read()).json.status,'ready');const other=await f.read(second.id);assert.equal(other.json.snapshot,null);assert.equal(other.json.status,'unknown');
 const secondRefresh=await f.refresh(second.id);assert.notEqual(secondRefresh.json.pending.actionId,id);assert.equal(f.repo.getA2AAction(secondRefresh.json.pending.actionId).payload.capabilityInspection.subject.employeeId,second.id);
});

test('an old client capability returns explicit unknown through HTTP and creates no action',async t=>{
 const f=fixture(t,{feature:false}),before=f.counts();const response=await f.refresh();assert.equal(response.status,202);assert.equal(response.json.status,'unknown');assert.equal(response.json.reasonCode,'CLIENT_NOT_REPORTED');assert.equal(response.json.pending,null);assert.deepEqual(f.counts(),before);
});

test('a legacy v1 advertisement alone cannot authorize the new complete inventory implementation',async t=>{
 const f=fixture(t,{features:['employee_capabilities_inspect_v1']}),before=f.counts();
 const response=await f.refresh();assert.equal(response.status,202);assert.equal(response.json.reasonCode,'CLIENT_NOT_REPORTED');assert.equal(response.json.pending,null);assert.deepEqual(f.counts(),before);
});

test('a pending complete-inspection request is fenced if the target loses the negotiated capability before ACK',async t=>{
 const f=fixture(t),r=await f.refresh(),id=r.json.pending.actionId;
 f.repo.heartbeatDevice(SLUG,{deviceId:f.pair.deviceId,runtimeDiscovery:{features:['employee_capabilities_inspect_v1']}});
 const ack=await f.deviceRequest(id,'ack');assert.equal(ack.status,409);assert.equal(ack.json.code,'EMPLOYEE_CAPABILITIES_CLIENT_NOT_REPORTED');assert.equal(f.repo.getA2AAction(id).status,'pending');assert.equal(f.calls.length,0);
});

test('an ACKed request cannot run after a target capability downgrade',async t=>{
 const f=fixture(t),r=await f.refresh(),id=r.json.pending.actionId;assert.equal((await f.deviceRequest(id,'ack')).status,200);
 f.repo.heartbeatDevice(SLUG,{deviceId:f.pair.deviceId,runtimeDiscovery:{features:['employee_capabilities_inspect_v1']}});
 const admission=await f.deviceRequest(id,'execution-admission');assert.equal(admission.status,409);assert.equal(admission.json.code,'EMPLOYEE_CAPABILITIES_CLIENT_NOT_REPORTED');assert.equal(f.calls.length,0);
});

test('configuration and Bot revision changes fence ACK and authenticated execution admission',async t=>{
 const f=fixture(t),r=await f.refresh(),id=r.json.pending.actionId;
 f.repo.updateEmployee(f.employee.id,{runtimeProfile:'changed-profile'},f.actor);
 const ack=await f.deviceRequest(id,'ack');assert.equal(ack.status,409);assert.equal(ack.json.code,'EMPLOYEE_CAPABILITIES_SUBJECT_CHANGED');assert.equal(f.calls.length,0);
 f.repo.updateEmployee(f.employee.id,{runtimeProfile:'same-profile'},f.actor);assert.equal((await f.deviceRequest(id,'ack')).status,200);
 const stamp=new Date().toISOString();f.db.prepare('INSERT INTO hermes_bots(employee_id,workspace_id,config_json,revision,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(f.employee.id,f.ws.id,'{}',1,stamp,stamp);
 const admission=await f.deviceRequest(id,'execution-admission');assert.equal(admission.status,409);assert.equal(admission.json.code,'EMPLOYEE_CAPABILITIES_SUBJECT_CHANGED');assert.equal(f.calls.length,0);
});

test('an already-collected result after config changes is preserved only as stale history',async t=>{
 const f=fixture(t),r=await f.refresh(),id=r.json.pending.actionId,{result}=await f.dispatch(id);assert.equal(result.status,'succeeded');
 f.repo.updateEmployee(f.employee.id,{skills:['changed-assignment']},f.actor);
 assert.equal((await f.deviceRequest(id,'result',{status:'succeeded',result:result.result})).status,200);
 const view=await f.read();assert.equal(view.json.status,'unknown');assert.equal(view.json.reasonCode,'CONFIGURATION_CHANGED');assert.equal(view.json.snapshot.stale,true);assert.equal(view.json.summary.skills,null);assert.equal(view.json.sections.skills.items.length,0);
});

test('a different device cannot ACK or report another device inspection; raw action route cannot mint one',async t=>{
 const f=fixture(t),r=await f.refresh(),id=r.json.pending.actionId,other=f.repo.claimDevicePairing({code:f.repo.createDevicePairing(SLUG,{createdBy:f.owner.user_id,name:'Other fixture device'}).code});
 for(const suffix of ['ack','execution-admission','result']){const response=await f.deviceRequest(id,suffix,{status:'succeeded',result:{}},other.deviceToken);assert.ok([400,403].includes(response.status),JSON.stringify(response));assert.match(response.json.error,/another device|设备/);}
 assert.equal(f.repo.getA2AAction(id).status,'pending');
 const action=f.repo.getA2AAction(id),raw=await request(f.app,'/a2a/v1/actions',{method:'POST',token:f.pair.deviceToken,body:{workspace:SLUG,type:'employee.capabilities.inspect',payload:action.payload}});
 assert.equal(raw.status,409);assert.equal(raw.json.code,'EMPLOYEE_CAPABILITIES_ROUTE_REQUIRED');
});

for(const mutation of ['owner-transfer','visibility-revoked'])test(`generic action GET cannot bypass inventory access after ${mutation}`,async t=>{
 const f=fixture(t);
 f.db.prepare('UPDATE employees SET owner_user_id=?,visibility=? WHERE id=?').run(mutation==='owner-transfer'?f.member.user_id:f.owner.user_id,mutation==='owner-transfer'?'personal':'workspace',f.employee.id);
 const refreshed=await f.refresh(f.employee.id,{c:f.memberCookie});assert.equal(refreshed.status,202);const id=refreshed.json.pending.actionId,{result}=await f.dispatch(id);
 assert.equal(result.status,'succeeded');assert.equal((await f.deviceRequest(id,'result',{status:'succeeded',result:result.result})).status,200);
 const actionUrl=`/api/workspaces/${SLUG}/actions/${id}`;
 assert.equal((await request(f.app,actionUrl,{cookie:f.memberCookie})).status,200);
 f.db.prepare("UPDATE employees SET owner_user_id=?,visibility='personal' WHERE id=?").run(f.owner.user_id,f.employee.id);
 assert.equal((await f.read(f.employee.id,f.memberCookie)).status,404);
 const hidden=await request(f.app,actionUrl,{cookie:f.memberCookie});assert.equal(hidden.status,404);assert.equal(JSON.stringify(hidden.json).includes('fixture-local'),false);assert.equal(JSON.stringify(hidden.json).includes('capabilityInspection'),false);
});

for(const phase of ['ack','execution-admission'])test(`personal workspace device ownership is rechecked after the requester is demoted before ${phase}`,async t=>{
 const f=fixture(t,{kind:'personal'});
 f.db.prepare('UPDATE devices SET owner_user_id=? WHERE id=?').run(f.member.user_id,f.pair.deviceId);
 const r=await f.refresh();assert.equal(r.status,202);const id=r.json.pending.actionId;
 if(phase==='execution-admission')assert.equal((await f.deviceRequest(id,'ack')).status,200);
 f.db.prepare("UPDATE members SET role='member' WHERE workspace_id=? AND user_id=?").run(f.ws.id,f.owner.user_id);
 assert.equal((await f.read()).status,403);
 const response=await f.deviceRequest(id,phase);assert.equal(response.status,403);assert.equal(response.json.code,'EMPLOYEE_CAPABILITIES_AUTHORITY_REVOKED');assert.equal(f.calls.length,0);
});

test('generic inventory HTTP read projects authenticated device result and event extras while dedicated GET keeps safe sections',async t=>{
 const f=fixture(t),r=await f.refresh(),id=r.json.pending.actionId,{result}=await f.dispatch(id),secret='DEVICE_SUPPLIED_RAW_SECRET_MUST_NOT_LEAK';
 assert.equal((await f.deviceRequest(id,'events',{type:secret,message:secret,data:{apiKey:secret,rawConfig:{token:secret},output:secret}})).status,202);
 result.result.apiKey=secret;result.result.rawConfig={password:secret};result.result.output=secret;result.result.employeeCapabilities.rawSecret=secret;result.result.employeeCapabilities.sections.skills.items[0].rawSecret=secret;
 assert.equal((await f.deviceRequest(id,'result',{status:'succeeded',result:result.result})).status,200);
 const dedicated=await f.read();assert.equal(dedicated.json.status,'ready');assert.equal(dedicated.json.sections.skills.items[0].name,'fixture-local');
 const view=await request(f.app,`/api/workspaces/${SLUG}/actions/${id}`,{cookie:f.cookie});assert.equal(view.status,200);
 assert.equal(JSON.stringify(view.json).includes(secret),false);
 assert.equal(view.json.result.employeeCapabilities.sections.skills.items[0].name,'fixture-local');
 assert.equal(view.json.dedupe_key,f.repo.getA2AAction(id).dedupe_key);assert.deepEqual(view.json.payload.capabilityInspection.subject,dedicated.json.subject);
 for(const field of ['apiKey','rawConfig','rawSecret','output'])assert.equal(JSON.stringify(view.json).includes('"'+field+'"'),false);
 // Source receipt and diagnostic events remain intact for device/history storage.
 assert.equal(f.repo.getA2AAction(id).result.rawConfig.password,secret);
 assert.ok(f.repo.getA2AAction(id).events.some(event=>event.message===secret));
});

test('generic failed inventory HTTP read does not return raw device error, output or event diagnostic',async t=>{
 const f=fixture(t),r=await f.refresh(),id=r.json.pending.actionId,secret='RAW_FAILURE_CREDENTIAL_DIAGNOSTIC_MUST_NOT_LEAK';
 assert.equal((await f.deviceRequest(id,'ack')).status,200);
 assert.equal((await f.deviceRequest(id,'events',{type:'progress',message:secret,data:{rawSecret:secret}})).status,202);
 assert.equal((await f.deviceRequest(id,'result',{status:'failed',error:secret,result:{output:secret,rawSecret:secret}})).status,200);
 const view=await request(f.app,`/api/workspaces/${SLUG}/actions/${id}`,{cookie:f.cookie});assert.equal(view.status,200);
 assert.equal(view.json.status,'failed');assert.equal(JSON.stringify(view.json).includes(secret),false);assert.equal(view.json.result,null);
 assert.equal(f.repo.getA2AAction(id).error,secret);assert.equal(f.repo.getA2AAction(id).result.output,secret);
});

test('generic non-inventory HTTP read retains its original result error and events',async t=>{
 const f=fixture(t),secret='UNRELATED_ACTION_ORIGINAL_DIAGNOSTIC',action=f.repo.createA2AAction(SLUG,{type:'fixture.diagnostic',payload:{deviceId:f.pair.deviceId},dedupeKey:'unrelated-diagnostic'}),id=action.id;
 assert.equal((await f.deviceRequest(id,'ack')).status,200);
 assert.equal((await f.deviceRequest(id,'events',{type:'progress',message:secret,data:{rawSecret:secret}})).status,202);
 assert.equal((await f.deviceRequest(id,'result',{status:'failed',error:secret,result:{output:secret}})).status,200);
 const view=await request(f.app,`/api/workspaces/${SLUG}/actions/${id}`,{cookie:f.cookie});assert.equal(view.status,200);
 assert.equal(view.json.error,secret);assert.equal(view.json.result.output,secret);assert.ok(view.json.events.some(event=>event.message===secret));
});
