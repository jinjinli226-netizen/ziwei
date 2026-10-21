import test from 'node:test';
import assert from 'node:assert/strict';
import {loadBotPageOptions,mergeBotRosterEmployee,workspaceDataKey} from './bot-page-load.js';

test('workspace data from another account must be reloaded even in the same workspace',()=>{
  assert.notEqual(workspaceDataKey('one','alice'),workspaceDataKey('one','bob'));
  assert.notEqual(workspaceDataKey('one','alice'),workspaceDataKey('two','alice'));
  assert.notEqual(workspaceDataKey('one','alice'),workspaceDataKey('one',null));
});

test('Bot page options do not load workspace history or a duplicate roster',async()=>{
  const calls=[];
  const values={summary:{workspace:{slug:'one'}},models:{models:[{id:'m'}]},skills:{skills:[]},devices:{devices:[{id:'d'}]}};
  const api=Object.fromEntries(Object.entries(values).map(([key,value])=>[key,async()=>{calls.push(key);return value;}]));
  for(const method of ['tasks','conversations','employees','documents','automations','calendar','bots','members','agents','runtimes'])api[method]=()=>{throw new Error(`Unexpected eager ${method}`);};
  const result=await loadBotPageOptions(api,Promise.resolve({workspace:{name:'One'}}));
  assert.deepEqual(calls.sort(),['devices','models','skills','summary']);
  assert.deepEqual(result.models,[{id:'m'}]);assert.equal(result.settings.workspace.name,'One');
});

test('metadata refresh cannot turn a team employee into a partial roster record',()=>{
  const original={id:'employee_one',name:'Old',avatar:'data:image/png;base64,original',instructions:'keep instructions',persona:'keep persona',skills:['existing']};
  const merged=mergeBotRosterEmployee(original,{id:original.id,name:'Renamed',avatar:'/api/workspaces/one/mobile/employees/employee_one/avatar'});
  assert.equal(merged.name,'Renamed');assert.equal(merged.avatar,original.avatar);assert.equal(merged.instructions,original.instructions);assert.equal(merged.persona,original.persona);assert.deepEqual(merged.skills,original.skills);
});
