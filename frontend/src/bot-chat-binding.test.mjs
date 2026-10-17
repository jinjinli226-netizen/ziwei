import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createConversationComposerStore} from './conversation-compose.js';
import {conversationSettingsSnapshot} from './workdir.js';
const app=await readFile(new URL('./App.vue',import.meta.url),'utf8');
function source(name){const start=app.search(new RegExp(`(?:async )?function ${name}\\(`));assert.ok(start>=0);return app.slice(start,app.indexOf('\n}',start)+2);}
function actual(name,bindings){return new Function(...Object.keys(bindings),`let conversationOpenGeneration=0;return (${source(name)});`)(...Object.values(bindings));}
test('actual Bot message relies on server model and device binding even when generic composer fields are stale',async()=>{
  const composer=createConversationComposerStore(),writes=[],conversation={id:'chat',employee_id:'bot',device_id:'fixed-device',messages:[]};composer.updateDraft('qa\0chat','hello');
  const send=actual('sendConversationMessage',{selectedConversation:{value:conversation},employees:{value:[{id:'bot',runtime:'Hermes',model_id:'fixed-model'}]},conversationDeviceId:{value:'fixed-device'},devices:{value:[]},conversationSettingsSnapshot,botBindingPending:{value:false},conversationBotBinding:{value:{id:'bot'}},conversationModelId:{value:'wrong-override'},conversationWorkingDirectory:{value:''},conversationComposeKey:()=> 'qa\0chat',conversationComposer:composer,api:{addConversationMessage:async(_id,body)=>{writes.push(body);return {id:'msg'};}},refreshSelectedConversation:async()=>{},startConversationPolling:()=>{},notify:()=>{}});
  await send();assert.equal(writes.length,1);assert.equal('model' in writes[0],false);assert.equal('runtime' in writes[0],false);assert.equal('targetDeviceId' in writes[0],false);
});
test('actual Bot device selector cannot rewrite its binding or launch directory inspection',()=>{
  const device={value:'fixed'},notices=[];let inspections=0;
  const select=actual('selectConversationDevice',{conversationDeviceId:device,botBindingPending:{value:false},conversationBotBinding:{value:{id:'bot'}},selectedConversation:{value:{employee_id:'bot'}},notify:message=>notices.push(message),openConversationDirectoryPicker:()=>inspections++});
  select('other');assert.equal(device.value,'fixed');assert.equal(inspections,0);assert.match(notices[0],/已绑定/);
});
test('ordinary employee directory picker opens without requesting a Bot binding again',async()=>{
  const opened={value:false},path={value:''},device={value:{id:'fixed-device',status:'online',workdir:'C:\\owned'}},notices=[];
  const open=actual('openConversationDirectoryPicker',{botBindingPending:{value:false},selectedConversation:{value:{id:'chat',employee_id:'secretary'}},conversationBotBinding:{value:null},workspaceSlug:()=> 'qa',authState:{value:{user:{id:'owner'}}},conversationDirectoryEditorVersion:{value:0},conversationDirectoryPathDraft:path,conversationDirectoryCheck:{value:null},conversationWorkingDirectory:{value:'C:\\chat'},conversationDirectoryPickerOpen:opened,selectedConversationDevice:device,notify:message=>notices.push(message)});
  await open();assert.equal(opened.value,true);assert.equal(path.value,'C:\\chat');assert.equal(device.value.id,'fixed-device');assert.deepEqual(notices,[]);
});
test('directory inspection remains unavailable while employee binding is unresolved',async()=>{
  const opened={value:false},notices=[];const open=actual('openConversationDirectoryPicker',{botBindingPending:{value:true},conversationDirectoryPickerOpen:opened,notify:message=>notices.push(message)});await open();assert.equal(opened.value,false);assert.match(notices[0],/正在读取/);
});
test('failed workspace load cannot authorize prior workspace model and skill options',async()=>{
  const refs=Object.fromEntries([...source('load').matchAll(/(\w+)\.value/g)].map(match=>[match[1],{value:[]}]));
  refs.authState.value={memberships:[{slug:'b',role:'owner'}]};refs.summary.value={workspace:{slug:'a'}};refs.loadedBotOptionsWorkspace.value='a';refs.models.value=[{id:'a-private'}];refs.skills.value=[{id:'a-skill'}];
  const blank={workspace:{slug:'b',preferences:{}},tasks:[],runtimes:[],models:[],skills:[],documents:[],automations:[],members:[],devices:[],employees:[],calendars:[],agents:[]};
  const api=Object.fromEntries(['summary','tasks','runtimes','models','skills','documents','automations','members','devices','employees','calendar','settings','agents'].map(name=>[name,async()=>blank]));api.tasks=async()=>{throw new Error('load failed');};
  const load=new Function(...Object.keys({...refs,api}),`let workspaceLoadGeneration=0;const workspaceSlug=()=> 'b';const notify=()=>{};return (${source('load')});`)(...Object.values({...refs,api}));
  await load();assert.equal(refs.loading.value,false);assert.equal(refs.summary.value.workspace.slug,'b');assert.equal(refs.loadedBotOptionsWorkspace.value,'a');
  assert.match(app,/:models="loadedBotOptionsWorkspace===botWorkspace\?/);assert.match(app,/:skills="loadedBotOptionsWorkspace===botWorkspace\?/);
});

test('actual Bot send keeps three real PNG/JPG attachments ordered and byte-identical through JSON and retry',async()=>{
  const {readConversationImages}=await import('./conversation-compose.js');
  const {rasterFixtures}=await import('../../test/fixtures/raster-images.mjs');
  const source=[['微信图片_1.png',rasterFixtures.png],['微信图片_2.jpg',rasterFixtures.jpeg],['微信图片_3.jpeg',rasterFixtures.jpegWithExifThumbnail]];
  const attachments=await readConversationImages(source.map(([name,bytes])=>({name,type:'',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)})));
  const composer=createConversationComposerStore(),writes=[],conversation={id:'chat',employee_id:'bot',device_id:'fixed-device',messages:[]};composer.updateDraft('qa\0chat','比较这三张图片');composer.setAttachments('qa\0chat',attachments);
  const send=actual('sendConversationMessage',{selectedConversation:{value:conversation},employees:{value:[{id:'bot',runtime:'Hermes'}]},conversationDeviceId:{value:'fixed-device'},devices:{value:[]},conversationSettingsSnapshot,botBindingPending:{value:false},conversationBotBinding:{value:{id:'bot'}},conversationModelId:{value:''},conversationWorkingDirectory:{value:''},conversationComposeKey:()=> 'qa\0chat',conversationComposer:composer,api:{addConversationMessage:async(_id,body)=>{writes.push(JSON.parse(JSON.stringify(body)));if(writes.length===1)throw new Error('retry fixture');return {id:'msg'};}},refreshSelectedConversation:async()=>{},startConversationPolling:()=>{},notify:()=>{}});
  await send();assert.equal(composer.get('qa\0chat').attachments.length,3);await send();assert.equal(writes.length,2);
  assert.equal(writes[0].clientMessageId,writes[1].clientMessageId);
  for(const body of writes){assert.deepEqual(body.attachments.map(item=>item.name),source.map(([name])=>name));for(let i=0;i<source.length;i++)assert.deepEqual(Buffer.from(body.attachments[i].content,'base64'),source[i][1]);}
  assert.equal(composer.get('qa\0chat').attachments.length,0);
});

for(const outcome of ['success','failed','changed-employee','changed-page'])test(`Bot directory opener refreshes its revision: ${outcome}`,async()=>{
  const page={value:'inbox'},path={value:''},opened={value:false},notices=[],binding={value:{id:'bot',revision:1,control_epoch:1}},selected={value:{id:'chat',employee_id:'bot'}};
  let finish;const pending=new Promise(resolve=>{finish=resolve;});
  const open=actual('openConversationDirectoryPicker',{botBindingPending:{value:false},selectedConversation:selected,page,conversationBotBinding:binding,workspaceSlug:()=> 'qa',authState:{value:{user:{id:'owner'}}},refreshBotChatBinding:async(employee,id)=>{assert.equal(employee,'bot');assert.equal(id,'chat');await pending;if(outcome==='failed')return false;binding.value={id:'bot',revision:2,control_epoch:3};return true;},conversationDirectoryEditorVersion:{value:0},conversationDirectoryPathDraft:path,conversationDirectoryCheck:{value:null},conversationWorkingDirectory:{value:'/work'},conversationDirectoryPickerOpen:opened,selectedConversationDevice:{value:{id:'fixed-device',status:'online',workdir:'/device-root'}},notify:message=>notices.push(message)});
  const operation=open({useDeviceDefault:true});assert.equal(opened.value,false);
  if(outcome==='changed-employee')selected.value={id:'secretary-chat',employee_id:'secretary'};
  if(outcome==='changed-page')page.value='bots';
  finish();await operation;
  assert.equal(opened.value,outcome==='success');
  if(outcome==='success'){assert.deepEqual(binding.value,{id:'bot',revision:2,control_epoch:3});assert.equal(path.value,'/device-root');}
  if(outcome==='failed')assert.match(notices[0],/无法读取/);
  if(outcome==='changed-employee')assert.deepEqual(notices,[]);
});
