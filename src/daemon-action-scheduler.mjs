/** Allow a manager to await child employees without blocking workstation polling.
 * Execution remains bounded and each employee's actions stay serialized.
 */
export function createActionScheduler({execute,concurrency=3,onError=()=>{}}={}) {
 if(typeof execute!=='function')throw new TypeError('Action scheduler requires an executor');
 if(!Number.isInteger(concurrency)||concurrency<1||concurrency>8)throw new TypeError('Action concurrency must be between 1 and 8');
 const active=new Map();const employees=new Set();let managers=0;
 const employeeKey=a=>String(a.payload?.employeeId || a.payload?.employee_id || a.payload?.assignee || a.id);
 return {
  get activeCount(){return active.size;},
  schedule(actions){
   const started=[];
   for(const a of Array.isArray(actions)?actions:[]){
    if(!a?.id||active.has(a.id)||active.size>=concurrency)continue;
    const manager=a.type==='conversation.execute'||a.payload?.employeeTemplateId==='ziwei-employee-creator';
    // Serialize conversations and known Creator parents, leaving capacity for
    // the child tasks they may await. Provenance is supplied by the server.
    if(manager&&managers>=1)continue;
    const key=employeeKey(a);if(employees.has(key))continue;
    employees.add(key);
    if(manager)managers++;
    const promise=Promise.resolve().then(()=>execute(a)).catch(error=>{try{onError(error,a);}catch{}}).finally(()=>{active.delete(a.id);employees.delete(key);if(manager)managers--;});
    active.set(a.id,promise);started.push(a.id);
   }
   return started;
  },
  async whenIdle(){while(active.size)await Promise.allSettled([...active.values()]);},
 };
}
