import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {ActionDispatcher} from '../src/daemon.mjs';
import {createActionDelivery} from '../src/daemon-action-delivery.mjs';
import {inspectLocalDaemonMaintenanceFiles} from '../backend/preservation-native-evidence.mjs';
import {createRetainedClientStopRecovery,createRetainedHandleTerminator,recoverRetainedClientStop} from '../scripts/client-retained-stop-recovery.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const recoveryRoot=fileURLToPath(new URL('../',import.meta.url));
const snapshot=root=>Object.fromEntries(fs.readdirSync(root,{recursive:true}).filter(name=>fs.statSync(path.join(root,name)).isFile()).sort().map(name=>[name,sha(fs.readFileSync(path.join(root,name)))]));
async function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-retained-recovery-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const runtime=path.join(root,'runtime');fs.mkdirSync(runtime);
  const identity={apiBase:'https://retained.invalid',workspace:'recovery-test',deviceId:'recovery-pc'};
  const config={...identity,deviceToken:'synthetic-control-secret'},file=path.join(root,'config.json');fs.writeFileSync(file,JSON.stringify(config));
  const action={id:'original-retained',type:'conversation.execute',payload:{deviceId:identity.deviceId,employeeId:'employee-original',hermesBot:{employeeId:'employee-original',workspace:identity.workspace,deviceId:identity.deviceId,revision:1,controlEpoch:2}}};
  const dispatcher=new ActionDispatcher({workdir:root,workspace:identity.workspace,deviceId:identity.deviceId,stateFile:path.join(runtime,'action-state.json'),execute:async()=>({status:'failed',error:'synthetic bootstrap rejected',result:{processExit:{launched:true,rootPid:6000,rootConfirmed:true,rootExitCode:125,treeConfirmed:true,activeProcesses:0}}})});
  const delivery=createActionDelivery({directory:path.join(runtime,'action-delivery'),identity,retryDelays:[],dispatch:value=>dispatcher.dispatch(value),recoverResult:value=>dispatcher.completedResult(value),post:async(url,body)=>{
    if(url.endsWith('/ack'))return{id:action.id,status:'acked',acked_at:'2026-10-15T10:00:00Z',deviceId:identity.deviceId,expires_at:new Date(Date.now()+16*60*1000).toISOString()};
    if(url.endsWith('/events'))return{id:body.eventId};
    throw Object.assign(new Error('synthetic permanent delivery failure'),{status:400});
  }});
  await assert.rejects(delivery.execute(action),/synthetic permanent/);await delivery.whenIdle();
  const evidence=inspectLocalDaemonMaintenanceFiles({connections:[{...identity,runtimeDir:runtime}]});assert.equal(evidence.stopSafe,true);
  const record={pid:8832,creationTime:'2026-10-15T10:00:00.000Z',commandHash:'a'.repeat(64),executable:process.execPath};
  const context={root,file,build:'b'.repeat(64),origin:'http://127.0.0.1:20242',snapshot:{config,hash:sha(fs.readFileSync(file))}};
  const health={service:'ziwei_user',agentId:'ziwei_user',pid:record.pid,clientBuild:context.build,workspace:identity.workspace,deviceId:identity.deviceId,connectionState:'draining',activeActionCount:0,pollingCount:0,quarantinedActionCount:0,executionQuarantined:false,lifecycle:{nonce:'fixture-nonce-bound-to-boot',root,configPath:file,configSha256:context.snapshot.hash,runtimeDir:runtime,startedAt:record.creationTime,managedAuxiliaryCount:0},maintenance:{safe:false,pendingDeliveryCount:0,blockedDeliveryCount:1,fileIssues:evidence.issues,gatewayWorkers:[]},connections:[{workspace:identity.workspace,deviceId:identity.deviceId,primary:true}]};
  let kills=0,checks=0,lastData;
  const input={recoveryRoot,context,record,health,assertCurrent:async()=>{checks++;return structuredClone(health);}};
  const make=(options={})=>createRetainedClientStopRecovery({platform:'win32',terminate:async data=>{kills++;lastData=data;return{stopped:true,pid:record.pid,creationTime:record.creationTime};},...options});
  return{root,runtime,identity,context,record,health,input,make,get kills(){return kills;},get checks(){return checks;},get lastData(){return lastData;}};
}

test('only an idle old daemon with verified retained native receipts may stop; all original bytes survive',async t=>{
  const f=await fixture(t),before=snapshot(f.root),result=await f.make()(f.input);
  assert.equal(result.stopped,true);assert.equal(result.retainedReceiptRecovery,true);assert.equal(result.executionConfirmedStopped,false);assert.equal(result.retainedDeliveryCount,1);
  assert.equal(f.kills,1);assert.equal(f.checks,1);assert.equal(f.lastData.pid,8832);assert.equal(f.lastData.commandHash,f.record.commandHash);assert.equal(f.lastData.nonce,f.health.lifecycle.nonce);
  assert.equal(f.lastData.files.some(row=>row.path.endsWith('.result.json')),true);assert.equal(JSON.stringify(f.lastData).includes('synthetic-control-secret'),false);
  assert.deepEqual(snapshot(f.root),before);
});

const invalid={
  'new daemon advertises stopSafe':f=>{f.health.maintenance.stopSafe=true;},
  'ordinary maintenance is safe':f=>{f.health.maintenance.safe=true;},
  'not paused':f=>{f.health.connectionState='connected';},
  'active action':f=>{f.health.activeActionCount=1;},
  'active poll':f=>{f.health.pollingCount=1;},
  'quarantined execution':f=>{f.health.quarantinedActionCount=1;},
  'unknown Gateway list':f=>{delete f.health.maintenance.gatewayWorkers;},
  'live Gateway':f=>{f.health.maintenance.gatewayWorkers=[{processAlive:true,pendingCommands:0,inFlight:0,pendingInbound:0}];},
  'unconfirmed Gateway':f=>{f.health.maintenance.gatewayWorkers=[{processAlive:null,pendingCommands:0,inFlight:0,pendingInbound:0}];},
  'extra file blocker':f=>{f.health.maintenance.fileIssues.push({code:'DELIVERY_CORRUPT'});},
  'wrong build':f=>{f.health.clientBuild='c'.repeat(64);},
  'wrong device':f=>{f.health.deviceId='other';},
  'wrong workspace':f=>{f.health.workspace='other';},
  'wrong process':f=>{f.health.pid=9000;},
  'changed config bytes':f=>{fs.appendFileSync(f.context.file,' ');},
  'unknown shared connection':f=>{f.health.connections.push({workspace:'other',deviceId:'other',primary:false});},
  'missing result blob':f=>{const dir=path.join(f.runtime,'action-delivery');fs.rmSync(path.join(dir,fs.readdirSync(dir).find(name=>name.endsWith('.result.json'))));},
};
for(const[name,mutate]of Object.entries(invalid))test(`legacy retained recovery refuses ${name} before acquiring termination authority`,async t=>{
  const f=await fixture(t);mutate(f);const before=snapshot(f.root);
  await assert.rejects(f.make()(f.input),error=>error.code==='RETAINED_STOP_RECOVERY_REFUSED');assert.equal(f.kills,0);assert.deepEqual(snapshot(f.root),before);
});

test('fresh caller identity checks and the latest candidate inspector are mandatory',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.make()({...f.input,assertCurrent:async()=>{throw new Error('native listener changed');}}),/native listener changed/);
  await assert.rejects(f.make({importInspector:async()=>({inspectLocalDaemonMaintenanceFiles:()=>({safe:false,issues:[]})})})(f.input),error=>error.code==='RETAINED_STOP_RECOVERY_REFUSED');
  assert.equal(f.kills,0);
});

test('a reboot or changed queue between preflight and the held-handle phase refuses termination',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.make()({...f.input,assertCurrent:async()=>({...structuredClone(f.health),lifecycle:{...f.health.lifecycle,nonce:'different-boot-nonce'}})}),error=>error.code==='RETAINED_STOP_RECOVERY_REFUSED');
  await assert.rejects(f.make()({...f.input,assertCurrent:async()=>{fs.writeFileSync(path.join(f.runtime,'new-unrecognized.tmp'),'must-preserve');return structuredClone(f.health);}}),error=>error.code==='RETAINED_STOP_RECOVERY_REFUSED');
  assert.equal(f.kills,0);
});

test('a confirmed handle exit stays attached when final receipt preservation cannot be confirmed',async t=>{
  const f=await fixture(t);
  const recover=f.make({terminate:async data=>{fs.appendFileSync(f.context.file,' ');return{stopped:true,pid:data.pid,creationTime:data.creationTime};}});
  await assert.rejects(recover(f.input),error=>error.code==='RETAINED_STOP_RECOVERY_REFUSED'&&error.stoppedClientReceipt?.stopped===true&&error.stoppedClientReceipt.pid===f.record.pid);
});

test('termination errors cannot expose native command, paths or response payloads',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.make({terminate:async()=>{throw new Error('synthetic-control-secret private-path raw-health');}})(f.input),error=>error.code==='RETAINED_STOP_RECOVERY_REFUSED'&&!/synthetic-control-secret|private-path|raw-health/.test(error.message));
});

test('official recovery never enables a non-Windows force path',async()=>{
  if(process.platform!=='win32')await assert.rejects(recoverRetainedClientStop({}),error=>error.code==='WINDOWS_ONLY');
});

test('hundreds of evidence files travel through stdin and never enlarge the encoded command',async()=>{
  const invocations=[];
  const terminate=createRetainedHandleTerminator({runCommand:(command,args,options)=>{
    let resolve;const promise=new Promise(done=>{resolve=done;}),stdin=new EventEmitter();
    stdin.end=value=>{const data=JSON.parse(value);invocations.push({command,args,options,data,wireBytes:Buffer.byteLength(value)});resolve({stdout:JSON.stringify({stopped:true,pid:data.pid,creationTime:data.creationTime})});};
    promise.child={stdin};return promise;
  }});
  const base={pid:8832,creationTime:'fixture-created',waitMs:8000};
  await terminate({...base,files:[{path:'C:\\回执\\one.json',sha256:'a'.repeat(64)}]});
  await terminate({...base,files:Array.from({length:600},(_,i)=>({path:`C:\\回执\\very-long-private-evidence-${i}.result.json`,sha256:'b'.repeat(64)}))});
  assert.deepEqual(invocations[0].args,invocations[1].args);assert(invocations[1].wireBytes>65_536);
  assert(invocations[1].args.join(' ').length<32_000);assert.equal(invocations[1].data.files.length,600);assert.equal(invocations[1].data.files[599].path,'C:\\回执\\very-long-private-evidence-599.result.json');
  const program=Buffer.from(invocations[0].args.at(-1),'base64').toString('utf16le');
  assert.match(program,/\[Console\]::In\.ReadToEnd\(\)/);assert.match(program,/\$heldHandle=\$p\.Handle/);assert.match(program,/\$p\.Kill\(\)/);assert.match(program,/\$p\.WaitForExit/);assert.doesNotMatch(program,/Stop-Process|taskkill|original-retained/);
});
