import test from 'node:test';
import assert from 'node:assert/strict';
import {IncomingMessage,ServerResponse} from 'node:http';
import {Duplex} from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as wait} from 'node:timers/promises';
import express from 'express';
import {createRepository} from '../backend/repository.mjs';
import {createAuthService} from '../backend/auth.mjs';
import {createApp} from '../backend/app.mjs';
import {createManagementService} from '../backend/management.mjs';
import {createDshNativeService} from '../backend/dsh-native-operations.mjs';
import {createDshNativeGroupDispatch} from '../backend/dsh-native-group-dispatch.mjs';
import {mountDshNativeRoutes} from '../backend/dsh-native-routes.mjs';
import {createLocalActionExecutor} from '../src/local-action.mjs';
import {ActionDispatcher} from '../src/daemon.mjs';
import {createActionDelivery} from '../src/daemon-action-delivery.mjs';
import {createActionScheduler} from '../src/daemon-action-scheduler.mjs';
import {executeDshRuntime} from '../src/dsh-runtime.mjs';
import {confirmedDshSessionExit} from '../src/dsh-session-receipt.mjs';
import {dshFixture} from './fixtures/dsh-protocol.mjs';

const SLUG='native-group-delivery';
function request(app,url,{method='GET',body,cookie='',token=''}={}){
 const socket=new Duplex({read(){},write(_chunk,_encoding,done){done();}}),req=new IncomingMessage(socket),res=new ServerResponse(req),chunks=[],bytes=body===undefined?null:Buffer.from(JSON.stringify(body));
 req.method=method;req.url=url;req.headers={host:'group.fixture',cookie,...(token?{'x-ziwei-device-token':token}:{}),...(bytes?{'content-type':'application/json','content-length':String(bytes.length)}:{})};
 return new Promise((resolve,reject)=>{
  res.write=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));done?.();return true;};
  res.end=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));done?.();try{const value=Buffer.concat(chunks).toString();resolve({status:res.statusCode,json:value?JSON.parse(value):null});}catch(error){reject(error);}res.emit('finish');socket.destroy();return res;};
  req.on('error',reject);res.on('error',reject);app.handle(req,res,error=>{if(error)return reject(error);res.statusCode=404;res.end(JSON.stringify({code:'FIXTURE_ROUTE_NOT_FOUND'}));});if(bytes)req.push(bytes);req.push(null);
 });
}

async function fixture(t,{hold=false}={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-group-delivery-')),repo=createRepository({memory:true}),db=repo.db,auth=createAuthService(db),owner=auth.setup({email:'native-group-owner@fixture.invalid',password:'native-group-owner-password'});
 auth.createWorkspace(owner.user_id,{slug:SLUG,name:'Native group delivery fixture',kind:'team'});
 const pair=repo.claimDevicePairing({code:repo.createDevicePairing(SLUG,{createdBy:owner.user_id,name:'Native group fixture computer'}).code}),actor={actorUserId:owner.user_id,actorRole:'owner'};
 repo.heartbeatDevice(SLUG,{deviceId:pair.deviceId,os:'Windows',runtimeDiscovery:{features:['dsh_native_controls_v1']},runtimes:{DSH:{status:'available',profiles:[{name:'alpha'},{name:'beta'}]}}});
 const employees=['alpha','beta'].map(profile=>repo.createEmployee(SLUG,{name:`Native ${profile}`,runtime:'DSH',runtimeProfile:profile,targetDeviceId:pair.deviceId,ownerUserId:owner.user_id},actor)),employee=employees[0],cookie=`ziwei_session=${owner.session.token}`,app=createApp({memory:true,requireAuth:true,requireDeviceAuth:true,enableScheduler:false,repository:repo,auth}),management=createManagementService(repo),nativeService=createDshNativeService(repo,{management}),groupDispatchService=createDshNativeGroupDispatch(repo,{management}),groupApp=express(),calls=[],posts=[],errors=[],started=[],finished=[];
 groupApp.use(express.json());groupApp.use('/a2a',(req,res,next)=>{req.deviceCredential=repo.authenticateDeviceToken(req.headers['x-ziwei-device-token'],{workspaceSlug:req.body.workspace});if(!req.deviceCredential)return res.status(401).json({code:'DEVICE_REQUIRED'});next();});
 const reject=(_req,res)=>res.status(401).json({code:'AUTH_REQUIRED'});
 mountDshNativeRoutes(groupApp,{service:nativeService,groupDispatchService,requireRole:()=>reject,mcpGuard:reject,mcpEmployeeGuard:reject,employeeContext:()=>actor,mcpContext:()=>actor});
 groupApp.use((error,_req,res,_next)=>res.status(error.status||500).json({code:error.code||'FIXTURE_ERROR'}));
 const group={id:'native-group-fixture',title:'Native fixture discussion',members:['alpha','beta'],sessions:{},messages:[]};
 const native=await dshFixture(t,{hold,routes:(req,body,reply)=>{
  if(req.url==='/api/state'){reply({bots:group.members.map(name=>({name,running:true,ready:true,workdir:directory}))});return true;}
  if(req.url==='/api/groups'){assert.equal(req.method,'GET');calls.push({method:'groups.list'});reply({ok:true,items:[group]});return true;}
  if(req.url===`/api/groups/${group.id}`){calls.push({method:`groups.${req.method}`,body:structuredClone(body)});if(req.method==='PUT'){assert.deepEqual(Object.keys(body).sort(),['messages','sessions']);Object.assign(group,structuredClone(body));}else assert.equal(req.method,'GET');reply({ok:true,item:group});return true;}
  if(/\/api\/session\/projections$/.test(req.url)){reply({type:'server-response',rpcId:body.rpcId,result:{ok:true,value:{kind:'sequenced',asOfSeq:1,values:{workingDirectory:directory}}}});return true;}
  return false;
 }});
 const base=`/api/workspaces/${SLUG}/employees/${employee.id}/dsh/native`;
 const web=(suffix,options={})=>request(app,base+suffix,{cookie,...options});
 const device=(id,suffix,body={})=>request(app,`/a2a/v1/actions/${id}/${suffix}`,{method:'POST',token:pair.deviceToken,body:{workspace:SLUG,...body}});
 const read=async()=>{const response=await web('/state');assert.equal(response.status,200,JSON.stringify(response.json));return response.json;};
 const queue=async(operation,input,key)=>{const response=await web('/actions',{method:'POST',body:{resource:'groups',operation,input,idempotencyKey:key,expectedSubjectHash:(await read()).subjectHash}});assert.equal(response.status,202,JSON.stringify(response.json));return response.json.action.id;};
 const deviceFetch=async(url,options)=>{
  const address=new URL(url);assert.equal(address.origin,'https://workspace.fixture');const response=await request(address.pathname.includes('/dsh-group/')?groupApp:app,address.pathname+address.search,{method:options.method,token:options.headers['x-ziwei-device-token'],...(options.body?{body:JSON.parse(options.body)}:{})});
  calls.push({method:options.method,path:address.pathname,status:response.status});return Response.json(response.json,{status:response.status});
 };
 const execute=createLocalActionExecutor({runtimeDir:directory,defaultWorkdir:directory,workspace:SLUG,deviceId:pair.deviceId,deviceToken:pair.deviceToken,apiBase:'https://workspace.fixture',admissionHandledByDispatcher:true,dshBaseUrl:native.baseUrl,dshPluginFetch:native.transport.fetchImpl,dshDeviceFetch:deviceFetch,dshRuntime:options=>executeDshRuntime({...options,...native.transport})});
 let delivery,activeWorkers=0,maxWorkers=0,maxActive=0;
 const dispatcher=new ActionDispatcher({execute,workdir:directory,workspace:SLUG,deviceId:pair.deviceId,onEvent:(type,data)=>{if(data.actionId)delivery?.recordEvent(data.actionId,type,data);},authorizeExecute:async action=>{const response=await device(action.id,'execution-admission');assert.equal(response.status,200,JSON.stringify(response.json));assert.equal(response.json.allowed,true);}});
 delivery=createActionDelivery({directory:path.join(directory,'delivery'),identity:{apiBase:'https://workspace.fixture',workspace:SLUG,deviceId:pair.deviceId},retryDelays:[],dispatch:action=>dispatcher.dispatch(action),post:async(url,body)=>{
  const [,id,operation]=/\/actions\/([^/]+)\/(ack|events|result)$/.exec(url),response=await device(id,operation,body);posts.push({id,operation,body,status:response.status});
  if(response.status>=300)throw Object.assign(new Error(response.json.code||'FIXTURE_DELIVERY_FAILED'),{status:response.status,code:response.json.code});return response.json;
 }});
 const scheduler=createActionScheduler({concurrency:1,execute:async action=>{started.push(action.id);if(action.type==='conversation.execute')maxWorkers=Math.max(maxWorkers,++activeWorkers);maxActive=Math.max(maxActive,scheduler.activeCount);try{return await delivery.execute(action);}finally{if(action.type==='conversation.execute')activeWorkers--;finished.push(action.id);}},onError:(error,action)=>errors.push({id:action.id,error:error.message})});
 const poll=async()=>{const response=await request(app,`/a2a/v1/actions?workspace=${SLUG}&includeAcked=true`,{token:pair.deviceToken});assert.equal(response.status,200,JSON.stringify(response.json));return response.json.actions;};
 async function pump(until){const deadline=Date.now()+8000;while(!until()&&Date.now()<deadline){scheduler.schedule(await poll());await wait(10);}assert.ok(until(),JSON.stringify({errors,started,actions:repo.listA2AActions(SLUG,{deviceId:pair.deviceId}).map(row=>({id:row.id,type:row.type,status:row.status}))}));}
 const terminal=id=>['succeeded','failed','expired'].includes(repo.getA2AAction(id)?.status),children=source=>db.prepare("SELECT id FROM a2a_actions WHERE type='conversation.execute' AND json_extract(payload_json,'$.dshGroup.sourceActionId')=? ORDER BY rowid").all(source).map(row=>repo.getA2AAction(row.id));
 t.after(async()=>{for(const id of started)dispatcher.cancel(id);await scheduler.whenIdle();await execute.close();db.close();fs.rmSync(directory,{recursive:true,force:true});});
 const listId=await queue('list',{},'initial-list');await pump(()=>terminal(listId));assert.equal(repo.getA2AAction(listId).status,'succeeded');
 return{repo,db,app,groupApp,pair,owner,employee,employees,cookie,group,native,calls,posts,errors,started,finished,web,device,read,queue,poll,pump,terminal,children,scheduler,dispatcher,delivery,stats:()=>({maxWorkers,maxActive})};
}

test('concurrency one completes both supervised members including the source and persists one native group transcript',async t=>{
 const f=await fixture(t),id=await f.queue('send',{groupId:f.group.id,content:'Both members discuss this fixture task'},'group-send-once'),original=(await f.poll()).find(action=>action.id===id);
 await f.pump(()=>f.terminal(id));await f.scheduler.whenIdle();assert.deepEqual(f.errors,[]);
 const parent=f.repo.getA2AAction(id),children=f.children(id);assert.equal(parent.status,'succeeded',JSON.stringify(parent.result));assert.equal(parent.result.dshNative.status,'applied');assert.equal(parent.result.dshNative.data.historyPersisted,true);assert.equal(children.length,2);assert.deepEqual(new Set(children.map(child=>child.payload.employeeId)),new Set(f.employees.map(employee=>employee.id)));
 for(const child of children){assert.equal(child.status,'succeeded',JSON.stringify(child.result));assert.equal(child.type,'conversation.execute');assert.equal(child.payload.runtime,'DSH');assert.equal(child.result.output,'DSH 完成');assert.ok(confirmedDshSessionExit(child,child,child.result.sessionExit));assert.equal(child.result.processExit,undefined);assert.ok(f.posts.some(post=>post.id===child.id&&post.operation==='result'&&post.status===200));}
 assert.equal(f.stats().maxWorkers,1);assert.ok(f.stats().maxActive>=2);assert.equal(f.native.calls.filter(call=>call.method==='session/prompt').length,2);assert.equal(f.calls.filter(call=>call.method==='groups.PUT').length,1);
 assert.deepEqual(Object.keys(f.group.sessions).sort(),['alpha','beta']);assert.notEqual(f.group.sessions.alpha,f.group.sessions.beta);assert.equal(f.group.messages.filter(message=>message.role==='assistant').length,2);assert.equal(f.group.messages.filter(message=>message.role==='user').length,1);
 assert.ok(f.calls.some(call=>call.path===`/a2a/v1/actions/${id}/dsh-group/dispatch`&&call.status===202));for(const child of children)assert.ok(f.calls.some(call=>call.method==='GET'&&call.path===`/a2a/v1/actions/${child.id}`&&call.status===200));
 const state=await f.read();assert.equal(state.resources.groups.application,'applied');assert.equal(state.resources.groups.data.item.messages.length,3);assert.equal(state.resources.groups.data.item.sessions.alpha,f.group.sessions.alpha);
 const before=f.native.calls.length;assert.equal(await f.queue('send',{groupId:f.group.id,content:'Both members discuss this fixture task'},'group-send-once'),id);await f.delivery.execute(original);assert.equal(f.native.calls.length,before);assert.equal(f.children(id).length,2);assert.equal(f.calls.filter(call=>call.method==='groups.PUT').length,1);
});

test('typed group cancellation controls a real member session and never reports the original send as stopped',async t=>{
 const f=await fixture(t,{hold:true}),id=await f.queue('send',{groupId:f.group.id,content:'Keep this supervised member running',targetEmployeeIds:[f.employee.id]},'held-group-send');
 await f.pump(()=>f.native.calls.some(call=>call.method==='session/prompt'));const child=f.children(id)[0];assert.ok(child);assert.equal(child.status,'acked');assert.equal(f.repo.getA2AAction(id).status,'acked');
 const missing=await request(f.groupApp,`/a2a/v1/actions/${id}/dsh-group/dispatch`,{method:'POST',body:{workspace:SLUG,group:f.group}});assert.equal(missing.status,401);
 const other=f.repo.claimDevicePairing({code:f.repo.createDevicePairing(SLUG,{createdBy:f.owner.user_id,name:'Foreign fixture device'}).code}),foreign=await request(f.groupApp,`/a2a/v1/actions/${id}/dsh-group/dispatch`,{method:'POST',token:other.deviceToken,body:{workspace:SLUG,group:f.group}});assert.equal(foreign.status,403);assert.equal(foreign.json.code,'DSH_NATIVE_GROUP_DEVICE_MISMATCH');assert.equal(f.children(id).length,1);
 const invalid=await f.web('/actions',{method:'POST',body:{resource:'groups',operation:'send',input:{groupId:f.group.id,content:42},idempotencyKey:'wrong-content-type',expectedSubjectHash:(await f.read()).subjectHash}});assert.equal(invalid.status,400);
 const controlId=await f.queue('cancel',{sourceActionId:id},'cancel-held-group');await f.pump(()=>f.terminal(controlId));
 const control=f.repo.getA2AAction(controlId);assert.equal(control.status,'succeeded',JSON.stringify(control.result));assert.equal(control.result.dshNative.status,'observed');assert.equal(control.result.dshNative.data.cancelRequested,true);assert.equal(control.result.dshNative.data.stopConfirmed,false);const cancelId=control.result.dshNative.data.members[0].cancelActionId;assert.ok(cancelId);
 await f.pump(()=>f.terminal(id)&&f.terminal(cancelId));await f.scheduler.whenIdle();assert.deepEqual(f.errors,[]);
 const cancellation=f.repo.getA2AAction(cancelId),member=f.repo.getA2AAction(child.id),parent=f.repo.getA2AAction(id);assert.equal(cancellation.type,'action.cancel');assert.equal(cancellation.payload.actionId,child.id);assert.equal(cancellation.status,'succeeded',JSON.stringify(cancellation.result));assert.equal(cancellation.result.cancellationRequested,true);assert.equal(member.status,'failed');assert.ok(confirmedDshSessionExit(member,member,member.result.sessionExit));assert.equal(member.result.sessionExit.reason,'aborted');assert.equal(parent.status,'failed');assert.equal(parent.result.dshNative.status,'failed');assert.equal(parent.result.dshNative.data.stopConfirmed,undefined);
 assert.equal(f.native.calls.filter(call=>call.method==='session/cancel').length,1);assert.equal(f.calls.filter(call=>call.method==='groups.PUT').length,1);assert.ok(f.posts.some(post=>post.id===cancelId&&post.operation==='result'&&post.status===200));assert.ok(f.posts.some(post=>post.id===child.id&&post.operation==='result'&&post.status===200));assert.equal(f.group.messages.at(-1).status,'error');
});

test('concurrency one group cancellation removes the queued second member before any native prompt',async t=>{
 const f=await fixture(t,{hold:true}),id=await f.queue('send',{groupId:f.group.id,content:'Both members wait for explicit cancellation'},'cancel-both-members');
 await f.pump(()=>f.native.calls.some(call=>call.method==='session/prompt'));
 const members=f.children(id),active=members.find(child=>child.payload.profile==='alpha'),queued=members.find(child=>child.payload.profile==='beta');assert.equal(members.length,2);assert.equal(active.status,'acked');assert.equal(queued.status,'pending');assert.equal(queued.acked_at,null);assert.deepEqual(f.native.calls.filter(call=>call.method==='session/prompt').map(call=>call.bot),['alpha']);
 const controlId=await f.queue('cancel',{sourceActionId:id},'cancel-active-and-queued');await f.pump(()=>f.terminal(controlId)&&f.terminal(id));await f.scheduler.whenIdle();assert.deepEqual(f.errors,[]);
 const stoppedActive=f.repo.getA2AAction(active.id),removed=f.repo.getA2AAction(queued.id),control=f.repo.getA2AAction(controlId),parent=f.repo.getA2AAction(id);
 assert.equal(stoppedActive.status,'failed');assert.ok(confirmedDshSessionExit(stoppedActive,stoppedActive,stoppedActive.result.sessionExit));assert.equal(stoppedActive.result.sessionExit.reason,'aborted');assert.equal(removed.status,'failed');assert.equal(removed.error,'CONVERSATION_QUEUE_REMOVED');assert.equal(removed.acked_at,null);assert.equal(removed.result.queueRemoved,true);assert.equal(removed.result.sessionExit,undefined);
 assert.equal(control.status,'succeeded');assert.equal(control.result.dshNative.data.cancelRequested,true);assert.equal(control.result.dshNative.data.stopConfirmed,false);assert.equal(parent.status,'failed');assert.equal(parent.result.dshNative.status,'failed');assert.equal(parent.result.dshNative.data.stopConfirmed,undefined);assert.equal(parent.result.dshNative.data.members.find(member=>member.profile==='beta').error,'CONVERSATION_QUEUE_REMOVED');
 const cancellation=f.db.prepare("SELECT id,payload_json FROM a2a_actions WHERE type='action.cancel'").all();assert.equal(cancellation.length,1);assert.equal(JSON.parse(cancellation[0].payload_json).actionId,active.id);assert.ok(f.posts.some(post=>post.id===cancellation[0].id&&post.operation==='result'&&post.status===200));assert.equal(f.posts.some(post=>post.id===queued.id&&post.operation==='ack'),false);assert.equal(f.started.includes(queued.id),false);
 assert.deepEqual(f.native.calls.filter(call=>call.method==='session/prompt').map(call=>call.bot),['alpha']);assert.equal(f.native.calls.filter(call=>call.method==='session/cancel').length,1);assert.equal(f.calls.filter(call=>call.method==='groups.PUT').length,1);
});
