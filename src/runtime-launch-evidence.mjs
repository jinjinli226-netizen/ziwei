// These capabilities stay in this process. Plain executor results, payloads and
// serialised Error properties cannot manufacture a prelaunch conclusion.
const prelaunchFailures = new WeakMap();
const botAdmissionDenials = new WeakMap();
const botAdmissionCodes = new Set(['BOT_REVISION_CONFLICT','BOT_NOT_ACTIVE','BOT_NOT_VALIDATED','BOT_START_INVALID']);
const notLaunched = () => Object.freeze({platform:process.platform,supervisor:'runtime-prelaunch',launched:false,rootPid:null,rootConfirmed:false,rootExitCode:null,treeConfirmed:true,activeProcesses:0,cancelled:false});
const botAdmissionScope = value => {
  const {actionId,workspace,employeeId,deviceId,profile,revision,controlEpoch}=value;
  if(![actionId,workspace,employeeId,deviceId,profile].every(item=>typeof item==='string'&&item.length>0)||!Number.isInteger(revision)||revision<1||!Number.isInteger(controlEpoch)||controlEpoch<1)return null;
  return {schemaVersion:1,source:'bot-start-admission',phase:'before-runtime-spawn',spawnAttempted:false,method:'POST',operation:'bot-start',actionId,workspace,employeeId,deviceId,profile,revision,controlEpoch};
};

// This is the paired-device POST itself, not a marker accepted from a payload
// or an arbitrary executor error. A failed request only becomes a no-launch
// capability when the owned adapter subsequently crosses its final boundary.
export async function requestBotStartAdmission({apiBase,deviceToken,signal,maintenanceAttempt,fetchImpl=globalThis.fetch,...scope}={}) {
  const admission=botAdmissionScope(scope);
  if(!admission||!apiBase||!deviceToken)throw new Error('Bot 缺少当前工作区已配对设备凭据');
  const failure=(kind,status=null,code=null)=>{
    const codes={cancelled:'BOT_START_CANCELLED',timeout:'BOT_START_TIMEOUT',network:'BOT_START_UNAVAILABLE',http:'BOT_START_HTTP_FAILED',invalid_response:'BOT_START_RESPONSE_INVALID'};
    const messages={cancelled:'执行已取消；Hermes 尚未启动',timeout:'启动前授权请求超时；Hermes 尚未启动',network:'启动前授权服务暂时无法连接；Hermes 尚未启动',http:'启动前授权服务拒绝请求；Hermes 尚未启动',invalid_response:'启动前授权响应无法核对；Hermes 尚未启动'};
    const error=Object.assign(new Error(messages[kind]),{code:code||codes[kind]});
    const detail=Object.freeze({kind,...(status!==null?{status}:{}),code:error.code});
    botAdmissionDenials.set(error,Object.freeze({...admission,failure:detail}));
    return error;
  };
  const interrupted=(error,fallback)=>signal?.aborted?'cancelled':error?.name==='TimeoutError'?'timeout':fallback;
  if(signal?.aborted)throw failure('cancelled');
  let response;
  try {
    response=await fetchImpl(`${String(apiBase).replace(/\/$/,'')}/a2a/v1/actions/${encodeURIComponent(admission.actionId)}/bot-start`,{
      method:'POST',headers:{'content-type':'application/json','x-ziwei-device-token':deviceToken,'x-ziwei-bot-secret-protocol':'1'},
      body:JSON.stringify({workspace:admission.workspace,...(maintenanceAttempt?{maintenanceAttempt}:{})}),
      signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000),redirect:'error',
    });
  } catch(error) {throw failure(interrupted(error,'network'));}
  const status=Number.isInteger(response?.status)&&response.status>=100&&response.status<=599?response.status:null;
  if(status===null||typeof response?.json!=='function')throw failure('invalid_response');
  let value;
  try {value=await response.json();}
  catch(error) {throw failure(interrupted(error,error instanceof SyntaxError?'invalid_response':'network'),status);}
  if(signal?.aborted)throw failure('cancelled',status);
  if(!response.ok||value?.allowed!==true){
    const code=typeof value?.code==='string'&&botAdmissionCodes.has(value.code)?value.code:null;
    if(status>=400&&status<500&&code){
      throw markBotStartAdmissionDenied(Object.assign(new Error('Bot 启动授权已失效或已暂停；Hermes 尚未启动'),{code}),{...admission,status,code});
    }
    throw failure(response.ok?'invalid_response':'http',status);
  }
  if(value.actionId!==admission.actionId||value.revision!==admission.revision||value.controlEpoch!==admission.controlEpoch)throw failure('invalid_response',status);
  return value;
}

// Only the local paired-device admission caller can create this capability.
// HTTP data and Error properties alone are never a no-launch receipt.
export function markBotStartAdmissionDenied(error, admission) {
  if (!(error instanceof Error) || !Number.isInteger(admission?.status) || admission.status < 400 || admission.status >= 500 || !botAdmissionCodes.has(admission.code)) return error;
  const scope=botAdmissionScope(admission),{status,code}=admission;
  if(!scope)return error;
  botAdmissionDenials.set(error,Object.freeze({...scope,denial:Object.freeze({status,code})}));
  return error;
}

// Call only at an owned runtime's final authorization boundary, before spawn.
// A group that already registered children still retains its actual supervision.
export async function runBeforeSpawnAdmission(beforeSpawn) {
  if (!beforeSpawn) return;
  try { await beforeSpawn(); }
  catch (error) {
    const admission=botAdmissionDenials.get(error);
    if(admission){botAdmissionDenials.delete(error);prelaunchFailures.set(error,Object.freeze({prelaunch:admission,processExit:notLaunched()}));}
    throw error;
  }
}
export function markHermesLauncherFailure(error) {
  const failure=error instanceof Error?error:new Error(String(error));
  prelaunchFailures.set(failure,Object.freeze({
    prelaunch:Object.freeze({source:'hermes-launcher-resolver',phase:'before-native-probe'}),
    processExit:notLaunched()
  }));
  return failure;
}
// The owned adapter calls this only after its read-only native MCP inventory
// fails, before preparing or spawning an employee/model execution. Wire error
// fields and an arbitrary executor's rejected Promise cannot create this proof.
export function markCodexMcpConfigurationFailure(error) {
  const failure=error instanceof Error?error:new Error(String(error));
  prelaunchFailures.set(failure,Object.freeze({
    prelaunch:Object.freeze({source:'codex-mcp-config-discovery',phase:'before-runtime-spawn',spawnAttempted:false,operation:'mcp.list'}),
    processExit:notLaunched()
  }));
  return failure;
}
// Called only by the owned Codex bind/prepare entry before native spawn.
// Scope data from wire errors cannot create this in-process capability.
export function markCodexConversationPrelaunchFailure(error, scope) {
  const valid=(key,prefix)=>typeof scope?.[key]==='string'&&new RegExp('^'+prefix+'[A-Za-z0-9_-]{1,120}$').test(scope[key]);
  if(!(error instanceof Error)||typeof scope?.workspace!=='string'||!/^[a-z0-9][a-z0-9_-]{0,99}$/i.test(scope.workspace)||!valid('actionId','action_')||!valid('deviceId','device_')||!valid('employeeId','employee_')||!valid('conversationId','conv_'))return error;
  prelaunchFailures.set(error,Object.freeze({prelaunch:Object.freeze({schemaVersion:1,source:'codex-conversation-preflight',phase:'before-runtime-spawn',spawnAttempted:false,actionId:scope.actionId,workspace:scope.workspace,deviceId:scope.deviceId,employeeId:scope.employeeId,conversationId:scope.conversationId}),processExit:notLaunched()}));
  return error;
}
export function consumeRuntimePrelaunchEvidence(error) {
  const evidence=prelaunchFailures.get(error);if(evidence)prelaunchFailures.delete(error);return evidence || null;
}
export const hasBotStartAdmissionPrelaunchEvidence = error => prelaunchFailures.get(error)?.prelaunch?.source === 'bot-start-admission';

// A confirmed root by itself can leave children behind. Error cleanup requires
// the complete owned tree, including each child of a registered runtime group.
export function completeRuntimeExit(value,depth=0) {
  if(!value||depth>4||value.treeConfirmed!==true||value.activeProcesses!==0||value.failureCode)return false;
  if(value.supervisor==='runtime-group')return value.rootConfirmed===true&&typeof value.launched==='boolean'&&Array.isArray(value.children)&&value.children.length<=64&&(value.launched===false||value.children.length>0)&&value.children.every(child=>completeRuntimeExit(child,depth+1));
  if(value.launched===false)return value.rootPid===null&&value.rootExitCode===null;
  return value.launched===true&&value.rootConfirmed===true&&Number.isSafeInteger(value.rootPid)&&value.rootPid>0&&Number.isSafeInteger(value.rootExitCode);
}
