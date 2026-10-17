// These capabilities stay in this process. Plain executor results, payloads and
// serialised Error properties cannot manufacture a prelaunch conclusion.
const prelaunchFailures = new WeakMap();
const botAdmissionDenials = new WeakMap();
const botAdmissionCodes = new Set(['BOT_REVISION_CONFLICT','BOT_NOT_ACTIVE','BOT_NOT_VALIDATED','BOT_START_INVALID']);
const notLaunched = () => Object.freeze({platform:process.platform,supervisor:'runtime-prelaunch',launched:false,rootPid:null,rootConfirmed:false,rootExitCode:null,treeConfirmed:true,activeProcesses:0,cancelled:false});

// Only the local paired-device admission caller can create this capability.
// HTTP data and Error properties alone are never a no-launch receipt.
export function markBotStartAdmissionDenied(error, admission) {
  if (!(error instanceof Error) || !Number.isInteger(admission?.status) || admission.status < 400 || admission.status >= 500 || !botAdmissionCodes.has(admission.code)) return error;
  const {actionId,workspace,employeeId,deviceId,profile,revision,controlEpoch,status,code} = admission;
  if (![actionId,workspace,employeeId,deviceId,profile].every(value=>typeof value==='string'&&value.length>0) || !Number.isInteger(revision) || !Number.isInteger(controlEpoch)) return error;
  botAdmissionDenials.set(error,Object.freeze({schemaVersion:1,source:'bot-start-admission',phase:'before-runtime-spawn',spawnAttempted:false,method:'POST',operation:'bot-start',actionId,workspace,employeeId,deviceId,profile,revision,controlEpoch,denial:Object.freeze({status,code})}));
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
