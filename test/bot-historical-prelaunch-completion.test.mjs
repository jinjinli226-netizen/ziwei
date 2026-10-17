import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {isHistoricalPrelaunchCompletion} from '../src/bot-historical-prelaunch-completion.mjs';
import {HISTORICAL_PRELAUNCH_POLICY as policy,HISTORICAL_PRELAUNCH_POLICY_DIGEST as policyDigest,HISTORICAL_PRELAUNCH_RECOVERY_KIND as kind,historicalPrelaunchDigest as digest,historicalPrelaunchAdmissionProof} from '../src/bot-historical-prelaunch-policy.mjs';
import {inspectLocalDaemonMaintenanceFiles,scanNativeFiles} from '../backend/preservation-native-evidence.mjs';
import {exitedTree} from '../backend/version-preservation.mjs';
import {ActionDispatcher} from '../src/daemon.mjs';

function fixture(){
  const pin=policy.auditedSubject,identity={workspace:pin.workspace,deviceId:pin.deviceId,workspaceId:pin.workspaceId,targetDeviceId:pin.deviceId};
  const started={key:'historical-dedupe',actionId:pin.actionId,identity,startedAt:1792233448173,nativeRuntime:true,resourceBinding:{type:'conversation.execute',employeeId:pin.employeeId,revision:3,controlEpoch:5,resource:null,operation:null,platform:null},quarantine:{reason:'EXECUTOR_WITHOUT_EXIT_EVIDENCE',recordedAt:1792233450600,stopConfirmed:false}};
  const subject={...pin,actionType:'conversation.execute',dedupeKey:started.key,originalError:policy.error,ackedAt:'2026-10-17T10:37:25.701Z',originalResultDigest:digest(policy.originalResult),originalDeliveredPayloadDigest:digest('fixture-delivered-payload'),originalWireBodyDigest:digest({status:'failed',result:policy.originalResult,error:policy.error,receiptOnly:true}),failedEvent:{id:pin.failedEventId,dataSha256:pin.failedEventDataSha256,error:policy.error,resultDigest:digest(policy.originalResult),createdAt:'2026-10-17T10:37:29.414Z'}};
  const local={sourceFiles:Object.entries(policy.sourceFiles).map(([path,sha256])=>({path,sha256})),noSupervision:true,quarantineCount:1,quarantine:{actionId:started.actionId,dedupeKey:started.key,startedAt:started.startedAt,startedSha256:digest(started),stateSha256:digest('state'),deliverySha256:digest('delivery'),actionSha256:digest('action'),resultSha256:digest('result'),serverResultDigest:subject.originalWireBodyDigest}};
  const receipt={schemaVersion:1,kind,policy:policy.id,sourceBuild:policy.sourceBuild,sourcePolicyDigest:policyDigest,subject,subjectDigest:digest(subject),evidenceDigest:digest('evidence'),localEvidenceDigest:digest(local),daemonExit:{stopped:true,pid:21480,creationTime:'2026-10-17T09:00:00Z',exitedAt:'2026-10-17T13:00:00Z'},localStartedAt:started.startedAt,admissionProof:historicalPrelaunchAdmissionProof(),status:'failed',executionState:'not_started',recordedAt:'2026-10-17T13:00:01Z'};
  receipt.id=digest({actionId:started.actionId,subjectDigest:receipt.subjectDigest,evidenceDigest:receipt.evidenceDigest});
  const completed={key:started.key,identity,result:{status:'failed',actionId:started.actionId,error:policy.error,completedAt:Date.parse(receipt.recordedAt),code:'BOT_HISTORICAL_PRELAUNCH_REJECTED',result:{code:'BOT_HISTORICAL_PRELAUNCH_REJECTED',executionState:'not_started',partialEffectsPossible:true,prelaunchRecovery:receipt,prelaunchEvidence:local}}};
  return{started,completed,identity};
}

test('historical admission receipt resolves only its matching local history, never proves tree exit',()=>{
  const f=fixture();assert.equal(isHistoricalPrelaunchCompletion(f),true);assert.equal(exitedTree(f.completed.result.result.prelaunchRecovery.admissionProof),false);
  for(const mutate of [f=>f.started.identity.deviceId='other',f=>f.started.startedAt++,f=>f.started.quarantine.stopConfirmed=true,f=>f.completed.result.result.prelaunchRecovery.subject.profile='other',f=>f.completed.result.result.processExit={treeConfirmed:true},f=>f.completed.result.result.prelaunchEvidence.quarantine.startedSha256=digest('other')]){
    const copy=structuredClone(f);mutate(copy);assert.equal(isHistoricalPrelaunchCompletion(copy),false);
  }
});

test('local maintenance accepts audited history but formal tree preservation remains strict',t=>{
  const f=fixture(),runtimeDir=fs.mkdtempSync(path.join(os.tmpdir(),'historical-admission-'));t.after(()=>fs.rmSync(runtimeDir,{recursive:true,force:true}));
  fs.writeFileSync(path.join(runtimeDir,'action-state.json'),JSON.stringify({version:2,started:[f.started],completed:[f.completed]}));
  const connections=[{...f.identity,apiBase:'https://qzelynth.top',runtimeDir}];
  assert.equal(inspectLocalDaemonMaintenanceFiles({connections}).safe,true);
  assert.equal(scanNativeFiles({connections}).safe,false);
  f.completed.result.result.prelaunchRecovery.admissionProof.launched=true;
  fs.writeFileSync(path.join(runtimeDir,'action-state.json'),JSON.stringify({version:2,started:[f.started],completed:[f.completed]}));
  assert.equal(inspectLocalDaemonMaintenanceFiles({connections}).safe,false);
});


test('a restarted dispatcher accepts the repaired history and runs new work without replaying the old message',async t=>{
  const f=fixture(),directory=fs.mkdtempSync(path.join(os.tmpdir(),'historical-dispatcher-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const stateFile=path.join(directory,'action-state.json');fs.writeFileSync(stateFile,JSON.stringify({version:2,started:[f.started],completed:[f.completed]}));
  const executed=[];const dispatcher=new ActionDispatcher({stateFile,workdir:directory,workspace:f.identity.workspace,deviceId:f.identity.deviceId,execute:async action=>{executed.push(action.id);return {ok:true};}});
  assert.equal(dispatcher.quarantined,false);
  const duplicate=await dispatcher.dispatch({id:f.started.actionId,type:'conversation.execute',dedupeKey:f.started.key,workspace_id:f.identity.workspaceId,payload:{deviceId:f.identity.deviceId}});
  assert.equal(duplicate.status,'duplicate');assert.deepEqual(executed,[]);
  const fresh=await dispatcher.dispatch({id:'new-safe-verification',type:'agent.execute',payload:{prompt:'isolated harmless fixture'}});
  assert.equal(fresh.status,'succeeded');assert.deepEqual(executed,['new-safe-verification']);
});
