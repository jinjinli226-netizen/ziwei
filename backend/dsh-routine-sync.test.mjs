import test from 'node:test';
import assert from 'node:assert/strict';
import {createRepository} from './repository.mjs';
import {createManagementService} from './management.mjs';
import {createDshNativeService} from './dsh-native-operations.mjs';
import {createDshRoutineSync} from './dsh-routine-sync.mjs';
import {DSH_NATIVE_FEATURE,DSH_NATIVE_TYPE} from '../src/dsh-native-contract.mjs';

const SLUG='test-111',INTERVAL=30000;
function fixture(t,{profiles=['alpha'],feature=true}={}){
 const repo=createRepository({memory:true}),db=repo.db,ws=repo.getWorkspace(SLUG),owner='routine-owner',deviceId='routine-sync-pc';
 let clock=Date.now();t.after(()=>db.close());
 db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run('routine-member',ws.id,owner,'Routine owner','routine@fixture.invalid','owner',new Date(clock).toISOString());
 repo.heartbeatDevice(SLUG,{deviceId,ownerUserId:owner,runtimeDiscovery:{features:feature?[DSH_NATIVE_FEATURE]:[]},runtimes:{DSH:{status:'available',profiles:profiles.map(name=>({name}))}}});
 const employees=profiles.map(profile=>repo.createEmployee(SLUG,{name:profile,runtime:'DSH',runtimeProfile:profile,targetDeviceId:deviceId,ownerUserId:owner}));
 const conversations=employees.map(employee=>repo.createConversation(SLUG,{employeeId:employee.id,title:`${employee.name} ordinary chat`}));
 const nativeService=createDshNativeService(repo,{management:createManagementService(repo),now:()=>clock});
 const createSync=()=>createDshRoutineSync(repo,{nativeService,now:()=>clock,pollIntervalMs:INTERVAL});
 const actions=()=>db.prepare('SELECT * FROM a2a_actions ORDER BY rowid').all().map(row=>({...row,payload:JSON.parse(row.payload_json)}));
 const matching=(resource,operation)=>actions().filter(row=>row.type===DSH_NATIVE_TYPE&&row.payload.dshOperation.resource===resource&&row.payload.dshOperation.operation===operation);
 const pending=(resource,operation)=>matching(resource,operation).filter(row=>['pending','acked'].includes(row.status));
 function complete(row,data,{status='succeeded',application='observed'}={}){
  const op=row.payload.dshOperation;
  if(row.status==='pending')repo.ackA2AAction(row.id,{deviceId});
  const dshNative={schemaVersion:1,source:'dsh-native',subject:op.subject,scope:op.scope,resource:op.resource,operation:op.operation,checkedAt:new Date(clock).toISOString(),status:application,data,observations:{[op.resource]:{status:application,data}}};
  const result=repo.resultA2AAction(row.id,{deviceId,status,...(status==='failed'?{error:'DSH_NATIVE_SESSION_READ_FAILED'}:{}),result:{dshNative}});
  db.prepare('UPDATE a2a_actions SET completed_at=? WHERE id=?').run(new Date(clock).toISOString(),row.id);
  return result;
 }
 function settleLists(itemsByEmployee){
  for(const row of pending('routines','list'))complete(row,{sourceOperation:'list',items:itemsByEmployee[row.payload.dshOperation.subject.employeeId]||[]});
 }
 async function histories(sync,itemsByEmployee){
  for(let pass=0;pass<3;pass++){
   await sync.tick();settleLists(itemsByEmployee);
   if(pending('sessions','history').length)return pending('sessions','history');
  }
  return pending('sessions','history');
 }
 const advance=(milliseconds=INTERVAL+1)=>{clock+=milliseconds;db.prepare('UPDATE devices SET last_seen=? WHERE id=?').run(new Date(clock).toISOString(),deviceId);};
 const messages=index=>repo.getConversation(conversations[index||0].id).messages;
 return{repo,db,ws,owner,deviceId,employees,conversations,createSync,actions,matching,pending,complete,settleLists,histories,advance,messages};
}
const routine=(id,sessionId=`${id}-session`,attemptId=`${id}-attempt`)=>({id,title:id,prompt:'Produce the requested result',enabled:true,intervalMinutes:1,running:false,lastStatus:'submitted',lastSessionId:sessionId,lastAttemptId:attemptId});
const event=(seq,type,data)=>({type:'event',seq,event:{seq,type,data}});
const snapshot=(text='Routine final result',turn=1)=>({snapshot:{type:'snapshot',records:[event(1,'turn/start',{turn}),event(2,'assistant/message',{turn,step:0,message:{content:[{type:'text',text}]}}),event(3,'turn/end',{turn,reason:{kind:'completed'}})]}});

test('background sync discovers every DSH employee and only submits native reads',async t=>{
 const f=fixture(t,{profiles:['alpha','beta']}),sync=f.createSync();
 await sync.tick();
 assert.deepEqual(new Set(f.matching('routines','list').map(row=>row.payload.dshOperation.subject.employeeId)),new Set(f.employees.map(employee=>employee.id)));
 assert.ok(f.actions().every(row=>row.type===DSH_NATIVE_TYPE&&row.payload.dshOperation.resource==='routines'&&row.payload.dshOperation.operation==='list'));
 assert.equal(f.db.prepare('SELECT count(*) n FROM automations').get().n,0);
 const items=Object.fromEntries(f.employees.map((employee,index)=>[employee.id,[routine(`routine-${index}`)]]));
 f.settleLists(items);await f.histories(sync,items);
 assert.deepEqual(new Set(f.matching('sessions','history').map(row=>row.payload.dshOperation.subject.employeeId)),new Set(f.employees.map(employee=>employee.id)));
 assert.ok(f.actions().every(row=>row.type===DSH_NATIVE_TYPE&&['routines.list','sessions.history'].includes(`${row.payload.dshOperation.resource}.${row.payload.dshOperation.operation}`)));
});

test('pending list and history requests survive repeated ticks and collector restart without duplicate actions',async t=>{
 const f=fixture(t);let sync=f.createSync();
 await sync.tick();const firstCount=f.actions().length;assert.equal(firstCount,1);
 await sync.tick();sync=f.createSync();await sync.tick();assert.equal(f.actions().length,firstCount);
 const items={[f.employees[0].id]:[routine('one')]};f.settleLists(items);await f.histories(sync,items);
 assert.equal(f.matching('sessions','history').length,1);
 const historyCount=f.matching('sessions','history').length;sync=f.createSync();await sync.tick();await sync.tick();
 assert.equal(f.matching('sessions','history').length,historyCount);
});

test('one delivered routine does not prevent later routines for the same employee from being collected',async t=>{
 const f=fixture(t),sync=f.createSync(),items={[f.employees[0].id]:[routine('first'),routine('second')]};
 const first=await f.histories(sync,items);assert.ok(first.length>=1);
 for(const row of first)f.complete(row,snapshot(row.payload.dshOperation.input.routineId));
 f.advance();const next=await f.histories(sync,items);
 for(const row of next)f.complete(row,snapshot(row.payload.dshOperation.input.routineId));
 assert.deepEqual(new Set(f.matching('sessions','history').map(row=>row.payload.dshOperation.input.routineId)),new Set(['first','second']));
 assert.deepEqual(new Set(f.messages().map(message=>message.content)),new Set(['first','second']));
});

test('a real terminal chat delivery persists across collector restart and later list polls',async t=>{
 const f=fixture(t),items={[f.employees[0].id]:[routine('delivered')]};let sync=f.createSync();
 const [history]=await f.histories(sync,items);assert.ok(history);f.complete(history,snapshot('Persistent result'));
 assert.equal(f.messages().length,1);
 assert.equal(f.db.prepare("SELECT count(*) n FROM management_requests WHERE kind='dsh-routine-result-v1'").get().n,1);
 sync=f.createSync();f.advance();await f.histories(sync,items);f.advance();await f.histories(sync,items);
 assert.equal(f.matching('sessions','history').length,1);assert.equal(f.messages().length,1);
});

for(const outcome of ['failed','empty','partial'])test(`${outcome} history is not acknowledged as delivered and remains eligible for retry`,async t=>{
 const f=fixture(t),sync=f.createSync(),items={[f.employees[0].id]:[routine('retry')]},[first]=await f.histories(sync,items);assert.ok(first);
 const data=outcome==='partial'?{snapshot:{type:'snapshot',records:[event(1,'turn/start',{turn:1}),event(2,'assistant/message',{turn:1,step:0,message:{content:[{type:'text',text:'Still running'}]}})]}}:{snapshot:{type:'snapshot',records:[]}};
 f.complete(first,data,outcome==='failed'?{status:'failed',application:'failed'}:{});
 assert.equal(f.messages().length,0);assert.equal(f.db.prepare("SELECT count(*) n FROM management_requests WHERE kind='dsh-routine-result-v1'").get().n,0);
 f.advance();const retry=await f.histories(sync,items);assert.ok(retry.some(row=>row.id!==first.id));
 f.complete(retry[0],snapshot('Completed after retry'));assert.equal(f.messages().at(-1).content,'Completed after retry');
});

test('a later attempt of the same routine is collected after an earlier attempt was delivered',async t=>{
 const f=fixture(t),sync=f.createSync(),items={[f.employees[0].id]:[routine('repeat','session-one','attempt-one')]},[first]=await f.histories(sync,items);assert.ok(first);
 assert.equal(first.payload.dshOperation.input.attemptId,'attempt-one');f.complete(first,snapshot('First attempt'));
 items[f.employees[0].id]=[routine('repeat','session-two','attempt-two')];f.advance();
 const retry=await f.histories(sync,items),second=retry.find(row=>row.payload.dshOperation.input.sessionId==='session-two');assert.ok(second);
 assert.equal(second.payload.dshOperation.input.attemptId,'attempt-two');f.complete(second,snapshot('Second attempt'));
 assert.deepEqual(f.messages().map(message=>message.content),['First attempt','Second attempt']);
});

test('native attempt history is recovered after downtime without replaying the native schedule',async t=>{
 const f=fixture(t),sync=f.createSync(),item=routine('catch-up','latest-session','latest-attempt');
 item.history=[{attemptId:'older-attempt',sessionId:'older-session',status:'completed'},{attemptId:'latest-attempt',sessionId:'latest-session',status:'submitted'}];
 const items={[f.employees[0].id]:[item]};
 for(let pass=0;pass<2;pass++){
  const pending=await f.histories(sync,items);assert.ok(pending.length);
  for(const row of pending)f.complete(row,snapshot(row.payload.dshOperation.input.attemptId));
  f.advance();
 }
 assert.deepEqual(new Set(f.messages().map(message=>message.content)),new Set(['older-attempt','latest-attempt']));
 assert.equal(f.matching('sessions','history').length,2);assert.equal(f.db.prepare('SELECT count(*) n FROM automations').get().n,0);
});

test('an empty early routine cannot starve a later unread routine',async t=>{
 const f=fixture(t),sync=f.createSync(),items={[f.employees[0].id]:[routine('always-empty'),routine('ready')]};
 const [empty]=await f.histories(sync,items);assert.equal(empty.payload.dshOperation.input.routineId,'always-empty');
 f.complete(empty,{snapshot:{type:'snapshot',records:[]}});f.advance();
 const later=await f.histories(sync,items),ready=later.find(row=>row.payload.dshOperation.input.routineId==='ready');
 assert.ok(ready,'the unread second routine must be read before retrying the empty first routine');
 f.complete(ready,snapshot('Second routine delivered'));assert.equal(f.messages().at(-1).content,'Second routine delivered');
});

for(const [reason,status,label] of [['failed','failed',/例行工作执行失败/],['aborted','interrupted',/例行工作已中断/]])test(`a terminal ${reason} native routine reports its original outcome in the employee chat`,async t=>{
 const f=fixture(t),sync=f.createSync(),item={...routine('terminal-outcome'),lastStatus:status},items={[f.employees[0].id]:[item]};
 const [history]=await f.histories(sync,items);assert.ok(history);
 f.complete(history,{snapshot:{type:'snapshot',records:[event(1,'turn/start',{turn:1}),event(2,'assistant/message',{turn:1,step:0,message:{content:[{type:'text',text:'Original attempt detail'}]}}),event(3,'turn/end',{turn:1,reason:{kind:reason}})]}});
 assert.equal(f.messages().length,1);assert.match(f.messages()[0].content,label);assert.match(f.messages()[0].content,/Original attempt detail/);
 assert.equal(f.db.prepare("SELECT count(*) n FROM management_requests WHERE kind='dsh-routine-result-v1'").get().n,1);
 f.advance();await f.histories(f.createSync(),items);assert.equal(f.matching('sessions','history').length,1);
});

for(const reason of ['unsupported','offline','revoked-member','disabled-device','deleted-employee'])test(`${reason} employees do not enqueue routine collection`,async t=>{
 const f=fixture(t,{feature:reason!=='unsupported'});
 if(reason==='offline')f.db.prepare("UPDATE devices SET status='offline' WHERE id=?").run(f.deviceId);
 if(reason==='disabled-device')f.db.prepare("UPDATE devices SET status='disabled' WHERE id=?").run(f.deviceId);
 if(reason==='revoked-member')f.db.prepare('DELETE FROM members WHERE workspace_id=? AND user_id=?').run(f.ws.id,f.owner);
 if(reason==='deleted-employee')f.db.prepare("UPDATE employees SET status='deleted' WHERE id=?").run(f.employees[0].id);
 await f.createSync().tick();assert.equal(f.actions().length,0);
});
