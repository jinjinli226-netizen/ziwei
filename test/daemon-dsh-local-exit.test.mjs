import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ActionDispatcher} from '../src/daemon.mjs';
import {createActionDelivery} from '../src/daemon-action-delivery.mjs';
import {createDshSessionEvidence} from '../src/dsh-session-evidence.mjs';
import {inspectLocalDaemonMaintenanceFiles,scanNativeFiles} from '../backend/preservation-native-evidence.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const snapshot=root=>Object.fromEntries(fs.readdirSync(root,{recursive:true}).filter(name=>fs.statSync(path.join(root,name)).isFile()).sort().map(name=>[name,hash(fs.readFileSync(path.join(root,name)))]));

async function fixture(t,{failed=false,archived=false}={}){
  const temp=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(temp,'ziwei-dsh-local-exit-'));
  t.after(()=>{assert.equal(path.dirname(root),temp);assert(path.basename(root).startsWith('ziwei-dsh-local-exit-'));fs.rmSync(root,{recursive:true,force:true});});
  const identity={apiBase:'https://dsh-local-exit.invalid',workspace:'local-exit-workspace',deviceId:'local-exit-device'};
  const action={id:'action-local-dsh-exit',type:'conversation.execute',workspace_id:'workspace-id',payload:{runtime:'DSH',profile:'local-bot',employeeId:'local-employee',conversationId:'local-conversation',deviceId:identity.deviceId}};
  const stateFile=path.join(root,'action-state.json');let delivery;
  const dispatcher=new ActionDispatcher({stateFile,workdir:root,workspace:identity.workspace,deviceId:identity.deviceId,
    onEvent:(event,data)=>{if(['action.started','action.stage'].includes(event))delivery?.recordEvent(data.actionId,event,data);},
    execute:async(current,context)=>{
      const evidence=createDshSessionEvidence({actionId:current.id,employeeId:current.payload.employeeId,conversationId:current.payload.conversationId,botName:current.payload.profile,sessionId:'native-session',requestId:'native-request'},async()=>{});
      context.onDshSessionSupervision(evidence.capability);evidence.acceptRequest(1);evidence.finishTurn(1,failed?'error':'completed');
      return failed?{status:'failed',error:'native turn failed'}:{status:'succeeded',output:'native turn completed'};
    }});
  if(archived){
    delivery=createActionDelivery({directory:path.join(root,'action-delivery'),identity,retryDelays:[],autoArchiveUnconfirmed:true,dispatch:value=>dispatcher.dispatch(value),post:async(url,body)=>{
      if(url.endsWith('/ack'))return{id:action.id,status:'acked',deviceId:identity.deviceId,acked_at:new Date().toISOString(),expires_at:new Date(Date.now()+16*60000).toISOString()};
      if(url.endsWith('/events'))return{id:body.eventId};
      throw Object.assign(new Error('fixture server rejection'),{status:409});
    }});
    await delivery.execute(action);await delivery.whenIdle();
  }else await dispatcher.dispatch(action);
  return{root,stateFile,connections:[{...identity,runtimeDir:root}],state:()=>JSON.parse(fs.readFileSync(stateFile)),save:value=>fs.writeFileSync(stateFile,JSON.stringify(value))};
}

for(const failed of [false,true])test(`a persisted DSH ${failed?'failed':'successful'} native terminal permits local stop after delivery history is absent`,async t=>{
  const f=await fixture(t,{failed}),before=snapshot(f.root),state=f.state(),local=inspectLocalDaemonMaintenanceFiles(f);
  assert.equal(state.completed[0].result.status,failed?'failed':'succeeded');assert.equal(state.completed[0].result.result.processExit,undefined);
  assert.equal(local.stopSafe,true,JSON.stringify(local.stopIssues));assert.equal(local.safe,true);
  assert.equal(scanNativeFiles(f).safe,false,'local native turn evidence cannot attest formal preservation');
  assert.deepEqual(snapshot(f.root),before);
});

test('a DSH native terminal releases local stop while its rejected server delivery stays archived and unknown',async t=>{
  const f=await fixture(t,{archived:true}),before=snapshot(f.root),local=inspectLocalDaemonMaintenanceFiles(f);
  assert.equal(local.stopSafe,true,JSON.stringify(local.stopIssues));assert.equal(local.archivedUnconfirmedCount,1);
  assert.equal(local.archivedUnconfirmed[0].resultUnknown,true);assert.equal(local.archivedUnconfirmed[0].blocking,false);
  assert.equal(scanNativeFiles(f).safe,false);assert.deepEqual(snapshot(f.root),before);
});

test('a malformed DSH delivery journal remains a refusal instead of throwing out of the health scan',async t=>{
  const f=await fixture(t),{runtimeDir,...identity}=f.connections[0],directory=path.join(runtimeDir,'action-delivery');fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory,hash(JSON.stringify('action-local-dsh-exit'))+'.json'),JSON.stringify({version:2,identity,binding:'unbound',events:[]}));
  const before=snapshot(f.root),local=inspectLocalDaemonMaintenanceFiles(f);
  assert.equal(local.stopSafe,false);assert(local.issues.some(row=>row.code==='DELIVERY_CORRUPT'));assert.deepEqual(snapshot(f.root),before);
});

const invalid={
  'missing persisted native binding':state=>{delete state.started[0].dshBinding;},
  'missing native terminal':state=>{delete state.completed[0].result.result.sessionExit;},
  'unconfirmed terminal':state=>{state.completed[0].result.result.sessionExit.terminalConfirmed=false;},
  'invalid turn':state=>{state.completed[0].result.result.sessionExit.turn=-1;},
  'contradictory success reason':state=>{state.completed[0].result.result.sessionExit.reason='aborted';},
  'another result session':state=>{state.completed[0].result.result.sessionId='foreign-session';},
  'another resource employee':state=>{state.started[0].resourceBinding.employeeId='foreign-employee';},
  'another resource type':state=>{state.started[0].resourceBinding.type='hermes.bot.native';},
  'a gateway resource':state=>{state.started[0].resourceBinding.resource='gateway';},
  'a different current device':state=>{state.started[0].identity.deviceId='foreign-device';state.completed[0].identity.deviceId='foreign-device';},
  'an unfinished quarantine':state=>{state.started[0].quarantine={stopConfirmed:false};},
  'a duplicate native action ID':state=>{const started=structuredClone(state.started[0]),completed=structuredClone(state.completed[0]);started.key=completed.key='second-key';state.started.push(started);state.completed.push(completed);},
};
for(const field of ['actionId','employeeId','conversationId','botName','sessionId','requestId'])invalid[`another terminal ${field}`]=state=>{state.completed[0].result.result.sessionExit[field]='foreign-binding';};
for(const [name,mutate]of Object.entries(invalid))test(`local DSH terminal validation still refuses ${name}`,async t=>{
  const f=await fixture(t),state=f.state();mutate(state);f.save(state);const before=snapshot(f.root);
  assert.equal(inspectLocalDaemonMaintenanceFiles(f).stopSafe,false);assert.equal(scanNativeFiles(f).safe,false);assert.deepEqual(snapshot(f.root),before);
});
