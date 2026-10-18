import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {parse as yaml} from 'yaml';
import {BOT_UNLIMITED_NATIVE_MAX_TURNS,effectiveBotMaxTurns,normalizeBotConfig,createDefaultBotConfig} from '../src/hermes-bot-config.mjs';
import {prepareHermesBotHome,executeRuntime,resetRuntimeDiscovery,validateHermesBotRuntime,withBotTurnLimitValidation} from '../src/runtime-adapters.mjs';

test('the explicit turn policy preserves legacy wire defaults and accepts only exact modes',()=>{
 const legacy=normalizeBotConfig();assert.equal(legacy.maxTurns,20);assert.equal(Object.hasOwn(legacy,'turnLimitMode'),false);assert.equal(Object.hasOwn(createDefaultBotConfig(),'turnLimitMode'),false);
 for(const maxTurns of [1,20,100]){
  assert.equal(effectiveBotMaxTurns({maxTurns}),maxTurns);
  for(const turnLimitMode of ['bounded','unlimited']){const config=normalizeBotConfig({maxTurns,turnLimitMode});assert.equal(config.maxTurns,maxTurns);assert.equal(config.turnLimitMode,turnLimitMode);assert.deepEqual(normalizeBotConfig(config),config);assert.equal(effectiveBotMaxTurns(config),turnLimitMode==='unlimited'?Number.MAX_SAFE_INTEGER:maxTurns);}
 }
 for(const turnLimitMode of [null,true,false,0,1,'','Unlimited','none',' bounded',{},[]])assert.throws(()=>normalizeBotConfig({turnLimitMode}),{code:'BOT_CONFIG_INVALID'});
 for(const maxTurns of [0,-1,101,1.5,'20',Infinity,NaN,Number.MAX_SAFE_INTEGER])for(const turnLimitMode of ['bounded','unlimited'])assert.throws(()=>normalizeBotConfig({maxTurns,turnLimitMode}),{code:'BOT_CONFIG_INVALID'});
 assert.equal(BOT_UNLIMITED_NATIVE_MAX_TURNS,Number.MAX_SAFE_INTEGER);assert.equal(JSON.parse(JSON.stringify(BOT_UNLIMITED_NATIVE_MAX_TURNS)),BOT_UNLIMITED_NATIVE_MAX_TURNS);assert.equal(Number.isSafeInteger(BOT_UNLIMITED_NATIVE_MAX_TURNS),true);
 const unlimited=normalizeBotConfig({turnLimitMode:'unlimited',maxTurns:7,drivers:{maxTotalTurns:9}});assert.equal(unlimited.maxTurns,7);assert.equal(unlimited.drivers.maxTotalTurns,9,'autonomous aggregate budgets are separate from one chat run');
});

function homeFixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-turn-policy-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const home=path.join(root,'hermes');fs.mkdirSync(home);
 const source='model:\n  provider: custom:turn-fixture\n  default: fixture-model\nproviders:\n  turn-fixture:\n    key_env: TURN_FIXTURE_PROVIDER_KEY\n';fs.writeFileSync(path.join(home,'config.yaml'),source);fs.writeFileSync(path.join(home,'.env'),'TURN_FIXTURE_PROVIDER_KEY=ISOLATED_NOT_A_REAL_CREDENTIAL\n');
 const context={employeeId:'employee_turn-fixture',workspace:'turn-fixture',revision:1,sourceProfile:'default',name:'Turn policy fixture',model:'fixture-model',config:{permissions:{mode:'read_only',management:false}}},options={context,sourceHome:home,privateDirectory:path.join(root,'bots'),workspace:context.workspace,apiBase:'https://fixture.invalid'};
 return {root,home,source,context,options};
}

test('saved native YAML can switch unlimited to bounded while retaining the finite budget and source profile',t=>{
 const f=homeFixture(t);
 for(const [turnLimitMode,maxTurns,native]of [['unlimited',7,Number.MAX_SAFE_INTEGER],['bounded',7,7],[undefined,100,100]]){
  const config={...f.context.config,maxTurns,...(turnLimitMode?{turnLimitMode}:{})},prepared=prepareHermesBotHome({...f.options,context:{...f.context,config}}),saved=yaml(fs.readFileSync(path.join(prepared.home,'config.yaml'),'utf8'));
  assert.equal(saved.agent.max_turns,native);assert.equal(saved.agent.max_turns,prepared.config.agent.max_turns);assert.equal(saved.agent.run_budget_seconds,86400);assert.equal(config.maxTurns,maxTurns);
 }
 assert.equal(fs.readFileSync(path.join(f.home,'config.yaml'),'utf8'),f.source);assert.equal(fs.existsSync(path.join(f.home,'state.db')),false);
});

// This installed-CLI-shaped fixture captures the actual spawned argv and YAML.
// It never imports a model SDK, uses credentials, opens a listener, or performs
// a provider request. Native model behavior is not claimed by these tests.
function cliFixture(t){
 const f=homeFixture(t),bin=path.join(f.root,'bin');fs.mkdirSync(bin);const interpreter=path.join(bin,'fixture-interpreter.cjs'),binary=path.join(bin,'hermes'),capture=path.join(f.root,'captured.json'),require=createRequire(import.meta.url);
 fs.writeFileSync(interpreter,`#!${process.execPath}\nconst fs=require('node:fs'),path=require('node:path'),args=process.argv.slice(2);\nif(args.includes('--version')||args.includes('--version-probe')){console.log('Hermes Agent 0.22.0');}else if(args.includes('--probe')){console.log(JSON.stringify({paths:{main:'fixture-main',mcp_startup:'fixture-startup',managed_scope:'fixture-managed'},fingerprint:'isolated-turn-fixture'}));}else{\n const yaml=require(${JSON.stringify(require.resolve('yaml'))}),home=process.env.ZIWEI_CREATOR_HOME,config=yaml.parse(fs.readFileSync(path.join(home,'config.yaml'),'utf8'));fs.writeFileSync(${JSON.stringify(capture)},JSON.stringify({args,config}));\n if(args.includes('--config-only')){const patch=fs.existsSync(${JSON.stringify(capture+'.patch')})?JSON.parse(fs.readFileSync(${JSON.stringify(capture+'.patch')},'utf8')):{};console.log(JSON.stringify({botValidation:{valid:true,schemaVersion:1,employeeId:process.env.ZIWEI_CREATOR_EMPLOYEE_ID,revision:Number(process.env.ZIWEI_BOT_REVISION),effective:{maxTurns:config.agent.max_turns},...patch},externalModelCalls:0}));}\n else{const isolation={enabled:true,key:process.env.ZIWEI_CREATOR_KEY,workspace:process.env.ZIWEI_CREATOR_WORKSPACE,employeeId:process.env.ZIWEI_CREATOR_EMPLOYEE_ID,sourceProfile:process.env.ZIWEI_CREATOR_PROFILE,authMode:'source-native-store',kind:'hermes-bot',revision:Number(process.env.ZIWEI_BOT_REVISION)};console.error('ZIWEI_CREATOR_ISOLATION:'+JSON.stringify(isolation));let input='';process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'isolated argv captured'}})));}\n}\n`,{mode:0o700});
 fs.writeFileSync(binary,`#!${interpreter}\nfrom hermes_cli.main import main\n`,{mode:0o700});
 const env={PATH:bin+path.delimiter+process.env.PATH,HERMES_HOME:f.home,CODEX_HOME:path.join(f.root,'codex'),NPM_CONFIG_USERCONFIG:path.join(f.root,'empty.npmrc')};fs.writeFileSync(env.NPM_CONFIG_USERCONFIG,'');const previous=new Map([...Object.keys(env),'HERMES_MANAGED_DIR'].map(key=>[key,process.env[key]]));Object.assign(process.env,env);delete process.env.HERMES_MANAGED_DIR;t.mock.method(os,'homedir',()=>f.root);resetRuntimeDiscovery();
 t.after(()=>{for(const[key,value]of previous)if(value===undefined)delete process.env[key];else process.env[key]=value;resetRuntimeDiscovery();});
 return {...f,binary,capture,env,validation:{context:f.context,baseHome:f.home,privateDirectory:path.join(f.root,'bots'),workspace:f.context.workspace,apiBase:f.options.apiBase,binary},read:()=>JSON.parse(fs.readFileSync(capture,'utf8'))};
}
const posix={skip:process.platform==='win32'?'The isolated CLI capture uses POSIX executable shebangs':false};

test('real adapter spawning sends the same exact positive ceiling as native YAML and retains the 24-hour budget',posix,async t=>{
 const f=cliFixture(t);
 for(const [turnLimitMode,maxTurns,effective]of [['unlimited',7,Number.MAX_SAFE_INTEGER],['bounded',7,7],[undefined,100,100]]){
  const config={...f.context.config,maxTurns,...(turnLimitMode?{turnLimitMode}:{})},context={...f.context,config},outcome=await executeRuntime({runtime:'Hermes',prompt:'isolated no-model argv fixture',cwd:f.root,env:f.env,hermesBot:context,botInstanceDirectory:f.options.privateDirectory,managementMcp:{workspace:context.workspace,apiBase:f.options.apiBase}});
  assert.equal(outcome.status,'succeeded',outcome.error);const {args,config:native}=f.read();assert.equal(args[args.indexOf('--max-turns')+1],String(effective));assert.equal(native.agent.max_turns,effective);assert.equal(args[args.indexOf('--run-budget')+1],'86400');assert.equal(native.agent.run_budget_seconds,86400);assert.equal(outcome.result.processExit.rootConfirmed,true);
  if(turnLimitMode)assert.deepEqual(outcome.result.turnLimit,{mode:turnLimitMode,maxTurns,effectiveMaxTurns:effective,runBudgetSeconds:86400,status:'configured'});else assert.equal(Object.hasOwn(outcome.result,'turnLimit'),false);
 }
});

test('native config-only validation binds explicit policy to the reported effective value',posix,t=>{
 const f=cliFixture(t),context={...f.context,config:{...f.context.config,turnLimitMode:'unlimited',maxTurns:7}},options={...f.validation,context};
 for(const [turnLimitMode,maxTurns,effective]of [['unlimited',7,Number.MAX_SAFE_INTEGER],['bounded',7,7],[undefined,20,20]]){
  const config={...f.context.config,maxTurns,...(turnLimitMode?{turnLimitMode}:{})},result=validateHermesBotRuntime({...options,context:{...context,config}});assert.equal(result.status,'succeeded',JSON.stringify(result));assert.equal(result.result.botValidation.effective.maxTurns,effective);assert.equal(result.result.externalModelCalls,0);
  if(turnLimitMode)assert.deepEqual(result.result.botValidation.effective.turnLimit,{mode:turnLimitMode,maxTurns,effectiveMaxTurns:effective,runBudgetSeconds:86400,status:'validated'});else assert.equal(Object.hasOwn(result.result.botValidation.effective,'turnLimit'),false);
 }
 for(const patch of [{effective:{maxTurns:100}},{effective:{maxTurns:0}},{effective:{maxTurns:String(Number.MAX_SAFE_INTEGER)}},{employeeId:'employee_other'},{revision:0}]){
  fs.writeFileSync(f.capture+'.patch',JSON.stringify(patch));assert.throws(()=>validateHermesBotRuntime(options),/轮数限制/);
 }
});

test('shared sync/supervised receipt matching retains existing confirmed process evidence on rejection',t=>{
 const f=homeFixture(t),context={...f.context,config:{...f.context.config,turnLimitMode:'unlimited',maxTurns:7}},prepared=prepareHermesBotHome({...f.options,context});
 // This is an input proof fixture for the receipt matcher, not an assertion
 // that a Windows Job was run on this machine. The Mac direct supervisor does
 // not attest an empty process tree and its strict validation stays unchanged.
 const processExit={platform:'win32',supervisor:'windows-job',launched:true,rootConfirmed:true,rootExitCode:0,treeConfirmed:true,activeProcesses:0,cancelled:false},receipt={processExit,botValidation:{valid:true,employeeId:context.employeeId,revision:context.revision,effective:{maxTurns:Number.MAX_SAFE_INTEGER}}};
 assert.equal(withBotTurnLimitValidation(receipt,{...context,config:undefined},prepared),receipt,'legacy requests without an explicit policy keep their existing receipt');
 assert.equal(withBotTurnLimitValidation(receipt,context,prepared).processExit,processExit);
 for(const patch of [{effective:{maxTurns:100}},{effective:{}},{employeeId:'other'},{revision:0}])assert.throws(()=>withBotTurnLimitValidation({...receipt,botValidation:{...receipt.botValidation,...patch}},context,prepared),error=>{assert.match(error.message,/轮数限制/);assert.equal(error.processExit,processExit);return true;});
});
