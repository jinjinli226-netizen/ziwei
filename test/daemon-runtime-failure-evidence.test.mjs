import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {ActionDispatcher} from '../src/daemon.mjs';
import {hermesMcpSpawnSpec} from '../src/runtime-adapters.mjs';
import {provisionHermesBotProfile} from '../src/hermes-owned-profile.mjs';
import {inspectLocalDaemonMaintenanceFiles} from '../backend/preservation-native-evidence.mjs';
import {exitedTree} from '../backend/version-preservation.mjs';

const identity={workspace:'prelaunch-fixture',deviceId:'fixture-pc'};
const tree={platform:'win32',supervisor:'windows-job',launched:true,rootPid:12345,rootConfirmed:true,rootExitCode:125,treeConfirmed:true,activeProcesses:0,cancelled:false};
const action=(id='action_prelaunch')=>({id,type:'hermes.bot.provision',workspace:identity.workspace,payload:{deviceId:identity.deviceId,employeeId:'employee_fixture'}});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-runtime-failure-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const options={...identity,workdir:root,stateFile:path.join(root,'action-state.json'),stopGraceMs:10};
  const inspect=()=>inspectLocalDaemonMaintenanceFiles({connections:[{...identity,apiBase:'https://prelaunch.invalid',runtimeDir:root}]});
  return{root,options,inspect,state:()=>JSON.parse(fs.readFileSync(options.stateFile,'utf8'))};
}
function resolverError(root){const file=path.join(root,'unbound-hermes');fs.writeFileSync(file,'invalid native launcher');try{hermesMcpSpawnSpec(file,[]);}catch(error){return error;}throw Error('The fixture must refuse the launcher before spawning');}

test('actual Hermes provisioning resolver failure durably proves no runtime started and never reexecutes',async t=>{
  const f=fixture(t),home=path.join(f.root,'hermes');fs.mkdirSync(home);
  const original='model:\n  provider: openai-codex\n  default: fixture-no-model\n';fs.writeFileSync(path.join(home,'config.yaml'),original);
  const binary=path.join(f.root,'hermes-unbound');fs.writeFileSync(binary,'invalid native launcher');
  const context={workspace:identity.workspace,employeeId:'employee_fixture',deviceId:identity.deviceId,revision:1,sourceProfile:'bot-fixture',model:null,config:{},instance:{mode:'owned_profile',profile:'bot-fixture',templateProfile:'default',ownershipId:'fixture-owner',provisionActionId:'action_prelaunch'}};
  let executions=0,supervisors=0,authorizations=0;
  const dispatcher=new ActionDispatcher({...f.options,execute:async(_action,execution)=>{
    executions++;return provisionHermesBotProfile({context,baseHome:home,workspace:identity.workspace,apiBase:'https://prelaunch.invalid',binary,beforeSpawn:async()=>{authorizations++;},onSupervision:value=>{supervisors++;execution.onSupervision(value);}});
  }});
  const result=await dispatcher.dispatch(action());assert.equal(result.status,'failed');assert.equal(result.code,'HERMES_LAUNCHER_UNBOUND');assert.match(result.error,/绝对解释器/);
  assert.equal(result.result.prelaunch.phase,'before-native-probe');assert.equal(result.result.processExit.launched,false);assert.equal(result.result.processExit.rootConfirmed,false);assert.equal(exitedTree(result.result.processExit),true);
  assert.equal(supervisors,0);assert.equal(authorizations,0);assert.equal(executions,1);assert.equal(dispatcher.quarantined,false);
  assert.equal(fs.readFileSync(path.join(home,'config.yaml'),'utf8'),original);assert.equal(fs.existsSync(path.join(home,'profiles','bot-fixture')),false);
  assert.equal(f.state().started[0].nativeRuntime,true);assert.equal(exitedTree(f.state().completed[0].result.result.processExit),true);assert.equal(f.inspect().stopSafe,true);
  const restarted=new ActionDispatcher({...f.options,execute:async()=>{executions++;throw Error('must never reexecute');}}),duplicate=await restarted.dispatch(action());
  assert.equal(duplicate.status,'duplicate');assert.equal(duplicate.originalStatus,'failed');assert.equal(executions,1);assert.equal(restarted.quarantined,false);assert.equal(duplicate.result.processExit.launched,false);
});

for(const forged of [false,true])test(`an arbitrary native executor cannot claim prelaunch solely from no supervisor or forged fields (${forged})`,async t=>{
  const f=fixture(t),fake={platform:'win32',supervisor:'runtime-prelaunch',launched:false,rootPid:null,rootConfirmed:false,rootExitCode:null,treeConfirmed:true,activeProcesses:0};
  const error=Object.assign(Error('Hermes 原生入口未绑定可核实的绝对解释器'),forged?{code:'HERMES_LAUNCHER_UNBOUND',definitelyNotStarted:true,processExit:fake,prelaunch:{source:'hermes-launcher-resolver',phase:'before-native-probe'}}:{});
  const dispatcher=new ActionDispatcher({...f.options,execute:async()=>{throw error;}}),result=await dispatcher.dispatch(action());
  assert.equal(result.code,'EXECUTION_UNCERTAIN');assert.equal(result.reason,'EXECUTOR_WITHOUT_EXIT_EVIDENCE');assert.equal(result.result.processExit,null);assert.equal(dispatcher.quarantined,true);assert.equal(f.state().completed.length,0);assert.equal(f.inspect().stopSafe,false);
});

test('a failed native bootstrap probe is not reclassified as a resolver that never launched',async t=>{
  const f=fixture(t),launcher=path.join(f.root,'probe-launcher'),preload=path.join(f.root,'probe-start.cjs'),started=path.join(f.root,'probe-started');
  // Node is deliberately the bound fixture interpreter: it starts the probe,
  // writes a private marker, then rejects the Python bootstrap without a model.
  fs.writeFileSync(launcher,`#!"${process.execPath}"\nfrom hermes_cli.main import main\n`);
  fs.writeFileSync(preload,`require('node:fs').writeFileSync(${JSON.stringify(started)},'probe entered');`);
  const env={...process.env,NODE_OPTIONS:(process.env.NODE_OPTIONS||'')+' --require '+JSON.stringify(preload)},dispatcher=new ActionDispatcher({...f.options,execute:async()=>hermesMcpSpawnSpec(launcher,[],{env})});
  const result=await dispatcher.dispatch(action());assert.equal(fs.readFileSync(started,'utf8'),'probe entered');assert.equal(result.code,'EXECUTION_UNCERTAIN');assert.equal(result.result.processExit,null);assert.equal(dispatcher.quarantined,true);
});

test('a genuine prelaunch error capability is consumed once rather than reusable for another action',async t=>{
  const f=fixture(t),error=resolverError(f.root),dispatcher=new ActionDispatcher({...f.options,execute:async()=>{throw error;}});
  assert.equal((await dispatcher.dispatch(action())).result.processExit.launched,false);
  const reused=await dispatcher.dispatch(action('action_second'));assert.equal(reused.code,'EXECUTION_UNCERTAIN');assert.equal(reused.result.processExit,null);
});

test('supervised executor throws preserve its actual full exit and discard arbitrary error fields',async t=>{
  const f=fixture(t);let stops=0,executions=0;
  const dispatcher=new ActionDispatcher({...f.options,execute:async(_action,execution)=>{
    executions++;execution.onSupervision({completionEvidence:Promise.resolve({...tree,secret:'never persist'}),stop:async()=>{stops++;return tree;}});
    throw Object.assign(Error('post-launch exception'),{processExit:{...tree,rootPid:99999},code:'FIXTURE_EXECUTOR_THROW'});
  }});
  const result=await dispatcher.dispatch(action());assert.equal(result.status,'failed');assert.equal(result.code,'executor_failed');assert.equal(result.result.processExit.rootPid,tree.rootPid);assert.equal(result.result.processExit.rootExitCode,125);assert.equal(exitedTree(result.result.processExit),true);assert.equal(stops,0);assert.equal(dispatcher.quarantined,false);
  assert.equal(JSON.stringify(f.state()).includes('never persist'),false);assert.equal(f.inspect().stopSafe,true);
  const restarted=new ActionDispatcher({...f.options,execute:async()=>{executions++;throw Error('must not run');}});assert.equal((await restarted.dispatch(action())).originalStatus,'failed');assert.equal(executions,1);
});

test('a resolver error after a supervisor is registered cannot replace real launched evidence',async t=>{
  const f=fixture(t),error=resolverError(f.root),dispatcher=new ActionDispatcher({...f.options,execute:async(_action,execution)=>{execution.onSupervision({completionEvidence:Promise.resolve(tree),stop:async()=>tree});throw error;}});
  const result=await dispatcher.dispatch(action());assert.equal(result.result.processExit.launched,true);assert.equal(result.result.processExit.rootPid,tree.rootPid);assert.equal(result.result.prelaunch,undefined);
});

test('executor throw stops an incomplete runtime and waits for real tree evidence',async t=>{
  const f=fixture(t),stopped=deferred();let stops=0;
  const dispatcher=new ActionDispatcher({...f.options,stopGraceMs:100,execute:async(_action,execution)=>{
    execution.onSupervision({completionEvidence:stopped.promise,stop:async()=>{stops++;await delay(5);stopped.resolve({...tree,cancelled:true});return stopped.promise;}});throw Error('executor cleanup failed');
  }});
  const result=await dispatcher.dispatch(action());assert.equal(result.status,'failed');assert.equal(result.code,'executor_failed');assert.equal(result.error,'executor cleanup failed');assert.equal(stops,1);assert.equal(exitedTree(result.result.processExit),true);assert.equal(dispatcher.quarantined,false);
});

test('unknown tree after executor throw stays quarantined until a late real exit settles the original ID',async t=>{
  const f=fixture(t),completion=deferred(),events=[];let stops=0,executions=0;
  const dispatcher=new ActionDispatcher({...f.options,onEvent:(name,data)=>events.push({name,data}),execute:async(_action,execution)=>{
    executions++;execution.onSupervision({completionEvidence:completion.promise,stop:async()=>{stops++;return {...tree,treeConfirmed:false,activeProcesses:1};}});throw Error('original executor exception');
  }});
  const result=await dispatcher.dispatch(action());assert.equal(result.code,'EXECUTION_UNCERTAIN');assert.equal(result.reason,'EXECUTOR_EXIT_UNCONFIRMED');assert.equal(result.result.processExit.treeConfirmed,false);assert.equal(dispatcher.quarantined,true);assert.equal(f.state().completed.length,0);assert.equal(stops,1);
  assert.equal((await dispatcher.dispatch(action('action_blocked'))).reason,'EXECUTION_QUARANTINED');assert.equal(executions,1);
  completion.resolve(tree);await delay(15);assert.equal(dispatcher.quarantined,false);const recovered=dispatcher.completedResult(action());assert.equal(recovered.originalStatus,'failed');assert.equal(recovered.error,'original executor exception');assert.equal(exitedTree(recovered.result.processExit),true);assert.equal(f.inspect().stopSafe,true);assert.equal(events.some(event=>event.name==='action.result_recovered'),true);
  assert.equal((await dispatcher.dispatch(action())).status,'duplicate');assert.equal(executions,1);
});

test('complete runtime-group child evidence survives a supervised exception without leaking extra fields',async t=>{
  const f=fixture(t),group={platform:'win32',supervisor:'runtime-group',launched:true,rootPid:null,rootExitCode:null,rootConfirmed:true,treeConfirmed:true,activeProcesses:0,children:[{...tree,secret:'private child diagnostic'}]},dispatcher=new ActionDispatcher({...f.options,execute:async(_action,execution)=>{execution.onSupervision({completionEvidence:Promise.resolve(group),stop:async()=>group});throw Error('group executor failed');}});
  const result=await dispatcher.dispatch(action());assert.equal(result.code,'executor_failed');assert.equal(exitedTree(result.result.processExit),true);assert.equal(result.result.processExit.children[0].rootPid,tree.rootPid);assert.equal(JSON.stringify(result).includes('private child diagnostic'),false);
});

test('even a falsey thrown value cannot become a successful supervised completion',async t=>{
  const f=fixture(t),dispatcher=new ActionDispatcher({...f.options,execute:async(_action,execution)=>{execution.onSupervision({completionEvidence:Promise.resolve(tree),stop:async()=>tree});throw undefined;}});
  const result=await dispatcher.dispatch(action());assert.equal(result.status,'failed');assert.equal(result.error,'undefined');assert.equal(exitedTree(result.result.processExit),true);
});


test('a rejected additional supervisor cannot use the first root exit as proof for the whole action',async t=>{
  const f=fixture(t),dispatcher=new ActionDispatcher({...f.options,execute:async(_action,execution)=>{
    const supervisor={completionEvidence:Promise.resolve(tree),stop:async()=>tree};execution.onSupervision(supervisor);execution.onSupervision(supervisor);
  }});
  const result=await dispatcher.dispatch(action());assert.equal(result.code,'EXECUTION_UNCERTAIN');assert.equal(dispatcher.quarantined,true);assert.equal(f.state().completed.length,0);
  await delay(10);assert.equal(dispatcher.quarantined,true);
});

test('a rejected supervisor registration cannot borrow a later resolver error as no-launch proof',async t=>{
  const f=fixture(t),error=resolverError(f.root),dispatcher=new ActionDispatcher({...f.options,execute:async(_action,execution)=>{
    try{execution.onSupervision({});}catch{}
    throw error;
  }});
  const result=await dispatcher.dispatch(action());assert.equal(result.code,'EXECUTION_UNCERTAIN');assert.equal(result.result.processExit,null);assert.equal(dispatcher.quarantined,true);assert.equal(f.state().completed.length,0);
});
