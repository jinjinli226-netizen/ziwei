import test from 'node:test';
import assert from 'node:assert/strict';
import {botRosterPresence} from './bot-workbench.js';
test('non-Hermes roster does not invent Hermes readiness or configuration state',()=>{
 assert.equal(botRosterPresence({employee:{runtime:'Codex',status:'active'}}).label,'员工已启用');
 assert.equal(botRosterPresence({employee:{status:'active'}}).label,'待配置运行时');
});
import {createBotWorkbench,botRosterRuntimeOptions,filterBotRoster} from './bot-workbench.js';
const rows=[{id:'h',employee:{id:'h',name:'Hermes one',runtime:'Hermes'}},{id:'c',employee:{id:'c',name:'Codex one',runtime:'Codex'}},{id:'u',employee:{id:'u',name:'Pending',runtime:null}}];
test('mixed roster defaults to all with data-derived runtime filters',()=>{assert.deepEqual(filterBotRoster(rows).map(x=>x.id),['h','c','u']);assert.deepEqual(botRosterRuntimeOptions(rows).map(x=>x.value),['all','Hermes','Codex','unconfigured']);assert.deepEqual(filterBotRoster(rows,{runtime:'Codex'}).map(x=>x.id),['c']);});
test('non-Hermes selection uses original employee entry without Hermes detail or initialization',async()=>{
 const calls=[],opened=[];const ui=createBotWorkbench({api:{bots:async()=>({bots:rows}),bot:async()=>{calls.push('hermes-detail');throw Error('must not call');}},onEmployeeSelect:value=>opened.push(value)});
 await ui.setWorkspace('workspace');assert.equal(calls.length,0);await ui.select('c');assert.equal(calls.length,0);assert.equal(opened[0].employee.id,'c');assert.equal(opened[0].workspace,'workspace');assert.equal(ui.state.bot,null);
 await ui.setWorkspace('next','u');assert.equal(calls.length,0);assert.equal(opened[1].employee.id,'u');assert.equal(opened[1].workspace,'next');
});
