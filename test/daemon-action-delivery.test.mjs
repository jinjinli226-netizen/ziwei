import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createActionDelivery, ACTION_TRANSPORT_BUDGETS} from '../src/daemon-action-delivery.mjs';
import {MAX_ACTION_RESULT_JSON_BYTES} from '../src/conversation-image-artifacts.mjs';
import {createActionScheduler} from '../src/daemon-action-scheduler.mjs';

const identity={apiBase:'https://example.invalid',workspace:'test',deviceId:'device-A'};
const action=(id='action-test')=>({id,type:'conversation.execute',workspace_id:'ws-test',agent_id:'ziwei_user',status:'pending',expires_at:new Date(Date.now()+10000).toISOString(),payload:{deviceId:'device-A',conversationId:'conv-test',employeeId:'employee-test',messageId:'message-test'}});
const expired=()=>new Date(Date.now()-1000).toISOString();

test('quarantine permits only verified durable result retry after upload failure without a second execution', async t => {
 let executions=0,quarantined=false,failUpload=true;
 const f=fixture(t,{dispatch:async()=>{executions++;quarantined=true;return {status:'failed',code:'EXECUTION_UNCERTAIN',executionState:'uncertain',reason:'STOP_UNCONFIRMED',error:'isolated unknown tree',result:{processExit:{platform:'win32',rootConfirmed:true,treeConfirmed:false},partialEffectsPossible:true}};}});
 const post=async(...args)=>{if(args[0].endsWith('/result')&&failUpload){failUpload=false;throw new Error('fixture upload interrupted');}return f.options.post(...args);};
 const first=f.create({post});await assert.rejects(first.execute(action()),/upload interrupted/);
 assert.equal(quarantined,true);assert.equal(executions,1);
 const pending=JSON.parse(fs.readFileSync(journalFiles(f.dir,'action-test').result));
 assert.equal(pending.result.code,'EXECUTION_UNCERTAIN');assert.equal(pending.result.executionState,'uncertain');assert.equal(pending.result.reason,'STOP_UNCONFIRMED');assert.equal(pending.result.processExit.treeConfirmed,false);
 const restarted=f.create({post,dispatch:async()=>{executions++;throw new Error('must not execute during quarantine');}});
 const snapshots=()=>Object.fromEntries(fs.readdirSync(f.dir).map(name=>[name,fs.readFileSync(path.join(f.dir,name),'hex')]));
 const before=snapshots();
 assert.equal(restarted.canDeliverWithoutExecution(action()),true);
 assert.equal(restarted.canDeliverWithoutExecution(action('new-action')),false);
 assert.equal(restarted.canDeliverWithoutExecution({...action(),payload:{...action().payload,deviceId:'device-B'}}),false);
 assert.deepEqual(snapshots(),before,'read-only gate may not create or rewrite journals');
 const prior=f.calls.length;
 const scheduler=createActionScheduler({canStart:a=>!quarantined||restarted.canDeliverWithoutExecution(a),quarantinedActionIds:()=>['action-test'],execute:a=>restarted.execute(a)});
 assert.deepEqual(scheduler.schedule([action('new-action'),action()]),['action-test']);await scheduler.whenIdle();
 assert.equal(executions,1);assert.equal(f.status,'failed');assert.equal(scheduler.activeCount,1);
 const resumed=f.calls.slice(prior);assert.equal(resumed.filter(c=>c.url.endsWith('/ack')).length,1);assert.equal(resumed.filter(c=>c.url.endsWith('/result')).length,1);
 const wire=resumed.find(c=>c.url.endsWith('/result')).body.result;assert.equal(wire.code,'EXECUTION_UNCERTAIN');assert.equal(wire.executionState,'uncertain');assert.equal(wire.reason,'STOP_UNCONFIRMED');assert.equal(wire.processExit.treeConfirmed,false);
 assert.equal(resumed.some(c=>c.url.includes('new-action')),false);
 assert.equal(restarted.canDeliverWithoutExecution(action()),false,'confirmed receipts do not need scheduling');
});
function fixture(t, overrides={}) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-delivery-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const calls=[];let executions=0;let status='pending';
 const transport=async (url,body,options)=>{
  calls.push({url,body,options});
  if(url.endsWith('/ack')){if(status==='pending')status='acked';return {id:'action-test',status,expires_at:new Date(Date.now()+16*60*1000).toISOString()};}
  if(url.endsWith('/events'))return {id:body.eventId};
  status=body.status;return {id:'action-test',status,receiptOnly:true};
 };
 const dispatch=async()=>{executions++;return {status:'succeeded',result:{output:'answer'}};};
 const options={directory:dir,identity,post:transport,dispatch,retryDelays:[0,0],...overrides};
 return {dir,calls,options,create:extra=>createActionDelivery({...options,...extra}),get executions(){return executions;},get status(){return status;},set status(v){status=v;}};
}
function journalFiles(directory,id) {
 const file=fs.readdirSync(directory).filter(name=>/^[a-f0-9]{64}\.json$/.test(name)).find(name=>JSON.parse(fs.readFileSync(path.join(directory,name),'utf8')).action.id===id);
 assert.ok(file,`journal for ${id} is retained`);
 const prefix=file.slice(0,-5);
 return {metadata:path.join(directory,file),action:path.join(directory,`${prefix}.action.json`),result:path.join(directory,`${prefix}.result.json`)};
}

test('ACK committed but response lost recovers by idempotent ACK and starts once',async t=>{
 const f=fixture(t);let lost=true;
 const post=async(...args)=>{const response=await f.options.post(...args);if(args[0].endsWith('/ack')&&lost){lost=false;throw new Error('response lost');}return response;};
 const engine=f.create({post});await engine.execute(action());
 assert.equal(f.executions,1);assert.equal(f.calls.filter(c=>c.url.endsWith('/ack')&&!c.body.renewLease).length,2);assert.equal(f.status,'succeeded');
});
test('the ACK lease replaces the expired poll snapshot before dispatch',async t=>{
 let seen;const f=fixture(t,{dispatch:async a=>{seen=a;return {status:'succeeded',result:{output:'ok'}};}});
 await f.create().execute({...action(),expires_at:expired()});assert.ok(Date.parse(seen.expires_at)>Date.now());
});
test('terminal ACK never dispatches even without a local completed cache',async t=>{
 const f=fixture(t);f.status='succeeded';await f.create().execute(action());assert.equal(f.executions,0);assert.equal(f.calls.filter(c=>c.url.endsWith('/result')).length,0);
});
test('ACK outage is bounded and survives restart without starting the executor',async t=>{
 const f=fixture(t);let attempts=0;const engine=f.create({post:async()=>{attempts++;throw new Error('offline');}});
 await assert.rejects(engine.execute(action()),/offline/);assert.equal(attempts,3);assert.equal(f.executions,0);
 const restarted=f.create();assert.equal(restarted.recoverActions().length,1);await restarted.execute(restarted.recoverActions()[0]);assert.equal(f.executions,1);
});
test('durable cached result is resent after restart without dispatch or image loss',async t=>{
 const image=Buffer.alloc(10*1024*1024,73).toString('base64');let executions=0;
 const f=fixture(t,{dispatch:async()=>{executions++;return {status:'succeeded',result:{output:'image',outputArtifacts:[{name:'large.png',mimeType:'image/png',size:10*1024*1024,content:image,contentEncoding:'base64'}]}};}});
 const post=async(...args)=>{if(args[0].endsWith('/result'))throw new Error('upload interrupted');return f.options.post(...args);};
 await assert.rejects(f.create({post}).execute(action()),/upload interrupted/);assert.equal(executions,1);
 const restarted=f.create({dispatch:async()=>{throw new Error('must not relaunch');}});await restarted.execute(restarted.recoverActions()[0]);
 const body=f.calls.findLast(c=>c.url.endsWith('/result')).body;assert.equal(body.result.outputArtifacts[0].content,image);assert.equal(body.receiptOnly,true);assert.equal(executions,1);
});
test('server committed result and lost response is confirmed by ACK without a second result or CLI',async t=>{
 const f=fixture(t);const engine=f.create({post:async(...args)=>{const result=await f.options.post(...args);if(args[0].endsWith('/result'))throw new Error('lost receipt');return result;}});
 await assert.rejects(engine.execute(action()),/lost receipt/);assert.equal(f.executions,1);
 const before=f.calls.filter(c=>c.url.endsWith('/result')).length;
 await f.create().execute(action());assert.equal(f.executions,1);assert.equal(f.calls.filter(c=>c.url.endsWith('/result')).length,before);
});
test('simultaneous polls share one delivery and one execution',async t=>{
 const f=fixture(t);const e=f.create();await Promise.all([e.execute(action()),e.execute(action()),e.execute(action())]);assert.equal(f.executions,1);
});
test('a different target or message cannot alias an active or confirmed delivery ID',async t=>{
 const f=fixture(t);const e=f.create();const pending=e.execute(action());
 await assert.rejects(e.execute({...action(),payload:{...action().payload,deviceId:'device-B'}}),/identity/i);
 await assert.rejects(e.execute({...action(),payload:{...action().payload,messageId:'different'}}),/identity/i);
 await pending;await assert.rejects(e.execute({...action(),payload:{...action().payload,deviceId:'device-B'}}),/identity/i);assert.equal(f.executions,1);
});
test('empty or mismatched ACK cannot authorize execution',async t=>{
 for(const response of [{},{id:'wrong',status:'acked'},{id:'action-test',status:'acked',expires_at:expired()}]){
  const f=fixture(t);await assert.rejects(f.create({post:async()=>response}).execute(action()));assert.equal(f.executions,0);
 }
});
test('a permanent auth rejection is not repeatedly retried or dispatched',async t=>{
 const f=fixture(t);let calls=0;const error=Object.assign(new Error('forbidden'),{status:403});
 const e=f.create({post:async()=>{calls++;throw error;}});await assert.rejects(e.execute(action()),/forbidden/);await e.execute(action());assert.equal(calls,1);assert.equal(f.executions,0);
});
test('a changed workspace/device journal is refused before network or execution',async t=>{
 const f=fixture(t);await assert.rejects(f.create({post:async()=>{throw new Error('offline');}}).execute(action()));
 let network=0;await assert.rejects(f.create({identity:{...identity,deviceId:'device-B'},post:async()=>{network++;}}).execute(action()),/identity/i);assert.equal(network,0);assert.equal(f.executions,0);
});
test('corrupt journal fails closed and is retained for diagnosis',async t=>{
 const f=fixture(t);await assert.rejects(f.create({post:async()=>{throw new Error('offline');}}).execute(action()));
 const file=fs.readdirSync(f.dir).find(n=>/^[a-f0-9]{64}\.json$/.test(n));fs.writeFileSync(path.join(f.dir,file),'{broken');
 await assert.rejects(f.create().execute(action()),/corrupt/i);assert.equal(f.executions,0);assert.equal(fs.readFileSync(path.join(f.dir,file),'utf8'),'{broken');
});
test('a malformed result_pending journal cannot fabricate a successful result',async t=>{
 const f=fixture(t);await assert.rejects(f.create({post:async()=>{throw new Error('offline');}}).execute(action()));
 const file=path.join(f.dir,fs.readdirSync(f.dir).find(n=>/^[a-f0-9]{64}\.json$/.test(n)));const data=JSON.parse(fs.readFileSync(file,'utf8'));data.state='result_pending';delete data.resultDigest;fs.writeFileSync(file,JSON.stringify(data));
 await assert.rejects(f.create().execute(action()),/corrupt/i);assert.equal(f.executions,0);assert.equal(f.calls.length,0);
});
test('the exact upload budget includes receiptOnly alongside a maximum image and large text',async t=>{
 const image=Buffer.alloc(10*1024*1024,73).toString('base64');
 const f=fixture(t,{dispatch:async()=>({status:'succeeded',result:{output:'x'.repeat(4*1024*1024),outputArtifacts:[{name:'large.png',mimeType:'image/png',size:10*1024*1024,content:image,contentEncoding:'base64'}]}})});
 await f.create().execute(action());const body=f.calls.find(c=>c.url.endsWith('/result')).body;
 assert.ok(Buffer.byteLength(JSON.stringify(body))<=MAX_ACTION_RESULT_JSON_BYTES);assert.equal(body.result.outputArtifacts[0].content,image);
});
test('oversized metadata falls back to an explicit failed result that can be uploaded after restart',async t=>{
 const image=Buffer.alloc(10*1024*1024,73).toString('base64');let executions=0;
 const f=fixture(t,{dispatch:async()=>{executions++;return {status:'succeeded',result:{output:'ok',hugeMetadata:'x'.repeat(20*1024*1024),outputArtifacts:[{name:'large.png',mimeType:'image/png',size:10*1024*1024,content:image,contentEncoding:'base64'}]}};}});
 await assert.rejects(f.create({post:async(...args)=>{if(args[0].endsWith('/result'))throw new Error('upload interrupted');return f.options.post(...args);}}).execute(action()));
 const restarted=f.create({dispatch:async()=>{throw new Error('must not execute');}});await restarted.execute(restarted.recoverActions()[0]);
 const body=f.calls.findLast(c=>c.url.endsWith('/result')).body;
 assert.equal(body.status,'failed');assert.equal(body.receiptOnly,true);assert.equal(body.result.truncationReason,'action_result_json_budget');assert.equal(body.result.outputArtifacts[0].content,image);assert.equal(executions,1);
 const terminalEvents=f.calls.filter(c=>c.url.endsWith('/events')&&['succeeded','failed'].includes(c.body.type));assert.ok(terminalEvents.length>0);assert.ok(terminalEvents.every(c=>c.body.type==='failed'),'an oversized result must never emit a success event');
});
test('journal write failure prevents ACK and CLI start',async t=>{
 const f=fixture(t);const file=path.join(f.dir,'file');fs.writeFileSync(file,'x');
 await assert.rejects(f.create({directory:file}).execute(action()));assert.equal(f.executions,0);assert.equal(f.calls.length,0);
});
test('progress uses stable event IDs and flushes before terminal result',async t=>{
 const f=fixture(t);let e;let eventLost=true;
 e=f.create({dispatch:async()=>{e.recordEvent('action-test','action.started',{message:'start'});e.recordEvent('action-test','action.output',{message:'output'});return {status:'succeeded',result:{output:'ok'}};},post:async(...args)=>{const response=await f.options.post(...args);if(args[0].endsWith('/events')&&eventLost){eventLost=false;throw new Error('event response lost');}return response;}});
 await e.execute(action());const events=f.calls.filter(c=>c.url.endsWith('/events'));
 assert.equal(events[0].body.eventId,events[1].body.eventId);assert.equal(new Set(events.map(c=>c.body.eventId)).size,3);
 assert.ok(f.calls.findIndex(c=>c.url.endsWith('/result'))>f.calls.findLastIndex(c=>c.url.endsWith('/events')));
 assert.ok(events.every(c=>!JSON.stringify(c.body).includes('contentEncoding')));
});
test('unavailable progress events cannot block a durable terminal result',async t=>{
 for(const status of [400,500]){
  const f=fixture(t);const post=async(...args)=>{if(args[0].endsWith('/events'))throw Object.assign(new Error('events unavailable'),{status});return f.options.post(...args);};
  await f.create({post}).execute(action());assert.equal(f.executions,1);assert.equal(f.status,'succeeded');
 }
});
test('a cached result requests a fresh authorized lease before each resumed upload',async t=>{
 const f=fixture(t);await assert.rejects(f.create({post:async(...args)=>{if(args[0].endsWith('/result'))throw new Error('upload timed out');return f.options.post(...args);}}).execute(action()));
 f.calls.length=0;await f.create().execute(action());const ack=f.calls.find(c=>c.url.endsWith('/ack'));
 assert.equal(ack.body.renewLease,true);assert.equal(f.executions,1);
});
test('uncertain dispatcher outcome stays explicit and never becomes success',async t=>{
 const f=fixture(t,{dispatch:async()=>({status:'failed',code:'EXECUTION_UNCERTAIN',executionState:'uncertain',reason:'STARTED_WITHOUT_RESULT',error:'manual verification required'})});
 await f.create().execute(action());const body=f.calls.find(c=>c.url.endsWith('/result')).body;
 assert.equal(body.status,'failed');assert.equal(body.result.code,'EXECUTION_UNCERTAIN');assert.equal(body.result.executionState,'uncertain');
});
test('transport budgets support the measured large image upload independently of polling',()=>{
 assert.ok(ACTION_TRANSPORT_BUDGETS.result>=600000);assert.ok(ACTION_TRANSPORT_BUDGETS.poll>=600000);assert.ok(ACTION_TRANSPORT_BUDGETS.ack>=10000);
});
test('maximum image input with many progress stages writes bounded metadata instead of rewriting image bytes',async t=>{
 const input=Buffer.alloc(10*1024*1024,42).toString('base64');let engine,total=0,writes=0;const original=fs.writeFileSync;
 const a={...action(),payload:{...action().payload,inputAttachments:[{name:'input.png',content:input,contentEncoding:'base64'}]}};
 const f=fixture(t,{dispatch:async received=>{assert.equal(received.payload.inputAttachments[0].content,input);for(let i=0;i<20;i++)engine.recordEvent(a.id,'action.stage',{message:`stage ${i}`});return {status:'succeeded',result:{output:'ok'}};}});
 fs.writeFileSync=(file,bytes,...args)=>{total+=Buffer.byteLength(bytes);writes++;return original(file,bytes,...args);};const started=performance.now();
 try{engine=f.create();await engine.execute(a);}finally{fs.writeFileSync=original;}
 const inputBytes=Buffer.byteLength(JSON.stringify(a));t.diagnostic(JSON.stringify({inputBytes,writes,totalBytes:total,elapsedMs:Math.round(performance.now()-started)}));
 assert.ok(total<inputBytes*4,`image input was rewritten: ${total} bytes`);
 assert.ok(fs.readdirSync(f.dir).every(name=>fs.statSync(path.join(f.dir,name)).size<128*1024),'confirmed journal only retains light metadata');
});
test('two ten-minute upload timeouts retain one result and renew a full lease on every resumed attempt',async t=>{
 const f=fixture(t);let clock=Date.now(),expiry,uploads=0;const leases=[];
 const post=async(url,body,options)=>{
  if(url.endsWith('/ack')){if(f.status==='pending'||body.renewLease)expiry=clock+16*60*1000;f.status='acked';return {id:'action-test',status:'acked',expires_at:new Date(expiry).toISOString(),deviceId:'device-A'};}
  if(url.endsWith('/result')){leases.push(expiry-clock);uploads++;if(uploads<=2){clock+=10*60*1000;throw new Error('ten-minute upload timeout');}}
  return f.options.post(url,body,options);
 };
 const extra={post,now:()=>clock};
 await assert.rejects(f.create(extra).execute(action()),/timeout/);
 const second=f.create(extra);await assert.rejects(second.execute(second.recoverActions()[0]),/timeout/);
 const third=f.create(extra);await third.execute(third.recoverActions()[0]);
 assert.equal(f.executions,1);assert.equal(uploads,3);assert.ok(leases.every(ms=>ms>=16*60*1000));assert.equal(f.status,'succeeded');
});
test('confirmed retention is bounded and never deletes blocked or unconfirmed image records',async t=>{
 const f=fixture(t);const post=async(url,body)=>{const id=decodeURIComponent(url.split('/')[4]);if(id==='blocked')throw Object.assign(new Error('auth denied'),{status:403});if(id==='pending')throw new Error('offline');return {id,status:url.endsWith('/ack')?'acked':'succeeded',expires_at:new Date(Date.now()+16*60*1000).toISOString(),deviceId:'device-A'};};
 const e=f.create({post,maxConfirmedRecords:2});await assert.rejects(e.execute(action('blocked')));await assert.rejects(e.execute(action('pending')));
 const protectedFiles=fs.readdirSync(f.dir).map(name=>({name,data:fs.readFileSync(path.join(f.dir,name))}));
 for(let i=0;i<6;i++)await e.execute(action(`confirmed-${i}`));
 assert.equal(fs.readdirSync(f.dir).filter(name=>/^[a-f0-9]{64}\.json$/.test(name)).length,4);
 assert.ok(protectedFiles.every(({name,data})=>fs.readFileSync(path.join(f.dir,name)).equals(data)));assert.equal(e.pendingCount,1);assert.equal(e.blockedCount,1);
});
test('a result receipt from another device is refused and retains complete input and result blobs',async t=>{
 const input=Buffer.alloc(4096,37).toString('base64'),output=Buffer.alloc(4096,74).toString('base64');
 const a={...action(),payload:{...action().payload,inputAttachments:[{name:'input.png',content:input,contentEncoding:'base64'}]}};
 const f=fixture(t,{dispatch:async()=>({status:'succeeded',result:{output:'complete output',outputArtifacts:[{name:'output.png',content:output,contentEncoding:'base64'}]}})});
 const post=async(...args)=>({...await f.options.post(...args),deviceId:args[0].endsWith('/result')?'device-B':'device-A'});
 const e=f.create({post});await assert.rejects(e.execute(a),/identity|receipt/i);
 const files=journalFiles(f.dir,a.id),record=JSON.parse(fs.readFileSync(files.metadata,'utf8'));
 assert.equal(record.state,'result_pending');assert.equal(e.pendingCount,1);
 assert.equal(JSON.parse(fs.readFileSync(files.action,'utf8')).action.payload.inputAttachments[0].content,input);
 assert.equal(JSON.parse(fs.readFileSync(files.result,'utf8')).result.outputArtifacts[0].content,output);
 assert.deepEqual(f.create().recoverActions().map(item=>item.id),[a.id]);
});
test('a failed confirmed metadata write preserves blobs through other pruning and retries the server in the same instance',async t=>{
 const f=fixture(t),serverStates=new Map(),executions=new Map(),requests=[];
 const post=async(url,body)=>{
  const id=decodeURIComponent(url.split('/')[4]);requests.push({id,url});
  if(url.endsWith('/events'))return {id:body.eventId};
  if(url.endsWith('/ack')){if(!serverStates.has(id))serverStates.set(id,'acked');return {id,status:serverStates.get(id),expires_at:new Date(Date.now()+16*60*1000).toISOString(),deviceId:'device-A'};}
  serverStates.set(id,body.status);return {id,status:body.status,deviceId:'device-A'};
 };
 const e=f.create({post,maxConfirmedRecords:1,dispatch:async a=>{executions.set(a.id,(executions.get(a.id)||0)+1);return {status:'succeeded',result:{output:`complete output ${a.id}`}};}});
 const a={...action('confirm-write-failed'),payload:{...action().payload,inputAttachments:[{name:'input.png',content:'full-input-bytes',contentEncoding:'base64'}]}};
 const original=fs.writeFileSync;let failOnce=true;
 fs.writeFileSync=function(file,bytes,...args){let record;try{record=JSON.parse(String(bytes));}catch{}if(failOnce&&record?.state==='confirmed'&&record?.action?.id===a.id){failOnce=false;throw Object.assign(new Error('confirmed metadata ENOSPC'),{code:'ENOSPC'});}return original.call(this,file,bytes,...args);};
 try{await assert.rejects(e.execute(a),/ENOSPC/);}finally{fs.writeFileSync=original;}
 const files=journalFiles(f.dir,a.id),input=fs.readFileSync(files.action),result=fs.readFileSync(files.result);
 assert.equal(JSON.parse(fs.readFileSync(files.metadata,'utf8')).state,'result_pending');
 await e.execute(action('other-confirmed'));
 assert.deepEqual(fs.readFileSync(files.action),input,'another action confirmation cannot prune unconfirmed input');
 assert.deepEqual(fs.readFileSync(files.result),result,'another action confirmation cannot prune unconfirmed output');
 assert.equal(e.pendingCount,1);
 const before=requests.filter(item=>item.id===a.id).length;
 assert.equal((await e.execute(a)).state,'confirmed');
 assert.equal(requests.filter(item=>item.id===a.id).length,before+1,'the retry must authenticate terminal state with the server');
 assert.equal(executions.get(a.id),1,'the durable result must not execute a second time');
 assert.equal(JSON.parse(fs.readFileSync(files.metadata,'utf8')).state,'confirmed');
});
test('confirmed uncertain outcomes retain complete input and result across retention pruning and restart',async t=>{
 const input=Buffer.alloc(4096,38).toString('base64'),output=Buffer.alloc(4096,75).toString('base64');
 const a={...action(),payload:{...action().payload,inputAttachments:[{name:'input.png',content:input,contentEncoding:'base64'}]}};
 const f=fixture(t,{dispatch:async()=>({status:'failed',code:'EXECUTION_UNCERTAIN',executionState:'uncertain',reason:'STARTED_WITHOUT_RESULT',error:'manual verification required',output:'partial output evidence',outputArtifacts:[{name:'partial.png',content:output,contentEncoding:'base64'}]})});
 const e=f.create({maxConfirmedRecords:0,confirmedRetentionMs:0});await e.execute(a);assert.equal(f.status,'failed');
 const files=journalFiles(f.dir,a.id),protectedFiles=Object.values(files).map(file=>({file,bytes:fs.readFileSync(file)}));
 assert.equal(JSON.parse(fs.readFileSync(files.action,'utf8')).action.payload.inputAttachments[0].content,input);
 const delivered=JSON.parse(fs.readFileSync(files.result,'utf8'));assert.equal(delivered.result.executionState,'uncertain');assert.equal(delivered.result.output,'partial output evidence');assert.equal(delivered.result.outputArtifacts[0].content,output);
 const restarted=f.create({maxConfirmedRecords:0,confirmedRetentionMs:0,dispatch:async()=>{throw new Error('uncertain action must not execute again');}});
 assert.deepEqual(restarted.recoverActions(),[]);
 assert.ok(protectedFiles.every(({file,bytes})=>fs.readFileSync(file).equals(bytes)),'zero-count and zero-age retention must retain all uncertain evidence after restart');
});
