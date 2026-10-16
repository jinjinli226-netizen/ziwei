import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as yaml } from 'yaml';
import * as runtime from '../src/runtime-adapters.mjs';

test('Bot home adapter exists and configuration is applied without cloning auth or memories',()=>{
  assert.equal(typeof runtime.prepareHermesBotHome,'function');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-bot-test-'));
  try {
    const source=path.join(root,'source');fs.mkdirSync(source);fs.writeFileSync(path.join(source,'config.yaml'),'model:\n  provider: openai-codex\n  default: baseline\n  base_url: https://source-endpoint.example.test\n');fs.writeFileSync(path.join(source,'auth.json'),'source-private-auth');fs.mkdirSync(path.join(source,'memories'));fs.writeFileSync(path.join(source,'memories','MEMORY.md'),'source-private-memory');
    const args={sourceHome:source,privateDirectory:path.join(root,'bots'),workspace:'test-111',apiBase:'https://example.test',context:{employeeId:'employee_bot-a',workspace:'test-111',revision:1,sourceProfile:'default',name:'A',persona:'独立人格',model:'configured-model',config:{maxTurns:7,memory:{enabled:false,userProfile:true}}}};
    const first=runtime.prepareHermesBotHome(args);
    const second=runtime.prepareHermesBotHome({...args,context:{...args.context,employeeId:'employee_bot-b'}});
    assert.notEqual(first.home,second.home);
    const config=yaml(fs.readFileSync(path.join(first.home,'config.yaml'),'utf8'));
    assert.equal(config.model.default,'configured-model');assert.equal(config.memory.memory_enabled,false);assert.equal(config.agent.max_turns,7);
    assert.equal(config.agent.run_budget_seconds,86400);
    assert.deepEqual(config.agent.disabled_toolsets,['all']);assert.equal(config.agent.bot_mode_protocol,false);
    assert.equal(fs.existsSync(path.join(first.home,'auth.json')),false);assert.equal(fs.existsSync(path.join(first.home,'memories','MEMORY.md')),false);
    assert.match(fs.readFileSync(path.join(first.home,'SOUL.md'),'utf8'),/独立人格/);
    fs.mkdirSync(path.join(first.home,'memories'));fs.writeFileSync(path.join(first.home,'memories','MEMORY.md'),'A LEARNED');
    runtime.prepareHermesBotHome({...args,context:{...args.context,revision:2,persona:'新人格'}});
    assert.equal(fs.readFileSync(path.join(first.home,'memories','MEMORY.md'),'utf8'),'A LEARNED');
    assert.equal(fs.readFileSync(path.join(source,'auth.json'),'utf8'),'source-private-auth');
    const otherProvider=runtime.prepareHermesBotHome({...args,context:{...args.context,employeeId:'employee_other_provider',config:{provider:'anthropic'}}});
    assert.equal(otherProvider.config.model.provider,'anthropic');assert.equal(otherProvider.config.model.base_url,undefined);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('named custom provider readiness uses its exact local key_env without exposing the value',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-bot-provider-'));
  try {
    fs.writeFileSync(path.join(root,'config.yaml'),'model:\n  provider: custom:loopback\n  default: fixture\nproviders:\n  loopback:\n    key_env: ZIWEI_TEST_PROVIDER_KEY\n');
    fs.writeFileSync(path.join(root,'.env'),'ZIWEI_TEST_PROVIDER_KEY=fixture-private-value\n');
    const readiness=runtime.hermesProfileReadiness('default',{baseHome:root});
    assert.equal(readiness.ready,true);assert.doesNotMatch(JSON.stringify(readiness),/fixture-private-value/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
