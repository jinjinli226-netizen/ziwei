const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const text=value=>typeof value==='string'&&value.length>0&&value.length<=500&&!/[\0\r\n]/.test(value);
const exact=(value,keys)=>Boolean(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key)));
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([left],[right])=>left.localeCompare(right))):item);
const same=(left,right)=>canonical(left)===canonical(right);

// This release permits one explicitly abandoned historical action. The server
// verifies the committed owner grant, device proof and original raw bytes before
// projecting this top-level field. Result flags and event bodies are not authority.
const pins={
  actionId:'action_2805b4da-c082-49a2-b0f1-b43bdeb107fe',workspace:'bigtron',workspaceId:'ws_52fa81da-ddeb-439a-9a74-ab4df4b2636e',deviceId:'device_bfd9a3d2-c2cc-4a36-8bd8-465bea492493',employeeId:'employee_5f157a51-a8fa-483c-90df-53d44292b5d2',profile:'bot-e1bf33c85b1543b18ecd3d6a',
  originalPayloadSha256:'e09ffebdb7d2e775fc3a3712159d2076c26319977b8596f05f22c816c6848448',originalResultSha256:'cd625b824e89339e813ee4c8f9b43e9101076b6af6585d4ed48ab5270f6a372f',
  holderBuild:'c477b6bb9044ae181d97efaae9ee3188a985cc32805f5a8eedfe3df09660e341',
};
const originalError='执行状态无法安全确认，需人工核实后处理：Bot 配置或控制状态已变化，请重新读取';
const originalResult={processExit:null,partialEffectsPossible:true,code:'EXECUTION_UNCERTAIN',executionState:'uncertain',reason:'EXECUTOR_WITHOUT_EXIT_EVIDENCE'};
const policyDigest='21c59abdb77f1a887c45110ba4ac89dcf6277f0f7a0af8a236aaa6d456271a37';
const originalResultDigest='a235a4770a2f5d2ffcb6865bae6697f39dc0bdd3ffef710a3dd25685c3c53e46';
const receiptKeys=['schemaVersion','kind','id','policy','policyDigest','subject','subjectDigest','grantId','grantDigest','evidenceDigest','localArchiveDigest','currentDaemonExit','resultingControlEpoch','executionState','disposition','executionConfirmedStopped','partialEffectsPossible','recordedAt'];
const subjectKeys=['schemaVersion','actionId','actionType','workspace','workspaceId','deviceId','employeeId','credentialId','profile','profileBinding','profileBindingDigest','dedupeKey','createdAt','ackedAt','completedAt','originalRevision','originalControlEpoch','currentRevision','currentControlEpoch','currentControlState','currentEmployeeStatus','originalActionSha256','originalPayloadSha256','originalDeliveredPayloadDigest','originalResultSha256','originalResultDigest','originalError','failedEvent','grantId','grantDigest','holderBuild','holder'];

export function operatorForceAbandonRecovery(execution) {
  const receipt=execution?.forceAbandonRecovery,subject=receipt?.subject,exit=receipt?.currentDaemonExit,payload=execution?.payload,bot=payload?.hermesBot;
  if(execution?.status!=='failed'||execution.agent_id!=='ziwei_user'||execution.type!=='conversation.execute'||!exact(receipt,receiptKeys)||receipt.schemaVersion!==1||receipt.kind!=='bot.operator_force_abandon'||receipt.policy!=='zhiwei-operator-force-abandon-v1'||receipt.policyDigest!==policyDigest||receipt.executionState!=='uncertain'||receipt.disposition!=='abandoned_by_user'||receipt.executionConfirmedStopped!==false||receipt.partialEffectsPossible!==true||!date(receipt.recordedAt))return null;
  if(!['id','policyDigest','subjectDigest','grantDigest','evidenceDigest','localArchiveDigest'].every(key=>hex(receipt[key]))||!text(receipt.grantId)||!exact(subject,subjectKeys)||subject.schemaVersion!==1||Object.entries(pins).some(([key,value])=>subject[key]!==value))return null;
  if(subject.actionId!==execution.id||subject.actionType!==execution.type||subject.originalError!==execution.error||execution.error!==originalError||!same(execution.result,originalResult)||subject.originalResultDigest!==originalResultDigest||subject.grantId!==receipt.grantId||subject.grantDigest!==receipt.grantDigest||!text(subject.credentialId))return null;
  if(subject.dedupeKey!==execution.dedupe_key||!text(subject.dedupeKey)||!['createdAt','ackedAt','completedAt'].every((key,index)=>date(subject[key])&&subject[key]===execution[['created_at','acked_at','completed_at'][index]])||Date.parse(subject.createdAt)>Date.parse(subject.ackedAt)||Date.parse(subject.ackedAt)>Date.parse(subject.completedAt))return null;
  if(!payload||payload.runtime!=='Hermes'||payload.employeeId!==subject.employeeId||payload.deviceId!==subject.deviceId||payload.profile!==subject.profile||bot?.employeeId!==subject.employeeId||bot.workspace!==subject.workspace||bot.deviceId!==subject.deviceId||bot.sourceProfile!==subject.profile||bot.revision!==subject.originalRevision||bot.controlEpoch!==subject.originalControlEpoch||!same(bot.instance,subject.profileBinding))return null;
  if(execution.workspace_id!==undefined&&execution.workspace_id!==subject.workspaceId||execution.workspace!==undefined&&execution.workspace!==subject.workspace)return null;
  if(subject.originalRevision!==3||subject.originalControlEpoch!==5||subject.currentRevision!==subject.originalRevision||subject.currentControlEpoch!==8||subject.currentControlState!=='paused'||subject.currentEmployeeStatus!=='paused'||receipt.resultingControlEpoch!==subject.currentControlEpoch+1)return null;
  if(!['profileBindingDigest','originalActionSha256','originalDeliveredPayloadDigest','originalResultDigest'].every(key=>hex(subject[key]))||!subject.profileBinding||subject.profileBinding.mode!=='owned_profile'||subject.profileBinding.profile!==subject.profile)return null;
  if(!exact(subject.failedEvent,['id','type','createdAt','dataSha256'])||subject.failedEvent.id!=='action-event_6c9a3e9aebb7d93cae4358455b7558c393d36d845877dade1ae62ea2d686e6b3'||subject.failedEvent.type!=='failed'||subject.failedEvent.dataSha256!=='bec062593118dae53cfea8df2b533e59e5e6542d68e7e7fef33c37903fb3d857'||!date(subject.failedEvent.createdAt)||Date.parse(subject.failedEvent.createdAt)<Date.parse(subject.ackedAt)||Date.parse(subject.failedEvent.createdAt)>Date.parse(subject.completedAt))return null;
  if(!exact(subject.holder,['pid','creationTime','nonce','root','configSha256','stateSha256'])||!Number.isSafeInteger(subject.holder.pid)||subject.holder.pid<=0||!date(subject.holder.creationTime)||!text(subject.holder.root)||!hex(subject.holder.configSha256)||!hex(subject.holder.stateSha256)||typeof subject.holder.nonce!=='string'||!/^[a-f0-9]{48}$/.test(subject.holder.nonce))return null;
  if(!exact(exit,['scope','stopped','pid','creationTime','exitedAt'])||exit.scope!=='daemon-root-only'||exit.stopped!==true||exit.pid!==subject.holder.pid||exit.creationTime!==subject.holder.creationTime||!date(exit.exitedAt)||Date.parse(exit.creationTime)>Date.parse(exit.exitedAt)||Date.parse(exit.exitedAt)>Date.parse(receipt.recordedAt)||Date.parse(exit.exitedAt)<Date.parse(subject.failedEvent.createdAt))return null;
  return receipt;
}

export const OPERATOR_FORCE_ABANDON_DETAIL='已强制放弃，原执行结果仍未知';
