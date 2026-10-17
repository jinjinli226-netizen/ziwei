import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {EventEmitter} from 'node:events';
import {BOT_FORCE_ABANDON_POLICY as POLICY,BOT_FORCE_ABANDON_POLICY_DIGEST as POLICY_DIGEST,forceAbandonBytesDigest as hash} from '../src/bot-force-abandon-contract.mjs';
import {inspectForceAbandonLocalFacts,createForceAbandonInventory,createForceAbandonListenerCount} from '../scripts/client-force-abandon-recovery.mjs';
import {diagnoseBotRecovery,runRecoveryDiagnostic,probeRecoveryHealth,resolveDiagnosticRoot} from '../scripts/diagnose-bot-recovery.mjs';

const PRIVATE='PRIVATE_TOKEN_AND_BUSINESS_MESSAGE',ACTION=POLICY.subject.actionId;
function fixture(t){
 const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-readonly-recovery-')));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const root=path.join(home,'npm/node_modules/ziwei'),runtime=path.join(home,'runtime'),configPath=path.join(home,'ziwei_user.json');fs.mkdirSync(root,{recursive:true});fs.mkdirSync(path.join(runtime,'action-delivery'),{recursive:true});
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'ziwei',bin:{ziwei_user:'scripts/ziwei-user.mjs'}}));
 const config={workspace:POLICY.subject.workspace,deviceId:POLICY.subject.deviceId,apiBase:'https://qzelynth.top',deviceToken:PRIVATE};fs.writeFileSync(configPath,JSON.stringify(config));
 const key='conversation:fixture:original',identity={workspace:config.workspace,deviceId:config.deviceId,targetDeviceId:config.deviceId};
 const started={key,actionId:ACTION,identity,nativeRuntime:true,startedAt:1792233448173,resourceBinding:{type:'conversation.execute',employeeId:POLICY.subject.employeeId,revision:POLICY.subject.originalRevision,controlEpoch:POLICY.subject.originalControlEpoch},quarantine:{stopConfirmed:false}};
 const state={version:2,started:[started],completed:[{key:'prior',identity,result:{actionId:'other',status:'succeeded',content:PRIVATE}}]};
 const statePath=path.join(runtime,'action-state.json'),base=path.join(runtime,'action-delivery',hash(JSON.stringify(ACTION))),scope={apiBase:config.apiBase,workspace:config.workspace,deviceId:config.deviceId};
 const payload={deviceId:config.deviceId,employeeId:POLICY.subject.employeeId,profile:POLICY.subject.profile,conversationId:'fixture-conversation',messageId:'fixture-message',content:PRIVATE,hermesBot:{workspace:config.workspace,deviceId:config.deviceId,employeeId:POLICY.subject.employeeId,revision:POLICY.subject.originalRevision,controlEpoch:POLICY.subject.originalControlEpoch}};
 const action={id:ACTION,type:'conversation.execute',agent_id:'ziwei_user',workspace_id:'fixture-workspace-id',dedupe_key:key,payload};
 const binding=hash(JSON.stringify({id:ACTION,type:action.type,agent:action.agent_id,workspace:action.workspace_id,device:config.deviceId,employee:payload.employeeId,conversation:payload.conversationId,message:payload.messageId,dedupe:key}));
 const actionPath=base+'.action.json',resultPath=base+'.result.json',journalPath=base+'.json';
 const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value));write(statePath,state);write(actionPath,{identity:scope,binding,action});write(resultPath,{receiptOnly:true,status:'failed',content:PRIVATE});
 const journal={version:2,identity:scope,binding,action,events:[],state:'confirmed',serverStatus:'failed',actionDigest:hash(fs.readFileSync(actionPath)),resultDigest:hash(fs.readFileSync(resultPath))};write(journalPath,journal);
 const snapshot=()=>{const files={};const walk=d=>{for(const entry of fs.readdirSync(d,{withFileTypes:true})){const file=path.join(d,entry.name);if(entry.isDirectory())walk(file);else files[path.relative(home,file)]=hash(fs.readFileSync(file));}};walk(home);return files;};
 const deps={root,env:{ZIWEI_USER_HOME:home,ZIWEI_CONFIG:configPath},platform:'win32',locateRoot:async()=>root,installedBuild:()=>POLICY.holderBuild,sourceSnapshot:()=>[{path:PRIVATE,sha256:'a'.repeat(64)}],inspectProcesses:async()=>[],inspectListeners:async()=>0,probeHealth:async()=>({state:'connection_refused'})};
 return{home,root,runtime,configPath,config,started,state,statePath,action,actionPath,resultPath,journalPath,journal,write,snapshot,deps};
}

test('diagnosis checks the exact local policy without changing any file or exposing secrets',async t=>{
 const f=fixture(t),before=f.snapshot();assert.equal((await resolveDiagnosticRoot({root:f.root})),f.root);
 const report=await diagnoseBotRecovery(f.deps);assert.equal(report.readOnly,true);assert.equal(report.state,'diagnosed');assert.equal(report.offlineObservationPassed,true);assert.equal(report.artifacts.local.state,'passed');assert.equal(report.nativeInventory.count,0);assert.equal(report.listeners.count,0);
 assert.deepEqual(f.snapshot(),before);assert.doesNotMatch(JSON.stringify(report),/PRIVATE_|deviceToken|executable|command|content|configPath/);
});

test('other devices and workspaces are not inspected or queried',async t=>{
 for(const field of ['workspace','deviceId']){const f=fixture(t);f.write(f.configPath,{...f.config,[field]:'other'});const before=f.snapshot();let native=0;const report=await diagnoseBotRecovery({...f.deps,inspectProcesses:async()=>{native++;throw Error(PRIVATE);},probeHealth:async()=>{native++;throw Error(PRIVATE);}});assert.equal(report.state,'not_applicable');assert.equal(native,0);assert.deepEqual(f.snapshot(),before);}
});

for(const[rule,mutate]of Object.entries({
 STATE_SCHEMA:f=>f.write(f.statePath,{...f.state,version:1}),
 STARTED_IDENTITY:f=>f.write(f.statePath,{...f.state,started:[{...f.started,identity:{workspace:7}}]}),
 COMPLETED_RESULT:f=>f.write(f.statePath,{...f.state,completed:[{key:'bad',identity:{},result:{status:'uncertain',content:PRIVATE}}]}),
 COMPLETED_IDENTITY:f=>f.write(f.statePath,{...f.state,completed:[{key:'bad',result:{status:'failed'}}]}),
 TARGET_STARTED_COUNT:f=>f.write(f.statePath,{...f.state,started:[]}),
 TARGET_DEVICE:f=>f.write(f.statePath,{...f.state,started:[{...f.started,identity:{...f.started.identity,targetDeviceId:'other'}}]}),
 TARGET_BINDING:f=>f.write(f.statePath,{...f.state,started:[{...f.started,resourceBinding:{...f.started.resourceBinding,controlEpoch:99}}]}),
 JOURNAL_SCHEMA:f=>f.write(f.journalPath,null),
 JOURNAL_TERMINAL:f=>f.write(f.journalPath,{...f.journal,state:'blocked'}),
 ORPHAN_DELIVERY_BLOBS:f=>fs.unlinkSync(f.journalPath),
 ACTION_BLOB_DIGEST:f=>fs.appendFileSync(f.actionPath,' '),
 ACTION_IDENTITY:f=>{f.write(f.actionPath,null);f.write(f.journalPath,{...f.journal,actionDigest:hash(fs.readFileSync(f.actionPath))});},
 RESULT_RECEIPT:f=>{f.write(f.resultPath,{receiptOnly:false,status:'failed',content:PRIVATE});f.write(f.journalPath,{...f.journal,resultDigest:hash(fs.readFileSync(f.resultPath))});}
}))test(`local diagnostics identify ${rule} without printing the failed record`,t=>{
 const f=fixture(t);mutate(f);const before=f.snapshot(),result=inspectForceAbandonLocalFacts(f.runtime,f.config);assert.equal(result.state,'failed');assert.equal(result.reasonCode,'EVIDENCE_MISMATCH');assert.equal(result.ruleId,rule);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|content|identity|path/);assert.deepEqual(f.snapshot(),before);
});

test('WAL scope, archive and offline-transition checks are read-only and independently identified',async t=>{
 const f=fixture(t),directory=path.join(f.runtime,'force-abandon',hash(JSON.stringify(ACTION)));fs.mkdirSync(directory,{recursive:true});
 const paths=[['action-state',f.statePath],['delivery-journal',f.journalPath],['delivery-action',f.actionPath],['delivery-result',f.resultPath]],files=paths.map(([role,file])=>{const bytes=fs.readFileSync(file);fs.writeFileSync(path.join(directory,role+'.original.json'),bytes);return{role,path:file,exists:true,sha256:hash(bytes),bytes:bytes.length};});
 const wal={schemaVersion:1,policyDigest:POLICY_DIGEST,actionId:ACTION,stage:'prepared',root:f.root,runtimeDir:f.runtime,configPath:f.configPath,configHash:hash(fs.readFileSync(f.configPath)),files,private:PRIVATE};f.write(path.join(directory,'journal.json'),wal);
 let before=f.snapshot(),report=await diagnoseBotRecovery(f.deps);assert.equal(report.artifacts.wal.schemaVersion,1);assert.equal(report.artifacts.wal.stage,'prepared');assert.equal(report.artifacts.checks.every(r=>r.state==='passed'),true);assert.deepEqual(f.snapshot(),before);
 f.write(path.join(directory,'journal.json'),{...wal,root:'other',receipt:{private:PRIVATE}});before=f.snapshot();report=await diagnoseBotRecovery(f.deps);assert.equal(report.artifacts.checks.find(r=>r.ruleId==='WAL_SCOPE').state,'failed');assert.equal(report.artifacts.checks.find(r=>r.ruleId==='WAL_OFFLINE_TRANSITION').state,'failed');assert.doesNotMatch(JSON.stringify(report),/PRIVATE_|configPath|files.*original/);assert.deepEqual(f.snapshot(),before);
});

test('unverifiable native inspection stays unknown, carries only static rules, and never becomes a zero count',async t=>{
 const f=fixture(t);const report=await diagnoseBotRecovery({...f.deps,inspectProcesses:async()=>{throw Object.assign(Error(PRIVATE),{recoveryRule:'NATIVE_COMMAND_UNREADABLE',unreadableCount:2,stdout:PRIVATE});},inspectListeners:async()=>{throw Object.assign(Error(PRIVATE),{recoveryRule:'PRIVATE_RULE'});}});
 assert.deepEqual(report.nativeInventory,{state:'unknown',reasonCode:'NATIVE_INVENTORY_UNVERIFIED',ruleId:'NATIVE_COMMAND_UNREADABLE',unreadableCount:2});assert.equal(Object.hasOwn(report.nativeInventory,'count'),false);assert.equal(report.listeners.ruleId,'NATIVE_COMMAND_FAILED');assert.equal(Object.hasOwn(report.listeners,'count'),false);assert.equal(report.offlineObservationPassed,false);assert.doesNotMatch(JSON.stringify(report),/PRIVATE_/);
});

test('native factories attach bounded reasons without raw command output',async()=>{
 const row={pid:7,command:'other',executable:'other.exe',creationTime:'2026-10-17T14:00:00Z'};
 for(const[stdout,rule]of [['','NATIVE_JSON_EMPTY'],['{','NATIVE_JSON_INVALID'],['{}','NATIVE_ARRAY_REQUIRED'],[JSON.stringify([{...row,command:null}]),'NATIVE_COMMAND_UNREADABLE'],[JSON.stringify([{...row,executable:null}]),'NATIVE_EXECUTABLE_UNREADABLE'],[JSON.stringify([{...row,creationTime:null}]),'NATIVE_CREATION_INVALID']])await assert.rejects(createForceAbandonInventory({runCommand:async()=>({stdout})})('/fixture'),error=>error.code==='CLIENT_FORCE_ABANDON_REFUSED'&&error.reasonCode==='EVIDENCE_MISMATCH'&&error.recoveryRule===rule);
 for(const[stdout,rule]of [['','LISTENER_COUNT_EMPTY'],['PRIVATE_LISTENER','LISTENER_COUNT_INVALID']])await assert.rejects(createForceAbandonListenerCount({runCommand:async()=>({stdout})})('http://127.0.0.1:20242'),error=>error.recoveryRule===rule);
 assert.equal(await createForceAbandonListenerCount({runCommand:async()=>({stdout:'0\r\n'})})('http://127.0.0.1:20242'),0);
});

function fakeGet({errorCode,status=200,body,silent=false}){return(_url,_options,callback)=>{const request=new EventEmitter();request.setTimeout=()=>{};request.destroy=()=>{};queueMicrotask(()=>{if(errorCode){request.emit('error',{code:errorCode,message:PRIVATE});return;}const response=new EventEmitter();response.statusCode=status;response.setEncoding=()=>{};response.resume=()=>{};callback(response);if(!silent){response.emit('data',body);response.emit('end');}});return request;};}
test('direct health probing only labels actual refused TCP as absent and has a total deadline',async()=>{
 for(const code of ['ECONNREFUSED','ECONNRESET','ENOTFOUND'])assert.equal((await probeRecoveryHealth('http://127.0.0.1:20242',{get:fakeGet({errorCode:code})})).state,code==='ECONNREFUSED'?'connection_refused':'unreachable');
 assert.equal((await probeRecoveryHealth('http://127.0.0.1:20242',{get:fakeGet({body:'null'})})).state,'invalid_response');
 assert.equal((await probeRecoveryHealth('http://127.0.0.1:20242',{get:fakeGet({status:403,body:PRIVATE})})).state,'http_error');
 const began=Date.now();assert.equal((await probeRecoveryHealth('http://127.0.0.1:20242',{get:fakeGet({silent:true}),timeoutMs:20})).state,'timeout');assert(Date.now()-began<1000);
});

test('single diagnostic entry exits zero for failed checks and bounds all execution errors as ASCII JSON',async()=>{
 let output='';assert.equal(await runRecoveryDiagnostic({argv:['--root','fixture'],diagnose:async()=>({state:'diagnosed',readOnly:true,checks:[{ruleId:'COMPLETED_RESULT',state:'failed'}]}),write:value=>{output=value;}}),0);assert.equal(JSON.parse(output).checks[0].ruleId,'COMPLETED_RESULT');
 assert.equal(await runRecoveryDiagnostic({argv:[],diagnose:async()=>{throw Object.assign(Error(PRIVATE),{code:PRIVATE,stdout:PRIVATE});},write:value=>{output=value;}}),1);assert.deepEqual(JSON.parse(output),{schemaVersion:1,readOnly:true,state:'error',code:'DIAGNOSE_INTERNAL_FAILED'});assert.doesNotMatch(output,/PRIVATE_|[^\x00-\x7f]/);
});
