import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createAttachmentTransfer,validateAttachmentReference} from '../src/conversation-attachment-transfer.mjs';

const CHUNK=8*1024*1024,MAX=500*1024*1024,run=promisify(execFile);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
async function digest(file){const sum=createHash('sha256');for await(const chunk of fs.createReadStream(file))sum.update(chunk);return sum.digest('hex');}
function fixture(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-attachment-transfer-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return directory;}
async function artifact(directory,size=CHUNK+19){const file=path.join(directory,'source.bin'),handle=await fs.promises.open(file,'w');await handle.truncate(size);await handle.close();return{path:file,name:'source.bin',mimeType:'application/octet-stream',size,sha256:await digest(file)};}
const reference=descriptor=>({attachmentId:'attachment_fixture',name:descriptor.name,mimeType:descriptor.mimeType,size:descriptor.size,sha256:descriptor.sha256});

if(process.env.ZIWEI_ATTACHMENT_BOUNDARY_CHILD==='1'){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-attachment-boundary-'));
  try{
    const source=await artifact(directory,MAX),ref=reference(source);let offset=0,maxChunk=0,active=0,maxActive=0;
    const transfer=createAttachmentTransfer({apiBase:'https://device.invalid',headers:{'x-ziwei-device-token':'private'},fetchImpl:async(url,options)=>{
      active++;maxActive=Math.max(maxActive,active);
      try{
        if(options.method==='GET'&&url.endsWith('/attachments/attachment_fixture'))return new Response(fs.createReadStream(source.path));
        if(options.method==='POST'&&url.endsWith('/uploads'))return json({uploadId:'upload_fixture',offset:0,chunkSize:CHUNK});
        if(options.method==='PUT'){maxChunk=Math.max(maxChunk,options.body.length);assert.equal(Number(new URL(url).searchParams.get('offset')),offset);offset+=options.body.length;return json({uploadId:'upload_fixture',offset});}
        if(url.endsWith('/complete'))return json(ref);
        throw Error('Unexpected request');
      }finally{active--;}
    }});
    const local=await transfer.download({actionId:'action_boundary',attachment:ref,destination:path.join(directory,'downloaded.bin')});
    assert.equal(local.size,MAX);assert.equal(await digest(local.path),source.sha256);
    const completed=await transfer.upload({actionId:'action_boundary',artifact:source,onState:async()=>{}});
    assert.deepEqual(completed,ref);assert.equal(offset,MAX);
    console.log(JSON.stringify({size:offset,maxChunk,maxActive,maxRssKiB:process.resourceUsage().maxRSS}));
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
}else{
test('attachment transfer permits HTTPS and explicit loopback only, without URL credentials',()=>{
  for(const apiBase of ['https://device.invalid','http://127.0.0.1:9','http://localhost:9','http://[::1]:9'])assert.equal(typeof createAttachmentTransfer({apiBase}).upload,'function');
  for(const apiBase of ['http://device.invalid','ftp://device.invalid','https://user:secret@device.invalid','https://device.invalid?token=secret','https://device.invalid/#token'])assert.throws(()=>createAttachmentTransfer({apiBase}),{code:'ATTACHMENT_ORIGIN_INVALID'});
});

test('reference metadata validation can also protect reuse of an existing verified local file',()=>{
  const ref={attachmentId:'attachment_fixture',name:'a.bin',mimeType:'application/octet-stream',size:3,sha256:hash('abc')};
  assert.equal(validateAttachmentReference(ref),ref);
  for(const replacement of [{attachmentId:''},{name:7},{mimeType:null},{size:MAX+1},{sha256:'bad'}])assert.throws(()=>validateAttachmentReference({...ref,...replacement}),{code:'ATTACHMENT_METADATA_INVALID'});
});

test('download streams authenticated original bytes to a new local file and verifies size and hash',async t=>{
  const directory=fixture(t),source=await artifact(directory,1024*1024+7),ref=reference(source),calls=[];
  const transfer=createAttachmentTransfer({apiBase:'https://device.invalid/',headers:async()=>({'x-ziwei-device-token':'private'}),fetchImpl:async(url,options)=>{calls.push({url,options});return new Response(fs.createReadStream(source.path));}});
  const destination=path.join(directory,'downloaded.bin'),local=await transfer.download({actionId:'action_download',attachment:ref,destination});
  assert.deepEqual(local,{path:destination,name:source.name,mimeType:source.mimeType,size:source.size,bytes:source.size,sha256:source.sha256,attachmentId:ref.attachmentId,nativeVision:false});
  assert.equal(await digest(destination),source.sha256);assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://device.invalid/a2a/v1/actions/action_download/attachments/attachment_fixture');
  assert.equal(new Headers(calls[0].options.headers).get('x-ziwei-device-token'),'private');assert.equal(calls[0].options.redirect,'error');
});

test('download rejects mismatched or interrupted bytes and removes only its own partial file',async t=>{
  const directory=fixture(t),destination=path.join(directory,'out.bin'),ref={attachmentId:'attachment_fixture',name:'a.bin',mimeType:'application/octet-stream',size:3,sha256:hash(Buffer.from('abc'))};
  for(const body of [Buffer.from('ab'),Buffer.from('abcd'),Buffer.from('xyz')]){
    const transfer=createAttachmentTransfer({apiBase:'https://device.invalid',fetchImpl:async()=>new Response(body)});
    await assert.rejects(transfer.download({actionId:'action_download',attachment:ref,destination}));assert.equal(fs.existsSync(destination),false);
  }
  let pulls=0;
  const interrupted=new ReadableStream({pull(controller){if(pulls++===0)controller.enqueue(Buffer.from('a'));else controller.error(Error('Download interrupted'));}});
  await assert.rejects(createAttachmentTransfer({apiBase:'https://device.invalid',fetchImpl:async()=>new Response(interrupted)}).download({actionId:'action_download',attachment:ref,destination}),/Download interrupted/);
  assert.equal(fs.existsSync(destination),false);
  fs.writeFileSync(destination,'keep');
  await assert.rejects(createAttachmentTransfer({apiBase:'https://device.invalid',fetchImpl:async()=>new Response('abc')}).download({actionId:'action_download',attachment:ref,destination}));
  assert.equal(fs.readFileSync(destination,'utf8'),'keep');
});

test('upload hashes the real file, sends at most 8 MiB per request and awaits durable state',async t=>{
  const source=await artifact(fixture(t)),ref=reference(source),calls=[],states=[];let offset=0,persisting=false;
  const transfer=createAttachmentTransfer({apiBase:'https://device.invalid',headers:{'x-ziwei-device-token':'private'},fetchImpl:async(url,options)=>{
    assert.equal(persisting,false);calls.push({url,options});assert.equal(options.redirect,'error');
    if(url.endsWith('/uploads')){assert.deepEqual(JSON.parse(options.body),{name:source.name,mimeType:source.mimeType,size:source.size});return json({uploadId:'upload_fixture',offset:0,chunkSize:CHUNK});}
    if(options.method==='PUT'){assert.equal(new Headers(options.headers).get('content-type'),'application/octet-stream');assert.equal(Number(new URL(url).searchParams.get('offset')),offset);assert.ok(options.body.length<=CHUNK);offset+=options.body.length;return json({uploadId:'upload_fixture',offset});}
    if(url.endsWith('/complete'))return json(ref);
    throw Error('Unexpected request');
  }});
  const result=await transfer.upload({actionId:'action_upload',artifact:source,onState:async state=>{persisting=true;await new Promise(resolve=>setImmediate(resolve));states.push(structuredClone(state));persisting=false;}});
  assert.deepEqual(result,ref);assert.deepEqual(states.at(-1),{uploadId:'upload_fixture',offset:source.size,ref});
  assert.equal(calls.filter(x=>x.options.method==='PUT').length,2);assert.equal(offset,source.size);assert.equal(states[0].creating,true);
});

test('an interrupted PUT resumes from queried server offset without creating or resending accepted bytes',async t=>{
  const source=await artifact(fixture(t)),ref=reference(source),states=[];let accepted=0,createCount=0,interrupted=true,queryCount=0;
  const transfer=createAttachmentTransfer({apiBase:'https://device.invalid',fetchImpl:async(url,options)=>{
    if(url.endsWith('/uploads')){createCount++;return json({uploadId:'upload_fixture',offset:0,chunkSize:CHUNK});}
    if(options.method==='GET'){queryCount++;return json({uploadId:'upload_fixture',offset:accepted});}
    if(options.method==='PUT'){assert.equal(Number(new URL(url).searchParams.get('offset')),accepted);accepted+=options.body.length;if(interrupted){interrupted=false;throw Error('Response lost');}return json({uploadId:'upload_fixture',offset:accepted});}
    if(url.endsWith('/complete'))return json(ref);
    throw Error('Unexpected request');
  }});
  const onState=async state=>states.push(structuredClone(state));
  await assert.rejects(transfer.upload({actionId:'action_resume',artifact:source,onState}),/Response lost/);
  assert.equal(queryCount,0);assert.equal(states.at(-1).offset,0);
  assert.deepEqual(await transfer.upload({actionId:'action_resume',artifact:source,state:states.at(-1),onState}),ref);
  assert.equal(queryCount,1);assert.equal(createCount,1);assert.equal(accepted,source.size);
});

test('upload accepts offset-only GET and PUT responses from the bound session route',async t=>{
  const source=await artifact(fixture(t),19),ref=reference(source);let offset=7;
  const transfer=createAttachmentTransfer({apiBase:'https://device.invalid',fetchImpl:async(url,options)=>{
    if(options.method==='GET')return json({offset});
    if(options.method==='PUT'){offset+=options.body.length;return json({offset});}
    if(url.endsWith('/complete'))return json(ref);
    throw Error('Unexpected request');
  }});
  assert.deepEqual(await transfer.upload({actionId:'action_offsets',artifact:source,state:{uploadId:'upload_fixture',offset:0}}),ref);
});

test('an uncertain completion is completed idempotently on the next explicit resume',async t=>{
  const source=await artifact(fixture(t),19),ref=reference(source),states=[];let offset=0,completions=0,creates=0;
  const transfer=createAttachmentTransfer({apiBase:'https://device.invalid',fetchImpl:async(url,options)=>{
    if(url.endsWith('/uploads')){creates++;return json({uploadId:'upload_fixture',offset:0,chunkSize:CHUNK});}
    if(options.method==='GET')return json({uploadId:'upload_fixture',offset});
    if(options.method==='PUT'){offset+=options.body.length;return json({uploadId:'upload_fixture',offset});}
    if(url.endsWith('/complete')){if(++completions===1)throw Error('Completion response lost');return json(ref);}
    throw Error('Unexpected request');
  }});
  const onState=async state=>states.push(structuredClone(state));
  await assert.rejects(transfer.upload({actionId:'action_complete',artifact:source,onState}));
  assert.deepEqual(await transfer.upload({actionId:'action_complete',artifact:source,state:states.at(-1),onState}),ref);assert.equal(completions,2);assert.equal(creates,1);
  assert.deepEqual(await transfer.upload({actionId:'action_complete',artifact:source,state:states.at(-1),onState}),ref);assert.equal(completions,2);
});

test('an uncertain create replays its durable idempotency key without creating a replacement session',async t=>{
  const source=await artifact(fixture(t),7),states=[],ref=reference(source);let creates=0,requests=0,key;
  const expectedKey=hash(JSON.stringify(['action_create',source.name,source.mimeType,source.size,source.sha256]));
  const transfer=createAttachmentTransfer({apiBase:'https://device.invalid',fetchImpl:async(url,options)=>{
    requests++;
    if(url.endsWith('/uploads')){
      const supplied=new Headers(options.headers).get('Idempotency-Key');assert.equal(supplied,expectedKey);
      if(!key){key=supplied;creates++;throw Error('Create response lost');}
      assert.equal(supplied,key);return json({uploadId:'upload_fixture',offset:0,chunkSize:CHUNK});
    }
    if(options.method==='PUT')return json({offset:source.size});
    if(url.endsWith('/complete'))return json(ref);
    throw Error('Unexpected request');
  }});
  const onState=async state=>states.push(structuredClone(state));
  await assert.rejects(transfer.upload({actionId:'action_create',artifact:source,onState}),/Create response lost/);
  assert.deepEqual(states.at(-1),{creating:true,creationKey:expectedKey,offset:0});assert.equal(requests,1);
  assert.deepEqual(await transfer.upload({actionId:'action_create',artifact:source,state:states.at(-1),onState}),ref);assert.equal(creates,1);
  const prior=requests;
  await assert.rejects(transfer.upload({actionId:'action_create',artifact:source,onState:async()=>{throw Error('Journal failed');}}),/Journal failed/);assert.equal(requests,prior);
});

test('invalid sizes, local hashes, server offsets and completion refs fail without execution or automatic retries',async t=>{
  const source=await artifact(fixture(t),17);let requests=0;
  const transfer=createAttachmentTransfer({apiBase:'https://device.invalid',fetchImpl:async()=>{requests++;throw Error('Unexpected network');}});
  await assert.rejects(transfer.upload({actionId:'action_invalid',artifact:{...source,size:MAX+1}}),{code:'ATTACHMENT_METADATA_INVALID'});
  await assert.rejects(transfer.upload({actionId:'action_invalid',artifact:{...source,sha256:'0'.repeat(64)}}),{code:'ATTACHMENT_FILE_MISMATCH'});assert.equal(requests,0);
  await assert.rejects(transfer.download({actionId:'action_invalid',attachment:{...reference(source),size:MAX+1},destination:path.join(path.dirname(source.path),'oversize')}),{code:'ATTACHMENT_METADATA_INVALID'});
  for(const offset of [-1,source.size+1,0.5])await assert.rejects(createAttachmentTransfer({apiBase:'https://device.invalid',fetchImpl:async()=>json({uploadId:'upload_fixture',offset})}).upload({actionId:'action_invalid',artifact:source,state:{uploadId:'upload_fixture',offset:0}}),{code:'ATTACHMENT_UPLOAD_STATE_INVALID'});
  const bad=createAttachmentTransfer({apiBase:'https://device.invalid',fetchImpl:async(url)=>url.endsWith('/complete')?json({...reference(source),sha256:'0'.repeat(64)}):json({uploadId:'upload_fixture',offset:source.size})});
  await assert.rejects(bad.upload({actionId:'action_invalid',artifact:source,state:{uploadId:'upload_fixture',offset:source.size}}),{code:'ATTACHMENT_REFERENCE_INVALID'});
});

test('a real 500 MiB plus one byte file is rejected before any transfer',async t=>{
  const directory=fixture(t),file=path.join(directory,'oversize.bin'),handle=await fs.promises.open(file,'w');
  await handle.truncate(MAX+1);await handle.close();let requests=0;
  const transfer=createAttachmentTransfer({apiBase:'https://device.invalid',fetchImpl:async()=>{requests++;throw Error('Unexpected request');}});
  await assert.rejects(transfer.upload({actionId:'action_oversize',artifact:{path:file,name:'oversize.bin',mimeType:'application/octet-stream',size:fs.statSync(file).size,sha256:'0'.repeat(64)}}),{code:'ATTACHMENT_METADATA_INVALID'});
  assert.equal(requests,0);
});

test('abort stops download and upload before another request',async t=>{
  const source=await artifact(fixture(t),17),controller=new AbortController();controller.abort();let requests=0;
  const transfer=createAttachmentTransfer({apiBase:'https://device.invalid',fetchImpl:async()=>{requests++;throw Error('Unexpected request');}});
  await assert.rejects(transfer.upload({actionId:'action_abort',artifact:source,signal:controller.signal}),{name:'AbortError'});
  await assert.rejects(transfer.download({actionId:'action_abort',attachment:reference(source),destination:path.join(path.dirname(source.path),'aborted'),signal:controller.signal}),{name:'AbortError'});assert.equal(requests,0);
});

test('abort after a committed chunk persists its offset and stops before the next chunk',async t=>{
  const source=await artifact(fixture(t)),controller=new AbortController(),states=[];let requests=0;
  const transfer=createAttachmentTransfer({apiBase:'https://device.invalid',fetchImpl:async(url,options)=>{
    requests++;if(url.endsWith('/uploads'))return json({uploadId:'upload_fixture',offset:0,chunkSize:CHUNK});
    assert.equal(options.method,'PUT');controller.abort();return json({uploadId:'upload_fixture',offset:CHUNK});
  }});
  await assert.rejects(transfer.upload({actionId:'action_abort_chunk',artifact:source,signal:controller.signal,onState:async state=>states.push(state)}),{name:'AbortError'});
  assert.equal(requests,2);assert.deepEqual(states.at(-1),{uploadId:'upload_fixture',offset:CHUNK});
});

test('a stalled create or JSON response times out with its creation checkpoint intact',async t=>{
  const source=await artifact(fixture(t),7);
  for(const bodyStalls of [false,true]){
    const states=[];
    const transfer=createAttachmentTransfer({apiBase:'https://device.invalid',timeoutMs:30,fetchImpl:async(url,{signal})=>{
      if(!bodyStalls)return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
      return new Response(new ReadableStream({start(controller){signal.addEventListener('abort',()=>controller.error(signal.reason),{once:true});}}));
    }});
    await assert.rejects(transfer.upload({actionId:'action_timeout',artifact:source,onState:async state=>states.push(state)}),{name:'TimeoutError'});
    assert.equal(states.at(-1).creating,true);assert.equal(states.at(-1).offset,0);
  }
});

test('a stalled PUT has a bounded budget and retains the last confirmed offset',async t=>{
  const source=await artifact(fixture(t),7),states=[];let requests=0;
  const transfer=createAttachmentTransfer({apiBase:'https://device.invalid',timeoutMs:30,fetchImpl:async(url,{signal})=>{
    requests++;if(url.endsWith('/uploads'))return json({uploadId:'upload_fixture',offset:0,chunkSize:CHUNK});
    return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  }});
  await assert.rejects(transfer.upload({actionId:'action_put_timeout',artifact:source,onState:async state=>states.push(state)}),{name:'TimeoutError'});
  assert.equal(requests,2);assert.deepEqual(states.at(-1),{uploadId:'upload_fixture',offset:0});
});

test('download inactivity budget resets for active chunks and removes a stalled partial file',async t=>{
  const directory=fixture(t),bytes=Buffer.from('abc'),ref={attachmentId:'attachment_fixture',name:'a.bin',mimeType:'application/octet-stream',size:3,sha256:hash(bytes)};
  for(const stalled of [false,true]){
    let sent=0;
    const transfer=createAttachmentTransfer({apiBase:'https://device.invalid',timeoutMs:60,fetchImpl:async(url,{signal})=>new Response(new ReadableStream({
      start(controller){signal.addEventListener('abort',()=>controller.error(signal.reason),{once:true});},
      async pull(controller){if(stalled&&sent)return new Promise(()=>{});await new Promise(resolve=>setTimeout(resolve,35));controller.enqueue(bytes.subarray(sent,sent+1));if(++sent===bytes.length)controller.close();}
    }))});
    const destination=path.join(directory,stalled?'stalled.bin':'active.bin');
    if(stalled){await assert.rejects(transfer.download({actionId:'action_timeout',attachment:ref,destination}),{name:'AbortError'});assert.equal(fs.existsSync(destination),false);}
    else{assert.equal((await transfer.download({actionId:'action_timeout',attachment:ref,destination})).size,bytes.length);assert.equal(fs.readFileSync(destination,'utf8'),'abc');}
  }
});

test('a real 500 MiB download and upload remain bounded to one 8 MiB transfer buffer',{timeout:125000},async t=>{
  const {stdout}=await run(process.execPath,[fileURLToPath(import.meta.url)],{env:{...process.env,ZIWEI_ATTACHMENT_BOUNDARY_CHILD:'1'},timeout:120000,maxBuffer:1024*1024});
  const report=JSON.parse(stdout.trim());assert.equal(report.size,MAX);assert.equal(report.maxChunk,CHUNK);assert.equal(report.maxActive,1);assert.ok(report.maxRssKiB<256*1024,JSON.stringify(report));
  t.diagnostic(JSON.stringify(report));
});
}
