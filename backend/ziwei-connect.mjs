import { randomUUID } from 'node:crypto';
import { closeSync, fstatSync, openSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const now = () => new Date().toISOString();
const id = prefix => `${prefix}-${randomUUID()}`;
const text = (value, field, max = 200) => {
  const result = String(value ?? '').trim();
  if (!result || result.length > max) throw Object.assign(new Error(`${field} 不能为空且不能超过 ${max} 个字符`), { status: 400 });
  return result;
};

function externalError(message, status = 502, details = null) {
  const error = new Error(message);
  error.status = status;
  error.details = details;
  return error;
}

const terminalActions = new Set(['health', 'screenshot', 'tap', 'swipe', 'text', 'global', 'launch']);
const commandStatuses = new Set(['queued', 'delivered', 'executing', 'succeeded', 'failed', 'cancelled', 'expired', 'uncertain', 'acknowledged']);
const settledCommandStatuses = new Set(['succeeded', 'failed', 'cancelled', 'expired', 'acknowledged']);
const commandStatus = command => commandStatuses.has(command?.status) ? command.status : 'queued';
const terminalId = value => {
  let decoded;
  try { decoded = decodeURIComponent(value); } catch { throw externalError('终端标识无效', 400); }
  if (!/^[A-Za-z0-9_-][A-Za-z0-9._:-]{0,199}$/.test(decoded)) throw externalError('终端标识无效', 400);
  return encodeURIComponent(decoded);
};

function terminalRequest(method, path, body) {
  if (!['GET', 'POST'].includes(method)) throw externalError('终端管理仅支持 GET、POST', 405);
  const [pathname, queryString = '', ...extra] = String(path).split('?');
  if (extra.length) throw externalError('终端请求路径无效', 400);
  const query = new URLSearchParams(queryString);
  let target;
  let keys;
  let queryKeys = [];
  if (pathname === '/android-devices') {
    target = pathname;
    if (method === 'GET') queryKeys = ['summary'];
    else keys = ['alias'];
  } else if (method === 'GET' && pathname === '/android-devices/enrollment-requests') {
    target = pathname;
  } else {
    let match;
    if (method === 'POST' && (match = pathname.match(/^\/android-devices\/enrollment-requests\/([^/]+)\/(approve|reject)$/))) {
      target = `/android-devices/enrollment-requests/${terminalId(match[1])}/${match[2]}`;
      keys = [];
    } else if (method === 'GET' && (match = pathname.match(/^\/android-devices\/([^/]+)(?:\/(status|snapshot))?$/))) {
      target = `/android-devices/${terminalId(match[1])}${match[2] ? `/${match[2]}` : ''}`;
      if (match[2] === 'status') queryKeys = ['commandId', 'updateId'];
    } else if (method === 'POST' && (match = pathname.match(/^\/android-devices\/([^/]+)\/(control|commands|updates|archive)(?:\/([^/]+)\/resolve)?$/))) {
      const [, deviceId, operation, receiptId] = match;
      if (receiptId && !['commands', 'updates'].includes(operation)) throw externalError('终端管理接口不存在', 404);
      target = `/android-devices/${terminalId(deviceId)}/${operation}${receiptId ? `/${terminalId(receiptId)}/resolve` : ''}`;
      keys = operation === 'commands' ? (receiptId ? ['resolution', 'note'] : ['action', 'args'])
        : operation === 'updates' ? (receiptId ? ['resolution'] : ['targetRole', 'apkUrl', 'sha256', 'signerSha256', 'versionCode', 'preflightCommandId', 'replacesUpdateId'])
          : operation === 'control' ? ['role'] : ['confirm'];
      if (operation === 'commands' && !receiptId && !terminalActions.has(body?.action)) throw externalError('不支持该手机动作', 400);
    }
  }
  if (!target) throw externalError('终端管理接口不存在', 404);
  for (const [key, value] of query) {
    if (!queryKeys.includes(key) || query.getAll(key).length !== 1) throw externalError('终端查询参数无效', 400);
    if (key === 'summary' ? !['0', '1'].includes(value) : !/^[A-Za-z0-9_-][A-Za-z0-9._:-]{0,199}$/.test(value)) throw externalError('终端查询参数无效', 400);
  }
  if (method === 'POST') {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw externalError('请求体必须是 JSON 对象', 400);
    if (Buffer.byteLength(JSON.stringify(body)) > 64 * 1024) throw externalError('终端请求体过大', 413);
    if (Object.keys(body).some(key => !keys.includes(key))) throw externalError('终端请求含有不支持的字段', 400);
  }
  return `${target}${query.size ? `?${query.toString()}` : ''}`;
}

/**
 * The main workspace app owns only the binding/run records. Device identity,
 * online state, commands and screenshots remain authoritative in 紫薇·互联.
 */
export function createZiweiConnect(repo, options = {}) {
  const db = repo.db;
  const apiBase = String(options.apiBase || process.env.ZIWEI_CONNECT_API_BASE || 'http://127.0.0.1:5191/api').replace(/\/$/, '');
  let endpoint;
  try { endpoint = new URL(apiBase); } catch { throw externalError('紫薇·互联 API 地址配置无效', 503); }
  const apiOrigin = endpoint.origin;
  const apiHost = endpoint.hostname;
  const isLoopback = ['127.0.0.1', 'localhost', '[::1]'].includes(apiHost);
  if ((!isLoopback && endpoint.protocol !== 'https:') || !['https:', 'http:'].includes(endpoint.protocol)
      || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/api') {
    throw externalError('紫薇·互联 API 地址配置无效', 503);
  }
  // The original loopback management API is private and does not require the
  // independent browser login enforced by its public gateway. Main-site
  // session/Owner/Admin checks protect the workspace proxy. Optional upstream
  // credentials are server-only for deployments using the authenticated gateway.
  const auth = options.auth || process.env.ZIWEI_CONNECT_AUTH || process.env.ZIWEI_CONTROL_AUTH || '';
  let cookie = options.cookie || process.env.ZIWEI_CONNECT_COOKIE || process.env.ZIWEI_CONTROL_COOKIE || '';
  const origin = options.origin || process.env.ZIWEI_CONNECT_ORIGIN || apiOrigin;
  const credentialsFile = options.credentialsFile || process.env.ZIWEI_CONNECT_CREDENTIALS_FILE;
  const username = options.username || process.env.ZIWEI_CONNECT_USERNAME;
  const password = options.password || process.env.ZIWEI_CONNECT_PASSWORD;
  const canLogin = Boolean(credentialsFile || username || password);
  const secrets = new Set([auth, cookie, password].filter(Boolean));
  const rememberCookie = value => {
    cookie = value;
    secrets.add(value);
    const token = value.slice(value.indexOf('=') + 1);
    if (token) secrets.add(token);
  };
  if (cookie) rememberCookie(cookie);
  const redact = value => {
    if (typeof value === 'string') {
      for (const secret of secrets) value = value.split(secret).join('[已隐藏]');
      return value;
    }
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item)]));
    return value;
  };
  const credentials = () => {
    let value = { username, password };
    if (credentialsFile) {
      let descriptor;
      try {
        descriptor = openSync(credentialsFile, 'r');
        const stat = fstatSync(descriptor);
        if (!stat.isFile() || stat.size > 4096 || (process.platform !== 'win32' && (stat.mode & 0o027))) throw new Error('invalid credentials file');
        value = JSON.parse(readFileSync(descriptor, 'utf8'));
      } catch { throw externalError('紫薇·互联服务端登录凭据配置无效', 503); }
      finally { if (descriptor !== undefined) closeSync(descriptor); }
    }
    if (!value || Array.isArray(value) || typeof value.username !== 'string' || !value.username.length || value.username.length > 80
        || typeof value.password !== 'string' || !value.password.length || value.password.length > 128 || value.passwordHash) {
      throw externalError('紫薇·互联服务端登录凭据配置无效；原密码哈希文件不能用于登录', 503);
    }
    secrets.add(value.password);
    return { username: value.username, password: value.password };
  };
  const readPayload = async response => {
    const limit = 16 * 1024 * 1024; // includes Base64 encoding of original 2 MiB screenshots and receipts
    if (Number(response.headers.get('content-length')) > limit) {
      await response.body?.cancel();
      throw externalError('紫薇·互联响应过大', 502);
    }
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of response.body || []) {
        size += chunk.length;
        if (size > limit) throw externalError('紫薇·互联响应过大', 502);
        chunks.push(chunk);
      }
    } catch (error) {
      if (error.status) throw error;
      throw externalError('紫薇·互联响应读取失败或超时，请刷新回执后核对结果', 502);
    }
    try {
      const value = size ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
      if (!value || typeof value !== 'object') throw new Error('invalid JSON');
      return redact(value);
    } catch { throw externalError('紫薇·互联返回了无效 JSON 响应', 502); }
  };
  const send = async (path, init = {}, sessionCookie = cookie) => {
    try {
      return await fetch(`${apiBase}${path}`, {
        ...init,
        headers: {
          accept: 'application/json', 'content-type': 'application/json',
          ...(auth ? { authorization: auth } : {}),
          ...(sessionCookie ? { cookie: sessionCookie } : {}),
          ...(!isLoopback ? { origin } : {}),
          ...(init.headers || {}),
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(Number(options.timeoutMs || 10000)),
      });
    } catch { throw externalError('紫薇·互联控制 API 不可达，请核对服务状态和连接配置'); }
  };
  let loginPromise;
  const login = async () => {
    if (!loginPromise) loginPromise = (async () => {
      const value = credentials();
      const response = await send('/admin-auth/login', { method: 'POST', body: JSON.stringify(value), headers: { origin } }, '');
      await readPayload(response);
      if (!response.ok) throw externalError('紫薇·互联服务端登录失败，请核对服务端私密凭据配置', response.status === 429 ? 503 : 502);
      const cookies = response.headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''];
      const session = cookies.map(item => item.split(';', 1)[0]).find(item => /^__Host-ziwei_session=[A-Za-z0-9_-]+$/.test(item));
      if (!session) throw externalError('紫薇·互联登录未返回有效会话', 502);
      rememberCookie(session);
    })().finally(() => { loginPromise = null; });
    await loginPromise;
  };
  db.exec(`
    CREATE TABLE IF NOT EXISTS ziwei_connect_bindings (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, employee_id TEXT NOT NULL,
      device_id TEXT NOT NULL, account_id TEXT, account_label TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(workspace_id, employee_id),
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_ziwei_connect_bindings_workspace ON ziwei_connect_bindings(workspace_id);
    CREATE TABLE IF NOT EXISTS ziwei_connect_runs (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, employee_id TEXT NOT NULL,
      binding_id TEXT, device_id TEXT NOT NULL, account_id TEXT, action TEXT NOT NULL,
      command_id TEXT, status TEXT NOT NULL, result_json TEXT, error TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_ziwei_connect_runs_workspace ON ziwei_connect_runs(workspace_id, created_at);
  `);
  for (const statement of ["ALTER TABLE ziwei_connect_runs ADD COLUMN configuration_revision TEXT", "ALTER TABLE ziwei_connect_runs ADD COLUMN execution_id TEXT"]) try { db.exec(statement); } catch(error) { if(!/duplicate column name/.test(error.message)) throw error; }

  const parse = (value, fallback = null) => {
    if (value == null) return fallback;
    try { return JSON.parse(value); } catch { return fallback; }
  };
  const workspace = slug => {
    const row = db.prepare('SELECT * FROM workspaces WHERE slug=?').get(slug);
    if (!row) throw Object.assign(new Error('工作区不存在'), { status: 404 });
    return row;
  };
  const employee = (ws, employeeId) => {
    const row = db.prepare('SELECT * FROM employees WHERE id=? AND workspace_id=?').get(employeeId, ws.id);
    if (!row) throw Object.assign(new Error('数字员工不存在或不属于当前工作区'), { status: 404 });
    return row;
  };
  const requestResponse = async (path, init = {}) => {
    if (canLogin && !cookie) await login();
    if (!isLoopback && !auth && !cookie) {
      throw externalError('紫薇·互联远程控制 API 需要认证：请配置服务端凭据或 ZIWEI_CONNECT_COOKIE；未认证远程调用已阻止', 401);
    }
    const usedCookie = cookie;
    let response = await send(path, init, usedCookie);
    if (response.status === 401 && canLogin) {
      await response.body?.cancel();
      if (cookie === usedCookie) await login();
      // Retry only a confirmed authentication failure, never a timeout or an
      // uncertain action result. The original command protocol owns execution.
      response = await send(path, init);
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw externalError('紫薇·互联控制 API 返回了不支持的重定向', 502);
    }
    return { status: response.status, body: await readPayload(response) };
  };
  const request = async (path, init = {}) => {
    const response = await requestResponse(path, init);
    if (response.status >= 400) throw externalError(response.body.message || response.body.error || `紫薇·互联控制 API 返回 ${response.status}`, response.status >= 500 ? 502 : response.status, response.body);
    return response.body;
  };
  const normalizeDevice = item => {
    const nodes = Array.isArray(item.nodes) ? item.nodes : [];
    const onlineNodes = nodes.filter(node => node?.status === 'online');
    return {
      id: item.id,
      deviceId: item.id,
      alias: item.alias || item.name || item.id,
      model: item.model || item.platform || 'Android',
      online: item.online === true || onlineNodes.length > 0,
      status: item.status || (onlineNodes.length ? 'online' : 'offline'),
      lastHeartbeat: item.lastHeartbeat || nodes.map(node => node.lastSeen).filter(Boolean).sort().at(-1) || null,
      nodes,
      health: item.health || {},
      control: item.control || null,
      commands: Array.isArray(item.commands) ? item.commands : [],
      snapshot: item.snapshot || null,
    };
  };
  const listExternalDevices = async ({ detailed = false } = {}) => {
    const payload = await request(`/android-devices${detailed ? '' : '?summary=1'}`);
    return (payload.devices || []).map(normalizeDevice);
  };
  const bindings = slug => {
    const ws = workspace(slug);
    return db.prepare(`SELECT b.*, e.name AS employee_name, e.runtime AS employee_runtime
      FROM ziwei_connect_bindings b JOIN employees e ON e.id=b.employee_id
      WHERE b.workspace_id=? ORDER BY b.updated_at DESC`).all(ws.id).map(row => ({
      id: row.id, employeeId: row.employee_id, employeeName: row.employee_name,
      employeeRuntime: row.employee_runtime, deviceId: row.device_id,
      accountId: row.account_id, accountLabel: row.account_label,
      createdAt: row.created_at, updatedAt: row.updated_at,
    }));
  };
  const notify = (slug, action, payload) => {
    const ws = workspace(slug); const at = now(); const eventId = id('audit');
    db.prepare('INSERT INTO audit_events(id,workspace_id,actor,action,payload_json,created_at) VALUES(?,?,?,?,?,?)').run(eventId, ws.id, 'ziwei-connect', action, JSON.stringify(payload), at);
    db.prepare('INSERT INTO notifications(id,workspace_id,event_id,actor,action,payload_json,created_at,read_at,archived_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id('notice'), ws.id, eventId, '紫薇·互联', action, JSON.stringify(payload), at, null, null);
  };
  const outputRun = row => ({
    id: row.id, employeeId: row.employee_id, bindingId: row.binding_id, deviceId: row.device_id,
    accountId: row.account_id, action: row.action, commandId: row.command_id, status: row.status,
    result: parse(row.result_json), error: row.error || null, createdAt: row.created_at, updatedAt: row.updated_at,
    configurationRevision: row.configuration_revision || null, executionId: row.execution_id || null,
  });
  const getRun = (slug, runId) => {
    const ws = workspace(slug);
    const row = db.prepare('SELECT * FROM ziwei_connect_runs WHERE id=? AND workspace_id=?').get(runId, ws.id);
    if (!row) throw Object.assign(new Error('紫薇·互联运行记录不存在'), { status: 404 });
    return { ws, row };
  };
  const updateRun = (row, values) => {
    const next = { status: values.status ?? row.status, result_json: values.result === undefined ? row.result_json : JSON.stringify(values.result), error: values.error === undefined ? row.error : (values.error || null), updated_at: now() };
    db.prepare('UPDATE ziwei_connect_runs SET status=?,result_json=?,error=?,updated_at=? WHERE id=?').run(next.status, next.result_json, next.error, next.updated_at, row.id);
    return db.prepare('SELECT * FROM ziwei_connect_runs WHERE id=?').get(row.id);
  };
  const bindVerified = (slug,input,devices) => {
    const ws=workspace(slug);const employeeId=text(input.employeeId || input.employee_id,'employeeId');const deviceId=text(input.deviceId || input.device_id,'deviceId');employee(ws,employeeId);
    if(!devices.some(row=>row.id===deviceId)) throw externalError('手机不在紫薇·互联设备目录中',404);
    const accountId=input.accountId == null || input.accountId==='' ? null : text(input.accountId,'accountId');const accountLabel=input.accountLabel == null || input.accountLabel==='' ? null : text(input.accountLabel,'accountLabel');
    const timestamp=now();const existing=db.prepare('SELECT id FROM ziwei_connect_bindings WHERE workspace_id=? AND employee_id=?').get(ws.id,employeeId);const bindingId=existing?.id || id('ziwei-binding');
    if(existing) db.prepare('UPDATE ziwei_connect_bindings SET device_id=?,account_id=?,account_label=?,updated_at=? WHERE id=?').run(deviceId,accountId,accountLabel,timestamp,bindingId);
    else db.prepare('INSERT INTO ziwei_connect_bindings(id,workspace_id,employee_id,device_id,account_id,account_label,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(bindingId,ws.id,employeeId,deviceId,accountId,accountLabel,timestamp,timestamp);
    notify(slug,'ziwei_connect.binding.updated',{bindingId,employeeId,deviceId,accountId,accountLabel});return bindings(slug).find(row=>row.id===bindingId);
  };

  return {
    async status(slug) {
      const devices = await listExternalDevices({ detailed: false });
      return {
        source: {
          product: '紫薇·互联', apiBase,
          provider: 'terminal-console-api',
          accessMode: isLoopback ? 'loopback-internal' : 'authenticated-remote',
          authoritative: ['devices', 'commands', 'screenshots'],
        },
        devices,
        diagnostics: { ok: true, onlineDevices: devices.filter(item => item.online).length, totalDevices: devices.length, sampledAt: now() },
        bindings: bindings(slug),
      };
    },
    async listDevices() { return listExternalDevices({ detailed: false }); },
    async terminal(slug, method, path, body = {}) {
      workspace(slug);
      const target = terminalRequest(method, path, body);
      return requestResponse(target, { method, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
    },
    listBindings: bindings,
    bindVerified,
    deleteBinding(slug, bindingId) {
      const ws = workspace(slug);
      const binding = db.prepare('SELECT * FROM ziwei_connect_bindings WHERE id=? AND workspace_id=?').get(bindingId, ws.id);
      if (!binding) throw externalError('当前工作区的手机绑定不存在', 404);
      db.prepare('DELETE FROM ziwei_connect_bindings WHERE id=? AND workspace_id=?').run(bindingId, ws.id);
      notify(slug, 'ziwei_connect.binding.deleted', { bindingId, employeeId: binding.employee_id, deviceId: binding.device_id });
      return { deleted: true, id: bindingId };
    },
    async bind(slug, input = {}) {
      const devices = await listExternalDevices({ detailed: false });
      return bindVerified(slug,input,devices);
    },
    async run(slug, input = {}, { fullToolset = false, configurationRevision = null, executionId = null } = {}) {
      const ws = workspace(slug); const employeeId = text(input.employeeId || input.employee_id, 'employeeId'); employee(ws, employeeId);
      const action = text(input.action, 'action', 32).toLowerCase();
      if (!(fullToolset ? terminalActions.has(action) : ['health', 'screenshot', 'dry-run'].includes(action))) throw Object.assign(new Error('不支持该手机动作'), { status: 400 });
      const binding = db.prepare('SELECT * FROM ziwei_connect_bindings WHERE workspace_id=? AND employee_id=?').get(ws.id, employeeId);
      const deviceId = text(input.deviceId || input.device_id || binding?.device_id, 'deviceId');
      if (!binding || binding.device_id !== deviceId) throw Object.assign(new Error('请先在灵光爸爸中绑定数字员工与手机'), { status: 400 });
      const runId = id('ziwei-run'); const at = now();
      db.prepare('INSERT INTO ziwei_connect_runs(id,workspace_id,employee_id,binding_id,device_id,account_id,action,command_id,status,result_json,error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(runId, ws.id, employeeId, binding.id, deviceId, binding.account_id, action, null, action === 'dry-run' ? 'dry_run' : 'queued', null, null, at, at);
      db.prepare('UPDATE ziwei_connect_runs SET configuration_revision=?,execution_id=? WHERE id=?').run(configurationRevision,executionId,runId);
      let row = db.prepare('SELECT * FROM ziwei_connect_runs WHERE id=?').get(runId);
      if (action === 'dry-run') {
        row = updateRun(row, { status: 'dry_run', result: { planned: true, deviceId, action: 'screenshot/health', accountId: binding.account_id } });
        notify(slug, 'ziwei_connect.run.dry_run', { runId, employeeId, deviceId, accountId: binding.account_id, status: row.status });
        return outputRun(row);
      }
      try {
        const commandPayload = await request(`/android-devices/${encodeURIComponent(deviceId)}/commands`, { method: 'POST', body: JSON.stringify({ action, args: input.args && typeof input.args === 'object' ? input.args : {} }) });
        const commandId = commandPayload.command?.id || commandPayload.id || null;
        if (!commandId) throw externalError('紫薇·互联未返回 command_id', 502, commandPayload);
        db.prepare('UPDATE ziwei_connect_runs SET command_id=?,updated_at=? WHERE id=?').run(commandId, now(), runId);
        row = db.prepare('SELECT * FROM ziwei_connect_runs WHERE id=?').get(runId);
        const statusPayload = await request(`/android-devices/${encodeURIComponent(deviceId)}/status?commandId=${encodeURIComponent(commandId)}`);
        const command = statusPayload.device?.commands?.find(item => item.id === commandId) || statusPayload.command || commandPayload.command;
        const result = { command, device: statusPayload.device || null };
        if (action === 'screenshot' && command?.status === 'succeeded') {
          const snap = await request(`/android-devices/${encodeURIComponent(deviceId)}/snapshot`);
          result.snapshot = snap.snapshot || null;
        }
        const status = commandStatus(command);
        row = updateRun(row, { status, result, error: command?.error || null });
        notify(slug, `ziwei_connect.run.${status}`, { runId, employeeId, deviceId, accountId: binding.account_id, commandId, status, error: command?.error || null, screenshotAvailable: Boolean(result.snapshot?.data) });
        return outputRun(row);
      } catch (error) {
        row=db.prepare('SELECT * FROM ziwei_connect_runs WHERE id=?').get(runId);
        const uncertain=Boolean(row.command_id) || !error.status || error.status>=500;
        if(uncertain && !row.command_id) error.message=`手机命令提交结果不确定，勿重复提交；运行记录 ${runId}，请读取手机状态核对：${error.message}`;
        row = updateRun(row, { status: uncertain?'uncertain':'failed', error: error.message });
        notify(slug, `ziwei_connect.run.${row.status}`, { runId, employeeId, deviceId, accountId: binding.account_id, commandId: row.command_id, status: row.status, error: error.message });
        error.run = outputRun(row);
        throw error;
      }
    },
    async toolCall(slug,scope,name,args={}) {
      const phoneId=scope.phoneDeviceId;const path=`/android-devices/${encodeURIComponent(phoneId)}`;
      const terminal=async(method,suffix,body={})=>{const result=await this.terminal(slug,method,suffix,body);if(result.status>=400) throw externalError(result.body.error || result.body.message || '手机工具请求失败',result.status);return result.body;};
      const syncReceipt=async device=>{
        const rows=db.prepare('SELECT * FROM ziwei_connect_runs WHERE workspace_id=? AND employee_id=? AND device_id=? AND execution_id=? AND command_id IS NOT NULL').all(workspace(slug).id,scope.employeeId,phoneId,scope.actionId);
        for(const row of rows){const command=device?.commands?.find(item=>item.id===row.command_id);if(!command)continue;const previous=parse(row.result_json,{});let snapshot=previous.snapshot || previous.device?.snapshot || null;if(row.action==='screenshot'&&command.status==='succeeded'&&!snapshot?.data) snapshot=(await terminal('GET',`${path}/snapshot`)).snapshot || null;updateRun(row,{status:commandStatus(command),result:{command,device,snapshot},error:command.error || null});}
        return device;
      };
      const detail=async()=>syncReceipt((await terminal('GET',`${path}/status${args.commandId || args.updateId ? `?${new URLSearchParams({...args.commandId?{commandId:args.commandId}:{},...args.updateId?{updateId:args.updateId}:{}})}`:''}`)).device);
      const wait=async(commandId,updateId,seconds)=>{const deadline=Date.now()+Math.min(30,seconds || 0)*1000;let device;do{device=await syncReceipt((await terminal('GET',`${path}/status?${new URLSearchParams({...commandId?{commandId}:{},...updateId?{updateId}:{}})}`)).device);const record=commandId?device?.commands?.find(row=>row.id===commandId):device?.updates?.find(row=>row.id===updateId);if(record && ['succeeded','committed','failed','cancelled','expired','uncertain','acknowledged'].includes(record.status || record.state)) break;if(Date.now()>=deadline) break;await sleep(500);}while(true);return device;};
      const action=async(action,argsValue={},seconds=0)=>{let run;try{run=await this.run(slug,{employeeId:scope.employeeId,deviceId:phoneId,action,args:argsValue},{fullToolset:true,configurationRevision:scope.configurationRevision,executionId:scope.actionId});}catch(error){if(error.run?.commandId) return{command:{id:error.run.commandId,status:error.run.status},device:{id:phoneId},runId:error.run.id,verificationError:'命令已受理但读取失败，请查询原 commandId，勿重复提交'};throw error;}let device=run.result?.device || {id:phoneId};let command=run.result?.command || {id:run.commandId,status:run.status};if(seconds && !settledCommandStatuses.has(command.status)){device=await wait(run.commandId,null,seconds);command=device?.commands?.find(row=>row.id===run.commandId)||command;}if(action==='screenshot'&&command.status==='succeeded') device={...device,snapshot:run.result?.snapshot || (await terminal('GET',`${path}/snapshot`)).snapshot};const row=db.prepare('SELECT * FROM ziwei_connect_runs WHERE id=?').get(run.id);updateRun(row,{status:commandStatus(command),result:{command,device,snapshot:device.snapshot || null},error:command.error || null});return{command,device,runId:run.id};};
      if(name==='ziwei_phone_list') return {devices:(await listExternalDevices()).filter(row=>row.id===phoneId)};
      if(name==='ziwei_phone_status') return detail();
      if(name==='ziwei_phone_receipt'){const device=await detail();const command=device?.commands?.find(row=>row.id===args.commandId);if(!command) throw externalError('未找到该手机的命令回执',404);return{deviceId:phoneId,command};}
      if(name==='ziwei_phone_action') return action(args.action,args.args || {},args.waitSeconds || 0);
      if(name==='ziwei_phone_screenshot') return action('screenshot',{},args.waitSeconds ?? 8);
      if(name==='ziwei_phone_control') return (await terminal('POST',`${path}/control`,{role:args.role})).device;
      if(name==='ziwei_phone_wait'){if(!args.commandId&&!args.updateId) throw externalError('commandId 与 updateId 至少提供一个',400);return wait(args.commandId,args.updateId,args.waitSeconds ?? 10);}
      if(name==='ziwei_enrollment_pending'||name==='ziwei_enrollment_approve'){
        const pending=await terminal('GET','/android-devices/enrollment-requests');const requests=(pending.requests || pending.enrollmentRequests || []).filter(row=>(row.deviceId || row.device_id)===phoneId);
        if(name==='ziwei_enrollment_pending') return{requests};
        if(!requests.some(row=>row.id===args.requestId)) throw externalError('入网申请不属于当前员工绑定手机，无法批准',403);
        return terminal('POST',`/android-devices/enrollment-requests/${encodeURIComponent(args.requestId)}/approve`,{});
      }
      if(name==='ziwei_phone_upgrade'){
        const before=await detail();const preflight=await action('screenshot',{},8);if(preflight.command?.status!=='succeeded'||!preflight.device?.snapshot?.data) throw externalError('升级前截图检查尚未成功，请回读原commandId',409);
        const releaseIndex=String(options.releaseIndex || process.env.ZIWEI_ANDROID_RELEASE_INDEX || 'https://qzelynth.top/downloads/android/index.json');
        const response=await fetch(releaseIndex,{redirect:'error',signal:AbortSignal.timeout(10000)});if(!response.ok) throw externalError('无法读取已发布安装包索引');const manifest=await response.json();const current=before?.nodes?.find(row=>row.role===args.targetRole)?.versionCode || 0;const release=(manifest.releases || []).find(row=>args.versionCode ? row.versionCode===args.versionCode : row.versionCode>current);const pkg=release?.packages?.[args.targetRole];
        if(!pkg || release.versionCode<=current) throw externalError('没有符合要求的已发布更新版本',409);
        const apkUrl=new URL(pkg.path || pkg.file,releaseIndex).toString();const result=await terminal('POST',`${path}/updates`,{targetRole:args.targetRole,apkUrl,sha256:pkg.sha256,signerSha256:pkg.signerSha256,versionCode:release.versionCode,preflightCommandId:preflight.command.id});
        const device=await wait(null,result.update?.id,args.waitSeconds ?? 5);return{update:device?.updates?.find(row=>row.id===result.update?.id)||result.update,release:{versionName:release.versionName,versionCode:release.versionCode,apkUrl},before:{targetRole:args.targetRole,versionCode:current}};
      }
      throw externalError('未知手机工具',400);
    },
    async refresh(slug, runId) {
      const { row } = getRun(slug, runId);
      if (!row.command_id || row.action === 'dry-run' || settledCommandStatuses.has(row.status)) return outputRun(row);
      try {
        const payload = await request(`/android-devices/${encodeURIComponent(row.device_id)}/status?commandId=${encodeURIComponent(row.command_id)}`);
        const command = payload.device?.commands?.find(item => item.id === row.command_id);
        const result = { command, device: payload.device || null };
        if (row.action === 'screenshot' && command?.status === 'succeeded') result.snapshot = (await request(`/android-devices/${encodeURIComponent(row.device_id)}/snapshot`)).snapshot || null;
        const status = commandStatus(command);
        const next = updateRun(row, { status, result, error: command?.error || null });
        return outputRun(next);
      } catch (error) {
        const next = updateRun(row, { status: 'failed', error: error.message });
        return outputRun(next);
      }
    },
    listRuns(slug, limit = 50) {
      const ws = workspace(slug); const n = Math.min(100, Math.max(1, Number(limit) || 50));
      return db.prepare('SELECT * FROM ziwei_connect_runs WHERE workspace_id=? ORDER BY created_at DESC LIMIT ?').all(ws.id, n).map(outputRun);
    },
  };
}
