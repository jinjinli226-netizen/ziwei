import test from 'node:test';
import assert from 'node:assert/strict';
import {IncomingMessage,ServerResponse} from 'node:http';
import {Duplex} from 'node:stream';
import {randomUUID,createHash} from 'node:crypto';
import {createApp} from './app.mjs';
import {createManagementService} from './management.mjs';
import {mobileRunView,createMobileReadView} from './mobile-read-view.mjs';
import {completeOwnedProfile} from '../test-support/owned-profile.mjs';
import {rasterFixtures} from '../test/fixtures/raster-images.mjs';

async function request(app,url,{cookie='',headers={}}={}) {
  const socket=new Duplex({read(){},write(_chunk,_encoding,done){done();}});
  const req=new IncomingMessage(socket),res=new ServerResponse(req),chunks=[];
  req.method='GET';req.url=url;req.headers={host:'mobile-runs.fixture',cookie,...headers};
  try{return await new Promise((resolve,reject)=>{
    res.write=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk,encoding));done?.();return true;};
    res.end=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));done?.();const bytes=Buffer.concat(chunks);resolve({status:res.statusCode,bytes,json:()=>JSON.parse(bytes)});res.emit('finish');return res;};
    req.on('error',reject);res.on('error',reject);app.handle(req,res,error=>reject(error||new Error('Unhandled fixture request')));req.push(null);
  });}finally{socket.destroy();}
}
function fixture(t) {
  const mcpToken=randomUUID(),slug='mobile-run-media',app=createApp({memory:true,requireAuth:true,mcpToken,mcpWorkspace:slug,mcpRole:'owner'}),repo=app.locals.repo,auth=app.locals.auth;
  t.after(()=>repo.db.close());
  const owner=auth.setup({email:'mobile-run-owner@fixture.test',password:'isolated-fixture-password'});
  auth.createWorkspace(owner.user_id,{slug,name:'Mobile run media fixture',kind:'team'});
  const ws=repo.getWorkspace(slug),ownerCookie=`ziwei_session=${owner.session.token}`;
  repo.heartbeatDevice(slug,{deviceId:'mobile-run-pc',runtimes:{Hermes:{status:'available',version:'0.21.3',profiles:[{name:'default'}]}}});
  const bot=createManagementService(repo).bots.create(slug,{name:'Fixture Bot',targetDeviceId:'mobile-run-pc',runtimeProfile:'default',visibility:'workspace',idempotencyKey:'media-bot'},{actorUserId:owner.user_id,actorRole:'owner'});
  return {app,repo,auth,mcpToken,slug,ws,ownerCookie,bot};
}
const image=()=>({name:'evidence.png',mimeType:'image/png',size:rasterFixtures.png.length,contentEncoding:'base64',content:rasterFixtures.png.toString('base64'),unknownMetadata:{keep:true}});
const proof=()=>({fixture:false,stopConfirmed:true,processExit:{launched:true,rootPid:456,rootConfirmed:true,treeConfirmed:true,activeProcesses:0,rootExitCode:0,cancelled:false,unknownExit:{keep:true}},unknownProof:{keep:true},output:'Full output '.repeat(512),stdout:'Full stdout',summary:'Full summary',message:'Full message',text:'Full text',outputArtifacts:[image()],result:{code:'EXECUTION_UNCERTAIN',executionState:'uncertain',fixture:false,stopConfirmed:true,processExit:{rootConfirmed:true,treeConfirmed:true,activeProcesses:0},output:'Nested full output',stdout:'Nested stdout',message:'Nested message',summary:'Nested summary',text:'Nested text',outputArtifacts:[image()],unknownNestedProof:{keep:true}}});
const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);for(const item of Object.values(value))freeze(item);}return value;};
function snapshot(repo) {
  return {
    actions:repo.db.prepare('SELECT * FROM a2a_actions ORDER BY id').all(),
    events:repo.db.prepare('SELECT * FROM a2a_action_events ORDER BY id').all(),
    bots:repo.db.prepare('SELECT * FROM hermes_bots ORDER BY employee_id').all(),
    messages:repo.db.prepare('SELECT * FROM conversation_messages ORDER BY id').all(),
    conversations:repo.db.prepare('SELECT * FROM conversations ORDER BY id').all(),
    schema:repo.db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all()
  };
}
function add(f,id,{type='conversation.execute',status='failed',payload={},result=proof(),stamp='2028-01-01T00:00:00.000Z'}={}) {
  const {repo,ws,bot}=f;
  repo.db.prepare('INSERT INTO a2a_actions(id,workspace_id,agent_id,type,payload_json,dedupe_key,status,created_at,acked_at,completed_at,result_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,ws.id,'ziwei_user',type,JSON.stringify({employeeId:bot.id,deviceId:'mobile-run-pc',conversationId:bot.main_conversation_id,hermesBot:{employeeId:bot.id,workspace:f.slug,deviceId:'mobile-run-pc',revision:bot.revision,controlEpoch:bot.control_epoch},prompt:'[紫薇汇报:original] '+ 'Full prompt '.repeat(512),messageId:`original-message-${id}`,attachments:[image()],...payload}),id,status,stamp,stamp,['pending','acked'].includes(status)?null:stamp,JSON.stringify(result));
  const event=repo.db.prepare('INSERT INTO a2a_action_events(id,action_id,type,message,data_json,created_at) VALUES(?,?,?,?,?,?)');
  for(let index=0;index<7;index++)event.run(`${id}-event-${index}`,id,['progress','succeeded','failed','cancelled','expired','progress','progress'][index],`Original message ${index}`,JSON.stringify({message:`Original nested message ${index}`,result:proof(),unknownEvent:{keep:true}}),stamp);
}

test('extension projects existing Bot and conversation receipt fields immutably, including early-return conversations',()=>{
  const view=createMobileReadView({db:{prepare(){assert.fail('No employee or messages need database access');}}}),run=freeze({id:'run-original',payload:{prompt:'Keep full prompt',messageId:'keep-message-id',attachments:[image()]},result:proof(),events:[{id:'terminal',type:'succeeded',data:{result:proof()}},{id:'last',type:'progress',data:{message:'Latest progress'}}]}),gate=freeze({state:'checking',unknown:{keep:true}}),native=freeze({memory:{data:{outputArtifacts:[image()]}}});
  const bot=freeze({id:'bot',active_action_id:'canonical-original',latest_run:run,stop_action:{id:'stop',payload:{actionId:'canonical-original'},result:proof()},capabilityGate:gate,nativeResources:native,control_state:'paused'}),before=JSON.stringify(bot),actual=view.bot('unused',bot);
  assert.deepEqual(actual,{...bot,latest_run:mobileRunView(run),stop_action:mobileRunView(bot.stop_action)});assert.equal(actual.active_action_id,bot.active_action_id);assert.equal(actual.nativeResources,native);assert.equal(actual.capabilityGate,gate);assert.equal(JSON.stringify(bot),before);
  const conversation=freeze({id:'no-messages',execution:run,unknown:{keep:true}}),projected=view.conversation(conversation);
  assert.deepEqual(projected,{...conversation,execution:mobileRunView(run)});assert.equal(conversation.execution,run);assert.equal(Object.hasOwn(projected,'messages'),false);
  for(const value of [undefined,null,7,'unchanged',[],{id:'unchanged'}])assert.equal(view.bot('unused',value),value);
});

test('authenticated Bot detail and list project only latest/stop after capability derivation, leaving default and MCP bytes intact',async t=>{
  const f=fixture(t);
  add(f,'latest-media-proof');add(f,'stop-media-proof',{type:'action.cancel',payload:{actionId:'latest-media-proof'},stamp:'2027-01-01T00:00:00.000Z'});
  f.repo.db.prepare('UPDATE hermes_bots SET active_action_id=?,stop_action_id=? WHERE employee_id=?').run('latest-media-proof','stop-media-proof',f.bot.id);
  const before=snapshot(f.repo);
  for(const path of [`/api/workspaces/${f.slug}/bots/${f.bot.id}`,`/api/workspaces/${f.slug}/bots`]) {
    const raw=await request(f.app,path,{cookie:f.ownerCookie}),mcpBefore=await request(f.app,path.replace(/^\/api/,'/mcp/v1')+'?view=mobile',{headers:{authorization:`Bearer ${f.mcpToken}`}}),mobile=await request(f.app,path+'?view=mobile',{cookie:f.ownerCookie});
    assert.equal(raw.status,200);assert.equal(mobile.status,200);assert.equal(mcpBefore.status,200);assert.deepEqual(mcpBefore.bytes,raw.bytes);
    const initial=raw.json().bots?.find(row=>row.id===f.bot.id)||raw.json(),actual=mobile.json().bots?.find(row=>row.id===f.bot.id)||mobile.json();
    assert.deepEqual(actual,{...initial,latest_run:mobileRunView(initial.latest_run),stop_action:mobileRunView(initial.stop_action)});
    assert.deepEqual(actual.capabilities,initial.capabilities);assert.deepEqual(actual.capabilityGate,initial.capabilityGate);assert.deepEqual(actual.nativeResources,initial.nativeResources);
    for(const key of ['latest_run','stop_action']){
      assert.equal(actual[key].id,initial[key].id);assert.equal(actual[key].payload.prompt,initial[key].payload.prompt);assert.equal(actual[key].payload.messageId,initial[key].payload.messageId);assert.equal(actual[key].result.output,initial[key].result.output);
      assert.deepEqual(actual[key].result.processExit,initial[key].result.processExit);assert.deepEqual(actual[key].result.result.processExit,initial[key].result.result.processExit);assert.deepEqual(actual[key].events[0].data.result.unknownProof,initial[key].events[1].data.result.unknownProof);
      assert.deepEqual(actual[key].events.map(row=>row.id),[1,2,3,4,6].map(index=>`${initial[key].id}-event-${index}`));assert.equal(actual[key].event_count,7);
    }
    assert.deepEqual((await request(f.app,path,{cookie:f.ownerCookie})).bytes,raw.bytes);assert.deepEqual((await request(f.app,path.replace(/^\/api/,'/mcp/v1')+'?view=mobile',{headers:{authorization:`Bearer ${f.mcpToken}`}})).bytes,mcpBefore.bytes);
  }
  assert.deepEqual(snapshot(f.repo),before);
});

test('authenticated conversation execution projects media and events while preserving its original ID, full text, MCP action and stored bytes',async t=>{
  const f=fixture(t);add(f,'conversation-media-proof');const before=snapshot(f.repo),path=`/api/conversations/${f.bot.main_conversation_id}`,mcpPath=`/mcp/v1/workspaces/${f.slug}/actions/conversation-media-proof`;
  const raw=await request(f.app,path,{cookie:f.ownerCookie}),mcp=await request(f.app,mcpPath+'?view=mobile',{headers:{authorization:`Bearer ${f.mcpToken}`}}),mobile=await request(f.app,path+'?view=mobile',{cookie:f.ownerCookie});
  assert.equal(raw.status,200);assert.equal(mobile.status,200);assert.equal(mcp.status,200);
  const initial=raw.json(),actual=mobile.json();assert.deepEqual(actual,{...initial,execution:mobileRunView(initial.execution)});assert.equal(actual.execution.id,'conversation-media-proof');
  assert.equal(actual.execution.payload.prompt,initial.execution.payload.prompt);assert.equal(actual.execution.payload.messageId,initial.execution.payload.messageId);assert.equal(actual.execution.result.output,initial.execution.result.output);
  assert.deepEqual(actual.execution.events.map(row=>row.id),[1,2,3,4,6].map(index=>`conversation-media-proof-event-${index}`));assert.equal(actual.execution.event_count,7);
  assert.equal(actual.execution.events[0].data.result.outputArtifacts[0].content,undefined);assert.deepEqual(actual.execution.events[0].data.result.processExit,initial.execution.events[1].data.result.processExit);
  assert.deepEqual((await request(f.app,path,{cookie:f.ownerCookie})).bytes,raw.bytes);assert.deepEqual((await request(f.app,mcpPath+'?view=mobile',{headers:{authorization:`Bearer ${f.mcpToken}`}})).bytes,mcp.bytes);assert.deepEqual(snapshot(f.repo),before);
  assert.equal((await request(f.app,path+'?view=mobile')).status,401);
});

test('a later parallel directory inspection stays latest without replacing canonical active execution, Stop target or derived gate',async t=>{
  const f=fixture(t),{repo}=f,bots=createManagementService(repo).bots,owner=repo.db.prepare('SELECT user_id FROM members WHERE workspace_id=? AND role=? LIMIT 1').get(f.ws.id,'owner').user_id,context={actorUserId:owner,actorRole:'owner'};
  completeOwnedProfile(repo,f.bot);
  const validation=bots.validate(f.slug,f.bot.id,{expectedRevision:f.bot.revision,idempotencyKey:'extension-validation'},context).action;
  repo.ackA2AAction(validation.id,{deviceId:'mobile-run-pc'});repo.resultA2AAction(validation.id,{deviceId:'mobile-run-pc',status:'succeeded',result:{botValidation:{valid:true,schemaVersion:1,employeeId:f.bot.id,revision:f.bot.revision}}});
  const bot=bots.control(f.slug,f.bot.id,{expectedRevision:f.bot.revision,expectedControlEpoch:f.bot.control_epoch,operation:'activate'},context);
  const sent=repo.addConversationMessage(bot.main_conversation_id,{...context,content:'Original isolated task must remain in flight',attachments:[image()]});repo.ackA2AAction(sent.execution.id,{deviceId:'mobile-run-pc'});
  repo.db.prepare('UPDATE a2a_actions SET created_at=? WHERE id=?').run('2028-02-01T00:00:00.000Z',sent.execution.id);
  const inspection=repo.createConversationDirectoryAction(bot.main_conversation_id,{...context,expectedRevision:bot.revision,expectedControlEpoch:bot.control_epoch,path:'C:/Work',createIfMissing:false,idempotencyKey:'extension-parallel-inspect'});
  repo.ackA2AAction(inspection.id,{deviceId:'mobile-run-pc'});repo.resultA2AAction(inspection.id,{deviceId:'mobile-run-pc',status:'succeeded',result:{path:'C:/Work',exists:true,isDirectory:true,children:[]}});repo.db.prepare('UPDATE a2a_actions SET created_at=? WHERE id=?').run('2028-02-01T00:00:01.000Z',inspection.id);
  repo.db.prepare('UPDATE hermes_bots SET stop_action_id=? WHERE employee_id=?').run(null,bot.id);
  const stop=repo.createA2AAction(f.slug,{type:'action.cancel',dedupeKey:'extension-stop-request',payload:{actionId:sent.execution.id,deviceId:'mobile-run-pc'}});
  repo.db.prepare('UPDATE hermes_bots SET stop_action_id=? WHERE employee_id=?').run(stop.id,bot.id);
  const before=snapshot(repo),path=`/api/workspaces/${f.slug}/bots/${bot.id}`,raw=await request(f.app,path,{cookie:f.ownerCookie}),mobile=await request(f.app,path+'?view=mobile',{cookie:f.ownerCookie}),chat=await request(f.app,`/api/conversations/${bot.main_conversation_id}?view=mobile`,{cookie:f.ownerCookie});
  assert.equal(raw.status,200);assert.equal(mobile.status,200);assert.equal(chat.status,200);
  const initial=raw.json(),actual=mobile.json(),conversation=chat.json();
  assert.equal(initial.latest_run.id,inspection.id);assert.equal(actual.latest_run.id,inspection.id);assert.equal(actual.latest_run.status,'succeeded');assert.equal(actual.stop_action.id,stop.id);assert.equal(actual.stop_action.status,'pending');assert.equal(actual.stop_action.payload.actionId,sent.execution.id);
  assert.equal(conversation.execution.id,sent.execution.id);assert.equal(conversation.execution.status,'acked');assert.equal(repo.db.prepare('SELECT active_action_id FROM hermes_bots WHERE employee_id=?').get(bot.id).active_action_id,sent.execution.id);
  assert.equal(actual.capabilityGate.state,'checking');assert.match(actual.capabilityGate.reason,/原执行仍在进行/);assert.deepEqual(actual.capabilityGate,initial.capabilityGate);assert.deepEqual(actual.capabilities,initial.capabilities);assert.deepEqual(actual.nativeResources,initial.nativeResources);
  assert.deepEqual(actual,{...initial,latest_run:mobileRunView(initial.latest_run),stop_action:mobileRunView(initial.stop_action)});assert.deepEqual((await request(f.app,path,{cookie:f.ownerCookie})).bytes,raw.bytes);assert.deepEqual(snapshot(repo),before);
  t.diagnostic(JSON.stringify({latestInspectionId:inspection.id,canonicalActiveId:sent.execution.id,stopTarget:actual.stop_action.payload.actionId,capabilityGate:actual.capabilityGate.state}));
});
