import test from 'node:test';
import assert from 'node:assert/strict';
import {createRepository} from '../backend/repository.mjs';
import {createManagementService} from '../backend/management.mjs';
import {createBotMcpConnections,MCP_OAUTH_RELAY_FEATURE} from '../backend/bot-mcp-connections.mjs';
import {completeOwnedProfile} from '../test-support/owned-profile.mjs';

function fixture(t,{feature=true,oauth=true}={}) {
  const repo=createRepository({memory:true}),bots=createManagementService(repo).bots;
  t.after(()=>repo.db.close());
  const pair=repo.createDevicePairing('test-111',{name:'OAuth target'}),device=repo.claimDevicePairing({code:pair.code});
  repo.heartbeatDevice('test-111',{deviceId:device.deviceId,runtimeDiscovery:{features:feature?[MCP_OAUTH_RELAY_FEATURE]:[]},runtimes:{Hermes:{status:'available',version:'0.22.0',profiles:[{name:'default'}],models:[{id:'fixture'}]}}});
  const server={transport:'http',url:'https://mcp.example.invalid/mcp',enabled:true,...(oauth?{auth:'oauth',oauth:{cimd:false,scope:'library:read'}}:{})};
  const bot=bots.create('test-111',{name:'OAuth employee',targetDeviceId:device.deviceId,runtimeProfile:'default',model:'fixture',idempotencyKey:'create',config:{permissions:{mode:'execute'},mcpServers:{example:server}}});
  completeOwnedProfile(repo,bot);
  let clock=Date.now();const service=createBotMcpConnections(repo,bots,{apiBase:'https://ziwei.example.invalid',now:()=>clock});
  const credential=repo.authenticateDeviceToken(device.deviceToken);
  const input={server:'example',expectedRevision:bot.revision,expectedControlEpoch:bot.control_epoch,idempotencyKey:'connect'};
  const start=()=>service.start('test-111',bot.id,input);
  function begin() {const {connection}=start();repo.ackA2AAction(connection.id,{deviceId:device.deviceId});service.begin(connection.id,credential);return connection;}
  const authorization=(state='isolated-state')=>'https://login.example.invalid/authorize?'+new URLSearchParams({redirect_uri:'https://ziwei.example.invalid/api/mcp-oauth/callback',state,response_type:'code',code_challenge:'isolated-pkce',code_challenge_method:'S256'});
  function publish(state='isolated-state') {const connection=begin();service.publish(connection.id,credential,{authorizationUrl:authorization(state)});return connection;}
  return {repo,bots,bot,device,credential,service,input,start,begin,publish,authorization,advance:ms=>{clock+=ms;}};
}

test('saved configuration reaches the exact employee and duplicate connect reuses its action',t=>{
  const f=fixture(t),a=f.start().connection,b=f.start().connection;
  assert.equal(a.id,b.id);assert.equal(a.status,'queued');assert.equal(a.server,'example');assert.equal(a.deviceId,f.device.deviceId);
  const action=f.repo.getA2AAction(a.id);
  assert.equal(action.payload.nativeOperation.operation,'authorize');assert.equal(action.payload.hermesBot.config.mcpServers.example.auth,'oauth');
  assert.equal(action.payload.profile,f.bot.instance.profile);assert.equal(f.service.list('test-111',f.bot.id).connections[0].id,a.id);
  assert.throws(()=>f.service.start('foreign',f.bot.id,f.input));
  assert.throws(()=>f.service.start('test-111',f.bot.id,{...f.input,workspace:'foreign'}),{code:'BOT_WORKSPACE_CONFLICT'});
  for(const server of ['constructor','__proto__','missing'])assert.throws(()=>f.service.start('test-111',f.bot.id,{...f.input,server}),{code:'MCP_SERVER_NOT_CONFIGURED'});
});

test('an older client is reported before an unsupported action is queued',t=>{
  const f=fixture(t,{feature:false}),before=f.repo.db.prepare('SELECT count(*) n FROM a2a_actions').get().n;
  assert.throws(f.start,{code:'BOT_MCP_CLIENT_REQUIRED'});
  assert.equal(f.repo.db.prepare('SELECT count(*) n FROM a2a_actions').get().n,before);
});

test('ordinary HTTP MCP uses inspect without requiring the OAuth client feature',t=>{
  const f=fixture(t,{feature:false,oauth:false}),a=f.start().connection;
  assert.equal(f.repo.getA2AAction(a.id).payload.nativeOperation.operation,'inspect');
  assert.throws(()=>f.service.begin(a.id,f.credential),{code:'MCP_CONNECTION_NOT_FOUND'});
});

test('browser approval alone stays connecting until the original target returns native evidence',t=>{
  const f=fixture(t),a=f.publish();
  assert.equal(f.service.list('test-111',f.bot.id).connections[0].status,'authorization_required');
  assert.deepEqual(f.service.deliver({code:'one-time-code',state:'isolated-state',iss:'https://login.example.invalid'}),{ok:true});
  assert.deepEqual(f.service.callback(a.id,f.credential),{status:'callback',callback:{code:'one-time-code',state:'isolated-state',error:null,iss:'https://login.example.invalid'}});
  const waiting=f.service.list('test-111',f.bot.id).connections[0];assert.equal(waiting.status,'connecting');assert.equal(waiting.authorizationUrl,null);assert.equal(JSON.stringify(waiting).includes('one-time-code'),false);
  assert.throws(()=>f.service.deliver({code:'replay',state:'isolated-state'}),{code:'MCP_OAUTH_CALLBACK_EXPIRED'});
  f.repo.resultA2AAction(a.id,{deviceId:f.device.deviceId,status:'succeeded',result:{nativeOperation:{schemaVersion:2,employeeId:f.bot.id,revision:f.bot.revision,resource:'mcp',operation:'authorize',status:'succeeded',data:{connected:true,tools:[{name:'lookup',description:'Read records'}],credentialLocation:'target_profile'}}}});
  const ready=f.service.list('test-111',f.bot.id).connections[0];assert.equal(ready.status,'connected');assert.equal(ready.toolsCount,1);assert.equal(ready.loadedForNextRun,true);
  assert.throws(()=>f.service.callback(a.id,f.credential));
});

test('another device or workspace cannot publish or receive the callback',t=>{
  const f=fixture(t),a=f.publish();
  assert.throws(()=>f.service.callback(a.id,{...f.credential,deviceId:'another-device'}));
  assert.throws(()=>f.service.callback(a.id,{...f.credential,workspace:'foreign'}),{code:'MCP_OAUTH_DEVICE_SCOPE'});
  assert.throws(()=>f.service.callback(a.id,{...f.credential,credentialId:'another-grant'}),{code:'MCP_OAUTH_DEVICE_SCOPE'});
  assert.throws(()=>f.service.begin(a.id,null),{code:'MCP_OAUTH_DEVICE_REQUIRED'});
  assert.throws(()=>f.service.deliver({code:'stolen',state:'wrong-state'}),{code:'MCP_OAUTH_CALLBACK_EXPIRED'});
});

test('callback rejects ambiguity, wrong redirects, embedded credentials and state replacement',t=>{
  const f=fixture(t),a=f.begin();
  for(const authorizationUrl of ['http://login.example.invalid/authorize',f.authorization().replace('https%3A%2F%2Fziwei.example.invalid','https%3A%2F%2Fevil.invalid'),f.authorization()+'&access_token=secret',f.authorization().replace('https://login','https://user:secret@login')])assert.throws(()=>f.service.publish(a.id,f.credential,{authorizationUrl}),{code:'MCP_OAUTH_URL_INVALID'});
  f.service.publish(a.id,f.credential,{authorizationUrl:f.authorization()});
  assert.throws(()=>f.service.publish(a.id,f.credential,{authorizationUrl:f.authorization('different')}),{code:'MCP_OAUTH_STATE_CONFLICT'});
  for(const query of [{state:'isolated-state'},{state:'isolated-state',code:'a',error:'access_denied'},{state:['isolated-state'],code:'a'},{state:'isolated-state',code:[]},{state:'isolated-state',code:'a',iss:[]}])assert.throws(()=>f.service.deliver(query));
  f.service.deliver({state:'isolated-state',error:'access_denied'});assert.equal(f.service.callback(a.id,f.credential).callback.error,'access_denied');
});

test('cancel invalidates approval without manufacturing a stopped process or terminal action',t=>{
  const f=fixture(t),a=f.publish();
  const cancelled=f.service.cancel('test-111',f.bot.id,a.id).connection;assert.equal(cancelled.status,'cancelled');
  assert.equal(f.repo.getA2AAction(a.id).status,'acked');assert.deepEqual(f.service.callback(a.id,f.credential),{status:'cancelled'});
  assert.throws(()=>f.service.deliver({code:'late',state:'isolated-state'}),{code:'MCP_OAUTH_CALLBACK_EXPIRED'});
  assert.throws(()=>f.service.begin(a.id,f.credential),{code:'MCP_OAUTH_RELAY_EXPIRED'});
});

test('expiry and backend restart do not restore or silently reauthorize the old handoff',t=>{
  const f=fixture(t),a=f.publish();f.advance(10*60_000+1);
  assert.equal(f.service.list('test-111',f.bot.id).connections[0].status,'expired');assert.deepEqual(f.service.callback(a.id,f.credential),{status:'expired'});
  assert.throws(()=>f.service.deliver({code:'late',state:'isolated-state'}),{code:'MCP_OAUTH_CALLBACK_EXPIRED'});
  const restarted=createBotMcpConnections(f.repo,f.bots,{apiBase:'https://ziwei.example.invalid'});
  assert.throws(()=>restarted.callback(a.id,f.credential),{code:'MCP_OAUTH_RELAY_LOST'});
});

test('revoked device and changed control epoch fence an approval already opened in a browser',t=>{
  const f=fixture(t),a=f.publish();
  f.repo.db.prepare('UPDATE device_credentials SET revoked_at=? WHERE id=?').run(new Date().toISOString(),f.credential.credentialId);
  assert.throws(()=>f.service.deliver({code:'late',state:'isolated-state'}),{code:'MCP_OAUTH_DEVICE_REVOKED'});
  f.repo.db.prepare('UPDATE device_credentials SET revoked_at=NULL WHERE id=?').run(f.credential.credentialId);
  f.bots.control('test-111',f.bot.id,{operation:'pause',expectedRevision:f.bot.revision,expectedControlEpoch:f.bot.control_epoch});
  assert.throws(()=>f.service.callback(a.id,f.credential),{code:'BOT_REVISION_CONFLICT'});
  assert.throws(()=>f.service.deliver({code:'late',state:'isolated-state'}),{code:'BOT_REVISION_CONFLICT'});
  assert.equal(f.service.list('test-111',f.bot.id).connections[0].status,'failed');
});

test('native failure and missing evidence never turn saved configuration into connected',t=>{
  const f=fixture(t),a=f.begin();
  f.repo.resultA2AAction(a.id,{deviceId:f.device.deviceId,status:'failed',error:'PRIVATE EXCEPTION WITH TOKEN',result:{nativeOperation:{status:'failed',code:'MCP_OAUTH_CONNECTION_FAILED'}}});
  const item=f.service.list('test-111',f.bot.id).connections[0];assert.equal(item.status,'failed');assert.match(item.error,/连接 MCP 失败/);assert.equal(JSON.stringify(item).includes('PRIVATE EXCEPTION'),false);
});

const deferredRequest=f=>({workspace:'test-111',employeeId:f.bot.id,server:'example',idempotencyKey:'deferred-mcp:intent-one:example',context:{}});
test('deferred connection acceptance recovers its exact native action across ticks, restart and offline readback',t=>{
  const f=fixture(t),request=deferredRequest(f),first=f.service.deferredHandlers.connectMcp(request);
  assert.equal(first.status,'queued');assert.equal(first.idempotencyKey,request.idempotencyKey);
  const count=f.repo.db.prepare('SELECT count(*) n FROM a2a_actions').get().n;
  const restarted=createBotMcpConnections(f.repo,f.bots,{apiBase:'https://ziwei.example.invalid'});
  f.repo.db.prepare("UPDATE devices SET status='offline' WHERE id=?").run(f.device.deviceId);
  for(const service of [f.service,restarted]){
    assert.equal(service.deferredHandlers.connectMcp(request).id,first.id);
    assert.equal(service.deferredHandlers.readMcp({...request,actionId:first.id}).id,first.id);
  }
  assert.equal(f.repo.db.prepare('SELECT count(*) n FROM a2a_actions').get().n,count);
  assert.throws(()=>restarted.deferredHandlers.connectMcp({...request,server:'different'}),{code:'IDEMPOTENCY_CONFLICT'});
  assert.throws(()=>restarted.deferredHandlers.readMcp({...request,actionId:first.id,server:'different'}),{code:'MCP_CONNECTION_NOT_FOUND'});
});

test('deferred exact-action reads do not substitute a later connection or browser approval for native success',t=>{
  const f=fixture(t),request=deferredRequest(f),first=f.service.deferredHandlers.connectMcp(request);
  f.repo.ackA2AAction(first.id,{deviceId:f.device.deviceId});f.service.begin(first.id,f.credential);
  f.service.publish(first.id,f.credential,{authorizationUrl:f.authorization()});
  const pending=f.service.deferredHandlers.readMcp({...request,actionId:first.id});
  assert.equal(pending.status,'authorization_required');assert.equal(pending.authorizationUrl,f.authorization());assert.equal(pending.loadedForNextRun,false);
  f.service.deliver({state:'isolated-state',code:'private-fixture-code'});
  const approving=f.service.deferredHandlers.readMcp({...request,actionId:first.id});assert.equal(approving.status,'connecting');assert.equal(approving.authorizationUrl,null);
  assert.equal(JSON.stringify(approving).includes('private-fixture-code'),false);
  f.repo.resultA2AAction(first.id,{deviceId:f.device.deviceId,status:'succeeded',result:{nativeOperation:{schemaVersion:2,employeeId:f.bot.id,revision:f.bot.revision,resource:'mcp',operation:'authorize',status:'succeeded',data:{connected:true,tools:[{name:'lookup'}]}}}});
  const next=f.service.deferredHandlers.connectMcp({...request,idempotencyKey:'deferred-mcp:intent-two:example'});assert.notEqual(next.id,first.id);
  assert.equal(f.service.list('test-111',f.bot.id).connections[0].id,next.id);
  const original=f.service.deferredHandlers.readMcp({...request,actionId:first.id});assert.equal(original.id,first.id);assert.equal(original.status,'connected');assert.equal(original.toolsCount,1);
});

test('deferred first admission retains ordinary client capability and device-scope checks',t=>{
  const f=fixture(t,{feature:false}),request=deferredRequest(f),count=f.repo.db.prepare('SELECT count(*) n FROM a2a_actions').get().n;
  assert.throws(()=>f.service.deferredHandlers.connectMcp(request),{code:'BOT_MCP_CLIENT_REQUIRED'});
  assert.throws(()=>f.service.deferredHandlers.connectMcp({...request,context:{deviceScope:'another-device',deviceCredentialDeviceId:'another-device'}}),{code:'BOT_NOT_FOUND'});
  assert.equal(f.repo.db.prepare('SELECT count(*) n FROM a2a_actions').get().n,count);
});

function forbidFullHistoryReads(f) {
  const db=f.repo.db,workspaceId=f.repo.getWorkspace('test-111').id;
  const payload=f.repo.getA2AAction(f.bot.instance.provisioning.actionId).payload;
  const privateHistory='OLD_SESSION_CONTENT_MUST_NOT_BE_RELOADED_'.repeat(3000);
  const insert=db.prepare('INSERT INTO a2a_actions(id,workspace_id,agent_id,type,payload_json,dedupe_key,status,created_at,result_json) VALUES(?,?,?,?,?,?,?,?,?)');
  const event=db.prepare('INSERT INTO a2a_action_events(id,action_id,type,data_json,created_at) VALUES(?,?,?,?,?)');
  const historyPayload=JSON.stringify({...payload,prompt:privateHistory,nativeOperation:{resource:'sessions',operation:'read',input:{sessionId:'old'}}});
  const historyResult=JSON.stringify({output:privateHistory,nativeOperation:{schemaVersion:2,employeeId:f.bot.id,revision:1,resource:'sessions',operation:'read',status:'succeeded',data:{message_count:500,messages:[{content:privateHistory}]}}});
  for(let n=0;n<120;n++){
    const id=`forbidden-full-history-${n}`,stamp=new Date(Date.parse('2020-01-01T00:00:00Z')+n*1000).toISOString();
    insert.run(id,workspaceId,'ziwei_user','hermes.bot.native',historyPayload,id,'succeeded',stamp,historyResult);
    event.run('event-'+id,id,'succeeded',JSON.stringify({output:privateHistory}),stamp);
  }
  const original=f.repo.getA2AAction,reads=[];
  f.repo.getA2AAction=function(id,...args){
    if(String(id).startsWith('forbidden-full-history-')){reads.push(id);throw new Error('Connection state attempted a complete historical action read');}
    return original.call(this,id,...args);
  };
  return {reads,assertBounded:value=>assert.equal(JSON.stringify(value).includes('OLD_SESSION_CONTENT_MUST_NOT_BE_RELOADED'),false)};
}

test('connection start, stable replay, list/read/cancel and deferred snapshots never materialize old action history',t=>{
  const f=fixture(t),history=forbidFullHistoryReads(f),request=deferredRequest(f);
  const first=f.start().connection;
  const duplicate=f.start().connection;assert.equal(duplicate.id,first.id);
  f.repo.ackA2AAction(first.id,{deviceId:f.device.deviceId});f.service.begin(first.id,f.credential);
  f.service.publish(first.id,f.credential,{authorizationUrl:f.authorization()});
  const stable={...request,idempotencyKey:f.input.idempotencyKey};
  for(const reply of [
    f.service.list('test-111',f.bot.id),
    f.service.read('test-111',f.bot.id,first.id),
    f.service.deferredHandlers.connectMcp(stable),
    f.service.deferredHandlers.readMcp({...stable,actionId:first.id}),
    f.service.cancel('test-111',f.bot.id,first.id),
  ])history.assertBounded(reply);
  assert.equal(f.service.read('test-111',f.bot.id,first.id).connection.status,'cancelled');
  assert.deepEqual(history.reads,[]);
});

test('the real deferred runner polls one OAuth action through browser handoff and native completion without full-history reads',t=>{
  const f=fixture(t),db=f.repo.db,ws=f.repo.getWorkspace('test-111'),owner='relay-tick-owner';
  db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run('relay-tick-member',ws.id,owner,'Owner','relay-tick@fixture.invalid','owner',new Date().toISOString());
  const context={actorUserId:owner,enforceEmployeeVisibility:true};
  const tree={launched:true,rootPid:918,rootConfirmed:true,rootExitCode:0,treeConfirmed:true,activeProcesses:0,cancelled:false};
  const completeValidation=action=>{
    f.repo.ackA2AAction(action.id,{deviceId:f.device.deviceId});
    f.repo.resultA2AAction(action.id,{deviceId:f.device.deviceId,status:'succeeded',result:{processExit:tree,botValidation:{schemaVersion:1,valid:true,employeeId:f.bot.id,revision:action.payload.hermesBot.revision}}});
  };
  completeValidation(f.bots.validate('test-111',f.bot.id,{expectedRevision:1,idempotencyKey:'tick-initial-validation'},context).action);
  f.bots.control('test-111',f.bot.id,{expectedRevision:1,expectedControlEpoch:1,operation:'activate'},context);
  const history=forbidFullHistoryReads(f);
  const current=f.bots.get('test-111',f.bot.id,context,{view:'management'});
  const source=f.repo.addConversationMessage(f.bot.main_conversation_id,{content:'isolated deferred original turn'}).execution;
  f.repo.ackA2AAction(source.id,{deviceId:f.device.deviceId});
  const queued=f.bots.update('test-111',f.bot.id,{deferUntilIdle:true,expectedRevision:current.revision,expectedControlEpoch:current.control_epoch,idempotencyKey:'bounded-relay-deferred',config:{...current.config,memory:{...current.config.memory,enabled:false}},connectMcpServers:['example']},context);
  f.bots.deferredConfig.start({...f.service.deferredHandlers,pollIntervalMs:0});
  try {
    f.repo.resultA2AAction(source.id,{deviceId:f.device.deviceId,status:'succeeded',result:{processExit:tree}});
    f.bots.deferredConfig.drain();
    const latest=()=>f.bots.deferredConfig.latest(ws.id,f.bot.id);
    completeValidation(f.repo.getA2AAction(latest().validationActionId));f.bots.deferredConfig.drain();
    const connection=latest().connections[0];assert.equal(latest().state,'connecting');assert.equal(connection.status,'queued');
    const native=f.repo.getA2AAction(connection.actionId),count=db.prepare('SELECT count(*) n FROM a2a_actions').get().n;
    f.repo.ackA2AAction(native.id,{deviceId:f.device.deviceId});f.service.begin(native.id,f.credential);
    f.service.publish(native.id,f.credential,{authorizationUrl:f.authorization()});
    for(let tick=0;tick<5;tick++){
      f.bots.deferredConfig.drain();assert.equal(latest().phase,'authorization_required');
      assert.equal(latest().connections[0].actionId,native.id);
      assert.equal(f.service.read('test-111',f.bot.id,native.id,context).connection.status,'authorization_required');
      assert.deepEqual(f.service.callback(native.id,f.credential),{status:'waiting'});
    }
    assert.equal(db.prepare('SELECT count(*) n FROM a2a_actions').get().n,count);
    f.service.deliver({state:'isolated-state',code:'isolated-browser-code'});
    f.bots.deferredConfig.drain();assert.equal(latest().state,'connecting');
    assert.equal(f.service.read('test-111',f.bot.id,native.id,context).connection.status,'connecting');
    f.repo.resultA2AAction(native.id,{deviceId:f.device.deviceId,status:'succeeded',result:{processExit:tree,nativeOperation:{schemaVersion:2,employeeId:f.bot.id,revision:native.payload.hermesBot.revision,resource:'mcp',operation:'authorize',status:'succeeded',data:{connected:true,tools:[{name:'lookup'}]}}}});
    f.bots.deferredConfig.drain();const done=latest();assert.equal(done.id,queued.deferredConfig.id);assert.equal(done.state,'completed');assert.equal(done.connections[0].actionId,native.id);
    const ready=f.service.read('test-111',f.bot.id,native.id,context).connection;assert.equal(ready.status,'connected');assert.equal(ready.toolsCount,1);history.assertBounded(ready);
    assert.deepEqual(history.reads,[]);assert.equal(db.prepare('SELECT count(*) n FROM a2a_actions').get().n,count);
  } finally {f.bots.deferredConfig.stop();}
});

test('scope-not-granted is a public actionable failure without exposing native diagnostics',t=>{
  const f=fixture(t),a=f.begin();
  f.repo.resultA2AAction(a.id,{deviceId:f.device.deviceId,status:'failed',error:'PRIVATE PROVIDER BODY',result:{nativeOperation:{schemaVersion:2,employeeId:f.bot.id,revision:f.bot.revision,resource:'mcp',operation:'authorize',status:'failed',code:'MCP_OAUTH_SCOPE_NOT_GRANTED'}}});
  const item=f.service.read('test-111',f.bot.id,a.id).connection;
  assert.equal(item.status,'failed');assert.match(item.error,/权限/);assert.match(item.error,/重新授权/);
  assert.equal(item.scopeConfirmed,false);assert.equal(item.requestedScopes,null);assert.equal(item.grantedScopes,null);
  assert.equal(JSON.stringify(item).includes('PRIVATE PROVIDER BODY'),false);
});

test('scope confirmation comes from bounded original native scope evidence rather than tool names',t=>{
  const f=fixture(t),a=f.begin();
  const data={connected:true,tools:[{name:'read_records'}],requestedScopes:['library:read','library:collect','library:read'],grantedScopes:['library:read','library:collect','offline_access'],scopeConfirmed:true,token:'PRIVATE_TOKEN',authorizationUrl:'https://private.invalid/secret'};
  f.repo.resultA2AAction(a.id,{deviceId:f.device.deviceId,status:'succeeded',result:{nativeOperation:{schemaVersion:2,employeeId:f.bot.id,revision:f.bot.revision,resource:'mcp',operation:'authorize',status:'succeeded',data}}});
  const item=f.service.read('test-111',f.bot.id,a.id).connection;
  assert.equal(item.status,'connected');assert.equal(item.scopeConfirmed,true);
  assert.deepEqual(item.requestedScopes,['library:read','library:collect']);assert.deepEqual(item.grantedScopes,['library:read','library:collect','offline_access']);
  assert.equal(JSON.stringify(item).includes('PRIVATE_TOKEN'),false);assert.equal(JSON.stringify(item).includes('private.invalid'),false);
  f.repo.db.prepare("UPDATE a2a_actions SET status='failed' WHERE id=?").run(a.id);
  assert.equal(f.service.read('test-111',f.bot.id,a.id).connection.scopeConfirmed,false);
  f.repo.db.prepare("UPDATE a2a_actions SET status='succeeded' WHERE id=?").run(a.id);
  f.repo.db.prepare('UPDATE hermes_bots SET control_epoch=control_epoch+1 WHERE employee_id=?').run(f.bot.id);
  const stale=f.service.read('test-111',f.bot.id,a.id).connection;assert.equal(stale.status,'failed');assert.equal(stale.scopeConfirmed,false);assert.equal(stale.requestedScopes,null);
});

for(const [name,evidence,requested,granted]of [
  ['old receipt',{},null,null],
  ['unknown native token scope',{requestedScopes:['library:read','library:collect'],grantedScopes:null,scopeConfirmed:false},['library:read','library:collect'],null],
  ['read-only cached grant',{requestedScopes:['library:read','library:collect'],grantedScopes:['library:read'],scopeConfirmed:true},['library:read','library:collect'],['library:read']],
  ['missing native confirmation',{requestedScopes:['library:read'],grantedScopes:['library:read']},['library:read'],['library:read']],
  ['non-boolean confirmation',{requestedScopes:['library:read'],grantedScopes:['library:read'],scopeConfirmed:'true'},['library:read'],['library:read']],
  ['invalid requested token',{requestedScopes:['library:read collect'],grantedScopes:['library:read'],scopeConfirmed:true},null,['library:read']],
  ['too many tokens',{requestedScopes:Array.from({length:129},(_,i)=>'scope:'+i),grantedScopes:['library:read'],scopeConfirmed:true},null,['library:read']],
  ['oversize token',{requestedScopes:['x'.repeat(4001)],grantedScopes:['library:read'],scopeConfirmed:true},null,['library:read']],
])test(`${name} cannot claim the configured scope is confirmed, even with a collect tool`,t=>{
  const f=fixture(t),a=f.begin();
  f.repo.resultA2AAction(a.id,{deviceId:f.device.deviceId,status:'succeeded',result:{nativeOperation:{schemaVersion:2,employeeId:f.bot.id,revision:f.bot.revision,resource:'mcp',operation:'authorize',status:'succeeded',data:{connected:true,tools:[{name:'collect_records'}],...evidence}}}});
  const item=f.service.read('test-111',f.bot.id,a.id).connection;
  assert.equal(item.status,'connected','scope display does not rewrite the existing connection status contract');
  assert.equal(item.scopeConfirmed,false);assert.deepEqual(item.requestedScopes,requested);assert.deepEqual(item.grantedScopes,granted);
  assert(Buffer.byteLength(JSON.stringify(item))<12000);
});
