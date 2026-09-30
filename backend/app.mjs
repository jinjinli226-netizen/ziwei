import express from 'express';
import path from 'node:path';
import { createRepository } from './repository.mjs';
import { RealtimeHub } from './realtime.mjs';
import { exportDocumentsToGit, importDocumentsFromGit } from './git-sync.mjs';

const allowedOrigin = process.env.FRONTEND_ORIGIN || 'http://127.0.0.1:5178';

function cors(req, res, next) {
  const origin = req.headers.origin;
  if (origin === allowedOrigin || !origin) res.setHeader('Access-Control-Allow-Origin', origin || allowedOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Workspace-Id, X-Workspace-Role, X-Ziwei-Api-Key');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
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
    const role = String(req.apiKey ? req.workspaceRole : (headerRole || req.workspaceRole || 'owner')).toLowerCase();
    if (!allowed.includes(role)) return res.status(403).json({ error: '当前角色没有执行该操作的权限', role, required: allowed });
    req.workspaceRole = role; next();
  };
}

const READ_ROLES = ['owner', 'admin', 'member'];
const WRITE_ROLES = ['owner', 'admin', 'member'];
const MANAGE_ROLES = ['owner', 'admin'];
function resourceRoleGuard(req, res, next) {
  const path = req.path || '';
  if (path.startsWith('/external/') || path.startsWith('/daemon/') || path.startsWith('/invitations/lookup/') || path.endsWith('/accept') || path === '/devices/heartbeat' || path.endsWith('/heartbeat')) return next();
  const sensitiveAdminPath = /(?:settings|api-keys|members|invitations|devices)(?:\/|$)/i.test(path);
  const adminReadPath = /(?:settings|api-keys)(?:\/|$)/i.test(path);
  const allowed = adminReadPath || (req.method !== 'GET' && req.method !== 'HEAD' && sensitiveAdminPath) ? MANAGE_ROLES : (req.method === 'GET' || req.method === 'HEAD' ? READ_ROLES : WRITE_ROLES);
  return requireRole(...allowed)(req, res, next);
}

export function createApp(options = {}) {
  const app = express();
  const realtime = new RealtimeHub();
  const repo = options.repository || createRepository({ ...options, onEvent: event => realtime.publish(event) });
  app.locals.repo = repo;
  app.locals.realtime = realtime;
  app.use(cors);
  // Task attachments are sent as Base64 JSON; allow the 10 MiB attachment
  // limit plus encoding and envelope overhead without accepting unbounded
  // request bodies.
  app.use(express.json({ limit: '16mb' }));
  // Keep one policy for workspace resources. Individual routes retain their
  // explicit guards as documentation, while this catch-all covers newly added
  // sensitive routes and id-based mutations consistently.
  app.use('/api', resourceRoleGuard);
  app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'ziwei-api', cli: 'ziwei_user', time: new Date().toISOString() }));
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
  app.post('/api/workspaces/:slug/api-keys', requireRole('owner','admin'), (req, res) => res.status(201).json(repo.createApiKey(req.params.slug, req.body)));
  app.post('/api/api-keys/:id/revoke', requireRole('owner','admin'), (req, res) => res.json(repo.revokeApiKey(req.params.id)));
  app.post('/api/api-keys/:id/rotate', requireRole('owner','admin'), (req, res) => res.status(201).json(repo.rotateApiKey(req.params.id, req.body || {})));
  app.patch('/api/workspaces/:slug/profile', requireRole('owner','admin','member'), (req, res) => res.json({ workspace: repo.updateProfile(req.params.slug, req.body || {}) }));
  app.patch('/api/workspaces/:slug/preferences', requireRole('owner','admin','member'), (req, res) => res.json({ workspace: repo.updatePreferences(req.params.slug, req.body || {}) }));
  app.patch('/api/workspaces/:slug/settings', requireRole('owner','admin'), (req, res) => res.json({ workspace: repo.updateWorkspace(req.params.slug, req.body) }));

  // External integrations use an explicit API key namespace. First-party UI
  // routes remain session-local while API consumers get expiry and revocation
  // checks on every request.
  app.use('/api/external', apiKeyRequired(repo));
  app.get('/api/external/workspaces/:slug/summary', (req, res) => res.json(repo.getSummary(req.params.slug)));
  app.get('/api/external/workspaces/:slug/tasks', (req, res) => res.json({ tasks: repo.listTasks(req.params.slug, req.query) }));
  app.post('/api/external/workspaces/:slug/tasks', (req, res) => res.status(201).json(repo.createTask(req.params.slug, req.body)));

  // A2A v1: agent cards + task/message primitives. The executor is intentionally local-first;
  // daemon adapters can claim tasks later without changing this contract.
  app.get('/a2a/v1/agents', (_req, res) => res.json({ agents: [{ id:'ziwei_user', name:'ziwei_user', description:'紫薇工作区本机 daemon，负责心跳、轮询和 A2A 任务', url:'/a2a/v1', capabilities:['tasks','messages','heartbeat','actions','ack','result'] }] }));
  app.post('/a2a/v1/register', (req, res) => { const workspace = String(req.body.workspace || req.body.workspace_slug || 'test-111'); res.json({ ok:true, agent:repo.registerA2AAgent(workspace, req.body), card:{id:'ziwei_user',capabilities:['tasks','messages','heartbeat','actions','ack','result']} }); });
  app.post('/a2a/v1/actions', (req, res) => { const action=repo.createA2AAction(String(req.body.workspace || req.body.workspace_slug || 'test-111'), req.body); res.status(action.duplicate ? 200 : 201).json(action); });
  app.get('/a2a/v1/actions', (req, res) => { const workspace=String(req.query.workspace || 'test-111'); res.json({ actions:repo.listA2AActions(workspace,{agentId:req.query.agent || req.query.agent_id,status:req.query.status || 'pending',includeAcked:req.query.includeAcked || req.query.include_acked}) }); });
  app.post('/a2a/v1/actions/:id/ack', (req, res) => res.json(repo.ackA2AAction(req.params.id, req.body)));
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
  return app.listen(port, host, () => console.log(JSON.stringify({ event:'started', service:'ziwei-api', cli:'ziwei_user', host, port, pid:process.pid, at:new Date().toISOString() })));
}

if (process.argv[1] && process.argv[1].endsWith('server.mjs')) startServer();

