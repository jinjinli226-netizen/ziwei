import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ActionDispatcher} from '../src/daemon.mjs';
import {createActionDelivery} from '../src/daemon-action-delivery.mjs';
import {inspectLocalDaemonMaintenanceFiles,scanNativeFiles} from '../backend/preservation-native-evidence.mjs';

const identity={workspace:'history-test',deviceId:'history-device',apiBase:'https://history.invalid'};
const tree={platform:'win32',supervisor:'windows-job',launched:true,rootPid:12345,rootConfirmed:true,rootExitCode:0,hostExitCode:0,treeConfirmed:true,activeProcesses:0,cancelled:false};
const action=()=>({id:'history-action',dedupe_key:'history-key',type:'conversation.execute',workspace:identity.workspace,payload:{deviceId:identity.deviceId,employeeId:'employee-history'}});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const snapshot=root=>Object.fromEntries(fs.readdirSync(root,{recursive:true}).filter(name=>fs.statSync(path.join(root,name)).isFile()).sort().map(name=>[name,sha(fs.readFileSync(path.join(root,name)))]));
function fixture(t){
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-local-history-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const options={workspace:identity.workspace,deviceId:identity.deviceId,workdir:root,stateFile:path.join(root,'action-state.json')},connections=[{...identity,runtimeDir:root}];
  const orphan={key:'old-orphan',identity:{workspace:identity.workspace,deviceId:identity.deviceId,targetDeviceId:identity.deviceId},result:{status:'failed',actionId:'old-orphan-action',error:'The operation was aborted due to timeout',completedAt:1}};
  return{root,options,connections,orphan,write:state=>fs.writeFileSync(options.stateFile,JSON.stringify(state)),inspect:()=>inspectLocalDaemonMaintenanceFiles({connections})};
}

test('an old scoped terminal orphan remains byte-for-byte history, not invented admission or exit proof',async t=>{
  const f=fixture(t);f.write({version:2,started:[],completed:[f.orphan]});const before=snapshot(f.root),evidence=f.inspect();
  assert.equal(evidence.safe,false);assert.equal(evidence.stopSafe,true);assert.equal(evidence.retainedHistoryCount,1);assert.deepEqual(evidence.stopIssues,[]);assert.equal(evidence.issues[0].code,'LOCAL_HISTORY_RETAINED');
  assert.equal(scanNativeFiles({connections:f.connections}).safe,false);assert.deepEqual(snapshot(f.root),before);
  let calls=0;const dispatcher=new ActionDispatcher({...f.options,execute:async()=>{calls++;}}),original={...action(),id:f.orphan.result.actionId,dedupe_key:f.orphan.key};delete original.workspace;const duplicate=await dispatcher.dispatch(original);assert.equal(duplicate.status,'duplicate');assert.equal(calls,0);assert.deepEqual(snapshot(f.root),before);
  assert.equal(Object.hasOwn(f.orphan,'admissionRejected'),false);assert.equal(Object.hasOwn(f.orphan.result,'processExit'),false);
});

for(const change of [state=>{state.completed[0].identity.deviceId='other';},state=>{state.completed[0].identity.targetDeviceId='other';},state=>{state.completed[0].result.status='running';},state=>{state.completed[0].result.completedAt=null;},state=>{state.started=[{key:'other-key',actionId:state.completed[0].result.actionId,identity:state.completed[0].identity,startedAt:1,nativeRuntime:true}];},state=>{state.completed[0].result.result={nativeOperation:{resource:'gateway',data:{residentWorker:{processAlive:true}}}};}])test('retained old history never hides a scope, structure, action collision or Gateway defect',t=>{
  const f=fixture(t),state={version:2,started:[],completed:[structuredClone(f.orphan)]};change(state);f.write(state);const before=snapshot(f.root);assert.equal(f.inspect().stopSafe,false);assert.deepEqual(snapshot(f.root),before);
});

test('started without a completion and genuine quarantine still block local maintenance',t=>{
  const f=fixture(t);f.write({version:2,started:[{key:'active',actionId:'active-action',identity:{workspace:identity.workspace,deviceId:identity.deviceId},startedAt:1,nativeRuntime:true,quarantine:{reason:'EXECUTOR_WITHOUT_EXIT_EVIDENCE',stopConfirmed:false}}],completed:[f.orphan]});
  const evidence=f.inspect();assert.equal(evidence.retainedHistoryCount,1);assert.equal(evidence.stopSafe,false);assert(evidence.stopIssues.some(row=>row.code==='STARTED_WITHOUT_RESULT'));
});

test('a completed real CLI exit dominates nested business uncertainty while every original delivery byte survives',async t=>{
  const f=fixture(t),dispatcher=new ActionDispatcher({...f.options,execute:async()=>({status:'failed',code:'business_failed',error:'phone screenshot outcome uncertain',result:{processExit:tree,phone:{status:'uncertain',processExit:{treeConfirmed:false,activeProcesses:1}}}})});
  const delivery=createActionDelivery({directory:path.join(f.root,'action-delivery'),identity,retryDelays:[],dispatch:value=>dispatcher.dispatch(value),recoverResult:value=>dispatcher.completedResult(value),post:async(url,body)=>{
    if(url.endsWith('/ack'))return{id:action().id,status:'acked',deviceId:identity.deviceId,acked_at:new Date().toISOString(),expires_at:new Date(Date.now()+1000000).toISOString()};
    if(url.endsWith('/events'))return{id:body.eventId};throw Object.assign(Error('server result rejected'),{status:400});
  }});
  await assert.rejects(delivery.execute(action()),/rejected/);await delivery.whenIdle();
  const state=JSON.parse(fs.readFileSync(f.options.stateFile));state.completed.push(f.orphan);f.write(state);const before=snapshot(f.root),evidence=f.inspect();
  assert.equal(evidence.safe,false);assert.equal(evidence.stopSafe,true);assert.equal(evidence.retainedHistoryCount,2);assert.equal(evidence.retainedDeliveryCount,1);assert.deepEqual(evidence.stopIssues,[]);assert.deepEqual(snapshot(f.root),before);assert.equal(scanNativeFiles({connections:f.connections}).safe,false);
  state.completed[0].result.result.processExit.treeConfirmed=false;state.completed[0].result.result.processExit.activeProcesses=1;f.write(state);assert.equal(f.inspect().stopSafe,false,'unknown authoritative CLI exit still blocks');
});

test('a completed quarantine does not borrow a real exit to silently clear its unresolved control state',t=>{
  const f=fixture(t),storedIdentity={workspace:identity.workspace,deviceId:identity.deviceId};f.write({version:2,started:[{key:'quarantined',actionId:'quarantined-action',identity:storedIdentity,startedAt:1,nativeRuntime:true,quarantine:{reason:'ROOT_EXIT_UNCONFIRMED',stopConfirmed:false}}],completed:[{key:'quarantined',identity:storedIdentity,result:{status:'failed',actionId:'quarantined-action',completedAt:2,result:{processExit:tree}}}]});
  assert.equal(f.inspect().stopSafe,false);assert(f.inspect().stopIssues.some(row=>row.code==='ACTION_QUARANTINE_UNCONFIRMED'));
});

test('malformed JSON is preserved and cannot become retained terminal history',t=>{const f=fixture(t);fs.writeFileSync(f.options.stateFile,'{broken');assert.equal(f.inspect().stopSafe,false);assert.equal(fs.readFileSync(f.options.stateFile,'utf8'),'{broken');});

function terminalConversationFailure(id='old-conversation',error='The operation was aborted due to timeout'){
  const key=`dedupe-${id}`,storedIdentity={workspace:identity.workspace,deviceId:identity.deviceId,workspaceId:'ws-history',targetDeviceId:identity.deviceId,actionWorkspace:identity.workspace};
  const started={key,actionId:id,identity:storedIdentity,startedAt:1000,nativeRuntime:true,resourceBinding:{type:'conversation.execute',employeeId:'employee-history',revision:7,controlEpoch:13,resource:null,operation:null,platform:null}};
  const completed={key,identity:{...storedIdentity},result:{status:'failed',actionId:id,error,completedAt:2000}};
  return{started,completed};
}

test('paired old chat failure envelopes retain history without claiming dispatch or exit and never replay',async t=>{
  const f=fixture(t),rows=[terminalConversationFailure(),terminalConversationFailure('old-phone-admission','手机MCP执行授权服务无法连接；未启动手机工具')],state={version:2,started:rows.map(row=>row.started),completed:rows.map(row=>row.completed)};f.write(state);
  const before=snapshot(f.root),evidence=f.inspect();assert.equal(evidence.safe,false);assert.equal(evidence.stopSafe,true);assert.equal(evidence.retainedHistoryCount,2);assert.deepEqual(evidence.stopIssues,[]);assert(evidence.issues.every(row=>row.code==='LOCAL_HISTORY_RETAINED'&&row.reason==='conversation_failure_envelope'));
  assert.equal(scanNativeFiles({connections:f.connections}).safe,false);assert.deepEqual(snapshot(f.root),before);
  let calls=0;const dispatcher=new ActionDispatcher({...f.options,execute:async()=>{calls++;}});
  for(const row of rows){const duplicate=await dispatcher.dispatch({...action(),id:row.started.actionId,dedupe_key:row.started.key,workspace_id:'ws-history'});assert.equal(duplicate.status,'duplicate');assert.equal(duplicate.originalStatus,'failed');assert.equal(duplicate.error,row.completed.result.error);}
  assert.equal(calls,0);assert.deepEqual(snapshot(f.root),before);
  for(const row of JSON.parse(fs.readFileSync(f.options.stateFile)).completed){assert.equal(Object.hasOwn(row,'admissionRejected'),false);assert.deepEqual(Object.keys(row.result).sort(),['actionId','completedAt','error','status']);}
});

const nonHistoricalFailure={
  'an actual execution output, even null':row=>{row.completed.result.result=null;},
  'an unknown process exit':row=>{row.completed.result.processExit={treeConfirmed:false,activeProcesses:1};},
  'a runtime uncertainty code':row=>{row.completed.result.code='EXECUTION_UNCERTAIN';},
  'a real execution quarantine':row=>{row.started.quarantine={reason:'EXECUTOR_WITHOUT_EXIT_EVIDENCE',stopConfirmed:false};},
  'a Gateway/control operation':row=>{row.started.resourceBinding.type='hermes.bot.native';row.started.resourceBinding.resource='gateway';row.started.resourceBinding.operation='connect';},
  'another native runtime action type':row=>{row.started.resourceBinding.type='agent.execute';},
  'missing original bot revision':row=>{row.started.resourceBinding.revision=null;},
  'an invalid time ordering':row=>{row.completed.result.completedAt=999;},
  'a succeeded chat without exit proof':row=>{row.completed.result.status='succeeded';},
  'a contradictory completed scope':row=>{row.completed.identity.targetDeviceId='another-device';},
};
for(const [name,mutate]of Object.entries(nonHistoricalFailure))test(`terminal-envelope retention excludes ${name}`,t=>{
  const f=fixture(t),row=terminalConversationFailure();mutate(row);f.write({version:2,started:[row.started],completed:[row.completed]});const before=snapshot(f.root),evidence=f.inspect();assert.equal(evidence.stopSafe,false);assert.equal(evidence.retainedHistoryCount,0);assert.deepEqual(snapshot(f.root),before);
});

test('terminal-envelope history requires a unique pair and never covers an uncompleted start',t=>{
  const f=fixture(t),row=terminalConversationFailure(),other=structuredClone(row);other.started.key='another-key';other.completed.key='another-key';
  for(const state of [{version:2,started:[row.started,other.started],completed:[row.completed,other.completed]},{version:2,started:[row.started],completed:[]}]){f.write(state);const before=snapshot(f.root),evidence=f.inspect();assert.equal(evidence.stopSafe,false);assert.equal(evidence.retainedHistoryCount,0);assert.deepEqual(snapshot(f.root),before);}
});
