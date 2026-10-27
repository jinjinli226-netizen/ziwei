import {randomUUID,randomBytes,timingSafeEqual,createHash} from 'node:crypto';

export const REMOTE_UPDATE_FEATURE='remote_client_update_v1';
export const NATIVE_WORKER_UPDATE_VERIFICATION_FEATURE='native_worker_update_verification_v1';
export const OFFICIAL_CLIENT_SOURCE='https://qzelynth.top/downloads/cli/ziwei-latest.tgz';
export const OFFICIAL_CLIENT_MANIFEST='https://qzelynth.top/downloads/cli/release.json';
const HASH=/^[a-f0-9]{64}$/;
const TERMINAL=new Set(['succeeded','failed','cancelled']);
export const DEVICE_UPDATE_UNCONFIRMED_TIMEOUT_MS=2*60*60*1000;
const STATES=['requested','accepted','waiting_idle','updating','awaiting_heartbeat','succeeded','failed','cancelled'];
const parse=value=>{try{return JSON.parse(value||'{}');}catch{return {};}};
const fail=(code,message,status=409)=>{throw Object.assign(new Error(message),{code,status});};
const sameSecret=(a,b)=>typeof a==='string'&&typeof b==='string'&&HASH.test(a)&&HASH.test(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const runtimeExecutionTypes=['conversation.execute','task.execute','agent.execute','runtime.execute','automation.execute'];
const fresh=(row,now)=>{const seen=Date.parse(row.heartbeat_at||row.last_seen||'');return row.status!=='disabled'&&Number.isFinite(seen)&&seen<=now+5_000&&now-seen<90_000;};
const host=row=>parse(row.runtime_discovery_json).maintenanceHostId;
const REASONS=Object.freeze({CLIENT_UPDATE_AUTHORITY_REVOKED:'原升级授权已失效，请由当前管理员重新发起',CLIENT_UPDATE_INTERRUPTED:'维护程序已中断，可重新发起官方升级',CLIENT_UPDATE_UNCONFIRMED_TIMEOUT:'维护回执超时，尚未确认升级结果；下次请求仍检查本机维护进程',CLIENT_UPDATE_RELEASE_CHANGED:'官方安装包已变化，请重新发起升级',CLIENT_UPDATE_WORKER_FAILED:'本机官方升级程序失败，原安装及连接配置按维护结果保留',CLIENT_UPDATE_SOURCE_INVALID:'官方更新地址校验失败',CLIENT_UPDATE_BUILD_MISMATCH:'安装版本与本次升级目标不一致',CLIENT_UPDATE_CANCELLED:'升级请求已取消',CLIENT_UPDATE_ROLLED_BACK:'原生维护失败并已核验恢复原安装及运行状态'});
const reasonFor=code=>code?(REASONS[code]||'客户端升级未完成，请查看官方维护结果'):null;
const evidence=row=>parse(row.evidence_json);
function view(row){
 if(!row)return null;
 const value=evidence(row),native=value.workerReceiptRequired===true,succeeded=row.state==='succeeded';
 return{id:row.id,deviceId:row.device_id,state:row.state,idempotencyKey:row.idempotency_key,
  currentBuild:row.source_build,targetBuild:row.target_build,sha256:row.sha256,source:OFFICIAL_CLIENT_SOURCE,
  version:row.version,createdAt:row.created_at,updatedAt:row.updated_at,code:row.reason_code||null,
  reason:reasonFor(row.reason_code),heartbeatVerified:succeeded,
  completionProtocol:native?'native_worker_v1':'legacy_heartbeat',
  completionSource:succeeded?(native?'heartbeat+native_worker':'heartbeat'):null,verifiedAt:row.verified_at||null,
  targetHeartbeatObserved:Boolean(value.heartbeat),workerVerified:Boolean(value.workerReceipt),
  rollbackVerified:Boolean(value.rollbackEvidence),observedFailureRecorded:Boolean(value.observedFailure),
  requiresReconciliation:succeeded&&Boolean(value.observedFailure)&&!value.rollbackEvidence,
  previousSuccessVerifiedAt:(value.rollbackEvidence||value.observedFailure)?row.verified_at||null:null,
  evidenceHistory:value.history||[]};
}

export function initializeDeviceUpdates(db){
 db.exec(`CREATE TABLE IF NOT EXISTS device_updates (
 id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,device_id TEXT NOT NULL,host_id TEXT NOT NULL,
 idempotency_key TEXT NOT NULL,actor_user_id TEXT NOT NULL,source_build TEXT NOT NULL,target_build TEXT NOT NULL,
 sha256 TEXT NOT NULL,version TEXT NOT NULL,state TEXT NOT NULL,reason_code TEXT,claim_token TEXT,
 source_pid INTEGER,worker_pid INTEGER,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,verified_at TEXT,
 UNIQUE(workspace_id,idempotency_key),FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE);
 CREATE UNIQUE INDEX IF NOT EXISTS idx_device_updates_one_host ON device_updates(host_id) WHERE state NOT IN ('succeeded','failed','cancelled');
 CREATE INDEX IF NOT EXISTS idx_device_updates_device ON device_updates(device_id,created_at);`);
 if(!db.prepare('PRAGMA table_info(device_updates)').all().some(column=>column.name==='evidence_json'))db.exec("ALTER TABLE device_updates ADD COLUMN evidence_json TEXT NOT NULL DEFAULT '{}'");
}

// A heartbeat and a native terminal receipt are independent requirements. A
// candidate can heartbeat before its installer completes or rolls it back.
function recordEvidenceFact(value,type,at,receipt){
 const digest=createHash('sha256').update(JSON.stringify(receipt)).digest('hex');
 value.history||=[];
 if(!value.history.some(row=>row.type===type&&row.sha256===digest))value.history.push({type,at,sha256:digest,receipt});
}
function completedTarget(row,device,at){
 const value=evidence(row),worker=value.workerReceipt,seen=Date.parse(device.heartbeat_at||'');
 const heartbeatMatches=host(device)===row.host_id&&device.client_build===row.target_build
  &&Number.isSafeInteger(device.pid)&&device.pid>0&&device.pid!==row.source_pid&&fresh(device,at)
  &&Number.isFinite(seen)&&seen>=Date.parse(row.created_at)&&value.heartbeat?.pid===device.pid;
 return Boolean(heartbeatMatches&&(value.workerReceiptRequired!==true||worker&&device.pid===worker.daemonPid));
}
function finishVerifiedUpdate(db,row,device,at){
 if(TERMINAL.has(row.state)||!completedTarget(row,device,at))return;
 db.prepare("UPDATE device_updates SET state='succeeded',updated_at=?,verified_at=? WHERE id=? AND state NOT IN ('succeeded','failed','cancelled')").run(new Date(at).toISOString(),device.heartbeat_at,row.id);
}
export function expireUnconfirmedDeviceUpdates(db,hostId,at=Date.now()){
 if(!HASH.test(hostId||''))return;
 // This expires only the server maintenance intent. It does not claim a
 // worker has exited; the client still enforces its independent worker lock.
 const cutoff=new Date(at-DEVICE_UPDATE_UNCONFIRMED_TIMEOUT_MS).toISOString();
 db.prepare("UPDATE device_updates SET state='failed',reason_code='CLIENT_UPDATE_UNCONFIRMED_TIMEOUT',updated_at=? WHERE host_id=? AND state IN ('updating','awaiting_heartbeat') AND updated_at<?").run(new Date(at).toISOString(),hostId,cutoff);
}

export function invalidateUnauthorizedPreUpdateIntents(db,hostId,at=Date.now()){
 if(!HASH.test(hostId||''))return;
 // Intent authority is bound to a device identity, not one token generation.
 // Re-pairing/rotation may replace its credential while preserving that device.
 const rows=db.prepare("SELECT u.*,d.status AS device_status,d.owner_user_id,w.kind AS workspace_kind,m.role AS actor_role FROM device_updates u JOIN devices d ON d.id=u.device_id AND d.workspace_id=u.workspace_id JOIN workspaces w ON w.id=u.workspace_id LEFT JOIN members m ON m.workspace_id=u.workspace_id AND m.user_id=u.actor_user_id WHERE u.host_id=? AND u.state IN ('requested','accepted','waiting_idle')").all(hostId);
 const activeCredential=db.prepare('SELECT 1 FROM device_credentials WHERE device_id=? AND workspace_id=? AND revoked_at IS NULL');
 const invalidate=db.prepare("UPDATE device_updates SET state='failed',reason_code='CLIENT_UPDATE_AUTHORITY_REVOKED',updated_at=? WHERE id=? AND state IN ('requested','accepted','waiting_idle')");
 for(const row of rows)if(row.device_status==='disabled'||!activeCredential.get(row.device_id,row.workspace_id)||!['owner','admin'].includes(row.actor_role)||row.workspace_kind==='personal'&&row.owner_user_id!==row.actor_user_id)invalidate.run(new Date(at).toISOString(),row.id);
}

export function observeDeviceUpdateHeartbeat(db,deviceId){
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='device_updates'").get())return;
 const device=db.prepare('SELECT * FROM devices WHERE id=?').get(deviceId);if(!device)return;
 const row=db.prepare("SELECT * FROM device_updates WHERE device_id=? AND state NOT IN ('succeeded','failed','cancelled')").get(deviceId);if(!row)return;
 const seen=Date.parse(device.heartbeat_at||'');
 if(host(device)!==row.host_id||device.client_build!==row.target_build||!Number.isInteger(device.pid)||device.pid<=0||device.pid===row.source_pid||!Number.isFinite(seen)||seen<Date.parse(row.created_at)||device.status==='disabled')return;
 const value=evidence(row);
 if(value.heartbeat?.pid!==device.pid)recordEvidenceFact(value,'target_heartbeat_observed',device.heartbeat_at,{pid:device.pid,clientBuild:device.client_build});
 value.heartbeat={pid:device.pid,at:device.heartbeat_at};
 db.prepare('UPDATE device_updates SET evidence_json=? WHERE id=?').run(JSON.stringify(value),row.id);
 finishVerifiedUpdate(db,{...row,evidence_json:JSON.stringify(value)},device,Date.now());
}

const RECEIPT_BINDING=['requestId','hostId','deviceId','sourceBuild','targetBuild','sha256'];
const RECEIPT_COMMON=['schemaVersion','operation','state','supervisorPid','workerPid','workerIdentitySha256','terminalSha256','finishedAt','workerExited','maintenanceLockAbsent'];
const RECEIPT_NATIVE=['daemonPid','installedBuild','configSha256','configurationPreserved','nativeStartupVerified'];
const RECEIPT_FAILURE=['originalInstallationRestored','runningStateRestored'];
const RECEIPT_OPTIONAL=['reasonCode','failureStage','exitCode'];
const positivePid=value=>Number.isSafeInteger(value)&&value>0;
const receiptHash=value=>typeof value==='string'&&HASH.test(value);
function validatedReceipt(input,kind,request,progress,at){
 const historical=kind==='observedFailure',complete=kind==='workerReceipt';
 const required=[...RECEIPT_COMMON,...(historical?RECEIPT_BINDING:['binding',...RECEIPT_NATIVE]),...(complete?['restoredRunning']:RECEIPT_FAILURE)];
 const allowed=[...required,...(complete?[]:RECEIPT_OPTIONAL)];
 const valid=input&&typeof input==='object'&&!Array.isArray(input)&&required.every(key=>Object.hasOwn(input,key))&&Object.keys(input).every(key=>allowed.includes(key));
 if(!valid)fail('CLIENT_UPDATE_RECEIPT_INVALID','原生维护回执缺少必要字段或含未知字段',400);
 const bindings={requestId:request.id,hostId:request.host_id,deviceId:request.device_id,sourceBuild:request.source_build,targetBuild:request.target_build,sha256:request.sha256};
 const supplied=historical?input:input.binding;
 if(!supplied||typeof supplied!=='object'||!historical&&(Object.keys(supplied).length!==RECEIPT_BINDING.length||Object.keys(supplied).some(key=>!RECEIPT_BINDING.includes(key))))fail('CLIENT_UPDATE_RECEIPT_INVALID','原生维护回执缺少完整请求绑定',400);
 const finished=Date.parse(input.finishedAt),created=Date.parse(request.created_at),priorSuccess=Date.parse(request.verified_at||'');
 const invalid=input.schemaVersion!==1||input.operation!=='update'||input.state!==(complete?'complete':'failed')
  ||Object.entries(bindings).some(([key,value])=>supplied[key]!==value)
  ||!positivePid(input.supervisorPid)||!positivePid(input.workerPid)||input.workerPid===input.supervisorPid
  ||input.supervisorPid!==(request.worker_pid||progress.workerPid)
  ||progress.workerPid!==undefined&&progress.workerPid!==input.supervisorPid
  ||!receiptHash(input.workerIdentitySha256)||!receiptHash(input.terminalSha256)
  ||typeof input.finishedAt!=='string'||!Number.isFinite(finished)||finished<created||finished>at+5000
  ||!complete&&Number.isFinite(priorSuccess)&&finished<priorSuccess
  ||input.workerExited!==true||input.maintenanceLockAbsent!==true
  ||!historical&&(!positivePid(input.daemonPid)||input.daemonPid===request.source_pid||input.daemonPid===input.workerPid
   ||input.installedBuild!==(complete?request.target_build:request.source_build)||!receiptHash(input.configSha256)
   ||input.configurationPreserved!==true||input.nativeStartupVerified!==true)
  ||(complete?input.restoredRunning!==true:input.originalInstallationRestored!==true||input.runningStateRestored!==true)
  ||input.reasonCode!==undefined&&!(typeof input.reasonCode==='string'&&/^[A-Z][A-Z0-9_]{0,80}$/.test(input.reasonCode))
  ||input.failureStage!==undefined&&!(typeof input.failureStage==='string'&&/^[a-z][a-z_]{0,63}$/.test(input.failureStage))
  ||input.exitCode!==undefined&&(!Number.isInteger(input.exitCode)||Math.abs(input.exitCode)>2147483647);
 if(invalid)fail('CLIENT_UPDATE_RECEIPT_INVALID','原生维护回执与请求、进程或终端结果不匹配',400);
 return Object.fromEntries(allowed.filter(key=>Object.hasOwn(input,key)).map(key=>[key,key==='binding'?bindings:input[key]]));
}
function applyNativeReceipt(db,request,device,input,at){
 const kinds=['workerReceipt','rollbackEvidence','observedFailure'].filter(key=>Object.hasOwn(input,key));
 if(kinds.length!==1)fail('CLIENT_UPDATE_RECEIPT_INVALID','一次状态回报只能包含一种原生证据',400);
 const kind=kinds[0],complete=kind==='workerReceipt',observed=kind==='observedFailure';
 if(input.state!==(complete?'awaiting_heartbeat':'failed'))fail('CLIENT_UPDATE_RECEIPT_INVALID','原生证据与状态回报不一致',400);
 const receipt=validatedReceipt(input[kind],kind,request,input,at),value=evidence(request),timestamp=new Date(at).toISOString();
 if(observed&&(!fresh(device,at)||input.clientBuild!==device.client_build))fail('CLIENT_UPDATE_HISTORY_UNCONFIRMED','历史补充回执需要当前实际构建的新鲜设备心跳');
 if(value[kind]){
  if(JSON.stringify(value[kind])!==JSON.stringify(receipt))fail('CLIENT_UPDATE_RECEIPT_CONFLICT','已保存的原生维护事实不能被另一回执覆盖');
  return{request:view(request),...(observed?{observedFailureRecorded:true,requiresReconciliation:view(request).requiresReconciliation}:{})};
 }
 const legacySucceeded=complete&&request.state==='succeeded'&&value.workerReceiptRequired!==true;
 if(complete&&TERMINAL.has(request.state)&&!legacySucceeded)fail('CLIENT_UPDATE_TERMINAL','终态维护记录不接受新的完成回执');
 if(complete&&!['updating','awaiting_heartbeat'].includes(request.state)&&!legacySucceeded)fail('CLIENT_UPDATE_PROGRESS_CONFLICT','维护程序尚未进入安装阶段');
 if(!complete&&!observed&&(!fresh(device,at)||host(device)!==request.host_id||device.client_build!==request.source_build||device.pid!==receipt.daemonPid||Date.parse(device.heartbeat_at||'')<Date.parse(request.created_at)))fail('CLIENT_UPDATE_ROLLBACK_UNCONFIRMED','尚未核验原安装的新鲜运行心跳');
 if(request.state==='cancelled')fail('CLIENT_UPDATE_TERMINAL','取消记录不接受原生结果改写');
 if(request.state==='succeeded')recordEvidenceFact(value,value.workerReceiptRequired===true?'native_success_verified':'legacy_success_observed',request.verified_at||request.updated_at,{state:'succeeded',verifiedAt:request.verified_at||null,targetBuild:request.target_build});
 value[kind]=receipt;
 recordEvidenceFact(value,complete?'native_worker_completed':observed?'native_failure_observed':'native_rollback_verified',timestamp,receipt);
 const state=legacySucceeded?'succeeded':complete?'awaiting_heartbeat':observed?request.state:'failed';
 db.exec('SAVEPOINT device_update_receipt');
 try{
  db.prepare('UPDATE device_updates SET state=?,reason_code=?,worker_pid=COALESCE(worker_pid,?),evidence_json=?,updated_at=? WHERE id=?').run(state,observed?request.reason_code:complete?null:'CLIENT_UPDATE_ROLLED_BACK',receipt.supervisorPid,JSON.stringify(value),timestamp,request.id);
  if(complete)finishVerifiedUpdate(db,{...request,state,evidence_json:JSON.stringify(value)},device,at);
  db.exec('RELEASE device_update_receipt');
 }catch(error){db.exec('ROLLBACK TO device_update_receipt; RELEASE device_update_receipt');throw error;}
 const recorded=view(db.prepare('SELECT * FROM device_updates WHERE id=?').get(request.id));
 return{request:recorded,...(observed?{observedFailureRecorded:true,requiresReconciliation:recorded.requiresReconciliation}:{})};
}

export function createDeviceUpdateService(repo,{now=()=>Date.now(),fetch:fetcher=globalThis.fetch,readRelease}={}){
 const db=repo.db;initializeDeviceUpdates(db);
 const stamp=()=>new Date(now()).toISOString();
 let cachedRelease=null,cachedAt=0;
 async function release(){
  if(cachedRelease&&now()-cachedAt<15_000)return cachedRelease;
  let raw;
  try{if(readRelease)raw=await readRelease();else{const res=await fetcher(OFFICIAL_CLIENT_MANIFEST,{redirect:'error',signal:AbortSignal.timeout(10_000)});if(!res.ok)fail('CLIENT_UPDATE_RELEASE_UNAVAILABLE','官方版本信息暂时不可用',503);const bytes=await res.text();if(Buffer.byteLength(bytes)>131072)fail('CLIENT_UPDATE_RELEASE_INVALID','官方版本信息无效',503);raw=JSON.parse(bytes);}}
  catch(error){if(error.code?.startsWith('CLIENT_UPDATE_RELEASE_'))throw error;fail('CLIENT_UPDATE_RELEASE_UNAVAILABLE','官方版本信息暂时不可用',503);}
  if(raw?.url!==OFFICIAL_CLIENT_SOURCE||!HASH.test(raw.clientBuild||'')||!HASH.test(raw.sha256||'')||typeof raw.version!=='string'||raw.version.length>40)fail('CLIENT_UPDATE_RELEASE_INVALID','官方版本信息无效',503);
  cachedRelease={targetBuild:raw.clientBuild,sha256:raw.sha256,version:raw.version,source:OFFICIAL_CLIENT_SOURCE};cachedAt=now();return cachedRelease;
 }
 function workspace(slug){const row=db.prepare('SELECT * FROM workspaces WHERE slug=?').get(slug);if(!row)fail('WORKSPACE_NOT_FOUND','工作区不存在',404);return row;}
 function actor(slug,context={},manage=false){
  const ws=workspace(slug),member=db.prepare('SELECT role FROM members WHERE workspace_id=? AND user_id=?').get(ws.id,context.actorUserId||'');
  if(!member||!['owner','admin','member'].includes(member.role))fail('CLIENT_UPDATE_FORBIDDEN','当前用户无权访问该工作区',403);
  if(manage&&!['owner','admin'].includes(member.role))fail('CLIENT_UPDATE_FORBIDDEN','仅工作区管理员可远程升级客户端',403);
  if(context.deviceScope||context.deviceCredentialDeviceId)fail('CLIENT_UPDATE_FORBIDDEN','设备管理凭据不能发起客户端升级',403);
  return{ws,role:member.role,userId:context.actorUserId};
 }
 function device(ws,id,userId){const row=db.prepare('SELECT * FROM devices WHERE workspace_id=? AND id=?').get(ws.id,id);if(!row||ws.kind==='personal'&&row.owner_user_id!==userId)fail('CLIENT_UPDATE_DEVICE_NOT_FOUND','当前工作区中未找到可管理的电脑',404);return row;}
 function latest(row){return db.prepare('SELECT * FROM device_updates WHERE device_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(row.id);}
 function readiness(row){
  if(!db.prepare('SELECT 1 FROM device_credentials WHERE device_id=? AND workspace_id=? AND revoked_at IS NULL').get(row.id,row.workspace_id))return['CLIENT_UPDATE_DEVICE_CREDENTIAL_REQUIRED','电脑尚未配对或连接授权已撤销，需先恢复设备连接'];
  if(row.status==='disabled')return['DEVICE_DISABLED','电脑已停用，需先启用并重新上线'];
  if(!fresh(row,now()))return['DEVICE_OFFLINE','电脑离线，重新上线后再升级'];
  if(!/^(windows|win32)$/i.test(row.os||''))return['CLIENT_UPDATE_WINDOWS_REQUIRED','当前远程升级仅支持 Windows 客户端'];
  if(!Number.isSafeInteger(row.pid)||row.pid<=0)return['CLIENT_UPDATE_PROCESS_REQUIRED','电脑尚未上报当前客户端进程，请等待新心跳'];
  const discovery=parse(row.runtime_discovery_json);
  if(!Array.isArray(discovery.features)||!discovery.features.includes(REMOTE_UPDATE_FEATURE)||!HASH.test(discovery.maintenanceHostId||'')||!HASH.test(row.client_build||''))return['REMOTE_UPDATE_CLIENT_REQUIRED','此旧客户端尚不支持统一远程升级，需先安装一次新版'];
  const busy=db.prepare("SELECT device_id FROM device_updates WHERE host_id=? AND state NOT IN ('succeeded','failed','cancelled')").get(host(row));
  if(busy&&busy.device_id!==row.id)return['DEVICE_MAINTENANCE_BUSY','这台电脑已有维护请求，等待维护完成'];
  return[null,null];
 }
 function deviceView(row,identity,manifest){const[code,reason]=readiness(row),operation=latest(row),stalled=Boolean(operation&&['updating','awaiting_heartbeat'].includes(operation.state)&&now()-Date.parse(operation.updated_at)>DEVICE_UPDATE_UNCONFIRMED_TIMEOUT_MS);return{id:row.id,name:row.name,os:row.os,status:row.status==='disabled'?'disabled':fresh(row,now())?'online':'offline',currentBuild:row.client_build||null,currentVersion:row.version||null,targetBuild:manifest?.targetBuild||null,version:manifest?.version||null,supported:!code,reasonCode:code,reason,canManage:['owner','admin'].includes(identity.role),operation:operation?{...view(operation),stalled,stalledReason:stalled?'维护回执超时；此记录不会证明升级成功或维护进程已退出，重新请求前客户端仍检查本机维护锁':null}:null};}
 async function list(slug,context={}){const identity=actor(slug,context);let manifest,releaseError=null;try{manifest=await release();}catch(error){releaseError=error.code;manifest=null;}const rows=db.prepare('SELECT * FROM devices WHERE workspace_id=? ORDER BY name').all(identity.ws.id).filter(row=>identity.ws.kind!=='personal'||row.owner_user_id===identity.userId);return{release:manifest,releaseError,devices:rows.map(row=>deviceView(row,identity,manifest))};}
 async function get(slug,id,requestId,context={}){const identity=actor(slug,context),row=device(identity.ws,id,identity.userId);if(requestId){const request=db.prepare('SELECT * FROM device_updates WHERE id=? AND workspace_id=? AND device_id=?').get(requestId,identity.ws.id,id);if(!request)fail('CLIENT_UPDATE_NOT_FOUND','升级请求不存在',404);return{request:view(request)};}let manifest=null;try{manifest=await release();}catch{}return{device:deviceView(row,identity,manifest)};}
 async function create(slug,id,input={},context={}){
  const identity=actor(slug,context,true),row=device(identity.ws,id,identity.userId);
  if(!input||Object.keys(input).some(key=>!['idempotencyKey','waitForIdle'].includes(key))||input.waitForIdle!==true||typeof input.idempotencyKey!=='string'||!/^[A-Za-z0-9._:-]{8,128}$/.test(input.idempotencyKey))fail('CLIENT_UPDATE_INPUT_INVALID','升级请求仅接受幂等标识和等待全部任务空闲',400);
  const prior=db.prepare('SELECT * FROM device_updates WHERE workspace_id=? AND idempotency_key=?').get(identity.ws.id,input.idempotencyKey);
  if(prior){if(prior.device_id!==id)fail('CLIENT_UPDATE_IDEMPOTENCY_CONFLICT','同一请求标识不能用于另一台电脑');return{request:view(prior),duplicate:true};}
  invalidateUnauthorizedPreUpdateIntents(db,host(row),now());
  expireUnconfirmedDeviceUpdates(db,host(row),now());
  const[code,reason]=readiness(row);if(code)fail(code,reason);
  const manifest=await release();
  actor(slug,context,true);
  const retried=db.prepare('SELECT * FROM device_updates WHERE workspace_id=? AND idempotency_key=?').get(identity.ws.id,input.idempotencyKey);
  if(retried){if(retried.device_id!==id)fail('CLIENT_UPDATE_IDEMPOTENCY_CONFLICT','同一请求标识不能用于另一台电脑');return{request:view(retried),duplicate:true};}
  const refreshed=device(identity.ws,id,identity.userId);const[changedCode,changedReason]=readiness(refreshed);if(changedCode)fail(changedCode,changedReason);
  if(refreshed.client_build!==row.client_build||host(refreshed)!==host(row)||refreshed.pid!==row.pid)fail('CLIENT_UPDATE_INSTANCE_CHANGED','读取官方版本期间客户端实例已变化，请刷新后重试');
  if(manifest.targetBuild===row.client_build)return{request:null,alreadyCurrent:true};
  const active=db.prepare("SELECT * FROM device_updates WHERE host_id=? AND state NOT IN ('succeeded','failed','cancelled')").get(host(row));
  if(active){if(active.device_id!==id)fail('DEVICE_MAINTENANCE_BUSY','这台电脑已有维护请求');return{request:view(active),duplicate:true};}
  const createdAt=stamp(),requestId=`client-update_${randomUUID()}`;
  const verification={workerReceiptRequired:(parse(refreshed.runtime_discovery_json).features||[]).includes(NATIVE_WORKER_UPDATE_VERIFICATION_FEATURE)};
  try{db.prepare("INSERT INTO device_updates(id,workspace_id,device_id,host_id,idempotency_key,actor_user_id,source_build,target_build,sha256,version,state,source_pid,created_at,updated_at,evidence_json) VALUES(?,?,?,?,?,?,?,?,?,?,'requested',?,?,?,?)").run(requestId,identity.ws.id,id,host(row),input.idempotencyKey,identity.userId,row.client_build,manifest.targetBuild,manifest.sha256,manifest.version,row.pid,createdAt,createdAt,JSON.stringify(verification));}catch(error){
   // Only a demonstrated host uniqueness race becomes a maintenance conflict.
   // Disk, schema and unrelated constraints retain their real failure.
   const conflict=db.prepare("SELECT * FROM device_updates WHERE host_id=? AND state NOT IN ('succeeded','failed','cancelled')").get(host(row));
   if(conflict){if(conflict.device_id===id)return{request:view(conflict),duplicate:true};fail('DEVICE_MAINTENANCE_BUSY','这台电脑已有维护请求');}throw error;}
  return{request:view(db.prepare('SELECT * FROM device_updates WHERE id=?').get(requestId)),duplicate:false};
 }
 function cancel(slug,id,requestId,context={}){const identity=actor(slug,context,true);device(identity.ws,id,identity.userId);const row=db.prepare('SELECT * FROM device_updates WHERE id=? AND device_id=? AND workspace_id=?').get(requestId,id,identity.ws.id);if(!row)fail('CLIENT_UPDATE_NOT_FOUND','升级请求不存在',404);if(row.state==='cancelled')return{request:view(row)};if(!['requested','accepted','waiting_idle'].includes(row.state))fail('CLIENT_UPDATE_ALREADY_STARTED','客户端已开始升级，不能取消维护');db.prepare("UPDATE device_updates SET state='cancelled',updated_at=? WHERE id=? AND state IN ('requested','accepted','waiting_idle')").run(stamp(),row.id);return{request:view(db.prepare('SELECT * FROM device_updates WHERE id=?').get(row.id))};}
 function credentialDevice(credential,slug,id){if(!credential?.deviceId||credential.workspace!==slug||credential.deviceId!==id)fail('CLIENT_UPDATE_DEVICE_CREDENTIAL_REQUIRED','需要目标电脑的有效设备凭据',403);const ws=workspace(slug),row=db.prepare("SELECT d.* FROM devices d JOIN device_credentials c ON c.device_id=d.id AND c.workspace_id=d.workspace_id WHERE d.id=? AND d.workspace_id=? AND c.id=? AND c.revoked_at IS NULL").get(id,ws.id,credential.credentialId);if(!row||row.status==='disabled')fail('CLIENT_UPDATE_DEVICE_CREDENTIAL_REQUIRED','设备凭据已失效',403);return row;}
 function nonPausableExecutionInFlight(row){
  // Do not claim an upgrade while an already admitted non-cooperative CLI is
  // running: claiming closes the client admission gate for every employee.
  // This is a scheduling hint for current ACKs, not final idle/exit evidence.
  // Historical results remain subject to the existing client recovery and idle
  // checks. Match the authenticated workspace and canonical execution target.
  return Boolean(db.prepare(`SELECT 1 FROM a2a_actions WHERE workspace_id=? AND acked_at IS NOT NULL AND status='acked'
   AND lower(type) IN (${runtimeExecutionTypes.map(()=>'?').join(',')})
   AND CASE WHEN json_valid(payload_json) THEN COALESCE(NULLIF(NULLIF(json_extract(payload_json,'$.deviceId'),''),0),NULLIF(NULLIF(json_extract(payload_json,'$.device_id'),''),0),NULLIF(NULLIF(json_extract(payload_json,'$.targetDeviceId'),''),0),NULLIF(NULLIF(json_extract(payload_json,'$.target_device_id'),''),0)) END=?
   AND lower(trim(CASE WHEN json_valid(payload_json) THEN COALESCE(NULLIF(NULLIF(json_extract(payload_json,'$.runtime'),''),0),NULLIF(NULLIF(json_extract(payload_json,'$.agent'),''),0),NULLIF(NULLIF(json_extract(payload_json,'$.runtimeName'),''),0),'') ELSE '' END))<>'hermes' LIMIT 1`).get(row.workspace_id,...runtimeExecutionTypes,row.id));
 }
 function pending(slug,id,credential){const row=credentialDevice(credential,slug,id),request=latest(row);if(request?.state==='requested'&&nonPausableExecutionInFlight(row))return{request:null};return{request:request?{...view(request),workspace:slug,hostId:request.host_id}:null};}
 function bound(slug,id,requestId,credential){const row=credentialDevice(credential,slug,id),request=db.prepare('SELECT * FROM device_updates WHERE id=? AND device_id=? AND workspace_id=?').get(requestId,id,row.workspace_id);if(!request)fail('CLIENT_UPDATE_NOT_FOUND','升级请求不存在',404);return{row,request};}
 function claim(slug,id,requestId,input={},credential){const{row,request}=bound(slug,id,requestId,credential);
  invalidateUnauthorizedPreUpdateIntents(db,request.host_id,now());
  if(db.prepare('SELECT reason_code FROM device_updates WHERE id=?').get(request.id)?.reason_code==='CLIENT_UPDATE_AUTHORITY_REVOKED')fail('CLIENT_UPDATE_AUTHORITY_REVOKED','原升级授权已失效，请由当前管理员重新发起',403);
  actor(slug,{actorUserId:request.actor_user_id},true);
  if(!fresh(row,now()))fail('DEVICE_OFFLINE','电脑尚未提供新鲜心跳');if(!input||Object.keys(input).some(key=>!['hostId','clientBuild','pid'].includes(key))||input.hostId!==request.host_id||host(row)!==request.host_id||input.clientBuild!==request.source_build||row.client_build!==request.source_build||!Number.isInteger(input.pid)||input.pid<=0||input.pid!==row.pid)fail('CLIENT_UPDATE_INSTANCE_CHANGED','当前客户端与升级请求绑定不一致');if(TERMINAL.has(request.state))fail('CLIENT_UPDATE_TERMINAL','升级请求已结束');if(request.state==='requested'){if(nonPausableExecutionInFlight(row))fail('CLIENT_UPDATE_WAITING_EXECUTION','升级已排队，等待这台电脑上不支持检查点的执行结束；其他员工仍可继续工作');const token=randomBytes(32).toString('hex');db.prepare("UPDATE device_updates SET state='accepted',claim_token=?,updated_at=? WHERE id=? AND state='requested'").run(token,stamp(),request.id);}const accepted=db.prepare('SELECT * FROM device_updates WHERE id=?').get(request.id);return{request:{...view(accepted),workspace:slug,hostId:accepted.host_id},claimToken:accepted.claim_token};}
 function progress(slug,id,requestId,input={},credential){
  let{row,request}=bound(slug,id,requestId,credential);
  const allowed=['state','hostId','clientBuild','claimToken','workerPid','code','workerReceipt','rollbackEvidence','observedFailure'];
  const historical=Boolean(input&&Object.hasOwn(input,'observedFailure'));
  if(!input||Object.keys(input).some(key=>!allowed.includes(key))||!['accepted','waiting_idle','updating','awaiting_heartbeat','failed'].includes(input.state)||input.hostId!==request.host_id||host(row)!==request.host_id||!([request.source_build,request.target_build].includes(input.clientBuild)||historical&&input.clientBuild===row.client_build&&fresh(row,now()))||!sameSecret(input.claimToken,request.claim_token)||input.workerPid!==undefined&&(!Number.isInteger(input.workerPid)||input.workerPid<=0)||input.code!==undefined&&!/^CLIENT_UPDATE_[A-Z0-9_]{1,64}$/.test(input.code))fail('CLIENT_UPDATE_PROGRESS_INVALID','升级状态回报不符合绑定契约',400);
  if(input.state==='updating'&&['requested','accepted','waiting_idle'].includes(request.state)){
   invalidateUnauthorizedPreUpdateIntents(db,request.host_id,now());
   request=db.prepare('SELECT * FROM device_updates WHERE id=?').get(request.id);
  }
  if(['workerReceipt','rollbackEvidence','observedFailure'].some(key=>Object.hasOwn(input,key)))return applyNativeReceipt(db,request,row,input,now());
  if(request.state==='succeeded'&&input.state==='failed')fail('CLIENT_UPDATE_ROLLBACK_EVIDENCE_REQUIRED','成功观察之后的失败必须附带同请求的原生终端证据');
  if(TERMINAL.has(request.state))return{request:view(request)};
  if(input.state===request.state)return{request:view(request)};
  const rank=state=>STATES.indexOf(state);
  if(input.state!==request.state&&input.state!=='failed'&&(rank(input.state)<rank(request.state)||rank(input.state)>rank(request.state)+1))fail('CLIENT_UPDATE_PROGRESS_CONFLICT','升级状态顺序不正确');
  db.prepare('UPDATE device_updates SET state=?,reason_code=?,worker_pid=COALESCE(?,worker_pid),updated_at=? WHERE id=?').run(input.state,input.code||null,input.workerPid||null,stamp(),request.id);
  return{request:view(db.prepare('SELECT * FROM device_updates WHERE id=?').get(request.id))};
 }
 return{list,get,create,cancel,pending,claim,progress,release};
}
