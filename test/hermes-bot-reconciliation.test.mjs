import test from 'node:test';
import assert from 'node:assert/strict';
import {createRepository} from '../backend/repository.mjs';
import {createManagementService} from '../backend/management.mjs';
import {completeOwnedProfile} from '../test-support/owned-profile.mjs';
import {createApp} from '../backend/app.mjs';

const slug='test-111',deviceId='recovery-pc';
const exitProof={launched:true,rootPid:1234,rootConfirmed:true,rootExitCode:0,treeConfirmed:true,activeProcesses:0,cancelled:false};
function fixture(t,{model='gpt-6.1-sol',reasoning=false}={}){
  const repo=createRepository({memory:true}),bots=createManagementService(repo).bots;t.after(()=>repo.db.close());
  repo.heartbeatDevice(slug,{deviceId,runtimes:{Hermes:{status:'available',version:'0.21.3',profiles:[{name:'default'}]}}});
  const bot=bots.create(slug,{name:'Original Bot',sourceProfile:'default',targetDeviceId:deviceId,model,idempotencyKey:'create',...(reasoning?{config:{reasoningEffort:'max'}}:{})});
  completeOwnedProfile(repo,bot);
  const validate=()=>bots.validate(slug,bot.id,{expectedRevision:1,idempotencyKey:'validation'}).action;
  const current=()=>bots.get(slug,bot.id);
  const control=operation=>{const saved=current();return bots.control(slug,bot.id,{expectedRevision:saved.revision,expectedControlEpoch:saved.control_epoch,operation});};
  const expire=actionId=>repo.db.prepare("UPDATE a2a_actions SET status='expired',completed_at=?,expires_at=? WHERE id=?").run('2026-01-01T00:16:00.000Z','2026-01-01T00:15:00.000Z',actionId);
  const validationResult=(action,selectedModel='gpt-6.1-sol')=>({botValidation:{schemaVersion:1,employeeId:bot.id,revision:1,valid:true,effective:{provider:'openai-codex',model:selectedModel,...(reasoning?{reasoning:{schemaVersion:1,employeeId:bot.id,revision:1,provider:'openai-codex',model:selectedModel,requested:'max',effective:'max',actual:'max',nativeActual:'xhigh',mode:'verified_gpt61_sol_max',actualModel:selectedModel,status:'matched',phase:'preflight',evidence:'native_codex_transport'}}:{})}},processExit:{...exitProof}});
  const conversation=()=>{const check=validate();repo.ackA2AAction(check.id,{deviceId});repo.resultA2AAction(check.id,{deviceId,status:'succeeded',result:validationResult(check)});control('activate');const message=repo.addConversationMessage(bot.main_conversation_id,{content:'Run this only once'});const action=repo.getA2AAction(message.execution.id);repo.ackA2AAction(action.id,{deviceId});return action;};
  return{repo,bots,bot,validate,current,control,expire,validationResult,conversation};
}

test('expired acknowledged Bot stop creates a cancellation, reuses pending delivery, and retries a terminal cancellation',t=>{
  const f=fixture(t),action=f.conversation();f.expire(action.id);
  const first=f.control('stop');
  assert.equal(first.control_state,'paused');assert.equal(first.stop_action.type,'action.cancel');
  assert.equal(first.stop_action.payload.actionId,action.id);assert.equal(first.stop_action.payload.deviceId,deviceId);
  assert.equal(first.stop_action.result?.stopConfirmed,undefined);
  const pending=f.control('stop');assert.equal(pending.stop_action.id,first.stop_action.id);
  f.repo.ackA2AAction(first.stop_action.id,{deviceId});f.repo.resultA2AAction(first.stop_action.id,{deviceId,status:'failed',error:'No in-memory controller',result:{stopConfirmed:false}});
  const retry=f.control('stop');assert.notEqual(retry.stop_action.id,first.stop_action.id);assert.notEqual(retry.stop_action.dedupe_key,first.stop_action.dedupe_key);
  assert.equal(f.repo.db.prepare('SELECT active_action_id FROM hermes_bots WHERE employee_id=?').get(f.bot.id).active_action_id,action.id);
  assert.equal(f.repo.getA2AAction(action.id).status,'expired');
});

test('receipt-only expired ACK permits completion delivery without renewing or granting execution',t=>{
  const f=fixture(t),action=f.conversation();f.expire(action.id);
  const receipt=f.repo.ackA2AAction(action.id,{deviceId,receiptOnly:true,renewLease:true});
  assert.equal(receipt.status,'expired');assert.equal(receipt.reconciliationRequired,true);assert.equal(receipt.deliveryOnly,true);assert.equal(receipt.leaseRenewed,false);
  assert.equal(receipt.expires_at,'2026-01-01T00:15:00.000Z');assert.ok(receipt.acked_at);assert.equal(receipt.deviceId,deviceId);
  assert.throws(()=>f.repo.ackA2AAction(action.id,{deviceId}),/expired/);
  assert.throws(()=>f.repo.authorizeBotStart(action.id,{deviceId}),{code:'BOT_START_INVALID'});
});

test('same-device definitive stopped result settles the original expired conversation once and clears its occupancy',t=>{
  const f=fixture(t),action=f.conversation();f.expire(action.id);f.control('pause');
  const result={output:'Original execution was cancelled',processExit:{...exitProof,rootExitCode:null,cancelled:true}};
  const settled=f.repo.resultA2AAction(action.id,{deviceId,status:'failed',error:'Cancelled original execution',result});
  assert.equal(settled.id,action.id);assert.equal(settled.status,'failed');assert.equal(settled.result.stopConfirmed,true);
  assert.equal(f.current().control_state,'paused');assert.equal(f.current().latest_run.id,action.id);
  assert.equal(f.repo.db.prepare('SELECT active_action_id FROM hermes_bots WHERE employee_id=?').get(f.bot.id).active_action_id,null);
  const recovery=f.repo.getA2AAction(action.id).events.find(event=>event.type==='action.reconciled');
  assert.equal(recovery.data.previousStatus,'expired');assert.equal(recovery.data.previousCompletedAt,'2026-01-01T00:16:00.000Z');assert.equal(recovery.data.expiresAt,'2026-01-01T00:15:00.000Z');
  const before=f.repo.getConversation(f.bot.main_conversation_id).messages.length;
  assert.equal(f.repo.resultA2AAction(action.id,{deviceId,status:'failed',error:'Duplicate',result}).duplicate,true);
  assert.equal(f.repo.getConversation(f.bot.main_conversation_id).messages.length,before);
  assert.equal(f.repo.db.prepare("SELECT COUNT(*) n FROM a2a_actions WHERE type='conversation.execute'").get().n,1);
});

test('late definitive stop replaces an uncertain failure using the same original action and trusted device',t=>{
  const f=fixture(t),action=f.conversation();
  f.repo.resultA2AAction(action.id,{deviceId,status:'failed',error:'Stopping not confirmed',result:{code:'EXECUTION_UNCERTAIN',executionState:'uncertain'}});
  assert.equal(f.repo.ackA2AAction(action.id,{deviceId,receiptOnly:true}).reconciliationRequired,true);
  const messagesBefore=f.repo.getConversation(f.bot.main_conversation_id).messages.length;
  const settled=f.repo.resultA2AAction(action.id,{deviceId,status:'failed',error:'Original process tree has exited',result:{processExit:{...exitProof,cancelled:true}}});
  assert.equal(settled.result.stopConfirmed,true);assert.equal(settled.result.code,undefined);
  assert.equal(f.repo.db.prepare('SELECT active_action_id FROM hermes_bots WHERE employee_id=?').get(f.bot.id).active_action_id,null);
  assert.equal(f.repo.getA2AAction(action.id).events.find(event=>event.type==='action.reconciled').data.previousStatus,'failed');
  assert.equal(f.repo.getConversation(f.bot.main_conversation_id).messages.length,messagesBefore);
});

test('expired completion refuses absent, wrong-device, incomplete, uncertain and mismatched Bot evidence',t=>{
  const f=fixture(t),action=f.conversation();f.expire(action.id);
  const base={deviceId,status:'succeeded',result:{processExit:{...exitProof},output:'Original answer'}};
  for(const input of [{...base,deviceId:undefined},{...base,result:{}},{...base,result:{processExit:{...exitProof,treeConfirmed:false}}},{...base,result:{processExit:{...exitProof,activeProcesses:1}}},{...base,result:{processExit:{...exitProof,rootPid:0}}},{...base,result:{processExit:{...exitProof,cancelled:true}}},{...base,result:{processExit:{...exitProof},turn:{code:'EXECUTION_UNCERTAIN'}}}]) assert.throws(()=>f.repo.resultA2AAction(action.id,input),error=>['BOT_RECOVERY_BINDING_CONFLICT','BOT_RECOVERY_RECEIPT_REQUIRED'].includes(error.code));
  assert.throws(()=>f.repo.resultA2AAction(action.id,{...base,deviceId:'other-device'}),/another device/);
  const original=f.repo.db.prepare('SELECT payload_json FROM a2a_actions WHERE id=?').get(action.id).payload_json,payload=JSON.parse(original);
  payload.hermesBot.employeeId='foreign-employee';f.repo.db.prepare('UPDATE a2a_actions SET payload_json=? WHERE id=?').run(JSON.stringify(payload),action.id);
  assert.throws(()=>f.repo.resultA2AAction(action.id,base),{code:'BOT_RECOVERY_BINDING_CONFLICT'});
  f.repo.db.prepare('UPDATE a2a_actions SET payload_json=? WHERE id=?').run(original,action.id);
  assert.equal(f.repo.getA2AAction(action.id).status,'expired');assert.equal(f.repo.db.prepare('SELECT active_action_id FROM hermes_bots WHERE employee_id=?').get(f.bot.id).active_action_id,action.id);
});

test('server-stored inherited-model validation receipt can be reconciled without validating a changed control epoch',t=>{
  const f=fixture(t,{model:null,reasoning:true}),action=f.validate();f.repo.ackA2AAction(action.id,{deviceId});
  assert.equal(action.payload.hermesBot.model,null);
  const result=f.validationResult(action),event=f.repo.recordA2AEvent(action.id,{deviceId,type:'succeeded',data:{result,error:null}});
  f.expire(action.id);const paused=f.control('pause');
  const request={eventId:event.id,expectedRevision:1,expectedControlEpoch:paused.control_epoch};
  const settled=f.bots.reconcile(slug,f.bot.id,action.id,request);
  assert.equal(settled.control_state,'paused');assert.equal(settled.control_epoch,paused.control_epoch);assert.equal(settled.validation.status,'stale');assert.equal(settled.effect.validatedRevision,null);
  assert.equal(settled.reconciliation.status,'succeeded');assert.equal(settled.reconciliation.duplicate,false);
  assert.equal(f.repo.getA2AAction(action.id).result.botValidation.effective.model,'gpt-6.1-sol');
  assert.equal(f.repo.db.prepare('SELECT active_action_id FROM hermes_bots WHERE employee_id=?').get(f.bot.id).active_action_id,null);
  assert.equal(f.bots.reconcile(slug,f.bot.id,action.id,request).reconciliation.duplicate,true);
  assert.equal(f.repo.getA2AAction(action.id).events.filter(item=>item.type==='action.reconciled').length,1);
});

test('normal inherited-model reasoning uses the effective model but explicit model mismatch remains rejected',t=>{
  const inherited=fixture(t,{model:null,reasoning:true}),first=inherited.validate();inherited.repo.ackA2AAction(first.id,{deviceId});
  inherited.repo.resultA2AAction(first.id,{deviceId,status:'succeeded',result:inherited.validationResult(first)});
  assert.equal(inherited.current().validation.status,'succeeded');
  const explicit=fixture(t,{reasoning:true}),other=explicit.validate();explicit.repo.ackA2AAction(other.id,{deviceId});
  const wrong=explicit.validationResult(other,'gpt-6-sol');wrong.botValidation.effective.reasoning.mode='native';wrong.botValidation.effective.reasoning.nativeActual='max';
  assert.throws(()=>explicit.repo.resultA2AAction(other.id,{deviceId,status:'succeeded',result:wrong}),{code:'BOT_REASONING_RECEIPT_REQUIRED'});
  assert.equal(explicit.repo.getA2AAction(other.id).status,'acked');
});

test('management reconciliation accepts only a bound existing terminal event with proof and current revision/epoch',t=>{
  const f=fixture(t),action=f.conversation();
  const incomplete=f.repo.recordA2AEvent(action.id,{deviceId,type:'succeeded',data:{result:{output:'No exit proof'}}});
  const progress=f.repo.recordA2AEvent(action.id,{deviceId,type:'action.succeeded',data:{result:{processExit:{...exitProof}}}});
  f.expire(action.id);const current=f.current(),body={expectedRevision:current.revision,expectedControlEpoch:current.control_epoch};
  for(const eventId of [incomplete.id,progress.id,'missing'])assert.throws(()=>f.bots.reconcile(slug,f.bot.id,action.id,{...body,eventId}),{code:'BOT_RECOVERY_RECEIPT_REQUIRED'});
  assert.throws(()=>f.bots.reconcile(slug,f.bot.id,action.id,{...body,eventId:incomplete.id,result:{processExit:exitProof}}),{code:'BOT_RECOVERY_INPUT_INVALID'});
  assert.throws(()=>f.bots.reconcile(slug,f.bot.id,action.id,{...body,expectedRevision:99,eventId:incomplete.id}),{code:'BOT_REVISION_CONFLICT'});
  assert.throws(()=>f.bots.reconcile(slug,f.bot.id,action.id,{...body,expectedControlEpoch:99,eventId:incomplete.id}),{code:'BOT_CONTROL_CONFLICT'});
  assert.throws(()=>f.repo.reconcileBotActionFromEvent(action.id,{eventId:incomplete.id,employeeId:'foreign',workspaceSlug:slug}),{code:'BOT_RECOVERY_BINDING_CONFLICT'});
  assert.throws(()=>f.repo.reconcileBotActionFromEvent(action.id,{eventId:incomplete.id,employeeId:f.bot.id,workspaceSlug:'foreign'}),{code:'BOT_RECOVERY_BINDING_CONFLICT'});
  assert.equal(f.repo.getA2AAction(action.id).status,'expired');
});

test('reconciliation never redispatches a collaboration manifest',t=>{
  const f=fixture(t),action=f.conversation(),payload={...action.payload,collaborationManifest:{mode:'delegate',targets:[{id:'target'}]},nativeOperation:{requestId:'original',resource:'collaboration',operation:'message'}};
  f.repo.db.prepare("UPDATE a2a_actions SET type='hermes.bot.native',payload_json=? WHERE id=?").run(JSON.stringify(payload),action.id);f.expire(action.id);
  const count=f.repo.db.prepare('SELECT COUNT(*) n FROM a2a_actions').get().n;
  f.repo.dispatchBotCollaboration=()=>{throw new Error('Recovery must never dispatch collaborator work');};
  const result={processExit:{...exitProof},nativeOperation:{schemaVersion:2,resource:'collaboration',operation:'message',employeeId:f.bot.id,revision:1,status:'succeeded',data:{}}};
  const settled=f.repo.resultA2AAction(action.id,{deviceId,status:'succeeded',result});
  assert.equal(settled.status,'failed');assert.equal(settled.error,'BOT_COLLABORATION_RECOVERY_REQUIRES_REVIEW');assert.equal(settled.result.collaboration.dispatched,false);
  assert.equal(f.repo.db.prepare('SELECT COUNT(*) n FROM a2a_actions').get().n,count);
});

test('late Routine completion settles only its existing run without retries, webhooks or duplicate chat',t=>{
  const f=fixture(t),initial=f.conversation();f.repo.resultA2AAction(initial.id,{deviceId,status:'succeeded',result:{output:'Done'}});
  const routine=f.bots.createRoutine(slug,f.bot.id,{name:'Bounded routine',prompt:'Original work',schedule:'每天 09:00',timezone:'Asia/Shanghai',webhookUrl:'https://example.com/result',idempotencyKey:'routine'});
  const run=f.bots.runRoutine(slug,f.bot.id,routine.id,{idempotencyKey:'once'}),action=f.repo.getA2AAction(run.action_id);f.repo.ackA2AAction(action.id,{deviceId});
  f.repo.resultA2AAction(action.id,{deviceId,status:'failed',error:'Stop not confirmed',result:{code:'EXECUTION_UNCERTAIN',executionState:'uncertain'}});
  assert.equal(f.repo.listAutomationRuns(routine.id)[0].status,'uncertain');
  const actions=f.repo.db.prepare('SELECT COUNT(*) n FROM a2a_actions').get().n,messages=f.repo.getConversation(f.bot.main_conversation_id).messages.length,webhooks=f.repo.db.prepare('SELECT COUNT(*) n FROM webhook_deliveries').get().n;
  f.repo.completeAutomationRun=()=>{throw new Error('Reconciliation must not enter automatic completion side effects');};
  f.repo.queueAutomationRetry=()=>{throw new Error('Reconciliation must not retry');};
  f.repo.queueWebhookDelivery=()=>{throw new Error('Reconciliation must not send webhooks');};
  f.repo.resultA2AAction(action.id,{deviceId,status:'failed',error:'Original process exited',result:{processExit:{...exitProof,cancelled:true}}});
  assert.equal(f.repo.listAutomationRuns(routine.id)[0].status,'failed');
  assert.equal(f.repo.db.prepare('SELECT COUNT(*) n FROM a2a_actions').get().n,actions);assert.equal(f.repo.db.prepare('SELECT COUNT(*) n FROM webhook_deliveries').get().n,webhooks);assert.equal(f.repo.getConversation(f.bot.main_conversation_id).messages.length,messages);
});

test('reconcile HTTP routes share the existing Bot authorization guard without starting a listener',t=>{
  const app=createApp({memory:true});t.after(()=>app.locals.repo.db.close());
  for(const prefix of ['/api','/mcp/v1']){
    const control=app.router.stack.find(layer=>layer.route?.path===`${prefix}/workspaces/:slug/bots/:id/control`),reconcile=app.router.stack.find(layer=>layer.route?.path===`${prefix}/workspaces/:slug/bots/:id/actions/:actionId/reconcile`);
    assert.ok(reconcile?.route.methods.post);assert.equal(reconcile.route.stack[0].handle,control.route.stack[0].handle);
    assert.equal(reconcile.route.stack.length,control.route.stack.length);
  }
});
