/** Maintenance does not complete, cancel or re-submit the user's action. The
 * dispatcher/delivery journals retain its original identity and native session.
 * Only the paired device's dedicated endpoints authorize the next execution. */
export function createClientMaintenanceResume({clientBuild,updates,post,delivery,onTerminal=()=>{},pid=process.pid}={}) {
  if(typeof updates!=='function'||typeof post!=='function'||typeof delivery!=='function')throw new TypeError('Maintenance resume requires trusted client closures');
  const route=(action,suffix)=>`/a2a/v1/actions/${encodeURIComponent(action.id)}/${suffix}`;
  return {
    async commit(action,receipt) {
      const authority=updates()?.checkpointAuthority(receipt);
      if(!authority)return false;
      // Fence only after all original-generation progress has reached the
      // server. A transient event upload failure keeps this retryable pause.
      if((await delivery().flushActionEvents(action.id)).pending!==0)return false;
      const attempt=delivery()?.maintenanceAttempt?.(action.id);
      const response=await post(route(action,'maintenance-checkpoint'),{...authority,receipt,...(attempt?{maintenanceAttempt:attempt}:{})});
      if(response?.terminal===true&&response.actionId===action.id&&['failed','succeeded','expired'].includes(response.status)){
        await onTerminal(action,response.status,response.reasonCode);
      }
      return response?.committed===true;
    },
    async authorize(action,receipt) {
      const ready=await updates()?.maintenanceResumeReadiness(receipt);
      if(ready?.ready!==true)return false;
      const response=await post(route(action,'authorize-maintenance-resume'),{
        updateId:receipt.updateId,checkpointDigest:receipt.checkpointDigest,clientBuild,
        ...(ready.sourceIdle?{sourceIdle:{...ready.sourceIdle,pid}}:{}),
        ...(ready.maintenanceFailure?{maintenanceFailure:{...ready.maintenanceFailure,pid}}:{}),
      });
      if(response?.terminal===true&&response.actionId===action.id&&['failed','succeeded','expired'].includes(response.status)){
        await onTerminal(action,response.status,response.reasonCode);return false;
      }
      if(ready.maintenanceFailure)return false;
      const permit=response?.maintenanceAttempt;
      if(response?.allowed!==true||!permit||!Number.isSafeInteger(permit.generation)||permit.generation<1||typeof permit.token!=='string'||permit.token.length<16)return false;
      // Durable before the dispatcher marks the resume-launch window. An old
      // outbox keeps its original event generation; it is never relabeled here.
      delivery().setMaintenanceAttempt(action.id,permit);
      return true;
    },
  };
}
