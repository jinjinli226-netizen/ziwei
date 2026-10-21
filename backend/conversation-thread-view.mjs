import {createBotManagementActionReader} from './bot-management-view.mjs';

const fail=(code,message,status=400)=>{throw Object.assign(new Error(message),{code,status});};
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
export function normalizeConversationThreadOptions(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>/^(before|limit)\[/.test(key)))fail('CONVERSATION_PAGE_QUERY_INVALID','历史消息分页参数无效');
  const {limit,before}=input;
  const size=limit===undefined?10:typeof limit==='number'?limit:typeof limit==='string'&&/^[1-9][0-9]*$/.test(limit)?Number(limit):NaN;
  if(!Number.isSafeInteger(size)||size<1||size>80)fail('CONVERSATION_PAGE_LIMIT_INVALID','每次读取的消息数量须为1至80的整数');
  if(before!==undefined&&!identifier(before))fail('CONVERSATION_PAGE_CURSOR_INVALID','历史消息游标无效');
  return{limit:size,before};
}

export function createConversationThreadView(repo){
  const db=repo.db,readAction=createBotManagementActionReader(repo);
  const cursor=db.prepare('SELECT created_at,rowid AS message_rowid FROM conversation_messages WHERE id=? AND conversation_id=?');
  const count=db.prepare('SELECT count(*) AS total FROM conversation_messages WHERE conversation_id=?');
  const recent=db.prepare('SELECT * FROM conversation_messages WHERE conversation_id=? ORDER BY created_at DESC,rowid DESC LIMIT ?');
  const older=db.prepare('SELECT * FROM conversation_messages WHERE conversation_id=? AND (created_at,rowid)<(?,?) ORDER BY created_at DESC,rowid DESC LIMIT ?');
  const latest=db.prepare(`SELECT id,status,expires_at FROM a2a_actions WHERE workspace_id=? AND type IN ('task.execute','conversation.execute')
    AND CASE WHEN json_valid(payload_json) THEN json_extract(payload_json,'$.conversationId') END=? ORDER BY created_at DESC,rowid DESC LIMIT 1`);
  // Group scope is checked against its original request and receipts. A compact
  // action must never supply substitute member bindings to that validator.
  const group=db.prepare(`SELECT EXISTS(SELECT 1 FROM json_tree(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END) WHERE key='resource' AND atom IN ('groups','collaboration'))
    OR EXISTS(SELECT 1 FROM json_tree(CASE WHEN json_valid(result_json) THEN result_json ELSE '{}' END) WHERE key='resource' AND atom IN ('groups','collaboration'))
    OR EXISTS(SELECT 1 FROM a2a_action_events e,json_tree(CASE WHEN json_valid(e.data_json) THEN e.data_json ELSE '{}' END) j
      WHERE e.action_id=a.id AND (e.type IN ('succeeded','failed','cancelled','expired') OR e.id=(SELECT id FROM a2a_action_events WHERE action_id=a.id ORDER BY created_at DESC,id DESC LIMIT 1))
      AND j.key='resource' AND j.atom IN ('groups','collaboration')) AS required FROM a2a_actions a WHERE id=? AND workspace_id=?`);
  return{
    messages(conversationId,options={}){
      const {limit,before}=normalizeConversationThreadOptions(options);
      const bound=before===undefined?null:cursor.get(before,conversationId);
      if(before!==undefined&&!bound)fail('CONVERSATION_PAGE_CURSOR_NOT_FOUND','历史消息游标不存在于此会话',404);
      const selected=bound?older.all(conversationId,bound.created_at,bound.message_rowid,limit+1):recent.all(conversationId,limit+1);
      const hasMore=selected.length>limit,rows=selected.slice(0,limit).reverse();
      return{rows,messagePage:{hasMore,beforeCursor:rows[0]?.id||null,total:count.get(conversationId).total}};
    },
    latestAction:latest.get.bind(latest),
    execution(actionId,workspaceId){
      return group.get(actionId,workspaceId)?.required
        ?repo.getA2AAction(actionId,{eventView:'mobile'})
        :readAction(actionId,workspaceId);
    },
  };
}
