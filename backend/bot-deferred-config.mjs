import crypto from 'node:crypto';
import {normalizeBotConfigUpdate,botFailure} from '../src/hermes-bot-config.mjs';

const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const digest=value=>crypto.createHash('sha256').update(canonical(value)).digest('hex');
const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
const fail=code=>{throw botFailure(code,reasons[code]||'延后配置未通过当前身份与执行状态核对');};
const reasons={
  BOT_DEFERRED_ACTOR_REQUIRED:'延后配置需要可持续核对的用户或配对电脑身份。',
  BOT_DEFERRED_INPUT_INVALID:'延后配置参数或幂等标识无效。',
  BOT_DEFERRED_IDEMPOTENCY_CONFLICT:'同一延后配置标识已用于不同参数。',
  BOT_DEFERRED_CONFIG_PENDING:'此员工已有尚未结束的延后配置，请读取原意图。',
  BOT_DEFERRED_AUTHORITY_CHANGED:'原配置授权已撤销或当前身份无权管理此员工。',
  BOT_DEFERRED_BINDING_CHANGED:'员工、电脑或 Profile 绑定已变化，未应用旧配置意图。',
  BOT_DEFERRED_VERSION_CHANGED:'配置或控制版本已变化，未覆盖后来的修改或暂停。',
  BOT_DEFERRED_RECORD_INVALID:'延后配置原始意图无法完整读取。',
  BOT_DEFERRED_VALIDATION_FAILED:'新配置的原生验证未成功，Bot 未自动恢复工作。',
  BOT_DEFERRED_CONNECTION_FAILED:'MCP 原连接未成功；保留原连接回执，不重复派发。',
  BOT_DEFERRED_APPLY_FAILED:'延后配置未能完成，保留当前配置与原执行记录。',
  BOT_MCP_CLIENT_REQUIRED:'目标电脑的客户端尚不支持远程 MCP 授权，未创建替代连接。',
  BOT_PERMISSION_CONFLICT:'当前配置未授权此原生操作，未扩大工具权限。',
  PROFILE_AUTHENTICATION_MISSING:'目标 Profile 缺少模型认证，未自动启用。',
  PROFILE_PROVIDER_MISSING:'目标 Profile 缺少模型服务商配置，未自动启用。',
  RUNTIME_NOT_DISCOVERED:'目标电脑尚未发现指定原生运行时，未创建替代环境。',
};
const uncertain=value=>Boolean(value&&typeof value==='object'&&(value.code==='EXECUTION_UNCERTAIN'||value.executionState==='uncertain'||value.status==='uncertain'||Object.values(value).some(uncertain)));
const valueResult=action=>action?.result?.result||action?.result;

// A terminal label, an unrelated success, or an operator abandonment does not
// prove an execution tree exited. No recovery metadata changes this predicate.
export function deferredConfigIdleEvidence(action){
  if(!action||!['succeeded','failed'].includes(action.status)||uncertain(action.result))return false;
  const result=valueResult(action),exit=result?.processExit||action.result?.processExit;
  if(!action.acked_at&&action.status==='failed'&&result?.code==='BOT_CANCELLED_BEFORE_START'&&result.stopConfirmed===true)return true;
  if(!exit||exit.treeConfirmed!==true||exit.activeProcesses!==0||exit.failureCode||exit.backgroundProcessesRetained===true)return false;
  if(exit.launched===true){
    if(exit.rootConfirmed!==true||!Number.isSafeInteger(exit.rootPid)||exit.rootPid<=0)return false;
    return action.status==='succeeded'?exit.rootExitCode===0&&exit.cancelled!==true&&!exit.signal&&(exit.hostExitCode==null||exit.hostExitCode===0):Number.isSafeInteger(exit.rootExitCode)||exit.rootExitCode===null&&(exit.cancelled===true||typeof exit.signal==='string'&&Boolean(exit.signal));
  }
  const proof=result?.prelaunch||action.result?.prelaunch,p=action.payload,b=p?.hermesBot;
  if(!p||!b)return false;
  return action.status==='failed'&&exit.launched===false&&exit.supervisor==='runtime-prelaunch'&&exit.rootPid===null&&exit.rootExitCode===null&&proof?.schemaVersion===1&&proof.source==='bot-start-admission'&&proof.phase==='before-runtime-spawn'&&proof.spawnAttempted===false&&proof.actionId===action.id&&proof.workspace===b?.workspace&&proof.employeeId===p.employeeId&&proof.deviceId===p.deviceId&&proof.profile===p.profile&&proof.revision===b.revision&&proof.controlEpoch===b.controlEpoch&&proof.method==='POST'&&proof.operation==='bot-start'&&Number.isInteger(proof.denial?.status)&&proof.denial.status>=400&&proof.denial.status<500&&['BOT_REVISION_CONFLICT','BOT_NOT_ACTIVE','BOT_NOT_VALIDATED','BOT_START_INVALID'].includes(proof.denial?.code);
}

function employeePatch(value={}){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['name','avatar','description','persona','instructions','skills','model','visibility'].includes(key)))fail('BOT_DEFERRED_INPUT_INVALID');
  const patch={...value};
  for(const key of ['name','description','persona','instructions'])if(Object.hasOwn(patch,key)){if(typeof patch[key]!=='string')fail('BOT_DEFERRED_INPUT_INVALID');patch[key]=key==='name'?patch[key].trim():patch[key];}
  if(patch.name==='')fail('BOT_DEFERRED_INPUT_INVALID');
  if(Object.hasOwn(patch,'model')&&patch.model!==null&&typeof patch.model!=='string')fail('BOT_DEFERRED_INPUT_INVALID');
  if(Object.hasOwn(patch,'avatar')&&patch.avatar!==null&&typeof patch.avatar!=='string')fail('BOT_DEFERRED_INPUT_INVALID');
  if(Object.hasOwn(patch,'skills')&&(!Array.isArray(patch.skills)||patch.skills.some(value=>typeof value!=='string')))fail('BOT_DEFERRED_INPUT_INVALID');
  if(Object.hasOwn(patch,'visibility')&&!['personal','workspace'].includes(patch.visibility))fail('BOT_DEFERRED_INPUT_INVALID');
  return patch;
}
const employeeValue=(employee,key)=>key==='model'?employee.model_id:key==='skills'?(employee.skills??parse(employee.skills_json)):employee[key];
const actionBinding=action=>action?{id:action.id,type:action.type,agentId:action.agent_id,workspaceId:action.workspace_id,payloadDigest:digest(action.payload),dedupeKey:action.dedupe_key,createdAt:action.created_at}:null;

/** Durable intent runner. All external hooks are synchronous API service calls;
 * actual device work and OAuth approval remain represented by their A2A actions.
 */
export function createBotDeferredConfig(repo,{resolve,get,update,validate,control}, {now=()=>new Date().toISOString()}={}){
  const db=repo.db;
  let started=false,queued=false,draining=false,timer=null,unsubscribe=null,hooks={};
  const atomic=fn=>{db.exec('SAVEPOINT bot_deferred_config');try{const result=fn();db.exec('RELEASE bot_deferred_config');return result;}catch(error){db.exec('ROLLBACK TO bot_deferred_config; RELEASE bot_deferred_config');throw error;}};
  const raw=id=>db.prepare('SELECT * FROM bot_deferred_configs WHERE id=?').get(id);
  const intentFor=row=>{const intent=parse(row.intent_json);if(!intent||intent.schemaVersion!==1||digest(intent)!==row.intent_digest)fail('BOT_DEFERRED_RECORD_INVALID');return intent;};
  function projection(row){
    if(!row)return null;
    const intent=parse(row.intent_json)||{},applied=parse(row.applied_json);
    return{id:row.id,state:row.state,phase:row.phase,baseRevision:intent.request?.expectedRevision,baseControlEpoch:intent.request?.expectedControlEpoch,blockingActionId:intent.blocking?.id||null,appliedRevision:applied?.revision??null,appliedControlEpoch:applied?.controlEpoch??null,validationActionId:row.validation_action_id||null,connectMcpServers:intent.request?.connectMcpServers||[],connections:parse(row.connections_json)||[],restoreActive:intent.restoreActive===true,createdAt:row.created_at,updatedAt:row.updated_at,errorCode:row.error_code||null,reason:row.error_code?reasons[row.error_code]||reasons.BOT_DEFERRED_APPLY_FAILED:null};
  }
  const latest=(workspaceId,employeeId)=>projection(db.prepare('SELECT * FROM bot_deferred_configs WHERE workspace_id=? AND employee_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(workspaceId,employeeId));
  function actorFor(context,ws){
    const actor={...(context.actorUserId?{actorUserId:context.actorUserId}:{}),...(context.deviceCredentialDeviceId?{deviceCredentialDeviceId:context.deviceCredentialDeviceId,deviceScope:context.deviceScope,authenticatedMcp:true}:{}),enforceEmployeeVisibility:true,enforceDeviceOwnership:true};
    if(!actor.actorUserId&&!actor.deviceCredentialDeviceId)fail('BOT_DEFERRED_ACTOR_REQUIRED');
    let credential=null;
    if(actor.deviceCredentialDeviceId){
      if(actor.deviceScope!==actor.deviceCredentialDeviceId)fail('BOT_DEFERRED_AUTHORITY_CHANGED');
      credential=db.prepare('SELECT c.id,c.device_id,c.workspace_id,c.revoked_at,c.created_at,d.owner_user_id,d.status FROM device_credentials c JOIN devices d ON d.id=c.device_id AND d.workspace_id=c.workspace_id WHERE c.device_id=? AND c.workspace_id=?').get(actor.deviceCredentialDeviceId,ws.id);
      if(!credential||credential.revoked_at||credential.status==='disabled'||(credential.owner_user_id||null)!==(actor.actorUserId||null))fail('BOT_DEFERRED_AUTHORITY_CHANGED');
      credential={id:credential.id,deviceId:credential.device_id,workspaceId:credential.workspace_id,createdAt:credential.created_at,ownerUserId:credential.owner_user_id||null};
    }
    return{context:actor,credential};
  }
  function authorized(row,intent){
    try{
      const {credential}=intent.actor,context={...intent.actor.context};
      if(credential){const saved=db.prepare('SELECT c.*,d.status,d.owner_user_id FROM device_credentials c JOIN devices d ON d.id=c.device_id AND d.workspace_id=c.workspace_id WHERE c.id=?').get(credential.id);if(!saved||saved.revoked_at||saved.status==='disabled'||saved.device_id!==credential.deviceId||saved.workspace_id!==credential.workspaceId||saved.created_at!==credential.createdAt||(saved.owner_user_id||null)!==credential.ownerUserId)fail('BOT_DEFERRED_AUTHORITY_CHANGED');if(!context.actorUserId)context.actorRole='member';}
      const checked=resolve(intent.workspace,row.employee_id,context);
      if(checked.ws.id!==row.workspace_id)fail('BOT_DEFERRED_AUTHORITY_CHANGED');
      if(checked.employee.target_device_id!==intent.deviceId||checked.employee.runtime_profile!==intent.profile||checked.employee.runtime!=='Hermes'||checked.row.profile_binding_json!==intent.profileBindingJson)fail('BOT_DEFERRED_BINDING_CHANGED');
      repo.preservation?.assert({type:'hermes.bot.configuration'});repo.serverCodeRollout?.assertExecution();
      return checked;
    }catch(error){if(['BOT_DEFERRED_BINDING_CHANGED','V2_OBJECT_SEALED','SERVER_CODE_ROLLOUT_REQUIRED'].includes(error.code))throw error;fail('BOT_DEFERRED_AUTHORITY_CHANGED');}
  }
  const finish=(row,state,code=null,phase=state)=>db.prepare('UPDATE bot_deferred_configs SET state=?,phase=?,error_code=?,updated_at=? WHERE id=? AND state IN (\'pending\',\'validating\',\'connecting\')').run(state,phase,code,now(),row.id);
  function enqueue(slug,id,input,context={}){return atomic(()=>{
    repo.preservation?.assert({type:'hermes.bot.configuration'});repo.serverCodeRollout?.assertExecution();
    if(input.deferUntilIdle!==true||Object.keys(input).some(key=>!['deferUntilIdle','expectedRevision','expectedControlEpoch','idempotencyKey','employee','config','connectMcpServers','workspace'].includes(key))||input.workspace!==undefined&&input.workspace!==slug||!Number.isInteger(input.expectedRevision)||!Number.isInteger(input.expectedControlEpoch)||typeof input.idempotencyKey!=='string'||!/^[A-Za-z0-9._:-]{1,160}$/.test(input.idempotencyKey))fail('BOT_DEFERRED_INPUT_INVALID');
    const checked=resolve(slug,id,context),actor=actorFor(checked.context,checked.ws),actorKey=canonical([actor.context.actorUserId||null,actor.credential?.id||null]);
    const names=input.connectMcpServers??[];
    if(!Array.isArray(names)||names.length>20||names.some(name=>typeof name!=='string'||!/^[a-z][a-z0-9_-]{0,63}$/.test(name))||new Set(names).size!==names.length)fail('BOT_DEFERRED_INPUT_INVALID');
    const request={expectedRevision:input.expectedRevision,expectedControlEpoch:input.expectedControlEpoch,employee:employeePatch(input.employee),config:input.config===undefined?null:normalizeBotConfigUpdate(input.config,parse(checked.row.config_json)),connectMcpServers:[...names]};
    const fingerprint=digest(request),prior=db.prepare('SELECT * FROM bot_deferred_configs WHERE workspace_id=? AND employee_id=? AND actor_key=? AND request_key=?').get(checked.ws.id,id,actorKey,input.idempotencyKey);
    if(prior){if(prior.fingerprint!==fingerprint)fail('BOT_DEFERRED_IDEMPOTENCY_CONFLICT');return{...get(slug,id,checked.context),deferred:true,duplicate:true,deferredConfig:projection(prior)};}
    if(checked.row.revision!==input.expectedRevision||checked.row.control_epoch!==input.expectedControlEpoch)fail('BOT_DEFERRED_VERSION_CHANGED');
    if(db.prepare("SELECT 1 FROM bot_deferred_configs WHERE employee_id=? AND state IN ('pending','validating','connecting')").get(id))fail('BOT_DEFERRED_CONFIG_PENDING');
    const config=request.config||parse(checked.row.config_json);
    if(names.some(name=>!config?.mcpServers?.[name]||config.mcpServers[name].enabled===false)||names.length&&config.permissions?.mode!=='execute')fail('BOT_DEFERRED_INPUT_INVALID');
    const blocking=checked.row.active_action_id?repo.getA2AAction(checked.row.active_action_id):null;
    if(checked.row.active_action_id&&!blocking)fail('BOT_DEFERRED_RECORD_INVALID');
    if(blocking&&(blocking.payload?.employeeId!==id||blocking.payload?.hermesBot?.employeeId!==id||blocking.payload.hermesBot.workspace!==slug||blocking.payload.deviceId!==checked.employee.target_device_id||blocking.payload.profile!==checked.employee.runtime_profile||blocking.payload.hermesBot.revision!==checked.row.revision||blocking.payload.hermesBot.controlEpoch!==checked.row.control_epoch))fail('BOT_DEFERRED_BINDING_CHANGED');
    const intent={schemaVersion:1,workspace:slug,actor,request,config,deviceId:checked.employee.target_device_id,profile:checked.employee.runtime_profile,profileBindingJson:checked.row.profile_binding_json,baseConfigDigest:digest(parse(checked.row.config_json)),baseEmployee:Object.fromEntries(Object.keys(request.employee).map(key=>[key,employeeValue(checked.employee,key)])),baseControlState:checked.row.control_state,baseEmployeeStatus:checked.employee.status,restoreActive:checked.row.control_state==='active'&&checked.employee.status==='active',blocking:actionBinding(blocking)};
    const stamp=now(),intentId=`bot-config_${crypto.randomUUID()}`;
    db.prepare('INSERT INTO bot_deferred_configs(id,workspace_id,employee_id,actor_key,request_key,fingerprint,intent_json,intent_digest,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(intentId,checked.ws.id,id,actorKey,input.idempotencyKey,fingerprint,canonical(intent),digest(intent),stamp,stamp);
    wake();return{...get(slug,id,checked.context),deferred:true,deferredConfig:projection(raw(intentId))};
  });}
  function appliedMatches(checked,applied){
    const {row,employee}=checked;
    if(row.revision!==applied.revision||row.control_epoch!==applied.controlEpoch||row.control_state!==applied.controlState||employee.status!==applied.employeeStatus||digest(parse(row.config_json))!==applied.configDigest||Object.entries(applied.employee).some(([key,value])=>canonical(employeeValue(employee,key))!==canonical(value)))fail('BOT_DEFERRED_VERSION_CHANGED');
  }
  function step(row){return atomic(()=>{
    const intent=intentFor(row),checked=authorized(row,intent),{row:bot,employee,context}=checked;
    if(row.state==='pending'){
      if(bot.revision!==intent.request.expectedRevision||bot.control_epoch!==intent.request.expectedControlEpoch||bot.control_state!==intent.baseControlState||employee.status!==intent.baseEmployeeStatus||digest(parse(bot.config_json))!==intent.baseConfigDigest||Object.entries(intent.baseEmployee).some(([key,value])=>canonical(employeeValue(employee,key))!==canonical(value)))fail('BOT_DEFERRED_VERSION_CHANGED');
      if(intent.blocking){const action=repo.getA2AAction(intent.blocking.id);if(!action||canonical(actionBinding(action))!==canonical(intent.blocking))fail('BOT_DEFERRED_BINDING_CHANGED');if(!deferredConfigIdleEvidence(action)){db.prepare('UPDATE bot_deferred_configs SET phase=?,updated_at=? WHERE id=?').run('waiting_for_execution_evidence',now(),row.id);return;}}
      if(bot.active_action_id){if(bot.active_action_id!==intent.blocking?.id)fail('BOT_DEFERRED_VERSION_CHANGED');return;}
      const saved=update(intent.workspace,row.employee_id,{expectedRevision:bot.revision,employee:intent.request.employee,config:intent.config},context);
      const fresh=resolve(intent.workspace,row.employee_id,context),applied={revision:saved.revision,controlEpoch:saved.control_epoch,controlState:saved.control_state,employeeStatus:fresh.employee.status,configDigest:digest(saved.config),employee:Object.fromEntries(Object.keys(intent.request.employee).map(key=>[key,employeeValue(fresh.employee,key)]))};
      const {action}=validate(intent.workspace,row.employee_id,{expectedRevision:saved.revision,idempotencyKey:`deferred-validate:${row.id}`},context);
      db.prepare("UPDATE bot_deferred_configs SET state='validating',phase='validating',applied_json=?,validation_action_id=?,updated_at=? WHERE id=? AND state='pending'").run(canonical(applied),action.id,now(),row.id);return;
    }
    let applied=parse(row.applied_json);if(!applied)fail('BOT_DEFERRED_RECORD_INVALID');appliedMatches(checked,applied);
    if(row.state==='validating'){
      const action=repo.getA2AAction(row.validation_action_id),r=valueResult(action),validation=r?.botValidation||action?.result?.botValidation;
      if(!action||action.type!=='hermes.bot.validate'||action.payload?.employeeId!==row.employee_id||action.payload?.hermesBot?.revision!==applied.revision||action.payload?.hermesBot?.controlEpoch!==applied.controlEpoch)fail('BOT_DEFERRED_RECORD_INVALID');
      if(['pending','acked'].includes(action.status))return;
      if(action.status!=='succeeded'||!deferredConfigIdleEvidence(action)||validation?.valid!==true||validation.schemaVersion!==1||validation.employeeId!==row.employee_id||validation.revision!==applied.revision||bot.validated_revision!==applied.revision){finish(row,'failed','BOT_DEFERRED_VALIDATION_FAILED');return;}
      if(bot.active_action_id)return;
      if(intent.restoreActive&&bot.control_state!=='active'){
        const saved=control(intent.workspace,row.employee_id,{expectedRevision:applied.revision,expectedControlEpoch:applied.controlEpoch,operation:'activate'},context);
        applied={...applied,controlEpoch:saved.control_epoch,controlState:saved.control_state,employeeStatus:saved.employee.status};
      }
      if(!intent.restoreActive&&intent.baseControlState==='paused'&&bot.control_state!=='paused'){
        const saved=control(intent.workspace,row.employee_id,{expectedRevision:applied.revision,expectedControlEpoch:applied.controlEpoch,operation:'pause'},context);
        applied={...applied,controlEpoch:saved.control_epoch,controlState:saved.control_state,employeeStatus:saved.employee.status};
      }
      db.prepare('UPDATE bot_deferred_configs SET state=?,phase=?,applied_json=?,updated_at=? WHERE id=?').run(intent.request.connectMcpServers.length?'connecting':'completed',intent.request.connectMcpServers.length?'connecting':'completed',canonical(applied),now(),row.id);
      // Reserve and create the first maintenance connection before yielding to
      // a new request. Its snapshot uses the actual activation control epoch.
      if(intent.request.connectMcpServers.length)step(raw(row.id));
      return;
    }
    const connections=parse(row.connections_json);if(!Array.isArray(connections))fail('BOT_DEFERRED_RECORD_INVALID');
    for(const server of intent.request.connectMcpServers){
      let item=connections.find(value=>value.server===server),snapshot;
      if(item?.status==='connected')continue;
      if(item){if(typeof hooks.readMcp!=='function')return;snapshot=hooks.readMcp({workspace:intent.workspace,employeeId:row.employee_id,server,actionId:item.actionId,context});}
      else{
        if(db.prepare('SELECT active_action_id FROM hermes_bots WHERE employee_id=?').get(row.employee_id)?.active_action_id){finish(row,'conflict','BOT_DEFERRED_VERSION_CHANGED');return;}
        if(typeof hooks.connectMcp!=='function')return;
        snapshot=hooks.connectMcp({workspace:intent.workspace,employeeId:row.employee_id,server,idempotencyKey:`deferred-mcp:${row.id}:${server}`,context});
      }
      if(!snapshot||typeof snapshot.id!=='string'||snapshot.server!==server||snapshot.employeeId!==row.employee_id||snapshot.workspace!==intent.workspace||snapshot.revision!==applied.revision||snapshot.controlEpoch!==applied.controlEpoch||item&&snapshot.id!==item.actionId)fail('BOT_DEFERRED_RECORD_INVALID');
      const next={server,actionId:snapshot.id,status:snapshot.status,error:['failed','expired','cancelled'].includes(snapshot.status)?'MCP_CONNECTION_FAILED':null};
      if(item)Object.assign(item,next);else{item=next;connections.push(item);}
      db.prepare('UPDATE bot_deferred_configs SET connections_json=?,phase=?,updated_at=? WHERE id=?').run(canonical(connections),snapshot.status==='authorization_required'?'authorization_required':'connecting',now(),row.id);
      if(['failed','expired','cancelled'].includes(snapshot.status)){finish(row,'failed','BOT_DEFERRED_CONNECTION_FAILED');return;}
      if(snapshot.status!=='connected')return;
      const action=repo.getA2AAction(snapshot.id);
      if(!action||action.payload?.employeeId!==row.employee_id||action.payload?.hermesBot?.revision!==applied.revision||action.payload?.hermesBot?.controlEpoch!==applied.controlEpoch||!deferredConfigIdleEvidence(action)){item.status='waiting_for_exit';db.prepare('UPDATE bot_deferred_configs SET connections_json=? WHERE id=?').run(canonical(connections),row.id);return;}
    }
    finish(row,'completed');
  });}
  function drain(){
    if(draining)return[];draining=true;
    try{
      const rows=db.prepare("SELECT * FROM bot_deferred_configs WHERE state IN ('pending','validating','connecting') ORDER BY created_at,rowid").all();
      for(const row of rows)try{step(row);}catch(error){
        if(['DEVICE_OFFLINE','BOT_DEVICE_OFFLINE','DISCOVERY_STALE','MCP_OAUTH_RELAY_BUSY'].includes(error.code))db.prepare('UPDATE bot_deferred_configs SET phase=?,updated_at=? WHERE id=?').run('waiting_for_device',now(),row.id);
        else{const code=Object.hasOwn(reasons,error.code)?error.code:'BOT_DEFERRED_APPLY_FAILED';finish(raw(row.id),'conflict',code);}
      }
      return rows.map(row=>projection(raw(row.id)));
    }finally{draining=false;}
  }
  function wake(){if(!started||queued)return;queued=true;queueMicrotask(()=>{queued=false;if(started)try{drain();}catch{/* A committed execution response must never be replaced by queue errors. */}});}
  function stop(){started=false;if(timer)clearInterval(timer);timer=null;unsubscribe?.();unsubscribe=null;}
  function start(options={}){
    stop();hooks={connectMcp:options.connectMcp,readMcp:options.readMcp};started=true;
    unsubscribe=repo.onBotActionCompleted?.(wake)||null;
    const interval=options.pollIntervalMs===0?0:1000;
    if(interval){timer=setInterval(wake,interval);timer.unref?.();}
    wake();return api;
  }
  const api={enqueue,latest,start,stop,wake,drain};
  return api;
}
