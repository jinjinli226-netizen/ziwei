import test from 'node:test';
import assert from 'node:assert/strict';
import {IncomingMessage,ServerResponse} from 'node:http';
import {Duplex} from 'node:stream';
import {generateKeyPairSync} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {createRepository} from '../backend/repository.mjs';
import {createAuthService} from '../backend/auth.mjs';
import {createApp} from '../backend/app.mjs';
import {createManagementService} from '../backend/management.mjs';
import {createDshNativeService} from '../backend/dsh-native-operations.mjs';
import {createDshNativeSecrets} from '../backend/dsh-native-secrets.mjs';
import {mountDshNativeRoutes} from '../backend/dsh-native-routes.mjs';
import {createLocalActionExecutor} from '../src/local-action.mjs';
import {ActionDispatcher} from '../src/daemon.mjs';
import {createActionDelivery,ACTION_TRANSPORT_BUDGETS} from '../src/daemon-action-delivery.mjs';
import {sealSecret,openSecret} from '../src/bot-secret-crypto.mjs';

const SLUG='dsh-native-delivery',SECRET='synthetic-native-delivery-secret';

function request(app,url,{cookie='',token='',method='GET',body}={}){
 const socket=new Duplex({read(){},write(_chunk,_encoding,done){done();}}),req=new IncomingMessage(socket),res=new ServerResponse(req),chunks=[],bytes=body===undefined?null:Buffer.from(JSON.stringify(body));
 req.method=method;req.url=url;req.headers={host:'native-delivery.fixture',cookie,...(token?{'x-ziwei-device-token':token}:{}),...(bytes?{'content-type':'application/json','content-length':String(bytes.length)}:{})};
 return new Promise((resolve,reject)=>{
  res.write=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));done?.();return true;};
  res.end=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));done?.();try{const text=Buffer.concat(chunks).toString();resolve({status:res.statusCode,headers:res.getHeaders(),json:text?JSON.parse(text):null});}catch(error){reject(error);}res.emit('finish');socket.destroy();return res;};
  req.on('error',reject);res.on('error',reject);app.handle(req,res,error=>{if(error)return reject(error);res.statusCode=404;res.end(JSON.stringify({error:'Route not found'}));});if(bytes)req.push(bytes);req.push(null);
 });
}

function nativeBoundary(){
 const calls=[],sessions=new Map();let revision=7,value=3,privateSetting=SECRET,failMutation=false;
 const settings=()=>({writable:true,hasDocument:true,namespaces:[{ns:'agent-loop',revision,applies:'live',autoGenerate:false,schema:{uid:1,refs:{1:{type:'object',dict:{maxParallelToolCalls:2,theme:3,privateSetting:4}},2:{type:'number',meta:{min:1,max:20}},3:{type:'string'},4:{type:'string',meta:{role:'secret'}}}},value:{maxParallelToolCalls:value,theme:'dark',privateSetting},base:{maxParallelToolCalls:1,theme:'light'},user:{maxParallelToolCalls:value,privateSetting},secrets:[{path:['privateSetting'],set:true}]}]});
 const projection=id=>{const session=sessions.get(id);assert.ok(session,`Unknown fixture session ${id}`);return{kind:'sequenced',asOfSeq:session.seq,values:{agentPreset:session.agentPreset,plan:{active:session.active,pending:false,detail:'# Fixture native plan'},userQuestions:{active:[]},sessionListMetadata:{blank:session.blank},workingDirectory:session.cwd}};};
 const fetchImpl=async(url,options={})=>{
  const address=new URL(url);assert.equal(address.origin,'http://native.fixture');
  const match=/^\/runtime\/alpha\/api\/(.+)$/.exec(address.pathname);assert.ok(match,`Unexpected native endpoint ${address.pathname}`);
  const envelope=JSON.parse(options.body);assert.equal(options.method,'POST');assert.equal(envelope.type,'client-request');assert.equal(envelope.method,match[1]);assert.deepEqual(Object.keys(envelope.payload),['args']);
  const method=envelope.method,args=envelope.payload.args;calls.push({method,args:structuredClone(args)});let result;
  if(method==='settings/describe'){assert.deepEqual(args,{});result=settings();}
  else if(method==='agentPresets/list'){assert.deepEqual(args,{});result=[{id:'standard',name:'Standard',isDefault:true},{id:'native-custom',name:'Existing custom preset'}];}
  else if(method==='settings/mutate'){
   assert.equal(args.ns,'agent-loop');assert.equal(args.expectedRevision,revision);
   for(const edit of args.ops){assert.equal(edit.op,'set');if(edit.path[0]==='privateSetting')privateSetting=edit.value;else{assert.deepEqual(edit.path,['maxParallelToolCalls']);value=edit.value;}}
   revision++;if(failMutation)throw new Error('fixture dropped native mutation response');result=settings().namespaces[0];
  }else if(method==='session/create'){
   assert.deepEqual(Object.keys(args),['request']);assert.equal(typeof args.request.cwd,'string');assert.equal(args.request.agentPreset,'standard');
   const sessionId=`fixture-session-${sessions.size+1}`;sessions.set(sessionId,{agentPreset:'standard',active:false,blank:true,cwd:args.request.cwd,seq:1});result={sessionId};
  }else if(method==='session/projections'){assert.deepEqual(Object.keys(args),['request']);assert.deepEqual(Object.keys(args.request),['sessionId']);result=projection(args.request.sessionId);}
  else if(method==='commands/list'){assert.deepEqual(Object.keys(args),['agentId']);assert.ok(sessions.has(args.agentId));result=[{name:'plan',description:'Plan mode'}];}
  else if(method==='commands/execute'){
   assert.deepEqual(args,{agentId:args.agentId,line:'/plan',submittedAttachments:[]});const session=sessions.get(args.agentId);session.active=true;session.seq++;result={commandId:'fixture-command-1',result:{kind:'success'}};
  }else if(method==='agentPresets/select'){
   assert.deepEqual(args,{agentId:args.agentId,agentPreset:'native-custom'});const session=sessions.get(args.agentId);assert.equal(session.blank,true);session.agentPreset=args.agentPreset;session.seq++;result=args.agentPreset;
  }else assert.fail(`Unexpected native RPC ${method}`);
  return Response.json({type:'server-response',rpcId:envelope.rpcId,result:{ok:true,value:result}});
 };
 return{fetchImpl,calls,sessions,settings,dropMutationResponse:()=>{failMutation=true;},count:method=>calls.filter(call=>call.method===method).length};
}

function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-native-delivery-')),repo=createRepository({memory:true}),db=repo.db,auth=createAuthService(db),owner=auth.setup({email:'native-delivery-owner@fixture.invalid',password:'native-delivery-owner-password'});
 auth.createWorkspace(owner.user_id,{slug:SLUG,name:'Native delivery fixture',kind:'team'});
 const pair=repo.claimDevicePairing({code:repo.createDevicePairing(SLUG,{createdBy:owner.user_id,name:'Native delivery computer'}).code});
 repo.heartbeatDevice(SLUG,{deviceId:pair.deviceId,os:'Windows',runtimeDiscovery:{features:['dsh_native_controls_v1']},runtimes:{DSH:{status:'available',profiles:[{name:'alpha',readiness:{ready:true}},{name:'beta',readiness:{ready:true}}]}}});
 const actor={actorUserId:owner.user_id,actorRole:'owner'},employee=repo.createEmployee(SLUG,{name:'Native delivery employee',runtime:'DSH',runtimeProfile:'alpha',targetDeviceId:pair.deviceId,ownerUserId:owner.user_id},actor),app=createApp({memory:true,requireAuth:true,requireDeviceAuth:true,enableScheduler:false,repository:repo,auth}),cookie=`ziwei_session=${owner.session.token}`,base=`/api/workspaces/${SLUG}/employees/${employee.id}/dsh/native`,native=nativeBoundary(),posts=[],executors=[];
 const web=(suffix,options={})=>request(app,base+suffix,{cookie,...options}),device=(id,suffix,body={})=>request(app,`/a2a/v1/actions/${id}/${suffix}`,{method:'POST',token:pair.deviceToken,body:{workspace:SLUG,...body}});
 const read=async(conversationId)=>{const response=await web(`/state${conversationId?`?conversationId=${conversationId}`:''}`);assert.equal(response.status,200,JSON.stringify(response.json));return response.json;};
 const queue=async(resource,operation,input,idempotencyKey,conversationId)=>web('/actions',{method:'POST',body:{resource,operation,input,idempotencyKey,...(conversationId?{conversationId}:{}),expectedSubjectHash:(await read(conversationId)).subjectHash}});
 const polled=id=>{const action=repo.listA2AActions(SLUG,{deviceId:pair.deviceId}).find(row=>row.id===id);assert.ok(action);return action;};
 let failResult=false;
 const transport=async(url,body,options)=>{
  const [,id,operation]=/\/actions\/([^/]+)\/(ack|events|result)$/.exec(url);
  if(operation==='result'&&failResult)throw new Error('fixture result transport outage');
  const response=await device(id,operation,body);posts.push({id,operation,body,response,options});
  if(response.status>=300)throw Object.assign(new Error(response.json.code||'fixture request failed'),{status:response.status,code:response.json.code});return response.json;
 };
 const runner=({dispatcherDirectory=directory,...options}={})=>{
  fs.mkdirSync(dispatcherDirectory,{recursive:true});
  const execute=createLocalActionExecutor({runtimeDir:directory,defaultWorkdir:directory,workspace:SLUG,deviceId:pair.deviceId,deviceToken:pair.deviceToken,apiBase:'https://workspace.fixture',admissionHandledByDispatcher:true,dshBaseUrl:'http://native.fixture',dshPluginFetch:native.fetchImpl,...options});executors.push(execute);
  const dispatcher=new ActionDispatcher({execute,workdir:dispatcherDirectory,workspace:SLUG,deviceId:pair.deviceId,authorizeExecute:async action=>{const response=await device(action.id,'execution-admission');assert.equal(response.status,200,JSON.stringify(response.json));assert.equal(response.json.allowed,true);}});
  const delivery=createActionDelivery({directory:path.join(directory,'delivery'),identity:{apiBase:'https://workspace.fixture',workspace:SLUG,deviceId:pair.deviceId},retryDelays:[],dispatch:action=>dispatcher.dispatch(action),post:transport});
  return{execute,dispatcher,delivery};
 };
 const refresh=async(resources=['settings','presets'])=>{const response=await web('/refresh',{method:'POST',body:{resources,idempotencyKey:`refresh-${posts.length}`}});assert.equal(response.status,202,JSON.stringify(response.json));return response.json.action.id;};
 t.after(async()=>{for(const execute of executors)await execute.close();db.close();fs.rmSync(directory,{recursive:true,force:true});});
 return{directory,repo,db,auth,owner,actor,pair,employee,app,cookie,base,native,posts,web,device,read,queue,polled,runner,refresh,failResults:value=>{failResult=value;}};
}

function assertDelivered(f,id,status='succeeded'){
 const calls=f.posts.filter(call=>call.id===id),acks=calls.filter(call=>call.operation==='ack');
 assert.equal(acks.length,2);assert.equal(acks[0].body.renewLease,false);assert.equal(acks[1].body.renewLease,true);
 for(const ack of acks){assert.equal(ack.response.json.status,'acked');const duration=Date.parse(ack.response.json.expires_at)-Date.parse(ack.response.json.acked_at);assert.ok(duration>=959000&&duration<965000,`Actual ACK lease ${duration}ms`);}
 const results=calls.filter(call=>call.operation==='result');assert.equal(results.length,1);assert.equal(results[0].options.timeoutMs,ACTION_TRANSPORT_BUDGETS.result);assert.equal(results[0].response.status,200);assert.equal(results[0].response.json.status,status);assert.equal(f.repo.getA2AAction(id).status,status);
}

test('authenticated API, real delivery and native CAS return editable settings and the new revision',async t=>{
 const f=fixture(t),{delivery}=f.runner(),cap=await f.web('/capabilities');
 assert.equal(cap.status,200);assert.equal(cap.json.clientReported,true);assert.equal(cap.json.operations.find(row=>row.resource==='settings'&&row.operation==='mutate').supported,true);
 assert.equal((await f.read()).resources.settings.status,'unknown');assert.equal(f.db.prepare('SELECT count(*) n FROM a2a_actions').get().n,0);
 assert.equal((await request(f.app,f.base+'/state')).status,401);
 const refreshId=await f.refresh(),refresh=f.polled(refreshId);assert.ok(Date.parse(refresh.expires_at)-Date.parse(refresh.created_at)<=60000);
 assert.deepEqual(await delivery.execute(refresh),{state:'confirmed',status:'succeeded'});assertDelivered(f,refreshId);
 let state=await f.read(),ns=state.resources.settings.data.namespaces[0];assert.equal(ns.value.maxParallelToolCalls,3);assert.equal(ns.base.theme,'light');assert.equal(ns.user.maxParallelToolCalls,3);assert.equal(ns.revision,7);assert.deepEqual(ns.secrets,[{path:['privateSetting'],set:true}]);assert.equal(ns.value.privateSetting,undefined);
 const input={ns:'agent-loop',expectedRevision:7,ops:[{op:'set',path:['maxParallelToolCalls'],value:8}]},queued=await f.queue('settings','mutate',input,'cas-once');assert.equal(queued.status,202,JSON.stringify(queued.json));const id=queued.json.action.id,action=f.polled(id);
 assert.equal(action.payload.runtime,undefined);assert.equal(action.payload.employeeId,undefined);assert.equal(action.payload.prompt,undefined);assert.deepEqual(action.payload.dshOperation.scope,{kind:'bot'});
 assert.equal((await f.queue('settings','mutate',input,'cas-once')).json.action.id,id);
 assert.deepEqual(await delivery.execute(action),{state:'confirmed',status:'succeeded'});assertDelivered(f,id);assert.equal(f.native.count('settings/mutate'),1);
 assert.deepEqual(await delivery.execute(action),{state:'confirmed',status:'succeeded'});assert.equal(f.native.count('settings/mutate'),1);
 state=await f.read();ns=state.resources.settings.data.namespaces[0];assert.equal(ns.revision,8);assert.equal(ns.value.maxParallelToolCalls,8);assert.equal(ns.user.maxParallelToolCalls,8);assert.equal(state.resources.settings.application,'applied');
 assert.equal((await f.queue('settings','mutate',input,'stale-cas')).status,409);assert.equal(f.native.count('settings/mutate'),1);
 const publicAction=await request(f.app,`/api/workspaces/${SLUG}/actions/${id}`,{cookie:f.cookie});assert.equal(publicAction.status,200);assert.doesNotMatch(JSON.stringify({state,publicAction,posts:f.posts}),new RegExp(SECRET));
 assert.equal(f.db.prepare('SELECT count(*) n FROM tasks').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM hermes_bots').get().n,0);
});

test('empty platform conversation binds its created native session and Plan/preset controls use real gates',async t=>{
 const f=fixture(t),{delivery}=f.runner(),created=await request(f.app,`/api/workspaces/${SLUG}/conversations`,{cookie:f.cookie,method:'POST',body:{employeeId:f.employee.id,title:'Native session fixture'}});assert.equal(created.status,201,JSON.stringify(created.json));const conversationId=created.json.id;
 assert.equal((await f.read(conversationId)).scope.nativeSessionId,null);
 const early=await f.queue('plan','set',{active:true},'before-create',conversationId);assert.equal(early.status,409);assert.equal(early.json.code,'DSH_NATIVE_SESSION_NOT_BOUND');
 const queued=await f.queue('sessions','create',{agentPreset:'standard'},'native-create',conversationId);assert.equal(queued.status,202,JSON.stringify(queued.json));const createId=queued.json.action.id;
 assert.deepEqual(await delivery.execute(f.polled(createId)),{state:'confirmed',status:'succeeded'});assertDelivered(f,createId);
 const binding=f.db.prepare('SELECT * FROM conversation_dsh_sessions WHERE conversation_id=?').get(conversationId);assert.equal(binding.session_id,'fixture-session-1');assert.equal(binding.device_id,f.pair.deviceId);assert.equal(binding.bot_name,'alpha');
 let state=await f.read(conversationId);assert.equal(state.scope.nativeSessionId,binding.session_id);assert.equal(state.resources.sessions.data.sessionId,binding.session_id);
 assert.equal((await f.queue('sessions','create',{agentPreset:'standard'},'second-create',conversationId)).json.code,'DSH_NATIVE_SESSION_ALREADY_BOUND');assert.equal(f.native.count('session/create'),1);
 for(const [resource,operation,input,key] of [['plan','set',{active:true},'plan-on'],['plan','set',{active:true},'plan-on-again'],['presets','select',{agentPreset:'native-custom'},'custom-preset']]){
  const response=await f.queue(resource,operation,input,key,conversationId);assert.equal(response.status,202,JSON.stringify(response.json));assert.deepEqual(await delivery.execute(f.polled(response.json.action.id)),{state:'confirmed',status:'succeeded'});assertDelivered(f,response.json.action.id);
 }
 assert.equal(f.native.count('commands/execute'),1);assert.equal(f.native.count('agentPresets/select'),1);state=await f.read(conversationId);assert.equal(state.resources.sessions.data.projections.values.agentPreset,'native-custom');assert.equal(state.resources.plan.data.effectiveActive,true);assert.equal(state.resources.plan.data.projections.values.plan.detail,'# Fixture native plan');
 f.native.sessions.get(binding.session_id).blank=false;
 const blocked=await f.queue('presets','select',{agentPreset:'standard'},'used-native-session',conversationId);assert.equal(blocked.status,202);assert.deepEqual(await delivery.execute(f.polled(blocked.json.action.id)),{state:'confirmed',status:'failed'});assertDelivered(f,blocked.json.action.id,'failed');assert.equal(f.native.count('agentPresets/select'),1);assert.equal(f.repo.getA2AAction(blocked.json.action.id).result.dshNative.reasonCode,'DSH_PRESET_REQUIRES_NEW_CONVERSATION');
});

test('unknown native mutation survives executor and delivery restart without repeating the write or changing its target',async t=>{
 const f=fixture(t),first=f.runner();await first.delivery.execute(f.polled(await f.refresh()));
 const input={ns:'agent-loop',expectedRevision:7,ops:[{op:'set',path:['maxParallelToolCalls'],value:9}]},queued=await f.queue('settings','mutate',input,'ambiguous-mutation');assert.equal(queued.status,202);const id=queued.json.action.id,action=f.polled(id);
 f.native.dropMutationResponse();f.failResults(true);await assert.rejects(first.delivery.execute(action),/fixture result transport outage/);assert.equal(f.native.count('settings/mutate'),1);assert.equal(f.repo.getA2AAction(id).status,'acked');
 await first.execute.close();const restarted=f.runner({dispatcherDirectory:path.join(f.directory,'fresh-dispatcher')}),replayed=await restarted.dispatcher.dispatch(action);assert.ok(replayed.result,JSON.stringify(replayed));assert.equal(replayed.result.dshNative.status,'unknown');assert.equal(f.native.count('settings/mutate'),1);
 f.failResults(false);assert.deepEqual(await restarted.delivery.execute(action),{state:'confirmed',status:'failed'});assert.equal(f.native.count('settings/mutate'),1);const receipt=f.posts.find(call=>call.id===id&&call.operation==='result');assert.equal(receipt.body.result.dshNative.status,'unknown');assert.equal((await f.read()).resources.settings.status,'unknown');
 assert.equal((await f.queue('settings','mutate',input,'ambiguous-mutation')).json.action.id,id);
 const changed=await request(f.app,`/api/workspaces/${SLUG}/employees/${f.employee.id}`,{cookie:f.cookie,method:'PATCH',body:{runtimeProfile:'beta'}});assert.equal(changed.status,200,JSON.stringify(changed.json));
 const repeated=await f.queue('settings','mutate',input,'ambiguous-mutation');assert.equal(repeated.status,409);assert.equal(repeated.json.code,'DSH_NATIVE_SUBJECT_CHANGED');assert.equal(f.repo.getA2AAction(id).payload.dshOperation.subject.profile,'alpha');assert.equal(f.native.count('settings/mutate'),1);
});

test('mounted encrypted relay, local crypto and real delivery mutate secret settings without persisting plaintext',async t=>{
 const f=fixture(t),management=createManagementService(f.repo),nativeService=createDshNativeService(f.repo,{management}),secretService=createDshNativeSecrets(f.repo,{management,nativeService}),secureApp=express(),keys=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}}),secretCalls=[];
 t.after(()=>secretService.close());secureApp.use(express.json());
 const requireRole=(...roles)=>(req,res,next)=>{req.auth=f.auth.authenticate(req);if(!req.auth)return res.status(401).json({code:'AUTH_REQUIRED'});const access=f.auth.canAccess(req.auth.user_id,req.params.slug);if(!access||!roles.includes(access.role))return res.status(403).json({code:'ROLE_REQUIRED'});req.workspaceRole=access.role;next();};
 const employeeContext=req=>({actorUserId:req.auth.user_id,actorRole:req.workspaceRole,enforceEmployeeVisibility:true});
 secureApp.use('/a2a',(req,res,next)=>{req.deviceCredential=f.repo.authenticateDeviceToken(req.headers['x-ziwei-device-token'],{workspaceSlug:req.body.workspace});if(!req.deviceCredential)return res.status(401).json({code:'DEVICE_REQUIRED'});next();});
 mountDshNativeRoutes(secureApp,{service:nativeService,secretService,requireRole,mcpGuard:(_req,res)=>res.status(401).json({code:'MCP_REQUIRED'}),mcpEmployeeGuard:(_req,res)=>res.status(401).json({code:'MCP_REQUIRED'}),employeeContext,mcpContext:employeeContext});
 secureApp.use((error,_req,res,_next)=>res.status(error.status||500).json({code:error.code||'FIXTURE_ERROR'}));
 const secureFetch=async(url,options)=>{
  const address=new URL(url);assert.equal(address.origin,'https://workspace.fixture');secretCalls.push({path:address.pathname,method:options.method});
  const response=await request(address.pathname.includes('/device/register')?f.app:secureApp,address.pathname,{method:options.method,token:options.headers['x-ziwei-device-token'],body:JSON.parse(options.body)});
  return Response.json(response.json,{status:response.status});
 };
 const store={deviceIdentity:()=>({publicKey:keys.publicKey}),openBoundSecret:(binding,envelope)=>openSecret(keys.privateKey,binding,envelope)},runner=f.runner({dshSecretFetch:secureFetch,dshSecretStore:store});
 await runner.delivery.execute(f.polled(await f.refresh()));
 const register=await request(f.app,`/api/workspaces/${SLUG}/bot-provider-credentials/device/register`,{method:'POST',token:f.pair.deviceToken,body:{publicKey:keys.publicKey}});assert.equal(register.status,200,JSON.stringify(register.json));
 const body={resource:'settings',operation:'mutateSecure',input:{ns:'agent-loop',expectedRevision:7},expectedSubjectHash:(await f.read()).subjectHash,idempotencyKey:'secure-cas'};
 const prepared=await request(secureApp,f.base+'/secure-requests',{method:'POST',cookie:f.cookie,body});assert.equal(prepared.status,202,JSON.stringify(prepared.json));const {requestId,binding,devicePublicKey,action}=prepared.json;
 assert.equal(prepared.json.state,'waiting');assert.equal(binding.purpose,'dsh-native-secret');assert.equal(binding.actionId,action.id);assert.equal(binding.deviceId,f.pair.deviceId);assert.equal(binding.profile,'alpha');
 const plaintext={ops:[{op:'set',path:['privateSetting'],value:SECRET+'-updated'}]},envelope=sealSecret(devicePublicKey,binding,JSON.stringify(plaintext));
 const answer=await request(secureApp,f.base+`/secure-requests/${requestId}/answer`,{method:'POST',cookie:f.cookie,body:{envelope}});assert.equal(answer.status,200,JSON.stringify(answer.json));assert.deepEqual(answer.json,{requestId,state:'ready'});
 const original=f.polled(action.id);assert.deepEqual(original.payload.dshOperation.input,{ns:'agent-loop',expectedRevision:7,secretRequestId:requestId});assert.doesNotMatch(JSON.stringify(original),new RegExp(SECRET));
 assert.deepEqual(await runner.delivery.execute(original),{state:'confirmed',status:'succeeded'});assertDelivered(f,action.id);assert.equal(f.native.count('settings/mutate'),1);
 assert.deepEqual(secretCalls.map(call=>call.path),[`/api/workspaces/${SLUG}/bot-provider-credentials/device/register`,`/a2a/v1/actions/${action.id}/dsh-native/secrets/${requestId}/claim`]);
 const state=await f.read(),ns=state.resources.settings.data.namespaces[0];assert.equal(ns.revision,8);assert.equal(ns.value.privateSetting,undefined);assert.equal(ns.user.privateSetting,undefined);assert.deepEqual(ns.secrets,[{path:['privateSetting'],set:true}]);
 const stored=f.db.prepare('SELECT payload_json,result_json,error FROM a2a_actions WHERE id=?').get(action.id),events=f.db.prepare('SELECT data_json,message FROM a2a_action_events WHERE action_id=?').all(action.id);
 assert.doesNotMatch(JSON.stringify({prepared,answer,state,stored,events,posts:f.posts}),new RegExp(SECRET));assert.doesNotMatch(JSON.stringify({stored,events}),/ciphertext|wrappedKey/);
 const files=fs.readdirSync(f.directory,{recursive:true}).filter(file=>file.endsWith('.json')).map(file=>fs.readFileSync(path.join(f.directory,file),'utf8'));assert.equal(files.some(text=>text.includes(SECRET)||text.includes(envelope.ciphertext)),false);
 const claimedAgain=await request(secureApp,`/a2a/v1/actions/${action.id}/dsh-native/secrets/${requestId}/claim`,{method:'POST',token:f.pair.deviceToken,body:{workspace:SLUG}});assert.equal(claimedAgain.status,409);
});
