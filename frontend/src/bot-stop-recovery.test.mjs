import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {botStopPresentation,botRecoveryEvent} from './bot-presentation.js';

const source=await readFile(new URL('./App.vue',import.meta.url),'utf8');
const run=()=>({id:'original',status:'expired',acked_at:'2026-10-14T00:00:00Z',events:[{id:'stored-event',type:'succeeded',data:{result:{processExit:{rootConfirmed:true,treeConfirmed:true,activeProcesses:0}}}}]});
function harness(overrides={}){
  const bot={id:'bot',workspace:'qa',employee:{id:'bot'},main_conversation_id:'main',revision:4,control_epoch:2,control_state:'paused',latest_run:run()},notices=[],refreshes=[],writes=[];
  const state={botChatStopBusy:{value:false},botChatReconcileBusy:{value:false},botChatView:{value:{ready:true}},conversationExecution:{value:bot.latest_run},conversationBotBinding:{value:bot},selectedConversation:{value:{id:'main'}},authState:{value:{user:{id:'owner'}}}};
  const bindings={...state,botBindingPending:{value:false},botStopPresentation,botRecoveryEvent,workspaceSlug:()=> 'qa',api:{bot:async()=>bot,controlBot:async(...args)=>{writes.push(args);return bot;},reconcileBotAction:async(...args)=>{writes.push(args);return bot;},...overrides},notify:(...args)=>notices.push(args),refreshConversationState:async options=>refreshes.push(options),startConversationPolling:()=>{},loadBotChatWork:async()=>{}};
  function actual(name){const start=source.indexOf(`async function ${name}(`),end=source.indexOf('\n}',start);assert.ok(start>=0);return new Function(...Object.keys(bindings),`let conversationOpenGeneration=0,botChatBindingGeneration=0;return (${source.slice(start,end+2)});`)(...Object.values(bindings));}
  return {state,bot,notices,refreshes,writes,stop:actual('stopBotChat'),reconcile:actual('reconcileBotChat')};
}

test('actual main chat stop does not claim an HTTP 200 created a cancel or confirmed exit',async()=>{
  const ui=harness();await ui.stop();
  assert.equal(ui.writes.length,1);assert.deepEqual(ui.writes[0],['bot',{operation:'stop',expectedRevision:4,expectedControlEpoch:2},'qa']);
  assert.match(ui.notices[0][0],/未返回.*停止请求或退出确认/);assert.doesNotMatch(ui.notices[0][0],/已受理|正在核对/);assert.deepEqual(ui.refreshes,[{force:true}]);assert.equal(ui.state.conversationExecution.value.status,'expired');
});

test('actual main chat recovery sends the stored event identity without client supplied terminal data',async()=>{
  const ui=harness();await ui.reconcile();
  assert.deepEqual(ui.writes,[['bot','original',{eventId:'stored-event',expectedRevision:4,expectedControlEpoch:2},'qa']]);assert.deepEqual(ui.refreshes,[{force:true}]);assert.match(ui.notices[0][0],/服务端已核实/);assert.equal(ui.state.botChatReconcileBusy.value,false);
});

test('actual main chat recovery without proof does not query or mutate the Bot',async()=>{
  let reads=0;const ui=harness({bot:async()=>{reads++;}});ui.state.conversationExecution.value={...run(),events:[]};await ui.reconcile();assert.equal(reads,0);assert.deepEqual(ui.writes,[]);assert.deepEqual(ui.notices,[]);
});

test('actual main chat conflict refreshes the latest binding once without retrying recovery',async()=>{
  let calls=0,reads=0;const bot={id:'bot',workspace:'qa',employee:{id:'bot'},main_conversation_id:'main',revision:4,control_epoch:3};
  const ui=harness({bot:async()=>{reads++;return bot;},reconcileBotAction:async()=>{calls++;throw Object.assign(new Error('控制版本冲突'),{status:409});}});
  await ui.reconcile();assert.equal(calls,1);assert.equal(reads,2);assert.equal(ui.state.conversationBotBinding.value.control_epoch,3);assert.deepEqual(ui.refreshes,[{force:true}]);assert.deepEqual(ui.notices,[['控制版本冲突','error']]);
});

test('actual main chat ignores a recovery response after switching to another Bot',async()=>{
  let resolve;const ui=harness({reconcileBotAction:()=>new Promise(done=>resolve=done)});
  const pending=ui.reconcile();await new Promise(done=>setImmediate(done));ui.state.selectedConversation.value={id:'other-main'};ui.state.conversationBotBinding.value={id:'other'};resolve(ui.bot);await pending;
  assert.equal(ui.state.conversationBotBinding.value.id,'other');assert.deepEqual(ui.refreshes,[]);assert.deepEqual(ui.notices,[]);
});
