import crypto from 'node:crypto';

const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);for(const item of Object.values(value))freeze(item);}return value;};
export const canonicalForceAbandonValue=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
export const forceAbandonDigest=value=>crypto.createHash('sha256').update(canonicalForceAbandonValue(value)).digest('hex');
export const forceAbandonBytesDigest=value=>crypto.createHash('sha256').update(value).digest('hex');
export const forceAbandonExactKeys=(value,keys)=>Boolean(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key)));
export const forceAbandonHex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export const BOT_FORCE_ABANDON_KIND='bot.operator_force_abandon';
export const BOT_FORCE_ABANDON_TTL_MS=120_000;
export const BOT_FORCE_ABANDON_POLICY=freeze({
  schemaVersion:1,id:'zhiwei-operator-force-abandon-v1',holderBuild:'c477b6bb9044ae181d97efaae9ee3188a985cc32805f5a8eedfe3df09660e341',
  subject:{actionId:'action_2805b4da-c082-49a2-b0f1-b43bdeb107fe',workspace:'bigtron',workspaceId:'ws_52fa81da-ddeb-439a-9a74-ab4df4b2636e',deviceId:'device_bfd9a3d2-c2cc-4a36-8bd8-465bea492493',employeeId:'employee_5f157a51-a8fa-483c-90df-53d44292b5d2',profile:'bot-e1bf33c85b1543b18ecd3d6a',originalRevision:3,originalControlEpoch:5,currentRevision:3,currentControlEpoch:8,originalPayloadSha256:'e09ffebdb7d2e775fc3a3712159d2076c26319977b8596f05f22c816c6848448',originalResultSha256:'cd625b824e89339e813ee4c8f9b43e9101076b6af6585d4ed48ab5270f6a372f',failedEventId:'action-event_6c9a3e9aebb7d93cae4358455b7558c393d36d845877dade1ae62ea2d686e6b3',failedEventDataSha256:'bec062593118dae53cfea8df2b533e59e5e6542d68e7e7fef33c37903fb3d857'},
  originalError:'执行状态无法安全确认，需人工核实后处理：Bot 配置或控制状态已变化，请重新读取',
  originalResult:{processExit:null,partialEffectsPossible:true,code:'EXECUTION_UNCERTAIN',executionState:'uncertain',reason:'EXECUTOR_WITHOUT_EXIT_EVIDENCE'},
});
export const BOT_FORCE_ABANDON_POLICY_DIGEST=forceAbandonDigest(BOT_FORCE_ABANDON_POLICY);
const exact=forceAbandonExactKeys,hex=forceAbandonHex,digest=forceAbandonDigest;
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const text=(value,max=200)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\0\r\n]/.test(value);
const same=(a,b)=>canonicalForceAbandonValue(a)===canonicalForceAbandonValue(b);
export function validateForceAbandonHolder(holder){
  return exact(holder,['pid','creationTime','nonce','root','configSha256','stateSha256'])&&Number.isSafeInteger(holder.pid)&&holder.pid>0&&date(holder.creationTime)&&typeof holder.nonce==='string'&&/^[a-f0-9]{48}$/.test(holder.nonce)&&text(holder.root,500)&&hex(holder.configSha256)&&hex(holder.stateSha256);
}
export function forceAbandonSubjectAllowed(s){
  const pins={...s,failedEventId:s?.failedEvent?.id,failedEventDataSha256:s?.failedEvent?.dataSha256};
  return Boolean(exact(s,['schemaVersion','actionId','actionType','workspace','workspaceId','deviceId','employeeId','credentialId','profile','profileBinding','profileBindingDigest','dedupeKey','createdAt','ackedAt','completedAt','originalRevision','originalControlEpoch','currentRevision','currentControlEpoch','currentControlState','currentEmployeeStatus','originalActionSha256','originalPayloadSha256','originalDeliveredPayloadDigest','originalResultSha256','originalResultDigest','originalError','failedEvent','grantId','grantDigest','holderBuild','holder'])&&Object.entries(BOT_FORCE_ABANDON_POLICY.subject).every(([key,value])=>pins[key]===value)&&s.schemaVersion===1&&s.actionType==='conversation.execute'&&s.currentControlState==='paused'&&s.currentEmployeeStatus==='paused'&&s.holderBuild===BOT_FORCE_ABANDON_POLICY.holderBuild&&s.originalError===BOT_FORCE_ABANDON_POLICY.originalError&&s.originalResultDigest===digest(BOT_FORCE_ABANDON_POLICY.originalResult)&&validateForceAbandonHolder(s.holder)&&hex(s.originalActionSha256)&&hex(s.originalDeliveredPayloadDigest)&&hex(s.profileBindingDigest)&&digest(s.profileBinding)===s.profileBindingDigest&&hex(s.grantDigest)&&text(s.grantId)&&text(s.credentialId)&&text(s.dedupeKey)&&date(s.createdAt)&&date(s.ackedAt)&&date(s.completedAt)&&Date.parse(s.createdAt)<=Date.parse(s.ackedAt)&&Date.parse(s.ackedAt)<=Date.parse(s.completedAt)&&exact(s.failedEvent,['id','type','createdAt','dataSha256'])&&s.failedEvent.type==='failed'&&date(s.failedEvent.createdAt)&&Date.parse(s.failedEvent.createdAt)>=Date.parse(s.ackedAt)&&Date.parse(s.failedEvent.createdAt)<=Date.parse(s.completedAt));
}
export function validateForceAbandonEvidence(e,s,{recordedAt=Date.now()}={}){
  const deadline=typeof recordedAt==='number'?recordedAt:Date.parse(recordedAt),exit=e?.currentDaemonExit,a=e?.localArchive,m=a?.manifest;
  if(!forceAbandonSubjectAllowed(s)||!Number.isFinite(deadline)||!exact(e,['schemaVersion','policy','policyDigest','subjectDigest','currentDaemonExit','localArchive','quarantineCount'])||e.schemaVersion!==1||e.policy!==BOT_FORCE_ABANDON_POLICY.id||e.policyDigest!==BOT_FORCE_ABANDON_POLICY_DIGEST||e.subjectDigest!==digest(s)||e.quarantineCount!==1)return false;
  if(!exact(exit,['scope','stopped','pid','creationTime','exitedAt'])||exit.scope!=='daemon-root-only'||exit.stopped!==true||exit.pid!==s.holder.pid||exit.creationTime!==s.holder.creationTime||!date(exit.exitedAt)||Date.parse(exit.exitedAt)<Date.parse(exit.creationTime)||Date.parse(exit.exitedAt)<Date.parse(s.failedEvent.createdAt)||Date.parse(exit.exitedAt)>deadline)return false;
  if(!exact(a,['actionId','dedupeKey','stateSha256','startedSha256','deliverySha256','actionSha256','resultSha256','manifest','archiveManifestSha256'])||a.actionId!==s.actionId||a.dedupeKey!==s.dedupeKey||a.stateSha256!==s.holder.stateSha256||!hex(a.startedSha256)||!hex(a.archiveManifestSha256)||!['deliverySha256','actionSha256','resultSha256'].every(key=>a[key]===null||hex(a[key])))return false;
  if(!exact(m,['schemaVersion','actionId','files'])||m.schemaVersion!==1||m.actionId!==s.actionId||!Array.isArray(m.files)||m.files.length!==4||digest(m)!==a.archiveManifestSha256)return false;
  const roles=['action-state','delivery-journal','delivery-action','delivery-result'],hashes=[a.stateSha256,a.deliverySha256,a.actionSha256,a.resultSha256];
  return m.files.every((file,index)=>exact(file,['role','sha256','bytes'])&&file.role===roles[index]&&file.sha256===hashes[index]&&(file.sha256===null?file.bytes===null:Number.isSafeInteger(file.bytes)&&file.bytes>0));
}
export function validateForceAbandonReceipt(r,{actionId,subject,evidenceDigest}={}){
  if(!exact(r,['schemaVersion','kind','id','policy','policyDigest','subject','subjectDigest','grantId','grantDigest','evidenceDigest','localArchiveDigest','currentDaemonExit','resultingControlEpoch','executionState','disposition','executionConfirmedStopped','partialEffectsPossible','recordedAt'])||r.schemaVersion!==1||r.kind!==BOT_FORCE_ABANDON_KIND||r.policy!==BOT_FORCE_ABANDON_POLICY.id||r.policyDigest!==BOT_FORCE_ABANDON_POLICY_DIGEST||!forceAbandonSubjectAllowed(r.subject)||r.subjectDigest!==digest(r.subject)||r.grantId!==r.subject.grantId||r.grantDigest!==r.subject.grantDigest||!hex(r.evidenceDigest)||!hex(r.localArchiveDigest)||r.id!==digest({actionId:r.subject.actionId,subjectDigest:r.subjectDigest,evidenceDigest:r.evidenceDigest})||r.resultingControlEpoch!==r.subject.currentControlEpoch+1||r.executionState!=='uncertain'||r.disposition!=='abandoned_by_user'||r.executionConfirmedStopped!==false||r.partialEffectsPossible!==true||!date(r.recordedAt))return false;
  const exit=r.currentDaemonExit;
  return Boolean(exact(exit,['scope','stopped','pid','creationTime','exitedAt'])&&exit.scope==='daemon-root-only'&&exit.stopped===true&&exit.pid===r.subject.holder.pid&&exit.creationTime===r.subject.holder.creationTime&&date(exit.exitedAt)&&Date.parse(exit.exitedAt)>=Date.parse(exit.creationTime)&&Date.parse(exit.exitedAt)>=Date.parse(r.subject.failedEvent.createdAt)&&Date.parse(exit.exitedAt)<=Date.parse(r.recordedAt)&&(!actionId||actionId===r.subject.actionId)&&(!subject||same(subject,r.subject))&&(!evidenceDigest||evidenceDigest===r.evidenceDigest));
}
