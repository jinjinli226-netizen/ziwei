import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parse as yaml} from 'yaml';
import {normalizeBotConfig} from '../src/hermes-bot-config.mjs';
import {prepareHermesBotHome,ownedProfileMetadata} from '../src/hermes-bot-runtime.mjs';
import * as adapters from '../src/runtime-adapters.mjs';
const {createHermesExecutionOverlay}=adapters;
import {createRepository} from '../backend/repository.mjs';
import {createManagementService} from '../backend/management.mjs';
import {completeOwnedProfile} from '../test-support/owned-profile.mjs';

test('Bot reasoning effort accepts exact native levels and leaves absent legacy values absent',()=>{
  for(const effort of ['minimal','low','medium','high','xhigh','max','ultra'])assert.equal(normalizeBotConfig({reasoningEffort:effort}).reasoningEffort,effort);
  assert.equal(Object.hasOwn(normalizeBotConfig(), 'reasoningEffort'),false);
  for(const value of [null,true,'ULTRA','highest','',1])assert.throws(()=>normalizeBotConfig({reasoningEffort:value}),{code:'BOT_CONFIG_INVALID'});
});

test('create, definite provisioning recovery, validation and revised execution retain exact effort and model',t=>{
  const repo=createRepository({memory:true}),management=createManagementService(repo),bots=management.bots;t.after(()=>repo.db.close());
  repo.heartbeatDevice('test-111',{deviceId:'reasoning-pc',runtimes:{Hermes:{status:'available',profiles:[{name:'default'}]}}});
  const input={name:'Reasoning QA',sourceProfile:'default',targetDeviceId:'reasoning-pc',model:'gpt-6.1-sol',idempotencyKey:'reasoning-create',config:{reasoningEffort:'ultra'}};
  const bot=bots.create('test-111',input);assert.equal(bot.config.reasoningEffort,'ultra');
  const initial=repo.getA2AAction(bot.instance.provisioning.actionId);
  assert.equal(initial.payload.hermesBot.config.reasoningEffort,'ultra');assert.equal(initial.payload.model,'gpt-6.1-sol');
  repo.ackA2AAction(initial.id,{deviceId:'reasoning-pc'});repo.resultA2AAction(initial.id,{status:'failed',error:'isolated definite failure'});
  const retry=bots.provision('test-111',bot.id,{expectedRevision:1,idempotencyKey:'reasoning-retry'}).action;
  assert.equal(retry.payload.hermesBot.config.reasoningEffort,'ultra');assert.equal(retry.payload.hermesBot.instance.profile,bot.instance.profile);
  completeOwnedProfile(repo,bots.get('test-111',bot.id));
  const validation=bots.validate('test-111',bot.id,{expectedRevision:1,idempotencyKey:'ultra-validation'}).action;
  assert.equal(validation.payload.hermesBot.config.reasoningEffort,'ultra');
  repo.ackA2AAction(validation.id,{deviceId:'reasoning-pc'});repo.resultA2AAction(validation.id,{status:'failed',error:'native ultra clamp must be visible'});
  const updated=bots.update('test-111',bot.id,{expectedRevision:1,config:{reasoningEffort:'high'}});
  assert.equal(updated.revision,2);assert.equal(updated.config.reasoningEffort,'high');assert.notEqual(updated.validation.status,'succeeded');
  const next=bots.validate('test-111',bot.id,{expectedRevision:2,idempotencyKey:'high-validation'}).action;
  assert.equal(next.payload.hermesBot.config.reasoningEffort,'high');assert.equal(next.payload.hermesBot.revision,2);
  repo.ackA2AAction(next.id,{deviceId:'reasoning-pc'});
  const receipt={valid:true,schemaVersion:1,employeeId:bot.id,revision:2};
  assert.throws(()=>repo.resultA2AAction(next.id,{status:'succeeded',result:{botValidation:receipt}}),{code:'BOT_REASONING_RECEIPT_REQUIRED'});
  repo.resultA2AAction(next.id,{status:'succeeded',result:{botValidation:{...receipt,effective:{reasoning:{schemaVersion:1,employeeId:bot.id,revision:2,provider:'openai-codex',model:'gpt-6.1-sol',requested:'high',effective:'high',actual:'high',status:'matched',phase:'preflight',evidence:'native_codex_transport'}}}}});
  bots.control('test-111',bot.id,{expectedRevision:2,expectedControlEpoch:updated.control_epoch,operation:'activate'});
  const message=repo.addConversationMessage(bot.main_conversation_id,{content:'Dedicated QA text only'});
  const action=repo.getA2AAction(message.execution.id);
  assert.equal(action.payload.hermesBot.config.reasoningEffort,'high');assert.equal(action.payload.hermesBot.revision,2);assert.equal(action.payload.model,'gpt-6.1-sol');
});

test('owned HOME preparation keeps explicit effort across overlay and later revisions without changing source',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bot-reasoning-home-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const sourceText='model:\n  provider: openai-codex\n  default: gpt-6.1-sol\nagent:\n  reasoning_effort: ultra\n';
  fs.writeFileSync(path.join(root,'config.yaml'),sourceText);
  const home=path.join(root,'profiles/bot-reasoning');fs.mkdirSync(home,{recursive:true});fs.writeFileSync(path.join(home,'config.yaml'),sourceText);
  const context={employeeId:'employee_reasoning',workspace:'test-111',deviceId:'pc',revision:1,sourceProfile:'bot-reasoning',name:'Dedicated QA',model:'gpt-6.1-sol',config:{reasoningEffort:'ultra'},instance:{mode:'owned_profile',profile:'bot-reasoning',templateProfile:'default',ownershipId:'owner-reasoning',provisionActionId:'action_reasoning'}};
  fs.writeFileSync(path.join(home,'ziwei-instance.json'),JSON.stringify(ownedProfileMetadata({context,sourceHome:root,apiBase:'https://example.test'})));
  const policy=path.join(root,'policy');fs.mkdirSync(policy);fs.writeFileSync(path.join(policy,'config.yaml'),'agent:\n  reasoning_effort: ultra\n');
  const args={context,sourceHome:home,privateDirectory:path.join(root,'private'),workspace:'test-111',apiBase:'https://example.test'};
  const prepared=prepareHermesBotHome(args);
  assert.equal(prepared.config.agent.reasoning_effort,'ultra');assert.equal(prepared.env.ZIWEI_BOT_REASONING_EFFORT,'ultra');
  assert.equal(prepared.receipt.reasoning.requested,'ultra');assert.equal(prepared.receipt.reasoning.actual,null);
  const overlay=createHermesExecutionOverlay({profile:'bot-reasoning',baseHome:root,privateDirectory:path.join(root,'overlays'),managedDirectory:policy});t.after(overlay.cleanup);
  assert.equal(yaml(fs.readFileSync(path.join(overlay.home,'config.yaml'),'utf8')).agent.reasoning_effort,'ultra');
  const revised=prepareHermesBotHome({...args,context:{...context,revision:2,config:{reasoningEffort:'high'}}});
  assert.equal(revised.config.agent.reasoning_effort,'high');assert.equal(revised.receipt.revision,2);
  const legacyDefault=prepareHermesBotHome({...args,context:{...context,revision:3,config:{}}});
  assert.equal(Object.hasOwn(legacyDefault.config.agent,'reasoning_effort'),false);
  assert.equal(fs.readFileSync(path.join(root,'config.yaml'),'utf8'),sourceText);
});

test('reasoning receipts accept matching identity and preserve a visible clamp while rejecting forged success',()=>{
  assert.equal(typeof adapters.parseBotReasoningProof,'function');
  const context={employeeId:'employee_reasoning',revision:2,model:'gpt-6.1-sol',config:{provider:'openai-codex',reasoningEffort:'ultra'}};
  const proof={schemaVersion:1,employeeId:context.employeeId,revision:2,provider:'openai-codex',model:context.model,requested:'ultra',effective:'ultra',actual:'xhigh',status:'mismatch',phase:'preflight',evidence:'native_codex_transport'};
  const parse=value=>adapters.parseBotReasoningProof('ZIWEI_BOT_REASONING:'+JSON.stringify(value),context,{provider:'openai-codex',model:context.model});
  assert.equal(parse(proof).actual,'xhigh');
  for(const patch of [{employeeId:'employee_other'},{revision:1},{requested:'high'},{model:'gpt-6-sol'},{status:'matched'},{actual:'secret-unknown'},{evidence:'made_up'}])assert.equal(parse({...proof,...patch}),null);
  const maxContext={...context,config:{provider:'openai-codex',reasoningEffort:'max'}};
  const maxProof={...proof,requested:'max',effective:'max',actual:'max',nativeActual:'xhigh',mode:'verified_gpt61_sol_max',status:'matched',actualModel:'gpt-6.1-sol',phase:'request'};
  assert.equal(adapters.parseBotReasoningProof('ZIWEI_BOT_REASONING:'+JSON.stringify(maxProof),maxContext).mode,'verified_gpt61_sol_max');
  assert.equal(adapters.parseBotReasoningProof('ZIWEI_BOT_REASONING:'+JSON.stringify({...maxProof,actualModel:'gpt-6-sol'}),maxContext),null);
});
