import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { computed, ref } from 'vue';
import { phoneBotActivityHref, phoneBotReadiness, readPhoneSkillBot } from './phone-skill-bot.js';
import { phoneConfigurationMatches, phoneErrorText, phoneOnline, phoneRuntimeReadiness, phoneSetupPhase } from './phone-skill.js';

const employee = { id:'phone-bot',runtime:'Hermes' };
const scope = { employee,workspace:'phone_ai' };
const activeBot = () => ({ id:employee.id,workspace:scope.workspace,configuration_state:'initialized',control_state:'active',revision:7,control_epoch:3,config:{permissions:{mode:'execute'}},validation:{status:'succeeded',revision:7} });
const state = bot => ({ kind:bot.configuration_state,bot });

test('an active Bot only permits phone detection after its current saved revision passed checking', () => {
  assert.equal(phoneBotReadiness(state(activeBot()),scope).ready,true);
  for (const validation of [{status:'not_checked',revision:null},{status:'pending',revision:7},{status:'succeeded',revision:6},{status:'failed',revision:7,error:'模型凭据缺失'}]) {
    const value=phoneBotReadiness(state({...activeBot(),validation}),scope);
    assert.equal(value.ready,false);assert.equal(value.href,'/phone_ai/bots/phone-bot?section=activity');
    if(validation.status==='failed')assert.match(value.reason,/模型凭据缺失/);
  }
});

test('first phone skill attachment that drafts an active Bot blocks detection and provides the exact recovery page', async () => {
  let bot=activeBot();const calls=[];
  const api={bot:async(id,workspace)=>{calls.push({id,workspace});return bot;}};
  const original=await readPhoneSkillBot(api,employee,scope.workspace);
  assert.equal(phoneBotReadiness(original,scope).ready,true);
  bot={...bot,revision:8,control_state:'draft',validation:{status:'stale',revision:7}};
  const saved=await readPhoneSkillBot(api,employee,scope.workspace);
  const value=phoneBotReadiness(saved,{...scope,savedFromActive:original.bot.control_state==='active'});
  assert.equal(value.ready,false);assert.match(value.reason,/已保存.*重新启用/);assert.equal(value.label,'前往检查并启用');
  assert.deepEqual(calls,[{id:'phone-bot',workspace:'phone_ai'},{id:'phone-bot',workspace:'phone_ai'}]);
  bot={...bot,control_state:'active',validation:{status:'succeeded',revision:8}};
  assert.equal(phoneBotReadiness(await readPhoneSkillBot(api,employee,scope.workspace),scope).ready,true);
});

test('paused and draft Bots provide explicit navigation without changing their control state', () => {
  for (const control_state of ['paused','draft']) {
    const bot={...activeBot(),control_state};const before=structuredClone(bot);
    const value=phoneBotReadiness(state(bot),scope);
    assert.equal(value.ready,false);assert.match(value.reason,control_state==='paused'?/已暂停.*恢复/:/尚未启用/);
    assert.equal(value.label,control_state==='paused'?'前往检查并恢复':'前往检查并启用');assert.deepEqual(bot,before);
  }
});

test('read-only or unknown tool permissions cannot dispatch a phone check and lead to the capability page', () => {
  for (const permissions of [{mode:'read_only'},{},undefined]) {
    const bot={...activeBot(),config:{permissions}},before=structuredClone(bot);
    const value=phoneBotReadiness(state(bot),scope);
    assert.equal(value.ready,false);assert.match(value.reason,/先允许使用工具/);assert.equal(value.href,'/phone_ai/bots/phone-bot?section=capabilities');assert.equal(value.label,'前往允许使用工具');
    assert.deepEqual(bot,before);
  }
});

test('ordinary Codex employees and explicitly uninitialized Hermes employees retain their existing phone workflow', async () => {
  let reads=0;const codex={id:'codex',runtime:'Codex'};
  const api={bot:async()=>{reads++;return {...activeBot(),configuration_state:'uninitialized',control_state:'draft',revision:0};}};
  const none=await readPhoneSkillBot(api,codex,scope.workspace);
  assert.equal(none.kind,'none');assert.equal(reads,0);assert.equal(phoneBotReadiness(none,{...scope,employee:codex}).ready,true);
  const uninitialized=await readPhoneSkillBot(api,employee,scope.workspace);
  assert.equal(uninitialized.kind,'uninitialized');assert.equal(phoneBotReadiness(uninitialized,scope).ready,true);assert.equal(reads,1);
});

test('network errors and HTTP 404 never masquerade as an uninitialized Bot', async () => {
  for (const error of [new Error('网络连接中断'),Object.assign(new Error('Bot 已不存在'),{code:'BOT_NOT_FOUND',status:404})]) {
    const value=await readPhoneSkillBot({bot:async()=>{throw error;}},employee,scope.workspace);
    assert.equal(value.kind,'error');assert.equal(value.status,error.status || null);
    const gate=phoneBotReadiness(value,scope);assert.equal(gate.ready,false);assert.match(gate.reason,/无法确认 Bot 状态/);assert.ok(gate.reason.includes(error.message));
  }
});

test('missing, incomplete or different workspace or employee state cannot unlock phone detection', async () => {
  assert.equal(phoneBotReadiness(null,scope).ready,false);
  for (const change of [{id:'other'},{workspace:'other'},{configuration_state:null}]) {
    const value=await readPhoneSkillBot({bot:async()=>({...activeBot(),...change})},employee,scope.workspace);
    assert.equal(value.kind,'error');assert.equal(phoneBotReadiness(value,scope).ready,false);
  }
  assert.equal(phoneBotReadiness(state(activeBot()),{...scope,workspace:'other'}).ready,false);
});

test('Bot navigation encodes the exact workspace and employee instead of using a tab-global default', () => {
  assert.equal(phoneBotActivityHref('team / a','bot/?#'),'/team%20%2F%20a/bots/bot%2F%3F%23?section=activity');
  assert.equal(phoneBotActivityHref('','bot'),'');assert.equal(phoneBotActivityHref('team',''),'');
});

const component=await readFile(new URL('./components/PhoneSkillSetup.vue',import.meta.url),'utf8');
function phoneSetupFixture({controlState='active',mode='execute'}={}) {
  let bot={...activeBot(),control_state:controlState,config:{permissions:{mode}}},checks=0;
  const writes=[];
  const configuration={saved:true,enabled:true,target_device_id:'pc',runtime:'Hermes',runtime_profile:'named',phone_device_id:'phone',revision:'phone-v1'};
  const setup={workspace:scope.workspace,skill:{id:'phone-skill',installed:true},employees:[{...employee,target_device_id:'pc',runtime_profile:'named'}],computers:[{id:'pc',status:'online',terminal_mcp:{configured:true,workspace:scope.workspace,supportedRuntimes:['Hermes']},runtimes:[{name:'Hermes',cli_status:'available',profiles:[{name:'named',readiness:{ready:true}}]}]}],phones:[{id:'phone',status:'online'}]};
  const api={phoneMcpSetup:async()=>setup,phoneMcpStatus:async()=>({configuration,api:{status:'healthy'},receipt:{loaded:true}}),bot:async()=>bot,
    savePhoneMcp:async(id,body,workspace)=>{writes.push({id,body,workspace});bot={...bot,control_state:'draft',revision:bot.revision+1,validation:{status:'stale',revision:bot.revision}};return {configuration};},
    checkPhoneMcp:async()=>{checks++;throw new Error('A blocked check must not dispatch');}};
  const bindings={api,computed,ref,defineProps:()=>({workspace:scope.workspace,employeeId:employee.id,phoneDeviceId:'',workspaces:[],canManage:true}),defineEmits:()=>()=>{},watch:()=>{},onUnmounted:()=>{},phoneBotReadiness,readPhoneSkillBot,phoneConfigurationMatches,phoneErrorText,phoneOnline,phoneRuntimeReadiness,phoneSetupPhase};
  const script=component.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm,'');
  const ui=new Function(...Object.keys(bindings),`${script}\nreturn {refresh,save,perform,canCheck,canTrial,phase,botReadiness,error};`)(...Object.values(bindings));
  return {...ui,writes,checks:()=>checks,bot:()=>bot};
}

test('the actual phone setup save handler reads back draft state and disables both execution buttons', async () => {
  const ui=phoneSetupFixture();await ui.refresh({initial:true});assert.equal(ui.canCheck.value,true);
  await ui.save();assert.equal(ui.error.value,'');assert.equal(ui.writes.length,1);assert.equal(ui.bot().control_state,'draft');assert.equal(ui.canCheck.value,false);assert.equal(ui.canTrial.value,false);
  assert.equal(ui.phase.value.code,'bot_not_ready');assert.match(ui.phase.value.reason,/已保存.*重新启用/);
  await ui.perform('check');assert.equal(ui.checks(),0);
});

test('the actual phone setup blocks read-only Bot checks and directs the user to explicit tool permission', async () => {
  const ui=phoneSetupFixture({mode:'read_only'});await ui.refresh({initial:true});
  assert.equal(ui.canCheck.value,false);assert.equal(ui.phase.value.code,'bot_not_ready');assert.match(ui.phase.value.reason,/先允许使用工具/);assert.equal(ui.botReadiness.value.href,'/phone_ai/bots/phone-bot?section=capabilities');
  await ui.perform('check');assert.equal(ui.checks(),0);assert.deepEqual(ui.writes,[]);assert.equal(ui.bot().config.permissions.mode,'read_only');
});
