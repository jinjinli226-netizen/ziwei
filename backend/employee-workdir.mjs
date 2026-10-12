import path from 'node:path';

const fail=(message,code,status=400)=>{throw Object.assign(new Error(message),{code,status});};
const valueAt=(input,keys)=>{for(const key of keys) if(Object.hasOwn(input,key)) return {supplied:true,value:input[key]};return {supplied:false};};
export const defaultWorkdirInput=input=>valueAt(input,['defaultWorkingDirectory','default_working_directory']);
const receiptInput=input=>valueAt(input,['defaultWorkingDirectoryActionId','default_working_directory_action_id']);
const cleanPath=(value,code='DEFAULT_WORKDIR_INVALID')=>{
  if(typeof value!=='string' || !value.trim() || value.length>4096 || /[\u0000-\u001f\u007f]/.test(value)) fail('默认工作目录必须是有效的非空路径，最长4096字符。',code);
  return value.trim();
};
const absoluteLocalPath=value=>/^[A-Za-z]:[\\/]/.test(value) || (path.posix.isAbsolute(value) && !value.startsWith('//') && !value.startsWith('/\\'));

// Receipt acceptance is deliberately shorter than an execution lease. Its
// expires_at is a dispatch deadline, not the age of filesystem evidence.
export const DEFAULT_WORKDIR_RECEIPT_MAX_AGE_MS=10*60*1000;
export function resolveEmployeeDefaultWorkdir(db,workspace,targetDeviceId,input={},previous=null,context={}) {
  const requested=defaultWorkdirInput(input),receipt=receiptInput(input);
  const oldPath=previous?.default_working_directory || null,oldDevice=previous?.default_working_directory_device_id || null;
  if(context.deviceScope && targetDeviceId && context.deviceScope!==targetDeviceId) fail('目标电脑不在当前管理身份的设备范围内。','DEVICE_SCOPE_MISMATCH',403);
  if(requested.supplied && requested.value===null) return {default_working_directory:null,default_working_directory_device_id:null};
  if(!requested.supplied) {
    if(oldPath && oldDevice!==targetDeviceId) fail('更换电脑后请重新检查默认目录，或明确清空默认目录。','DEFAULT_WORKDIR_REVALIDATION_REQUIRED',409);
    return {default_working_directory:oldPath,default_working_directory_device_id:oldDevice};
  }
  const directory=cleanPath(requested.value);
  if(oldPath===directory && oldDevice===targetDeviceId && !receipt.supplied) return {default_working_directory:oldPath,default_working_directory_device_id:oldDevice};
  if(!targetDeviceId) fail('保存默认工作目录必须选择目标电脑。','DEFAULT_WORKDIR_DEVICE_REQUIRED');
  if(oldPath && oldDevice!==targetDeviceId && !receipt.value) fail('更换电脑后请重新检查默认目录，或明确清空默认目录。','DEFAULT_WORKDIR_REVALIDATION_REQUIRED',409);
  const device=db.prepare('SELECT * FROM devices WHERE id=? AND workspace_id=?').get(targetDeviceId,workspace.id);
  if(!device) fail('目标设备不属于当前工作区。','DEFAULT_WORKDIR_DEVICE_FORBIDDEN',403);
  if(device.status==='disabled') fail('目标设备已停用。','DEFAULT_WORKDIR_DEVICE_FORBIDDEN',403);
  const teamMember=workspace.kind==='team' && context.actorUserId ? Boolean(db.prepare('SELECT 1 FROM members WHERE workspace_id=? AND user_id=?').get(workspace.id,context.actorUserId)) : false;
  const pairedComputer=context.deviceCredentialDeviceId===targetDeviceId && context.deviceScope===targetDeviceId;
  if(!['owner','admin'].includes(String(context.actorRole || '').toLowerCase()) && !teamMember && !pairedComputer && !(context.actorUserId && device.owner_user_id===context.actorUserId)) fail('当前用户无权保存该设备的默认目录。','DEFAULT_WORKDIR_DEVICE_FORBIDDEN',403);
  const row=typeof receipt.value==='string' ? db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(receipt.value) : null;
  let payload,result;try {payload=JSON.parse(row?.payload_json || '{}');result=JSON.parse(row?.result_json || '{}');} catch {}
  const completedAt=Date.parse(row?.completed_at || ''),age=Date.now()-completedAt;
  if(!row || row.workspace_id!==workspace.id || row.type!=='directory.inspect' || row.status!=='succeeded' || !Number.isFinite(age) || age<0 || age>DEFAULT_WORKDIR_RECEIPT_MAX_AGE_MS ||
      payload?.deviceId!==targetDeviceId || (payload?.userId || null)!==(context.actorUserId || null) || result?.exists!==true || result?.isDirectory!==true) {
    fail('默认目录缺少当前身份与电脑的有效检查回执，请重新检查。','DEFAULT_WORKDIR_RECEIPT_INVALID');
  }
  const canonical=cleanPath(result.path,'DEFAULT_WORKDIR_RECEIPT_INVALID');
  if(!absoluteLocalPath(canonical) || (directory!==String(payload.path || '').trim() && directory!==canonical)) fail('检查回执与当前目录不匹配，请重新检查。','DEFAULT_WORKDIR_RECEIPT_INVALID');
  return {default_working_directory:canonical,default_working_directory_device_id:targetDeviceId};
}
