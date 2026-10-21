// Real middleware and in-memory SQLite; no listener, client, model, or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {IncomingMessage,ServerResponse} from 'node:http';
import {Duplex} from 'node:stream';
import {createApp} from './app.mjs';
import {createManagementService} from './management.mjs';
import {completeOwnedProfile} from '../test-support/owned-profile.mjs';
import {createBotWorkbenchActionReader} from './bot-workbench-view.mjs';
import {deriveBotCapabilities} from './bot-capabilities.mjs';

async function request(app,url,cookie='') {
  const socket=new Duplex({read(){},write(_chunk,_encoding,done){done();}}),req=new IncomingMessage(socket),res=new ServerResponse(req),chunks=[];
  req.method='GET';req.url=url;req.headers={host:'bot-page.fixture',cookie};
  try{return await new Promise((resolve,reject)=>{
    res.write=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.from(chunk,encoding));done?.();return true;};
    res.end=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));done?.();const bytes=Buffer.concat(chunks);resolve({status:res.statusCode,headers:res.getHeaders(),bytes,json:JSON.parse(bytes.toString())});res.emit('finish');return res;};
    req.on('error',reject);res.on('error',reject);app.handle(req,res,error=>reject(error||new Error('Unhandled fixture request')));req.push(null);
  });}finally{socket.destroy();}
}
const tree={rootConfirmed:true,rootExitCode:0,treeConfirmed:true,activeProcesses:0};
const history='PRIVATE_OLD_PROMPTS_AND_NATIVE_OUTPUT_'.repeat(30000),avatar='data:image/png;base64,'+'A'.repeat(794784);
function fixture(t){
  const app=createApp({memory:true,requireAuth:true}),repo=app.locals.repo,db=repo.db,auth=app.locals.auth;
  const owner=auth.setup({email:'bot-page-owner@fixture.test',password:'isolated-fixture-password'}),slug='bot-page-perf';
  auth.createWorkspace(owner.user_id,{slug,name:'Bot page fixture',kind:'team'});
  auth.createWorkspace(owner.user_id,{slug:'bot-page-other',name:'Other fixture',kind:'team'});
  const ws=repo.getWorkspace(slug),context={actorUserId:owner.user_id,actorRole:'owner'},bots=createManagementService(repo).bots;
  const member=auth.register({email:'bot-page-member@fixture.test',password:'isolated-fixture-password'});
  db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run('bot-page-member',ws.id,member.user_id,'Member','bot-page-member@fixture.test','member','2026-01-01T00:00:00.000Z');
  const outsider=auth.register({email:'bot-page-outsider@fixture.test',password:'isolated-fixture-password'});
  repo.heartbeatDevice(slug,{deviceId:'page-pc',runtimes:{Hermes:{status:'available',version:'0.22.0',profiles:[{name:'default'}]}}});
  const bot=bots.create(slug,{name:'Original Bot',description:'Original role',persona:'Original persona',instructions:'Original instructions',targetDeviceId:'page-pc',sourceProfile:'default',avatar,visibility:'workspace',idempotencyKey:'page-create'},context);
  completeOwnedProfile(repo,bot);
  repo.heartbeatDevice(slug,{deviceId:'page-pc',runtimes:{Hermes:{status:'available',version:'0.22.0',profiles:[{name:'default'},{name:bot.instance.profile,readiness:{authentication:'configured',provider:'configured',ready:true}}]}}});
  const payload={runtime:'Hermes',employeeId:bot.id,deviceId:'page-pc',profile:bot.instance.profile,prompt:history,hermesBot:{schemaVersion:1,workspace:slug,employeeId:bot.id,deviceId:'page-pc',revision:1,controlEpoch:1,sourceProfile:bot.instance.profile}};
  const insert=db.prepare('INSERT INTO a2a_actions(id,workspace_id,agent_id,type,payload_json,dedupe_key,status,created_at,acked_at,completed_at,result_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  function action(id,{status='failed',type='conversation.execute',stamp='2099-01-01T00:00:00.000Z',result={output:history,processExit:tree,code:'EXECUTION_UNCERTAIN',executionState:'uncertain'},patch={}}={}){
    insert.run(id,ws.id,'ziwei_user',type,JSON.stringify({...payload,...patch}),id,status,stamp,stamp,status==='acked'?null:stamp,JSON.stringify(result));
    db.prepare('INSERT INTO a2a_action_events(id,action_id,type,data_json,created_at) VALUES(?,?,?,?,?)').run('event-'+id,id,status,JSON.stringify({result:{output:history}}),stamp);
  }
  action('page-original-unknown');db.prepare('UPDATE hermes_bots SET active_action_id=? WHERE employee_id=?').run('page-original-unknown',bot.id);
  t.after(()=>{bots.deferredConfig.stop();db.close();});
  return {app,repo,db,auth,owner,slug,ws,context,bots,bot,action,cookie:`ziwei_session=${owner.session.token}`,memberCookie:`ziwei_session=${member.session.token}`,outsiderCookie:`ziwei_session=${outsider.session.token}`};
}

test('desktop roster omits historical blobs and inline avatars without reading full actions',async t=>{
  const f=fixture(t),before=f.repo.getA2AAction('page-original-unknown'),base=`/api/workspaces/${f.slug}/bots`;
  const originalRead=f.repo.getA2AAction;let reads=0;f.repo.getA2AAction=(...args)=>{reads++;return originalRead.apply(f.repo,args);};
  const response=await request(f.app,base+'?view=roster',f.cookie);
  assert.equal(response.status,200);assert.equal(reads,0);assert(response.bytes.length<12000);assert(!response.bytes.includes(Buffer.from('PRIVATE_OLD_PROMPTS')));assert(!response.bytes.includes(Buffer.from('data:image/')));
  const bot=response.json.bots.find(item=>item.id===f.bot.id);
  assert.equal(bot.employee.name,'Original Bot');assert.equal(bot.employee.target_device_id,'page-pc');assert.equal(bot.employee.runtime_profile,f.bot.instance.profile);
  assert.match(bot.employee.avatar,/\/avatar\?v=[a-f0-9]{64}$/);assert.equal(bot.main_conversation_id,f.bot.main_conversation_id);assert.equal(bot.rosterView.configurationIncluded,false);assert.equal(bot.config,undefined);
  assert.equal(bot.latest_run.id,'page-original-unknown');assert.equal(bot.latest_run.result.executionState,'uncertain');assert.deepEqual(bot.latest_run.result.processExit,tree);assert.equal(bot.latest_run.events,undefined);
  assert.equal(response.headers['cache-control'],'no-store');assert.match(response.headers.vary,/Cookie/);
  f.repo.getA2AAction=originalRead;assert.deepEqual(f.repo.getA2AAction('page-original-unknown'),before);assert.equal(f.repo.getEmployee(f.bot.id).avatar,avatar);
});

test('roster keeps an older active unknown execution visible behind a newer read-only inspection',t=>{
  const f=fixture(t);
  f.action('page-new-inspection',{type:'hermes.bot.native',stamp:'2100-01-01T00:00:00.000Z',status:'succeeded',result:{processExit:tree,nativeOperation:{resource:'sessions',status:'succeeded'}},patch:{nativeOperation:{resource:'sessions',operation:'list',input:{}}}});
  const bot=f.bots.list(f.slug,f.context,{view:'roster'}).find(item=>item.id===f.bot.id);
  assert.equal(bot.active_run.id,'page-original-unknown');assert.equal(bot.latest_run.id,'page-original-unknown');assert.equal(bot.latest_run.status,'failed');assert.equal(bot.latest_run.result.executionState,'uncertain');
});

test('workbench keeps editable configuration and precise evidence while full endpoints preserve original bodies',async t=>{
  const f=fixture(t),path=`/api/workspaces/${f.slug}/bots/${f.bot.id}`;
  const original=f.bots.get(f.slug,f.bot.id,f.context),before=f.repo.getA2AAction('page-original-unknown');
  const originalRead=f.repo.getA2AAction;let reads=0;f.repo.getA2AAction=(...args)=>{reads++;return originalRead.apply(f.repo,args);};
  const response=await request(f.app,path+'?view=workbench',f.cookie),value=response.json;
  assert.equal(response.status,200);assert.equal(reads,0);assert(response.bytes.length<45000);assert(!response.bytes.includes(Buffer.from('PRIVATE_OLD_PROMPTS')));assert(!response.bytes.includes(Buffer.from('data:image/')));
  assert.deepEqual(value.config,original.config);assert.deepEqual(value.instance,original.instance);assert.equal(value.employee.persona,original.employee.persona);assert.equal(value.employee.instructions,original.employee.instructions);
  assert.equal(value.workbenchView.nativeContentIncluded,false);assert.equal(value.active_run.id,'page-original-unknown');assert.equal(value.latest_run.result.executionState,'uncertain');assert.deepEqual(value.latest_run.result.processExit,tree);
  f.repo.getA2AAction=originalRead;
  const full=await request(f.app,path,f.cookie),runs=await request(f.app,path+'/runs',f.cookie);
  assert.equal(full.json.latest_run.result.output,history);assert.equal(full.json.latest_run.events[0].data.result.output,history);assert.equal(full.json.employee.avatar,avatar);
  assert.equal(runs.json.runs[0].payload.prompt,history);assert.deepEqual(f.repo.getA2AAction('page-original-unknown'),before);
  t.diagnostic(`Bot detail JSON bytes: full=${full.bytes.length}, workbench=${response.bytes.length}`);
});

test('desktop projections keep workspace membership, employee visibility and paired-device scopes',async t=>{
  const f=fixture(t);f.repo.heartbeatDevice(f.slug,{deviceId:'other-pc',runtimes:{Hermes:{status:'available',profiles:[{name:'default'}]}}});
  const personal=f.repo.createEmployee(f.slug,{name:'Owner only',runtime:'Hermes',targetDeviceId:'page-pc',visibility:'personal',ownerUserId:f.owner.user_id}),other=f.repo.createEmployee(f.slug,{name:'Other computer',runtime:'Hermes',targetDeviceId:'other-pc',visibility:'workspace'});
  for(const query of ['roster','workbench']){
    const route=query==='roster'?`/api/workspaces/${f.slug}/bots?view=roster`:`/api/workspaces/${f.slug}/bots/${f.bot.id}?view=workbench`;
    assert.equal((await request(f.app,route)).status,401);assert.equal((await request(f.app,route,f.outsiderCookie)).status,403);
  }
  const member=await request(f.app,`/api/workspaces/${f.slug}/bots?view=roster`,f.memberCookie);assert.equal(member.status,200);assert(!member.json.bots.some(item=>item.id===personal.id));
  assert.equal((await request(f.app,`/api/workspaces/${f.slug}/bots/${personal.id}?view=workbench`,f.memberCookie)).status,404);
  assert.equal((await request(f.app,`/api/workspaces/bot-page-other/bots/${f.bot.id}?view=workbench`,f.cookie)).status,404);
  const scoped={deviceCredentialDeviceId:'page-pc',deviceScope:'page-pc'};assert(!f.bots.list(f.slug,scoped,{view:'roster'}).some(item=>item.id===other.id));
  assert.throws(()=>f.bots.list(f.slug,{deviceCredentialDeviceId:'page-pc'},{view:'roster'}),{code:'BOT_DEVICE_SCOPE_REQUIRED'});
});

test('opt-in views leave default and mobile contracts intact and do not activate on ambiguous query values',async t=>{
  const f=fixture(t),path=`/api/workspaces/${f.slug}/bots/${f.bot.id}`,base=`/api/workspaces/${f.slug}/bots`;
  const full=await request(f.app,path,f.cookie),mobile=await request(f.app,path+'?view=mobile',f.cookie);
  assert.equal(mobile.json.latest_run.result.output,history);assert.equal(mobile.json.workbenchView,undefined);assert.equal(mobile.json.managementView,undefined);assert.match(mobile.json.employee.avatar,/\/avatar\?v=/);
  for(const suffix of ['?view=desktop','?view=workbench&view=desktop'])assert.deepEqual((await request(f.app,path+suffix,f.cookie)).json,full.json);
  for(const suffix of ['', '?view=roster&view=desktop']){
    const response=await request(f.app,base+suffix,f.cookie);assert.equal(response.json.bots[0].rosterView,undefined);assert.equal(response.json.bots[0].latest_run.result.output,history);
  }
});

test('workbench capability states match full receipts for model, images, skills, groups, goals, heartbeat, work, voice and gateway',t=>{
  const f=fixture(t),exit={...tree,launched:true,rootPid:987,cancelled:false};
  f.db.prepare('UPDATE hermes_bots SET active_action_id=NULL WHERE employee_id=?').run(f.bot.id);
  const validation=f.bots.validate(f.slug,f.bot.id,{expectedRevision:1,idempotencyKey:'page-validate'},f.context).action;
  f.repo.ackA2AAction(validation.id,{deviceId:'page-pc'});f.repo.resultA2AAction(validation.id,{status:'succeeded',result:{botValidation:{schemaVersion:1,employeeId:f.bot.id,revision:1,valid:true},processExit:exit}});
  const active=f.bots.control(f.slug,f.bot.id,{expectedRevision:1,expectedControlEpoch:1,operation:'activate'},f.context);
  const config=f.bots.get(f.slug,f.bot.id,f.context).config;
  config.collaboration={enabled:true,targetEmployeeIds:['fixture-peer']};config.gateway={platforms:{discord:{enabled:true}}};config.voice={stt:{provider:'fixture',enabled:true}};
  f.db.prepare('UPDATE hermes_bots SET config_json=? WHERE employee_id=?').run(JSON.stringify(config),f.bot.id);
  const binding={schemaVersion:1,workspace:f.slug,employeeId:f.bot.id,deviceId:'page-pc',revision:1,controlEpoch:active.control_epoch,sourceProfile:f.bot.instance.profile};
  const add=(id,resource,operation,data,extra={})=>f.action(id,{status:'succeeded',type:resource?'hermes.bot.native':'conversation.execute',stamp:`2100-01-01T00:00:${String(10+Number(id.slice(-1))).padStart(2,'0')}.000Z`,patch:{hermesBot:binding,...(resource?{nativeOperation:{resource,operation,input:{}}}:{}),...extra},result:{processExit:exit,...(resource?{nativeOperation:{schemaVersion:2,employeeId:f.bot.id,revision:1,resource,operation,status:'succeeded',data}}:{}),output:history}});
  add('capability-0',null,null,null,{attachments:[{mimeType:'image/png',content:history}]});
  add('capability-1','skills','list',{items:[{content:history},{content:history}]});
  add('capability-2','groups','list',{items:[{members:[history]}]});
  add('capability-3','goals','read',{state:{status:'active',content:history},run:false});
  add('capability-4','heartbeat','read',{state:{status:'paused',content:history}});
  add('capability-5','kanban','list',{items:[{content:history},{content:history},{content:history}]});
  add('capability-6','voice','transcribe',{transcript:'Actual private transcription '+history});
  add('capability-7','gateway','connect',{connected:true});
  add('capability-8','gateway','status',{runtime:[{platform:'discord',employeeId:f.bot.id,revision:1,controlEpoch:active.control_epoch,status:'connected',processAlive:true,lastHeartbeat:Date.now()/1000,sourceActionId:'capability-7',privateBody:history}]});
  add('capability-9','mcp','inspect',{connected:true,tools:[]});
  const full=f.bots.get(f.slug,f.bot.id,f.context),summary=f.bots.get(f.slug,f.bot.id,f.context,{view:'workbench'});
  assert.deepEqual(summary.capabilities,full.capabilities);assert.deepEqual(summary.capabilityGate,full.capabilityGate);
  for(const id of ['model_provider','multimodal','skills','groups_mentions','kanban','voice','gateway','tools_mcp'])assert.equal(summary.capabilities.find(cap=>cap.id===id).state,'ready',id+':'+JSON.stringify({reason:summary.capabilities.find(cap=>cap.id===id).reason,gate:summary.capabilityGate,validation:summary.validation}));
  assert.equal(summary.capabilities.find(cap=>cap.id==='goals').state,'enabled');assert.equal(summary.capabilities.find(cap=>cap.id==='heartbeat').state,'disabled');
  assert(!JSON.stringify(summary).includes('PRIVATE_OLD_PROMPTS'));assert(JSON.stringify(summary).length<45000);
});

test('workbench phone evidence preserves only identity and tool metadata while giving the same capability decision',t=>{
  const f=fixture(t),read=createBotWorkbenchActionReader(f.repo),exit={...tree,launched:true,rootPid:987,cancelled:false},binding={schemaVersion:1,workspace:f.slug,employeeId:f.bot.id,deviceId:'page-pc',revision:1,controlEpoch:1,sourceProfile:f.bot.instance.profile};
  const phoneMcp={enabled:true,installed:true,attached:true,bound:true,revision:'phone-revision',phoneDeviceId:'phone-1',workspace:f.slug,employeeId:f.bot.id,targetDeviceId:'page-pc',runtime:'Hermes',runtimeProfile:f.bot.instance.profile};
  const terminalMcp={loaded:true,injected:true,workspace:f.slug,employeeId:f.bot.id,targetDeviceId:'phone-1',actionId:'phone-evidence',runtime:'Hermes',profile:f.bot.instance.profile,runtimeProfile:f.bot.instance.profile,serverName:'ziwei-terminal',toolCalls:[{toolName:'ziwei_phone_status',ok:true,deviceId:'phone-1',ids:{deviceId:'phone-1'},arguments:{private:history},output:history}]};
  f.action('phone-evidence',{status:'succeeded',result:{processExit:exit,terminalMcp,output:history},patch:{hermesBot:binding,terminalMcp:{enabled:true,workspace:f.slug,employeeId:f.bot.id,deviceId:'phone-1',configurationRevision:'phone-revision'}}});
  const bot={...f.bots.get(f.slug,f.bot.id,f.context),configuration_state:'initialized',control_state:'active',control_epoch:1,validation:{status:'succeeded',revision:1},employee:{...f.bot.employee,status:'active'}},input={bot,device:{id:'page-pc',status:'online'},runtime:{cli_status:'available',available:true,profiles:[{name:f.bot.instance.profile,readiness:{authentication:'configured',provider:'configured'}}]},capabilities:[{id:'tools_mcp'}],phoneMcp},full=f.repo.getA2AAction('phone-evidence'),compact=read('phone-evidence',f.ws.id);
  const original=deriveBotCapabilities({...input,actions:[full]}),projected=deriveBotCapabilities({...input,actions:[compact]});
  assert.deepEqual(projected,original);assert.equal(projected.capabilities[0].state,'ready');assert(!JSON.stringify(compact).includes('PRIVATE_OLD_PROMPTS'));assert.equal(compact.result.terminalMcp.toolCalls[0].ok,true);assert.equal(compact.result.terminalMcp.toolCalls[0].arguments,undefined);
});

test('workbench preserves pending-review, authentication, dependency and fixture classifications from original receipts',t=>{
  const f=fixture(t),read=createBotWorkbenchActionReader(f.repo),exit={...tree,launched:true,rootPid:987,cancelled:false};
  const bot={...f.bots.get(f.slug,f.bot.id,f.context),control_state:'active',validation:{status:'succeeded',revision:1},employee:{...f.bot.employee,status:'active'}};
  const input={bot,device:{id:'page-pc',status:'online'},runtime:{cli_status:'available',profiles:[{name:f.bot.instance.profile}]},capabilities:[{id:'profile_memory'}]};
  const cases=[
    {data:{staged:true},state:'needs_configuration'}, {data:{pending_id:'pending-review'},state:'needs_configuration'},
    {data:{mutation:{staged:true}},state:'needs_configuration'}, {data:{mutation:{pending_id:'pending-review'}},state:'needs_configuration'},
    {data:{code:'AUTHORIZATION_REQUIRED',reason:'请连接账户'},state:'needs_configuration'},
    {data:{code:'IMPORT_ERROR',error:'缺少模块'},state:'unavailable'},
    {data:{code:'NOT_SUPPORTED',reason:'版本不支持'},state:'unavailable'},
    {data:{},native:{executionSource:'fixture'},state:'enabled'},
    {data:{executionSource:'fixture'},state:'enabled'},
    {data:{},top:{fixture:true},state:'enabled'},
    {data:{},top:{executionSource:'fixture'},state:'enabled'},
    {data:{},top:{fixture:null},nestedFixture:true,state:'enabled'},
  ];
  for(const [index,scenario] of cases.entries()){
    const id='classification-'+index,nativeOperation={schemaVersion:2,resource:'memory',operation:'read',employeeId:f.bot.id,revision:1,status:'succeeded',data:{content:history,...scenario.data},...scenario.native};
    const value=scenario.nestedFixture?{...scenario.top,result:{processExit:exit,nativeOperation,fixture:true}}:{processExit:exit,nativeOperation,...scenario.top};
    f.action(id,{type:'hermes.bot.native',status:'succeeded',result:value,patch:{nativeOperation:{resource:'memory',operation:'read',input:{}}}});
    const full=f.repo.getA2AAction(id),compact=read(id,f.ws.id),original=deriveBotCapabilities({...input,actions:[full]}),projected=deriveBotCapabilities({...input,actions:[compact]});
    assert.deepEqual(projected,original,'classification '+index);assert.equal(projected.capabilities[0].state,scenario.state,'classification '+index);assert(!JSON.stringify(compact).includes('PRIVATE_OLD_PROMPTS'));
  }
});

test('root and nested legacy receipts never supply missing binding or completion proof to each other',t=>{
  const f=fixture(t),read=createBotWorkbenchActionReader(f.repo),exit={...tree,launched:true,rootPid:987,cancelled:false};
  const bot={...f.bots.get(f.slug,f.bot.id,f.context),control_state:'active',validation:{status:'succeeded',revision:1},employee:{...f.bot.employee,status:'active'}};
  const input={bot,device:{id:'page-pc',status:'online'},runtime:{cli_status:'available',profiles:[{name:f.bot.instance.profile}]},capabilities:[{id:'profile_memory'},{id:'tools_mcp'}]};
  const native={schemaVersion:2,resource:'memory',operation:'read',employeeId:f.bot.id,revision:1,status:'succeeded',data:{content:history}};
  const cases=[
    {result:{processExit:exit,nativeOperation:{schemaVersion:2,resource:'memory',operation:'read'},result:{nativeOperation:native,processExit:exit}}},
    {result:{processExit:exit,nativeOperation:'opaque receipt',result:{nativeOperation:native,processExit:exit}}},
    {result:{processExit:exit,nativeOperation:native,result:{nativeOperation:native}}},
    {result:{processExit:exit,nativeOperation:native,result:'opaque nested result'}},
    {result:{processExit:exit,nativeOperation:{...native,data:{}},result:{processExit:exit,nativeOperation:{...native,data:{code:'AUTHORIZATION_REQUIRED',staged:true,executionSource:'fixture'}}}}},
    {mcp:true,result:{processExit:exit,nativeOperation:{...native,resource:'mcp',operation:'inspect'},result:{processExit:exit,nativeOperation:{...native,resource:'mcp',operation:'inspect',data:{connected:true,tools:[]}}}}},
  ];
  for(const [index,scenario] of cases.entries()){
    const id='conflicting-receipt-'+index;f.action(id,{type:'hermes.bot.native',status:'succeeded',result:scenario.result,patch:{nativeOperation:scenario.mcp?{resource:'mcp',operation:'inspect',input:{}}:{resource:'memory',operation:'read',input:{}}}});
    const full=f.repo.getA2AAction(id),compact=read(id,f.ws.id);
    assert.deepEqual(deriveBotCapabilities({...input,actions:[compact]}),deriveBotCapabilities({...input,actions:[full]}),'conflict '+index);
    assert(!JSON.stringify(compact).includes('PRIVATE_OLD_PROMPTS'));
  }
});
