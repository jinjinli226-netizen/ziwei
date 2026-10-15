import test from 'node:test';
import assert from 'node:assert/strict';
import {botCapabilityAction,botCapabilityDestination,enabledCapabilityConfig,focusCapabilityTarget} from './bot-capability-actions.js';
import {capabilityPresentation} from './bot-presentation.js';
const bot={config:{memory:{enabled:false,userProfile:false,charLimit:500},permissions:{mode:'read_only',management:false},mcpServers:{existing:{command:'fixture'}},collaboration:{enabled:false,targetEmployeeIds:['partner']}}};

test('capability states describe current availability independently of legacy integration status',()=>{
  for(const [state,label] of Object.entries({ready:'可用',enabled:'已开启',disabled:'未开启',needs_configuration:'需要配置',needs_check:'待检查',checking:'检查中',offline:'电脑离线',failed:'检查失败',unavailable:'暂不可用'}))assert.equal(capabilityPresentation({state,status:'available'}).label,label);
  assert.equal(capabilityPresentation({status:'requires_configuration'}).label,'需要配置');assert.notEqual(capabilityPresentation({state:'future',status:'available'}).tone,'success');
});
test('memory enable preserves explicit tool permission and the rest of the saved configuration',()=>{
  const config=enabledCapabilityConfig(bot,'memory');assert.equal(config.memory.enabled,true);assert.equal(config.memory.userProfile,false);assert.equal(config.memory.charLimit,500);assert.deepEqual(config.permissions,bot.config.permissions);assert.deepEqual(config.mcpServers,bot.config.mcpServers);assert.equal(bot.config.memory.enabled,false);
});
test('tool permission is an explicit action and collaboration never grants it implicitly',()=>{
  const action=botCapabilityAction({action:{kind:'enable',key:'tools_permission',tab:'settings',label:'开启能力'}});assert.equal(action.label,'允许使用工具');
  assert.equal(enabledCapabilityConfig(bot,'tools_permission').permissions.mode,'execute');assert.throws(()=>enabledCapabilityConfig(bot,'collaboration'),/允许使用工具/);
  assert.throws(()=>enabledCapabilityConfig({config:{...bot.config,permissions:{mode:'execute'},collaboration:{targetEmployeeIds:[]}}},'collaboration'),/选择协作伙伴/);
  const config=enabledCapabilityConfig({config:{...bot.config,permissions:{mode:'execute'}}},'collaboration');assert.equal(config.collaboration.enabled,true);assert.deepEqual(config.collaboration.targetEmployeeIds,['partner']);
  assert.equal(botCapabilityAction({action:{kind:'enable',key:'arbitrary',tab:'settings',label:'Enable'}}),null);
});
test('complex capability actions target the corresponding configuration section',()=>{
  for(const [id,tab,section] of [['tools_mcp','knowledge','原生 MCP 与工具'],['voice','channels','原生语音与音频'],['gateway','channels','Gateway 渠道'],['delegation','collaboration','Bot 协作']]){
    const cap={id,state:'needs_configuration',action:{kind:'navigate',tab,label:'配置'}};assert.deepEqual(botCapabilityDestination(cap),{tab,selector:`[aria-label="${section}"]`});
  }
  assert.equal(botCapabilityAction({id:'voice',state:'unavailable',action:null}),null);assert.equal(botCapabilityAction({id:'voice',configurable:true}).label,'配置语音');
});
test('section navigation reveals advanced controls, scrolls to the section and focuses its first input',()=>{
  const details={tagName:'DETAILS',open:false,parentElement:null};let scrolled=false,focused=false;
  const node={parentElement:details,tagName:'SECTION',scrollIntoView:()=>scrolled=true,matches:()=>false,querySelector:()=>({focus:()=>focused=true})};
  assert.equal(focusCapabilityTarget({querySelector:()=>node},'section'),true);assert.equal(details.open,true);assert.equal(scrolled,true);assert.equal(focused,true);assert.equal(focusCapabilityTarget({querySelector:()=>null},'missing'),false);
});
