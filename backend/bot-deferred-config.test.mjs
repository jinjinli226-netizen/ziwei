// Pure in-memory database/service tests: no app/server, network, CLI or model.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRepository} from './repository.mjs';
import {createManagementService} from './management.mjs';
import {completeOwnedProfile} from '../test-support/owned-profile.mjs';
import {deferredConfigIdleEvidence} from './bot-deferred-config.mjs';
import {createBotMcpConnections} from './bot-mcp-connections.mjs';
import crypto from 'node:crypto';

const slug='test-111',deviceId='deferred-pc',actorUserId='deferred-user';
const tree={launched:true,rootPid:1234,rootConfirmed:true,rootExitCode:0,treeConfirmed:true,activeProcesses:0,cancelled:false};
function fixture(t){
  const repo=createRepository({memory:true}),db=repo.db;
  const ws=repo.getWorkspace(slug);
  db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run('deferred-member',ws.id,actorUserId,'Owner','owner@fixture.invalid','owner',new Date().toISOString());
  repo.heartbeatDevice(slug,{deviceId,runtimes:{Hermes:{status:'available',version:'0.21.3',profiles:[{name:'default'}]}}});
  const context={actorUserId,enforceEmployeeVisibility:true,enforceDeviceOwnership:true};
  let bots=createManagementService(repo).bots;
  const bot=bots.create(slug,{name:'Deferred Bot',sourceProfile:'default',targetDeviceId:deviceId,model:'gpt-6.1-sol',idempotencyKey:'create'},context);
  completeOwnedProfile(repo,bot);
  const current=()=>bots.get(slug,bot.id,context);
  function complete(action,{status='succeeded',result={processExit:{...tree}},error}={}){if(action.status==='pending')repo.ackA2AAction(action.id,{deviceId});return repo.resultA2AAction(action.id,{deviceId,status,result,...(error?{error}:{})});}
  function validateAction(action){return complete(action,{result:{botValidation:{schemaVersion:1,employeeId:bot.id,revision:action.payload.hermesBot.revision,valid:true,effective:{}},processExit:{...tree}}});}
  validateAction(bots.validate(slug,bot.id,{expectedRevision:1,idempotencyKey:'initial-validation'},context).action);
  bots.control(slug,bot.id,{expectedRevision:1,expectedControlEpoch:current().control_epoch,operation:'activate'},context);
  const run=()=>{const a=repo.addConversationMessage(bot.main_conversation_id,{content:'only once'}).execution;repo.ackA2AAction(a.id,{deviceId});return repo.getA2AAction(a.id);};
  const enqueue=(changes={})=>{const c=current();return bots.update(slug,bot.id,{deferUntilIdle:true,expectedRevision:c.revision,expectedControlEpoch:c.control_epoch,idempotencyKey:'defer-once',config:{...c.config,memory:{...c.config.memory,enabled:false}},...changes},context);};
  const start=options=>bots.deferredConfig.start({pollIntervalMs:0,...options});
  const drain=()=>bots.deferredConfig.drain();
  const raw=()=>db.prepare('SELECT * FROM hermes_bots WHERE employee_id=?').get(bot.id);
  const restart=()=>{bots.deferredConfig.stop();bots=createManagementService(repo).bots;return bots;};
  t.after(()=>{bots.deferredConfig.stop();db.close();});
  return{repo,db,ws,bot,context,get bots(){return bots;},current,raw,complete,validateAction,run,enqueue,start,drain,restart};
}

test('busy explicit update only stores one durable intent; immediate behavior and original bytes are retained',t=>{
  const f=fixture(t),action=f.run(),before={...f.raw()},actionBefore=f.db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(action.id);
  assert.throws(()=>f.bots.update(slug,f.bot.id,{expectedRevision:before.revision,config:{...f.current().config,provider:'another'}},f.context),{code:'BOT_BUSY'});
  const queued=f.enqueue();assert.equal(queued.deferred,true);assert.equal(queued.deferredConfig.state,'pending');assert.equal(queued.deferredConfig.blockingActionId,action.id);
  assert.deepEqual({...f.raw()},before);assert.deepEqual(f.db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(action.id),actionBefore);
  assert.equal(f.enqueue().duplicate,true);assert.equal(f.db.prepare('SELECT count(*) n FROM bot_deferred_configs').get().n,1);
  assert.throws(()=>f.enqueue({config:{...f.current().config,provider:'different'}}),{code:'BOT_DEFERRED_IDEMPOTENCY_CONFLICT'});
  assert.throws(()=>f.enqueue({idempotencyKey:'second'}),{code:'BOT_DEFERRED_CONFIG_PENDING'});
  f.drain();assert.equal(f.current().deferredConfig.phase,'waiting_for_execution_evidence');assert.equal(f.raw().revision,before.revision);
});

test('real completion wake applies then waits for actual validation before restoring the original active state',async t=>{
  const f=fixture(t),action=f.run(),original=f.current();f.start();const queued=f.enqueue();
  f.complete(action);await Promise.resolve();
  const applied=f.current();assert.equal(applied.deferredConfig.state,'validating');assert.equal(applied.revision,original.revision+1);assert.equal(applied.control_state,'draft');assert.equal(applied.config.memory.enabled,false);
  const validation=f.repo.getA2AAction(applied.deferredConfig.validationActionId);assert.equal(validation.type,'hermes.bot.validate');assert.equal(f.raw().active_action_id,validation.id);
  assert.equal(f.repo.getA2AAction(action.id).status,'succeeded');
  f.validateAction(validation);await Promise.resolve();const done=f.current();
  assert.equal(done.deferredConfig.state,'completed');assert.equal(done.control_state,'active');assert.equal(done.employee.status,'active');assert.equal(done.revision,2);assert.equal(f.raw().active_action_id,null);
  const same=f.bots.update(slug,f.bot.id,{deferUntilIdle:true,expectedRevision:original.revision,expectedControlEpoch:original.control_epoch,idempotencyKey:'defer-once',config:{...original.config,memory:{...original.config.memory,enabled:false}}},f.context);
  assert.equal(same.duplicate,true);assert.equal(same.deferredConfig.id,queued.deferredConfig.id);
});

test('get never applies; a new service startup recovers the original intent and validation action exactly once',async t=>{
  const f=fixture(t),action=f.run();f.enqueue();f.complete(action);
  for(let i=0;i<3;i++)assert.equal(f.current().revision,1);
  f.restart();f.start();await Promise.resolve();const state=f.current().deferredConfig,validation=f.repo.getA2AAction(state.validationActionId);
  assert.equal(state.state,'validating');f.restart();f.start();await Promise.resolve();assert.equal(f.current().deferredConfig.validationActionId,validation.id);
  f.validateAction(validation);await Promise.resolve();assert.equal(f.current().deferredConfig.state,'completed');
  assert.equal(f.db.prepare("SELECT count(*) n FROM a2a_actions WHERE type='hermes.bot.validate'").get().n,2);
});

for(const kind of ['uncertain','missing-tree','abandoned','expired-acked'])test(`${kind} never authorizes automatic application`,t=>{
  const f=fixture(t),action=f.run();f.enqueue();
  if(kind==='expired-acked')f.db.prepare("UPDATE a2a_actions SET status='expired' WHERE id=?").run(action.id);
  else f.complete(action,{status:kind==='missing-tree'?'succeeded':'failed',error:kind==='missing-tree'?undefined:'unknown',result:kind==='missing-tree'?{processExit:{...tree,treeConfirmed:false}}:{code:'EXECUTION_UNCERTAIN',executionState:'uncertain',forceAbandonRecovery:{disposition:'abandoned_by_user'},processExit:null}});
  f.drain();assert.equal(f.raw().revision,1);assert.equal(f.current().deferredConfig.state,'pending');
});

for(const mutation of ['pause','revision','device','profile','membership','deleted','metadata'])test(`${mutation} after enqueue conflicts instead of overwriting or resuming`,t=>{
  const f=fixture(t),action=f.run();f.enqueue();f.complete(action);
  if(mutation==='pause')f.bots.control(slug,f.bot.id,{expectedRevision:1,expectedControlEpoch:f.current().control_epoch,operation:'pause'},f.context);
  if(mutation==='revision')f.db.prepare('UPDATE hermes_bots SET revision=revision+1 WHERE employee_id=?').run(f.bot.id);
  if(mutation==='device')f.db.prepare('UPDATE employees SET target_device_id=NULL WHERE id=?').run(f.bot.id);
  if(mutation==='profile')f.db.prepare("UPDATE employees SET runtime_profile='different' WHERE id=?").run(f.bot.id);
  if(mutation==='membership')f.db.prepare('DELETE FROM members WHERE user_id=?').run(actorUserId);
  if(mutation==='deleted')f.db.prepare("UPDATE employees SET status='deleted' WHERE id=?").run(f.bot.id);
  if(mutation==='metadata'){
    f.bots.update(slug,f.bot.id,{expectedRevision:1,employee:{name:'Newer independent edit'}},f.context);
    // This intent never requested name, so an unrelated metadata edit is preserved.
    f.drain();assert.equal(f.raw().revision,2);assert.equal(f.current().employee.name,'Newer independent edit');return;
  }
  f.drain();const state=f.db.prepare('SELECT * FROM bot_deferred_configs').get();assert.equal(state.state,'conflict');assert.equal(f.raw().config_json.includes('"enabled":false'),false);
});

test('targeted employee fields use their original baseline, not only the Bot revision',t=>{
  const f=fixture(t),action=f.run();f.enqueue({employee:{name:'Queued name'}});f.complete(action);f.bots.update(slug,f.bot.id,{expectedRevision:1,employee:{name:'Newer name'}},f.context);f.drain();assert.equal(f.current().deferredConfig.state,'conflict');assert.equal(f.current().employee.name,'Newer name');
});

test('validation failure or incomplete tree cannot activate a saved config',t=>{
  const f=fixture(t),action=f.run();f.enqueue();f.complete(action);f.drain();const validation=f.repo.getA2AAction(f.current().deferredConfig.validationActionId);
  f.complete(validation,{result:{botValidation:{schemaVersion:1,employeeId:f.bot.id,revision:2,valid:true},processExit:{...tree,treeConfirmed:false}}});f.drain();assert.equal(f.current().deferredConfig.state,'failed');assert.equal(f.current().control_state,'draft');
});

test('device credential revocation and replacement are rechecked without retaining a bearer or an actor role',t=>{
  const f=fixture(t);f.db.prepare('UPDATE devices SET owner_user_id=? WHERE id=?').run(actorUserId,deviceId);
  f.db.prepare('INSERT INTO device_credentials(id,device_id,workspace_id,token_hash,token_prefix,created_at) VALUES(?,?,?,?,?,?)').run('deferred-credential',deviceId,f.ws.id,'private-token-hash','private',new Date().toISOString());
  const action=f.run(),c=f.current(),input={deferUntilIdle:true,expectedRevision:1,expectedControlEpoch:c.control_epoch,idempotencyKey:'device-intent',employee:{name:'Device queued'}};
  f.bots.update(slug,f.bot.id,input,{...f.context,deviceScope:deviceId,deviceCredentialDeviceId:deviceId,authenticatedMcp:true});
  const intent=f.db.prepare('SELECT intent_json FROM bot_deferred_configs').get().intent_json;assert(!intent.includes('private-token-hash'));assert(!intent.includes('actorRole'));
  f.complete(action);f.db.prepare('UPDATE device_credentials SET revoked_at=? WHERE id=?').run(new Date().toISOString(),'deferred-credential');f.drain();assert.equal(f.current().deferredConfig.state,'conflict');assert.equal(f.current().employee.name,'Deferred Bot');
});

test('anonymous generic MCP cannot create durable authority, while normal immediate updates retain their original contract',t=>{
  const f=fixture(t);const c=f.current();assert.throws(()=>f.bots.update(slug,f.bot.id,{deferUntilIdle:true,expectedRevision:1,expectedControlEpoch:c.control_epoch,idempotencyKey:'anonymous'}, {authenticatedMcp:true}),{code:'BOT_DEFERRED_ACTOR_REQUIRED'});
  const saved=f.bots.update(slug,f.bot.id,{expectedRevision:1,employee:{name:'Immediate metadata'}},f.context);assert.equal(saved.employee.name,'Immediate metadata');assert.equal(saved.revision,1);
});

test('MCP hooks run serially after validation and restore, with durable keys and exact original action reads',t=>{
  const f=fixture(t),action=f.run(),config={...f.current().config,mcpServers:{alpha:{url:'https://alpha.invalid/mcp'},beta:{url:'https://beta.invalid/mcp'}}};
  f.enqueue({config,connectMcpServers:['alpha','beta']});f.complete(action);f.drain();const validation=f.repo.getA2AAction(f.current().deferredConfig.validationActionId);f.validateAction(validation);f.drain();
  const calls=[],snapshots=new Map();
  const make=({workspace,employeeId,server,idempotencyKey,context})=>{
    assert.equal(f.current().control_state,'active');calls.push({server,idempotencyKey});
    const current=f.current(),a=f.bots.native(workspace,employeeId,{expectedRevision:current.revision,expectedControlEpoch:current.control_epoch,idempotencyKey,resource:'mcp',operation:'inspect',input:{server}},context).action;
    const s={id:a.id,workspace,employeeId,server,revision:current.revision,controlEpoch:current.control_epoch,status:'connecting'};snapshots.set(a.id,s);return s;
  };
  f.start({connectMcp:make,readMcp:({actionId})=>snapshots.get(actionId)});f.drain();assert.deepEqual(calls.map(x=>x.server),['alpha']);
  const first=f.current().deferredConfig.connections[0],a=f.repo.getA2AAction(first.actionId);f.complete(a);snapshots.get(a.id).status='connected';
  f.drain();assert.deepEqual(calls.map(x=>x.server),['alpha','beta']);f.drain();assert.equal(calls.length,2);
  const second=f.current().deferredConfig.connections[1];f.complete(f.repo.getA2AAction(second.actionId));snapshots.get(second.actionId).status='connected';f.drain();assert.equal(f.current().deferredConfig.state,'completed');
  assert(calls.every(x=>x.idempotencyKey.startsWith(`deferred-mcp:${f.current().deferredConfig.id}:`)));
});

test('idle evidence rejects empty success and abandonment; only a bound no-launch receipt can replace tree evidence',()=>{
  assert.equal(deferredConfigIdleEvidence({status:'succeeded',result:{}}),false);
  const action={id:'a',status:'failed',acked_at:'now',payload:{employeeId:'e',deviceId:'d',profile:'p',hermesBot:{workspace:'w',revision:1,controlEpoch:2}}};
  const prelaunch={schemaVersion:1,source:'bot-start-admission',phase:'before-runtime-spawn',spawnAttempted:false,actionId:'a',workspace:'w',employeeId:'e',deviceId:'d',profile:'p',revision:1,controlEpoch:2,method:'POST',operation:'bot-start',denial:{status:409,code:'BOT_REVISION_CONFLICT'}};
  action.result={prelaunch,processExit:{launched:false,rootPid:null,rootExitCode:null,treeConfirmed:true,activeProcesses:0,supervisor:'runtime-prelaunch'}};
  assert.equal(deferredConfigIdleEvidence(action),true);action.result.prelaunch.deviceId='other';assert.equal(deferredConfigIdleEvidence(action),false);
});

test('a pause while validation is in flight is never undone by a later successful validation',t=>{
  const f=fixture(t),action=f.run();f.enqueue();f.complete(action);f.drain();const validation=f.repo.getA2AAction(f.current().deferredConfig.validationActionId);
  const before=f.current();f.bots.control(slug,f.bot.id,{expectedRevision:before.revision,expectedControlEpoch:before.control_epoch,operation:'pause'},f.context);
  f.validateAction(validation);f.drain();assert.equal(f.current().control_state,'paused');assert.equal(f.current().deferredConfig.state,'conflict');
});

test('apply and validation creation roll back as one transaction on a concrete validation admission failure',t=>{
  const f=fixture(t),action=f.run();f.enqueue();f.complete(action);const before={...f.raw()},count=f.db.prepare('SELECT count(*) n FROM a2a_actions').get().n;
  f.db.exec("CREATE TRIGGER deferred_reject_validation BEFORE INSERT ON a2a_actions WHEN NEW.type='hermes.bot.validate' BEGIN SELECT RAISE(ABORT,'fixture validation rejected'); END");
  f.drain();assert.deepEqual({...f.raw()},before);assert.equal(f.db.prepare('SELECT count(*) n FROM a2a_actions').get().n,count);assert.equal(f.current().deferredConfig.state,'conflict');
});

test('an unrelated completion cannot release the exact original acknowledged execution',async t=>{
  const f=fixture(t),action=f.run();f.start();f.enqueue();
  f.repo.onBotActionCompleted(()=>{throw new Error('subscriber error must not replace committed response');});
  const unrelated=f.repo.createA2AAction(slug,{type:'task.execute',payload:{prompt:'unrelated',runtime:'Codex'},dedupeKey:'unrelated'});f.complete(unrelated);
  await Promise.resolve();assert.equal(f.raw().revision,1);assert.equal(f.raw().active_action_id,action.id);assert.equal(f.current().deferredConfig.state,'pending');
});

test('a deferred intent reserves new business admission but permits its original in-flight action and native validation',t=>{
  const f=fixture(t),action=f.run();f.enqueue();assert.equal(f.repo.authorizeBotStart(action.id,{deviceId}).actionId,action.id);
  assert.throws(()=>f.repo.addConversationMessage(f.bot.main_conversation_id,{content:'new business'}),{code:'BOT_DEFERRED_CONFIG_BUSY'});
  f.complete(action);f.drain();assert.equal(f.current().deferredConfig.state,'validating');
});

test('a temporary offline discovery leaves an unapplied intent pending and resumes after a fresh heartbeat',t=>{
  const f=fixture(t),action=f.run();f.enqueue();f.complete(action);
  f.db.prepare("UPDATE devices SET status='offline',heartbeat_at=NULL,last_seen=NULL WHERE id=?").run(deviceId);f.drain();assert.equal(f.raw().revision,1);assert.equal(f.current().deferredConfig.state,'pending');assert.equal(f.current().deferredConfig.phase,'waiting_for_device');
  f.repo.heartbeatDevice(slug,{deviceId,runtimes:{Hermes:{status:'available',version:'0.21.3',profiles:[{name:'default'}]}}});f.drain();assert.equal(f.current().deferredConfig.state,'validating');
});

test('the actual MCP connection service shares the final activation epoch, holds the slot, and is recovered without another action',t=>{
  const f=fixture(t),action=f.run();f.enqueue({config:{...f.current().config,mcpServers:{example:{url:'https://example.invalid/mcp'}}},connectMcpServers:['example']});
  const connections=createBotMcpConnections(f.repo,f.bots,{apiBase:'https://fixture.invalid'});f.start(connections.deferredHandlers);
  f.complete(action);f.drain();const validation=f.repo.getA2AAction(f.current().deferredConfig.validationActionId);f.validateAction(validation);f.drain();
  const current=f.current(),intent=current.deferredConfig,connection=f.repo.getA2AAction(intent.connections[0].actionId);assert.equal(intent.state,'connecting');assert.equal(current.control_state,'active');assert.equal(connection.payload.hermesBot.controlEpoch,current.control_epoch);assert.equal(f.raw().active_action_id,connection.id);
  assert.throws(()=>f.repo.addConversationMessage(f.bot.main_conversation_id,{content:'do not race setup'}),{code:'BOT_DEFERRED_CONFIG_BUSY'});
  const count=f.db.prepare('SELECT count(*) n FROM a2a_actions').get().n;f.drain();assert.equal(f.db.prepare('SELECT count(*) n FROM a2a_actions').get().n,count);
  f.complete(connection,{result:{processExit:{...tree},nativeOperation:{schemaVersion:2,employeeId:f.bot.id,revision:current.revision,resource:'mcp',operation:'inspect',status:'succeeded',data:{connected:true,tools:[]}}}});f.drain();assert.equal(f.current().deferredConfig.state,'completed');assert.equal(connections.read(slug,f.bot.id,connection.id,f.context).connection.status,'connected');
});

test('a future intent schema with internally consistent bytes is not interpreted by an older worker',t=>{
  const f=fixture(t),action=f.run();f.enqueue();f.complete(action);
  const row=f.db.prepare('SELECT * FROM bot_deferred_configs').get(),intent=JSON.parse(row.intent_json);intent.schemaVersion=2;
  const canonical=JSON.stringify(intent,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
  f.db.prepare('UPDATE bot_deferred_configs SET intent_json=?,intent_digest=? WHERE id=?').run(canonical,crypto.createHash('sha256').update(canonical).digest('hex'),row.id);
  f.drain();assert.equal(f.current().deferredConfig.state,'conflict');assert.equal(f.current().deferredConfig.errorCode,'BOT_DEFERRED_RECORD_INVALID');assert.equal(f.raw().revision,1);
});

test('an initially paused idle Bot keeps its pause after a requested deferred configuration is validated',t=>{
  const f=fixture(t),before=f.current();f.bots.control(slug,f.bot.id,{expectedRevision:before.revision,expectedControlEpoch:before.control_epoch,operation:'pause'},f.context);
  f.enqueue();f.drain();const validation=f.repo.getA2AAction(f.current().deferredConfig.validationActionId);f.validateAction(validation);f.drain();assert.equal(f.current().deferredConfig.state,'completed');assert.equal(f.current().control_state,'paused');assert.equal(f.current().employee.status,'paused');
});

test('the deferred contract is discoverable without requiring a new employee CLI tool schema',t=>{
  const f=fixture(t),contract=f.bots.capabilities(slug,{deviceId},f.context).deferredConfiguration;
  assert.equal(contract.supported,true);assert.equal(contract.operation,'update');assert.equal(contract.projection,'deferredConfig');assert.equal(contract.requiresClientUpdate,false);assert(contract.required.includes('expectedControlEpoch'));
});
