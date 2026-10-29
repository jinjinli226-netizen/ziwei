import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from '@vue/compiler-sfc';
import * as composer from './conversation-compose.js';

const app=await readFile(new URL('./App.vue',import.meta.url),'utf8');

test('the generic composer routes keydown and composition events through its own IME guard',()=>{
  const {descriptor}=parse(app),template=descriptor.template.content;
  const textarea=template.match(/<textarea\b[^>]*v-model="conversationDraft"[^>]*>/)?.[0];
  assert.ok(textarea);assert.match(textarea,/@keydown="conversationKeydown"/);
  assert.match(textarea,/@compositionstart="conversationEnterGuard.compositionStart"/);
  assert.match(textarea,/@compositionend="conversationEnterGuard.compositionEnd"/);
  assert.doesNotMatch(textarea,/@keydown\.enter/);
  let now=1000,sent=0,prevented=0;
  const declaration=descriptor.scriptSetup.content.match(/const conversationEnterGuard=createConversationEnterGuard\(\);/)?.[0];
  const handler=descriptor.scriptSetup.content.match(/function conversationKeydown\(event\)\{[^\n]+\}/)?.[0];
  assert.ok(declaration);assert.ok(handler);
  const ui=Function('createConversationEnterGuard','sendConversationMessage',`${declaration}${handler};return {guard:conversationEnterGuard,keydown:conversationKeydown};`)(()=>composer.createConversationEnterGuard({now:()=>now}),()=>sent++);
  const enter=patch=>ui.keydown({key:'Enter',preventDefault(){prevented++;},...patch});
  enter({isComposing:true});enter({keyCode:229});ui.guard.compositionStart();enter();assert.equal(sent,0);
  ui.guard.compositionEnd();now=1499;enter();assert.equal(sent,0);now=1500;enter({shiftKey:true});assert.equal(sent,0);
  enter();assert.equal(sent,1);assert.equal(prevented,2);
});
