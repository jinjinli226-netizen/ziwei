// These capabilities stay in this process. Plain executor results, payloads and
// serialised Error properties cannot manufacture a prelaunch conclusion.
const prelaunchFailures = new WeakMap();
export function markHermesLauncherFailure(error) {
  const failure=error instanceof Error?error:new Error(String(error));
  prelaunchFailures.set(failure,Object.freeze({
    prelaunch:Object.freeze({source:'hermes-launcher-resolver',phase:'before-native-probe'}),
    processExit:Object.freeze({platform:process.platform,supervisor:'runtime-prelaunch',launched:false,rootPid:null,rootConfirmed:false,rootExitCode:null,treeConfirmed:true,activeProcesses:0,cancelled:false})
  }));
  return failure;
}
export function consumeRuntimePrelaunchEvidence(error) {
  const evidence=prelaunchFailures.get(error);if(evidence)prelaunchFailures.delete(error);return evidence || null;
}

// A confirmed root by itself can leave children behind. Error cleanup requires
// the complete owned tree, including each child of a registered runtime group.
export function completeRuntimeExit(value,depth=0) {
  if(!value||depth>4||value.treeConfirmed!==true||value.activeProcesses!==0||value.failureCode)return false;
  if(value.supervisor==='runtime-group')return value.rootConfirmed===true&&typeof value.launched==='boolean'&&Array.isArray(value.children)&&value.children.length<=64&&(value.launched===false||value.children.length>0)&&value.children.every(child=>completeRuntimeExit(child,depth+1));
  if(value.launched===false)return value.rootPid===null&&value.rootExitCode===null;
  return value.launched===true&&value.rootConfirmed===true&&Number.isSafeInteger(value.rootPid)&&value.rootPid>0&&Number.isSafeInteger(value.rootExitCode);
}
