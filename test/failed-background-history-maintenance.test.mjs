import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ActionDispatcher} from '../src/daemon.mjs';
import {createActionDelivery} from '../src/daemon-action-delivery.mjs';
import {inspectLocalDaemonMaintenanceFiles,scanNativeFiles,isRetainedFailedBackgroundCompletion} from '../backend/preservation-native-evidence.mjs';
import {createLocalHistoryStopRecovery,LOCAL_HISTORY_STOP_HANDLE_PROGRAM} from '../scripts/client-local-history-stop-recovery.mjs';

const sha=v=>createHash('sha256').update(v).digest('hex');
const snapshots=root=>Object.fromEntries(fs.readdirSync(root,{recursive:true}).filter(n=>fs.statSync(path.join(root,n)).isFile()).sort().map(n=>[n,sha(fs.readFileSync(path.join(root,n)))]));
async function fixture(t,{deliveryState='result_pending',runtimeFailureCode='runtime_failed'}={}){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-failed-background-history-'))),home=path.join(root,'home'),runtime=path.join(home,'runtime');fs.mkdirSync(runtime,{recursive:true});t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const configPath=path.join(home,'ziwei_user.json'),config={workspace:'history-test',deviceId:'computer-test',apiBase:'https://history.invalid',deviceToken:'PRIVATE_TOKEN'};fs.writeFileSync(configPath,JSON.stringify(config));
 const identity={apiBase:config.apiBase,workspace:config.workspace,deviceId:config.deviceId},connection={...identity,runtimeDir:runtime},stateFile=path.join(runtime,'action-state.json'),action={id:'failed-root-with-background',type:'conversation.execute',workspace_id:'ws-history-test',workspace:config.workspace,dedupe_key:'original-key',payload:{runtime:'Hermes',employeeId:'employee-test',deviceId:config.deviceId,cwd:root,hermesBot:{employeeId:'employee-test',workspace:config.workspace,deviceId:config.deviceId,revision:7,controlEpoch:17}}};
 const exit={platform:'win32',supervisor:'windows-job',launched:true,rootPid:46856,rootConfirmed:true,rootExitCode:1,treeConfirmed:false,activeProcesses:3,cancelled:false,backgroundProcessesRetained:true,hostExitCode:0};
 const dispatcher=new ActionDispatcher({workdir:root,workspace:config.workspace,deviceId:config.deviceId,stateFile,execute:async(_action,context)=>{context.onSupervision({completionEvidence:Promise.resolve(exit),stop:async()=>exit});return{status:'failed',...(runtimeFailureCode?{code:runtimeFailureCode}:{}),error:'Provider context too long; prior phone result remains uncertain',result:{runtime:'Hermes',code:1,signal:null,executionState:'uncertain',terminalMcp:{executionState:'uncertain',failure:{code:'terminal_mcp_receipt_incomplete',phoneExecutionState:'uncertain',retryAllowed:false}},configurationRevision:7,botIsolation:{kind:'hermes-bot',employeeId:action.payload.employeeId,workspace:config.workspace,revision:7}}};}});
 const delivery=createActionDelivery({directory:path.join(runtime,'action-delivery'),identity,retryDelays:[],dispatch:a=>dispatcher.dispatch(a),post:async(url,body)=>{if(url.endsWith('/ack'))return{id:action.id,status:'acked',deviceId:config.deviceId,acked_at:new Date().toISOString(),expires_at:new Date(Date.now()+1_000_000).toISOString()};if(url.endsWith('/events'))return{id:body.eventId};if(deliveryState==='confirmed')return{id:action.id,status:'failed'};throw Object.assign(Error('result transport unavailable'),{status:deliveryState==='blocked'?400:503});}});
 if(deliveryState==='confirmed')await delivery.execute(action);else await assert.rejects(delivery.execute(action),/unavailable/);await delivery.whenIdle();
 const state=JSON.parse(fs.readFileSync(stateFile)),deliveryFile=path.join(runtime,'action-delivery',sha(JSON.stringify(action.id))+'.json'),record=JSON.parse(fs.readFileSync(deliveryFile));assert.equal(record.state,deliveryState);
 const inspect=()=>inspectLocalDaemonMaintenanceFiles({connections:[connection]}),input=()=>({started:state.started[0],completed:state.completed[0],identity,action}),save=()=>fs.writeFileSync(stateFile,JSON.stringify(state));
 const processRecord={pid:40628,creationTime:'2026-10-18T12:00:00.000Z',commandHash:'a'.repeat(64),executable:process.execPath},build='b'.repeat(64);let running=true,paused=false,kills=0,healthMutator=()=>{},inventoryMutator=v=>v;
 const health={service:'ziwei_user',agentId:'ziwei_user',pid:processRecord.pid,clientBuild:build,workspace:config.workspace,deviceId:config.deviceId,connectionState:'connected',activeActionCount:0,pollingCount:0,quarantinedActionCount:0,executionQuarantined:false,connectionErrors:[],connections:[{workspace:config.workspace,deviceId:config.deviceId,primary:true}],lifecycle:{nonce:'exact-daemon-instance-nonce',root,configPath,configSha256:sha(fs.readFileSync(configPath)),runtimeDir:runtime,startedAt:processRecord.creationTime,managedAuxiliaryCount:0},maintenance:{safe:false,stopSafe:false,pendingDeliveryCount:deliveryState==='result_pending'?1:0,blockedDeliveryCount:deliveryState==='blocked'?1:0,gatewaySafe:true,gatewayWorkers:[],fileIssues:[{code:'ACTION_STATE_CORRUPT',path:stateFile}]}};
 const fetchImpl=async(_url,options={})=>{if(!running)throw Object.assign(Error('offline'),{code:'ECONNREFUSED'});if(options.method==='POST'){const body=JSON.parse(options.body);assert.equal(body.nonce,health.lifecycle.nonce);assert.equal(options.headers['x-ziwei-local-control'],config.deviceToken);paused=body.operation==='pause';}const h=structuredClone(health);h.connectionState=paused?'draining':'connected';healthMutator(h);return{ok:true,json:async()=>h};};
 const make=(override={})=>createLocalHistoryStopRecovery({platform:'win32',inspect,inspectProcess:async()=>running?structuredClone(processRecord):null,inspectListener:async()=>({listenerPid:processRecord.pid}),inspectInstalledProcesses:async()=>inventoryMutator(running?[structuredClone(processRecord)]:[]),inspectListenerCount:async()=>running?1:0,installedBuild:()=>build,terminate:async data=>{assert.equal(data.retainedPendingCount,deliveryState==='result_pending'?1:0);kills++;running=false;const result={stopped:true,pid:processRecord.pid,creationTime:processRecord.creationTime,exitedAt:'2026-10-19T01:00:00.000Z'};fs.writeFileSync(data.exitFile,JSON.stringify(result));return result;},...override});
 return{root,home,runtime,stateFile,state,record,deliveryFile,connection,action,configPath,processRecord,health,inspect,input,save,make,recoveryInput:{root,configPath,env:{ZIWEI_USER_HOME:home},fetchImpl},get kills(){return kills;},get paused(){return paused;},set healthMutator(v){healthMutator=v;},set inventoryMutator(v){inventoryMutator=v;}};
}

for(const deliveryState of ['result_pending','blocked','confirmed'])test(`failed root with ${deliveryState} receipt releases only local maintenance without changing phone uncertainty or tree evidence`,async t=>{
 const f=await fixture(t,{deliveryState}),before=snapshots(f.runtime),e=f.inspect();assert.equal(f.state.completed[0].result.code,'runtime_failed','the dispatcher must preserve the real runtime adapter failure code');assert.equal(isRetainedFailedBackgroundCompletion(f.input()),true);assert.equal(e.safe,false);assert.equal(e.stopSafe,true);assert.equal(e.retainedFailedBackgroundCount,1);assert.equal(e.retainedPendingCount,deliveryState==='result_pending'?1:0);assert.equal(e.retainedDeliveryCount,1);assert.deepEqual(e.stopIssues,[]);assert(e.issues.some(v=>v.code==='FAILED_BACKGROUND_HISTORY_RETAINED'));assert.equal(scanNativeFiles({connections:[f.connection]}).safe,false);assert.deepEqual(snapshots(f.runtime),before);
 const result=await f.make()(f.recoveryInput);assert.equal(result.recovered,true);assert.equal(result.retainedPendingCount,e.retainedPendingCount);assert.equal(result.retainedFailedBackgroundCount,1);assert.equal(result.backgroundProcessesPreserved,true);assert.equal(result.originalExecutionExitConfirmed,false);assert.equal(result.executionConfirmedStopped,false);assert.equal(f.kills,1);assert.deepEqual(snapshots(f.runtime),before);
 const manifest=JSON.parse(fs.readFileSync(path.join(result.archiveDirectory,'manifest.json')));assert.equal(manifest.backgroundProcessesPreserved,true);assert.equal(manifest.originalExecutionExitConfirmed,false);assert.equal(manifest.retainedPendingCount,e.retainedPendingCount);const exit=f.state.completed[0].result.result.processExit;assert.equal(exit.treeConfirmed,false);assert.equal(exit.activeProcesses,3);assert.equal(f.state.completed[0].result.result.terminalMcp.failure.phoneExecutionState,'uncertain');assert.equal(scanNativeFiles({connections:[f.connection]}).safe,false);
 let replayed=0;const next=new ActionDispatcher({workdir:f.root,stateFile:f.stateFile,workspace:f.connection.workspace,deviceId:f.connection.deviceId,execute:async()=>{replayed++;}});assert.equal((await next.dispatch(f.action)).status,'duplicate');assert.equal(replayed,0);assert.deepEqual(snapshots(f.runtime),before);
});
const invalid={
 'exit code mismatch':f=>f.state.completed[0].result.result.code=2,
 'successful root':f=>f.state.completed[0].result.result.processExit.rootExitCode=0,
 'unconfirmed root':f=>f.state.completed[0].result.result.processExit.rootConfirmed=false,
 'missing retention marker':f=>delete f.state.completed[0].result.result.processExit.backgroundProcessesRetained,
 'false retention marker':f=>f.state.completed[0].result.result.processExit.backgroundProcessesRetained=false,
 'supervisor failure':f=>f.state.completed[0].result.result.processExit.hostExitCode=1,
 'unknown root pid':f=>f.state.completed[0].result.result.processExit.rootPid=null,
 'cancelled root':f=>f.state.completed[0].result.result.processExit.cancelled=true,
 'unknown process count':f=>f.state.completed[0].result.result.processExit.activeProcesses=null,
 'incomplete streams':f=>f.state.completed[0].result.result.processExit.streamsComplete=false,
 'different identity':f=>f.state.completed[0].identity.deviceId='other-device',
 'different workspace':f=>{f.state.started[0].identity.workspace='other';f.state.completed[0].identity.workspace='other';},
 'different revision':f=>f.state.completed[0].result.result.configurationRevision=8,
 'different isolation revision':f=>f.state.completed[0].result.result.botIsolation.revision=8,
 'different isolation employee':f=>f.state.completed[0].result.result.botIsolation.employeeId='other-employee',
 'quarantined root':f=>f.state.started[0].quarantine={stopConfirmed:false},
 'formerly quarantined root':f=>f.state.started[0].quarantine={stopConfirmed:true},
 'nested local execution unknown':f=>f.state.completed[0].result.result.localTool={executionState:'uncertain'},
 'nested local task still running':f=>f.state.completed[0].result.result.localTool={executionState:'running'},
 'unrecognized top level uncertainty':f=>{delete f.state.completed[0].result.result.terminalMcp;},
 'nested local exit unknown':f=>f.state.completed[0].result.result.localTool={processExit:{platform:'win32',treeConfirmed:false,activeProcesses:1}},
 'nested native operation':f=>f.state.completed[0].result.result.nativeOperation={resource:'mcp'},
 'nested resident worker':f=>f.state.completed[0].result.result.other={residentWorker:{rootPid:123}},
 'nested live process':f=>f.state.completed[0].result.result.other={processAlive:true},
 'nonterminal result':f=>f.state.completed[0].result.status='running',
 'different dispatcher code':f=>f.state.completed[0].result.code='EXECUTION_UNCERTAIN',
 'unrecognized runtime failure code':f=>f.state.completed[0].result.code='unreviewed_runtime_failure',
 'missing Bot revision':f=>{f.state.started[0].resourceBinding.revision=null;f.state.started[0].resourceBinding.controlEpoch=null;delete f.state.completed[0].result.result.configurationRevision;delete f.state.completed[0].result.result.botIsolation;},
 'unknown outer control state':f=>f.state.completed[0].result.executionState='running',
};
for(const[name,mutate]of Object.entries(invalid))test(`failed background history refuses ${name}`,async t=>{const f=await fixture(t);mutate(f);f.save();const before=snapshots(f.runtime);assert.equal(isRetainedFailedBackgroundCompletion(f.input()),false);assert.equal(f.inspect().stopSafe,false);assert.deepEqual(await f.make()(f.recoveryInput),{recovered:false,reason:'not_applicable'});assert.equal(f.kills,0);assert.deepEqual(snapshots(f.runtime),before);});
for(const version of [1,3])test(`failed background exception requires exact v2 state, refuses version ${version}`,async t=>{const f=await fixture(t);f.state.version=version;f.save();assert.equal(f.inspect().stopSafe,false);assert.equal(f.kills,0);});
for(const[name,change]of Object.entries({
 'another pending delivery':h=>h.maintenance.pendingDeliveryCount++,
 'pending count no longer matches':h=>h.maintenance.pendingDeliveryCount=0,
 'new live action':h=>h.activeActionCount++,
 'new live poll':h=>h.pollingCount++,
 'new quarantine':h=>h.quarantinedActionCount++,
 'new Gateway':h=>h.maintenance.gatewayWorkers=[{processAlive:true}],
}))test(`recovery never ignores ${name}`,async t=>{const f=await fixture(t);f.healthMutator=change;const before=snapshots(f.runtime);const result=await f.make()(f.recoveryInput).catch(e=>e);assert(result.recovered===false||result.code==='LOCAL_HISTORY_STOP_RECOVERY_REFUSED');assert.equal(f.kills,0);assert.deepEqual(snapshots(f.runtime),before);});
test('a second daemon in actual native inventory blocks exact-instance recovery',async t=>{const f=await fixture(t);f.inventoryMutator=rows=>[...rows,{...f.processRecord,pid:99999}];await assert.rejects(f.make()(f.recoveryInput),{code:'LOCAL_HISTORY_STOP_RECOVERY_REFUSED'});assert.equal(f.kills,0);});
test('a queued result must still match its original state outcome exactly',async t=>{const f=await fixture(t);const record=f.record,resultFile=f.deliveryFile.replace(/\.json$/,'.result.json'),value=JSON.parse(fs.readFileSync(resultFile));value.result.code=2;const bytes=Buffer.from(JSON.stringify(value));fs.writeFileSync(resultFile,bytes);record.resultDigest=sha(bytes);fs.writeFileSync(f.deliveryFile,JSON.stringify(record));const before=snapshots(f.runtime);assert.equal(f.inspect().stopSafe,false);assert.deepEqual(await f.make()(f.recoveryInput),{recovered:false,reason:'not_applicable'});assert.equal(f.kills,0);assert.deepEqual(snapshots(f.runtime),before);});
test('the held native Process check pins the exact matched pending count and rejects direct children',()=>{assert.match(LOCAL_HISTORY_STOP_HANDLE_PROGRAM,/pendingDeliveryCount -eq \$d\.retainedPendingCount/);assert.match(LOCAL_HISTORY_STOP_HANDLE_PROGRAM,/ParentProcessId/);assert.match(LOCAL_HISTORY_STOP_HANDLE_PROGRAM,/\$heldHandle=\$p.Handle/);assert.doesNotMatch(LOCAL_HISTORY_STOP_HANDLE_PROGRAM,/taskkill|Stop-Process/);});
test('a queued original action with a recomputed blob hash cannot substitute another Bot revision',async t=>{const f=await fixture(t),file=f.deliveryFile.replace(/\.json$/,'.action.json'),value=JSON.parse(fs.readFileSync(file));value.action.payload.hermesBot.revision++;const bytes=Buffer.from(JSON.stringify(value));fs.writeFileSync(file,bytes);const journal=JSON.parse(fs.readFileSync(f.deliveryFile));journal.actionDigest=sha(bytes);fs.writeFileSync(f.deliveryFile,JSON.stringify(journal));const before=snapshots(f.runtime);assert.equal(f.inspect().stopSafe,false);assert.deepEqual(await f.make()(f.recoveryInput),{recovered:false,reason:'not_applicable'});assert.equal(f.kills,0);assert.deepEqual(snapshots(f.runtime),before);});
test('a pending count that changes only after pause prevents any stop',async t=>{const f=await fixture(t);f.healthMutator=h=>{if(h.connectionState==='draining')h.maintenance.pendingDeliveryCount++;};const before=snapshots(f.runtime);await assert.rejects(f.make()(f.recoveryInput),{code:'LOCAL_HISTORY_STOP_RECOVERY_REFUSED'});assert.equal(f.kills,0);assert.deepEqual(snapshots(f.runtime),before);});
test('a pending result that changes during backup prevents any stop',async t=>{const f=await fixture(t),file=f.deliveryFile.replace(/\.json$/,'.result.json');await assert.rejects(f.make({checkpoint:phase=>{if(phase==='snapshot')fs.appendFileSync(file,' ');}})(f.recoveryInput),{code:'LOCAL_HISTORY_STOP_RECOVERY_REFUSED'});assert.equal(f.kills,0);assert.equal(f.paused,false);});

test('the real dispatcher fallback remains supported when an executor omits a failure code',async t=>{const f=await fixture(t,{runtimeFailureCode:null});assert.equal(f.state.completed[0].result.code,'executor_failed');assert.equal(isRetainedFailedBackgroundCompletion(f.input()),true);assert.equal(f.inspect().stopSafe,true);});
