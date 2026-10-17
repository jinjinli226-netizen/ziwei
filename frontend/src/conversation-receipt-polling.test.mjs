import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {executionNeedsPolling,executionPresentation} from './conversation-execution-state.mjs';

const source=readFileSync(new URL('./App.vue',import.meta.url),'utf8');
const start=source.indexOf('function startConversationPolling() {');
const pollingSource=source.slice(start,source.indexOf('\n}',start)+2);
const unknown={id:'original',status:'failed',result:{code:'EXECUTION_UNCERTAIN',executionState:'uncertain'}};
const confirmed={id:'original',status:'failed',result:{code:'executor_failed',processExit:{rootConfirmed:true,treeConfirmed:true,activeProcesses:0}}};

function fixture(refresh) {
  const execution={value:unknown},selected={value:{id:'original-conversation'}},page={value:'inbox'},timers=new Map();
  let now=100000,serial=0,reads=0;
  const create=new Function('selectedConversation','page','conversationExecution','conversationExecutionBusy','executionNeedsPolling','refreshConversationState','setInterval','clearInterval','Date',`
    let conversationPollTimer=null,conversationOpenGeneration=1;
    function stopConversationPolling(){if(conversationPollTimer){clearInterval(conversationPollTimer);conversationPollTimer=null;}}
    ${pollingSource}
    return {start:startConversationPolling,stop:stopConversationPolling,current:()=>conversationPollTimer,changeGeneration:()=>conversationOpenGeneration++};
  `);
  const controller=create(selected,page,execution,{get value(){return executionPresentation(execution.value).busy;}},executionNeedsPolling,
    async()=>{reads++;await refresh(execution);},callback=>{const id=++serial;timers.set(id,callback);return id;},id=>timers.delete(id),{now:()=>now});
  return {...controller,execution,selected,page,timers,get reads(){return reads;},async tick(elapsed=1500){now+=elapsed;await timers.get(controller.current())?.();}};
}

test('uncertain receipts continue GET polling and accept a late definitive result without replay',async()=>{
  let received=false;
  const f=fixture(async execution=>{if(received)execution.value=confirmed;});
  f.start();await f.tick();
  assert.equal(f.reads,1);assert.equal(f.timers.size,1);
  assert.equal(executionPresentation(f.execution.value).busy,false);
  assert.equal(executionPresentation(f.execution.value).retryable,false);
  await f.tick();assert.equal(f.reads,1,'unresolved receipt reads back off');
  received=true;await f.tick(4500);
  assert.equal(f.reads,2);assert.equal(f.execution.value,confirmed);
  assert.equal(f.timers.size,0,'definitive receipt ends fallback polling');
});

test('only pending or unconfirmed receipts need polling; a known failure does not',()=>{
  for(const value of [unknown,{status:'expired',acked_at:'2026-10-17T00:00:00Z'},{status:'pending'},{status:'acked'}])assert.equal(executionNeedsPolling(value),true);
  for(const value of [null,undefined,confirmed,{status:'succeeded'},{status:'expired'},{status:'cancelled'}])assert.equal(executionNeedsPolling(value),false);
});

test('leaving the conversation stops receipt polling without another request',async()=>{
  const f=fixture(async()=>assert.fail('must not read a departed conversation'));
  f.start();f.page.value='bots';await f.tick();assert.equal(f.timers.size,0);assert.equal(f.reads,0);
});

test('an old response cannot stop the new conversation polling timer',async()=>{
  let resolve;
  const pending=new Promise(done=>{resolve=done;}),f=fixture(async()=>pending);
  f.start();const first=f.tick(),old=f.current();
  f.changeGeneration();f.start();assert.notEqual(f.current(),old);
  f.execution.value=confirmed;resolve();await first;
  assert.equal(f.timers.size,1,'only the new request scope owns its timer');
  f.stop();assert.equal(f.timers.size,0);
});
