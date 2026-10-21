import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {defaultUserDir,resolveConfigPath,resolveDaemonDataDirectory,resolveWorkspaceConnections} from '../daemon/config.mjs';
import {clientBuildIdentity} from './management-bootstrap.mjs';
import {archiveFailureFinalization,inspectFailureFinalizationLocal} from './client-failed-action-finalization.mjs';
import {inspectLocalDaemonMaintenanceFiles} from '../backend/preservation-native-evidence.mjs';
import {inspectNativeClientProcess,inspectNativeHealthListener} from '../scripts/client-lifecycle.mjs';
import {createForceAbandonInventory,createForceAbandonListenerCount} from '../scripts/client-force-abandon-recovery.mjs';
import {createLocalHistoryHandleTerminator,validatedMaintenanceCleanup,LOCAL_HISTORY_STOP_HANDLE_PROGRAM} from '../scripts/client-local-history-stop-recovery.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const failure=code=>Object.assign(new Error(code),{code});
const fact=(value,code='FAILURE_FINALIZATION_LOCAL_MISMATCH')=>{if(!value)throw failure(code);};
const samePath=(a,b)=>typeof a==='string'&&typeof b==='string'&&path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
function noLinks(file){for(let current=path.resolve(file);;current=path.dirname(current)){let stat;try{stat=fs.lstatSync(current);}catch(error){if(error.code!=='ENOENT')throw error;}fact(!stat?.isSymbolicLink(),'FAILURE_FINALIZATION_UNSAFE_PATH');if(current===path.dirname(current))break;}}
function bytes(file){noLinks(file);const stat=fs.lstatSync(file);fact(stat.isFile()&&stat.nlink===1&&stat.size<=128*1024*1024);return fs.readFileSync(file);}
function save(file,value){noLinks(file);const data=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value)),fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
const ordinaryIdle=" Assert-Fact 'LH08_HEALTH_IDLE' ($h.connectionState -ceq 'draining' -and $h.activeActionCount -eq 0 -and $h.pollingCount -eq 0 -and $h.quarantinedActionCount -eq 0 -and $h.executionQuarantined -eq $false)";
const finalizationIdle=String.raw` $authorizedCount=@($d.authorizedFinalizations).Count
 Assert-Fact 'LH08_HEALTH_IDLE' ($authorizedCount -gt 0 -and $authorizedCount -le 100 -and $d.expectedActiveActionCount -ge 0 -and $d.expectedActiveActionCount -le $authorizedCount -and $d.expectedQuarantineCount -ge 0 -and $d.expectedQuarantineCount -le $authorizedCount -and $h.connectionState -ceq 'draining' -and $h.activeActionCount -eq $d.expectedActiveActionCount -and $h.pollingCount -eq 0 -and $h.quarantinedActionCount -eq $d.expectedQuarantineCount -and $h.executionQuarantined -eq ($d.expectedQuarantineCount -gt 0))`;
const ordinaryMaintenance=" Assert-Fact 'LH10_HEALTH_MAINTENANCE' ($h.maintenance.safe -eq $false -and $h.maintenance.gatewaySafe -eq $true -and $h.maintenance.gatewayWorkers -is [Array] -and @($h.maintenance.gatewayWorkers).Count -eq 0 -and $h.maintenance.pendingDeliveryCount -eq $d.retainedPendingCount)";
const finalizationMaintenance=ordinaryMaintenance.slice(0,-1)+" -and $h.maintenance.blockedDeliveryCount -eq $d.expectedBlockedDeliveryCount)";
// Preserve the ordinary maintenance protocol byte-for-byte. This separate
// candidate-only variant changes only the two explicit authorized counts;
// process handles, generations, snapshots and descendant cleanup are shared.
fact(LOCAL_HISTORY_STOP_HANDLE_PROGRAM.split(ordinaryIdle).length===2&&LOCAL_HISTORY_STOP_HANDLE_PROGRAM.split(ordinaryMaintenance).length===2);
export const FAILURE_FINALIZATION_STOP_HANDLE_PROGRAM=LOCAL_HISTORY_STOP_HANDLE_PROGRAM.replace(ordinaryIdle,finalizationIdle).replace(ordinaryMaintenance,finalizationMaintenance);
const nativeInventory=createForceAbandonInventory(),nativeListeners=createForceAbandonListenerCount(),nativeTerminate=createLocalHistoryHandleTerminator({program:FAILURE_FINALIZATION_STOP_HANDLE_PROGRAM});

/** The verified candidate runs this hook before the old client's stop gate.
 * A legacy client may not understand disposition records. Pause admission,
 * prove that every remaining active record is an authorized failed action,
 * then stop only the held installation/boot and its captured descendants.
 * The original action's exit is deliberately still unknown. */
export function createFailedActionFinalizationRecovery({platform=process.platform,
  inspectProcess=inspectNativeClientProcess,inspectListener=inspectNativeHealthListener,
  inventory=nativeInventory,listenerCount=nativeListeners,terminate=nativeTerminate,
  installedBuild=clientBuildIdentity,inspectEvidence=inspectLocalDaemonMaintenanceFiles,checkpoint=()=>{}}={}) {
  return async function recover({root,env=process.env,fetchImpl=globalThis.fetch,log=()=>{}}={}) {
    if(platform!=='win32')return {recovered:false};
    const configPath=resolveConfigPath({root,env});let configBytes;
    try{configBytes=bytes(configPath);}catch(error){if(error.code==='ENOENT')return {recovered:false};throw error;}
    const config=JSON.parse(configBytes),configSha256=hash(configBytes);
    const runtimeDir=env.ZIWEI_USER_HOME?path.join(defaultUserDir({env}),'runtime'):path.join(root,'.local','runtime');
    const resolved=resolveWorkspaceConnections(config,{configPath,root});fact(resolved.errors.length===0);
    const connections=resolved.connections.filter(c=>c.deviceToken).map(c=>({...c,
      runtimeDir:c.primary?runtimeDir:path.join(runtimeDir,'shared-workspaces',c.workspace,c.deviceId)}));
    const request=async(connection,pathname,body)=>{
      const api=new URL(connection.apiBase);fact(api.protocol==='https:'&&!api.username&&!api.password&&!api.search&&!api.hash&&api.pathname==='/','FAILURE_FINALIZATION_SCOPE_MISMATCH');
      const response=await fetchImpl(api.origin+pathname,{method:body?'POST':'GET',redirect:'error',
        headers:{'x-ziwei-device-token':connection.deviceToken,...(body?{'content-type':'application/json'}:{})},
        ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(8000)});
      if(response.status===404&&!body)return null;
      if(!response.ok)throw failure('FAILURE_FINALIZATION_TRANSPORT');return response.json();
    };
    const subjects=[];
    for(const connection of connections){
      const response=await request(connection,'/a2a/v1/failure-finalizations?'+new URLSearchParams({workspace:connection.workspace,deviceId:connection.deviceId}));
      if(!response)continue;fact(Array.isArray(response.finalizations)&&response.finalizations.length<=100,'FAILURE_FINALIZATION_RESPONSE_INVALID');
      for(const row of response.finalizations){
        const identity={apiBase:connection.apiBase,workspace:connection.workspace,deviceId:connection.deviceId};
        const local=inspectFailureFinalizationLocal({runtimeDir:connection.runtimeDir,identity,receipt:row.receipt,receiptDigest:row.receiptDigest});
        subjects.push({connection,identity,row,local});
      }
    }
    if(!subjects.length)return {recovered:false};
    let previouslyApplied=0;
    const settlePreviouslyApplied=async()=>{for(let index=subjects.length-1;index>=0;index--){
      const item=subjects[index];if(!item.local.alreadyApplied)continue;
      const local=archiveFailureFinalization({runtimeDir:item.connection.runtimeDir,identity:item.identity,receipt:item.row.receipt,receiptDigest:item.row.receiptDigest});
      try{await request(item.connection,'/a2a/v1/actions/'+encodeURIComponent(local.actionId)+'/failure-finalization/ack',
        {receiptId:local.receiptId,receiptDigest:local.receiptDigest,archiveSha256:local.archiveSha256,localProcessDisposition:local.localProcessDisposition});}
      catch{log('failure_finalization_ack_pending',{actionId:local.actionId});}
      subjects.splice(index,1);previouslyApplied++;
    }};
    const host=String(config.healthHost||env.ZIWEI_HEALTH_HOST||'127.0.0.1').replace(/^localhost$/,'127.0.0.1');
    const port=Number(config.healthPort||env.ZIWEI_HEALTH_PORT||20242);
    fact(['127.0.0.1','::1','[::1]'].includes(host)&&Number.isSafeInteger(port)&&port>0&&port<65536);
    const origin=`http://${host.includes(':')?'[::1]':host}:${port}`;
    const health=async()=>{try{const response=await fetchImpl(origin+'/healthz',{redirect:'error',signal:AbortSignal.timeout(5000)});fact(response.ok,'FAILURE_FINALIZATION_CLIENT_IDENTITY');return response.json();}
      catch(error){if(error.code==='ECONNREFUSED'||error.cause?.code==='ECONNREFUSED')return null;throw error;}};
    let pinned=await health(),stopReceipt;
    if(pinned){
      const record=await inspectProcess(pinned.pid,root),build=installedBuild(root),life=pinned.lifecycle;
      fact(record&&Number.isSafeInteger(record.pid)&&record.pid>0&&record.pid!==process.pid&&life
        &&pinned.service==='ziwei_user'&&pinned.agentId==='ziwei_user'&&pinned.clientBuild===build
        &&pinned.workspace===config.workspace&&pinned.deviceId===config.deviceId
        &&samePath(life.root,root)&&samePath(life.configPath,configPath)&&samePath(life.runtimeDir,runtimeDir)
        &&life.configSha256===configSha256&&Math.abs(Date.parse(life.startedAt)-Date.parse(record.creationTime))<=15000
        &&typeof life.nonce==='string'&&/^[A-Za-z0-9_-]{16,128}$/.test(life.nonce),'FAILURE_FINALIZATION_CLIENT_IDENTITY');
      await inspectListener(origin,record.pid);
      const localRequest=async(pathname,body)=>fetchImpl(origin+pathname,{method:'POST',headers:{'content-type':'application/json','x-ziwei-local-control':config.deviceToken},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(35000)});
      // New clients can settle in memory and then use their normal stop path.
      const notified=await localRequest('/local/failure-finalizations',{nonce:life.nonce});
      if(notified.ok){
        const outcome=await notified.json();fact(outcome.ok===true);
        // The new daemon owns its memory. Never fall back to a legacy kill
        // merely because its archive ACK was lost or an exact stop is busy.
        fact(outcome.pending===0||outcome.localPending===0,'FAILURE_FINALIZATION_BUSY');
        return {recovered:false,finalizationsApplied:(outcome.applied||0)+(outcome.localPending===0?outcome.pending||0:0)};
      }
      else fact(notified.status===404,'FAILURE_FINALIZATION_BUSY');
      // An obsolete daemon cannot own a half-applied new in-memory record.
      // Only after the new endpoint is ruled out may offline copies be ACKed.
      await settlePreviouslyApplied();
      if(!subjects.length)return {recovered:false,finalizationsApplied:previouslyApplied};
      fact(same(await inventory(root),[record]),'FAILURE_FINALIZATION_CLIENT_IDENTITY');
      const paused=await localRequest('/local/connection-control',{operation:'pause',nonce:life.nonce});
      fact(paused.ok,'FAILURE_FINALIZATION_BUSY');await paused.arrayBuffer();
      let stopped=false;
      try{
        // Only source state can justify the legacy active-count allowance.
        // A healthy in-flight task without its own finalization blocks this
        // maintenance pass; it is never killed as an unrelated employee.
        const check=body=>{
          let authorizedPending=0,authorizedBlocked=0;
          for(const item of subjects){
            const local=inspectFailureFinalizationLocal({runtimeDir:item.connection.runtimeDir,identity:item.identity,receipt:item.row.receipt,receiptDigest:item.row.receiptDigest});
            const state=local.delivery?.value.state;
            if(state==='blocked')authorizedBlocked++;
            else if(state&&!['confirmed','maintenance_paused'].includes(state))authorizedPending++;
          }
          fact(body&&body.pid===record.pid&&body.clientBuild===build&&same(body.lifecycle,life)&&body.connectionState==='draining'
            &&body.maintenance?.gatewaySafe===true&&Array.isArray(body.maintenance.gatewayWorkers)&&body.maintenance.gatewayWorkers.length===0
            &&body.maintenance.pendingDeliveryCount===authorizedPending&&body.maintenance.blockedDeliveryCount===authorizedBlocked
            &&Number.isSafeInteger(body.activeActionCount)&&body.activeActionCount>=0
            &&Number.isSafeInteger(body.quarantinedActionCount)&&body.quarantinedActionCount>=0
            &&body.activeActionCount<=subjects.length&&body.quarantinedActionCount<=subjects.length,'FAILURE_FINALIZATION_BUSY');
          for(const connection of connections){
            const file=path.join(connection.runtimeDir,'action-state.json');if(!fs.existsSync(file))continue;
            const state=JSON.parse(bytes(file));fact(state.version===2&&Array.isArray(state.started)&&Array.isArray(state.completed));
            const authorized=subjects.filter(item=>item.connection.workspace===connection.workspace).map(item=>item.row.receipt.subject.actionId);
            for(const start of state.started){const complete=state.completed.find(item=>item.key===start.key);
              if(!complete||start.quarantine?.stopConfirmed===false)fact(authorized.includes(start.actionId),'FAILURE_FINALIZATION_BUSY');}
          }
        };
        let current=await health();check(current);const deadline=Date.now()+15000;
        while(current.pollingCount){fact(Date.now()<deadline,'FAILURE_FINALIZATION_BUSY');await new Promise(resolve=>setTimeout(resolve,100));current=await health();check(current);}
        const evidence=inspectEvidence({connections:connections.map(c=>({apiBase:c.apiBase,workspace:c.workspace,deviceId:c.deviceId,runtimeDir:c.runtimeDir}))});
        const allowed=new Set(subjects.map(item=>item.row.receipt.subject.actionId));
        fact(evidence.stopIssues.every(issue=>allowed.has(issue.actionId)&&['STARTED_WITHOUT_RESULT','ACTION_RESULT_UNCERTAIN','DELIVERY_NOT_DRAINED','UNMAPPED_NATIVE_EXECUTION'].includes(issue.code)),'FAILURE_FINALIZATION_LOCAL_MISMATCH');
        const parent=path.join(resolveDaemonDataDirectory({root,env}),'maintenance');noLinks(parent);fs.mkdirSync(parent,{recursive:true,mode:0o700});
        const directory=path.join(parent,'failed-action-stop-'+randomUUID());fs.mkdirSync(directory,{mode:0o700});const snapshots=[];
        for(const [index,item]of evidence.files.entries())if(item.exists){const original=bytes(item.path);fact(hash(original)===item.sha256);const file=path.join(directory,String(index).padStart(5,'0')+'.original');save(file,original);snapshots.push({path:file,sha256:item.sha256});}
        const approvalFile=path.join(directory,'finalizations.json');save(approvalFile,subjects.map(item=>item.row));snapshots.push({path:approvalFile,sha256:hash(bytes(approvalFile))});
        const exitFile=path.join(directory,'daemon-exit.json'),url=new URL(origin);
        const data={pid:record.pid,creationTime:record.creationTime,commandHash:record.commandHash,executable:record.executable,
          origin,host:url.hostname.replace(/^\[|\]$/g,''),port,root,configPath,configSha256,build,workspace:config.workspace,deviceId:config.deviceId,
          nonce:life.nonce,runtimeDir,startedAt:life.startedAt,connections:connections.map(c=>({workspace:c.workspace,deviceId:c.deviceId,primary:c.primary})),
          files:evidence.files,directories:evidence.directories,snapshotFiles:snapshots,retainedPendingCount:current.maintenance.pendingDeliveryCount,
          expectedBlockedDeliveryCount:current.maintenance.blockedDeliveryCount,exitFile,waitMs:8000,
          authorizedFinalizations:subjects.map(item=>({actionId:item.row.receipt.subject.actionId,receiptDigest:item.row.receiptDigest})),
          expectedActiveActionCount:current.activeActionCount,expectedQuarantineCount:current.quarantinedActionCount};
        fact(hash(bytes(configPath))===configSha256&&same(await inspectProcess(record.pid,root),record)&&same(await inventory(root),[record]));
        await inspectListener(origin,record.pid);check(await health());checkpoint('before_legacy_stop',data);
        const output=await terminate(data);
        fact(output?.stopped===true&&output.pid===record.pid&&output.creationTime===record.creationTime&&same(JSON.parse(bytes(exitFile)),output),'FAILURE_FINALIZATION_STOP_UNCONFIRMED');
        const cleanup=validatedMaintenanceCleanup(output.maintenanceCleanup,record,life.nonce,output.exitedAt);stopped=true;
        stopReceipt={recovered:true,stopped:true,wasRunning:true,pid:record.pid,creationTime:record.creationTime,
          localHistoryRetained:true,maintenanceCleanup:cleanup,originalExecutionExitConfirmed:false,executionConfirmedStopped:false};
        fact((await inventory(root)).length===0&&await listenerCount(origin)===0&&!(await health()),'FAILURE_FINALIZATION_STOP_UNCONFIRMED');
        for(const item of evidence.files)if(item.exists)fact(hash(bytes(item.path))===item.sha256);
        checkpoint('legacy_stopped',stopReceipt);
      }catch(error){if(stopped)error.stoppedClientReceipt=stopReceipt;
        else{try{if(same(await inspectProcess(record.pid,root),record))await localRequest('/local/connection-control',{operation:'resume',nonce:life.nonce});}catch{}}
        throw error;}
    }else fact((await inventory(root)).length===0&&await listenerCount(origin)===0,'FAILURE_FINALIZATION_CLIENT_IDENTITY');
    let applied=previouslyApplied;
    try{
      for(const item of subjects){
        const local=archiveFailureFinalization({runtimeDir:item.connection.runtimeDir,identity:item.identity,
          receipt:item.row.receipt,receiptDigest:item.row.receiptDigest,localProcessDisposition:'unobservable'});applied++;
        try{await request(item.connection,'/a2a/v1/actions/'+encodeURIComponent(local.actionId)+'/failure-finalization/ack',
          {receiptId:local.receiptId,receiptDigest:local.receiptDigest,archiveSha256:local.archiveSha256,localProcessDisposition:local.localProcessDisposition});}
        catch{log('failure_finalization_ack_pending',{actionId:local.actionId});}
      }
    }catch(error){if(stopReceipt)error.stoppedClientReceipt=stopReceipt;throw error;}
    log('failure_finalization_recovered',{count:applied});return stopReceipt?{...stopReceipt,finalizationsApplied:applied}:{recovered:false,finalizationsApplied:applied};
  };
}
export const recoverFailedActionFinalizationsForUpdate=createFailedActionFinalizationRecovery();
