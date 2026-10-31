import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createActionDelivery,ARCHIVED_UNCONFIRMED_STATE} from '../src/daemon-action-delivery.mjs';
import {inspectLocalDaemonMaintenanceFiles,scanNativeFiles} from '../backend/preservation-native-evidence.mjs';

const identity={apiBase:'https://archive.invalid',workspace:'archive-workspace',deviceId:'archive-device'};
const action=(id='archive-action')=>({id,type:'conversation.execute',workspace_id:'archive-workspace-id',agent_id:'ziwei_user',status:'pending',expires_at:new Date(Date.now()+900000).toISOString(),payload:{deviceId:identity.deviceId,employeeId:'archive-employee',conversationId:'archive-conversation'}});
const exit={platform:'win32',supervisor:'windows-job',launched:true,rootPid:1234,rootConfirmed:true,rootExitCode:1,treeConfirmed:true,activeProcesses:0,cancelled:false};

function fixture(t,{ack='acked',resultFailure=403,autoArchiveUnconfirmed=true}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-archived-unconfirmed-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const directory=path.join(root,'action-delivery'),calls=[];let executions=0;
  const post=async(url,body)=>{
    calls.push({url,body});
    if(url.endsWith('/ack')){
      if(ack==='expired')return{id:'archive-action',status:'expired',deviceId:identity.deviceId,reconciliationRequired:true};
      return{id:'archive-action',status:'acked',deviceId:identity.deviceId,acked_at:new Date().toISOString(),expires_at:new Date(Date.now()+900000).toISOString()};
    }
    if(url.endsWith('/events'))return{id:body.eventId};
    throw Object.assign(Error('server terminal unavailable'),{status:resultFailure});
  };
  const delivery=createActionDelivery({directory,identity,post,retryDelays:[],autoArchiveUnconfirmed,dispatch:async()=>{executions++;return{status:'failed',error:'CLI failed',result:{processExit:exit}};}});
  const files=()=>fs.readdirSync(directory).filter(name=>name.endsWith('.json'));
  return{root,directory,calls,post,delivery,files,get executions(){return executions;}};
}

test('a permanent result refusal becomes a local archived-unconfirmed terminal while retaining raw action and result blobs',async t=>{
  const f=fixture(t);const a=action();const outcome=await f.delivery.execute(a);
  assert.deepEqual(outcome,{state:ARCHIVED_UNCONFIRMED_STATE,status:null,reason:'PERMANENT_SERVER_REJECTION'});
  const metadata=JSON.parse(fs.readFileSync(path.join(f.directory,f.files().find(name=>/^[a-f0-9]{64}\.json$/.test(name)))));
  assert.equal(metadata.state,ARCHIVED_UNCONFIRMED_STATE);assert.equal(metadata.retainEvidence,true);assert.equal(metadata.archive.serverTerminal,false);assert.equal(metadata.archive.httpStatus,403);assert.equal(metadata.serverStatus,undefined);
  assert.ok(f.files().some(name=>name.endsWith('.action.json')));assert.ok(f.files().some(name=>name.endsWith('.result.json')));assert.equal(f.delivery.pendingCount,0);assert.equal(f.delivery.blockedCount,0);assert.equal(f.delivery.archivedUnconfirmedCount,1);assert.equal(f.executions,1);
  const local=inspectLocalDaemonMaintenanceFiles({connections:[{...identity,runtimeDir:f.root}]}),formal=scanNativeFiles({connections:[{...identity,runtimeDir:f.root}],actions:[a]});
  assert.equal(local.safe,true);assert.equal(local.stopSafe,true);assert.equal(local.retainedDeliveryCount,1);assert.equal(local.archivedUnconfirmedCount,1);assert.deepEqual(local.stopIssues,[]);assert.equal(local.archivedUnconfirmed[0].code,'DELIVERY_ARCHIVED_UNCONFIRMED');assert.match(local.archivedUnconfirmed[0].message,/不阻塞维护/);assert.equal(local.archivedUnconfirmed[0].blocking,false);assert.equal(local.archivedUnconfirmed[0].resultUnknown,true);assert.equal(local.archivedUnconfirmed[0].evidencePaths.length,3);assert.equal(formal.safe,true);assert.equal(Object.hasOwn(formal,'stopSafe'),false);
  const restarted=createActionDelivery({directory:f.directory,identity,post:f.post,dispatch:async()=>{throw Error('must not execute');},retryDelays:[],autoArchiveUnconfirmed:true});
  assert.deepEqual(restarted.recoverActions(),[]);assert.deepEqual(await restarted.execute(a),{state:ARCHIVED_UNCONFIRMED_STATE,status:null,reason:'PERMANENT_SERVER_REJECTION'});assert.equal(f.executions,1);
});

test('an expired ACK with no server result is archived with action evidence only and never starts execution',async t=>{
  const f=fixture(t,{ack:'expired'}),a=action('expired-action');
  // The fixture transport keys ACKs by the canonical test action ID; keep the
  // action ID aligned so the response remains a valid authenticated receipt.
  a.id='archive-action';
  assert.deepEqual(await f.delivery.execute(a),{state:ARCHIVED_UNCONFIRMED_STATE,status:null,reason:'SERVER_LEASE_EXPIRED'});assert.equal(f.executions,0);assert.equal(f.delivery.pendingCount,0);assert.equal(f.delivery.blockedCount,0);
  const names=f.files();assert.ok(names.some(name=>name.endsWith('.action.json')));assert.equal(names.some(name=>name.endsWith('.result.json')),false);
  const local=inspectLocalDaemonMaintenanceFiles({connections:[{...identity,runtimeDir:f.root}]});assert.equal(local.stopSafe,true);assert.equal(local.archivedUnconfirmedCount,1);assert.equal(local.retainedPendingCount,0);assert.equal(local.archivedUnconfirmed[0].reason,'SERVER_LEASE_EXPIRED');
});

test('legacy blocked journal converges on recovery when auto archival is enabled',async t=>{
  const f=fixture(t,{autoArchiveUnconfirmed:false}),a=action();await assert.rejects(f.delivery.execute(a),/server terminal unavailable/);assert.equal(f.delivery.blockedCount,1);
  const reopened=createActionDelivery({directory:f.directory,identity,post:async()=>{throw Error('must not contact server');},dispatch:async()=>{throw Error('must not execute');},retryDelays:[],autoArchiveUnconfirmed:true});assert.deepEqual(reopened.recoverActions(),[]);assert.equal(reopened.blockedCount,0);assert.equal(reopened.archivedUnconfirmedCount,1);
});

test('an expired result receipt is archived after the server offers no terminal even when the local CLI exit is definitive',async t=>{
  const f=fixture(t),a=action(),ackCount={value:0};
  const post=async(url,body)=>{
    f.calls.push({url,body});
    if(url.endsWith('/ack')){ackCount.value++;return ackCount.value===1?{id:a.id,status:'acked',deviceId:identity.deviceId,acked_at:new Date().toISOString(),expires_at:new Date(Date.now()+900000).toISOString()}:{id:a.id,status:'expired',deviceId:identity.deviceId,acked_at:new Date().toISOString(),reconciliationRequired:true};}
    if(url.endsWith('/events'))return{id:body.eventId};
    return{id:a.id,status:'expired',deviceId:identity.deviceId,reconciliationRequired:true};
  };
  const delivery=createActionDelivery({directory:f.directory,identity,post,retryDelays:[],autoArchiveUnconfirmed:true,dispatch:async()=>({status:'failed',error:'CLI failed',result:{processExit:exit}})});
  assert.deepEqual(await delivery.execute(a),{state:ARCHIVED_UNCONFIRMED_STATE,status:null,reason:'SERVER_LEASE_EXPIRED'});assert.equal(delivery.archivedUnconfirmedCount,1);assert.ok(f.files().some(name=>name.endsWith('.result.json')));
});
