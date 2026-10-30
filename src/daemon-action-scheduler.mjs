import {DSH_NATIVE_TYPE,isDshNativeControlAction} from './dsh-native-contract.mjs';

/** Keep one worker slot available when several employees await collaborators.
 * concurrency is the ordinary work budget (default: two parents + one worker);
 * one precise control may additionally bypass it. concurrency=1 is strictly
 * sequential for ordinary work. One native DSH group coordinator has a separate
 * slot and no employee worker lock, so its own member can run at concurrency=1.
 * The spare worker covers ordinary direct children;
 * arbitrary nested waits still need coordination within this same budget.
 * Member and ordinary worker employee identities remain serialized.
 */
export const isCancellationAction=action=>['action.cancel','agent.cancel'].includes(String(action?.type||'').toLowerCase());
export function createActionScheduler({execute,concurrency=3,onError=()=>{},canStart=()=>true,quarantinedActionIds=()=>[]}={}) {
 if(typeof execute!=='function')throw new TypeError('Action scheduler requires an executor');
 if(!Number.isInteger(concurrency)||concurrency<1||concurrency>8)throw new TypeError('Action concurrency must be between 1 and 8');
 if(typeof onError!=='function'||typeof canStart!=='function'||typeof quarantinedActionIds!=='function')throw new TypeError('Action scheduler callbacks must be functions');
 const active=new Map(),activeActions=new Map(),employees=new Set(),parentLimit=Math.max(1,concurrency-1);let parents=0,controls=0,coordinators=0;
 const employeeKey=a=>String((a.type===DSH_NATIVE_TYPE?a.payload?.dshOperation?.subject?.employeeId:null)||a.payload?.employeeId||a.payload?.employee_id||a.payload?.assignee||a.id);
 const workspaceKey=a=>a.workspace_id||a.workspaceId||(a.type===DSH_NATIVE_TYPE?a.payload?.dshOperation?.subject?.workspaceId:null)||null;
 const deviceKey=a=>a.payload?.deviceId||a.payload?.device_id||a.payload?.targetDeviceId||a.payload?.target_device_id||null;
 const nativeGroupParent=a=>{const op=a.payload?.dshOperation;return a.type===DSH_NATIVE_TYPE&&op?.schemaVersion===1&&op.subject?.runtime==='DSH'&&op.resource==='groups'&&op.operation==='send'&&op.scope?.kind==='group'&&typeof op.scope.groupId==='string'&&op.scope.groupId===op.input?.groupId;};
 const potentialParent=a=>{const native=a.payload?.nativeOperation;return a.type==='conversation.execute'||a.payload?.employeeTemplateId==='ziwei-employee-creator'||a.type==='hermes.bot.native'&&(native?.resource==='groups'&&native.operation==='step'||native?.resource==='collaboration'&&native.input?.mode==='group');};
 const report=(error,a)=>{try{onError(error,a);}catch{}};
 const allowed=a=>{try{return canStart(a,{collaborationChild:collaborationChild(a)});}catch(error){report(error,a);return false;}};
 const nativeGroupChild=a=>{
  const c=a?.payload?.dshGroup,p=a?.payload;
  if(a?.type!=='conversation.execute'||p.runtime!=='DSH'||p.employeeTemplateId==='ziwei-employee-creator'||c?.schemaVersion!==1||typeof c.sourceActionId!=='string'||!c.sourceActionId||typeof c.memberProfile!=='string'||!c.memberProfile||c.memberProfile!==(p.profile||p.runtimeProfile||p.runtime_profile||p.dshBotName||p.botName))return false;
  const parent=activeActions.get(c.sourceActionId),workspace=workspaceKey(a),device=deviceKey(a);
  return Boolean(parent?.coordinator&&c.groupId===parent.groupId&&parent.memberProfiles.get(employeeKey(a))===c.memberProfile&&typeof workspace==='string'&&workspace&&workspace===parent.workspace&&typeof device==='string'&&device&&device===parent.device);
 };
 const collaborationChild=a=>{
  if(nativeGroupChild(a))return true;
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
   for(const a of pending)if(!isCancellationAction(a)&&!isDshNativeControlAction(a)&&!nativeGroupParent(a)&&!heads.has(employeeKey(a)))heads.set(employeeKey(a),a);
   // An admitted parent's actual children get the next free slot before
   // unrelated employees, never before their own earlier queued message.
   // Keep an admitted but capacity-blocked employee's head for this whole poll;
   // a denied new execution must not block a verified durable receipt retry.
   // No newer child may borrow the worker slot to overtake a pending parent.
   while(pending.length){
    const childIndex=pending.findIndex(a=>collaborationChild(a)&&heads.get(employeeKey(a))===a),a=pending.splice(childIndex<0?0:childIndex,1)[0];
    if(!a?.id)continue;
    const id=String(a.id),control=isCancellationAction(a)||isDshNativeControlAction(a),coordinator=!control&&nativeGroupParent(a),key=employeeKey(a);
    if(!control&&!coordinator&&heads.get(key)!==a)continue;
    if(active.has(id)||(control?controls>=1:coordinator?coordinators>=1:active.size-controls-coordinators>=concurrency))continue;
    const parent=!control&&!coordinator&&potentialParent(a)&&!collaborationChild(a);
    if(parent&&parents>=parentLimit)continue;
    if(!control&&!coordinator&&employees.has(key))continue;
    if(control)controls++;else if(coordinator)coordinators++;else employees.add(key);
    if(parent)parents++;
    const promise=Promise.resolve().then(()=>allowed(a)?execute(a):undefined).catch(error=>report(error,a)).finally(()=>{active.delete(id);activeActions.delete(id);if(control)controls--;else if(coordinator)coordinators--;else employees.delete(key);if(parent)parents--;});
    active.set(id,promise);activeActions.set(id,{parent,coordinator,...coordinator?{groupId:a.payload.dshOperation.scope.groupId,memberProfiles:new Map((a.payload.dshOperation.groupMembers||[]).map(member=>[member.employeeId,member.profile]))}:{},employee:key,workspace:workspaceKey(a),device:deviceKey(a)});started.push(a.id);
   }
   return started;
  },
  async whenIdle(){while(active.size)await Promise.allSettled([...active.values()]);},
 };
}
