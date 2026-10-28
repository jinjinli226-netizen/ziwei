import {executionProcessActive} from '../src/bot-execution-state.mjs';
// Occupancy and business success are separate. This exception never changes an
// old action's unknown phone result, retries its work, or proves its tree exited.
const object=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const decode=value=>{if(object(value))return value;try{const parsed=JSON.parse(value);return object(parsed)?parsed:null;}catch{return null;}};
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9_-][A-Za-z0-9._:-]{0,199}$/.test(value);
const knownKeys=(value,keys)=>object(value)&&Object.keys(value).every(key=>keys.includes(key));
const equal=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
const phoneReads=new Set(['ziwei_phone_screenshot','ziwei_phone_list','ziwei_phone_status','ziwei_phone_receipt','ziwei_phone_wait','ziwei_enrollment_pending']);
const managementReads=new Set(['ziwei_mcp_health','ziwei_discover_environment','ziwei_get_employee','ziwei_get_employee_mcp_status','ziwei_get_action','ziwei_get_task','ziwei_list_employees','ziwei_list_tasks','ziwei_list_documents','ziwei_read_document','ziwei_phone_mcp_setup','ziwei_get_phone_mcp_status']);
const phoneStates=new Set(['not_started','succeeded','failed','uncertain','pending']);
const terminalFailures=new Set(['failed','expired','cancelled','superseded','aborted','rejected','timed_out']);
const terminalStatus=item=>item.kind==='update'?item.status==='committed'||terminalFailures.has(item.status):item.status==='succeeded'||terminalFailures.has(item.status);
function callsFor(receipt){
  const calls=receipt?.toolCalls??receipt?.tool_calls;
  if(!Array.isArray(calls)||calls.length>10000||receipt.toolCalls&&receipt.tool_calls&&!equal(receipt.toolCalls,receipt.tool_calls))return null;
  return calls;
}
function otherUncertainty(value){
  const seen=new Set();let count=0;
  function visit(item){
    if(!item||typeof item!=='object')return false;
    if(seen.has(item)||++count>16384)return true;
    seen.add(item);
    if(item.code==='EXECUTION_UNCERTAIN'||item.executionState==='uncertain'||item.status==='uncertain'||item.fixture===true||item.executionSource==='fixture')return true;
    if(['nativeOperation','residentExit','residentWorker','quarantine','supervision','maintenanceCheckpoint'].some(key=>Object.hasOwn(item,key))||Object.hasOwn(item,'quarantined')&&item.quarantined!==false||Object.hasOwn(item,'processAlive')&&item.processAlive!==false||Object.hasOwn(item,'partialEffectsPossible')&&item.partialEffectsPossible!==false)return true;
    const unknown=Object.values(item).some(visit);seen.delete(item);return unknown;
  }
  return visit(value);
}

function phoneObservationOnly(phone){
  const calls=callsFor(phone);
  if(!calls||!calls.length)return false;
  const issued=new Map();let unknownRead=false;
  const idFor=(value,kind)=>{
    const direct=value[`${kind}Id`],nested=value.ids?.[`${kind}Id`];
    if(direct!==undefined&&!identifier(direct)||nested!==undefined&&!identifier(nested)||direct!==undefined&&nested!==undefined&&direct!==nested)throw new Error('ambiguous receipt identity');
    return direct??nested;
  };
  const update=(item,status,state)=>{
    if(typeof status!=='string'||!/^[a-z_]{1,40}$/.test(status))throw new Error('invalid receipt status');
    item.status=status;
    if(state!==undefined){if(!phoneStates.has(state))throw new Error('invalid execution state');item.executionState=state;}
  };
  try{
    for(const call of calls){
      if(!knownKeys(call,['toolName','ok','deviceId','commandId','updateId','requestId','ids','status','commandStatus','updateStatus','commandError','commandExecutionState','commandExecutingConfirmed','commandErrorCode','error','receipts'])||typeof call.ok!=='boolean'||!knownKeys(call.ids??{},['deviceId','commandId','updateId','requestId']))return false;
      const name=call.toolName,read=phoneReads.has(name),write=name==='ziwei_phone_action'||name==='ziwei_phone_upgrade';
      if(!read&&!write)return false;
      if(call.deviceId!==undefined&&call.deviceId!==phone.targetDeviceId||call.ids?.deviceId!==undefined&&call.ids.deviceId!==phone.targetDeviceId)return false;
      if(call.commandExecutionState!==undefined&&!phoneStates.has(call.commandExecutionState)||call.commandErrorCode==='EXECUTION_UNCERTAIN')return false;
      const commandId=idFor(call,'command'),updateId=idFor(call,'update');
      if(name==='ziwei_phone_action'&&!commandId||name==='ziwei_phone_upgrade'&&!updateId||name==='ziwei_phone_screenshot'&&updateId)return false;
      const submit=name==='ziwei_phone_action'||name==='ziwei_phone_screenshot'||name==='ziwei_phone_upgrade';
      if(read&&!call.ok)unknownRead=true;
      if(name==='ziwei_phone_screenshot'&&!commandId)unknownRead=true;
      for(const [kind,id] of [['command',commandId],['update',updateId]]){
        if(!id)continue;
        const key=`${kind}:${id}`;
        if(submit){
          const prior=issued.get(key);if(prior&&prior.write!==write)return false;
          if(!prior)issued.set(key,{kind,id,write,status:null});
        }
        const item=issued.get(key),status=call[`${kind}Status`]||call.status;
        if(item&&call.ok&&status)update(item,status,kind==='command'?call.commandExecutionState:undefined);
      }
      if(call.receipts!==undefined&&!Array.isArray(call.receipts))return false;
      for(const receipt of call.receipts??[]){
        if(!knownKeys(receipt,['commandId','updateId','status','error','executionState','executingConfirmed','errorCode'])||receipt.errorCode==='EXECUTION_UNCERTAIN'||typeof receipt.status!=='string'||!/^[a-z_]{1,40}$/.test(receipt.status)||!receipt.commandId&&!receipt.updateId)return false;
        for(const kind of ['command','update']){
          const id=receipt[`${kind}Id`];if(id!==undefined&&!identifier(id))return false;
          const item=issued.get(`${kind}:${id}`);
          if(item&&call.ok)update(item,receipt.status,kind==='command'?receipt.executionState:undefined);
        }
      }
    }
    for(const item of issued.values()){
      const unknown=!terminalStatus(item)||['uncertain','pending'].includes(item.executionState);
      if(item.write&&unknown)return false;
      if(!item.write&&unknown)unknownRead=true;
    }
  }catch{return false;}
  return unknownRead;
}

/** A confirmed failed CLI root can release its Bot slot when only a read-only
 * phone observation remains unknown. The original action remains unknown. */
export function exitedReadOnlyPhoneObservation(action,expected={}){
  const payload=decode(action?.payload??action?.payload_json),result=decode(action?.result??action?.result_json),bot=payload?.hermesBot,exit=result?.processExit,phone=result?.terminalMcp,isolation=result?.botIsolation;
  if(action?.status!=='failed'||!['conversation.execute','task.execute','agent.execute','runtime.execute','automation.execute'].includes(action.type)||!identifier(action.id)||!Number.isFinite(Date.parse(action.acked_at))||!Number.isFinite(Date.parse(action.completed_at))||Date.parse(action.completed_at)<Date.parse(action.acked_at)||!payload||!result||!object(bot)||!object(isolation))return false;
  if(!knownKeys(result,['runtime','model','profile','binary','code','signal','processExit','executionState','output','diagnostics','truncated','hermesBootstrap','creatorIsolation','managementMcp','terminalMcp','nativeSessionId','botIsolation','configurationRevision','turnLimit','reasoning','inputAttachments','outputArtifacts']))return false;
  if(payload.runtime!=='Hermes'||result.runtime!=='Hermes'||!identifier(payload.employeeId)||!identifier(payload.deviceId)||!identifier(payload.profile)||bot.schemaVersion!==1||bot.employeeId!==payload.employeeId||bot.deviceId!==payload.deviceId||bot.sourceProfile!==payload.profile||!identifier(bot.workspace)||!Number.isSafeInteger(bot.revision)||bot.revision<1||result.configurationRevision!==bot.revision)return false;
  if(expected.workspace!==undefined&&expected.workspace!==bot.workspace||expected.workspaceId!==undefined&&expected.workspaceId!==action.workspace_id||expected.employeeId!==undefined&&expected.employeeId!==payload.employeeId||expected.deviceId!==undefined&&expected.deviceId!==payload.deviceId||expected.profile!==undefined&&expected.profile!==payload.profile)return false;
  if(bot.instance?.mode!=='owned_profile'||bot.instance.profile!==payload.profile||!identifier(bot.instance.ownershipId)||isolation.enabled!==true||isolation.kind!=='hermes-bot'||isolation.mode!=='owned_profile'||isolation.workspace!==bot.workspace||isolation.employeeId!==payload.employeeId||isolation.profile!==payload.profile||isolation.sourceProfile!==payload.profile||isolation.revision!==bot.revision||isolation.key!==bot.instance.ownershipId)return false;
  if(!knownKeys(exit,['platform','supervisor','launched','rootPid','rootConfirmed','rootExitCode','treeConfirmed','activeProcesses','cancelled','failureCode','hostExitCode','signal','hostSignal','streamsComplete','backgroundProcessesRetained'])||exit.launched!==true||exit.rootConfirmed!==true||!Number.isSafeInteger(exit.rootPid)||exit.rootPid<=0||!Number.isSafeInteger(exit.rootExitCode)||exit.rootExitCode<=0||result.code!==exit.rootExitCode||exit.cancelled!==false||exit.failureCode||exit.signal||exit.hostSignal||result.signal||exit.hostExitCode!==0||exit.streamsComplete!==undefined&&exit.streamsComplete!==true)return false;
  if(exit.treeConfirmed===false){if(exit.platform!=='win32'||exit.supervisor!=='windows-job'||exit.backgroundProcessesRetained!==true||!Number.isSafeInteger(exit.activeProcesses)||exit.activeProcesses<=0)return false;}
  else if(exit.treeConfirmed!==true||exit.activeProcesses!==0||exit.backgroundProcessesRetained===true)return false;
  if(!knownKeys(phone,['configured','injected','loaded','transport','serverName','workspace','runtime','profile','runtimeProfile','employeeId','targetDeviceId','actionId','status','toolCalls','tool_calls','retryAllowed','executionState','failure'])||phone.configured!==true||phone.injected!==true||phone.loaded!==true||phone.transport!=='stdio'||phone.serverName!=='ziwei-terminal'||phone.status!=='loaded'||phone.runtime!=='Hermes'||phone.workspace!==bot.workspace||phone.employeeId!==payload.employeeId||phone.profile!==payload.profile||phone.runtimeProfile!==payload.profile||phone.actionId!==action.id||phone.executionState!=='uncertain'||phone.retryAllowed!==false)return false;
  const request=payload.terminalMcp;
  if(!object(request)||request.enabled!==true||request.workspace!==bot.workspace||request.employeeId!==payload.employeeId||!identifier(request.deviceId)||request.deviceId!==phone.targetDeviceId||!knownKeys(phone.failure,['code','phoneExecutionState','retryAllowed','nextAction','error','commandIds','updateIds'])||phone.failure.code!=='terminal_mcp_receipt_incomplete'||phone.failure.phoneExecutionState!=='uncertain'||phone.failure.retryAllowed!==false||!Array.isArray(phone.failure.commandIds)||!phone.failure.commandIds.every(identifier)||!Array.isArray(phone.failure.updateIds)||!phone.failure.updateIds.every(identifier))return false;
  const management=result.managementMcp;
  if(payload.managementMcp?.enabled===true&&!management)return false;
  if(management){const calls=callsFor(management);if(!calls||management.configured!==true||management.injected!==true||management.loaded!==true||management.transport!=='stdio'||management.status!=='loaded'||management.workspace!==bot.workspace||management.runtime!=='Hermes'||management.runtimeProfile!==payload.profile||calls.some(call=>call.ok!==true||!managementReads.has(call.toolName)))return false;}
  const {terminalMcp:_phone,executionState:_businessState,...other}=result;
  if(result.executionState!=='uncertain'||otherUncertainty(other)||payload.nativeOperation||payload.collaborationManifest||payload.nativeDriver)return false;
  return phoneObservationOnly(phone);
}

/** Terminal failures reserve a slot only for positive live-process evidence. */
export function botExecutionOccupiesSlot(action,expected={}){
  if(!action)return false;
  if(['pending','acked'].includes(action.status))return true;
  return executionProcessActive(decode(action.result??action.result_json))&&!exitedReadOnlyPhoneObservation(action,expected);
}
