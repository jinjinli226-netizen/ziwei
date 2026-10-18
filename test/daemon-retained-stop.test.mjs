import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ActionDispatcher} from '../src/daemon.mjs';
import {createActionDelivery} from '../src/daemon-action-delivery.mjs';
import {inspectLocalDaemonMaintenanceFiles,scanNativeFiles} from '../backend/preservation-native-evidence.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const identity={apiBase:'https://retained.invalid',workspace:'local-stop',deviceId:'local-pc'};
const tree={platform:'win32',supervisor:'windows-job',launched:true,rootPid:12345,rootConfirmed:true,rootExitCode:0,treeConfirmed:true,activeProcesses:0};
const action={id:'retained-action',type:'conversation.execute',workspace:identity.workspace,payload:{deviceId:identity.deviceId,employeeId:'local-employee',conversationId:'local-conversation',hermesBot:{employeeId:'local-employee',workspace:identity.workspace,deviceId:identity.deviceId,revision:1,controlEpoch:1}}};
function snapshot(directory){
  return Object.fromEntries(fs.readdirSync(directory,{recursive:true}).filter(name=>fs.statSync(path.join(directory,name)).isFile()).sort().map(name=>[name,hash(fs.readFileSync(path.join(directory,name)))]));
}
async function fixture(t,{state='blocked',status='failed',exitCode=status==='failed'?125:0,original=action,resultOverride}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-retained-stop-'));
  t.after(()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert(path.basename(root).startsWith('ziwei-retained-stop-'));fs.rmSync(root,{recursive:true,force:true});});
  const directory=path.join(root,'action-delivery'),connection={...identity,runtimeDir:root},calls=[];
  let executions=0;
  const dispatcher=new ActionDispatcher({workspace:identity.workspace,deviceId:identity.deviceId,workdir:root,stateFile:path.join(root,'action-state.json'),execute:async()=>{
    executions++;
    return {status,...(status==='failed'?{code:'runtime_failed',error:'Hermes CLI exited with code 125: bootstrap rejected'}:{}),result:resultOverride||{runtime:'Hermes',code:exitCode,processExit:{...tree,rootExitCode:exitCode}}};
  }});
  const post=async(url,body)=>{
    calls.push({url,body});
    if(url.endsWith('/ack'))return{id:original.id,status:'acked',deviceId:identity.deviceId,acked_at:'2026-10-15T00:00:00Z',expires_at:new Date(Date.now()+16*60*1000).toISOString()};
    if(url.endsWith('/events'))return{id:body.eventId};
    throw Object.assign(new Error('retained upload failure'),state==='blocked'?{status:409}:{});
  };
  const delivery=createActionDelivery({directory,identity,post,dispatch:value=>dispatcher.dispatch(value),recoverResult:value=>dispatcher.completedResult(value),retryDelays:[]});
  await assert.rejects(delivery.execute(original),/retained upload failure/);await delivery.whenIdle();
  const prefix=hash(JSON.stringify(original.id)),recordFile=path.join(directory,`${prefix}.json`);
  assert.equal(JSON.parse(fs.readFileSync(recordFile)).state,state);
  const change=(kind,mutate,{rehash=true}={})=>{
    const file=kind==='record'?recordFile:path.join(directory,`${prefix}.${kind}.json`),value=JSON.parse(fs.readFileSync(file));mutate(value);const bytes=JSON.stringify(value);fs.writeFileSync(file,bytes);
    if(kind!=='record'&&rehash){const record=JSON.parse(fs.readFileSync(recordFile));record[`${kind}Digest`]=hash(bytes);fs.writeFileSync(recordFile,JSON.stringify(record));}
  };
  const inspect=()=>{const before=snapshot(root),result=inspectLocalDaemonMaintenanceFiles({connections:[connection]});assert.deepEqual(snapshot(root),before);return result;};
  return{root,directory,prefix,recordFile,connection,delivery,post,calls,change,inspect,get executions(){return executions;}};
}

for(const state of ['blocked','result_pending'])for(const status of ['failed','succeeded'])test(`local stop retains ${state} ${status} original terminal bytes while formal evidence remains strict`,async t=>{
  const f=await fixture(t,{state,status}),before=snapshot(f.root),local=f.inspect();
  assert.equal(local.safe,false);assert.equal(local.stopSafe,true,JSON.stringify(local.stopIssues));assert.equal(local.retainedDeliveryCount,1);assert.deepEqual(local.stopIssues,[]);
  assert.deepEqual(local.issues.map(row=>row.code),['DELIVERY_NOT_DRAINED']);
  const record=JSON.parse(fs.readFileSync(f.recordFile));assert.equal(record.state,state);assert.equal(record.confirmedAt,undefined);assert.equal(f.executions,1);
  const formal=scanNativeFiles({connections:[f.connection]});assert.equal(formal.safe,false);assert(formal.issues.some(row=>row.code==='DELIVERY_NOT_DRAINED'));assert.equal(Object.hasOwn(formal,'stopSafe'),false);
  assert.deepEqual(snapshot(f.root),before);
  const restart=createActionDelivery({directory:f.directory,identity,post:f.post,dispatch:async()=>{throw new Error('retained original must not execute again');},retryDelays:[]});
  const recovered=restart.recoverActions();assert.equal(recovered.length,state==='blocked'?0:1);
  if(state==='result_pending'){await assert.rejects(restart.execute(recovered[0]),/retained upload failure/);await restart.whenIdle();}
  assert.equal(f.executions,1);assert.equal(f.inspect().stopSafe,true);
});

const invalid={
  'missing result blob':f=>fs.unlinkSync(path.join(f.directory,`${f.prefix}.result.json`)),
  'result digest mismatch':f=>f.change('result',value=>{value.result.code=126;},{rehash:false}),
  'action digest mismatch':f=>f.change('action',value=>{value.action.payload.employeeId='other';},{rehash:false}),
  'wrong record identity':f=>f.change('record',value=>{value.identity.deviceId='other';}),
  'wrong original device':f=>f.change('action',value=>{value.action.payload.deviceId='other';}),
  'contradictory original device aliases':f=>f.change('action',value=>{value.action.payload.targetDeviceId='other';}),
  'wrong original workspace':f=>f.change('action',value=>{value.action.workspace='other';}),
  'wrong Bot scope':f=>f.change('action',value=>{value.action.payload.hermesBot.workspace='other';}),
  'different result action id':f=>f.change('result',value=>{value.result.actionId='other';}),
  'incomplete root evidence':f=>f.change('result',value=>{value.result.processExit.rootConfirmed=false;}),
  'incomplete tree evidence':f=>f.change('result',value=>{value.result.processExit.treeConfirmed=false;}),
  'live owned process':f=>f.change('result',value=>{value.result.processExit.activeProcesses=1;}),
  'missing exit evidence':f=>f.change('result',value=>{delete value.result.processExit;}),
  'fixture evidence':f=>f.change('result',value=>{value.result.executionSource='fixture';}),
  'malformed progress event':f=>f.change('record',value=>{value.events=[{type:'unknown'}];}),
  'nonterminal delivery state':f=>f.change('record',value=>{value.state='acked';}),
  'unknown original execution':f=>{const file=path.join(f.root,'action-state.json'),value=JSON.parse(fs.readFileSync(file));value.completed=[];fs.writeFileSync(file,JSON.stringify(value));},
  'orphan delivery file':f=>fs.writeFileSync(path.join(f.directory,'unknown.tmp'),'preserved'),
  'Gateway bootstrap exit without worker exit':f=>f.change('result',value=>{value.result.nativeOperation={resource:'gateway',operation:'connect',employeeId:'local-employee',revision:1,data:{residentWorker:{workspace:identity.workspace,employeeId:'local-employee',revision:1,controlEpoch:1,sourceActionId:action.id,platform:'test',workerNonce:'owned-worker',rootPid:54321}}};})
};
for(const[name,mutate]of Object.entries(invalid))test(`local stop refuses ${name} without changing any original bytes`,async t=>{
  const f=await fixture(t);mutate(f);const result=f.inspect();assert.equal(result.safe,false);assert.equal(result.stopSafe,false,JSON.stringify(result));assert(result.stopIssues.length>0);assert.equal(f.executions,1);
});

const historicalOutcome={
  'nested business exit uncertainty':f=>f.change('result',value=>{value.result.additional={processExit:{}};}),
  'uncertain outcome with an exited CLI':f=>f.change('result',value=>{value.result.code='EXECUTION_UNCERTAIN';}),
  'pending outcome with an exited CLI':f=>f.change('result',value=>{value.result.execution_state='pending';}),
  'retained uncertain receipt with an exited CLI':f=>f.change('record',value=>{value.retainEvidence=true;}),
};
for(const[name,mutate]of Object.entries(historicalOutcome))test(`local stop retains ${name} without confirming delivery or changing original history`,async t=>{
  const f=await fixture(t);mutate(f);const before=snapshot(f.root),result=f.inspect();
  assert.equal(result.safe,false);assert.equal(result.stopSafe,true);assert.equal(result.retainedDeliveryCount,1);assert.deepEqual(result.stopIssues,[]);assert.equal(f.executions,1);
  assert.equal(JSON.parse(fs.readFileSync(f.recordFile)).state,'blocked');assert.equal(scanNativeFiles({connections:[f.connection]}).safe,false);assert.deepEqual(snapshot(f.root),before);
});

test('linked result evidence is not regular private original evidence',async t=>{
  const f=await fixture(t),file=path.join(f.directory,`${f.prefix}.result.json`),alias=path.join(f.root,'second-link');fs.linkSync(file,alias);
  assert.equal(f.inspect().stopSafe,false);
});

test('an original Gateway connect cannot substitute a bootstrap exit for missing worker receipts',async t=>{
  const original={...action,type:'hermes.bot.native',payload:{...action.payload,nativeOperation:{resource:'gateway',operation:'connect',input:{platform:'test'}}}};
  const f=await fixture(t,{original});assert.equal(f.inspect().stopSafe,false);
});

test('a connected Gateway needs its exact resident exit even if a bootstrap tree exited',async t=>{
  const original={...action,type:'hermes.bot.native',payload:{...action.payload,nativeOperation:{resource:'gateway',operation:'connect',input:{platform:'test'}}}};
  const worker={workspace:identity.workspace,employeeId:'local-employee',revision:1,controlEpoch:1,sourceActionId:original.id,platform:'test',workerNonce:'owned-worker',rootPid:54321};
  const resultOverride={processExit:tree,nativeOperation:{resource:'gateway',operation:'connect',employeeId:'local-employee',revision:1,data:{connected:true,residentWorker:worker,processExit:{...tree,rootPid:worker.rootPid}}}};
  const f=await fixture(t,{original,resultOverride});assert.equal(f.inspect().stopSafe,false);
});

test('Gateway connect metadata alone cannot prove that its worker never started',async t=>{
  const original={...action,type:'hermes.bot.native',payload:{...action.payload,nativeOperation:{resource:'gateway',operation:'connect',input:{platform:'test'}}}};
  const resultOverride={processExit:tree,nativeOperation:{resource:'gateway',operation:'connect',employeeId:'local-employee',revision:1,data:{}}};
  const f=await fixture(t,{original,resultOverride});assert.equal(f.inspect().stopSafe,false);
});
