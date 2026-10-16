import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {NATIVE_LONG_TASK_TIMEOUT_MS} from '../src/action-execution-budget.mjs';

test('native Kanban create and prepare receive the shared 24-hour budget and original claim reserve',t=>{
  let python;
  for(const command of ['python3','python']){
    const probe=spawnSync(command,['-I','-B','-c','import sys;print(sys.executable)'],{encoding:'utf8',windowsHide:true,timeout:5000});
    if(probe.status===0&&path.isAbsolute(probe.stdout.trim())){python=probe.stdout.trim();break;}
  }
  if(!python){t.skip('Python is required for the isolated native Kanban fixture');return;}
  const runBudgetSeconds=NATIVE_LONG_TASK_TIMEOUT_MS/1000;
  const context={employeeId:'budget-fixture',runBudgetSeconds,config:{maxTurns:40,drivers:{maxTotalTurns:100}}};
  const result=spawnSync(python,['-I','-B',path.resolve(import.meta.dirname,'fixtures/hermes-native-long-budget.py'),path.resolve(import.meta.dirname,'../src/hermes-native-bridge.py')],{input:JSON.stringify(context),encoding:'utf8',windowsHide:true,timeout:10000});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  const proof=JSON.parse(result.stdout);assert.equal(runBudgetSeconds,86400);
  assert.equal(proof.create.max_runtime_seconds,86400);assert.equal(proof.create.goal_max_turns,40);assert.equal(proof.create.max_retries,0);assert.equal(proof.create.idempotency_key,'original-create');
  assert.equal(proof.claim.ttl_seconds,86460);assert.equal(proof.claim.claimer,context.employeeId);assert.equal(proof.claim.taskId,'original-task');
  assert.equal(proof.prepared.run,true);assert.equal(proof.prepared.task.id,proof.created.task.id);assert.equal(proof.prepared.prompt,'Original native worker context');assert.equal(proof.closedConnections,2);
});
