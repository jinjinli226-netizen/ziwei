/** Keep one worker slot available when several employees await collaborators.
 * concurrency is the total non-control budget (default: two parents + one
 * worker); one cancellation may additionally bypass it. concurrency=1 is strictly
 * sequential and has no spare child capacity. Local parent/child cooperation
 * therefore requires concurrency>=2. The spare worker covers direct children;
 * arbitrary nested waits still need coordination within this same budget.
 * Employee identity is always serialized.
 */
export const isCancellationAction=action=>['action.cancel','agent.cancel'].includes(String(action?.type||'').toLowerCase());
export function createActionScheduler({execute,concurrency=3,onError=()=>{},canStart=()=>true,quarantinedActionIds=()=>[]}={}) {
 if(typeof execute!=='function')throw new TypeError('Action scheduler requires an executor');
 if(!Number.isInteger(concurrency)||concurrency<1||concurrency>8)throw new TypeError('Action concurrency must be between 1 and 8');
 if(typeof onError!=='function'||typeof canStart!=='function'||typeof quarantinedActionIds!=='function')throw new TypeError('Action scheduler callbacks must be functions');
 const active=new Map(),activeActions=new Map(),employees=new Set(),parentLimit=Math.max(1,concurrency-1);let parents=0,controls=0;
 const employeeKey=a=>String(a.payload?.employeeId || a.payload?.employee_id || a.payload?.assignee || a.id);
 const workspaceKey=a=>a.workspace_id||a.workspaceId||null;
 const deviceKey=a=>a.payload?.deviceId||a.payload?.device_id||a.payload?.targetDeviceId||a.payload?.target_device_id||null;
 const potentialParent=a=>{const native=a.payload?.nativeOperation;return a.type==='conversation.execute'||a.payload?.employeeTemplateId==='ziwei-employee-creator'||a.type==='hermes.bot.native'&&(native?.resource==='groups'&&native.operation==='step'||native?.resource==='collaboration'&&native.input?.mode==='group');};
 const report=(error,a)=>{try{onError(error,a);}catch{}};
 const allowed=a=>{try{return canStart(a,{collaborationChild:collaborationChild(a)});}catch(error){report(error,a);return false;}};
 const collaborationChild=a=>{
  const c=a?.payload?.collaboration;if(a?.type!=='conversation.execute'||a.payload?.employeeTemplateId==='ziwei-employee-creator'||!c||typeof c.sourceActionId!=='string'||typeof c.sourceEmployeeId!=='string'||!['message','delegate','group'].includes(c.mode)||typeof c.messageId!=='string'||!c.messageId||typeof c.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(c.fingerprint))return false;
  const parent=activeActions.get(c.sourceActionId),workspace=workspaceKey(a),device=deviceKey(a);
  // The authenticated server supplies these fields. A source tag by itself
  // must not turn an unrelated conversation into a reserved-capacity child.
  return Boolean(parent?.parent&&parent.employee===c.sourceEmployeeId&&parent.employee!==employeeKey(a)&&typeof workspace==='string'&&workspace&&workspace===parent.workspace&&(!(parent.device||device)||parent.device===device));
 };
 return {
  get activeCount(){return new Set([...active.keys(),...quarantinedActionIds()]).size;},
  schedule(actions){
   const started=[],pending=Array.isArray(actions)?actions.filter(a=>a?.id&&allowed(a)):[],heads=new Map();
   for(const a of pending)if(!isCancellationAction(a)&&!heads.has(employeeKey(a)))heads.set(employeeKey(a),a);
   // An admitted parent's actual children get the next free slot before
   // unrelated employees, never before their own earlier queued message.
   // Keep an admitted but capacity-blocked employee's head for this whole poll;
   // a denied new execution must not block a verified durable receipt retry.
   // No newer child may borrow the worker slot to overtake a pending parent.
   while(pending.length){
    const childIndex=pending.findIndex(a=>collaborationChild(a)&&heads.get(employeeKey(a))===a),a=pending.splice(childIndex<0?0:childIndex,1)[0];
    if(!a?.id)continue;
    const id=String(a.id),control=isCancellationAction(a),key=employeeKey(a);
    if(!control&&heads.get(key)!==a)continue;
    if(active.has(id)||(control?controls>=1:active.size-controls>=concurrency))continue;
    const parent=!control&&potentialParent(a)&&!collaborationChild(a);
    if(parent&&parents>=parentLimit)continue;
    if(!control&&employees.has(key))continue;
    if(control)controls++;else employees.add(key);
    if(parent)parents++;
    const promise=Promise.resolve().then(()=>allowed(a)?execute(a):undefined).catch(error=>report(error,a)).finally(()=>{active.delete(id);activeActions.delete(id);if(control)controls--;else employees.delete(key);if(parent)parents--;});
    active.set(id,promise);activeActions.set(id,{parent,employee:key,workspace:workspaceKey(a),device:deviceKey(a)});started.push(a.id);
   }
   return started;
  },
  async whenIdle(){while(active.size)await Promise.allSettled([...active.values()]);},
 };
}
