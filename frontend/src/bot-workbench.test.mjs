import test from 'node:test';
import assert from 'node:assert/strict';
const module = await import('./bot-workbench.js').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
const bot = (id='a',revision=1) => ({id,workspace:'qa',revision,employee:{id,name:id,runtime:'Hermes'},config:{provider:null,toolsets:[],maxTurns:20,memory:{enabled:true,userProfile:true},skills:{disabled:[]},mcpServers:{},permissions:{mode:'read_only'}},control_state:'draft',validation:{status:'not_checked'},capabilities:[],main_conversation_id:`chat-${id}`});
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
function fixture(overrides={}) {let current=bot();const calls=[];const api={bots:async()=>({bots:[current]}),bot:async()=>current,botRuns:async()=>({runs:[]}),botRoutines:async()=>({routines:[]}),updateBot:async(id,body,ws)=>{calls.push({id,body,ws});current={...current,revision:2,employee:{...current.employee,...body.employee},config:body.config};return current;},controlBot:async()=>current,...overrides};return {...module.createBotWorkbench({api}),calls};}

test('new editor defaults enable the shared builtin tools without sharing mutable configuration',()=>{
  const first=module.defaultBotConfig(),second=module.defaultBotConfig();
  assert.equal(first.permissions.mode,'execute');assert.deepEqual(first.toolsets,['web','browser','file','terminal','vision','skills','todo','memory','session_search','code_execution','ziwei_autonomy']);
  first.toolsets.length=0;first.memory.enabled=false;assert.equal(second.toolsets.length,11);assert.equal(second.memory.enabled,true);
});
test('loading and saving an existing readonly empty-tool draft never fills new creation defaults',async()=>{
  const ui=fixture();await ui.setWorkspace('qa','a');assert.equal(ui.state.draft.config.permissions.mode,'read_only');assert.deepEqual(ui.state.draft.config.toolsets,[]);
  ui.state.draft.employee.name='Existing employee';await ui.refresh();assert.equal(ui.state.draft.employee.name,'Existing employee');assert.deepEqual(ui.state.draft.config.toolsets,[]);
  assert.equal(await ui.save(),true);assert.equal(ui.calls[0].body.config.permissions.mode,'read_only');assert.deepEqual(ui.calls[0].body.config.toolsets,[]);
});

test('Bot save verifies persisted readback and keeps complete config with expected revision',async()=>{
  const ui=fixture();await ui.setWorkspace('qa','a');ui.state.draft.employee.name='Updated';
  assert.equal(await ui.save(),true);
  assert.equal(ui.calls[0].body.expectedRevision,1);
  assert.equal(ui.calls[0].ws,'qa');assert.equal(ui.state.bot.revision,2);
  assert.equal(ui.state.draft.employee.name,'Updated');assert.equal(ui.state.notice,'配置已保存。');
});
test('a late Bot read or save cannot replace another selected Bot',async()=>{
  const pending=deferred();let count=0;
  const ui=fixture({bot:async id=>++count===1?pending.promise:bot(id)});
  const old=ui.setWorkspace('qa','a');await new Promise(resolve=>setImmediate(resolve));await ui.select('b');pending.resolve(bot('a'));await old;
  assert.equal(ui.state.bot.id,'b');
  const saving=deferred();const second=fixture({updateBot:()=>saving.promise,bot:async id=>bot(id)});
  await second.setWorkspace('qa','a');const save=second.save();await second.select('b');saving.resolve(bot('a',2));await save;
  assert.equal(second.state.bot.id,'b');assert.equal(second.state.notice,'');
});
test('409 never retries, overwrites draft or silently advances its base revision',async()=>{
  let writes=0;const ui=fixture({updateBot:async()=>{writes++;throw Object.assign(new Error('conflict'),{status:409});}});
  await ui.setWorkspace('qa','a');ui.state.draft.employee.name='My draft';assert.equal(await ui.save(),false);
  assert.equal(writes,1);assert.equal(ui.state.draft.employee.name,'My draft');assert.equal(ui.state.draft.revision,1);assert.equal(ui.state.conflict,true);
});
test('unknown writes block another mutation until a successful fresh read',async()=>{
  let writes=0;const ui=fixture({updateBot:async()=>{writes++;throw new TypeError('network');}});
  await ui.setWorkspace('qa','a');await ui.save();assert.equal(ui.state.writeUnknown,true);
  await ui.save();assert.equal(writes,1);
  await ui.refresh();assert.equal(ui.state.writeUnknown,false);
});
test('stop acceptance is shown as pending confirmation and does not invent cancelled status',async()=>{
  const ui=fixture({controlBot:async()=>({...bot(),control_state:'paused',latest_run:{id:'run',status:'acked'}})});
  await ui.setWorkspace('qa','a');await ui.control('stop');
  assert.match(ui.state.notice,/停止.*确认|确认.*停止/);assert.notEqual(ui.state.bot.latest_run?.status,'cancelled');
  assert.doesNotMatch(ui.state.notice,/已受理|正在核对/);
});

const recoveryRun=()=>({id:'original',type:'hermes.bot.validate',status:'expired',acked_at:'2026-10-14T00:00:00Z',events:[{id:'stored-terminal',type:'succeeded',data:{result:{validated:true,processExit:{rootConfirmed:true,treeConfirmed:true,activeProcesses:0}}}}]});
test('receipt recovery uses only the stored event identity and current revision, then refreshes without dispatching work',async()=>{
  let current={...bot(),control_epoch:3,latest_run:recoveryRun()},runs=[current.latest_run];const calls=[];
  const ui=fixture({bot:async()=>current,botRuns:async()=>({runs}),reconcileBotAction:async(id,actionId,body,workspace)=>{calls.push({id,actionId,body,workspace});current={...current,validation:{status:'succeeded'},latest_run:{...runs[0],status:'succeeded'}};runs=[current.latest_run];return current;}});
  await ui.setWorkspace('qa','a');ui.state.draft.employee.name='Keep draft';
  assert.equal(await ui.reconcile(ui.state.runs[0]),true);
  assert.deepEqual(calls,[{id:'a',actionId:'original',body:{eventId:'stored-terminal',expectedRevision:1,expectedControlEpoch:3},workspace:'qa'}]);
  assert.equal(ui.state.runs[0].status,'succeeded');assert.equal(ui.state.bot.validation.status,'succeeded');assert.equal(ui.state.draft.employee.name,'Keep draft');assert.match(ui.state.notice,/服务端已核实并恢复/);
});

test('missing recovery proof never submits an invented terminal result',async()=>{
  let calls=0;const uncertain={...recoveryRun(),events:[]};
  const ui=fixture({botRuns:async()=>({runs:[uncertain]}),reconcileBotAction:async()=>{calls++;}});
  await ui.setWorkspace('qa','a');assert.equal(await ui.reconcile(uncertain),false);assert.equal(calls,0);
});

test('recovery conflict refreshes current state and preserves error and draft without retrying',async()=>{
  let current={...bot(),control_epoch:3},calls=0;
  const ui=fixture({bot:async()=>current,botRuns:async()=>({runs:[recoveryRun()]}),reconcileBotAction:async()=>{calls++;current={...current,control_epoch:4};throw Object.assign(new Error('控制状态已变化'),{status:409,code:'BOT_CONTROL_CONFLICT'});}});
  await ui.setWorkspace('qa','a');ui.state.draft.employee.name='Keep draft';
  assert.equal(await ui.reconcile(ui.state.runs[0]),false);assert.equal(calls,1);assert.equal(ui.state.bot.control_epoch,4);assert.match(ui.state.error,/控制状态已变化/);assert.equal(ui.state.draft.employee.name,'Keep draft');
});

test('a delayed receipt recovery cannot change another selected Bot',async()=>{
  const delayed=deferred();const ui=fixture({bot:async id=>bot(id),botRuns:async()=>({runs:[recoveryRun()]}),reconcileBotAction:()=>delayed.promise});
  await ui.setWorkspace('qa','a');const recovery=ui.reconcile(ui.state.runs[0]);await ui.select('b');delayed.resolve(bot('a'));assert.equal(await recovery,false);assert.equal(ui.state.bot.id,'b');assert.equal(ui.state.notice,'');
});

test('normal deletion preserves a busy employee and force removal clears the shared Bot selection without claiming stopped',async()=>{
  const calls=[];const ui=fixture({deleteEmployee:async(id,workspace,options)=>{calls.push({id,workspace,options});if(!options.force)throw Object.assign(new Error('原执行未结束'),{status:409,code:'BOT_BUSY'});return {deleted:true,forced:true,executionConfirmedStopped:false,retained:{profile:true,home:true}};}});
  await ui.setWorkspace('qa','a');ui.state.draft.employee.name='Kept draft';assert.equal(await ui.removeEmployee(),false);
  assert.equal(ui.state.bot.id,'a');assert.equal(ui.state.selectedId,'a');assert.equal(ui.state.errorCode,'BOT_BUSY');assert.equal(ui.state.draft.employee.name,'Kept draft');assert.equal(calls.length,1);
  assert.equal(await ui.removeEmployee({force:true}),true);assert.deepEqual(calls[1],{id:'a',workspace:'qa',options:{force:true}});assert.equal(ui.state.bot,null);assert.equal(ui.state.selectedId,'');assert.deepEqual(ui.state.bots,[]);assert.match(ui.state.notice,/禁止新任务.*保留.*停止状态未确认/);assert.doesNotMatch(ui.state.notice,/进程已停止/);
});

test('ordinary deletion keeps its existing request and clears the employee without forcing',async()=>{
  const calls=[];const ui=fixture({deleteEmployee:async(...args)=>{calls.push(args);return {deleted:true};}});await ui.setWorkspace('qa','a');assert.equal(await ui.removeEmployee(),true);assert.deepEqual(calls,[['a','qa',{}]]);assert.equal(ui.state.bot,null);assert.equal(ui.state.notice,'数字员工已删除。');
});

test('a late deletion response cannot clear a newly selected Bot',async()=>{
  const delayed=deferred();const ui=fixture({bot:async id=>bot(id),deleteEmployee:()=>delayed.promise});await ui.setWorkspace('qa','a');const removal=ui.removeEmployee({force:true});await ui.select('b');delayed.resolve({deleted:true,forced:true,executionConfirmedStopped:false});assert.equal(await removal,false);assert.equal(ui.state.bot.id,'b');assert.equal(ui.state.selectedId,'b');assert.equal(ui.state.notice,'');
});
test('Bot status distinguishes execution uncertainty from ordinary failure and device availability',()=>{
  assert.equal(module.botPresence({...bot(),latest_run:{status:'failed',result:{code:'EXECUTION_UNCERTAIN'}}}).label,'上次执行失败');
  assert.equal(module.executionUncertain({status:'failed',result:{code:'EXECUTION_UNCERTAIN'}}),true,'失败文字不能伪造业务已确认');
  assert.match(module.botPresence({...bot(),control_state:'active',latest_run:null}).label,/待命/);
  assert.equal(module.capabilityPresentation({status:'not_integrated'}).tone,'muted');
  assert.notEqual(module.capabilityPresentation({status:'unexpected'}).tone,'success');
});
test('a read started before saving cannot roll the confirmed revision back',async()=>{
  const delayed=deferred();let reads=0;
  const ui=fixture({bot:async()=>{reads++;return reads===2?delayed.promise:bot('a',reads>=3?2:1);}});
  await ui.setWorkspace('qa','a');const refresh=ui.refresh();await ui.save();delayed.resolve(bot('a',1));await refresh;
  assert.equal(ui.state.bot.revision,2);
});
test('reselecting the same Bot during a write does not unlock a second write or discard edits',async()=>{
  const delayed=deferred();let writes=0;
  const ui=fixture({updateBot:async()=>{writes++;return delayed.promise;}});
  await ui.setWorkspace('qa','a');ui.state.draft.employee.name='Keep me';const save=ui.save();await ui.select('a');
  assert.equal(ui.state.busy,true);assert.equal(ui.state.draft.employee.name,'Keep me');await ui.save();assert.equal(writes,1);
  delayed.resolve(bot('a'));await save;
});
test('unknown Routine run retains its original key through readback and explicit recovery',async()=>{
  const keys=[];let runs=0;const ui=fixture({runBotRoutine:async(_id,_routine,body)=>{keys.push(body.idempotencyKey);if(++runs===1)throw new TypeError('lost response');return {id:'original-run',action_id:'original-action'};}});
  await ui.setWorkspace('qa','a');await ui.runRoutine('routine-1');assert.equal(ui.state.writeUnknown,true);
  await ui.refresh();assert.equal(ui.state.writeUnknown,true,'Bot GET cannot prove an unknown run was accepted');
  await ui.runRoutine('routine-1');assert.equal(keys.length,1);
  await ui.recoverRoutine();assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);assert.equal(ui.state.writeUnknown,false);
});
test('initializing an existing Hermes employee preserves its ID and avoids querying absent Bot records',async()=>{
  let current={...bot(),configuration_state:'uninitialized',revision:0},recordReads=0,initializations=0;
  const ui=fixture({bot:async()=>current,conversation:async()=>({device_id:null}),botRuns:async()=>{recordReads++;return {runs:[]};},botRoutines:async()=>{recordReads++;return {routines:[]};},initializeEmployeeBot:async(id)=>{initializations++;assert.equal(id,'a');current={...bot(),revision:1};return current;}});
  await ui.setWorkspace('qa','a');assert.equal(recordReads,0);
  assert.equal(await ui.initialize(),true);assert.equal(initializations,1);assert.equal(ui.state.bot.id,'a');assert.equal(ui.state.bot.revision,1);
});
test('existing employee initialization preserves the server atomic conversation conflict without silently rebinding',async()=>{
  let writes=0;const current={...bot(),configuration_state:'uninitialized',employee:{...bot().employee,target_device_id:'device-a'}};
  const ui=fixture({bot:async()=>current,initializeEmployeeBot:async()=>{writes++;throw Object.assign(new Error('现有主聊天模型或电脑与员工绑定不一致'),{status:409,code:'BOT_CONVERSATION_CONFLICT'});}});
  await ui.setWorkspace('qa','a');assert.equal(await ui.initialize(),false);assert.equal(writes,1);assert.equal(ui.state.busy,false);assert.equal(ui.state.writeUnknown,false);assert.match(ui.state.error,/模型或电脑.*不一致/);assert.equal(ui.state.bot.configuration_state,'uninitialized');
});
test('a late initialization response cannot replace another selected employee',async()=>{
  const delayed=deferred();let writes=0;const current={...bot(),configuration_state:'uninitialized'};
  const ui=fixture({bot:async id=>id==='a'?current:bot(id),initializeEmployeeBot:async()=>{writes++;return delayed.promise;}});
  await ui.setWorkspace('qa','a');const initialization=ui.initialize();await ui.select('b');delayed.resolve(bot('a'));assert.equal(await initialization,false);assert.equal(writes,1);assert.equal(ui.state.bot.id,'b');
});
