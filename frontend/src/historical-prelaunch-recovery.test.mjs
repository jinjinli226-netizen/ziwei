import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse,compileScript,compileTemplate} from '@vue/compiler-sfc';
import {historicalPrelaunchRecovery} from './historical-prelaunch-recovery.mjs';
import {botPresence,botStopPresentation,botRecoveryEvent,botRecoveryDetail,executionUncertain,processExitConfirmed} from './bot-presentation.js';
import {executionNeedsPolling,executionPresentation} from './conversation-execution-state.mjs';

function fixture() {
  const run={id:'original',type:'conversation.execute',status:'failed',error:'原始待核实失败',payload:{employeeId:'employee',deviceId:'device',profile:'bot-profile',hermesBot:{workspace:'workspace'}},result:{code:'EXECUTION_UNCERTAIN',executionState:'uncertain',processExit:null,partialEffectsPossible:true}};
  const receipt={schemaVersion:1,kind:'bot.historical_prelaunch_recovery',policy:'6666a63-bot-start-admission-prelaunch-v1',status:'failed',executionState:'not_started',recordedAt:'2026-10-18T00:00:00.000Z',localStartedAt:Date.parse('2026-10-17T00:00:00.000Z'),subject:{actionId:run.id,actionType:run.type,workspaceId:'workspace-id',workspace:'workspace',employeeId:'employee',deviceId:'device',profile:'bot-profile',originalError:run.error},admissionProof:{scope:'conversation-runtime-root',phase:'bot-start-admission',launched:false,partialEffectsPossible:true},daemonExit:{stopped:true,pid:123,creationTime:'2026-10-16T00:00:00.000Z',exitedAt:'2026-10-17T01:00:00.000Z'}};
  for(const key of ['id','sourceBuild','sourcePolicyDigest','subjectDigest','evidenceDigest','localEvidenceDigest'])receipt[key]='a'.repeat(64);
  return {...run,prelaunchRecovery:receipt};
}

function postUpdateFixture() {
  const run=fixture(),receipt=run.prelaunchRecovery;
  receipt.schemaVersion=2;receipt.mode='post_update_holder';receipt.policy='6666a63-post-update-holder-prelaunch-v2';
  receipt.subject.failedEvent={createdAt:'2026-10-17T00:00:01.000Z'};
  receipt.subject.maintenanceHolderBuild='6c9345a699c977dcc69f396f2aee96e7ca96e38fc7c9f686b9b49217ae09c8d9';receipt.subject.maintenanceHolderPid=456;
  delete receipt.daemonExit;
  receipt.maintenanceHolderExit={stopped:true,pid:456,creationTime:'2026-10-17T03:00:00.000Z',exitedAt:'2026-10-17T04:00:00.000Z'};
  receipt.verifiedUpdateFinishedAt='2026-10-17T02:00:00.000Z';receipt.migrationEvidenceDigest='b'.repeat(64);
  return run;
}

test('post-update holder recovery resolves the same admission block without inventing an original daemon exit',()=>{
  const run=postUpdateFixture(),before=JSON.stringify(run.result),receipt=run.prelaunchRecovery;
  assert.equal(historicalPrelaunchRecovery(run),receipt);
  assert.equal(executionUncertain(run),false);assert.equal(executionNeedsPolling(run),false);
  assert.equal(executionPresentation(run).summary,'原模型未启动 · 已恢复');
  assert.equal(executionPresentation(run).retryable,false);
  assert.equal(botStopPresentation({latest_run:run}).confirmed,false);
  assert.equal(botStopPresentation({latest_run:run}).notStarted,true);
  assert.equal(processExitConfirmed(run.result),false);
  assert.equal(Object.hasOwn(receipt,'daemonExit'),false);
  assert.equal(JSON.stringify(run.result),before);
});

test('post-update holder proof cannot weaken the original-generation time rule or substitute a process-tree claim',()=>{
  const base=postUpdateFixture(),invalid=[];
  for(const mutate of [
    r=>{r.daemonExit=r.maintenanceHolderExit;},r=>{r.originalDaemonExit=r.maintenanceHolderExit;},
    r=>{r.mode='same_generation';},r=>{r.migrationEvidenceDigest='bad';},
    r=>{r.subject.maintenanceHolderBuild='a'.repeat(64);},r=>{r.subject.maintenanceHolderPid=789;},
    r=>{r.verifiedUpdateFinishedAt='2026-10-16T00:00:00.000Z';},
    r=>{r.maintenanceHolderExit.creationTime='2026-10-17T01:00:00.000Z';},
    r=>{r.admissionProof.treeConfirmed=true;},r=>{r.processExit={launched:false,treeConfirmed:true};},
    r=>{r.schemaVersion=1;r.policy='6666a63-bot-start-admission-prelaunch-v1';r.daemonExit=r.maintenanceHolderExit;delete r.maintenanceHolderExit;delete r.mode;delete r.migrationEvidenceDigest;delete r.verifiedUpdateFinishedAt;},
  ]){const run=structuredClone(base);mutate(run.prelaunchRecovery);invalid.push(run);}
  for(const run of invalid){assert.equal(historicalPrelaunchRecovery(run),null);assert.equal(executionUncertain(run),true);assert.equal(executionNeedsPolling(run),true);}
  const old=fixture();old.prelaunchRecovery.daemonExit.creationTime='2026-10-17T03:00:00.000Z';
  assert.equal(historicalPrelaunchRecovery(old),null,'schema 1 still requires the original pre-start generation');
});

test('verified independent recovery ends uncertainty and polling while preserving the original failure',()=>{
  const run=fixture(),original=JSON.stringify(run.result),receipt=run.prelaunchRecovery;
  assert.equal(historicalPrelaunchRecovery(run),receipt);
  assert.equal(executionUncertain(run),false);
  assert.equal(executionNeedsPolling(run),false);
  assert.deepEqual(executionPresentation(run),{label:'已核实原模型调用未启动，历史阻塞已解除；原消息未重新派发。',summary:'原模型未启动 · 已恢复',busy:false,tone:'muted',retryable:false});
  assert.equal(botRecoveryEvent(run),null);
  assert.match(botRecoveryDetail(run),/模型调用未启动.*历史阻塞已解除/);
  assert.equal(JSON.stringify(run.result),original);
  assert.equal(run.error,'原始待核实失败');
});

test('historical admission is not presented as a confirmed model process-tree exit or replay',()=>{
  const run=fixture(),state=botStopPresentation({control_state:'paused',latest_run:run});
  assert.equal(state.confirmed,false);assert.equal(state.notStarted,true);
  assert.match(state.label,/原消息未重新派发/);
  assert.doesNotMatch(state.label,/进程树退出|根进程.*确认/);
  assert.equal(processExitConfirmed(run.result),false);
  assert.equal(botPresence({control_state:'paused',latest_run:run}).label,'已暂停 · 原模型未启动');
});

test('generic flags, uncommitted events and receipts for another action cannot remove the original block',()=>{
  const valid=fixture(),base={...valid};delete base.prelaunchRecovery;
  const rejected=[{...base,notStarted:true,executionState:'not_started'}, {...base,result:{...base.result,prelaunchRecovery:valid.prelaunchRecovery}}, {...base,events:[{type:'bot.historical_prelaunch_recovery',data:{receipt:valid.prelaunchRecovery}}]}];
  for(const change of [r=>{r.subject.actionId='another';},r=>{r.subject.deviceId='another';},r=>{r.subject.profile='another';},r=>{r.admissionProof.scope='all-processes';},r=>{r.admissionProof.treeConfirmed=true;},r=>{r.processExit={launched:false,treeConfirmed:true};},r=>{r.daemonExit.stopped=false;},r=>{r.sourcePolicyDigest='bad';}]){
    const run=structuredClone(valid);change(run.prelaunchRecovery);rejected.push(run);
  }
  for(const run of rejected){assert.equal(historicalPrelaunchRecovery(run),null);assert.equal(executionUncertain(run),true);assert.equal(executionNeedsPolling(run),true);assert.equal(executionPresentation(run).summary,'失败');}
});

test('chat and workbench templates compile with a separate preserved original-failure disclosure',async()=>{
  for(const filename of ['BotMainChat.vue','BotWorkbench.vue']){
    const source=await readFile(new URL(`./components/${filename}`,import.meta.url),'utf8'),{descriptor,errors}=parse(source);
    assert.deepEqual(errors,[]);
    const script=compileScript(descriptor,{id:filename}),template=compileTemplate({source:descriptor.template.content,filename,id:filename,compilerOptions:{bindingMetadata:script.bindings}});
    assert.deepEqual(template.errors,[]);
    assert.match(source,/原始失败记录（已保留）/);
  }
});
