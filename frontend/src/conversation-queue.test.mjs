import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse,compileScript,compileTemplate} from '@vue/compiler-sfc';
import * as vue from 'vue';
import {renderToString} from 'vue/server-renderer';
import {conversationQueueStatusLabel} from './conversation-queue.js';
import {createConversationComposerStore} from './conversation-compose.js';
import {conversationSettingsSnapshot} from './workdir.js';

async function component(name) {
  const filename=new URL(`./components/${name}.vue`,import.meta.url),source=await readFile(filename,'utf8');
  const {descriptor,errors}=parse(source);assert.deepEqual(errors,[]);
  const script=compileScript(descriptor,{id:name}),template=compileTemplate({id:name,filename:filename.pathname,source:descriptor.template.content,compilerOptions:{bindingMetadata:script.bindings}});assert.deepEqual(template.errors,[]);
  const bindings={};
  async function evaluate(source) {
    let code=source;
    for(const match of [...code.matchAll(/^import (.*?) from ['"]([^'"]+)['"];?\r?$/gm)]) {
      const names=match[1],specifier=match[2],value=specifier==='vue'?vue:specifier.endsWith('.vue')?{default:specifier.endsWith('ConversationQueuePanel.vue')?await component('ConversationQueuePanel'):{render:()=>null}}:await import(specifier.startsWith('.')?new URL(specifier,filename).href:specifier);
      if(names.startsWith('{'))for(const token of names.slice(1,-1).split(',')){const [name,alias]=token.trim().split(/\s+as\s+/);bindings[alias||name]=value[name];}
      else bindings[names]=value.default;
      code=code.replace(match[0],'');
    }
    return new Function(...Object.keys(bindings),code.replace('export default','return').replace('export function render','return function render'))(...Object.values(bindings));
  }
  const result=await evaluate(script.content);result.render=await evaluate(template.code);return result;
}
const panel=await component('ConversationQueuePanel'),chat=await component('BotMainChat');
const app=await readFile(new URL('./App.vue',import.meta.url),'utf8');

test('actual queue panel shows attachments, escapes message text, and preserves the paused empty state',async()=>{
  const html=await renderToString(vue.createSSRApp(panel,{queue:{count:1,paused:false,items:[{id:'action',content:'<b>first</b>',attachments:[{name:'image.png'}]}]}}));
  assert.match(html,/待发 1 条/);assert.match(html,/&lt;b&gt;first&lt;\/b&gt;/);assert.match(html,/1 个附件/);assert.match(html,/暂停待发/);
  const paused=await renderToString(vue.createSSRApp(panel,{queue:{count:0,paused:true,items:[]}}));assert.match(paused,/继续发送/);assert.match(paused,/已暂停/);
  assert.doesNotMatch(await renderToString(vue.createSSRApp(panel,{queue:{count:0,paused:false,items:[]}})),/<section/);
});

test('queue panel tolerates a partial queue projection without losing queue controls',async()=>{
  const html=await renderToString(vue.createSSRApp(panel,{queue:{count:1,paused:false}}));
  assert.match(html,/待发 1 条/);
  assert.match(html,/暂停待发/);
});

test('actual main chat keeps a queue send control beside stop while the current action is running',async()=>{
  const html=await renderToString(vue.createSSRApp(chat,{bot:{id:'bot-a',employee:{name:'Fixture',runtime:'Codex'}},conversation:{id:'chat-a',messages:[],queue:{count:1,paused:false,items:[{id:'next',content:'next'}]}},execution:{id:'active',status:'acked'},canStop:true,draft:'second'}));
  assert.match(html,/aria-label="请求停止当前执行"/);assert.match(html,/aria-label="加入队列"/);assert.match(html,/Enter 加入队列/);
});

test('main chat tolerates a partial queue projection while preserving the send control',async()=>{
  const html=await renderToString(vue.createSSRApp(chat,{bot:{id:'bot-a',employee:{name:'Fixture',runtime:'Codex'}},conversation:{id:'chat-a',messages:[],queue:{count:1,paused:false}},execution:{id:'active',status:'acked'},canStop:true,draft:'second'}));
  assert.match(html,/aria-label="加入队列"/);
  assert.match(html,/待发 1 条/);
});

function queueController(bindings) {
  const start=app.indexOf('async function updateConversationQueue('),end=app.indexOf('\n}',start);assert.ok(start>=0);
  return new Function(...Object.keys(bindings),`let conversationOpenGeneration=0,conversationQueueRequest=0;return Object.assign((${app.slice(start,end+2)}),{advanceGeneration(){conversationOpenGeneration++;}});`)(...Object.values(bindings));
}
function queueFixture(api) {
  const selected={value:{id:'a',queue:{count:2,paused:false,items:[{id:'one'},{id:'two'}]}}},busy={value:false},error={value:''},scope={value:'workspace/person/a'},calls=[];
  const run=queueController({selectedConversation:selected,conversationQueueScope:scope,conversationQueueBusy:busy,conversationQueueError:error,api,refreshSelectedConversation:async()=>calls.push('refresh'),startConversationPolling:()=>calls.push('poll')});
  return {run,selected,busy,error,scope,calls};
}

test('actual pause, resume and remove use queue APIs without sending cancellation controls',async()=>{
  const requested=[],h=queueFixture({pauseConversationQueue:async id=>{requested.push(['pause',id]);return {queue:{count:2,paused:true,items:[]}};},resumeConversationQueue:async id=>{requested.push(['resume',id]);return {queue:{count:2,paused:false,items:[]}};},removeConversationQueueItem:async(id,item)=>{requested.push(['remove',id,item]);return {queue:{count:1,paused:false,items:[]}};}});
  await h.run('pause');assert.equal(h.selected.value.queue.paused,true);await h.run('resume');await h.run('remove',{id:'two'});
  assert.deepEqual(requested,[['pause','a'],['resume','a'],['remove','a','two']]);assert.equal(h.selected.value.queue.count,1);assert.equal(h.busy.value,false);assert.equal(h.calls.filter(value=>value==='refresh').length,3);
});

test('a late queue response cannot overwrite a different conversation or its operation state',async()=>{
  let accept;const h=queueFixture({pauseConversationQueue:()=>new Promise(resolve=>accept=resolve)}),pending=h.run('pause');
  h.selected.value={id:'b',queue:{count:7,paused:false,items:[]}};h.scope.value='workspace/person/b';h.busy.value=false;h.error.value='B error';
  accept({queue:{count:2,paused:true,items:[]}});assert.equal(await pending,false);assert.equal(h.selected.value.queue.count,7);assert.equal(h.busy.value,false);assert.equal(h.error.value,'B error');assert.deepEqual(h.calls,[]);
});

test('ACK winning a remove request leaves the waiting queue visible and displays the conflict',async()=>{
  const h=queueFixture({removeConversationQueueItem:async()=>{throw new Error('消息已开始执行，不能移除');}});assert.equal(await h.run('remove',{id:'one'}),false);assert.equal(h.selected.value.queue.count,2);assert.match(h.error.value,/不能移除/);assert.equal(h.busy.value,false);
});

test('failed navigation retaining the current conversation cannot leave queue controls permanently busy',async()=>{
  let accept;const h=queueFixture({pauseConversationQueue:()=>new Promise(resolve=>accept=resolve)}),pending=h.run('pause');
  h.run.advanceGeneration();accept({queue:{count:2,paused:true,items:[]}});assert.equal(await pending,false);
  assert.equal(h.selected.value.id,'a');assert.equal(h.selected.value.queue.paused,false);assert.equal(h.busy.value,false);
});

test('accepting a queued message preserves the current execution until the canonical detail is refreshed',async()=>{
  const start=app.indexOf('async function sendConversationMessage('),end=app.indexOf('\n}',start),composer=createConversationComposerStore(),selected={value:{id:'a',employee_id:'employee',messages:[],execution:{id:'current',status:'acked'}}},notices=[];
  const key=()=> 'qa\0a';composer.updateDraft(key(),'second');
  const bindings={selectedConversation:selected,employees:{value:[{id:'employee',runtime:'Codex'}]},conversationComposeKey:key,conversationComposer:composer,conversationModelId:{value:''},conversationWorkingDirectory:{value:''},conversationDeviceId:{value:''},conversationSettingsSnapshot,devices:{value:[]},botBindingPending:{value:false},botBindingError:{value:''},conversationBotBinding:{value:null},api:{addConversationMessage:async()=>({id:'message-2',content:'second',queue_status:'queued',queue:{count:1,paused:false,items:[]},execution:{id:'waiting',status:'pending'}})},applyConversationDetail:()=>assert.fail('queued execution must not replace current'),refreshSelectedConversation:async()=>assert.equal(selected.value.execution.id,'current'),startConversationPolling:()=>{},notify:message=>notices.push(message)};
  const send=new Function(...Object.keys(bindings),`let conversationSettingsBaseline=null;let conversationOpenGeneration=0;return (${app.slice(start,end+2)});`)(...Object.values(bindings));await send();
  assert.equal(selected.value.messages[0].id,'message-2');assert.equal(selected.value.queue.count,1);assert.equal(composer.get(key()).draft,'');assert.match(notices[0],/加入队列/);assert.equal(conversationQueueStatusLabel('cancelled'),'已移出待发');
});
