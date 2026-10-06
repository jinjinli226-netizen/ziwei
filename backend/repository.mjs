import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { openDatabase } from './db.mjs';
import { transitionTask } from '../src/domain.mjs';
import { listModels } from './models.mjs';
import { discoverLocalVersions } from './discovery.mjs';
import { MAX_SKILL_BYTES, hashSkillContent, parseSkillMarkdown, validateSkillDocument } from './skills/validator.mjs';
import { extractSkillMarkdownArchive } from './skills/archive.mjs';
import { objectStoreFromOptions } from './storage.mjs';
import { sanitizeHtml } from './sanitize.mjs';
import { composeEmployeePrompt, normalizeRuntimeProfile } from '../src/employee-runtime.mjs';
import { listHermesProfiles, validateHermesProfile } from '../src/runtime-adapters.mjs';

const now = () => new Date().toISOString();
const id = prefix => `${prefix}_${crypto.randomUUID()}`;
const hashSecret = value => crypto.createHash('sha256').update(String(value || '')).digest('hex');
const parse = value => { try { return JSON.parse(value); } catch { return []; } };
function toSkillRecord(row) {
  if (!row) return null;
  return { ...row, installed: Boolean(row.installed), recommended: Boolean(row.recommended), tags: parse(row.tags_json) };
}
const configuredHeartbeatTimeout = Number(process.env.ZIWEI_HEARTBEAT_TIMEOUT_MS);
const HEARTBEAT_TIMEOUT_MS = Number.isFinite(configuredHeartbeatTimeout) && configuredHeartbeatTimeout > 0 ? configuredHeartbeatTimeout : 45_000;
const A2A_MIN_EXECUTION_TIMEOUT_MS = 15 * 60 * 1000;
const A2A_MAX_EXECUTION_TIMEOUT_MS = 60 * 60 * 1000;
const A2A_EXECUTION_LEASE_BUFFER_MS = 60 * 1000;
const a2aExecutionTimeoutMs = payload => {
  const requested = Number(payload?.timeoutMs ?? payload?.timeout_ms);
  if (!Number.isFinite(requested)) return A2A_MIN_EXECUTION_TIMEOUT_MS;
  return Math.min(A2A_MAX_EXECUTION_TIMEOUT_MS, Math.max(A2A_MIN_EXECUTION_TIMEOUT_MS, requested));
};
const ownVersion = () => process.env.ZIWEI_USER_VERSION || '0.1.0';
const appOrigin = () => String(process.env.ZIWEI_APP_URL || process.env.FRONTEND_ORIGIN || 'http://127.0.0.1:5178').replace(/\/$/, '');
const invitationExpiry = input => {
  const supplied = input?.expiresAt ?? input?.expires_at;
  if (supplied !== undefined && supplied !== null && String(supplied).trim()) {
    const value = new Date(String(supplied));
    if (!Number.isFinite(value.getTime()) || value.getTime() <= Date.now()) throw new Error('邀请有效期必须晚于当前时间');
    return value.toISOString();
  }
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
};
const invitationCode = () => crypto.randomBytes(12).toString('base64url');
const invitationHash = code => crypto.createHash('sha256').update(String(code || '').trim()).digest('hex');
const invitationLink = (slug, code) => `${appOrigin()}/invite?workspace=${encodeURIComponent(slug)}&code=${encodeURIComponent(code)}`;
const normalizeEmail = value => String(value || '').trim().toLowerCase();
const jsonObject = value => { try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; } };
const normalizeDescriptionFormat = value => ['plain', 'markdown', 'html'].includes(String(value || '').toLowerCase()) ? String(value).toLowerCase() : 'plain';
const taskAttachmentView = row => row ? ({ id:row.id, task_id:row.task_id, name:row.name, mime_type:row.mime_type, size:Number(row.size || 0), content_encoding:row.content_encoding, storage_key:row.storage_key, checksum:row.checksum, created_at:row.created_at }) : null;
const normalizeConversationAttachments = value => {
  if (!Array.isArray(value) || !value.length) return [];
  let total = 0;
  return value.slice(0, 20).map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error('会话附件格式无效');
    const name = path.basename(String(item.name || item.filename || `attachment-${index + 1}`)).slice(0, 255) || `attachment-${index + 1}`;
    const supplied = item.content ?? item.data ?? item.contentBase64;
    if (supplied === undefined || supplied === null || supplied === '') return { ...item, name };
    const encoding = String(item.contentEncoding ?? item.content_encoding ?? 'base64').toLowerCase();
    const bytes = encoding === 'utf8' || encoding === 'utf-8' || encoding === 'text'
      ? Buffer.from(String(supplied), 'utf8')
      : decodeDocumentBase64(String(supplied).replace(/-/g, '+').replace(/_/g, '/'));
    total += bytes.length;
    if (bytes.length > 10 * 1024 * 1024 || total > 10 * 1024 * 1024) throw new Error('会话附件总大小不能超过 10 MiB');
    return { ...item, name, content: bytes.toString('base64'), contentEncoding: 'base64', size: bytes.length, mimeType: String(item.mimeType || item.mime_type || 'application/octet-stream').slice(0, 255) };
  });
};
const decodeDocumentBase64 = value => {
  const input = String(value ?? '').trim();
  if (!input) return Buffer.alloc(0);
  // Accept standard base64 and base64url, but reject silently truncated or
  // otherwise malformed data. Buffer.from(..., 'base64') intentionally
  // ignores invalid characters, so a round-trip check is required here.
  const standard = input.replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(standard) || standard.length % 4 !== 0 || /={1,2}[^=]/.test(standard)) {
    throw new Error('文档二进制内容无效：必须是标准 base64');
  }
  const bytes = Buffer.from(standard, 'base64');
  if (bytes.toString('base64') !== standard) throw new Error('文档二进制内容无效：base64 校验失败');
  return bytes;
};
const normalizeDocumentPayload = (value, encoding = 'utf8') => {
  const resolvedEncoding = String(encoding || 'utf8').toLowerCase();
  if (resolvedEncoding === 'base64') {
    const bytes = decodeDocumentBase64(value);
    return { content: bytes.toString('base64'), bytes, encoding: 'base64' };
  }
  if (resolvedEncoding !== 'utf8') throw new Error('文档编码只支持 utf8 或 base64');
  const content = String(value ?? '');
  return { content, bytes: Buffer.from(content, 'utf8'), encoding: 'utf8' };
};
const documentChecksum = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const cronPart = (value, min, max) => {
  const values = new Set();
  for (const raw of String(value).split(',')) {
    const [rangeText, stepText] = raw.split('/'); const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new Error('Cron 步长无效');
    let start = rangeText === '*' ? min : Number(rangeText); let end = rangeText === '*' ? max : start;
    if (rangeText.includes('-')) { const pair = rangeText.split('-').map(Number); start = pair[0]; end = pair[1]; }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) throw new Error('Cron 范围无效');
    for (let n = start; n <= end; n += step) values.add(n);
  }
  return values;
};
const parseCron = text => {
  const fields = String(text).trim().split(/\s+/); if (fields.length !== 5) return null;
  return { minute: cronPart(fields[0], 0, 59), hour: cronPart(fields[1], 0, 23), day: cronPart(fields[2], 1, 31), month: cronPart(fields[3], 1, 12), weekday: cronPart(fields[4], 0, 7), dayWildcard: fields[2] === '*', weekdayWildcard: fields[4] === '*' };
};
const zonedParts = (date, timezone) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone || 'Asia/Shanghai', hourCycle: 'h23', year:'numeric', month:'numeric', day:'numeric', hour:'numeric', minute:'numeric', weekday:'short' }).formatToParts(date);
  const result = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return { year:Number(result.year), month:Number(result.month), day:Number(result.day), hour:Number(result.hour), minute:Number(result.minute), weekday:{Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6}[result.weekday] };
};
const nextCron = (cron, from, timezone) => {
  const candidate = new Date(Math.floor(from.getTime() / 60000) * 60000 + 60000);
  // A bounded minute scan keeps this dependency-free while handling DST via Intl.
  for (let i = 0; i < 366 * 24 * 60; i++, candidate.setUTCMinutes(candidate.getUTCMinutes() + 1)) {
    const p = zonedParts(candidate, timezone); const dayMatch = cron.day.has(p.day); const weekdayMatch = cron.weekday.has(p.weekday) || (p.weekday === 0 && cron.weekday.has(7));
    if (cron.minute.has(p.minute) && cron.hour.has(p.hour) && cron.month.has(p.month) && ((cron.dayWildcard || cron.weekdayWildcard) ? (dayMatch && weekdayMatch) : (dayMatch || weekdayMatch))) return candidate.toISOString();
  }
  throw new Error('Cron 计划超出可计算范围');
};
const parseSchedule = (schedule, from = new Date(), timezone = 'Asia/Shanghai') => {
  const text = String(schedule || '').trim();
  if (!text || /^手动|manual$/i.test(text)) return null;
  if (/^每小时$/i.test(text)) return new Date(from.getTime() + 3600000).toISOString();
  if (/^每天$/.test(text)) return new Date(from.getTime() + 86400000).toISOString();
  const daily = text.match(/^每天\s*(\d{1,2})(?::(\d{2}))?$/);
  if (daily && Number(daily[1]) <= 23 && Number(daily[2] || 0) <= 59) return nextCron(parseCron(`${Number(daily[2] || 0)} ${Number(daily[1])} * * *`), from, timezone);
  const weekly = text.match(/^每周([一二三四五六日天0-7])?\s*(\d{1,2})(?::(\d{2}))?$/);
  if (weekly && Number(weekly[2]) <= 23 && Number(weekly[3] || 0) <= 59) { const currentWeekday = zonedParts(from, timezone).weekday; const target = {一:1,二:2,三:3,四:4,五:5,六:6,日:0,天:0,0:0,7:0,1:1,2:2,3:3,4:4,5:5,6:6}[weekly[1]] ?? currentWeekday; return nextCron(parseCron(`${Number(weekly[3] || 0)} ${Number(weekly[2])} * * ${target}`), from, timezone); }
  const every = text.match(/^每(?:隔)?\s*(\d+)\s*(分钟|分|小时|hour|hours|天|日|days?)$/i);
  if (every) { const amount = Number(every[1]); if (!amount) throw new Error('间隔必须大于 0'); const unit = every[2].toLowerCase(); const ms = /小时|hour/.test(unit) ? amount * 3600000 : /天|日|day/.test(unit) ? amount * 86400000 : amount * 60000; return new Date(from.getTime() + ms).toISOString(); }
  const cron = parseCron(text); if (cron) return nextCron(cron, from, timezone);
  throw new Error('计划表达式无效；支持中文计划或五段 cron');
};
const invitationView = (row, slug, extra = {}) => {
  if (!row) return null;
  const expired = row.status === 'pending' && Date.parse(row.expires_at) <= Date.now();
  return {
    id: row.id, workspace_id: row.workspace_id, workspace: slug, email: row.email,
    role: row.role, status: expired ? 'expired' : row.status, code_prefix: row.code_prefix,
    expires_at: row.expires_at, created_at: row.created_at, last_sent_at: row.last_sent_at,
    resend_count: Number(row.resend_count || 0), accepted_at: row.accepted_at, revoked_at: row.revoked_at,
    member_id: row.member_id, ...extra
  };
};
const isFresh = (lastSeen, nowMs = Date.now()) => {
  const timestamp = Date.parse(lastSeen || '');
  // A clock-skewed/future timestamp is not evidence that the bridge is alive.
  // It must be at or before the observation time and inside the timeout window.
  return Number.isFinite(timestamp) && timestamp <= nowMs && nowMs - timestamp <= HEARTBEAT_TIMEOUT_MS;
};
const automationView = (row, runCount = 0) => {
  if (!row) return null;
  const view = { ...row, run_count: runCount, webhook_secret_configured: Boolean(row.webhook_secret) };
  delete view.webhook_secret;
  return view;
};

const employeeView = row => row ? ({ ...row, skills: parse(row.skills_json) }) : null;
const conversationEmployeeView = row => row ? ({
  id: row.id,
  name: row.name,
  avatar: row.avatar || '',
  runtime: row.runtime || null,
  runtime_name: row.runtime || null,
  model_id: row.model_id || null,
  runtime_profile: row.runtime_profile || null,
  status: row.status || 'active'
}) : null;
const validateEmployeeProfile = (runtime, profile) => {
  const normalizedRuntime = String(runtime || '').trim().toLowerCase();
  const normalizedProfile = normalizeRuntimeProfile(profile);
  if (normalizedRuntime !== 'hermes' || !normalizedProfile || normalizedProfile === 'default') return normalizedProfile;
  const available = listHermesProfiles();
  // A remote API process may not share the local Hermes home. In that case the
  // daemon remains the source of truth; when profiles are discoverable locally,
  // reject typos before they can silently fall back to the primary profile.
  if (available.length && !validateHermesProfile(normalizedProfile).valid) throw new Error(`Hermes profile 不存在: ${normalizedProfile}`);
  return normalizedProfile;
};

const ENV_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
const PARAM_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const LOCAL_RUNTIME_VARIABLES = ['ZIWEI_WORKSPACE', 'ZIWEI_AGENT_ID', 'ZIWEI_RUNTIME', 'HERMES_HOME'];
const encryptionKey = options => {
  const configured = String(options.envEncryptionKey || process.env.ZIWEI_ENV_ENCRYPTION_KEY || process.env.ZIWEI_SECRET_KEY || '').trim();
  if (configured) return crypto.createHash('sha256').update(configured).digest();
  // Keep the key outside SQLite and source control. A deployed process should
  // set ZIWEI_ENV_ENCRYPTION_KEY so it can be rotated and shared explicitly.
  const file = path.join(process.cwd(), '.local', 'employee-env.key');
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) {
      const value = fs.readFileSync(file);
      if (value.length >= 32) return value.subarray(0, 32);
    }
    const value = crypto.randomBytes(32);
    fs.writeFileSync(file, value, { mode: 0o600 });
    return value;
  } catch {
    return crypto.createHash('sha256').update(`${process.cwd()}:ziwei:employee-env`).digest();
  }
};
const encryptEmployeeValue = (value, key) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`;
};
const decryptEmployeeValue = (value, key) => {
  const parts = String(value || '').split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return String(value || '');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'base64url'));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8');
  } catch { throw new Error('环境变量密文无法解密，请检查本机密钥配置'); }
};
const environmentView = (row, key) => {
  if (!row) return null;
  const item = { id: row.id, employee_id: row.employee_id, key: row.key, sensitive: Boolean(row.sensitive), masked_value: '••••••••', created_at: row.created_at, updated_at: row.updated_at };
  if (!item.sensitive) item.value = decryptEmployeeValue(row.value_ciphertext, key);
  return item;
};

const calendarEventView = row => row ? ({
  ...row,
  source: 'event',
  title: row.name,
  start_date: row.start_at,
  end_date: row.end_at,
  all_day: Boolean(row.all_day)
}) : null;
const calendarDate = value => {
  const text = String(value ?? '').trim();
  if (!text) return null;
  // Calendar cells use local wall-clock dates. Keep date-only values intact;
  // ISO timestamps are retained as supplied so the selected timezone remains
  // explicit and can be edited independently of the event time.
  if (/^\d{4}-\d{2}-\d{2}$/.test(text) || /^\d{4}-\d{2}-\d{2}T/.test(text)) return text;
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime())) throw new Error('日历事件时间无效');
  return parsed.toISOString();
};

const ownDevice = devices => {
  const own = devices.filter(device => device.bridge_name === 'ziwei_user');
  return own.find(device => device.id === 'device-ziwei-user' && device.status === 'online')
    || own.find(device => device.status === 'online')
    || own.find(device => device.id === 'device-ziwei-user')
    || own[0]
    || null;
};

export function createRepository(options = {}) {
  const db = openDatabase(options);
  const employeeEnvKey = encryptionKey(options);
  const objectStore = objectStoreFromOptions(options);
  const discover = options.discoverLocalVersions || discoverLocalVersions;
  const workspace = slug => db.prepare('SELECT * FROM workspaces WHERE slug = ?').get(slug);
  const employeeAccessContext = input => ({
    enforceVisibility: Boolean(input?.enforceEmployeeVisibility),
    actorUserId: String(input?.actorUserId || '').trim() || null,
    actorRole: String(input?.actorRole || input?.role || '').trim().toLowerCase()
  });
  const employeeVisible = (row, input = {}) => {
    if (!row || row.visibility !== 'personal' || !input.enforceVisibility) return Boolean(row);
    if (['owner', 'admin'].includes(input.actorRole)) return true;
    return Boolean(input.actorUserId && row.owner_user_id && row.owner_user_id === input.actorUserId);
  };
  const assertEmployeeVisible = (row, input = {}) => {
    if (!row) throw new Error('数字员工不存在');
    if (!employeeVisible(row, employeeAccessContext(input))) throw new Error('数字员工无权访问');
    return row;
  };
  const employeeForInput = (workspaceId, input = {}) => {
    const employeeId = String(input.employeeId ?? input.employee_id ?? '').trim();
    if (employeeId) return assertEmployeeVisible(db.prepare('SELECT * FROM employees WHERE id=? AND workspace_id=?').get(employeeId, workspaceId) || null, input);
    const assignee = String(input.assignee || '').trim();
    if (!assignee) return null;
    const row = db.prepare('SELECT * FROM employees WHERE workspace_id=? AND lower(name)=lower(?) ORDER BY created_at DESC LIMIT 1').get(workspaceId, assignee) || null;
    return row ? assertEmployeeVisible(row, input) : null;
  };
  const executionPayload = ({ prompt, employee = null, runtime = null, model = null, profile = null, taskId = null, conversationId = null, cwd = null, targetDeviceId = null } = {}) => {
    const selectedRuntime = runtime || employee?.runtime || null;
    const selectedModel = model || employee?.model_id || null;
    const selectedProfile = normalizeRuntimeProfile(profile ?? employee?.runtime_profile);
    return {
      ...(taskId ? { taskId } : {}),
      prompt: composeEmployeePrompt({ prompt, name: employee?.name, instructions: employee?.instructions }),
      runtime: selectedRuntime,
      model: selectedModel,
      profile: selectedProfile,
      ...(employee ? { employeeId: employee.id, employeeName: employee.name } : {}),
      ...(cwd ? { cwd } : {}),
      ...(conversationId ? { conversationId } : {}),
      ...(targetDeviceId ? { deviceId: targetDeviceId } : {}),
    };
  };
  // A workspace can be created after the database seed has run.  Keep the
  // four built-in runtime rows available as soon as our own bridge reports a
  // heartbeat, while leaving any existing row (including its version and
  // capabilities) untouched.  Runtime liveness is still derived from the
  // ziwei_user heartbeat in listRuntimes().
  const ensureRuntimeCatalog = (workspaceId, timestamp) => {
    const defaults = [
      ['Claude', 'Anthropic', ['chat', 'code', 'browser']],
      ['Codex', 'OpenAI', ['code', 'review', 'terminal']],
      ['Gemini', 'Google', ['research', 'vision', 'chat']],
      ['Hermes', 'Hermes', ['orchestration', 'a2a', 'automation']]
    ];
    const insert = db.prepare('INSERT INTO runtimes(id,workspace_id,name,provider,version,status,capabilities_json,last_seen) VALUES(?,?,?,?,?,?,?,?)');
    for (const [name, provider, capabilities] of defaults) {
      const existing = db.prepare('SELECT id FROM runtimes WHERE workspace_id=? AND name=?').get(workspaceId, name);
      if (!existing) insert.run(id('runtime'), workspaceId, name, provider, null, 'online', JSON.stringify(capabilities), timestamp);
    }
  };
  const audit = (slug, actor, action, payload = {}) => {
    const eventId = id('audit'); const timestamp = now(); const ws = workspace(slug);
    db.prepare('INSERT INTO audit_events(id,workspace_id,actor,action,payload_json,created_at) VALUES(?,?,?,?,?,?)').run(eventId, ws.id, actor, action, JSON.stringify(payload), timestamp);
    db.prepare('INSERT INTO notifications(id,workspace_id,event_id,actor,action,payload_json,created_at,read_at,archived_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id('notice'), ws.id, eventId, actor, action, JSON.stringify(payload), timestamp, null, null);
    options.onEvent?.({ id:eventId, workspaceId:ws.id, workspaceSlug:slug, actor, action, payload, created_at:timestamp });
    return eventId;
  };
  const actionEvents = actionId => db.prepare('SELECT id,action_id,type,message,data_json,created_at FROM a2a_action_events WHERE action_id=? ORDER BY created_at,id').all(actionId).map(event => ({
    id:event.id, action_id:event.action_id, type:event.type, message:event.message,
    data:parse(event.data_json), created_at:event.created_at
  }));
  const actionView = (row, { includeEvents = false } = {}) => row ? ({
    id: row.id,
    task_id: row.task_id,
    agent_id: row.agent_id,
    type: row.type,
    status: row.status,
    payload: parse(row.payload_json),
    dedupe_key: row.dedupe_key,
    created_at: row.created_at,
    acked_at: row.acked_at,
    completed_at: row.completed_at,
    result: parse(row.result_json),
    error: row.error || null,
    ...(includeEvents ? { events: actionEvents(row.id) } : {})
  }) : null;
  const actionTargetDevice = row => {
    const payload = parse(row?.payload_json);
    return String(payload.deviceId || payload.device_id || payload.targetDeviceId || payload.target_device_id || '').trim() || null;
  };
  const assertActionDevice = (row, input = {}) => {
    const target = actionTargetDevice(row);
    const deviceId = String(input.deviceId || input.device_id || '').trim();
    if (target && deviceId && target !== deviceId) throw new Error('A2A action is assigned to another device');
    return target;
  };
  // Conversation messages are dispatched through a2a_actions.  Expose the
  // latest dispatch and its progress events alongside the messages so the UI
  // can show whether ziwei_user has received, started, or finished a reply.
  // The action payload is JSON (rather than a separate FK), therefore filter
  // the candidate rows after parsing to avoid matching a conversation id that
  // happens to occur in the prompt text.
  const conversationExecution = conversationId => {
    // A persistent conversation can be dispatched directly as
    // `conversation.execute`, or through a task created for a digital
    // employee (`task.execute`).  Both payloads carry conversationId.  The
    // UI needs the latest one regardless of which dispatch path was used.
    const candidates = db.prepare("SELECT * FROM a2a_actions WHERE payload_json LIKE ? ORDER BY created_at DESC").all(`%${String(conversationId)}%`);
    const row = candidates.find(candidate => parse(candidate.payload_json)?.conversationId === conversationId);
    if (!row) return null;
    let current = row;
    if (['pending','acked'].includes(current.status) && current.expires_at && Date.parse(current.expires_at) <= Date.now()) {
      const timestamp = now();
      db.prepare("UPDATE a2a_actions SET status='expired',completed_at=? WHERE id=? AND status IN ('pending','acked')").run(timestamp, current.id);
      current = { ...current, status:'expired', completed_at:timestamp };
    }
    const view = actionView(current);
    view.events = actionEvents(current.id);
    return view;
  };
  const taskExecutionMessage = (taskId, status, error = null, result = null) => {
    const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(taskId);
    if (!task) return null;
    const timestamp = now();
    const output = typeof result === 'string'
      ? result
      : (result?.output || result?.text || result?.result?.output || result?.result?.text || '');
    const detail = status === 'succeeded'
      ? `数字员工执行完成${output ? `：${String(output).slice(0, 3800)}` : ''}`
      : `数字员工执行失败：${String(error || '未知执行错误').slice(0, 3900)}`;
    const message = { id:id('msg'), task_id:taskId, role:'assistant', content:detail, created_at:timestamp };
    db.prepare('INSERT INTO task_messages(id,task_id,role,content,created_at) VALUES(?,?,?,?,?)').run(message.id, message.task_id, message.role, message.content, message.created_at);
    // A terminal runtime result is authoritative for an execution-backed task.
    // Keep manually cancelled/completed cards intact, but otherwise expose the
    // real daemon result in the board instead of leaving the card in progress.
    if (!['completed', 'cancelled'].includes(task.state)) {
      const nextState = status === 'succeeded' ? 'completed' : 'blocked';
      db.prepare('UPDATE tasks SET state=?,updated_at=? WHERE id=?').run(nextState, timestamp, taskId);
      const workspaceRow = db.prepare('SELECT slug FROM workspaces WHERE id=?').get(task.workspace_id);
      if (workspaceRow) audit(workspaceRow.slug, 'ziwei_user', `task.execution.${status}`, { taskId, from:task.state, to:nextState, error:error || null });
    }
    return message;
  };
  const markTaskRunning = taskId => {
    if (!taskId) return;
    const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(taskId);
    if (!task || ['in_progress','review','completed','blocked','cancelled'].includes(task.state)) return;
    const timestamp = now();
    db.prepare('UPDATE tasks SET state=?,updated_at=? WHERE id=?').run('in_progress', timestamp, taskId);
    const workspaceRow = db.prepare('SELECT slug FROM workspaces WHERE id=?').get(task.workspace_id);
    if (workspaceRow) audit(workspaceRow.slug, 'ziwei_user', 'task.execution.started', { taskId, from:task.state, to:'in_progress' });
  };
  return {
    db,
    getWorkspace(slug) { return workspace(slug); },
    getSummary(slug, options = {}) {
      const ws = workspace(slug);
      if (!ws) throw new Error('Workspace not found');
      const count = table => db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE workspace_id = ?`).get(ws.id).count;
      const tasks = db.prepare('SELECT state, COUNT(*) AS count FROM tasks WHERE workspace_id = ? GROUP BY state').all(ws.id);
      const visibleDevices = this.listDevices(slug, options);
      const ownedDevices = options.userId ? visibleDevices.filter(item => item.owner_user_id === options.userId) : visibleDevices;
      const device = ownDevice(ownedDevices);
      return { workspace: ws, counts: { tasks: count('tasks'), runtimes: device?.status === 'online' ? count('runtimes') : 0, members: count('members'), documents: count('documents'), automations: count('automations') }, taskStates: Object.fromEntries(tasks.map(row => [row.state, row.count])), device };
    },
    listTasks(slug, filters = {}) {
      const ws = workspace(slug); if (!ws) throw new Error('Workspace not found'); let sql = 'SELECT * FROM tasks WHERE workspace_id = ?'; const params = [ws.id];
      if (filters.state) { sql += ' AND state = ?'; params.push(filters.state); }
      if (filters.q) { sql += ' AND (title LIKE ? OR description LIKE ?)'; params.push(`%${filters.q}%`, `%${filters.q}%`); }
      const creator = filters.createdBy ?? filters.created_by ?? filters.creator;
      if (creator) { sql += ' AND created_by = ?'; params.push(String(creator)); }
      if (filters.assignee) { sql += ' AND assignee = ?'; params.push(String(filters.assignee)); }
      const tag = filters.tag ?? filters.label;
      if (tag) { sql += ' AND labels_json LIKE ?'; params.push(`%"${String(tag)}"%`); }
      const dateFrom = filters.dateFrom ?? filters.date_from ?? filters.dueFrom ?? filters.due_from;
      const dateTo = filters.dateTo ?? filters.date_to ?? filters.dueTo ?? filters.due_to;
      const exactDate = filters.dueDate ?? filters.due_date ?? filters.date;
      if (exactDate) { sql += ' AND due_date = ?'; params.push(String(exactDate)); }
      else {
        if (dateFrom) { sql += ' AND due_date >= ?'; params.push(String(dateFrom)); }
        if (dateTo) { sql += ' AND due_date <= ?'; params.push(String(dateTo)); }
      }
      sql += ' ORDER BY updated_at DESC';
      return db.prepare(sql).all(...params).map(row => ({
        ...row,
        labels: parse(row.labels_json),
        execution: actionView(db.prepare('SELECT * FROM a2a_actions WHERE task_id=? ORDER BY created_at DESC LIMIT 1').get(row.id), { includeEvents:true })
      }));
    },
    createTask(slug, input = {}) {
      const ws = workspace(slug); if (!ws) throw new Error('Workspace not found'); const created = now();
      const targetDeviceId = String(input.targetDeviceId || input.target_device_id || input.deviceId || input.device_id || '').trim() || null;
      if (targetDeviceId) {
        const device = db.prepare('SELECT * FROM devices WHERE id=? AND workspace_id=?').get(targetDeviceId, ws.id);
        if (!device) throw new Error('目标设备不属于当前工作区');
        if (device.status === 'disabled') throw new Error('目标设备已停用');
        const privilegedDeviceRole = ['owner', 'admin'].includes(String(input.actorRole || '').toLowerCase());
        if (ws.kind === 'personal' && input.enforceDeviceOwnership && !privilegedDeviceRole && (!input.actorUserId || device.owner_user_id !== input.actorUserId)) throw new Error('个人工作区只能使用本人的设备');
      }
      const descriptionFormat = normalizeDescriptionFormat(input.descriptionFormat ?? input.description_format);
      const rawDescription = String(input.description || '');
      const task = { id: id('task'), workspace_id: ws.id, title: String(input.title || '未命名任务').trim(), description: descriptionFormat === 'html' ? sanitizeHtml(rawDescription) : rawDescription, description_format: descriptionFormat, state: input.state || 'planned', priority: input.priority || 'medium', created_by: String(input.createdBy ?? input.created_by ?? input.creator ?? 'user').trim() || 'user', assignee: input.assignee || null, labels: Array.isArray(input.labels) ? input.labels : [], due_date: input.dueDate ?? input.due_date ?? null, created_at: created, updated_at: created };
      if (!task.title) throw new Error('Task title is required');
      db.prepare('INSERT INTO tasks(id,workspace_id,title,description,description_format,state,priority,created_by,assignee,labels_json,due_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(task.id,ws.id,task.title,task.description,task.description_format,task.state,task.priority,task.created_by,task.assignee,JSON.stringify(task.labels),task.due_date,created,created);
      audit(slug,'user','task.created',{taskId:task.id});
      if (input.runtime || input.model || input.execute === true) {
        const employee = employeeForInput(ws.id, input);
        const payload = executionPayload({
          prompt: task.description || task.title,
          employee,
          runtime: input.runtime || null,
          model: input.model || input.modelId || input.model_id || null,
          profile: input.profile ?? input.runtimeProfile ?? input.runtime_profile ?? input.hermesProfile ?? input.hermes_profile,
          taskId: task.id,
          cwd: input.cwd || null,
          conversationId: input.conversationId || input.conversation_id || null,
        });
        if (targetDeviceId) payload.deviceId = targetDeviceId;
        this.createA2AAction(slug,{agentId:'ziwei_user',taskId:task.id,type:'task.execute',dedupeKey:`task:${task.id}:execute`,payload});
      }
      return task;
    },
    updateTask(taskId, input = {}) {
      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
      if (!task) throw new Error('Task not found');
      const next = {
        title: input.title === undefined ? task.title : String(input.title || '').trim(),
        description: input.description === undefined ? task.description : String(input.description || ''),
        description_format: input.descriptionFormat === undefined && input.description_format === undefined ? (task.description_format || 'plain') : normalizeDescriptionFormat(input.descriptionFormat ?? input.description_format),
        state: input.state === undefined ? task.state : String(input.state),
        priority: input.priority === undefined ? task.priority : String(input.priority),
        created_by: input.createdBy === undefined && input.created_by === undefined && input.creator === undefined ? (task.created_by || 'user') : (String(input.createdBy ?? input.created_by ?? input.creator ?? 'user').trim() || 'user'),
        assignee: input.assignee === undefined ? task.assignee : (input.assignee || null),
        labels: input.labels === undefined ? parse(task.labels_json) : (Array.isArray(input.labels) ? input.labels : []),
        due_date: input.dueDate === undefined && input.due_date === undefined ? task.due_date : ((input.dueDate ?? input.due_date) || null),
        updated_at: now()
      };
      if (next.description_format === 'html') next.description = sanitizeHtml(next.description);
      if (!next.title) throw new Error('Task title is required');
      if (!['planned','todo','in_progress','review','completed','blocked'].includes(next.state)) throw new Error('Invalid task state');
      if (!['high','medium','low'].includes(next.priority)) throw new Error('Invalid task priority');
      db.prepare('UPDATE tasks SET title=?,description=?,description_format=?,state=?,priority=?,created_by=?,assignee=?,labels_json=?,due_date=?,updated_at=? WHERE id=?')
        .run(next.title, next.description, next.description_format, next.state, next.priority, next.created_by, next.assignee, JSON.stringify(next.labels), next.due_date, next.updated_at, taskId);
      const workspaceRow = db.prepare('SELECT slug FROM workspaces WHERE id=?').get(task.workspace_id);
      audit(workspaceRow.slug,'user','task.updated',{taskId});
      return { ...task, ...next, labels: next.labels };
    },
    transitionTask(taskId, to) {
      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId); if (!task) throw new Error('Task not found'); const state = transitionTask(task.state, to); const updated = now(); db.prepare('UPDATE tasks SET state=?,updated_at=? WHERE id=?').run(state,updated,taskId); const ws = db.prepare('SELECT slug FROM workspaces WHERE id=?').get(task.workspace_id); if (ws) audit(ws.slug,'user','task.state_changed',{taskId,from:task.state,to:state}); return {...task,state,updated_at:updated,labels:parse(task.labels_json)};
    },
    listRuntimes(slug, options = {}) {
      const ws = workspace(slug);
      const devices = this.listDevices(slug, options);
      const ownedDevices = options.userId ? devices.filter(item => item.owner_user_id === options.userId) : devices;
      const device = ownDevice(ownedDevices) || (ws.kind === 'team' ? ownDevice(devices) : null);
      const onlineDeviceIds = devices.filter(item => item.status === 'online').map(item => item.id);
      const online = device?.status === 'online';
      // The bridge owns liveness; each agent keeps its own locally discovered
      // CLI identity/version.  We never use an Aura daemon to infer either.
      const discovery = online ? discover() : null;
      db.prepare('UPDATE runtimes SET status=? WHERE workspace_id=?').run(online ? 'online' : 'offline', ws.id);
      const metadata = Object.fromEntries(db.prepare('SELECT * FROM runtime_metadata WHERE workspace_id=?').all(ws.id).map(item => [item.runtime_name, item]));
      return db.prepare('SELECT * FROM runtimes WHERE workspace_id = ? ORDER BY name').all(ws.id).map(row => ({
        ...row,
        // The runtime's version is the CLI probe result, never the old seed
        // catalog value.  Keep the catalog value only as an internal legacy
        // field so disconnected devices do not appear to have a live CLI.
        version: online ? (discovery?.agents?.[row.name]?.version || metadata[row.name]?.version || null) : null,
        status: online ? 'online' : 'offline',
        last_seen: device?.last_seen || row.last_seen,
        capabilities: parse(row.capabilities_json),
        // Only a successful local probe may fill cli_version; bridge_version
        // remains the ziwei_user version below.
        cli_version: online ? (discovery?.agents?.[row.name]?.version || metadata[row.name]?.version || null) : null,
        cli_binary: online ? (discovery?.agents?.[row.name]?.binary || metadata[row.name]?.binary || null) : null,
        cli_status: online ? ((discovery?.agents?.[row.name]?.status === 'available' || metadata[row.name]?.status === 'available') ? 'available' : 'unavailable') : 'offline',
        profiles: row.name.toLowerCase() === 'hermes' ? (() => { try { return JSON.parse(metadata[row.name]?.profiles_json || '[]'); } catch { return []; } })() : [],
        bridge_name: device?.bridge_name || 'ziwei_user',
        bridge_version: device?.bridge_version || null,
        bridge_status: online ? (device.bridge_status || 'online') : 'offline',
        available_device_ids: onlineDeviceIds,
        available_device_count: onlineDeviceIds.length
      }));
    },
    registerRuntimes(slug, input = {}) {
      const ws = workspace(slug); if (!ws) throw new Error('Workspace not found');
      const deviceId = String(input.deviceId ?? input.device_id ?? '').trim() || null;
      if (deviceId && !db.prepare('SELECT 1 FROM devices WHERE id=? AND workspace_id=?').get(deviceId, ws.id)) throw new Error('运行时设备不属于当前工作区');
      const source = input.runtimes || input.runtimeMetadata || input.runtime_metadata || {};
      const entries = Array.isArray(source) ? source.map(item => [item.runtime || item.name, item]) : Object.entries(source);
      const timestamp = now();
      const providers = { Claude: 'Anthropic', Codex: 'OpenAI', Gemini: 'Google', Hermes: 'Hermes' };
      const capabilities = {
        Claude: ['chat', 'code', 'browser'],
        Codex: ['code', 'review', 'terminal'],
        Gemini: ['research', 'vision', 'chat'],
        Hermes: ['orchestration', 'a2a', 'automation']
      };
      for (const [nameValue, raw] of entries) {
        const name = String(nameValue || '').trim(); if (!name || !raw || typeof raw !== 'object') continue;
        const version = raw.version ? String(raw.version) : null;
        const binary = raw.binary ? String(raw.binary) : null;
        const status = raw.status ? String(raw.status) : (version ? 'available' : 'unavailable');
        const models = Array.isArray(raw.models) ? raw.models.filter(item => item && typeof item === 'object').slice(0, 100) : [];
        const profiles = name.toLowerCase() === 'hermes' && Array.isArray(raw.profiles) ? raw.profiles.filter(item => item && typeof item === 'object' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(String(item.name || ''))).slice(0, 100) : [];
        const existing = db.prepare('SELECT id FROM runtime_metadata WHERE workspace_id=? AND runtime_name=?').get(ws.id, name);
        if (existing) db.prepare('UPDATE runtime_metadata SET version=?,binary=?,status=?,models_json=?,profiles_json=?,last_seen=? WHERE id=?').run(version,binary,status,JSON.stringify(models),JSON.stringify(profiles),timestamp,existing.id);
        else db.prepare('INSERT INTO runtime_metadata(id,workspace_id,runtime_name,version,binary,status,models_json,profiles_json,last_seen) VALUES(?,?,?,?,?,?,?,?,?)').run(id('runtime-meta'),ws.id,name,version,binary,status,JSON.stringify(models),JSON.stringify(profiles),timestamp);
        if (deviceId) {
          const deviceExisting = db.prepare('SELECT id FROM runtime_device_metadata WHERE device_id=? AND runtime_name=?').get(deviceId, name);
          if (deviceExisting) db.prepare('UPDATE runtime_device_metadata SET version=?,binary=?,status=?,models_json=?,profiles_json=?,last_seen=? WHERE id=?').run(version,binary,status,JSON.stringify(models),JSON.stringify(profiles),timestamp,deviceExisting.id);
          else db.prepare('INSERT INTO runtime_device_metadata(id,workspace_id,device_id,runtime_name,version,binary,status,models_json,profiles_json,last_seen) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id('runtime-device-meta'),ws.id,deviceId,name,version,binary,status,JSON.stringify(models),JSON.stringify(profiles),timestamp);
        }
        const runtime = db.prepare('SELECT id FROM runtimes WHERE workspace_id=? AND name=?').get(ws.id,name);
        if (runtime) {
          db.prepare('UPDATE runtimes SET version=?,last_seen=? WHERE id=?').run(version,timestamp,runtime.id);
        } else {
          // A newly created workspace has no seeded runtime rows.  The local
          // ziwei_user heartbeat is the source of truth, so create the catalog
          // row from the discovered CLI instead of leaving the device with
          // zero visible Agent environments.
          db.prepare('INSERT INTO runtimes(id,workspace_id,name,provider,version,status,capabilities_json,last_seen) VALUES(?,?,?,?,?,?,?,?)')
            .run(id('runtime'), ws.id, name, providers[name] || name, version, 'online', JSON.stringify(capabilities[name] || []), timestamp);
        }
      }
      return this.listRuntimes(slug);
    },
    listHermesProfiles(slug, options = {}) {
      const ws = workspace(slug); if (!ws) throw new Error('Workspace not found');
      const requestedDeviceId = String(options.deviceId ?? options.device_id ?? '').trim();
      const listedDevices = this.listDevices(slug);
      const device = requestedDeviceId ? listedDevices.find(item => item.id === requestedDeviceId) : ownDevice(listedDevices);
      const metadata = requestedDeviceId
        ? db.prepare("SELECT profiles_json FROM runtime_device_metadata WHERE workspace_id=? AND device_id=? AND lower(runtime_name)='hermes' ORDER BY last_seen DESC LIMIT 1").get(ws.id, requestedDeviceId)
        : db.prepare("SELECT profiles_json FROM runtime_metadata WHERE workspace_id=? AND lower(runtime_name)='hermes' ORDER BY last_seen DESC LIMIT 1").get(ws.id);
      let profiles = [];
      try { profiles = JSON.parse(metadata?.profiles_json || '[]'); } catch { profiles = []; }
      if (!profiles.length && !requestedDeviceId) profiles = listHermesProfiles();
      const source = device?.status === 'online' ? 'ziwei_user' : (profiles.length ? 'local_runtime_home' : 'unavailable');
      return { runtime: 'Hermes', source, independent_home: true, profiles: Array.isArray(profiles) ? profiles : [], validation: { rejects_unknown: Boolean(profiles.length) } };
    },
    createHermesProfileAction(slug, input = {}) {
      const ws = workspace(slug); if (!ws) throw new Error('Workspace not found');
      const profile = normalizeRuntimeProfile(input.profile ?? input.profileName ?? input.profile_name ?? input.runtimeProfile ?? input.runtime_profile ?? input.name);
      if (!profile || profile.toLowerCase() === 'default') throw new Error('不能创建 Hermes default profile');
      const deviceId = String(input.deviceId ?? input.device_id ?? input.targetDeviceId ?? input.target_device_id ?? '').trim();
      if (!deviceId) throw new Error('创建 Hermes profile 必须绑定 deviceId');
      const device = db.prepare('SELECT * FROM devices WHERE id=? AND workspace_id=?').get(deviceId, ws.id);
      if (!device) throw new Error('目标设备不属于当前工作区');
      const status = device.status === 'disabled' ? 'disabled' : (isFresh(device.last_seen) ? 'online' : 'offline');
      if (status !== 'online') throw new Error('目标设备当前离线，无法创建 Hermes profile');
      const actorUserId = String(input.userId ?? input.user_id ?? input.actorUserId ?? input.actor_user_id ?? '').trim() || null;
      const actorRole = String(input.actorRole ?? input.actor_role ?? '').trim().toLowerCase();
      const teamMember = ws.kind === 'team' && actorUserId
        ? Boolean(db.prepare('SELECT 1 FROM members WHERE workspace_id=? AND user_id=?').get(ws.id, actorUserId))
        : false;
      if (!['owner', 'admin'].includes(actorRole) && !teamMember && !this.canManageDevice(deviceId, actorUserId, actorRole, slug)) { const error = new Error('当前用户无权在该设备创建 Hermes profile'); error.status = 403; throw error; }
      const soul = String(input.soul ?? input.soulMd ?? input.soul_md ?? input.instructions ?? input.files?.['SOUL.md'] ?? `# ${profile}\n`);
      if (Buffer.byteLength(soul, 'utf8') > 10 * 1024 * 1024) throw new Error('Hermes profile 内容超过 10 MiB');
      const files = input.files && typeof input.files === 'object' && !Array.isArray(input.files)
        ? Object.fromEntries(Object.entries(input.files).filter(([name]) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.md$/i.test(name) && String(name).toUpperCase() !== 'SOUL.MD').map(([name, value]) => [name, String(value ?? '')]))
        : {};
      if (input.memory ?? input.memoryMd ?? input.memory_md) files['MEMORY.md'] = String(input.memory ?? input.memoryMd ?? input.memory_md);
      if (input.identity ?? input.identityMd ?? input.identity_md) files['IDENTITY.md'] = String(input.identity ?? input.identityMd ?? input.identity_md);
      if (Object.values(files).some(value => Buffer.byteLength(String(value), 'utf8') > 10 * 1024 * 1024) || Buffer.byteLength(soul, 'utf8') + Object.values(files).reduce((total, value) => total + Buffer.byteLength(String(value), 'utf8'), 0) > 10 * 1024 * 1024) throw new Error('Hermes profile 内容超过 10 MiB');
      const requestKey = String(input.idempotencyKey ?? input.idempotency_key ?? '').trim();
      const memory = String(input.memory ?? input.memoryMd ?? input.memory_md ?? '');
      const identity = String(input.identity ?? input.identityMd ?? input.identity_md ?? '');
      const fingerprint = hashSecret(JSON.stringify({ profile, soul, files, memory, identity }));
      const dedupeKey = `hermes.profile.create:${ws.id}:${deviceId}:${actorUserId || 'anonymous'}:${profile}:${requestKey || fingerprint}`;
      const action = this.createA2AAction(slug, {
        agentId: 'ziwei_user',
        type: 'hermes.profile.create',
        dedupeKey,
        payload: { workspace: slug, workspaceId: ws.id, deviceId, userId: actorUserId, profile, soul, files, ...(memory ? { memory } : {}), ...(identity ? { identity } : {}) }
      });
      const row = db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(action.id);
      return { ...actionView(row, { includeEvents: true }), duplicate: Boolean(action.duplicate) };
    },
    listModels(slug, filters = {}) {
      const ws = workspace(slug); if (!ws) throw new Error('Workspace not found');
      const device = ownDevice(this.listDevices(slug));
      // A model is selectable only when the own ziwei_user bridge is online
      // and has reported/located it on this computer.  No vendor catalog is
      // substituted when discovery has no answer; the UI can accept a manual
      // model ID in that case.
      const discovery = device?.status === 'online' ? discover() : null;
      const metadata = Object.fromEntries(db.prepare('SELECT * FROM runtime_metadata WHERE workspace_id=?').all(ws.id).map(item => [item.runtime_name, item]));
      const mergedDiscovery = discovery || { agents: {} };
      for (const [name, item] of Object.entries(metadata)) {
        const current = mergedDiscovery.agents[name] || {};
        const models = (() => { try { return JSON.parse(item.models_json || '[]'); } catch { return []; } })();
        const combinedModels = [...(Array.isArray(current.models) ? current.models : []), ...models];
        const seenModels = new Set();
        mergedDiscovery.agents[name] = { ...current, version: current.version || item.version, binary: current.binary || item.binary, status: current.status === 'available' ? current.status : item.status, models: combinedModels.filter(model => { const key = String(model?.id || ''); if (!key || seenModels.has(key)) return false; seenModels.add(key); return true; }) };
      }
      return listModels({ runtime: filters.runtime, query: filters.q, discovery: mergedDiscovery });
    },
    listSkills(slug, filters = {}) {
      const ws = workspace(slug);
      if (!ws) throw new Error('Workspace not found');
      const normalized = typeof filters === 'string' ? { category: filters } : (filters || {});
      const clauses = ['workspace_id=?']; const params = [ws.id];
      if (normalized.category && normalized.category !== 'all') { clauses.push('category=?'); params.push(String(normalized.category)); }
      if (normalized.scope && normalized.scope !== 'all') { clauses.push('scope=?'); params.push(String(normalized.scope)); }
      if (normalized.q) { clauses.push('(name LIKE ? OR description LIKE ? OR tags_json LIKE ?)'); const needle = `%${String(normalized.q).trim()}%`; params.push(needle, needle, needle); }
      const rows = db.prepare(`SELECT * FROM skills WHERE ${clauses.join(' AND ')} ORDER BY recommended DESC, name`).all(...params);
      return rows.map(toSkillRecord);
    },
    createSkill(slug, input = {}) {
      const ws = workspace(slug); if (!ws) throw new Error('Workspace not found');
      const timestamp = now(); const scope = input.scope === 'platform' ? 'platform' : 'team';
      const skill = { id: id('skill'), workspace_id: ws.id, name: String(input.name || '').trim(), description: String(input.description || '').trim(), category: String(input.category || 'productivity').trim(), installed: 0, source: scope, scope, recommended: 0, install_count: 0, icon: String(input.icon || '✦'), author: String(input.author || '紫薇团队'), tags: Array.isArray(input.tags) ? input.tags : [], created_at: timestamp, updated_at: timestamp };
      if (!skill.name) throw new Error('技能名称不能为空');
      db.prepare('INSERT INTO skills(id,workspace_id,name,description,category,installed,source,scope,recommended,install_count,icon,author,tags_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(skill.id, ws.id, skill.name, skill.description, skill.category, 0, skill.source, skill.scope, 0, 0, skill.icon, skill.author, JSON.stringify(skill.tags), timestamp, timestamp);
      audit(slug, 'user', 'skill.created', { skillId: skill.id, scope });
      return skill;
    },
    async importSkill(slug, input = {}) {
      const ws = workspace(slug);
      if (!ws) throw new Error('Workspace not found');
      let content = String(input.content ?? input.markdown ?? '');
      const requestedSourceType = String(input.sourceType || input.source_type || '').toLowerCase();
      const archive = input.archive ?? input.zip ?? input.archiveBase64 ?? input.zipBase64 ?? input.archive_data ?? input.zip_data ?? (input.file && typeof input.file === 'object' ? input.file.data : null);
      const sourceType = requestedSourceType === 'workstation' || requestedSourceType === 'station' || requestedSourceType === 'device'
        ? 'workstation' : requestedSourceType === 'copy' ? 'copy' : (archive || requestedSourceType === 'zip' ? 'zip' : (input.sourceType === 'url' || input.url ? 'url' : 'local'));
      const sourceUrl = input.url ? String(input.url).trim() : null;
      let archivePath = null;
      if (!content && archive) {
        const extracted = extractSkillMarkdownArchive(archive);
        content = extracted.content;
        archivePath = extracted.path;
      }
      if (!content && sourceUrl) {
        let parsedUrl;
        try { parsedUrl = new URL(sourceUrl); } catch { throw new Error('技能 URL 无效'); }
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('技能 URL 只支持 HTTP 或 HTTPS');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        try {
          const response = await fetch(parsedUrl, { signal: controller.signal, redirect: 'follow' });
          if (!response.ok) throw new Error(`技能 URL 返回 HTTP ${response.status}`);
          content = await response.text();
        } catch (error) {
          if (error?.name === 'AbortError') throw new Error('技能 URL 请求超时');
          throw new Error(error?.message || '技能 URL 获取失败');
        } finally { clearTimeout(timer); }
      }
      if (!content.trim()) throw new Error('请上传 SKILL.md 内容或填写 URL');
      if (Buffer.byteLength(content, 'utf8') > MAX_SKILL_BYTES) throw new Error('SKILL.md 不能超过 1 MiB');
      const parsed = parseSkillMarkdown(content);
      const validated = validateSkillDocument({ content, name: input.name, version: input.version, parsed });
      const metadata = parsed.metadata || {};
      const name = validated.name;
      const description = String(input.description || metadata.description || parsed.firstParagraph || '').trim();
      const category = String(input.category || metadata.category || 'productivity').trim() || 'productivity';
      const tags = Array.isArray(input.tags) && input.tags.length ? input.tags : (metadata.tags || []);
      const version = validated.version;
      const errors = [...validated.errors];
      if (sourceType === 'url' && !sourceUrl) errors.push('URL 来源缺少地址');
      const contentHash = hashSkillContent(content);
      const duplicate = db.prepare('SELECT * FROM skills WHERE workspace_id=? AND content_hash=?').get(ws.id, contentHash);
      if (duplicate) return { ...toSkillRecord(duplicate), duplicate: true, validation_status: duplicate.validation_status || 'valid' };
      const timestamp = now();
      const sourceDeviceId = input.sourceDeviceId || input.source_device_id || input.stationId || input.station_id || input.deviceId || input.device_id || null;
      const sourcePath = input.sourcePath || input.source_path || archivePath || null;
      if (sourceType === 'workstation' && !sourceDeviceId && !input.sourceSkillId && !input.source_skill_id) errors.push('工位来源缺少 deviceId');
      if (sourceType === 'workstation' && sourceDeviceId) {
        const device = db.prepare('SELECT id,status FROM devices WHERE id=? AND workspace_id=?').get(String(sourceDeviceId), ws.id);
        if (!device) errors.push('工位来源不存在或不属于当前工作区');
        else if (device.status !== 'online') errors.push('工位来源当前不在线，无法复制技能');
      }
      const skill = {
        id: id('skill'), workspace_id: ws.id, name: name || '未命名技能', description,
        category, installed: 0, source: 'imported', scope: input.scope === 'platform' ? 'platform' : 'team',
        recommended: 0, install_count: 0, icon: String(input.icon || '✦'), author: String(input.author || '本地导入'), tags,
        created_at: timestamp, updated_at: timestamp, source_type: sourceType, source_url: sourceUrl,
        source_device_id: sourceDeviceId, source_path: sourcePath,
        content, content_hash: contentHash, version, validation_status: errors.length ? 'invalid' : 'valid',
        validation_error: errors.length ? errors.join('；') : null, imported_at: timestamp
      };
      db.prepare(`INSERT INTO skills(
        id,workspace_id,name,description,category,installed,source,scope,recommended,install_count,icon,author,tags_json,
        created_at,updated_at,source_type,source_url,source_device_id,source_path,content,content_hash,version,validation_status,validation_error,imported_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        skill.id, ws.id, skill.name, skill.description, skill.category, 0, skill.source, skill.scope, 0, 0,
        skill.icon, skill.author, JSON.stringify(skill.tags), timestamp, timestamp, skill.source_type, skill.source_url,
        skill.source_device_id, skill.source_path, skill.content, skill.content_hash, skill.version, skill.validation_status, skill.validation_error, skill.imported_at
      );
      audit(slug, 'user', 'skill.imported', { skillId: skill.id, sourceType, sourceUrl, sourceDeviceId, sourcePath, contentHash, validationStatus: skill.validation_status });
      return { ...skill, duplicate: false };
    },
    listSkillSources(slug) {
      const ws = workspace(slug); if (!ws) throw new Error('Workspace not found');
      const devices = this.listDevices(slug).filter(device => device.bridge_name === 'ziwei_user' || device.bridge_name === '');
      return devices.map(device => ({ id: device.id, device_id: device.id, name: device.name, os: device.os, status: device.status, last_seen: device.last_seen, copy_supported: device.status === 'online', runtimes: this.listRuntimes(slug).filter(runtime => runtime.status === 'online').map(runtime => runtime.name) }));
    },
    async copySkill(slug, input = {}) {
      const sourceSkillId = input.sourceSkillId || input.source_skill_id;
      const requestedSource = String(input.sourceType || input.source_type || 'workstation').toLowerCase();
      if (!sourceSkillId && !['copy'].includes(requestedSource)) {
        const sourceDeviceId = input.sourceDeviceId || input.source_device_id || input.stationId || input.station_id || input.deviceId || input.device_id;
        if (!sourceDeviceId) throw new Error('工位来源缺少 deviceId');
        const ws = workspace(slug); if (!ws) throw new Error('Workspace not found');
        const device = db.prepare('SELECT id,status FROM devices WHERE id=? AND workspace_id=?').get(String(sourceDeviceId), ws.id);
        if (!device) throw new Error('工位来源不存在或不属于当前工作区');
        if (device.status !== 'online') throw new Error('工位来源当前不在线，无法复制技能');
      }
      if (sourceSkillId) {
        const ws = workspace(slug); if (!ws) throw new Error('Workspace not found');
        const source = db.prepare('SELECT * FROM skills WHERE id=? AND workspace_id=?').get(sourceSkillId, ws.id);
        if (!source) throw new Error('来源技能不存在或不属于当前工作区');
        return this.importSkill(slug, { ...input, content: source.content, name: input.name || source.name, description: input.description || source.description, version: input.version || source.version, category: input.category || source.category, tags: input.tags || parse(source.tags_json), sourceType: input.sourceType || 'copy', sourceDeviceId: input.sourceDeviceId || input.source_device_id || null, sourcePath: input.sourcePath || source.source_path || source.name });
      }
      return this.importSkill(slug, { ...input, sourceType: input.sourceType || 'workstation' });
    },
    setSkillInstalled(skillId, installed) {
      const row = db.prepare('SELECT * FROM skills WHERE id=?').get(skillId); if (!row) throw new Error('Skill not found');
      if (installed && row.validation_status === 'invalid') throw new Error(`技能校验失败：${row.validation_error || 'SKILL.md 无效'}`);
      if (installed && !row.installed) {
        db.prepare('INSERT INTO skill_versions(id,skill_id,version,content,content_hash,metadata_json,created_at) VALUES(?,?,?,?,?,?,?)').run(id('skillver'),skillId,row.version,row.content || '',row.content_hash || null,JSON.stringify({name:row.name,description:row.description,category:row.category}),now());
        db.prepare('UPDATE skills SET installed=1,install_count=install_count+1,updated_at=? WHERE id=?').run(now(), skillId);
      } else if (!installed) {
        db.prepare('UPDATE skills SET installed=0,updated_at=? WHERE id=?').run(now(), skillId);
        db.prepare('UPDATE employees SET skills_json=REPLACE(skills_json,?,?) WHERE skills_json LIKE ?').run(`"${skillId}"`, '""', `%"${skillId}"%`);
      }
      const updated = db.prepare('SELECT * FROM skills WHERE id=?').get(skillId);
      return toSkillRecord(updated);
    },
    uninstallSkill(skillId) { const row=db.prepare('SELECT * FROM skills WHERE id=?').get(skillId); if(!row) throw new Error('Skill not found'); const affected=db.prepare('SELECT id FROM employees WHERE skills_json LIKE ?').all(`%"${skillId}"%`).map(item=>item.id); this.setSkillInstalled(skillId,false); return {...toSkillRecord(db.prepare('SELECT * FROM skills WHERE id=?').get(skillId)),uninstalled:true,affectedEmployees:affected}; },
    listSkillVersions(skillId) { return db.prepare('SELECT id,skill_id,version,content_hash,metadata_json,created_at FROM skill_versions WHERE skill_id=? ORDER BY created_at DESC').all(skillId).map(row=>({...row,metadata:jsonObject(row.metadata_json)})); },
    rollbackSkill(skillId, versionId = null) { const row=db.prepare('SELECT * FROM skills WHERE id=?').get(skillId); if(!row) throw new Error('Skill not found'); const snapshot=versionId ? db.prepare('SELECT * FROM skill_versions WHERE id=? AND skill_id=?').get(versionId,skillId) : db.prepare('SELECT * FROM skill_versions WHERE skill_id=? ORDER BY created_at DESC LIMIT 1').get(skillId); if(!snapshot) throw new Error('技能没有可回滚版本'); const metadata=jsonObject(snapshot.metadata_json); db.prepare('UPDATE skills SET name=?,description=?,category=?,content=?,content_hash=?,version=?,validation_status=\'valid\',validation_error=NULL,updated_at=? WHERE id=?').run(metadata.name || row.name,metadata.description || row.description,metadata.category || row.category,snapshot.content,snapshot.content_hash || null,snapshot.version || row.version,now(),skillId); return toSkillRecord(db.prepare('SELECT * FROM skills WHERE id=?').get(skillId)); },
    listDocuments(slug, options = {}) { const ws = workspace(slug); const where = options.includeDeleted ? '' : ' AND deleted_at IS NULL'; return db.prepare(`SELECT * FROM documents WHERE workspace_id=?${where} ORDER BY type DESC,name`).all(ws.id); },
    listDocumentTrash(slug) { const ws = workspace(slug); return db.prepare("SELECT * FROM documents WHERE workspace_id=? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC").all(ws.id); },
    getDocument(documentId, options = {}) { const row = db.prepare('SELECT * FROM documents WHERE id=?').get(documentId); if (!row || (!options.includeDeleted && row.deleted_at)) return null; return row; },
    createDocument(slug, input = {}) {
      const ws = workspace(slug); if (!ws) throw new Error('Workspace not found'); const parentId = input.parentId || input.parent_id || null;
      if (parentId && !db.prepare("SELECT 1 FROM documents WHERE id=? AND workspace_id=? AND type='folder' AND deleted_at IS NULL").get(parentId, ws.id)) throw new Error('Parent folder not found');
      const type = input.type === 'folder' ? 'folder' : 'file';
      const encoding = input.contentEncoding || input.content_encoding || (input.data !== undefined ? 'base64' : 'utf8');
      const payload = type === 'folder' ? { content:'', bytes:Buffer.alloc(0), encoding:'utf8' } : normalizeDocumentPayload(input.data !== undefined ? input.data : input.content, encoding);
      const timestamp = now();
      const stored = objectStore && type === 'file' ? objectStore.put(payload.bytes) : null;
      const doc = {id:id('doc'),workspace_id:ws.id,parent_id:parentId,name:String(input.name || '未命名').trim() || '未命名',type,content:stored ? '' : payload.content,size:payload.bytes.length,mime_type:String(input.mimeType || input.mime_type || (type === 'file' ? 'text/markdown' : 'application/octet-stream')),storage_key:stored?.key || input.storageKey || input.storage_key || null,checksum:documentChecksum(payload.bytes),content_encoding:stored ? 'base64' : payload.encoding,deleted_at:null,deleted_by:null,updated_at:timestamp};
      db.prepare('INSERT INTO documents(id,workspace_id,parent_id,name,type,content,size,mime_type,storage_key,checksum,content_encoding,deleted_at,deleted_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(doc.id,ws.id,doc.parent_id,doc.name,doc.type,doc.content,doc.size,doc.mime_type,doc.storage_key,doc.checksum,doc.content_encoding,null,null,doc.updated_at);
      if (doc.type === 'file') db.prepare('INSERT INTO document_versions(id,document_id,version,content,size,mime_type,storage_key,checksum,content_encoding,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id('docver'),doc.id,1,doc.content,doc.size,doc.mime_type,doc.storage_key,doc.checksum,doc.content_encoding,doc.updated_at);
      audit(slug,'user','document.created',{documentId:doc.id}); return doc;
    },
    updateDocument(documentId, input = {}) {
      const row = this.getDocument(documentId); if (!row) throw new Error('Document not found'); const name = input.name === undefined ? row.name : String(input.name).trim(); if (!name) throw new Error('文档名称不能为空');
      const parentId = input.parentId === undefined && input.parent_id === undefined ? row.parent_id : (input.parentId || input.parent_id || null); if (parentId && parentId === row.id) throw new Error('文档不能移动到自身');
      if (parentId && !db.prepare("SELECT 1 FROM documents WHERE id=? AND workspace_id=? AND type='folder' AND deleted_at IS NULL").get(parentId, row.workspace_id)) throw new Error('目标文件夹不存在');
      if (parentId && row.type === 'folder') {
        // A folder cannot be moved below any of its descendants. Traverse the
        // proposed parent's ancestors so corrupted/cyclic rows fail closed.
        const seen = new Set(); let cursor = parentId;
        while (cursor) {
          if (cursor === row.id) throw new Error('文件夹不能移动到自己的子文件夹');
          if (seen.has(cursor)) throw new Error('文档目录存在循环引用');
          seen.add(cursor);
          cursor = db.prepare('SELECT parent_id FROM documents WHERE id=? AND workspace_id=?').get(cursor, row.workspace_id)?.parent_id || null;
        }
      }
      let content = row.content; let size = Number(row.size || 0); let encoding = row.content_encoding || 'utf8'; let bytes = row.storage_key && objectStore ? objectStore.get(row.storage_key, { checksum: row.checksum }) : (encoding === 'base64' ? decodeDocumentBase64(content) : Buffer.from(String(content || ''), 'utf8'));
      const hasContent = row.type === 'file' && (input.content !== undefined || input.data !== undefined);
      if (hasContent) {
        encoding = input.contentEncoding || input.content_encoding || (input.data !== undefined ? 'base64' : 'utf8');
        const payload = normalizeDocumentPayload(input.data !== undefined ? input.data : input.content, encoding);
        const stored = objectStore ? objectStore.put(payload.bytes) : null;
        content = stored ? '' : payload.content; bytes = payload.bytes; encoding = stored ? 'base64' : payload.encoding; size = bytes.length;
        if (stored) input = { ...input, storageKey: stored.key };
      }
      const mimeType = input.mimeType || input.mime_type || row.mime_type || 'text/markdown'; const storageKey = input.storageKey === undefined && input.storage_key === undefined ? row.storage_key : (input.storageKey || input.storage_key || null); const checksum = documentChecksum(bytes); const updated = now();
      db.prepare('UPDATE documents SET name=?,parent_id=?,content=?,size=?,mime_type=?,storage_key=?,checksum=?,content_encoding=?,updated_at=? WHERE id=?').run(name,parentId,content,size,mimeType,storageKey,checksum,encoding,updated,row.id);
      const changed = row.type === 'file' && (content !== row.content || encoding !== row.content_encoding || mimeType !== row.mime_type || storageKey !== row.storage_key || checksum !== row.checksum);
      if (changed) { const latest=db.prepare('SELECT MAX(version) AS version FROM document_versions WHERE document_id=?').get(row.id).version || 0; db.prepare('INSERT INTO document_versions(id,document_id,version,content,size,mime_type,storage_key,checksum,content_encoding,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id('docver'),row.id,latest+1,content,size,mimeType,storageKey,checksum,encoding,updated); }
      audit(db.prepare('SELECT slug FROM workspaces WHERE id=?').get(row.workspace_id).slug,'user','document.updated',{documentId:row.id}); return this.getDocument(row.id);
    },
    listDocumentVersions(documentId) { const row=this.getDocument(documentId); if (!row) throw new Error('Document not found'); return db.prepare('SELECT id,document_id,version,size,mime_type,storage_key,checksum,content_encoding,created_at FROM document_versions WHERE document_id=? ORDER BY version DESC').all(documentId); },
    restoreDocumentVersion(documentId, version) { const row=this.getDocument(documentId); if (!row) throw new Error('Document not found'); const snapshot=db.prepare('SELECT * FROM document_versions WHERE document_id=? AND version=?').get(documentId,Number(version)); if (!snapshot) throw new Error('Document version not found'); if (objectStore && snapshot.storage_key) { const bytes=objectStore.get(snapshot.storage_key,{checksum:snapshot.checksum}); return this.updateDocument(documentId,{data:bytes.toString('base64'),contentEncoding:'base64',mimeType:snapshot.mime_type || row.mime_type}); } return this.updateDocument(documentId,{data:snapshot.content,contentEncoding:snapshot.content_encoding || 'utf8',mimeType:snapshot.mime_type || row.mime_type,storageKey:snapshot.storage_key}); },
    deleteDocument(documentId, actor = 'user') { const row = this.getDocument(documentId); if (!row) throw new Error('Document not found'); const workspaceRow = db.prepare('SELECT slug FROM workspaces WHERE id=?').get(row.workspace_id); const ids = [row.id]; if (row.type === 'folder') { const queue = [row.id]; while (queue.length) { const parent = queue.shift(); const children = db.prepare('SELECT id,type FROM documents WHERE parent_id=? AND deleted_at IS NULL').all(parent); for (const child of children) { ids.push(child.id); if (child.type === 'folder') queue.push(child.id); } } } const placeholders = ids.map(() => '?').join(','); const deletedAt = now(); db.prepare(`UPDATE documents SET deleted_at=?,deleted_by=?,updated_at=? WHERE id IN (${placeholders})`).run(deletedAt,actor,deletedAt,...ids); audit(workspaceRow.slug,'user','document.deleted',{documentId:row.id,deletedCount:ids.length}); return {...row,deleted_at:deletedAt,deleted_by:actor}; },
    restoreDocument(documentId) {
      const row = this.getDocument(documentId,{includeDeleted:true}); if (!row) throw new Error('Document not found');
      const ws = db.prepare('SELECT slug FROM workspaces WHERE id=?').get(row.workspace_id); const ids = new Set([row.id]);
      // Restore descendants that were soft-deleted with a folder, preserving
      // the original tree. If a child is restored after its deleted parent,
      // restore the deleted ancestor chain as well so it never becomes an
      // unreachable row under a hidden folder.
      if (row.type === 'folder') { const queue=[row.id]; while(queue.length){ const parent=queue.shift(); const children=db.prepare('SELECT id,type FROM documents WHERE parent_id=? AND workspace_id=?').all(parent,row.workspace_id); for(const child of children){ids.add(child.id); if(child.type==='folder') queue.push(child.id);}} }
      let cursor = row.parent_id; const seen = new Set(); while (cursor) { if (seen.has(cursor)) throw new Error('文档目录存在循环引用'); seen.add(cursor); const parent = db.prepare('SELECT id,parent_id,deleted_at FROM documents WHERE id=? AND workspace_id=?').get(cursor,row.workspace_id); if (!parent) break; if (parent.deleted_at) ids.add(parent.id); else break; cursor = parent.parent_id || null; }
      const values=[...ids]; const placeholders=values.map(()=>'?').join(','); db.prepare(`UPDATE documents SET deleted_at=NULL,deleted_by=NULL,updated_at=? WHERE id IN (${placeholders})`).run(now(),...values); audit(ws.slug,'user','document.restored',{documentId:row.id,restoredCount:values.length}); return this.getDocument(row.id);
    },
    downloadDocument(documentId) { const row=this.getDocument(documentId); if(!row) throw new Error('Document not found'); if (objectStore && row.storage_key) { const bytes=objectStore.get(row.storage_key,{checksum:row.checksum}); return {id:row.id,name:row.name,mime_type:row.mime_type,size:bytes.length,content:bytes.toString('base64'),content_encoding:'base64',checksum:row.checksum,storage_key:row.storage_key}; } return {id:row.id,name:row.name,mime_type:row.mime_type,size:row.size,content:row.content,content_encoding:row.content_encoding,checksum:row.checksum,storage_key:row.storage_key}; },
    listAutomationTemplates() {
      return [
        { id:'daily-summary', name:'每日工作区摘要', description:'汇总当天任务、运行时和自动化结果。', schedule:'每天 09:00', prompt:'生成工作区日报，列出已完成、进行中和阻塞任务。' },
        { id:'overdue-reminder', name:'逾期任务提醒', description:'发现逾期任务并提醒负责人。', schedule:'每小时', prompt:'查找已逾期且未完成的任务，提醒对应负责人并记录结果。' },
        { id:'weekly-review', name:'每周项目复盘', description:'整理一周进展并输出复盘提纲。', schedule:'每周一 10:00', prompt:'整理上周任务、文档和自动化运行结果，生成项目复盘提纲。' }
      ];
    },
    listAutomations(slug) { const ws = workspace(slug); return db.prepare('SELECT * FROM automations WHERE workspace_id=? ORDER BY name').all(ws.id).map(row => automationView(row, db.prepare('SELECT COUNT(*) AS count FROM automation_runs WHERE automation_id=?').get(row.id).count)); },
    getAutomation(slug, automationId) { const ws = workspace(slug); const row = db.prepare('SELECT * FROM automations WHERE workspace_id=? AND id=?').get(ws.id, automationId); if (!row) return null; return automationView(row, db.prepare('SELECT COUNT(*) AS count FROM automation_runs WHERE automation_id=?').get(row.id).count); },
    createAutomation(slug,input={}) {
      const ws=workspace(slug); if (!ws) throw new Error('Workspace not found');
      const template = this.listAutomationTemplates().find(item => item.id === input.templateId || item.id === input.template_id);
      const schedule=String(input.schedule || template?.schedule || '手动').trim(); const timezone=String(input.timezone || 'Asia/Shanghai'); const nextRun=parseSchedule(schedule, new Date(), timezone);
      const maxRetries=Math.max(0,Math.min(10,Number(input.maxRetries ?? input.max_retries ?? 3) || 0));
      const item={id:id('auto'),workspace_id:ws.id,name:String(input.name || template?.name || '未命名自动化').trim(),schedule,prompt:String(input.prompt || template?.prompt || '').trim(),status:'active',last_run:null,next_run:nextRun,timezone,webhook_url:input.webhookUrl || input.webhook_url || null,webhook_secret:input.webhookSecret || input.webhook_secret || (input.webhookUrl || input.webhook_url ? crypto.randomBytes(32).toString('hex') : null),output_mode:String(input.outputMode || input.output_mode || 'notification'),max_retries:maxRetries,retry_backoff_ms:Math.max(100,Number(input.retryBackoffMs || input.retry_backoff_ms || 1000)),executor:'ziwei_user'};
      if (!item.name) throw new Error('自动化名称不能为空');
      if (item.webhook_url) { try { const url=new URL(item.webhook_url); if (!['http:','https:'].includes(url.protocol)) throw new Error(); } catch { throw new Error('Webhook URL 无效'); } }
      db.prepare('INSERT INTO automations(id,workspace_id,name,schedule,prompt,status,last_run,next_run,timezone,webhook_url,webhook_secret,output_mode,max_retries,retry_backoff_ms,executor) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(item.id,ws.id,item.name,item.schedule,item.prompt,item.status,null,item.next_run,item.timezone,item.webhook_url,item.webhook_secret,item.output_mode,item.max_retries,item.retry_backoff_ms,item.executor);
      audit(slug,'user','automation.created',{automationId:item.id,templateId:template?.id || null}); const view=automationView(item, 0); if (item.webhook_secret) view.webhook_secret=item.webhook_secret; return view;
    },
    updateAutomation(automationId, input={}) {
      const row = db.prepare('SELECT * FROM automations WHERE id=?').get(automationId); if (!row) throw new Error('Automation not found');
      const allowed = new Set(['active','paused']); const status = input.status === undefined ? row.status : String(input.status);
      if (!allowed.has(status)) throw new Error('自动化状态必须是 active 或 paused');
      const name = input.name === undefined ? row.name : String(input.name).trim();
      if (!name) throw new Error('自动化名称不能为空');
      const schedule = input.schedule === undefined ? row.schedule : String(input.schedule).trim() || '手动';
      const prompt = input.prompt === undefined ? row.prompt : String(input.prompt).trim();
      const timezone = String(input.timezone || row.timezone || 'Asia/Shanghai'); const nextRun = status === 'active' ? (parseSchedule(schedule, new Date(), timezone) || row.next_run) : null; const webhook = input.webhookUrl === undefined && input.webhook_url === undefined ? row.webhook_url : (input.webhookUrl || input.webhook_url || null); const secret = input.webhookSecret === undefined && input.webhook_secret === undefined ? row.webhook_secret : (input.webhookSecret || input.webhook_secret || (webhook ? crypto.randomBytes(32).toString('hex') : null)); const maxRetries = input.maxRetries === undefined && input.max_retries === undefined ? row.max_retries : Math.max(0,Math.min(10,Number(input.maxRetries ?? input.max_retries) || 0));
      if (webhook) { try { const url=new URL(webhook); if (!['http:','https:'].includes(url.protocol)) throw new Error(); } catch { throw new Error('Webhook URL 无效'); } }
      db.prepare('UPDATE automations SET name=?,schedule=?,prompt=?,status=?,next_run=?,timezone=?,webhook_url=?,webhook_secret=?,output_mode=?,max_retries=?,retry_backoff_ms=? WHERE id=?').run(name,schedule,prompt,status,nextRun,timezone,webhook,secret,input.outputMode || input.output_mode || row.output_mode || 'notification',maxRetries,Math.max(100,Number(input.retryBackoffMs || input.retry_backoff_ms || row.retry_backoff_ms || 1000)),automationId);
      return this.getAutomationById(automationId);
    },
    getAutomationById(automationId) { const row = db.prepare('SELECT * FROM automations WHERE id=?').get(automationId); if (!row) return null; return automationView(row, db.prepare('SELECT COUNT(*) AS count FROM automation_runs WHERE automation_id=?').get(row.id).count); },
    deleteAutomation(automationId) { const row=db.prepare('SELECT * FROM automations WHERE id=?').get(automationId); if (!row) throw new Error('Automation not found'); db.prepare('DELETE FROM automations WHERE id=?').run(automationId); return {id:automationId,deleted:true}; },
    runAutomation(automationId, mode='manual', options = {}) {
      const row = db.prepare('SELECT * FROM automations WHERE id=?').get(automationId); if (!row) throw new Error('Automation not found');
      const timestamp=now(); const run={id:id('autorun'),automation_id:automationId,workspace_id:row.workspace_id,status:'queued',mode:String(mode || 'manual'),message:'已提交给 ziwei_user，等待本机执行',result_json:null,error:null,attempt:0,max_attempts:Number(row.max_retries || 3)+1,next_retry_at:null,action_id:null,created_at:timestamp,started_at:null,finished_at:null};
      db.prepare('INSERT INTO automation_runs(id,automation_id,workspace_id,status,mode,message,result_json,error,attempt,max_attempts,next_retry_at,action_id,created_at,started_at,finished_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(run.id,run.automation_id,run.workspace_id,run.status,run.mode,run.message,null,null,run.attempt,run.max_attempts,null,null,run.created_at,null,null);
      const ws=db.prepare('SELECT slug FROM workspaces WHERE id=?').get(row.workspace_id); const action=this.createA2AAction(ws.slug,{type:'automation.execute',dedupeKey:`automation:${automationId}:${run.id}:0`,payload:{automationId,runId:run.id,prompt:row.prompt,outputMode:row.output_mode,webhookUrl:row.webhook_url,attempt:0}});
      db.prepare('UPDATE automation_runs SET action_id=? WHERE id=?').run(action.id,run.id); db.prepare('UPDATE automations SET last_run=?,next_run=? WHERE id=?').run(timestamp,parseSchedule(row.schedule,new Date(timestamp),row.timezone || 'Asia/Shanghai'),automationId);
      return {...run,automation_id:automationId,action_id:action.id};
    },
    listAutomationRuns(automationId) { return db.prepare('SELECT * FROM automation_runs WHERE automation_id=? ORDER BY created_at DESC').all(automationId).map(row=>{ const delivery=db.prepare('SELECT status,attempts,next_retry_at,response_status,error,sent_at FROM webhook_deliveries WHERE run_id=? AND event=?').get(row.id,'automation.completed') || db.prepare('SELECT status,attempts,next_retry_at,response_status,error,sent_at FROM webhook_deliveries WHERE run_id=? ORDER BY created_at DESC LIMIT 1').get(row.id); return {...row,result:jsonObject(row.result_json),webhook:delivery || null}; }); },
    tickAutomations(slug, at = new Date()) {
      const selected = slug ? workspace(slug) : null; if (slug && !selected) throw new Error('Workspace not found');
      const rows = slug ? [selected] : db.prepare('SELECT * FROM workspaces').all();
      const due=[]; for (const ws of rows.filter(Boolean)) {
        const items=db.prepare("SELECT * FROM automations WHERE workspace_id=? AND status='active' AND next_run IS NOT NULL AND next_run<=?").all(ws.id,at.toISOString());
        for (const item of items) due.push(this.runAutomation(item.id,'scheduled'));
      }
      void this.dispatchWebhookDeliveries(); return due;
    },
    queueWebhookDelivery(runId, status, result, error) {
      const run=db.prepare('SELECT * FROM automation_runs WHERE id=?').get(runId); if (!run) return null;
      const automation=db.prepare('SELECT * FROM automations WHERE id=?').get(run.automation_id); if (!automation?.webhook_url || !automation.webhook_secret) return null;
      const ws=db.prepare('SELECT slug FROM workspaces WHERE id=?').get(run.workspace_id); const event=`automation.${status}`;
      const payload={event,delivery_id:id('delivery'),workspace:ws.slug,automation_id:automation.id,run_id:run.id,status,result:error ? null : (result ?? null),error:error || null,attempt:Number(run.attempt || 0),created_at:now()};
      const body=JSON.stringify(payload); const signature=`sha256=${crypto.createHmac('sha256',automation.webhook_secret).update(body).digest('hex')}`; const deliveryId=payload.delivery_id;
      db.prepare('INSERT OR IGNORE INTO webhook_deliveries(id,automation_id,run_id,workspace_id,url,event,payload_json,signature,status,attempts,max_attempts,next_retry_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(deliveryId,automation.id,run.id,run.workspace_id,automation.webhook_url,event,body,signature,'queued',0,Math.max(1,Number(automation.max_retries || 3)+1),null,payload.created_at);
      return {id:deliveryId,event,signature};
    },
    async dispatchWebhookDeliveries(at = new Date()) {
      const rows=db.prepare("SELECT * FROM webhook_deliveries WHERE status IN ('queued','retrying') AND (next_retry_at IS NULL OR next_retry_at<=?) ORDER BY created_at LIMIT 20").all(at.toISOString());
      for (const row of rows) {
        const attempts=Number(row.attempts || 0)+1; db.prepare('UPDATE webhook_deliveries SET status=\'sending\',attempts=? WHERE id=?').run(attempts,row.id);
        try {
          const response=await fetch(row.url,{method:'POST',headers:{'content-type':'application/json','x-ziwei-event':row.event,'x-ziwei-delivery':row.id,'x-ziwei-signature':row.signature,'x-webhook-signature':row.signature},body:row.payload_json,signal:AbortSignal.timeout(5000)});
          const text=await response.text(); if (!response.ok) throw new Error(`Webhook HTTP ${response.status}: ${text.slice(0,256)}`);
          db.prepare('UPDATE webhook_deliveries SET status=\'delivered\',response_status=?,response_body=?,sent_at=?,error=NULL WHERE id=?').run(response.status,text.slice(0,2000),now(),row.id);
        } catch (error) {
          const exhausted=attempts>=Number(row.max_attempts || 1); const retryAt=exhausted ? null : new Date(Date.now()+1000*2**Math.max(0,attempts-1)).toISOString();
          db.prepare('UPDATE webhook_deliveries SET status=?,next_retry_at=?,error=? WHERE id=?').run(exhausted?'failed':'retrying',retryAt,String(error?.message || error),row.id);
        }
      }
      return rows.length;
    },
    listWebhookDeliveries(runId) {
      return db.prepare('SELECT id,automation_id,run_id,workspace_id,url,event,status,attempts,max_attempts,next_retry_at,response_status,error,created_at,sent_at FROM webhook_deliveries WHERE run_id=? ORDER BY created_at DESC').all(runId);
    },
    completeAutomationRun(runId, input = {}) {
      const run=db.prepare('SELECT * FROM automation_runs WHERE id=?').get(runId); if(!run) throw new Error('Automation run not found'); if(['completed','failed'].includes(run.status)) return {...run,duplicate:true,result:jsonObject(run.result_json)};
      const status=String(input.status || (input.error ? 'failed' : 'completed')); if(!['completed','failed'].includes(status)) throw new Error('Automation run status must be completed or failed'); const result=input.result === undefined ? null : JSON.stringify(input.result); const error=input.error ? String(input.error) : null; const finished=now();
      if(status==='failed' && Number(run.attempt || 0)+1 < Number(run.max_attempts || 1)) { const nextAttempt=Number(run.attempt || 0)+1; const auto=db.prepare('SELECT * FROM automations WHERE id=?').get(run.automation_id); const retryAt=new Date(Date.now()+Number(auto?.retry_backoff_ms || 1000)*2**Math.max(0,nextAttempt-1)).toISOString(); db.prepare("UPDATE automation_runs SET status='retrying',error=?,result_json=?,attempt=?,next_retry_at=?,message=?,finished_at=? WHERE id=?").run(error,result,nextAttempt,retryAt,'执行失败，已安排重试',null,runId); return this.queueAutomationRetry(runId,retryAt); }
      db.prepare('UPDATE automation_runs SET status=?,error=?,result_json=?,finished_at=?,message=? WHERE id=?').run(status,error,result,finished,status==='completed'?'执行完成':'执行失败',runId); const ws=db.prepare('SELECT slug FROM workspaces WHERE id=?').get(run.workspace_id); audit(ws.slug,'ziwei_user',`automation.${status}`,{automationId:run.automation_id,runId,error}); const delivery=this.queueWebhookDelivery(runId,status,input.result,error); if (delivery) void this.dispatchWebhookDeliveries(); return {...db.prepare('SELECT * FROM automation_runs WHERE id=?').get(runId),result:jsonObject(result),webhook:delivery};
    },
    queueAutomationRetry(runId, retryAt = now()) { const run=db.prepare('SELECT * FROM automation_runs WHERE id=?').get(runId); if(!run) throw new Error('Automation run not found'); const auto=db.prepare('SELECT * FROM automations WHERE id=?').get(run.automation_id); const ws=db.prepare('SELECT slug FROM workspaces WHERE id=?').get(run.workspace_id); const action=this.createA2AAction(ws.slug,{type:'automation.execute',dedupeKey:`automation:${run.automation_id}:${run.id}:${run.attempt}`,payload:{automationId:run.automation_id,runId:run.id,prompt:auto.prompt,outputMode:auto.output_mode,webhookUrl:auto.webhook_url,attempt:run.attempt}}); db.prepare('UPDATE automation_runs SET status=\'queued\',action_id=?,next_retry_at=? WHERE id=?').run(action.id,retryAt,runId); return {...db.prepare('SELECT * FROM automation_runs WHERE id=?').get(runId),action_id:action.id}; },
    listMembers(slug) { const ws=workspace(slug); if (!ws) throw new Error('Workspace not found'); return db.prepare('SELECT * FROM members WHERE workspace_id=? ORDER BY joined_at').all(ws.id); },
    createMember(slug, input = {}) {
      const ws=workspace(slug); if (!ws) throw new Error('Workspace not found');
      const email=normalizeEmail(input.email); if (!email) throw new Error('成员邮箱不能为空');
      if (db.prepare('SELECT id FROM members WHERE workspace_id=? AND lower(email)=?').get(ws.id,email)) throw new Error('该邮箱已属于当前工作区成员');
      const member={id:id('member'),workspace_id:ws.id,name:String(input.name || email || '新成员').trim(),email,role:input.role === 'admin' ? 'admin' : 'member',avatar:null,joined_at:now()};
      db.prepare('INSERT INTO members(id,workspace_id,name,email,role,avatar,joined_at) VALUES(?,?,?,?,?,?,?)').run(member.id,ws.id,member.name,member.email,member.role,null,member.joined_at);
      audit(slug,'user','member.created',{memberId:member.id}); return member;
    },
    updateMember(memberId, input = {}) {
      const row = db.prepare('SELECT * FROM members WHERE id=?').get(memberId); if (!row) throw new Error('Member not found');
      const ws = db.prepare('SELECT * FROM workspaces WHERE id=?').get(row.workspace_id); if (!ws) throw new Error('Workspace not found');
      const name = String(input.name ?? row.name).trim(); if (!name) throw new Error('成员名称不能为空');
      const email = normalizeEmail(input.email ?? row.email);
      const role = row.role === 'owner' ? 'owner' : (input.role === 'admin' ? 'admin' : 'member');
      const avatar = input.avatar === undefined ? row.avatar : (input.avatar ? String(input.avatar) : null);
      const duplicate = db.prepare('SELECT id FROM members WHERE workspace_id=? AND lower(email)=? AND id<>?').get(row.workspace_id, email, memberId);
      if (duplicate) throw new Error('该邮箱已属于当前工作区成员');
      db.prepare('UPDATE members SET name=?,email=?,role=?,avatar=? WHERE id=?').run(name,email,role,avatar,memberId);
      const userId = row.user_id || null; if (userId) { try { db.prepare('UPDATE local_users SET name=?,email=? WHERE id=?').run(name,email,userId); } catch {} }
      audit(ws.slug,'user','member.updated',{memberId,name,email,role});
      return db.prepare('SELECT * FROM members WHERE id=?').get(memberId);
    },
    deleteMember(memberId) {
      const row = db.prepare('SELECT * FROM members WHERE id=?').get(memberId); if (!row) throw new Error('Member not found');
      const ws = db.prepare('SELECT * FROM workspaces WHERE id=?').get(row.workspace_id); if (!ws) throw new Error('Workspace not found');
      if (row.role === 'owner') throw new Error('工作区所有者不能被删除');
      db.prepare('DELETE FROM members WHERE id=?').run(memberId);
      audit(ws.slug,'user','member.deleted',{memberId,name:row.name,email:row.email});
      return { id: memberId, name: row.name, deleted: true };
    },
    listInvitations(slug) {
      const ws=workspace(slug); if (!ws) throw new Error('Workspace not found');
      db.prepare("UPDATE invitations SET status='expired' WHERE workspace_id=? AND status='pending' AND expires_at <= ?").run(ws.id,now());
      return db.prepare('SELECT * FROM invitations WHERE workspace_id=? ORDER BY created_at DESC').all(ws.id).map(row => invitationView(row, slug));
    },
    createInvitation(slug, input = {}) {
      const ws=workspace(slug); if (!ws) throw new Error('Workspace not found');
      if (ws.kind !== 'team') throw new Error('个人工作区不能邀请成员');
      const email=normalizeEmail(input.email);
      if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new Error('请输入有效的成员邮箱');
      const role=input.role === 'admin' ? 'admin' : 'member';
      db.prepare("UPDATE invitations SET status='expired' WHERE workspace_id=? AND status='pending' AND expires_at <= ?").run(ws.id,now());
      if (email) {
        const existing=db.prepare("SELECT id FROM invitations WHERE workspace_id=? AND email=? AND status='pending'").get(ws.id,email);
        if (existing) throw new Error('该邮箱已有待处理邀请');
      }
      const code=invitationCode(); const timestamp=now(); const item={id:id('invite'),workspace_id:ws.id,email,role,status:'pending',code_hash:invitationHash(code),code_prefix:code.slice(0,6),expires_at:invitationExpiry(input),created_at:timestamp,last_sent_at:timestamp,resend_count:0,accepted_at:null,revoked_at:null,member_id:null};
      db.prepare('INSERT INTO invitations(id,workspace_id,email,role,status,code_hash,code_prefix,expires_at,created_at,last_sent_at,resend_count,accepted_at,revoked_at,member_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(item.id,item.workspace_id,item.email,item.role,item.status,item.code_hash,item.code_prefix,item.expires_at,item.created_at,item.last_sent_at,item.resend_count,null,null,null);
      audit(slug,'user','invitation.created',{invitationId:item.id,email:item.email,role:item.role});
      return {...invitationView(item,slug),code,link:invitationLink(slug,code)};
    },
    resendInvitation(invitationId) {
      const row=db.prepare('SELECT * FROM invitations WHERE id=?').get(invitationId); if (!row) throw new Error('Invitation not found');
      const ws=db.prepare('SELECT * FROM workspaces WHERE id=?').get(row.workspace_id); if (!ws) throw new Error('Workspace not found');
      if (row.status === 'accepted') throw new Error('邀请已经被接受');
      if (row.status === 'revoked') throw new Error('邀请已撤销');
      const code=invitationCode(); const timestamp=now(); const expiry=invitationExpiry({});
      db.prepare("UPDATE invitations SET status='pending',code_hash=?,code_prefix=?,expires_at=?,last_sent_at=?,resend_count=resend_count+1,revoked_at=NULL WHERE id=?").run(invitationHash(code),code.slice(0,6),expiry,timestamp,invitationId);
      const updated=db.prepare('SELECT * FROM invitations WHERE id=?').get(invitationId); audit(ws.slug,'user','invitation.resent',{invitationId});
      return {...invitationView(updated,ws.slug),code,link:invitationLink(ws.slug,code)};
    },
    revokeInvitation(invitationId) {
      const row=db.prepare('SELECT * FROM invitations WHERE id=?').get(invitationId); if (!row) throw new Error('Invitation not found');
      const ws=db.prepare('SELECT * FROM workspaces WHERE id=?').get(row.workspace_id); if (!ws) throw new Error('Workspace not found');
      if (row.status === 'accepted') throw new Error('邀请已经被接受');
      if (row.status === 'revoked') return invitationView(row,ws.slug);
      const timestamp=now(); db.prepare("UPDATE invitations SET status='revoked',revoked_at=? WHERE id=?").run(timestamp,invitationId);
      const updated=db.prepare('SELECT * FROM invitations WHERE id=?').get(invitationId); audit(ws.slug,'user','invitation.revoked',{invitationId}); return invitationView(updated,ws.slug);
    },
    getInvitationByCode(code) {
      const value=String(code || '').trim(); if (!value) return null;
      const row=db.prepare('SELECT * FROM invitations WHERE code_hash=?').get(invitationHash(value)); if (!row) return null;
      const ws=db.prepare('SELECT * FROM workspaces WHERE id=?').get(row.workspace_id); if (!ws) return null;
      if (row.status === 'pending' && Date.parse(row.expires_at) <= Date.now()) { db.prepare("UPDATE invitations SET status='expired' WHERE id=?").run(row.id); row.status='expired'; }
      return invitationView(row,ws.slug);
    },
    acceptInvitation(code, input = {}) {
      const value=String(code || '').trim(); if (!value) throw new Error('邀请链接无效');
      const row=db.prepare('SELECT * FROM invitations WHERE code_hash=?').get(invitationHash(value)); if (!row) throw new Error('邀请链接无效');
      const ws=db.prepare('SELECT * FROM workspaces WHERE id=?').get(row.workspace_id); if (!ws) throw new Error('Workspace not found');
      if (row.status === 'accepted') { const member=row.member_id ? db.prepare('SELECT * FROM members WHERE id=?').get(row.member_id) : null; return { invitation:invitationView(row,ws.slug), member, duplicate:true }; }
      if (row.status === 'revoked') throw new Error('邀请已撤销');
      if (row.status === 'expired' || Date.parse(row.expires_at) <= Date.now()) { db.prepare("UPDATE invitations SET status='expired' WHERE id=?").run(row.id); throw new Error('邀请已过期'); }
      const email=normalizeEmail(row.email || input.email); if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new Error('接受邀请需要有效邮箱');
      const existing=db.prepare('SELECT * FROM members WHERE workspace_id=? AND lower(email)=?').get(ws.id,email);
      if (existing) { db.prepare("UPDATE invitations SET status='accepted',accepted_at=?,member_id=? WHERE id=?").run(now(),existing.id,row.id); const updated=db.prepare('SELECT * FROM invitations WHERE id=?').get(row.id); return { invitation:invitationView(updated,ws.slug),member:existing,duplicate:true }; }
      const member={id:id('member'),workspace_id:ws.id,name:String(input.name || email.split('@')[0] || '新成员').trim(),email,role:row.role === 'admin' ? 'admin' : 'member',avatar:null,joined_at:now()};
      db.prepare('INSERT INTO members(id,workspace_id,name,email,role,avatar,joined_at) VALUES(?,?,?,?,?,?,?)').run(member.id,ws.id,member.name,member.email,member.role,null,member.joined_at);
      db.prepare("UPDATE invitations SET status='accepted',accepted_at=?,member_id=? WHERE id=?").run(now(),member.id,row.id);
      const updated=db.prepare('SELECT * FROM invitations WHERE id=?').get(row.id); audit(ws.slug,'user','invitation.accepted',{invitationId:row.id,memberId:member.id}); return { invitation:invitationView(updated,ws.slug),member };
    },
    listDevices(slug, options = {}) {
      const ws = workspace(slug); if (!ws) throw new Error('Workspace not found');
      const cutoff = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS).toISOString();
      db.prepare("UPDATE devices SET status='offline',bridge_status=CASE WHEN bridge_status IS NULL THEN 'offline' ELSE bridge_status END WHERE workspace_id=? AND (last_seen IS NULL OR last_seen < ?) AND status NOT IN ('disabled','offline')").run(ws.id, cutoff);
      const rows = db.prepare('SELECT * FROM devices WHERE workspace_id=? ORDER BY name').all(ws.id);
      const visible = ws.kind === 'personal' && options.userId
        ? rows.filter(device => device.owner_user_id === options.userId)
        : rows;
      return visible.map(device => {
        const online = isFresh(device.last_seen);
        const seenAt = Date.parse(device.last_seen || '');
        const heartbeatAge = Number.isFinite(seenAt) && seenAt <= Date.now() ? Date.now() - seenAt : null;
        const isSeedDevice = device.id === 'device-ziwei-user';
        const status = device.status === 'disabled' ? 'disabled' : (online ? 'online' : 'offline');
        return { ...device, status, bridge_name: device.bridge_name || (isSeedDevice ? 'ziwei_user' : null), bridge_version: device.bridge_version || (isSeedDevice ? device.version : null), bridge_status: status === 'disabled' ? 'disabled' : (online ? 'online' : 'offline'), bridge_host: device.ip_hint || '127.0.0.1', healthy: status === 'online', heartbeat_age_ms: heartbeatAge };
      });
    },
    heartbeatDevice(slug, input = {}) {
      const ws = workspace(slug); if (!ws) throw new Error('Workspace not found');
      const agentId = String(input.agentId || input.agent_id || input.serviceName || input.service_name || 'ziwei_user');
      if (agentId !== 'ziwei_user') throw new Error('Only ziwei_user heartbeat is accepted');
      const timestamp = now();
      const requestedDeviceId = input.deviceId ?? input.device_id;
      const deviceId = String(requestedDeviceId || 'device-ziwei-user').trim();
      if (!deviceId) throw new Error('Device id is required');
      // An explicit id is authoritative.  Never silently fall back to an old
      // ziwei_user row: that would make one computer's heartbeat appear on a
      // different device.  An unknown id is registered as a new own device.
      let row = db.prepare('SELECT * FROM devices WHERE workspace_id=? AND id=?').get(ws.id, deviceId);
      if (row && row.bridge_name && row.bridge_name !== 'ziwei_user') throw new Error('Device is not registered to ziwei_user');
      if (row?.status === 'disabled') return this.listDevices(slug).find(device => device.id === row.id) || null;
      if (!row) {
        db.prepare('INSERT INTO devices(id,workspace_id,name,os,status,last_seen,ip_hint,version,pid,bridge_name,bridge_version,bridge_status,heartbeat_at,heartbeat_interval_ms,workdir,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(deviceId, ws.id, String(input.name || 'ziwei_user').trim() || 'ziwei_user', String(input.os || 'Windows'), 'online', timestamp, String(input.ipHint || input.ip_hint || '127.0.0.1'), String(input.version || input.daemon_version || ownVersion()), Number(input.pid) || null, 'ziwei_user', String(input.bridgeVersion || input.bridge_version || input.version || input.daemon_version || ownVersion()), 'online', timestamp, Number(input.heartbeatMs || input.heartbeat_ms) || null, String(input.workdir || input.workingDirectory || input.cwd || '').trim() || null, timestamp);
        row = db.prepare('SELECT * FROM devices WHERE id=?').get(deviceId);
      } else {
        const requestedName = String(input.name || '').trim();
        const heartbeatName = requestedName && requestedName !== 'ziwei_user' ? requestedName : (row.name || 'ziwei_user');
        db.prepare('UPDATE devices SET name=?,os=?,status=?,last_seen=?,ip_hint=?,version=?,pid=?,bridge_name=?,bridge_version=?,bridge_status=?,heartbeat_at=?,heartbeat_interval_ms=?,workdir=?,created_at=COALESCE(created_at,?) WHERE id=?').run(heartbeatName, String(input.os || row.os || 'Windows'), 'online', timestamp, String(input.ipHint || input.ip_hint || row.ip_hint || '127.0.0.1'), String(input.version || input.daemon_version || ownVersion()), Number(input.pid) || null, 'ziwei_user', String(input.bridgeVersion || input.bridge_version || input.version || input.daemon_version || ownVersion()), 'online', timestamp, Number(input.heartbeatMs || input.heartbeat_ms) || row.heartbeat_interval_ms || null, String(input.workdir || input.workingDirectory || input.cwd || row.workdir || '').trim() || null, timestamp, row.id);
      }
      ensureRuntimeCatalog(ws.id, timestamp);
      db.prepare("UPDATE runtimes SET status='online',last_seen=? WHERE workspace_id=?").run(timestamp, ws.id);
      // The daemon includes its local CLI discovery in the heartbeat.  Persist
      // it here as well as through the optional /runtimes/register follow-up so
      // a transient follow-up failure cannot leave a fresh workspace without
      // versions/models.
      const runtimePayload = input.runtimes || input.runtimeMetadata || input.runtime_metadata;
      if (runtimePayload && typeof runtimePayload === 'object') this.registerRuntimes(slug, { runtimes: runtimePayload, deviceId });
      return this.listDevices(slug).find(device => device.id === row.id) || null;
    },
    registerRuntimeDiscovery(slug, input = {}) {
      const ws = workspace(slug); if (!ws) throw new Error('Workspace not found');
      const runtimes = input.runtimes && typeof input.runtimes === 'object' ? input.runtimes : {};
      const timestamp = now(); const updates = [];
      for (const [name, meta] of Object.entries(runtimes)) {
        const runtime = String(name || meta?.runtime || '').trim(); if (!runtime) continue;
        const row = db.prepare('SELECT * FROM runtimes WHERE workspace_id=? AND lower(name)=lower(?)').get(ws.id, runtime); if (!row) continue;
        const version = meta?.version ? String(meta.version) : null;
        const status = meta?.status === 'available' && version ? 'online' : 'offline';
        db.prepare('UPDATE runtimes SET version=?,status=?,last_seen=? WHERE id=?').run(version,status,status === 'online' ? timestamp : null,row.id);
        updates.push({id:row.id,name:row.name,version,status,binary:meta?.binary || null,cli_version:version,cli_status:meta?.status || 'unavailable'});
      }
      return {runtimes:updates,registered_at:timestamp};
    },
    createDevice(slug, input = {}) {
      const ws=workspace(slug); if (!ws) throw new Error('Workspace not found');
      const name=String(input.name || '新设备').trim() || '新设备';
      const device={id:id('device'),workspace_id:ws.id,owner_user_id:String(input.ownerUserId || input.owner_user_id || '').trim() || null,name,os:String(input.os || 'Windows'),status:'pending',last_seen:null,ip_hint:null,version:null,pid:null,bridge_name:null,bridge_version:null,bridge_status:'pending',heartbeat_at:null,heartbeat_interval_ms:null,workdir:String(input.workdir || input.workingDirectory || input.cwd || '').trim() || null,created_at:now()};
      db.prepare('INSERT INTO devices(id,workspace_id,owner_user_id,name,os,status,last_seen,ip_hint,version,pid,bridge_name,bridge_version,bridge_status,heartbeat_at,heartbeat_interval_ms,workdir,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(device.id,ws.id,device.owner_user_id,device.name,device.os,device.status,null,null,null,null,null,null,'pending',null,null,device.workdir,device.created_at);
      audit(slug,'user','device.created',{deviceId:device.id}); return device;
    },
    updateDevice(deviceId, input = {}) {
      const row=db.prepare('SELECT * FROM devices WHERE id=?').get(deviceId); if (!row) throw new Error('Device not found');
      const ws=db.prepare('SELECT * FROM workspaces WHERE id=?').get(row.workspace_id); if (!ws) throw new Error('Workspace not found');
      const name=String(input.name ?? row.name).trim(); if (!name) throw new Error('设备名称不能为空');
      const os=String(input.os ?? row.os).trim() || row.os;
      db.prepare('UPDATE devices SET name=?,os=? WHERE id=?').run(name,os,deviceId);
      audit(ws.slug,'user','device.updated',{deviceId,name,os});
      return this.listDevices(ws.slug).find(device => device.id === deviceId) || null;
    },
    setDeviceStatus(deviceId, status = 'disabled') {
      const row=db.prepare('SELECT * FROM devices WHERE id=?').get(deviceId); if (!row) throw new Error('Device not found');
      const ws=db.prepare('SELECT * FROM workspaces WHERE id=?').get(row.workspace_id); if (!ws) throw new Error('Workspace not found');
      const next=String(status).toLowerCase(); if (!['disabled','pending'].includes(next)) throw new Error('设备状态只能是 disabled 或 pending');
      db.prepare('UPDATE devices SET status=?,bridge_status=?,last_seen=CASE WHEN ?=\'disabled\' THEN last_seen ELSE NULL END,heartbeat_at=CASE WHEN ?=\'disabled\' THEN heartbeat_at ELSE NULL END WHERE id=?').run(next,next === 'disabled' ? 'disabled' : 'pending',next,next,deviceId);
      audit(ws.slug,'user',next === 'disabled' ? 'device.disabled' : 'device.enabled',{deviceId});
      return this.listDevices(ws.slug).find(device => device.id === deviceId) || null;
    },
    deleteDevice(deviceId) {
      const row=db.prepare('SELECT * FROM devices WHERE id=?').get(deviceId); if (!row) throw new Error('Device not found');
      const ws=db.prepare('SELECT * FROM workspaces WHERE id=?').get(row.workspace_id); if (!ws) throw new Error('Workspace not found');
      // Removing a device also revokes its credential through the foreign-key
      // cascade. This lets an owner clean up stale canonical registrations;
      // the daemon must pair again before it can reconnect.
      db.prepare('DELETE FROM device_credentials WHERE device_id=?').run(deviceId);
      db.prepare('DELETE FROM devices WHERE id=?').run(deviceId);
      audit(ws.slug,'user','device.deleted',{deviceId,name:row.name});
      return { id:deviceId, name:row.name, deleted:true };
    },
    canManageDevice(deviceId, userId, role, workspaceSlug = null) {
      const row = db.prepare('SELECT d.*,w.kind,w.slug AS workspace_slug FROM devices d JOIN workspaces w ON w.id=d.workspace_id WHERE d.id=?').get(String(deviceId || ''));
      if (!row) return false;
      if (workspaceSlug && row.workspace_slug !== String(workspaceSlug)) return false;
      if (['owner','admin'].includes(String(role || '').toLowerCase())) return true;
      return Boolean(userId && row.owner_user_id && row.owner_user_id === userId);
    },
    createDevicePairing(slug, input = {}) {
      const ws = workspace(slug); if (!ws) throw new Error('Workspace not found');
      const requestedTtl = Number(input.ttlMs ?? input.ttl_ms ?? 10 * 60 * 1000);
      const ttlMs = Number.isFinite(requestedTtl) ? Math.min(30 * 60 * 1000, Math.max(60 * 1000, requestedTtl)) : 10 * 60 * 1000;
      const createdAt = now();
      const expiresAt = new Date(Date.parse(createdAt) + ttlMs).toISOString();
      const code = `zwi-${crypto.randomBytes(4).toString('hex')}-${crypto.randomBytes(4).toString('hex')}`;
      const deviceName = String(input.name || input.deviceName || '远程设备').trim() || '远程设备';
      const deviceOs = String(input.os || process.platform).trim() || process.platform;
      const creator = String(input.createdBy || input.created_by || '').trim();
      const validCreator = creator && db.prepare('SELECT 1 FROM members WHERE user_id=? AND workspace_id=?').get(creator, ws.id) ? creator : null;
      db.prepare('INSERT INTO device_pairing_codes(id,workspace_id,code_hash,code_prefix,expires_at,created_at,created_by,consumed_at,device_name,device_os) VALUES(?,?,?,?,?,?,?,NULL,?,?)')
        .run(id('pairing'), ws.id, hashSecret(code), code.slice(0, 12), expiresAt, createdAt, validCreator, deviceName, deviceOs);
      audit(slug, 'user', 'device.pairing.created', { codePrefix: code.slice(0, 12), expiresAt });
      return { code, code_prefix: code.slice(0, 12), workspace: slug, expires_at: expiresAt };
    },
    claimDevicePairing(input = {}) {
      const code = String(input.code || '').trim().toLowerCase();
      if (!code) throw new Error('设备配对码不能为空');
      const row = db.prepare(`SELECT p.*,w.slug AS workspace_slug FROM device_pairing_codes p JOIN workspaces w ON w.id=p.workspace_id WHERE p.code_hash=?`).get(hashSecret(code));
      if (!row || row.consumed_at || Date.parse(row.expires_at) <= Date.now()) throw new Error('设备配对码无效、已使用或已过期');
      const timestamp = now();
      const deviceId = id('device');
      const deviceToken = `zwd_${crypto.randomBytes(32).toString('base64url')}`;
      const deviceName = String(input.name || input.deviceName || row.device_name || '远程设备').trim() || '远程设备';
      const osName = String(input.os || row.device_os || process.platform).trim() || process.platform;
      // Pairing is a credential hand-off. Consume the one-time code and create
      // both durable records in one transaction so an insertion failure can
      // never strand a code without issuing a usable device credential.
      db.exec('BEGIN IMMEDIATE');
      try {
        const claim = db.prepare('UPDATE device_pairing_codes SET consumed_at=? WHERE id=? AND consumed_at IS NULL').run(timestamp, row.id);
        if (claim.changes !== 1) throw new Error('设备配对码已被使用');
        db.prepare('INSERT INTO devices(id,workspace_id,owner_user_id,name,os,status,last_seen,ip_hint,version,pid,bridge_name,bridge_version,bridge_status,heartbeat_at,heartbeat_interval_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(deviceId, row.workspace_id, String(row.created_by || '').startsWith('user_') ? row.created_by : null, deviceName, osName, 'pending', null, null, null, null, 'ziwei_user', null, 'pending', null, null, timestamp);
        db.prepare('INSERT INTO device_credentials(id,device_id,workspace_id,token_hash,token_prefix,created_at,last_seen_at,revoked_at) VALUES(?,?,?,?,?,?,?,NULL)')
          .run(id('device-credential'), deviceId, row.workspace_id, hashSecret(deviceToken), deviceToken.slice(0, 12), timestamp, null);
        db.exec('COMMIT');
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch {}
        throw error;
      }
      audit(row.workspace_slug, 'ziwei_user', 'device.pairing.claimed', { deviceId, codePrefix: row.code_prefix });
      return { deviceId, deviceToken, workspace: row.workspace_slug, agentId: 'ziwei_user', serviceName: 'ziwei_user' };
    },
    authenticateDeviceToken(token, { workspaceSlug = null, deviceId = null } = {}) {
      const candidate = String(token || '').trim(); if (!candidate) return null;
      const row = db.prepare(`SELECT c.id AS credential_id,c.device_id,c.workspace_id,c.revoked_at,d.status AS device_status,w.slug AS workspace_slug
        FROM device_credentials c JOIN devices d ON d.id=c.device_id AND d.workspace_id=c.workspace_id
        JOIN workspaces w ON w.id=c.workspace_id WHERE c.token_hash=?`).get(hashSecret(candidate));
      if (!row || row.revoked_at || row.device_status === 'disabled') return null;
      if (workspaceSlug && String(workspaceSlug) !== row.workspace_slug) return null;
      if (deviceId && String(deviceId) !== row.device_id) return null;
      db.prepare('UPDATE device_credentials SET last_seen_at=? WHERE id=?').run(now(), row.credential_id);
      return { credentialId: row.credential_id, deviceId: row.device_id, workspaceId: row.workspace_id, workspace: row.workspace_slug };
    },
    revokeDeviceCredential(deviceId) {
      const row = db.prepare('SELECT * FROM device_credentials WHERE device_id=?').get(String(deviceId));
      if (!row) return null;
      const timestamp = now();
      db.prepare('UPDATE device_credentials SET revoked_at=? WHERE device_id=?').run(timestamp, String(deviceId));
      db.prepare("UPDATE devices SET status='disabled',bridge_status='disabled',last_seen=NULL,heartbeat_at=NULL WHERE id=?").run(String(deviceId));
      const ws = db.prepare('SELECT slug FROM workspaces WHERE id=?').get(row.workspace_id);
      if (ws) audit(ws.slug, 'user', 'device.credential.revoked', { deviceId: String(deviceId) });
      return { deviceId: String(deviceId), revoked: true };
    },
    resourcePermissions() {
      return {
        owner: { read:['workspace','tasks','runtimes','skills','documents','automations','calendar','members','invitations','devices','employees','audit','notifications','conversations','settings','api_keys'], write:['tasks','skills','documents','automations','members','invitations','devices','employees','notifications','conversations','settings','api_keys'] },
        admin: { read:['workspace','tasks','runtimes','skills','documents','automations','calendar','members','invitations','devices','employees','audit','notifications','conversations','settings','api_keys'], write:['tasks','skills','documents','automations','members','invitations','devices','employees','notifications','conversations','settings','api_keys'] },
        member: { read:['workspace','tasks','runtimes','skills','documents','automations','calendar','members','invitations','devices','employees','audit','notifications','conversations'], write:['tasks','skills','documents','automations','employees','notifications','conversations'] }
      };
    },
    listEmployees(slug, input = {}) { const ws=workspace(slug); if (!ws) throw new Error('Workspace not found'); const context=employeeAccessContext(input); return db.prepare('SELECT * FROM employees WHERE workspace_id=? ORDER BY created_at DESC').all(ws.id).filter(row => employeeVisible(row, context)).map(employeeView); },
    getEmployee(employeeId, input = {}) { const row=db.prepare('SELECT * FROM employees WHERE id=?').get(employeeId); return employeeVisible(row, employeeAccessContext(input)) ? employeeView(row) : null; },
    createEmployee(slug, input = {}) { const ws=workspace(slug); if (!ws) throw new Error('Workspace not found'); const timestamp=now(); const name=String(input.name || '未命名数字员工').trim(); if (!name) throw new Error('数字员工名称不能为空'); const requestedStatus=String(input.status || 'active'); const status=new Set(['draft','active','paused','archived']).has(requestedStatus) ? requestedStatus : 'active'; const runtime=String(input.runtime || 'Codex').trim() || 'Codex'; const runtimeProfile=validateEmployeeProfile(runtime, input.runtimeProfile ?? input.runtime_profile ?? input.profile ?? input.hermesProfile ?? input.hermes_profile); const ownerUserId=String(input.ownerUserId || input.owner_user_id || '').trim() || null; const employee={id:id('employee'),workspace_id:ws.id,owner_user_id:ownerUserId,name,runtime,model_id:input.model || input.modelId || input.model_id || null,description:String(input.description || ''),visibility:input.visibility === 'personal' ? 'personal' : 'workspace',skills:Array.isArray(input.skills) ? input.skills : [],instructions:String(input.instructions || ''),runtime_profile:runtimeProfile,avatar:input.avatar ? String(input.avatar) : null,status,created_at:timestamp,updated_at:timestamp}; db.prepare('INSERT INTO employees(id,workspace_id,owner_user_id,name,runtime,model_id,description,visibility,skills_json,instructions,runtime_profile,avatar,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(employee.id,ws.id,employee.owner_user_id,employee.name,employee.runtime,employee.model_id,employee.description,employee.visibility,JSON.stringify(employee.skills),employee.instructions,employee.runtime_profile,employee.avatar,employee.status,timestamp,timestamp); audit(slug,'user','employee.created',{employeeId:employee.id,modelId:employee.model_id,runtimeProfile:employee.runtime_profile,status}); return employee; },
    updateEmployee(employeeId, input = {}) {
      const row = db.prepare('SELECT * FROM employees WHERE id=?').get(employeeId); if (!row) throw new Error('数字员工不存在');
      const ws = db.prepare('SELECT * FROM workspaces WHERE id=?').get(row.workspace_id); if (!ws) throw new Error('Workspace not found');
      const name=String(input.name ?? row.name).trim(); if (!name) throw new Error('数字员工名称不能为空');
      const runtime=String(input.runtime ?? row.runtime).trim() || row.runtime;
      const modelId=input.model === undefined && input.modelId === undefined && input.model_id === undefined ? row.model_id : (input.model ?? input.modelId ?? input.model_id) || null;
      const description=input.description === undefined ? row.description : String(input.description || '');
      const visibility=input.visibility === undefined ? row.visibility : (input.visibility === 'personal' ? 'personal' : 'workspace');
      const skills=input.skills === undefined ? parse(row.skills_json) : (Array.isArray(input.skills) ? input.skills : []);
      const instructions=input.instructions === undefined ? row.instructions : String(input.instructions || '');
      const runtimeProfile=input.runtimeProfile === undefined && input.runtime_profile === undefined && input.profile === undefined && input.hermesProfile === undefined && input.hermes_profile === undefined ? row.runtime_profile : validateEmployeeProfile(runtime, input.runtimeProfile ?? input.runtime_profile ?? input.profile ?? input.hermesProfile ?? input.hermes_profile);
      const avatar=input.avatar === undefined ? row.avatar : (input.avatar ? String(input.avatar) : null);
      const statuses=new Set(['draft','active','paused','archived']); const status=input.status === undefined ? row.status : String(input.status); if (!statuses.has(status)) throw new Error('数字员工状态无效');
      const updated=now(); db.prepare('UPDATE employees SET name=?,runtime=?,model_id=?,description=?,visibility=?,skills_json=?,instructions=?,runtime_profile=?,avatar=?,status=?,updated_at=? WHERE id=?').run(name,runtime,modelId,description,visibility,JSON.stringify(skills),instructions,runtimeProfile,avatar,status,updated,employeeId);
      audit(ws.slug,'user','employee.updated',{employeeId,name,runtime,modelId,runtimeProfile,status});
      const saved=db.prepare('SELECT * FROM employees WHERE id=?').get(employeeId); return employeeView(saved);
    },
    deleteEmployee(employeeId) {
      const row=db.prepare('SELECT * FROM employees WHERE id=?').get(employeeId); if (!row) throw new Error('数字员工不存在');
      const ws=db.prepare('SELECT * FROM workspaces WHERE id=?').get(row.workspace_id); if (!ws) throw new Error('Workspace not found');
      db.prepare('DELETE FROM employees WHERE id=?').run(employeeId); audit(ws.slug,'user','employee.deleted',{employeeId,name:row.name}); return {id:employeeId,name:row.name,deleted:true};
    },
    listEmployeeEnvironment(employeeId) {
      const employee = db.prepare('SELECT id,workspace_id FROM employees WHERE id=?').get(employeeId);
      if (!employee) throw new Error('数字员工不存在');
      const rows = db.prepare('SELECT * FROM employee_environment_variables WHERE employee_id=? ORDER BY key').all(employeeId);
      return { employee_id: employeeId, variables: rows.map(row => environmentView(row, employeeEnvKey)), local_source: { source: 'ziwei_user', scope: 'runtime', variables: [...LOCAL_RUNTIME_VARIABLES] } };
    },
    upsertEmployeeEnvironment(employeeId, input = {}) {
      const employee = db.prepare('SELECT id,workspace_id FROM employees WHERE id=?').get(employeeId);
      if (!employee) throw new Error('数字员工不存在');
      const key = String(input.key || '').trim().toUpperCase();
      if (!ENV_KEY_PATTERN.test(key)) throw new Error('环境变量名无效：必须是大写字母、数字或下划线，且以字母开头');
      if (input.value === undefined || input.value === null) throw new Error('环境变量值不能为空');
      const value = String(input.value); if (value.length > 16 * 1024) throw new Error('环境变量值过长');
      const sensitive = input.sensitive === undefined ? true : Boolean(input.sensitive); const timestamp = now();
      const existing = db.prepare('SELECT id FROM employee_environment_variables WHERE employee_id=? AND key=?').get(employeeId, key);
      const ciphertext = encryptEmployeeValue(value, employeeEnvKey);
      if (existing) db.prepare('UPDATE employee_environment_variables SET value_ciphertext=?,sensitive=?,updated_at=? WHERE id=?').run(ciphertext, sensitive ? 1 : 0, timestamp, existing.id);
      else db.prepare('INSERT INTO employee_environment_variables(id,employee_id,key,value_ciphertext,sensitive,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id('employee-env'),employeeId,key,ciphertext,sensitive ? 1 : 0,timestamp,timestamp);
      const saved = db.prepare('SELECT * FROM employee_environment_variables WHERE employee_id=? AND key=?').get(employeeId,key);
      const ws = db.prepare('SELECT slug FROM workspaces WHERE id=?').get(employee.workspace_id);
      audit(ws.slug, 'user', existing ? 'employee.environment.updated' : 'employee.environment.created', { employeeId, key, sensitive });
      return environmentView(saved, employeeEnvKey);
    },
    deleteEmployeeEnvironment(employeeId, keyValue) {
      const employee = db.prepare('SELECT id,workspace_id FROM employees WHERE id=?').get(employeeId); if (!employee) throw new Error('数字员工不存在');
      const key = String(keyValue || '').trim().toUpperCase(); const row = db.prepare('SELECT * FROM employee_environment_variables WHERE employee_id=? AND key=?').get(employeeId, key); if (!row) throw new Error('环境变量不存在');
      db.prepare('DELETE FROM employee_environment_variables WHERE id=?').run(row.id); const ws = db.prepare('SELECT slug FROM workspaces WHERE id=?').get(employee.workspace_id); audit(ws.slug, 'user', 'employee.environment.deleted', { employeeId, key }); return { id: row.id, employee_id: employeeId, key, deleted: true };
    },
    getEmployeeCustomParams(employeeId) {
      if (!db.prepare('SELECT id FROM employees WHERE id=?').get(employeeId)) throw new Error('数字员工不存在');
      const rows = db.prepare('SELECT key,value_json FROM employee_custom_params WHERE employee_id=? ORDER BY key').all(employeeId); const values = {};
      for (const row of rows) { try { values[row.key] = JSON.parse(row.value_json); } catch { values[row.key] = null; } }
      const updated = db.prepare('SELECT MAX(updated_at) AS updated_at FROM employee_custom_params WHERE employee_id=?').get(employeeId);
      return { employee_id: employeeId, values, updated_at: updated?.updated_at || null };
    },
    replaceEmployeeCustomParams(employeeId, input = {}) {
      const employee = db.prepare('SELECT id,workspace_id FROM employees WHERE id=?').get(employeeId); if (!employee) throw new Error('数字员工不存在');
      const values = input && typeof input === 'object' && !Array.isArray(input) && input.values && typeof input.values === 'object' && !Array.isArray(input.values) ? input.values : input;
      if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('自定义参数必须是 JSON 对象');
      const entries = Object.entries(values); if (entries.length > 100) throw new Error('自定义参数不能超过 100 项'); const normalized = [];
      for (const [rawKey, rawValue] of entries) {
        const key = String(rawKey).trim(); if (!PARAM_KEY_PATTERN.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key.toLowerCase())) throw new Error(`自定义参数名无效: ${key}`); if (rawValue === undefined) throw new Error('自定义参数值必须是有效 JSON');
        let valueJson; try { valueJson = JSON.stringify(rawValue); } catch { throw new Error(`自定义参数 ${key} 不是有效 JSON`); }
        if (valueJson === undefined || Buffer.byteLength(valueJson, 'utf8') > 64 * 1024) throw new Error(`自定义参数 ${key} 不是有效 JSON 或过大`);
        normalized.push({ key, valueJson, valueType: Array.isArray(rawValue) ? 'array' : (rawValue === null ? 'null' : typeof rawValue) });
      }
      const timestamp = now(); db.exec('BEGIN');
      try { db.prepare('DELETE FROM employee_custom_params WHERE employee_id=?').run(employeeId); const insert = db.prepare('INSERT INTO employee_custom_params(id,employee_id,key,value_json,value_type,created_at,updated_at) VALUES(?,?,?,?,?,?,?)'); for (const item of normalized) insert.run(id('employee-param'), employeeId, item.key, item.valueJson, item.valueType, timestamp, timestamp); db.exec('COMMIT'); } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
      const ws = db.prepare('SELECT slug FROM workspaces WHERE id=?').get(employee.workspace_id); audit(ws.slug, 'user', 'employee.custom_params.updated', { employeeId, keys: normalized.map(item => item.key) }); return this.getEmployeeCustomParams(employeeId);
    },
    listCalendarEvents(slug) {
      const ws = workspace(slug); if (!ws) throw new Error('Workspace not found');
      return db.prepare('SELECT * FROM calendar_events WHERE workspace_id=? ORDER BY start_at,created_at').all(ws.id).map(calendarEventView);
    },
    getCalendarEvent(eventId) {
      return calendarEventView(db.prepare('SELECT * FROM calendar_events WHERE id=?').get(eventId));
    },
    createCalendarEvent(slug, input = {}) {
      const ws = workspace(slug); if (!ws) throw new Error('Workspace not found');
      const name = String(input.name ?? input.title ?? '').trim();
      if (!name) throw new Error('日历事件名称不能为空');
      const startAt = calendarDate(input.startAt ?? input.start_at ?? input.startDate ?? input.start_date ?? input.start);
      if (!startAt) throw new Error('日历事件必须有开始时间');
      const endAt = calendarDate(input.endAt ?? input.end_at ?? input.endDate ?? input.end_date ?? input.end);
      const timezone = String(input.timezone || ws.timezone || 'Asia/Shanghai').trim() || 'Asia/Shanghai';
      try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(); } catch { throw new Error('时区无效'); }
      const status = String(input.status || 'planned').trim() || 'planned';
      const timestamp = now();
      const event = { id:id('calendar-event'), workspace_id:ws.id, name, description:String(input.description || ''), start_at:startAt, end_at:endAt, timezone, status, assignee:input.assignee ? String(input.assignee) : null, all_day:input.allDay === undefined && input.all_day === undefined ? 1 : (input.allDay ?? input.all_day ? 1 : 0), created_at:timestamp, updated_at:timestamp };
      db.prepare('INSERT INTO calendar_events(id,workspace_id,name,description,start_at,end_at,timezone,status,assignee,all_day,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(event.id,event.workspace_id,event.name,event.description,event.start_at,event.end_at,event.timezone,event.status,event.assignee,event.all_day,event.created_at,event.updated_at);
      audit(slug,'user','calendar_event.created',{eventId:event.id,name:event.name,startAt:event.start_at,timezone:event.timezone});
      return calendarEventView(event);
    },
    updateCalendarEvent(eventId, input = {}) {
      const row = db.prepare('SELECT * FROM calendar_events WHERE id=?').get(eventId); if (!row) throw new Error('Calendar event not found');
      const ws = db.prepare('SELECT * FROM workspaces WHERE id=?').get(row.workspace_id); if (!ws) throw new Error('Workspace not found');
      const name = String(input.name ?? input.title ?? row.name).trim(); if (!name) throw new Error('日历事件名称不能为空');
      const startAt = calendarDate(input.startAt ?? input.start_at ?? input.startDate ?? input.start_date ?? input.start) || row.start_at;
      const hasEnd = input.endAt !== undefined || input.end_at !== undefined || input.endDate !== undefined || input.end_date !== undefined || input.end !== undefined;
      const endAt = hasEnd ? calendarDate(input.endAt ?? input.end_at ?? input.endDate ?? input.end_date ?? input.end) : row.end_at;
      const timezone = String(input.timezone ?? row.timezone ?? ws.timezone).trim() || ws.timezone;
      try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(); } catch { throw new Error('时区无效'); }
      const allDay = input.allDay === undefined && input.all_day === undefined ? row.all_day : ((input.allDay ?? input.all_day) ? 1 : 0);
      const updatedAt = now();
      db.prepare('UPDATE calendar_events SET name=?,description=?,start_at=?,end_at=?,timezone=?,status=?,assignee=?,all_day=?,updated_at=? WHERE id=?').run(name,String(input.description ?? row.description ?? ''),startAt,endAt,timezone,String(input.status ?? row.status ?? 'planned'),input.assignee === undefined ? row.assignee : (input.assignee ? String(input.assignee) : null),allDay,updatedAt,eventId);
      audit(ws.slug,'user','calendar_event.updated',{eventId,name,startAt,timezone});
      return calendarEventView(db.prepare('SELECT * FROM calendar_events WHERE id=?').get(eventId));
    },
    deleteCalendarEvent(eventId) {
      const row = db.prepare('SELECT * FROM calendar_events WHERE id=?').get(eventId); if (!row) throw new Error('Calendar event not found');
      const ws = db.prepare('SELECT * FROM workspaces WHERE id=?').get(row.workspace_id); if (!ws) throw new Error('Workspace not found');
      db.prepare('DELETE FROM calendar_events WHERE id=?').run(eventId);
      audit(ws.slug,'user','calendar_event.deleted',{eventId,name:row.name});
      return { id:eventId, name:row.name, deleted:true };
    },
    listCalendar(slug) {
      const ws=workspace(slug); if (!ws) throw new Error('Workspace not found');
      const taskEvents=db.prepare("SELECT id,title AS name,due_date AS start_date,state AS status,assignee FROM tasks WHERE workspace_id=? AND due_date IS NOT NULL").all(ws.id).map(event => ({...event,source:'task'}));
      const autoEvents=db.prepare("SELECT id,name,schedule AS start_date,status FROM automations WHERE workspace_id=?").all(ws.id).map(event => ({...event,source:'automation'}));
      const customEvents=this.listCalendarEvents(slug);
      return [{id:'calendar-default',name:'工作区日历',timezone:ws.timezone || 'Asia/Shanghai',events:[...taskEvents,...autoEvents,...customEvents]}];
    },
    listAudit(slug, limit=50) { const ws=workspace(slug); return db.prepare('SELECT * FROM audit_events WHERE workspace_id=? ORDER BY created_at DESC LIMIT ?').all(ws.id,limit); },
    listNotifications(slug, limit=50, options = {}) { const ws=workspace(slug); const archived=options.archived ? ' AND archived_at IS NOT NULL' : ' AND archived_at IS NULL'; const unread=options.unread ? ' AND read_at IS NULL' : ''; return db.prepare(`SELECT * FROM notifications WHERE workspace_id=?${archived}${unread} ORDER BY created_at DESC LIMIT ?`).all(ws.id,limit).map(row=>({...row,read:Boolean(row.read_at),payload:jsonObject(row.payload_json)})); },
    notificationStats(slug) { const ws=workspace(slug); return { unread:db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE workspace_id=? AND read_at IS NULL AND archived_at IS NULL').get(ws.id).count, total:db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE workspace_id=? AND archived_at IS NULL').get(ws.id).count }; },
    markNotificationsRead(slug, ids = null) { const ws=workspace(slug); const timestamp=now(); if (Array.isArray(ids) && ids.length) { const placeholders=ids.map(()=>'?').join(','); db.prepare(`UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE workspace_id=? AND id IN (${placeholders})`).run(timestamp,ws.id,...ids); } else db.prepare('UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE workspace_id=? AND archived_at IS NULL').run(timestamp,ws.id); return this.notificationStats(slug); },
    archiveNotification(notificationId, archived = true) { const row=db.prepare('SELECT * FROM notifications WHERE id=?').get(notificationId); if(!row) throw new Error('Notification not found'); db.prepare('UPDATE notifications SET archived_at=? WHERE id=?').run(archived ? now() : null,notificationId); return {...db.prepare('SELECT * FROM notifications WHERE id=?').get(notificationId),read:Boolean(row.read_at),payload:jsonObject(row.payload_json)}; },
    updateWorkspace(slug, input = {}) { const ws=workspace(slug); if (!ws) throw new Error('Workspace not found'); const current=this.getWorkspaceSettings(slug); const name=String(input.name ?? ws.name).trim() || ws.name; const timezone=String(input.timezone ?? ws.timezone); const description=input.description === undefined ? current.description : String(input.description); const context=input.context === undefined ? current.context : String(input.context); const visibility=input.visibility === undefined ? current.visibility : (input.visibility === 'personal' ? 'personal' : 'workspace'); const prefix=input.prefix === undefined ? current.prefix : String(input.prefix); const quota=input.quota === undefined ? current.quota : input.quota; const preferences=input.preferences && typeof input.preferences === 'object' ? {...current.preferences,...input.preferences} : current.preferences; db.prepare('UPDATE workspaces SET name=?,timezone=? WHERE id=?').run(name,timezone,ws.id); db.prepare('INSERT INTO workspace_preferences(workspace_id,description,context,visibility,prefix,quota_json,profile_json,preferences_json) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET description=excluded.description,context=excluded.context,visibility=excluded.visibility,prefix=excluded.prefix,quota_json=excluded.quota_json,preferences_json=excluded.preferences_json').run(ws.id,description,context,visibility,prefix,JSON.stringify(quota),JSON.stringify(current.profile),JSON.stringify(preferences)); audit(slug,'user','workspace.updated',{name,timezone}); return this.getWorkspaceSettings(slug); },
    getWorkspaceSettings(slug) { const ws=workspace(slug); if(!ws) throw new Error('Workspace not found'); const prefs=db.prepare('SELECT * FROM workspace_preferences WHERE workspace_id=?').get(ws.id) || {description:'',context:'',visibility:'workspace',prefix:'',quota_json:'{}',profile_json:'{}',preferences_json:'{}'}; return {...ws,description:prefs.description,context:prefs.context,visibility:prefs.visibility,prefix:prefs.prefix,quota:jsonObject(prefs.quota_json),profile:jsonObject(prefs.profile_json),preferences:jsonObject(prefs.preferences_json)}; },
    updateProfile(slug, input = {}) { const ws=workspace(slug); const current=this.getWorkspaceSettings(slug); const profile={...current.profile,...input}; db.prepare('INSERT INTO workspace_preferences(workspace_id,description,context,visibility,prefix,quota_json,profile_json,preferences_json) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET profile_json=excluded.profile_json').run(ws.id,current.description,current.context,current.visibility,current.prefix,JSON.stringify(current.quota),JSON.stringify(profile),JSON.stringify(current.preferences)); audit(slug,'user','profile.updated',Object.keys(input)); return this.getWorkspaceSettings(slug); },
    updatePreferences(slug, input = {}) { const ws=workspace(slug); const current=this.getWorkspaceSettings(slug); const preferences={...current.preferences,...input}; db.prepare('INSERT INTO workspace_preferences(workspace_id,description,context,visibility,prefix,quota_json,profile_json,preferences_json) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET preferences_json=excluded.preferences_json').run(ws.id,current.description,current.context,current.visibility,current.prefix,JSON.stringify(current.quota),JSON.stringify(current.profile),JSON.stringify(preferences)); audit(slug,'user','preferences.updated',Object.keys(input)); return this.getWorkspaceSettings(slug); },
    listApiKeys(slug) { const ws=workspace(slug); if (!ws) throw new Error('Workspace not found'); const rows=db.prepare('SELECT id,name,prefix,status,expires_at,created_at,revoked_at,last_used_at,role,rotated_from FROM api_keys WHERE workspace_id=? ORDER BY created_at DESC').all(ws.id); const nowMs=Date.now(); return rows.map(row => ({...row,status:row.status === 'active' && row.expires_at && Date.parse(row.expires_at) <= nowMs ? 'expired' : row.status})); },
    createApiKey(slug, input = {}) { const ws=workspace(slug); if (!ws) throw new Error('Workspace not found'); const name=String(input.name || '默认 API Key').trim(); if (!name) throw new Error('API Key 名称不能为空'); const token=`zwi_${crypto.randomBytes(24).toString('base64url')}`; const prefix=token.slice(0,12); const hash=crypto.createHash('sha256').update(token).digest('hex'); const item={id:id('key'),workspace_id:ws.id,name,prefix,token_hash:hash,status:'active',expires_at:input.expiresAt || input.expires_at || null,created_at:now(),revoked_at:null,last_used_at:null,role:['owner','admin','member'].includes(input.role) ? input.role : 'member',rotated_from:input.rotatedFrom || input.rotated_from || null}; db.prepare('INSERT INTO api_keys(id,workspace_id,name,prefix,token_hash,status,expires_at,created_at,revoked_at,last_used_at,role,rotated_from) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(item.id,item.workspace_id,item.name,item.prefix,item.token_hash,item.status,item.expires_at,item.created_at,null,null,item.role,item.rotated_from); audit(slug,'user','api_key.created',{keyId:item.id,name,role:item.role}); const {token_hash:_hash, ...safe}=item; return {...safe,token}; },
    revokeApiKey(keyId) { const row=db.prepare('SELECT * FROM api_keys WHERE id=?').get(keyId); if (!row) throw new Error('API Key not found'); const revoked=now(); db.prepare("UPDATE api_keys SET status='revoked',revoked_at=? WHERE id=?").run(revoked,keyId); const updated=db.prepare('SELECT id,name,prefix,status,expires_at,created_at,revoked_at,last_used_at,role,rotated_from FROM api_keys WHERE id=?').get(keyId); const ws=db.prepare('SELECT slug FROM workspaces WHERE id=?').get(row.workspace_id); audit(ws.slug,'user','api_key.revoked',{keyId}); return updated; },
    rotateApiKey(keyId, input = {}) { const row=db.prepare('SELECT * FROM api_keys WHERE id=?').get(keyId); if(!row) throw new Error('API Key not found'); if(row.status !== 'active') throw new Error('只有 active API Key 可以轮换'); const ws=db.prepare('SELECT slug FROM workspaces WHERE id=?').get(row.workspace_id); const rotated=this.createApiKey(ws.slug,{name:input.name || row.name,expiresAt:input.expiresAt || input.expires_at || row.expires_at,role:row.role,rotatedFrom:row.id}); this.revokeApiKey(row.id); audit(ws.slug,'user','api_key.rotated',{oldKeyId:row.id,newKeyId:rotated.id}); return rotated; },
    verifyApiKey(token) { const candidate=String(token || '').trim(); if (!candidate) return null; const hash=crypto.createHash('sha256').update(candidate).digest('hex'); const row=db.prepare('SELECT * FROM api_keys WHERE token_hash=?').get(hash); if (!row || row.status !== 'active' || (row.expires_at && Date.parse(row.expires_at) <= Date.now())) return null; db.prepare('UPDATE api_keys SET last_used_at=? WHERE id=?').run(now(),row.id); return {id:row.id,workspace_id:row.workspace_id,name:row.name,prefix:row.prefix,role:row.role || 'member'}; },
    createA2ATask(slug,input={}) { return this.createTask(slug,{title:input.title || input.message || 'A2A task',description:input.description || '',priority:input.priority || 'medium'}); },
    taskExecution(taskId) {
      const row = db.prepare("SELECT * FROM a2a_actions WHERE task_id=? AND type='task.execute' ORDER BY created_at DESC LIMIT 1").get(taskId);
      if (!row) return null;
       return { id:row.id, type:row.type, status:row.status, created_at:row.created_at, acked_at:row.acked_at, completed_at:row.completed_at, result:parse(row.result_json), error:row.error, events:actionEvents(row.id) };
    },
    getTask(taskId) { const task=db.prepare('SELECT * FROM tasks WHERE id=?').get(taskId); return task ? {...task,labels:parse(task.labels_json),attachments:this.listTaskAttachments(taskId),execution:this.taskExecution(taskId)} : null; },
    createTaskAttachment(taskId, input = {}) {
      const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(taskId); if (!task) throw new Error('Task not found');
      let name = String(input.name || input.filename || '').trim(); if (!name) throw new Error('附件名称不能为空');
      if (name.length > 255) name = name.slice(0, 255);
      let encoding = String(input.contentEncoding ?? input.content_encoding ?? 'base64').toLowerCase();
      const suppliedData = input.data ?? input.content ?? '';
      const binaryInput = Buffer.isBuffer(suppliedData) || suppliedData instanceof Uint8Array;
      let encoded = binaryInput ? Buffer.from(suppliedData).toString('base64') : String(suppliedData);
      let mimeType = String(input.mimeType ?? input.mime_type ?? 'application/octet-stream').trim() || 'application/octet-stream';
      if (encoded.startsWith('data:')) { const match = encoded.match(/^data:([^;,]+)?;base64,(.*)$/s); if (!match) throw new Error('附件 data URL 无效'); mimeType = match[1] || mimeType; encoded = match[2]; encoding = 'base64'; }
      let bytes;
      if (binaryInput) { bytes = Buffer.from(suppliedData); encoding = 'base64'; encoded = bytes.toString('base64'); }
      else if (encoding === 'utf8' || encoding === 'utf-8' || encoding === 'text') { bytes = Buffer.from(encoded, 'utf8'); encoding = 'base64'; encoded = bytes.toString('base64'); }
      else {
        encoding = 'base64'; const normalized = encoded.replace(/\s+/g, '');
        if (normalized && (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 === 1)) throw new Error('附件必须是有效的 Base64 内容');
        bytes = Buffer.from(normalized, 'base64'); encoded = normalized;
      }
      const maxBytes = 10 * 1024 * 1024; if (bytes.length > maxBytes) throw new Error('附件不能超过 10 MiB');
      const checksum = crypto.createHash('sha256').update(bytes).digest('hex'); const createdAt = now(); const stored = objectStore ? objectStore.put(bytes) : null;
      const attachment = { id:id('attachment'), task_id:taskId, name, mime_type:mimeType.slice(0, 255), size:bytes.length, content:stored ? '' : encoded, content_encoding:stored ? 'base64' : encoding, storage_key:stored?.key || (input.storageKey ?? input.storage_key ?? null), checksum, created_at:createdAt };
      db.prepare('INSERT INTO task_attachments(id,task_id,name,mime_type,size,content,content_encoding,storage_key,checksum,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(attachment.id,attachment.task_id,attachment.name,attachment.mime_type,attachment.size,attachment.content,attachment.content_encoding,attachment.storage_key,attachment.checksum,createdAt);
      const ws = db.prepare('SELECT slug FROM workspaces WHERE id=?').get(task.workspace_id); audit(ws.slug,'user','task.attachment.created',{taskId,attachmentId:attachment.id,name:attachment.name,size:attachment.size});
      return taskAttachmentView(attachment);
    },
    listTaskAttachments(taskId) { const task = db.prepare('SELECT id FROM tasks WHERE id=?').get(taskId); if (!task) throw new Error('Task not found'); return db.prepare('SELECT id,task_id,name,mime_type,size,content_encoding,storage_key,checksum,created_at FROM task_attachments WHERE task_id=? ORDER BY created_at').all(taskId); },
    getTaskAttachment(attachmentId) { const row = db.prepare('SELECT * FROM task_attachments WHERE id=?').get(attachmentId); if (!taskAttachmentView(row)) return null; if (objectStore && row.storage_key) { const bytes=objectStore.get(row.storage_key,{checksum:row.checksum}); return {...taskAttachmentView(row), content:bytes.toString('base64'), content_encoding:'base64'}; } return {...taskAttachmentView(row), content:row.content}; },
    deleteTaskAttachment(attachmentId) { const row = db.prepare('SELECT a.*,t.workspace_id FROM task_attachments a JOIN tasks t ON t.id=a.task_id WHERE a.id=?').get(attachmentId); if (!row) throw new Error('附件不存在'); db.prepare('DELETE FROM task_attachments WHERE id=?').run(attachmentId); if (objectStore && row.storage_key) { const refs = db.prepare('SELECT COUNT(*) AS count FROM task_attachments WHERE storage_key=?').get(row.storage_key).count; if (!refs) objectStore.delete(row.storage_key); } const ws = db.prepare('SELECT slug FROM workspaces WHERE id=?').get(row.workspace_id); audit(ws.slug,'user','task.attachment.deleted',{taskId:row.task_id,attachmentId}); return taskAttachmentView(row); },
    addTaskMessage(taskId, input={}) { const message={id:id('msg'),task_id:taskId,role:input.role||'user',content:String(input.content||''),created_at:now()}; db.prepare('INSERT INTO task_messages(id,task_id,role,content,created_at) VALUES(?,?,?,?,?)').run(message.id,message.task_id,message.role,message.content,message.created_at); return message; },
    getTaskMessages(taskId) { return db.prepare('SELECT * FROM task_messages WHERE task_id=? ORDER BY created_at').all(taskId); },
    listConversations(slug, input = {}) {
      const ws=workspace(slug); if(!ws) throw new Error('Workspace not found');
      const context=employeeAccessContext(input);
      const requestedEmployee = input.conversationEmployeeId ?? input.conversation_employee_id ?? input.employeeFilter ?? input.employee_filter;
      const employeeFilter = requestedEmployee === undefined || requestedEmployee === null ? null : String(requestedEmployee).trim();
      return db.prepare('SELECT * FROM conversations WHERE workspace_id=? ORDER BY updated_at DESC').all(ws.id)
        .filter(row => {
          const employee = row.employee_id ? db.prepare('SELECT * FROM employees WHERE id=? AND workspace_id=?').get(row.employee_id, ws.id) : null;
          if (row.employee_id && !employeeVisible(employee, context)) return false;
          if (employeeFilter === null || employeeFilter === '') return true;
          if (employeeFilter === 'unassigned') return !row.employee_id;
          return row.employee_id === employeeFilter;
        })
        .map(row => {
          const employee = row.employee_id ? db.prepare('SELECT * FROM employees WHERE id=? AND workspace_id=?').get(row.employee_id, ws.id) : null;
          return {
            ...row,
            employee: conversationEmployeeView(employee),
            employee_binding: employee ? 'bound' : 'unassigned_legacy',
            requires_employee_assignment: !employee,
            message_count:db.prepare('SELECT COUNT(*) AS count FROM conversation_messages WHERE conversation_id=?').get(row.id).count,
            execution:conversationExecution(row.id)
          };
        });
    },
    getConversation(conversationId, input = {}) {
      const row=db.prepare('SELECT * FROM conversations WHERE id=?').get(conversationId); if(!row) return null;
      const employee = row.employee_id ? db.prepare('SELECT * FROM employees WHERE id=? AND workspace_id=?').get(row.employee_id,row.workspace_id) : null;
      if (row.employee_id && !employeeVisible(employee, employeeAccessContext(input))) return null;
      return {
        ...row,
        employee: conversationEmployeeView(employee),
        employee_binding: employee ? 'bound' : 'unassigned_legacy',
        requires_employee_assignment: !employee,
        execution:conversationExecution(conversationId),
        messages:db.prepare('SELECT * FROM conversation_messages WHERE conversation_id=? ORDER BY created_at').all(conversationId).map(item=>({...item,attachments:parse(item.attachment_json)}))
      };
    },
    createConversation(slug,input={}) { const ws=workspace(slug); if(!ws) throw new Error('Workspace not found'); const employeeId=input.employeeId || input.employee_id || null; const employee=employeeId ? assertEmployeeVisible(db.prepare('SELECT * FROM employees WHERE id=? AND workspace_id=?').get(employeeId,ws.id), input) : null; const deviceId=String(input.deviceId ?? input.device_id ?? input.targetDeviceId ?? input.target_device_id ?? '').trim() || null; if (deviceId) { const device=db.prepare('SELECT * FROM devices WHERE id=? AND workspace_id=?').get(deviceId,ws.id); if (!device) throw new Error('目标设备不属于当前工作区'); if (device.status === 'disabled') throw new Error('目标设备已停用'); const privilegedDeviceRole=['owner','admin'].includes(String(input.actorRole || '').toLowerCase()); if (ws.kind === 'personal' && input.enforceDeviceOwnership && !privilegedDeviceRole && (!input.actorUserId || device.owner_user_id !== input.actorUserId)) throw new Error('个人工作区只能使用本人的设备'); } const timestamp=now(); const modelId=String(input.modelId ?? input.model_id ?? input.model ?? '').trim() || null; const workingDirectory=String(input.workingDirectory ?? input.working_directory ?? input.cwd ?? input.workdir ?? '').trim().slice(0,4096) || null; const conversation={id:id('conv'),workspace_id:ws.id,employee_id:employeeId,title:String(input.title || '新对话').trim() || '新对话',status:'active',model_id:modelId,working_directory:workingDirectory,device_id:deviceId,created_at:timestamp,updated_at:timestamp}; db.prepare('INSERT INTO conversations(id,workspace_id,employee_id,title,status,model_id,working_directory,device_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(conversation.id,ws.id,employeeId,conversation.title,'active',modelId,workingDirectory,deviceId,timestamp,timestamp); audit(slug,'user','conversation.created',{conversationId:conversation.id,employeeId,modelId,workingDirectory,deviceId}); return {...conversation,employee:conversationEmployeeView(employee),employee_binding:employee ? 'bound' : 'unassigned_legacy',requires_employee_assignment:!employee,messages:[]}; },
    updateConversationSettings(conversationId,input={}) { const row=db.prepare('SELECT * FROM conversations WHERE id=?').get(conversationId); if(!row) throw new Error('Conversation not found'); const employee = row.employee_id ? db.prepare('SELECT * FROM employees WHERE id=? AND workspace_id=?').get(row.employee_id,row.workspace_id) : null; if (row.employee_id && !employeeVisible(employee, employeeAccessContext(input))) throw new Error('Conversation not found'); const deviceId=input.deviceId === undefined && input.device_id === undefined && input.targetDeviceId === undefined && input.target_device_id === undefined ? row.device_id || null : (String(input.deviceId ?? input.device_id ?? input.targetDeviceId ?? input.target_device_id ?? '').trim() || null); if (deviceId) { const device=db.prepare('SELECT * FROM devices WHERE id=? AND workspace_id=?').get(deviceId,row.workspace_id); if (!device) throw new Error('目标设备不属于当前工作区'); if (device.status === 'disabled') throw new Error('目标设备已停用'); } const modelId=input.modelId === undefined && input.model_id === undefined && input.model === undefined ? row.model_id || null : (String(input.modelId ?? input.model_id ?? input.model ?? '').trim() || null); const workingDirectory=input.workingDirectory === undefined && input.working_directory === undefined && input.cwd === undefined && input.workdir === undefined ? row.working_directory || null : (String(input.workingDirectory ?? input.working_directory ?? input.cwd ?? input.workdir ?? '').trim().slice(0,4096) || null); db.prepare('UPDATE conversations SET model_id=?,working_directory=?,device_id=?,updated_at=? WHERE id=?').run(modelId,workingDirectory,deviceId,now(),conversationId); return this.getConversation(conversationId, input); },
    addConversationMessage(conversationId,input={}) { const conversation=db.prepare('SELECT * FROM conversations WHERE id=?').get(conversationId); if(!conversation) throw new Error('Conversation not found'); const ws=db.prepare('SELECT * FROM workspaces WHERE id=?').get(conversation.workspace_id); const employee=conversation.employee_id ? assertEmployeeVisible(db.prepare('SELECT * FROM employees WHERE id=? AND workspace_id=?').get(conversation.employee_id,conversation.workspace_id), input) : null; const targetDeviceId=String(input.targetDeviceId || input.target_device_id || input.deviceId || input.device_id || conversation.device_id || '').trim() || null; if (targetDeviceId) { const device=db.prepare('SELECT * FROM devices WHERE id=? AND workspace_id=?').get(targetDeviceId,conversation.workspace_id); if (!device) throw new Error('目标设备不属于当前工作区'); if (device.status === 'disabled') throw new Error('目标设备已停用'); const privilegedDeviceRole = ['owner', 'admin'].includes(String(input.actorRole || '').toLowerCase()); if (ws.kind === 'personal' && input.enforceDeviceOwnership && !privilegedDeviceRole && (!input.actorUserId || device.owner_user_id !== input.actorUserId)) throw new Error('个人工作区只能使用本人的设备'); } const message={id:id('convmsg'),conversation_id:conversationId,role:['user','assistant','system'].includes(input.role) ? input.role : 'user',content:String(input.content || '').trim(),attachments:normalizeConversationAttachments(input.attachments),created_at:now()}; if(!message.content && !message.attachments.length) throw new Error('消息内容不能为空'); db.prepare('INSERT INTO conversation_messages(id,conversation_id,role,content,attachment_json,created_at) VALUES(?,?,?,?,?,?)').run(message.id,conversationId,message.role,message.content,JSON.stringify(message.attachments),message.created_at); db.prepare('UPDATE conversations SET updated_at=? WHERE id=?').run(message.created_at,conversationId); audit(ws.slug,message.role,'conversation.message.created',{conversationId,messageId:message.id,dispatch:input.dispatch !== false}); if (message.role === 'user' && input.dispatch !== false) { const payload=executionPayload({prompt:message.content,employee,runtime:input.runtime || employee?.runtime || null,model:input.model || input.modelId || conversation.model_id || employee?.model_id || null,profile:input.profile ?? input.runtimeProfile ?? input.runtime_profile ?? input.hermesProfile ?? input.hermes_profile ?? employee?.runtime_profile,conversationId,targetDeviceId,cwd:input.cwd || input.workingDirectory || input.working_directory || input.workdir || conversation.working_directory || null}); payload.messageId=message.id; if (message.attachments.length) payload.attachments=message.attachments; this.createA2AAction(ws.slug,{type:'conversation.execute',payload,dedupeKey:`conversation:${conversationId}:${message.id}`}); } return {...message,execution:conversationExecution(conversationId)}; },
    archiveConversation(conversationId, archived = true) { const row=db.prepare('SELECT * FROM conversations WHERE id=?').get(conversationId); if(!row) throw new Error('Conversation not found'); db.prepare('UPDATE conversations SET status=? WHERE id=?').run(archived ? 'archived' : 'active',conversationId); return this.getConversation(conversationId); },
    workspaceSlugForA2AAction(actionId) {
      const row = db.prepare('SELECT w.slug FROM a2a_actions a JOIN workspaces w ON w.id=a.workspace_id WHERE a.id=?').get(String(actionId || ''));
      return row?.slug || null;
    },
    registerA2AAgent(slug, input = {}) { const ws = workspace(slug); if (!ws) throw new Error('Workspace not found'); const agentId = String(input.agentId || input.agent_id || 'ziwei_user'); if (agentId !== 'ziwei_user') throw new Error('Only ziwei_user agent is accepted'); return this.heartbeatDevice(slug, { ...input, agentId, serviceName:'ziwei_user' }); },
    createA2AAction(slug, input = {}) {
      const ws = workspace(slug); if (!ws) throw new Error('Workspace not found');
      const agentId = String(input.agentId || input.agent_id || 'ziwei_user'); if (agentId !== 'ziwei_user') throw new Error('Only ziwei_user agent is accepted');
      const dedupeKey = String(input.dedupeKey || input.dedupe_key || `${input.type || 'action'}:${crypto.randomUUID()}`);
      const existing = db.prepare('SELECT * FROM a2a_actions WHERE workspace_id=? AND dedupe_key=? ORDER BY created_at DESC LIMIT 1').get(ws.id, dedupeKey);
      if (existing) return { ...existing, duplicate: true, payload: parse(existing.payload_json), result: parse(existing.result_json) };
      const action = { id:id('action'), workspace_id:ws.id, agent_id:agentId, task_id:input.taskId || input.task_id || null, type:String(input.type || 'task.execute'), payload:input.payload && typeof input.payload === 'object' ? input.payload : {}, dedupe_key:dedupeKey, status:'pending', expires_at:input.expiresAt || input.expires_at || new Date(Date.now()+15*60*1000).toISOString(), created_at:now(), acked_at:null, completed_at:null, result_json:null, error:null };
      db.prepare('INSERT INTO a2a_actions(id,workspace_id,agent_id,task_id,type,payload_json,dedupe_key,status,expires_at,created_at,acked_at,completed_at,result_json,error) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(action.id,action.workspace_id,action.agent_id,action.task_id,action.type,JSON.stringify(action.payload),action.dedupe_key,action.status,action.expires_at,action.created_at,null,null,null,null);
      audit(slug,'user','a2a.action.created',{actionId:action.id,type:action.type,dedupeKey}); return action;
    },
    listA2AActions(slug, input = {}) {
      const ws = workspace(slug); if (!ws) throw new Error('Workspace not found'); const agentId=String(input.agentId || input.agent_id || 'ziwei_user'); const requestedStatus=String(input.status || 'pending');
      db.prepare("UPDATE a2a_actions SET status='expired',completed_at=? WHERE workspace_id=? AND status IN ('pending','acked') AND expires_at IS NOT NULL AND expires_at < ?").run(now(),ws.id,now());
      // `ziwei_user` asks for pending + previously acked work. An ack is only
      // transport receipt; if the daemon crashed before posting a terminal
      // result, the acked action must be delivered again after restart.
      const includeAcked = input.includeAcked === true || input.includeAcked === 1 || String(input.includeAcked || '').toLowerCase() === 'true';
      const statuses = requestedStatus === 'all' ? ['pending','acked','succeeded','failed','expired'] : (requestedStatus === 'pending' && includeAcked ? ['pending','acked'] : [requestedStatus]); const placeholders=statuses.map(()=>'?').join(',');
      const deviceId = String(input.deviceId || input.device_id || '').trim();
      const rows=db.prepare(`SELECT * FROM a2a_actions WHERE workspace_id=? AND agent_id=? AND status IN (${placeholders}) ORDER BY created_at`).all(ws.id,agentId,...statuses);
      return rows.filter(row => !deviceId || !actionTargetDevice(row) || actionTargetDevice(row) === deviceId)
        .map(row => ({...row,payload:parse(row.payload_json),result:parse(row.result_json)}));
    },
    ackA2AAction(actionId, input = {}) {
      const row=db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(actionId); if (!row) throw new Error('A2A action not found'); if (input.agentId && String(input.agentId) !== row.agent_id) throw new Error('A2A agent mismatch'); if (row.status === 'expired') throw new Error('A2A action expired'); if (row.status === 'succeeded' || row.status === 'failed') return {...row,duplicate:true,payload:parse(row.payload_json),result:parse(row.result_json)};
      assertActionDevice(row, input);
      const timestamp=now(); const timestampMs=Date.parse(timestamp); const payload=parse(row.payload_json); const originalExpiryMs=Date.parse(row.expires_at || '');
      if (row.status === 'pending' && Number.isFinite(originalExpiryMs) && originalExpiryMs <= timestampMs) {
        db.prepare("UPDATE a2a_actions SET status='expired',completed_at=? WHERE id=? AND status='pending'").run(timestamp,actionId);
        throw new Error('A2A action expired');
      }
      const executionLeaseMs = a2aExecutionTimeoutMs(payload) + A2A_EXECUTION_LEASE_BUFFER_MS;
      const leaseExpiry = new Date(timestampMs + executionLeaseMs).toISOString();
      const expiresAt = Number.isFinite(originalExpiryMs) && originalExpiryMs > Date.parse(leaseExpiry) ? row.expires_at : leaseExpiry;
      db.prepare("UPDATE a2a_actions SET status='acked',acked_at=?,expires_at=? WHERE id=? AND status='pending'").run(timestamp,expiresAt,actionId);
      markTaskRunning(row.task_id); const updated=db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(actionId); return {...updated,duplicate:updated.acked_at !== timestamp,payload:parse(updated.payload_json),result:parse(updated.result_json)};
    },
    recordA2AEvent(actionId, input = {}) { const row=db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(actionId); if(!row) throw new Error('A2A action not found'); if(input.agentId && String(input.agentId)!==row.agent_id) throw new Error('A2A agent mismatch'); assertActionDevice(row, input); if (['succeeded','failed','expired'].includes(row.status)) throw new Error('A2A action is already terminal'); const event={id:id('action-event'),action_id:actionId,type:String(input.type || 'progress').slice(0,80),message:String(input.message || '').slice(0,4000),data:input.data ?? null,created_at:now()}; db.prepare('INSERT INTO a2a_action_events(id,action_id,type,message,data_json,created_at) VALUES(?,?,?,?,?,?)').run(event.id,event.action_id,event.type,event.message,JSON.stringify(event.data),event.created_at); const ws=db.prepare('SELECT slug FROM workspaces WHERE id=?').get(row.workspace_id); if (ws) audit(ws.slug,'ziwei_user','a2a.action.event',{actionId,type:event.type,message:event.message}); return event; },
    listA2AEvents(actionId) { const row=db.prepare('SELECT id FROM a2a_actions WHERE id=?').get(actionId); if (!row) throw new Error('A2A action not found'); return db.prepare('SELECT id,action_id,type,message,data_json,created_at FROM a2a_action_events WHERE action_id=? ORDER BY created_at,id').all(actionId).map(item => ({...item,data:parse(item.data_json)})); },
    resultA2AAction(actionId, input = {}) {
      const row=db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(actionId); if (!row) throw new Error('A2A action not found'); if (input.agentId && String(input.agentId) !== row.agent_id) throw new Error('A2A agent mismatch'); assertActionDevice(row, input); if (row.status === 'succeeded' || row.status === 'failed' || row.status === 'expired') return {...row,duplicate:true,payload:parse(row.payload_json),result:parse(row.result_json)}; const status=String(input.status || (input.error ? 'failed' : 'succeeded')); if (!['succeeded','failed'].includes(status)) throw new Error('A2A result status must be succeeded or failed'); const timestamp=now(); db.prepare('UPDATE a2a_actions SET status=?,completed_at=?,result_json=?,error=? WHERE id=?').run(status,timestamp,input.result === undefined ? null : JSON.stringify(input.result),input.error ? String(input.error) : null,actionId); const updated=db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(actionId); const payload=parse(updated.payload_json); const ws=db.prepare('SELECT slug FROM workspaces WHERE id=?').get(updated.workspace_id); audit(ws.slug,'ziwei_user',`a2a.action.${status}`,{actionId, type:updated.type, error:input.error || null}); if (updated.task_id) taskExecutionMessage(updated.task_id, status, input.error || null, input.result); if (updated.task_id && payload.conversationId) { const content = input.error ? `执行失败：${input.error}` : (typeof input.result === 'string' ? input.result : (input.result?.output || input.result?.text || input.result?.result?.output || input.result?.result?.text || '执行完成')); if (content) this.addConversationMessage(payload.conversationId,{role:'assistant',content,dispatch:false}); } if(updated.type === 'automation.execute' && payload.runId) this.completeAutomationRun(payload.runId,{status:status==='succeeded'?'completed':'failed',result:input.result,error:input.error}); if (updated.type === 'conversation.execute' && payload.conversationId) { const content = input.error ? `执行失败：${input.error}` : (typeof input.result === 'string' ? input.result : (input.result?.output || input.result?.text || input.result?.result?.output || input.result?.result?.text || '执行完成')); if (content) this.addConversationMessage(payload.conversationId,{role:'assistant',content,dispatch:false}); } return {...updated,payload,result:parse(updated.result_json)};
    },
    getA2AAction(actionId, { workspaceSlug = null, actorUserId = null } = {}) {
      const row = db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(String(actionId || ''));
      if (!row) return null;
      const ws = db.prepare('SELECT slug FROM workspaces WHERE id=?').get(row.workspace_id);
      if (workspaceSlug && ws?.slug !== String(workspaceSlug)) throw new Error('A2A action 不属于当前工作区');
      const payload = parse(row.payload_json);
      if (actorUserId && payload.userId && String(payload.userId) !== String(actorUserId)) throw new Error('无权查看该 A2A action');
      return actionView(row, { includeEvents: true });
    }
  };
}
