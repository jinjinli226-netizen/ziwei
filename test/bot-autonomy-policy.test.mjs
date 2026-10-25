import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBotConfig,BOT_DEFAULT_TOOLSETS} from '../src/hermes-bot-config.mjs';
import {hermesBotToolsets} from '../src/hermes-mcp-config.mjs';
test('omitted permissions grant supported execution while explicit read_only stays empty',()=>{
 const config=normalizeBotConfig();assert.equal(config.permissions.mode,'execute');assert.deepEqual(config.toolsets,[...BOT_DEFAULT_TOOLSETS]);
 assert.deepEqual(normalizeBotConfig({permissions:{mode:'read_only'}}).toolsets,[]);
 assert.deepEqual(normalizeBotConfig({permissions:{mode:'execute'},toolsets:[]}).toolsets,[]);
});
test('autonomy aliases use platform tools without native schedulers or privilege widening',()=>{
 for(const name of ['cron','cronjob','heartbeat','goals','kanban','bot','bot_mode'])assert.deepEqual(normalizeBotConfig({toolsets:[name]}).toolsets,['ziwei_autonomy']);
 assert.deepEqual(normalizeBotConfig({toolsets:['all']}).toolsets,[...BOT_DEFAULT_TOOLSETS]);
 assert.throws(()=>normalizeBotConfig({toolsets:['delegation']}),{code:'BOT_TARGET_NOT_AUTHORIZED'});
 assert.deepEqual(normalizeBotConfig({toolsets:['delegation'],collaboration:{enabled:true,targetEmployeeIds:['employee_peer']}}).toolsets,['ziwei_collaboration']);
 assert.throws(()=>normalizeBotConfig({toolsets:['cron'],permissions:{management:false}}),{code:'BOT_PERMISSION_CONFLICT'});
 assert.equal(hermesBotToolsets(normalizeBotConfig({permissions:{mode:'read_only'}})).length,0);
});

import {normalizeBotConfigUpdate} from '../src/hermes-bot-config.mjs';
test('partial config update preserves saved read_only and explicit empty tool grants',()=>{
 const saved=normalizeBotConfig({permissions:{mode:'read_only',management:false},toolsets:[]});
 assert.equal(normalizeBotConfigUpdate({maxTurns:8},saved).permissions.mode,'read_only');
 assert.deepEqual(normalizeBotConfigUpdate({maxTurns:8},saved).toolsets,[]);
 const granted=normalizeBotConfigUpdate({permissions:{mode:'execute',management:true}},saved);
 assert.equal(granted.permissions.mode,'execute');assert.deepEqual(granted.toolsets,BOT_DEFAULT_TOOLSETS);
 assert.deepEqual(normalizeBotConfigUpdate({toolsets:[]},granted).toolsets,[]);
});
