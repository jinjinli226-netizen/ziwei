import test from 'node:test';
import assert from 'node:assert/strict';
import {IncomingMessage,ServerResponse} from 'node:http';
import {Duplex} from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRepository} from './repository.mjs';
import {createAuthService} from './auth.mjs';
import {createApp} from './app.mjs';
import {createLocalActionExecutor} from '../src/local-action.mjs';
import {ActionDispatcher} from '../src/daemon.mjs';
import {createActionDelivery,ACTION_TRANSPORT_BUDGETS} from '../src/daemon-action-delivery.mjs';

const SLUG='dsh-plugin-fixture';
function request(app,url,{cookie='',token='',method='GET',body}={}){
 const socket=new Duplex({read(){},write(_chunk,_encoding,done){done();}}),req=new IncomingMessage(socket),res=new ServerResponse(req),chunks=[],bytes=body===undefined?null:Buffer.from(JSON.stringify(body));
 req.method=method;req.url=url;req.headers={host:'plugins.fixture',cookie,...(token?{'x-ziwei-device-token':token}:{}),...(bytes?{'content-type':'application/json','content-length':String(bytes.length)}:{})};
 return new Promise((resolve,reject)=>{res.write=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));done?.();return true;};res.end=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));done?.();const text=Buffer.concat(chunks).toString();resolve({status:res.statusCode,headers:res.getHeaders(),json:text?JSON.parse(text):null});res.emit('finish');socket.destroy();return res;};req.on('error',reject);res.on('error',reject);app.handle(req,res,error=>{if(error)return reject(error);res.statusCode=404;res.end(JSON.stringify({error:'Route not found'}));});if(bytes)req.push(bytes);req.push(null);});
}
function fixture(t,{feature=true,runtime='DSH'}={}){
 const repo=createRepository({memory:true}),db=repo.db,auth=createAuthService(db),owner=auth.setup({email:'plugin-owner@fixture.invalid',password:'fixture-owner-password'});
 auth.createWorkspace(owner.user_id,{slug:SLUG,name:'Plugins fixture',kind:'team'});const ws=repo.getWorkspace(SLUG),member=auth.register({email:'plugin-member@fixture.invalid',password:'fixture-member-password'});
 db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run('plugin-member',ws.id,member.user_id,'Member','member@fixture.invalid','member',new Date().toISOString());
 const pair=repo.claimDevicePairing({code:repo.createDevicePairing(SLUG,{createdBy:owner.user_id,name:'Plugin fixture computer'}).code});
 repo.heartbeatDevice(SLUG,{deviceId:pair.deviceId,os:'Windows',runtimeDiscovery:{features:feature?['dsh_plugins_v1']:[]},runtimes:{DSH:{status:'available',profiles:[{name:'first-bot'},{name:'second-bot'}]}}});
 const actor={actorUserId:owner.user_id,actorRole:'owner'},employee=repo.createEmployee(SLUG,{name:'Plugin employee',runtime,runtimeProfile:'first-bot',targetDeviceId:pair.deviceId,ownerUserId:owner.user_id},actor);
 const app=createApp({memory:true,requireAuth:true,requireDeviceAuth:true,enableScheduler:false,repository:repo,auth}),cookie=`ziwei_session=${owner.session.token}`,memberCookie=`ziwei_session=${member.session.token}`,url=`/api/workspaces/${SLUG}/employees/${employee.id}/plugins`;
 const read=()=>request(app,url,{cookie}),refresh=(body={})=>request(app,url+'/refresh',{method:'POST',cookie,body}),apply=(body)=>request(app,url,{method:'PUT',cookie,body});
 const device=(id,suffix,body={},token=pair.deviceToken)=>request(app,`/a2a/v1/actions/${id}/${suffix}`,{method:'POST',token,body:{workspace:SLUG,...body}});
 const complete=async id=>{assert.equal((await device(id,'ack')).status,200);const action=repo.getA2AAction(id),subject=action.payload.pluginOperation.subject;const dshPlugins={schemaVersion:1,subject,source:'dsh-native',checkedAt:new Date().toISOString(),plugins:[{id:'base',name:'Base',description:'Native fixture',enabled:true,required:true},{id:'tools',name:'Tools',description:'Native fixture tools',enabled:false,required:false}],running:true,ready:true,restartRequired:true,notice:'下次启动生效',runtime:{status:'observed',bundles:[{name:'base',enabled:true,availability:'profile',installed:true,optional:false,removable:false,overrides:{secret:'PRIVATE_DIAGNOSTIC'},error:'PRIVATE_DIAGNOSTIC',rows:[{rowId:'base-row',moduleName:'base-module',entryId:'base-entry'}]}],entries:[{entryId:'base-entry',moduleName:'base-module',enabled:true,fiberPhase:'running',patchId:'base-patch',rowId:'base-row'},{entryId:'optional-entry',moduleName:'optional-module',enabled:'conditional',fiberPhase:null}],agentPresets:[{id:'default',isDefault:true,rows:[{entryId:'base-entry',moduleName:'base-module',enabled:true,fiberPhase:'running',patchId:'base-patch',rowId:'base-row'},{entryId:'optional-entry',moduleName:'optional-module',enabled:'conditional',fiberPhase:null}]}]},configuration:{status:'available',writable:false,schemaFormat:'schemastery',namespaces:[{ns:'base',revision:2,schema:{type:'object',properties:{token:{type:'string',title:'Token',default:'PRIVATE_DIAGNOSTIC',examples:['PRIVATE_DIAGNOSTIC']}},required:['token']},values:{token:'PRIVATE_DIAGNOSTIC'}},{ns:'native-graph',revision:3,applies:'live',schema:{uid:10,refs:{10:{type:'object',dict:{theme:11},meta:{default:{token:'PRIVATE_DIAGNOSTIC'}}},11:{type:'union',list:[12,13],sKey:14},14:{type:'string'},12:{type:'const',value:'light',meta:{description:'Theme',default:'PRIVATE_DIAGNOSTIC'}},13:{type:'const',value:'dark'}}}}]},secret:'PRIVATE_DIAGNOSTIC'};
  const saved=await device(id,'result',{status:'succeeded',result:{dshPlugins,output:'PRIVATE_DIAGNOSTIC'}});assert.equal(saved.status,200,JSON.stringify(saved.json));return dshPlugins;
 };
 t.after(()=>db.close());return{repo,db,auth,app,ws,pair,owner,member,actor,employee,cookie,memberCookie,url,read,refresh,apply,device,complete};
}

test('plugin GET is read only; refresh is routed to the bound device without a model action',async t=>{
 const f=fixture(t),initial=await f.read();assert.equal(initial.status,200,JSON.stringify(initial.json));assert.equal(initial.json.status,'unknown');assert.equal(f.db.prepare('SELECT count(*) n FROM a2a_actions').get().n,0);
 const created=await f.refresh({idempotencyKey:'inspect-one'});assert.equal(created.status,202,JSON.stringify(created.json));const id=created.json.pending.actionId,action=f.repo.getA2AAction(id);assert.equal(action.type,'employee.plugins.inspect');assert.equal(action.payload.deviceId,f.pair.deviceId);assert.equal(action.payload.pluginOperation.subject.profile,'first-bot');assert.equal(action.payload.runtime,undefined);assert.equal(action.payload.employeeId,undefined);assert.equal(action.payload.prompt,undefined);assert.equal((await f.refresh()).json.pending.actionId,id);assert.equal(f.db.prepare('SELECT count(*) n FROM hermes_bots').get().n,0);
 await f.complete(id);const read=await f.read();assert.equal(read.json.status,'ready');assert.equal(read.json.plugins[0].required,true);assert.equal(read.json.runtime.entries[0].fiberPhase,'running');assert.equal(read.json.runtime.entries[0].patchId,'base-patch');assert.equal(read.json.runtime.entries[1].enabled,'conditional');assert.equal(read.json.running,true);assert.equal(read.json.ready,true);assert.equal(read.json.configuration.namespaces[0].schema.properties.token.type,'string');assert.equal(read.json.configuration.namespaces[1].schema.refs[12].value,'light');assert.equal(read.json.configuration.namespaces[1].schema.refs[10].dict.theme,11);assert.equal(read.json.configuration.schemaFormat,'schemastery');assert.equal(read.json.configuration.namespaces[1].applies,'live');assert.equal(read.json.configuration.namespaces[1].schema.refs[11].sKey,14);assert.equal(read.json.runtime.entries[1].fiberPhase,null);assert.equal(JSON.stringify(read.json).includes('PRIVATE_DIAGNOSTIC'),false);
 const view=await request(f.app,`/api/workspaces/${SLUG}/actions/${id}`,{cookie:f.cookie});assert.equal(view.status,200);assert.equal(JSON.stringify(view.json).includes('PRIVATE_DIAGNOSTIC'),false);
});

test('apply requires an observed native catalog, retains required bundles and rejects unrelated input',async t=>{
 const f=fixture(t);assert.equal((await f.apply({enabled:['base'],idempotencyKey:'early'})).status,409);const inspected=await f.refresh();await f.complete(inspected.json.pending.actionId);
 for(const body of [{enabled:['invented'],idempotencyKey:'bad-id'},{enabled:[],idempotencyKey:'required'},{enabled:['base'],idempotencyKey:'url',baseUrl:'http://outside.invalid'},{enabled:['base']}])assert.equal((await f.apply(body)).status,400,JSON.stringify(body));
 const first=await f.apply({enabled:['base','tools'],idempotencyKey:'save-one'});assert.equal(first.status,202,JSON.stringify(first.json));const id=first.json.pending.actionId,action=f.repo.getA2AAction(id);assert.equal(action.type,'employee.plugins.apply');assert.deepEqual(action.payload.pluginOperation.enabled,['base','tools']);assert.equal((await f.apply({enabled:['base','tools'],idempotencyKey:'save-one'})).json.pending.actionId,id);assert.equal((await f.apply({enabled:['base'],idempotencyKey:'save-one'})).status,409);
 assert.equal(f.db.prepare('SELECT count(*) n FROM a2a_actions').get().n,2);assert.equal(f.db.prepare('SELECT count(*) n FROM tasks').get().n,0);
});

test('generic action, wrong device, changed subject and revoked feature cannot bypass plugin admission',async t=>{
 const f=fixture(t),created=await f.refresh({idempotencyKey:'fences'}),id=created.json.pending.actionId,action=f.repo.getA2AAction(id);
 assert.throws(()=>f.repo.createA2AAction(SLUG,{type:action.type,payload:action.payload,dedupeKey:action.dedupe_key}),{code:'DSH_PLUGINS_ROUTE_REQUIRED'});
 assert.throws(()=>f.repo.createA2AAction(SLUG,{type:'fixture.read',payload:{},dedupeKey:action.dedupe_key}),{code:'DSH_PLUGINS_ROUTE_REQUIRED'});
 const other=f.repo.claimDevicePairing({code:f.repo.createDevicePairing(SLUG,{createdBy:f.owner.user_id,name:'Other fixture computer'}).code});assert.ok([400,403].includes((await f.device(id,'ack',{},other.deviceToken)).status));
 f.db.prepare("UPDATE employees SET runtime_profile='second-bot' WHERE id=?").run(f.employee.id);assert.equal((await f.device(id,'ack')).json.code,'DSH_PLUGINS_SUBJECT_CHANGED');
 f.db.prepare("UPDATE employees SET runtime_profile='first-bot' WHERE id=?").run(f.employee.id);assert.equal((await f.device(id,'ack')).status,200);assert.equal((await f.device(id,'execution-admission')).status,200);
 f.repo.heartbeatDevice(SLUG,{deviceId:f.pair.deviceId,runtimeDiscovery:{features:[]}});assert.equal((await f.device(id,'execution-admission')).json.code,'DSH_PLUGINS_CLIENT_NOT_REPORTED');
});

test('visibility and current ownership fence snapshots and generic action readback',async t=>{
 const f=fixture(t),created=await f.refresh(),id=created.json.pending.actionId;await f.complete(id);f.repo.updateEmployee(f.employee.id,{visibility:'personal'},f.actor);
 const hidden=await request(f.app,f.url,{cookie:f.memberCookie});assert.equal(hidden.status,404);assert.equal((await request(f.app,`/api/workspaces/${SLUG}/actions/${id}`,{cookie:f.memberCookie})).status,404);
 f.db.prepare('UPDATE employees SET owner_user_id=? WHERE id=?').run(f.member.user_id,f.employee.id);const changed=await request(f.app,f.url,{cookie:f.memberCookie});assert.equal(changed.status,200);assert.equal(changed.json.snapshot,null);assert.equal(changed.json.lastAttempt,null);
});

test('old clients and unbound native profiles create no plugin action',async t=>{
 const f=fixture(t,{feature:false});const missing=await f.refresh();assert.equal(missing.status,202);assert.equal(missing.json.reasonCode,'CLIENT_NOT_REPORTED');assert.equal(missing.json.pending,null);assert.equal(f.db.prepare('SELECT count(*) n FROM a2a_actions').get().n,0);
 const other=fixture(t,{runtime:'Codex'});assert.equal((await other.refresh()).status,400);
});




test('device receipt refresh replaces the observed catalog without touching another Bot',async t=>{
 const f=fixture(t),second=f.repo.createEmployee(SLUG,{name:'Second Bot employee',runtime:'DSH',runtimeProfile:'second-bot',targetDeviceId:f.pair.deviceId,ownerUserId:f.owner.user_id},f.actor),secondUrl=`/api/workspaces/${SLUG}/employees/${second.id}/plugins`;
 const first=await f.refresh();await f.complete(first.json.pending.actionId);const readSecond=await request(f.app,secondUrl,{cookie:f.cookie});assert.equal(readSecond.json.snapshot,null);assert.equal(readSecond.json.plugins.length,0);
 const another=await request(f.app,secondUrl+'/refresh',{method:'POST',cookie:f.cookie,body:{idempotencyKey:'second'}});assert.notEqual(another.json.pending.actionId,first.json.pending.actionId);assert.equal(f.repo.getA2AAction(another.json.pending.actionId).payload.pluginOperation.subject.profile,'second-bot');
 const refresh=await f.refresh(),id=refresh.json.pending.actionId;await f.complete(id);const raw=f.repo.getA2AAction(id).result;raw.dshPlugins.plugins[1].enabled=true;f.db.prepare('UPDATE a2a_actions SET result_json=? WHERE id=?').run(JSON.stringify(raw),id);
 assert.equal((await f.read()).json.plugins.find(item=>item.id==='tools').enabled,true);assert.equal((await request(f.app,secondUrl,{cookie:f.cookie})).json.snapshot,null);
});

test('requester removal fences an ACKed plugin action and stale or late receipts remain explicitly unknown',async t=>{
 const f=fixture(t),created=await f.refresh(),id=created.json.pending.actionId;assert.equal((await f.device(id,'ack')).status,200);
 f.db.prepare('DELETE FROM members WHERE workspace_id=? AND user_id=?').run(f.ws.id,f.owner.user_id);const denied=await f.device(id,'execution-admission');assert.equal(denied.status,403);assert.equal(denied.json.code,'EMPLOYEE_CAPABILITIES_AUTHORITY_REVOKED');
 const g=fixture(t),first=await g.refresh(),receiptId=first.json.pending.actionId;await g.complete(receiptId);
 g.db.prepare('UPDATE a2a_actions SET expires_at=? WHERE id=?').run(new Date(Date.now()-1000).toISOString(),receiptId);const late=await g.read();assert.equal(late.json.reasonCode,'LATE_RECEIPT');assert.equal(late.json.plugins.length,0);assert.equal(late.json.snapshot.stale,true);
 const again=await g.refresh();await g.complete(again.json.pending.actionId);g.db.prepare("UPDATE devices SET status='offline' WHERE id=?").run(g.pair.deviceId);const offline=await g.read();assert.equal(offline.json.reasonCode,'DEVICE_OFFLINE');assert.equal(offline.json.running,null);assert.equal(offline.json.snapshot.running,true);
});

test('invalid and failed receipts and arbitrary event diagnostics never become public plugin data',async t=>{
 const f=fixture(t),created=await f.refresh(),id=created.json.pending.actionId;assert.equal((await f.device(id,'ack')).status,200);assert.equal((await f.device(id,'events',{type:'PRIVATE_DIAGNOSTIC',message:'PRIVATE_DIAGNOSTIC',data:{token:'PRIVATE_DIAGNOSTIC'}})).status,202);await f.complete(id);
 let action=await request(f.app,`/api/workspaces/${SLUG}/actions/${id}`,{cookie:f.cookie});assert.equal(JSON.stringify(action.json).includes('PRIVATE_DIAGNOSTIC'),false);assert.equal(f.repo.getA2AAction(id).events.some(event=>event.message==='PRIVATE_DIAGNOSTIC'),true);
 const invalid=await f.refresh(),invalidId=invalid.json.pending.actionId;assert.equal((await f.device(invalidId,'ack')).status,200);assert.equal((await f.device(invalidId,'result',{status:'succeeded',result:{dshPlugins:{schemaVersion:1,source:'invented',plugins:[]}}})).status,200);assert.equal((await f.read()).json.reasonCode,'RECEIPT_INVALID');
 const failed=await f.refresh(),failedId=failed.json.pending.actionId;assert.equal((await f.device(failedId,'ack')).status,200);assert.equal((await f.device(failedId,'result',{status:'failed',error:'PRIVATE_DIAGNOSTIC',result:{output:'PRIVATE_DIAGNOSTIC'}})).status,200);action=await request(f.app,`/api/workspaces/${SLUG}/actions/${failedId}`,{cookie:f.cookie});assert.equal(action.status,200);assert.equal(action.json.error,'DSH_PLUGINS_OPERATION_FAILED');assert.equal(action.json.result,null);assert.equal(JSON.stringify(action.json).includes('PRIVATE_DIAGNOSTIC'),false);assert.equal((await f.read()).json.reasonCode,'OPERATION_FAILED');
});

test('a late latest apply receipt makes an older successful inspection stale',async t=>{
 const f=fixture(t),inspected=await f.refresh(),inspectionId=inspected.json.pending.actionId;
 await f.complete(inspectionId);assert.equal((await f.read()).json.plugins.find(item=>item.id==='tools').enabled,false);
 const applied=await f.apply({enabled:['base','tools'],idempotencyKey:'late-apply'}),applyId=applied.json.pending.actionId;
 await f.complete(applyId);const result=f.repo.getA2AAction(applyId).result;result.dshPlugins.plugins[1].enabled=true;
 f.db.prepare('UPDATE a2a_actions SET result_json=?,expires_at=? WHERE id=?').run(JSON.stringify(result),new Date(Date.now()-1000).toISOString(),applyId);
 const view=(await f.read()).json;
 assert.equal(view.status,'unknown');assert.equal(view.reasonCode,'LATE_RECEIPT');assert.equal(view.stale,true);assert.deepEqual(view.plugins,[]);
 assert.equal(view.snapshot.actionId,inspectionId);assert.equal(view.snapshot.stale,true);assert.equal(view.snapshot.plugins.find(item=>item.id==='tools').enabled,false);
 assert.equal(view.lastAttempt.actionId,applyId);assert.equal(view.lastAttempt.status,'succeeded');assert.equal(view.lastAttempt.reasonCode,'LATE_RECEIPT');
});

test('plugin inspection and apply deliver their real dispatcher results after authenticated ACK renewal',async t=>{
 const f=fixture(t),directory=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-plugin-delivery-')),calls=[];
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 let toolsEnabled=false,nativeCalls=0;
 const execute=createLocalActionExecutor({runtimeDir:directory,defaultWorkdir:directory,workspace:SLUG,deviceId:f.pair.deviceId,admissionHandledByDispatcher:true,dshBaseUrl:'http://native.fixture',dshPluginFetch:async(url,options)=>{
  nativeCalls++;
  if(url.endsWith('/plugins')){
   if(options.method==='PUT')toolsEnabled=JSON.parse(options.body).enabled.includes('tools');
   return Response.json({ok:true,plugins:[{id:'base',name:'Base',enabled:true,required:true},{id:'tools',name:'Tools',enabled:toolsEnabled,required:false}],restartRequired:true});
  }
  assert.ok(url.endsWith('/api/state'));return Response.json({bots:[{name:'first-bot',running:false,ready:false}]});
 }});
 t.after(()=>execute.close());
 const dispatcher=new ActionDispatcher({execute,workdir:directory,workspace:SLUG,deviceId:f.pair.deviceId,authorizeExecute:async action=>{
  const admission=await f.device(action.id,'execution-admission');assert.equal(admission.status,200);assert.equal(admission.json.allowed,true);
 }});
 const delivery=createActionDelivery({directory:path.join(directory,'delivery'),identity:{apiBase:'https://workspace.fixture',workspace:SLUG,deviceId:f.pair.deviceId},retryDelays:[],dispatch:action=>dispatcher.dispatch(action),post:async(url,body)=>{
  const [,actionId,operation]=/\/actions\/([^/]+)\/(ack|events|result)$/.exec(url),response=await f.device(actionId,operation,body);
  calls.push({actionId,operation,body,response:response.json});assert.ok(response.status<300,JSON.stringify(response.json));return response.json;
 }});
 for(const operation of ['inspect','apply']){
  const queued=operation==='inspect'?await f.refresh({idempotencyKey:'delivery-inspect'}):await f.apply({enabled:['base','tools'],idempotencyKey:'delivery-apply'});
  const actionId=queued.json.pending.actionId,action=f.repo.listA2AActions(SLUG,{deviceId:f.pair.deviceId}).find(item=>item.id===actionId);
  assert.ok(Date.parse(action.expires_at)-Date.parse(action.created_at)<=60000);
  assert.deepEqual(await delivery.execute(action),{state:'confirmed',status:'succeeded'});
  const renewal=calls.find(call=>call.actionId===actionId&&call.operation==='ack'&&call.body.renewLease);
  assert.ok(renewal);assert.ok(Date.parse(renewal.response.expires_at)-Date.now()>=ACTION_TRANSPORT_BUDGETS.result+30000);
  assert.equal(calls.filter(call=>call.actionId===actionId&&call.operation==='result').length,1);
  assert.equal(f.repo.getA2AAction(actionId).status,'succeeded');assert.equal(delivery.pendingCount,0);
  const observed=(await f.read()).json;assert.equal(observed.status,'ready');assert.equal(observed.plugins.find(item=>item.id==='tools').enabled,operation==='apply');
  const completedNativeCalls=nativeCalls;assert.deepEqual(await delivery.execute(action),{state:'confirmed',status:'succeeded'});assert.equal(nativeCalls,completedNativeCalls);
 }
});

test('retrying an original plugin write cannot retarget a changed employee binding or configuration',async t=>{
 for(const patch of [{runtimeProfile:'second-bot'},{visibility:'personal'}]){
  const f=fixture(t);
  f.repo.heartbeatDevice(SLUG,{deviceId:f.pair.deviceId,runtimes:{DSH:{status:'available',profiles:[{name:'first-bot',readiness:{ready:true}},{name:'second-bot',readiness:{ready:true}}]}}});
  const inspected=await f.refresh();await f.complete(inspected.json.pending.actionId);
  const input={enabled:['base'],idempotencyKey:'original-unknown-write'},original=await f.apply(input),originalId=original.json.pending.actionId;
  await f.complete(originalId);
  const updated=await request(f.app,`/api/workspaces/${SLUG}/employees/${f.employee.id}`,{method:'PATCH',cookie:f.cookie,body:patch});
  assert.equal(updated.status,200,JSON.stringify(updated.json));
  const refreshed=await f.refresh();await f.complete(refreshed.json.pending.actionId);
  const count=f.db.prepare('SELECT count(*) n FROM a2a_actions').get().n,retry=await f.apply(input);
  assert.equal(retry.status,409);assert.equal(retry.json.code,'DSH_PLUGINS_SUBJECT_CHANGED');
  assert.equal(f.db.prepare('SELECT count(*) n FROM a2a_actions').get().n,count);
  const conflicting=await f.apply({...input,enabled:['base','tools']});assert.equal(conflicting.status,409);assert.equal(conflicting.json.code,'IDEMPOTENCY_CONFLICT');
  assert.equal(f.repo.getA2AAction(originalId).payload.pluginOperation.subject.profile,'first-bot');
 }
});
