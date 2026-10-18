// Exercise the real authenticated Express routes in memory, without listeners.
import test from 'node:test';
import assert from 'node:assert/strict';
import {IncomingMessage,ServerResponse} from 'node:http';
import {Duplex} from 'node:stream';
import {createApp} from './app.mjs';
import {createManagementService} from './management.mjs';
import {completeOwnedProfile} from '../test-support/owned-profile.mjs';

function request(app,url,{cookie='',authorization='',method='GET',body}={}) {
  const socket=new Duplex({read(){},write(_data,_encoding,done){done();}});
  const req=new IncomingMessage(socket),res=new ServerResponse(req),chunks=[];
  const bytes=body===undefined?null:Buffer.from(JSON.stringify(body));
  req.method=method;req.url=url;req.headers={host:'deferred.fixture',cookie,authorization,...(bytes?{'content-type':'application/json','content-length':String(bytes.length)}:{})};
  return new Promise((resolve,reject)=>{
    res.write=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));done?.();return true;};
    res.end=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));done?.();const data=Buffer.concat(chunks);resolve({status:res.statusCode,json:data.length?JSON.parse(data.toString()):null});res.emit('finish');socket.destroy();return res;};
    req.on('error',reject);res.on('error',reject);app.handle(req,res,error=>reject(error||new Error('Unhandled fixture route')));if(bytes)req.push(bytes);req.push(null);
  });
}
function fixture(t) {
  const slug='queued-config',deviceId='route-config-pc',token='isolated-route-management-token';
  const app=createApp({memory:true,requireAuth:true,enableScheduler:false,mcpToken:token,mcpWorkspace:slug,mcpRole:'admin'});
  const repo=app.locals.repo,auth=app.locals.auth;
  t.after(()=>{app.locals.botDeferredConfig.stop();repo.db.close();});
  const owner=auth.setup({email:'owner@deferred.fixture',password:'isolated-deferred-fixture-password'});
  auth.createWorkspace(owner.user_id,{slug,name:'Deferred configuration',kind:'team'});
  repo.heartbeatDevice(slug,{deviceId,runtimeDiscovery:{features:['bot_mcp_oauth_relay_v1']},runtimes:{Hermes:{status:'available',version:'0.22.0',profiles:[{name:'default'}]}}});
  const context={actorUserId:owner.user_id,enforceEmployeeVisibility:true};
  const bots=createManagementService(repo).bots;
  const bot=bots.create(slug,{name:'Route Bot',sourceProfile:'default',targetDeviceId:deviceId,model:'gpt-6.1-sol',idempotencyKey:'route-create'},context);
  completeOwnedProfile(repo,bot);
  const proof={launched:true,rootPid:321,rootConfirmed:true,treeConfirmed:true,activeProcesses:0,rootExitCode:0,hostExitCode:0,cancelled:false};
  const complete=(action,result={processExit:proof})=>{repo.ackA2AAction(action.id,{deviceId});return repo.resultA2AAction(action.id,{deviceId,status:'succeeded',result});};
  const validation=bots.validate(slug,bot.id,{expectedRevision:1,idempotencyKey:'route-initial-validate'},context).action;
  complete(validation,{botValidation:{schemaVersion:1,valid:true,employeeId:bot.id,revision:1},processExit:proof});
  bots.control(slug,bot.id,{expectedRevision:1,expectedControlEpoch:1,operation:'activate'},context);
  const current=()=>bots.get(slug,bot.id,context),cookie=`ziwei_session=${owner.session.token}`;
  const source=repo.addConversationMessage(bot.main_conversation_id,{content:'isolated original turn'}).execution;
  repo.ackA2AAction(source.id,{deviceId});
  const url=`/api/workspaces/${slug}/bots/${bot.id}`,value=current();
  const config={...value.config,mcpServers:{...value.config.mcpServers,viral_library:{transport:'http',url:'https://viral.example.invalid/mcp',auth:'oauth',oauth:{cimd:false,scope:'library:read library:collect'},enabled:true}}};
  const body={deferUntilIdle:true,expectedRevision:value.revision,expectedControlEpoch:value.control_epoch,idempotencyKey:'route-config-once',config,connectMcpServers:['viral_library']};
  return{app,repo,bots,bot,slug,deviceId,context,cookie,token,source,current,url,body,proof};
}

test('owner HTTP update returns 202 without changing the live revision; get stays read-only and retry returns the original intent',async t=>{
  const f=fixture(t),before=JSON.stringify(f.repo.getA2AAction(f.source.id));
  const first=await request(f.app,f.url,{method:'PATCH',cookie:f.cookie,body:f.body});
  assert.equal(first.status,202);assert.equal(first.json.deferredConfig.state,'pending');assert.equal(first.json.revision,1);
  assert.equal(first.json.deferredConfig.blockingActionId,f.source.id);
  const again=await request(f.app,f.url,{method:'PATCH',cookie:f.cookie,body:f.body});
  assert.equal(again.status,202);assert.equal(again.json.duplicate,true);assert.equal(again.json.deferredConfig.id,first.json.deferredConfig.id);
  const read=await request(f.app,f.url,{cookie:f.cookie});
  assert.equal(read.status,200);assert.equal(read.json.deferredConfig.state,'pending');assert.equal(read.json.revision,1);
  assert.equal(JSON.stringify(f.repo.getA2AAction(f.source.id)),before);
  const invalid=await request(f.app,f.url,{method:'PATCH',cookie:f.cookie,body:{...f.body,config:{...f.body.config,provider:'changed'}}});
  assert.equal(invalid.status,409);assert.equal(invalid.json.code,'BOT_DEFERRED_IDEMPOTENCY_CONFLICT');
});

test('the app-owned processor receives committed source completions and queues only one real native validation',async t=>{
  const f=fixture(t);
  f.app.locals.botDeferredConfig.start({...f.app.locals.botMcpConnections.deferredHandlers,pollIntervalMs:0});
  const queued=await request(f.app,f.url,{method:'PATCH',cookie:f.cookie,body:f.body});assert.equal(queued.status,202);
  f.repo.resultA2AAction(f.source.id,{deviceId:f.deviceId,status:'succeeded',result:{processExit:f.proof,output:'original result retained'}});
  await Promise.resolve();
  const current=f.current();assert.equal(current.revision,2);assert.equal(current.control_state,'draft');assert.equal(current.deferredConfig.state,'validating');
  const validation=f.repo.getA2AAction(current.deferredConfig.validationActionId);assert.equal(validation.type,'hermes.bot.validate');assert.equal(validation.payload.hermesBot.config.mcpServers.viral_library.auth,'oauth');
  f.repo.resultA2AAction(f.source.id,{deviceId:f.deviceId,status:'succeeded',result:{processExit:f.proof}});await Promise.resolve();
  assert.equal(f.current().deferredConfig.validationActionId,validation.id);
  assert.equal(f.repo.getA2AAction(f.source.id).result.output,'original result retained');
});

test('an installed MCP client receives a self-service busy hint, but an unbound static credential cannot create a durable intent',async t=>{
  const f=fixture(t),url=`/mcp/v1/workspaces/${f.slug}/bots/${f.bot.id}`,authorization=`Bearer ${f.token}`;
  const busy=await request(f.app,url,{method:'PATCH',authorization,body:{expectedRevision:1,config:f.body.config}});
  assert.equal(busy.status,409);assert.equal(busy.json.code,'BOT_BUSY');assert.match(busy.json.error,/deferUntilIdle:true/);assert.match(busy.json.error,/expectedControlEpoch:2/);assert.match(busy.json.error,/提交后结束本轮/);
  const blocked=await request(f.app,url,{method:'PATCH',authorization,body:f.body});
  assert.equal(blocked.status,409);assert.equal(blocked.json.code,'BOT_DEFERRED_ACTOR_REQUIRED');
  const denied=await request(f.app,f.url,{method:'PATCH',body:f.body});assert.equal(denied.status,401);
  assert.equal(f.repo.db.prepare('SELECT count(*) AS n FROM bot_deferred_configs').get().n,0);
});
