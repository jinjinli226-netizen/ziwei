import express from 'express';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { createRepository } from './repository.mjs';
import { RealtimeHub } from './realtime.mjs';
import { exportDocumentsToGit, importDocumentsFromGit } from './git-sync.mjs';
import { createAuthService } from './auth.mjs';
import { readA2AToken, safeTokenEqual, tokenFromRequest } from './a2a-auth.mjs';
import { mcpTokenRequired, readMCPCredential, mcpWorkspaceAllowed } from './mcp-auth.mjs';

const allowedOrigin = process.env.FRONTEND_ORIGIN || 'http://127.0.0.1:5178';

function cors(req, res, next) {
  const origin = req.headers.origin;
  if (origin === allowedOrigin || !origin) res.setHeader('Access-Control-Allow-Origin', origin || allowedOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Workspace-Id, X-Workspace-Role, X-Ziwei-Api-Key, X-Ziwei-Mcp-Token');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}

function apiKeyRequired(repo) {
  return (req, res, next) => {
    const authorization = String(req.headers.authorization || '');
    const token = authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7) : req.headers['x-ziwei-api-key'];
    const key = repo.verifyApiKey(token);
    if (!key) return res.status(401).json({ error: '需要有效的 Ziwei API Key' });
    req.apiKey = key; req.workspaceRole = key.role || 'member';
    next();
  };
}

function requireRole(...allowed) {
  return (req, res, next) => {
    // API keys carry an immutable role. A caller must not be able to elevate
    // one by also sending X-Workspace-Role; first-party session requests may
    // use the header because the local UI has no session middleware yet.
    const headerRole = String(req.headers['x-workspace-role'] || '').toLowerCase();
    const role = String(req.apiKey ? req.workspaceRole : (req.auth?.role || req.workspaceRole || (req.auth ? '' : headerRole) || 'owner')).toLowerCase();
    if (!allowed.includes(role)) return res.status(403).json({ error: '当前角色没有执行该操作的权限', role, required: allowed });
    req.workspaceRole = role; next();
  };
}

const READ_ROLES = ['owner', 'admin', 'member'];
const WRITE_ROLES = ['owner', 'admin', 'member'];
const MANAGE_ROLES = ['owner', 'admin'];
function resourceRoleGuard(req, res, next) {
  const path = req.path || '';
  if (path.startsWith('/auth') || path.startsWith('/external/') || path.startsWith('/daemon/') || path.startsWith('/invitations/lookup/') || path.endsWith('/accept') || path === '/devices/heartbeat' || path.endsWith('/heartbeat')) return next();
  const sensitiveAdminPath = /(?:settings|api-keys|members|invitations|devices)(?:\/|$)/i.test(path);
  const adminReadPath = /(?:settings|api-keys)(?:\/|$)/i.test(path);
  const allowed = adminReadPath || (req.method !== 'GET' && req.method !== 'HEAD' && sensitiveAdminPath) ? MANAGE_ROLES : (req.method === 'GET' || req.method === 'HEAD' ? READ_ROLES : WRITE_ROLES);
  return requireRole(...allowed)(req, res, next);
}

function authExempt(pathname) {
  return pathname === '/auth' || pathname.startsWith('/auth/') || pathname.startsWith('/external/')
    || pathname.startsWith('/daemon/') || pathname === '/devices/heartbeat' || pathname.endsWith('/heartbeat') || pathname.endsWith('/runtimes/register');
}

function a2aAuth({ bypass = false, allowAgentCard = true } = {}) {
  return (req, res, next) => {
    // Memory-mode test servers and explicitly disabled-auth instances keep the
    // original local contract. Production A2A calls must carry the machine
    // credential used by ziwei_user.
    if (bypass || (allowAgentCard && req.method === 'GET' && req.path === '/agents')) return next();
    const expected = readA2AToken({ create: true });
    const supplied = tokenFromRequest(req);
    if (!safeTokenEqual(supplied, expected)) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="ziwei-a2a"');
      return res.status(401).json({ error: '需要有效的 A2A 连接令牌' });
    }
    req.a2aAuthenticated = true;
    next();
  };
}

function sessionMiddleware(auth, { bypass = false } = {}) {
  return (req, res, next) => {
    if (bypass || authExempt(req.path || '')) return next();
    const principal = auth.authenticate(req);
    if (!principal) return res.status(401).json({ error: '请先登录紫薇' });
    req.auth = principal;
    next();
  };
}

function workspaceMembershipGuard(auth, { bypass = false } = {}) {
  return (req, res, next) => {
    if (bypass || authExempt(req.path || '') || req.path.endsWith('/heartbeat')) return next();
    const slug = String(req.params.slug || '').trim();
    if (!slug || !req.auth) return next();
    const membership = auth.canAccess(req.auth.user_id, slug);
    if (!membership) return res.status(403).json({ error: '当前用户不属于该工作区' });
    req.workspaceRole = membership.role;
    req.auth = { ...req.auth, workspace: { slug, role: membership.role }, role: membership.role };
    next();
  };
}

function resourceWorkspaceGuard(repo, auth, { bypass = false } = {}) {
  const directResources = {
    tasks: 'tasks', documents: 'documents', skills: 'skills', automations: 'automations',
    'automation-runs': 'automation_runs', 'calendar-events': 'calendar_events', devices: 'devices', employees: 'employees',
    notifications: 'notifications', conversations: 'conversations', 'api-keys': 'api_keys', invitations: 'invitations', members: 'members'
  };
  return (req, res, next) => {
    if (bypass || authExempt(req.path || '') || !req.auth) return next();
    const match = String(req.path || '').match(/^\/(tasks|task-attachments|documents|skills|automations|automation-runs|calendar-events|devices|employees|notifications|conversations|api-keys|invitations|members)\/([^/]+)/i);
    if (!match) return next();
    const [, resource, resourceId] = match;
    let row;
    if (resource === 'task-attachments') row = repo.db.prepare('SELECT t.workspace_id FROM task_attachments a JOIN tasks t ON t.id=a.task_id WHERE a.id=?').get(resourceId);
    else row = repo.db.prepare(`SELECT workspace_id FROM ${directResources[resource]} WHERE id=?`).get(resourceId);
    if (!row) return next();
    const membership = repo.db.prepare('SELECT m.role FROM members m WHERE m.user_id=? AND m.workspace_id=?').get(req.auth.user_id, row.workspace_id);
    if (!membership) return res.status(403).json({ error: '当前用户无权访问该资源' });
    req.workspaceRole = membership.role;
    next();
  };
}

function assertApiKeyWorkspace(req, res, next) {
  const slug = String(req.params.slug || '').trim();
  if (!slug || !req.apiKey) return next();
  const workspace = req.app.locals.repo.getWorkspace?.(slug);
  if (workspace && workspace.id !== req.apiKey.workspace_id) return res.status(403).json({ error: 'API Key 不属于该工作区' });
  // Repositories from older test adapters do not expose getWorkspace; use
  // their public summary as a safe binding check instead of trusting the URL.
  try {
    const summary = req.app.locals.repo.getSummary(slug);
    if (summary.workspace?.id !== req.apiKey.workspace_id) return res.status(403).json({ error: 'API Key 不属于该工作区' });
  } catch (error) { return res.status(/not found/i.test(error.message || '') ? 404 : 403).json({ error: 'API Key 工作区无效' }); }
  next();
}

export function createApp(options = {}) {
  const app = express();
  const realtime = new RealtimeHub();
  const repo = options.repository || createRepository({ ...options, onEvent: event => realtime.publish(event) });
  const auth = options.auth || createAuthService(repo.db, options.authOptions);
  app.locals.repo = repo;
  app.locals.realtime = realtime;
  app.locals.auth = auth;
  app.use(cors);
  // Task attachments are sent as Base64 JSON; allow the 10 MiB attachment
  // limit plus encoding and envelope overhead without accepting unbounded
  // request bodies.
  app.use(express.json({ limit: '16mb' }));
  const authBypass = options.memory === true || options.requireAuth === false;
  app.locals.authBypass = authBypass;
  app.locals.a2aToken = () => readA2AToken({ create: !authBypass });
  app.use('/api', sessionMiddleware(auth, { bypass: authBypass }));
  app.use('/api/workspaces/:slug', workspaceMembershipGuard(auth, { bypass: authBypass }));
  app.use('/api', resourceWorkspaceGuard(repo, auth, { bypass: authBypass }));
  // Keep one policy for workspace resources. Individual routes retain their
  // explicit guards as documentation, while this catch-all covers newly added
  // sensitive routes and id-based mutations consistently.
  app.use('/api', resourceRoleGuard);
  app.get('/api/auth/status', (req, res) => res.json(auth.status(req)));
  app.post('/api/auth/setup', (req, res, next) => {
    try {
      const result = auth.setup(req.body || {});
      auth.setCookie(res, result.session);
      const { session: _session, ...safe } = result;
      res.status(201).json({ ...safe, session: { expires_at: result.session.expires_at } });
    } catch (error) { next(error); }
  });
  app.post('/api/auth/login', (req, res, next) => {
    try {
      const result = auth.login(req.body || {});
      auth.setCookie(res, result.session);
      const { session: _session, ...safe } = result;
      res.json({ ...safe, session: { expires_at: result.session.expires_at } });
    } catch (error) { next(error); }
  });
  app.post('/api/auth/logout', (req, res) => { auth.logout(req); auth.clearCookie(res); res.json({ ok: true }); });
  app.get('/api/auth/me', (req, res) => { const principal = auth.authenticate(req); if (!principal) return res.status(401).json({ error: '请先登录紫薇' }); res.json(principal); });
  app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'ziwei-api', cli: 'ziwei_user', time: new Date().toISOString() }));
  app.get('/api/workspaces', (req, res) => {
    const principal = req.auth || auth.authenticate(req);
    if (!principal) return res.status(401).json({ error: '请先登录紫薇' });
    res.json({ workspaces: principal.memberships || [] });
  });
  app.post('/api/workspaces', (req, res, next) => {
    try {
      const principal = req.auth || auth.authenticate(req);
      if (!principal?.user_id) return res.status(401).json({ error: '请先登录紫薇' });
      res.status(201).json(auth.createWorkspace(principal.user_id, req.body || {}));
    } catch (error) { next(error); }
  });
  // The scheduler is repository backed: every workspace is scanned from its
  // durable next_run value, and webhook retries are drained in the same tick.
  const scheduler = options.memory || options.enableScheduler === false ? null : setInterval(() => { try { repo.tickAutomations(); } catch {} }, Number(process.env.ZIWEI_SCHEDULER_MS || 15000));
  scheduler?.unref?.();

  app.get('/api/workspaces/:slug/summary', (req, res) => res.json(repo.getSummary(req.params.slug)));
  app.get('/api/workspaces/:slug/tasks', (req, res) => res.json({ tasks: repo.listTasks(req.params.slug, req.query) }));
  app.post('/api/workspaces/:slug/tasks', (req, res) => res.status(201).json(repo.createTask(req.params.slug, req.body)));
  app.patch('/api/tasks/:id', (req, res) => res.json(repo.updateTask(req.params.id, req.body)));
  app.post('/api/tasks/:id/state', (req, res) => res.json(repo.transitionTask(req.params.id, req.body.state)));
  app.get('/api/tasks/:id', (req, res) => { const task = repo.getTask(req.params.id); if (!task) return res.status(404).json({error:'Task not found'}); res.json({...task, messages:repo.getTaskMessages(req.params.id)}); });
  app.get('/api/tasks/:id/messages', (req, res) => { const task = repo.getTask(req.params.id); if (!task) return res.status(404).json({error:'Task not found'}); res.json({messages:repo.getTaskMessages(req.params.id)}); });
  app.post('/api/tasks/:id/messages', (req, res) => res.status(201).json(repo.addTaskMessage(req.params.id, req.body)));
  app.get('/api/tasks/:id/attachments', (req, res) => res.json({ attachments: repo.listTaskAttachments(req.params.id) }));
  app.post('/api/tasks/:id/attachments', (req, res) => res.status(201).json(repo.createTaskAttachment(req.params.id, req.body || {})));
  app.get('/api/task-attachments/:id/download', (req, res) => { const attachment = repo.getTaskAttachment(req.params.id); if (!attachment) return res.status(404).json({ error:'Attachment not found' }); res.setHeader('Content-Type', attachment.mime_type || 'application/octet-stream'); res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(attachment.name)}`); res.end(Buffer.from(attachment.content, 'base64')); });
  app.delete('/api/task-attachments/:id', (req, res) => res.json({ ok:true, attachment:repo.deleteTaskAttachment(req.params.id) }));
  // Nested aliases are convenient for clients that keep attachment URLs under
  // a task resource; the id-only forms above remain stable for downloads.
  app.get('/api/tasks/:taskId/attachments/:attachmentId/download', (req, res) => { const attachment = repo.getTaskAttachment(req.params.attachmentId); if (!attachment || attachment.task_id !== req.params.taskId) return res.status(404).json({ error:'Attachment not found' }); res.setHeader('Content-Type', attachment.mime_type || 'application/octet-stream'); res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(attachment.name)}`); res.end(Buffer.from(attachment.content, 'base64')); });
  app.delete('/api/tasks/:taskId/attachments/:attachmentId', (req, res) => { const attachment = repo.getTaskAttachment(req.params.attachmentId); if (!attachment || attachment.task_id !== req.params.taskId) return res.status(404).json({ error:'Attachment not found' }); return res.json({ ok:true, attachment:repo.deleteTaskAttachment(req.params.attachmentId) }); });

  app.get('/api/workspaces/:slug/runtimes', (req, res) => res.json({ runtimes: repo.listRuntimes(req.params.slug) }));
  // ziwei_user reports the exact CLI path/version it discovered locally.
  // This endpoint is intentionally heartbeat-equivalent and is only exposed
  // on the local API; it does not accept an Aura bridge identity.
  app.post('/api/workspaces/:slug/runtimes/register', (req, res) => {
    if (req.body?.agentId && String(req.body.agentId) !== 'ziwei_user') return res.status(403).json({ error: 'Only ziwei_user runtime registration is accepted' });
    res.json({ runtimes: repo.registerRuntimes(req.params.slug, req.body || {}) });
  });
  app.get('/api/workspaces/:slug/models', (req, res) => res.json({ models: repo.listModels(req.params.slug, { runtime: req.query.runtime, q: req.query.q }) }));
  app.get('/api/workspaces/:slug/skills', (req, res) => res.json({ skills: repo.listSkills(req.params.slug, { category: req.query.category, scope: req.query.scope, q: req.query.q }) }));
  app.get('/api/workspaces/:slug/skill-sources', (req, res) => res.json({ sources: repo.listSkillSources(req.params.slug) }));
  app.post('/api/workspaces/:slug/skills', requireRole('owner','admin','member'), (req, res) => res.status(201).json(repo.createSkill(req.params.slug, req.body)));
  app.post('/api/workspaces/:slug/skills/import', requireRole('owner','admin','member'), async (req, res, next) => {
    try {
      const result = await repo.importSkill(req.params.slug, req.body || {});
      res.status(result.duplicate ? 200 : 201).json(result);
    } catch (error) { next(error); }
  });
  app.post('/api/workspaces/:slug/skills/copy', requireRole('owner','admin','member'), async (req, res, next) => {
    try {
      const result = await repo.copySkill(req.params.slug, req.body || {});
      res.status(result.duplicate ? 200 : 201).json(result);
    } catch (error) { next(error); }
  });
  app.patch('/api/skills/:id', (req, res) => res.json(repo.setSkillInstalled(req.params.id, Boolean(req.body.installed))));
  app.post('/api/skills/:id/uninstall', (req, res) => res.json(repo.uninstallSkill(req.params.id)));
  app.get('/api/skills/:id/versions', (req, res) => res.json({ versions: repo.listSkillVersions(req.params.id) }));
  app.post('/api/skills/:id/rollback', (req, res) => res.json(repo.rollbackSkill(req.params.id, req.body?.versionId || req.body?.version_id)));
  app.get('/api/workspaces/:slug/documents', (req, res) => res.json({ documents: repo.listDocuments(req.params.slug) }));
  app.get('/api/workspaces/:slug/documents/trash', (req, res) => res.json({ documents: repo.listDocumentTrash(req.params.slug) }));
  app.post('/api/workspaces/:slug/documents/git/export', requireRole('owner','admin'), (req, res, next) => { try { res.json(exportDocumentsToGit(repo, req.params.slug, req.body?.name || req.params.slug, { message: req.body?.message })); } catch (error) { next(error); } });
  app.post('/api/workspaces/:slug/documents/git/import', requireRole('owner','admin'), (req, res, next) => { try { res.json(importDocumentsFromGit(repo, req.params.slug, req.body?.name || req.params.slug)); } catch (error) { next(error); } });
  app.post('/api/workspaces/:slug/documents', (req, res) => res.status(201).json(repo.createDocument(req.params.slug, req.body)));
  app.get('/api/documents/:id', (req, res) => { const document = repo.getDocument(req.params.id); if (!document) return res.status(404).json({ error: 'Document not found' }); res.json(document); });
  app.get('/api/documents/:id/download', (req, res) => { const document = repo.downloadDocument(req.params.id); if (document.content_encoding === 'base64') { res.setHeader('Content-Type', document.mime_type); res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(document.name)}`); return res.end(Buffer.from(document.content, 'base64')); } res.setHeader('Content-Type', document.mime_type || 'text/plain'); res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(document.name)}`); res.send(document.content); });
  app.patch('/api/documents/:id', (req, res) => res.json(repo.updateDocument(req.params.id, req.body)));
  app.get('/api/documents/:id/versions', (req, res) => res.json({ versions: repo.listDocumentVersions(req.params.id) }));
  app.post('/api/documents/:id/versions/:version/restore', (req, res) => res.json(repo.restoreDocumentVersion(req.params.id, req.params.version)));
  app.delete('/api/documents/:id', (req, res) => res.json({ ok: true, document: repo.deleteDocument(req.params.id) }));
  app.post('/api/documents/:id/restore', (req, res) => res.json(repo.restoreDocument(req.params.id)));
  app.get('/api/workspaces/:slug/automations', (req, res) => res.json({ automations: repo.listAutomations(req.params.slug) }));
  app.get('/api/workspaces/:slug/automation-templates', (_req, res) => res.json({ templates: repo.listAutomationTemplates() }));
  app.post('/api/workspaces/:slug/automations', (req, res) => res.status(201).json(repo.createAutomation(req.params.slug, req.body)));
  app.get('/api/workspaces/:slug/automations/:id', (req, res) => { const automation = repo.getAutomation(req.params.slug, req.params.id); if (!automation) return res.status(404).json({ error:'Automation not found' }); res.json(automation); });
  app.patch('/api/automations/:id', (req, res) => res.json(repo.updateAutomation(req.params.id, req.body)));
  app.post('/api/automations/:id/run', (req, res) => res.status(202).json(repo.runAutomation(req.params.id, req.body?.mode || 'manual')));
  app.get('/api/automations/:id/runs', (req, res) => res.json({ runs: repo.listAutomationRuns(req.params.id) }));
  app.get('/api/automation-runs/:id/webhooks', (req, res) => res.json({ deliveries: repo.listWebhookDeliveries(req.params.id) }));
  app.post('/api/automation-runs/:id/result', (req, res) => res.json(repo.completeAutomationRun(req.params.id, req.body || {})));
  app.delete('/api/automations/:id', (req, res) => res.json(repo.deleteAutomation(req.params.id)));
  app.get('/api/workspaces/:slug/calendar', (req, res) => res.json({ calendars: repo.listCalendar(req.params.slug) }));
  app.get('/api/workspaces/:slug/calendar/events', (req, res) => res.json({ events: repo.listCalendarEvents(req.params.slug) }));
  app.post('/api/workspaces/:slug/calendar/events', (req, res) => res.status(201).json(repo.createCalendarEvent(req.params.slug, req.body || {})));
  app.get('/api/calendar-events/:id', (req, res) => { const event = repo.getCalendarEvent(req.params.id); if (!event) return res.status(404).json({ error:'Calendar event not found' }); res.json(event); });
  app.patch('/api/calendar-events/:id', (req, res) => res.json(repo.updateCalendarEvent(req.params.id, req.body || {})));
  app.delete('/api/calendar-events/:id', (req, res) => res.json(repo.deleteCalendarEvent(req.params.id)));
  app.get('/api/workspaces/:slug/members', (req, res) => res.json({ members: repo.listMembers(req.params.slug) }));
  app.post('/api/workspaces/:slug/members', requireRole('owner','admin'), (req, res) => res.status(201).json(repo.createMember(req.params.slug, req.body)));
  app.patch('/api/members/:id', requireRole('owner','admin'), (req, res) => res.json(repo.updateMember(req.params.id, req.body || {})));
  app.delete('/api/members/:id', requireRole('owner','admin'), (req, res) => res.json(repo.deleteMember(req.params.id)));
  app.patch('/api/workspaces/:slug/members/:id', requireRole('owner','admin'), (req, res) => res.json(repo.updateMember(req.params.id, req.body || {})));
  app.delete('/api/workspaces/:slug/members/:id', requireRole('owner','admin'), (req, res) => res.json(repo.deleteMember(req.params.id)));
  app.get('/api/workspaces/:slug/invitations', (req, res) => res.json({ invitations: repo.listInvitations(req.params.slug) }));
  app.post('/api/workspaces/:slug/invitations', requireRole('owner','admin'), (req, res) => res.status(201).json(repo.createInvitation(req.params.slug, req.body)));
  app.post('/api/invitations/:id/resend', requireRole('owner','admin'), (req, res) => res.json(repo.resendInvitation(req.params.id)));
  app.post('/api/invitations/:id/revoke', requireRole('owner','admin'), (req, res) => res.json(repo.revokeInvitation(req.params.id)));
  app.get('/api/invitations/lookup/:code', (req, res) => { const invitation = repo.getInvitationByCode(req.params.code); if (!invitation) return res.status(404).json({ error: 'Invitation not found' }); res.json(invitation); });
  app.post('/api/invitations/:code/accept', (req, res) => res.json(repo.acceptInvitation(req.params.code, req.body)));
  app.get('/api/workspaces/:slug/devices', (req, res) => res.json({ devices: repo.listDevices(req.params.slug) }));
  app.post('/api/workspaces/:slug/devices', requireRole('owner','admin'), (req, res) => res.status(201).json(repo.createDevice(req.params.slug, req.body)));
  app.patch('/api/devices/:id', requireRole('owner','admin'), (req, res) => res.json(repo.updateDevice(req.params.id, req.body || {})));
  app.post('/api/devices/:id/disable', requireRole('owner','admin'), (req, res) => res.json(repo.setDeviceStatus(req.params.id, 'disabled')));
  app.post('/api/devices/:id/enable', requireRole('owner','admin'), (req, res) => res.json(repo.setDeviceStatus(req.params.id, 'pending')));
  app.delete('/api/devices/:id', requireRole('owner','admin'), (req, res) => res.json(repo.deleteDevice(req.params.id)));
  // Workspace-scoped aliases keep the device API consistent with collection
  // routes while the id-based forms remain convenient for the UI.
  app.patch('/api/workspaces/:slug/devices/:id', requireRole('owner','admin'), (req, res) => res.json(repo.updateDevice(req.params.id, req.body || {})));
  app.post('/api/workspaces/:slug/devices/:id/disable', requireRole('owner','admin'), (req, res) => res.json(repo.setDeviceStatus(req.params.id, 'disabled')));
  app.post('/api/workspaces/:slug/devices/:id/enable', requireRole('owner','admin'), (req, res) => res.json(repo.setDeviceStatus(req.params.id, 'pending')));
  app.delete('/api/workspaces/:slug/devices/:id', requireRole('owner','admin'), (req, res) => res.json(repo.deleteDevice(req.params.id)));
  // The only liveness signal used by the workspace is the local ziwei_user daemon.
  // AuraBaba or any other bridge is deliberately ignored by this endpoint.
  app.post('/api/workspaces/:slug/heartbeat', (req, res) => res.json({ ok: true, device: repo.heartbeatDevice(req.params.slug, req.body) }));
  app.post('/api/workspaces/:slug/devices/:id/heartbeat', (req, res) => res.json({ ok: true, device: repo.heartbeatDevice(req.params.slug, { ...req.body, deviceId: req.params.id }) }));
  app.post('/api/daemon/heartbeat', (req, res) => { const slug = String(req.body.workspace || req.body.workspace_slug || 'test-111'); res.json({ ok: true, device: repo.heartbeatDevice(slug, req.body) }); });
  app.post('/api/devices/heartbeat', (req, res) => { const slug = String(req.body.workspace || req.body.workspace_slug || 'test-111'); res.json({ ok: true, device: repo.heartbeatDevice(slug, req.body) }); });
  app.get('/api/workspaces/:slug/employees', (req, res) => res.json({ employees: repo.listEmployees(req.params.slug) }));
  app.post('/api/workspaces/:slug/employees', requireRole('owner','admin','member'), (req, res) => res.status(201).json(repo.createEmployee(req.params.slug, req.body)));
  app.patch('/api/employees/:id', requireRole('owner','admin','member'), (req, res) => res.json(repo.updateEmployee(req.params.id, req.body || {})));
  app.delete('/api/employees/:id', requireRole('owner','admin'), (req, res) => res.json(repo.deleteEmployee(req.params.id)));
  app.patch('/api/workspaces/:slug/employees/:id', requireRole('owner','admin','member'), (req, res) => res.json(repo.updateEmployee(req.params.id, req.body || {})));
  app.delete('/api/workspaces/:slug/employees/:id', requireRole('owner','admin'), (req, res) => res.json(repo.deleteEmployee(req.params.id)));
  // Employee configuration is kept separate from the ordinary employee list.
  // Environment values are encrypted at rest and returned only as metadata or
  // a mask; custom parameters are JSON values validated by the repository.
  const ensureEmployeeInWorkspace = (slug, idValue) => {
    const employee = repo.listEmployees(slug).find(item => item.id === idValue);
    if (!employee) { const error = new Error('数字员工不存在'); error.status = 404; throw error; }
    return employee;
  };
  app.get('/api/workspaces/:slug/employees/:id/environment', requireRole('owner','admin','member'), (req, res) => { ensureEmployeeInWorkspace(req.params.slug, req.params.id); res.json(repo.listEmployeeEnvironment(req.params.id)); });
  app.post('/api/workspaces/:slug/employees/:id/environment', requireRole('owner','admin'), (req, res) => { ensureEmployeeInWorkspace(req.params.slug, req.params.id); res.status(201).json(repo.upsertEmployeeEnvironment(req.params.id, req.body || {})); });
  app.patch('/api/workspaces/:slug/employees/:id/environment/:key', requireRole('owner','admin'), (req, res) => { ensureEmployeeInWorkspace(req.params.slug, req.params.id); res.json(repo.upsertEmployeeEnvironment(req.params.id, { ...(req.body || {}), key: req.params.key })); });
  app.delete('/api/workspaces/:slug/employees/:id/environment/:key', requireRole('owner','admin'), (req, res) => { ensureEmployeeInWorkspace(req.params.slug, req.params.id); res.json(repo.deleteEmployeeEnvironment(req.params.id, req.params.key)); });
  app.get('/api/workspaces/:slug/employees/:id/custom-params', requireRole('owner','admin','member'), (req, res) => { ensureEmployeeInWorkspace(req.params.slug, req.params.id); res.json(repo.getEmployeeCustomParams(req.params.id)); });
  app.put('/api/workspaces/:slug/employees/:id/custom-params', requireRole('owner','admin','member'), (req, res) => { ensureEmployeeInWorkspace(req.params.slug, req.params.id); res.json(repo.replaceEmployeeCustomParams(req.params.id, req.body || {})); });
  app.patch('/api/workspaces/:slug/employees/:id/custom-params', requireRole('owner','admin','member'), (req, res) => { ensureEmployeeInWorkspace(req.params.slug, req.params.id); res.json(repo.replaceEmployeeCustomParams(req.params.id, req.body || {})); });
  app.get('/api/employees/:id/environment', requireRole('owner','admin','member'), (req, res) => res.json(repo.listEmployeeEnvironment(req.params.id)));
  app.post('/api/employees/:id/environment', requireRole('owner','admin'), (req, res) => res.status(201).json(repo.upsertEmployeeEnvironment(req.params.id, req.body || {})));
  app.patch('/api/employees/:id/environment/:key', requireRole('owner','admin'), (req, res) => res.json(repo.upsertEmployeeEnvironment(req.params.id, { ...(req.body || {}), key: req.params.key })));
  app.delete('/api/employees/:id/environment/:key', requireRole('owner','admin'), (req, res) => res.json(repo.deleteEmployeeEnvironment(req.params.id, req.params.key)));
  app.get('/api/employees/:id/custom-params', requireRole('owner','admin','member'), (req, res) => res.json(repo.getEmployeeCustomParams(req.params.id)));
  app.put('/api/employees/:id/custom-params', requireRole('owner','admin','member'), (req, res) => res.json(repo.replaceEmployeeCustomParams(req.params.id, req.body || {})));
  app.patch('/api/employees/:id/custom-params', requireRole('owner','admin','member'), (req, res) => res.json(repo.replaceEmployeeCustomParams(req.params.id, req.body || {})));
  app.get('/api/workspaces/:slug/audit', (req, res) => res.json({ events: repo.listAudit(req.params.slug) }));
  app.get('/api/workspaces/:slug/notifications', (req, res) => res.json({ notifications: repo.listNotifications(req.params.slug, Number(req.query.limit) || 50, { unread: req.query.unread === '1' || req.query.unread === 'true', archived: req.query.archived === '1' || req.query.archived === 'true' }), stats: repo.notificationStats(req.params.slug) }));
  app.post('/api/workspaces/:slug/notifications/read', (req, res) => res.json({ ok:true, stats:repo.markNotificationsRead(req.params.slug, req.body?.ids) }));
  app.post('/api/notifications/:id/archive', (req, res) => res.json(repo.archiveNotification(req.params.id, req.body?.archived !== false)));
  app.get('/api/workspaces/:slug/notifications/stream', (req, res) => { res.statusCode=200; res.setHeader('Content-Type','text/event-stream'); res.setHeader('Cache-Control','no-cache'); res.setHeader('Connection','keep-alive'); res.flushHeaders?.(); const send=event=>res.write(`event: notification\ndata: ${JSON.stringify(event)}\n\n`); const unsubscribe=realtime.subscribe(req.params.slug,send); const timer=setInterval(()=>res.write(': heartbeat\n\n'),15000); req.on('close',()=>{clearInterval(timer);unsubscribe();}); send({type:'ready',workspace:req.params.slug}); });
  app.get('/api/workspaces/:slug/conversations', (req, res) => res.json({ conversations: repo.listConversations(req.params.slug) }));
  app.post('/api/workspaces/:slug/conversations', (req, res) => res.status(201).json(repo.createConversation(req.params.slug, req.body || {})));
  app.get('/api/conversations/:id', (req, res) => { const conversation=repo.getConversation(req.params.id); if(!conversation) return res.status(404).json({error:'Conversation not found'}); res.json(conversation); });
  app.post('/api/conversations/:id/messages', (req, res) => res.status(201).json(repo.addConversationMessage(req.params.id, req.body || {})));
  app.post('/api/conversations/:id/archive', (req, res) => res.json(repo.archiveConversation(req.params.id, req.body?.archived !== false)));
  app.get('/api/workspaces/:slug/settings', (req, res) => res.json({ workspace: repo.getWorkspaceSettings(req.params.slug), security: { accessKeys: repo.listApiKeys(req.params.slug) } }));
  app.get('/api/workspaces/:slug/permissions', (req, res) => res.json({ role: req.workspaceRole || 'owner', roles: repo.resourcePermissions() }));
  app.get('/api/workspaces/:slug/api-keys', (req, res) => res.json({ keys: repo.listApiKeys(req.params.slug) }));
  app.post('/api/workspaces/:slug/api-keys', requireRole('owner','admin'), (req, res) => { if (req.workspaceRole === 'admin' && req.body?.role === 'owner') return res.status(403).json({ error: '管理员不能创建 Owner 级 API Key' }); return res.status(201).json(repo.createApiKey(req.params.slug, req.body)); });
  app.post('/api/api-keys/:id/revoke', requireRole('owner','admin'), (req, res) => res.json(repo.revokeApiKey(req.params.id)));
  app.post('/api/api-keys/:id/rotate', requireRole('owner','admin'), (req, res) => { const key=repo.db.prepare('SELECT role FROM api_keys WHERE id=?').get(req.params.id); if (req.workspaceRole === 'admin' && key?.role === 'owner') return res.status(403).json({ error: '管理员不能轮换 Owner 级 API Key' }); return res.status(201).json(repo.rotateApiKey(req.params.id, req.body || {})); });
  app.patch('/api/workspaces/:slug/profile', requireRole('owner','admin','member'), (req, res) => res.json({ workspace: repo.updateProfile(req.params.slug, req.body || {}) }));
  app.patch('/api/workspaces/:slug/preferences', requireRole('owner','admin','member'), (req, res) => res.json({ workspace: repo.updatePreferences(req.params.slug, req.body || {}) }));
  app.patch('/api/workspaces/:slug/settings', requireRole('owner','admin'), (req, res) => res.json({ workspace: repo.updateWorkspace(req.params.slug, req.body) }));

  // External integrations use an explicit API key namespace. First-party UI
  // routes remain session-local while API consumers get expiry and revocation
  // checks on every request.
  app.use('/api/external', apiKeyRequired(repo));
  app.use('/api/external', assertApiKeyWorkspace);
  app.get('/api/external/workspaces/:slug/summary', assertApiKeyWorkspace, (req, res) => res.json(repo.getSummary(req.params.slug)));
  app.get('/api/external/workspaces/:slug/tasks', assertApiKeyWorkspace, (req, res) => res.json({ tasks: repo.listTasks(req.params.slug, req.query) }));
  app.post('/api/external/workspaces/:slug/tasks', assertApiKeyWorkspace, (req, res) => res.status(201).json(repo.createTask(req.params.slug, req.body)));

  // MCP management API. This namespace is intentionally separate from the
  // browser session API and the broad external API-key namespace. A stdio MCP
  // client sends one dedicated, workspace-scoped token and reaches these
  // routes over HTTPS; the client never opens the SQLite file.
  const mcpOptions = {
    ...(options.mcpOptions || {}),
    token: options.mcpOptions?.token ?? options.mcpToken,
    tokenFile: options.mcpOptions?.tokenFile ?? options.mcpTokenFile,
    workspace: options.mcpOptions?.workspace ?? options.mcpWorkspace,
    workspaces: options.mcpOptions?.workspaces ?? (options.mcpWorkspace ? [options.mcpWorkspace] : undefined),
    role: options.mcpOptions?.role ?? options.mcpRole,
    create: options.mcpOptions?.create ?? false
  };
  app.get('/api/workspaces/:slug/hermes/profiles', requireRole('owner','admin','member'), (req, res) => {
    res.json(repo.listHermesProfiles(req.params.slug));
  });
  app.get('/api/workspaces/:slug/mcp/status', requireRole('owner','admin','member'), (req, res) => {
    const credential = readMCPCredential({ ...mcpOptions, create: false });
    const scoped = Boolean(credential.token) && mcpWorkspaceAllowed(credential.workspaces, req.params.slug);
    let health = 'unconfigured';
    if (credential.token && !scoped) health = 'scope_denied';
    else if (scoped) {
      try { repo.listEmployees(req.params.slug); health = 'healthy'; } catch { health = 'unavailable'; }
    }
    const protocol = String(req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
    const endpoint = `${protocol}://${req.get('x-forwarded-host') || req.get('host')}/mcp/v1/workspaces/${encodeURIComponent(req.params.slug)}`;
    res.json({ configured: Boolean(credential.token), health, workspace: req.params.slug, workspaces: credential.workspaces, scope_allowed: scoped, endpoint, transport: 'https_api', client: 'scripts/ziwei-mcp.mjs', capabilities: ['employees', 'tasks', 'documents'], boundary: '仅提供当前工作区的员工、任务和文档窄管理面；不会直接打开 SQLite，也不代表全功能 MCP 已连接。' });
  });
  const mcpGuard = mcpTokenRequired(mcpOptions);
  const mcpResourceGuard = table => (req, res, next) => {
    if (table !== 'documents') return res.status(400).json({ error: '不支持的 MCP 资源' });
    const row = repo.listDocuments(req.mcpCredential.workspace).find(item => item.id === req.params.id);
    if (!row) return res.status(404).json({ error: '文档不存在' });
    next();
  };
  app.get('/mcp/v1/workspaces/:slug/health', mcpGuard, (req, res) => {
    try { repo.listEmployees(req.params.slug); res.json({ ok: true, workspace: req.params.slug, capabilities: ['employees', 'tasks', 'documents'], boundary: '窄管理面：员工、任务和文档；客户端通过 HTTPS API，不直接访问 SQLite。' }); }
    catch (error) { res.status(503).json({ ok: false, error: error.message }); }
  });
  app.get('/mcp/v1/workspaces/:slug/employees', mcpGuard, (req, res) => res.json({ employees: repo.listEmployees(req.params.slug) }));
  app.post('/mcp/v1/workspaces/:slug/employees', mcpGuard, (req, res) => res.status(201).json(repo.createEmployee(req.params.slug, req.body || {})));
  app.patch('/mcp/v1/workspaces/:slug/employees/:id', mcpGuard, (req, res, next) => {
    try {
      const row = repo.listEmployees(req.params.slug).find(item => item.id === req.params.id);
      if (!row) return res.status(404).json({ error: '数字员工不存在' });
      return res.json(repo.updateEmployee(req.params.id, req.body || {}));
    } catch (error) { return next(error); }
  });
  app.get('/mcp/v1/workspaces/:slug/tasks', mcpGuard, (req, res) => res.json({ tasks: repo.listTasks(req.params.slug, req.query) }));
  app.post('/mcp/v1/workspaces/:slug/tasks', mcpGuard, (req, res) => res.status(201).json(repo.createTask(req.params.slug, req.body || {})));
  app.get('/mcp/v1/workspaces/:slug/documents', mcpGuard, (req, res) => res.json({ documents: repo.listDocuments(req.params.slug) }));
  app.post('/mcp/v1/workspaces/:slug/documents', mcpGuard, (req, res) => res.status(201).json(repo.createDocument(req.params.slug, req.body || {})));
  app.get('/mcp/v1/documents/:id', mcpGuard, mcpResourceGuard('documents'), (req, res) => res.json(repo.getDocument(req.params.id)));
  app.patch('/mcp/v1/documents/:id', mcpGuard, mcpResourceGuard('documents'), (req, res) => res.json(repo.updateDocument(req.params.id, req.body || {})));

  // A2A v1: agent cards + task/message primitives. The executor is intentionally local-first;
  // daemon adapters can claim tasks later without changing this contract.
  app.use('/a2a/v1', a2aAuth({ bypass: authBypass }));
  app.get('/a2a/v1/agents', (_req, res) => res.json({ agents: [{ id:'ziwei_user', name:'ziwei_user', description:'紫薇工作区本机 daemon，负责心跳、轮询和 A2A 任务', url:'/a2a/v1', capabilities:['tasks','messages','heartbeat','actions','ack','result'] }] }));
  app.post('/a2a/v1/register', (req, res) => { const workspace = String(req.body.workspace || req.body.workspace_slug || 'test-111'); res.json({ ok:true, agent:repo.registerA2AAgent(workspace, req.body), card:{id:'ziwei_user',capabilities:['tasks','messages','heartbeat','actions','ack','result']} }); });
  app.post('/a2a/v1/actions', (req, res) => { const action=repo.createA2AAction(String(req.body.workspace || req.body.workspace_slug || 'test-111'), req.body); res.status(action.duplicate ? 200 : 201).json(action); });
  app.get('/a2a/v1/actions', (req, res) => { const workspace=String(req.query.workspace || 'test-111'); res.json({ actions:repo.listA2AActions(workspace,{agentId:req.query.agent || req.query.agent_id,status:req.query.status || 'pending',includeAcked:req.query.includeAcked || req.query.include_acked}) }); });
  app.post('/a2a/v1/actions/:id/ack', (req, res) => res.json(repo.ackA2AAction(req.params.id, req.body)));
  app.post('/a2a/v1/actions/:id/events', (req, res) => res.status(202).json(repo.recordA2AEvent(req.params.id, req.body || {})));
  app.get('/a2a/v1/actions/:id/events', (req, res) => res.json({ events: repo.listA2AEvents(req.params.id) }));
  app.post('/a2a/v1/actions/:id/result', (req, res) => res.json(repo.resultA2AAction(req.params.id, req.body)));
  app.post('/a2a/v1/tasks', (req, res) => { const task = repo.createA2ATask(req.body.workspace || 'test-111', req.body); res.status(201).json({ id:task.id, status:{state:'submitted', timestamp:task.created_at}, task }); });
  app.get('/a2a/v1/tasks', (req, res) => { const workspace = String(req.query.workspace || 'test-111'); const tasks = repo.listTasks(workspace, { state: req.query.state, q: req.query.q }); res.json({ tasks: tasks.map(task => ({ id: task.id, status: { state: task.state, timestamp: task.updated_at }, task })) }); });
  app.get('/a2a/v1/tasks/:id', (req, res) => { const task=repo.getTask(req.params.id); if(!task) return res.status(404).json({error:'Task not found'}); res.json({id:task.id,status:{state:task.state,timestamp:task.updated_at},task,messages:repo.getTaskMessages(task.id)}); });
  app.post('/a2a/v1/tasks/:id/messages', (req, res) => res.status(201).json({ message:repo.addTaskMessage(req.params.id,req.body), accepted:true }));

  app.use((err, _req, res, _next) => { const status = /not found|不存在/i.test(err.message || '') ? 404 : 400; res.status(status).json({ error: err.message || 'Bad request' }); });
  return app;
}

export function startServer({ port = Number(process.env.API_PORT || 4178), host = process.env.API_HOST || '127.0.0.1', ...options } = {}) {
  const objectStoreDir = options.objectStoreDir || process.env.ZIWEI_OBJECT_STORE_DIR || path.resolve(process.cwd(), 'data', 'objects');
  const app = createApp({ ...options, objectStoreDir });
  const server = app.listen(port, host, () => console.log(JSON.stringify({ event:'started', service:'ziwei-api', cli:'ziwei_user', host, port, pid:process.pid, at:new Date().toISOString() })));
  attachRealtimeWebSocket(server, app);
  return server;
}

/**
 * Attach a browser-friendly WebSocket mirror of the notification SSE stream.
 * Authentication follows the normal session cookie; memory-mode apps used by
 * tests may opt out through app.locals.authBypass.  Keeping the subscription
 * on RealtimeHub means SSE and WebSocket clients observe the same events.
 */
export function attachRealtimeWebSocket(server, app, { pathPrefix = '/api/workspaces/' } = {}) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  const prefix = String(pathPrefix).replace(/\/$/, '/');
  const matchPath = pathname => {
    if (!pathname.startsWith(prefix) || !pathname.endsWith('/notifications/ws')) return null;
    const slug = pathname.slice(prefix.length, -'/notifications/ws'.length).replace(/\/$/, '');
    return slug ? decodeURIComponent(slug) : null;
  };
  const reject = (socket, status, message) => {
    socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };
  server.on('upgrade', (req, socket, head) => {
    let url;
    try { url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`); } catch { reject(socket, 400, 'Bad Request'); return; }
    const slug = matchPath(url.pathname);
    if (!slug) { reject(socket, 404, 'Not Found'); return; }
    const origin = String(req.headers.origin || '');
    if (origin && origin !== allowedOrigin) { reject(socket, 403, 'Forbidden'); return; }
    const auth = app.locals.auth;
    const bypass = app.locals.authBypass === true;
    const principal = bypass ? null : auth?.authenticate(req);
    if (!bypass && !principal) { reject(socket, 401, 'Unauthorized'); return; }
    if (!bypass && !auth?.canAccess(principal.user_id, slug)) { reject(socket, 403, 'Forbidden'); return; }
    sockets.handleUpgrade(req, socket, head, ws => {
      sockets.emit('connection', ws, req, { slug, principal });
    });
  });
  sockets.on('connection', (ws, _req, context) => {
    const send = event => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'notification', event }));
    };
    const unsubscribe = app.locals.realtime.subscribe(context.slug, send);
    ws.send(JSON.stringify({ type: 'ready', workspace: context.slug }));
    ws.on('message', raw => {
      // Clients may send a ping or a no-op subscription message.  The server
      // keeps the URL-scoped workspace authoritative and never trusts a client
      // supplied workspace value.
      try {
        const message = JSON.parse(String(raw));
        if (message?.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
      } catch {}
    });
    ws.on('close', unsubscribe);
    ws.on('error', unsubscribe);
  });
  return sockets;
}

if (process.argv[1] && process.argv[1].endsWith('server.mjs')) startServer();

