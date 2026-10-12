import test from 'node:test';
import assert from 'node:assert/strict';
const module = await import('./bot-workbench.js').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
const bot = (id='a',revision=1) => ({id,workspace:'qa',revision,employee:{id,name:id,runtime:'Hermes'},config:{provider:null,toolsets:[],maxTurns:20,memory:{enabled:true,userProfile:true},skills:{disabled:[]},mcpServers:{},permissions:{mode:'read_only'}},control_state:'draft',validation:{status:'not_checked'},capabilities:[],main_conversation_id:`chat-${id}`});
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
function fixture(overrides={}) {let current=bot();const calls=[];const api={bots:async()=>({bots:[current]}),bot:async()=>current,botRuns:async()=>({runs:[]}),botRoutines:async()=>({routines:[]}),updateBot:async(id,body,ws)=>{calls.push({id,body,ws});current={...current,revision:2,employee:{...current.employee,...body.employee},config:body.config};return current;},controlBot:async()=>current,...overrides};return {...module.createBotWorkbench({api}),calls};}

test('Bot save verifies persisted readback and keeps complete config with expected revision',async()=>{
  const ui=fixture();await ui.setWorkspace('qa','a');ui.state.draft.employee.name='Updated';
  assert.equal(await ui.save(),true);
  assert.equal(ui.calls[0].body.expectedRevision,1);
  assert.equal(ui.calls[0].ws,'qa');assert.equal(ui.state.bot.revision,2);
  assert.equal(ui.state.draft.employee.name,'Updated');assert.match(ui.state.notice,/读回/);
});
test('a late Bot read or save cannot replace another selected Bot',async()=>{
  const pending=deferred();let count=0;
  const ui=fixture({bot:async id=>++count===1?pending.promise:bot(id)});
  const old=ui.setWorkspace('qa','a');await ui.select('b');pending.resolve(bot('a'));await old;
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
});
test('Bot status distinguishes execution uncertainty from ordinary failure and device availability',()=>{
  assert.match(module.botPresence({...bot(),latest_run:{status:'failed',result:{code:'EXECUTION_UNCERTAIN'}}}).label,/待核实/);
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
