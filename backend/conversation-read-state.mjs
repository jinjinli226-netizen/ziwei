import {createMobileReadView} from './mobile-read-view.mjs';

const failure=(status,code,message)=>Object.assign(new Error(message),{status,code});

// Personal read cursors never mutate the chat, its execution or another user's cursor.
export function createConversationReadService(repo) {
  const db=repo.db,view=createMobileReadView(repo);
  function member(workspaceId,context={}) {
    const userId=context.actorUserId;
    if(!userId)throw failure(401,'CHAT_USER_REQUIRED','请先登录紫薇');
    const row=db.prepare('SELECT role FROM members WHERE workspace_id=? AND user_id=?').get(workspaceId,userId);
    if(!row)throw failure(403,'CHAT_ACCESS_DENIED','当前用户无权访问该工作区');
    return {actorUserId:userId,actorRole:row.role,enforceEmployeeVisibility:true};
  }
  const unreadSql="SELECT COUNT(*) AS count FROM conversation_messages WHERE conversation_id=? AND rowid>? AND (role<>'user' OR (sender_user_id IS NOT NULL AND sender_user_id<>?))";
  function unread(conversationId,userId,watermark=0) {
    return db.prepare(unreadSql).get(conversationId,watermark,userId).count;
  }
  function read(conversationId,input={},context={}) {
    const row=db.prepare('SELECT workspace_id FROM conversations WHERE id=?').get(conversationId);
    if(!row)throw failure(404,'CHAT_NOT_FOUND','聊天不存在');
    const actor=member(row.workspace_id,context);
    if(!repo.getConversationAccess(conversationId,actor))throw failure(404,'CHAT_NOT_FOUND','聊天不存在或无权查看');
    if(typeof input.messageId!=='string'||!input.messageId||input.messageId.length>128)throw failure(400,'CHAT_MESSAGE_REQUIRED','请选择已显示的消息');
    const message=db.prepare('SELECT id,rowid AS sequence FROM conversation_messages WHERE id=? AND conversation_id=?').get(input.messageId,conversationId);
    if(!message)throw failure(404,'CHAT_MESSAGE_NOT_FOUND','该消息不属于当前聊天');
    db.prepare(`INSERT INTO conversation_reads(workspace_id,conversation_id,user_id,last_message_id,last_message_rowid,last_read_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(conversation_id,user_id) DO UPDATE SET
      last_message_id=excluded.last_message_id,last_message_rowid=excluded.last_message_rowid,last_read_at=excluded.last_read_at
      WHERE excluded.last_message_rowid>conversation_reads.last_message_rowid`).run(row.workspace_id,conversationId,actor.actorUserId,message.id,message.sequence,new Date().toISOString());
    const saved=db.prepare('SELECT last_message_id,last_message_rowid FROM conversation_reads WHERE conversation_id=? AND user_id=?').get(conversationId,actor.actorUserId);
    return {conversationId,lastReadMessageId:saved.last_message_id,unreadCount:unread(conversationId,actor.actorUserId,saved.last_message_rowid)};
  }
  function list(slug,context={}) {
    const ws=repo.getWorkspace(slug);
    if(!ws)throw failure(404,'CHAT_WORKSPACE_NOT_FOUND','工作区不存在');
    const actor=member(ws.id,context),privileged=['owner','admin'].includes(actor.actorRole)?1:0;
    // Canonical conversations only. Never hydrate transcripts, Bot settings or action events here.
    const rows=db.prepare(`SELECT c.id,c.employee_id,c.title,c.updated_at,e.name,e.runtime,e.avatar,e.visibility,
      COALESCE(r.last_message_rowid,0) AS watermark,
      (SELECT count(*) FROM conversation_messages m WHERE m.conversation_id=c.id) AS message_count,
      (SELECT m.id FROM conversation_messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC,m.rowid DESC LIMIT 1) AS latest_message_id
      FROM conversations c JOIN employees e ON e.id=c.employee_id AND e.workspace_id=c.workspace_id
      LEFT JOIN hermes_bots b ON b.employee_id=e.id AND b.workspace_id=c.workspace_id
      LEFT JOIN conversation_reads r ON r.conversation_id=c.id AND r.user_id=?
      WHERE c.workspace_id=? AND c.status='active' AND e.status<>'deleted'
      AND (e.visibility<>'personal' OR ?=1 OR e.owner_user_id=?)
      AND ((b.employee_id IS NOT NULL AND b.main_conversation_id=c.id) OR (b.employee_id IS NULL AND c.id=(
        SELECT active.id FROM conversations active WHERE active.employee_id=e.id AND active.workspace_id=c.workspace_id AND active.status='active' ORDER BY active.updated_at DESC,active.rowid DESC LIMIT 1)))
      ORDER BY c.updated_at DESC,c.rowid DESC`).all(actor.actorUserId,ws.id,privileged,actor.actorUserId);
    const preview=db.prepare("SELECT CASE WHEN forward_json IS NOT NULL THEN '[聊天记录]' ELSE substr(content,1,180) END AS content,CASE WHEN attachment_json<>'[]' THEN 1 ELSE 0 END AS has_attachments FROM conversation_messages WHERE id=?");
    const chats=rows.map(row=>{
      const last=row.latest_message_id?preview.get(row.latest_message_id):null;
      const employee=view.employee(slug,{id:row.employee_id,name:row.name,runtime:row.runtime,avatar:row.avatar,visibility:row.visibility});
      if(!String(employee.avatar||'').startsWith('/api/workspaces/'))employee.avatar='';
      return {conversationId:row.id,employeeId:row.employee_id,employee,title:row.title,
        preview:last?.content?.replace(/\s+/g,' ').trim()||(last?.has_attachments?'[图片]':''),updatedAt:row.updated_at,
        unreadCount:unread(row.id,actor.actorUserId,row.watermark),latestMessageId:row.latest_message_id||null,messageCount:row.message_count};
    });
    return {chats,unreadCount:chats.reduce((sum,item)=>sum+item.unreadCount,0)};
  }
  return {list,read};
}
