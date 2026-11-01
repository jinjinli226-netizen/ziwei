import { randomUUID } from 'node:crypto';
import { normalizeMixedGroup, planMixedGroupDispatch, appendMixedGroupTurn } from './mixed-groups.mjs';

const parse = value => { try { return JSON.parse(value); } catch { return null; } };
const nowIso = () => new Date().toISOString();
const rowView = row => normalizeMixedGroup({
  id: row.id,
  title: row.title,
  workspace: row.workspace_slug,
  members: parse(row.roster_json) || [],
  messages: parse(row.messages_json) || [],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export function createMixedGroupStore(repo) {
  const db = repo.db;
  db.exec(`CREATE TABLE IF NOT EXISTS mixed_groups (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL,
    roster_json TEXT NOT NULL, messages_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
  );`);
  try { db.exec("ALTER TABLE mixed_groups ADD COLUMN runs_json TEXT NOT NULL DEFAULT '[]'"); } catch (error) { if (!String(error.message).includes('duplicate column')) throw error; }

  function workspace(slug) {
    const row = db.prepare('SELECT id,slug FROM workspaces WHERE slug=?').get(slug);
    if (!row) throw Object.assign(new Error('工作区不存在'), { code: 'WORKSPACE_NOT_FOUND', status: 404 });
    return row;
  }
  function get(slug, id) {
    const ws = workspace(slug);
    const row = db.prepare('SELECT g.*,w.slug AS workspace_slug FROM mixed_groups g JOIN workspaces w ON w.id=g.workspace_id WHERE g.workspace_id=? AND g.id=?').get(ws.id, id);
    if (!row) throw Object.assign(new Error('混合群不存在'), { code: 'MIXED_GROUP_NOT_FOUND', status: 404 });
    const value = rowView(row), runs = parse(row.runs_json) || [];
    const refreshed = runs.map(run => {
      const action = repo.getA2AAction(run.actionId, { workspaceSlug: slug });
      return action ? { ...run, status: action.status, error: action.error || null, output: action.result?.output || action.result?.result?.output || null, attachments: (action.result?.outputArtifacts || action.result?.result?.outputArtifacts || []).filter(item=>item.attachmentId).map(({attachmentId,name,mimeType,size,sha256})=>({attachmentId,name,mimeType,size,sha256})) } : run;
    });
    let messages=value.messages;
    const completed=refreshed.filter(run=>['succeeded','failed','cancelled','expired'].includes(run.status));
    const known=new Set(messages.map(message=>message.actionId).filter(Boolean));
    const outcomes=completed.filter(run=>!known.has(run.actionId)).map(run=>({
      employeeId:run.employeeId,runtime:run.runtime,profile:run.profile,actionId:run.actionId,
      status:run.status==='expired'?'unknown':run.status,output:run.output,error:run.error,conversationId:run.conversationId,attachments:run.attachments,
    }));
    if(outcomes.length){
      const userMessage=messages.find(message=>message.id===runMessageId(refreshed));
      if(userMessage)messages=appendMixedGroupTurn({...value,messages},{messageId:userMessage.id,content:userMessage.text,runs:outcomes,updatedAt:nowIso()}).messages;
    }
    const nextMessages=JSON.stringify(persistedMessages(messages)),nextRuns=JSON.stringify(refreshed);
    if(nextRuns!==JSON.stringify(runs)||nextMessages!==JSON.stringify(value.messages))db.prepare('UPDATE mixed_groups SET runs_json=?,messages_json=?,updated_at=? WHERE id=?').run(nextRuns,nextMessages,nowIso(),id);
    const states=refreshed.map(run=>run.status==='expired'?'unknown':run.status),state=!states.length?'planned':states.some(value=>value==='unknown')?'unknown':states.some(value=>value==='failed')&&states.some(value=>value==='succeeded')?'partial':states.every(value=>value==='succeeded')?'succeeded':states.every(value=>value==='failed')?'failed':states.every(value=>value==='cancelled')?'cancelled':states.some(value=>['pending','acked','running'].includes(value))?'running':'planned';
    const projected=messages.map(message=>({...message,...(message.attachments?.length?{attachments:projectAttachments(ws.id,message.sourceConversationId,message.attachments)}:{})}));
    return { ...value, messages:projected, runs: refreshed.map(run=>({...run,...(run.attachments?.length?{attachments:projectAttachments(ws.id,run.conversationId,run.attachments)}:{})})), state };
  }
  function projectAttachments(workspaceId,conversationId,items){
    if(!conversationId)return [];
    return repo.conversationAttachmentStore.resolve({workspaceId,conversationId},items).map(item=>{const url=`/api/conversations/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(item.attachmentId)}`;return {...item,conversationId,url,downloadUrl:`${url}?download=1`};});
  }
  function persistedMessages(messages){return messages.map(message=>({...message,...(message.attachments?{attachments:message.attachments.map(({attachmentId,name,mimeType,size,sha256})=>({attachmentId,name,mimeType,size,sha256}))}:{})}));}
  function runMessageId(runs){return runs.find(run=>run.messageId)?.messageId || null;}
  function list(slug) {
    const ws = workspace(slug);
    return db.prepare('SELECT g.id FROM mixed_groups g WHERE g.workspace_id=? ORDER BY g.updated_at DESC').all(ws.id).map(row => get(slug, row.id));
  }
  function create(slug, input) {
    const ws = workspace(slug), value = normalizeMixedGroup({ ...input, workspace: slug });
    for (const member of value.members) {
      const employee = db.prepare('SELECT id,workspace_id,runtime,runtime_profile,target_device_id,status FROM employees WHERE id=? AND workspace_id=?').get(member.employeeId, ws.id);
      if (!employee || employee.status === 'deleted' || employee.runtime !== member.runtime || employee.runtime_profile !== member.profile || employee.target_device_id !== member.deviceId) throw Object.assign(new Error('混合群成员绑定与当前员工配置不一致'), { code: 'MIXED_GROUP_MEMBER_BINDING_MISMATCH', status: 409 });
      const conversation = db.prepare('SELECT id,workspace_id,employee_id,device_id,status FROM conversations WHERE id=? AND workspace_id=?').get(member.conversationId, ws.id);
      if (!conversation || conversation.employee_id !== member.employeeId || conversation.status !== 'active' || conversation.device_id && conversation.device_id !== member.deviceId) throw Object.assign(new Error('混合群成员专属会话绑定不一致'), { code: 'MIXED_GROUP_CONVERSATION_BINDING_MISMATCH', status: 409 });
    }
    const stamp = nowIso();
    try {
      db.prepare('INSERT INTO mixed_groups(id,workspace_id,title,roster_json,messages_json,runs_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(value.id, ws.id, value.title, JSON.stringify(value.members), JSON.stringify(value.messages), '[]', stamp, stamp);
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) throw Object.assign(new Error('混合群 id 已存在'), { code: 'MIXED_GROUP_DUPLICATE', status: 409 });
      throw error;
    }
    return get(slug, value.id);
  }
  function update(slug, id, input) {
    const current = get(slug, id), value = normalizeMixedGroup({ ...current, ...input, id, workspace: slug, members: input.members || current.members, messages: current.messages });
    db.prepare('UPDATE mixed_groups SET title=?,roster_json=?,updated_at=? WHERE id=?').run(value.title, JSON.stringify(value.members), nowIso(), id);
    return get(slug, id);
  }
  function remove(slug, id) {
    const ws = workspace(slug); get(slug, id);
    db.prepare('DELETE FROM mixed_groups WHERE workspace_id=? AND id=?').run(ws.id, id);
    return { id, deleted: true };
  }
  function planSend(slug, id, input = {}, actor = {}) {
    const group = get(slug, id), plan = planMixedGroupDispatch({ group, content: input.content, attachments: input.attachments || [], targetEmployeeIds: input.targetEmployeeIds, source: { type: 'user', messageId: input.messageId || `mixed-message:${randomUUID()}` } });
    const ws=workspace(slug), sourceId=input.attachmentSourceConversationId;
    const sourceScope={workspaceId:ws.id,conversationId:sourceId};
    if(plan.attachments.length){
      if(!group.members.some(member=>member.conversationId===sourceId)||!repo.getConversationAccess(sourceId,actor))throw Object.assign(new Error('附件来源必须是当前群聊有权访问的成员会话'),{status:403});
      plan.attachments=repo.conversationAttachmentStore.resolve(sourceScope,plan.attachments);
    }
    const previous=group.messages.find(message=>message.id===plan.source.messageId);
    if(previous){
      if(previous.text!==plan.content||JSON.stringify((previous.attachments||[]).map(item=>item.attachmentId))!==JSON.stringify(plan.attachments.map(item=>item.attachmentId)))throw Object.assign(new Error('群消息标识对应的内容已变化'),{status:409});
      return {state:'dispatched',group,runs:group.runs.filter(run=>run.messageId===plan.source.messageId),execution:'conversation_execute'};
    }
    const runs = [];
    db.exec('SAVEPOINT mixed_group_send');
    try {
      for (const member of plan.members) {
        const attachments=plan.attachments.map(item=>repo.conversationAttachmentStore.clone(sourceScope,{workspaceId:ws.id,conversationId:member.conversationId},item.attachmentId));
        member.attachments=attachments;
        const message = repo.addConversationMessage(member.conversationId, { content: member.prompt, attachments, dispatch: true, clientMessageId: `mixed-group:${group.id}:${plan.source.messageId}:${member.employeeId}` });
        const actionId = message.execution?.id || message.execution?.actionId;
        if (!actionId) throw Object.assign(new Error('混合群成员动作未创建'), { code: 'MIXED_GROUP_ACTION_CREATE_FAILED', status: 502 });
        runs.push({ employeeId: member.employeeId, runtime: member.runtime, profile: member.profile, conversationId: member.conversationId, actionId, messageId: plan.source.messageId, status: 'pending' });
      }
      const messages = [...group.messages, { id: plan.source.messageId, role: 'user', text: plan.content, status: 'pending', ...(plan.attachments.length ? { attachments: plan.attachments,sourceConversationId:sourceId } : {}) }].slice(-300);
      db.prepare('UPDATE mixed_groups SET messages_json=?,runs_json=?,updated_at=? WHERE id=?').run(JSON.stringify(persistedMessages(messages)), JSON.stringify(runs), nowIso(), id);
      db.exec('RELEASE mixed_group_send');
    } catch (error) { db.exec('ROLLBACK TO mixed_group_send; RELEASE mixed_group_send'); throw error; }
    return { state: 'dispatched', group: get(slug, id), plan: { ...plan, members: plan.members.map(member => ({ ...member, actionId: runs.find(run => run.employeeId === member.employeeId).actionId })) }, runs, execution: 'conversation_execute' };
  }
  function appendTurn(slug, id, turn) {
    const group = get(slug, id), next = appendMixedGroupTurn(group, turn);
    db.prepare('UPDATE mixed_groups SET messages_json=?,updated_at=? WHERE id=?').run(JSON.stringify(persistedMessages(next.messages)), next.updatedAt, id);
    return get(slug, id);
  }
  function cancel(slug, id, sourceActionId) {
    const group = get(slug, id), runs = group.runs || [], target = sourceActionId ? runs.filter(run => run.actionId === sourceActionId) : runs.filter(run => !['succeeded', 'failed', 'cancelled', 'expired'].includes(run.status));
    const controls = target.map(run => {
      if (['succeeded', 'failed', 'cancelled', 'expired'].includes(run.status)) return { ...run, cancellationRequested: false };
      const action = repo.createA2AAction(slug, { type: 'action.cancel', dedupeKey: `mixed-group-cancel:${group.id}:${run.actionId}`, payload: { actionId: run.actionId, deviceId: group.members.find(member => member.employeeId === run.employeeId)?.deviceId } });
      return { ...run, cancelActionId: action.id, cancellationRequested: true };
    });
    return { state: 'cancel_requested', groupId: group.id, sourceActionId: sourceActionId || null, controls };
  }
  return { list, get, create, update, remove, planSend, appendTurn, cancel };
}
