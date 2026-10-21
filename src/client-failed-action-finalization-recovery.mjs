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
// Auxiliary workers are a live count, not part of the boot generation. They
// must drain to zero; the remaining lifecycle fields stay pinned exactly.
const bootIdentity=life=>{if(!life)return null;const {managedAuxiliaryCount,...identity}=life;return identity;};
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
const safeSteps={read_configuration:'local_archive',read_authorizations:'remote_list',acknowledge_archive:'remote_ack',read_current_health:'local_health',settle_live_client:'local_notify',pause_old_client:'local_pause',resume_old_client:'local_resume',inspect_client_process:'process_identity',recheck_client_process:'process_identity',inspect_health_listener:'listener_identity',recheck_health_listener:'listener_identity',inspect_installed_processes:'process_inventory',recheck_installed_processes:'process_inventory',check_remaining_installed_processes:'process_inventory',check_remaining_health_listeners:'listener_identity',inspect_absent_client_processes:'process_inventory',inspect_absent_health_listeners:'listener_identity',stop_exact_client_instance:'process_terminate'};
const retryableRead=error=>error?.name==='TimeoutError'||error?.name==='AbortError'||['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EAI_AGAIN','ENOTFOUND','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET'].includes(error?.code)||['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EAI_AGAIN','ENOTFOUND','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET'].includes(error?.cause?.code)||[408,429,502,503,504].includes(error?.httpStatus);
const nativeInventory=createForceAbandonInventory(),nativeListeners=createForceAbandonListenerCount(),nativeTerminate=createLocalHistoryHandleTerminator({program:FAILURE_FINALIZATION_STOP_HANDLE_PROGRAM});

/** The verified candidate runs this hook before the old client's stop gate.
 * A legacy client may not understand disposition records. Pause admission,
 * prove that every remaining active record is an authorized failed action,
 * then stop only the held installation/boot and its captured descendants.
 * The original action's exit is deliberately still unknown. */
export function createFailedActionFinalizationRecovery({platform=process.platform,
  inspectProcess=inspectNativeClientProcess,inspectListener=inspectNativeHealthListener,
  inventory=nativeInventory,listenerCount=nativeListeners,terminate=nativeTerminate,
  installedBuild=clientBuildIdentity,inspectEvidence=inspectLocalDaemonMaintenanceFiles,checkpoint=()=>{},sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  return async function recover({root,env=process.env,fetchImpl=globalThis.fetch,log=()=>{}}={}) {
    if(platform!=='win32')return {recovered:false};
    let progress={phase:'configuration',step:'local_archive',attempt:1,startedAt:Date.now()};
    const note=(event,data)=>{try{log(event,data);}catch{}};
    const mark=(phase,name,attempt=1)=>{const step=safeSteps[name]||'local_archive';progress={phase,step,attempt,startedAt:Date.now()};note('failure_finalization_phase',{phase,step,attempt});};
    const annotate=error=>{
      const result=error instanceof Error?error:failure('FAILURE_FINALIZATION_LOCAL_MISMATCH');
      if(!result.recoveryPhase)result.recoveryPhase=progress.phase;
      if(!result.recoveryStep)result.recoveryStep=progress.step;
      if(!result.recoveryAttempt)result.recoveryAttempt=progress.attempt;
      if(!Number.isSafeInteger(result.recoveryElapsedMs))result.recoveryElapsedMs=Math.min(180000,Math.max(0,Date.now()-progress.startedAt));
      return result;
    };
    const step=async(phase,name,operation,attempt=1)=>{
      mark(phase,name,attempt);const {startedAt,step:stepName}=progress;
      try{const result=await operation();note('failure_finalization_step_complete',{phase,step:stepName,attempt,elapsedMs:Math.max(0,Date.now()-startedAt)});return result;}
      catch(error){const result=annotate(error);note('failure_finalization_step_failed',{phase,step:stepName,attempt,elapsedMs:Math.max(0,Date.now()-startedAt),code:error?.name==='TimeoutError'?'OPERATION_TIMEOUT':/^FAILURE_FINALIZATION_[A-Z_]+$/.test(error?.code||'')?error.code:'FAILURE_FINALIZATION_STEP_FAILED'});throw result;}
    };
    mark('configuration','read_configuration');
    try{
    const configPath=resolveConfigPath({root,env});let configBytes;
    try{configBytes=bytes(configPath);}catch(error){if(error.code==='ENOENT')return {recovered:false};throw error;}
    const config=JSON.parse(configBytes),configSha256=hash(configBytes);
    const runtimeDir=env.ZIWEI_USER_HOME?path.join(defaultUserDir({env}),'runtime'):path.join(root,'.local','runtime');
    const resolved=resolveWorkspaceConnections(config,{configPath,root});fact(resolved.errors.length===0);
    const connections=resolved.connections.filter(c=>c.deviceToken).map(c=>({...c,
      runtimeDir:c.primary?runtimeDir:path.join(runtimeDir,'shared-workspaces',c.workspace,c.deviceId)}));
    const request=async(connection,pathname,body)=>{for(let attempt=1;attempt<=(body?1:3);attempt++){try{return await step(body?'receipt_commit':'grant_probe',body?'acknowledge_archive':'read_authorizations',async()=>{
      const api=new URL(connection.apiBase);fact(api.protocol==='https:'&&!api.username&&!api.password&&!api.search&&!api.hash&&api.pathname==='/','FAILURE_FINALIZATION_SCOPE_MISMATCH');
      const response=await fetchImpl(api.origin+pathname,{method:body?'POST':'GET',redirect:'error',
        headers:{'x-ziwei-device-token':connection.deviceToken,...(body?{'content-type':'application/json'}:{})},
        ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(body?8000:attempt*8000)});
      if(response.status===404&&!body){await response.arrayBuffer();return null;}
      if(!response.ok){await response.body?.cancel?.();throw Object.assign(failure('FAILURE_FINALIZATION_TRANSPORT'),{httpStatus:response.status});}
      return await response.json();
    },attempt);}catch(error){if(body||attempt===3||!retryableRead(error))throw error;note('failure_finalization_read_retry',{phase:'grant_probe',step:'remote_list',attempt,elapsedMs:error.recoveryElapsedMs});await sleep(attempt*100);}}};
    const subjects=[];
    for(const connection of connections){
      const response=await request(connection,'/a2a/v1/failure-finalizations?'+new URLSearchParams({workspace:connection.workspace,deviceId:connection.deviceId}));
      if(!response)continue;fact(Array.isArray(response.finalizations)&&response.finalizations.length<=100,'FAILURE_FINALIZATION_RESPONSE_INVALID');
      mark('local_archive_validation','inspect_authorized_records');
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
      catch{note('failure_finalization_ack_pending',{actionId:local.actionId});}
      subjects.splice(index,1);previouslyApplied++;
    }};
    const host=String(config.healthHost||env.ZIWEI_HEALTH_HOST||'127.0.0.1').replace(/^localhost$/,'127.0.0.1');
    const port=Number(config.healthPort||env.ZIWEI_HEALTH_PORT||20242);
    fact(['127.0.0.1','::1','[::1]'].includes(host)&&Number.isSafeInteger(port)&&port>0&&port<65536);
    const origin=`http://${host.includes(':')?'[::1]':host}:${port}`;
    const health=async()=>step('current_health','read_current_health',async()=>{try{const response=await fetchImpl(origin+'/healthz',{redirect:'error',signal:AbortSignal.timeout(5000)});fact(response.ok,'FAILURE_FINALIZATION_CLIENT_IDENTITY');return await response.json();}
      catch(error){if(error.code==='ECONNREFUSED'||error.cause?.code==='ECONNREFUSED')return null;throw error;}});
    let pinned=await health(),stopReceipt;
    if(pinned){
      const record=await step('source_validation','inspect_client_process',()=>inspectProcess(pinned.pid,root)),build=installedBuild(root),life=pinned.lifecycle;
      fact(record&&Number.isSafeInteger(record.pid)&&record.pid>0&&record.pid!==process.pid&&life
        &&pinned.service==='ziwei_user'&&pinned.agentId==='ziwei_user'&&pinned.clientBuild===build
        &&pinned.workspace===config.workspace&&pinned.deviceId===config.deviceId
        &&samePath(life.root,root)&&samePath(life.configPath,configPath)&&samePath(life.runtimeDir,runtimeDir)
        &&life.configSha256===configSha256&&Math.abs(Date.parse(life.startedAt)-Date.parse(record.creationTime))<=15000
        &&typeof life.nonce==='string'&&/^[A-Za-z0-9_-]{16,128}$/.test(life.nonce),'FAILURE_FINALIZATION_CLIENT_IDENTITY');
      await step('holder_validation','inspect_health_listener',()=>inspectListener(origin,record.pid));
      const localRequest=async(pathname,body)=>step(pathname==='/local/failure-finalizations'?'prepare':'pause_drain',pathname==='/local/failure-finalizations'?'settle_live_client':body.operation==='pause'?'pause_old_client':'resume_old_client',async()=>{
        const response=await fetchImpl(origin+pathname,{method:'POST',headers:{'content-type':'application/json','x-ziwei-local-control':config.deviceToken},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(35000)});
        const value=response.status===404?(await response.arrayBuffer(),null):await response.json();
        return {ok:response.ok,status:response.status,value};
      });
      // New clients can settle in memory and then use their normal stop path.
      const notified=await localRequest('/local/failure-finalizations',{nonce:life.nonce});
      if(notified.ok){
        const outcome=notified.value;fact(outcome?.ok===true);
        // The new daemon owns its memory. Never fall back to a legacy kill
        // merely because its archive ACK was lost or an exact stop is busy.
        if(!(outcome.pending===0||outcome.localPending===0))throw Object.assign(failure('FAILURE_FINALIZATION_BUSY'),{recoveryRule:'FF_LIVE_CLIENT_PENDING'});
        return {recovered:false,finalizationsApplied:(outcome.applied||0)+(outcome.localPending===0?outcome.pending||0:0)};
      }
      else if(notified.status!==404)throw Object.assign(failure('FAILURE_FINALIZATION_BUSY'),{recoveryRule:'FF_LIVE_CLIENT_REFUSED'});
      // An obsolete daemon cannot own a half-applied new in-memory record.
      // Only after the new endpoint is ruled out may offline copies be ACKed.
      await settlePreviouslyApplied();
      if(!subjects.length)return {recovered:false,finalizationsApplied:previouslyApplied};
      fact(same(await step('holder_validation','inspect_installed_processes',()=>inventory(root)),[record]),'FAILURE_FINALIZATION_CLIENT_IDENTITY');
      let stopped=false;
      try{
        // A timed-out response may follow an accepted pause. Always resume
        // the same verified instance if this pass has not actually stopped it.
        const paused=await localRequest('/local/connection-control',{operation:'pause',nonce:life.nonce});
        if(!paused.ok)throw Object.assign(failure('FAILURE_FINALIZATION_BUSY'),{recoveryRule:'FF_PAUSE_REFUSED'});
        // Only source state can justify the legacy active-count allowance.
        // A healthy in-flight task without its own finalization blocks this
        // maintenance pass; it is never killed as an unrelated employee.
        const check=body=>{
          const counters={active:body?.activeActionCount,quarantined:body?.quarantinedActionCount,polling:body?.pollingCount,
            auxiliary:body?.lifecycle?.managedAuxiliaryCount,pending:body?.maintenance?.pendingDeliveryCount,blocked:body?.maintenance?.blockedDeliveryCount,authorized:subjects.length};
          const requireCheck=(value,rule)=>{if(!value)throw Object.assign(failure('FAILURE_FINALIZATION_BUSY'),{recoveryRule:rule,recoveryCounters:counters});};
          requireCheck(body&&body.pid===record.pid&&body.clientBuild===build,'FF_CLIENT_CHANGED');
          requireCheck(same(bootIdentity(body.lifecycle),bootIdentity(life)),'FF_BOOT_CHANGED');
          requireCheck(body.connectionState==='draining','FF_NOT_DRAINING');
          requireCheck(body.lifecycle.managedAuxiliaryCount===0&&body.maintenance?.gatewaySafe===true&&Array.isArray(body.maintenance.gatewayWorkers)&&body.maintenance.gatewayWorkers.length===0,'FF_AUXILIARIES');
          let authorizedPending=0,authorizedBlocked=0;
          const subjectPaths=new Set();
          for(const item of subjects){
            const local=inspectFailureFinalizationLocal({runtimeDir:item.connection.runtimeDir,identity:item.identity,receipt:item.row.receipt,receiptDigest:item.row.receiptDigest});
            if(local.delivery?.file)subjectPaths.add(local.delivery.file);
            const state=local.delivery?.value.state;
            if(state==='blocked')authorizedBlocked++;
            else if(state&&!['confirmed','maintenance_paused'].includes(state))authorizedPending++;
          }
          // The old daemon counts all retained delivery journals in health.
          // Add only histories the existing evidence scanner independently
          // audited as retainable, never a blanket allowance for pending work.
          const evidence=inspectEvidence({connections:connections.map(c=>({apiBase:c.apiBase,workspace:c.workspace,deviceId:c.deviceId,runtimeDir:c.runtimeDir}))});
          const blockedPaths=new Set(evidence.stopIssues.filter(issue=>issue.code==='DELIVERY_NOT_DRAINED').map(issue=>issue.path));
          const retainedPaths=new Set(evidence.issues.filter(issue=>issue.code==='DELIVERY_NOT_DRAINED'&&!blockedPaths.has(issue.path)&&!subjectPaths.has(issue.path)).map(issue=>issue.path));
          for(const file of retainedPaths){
            const snapshot=evidence.files.find(item=>item.exists&&item.path===file),original=bytes(file);
            fact(snapshot&&hash(original)===snapshot.sha256);
            const state=JSON.parse(original.toString('utf8').replace(/^\uFEFF/,'')).state;
            if(state==='blocked')authorizedBlocked++;
            else if(state&&!['confirmed','maintenance_paused'].includes(state))authorizedPending++;
          }
          counters.expectedPending=authorizedPending;counters.expectedBlocked=authorizedBlocked;
          requireCheck(body.maintenance.pendingDeliveryCount===authorizedPending,'FF_PENDING_DELIVERIES');
          requireCheck(body.maintenance.blockedDeliveryCount===authorizedBlocked,'FF_BLOCKED_DELIVERIES');
          requireCheck(Number.isSafeInteger(body.activeActionCount)&&body.activeActionCount>=0&&body.activeActionCount<=subjects.length,'FF_ACTIVE_ACTIONS');
          requireCheck(Number.isSafeInteger(body.quarantinedActionCount)&&body.quarantinedActionCount>=0&&body.quarantinedActionCount<=subjects.length&&body.executionQuarantined===(body.quarantinedActionCount>0),'FF_QUARANTINED_ACTIONS');
          requireCheck(Number.isSafeInteger(body.pollingCount)&&body.pollingCount>=0,'FF_POLLING');
          for(const connection of connections){
            const file=path.join(connection.runtimeDir,'action-state.json');if(!fs.existsSync(file))continue;
            const state=JSON.parse(bytes(file));fact(state.version===2&&Array.isArray(state.started)&&Array.isArray(state.completed));
            const authorized=subjects.filter(item=>item.connection.workspace===connection.workspace).map(item=>item.row.receipt.subject.actionId);
            for(const start of state.started){const complete=state.completed.find(item=>item.key===start.key);
              if(!complete||start.quarantine?.stopConfirmed===false)requireCheck(authorized.includes(start.actionId),'FF_UNAUTHORIZED_ACTION');}
          }
          const allowed=new Set(subjects.map(item=>item.row.receipt.subject.actionId));
          requireCheck(evidence.stopIssues.every(issue=>allowed.has(issue.actionId)&&['STARTED_WITHOUT_RESULT','ACTION_RESULT_UNCERTAIN','DELIVERY_NOT_DRAINED','UNMAPPED_NATIVE_EXECUTION'].includes(issue.code)),'FF_LOCAL_EVIDENCE');
          return evidence;
        };
        let current=await health(),evidence=check(current);const deadline=Date.now()+15000;
        while(current.pollingCount){if(Date.now()>=deadline)throw Object.assign(failure('FAILURE_FINALIZATION_BUSY'),{recoveryRule:'FF_POLLING_DRAIN_TIMEOUT'});await sleep(100);current=await health();evidence=check(current);}
        mark('local_archive_validation','inspect_maintenance_evidence');
        mark('archive_backup','save_original_records');
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
        fact(hash(bytes(configPath))===configSha256&&same(await step('holder_revalidation','recheck_client_process',()=>inspectProcess(record.pid,root)),record)&&same(await step('holder_revalidation','recheck_installed_processes',()=>inventory(root)),[record]));
        await step('holder_revalidation','recheck_health_listener',()=>inspectListener(origin,record.pid));check(await health());checkpoint('before_legacy_stop',data);
        const output=await step('terminate','stop_exact_client_instance',()=>terminate(data));
        mark('exit_validation','verify_exact_instance_receipt');
        fact(output?.stopped===true&&output.pid===record.pid&&output.creationTime===record.creationTime&&same(JSON.parse(bytes(exitFile)),output),'FAILURE_FINALIZATION_STOP_UNCONFIRMED');
        const cleanup=validatedMaintenanceCleanup(output.maintenanceCleanup,record,life.nonce,output.exitedAt);stopped=true;
        stopReceipt={recovered:true,stopped:true,wasRunning:true,pid:record.pid,creationTime:record.creationTime,
          localHistoryRetained:true,maintenanceCleanup:cleanup,originalExecutionExitConfirmed:false,executionConfirmedStopped:false};
        fact((await step('post_exit_validation','check_remaining_installed_processes',()=>inventory(root))).length===0&&await step('post_exit_validation','check_remaining_health_listeners',()=>listenerCount(origin))===0&&!(await health()),'FAILURE_FINALIZATION_STOP_UNCONFIRMED');
        for(const item of evidence.files)if(item.exists)fact(hash(bytes(item.path))===item.sha256);
        checkpoint('legacy_stopped',stopReceipt);
      }catch(error){annotate(error);if(stopped)error.stoppedClientReceipt=stopReceipt;
        else{try{if(same(await inspectProcess(record.pid,root),record))await localRequest('/local/connection-control',{operation:'resume',nonce:life.nonce});}catch{}}
        throw error;}
    }else fact((await step('offline_observation','inspect_absent_client_processes',()=>inventory(root))).length===0&&await step('offline_observation','inspect_absent_health_listeners',()=>listenerCount(origin))===0,'FAILURE_FINALIZATION_CLIENT_IDENTITY');
    let applied=previouslyApplied;
    try{
      for(const item of subjects){
        mark('local_apply','archive_failed_action');
        const local=archiveFailureFinalization({runtimeDir:item.connection.runtimeDir,identity:item.identity,
          receipt:item.row.receipt,receiptDigest:item.row.receiptDigest,localProcessDisposition:'unobservable'});applied++;
        try{await request(item.connection,'/a2a/v1/actions/'+encodeURIComponent(local.actionId)+'/failure-finalization/ack',
          {receiptId:local.receiptId,receiptDigest:local.receiptDigest,archiveSha256:local.archiveSha256,localProcessDisposition:local.localProcessDisposition});}
        catch{note('failure_finalization_ack_pending',{actionId:local.actionId});}
      }
    }catch(error){if(stopReceipt)error.stoppedClientReceipt=stopReceipt;throw error;}
    note('failure_finalization_recovered',{count:applied});return stopReceipt?{...stopReceipt,finalizationsApplied:applied}:{recovered:false,finalizationsApplied:applied};
    }catch(error){throw annotate(error);}
  };
}
export const recoverFailedActionFinalizationsForUpdate=createFailedActionFinalizationRecovery();
