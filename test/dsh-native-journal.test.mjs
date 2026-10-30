import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const module=await import('../src/dsh-native-journal.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
const subject={workspace:'test',workspaceId:'ws',employeeId:'employee',deviceId:'pc',runtime:'DSH',profile:'alpha'};
const action=()=>({id:'routine-create',type:'employee.dsh.operation',payload:{workspace:'test',workspaceId:'ws',deviceId:'pc',dshOperation:{schemaVersion:1,subject,scope:{kind:'bot'},resource:'routines',operation:'create',input:{title:'not-persisted-before-execution',prompt:'private-request-body',enabled:true,intervalMinutes:60}}}});
const outcome=(status='applied')=>({schemaVersion:1,subject,scope:{kind:'bot'},source:'dsh-native',checkedAt:'2026-10-30T10:00:00.000Z',resource:'routines',operation:'create',status,data:{item:{id:'r-native'}}});
function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-mutation-journal-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const create=()=>{assert.equal(typeof module.createDshNativeMutationJournal,'function');return module.createDshNativeMutationJournal({directory});};
 const record=()=>JSON.parse(fs.readFileSync(path.join(directory,fs.readdirSync(directory).find(file=>file.endsWith('.json'))),'utf8'));
 return{directory,create,record};
}
test('a durable intent precedes native mutation and contains a binding digest instead of request contents',async t=>{
 const f=fixture(t),journal=f.create();
 const result=await journal.run(action(),async original=>{
  assert.equal(original.id,'routine-create');assert.equal(f.record().phase,'prepared');assert.match(f.record().binding,/^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(f.record()),/private-request-body|not-persisted-before-execution|input|envelope/);return outcome();
 });
 assert.deepEqual(result,outcome());assert.equal(f.record().phase,'settled');assert.deepEqual(f.record().result,outcome());
});
test('a settled native outcome survives manager restart and is returned without repeating mutation',async t=>{
 const f=fixture(t);let executed=0;await f.create().run(action(),async()=>{executed++;return outcome();});
 assert.deepEqual(await f.create().run(action(),async()=>assert.fail('duplicate mutation')),outcome());assert.equal(executed,1);
});
test('an original prepared action after an interrupted execution returns a complete unknown receipt and never replays',async t=>{
 const f=fixture(t);let executed=0;
 const first=await f.create().run(action(),async()=>{executed++;throw Error('private transport failure');});
 assert.equal(first.status,'unknown');assert.equal(f.record().phase,'prepared');assert.equal(f.record().result,undefined);
 const recovered=await f.create().run(action(),async()=>assert.fail('uncertain mutation must not replay'));
 assert.equal(recovered.schemaVersion,1);assert.deepEqual(recovered.subject,subject);assert.deepEqual(recovered.scope,{kind:'bot'});assert.equal(recovered.source,'dsh-native');
 assert.equal(recovered.resource,'routines');assert.equal(recovered.operation,'create');assert.equal(recovered.status,'unknown');assert.equal(recovered.reasonCode,'DSH_NATIVE_OUTCOME_UNKNOWN');
 assert.equal(recovered.data.error.code,'DSH_NATIVE_OUTCOME_UNKNOWN');assert.equal(executed,1);assert.doesNotMatch(JSON.stringify({recovered,record:f.record()}),/private transport failure/);
});
test('changed subject scope or input cannot reuse an earlier action journal',async t=>{
 const f=fixture(t);await f.create().run(action(),async()=>outcome());
 for(const altered of [
  {...action(),payload:{...action().payload,dshOperation:{...action().payload.dshOperation,subject:{...subject,profile:'beta'}}}},
  {...action(),payload:{...action().payload,dshOperation:{...action().payload.dshOperation,scope:{kind:'conversation',conversationId:'c',nativeSessionId:'s'}}}},
  {...action(),payload:{...action().payload,dshOperation:{...action().payload.dshOperation,input:{...action().payload.dshOperation.input,enabled:false}}}},
 ])await assert.rejects(f.create().run(altered,async()=>assert.fail('retargeted mutation')),{code:'DSH_NATIVE_JOURNAL_BINDING_CHANGED'});
});
test('canonical object key ordering preserves the original action identity',async t=>{
 const f=fixture(t);await f.create().run(action(),async()=>outcome());
 const original=action(),reordered={...original,payload:{...original.payload,dshOperation:{...original.payload.dshOperation,input:Object.fromEntries(Object.entries(original.payload.dshOperation.input).reverse())}}};
 assert.deepEqual(await f.create().run(reordered,async()=>assert.fail('same input must stay duplicate')),outcome());
});
test('concurrent delivery within one daemon shares the original mutation promise',async t=>{
 const f=fixture(t),journal=f.create();let finish,started,executions=0;const ready=new Promise(resolve=>{started=resolve;});
 const first=journal.run(action(),async()=>{executions++;started();return new Promise(resolve=>{finish=resolve;});});await ready;
 const second=journal.run(action(),async()=>assert.fail('concurrent mutation'));finish(outcome());
 assert.deepEqual(await Promise.all([first,second]),[outcome(),outcome()]);assert.equal(executions,1);
});
test('failure to persist intent prevents execution and result write failure cannot report success',async t=>{
 const f=fixture(t),file=path.join(f.directory,'blocked');fs.writeFileSync(file,'fixture');let executions=0;
 const blocked=module.createDshNativeMutationJournal({directory:file});await assert.rejects(blocked.run(action(),async()=>{executions++;return outcome();}));assert.equal(executions,0);
 const journal=f.create();await assert.rejects(journal.run(action(),async()=>{fs.rmSync(f.directory,{recursive:true,force:true});fs.writeFileSync(f.directory,'disk unavailable');return outcome();}));
});
test('an explicitly unknown native result is itself durable and never triggers an automatic retry',async t=>{
 const f=fixture(t),unknown=outcome('unknown');await f.create().run(action(),async()=>unknown);
 assert.deepEqual(await f.create().run(action(),async()=>assert.fail('unknown must not replay')),unknown);assert.equal(f.record().phase,'settled');
});
