const object=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const text=value=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\0\r\n]/.test(value);
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const integer=value=>Number.isSafeInteger(value)&&value>=1;
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));

// Only the authenticated server's top-level, independently verified disposition
// authorizes an operational end. The original unknown result is never rewritten.
function read(value,expected={}){
  const receipt=value?.receipt,subject=receipt?.subject;
  if(!object(value)||!['awaiting_client','client_archived'].includes(value.state)||receipt?.schemaVersion!==1||receipt.kind!=='bot.failed_execution_finalization'||!hex(receipt.id)||!hex(value.receiptDigest)||receipt.status!=='failed'||receipt.executionState!=='uncertain'||receipt.executionConfirmedStopped!==false||receipt.partialEffectsPossible!==true||!integer(receipt.expectedRevision)||!integer(receipt.expectedControlEpoch)||receipt.resultingControlEpoch!==receipt.expectedControlEpoch+1||!date(receipt.recordedAt)||!object(subject))return null;
  if(receipt.disposition==='failed_automatically'){
    if(receipt.actorRole!=='system'||receipt.actorUserId!==null)return null;
  }else if(receipt.disposition!=='abandoned_by_user'||!['owner','admin'].includes(receipt.actorRole)||!text(receipt.actorUserId))return null;
  if(!['actionId','actionType','workspace','workspaceId','employeeId','deviceId','profile'].every(key=>text(subject[key]))||!integer(subject.originalRevision)||!integer(subject.originalControlEpoch)||!['profileBindingDigest','originalPayloadDigest','originalResultDigest','originalActionSha256'].every(key=>hex(subject[key]))||Object.entries(expected).some(([key,item])=>item!==undefined&&subject[key]!==item))return null;
  if(value.state==='client_archived'){
    const acknowledgement=value.acknowledgement,ack=acknowledgement?.ack;
    if(acknowledgement?.deviceId!==subject.deviceId||!text(acknowledgement.credentialId)||!date(acknowledgement.recordedAt)||ack?.receiptId!==receipt.id||ack.receiptDigest!==value.receiptDigest||!hex(ack.archiveSha256)||!['no_live_instance','terminated_exact_instance','unobservable'].includes(ack.localProcessDisposition))return null;
  }
  return value;
}
export function failureFinalization(run){
  if(!text(run?.id)||!text(run.type)||run.status!=='failed'||!object(run.payload))return null;
  const payload=run.payload,bot=payload.hermesBot;
  if(!['employeeId','deviceId','profile'].every(key=>text(payload[key]))||!object(bot)||!text(bot.workspace))return null;
  const value=read(run.failureFinalization,{actionId:run.id,actionType:run.type,workspaceId:run.workspace_id,employeeId:payload.employeeId,deviceId:payload.deviceId,profile:payload.profile,workspace:bot?.workspace,originalRevision:bot?.revision,originalControlEpoch:bot?.controlEpoch});
  if(!value||payload.runtime!==undefined&&payload.runtime!=='Hermes')return null;
  const subject=value.receipt.subject;
  if(run.dedupe_key!==undefined&&run.dedupe_key!==subject.dedupeKey)return null;
  if(bot&&['employeeId','deviceId','sourceProfile'].some(key=>bot[key]!==undefined&&bot[key]!==subject[key==='sourceProfile'?'profile':key]))return null;
  return value;
}
export function pendingBotFailureFinalization(bot){
  if(!bot?.id)return null;
  const expected={employeeId:bot.id,workspace:bot.workspace,workspaceId:bot.workspace_id,deviceId:bot.employee?.target_device_id,profile:bot.employee?.runtime_profile};
  const value=read(bot.failureFinalization,expected);
  return value?.state==='awaiting_client'?value:null;
}
export function pendingFinalizationAction(bot){
  const value=pendingBotFailureFinalization(bot);if(!value)return null;
  const subject=value.receipt.subject;
  return{id:subject.actionId,type:subject.actionType,status:'failed',workspace_id:subject.workspaceId,
    payload:{runtime:'Hermes',employeeId:subject.employeeId,deviceId:subject.deviceId,profile:subject.profile,hermesBot:{workspace:subject.workspace,employeeId:subject.employeeId,deviceId:subject.deviceId,sourceProfile:subject.profile,revision:subject.originalRevision,controlEpoch:subject.originalControlEpoch}},failureFinalization:value};
}
export function finalizationPresentation(value,{offline=false}={}){
  if(!value)return null;
  const pending=value.state==='awaiting_client';
  return{pending,tone:'error',label:pending?(offline?'执行失败，等待电脑连接':'执行失败，正在自动收尾'):'本轮失败，已结束',detail:pending?'原电脑连接后自动结束并归档本轮，不会自动重跑，无需手动核实。':'原电脑已归档本轮失败；原业务结果仍未确认，原始回执已保留，不会自动重跑。'};
}
