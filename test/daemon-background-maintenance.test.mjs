import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ActionDispatcher} from '../src/daemon.mjs';
import {createActionDelivery} from '../src/daemon-action-delivery.mjs';
import {isRetainedBackgroundCompletion,inspectLocalDaemonMaintenanceFiles,scanNativeFiles} from '../backend/preservation-native-evidence.mjs';

const identity={apiBase:'https://background.invalid',workspace:'background-test',deviceId:'background-pc'};
const exit={platform:'win32',supervisor:'windows-job',launched:true,rootPid:28996,rootConfirmed:true,rootExitCode:0,treeConfirmed:false,activeProcesses:1,cancelled:false,hostExitCode:0};
const sha=value=>createHash('sha256').update(value).digest('hex');
const snapshot=root=>Object.fromEntries(fs.readdirSync(root,{recursive:true}).filter(name=>fs.statSync(path.join(root,name)).isFile()).sort().map(name=>[name,sha(fs.readFileSync(path.join(root,name)))]));

async function fixture(t,{backgroundMarker}={}){
  const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'ziwei-background-maintenance-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const stateFile=path.join(root,'action-state.json'),directory=path.join(root,'action-delivery'),connection={...identity,runtimeDir:root};let executions=0,stops=0;
  const action={id:'original-background-action',type:'conversation.execute',workspace_id:'workspace-background',dedupe_key:'background-original',payload:{runtime:'Hermes',employeeId:'employee-background',deviceId:identity.deviceId,hermesBot:{employeeId:'employee-background',workspace:identity.workspace,deviceId:identity.deviceId,revision:4,controlEpoch:7}}};
  const dispatcher=new ActionDispatcher({workdir:root,workspace:identity.workspace,deviceId:identity.deviceId,stateFile,execute:async(_action,context)=>{
    const proof={...exit,...(backgroundMarker===undefined?{}:{backgroundProcessesRetained:backgroundMarker})};
    executions++;context.onSupervision({completionEvidence:Promise.resolve(proof),stop:async()=>{stops++;return proof;}});
    return{status:'succeeded',result:{runtime:'Hermes',code:0,output:'Original CLI completed; its background child may remain.',configurationRevision:4,botIsolation:{kind:'hermes-bot',employeeId:action.payload.employeeId,workspace:identity.workspace,revision:4}}};
  }});
  const delivery=createActionDelivery({directory,identity,dispatch:value=>dispatcher.dispatch(value),post:async(url,body)=>{
    if(url.endsWith('/ack'))return{id:action.id,status:'acked',deviceId:identity.deviceId,acked_at:new Date().toISOString(),expires_at:new Date(Date.now()+16*60000).toISOString()};
    if(url.endsWith('/events'))return{id:body.eventId};
    return{id:action.id,status:'succeeded'};
  }});
  assert.equal((await delivery.execute(action)).status,'succeeded');await delivery.whenIdle();
  const state=JSON.parse(fs.readFileSync(stateFile)),recordFile=path.join(directory,sha(JSON.stringify(action.id))+'.json');
  const inspect=()=>{const before=snapshot(root),value=inspectLocalDaemonMaintenanceFiles({connections:[connection]});assert.deepEqual(snapshot(root),before);return value;};
  const save=()=>fs.writeFileSync(stateFile,JSON.stringify(state));
  const input=()=>({started:state.started[0],completed:state.completed[0],identity,action});
  return{root,stateFile,recordFile,connection,action,dispatcher,state,save,inspect,input,get executions(){return executions;},get stops(){return stops;}};
}

test('the real dispatcher background-success history is retained unchanged for local stop only',async t=>{
  const f=await fixture(t),before=snapshot(f.root),local=f.inspect();
  assert.equal(isRetainedBackgroundCompletion(f.input()),true);
  assert.equal(isRetainedBackgroundCompletion({...f.input(),action:JSON.parse(fs.readFileSync(f.recordFile)).action}),true,'the original confirmed delivery uses its compact action');
  assert.equal(local.safe,false);assert.equal(local.stopSafe,true);assert.equal(local.retainedBackgroundCount,1);assert.equal(local.retainedDeliveryCount,0);assert.deepEqual(local.stopIssues,[]);
  assert.deepEqual(local.issues,[{code:'BACKGROUND_PROCESS_RETAINED',actionId:f.action.id,path:f.stateFile}]);
  const formal=scanNativeFiles({connections:[f.connection]});assert.equal(formal.safe,false);assert.equal(Object.hasOwn(formal,'stopSafe'),false);assert.equal(Object.hasOwn(formal,'retainedBackgroundCount'),false);
  assert.equal(f.state.completed[0].result.result.processExit.treeConfirmed,false);assert.equal(f.state.completed[0].result.result.processExit.activeProcesses,1);
  const restarted=new ActionDispatcher({workdir:f.root,stateFile:f.stateFile,workspace:identity.workspace,deviceId:identity.deviceId,execute:async()=>{throw Error('Never replay the original background action');}});
  const replay=await restarted.dispatch(f.action);assert.equal(replay.status,'duplicate');assert.equal(replay.originalStatus,'succeeded');assert.equal(replay.result.processExit.treeConfirmed,false);
  assert.equal(f.executions,1);assert.equal(f.stops,0);assert.deepEqual(snapshot(f.root),before);
});

test('new explicit background retention survives the real dispatcher cache and remains honest about the live child',async t=>{
  const f=await fixture(t,{backgroundMarker:true});
  assert.equal(f.state.completed[0].result.result.processExit.backgroundProcessesRetained,true);
  assert.equal(isRetainedBackgroundCompletion(f.input()),true);assert.equal(f.inspect().stopSafe,true);assert.equal(f.inspect().safe,false);
});

const invalid={
  'failed outer result':f=>{f.state.completed[0].result.status='failed';},
  'a success with a failure message':f=>{f.state.completed[0].result.error='contradictory failure';},
  'unpaired completion':f=>{f.state.started=[];},
  'different completed action':f=>{f.state.completed[0].result.actionId='different-action';},
  'different completed identity':f=>{f.state.completed[0].identity={...f.state.completed[0].identity,deviceId:'other-pc'};},
  'different workspace identity':f=>{for(const row of [f.state.started[0],f.state.completed[0]])row.identity.workspace='other-workspace';},
  'different target identity':f=>{for(const row of [f.state.started[0],f.state.completed[0]])row.identity.targetDeviceId='other-pc';},
  'not native':f=>{f.state.started[0].nativeRuntime=false;},
  'missing resource binding':f=>{delete f.state.started[0].resourceBinding;},
  'maintenance action binding':f=>{f.state.started[0].resourceBinding.type='hermes.bot.validate';},
  'unexpected resource binding':f=>{f.state.started[0].resourceBinding.resource='gateway';},
  'wrong employee binding':f=>{f.state.started[0].resourceBinding.employeeId='other-employee';},
  'wrong saved revision':f=>{f.state.started[0].resourceBinding.revision=5;},
  'malformed control epoch':f=>{f.state.started[0].resourceBinding.controlEpoch=null;},
  'unknown quarantine':f=>{f.state.started[0].quarantine={stopConfirmed:false};},
  'even an old confirmed quarantine':f=>{f.state.started[0].quarantine={stopConfirmed:true};},
  'completion before start':f=>{f.state.completed[0].result.completedAt=f.state.started[0].startedAt-1;},
  'cancelled result':f=>{f.state.completed[0].result.result.processExit.cancelled=true;},
  'root failure':f=>{f.state.completed[0].result.result.processExit.rootExitCode=1;},
  'supervisor failure':f=>{f.state.completed[0].result.result.processExit.hostExitCode=1;},
  'missing supervisor exit':f=>{delete f.state.completed[0].result.result.processExit.hostExitCode;},
  'unconfirmed root':f=>{f.state.completed[0].result.result.processExit.rootConfirmed=false;},
  'unlaunched root':f=>{f.state.completed[0].result.result.processExit.launched=false;},
  'missing root PID':f=>{f.state.completed[0].result.result.processExit.rootPid=null;},
  'unknown active count':f=>{f.state.completed[0].result.result.processExit.activeProcesses=null;},
  'zero active without confirmed tree':f=>{f.state.completed[0].result.result.processExit.activeProcesses=0;},
  'fractional active count':f=>{f.state.completed[0].result.result.processExit.activeProcesses=1.5;},
  'non-Windows evidence':f=>{f.state.completed[0].result.result.processExit.platform='darwin';},
  'unknown supervisor':f=>{f.state.completed[0].result.result.processExit.supervisor='direct';},
  'native failure code':f=>{f.state.completed[0].result.result.processExit.failureCode='RUNTIME_UNCONFIRMED';},
  'termination signal':f=>{f.state.completed[0].result.result.processExit.signal='SIGTERM';},
  'incomplete streams':f=>{f.state.completed[0].result.result.processExit.streamsComplete=false;},
  'a contradictory background marker':f=>{f.state.completed[0].result.result.processExit.backgroundProcessesRetained=false;},
  'a nonboolean background marker':f=>{f.state.completed[0].result.result.processExit.backgroundProcessesRetained='true';},
  'explicit execution uncertainty':f=>{f.state.completed[0].result.result.executionState='uncertain';},
  'nested pending execution':f=>{f.state.completed[0].result.result.other={execution_state:'pending'};},
  'another nested unknown exit':f=>{f.state.completed[0].result.result.other={processExit:{treeConfirmed:false,activeProcesses:1}};},
  'nested Gateway worker':f=>{f.state.completed[0].result.result.other={nativeOperation:{resource:'gateway',data:{residentWorker:{rootPid:43,processAlive:true}}}};},
  'nested resident exit':f=>{f.state.completed[0].result.result.other={residentExit:{worker:{rootPid:43}}};},
  'nested quarantine':f=>{f.state.completed[0].result.result.other={quarantine:{stopConfirmed:false}};},
  'nested live worker':f=>{f.state.completed[0].result.result.other={processAlive:true};},
  'nested worker with unknown liveness':f=>{f.state.completed[0].result.result.other={processAlive:null};},
  'nested unknown quarantine state':f=>{f.state.completed[0].result.result.other={quarantined:null};},
  'outer unknown exit':f=>{f.state.completed[0].result.processExit={};},
  'fixture evidence':f=>{f.state.completed[0].result.result.executionSource='fixture';},
  'a Gateway receipt':f=>{f.state.completed[0].result.result.nativeOperation={resource:'gateway'};},
};
for(const[name,mutate]of Object.entries(invalid))test(`retained background history refuses ${name}`,async t=>{
  const f=await fixture(t);mutate(f);f.save();assert.equal(isRetainedBackgroundCompletion(f.input()),false);assert.equal(f.inspect().stopSafe,false);assert.equal(f.stops,0);
});

test('the shared validator binds both full and compact original actions instead of accepting conflicting scope',async t=>{
  const f=await fixture(t);
  for(const mutate of [value=>{value.id='other';},value=>{value.type='agent.execute';},value=>{value.dedupe_key='other';},value=>{value.workspace_id='other';},value=>{value.payload.employeeId='other';},value=>{value.payload.deviceId='other';},value=>{value.payload.hermesBot.controlEpoch++;}]){
    const action=structuredClone(f.action);mutate(action);assert.equal(isRetainedBackgroundCompletion({...f.input(),action}),false);
  }
});

test('pending or corrupt delivery and another uncertain action still block shutdown beside valid background history',async t=>{
  for(const kind of ['pending','corrupt','unfinished'])await t.test(kind,async t=>{
    const f=await fixture(t);
    if(kind==='pending'){const record=JSON.parse(fs.readFileSync(f.recordFile));record.events=[{type:'unflushed'}];fs.writeFileSync(f.recordFile,JSON.stringify(record));}
    else if(kind==='corrupt')fs.writeFileSync(f.recordFile,'{broken');
    else{f.state.started.push({...structuredClone(f.state.started[0]),key:'unfinished',actionId:'unfinished'});f.save();}
    const result=f.inspect();assert.equal(result.safe,false);assert.equal(result.stopSafe,false);assert.equal(result.retainedBackgroundCount,1);assert(result.stopIssues.length>0);assert(result.issues.some(row=>row.code==='BACKGROUND_PROCESS_RETAINED'));
  });
});

test('each valid background action is counted once without duplicating execution or changing original history',async t=>{
  const f=await fixture(t),started=structuredClone(f.state.started[0]),completed=structuredClone(f.state.completed[0]);
  started.key=completed.key='other-background-key';started.actionId=completed.result.actionId='other-background-action';f.state.started.push(started);f.state.completed.push(completed);f.save();
  const result=f.inspect();assert.equal(result.stopSafe,true);assert.equal(result.retainedBackgroundCount,2);assert.equal(result.issues.length,2);
});

test('duplicate action identities under different dedupe keys are never retained as a valid background pair',async t=>{
  const f=await fixture(t),started=structuredClone(f.state.started[0]),completed=structuredClone(f.state.completed[0]);
  started.key=completed.key='conflicting-dedupe-key';f.state.started.push(started);f.state.completed.push(completed);f.save();
  assert.equal(f.inspect().stopSafe,false);
});
