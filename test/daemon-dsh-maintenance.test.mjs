import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRepository} from '../backend/repository.mjs';
import {inspectLocalDaemonMaintenanceFiles,scanNativeFiles} from '../backend/preservation-native-evidence.mjs';
import {ActionDispatcher} from '../src/daemon.mjs';
import {createActionDelivery} from '../src/daemon-action-delivery.mjs';
import {executeDshRuntime} from '../src/dsh-runtime.mjs';
import {dshFixture} from './fixtures/dsh-protocol.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const snapshot=root=>Object.fromEntries(fs.readdirSync(root,{recursive:true}).filter(name=>fs.statSync(path.join(root,name)).isFile()).sort().map(name=>[name,hash(fs.readFileSync(path.join(root,name)))]));

async function fixture(t,{cancelUnconfirmed=false,cancelConfirmed=false}={}){
  const protocol=await dshFixture(t,cancelUnconfirmed||cancelConfirmed?{hold:true,cancelAckOnly:cancelUnconfirmed}:{}),repo=createRepository({memory:true,envEncryptionKey:'dsh-maintenance-fixture'});
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-dsh-maintenance-'));
  t.after(()=>{repo.db.close();fs.rmSync(root,{recursive:true,force:true});});
  const identity={apiBase:'https://dsh-maintenance.invalid',workspace:'test-111',deviceId:'dsh-maintenance-pc'};
  repo.heartbeatDevice(identity.workspace,{deviceId:identity.deviceId,runtimes:{DSH:{status:'available',version:'0.2.1'}}});
  const employee=repo.createEmployee(identity.workspace,{name:'DSH maintenance',runtime:'DSH',runtimeProfile:'bot-real',targetDeviceId:identity.deviceId});
  const conversation=repo.createConversation(identity.workspace,{employeeId:employee.id}),stateFile=path.join(root,'action-state.json');
  let delivery;
  const dispatcher=new ActionDispatcher({workdir:root,stateFile,workspace:identity.workspace,deviceId:identity.deviceId,stopGraceMs:50,
    onEvent:(type,event)=>{if(['action.started','action.output','action.stage','action.progress'].includes(type))delivery?.recordEvent(event.actionId,type,event);},
    execute:(action,context)=>executeDshRuntime({baseUrl:protocol.baseUrl,...protocol.transport,botName:action.payload.profile,prompt:action.payload.prompt,signal:context.signal,sessionAuthority:{actionId:action.id,employeeId:employee.id,conversationId:conversation.id},onSessionSupervision:context.onDshSessionSupervision,cancellationTimeoutMs:20})});
  delivery=createActionDelivery({directory:path.join(root,'action-delivery'),identity,retryDelays:[],dispatch:action=>dispatcher.dispatch(action),recoverResult:action=>dispatcher.completedResult(action),post:async(url,body)=>{
    const actionId=decodeURIComponent(url.split('/')[4]),input={...body,deviceId:identity.deviceId};
    if(url.endsWith('/ack'))return repo.ackA2AAction(actionId,input);
    if(url.endsWith('/events'))return repo.recordA2AEvent(actionId,input);
    return repo.resultA2AAction(actionId,input);
  }});
  const message=repo.addConversationMessage(conversation.id,{content:'maintenance regression'}),action=repo.getA2AAction(message.execution.id),running=delivery.execute(action);
  if(cancelUnconfirmed||cancelConfirmed){while(!protocol.calls.some(call=>call.method==='session/prompt'))await new Promise(resolve=>setImmediate(resolve));dispatcher.cancel(action.id);}
  await running;await delivery.whenIdle();
  const journalFile=path.join(root,'action-delivery',hash(JSON.stringify(action.id))+'.json'),connections=[{...identity,runtimeDir:root}];
  return{root,stateFile,journalFile,connections,protocol,action,
    state:()=>JSON.parse(fs.readFileSync(stateFile)),journal:()=>JSON.parse(fs.readFileSync(journalFile)),
    writeState:value=>fs.writeFileSync(stateFile,JSON.stringify(value)),writeJournal:value=>fs.writeFileSync(journalFile,JSON.stringify(value)),
    inspect:()=>inspectLocalDaemonMaintenanceFiles({connections})};
}

test('a delivered native DSH session terminal permits local maintenance without inventing process exit evidence',async t=>{
  const f=await fixture(t),state=f.state(),before=snapshot(f.root);
  assert.equal(state.completed[0].result.status,'succeeded');assert.equal(state.completed[0].result.result.sessionExit.terminalConfirmed,true);
  assert.equal(state.completed[0].result.result.processExit,undefined);assert.equal(f.journal().state,'confirmed');assert.equal(f.journal().serverStatus,'succeeded');
  assert.equal(f.inspect().safe,true);assert.equal(f.inspect().stopSafe,true);assert.deepEqual(f.inspect().stopIssues,[]);
  assert.equal(scanNativeFiles({connections:f.connections}).safe,false,'local session evidence is not formal namespace proof');
  assert.deepEqual(snapshot(f.root),before);assert.equal(f.protocol.calls.filter(call=>call.method==='session/prompt').length,1);
});

const invalidState={
  'another native session':state=>{state.completed[0].result.result.sessionExit.sessionId='another-session';},
  'another native request':state=>{state.completed[0].result.result.sessionExit.requestId='another-request';},
  'an invalid turn':state=>{state.completed[0].result.result.sessionExit.turn=-1;},
  'a fractional turn':state=>{state.completed[0].result.result.sessionExit.turn=1.5;},
  'a missing terminal confirmation':state=>{delete state.completed[0].result.result.sessionExit.terminalConfirmed;},
  'an in-flight native session':state=>{state.completed=[];},
  'a successful result with an aborted turn':state=>{state.completed[0].result.result.sessionExit.reason='aborted';},
  'a missing persisted native binding':state=>{delete state.started[0].dshBinding;},
  'another employee binding':state=>{state.started[0].resourceBinding.employeeId='another-employee';},
  'a different native workspace ID':state=>{state.started[0].identity.workspaceId='another-workspace';state.completed[0].identity.workspaceId='another-workspace';},
  'a gateway resource binding':state=>{state.started[0].resourceBinding.resource='gateway';state.started[0].resourceBinding.operation='connect';},
};
for(const [name,mutate]of Object.entries(invalidState))test(`DSH maintenance refuses ${name}`,async t=>{
  const f=await fixture(t),state=f.state();mutate(state);f.writeState(state);const before=snapshot(f.root);
  assert.equal(f.inspect().stopSafe,false);assert.deepEqual(snapshot(f.root),before);
});

const invalidJournal={
  'another delivery session':record=>{record.dshSessionBinding.sessionId='another-session';},
  'another delivery identity':record=>{record.identity.deviceId='another-device';},
  'another target device':record=>{record.action.payload.deviceId='another-device';},
  'a contradictory target alias':record=>{record.action.payload.target_device_id='another-device';},
  'a contradictory server result':record=>{record.serverStatus='failed';},
  'unconfirmed delivery':record=>{record.state='acked';},
};
for(const [name,mutate]of Object.entries(invalidJournal))test(`DSH maintenance refuses ${name}`,async t=>{
  const f=await fixture(t),record=f.journal();mutate(record);f.writeJournal(record);const before=snapshot(f.root);
  assert.equal(f.inspect().stopSafe,false);assert.deepEqual(snapshot(f.root),before);
});

test('a DSH cancellation ACK without its native terminal continues to block maintenance',async t=>{
  const f=await fixture(t,{cancelUnconfirmed:true}),before=snapshot(f.root);
  assert.equal(f.state().started[0].quarantine.stopConfirmed,false);assert.equal(f.journal().retainEvidence,true);
  assert.equal(f.inspect().stopSafe,false);assert.deepEqual(snapshot(f.root),before);
});

test('a confirmed cancelled DSH turn permits local maintenance with its failed server receipt',async t=>{
  const f=await fixture(t,{cancelConfirmed:true}),before=snapshot(f.root);
  assert.equal(f.state().completed[0].result.status,'failed');assert.equal(f.state().completed[0].result.result.sessionExit.reason,'aborted');
  assert.equal(f.journal().serverStatus,'failed');assert.equal(f.inspect().stopSafe,true);assert.deepEqual(snapshot(f.root),before);
});

test('a DSH cached terminal without its confirmed delivery journal remains unproven',async t=>{
  const f=await fixture(t);fs.unlinkSync(f.journalFile);const before=snapshot(f.root);
  assert.equal(f.inspect().stopSafe,false);assert.deepEqual(snapshot(f.root),before);
});
