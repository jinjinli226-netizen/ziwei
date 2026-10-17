import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRepository} from '../backend/repository.mjs';
import {createManagementService} from '../backend/management.mjs';
import {ActionDispatcher} from '../src/daemon.mjs';
import {createLocalActionExecutor} from '../src/local-action.mjs';
import {executeRuntime,resetRuntimeDiscovery} from '../src/runtime-adapters.mjs';
import {executeHermesNative} from '../src/hermes-native-runtime.mjs';
import {executeNativeDriver} from '../src/hermes-driver-runtime.mjs';
import {provisionHermesBotProfile} from '../src/hermes-owned-profile.mjs';
import {createGroupSupervision} from '../src/hermes-group-runtime.mjs';
import {markBotStartAdmissionDenied,runBeforeSpawnAdmission,consumeRuntimePrelaunchEvidence} from '../src/runtime-launch-evidence.mjs';

const scope={actionId:'action_admission',workspace:'test-111',employeeId:'employee_admission',deviceId:'admission-pc',profile:'default',revision:1,controlEpoch:2};
const denied=(patch={})=>markBotStartAdmissionDenied(Object.assign(new Error('Bot 配置或控制状态已变化，请重新读取'),{code:'BOT_REVISION_CONFLICT',definitelyNotStarted:true}),{...scope,status:409,code:'BOT_REVISION_CONFLICT',...patch});
const action=(patch={})=>({id:scope.actionId,type:'conversation.execute',workspace:scope.workspace,payload:{deviceId:scope.deviceId,runtime:'Hermes',prompt:'fixture only'},...patch});
const exit={platform:'win32',supervisor:'windows-job',launched:true,rootPid:37191,rootConfirmed:true,rootExitCode:0,treeConfirmed:true,activeProcesses:0,cancelled:false};
const posix={skip:process.platform==='win32'?'The isolated executable CLI fixture uses POSIX shebangs':false};

function directory(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-admission-prelaunch-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
function dispatcher(root,execute){return new ActionDispatcher({workdir:root,workspace:scope.workspace,deviceId:scope.deviceId,stateFile:path.join(root,'action-state.json'),stopGraceMs:10,execute});}

// This interpreter fixture only reports version/binding metadata. No native
// package, model, account, listener, or external service is used by these tests.
function nativeFixture(t){
  const root=directory(t),bin=path.join(root,'bin'),home=path.join(root,'hermes'),managed=path.join(root,'managed'),probe=path.join(root,'probe'),launched=path.join(root,'runtime-spawned');
  for(const dir of [bin,home,managed])fs.mkdirSync(dir);
  fs.writeFileSync(path.join(home,'config.yaml'),'model:\n  provider: custom:admission-fixture\n  default: fixture-model\nproviders:\n  admission-fixture:\n    key_env: ADMISSION_FIXTURE_PROVIDER_KEY\n');
  fs.writeFileSync(path.join(home,'.env'),'ADMISSION_FIXTURE_PROVIDER_KEY=ISOLATED_NOT_A_REAL_CREDENTIAL\n');
  fs.writeFileSync(path.join(managed,'config.yaml'),'{}\n');
  const interpreter=path.join(bin,'fixture-interpreter'),binary=path.join(bin,'hermes');
  fs.writeFileSync(interpreter,`#!${process.execPath}\nconst fs=require('node:fs'),args=process.argv.slice(2);if(args.includes('--version')||args.includes('--version-probe')){console.log('Hermes Agent 0.22.0');}else if(args.includes('--probe')){fs.writeFileSync(${JSON.stringify(probe)},'probe only');console.log(JSON.stringify({paths:{main:'fixture-main',mcp_startup:'fixture-startup',managed_scope:'fixture-managed'},fingerprint:'isolated-fixture'}));}else{fs.writeFileSync(${JSON.stringify(launched)},'launched');process.exit(91);}\n`,{mode:0o700});
  fs.writeFileSync(binary,`#!${interpreter}\nfrom hermes_cli.main import main\n`,{mode:0o700});
  const env={PATH:bin+path.delimiter+process.env.PATH,HERMES_HOME:home,HERMES_MANAGED_DIR:managed,CODEX_HOME:path.join(root,'codex'),NPM_CONFIG_USERCONFIG:path.join(root,'empty.npmrc')};
  fs.writeFileSync(env.NPM_CONFIG_USERCONFIG,'');
  const previous=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]));Object.assign(process.env,env);t.mock.method(os,'homedir',()=>root);resetRuntimeDiscovery();
  t.after(()=>{for(const[key,value]of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;resetRuntimeDiscovery();});
  return{root,home,binary,probe,launched,options:{runtime:'Hermes',prompt:'fixture only',cwd:root,env:{HERMES_HOME:home},beforeSpawn:async()=>{throw denied();}}};
}

function serverFixture(t){
  const repo=createRepository({memory:true}),management=createManagementService(repo),bots=management.bots;t.after(()=>repo.db.close());
  repo.heartbeatDevice(scope.workspace,{deviceId:scope.deviceId,runtimes:{Hermes:{status:'available',version:'0.22.0',profiles:[{name:'default'}]}}});
  const employee=management.createEmployee(scope.workspace,{name:'Admission fixture',runtime:'Hermes',runtimeProfile:'default',targetDeviceId:scope.deviceId,model:'fixture-model'});
  let bot=bots.initialize(scope.workspace,employee.id,{idempotencyKey:'initialize',config:{permissions:{mode:'read_only',management:false}}});
  const validation=bots.validate(scope.workspace,bot.id,{expectedRevision:bot.revision,idempotencyKey:'validate'}).action;
  repo.ackA2AAction(validation.id,{deviceId:scope.deviceId});repo.resultA2AAction(validation.id,{deviceId:scope.deviceId,status:'succeeded',result:{botValidation:{valid:true,schemaVersion:1,employeeId:bot.id,revision:bot.revision}}});
  bot=bots.control(scope.workspace,bot.id,{expectedRevision:bot.revision,expectedControlEpoch:bot.control_epoch,operation:'activate'});
  const message=repo.addConversationMessage(bot.main_conversation_id,{content:'Do not start after the control epoch changed'}),original=repo.getA2AAction(message.execution.id);
  repo.ackA2AAction(original.id,{deviceId:scope.deviceId});
  return{repo,bots,bot,original:repo.listA2AActions(scope.workspace,{status:'all'}).find(row=>row.id===original.id)};
}

test('real local action and final runtime admission rejection produce a durable non-quarantined failed receipt and clear Bot occupancy',posix,async t=>{
  const f=nativeFixture(t),s=serverFixture(t),requests=[];let registrations=0;
  t.mock.method(globalThis,'fetch',async(url)=>{
    requests.push(url);
    if(url.endsWith('/execution-admission'))return Response.json(s.repo.authorizeActionExecution(s.original.id,{deviceId:scope.deviceId}));
    assert.ok(url.endsWith('/bot-start'));
    s.bots.control(scope.workspace,s.bot.id,{operation:'pause',expectedRevision:s.bot.revision,expectedControlEpoch:s.bot.control_epoch});
    try{s.repo.authorizeBotStart(s.original.id,{deviceId:scope.deviceId});throw Error('must reject the stale epoch');}
    catch(error){assert.equal(error.code,'BOT_REVISION_CONFLICT');return Response.json({error:error.message,code:error.code,definitelyNotStarted:false,processExit:{launched:true,rootPid:999}},{status:error.status});}
  });
  const execute=createLocalActionExecutor({runtimeDir:path.join(f.root,'runtime'),defaultWorkdir:f.root,hermesHomePath:f.home,workspace:scope.workspace,apiBase:'https://admission.invalid',deviceId:scope.deviceId,deviceToken:'ISOLATED_DEVICE_FIXTURE',admissionHandledByDispatcher:true});
  const options={workdir:f.root,workspace:scope.workspace,deviceId:scope.deviceId,stateFile:path.join(f.root,'action-state.json'),authorizeExecute:execute.authorizeExecution,execute:async(a,c)=>execute(a,{...c,onSupervision:value=>{registrations++;c.onSupervision(value);}})};
  const controller=new ActionDispatcher(options),result=await controller.dispatch(s.original);
  assert.equal(result.status,'failed');assert.equal(result.code,'BOT_REVISION_CONFLICT',JSON.stringify(result));assert.equal(controller.quarantined,false);assert.equal(registrations,0);
  assert.equal(requests.length,2);assert.equal(fs.existsSync(f.probe),true);assert.equal(fs.existsSync(f.launched),false);
  assert.deepEqual(result.result.prelaunch,{schemaVersion:1,source:'bot-start-admission',phase:'before-runtime-spawn',spawnAttempted:false,method:'POST',operation:'bot-start',actionId:s.original.id,workspace:scope.workspace,employeeId:s.bot.id,deviceId:scope.deviceId,profile:'default',revision:s.bot.revision,controlEpoch:s.bot.control_epoch,denial:{status:409,code:'BOT_REVISION_CONFLICT'}});
  assert.equal(result.result.processExit.launched,false);assert.equal(result.result.processExit.treeConfirmed,true);assert.equal(result.result.processExit.activeProcesses,0);assert.equal(result.result.processExit.rootPid,null);
  assert.doesNotMatch(JSON.stringify(result),/ISOLATED_DEVICE_FIXTURE|ISOLATED_NOT_A_REAL_CREDENTIAL/);
  const stored=s.repo.resultA2AAction(s.original.id,{deviceId:scope.deviceId,status:result.status,error:result.error,result:result.result});
  assert.equal(stored.status,'failed');assert.equal(s.repo.db.prepare('SELECT active_action_id FROM hermes_bots WHERE employee_id=?').get(s.bot.id).active_action_id,null);
  assert.equal(s.bots.get(scope.workspace,s.bot.id).control_state,'paused');
  const restarted=new ActionDispatcher({...options,execute:async()=>{throw Error('must not execute again');}}),duplicate=await restarted.dispatch(s.original);
  assert.equal(duplicate.status,'duplicate');assert.equal(duplicate.originalStatus,'failed');assert.equal(restarted.quarantined,false);assert.equal(requests.length,2);
});

for(const kind of ['transport','json','server','forged'])test(`real local action does not trust an unsealed ${kind} admission response`,posix,async t=>{
  const f=nativeFixture(t),s=serverFixture(t);let registrations=0,starts=0;
  t.mock.method(globalThis,'fetch',async(url)=>{
    if(url.endsWith('/execution-admission'))return Response.json(s.repo.authorizeActionExecution(s.original.id,{deviceId:scope.deviceId}));
    assert.ok(url.endsWith('/bot-start'));starts++;
    if(kind==='transport')throw Object.assign(new Error('fixture network failure'),{definitelyNotStarted:true,code:'BOT_REVISION_CONFLICT'});
    if(kind==='json')return new Response('not JSON',{status:409});
    return Response.json({error:'fixture refusal',code:kind==='server'?'BOT_REVISION_CONFLICT':'FORGED_CODE',definitelyNotStarted:true,prelaunch:{source:'bot-start-admission',spawnAttempted:false},processExit:{launched:false,treeConfirmed:true,activeProcesses:0}},{status:kind==='server'?503:409});
  });
  const execute=createLocalActionExecutor({runtimeDir:path.join(f.root,'runtime'),defaultWorkdir:f.root,hermesHomePath:f.home,workspace:scope.workspace,apiBase:'https://admission.invalid',deviceId:scope.deviceId,deviceToken:'ISOLATED_DEVICE_FIXTURE',admissionHandledByDispatcher:true});
  const d=new ActionDispatcher({workdir:f.root,workspace:scope.workspace,deviceId:scope.deviceId,authorizeExecute:execute.authorizeExecution,execute:(a,c)=>execute(a,{...c,onSupervision:value=>{registrations++;c.onSupervision(value);}})}),result=await d.dispatch(s.original);
  assert.equal(starts,1);assert.equal(registrations,0);assert.equal(result.code,'EXECUTION_UNCERTAIN');assert.equal(result.result.processExit,null);assert.equal(d.quarantined,true);assert.equal(fs.existsSync(f.launched),false);
});

for(const code of ['BOT_REVISION_CONFLICT','BOT_NOT_ACTIVE','BOT_NOT_VALIDATED','BOT_START_INVALID'])test(`only a sealed final admission denial proves no spawn (${code})`,async t=>{
  const root=directory(t),d=dispatcher(root,()=>runBeforeSpawnAdmission(async()=>{throw denied({code});})),result=await d.dispatch(action());
  assert.equal(result.status,'failed');assert.equal(result.result.prelaunch.denial.code,code);assert.equal(result.result.processExit.launched,false);assert.equal(d.quarantined,false);
});

for(const patch of [{status:500},{status:200},{code:'UNRECOGNIZED_ADMISSION_FAILURE'},{revision:null}])test(`unrecognized or incomplete admission data cannot seal a no-launch proof (${JSON.stringify(patch)})`,async t=>{
  const root=directory(t),d=dispatcher(root,()=>runBeforeSpawnAdmission(async()=>{throw denied(patch);})),result=await d.dispatch(action());
  assert.equal(result.code,'EXECUTION_UNCERTAIN');assert.equal(result.result.processExit,null);assert.equal(d.quarantined,true);
});

for(const kind of ['flag','transport','json'])test(`ordinary beforeSpawn ${kind} failures cannot manufacture a no-launch receipt`,async t=>{
  const root=directory(t),error=kind==='json'?new SyntaxError('bad response JSON'):Object.assign(new Error('admission unavailable'),{definitelyNotStarted:true,code:'BOT_REVISION_CONFLICT',prelaunch:{schemaVersion:1,source:'bot-start-admission'},processExit:{launched:false,treeConfirmed:true,activeProcesses:0}});
  const d=dispatcher(root,()=>runBeforeSpawnAdmission(async()=>{throw error;})),result=await d.dispatch(action());
  assert.equal(result.code,'EXECUTION_UNCERTAIN');assert.equal(result.result.processExit,null);assert.equal(d.quarantined,true);
});

test('the intermediate admission marker alone and reuse of a consumed proof cannot bypass the final spawn boundary',async t=>{
  const root=directory(t),error=denied();assert.equal(consumeRuntimePrelaunchEvidence(error),null);
  const d=dispatcher(root,()=>{throw error;}),result=await d.dispatch(action());assert.equal(result.code,'EXECUTION_UNCERTAIN');
  const next=dispatcher(directory(t),()=>runBeforeSpawnAdmission(async()=>{throw denied();})),first=await next.dispatch(action());assert.equal(first.result.processExit.launched,false);
  const error2=denied();await assert.rejects(runBeforeSpawnAdmission(async()=>{throw error2;}));assert.ok(consumeRuntimePrelaunchEvidence(error2));assert.equal(consumeRuntimePrelaunchEvidence(error2),null);
});

test('the actual runtime adapter cannot seal a generic beforeSpawn Error with forged fields',posix,async t=>{
  const f=nativeFixture(t),d=dispatcher(f.root,()=>executeRuntime({...f.options,beforeSpawn:async()=>{throw Object.assign(new Error('generic callback failed'),{definitelyNotStarted:true,code:'BOT_REVISION_CONFLICT',processExit:{launched:false},prelaunch:{source:'bot-start-admission'}});}})),result=await d.dispatch(action());
  assert.equal(result.code,'EXECUTION_UNCERTAIN');assert.equal(result.result.processExit,null);assert.equal(d.quarantined,true);assert.equal(fs.existsSync(f.launched),false);
});

test('native operation final admission rejects before native preparation or process registration',async t=>{
  const root=directory(t);let registrations=0;
  const d=dispatcher(root,(_a,c)=>executeHermesNative({beforeSpawn:async()=>{throw denied();},onSupervision:value=>{registrations++;c.onSupervision(value);}})),result=await d.dispatch(action({type:'hermes.bot.native'}));
  assert.equal(result.result.processExit.launched,false);assert.equal(result.result.prelaunch.source,'bot-start-admission');assert.equal(d.quarantined,false);assert.equal(registrations,0);
});

for(const priorChild of [false,true])test(`native driver preserves its sealed prepare admission denial and actual prior helper evidence (${priorChild})`,async t=>{
  const root=directory(t),group=createGroupSupervision();group.add({completionEvidence:Promise.resolve(exit),stop:async()=>exit});group.seal();
  const original=action({type:'hermes.bot.native'}),d=dispatcher(root,(_a,c)=>{if(priorChild)c.onSupervision(group);return executeNativeDriver(original,{operation:{resource:'goals',operation:'step',input:{}},beforeSpawn:async()=>{throw denied();}});}),result=await d.dispatch(original);
  assert.equal(result.status,'failed');assert.equal(d.quarantined,false);
  if(priorChild){assert.equal(result.code,'executor_failed');assert.equal(result.result.prelaunch,undefined);assert.equal(result.result.processExit.launched,true);assert.equal(result.result.processExit.children[0].rootPid,exit.rootPid);}
  else{assert.equal(result.code,'BOT_REVISION_CONFLICT');assert.equal(result.result.prelaunch.source,'bot-start-admission');assert.equal(result.result.processExit.launched,false);}
});

test('owned profile admission rejects after a successful metadata probe but before profile creation or process registration',posix,async t=>{
  const f=nativeFixture(t);let registrations=0;
  const context={workspace:scope.workspace,employeeId:scope.employeeId,deviceId:scope.deviceId,revision:1,controlEpoch:2,sourceProfile:'bot-admission',model:'fixture-model',config:{},instance:{mode:'owned_profile',profile:'bot-admission',templateProfile:'default',ownershipId:'fixture-owner',provisionActionId:'action_admission'}};
  const d=dispatcher(f.root,(_a,c)=>provisionHermesBotProfile({context,baseHome:f.home,workspace:scope.workspace,apiBase:'https://admission.invalid',binary:f.binary,beforeSpawn:async()=>{throw denied({profile:'bot-admission'});},onSupervision:value=>{registrations++;c.onSupervision(value);}})),result=await d.dispatch(action({type:'hermes.bot.provision'}));
  assert.equal(result.result.processExit.launched,false);assert.equal(d.quarantined,false);assert.equal(registrations,0);assert.equal(fs.existsSync(f.probe),true);assert.equal(fs.existsSync(f.launched),false);assert.equal(fs.existsSync(path.join(f.home,'profiles','bot-admission')),false);
});

for(const entry of ['runtime','native','owned'])test(`a later ${entry} admission denial preserves the already supervised helper tree`,posix,async t=>{
  const f=nativeFixture(t),group=createGroupSupervision();group.add({completionEvidence:Promise.resolve(exit),stop:async()=>exit});group.seal();
  const context={workspace:scope.workspace,employeeId:scope.employeeId,deviceId:scope.deviceId,revision:1,controlEpoch:2,sourceProfile:'bot-admission',model:'fixture-model',config:{},instance:{mode:'owned_profile',profile:'bot-admission',templateProfile:'default',ownershipId:'fixture-owner',provisionActionId:'action_admission'}};
  const options={context,baseHome:f.home,workspace:scope.workspace,apiBase:'https://admission.invalid',binary:f.binary,beforeSpawn:async()=>{throw denied();}};
  const d=dispatcher(f.root,(_a,c)=>{c.onSupervision(group);return entry==='runtime'?executeRuntime(f.options):entry==='native'?executeHermesNative(options):provisionHermesBotProfile(options);}),result=await d.dispatch(action({type:entry==='runtime'?'conversation.execute':entry==='native'?'hermes.bot.native':'hermes.bot.provision'}));
  assert.equal(result.status,'failed');assert.equal(result.code,'executor_failed');assert.equal(result.result.prelaunch,undefined);assert.equal(result.result.processExit.supervisor,'runtime-group');assert.equal(result.result.processExit.launched,true);assert.equal(result.result.processExit.children[0].rootPid,exit.rootPid);assert.equal(d.quarantined,false);
});

test('an incomplete earlier helper tree stays uncertain despite a sealed later admission denial',async t=>{
  const root=directory(t),proof={...exit,treeConfirmed:false,activeProcesses:1},d=dispatcher(root,(_a,c)=>{c.onSupervision({completionEvidence:Promise.resolve(proof),stop:async()=>proof});return executeHermesNative({beforeSpawn:async()=>{throw denied();}});}),result=await d.dispatch(action({type:'hermes.bot.native'}));
  assert.equal(result.code,'EXECUTION_UNCERTAIN');assert.equal(result.result.prelaunch,undefined);assert.equal(result.result.processExit.launched,true);assert.equal(result.result.processExit.treeConfirmed,false);assert.equal(d.quarantined,true);
});

test('a post-spawn runtime exception cannot claim never-started through transport flags',async t=>{
  const root=directory(t),d=dispatcher(root,(_a,c)=>{c.onSupervision({completionEvidence:Promise.resolve(exit),stop:async()=>exit});throw Object.assign(new Error('after spawn'),{definitelyNotStarted:true,prelaunch:{source:'bot-start-admission'},processExit:{launched:false}});}),result=await d.dispatch(action());
  assert.equal(result.code,'executor_failed');assert.equal(result.result.prelaunch,undefined);assert.equal(result.result.processExit.launched,true);assert.equal(result.result.processExit.rootPid,exit.rootPid);assert.equal(d.quarantined,false);
});
