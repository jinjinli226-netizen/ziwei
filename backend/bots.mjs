import crypto from 'node:crypto';
import {guardBotService} from './version-preservation.mjs';
import {botProfileBinding,botProfileView,assertBotProfileReady} from './bot-profiles.mjs';
import {normalizeNativeOperation,nativeIsExecution,nativeNeedsTools} from '../src/hermes-native-contract.mjs';
import { normalizeBotConfig, createDefaultBotConfig, botFailure, BOT_CAPABILITY_CATALOG } from '../src/hermes-bot-config.mjs';
import {deriveBotCapabilities} from './bot-capabilities.mjs';
import {readHistoricalPrelaunchRecovery} from './bot-historical-recovery-view.mjs';
import {createBotDeferredConfig} from './bot-deferred-config.mjs';
import {createBotManagementActionReader} from './bot-management-view.mjs';
import {botExecutionOccupiesSlot} from './bot-execution-occupancy.mjs';
import {pendingBotFailureFinalization} from './bot-failure-finalization.mjs';
import {createBotRosterView} from './bot-roster-view.mjs';
import {createMobileReadView} from './mobile-read-view.mjs';
import {createBotWorkbenchActionReader} from './bot-workbench-view.mjs';

const parse = value => { try { return JSON.parse(value); } catch { return null; } };
const now = () => new Date().toISOString();
const managementEmployeeView = employee => {
  if (typeof employee?.avatar !== 'string' || !employee.avatar.startsWith('data:image/')) return employee;
  // Omission is not an editable null: configuration round-trips keep the image.
  const {avatar,...view}=employee;
  return {...view,avatarPresent:true,avatarBytes:Buffer.byteLength(avatar),avatarRepresented:false};
};
export const BOT_INTERNAL = Symbol('trusted bot validation');
export const botActionMaintenance=(type,payload)=>['hermes.bot.provision','hermes.bot.validate','directory.inspect'].includes(type) || type==='hermes.bot.native' && !nativeIsExecution(normalizeNativeOperation(payload.nativeOperation));
export const botActionReadOnlyInspection=(type,payload)=>type==='directory.inspect' && payload?.createIfMissing===false && !Object.hasOwn(payload,'create_if_missing');
const canonical = value => JSON.stringify(value, (_key,item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))) : item);
export const botUncertain = value => Boolean(value && (value.code === 'EXECUTION_UNCERTAIN' || value.executionState === 'uncertain' || botUncertain(value.result)));
export const botSnapshot = (db, employeeId, workspaceId) => {
  const row = db.prepare('SELECT * FROM hermes_bots WHERE employee_id=? AND workspace_id=?').get(employeeId,workspaceId);
  if (!row) return null;
  const employee = db.prepare('SELECT * FROM employees WHERE id=? AND workspace_id=?').get(employeeId,workspaceId);
  const workspace = db.prepare('SELECT slug FROM workspaces WHERE id=?').get(workspaceId)?.slug;
  return {schemaVersion:1,employeeId,workspace,revision:row.revision,controlEpoch:row.control_epoch,config:parse(row.config_json),sourceProfile:employee.runtime_profile,instance:botProfileBinding(row),deviceId:employee.target_device_id,model:employee.model_id,persona:employee.persona,instructions:employee.instructions,description:employee.description,name:employee.name,conversationId:row.main_conversation_id};
};
export function assertBotExecution(db, workspaceId, payload, { validation = false, provisioning = false, requireProfile = !validation, actionId = null, readOnlyInspection = false } = {}) {
  // Retired owned profiles cannot be addressed through a raw action without employeeId.
  const targetDeviceId=payload.deviceId || payload.targetDeviceId || payload.device_id || payload.target_device_id;
  const targetProfile=payload.profile || payload.runtimeProfile || payload.runtime_profile || payload.hermesProfile || payload.hermes_profile;
  const targetRuntime=payload.runtime || payload.agent || payload.runtimeName;
  if(targetDeviceId && targetProfile && (!targetRuntime || String(targetRuntime).trim().toLowerCase()==='hermes')) {
    const retired=db.prepare("SELECT b.profile_binding_json FROM employees e JOIN hermes_bots b ON b.employee_id=e.id WHERE e.status='deleted' AND e.target_device_id=? AND e.runtime_profile=?").all(targetDeviceId,targetProfile);
    if(retired.some(item=>parse(item.profile_binding_json)?.mode==='owned_profile'))throw botFailure('EMPLOYEE_PROFILE_DELETED','该专属 Profile 属于已移除员工，不能重新执行',409);
  }
  const conversation=payload.conversationId?db.prepare('SELECT employee_id,workspace_id FROM conversations WHERE id=?').get(payload.conversationId):null;
  const routine=payload.automationId?db.prepare('SELECT employee_id,workspace_id FROM bot_routines WHERE automation_id=?').get(payload.automationId):null;
  if(payload.automationId && !routine && db.prepare("SELECT 1 FROM automations WHERE id=? AND executor='ziwei_bot'").get(payload.automationId))throw botFailure('BOT_NOT_FOUND','Routine 原 Bot 已删除或解绑；禁止降级为通用执行',404);
  const linked=[conversation,routine].filter(Boolean);
  const linkedBot=linked.find(item=>db.prepare('SELECT 1 FROM hermes_bots WHERE employee_id=?').get(item.employee_id));
  if(linkedBot && (linked.some(item=>item.workspace_id!==workspaceId || item.employee_id!==linkedBot.employee_id) || payload.employeeId && payload.employeeId!==linkedBot.employee_id))throw botFailure('BOT_BINDING_CONFLICT','会话、Routine 与员工身份不一致');
  const employeeId = linkedBot?.employee_id || payload.employeeId || null;
  if(payload.inspectionEmployeeId!==undefined && (!readOnlyInspection || payload.inspectionEmployeeId!==employeeId || payload.employeeId || payload.employee_id || payload.assignee))throw botFailure('BOT_BINDING_CONFLICT','只读目录检查的员工绑定不一致');
  if(readOnlyInspection && payload.hermesBot && payload.hermesBot.employeeId!==employeeId)throw botFailure('BOT_BINDING_CONFLICT','只读目录检查的 Bot 身份不一致');
  if (!employeeId) { if (payload.hermesBot) throw botFailure('BOT_IDENTITY_INVALID','Bot 配置缺少可信员工绑定'); return null; }
  const employee = db.prepare('SELECT * FROM employees WHERE id=? AND workspace_id=?').get(employeeId,workspaceId);
  if(employee?.status==='deleted')throw botFailure('EMPLOYEE_DELETED','数字员工已移除，不能接收新任务',404);
  const row = db.prepare('SELECT * FROM hermes_bots WHERE employee_id=?').get(employeeId);
  if (!row) { if (payload.hermesBot) throw botFailure('BOT_NOT_FOUND','Bot 已删除或不存在',404); return null; }
  if (row.workspace_id !== workspaceId) throw botFailure('BOT_NOT_FOUND','Bot 不属于当前工作区',404);
  if(payload.env && Object.keys(payload.env).length)throw botFailure('BOT_ENV_OVERRIDE_FORBIDDEN','Bot 不接受动作中的任意环境覆盖；使用已保存配置和本机凭据引用');
  if(payload.automationId) {
    const run=payload.runId?db.prepare('SELECT * FROM automation_runs WHERE id=?').get(payload.runId):null;
    if(!routine || !run || run.workspace_id!==workspaceId || run.automation_id!==payload.automationId || run.action_id && run.action_id!==actionId)throw botFailure('BOT_RUN_BINDING_CONFLICT','Routine 运行与当前 action 不一致');
    if(db.prepare('SELECT status FROM automations WHERE id=?').get(payload.automationId)?.status!=='active')throw botFailure('BOT_NOT_ACTIVE','Routine 已暂停');
  }
  if(!employee)throw botFailure('BOT_NOT_FOUND','Bot 员工不存在',404);
  if(!provisioning&&requireProfile)assertBotProfileReady(db,row,employee);
  if (payload.runtime && payload.runtime !== 'Hermes' || payload.deviceId && payload.deviceId !== employee.target_device_id || payload.profile && payload.profile !== employee.runtime_profile || payload.model && payload.model !== employee.model_id) throw botFailure('BOT_BINDING_CONFLICT','Bot 执行不可覆盖已验证的运行绑定');
  if (payload.conversationId && !db.prepare('SELECT id FROM conversations WHERE id=? AND workspace_id=? AND employee_id=?').get(payload.conversationId,workspaceId,employeeId)) throw botFailure('BOT_CONVERSATION_CONFLICT','Bot 会话归属不一致');
  if (payload.hermesBot && (payload.hermesBot.revision !== row.revision || payload.hermesBot.controlEpoch !== row.control_epoch)) throw botFailure('BOT_REVISION_CONFLICT','Bot 配置或控制状态已变化，请重新读取');
  if (!validation && (row.control_state !== 'active' || employee.status !== 'active')) throw botFailure('BOT_NOT_ACTIVE','Bot 未启用或已暂停');
  if (!validation && row.validated_revision !== row.revision) throw botFailure('BOT_NOT_VALIDATED','Bot 当前配置尚未通过目标电脑验证');
  if(!validation&&!readOnlyInspection){
    if(pendingBotFailureFinalization(db,workspaceId,employeeId))throw botFailure('BOT_FAILURE_FINALIZATION_PENDING','上次执行已按失败结束，正在由原电脑自动收尾；电脑连接后即可继续');
    const deferred=db.prepare("SELECT state,intent_json FROM bot_deferred_configs WHERE employee_id=? AND state IN ('pending','validating','connecting')").get(employeeId);
    if(deferred&&(!actionId||deferred.state!=='pending'||parse(deferred.intent_json)?.blocking?.id!==actionId))throw botFailure('BOT_DEFERRED_CONFIG_BUSY','已接受此员工的延后配置，等待原执行结束及配置、连接流程完成后再派新工作');
  }
  if (!readOnlyInspection && row.active_action_id && row.active_action_id !== actionId) {
    const active = db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(row.active_action_id);
    if (botExecutionOccupiesSlot(active,{workspaceId,employeeId,deviceId:employee.target_device_id,profile:employee.runtime_profile}) && !readHistoricalPrelaunchRecovery(db,active)) throw botFailure('BOT_BUSY','Bot 仍有在途或未确认停止的执行，请查询原回执');
  }
  return {row,employee,snapshot:botSnapshot(db,employeeId,workspaceId)};
}

export function createBotService(repo, management) {
  const db = repo.db;
  const managementAction=createBotManagementActionReader(repo);
  const rosterView=createBotRosterView(repo);
  const workbenchImages=createMobileReadView(repo);
  const workbenchAction=createBotWorkbenchActionReader(repo);
  const workspace = slug => { const ws = db.prepare('SELECT * FROM workspaces WHERE slug=?').get(slug); if (!ws) throw botFailure('WORKSPACE_NOT_FOUND','工作区不存在',404); return ws; };
  const scope = (slug,context={}) => {
    const ws=workspace(slug);
    if (context.actorUserId) {
      const member=db.prepare('SELECT role FROM members WHERE workspace_id=? AND user_id=?').get(ws.id,context.actorUserId);
      if (!member) throw botFailure('WORKSPACE_FORBIDDEN','当前身份不属于该工作区',403);
      context={...context,actorRole:member.role};
    }
    else if(!context.deviceCredentialDeviceId && !context.authenticatedMcp && db.prepare('PRAGMA database_list').all().find(item=>item.name==='main')?.file)throw botFailure('BOT_ACTOR_REQUIRED','Bot 管理需要当前认证用户或已授权设备身份',403);
    if(context.deviceCredentialDeviceId && context.deviceScope!==context.deviceCredentialDeviceId)throw botFailure('BOT_DEVICE_SCOPE_REQUIRED','设备管理凭据必须限制到当前设备',403);
    return {ws,context};
  };
  const resolve = (slug,id,context={}) => {
    const checked=scope(slug,context), employee=management.employee(slug,id,checked.context);
    if (context.deviceScope && employee.target_device_id !== context.deviceScope) throw botFailure('BOT_NOT_FOUND','Bot 不在当前电脑授权范围',404);
    const row=db.prepare('SELECT * FROM hermes_bots WHERE employee_id=? AND workspace_id=?').get(id,checked.ws.id);
    if (!row) throw botFailure('BOT_NOT_FOUND','Bot 不存在于当前工作区',404);
    return {...checked,employee,row};
  };
  const revision = (row,input) => { if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== row.revision) throw botFailure('BOT_REVISION_CONFLICT','expectedRevision 与当前 Bot 版本不一致'); };
  const atomic = fn => { db.exec('SAVEPOINT bot_write'); try { const result=fn();db.exec('RELEASE bot_write');return result; } catch(error) {db.exec('ROLLBACK TO bot_write; RELEASE bot_write');throw error;} };
  const idempotent = (slug,kind,input,context,create,read) => atomic(()=>{
    const {ws}=scope(slug,context), key=input.idempotencyKey;
    if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(key)) throw botFailure('IDEMPOTENCY_KEY_REQUIRED','必须提供稳定 idempotencyKey',400);
    const identity=`bot:${kind}:${context.actorUserId || context.deviceCredentialDeviceId || 'authorized-mcp'}`, digest=crypto.createHash('sha256').update(canonical(input)).digest('hex');
    const previous=db.prepare('SELECT * FROM management_requests WHERE workspace_id=? AND kind=? AND request_key=?').get(ws.id,identity,key);
    if (previous) {
      if (previous.fingerprint!==digest) throw botFailure('IDEMPOTENCY_CONFLICT','同一请求标识已用于不同参数');
      let saved; try {saved=read(previous.resource_id);} catch(error) {if(error.status!==404)throw error;}
      if (!saved) throw botFailure('IDEMPOTENCY_RESOURCE_GONE','原请求资源已被删除，不会重建');
      return {...saved,duplicate:true};
    }
    const result=create();
    db.prepare('INSERT INTO management_requests(workspace_id,kind,request_key,fingerprint,resource_id,created_at) VALUES(?,?,?,?,?,?)').run(ws.id,identity,key,digest,result.id,now());
    return result;
  });
  const capabilities = (slug,input={},context={}) => {
    scope(slug,context);
    const deferredConfiguration={schemaVersion:1,supported:true,operation:'update',required:['deferUntilIdle','expectedRevision','expectedControlEpoch','idempotencyKey'],optional:['employee','config','connectMcpServers'],projection:'deferredConfig',selfExecution:'submit_then_finish_current_turn',effectiveScope:'after_confirmed_idle',requiresClientUpdate:false};
    const device=management.discovery(slug,{deviceId:input.deviceId,userId:context.actorUserId,deviceScope:context.deviceScope}).devices.find(item=>item.id===input.deviceId) || null;
    const runtime=device?.runtimes.find(item=>item.name==='Hermes') || null;
    const integrated=new Set(['groups_mentions','delegation','gateway','voice','goals','heartbeat','kanban','bot_identity','persistent_chat','profile_memory','model_provider','skills','tools_mcp','routines','multimodal','session_search','observability']);
    if(repo.serverCodeRollout)return {schemaVersion:1,workspace:slug,deviceId:input.deviceId||null,device,runtime,deferredConfiguration:{...deferredConfiguration,supported:false},capabilities:BOT_CAPABILITY_CATALOG.map(([id,label])=>({id,label,status:'requires_configuration',configurable:integrated.has(id),reason:'等待客户端验证或更新；当前设备执行已关闭',evidence:['server-code-rollout-v1']}))};
    return {schemaVersion:1,workspace:slug,deviceId:input.deviceId || null,device,runtime,deferredConfiguration,capabilities:BOT_CAPABILITY_CATALOG.map(([id,label])=>({id,label,status:!integrated.has(id)?'not_integrated':(!runtime?'unknown':(!runtime.available?'requires_dependency':'requires_configuration')),configurable:integrated.has(id),reason:!integrated.has(id)?'原生能力尚未接入紫薇控制与结果链；不能由此入口启用':(!runtime?'目标电脑尚未提供 Hermes 发现证据':(!runtime.available?runtime.issues.map(item=>item.message).join('；'):'需保存配置并在目标电脑验证；执行成功由实际回执确认')),evidence:[...(runtime?.version?[`device_heartbeat:${runtime.version}`]:[]),'ziwei.bot.schema:1']}))};
  };
  const runs = (slug,id,context={},options={}) => {
    const {ws}=resolve(slug,id,context);
    return db.prepare("SELECT id FROM a2a_actions WHERE workspace_id=? AND CASE WHEN json_valid(payload_json) THEN json_extract(payload_json,'$.hermesBot.employeeId') END=? ORDER BY created_at DESC,rowid DESC LIMIT ?").all(ws.id,id,options?.limit===5?5:100).map(row=>repo.getA2AAction(row.id,{workspaceSlug:slug,...(options?.eventView?{eventView:options.eventView}:{})}));
  };
  const requestStop = (slug, action, prefix='bot-stop') => {
    const prior = db.prepare("SELECT * FROM a2a_actions WHERE workspace_id=? AND type='action.cancel' ORDER BY rowid DESC").all(action.workspace_id || workspace(slug).id).find(row=>parse(row.payload_json)?.actionId===action.id);
    if (prior && ['pending','acked'].includes(prior.status) && (!prior.expires_at || Date.parse(prior.expires_at)>Date.now())) return repo.getA2AAction(prior.id,{workspaceSlug:slug});
    return repo.createA2AAction(slug,{type:'action.cancel',dedupeKey:prior?`${prefix}:${action.id}:retry:${prior.id}`:`${prefix}:${action.id}`,payload:{actionId:action.id,deviceId:action.payload.deviceId}});
  };
  const phoneMcpConfiguration = (slug,employee) => {
    if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ziwei_connect_bindings'").get())return null;
    const cfg=db.prepare('SELECT enabled FROM employee_phone_mcp WHERE employee_id=? AND workspace_id=?').get(employee.id,employee.workspace_id);
    const binding=db.prepare('SELECT device_id,account_id FROM ziwei_connect_bindings WHERE employee_id=? AND workspace_id=?').get(employee.id,employee.workspace_id);
    const skill=repo.listSkills(slug).find(item=>item.catalog_id==='ziwei-phone-control');
    const installed=Boolean(skill?.installed),attached=Boolean(installed&&employee.skills?.includes(skill.id));
    const enabled=Boolean(cfg?.enabled&&attached&&binding);
    // Match phone-mcp.configuration and executionPayload using current skill/binding data,
    // rather than the saved hash, which predates later skill or phone changes.
    const revision=crypto.createHash('sha256').update(JSON.stringify([enabled,skill?.id||null,skill?.version||null,employee.target_device_id,employee.runtime,employee.runtime_profile,binding?.device_id||null,binding?.account_id||null])).digest('hex');
    return{workspace:slug,employeeId:employee.id,enabled,installed,attached,bound:Boolean(binding),revision,targetDeviceId:employee.target_device_id,runtime:employee.runtime,runtimeProfile:employee.runtime_profile,phoneDeviceId:binding?.device_id||null};
  };
  const get = (slug,id,context={},options={}) => {
    const workbench=options?.view==='workbench',compact=workbench||options?.view==='management'||context.authenticatedMcp===true||context.botManagementRead===true;
    const employeeView=employee=>workbench?workbenchImages.employee(slug,employee):compact?managementEmployeeView(employee):employee;
    const {context:actor}=scope(slug,context), existingEmployee=management.employee(slug,id,actor);
    if(actor.deviceScope && existingEmployee.target_device_id!==actor.deviceScope)throw botFailure('BOT_NOT_FOUND','Bot 不在当前电脑授权范围',404);
    if(!db.prepare('SELECT 1 FROM hermes_bots WHERE employee_id=?').get(id)) {
      if(existingEmployee.runtime!=='Hermes')throw botFailure('BOT_RUNTIME_UNSUPPORTED','此员工没有 Hermes Bot 能力',400);
      const isCreator=Boolean(db.prepare("SELECT 1 FROM employee_template_instances WHERE employee_id=? AND template_id='ziwei-employee-creator'").get(id));
      const conversation=db.prepare('SELECT id FROM conversations WHERE employee_id=? AND workspace_id=? ORDER BY updated_at DESC LIMIT 1').get(id,existingEmployee.workspace_id);
      const environment=capabilities(slug,{deviceId:existingEmployee.target_device_id},actor),view={id,employee_id:id,workspace:slug,employee:employeeView(existingEmployee),configuration_state:'uninitialized',kind:isCreator?'creator':'employee',config:createDefaultBotConfig(),revision:0,control_epoch:0,control_state:existingEmployee.status==='paused'?'paused':'draft',main_conversation_id:conversation?.id || null,scheduler_authority:'ziwei',validation:{status:'not_checked',action_id:null,revision:null,error:null},latest_run:null,effect:{savedRevision:0,validatedRevision:null,scope:'not_initialized',pendingReason:isCreator?'Creator 保持原管理身份；普通岗位 Bot 初始化不适用':'从同一员工记录初始化 Bot 能力；不会新建员工或复制旧记忆'}};
      return{...view,...deriveBotCapabilities({bot:view,capabilities:environment.capabilities,device:environment.device,runtime:environment.runtime})};
    }
    // Configuration/workbench reads carry bounded execution facts. Original
    // action/native-resource endpoints keep all text, content and event bodies.
    // The default desktop/mobile contracts remain unchanged.
    const mobile=options?.view==='mobile',workspaceId=existingEmployee.workspace_id;
    const actionCache=new Map(),readAction=(actionId,eventView='none')=>{
      if(!compact)return repo.getA2AAction(actionId,{workspaceSlug:slug,...(mobile?{eventView}:{})});
      if(!actionCache.has(actionId))actionCache.set(actionId,(workbench?workbenchAction:managementAction)(actionId,workspaceId));
      return actionCache.get(actionId);
    };
    const {row,employee}=resolve(slug,id,context), validationAction=row.validation_action_id?readAction(row.validation_action_id):null;
    const validationStatus=!validationAction?'not_checked':validationAction.payload.hermesBot.revision!==row.revision?'stale':validationAction.status==='succeeded'&&row.validated_revision===row.revision?'succeeded':validationAction.status==='succeeded'&&validationAction.payload.hermesBot.controlEpoch!==row.control_epoch?'stale':['failed','expired','succeeded'].includes(validationAction.status)?'failed':'pending';
    const latest=compact?db.prepare("SELECT id FROM a2a_actions WHERE workspace_id=? AND CASE WHEN json_valid(payload_json) THEN json_extract(payload_json,'$.hermesBot.employeeId') END=? ORDER BY created_at DESC,rowid DESC LIMIT 1").get(workspaceId,id):null;
    const configured=validationStatus==='succeeded', botRuns=workbench?db.prepare("SELECT id FROM a2a_actions WHERE workspace_id=? AND CASE WHEN json_valid(payload_json) THEN json_extract(payload_json,'$.hermesBot.employeeId') END=? ORDER BY created_at DESC,rowid DESC LIMIT 100").all(workspaceId,id).map(action=>readAction(action.id)):compact?(latest?[readAction(latest.id)]:[]):runs(slug,id,context,mobile?{eventView:'none'}:undefined),nativeResources={};
    const resourceRuns=compact&&!workbench?db.prepare(`SELECT id FROM a2a_actions WHERE rowid IN (
      SELECT max(rowid) FROM a2a_actions WHERE workspace_id=? AND type='hermes.bot.native' AND json_valid(payload_json)
      AND status IN ('succeeded','failed','expired') AND result_json IS NOT NULL
      AND json_extract(payload_json,'$.employeeId')=?
      AND json_extract(payload_json,'$.hermesBot.revision')=?
      GROUP BY json_extract(payload_json,'$.nativeOperation.resource')
    ) ORDER BY created_at DESC,rowid DESC LIMIT 20`).all(workspaceId,id,row.revision).map(action=>readAction(action.id)):botRuns;
    for(const action of resourceRuns){const receipt=action.result?.nativeOperation || action.result?.result?.nativeOperation;if(receipt?.revision===row.revision&&(!compact||receipt.employeeId===id&&receipt.resource===action.payload?.nativeOperation?.resource)&&!nativeResources[receipt.resource])nativeResources[receipt.resource]={...receipt,actionId:action.id,actionStatus:action.status,completedAt:action.completed_at,...(compact?{managementSummary:action.managementSummary}:{})};}
    const environment=capabilities(slug,{deviceId:employee.target_device_id},context),botCapabilities=environment.capabilities.map(item=>({...item,...(!repo.serverCodeRollout && configured && item.status==='requires_configuration' && ['bot_identity','persistent_chat','profile_memory','model_provider','routines','observability'].includes(item.id)?{status:'available',evidence:[...item.evidence,`validation:${row.validation_action_id}:revision:${row.revision}`]}:{})}));
    const view={id,employee_id:id,workspace:slug,active_action_id:row.active_action_id,failureFinalization:pendingBotFailureFinalization(db,workspaceId,id),employee:employeeView(employee),instance:botProfileView(db,row,employee),configuration_state:'initialized',kind:'employee',config:parse(row.config_json),revision:row.revision,control_state:row.control_state,control_epoch:row.control_epoch,main_conversation_id:row.main_conversation_id,nativeResources,scheduler_authority:'ziwei',validation:{status:validationStatus,action_id:row.validation_action_id,revision:validationAction?.payload?.hermesBot?.revision ?? null,error:validationAction?.error || null},latest_run:mobile&&botRuns[0]?readAction(botRuns[0].id,'mobile'):botRuns[0] || null,stop_action:row.stop_action_id?readAction(row.stop_action_id,'mobile'):null,effect:{savedRevision:row.revision,validatedRevision:row.validated_revision,scope:repo.serverCodeRollout?'draft_waiting_client':'next_execution',executionAdmission:repo.serverCodeRollout?.status()||null,pendingReason:repo.serverCodeRollout?'等待客户端验证或更新；专属 Profile/HOME 仅保存规划，尚未在电脑创建':row.validated_revision!==row.revision?'目标电脑尚未验证本版本':row.control_state!=='active'?'Bot 尚未启用':null}};
    const savedRoutines=compact?db.prepare('SELECT a.id,a.status,a.next_run FROM automations a JOIN bot_routines r ON r.automation_id=a.id WHERE r.employee_id=?').all(id):db.prepare('SELECT automation_id FROM bot_routines WHERE employee_id=?').all(id).map(item=>routine(slug,id,item.automation_id,context));
    const activeAction=row.active_action_id?botRuns.find(action=>action.id===row.active_action_id)||readAction(row.active_action_id):null;
    const evidenceActions=compact?[...new Map([...botRuns,...resourceRuns,validationAction,activeAction].filter(Boolean).map(action=>[action.id,action])).values()]:botRuns;
    return{...view,...(compact?{[workbench?'workbenchView':'managementView']:{schemaVersion:1,historyIncluded:false,nativeContentIncluded:false,capabilityEvidence:'bounded_summary',nativeResourceLimit:workbench?100:20,fullActionOperation:workbench?'GET action by id':'ziwei_get_action'},active_run:activeAction,validation:{...view.validation,receipt:validationAction?.result?.botValidation||null}}:{}),deferredConfig:deferredConfig.latest(row.workspace_id,id),...deriveBotCapabilities({bot:view,capabilities:botCapabilities,device:environment.device,runtime:environment.runtime,actions:evidenceActions,activeAction,routines:savedRoutines,phoneMcp:phoneMcpConfiguration(slug,employee)})};
  };
  const routine = (slug,id,autoId,context={}) => {const {ws}=resolve(slug,id,context);const binding=db.prepare('SELECT * FROM bot_routines WHERE automation_id=? AND employee_id=? AND workspace_id=?').get(autoId,id,ws.id);if(!binding)throw botFailure('ROUTINE_NOT_FOUND','Routine 不属于当前 Bot',404);return {...repo.getAutomation(slug,autoId),...binding,last_result:repo.listAutomationRuns(autoId)[0] || null};};
  let service;
  const deferredConfig=createBotDeferredConfig(repo,{resolve,get:(slug,id,context)=>get(slug,id,context,{view:'management'}),update:(slug,id,input,context)=>service.update(slug,id,input,{...context,botManagementRead:true}),validate:(...args)=>service.validate(...args),control:(slug,id,input,context)=>service.control(slug,id,input,{...context,botManagementRead:true})});
  service=guardBotService(repo,{
    deferredConfig,
    capabilities,get,runs,
    reconcile(slug,id,actionId,input={},context={}) { return atomic(()=>{
      if (Object.keys(input).some(key=>!['eventId','expectedRevision','expectedControlEpoch'].includes(key))) throw botFailure('BOT_RECOVERY_INPUT_INVALID','核实只接受原服务器事件标识与当前配置版本，不接受自填结果或退出证明',400);
      const {row}=resolve(slug,id,context);revision(row,input);
      if(input.expectedControlEpoch!==row.control_epoch)throw botFailure('BOT_CONTROL_CONFLICT','expectedControlEpoch 已变化；请刷新后再核实原执行');
      management.action(slug,actionId,context);
      const action=repo.reconcileBotActionFromEvent(actionId,{eventId:input.eventId,workspaceSlug:slug,employeeId:id});
      return {...get(slug,id,context),reconciliation:{actionId:action.id,eventId:input.eventId,status:action.status,duplicate:Boolean(action.duplicate)}};
    });},
    native(slug,id,input={},context={}) {return {action:idempotent(slug,`native:${id}`,input,context,()=>{
      if(Object.keys(input).some(key=>!['expectedRevision','expectedControlEpoch','idempotencyKey','resource','operation','input','workspace'].includes(key)))throw botFailure('BOT_NATIVE_INPUT_INVALID','原生请求包含未知字段',400);
      if(input.workspace&&input.workspace!==slug)throw botFailure('BOT_WORKSPACE_CONFLICT','原生请求工作区不一致',403);
      let {row,employee}=resolve(slug,id,context);revision(row,input);
      if(input.expectedControlEpoch!==row.control_epoch)throw botFailure('BOT_CONTROL_CONFLICT','expectedControlEpoch 已变化');
      const nativeOperation=normalizeNativeOperation(input);
      if(nativeOperation.resource==='collaboration')throw botFailure('BOT_COLLABORATION_ROUTE_REQUIRED','协作需要经过工作区员工目标检查');
      if(nativeIsExecution(nativeOperation))assertBotExecution(db,row.workspace_id,{employeeId:id});
      else assertBotExecution(db,row.workspace_id,{employeeId:id},{validation:true});
      const config=parse(row.config_json);
      if(nativeNeedsTools(nativeOperation)&&config.permissions.mode!=='execute')throw botFailure('BOT_PERMISSION_CONFLICT','此原生操作需要明确 execute 权限');
      if(nativeOperation.resource==='groups'&&nativeOperation.operation==='step'&&(!config.collaboration?.enabled||config.permissions.mode!=='execute'))throw botFailure('BOT_PERMISSION_CONFLICT','群聊推进需要明确协作授权');
      if(nativeOperation.resource==='skills'&&['enable','disable'].includes(nativeOperation.operation)) {
        const disabled=new Set(config.skills.disabled);if(nativeOperation.operation==='disable')disabled.add(nativeOperation.input.name);else disabled.delete(nativeOperation.input.name);
        config.skills.disabled=[...disabled];this.update(slug,id,{expectedRevision:row.revision,config},context);({row,employee}=resolve(slug,id,context));
      }
      if(['gateway','voice'].includes(nativeOperation.resource)&&nativeOperation.operation==='configure') {config[nativeOperation.resource]=nativeOperation.input.config;this.update(slug,id,{expectedRevision:row.revision,config},context);({row,employee}=resolve(slug,id,context));}
      management.validateSelection(slug,{runtime:'Hermes',targetDeviceId:employee.target_device_id,runtimeProfile:employee.runtime_profile},{context,requireProfile:botProfileBinding(row).mode!=='owned_profile'});
      return repo.createA2AAction(slug,{type:'hermes.bot.native',payload:{employeeId:id,nativeOperation:{...nativeOperation,requestId:input.idempotencyKey}},dedupeKey:`bot-native:${id}:${input.idempotencyKey}`,botInternal:BOT_INTERNAL});
    },actionId=>management.action(slug,actionId,context))};},
    collaboration(slug,id,input={},context={}) {return atomic(()=>{
      const {row,employee}=resolve(slug,id,context);revision(row,input);
      if(input.expectedControlEpoch!==row.control_epoch)throw botFailure('BOT_CONTROL_CONFLICT','expectedControlEpoch 已变化');
      const source=input.sourceActionId?repo.getA2AAction(input.sourceActionId,{workspaceSlug:slug}):null;
      if(input.sourceActionId&&(!source||source.status!=='acked'||source.payload.hermesBot?.employeeId!==id))throw botFailure('BOT_SOURCE_ACTION_INVALID','协作来源不是当前 Bot 的在途 action');
      assertBotExecution(db,row.workspace_id,{employeeId:id,...(source?{hermesBot:source.payload.hermesBot}:{})},{actionId:source?.id});
      const config=parse(row.config_json);
      if(config.permissions.mode!=='execute'||!config.collaboration?.enabled)throw botFailure('BOT_PERMISSION_CONFLICT','先明确启用 Bot 协作与 execute 权限');
      if(input.operation==='list'&&source)return {actions:repo.listA2AActions(slug,{status:'all'}).filter(action=>action.payload.collaboration?.sourceActionId===source.id)};
      const ids=[...new Set(input.targetEmployeeIds || [])];
      if(!ids.length||ids.length>5||ids.includes(id)||!['message','delegate','group'].includes(input.mode || 'message')||typeof input.content!=='string'||!input.content.trim()||input.content.length>20000)throw botFailure('BOT_COLLABORATION_INVALID','协作需要1–5个明确目标和内容',400);
      const targets=ids.map(target=>{if(!config.collaboration.targetEmployeeIds.includes(target))throw botFailure('BOT_TARGET_NOT_AUTHORIZED','协作目标未在此 Bot 配置授权');const checked=resolve(slug,target,{...context,actorUserId:context.actorUserId || employee.owner_user_id,deviceScope:null,deviceCredentialDeviceId:null,authenticatedMcp:true});const bot=assertBotExecution(db,row.workspace_id,{employeeId:target});return{id:target,name:checked.employee.name,revision:bot.row.revision,controlEpoch:bot.row.control_epoch,conversationId:bot.row.main_conversation_id};});
      const groupId=input.groupId || (input.mode==='group'?`group_${crypto.createHash('sha256').update(`${id}:${input.idempotencyKey}`).digest('hex').slice(0,20)}`:null);
      if(groupId&&!/^group_[A-Za-z0-9_-]{1,80}$/.test(groupId))throw botFailure('BOT_COLLABORATION_INVALID','groupId 无效',400);
      if(input.nativeTask&&(!source||input.nativeTask.identity?.room_id!==groupId||targets.length!==1||input.nativeTask.payload?.target_member_id!==targets[0].id||input.nativeTask.payload?.prompt!==input.content))throw botFailure('BOT_NATIVE_GROUP_PLAN_INVALID','原生群聊计划、目标或prompt不一致');
      const manifest={sourceEmployeeId:id,sourceActionId:source?.id || null,mode:input.mode || 'message',content:input.content,groupId,targets,...(input.nativeTask?{nativeTask:input.nativeTask}:{})};
      if(source)return {actions:repo.dispatchBotCollaboration(slug,manifest,input.idempotencyKey)};
      return {action:idempotent(slug,`collaboration:${id}`,input,context,()=>repo.createA2AAction(slug,{type:'hermes.bot.native',botInternal:BOT_INTERNAL,dedupeKey:`bot-collaboration:${id}:${input.idempotencyKey}`,payload:{employeeId:id,collaborationManifest:manifest,nativeOperation:{schemaVersion:2,resource:'collaboration',operation:'message',requestId:input.idempotencyKey,input:{targets,content:input.content,mode:manifest.mode,...(groupId?{groupId}:{})}}}}),actionId=>management.action(slug,actionId,context))};
    });},
    list(slug,context={},options={}) {const {ws,context:actor}=scope(slug,context),employees=repo.listEmployees(slug,{...actor,enforceEmployeeVisibility:true}).filter(employee=>employee.runtime==='Hermes'&&employee.status!=='deleted'&&(!actor.deviceScope||employee.target_device_id===actor.deviceScope));return options.view==='roster'?rosterView(slug,ws.id,employees):employees.map(employee=>get(slug,employee.id,actor,options));},
    initialize(slug,id,input={},context={}) {
      return idempotent(slug,`initialize:${id}`,input,context,()=>{
        const {context:actor}=scope(slug,context),employee=management.employee(slug,id,actor);
        if(employee.runtime!=='Hermes')throw botFailure('BOT_RUNTIME_UNSUPPORTED','只允许给 Hermes 岗位员工初始化 Bot 能力',400);
        if(db.prepare("SELECT 1 FROM employee_template_instances WHERE employee_id=? AND template_id='ziwei-employee-creator'").get(id))throw botFailure('CREATOR_BOT_INITIALIZATION_UNSUPPORTED','Creator 保持受信管理者身份；使用它创建普通岗位 Bot',409);
        if(db.prepare('SELECT 1 FROM hermes_bots WHERE employee_id=?').get(id)) {
          const saved=get(slug,id,actor);
          if(input.config && canonical(normalizeBotConfig(input.config))!==canonical(saved.config))throw botFailure('BOT_ALREADY_INITIALIZED','Bot 已初始化；修改配置请使用版本化编辑入口');
          return {...saved,duplicate:true};
        }
        const inFlight=db.prepare('SELECT * FROM a2a_actions WHERE workspace_id=?').all(employee.workspace_id).some(row=>parse(row.payload_json)?.employeeId===id && botExecutionOccupiesSlot(row,{workspaceId:employee.workspace_id,employeeId:id,deviceId:employee.target_device_id,profile:employee.runtime_profile}) && !readHistoricalPrelaunchRecovery(db,row));
        if(inFlight)throw botFailure('BOT_BUSY','员工仍有在途动作，先核对原回执再初始化');
        const conversation=db.prepare("SELECT id,device_id,model_id FROM conversations WHERE employee_id=? AND workspace_id=? AND status='active' ORDER BY updated_at DESC LIMIT 1").get(id,employee.workspace_id) || management.createConversation(slug,{employeeId:id,title:`${employee.name} · 主聊天`},actor);
        if(conversation.device_id && conversation.device_id!==employee.target_device_id || conversation.model_id && conversation.model_id!==employee.model_id)throw botFailure('BOT_CONVERSATION_CONFLICT','现有主聊天模型或电脑与员工绑定不一致，请先核对聊天设置');
        const stamp=now();db.prepare('INSERT INTO hermes_bots(employee_id,workspace_id,config_json,main_conversation_id,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,employee.workspace_id,JSON.stringify(createDefaultBotConfig(input.config || {})),conversation.id,stamp,stamp);
        db.prepare("UPDATE employees SET status='draft' WHERE id=?").run(id);
        return get(slug,id,actor);
      },savedId=>get(slug,savedId,context));
    },
    create(slug,input={},context={}) {
      const allowed=['idempotencyKey','name','targetDeviceId','runtimeProfile','sourceProfile','runtime','model','persona','description','instructions','visibility','skills','avatar','config','workspace'];
      if(Object.keys(input).some(key=>!allowed.includes(key)))throw botFailure('BOT_CREATE_UNSUPPORTED','Bot 创建包含未支持字段；身份与归属由当前认证工作区决定',400);
      if(input.workspace && input.workspace!==slug)throw botFailure('BOT_WORKSPACE_CONFLICT','请求与认证工作区不一致',403);
      const config=createDefaultBotConfig(input.config || {});
      if (input.runtime && input.runtime!=='Hermes') throw botFailure('BOT_RUNTIME_UNSUPPORTED','Bot 目标运行时必须为 Hermes',400);
      if(input.sourceProfile&&input.runtimeProfile&&input.sourceProfile!==input.runtimeProfile)throw botFailure('BOT_BINDING_CONFLICT','sourceProfile 与 runtimeProfile 初始化来源不一致');
      return idempotent(slug,'create',input,context,()=>{
        const {context:actor}=scope(slug,context);
        const sourceProfile=String(input.sourceProfile || input.runtimeProfile || '').trim();
        const template=management.discovery(slug,{deviceId:input.targetDeviceId,userId:actor.actorUserId,deviceScope:actor.deviceScope}).devices[0]?.runtimes.find(runtime=>runtime.name==='Hermes')?.profiles.find(profile=>profile.name===sourceProfile);
        if(template?.initialization_source===false)throw botFailure('BOT_PROFILE_TEMPLATE_UNSUPPORTED','另一个 owned Bot 不能作为初始化来源；请选择 default 或普通原生 Profile',400);
        const employee=management.createEmployee(slug,{...input,runtimeProfile:input.sourceProfile || input.runtimeProfile,config:undefined,runtime:'Hermes',ownerUserId:actor.actorUserId,status:'draft',idempotencyKey:`bot:${actor.actorUserId || actor.deviceCredentialDeviceId || 'authorized-mcp'}:${input.idempotencyKey}`},actor);
        const conversation=management.createConversation(slug,{employeeId:employee.id,title:`${employee.name} · 主聊天`},actor);
        const stamp=now();db.prepare('INSERT INTO hermes_bots(employee_id,workspace_id,config_json,main_conversation_id,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(employee.id,employee.workspace_id,JSON.stringify(config),conversation.id,stamp,stamp);
        const binding={mode:'owned_profile',...(repo.serverCodeRollout?{waitingForClient:true}:{}),profile:'bot-'+crypto.createHash('sha256').update(JSON.stringify([slug,employee.id,employee.target_device_id])).digest('hex').slice(0,24),templateProfile:employee.runtime_profile,ownershipId:crypto.randomUUID()};
        db.prepare('UPDATE employees SET runtime_profile=? WHERE id=?').run(binding.profile,employee.id);
        db.prepare('UPDATE hermes_bots SET profile_binding_json=? WHERE employee_id=?').run(JSON.stringify(binding),employee.id);
        if(repo.serverCodeRollout)return get(slug,employee.id,actor);
        const action=repo.createA2AAction(slug,{type:'hermes.bot.provision',payload:{employeeId:employee.id},dedupeKey:`bot-provision:${employee.id}:initial`,botInternal:BOT_INTERNAL});
        binding.provisionActionId=action.id;
        db.prepare('UPDATE hermes_bots SET profile_binding_json=? WHERE employee_id=?').run(JSON.stringify(binding),employee.id);
        action.payload.hermesBot.instance=binding;
        db.prepare('UPDATE a2a_actions SET payload_json=? WHERE id=?').run(JSON.stringify(action.payload),action.id);
        db.prepare('UPDATE hermes_bots SET provision_action_id=? WHERE employee_id=?').run(action.id,employee.id);
        return get(slug,employee.id,actor);
      },id=>get(slug,id,context));
    },
    provision(slug,id,input={},context={}) {repo.serverCodeRollout?.assertExecution();
      const {row,employee}=resolve(slug,id,context);revision(row,input);
      if(botProfileBinding(row).mode!=='owned_profile')throw botFailure('BOT_PROFILE_MODE_INVALID','现有 Bot 不自动迁移到 owned Profile');
      const current=botProfileView(db,row,employee);
      if(['pending','acked','uncertain','provisioned'].includes(current.provisioning.status))return{action:management.action(slug,current.provisioning.actionId,context),duplicate:true};
      return{action:idempotent(slug,`provision:${id}`,input,context,()=>{
        const action=repo.createA2AAction(slug,{type:'hermes.bot.provision',payload:{employeeId:id},dedupeKey:`bot-provision:${id}:${input.idempotencyKey}`,botInternal:BOT_INTERNAL});
        db.prepare('UPDATE hermes_bots SET provision_action_id=? WHERE employee_id=?').run(action.id,id);return action;
      },actionId=>management.action(slug,actionId,context))};
    },
    update(slug,id,input={},context={}) {return atomic(()=>{
      if(input.deferUntilIdle===true)return deferredConfig.enqueue(slug,id,input,context);
      if(input.deferUntilIdle!==undefined&&input.deferUntilIdle!==false||input.connectMcpServers!==undefined)throw botFailure('BOT_DEFERRED_INPUT_INVALID','自动连接 MCP 需要明确 deferUntilIdle:true');
      const {row,employee}=resolve(slug,id,context);revision(row,input);
      const patch=input.employee || {};
      const allowed=['name','avatar','description','persona','instructions','skills','model','visibility'];
      if(Object.keys(patch).some(key=>!allowed.includes(key)))throw botFailure('BOT_PATCH_UNSUPPORTED','Bot 员工修改仅支持 name/avatar/description/persona/instructions/skills/model/visibility；电脑/profile迁移不允许隐式执行',400);
      const config=input.config===undefined?parse(row.config_json):normalizeBotConfig(input.config);
      const runtimeChanged=canonical(config)!==canonical(parse(row.config_json)) || ['persona','instructions','skills','model'].some(key=>Object.hasOwn(patch,key)&&canonical(patch[key])!==canonical(key==='model'?employee.model_id:employee[key]));
      if(runtimeChanged)assertBotExecution(db,row.workspace_id,{employeeId:id},{validation:true});
      if(Object.keys(patch).length)management.updateEmployee(slug,id,patch,{...context,botConfigurationWrite:true});
      if(runtimeChanged)db.prepare("UPDATE hermes_bots SET config_json=?,revision=revision+1,control_state='draft',control_epoch=control_epoch+1,validated_revision=NULL,updated_at=? WHERE employee_id=?").run(JSON.stringify(config),now(),id);
      if(runtimeChanged)db.prepare("UPDATE employees SET status='draft' WHERE id=?").run(id);
      else db.prepare('UPDATE hermes_bots SET updated_at=? WHERE employee_id=?').run(now(),id);
      return get(slug,id,context);
    });},
    validate(slug,id,input={},context={}) {repo.serverCodeRollout?.assertExecution();resolve(slug,id,context);return {action:idempotent(slug,`validate:${id}`,input,context,()=>{
      const {row,employee}=resolve(slug,id,context);revision(row,input);
      assertBotProfileReady(db,row,employee);
      management.validateSelection(slug,{runtime:'Hermes',targetDeviceId:employee.target_device_id,runtimeProfile:employee.runtime_profile},{context,requireProfile:botProfileBinding(row).mode!=='owned_profile'});
      const action=repo.createA2AAction(slug,{type:'hermes.bot.validate',payload:{employeeId:id},dedupeKey:`bot-validate:${id}:${row.revision}:${input.idempotencyKey}`,botInternal:BOT_INTERNAL});
      db.prepare('UPDATE hermes_bots SET validation_action_id=? WHERE employee_id=?').run(action.id,id);return action;
    },actionId=>management.action(slug,actionId,context))};},
    control(slug,id,input={},context={}) {if(repo.serverCodeRollout && input.operation!=='pause')repo.serverCodeRollout.assertExecution();return atomic(()=>{
      const {row,employee}=resolve(slug,id,context);revision(row,input);
      if(input.expectedControlEpoch!==row.control_epoch)throw botFailure('BOT_CONTROL_CONFLICT','expectedControlEpoch 已变化；请刷新后再控制 Bot');
      if(!['activate','resume','pause','stop'].includes(input.operation))throw botFailure('BOT_CONTROL_INVALID','控制操作无效',400);
      if(repo.serverCodeRollout){db.prepare("UPDATE hermes_bots SET control_state='paused',control_epoch=control_epoch+1,updated_at=? WHERE employee_id=?").run(now(),id);db.prepare("UPDATE employees SET status='paused' WHERE id=?").run(id);return get(slug,id,context);}
      if(['activate','resume'].includes(input.operation)) {
        assertBotExecution(db,row.workspace_id,{employeeId:id},{validation:true});
        if(row.validated_revision!==row.revision)throw botFailure('BOT_NOT_VALIDATED','先验证当前配置，再明确启用');
        db.prepare("UPDATE hermes_bots SET control_state='active',control_epoch=control_epoch+1,updated_at=? WHERE employee_id=?").run(now(),id);
        db.prepare("UPDATE employees SET status='active' WHERE id=?").run(id);
        for(const routineRow of db.prepare("SELECT a.id FROM automations a JOIN bot_routines r ON r.automation_id=a.id WHERE r.employee_id=? AND a.status='active'").all(id))repo.updateAutomation(routineRow.id,{});
      } else {
        db.prepare("UPDATE hermes_bots SET control_state='paused',control_epoch=control_epoch+1,updated_at=? WHERE employee_id=?").run(now(),id);
        db.prepare("UPDATE employees SET status='paused' WHERE id=?").run(id);
        const active=row.active_action_id?repo.getA2AAction(row.active_action_id,{workspaceSlug:slug}):null;
        if(active?.status==='pending')repo.resultA2AAction(active.id,{status:'failed',error:'Bot 已暂停，未启动本次执行',result:{code:'BOT_CANCELLED_BEFORE_START',stopConfirmed:true}});
        else if(input.operation==='stop' && botExecutionOccupiesSlot(active,{workspace:slug,workspaceId:row.workspace_id,employeeId:id,deviceId:employee.target_device_id,profile:employee.runtime_profile}) && !readHistoricalPrelaunchRecovery(db,db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(active.id))) {
          const stop=requestStop(slug,active);
          db.prepare('UPDATE hermes_bots SET stop_action_id=? WHERE employee_id=?').run(stop.id,id);
        }
        if(input.operation==='stop')for(const descendant of repo.listA2AActions(slug,{status:'all'}).filter(action=>action.payload.collaboration?.sourceEmployeeId===id&&botExecutionOccupiesSlot(action,{workspace:slug})&&!readHistoricalPrelaunchRecovery(db,db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(action.id)))){if(descendant.status==='pending')repo.resultA2AAction(descendant.id,{status:'failed',error:'来源 Bot 已停止，协作未启动',result:{stopConfirmed:true}});else requestStop(slug,descendant,'bot-stop-descendant');}
      }
      return get(slug,id,context);
    });},
    routines(slug,id,context={}) {resolve(slug,id,context);return db.prepare('SELECT automation_id FROM bot_routines WHERE employee_id=?').all(id).map(item=>routine(slug,id,item.automation_id,context));},
    createRoutine(slug,id,input={},context={}) {resolve(slug,id,context);return idempotent(slug,`routine:${id}`,input,context,()=>{
      const {row}=resolve(slug,id,context);
      let driver=null;if(input.nativeDriver){driver=normalizeNativeOperation(input.nativeDriver);if(!['goals.step','heartbeat.step','kanban.dispatch','groups.step'].includes(`${driver.resource}.${driver.operation}`))throw botFailure('BOT_DRIVER_INVALID','Routine 原生驱动只允许有界推进',400);}
      if(!driver&&!String(input.prompt||'').trim())throw botFailure('ROUTINE_PROMPT_REQUIRED','Routine 需要工作指令',400);
      new Intl.DateTimeFormat('en',{timeZone:input.timezone || 'Asia/Shanghai'}).format();
      const auto=repo.createAutomation(slug,{...input,prompt:driver?`Hermes ${driver.resource} 有限推进`:input.prompt,maxRetries:0});db.prepare("UPDATE automations SET executor='ziwei_bot' WHERE id=?").run(auto.id);db.prepare('INSERT INTO bot_routines(automation_id,employee_id,workspace_id,conversation_id,native_driver_json) VALUES(?,?,?,?,?)').run(auto.id,id,row.workspace_id,row.main_conversation_id,driver?JSON.stringify(driver):null);
      return routine(slug,id,auto.id,context);
    },autoId=>routine(slug,id,autoId,context));},
    updateRoutine(slug,id,autoId,input={},context={}) {routine(slug,id,autoId,context);repo.updateAutomation(autoId,input);return routine(slug,id,autoId,context);},
    deleteRoutine(slug,id,autoId,context={}) {routine(slug,id,autoId,context);return repo.deleteAutomation(autoId);},
    runRoutine(slug,id,autoId,input={},context={}) {routine(slug,id,autoId,context);return idempotent(slug,`routine-run:${autoId}`,input,context,()=>repo.runAutomation(autoId,'manual'),runId=>repo.listAutomationRuns(autoId).find(item=>item.id===runId));},
  });
  return service;
}
