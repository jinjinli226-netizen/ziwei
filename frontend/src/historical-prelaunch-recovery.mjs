const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));

// This field is projected only after the server verifies its committed event,
// source policy and original action bytes. Never interpret flags in result or
// an uncommitted event as a historical recovery.
export function historicalPrelaunchRecovery(execution) {
  const receipt=execution?.prelaunchRecovery,subject=receipt?.subject,proof=receipt?.admissionProof,exit=receipt?.daemonExit,payload=execution?.payload;
  if(execution?.status!=='failed'||!execution.id||receipt?.schemaVersion!==1||receipt.kind!=='bot.historical_prelaunch_recovery'||receipt.status!=='failed'||receipt.executionState!=='not_started'||receipt.policy!=='6666a63-bot-start-admission-prelaunch-v1'||!['id','sourceBuild','sourcePolicyDigest','subjectDigest','evidenceDigest','localEvidenceDigest'].every(key=>hex(receipt[key]))||!date(receipt.recordedAt))return null;
  if(subject?.actionId!==execution.id||subject.actionType!=='conversation.execute'||execution.type!==subject.actionType||!subject.workspaceId||!subject.workspace||!subject.deviceId||!subject.employeeId||!subject.profile||subject.originalError!==execution.error)return null;
  if(payload&&(payload.employeeId!==subject.employeeId||payload.deviceId!==subject.deviceId||payload.profile!==subject.profile||payload.hermesBot?.workspace!==subject.workspace))return null;
  if(proof?.scope!=='conversation-runtime-root'||proof.phase!=='bot-start-admission'||proof.launched!==false||proof.partialEffectsPossible!==true||Object.keys(proof).length!==4||Object.hasOwn(receipt,'processExit'))return null;
  if(exit?.stopped!==true||!Number.isSafeInteger(exit.pid)||exit.pid<=0||!date(exit.creationTime)||!date(exit.exitedAt)||!Number.isFinite(receipt.localStartedAt)||Date.parse(exit.creationTime)>receipt.localStartedAt||Date.parse(exit.exitedAt)>Date.parse(receipt.recordedAt))return null;
  return receipt;
}

export const HISTORICAL_PRELAUNCH_RECOVERY_DETAIL='已核实原模型调用未启动，历史阻塞已解除；原消息未重新派发。';
