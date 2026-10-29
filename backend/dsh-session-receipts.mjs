import {matchesDshSessionBinding,sameDshSessionBinding,confirmedDshSessionExit,isDshAction} from '../src/dsh-session-receipt.mjs';

const parse=value=>{try{return JSON.parse(value);}catch{return {};}};
const action=row=>({id:row.id,payload:parse(row.payload_json)});
const fail=(code,message)=>{throw Object.assign(new Error(message),{code,status:409});};
export const recoverableDshCompletion=row=>Boolean(row?.acked_at&&isDshAction(action(row))&&(row.status==='expired'||row.status==='failed'&&(parse(row.result_json).code==='EXECUTION_UNCERTAIN'||parse(row.result_json).executionState==='uncertain')));
export function createDshSessionReceipts(db){
 const lookup=db.prepare('SELECT session_id FROM conversation_dsh_sessions WHERE conversation_id=? AND workspace_id=? AND employee_id=? AND device_id=? AND bot_name=?');
 const scopedDevice=(row,deviceId)=>{
  const p=parse(row.payload_json),target=p.deviceId||p.device_id||p.targetDeviceId||p.target_device_id;
  if(!row.acked_at||!deviceId||deviceId!==target)fail('DSH_SESSION_DEVICE_MISMATCH','DSH 原生回执必须来自原已领取动作的同一设备');
  return p;
 };
 const boundConversation=(row,p)=>(!p.employeeId||Boolean(db.prepare('SELECT 1 FROM employees WHERE id=? AND workspace_id=?').get(p.employeeId,row.workspace_id)))&&(!p.conversationId||Boolean(p.employeeId&&db.prepare('SELECT 1 FROM conversations WHERE id=? AND workspace_id=? AND employee_id=?').get(p.conversationId,row.workspace_id,p.employeeId)));
 const view=(conversation,employee)=>{
  if(String(employee?.runtime||'').toLowerCase()!=='dsh')return{};
  const found=lookup.get(conversation.id,conversation.workspace_id,employee.id,conversation.device_id||employee.target_device_id||null,employee.runtime_profile||null);
  return found?{runtime_session_id:found.session_id,runtime_session_runtime:'DSH'}:{};
 };
 return{
  view,
  session({conversationId,workspaceId,employeeId,deviceId,profile}){return employeeId&&deviceId&&profile?lookup.get(conversationId,workspaceId,employeeId,deviceId,profile)?.session_id||null:null;},
  register(row,binding,deviceId){
   const p=scopedDevice(row,deviceId),current=action(row);
   if(!matchesDshSessionBinding(current,binding)||!boundConversation(row,p))fail('DSH_SESSION_BINDING_CONFLICT','DSH 原生会话登记与原动作的员工、会话或 Bot 绑定不一致');
   if(p.dshSessionBinding&&!sameDshSessionBinding(p.dshSessionBinding,binding))fail('DSH_SESSION_BINDING_CONFLICT','DSH 原动作已登记另一组原生 request/session，禁止覆盖');
   db.prepare('UPDATE a2a_actions SET payload_json=? WHERE id=?').run(JSON.stringify({...p,dshSessionBinding:binding}),row.id);
   if(p.conversationId)db.prepare(`INSERT INTO conversation_dsh_sessions(conversation_id,workspace_id,employee_id,device_id,bot_name,session_id,updated_at) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(conversation_id,employee_id,device_id,bot_name) DO UPDATE SET session_id=excluded.session_id,updated_at=excluded.updated_at`).run(p.conversationId,row.workspace_id,p.employeeId,deviceId,binding.botName,binding.sessionId,new Date().toISOString());
  },
  assertReceipt(row,input){
   const p=scopedDevice(row,input.deviceId);
   const receipt=boundConversation(row,p)&&confirmedDshSessionExit(action(row),input);
   if(!receipt)fail('DSH_SESSION_RECEIPT_REQUIRED','DSH 终态缺少与原已登记 request/session 一致的原生 turn/end 回执');
   return receipt;
  },
  confirmed(row,input){return confirmedDshSessionExit(action(row),input);},
  recoverable:recoverableDshCompletion,
 };
}
