import test from 'node:test';
import assert from 'node:assert/strict';
import {operatorForceAbandonRecovery,OPERATOR_FORCE_ABANDON_DETAIL} from './operator-force-abandon-recovery.mjs';
import {botPresence,botStopPresentation,botRecoveryEvent,botRecoveryDetail,executionUncertain,processExitConfirmed} from './bot-presentation.js';
import {executionNeedsPolling,executionPresentation,mergeConversationDetail} from './conversation-execution-state.mjs';
import {BOT_FORCE_ABANDON_POLICY_DIGEST,forceAbandonDigest,validateForceAbandonReceipt} from '../../src/bot-force-abandon-contract.mjs';

function fixture() {
  const binding={mode:'owned_profile',profile:'bot-e1bf33c85b1543b18ecd3d6a',templateProfile:'default',ownershipId:'187b5fff-7df9-4ca8-87d3-980c0855e3c1',provisionActionId:'action_4f59d06e-207d-4f17-aff8-d739ba138a3b'};
  const subject={schemaVersion:1,actionId:'action_2805b4da-c082-49a2-b0f1-b43bdeb107fe',actionType:'conversation.execute',workspace:'bigtron',workspaceId:'ws_52fa81da-ddeb-439a-9a74-ab4df4b2636e',deviceId:'device_bfd9a3d2-c2cc-4a36-8bd8-465bea492493',employeeId:'employee_5f157a51-a8fa-483c-90df-53d44292b5d2',credentialId:'credential',profile:binding.profile,profileBinding:binding,profileBindingDigest:'a'.repeat(64),dedupeKey:'conversation:original-message',createdAt:'2026-10-17T10:37:20.955Z',ackedAt:'2026-10-17T10:37:25.701Z',completedAt:'2026-10-17T10:37:30.568Z',originalRevision:3,originalControlEpoch:5,currentRevision:3,currentControlEpoch:8,currentControlState:'paused',currentEmployeeStatus:'paused',originalActionSha256:'b'.repeat(64),originalPayloadSha256:'e09ffebdb7d2e775fc3a3712159d2076c26319977b8596f05f22c816c6848448',originalDeliveredPayloadDigest:'c'.repeat(64),originalResultSha256:'cd625b824e89339e813ee4c8f9b43e9101076b6af6585d4ed48ab5270f6a372f',originalResultDigest:'d'.repeat(64),originalError:'执行状态无法安全确认，需人工核实后处理：Bot 配置或控制状态已变化，请重新读取',failedEvent:{id:'action-event_6c9a3e9aebb7d93cae4358455b7558c393d36d845877dade1ae62ea2d686e6b3',type:'failed',createdAt:'2026-10-17T10:37:29.414Z',dataSha256:'bec062593118dae53cfea8df2b533e59e5e6542d68e7e7fef33c37903fb3d857'},grantId:'force-abandon-grant',grantDigest:'e'.repeat(64),holderBuild:'c477b6bb9044ae181d97efaae9ee3188a985cc32805f5a8eedfe3df09660e341',holder:{pid:27868,creationTime:'2026-10-17T15:00:00.000Z',nonce:'f'.repeat(48),root:'C:\\npm\\node_modules\\ziwei',configSha256:'1'.repeat(64),stateSha256:'2'.repeat(64)}};
  const result={processExit:null,partialEffectsPossible:true,code:'EXECUTION_UNCERTAIN',executionState:'uncertain',reason:'EXECUTOR_WITHOUT_EXIT_EVIDENCE'};
  const run={id:subject.actionId,agent_id:'ziwei_user',type:subject.actionType,status:'failed',dedupe_key:subject.dedupeKey,created_at:subject.createdAt,acked_at:subject.ackedAt,completed_at:subject.completedAt,error:subject.originalError,result,payload:{runtime:'Hermes',employeeId:subject.employeeId,deviceId:subject.deviceId,profile:subject.profile,hermesBot:{employeeId:subject.employeeId,workspace:subject.workspace,deviceId:subject.deviceId,sourceProfile:subject.profile,revision:3,controlEpoch:5,instance:binding}}};
  run.forceAbandonRecovery={schemaVersion:1,kind:'bot.operator_force_abandon',id:'3'.repeat(64),policy:'zhiwei-operator-force-abandon-v1',policyDigest:'4'.repeat(64),subject,subjectDigest:'5'.repeat(64),grantId:subject.grantId,grantDigest:subject.grantDigest,evidenceDigest:'6'.repeat(64),localArchiveDigest:'7'.repeat(64),currentDaemonExit:{scope:'daemon-root-only',stopped:true,pid:subject.holder.pid,creationTime:subject.holder.creationTime,exitedAt:'2026-10-17T15:05:00.000Z'},resultingControlEpoch:9,executionState:'uncertain',disposition:'abandoned_by_user',executionConfirmedStopped:false,partialEffectsPossible:true,recordedAt:'2026-10-17T15:05:01.000Z'};
  subject.originalResultDigest=forceAbandonDigest(result);subject.profileBindingDigest=forceAbandonDigest(binding);
  const receipt=run.forceAbandonRecovery;receipt.policyDigest=BOT_FORCE_ABANDON_POLICY_DIGEST;receipt.subjectDigest=forceAbandonDigest(subject);receipt.id=forceAbandonDigest({actionId:run.id,subjectDigest:receipt.subjectDigest,evidenceDigest:receipt.evidenceDigest});
  return run;
}

test('a committed owner abandonment removes the admission prompt while retaining the original unknown failure',()=>{
  const run=fixture(),original=JSON.stringify({result:run.result,error:run.error}),receipt=run.forceAbandonRecovery;
  run.events=[{id:'other-proof',type:'succeeded',data:{result:{processExit:{rootConfirmed:true,treeConfirmed:true,activeProcesses:0}}}}];
  assert.equal(validateForceAbandonReceipt(receipt,{actionId:run.id}),true,'the actual shared server/client receipt contract accepts the same receipt');
  assert.equal(operatorForceAbandonRecovery(run),receipt);
  assert.equal(executionUncertain(run),false);assert.equal(executionNeedsPolling(run),false);
  assert.deepEqual(executionPresentation(run),{label:OPERATOR_FORCE_ABANDON_DETAIL,summary:'已强制放弃 · 原结果未知',busy:false,tone:'muted',retryable:false});
  assert.equal(botRecoveryEvent(run),null);assert.equal(botRecoveryDetail(run),OPERATOR_FORCE_ABANDON_DETAIL);
  assert.deepEqual(botStopPresentation({latest_run:run}),{confirmed:false,abandoned:true,label:OPERATOR_FORCE_ABANDON_DETAIL,tone:'muted'});
  assert.equal(processExitConfirmed(run.result),false);assert.equal(run.result.executionState,'uncertain');
  assert.equal(JSON.stringify({result:run.result,error:run.error}),original);
  assert.doesNotMatch(executionPresentation(run).label,/未启动|已停止|已完成|成功|继续核实/);
});

test('paused Bot presence discloses abandonment without turning the old execution into stopped or successful work',()=>{
  const run=fixture();
  assert.deepEqual(botPresence({control_state:'paused',latest_run:run}),{label:'已暂停 · 旧记录已放弃',tone:'muted',detail:OPERATOR_FORCE_ABANDON_DETAIL});
  assert.equal(botPresence({control_state:'active',latest_run:run}).label,'旧记录已放弃');
  assert.equal(botStopPresentation({latest_run:run}).notStarted,undefined);
  assert.equal(botStopPresentation({latest_run:run}).ended,undefined);
});

test('result flags and event bodies cannot stand in for independently projected abandonment metadata',()=>{
  const original=fixture(),base=structuredClone(original);delete base.forceAbandonRecovery;
  for(const run of [base,{...base,abandoned:true,disposition:'abandoned_by_user'},{...base,result:{...base.result,forceAbandonRecovery:original.forceAbandonRecovery}},{...base,events:[{type:'bot.operator_force_abandon',data:{receipt:original.forceAbandonRecovery}}]}]){
    assert.equal(operatorForceAbandonRecovery(run),null);assert.equal(executionUncertain(run),true);assert.equal(executionNeedsPolling(run),true);
    assert.equal(executionPresentation(run).summary,'执行待核实');assert.equal(executionPresentation(run).retryable,false);
  }
});

test('another action, altered raw failure, wrong binding or a process-tree claim keeps the original uncertainty fenced',()=>{
  const mutations=[
    r=>{r.id='another';},r=>{r.agent_id='another';},r=>{r.type='hermes.bot.native';},r=>{r.status='succeeded';},r=>{r.dedupe_key='another';},r=>{r.acked_at='2026-10-17T10:37:26.000Z';},r=>{r.error='changed';},r=>{r.result.reason='another';},
    r=>{r.payload.employeeId='another';},r=>{r.payload.deviceId='another';},r=>{r.payload.profile='another';},r=>{r.payload.hermesBot.workspace='another';},r=>{r.payload.hermesBot.instance={...r.payload.hermesBot.instance,ownershipId:'another'};},
    r=>{r.forceAbandonRecovery.subject.workspace='another';},r=>{r.forceAbandonRecovery.subject.originalPayloadSha256='8'.repeat(64);},r=>{r.forceAbandonRecovery.subject.originalResultSha256='8'.repeat(64);},r=>{r.forceAbandonRecovery.subject.failedEvent.dataSha256='8'.repeat(64);},r=>{r.forceAbandonRecovery.subject.holderBuild='8'.repeat(64);},
    r=>{r.forceAbandonRecovery.grantId='another';},r=>{r.forceAbandonRecovery.grantDigest='8'.repeat(64);},r=>{r.forceAbandonRecovery.resultingControlEpoch=8;},r=>{r.forceAbandonRecovery.executionState='not_started';},r=>{r.forceAbandonRecovery.executionConfirmedStopped=true;},r=>{r.forceAbandonRecovery.partialEffectsPossible=false;},r=>{r.forceAbandonRecovery.disposition='recovered';},r=>{r.forceAbandonRecovery.subject.originalDaemonExit={stopped:true};},
    r=>{r.forceAbandonRecovery.currentDaemonExit.pid++;},r=>{r.forceAbandonRecovery.currentDaemonExit.scope='process-tree';},r=>{r.forceAbandonRecovery.currentDaemonExit.treeConfirmed=true;},r=>{r.forceAbandonRecovery.currentDaemonExit.exitedAt='2026-10-17T16:00:00.000Z';},r=>{r.forceAbandonRecovery.processExit={treeConfirmed:true};},r=>{r.forceAbandonRecovery.policyDigest='bad';},r=>{r.forceAbandonRecovery.policyDigest='8'.repeat(64);},r=>{r.forceAbandonRecovery.subject.originalResultDigest='8'.repeat(64);},
  ];
  for(const mutate of mutations){const run=fixture();mutate(run);assert.equal(operatorForceAbandonRecovery(run),null,mutate.toString());if(run.status==='failed'){assert.equal(executionUncertain(run),true);assert.equal(executionNeedsPolling(run),true);assert.equal(executionPresentation(run).retryable,false);}}
});

test('a later execution has its own status and does not inherit the abandoned action metadata',()=>{
  const abandoned=fixture(),next={id:'new-action',status:'acked',created_at:'2026-10-17T16:00:00.000Z'};
  const detail=mergeConversationDetail({id:'conversation',execution:abandoned},{id:'conversation',execution:next});
  assert.equal(detail.execution,next);assert.equal(operatorForceAbandonRecovery(next),null);assert.equal(executionNeedsPolling(next),true);assert.equal(executionPresentation(next).busy,true);
});
