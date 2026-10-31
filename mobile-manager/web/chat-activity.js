import { escapeHtml as escape, formatTime as time, workspaceId, workspaceDatabaseId } from './model.js';

const stages = {tool:'调用工具',command:'运行命令',reasoning:'公开思考摘要',context:'处理上下文',progress:'执行进度',response:'生成回答',output:'生成回答'};
const labels = {'action.started':'运行电脑已接收','action.progress':'执行进度','action.output':'生成回答',succeeded:'执行已完成',failed:'执行失败',cancelled:'执行已取消',expired:'执行已过期'};
const active = new Set(['pending','queued','acked','running','executing']);

export function renderChatActivity(state, {escapeHtml = escape, formatTime = time} = {}) {
  const execution = state.conversation?.execution;
  if (!execution?.id || state.conversation.employee_id !== state.selectedEmployee?.id) return '';
  const details = state.chatActivity?.actionId === execution.id ? state.chatActivity : null;
  const candidates = [details?.action, execution, ...(Array.isArray(state.runs) ? state.runs : [])];
  const action = candidates.find(candidate => matchesConversation(candidate, execution.id, state) && Array.isArray(candidate.events));
  const events = (action?.events || []).filter(event => !event.action_id || event.action_id === execution.id).map(activityRow).filter(Boolean);
  const running = active.has(action?.status || execution.status);
  const e = escapeHtml;
  let notice = '';
  if (details?.phase === 'error') notice = `<p class="activity-notice" role="status">活动同步失败：${e(details.error || '请刷新重试')}。已收到的记录继续保留。</p>`;
  else if (details?.phase === 'loading' && !events.length) notice = '<p class="activity-notice" role="status">正在读取本次执行活动…</p>';
  if (!events.length && !notice) notice = `<p class="activity-notice" role="status">${running ? '等待运行电脑回传工具与执行进度。' : '此执行尚未提供详细活动记录。'}</p>`;
  if (action && action.event_count > action.events.length) notice += '<p class="activity-notice">当前为精简活动记录，仅显示服务器返回的阶段。</p>';
  const rows = events.map(event => `<li class="activity-event" data-stage="${event.stage}"><div class="activity-event-heading"><strong>${e(event.label)}</strong>${event.createdAt ? `<time>${e(formatTime(event.createdAt))}</time>` : ''}</div>${event.detail ? `<p>${e(event.detail)}</p>` : ''}${event.summary ? `<p class="activity-public-summary">${e(event.summary)}</p>` : ''}</li>`).join('');
  return `<details class="chat-activity panel" data-action-id="${e(execution.id)}"${running ? ' open' : ''}><summary><span>执行活动</span><small>${events.length ? `${events.length} 条记录` : '等待真实回执'}</small></summary><section aria-label="本次执行活动">${notice}${rows ? `<ol class="activity-events">${rows}</ol>` : ''}</section></details>`;
}

function matchesConversation(action, actionId, state) {
  if (action?.id !== actionId) return false;
  const payload = action.payload, employeeId = state.selectedEmployee.id;
  if (payload?.conversationId !== undefined && payload.conversationId !== state.conversation.id) return false;
  if (payload?.employeeId !== undefined && payload.employeeId !== employeeId) return false;
  if (action.employee_id !== undefined && action.employee_id !== employeeId) return false;
  if (payload?.workspace !== undefined && payload.workspace !== workspaceId(state)) return false;
  const databaseId = workspaceDatabaseId(state.workspace);
  return !databaseId || action.workspace_id === undefined || action.workspace_id === databaseId;
}

function activityRow(event) {
  const data = event.data || {}, progress = data.progress || {};
  const stage = event.stage || data.stage || progress.stage;
  const label = Object.hasOwn(stages,stage) ? stages[stage] : Object.hasOwn(labels,event.type) ? labels[event.type] : '';
  if (!label) return null;
  // Runtime adapters publish redacted summaries explicitly. Raw model output,
  // thinking/content fields, tool arguments and results are never inferred here.
  const summary = [event.summary,data.summary,progress.summary].find(value => typeof value === 'string' && value.trim()) || '';
  const detail = stage === 'reasoning' ? '' : [event.detail,data.detail,progress.detail,event.message,data.message,progress.message].find(value => typeof value === 'string' && value.trim()) || '';
  return {label,stage:Object.hasOwn(stages,stage) ? stage : 'progress',detail:detail.slice(0,2000),summary:summary.slice(0,4000),createdAt:event.created_at};
}
