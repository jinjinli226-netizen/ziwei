import crypto from 'node:crypto';
import {botProfileBinding} from './bot-profiles.mjs';
import {readHistoricalPrelaunchRecovery} from './bot-historical-recovery-view.mjs';
import {botFailure} from '../src/hermes-bot-config.mjs';
import {
  HISTORICAL_PRELAUNCH_POLICY as POLICY,HISTORICAL_PRELAUNCH_POLICY_DIGEST as POLICY_DIGEST,
  HISTORICAL_POST_UPDATE_HOLDER_POLICY as POST_POLICY,HISTORICAL_POST_UPDATE_HOLDER_POLICY_DIGEST as POST_DIGEST,validateHistoricalPostUpdateHolderEvidence,
  HISTORICAL_PRELAUNCH_RECOVERY_KIND as KIND,HISTORICAL_PRELAUNCH_CHALLENGE_TTL_MS as TTL,
  canonicalHistoricalPrelaunchValue as canonical,historicalPrelaunchDigest as digest,
  historicalPrelaunchBytesDigest as bytesDigest,historicalPrelaunchExactKeys as exact,
  historicalPrelaunchHex as hex,historicalPrelaunchPolicyAllows as policyAllows,historicalPrelaunchDeliveredPayload,
  historicalPrelaunchAdmissionProof as admissionProof,validateHistoricalPrelaunchReceipt as receiptValid,
} from '../src/bot-historical-prelaunch-policy.mjs';

const REQUEST_KIND='bot-historical-prelaunch-recovery-v1';
const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
const fail=(code,message,status=409)=>{throw botFailure(code,message,status);};
const same=(a,b)=>canonical(a)===canonical(b);
const finiteDate=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const field=value=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\0\r\n]/.test(value);

// Deliberately separate from ordinary complete/reconcile: those paths continue
// to require a real launched root and a full execution-tree exit receipt.
export function createBotHistoricalRecovery(repo,{readA2AToken,now=Date.now}={}) {
  const db=repo.db;
  if(typeof readA2AToken!=='function')throw new TypeError('Historical recovery requires the server A2A secret callback');
  const atomic=fn=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}};
  function admission(actionId){
    repo.preservation?.assertAction(actionId);
    repo.serverCodeRollout?.assertExecution();
    if(db.prepare('SELECT ziwei_v2_admitted(?) AS admitted').get(actionId)?.admitted!==1)fail('V2_OBJECT_SEALED','当前动作不允许历史恢复');
  }
  function identity(actionId,credential){
    if(!field(credential?.credentialId)||!field(credential?.deviceId)||!field(credential?.workspaceId)||!field(credential?.workspace))fail('BOT_PRELAUNCH_DEVICE_REQUIRED','历史恢复必须使用原电脑的有效配对设备凭证',401);
    const grant=db.prepare('SELECT c.id,c.device_id,c.workspace_id,c.revoked_at,d.status,w.slug FROM device_credentials c JOIN devices d ON d.id=c.device_id AND d.workspace_id=c.workspace_id JOIN workspaces w ON w.id=c.workspace_id WHERE c.id=?').get(credential.credentialId);
    if(!grant||grant.revoked_at||grant.status==='disabled'||grant.device_id!==credential.deviceId||grant.workspace_id!==credential.workspaceId||grant.slug!==credential.workspace)fail('BOT_PRELAUNCH_DEVICE_REQUIRED','原电脑配对设备凭证已失效',401);
    const raw=db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(actionId),payload=parse(raw?.payload_json),snapshot=payload?.hermesBot;
    if(!raw)fail('ACTION_NOT_FOUND','原 action 不存在',404);
    const employee=snapshot?.employeeId?db.prepare('SELECT * FROM employees WHERE id=? AND workspace_id=?').get(snapshot.employeeId,raw.workspace_id):null;
    const bot=employee?db.prepare('SELECT * FROM hermes_bots WHERE employee_id=? AND workspace_id=?').get(employee.id,raw.workspace_id):null;
    if(raw.workspace_id!==grant.workspace_id||snapshot?.workspace!==grant.slug||!employee||!bot||employee.status==='deleted'||payload.employeeId!==employee.id||payload.runtime!=='Hermes'||employee.runtime!=='Hermes'||payload.deviceId!==grant.device_id||snapshot.deviceId!==grant.device_id||employee.target_device_id!==grant.device_id||payload.profile!==employee.runtime_profile||snapshot.sourceProfile!==employee.runtime_profile||!Number.isSafeInteger(snapshot.revision)||snapshot.revision<1||!Number.isSafeInteger(snapshot.controlEpoch)||snapshot.controlEpoch<1)fail('BOT_PRELAUNCH_BINDING_CONFLICT','原动作的设备、工作区、员工或 Profile 绑定不一致',403);
    if(!same(snapshot.instance,botProfileBinding(bot)))fail('BOT_PRELAUNCH_BINDING_CONFLICT','原动作的 Profile 所有权绑定已变化',403);
    return{raw,payload,snapshot,employee,bot,grant};
  }
  function paused(checked,{completed=false}={}){
    const {raw,snapshot,employee,bot}=checked;
    if(bot.control_state!=='paused'||employee.status!=='paused'||bot.revision!==snapshot.revision||bot.control_epoch<snapshot.controlEpoch||(!completed&&bot.active_action_id!==raw.id)||(completed&&bot.active_action_id!==null&&bot.active_action_id!==raw.id))fail('BOT_PRELAUNCH_CONTROL_CONFLICT','恢复只允许原 active action 与当前已暂停的同一 Bot 配置');
  }
  function subjectFor(checked,{requirePolicy=true,postUpdate=false}={}){
    const {raw,payload,snapshot,employee,bot,grant}=checked;
    paused(checked);
    if(db.prepare("SELECT 1 FROM employee_template_instances WHERE employee_id=? AND workspace_id=? AND template_id='ziwei-employee-creator'").get(employee.id,raw.workspace_id))fail('BOT_PRELAUNCH_POLICY_UNAVAILABLE','此历史恢复策略不允许 Creator 模板实例');
    const result=parse(raw.result_json);
    if(raw.agent_id!=='ziwei_user'||raw.status!=='failed'||!finiteDate(raw.created_at)||!finiteDate(raw.acked_at)||!finiteDate(raw.completed_at)||Date.parse(raw.acked_at)<Date.parse(raw.created_at)||Date.parse(raw.completed_at)<Date.parse(raw.acked_at)||!same(result,POLICY.originalResult))fail('BOT_PRELAUNCH_ORIGINAL_FAILURE_REQUIRED','原动作必须保留精确的历史待核实失败回执');
    const terminal=db.prepare("SELECT * FROM a2a_action_events WHERE action_id=? AND type IN ('failed','succeeded') ORDER BY created_at,id").all(raw.id);
    if(terminal.length!==1||terminal[0].type!=='failed')fail('BOT_PRELAUNCH_ORIGINAL_FAILURE_REQUIRED','原动作必须有唯一且未冲突的原设备 failed 事件');
    const event=terminal[0],data=parse(event.data_json);
    if(!finiteDate(event.created_at)||Date.parse(event.created_at)<Date.parse(raw.acked_at)||!exact(data,['error','result'])||data.error!==raw.error||!same(data.result,result))fail('BOT_PRELAUNCH_ORIGINAL_FAILURE_REQUIRED','服务器原 failed 事件与原动作结果不一致');
    const originalWire={status:'failed',result,error:raw.error,receiptOnly:true};
    const subject={schemaVersion:1,actionId:raw.id,actionType:raw.type,workspace:grant.slug,workspaceId:raw.workspace_id,deviceId:grant.device_id,employeeId:employee.id,credentialId:grant.id,profile:employee.runtime_profile,profileBinding:botProfileBinding(bot),profileBindingDigest:digest(botProfileBinding(bot)),dedupeKey:raw.dedupe_key,createdAt:raw.created_at,ackedAt:raw.acked_at,completedAt:raw.completed_at,originalRevision:snapshot.revision,originalControlEpoch:snapshot.controlEpoch,currentRevision:bot.revision,currentControlEpoch:bot.control_epoch,currentControlState:bot.control_state,currentEmployeeStatus:employee.status,originalActionSha256:bytesDigest(canonical(raw)),originalPayloadSha256:bytesDigest(raw.payload_json),originalDeliveredPayloadDigest:digest(historicalPrelaunchDeliveredPayload(payload)),originalResultSha256:bytesDigest(raw.result_json),originalResultDigest:digest(result),originalWireBodyDigest:digest(originalWire),originalError:raw.error,failedEvent:{id:event.id,type:event.type,createdAt:event.created_at,error:data.error,dataSha256:bytesDigest(event.data_json),resultDigest:digest(data.result)}};
    if(postUpdate){const holder=db.prepare('SELECT client_build,pid FROM devices WHERE id=? AND workspace_id=?').get(grant.device_id,grant.workspace_id);if(holder?.client_build!==POST_POLICY.maintenanceHolderBuild||!Number.isSafeInteger(holder.pid)||holder.pid<=0)fail('BOT_PRELAUNCH_HOLDER_BINDING_CONFLICT','当前电脑尚未上报固定官方更新版本及维护进程身份');subject.maintenanceHolderBuild=holder.client_build;subject.maintenanceHolderPid=holder.pid;}
    if(requirePolicy&&!policyAllows(subject))fail('BOT_PRELAUNCH_POLICY_UNAVAILABLE','此历史版本尚未取得可证明模型未启动的独立源代码审计策略');
    return{subject,originalResult:result};
  }
  function signed(payload){
    const key=readA2AToken();if(typeof key!=='string'||key.length<16)fail('BOT_PRELAUNCH_SIGNING_UNAVAILABLE','服务器恢复挑战签名暂不可用',503);
    const data=Buffer.from(canonical(payload)).toString('base64url');
    return`${data}.${crypto.createHmac('sha256',key).update(`ziwei-historical-prelaunch-v${payload.schemaVersion}\0`+data).digest('base64url')}`;
  }
  function verified(challenge,{expired=false}={}){
    if(typeof challenge!=='string'||challenge.length>20000||!/^[-_A-Za-z0-9]+\.[-_A-Za-z0-9]{43}$/.test(challenge))fail('BOT_PRELAUNCH_CHALLENGE_INVALID','历史恢复挑战无效',400);
    const [data]=challenge.split('.'),payload=parse(Buffer.from(data,'base64url').toString('utf8'));
    const postUpdate=payload?.schemaVersion===2,policy=postUpdate?POST_POLICY:POLICY,policyDigest=postUpdate?POST_DIGEST:POLICY_DIGEST;
    if(!exact(payload,['schemaVersion','kind',...(postUpdate?['mode']:[]),'policy','sourcePolicyDigest','issuedAt','expiresAt','nonce','subject','subjectDigest'])||![1,2].includes(payload.schemaVersion)||postUpdate&&payload.mode!==POST_POLICY.mode||payload.kind!==KIND||payload.policy!==policy.id||payload.sourcePolicyDigest!==policyDigest||!hex(payload.nonce)||!hex(payload.subjectDigest)||digest(payload.subject)!==payload.subjectDigest||!Number.isSafeInteger(payload.issuedAt)||!Number.isSafeInteger(payload.expiresAt)||payload.expiresAt-payload.issuedAt!==TTL||payload.issuedAt>now()||!policyAllows(payload.subject))fail('BOT_PRELAUNCH_CHALLENGE_INVALID','历史恢复挑战内容无效',400);
    const expected=signed(payload),left=Buffer.from(challenge),right=Buffer.from(expected);
    if(left.length!==right.length||!crypto.timingSafeEqual(left,right))fail('BOT_PRELAUNCH_CHALLENGE_INVALID','历史恢复挑战签名不匹配',403);
    if(!expired&&payload.expiresAt<=now())fail('BOT_PRELAUNCH_CHALLENGE_EXPIRED','历史恢复挑战已到期，请重新准备');
    return payload;
  }
  function evidenceFor(evidence,subject,{postUpdate=false}={}){
    if(postUpdate){if(!validateHistoricalPostUpdateHolderEvidence(evidence,subject,{recordedAt:now()}))fail('BOT_PRELAUNCH_MIGRATION_EVIDENCE_INVALID','官方迁移记录、旧安装来源或当前维护进程退出证明不匹配');return evidence;}
    if(!exact(evidence,['schemaVersion','policy','sourceBuild','sourcePolicyDigest','subjectDigest','daemonExit','localEvidence'])||evidence.schemaVersion!==1||evidence.policy!==POLICY.id||evidence.sourceBuild!==POLICY.sourceBuild||evidence.sourcePolicyDigest!==POLICY_DIGEST||evidence.subjectDigest!==digest(subject))fail('BOT_PRELAUNCH_EVIDENCE_INVALID','恢复证据的策略或原动作绑定无效',400);
    const stopped=evidence.daemonExit;
    if(!exact(stopped,['stopped','pid','creationTime','exitedAt'])||stopped.stopped!==true||!Number.isSafeInteger(stopped.pid)||stopped.pid<=0||!finiteDate(stopped.creationTime)||!finiteDate(stopped.exitedAt)||Date.parse(stopped.creationTime)>evidence.localEvidence?.quarantine?.startedAt||Date.parse(stopped.exitedAt)<Date.parse(subject.failedEvent.createdAt)||Date.parse(stopped.exitedAt)>now())fail('BOT_PRELAUNCH_DAEMON_EXIT_REQUIRED','需要停止持有原执行的准确 daemon 进程并取得退出证明');
    const local=evidence.localEvidence,q=local?.quarantine;
    if(!exact(local,['sourceFiles','quarantine','noSupervision','quarantineCount'])||local.noSupervision!==true||local.quarantineCount!==1||!Array.isArray(local.sourceFiles)||local.sourceFiles.length!==Object.keys(POLICY.sourceFiles).length)fail('BOT_PRELAUNCH_LOCAL_EVIDENCE_INVALID','需要唯一旧隔离动作及完整固定版本来源证据');
    const sourceFiles=Object.fromEntries(local.sourceFiles.map(item=>exact(item,['path','sha256'])&&typeof item.path==='string'&&hex(item.sha256)?[item.path,item.sha256]:['invalid',null]));
    if(Object.keys(sourceFiles).length!==local.sourceFiles.length||!same(sourceFiles,POLICY.sourceFiles))fail('BOT_PRELAUNCH_SOURCE_MISMATCH','目标电脑的历史执行来源与独立审计固定版本不一致');
    if(!exact(q,['actionId','dedupeKey','startedAt','startedSha256','stateSha256','deliverySha256','actionSha256','resultSha256','serverResultDigest'])||q.actionId!==subject.actionId||q.dedupeKey!==subject.dedupeKey||!Number.isSafeInteger(q.startedAt)||q.startedAt<Date.parse(subject.ackedAt)||q.startedAt>Date.parse(subject.failedEvent.createdAt)||!['startedSha256','stateSha256','deliverySha256','actionSha256','resultSha256','serverResultDigest'].every(key=>hex(q[key]))||q.serverResultDigest!==subject.originalWireBodyDigest)fail('BOT_PRELAUNCH_LOCAL_EVIDENCE_INVALID','本机唯一旧隔离记录或待投递失败与原动作不匹配');
    return evidence;
  }
  function priorFor(actionId,checked){
    const prior=db.prepare('SELECT * FROM management_requests WHERE workspace_id=? AND kind=? AND request_key=?').get(checked.raw.workspace_id,REQUEST_KIND,actionId);
    if(!prior)return null;
    const receipt=readHistoricalPrelaunchRecovery(db,checked.raw);
    if(!receipt||!receiptValid(receipt,{actionId})||prior.fingerprint!==receipt.evidenceDigest||receipt.subject.credentialId!==checked.grant.id||receipt.subject.deviceId!==checked.grant.device_id||checked.raw.status!=='failed'||bytesDigest(canonical(checked.raw))!==receipt.subject.originalActionSha256)fail('BOT_PRELAUNCH_RECOVERY_CONFLICT','原恢复回执与当前动作或控制状态不一致');
    const originalEvent=db.prepare('SELECT data_json FROM a2a_action_events WHERE id=? AND action_id=? AND type=?').get(receipt.subject.failedEvent.id,actionId,'failed');
    if(!originalEvent||bytesDigest(originalEvent.data_json)!==receipt.subject.failedEvent.dataSha256)fail('BOT_PRELAUNCH_RECOVERY_CONFLICT','原设备失败证据已变化');
    return{prior,receipt};
  }
  function prepare(actionId,credential,input={}){return atomic(()=>{
    if(!exact(input,[])&&!exact(input,['workspace'])&&!exact(input,['mode'])&&!exact(input,['workspace','mode']))fail('BOT_PRELAUNCH_INPUT_INVALID','恢复准备请求包含未知字段',400);
    const postUpdate=input.mode===POST_POLICY.mode;if(input.mode!==undefined&&!postUpdate)fail('BOT_PRELAUNCH_INPUT_INVALID','历史恢复模式无效',400);
    const policy=postUpdate?POST_POLICY:POLICY,policyDigest=postUpdate?POST_DIGEST:POLICY_DIGEST;
    const checked=identity(actionId,credential);
    if(input.workspace!==undefined&&input.workspace!==checked.grant.slug)fail('BOT_PRELAUNCH_BINDING_CONFLICT','恢复工作区不一致',403);
    const previous=priorFor(actionId,checked);if(previous)return{recovered:true,receipt:previous.receipt};
    admission(actionId);
    const {subject,originalResult}=subjectFor(checked,{postUpdate}),issuedAt=now();
    const payload={schemaVersion:postUpdate?2:1,kind:KIND,...(postUpdate?{mode:POST_POLICY.mode}:{}),policy:policy.id,sourcePolicyDigest:policyDigest,issuedAt,expiresAt:issuedAt+TTL,nonce:crypto.randomBytes(32).toString('hex'),subject,subjectDigest:digest(subject)};
    return{recovered:false,challenge:signed(payload),subject,subjectDigest:payload.subjectDigest,expiresAt:new Date(payload.expiresAt).toISOString(),policy,sourcePolicyDigest:policyDigest,...(postUpdate?{mode:POST_POLICY.mode}:{}),originalResult,originalWireBodyDigest:subject.originalWireBodyDigest,originalDeliveredPayloadDigest:subject.originalDeliveredPayloadDigest};
  });}
  function commit(actionId,credential,input={}){return atomic(()=>{
    if(!exact(input,['challenge','evidence']))fail('BOT_PRELAUNCH_INPUT_INVALID','恢复提交必须包含挑战与完整证据',400);
    const checked=identity(actionId,credential);
    const previous=priorFor(actionId,checked),claim=verified(input.challenge,{expired:Boolean(previous)});
    if(claim.subject.actionId!==actionId||claim.subject.credentialId!==checked.grant.id||claim.subject.deviceId!==checked.grant.device_id||claim.subject.workspaceId!==checked.grant.workspace_id)fail('BOT_PRELAUNCH_BINDING_CONFLICT','恢复挑战不属于当前原设备动作',403);
    const postUpdate=claim.schemaVersion===2,evidence=evidenceFor(input.evidence,claim.subject,{postUpdate}),evidenceDigest=digest(evidence);
    const policy=postUpdate?POST_POLICY:POLICY,policyDigest=postUpdate?POST_DIGEST:POLICY_DIGEST;
    if(previous){if(previous.prior.fingerprint!==evidenceDigest||previous.receipt.subjectDigest!==claim.subjectDigest)fail('BOT_PRELAUNCH_IDEMPOTENCY_CONFLICT','此原动作已使用不同证据恢复');return{receipt:previous.receipt};}
    admission(actionId);
    const {subject,originalResult}=subjectFor(checked,{requirePolicy:false,postUpdate});
    if(!same(subject,claim.subject))fail('BOT_PRELAUNCH_SUBJECT_CHANGED','挑战准备后原失败证据、Profile 或控制状态已变化');
    const recordedAt=new Date(now()).toISOString(),receipt={schemaVersion:postUpdate?2:1,kind:KIND,...(postUpdate?{mode:POST_POLICY.mode}:{}),id:digest({actionId,subjectDigest:claim.subjectDigest,evidenceDigest}),policy:policy.id,sourceBuild:policy.sourceBuild,sourcePolicyDigest:policyDigest,subject,subjectDigest:claim.subjectDigest,evidenceDigest,localEvidenceDigest:digest(evidence.localEvidence),...(postUpdate?{maintenanceHolderExit:evidence.maintenanceHolderExit,migrationEvidenceDigest:digest(evidence.migrationEvidence),verifiedUpdateFinishedAt:evidence.migrationEvidence.finishedAt}:{daemonExit:evidence.daemonExit}),localStartedAt:evidence.localEvidence.quarantine.startedAt,admissionProof:admissionProof(),status:'failed',executionState:'not_started',recordedAt};
    if(!receiptValid(receipt,{actionId,subject,evidenceDigest}))fail('BOT_PRELAUNCH_RECEIPT_INVALID','服务器恢复回执未通过校验');
    // The original uncertain action/result/error and its failed event remain intact.
    const unchanged=db.prepare("SELECT 1 FROM a2a_actions WHERE id=? AND workspace_id=? AND status='failed' AND payload_json=? AND result_json=? AND ziwei_v2_admitted(id)=1").get(actionId,checked.raw.workspace_id,checked.raw.payload_json,checked.raw.result_json);
    const botWrite=db.prepare("UPDATE hermes_bots SET active_action_id=NULL,updated_at=? WHERE employee_id=? AND workspace_id=? AND active_action_id=? AND revision=? AND control_epoch=? AND control_state='paused'").run(recordedAt,subject.employeeId,subject.workspaceId,actionId,subject.currentRevision,subject.currentControlEpoch);
    if(!unchanged||botWrite.changes!==1)fail('BOT_PRELAUNCH_SUBJECT_CHANGED','恢复时原动作或暂停控制状态发生并发变化');
    const eventId=`action-event_${receipt.id}`;
    db.prepare('INSERT INTO a2a_action_events(id,action_id,type,message,data_json,created_at) VALUES(?,?,?,?,?,?)').run(eventId,actionId,KIND,'独立审计已确认原模型调用未启动；保留历史失败，未重派原消息',JSON.stringify({receipt,evidence,originalResult,originalError:checked.raw.error}),recordedAt);
    db.prepare('INSERT INTO management_requests(workspace_id,kind,request_key,fingerprint,resource_id,created_at) VALUES(?,?,?,?,?,?)').run(subject.workspaceId,REQUEST_KIND,actionId,evidenceDigest,eventId,recordedAt);
    return{receipt};
  });}
  function status(actionId,credential,input={}){return atomic(()=>{
    const modes=['original_holder',POST_POLICY.mode],phases=['inspecting','prepared','stopping','daemon_exited','before_commit','receipt_saved','applied','resuming','not_applicable','failed'];
    if(!exact(input,['mode','phase','reasonCode','holderBuild','attemptId'])||!modes.includes(input.mode)||!phases.includes(input.phase)||input.reasonCode!==null&&(typeof input.reasonCode!=='string'||!/^[A-Z][A-Z0-9_]{0,95}$/.test(input.reasonCode))||![POLICY.sourceBuild,POST_POLICY.maintenanceHolderBuild].includes(input.holderBuild)||typeof input.attemptId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(input.attemptId))fail('BOT_PRELAUNCH_DIAGNOSTIC_INVALID','历史恢复诊断只接受固定模式、阶段和安全错误代码',400);
    const checked=identity(actionId,credential),pin=POLICY.auditedSubject;
    if(actionId!==pin.actionId||checked.raw.workspace_id!==pin.workspaceId||checked.grant.device_id!==pin.deviceId||checked.employee.id!==pin.employeeId||bytesDigest(checked.raw.payload_json)!==pin.originalPayloadSha256||bytesDigest(checked.raw.result_json)!==pin.originalResultSha256)fail('BOT_PRELAUNCH_BINDING_CONFLICT','诊断不属于固定历史动作或原电脑',403);
    const eventId=`action-event_diagnostic_${digest({actionId,credentialId:checked.grant.id,...input})}`,previous=db.prepare('SELECT id FROM a2a_action_events WHERE id=? AND action_id=?').get(eventId,actionId);
    if(!previous)db.prepare('INSERT INTO a2a_action_events(id,action_id,type,message,data_json,created_at) VALUES(?,?,?,?,?,?)').run(eventId,actionId,'bot.historical_prelaunch_diagnostic','历史恢复设备诊断；不构成恢复证明',JSON.stringify(input),new Date(now()).toISOString());
    return{recorded:true,eventId};
  });}
  return{prepare,commit,status};
}
