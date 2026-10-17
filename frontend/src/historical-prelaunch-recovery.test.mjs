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
  for(const run of rejected){assert.equal(historicalPrelaunchRecovery(run),null);assert.equal(executionUncertain(run),true);assert.equal(executionNeedsPolling(run),true);assert.equal(executionPresentation(run).summary,'执行待核实');}
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
