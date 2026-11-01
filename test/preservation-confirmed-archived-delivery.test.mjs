import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createActionDelivery} from '../src/daemon-action-delivery.mjs';
import {inspectLocalDaemonMaintenanceFiles,scanNativeFiles} from '../backend/preservation-native-evidence.mjs';

const identity={apiBase:'https://preservation-retry.invalid',workspace:'retry-workspace',deviceId:'retry-device'};
const exit={platform:'win32',supervisor:'windows-job',launched:true,rootPid:42,rootConfirmed:true,rootExitCode:0,treeConfirmed:true,activeProcesses:0,cancelled:false};

async function fixture(t,status='succeeded'){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-confirmed-archive-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const directory=path.join(root,'action-delivery');
  const action={id:'preservation-retry-action',type:'conversation.execute',workspace_id:'retry-workspace-id',agent_id:'ziwei_user',status:'pending',expires_at:new Date(Date.now()+900000).toISOString(),payload:{deviceId:identity.deviceId,employeeId:'retry-employee',conversationId:'retry-conversation'}};
  let refused=true,executions=0;
  const delivery=createActionDelivery({directory,identity,retryDelays:[],autoArchiveUnconfirmed:true,
    dispatch:async()=>{executions++;return{status,error:status==='failed'?'CLI failed':null,result:{processExit:{...exit,rootExitCode:status==='failed'?1:0}}};},
    post:async(url,body)=>{
      if(url.endsWith('/ack'))return{id:action.id,status:'acked',deviceId:identity.deviceId,acked_at:new Date().toISOString(),expires_at:new Date(Date.now()+900000).toISOString()};
      if(url.endsWith('/events'))return{id:body.eventId};
      if(refused)throw Object.assign(Error('Payload refused'),{status:413});
      return{id:action.id,status,deviceId:identity.deviceId,completed_at:new Date().toISOString(),result:{outputArtifacts:[]}};
    }});
  await delivery.execute(action);
  const stem=createHash('sha256').update(JSON.stringify(action.id)).digest('hex'),file=path.join(directory,stem+'.json');
  const original=JSON.parse(fs.readFileSync(file,'utf8'));
  const blobs=['action','result'].map(kind=>({file:path.join(directory,`${stem}.${kind}.json`),bytes:fs.readFileSync(path.join(directory,`${stem}.${kind}.json`))}));
  refused=false;
  const options={connections:[{...identity,runtimeDir:root}],actions:[{...action,status}]};
  return{delivery,action,file,original,blobs,options,get executions(){return executions;},save(record){fs.writeFileSync(file,JSON.stringify(record));},read(){return JSON.parse(fs.readFileSync(file,'utf8'));}};
}

for(const status of ['succeeded','failed'])test(`confirmed archived ${status} receipt keeps raw evidence without blocking maintenance or preservation`,async t=>{
  const f=await fixture(t,status);
  assert.equal(inspectLocalDaemonMaintenanceFiles(f.options).archivedUnconfirmedCount,1);
  await f.delivery.retryArchivedResult(f.action.id);
  const record=f.read();
  assert.equal(record.retainEvidence,true);assert.deepEqual(record.archive,f.original.archive);
  for(const blob of f.blobs)assert.deepEqual(fs.readFileSync(blob.file),blob.bytes);
  const local=inspectLocalDaemonMaintenanceFiles(f.options),formal=scanNativeFiles(f.options);
  assert.equal(local.safe,true,JSON.stringify(local.issues));assert.equal(local.stopSafe,true,JSON.stringify(local.stopIssues));
  assert.equal(local.archivedUnconfirmedCount,0);assert.deepEqual(local.issues,[]);
  assert.equal(formal.safe,true,JSON.stringify(formal.issues));assert.equal(f.executions,1);
});

const corruptions={
  'unknown archive reason':record=>{record.archive.reason='UNKNOWN';},
  'rewritten historical archive status':record=>{record.archive.serverTerminal=true;record.archive.serverStatus='succeeded';},
  'retryable archive refusal':record=>{record.archive.httpStatus=429;},
  'invalid confirmation time':record=>{record.confirmedAt='not-a-time';},
  'mismatched terminal status':record=>{record.serverStatus='failed';},
  'expired terminal status':record=>{record.serverStatus='expired';},
  'remaining pending events':record=>{record.events=[{eventId:'pending'}];}
};
for(const [label,corrupt] of Object.entries(corruptions))test(`confirmed archived evidence rejects ${label}`,async t=>{
  const f=await fixture(t);await f.delivery.retryArchivedResult(f.action.id);
  const record=f.read();corrupt(record);f.save(record);
  const local=inspectLocalDaemonMaintenanceFiles(f.options),formal=scanNativeFiles(f.options);
  assert.equal(local.stopSafe,false);assert.equal(formal.safe,false);
  assert.ok(local.issues.some(item=>item.code==='DELIVERY_CORRUPT'),JSON.stringify(local.issues));
});

test('a generic confirmed record with retained evidence remains blocked without valid archive history',async t=>{
  const f=await fixture(t);await f.delivery.retryArchivedResult(f.action.id);
  const record=f.read();delete record.archive;f.save(record);
  const local=inspectLocalDaemonMaintenanceFiles(f.options);
  assert.equal(local.stopSafe,false);assert.ok(local.issues.some(item=>item.code==='DELIVERY_NOT_DRAINED'));
  assert.equal(scanNativeFiles(f.options).safe,false);
});

test('confirmed archived evidence still requires the original result digest and definitive process exit',async t=>{
  const f=await fixture(t);await f.delivery.retryArchivedResult(f.action.id);
  const blob=f.blobs.find(item=>item.file.endsWith('.result.json'));
  fs.writeFileSync(blob.file,Buffer.concat([blob.bytes,Buffer.from(' ')]));
  let local=inspectLocalDaemonMaintenanceFiles(f.options);
  assert.equal(local.stopSafe,false);assert.ok(local.issues.some(item=>item.code==='DELIVERY_CORRUPT'));
  const result=JSON.parse(blob.bytes);result.result.processExit.treeConfirmed=false;
  const bytes=JSON.stringify(result);fs.writeFileSync(blob.file,bytes);
  const record=f.read();record.resultDigest=createHash('sha256').update(bytes).digest('hex');f.save(record);
  local=inspectLocalDaemonMaintenanceFiles(f.options);
  assert.equal(local.stopSafe,false);assert.ok(local.issues.some(item=>item.code==='DELIVERY_CORRUPT'));
  assert.equal(scanNativeFiles(f.options).safe,false);
});
