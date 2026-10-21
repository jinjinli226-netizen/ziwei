import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {legacyHealthFixture} from './helpers/finalization-legacy-health-fixture.mjs';
import {createFailedActionFinalizationRecovery} from '../src/client-failed-action-finalization-recovery.mjs';

for(const deliveryState of ['result_pending','blocked','confirmed'])test('legacy real health permits audited '+deliveryState+' background history beside an authorized failure',async t=>{
 const f=await legacyHealthFixture(t,{deliveryState}),evidence=f.inspect(),body=f.health(),before=f.historySnapshot();
 assert.equal(evidence.retainedFailedBackgroundCount,1);assert.equal(evidence.retainedDeliveryCount,1);
 assert.equal(evidence.retainedPendingCount,deliveryState==='result_pending'?1:0);
 assert.equal(body.activeActionCount,1);assert.equal(body.quarantinedActionCount,1);
 assert.equal(body.maintenance.pendingDeliveryCount,deliveryState==='result_pending'?1:0);
 assert.equal(body.maintenance.blockedDeliveryCount,deliveryState==='blocked'?1:0);
 const oldState=JSON.parse(fs.readFileSync(path.join(f.runtimeDir,'action-state.json'))),historyStart=oldState.started.find(row=>row.actionId==='audited-failed-background'),historyComplete=oldState.completed[0];
 const result=await createFailedActionFinalizationRecovery(f.deps)(f);
 assert.equal(result.finalizationsApplied,1);assert.equal(result.stopped,true);assert.equal(result.originalExecutionExitConfirmed,false);
 assert.equal(f.counts().executed,0);assert.equal(f.counts().terminated,1);assert.equal(f.counts().acknowledgements,1);
 assert.equal(f.nativeInput().pending,deliveryState==='result_pending'?1:0);assert.equal(f.nativeInput().blocked,deliveryState==='blocked'?1:0);
 assert.equal(f.nativeInput().sourcePending,f.nativeInput().pending);assert.equal(f.nativeInput().sourceBlocked,f.nativeInput().blocked);
 assert.deepEqual(f.historySnapshot(),before,'unrelated historical delivery bytes are preserved');
 const state=JSON.parse(fs.readFileSync(path.join(f.runtimeDir,'action-state.json')));
 assert.deepEqual(state.started.find(row=>row.actionId==='audited-failed-background'),historyStart);
 assert.deepEqual(state.completed.find(row=>row.key===historyComplete.key),historyComplete);
 assert.equal(historyComplete.result.result.processExit.treeConfirmed,false,'old child uncertainty remains unknown');
});

test('legacy boot identity stays pinned when its dynamic gateway count drains to zero',async t=>{
 const f=await legacyHealthFixture(t,{retainedHistory:false,initialGateway:true});
 assert.equal(f.health().lifecycle.managedAuxiliaryCount,1);
 const result=await createFailedActionFinalizationRecovery(f.deps)(f);
 assert.equal(result.stopped,true);assert.equal(f.counts().terminated,1);assert.equal(f.counts().executed,0);
});

for(const deliveryState of ['result_pending','blocked'])test('an authorized '+deliveryState+' history is counted once when the scanner also retains it',async t=>{
 const f=await legacyHealthFixture(t,{deliveryState,authorizeHistory:true});
 assert.equal(f.inspect().retainedDeliveryCount,1);assert.equal(f.health().activeActionCount,0);assert.equal(f.health().quarantinedActionCount,0);
 const result=await createFailedActionFinalizationRecovery(f.deps)(f);
 assert.equal(result.finalizationsApplied,1);assert.equal(f.counts().terminated,1);assert.equal(f.counts().executed,0);
 assert.equal(f.nativeInput().pending,deliveryState==='result_pending'?1:0);assert.equal(f.nativeInput().blocked,deliveryState==='blocked'?1:0);
});

for(const field of ['pendingDeliveryCount','blockedDeliveryCount'])test('legacy real health refuses an unaccounted '+field,async t=>{
 const f=await legacyHealthFixture(t,{retainedHistory:false}),before=fs.readFileSync(path.join(f.runtimeDir,'action-state.json'));
 f.setHealthMutator(body=>{body.maintenance[field]++;});
 await assert.rejects(createFailedActionFinalizationRecovery(f.deps)(f),error=>{
  assert.equal(error.code,'FAILURE_FINALIZATION_BUSY');assert.equal(error.recoveryRule,field==='pendingDeliveryCount'?'FF_PENDING_DELIVERIES':'FF_BLOCKED_DELIVERIES');
  assert.equal(error.recoveryPhase,'current_health');assert.equal(error.recoveryStep,'local_health');
  assert.equal(error.recoveryCounters[field==='pendingDeliveryCount'?'pending':'blocked'],1);
  assert.equal(error.recoveryCounters.expectedPending,0);assert.equal(error.recoveryCounters.expectedBlocked,0);assert.equal(error.recoveryCounters.authorized,1);return true;
 });
 assert.equal(f.counts().terminated,0);assert.equal(f.counts().draining,false);assert.equal(f.counts().executed,0);
 assert.deepEqual(fs.readFileSync(path.join(f.runtimeDir,'action-state.json')),before);
});

test('legacy real health refuses a changed boot nonce while resuming the original instance',async t=>{
 const f=await legacyHealthFixture(t,{retainedHistory:false});let reads=0;
 f.setHealthMutator(body=>{if(++reads>1)body.lifecycle.nonce='changed-boot-nonce';});
 await assert.rejects(createFailedActionFinalizationRecovery(f.deps)(f),{code:'FAILURE_FINALIZATION_BUSY',recoveryRule:'FF_BOOT_CHANGED',recoveryPhase:'current_health',recoveryStep:'local_health'});
 assert.equal(f.counts().terminated,0);assert.equal(f.counts().draining,false);
});

test('an unrelated started action blocks recovery even when the old health counts still match',async t=>{
 const f=await legacyHealthFixture(t,{retainedHistory:false}),file=path.join(f.runtimeDir,'action-state.json'),state=JSON.parse(fs.readFileSync(file));
 state.started.push({...state.started[0],key:'unrelated-key',actionId:'unrelated-action',quarantine:undefined});fs.writeFileSync(file,JSON.stringify(state));
 const before=fs.readFileSync(file);assert.equal(f.health().activeActionCount,1);
 await assert.rejects(createFailedActionFinalizationRecovery(f.deps)(f),{code:'FAILURE_FINALIZATION_BUSY',recoveryRule:'FF_UNAUTHORIZED_ACTION'});
 assert.equal(f.counts().terminated,0);assert.equal(f.counts().draining,false);assert.deepEqual(fs.readFileSync(file),before);
});

test('an unaudited historical exit never supplies an extra pending allowance',async t=>{
 const f=await legacyHealthFixture(t),file=path.join(f.runtimeDir,'action-state.json'),state=JSON.parse(fs.readFileSync(file));
 state.completed[0].result.result.processExit.rootConfirmed=false;fs.writeFileSync(file,JSON.stringify(state));
 assert.equal(f.inspect().retainedDeliveryCount,0);assert.equal(f.health().maintenance.pendingDeliveryCount,1);
 const before=fs.readFileSync(file);
 await assert.rejects(createFailedActionFinalizationRecovery(f.deps)(f),error=>{
  assert.equal(error.code,'FAILURE_FINALIZATION_BUSY');assert.equal(error.recoveryRule,'FF_PENDING_DELIVERIES');
  assert.equal(error.recoveryCounters.pending,1);assert.equal(error.recoveryCounters.expectedPending,0);return true;
 });
 assert.equal(f.counts().terminated,0);assert.equal(f.counts().draining,false);assert.deepEqual(fs.readFileSync(file),before);
});

test('a nonzero managed auxiliary count still refuses stopping after gateway drain',async t=>{
 const f=await legacyHealthFixture(t,{retainedHistory:false});
 f.setHealthMutator(body=>{body.lifecycle.managedAuxiliaryCount=1;});
 await assert.rejects(createFailedActionFinalizationRecovery(f.deps)(f),{code:'FAILURE_FINALIZATION_BUSY',recoveryRule:'FF_AUXILIARIES'});
 assert.equal(f.counts().terminated,0);assert.equal(f.counts().draining,false);
});
