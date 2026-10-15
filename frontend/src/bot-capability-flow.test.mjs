import test from 'node:test';
import assert from 'node:assert/strict';
import {createBotWorkbench} from './bot-workbench.js';

function fixture({controlState='active',check='succeeded',onWait=null,updateFailure=false,badReadback=false,activateFailure=false,newerReadback=false}={}){
  let current={id:'a',workspace:'qa',revision:1,control_epoch:4,control_state:controlState,employee:{id:'a',name:'A',runtime:'Hermes'},config:{provider:null,toolsets:[],maxTurns:20,memory:{enabled:false,userProfile:true},skills:{disabled:[]},mcpServers:{},permissions:{mode:'read_only'}},validation:{status:'succeeded',revision:1}},waits=0;
  const calls=[];
  const api={bots:async()=>({bots:[current]}),bot:async id=>id==='a'?current:{...current,id,employee:{...current.employee,id}},botRuns:async()=>({runs:[]}),botRoutines:async()=>({routines:[]}),
    updateBot:async(id,body,workspace)=>{calls.push({kind:'save',id,body,workspace});if(updateFailure)throw Object.assign(new Error('配置已变化'),{status:409,code:'BOT_REVISION_CONFLICT'});current={...current,revision:2,control_epoch:5,control_state:'draft',config:badReadback?current.config:body.config,validation:{status:'stale'}};const saved=current;if(newerReadback)current={...current,revision:3,control_epoch:6};return saved;},
    validateBot:async(id,body,workspace)=>{calls.push({kind:'check',id,body,workspace});current={...current,validation:{status:'pending',revision:current.revision}};return {action:{id:'validation',status:'pending'}};},
    controlBot:async(id,body,workspace)=>{calls.push({kind:'activate',id,body,workspace});if(activateFailure)throw Object.assign(new Error('Bot 已被暂停'),{status:409,code:'BOT_CONTROL_CONFLICT'});assert.equal(body.expectedRevision,current.revision);assert.equal(body.expectedControlEpoch,current.control_epoch);current={...current,control_state:'active',control_epoch:current.control_epoch+1};return current;},
  };
  const state={get current(){return current;},setCurrent:value=>current=value,calls,get waits(){return waits;}};
  const ui=createBotWorkbench({api,capabilityCheckAttempts:2,wait:async()=>{waits++;if(onWait){await onWait({...state,ui});return;}if(check!=='pending')current={...current,validation:{status:check,revision:current.revision,...(check==='failed'?{error:'模型凭证无效'}:{})}};}});
  return {...ui,...state};
}

test('one enable saves, checks and restores only a previously active Bot at the saved revision and epoch',async()=>{
  const ui=fixture();await ui.setWorkspace('qa','a');assert.equal(await ui.enableCapability('memory'),true);
  assert.deepEqual(ui.calls.map(call=>call.kind),['save','check','activate']);assert.equal(ui.calls[0].body.expectedRevision,1);assert.equal(ui.calls[0].body.config.memory.enabled,true);assert.equal(ui.calls[0].body.config.permissions.mode,'read_only');
  assert.equal(ui.calls[1].body.expectedRevision,2);assert.deepEqual(ui.calls[2].body,{operation:'activate',expectedRevision:2,expectedControlEpoch:5});assert.equal(ui.state.bot.control_state,'active');assert.equal(ui.state.bot.validation.revision,2);assert.equal(ui.state.draft.revision,2);assert.match(ui.state.notice,/已生效.*恢复工作/);
});
test('enabling a paused or draft Bot checks configuration and leaves activation to the user',async()=>{
  for(const controlState of ['paused','draft']){const ui=fixture({controlState});await ui.setWorkspace('qa','a');assert.equal(await ui.enableCapability('memory'),true);assert.deepEqual(ui.calls.map(call=>call.kind),['save','check']);assert.notEqual(ui.state.bot.control_state,'active');assert.match(ui.state.notice,/启用 Bot 后/);}
});
test('an unsaved draft prevents one-click enable without changing the draft or making a request',async()=>{
  const ui=fixture();await ui.setWorkspace('qa','a');ui.state.draft.employee.name='My draft';assert.equal(await ui.enableCapability('memory'),false);assert.deepEqual(ui.calls,[]);assert.equal(ui.state.draft.employee.name,'My draft');assert.match(ui.state.error,/先保存当前草稿/);
});
test('failed or unfinished checks never restore active or claim the capability has taken effect',async()=>{
  for(const check of ['failed','pending']){const ui=fixture({check});await ui.setWorkspace('qa','a');assert.equal(await ui.enableCapability('memory'),false);assert.equal(ui.calls.some(call=>call.kind==='activate'),false);assert.equal(ui.state.bot.control_state,'draft');assert.doesNotMatch(ui.state.notice,/已生效|恢复工作/);assert.match(ui.state.error||ui.state.notice,check==='failed'?/模型凭证无效/:/仍在检查中/);}
});
test('new pause, revision or navigation during checking prevents automatic activation',async()=>{
  for(const change of ['pause','revision','navigation']){
    const ui=fixture({onWait:async({ui,current,setCurrent})=>{if(change==='navigation'){await ui.select('b');return;}setCurrent({...current,...(change==='pause'?{control_state:'paused',control_epoch:6}:{revision:3}),validation:{status:'succeeded',revision:2}});}});
    await ui.setWorkspace('qa','a');assert.equal(await ui.enableCapability('memory'),false);assert.equal(ui.calls.some(call=>call.kind==='activate'),false);if(change==='navigation')assert.equal(ui.state.bot.id,'b');
  }
});
test('save conflict, incorrect readback and a control conflict never retry or fabricate an active state',async()=>{
  for(const option of ['updateFailure','badReadback','activateFailure']){const ui=fixture({[option]:true});await ui.setWorkspace('qa','a');assert.equal(await ui.enableCapability('memory'),false);assert.equal(ui.calls.filter(call=>call.kind==='save').length,1);assert.equal(ui.calls.filter(call=>call.kind==='activate').length,option==='activateFailure'?1:0);assert.doesNotMatch(ui.state.notice,/已生效|恢复工作/);assert.ok(ui.state.error);}
});
test('a newer configuration seen during save readback cannot be checked or activated as this enable request',async()=>{
  const ui=fixture({newerReadback:true});await ui.setWorkspace('qa','a');assert.equal(await ui.enableCapability('memory'),false);assert.deepEqual(ui.calls.map(call=>call.kind),['save']);assert.equal(ui.state.draft.revision,1);assert.match(ui.state.error,/保存后已变化.*刷新/);assert.doesNotMatch(ui.state.notice,/已生效|恢复工作/);
});
