import test from 'node:test';
import assert from 'node:assert/strict';
import {botReasoningProof} from '../src/hermes-bot-reasoning.mjs';

const context={employeeId:'employee_gateway',revision:5,model:'gpt-6.1-sol',config:{provider:'openai-codex',reasoningEffort:'max'}};
const receipt={schemaVersion:1,employeeId:context.employeeId,revision:5,provider:'openai-codex',model:context.model,requested:'max',effective:'max',actual:'max',nativeActual:'xhigh',mode:'verified_gpt61_sol_max',actualModel:context.model,status:'matched',phase:'request',evidence:'native_gateway_sdk',profile_id:'bot-fixture',session_id:'local-fixture',admission_id:'admission-fixture',execution_generation:2,authority_epoch:7,api_request_id:'a'.repeat(32)};

test('Gateway SDK receipts preserve the complete execution binding',()=>{
  assert.deepEqual(botReasoningProof({...receipt,prompt:'must not be projected',api_key:'synthetic-only'},context),receipt);
});

test('Gateway SDK proof rejects incomplete or malformed execution bindings',()=>{
  for(const key of ['profile_id','session_id','admission_id','execution_generation','authority_epoch','api_request_id']){
    const incomplete={...receipt};delete incomplete[key];
    assert.equal(botReasoningProof(incomplete,context),null,key);
  }
  for(const patch of [{execution_generation:-1},{execution_generation:1.2},{execution_generation:'2'},{api_request_id:'bad\nrequest'},{api_request_id:'not-a-physical-request-id'},{profile_id:''},{authority_epoch:null},{authority_epoch:'7'},{authority_epoch:-1},{session_id:'x'.repeat(1025)}]){
    assert.equal(botReasoningProof({...receipt,...patch},context),null,JSON.stringify(patch));
  }
});

test('Gateway preflight cannot stand in for an actual SDK request',()=>{
  for(const phase of ['preflight','conversion'])assert.equal(botReasoningProof({...receipt,phase},context),null);
  for(const patch of [{employeeId:'employee_other'},{revision:4},{actual:'xhigh'},{actualModel:'gpt-6-sol'},{provider:'custom'},{requested:'high'}])assert.equal(botReasoningProof({...receipt,...patch},context),null);
});

test('Existing process-local reasoning receipts retain their validation',()=>{
  const legacy={...receipt,evidence:'native_codex_transport',phase:'preflight'};
  for(const key of ['profile_id','session_id','admission_id','execution_generation','authority_epoch','api_request_id'])delete legacy[key];
  assert.deepEqual(botReasoningProof(legacy,context),legacy);
  assert.equal(botReasoningProof({...legacy,actual:'xhigh'},context),null);
});
