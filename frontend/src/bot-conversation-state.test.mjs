import test from 'node:test';
import assert from 'node:assert/strict';
import {executionPresentation} from './conversation-execution-state.mjs';
test('uncertain Bot execution remains visibly unconfirmed instead of ordinary failed or idle',()=>{
  for(const execution of [{status:'failed',result:{code:'EXECUTION_UNCERTAIN'}},{status:'failed',result:{executionState:'uncertain'}},{status:'uncertain'}]){
    const view=executionPresentation(execution);
    assert.match(view.label,/待核实|未确认/);assert.equal(view.tone,'warning');assert.equal(view.retryable,false);
  }
});
test('ordinary known failure still permits editing a new request',()=>{
  assert.equal(executionPresentation({status:'failed',result:{code:'MODEL_ERROR'}}).retryable,true);
  assert.equal(executionPresentation({status:'expired',acked_at:'2026-10-12T01:00:00Z'}).retryable,false);
});
