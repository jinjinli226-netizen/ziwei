import { randomUUID } from 'node:crypto';

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

/**
 * The main workspace app owns only the binding/run records. Device identity,
 * online state, commands and screenshots remain authoritative in 紫薇·互联.
 */
export function createZiweiConnect(repo, options = {}) {
  const db = repo.db;
  const apiBase = String(options.apiBase || process.env.ZIWEI_CONNECT_API_BASE || 'http://127.0.0.1:5191/api').replace(/\/$/, '');
  const apiOrigin = new URL(apiBase).origin;
  const apiHost = new URL(apiBase).hostname;
  const isLoopback = ['127.0.0.1', 'localhost', '[::1]'].includes(apiHost);
  // The local API intentionally has no admin login. A public Caddy entry does
  // require the same session/Authorization material as the terminal-console
  // MCP bridge. Keep that material in process configuration only; never persist
  // or include it in bindings, runs, notifications, or responses.
  const auth = options.auth || process.env.ZIWEI_CONNECT_AUTH || process.env.ZIWEI_CONTROL_AUTH || '';
  const cookie = options.cookie || process.env.ZIWEI_CONNECT_COOKIE || process.env.ZIWEI_CONTROL_COOKIE || '';
  const origin = options.origin || process.env.ZIWEI_CONNECT_ORIGIN || apiOrigin;
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
  const request = async (path, init = {}) => {
    if (!isLoopback && !auth && !cookie) {
      throw externalError('紫薇·互联远程控制 API 需要认证：请配置 ZIWEI_CONNECT_AUTH 或 ZIWEI_CONNECT_COOKIE；未认证远程调用已阻止', 401);
    }
    let response;
    try {
      response = await fetch(`${apiBase}${path}`, {
        ...init,
        headers: {
          accept: 'application/json', 'content-type': 'application/json',
          ...(auth ? { authorization: auth } : {}),
          ...(cookie ? { cookie, origin } : {}),
          ...(init.headers || {}),
        },
        signal: AbortSignal.timeout(Number(options.timeoutMs || 10000)),
      });
    } catch (error) {
      throw externalError(`紫薇·互联控制 API 不可达：${error?.message || String(error)}`);
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw externalError(payload.message || payload.error || `紫薇·互联控制 API 返回 ${response.status}`, response.status >= 500 ? 502 : response.status, payload);
    return payload;
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
    listBindings: bindings,
    async bind(slug, input = {}) {
      const ws = workspace(slug); const employeeId = text(input.employeeId || input.employee_id, 'employeeId'); const deviceId = text(input.deviceId || input.device_id, 'deviceId');
      employee(ws, employeeId);
      const devices = await listExternalDevices({ detailed: false });
      const device = devices.find(item => item.id === deviceId);
      if (!device) throw Object.assign(new Error('手机不在紫薇·互联设备目录中'), { status: 404 });
      const accountId = input.accountId == null || input.accountId === '' ? null : text(input.accountId, 'accountId');
      const accountLabel = input.accountLabel == null || input.accountLabel === '' ? null : text(input.accountLabel, 'accountLabel');
      const at = now(); const existing = db.prepare('SELECT id FROM ziwei_connect_bindings WHERE workspace_id=? AND employee_id=?').get(ws.id, employeeId);
      const bindingId = existing?.id || id('ziwei-binding');
      if (existing) db.prepare('UPDATE ziwei_connect_bindings SET device_id=?,account_id=?,account_label=?,updated_at=? WHERE id=?').run(deviceId, accountId, accountLabel, at, bindingId);
      else db.prepare('INSERT INTO ziwei_connect_bindings(id,workspace_id,employee_id,device_id,account_id,account_label,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(bindingId, ws.id, employeeId, deviceId, accountId, accountLabel, at, at);
      notify(slug, 'ziwei_connect.binding.updated', { bindingId, employeeId, deviceId, accountId, accountLabel });
      return bindings(slug).find(item => item.id === bindingId);
    },
    async run(slug, input = {}) {
      const ws = workspace(slug); const employeeId = text(input.employeeId || input.employee_id, 'employeeId'); employee(ws, employeeId);
      const action = text(input.action, 'action', 32).toLowerCase();
      if (!['health', 'screenshot', 'dry-run'].includes(action)) throw Object.assign(new Error('仅支持 health、screenshot、dry-run 安全只读动作'), { status: 400 });
      const binding = db.prepare('SELECT * FROM ziwei_connect_bindings WHERE workspace_id=? AND employee_id=?').get(ws.id, employeeId);
      const deviceId = text(input.deviceId || input.device_id || binding?.device_id, 'deviceId');
      if (!binding || binding.device_id !== deviceId) throw Object.assign(new Error('请先在灵光爸爸中绑定数字员工与手机'), { status: 400 });
      const runId = id('ziwei-run'); const at = now();
      db.prepare('INSERT INTO ziwei_connect_runs(id,workspace_id,employee_id,binding_id,device_id,account_id,action,command_id,status,result_json,error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(runId, ws.id, employeeId, binding.id, deviceId, binding.account_id, action, null, action === 'dry-run' ? 'dry_run' : 'queued', null, null, at, at);
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
        const status = command?.status === 'succeeded' ? 'succeeded' : (['failed', 'cancelled', 'expired', 'uncertain'].includes(command?.status) ? command.status : 'queued');
        row = updateRun(row, { status, result, error: command?.error || null });
        notify(slug, `ziwei_connect.run.${status}`, { runId, employeeId, deviceId, accountId: binding.account_id, commandId, status, error: command?.error || null, screenshotAvailable: Boolean(result.snapshot?.data) });
        return outputRun(row);
      } catch (error) {
        row = updateRun(row, { status: 'failed', error: error.message });
        notify(slug, 'ziwei_connect.run.failed', { runId, employeeId, deviceId, accountId: binding.account_id, commandId: null, status: 'failed', error: error.message });
        error.run = outputRun(row);
        throw error;
      }
    },
    async refresh(slug, runId) {
      const { row } = getRun(slug, runId);
      if (!row.command_id || row.action === 'dry-run' || ['succeeded', 'failed', 'cancelled', 'expired'].includes(row.status)) return outputRun(row);
      try {
        const payload = await request(`/android-devices/${encodeURIComponent(row.device_id)}/status?commandId=${encodeURIComponent(row.command_id)}`);
        const command = payload.device?.commands?.find(item => item.id === row.command_id);
        const result = { command, device: payload.device || null };
        if (row.action === 'screenshot' && command?.status === 'succeeded') result.snapshot = (await request(`/android-devices/${encodeURIComponent(row.device_id)}/snapshot`)).snapshot || null;
        const status = command?.status === 'succeeded' ? 'succeeded' : (['failed', 'cancelled', 'expired', 'uncertain'].includes(command?.status) ? command.status : 'queued');
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
