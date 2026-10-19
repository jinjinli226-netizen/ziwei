import {runClientUpdateWorker} from '../scripts/client-update-worker.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {ActionDispatcher} from '../src/daemon.mjs';
import {createActionDelivery} from '../src/daemon-action-delivery.mjs';
import {inspectLocalDaemonMaintenanceFiles,scanNativeFiles} from '../backend/preservation-native-evidence.mjs';
import {describeUpdateFailure,updateFailureResult} from '../scripts/client-update.mjs';
import {createLocalHistoryStopRecovery,createLocalHistoryHandleTerminator,recoverLocalHistoryStopForUpdate,LOCAL_HISTORY_STOP_HANDLE_PROGRAM,LOCAL_HISTORY_NATIVE_RULES} from '../scripts/client-local-history-stop-recovery.mjs';

function nativeStop(data,processes=[]){return{stopped:true,pid:data.pid,creationTime:data.creationTime,exitedAt:'2026-10-18T13:00:00.000Z',maintenanceCleanup:{schemaVersion:1,scope:'held-daemon-descendant-closure',rootPid:data.pid,rootCreationTime:data.creationTime,rootExitedAt:'2026-10-18T12:30:00.000Z',nonce:data.nonce,complete:true,descendantCount:processes.length,terminatedCount:processes.filter(row=>row.terminationRequested).length,processes}};}
const sha=value=>createHash('sha256').update(value).digest('hex');
function fixture(t){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-local-history-stop-'))),home=path.join(root,'home'),runtime=path.join(home,'runtime');fs.mkdirSync(runtime,{recursive:true});t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(home,'ziwei_user.json'),config={workspace:'test-workspace',deviceId:'test-device',apiBase:'https://example.invalid',deviceToken:'PRIVATE_SYNTHETIC_TOKEN'},stateFile=path.join(runtime,'action-state.json');fs.writeFileSync(file,JSON.stringify(config));
 const state={version:2,started:[{key:'dedupe-original',actionId:'original-orphan'}],completed:[{key:'dedupe-original',result:{status:'failed',error:'The operation was aborted due to timeout'}}],padding:'x'.repeat(2_860_000)};fs.writeFileSync(stateFile,JSON.stringify(state));const raw=fs.readFileSync(stateFile);
 const record={pid:8832,creationTime:'2026-10-18T12:00:00.000Z',commandHash:'a'.repeat(64),executable:process.execPath},build='b'.repeat(64);let running=true,paused=false,kills=0,scanMutator,terminateData,healthMutator,checkpoint=()=>{};
 const health={service:'ziwei_user',agentId:'ziwei_user',pid:record.pid,clientBuild:build,workspace:config.workspace,deviceId:config.deviceId,connectionState:'connected',activeActionCount:0,pollingCount:0,quarantinedActionCount:0,executionQuarantined:false,connectionErrors:[],connections:[{workspace:config.workspace,deviceId:config.deviceId,primary:true}],lifecycle:{nonce:'test-nonce-for-exact-instance',root,configPath:file,configSha256:sha(fs.readFileSync(file)),runtimeDir:runtime,startedAt:record.creationTime,managedAuxiliaryCount:0},maintenance:{safe:false,stopSafe:false,pendingDeliveryCount:0,blockedDeliveryCount:3,gatewaySafe:true,gatewayWorkers:[],fileIssues:[{code:'ACTION_STATE_CORRUPT',path:stateFile}]}};
 const inspect=()=>{const names=fs.readdirSync(runtime).sort();const result={safe:false,stopSafe:true,stopIssues:[],retainedHistoryCount:1,retainedDeliveryCount:3,retainedBackgroundCount:0,issues:[{code:'LOCAL_HISTORY_RETAINED',path:stateFile,actionId:'original-orphan'},{code:'DELIVERY_NOT_DRAINED',path:stateFile}],files:names.map(name=>{const p=path.join(runtime,name),bytes=fs.readFileSync(p);return{path:p,exists:true,sha256:sha(bytes),bytes:bytes.length};}),directories:[{path:runtime,exists:true,names}]};scanMutator?.(result);return result;};
 const fetchImpl=async(url,options={})=>{assert.equal(new URL(url).origin,'http://127.0.0.1:20242');if(!running)throw Object.assign(Error('offline'),{code:'ECONNREFUSED'});if(options.method==='POST'){assert.equal(options.headers['x-ziwei-local-control'],config.deviceToken);const body=JSON.parse(options.body);assert.equal(body.nonce,health.lifecycle.nonce);assert(['pause','resume'].includes(body.operation));paused=body.operation==='pause';}const result=structuredClone(health);result.connectionState=paused?'draining':health.connectionState;healthMutator?.(result);return{ok:true,json:async()=>result};};
 const make=(overrides={})=>createLocalHistoryStopRecovery({platform:'win32',inspect,inspectProcess:async()=>running?structuredClone(record):null,inspectListener:async()=>({listenerPid:record.pid}),inspectInstalledProcesses:async()=>running?[structuredClone(record)]:[],inspectListenerCount:async()=>running?1:0,installedBuild:()=>build,terminate:async data=>{kills++;terminateData=data;running=false;const result=nativeStop(data);fs.writeFileSync(data.exitFile,JSON.stringify(result));return result;},checkpoint:(...args)=>checkpoint(...args),...overrides});
 return{root,home,runtime,file,stateFile,state,raw,health,record,build,inspect,input:{root,env:{ZIWEI_USER_HOME:home},configPath:file,fetchImpl},make,set scanMutator(value){scanMutator=value;},set healthMutator(value){healthMutator=value;},set checkpoint(value){checkpoint=value;},get paused(){return paused;},get kills(){return kills;},get terminateData(){return terminateData;},markStopped(){running=false;}};
}

test('candidate recover_history stops the precise idle daemon and preserves 2.86 MB historical bytes and dedupe',async t=>{
 const f=fixture(t),result=await f.make()(f.input);assert.equal(f.kills,1);assert.equal(result.recovered,true);assert.equal(result.stopped,true);assert.equal(result.wasRunning,true);assert.equal(result.originalExecutionExitConfirmed,false);assert.equal(result.executionConfirmedStopped,false);assert.equal(result.retainedHistoryCount,1);assert.deepEqual(fs.readFileSync(f.stateFile),f.raw);
 const manifest=JSON.parse(fs.readFileSync(path.join(result.archiveDirectory,'manifest.json')));assert.equal(manifest.originalExecutionExitConfirmed,false);assert.equal(manifest.files[0].sha256,sha(f.raw));assert.deepEqual(fs.readFileSync(path.join(result.archiveDirectory,manifest.files[0].snapshot)),f.raw);assert.equal(manifest.process.commandHash,f.record.commandHash);assert.equal(JSON.stringify(manifest).includes('PRIVATE_SYNTHETIC_TOKEN'),false);assert.equal(JSON.stringify(f.terminateData).includes('PRIVATE_SYNTHETIC_TOKEN'),false);assert.equal(f.terminateData.connections[0].primary,true);
 if(process.platform!=='win32'){assert.equal(fs.statSync(result.archiveDirectory).mode&0o777,0o700);assert.equal(fs.statSync(path.join(result.archiveDirectory,'manifest.json')).mode&0o777,0o600);}
});

test('the real candidate reader permits scoped orphan plus physically exited blocked business receipt without changing either',async t=>{
 const f=fixture(t),identity={workspace:f.health.workspace,deviceId:f.health.deviceId,apiBase:'https://example.invalid'},tree={platform:'win32',supervisor:'windows-job',launched:true,rootPid:12345,rootConfirmed:true,rootExitCode:0,hostExitCode:0,treeConfirmed:true,activeProcesses:0,cancelled:false};fs.writeFileSync(f.stateFile,JSON.stringify({version:2,started:[],completed:[]}));
 const dispatcher=new ActionDispatcher({workspace:identity.workspace,deviceId:identity.deviceId,workdir:f.root,stateFile:f.stateFile,execute:async()=>({status:'failed',error:'phone business uncertain',result:{processExit:tree,phone:{status:'uncertain',processExit:{treeConfirmed:false,activeProcesses:1}}}})}),action={id:'real-reader-action',dedupe_key:'real-reader-key',type:'conversation.execute',workspace:identity.workspace,payload:{deviceId:identity.deviceId,employeeId:'employee-fixture'}};
 const delivery=createActionDelivery({directory:path.join(f.runtime,'action-delivery'),identity,retryDelays:[],dispatch:value=>dispatcher.dispatch(value),recoverResult:value=>dispatcher.completedResult(value),post:async(url,body)=>{if(url.endsWith('/ack'))return{id:action.id,status:'acked',deviceId:identity.deviceId,acked_at:new Date().toISOString(),expires_at:new Date(Date.now()+1000000).toISOString()};if(url.endsWith('/events'))return{id:body.eventId};throw Object.assign(Error('server result rejected'),{status:400});}});await assert.rejects(delivery.execute(action),/rejected/);await delivery.whenIdle();
 const state=JSON.parse(fs.readFileSync(f.stateFile));state.completed.push({key:'orphan-key',identity:{workspace:identity.workspace,deviceId:identity.deviceId,targetDeviceId:identity.deviceId},result:{status:'failed',actionId:'orphan-action',error:'The operation was aborted due to timeout',completedAt:1}});state.padding='x'.repeat(2_860_000);fs.writeFileSync(f.stateFile,JSON.stringify(state));const before=fs.readFileSync(f.stateFile),connections=[{...identity,runtimeDir:f.runtime}],evidence=inspectLocalDaemonMaintenanceFiles({connections});assert.equal(evidence.stopSafe,true);assert.equal(evidence.retainedHistoryCount,2);assert.equal(evidence.retainedDeliveryCount,1);assert.equal(scanNativeFiles({connections}).safe,false);
 const result=await f.make({inspect:inspectLocalDaemonMaintenanceFiles})(f.input);assert.equal(result.recovered,true);assert.equal(result.retainedHistoryCount,2);assert.equal(result.originalExecutionExitConfirmed,false);assert.deepEqual(fs.readFileSync(f.stateFile),before);assert.equal(scanNativeFiles({connections}).safe,false);let calls=0;const replay=new ActionDispatcher({workspace:identity.workspace,deviceId:identity.deviceId,workdir:f.root,stateFile:f.stateFile,execute:async()=>{calls++;}});assert.equal((await replay.dispatch(action)).status,'duplicate');assert.equal(calls,0);assert.deepEqual(fs.readFileSync(f.stateFile),before);
});

for(const[name,mutate]of Object.entries({
 'quarantine':f=>{f.health.quarantinedActionCount=1;},'execution quarantine':f=>{f.health.executionQuarantined=true;},'gateway worker':f=>{f.health.maintenance.gatewayWorkers=[{processAlive:false}];},'pending delivery':f=>{f.health.maintenance.pendingDeliveryCount=1;},
 'true unsafe history':f=>{f.scanMutator=e=>{e.stopSafe=false;e.stopIssues=[{code:'STARTED_WITHOUT_RESULT'}];};},'unknown warning':f=>{f.scanMutator=e=>e.issues.push({code:'ACTION_STATE_CORRUPT'});},'unproven retained delivery':f=>{f.scanMutator=e=>{e.retainedDeliveryCount=0;};},'zero retained history':f=>{f.scanMutator=e=>{e.retainedHistoryCount=0;};},
}))test(`candidate history fallback is not applicable to ${name}`,async t=>{const f=fixture(t);mutate(f);assert.deepEqual(await f.make()(f.input),{recovered:false,reason:'not_applicable'});assert.equal(f.kills,0);assert.deepEqual(fs.readFileSync(f.stateFile),f.raw);});

for(const[name,mutate]of Object.entries({
 'wrong current PID':f=>{f.health.pid++;},'wrong workspace':f=>{f.health.workspace='different';},'wrong device':f=>{f.health.deviceId='different';},'wrong build':f=>{f.health.clientBuild='c'.repeat(64);},'wrong lifecycle config':f=>{f.health.lifecycle.configSha256='d'.repeat(64);},'unknown shared workspace':f=>{f.health.connections.push({workspace:'other',deviceId:'other',primary:false});},'connection failure':f=>{f.health.connectionErrors=['offline'];},
}))test(`candidate history fallback rejects ${name} without termination`,async t=>{const f=fixture(t);mutate(f);await assert.rejects(f.make()(f.input),{code:'LOCAL_HISTORY_STOP_RECOVERY_REFUSED'});assert.equal(f.kills,0);assert.deepEqual(fs.readFileSync(f.stateFile),f.raw);});

test('new files or changed native identity during private snapshot prevent stopping and preserve original history',async t=>{
 const f=fixture(t);f.checkpoint=()=>fs.writeFileSync(path.join(f.runtime,'new-inflight.json'),'must-survive');await assert.rejects(f.make()(f.input),{code:'LOCAL_HISTORY_STOP_RECOVERY_REFUSED'});assert.equal(f.kills,0);assert.equal(f.paused,false);assert.deepEqual(fs.readFileSync(f.stateFile),f.raw);assert.equal(fs.readFileSync(path.join(f.runtime,'new-inflight.json'),'utf8'),'must-survive');
});
test('native failure cannot expose raw credentials, output or private command',async t=>{const f=fixture(t);await assert.rejects(f.make({terminate:async()=>{throw Error('PRIVATE_SYNTHETIC_TOKEN raw-command');}})(f.input),error=>error.code==='LOCAL_HISTORY_STOP_RECOVERY_REFUSED'&&!/PRIVATE|raw-command/.test(error.message));assert.equal(f.paused,false);assert.deepEqual(fs.readFileSync(f.stateFile),f.raw);});
test('candidate failure phases and updater diagnostics are bounded and contain no raw native output',async t=>{const f=fixture(t),events=[];let caught;try{await f.make({terminate:async()=>{throw Error('PRIVATE_SYNTHETIC_TOKEN C:/private/raw-command');}})({...f.input,log:(event,value)=>events.push({event,...value})});}catch(error){caught=error;}assert.equal(caught.code,'LOCAL_HISTORY_STOP_RECOVERY_REFUSED');assert.equal(caught.recoveryPhase,'terminate');assert.equal(caught.reasonCode,'EVIDENCE_MISMATCH');assert.deepEqual(events.at(-1),{event:'local_history_recovery_failed',phase:'terminate',reasonCode:'EVIDENCE_MISMATCH'});const diagnostic=describeUpdateFailure(caught,'recover_history');assert.equal(diagnostic.reasonCode,'LOCAL_HISTORY_STOP_RECOVERY_REFUSED');assert.equal(diagnostic.recoveryPhase,'terminate');assert.equal(diagnostic.recoveryReasonCode,'EVIDENCE_MISMATCH');assert.doesNotMatch(JSON.stringify({events,diagnostic}),/PRIVATE_SYNTHETIC_TOKEN|raw-command|C:\/private/);assert.equal(f.kills,0);});
test('durable exact daemon-exit evidence survives a lost native response',async t=>{const f=fixture(t);await assert.rejects(f.make({terminate:async data=>{fs.writeFileSync(data.exitFile,JSON.stringify(nativeStop(data)));throw Error('lost response');}})(f.input),error=>error.code==='LOCAL_HISTORY_STOP_RECOVERY_REFUSED'&&error.stoppedClientReceipt?.stopped===true&&error.stoppedClientReceipt.originalExecutionExitConfirmed===false);assert.deepEqual(fs.readFileSync(f.stateFile),f.raw);});
for(const failureCode of ['PS_WORKER_EXITED','EACCES'])test(`root absence after ${failureCode} never substitutes for missing descendant cleanup evidence`,async t=>{
 const f=fixture(t);await assert.rejects(f.make({terminate:async()=>{f.markStopped();throw Object.assign(Error('raw native output'),{code:failureCode});}})(f.input),error=>error.code==='LOCAL_HISTORY_STOP_RECOVERY_REFUSED'&&!error.stoppedClientReceipt);assert.deepEqual(fs.readFileSync(f.stateFile),f.raw);
});

for(const [name,override]of Object.entries({
 'original daemon remains alive':f=>({terminate:async()=>{throw Error('no stop');}}),
 'a replacement daemon exists':f=>({terminate:async()=>{f.markStopped();throw Error('lost native output');},inspectInstalledProcesses:async()=>[{pid:9999}]}),
 'another listener took the loopback port':f=>({terminate:async()=>{f.markStopped();throw Error('lost native output');},inspectListenerCount:async()=>1}),
 'native listener observation is unavailable':f=>({terminate:async()=>{f.markStopped();throw Error('lost native output');},inspectListenerCount:async()=>{throw Error('unavailable');}}),
 'configuration changed after attempted stop':f=>({terminate:async()=>{f.markStopped();fs.appendFileSync(f.file,' ');throw Error('lost native output');}}),
}))test(`missing exit ledger cannot grant a stopped receipt when ${name}`,async t=>{const f=fixture(t);await assert.rejects(f.make(override(f))(f.input),error=>error.code==='LOCAL_HISTORY_STOP_RECOVERY_REFUSED'&&!error.stoppedClientReceipt);assert.deepEqual(fs.readFileSync(f.stateFile),f.raw);});
test('the native terminator transports large snapshots via stdin and holds one Process handle',async()=>{
 const calls=[];const terminate=createLocalHistoryHandleTerminator({runCommand:(command,args)=>{let finish;const promise=new Promise(resolve=>{finish=resolve;}),stdin=new EventEmitter();stdin.end=value=>{calls.push({command,args,data:JSON.parse(value)});finish({stdout:'{}'});};promise.child={stdin};return promise;}});await terminate({waitMs:8000,files:Array.from({length:600},(_,i)=>({path:'C:/private/'+i,sha256:'a'.repeat(64)}))});const program=Buffer.from(calls[0].args.at(-1),'base64').toString('utf16le');assert(calls[0].args.join(' ').length<32000);assert.equal(calls[0].data.files.length,600);assert.match(program,/\$heldHandle=\$p.Handle/);assert.match(program,/\$p\.Kill\(\)/);assert.match(program,/\$p\.WaitForExit/);assert.match(program,/ParentProcessId/);assert.match(program,/FileMode\]::CreateNew/);assert.doesNotMatch(program,/taskkill|Stop-Process|PRIVATE_SYNTHETIC_TOKEN/);
});
test('native CIM observation has a separate finite 120 second budget without extending cleanup',async()=>{
 const calls=[];const terminate=createLocalHistoryHandleTerminator({runCommand:(command,args,options)=>{let finish;const promise=new Promise(resolve=>{finish=resolve;}),stdin=new EventEmitter();stdin.end=value=>{calls.push({command,args,options,data:JSON.parse(value)});finish({stdout:'{}'});};promise.child={stdin};return promise;}});
 for(const waitMs of [1,8000])await terminate({waitMs});
 assert.deepEqual(calls.map(row=>row.options.timeout),[120001,128000]);assert.deepEqual(calls.map(row=>row.data.waitMs),[1,8000]);
 for(const row of calls){assert.equal(Buffer.from(row.args.at(-1),'base64').toString('utf16le'),LOCAL_HISTORY_STOP_HANDLE_PROGRAM);assert.match(LOCAL_HISTORY_STOP_HANDLE_PROGRAM,/\$watch.ElapsedMilliseconds -lt \$d.waitMs/);assert.match(LOCAL_HISTORY_STOP_HANDLE_PROGRAM,/\$p.WaitForExit\(\$d.waitMs\)/);}
});
test('native parent generations use one CIM snapshot while preserving all other reviewed native logic',()=>{
 const program=LOCAL_HISTORY_STOP_HANDLE_PROGRAM;
 const snapshot=' $rows=@(Get-CimInstance Win32_Process -ErrorAction Stop);$byPid=@{};foreach($snapshotRow in $rows){$byPid[[int]$snapshotRow.ProcessId]=$snapshotRow};$added=0;$more=$true';
 const parent='$owner=$byPid[[int]$row.ParentProcessId];Tree-Fact';
 assert.equal(program.split(snapshot).length,2);assert.equal(program.split(parent).length,2);
 assert.match(program,/\$owner.CreationDate.ToUniversalTime\(\).ToString\('o'\) -ceq \$parent.created.ToString\('o'\)/);
 assert.match(program,/\$parent.process.HasExited -and \$created -le \$parent.process.ExitTime.ToUniversalTime\(\)/);
 assert.match(program,/\$null=\$child.Handle/);assert.match(program,/\$current=Get-CimInstance Win32_Process -Filter \('ProcessId = '\+\$id\)/);
 assert.match(program,/!\$protected.ContainsKey\(\$id\)/);assert.match(program,/!\$protected.ContainsKey\(\[int\]\$d.pid\)/);
 const previous=program.replace(snapshot,' $rows=@(Get-CimInstance Win32_Process -ErrorAction Stop);$added=0;$more=$true').replace(parent,"$owner=Get-CimInstance Win32_Process -Filter ('ProcessId = '+[int]$row.ParentProcessId);Tree-Fact");
 assert.equal(sha(previous),'01810933e42b7a61a733e0b50f23d550ecf1f44ac28139959f0eea44d2039897');
});
test('the official history fallback never operates on a non-Windows host',async()=>{if(process.platform!=='win32')assert.deepEqual(await recoverLocalHistoryStopForUpdate({}),{recovered:false,reason:'not_applicable'});});


test('a periodic poll that starts during native holder revalidation drains after pause before stopping',async t=>{
 const f=fixture(t);let reads=0,drainingReads=0,observedBusyPoll=false;
 f.healthMutator=h=>{reads++;if(h.connectionState==='connected'&&reads>=2){h.pollingCount=1;observedBusyPoll=true;}if(h.connectionState==='draining'){drainingReads++;h.pollingCount=drainingReads<=2?1:0;}};
 const before=fs.readFileSync(f.stateFile),result=await f.make()(f.input);
 assert.equal(result.recovered,true);assert.equal(observedBusyPoll,true);assert(drainingReads>=3);assert.equal(f.kills,1);assert.deepEqual(fs.readFileSync(f.stateFile),before);
});
test('an already running periodic poll is paused and drained without treating it as a live employee action',async t=>{
 const f=fixture(t);f.health.pollingCount=1;let drainingReads=0;f.healthMutator=h=>{if(h.connectionState==='draining'){drainingReads++;h.pollingCount=drainingReads===1?1:0;}};
 const result=await f.make()(f.input);assert.equal(result.recovered,true);assert.equal(f.kills,1);assert(drainingReads>=2);
});
test('a poll which does not drain by the bounded deadline never permits a stop and restores the prior connection state',async t=>{
 const f=fixture(t);f.health.pollingCount=1;const before=fs.readFileSync(f.stateFile);await assert.rejects(f.make()({...f.input,timeoutMs:1}),{code:'LOCAL_HISTORY_STOP_RECOVERY_REFUSED'});assert.equal(f.kills,0);assert.equal(f.paused,false);assert.deepEqual(fs.readFileSync(f.stateFile),before);
});
test('a new employee action during poll drain refuses stopping and preserves the original task bytes',async t=>{
 const f=fixture(t);f.healthMutator=h=>{if(h.connectionState==='draining'){h.pollingCount=1;h.activeActionCount=1;}};const before=fs.readFileSync(f.stateFile);await assert.rejects(f.make()({...f.input,timeoutMs:1}),{code:'LOCAL_HISTORY_STOP_RECOVERY_REFUSED'});assert.equal(f.kills,0);assert.deepEqual(fs.readFileSync(f.stateFile),before);
});
for(const pollingCount of [-1,2,Infinity,'1'])test(`poll allowance refuses invalid or impossible count ${pollingCount}`,async t=>{const f=fixture(t);f.health.pollingCount=pollingCount;assert.deepEqual(await f.make()(f.input),{recovered:false,reason:'not_applicable'});assert.equal(f.kills,0);});
for(const [name,change]of Object.entries({'quarantine':h=>{h.quarantinedActionCount=1;h.executionQuarantined=true;},'another pending result':h=>h.maintenance.pendingDeliveryCount++}))test(`poll drain never ignores ${name}`,async t=>{const f=fixture(t);f.healthMutator=h=>{if(h.connectionState==='draining'){h.pollingCount=1;change(h);}};await assert.rejects(f.make()({...f.input,timeoutMs:1}),{code:'LOCAL_HISTORY_STOP_RECOVERY_REFUSED'});assert.equal(f.kills,0);assert.deepEqual(fs.readFileSync(f.stateFile),f.raw);});

test('a receipt retry already active at preflight drains before candidate history is read',async t=>{
 const f=fixture(t);let drains=0,active=1,scans=0;f.healthMutator=h=>{if(h.connectionState==='draining'){drains++;active=drains<3?1:0;}h.activeActionCount=active;h.maintenance.pendingDeliveryCount=active?1:0;};f.scanMutator=()=>{scans++;assert.equal(active,0);assert.equal(f.paused,true);};
 const before=fs.readFileSync(f.stateFile),result=await f.make()(f.input);assert.equal(result.recovered,true);assert.equal(f.kills,1);assert(scans>=2);assert(drains>=3);assert.deepEqual(fs.readFileSync(f.stateFile),before);
});
test('a real task still active at the drain deadline is never stopped and resumes the previous connection',async t=>{
 const f=fixture(t);f.health.activeActionCount=1;let scans=0;f.scanMutator=()=>scans++;await assert.rejects(f.make()({...f.input,timeoutMs:1}),{code:'LOCAL_HISTORY_STOP_RECOVERY_REFUSED'});assert.equal(scans,0);assert.equal(f.kills,0);assert.equal(f.paused,false);assert.deepEqual(fs.readFileSync(f.stateFile),f.raw);
});
test('history that remains inapplicable after drain restores the prior connected state',async t=>{
 const f=fixture(t);let drains=0;f.healthMutator=h=>{h.activeActionCount=h.connectionState==='draining'?(++drains<2?1:0):1;};f.scanMutator=e=>{assert.equal(f.paused,true);e.stopSafe=false;e.stopIssues=[{code:'STARTED_WITHOUT_RESULT'}];};assert.deepEqual(await f.make()(f.input),{recovered:false,reason:'not_applicable'});assert.equal(f.kills,0);assert.equal(f.paused,false);assert.deepEqual(fs.readFileSync(f.stateFile),f.raw);
});
test('a pending count mismatch after drain restores the prior connection without terminating',async t=>{
 const f=fixture(t);f.health.activeActionCount=1;f.healthMutator=h=>{if(h.connectionState==='draining')h.activeActionCount=0;h.maintenance.pendingDeliveryCount=1;};assert.deepEqual(await f.make()(f.input),{recovered:false,reason:'not_applicable'});assert.equal(f.kills,0);assert.equal(f.paused,false);assert.deepEqual(fs.readFileSync(f.stateFile),f.raw);
});

for(const activeActionCount of [-1,10,Infinity,'1'])test(`active drain allowance refuses invalid or impossible count ${activeActionCount}`,async t=>{const f=fixture(t);f.health.activeActionCount=activeActionCount;assert.deepEqual(await f.make()(f.input),{recovered:false,reason:'not_applicable'});assert.equal(f.kills,0);});
test('maintenance becoming ordinary safe during drain restores the connection and leaves stopping to the standard path',async t=>{const f=fixture(t);f.healthMutator=h=>{if(h.connectionState==='draining'){h.maintenance.safe=true;h.maintenance.stopSafe=true;h.maintenance.fileIssues=[];}};f.scanMutator=e=>{e.safe=true;e.stopSafe=true;e.issues=[];e.retainedHistoryCount=0;};assert.deepEqual(await f.make()(f.input),{recovered:false,reason:'not_applicable'});assert.equal(f.kills,0);assert.equal(f.paused,false);});
test('drain failure preserves an already paused connection instead of implicitly resuming it',async t=>{const f=fixture(t);f.health.connectionState='draining';f.health.activeActionCount=1;await assert.rejects(f.make()({...f.input,timeoutMs:1}),{code:'LOCAL_HISTORY_STOP_RECOVERY_REFUSED'});assert.equal(f.kills,0);assert.equal(f.paused,true);});


function rejectedNative(rule,{stdout,stderr='PRIVATE_NATIVE_STDERR C:/private/command',message='PRIVATE_NATIVE_COMMAND'}={}){
 return createLocalHistoryHandleTerminator({runCommand:()=>{let reject;const promise=new Promise((_,fail)=>{reject=fail;}),stdin=new EventEmitter();stdin.end=()=>reject(Object.assign(Error(message),{stdout:stdout??('ZIWEI_LOCAL_HISTORY_RULE:'+rule+'\r\n'),stderr,cmd:'PRIVATE_NATIVE_COMMAND'}));promise.child={stdin};return promise;}});
}
for(const rule of LOCAL_HISTORY_NATIVE_RULES)test(`native ${rule} is retained as diagnostic only through official terminal serialization`,async t=>{
 const f=fixture(t),before=fs.readFileSync(f.stateFile);let caught;try{await f.make({terminate:rejectedNative(rule)})(f.input);}catch(error){caught=error;}
 assert.equal(caught?.code,'LOCAL_HISTORY_STOP_RECOVERY_REFUSED');assert.equal(caught.recoveryPhase,'terminate');assert.equal(caught.recoveryRule,rule);assert.equal(caught.reasonCode,rule==='LH00_NATIVE_ERROR'?'NATIVE_OBSERVATION_FAILED':'NATIVE_ASSERTION_FAILED');assert.equal(f.kills,0);assert.equal(f.paused,false);assert.deepEqual(fs.readFileSync(f.stateFile),before);
 const terminal=updateFailureResult(caught,'recover_history');assert.equal(terminal.recoveryPhase,'terminate');assert.equal(terminal.recoveryRule,rule);assert.equal(terminal.recoveryReasonCode,caught.reasonCode);assert.doesNotMatch(JSON.stringify(terminal),/PRIVATE_NATIVE|C:\/private|stderr|CommandLine/);assert.equal(Object.hasOwn(terminal,'stopped'),false);assert.equal(Object.hasOwn(terminal,'stoppedClientReceipt'),false);
});

test('the native guard order is preserved with LH20 selecting exact tree capture instead of refusing every child',()=>{
 const expressions=[],calls=[...LOCAL_HISTORY_STOP_HANDLE_PROGRAM.matchAll(/\bAssert-Fact '(LH[0-9]{2}_[A-Z_]+)' (?=\()/g)];
 for(const match of calls){const begin=match.index+match[0].length;let depth=0;for(let at=begin;at<LOCAL_HISTORY_STOP_HANDLE_PROGRAM.length;at++){const char=LOCAL_HISTORY_STOP_HANDLE_PROGRAM[at];if(char==='(')depth++;else if(char===')'&&--depth===0){expressions.push(LOCAL_HISTORY_STOP_HANDLE_PROGRAM.slice(begin,at+1));break;}}}
 assert.equal(expressions.length,23);assert.deepEqual(calls.map(row=>row[1]),LOCAL_HISTORY_NATIVE_RULES.slice(1));assert.equal(createHash('sha256').update(JSON.stringify(expressions)).digest('hex'),'c932039f68da7228a1be2eaf392e19416a51a9ca66b257e5decd3badffbf8b0d');
 assert.match(LOCAL_HISTORY_STOP_HANDLE_PROGRAM,/if\(!\$v\)\{\$script:ziweiLocalHistoryRule=\$rule/);assert(LOCAL_HISTORY_STOP_HANDLE_PROGRAM.indexOf("Assert-Fact 'LH20_DAEMON_CHILDREN'")<LOCAL_HISTORY_STOP_HANDLE_PROGRAM.indexOf('$p.Kill()'));
});

for(const [label,options]of Object.entries({
 'multiple markers':{stdout:'ZIWEI_LOCAL_HISTORY_RULE:LH20_DAEMON_CHILDREN\nZIWEI_LOCAL_HISTORY_RULE:LH08_HEALTH_IDLE\n'},
 'mixed output':{stdout:'{"private":"PRIVATE_NATIVE"}\nZIWEI_LOCAL_HISTORY_RULE:LH20_DAEMON_CHILDREN\n'},
 'unknown marker':{stdout:'ZIWEI_LOCAL_HISTORY_RULE:LH99_UNREVIEWED\n'},
 'stderr only':{stdout:'',stderr:'ZIWEI_LOCAL_HISTORY_RULE:LH20_DAEMON_CHILDREN\n'},
 'message only':{stdout:'',message:'ZIWEI_LOCAL_HISTORY_RULE:LH20_DAEMON_CHILDREN\n'},
 'leading log':{stdout:'PRIVATE_NATIVE_LOG\nZIWEI_LOCAL_HISTORY_RULE:LH20_DAEMON_CHILDREN\n'},
}))test(`native rule parsing rejects ${label}`,async()=>{
 await assert.rejects(rejectedNative('LH20_DAEMON_CHILDREN',options)({waitMs:1}),error=>error.code==='LOCAL_HISTORY_STOP_RECOVERY_REFUSED'&&error.recoveryRule==='LH00_NATIVE_ERROR'&&error.reasonCode==='NATIVE_OBSERVATION_FAILED'&&!/PRIVATE_NATIVE|stderr|CommandLine/.test(error.message));
});

test('the detached official worker persists the native failure rule in real terminal JSON without any stop proof',async t=>{
 const f=fixture(t);let caught;try{await f.make({terminate:rejectedNative('LH20_DAEMON_CHILDREN')})(f.input);}catch(error){caught=error;}
 const directory=path.join(f.root,'isolated-maintenance-result');fs.mkdirSync(directory);const jobFile=path.join(directory,'job.json');fs.writeFileSync(jobFile,JSON.stringify({directory,parentPid:1234}));
 const result=await runClientUpdateWorker({jobFile,env:{},waitParent:async()=>{},acquireLock:async()=>({lock:{fixture:true}}),releaseLock:()=>true,performUpdate:async()=>{throw caught;}});assert.equal(result.exitCode,1);
 for(const name of ['terminal.json','result.json']){const terminal=JSON.parse(fs.readFileSync(path.join(directory,name)));assert.equal(terminal.state,'failed');assert.equal(terminal.recoveryPhase,'terminate');assert.equal(terminal.recoveryReasonCode,'NATIVE_ASSERTION_FAILED');assert.equal(terminal.recoveryRule,'LH20_DAEMON_CHILDREN');assert.equal(Object.hasOwn(terminal,'stopped'),false);assert.equal(Object.hasOwn(terminal,'stoppedClientReceipt'),false);assert.doesNotMatch(JSON.stringify(terminal),/PRIVATE_NATIVE|CommandLine|C:\/private/);}
 assert.equal(f.kills,0);
});

test('a new stopSafe scanner still enters the same exact-instance maintenance cleanup path',async t=>{
 const f=fixture(t);f.health.maintenance.stopSafe=true;const result=await f.make()(f.input);assert.equal(result.recovered,true);assert.equal(result.maintenanceCleanup.complete,true);assert.equal(f.kills,1);assert.deepEqual(fs.readFileSync(f.stateFile),f.raw);
});

function descendants(root){return[
 {pid:12001,parentPid:root,creationTime:'2026-10-18T12:10:00.000Z',exitedAt:'2026-10-18T12:40:00.000Z',exitConfirmed:true,exitCode:1,terminationRequested:true},
 {pid:12002,parentPid:12001,creationTime:'2026-10-18T12:35:00.000Z',exitedAt:'2026-10-18T12:41:00.000Z',exitConfirmed:true,exitCode:0,terminationRequested:false},
];}

test('actual maintenance cleanup keeps its own held-tree receipt and never rewrites an old action result',async t=>{
 const f=fixture(t),result=await f.make({terminate:async data=>{const value=nativeStop(data,descendants(data.pid));f.markStopped();fs.writeFileSync(data.exitFile,JSON.stringify(value));return value;}})(f.input);
 assert.equal(result.recovered,true);assert.equal(result.maintenanceCleanup.descendantCount,2);assert.equal(result.maintenanceCleanup.terminatedCount,1);assert.equal(result.retainedHistoryPreserved,true);assert.equal(Object.hasOwn(result,'backgroundProcessesPreserved'),false);assert.equal(result.originalExecutionExitConfirmed,false);assert.equal(result.executionConfirmedStopped,false);assert.deepEqual(fs.readFileSync(f.stateFile),f.raw);
 const saved=JSON.parse(fs.readFileSync(path.join(result.archiveDirectory,'daemon-exit.json')));assert.deepEqual(saved.maintenanceCleanup,result.maintenanceCleanup);assert.equal(saved.maintenanceCleanup.processes[1].parentPid,12001);
});

for(const[name,mutate]of Object.entries({
 'missing cleanup':v=>{delete v.maintenanceCleanup;},
 'unfinished cleanup':v=>{v.maintenanceCleanup.complete=false;},
 'different root generation':v=>{v.maintenanceCleanup.rootCreationTime='2026-10-18T11:00:00Z';},
 'different daemon nonce':v=>{v.maintenanceCleanup.nonce='another-generation';},
 'incorrect process count':v=>{v.maintenanceCleanup.descendantCount=9;},
 'incorrect termination count':v=>{v.maintenanceCleanup.terminatedCount=2;},
 'foreign parent outside held closure':v=>{v.maintenanceCleanup.processes[0].parentPid=99999;},
 'child older than actual root':v=>{v.maintenanceCleanup.processes[0].creationTime='2026-10-18T11:59:59Z';},
 'root PID reused after root exit':v=>{v.maintenanceCleanup.processes[0].creationTime='2026-10-18T12:31:00Z';},
 'child PID reused after parent exit':v=>{v.maintenanceCleanup.processes[1].creationTime='2026-10-18T12:40:01Z';},
 'duplicate process identity':v=>{v.maintenanceCleanup.processes[1].pid=12001;},
 'uncertain child exit':v=>{v.maintenanceCleanup.processes[1].exitConfirmed=false;},
 'future child exit':v=>{v.maintenanceCleanup.processes[1].exitedAt='2026-10-18T14:00:00Z';},
 'cycle in parent closure':v=>{v.maintenanceCleanup.processes[0].parentPid=12002;},
 'serialized child string':v=>{v.maintenanceCleanup.processes[1]='System.Collections.Specialized.OrderedDictionary';},
}))test(`root disappearance cannot hide ${name}`,async t=>{
 const f=fixture(t);await assert.rejects(f.make({terminate:async data=>{const value=nativeStop(data,descendants(data.pid));mutate(value);f.markStopped();fs.writeFileSync(data.exitFile,JSON.stringify(value));return value;}})(f.input),error=>error.code==='LOCAL_HISTORY_STOP_RECOVERY_REFUSED'&&!error.stoppedClientReceipt);assert.deepEqual(fs.readFileSync(f.stateFile),f.raw);
});

test('native cleanup binds generation windows and excludes its own updater ancestry before any kill',()=>{
 const p=LOCAL_HISTORY_STOP_HANDLE_PROGRAM;
 assert.match(p,/\$parent\.process\.HasExited/);assert.match(p,/\$created -gt \$parent\.process\.ExitTime\.ToUniversalTime\(\)/);assert.match(p,/\$owner\.CreationDate\.ToUniversalTime\(\)\.ToString\('o'\) -ceq \$parent\.created\.ToString\('o'\)/);
 assert.match(p,/!\$protected\.ContainsKey\(\$id\)/);assert.match(p,/!\$protected\.ContainsKey\(\[int\]\$d.pid\)/);assert.match(p,/\$null=\$child.Handle/);assert.match(p,/\$item.process.Kill\(\)/);assert.doesNotMatch(p,/taskkill|Stop-Process|Kill\(true\)/);
 assert.equal((p.match(/\$exit\|ConvertTo-Json -Depth 8 -Compress/g)||[]).length,2);assert.equal((p.match(/^ Assert-IdleSnapshot$/gm)||[]).length,2);
 assert(p.indexOf('Assert-Fact \'LH21_LAST_IDENTITY\'')<p.indexOf('$p.Kill()'));assert(p.indexOf('$cleanup=Finish-Tree')<p.indexOf('$bytes=[Text.UTF8Encoding]::new($false).GetBytes(($exit|'));
 assert.match(p,/\$tree.Count -lt 257/);assert.match(p,/\$pass -lt 8/);assert.match(p,/\$watch.ElapsedMilliseconds -lt \$d.waitMs/);
});
