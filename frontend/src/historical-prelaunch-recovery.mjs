const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));

// This field is projected only after the server verifies its committed event,
// source policy and original action bytes. Never interpret flags in result or
// an uncommitted event as a historical recovery.
export function historicalPrelaunchRecovery(execution) {
  const receipt=execution?.prelaunchRecovery,subject=receipt?.subject,proof=receipt?.admissionProof,payload=execution?.payload;
  const postUpdate=receipt?.schemaVersion===2,exit=postUpdate?receipt.maintenanceHolderExit:receipt?.daemonExit;
  if(execution?.status!=='failed'||!execution.id||![1,2].includes(receipt?.schemaVersion)||receipt.kind!=='bot.historical_prelaunch_recovery'||receipt.status!=='failed'||receipt.executionState!=='not_started'||receipt.policy!==(postUpdate?'6666a63-post-update-holder-prelaunch-v2':'6666a63-bot-start-admission-prelaunch-v1')||!['id','sourceBuild','sourcePolicyDigest','subjectDigest','evidenceDigest','localEvidenceDigest'].every(key=>hex(receipt[key]))||!date(receipt.recordedAt))return null;
  if(subject?.actionId!==execution.id||subject.actionType!=='conversation.execute'||execution.type!==subject.actionType||!subject.workspaceId||!subject.workspace||!subject.deviceId||!subject.employeeId||!subject.profile||subject.originalError!==execution.error)return null;
  if(payload&&(payload.employeeId!==subject.employeeId||payload.deviceId!==subject.deviceId||payload.profile!==subject.profile||payload.hermesBot?.workspace!==subject.workspace))return null;
  if(proof?.scope!=='conversation-runtime-root'||proof.phase!=='bot-start-admission'||proof.launched!==false||proof.partialEffectsPossible!==true||Object.keys(proof).length!==4||Object.hasOwn(receipt,'processExit'))return null;
  if(exit?.stopped!==true||!Number.isSafeInteger(exit.pid)||exit.pid<=0||!date(exit.creationTime)||!date(exit.exitedAt)||!Number.isFinite(receipt.localStartedAt)||Date.parse(exit.creationTime)>Date.parse(exit.exitedAt)||Date.parse(exit.exitedAt)>Date.parse(receipt.recordedAt)||Object.hasOwn(receipt,'originalDaemonExit'))return null;
  if(postUpdate){
    if(receipt.mode!=='post_update_holder'||subject.maintenanceHolderBuild!=='6c9345a699c977dcc69f396f2aee96e7ca96e38fc7c9f686b9b49217ae09c8d9'||!Number.isSafeInteger(subject.maintenanceHolderPid)||exit.pid!==subject.maintenanceHolderPid||Object.hasOwn(receipt,'daemonExit')||!hex(receipt.migrationEvidenceDigest)||!date(receipt.verifiedUpdateFinishedAt)||!date(subject.failedEvent?.createdAt)||Date.parse(receipt.verifiedUpdateFinishedAt)<Date.parse(subject.failedEvent.createdAt)||Date.parse(exit.creationTime)<Date.parse(receipt.verifiedUpdateFinishedAt))return null;
  }else if(Date.parse(exit.creationTime)>receipt.localStartedAt||Object.hasOwn(receipt,'maintenanceHolderExit')||Object.hasOwn(receipt,'migrationEvidenceDigest')||Object.hasOwn(receipt,'verifiedUpdateFinishedAt')||Object.hasOwn(receipt,'mode'))return null;
  return receipt;
}

export const HISTORICAL_PRELAUNCH_RECOVERY_DETAIL='已核实原模型调用未启动，历史阻塞已解除；原消息未重新派发。';
