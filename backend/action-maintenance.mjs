import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {executionBinding} from '../src/execution-admission.mjs';
import {validateMaintenancePause} from '../src/maintenance-checkpoint.mjs';

const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
const HASH=/^[a-f0-9]{64}$/;
const equalSecret=(a,b)=>typeof a==='string'&&typeof b==='string'&&HASH.test(a)&&HASH.test(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const fail=(code,status=409)=>{throw Object.assign(new Error(code),{code,status});};
const need=(value,code,status)=>{if(!value)fail(code,status);};
const CHECKPOINT='maintenance.checkpoint',RESUME='maintenance.resume';
const EMPLOYEE_CONFIG_ACTION_SQL="('employee.updated','employee.deleted','employee.purged','employee.force_removed','employee.environment.created','employee.environment.updated','employee.environment.deleted','employee.custom_params.updated')";
// The dedicated checkpoint service reuses the original admission checks while
// evaluating a paused action. Wire callers only receive the fenced wrapper.
const admissionMethods=new WeakMap();
const terminalInputs=new WeakMap();
const maintenanceServices=new WeakMap();
const revocableCodes=new Set(['MAINTENANCE_AUTHORITY_REVOKED','MAINTENANCE_EMPLOYEE_CHANGED','MAINTENANCE_BOT_CHANGED','MAINTENANCE_CONVERSATION_CHANGED','MAINTENANCE_TASK_CHANGED','MAINTENANCE_CANCEL_REQUESTED','MAINTENANCE_CONFIGURATION_CHANGED','MAINTENANCE_BINDING_CHANGED','MAINTENANCE_UPDATE_FAILED','EMPLOYEE_DELETED','EMPLOYEE_PROFILE_DELETED','BOT_NOT_FOUND','BOT_REVISION_CONFLICT','BOT_NOT_ACTIVE','BOT_NOT_VALIDATED','BOT_BINDING_CONFLICT','BOT_PROFILE_NOT_PROVISIONED','BOT_CONVERSATION_CONFLICT','BOT_RUN_BINDING_CONFLICT','BOT_DEFERRED_CONFIG_BUSY']);

/** Called only after ACK's original assigned-device check, inside its txn. */
export function settleExpiredMaintenanceAction(repo,row,input){return(maintenanceServices.get(repo)||createActionMaintenanceService(repo)).settleExpired(row,input);}
export function guardMaintenanceExecutionAdmission(repo){
  if(admissionMethods.has(repo))return repo;
  const original=repo.authorizeActionExecution;
  admissionMethods.set(repo,original);
  repo.authorizeActionExecution=function(id,input={}){
    repo.db.exec('SAVEPOINT maintenance_execution_admission');
    try{
      const row=repo.db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(id);
      if(row)assertMaintenanceAttempt(repo.db,row,input);
      const result=original.call(this,id,input);
      repo.db.exec('RELEASE maintenance_execution_admission');return result;
    }catch(error){repo.db.exec('ROLLBACK TO maintenance_execution_admission; RELEASE maintenance_execution_admission');throw error;}
  };
  return repo;
}
const events=(db,id)=>db.prepare("SELECT rowid AS sequence,* FROM a2a_action_events WHERE action_id=? AND type IN ('maintenance.checkpoint','maintenance.resume') ORDER BY rowid").all(id).map(row=>({...row,data:parse(row.data_json)}));

function currentState(db,id){
  const rows=events(db,id),checkpoint=rows.findLast(row=>row.type===CHECKPOINT);
  if(!checkpoint)return null;
  need(checkpoint.data?.schemaVersion===1&&Number.isSafeInteger(checkpoint.data.generation)&&checkpoint.data.generation>0&&validateMaintenancePause(checkpoint.data.receipt,{actionId:id}),'MAINTENANCE_RECORD_INVALID');
  const resumed=rows.findLast(row=>row.type===RESUME&&row.sequence>checkpoint.sequence);
  if(resumed)need(resumed.data?.schemaVersion===1&&resumed.data.generation===checkpoint.data.generation&&HASH.test(resumed.data.token||'')&&resumed.data.checkpointEventId===checkpoint.id,'MAINTENANCE_RECORD_INVALID');
  return{checkpoint,resumed};
}

export function maintenanceActionDeadline(db,id){
  const row=events(db,id).find(event=>event.type===CHECKPOINT);
  if(!row)return null;
  need(typeof row.data?.expiresAt==='string'&&Number.isFinite(Date.parse(row.data.expiresAt)),'MAINTENANCE_RECORD_INVALID');
  return row.data.expiresAt;
}

export function maintenancePublicEventData(type,data){
  if(!String(type).startsWith('maintenance.'))return data;
  if(!data||typeof data!=='object')return data;
  const {token:_secret,...rest}=data;
  return rest;
}

function cancelRequested(db,row){
  return db.prepare("SELECT payload_json FROM a2a_actions WHERE workspace_id=? AND type IN ('action.cancel','agent.cancel')").all(row.workspace_id).some(item=>{const p=parse(item.payload_json);return(p?.actionId||p?.action_id)===row.id;});
}

function resumeStarted(db,id,state){return state.resumed&&db.prepare("SELECT 1 FROM a2a_action_events WHERE action_id=? AND rowid>? AND type='action.started' AND json_extract(data_json,'$.maintenanceGeneration')=?").get(id,state.resumed.sequence,state.checkpoint.data.generation);}

// Only this module can grant this capability; a copied JSON flag is inert.
export function isMaintenanceTerminalInput(db,row,input){
  const grant=input&&typeof input==='object'&&terminalInputs.get(input);
  if(!grant||grant.actionId!==row.id||!['acked','expired'].includes(row.status))return false;
  const state=currentState(db,row.id),receipt=state?.checkpoint.data.receipt;
  const reasonMatched=grant.reason==='MAINTENANCE_BUDGET_EXPIRED'?Date.parse(maintenanceActionDeadline(db,row.id))<=grant.at&&input.result?.code==='action_timeout'&&input.result.maintenanceBudgetExpired===true:revocableCodes.has(grant.reason)&&input.result?.code==='maintenance_resume_revoked'&&input.result.maintenanceRevokedReason===grant.reason;
  return Boolean(state&&state.checkpoint.id===grant.checkpointEventId&&!resumeStarted(db,row.id,state)&&reasonMatched&&input.status==='failed'&&canonical(input.result.maintenanceCheckpoint)===canonical(receipt)&&canonical(input.result.processExit)===canonical(receipt.processExit));
}

/** Enforced again inside repository writes, rather than only by HTTP routes. */
export function assertMaintenanceAttempt(db,row,input={}){
  const state=currentState(db,row.id);
  if(!state){need(input.maintenanceAttempt===undefined,'MAINTENANCE_ATTEMPT_INVALID');return null;}
  const {checkpoint,resumed}=state,receipt=checkpoint.data.receipt,result=input.result;
  if(isMaintenanceTerminalInput(db,row,input))return{generation:checkpoint.data.generation,terminal:true};
  if(input.status==='failed'&&result?.maintenanceCancelled===true&&!resumeStarted(db,row.id,state)&&cancelRequested(db,row)&&canonical(result.maintenanceCheckpoint)===canonical(receipt)&&canonical(result.processExit)===canonical(receipt.processExit))return{generation:checkpoint.data.generation,cancelled:true};
  const permit=input.maintenanceAttempt;
  need(resumed&&permit&&Object.keys(permit).length===2&&permit.generation===resumed.data.generation&&equalSecret(permit.token,resumed.data.token),'MAINTENANCE_ATTEMPT_REQUIRED');
  return{generation:permit.generation};
}

/** Same logical ACKed action; the durable event log is the maintenance ledger. */
export function createActionMaintenanceService(repo,{now=Date.now}={}){
  const db=repo.db,stamp=()=>new Date(now()).toISOString();
  const atomic=fn=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}};
  function context(id,credential){
    need(credential?.credentialId&&credential?.deviceId&&credential?.workspaceId&&credential?.workspace,'MAINTENANCE_DEVICE_REQUIRED',401);
    const device=db.prepare('SELECT d.*,c.revoked_at,w.slug,w.kind FROM device_credentials c JOIN devices d ON d.id=c.device_id AND d.workspace_id=c.workspace_id JOIN workspaces w ON w.id=d.workspace_id WHERE c.id=? AND c.device_id=? AND c.workspace_id=?').get(credential.credentialId,credential.deviceId,credential.workspaceId);
    need(device&&!device.revoked_at&&device.status!=='disabled'&&device.slug===credential.workspace,'MAINTENANCE_DEVICE_REQUIRED',401);
    const row=db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(id),payload=parse(row?.payload_json);
    need(row&&row.workspace_id===device.workspace_id&&payload?.deviceId===device.id,'MAINTENANCE_BINDING_CONFLICT',403);
    const action={...row,payload:repo.getA2AAction(id).payload},hostId=parse(device.runtime_discovery_json)?.maintenanceHostId;
    need(HASH.test(hostId||''),'MAINTENANCE_HOST_REQUIRED');
    return{row,payload,action,device,hostId};
  }
  function updateFor(c,id,requireAuthority=true){
    const update=db.prepare('SELECT * FROM device_updates WHERE id=?').get(id);
    need(update&&update.host_id===c.hostId,'MAINTENANCE_UPDATE_BINDING_CONFLICT',403);
    if(!requireAuthority)return update;
    const owner=db.prepare('SELECT m.role,d.status,d.owner_user_id,w.kind FROM members m JOIN workspaces w ON w.id=m.workspace_id JOIN devices d ON d.workspace_id=w.id AND d.id=? WHERE m.workspace_id=? AND m.user_id=?').get(update.device_id,update.workspace_id,update.actor_user_id);
    need(owner&&['owner','admin'].includes(owner.role)&&owner.status!=='disabled'&&(owner.kind!=='personal'||owner.owner_user_id===update.actor_user_id)&&db.prepare('SELECT 1 FROM device_credentials WHERE device_id=? AND workspace_id=? AND revoked_at IS NULL').get(update.device_id,update.workspace_id),'MAINTENANCE_AUTHORITY_REVOKED',403);
    return update;
  }
  function fresh(c){const seen=Date.parse(c.device.heartbeat_at||c.device.last_seen||'');need(Number.isFinite(seen)&&seen<=now()+5000&&now()-seen<90000,'MAINTENANCE_HEARTBEAT_REQUIRED');}
  function binding(c){
    const p=c.payload,e=db.prepare('SELECT * FROM employees WHERE id=? AND workspace_id=?').get(p.employeeId,c.row.workspace_id);
    need(e&&e.status==='active'&&p.runtime==='Hermes','MAINTENANCE_EMPLOYEE_CHANGED');
    const bot=db.prepare('SELECT * FROM hermes_bots WHERE employee_id=?').get(e.id);
    if(p.hermesBot)need(bot&&bot.workspace_id===c.row.workspace_id&&bot.active_action_id===c.row.id&&bot.control_state==='active'&&bot.revision===p.hermesBot.revision&&bot.control_epoch===p.hermesBot.controlEpoch&&bot.validated_revision===bot.revision,'MAINTENANCE_BOT_CHANGED');
    else need(!bot,'MAINTENANCE_BOT_CHANGED');
    const conversation=p.conversationId?db.prepare('SELECT id,employee_id,device_id,working_directory,model_id,status FROM conversations WHERE id=? AND workspace_id=?').get(p.conversationId,c.row.workspace_id):null;
    if(p.conversationId)need(conversation&&conversation.employee_id===e.id&&conversation.status==='active','MAINTENANCE_CONVERSATION_CHANGED');
    const task=c.row.task_id?db.prepare('SELECT id,state,updated_at FROM tasks WHERE id=? AND workspace_id=?').get(c.row.task_id,c.row.workspace_id):null;
    if(c.row.task_id)need(task&&!['completed','cancelled'].includes(task.state),'MAINTENANCE_TASK_CHANGED');
    const employeeMutation=db.prepare(`SELECT MAX(rowid) AS value FROM audit_events WHERE workspace_id=? AND json_valid(payload_json) AND json_extract(payload_json,'$.employeeId')=? AND action IN ${EMPLOYEE_CONFIG_ACTION_SQL}`).get(c.row.workspace_id,e.id)?.value||0;
    return digest({employee:e,employeeMutation,device:{id:c.device.id,workspaceId:c.device.workspace_id,ownerUserId:c.device.owner_user_id,hostId:c.hostId},bot:bot?{revision:bot.revision,controlEpoch:bot.control_epoch,profileBinding:bot.profile_binding_json,config:bot.config_json}:null,conversation,task});
  }
  function live(c){
    need(c.row.status==='acked'&&c.row.acked_at&&(!c.row.expires_at||Date.parse(c.row.expires_at)>now()),'MAINTENANCE_ACTION_NOT_ACKED');
    need(['conversation.execute','task.execute','automation.execute','runtime.execute','agent.execute'].includes(c.row.type),'MAINTENANCE_ACTION_UNSUPPORTED');
    need(!cancelRequested(db,c.row),'MAINTENANCE_CANCEL_REQUESTED');
    repo.preservation?.assertAction(c.row.id);repo.serverCodeRollout?.assertExecution();
    const admission=(admissionMethods.get(repo)||repo.authorizeActionExecution).call(repo,c.row.id,{deviceId:c.device.id});
    need(admission.allowed===true,'MAINTENANCE_ADMISSION_REFUSED');
    return{executionBinding:admission.executionBinding,bindingDigest:binding(c)};
  }
  function view(c,state){
    if(!state)return{state:null,actionId:c.row.id};
    const {checkpoint,resumed}=state;
    return{state:['succeeded','failed','expired'].includes(c.row.status)?'terminal':resumed?'authorized':'paused',actionId:c.row.id,generation:checkpoint.data.generation,receipt:checkpoint.data.receipt,...(resumed?{maintenanceAttempt:{generation:resumed.data.generation,token:resumed.data.token}}:{})};
  }
  function terminate(c,state,reason){
    const {checkpoint}=state,receipt=checkpoint.data.receipt,expired=reason==='MAINTENANCE_BUDGET_EXPIRED';need(!resumeStarted(db,c.row.id,state),'MAINTENANCE_RESUMED_EXIT_REQUIRED');
    const resultInput={status:'failed',deviceId:c.device.id,error:expired?'原任务执行期限已到；维护暂停未重置期限':reason==='MAINTENANCE_UPDATE_FAILED'?'客户端升级失败且未确认恢复安装，原任务已结束；没有重新启动':'维护后未取得继续执行许可；已保留实际退出回执且没有重新启动',result:{code:expired?'action_timeout':'maintenance_resume_revoked',...(expired?{maintenanceBudgetExpired:true}:{maintenanceRevokedReason:reason}),maintenanceCheckpoint:receipt,processExit:receipt.processExit}};
    terminalInputs.set(resultInput,{actionId:c.row.id,checkpointEventId:checkpoint.id,at:now(),reason});let completed;try{completed=repo.resultA2AAction(c.row.id,resultInput);}finally{terminalInputs.delete(resultInput);}
    db.prepare('INSERT INTO a2a_action_events(id,action_id,type,message,data_json,created_at) VALUES(?,?,?,?,?,?)').run(checkpoint.id+'_terminal',c.row.id,expired?'maintenance.expired':'maintenance.revoked',expired?'维护暂停期间达到原任务执行期限，已结束任务且没有重新启动':'原任务继续执行授权已变化，已保存退出回执并结束原任务',canonical({schemaVersion:1,generation:checkpoint.data.generation,reasonCode:reason}),stamp());
    return{allowed:false,terminal:true,reasonCode:reason,actionId:c.row.id,status:completed.status};
  }
  function terminalReason(c){const result=parse(c.row.result_json);return result?.maintenanceBudgetExpired===true?'MAINTENANCE_BUDGET_EXPIRED':result?.maintenanceRevokedReason||'MAINTENANCE_ACTION_TERMINAL';}
  function originalConfigurationUnchanged(c){
    const created=db.prepare("SELECT MAX(rowid) AS n FROM audit_events WHERE workspace_id=? AND action='a2a.action.created' AND json_valid(payload_json) AND json_extract(payload_json,'$.actionId')=?").get(c.row.workspace_id,c.row.id)?.n;
    if(created)need(!db.prepare(`SELECT 1 FROM audit_events WHERE workspace_id=? AND rowid>? AND json_valid(payload_json) AND ((action IN ${EMPLOYEE_CONFIG_ACTION_SQL} AND json_extract(payload_json,'$.employeeId')=?) OR (action='conversation.settings.updated' AND json_extract(payload_json,'$.conversationId')=?)) LIMIT 1`).get(c.row.workspace_id,created,c.payload.employeeId||'',c.payload.conversationId||''),'MAINTENANCE_CONFIGURATION_CHANGED');
  }
  function checkpoint(id,input={},credential){return atomic(()=>{
    need(input&&Object.keys(input).every(k=>['workspace','updateId','claimToken','receipt','maintenanceAttempt'].includes(k)),'MAINTENANCE_INPUT_INVALID',400);
    const c=context(id,credential),update=updateFor(c,input.updateId,false),state=currentState(db,id),receipt=input.receipt;
    need(input.workspace===undefined||input.workspace===c.device.slug,'MAINTENANCE_BINDING_CONFLICT',403);
    need(validateMaintenancePause(receipt,{actionId:id,updateId:update.id,targetBuild:update.target_build,runtime:'Hermes',profile:c.payload.profile||'default'}),'MAINTENANCE_CHECKPOINT_INVALID',400);
    need(c.payload.runtime==='Hermes'&&['conversation.execute','task.execute','automation.execute','runtime.execute','agent.execute'].includes(c.row.type),'MAINTENANCE_ACTION_UNSUPPORTED');
    const prior=events(db,id).find(e=>e.type===CHECKPOINT&&e.data?.receipt?.updateId===update.id);
    if(prior){need(canonical(prior.data.receipt)===canonical(receipt),'MAINTENANCE_IDEMPOTENCY_CONFLICT');need(prior.id===state.checkpoint.id,'MAINTENANCE_CHECKPOINT_SUPERSEDED');if(['succeeded','failed'].includes(c.row.status))return{...view(c,state),committed:true,terminal:true,status:c.row.status,reasonCode:terminalReason(c)};if(Date.parse(maintenanceActionDeadline(db,id))<=now())return{...terminate(c,state,'MAINTENANCE_BUDGET_EXPIRED'),committed:true};return{...view(c,state),committed:true};}
    fresh(c);need((update.state==='waiting_idle'||['cancelled','failed'].includes(update.state)&&!update.worker_pid)&&equalSecret(input.claimToken,update.claim_token)&&c.device.client_build===update.source_build&&c.device.pid===update.source_pid,'MAINTENANCE_UPDATE_NOT_WAITING');
    need(receipt.executionBinding===executionBinding(c.action),'MAINTENANCE_BINDING_CONFLICT');
    if(c.payload.cwd)need(receipt.cwd===c.payload.cwd,'MAINTENANCE_DIRECTORY_CHANGED');
    if(state){assertMaintenanceAttempt(db,c.row,input);need(receipt.home===state.checkpoint.data.receipt.home,'MAINTENANCE_SESSION_CHANGED');}
    else need(input.maintenanceAttempt===undefined,'MAINTENANCE_ATTEMPT_INVALID');
    if(c.payload.hermesBot){const provision=db.prepare('SELECT result_json FROM a2a_actions WHERE id=?').get(db.prepare('SELECT provision_action_id FROM hermes_bots WHERE employee_id=?').get(c.payload.employeeId)?.provision_action_id),result=parse(provision?.result_json),home=(result?.botProvision||result?.result?.botProvision)?.home;if(home)need(receipt.home===home,'MAINTENANCE_HOME_CHANGED');}
    const expiresAt=maintenanceActionDeadline(db,id)||c.row.expires_at;need(c.row.acked_at&&['acked','expired'].includes(c.row.status)&&typeof expiresAt==='string'&&Number.isFinite(Date.parse(expiresAt)),'MAINTENANCE_ACTION_NOT_ACKED');
    let current=null,revoked=null;
    if(Date.parse(expiresAt)<=now())revoked='MAINTENANCE_BUDGET_EXPIRED';
    else try{updateFor(c,input.updateId);current=live(c);need(receipt.executionBinding===current.executionBinding,'MAINTENANCE_BINDING_CONFLICT');originalConfigurationUnchanged(c);}catch(error){if(!revocableCodes.has(error.code))throw error;revoked=error.code;}
    const generation=(state?.checkpoint.data.generation||0)+1,data={schemaVersion:1,generation,receipt,bindingDigest:current?.bindingDigest||null,expiresAt};
    const eventId='action-event_maintenance_'+digest([id,update.id]);
    db.prepare('INSERT INTO a2a_action_events(id,action_id,type,message,data_json,created_at) VALUES(?,?,?,?,?,?)').run(eventId,id,CHECKPOINT,'客户端升级维护暂停；原任务尚未完成',canonical(data),stamp());
    if(revoked)return{...terminate(c,currentState(db,id),revoked),committed:true};
    return{...view(c,currentState(db,id)),committed:true};
  });}
  function status(id,credential){const c=context(id,credential);return view(c,currentState(db,id));}
  function resume(id,input={},credential){return atomic(()=>{
    need(input&&Object.keys(input).every(k=>['workspace','updateId','checkpointDigest','clientBuild','sourceIdle','maintenanceFailure'].includes(k)),'MAINTENANCE_INPUT_INVALID',400);
    const c=context(id,credential),state=currentState(db,id);need(state,'MAINTENANCE_CHECKPOINT_REQUIRED');
    need(input.workspace===undefined||input.workspace===c.device.slug,'MAINTENANCE_BINDING_CONFLICT',403);
    const {checkpoint}=state,receipt=checkpoint.data.receipt,update=updateFor(c,input.updateId,false);
    need(receipt.updateId===update.id&&receipt.checkpointDigest===input.checkpointDigest,'MAINTENANCE_CHECKPOINT_MISMATCH');
    if(['succeeded','failed'].includes(c.row.status))return{allowed:false,terminal:true,reasonCode:terminalReason(c),actionId:id,status:c.row.status};
    if(Date.parse(maintenanceActionDeadline(db,id))<=now()){
      return terminate(c,state,'MAINTENANCE_BUDGET_EXPIRED');
    }
    fresh(c);need(executionBinding(c.action)===receipt.executionBinding,'MAINTENANCE_BINDING_CONFLICT');try{updateFor(c,input.updateId);const current=live(c);need(current.executionBinding===receipt.executionBinding,'MAINTENANCE_BINDING_CONFLICT');need(current.bindingDigest===checkpoint.data.bindingDigest,'MAINTENANCE_BINDING_CHANGED');}catch(error){if(!revocableCodes.has(error.code))throw error;return terminate(c,state,error.code);}
    if(input.maintenanceFailure!==undefined){const failure=input.maintenanceFailure;need(input.sourceIdle===undefined&&update.state==='failed'&&Number.isSafeInteger(update.worker_pid)&&update.worker_pid>0&&failure&&Object.keys(failure).length===4&&Object.keys(failure).every(key=>['workerTerminal','maintenanceLockAbsent','installedBuild','pid'].includes(key))&&failure.workerTerminal===true&&failure.maintenanceLockAbsent===true&&HASH.test(input.clientBuild||'')&&failure.installedBuild===input.clientBuild&&input.clientBuild===c.device.client_build&&Number.isSafeInteger(failure.pid)&&failure.pid>0&&failure.pid===c.device.pid,'MAINTENANCE_UPDATE_FAILURE_INVALID');return terminate(c,state,'MAINTENANCE_UPDATE_FAILED');}
    if(update.state==='succeeded')need(input.clientBuild===update.target_build&&c.device.client_build===update.target_build&&c.device.pid!==update.source_pid&&Number.isSafeInteger(c.device.pid)&&c.device.pid>0&&Date.parse(c.device.heartbeat_at)>=Date.parse(update.verified_at||'invalid'),'MAINTENANCE_TARGET_HEARTBEAT_REQUIRED');
    else {
      const idle=input.sourceIdle;
      const sameSource=input.clientBuild===update.source_build&&c.device.client_build===update.source_build&&Number.isSafeInteger(c.device.pid)&&c.device.pid>0&&idle?.installedBuild===update.source_build&&idle.pid===c.device.pid&&idle.maintenanceLockAbsent===true;
      const queuedIdle=['cancelled','failed'].includes(update.state)&&!update.worker_pid&&c.device.pid===update.source_pid&&idle&&Object.keys(idle).length===4&&Object.keys(idle).every(key=>['workerAbsent','maintenanceLockAbsent','installedBuild','pid'].includes(key))&&idle.workerAbsent===true;
      const restoredIdle=update.state==='failed'&&Number.isSafeInteger(update.worker_pid)&&update.worker_pid>0&&idle&&Object.keys(idle).length===5&&Object.keys(idle).every(key=>['workerTerminal','originalInstallationRestored','maintenanceLockAbsent','installedBuild','pid'].includes(key))&&idle.workerTerminal===true&&idle.originalInstallationRestored===true;
      need(sameSource&&(queuedIdle||restoredIdle),'MAINTENANCE_SOURCE_IDLE_REQUIRED');
    }
    if(!state.resumed){const data={schemaVersion:1,generation:checkpoint.data.generation,checkpointEventId:checkpoint.id,token:randomBytes(32).toString('hex')};db.prepare('INSERT INTO a2a_action_events(id,action_id,type,message,data_json,created_at) VALUES(?,?,?,?,?,?)').run(checkpoint.id+'_resume',id,RESUME,'客户端维护后获准从原检查点续做',canonical(data),stamp());}
    return{...view(c,currentState(db,id)),allowed:true};
  });}
  function assertAttempt(id,input={}){const row=db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(id);need(row,'ACTION_NOT_FOUND',404);return assertMaintenanceAttempt(db,row,input);}
  function settleExpired(row,input={}){
    if(!row||!['acked','expired'].includes(row.status)||!row.acked_at)return false;
    const state=currentState(db,row.id);if(!state||resumeStarted(db,row.id,state)||Date.parse(maintenanceActionDeadline(db,row.id))>now())return false;
    const payload=parse(row.payload_json)||{},action={...row,payload:repo.getA2AAction(row.id).payload};
    if(!input.deviceId||payload.deviceId!==input.deviceId||!validateMaintenancePause(state.checkpoint.data.receipt,{actionId:row.id,executionBinding:executionBinding(action),profile:payload.profile||'default'}))return false;
    terminate({row,payload,device:{id:input.deviceId}},state,'MAINTENANCE_BUDGET_EXPIRED');return true;
  }
  const service={checkpoint,status,resume,assertAttempt,settleExpired};maintenanceServices.set(repo,service);return service;
}
