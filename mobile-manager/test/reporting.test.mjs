import test from 'node:test';
import assert from 'node:assert/strict';
import {createReporting,buildReportSummary,reportSources} from '../web/reporting.js';
import {initialState} from '../web/model.js';

function fixture({empty=false,failRead=false,drop=false}={}) {
  const memory=new Map(),calls=[],runs=[],messages=[];
  let count=0;
  const storage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
  const state={...initialState(),user:{user_id:'user-a'},workspace:{slug:'team-a'},phase:'ready',employees:[{id:'a',name:'员工甲',runtime:'Hermes',bot:{configuration_state:'initialized'}},{id:'b',name:'员工乙',runtime:'Hermes',bot:{configuration_state:'initialized'}}]};
  const api={
    getEmployeeConversation:async(_w,e)=>({id:`conv-${e.id}`,employee_id:e.id,messages:[]}),
    tasks:async()=>{if(failRead)throw new Error('资料读取失败');return {tasks:empty?[]:['a','b'].map(assignee=>({id:`task-${assignee}`,assignee,title:'真实任务',state:'in_progress'}))};},
    botRuns:async()=>({runs}),
    conversation:async cid=>({id:cid,employee_id:cid.slice(5),messages,execution:null}),
    sendMessage:async(cid,body)=>{calls.push({cid,body});const msg={id:`m-${calls.length}`,role:'user',content:body.content,attachments:body.attachments};messages.push(msg);const run={id:`run-${calls.length}`,type:'conversation.execute',status:'acked',payload:{messageId:msg.id,prompt:body.content}};runs.push(run);if(drop)throw new Error('回执丢失');return {...msg,execution:run};},
  };
  const reporting=createReporting({api,storage,uuid:()=>`id-${++count}`,clock:()=>Date.UTC(2026,9,16,12)});
  return {state,api,storage,memory,calls,runs,messages,reporting};
}
test('only current employee is dispatched, explicit next waits for exact receipt',async()=>{
  const f=fixture();await f.reporting.start(f.state,['a','b']);assert.equal(f.calls.length,1);assert.equal(f.calls[0].cid,'conv-a');
  await assert.rejects(f.reporting.next(f.state),/等待/);assert.equal(f.calls.length,1);
  f.runs.push({id:'unrelated',type:'conversation.execute',status:'succeeded',result:{output:'别人的完成'}});await f.reporting.refresh(f.state);
  assert.equal(f.state.report.queue[0].status,'waiting');assert.equal(f.state.messages.some(m=>m.content==='别人的完成'),false);
  Object.assign(f.runs[0],{status:'succeeded',result:{output:'真实汇报：任务仍在执行'},completed_at:'2026-10-16T12:01:00Z'});await f.reporting.refresh(f.state);
  assert.equal(f.state.report.queue[0].status,'completed');assert.equal(f.state.messages.at(-1).content,'真实汇报：任务仍在执行');
  await f.reporting.next(f.state);assert.equal(f.calls.length,2);assert.equal(f.calls[1].cid,'conv-b');
});
test('lost POST response restores and reads exact request without resending',async()=>{
  const f=fixture({drop:true});await assert.rejects(f.reporting.start(f.state,['a']),/回执丢失/);
  const restored=f.reporting.restore({userId:'user-a',workspace:'team-a'});assert.equal(restored.queue[0].status,'delivery_unknown');
  f.state.report=restored;await f.reporting.refresh(f.state);assert.equal(f.state.report.queue[0].turns[0].actionId,'run-1');assert.equal(f.calls.length,1);
  Object.assign(f.runs[0],{status:'succeeded',result:{output:'原执行的汇报'}});await f.reporting.refresh(f.state);assert.equal(f.state.report.queue[0].status,'completed');assert.equal(f.calls.length,1);
  assert.equal(f.reporting.restore({userId:'user-b',workspace:'team-a'}),null);assert.equal(f.reporting.restore({userId:'user-a',workspace:'team-b'}),null);
});
test('no sources is reported honestly and does not invoke an employee',async()=>{
  const f=fixture({empty:true});await f.reporting.start(f.state,['a']);assert.equal(f.calls.length,0);assert.equal(f.state.report.queue[0].reportText,'暂无记录');
  await f.reporting.next(f.state);assert.equal(f.state.page,'report-summary');assert.equal(f.state.report.summary.items[0].text,'暂无记录');
});
test('failed data fetch is not interpreted as no records or a completed report',async()=>{
  const f=fixture({failRead:true});await assert.rejects(f.reporting.start(f.state,['a']),/资料读取失败/);assert.equal(f.calls.length,0);assert.equal(f.state.report.queue[0].status,'failed');assert.notEqual(f.state.report.queue[0].reportText,'暂无记录');
});
test('workspace switch during source read cannot dispatch into the new scope',async()=>{
  const f=fixture();let resolve;f.api.getEmployeeConversation=()=>new Promise(r=>resolve=r);
  const pending=f.reporting.start(f.state,['a']);f.state.workspace={slug:'team-b'};resolve({id:'conv-a',employee_id:'a'});await pending;assert.equal(f.calls.length,0);
});
test('a pending follow-up cannot be marked complete by the previous turn',async()=>{
  const f=fixture();await f.reporting.start(f.state,['a']);Object.assign(f.runs[0],{status:'succeeded',result:{output:'第一轮汇报'}});await f.reporting.refresh(f.state);
  await f.reporting.ask(f.state,'卡点是什么？');await f.reporting.refresh(f.state);assert.equal(f.state.report.queue[0].status,'waiting');await assert.rejects(f.reporting.next(f.state),/等待/);
});
test('persistence must succeed before dispatching a new reporting request',async()=>{
  const f=fixture();f.storage.setItem=()=>{throw new Error('存储空间不足');};await assert.rejects(f.reporting.start(f.state,['a']),/存储空间不足/);assert.equal(f.calls.length,0);
});
test('summary keeps evidence and does not invent work or convert proposed followups',()=>{
  const summary=buildReportSummary({queue:[{employeeId:'a',name:'甲',status:'failed',error:'离线',sources:[{kind:'task',id:'t',title:'上传',status:'blocked'}]}]});
  assert.equal(summary.items[0].text,'离线');assert.equal(summary.todos[0].sourceId,'t');assert.equal(summary.todos[0].status,'proposed');
  const sources=reportSources({id:'a',name:'甲'},{tasks:[{id:'b',assignee:'b',title:'别的员工'}]},{runs:[{id:'report',type:'conversation.execute',payload:{prompt:'[紫薇汇报:s]'},status:'succeeded'}]},null);assert.deepEqual(sources,[]);
});
test('interrupted source preparation resumes the selected employee',async()=>{
  const f=fixture();f.reporting.select(f.state,['a']);Object.assign(f.state.report,{status:'active'});f.state.report.queue[0].status='loading';
  const memoryKey='ziwei.manager.report.v1:user-a:team-a';f.storage.setItem(memoryKey,JSON.stringify(f.state.report));
  f.state.report=f.reporting.restore({userId:'user-a',workspace:'team-a'});f.state.page='report';await f.reporting.refresh(f.state);
  assert.equal(f.calls.length,1);assert.equal(f.state.report.queue[0].status,'waiting');
});
test('ordinary employee reads the original receipt when desktop starts a newer action',async()=>{
  const f=fixture();f.state.employees[0].runtime='Codex';delete f.state.employees[0].bot;
  await f.reporting.start(f.state,['a']);const original=f.calls[0].body;let recovered=0;
  f.api.conversation=async()=>({id:'conv-a',employee_id:'a',messages:f.messages,execution:{id:'new-desktop-action',status:'acked'}});
  f.api.sendMessage=async(cid,body)=>{assert.equal(cid,'conv-a');assert.deepEqual(body,original);recovered++;return {id:'m-1',duplicate:true,execution:{id:'run-1',status:'succeeded',result:{output:'原汇报结果'}}};};
  await f.reporting.refresh(f.state);assert.equal(recovered,1);assert.equal(f.state.report.queue[0].reportText,'原汇报结果');assert.equal(f.calls.length,1);
});
test('report photos persist metadata without exceeding a small resume quota',async()=>{
  const f=fixture();await f.reporting.start(f.state,['a']);Object.assign(f.runs[0],{status:'succeeded',result:{output:'原汇报'}});await f.reporting.refresh(f.state);
  const originalSet=f.storage.setItem;f.storage.setItem=(k,v)=>{assert.ok(v.length<10000);originalSet(k,v);};
  await f.reporting.ask(f.state,'看看这张图',[{name:'photo.png',mimeType:'image/png',size:4*1024*1024,content:'A'.repeat(6*1024*1024),contentEncoding:'base64'}]);
  const restored=f.reporting.restore({userId:'user-a',workspace:'team-a'});assert.equal(restored.queue[0].turns[1].attachments[0].content,undefined);assert.equal(f.calls.length,2);
  f.state.report=restored;await f.reporting.refresh(f.state);assert.equal(f.state.report.queue[0].turns[1].attachments[0].content.length,6*1024*1024);
});
test('failure saving a photo turn rolls back sending state before any request',async()=>{
  const f=fixture();await f.reporting.start(f.state,['a']);Object.assign(f.runs[0],{status:'succeeded',result:{output:'原汇报'}});await f.reporting.refresh(f.state);
  f.storage.setItem=()=>{throw new Error('quota');};await assert.rejects(f.reporting.ask(f.state,'追问'),/quota/);assert.equal(f.state.report.queue[0].status,'completed');assert.equal(f.state.report.queue[0].turns.length,1);assert.equal(f.calls.length,1);
});
test('leaving and reopening summary cannot duplicate a task creation in flight',async()=>{
  const f=fixture({empty:true});await f.reporting.start(f.state,['a']);f.reporting.finish(f.state);
  f.state.report.summary.todos=[{employeeId:'a',name:'甲',text:'计划事项',status:'proposed'}];let resolve,writes=0;f.api.createTask=()=>{writes++;return new Promise(r=>resolve=r);};
  const first=f.reporting.createTodo(f.state,0);f.state.page='home';f.state.page='report-summary';await f.reporting.createTodo(f.state,0);assert.equal(writes,1);resolve({id:'task-created'});await first;assert.equal(f.state.report.summary.todos[0].taskId,'task-created');
});
