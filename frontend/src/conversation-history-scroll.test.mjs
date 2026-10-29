import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ref,shallowRef,reactive,watch,nextTick,effectScope} from 'vue';
import * as history from './conversation-history.mjs';

function viewport(){let top=700;return {scrollHeight:1000,clientHeight:300,get scrollTop(){return top;},set scrollTop(value){top=Math.min(Math.max(value,0),this.scrollHeight-this.clientHeight);}};}

test('independent message and event trackers follow within 40px and expose a jump beyond 120px',()=>{
  const messages=history.createConversationScrollTracker(),events=history.createConversationScrollTracker(),node=viewport();
  messages.refresh(node);messages.wheel({deltaY:-1});assert.equal(messages.state.followLatest,false);assert.equal(events.state.followLatest,true);
  node.scrollTop=680;messages.scroll({currentTarget:node});assert.equal(messages.state.followLatest,false);
  node.scrollHeight=1100;messages.refresh(node);assert.equal(node.scrollTop,680);assert.equal(messages.state.showLatest,false);
  node.scrollHeight++;messages.refresh(node);assert.equal(messages.state.showLatest,true);
  messages.jump(node);assert.equal(node.scrollTop,801);assert.equal(messages.state.followLatest,true);assert.equal(messages.state.showLatest,false);
  messages.wheel({deltaY:-1});node.scrollTop=761;messages.scroll({currentTarget:node});assert.equal(messages.state.followLatest,false);
  messages.wheel({deltaY:1});messages.scroll({currentTarget:node});assert.equal(messages.state.followLatest,true);
});

test('touch, keyboard and scrollbar history gestures pause following, and reset releases the old chat state',()=>{
  const tracker=history.createConversationScrollTracker(),node=viewport();tracker.refresh(node);
  tracker.touchStart({touches:[{clientY:100}]});tracker.touchMove({touches:[{clientY:110}]});assert.equal(tracker.state.followLatest,false);
  tracker.reset();tracker.key({key:'PageUp'});assert.equal(tracker.state.followLatest,false);
  tracker.reset();tracker.pointer();node.scrollTop=650;tracker.scroll({currentTarget:node});assert.equal(tracker.state.followLatest,false);
  tracker.pause();node.scrollTop=100;tracker.refresh(node);assert.equal(node.scrollTop,100);assert.equal(tracker.state.showLatest,true);
  tracker.reset();assert.equal(tracker.state.followLatest,true);assert.equal(tracker.state.showLatest,false);
  tracker.refresh(null);tracker.jump(null);
});

test('generic App message and event scroll handlers use separate real trackers and keep the existing history anchor',async()=>{
  const source=await readFile(new URL('./App.vue',import.meta.url),'utf8');
  for(const ref of ['conversationMessages','conversationExecutionList']){
    const node=source.match(new RegExp(`<div ref="${ref}"[^>]*>`))?.[0];assert.ok(node);
    for(const event of ['scroll','wheel.passive','touchstart.passive','touchmove.passive','pointerdown','keydown'])assert.ok(node.includes(`@${event}=`),`${ref} ${event}`);
  }
  assert.match(source,/@click="jumpConversationLatest"[^>]*>跳至最新/);assert.match(source,/@click="jumpConversationEventLatest"[^>]*>跳至最新/);
  const nodes={conversationMessages:{value:viewport()},conversationExecutionList:{value:viewport()}},conversationScroll=history.createConversationScrollTracker(),conversationEventScroll=history.createConversationScrollTracker();
  const names=['scrollConversationMessages','scrollConversationEvents','jumpConversationLatest','jumpConversationEventLatest'];
  const declarations=names.map(name=>{const found=source.match(new RegExp(`function ${name}\\(\\)\\{[^\\n]+\\}`))?.[0];assert.ok(found);return found;}).join('\n');
  const methods=Function('nextTick','conversationScroll','conversationEventScroll',...Object.keys(nodes),`${declarations};return {${names.join(',')}};`)(callback=>Promise.resolve().then(callback),conversationScroll,conversationEventScroll,...Object.values(nodes));
  conversationScroll.pause();nodes.conversationMessages.value.scrollTop=100;await methods.scrollConversationMessages();assert.equal(nodes.conversationMessages.value.scrollTop,100);
  await methods.scrollConversationEvents();assert.equal(nodes.conversationExecutionList.value.scrollTop,700);assert.equal(conversationScroll.state.showLatest,true);
  methods.jumpConversationLatest();assert.equal(nodes.conversationMessages.value.scrollTop,700);
  conversationEventScroll.pause();nodes.conversationExecutionList.value.scrollTop=100;await methods.scrollConversationEvents();assert.equal(nodes.conversationExecutionList.value.scrollTop,100);
  methods.jumpConversationEventLatest();assert.equal(nodes.conversationExecutionList.value.scrollTop,700);
  assert.match(source,/node\.scrollTop=top\+node\.scrollHeight-height/);
});

test('actual generic scroll watchers pause before a history prepend and reset for a different conversation',async()=>{
  const source=await readFile(new URL('./App.vue',import.meta.url),'utf8'),scope=effectScope();
  const node=viewport(),selectedConversation=ref({id:'a',messages:[{id:'current'}]}),conversationExecution=ref({id:'action-a'});
  const conversationScroll=history.createConversationScrollTracker({wrap:reactive}),conversationEventScroll=history.createConversationScrollTracker({wrap:reactive});
  const bindings={watch,nextTick,selectedConversation,conversationExecution,conversationScroll,conversationEventScroll,conversationMessages:shallowRef(node),conversationExecutionList:shallowRef(viewport())};
  const names=['scrollConversationMessages','scrollConversationEvents'];
  const methods=names.map(name=>source.match(new RegExp(`function ${name}\\(\\)\\{[^\\n]+\\}`))[0]).join('\n');
  const start=source.indexOf('watch(()=>[selectedConversation.value?.id,selectedConversation.value?.messages]'),end=source.indexOf('watch(taskDetail',start);
  assert.ok(start>=0&&end>start);
  scope.run(()=>Function(...Object.keys(bindings),methods+source.slice(start,end))(...Object.values(bindings)));
  try{
    conversationScroll.refresh(node);node.scrollHeight=1600;
    selectedConversation.value={id:'a',messages:[{id:'older'},{id:'current'}]};
    await nextTick();await nextTick();assert.equal(conversationScroll.state.followLatest,false);assert.equal(node.scrollTop,700);
    node.scrollTop=1300; // The existing prepend loader restores the retained message here.
    conversationScroll.refresh(node);assert.equal(node.scrollTop,1300);
    conversationEventScroll.pause();selectedConversation.value={id:'b',messages:[{id:'other'}]};conversationExecution.value={id:'action-b'};
    await nextTick();await nextTick();assert.equal(conversationScroll.state.followLatest,true);assert.equal(conversationScroll.state.showLatest,false);assert.equal(conversationEventScroll.state.followLatest,true);
  }finally{scope.stop();}
});
