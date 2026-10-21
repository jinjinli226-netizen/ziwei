import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ActionDispatcher} from '../src/daemon.mjs';
import {FAILURE_FINALIZATION_KIND,finalizationDigest} from '../src/bot-failure-finalization-contract.mjs';

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-finalize-dispatch-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const stateFile=path.join(root,'action-state.json'),identity={workspace:'work',deviceId:'device_one',workspaceId:'ws_one',targetDeviceId:'device_one'};
  const started={key:'dedupe_one',actionId:'action_one',identity,startedAt:1,nativeRuntime:true,resourceBinding:{type:'conversation.execute',employeeId:'employee_one',revision:7,controlEpoch:25,resource:null,operation:null,platform:null},quarantine:{reason:'EXECUTOR_WITHOUT_EXIT_EVIDENCE',recordedAt:2,stopConfirmed:false}};
  const state={version:2,started:[started],completed:[]};fs.writeFileSync(stateFile,JSON.stringify(state));
  const body={schemaVersion:1,kind:FAILURE_FINALIZATION_KIND,subject:{actionId:'action_one',actionType:'conversation.execute',workspace:'work',workspaceId:'ws_one',deviceId:'device_one',employeeId:'employee_one',profile:'bot-one',dedupeKey:'dedupe_one',originalRevision:7,originalControlEpoch:25,profileBindingDigest:'a'.repeat(64),originalPayloadDigest:'b'.repeat(64),originalResultDigest:'c'.repeat(64),originalActionSha256:'d'.repeat(64),failedEvent:null},actorUserId:null,actorRole:'system',expectedRevision:7,expectedControlEpoch:25,resultingControlEpoch:26,disposition:'failed_automatically',status:'failed',executionState:'uncertain',executionConfirmedStopped:false,partialEffectsPossible:true,recordedAt:new Date().toISOString()};
  const receipt={...body,id:finalizationDigest(body)},receiptDigest=finalizationDigest(receipt);
  const completed={key:'dedupe_one',identity,result:{status:'failed',actionId:'action_one',code:'FAILURE_FINALIZED',error:'本轮已结束；原业务结果未确认，未重新执行',completedAt:Date.now(),result:{failureFinalization:{receiptId:receipt.id,receiptDigest,originalResultDigest:receipt.subject.originalResultDigest},partialEffectsPossible:true}}};
  let launches=0;
  const options={stateFile,workdir:root,workspace:'work',deviceId:'device_one',execute:async()=>{launches++;return {output:'new work'};}};
  const dispatcher=new ActionDispatcher(options),input=()=>({receipt,receiptDigest,completed,expectedStateSha256:createHash('sha256').update(fs.readFileSync(stateFile)).digest('hex')});
  const action={id:'action_one',type:'conversation.execute',workspace_id:'ws_one',dedupe_key:'dedupe_one',payload:{runtime:'Hermes',deviceId:'device_one',employeeId:'employee_one',profile:'bot-one',hermesBot:{revision:7,controlEpoch:25}}};
  return {root,stateFile,identity,state,receipt,receiptDigest,completed,dispatcher,input,action,options,launches:()=>launches};
}
test('exact failed disposition clears in-memory quarantine durably without replay or invented exit',async t=>{
  const f=fixture(t);assert.equal(f.dispatcher.quarantined,true);
  assert.deepEqual(await f.dispatcher.prepareFailureFinalization(f.receipt),{localProcessDisposition:'unobservable'});
  assert.equal(f.dispatcher.applyFailureFinalization(f.input()),true);assert.equal(f.dispatcher.quarantined,false);
  assert.equal((await f.dispatcher.dispatch(f.action)).originalStatus,'failed');assert.equal(f.launches(),0);
  const saved=JSON.parse(fs.readFileSync(f.stateFile));assert.deepEqual(saved.started,[]);assert.equal(saved.completed[0].result.result.processExit,undefined);
  const restarted=new ActionDispatcher(f.options);assert.equal(restarted.quarantined,false);assert.equal((await restarted.dispatch(f.action)).code,'FAILURE_FINALIZED');assert.equal(f.launches(),0);
  await f.dispatcher.dispatch({id:'other_work',type:'fixture',payload:{}});assert.equal(f.launches(),1);
  assert.equal(JSON.parse(fs.readFileSync(f.stateFile)).completed.some(row=>row.result.actionId==='action_one'),true);
});
test('tampered scope and stale state cannot archive another action or erase later work',async t=>{
  const f=fixture(t),before=fs.readFileSync(f.stateFile);
  const wrong={...f.receipt,subject:{...f.receipt.subject,employeeId:'other'}};delete wrong.id;wrong.id=finalizationDigest(wrong);
  await assert.rejects(f.dispatcher.prepareFailureFinalization(wrong),{code:'FAILURE_FINALIZATION_LOCAL_MISMATCH'});
  assert.equal(f.dispatcher.applyFailureFinalization({...f.input(),receipt:wrong,receiptDigest:finalizationDigest(wrong)}),false);
  const stale=f.input();fs.appendFileSync(f.stateFile,' ');assert.equal(f.dispatcher.applyFailureFinalization(stale),false);assert.equal(f.dispatcher.quarantined,true);
  assert.deepEqual(fs.readFileSync(f.stateFile),Buffer.concat([before,Buffer.from(' ')]));
});
test('a finalization tombstone cannot introduce process-exit or success claims',t=>{
  const f=fixture(t);
  for(const change of [{status:'succeeded'},{result:{...f.completed.result.result,processExit:{treeConfirmed:true}}},{code:'EXECUTION_UNCERTAIN'}])assert.equal(f.dispatcher.applyFailureFinalization({...f.input(),completed:{...f.completed,result:{...f.completed.result,...change}}}),false);
  assert.equal(f.dispatcher.quarantined,true);assert.equal(JSON.parse(fs.readFileSync(f.stateFile)).started.length,1);
});
test('failed state write restores the prior in-memory quarantine and dedupe state',t=>{
  const f=fixture(t),input=f.input(),original=fs.openSync;
  fs.openSync=(file,...args)=>{if(String(file).startsWith(f.stateFile+'.'))throw Object.assign(Error('fixture write failure'),{code:'EACCES'});return original(file,...args);};
  try{assert.throws(()=>f.dispatcher.applyFailureFinalization(input),/fixture write failure/);}finally{fs.openSync=original;}
  assert.equal(f.dispatcher.quarantined,true);assert.equal(f.dispatcher.status('action_one').completed,null);assert.deepEqual(JSON.parse(fs.readFileSync(f.stateFile)).started,f.state.started);
});
