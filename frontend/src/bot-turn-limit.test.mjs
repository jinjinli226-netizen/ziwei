import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createBotWorkbench,botDraftDirty} from './bot-workbench.js';

const clone=value=>structuredClone(value);
const bot=config=>({id:'a',workspace:'qa',revision:1,control_epoch:2,control_state:'paused',
 employee:{id:'a',name:'Employee A',runtime:'Hermes',description:'Keep description',instructions:'Keep instructions'},
 config:{provider:null,toolsets:['web'],memory:{enabled:true,userProfile:true},skills:{disabled:['retained-skill']},
  mcpServers:{},permissions:{mode:'execute',management:false},drivers:{maxTotalTurns:45,expiresAt:'2027-01-01T00:00:00Z'},...config},
 validation:{status:'succeeded',revision:1},main_conversation_id:'chat-a',
});

test('editing an existing employee never converts legacy turn fields or changes independent driver budgets',async()=>{
 for(const legacy of [{maxTurns:1,turnLimitMode:'bounded'},{maxTurns:100},{maxTurns:37,turnLimitMode:'unlimited'},{}]){
  let current=bot(legacy);const calls=[],original=clone(current.config);
  const api={bots:async()=>({bots:[clone(current)]}),bot:async()=>clone(current),
   botRuns:async()=>({runs:[]}),botRoutines:async()=>({routines:[]}),
   updateBot:async(id,body,workspace)=>{calls.push(clone({id,body,workspace}));current={...current,revision:2,employee:{...current.employee,...body.employee},config:clone(body.config)};return clone(current);},
  };
  const ui=createBotWorkbench({api});await ui.setWorkspace('qa','a');
  assert.equal(botDraftDirty(ui.state.bot,ui.state.draft),false);
  ui.state.draft.employee.description='Edited description';assert.equal(await ui.save(),true);
  assert.equal(calls.length,1);assert.equal(calls[0].body.expectedRevision,1);assert.deepEqual(calls[0].body.config,original);
  assert.equal(ui.state.draft.employee.description,'Edited description');assert.deepEqual(ui.state.draft.config,original);
  assert.equal(botDraftDirty(ui.state.bot,ui.state.draft),false);
 }
});

test('the compiled workbench has no conversation turn controls in settings or creation and keeps proactive budgets',async()=>{
 const {parse,compileScript,compileTemplate}=await import('@vue/compiler-sfc');
 const source=await readFile(new URL('./components/BotWorkbench.vue',import.meta.url),'utf8');
 const {descriptor,errors}=parse(source);assert.deepEqual(errors,[]);
 const script=compileScript(descriptor,{id:'bot-default-unlimited'});
 const template=compileTemplate({source:descriptor.template.content,filename:'BotWorkbench.vue',id:'bot-default-unlimited',compilerOptions:{bindingMetadata:script.bindings}});
 assert.deepEqual(template.errors,[]);
 assert.doesNotMatch(source,/bot-turn-limit|unlimitedTurns|turnLimitMode|单次最多轮数|config\.maxTurns/);
 assert.match(descriptor.template.content,/单次最多24小时，可手动停止。/);
 assert.match(descriptor.template.content,/v-model="driverBudget"/);assert.match(descriptor.template.content,/v-model="driverExpiry"/);
});
