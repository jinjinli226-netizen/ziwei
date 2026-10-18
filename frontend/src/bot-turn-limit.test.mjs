import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createBotWorkbench,botDraftDirty} from './bot-workbench.js';
import {unlimitedBotTurns,setUnlimitedBotTurns} from './bot-turn-limit.mjs';

const clone=value=>structuredClone(value);
const bot=(id,maxTurns,mode)=>({id,workspace:'qa',revision:1,control_epoch:2,control_state:'paused',
 employee:{id,name:id,runtime:'Hermes',description:'Keep description',instructions:'Keep instructions'},
 config:{provider:null,toolsets:['web'],maxTurns,...(mode?{turnLimitMode:mode}:{}),
  memory:{enabled:true,userProfile:true},skills:{disabled:['retained-skill']},mcpServers:{},permissions:{mode:'execute',management:false},
  drivers:{maxTotalTurns:45,expiresAt:'2027-01-01T00:00:00Z'}},
 validation:{status:'succeeded',revision:1},main_conversation_id:`chat-${id}`,
});
function fixture(){
 const rows=new Map([['a',bot('a',37)],['b',bot('b',9)],['c',bot('c',82,'unlimited')]]),calls=[];
 const api={bots:async()=>({bots:clone([...rows.values()])}),bot:async id=>clone(rows.get(id)),
  botRuns:async()=>({runs:[]}),botRoutines:async()=>({routines:[]}),
  updateBot:async(id,body,workspace)=>{
   calls.push(clone({id,body,workspace}));
   const previous=rows.get(id),saved={...previous,revision:previous.revision+1,control_epoch:previous.control_epoch+1,
    employee:{...previous.employee,...clone(body.employee)},config:clone(body.config)};
   rows.set(id,saved);return clone(saved);
  },
 };
 return {...createBotWorkbench({api}),rows,calls};
}

test('legacy drafts stay bounded without changing defaults or the retained finite count',()=>{
 for(const count of [1,20,100]){
  const config=bot('a',count).config,before=clone(config);
  assert.equal(unlimitedBotTurns(config),false);setUnlimitedBotTurns(config,false);assert.deepEqual(config,before);
  setUnlimitedBotTurns(config,true);assert.equal(unlimitedBotTurns(config),true);assert.equal(config.maxTurns,count);
  setUnlimitedBotTurns(config,false);assert.equal(Object.hasOwn(config,'turnLimitMode'),false);assert.equal(config.maxTurns,count);
  assert.deepEqual(config,before);
 }
 assert.throws(()=>setUnlimitedBotTurns({},'unlimited'),TypeError);
 setUnlimitedBotTurns(undefined,true);
});

test('unlimited mode saves through the real workbench and persisted readback retains all other settings',async()=>{
 const ui=fixture();await ui.setWorkspace('qa','a');const original=clone(ui.state.draft.config);
 assert.equal(botDraftDirty(ui.state.bot,ui.state.draft),false);
 setUnlimitedBotTurns(ui.state.draft.config,true);ui.state.draft.employee.description='Edited draft';
 assert.equal(await ui.save(),true);assert.equal(ui.calls.length,1);
 assert.deepEqual(ui.calls[0],{id:'a',workspace:'qa',body:{expectedRevision:1,employee:{...ui.state.draft.employee},config:{...original,turnLimitMode:'unlimited'}}});
 assert.equal(ui.state.bot.config.turnLimitMode,'unlimited');assert.equal(ui.state.draft.config.maxTurns,37);
 assert.equal(ui.state.draft.employee.description,'Edited draft');assert.equal(botDraftDirty(ui.state.bot,ui.state.draft),false);
 await ui.refresh({resetDraft:true});assert.equal(unlimitedBotTurns(ui.state.draft.config),true);
 setUnlimitedBotTurns(ui.state.draft.config,false);assert.equal(ui.state.draft.config.maxTurns,37);
 assert.equal(await ui.save(),true);assert.equal(ui.calls[1].body.expectedRevision,2);
 assert.deepEqual(ui.calls[1].body.config,original);assert.equal(Object.hasOwn(ui.calls[1].body.config,'turnLimitMode'),false);
 assert.equal(unlimitedBotTurns(ui.state.draft.config),false);assert.equal(ui.state.draft.config.maxTurns,37);
});

test('employee selection reads its own policy and discards only the previous employee draft',async()=>{
 const ui=fixture();await ui.setWorkspace('qa','a');setUnlimitedBotTurns(ui.state.draft.config,true);
 await ui.select('b');assert.equal(unlimitedBotTurns(ui.state.draft.config),false);assert.equal(ui.state.draft.config.maxTurns,9);
 assert.equal(Object.hasOwn(ui.state.draft.config,'turnLimitMode'),false);
 await ui.select('c');assert.equal(unlimitedBotTurns(ui.state.draft.config),true);assert.equal(ui.state.draft.config.maxTurns,82);
 setUnlimitedBotTurns(ui.state.draft.config,false);
 await ui.select('a');assert.equal(unlimitedBotTurns(ui.state.draft.config),false);assert.equal(ui.state.draft.config.maxTurns,37);
 assert.equal(ui.calls.length,0,'switching employees does not save another employee’s mode');
});

test('the production workbench compiles with the unlimited control and conditional finite input',async()=>{
 const {parse,compileScript,compileTemplate}=await import('@vue/compiler-sfc');
 const source=await readFile(new URL('./components/BotWorkbench.vue',import.meta.url),'utf8');
 const {descriptor,errors}=parse(source);assert.deepEqual(errors,[]);
 const script=compileScript(descriptor,{id:'bot-turn-limit'});
 const template=compileTemplate({source:descriptor.template.content,filename:'BotWorkbench.vue',id:'bot-turn-limit',compilerOptions:{bindingMetadata:script.bindings}});
 assert.deepEqual(template.errors,[]);
 assert.match(descriptor.template.content,/<input v-model="unlimitedTurns" type="checkbox"\/>不限轮数（最多24小时）/);
 assert.match(descriptor.template.content,/<label v-if="!unlimitedTurns">单次最多轮数<input v-model\.number="s\.draft\.config\.maxTurns" type="number" min="1" max="100"\/>/);
});
