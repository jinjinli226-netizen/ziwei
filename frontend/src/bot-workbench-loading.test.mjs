import test from 'node:test';
import assert from 'node:assert/strict';
import {createBotWorkbench,botWorkbenchReadOptions} from './bot-workbench.js';

const deferred=()=>{let resolve,reject;return {promise:new Promise((done,fail)=>{resolve=done;reject=fail;}),get resolve(){return resolve;},get reject(){return reject;}};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const bot=(id='a',extra={})=>({id,workspace:'qa',revision:1,control_epoch:2,configuration_state:'initialized',employee:{id,name:id,runtime:'Hermes',avatar:'/api/workspaces/qa/employees/'+id+'/avatar?v=saved'},config:{provider:null,toolsets:[],mcpServers:{}},...extra});
function fixture({readOptions=()=>({runs:true,routines:true}),...overrides}={}){
  let current=bot();const calls=[];
  const api={bots:async()=>({bots:[]}),bot:async id=>id===current.id?current:bot(id),botRuns:async id=>{calls.push(['runs',id]);return {runs:[]};},botRoutines:async id=>{calls.push(['routines',id]);return {routines:[]};},updateBot:async(id,body)=>{calls.push(['save',body]);current={...current,revision:current.revision+1,employee:{...current.employee,...body.employee},config:body.config};return current;},...overrides};
  return {...createBotWorkbench({api,getReadOptions:readOptions}),calls};
}

test('a slow activity request cannot keep a fetched Bot and editable draft hidden',async()=>{
  const records=deferred();const ui=fixture({botRuns:()=>records.promise});
  const opening=ui.setWorkspace('qa','a');await tick();
  assert.equal(ui.state.bot.id,'a');assert.equal(ui.state.draft.employee.name,'a');
  assert.equal(ui.state.reading,false);assert.equal(ui.state.recordsReading,true);
  ui.state.draft.employee.name='kept edit';records.resolve({runs:[{id:'original'}]});await opening;
  assert.equal(ui.state.recordsReading,false);assert.equal(ui.state.draft.employee.name,'kept edit');assert.equal(ui.state.runs[0].id,'original');
});

test('settings opens without histories and switching tabs requests only their needed records',async()=>{
  let tab='settings';const ui=fixture({readOptions:()=>botWorkbenchReadOptions(tab)});await ui.setWorkspace('qa','a');
  assert.deepEqual(ui.calls,[]);assert.equal(ui.state.recordsReading,false);
  tab='activity';await ui.loadRecords();assert.deepEqual(ui.calls,[['runs','a']]);
  tab='routines';await ui.loadRecords();assert.deepEqual(ui.calls,[['runs','a'],['routines','a']]);
  tab='chat';await ui.refresh();assert.deepEqual(ui.calls,[['runs','a'],['routines','a'],['routines','a']]);
  tab='knowledge';await ui.refresh();assert.equal(ui.calls.length,3);
});

test('a late record response cannot replace another employee or a mutation readback',async()=>{
  const records=deferred();let reads=0;
  const ui=fixture({botRuns:async()=>++reads===1?records.promise:{runs:[{id:'b-run'}]}});
  const opening=ui.setWorkspace('qa','a');await tick();await ui.select('b');
  records.resolve({runs:[{id:'a-run'}]});await opening;
  assert.equal(ui.state.bot.id,'b');assert.equal(ui.state.runs[0].id,'b-run');assert.equal(ui.state.recordsReading,false);
  const stale=deferred();let count=0;const next=fixture({botRuns:async()=>++count===2?stale.promise:{runs:[]}});
  await next.setWorkspace('qa','a');const refresh=next.refresh();await tick();
  next.state.draft.employee.name='saved';await next.save();stale.resolve({runs:[{id:'stale'}]});await refresh;
  assert.equal(next.state.bot.revision,2);assert.equal(next.state.runs.length,0);assert.equal(next.state.recordsReading,false);
});

test('a compact Bot endpoint is preferred for detail and save readback only',async()=>{
  let reads=0;const ui=fixture({readOptions:()=>({runs:false,routines:false}),bot:async()=>{throw new Error('full detail must not be read');},botWorkbench:async()=>{reads++;return bot('a',{revision:reads});}});
  await ui.setWorkspace('qa','a');ui.state.draft.employee.name='saved';assert.equal(await ui.save(),true);
  assert.equal(reads,2);assert.equal(ui.state.bot.revision,2);
});

test('lazy reads do not clear an unknown write before complete auxiliary readback',async()=>{
  let readRuns=async()=>({runs:[]}),readRoutines=async()=>({routines:[]});
  const ui=fixture({readOptions:()=>({runs:false,routines:false}),updateBot:async()=>{throw new TypeError('connection lost');},botRuns:()=>readRuns(),botRoutines:()=>readRoutines()});
  await ui.setWorkspace('qa','a');await ui.save();assert.equal(ui.state.writeUnknown,true);
  const runs=deferred(),routines=deferred();readRuns=()=>runs.promise;readRoutines=()=>routines.promise;
  const recovery=ui.refresh();await tick();assert.equal(ui.state.reading,false);assert.equal(ui.state.writeUnknown,true);
  runs.resolve({runs:[]});await tick();assert.equal(ui.state.writeUnknown,true);
  routines.resolve({routines:[]});await recovery;assert.equal(ui.state.writeUnknown,false);
  await ui.save();readRoutines=async()=>{throw new Error('record unavailable');};readRuns=async()=>({runs:[]});await ui.refresh();
  assert.equal(ui.state.writeUnknown,true);assert.match(ui.state.error,/record unavailable/);
});

test('a stop aimed at an older execution still fetches that execution proof on a lazy tab',async()=>{
  const target={id:'original',status:'failed',result:{stopConfirmed:true,processExit:{rootConfirmed:true,treeConfirmed:true,activeProcesses:0}}};
  const ui=fixture({readOptions:()=>({runs:false,routines:false}),bot:async()=>bot('a',{latest_run:{id:'newer'},stop_action:{payload:{actionId:'original'}}}),botRuns:async()=>({runs:[target]})});
  await ui.setWorkspace('qa','a');assert.deepEqual(ui.state.runs,[target]);assert.equal(ui.state.routines.length,0);
});

test('unchanged saved avatar URLs are not resubmitted while replacements and removal remain possible',async()=>{
  const ui=fixture({readOptions:()=>({runs:false,routines:false})});await ui.setWorkspace('qa','a');
  ui.state.draft.employee.name='renamed';assert.equal(await ui.save(),true);assert.equal('avatar' in ui.calls[0][1].employee,false);
  ui.state.draft.employee.avatar='data:image/png;base64,changed';assert.equal(await ui.save(),true);assert.equal(ui.calls[1][1].employee.avatar,'data:image/png;base64,changed');
  ui.state.draft.employee.avatar=null;assert.equal(await ui.save(),true);assert.equal(ui.calls[2][1].employee.avatar,null);
});

test('older roster revision cannot hide employee ownership or binding changes behind a cached detail',async()=>{
 const employee={id:'a',name:'original',runtime:'Hermes',owner_user_id:'owner-one',runtime_profile:'bot-a',target_device_id:'pc',visibility:'workspace',instructions:'private detail'};
 const detail={...bot('a'),revision:5,control_epoch:7,employee};let rows=[{...detail,employee:{...employee,instructions:undefined}}];
 const ui=createBotWorkbench({api:{bots:async()=>({bots:rows}),bot:async()=>detail},getReadOptions:()=>({runs:false,routines:false})});await ui.setWorkspace('qa','a');
 rows=[{...detail,revision:4,employee:{...employee,name:'older summary',instructions:undefined}}];await ui.list();assert.equal(ui.state.bots[0].employee.instructions,'private detail');
 for(const patch of [{owner_user_id:'owner-two'},{runtime:'Codex'},{runtime_profile:'another-profile'},{target_device_id:'another-pc'},{visibility:'personal'}]){
  rows=[{...detail,revision:4,employee:{...employee,...patch,instructions:undefined}}];await ui.list();for(const[key,value]of Object.entries(patch))assert.equal(ui.state.bots[0].employee[key],value);assert.equal(ui.state.bots[0].employee.instructions,undefined);
 }
 ui.dispose();
});
