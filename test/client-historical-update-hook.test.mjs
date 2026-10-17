import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverBeforeClientUpdateStop,describeUpdateFailure} from '../scripts/client-update.mjs';

test('update invokes recovery only from its verified candidate and retains restart intent',async()=>{
  let observed;const events=[],log=(...args)=>events.push(args);
  const result=await recoverBeforeClientUpdateStop({candidate:'/verified candidate',root:'/old-install',env:{TEST:'yes'},log,load:async url=>{
    assert.equal(url,'file:///verified%20candidate/scripts/client-historical-prelaunch-recovery.mjs');
    return{recoverHistoricalPrelaunchForUpdate:async options=>{observed=options;return{recovered:true,wasRunning:true,stopped:true,actionId:'original'};}};
  }});
  assert.deepEqual(observed,{root:'/old-install',env:{TEST:'yes'},log});
  assert.equal(result.wasRunning,true);assert.equal(result.stopped,true);
  assert.deepEqual(events,[['historical_prelaunch_recovered',{actionId:'original'}]]);
});

test('unmatched historical work uses normal stop and invalid stopped receipts are refused',async()=>{
  const run=value=>recoverBeforeClientUpdateStop({candidate:'/candidate',load:async()=>({recoverHistoricalPrelaunchForUpdate:async()=>value})});
  assert.deepEqual(await run({recovered:false,reason:'not_applicable'}),{recovered:false,reason:'not_applicable'});
  for(const value of [{recovered:true},{recovered:true,stopped:true,wasRunning:false}])await assert.rejects(run(value),{code:'HISTORICAL_PRELAUNCH_RECOVERY_REFUSED'});
});

test('recovery failure diagnostics contain a bounded reason and never raw output',()=>{
  const result=describeUpdateFailure(Object.assign(Error('PRIVATE_SECRET'),{code:'HISTORICAL_PRELAUNCH_RECOVERY_REFUSED',stderr:'PRIVATE_SECRET'}),'recover_history');
  assert.equal(result.failureStage,'recover_history');assert.equal(result.reasonCode,'HISTORICAL_PRELAUNCH_RECOVERY_REFUSED');assert.doesNotMatch(JSON.stringify(result),/PRIVATE_SECRET/);
});
