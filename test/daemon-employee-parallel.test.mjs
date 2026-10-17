import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {ActionDispatcher} from '../src/daemon.mjs';
import {createActionScheduler} from '../src/daemon-action-scheduler.mjs';
import {createActionDelivery} from '../src/daemon-action-delivery.mjs';
import {spawnSupervisedRuntime} from '../src/runtime-process.mjs';

const identity={apiBase:'https://employee-parallel.invalid',workspace:'parallel-fixture',deviceId:'device-parallel'};
const action=(id,employeeId)=>({
 id,type:'conversation.execute',agent_id:'ziwei_user',workspace_id:'workspace-parallel',status:'pending',
 dedupe_key:`conversation:${employeeId}:${id}`,created_at:new Date().toISOString(),
 expires_at:new Date(Date.now()+24*60*60*1000).toISOString(),
 payload:{deviceId:identity.deviceId,employeeId,conversationId:`conversation-${employeeId}`,messageId:`message-${id}`,profile:`bot-${employeeId}`,runtime:'Hermes',prompt:'isolated parallel fixture'},
});
async function until(check,label){
 const deadline=Date.now()+8000;
 while(Date.now()<deadline){if(check())return;await delay(10);}
 assert.fail(`Timed out waiting for ${label}`);
}

// These are real native processes, held by stdin instead of a model/network.
// Their actual supervision receipts flow through the production dispatcher.
function fixture(t,{quarantined=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-employee-parallel-'));
 const stateFile=path.join(root,'action-state.json'),directory=path.join(root,'action-delivery');
 if(quarantined)fs.writeFileSync(stateFile,JSON.stringify({version:2,completed:[],started:[{
  key:'old-uncertain',actionId:'old-uncertain',startedAt:Date.now(),nativeRuntime:true,
  identity:{workspace:identity.workspace,deviceId:identity.deviceId,workspaceId:'workspace-parallel',targetDeviceId:identity.deviceId},
 }]}));
 const rows=new Map(),requests=[],executions=[],ready=new Set(),runtimes=new Map(),errors=[];
 let delivery;
 const dispatcher=new ActionDispatcher({
  workspace:identity.workspace,deviceId:identity.deviceId,workdir:root,stateFile,
  canExecute:()=>!dispatcher.quarantined,
  onEvent:(type,data)=>{if(data.actionId)delivery?.recordEvent(data.actionId,type,data);},
  execute:async(a,context)=>{
   executions.push(a.id);
   const runtime=spawnSupervisedRuntime({command:process.execPath,cwd:root,env:{...process.env},args:['-e',
    "process.stdout.write('ready\\n');process.stdin.resume();process.stdin.on('end',()=>process.stdout.write('done\\n'));",
   ]});
   runtimes.set(a.id,runtime);context.onSupervision(runtime);
   let output='';
   runtime.child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('ready\n'))ready.add(a.id);context.onOutput(chunk.toString());});
   runtime.child.stderr.resume();
   const exit=await runtime.completionEvidence;
   assert.equal(exit.rootConfirmed,true);assert.equal(exit.rootExitCode,0);
   return {status:'succeeded',result:{output:`completed:${a.id}`}};
  },
 });
 const fetchMock=async(url,options)=>{
  assert.equal(options.method,'POST');assert.equal(options.headers['x-ziwei-device-token'],'fixture-token');
  const match=new URL(url).pathname.match(/^\/a2a\/v1\/actions\/([^/]+)\/(ack|events|result)$/);
  assert.ok(match,'only the action delivery transport is mocked');
  const [,id,operation]=match,body=JSON.parse(options.body),row=rows.get(id);
  assert.ok(row);requests.push({id,operation,body});
  if(operation==='events')return Response.json({id:body.eventId},{status:202});
  if(operation==='ack'){
   if(row.status==='pending'){row.status='acked';row.acked_at=new Date().toISOString();}
   row.expires_at=new Date(Date.now()+16*60*1000).toISOString();
   return Response.json({id,status:row.status,deviceId:identity.deviceId,acked_at:row.acked_at,expires_at:row.expires_at});
  }
  assert.equal(row.status,'acked');assert.equal(body.receiptOnly,true);
  row.status=body.status;row.result=body.result;row.completed_at=new Date().toISOString();
  return Response.json({id,status:row.status,deviceId:identity.deviceId,receiptOnly:true});
 };
 const makeDelivery=()=>createActionDelivery({directory,identity,retryDelays:[],
  post:async(route,body)=>{
   const response=await fetchMock(identity.apiBase+route,{method:'POST',headers:{'content-type':'application/json','x-ziwei-device-token':'fixture-token'},body:JSON.stringify(body)});
   assert.equal(response.ok,true);return response.json();
  },
  dispatch:a=>dispatcher.dispatch(a),recoverResult:a=>dispatcher.completedResult(a),
 });
 delivery=makeDelivery();
 const scheduler=createActionScheduler({
  execute:a=>delivery.execute(a),
  canStart:a=>!dispatcher.quarantined||delivery.canDeliverWithoutExecution(a),
  quarantinedActionIds:()=>dispatcher.quarantinedActionIds,
  onError:error=>errors.push(error),
 });
 const release=id=>{const runtime=runtimes.get(id);assert.ok(runtime,`runtime ${id} started`);runtime.child.stdin.end();};
 t.after(async()=>{
  for(const runtime of runtimes.values())if(!runtime.child.stdin.writableEnded)runtime.child.stdin.end();
  await Promise.allSettled([...runtimes.values()].map(runtime=>runtime.completionEvidence));
  await scheduler.whenIdle();await delivery.whenIdle();
  fs.rmSync(root,{recursive:true,force:true});
 });
 return {root,stateFile,directory,rows,requests,executions,ready,runtimes,errors,dispatcher,scheduler,release,makeDelivery,
  add(...actions){for(const a of actions)rows.set(a.id,structuredClone(a));},
  poll(){return scheduler.schedule([...rows.values()].filter(a=>['pending','acked'].includes(a.status)).map(a=>structuredClone(a)));},
 };
}

test('real delivery and dispatcher run different employees together and keep each employee ordered',{timeout:20000},async t=>{
 const f=fixture(t),a1=action('a-first','employee-a'),a2=action('a-second','employee-a'),b=action('b-first','employee-b');
 f.add(a1,a2,b);f.poll();
 await until(()=>f.ready.has(a1.id)&&f.ready.has(b.id)&&Number.isSafeInteger(f.runtimes.get(a1.id)?.child.pid)&&Number.isSafeInteger(f.runtimes.get(b.id)?.child.pid),'both native employee processes');
 assert.equal(f.rows.get(a1.id).status,'acked');assert.equal(f.rows.get(b.id).status,'acked');
 assert.equal(f.rows.get(a2.id).status,'pending');
 assert.notEqual(f.runtimes.get(a1.id).child.pid,f.runtimes.get(b.id).child.pid);
 assert.equal(f.rows.get(a1.id).completed_at,undefined);assert.equal(f.rows.get(b.id).completed_at,undefined);
 for(let i=0;i<4;i++)f.poll();
 assert.deepEqual([...f.executions].sort(),[a1.id,b.id].sort());
 assert.equal(f.requests.filter(r=>r.operation==='ack'&&r.id===a1.id).length,1);
 assert.equal(f.requests.filter(r=>r.operation==='ack'&&r.id===b.id).length,1);
 assert.equal(f.requests.some(r=>r.id===a2.id),false,'same employee next message has not even ACKed');

 f.release(b.id);await until(()=>f.rows.get(b.id).status==='succeeded','employee B terminal delivery');
 f.poll();assert.equal(f.rows.get(a2.id).status,'pending','free capacity cannot overtake employee A');
 f.release(a1.id);await f.scheduler.whenIdle();
 assert.equal(f.rows.get(a1.id).status,'succeeded');assert.equal(f.dispatcher.quarantined,false);
 f.poll();await until(()=>f.ready.has(a2.id),'employee A second message');
 assert.equal(f.rows.get(a2.id).status,'acked');
 f.release(a2.id);await f.scheduler.whenIdle();
 assert.deepEqual(f.executions,[a1.id,b.id,a2.id]);assert.deepEqual(f.errors,[]);

 for(const a of [a1,a2,b]){
  const row=f.rows.get(a.id),results=f.requests.filter(r=>r.id===a.id&&r.operation==='result');
  assert.equal(row.status,'succeeded');assert.equal(results.length,1);
  assert.equal(results[0].body.result.output,`completed:${a.id}`);
  assert.equal(results[0].body.result.processExit.rootConfirmed,true);
  assert.equal(results[0].body.result.processExit.rootExitCode,0);
 }
 const persisted=JSON.parse(fs.readFileSync(f.stateFile,'utf8'));
 assert.deepEqual(persisted.completed.map(row=>row.result.actionId).sort(),[a1.id,a2.id,b.id].sort());
 const confirmed=fs.readdirSync(f.directory).filter(name=>/^[a-f0-9]{64}\.json$/.test(name)).map(name=>JSON.parse(fs.readFileSync(path.join(f.directory,name))));
 assert.equal(confirmed.length,3);assert.ok(confirmed.every(row=>row.state==='confirmed'&&row.serverStatus==='succeeded'));
 // Stale polls and a delivery restart must use durable receipts, never execute again.
 const requestsBefore=f.requests.length;
 f.scheduler.schedule([a1,a2,b,a1]);await f.scheduler.whenIdle();
 const restarted=f.makeDelivery();for(const a of [a1,a2,b])await restarted.execute(a);
 assert.deepEqual(f.executions,[a1.id,b.id,a2.id]);assert.equal(f.requests.length,requestsBefore);
});

test('persisted uncertain execution blocks parallel conversation ACKs across repeated polls',{timeout:10000},async t=>{
 const f=fixture(t,{quarantined:true}),before=fs.readFileSync(f.stateFile),a=action('new-a','employee-a'),b=action('new-b','employee-b');
 f.add(a,b);assert.equal(f.dispatcher.quarantined,true);
 for(let i=0;i<4;i++)f.poll();await f.scheduler.whenIdle();
 assert.deepEqual(f.executions,[]);assert.deepEqual(f.requests,[]);assert.deepEqual(f.errors,[]);
 assert.equal(f.rows.get(a.id).status,'pending');assert.equal(f.rows.get(b.id).status,'pending');
 assert.equal(fs.existsSync(f.directory),false,'quarantine does not create new delivery journals');
 assert.deepEqual(fs.readFileSync(f.stateFile),before,'the original unknown execution remains intact');
 assert.deepEqual(f.dispatcher.quarantinedActionIds,['old-uncertain']);
});
