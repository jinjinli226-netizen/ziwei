import test from 'node:test';
import assert from 'node:assert/strict';
import {createRepository} from './repository.mjs';
import {createConversationStop} from './conversation-stop.mjs';

function fixture(t){
 const repo=createRepository({memory:true});t.after(()=>repo.db.close());
 repo.heartbeatDevice('test-111',{deviceId:'stop-pc',runtimes:{DSH:{status:'available',profiles:[{name:'stop-bot'}]}}});
 const employee=repo.createEmployee('test-111',{name:'Stop DSH',runtime:'DSH',runtimeProfile:'stop-bot',targetDeviceId:'stop-pc'});
 const conversation=repo.createConversation('test-111',{employeeId:employee.id});
 const source=repo.addConversationMessage(conversation.id,{content:'original turn'}).execution;
 const stop=createConversationStop(repo);
 return{repo,employee,conversation,source,stop};
}
test('DSH conversation stop targets the original action once and leaves its terminal evidence unchanged',t=>{
 const f=fixture(t);f.repo.ackA2AAction(f.source.id,{deviceId:'stop-pc'});
 const queued=f.repo.addConversationMessage(f.conversation.id,{content:'next queued turn'}).execution;
 const first=f.stop(f.conversation.id,{expectedActionId:f.source.id});
 assert.equal(first.stopConfirmed,false);assert.equal(first.stopRequested,true);
 assert.equal(f.stop(f.conversation.id,{expectedActionId:f.source.id}).action.id,first.action.id);
 const cancel=f.repo.getA2AAction(first.action.id);
 assert.equal(cancel.type,'action.cancel');assert.deepEqual(cancel.payload,{actionId:f.source.id,deviceId:'stop-pc'});
 assert.equal(f.repo.getA2AAction(f.source.id).status,'acked');assert.equal(f.repo.getA2AAction(queued.id).status,'pending');
 assert.equal(f.repo.getConversation(f.conversation.id).queue.count,1);
});
test('DSH stop rejects queued, different conversation, changed Bot and scoped device mismatch',t=>{
 const f=fixture(t);
 assert.throws(()=>f.stop(f.conversation.id,{expectedActionId:f.source.id}),{code:'CONVERSATION_STOP_NOT_RUNNING'});
 f.repo.ackA2AAction(f.source.id,{deviceId:'stop-pc'});
 const other=f.repo.createConversation('test-111',{employeeId:f.employee.id});
 assert.throws(()=>f.stop(other.id,{expectedActionId:f.source.id}),{code:'CONVERSATION_STOP_ACTION_MISMATCH'});
 assert.throws(()=>f.stop(f.conversation.id,{expectedActionId:f.source.id},{deviceScope:'other-pc'}),{code:'DEVICE_SCOPE_MISMATCH'});
 f.repo.db.prepare('UPDATE employees SET runtime_profile=? WHERE id=?').run('other-bot',f.employee.id);
 assert.throws(()=>f.stop(f.conversation.id,{expectedActionId:f.source.id}),{code:'CONVERSATION_STOP_BINDING_CHANGED'});
});
