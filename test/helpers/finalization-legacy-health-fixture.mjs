import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {fixture} from './failed-finalization-fixture.mjs';
import {ActionDispatcher} from '../../src/daemon.mjs';
import {createActionDelivery} from '../../src/daemon-action-delivery.mjs';
import {createActionScheduler} from '../../src/daemon-action-scheduler.mjs';
import {inspectLocalDaemonMaintenanceFiles} from '../../backend/preservation-native-evidence.mjs';
import {finalizationDigest} from '../../src/bot-failure-finalization-contract.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const defaults={ActionDispatcher,createActionDelivery,createActionScheduler,inspectLocalDaemonMaintenanceFiles};

/** Real dispatcher/delivery journals and the daemon's real health function.
 * The health function is unchanged from official build 156874 (223b7efcabf7):
 * normalized SHA256 ccd5b99acc2a029a2cc5c717abb8440b9dc2f9664666ff89b55489de8ab903b8.
 * Only function dependencies are injected; no daemon entrypoint or socket runs.
 * Components may also be injected from the archived official package for audit.
 */
export async function legacyHealthFixture(t,{deliveryState='result_pending',retainedHistory=true,authorizeHistory=false,initialGateway=false,components={},healthSource}={}){
 const c={...defaults,...components},f=fixture(t),home=f.runtimeDir,runtimeDir=path.join(home,'runtime');
 fs.mkdirSync(runtimeDir);
 for(const name of ['action-state.json','action-delivery'])fs.renameSync(path.join(home,name),path.join(runtimeDir,name));
 const root=path.join(home,'node_modules','ziwei'),configPath=path.join(home,'ziwei_user.json');
 const config={...f.identity,deviceToken:'fixture-local-control',healthHost:'127.0.0.1',healthPort:20242,primary:true};
 fs.writeFileSync(configPath,JSON.stringify(config));
 const historicalDir=path.join(home,'historical');fs.mkdirSync(historicalDir);
 const historicalAction={id:'audited-failed-background',type:'conversation.execute',workspace_id:'ws_one',workspace:f.identity.workspace,dedupe_key:'audited-history-key',
  payload:{runtime:'Hermes',employeeId:'employee_history',deviceId:f.identity.deviceId,cwd:home,hermesBot:{employeeId:'employee_history',workspace:f.identity.workspace,deviceId:f.identity.deviceId,revision:7,controlEpoch:17}}};
 if(retainedHistory){
  const exit={platform:'win32',supervisor:'windows-job',launched:true,rootPid:46856,rootConfirmed:true,rootExitCode:1,treeConfirmed:false,activeProcesses:3,cancelled:false,backgroundProcessesRetained:true,hostExitCode:0};
  const historyDispatcher=new c.ActionDispatcher({workdir:home,workspace:f.identity.workspace,deviceId:f.identity.deviceId,stateFile:path.join(historicalDir,'action-state.json'),execute:async(_action,context)=>{
   context.onSupervision({completionEvidence:Promise.resolve(exit),stop:async()=>exit});
   return {status:'failed',code:'runtime_failed',error:'Provider context too long',result:{runtime:'Hermes',profile:'history-profile',code:1,signal:null,executionState:'uncertain',
    terminalMcp:{configured:true,injected:true,loaded:true,transport:'stdio',serverName:'ziwei-terminal',status:'loaded',workspace:f.identity.workspace,employeeId:'employee_history',actionId:historicalAction.id,runtime:'Hermes',profile:'history-profile',runtimeProfile:'history-profile',targetDeviceId:'phone-history',failure:{code:'terminal_mcp_receipt_incomplete',phoneExecutionState:'uncertain',retryAllowed:false}},
    configurationRevision:7,botIsolation:{kind:'hermes-bot',employeeId:'employee_history',workspace:f.identity.workspace,revision:7,profile:'history-profile'}}};
  }});
  const delivery=c.createActionDelivery({directory:path.join(historicalDir,'action-delivery'),identity:f.identity,retryDelays:[],dispatch:a=>historyDispatcher.dispatch(a),post:async(url,body)=>{
   if(url.endsWith('/ack'))return {id:historicalAction.id,status:'acked',deviceId:f.identity.deviceId,acked_at:new Date().toISOString(),expires_at:new Date(Date.now()+1_000_000).toISOString()};
   if(url.endsWith('/events'))return {id:body.eventId};
   if(deliveryState==='confirmed')return {id:historicalAction.id,status:'failed'};
   throw Object.assign(Error('fixture retained result transport unavailable'),{status:deliveryState==='blocked'?400:503});
  }});
  if(deliveryState==='confirmed')await delivery.execute(historicalAction);
  else await assert.rejects(delivery.execute(historicalAction),/retained result transport unavailable/);
  await delivery.whenIdle();
  const historicalState=JSON.parse(fs.readFileSync(path.join(historicalDir,'action-state.json'))),stateFile=path.join(runtimeDir,'action-state.json'),state=JSON.parse(fs.readFileSync(stateFile));
  state.started.push(...historicalState.started);state.completed.push(...historicalState.completed);fs.writeFileSync(stateFile,JSON.stringify(state));
  for(const name of fs.readdirSync(path.join(historicalDir,'action-delivery')))fs.copyFileSync(path.join(historicalDir,'action-delivery',name),path.join(runtimeDir,'action-delivery',name));
 }
 if(authorizeHistory){
  assert(retainedHistory);
  const file=path.join(runtimeDir,'action-state.json'),state=JSON.parse(fs.readFileSync(file)),originalBase=f.base;
  state.started=state.started.filter(row=>row.actionId===historicalAction.id);fs.writeFileSync(file,JSON.stringify(state));
  for(const name of fs.readdirSync(path.join(runtimeDir,'action-delivery')).filter(name=>name.startsWith(originalBase)))fs.unlinkSync(path.join(runtimeDir,'action-delivery',name));
  const result=JSON.parse(fs.readFileSync(path.join(runtimeDir,'action-delivery',sha(JSON.stringify(historicalAction.id))+'.result.json')));
  const {id:_oldReceiptId,...oldBody}=f.receipt,body={...oldBody,expectedControlEpoch:17,resultingControlEpoch:18,subject:{...oldBody.subject,
   actionId:historicalAction.id,employeeId:'employee_history',profile:'default',dedupeKey:historicalAction.dedupe_key,originalControlEpoch:17,
   profileBindingDigest:finalizationDigest(null),originalPayloadDigest:finalizationDigest(historicalAction.payload),originalResultDigest:finalizationDigest(result.result),originalActionSha256:finalizationDigest(historicalAction)}};
  f.receipt={...body,id:finalizationDigest(body)};f.receiptDigest=finalizationDigest(f.receipt);f.base=sha(JSON.stringify(historicalAction.id));
 }
 let executed=0,alive=true,draining=false,terminated=0,acknowledgements=0,gateway=initialGateway,nativeInput;
 const dispatcher=new c.ActionDispatcher({workdir:home,workspace:f.identity.workspace,deviceId:f.identity.deviceId,stateFile:path.join(runtimeDir,'action-state.json'),execute:async()=>{executed++;throw Error('original business must never replay');}});
 const delivery=c.createActionDelivery({directory:path.join(runtimeDir,'action-delivery'),identity:f.identity,post:async()=>{throw Error('no delivery transport during recovery');},dispatch:a=>dispatcher.dispatch(a)});
 delivery.recoverActions();
 const connection={config,runtimeDir,dispatcher,actionDelivery:delivery,actionScheduler:c.createActionScheduler({execute:async()=>{},quarantinedActionIds:()=>dispatcher.quarantinedActionIds}),localExecutor:{maintenanceStatus:()=>({safe:!gateway,workers:gateway?[{processAlive:true}]:[]})},managementBootstrap:{status:()=>({})},terminalStatus:{},polling:false,lastHeartbeatAt:0};
 const creationTime=new Date(Date.now()-20_000).toISOString(),record={pid:10001,creationTime,executable:'C:\\node.exe',commandHash:'c'.repeat(64)},build='a'.repeat(64),nonce='b'.repeat(48);
 const daemonSource=healthSource??fs.readFileSync(new URL('../../daemon/ziwei_user.mjs',import.meta.url),'utf8');
 const normalizedSource=daemonSource.replace(/\r\n/g,'\n'),start=normalizedSource.indexOf('function healthPayload()'),end=normalizedSource.indexOf('\nfunction localStopRefusal',start);
 assert(start>=0&&end>start,'must use the actual daemon health function');
 const context={executionAllowed:()=>!dispatcher.quarantined,connections:new Map([['primary',connection]]),inspectLocalDaemonMaintenanceFiles:c.inspectLocalDaemonMaintenanceFiles,
  VERSION:'legacy-contract-test',CLIENT_BUILD:build,config,runtimeDiscovery:{runtimes:[]},primaryConnection:connection,lastHeartbeat:null,lastHeartbeatAt:0,lastPoll:null,process:{pid:record.pid},lifecycleNonce:nonce,ROOT:root,configPath,
  lifecycleConfigurationHash:()=>sha(fs.readFileSync(configPath)),runtimeDir,lifecycleStartedAt:creationTime,remoteClientUpdates:{status:()=>({})},draining,connectionErrors:[]};
 const readHealth=vm.runInNewContext('('+normalizedSource.slice(start,end)+')',context);
 let mutateHealth=()=>{};
 const health=()=>{context.draining=draining;const body=JSON.parse(JSON.stringify(readHealth()));mutateHealth(body);return body;};
 const fetchImpl=async(input,options={})=>{
  const url=new URL(input),body=options.body?JSON.parse(options.body):null;
  if(url.pathname==='/a2a/v1/failure-finalizations')return Response.json({finalizations:[{receipt:f.receipt,receiptDigest:f.receiptDigest,state:'awaiting_client'}]});
  if(url.pathname.endsWith('/failure-finalization/ack')){acknowledgements++;return Response.json({state:'client_archived'});}
  if(url.pathname==='/healthz'){if(!alive)throw Object.assign(Error('offline'),{code:'ECONNREFUSED'});return Response.json(health());}
  if(url.pathname==='/local/failure-finalizations')return new Response(null,{status:404});
  if(url.pathname==='/local/connection-control'){assert.equal(body.nonce,nonce);draining=body.operation==='pause';if(draining)gateway=false;return Response.json(health());}
  throw Error('Unexpected fixture request');
 };
 const deps={platform:'win32',installedBuild:()=>build,inspectProcess:async()=>alive?record:null,inspectListener:async()=>({listenerPid:record.pid}),inventory:async()=>alive?[record]:[],listenerCount:async()=>alive?1:0,
  terminate:async data=>{
   terminated++;assert.equal(data.authorizedFinalizations.length,1);
   const observed=health(),originals=data.files.filter(file=>file.exists),snapshotHashes=data.snapshotFiles.map(file=>{assert.equal(sha(fs.readFileSync(file.path)),file.sha256);return file.sha256;});
   assert.equal(data.expectedActiveActionCount,observed.activeActionCount);assert.equal(data.expectedQuarantineCount,observed.quarantinedActionCount);
   assert.equal(data.retainedPendingCount,observed.maintenance.pendingDeliveryCount,'native pending count equals the real old health projection');
   assert.equal(data.expectedBlockedDeliveryCount,observed.maintenance.blockedDeliveryCount,'native blocked count equals the real old health projection');
   assert.equal(data.snapshotFiles.length,originals.length+1,'every source file plus the authorization list is backed up');
   let sourcePending=0,sourceBlocked=0;
   for(const file of originals){
    const original=fs.readFileSync(file.path);assert.equal(sha(original),file.sha256,'held native input pins source bytes');
    const index=snapshotHashes.indexOf(file.sha256);assert(index>=0,'the matching original snapshot exists');snapshotHashes.splice(index,1);
    if(path.dirname(file.path)===path.join(runtimeDir,'action-delivery')&&/^[a-f0-9]{64}\.json$/.test(path.basename(file.path))){
     const {state}=JSON.parse(original);if(state==='blocked')sourceBlocked++;else if(!['confirmed','maintenance_paused'].includes(state))sourcePending++;
    }
   }
   assert.equal(data.retainedPendingCount,sourcePending,'native pending count equals all snapshotted source journals');
   assert.equal(data.expectedBlockedDeliveryCount,sourceBlocked,'native blocked count equals all snapshotted source journals');
   assert.equal(snapshotHashes.length,1);
   nativeInput={pending:data.retainedPendingCount,blocked:data.expectedBlockedDeliveryCount,sourcePending,sourceBlocked,sourceFiles:originals.length,snapshotFiles:data.snapshotFiles.length};
   const exitedAt=new Date().toISOString(),output={stopped:true,pid:record.pid,creationTime,exitedAt,maintenanceCleanup:{schemaVersion:1,scope:'held-daemon-descendant-closure',rootPid:record.pid,rootCreationTime:creationTime,rootExitedAt:exitedAt,nonce,complete:true,descendantCount:0,terminatedCount:0,processes:[]}};
   fs.writeFileSync(data.exitFile,JSON.stringify(output));alive=false;return output;
  }};
 const connectionIdentity={...f.identity,runtimeDir},inspect=()=>inspectLocalDaemonMaintenanceFiles({connections:[connectionIdentity]});
 const historySnapshot=()=>Object.fromEntries(fs.readdirSync(path.join(runtimeDir,'action-delivery')).filter(name=>!name.startsWith(f.base)).sort().map(name=>[name,sha(fs.readFileSync(path.join(runtimeDir,'action-delivery',name)))]));
 return {f,root,home,runtimeDir,configPath,deps,fetchImpl,env:{ZIWEI_USER_HOME:home,ZIWEI_CONFIG:configPath},health,inspect,historySnapshot,
  counts:()=>({executed,terminated,acknowledgements,draining,alive}),nativeInput:()=>nativeInput,setHealthMutator:value=>{mutateHealth=value;}};
}
