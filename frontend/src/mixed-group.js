import {conversationStreamMessages} from './conversation-stream.js';
export const MIXED_GROUP_RUNTIMES = ['Hermes', 'DSH', 'Codex'];

export function mixedGroupMessages(group){
 const messages=group?.messages||[];
 const previews=(group?.runs||[]).flatMap(run=>{
  if(messages.some(message=>message.actionId===run.actionId))return [];
  return conversationStreamMessages([],{...run,id:run.actionId}).map(message=>({...message,text:message.content,employeeId:run.employeeId,runtime:run.runtime,status:run.status}));
 });
 return [...messages,...previews];
}

export function mixedGroupMemberDescriptor(employee) {
  if (!employee?.id || !MIXED_GROUP_RUNTIMES.includes(employee.runtime)) throw new Error('请选择 Hermes、DSH 或 Codex 员工');
  const profile = employee.runtime_profile || employee.profile;
  const conversationId = employee.main_conversation_id || employee.conversationId;
  if (!profile || !employee.target_device_id || !conversationId) throw new Error(`${employee.name || employee.id} 缺少 Profile、设备或专属会话绑定`);
  return {employeeId: employee.id, name: employee.name || employee.id, runtime: employee.runtime, profile, deviceId: employee.target_device_id, conversationId};
}

export function mixedGroupStatus(group) {
  const runs = Array.isArray(group?.runs) ? group.runs : [];
  if (!runs.length) return 'planned';
  if (runs.some(run => run.status === 'unknown' || run.status === 'expired')) return 'unknown';
  if (runs.some(run => ['pending','acked','running'].includes(run.status))) return runs.some(run => ['succeeded','failed','cancelled'].includes(run.status)) ? 'partial' : 'running';
  if (runs.every(run => run.status === 'succeeded')) return 'succeeded';
  if (runs.every(run => run.status === 'cancelled')) return 'cancelled';
  if (runs.some(run => run.status === 'succeeded') && runs.some(run => run.status === 'failed')) return 'partial';
  return 'failed';
}
