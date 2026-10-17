import {
  HISTORICAL_PRELAUNCH_POLICY as POLICY,
  HISTORICAL_PRELAUNCH_RECOVERY_KIND as KIND,
  canonicalHistoricalPrelaunchValue as canonical,
  historicalPrelaunchDigest as digest,
  historicalPrelaunchBytesDigest as bytesDigest,
  historicalPrelaunchDeliveredPayload,
  historicalPrelaunchExactKeys as exact,
  historicalPrelaunchHex as hex,
  validateHistoricalPrelaunchReceipt,
} from '../src/bot-historical-prelaunch-policy.mjs';

const REQUEST_KIND='bot-historical-prelaunch-recovery-v1';
const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
const same=(left,right)=>canonical(left)===canonical(right);

// Only the committed recovery record can supplement an original failure. The
// original action/result/error remain the source of the historical receipt.
export function readHistoricalPrelaunchRecovery(db,row) {
  try {
    if(!row||row.status!=='failed')return null;
    const saved=db.prepare('SELECT fingerprint,resource_id FROM management_requests WHERE workspace_id=? AND kind=? AND request_key=?').get(row.workspace_id,REQUEST_KIND,row.id);
    if(!saved)return null;
    const event=db.prepare('SELECT * FROM a2a_action_events WHERE id=? AND action_id=? AND type=?').get(saved.resource_id,row.id,KIND),data=parse(event?.data_json),receipt=data?.receipt;
    if(!exact(data,['receipt','evidence','originalResult','originalError'])||!validateHistoricalPrelaunchReceipt(receipt,{actionId:row.id})||event.id!==`action-event_${receipt.id}`||event.created_at!==receipt.recordedAt||saved.fingerprint!==receipt.evidenceDigest||receipt.id!==digest({actionId:row.id,subjectDigest:receipt.subjectDigest,evidenceDigest:receipt.evidenceDigest}))return null;
    const subject=receipt.subject,payload=parse(row.payload_json),snapshot=payload?.hermesBot,result=parse(row.result_json);
    if(subject.originalActionSha256!==bytesDigest(canonical(row))||subject.originalPayloadSha256!==bytesDigest(row.payload_json)||subject.originalResultSha256!==bytesDigest(row.result_json)||subject.originalDeliveredPayloadDigest!==digest(historicalPrelaunchDeliveredPayload(payload))||subject.originalResultDigest!==digest(result)||data.originalError!==row.error||subject.originalError!==row.error||!same(data.originalResult,result))return null;
    const workspace=db.prepare('SELECT slug FROM workspaces WHERE id=?').get(row.workspace_id);
    if(subject.workspaceId!==row.workspace_id||subject.workspace!==workspace?.slug||subject.actionType!==row.type||subject.dedupeKey!==row.dedupe_key||subject.createdAt!==row.created_at||subject.ackedAt!==row.acked_at||subject.completedAt!==row.completed_at||row.agent_id!=='ziwei_user'||payload?.runtime!=='Hermes'||payload.employeeId!==subject.employeeId||payload.deviceId!==subject.deviceId||payload.profile!==subject.profile||snapshot?.employeeId!==subject.employeeId||snapshot.workspace!==subject.workspace||snapshot.deviceId!==subject.deviceId||snapshot.sourceProfile!==subject.profile||snapshot.revision!==subject.originalRevision||snapshot.controlEpoch!==subject.originalControlEpoch||!same(snapshot.instance,subject.profileBinding)||digest(subject.profileBinding)!==subject.profileBindingDigest)return null;
    const failures=db.prepare("SELECT * FROM a2a_action_events WHERE action_id=? AND type IN ('failed','succeeded') ORDER BY created_at,id").all(row.id),original=failures[0],originalData=parse(original?.data_json);
    if(failures.length!==1||original.type!=='failed'||original.id!==subject.failedEvent.id||original.created_at!==subject.failedEvent.createdAt||bytesDigest(original.data_json)!==subject.failedEvent.dataSha256||!exact(originalData,['error','result'])||originalData.error!==row.error||!same(originalData.result,result)||digest(originalData.result)!==subject.failedEvent.resultDigest)return null;
    const evidence=data.evidence,local=evidence?.localEvidence,q=local?.quarantine;
    if(!exact(evidence,['schemaVersion','policy','sourceBuild','sourcePolicyDigest','subjectDigest','daemonExit','localEvidence'])||evidence.schemaVersion!==1||evidence.policy!==receipt.policy||evidence.sourceBuild!==receipt.sourceBuild||evidence.sourcePolicyDigest!==receipt.sourcePolicyDigest||evidence.subjectDigest!==receipt.subjectDigest||!same(evidence.daemonExit,receipt.daemonExit)||digest(evidence)!==receipt.evidenceDigest||digest(local)!==receipt.localEvidenceDigest)return null;
    if(!exact(local,['sourceFiles','quarantine','noSupervision','quarantineCount'])||local.noSupervision!==true||local.quarantineCount!==1||!Array.isArray(local.sourceFiles)||local.sourceFiles.length!==Object.keys(POLICY.sourceFiles).length||local.sourceFiles.some(item=>!exact(item,['path','sha256'])))return null;
    const sources=Object.fromEntries(local.sourceFiles.map(item=>[item.path,item.sha256]));
    if(Object.keys(sources).length!==local.sourceFiles.length||!same(sources,POLICY.sourceFiles)||!exact(q,['actionId','dedupeKey','startedAt','startedSha256','stateSha256','deliverySha256','actionSha256','resultSha256','serverResultDigest'])||!['startedSha256','stateSha256','deliverySha256','actionSha256','resultSha256','serverResultDigest'].every(key=>hex(q[key]))||q.actionId!==row.id||q.dedupeKey!==row.dedupe_key||q.startedAt!==receipt.localStartedAt||q.serverResultDigest!==subject.originalWireBodyDigest||subject.originalWireBodyDigest!==digest({status:'failed',result,error:row.error,receiptOnly:true}))return null;
    return receipt;
  } catch {
    return null;
  }
}
