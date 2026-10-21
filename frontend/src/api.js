import { resolveApiBase } from './api-base.js';
import { boundedRead } from './bounded-read.js';

const runtimeOrigin = typeof window === 'undefined' ? '' : window.location.origin;
export const API_BASE = resolveApiBase({
  configured: import.meta.env.VITE_API_URL,
  dev: import.meta.env.DEV,
  origin: runtimeOrigin,
});
const WORKSPACE_KEY = 'ziwei.workspace';
function workspaceSlugFromPathname(pathname = typeof window === 'undefined' ? '' : window.location.pathname) {
  const first = String(pathname || '').split('/').filter(Boolean)[0] || '';
  if (!first || ['invite', 'me', 'api', 'android-install'].includes(first)) return '';
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
  if(options.signal?.aborted)throw options.signal.reason || new DOMException('读取已取消','AbortError');
  const data = await response.json().catch(() => ({}));
  if(options.signal?.aborted)throw options.signal.reason || new DOMException('读取已取消','AbortError');
  if (response.status === 401) { window.dispatchEvent(new CustomEvent('ziwei:auth-required')); }
  if (!response.ok) {
    const error = new Error(data.error || (response.status === 413 ? '请求内容超过服务器限制，请选择更小的附件后重试' : `请求失败 ${response.status}`));
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data;
}
function boundedRequest(path,options){return boundedRead(signal=>request(path,{signal}),options);}
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
  clientUpdates: (slug = workspaceSlug(), options) => boundedRequest(`/api/workspaces/${encodeURIComponent(slug)}/client-updates`, options),
  updateClient: (deviceId, body, slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/devices/${encodeURIComponent(deviceId)}/client-updates`, { method:'POST', body:JSON.stringify(body) }),
  cancelClientUpdate: (deviceId, requestId, slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/devices/${encodeURIComponent(deviceId)}/client-updates/${encodeURIComponent(requestId)}/cancel`, { method:'POST', body:'{}' }),
  createDevicePairing: body => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/devices/pairing`, { method: 'POST', body: JSON.stringify(body || {}) }),
  addDevice: body => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/devices`, { method: 'POST', body: JSON.stringify(body) }),
  updateDevice: (id, body) => request(`/api/devices/${encodeURIComponent(id)}`, { method:'PATCH', body:JSON.stringify(body) }),
  disableDevice: id => request(`/api/devices/${encodeURIComponent(id)}/disable`, { method:'POST', body:'{}' }),
  enableDevice: id => request(`/api/devices/${encodeURIComponent(id)}/enable`, { method:'POST', body:'{}' }),
  deleteDevice: id => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/devices/${encodeURIComponent(id)}`, { method:'DELETE' }),
  employees: () => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/employees`),
  bots: (slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/bots?view=roster`),
  bot: (id, slug = workspaceSlug(), options = {}) => boundedRequest(`/api/workspaces/${encodeURIComponent(slug)}/bots/${encodeURIComponent(id)}`,options),
  botWorkbench: (id, slug = workspaceSlug(), options = {}) => boundedRequest(`/api/workspaces/${encodeURIComponent(slug)}/bots/${encodeURIComponent(id)}?view=workbench`,options),
  botCapabilities: (deviceId = '', slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/bots/capabilities${deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : ''}`),
  createBot: (body, slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/bots`, {method:'POST',body:JSON.stringify(body)}),
  provisionBot: (id, body, slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/bots/${encodeURIComponent(id)}/provision`, {method:'POST',body:JSON.stringify(body)}),
  initializeEmployeeBot: (id, body, slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/employees/${encodeURIComponent(id)}/bot`, {method:'POST',body:JSON.stringify(body)}),
  updateBot: (id, body, slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/bots/${encodeURIComponent(id)}`, {method:'PATCH',body:JSON.stringify(body)}),
  validateBot: (id, body, slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/bots/${encodeURIComponent(id)}/validate`, {method:'POST',body:JSON.stringify(body)}),
  controlBot: (id, body, slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/bots/${encodeURIComponent(id)}/control`, {method:'POST',body:JSON.stringify(body)}),
  reconcileBotAction: (id, actionId, body, slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/bots/${encodeURIComponent(id)}/actions/${encodeURIComponent(actionId)}/reconcile`, {method:'POST',body:JSON.stringify(body)}),
  botForceAbandonStatus: (id, slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/bots/${encodeURIComponent(id)}/force-abandon`),
  forceAbandonBot: (id, body, slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/bots/${encodeURIComponent(id)}/force-abandon`, {method:'POST',body:JSON.stringify(body)}),
  botRuns: (id, slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/bots/${encodeURIComponent(id)}/runs`),
  botNativeAction: (id, body, slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/bots/${encodeURIComponent(id)}/native/actions`, {method:'POST',body:JSON.stringify(body)}),
  botMcpConnections: (id, slug = workspaceSlug(), options = {}) => boundedRequest(`/api/workspaces/${encodeURIComponent(slug)}/bots/${encodeURIComponent(id)}/mcp/connections`,options),
  connectBotMcp: (id, body, slug = workspaceSlug(), options = {}) => request(`/api/workspaces/${encodeURIComponent(slug)}/bots/${encodeURIComponent(id)}/mcp/connections`, {method:'POST',body:JSON.stringify(body),signal:options.signal}),
  cancelBotMcpConnection: (id, actionId, slug = workspaceSlug(), options = {}) => request(`/api/workspaces/${encodeURIComponent(slug)}/bots/${encodeURIComponent(id)}/mcp/connections/${encodeURIComponent(actionId)}`, {method:'DELETE',signal:options.signal}),
  collaborateBot: (id, body, slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/bots/${encodeURIComponent(id)}/collaboration`, {method:'POST',body:JSON.stringify(body)}),
  botRoutines: (id, slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/bots/${encodeURIComponent(id)}/routines`),
  createBotRoutine: (id, body, slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/bots/${encodeURIComponent(id)}/routines`, {method:'POST',body:JSON.stringify(body)}),
  updateBotRoutine: (id, routineId, body, slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/bots/${encodeURIComponent(id)}/routines/${encodeURIComponent(routineId)}`, {method:'PATCH',body:JSON.stringify(body)}),
  deleteBotRoutine: (id, routineId, slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/bots/${encodeURIComponent(id)}/routines/${encodeURIComponent(routineId)}`, {method:'DELETE'}),
  runBotRoutine: (id, routineId, body, slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/bots/${encodeURIComponent(id)}/routines/${encodeURIComponent(routineId)}/run`, {method:'POST',body:JSON.stringify(body)}),
  createEmployee: (body, slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/employees`, { method: 'POST', body: JSON.stringify(body) }),
  updateEmployee: (id, body, slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/employees/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  inspectDeviceDirectory: (deviceId, body = {}, slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/devices/${encodeURIComponent(deviceId)}/workdir/inspect`, { method:'POST', body:JSON.stringify(body) }),
  deviceDirectoryAction: (deviceId, actionId, slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/devices/${encodeURIComponent(deviceId)}/workdir/actions/${encodeURIComponent(actionId)}`),
  employeeEnvironment: id => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/employees/${encodeURIComponent(id)}/environment`),
  saveEmployeeEnvironment: (id, body) => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/employees/${encodeURIComponent(id)}/environment`, { method:'POST', body:JSON.stringify(body) }),
  updateEmployeeEnvironment: (id, key, body) => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/employees/${encodeURIComponent(id)}/environment/${encodeURIComponent(key)}`, { method:'PATCH', body:JSON.stringify(body) }),
  deleteEmployeeEnvironment: (id, key) => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/employees/${encodeURIComponent(id)}/environment/${encodeURIComponent(key)}`, { method:'DELETE' }),
  employeeCustomParams: id => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/employees/${encodeURIComponent(id)}/custom-params`),
  saveEmployeeCustomParams: (id, values) => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/employees/${encodeURIComponent(id)}/custom-params`, { method:'PUT', body:JSON.stringify({ values }) }),
  employeeMcp: (slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/mcp/status`),
  employeeTemplates: (slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/employee-templates`),
  createEmployeeTemplateInstance: (id, body = {}, slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/employee-templates/${encodeURIComponent(id)}/instances`, {method:'POST',body:JSON.stringify(body)}),
  employeeMcpHealth: (slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/mcp/status`),
  managementMcpDiscovery: (slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/mcp/discovery`),
  employeeMcpStatus: (id, slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/employees/${encodeURIComponent(id)}/mcp/status`),
  retryManagementMcp: (deviceId, slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/mcp/retry`, { method:'POST', body:JSON.stringify({ deviceId }) }),
  phoneMcpSetup: (slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/phone-mcp/setup`),
  phoneMcpStatus: (id, slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/employees/${encodeURIComponent(id)}/phone-mcp/status`),
  savePhoneMcp: (id, body, slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/employees/${encodeURIComponent(id)}/phone-mcp`, { method:'PUT', body:JSON.stringify(body) }),
  checkPhoneMcp: (id, slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/employees/${encodeURIComponent(id)}/phone-mcp/check`, { method:'POST', body:'{}' }),
  trialPhoneMcp: (id, body, slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/employees/${encodeURIComponent(id)}/phone-mcp/trial`, { method:'POST', body:JSON.stringify(body) }),
  phoneMcpAction: (id, slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/phone-mcp/actions/${encodeURIComponent(id)}`),
  deviceWorkspaceGrants: (slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/device-workspace-grants`),
  grantDeviceWorkspace: (body, slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/device-workspace-grants`, { method:'POST', body:JSON.stringify(body) }),
  ziweiConnectStatus: () => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/ziwei-connect/status`),
  ziweiConnectDevices: () => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/ziwei-connect/devices`),
  ziweiConnectBindings: () => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/ziwei-connect/bindings`),
  ziweiConnectBind: body => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/ziwei-connect/bindings`, { method:'POST', body:JSON.stringify(body) }),
  ziweiConnectDeleteBinding: id => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/ziwei-connect/bindings/${encodeURIComponent(id)}`, { method:'DELETE' }),
  ziweiConnectRuns: (limit = 50) => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/ziwei-connect/runs?limit=${encodeURIComponent(limit)}`),
  ziweiConnectRun: id => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/ziwei-connect/runs/${encodeURIComponent(id)}`),
  ziweiConnectAction: body => request(`/api/workspaces/${encodeURIComponent(workspaceSlug())}/ziwei-connect/actions`, { method:'POST', body:JSON.stringify(body) }),
  hermesProfiles: (deviceId = '', slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/hermes/profiles${deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : ''}`),
  createHermesProfile: (body, idempotencyKey = '', slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/hermes/profiles/requests`, { method:'POST', body:JSON.stringify({ ...(body || {}), ...(idempotencyKey ? { idempotencyKey } : {}) }) }),
  hermesProfileAction: (id, slug = workspaceSlug()) => request(`/api/workspaces/${encodeURIComponent(slug)}/hermes/profiles/requests/${encodeURIComponent(id)}`),
  deleteEmployee: (id, slug = workspaceSlug(), options = {}) => request(`/api/workspaces/${encodeURIComponent(slug)}/employees/${encodeURIComponent(id)}`, { method: 'DELETE', ...(options.force===true?{body:JSON.stringify({force:true})}:{}) }),
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
  conversation: (id, options = {}) => boundedRequest(`/api/conversations/${id}`,options),
  forwardConversation: (id, body) => request(`/api/conversations/${encodeURIComponent(id)}/forwards`, { method:'POST', body:JSON.stringify(body) }),
  markConversationRead: (id, messageId) => request(`/api/conversations/${encodeURIComponent(id)}/read`, { method:'POST', body:JSON.stringify({messageId}) }),
  inspectConversationDirectory: (id, body = {}) => request(`/api/conversations/${encodeURIComponent(id)}/workdir/inspect`, { method:'POST', body:JSON.stringify(body) }),
  conversationDirectoryAction: (id, actionId) => request(`/api/conversations/${encodeURIComponent(id)}/workdir/actions/${encodeURIComponent(actionId)}`),
  addConversationMessage: (id, body) => request(`/api/conversations/${id}/messages`, { method:'POST', body:JSON.stringify(body) }),
  archiveConversation: (id, archived = true) => request(`/api/conversations/${id}/archive`, { method:'POST', body:JSON.stringify({archived}) }),
  streamUrl: () => `${API_BASE}/api/workspaces/${encodeURIComponent(workspaceSlug())}/notifications/stream`,
  websocketUrl: () => `${API_BASE.replace(/^http/i, 'ws')}/api/workspaces/${encodeURIComponent(workspaceSlug())}/notifications/ws`
};
