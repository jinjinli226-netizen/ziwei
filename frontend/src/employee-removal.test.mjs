import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {canForceRemoveEmployee,employeeRemovalPrompt,employeeRemovalNotice,forceEmployeeRemovalDetail} from './employee-removal.js';

test('force removal is offered for uncertain work or the explicit BOT_BUSY rejection',()=>{
  assert.equal(canForceRemoveEmployee({latest_run:{status:'expired',acked_at:'2026-10-14'}}),true);
  assert.equal(canForceRemoveEmployee({latest_run:{status:'failed',result:{code:'EXECUTION_UNCERTAIN'}}}),true);
  assert.equal(canForceRemoveEmployee(null,'BOT_BUSY'),true);
  assert.equal(canForceRemoveEmployee({latest_run:{status:'succeeded'}},'FORBIDDEN'),false);
  const prompt=employeeRemovalPrompt({id:'a',name:'Hermes 测试'},true);assert.match(prompt,/强制移除员工“Herme[s] 测试”/);assert.match(prompt,/禁止新任务.*历史执行回执.*Profile.*HOME.*不代表.*进程已停止/);
  assert.match(employeeRemovalNotice({deleted:true,forced:true,executionConfirmedStopped:false}),/停止状态未确认/);
});

const source=await readFile(new URL('./App.vue',import.meta.url),'utf8');
function harness(api,confirm=()=>true){
  const keys=['employeeRemovalBusy','employeeRemovalBlocked','authState','employees','employeeBots','botRouteId','employeeRouteId','employeeEditId','showEmployee','conversationEmployeeId','selectedConversation','conversationExecution','conversationRouteId','conversationDraft','conversationBotBinding','conversationBotId','botBindingPending'];
  const refs=Object.fromEntries(keys.map(key=>[key,{value:''}]));Object.assign(refs,{authState:{value:{user:{id:'owner'}}},employees:{value:[{id:'a'},{id:'b'}]},employeeBots:{value:[{id:'a'},{id:'b'}]}});
  refs.botRouteId.value='a';refs.employeeRouteId.value='a';refs.conversationEmployeeId.value='a';refs.selectedConversation.value={id:'main-a',employee_id:'a'};refs.conversationBotBinding.value={id:'a'};
  let slug='qa',confirmations=[],notices=[],loads=0,stops=0;
  const bindings={...refs,api,window:{confirm:message=>{confirmations.push(message);return confirm(message);}},workspaceSlug:()=>slug,employeeRemovalPrompt,employeeRemovalNotice,forceEmployeeRemovalDetail,load:async()=>loads++,notify:(...args)=>notices.push(args),clearConversationAttachment:()=>{},stopConversationPolling:()=>stops++};
  const start=source.indexOf('async function removeEmployee(employee,'),end=source.indexOf('\n}',start);assert.ok(start>=0);
  const remove=new Function(...Object.keys(bindings),`let conversationOpenGeneration=0,botChatBindingGeneration=0;return (${source.slice(start,end+2)});`)(...Object.values(bindings));
  return {refs,remove,confirmations,notices,setWorkspace:value=>slug=value,get loads(){return loads;},get stops(){return stops;}};
}

test('actual team removal requires an explicit force click after BOT_BUSY and synchronizes employee/Bot selections',async()=>{
  const calls=[];const ui=harness({deleteEmployee:async(...args)=>{calls.push(args);if(!args[2].force)throw Object.assign(new Error('busy'),{status:409,code:'BOT_BUSY'});return {deleted:true,forced:true,executionConfirmedStopped:false};}});
  await ui.remove({id:'a',name:'Hermes 测试'});assert.equal(calls.length,1);assert.equal(ui.refs.employeeRemovalBlocked.value,'qa\0a');assert.equal(ui.refs.employees.value.length,2);
  await ui.remove({id:'a',name:'Hermes 测试'},true);assert.deepEqual(calls,[['a','qa',{}],['a','qa',{force:true}]]);assert.equal(ui.confirmations.length,2);assert.match(ui.confirmations[1],/不代表.*进程已停止/);
  assert.deepEqual(ui.refs.employees.value.map(row=>row.id),['b']);assert.deepEqual(ui.refs.employeeBots.value.map(row=>row.id),['b']);assert.equal(ui.refs.botRouteId.value,'');assert.equal(ui.refs.employeeRouteId.value,'');assert.equal(ui.refs.conversationEmployeeId.value,'b');assert.equal(ui.refs.selectedConversation.value,null);assert.equal(ui.refs.conversationBotBinding.value,null);assert.equal(ui.stops,1);assert.equal(ui.loads,1);assert.match(ui.notices.at(-1)[0],/停止状态未确认/);
});

test('cancelling the one product confirmation issues no force request',async()=>{
  let calls=0;const ui=harness({deleteEmployee:async()=>calls++},()=>false);await ui.remove({id:'a'},true);assert.equal(calls,0);assert.equal(ui.confirmations.length,1);assert.equal(ui.loads,0);
});

test('a late deletion response cannot clear another workspace employee or Bot selection',async()=>{
  let resolve;const ui=harness({deleteEmployee:()=>new Promise(done=>resolve=done)});const pending=ui.remove({id:'a'},true);ui.setWorkspace('other');resolve({deleted:true,forced:true,executionConfirmedStopped:false});await pending;assert.equal(ui.refs.botRouteId.value,'a');assert.equal(ui.refs.employees.value.length,2);assert.equal(ui.loads,0);assert.deepEqual(ui.notices,[]);
});
