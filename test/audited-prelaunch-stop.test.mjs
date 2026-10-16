import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {digest} from '../backend/version-preservation.mjs';
import {AUDITED_PRELAUNCH_BUILD,AUDITED_PRELAUNCH_POLICY_DIGEST,inspectLocalDaemonMaintenanceFiles,scanNativeFiles,inspectAuditedPrelaunchRecovery,retainAuditedPrelaunchRecovery} from '../backend/preservation-native-evidence.mjs';
import {createRetainedClientStopRecovery,shouldAttemptRetainedClientStopRecovery,RETAINED_STOP_HANDLE_PROGRAM} from '../scripts/client-retained-stop-recovery.mjs';
import {clientBuildIdentity} from '../src/management-bootstrap.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const error='Hermes 原生入口未绑定可核实的绝对解释器；请更新 Hermes 安装，不会改用系统 Python';
const snapshot=root=>Object.fromEntries(fs.readdirSync(root,{recursive:true}).filter(name=>fs.statSync(path.join(root,name)).isFile()).map(name=>[name,sha(fs.readFileSync(path.join(root,name)))]));
function fixture(t){
 const root=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-prelaunch-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const identity={apiBase:'https://prelaunch.invalid',workspace:'prelaunch-test',deviceId:'prelaunch-pc'},runtimeDir=path.join(root,'runtime'),actionId='action_synthetic_prelaunch',key='provision-dedupe';fs.mkdirSync(path.join(runtimeDir,'action-delivery'),{recursive:true});
 const action={id:actionId,type:'hermes.bot.provision',workspace_id:'workspace-synthetic',agent_id:'ziwei_user',dedupe_key:key,status:'acked',payload:{deviceId:identity.deviceId,employeeId:'employee-synthetic'}};
 const binding=sha(JSON.stringify({id:actionId,type:action.type,agent:'ziwei_user',workspace:action.workspace_id,device:identity.deviceId,employee:action.payload.employeeId,conversation:null,message:null,dedupe:key}));
 const started={key,actionId,identity:{workspace:identity.workspace,deviceId:identity.deviceId,workspaceId:action.workspace_id,targetDeviceId:identity.deviceId},startedAt:Date.parse('2026-10-15T15:36:47.103Z'),nativeRuntime:true,resourceBinding:{type:action.type,employeeId:action.payload.employeeId,revision:1,controlEpoch:null,resource:null,operation:null,platform:null}};
 const completed={key,identity:started.identity,result:{status:'failed',actionId,error,completedAt:Date.parse('2026-10-15T15:36:53.202Z')}};
 const delivery={version:2,identity,binding,action,state:'confirmed',events:[],createdAt:'2026-10-15T15:36:46Z',confirmedAt:'2026-10-15T15:36:54Z',serverStatus:'failed',dispatcherStatus:'failed',retainEvidence:false};
 const stateFile=path.join(runtimeDir,'action-state.json'),deliveryFile=path.join(runtimeDir,'action-delivery',sha(JSON.stringify(actionId))+'.json'),proofFile=path.join(runtimeDir,'prelaunch-history',sha(JSON.stringify(actionId))+'.json');
 const save=()=>{fs.writeFileSync(stateFile,JSON.stringify({version:2,started:[started],completed:[completed]}));fs.writeFileSync(deliveryFile,JSON.stringify(delivery));};save();
 const connection={...identity,runtimeDir},inspect=()=>inspectLocalDaemonMaintenanceFiles({connections:[connection]});
 const proof=()=>({schemaVersion:1,policy:'a996e-hermes-provision-prelaunch-v1',sourceBuild:AUDITED_PRELAUNCH_BUILD,sourcePolicyDigest:AUDITED_PRELAUNCH_POLICY_DIGEST,subject:{actionId,identity,startedAt:started.startedAt,completedAt:completed.result.completedAt,startedDigest:digest(started),completedDigest:digest(completed),deliveryDigest:digest(delivery),delivery},daemonExit:{stopped:true,pid:6400,creationTime:'2026-10-15T10:00:00.000Z',exitedAt:'2026-10-16T00:00:00.000Z'}});
 const writeProof=value=>{fs.mkdirSync(path.dirname(proofFile),{recursive:true});fs.writeFileSync(proofFile,JSON.stringify(value||proof()));};
 return {root,runtimeDir,connection,identity,actionId,started,completed,delivery,stateFile,deliveryFile,proofFile,inspect,proof,writeProof,save};
}

test('an unproven historical failure stays blocked; a bound daemon-exit document changes only local stopSafe',t=>{
 const f=fixture(t),before=snapshot(f.root);assert.deepEqual(f.inspect().stopIssues.map(row=>row.code),['UNMAPPED_NATIVE_EXECUTION']);f.writeProof();
 const local=f.inspect();assert.equal(local.safe,false);assert.equal(local.stopSafe,true);assert.equal(local.retainedPrelaunchCount,1);assert.deepEqual(local.stopIssues,[]);
 assert.equal(scanNativeFiles({connections:[f.connection]}).safe,false);assert.equal(Object.hasOwn(scanNativeFiles({connections:[f.connection]}),'stopSafe'),false);
 for(const [file,hash]of Object.entries(before))assert.equal(sha(fs.readFileSync(path.join(f.root,file))),hash);
 assert.equal(f.completed.result.processExit,undefined);
});
test('normal confirmed-delivery retention does not invalidate the preserved snapshot',t=>{
 const f=fixture(t);f.writeProof();fs.unlinkSync(f.deliveryFile);assert.equal(f.inspect().stopSafe,true);
});
const invalid={
 'a different source build':(f,p)=>{p.sourceBuild='a'.repeat(64);},
 'a different source policy':(f,p)=>{p.sourcePolicyDigest='b'.repeat(64);},
 'an unconfirmed daemon exit':(f,p)=>{p.daemonExit.stopped=false;},
 'history from an earlier daemon':(f,p)=>{p.daemonExit.creationTime='2026-10-15T16:00:00Z';},
 'completion after the claimed exit':(f,p)=>{p.daemonExit.exitedAt='2026-10-15T15:36:50Z';},
 'an added process-exit claim':f=>{f.completed.result.processExit={rootConfirmed:true};f.save();},
 'another failure message':f=>{f.completed.result.error='a different failure';f.save();},
 'an arbitrary execution type':f=>{f.started.resourceBinding.type='conversation.execute';f.save();},
 'a different device':f=>{f.started.identity.deviceId='other-pc';f.save();},
 'a changed confirmed delivery':f=>{f.delivery.confirmedAt='2026-10-15T15:37:00Z';f.save();},
 'a reused action id with changed records':f=>{f.started.startedAt++;f.save();},
 'a result that was not confirmed':f=>{f.delivery.state='result_pending';f.save();},
};
for(const [name,mutate]of Object.entries(invalid))test(`local history interpretation rejects ${name}`,t=>{
 const f=fixture(t),p=f.proof();mutate(f,p);f.writeProof(p);assert.equal(f.inspect().stopSafe,false);
});
test('the update selector does not grant a general modern 409 recovery path',()=>{
 const health={clientBuild:AUDITED_PRELAUNCH_BUILD,maintenance:{safe:false,stopSafe:false,fileIssues:[{code:'UNMAPPED_NATIVE_EXECUTION',actionId:'different-valid-id'}]}};
 assert.equal(shouldAttemptRetainedClientStopRecovery(health),true);
 for(const body of [{...health,clientBuild:'c'.repeat(64)},{...health,maintenance:{...health.maintenance,fileIssues:[{code:'ACTION_STATE_CORRUPT'}]}},{...health,maintenance:{...health.maintenance,fileIssues:[...health.maintenance.fileIssues,...health.maintenance.fileIssues]}}])assert.equal(shouldAttemptRetainedClientStopRecovery(body),false);
 assert.match(RETAINED_STOP_HANDLE_PROGRAM,/ParentProcessId/);
});

// Optional golden-package integration: use the already verified offline official
// archive installation, never fetch or install anything during this test.
test('the official audited package creates a durable proof only after the original held-handle exit',async t=>{
 const installed=process.env.ZIWEI_A996_FIXTURE||path.resolve('.local/audited-prelaunch-old-package/installed/node_modules/ziwei');
 if(!fs.existsSync(path.join(installed,'package.json'))){t.skip('set ZIWEI_A996_FIXTURE to an offline installed official a996e package');return;}
 assert.equal(clientBuildIdentity(installed),AUDITED_PRELAUNCH_BUILD);
 const f=fixture(t),before=snapshot(f.root),config={...f.identity,deviceToken:'synthetic-private-token'},file=path.join(f.root,'config.json');fs.writeFileSync(file,JSON.stringify(config));
 const context={root:installed,file,build:AUDITED_PRELAUNCH_BUILD,origin:'http://127.0.0.1:20242',snapshot:{config,hash:sha(fs.readFileSync(file))}},record={pid:6400,creationTime:'2026-10-15T10:00:00.000Z',commandHash:'a'.repeat(64),executable:process.execPath};
 const current=f.inspect(),health={service:'ziwei_user',agentId:'ziwei_user',pid:record.pid,clientBuild:AUDITED_PRELAUNCH_BUILD,workspace:f.identity.workspace,deviceId:f.identity.deviceId,connectionState:'draining',activeActionCount:0,pollingCount:0,quarantinedActionCount:0,executionQuarantined:false,lifecycle:{nonce:'synthetic-bound-boot-nonce',root:installed,configPath:file,configSha256:context.snapshot.hash,runtimeDir:f.runtimeDir,startedAt:record.creationTime,managedAuxiliaryCount:0},maintenance:{safe:false,stopSafe:false,retainedDeliveryCount:0,pendingDeliveryCount:0,blockedDeliveryCount:0,gatewaySafe:true,gatewayWorkers:[],fileIssues:current.issues,stopIssues:current.stopIssues.map(({code})=>({code}))},connections:[{workspace:f.identity.workspace,deviceId:f.identity.deviceId,primary:true}]};
 let kills=0;const recover=createRetainedClientStopRecovery({platform:'win32',terminate:async data=>{assert.equal(fs.existsSync(f.proofFile),false);assert.equal(data.prelaunchActionId,f.actionId);assert.equal(data.files.some(row=>row.path.endsWith('hermes-owned-profile.mjs')),true);kills++;return {stopped:true,pid:record.pid,creationTime:record.creationTime};}});
 const input={recoveryRoot:path.resolve('.'),context,record,health,assertCurrent:async()=>structuredClone(health)};
 assert.throws(()=>inspectAuditedPrelaunchRecovery({root:installed,build:AUDITED_PRELAUNCH_BUILD,connections:[f.connection],bootStartedAt:'2026-10-16T00:00:00Z'}));
 const module=await import('../backend/preservation-native-evidence.mjs');
 const changedAfterPreparation=createRetainedClientStopRecovery({platform:'win32',importInspector:async()=>({...module,inspectAuditedPrelaunchRecovery:options=>{const prepared=module.inspectAuditedPrelaunchRecovery(options);f.completed.result.error='a different unknown execution';f.save();return prepared;}}),terminate:async()=>{kills++;throw Error('must not terminate');}});
 await assert.rejects(changedAfterPreparation(input),error=>error.code==='RETAINED_STOP_RECOVERY_REFUSED');
 f.completed.result.error=error;f.save();
 await assert.rejects(recover({...input,assertCurrent:async()=>{f.started.startedAt++;f.save();return structuredClone(health);}}),error=>error.code==='RETAINED_STOP_RECOVERY_REFUSED');
 f.started.startedAt--;f.save();assert.equal(kills,0);assert.equal(fs.existsSync(f.proofFile),false);
 const result=await recover(input);
 assert.equal(kills,1);assert.equal(result.prelaunchHistoryRetained,true);assert.equal(result.executionConfirmedStopped,false);assert.equal(f.inspect().stopSafe,true);
 for(const [name,hash]of Object.entries(before))assert.equal(sha(fs.readFileSync(path.join(f.root,name))),hash);
 const prepared=inspectAuditedPrelaunchRecovery({root:installed,build:AUDITED_PRELAUNCH_BUILD,connections:[f.connection],bootStartedAt:record.creationTime});
 assert.throws(()=>retainAuditedPrelaunchRecovery(prepared,{stopped:false,pid:record.pid,creationTime:record.creationTime}));
 const retained=fs.readFileSync(f.proofFile),nextRecord={...record,pid:6401,creationTime:'2026-10-15T16:00:00.000Z'},nextHealth={...health,pid:nextRecord.pid,lifecycle:{...health.lifecycle,nonce:'synthetic-next-bound-boot',startedAt:nextRecord.creationTime}};
 const retry=createRetainedClientStopRecovery({platform:'win32',terminate:async data=>{assert.equal(data.pid,nextRecord.pid);return{stopped:true,pid:nextRecord.pid,creationTime:nextRecord.creationTime};}});
 assert.equal((await retry({...input,record:nextRecord,health:nextHealth,assertCurrent:async()=>structuredClone(nextHealth)})).prelaunchHistoryRetained,true);
 assert.deepEqual(fs.readFileSync(f.proofFile),retained,'a retry preserves the original historical exit document');
 fs.unlinkSync(f.proofFile);assert.throws(()=>inspectAuditedPrelaunchRecovery({root:installed,build:AUDITED_PRELAUNCH_BUILD,connections:[f.connection],bootStartedAt:nextRecord.creationTime}));
});
