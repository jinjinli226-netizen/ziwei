import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {PRODUCT_ROLE,executionBinding} from '../src/execution-admission.mjs';
import {nativeActionDigest} from './preservation-native-databases.mjs';

// This constant is changed only by the baseline exporter. Environment variables
// and action payloads cannot turn a V1 compatibility package into a V2 executor.
export {PRODUCT_ROLE};
export const FROZEN_VERSIONS = Object.freeze({v1:'2ebe3dfee2f438a0b6aa3045d46c83bb67d7341b',v1Client:'324731e79c6a855fad1f501379630bbfa67e5d34',v2:'5643d5d36c3cd85d74ab849c77f52b6f69555093'});
const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
export const digest=value=>crypto.createHash('sha256').update(canonical(value)).digest('hex');
export function preservationError(code,message,status=409,details) {return Object.assign(new Error(message),{code,status,...(details?{details}:{})});}
const fail=(code,message,details)=>{throw preservationError(code,message,409,details);};
const exists=(db,table)=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
const all=(db,table)=>exists(db,table)?db.prepare(`SELECT * FROM ${table}`).all():[];
export function uncertain(value) {
  if(!value||typeof value!=='object')return false;
  if(value.code==='EXECUTION_UNCERTAIN'||value.executionState==='uncertain'||value.status==='uncertain')return true;
  return Object.values(value).some(item=>Array.isArray(item)?item.some(uncertain):uncertain(item));
}
export function exitedTree(value) {
  if(!value||value.treeConfirmed!==true||value.activeProcesses!==0||value.failureCode)return false;
  if(Array.isArray(value.children))return value.supervisor==='runtime-group'&&value.rootConfirmed===true&&typeof value.launched==='boolean'&&(value.launched===false||value.children.length>0)&&value.children.every(child=>exitedTree(child.processExit||child));
  if(value.launched===false)return value.rootPid===null&&value.rootExitCode===null;
  return value.launched===true&&value.rootConfirmed===true&&Number.isInteger(value.rootPid)&&value.rootPid>0&&Number.isInteger(value.rootExitCode);
}
export function executionExit(value) {
  const result=value?.result||value;
  const operation=result?.nativeOperation;
  const worker=operation?.data?.residentWorker,proof=result?.residentExit;
  const resident=operation?.resource==='gateway'&&worker&&proof&&digest(worker)===digest(proof.worker)&&worker.employeeId===operation.employeeId&&worker.revision===operation.revision&&proof.processExit?.rootPid===worker.rootPid?proof.processExit:null;
  if(operation?.resource==='gateway'&&worker){if(proof)return resident;const exit=operation.data?.processExit;return worker.employeeId===operation.employeeId&&worker.revision===operation.revision&&exit?.rootPid===worker.rootPid?exit:null;}
  return result?.processExit||result?.result?.processExit||resident||(operation?.resource==='gateway'&&['connect','disconnect'].includes(operation.operation)?operation.data?.processExit:null);
}
export function gatewayResultMatches(action,result){const p=parse(action.payload_json)||action.payload||{},operation=p.nativeOperation,receipt=result?.nativeOperation,worker=receipt?.data?.residentWorker;return action.type==='hermes.bot.native'&&operation?.resource==='gateway'&&receipt?.resource==='gateway'&&operation.operation===receipt.operation&&p.employeeId===receipt.employeeId&&p.hermesBot?.revision===receipt.revision&&(!worker||worker.employeeId===p.employeeId&&worker.revision===p.hermesBot?.revision&&worker.controlEpoch===p.hermesBot?.controlEpoch&&worker.platform===operation.input?.platform&&(operation.operation!=='connect'||worker.sourceActionId===action.id));}

const legacyProofKind='legacy-never-dispatched-v1';
const legacyPolicyPins=['actionId','actionDigest','hostId','workspaceId','deviceId','origin','specHash','authorizationDigest','historicalGenerationDigest','policyDigest','sourceDigest','cacheDigest','loggerDigest'];
export function copyLegacyActionPolicy(value){
  if(value===null)return null;
  const invalid=()=>fail('ROLLBACK_LEGACY_POLICY_INVALID','旧 action 策略必须由独立代码提供完整固定绑定');
  const plain=(item,keys)=>item&&typeof item==='object'&&!Array.isArray(item)&&[Object.prototype,null].includes(Object.getPrototypeOf(item))&&Reflect.ownKeys(item).length===keys.length&&keys.every(key=>Object.hasOwn(item,key)&&Object.hasOwn(Object.getOwnPropertyDescriptor(item,key),'value'));
  const hex=item=>typeof item==='string'&&/^[a-f0-9]{64}$/.test(item);
  if(!plain(value,[...legacyPolicyPins,'requiredFiles'])||legacyPolicyPins.some(key=>typeof value[key]!=='string'||!value[key])||legacyPolicyPins.filter(key=>key.endsWith('Digest')||key==='specHash').some(key=>!hex(value[key])))invalid();
  try{const origin=new URL(value.origin);if(!['http:','https:'].includes(origin.protocol)||origin.origin!==value.origin)invalid();}catch{invalid();}
  if(!Array.isArray(value.requiredFiles)||!value.requiredFiles.length)invalid();
  const paths=new Set(),requiredFiles=[];
  for(const record of value.requiredFiles){
    if(!plain(record,['path','sha256'])||typeof record.path!=='string'||record.path.includes('\0')||!hex(record.sha256))invalid();
    const flavour=path.posix.isAbsolute(record.path)?path.posix:path.win32,key=flavour===path.win32?record.path.toLowerCase():record.path;
    if(!flavour.isAbsolute(record.path)||flavour.resolve(record.path)!==record.path||paths.has(key))invalid();
    paths.add(key);requiredFiles.push(Object.freeze({path:record.path,sha256:record.sha256}));
  }
  return Object.freeze({...Object.fromEntries(legacyPolicyPins.map(key=>[key,value[key]])),requiredFiles:Object.freeze(requiredFiles)});
}

export function createPreservation(db,{role=PRODUCT_ROLE,collectNativeEvidence=null,readOnly=false,beforeCommit=null,persistReceipt=null,verifySourceRecord=null,legacyActionPolicy=null}={}) {
  if(!['v2','v1-compat'].includes(role))fail('PRODUCT_ROLE_INVALID','产品包角色无效');
  for(const hook of [beforeCommit,persistReceipt,verifySourceRecord])if(hook!==null&&(typeof hook!=='function'||hook.constructor?.name==='AsyncFunction'))fail('ROLLBACK_HOOK_INVALID','转换 hook 必须为独立代码传入的同步函数');
  // This immutable capability is constructor code state, never a seal option.
  const legacyPolicy=copyLegacyActionPolicy(legacyActionPolicy);
  if(!readOnly)db.exec(`CREATE TABLE IF NOT EXISTS version_preservation (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1), operation_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('preparing','sealed','restored')),
    versions_json TEXT NOT NULL, intent_json TEXT NOT NULL, snapshot_json TEXT,
    evidence_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS version_preservation_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, operation_id TEXT NOT NULL, event TEXT NOT NULL,
    payload_json TEXT NOT NULL, created_at TEXT NOT NULL);`);
  const current=()=>exists(db,'version_preservation')?db.prepare('SELECT * FROM version_preservation WHERE singleton=1').get():null;
  // Execution guards need only the persisted state, not the full rollback audit.
  const state=()=>exists(db,'version_preservation')?db.prepare('SELECT state FROM version_preservation WHERE singleton=1').get()?.state||'v2':'v2';
  function validateIdentities(saved,{sealed=false}={}){
    if(!saved||!Array.isArray(saved.bots)||!Array.isArray(saved.employees)||!Array.isArray(saved.routines))fail('ROLLBACK_SNAPSHOT_INVALID','原身份快照不可读');
    const actual=snapshot();
    const groups=[['bots',['employee_id','workspace_id','main_conversation_id','provision_action_id','profile_binding_json','config_json','revision','created_at']],['employees',['id','workspace_id','runtime','runtime_profile','target_device_id','template_id','created_at']],['routines',null],['conversations',['id','workspace_id','employee_id']],['automations',['id','workspace_id','executor','created_at']]];
    for(const [group,keys] of groups){const before=saved[group]||[],after=actual[group]||[],id=row=>row.id||row.employee_id||row.automation_id;if(before.length!==after.length)fail('ROLLBACK_IDENTITY_CHANGED','封存对象集合发生变化');for(const row of before){const present=after.find(item=>id(item)===id(row));if(!present||(keys||Object.keys(row)).some(key=>present[key]!==row[key]))fail('ROLLBACK_IDENTITY_CHANGED','原 Bot、会话、员工或 Routine 身份发生变化');}}
    if(sealed){for(const row of saved.bots){const present=actual.bots.find(item=>item.employee_id===row.employee_id);if(present.control_state!=='paused'||present.control_epoch!==row.control_epoch+1)fail('ROLLBACK_IDENTITY_CHANGED','封存控制状态发生变化');}for(const row of actual.automations)if(row.status!=='paused'||row.next_run!==null)fail('ROLLBACK_IDENTITY_CHANGED','封存 Routine 状态发生变化');}
  }
  let controlWrite=false;
  let operationWrite=false;
  let completion=null;
  const frozen=()=>role==='v1-compat'||['preparing','sealed'].includes(state());
  const event=(operationId,type,payload)=>{const previous=operationWrite;operationWrite=true;try{return db.prepare('INSERT INTO version_preservation_events(operation_id,event,payload_json,created_at) VALUES(?,?,?,?)').run(operationId,type,canonical(payload),new Date().toISOString());}finally{operationWrite=previous;}};
  const transaction=fn=>{db.exec('BEGIN IMMEDIATE');operationWrite=true;try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}finally{operationWrite=false;}};
  const invoke=(hook,input)=>{if(!hook)return undefined;const value=hook({db,...input});if(value&&typeof value.then==='function')fail('ROLLBACK_HOOK_INVALID','转换事务禁止异步 hook');return value;};
  const before=(command,operationId)=>invoke(beforeCommit,{command,operationId,row:current()});
  const receipt=(command,operationId)=>{const report=inspect();invoke(persistReceipt,{command,operationId,row:current(),report});return report;};
  const sourceRecord=(kind,record)=>{if(!verifySourceRecord)return undefined;const value=invoke(verifySourceRecord,{kind,record});if(value!==undefined&&value!==true)fail('ROLLBACK_EVIDENCE_CHANGED','可信源 host 复核拒绝文件证据');return value;};
  function verifyLegacyAction(native,operationId){
    const refuse=()=>fail('ROLLBACK_NOT_DRAINED','原 V1 action 的唯一可信未下发证明不完整');
    if(native.nativeStateProofs!==undefined&&!Array.isArray(native.nativeStateProofs))refuse();
    const proofs=(native.nativeStateProofs||[]).filter(proof=>proof?.kind===legacyProofKind);
    if(!legacyPolicy){if(proofs.length)refuse();return;}
    if(proofs.length!==1)refuse();
    const proof=proofs[0];
    if(proof.schemaVersion!==1||proof.operationId!==operationId||proof.verified!==true||proof.conclusion!=='never-dispatched'||uncertain(proof)||legacyPolicyPins.some(key=>proof[key]!==legacyPolicy[key])||sourceRecord(legacyProofKind,proof)!==true)refuse();
    const action=exists(db,'a2a_actions')?db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(legacyPolicy.actionId):null;
    if(!action||classifyAction(action).isV2||nativeActionDigest(action)!==legacyPolicy.actionDigest||action.workspace_id!==legacyPolicy.workspaceId||action.status!=='expired'||typeof action.acked_at!=='string'||!action.acked_at||action.result_json!=='')refuse();
    const payload=parse(action.payload_json);
    if(!payload||typeof payload!=='object'||Array.isArray(payload))refuse();
    const devices=['deviceId','device_id','targetDeviceId','target_device_id'].map(key=>payload[key]).filter(value=>value!==undefined&&value!==null&&value!=='');
    if(!devices.length){const employee=all(db,'employees').filter(row=>row.id===(payload.employeeId||payload.employee_id||payload.assignee)&&row.workspace_id===legacyPolicy.workspaceId);if(employee.length!==1)refuse();devices.push(employee[0].target_device_id);}
    if(devices.some(device=>device!==legacyPolicy.deviceId))refuse();
    const bindings=Array.isArray(native.actionBindings)?native.actionBindings.filter(binding=>binding?.id===action.id):[];
    if(bindings.length!==1||bindings[0].digest!==legacyPolicy.actionDigest||!Array.isArray(native.files))refuse();
    for(const pin of legacyPolicy.requiredFiles){const records=native.files.filter(record=>record?.path===pin.path);if(records.length!==1||records[0].exists!==true||records[0].sha256!==pin.sha256)refuse();}
    // Required files still pass through the original final source/file checker.
    // No process receipt is fabricated, and the original action is never edited.
  }
  function inventory() {
    const bots=all(db,'hermes_bots'),employees=all(db,'employees'),routines=all(db,'bot_routines');
    const saved=parse(current()?.intent_json),errors=[];
    if(frozen())for(const bot of saved?.bots||[])if(!bots.some(row=>row.employee_id===bot.employee_id)){bots.push(bot);errors.push({code:'BOT_IDENTITY_MISSING',employeeId:bot.employee_id});}
    if(frozen())for(const routine of saved?.routines||[])if(!routines.some(row=>row.automation_id===routine.automation_id)){routines.push(routine);errors.push({code:'BOT_ROUTINE_MISSING',automationId:routine.automation_id});}
    for(const bot of bots){
      const employee=employees.find(row=>row.id===bot.employee_id);
      if(!employee||employee.workspace_id!==bot.workspace_id||!parse(bot.config_json))errors.push({code:'BOT_IDENTITY_CORRUPT',employeeId:bot.employee_id});
      if(bot.profile_binding_json&&!parse(bot.profile_binding_json))errors.push({code:'BOT_PROFILE_CORRUPT',employeeId:bot.employee_id});
    }
    for(const routine of routines)if(!bots.some(bot=>bot.employee_id===routine.employee_id&&bot.workspace_id===routine.workspace_id))errors.push({code:'BOT_ROUTINE_ORPHAN',automationId:routine.automation_id});
    return {bots,employees,routines,errors};
  }
  function classify(input={},seen=new Set()) {
    const inv=inventory(),found=new Set(),p=input.payload||input;
    const botId=id=>{if(id&&inv.bots.some(bot=>bot.employee_id===String(id)))found.add(String(id));};
    for(const id of [input.employeeId,input.employee_id,input.assignee,p.employeeId,p.employee_id,p.assignee,p.hermesBot?.employeeId,p.collaboration?.sourceEmployeeId])botId(id);
    // V1 tasks also allow an employee name as assignee.
    for(const employee of inv.employees)if([input.assignee,p.assignee].includes(employee.name))botId(employee.id);
    for(const id of [input.conversationId,input.conversation_id,p.conversationId,p.conversation_id])if(id){
      const row=db.prepare('SELECT employee_id FROM conversations WHERE id=?').get(String(id));botId(row?.employee_id);
      const original=parse(current()?.intent_json)?.conversations?.find(row=>row.id===id);botId(original?.employee_id);
      for(const bot of inv.bots)if(bot.main_conversation_id===id)botId(bot.employee_id);
      for(const routine of inv.routines)if(routine.conversation_id===id)botId(routine.employee_id);
    }
    for(const id of [input.automationId,input.automation_id,p.automationId,p.automation_id])if(id){
      const binding=inv.routines.find(row=>row.automation_id===id);botId(binding?.employee_id);
      if(!binding&&db.prepare('SELECT executor FROM automations WHERE id=?').get(String(id))?.executor==='ziwei_bot')found.add('unknown-routine');
    }
    for(const id of [input.runId,input.run_id,p.runId,p.run_id])if(id){const row=db.prepare('SELECT automation_id FROM automation_runs WHERE id=?').get(String(id));if(row)for(const bot of classify({automationId:row.automation_id},seen).botIds)found.add(bot);}
    for(const id of [input.taskId,input.task_id,p.taskId,p.task_id])if(id&&!seen.has(`task:${id}`)){
      seen.add(`task:${id}`);const row=db.prepare('SELECT assignee FROM tasks WHERE id=?').get(String(id));
      if(row){const result=classify(row,seen);for(const bot of result.botIds)found.add(bot);if(result.isV2&&!result.botIds.length)found.add('unknown-origin');}
      for(const action of db.prepare('SELECT * FROM a2a_actions WHERE task_id=?').all(String(id))){const result=classifyAction(action,seen);for(const bot of result.botIds)found.add(bot);if(result.isV2&&!result.botIds.length)found.add('unknown-origin');}
    }
    for(const id of [input.actionId,p.actionId,p.sourceActionId,p.collaboration?.sourceActionId,p.gateway?.connectionActionId])if(id&&!seen.has(`action:${id}`)){
      const action=db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(String(id));if(action){const result=classifyAction(action,seen);for(const bot of result.botIds)found.add(bot);if(result.isV2&&!result.botIds.length)found.add('unknown-origin');}else found.add('unknown-origin');
    }
    const profiles=[p.profile,p.profileName,p.profile_name,p.runtimeProfile,p.runtime_profile,p.hermesProfile,p.hermes_profile,input.profile,input.runtimeProfile].filter(Boolean);
    const homes=[p.hermesHome,p.hermesHomePath,p.home,p.env?.HERMES_HOME,p.cwd,p.path,p.filePath,p.destination,p.filename].filter(value=>typeof value==='string');
    const contained=(root,value)=>{const api=/^[a-z]:|^\\\\/i.test(root)?path.win32:path.posix;const relative=api.relative(api.resolve(root),api.resolve(value));return relative===''||relative!=='..'&&!relative.startsWith(`..${api.sep}`)&&!api.isAbsolute(relative);};
    for(const bot of inv.bots){const binding=parse(bot.profile_binding_json);
      if(binding?.mode==='owned_profile'&&profiles.some(profile=>String(profile).toLowerCase()===binding.profile.toLowerCase()))botId(bot.employee_id);
      if(bot.provision_action_id){const action=db.prepare('SELECT result_json FROM a2a_actions WHERE id=?').get(bot.provision_action_id),result=parse(action?.result_json),receipt=result?.botProvision||result?.result?.botProvision;if(receipt?.home&&homes.some(value=>contained(receipt.home,value)))botId(bot.employee_id);}
    }
    const isBotType=String(input.type||'').startsWith('hermes.bot.');
    return {isV2:found.size>0||isBotType||Boolean(p.hermesBot),botIds:[...found].sort(),errors:inv.errors};
  }
  function classifyAction(action,seen=new Set()) {
    if(seen.has(`action:${action.id}`))return {isV2:false,botIds:[],errors:[]};
    seen.add(`action:${action.id}`);
    const result=classify({...action,payload:parse(action.payload_json)||action.payload||{}},seen);
    const saved=parse(current()?.intent_json);if(saved?.actions?.some(row=>row.id===action.id))result.isV2=true;
    for(const inbox of all(db,'bot_gateway_inbox'))if([inbox.action_id,inbox.source_action_id].includes(action.id)){result.isV2=true;if(!result.botIds.includes(inbox.employee_id))result.botIds.push(inbox.employee_id);}
    return result;
  }
  const actionById=id=>{const action=db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(String(id));return action?classifyAction(action):{isV2:false,botIds:[],errors:[]};};
  const assert=input=>{if(!frozen())return;const result=classify(input);if(result.errors.length||result.isV2)fail('V2_OBJECT_SEALED','此 V2 对象已封存；保留数据，当前版本禁止执行或改写身份',{...result,state:current()?.state||'v1-compat'});};
  const assertAction=id=>{if(!frozen())return;if(actionById(id).isV2||inventory().errors.length)fail('V2_OBJECT_SEALED','原始 V2 action 已封存，禁止领取、续租或新执行');};
  function settle(actionId,input,fn){
    if(role!=='v2'||current()?.state!=='preparing'||!actionById(actionId).isV2)return fn();
    const row=db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(actionId),payload=parse(row?.payload_json)||{};
    if(!input.deviceId||input.deviceId!==(payload.deviceId||payload.device_id))throw preservationError('EXECUTION_DEVICE_MISMATCH','原完成回执设备与持久 action 不匹配',403);
    if(['succeeded','failed','expired'].includes(row?.status))return fn();
    if(row?.status!=='acked'||completion)fail('ROLLBACK_SETTLEMENT_INVALID','只允许原已领取 action 的同步完成事务');
    completion={actionId,conversationId:payload.conversationId||null,taskId:row.task_id||payload.taskId||null};
    try{return fn();}finally{completion=null;}
  }
  function verifiedInboxProof(proof,native,operationId){
    if(!proof||proof.kind!=='gateway'||proof.resource!=='gateway'||proof.operationId!==operationId||!['delivered','delivery_failed'].includes(proof.nativeState)||!native?.nativeDatabases||!native.nativeStateProofs?.some(row=>digest(row)===proof.nativeProofDigest))return false;
    const inbox=db.prepare('SELECT * FROM bot_gateway_inbox WHERE id=?').get(proof.inboxId),connect=db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(proof.connectActionId),reply=db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(proof.replyActionId);
    if(!inbox||!connect||!reply||proof.inboxRowDigest!==digest(inbox)||proof.connectActionDigest!==nativeActionDigest(connect)||proof.replyActionDigest!==nativeActionDigest(reply)||!native.actionBindings?.some(row=>row.id===connect.id&&row.digest===proof.connectActionDigest)||!native.actionBindings?.some(row=>row.id===reply.id&&row.digest===proof.replyActionDigest))return false;
    const bot=all(db,'hermes_bots').find(row=>row.employee_id===inbox.employee_id),employee=all(db,'employees').find(row=>row.id===inbox.employee_id),binding=parse(bot?.profile_binding_json),workspace=all(db,'workspaces').find(row=>row.id===inbox.workspace_id),exit=proof.connectExitProof,connectPayload=parse(connect.payload_json),replyPayload=parse(reply.payload_json),original=parse(all(db,'a2a_actions').find(row=>row.id===bot?.provision_action_id)?.result_json),owned=original?.botProvision||original?.result?.botProvision;
    if(!bot||!employee||proof.employeeId!==inbox.employee_id||proof.workspaceId!==inbox.workspace_id||proof.workspace!==workspace?.slug||proof.deviceId!==employee.target_device_id||connectPayload?.deviceId!==proof.deviceId||replyPayload?.deviceId!==proof.deviceId||proof.ownershipId!==(binding?.mode==='owned_profile'?binding.ownershipId:crypto.createHash('sha256').update(JSON.stringify([new URL(connectPayload.hermesBot?.apiBase||proof.origin||'http://invalid').origin,workspace?.slug,inbox.employee_id])).digest('hex')))return false;
    if(binding?.mode==='owned_profile'&&proof.home!==owned?.home)return false;
    const connectResult=parse(connect.result_json),replyResult=parse(reply.result_json),receipt=connectResult?.nativeOperation||connectResult?.result?.nativeOperation,output=replyResult?.output||replyResult?.result?.output||replyResult?.text,bodyHash=crypto.createHash('sha256').update(inbox.content).digest('hex');
    if(proof.sourceActionId!==reply.id||proof.actionDigest!==nativeActionDigest(reply)||proof.resultDigest!==digest(replyResult)||proof.treeDigest!==digest(executionExit(replyResult))||reply.status!=='succeeded'||!reply.acked_at||uncertain(replyResult)||!exitedTree(executionExit(replyResult))||typeof output!=='string'||!output||proof.nativeContentDigest!==bodyHash||replyPayload?.prompt!==inbox.content||connectPayload?.employeeId!==inbox.employee_id||replyPayload?.employeeId!==inbox.employee_id||connect.workspace_id!==inbox.workspace_id||reply.workspace_id!==inbox.workspace_id||connectPayload?.hermesBot?.workspace!==proof.workspace||replyPayload?.hermesBot?.workspace!==proof.workspace||connectPayload?.hermesBot?.revision!==proof.revision||replyPayload?.hermesBot?.revision!==proof.revision||connectPayload?.hermesBot?.controlEpoch!==proof.controlEpoch||replyPayload?.hermesBot?.controlEpoch!==proof.controlEpoch||connectPayload?.nativeOperation?.resource!=='gateway'||connectPayload.nativeOperation.operation!=='connect'||connectPayload.nativeOperation.input?.platform!==proof.platform||replyPayload?.gateway?.connectionActionId!==connect.id||replyPayload.gateway.platform!==inbox.platform||replyPayload.gateway.chatId!==inbox.chat_id||replyPayload.gateway.messageId!==inbox.message_id||proof.platform!==inbox.platform||proof.chatId!==inbox.chat_id||proof.messageId!==inbox.message_id||proof.revision!==inbox.revision||proof.controlEpoch!==inbox.control_epoch||inbox.source_action_id!==connect.id||inbox.action_id!==reply.id||exit?.connectedPid!==receipt?.data?.pid||exit?.processExit?.rootPid!==exit?.connectedPid)return false;
    return Boolean(native.nativeDatabases.some(row=>row.exists&&row.path===(path.posix.isAbsolute(proof.home)?path.posix:path.win32).join(proof.home,'state.db')&&row.home===proof.home&&row.employeeId===proof.employeeId&&row.deviceId===proof.deviceId&&row.operationId===operationId)&&exit&&exit.home===proof.home&&exit.ownershipId===proof.ownershipId&&exit.workspaceId===proof.workspaceId&&exit.deviceId===proof.deviceId&&exit.sourceActionId===connect.id&&exit.connectActionDigest===proof.connectActionDigest&&exit.employeeId===proof.employeeId&&exit.workspace===proof.workspace&&exit.platform===proof.platform&&exit.revision===proof.revision&&exit.controlEpoch===proof.controlEpoch&&exit.processAlive===false&&exitedTree(exit.processExit)&&digest(exit)===proof.connectTreeDigest);
  }
  function inspect() {
    const row=current(),inv=inventory(),issues=[...inv.errors],actions=all(db,'a2a_actions').filter(action=>classifyAction(action).isV2);
    for(const action of actions){const result=parse(action.result_json);
      if(result?.nativeOperation?.resource==='gateway'&&!gatewayResultMatches(action,result))issues.push({code:'ACTION_GATEWAY_IDENTITY_MISMATCH',actionId:action.id});
      const classification=classifyAction(action);if(!classification.botIds.length||classification.botIds.some(id=>!inv.bots.some(bot=>bot.employee_id===id)))issues.push({code:'ACTION_BOT_IDENTITY_UNKNOWN',actionId:action.id});
      if(['pending','acked'].includes(action.status)||uncertain(result)||action.status==='expired'&&action.acked_at)issues.push({code:'ACTION_NOT_DRAINED',actionId:action.id,status:action.status});
      const payload=parse(action.payload_json),residentConnect=action.type==='hermes.bot.native'&&payload?.nativeOperation?.resource==='gateway'&&payload.nativeOperation.operation==='connect';
      const worker=result?.nativeOperation?.data?.residentWorker;
      const source=worker&&all(db,'a2a_actions').find(row=>row.id===worker.sourceActionId),sourcePayload=parse(source?.payload_json),operation=sourcePayload?.nativeOperation;
      const residentCommand=worker&&gatewayResultMatches(action,result)&&operation?.resource==='gateway'&&operation.operation==='connect'&&sourcePayload.employeeId===worker.employeeId&&sourcePayload.hermesBot?.revision===worker.revision&&sourcePayload.hermesBot?.controlEpoch===worker.controlEpoch&&operation.input.platform===worker.platform;
      if(action.acked_at&&['succeeded','failed'].includes(action.status)&&!residentConnect&&!residentCommand&&!exitedTree(executionExit(result)))issues.push({code:'ACTION_TREE_UNKNOWN',actionId:action.id});
    }
    for(const run of all(db,'automation_runs'))if(classify({automationId:run.automation_id}).isV2&&['queued','running','retrying','uncertain'].includes(run.status))issues.push({code:'ROUTINE_RUN_NOT_DRAINED',runId:run.id,status:run.status});
    for(const delivery of all(db,'webhook_deliveries'))if(classify({automationId:delivery.automation_id}).isV2&&['queued','retrying','sending'].includes(delivery.status))issues.push({code:'WEBHOOK_NOT_DRAINED',deliveryId:delivery.id,status:delivery.status});
    const savedEvidence=row?.state==='sealed'?parse(row.evidence_json):null,provenGatewayInbox=[];
    for(const inbox of all(db,'bot_gateway_inbox'))if(!['completed','failed','cancelled'].includes(inbox.status)){const proof=savedEvidence?.gatewayInboxProofs?.find(item=>item.inboxId===inbox.id);if(inbox.status==='dispatched'&&verifiedInboxProof(proof,savedEvidence,row.operation_id))provenGatewayInbox.push({inboxId:inbox.id,nativeState:proof.nativeState,sourceActionId:proof.connectActionId,replyActionId:proof.replyActionId});else issues.push({code:'GATEWAY_INBOX_NOT_DRAINED',inboxId:inbox.id,status:inbox.status});}
    for(const run of all(db,'ziwei_connect_runs'))if(classify({employeeId:run.employee_id}).isV2&&!['succeeded','failed','dry_run'].includes(run.status))issues.push({code:'PHONE_RUN_NOT_DRAINED',runId:run.id,status:run.status});
    return {schemaVersion:1,role,state:row?.state||'v2',operationId:row?.operation_id||null,versions:parse(row?.versions_json),bots:inv.bots.map(bot=>({employeeId:bot.employee_id,workspaceId:bot.workspace_id,profile:parse(bot.profile_binding_json),provisionActionId:bot.provision_action_id,revision:bot.revision,controlEpoch:bot.control_epoch})),routines:inv.routines,actions:actions.map(action=>({id:action.id,status:action.status,type:action.type,ackedAt:action.acked_at})),provenGatewayInbox,issues};
  }
  function snapshot(){const inv=inventory();return {bots:inv.bots,employees:inv.employees.filter(employee=>inv.bots.some(bot=>bot.employee_id===employee.id)),routines:inv.routines,automations:all(db,'automations').filter(row=>inv.routines.some(binding=>binding.automation_id===row.id)),gatewayInbox:all(db,'bot_gateway_inbox'),actions:all(db,'a2a_actions').filter(action=>classifyAction(action).isV2),conversations:all(db,'conversations').filter(row=>classify({conversationId:row.id}).isV2)};}
  const operation=input=>{const row=current();if(!row||row.operation_id!==input.operationId)fail('ROLLBACK_OPERATION_CONFLICT','操作标识与持久意图不一致');if(canonical(parse(row.versions_json))!==canonical(FROZEN_VERSIONS))fail('ROLLBACK_INTENT_INVALID','冻结版本身份发生变化');return row;};
  function begin({operationId,versions}={}) {
    if(readOnly)fail('ROLLBACK_READ_ONLY','只读检查禁止创建准备意图');
    if(role!=='v2')fail('ROLLBACK_ROLE_INVALID','只允许 V2 保护包准备降级');
    if(!/^[-a-zA-Z0-9_]{1,128}$/.test(operationId||'')||canonical(versions)!==canonical(FROZEN_VERSIONS))fail('ROLLBACK_INTENT_INVALID','必须提供精确操作标识与冻结版本');
    return transaction(()=>{const row=current();if(row){if(row.operation_id===operationId&&canonical(parse(row.versions_json))===canonical(versions))return inspect();if(row.state!=='restored')fail('ROLLBACK_OPERATION_CONFLICT','现有操作尚未恢复，禁止替换');}
      before('prepare',operationId);const stamp=new Date().toISOString(),intent=snapshot();
      db.prepare('INSERT OR REPLACE INTO version_preservation(singleton,operation_id,state,versions_json,intent_json,created_at,updated_at) VALUES(1,?,\'preparing\',?,?,?,?)').run(operationId,canonical(versions),canonical(intent),stamp,stamp);
      event(operationId,'preparing',{versions,identityDigest:digest(intent)});return receipt('prepare',operationId);});
  }
  async function seal({operationId,...evidenceOptions}={}) {
    if(readOnly)fail('ROLLBACK_READ_ONLY','只读检查禁止封存');
    if(role!=='v2')fail('ROLLBACK_ROLE_INVALID','封存只能由 V2 保护包执行');
    const row=operation({operationId});if(row.state==='sealed')return inspect();if(row.state!=='preparing')fail('ROLLBACK_STATE_INVALID','只有 preparing 可以封存');
    const initial=inspect();
    const immediate=initial.issues.filter(issue=>issue.code!=='GATEWAY_INBOX_NOT_DRAINED'||issue.status!=='dispatched');
    if(immediate.length){event(operationId,'seal_refused',{issues:immediate});fail('ROLLBACK_NOT_DRAINED','原 action、运行或队列尚未排空',immediate);}
    const native=collectNativeEvidence?await collectNativeEvidence(db,{...evidenceOptions,operationId}):{safe:initial.bots.length===0,issues:initial.bots.length?[{code:'NATIVE_EVIDENCE_REQUIRED'}]:[],files:[]};
    if(!native.safe){event(operationId,'seal_refused',{issues:native.issues});fail('ROLLBACK_NOT_DRAINED','本机执行与补传证据不完整',native.issues);}
    return transaction(()=>{const checked=inspect(),currentOperation=operation({operationId});
      if(new Set((native.gatewayInboxProofs||[]).map(proof=>proof.inboxId)).size!==(native.gatewayInboxProofs||[]).length)fail('ROLLBACK_NOT_DRAINED','原生 Inbox proof 必须唯一');
      if(native.nativeDatabases){const originalActions=all(db,'a2a_actions').filter(action=>classifyAction(action).isV2);if(originalActions.some(action=>!(native.actionBindings||[]).some(binding=>binding.id===action.id))||native.nativeDatabases.some(record=>['','-wal','-journal','-shm'].some(suffix=>!(native.files||[]).some(file=>file.path===record.path+suffix))))fail('ROLLBACK_NOT_DRAINED','原生证据缺少完整原 action 或数据库文件清单');}
      const inboxProofs=new Map((native.gatewayInboxProofs||[]).map(proof=>[proof.inboxId,proof]));
      const remaining=checked.issues.filter(issue=>{
        if(issue.code!=='GATEWAY_INBOX_NOT_DRAINED'||issue.status!=='dispatched')return true;
        return !verifiedInboxProof(inboxProofs.get(issue.inboxId),native,operationId);
      });
      if(checked.state!=='preparing'||remaining.length)fail('ROLLBACK_NOT_DRAINED','证据检查期间状态发生变化',remaining);
      if((native.nativeDatabases||checked.issues.some(issue=>issue.code==='GATEWAY_INBOX_NOT_DRAINED'))&&(native.operationId!==operationId||native.intentDigest!==digest(currentOperation.intent_json)||native.versionsDigest!==digest(currentOperation.versions_json)))fail('ROLLBACK_EVIDENCE_CHANGED','原生证据的冻结操作身份发生变化');
      for(const binding of native.actionBindings||[]){const action=db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(binding.id);if(!action||nativeActionDigest(action)!==binding.digest)fail('ROLLBACK_EVIDENCE_CHANGED','原生证据依赖的原 action 发生变化');}
      verifyLegacyAction(native,operationId);
      validateIdentities(parse(row.intent_json));
      for(const file of native.files||[])try{if(sourceRecord('file',file)===true)continue;if(file.exists===false?fs.existsSync(file.path):crypto.createHash('sha256').update(fs.readFileSync(file.path)).digest('hex')!==file.sha256)fail('ROLLBACK_EVIDENCE_CHANGED','本机文件证据在封存前发生变化');if(file.identity){const stat=fs.lstatSync(file.path,{bigint:true});if(stat.isSymbolicLink()||String(stat.dev)!==file.identity.dev||String(stat.ino)!==file.identity.ino)fail('ROLLBACK_EVIDENCE_CHANGED','原生数据库文件身份发生变化');}}catch(error){if(['ROLLBACK_EVIDENCE_CHANGED','ROLLBACK_HOOK_INVALID'].includes(error.code))throw error;fail('ROLLBACK_EVIDENCE_CHANGED','本机文件证据不可读');}
      for(const directory of native.directories||[])try{if(sourceRecord('directory',directory)===true)continue;if(directory.identity){const stat=fs.lstatSync(directory.path,{bigint:true});if(stat.isSymbolicLink()||!stat.isDirectory()||String(stat.dev)!==directory.identity.dev||String(stat.ino)!==directory.identity.ino)fail('ROLLBACK_EVIDENCE_CHANGED','本机目录身份发生变化');}if(directory.exists?canonical(fs.readdirSync(directory.path).sort())!==canonical(directory.names):fs.existsSync(directory.path))fail('ROLLBACK_EVIDENCE_CHANGED','本机目录证据在封存前发生变化');}catch(error){if(['ROLLBACK_EVIDENCE_CHANGED','ROLLBACK_HOOK_INVALID'].includes(error.code))throw error;fail('ROLLBACK_EVIDENCE_CHANGED','本机目录证据不可读');}
      before('seal',operationId);
      const saved=snapshot(),stamp=new Date().toISOString();
      controlWrite=true;
      try{for(const bot of saved.bots){db.prepare("UPDATE employees SET status='paused' WHERE id=?").run(bot.employee_id);db.prepare("UPDATE hermes_bots SET control_state='paused',control_epoch=control_epoch+1,updated_at=? WHERE employee_id=?").run(stamp,bot.employee_id);}
        for(const binding of saved.routines)db.prepare("UPDATE automations SET status='paused',next_run=NULL WHERE id=?").run(binding.automation_id);
      }finally{controlWrite=false;}
      db.prepare("UPDATE version_preservation SET state='sealed',snapshot_json=?,evidence_json=?,updated_at=? WHERE singleton=1").run(canonical(saved),canonical(native),stamp);
      event(operationId,'sealed',{snapshotDigest:digest(saved),evidenceDigest:digest(native)});return receipt('seal',operationId);});
  }
  function restore({operationId}={}) {
    if(readOnly)fail('ROLLBACK_READ_ONLY','只读检查禁止恢复');
    if(role!=='v2')fail('ROLLBACK_ROLE_INVALID','恢复只能由 V2 保护包执行');
    return transaction(()=>{const row=operation({operationId});if(row.state==='restored')return inspect();if(row.state!=='sealed')fail('ROLLBACK_STATE_INVALID','只能恢复已封存操作');
      const saved=parse(row.snapshot_json);if(!saved)fail('ROLLBACK_SNAPSHOT_INVALID','封存快照不可读');
      validateIdentities(saved,{sealed:true});
      before('restore',operationId);const stamp=new Date().toISOString();db.prepare("UPDATE version_preservation SET state='restored',updated_at=? WHERE singleton=1").run(stamp);event(operationId,'restored',{pausedEmployeeIds:saved.bots.map(bot=>bot.employee_id),pausedRoutineIds:saved.routines.map(row=>row.automation_id),replay:false});return receipt('restore',operationId);});
  }
  function abort({operationId}={}) {if(readOnly||role!=='v2')fail('ROLLBACK_READ_ONLY','当前包不可撤销准备');return transaction(()=>{const row=operation({operationId});if(row.state!=='preparing')fail('ROLLBACK_STATE_INVALID','只允许撤销尚未封存的准备');before('abort',operationId);db.prepare("UPDATE version_preservation SET state='restored',updated_at=? WHERE singleton=1").run(new Date().toISOString());event(operationId,'preparation_aborted',{sealed:false,replay:false});return receipt('abort',operationId);});}
  db.function('ziwei_v2_admitted',id=>!frozen()||!actionById(id).isV2?1:0);
  db.function('ziwei_preservation_transition_admitted',()=>operationWrite?1:0);
  if(!readOnly)for(const table of ['version_preservation','version_preservation_events'])for(const event of ['INSERT','UPDATE','DELETE'])db.exec(`CREATE TRIGGER IF NOT EXISTS preservation_transition_${table}_${event.toLowerCase()} BEFORE ${event} ON ${table} WHEN ziwei_preservation_transition_admitted()=0 BEGIN SELECT RAISE(ABORT,'ROLLBACK_TRANSITION_PRIVATE'); END`);
  db.function('ziwei_v2_automation_admitted',id=>!frozen()||!classify({automationId:id}).isV2?1:0);
  db.function('ziwei_v2_write_admitted',(kind,id,other,payload)=>{
    if(controlWrite||!frozen())return 1;
    // This connection-local context surrounds only the original result method.
    // HTTP/user write methods still fail their independent repository preflight.
    if(completion&&(kind==='conversation'&&id===completion.conversationId||kind==='task'&&id===completion.taskId))return 1;
    if(kind==='new-bot')return 0;
    const input=kind==='action'?{actionId:id}:kind==='action-new'?{type:other,taskId:id,payload:parse(payload)||{}}:kind==='employee'?{employeeId:id}:kind==='conversation'?{conversationId:id}:kind==='conversation-new'?{employeeId:id}:kind==='automation'?{automationId:id}:kind==='run'?{runId:id}:kind==='task'?{taskId:id,assignee:other}:{};
    return classify(input).isV2||inventory().errors.length?0:1;
  });
  db.function('ziwei_v2_action_update_admitted',(id,newType,newTask,newPayload,newStatus,newExpiry)=>{
    if(controlWrite||!frozen())return 1;
    const original=db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(id),isV2=actionById(id).isV2||classify({type:newType,taskId:newTask,payload:parse(newPayload)||{}}).isV2;
    if(!isV2)return 1;
    if(role==='v2'&&current()?.state==='preparing'&&completion?.actionId===id&&original?.status==='acked'&&['succeeded','failed'].includes(newStatus)&&original.type===newType&&original.task_id===newTask&&original.payload_json===newPayload&&original.expires_at===newExpiry)return 1;
    return 0;
  });
  // Persistent triggers close the preflight/second-process race and raw service
  // SQL paths. A package without the registered function fails closed as well.
  const trigger=(table,event,kind,id,other="''",payload="''",condition='1')=>{
    if(readOnly||!exists(db,table))return;
    const signature=digest({table,event,kind,id,other,payload,condition}).slice(0,10),name=`preservation_${table}_${event.toLowerCase()}_${signature}`;
    db.exec(`CREATE TRIGGER IF NOT EXISTS ${name} BEFORE ${event} ON ${table} WHEN (${condition}) AND ziwei_v2_write_admitted('${kind}',${id},${other},${payload})=0 BEGIN SELECT RAISE(ABORT,'V2_OBJECT_SEALED'); END`);
  };
  const protectEmployeeTable=table=>{if(!['ziwei_connect_bindings','ziwei_connect_runs'].includes(table))throw new Error('Unrecognized service table');for(const event of ['INSERT','UPDATE','DELETE'])trigger(table,event,'employee',event==='INSERT'?'NEW.employee_id':'OLD.employee_id');};
  for(const event of ['UPDATE','DELETE']){
    trigger('employees',event,'employee','OLD.id');
    trigger('conversations',event,'conversation','OLD.id');
    trigger('tasks',event,'task','OLD.id',event==='UPDATE'?'NEW.assignee':'OLD.assignee');
    trigger('automations',event,'automation','OLD.id');
    trigger('hermes_bots',event,'employee','OLD.employee_id',"''","''",event==='UPDATE'?"NEW.employee_id IS NOT OLD.employee_id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.main_conversation_id IS NOT OLD.main_conversation_id OR NEW.provision_action_id IS NOT OLD.provision_action_id OR NEW.created_at IS NOT OLD.created_at OR NEW.config_json IS NOT OLD.config_json OR NEW.profile_binding_json IS NOT OLD.profile_binding_json OR NEW.revision IS NOT OLD.revision OR NEW.control_state IS NOT OLD.control_state OR NEW.control_epoch IS NOT OLD.control_epoch":'1');
    trigger('bot_routines',event,'automation','OLD.automation_id');
    trigger('bot_gateway_inbox',event,'employee','OLD.employee_id');
    for(const table of ['employee_environment_variables','employee_custom_params','employee_phone_mcp'])trigger(table,event,'employee','OLD.employee_id');
    trigger('conversation_messages',event,'conversation','OLD.conversation_id');
    for(const table of ['task_messages','task_attachments'])trigger(table,event,'task','OLD.task_id');
  }
  trigger('hermes_bots','INSERT','new-bot',"''");
  trigger('conversations','INSERT','conversation-new','NEW.employee_id');
  trigger('tasks','INSERT','task',"''",'NEW.assignee');
  trigger('conversation_messages','INSERT','conversation','NEW.conversation_id');
  trigger('task_messages','INSERT','task','NEW.task_id');
  trigger('task_attachments','INSERT','task','NEW.task_id');
  for(const table of ['employee_environment_variables','employee_custom_params','employee_phone_mcp','bot_gateway_inbox'])trigger(table,'INSERT','employee','NEW.employee_id');
  trigger('automation_runs','INSERT','automation','NEW.automation_id');
  trigger('webhook_deliveries','INSERT','automation','NEW.automation_id');
  trigger('a2a_actions','INSERT','action-new','NEW.task_id','NEW.type','NEW.payload_json');
  trigger('a2a_actions','DELETE','action','OLD.id');
  if(!readOnly&&exists(db,'a2a_actions')){db.exec('SAVEPOINT preservation_trigger_upgrade');try{db.exec(`DROP TRIGGER IF EXISTS preservation_a2a_actions_update;
    CREATE TRIGGER preservation_a2a_actions_update BEFORE UPDATE ON a2a_actions WHEN ziwei_v2_action_update_admitted(OLD.id,NEW.type,NEW.task_id,NEW.payload_json,NEW.status,NEW.expires_at)=0 OR ziwei_v2_admitted(OLD.id)=0 AND (NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.agent_id IS NOT OLD.agent_id OR NEW.dedupe_key IS NOT OLD.dedupe_key OR NEW.created_at IS NOT OLD.created_at OR NEW.acked_at IS NOT OLD.acked_at) BEGIN SELECT RAISE(ABORT,'V2_OBJECT_SEALED'); END`);
    db.exec('RELEASE preservation_trigger_upgrade');}catch(error){db.exec('ROLLBACK TO preservation_trigger_upgrade; RELEASE preservation_trigger_upgrade');throw error;}}
  return {state,inspect,begin,seal,restore,abort,classify,classifyAction,assert,assertAction,frozen,role,protectEmployeeTable,settle};
}

export function guardRepository(repo,options={}) {
  if(repo.preservation)return repo;
  const preservation=createPreservation(repo.db,options);repo.preservation=preservation;
  const setSkill=repo.setSkillInstalled;
  if(setSkill)repo.setSkillInstalled=function(skillId,installed){
    if(installed)return setSkill.call(this,skillId,installed);
    const db=this.db;db.exec('SAVEPOINT preservation_skill_uninstall');
    try{const row=db.prepare('SELECT * FROM skills WHERE id=?').get(skillId);if(!row)throw new Error('Skill not found');
      const affected=db.prepare('SELECT id,skills_json FROM employees WHERE workspace_id=?').all(row.workspace_id).filter(employee=>parse(employee.skills_json)?.includes(skillId));
      for(const employee of affected)preservation.assert({employeeId:employee.id});
      db.prepare('UPDATE skills SET installed=0,updated_at=? WHERE id=?').run(new Date().toISOString(),skillId);
      for(const employee of affected)db.prepare('UPDATE employees SET skills_json=? WHERE id=?').run(JSON.stringify(parse(employee.skills_json).filter(value=>value!==skillId)),employee.id);
      const slug=db.prepare('SELECT slug FROM workspaces WHERE id=?').get(row.workspace_id).slug,value=this.listSkills(slug).find(item=>item.id===skillId);
      db.exec('RELEASE preservation_skill_uninstall');return value;
    }catch(error){db.exec('ROLLBACK TO preservation_skill_uninstall; RELEASE preservation_skill_uninstall');throw error;}
  };
  repo.authorizeActionExecution=(actionId,input={})=>{
    preservation.assertAction(actionId);
    const row=repo.db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(actionId);if(!row)throw preservationError('ACTION_NOT_FOUND','原 action 不存在',404);
    const payload=parse(row.payload_json)||{},target=payload.deviceId||payload.device_id;
    if(!input.deviceId||target!==input.deviceId)throw preservationError('EXECUTION_DEVICE_MISMATCH','执行设备与原动作绑定不一致',403);
    if(row.status!=='acked')fail('EXECUTION_NOT_ACKED','原动作尚未领取或已终结，禁止本机执行');
    const protectedHomes=repo.db.prepare('SELECT b.employee_id,b.provision_action_id FROM hermes_bots b JOIN employees e ON e.id=b.employee_id WHERE e.target_device_id=?').all(input.deviceId).map(bot=>{const result=parse(repo.db.prepare('SELECT result_json FROM a2a_actions WHERE id=?').get(bot.provision_action_id)?.result_json),receipt=result?.botProvision||result?.result?.botProvision;return receipt?.home;}).filter(Boolean);
    return {allowed:true,actionId,executionBinding:executionBinding({...row,payload:repo.getA2AAction(actionId).payload}),productRole:preservation.role,productState:preservation.state(),protectedHomes};
  };
  const wrap=(name,check)=>{if(typeof repo[name]!=='function')return;const original=repo[name];repo[name]=function(...args){check(...args);return original.apply(this,args);};};
  const ack=repo.ackA2AAction;repo.ackA2AAction=function(actionId,input={}){
    const row=repo.db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(actionId),payload=parse(row?.payload_json)||{};
    if(preservation.role==='v2'&&preservation.state()==='preparing'&&preservation.classifyAction(row||{}).isV2&&row?.status==='acked'&&input.receiptOnly===true){
      if(!input.deviceId||input.deviceId!==(payload.deviceId||payload.device_id))throw preservationError('EXECUTION_DEVICE_MISMATCH','原完成补传与设备身份不匹配',403);
      if(Date.parse(row.expires_at)<=Date.now())fail('ROLLBACK_DELIVERY_LEASE_EXPIRED','原 ACK 已过期，保留证据并拒绝补传许可');
      return {id:row.id,status:row.status,acked_at:row.acked_at,expires_at:row.expires_at,deviceId:input.deviceId,receiptOnly:true,deliveryOnly:true,leaseRenewed:false};
    }
    if(!(input.receiptOnly===true&&['succeeded','failed','expired'].includes(row?.status)))preservation.assertAction(actionId);
    return ack.call(this,actionId,input);
  };
  for(const name of ['createTask','createConversation','createA2AAction','createAutomation'])wrap(name,(_slug,input={})=>{
    preservation.assert(input);
    const dedupe=input.dedupeKey||input.dedupe_key;if(name==='createA2AAction'&&preservation.frozen()&&dedupe){const ws=repo.db.prepare('SELECT id FROM workspaces WHERE slug=?').get(_slug),row=repo.db.prepare('SELECT id FROM a2a_actions WHERE workspace_id=? AND dedupe_key=?').get(ws?.id,dedupe);if(row)preservation.assertAction(row.id);}
  });
  for(const name of ['updateEmployee','deleteEmployee','upsertEmployeeEnvironment','deleteEmployeeEnvironment','replaceEmployeeCustomParams','updateEmployeePhoneMcp'])wrap(name,(employeeId)=>preservation.assert({employeeId}));
  for(const name of ['addConversationMessage','createConversationDirectoryAction','archiveConversation','updateConversationSettings'])wrap(name,(conversationId)=>preservation.assert({conversationId}));
  for(const name of ['updateTask','deleteTask','transitionTask','addTaskMessage','createTaskAttachment'])wrap(name,(taskId,input={})=>preservation.assert({...input,taskId}));
  wrap('deleteTaskAttachment',attachmentId=>{const row=repo.db.prepare('SELECT task_id FROM task_attachments WHERE id=?').get(attachmentId);if(row)preservation.assert({taskId:row.task_id});});
  for(const name of ['runAutomation','updateAutomation','deleteAutomation'])wrap(name,(automationId)=>preservation.assert({automationId}));
  for(const name of ['completeAutomationRun','queueAutomationRetry'])wrap(name,(runId)=>{if(name==='completeAutomationRun'&&preservation.role==='v2'&&preservation.state()==='preparing')return;preservation.assert({runId});});
  const queueWebhook=repo.queueWebhookDelivery;if(queueWebhook)repo.queueWebhookDelivery=function(runId,...args){if(preservation.frozen()&&preservation.classify({runId}).isV2)return null;return queueWebhook.call(this,runId,...args);};
  for(const name of ['authorizeBotStart','authorizeBotGateway','receiveBotGateway'])wrap(name,(actionId)=>preservation.assertAction(actionId));
  wrap('dispatchBotCollaboration',(_slug,manifest)=>preservation.assert({actionId:manifest?.sourceActionId,employeeId:manifest?.sourceEmployeeId}));
  const list=repo.listA2AActions;
  repo.listA2AActions=function(...args){const rows=list.apply(this,args);return preservation.frozen()&&String(args[1]?.status||'pending')!=='all'?rows.filter(row=>!preservation.classifyAction(row).isV2):rows;};
  for(const name of ['resultA2AAction','recordA2AEvent'])wrap(name,(actionId,input={})=>{
    if(!preservation.frozen())return;
    const state=preservation.state();
    // While preparing, original result delivery is allowed, without granting a
    // new lease/start. In sealed V1 only an already terminal ACK/result can be
    // read idempotently. Routine completion/retry guards remain independent.
    const row=repo.db.prepare('SELECT status FROM a2a_actions WHERE id=?').get(actionId);
    if(state==='preparing'&&preservation.role==='v2')return;
    if(name==='resultA2AAction'&&['succeeded','failed','expired'].includes(row?.status))return;
    preservation.assertAction(actionId);
  });
  const result=repo.resultA2AAction;repo.resultA2AAction=function(actionId,input={}){return preservation.settle(actionId,input,()=>result.call(this,actionId,input));};
  if(repo.authorizeBotSettlement){const original=repo.authorizeBotSettlement;repo.authorizeBotSettlement=function(...args){const value=original.apply(this,args);return preservation.frozen()?{...value,allowEvaluation:false}:value;};}
  for(const name of ['getEmployee','getConversation','getTask','getAutomationById','getA2AAction']){
    const original=repo[name];if(!original)continue;
    repo[name]=function(...args){const value=original.apply(this,args);if(!value)return value;const input=name==='getEmployee'?{employeeId:args[0]}:name==='getConversation'?{conversationId:args[0]}:name==='getTask'?{taskId:args[0]}:name==='getAutomationById'?{automationId:args[0]}:{actionId:args[0]};return preservation.frozen()&&preservation.classify(input).isV2?{...value,availability:{available:false,code:'V2_OBJECT_SEALED',state:preservation.state()}}:value;};
  }
  return repo;
}

export function guardBotService(repo,service) {
  for(const name of ['create','initialize','provision','validate','update','control','native','collaborate','createRoutine','updateRoutine','deleteRoutine','runRoutine'])if(typeof service[name]==='function'){
    const original=service[name];service[name]=function(...args){repo.preservation?.assert({type:'hermes.bot.configuration'});return original.apply(this,args);};
  }
  return service;
}
