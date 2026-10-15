import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {clipboardImageFiles,createConversationComposerStore,readConversationImages,CONVERSATION_IMAGE_LIMIT} from './conversation-compose.js';

const app=await readFile(new URL('./App.vue',import.meta.url),'utf8');
const bytes=Uint8Array.from([137,80,78,71,13,10,26,10,0]);
const png=(name='clipboard.png',read=async()=>bytes.buffer)=>({name,type:'image/png',size:bytes.length,arrayBuffer:read});
function source(name){const match=new RegExp(`(?:async )?function ${name}\\(`).exec(app);assert.ok(match,name);return app.slice(match.index,app.indexOf('\n}',match.index)+2);}
function fixture(runtime='Codex'){
  let key='workspace\0one';const composer=createConversationComposerStore(),notices=[];
  const bindings={conversationComposeKey:()=>key,conversationComposer:composer,employees:{value:[{id:'employee',runtime}]},selectedConversation:{value:{id:'one',employee_id:'employee'}},notify:(message)=>notices.push(message),clipboardImageFiles,readConversationImages,CONVERSATION_IMAGE_LIMIT};
  const handlers=new Function(...Object.keys(bindings),`${source('addConversationImages')}\n${source('handleConversationPaste')}\n${source('handleConversationAttachment')}\nreturn {paste:handleConversationPaste,pick:handleConversationAttachment};`)(...Object.values(bindings));
  return {composer,notices,...handlers,key:()=>key,switchTo(next){composer.cancelRead(key);key=next;}};
}
function event(files=[],text=''){
  return {prevented:false,preventDefault(){this.prevented=true;},clipboardData:{items:[...files.map(file=>({kind:'file',type:file.type,getAsFile:()=>file})),...(text?[{kind:'string',type:'text/plain'}]:[])],files,getData:()=>text}};
}

test('clipboard extraction prefers image items once and ignores text, HTML and non-image files',()=>{
  const file=png(),data=event([file],'copied text').clipboardData;
  assert.deepEqual(clipboardImageFiles(data),[file]);
  assert.deepEqual(clipboardImageFiles({items:[{kind:'string',type:'text/html'}],files:[{type:'application/pdf',name:'not-an-image.pdf'}]}),[]);
  assert.deepEqual(clipboardImageFiles({files:[{...file,type:''}]}),[{...file,type:''}]);
  assert.deepEqual(clipboardImageFiles({items:[{kind:'file',type:'image/png',getAsFile:()=>null}],files:[file]}),[file]);
  assert.deepEqual(clipboardImageFiles(null),[]);
});

test('actual paste preserves text-only browser behavior and appends one image without changing the draft',async()=>{
  const f=fixture();f.composer.updateDraft(f.key(),'keep this draft');
  const text=event([],'plain text');await f.paste(text);assert.equal(text.prevented,false);
  const image=event([png()],'https://example.invalid/copied-image');await f.paste(image);
  assert.equal(image.prevented,true);assert.equal(f.composer.get(f.key()).draft,'keep this draft');
  assert.equal(f.composer.get(f.key()).attachments.length,1);assert.equal(f.composer.get(f.key()).attachments[0].mimeType,'image/png');
  await f.pick({target:{files:[png('picked.png')],value:'selected'}});
  assert.deepEqual(f.composer.get(f.key()).attachments.map(x=>x.name),['clipboard.png','picked.png']);
});

test('busy paste cannot replace the active read or an in-flight submission',async()=>{
  const f=fixture();let resolve;
  const pending=f.paste(event([png('first.png',()=>new Promise(done=>resolve=done))]));
  await f.paste(event([png('second.png')]));assert.match(f.notices.at(-1),/正在读取/);
  resolve(bytes.buffer);await pending;assert.equal(f.composer.get(f.key()).attachments[0].name,'first.png');
  const submission=f.composer.beginSubmission(f.key());await f.paste(event([png('third.png')]));
  assert.match(f.notices.at(-1),/正在发送/);assert.equal(f.composer.get(f.key()).attachments.length,1);
  f.composer.completeSubmission(submission);assert.equal(f.composer.get(f.key()).attachments.length,0);
});

test('a delayed pasted image is cancelled on conversation switch and cannot leak into another employee draft',async()=>{
  const f=fixture();let resolve;
  const pending=f.paste(event([png('old.png',()=>new Promise(done=>resolve=done))]));
  f.switchTo('other-workspace\0two');f.composer.updateDraft(f.key(),'new employee draft');
  await f.paste(event([png('new.png')]));resolve(bytes.buffer);await pending;
  assert.deepEqual(f.composer.get('workspace\0one').attachments,[]);
  assert.equal(f.composer.get(f.key()).draft,'new employee draft');
  assert.deepEqual(f.composer.get(f.key()).attachments.map(x=>x.name),['new.png']);
});

test('Hermes preserves simultaneous and accumulated images in one ordered submission',async()=>{
  const f=fixture('Hermes');f.composer.updateDraft(f.key(),'compare all original images');
  const first=Uint8Array.from([...bytes,1]),second=Uint8Array.from([...bytes,2]),third=Uint8Array.from([...bytes,3]);
  await f.paste(event([png('first.png',async()=>first.buffer),png('second.png',async()=>second.buffer)],'ignored alongside images'));
  await f.pick({target:{files:[png('third.png',async()=>third.buffer)],value:'selected'}});
  const submission=f.composer.beginSubmission(f.key());assert.equal(submission.draft,'compare all original images');
  assert.deepEqual(submission.attachments.map(x=>x.name),['first.png','second.png','third.png']);
  assert.deepEqual(submission.attachments.map(x=>x.content),[first,second,third].map(value=>btoa(String.fromCharCode(...value))));
});

test('invalid, oversized and excess pastes retain existing attachments for both runtimes',async()=>{
  for(const runtime of ['Hermes','Codex'])for(const scenario of ['invalid','size','count']){
    const f=fixture(runtime);await f.paste(event([png('kept.png')]));
    let incoming=png('rejected.png');
    if(scenario==='invalid')incoming=png('fake.png',async()=>Uint8Array.from([1,2,3]).buffer);
    if(scenario==='size')incoming={...incoming,size:CONVERSATION_IMAGE_LIMIT};
    await f.paste(event(scenario==='count'?Array.from({length:20},()=>incoming):[incoming]));
    assert.deepEqual(f.composer.get(f.key()).attachments.map(x=>x.name),['kept.png']);
    assert.match(f.composer.get(f.key()).error,scenario==='invalid'?/PNG/:scenario==='size'?/10 MB/:/20 张/);
  }
});
