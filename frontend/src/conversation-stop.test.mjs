import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const app=await readFile(new URL('./App.vue',import.meta.url),'utf8');
const source=app.slice(app.indexOf('async function stopBotChat()'),app.indexOf('async function reconcileBotChat()'));
const ref=value=>({value});
test('the actual App stop eligibility admits only a ready DSH acked action outside managed chats',()=>{
  const expression=app.match(/const conversationCanStop=computed\((.*)\);/)[1];
  const allowed=({runtime='DSH',status='acked',ready=true,managed=false}={})=>new Function('employeeChatView','botChatView','conversationExecutionBusy','conversationBotBinding','conversationExecution','conversationUsesNativeDsh','executionProcessActive','return ('+expression+')()')(ref({ready}),ref({ready:managed}),ref(true),ref(null),ref({id:'original-action',status}),ref(runtime==='DSH'),()=>false);
  assert.equal(allowed(),true);assert.equal(allowed({runtime:'Codex'}),false);assert.equal(allowed({status:'pending'}),false);assert.equal(allowed({status:'failed'}),false);assert.equal(allowed({ready:false}),false);assert.equal(allowed({runtime:'Hermes',managed:true}),true);
});
function setup({runtime='DSH',status='acked',stop}={}){
  const calls=[],notices=[],state={botChatStopBusy:ref(false),botChatReconcileBusy:ref(false),botChatFinalizationBusy:ref(false),botChatView:ref({ready:false}),employeeChatView:ref({ready:true}),conversationUsesNativeDsh:ref(runtime==='DSH'),conversationExecution:ref({id:'original-action',status}),conversationBotBinding:ref(null),selectedConversation:ref({id:'conversation',employee_id:'employee'}),authState:ref({user:{id:'owner'}})};
  const bindings={...state,workspaceSlug:()=> 'team',api:{stopConversationExecution:async(...args)=>{calls.push(['stop',...args]);return stop?stop():{sourceActionId:'original-action',stopRequested:true,stopConfirmed:false,action:{id:'cancel-action',status:'pending'}};}},notify:(...args)=>notices.push(args),refreshConversationState:async options=>calls.push(['refresh',options]),startConversationPolling:()=>calls.push(['poll']),loadBotChatWork:async()=>calls.push(['work'])};
  const run=new Function(...Object.keys(bindings),'let conversationOpenGeneration=1,botChatBindingGeneration=0;return '+source)(...Object.values(bindings));
  return{state,calls,notices,run};
}
test('ordinary DSH stops only its captured original execution through the controlled conversation API',async()=>{
  const h=setup();await h.run();
  assert.deepEqual(h.calls[0],['stop','conversation',{expectedActionId:'original-action'},'team']);
  assert.ok(h.calls.some(call=>call[0]==='refresh'));assert.ok(h.calls.some(call=>call[0]==='poll'));
  assert.match(h.notices[0][0],/等待.*终态/);assert.doesNotMatch(h.notices[0][0],/已停止|已取消/);assert.equal(h.state.botChatStopBusy.value,false);
});
test('ordinary non-DSH and non-acked executions cannot issue cancellation',async()=>{
  for(const input of [{runtime:'Codex'},{status:'pending'},{status:'failed'},{status:'succeeded'}]){const h=setup(input);await h.run();assert.deepEqual(h.calls,[]);}
});
test('a late DSH stop response cannot refresh or notify a different selected conversation',async()=>{
  let resolve;const wait=new Promise(done=>resolve=done),h=setup({stop:()=>wait}),request=h.run();
  h.state.selectedConversation.value={id:'other',employee_id:'other-employee'};resolve({stopRequested:true,stopConfirmed:false});await request;
  assert.deepEqual(h.calls.map(call=>call[0]),['stop']);assert.deepEqual(h.notices,[]);
});
