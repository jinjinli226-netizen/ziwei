// In-memory services/SQLite only. No network, app listener, CLI or model.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRepository} from './repository.mjs';
import {createManagementService} from './management.mjs';
import {createBotManagementActionReader} from './bot-management-view.mjs';
import {completeOwnedProfile} from '../test-support/owned-profile.mjs';

const slug='test-111',deviceId='compact-pc',actorUserId='compact-user';
const tree={launched:true,rootPid:987,rootConfirmed:true,rootExitCode:0,treeConfirmed:true,activeProcesses:0,cancelled:false,hostExitCode:0};
const privateHistory='HISTORY_MUST_STAY_ON_ORIGINAL_ACTION_'.repeat(3000);
function fixture(t){
  const repo=createRepository({memory:true}),db=repo.db,ws=repo.getWorkspace(slug),bots=createManagementService(repo).bots;
  db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run('compact-member',ws.id,actorUserId,'Owner','compact@fixture.invalid','owner',new Date().toISOString());
  repo.heartbeatDevice(slug,{deviceId,runtimes:{Hermes:{status:'available',version:'0.22.0',profiles:[{name:'default'}]}}});
  const context={actorUserId,enforceEmployeeVisibility:true},mcp={...context,authenticatedMcp:true};
  const bot=bots.create(slug,{name:'Compact Bot',sourceProfile:'default',targetDeviceId:deviceId,model:'gpt-6.1-sol',idempotencyKey:'compact-create'},context);completeOwnedProfile(repo,bot);
  const validation=bots.validate(slug,bot.id,{expectedRevision:1,idempotencyKey:'compact-validate'},context).action;
  repo.ackA2AAction(validation.id,{deviceId});repo.resultA2AAction(validation.id,{deviceId,status:'succeeded',result:{botValidation:{schemaVersion:1,employeeId:bot.id,revision:1,valid:true,effective:{provider:'openai-codex',model:'gpt-6.1-sol',maxTurns:Number.MAX_SAFE_INTEGER,turnLimit:{mode:'unlimited',effectiveMaxTurns:Number.MAX_SAFE_INTEGER,runBudgetSeconds:86400,status:'validated'}}},processExit:tree}});
  bots.control(slug,bot.id,{expectedRevision:1,expectedControlEpoch:1,operation:'activate'},context);
  const source=repo.addConversationMessage(bot.main_conversation_id,{content:'Self configuration original turn'}).execution;repo.ackA2AAction(source.id,{deviceId});
  const current=()=>bots.get(slug,bot.id,context),compact=()=>bots.get(slug,bot.id,mcp);
  function history(count=120){
    const p=repo.getA2AAction(source.id).payload;
    const insert=db.prepare('INSERT INTO a2a_actions(id,workspace_id,agent_id,type,payload_json,dedupe_key,status,created_at,acked_at,completed_at,result_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
    const event=db.prepare('INSERT INTO a2a_action_events(id,action_id,type,data_json,created_at) VALUES(?,?,?,?,?)');
    const payload=JSON.stringify({...p,prompt:privateHistory,nativeOperation:{resource:'sessions',operation:'read',input:{sessionId:'original'}}});
    const result=JSON.stringify({output:privateHistory,diagnostics:[privateHistory],processExit:tree,nativeOperation:{schemaVersion:2,employeeId:bot.id,revision:1,resource:'sessions',operation:'read',status:'succeeded',data:{session_id:'original',message_count:5000,messages:[{role:'assistant',content:privateHistory}],rawDump:privateHistory}}});
    db.exec('BEGIN');try{for(let n=0;n<count;n++){const id=`compact-history-${n}`,stamp=new Date(Date.parse('2026-01-01T00:00:00Z')+n*1000).toISOString();insert.run(id,ws.id,'ziwei_user','hermes.bot.native',payload,id,'succeeded',stamp,stamp,stamp,result);event.run(`event-${id}`,id,'succeeded',JSON.stringify({result:{output:privateHistory}}),stamp);}db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
    return{lastId:`compact-history-${count-1}`,payload,result};
  }
  t.after(()=>{bots.deferredConfig.stop();db.close();});
  return{repo,db,ws,bots,bot,context,mcp,source,current,compact,history};
}

test('management get stays bounded with 120 large native histories and events while preserving the current configuration and active identity',t=>{
  const f=fixture(t),original=f.current(),sourceBefore=f.repo.getA2AAction(f.source.id);f.history();
  // The latest historical native action contains Session content too: this is
  // another independent route by which previous replies used to be re-embedded.
  f.db.prepare('UPDATE a2a_actions SET created_at=? WHERE id=?').run('2099-01-01T00:00:00Z','compact-history-119');
  const originalGet=f.repo.getA2AAction;let detailReads=0;f.repo.getA2AAction=function(...args){detailReads++;return originalGet.apply(this,args);};
  const compact=f.compact(),text=JSON.stringify(compact);
  assert.equal(detailReads,0,'ordinary compact reads never load full actions or event rows');
  assert(text.length<40000,`bounded management state was ${text.length} characters`);assert(!text.includes('HISTORY_MUST_STAY_ON_ORIGINAL_ACTION'));
  assert.deepEqual(compact.config,original.config);assert.deepEqual(compact.employee,original.employee);assert.deepEqual(compact.instance,original.instance);
  assert.equal(compact.revision,original.revision);assert.equal(compact.control_epoch,original.control_epoch);assert.equal(compact.main_conversation_id,original.main_conversation_id);
  assert.equal(compact.active_run.id,f.source.id);assert.equal(compact.active_run.status,'acked');assert.equal(compact.active_run.payload.employeeId,f.bot.id);assert.equal(compact.active_run.payload.deviceId,deviceId);assert.equal(compact.active_run.payload.profile,f.bot.instance.profile);assert.equal(compact.active_run.payload.hermesBot.revision,1);
  assert.equal(compact.validation.receipt.valid,true);assert.equal(compact.validation.receipt.effective.maxTurns,Number.MAX_SAFE_INTEGER);
  assert.equal(compact.nativeResources.sessions.data.message_count,5000);assert.equal(compact.nativeResources.sessions.data.messages,undefined);
  assert.equal(compact.latest_run.managementSummary.eventsIncluded,false);assert.equal(compact.latest_run.events,undefined);assert.deepEqual(compact.latest_run.result.processExit,tree);
  assert.equal(compact.capabilityGate.state,'checking');
  f.repo.getA2AAction=originalGet;assert.deepEqual(f.repo.getA2AAction(f.source.id),sourceBefore);
  const web=f.current();assert.equal(web.managementView,undefined);assert(web.latest_run.events.length>0);assert.equal(web.latest_run.result.output,privateHistory,'ordinary web get retains its existing full detail semantics');
});

test('deferred acknowledgement and its stable-key replay do not return the full history even to a browser actor',t=>{
  const f=fixture(t),saved=f.current();f.history();
  const input={deferUntilIdle:true,expectedRevision:saved.revision,expectedControlEpoch:saved.control_epoch,idempotencyKey:'compact-defer',config:{...saved.config,memory:{...saved.config.memory,enabled:false}}};
  const ack=f.bots.update(slug,f.bot.id,input,f.context),same=f.bots.update(slug,f.bot.id,input,f.context);
  for(const reply of [ack,same]){assert(reply.deferred);assert.equal(reply.deferredConfig.state,'pending');assert.equal(reply.deferredConfig.blockingActionId,f.source.id);assert.equal(reply.active_run.id,f.source.id);assert.equal(reply.managementView.historyIncluded,false);assert(JSON.stringify(reply).length<40000);assert(!JSON.stringify(reply).includes('HISTORY_MUST_STAY_ON_ORIGINAL_ACTION'));assert.deepEqual(reply.config,saved.config);}
  assert.equal(same.duplicate,true);assert.equal(same.deferredConfig.id,ack.deferredConfig.id);assert.equal(f.current().revision,1);assert.equal(f.repo.getA2AAction(f.source.id).status,'acked');
});

test('precise exit, native MCP connection and tool-name receipts remain readable without native arbitrary data',t=>{
  const f=fixture(t),action=f.repo.getA2AAction(f.source.id),reader=createBotManagementActionReader(f.repo);
  const payload={...action.payload,nativeOperation:{resource:'mcp',operation:'inspect',input:{server:'viral_library',arguments:privateHistory}}};
  const result={output:privateHistory,processExit:tree,nativeOperation:{schemaVersion:2,resource:'mcp',operation:'inspect',employeeId:f.bot.id,revision:1,status:'succeeded',data:{connected:true,tools:[{name:'search_library',description:privateHistory,inputSchema:{examples:[privateHistory]}}],token:'never return arbitrary native data',messages:[privateHistory]}}};
  f.db.prepare("UPDATE a2a_actions SET type='hermes.bot.native',status='succeeded',payload_json=?,result_json=? WHERE id=?").run(JSON.stringify(payload),JSON.stringify(result),action.id);
  const compact=reader(action.id,f.ws.id);assert.deepEqual(compact.result.processExit,tree);assert.equal(compact.result.nativeOperation.data.connected,true);assert.deepEqual(compact.result.nativeOperation.data.tools,[{name:'search_library'}]);assert.equal(compact.result.nativeOperation.data.token,undefined);assert.equal(compact.payload.nativeOperation.input.arguments,undefined);assert(!JSON.stringify(compact).includes('HISTORY_MUST_STAY_ON_ORIGINAL_ACTION'));
  assert.equal(reader(action.id,'other-workspace'),null);assert.equal(f.repo.getA2AAction(action.id).result.output,privateHistory);
});

test('omitted nested histories cannot turn an unresolved result into a confirmed success or confer an invented recovery',t=>{
  const f=fixture(t),reader=createBotManagementActionReader(f.repo),result={processExit:tree,diagnostic:{nested:{code:'EXECUTION_UNCERTAIN',executionState:'uncertain',output:privateHistory}}};
  f.db.prepare("UPDATE a2a_actions SET status='failed',result_json=?,error='Original unknown' WHERE id=?").run(JSON.stringify(result),f.source.id);
  const compact=reader(f.source.id,f.ws.id);assert.equal(compact.result.executionState,'uncertain');assert.equal(compact.status,'failed');assert.equal(compact.error,'Original unknown');assert.deepEqual(compact.result.processExit,tree);assert.equal(compact.forceAbandonRecovery,undefined);assert.equal(compact.prelaunchRecovery,undefined);
  const state=f.compact();assert.equal(state.capabilityGate.state,'failed');assert.equal(state.active_run.result.executionState,'uncertain');assert(!JSON.stringify(state).includes('HISTORY_MUST_STAY_ON_ORIGINAL_ACTION'));
});

test('a recovery marker without a validated original receipt never becomes compact recovery authority',t=>{
  const f=fixture(t),reader=createBotManagementActionReader(f.repo);
  f.db.prepare("UPDATE a2a_actions SET status='failed',result_json=? WHERE id=?").run(JSON.stringify({code:'EXECUTION_UNCERTAIN',executionState:'uncertain',processExit:null}),f.source.id);
  f.db.prepare('INSERT INTO management_requests(workspace_id,kind,request_key,fingerprint,resource_id,created_at) VALUES(?,?,?,?,?,?)').run(f.ws.id,'bot-force-abandon-recovery-v1',f.source.id,'fake','missing-event',new Date().toISOString());
  const compact=reader(f.source.id,f.ws.id);assert.equal(compact.forceAbandonRecovery,undefined);assert.equal(compact.result.executionState,'uncertain');assert.equal(compact.result.processExit,null);
});

test('latest ordinary chat does not erase the exact last receipt of each native resource',t=>{
  const f=fixture(t);f.history(2);const source=f.repo.getA2AAction(f.source.id),insert=f.db.prepare('INSERT INTO a2a_actions(id,workspace_id,agent_id,type,payload_json,dedupe_key,status,created_at,result_json) VALUES(?,?,?,?,?,?,?,?,?)');
  for(const resource of ['memory','mcp']){
    const actionId=`resource-${resource}`,data=resource==='mcp'?{connected:true,tools:[{name:'lookup',description:privateHistory}]}:{items:[{content:privateHistory}]};
    insert.run(actionId,f.ws.id,'ziwei_user','hermes.bot.native',JSON.stringify({...source.payload,nativeOperation:{resource,operation:resource==='mcp'?'inspect':'read',input:{server:'viral_library'}}}),actionId,'succeeded','2026-01-02T00:00:00Z',JSON.stringify({output:privateHistory,processExit:tree,nativeOperation:{schemaVersion:2,employeeId:f.bot.id,revision:1,resource,operation:resource==='mcp'?'inspect':'read',status:'succeeded',data}}));
  }
  const view=f.compact();assert.equal(view.latest_run.id,f.source.id);assert.deepEqual(Object.keys(view.nativeResources).sort(),['mcp','memory','sessions']);assert.equal(view.nativeResources.memory.actionId,'resource-memory');assert.equal(view.nativeResources.mcp.data.connected,true);assert.deepEqual(view.nativeResources.mcp.data.tools,[{name:'lookup'}]);assert.equal(view.nativeResources.sessions.actionId,'compact-history-1');assert.equal(view.managementView.capabilityEvidence,'bounded_summary');assert(JSON.stringify(view).length<40000);assert(!JSON.stringify(view).includes('HISTORY_MUST_STAY_ON_ORIGINAL_ACTION'));
});

test('server-reader supplied committed recovery authorities and their small original unknown body survive the compact projection verbatim',t=>{
  const f=fixture(t),reader=createBotManagementActionReader(f.repo),result={code:'EXECUTION_UNCERTAIN',executionState:'uncertain',processExit:null,partialEffectsPossible:true,reason:'EXECUTOR_WITHOUT_EXIT_EVIDENCE'};
  f.db.prepare("UPDATE a2a_actions SET status='failed',result_json=? WHERE id=?").run(JSON.stringify(result),f.source.id);
  const read=f.repo.getA2AAction;
  // The full cryptographic/event reader is tested in the recovery service suites.
  // This fixture supplies that trusted boundary and tests only lossless mapping.
  const authority={schemaVersion:2,kind:'bot.operator_force_abandon',subject:{actionId:f.source.id,originalPayloadSha256:'a'.repeat(64),originalResultSha256:'b'.repeat(64)},executionState:'uncertain',executionConfirmedStopped:false,partialEffectsPossible:true,disposition:'abandoned_by_user'};
  const prelaunch={schemaVersion:2,kind:'bot.historical_prelaunch_recovery',subject:{actionId:f.source.id},admissionProof:{scope:'conversation-runtime-root',launched:false,partialEffectsPossible:true}};
  f.repo.getA2AAction=(id,options)=>({...read.call(f.repo,id,options),forceAbandonRecovery:authority,prelaunchRecovery:prelaunch});
  f.db.prepare('INSERT INTO management_requests(workspace_id,kind,request_key,fingerprint,resource_id,created_at) VALUES(?,?,?,?,?,?)').run(f.ws.id,'bot-force-abandon-recovery-v1',f.source.id,'trusted-reader-fixture','adapter-only',new Date().toISOString());
  const view=reader(f.source.id,f.ws.id);assert.deepEqual(view.forceAbandonRecovery,authority);assert.deepEqual(view.prelaunchRecovery,prelaunch);assert.deepEqual(view.result,result);assert.equal(view.status,'failed');assert.equal(view.forceAbandonRecovery.executionConfirmedStopped,false);
  f.repo.getA2AAction=read;
});

test('an expanded legacy reason is bounded while the original error and unknown execution remain available on the source action',t=>{
  const f=fixture(t),reader=createBotManagementActionReader(f.repo),result={code:'EXECUTION_UNCERTAIN',reason:'large legacy reason '.repeat(10000),processExit:null};
  f.db.prepare("UPDATE a2a_actions SET status='failed',result_json=?,error=? WHERE id=?").run(JSON.stringify(result),'original failure',f.source.id);
  const view=reader(f.source.id,f.ws.id);assert.equal(view.result.reason.length,2000);assert.equal(view.result.executionState,'uncertain');assert.equal(view.error,'original failure');assert.equal(f.repo.getA2AAction(f.source.id).result.reason,result.reason);assert(JSON.stringify(view).length<10000);
});
