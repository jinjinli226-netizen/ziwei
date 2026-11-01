import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {createActionDelivery,ACTION_TRANSPORT_BUDGETS} from '../src/daemon-action-delivery.mjs';
import {createRepository} from '../backend/repository.mjs';
import {rasterFixtures} from './fixtures/raster-images.mjs';

const identity={apiBase:'https://retry.invalid',workspace:'retry-workspace',deviceId:'retry-device'};
const image=rasterFixtures.png;
const artifact={name:'result.png',mimeType:'image/png',size:image.length,contentEncoding:'base64',content:image.toString('base64')};
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const exit={platform:'win32',supervisor:'windows-job',launched:true,rootPid:42,rootConfirmed:true,rootExitCode:0,treeConfirmed:true,activeProcesses:0,cancelled:false};
const outcome={status:'succeeded',result:{runtime:'Hermes',code:0,output:'Original image',processExit:exit,outputArtifacts:[artifact]}};
const action={id:'action_retry-fixture',type:'conversation.execute',workspace_id:'retry-workspace-id',agent_id:'ziwei_user',status:'pending',expires_at:new Date(Date.now()+900000).toISOString(),payload:{deviceId:identity.deviceId,employeeId:'employee_retry',conversationId:'conversation_retry'}};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};

async function fixture(t,{result=outcome}={}) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-delivery-retry-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  let executions=0,refuse=true,override,ackOverride,confirmed=0;
  const calls=[];
  const acknowledgement=()=>({id:action.id,status:'acked',deviceId:identity.deviceId,acked_at:new Date().toISOString(),expires_at:new Date(Date.now()+900000).toISOString()});
  const confirmation=()=>({id:action.id,status:'succeeded',deviceId:identity.deviceId,completed_at:new Date().toISOString(),result:{outputArtifacts:[{name:artifact.name,mimeType:artifact.mimeType,size:artifact.size,sha256:sha(image)}]}});
  const post=async(url,body,options)=>{
    calls.push({url,body,options});
    if(url.endsWith('/ack'))return ackOverride?ackOverride():acknowledgement();
    if(url.endsWith('/events'))return{id:body.eventId};
    if(refuse)throw Object.assign(Error('Payload refused'),{status:413});
    return override?override():confirmation();
  };
  const delivery=createActionDelivery({directory,identity,post,retryDelays:[],autoArchiveUnconfirmed:true,
    dispatch:async()=>{executions++;return result;},onConfirmed:async()=>{confirmed++;}});
  await delivery.execute(action);
  const name=sha(JSON.stringify(action.id)),journalPath=path.join(directory,name+'.json'),resultPath=path.join(directory,name+'.result.json');
  const originalJournal=JSON.parse(fs.readFileSync(journalPath,'utf8')),originalBytes=fs.readFileSync(resultPath);
  calls.length=0;refuse=false;
  return {directory,delivery,calls,post,acknowledgement,confirmation,journalPath,resultPath,originalJournal,originalBytes,
    set ack(fn){ackOverride=fn;},set result(fn){override=fn;},get executions(){return executions;},get confirmed(){return confirmed;}};
}

test('explicit archived retry posts only the original result and confirms the same action without executing again',async t=>{
  const f=await fixture(t);
  assert.deepEqual(f.delivery.recoverActions(),[]);
  assert.equal(typeof f.delivery.retryArchivedResult,'function');
  assert.deepEqual(await f.delivery.retryArchivedResult(action.id),{state:'confirmed',status:'succeeded'});
  assert.equal(f.executions,1);assert.equal(f.confirmed,1);
  assert.deepEqual(f.calls.map(x=>x.url),[`/a2a/v1/actions/${action.id}/ack`,`/a2a/v1/actions/${action.id}/result`]);
  assert.deepEqual(f.calls[0].body,{agentId:'ziwei_user',receiptOnly:true,renewLease:true});
  assert.equal(f.calls[0].options.timeoutMs,ACTION_TRANSPORT_BUDGETS.ack);
  assert.equal(f.calls[1].options.timeoutMs,600000);
  assert.equal(JSON.stringify(f.calls[1].body),f.originalBytes.toString('utf8'));
  const saved=JSON.parse(fs.readFileSync(f.journalPath,'utf8'));
  assert.equal(saved.state,'confirmed');assert.equal(saved.serverStatus,'succeeded');assert.equal(saved.retainEvidence,true);
  assert.deepEqual(saved.archive,f.originalJournal.archive);
  assert.deepEqual(fs.readFileSync(f.resultPath),f.originalBytes);
  const count=f.calls.length;
  assert.deepEqual(await f.delivery.retryArchivedResult(action.id),{state:'confirmed',status:'succeeded',alreadyConfirmed:true});
  assert.equal(f.calls.length,count);assert.equal(f.executions,1);
  const reopened=createActionDelivery({directory:f.directory,identity,post:f.post,dispatch:async()=>{throw Error('No dispatch');},recoverResult:()=>outcome});
  assert.deepEqual(reopened.recoverActions(),[],'retained confirmation must not reopen from the dispatcher cache');
});

test('concurrent explicit retries share one receipt upload and wait for it without dispatching',async t=>{
  const f=await fixture(t),held=deferred();let uploads=0;
  f.result=async()=>{uploads++;await held.promise;return f.confirmation();};
  const one=f.delivery.retryArchivedResult(action.id),two=f.delivery.retryArchivedResult(action.id);
  assert.equal(one,two);
  let idle=false;const waiting=f.delivery.whenIdle().then(()=>{idle=true;});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(idle,false);assert.equal(uploads,1);
  held.resolve();await Promise.all([one,two,waiting]);assert.equal(f.executions,1);assert.equal(uploads,1);
});

for(const field of ['id','deviceId','status','reconciliationRequired'])test(`retry refuses mismatched or terminal ACK ${field} before any result upload`,async t=>{
  const f=await fixture(t),changes={id:'action_foreign',deviceId:'foreign-device',status:'failed',reconciliationRequired:true};
  f.ack=()=>({...f.acknowledgement(),[field]:changes[field]});
  await assert.rejects(f.delivery.retryArchivedResult(action.id),{code:'DELIVERY_RETRY_ACK_INVALID'});
  assert.equal(f.calls.length,1);assert.deepEqual(JSON.parse(fs.readFileSync(f.journalPath,'utf8')),f.originalJournal);assert.equal(f.executions,1);
});

test('an expired ACK or a missing current device cannot authorize archived retry',async t=>{
  const f=await fixture(t);
  for(const patch of [{status:'expired'},{deviceId:null}]){
    f.ack=()=>({...f.acknowledgement(),...patch});
    await assert.rejects(f.delivery.retryArchivedResult(action.id),{code:'DELIVERY_RETRY_ACK_INVALID'});
  }
  assert.equal(f.calls.filter(x=>x.url.endsWith('/result')).length,0);
});

test('a succeeded ACK still uploads the full original and requires its image receipt',async t=>{
  const f=await fixture(t);f.ack=()=>({...f.acknowledgement(),status:'succeeded'});
  f.result=()=>({...f.confirmation(),result:{outputArtifacts:[]}});
  await assert.rejects(f.delivery.retryArchivedResult(action.id),{code:'DELIVERY_RETRY_RESULT_INVALID'});
  assert.equal(f.calls.filter(x=>x.url.endsWith('/result')).length,1);
  assert.equal(JSON.stringify(f.calls[1].body),f.originalBytes.toString('utf8'));
  assert.deepEqual(JSON.parse(fs.readFileSync(f.journalPath,'utf8')),f.originalJournal);
  f.result=f.confirmation;await f.delivery.retryArchivedResult(action.id);
  assert.equal(f.executions,1);assert.equal(f.confirmed,1);
});

test('a definitive original failure can be delivered as failed without another execution',async t=>{
  const result={status:'failed',error:'Original failure',result:{code:1,processExit:{...exit,rootExitCode:1}}};
  const f=await fixture(t,{result});
  f.result=()=>({...f.confirmation(),status:'failed',result:{outputArtifacts:[]}});
  assert.deepEqual(await f.delivery.retryArchivedResult(action.id),{state:'confirmed',status:'failed'});
  assert.equal(f.executions,1);assert.equal(f.confirmed,1);
  assert.equal(JSON.stringify(f.calls[1].body),f.originalBytes.toString('utf8'));
});

test('a text-only terminal receipt may omit the empty artifact list',async t=>{
  const f=await fixture(t,{result:{status:'succeeded',result:{code:0,output:'Original text',processExit:exit}}});
  f.result=()=>({...f.confirmation(),result:{outputLength:13}});
  assert.deepEqual(await f.delivery.retryArchivedResult(action.id),{state:'confirmed',status:'succeeded'});
  assert.equal(f.executions,1);assert.equal(f.confirmed,1);
});

for(const patch of [{id:'action_foreign'},{deviceId:'foreign-device'},{status:'failed'},{status:'expired'},{reconciliationRequired:true},{result:{}},{result:{outputArtifacts:[]}},{result:{outputArtifacts:[{name:'result.png',mimeType:'image/png',size:image.length,sha256:'wrong'}]}}])test(`retry keeps archived evidence when result receipt differs: ${JSON.stringify(patch)}`,async t=>{
  const f=await fixture(t);f.result=()=>({...f.confirmation(),...patch});
  await assert.rejects(f.delivery.retryArchivedResult(action.id),{code:'DELIVERY_RETRY_RESULT_INVALID'});
  assert.equal(f.calls.length,2);assert.equal(f.confirmed,0);assert.equal(f.executions,1);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.journalPath,'utf8')),f.originalJournal);
  assert.deepEqual(fs.readFileSync(f.resultPath),f.originalBytes);
});

test('transport failure is not retried or reexecuted and another explicit request can use unchanged bytes',async t=>{
  const f=await fixture(t);f.result=()=>{throw Object.assign(Error('network unavailable'),{code:'ECONNRESET'});};
  await assert.rejects(f.delivery.retryArchivedResult(action.id),{code:'ECONNRESET'});
  assert.equal(f.calls.filter(x=>x.url.endsWith('/result')).length,1);assert.equal(f.executions,1);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.journalPath,'utf8')),f.originalJournal);
  f.result=f.confirmation;await f.delivery.retryArchivedResult(action.id);
  assert.equal(f.calls.filter(x=>x.url.endsWith('/result')).length,2);assert.equal(f.executions,1);
});

test('unknown, wrong-scope, corrupt or non-definitive archived results are refused before contacting the server',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.delivery.retryArchivedResult('action_missing'),{code:'DELIVERY_RETRY_NOT_FOUND'});
  const foreign=createActionDelivery({directory:f.directory,identity:{...identity,workspace:'foreign'},post:f.post,dispatch:async()=>{throw Error('No dispatch');}});
  await assert.rejects(foreign.retryArchivedResult(action.id),/identity mismatch/);
  fs.writeFileSync(f.resultPath,Buffer.concat([f.originalBytes,Buffer.from(' ')]));
  await assert.rejects(f.delivery.retryArchivedResult(action.id),/journal corrupt/);assert.equal(f.calls.length,0);
  const uncertain=await fixture(t,{result:{...outcome,result:{...outcome.result,processExit:{...exit,treeConfirmed:false}}}});
  await assert.rejects(uncertain.delivery.retryArchivedResult(action.id),{code:'DELIVERY_RETRY_INCOMPLETE'});
  assert.equal(uncertain.calls.length,0);
});

for(const [name,result,loseResponse=false] of [
  ['original image',outcome],
  ['successful text',{status:'succeeded',result:{code:0,output:'Original text',processExit:exit}}],
  ['original failure',{status:'failed',error:'Original failure',result:{code:1,processExit:{...exit,rootExitCode:1}}}],
  ['original failure after a committed result response is lost',{status:'failed',error:'Original failure',result:{code:1,processExit:{...exit,rootExitCode:1}}},true]
])test(`the original repository receipts restore ${name} after one archived rejection`,async t=>{
  const repo=createRepository({memory:true});t.after(()=>repo.db.close());
  const device=repo.claimDevicePairing({code:repo.createDevicePairing('test-111',{name:'Receipt retry fixture',os:'Windows'}).code});
  const employee=repo.createEmployee('test-111',{name:'Original image',runtime:'Codex',targetDeviceId:device.deviceId});
  const conversation=repo.createConversation('test-111',{employeeId:employee.id});
  const original=repo.addConversationMessage(conversation.id,{content:'Synthetic original generation'}).execution;
  const assigned=repo.getA2AAction(original.id),directory=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-original-retry-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  let refused=true,executions=0,lost=false;const uploads=[];
  const delivery=createActionDelivery({directory,identity:{apiBase:'https://fixture.invalid',workspace:'test-111',deviceId:device.deviceId},retryDelays:[],autoArchiveUnconfirmed:true,
    dispatch:async()=>{executions++;return result;},post:async(url,body)=>{
      if(url.endsWith('/ack'))return repo.ackA2AAction(assigned.id,{...body,deviceId:device.deviceId});
      if(url.endsWith('/events'))return repo.recordA2AEvent(assigned.id,{...body,deviceId:device.deviceId});
      if(refused)throw Object.assign(Error('fixture body rejected'),{status:413});
      const receipt=repo.resultA2AAction(assigned.id,{...body,deviceId:device.deviceId});
      assert.equal(receipt.status,result.status,receipt.error);uploads.push(JSON.stringify(body));
      if(loseResponse&&!lost){lost=true;throw Object.assign(Error('Committed response lost'),{code:'ECONNRESET'});}
      return receipt;
    }});
  await delivery.execute(assigned);
  assert.equal(repo.getA2AAction(assigned.id).status,'acked');
  assert.equal(repo.getConversation(conversation.id).messages.filter(x=>x.role==='assistant').length,0);
  const name=sha(JSON.stringify(assigned.id)),journalPath=path.join(directory,name+'.json'),resultPath=path.join(directory,name+'.result.json');
  const archived=JSON.parse(fs.readFileSync(journalPath,'utf8')),originalBytes=fs.readFileSync(resultPath);
  refused=false;
  if(loseResponse){
    await assert.rejects(delivery.retryArchivedResult(assigned.id),{code:'ECONNRESET'});
    assert.equal(repo.getA2AAction(assigned.id).status,'failed');
    assert.equal(repo.getConversation(conversation.id).messages.filter(x=>x.role==='assistant').length,1);
    assert.deepEqual(JSON.parse(fs.readFileSync(journalPath,'utf8')),archived);
    assert.deepEqual(fs.readFileSync(resultPath),originalBytes);
  }
  await delivery.retryArchivedResult(assigned.id);
  assert.equal(repo.getA2AAction(assigned.id).status,result.status);assert.equal(executions,1);
  const reply=repo.getConversation(conversation.id).messages.at(-1);
  assert.equal(reply.attachments.length,result.result.outputArtifacts?.length||0);
  if(reply.attachments.length)assert.equal(sha(Buffer.from(reply.attachments[0].content,'base64')),sha(image));
  assert.equal(uploads.length,loseResponse?2:1);
  for(const uploaded of uploads)assert.equal(uploaded,originalBytes.toString('utf8'));
  const confirmed=JSON.parse(fs.readFileSync(journalPath,'utf8'));
  assert.equal(confirmed.state,'confirmed');assert.deepEqual(confirmed.archive,archived.archive);
  assert.deepEqual(fs.readFileSync(resultPath),originalBytes);
  await delivery.retryArchivedResult(assigned.id);
  assert.equal(repo.getConversation(conversation.id).messages.filter(x=>x.role==='assistant').length,1);
});
