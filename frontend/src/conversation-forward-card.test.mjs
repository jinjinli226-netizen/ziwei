import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse,compileScript,compileTemplate} from '@vue/compiler-sfc';
import {isConversationForward,conversationForwardMessages,conversationForwardSummary,forwardMessageTime} from './conversation-forward-card.mjs';

const image={name:'截图.jpg',mimeType:'image/jpeg',content:'YWJj',contentEncoding:'base64'};
const fixture=()=>({schemaVersion:1,id:'forward-1',source:{conversationId:'conversation-1',employeeId:'employee-1',employeeName:'闲鱼运营大神'},mode:'reference',messages:[
  {sourceMessageId:'message-1',role:'user',senderName:'小李',createdAt:'2026-10-17T00:05:06.000Z',content:'请看看这张图。',attachments:[image]},
  {sourceMessageId:'message-2',role:'assistant',senderName:'闲鱼运营大神',createdAt:'2026-10-17T00:06:00.000Z',content:'第一行\n第二行',attachments:[]},
  {sourceMessageId:'message-3',role:'user',senderName:'小李',createdAt:'2026-10-17T00:07:00.000Z',content:'继续。',attachments:[]},
]});

test('valid forward uses original names, full local date/time and the same attachment objects',()=>{
  const value=fixture();assert.equal(isConversationForward(value),true);
  const rows=conversationForwardMessages(value);
  assert.equal(rows.length,3);assert.equal(rows[0].senderName,'小李');assert.equal(rows[1].senderName,'闲鱼运营大神');
  assert.equal(rows[0].time,'2026/10/17 08:05');assert.equal(rows[0].createdAt,'2026-10-17T00:05:06.000Z');
  assert.equal(rows[1].content,'第一行\n第二行');assert.equal(rows[0].attachments[0],image);
  value.mode='execute';assert.equal(isConversationForward(value),true);
});

test('collapsed preview contains only the first two plain-text summaries and the total count',()=>{
  const preview=conversationForwardSummary(fixture());
  assert.equal(preview.sourceName,'闲鱼运营大神');assert.equal(preview.count,3);
  assert.deepEqual(preview.lines,[{senderName:'小李',text:'请看看这张图。'},{senderName:'闲鱼运营大神',text:'第一行 第二行'}]);
});

test('image-only and long unicode messages have compact summaries without losing full content',()=>{
  const value=fixture();value.messages[0].content='';value.messages[1].content='😀'.repeat(80);
  const summary=conversationForwardSummary(value);assert.equal(summary.lines[0].text,'[图片 × 1]');assert.equal(summary.lines[1].text,'😀'.repeat(70)+'…');
  assert.equal(conversationForwardMessages(value)[1].content,'😀'.repeat(80));
});

test('legacy missing employee identity, sender name and date retain safe display fallbacks',()=>{
  const value=fixture();value.source.employeeId=null;value.source.employeeName=null;
  value.messages[0].senderName='';value.messages[0].createdAt=null;
  value.messages[1].senderName=undefined;value.messages[1].createdAt='not a date';
  assert.equal(isConversationForward(value),true);
  const rows=conversationForwardMessages(value);assert.equal(rows[0].senderName,'用户');assert.equal(rows[1].senderName,'数字员工');
  assert.equal(rows[0].time,'');assert.equal(rows[1].createdAt,'');assert.equal(conversationForwardSummary(value).sourceName,'数字员工');
  assert.equal(forwardMessageTime(null),'');assert.equal(forwardMessageTime('bad date'),'');
});

test('unknown versions and malformed records decline card rendering for ordinary content fallback',()=>{
  const invalid=[null,[],{}, {...fixture(),schemaVersion:2},{...fixture(),mode:'other'},{...fixture(),source:null},{...fixture(),source:{conversationId:3}},
    {...fixture(),messages:[]},{...fixture(),messages:Array.from({length:21},()=>fixture().messages[0])},
    {...fixture(),messages:[null]}, {...fixture(),messages:[{...fixture().messages[0],role:'unknown'}]},
    {...fixture(),messages:[{...fixture().messages[0],content:{html:'unsafe'}}]},
    {...fixture(),messages:[{...fixture().messages[0],attachments:[null]}]},
    {...fixture(),messages:[{...fixture().messages[0],attachments:[{name:{html:'unsafe'}}]}]},
  ];
  for(const value of invalid){assert.equal(isConversationForward(value),false);assert.deepEqual(conversationForwardMessages(value),[]);assert.deepEqual(conversationForwardSummary(value),{sourceName:'',count:0,lines:[]});}
});

test('untrusted markup remains text and the Vue template only interpolates it',async()=>{
  const value=fixture();value.messages[0].content='<img src=x onerror="alert(1)">';value.messages[0].senderName='<script>bad()</script>';
  assert.equal(conversationForwardMessages(value)[0].content,value.messages[0].content);
  const file=await readFile(new URL('./components/ConversationForwardCard.vue',import.meta.url),'utf8');
  const {descriptor,errors}=parse(file);assert.deepEqual(errors,[]);
  const script=compileScript(descriptor,{id:'forward-card'});
  const template=compileTemplate({source:descriptor.template.content,filename:'ConversationForwardCard.vue',id:'forward-card',compilerOptions:{bindingMetadata:script.bindings}});
  assert.deepEqual(template.errors,[]);assert.equal(/v-html|innerHTML/.test(file),false);
  assert.match(template.code,/toDisplayString\(message\.content\)/);
});
