import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createConversationComposerStore} from './conversation-compose.js';
import {conversationSettingsSnapshot} from './workdir.js';
const app=await readFile(new URL('./App.vue',import.meta.url),'utf8');
function actual(name,bindings){const start=app.indexOf(`async function ${name}(`),end=app.indexOf('\n}',start);assert.ok(start>=0);const context={conversationSettingsSnapshot,devices:{value:[]},botBindingPending:{value:false},conversationBotBinding:{value:null},...bindings};return new Function(...Object.keys(context),`let conversationSettingsBaseline=null;let conversationOpenGeneration=0;return (${app.slice(start,end+2)});`)(...Object.values(context));}

test('actual retry edit cannot overwrite an attachment read already in progress',()=>{
  const composer=createConversationComposerStore(),key='qa\0a',notices=[];
  const start=app.indexOf('function restoreConversationMessage('),end=app.indexOf('\n}',start);
  const retry=new Function('conversationComposeKey','conversationSendPending','conversationComposer','notify',`return (${app.slice(start,end+2)});`)(()=>key,{value:false},composer,message=>notices.push(message));
  const token=composer.beginRead(key);retry({content:'original',attachments:[{name:'original.png'}]});
  assert.equal(composer.get(key).draft,'');assert.deepEqual(composer.get(key).attachments,[]);assert.match(notices[0],/正在读取/);
  assert.equal(composer.finishRead(key,token,[{name:'new.png'}]),true);assert.equal(composer.get(key).attachments[0].name,'new.png');
});

test('actual UI submit retains new conversation and new draft when an earlier response finishes',async()=>{
  const composer=createConversationComposerStore({makeId:()=> 'one'}),selected={value:{id:'a',employee_id:'employee',device_id:'qa-device',messages:[]}},notifications=[];
  composer.updateDraft('qa\0a','A content');let accept,requests=0,refreshes=0;
  const deferred=new Promise(resolve=>accept=resolve);
  const key=()=>`qa\0${selected.value.id}`;
  const send=actual('sendConversationMessage',{selectedConversation:selected,employees:{value:[{id:'employee',runtime:'Codex'}]},conversationComposeKey:key,conversationComposer:composer,conversationModelId:{value:'vision'},conversationWorkingDirectory:{value:'C:/qa'},conversationDeviceId:{value:'qa-device'},api:{addConversationMessage:()=>{requests++;return deferred;}},refreshSelectedConversation:async()=>refreshes++,startConversationPolling:()=>{},notify:message=>notifications.push(message)});
  const first=send();await send();assert.equal(requests,1);
  selected.value={id:'b',employee_id:'employee',messages:[]};composer.updateDraft('qa\0b','B draft');
  accept({id:'a-message',content:'A content'});await first;
  assert.equal(selected.value.id,'b');assert.deepEqual(selected.value.messages,[]);
  assert.equal(composer.get('qa\0b').draft,'B draft');assert.equal(refreshes,0);assert.deepEqual(notifications,[]);
});

test('actual UI handles network retry with one client ID and preserves edits made while sending',async()=>{
  const composer=createConversationComposerStore(),selected={value:{id:'a',employee_id:'employee',messages:[]}};
  composer.updateDraft('qa\0a','kept');const bodies=[];let accept;
  const key=()=> 'qa\0a';
  const send=actual('sendConversationMessage',{selectedConversation:selected,employees:{value:[{id:'employee',runtime:'Codex'}]},conversationComposeKey:key,conversationComposer:composer,conversationModelId:{value:''},conversationWorkingDirectory:{value:''},conversationDeviceId:{value:''},api:{addConversationMessage:async(id,body)=>{bodies.push(body);if(bodies.length===1)throw new Error('offline');return new Promise(resolve=>accept=resolve);}},refreshSelectedConversation:async()=>{},startConversationPolling:()=>{},notify:()=>{}});
  await send();assert.equal(composer.get(key()).draft,'kept');assert.match(composer.get(key()).error,/offline/);
  const retry=send();composer.updateDraft(key(),'next draft');accept({id:'saved'});await retry;
  assert.equal(bodies[0].clientMessageId,bodies[1].clientMessageId);assert.equal(composer.get(key()).draft,'next draft');
});
