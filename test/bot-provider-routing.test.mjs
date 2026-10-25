import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBotConfig} from '../src/hermes-bot-config.mjs';
import {resolveBotProviderRoute} from '../src/bot-provider-routing.mjs';
import {createRepository} from '../backend/repository.mjs';
import {createManagementService} from '../backend/management.mjs';

test('DeepSeek uses its own official endpoint and never the source GPT route',()=>{
  const route=resolveBotProviderRoute({provider:'deepseek'},'deepseek-v4-pro',{model:{provider:'openai-codex',default:'gpt-6.1-sol',base_url:'https://old.invalid',api_mode:'responses'}});
  assert.deepEqual(route,{provider:'deepseek',model:'deepseek-v4-pro',endpoint:'https://api.deepseek.com',apiMode:'chat_completions'});
  assert.throws(()=>resolveBotProviderRoute({provider:'deepseek'},'gpt-6.1-sol',{}),{code:'BOT_PROVIDER_MODEL_CONFLICT'});
});
test('explicit provider switch requires an explicit model instead of inheriting a source model',()=>{
  assert.throws(()=>resolveBotProviderRoute({provider:'deepseek'},null,{model:{provider:'openai-codex',default:'gpt-6.1-sol'}}),{code:'BOT_PROVIDER_MODEL_REQUIRED'});
  assert.equal(resolveBotProviderRoute({},null,{model:{provider:'openai-codex',default:'gpt-6.1-sol'}}).model,'gpt-6.1-sol');
});
test('public base URL excludes credentials and is independent of source',()=>{
  const config=normalizeBotConfig({provider:'custom:office',baseUrl:'https://model.example/v1'});
  assert.equal(config.baseUrl,'https://model.example/v1');
  assert.equal(resolveBotProviderRoute(config,'office-model',{}).endpoint,config.baseUrl);
  for(const baseUrl of ['http://example.com','https://user:key@example.com','https://example.com?key=secret','https://example.com/#key','https://example.com/${KEY}'])assert.throws(()=>normalizeBotConfig({provider:'custom:office',baseUrl}));
});
test('DeepSeek reasoning remains default until installed Hermes provider handling is verified',()=>{
  assert.throws(()=>resolveBotProviderRoute({provider:'deepseek',reasoningEffort:'max'},'deepseek-v4-pro',{}),{code:'BOT_PROVIDER_REASONING_UNSUPPORTED'});
  assert.equal(resolveBotProviderRoute({},'legacy-model',{model:{provider:'custom:old',base_url:'https://old.invalid'}}).endpoint,'https://old.invalid');
});
test('compatibility mode preserves source endpoint and native environment resolution',()=>{
  assert.equal(resolveBotProviderRoute({},'legacy',{model:{provider:'openai'}}).endpoint,null);
  assert.equal(resolveBotProviderRoute({},'deepseek-legacy',{model:{provider:'deepseek',base_url:'https://legacy-proxy.invalid'}}).endpoint,'https://legacy-proxy.invalid');
  assert.equal(resolveBotProviderRoute({},'legacy',{model:{provider:'openai'}},true).endpoint,'https://api.openai.com/v1');
  assert.equal(resolveBotProviderRoute({provider:'openai'},'gpt-fixture',{model:{provider:'openai',base_url:'https://old-proxy.invalid'}},true).endpoint,'https://api.openai.com/v1');
  assert.throws(()=>resolveBotProviderRoute({provider:'custom:office'},'office-model',{model:{provider:'custom:office',base_url:'https://old-proxy.invalid'}},true),{code:'BOT_PROVIDER_URL_REQUIRED'});
});
test('Bot service rejects known family mismatch before creating or updating employees',t=>{
  const repo=createRepository({memory:true}),bots=createManagementService(repo).bots;t.after(()=>repo.db.close());
  repo.heartbeatDevice('test-111',{deviceId:'route-pc',runtimes:{Hermes:{status:'available',version:'0.22.0',profiles:[{name:'default'}]}}});
  assert.throws(()=>bots.create('test-111',{name:'Wrong route',targetDeviceId:'route-pc',runtimeProfile:'default',model:'gpt-fixture',config:{provider:'anthropic'},idempotencyKey:'wrong'}),{code:'BOT_PROVIDER_MODEL_CONFLICT'});
  const bot=bots.create('test-111',{name:'Route',targetDeviceId:'route-pc',runtimeProfile:'default',model:'gpt-fixture',idempotencyKey:'valid'});
  assert.throws(()=>bots.update('test-111',bot.id,{expectedRevision:bot.revision,config:{...bot.config,provider:'anthropic'}}),{code:'BOT_PROVIDER_MODEL_CONFLICT'});
  assert.equal(bots.get('test-111',bot.id).config.provider,null);
});
