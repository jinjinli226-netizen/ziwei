import {isDshAction,confirmedDshSessionExit,confirmedDshPrePromptFailure} from '../src/dsh-session-receipt.mjs';

const removedCode='CONVERSATION_QUEUE_REMOVED';
// Queued conversation input is durable user intent, but it must not occupy a
// Bot slot forever when the assigned client stays offline. Once this bounded
// wait expires we retain the message/action evidence and finish the queue item
// as a known local timeout; an acknowledged action keeps its normal execution
// lease and is never rewritten here.
export const CONVERSATION_QUEUE_TTL_MS = 24 * 60 * 60 * 1000;
const fail=(code,message,status=409)=>{throw Object.assign(new Error(message),{code,status});};
const parse=value=>{try{return JSON.parse(value);}catch{return {};}};
const payload=row=>parse(row.payload_json);
const runtimeBinding=({controlEpoch,name,description,conversationId,...binding})=>JSON.stringify(binding,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);

// Actions remain the only durable work queue. This table controls admission;
// no second dispatcher or copy of the user message is created here.
export function createConversationQueue(db){
 const rows=db.prepare(`SELECT a.*,a.rowid AS action_rowid FROM a2a_actions a
  WHERE a.type='conversation.execute' AND a.status IN ('pending','acked') AND json_valid(a.payload_json)
   AND a.workspace_id=(SELECT workspace_id FROM conversations WHERE id=json_extract(a.payload_json,'$.conversationId'))
   AND json_extract(a.payload_json,'$.employeeId') IS (SELECT employee_id FROM conversations WHERE id=json_extract(a.payload_json,'$.conversationId'))
   AND EXISTS(SELECT 1 FROM conversation_messages m WHERE m.id=json_extract(a.payload_json,'$.messageId') AND m.conversation_id=json_extract(a.payload_json,'$.conversationId') AND m.role='user')
   AND json_extract(a.payload_json,'$.conversationId')=? AND json_extract(a.payload_json,'$.messageId') IS NOT NULL
  ORDER BY a.created_at,a.rowid`);
 const state=db.prepare('SELECT paused FROM conversation_queue_controls WHERE conversation_id=?');
 const binding=db.prepare("SELECT 1 FROM conversations c JOIN conversation_messages m ON m.conversation_id=c.id WHERE c.id=? AND c.workspace_id=? AND c.employee_id IS ? AND m.id=? AND m.role='user'");
 const controlled=row=>{if(row?.type!=='conversation.execute')return false;const data=payload(row);return Boolean(data.conversationId&&data.messageId&&binding.get(data.conversationId,row.workspace_id,data.employeeId??null,data.messageId));};
 const paused=conversationId=>Boolean(state.get(conversationId)?.paused);
 const expirePending=(conversationId=null)=>{
  const timestamp=new Date().toISOString();
  const rows=db.prepare(`SELECT a.id FROM a2a_actions a
   WHERE a.type='conversation.execute' AND a.status='pending' AND a.acked_at IS NULL
    AND a.expires_at IS NOT NULL AND a.expires_at<=?
    AND json_valid(a.payload_json) AND json_extract(a.payload_json,'$.conversationId') IS NOT NULL
    ${conversationId===null?'':'AND json_extract(a.payload_json,\'$.conversationId\')=?'}`).all(...(conversationId===null?[timestamp]:[timestamp,conversationId]));
  for(const row of rows){
   const result=JSON.stringify({code:'CONVERSATION_QUEUE_TIMEOUT',queueExpired:true,archivedUnconfirmed:false});
   db.prepare("UPDATE a2a_actions SET status='failed',completed_at=?,error='CONVERSATION_QUEUE_TIMEOUT',result_json=? WHERE id=? AND status='pending' AND acked_at IS NULL").run(timestamp,result,row.id);
   // A queued first turn may have reserved the Bot slot before a later turn
   // was added. Release only that exact reservation; never touch a newer run.
   db.prepare('UPDATE hermes_bots SET active_action_id=NULL WHERE active_action_id=?').run(row.id);
  }
  return rows.length;
 };
 const status=row=>row.error===removedCode?'cancelled':({pending:'queued',acked:'running',succeeded:'completed'})[row.status]||row.status;
 function setPaused(conversationId,value){
  db.prepare(`INSERT INTO conversation_queue_controls(conversation_id,paused,updated_at) VALUES(?,?,?)
   ON CONFLICT(conversation_id) DO UPDATE SET paused=excluded.paused,updated_at=excluded.updated_at`).run(conversationId,value?1:0,new Date().toISOString());
 }
 function projection(conversationId){
  expirePending(conversationId);
  const pending=rows.all(conversationId).filter(row=>row.status==='pending');
  const items=pending.map(row=>{const data=payload(row),message=db.prepare('SELECT content,attachment_json,created_at FROM conversation_messages WHERE id=? AND conversation_id=?').get(data.messageId,conversationId);return{id:row.id,message_id:data.messageId,content:message?.content||'',attachments:message?JSON.parse(message.attachment_json).map(item=>({name:item.name,mimeType:item.mimeType,size:item.size})):[],created_at:message?.created_at||row.created_at};});
  return{paused:paused(conversationId),items,count:items.length};
 }
 function assertAdmission(row){
  if(!controlled(row)||row.status!=='pending')return;
  const data=payload(row);
  if(paused(data.conversationId))fail('CONVERSATION_QUEUE_PAUSED','此会话的待发消息已暂停，请恢复队列');
  const unsettled=db.prepare("SELECT * FROM a2a_actions WHERE workspace_id=? AND id<>? AND acked_at IS NOT NULL AND status IN ('failed','expired') AND json_valid(payload_json) AND json_extract(payload_json,'$.employeeId')=?").all(row.workspace_id,row.id,data.employeeId);
  if(unsettled.some(other=>{const p=payload(other),action={id:other.id,payload:p},delivery={status:other.status,result:parse(other.result_json)};return isDshAction(action)&&p.dshSessionBinding&&!confirmedDshSessionExit(action,delivery)&&!confirmedDshPrePromptFailure(action,delivery);}))fail('DSH_SESSION_UNCONFIRMED','此员工的原生 DSH turn 终态尚未确认；保留原回执，不能领取下一条消息');
  const earlier=db.prepare(`SELECT a.*,a.rowid AS action_rowid FROM a2a_actions a
   WHERE workspace_id=? AND id<>? AND status IN ('pending','acked') AND json_valid(payload_json)
    AND json_extract(payload_json,'$.employeeId')=? ORDER BY created_at,rowid`).all(row.workspace_id,row.id,data.employeeId);
  const current=db.prepare('SELECT rowid FROM a2a_actions WHERE id=?').get(row.id).rowid;
  if(earlier.some(other=>other.status==='acked'||(other.created_at<row.created_at||other.created_at===row.created_at&&other.action_rowid<current)&&(!controlled(other)||!paused(payload(other).conversationId))))fail('CONVERSATION_QUEUE_BLOCKED','此员工还有更早的待发消息或正在执行的任务');
 }
 return{
  controlled,paused,projection,status,
  messages(conversationId,messages){
   expirePending(conversationId);
   if(!messages.length)return messages;
   const placeholders=messages.map(()=>'?').join(','),actions=new Map(db.prepare(`SELECT a.status,a.error,json_extract(a.payload_json,'$.messageId') AS message_id FROM a2a_actions a
    WHERE a.type='conversation.execute' AND json_valid(a.payload_json) AND a.workspace_id=(SELECT workspace_id FROM conversations WHERE id=?) AND json_extract(a.payload_json,'$.employeeId') IS (SELECT employee_id FROM conversations WHERE id=?) AND json_extract(a.payload_json,'$.conversationId')=? AND json_extract(a.payload_json,'$.messageId') IN (${placeholders}) ORDER BY a.created_at,a.rowid`).all(conversationId,conversationId,conversationId,...messages.map(message=>message.id)).map(row=>[row.message_id,row]));
   return messages.map(message=>actions.has(message.id)?{...message,queue_status:status(actions.get(message.id))}:message);
  },
  current(conversationId){expirePending(conversationId);const actions=rows.all(conversationId);return actions.find(row=>row.status==='acked')||actions.find(row=>row.status==='pending')||null;},
  expirePending,
  setPaused,assertAdmission,
  controlBot(workspaceId,employeeId,snapshot,value){
   for(const conversation of db.prepare('SELECT id FROM conversations WHERE workspace_id=? AND employee_id=?').all(workspaceId,employeeId)){
    setPaused(conversation.id,value);
    if(value)continue;
    for(const row of rows.all(conversation.id).filter(row=>row.status==='pending'&&!row.acked_at)){
     const data=payload(row),saved=data.hermesBot;
     if(!saved||data.runtime!=='Hermes'||data.deviceId!==snapshot.deviceId||data.profile!==snapshot.sourceProfile||data.model!==snapshot.model||saved.conversationId!==data.conversationId||runtimeBinding(saved)!==runtimeBinding(snapshot))continue;
     data.hermesBot={...saved,controlEpoch:snapshot.controlEpoch};
     db.prepare("UPDATE a2a_actions SET payload_json=? WHERE id=? AND status='pending' AND acked_at IS NULL").run(JSON.stringify(data),row.id);
    }
   }
  },
  deliverable(row){return !controlled(row)||row.status!=='pending'||!paused(payload(row).conversationId);},
  remove(conversationId,actionId){
   db.exec('SAVEPOINT conversation_queue_remove');
   try{
    const row=db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(actionId);
    if(!row||!controlled(row)||payload(row).conversationId!==conversationId||row.workspace_id!==db.prepare('SELECT workspace_id FROM conversations WHERE id=?').get(conversationId)?.workspace_id)fail('CONVERSATION_QUEUE_ITEM_NOT_FOUND','待发消息不存在于此会话',404);
    if(row.error!==removedCode){
     if(row.status!=='pending'||row.acked_at)fail('CONVERSATION_QUEUE_ALREADY_DISPATCHED','消息已被领取或结束，不能从待发队列移除');
     db.prepare("UPDATE a2a_actions SET status='failed',completed_at=?,error=?,result_json=? WHERE id=? AND status='pending' AND acked_at IS NULL").run(new Date().toISOString(),removedCode,JSON.stringify({queueRemoved:true}),row.id);
     db.prepare('UPDATE hermes_bots SET active_action_id=NULL WHERE active_action_id=?').run(row.id);
    }
    db.exec('RELEASE conversation_queue_remove');return projection(conversationId);
   }catch(error){db.exec('ROLLBACK TO conversation_queue_remove; RELEASE conversation_queue_remove');throw error;}
  },
 };
}
