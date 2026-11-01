import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationAttachmentUploader} from './conversation-attachment-upload.js';
import {ATTACHMENT_CHUNK_BYTES,MAX_ATTACHMENT_BYTES} from '../../src/conversation-attachment-policy.mjs';
import {resolveApiBase,resolveApiResourceUrl} from './api-base.js';

test('stored relative attachment URLs use the API origin in split development and same-origin production',()=>{
 const route='/api/conversations/conv_test/attachments/attachment_test?download=1';
 assert.equal(resolveApiResourceUrl(resolveApiBase({dev:true,origin:'http://127.0.0.1:5178'}),route),'http://127.0.0.1:4178'+route);
 assert.equal(resolveApiResourceUrl(resolveApiBase({origin:'https://ziwei.example.test'}),route),'https://ziwei.example.test'+route);
 assert.equal(resolveApiResourceUrl('','https://ziwei.example.test'+route),'https://ziwei.example.test'+route);
});

function file(size=ATTACHMENT_CHUNK_BYTES+17) {
  return {name:'sample.bin',type:'application/octet-stream',size,arrayBuffer(){throw Error('whole file read');},slice(start,end){return {size:end-start,start,end};}};
}
function server({loseCreate=false,loseChunk=false,loseComplete=false}={}) {
  const calls=[],keys=[],ref={attachmentId:'attachment_test',name:'sample.bin',mimeType:'application/octet-stream',size:0,sha256:'a'.repeat(64)};
  let offset=0,created=false,completed=false;
  return {calls,keys,ref,async request(path,options={}) {
    calls.push({path,...options});
    if(path.endsWith('/uploads')) {
      const input=JSON.parse(options.body);ref.size=input.size;keys.push(options.headers['Idempotency-Key']);created=true;
      if(loseCreate){loseCreate=false;throw Error('create response lost');}
      return {uploadId:'upload_test',offset,chunkSize:ATTACHMENT_CHUNK_BYTES};
    }
    assert.equal(created,true);
    if(path.endsWith('/complete')) {
      assert.equal(offset,ref.size);completed=true;
      if(loseComplete){loseComplete=false;throw Error('complete response lost');}
      return {...ref};
    }
    if(options.method==='PUT') {
      const start=Number(new URL('https://test.invalid'+path).searchParams.get('offset'));
      assert.equal(start,offset);assert.ok(options.body.size<=ATTACHMENT_CHUNK_BYTES);
      assert.equal(options.headers['Content-Type'],'application/octet-stream');
      offset+=options.body.size;
      if(loseChunk){loseChunk=false;throw Error('chunk response lost');}
    }
    return {uploadId:'upload_test',offset,chunkSize:ATTACHMENT_CHUNK_BYTES,completed};
  }};
}

test('500 MiB browser upload uses bounded Blob slices and a small final reference',async()=>{
  const remote=server(),upload=createConversationAttachmentUploader({request:remote.request,makeKey:()=> 'stable-upload'}),progress=[];
  const result=await upload('conv_test',file(MAX_ATTACHMENT_BYTES),{onProgress:value=>progress.push(value)});
  assert.deepEqual(result,remote.ref);
  assert.equal(remote.calls.filter(x=>x.method==='PUT').length,63);
  assert.ok(remote.calls.every(x=>typeof x.body!=='string'||x.body.length<300));
  assert.equal(progress.at(-1).loaded,MAX_ATTACHMENT_BYTES);
  await assert.rejects(upload('conv_test',file(MAX_ATTACHMENT_BYTES+1)),/500/);
});

for(const option of ['loseCreate','loseChunk','loseComplete'])test(`browser upload resumes one session when ${option} is uncertain`,async()=>{
  const remote=server({[option]:true}),upload=createConversationAttachmentUploader({request:remote.request,makeKey:()=> 'stable-upload'}),input=file();
  await assert.rejects(upload('conv_test',input),/response lost/);
  assert.deepEqual(await upload('conv_test',input),remote.ref);
  assert.ok(remote.keys.every(key=>key==='stable-upload'));
  assert.equal(remote.calls.filter(x=>x.method==='PUT').length,2);
});

test('changing conversations never reuses a previous conversation upload',async()=>{
  const remote=server(),upload=createConversationAttachmentUploader({request:remote.request,makeKey:()=> 'stable-upload'}),input=file(12);
  await upload('conv_a',input);
  await upload('conv_b',input);
  assert.equal(remote.calls.filter(x=>x.path.endsWith('/uploads')).length,2);
  assert.ok(remote.calls.some(x=>x.path.startsWith('/api/conversations/conv_b/attachments/')));
});
