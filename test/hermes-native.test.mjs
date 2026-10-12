import test from 'node:test';
import assert from 'node:assert/strict';
import {createRepository} from '../backend/repository.mjs';
import {createManagementService} from '../backend/management.mjs';
import {normalizeBotConfig} from '../src/hermes-bot-config.mjs';

const setup=()=>{const repo=createRepository({memory:true}),bots=createManagementService(repo).bots;repo.heartbeatDevice('test-111',{deviceId:'native-pc',runtimes:{Hermes:{status:'available',version:'0.21.3',profiles:[{name:'default'}],models:[{id:'fixture'}]}}});const bot=bots.create('test-111',{name:'Native',targetDeviceId:'native-pc',runtimeProfile:'default',model:'fixture',idempotencyKey:'native-bot'});return{repo,bots,bot};};
const request=(bot,resource,operation,input={})=>({expectedRevision:bot.revision,expectedControlEpoch:bot.control_epoch,idempotencyKey:`${resource}:${operation}`,resource,operation,input});
function enable(f,bot){const {action}=f.bots.validate('test-111',bot.id,{expectedRevision:bot.revision,idempotencyKey:`validate:${bot.id}:${bot.revision}`});f.repo.ackA2AAction(action.id,{deviceId:'native-pc'});f.repo.resultA2AAction(action.id,{status:'succeeded',result:{botValidation:{schemaVersion:1,valid:true,employeeId:bot.id,revision:bot.revision}}});return f.bots.control('test-111',bot.id,{expectedRevision:bot.revision,expectedControlEpoch:bot.control_epoch,operation:'activate'});}

test('native maintenance is bound and idempotent in draft; active execution and raw forgery are rejected',()=>{
  const f=setup();try{
    const one=f.bots.native('test-111',f.bot.id,request(f.bot,'memory','read'));
    assert.equal(one.action.type,'hermes.bot.native');assert.equal(one.action.payload.hermesBot.employeeId,f.bot.id);
    assert.equal(f.bots.native('test-111',f.bot.id,request(f.bot,'memory','read')).action.id,one.action.id);
    f.repo.ackA2AAction(one.action.id,{deviceId:'native-pc'});assert.equal(f.repo.authorizeBotStart(one.action.id,{deviceId:'native-pc'}).allowed,true);
    f.repo.resultA2AAction(one.action.id,{status:'succeeded',result:{nativeOperation:{resource:'memory',operation:'read'}}});
    assert.throws(()=>f.bots.native('test-111',f.bot.id,request(f.bot,'goals','step')),{code:'BOT_NOT_ACTIVE'});
    assert.throws(()=>f.repo.createA2AAction('test-111',{type:'hermes.bot.native',payload:{employeeId:f.bot.id,nativeOperation:{resource:'memory',operation:'read'}}}),{code:'BOT_NATIVE_ROUTE_REQUIRED'});
    assert.throws(()=>f.bots.native('test-111',f.bot.id,request(f.bot,'sessions','read',{sessionId:'other/private'})),{code:'BOT_NATIVE_INPUT_INVALID'});
  }finally{f.repo.db.close();}
});
test('native request cannot survive a later control epoch, and uncertain native work retains occupancy',()=>{
  const f=setup();try{
    const {action}=f.bots.native('test-111',f.bot.id,request(f.bot,'memory','read'));
    f.bots.control('test-111',f.bot.id,{expectedRevision:1,expectedControlEpoch:1,operation:'pause'});
    assert.equal(f.repo.getA2AAction(action.id).status,'failed');
    assert.throws(()=>f.bots.native('test-111',f.bot.id,{...request(f.bot,'memory','write',{content:'x',expectedHash:'0'.repeat(64)}),idempotencyKey:'stale'}),{code:'BOT_CONTROL_CONFLICT'});
    const current=f.bots.get('test-111',f.bot.id);
    const next=f.bots.native('test-111',f.bot.id,{...request(current,'memory','read'),idempotencyKey:'read-next'}).action;
    f.repo.ackA2AAction(next.id,{deviceId:'native-pc'});f.repo.resultA2AAction(next.id,{status:'failed',result:{code:'EXECUTION_UNCERTAIN'}});
    assert.throws(()=>f.bots.native('test-111',f.bot.id,{...request(current,'memory','read'),idempotencyKey:'blocked'}),{code:'BOT_BUSY'});
  }finally{f.repo.db.close();}
});
test('shared BotConfig retains HTTP MCP filtering and credential references with native advanced fields',()=>{
  const config=normalizeBotConfig({permissions:{mode:'execute'},mcpServers:{sample:{transport:'http',url:'http://127.0.0.1:9000/mcp',headers:{Authorization:'${MCP_AUTH}'},tools:{include:['echo*']}}},memory:{charLimit:3000,userCharLimit:1800},skills:{autoLoad:['sample']},voice:{stt:{provider:'openai',baseUrl:'http://127.0.0.1:9001/v1',model:'whisper-1',keyEnv:'VOICE_KEY'}},gateway:{platforms:{webhook:{enabled:true,extra:{host:'127.0.0.1',port:9100,secret:'${WEBHOOK_SECRET}',routes:{inbox:{prompt:'{{text}}',deliver:'log'}}}}}}});
  assert.equal(config.mcpServers.sample.transport,'http');assert.deepEqual(config.mcpServers.sample.tools.include,['echo*']);assert.equal(config.voice.stt.keyEnv,'VOICE_KEY');assert.deepEqual(normalizeBotConfig(config),config);
  assert.throws(()=>normalizeBotConfig({...config,mcpServers:{sample:{url:'https://example.com',headers:{Authorization:'secret-value'}}}}),{code:'BOT_SECRET_REFERENCE_REQUIRED'});
  assert.throws(()=>normalizeBotConfig({...config,mcpServers:{sample:{url:'https://example.com',headers:{Authorization:'${ZIWEI_BOT_DEVICE_TOKEN}'}}}}),{code:'BOT_SECRET_REFERENCE_REQUIRED'});
  assert.throws(()=>normalizeBotConfig({...config,voice:{stt:{provider:'openai',keyEnv:'ZIWEI_BOT_DEVICE_TOKEN'}}}),{code:'BOT_SECRET_REFERENCE_REQUIRED'});
  for(const mcp of [{command:'node',args:['${env:ZIWEI_BOT_DEVICE_TOKEN}']},{url:'https://example.invalid/mcp?x=${ZIWEI_BOT_DEVICE_TOKEN}'},{command:'node',args:['prefix-${SAFE_KEY}']}])assert.throws(()=>normalizeBotConfig({...config,mcpServers:{sample:mcp}}),{code:'BOT_SECRET_REFERENCE_REQUIRED'});
  assert.throws(()=>normalizeBotConfig({...config,gateway:{platforms:{webhook:{extra:{routes:{x:{prompt:'${ZIWEI_BOT_DEVICE_TOKEN}'}}}}}}}),{code:'BOT_SECRET_REFERENCE_REQUIRED'});
  const multi=normalizeBotConfig({...config,gateway:{platforms:{slack:{enabled:true,tokenEnv:'SLACK_KEY',envRefs:{SLACK_APP_TOKEN:'${SOCKET_KEY}'}}}}});assert.equal(multi.gateway.platforms.slack.envRefs.SLACK_APP_TOKEN,'${SOCKET_KEY}');
});

test('Gateway disconnect fences its source without granting another connection access to the old inbox',()=>{
  const f=setup();try{
    const bot=enable(f,f.bots.update('test-111',f.bot.id,{expectedRevision:1,config:{permissions:{mode:'execute'},gateway:{platforms:{webhook:{enabled:true},telegram:{enabled:true,tokenEnv:'TG_KEY'}}}}}));
    const connect=(platform,key)=>{const action=f.bots.native('test-111',bot.id,{...request(bot,'gateway','connect',{platform,durationSeconds:60}),idempotencyKey:key}).action;f.repo.ackA2AAction(action.id,{deviceId:'native-pc'});return action;};
    const a=connect('webhook','A'),queued=f.repo.receiveBotGateway(a.id,{deviceId:'native-pc',platform:'webhook',chatId:'chat-one',messageId:'original',content:'queued'}).delivery;
    f.repo.resultA2AAction(a.id,{status:'succeeded',result:{connected:true}});
    const other=connect('telegram','other');f.repo.resultA2AAction(other.id,{status:'succeeded',result:{connected:true}});
    assert.throws(()=>f.repo.botGatewayDelivery(other.id,queued.id,{deviceId:'native-pc'}),{code:'BOT_GATEWAY_DELIVERY_FORBIDDEN'});
    const stop=f.bots.native('test-111',bot.id,request(bot,'gateway','disconnect',{platform:'webhook'})).action;f.repo.ackA2AAction(stop.id,{deviceId:'native-pc'});
    assert.throws(()=>f.repo.authorizeBotGateway(a.id,{deviceId:'native-pc'}),{code:'BOT_GATEWAY_LEASE_REVOKED'});
    f.repo.resultA2AAction(stop.id,{status:'succeeded',result:{stopConfirmed:true}});
    assert.equal(f.repo.authorizeBotGateway(other.id,{deviceId:'native-pc'}).allowed,true);
    assert.equal(f.repo.botGatewayDelivery(a.id,queued.id,{deviceId:'native-pc'}).status,'requires_authorization');
    const b=connect('webhook','B');f.repo.resultA2AAction(b.id,{status:'succeeded',result:{connected:true}});
    f.repo.resultA2AAction(stop.id,{status:'succeeded',result:{stopConfirmed:true}});
    assert.equal(f.repo.authorizeBotGateway(b.id,{deviceId:'native-pc'}).allowed,true);
    assert.throws(()=>f.repo.botGatewayDelivery(b.id,queued.id,{deviceId:'native-pc'}),{code:'BOT_GATEWAY_DELIVERY_FORBIDDEN'});
  }finally{f.repo.db.close();}
});
test('native Routine pause blocks a queued or acked start while permitting original bookkeeping',()=>{
  const f=setup();try{
    const bot=enable(f,f.bot),routine=f.bots.createRoutine('test-111',bot.id,{name:'Goal step',nativeDriver:{resource:'goals',operation:'step'},schedule:'手动',idempotencyKey:'goal-routine'});
    const run=f.bots.runRoutine('test-111',bot.id,routine.id,{idempotencyKey:'run'}),action=f.repo.getA2AAction(run.action_id);assert.equal(action.type,'hermes.bot.native');
    f.repo.ackA2AAction(action.id,{deviceId:'native-pc'});f.bots.updateRoutine('test-111',bot.id,routine.id,{status:'paused'});
    assert.throws(()=>f.repo.authorizeBotStart(action.id,{deviceId:'native-pc'}),{code:'BOT_NOT_ACTIVE'});
    assert.equal(f.repo.authorizeBotSettlement(action.id,{deviceId:'native-pc'}).allowEvaluation,false);
    f.repo.resultA2AAction(action.id,{status:'failed',error:'paused before spawn',result:{stopConfirmed:true}});assert.equal(f.repo.listAutomationRuns(routine.id)[0].status,'failed');
  }finally{f.repo.db.close();}
});
test('late native collaboration after source stop records result without new target work',()=>{
  const f=setup();try{
    const target=enable(f,f.bots.create('test-111',{name:'Peer',targetDeviceId:'native-pc',runtimeProfile:'default',model:'fixture',idempotencyKey:'peer'}));
    const source=enable(f,f.bots.update('test-111',f.bot.id,{expectedRevision:1,config:{permissions:{mode:'execute'},collaboration:{enabled:true,targetEmployeeIds:[target.id]}}}));
    const {action}=f.bots.collaboration('test-111',source.id,{expectedRevision:source.revision,expectedControlEpoch:source.control_epoch,targetEmployeeIds:[target.id],content:'Review marker',mode:'message',idempotencyKey:'message'});
    f.repo.ackA2AAction(action.id,{deviceId:'native-pc'});f.bots.control('test-111',source.id,{expectedRevision:source.revision,expectedControlEpoch:source.control_epoch,operation:'stop'});
    const completed=f.repo.resultA2AAction(action.id,{status:'succeeded',result:{nativeOperation:{resource:'collaboration',status:'succeeded',employeeId:source.id,revision:source.revision}}});
    assert.equal(completed.status,'failed');assert.equal(completed.result.collaboration.dispatched,false);assert.equal(f.bots.runs('test-111',target.id).filter(a=>a.type==='conversation.execute').length,0);
  }finally{f.repo.db.close();}
});
test('source and target Group model turns bind their own Group conversations',()=>{
  const f=setup();try{
    const target=enable(f,f.bots.create('test-111',{name:'Peer',targetDeviceId:'native-pc',runtimeProfile:'default',model:'fixture',idempotencyKey:'group-peer'}));
    const source=enable(f,f.bots.update('test-111',f.bot.id,{expectedRevision:1,config:{permissions:{mode:'execute'},collaboration:{enabled:true,targetEmployeeIds:[target.id]}}}));
    const parent=f.bots.collaboration('test-111',source.id,{expectedRevision:source.revision,expectedControlEpoch:source.control_epoch,targetEmployeeIds:[target.id],content:'Review',mode:'group',groupId:'group_scope',idempotencyKey:'group-parent'}).action;
    assert.notEqual(parent.payload.hermesBot.conversationId,source.main_conversation_id);assert.equal(f.repo.getConversation(parent.payload.hermesBot.conversationId).title,'Group: group_scope');
    f.repo.ackA2AAction(parent.id,{deviceId:'native-pc'});
    const child=f.bots.collaboration('test-111',source.id,{expectedRevision:source.revision,expectedControlEpoch:source.control_epoch,sourceActionId:parent.id,targetEmployeeIds:[target.id],content:'Review',mode:'group',groupId:'group_scope',idempotencyKey:'group-child'}).actions[0];
    assert.notEqual(child.payload.hermesBot.conversationId,target.main_conversation_id);assert.equal(f.repo.getConversation(child.payload.hermesBot.conversationId).title,'Group: group_scope');assert.notEqual(child.payload.hermesBot.conversationId,parent.payload.hermesBot.conversationId);
  }finally{f.repo.db.close();}
});
test('Gateway keeps busy inbound deliveries and dispatches each original ID once',()=>{
  const f=setup();try{
    const bot=enable(f,f.bots.update('test-111',f.bot.id,{expectedRevision:1,config:{permissions:{mode:'execute'},gateway:{platforms:{webhook:{enabled:true,extra:{secret:'${WEBHOOK_SECRET}',routes:{inbox:{deliver:'log'}}}}}}}}));
    const {action}=f.bots.native('test-111',bot.id,request(bot,'gateway','connect',{platform:'webhook',durationSeconds:60}));f.repo.ackA2AAction(action.id,{deviceId:'native-pc'});
    const first=f.repo.receiveBotGateway(action.id,{deviceId:'native-pc',platform:'webhook',chatId:'chat-one',messageId:'m1',content:'first'});assert.equal(first.delivery.status,'queued');
    f.repo.resultA2AAction(action.id,{status:'succeeded',result:{connected:true}});
    const delivered=f.repo.botGatewayDelivery(action.id,first.delivery.id,{deviceId:'native-pc'});assert.ok(delivered.action);
    const separate=f.repo.receiveBotGateway(action.id,{deviceId:'native-pc',platform:'webhook',chatId:'chat-two',messageId:'m1',content:'another chat'});assert.notEqual(separate.delivery.id,first.delivery.id);assert.equal(separate.delivery.status,'queued');
    const second=f.repo.receiveBotGateway(action.id,{deviceId:'native-pc',platform:'webhook',chatId:'chat-one',messageId:'m2',content:'second'});assert.equal(second.delivery.status,'queued');
    f.repo.resultA2AAction(delivered.action.id,{status:'succeeded',result:{output:'first done'}});
    const next=f.repo.botGatewayDelivery(action.id,second.delivery.id,{deviceId:'native-pc'});assert.ok(next.action);
    assert.equal(f.repo.receiveBotGateway(action.id,{deviceId:'native-pc',platform:'webhook',chatId:'chat-one',messageId:'m1',content:'first'}).delivery.action.id,delivered.action.id);
    assert.throws(()=>f.repo.receiveBotGateway(action.id,{deviceId:'native-pc',platform:'webhook',chatId:'chat-one',messageId:'m1',content:'changed'}),{code:'IDEMPOTENCY_CONFLICT'});
    assert.throws(()=>f.repo.deviceAction(next.action.id,{deviceId:'another-pc'}));
  }finally{f.repo.db.close();}
});
