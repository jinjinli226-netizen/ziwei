import crypto from 'node:crypto';
import { normalizeRuntimeProfile } from '../src/employee-runtime.mjs';

const parse = (value, fallback = {}) => { try { return JSON.parse(value) ?? fallback; } catch { return fallback; } };
const fingerprint = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : (value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])])) : value);
const fail = (message, code, status = 400) => { const error = new Error(message); error.status = status; error.code = code; throw error; };
const deviceInput = input => String(input.targetDeviceId ?? input.target_device_id ?? input.deviceId ?? input.device_id ?? '').trim();
const profileInput = input => { for (const key of ['runtimeProfile','runtime_profile','profile','hermesProfile','hermes_profile']) if (Object.hasOwn(input, key)) return input[key]; return undefined; };

export function createManagementService(repo) {
  const db = repo.db;
  const ws = slug => { const value = db.prepare('SELECT * FROM workspaces WHERE slug=?').get(slug); if (!value) fail('工作区不存在', 'WORKSPACE_NOT_FOUND', 404); return value; };
  const trustedContext = context => ({ actorRole: 'owner', ...context, userId: context?.actorUserId || null, user_id: context?.actorUserId || null, actor_user_id: context?.actorUserId || null, actor_role: context?.actorRole || 'owner', enforceEmployeeVisibility: true, enforceDeviceOwnership: true });
  const employee = (slug, id, context = {}) => {
    const item = repo.listEmployees(slug, trustedContext(context)).find(row => row.id === id);
    if (!item) fail('数字员工不存在于当前工作区', 'EMPLOYEE_NOT_FOUND', 404);
    return item;
  };
  const discovery = (slug, options = {}) => {
    const workspace = ws(slug);
    const requestedId = deviceInput(options);
    const devices = repo.listDevices(slug, { userId: options.userId }).filter(item => (!requestedId || item.id === requestedId) && (!options.deviceScope || item.id === options.deviceScope)).map(item => {
      const metadata = db.prepare('SELECT * FROM runtime_device_metadata WHERE workspace_id=? AND device_id=? ORDER BY runtime_name').all(workspace.id, item.id);
      const runtimes = metadata.map(row => {
        const deviceRuntime=item.runtimes.find(runtime=>runtime.name.toLowerCase()===row.runtime_name.toLowerCase());
        const readiness = parse(row.readiness_json);
        const issues = [];
        if (item.status !== 'online') issues.push({ code: 'DEVICE_OFFLINE', message: '目标电脑离线，请在这台电脑启动已有 ziwei_user 并等待心跳。' });
        if (row.status !== 'available' || (deviceRuntime&&deviceRuntime.detection.state!=='available')) issues.push({ code: 'CLI_UNAVAILABLE', message: deviceRuntime?.detection.reason || `${row.runtime_name} CLI 不可用，请在目标电脑安装/修复该 CLI。` });
        if (row.runtime_name.toLowerCase() !== 'hermes') {
          if (readiness.authentication === 'missing') issues.push({ code: 'AUTHENTICATION_MISSING', message: `${row.runtime_name} 缺少认证，请在目标电脑登录对应 CLI。` });
          if (readiness.provider === 'missing') issues.push({ code: 'PROVIDER_MISSING', message: `${row.runtime_name} 缺少 provider，请在目标电脑配置模型服务。` });
          if (readiness.ready === false && !issues.length) issues.push({ code: readiness.code || 'RUNTIME_NOT_READY', message: readiness.reason || '运行时尚未就绪，请检查目标电脑配置。' });
        }
        const seenAt = Date.parse(row.last_seen || '');
        const age = Number(item.heartbeat_interval_ms || 10000);
        if (!Number.isFinite(seenAt) || Date.now() - seenAt > Math.max(45000, age * 4)) issues.push({ code: 'DISCOVERY_STALE', message: 'CLI 发现证据已过期，请等待目标电脑新的运行时发现心跳。' });
        return { name: row.runtime_name, version: row.version, binary: row.binary, cli_status: deviceRuntime?.cli_status || (item.status === 'online' ? row.status : 'offline'), discovery_state:deviceRuntime?.discovery_state, detection:deviceRuntime?.detection, models: parse(row.models_json, []), profiles: parse(row.profiles_json, []), readiness, last_seen: row.last_seen, available: issues.length === 0, verified: readiness.authentication === 'configured' && readiness.provider === 'configured' && issues.length === 0, issues };
      });
      return { id: item.id, name: item.name, os: item.os, status: item.status, healthy: item.healthy, last_seen: item.last_seen, heartbeat_age_ms: item.heartbeat_age_ms, workdir: item.workdir, management_mcp: parse(item.management_mcp_json), terminal_mcp:parse(item.terminal_mcp_json), runtimes };
    });
    return { workspace: slug, source: 'device_heartbeat', discovered_at: new Date().toISOString(), devices, skills: repo.listSkills(slug).map(skill => ({ id: skill.id, name: skill.name, description: skill.description, installed: skill.installed, validation_status: skill.validation_status,version:skill.version,catalog_id:skill.catalog_id,integration:skill.integration })) };
  };
  const validateSelection = (slug, input, { requireProfile = true, allowUnknownReadiness = true, context = {} } = {}) => {
    const runtimeName = String(input.runtime || '').trim();
    if (!runtimeName) fail('必须明确 runtime，例如 Codex 或 Hermes；不会自动替换运行时。', 'RUNTIME_REQUIRED');
    const deviceId = deviceInput(input);
    if (!deviceId) fail('必须选择当前工作区的目标电脑 targetDeviceId，请先调用 ziwei_discover_environment。', 'DEVICE_REQUIRED');
    const device = discovery(slug, { deviceId, userId: context.actorUserId, deviceScope: context.deviceScope }).devices[0];
    if (!device) fail('目标设备不属于当前工作区，请重新发现并选择工作区电脑。', 'DEVICE_NOT_IN_WORKSPACE');
    if (device.status !== 'online') fail('目标设备当前离线，请在该电脑启动已有 ziwei_user 并等待心跳。', 'DEVICE_OFFLINE');
    const runtime = device.runtimes.find(row => row.name.toLowerCase() === runtimeName.toLowerCase());
    if (!runtime) fail(`目标电脑没有 ${runtimeName} CLI 的发现记录，请安装并等待心跳；不会替换为其他 runtime。`, 'RUNTIME_NOT_DISCOVERED');
    if (runtime.issues.length) fail(runtime.issues[0].message, runtime.issues[0].code);
    if (!allowUnknownReadiness && !runtime.verified) fail('目标电脑尚未上报认证/provider 就绪证据，请升级 ziwei_user 并等待心跳。', 'READINESS_UNKNOWN');
    const profile = normalizeRuntimeProfile(profileInput(input));
    if (runtime.name.toLowerCase() === 'hermes' && requireProfile) {
      if (!profile) fail('Hermes 必须明确选择独立 runtimeProfile，先创建 profile 并等待成功和发现回读；不会回退主 profile。', 'PROFILE_REQUIRED');
      const selected = runtime.profiles.find(row => row.name === profile);
      if (!selected) fail(`Hermes profile 不存在于目标电脑: ${profile}。请使用 ziwei_create_hermes_profile 并等待成功后重试。`, 'PROFILE_NOT_FOUND');
      if (selected.provider_configured === false || selected.readiness?.provider === 'missing') fail(`Hermes profile ${profile} 缺少 provider，请在目标电脑配置或创建时继承 provider。`, 'PROFILE_PROVIDER_MISSING');
      if (selected.authentication_configured === false || selected.readiness?.authentication === 'missing') fail(`Hermes profile ${profile} 缺少认证，请在目标电脑配置该 profile 的认证。`, 'PROFILE_AUTHENTICATION_MISSING');
      if (selected.readiness?.ready === false) fail(selected.readiness.reason || `Hermes profile ${profile} 尚未就绪。`, selected.readiness.code || 'PROFILE_NOT_READY');
    } else if (profile && runtime.name.toLowerCase() !== 'hermes') {
      const selected = runtime.profiles.find(row => row.name === profile);
      if (!selected) fail(`${runtime.name} 未在目标电脑发现 profile ${profile}，请创建有效运行配置；不会静默忽略。`, 'PROFILE_NOT_FOUND');
      if (selected.readiness?.ready === false) fail(selected.readiness.reason || `${runtime.name} profile ${profile} 尚未就绪。`, selected.readiness.code || 'PROFILE_NOT_READY');
    }
    // Management is a platform default prepared at connect/execute time.
    // Missing preparation must stay visible without deadlocking employee save.
    return { runtime: runtime.name, targetDeviceId: deviceId, runtimeProfile: profile, readiness: runtime.readiness };
  };
  const idempotent = (slug, kind, input, create, read) => {
    const workspace = ws(slug);
    const { idempotencyKey, idempotency_key, ...body } = input;
    const digest = fingerprint(body); const key = String(idempotencyKey ?? idempotency_key ?? digest).trim();
    if (!key || key.length > 200) fail('idempotencyKey 必须为 1–200 字符。', 'IDEMPOTENCY_KEY_INVALID');
    const existing = db.prepare('SELECT * FROM management_requests WHERE workspace_id=? AND kind=? AND request_key=?').get(workspace.id, kind, key);
    if (existing) {
      if (existing.fingerprint !== digest) fail('同一 idempotencyKey 已用于不同请求，请使用新的请求标识。', 'IDEMPOTENCY_CONFLICT', 409);
      const value = read(existing.resource_id); if (!value) fail('原请求资源已被删除，请使用新的请求标识。', 'IDEMPOTENCY_RESOURCE_GONE', 409);
      return { ...value, duplicate: true };
    }
    db.exec('SAVEPOINT management_create');
    try {
      const value = create(body);
      db.prepare('INSERT INTO management_requests(workspace_id,kind,request_key,fingerprint,resource_id,created_at) VALUES(?,?,?,?,?,?)').run(workspace.id, kind, key, digest, value.id, new Date().toISOString());
      db.exec('RELEASE management_create'); return value;
    } catch (error) { db.exec('ROLLBACK TO management_create'); db.exec('RELEASE management_create'); throw error; }
  };
  const actionVisible = (slug, item, context = {}) => {
    if (!item) return false;
    const actor = trustedContext(context);
    const payload = item.payload || {};
    if (!['owner', 'admin'].includes(actor.actorRole) && payload.userId && payload.userId !== actor.actorUserId) return false;
    const linkedEmployeeId = payload.employeeId || (payload.conversationId ? db.prepare('SELECT employee_id FROM conversations WHERE id=? AND workspace_id=?').get(payload.conversationId, ws(slug).id)?.employee_id : null);
    if (linkedEmployeeId && !repo.listEmployees(slug, actor).some(row => row.id === linkedEmployeeId)) return false;
    const deviceId = payload.deviceId || (linkedEmployeeId ? db.prepare('SELECT target_device_id FROM employees WHERE id=? AND workspace_id=?').get(linkedEmployeeId, ws(slug).id)?.target_device_id : null);
    if (context.deviceScope && deviceId && deviceId !== context.deviceScope) return false;
    if (deviceId && actor.actorUserId && !['owner', 'admin'].includes(actor.actorRole) && ws(slug).kind === 'personal' && !repo.listDevices(slug, { userId: actor.actorUserId }).some(row => row.id === deviceId)) return false;
    return true;
  };
  const tasks = (slug, filters = {}, context = {}) => {
    const visible = new Set(repo.listEmployees(slug, trustedContext(context)).map(row => row.id));
    const hidden = repo.listEmployees(slug).filter(row => !visible.has(row.id));
    return repo.listTasks(slug, filters).filter(row => !hidden.some(item => row.assignee === item.id || row.assignee === item.name) && (!row.execution || actionVisible(slug, row.execution, context)));
  };
  const task = (slug, taskId, context = {}) => {
    const item = tasks(slug, {}, context).find(row => row.id === taskId);
    if (!item) fail('任务不存在于当前工作区', 'TASK_NOT_FOUND', 404);
    return { ...item, messages: repo.getTaskMessages(taskId) };
  };
  const action = (slug, actionId, context = {}) => {
    const item = repo.getA2AAction(actionId, { workspaceSlug: slug });
    if (!actionVisible(slug, item, context)) fail('执行请求不存在于当前工作区', 'ACTION_NOT_FOUND', 404);
    return item;
  };
  const employeeStatus = (slug, employeeId, context = {}) => {
    const item = employee(slug, employeeId, context);
    const device = discovery(slug, { deviceId: item.target_device_id || '__none__', userId: context.actorUserId, deviceScope: context.deviceScope }).devices[0] || null;
    const rows = db.prepare('SELECT * FROM a2a_actions WHERE workspace_id=? ORDER BY created_at DESC,rowid DESC').all(item.workspace_id);
    const latest = item.management_mcp_enabled ? rows.find(row => {
      const payload = parse(row.payload_json);
      return payload.employeeId === employeeId && payload.managementMcp?.enabled === true && payload.managementMcp.workspace === slug && payload.runtime === item.runtime && (payload.profile || null) === (item.runtime_profile || null) && (payload.deviceId || null) === (item.target_device_id || null);
    }) : null;
    const result = parse(latest?.result_json);
    const receipt = result.managementMcp || result.result?.managementMcp || {};
    const missingReceipt = latest?.status === 'succeeded' && receipt.loaded !== true;
    return { employee_id: item.id, enabled: item.management_mcp_enabled, target_device_id: item.target_device_id, runtime: item.runtime, runtime_profile: item.runtime_profile, device, receipt: { status: !latest ? 'never_run' : (latest.status === 'failed' || latest.status === 'expired' || missingReceipt ? 'failed' : (receipt.loaded ? 'loaded' : (receipt.injected ? 'injected' : 'pending'))), loaded: receipt.loaded === true, injected: receipt.injected === true, action_id: latest?.id || null, completed_at: latest?.completed_at || null, error: latest?.error || (missingReceipt ? '员工执行已退出，但缺少实际管理 MCP 握手与加载回执，请检查本机配置后重试。' : null), tool_calls: receipt.toolCalls || receipt.tool_calls || [] } };
  };
  return {
    discovery, validateSelection, employee, tasks, task, action, employeeStatus,
    createEmployee(slug, input, context = {}) {
      return idempotent(slug, 'employee', input, body => {
        const selection = validateSelection(slug, body, { context });
        const skills = repo.listSkills(slug);
        if (Array.isArray(body.skills)) for (const skillId of body.skills) if (!skills.some(skill => skill.id === skillId || skill.name === skillId)) fail(`当前工作区没有技能 ${String(skillId)}，请先发现真实技能或导入后重试。`, 'SKILL_NOT_FOUND');
        const ownerUserId = ['owner', 'admin'].includes(trustedContext(context).actorRole) ? body.ownerUserId ?? body.owner_user_id ?? context.actorUserId : context.actorUserId;
        return repo.createEmployee(slug, { ...body, ...selection, ownerUserId, owner_user_id: ownerUserId, ...trustedContext(context) });
      }, id => employee(slug, id, context));
    },
    updateEmployee(slug, id, input, context = {}) {
      const previous = employee(slug, id, context);
      const configChanged = ['runtime', 'targetDeviceId','target_device_id','deviceId','device_id','runtimeProfile','runtime_profile','profile','hermesProfile','hermes_profile','managementMcpEnabled','management_mcp_enabled','managementMcp'].some(key => Object.hasOwn(input, key));
      const targetSpecified = ['targetDeviceId','target_device_id','deviceId','device_id'].some(key => Object.hasOwn(input, key));
      const profileSpecified = ['runtimeProfile','runtime_profile','profile','hermesProfile','hermes_profile'].some(key => Object.hasOwn(input, key));
      const merged = { ...previous, ...input, runtime: input.runtime ?? previous.runtime, targetDeviceId: targetSpecified ? deviceInput(input) : previous.target_device_id, runtimeProfile: profileSpecified ? profileInput(input) : previous.runtime_profile, managementMcpEnabled: input.managementMcpEnabled ?? input.management_mcp_enabled ?? input.managementMcp?.enabled ?? previous.management_mcp_enabled };
      if (configChanged && merged.targetDeviceId) validateSelection(slug, merged, { context });
      return repo.updateEmployee(id, input);
    },
    createTask(slug, input, context = {}) {
      return idempotent(slug, 'task', input, body => {
        const reference = body.employeeId || body.employee_id || body.assignee;
        const matching = repo.listEmployees(slug).filter(row => row.id === reference || row.name === reference);
        if (matching.some(row => !repo.listEmployees(slug, trustedContext(context)).some(visible => visible.id === row.id))) fail('员工不存在于当前身份范围内', 'EMPLOYEE_NOT_FOUND', 404);
        if (body.execute !== true && !body.runtime && !body.model) return repo.createTask(slug, { ...body, ...trustedContext(context) });
        const assignee = String(body.employeeId || body.employee_id || body.assignee || '').trim();
        const candidates = repo.listEmployees(slug, trustedContext(context)).filter(row => row.id === assignee || row.name === assignee);
        if (candidates.length !== 1) fail('执行任务必须明确指定当前工作区唯一 employeeId，请先查询员工。', 'EMPLOYEE_REQUIRED');
        const selected = candidates[0];
        if (selected.status !== 'active') fail('该员工当前不是 active，请先启用再试运行。', 'EMPLOYEE_INACTIVE');
        if (body.runtime && String(body.runtime).toLowerCase() !== selected.runtime.toLowerCase()) fail('任务 runtime 与员工配置不同；请先明确更新员工，不能静默替换运行时。', 'RUNTIME_MISMATCH');
        if (profileInput(body) && profileInput(body) !== selected.runtime_profile) fail('任务 profile 与员工配置不同；请先明确更新员工。', 'PROFILE_MISMATCH');
        const targetDeviceId = deviceInput(body) || selected.target_device_id;
        const selection = validateSelection(slug, { runtime: selected.runtime, runtimeProfile: selected.runtime_profile, targetDeviceId, managementMcpEnabled: selected.management_mcp_enabled }, { context });
        const ownLegacyDevice = Boolean(context.deviceScope && context.deviceScope === selection.targetDeviceId && context.deviceCredentialDeviceId === selection.targetDeviceId);
        return task(slug, repo.createTask(slug, { ...body, ...selection, employeeId: selected.id, assignee: selected.id, execute: true, ...trustedContext(context), enforceDeviceOwnership: !ownLegacyDevice }).id, context);
      }, id => task(slug, id, context));
    },
    createProfile(slug, input, context = {}) {
      return idempotent(slug, 'hermes-profile', input, body => {
        validateSelection(slug, { ...body, runtime: 'Hermes' }, { requireProfile: false, context });
        return repo.createHermesProfileAction(slug, { ...body, ...trustedContext(context) }, { deviceCredentialDeviceId: context.deviceCredentialDeviceId });
      }, id => action(slug, id, context));
    }
  };
}
