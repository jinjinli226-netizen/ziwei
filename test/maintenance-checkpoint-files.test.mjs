import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {executionBinding} from '../src/execution-admission.mjs';
import {inspectLocalDaemonMaintenanceFiles,scanNativeFiles} from '../backend/preservation-native-evidence.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
function fixture(t){
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-checkpoint-files-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const identity={apiBase:'https://fixture.invalid',workspace:'fixture',deviceId:'device-fixture'};
  const action={id:'action-fixture',type:'conversation.execute',workspace_id:'ws-fixture',payload:{deviceId:identity.deviceId,employeeId:'employee-fixture',runtime:'Hermes',profile:'fixture',cwd:root}};
  const receipt={schemaVersion:1,actionId:action.id,executionBinding:executionBinding(action),updateId:'update-fixture',targetBuild:'2'.repeat(64),runtime:'Hermes',profile:'fixture',home:root,cwd:root,sessionId:'session-fixture',checkpointDigest:'3'.repeat(64),messageCount:4,pendingTools:0,processExit:{launched:true,rootPid:42,rootConfirmed:true,rootExitCode:0,treeConfirmed:true,activeProcesses:0,cancelled:false,backgroundProcessesRetained:false,platform:'linux',supervisor:'direct'}};
  const started={key:action.id,actionId:action.id,identity:{workspace:identity.workspace,deviceId:identity.deviceId,workspaceId:action.workspace_id,targetDeviceId:identity.deviceId},startedAt:1,hardDeadline:1000,nativeRuntime:true,resourceBinding:{type:action.type,employeeId:action.payload.employeeId,revision:null,controlEpoch:null,resource:null,operation:null,platform:null},maintenancePause:receipt};
  const state={version:2,started:[started],completed:[]};
  const binding=hash(JSON.stringify({id:action.id,type:action.type,agent:'ziwei_user',workspace:action.workspace_id,device:identity.deviceId,employee:action.payload.employeeId,conversation:null,message:null,dedupe:null}));
  const record={version:2,identity,binding,action,state:'maintenance_paused',events:[]};
  const dir=path.join(root,'action-delivery'),stem=hash(JSON.stringify(action.id));fs.mkdirSync(dir);
  const save=()=>{for(const [kind,blob]of Object.entries({action:{identity,binding,action},pause:receipt})){const bytes=JSON.stringify(blob);fs.writeFileSync(path.join(dir,`${stem}.${kind}.json`),bytes);record[`${kind}Digest`]=hash(bytes);}fs.writeFileSync(path.join(dir,stem+'.json'),JSON.stringify(record));fs.writeFileSync(path.join(root,'action-state.json'),JSON.stringify(state));};save();
  const connections=[{...identity,runtimeDir:root}];return {root,receipt,started,state,record,action,save,connections};
}
test('only matching durable paused action and receipt allow local maintenance, never formal preservation',t=>{
  const f=fixture(t),r=inspectLocalDaemonMaintenanceFiles(f);assert.equal(r.safe,true,JSON.stringify(r.issues));assert.equal(r.stopSafe,true);assert.equal(r.maintenancePausedCount,1);assert.equal(scanNativeFiles(f).safe,false);
});
for(const [name,mutate]of Object.entries({
  'resume launch window':f=>f.started.maintenanceResumeStarted=true,
  'unfinished tool':f=>f.receipt.pendingTools=1,
  'changed original action':f=>f.action.payload.prompt='different task',
  'undelivered original event':f=>f.record.events.push({}),
  'unconfirmed process tree':f=>f.receipt.processExit.treeConfirmed=false,
  'foreign device':f=>f.started.identity.deviceId='other-device',
}))test(`local maintenance refuses ${name}`,t=>{const f=fixture(t);mutate(f);f.save();assert.equal(inspectLocalDaemonMaintenanceFiles(f).stopSafe,false);});
