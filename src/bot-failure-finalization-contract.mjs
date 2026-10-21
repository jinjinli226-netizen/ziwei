import {createHash} from 'node:crypto';

// A disposition ends admission bookkeeping; it is never an execution receipt.
export const FAILURE_FINALIZATION_KIND='bot.failed_execution_finalization';
export const canonicalFinalizationValue=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
export const finalizationDigest=value=>createHash('sha256').update(canonicalFinalizationValue(value)).digest('hex');
export const finalizationBytesDigest=value=>createHash('sha256').update(value).digest('hex');
const object=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const text=value=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\0\r\n]/.test(value);
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const integer=value=>Number.isSafeInteger(value)&&value>=1;
export function validateFailureFinalizationReceipt(receipt,expected={}){
  if(!exact(receipt,['schemaVersion','kind','id','subject','actorUserId','actorRole','expectedRevision','expectedControlEpoch','resultingControlEpoch','disposition','status','executionState','executionConfirmedStopped','partialEffectsPossible','recordedAt'])||receipt.schemaVersion!==1||receipt.kind!==FAILURE_FINALIZATION_KIND||!hex(receipt.id)||receipt.status!=='failed'||receipt.executionState!=='uncertain'||receipt.executionConfirmedStopped!==false||receipt.partialEffectsPossible!==true||!integer(receipt.expectedRevision)||!integer(receipt.expectedControlEpoch)||receipt.resultingControlEpoch!==receipt.expectedControlEpoch+1||!Number.isFinite(Date.parse(receipt.recordedAt)))return false;
  if(receipt.disposition==='abandoned_by_user'){if(!text(receipt.actorUserId)||!['owner','admin'].includes(receipt.actorRole))return false;}
  else if(receipt.disposition!=='failed_automatically'||receipt.actorUserId!==null||receipt.actorRole!=='system')return false;
  const subject=receipt.subject;
  if(!exact(subject,['actionId','actionType','workspace','workspaceId','deviceId','employeeId','profile','dedupeKey','originalRevision','originalControlEpoch','profileBindingDigest','originalPayloadDigest','originalResultDigest','originalActionSha256','failedEvent'])||!['actionId','actionType','workspace','workspaceId','deviceId','employeeId','profile'].every(key=>text(subject[key]))||subject.dedupeKey!==null&&!text(subject.dedupeKey)||!integer(subject.originalRevision)||!integer(subject.originalControlEpoch)||!['profileBindingDigest','originalPayloadDigest','originalResultDigest','originalActionSha256'].every(key=>hex(subject[key])))return false;
  if(subject.failedEvent!==null&&(!exact(subject.failedEvent,['id','dataSha256'])||!text(subject.failedEvent.id)||!hex(subject.failedEvent.dataSha256)))return false;
  for(const key of ['actionId','workspace','workspaceId','deviceId','employeeId','profile'])if(expected[key]!==undefined&&expected[key]!==subject[key])return false;
  const {id,...body}=receipt;
  return id===finalizationDigest(body);
}
export function validateFailureFinalizationAck(ack,receipt){
  return validateFailureFinalizationReceipt(receipt)&&exact(ack,['receiptId','receiptDigest','archiveSha256','localProcessDisposition'])&&ack.receiptId===receipt.id&&ack.receiptDigest===finalizationDigest(receipt)&&hex(ack.archiveSha256)&&['no_live_instance','terminated_exact_instance','unobservable'].includes(ack.localProcessDisposition);
}
