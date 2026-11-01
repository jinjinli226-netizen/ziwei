import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createActionDelivery} from '../src/daemon-action-delivery.mjs';
import {rasterFixtures} from './fixtures/raster-images.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const identity={apiBase:'https://attachment.invalid',workspace:'attachment-workspace',deviceId:'attachment-device'};
const action={id:'action_attachment',type:'conversation.execute',workspace_id:'attachment-workspace-id',payload:{deviceId:identity.deviceId,employeeId:'employee_attachment',conversationId:'conversation_attachment',messageId:'message_attachment',input:'retained input '.repeat(40000)}};
const descriptor={path:'D:/isolated-output/archive.zip',name:'archive.zip',mimeType:'application/zip',size:500*1024*1024,sha256:'a'.repeat(64)};
const ref={attachmentId:'attachment_completed',name:descriptor.name,mimeType:descriptor.mimeType,size:descriptor.size,sha256:descriptor.sha256};
const inline={name:'preview.png',mimeType:'image/png',size:rasterFixtures.png.length,contentEncoding:'base64',content:rasterFixtures.png.toString('base64')};
const refMetadata={name:ref.name,mimeType:ref.mimeType,size:ref.size,sha256:ref.sha256};
const exit={platform:'win32',supervisor:'windows-job',launched:true,rootPid:42,rootConfirmed:true,rootExitCode:0,treeConfirmed:true,activeProcesses:0,cancelled:false};
const result=(artifacts,status)=>({status,...(status==='failed'?{error:'Original failure'}:{}),result:{code:status==='failed'?1:0,output:'Original completed result',processExit:{...exit,rootExitCode:status==='failed'?1:0},outputArtifacts:artifacts}});

function fixture(t,{artifacts=[descriptor],autoArchiveUnconfirmed=false,executionStatus='succeeded'}={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-attachment-delivery-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const prefix=sha(JSON.stringify(action.id)),journalPath=path.join(directory,prefix+'.json'),actionPath=path.join(directory,prefix+'.action.json'),resultPath=path.join(directory,prefix+'.result.json');
  let executions=0,status='acked',postResult;
  const calls=[];
  const metadata=artifacts.map(({name,mimeType,size,sha256,content})=>({name,mimeType,size,sha256:content?sha(Buffer.from(content,'base64')):sha256}));
  const post=async(url,body)=>{
    calls.push({url,body});
    if(url.endsWith('/ack'))return{id:action.id,deviceId:identity.deviceId,status,acked_at:new Date().toISOString(),expires_at:new Date(Date.now()+24*60*60*1000).toISOString()};
    if(url.endsWith('/events'))return{id:body.eventId};
    if(postResult)return postResult(body);
    status=body.status;
    return{id:action.id,deviceId:identity.deviceId,status,completed_at:new Date().toISOString(),result:{outputArtifacts:metadata}};
  };
  const create=attachmentTransfer=>createActionDelivery({directory,identity,post,attachmentTransfer,retryDelays:[],autoArchiveUnconfirmed,dispatch:async()=>{executions++;return result(artifacts,executionStatus);}});
  return{directory,journalPath,actionPath,resultPath,calls,create,metadata,
    read:()=>JSON.parse(fs.readFileSync(journalPath,'utf8')),
    get executions(){return executions;},set result(fn){postResult=fn;},set status(value){status=value;}};
}

test('500 MiB local descriptors upload with durable checkpoints and send only refs alongside unchanged inline images',async t=>{
  const f=fixture(t,{artifacts:[descriptor,inline]}),uploads=[];let rawAction,rawResult,digests;
  const transfer={upload:async({actionId,artifact,state,onState,signal})=>{
    uploads.push({actionId,artifact,state,signal});
    rawAction=fs.readFileSync(f.actionPath);rawResult=fs.readFileSync(f.resultPath);
    digests={actionDigest:f.read().actionDigest,resultDigest:f.read().resultDigest};
    assert.equal(rawResult.length<4096,true,'large bytes are never embedded in the durable result');
    await onState({creating:true,offset:0});assert.deepEqual(f.read().attachmentUploads[0],{creating:true,offset:0});
    await onState({uploadId:'upload-one',offset:descriptor.size,ref});
    assert.deepEqual(f.read().attachmentUploads[0],{uploadId:'upload-one',offset:descriptor.size,ref});
    assert.deepEqual(fs.readFileSync(f.actionPath),rawAction);assert.deepEqual(fs.readFileSync(f.resultPath),rawResult);
    assert.deepEqual({actionDigest:f.read().actionDigest,resultDigest:f.read().resultDigest},digests);
    return ref;
  }};
  assert.deepEqual(await f.create(transfer).execute(action),{state:'confirmed',status:'succeeded'});
  assert.equal(f.executions,1);assert.equal(uploads.length,1);assert.equal(uploads[0].actionId,action.id);assert.equal(uploads[0].state,undefined);
  const sent=f.calls.find(call=>call.url.endsWith('/result')).body;
  assert.deepEqual(sent.result.outputArtifacts,[ref,inline]);assert.equal(JSON.stringify(sent).includes(descriptor.path),false);
  assert.deepEqual(JSON.parse(rawResult).result.outputArtifacts,[descriptor,inline]);
  assert.equal(f.read().state,'confirmed');assert.deepEqual(f.read().attachmentUploads[0].ref,ref);
});

test('interrupted upload resumes the persisted session after restart with original evidence and no second execution',async t=>{
  const f=fixture(t);let calls=0,originalAction,originalResult,originalDigests;
  const interrupted={upload:async({onState})=>{
    calls++;originalAction=fs.readFileSync(f.actionPath);originalResult=fs.readFileSync(f.resultPath);originalDigests={actionDigest:f.read().actionDigest,resultDigest:f.read().resultDigest};
    await onState({uploadId:'upload-interrupted',offset:16*1024*1024});
    throw Object.assign(Error('Upload stopped'),{name:'AbortError'});
  }};
  await assert.rejects(f.create(interrupted).execute(action),{name:'AbortError'});
  assert.equal(f.read().state,'result_pending');assert.equal(f.calls.filter(call=>call.url.endsWith('/result')).length,0);
  assert.deepEqual(fs.readFileSync(f.actionPath),originalAction);assert.deepEqual(fs.readFileSync(f.resultPath),originalResult);
  assert.deepEqual({actionDigest:f.read().actionDigest,resultDigest:f.read().resultDigest},originalDigests);
  const resumed={upload:async({state,onState})=>{calls++;assert.deepEqual(state,{uploadId:'upload-interrupted',offset:16*1024*1024});await onState({...state,offset:descriptor.size,ref});return ref;}};
  await f.create(resumed).execute(action);
  assert.equal(calls,2);assert.equal(f.executions,1);assert.equal(f.calls.filter(call=>call.url.endsWith('/result')).length,1);
});

for(const executionStatus of ['succeeded','failed'])test(`a completed upload survives a lost ${executionStatus} response and terminal ACK recovery verifies the full duplicate receipt`,async t=>{
  const f=fixture(t,{executionStatus});let physicalUploads=0,attempts=0,posts=0;
  const transfer={upload:async({state,onState})=>{attempts++;if(state?.ref){assert.deepEqual(state.ref,ref);return state.ref;}physicalUploads++;await onState({uploadId:'upload-completed',offset:descriptor.size,ref});return ref;}};
  f.result=async()=>{posts++;f.status=executionStatus;if(posts===1)throw Object.assign(Error('Result receipt lost'),{code:'ECONNRESET'});return{id:action.id,deviceId:identity.deviceId,status:executionStatus,completed_at:new Date().toISOString(),result:{outputArtifacts:[refMetadata]}};};
  await assert.rejects(f.create(transfer).execute(action),{code:'ECONNRESET'});
  assert.equal(f.read().state,'result_pending');assert.deepEqual(f.read().attachmentUploads[0].ref,ref);
  const restarted=f.create(transfer);await restarted.execute(action);await restarted.execute(action);
  assert.equal(f.executions,1);assert.equal(physicalUploads,1);assert.equal(attempts,2);assert.equal(posts,2);assert.equal(f.read().state,'confirmed');
});

test('multiple artifacts resume independently and concurrent delivery passes share the same active upload',async t=>{
  const second={...descriptor,path:'D:/isolated-output/report.pdf',name:'report.pdf',mimeType:'application/pdf',size:2*1024*1024,sha256:'c'.repeat(64)};
  const secondRef={attachmentId:'attachment_second',name:second.name,mimeType:second.mimeType,size:second.size,sha256:second.sha256};
  const f=fixture(t,{artifacts:[descriptor,second]});let failed=false,firstUploads=0,secondUploads=0,release;
  const held=new Promise(resolve=>{release=resolve;});
  const transfer={upload:async({artifact,state,onState})=>{
    if(artifact.name===descriptor.name){if(state?.ref)return state.ref;firstUploads++;await onState({uploadId:'upload-first',offset:descriptor.size,ref});return ref;}
    secondUploads++;assert.equal(state?.offset,failed?1024:undefined);
    if(!failed){failed=true;await onState({uploadId:'upload-second',offset:1024});throw Error('Second upload interrupted');}
    await held;await onState({...state,offset:second.size,ref:secondRef});return secondRef;
  }};
  await assert.rejects(f.create(transfer).execute(action),/Second upload interrupted/);
  assert.deepEqual(f.read().attachmentUploads[0].ref,ref);assert.equal(f.read().attachmentUploads[1].offset,1024);
  const resumed=f.create(transfer),one=resumed.execute(action),two=resumed.execute(action);assert.equal(one,two);
  release();await Promise.all([one,two]);assert.equal(firstUploads,1);assert.equal(secondUploads,2);assert.equal(f.executions,1);
  assert.deepEqual(f.calls.find(call=>call.url.endsWith('/result')).body.result.outputArtifacts,[ref,secondRef]);
});

test('explicit archived attachment retry resumes completed refs and retains original descriptor bytes and archive',async t=>{
  const f=fixture(t,{autoArchiveUnconfirmed:true});let uploads=0,refused=true;
  const transfer={upload:async({state,onState})=>{if(state?.ref)return state.ref;uploads++;await onState({uploadId:'upload-archived',offset:descriptor.size,ref});return ref;}};
  f.result=async()=>{if(refused)throw Object.assign(Error('Result rejected'),{status:413});return{id:action.id,deviceId:identity.deviceId,status:'succeeded',completed_at:new Date().toISOString(),result:{outputArtifacts:[refMetadata]}};};
  const delivery=f.create(transfer);assert.equal((await delivery.execute(action)).state,'archived_unconfirmed');
  const archived=f.read(),originalAction=fs.readFileSync(f.actionPath),originalResult=fs.readFileSync(f.resultPath);
  refused=false;await delivery.retryArchivedResult(action.id);await delivery.retryArchivedResult(action.id);
  assert.equal(uploads,1);assert.equal(f.executions,1);assert.equal(f.read().state,'confirmed');assert.deepEqual(f.read().archive,archived.archive);
  assert.equal(f.read().actionDigest,archived.actionDigest);assert.equal(f.read().resultDigest,archived.resultDigest);
  assert.deepEqual(fs.readFileSync(f.actionPath),originalAction);assert.deepEqual(fs.readFileSync(f.resultPath),originalResult);
  assert.deepEqual(f.calls.filter(call=>call.url.endsWith('/result')).map(call=>call.body.result.outputArtifacts),[[ref],[ref]]);
});

for(const mismatch of ['reference','inline'])test(`mixed result refuses a receipt with mismatched ${mismatch} SHA`,async t=>{
  const f=fixture(t,{artifacts:[descriptor,inline]});
  const transfer={upload:async({onState})=>{await onState({uploadId:'upload-sha',offset:descriptor.size,ref});return ref;}};
  f.result=async()=>({id:action.id,deviceId:identity.deviceId,status:'succeeded',completed_at:new Date().toISOString(),result:{outputArtifacts:f.metadata.map((item,index)=>index===(mismatch==='reference'?0:1)?{...item,sha256:'b'.repeat(64)}:item)}});
  await assert.rejects(f.create(transfer).execute(action),/receipt/i);
  assert.equal(f.read().state,'result_pending');assert.equal(f.executions,1);assert.equal(fs.existsSync(f.resultPath),true);
});

test('a durable completed reference bypasses upload and still verifies its SHA',async t=>{
  const f=fixture(t,{artifacts:[ref]});
  await f.create({upload:async()=>assert.fail('A completed reference does not need file upload')}).execute(action);
  assert.deepEqual(f.calls.find(call=>call.url.endsWith('/result')).body.result.outputArtifacts,[ref]);assert.equal(f.executions,1);
});

test('an absent transfer dependency leaves local descriptors pending and can resume after it is supplied',async t=>{
  const f=fixture(t);
  await assert.rejects(f.create().execute(action),/attachment.*transfer/i);
  assert.equal(f.read().state,'result_pending');assert.equal(f.calls.filter(call=>call.url.endsWith('/result')).length,0);
  await f.create({upload:async()=>ref}).execute(action);assert.equal(f.executions,1);
});

test('legacy inline images keep the original result envelope and never invoke attachment transfer',async t=>{
  const f=fixture(t,{artifacts:[inline]});let original;
  f.result=async body=>{original=fs.readFileSync(f.resultPath,'utf8');assert.equal(JSON.stringify(body),original);return{id:action.id,status:'succeeded',deviceId:identity.deviceId};};
  await f.create({upload:async()=>assert.fail('Inline images must remain unchanged')}).execute(action);
  assert.equal(f.executions,1);assert.equal(JSON.parse(original).result.outputArtifacts[0].content,inline.content);
});
