/** Allow a manager to await child employees without blocking workstation polling.
 * Execution remains bounded and each employee's actions stay serialized.
 */
export const isCancellationAction=action=>['action.cancel','agent.cancel'].includes(String(action?.type||'').toLowerCase());
export function createActionScheduler({execute,concurrency=3,onError=()=>{},canStart=()=>true,quarantinedActionIds=()=>[]}={}) {
 if(typeof execute!=='function')throw new TypeError('Action scheduler requires an executor');
 if(!Number.isInteger(concurrency)||concurrency<1||concurrency>8)throw new TypeError('Action concurrency must be between 1 and 8');
 const active=new Map();const employees=new Set();let managers=0;let controls=0;
 const employeeKey=a=>String(a.payload?.employeeId || a.payload?.employee_id || a.payload?.assignee || a.id);
 return {
  get activeCount(){return new Set([...active.keys(),...quarantinedActionIds()]).size;},
  schedule(actions){
   const started=[];
   for(const a of Array.isArray(actions)?actions:[]){
    if(!canStart(a))continue;
    const control=isCancellationAction(a);
    if(!a?.id||active.has(a.id)||(control?controls>=1:active.size-controls>=concurrency))continue;
    const native=a.payload?.nativeOperation;
    const manager=!control&&(a.type==='conversation.execute'&&!a.payload?.collaboration?.sourceActionId||a.payload?.employeeTemplateId==='ziwei-employee-creator'||a.type==='hermes.bot.native'&&(native?.resource==='groups'&&native.operation==='step'||native?.resource==='collaboration'&&native.input?.mode==='group'));
    // Serialize conversations and known Creator parents, leaving capacity for
    // the child tasks they may await. Provenance is supplied by the server.
    if(manager&&managers>=1)continue;
    const key=employeeKey(a);if(!control&&employees.has(key))continue;
    if(control)controls++;else employees.add(key);
    if(manager)managers++;
    const promise=Promise.resolve().then(()=>canStart(a)?execute(a):undefined).catch(error=>{try{onError(error,a);}catch{}}).finally(()=>{active.delete(a.id);if(control)controls--;else employees.delete(key);if(manager)managers--;});
    active.set(a.id,promise);started.push(a.id);
   }
   return started;
  },
  async whenIdle(){while(active.size)await Promise.allSettled([...active.values()]);},
 };
}
