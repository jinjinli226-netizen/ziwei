import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationComposerStore, createConversationEnterGuard, imageMimeFromBytes, readConversationImages } from './conversation-compose.js';

const image={name:'one.png',mimeType:'image/png',contentEncoding:'base64',content:'iVBORw0KGgo=',size:8};
function store(){let count=0;return createConversationComposerStore({makeId:()=>`message-${++count}`});}

test('composer Enter keeps IME selection native and blocks the first 500ms after composition',()=>{
  let now=1000,prevented=0;const guard=createConversationEnterGuard({now:()=>now});
  const enter=patch=>guard.shouldSend({key:'Enter',preventDefault(){prevented++;},...patch});
  assert.equal(enter({isComposing:true}),false);assert.equal(enter({keyCode:229}),false);assert.equal(prevented,0);
  guard.compositionStart();assert.equal(enter(),false);guard.compositionEnd();
  for(const elapsed of [0,100,499]){now=1000+elapsed;assert.equal(enter(),false);}
  now=1500;assert.equal(enter(),true);assert.equal(prevented,4);
  for(const modifier of ['shiftKey','ctrlKey','altKey','metaKey'])assert.equal(enter({[modifier]:true}),false);
  assert.equal(guard.shouldSend({key:'a'}),false);assert.equal(prevented,4);
  assert.equal(createConversationEnterGuard({now:()=>now}).shouldSend({key:'Enter',preventDefault(){}}),true);
});

test('same conversation cannot start a second submission and failed retry retains its identity',()=>{
  const drafts=store();drafts.updateDraft('a','hello');drafts.setAttachments('a',[image]);
  const first=drafts.beginSubmission('a',{model:'vision'});
  assert.ok(first);assert.equal(drafts.beginSubmission('a',{model:'vision'}),null);
  drafts.failSubmission(first,'connection lost');
  assert.equal(drafts.get('a').draft,'hello');assert.equal(drafts.get('a').attachments[0],image);
  const retry=drafts.beginSubmission('a',{model:'vision'});
  assert.equal(retry.clientMessageId,first.clientMessageId);
  drafts.completeSubmission(retry);
  assert.equal(drafts.get('a').draft,'');assert.deepEqual(drafts.get('a').attachments,[]);
});

test('a late accepted submission does not clear new edits or another conversation',()=>{
  const drafts=store();drafts.updateDraft('a','old');drafts.setAttachments('a',[image]);
  const first=drafts.beginSubmission('a');drafts.updateDraft('a','next draft');
  drafts.updateDraft('b','other draft');drafts.setAttachments('b',[{...image,name:'two.png'}]);
  drafts.completeSubmission(first);
  assert.equal(drafts.get('a').draft,'next draft');assert.equal(drafts.get('b').draft,'other draft');
  assert.equal(drafts.get('b').attachments[0].name,'two.png');
  const next=drafts.beginSubmission('a');assert.notEqual(next.clientMessageId,first.clientMessageId);
});

test('changing request settings after a failure creates a fresh request identity',()=>{
  const drafts=store();drafts.updateDraft('a','hello');const first=drafts.beginSubmission('a',{model:'one'});
  drafts.failSubmission(first,'offline');const second=drafts.beginSubmission('a',{model:'two'});
  assert.notEqual(second.clientMessageId,first.clientMessageId);
});

test('cancelled delayed file reads cannot attach to a re-entered conversation',()=>{
  const drafts=store();drafts.updateDraft('a','kept');const token=drafts.beginRead('a');
  assert.equal(drafts.beginSubmission('a'),null);drafts.cancelRead('a');
  const next=drafts.beginRead('a');assert.equal(drafts.finishRead('a',token,[image]),false);
  assert.equal(drafts.get('a').reading,true);assert.equal(drafts.finishRead('a',next,[image]),true);
  assert.equal(drafts.get('a').draft,'kept');assert.equal(drafts.get('a').attachments.length,1);
});

test('image-only submission is valid and each workspace has an independent draft',()=>{
  const drafts=store();drafts.setAttachments('workspace-a\0same-id',[image]);
  drafts.updateDraft('workspace-b\0same-id','second');
  const request=drafts.beginSubmission('workspace-a\0same-id');assert.ok(request);assert.equal(request.draft,'');
  drafts.completeSubmission(request);assert.equal(drafts.get('workspace-b\0same-id').draft,'second');
});

test('file bytes determine supported MIME and oversize/type errors are specific',async()=>{
  const png=Uint8Array.from([137,80,78,71,13,10,26,10,0]);
  assert.equal(imageMimeFromBytes(png),'image/png');
  const read=await readConversationImages([{name:'test.png',type:'',size:png.length,arrayBuffer:async()=>png.buffer}]);
  assert.equal(read[0].mimeType,'image/png');assert.equal(read[0].size,png.length);
  await assert.rejects(readConversationImages([{name:'fake.png',size:3,arrayBuffer:async()=>Uint8Array.from([1,2,3]).buffer}]),/PNG.*JPEG.*GIF.*WebP/);
  await assert.rejects(readConversationImages([{name:'big.png',size:10*1024*1024+1}]),/10 MB/);
});

test('JPG filename and browser MIME aliases preserve real JPEG bytes and normalize the wire MIME',async()=>{
  const {rasterFixtures}=await import('../../test/fixtures/raster-images.mjs');
  const samples=[{name:'微信图片_1.jpg',type:'',bytes:rasterFixtures.jpeg},{name:'微信图片_2.JPG',type:'image/jpg',bytes:rasterFixtures.progressiveJpeg},{name:'微信图片_3.jpeg',type:'image/pjpeg',bytes:rasterFixtures.jpegWithExifThumbnail}];
  const files=samples.map(sample=>({...sample,size:sample.bytes.length,arrayBuffer:async()=>sample.bytes.buffer.slice(sample.bytes.byteOffset,sample.bytes.byteOffset+sample.bytes.byteLength)}));
  const attachments=JSON.parse(JSON.stringify(await readConversationImages(files)));
  assert.deepEqual(attachments.map(item=>item.name),samples.map(item=>item.name));
  for(let i=0;i<samples.length;i++){
    assert.equal(attachments[i].mimeType,'image/jpeg');
    assert.equal(attachments[i].contentEncoding,'base64');
    assert.equal(attachments[i].size,samples[i].bytes.length);
    assert.deepEqual(Buffer.from(attachments[i].content,'base64'),samples[i].bytes);
  }
});
