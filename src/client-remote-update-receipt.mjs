import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {resolveWorkspaceConnections} from '../daemon/config.mjs';
import {clientBuildIdentity} from './management-bootstrap.mjs';
import {validateRemoteUpdateRequest} from './client-remote-update.mjs';
import {inspectMaintenanceProcess, maintenanceOwnerStatus} from '../scripts/client-update.mjs';
import {inspectNativeHealthListener, windowsCommandArguments} from '../scripts/client-lifecycle.mjs';

const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const hash=value=>createHash('sha256').update(value).digest('hex');
const pid=value=>Number.isSafeInteger(value)&&value>0;
const samePath=(a,b)=>typeof a==='string'&&typeof b==='string'&&path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
const fail=suffix=>Object.assign(new Error('CLIENT_UPDATE_RECEIPT_'+suffix),{code:'CLIENT_UPDATE_RECEIPT_'+suffix});
function noLinks(file) {
  for(let current=path.resolve(file);;current=path.dirname(current)){
    let stat;try{stat=fs.lstatSync(current);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(stat?.isSymbolicLink())throw fail('UNSAFE_PATH');
    if(current===path.dirname(current))break;
  }
}
function bytes(file,limit=65536) {
  noLinks(file);const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.nlink!==1||stat.size>limit)throw fail('UNSAFE_PATH');
  return fs.readFileSync(file);
}
const json=file=>JSON.parse(bytes(file).toString('utf8').replace(/^\uFEFF/,''));
const absent=file=>{noLinks(file);try{fs.lstatSync(file);return false;}catch(error){if(error.code==='ENOENT')return true;throw error;}};
const sameRequest=(a,b)=>['id','workspace','deviceId','hostId','targetBuild','sha256','source'].every(key=>a?.[key]===b?.[key]);
const outside=(file,root)=>{const rel=path.relative(path.resolve(root),path.resolve(file));return rel&&rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel)?false:Boolean(rel);};
function diagnostics(terminal) {
  return {...(/^[A-Z][A-Z0-9_]{0,63}$/.test(terminal.reasonCode||'')?{reasonCode:terminal.reasonCode}:{}),
    ...(/^[a-z][a-z0-9_]{0,63}$/.test(terminal.failureStage||'')?{failureStage:terminal.failureStage}:{}),
    ...(Number.isInteger(terminal.exitCode)&&terminal.exitCode>=-2147483648&&terminal.exitCode<=2147483647?{exitCode:terminal.exitCode}:{})};
}
function healthOrigin(config,env) {
  const raw=String(config.healthHost||env.ZIWEI_HEALTH_HOST||'127.0.0.1'),host=raw==='localhost'?'127.0.0.1':raw;
  const port=Number(config.healthPort||env.ZIWEI_HEALTH_PORT||20242);
  if(!['127.0.0.1','::1','[::1]'].includes(host)||!Number.isSafeInteger(port)||port<1||port>65535)throw fail('NATIVE_STARTUP_UNVERIFIED');
  return `http://${host.includes(':')?'[::1]':host}:${port}`;
}
async function verifyStartup({root,configPath,configSha256,config,installedBuild,daemonPid,env,inspectProcess,inspectListener,fetchImpl}) {
  const probe=await inspectProcess(daemonPid),record=probe?.record;
  if(probe?.state!=='present'||record?.pid!==daemonPid||!samePath(record.executable,process.execPath)||!Number.isFinite(Date.parse(record.creationTime)))throw fail('NATIVE_STARTUP_UNVERIFIED');
  const args=windowsCommandArguments(record.command||'');
  if(args.length!==2||!samePath(args[0],process.execPath)||!samePath(args[1],path.join(root,'daemon','ziwei_user.mjs')))throw fail('NATIVE_STARTUP_UNVERIFIED');
  const creationTime=record.creationTime,commandHash=hash(record.command);
  const origin=healthOrigin(config,env),response=await fetchImpl(origin+'/healthz',{redirect:'error',signal:AbortSignal.timeout(1500)});
  if(!response.ok)throw fail('NATIVE_STARTUP_UNVERIFIED');
  const body=await response.json(),life=body?.lifecycle;
  if(body?.service!=='ziwei_user'||body.agentId!=='ziwei_user'||body.pid!==daemonPid||body.clientBuild!==installedBuild||!life||!samePath(life.root,root)||!samePath(life.configPath,configPath)||life.configSha256!==configSha256||!/^[A-Za-z0-9_-]{16,128}$/.test(life.nonce||'')||life.managedAuxiliaryCount!==0||!Number.isFinite(Date.parse(life.startedAt))||Math.abs(Date.parse(life.startedAt)-Date.parse(record.creationTime))>15000)throw fail('NATIVE_STARTUP_UNVERIFIED');
  const listener=await inspectListener(origin,daemonPid);
  if(listener?.listenerPid!==daemonPid)throw fail('NATIVE_STARTUP_UNVERIFIED');
  const after=await inspectProcess(daemonPid);
  if(after?.state!=='present'||after.record?.pid!==daemonPid||after.record.creationTime!==creationTime||!samePath(after.record.executable,process.execPath)||typeof after.record.command!=='string'||hash(after.record.command)!==commandHash)throw fail('NATIVE_STARTUP_UNVERIFIED');
}

/** Read-only terminal evidence. A later installation cannot manufacture an old
 * rollback's PID/configuration/startup proof; it may only supplement observed failure. */
export async function inspectNativeUpdateReceipt({worker,status,home,root,configPath,request,claimToken,sourceBuild,pid:daemonPid,expectedState,env=process.env,inspectProcess=inspectMaintenanceProcess,inspectListener=inspectNativeHealthListener,fetchImpl=fetch}={}) {
  try {
    if(!digest(sourceBuild)||!root||!home||!configPath||!pid(daemonPid)||!pid(worker?.workerPid)||!pid(status?.workerPid)||typeof claimToken!=='string'||claimToken.length<16||claimToken.length>512)throw fail('BINDING_INVALID');
    noLinks(root);noLinks(home);noLinks(configPath);
    validateRemoteUpdateRequest(request,request);
    const maintenance=path.join(path.resolve(home),'maintenance'),remote=path.resolve(worker.directory||''),directory=path.dirname(path.resolve(status.resultFile||''));
    if(!samePath(path.dirname(remote),maintenance)||!/^remote-update-[a-f0-9-]{36}$/.test(path.basename(remote))||!samePath(path.dirname(directory),maintenance)||!/^update-[a-f0-9-]{36}$/.test(path.basename(directory))||path.basename(status.resultFile)!=='result.json'||!outside(home,root)||!outside(configPath,root))throw fail('BINDING_INVALID');
    const job=json(path.join(remote,'remote-job.json')),supervisor=json(path.join(remote,'supervisor-identity.json'));
    if(job.schemaVersion!==1||!samePath(job.directory,remote)||!samePath(job.root,root)||!samePath(job.home,home)||!samePath(job.configPath,configPath)||job.claimToken!==claimToken||!sameRequest(job.request,request)||(job.sourceBuild!==undefined&&job.sourceBuild!==sourceBuild)||supervisor.workerPid!==worker.workerPid||!samePath(supervisor.directory,remote)||supervisor.startedAt!==worker.startedAt||bytes(path.join(home,'maintenance-host-id')).toString('utf8')!==request.hostId)throw fail('BINDING_INVALID');
    const configBytes=bytes(configPath),config=JSON.parse(configBytes.toString('utf8')),configSha256=hash(configBytes);
    if(!resolveWorkspaceConnections(config,{configPath,root}).connections.some(row=>row.workspace===request.workspace&&row.deviceId===request.deviceId))throw fail('BINDING_INVALID');
    const officialJobFile=path.join(directory,'job.json'),official=json(officialJobFile),artifact=path.join(remote,'remote-pinned-update.tgz');
    if(!samePath(official.root,root)||!samePath(official.directory,directory)||official.parentPid!==worker.workerPid||official.expectedBuild!==request.targetBuild||official.sha256!==request.sha256||!samePath(official.artifactFile,artifact)||hash(bytes(artifact,256*1024*1024))!==request.sha256)throw fail('BINDING_INVALID');
    const terminalFile=path.join(directory,'terminal.json'),terminalBytes=bytes(terminalFile),terminal=JSON.parse(terminalBytes.toString('utf8').replace(/^\uFEFF/,''));
    const workerFile=path.join(directory,'worker.json'),identityBytes=bytes(workerFile),identity=JSON.parse(identityBytes.toString('utf8').replace(/^\uFEFF/,''));
    if(terminal.operation!=='update'||!['complete','failed'].includes(terminal.state)||(expectedState!==undefined&&terminal.state!==expectedState)||!Number.isFinite(Date.parse(terminal.finishedAt)))throw fail('TERMINAL_INVALID');
    if(identity.version!==2||identity.operation!=='update'||identity.pid!==status.workerPid||!samePath(identity.jobFile,officialJobFile)||!samePath(identity.executable,process.execPath)||!digest(identity.commandHash)||!/^[a-f0-9-]{36}$/.test(identity.nonce||'')||!Number.isFinite(Date.parse(identity.creationTime))||Date.parse(identity.creationTime)>Date.parse(terminal.finishedAt))throw fail('WORKER_UNVERIFIED');
    const owner=await maintenanceOwnerStatus(identity,{inspectProcess});
    if(!['exited','pid_reused'].includes(owner.state))throw fail('WORKER_UNVERIFIED');
    if(!absent(path.join(maintenance,'operation.lock')))throw fail('LOCK_PRESENT');
    const common={schemaVersion:1,operation:'update',state:terminal.state,requestId:request.id,hostId:request.hostId,deviceId:request.deviceId,sourceBuild,targetBuild:request.targetBuild,sha256:request.sha256,supervisorPid:worker.workerPid,workerPid:status.workerPid,workerIdentitySha256:hash(identityBytes),terminalSha256:hash(terminalBytes),finishedAt:terminal.finishedAt,workerExited:true,maintenanceLockAbsent:true};
    const assertStableTerminal=()=>{if(hash(bytes(terminalFile))!==common.terminalSha256||hash(bytes(workerFile))!==common.workerIdentitySha256||!absent(path.join(maintenance,'operation.lock')))throw fail('CHANGED');};
    assertStableTerminal();
    if(terminal.state==='failed'&&(terminal.originalInstallationRestored!==true||terminal.runningStateRestored!==true))throw fail('RESTORATION_UNVERIFIED');
    const observedFailure=terminal.state==='failed'?{...common,originalInstallationRestored:true,runningStateRestored:true,...diagnostics(terminal)}:undefined;
    try {
      const legacy=terminal.state==='complete'&&request.completionProtocol==='legacy_heartbeat'&&job.sourceBuild===undefined&&job.configSha256===undefined;
      if(!legacy&&(job.sourceBuild!==sourceBuild||!digest(job.configSha256)||configSha256!==job.configSha256))throw fail('CONFIGURATION_UNVERIFIED');
      const installedBuild=clientBuildIdentity(root),expected=terminal.state==='complete'?request.targetBuild:sourceBuild;
      if(installedBuild!==expected)throw fail('INSTALLATION_UNVERIFIED');
      if(terminal.state==='complete'&&(terminal.oldBuild!==sourceBuild||terminal.clientBuild!==request.targetBuild||terminal.sha256!==request.sha256||terminal.restoredRunning!==true||terminal.configurationPreserved!==true))throw fail('TERMINAL_INVALID');
      await verifyStartup({root,configPath,configSha256,config,installedBuild,daemonPid,env,inspectProcess,inspectListener,fetchImpl});
      if(hash(bytes(configPath))!==configSha256||hash(bytes(terminalFile))!==common.terminalSha256||hash(bytes(workerFile))!==common.workerIdentitySha256||clientBuildIdentity(root)!==installedBuild||!absent(path.join(maintenance,'operation.lock')))throw fail('CHANGED');
      const {requestId,hostId,deviceId,sourceBuild:originalBuild,targetBuild,sha256,...metadata}=common;
      const verified={...metadata,binding:{requestId,hostId,deviceId,sourceBuild:originalBuild,targetBuild,sha256},daemonPid,installedBuild,configurationPreserved:true,nativeStartupVerified:true};
      if(legacy)return {legacyCompletion:{...verified,restoredRunning:true}};
      const strong={...verified,configSha256};
      return terminal.state==='complete'?{workerReceipt:{...strong,restoredRunning:true}}:{rollbackEvidence:{...strong,originalInstallationRestored:true,runningStateRestored:true}};
    } catch(error) {
      if(observedFailure){assertStableTerminal();return {observedFailure};}
      throw error;
    }
  } catch(error) {
    return {proofUnavailable:/^CLIENT_UPDATE_RECEIPT_[A-Z_]{1,64}$/.test(error?.code||'')?error.code:'CLIENT_UPDATE_RECEIPT_UNVERIFIED'};
  }
}
