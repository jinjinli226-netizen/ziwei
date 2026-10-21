import {botFailure} from '../src/hermes-bot-config.mjs';
import {botProfileBinding} from './bot-profiles.mjs';
import {botExecutionOccupiesSlot} from './bot-execution-occupancy.mjs';
import {FAILURE_FINALIZATION_KIND as KIND,canonicalFinalizationValue as canonical,finalizationDigest as digest,finalizationBytesDigest as bytesDigest,validateFailureFinalizationReceipt,validateFailureFinalizationAck} from '../src/bot-failure-finalization-contract.mjs';

const REQUEST_KIND='bot-failure-finalization-v1',IDEMPOTENCY_KIND='bot-failure-finalization-request-v1',ACK_KIND='bot-failure-finalization-ack-v1',ACK_EVENT='bot.failed_execution_finalization_archived';
const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
const fail=(code,message,status=409)=>{throw botFailure(code,message,status);};
const text=value=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\0\r\n]/.test(value);
const uncertain=value=>{const seen=new Set();while(value&&typeof value==='object'){if(seen.has(value)||seen.size>100)return true;if(value.code==='EXECUTION_UNCERTAIN'||value.executionState==='uncertain')return true;seen.add(value);value=value.result;}return false;};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const atomic=(db,fn)=>{db.exec('SAVEPOINT bot_failure_finalization');try{const result=fn();db.exec('RELEASE bot_failure_finalization');return result;}catch(error){db.exec('ROLLBACK TO bot_failure_finalization; RELEASE bot_failure_finalization');throw error;}};
function rawSubject(db,row){
  if(!row)return null;
  const payload=parse(row?.payload_json),snapshot=payload?.hermesBot,result=parse(row?.result_json),workspace=db.prepare('SELECT slug FROM workspaces WHERE id=?').get(row?.workspace_id);
  if(!row||row.status!=='failed'||row.agent_id!=='ziwei_user'||!row.acked_at||!row.completed_at||!uncertain(result)||payload?.runtime!=='Hermes'||!snapshot||snapshot.schemaVersion!==1||snapshot.workspace!==workspace?.slug||snapshot.employeeId!==payload.employeeId||snapshot.deviceId!==payload.deviceId||snapshot.sourceProfile!==payload.profile||!Number.isSafeInteger(snapshot.revision)||!Number.isSafeInteger(snapshot.controlEpoch))return null;
  const event=db.prepare("SELECT id,data_json FROM a2a_action_events WHERE action_id=? AND type='failed' ORDER BY created_at,id LIMIT 1").get(row.id);
  return{actionId:row.id,actionType:row.type,workspace:workspace.slug,workspaceId:row.workspace_id,deviceId:payload.deviceId,employeeId:payload.employeeId,profile:payload.profile,dedupeKey:row.dedupe_key??null,originalRevision:snapshot.revision,originalControlEpoch:snapshot.controlEpoch,profileBindingDigest:digest(snapshot.instance??null),originalPayloadDigest:digest(payload),originalResultDigest:digest(result),originalActionSha256:bytesDigest(canonical(row)),failedEvent:event?{id:event.id,dataSha256:bytesDigest(event.data_json)}:null};
}
export function readBotFailureFinalization(db,row){
  try{
    if(!row)return null;
    const marker=db.prepare('SELECT * FROM management_requests WHERE workspace_id=? AND kind=? AND request_key=?').get(row.workspace_id,REQUEST_KIND,row.id);if(!marker)return null;
    const event=db.prepare('SELECT * FROM a2a_action_events WHERE id=? AND action_id=? AND type=?').get(marker.resource_id,row.id,KIND),receipt=parse(event?.data_json);
    if(!validateFailureFinalizationReceipt(receipt,{actionId:row.id,workspaceId:row.workspace_id})||event.id!==`action-event_${receipt.id}`||event.created_at!==receipt.recordedAt||marker.fingerprint!==digest(receipt)||marker.created_at!==receipt.recordedAt)return null;
    const subject=rawSubject(db,row);if(!subject)return null;
    // A failed event may arrive after the terminal result and automatic intent.
    // The pinned result and raw action remain exact; an event captured at creation
    // must also remain byte-for-byte unchanged.
    if(canonical({...subject,failedEvent:receipt.subject.failedEvent})!==canonical(receipt.subject))return null;
    if(receipt.subject.failedEvent){const failed=db.prepare("SELECT data_json FROM a2a_action_events WHERE id=? AND action_id=? AND type='failed'").get(receipt.subject.failedEvent.id,row.id);if(!failed||bytesDigest(failed.data_json)!==receipt.subject.failedEvent.dataSha256)return null;}
    const ackMarker=db.prepare('SELECT * FROM management_requests WHERE workspace_id=? AND kind=? AND request_key=?').get(row.workspace_id,ACK_KIND,row.id);
    let acknowledgement=null;
    if(ackMarker){
      const archived=db.prepare('SELECT * FROM a2a_action_events WHERE id=? AND action_id=? AND type=?').get(ackMarker.resource_id,row.id,ACK_EVENT),value=parse(archived?.data_json);
      if(!exact(value,['ack','deviceId','credentialId','recordedAt'])||!validateFailureFinalizationAck(value.ack,receipt)||value.deviceId!==subject.deviceId||!text(value.credentialId)||archived.created_at!==value.recordedAt||ackMarker.fingerprint!==digest(value)||ackMarker.created_at!==value.recordedAt)return null;
      acknowledgement=value;
    }
    return{receipt,receiptDigest:digest(receipt),state:acknowledgement?'client_archived':'awaiting_client',...(acknowledgement?{acknowledgement}:{})};
  }catch{return null;}
}
export function pendingBotFailureFinalization(db,workspaceId,employeeId){
  const rows=db.prepare("SELECT a.* FROM management_requests m JOIN a2a_actions a ON a.id=m.request_key AND a.workspace_id=m.workspace_id WHERE m.workspace_id=? AND m.kind=? AND json_extract(CASE WHEN json_valid(a.payload_json) THEN a.payload_json ELSE '{}' END,'$.employeeId')=? ORDER BY m.created_at DESC").all(workspaceId,REQUEST_KIND,employeeId);
  for(const row of rows){const value=readBotFailureFinalization(db,row);if(!value)fail('BOT_FAILURE_FINALIZATION_CONFLICT','执行收尾记录与原失败回执不一致，请刷新状态');if(value.state==='awaiting_client')return value;}
  return null;
}
function writeDisposition(repo,row,{actorUserId,actorRole,expectedRevision,expectedControlEpoch,disposition,now=Date.now}){
  const db=repo.db,subject=rawSubject(db,row);if(!subject)fail('BOT_FAILURE_FINALIZATION_INELIGIBLE','只允许结束已经失败且结果未确认的原执行');
  const bot=db.prepare('SELECT * FROM hermes_bots WHERE employee_id=? AND workspace_id=?').get(subject.employeeId,subject.workspaceId),employee=db.prepare('SELECT * FROM employees WHERE id=? AND workspace_id=?').get(subject.employeeId,subject.workspaceId);
  if(!bot||!employee||employee.status==='deleted'||employee.runtime!=='Hermes'||employee.target_device_id!==subject.deviceId||employee.runtime_profile!==subject.profile||digest(botProfileBinding(bot))!==subject.profileBindingDigest)fail('BOT_FAILURE_FINALIZATION_BINDING_CONFLICT','原失败执行的员工、电脑或 Profile 已变化');
  if(bot.active_action_id!==row.id||bot.revision!==expectedRevision||bot.control_epoch!==expectedControlEpoch)fail('BOT_FAILURE_FINALIZATION_CONTROL_CONFLICT','只允许结束当前占用的原失败执行；版本或控制状态已变化');
  repo.preservation?.assertAction(row.id);repo.serverCodeRollout?.assertExecution();
  const body={schemaVersion:1,kind:KIND,subject,actorUserId,actorRole,expectedRevision,expectedControlEpoch,resultingControlEpoch:expectedControlEpoch+1,disposition,status:'failed',executionState:'uncertain',executionConfirmedStopped:false,partialEffectsPossible:true,recordedAt:new Date(now()).toISOString()},receipt={...body,id:digest(body)};
  if(!validateFailureFinalizationReceipt(receipt))fail('BOT_FAILURE_FINALIZATION_INVALID','执行收尾合同校验失败');
  const changed=db.prepare('UPDATE hermes_bots SET active_action_id=NULL,control_epoch=control_epoch+1,updated_at=? WHERE employee_id=? AND workspace_id=? AND active_action_id=? AND revision=? AND control_epoch=? AND ziwei_v2_admitted(?)=1').run(body.recordedAt,subject.employeeId,subject.workspaceId,row.id,expectedRevision,expectedControlEpoch,row.id);
  if(changed.changes!==1)fail('BOT_FAILURE_FINALIZATION_CONTROL_CONFLICT','执行收尾时原占位发生并发变化');
  const eventId=`action-event_${receipt.id}`;
  db.prepare('INSERT INTO a2a_action_events(id,action_id,type,message,data_json,created_at) VALUES(?,?,?,?,?,?)').run(eventId,row.id,KIND,'本轮按失败结束；原执行和业务结果保持未确认，不自动重跑',JSON.stringify(receipt),body.recordedAt);
  db.prepare('INSERT INTO management_requests(workspace_id,kind,request_key,fingerprint,resource_id,created_at) VALUES(?,?,?,?,?,?)').run(row.workspace_id,REQUEST_KIND,row.id,digest(receipt),eventId,body.recordedAt);
  // Operational failure is terminal even when its original business receipt is
  // ambiguous. Keep that receipt/error intact; no retry or webhook is scheduled.
  db.prepare("UPDATE automation_runs SET status='failed',message='本轮已按失败结束，原业务结果保留；没有自动重跑',finished_at=COALESCE(finished_at,?) WHERE workspace_id=? AND action_id=? AND status='uncertain'").run(body.recordedAt,row.workspace_id,row.id);
  return readBotFailureFinalization(db,row);
}
// Called only after the authenticated original device result has been saved.
// A genuinely ambiguous result is retained; the paired client handles cleanup.
export function automaticallyFinalizeBotFailure(repo,actionId){return atomic(repo.db,()=>{
  const db=repo.db,row=db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(actionId),subject=rawSubject(db,row);if(!subject||!botExecutionOccupiesSlot(row,{workspaceId:row.workspace_id,employeeId:subject.employeeId,deviceId:subject.deviceId,profile:subject.profile}))return null;
  const existing=db.prepare('SELECT 1 FROM management_requests WHERE workspace_id=? AND kind=? AND request_key=?').get(row.workspace_id,REQUEST_KIND,row.id);if(existing)return readBotFailureFinalization(db,row);
  const bot=db.prepare('SELECT revision,control_epoch,active_action_id FROM hermes_bots WHERE employee_id=? AND workspace_id=?').get(subject.employeeId,subject.workspaceId);if(bot?.active_action_id!==row.id)return null;
  return writeDisposition(repo,row,{actorUserId:null,actorRole:'system',expectedRevision:bot.revision,expectedControlEpoch:bot.control_epoch,disposition:'failed_automatically'});
});}
export function createBotFailureFinalization(repo,management,{now=Date.now}={}){
  const db=repo.db;
  function owner(slug,id,context){
    const ws=db.prepare('SELECT * FROM workspaces WHERE slug=?').get(slug),membership=ws&&text(context?.actorUserId)?db.prepare('SELECT role FROM members WHERE workspace_id=? AND user_id=?').get(ws.id,context.actorUserId):null;
    if(!ws||!membership||!['owner','admin'].includes(membership.role))fail('BOT_FAILURE_FINALIZATION_USER_REQUIRED','结束失败执行需要当前工作区的管理员身份',403);
    const employee=management.employee(slug,id,{...context,actorRole:membership.role}),bot=db.prepare('SELECT * FROM hermes_bots WHERE employee_id=? AND workspace_id=?').get(id,ws.id);
    if(!bot||employee.status==='deleted')fail('BOT_NOT_FOUND','Bot 不存在',404);
    return{ws,employee,bot,role:membership.role};
  }
  function device(credential){
    if(!text(credential?.credentialId)||!text(credential?.deviceId)||!text(credential?.workspaceId)||!text(credential?.workspace))fail('BOT_FAILURE_FINALIZATION_DEVICE_REQUIRED','收尾需要原电脑的有效配对凭证',401);
    const actual=db.prepare('SELECT c.id,c.device_id,c.workspace_id,c.revoked_at,d.status,w.slug FROM device_credentials c JOIN devices d ON d.id=c.device_id AND d.workspace_id=c.workspace_id JOIN workspaces w ON w.id=c.workspace_id WHERE c.id=?').get(credential.credentialId);
    if(!actual||actual.revoked_at||actual.status==='disabled'||actual.device_id!==credential.deviceId||actual.workspace_id!==credential.workspaceId||actual.slug!==credential.workspace)fail('BOT_FAILURE_FINALIZATION_DEVICE_REQUIRED','原电脑配对凭证已失效',401);
    return actual;
  }
  function forDevice(actionId,credential){
    const granted=device(credential),row=db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(actionId);if(!row)fail('ACTION_NOT_FOUND','原执行不存在',404);
    const payload=parse(row.payload_json);
    if(row.workspace_id!==granted.workspace_id||payload?.deviceId!==granted.device_id)fail('BOT_FAILURE_FINALIZATION_DEVICE_SCOPE','收尾不属于当前电脑',403);
    const value=readBotFailureFinalization(db,row);if(!value)fail('BOT_FAILURE_FINALIZATION_NOT_FOUND','该执行没有可用的收尾授权',404);
    return{granted,row,value};
  }
  return{
    status(slug,id,context){const{ws,bot}=owner(slug,id,context);const row=bot.active_action_id?db.prepare('SELECT * FROM a2a_actions WHERE id=? AND workspace_id=?').get(bot.active_action_id,ws.id):null;return pendingBotFailureFinalization(db,ws.id,id)||{eligible:Boolean(rawSubject(db,row)),state:'available',...(row?{actionId:row.id}:{})};},
    finalize(slug,id,input={},context={}){return atomic(db,()=>{
      const {ws,bot,role}=owner(slug,id,context);
      if(!exact(input,['expectedActionId','expectedRevision','expectedControlEpoch','acknowledgeUncertain','idempotencyKey'])||!text(input.expectedActionId)||!Number.isSafeInteger(input.expectedRevision)||!Number.isSafeInteger(input.expectedControlEpoch)||input.acknowledgeUncertain!==true||!text(input.idempotencyKey))fail('BOT_FAILURE_FINALIZATION_INPUT_INVALID','请提交精确原执行、版本和稳定请求标识',400);
      const key=`${context.actorUserId}:${input.idempotencyKey}`,fingerprint=digest(input),old=db.prepare('SELECT * FROM management_requests WHERE workspace_id=? AND kind=? AND request_key=?').get(ws.id,IDEMPOTENCY_KIND,key);
      if(old){if(old.fingerprint!==fingerprint||old.resource_id!==input.expectedActionId)fail('IDEMPOTENCY_CONFLICT','同一请求标识已用于其他参数');const row=db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(old.resource_id),value=readBotFailureFinalization(db,row);if(!value)fail('BOT_FAILURE_FINALIZATION_CONFLICT','原执行收尾记录已变化');return{...value,duplicate:true};}
      const row=db.prepare('SELECT * FROM a2a_actions WHERE id=? AND workspace_id=?').get(input.expectedActionId,ws.id),subject=rawSubject(db,row);
      if(subject?.employeeId!==id)fail('BOT_FAILURE_FINALIZATION_INELIGIBLE','原失败执行不属于此 Bot');
      const existing=readBotFailureFinalization(db,row);
      const value=existing||writeDisposition(repo,row,{actorUserId:context.actorUserId,actorRole:role,expectedRevision:input.expectedRevision,expectedControlEpoch:input.expectedControlEpoch,disposition:'abandoned_by_user',now});
      if(existing&&(existing.receipt.expectedRevision!==input.expectedRevision||existing.receipt.expectedControlEpoch!==input.expectedControlEpoch))fail('BOT_FAILURE_FINALIZATION_CONTROL_CONFLICT','原执行已按其他控制版本结束');
      db.prepare('INSERT INTO management_requests(workspace_id,kind,request_key,fingerprint,resource_id,created_at) VALUES(?,?,?,?,?,?)').run(ws.id,IDEMPOTENCY_KIND,key,fingerprint,row.id,new Date(now()).toISOString());
      return value;
    });},
    pending(credential,query={}){const granted=device(credential);if(query.workspace!==undefined&&query.workspace!==granted.slug||query.deviceId!==undefined&&query.deviceId!==granted.device_id)fail('BOT_FAILURE_FINALIZATION_DEVICE_SCOPE','收尾查询不属于当前电脑',403);
      const rows=db.prepare('SELECT a.* FROM management_requests m JOIN a2a_actions a ON a.id=m.request_key AND a.workspace_id=m.workspace_id WHERE m.workspace_id=? AND m.kind=? AND NOT EXISTS(SELECT 1 FROM management_requests ack WHERE ack.workspace_id=m.workspace_id AND ack.request_key=m.request_key AND ack.kind=?) AND json_extract(CASE WHEN json_valid(a.payload_json) THEN a.payload_json ELSE \'{}\' END,\'$.deviceId\')=? ORDER BY m.created_at LIMIT 100').all(granted.workspace_id,REQUEST_KIND,ACK_KIND,granted.device_id);
      return{finalizations:rows.map(row=>forDevice(row.id,credential).value)};
    },
    read(actionId,credential){return forDevice(actionId,credential).value;},
    acknowledge(actionId,credential,input={}){return atomic(db,()=>{
      const {granted,row,value}=forDevice(actionId,credential);
      if(!validateFailureFinalizationAck(input,value.receipt))fail('BOT_FAILURE_FINALIZATION_ACK_INVALID','收尾确认与原授权或本地归档不匹配',400);
      if(value.acknowledgement){if(canonical(value.acknowledgement.ack)!==canonical(input))fail('BOT_FAILURE_FINALIZATION_ACK_CONFLICT','原执行已提交不同的归档确认');return{...value,duplicate:true};}
      repo.preservation?.assertAction(row.id);repo.serverCodeRollout?.assertExecution();
      const recordedAt=new Date(now()).toISOString(),record={ack:input,deviceId:granted.device_id,credentialId:granted.id,recordedAt},eventId=`action-event_finalized_${digest(record)}`;
      db.prepare('INSERT INTO a2a_action_events(id,action_id,type,message,data_json,created_at) VALUES(?,?,?,?,?,?)').run(eventId,row.id,ACK_EVENT,'原电脑已归档本轮失败；未重放业务，原业务结果仍以原回执为准',JSON.stringify(record),recordedAt);
      db.prepare('INSERT INTO management_requests(workspace_id,kind,request_key,fingerprint,resource_id,created_at) VALUES(?,?,?,?,?,?)').run(row.workspace_id,ACK_KIND,row.id,digest(record),eventId,recordedAt);
      return readBotFailureFinalization(db,row);
    });},
  };
}
