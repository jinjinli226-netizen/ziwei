import {
  HISTORICAL_PRELAUNCH_POLICY as policy,
  historicalPrelaunchDigest as digest,
  historicalPrelaunchExactKeys as exact,
  historicalPrelaunchHex as hex,
  validateHistoricalPrelaunchReceipt,
  validateHistoricalPostUpdateHolderMigrationEvidence,
} from './bot-historical-prelaunch-policy.mjs';

// This is a local admission-history exception, never a process-tree exit proof.
// The original started record is retained byte-for-byte in the recovery backup.
export function isHistoricalPrelaunchCompletion({started,completed,identity}={}) {
  const result=completed?.result,body=result?.result,receipt=body?.prelaunchRecovery,local=body?.prelaunchEvidence,q=local?.quarantine;
  if(!exact(completed,['key','identity','result'])||!exact(result,['status','actionId','error','completedAt','code','result'])||!exact(body,['code','executionState','partialEffectsPossible','prelaunchRecovery','prelaunchEvidence',...(receipt?.schemaVersion===2?['prelaunchMigrationEvidence']:[])]))return false;
  if(!validateHistoricalPrelaunchReceipt(receipt,{actionId:started?.actionId})||digest(local)!==receipt.localEvidenceDigest||result.status!=='failed'||result.code!=='BOT_HISTORICAL_PRELAUNCH_REJECTED'||body.code!==result.code||body.executionState!=='not_started'||body.partialEffectsPossible!==true||result.error!==policy.error||result.completedAt!==Date.parse(receipt.recordedAt))return false;
  if(receipt.schemaVersion===2&&(digest(body.prelaunchMigrationEvidence)!==receipt.migrationEvidenceDigest||body.prelaunchMigrationEvidence?.finishedAt!==receipt.verifiedUpdateFinishedAt||!validateHistoricalPostUpdateHolderMigrationEvidence(body.prelaunchMigrationEvidence,{subject:receipt.subject,recordedAt:receipt.recordedAt})))return false;
  if(!started||completed.key!==started.key||result.actionId!==started.actionId||started.key!==receipt.subject.dedupeKey||digest(completed.identity)!==digest(started.identity)||started.nativeRuntime!==true||started.startedAt!==receipt.localStartedAt||q?.startedSha256!==digest(started)||q?.actionId!==started.actionId||q?.dedupeKey!==started.key||q?.startedAt!==started.startedAt)return false;
  if(!exact(local,['sourceFiles','quarantine','noSupervision','quarantineCount'])||!exact(q,['actionId','dedupeKey','startedAt','startedSha256','stateSha256','deliverySha256','actionSha256','resultSha256','serverResultDigest'])||!['startedSha256','stateSha256','deliverySha256','actionSha256','resultSha256','serverResultDigest'].every(key=>hex(q[key]))||q.serverResultDigest!==receipt.subject.originalWireBodyDigest||!Array.isArray(local.sourceFiles)||local.sourceFiles.length!==Object.keys(policy.sourceFiles).length||local.sourceFiles.some(row=>!exact(row,['path','sha256'])))return false;
  const sources=Object.fromEntries(local.sourceFiles.map(row=>[row.path,row.sha256]));
  if(Object.keys(sources).length!==local.sourceFiles.length||digest(sources)!==digest(policy.sourceFiles))return false;
  const stored=started.identity,binding=started.resourceBinding,subject=receipt.subject;
  return stored?.workspace===identity?.workspace&&stored?.deviceId===identity?.deviceId&&stored.workspace===subject.workspace&&stored.deviceId===subject.deviceId&&stored.workspaceId===subject.workspaceId&&stored.targetDeviceId===subject.deviceId&&binding?.type==='conversation.execute'&&binding.employeeId===subject.employeeId&&binding.revision===subject.originalRevision&&binding.controlEpoch===subject.originalControlEpoch&&binding.resource===null&&binding.operation===null&&binding.platform===null&&started.quarantine?.reason==='EXECUTOR_WITHOUT_EXIT_EVIDENCE'&&started.quarantine.stopConfirmed===false&&local.noSupervision===true&&local.quarantineCount===1;
}
