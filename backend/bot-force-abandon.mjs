import crypto from 'node:crypto';
import {botProfileBinding} from './bot-profiles.mjs';
import {botFailure} from '../src/hermes-bot-config.mjs';
import {
  BOT_FORCE_ABANDON_POLICY as POLICY,BOT_FORCE_ABANDON_POLICY_DIGEST as POLICY_DIGEST,
  BOT_FORCE_ABANDON_ABSENT_POLICY as ABSENT_POLICY,BOT_FORCE_ABANDON_ABSENT_POLICY_DIGEST as ABSENT_DIGEST,
  BOT_FORCE_ABANDON_KIND as KIND,BOT_FORCE_ABANDON_TTL_MS as TTL,
  canonicalForceAbandonValue as canonical,forceAbandonDigest as digest,forceAbandonBytesDigest as bytesDigest,
  forceAbandonExactKeys as exact,forceAbandonHex as hex,forceAbandonSubjectAllowed,
  validateForceAbandonHolder,validateForceAbandonEvidence,validateForceAbandonReceipt,validateForceAbandonAbsence,validateForceAbandonInstallation,
} from '../src/bot-force-abandon-contract.mjs';

const GRANT_KIND='bot-force-abandon-grant-v1',REQUEST_KIND='bot-force-abandon-recovery-v1',IDEMPOTENCY_KIND='bot-force-abandon-request-v1',GRANT_EVENT='bot.operator_force_abandon_requested';
const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
const fail=(code,message,status=409)=>{throw botFailure(code,message,status);};
const same=(a,b)=>canonical(a)===canonical(b);
const text=value=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\0\r\n]/.test(value);

// Operator disposition is independent of execution completion. None of these
// records asserts that the original execution tree exited or never launched.
function original(db,row){
  if(!row)return null;
  const p=POLICY.subject,payload=parse(row.payload_json),snapshot=payload?.hermesBot,result=parse(row.result_json),workspace=db.prepare('SELECT slug FROM workspaces WHERE id=?').get(row.workspace_id);
  const terminal=db.prepare("SELECT * FROM a2a_action_events WHERE action_id=? AND type IN ('failed','succeeded') ORDER BY created_at,id").all(row.id),event=terminal[0],data=parse(event?.data_json);
  if(row.id!==p.actionId||row.workspace_id!==p.workspaceId||workspace?.slug!==p.workspace||row.agent_id!=='ziwei_user'||row.type!=='conversation.execute'||row.status!=='failed'||row.error!==POLICY.originalError||bytesDigest(row.payload_json)!==p.originalPayloadSha256||bytesDigest(row.result_json)!==p.originalResultSha256||!same(result,POLICY.originalResult)||payload?.runtime!=='Hermes'||payload.employeeId!==p.employeeId||payload.deviceId!==p.deviceId||payload.profile!==p.profile||snapshot?.workspace!==p.workspace||snapshot.employeeId!==p.employeeId||snapshot.deviceId!==p.deviceId||snapshot.sourceProfile!==p.profile||snapshot.revision!==p.originalRevision||snapshot.controlEpoch!==p.originalControlEpoch||terminal.length!==1||event.type!=='failed'||event.id!==p.failedEventId||bytesDigest(event.data_json)!==p.failedEventDataSha256||!exact(data,['error','result'])||data.error!==row.error||!same(data.result,result))return null;
  return{row,payload,snapshot,event,result};
}
function readGrant(db,row){
  try{
    const checked=original(db,row);if(!checked)return null;
    const marker=db.prepare('SELECT * FROM management_requests WHERE workspace_id=? AND kind=? AND request_key=?').get(row.workspace_id,GRANT_KIND,row.id);
    if(!marker)return null;
    const event=db.prepare('SELECT * FROM a2a_action_events WHERE id=? AND action_id=? AND type=?').get(marker.resource_id,row.id,GRANT_EVENT),grant=parse(event?.data_json),p=POLICY.subject;
    if(!exact(grant,['schemaVersion','id','actionId','workspace','workspaceId','deviceId','employeeId','profile','actorUserId','actorRole','expectedRevision','expectedControlEpoch','acknowledgeUncertain','originalActionSha256','idempotencyKey','requestedAt'])||grant.schemaVersion!==1||event.id!==grant.id||event.created_at!==grant.requestedAt||marker.fingerprint!==digest(grant)||marker.created_at!==grant.requestedAt||grant.actionId!==row.id||grant.workspace!==p.workspace||grant.workspaceId!==row.workspace_id||grant.deviceId!==p.deviceId||grant.employeeId!==p.employeeId||grant.profile!==p.profile||grant.expectedRevision!==p.currentRevision||grant.expectedControlEpoch!==p.currentControlEpoch||grant.acknowledgeUncertain!==true||!text(grant.actorUserId)||!['owner','admin'].includes(grant.actorRole)||!text(grant.idempotencyKey)||grant.originalActionSha256!==bytesDigest(canonical(row)))return null;
    const input={expectedActionId:grant.actionId,expectedRevision:grant.expectedRevision,expectedControlEpoch:grant.expectedControlEpoch,acknowledgeUncertain:true,idempotencyKey:grant.idempotencyKey};
    const idem=db.prepare('SELECT * FROM management_requests WHERE workspace_id=? AND kind=? AND request_key=?').get(row.workspace_id,IDEMPOTENCY_KIND,`${grant.actorUserId}:${grant.idempotencyKey}`);
    if(!idem||idem.resource_id!==grant.id||idem.fingerprint!==digest({actorUserId:grant.actorUserId,input}))return null;
    return grant;
  }catch{return null;}
}
export function readForceAbandonRecovery(db,row){
  try{
    const checked=original(db,row);if(!checked)return null;
    const marker=db.prepare('SELECT * FROM management_requests WHERE workspace_id=? AND kind=? AND request_key=?').get(row.workspace_id,REQUEST_KIND,row.id);if(!marker)return null;
    const event=db.prepare('SELECT * FROM a2a_action_events WHERE id=? AND action_id=? AND type=?').get(marker.resource_id,row.id,KIND),data=parse(event?.data_json),r=data?.receipt,g=readGrant(db,row);
    if(!exact(data,['receipt','evidence'])||!validateForceAbandonReceipt(r,{actionId:row.id})||!g||r.grantId!==g.id||r.grantDigest!==digest(g)||event.id!==`action-event_${r.id}`||event.created_at!==r.recordedAt||marker.created_at!==r.recordedAt||marker.fingerprint!==r.evidenceDigest||data.evidence?.schemaVersion!==r.schemaVersion||!validateForceAbandonEvidence(data.evidence,r.subject,{recordedAt:r.recordedAt})||digest(data.evidence)!==r.evidenceDigest||digest(data.evidence.localArchive)!==r.localArchiveDigest||!same(r.schemaVersion===2?data.evidence.currentDaemonAbsence:data.evidence.currentDaemonExit,r.schemaVersion===2?r.currentDaemonAbsence:r.currentDaemonExit))return null;
    const s=r.subject,{snapshot,event:failed}=checked;
    if(s.originalActionSha256!==bytesDigest(canonical(row))||s.originalPayloadSha256!==bytesDigest(row.payload_json)||s.originalResultSha256!==bytesDigest(row.result_json)||s.originalDeliveredPayloadDigest!==digest(deliveredPayload(checked.payload))||s.actionType!==row.type||s.dedupeKey!==row.dedupe_key||s.createdAt!==row.created_at||s.ackedAt!==row.acked_at||s.completedAt!==row.completed_at||!same(s.profileBinding,snapshot.instance)||s.failedEvent.id!==failed.id||s.failedEvent.createdAt!==failed.created_at||s.failedEvent.dataSha256!==bytesDigest(failed.data_json))return null;
    return r;
  }catch{return null;}
}
// Fixed ordinary-employee wire shape from the retained historical action.
const deliveredPayload=payload=>{const {employeeTemplateId:_a,employeePersona:_b,employeeInstructions:_c,employeeDescription:_d,managementMcp:_m,...rest}=payload;return{...rest,managementMcp:{enabled:true,workspace:payload.hermesBot.workspace}};};

export function createBotForceAbandon(repo,{readA2AToken,now=Date.now}={}){
  const db=repo.db;
  if(typeof readA2AToken!=='function')throw new TypeError('Force abandon requires the server challenge signing callback');
  const atomic=fn=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}};
  function admission(actionId){repo.preservation?.assertAction(actionId);repo.serverCodeRollout?.assertExecution();if(db.prepare('SELECT ziwei_v2_admitted(?) AS admitted').get(actionId)?.admitted!==1)fail('V2_OBJECT_SEALED','当前动作不允许人工放弃');}
  function rawOriginal(actionId){const raw=db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(actionId),checked=original(db,raw);if(!checked)fail('BOT_FORCE_ABANDON_SUBJECT_INVALID','只允许保留完整原始证据的指定历史动作');return checked;}
  function scope(slug,employeeId,context={}){
    const ws=db.prepare('SELECT * FROM workspaces WHERE slug=?').get(slug),member=context.actorUserId&&ws?db.prepare('SELECT role FROM members WHERE workspace_id=? AND user_id=?').get(ws.id,context.actorUserId):null;
    if(!member||!['owner','admin'].includes(member.role))fail('BOT_FORCE_ABANDON_USER_REQUIRED','需要当前工作区真实所有者或管理员授权',403);
    const employee=repo.listEmployees(slug,{actorUserId:context.actorUserId,actorRole:member.role,enforceEmployeeVisibility:true}).find(item=>item.id===employeeId&&item.status!=='deleted');
    if(!employee)fail('EMPLOYEE_NOT_FOUND','员工不可见或不存在',404);
    return{ws,employee,actorUserId:context.actorUserId,actorRole:member.role};
  }
  function device(actionId,credential){
    if(!text(credential?.credentialId)||!text(credential?.deviceId)||!text(credential?.workspaceId)||!text(credential?.workspace))fail('BOT_FORCE_ABANDON_DEVICE_REQUIRED','需要原电脑的有效配对凭证',401);
    const g=db.prepare('SELECT c.*,d.status,d.client_build,d.pid,d.heartbeat_at,d.last_seen,w.slug FROM device_credentials c JOIN devices d ON d.id=c.device_id AND d.workspace_id=c.workspace_id JOIN workspaces w ON w.id=c.workspace_id WHERE c.id=?').get(credential.credentialId);
    if(!g||g.revoked_at||g.status==='disabled'||g.device_id!==credential.deviceId||g.workspace_id!==credential.workspaceId||g.slug!==credential.workspace)fail('BOT_FORCE_ABANDON_DEVICE_REQUIRED','原设备凭证无效',401);
    const p=POLICY.subject;if(actionId!==p.actionId||g.device_id!==p.deviceId||g.workspace_id!==p.workspaceId||g.slug!==p.workspace)fail('BOT_FORCE_ABANDON_BINDING_CONFLICT','不属于指定原动作或原电脑',403);
    return{...rawOriginal(actionId),credential:g};
  }
  function controlled(checked){
    const {row,snapshot}=checked,employee=db.prepare('SELECT * FROM employees WHERE id=? AND workspace_id=?').get(POLICY.subject.employeeId,row.workspace_id),bot=db.prepare('SELECT * FROM hermes_bots WHERE employee_id=? AND workspace_id=?').get(POLICY.subject.employeeId,row.workspace_id),p=POLICY.subject;
    if(!employee||!bot||employee.status!=='paused'||bot.control_state!=='paused'||bot.revision!==p.currentRevision||bot.control_epoch!==p.currentControlEpoch||bot.active_action_id!==row.id)fail('BOT_FORCE_ABANDON_CONTROL_CONFLICT','仅允许原 r3/e8 已暂停且仍占用指定旧动作的 Bot');
    if(employee.runtime!=='Hermes'||employee.runtime_profile!==p.profile||employee.target_device_id!==p.deviceId||!same(botProfileBinding(bot),snapshot.instance))fail('BOT_FORCE_ABANDON_BINDING_CONFLICT','员工设备或 Profile 所有权已变化');
    return{employee,bot};
  }
  function prior(checked){
    const marker=db.prepare('SELECT 1 FROM management_requests WHERE workspace_id=? AND kind=? AND request_key=?').get(checked.row.workspace_id,REQUEST_KIND,checked.row.id);if(!marker)return null;
    const receipt=readForceAbandonRecovery(db,checked.row);if(!receipt||receipt.subject.credentialId!==checked.credential.id)fail('BOT_FORCE_ABANDON_RECOVERY_CONFLICT','既有人工放弃记录未通过完整证据校验');return receipt;
  }
  function grantFor(checked){
    const grant=readGrant(db,checked.row);if(!grant){if(db.prepare('SELECT 1 FROM management_requests WHERE workspace_id=? AND kind=? AND request_key=?').get(checked.row.workspace_id,GRANT_KIND,checked.row.id))fail('BOT_FORCE_ABANDON_GRANT_INVALID','原人工授权记录已变化');return null;}
    scope(grant.workspace,grant.employeeId,{actorUserId:grant.actorUserId});return grant;
  }
  function status(slug,employeeId,context={}){
    scope(slug,employeeId,context);const p=POLICY.subject;
    if(slug!==p.workspace||employeeId!==p.employeeId)return{eligible:false,state:'available'};
    const checked=rawOriginal(p.actionId),receipt=readForceAbandonRecovery(db,checked.row);
    if(receipt)return{eligible:false,state:'completed',grantId:receipt.grantId,receipt};
    if(db.prepare('SELECT 1 FROM management_requests WHERE workspace_id=? AND kind=? AND request_key=?').get(p.workspaceId,REQUEST_KIND,p.actionId))fail('BOT_FORCE_ABANDON_RECOVERY_CONFLICT','既有人工放弃记录无效');
    const grant=readGrant(db,checked.row);let eligible=false;try{controlled(checked);eligible=true;}catch{}
    return{eligible,state:grant?'requested':'available',...(grant?{grantId:grant.id}:{})};
  }
  function authorize(slug,employeeId,input={},context={}){return atomic(()=>{
    const actor=scope(slug,employeeId,context),p=POLICY.subject;
    if(!exact(input,['expectedActionId','expectedRevision','expectedControlEpoch','acknowledgeUncertain','idempotencyKey'])||input.expectedActionId!==p.actionId||input.expectedRevision!==p.currentRevision||input.expectedControlEpoch!==p.currentControlEpoch||input.acknowledgeUncertain!==true||!text(input.idempotencyKey)||slug!==p.workspace||employeeId!==p.employeeId)fail('BOT_FORCE_ABANDON_INPUT_INVALID','必须明确确认原动作结果未知并提交精确控制版本',400);
    const checked=rawOriginal(input.expectedActionId),fingerprint=digest({actorUserId:actor.actorUserId,input}),key=`${actor.actorUserId}:${input.idempotencyKey}`,idem=db.prepare('SELECT * FROM management_requests WHERE workspace_id=? AND kind=? AND request_key=?').get(actor.ws.id,IDEMPOTENCY_KIND,key);
    if(idem){if(idem.fingerprint!==fingerprint||!readGrant(db,checked.row))fail('BOT_FORCE_ABANDON_IDEMPOTENCY_CONFLICT','请求标识或原人工授权记录不一致');return status(slug,employeeId,context);}
    if(readGrant(db,checked.row))fail('BOT_FORCE_ABANDON_ALREADY_REQUESTED','此动作已经取得人工放弃授权');
    controlled(checked);admission(checked.row.id);
    const requestedAt=new Date(now()).toISOString(),grant={schemaVersion:1,id:`action-event_force-grant_${crypto.randomUUID()}`,actionId:p.actionId,workspace:p.workspace,workspaceId:p.workspaceId,deviceId:p.deviceId,employeeId:p.employeeId,profile:p.profile,actorUserId:actor.actorUserId,actorRole:actor.actorRole,expectedRevision:p.currentRevision,expectedControlEpoch:p.currentControlEpoch,acknowledgeUncertain:true,originalActionSha256:bytesDigest(canonical(checked.row)),idempotencyKey:input.idempotencyKey,requestedAt};
    db.prepare('INSERT INTO a2a_action_events(id,action_id,type,message,data_json,created_at) VALUES(?,?,?,?,?,?)').run(grant.id,p.actionId,GRANT_EVENT,'用户明确授权人工放弃旧任务；原执行结果仍未知，尚未解除占用',JSON.stringify(grant),requestedAt);
    for(const [kind,requestKey,fp]of [[GRANT_KIND,p.actionId,digest(grant)],[IDEMPOTENCY_KIND,key,fingerprint]])db.prepare('INSERT INTO management_requests(workspace_id,kind,request_key,fingerprint,resource_id,created_at) VALUES(?,?,?,?,?,?)').run(p.workspaceId,kind,requestKey,fp,grant.id,requestedAt);
    return{eligible:true,state:'requested',grantId:grant.id};
  });}
  function subjectFor(checked,grant,holder,{freshHeartbeat=true,absence,installation}={}){
    controlled(checked);const {row,payload,snapshot,event,credential}=checked;
    const absent=installation!==undefined;
    if(absent){
      if(!validateForceAbandonInstallation(installation)||!validateForceAbandonAbsence(absence)||freshHeartbeat&&(Date.parse(absence.checkedAt)>now()||now()-Date.parse(absence.checkedAt)>TTL))fail('BOT_FORCE_ABANDON_ABSENCE_REQUIRED','需要本机当前无守护进程、无监听及连接拒绝的独立观察');
      if(credential.client_build!==ABSENT_POLICY.installationBuild)fail('BOT_FORCE_ABANDON_HOLDER_CONFLICT','原电脑最后上报版本与固定当前安装不一致');
    }else{
      if(!validateForceAbandonHolder(holder))fail('BOT_FORCE_ABANDON_HOLDER_REQUIRED','必须提交本机实测当前维护进程身份');
      if(credential.client_build!==POLICY.holderBuild||credential.pid!==holder.pid||Date.parse(holder.creationTime)>now()||freshHeartbeat&&(!Number.isFinite(Date.parse(credential.heartbeat_at||credential.last_seen))||now()-Date.parse(credential.heartbeat_at||credential.last_seen)>180_000))fail('BOT_FORCE_ABANDON_HOLDER_CONFLICT','当前维护进程与原电脑实际心跳版本或 PID 不一致');
    }
    const s={schemaVersion:absent?2:1,...(absent?{mode:ABSENT_POLICY.mode}:{}),actionId:row.id,actionType:row.type,workspace:POLICY.subject.workspace,workspaceId:row.workspace_id,deviceId:credential.device_id,employeeId:payload.employeeId,credentialId:credential.id,profile:payload.profile,profileBinding:snapshot.instance,profileBindingDigest:digest(snapshot.instance),dedupeKey:row.dedupe_key,createdAt:row.created_at,ackedAt:row.acked_at,completedAt:row.completed_at,originalRevision:snapshot.revision,originalControlEpoch:snapshot.controlEpoch,currentRevision:POLICY.subject.currentRevision,currentControlEpoch:POLICY.subject.currentControlEpoch,currentControlState:'paused',currentEmployeeStatus:'paused',originalActionSha256:bytesDigest(canonical(row)),originalPayloadSha256:bytesDigest(row.payload_json),originalDeliveredPayloadDigest:digest(deliveredPayload(payload)),originalResultSha256:bytesDigest(row.result_json),originalResultDigest:digest(checked.result),originalError:row.error,failedEvent:{id:event.id,type:event.type,createdAt:event.created_at,dataSha256:bytesDigest(event.data_json)},grantId:grant.id,grantDigest:digest(grant),...(absent?{installation,initialAbsence:absence,serverHeartbeat:{clientBuild:credential.client_build,pid:credential.pid??null,lastSeen:credential.last_seen??null,heartbeatAt:credential.heartbeat_at??null}}:{holderBuild:credential.client_build,holder})};
    if(!forceAbandonSubjectAllowed(s))fail('BOT_FORCE_ABANDON_SUBJECT_INVALID','人工放弃绑定未通过固定策略');return s;
  }
  function signed(payload){const key=readA2AToken();if(typeof key!=='string'||key.length<16)fail('BOT_FORCE_ABANDON_SIGNING_UNAVAILABLE','维护挑战签名不可用',503);const data=Buffer.from(canonical(payload)).toString('base64url');return`${data}.${crypto.createHmac('sha256',key).update(`ziwei-operator-force-abandon-v${payload.schemaVersion}\0`+data).digest('base64url')}`;}
  function verified(challenge,expired=false){
    if(typeof challenge!=='string'||challenge.length>25000||!/^[-_A-Za-z0-9]+\.[-_A-Za-z0-9]{43}$/.test(challenge))fail('BOT_FORCE_ABANDON_CHALLENGE_INVALID','维护挑战无效',400);
    const data=challenge.split('.')[0],c=parse(Buffer.from(data,'base64url').toString('utf8'));
    const absent=c?.schemaVersion===2;
    if(!exact(c,['schemaVersion',...(absent?['mode']:[]),'kind','policyDigest','issuedAt','expiresAt','nonce','subject','subjectDigest'])||![1,2].includes(c.schemaVersion)||absent&&c.mode!==ABSENT_POLICY.mode||c.kind!==KIND||c.policyDigest!==(absent?ABSENT_DIGEST:POLICY_DIGEST)||!hex(c.nonce)||c.subject?.schemaVersion!==c.schemaVersion||!forceAbandonSubjectAllowed(c.subject)||c.subjectDigest!==digest(c.subject)||!Number.isSafeInteger(c.issuedAt)||!Number.isSafeInteger(c.expiresAt)||c.expiresAt-c.issuedAt!==TTL||c.issuedAt>now())fail('BOT_FORCE_ABANDON_CHALLENGE_INVALID','维护挑战内容无效',400);
    const expected=signed(c),left=Buffer.from(challenge),right=Buffer.from(expected);if(left.length!==right.length||!crypto.timingSafeEqual(left,right))fail('BOT_FORCE_ABANDON_CHALLENGE_INVALID','维护挑战签名不一致',403);
    if(!expired&&c.expiresAt<=now())fail('BOT_FORCE_ABANDON_CHALLENGE_EXPIRED','维护挑战已到期');return c;
  }
  function prepare(actionId,credential,input={}){return atomic(()=>{
    const absent=input?.mode===ABSENT_POLICY.mode;
    if(!exact(input,absent?['mode','installation','absence']:['holder']))fail('BOT_FORCE_ABANDON_INPUT_INVALID','维护准备仅接受独立当前持有者或无持有者观察',400);
    const checked=device(actionId,credential),receipt=prior(checked);if(receipt)return{applicable:true,completed:true,receipt};
    const grant=grantFor(checked);if(!grant)return{applicable:false};admission(actionId);
    const subject=subjectFor(checked,grant,input.holder,absent?{installation:input.installation,absence:input.absence}:{}),issuedAt=now(),claim={schemaVersion:absent?2:1,...(absent?{mode:ABSENT_POLICY.mode}:{}),kind:KIND,policyDigest:absent?ABSENT_DIGEST:POLICY_DIGEST,issuedAt,expiresAt:issuedAt+TTL,nonce:crypto.randomBytes(32).toString('hex'),subject,subjectDigest:digest(subject)};
    return{applicable:true,completed:false,challenge:signed(claim),subject,subjectDigest:claim.subjectDigest,policy:absent?ABSENT_POLICY:POLICY,policyDigest:claim.policyDigest,expiresAt:new Date(claim.expiresAt).toISOString()};
  });}
  function commit(actionId,credential,input={}){return atomic(()=>{
    if(!exact(input,['challenge','evidence']))fail('BOT_FORCE_ABANDON_INPUT_INVALID','维护提交只接受挑战和独立证据',400);
    const checked=device(actionId,credential),previous=prior(checked),claim=verified(input.challenge,true);
    if(claim.subject.actionId!==actionId||claim.subject.credentialId!==checked.credential.id||claim.subject.deviceId!==checked.credential.device_id)fail('BOT_FORCE_ABANDON_BINDING_CONFLICT','挑战与实际设备身份不一致',403);
    const absent=claim.schemaVersion===2;
    if(input.evidence?.schemaVersion!==claim.schemaVersion||!validateForceAbandonEvidence(input.evidence,claim.subject,{recordedAt:now()}))fail('BOT_FORCE_ABANDON_EVIDENCE_INVALID','当前维护进程退出、无持有者观察或本地归档证据不匹配');
    // A persisted stop receipt may arrive after a network outage. It can only
    // finish the original signed window, never authorize a later stop or holder.
    const observedAt=Date.parse(absent?input.evidence.currentDaemonAbsence.checkedAt:input.evidence.currentDaemonExit.exitedAt);
    if(observedAt<claim.issuedAt||observedAt>claim.expiresAt||absent&&!previous&&claim.expiresAt<=now())fail('BOT_FORCE_ABANDON_CHALLENGE_EXPIRED','当前停止或无持有者观察必须在原挑战有效期内完成');
    const evidenceDigest=digest(input.evidence);
    if(previous){if(previous.evidenceDigest!==evidenceDigest||previous.subjectDigest!==claim.subjectDigest)fail('BOT_FORCE_ABANDON_IDEMPOTENCY_CONFLICT','原人工放弃已使用不同证据完成');return{receipt:previous};}
    admission(actionId);const grant=grantFor(checked);if(!grant)fail('BOT_FORCE_ABANDON_GRANT_REQUIRED','缺少真实用户人工授权');
    const subject=subjectFor(checked,grant,claim.subject.holder,{freshHeartbeat:false,...(absent?{installation:claim.subject.installation,absence:claim.subject.initialAbsence}:{})});if(!same(subject,claim.subject))fail('BOT_FORCE_ABANDON_SUBJECT_CHANGED','准备后原证据、授权、设备或控制状态已变化');
    const recordedAt=new Date(now()).toISOString(),receipt={schemaVersion:absent?2:1,...(absent?{mode:ABSENT_POLICY.mode}:{}),kind:KIND,id:digest({actionId,subjectDigest:claim.subjectDigest,evidenceDigest}),policy:absent?ABSENT_POLICY.id:POLICY.id,policyDigest:absent?ABSENT_DIGEST:POLICY_DIGEST,subject,subjectDigest:claim.subjectDigest,grantId:grant.id,grantDigest:digest(grant),evidenceDigest,localArchiveDigest:digest(input.evidence.localArchive),...(absent?{currentDaemonAbsence:input.evidence.currentDaemonAbsence}:{currentDaemonExit:input.evidence.currentDaemonExit}),resultingControlEpoch:subject.currentControlEpoch+1,executionState:'uncertain',disposition:'abandoned_by_user',executionConfirmedStopped:false,partialEffectsPossible:true,recordedAt};
    if(!validateForceAbandonReceipt(receipt,{actionId}))fail('BOT_FORCE_ABANDON_RECEIPT_INVALID','独立人工放弃回执无效');
    const changed=db.prepare("UPDATE hermes_bots SET active_action_id=NULL,control_epoch=control_epoch+1,updated_at=? WHERE employee_id=? AND workspace_id=? AND active_action_id=? AND revision=? AND control_epoch=? AND control_state='paused' AND ziwei_v2_admitted(?)=1").run(recordedAt,subject.employeeId,subject.workspaceId,actionId,subject.currentRevision,subject.currentControlEpoch,actionId);
    if(changed.changes!==1)fail('BOT_FORCE_ABANDON_CONTROL_CONFLICT','占用或控制版本发生并发变化');
    const eventId=`action-event_${receipt.id}`;
    db.prepare('INSERT INTO a2a_action_events(id,action_id,type,message,data_json,created_at) VALUES(?,?,?,?,?,?)').run(eventId,actionId,KIND,'已人工放弃，原执行结果仍未知；仅解除指定旧任务占用，保持暂停',JSON.stringify({receipt,evidence:input.evidence}),recordedAt);
    db.prepare('INSERT INTO management_requests(workspace_id,kind,request_key,fingerprint,resource_id,created_at) VALUES(?,?,?,?,?,?)').run(subject.workspaceId,REQUEST_KIND,actionId,evidenceDigest,eventId,recordedAt);
    return{receipt};
  });}
  return{status,authorize,prepare,commit};
}
