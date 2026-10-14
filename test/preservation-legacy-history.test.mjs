import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {scanNativeFiles} from '../backend/preservation-native-evidence.mjs';

const baseline='0349b919fef49471d061b63f8a23c1685d223a10';
const protocolFiles=['src/management-bootstrap.mjs','daemon/ziwei_user.mjs','src/daemon.mjs','src/daemon-action-scheduler.mjs','src/local-action.mjs','src/runtime-adapters.mjs'];
const sources=new Map(protocolFiles.map(file=>[file,execFileSync('git',['show',baseline+':'+file],{cwd:path.resolve(import.meta.dirname,'..'),windowsHide:true})]));
function fixture(t,version=1){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-legacy-history-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const clientRoot=path.join(root,'client'),runtimeDir=path.join(root,'runtime');fs.mkdirSync(runtimeDir);
 for(const [file,bytes] of sources){const target=path.join(clientRoot,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);}
 const action={id:'original-legacy',type:'conversation.execute',workspace_id:'ws_original',workspace:'original',dedupe_key:'original-dedupe',status:'succeeded',acked_at:'2026-10-11T12:00:00.000Z',completed_at:'2026-10-11T12:00:01.000Z',payload:{employeeId:'employee_original',deviceId:'device_original'},result:{output:'original terminal body'}};
 const connection={workspace:'original',deviceId:'device_original',apiBase:'https://original.invalid',runtimeDir};
 const state={version,updatedAt:'2026-10-11T12:00:02.000Z',completed:[{key:action.dedupe_key,result:{actionId:action.id,status:'succeeded',completedAt:Date.parse(action.completed_at),result:action.result},...(version===2?{legacy:true}:{})}],...(version===2?{started:[]}:{})};
 const file=path.join(runtimeDir,'action-state.json');fs.writeFileSync(file,JSON.stringify(state));
 const configPath=path.join(root,'config.json');fs.writeFileSync(configPath,JSON.stringify({workspace:connection.workspace,deviceId:connection.deviceId,apiBase:connection.apiBase}));
 const configSha256=createHash('sha256').update(fs.readFileSync(configPath)).digest('hex');
 const productionRequest={schemaVersion:1,domain:'ziwei-production-request-v1',kind:'collect',operationId:'original-operation',specHash:'a'.repeat(64),challenge:'fresh-original-challenge',targetOrigins:[connection.apiBase],binding:{hostId:'host_original',deviceIds:['device_original'],workspaceIds:['ws_original'],clients:[{root:clientRoot,runtimeDir,configPath,configSha256,installedRole:'v1',originalInstance:{pid:123,createdAt:'2026-10-11T00:00:00.000Z',nonceDigest:'b'.repeat(64)}}]},actionProjection:{tables:{workspaces:{rows:[{id:'ws_original',slug:'original'}]}}}};
 return {root,clientRoot,file,action,connection,state,productionRequest};
}
const scan=f=>scanNativeFiles({connections:[f.connection],actions:[f.action],productionRequest:f.productionRequest});

test('known original V1 terminal history retains raw bytes without inventing new identity or tree fields',t=>{
 for(const version of [1,2]){
  const f=fixture(t,version),before=fs.readFileSync(f.file),action=JSON.stringify(f.action),proof=scan(f);
  assert.equal(proof.safe,true,JSON.stringify(proof.issues));assert.equal(proof.legacyHistoryProofs.length,1);
  assert.equal(proof.legacyHistoryProofs[0].kind,'legacy-terminal-history-v1');assert.equal(proof.legacyHistoryProofs[0].actionId,f.action.id);
  assert.equal(proof.legacyHistoryProofs[0].processExit,undefined);assert.deepEqual(fs.readFileSync(f.file),before);assert.equal(JSON.stringify(f.action),action);
 }
});

test('legacy history cannot authorize live, expired ACK, explicit uncertainty, changed source or mismatched results',t=>{
 const cases=[
  f=>{f.action.status='acked';},
  f=>{f.action.status='expired';f.action.result={};},
  f=>{f.state.completed[0].result.result.code='EXECUTION_UNCERTAIN';},
  f=>{f.state.completed[0].result.result.executionUncertain=true;},
  f=>{f.state.completed[0].result.result.outcome_uncertain=true;},
  f=>{f.state.completed[0].result.retainEvidence=true;},
  f=>{f.state.completed[0].retainEvidence=true;},
  f=>{f.state.completed[0].state='blocked';},
  f=>{f.state.completed[0].result.executionState='unknown';},
  f=>{f.state.completed[0].result.execution_state='unknown';},
  f=>{f.state.completed[0].result.result.processExit={launched:true,rootPid:456,treeConfirmed:false,activeProcesses:1};},
  f=>{f.action.result={output:'different original result'};},
  f=>{f.state.completed[0].key='different-dedupe';},
  f=>{f.action.workspace_id='ws_other';},
  f=>{f.action.payload.deviceId='device_other';},
  f=>{delete f.action.payload.deviceId;},
  f=>{f.action.payload.targetDeviceId='device_other';},
  f=>{fs.appendFileSync(path.join(f.clientRoot,'src/daemon.mjs'),'// changed protocol');},
  f=>{f.productionRequest.binding.clients=[];}
 ];
 for(const change of cases){const f=fixture(t);change(f);fs.writeFileSync(f.file,JSON.stringify(f.state));const before=fs.readFileSync(f.file);assert.equal(scan(f).safe,false);assert.deepEqual(fs.readFileSync(f.file),before);}
 const f=fixture(t);assert.equal(scanNativeFiles({connections:[f.connection],actions:[f.action]}).safe,false);
});

test('legacy missing payload device resolves only a same-workspace original employee binding',t=>{
 const f=fixture(t);delete f.action.payload.deviceId;f.productionRequest.actionProjection.tables.employees={rows:[{id:'employee_original',workspace_id:'ws_original',target_device_id:'device_original'}]};
 assert.equal(scan(f).safe,true);f.productionRequest.actionProjection.tables.employees.rows[0].target_device_id='device_other';assert.equal(scan(f).safe,false);
 f.productionRequest.actionProjection.tables.employees.rows[0].target_device_id='device_original';f.productionRequest.actionProjection.tables.employees.rows[0].workspace_id='ws_other';assert.equal(scan(f).safe,false);
});

test('mixed legacy cache never hides unpaired modern completions or duplicate keys',t=>{
 for(const duplicate of [false,true]){
  const f=fixture(t,2);f.state.completed.push({key:duplicate?f.action.dedupe_key:'other-modern',identity:{workspace:'original',deviceId:'device_original'},result:{actionId:'other-modern',status:'succeeded',result:{code:'EXECUTION_UNCERTAIN'}}});
  fs.writeFileSync(f.file,JSON.stringify(f.state));const before=fs.readFileSync(f.file);assert.equal(scan(f).safe,false);assert.deepEqual(fs.readFileSync(f.file),before);
 }
});

test('mixed legacy cache rejects malformed modern identity and explicit unresolved unmapped trees',t=>{
 for(const variant of ['tree','identity','nativeRuntime','quarantine']){
  const f=fixture(t,2),identity={workspace:'original',deviceId:'device_original'},started={key:'other-modern',actionId:'other-modern',identity,startedAt:1,nativeRuntime:false},result={actionId:'other-modern',status:'succeeded',result:{}};
  if(variant==='tree')result.result.processExit={launched:true,rootPid:456,rootConfirmed:true,rootExitCode:1,treeConfirmed:false,activeProcesses:1};
  if(variant==='identity')identity.unexpected=123;
  if(variant==='nativeRuntime')started.nativeRuntime='false';
  if(variant==='quarantine')started.quarantine={stopConfirmed:'false'};
  f.state.started.push(started);f.state.completed.push({key:started.key,identity,result});fs.writeFileSync(f.file,JSON.stringify(f.state));
  const before=fs.readFileSync(f.file);assert.equal(scan(f).safe,false,variant);assert.deepEqual(fs.readFileSync(f.file),before);
 }
});
