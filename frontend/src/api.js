import { resolveApiBase } from './api-base.js';

const runtimeOrigin = typeof window === 'undefined' ? '' : window.location.origin;
export const API_BASE = resolveApiBase({
  configured: import.meta.env.VITE_API_URL,
  dev: import.meta.env.DEV,
  origin: runtimeOrigin,
});
const WORKSPACE_KEY = 'ziwei.workspace';
function workspaceSlugFromPathname(pathname = typeof window === 'undefined' ? '' : window.location.pathname) {
  const first = String(pathname || '').split('/').filter(Boolean)[0] || '';
  if (!first || ['invite', 'me', 'api'].includes(first)) return '';
  try { return decodeURIComponent(first).trim(); } catch { return ''; }
}
export function workspaceSlug() {
  // The URL is the navigation authority.  A stale tab-local value must never
  // redirect `/new-workspace/...` API calls back to a previous workspace.
  const fromPath = workspaceSlugFromPathname();
  if (fromPath) return fromPath;
  try {
    const stored = localStorage.getItem(WORKSPACE_KEY);
    if (stored) return stored;
  } catch {}
  return '';
}
export function setWorkspaceSlug(slug) {
  const value = String(slug || '').trim();
  if (!value) return;
  try { localStorage.setItem(WORKSPACE_KEY, value); } catch {}
}
async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, { credentials: 'include', headers: { 'content-type': 'application/json', ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) { window.dispatchEvent(new CustomEvent('ziwei:auth-required')); }
  if (!response.ok) {
    const error = new Error(data.error || (response.status === 413 ? '请求内容超过服务器限制，请选择更小的附件后重试' : `请求失败 ${response.status}`));
    error.status = response.status;
    throw error;
  }
  return data;
}
export const api = {
  authStatus: () => request('/api/auth/status'),
  authSetup: body => request('/api/auth/setup', { method:'POST', body:JSON.stringify(body) }),
  authRegister: body => request('/api/auth/register', { method:'POST', body:JSON.stringify(body) }),
  authLogin: body => request('/api/auth/login', { method:'POST', body:JSON.stringify(body) }),
  authLogout: () => request('/api/auth/logout', { method:'POST', body:'{}' }),
  authMe: () => request('/api/auth/me'),
  workspaces: () => request('/api/workspaces'),
  createWorkspace: body => request('/api/workspaces', { method:'POST', body:JSON.stringify(body) }),
  summary: () => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/summary`),
  tasks: (query = '') => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/tasks${query ? `?${query}` : ''}`),
  createTask: body => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/tasks`, { method: 'POST', body: JSON.stringify(body) }),
  task: id => request(`/api/tasks/${id}`),
  updateTask: (id, body) => request(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  taskMessages: id => request(`/api/tasks/${id}/messages`),
  addTaskMessage: (id, body) => request(`/api/tasks/${id}/messages`, { method: 'POST', body: JSON.stringify(body) }),
  taskAttachments: id => request(`/api/tasks/${id}/attachments`),
  uploadTaskAttachment: (id, body) => request(`/api/tasks/${id}/attachments`, { method:'POST', body:JSON.stringify(body) }),
  deleteTaskAttachment: id => request(`/api/task-attachments/${encodeURIComponent(id)}`, { method:'DELETE' }),
  downloadTaskAttachment: id => `${API_BASE}/api/task-attachments/${encodeURIComponent(id)}/download`,
  changeTaskState: (id, state) => request(`/api/tasks/${id}/state`, { method: 'POST', body: JSON.stringify({ state }) }),
  runtimes: () => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/runtimes`),
  models: (runtime = '', query = '') => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/models?${new URLSearchParams({ ...(runtime ? { runtime } : {}), ...(query ? { q: query } : {}) }).toString()}`),
  skills: (filters = {}) => { const query = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([,value]) => value))); const suffix = query.toString(); return request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/skills${suffix ? `?${suffix}` : ''}`); },
  skillSources: () => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/skill-sources`),
  createSkill: body => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/skills`, { method: 'POST', body: JSON.stringify(body) }),
  importSkill: body => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/skills/import`, { method: 'POST', body: JSON.stringify(body) }),
  copySkill: body => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/skills/copy`, { method: 'POST', body: JSON.stringify(body) }),
  toggleSkill: (id, installed) => request(`/api/skills/${id}`, { method: 'PATCH', body: JSON.stringify({ installed }) }),
  uninstallSkill: id => request(`/api/skills/${id}/uninstall`, { method:'POST', body:'{}' }),
  skillVersions: id => request(`/api/skills/${id}/versions`),
  rollbackSkill: (id, versionId) => request(`/api/skills/${id}/rollback`, { method:'POST', body:JSON.stringify({ versionId }) }),
  documents: () => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/documents`),
  exportDocumentsGit: body => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/documents/git/export`, { method:'POST', body:JSON.stringify(body || {}) }),
  importDocumentsGit: body => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/documents/git/import`, { method:'POST', body:JSON.stringify(body || {}) }),
  documentTrash: () => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/documents/trash`),
  createDocument: body => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/documents`, { method: 'POST', body: JSON.stringify(body) }),
  document: id => request(`/api/documents/${id}`),
  updateDocument: (id, body) => request(`/api/documents/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteDocument: id => request(`/api/documents/${id}`, { method: 'DELETE' }),
  restoreDocument: id => request(`/api/documents/${id}/restore`, { method:'POST', body:'{}' }),
  downloadDocument: id => `${API_BASE}/api/documents/${id}/download`,
  documentVersions: id => request(`/api/documents/${id}/versions`),
  restoreDocumentVersion: (id, version) => request(`/api/documents/${id}/versions/${version}/restore`, { method:'POST', body:'{}' }),
  automations: () => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/automations`),
  automationTemplates: () => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/automation-templates`),
  createAutomation: body => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/automations`, { method: 'POST', body: JSON.stringify(body) }),
  automation: id => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/automations/${id}`),
  updateAutomation: (id, body) => request(`/api/automations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  runAutomation: (id, mode = 'manual') => request(`/api/automations/${id}/run`, { method: 'POST', body: JSON.stringify({ mode }) }),
  automationRuns: id => request(`/api/automations/${id}/runs`),
  webhookDeliveries: id => request(`/api/automation-runs/${id}/webhooks`),
  completeAutomationRun: (id, body) => request(`/api/automation-runs/${id}/result`, { method:'POST', body:JSON.stringify(body) }),
  deleteAutomation: id => request(`/api/automations/${id}`, { method: 'DELETE' }),
  members: () => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/members`),
  addMember: body => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/members`, { method: 'POST', body: JSON.stringify(body) }),
  updateMember: (id, body) => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/members/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteMember: id => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/members/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  invitations: () => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/invitations`),
  createInvitation: body => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/invitations`, { method: 'POST', body: JSON.stringify(body) }),
  resendInvitation: id => request(`/api/invitations/${id}/resend`, { method: 'POST', body: '{}' }),
  revokeInvitation: id => request(`/api/invitations/${id}/revoke`, { method: 'POST', body: '{}' }),
  lookupInvitation: code => request(`/api/invitations/lookup/${encodeURIComponent(code)}`),
  acceptInvitation: (code, body) => request(`/api/invitations/${encodeURIComponent(code)}/accept`, { method:'POST', body: JSON.stringify(body || {}) }),
  devices: () => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/devices`),
  createDevicePairing: body => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/devices/pairing`, { method: 'POST', body: JSON.stringify(body || {}) }),
  addDevice: body => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/devices`, { method: 'POST', body: JSON.stringify(body) }),
  updateDevice: (id, body) => request(`/api/devices/${encodeURIComponent(id)}`, { method:'PATCH', body:JSON.stringify(body) }),
  disableDevice: id => request(`/api/devices/${encodeURIComponent(id)}/disable`, { method:'POST', body:'{}' }),
  enableDevice: id => request(`/api/devices/${encodeURIComponent(id)}/enable`, { method:'POST', body:'{}' }),
  deleteDevice: id => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/devices/${encodeURIComponent(id)}`, { method:'DELETE' }),
  employees: () => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/employees`),
  createEmployee: body => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/employees`, { method: 'POST', body: JSON.stringify(body) }),
  updateEmployee: (id, body) => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/employees/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  employeeEnvironment: id => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/employees/${encodeURIComponent(id)}/environment`),
  saveEmployeeEnvironment: (id, body) => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/employees/${encodeURIComponent(id)}/environment`, { method:'POST', body:JSON.stringify(body) }),
  updateEmployeeEnvironment: (id, key, body) => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/employees/${encodeURIComponent(id)}/environment/${encodeURIComponent(key)}`, { method:'PATCH', body:JSON.stringify(body) }),
  deleteEmployeeEnvironment: (id, key) => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/employees/${encodeURIComponent(id)}/environment/${encodeURIComponent(key)}`, { method:'DELETE' }),
  employeeCustomParams: id => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/employees/${encodeURIComponent(id)}/custom-params`),
  saveEmployeeCustomParams: (id, values) => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/employees/${encodeURIComponent(id)}/custom-params`, { method:'PUT', body:JSON.stringify({ values }) }),
  employeeMcp: () => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/mcp/status`),
  employeeMcpHealth: () => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/mcp/status`),
  ziweiConnectStatus: () => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/ziwei-connect/status`),
  ziweiConnectDevices: () => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/ziwei-connect/devices`),
  ziweiConnectBindings: () => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/ziwei-connect/bindings`),
  ziweiConnectBind: body => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/ziwei-connect/bindings`, { method:'POST', body:JSON.stringify(body) }),
  ziweiConnectRuns: (limit = 50) => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/ziwei-connect/runs?limit=${encodeURIComponent(limit)}`),
  ziweiConnectRun: id => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/ziwei-connect/runs/${encodeURIComponent(id)}`),
  ziweiConnectAction: body => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/ziwei-connect/actions`, { method:'POST', body:JSON.stringify(body) }),
  hermesProfiles: (deviceId = '') => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/hermes/profiles${deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : ''}`),
  createHermesProfile: (body, idempotencyKey = '') => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/hermes/profiles/requests`, { method:'POST', body:JSON.stringify({ ...(body || {}), ...(idempotencyKey ? { idempotencyKey } : {}) }) }),
  hermesProfileAction: id => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/hermes/profiles/requests/${encodeURIComponent(id)}`),
  deleteEmployee: id => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/employees/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  calendar: () => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/calendar`),
  calendarEvents: () => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/calendar/events`),
  createCalendarEvent: body => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/calendar/events`, { method:'POST', body:JSON.stringify(body) }),
  calendarEvent: id => request(`/api/calendar-events/${encodeURIComponent(id)}`),
  updateCalendarEvent: (id, body) => request(`/api/calendar-events/${encodeURIComponent(id)}`, { method:'PATCH', body:JSON.stringify(body) }),
  deleteCalendarEvent: id => request(`/api/calendar-events/${encodeURIComponent(id)}`, { method:'DELETE' }),
  settings: () => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/settings`),
  permissions: () => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/permissions`),
  saveSettings: body => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/settings`, { method: 'PATCH', body: JSON.stringify(body) }),
  apiKeys: () => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/api-keys`),
  createApiKey: body => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/api-keys`, { method:'POST', body: JSON.stringify(body) }),
  revokeApiKey: id => request(`/api/api-keys/${id}/revoke`, { method:'POST', body:'{}' }),
  rotateApiKey: (id, body = {}) => request(`/api/api-keys/${id}/rotate`, { method:'POST', body:JSON.stringify(body) }),
  updateProfile: body => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/profile`, { method:'PATCH', body:JSON.stringify(body) }),
  updatePreferences: body => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/preferences`, { method:'PATCH', body:JSON.stringify(body) }),
  agents: () => request('/a2a/v1/agents'),
  notifications: (query = '') => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/notifications${query ? `?${query}` : ''}`),
  markNotificationsRead: ids => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/notifications/read`, { method:'POST', body:JSON.stringify(ids ? {ids} : {}) }),
  archiveNotification: (id, archived = true) => request(`/api/notifications/${id}/archive`, { method:'POST', body:JSON.stringify({archived}) }),
  conversations: (employeeId = '') => {
    const query = employeeId ? `?employeeId=${encodeURIComponent(employeeId)}` : '';
    return request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/conversations${query}`);
  },
  createConversation: body => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/conversations`, { method:'POST', body:JSON.stringify(body) }),
  updateConversation: (id, body) => request(`/api/conversations/${encodeURIComponent(id)}`, { method:'PATCH', body:JSON.stringify(body) }),
  conversation: id => request(`/api/conversations/${id}`),
  inspectConversationDirectory: (id, body = {}) => request(`/api/conversations/${encodeURIComponent(id)}/workdir/inspect`, { method:'POST', body:JSON.stringify(body) }),
  conversationDirectoryAction: (id, actionId) => request(`/api/conversations/${encodeURIComponent(id)}/workdir/actions/${encodeURIComponent(actionId)}`),
  addConversationMessage: (id, body) => request(`/api/conversations/${id}/messages`, { method:'POST', body:JSON.stringify(body) }),
  archiveConversation: (id, archived = true) => request(`/api/conversations/${id}/archive`, { method:'POST', body:JSON.stringify({archived}) }),
  streamUrl: () => `${API_BASE}/api/workspaces/${encodeURIComponent(workspaceSlug())}/notifications/stream`,
  websocketUrl: () => `${API_BASE.replace(/^http/i, 'ws')}/api/workspaces/${encodeURIComponent(workspaceSlug())}/notifications/ws`
};
