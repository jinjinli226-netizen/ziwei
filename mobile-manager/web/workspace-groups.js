import { id, scopeKey, workspaceId, accountId } from './model.js';
import { mobileGroupCandidates } from './mobile-groups.js';
import { createDraftAttachments, createAttachmentUploader, releaseDraftAttachments } from './attachment-upload.js';

const pages = new Set(['workspace-groups', 'workspace-group', 'workspace-group-new']);
const running = new Set(['pending', 'acked', 'queued', 'running']);
export const workspaceGroupRunning = group => (group?.runs || []).some(run => running.has(run.status));
export const workspaceGroupEditable = state => ['owner', 'admin', 'member'].includes(state.workspace?.role);
export function workspaceGroupMember(employee) {
  const profile = employee?.runtime_profile || employee?.profile;
  const conversationId = employee?.main_conversation_id || employee?.conversationId;
  if (!profile || !employee?.target_device_id || !conversationId) throw new Error(`${employee?.name || '这位员工'}缺少 Profile、电脑或专属会话，请先在员工设置中补齐`);
  return { employeeId: employee.id, name: employee.name || employee.id, runtime: employee.runtime, profile, deviceId: employee.target_device_id, conversationId };
}
function checkedGroup(value, workspace, expectedId) {
  if (!value || !/^mix_[A-Za-z0-9_-]{1,80}$/.test(value.id || '') || expectedId && value.id !== expectedId || value.workspace !== workspace || typeof value.title !== 'string'
    || !Array.isArray(value.members) || !Array.isArray(value.messages) || !value.members.every(member => typeof member.employeeId === 'string' && typeof member.name === 'string')
    || !value.messages.every(message => typeof message.id === 'string' && typeof message.text === 'string')) throw new Error('群聊返回内容与当前工作区或群选择不一致，请重新读取');
  return value;
}

export function createWorkspaceGroups({ state, api, current, valid, draw = () => {}, fail = () => {} }) {
  let generation = 0, disposed = false;
  const pendingWrites = new Map(), drafts = new Map(), uploadAttachment = createAttachmentUploader({ api });
  const capture = () => current?.() || { scope: scopeKey(state) };
  const live = (g, token, visit) => !disposed && state.workspaceGroups === g && generation === visit && pages.has(state.page) && g.scope === scopeKey(state) && (valid ? valid(token) : token.scope === scopeKey(state));
  const initial = () => ({ scope: scopeKey(state), list: [], listPagination: null, group: null, historyPagination: null, selectedId: '', loading: false, detailLoading: false, historyLoading: false, busy: false, error: '', notice: '', title: '', memberIds: [], mentions: [], content: '', attachments: [], draft: null, downloadId: '', pending: null });
  const pendingKey = g => JSON.stringify([g.scope, g.selectedId || 'create']);
  function bindDraft(g) {
    const key = pendingKey(g);
    if (!drafts.has(key)) drafts.set(key, { content: '', attachments: [], sourceConversationId: '', uploading: false });
    g.draft = drafts.get(key); g.content = g.draft.content; g.attachments = g.draft.attachments;
  }
  function clearSentDraft(g, request) {
    if (g.content === request.content) { g.content = ''; if (g.draft) g.draft.content = ''; }
    if (!g.draft || !request.attachmentLocalIds?.length) return;
    const removed = g.draft.attachments.filter(item => request.attachmentLocalIds.includes(item.localId));
    releaseDraftAttachments(removed);
    g.draft.attachments = g.draft.attachments.filter(item => !request.attachmentLocalIds.includes(item.localId));
    g.attachments = g.draft.attachments;
    if (!g.attachments.length) g.draft.sourceConversationId = '';
  }
  function confirmPending(g, messages) {
    const pending = pendingWrites.get(pendingKey(g));
    if (pending?.kind === 'send' && messages.some(message => message.id === pending.messageId)) {
      pendingWrites.delete(pendingKey(g)); g.pending = null; g.notice = '原消息已在群聊中确认'; clearSentDraft(g, pending);
    }
  }
  function report(g, error, token, visit) {
    if (!live(g, token, visit)) return;
    g.error = error?.message || '群聊读取失败，请重试';
    if (error?.status === 401) fail(error, token);
  }
  function apply(g, value) {
    const previous = g.group?.messages || [], overlap = value.messages.some(message => previous.some(old => old.id === message.id));
    if (!previous.length || !value.pagination || !overlap && value.messages.length) {
      if (previous.length && value.pagination && !overlap) g.notice = '群聊已收到一批新消息，可继续读取更早记录';
      g.historyPagination = value.pagination || null;
    } else value = { ...value, messages: [...new Map([...previous, ...value.messages].map(message => [message.id, message])).values()] };
    g.group = value;
    const index = g.list.findIndex(group => group.id === value.id);
    if (index < 0) g.list.unshift(value); else g.list[index] = value;
    confirmPending(g, value.messages);
  }
  async function readList(g = state.workspaceGroups, { more = false } = {}) {
    if (!g || g.loading) return false;
    const token = capture(), visit = generation, workspace = workspaceId(state);
    g.loading = true; g.error = ''; draw();
    try {
      const value = await api.mixedGroups(workspace, more ? { before: g.listPagination.nextBefore } : {});
      if (!live(g, token, visit)) return false;
      if (!Array.isArray(value?.groups)) throw new Error('群聊列表返回异常，请重新读取');
      const groups = value.groups.map(group => checkedGroup(group, workspace));
      g.list = more ? [...new Map([...g.list, ...groups].map(group => [group.id, group])).values()] : groups;
      g.listPagination = value.pagination || null; return true;
    } catch (error) { report(g, error, token, visit); return false; }
    finally { if (live(g, token, visit)) { g.loading = false; draw(); } }
  }
  async function readDetail(g = state.workspaceGroups) {
    if (!g?.selectedId || g.detailLoading || g.historyLoading || g.busy) return false;
    const token = capture(), visit = generation, workspace = workspaceId(state), selectedId = g.selectedId;
    g.detailLoading = true; g.error = ''; draw();
    try {
      const value = await api.mixedGroup(workspace, selectedId);
      if (!live(g, token, visit) || g.selectedId !== selectedId) return false;
      apply(g, checkedGroup(value, workspace, selectedId)); return true;
    } catch (error) { report(g, error, token, visit); return false; }
    finally { if (live(g, token, visit) && g.selectedId === selectedId) { g.detailLoading = false; draw(); } }
  }
  async function readHistory() {
    const g = state.workspaceGroups;
    if (!g?.historyPagination?.hasMore || g.historyLoading || g.detailLoading || g.busy) return false;
    const token = capture(), visit = generation, workspace = workspaceId(state), selectedId = g.selectedId;
    g.historyLoading = true; g.error = ''; draw();
    try {
      const value = checkedGroup(await api.mixedGroup(workspace, selectedId, { before: g.historyPagination.nextBefore }), workspace, selectedId);
      if (!live(g, token, visit)) return false;
      g.group = { ...g.group, messages: [...new Map([...value.messages, ...g.group.messages].map(message => [message.id, message])).values()] };
      confirmPending(g, value.messages);
      g.historyPagination = value.pagination || null; return true;
    } catch (error) { report(g, error, token, visit); return false; }
    finally { if (live(g, token, visit)) { g.historyLoading = false; draw(); } }
  }
  async function open() {
    generation++; state.workspaceGroups = initial(); state.page = 'workspace-groups'; draw();
    return readList();
  }
  async function select(groupId) {
    const previous = state.workspaceGroups;
    if (!previous?.list.some(group => group.id === groupId)) return false;
    generation++;
    const g = { ...initial(), list: previous.list, selectedId: groupId };
    state.workspaceGroups = g; state.page = 'workspace-group';
    bindDraft(g);
    g.pending = pendingWrites.get(pendingKey(g)) || null;
    if (g.pending?.content) g.content = g.pending.content;
    if (g.pending) g.notice = '原请求结果尚未确认，请刷新群聊核对，不会自动重发';
    draw(); return readDetail(g);
  }
  function beginCreate() {
    const previous = state.workspaceGroups;
    if (!workspaceGroupEditable(state) || previous?.busy) return false;
    generation++; const g = { ...initial(), list: previous?.list || [] };
    state.workspaceGroups = g; state.page = 'workspace-group-new'; g.pending = pendingWrites.get(pendingKey(g)) || null; draw(); return true;
  }
  async function create() {
    const g = state.workspaceGroups;
    if (!g || state.page !== 'workspace-group-new' || !workspaceGroupEditable(state) || g.busy || g.pending) return false;
    let members;
    try {
      if (g.memberIds.length < 2 || g.memberIds.length > 6) throw new Error('请选择 2–6 位员工');
      const candidates = mobileGroupCandidates(state);
      members = g.memberIds.map(employeeId => workspaceGroupMember(candidates.find(employee => employee.id === employeeId)));
    } catch (error) { g.error = error.message; draw(); return false; }
    const token = capture(), visit = generation, workspace = workspaceId(state);
    const body = { id: `mix_${id().replaceAll('-', '').slice(0, 32)}`, title: g.title.trim() || '新群聊', members };
    const request = { kind: 'create', id: body.id }, key = pendingKey(g);
    pendingWrites.set(key, request);
    g.busy = true; g.error = ''; draw();
    try {
      const value = checkedGroup(await api.createMixedGroup(workspace, body), workspace, body.id);
      if (!live(g, token, visit)) return false;
      pendingWrites.delete(key);
      g.selectedId = value.id; bindDraft(g); apply(g, value); state.page = 'workspace-group'; g.notice = '群聊已创建，可以开始讨论'; return true;
    } catch (error) {
      if (error.uncertain || !error.status) {
        if (live(g, token, visit)) { g.pending = request; g.notice = '创建结果尚未确认，请刷新列表核对，不会重复创建'; }
      } else pendingWrites.delete(key);
      report(g, error, token, visit); return false;
    } finally { if (live(g, token, visit)) { g.busy = false; draw(); } }
  }
  async function send() {
    const g = state.workspaceGroups;
    if (!g?.group || !workspaceGroupEditable(state) || g.busy || g.pending || g.draft?.uploading) return false;
    if (!g.content.trim()) { if (g.attachments.length) { g.error = '请先写一段说明，再发送群附件'; draw(); } return false; }
    if (g.attachments.some(item => !item.ref)) { g.error = '请先重试并完成附件上传'; draw(); return false; }
    const token = capture(), visit = generation, workspace = workspaceId(state), groupId = g.selectedId, content = g.content;
    const body = { content, messageId: `mobile-group:${id()}`, ...(g.mentions.length ? { targetEmployeeIds: g.mentions.slice() } : {}),
      ...(g.attachments.length ? { attachments: g.attachments.map(item => item.ref), attachmentSourceConversationId: g.draft.sourceConversationId } : {}) };
    const request = { kind: 'send', messageId: body.messageId, content, attachmentLocalIds: g.attachments.map(item => item.localId) };
    const key = pendingKey(g); pendingWrites.set(key, request); g.busy = true; g.error = ''; g.notice = ''; draw();
    try {
      const result = await api.sendMixedGroupMessage(workspace, groupId, body);
      if (!live(g, token, visit)) return false;
      const value = checkedGroup(result?.group, workspace, groupId);
      if (!value.messages.some(message => message.id === request.messageId)) throw new Error('原群消息尚未读回，请刷新核对本次请求');
      apply(g, value);
      g.notice = '消息已提交，成员结果将自动更新'; return true;
    } catch (error) {
      if (error.uncertain || !error.status) {
        if (live(g, token, visit)) { g.pending = request; g.notice = '发送结果尚未确认，草稿已保留；请刷新群聊核对，不会自动重发'; }
      } else pendingWrites.delete(key);
      report(g, error, token, visit); return false;
    } finally { if (live(g, token, visit)) { g.busy = false; draw(); } }
  }
  async function uploadDraft(g = state.workspaceGroups) {
    if (!g?.group || !g.draft || g.draft.uploading || g.busy || g.pending || !workspaceGroupEditable(state)) return false;
    const token = capture(), visit = generation, draft = g.draft;
    if (!draft.sourceConversationId) draft.sourceConversationId = g.group.members.find(member => member.conversationId)?.conversationId || '';
    if (!g.group.members.some(member => member.conversationId === draft.sourceConversationId)) { g.error = '群成员的附件来源会话尚未就绪，请刷新群聊'; draw(); return false; }
    draft.uploading = true; g.error = ''; draw();
    try {
      for (const item of draft.attachments.filter(item => !item.ref)) {
        item.upload.phase = 'uploading'; item.upload.error = '';
        try {
          item.ref = await uploadAttachment(draft.sourceConversationId, item.file, { active: () => live(g, token, visit) && state.page === 'workspace-group',
            onProgress: progress => { Object.assign(item.upload, progress); if (live(g, token, visit)) draw(); } });
          item.upload = { phase: 'complete', offset: item.size, total: item.size, error: '' };
        } catch (error) { item.upload.phase = 'failed'; item.upload.error = error.message; throw error; }
      }
      return true;
    } catch (error) { report(g, error, token, visit); return false; }
    finally { draft.uploading = false; if (!disposed && state.workspaceGroups?.draft === draft && state.workspaceGroups.scope === scopeKey(state)) draw(); }
  }
  async function chooseFiles(g, target) {
    if (state.page !== 'workspace-group' || !g.group || !workspaceGroupEditable(state)) return false;
    try {
      const added = createDraftAttachments(Array.from(target.files || []), g.attachments);
      g.draft.attachments = [...g.attachments, ...added]; g.attachments = g.draft.attachments; draw();
      return await uploadDraft(g);
    } catch (error) { g.error = error.message; draw(); return false; }
    finally { target.value = ''; }
  }
  async function download({ message, attachment }) {
    const g = state.workspaceGroups;
    if (!g?.group || state.page !== 'workspace-group' || g.downloadId) return false;
    const file = g.group.messages.find(item => item.id === message)?.attachments?.find(item => item.attachmentId === attachment);
    if (!file?.conversationId || !file.attachmentId) return false;
    const token = capture(), visit = generation; g.downloadId = attachment; g.error = ''; draw();
    try {
      const result = await api.downloadAttachment(file.conversationId, file.attachmentId, { name: file.name || '附件', mimeType: file.mimeType || 'application/octet-stream' });
      if (live(g, token, visit)) { g.notice = result?.saved ? '文件已保存' : result?.cancelled ? '已取消保存' : '已打开文件下载'; draw(); }
      return true;
    } catch (error) { report(g, error, token, visit); return false; }
    finally { if (live(g, token, visit)) { g.downloadId = ''; draw(); } }
  }
  async function cancel() {
    const g = state.workspaceGroups;
    if (!g?.group || !workspaceGroupEditable(state) || g.busy || !workspaceGroupRunning(g.group)) return false;
    const token = capture(), visit = generation;
    g.busy = true; g.error = ''; draw();
    try {
      const result = await api.cancelMixedGroup(workspaceId(state), g.selectedId, {});
      if (!live(g, token, visit)) return false;
      if (result?.groupId !== g.selectedId || result.state !== 'cancel_requested') throw new Error('取消请求回执无法核对');
      g.notice = '取消请求已提交，成员是否停止以实际回执为准'; return true;
    } catch (error) { report(g, error, token, visit); return false; }
    finally { if (live(g, token, visit)) { g.busy = false; draw(); } }
  }
  const actions = {
    'workspace-groups-refresh': async () => {
      const g = state.workspaceGroups;
      if (!g || g.busy) return false;
      const result = await readList(g), pending = pendingWrites.get(JSON.stringify([g.scope, 'create']));
      if (result && pending?.kind === 'create' && g.list.some(group => group.id === pending.id)) { pendingWrites.delete(JSON.stringify([g.scope, 'create'])); g.pending = null; g.notice = '原群聊已在列表中确认'; draw(); }
      return result;
    },
    'workspace-group-open': ({ id }) => select(id),
    'workspace-groups-more': () => state.workspaceGroups?.listPagination?.hasMore ? readList(state.workspaceGroups, { more: true }) : false,
    'workspace-group-refresh': () => readDetail(),
    'workspace-group-history': readHistory,
    'workspace-group-new': beginCreate,
    'workspace-group-create': create,
    'workspace-group-member': ({ id: employeeId }) => {
      const g = state.workspaceGroups;
      if (!g || state.page !== 'workspace-group-new' || g.busy || g.pending || !mobileGroupCandidates(state).some(employee => employee.id === employeeId)) return false;
      if (g.memberIds.includes(employeeId)) g.memberIds = g.memberIds.filter(value => value !== employeeId);
      else if (g.memberIds.length < 6) g.memberIds.push(employeeId);
      draw(); return true;
    },
    'workspace-group-mention': ({ id: employeeId }) => {
      const g = state.workspaceGroups;
      if (!g?.group?.members.some(member => member.employeeId === employeeId) || g.busy || g.pending) return false;
      g.mentions = g.mentions.includes(employeeId) ? g.mentions.filter(value => value !== employeeId) : [...g.mentions, employeeId]; draw(); return true;
    },
    'workspace-group-send': send,
    'workspace-group-cancel': cancel,
    'workspace-group-attachment-retry': () => uploadDraft(),
    'workspace-group-attachment-remove': ({ id: localId }) => {
      const g = state.workspaceGroups;
      if (!g?.draft || g.busy || g.pending || g.draft.uploading) return false;
      releaseDraftAttachments(g.attachments.filter(item => item.localId === localId));
      g.draft.attachments = g.attachments.filter(item => item.localId !== localId); g.attachments = g.draft.attachments;
      if (!g.attachments.length) g.draft.sourceConversationId = ''; draw(); return true;
    },
    'workspace-group-attachment-download': download,
  };
  function change(event) {
    const target = event?.target || event, g = state.workspaceGroups;
    if (!g || g.busy || g.pending || g.draft?.uploading && target.name !== 'workspaceGroupContent') return false;
    if (target.name === 'workspaceGroupFiles') return chooseFiles(g, target);
    if (target.name === 'workspaceGroupTitle') g.title = String(target.value || '');
    else if (target.name === 'workspaceGroupContent') { g.content = String(target.value || ''); if (g.draft) g.draft.content = g.content; }
    else return false;
    draw(); return true;
  }
  return { open, actions, change, poll: () => state.page === 'workspace-group' && !state.workspaceGroups?.busy && workspaceGroupRunning(state.workspaceGroups?.group) ? readDetail() : false,
    reset: ({ clearAccount = false } = {}) => {
      generation++;
      if (clearAccount) for (const key of pendingWrites.keys()) if (JSON.parse(key)[0].startsWith(`${accountId(state)}:`)) pendingWrites.delete(key);
      if (clearAccount) for (const [key, draft] of drafts) if (JSON.parse(key)[0].startsWith(`${accountId(state)}:`)) { releaseDraftAttachments(draft.attachments); drafts.delete(key); }
      state.workspaceGroups = null;
    }, dispose: () => { disposed = true; generation++; pendingWrites.clear(); for (const draft of drafts.values()) releaseDraftAttachments(draft.attachments); drafts.clear(); state.workspaceGroups = null; } };
}
