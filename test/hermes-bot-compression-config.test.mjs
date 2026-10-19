import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parse, stringify} from 'yaml';
import {prepareHermesBotHome, ownedProfileMetadata} from '../src/hermes-bot-runtime.mjs';
import {normalizeNativeOperation, nativeIsExecution, nativeNeedsTools} from '../src/hermes-native-contract.mjs';

function fixture(t, sourceSettings = {}, owned = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-native-compression-config-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const source = owned ? path.join(root, 'profiles', 'bot-compression') : path.join(root, 'source');
  fs.mkdirSync(source, {recursive:true});
  fs.writeFileSync(path.join(root, 'config.yaml'), stringify({model:{provider:'openai-codex', default:'template-model'}}));
  fs.writeFileSync(path.join(root, 'auth.json'), 'SECRET_SOURCE_AUTH');
  fs.writeFileSync(path.join(source, 'config.yaml'), stringify({model:{provider:'openai-codex', default:'gpt-6.1-sol'}, ...sourceSettings}));
  const context = {workspace:'compression-test', employeeId:'employee_compression', deviceId:'pc', revision:1,
    sourceProfile:owned ? 'bot-compression' : 'default', name:'Compression worker', model:'gpt-6.1-sol',
    config:{permissions:{mode:'execute'}, reasoningEffort:'max', memory:{enabled:true, userProfile:true}}};
  if (owned) {
    context.instance = {mode:'owned_profile', profile:'bot-compression', templateProfile:'default', ownershipId:'compression-owner', provisionActionId:'action_compression'};
    fs.writeFileSync(path.join(source, 'ziwei-instance.json'), JSON.stringify(ownedProfileMetadata({context, sourceHome:root, apiBase:'https://fixture.invalid'})));
    fs.writeFileSync(path.join(source, 'state.db'), 'FIXTURE_EXISTING_TRANSCRIPT');
  }
  const options = {context, sourceHome:source, privateDirectory:path.join(root, 'private'), workspace:context.workspace, apiBase:'https://fixture.invalid'};
  return {root, source, options};
}

test('missing policy receives official early compression without altering model window or employee permissions', t => {
  const f = fixture(t);
  const result = prepareHermesBotHome(f.options);
  const saved = parse(fs.readFileSync(path.join(result.home, 'config.yaml'), 'utf8'));
  assert.deepEqual(saved.compression, {enabled:true, in_place:true, tail_mode:'lean', threshold_tokens:128000});
  assert.deepEqual(saved.auxiliary.compression, {provider:'main', model:'gpt-6.1-sol'});
  assert.equal(saved.model.context_length, undefined);
  assert.equal(saved.agent.max_turns, Number.MAX_SAFE_INTEGER);
  assert.equal(saved.agent.run_budget_seconds, 86400);
  assert.equal(saved.agent.reasoning_effort, 'max');
  assert.equal(saved.memory.memory_enabled, true);
  assert.equal(saved.approvals.mode, 'off');
  assert.deepEqual(saved.agent.disabled_toolsets, ['cronjob','delegation','kanban']);
  assert.equal(fs.readFileSync(path.join(f.root, 'auth.json'), 'utf8'), 'SECRET_SOURCE_AUTH');
});

test('explicit native policy and public auxiliary routing survive repeated owned-profile regeneration without copying secrets', t => {
  const settings = {compression:{enabled:false, threshold:0.8, threshold_tokens:null, in_place:false, tail_mode:'legacy',
    protect_last_n:10, model_thresholds:{'openai-codex:gpt-6.1-sol':0.65}, context_timeout_seconds:360,
    api_key:'SECRET_COMPRESSION'},
    auxiliary:{compression:{provider:'openai-codex', model:'summary-model', timeout:600, no_progress_timeout:180,
      api_key:'SECRET_AUX', token:'SECRET_TOKEN', base_url:'https://SECRET_BASE',
      fallback_chain:[{provider:'main', model:'gpt-6.1-sol', timeout:300, api_key:'SECRET_FALLBACK', headers:{authorization:'SECRET_HEADER'}}]}}};
  const f = fixture(t, settings, true);
  const one = prepareHermesBotHome(f.options);
  const two = prepareHermesBotHome({...f.options, context:{...f.options.context, revision:2}});
  const saved = parse(fs.readFileSync(path.join(two.home, 'config.yaml'), 'utf8'));
  assert.equal(one.home, two.home);
  assert.equal(saved.compression.enabled, false);
  assert.equal(saved.compression.in_place, false);
  assert.equal(saved.compression.threshold_tokens, null);
  assert.deepEqual(saved.compression.model_thresholds, settings.compression.model_thresholds);
  assert.equal(saved.compression.context_timeout_seconds, 360);
  assert.deepEqual(saved.auxiliary.compression, {provider:'openai-codex', model:'summary-model', timeout:600, no_progress_timeout:180,
    fallback_chain:[{provider:'main', model:'gpt-6.1-sol', timeout:300}]});
  assert.doesNotMatch(JSON.stringify(saved), /SECRET/);
  assert.equal(fs.readFileSync(path.join(two.home, 'state.db'), 'utf8'), 'FIXTURE_EXISTING_TRANSCRIPT');
  assert.equal(fs.readFileSync(path.join(f.root, 'auth.json'), 'utf8'), 'SECRET_SOURCE_AUTH');
});

test('nested credentials under an ostensibly public option are rejected before deriving configuration', t => {
  const f = fixture(t, {compression:{threshold_tokens:{api_key:'SECRET_NESTED'}}});
  assert.throws(() => prepareHermesBotHome(f.options), {code:'BOT_SOURCE_INVALID'});
});

test('sessions.compress is precise, permissioned native execution with bounded public arguments', () => {
  const operation = normalizeNativeOperation({resource:'sessions', operation:'compress', input:{sessionId:'20261015_120149_45e77a', keepLast:2, preview:true}});
  assert.equal(nativeIsExecution(operation), true);
  assert.equal(nativeNeedsTools(operation), false);
  for (const input of [{}, {sessionId:'../escape'}, {sessionId:'valid', keepLast:0}, {sessionId:'valid', keepLast:101},
    {sessionId:'valid', preview:'true'}, {sessionId:'valid', focusTopic:''}, {sessionId:'valid', rawMessages:[]}]) {
    assert.throws(() => normalizeNativeOperation({resource:'sessions', operation:'compress', input}), {code:'BOT_NATIVE_INPUT_INVALID'});
  }
});
