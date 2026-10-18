import {createHash} from 'node:crypto';

// Only the dispatcher's pre-dispatch control flow mints this capability.
// Executor values, payload flags and serialised Error fields cannot mint it.
const rejected = new WeakMap();
const phases = new Set(['authorization','expiry','workdir','budget','lease']);
const exact = (value,keys) => Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key)));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const validIdentity = value => Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => ['workspace','deviceId','workspaceId','actionWorkspace','targetDeviceId'].includes(key) && typeof value[key] === 'string'));

export function markDispatcherAdmissionRejected(result,{key,identity,phase}={}) {
  if (!result || typeof result !== 'object' || !phases.has(phase) || typeof key !== 'string' || !key || !validIdentity(identity)) throw new TypeError('Invalid dispatcher admission rejection');
  const proof = Object.freeze({schemaVersion:1,kind:'dispatcher.admission_rejected',executionState:'not_dispatched',executorInvoked:false,phase,key,actionId:result.actionId,identity:Object.freeze({...identity}),completedAt:result.completedAt,resultDigest:digest(result)});
  const completed = {key,identity,result,admissionRejected:proof};
  if (!isDispatcherAdmissionRejected({completed,identity,started:[]})) throw new TypeError('Invalid dispatcher admission rejection result');
  rejected.set(result,proof);
  return result;
}

export function consumeDispatcherAdmissionRejected(result) {
  const proof = rejected.get(result);
  if (proof) rejected.delete(result);
  return proof || null;
}

// A narrowly typed local history record, never a process-exit or formal
// preservation proof. Ordinary orphaned completions are not reinterpreted.
export function isDispatcherAdmissionRejected({completed,identity,started}={}) {
  const proof = completed?.admissionRejected, result = completed?.result;
  if (!exact(completed,['key','identity','result','admissionRejected']) || !exact(proof,['schemaVersion','kind','executionState','executorInvoked','phase','key','actionId','identity','completedAt','resultDigest']) || !exact(result,['status','actionId','error','completedAt','code','executionState','admissionRejected','result']) || !exact(result.result,['admissionRejected','executionState'])) return false;
  if (proof.schemaVersion !== 1 || proof.kind !== 'dispatcher.admission_rejected' || proof.executionState !== 'not_dispatched' || proof.executorInvoked !== false || !phases.has(proof.phase) || result.status !== 'failed' || result.executionState !== 'not_dispatched' || result.admissionRejected !== true || result.result.admissionRejected !== true || result.result.executionState !== 'not_dispatched' || typeof result.error !== 'string' || !/^[A-Z][A-Z0-9_]{0,99}$/.test(result.code || '')) return false;
  if (typeof completed.key !== 'string' || !completed.key || typeof result.actionId !== 'string' || !result.actionId || completed.key !== proof.key || result.actionId !== proof.actionId || !Number.isFinite(result.completedAt) || result.completedAt < 0 || result.completedAt !== proof.completedAt || !/^[a-f0-9]{64}$/.test(proof.resultDigest || '') || digest(result) !== proof.resultDigest) return false;
  if (!validIdentity(completed.identity) || !validIdentity(proof.identity) || digest(completed.identity) !== digest(proof.identity) || (completed.identity.workspace ?? '') !== (identity?.workspace ?? '') || (completed.identity.deviceId ?? '') !== (identity?.deviceId ?? '') || identity?.deviceId && completed.identity.targetDeviceId !== undefined && completed.identity.targetDeviceId !== identity.deviceId || identity?.workspace && completed.identity.actionWorkspace !== undefined && completed.identity.actionWorkspace !== identity.workspace) return false;
  return Array.isArray(started) && !started.some(row => row?.key === completed.key || row?.actionId === result.actionId);
}
