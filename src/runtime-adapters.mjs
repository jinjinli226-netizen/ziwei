import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { parseDocument, parse as parseYaml } from 'yaml';
import { redactSecrets } from './redaction.mjs';
import { normalizeRuntimeProfile } from './employee-runtime.mjs';
import { prepareCreatorRuntimeHome, CREATOR_RUNTIME_ENV_KEYS } from './creator-runtime-home.mjs';
import { createCliDiscoveryContext, discoverRuntimeCli, carryRuntimeDiscoveryEnvironment, runtimeDiscoveryEnvironment } from './runtime-cli-discovery.mjs';

/**
 * Native local runtime adapters used by ziwei_user.
 *
 * The bridge deliberately discovers the executables that are installed on the
 * current computer.  It never ships a pretend model catalog and never sends
 * credentials to the server.  An adapter only receives a prompt and a model
 * id; authentication remains in the user's existing CLI configuration.
 */

const WINDOWS_SHELL = process.platform === 'win32' ? 'powershell.exe' : null;
const PS_ARGS = ['-NoProfile', '-ExecutionPolicy', 'Bypass'];
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const DISCOVERY_TTL_MS = 30_000;
const WINDOWS_INTERNET_SETTINGS = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
const MANAGEMENT_ADAPTER = fileURLToPath(new URL('../scripts/ziwei-mcp.mjs', import.meta.url));
const HERMES_MCP_BOOTSTRAP = fileURLToPath(new URL('./hermes-mcp-bootstrap.py', import.meta.url));
const MANAGEMENT_ENV_KEYS = ['ZIWEI_API_BASE', 'ZIWEI_MCP_WORKSPACE', 'ZIWEI_MCP_TOKEN_FILE', 'ZIWEI_MCP_TOKEN', 'ZIWEI_MCP_AUDIT_FILE'];
const TERMINAL_ADAPTER = fileURLToPath(new URL('../scripts/ziwei-terminal-mcp.mjs', import.meta.url));
const TERMINAL_ENV_KEYS = ['ZIWEI_TERMINAL_API_BASE', 'ZIWEI_TERMINAL_WORKSPACE', 'ZIWEI_TERMINAL_TOKEN_FILE', 'ZIWEI_TERMINAL_AUDIT_FILE', 'ZIWEI_TERMINAL_EMPLOYEE_ID', 'ZIWEI_TERMINAL_DEVICE_ID'];
const LEGACY_TERMINAL_ENV_KEYS = ['ZIWEI_CONTROL_API', 'ZIWEI_CONTROL_AUTH', 'ZIWEI_CONTROL_CREDENTIALS_FILE', 'ZIWEI_CONTROL_SESSION_FILE', 'CONTROL_MCP_API_URL', 'CONTROL_MCP_AUTH'];

function trustedApiUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('手机 MCP API 地址未配置或无效'); }
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash) throw new Error('手机 MCP API 必须使用无凭据的 HTTPS 地址（隔离验收允许 loopback HTTP）');
  return url;
}

/** Exchange the paired workstation identity for one execution's phone capability. */
export async function bootstrapTerminalMcp({ request, workspace, actionId, apiBase, deviceToken, privateDirectory, signal } = {}) {
  if (request?.enabled !== true) return { config: {}, cleanup() {} };
  if (request.workspace !== workspace) throw new Error('手机 MCP 请求工作区与本机连接工作区不一致');
  if (!deviceToken) throw new Error('手机 MCP 缺少当前工作区的已配对设备凭据');
  if (!request.employeeId || !request.deviceId || !actionId) throw new Error('手机 MCP 需要明确员工、绑定手机及执行 actionId');
  if (!privateDirectory) throw new Error('手机 MCP 缺少本机私有凭据目录');
  const base = trustedApiUrl(apiBase);
  if (!['', '/'].includes(base.pathname)) throw new Error('手机 MCP bootstrap 必须使用主站根地址');
  let response;
  try {
    response = await fetch(`${base.origin}/api/workspaces/${encodeURIComponent(workspace)}/terminal-mcp/bootstrap`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-ziwei-device-token': deviceToken },
      body: JSON.stringify({ employeeId: request.employeeId, deviceId: request.deviceId, actionId }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000), redirect: 'error',
    });
  } catch { throw new Error('手机 MCP 执行授权服务无法连接；未启动手机工具'); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`手机 MCP 执行授权失败（HTTP ${response.status}）：${redactSecrets(String(body.error || '请核对技能安装、员工绑定和当前设备授权')).slice(0, 400)}`);
  const capabilityBase = trustedApiUrl(body.baseUrl);
  const expectedPath = `/terminal-mcp/v1/workspaces/${encodeURIComponent(workspace)}/employees/${encodeURIComponent(request.employeeId)}`;
  if (!body.token || body.workspace !== workspace || body.employeeId !== request.employeeId || body.deviceId !== request.deviceId || body.actionId !== actionId || capabilityBase.origin !== base.origin || capabilityBase.pathname !== expectedPath || !(Date.parse(body.expiresAt) > Date.now())) throw new Error('手机 MCP 执行授权范围、有效期或 API 地址不匹配');
  fs.mkdirSync(privateDirectory, { recursive: true, mode: 0o700 });
  const tokenFile = path.join(privateDirectory, `${randomUUID()}.json`);
  fs.writeFileSync(tokenFile, JSON.stringify({ token: body.token, workspace, employeeId: body.employeeId, deviceId: body.deviceId, actionId, expiresAt: body.expiresAt, baseUrl: capabilityBase.toString().replace(/\/$/, '') }), { mode: 0o600, flag: 'wx' });
  return { config: { enabled: true, tokenFile, baseUrl: capabilityBase.toString().replace(/\/$/, '') }, cleanup() { try { fs.rmSync(tokenFile, { force: true }); } catch {} } };
}

export function terminalMcpStatus({ config = {}, workspace = '', apiBase = '', deviceToken = '' } = {}) {
  const status = { configured: false, workspace, transport: 'stdio', serverName: 'ziwei-terminal', supportedRuntimes: ['Codex', 'Hermes'], credentialMode: 'execution-bootstrap' };
  try {
    if (config.enabled === false) throw new Error('本机手机 MCP 已明确禁用');
    if (!workspace || !deviceToken) throw new Error('手机 MCP 缺少当前工作区的已配对设备凭据');
    trustedApiUrl(apiBase);
    if (!fs.existsSync(TERMINAL_ADAPTER)) throw new Error('本机安装包缺少 scripts/ziwei-terminal-mcp.mjs；请升级 ziwei_user');
    return { ...status, configured: true };
  } catch (error) { return { ...status, reason: error.message }; }
}

function updateHermesTerminalServer({ profile, env, entry, profileBaseHome, hermesOverlayHome }) {
  const normalized = normalizeRuntimeProfile(profile);
  if ((!normalized || normalized === 'default') && !hermesOverlayHome) {
    if (entry) throw new Error('Hermes 手机 MCP 需要明确的独立 profile；不能修改主 profile');
    // Do not let employees inherit an administrator's global phone service.
    let main;
    try { main = parseYaml(fs.readFileSync(path.join(hermesHome({ baseHome: profileBaseHome || env.HERMES_HOME }), 'config.yaml'), 'utf8')); } catch {}
    if (main?.mcp_servers?.['ziwei-terminal']?.enabled !== false && main?.mcp_servers?.['ziwei-terminal']) throw new Error('Hermes 主 profile 含宿主手机 MCP；请为员工选择独立 profile，不能继承管理员入口');
    return null;
  }
  const selectedHome = hermesOverlayHome || hermesProfileHome(normalized, { baseHome: profileBaseHome || env.HERMES_HOME });
  if (!fs.existsSync(selectedHome)) throw new Error(`Hermes profile 不存在: ${normalized}`);
  const configPath = path.join(selectedHome, 'config.yaml');
  const original = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '{}';
  const document = parseDocument(original);
  const value = document.toJSON();
  if (document.errors.length || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Hermes profile ${normalized} 的 config.yaml 无效；未修改原文件`);
  if (value.mcp_servers && (typeof value.mcp_servers !== 'object' || Array.isArray(value.mcp_servers))) throw new Error('Hermes mcp_servers 必须为映射；未修改原文件');
  const existing = value.mcp_servers?.['ziwei-terminal'];
  if (entry) document.setIn(['mcp_servers', 'ziwei-terminal'], entry);
  else if (hermesOverlayHome) document.setIn(['mcp_servers', 'ziwei-terminal', 'enabled'], false);
  else if (existing?.args?.includes(TERMINAL_ADAPTER)) document.deleteIn(['mcp_servers', 'ziwei-terminal']);
  else if (existing) document.setIn(['mcp_servers', 'ziwei-terminal', 'enabled'], false);
  if (document.toString() !== original && (entry || existing || hermesOverlayHome)) {
    if (original && !hermesOverlayHome) fs.copyFileSync(configPath, `${configPath}.ziwei-backup-${Date.now()}-${randomUUID()}`);
    const temporary = `${configPath}.ziwei-${randomUUID()}.tmp`;
    fs.writeFileSync(temporary, document.toString(), { mode: 0o600 });
    fs.renameSync(temporary, configPath);
  }
  return selectedHome;
}

export function prepareTerminalMcpLaunch({ runtime, profile, config = {}, workspace, request, auditDirectory, actionId, invocation, env = {}, profileBaseHome, hermesOverlayHome } = {}) {
  const args = [...invocation.args];
  const childEnv = { ...env };
  for (const key of [...TERMINAL_ENV_KEYS, ...LEGACY_TERMINAL_ENV_KEYS]) delete childEnv[key];
  // Override the user's global Codex phone server for every employee invocation.
  if (runtime === 'Codex') {
    const index = args.lastIndexOf('-');
    args.splice(index < 0 ? args.length : index, 0, '--config', 'mcp_servers.ziwei-terminal.enabled=false');
  }
  if (request?.enabled !== true) {
    if (runtime === 'Hermes') {
      const home = updateHermesTerminalServer({ profile, env: childEnv, profileBaseHome, hermesOverlayHome });
      if (home) childEnv[hermesOverlayHome ? 'HERMES_MANAGED_DIR' : 'HERMES_HOME'] = home;
    }
    return { invocation: { ...invocation, args }, env: childEnv, receipt: null };
  }
  if (!['Codex', 'Hermes'].includes(runtime)) throw new Error(`${runtime} 尚不支持手机 MCP；请显式选择 Codex 或 Hermes`);
  if (request.workspace !== workspace) throw new Error('手机 MCP 请求工作区与本机连接工作区不一致');
  let scope;
  try { scope = JSON.parse(fs.readFileSync(config.tokenFile, 'utf8')); } catch { throw new Error('手机 MCP 缺少本次执行的私有授权文件'); }
  if (config.enabled !== true || !scope.token || scope.workspace !== workspace || scope.employeeId !== request.employeeId || scope.deviceId !== request.deviceId || scope.actionId !== actionId || !(Date.parse(scope.expiresAt) > Date.now())) throw new Error('手机 MCP 凭据未授权当前员工、手机或执行范围，或授权已过期');
  const base = trustedApiUrl(scope.baseUrl);
  if (base.toString().replace(/\/$/, '') !== config.baseUrl) throw new Error('手机 MCP 执行 API 与授权文件不一致');
  if (!fs.existsSync(TERMINAL_ADAPTER)) throw new Error('本机安装包缺少 scripts/ziwei-terminal-mcp.mjs；请升级 ziwei_user');
  if (!auditDirectory) throw new Error('手机 MCP 缺少本机私有验收目录');
  fs.mkdirSync(auditDirectory, { recursive: true, mode: 0o700 });
  const auditFile = path.join(auditDirectory, `${String(actionId).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120)}-${randomUUID()}.jsonl`);
  Object.assign(childEnv, { ZIWEI_TERMINAL_API_BASE: config.baseUrl, ZIWEI_TERMINAL_WORKSPACE: workspace, ZIWEI_TERMINAL_TOKEN_FILE: path.resolve(config.tokenFile), ZIWEI_TERMINAL_AUDIT_FILE: auditFile, ZIWEI_TERMINAL_EMPLOYEE_ID: request.employeeId, ZIWEI_TERMINAL_DEVICE_ID: request.deviceId });
  if (runtime === 'Codex') {
    // Codex merges override tables with global configuration; an empty table
    // does not remove the host's administrator credential file settings.
    const overrides = { command: process.execPath, args: [TERMINAL_ADAPTER], env_vars: TERMINAL_ENV_KEYS, enabled: true, startup_timeout_sec: 30, tool_timeout_sec: 300 };
    const flags = [...Object.entries(overrides).flatMap(([key, value]) => ['--config', `mcp_servers.ziwei-terminal.${key}=${JSON.stringify(value)}`]), ...LEGACY_TERMINAL_ENV_KEYS.flatMap(key => ['--config', `mcp_servers.ziwei-terminal.env.${key}=""`])];
    const index = args.lastIndexOf('-');
    args.splice(index < 0 ? args.length : index, 0, ...flags);
  } else {
    const entry = { command: process.execPath, args: [TERMINAL_ADAPTER], enabled: true, env: { ...Object.fromEntries(TERMINAL_ENV_KEYS.map(key => [key, hermesOverlayHome ? childEnv[key] : '${' + key + '}'])), ...Object.fromEntries(LEGACY_TERMINAL_ENV_KEYS.map(key => [key, ''])) } };
    childEnv[hermesOverlayHome ? 'HERMES_MANAGED_DIR' : 'HERMES_HOME'] = updateHermesTerminalServer({ profile, env: childEnv, entry, profileBaseHome, hermesOverlayHome });
    if (!args.includes('--toolsets')) args.push('--toolsets', 'all');
  }
  return { invocation: { ...invocation, args }, env: childEnv, receipt: { configured: true, injected: true, loaded: false, transport: 'stdio', serverName: 'ziwei-terminal', workspace, runtime, profile: profile || null, runtimeProfile: profile || null, employeeId: request.employeeId, targetDeviceId: request.deviceId, actionId, auditFile } };
}

export function terminalMcpReceipt(receipt) {
  if (!receipt) return null;
  const { auditFile, ...safe } = receipt;
  let events = [];
  try { events = fs.readFileSync(auditFile, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); } catch {}
  const toolCalls = events.filter(item => item.method === 'tools/call').map(item => {
    const ids = Object.fromEntries(['deviceId', 'commandId', 'updateId', 'requestId'].map(key => [key, item.ids?.[key] || item[key]]).filter(([, value]) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)));
    const status = String(item.status || item.commandStatus || item.state || '');
    const receipts = (Array.isArray(item.receipts) ? item.receipts : []).slice(0, 200).flatMap(value => {
      const safeIds = Object.fromEntries(['commandId', 'updateId'].map(key => [key, value?.[key]]).filter(([, id]) => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(id)));
      return Object.keys(safeIds).length && /^[a-z_]{1,40}$/.test(value.status || '') ? [{ ...safeIds, status: value.status }] : [];
    });
    const specificStatuses = Object.fromEntries(['commandStatus', 'updateStatus'].map(key => [key, item[key]]).filter(([, value]) => typeof value === 'string' && /^[a-z_]{1,40}$/.test(value)));
    return { toolName: item.toolName || item.tool, ok: item.ok === true, ...ids, ...(Object.keys(ids).length ? { ids } : {}), ...(/^[a-z_]{1,40}$/.test(status) ? { status } : {}), ...specificStatuses, ...(receipts.length ? { receipts } : {}) };
  });
  const loaded = events.some(item => ['initialize', 'tools/list'].includes(item.method) && item.ok === true);
  return { ...safe, loaded, status: loaded ? 'loaded' : 'not_loaded', toolCalls, tool_calls: toolCalls };
}

export function terminalMcpExecutionFailure(receipt) {
  if (!receipt) return null;
  if (!receipt.loaded) return { code: 'terminal_mcp_not_loaded', error: `${receipt.runtime} 已退出但未收到手机 MCP 实际握手；请检查独立 profile、工具配置和本机 MCP 日志` };
  const calls = receipt.toolCalls || receipt.tool_calls || [];
  const issued = new Map();
  for (const call of calls) {
    const submits = ['ziwei_phone_action', 'ziwei_phone_screenshot', 'ziwei_phone_upgrade'].includes(call.toolName);
    for (const kind of ['command', 'update']) {
      const id = call[`${kind}Id`] || call.ids?.[`${kind}Id`];
      if (!id) continue;
      const key = `${kind}:${id}`;
      if (submits && !issued.has(key)) issued.set(key, { kind, id, status: null });
      const item = issued.get(key);
      if (item && call.ok === true && (call[`${kind}Status`] || call.status)) item.status = call[`${kind}Status`] || call.status;
    }
    if (call.ok === true) for (const original of call.receipts || []) {
      for (const kind of ['command', 'update']) {
        const item = issued.get(`${kind}:${original[`${kind}Id`]}`);
        if (item && original.status) item.status = original.status;
      }
    }
  }
  const failed = [...issued.values()].filter(item => ['failed', 'expired', 'cancelled', 'superseded', 'aborted', 'rejected', 'timed_out'].includes(item.status));
  const incomplete = [...issued.values()].filter(item => item.status !== (item.kind === 'update' ? 'committed' : 'succeeded'));
  if (incomplete.length) {
    const items = failed.length ? failed : incomplete;
    const ids = { commandIds: items.filter(item => item.kind === 'command').map(item => item.id), updateIds: items.filter(item => item.kind === 'update').map(item => item.id) };
    return { code: failed.length ? 'terminal_mcp_receipt_failed' : 'terminal_mcp_receipt_incomplete', error: `${receipt.runtime} 手机 MCP 已下发动作，但原回执${failed.length ? '确认失败' : '尚未全部成功或升级尚未 committed'}（${items.map(item => `${item.id}: ${item.status || 'unknown'}`).join('、')}）；请查询原回执，不要重放动作`, ...ids };
  }
  if (calls.length && !calls.some(item => item.ok === true)) return { code: 'terminal_mcp_tools_failed', error: `${receipt.runtime} 手机 MCP 已加载，但实际尝试的工具全部失败；请核对手机绑定、技能安装和执行授权` };
  return null;
}

function localManagementConfiguration({ config = {}, workspace = '', apiBase = '', env = process.env } = {}) {
  if (config.enabled !== true) throw new Error('本机尚未启用紫薇管理 MCP；请配置 daemon managementMcp.enabled 和安全 tokenFile');
  if (!/^[a-z0-9][a-z0-9_-]{1,62}$/i.test(workspace)) throw new Error('管理 MCP 工作区未配置或无效');
  const tokenFile = String(config.tokenFile || env.ZIWEI_MCP_TOKEN_FILE || '').trim();
  let credentialEnv;
  if (tokenFile) {
    let credentials;
    try { credentials = JSON.parse(fs.readFileSync(tokenFile, 'utf8')); }
    catch { throw new Error('管理 MCP 凭据文件不存在、不可读取或不是 JSON；请在本机配置安全 tokenFile'); }
    const scopes = Array.isArray(credentials.workspaces) ? credentials.workspaces : [credentials.workspace];
    if (!String(credentials.token || credentials.bearerToken || '').trim()) throw new Error('管理 MCP 凭据文件没有 bearer token');
    if (!scopes.includes(workspace)) throw new Error(`管理 MCP 凭据未授权当前工作区 ${workspace}；请更新本机与服务器的工作区范围`);
    if (credentials.managed && (credentials.audience !== 'ziwei-management' || !(Date.parse(credentials.expiresAt) > Date.now()) || (config.deviceId && credentials.deviceId !== config.deviceId))) throw new Error('自动管理 MCP 凭据已过期或电脑身份不匹配；请等待 ziwei_user 自动准备');
    credentialEnv = { ZIWEI_MCP_TOKEN_FILE: path.resolve(tokenFile) };
  } else {
    if (!String(env.ZIWEI_MCP_TOKEN || '').trim() || env.ZIWEI_MCP_WORKSPACE !== workspace) throw new Error('管理 MCP 缺少当前工作区的本机凭据；请配置安全 tokenFile');
    credentialEnv = { ZIWEI_MCP_TOKEN: env.ZIWEI_MCP_TOKEN };
  }
  let base;
  try { base = new URL(config.baseUrl || apiBase || env.ZIWEI_API_BASE || ''); }
  catch { throw new Error('管理 MCP API 地址未配置或无效'); }
  if ((base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))) || base.username || base.password || base.search || base.hash || !['', '/'].includes(base.pathname)) throw new Error('管理 MCP API 必须使用无凭据的 HTTPS 根地址（本机验收允许 loopback HTTP）');
  if (!fs.existsSync(MANAGEMENT_ADAPTER)) throw new Error('本机安装包缺少 scripts/ziwei-mcp.mjs；请升级 ziwei_user');
  return { workspace, baseUrl: base.toString().replace(/\/$/, ''), credentialEnv };
}

export function managementMcpStatus(options = {}) {
  const status = { configured: false, workspace: options.workspace || null, transport: 'stdio', supportedRuntimes: ['Codex', 'Hermes'] };
  try { localManagementConfiguration(options); return { ...status, configured: true }; }
  catch (error) { return { ...status, reason: error.message }; }
}

/** Overlay only native MCP configuration; provider auth refresh and persona remain in the selected home. */
export function createHermesExecutionOverlay({ profile, baseHome, privateDirectory, managedDirectory } = {}) {
  const normalized = normalizeRuntimeProfile(profile) || 'default';
  const source = hermesProfileHome(normalized, { baseHome });
  if (!fs.existsSync(source)) throw new Error(`Hermes profile 不存在: ${normalized}；不会回退其他 profile`);
  const original = fs.existsSync(path.join(source, 'config.yaml')) ? fs.readFileSync(path.join(source, 'config.yaml'), 'utf8') : '{}';
  const sourceDocument = parseDocument(original);
  const value = sourceDocument.toJSON();
  if (sourceDocument.errors.length || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Hermes profile ${normalized} 的 config.yaml 无效；未修改原文件`);
  if (value.mcp_servers && (typeof value.mcp_servers !== 'object' || Array.isArray(value.mcp_servers))) throw new Error('Hermes mcp_servers 必须为映射；未修改原文件');
  // Hermes merges this native layer over the user's config, while auth/persona stay in HERMES_HOME.
  const policy = managedDirectory || process.env.HERMES_MANAGED_DIR || '/etc/hermes';
  const policyConfig = path.join(policy, 'config.yaml');
  const policyText = fs.existsSync(policyConfig) ? fs.readFileSync(policyConfig, 'utf8') : '{}';
  const document = parseDocument(policyText);
  const policyValue = document.toJSON();
  if (document.errors.length || !policyValue || typeof policyValue !== 'object' || Array.isArray(policyValue) || (policyValue.mcp_servers && (typeof policyValue.mcp_servers !== 'object' || Array.isArray(policyValue.mcp_servers)))) throw new Error('Hermes managed policy 配置无效；未覆盖或忽略原策略');
  const parent = path.resolve(privateDirectory);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const home = path.join(parent, `execution-${randomUUID()}`);
  fs.mkdirSync(home, { mode: 0o700 });
  const cleanup = () => {
    // Only remove the exact private child created here. Never remove the user's source home.
    if (path.dirname(path.resolve(home)) === parent && path.resolve(home) !== path.resolve(source)) {
      try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
    }
  };
  try {
    fs.writeFileSync(path.join(home, 'config.yaml'), policyText, { mode: 0o600 });
    const policyEnv = path.join(policy, '.env');
    if (fs.existsSync(policyEnv)) fs.writeFileSync(path.join(home, '.env'), fs.readFileSync(policyEnv), { mode: 0o600 });
    return { home, sourceHome: source, document, cleanup };
  } catch (error) { cleanup(); throw error; }
}

/** Configure a native stdio server without placing bearer credentials in argv or profile files. */
export function prepareManagementMcpLaunch({ runtime, profile, model = null, config = {}, workspace, apiBase, request, auditDirectory, actionId = 'runtime', invocation, env = {}, creatorInstance, creatorInstanceDirectory } = {}) {
  if (!workspace && request?.enabled !== true) return { invocation, env, receipt: null };
  if (request?.workspace && request.workspace !== workspace) throw new Error('管理 MCP 请求工作区与已配对工作区不一致');
  if (!['Codex', 'Hermes'].includes(runtime)) throw new Error(`${runtime} 尚不支持紫薇管理 MCP 启动注入；请显式选择 Codex 或 Hermes`);
  const local = localManagementConfiguration({ config, workspace, apiBase });
  if (!auditDirectory) throw new Error('管理 MCP 缺少本机私有验收目录');
  fs.mkdirSync(auditDirectory, { recursive: true, mode: 0o700 });
  const safeId = String(actionId).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
  const auditFile = path.join(auditDirectory, `${safeId}-${randomUUID()}.jsonl`);
  const childEnv = { ...env };
  for (const key of CREATOR_RUNTIME_ENV_KEYS) delete childEnv[key];
  for (const key of MANAGEMENT_ENV_KEYS) delete childEnv[key];
  Object.assign(childEnv, local.credentialEnv, { ZIWEI_API_BASE: local.baseUrl, ZIWEI_MCP_WORKSPACE: workspace, ZIWEI_MCP_AUDIT_FILE: auditFile });
  const injectedEnvKeys = ['ZIWEI_API_BASE', 'ZIWEI_MCP_WORKSPACE', ...Object.keys(local.credentialEnv), 'ZIWEI_MCP_AUDIT_FILE'];
  const args = [...invocation.args];
  let overlay = null;
  let creator = null;
  if (runtime === 'Codex') {
    const overrides = {
      command: process.execPath,
      args: [MANAGEMENT_ADAPTER],
      env_vars: injectedEnvKeys,
      enabled: true,
      startup_timeout_sec: 30,
      tool_timeout_sec: 300,
    };
    const flags = [...Object.entries(overrides).flatMap(([key, value]) => ['--config', `mcp_servers.ziwei_management.${key}=${JSON.stringify(value)}`]), ...MANAGEMENT_ENV_KEYS.filter(key => key !== 'ZIWEI_MCP_TOKEN' || !local.credentialEnv.ZIWEI_MCP_TOKEN).flatMap(key => ['--config', `mcp_servers.ziwei_management.env.${key}=${JSON.stringify(childEnv[key] || '')}`])];
    const stdinIndex = args.lastIndexOf('-');
    args.splice(stdinIndex >= 0 ? stdinIndex : args.length, 0, ...flags);
  } else {
    overlay = createHermesExecutionOverlay({ profile, baseHome: env.HERMES_HOME, managedDirectory: env.HERMES_MANAGED_DIR, privateDirectory: path.join(auditDirectory, 'hermes-overlays') });
    const document = overlay.document;
    const entry = { command: process.execPath, args: [MANAGEMENT_ADAPTER], enabled: true, env: Object.fromEntries(MANAGEMENT_ENV_KEYS.map(key => [key, key === 'ZIWEI_MCP_TOKEN' && local.credentialEnv.ZIWEI_MCP_TOKEN ? '${ZIWEI_MCP_TOKEN}' : childEnv[key] || ''])) };
    try {
      document.setIn(['mcp_servers', 'ziwei_management'], entry);
      fs.writeFileSync(path.join(overlay.home, 'config.yaml'), document.toString(), { mode: 0o600 });
    } catch (error) { overlay.cleanup(); throw error; }
    childEnv.HERMES_HOME = overlay.sourceHome;
    childEnv.HERMES_MANAGED_DIR = overlay.home;
    try {
      const modelIndex = args.indexOf('--model');
      creator = prepareCreatorRuntimeHome({ context: creatorInstance, sourceHome: overlay.sourceHome, profile: normalizeRuntimeProfile(profile) || 'default', privateDirectory: creatorInstanceDirectory, workspace, apiBase: local.baseUrl, model: model ?? (modelIndex >= 0 ? args[modelIndex + 1] : null) });
      if (creator) {
        Object.assign(childEnv, creator.env);
        if (modelIndex < 0) args.push('--model', creator.effectiveModel);
      }
    } catch (error) { overlay.cleanup(); throw error; }
    // Explicit native selection prevents sticky active_profile from changing the requested home.
    args.unshift('--profile', normalizeRuntimeProfile(profile) || 'default');
    // Hermes -z validates native MCP names; `all` includes the configured server
    // and retains the employee's other native toolsets.
    args.push('--toolsets', 'all');
  }
  return { invocation: { ...invocation, args }, env: childEnv, overlayHome: overlay?.home, creatorPrepared: creator?.receipt || null, effectiveModel: creator?.effectiveModel, cleanup: overlay?.cleanup || (() => {}), receipt: { configured: true, managed: config.managed === true, injected: true, loaded: false, transport: 'stdio', workspace, runtime, runtimeProfile: profile || 'default', auditFile } };
}

export function managementMcpReceipt(receipt) {
  if (!receipt) return null;
  const { auditFile, ...safe } = receipt;
  let events = [];
  try { events = fs.readFileSync(auditFile, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); } catch {}
  const toolCalls = events.filter(item => item.method === 'tools/call').map(item => {
    const ids = Object.fromEntries(['resourceId', 'employeeId', 'taskId', 'actionId', 'documentId'].map(key => [key, item.ids?.[key] || item[key]]).filter(([, value]) => typeof value === 'string' && /^(employee|task|action|doc)[_-][A-Za-z0-9_-]{1,100}$/.test(value)));
    return { toolName: item.toolName || item.tool, ok: item.ok === true, ...ids, ...(Object.keys(ids).length ? { ids } : {}) };
  });
  const loaded = events.some(item => ['initialize', 'tools/list'].includes(item.method) && item.ok === true);
  return { ...safe, loaded, status: loaded ? 'loaded' : 'not_loaded', toolCalls, tool_calls: toolCalls };
}

export function managementMcpExecutionFailure(receipt) {
  if (!receipt) return null;
  if (!receipt.loaded) return { code: 'management_mcp_not_loaded', error: `${receipt.runtime} 已退出但未收到管理 MCP 握手；请检查员工 profile、MCP 配置及本机 MCP 日志${receipt.runtime === 'Hermes' ? '，并更新 Hermes 至支持 HERMES_MANAGED_DIR 原生配置 overlay 的版本' : ''}` };
  const calls = receipt.toolCalls || receipt.tool_calls || [];
  if (calls.length && !calls.some(item => item.ok === true)) {
    const tools = [...new Set(calls.map(item => item.toolName).filter(Boolean))].join('、');
    return { code: 'management_mcp_tools_failed', error: `${receipt.runtime} 管理 MCP 已加载，但实际尝试的管理工具全部失败${tools ? `（${tools}）` : ''}；请查看工具返回错误，核对工作区授权、目标设备及 runtime/profile 配置后重试` };
  }
  return null;
}

const DEFINITIONS = {
  Claude: {
    aliases: ['claude', 'Claude'],
    versionArgs: ['--version'],
    invoke: ({ prompt, model }) => ({
      args: ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions', ...(model ? ['--model', model] : [])],
      stdin: null,
      format: 'json-lines',
    }),
  },
  Codex: {
    aliases: ['codex', 'Codex'],
    versionArgs: ['--version'],
    invoke: ({ prompt, model }) => ({
      args: ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '--config', 'model_reasoning_summary="auto"', ...(model ? ['--model', model] : []), '-'],
      stdin: prompt,
      format: 'json-lines',
    }),
  },
  Gemini: {
    aliases: ['gemini', 'Gemini'],
    versionArgs: ['--version'],
    invoke: ({ prompt, model }) => ({
      args: ['-p', prompt, '--output-format', 'stream-json', '--approval-mode', 'yolo', '--sandbox=false', '--skip-trust', ...(model ? ['--model', model] : [])],
      stdin: null,
      format: 'json-lines',
    }),
  },
  Hermes: {
    aliases: ['hermes', 'Hermes'],
    versionArgs: ['--version'],
    invoke: ({ prompt, model }) => ({
      args: ['-z', prompt, '--yolo', ...(model ? ['--model', model] : [])],
      stdin: null,
      format: 'text',
    }),
  },
};

let cached = { expiresAt: 0, value: null };

/**
 * Turn a Windows Internet Settings ProxyServer value into a URL that CLI
 * clients understand. ProxyServer may be either `host:port` or a semicolon
 * separated protocol map such as `http=host:port;https=host:port`.
 */
export function normalizeProxyUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || /^(?:direct|none)$/i.test(raw)) return null;
  const entries = raw.split(';').map(item => item.trim()).filter(Boolean);
  const preferred = entries.find(item => /^https?=/i.test(item)) || entries.find(item => /^socks(?:4|5)?=/i.test(item)) || entries[0];
  const candidate = String(preferred || '').replace(/^[a-z0-9_-]+=/i, '').trim();
  if (!candidate) return null;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(candidate)) return candidate;
  if (/^[^\s/:]+:\d+$/.test(candidate) || /^\[[^\]]+\]:\d+$/.test(candidate)) return `http://${candidate}`;
  return null;
}

function windowsInternetProxyUrl() {
  if (process.platform !== 'win32') return null;
  try {
    const enabled = execFileSync('reg', ['query', WINDOWS_INTERNET_SETTINGS, '/v', 'ProxyEnable'], {
      encoding: 'utf8', timeout: 1500, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
    });
    if (!/ProxyEnable\s+REG_DWORD\s+0x0*1\b/i.test(enabled) && !/ProxyEnable\s+REG_DWORD\s+1\b/i.test(enabled)) return null;
    const configured = execFileSync('reg', ['query', WINDOWS_INTERNET_SETTINGS, '/v', 'ProxyServer'], {
      encoding: 'utf8', timeout: 1500, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
    });
    const match = configured.match(/ProxyServer\s+REG_SZ\s+(.+)$/im);
    return normalizeProxyUrl(match?.[1]);
  } catch {
    return null;
  }
}

export function proxyUrlForChild(env = {}) {
  const configured = [
    env.HTTPS_PROXY, env.https_proxy, env.HTTP_PROXY, env.http_proxy,
    env.ALL_PROXY, env.all_proxy, process.env.HTTPS_PROXY, process.env.https_proxy,
    process.env.HTTP_PROXY, process.env.http_proxy, process.env.ALL_PROXY, process.env.all_proxy
  ].map(normalizeProxyUrl).find(Boolean);
  return configured || windowsInternetProxyUrl();
}

export function windowsRuntimeCandidates(name, { home = os.homedir() } = {}) {
  if (process.platform !== 'win32' || String(name || '').toLowerCase() !== 'codex') return [];
  const root = path.join(home, 'AppData', 'Local', 'OpenAI', 'Codex', 'bin');
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(root, entry.name, 'codex.exe'))
      .filter(candidate => fs.existsSync(candidate))
      .sort((left, right) => {
        try { return fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs; } catch { return 0; }
      });
  } catch {
    return [];
  }
}

function powershellQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function runtimeSpawnSpec(binary, args) {
  const normalizedArgs = Array.isArray(args) ? args.map(String) : [];
  if (process.platform === 'win32' && /\.(?:ps1|cmd|bat)$/i.test(binary)) {
    const entrypoint = path.join(path.dirname(binary), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    if (/^codex\.(?:ps1|cmd|bat)$/i.test(path.basename(binary)) && fs.existsSync(entrypoint)) return { command: process.execPath, args: [entrypoint, ...normalizedArgs] };
    const command = `& ${powershellQuote(binary)} ${normalizedArgs.map(powershellQuote).join(' ')}`.trim();
    return { command: WINDOWS_SHELL, args: [...PS_ARGS, '-Command', command] };
  }
  return { command: binary, args: normalizedArgs };
}

function discoveredModels(runtime) {
  const home = os.homedir();
  const files = {
    Claude: [path.join(home, '.claude', 'settings.json'), path.join(home, '.claude', 'settings.local.json')],
    Codex: [path.join(home, '.codex', 'config.toml'), path.join(home, '.codex', 'models_cache.json')],
    Gemini: [path.join(home, '.gemini', 'settings.json')],
    Hermes: [path.join(home, '.hermes', 'config.json'), path.join(home, '.hermes', 'settings.json')]
  }[runtime] || [];
  const models = [];
  const add = value => {
    if (Array.isArray(value)) value.forEach(add);
    else if (typeof value === 'string') { const id=value.trim(); if (id) models.push({id,label:id,source:'ziwei_user'}); }
    else if (value && typeof value === 'object') {
      const id=String(value.id || value.slug || value.model || '').trim();
      if (id) models.push({id,label:String(value.label || value.display_name || id),source:'ziwei_user'});
    }
  };
  for (const file of files) {
    try {
      if (!fs.existsSync(file) || fs.statSync(file).size > 2 * 1024 * 1024) continue;
      const raw=fs.readFileSync(file,'utf8');
      if (/\.toml$/i.test(file)) { const match=raw.match(/^\s*model\s*=\s*["']([^"']+)["']/mi); if (match) add(match[1]); continue; }
      const json=JSON.parse(raw);
      for (const key of ['model','model_id','modelId','defaultModel','default_model','models']) add(json[key]);
      if (/models_cache\.json$/i.test(file) && Array.isArray(json.models)) json.models.slice(0,100).forEach(add);
    } catch {}
  }
  const seen=new Set();
  return models.filter(item => !seen.has(item.id) && seen.add(item.id)).slice(0,100);
}
function firstLine(value) {
  return String(value || '').split(/\r?\n/).map(item => item.trim()).find(Boolean) || null;
}

export function formatRuntimeFailure(runtime, code, diagnostics = '') {
  const base = `${String(runtime || 'Runtime')} CLI exited with code ${code ?? 'unknown'}`;
  const detail = firstLine(redactSecrets(diagnostics));
  return detail ? `${base}: ${detail.slice(0, 600)}` : base;
}

function metadataVersionFor(binary) {
  if (!binary) return null;
  const normalized = String(binary).toLowerCase();
  try {
    if (normalized.includes('gemini')) {
      const packagePath = path.join(path.dirname(binary), 'node_modules', '@google', 'gemini-cli', 'package.json');
      const packagePathAlt = path.join(path.dirname(binary), 'node_modules', '@google', 'gemini-cli', 'package.json');
      for (const candidate of [packagePath, packagePathAlt]) if (fs.existsSync(candidate)) return JSON.parse(fs.readFileSync(candidate, 'utf8')).version || null;
      // npm global shims can sit one directory above node_modules.
      const root = path.dirname(binary);
      const glob = path.join(root, 'node_modules', '@google', 'gemini-cli', 'package.json');
      if (fs.existsSync(glob)) return JSON.parse(fs.readFileSync(glob, 'utf8')).version || null;
    }
    if (normalized.includes('hermes')) {
      const home = process.env.HERMES_HOME || path.join(os.homedir(), 'AppData', 'Local', 'hermes');
      const updateFile = path.join(home, '.update_check');
      if (fs.existsSync(updateFile)) return JSON.parse(fs.readFileSync(updateFile, 'utf8')).ver || null;
    }
  } catch {}
  return null;
}

export function discoverInstalledRuntimes({ force = false, cliDiscovery = null } = {}) {
  if (!cliDiscovery && !force && cached.value && cached.expiresAt > Date.now()) return cached.value;
  const context = cliDiscovery || createCliDiscoveryContext({ spawnSpec: runtimeSpawnSpec, extraCandidates: windowsRuntimeCandidates, metadataVersion: metadataVersionFor });
  const runtimes = {};
  for (const [runtime, definition] of Object.entries(DEFINITIONS)) {
    const found = discoverRuntimeCli({ runtime, ...definition }, context);
    runtimes[runtime] = carryRuntimeDiscoveryEnvironment(found, {
      runtime,
      ...found,
      readiness: runtimeReadiness(runtime),
      models: discoveredModels(runtime),
      ...(runtime === 'Hermes' ? { profiles: listHermesProfiles() } : {}),
      ...(runtime === 'Codex' ? { profiles: listCodexProfiles() } : {}),
      modelSource: found.status === 'available' ? 'cli-installed' : 'manual'
    });
  }
  const value = {
    bridge: { name: 'ziwei_user', version: process.env.ZIWEI_USER_VERSION || null, host: os.hostname(), platform: context.platform, arch: context.arch },
    runtimes,
    discoveredAt: new Date().toISOString(),
  };
  if (!cliDiscovery) cached = { value, expiresAt: Date.now() + DISCOVERY_TTL_MS };
  return value;
}

export function resetRuntimeDiscovery() { cached = { expiresAt: 0, value: null }; }

function normalizeRuntime(value) {
  const needle = String(value || '').trim().toLowerCase();
  return Object.keys(DEFINITIONS).find(runtime => runtime.toLowerCase() === needle || DEFINITIONS[runtime].aliases.some(alias => alias.toLowerCase() === needle)) || null;
}

export function hermesHome({ baseHome = null } = {}) {
  return path.resolve(String(baseHome || process.env.HERMES_HOME || (process.platform === 'win32'
    ? path.join(os.homedir(), 'AppData', 'Local', 'hermes')
    : path.join(os.homedir(), '.hermes'))));
}

export function hermesProfileHome(profile, { baseHome = null } = {}) {
  const normalized = normalizeRuntimeProfile(profile);
  if (!normalized) return null;
  const root = hermesHome({ baseHome });
  if (normalized === 'default') return root;
  const profilesRoot = path.resolve(root, 'profiles');
  const candidate = path.resolve(profilesRoot, normalized);
  const relative = path.relative(profilesRoot, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Hermes profile 路径无效');
  if (fs.existsSync(root) && fs.existsSync(candidate)) {
    const rootReal = fs.realpathSync.native(root);
    const targetReal = fs.realpathSync.native(candidate);
    const realRelative = path.relative(rootReal, targetReal);
    if (!realRelative || realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) throw new Error('Hermes profile 解析到独立 profile 根目录之外');
  }
  return candidate;
}

/** Bind the actual native launcher interpreter, never a Python discovered separately on PATH. */
export function hermesMcpSpawnSpec(binary, args, { env = process.env } = {}) {
  let interpreter;
  try {
    const header = fs.readFileSync(binary).toString('latin1').match(/#!([^\r\n]+)/)?.[1]?.trim();
    interpreter = header?.replace(/^"(.+)"$/, '$1');
    if (!interpreter || !path.isAbsolute(interpreter) || /(?:^|[\\/])env(?:\s|$)/.test(interpreter) || !fs.statSync(interpreter).isFile()) throw new Error();
  } catch { throw new Error('Hermes 原生入口未绑定可核实的绝对解释器；请更新 Hermes 安装，不会改用系统 Python'); }
  let binding;
  try {
    const output = execFileSync(interpreter, [HERMES_MCP_BOOTSTRAP, '--probe', path.resolve(binary)], { env, encoding: 'utf8', timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    binding = JSON.parse(output);
    if (!binding.paths?.main || !binding.paths?.mcp_startup || !binding.paths?.managed_scope || !binding.fingerprint) throw new Error();
  } catch { throw new Error('Hermes 原生入口不兼容 managed MCP discovery 或安装已变化；请更新 Hermes/ziwei_user，不会替代运行时'); }
  return { command: interpreter, args: [HERMES_MCP_BOOTSTRAP, '--launcher', path.resolve(binary), '--binding', JSON.stringify(binding), '--', ...args.map(String)], nativeBinding: { binary, interpreter, entrypoint: binding.paths.main, mode: 'effective-mcp-gate' } };
}

function readPrivateJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

function hasCredential(value) {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) => {
    if (/(?:access[_-]?token|refresh[_-]?token|api[_-]?key|runtime[_-]?api[_-]?key)$/i.test(key) && typeof item === 'string' && item.trim()) return true;
    return item && typeof item === 'object' && hasCredential(item);
  });
}

export function hermesProfileReadiness(profile, { baseHome = null } = {}) {
  const name = normalizeRuntimeProfile(profile) || 'default';
  const selectedHome = hermesProfileHome(name, { baseHome });
  const base = { authentication: 'missing', provider: 'missing', ready: false, source: 'profile-files' };
  if (!fs.existsSync(selectedHome)) return { ...base, code: 'profile_missing', reason: `Hermes profile 不存在: ${name}；请先在目标设备创建该 profile` };
  let config;
  try { config = parseYaml(fs.readFileSync(path.join(selectedHome, 'config.yaml'), 'utf8')) || {}; }
  catch (error) { return { ...base, code: error.code === 'ENOENT' ? 'provider_missing' : 'profile_config_invalid', reason: `Hermes profile ${name} 缺少有效 provider 配置；请在该 profile 运行 hermes setup` }; }
  const provider = String(config.model?.provider || config.provider || '').trim();
  if (!provider || ['auto', 'none'].includes(provider)) return { ...base, code: 'provider_missing', reason: `Hermes profile ${name} 未指定 provider；请在该 profile 运行 hermes setup` };
  const auth = readPrivateJson(path.join(selectedHome, 'auth.json'));
  const providerAuth = auth.providers?.[provider] || auth.credential_pool?.[provider];
  let dotEnv = '';
  try { dotEnv = fs.readFileSync(path.join(selectedHome, '.env'), 'utf8'); } catch {}
  const knownKeys = { 'openai-codex': [], openai: ['OPENAI_API_KEY'], openrouter: ['OPENROUTER_API_KEY'], anthropic: ['ANTHROPIC_API_KEY'], google: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], deepseek: ['DEEPSEEK_API_KEY'], nous: ['NOUS_API_KEY'], custom: ['CUSTOM_API_KEY'] }[provider];
  const envCredential = (knownKeys || []).some(key => String(process.env[key] || '').trim() || new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*["']?[^\\s"'#]+`, 'm').test(dotEnv));
  const localProvider = ['ollama', 'lm-studio', 'vllm'].includes(provider);
  const authenticated = hasCredential(providerAuth) || envCredential || localProvider;
  return { ...base, provider: 'configured', authentication: authenticated ? 'configured' : (knownKeys ? 'missing' : 'unknown'), ready: authenticated, providerName: provider, ...(!authenticated ? { code: knownKeys ? 'authentication_missing' : 'authentication_unknown', reason: `Hermes profile ${name} 的 provider ${provider} 尚未确认认证；请在该独立 profile 配置或登录 provider，不能回退主 profile` } : {}) };
}

export function runtimeReadiness(runtime, { codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), baseHome = null } = {}) {
  if (runtime === 'Hermes') return hermesProfileReadiness('default', { baseHome });
  if (runtime === 'Codex') {
    const configured = hasCredential(readPrivateJson(path.join(codexHome, 'auth.json'))) || Boolean(String(process.env.OPENAI_API_KEY || '').trim());
    return { authentication: configured ? 'configured' : 'missing', provider: 'configured', ready: configured, source: 'local-cli-auth', ...(!configured ? { code: 'authentication_missing', reason: 'Codex 尚未发现本机认证；请在目标设备运行 codex login 后重试' } : {}) };
  }
  return { authentication: 'unknown', provider: 'unknown', ready: false, source: 'cli-discovery', reason: `${runtime} 仅发现 CLI，尚未验证 provider 与认证` };
}

export function listCodexProfiles({ codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex') } = {}) {
  const readiness = runtimeReadiness('Codex', { codexHome });
  const profiles = [{ name: 'default', configured: true, valid: true, readiness }];
  try {
    for (const file of fs.readdirSync(codexHome)) {
      const match = file.match(/^([A-Za-z0-9][A-Za-z0-9._-]{0,63})\.config\.toml$/);
      if (match) profiles.push({ name: match[1], configured: true, valid: true, source: 'config-profile-v2', readiness });
    }
  } catch {}
  return profiles;
}

/**
 * Discover Hermes profiles from the isolated Hermes home.  Only profile names
 * and capability metadata leave the bridge; filesystem paths stay local.
 */
export function listHermesProfiles({ baseHome = null } = {}) {
  const configuredHome = String(baseHome || process.env.HERMES_HOME || (process.platform === 'win32'
    ? path.join(os.homedir(), 'AppData', 'Local', 'hermes')
    : path.join(os.homedir(), '.hermes')));
  const root = path.resolve(configuredHome);
  if (!fs.existsSync(root)) return [];
  const entryFor = (name, profileRoot) => {
    const readiness = hermesProfileReadiness(name, { baseHome: root });
    return { name, configured: true, valid: true, hasSoul: fs.existsSync(path.join(profileRoot, 'SOUL.md')), provider_configured: readiness.provider === 'configured', authentication_configured: readiness.authentication === 'configured', readiness };
  };
  const profiles = [entryFor('default', root)];
  const profilesRoot = path.join(root, 'profiles');
  try {
    for (const entry of fs.readdirSync(profilesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(entry.name)) continue;
      const profileRoot = path.join(profilesRoot, entry.name);
      profiles.push(entryFor(entry.name, profileRoot));
    }
  } catch {
    // A missing profiles directory is an empty configured profile set.
  }
  return profiles;
}

export function validateHermesProfile(profile, { baseHome = null } = {}) {
  const normalized = normalizeRuntimeProfile(profile);
  if (!normalized || normalized === 'default') return { valid: true, name: normalized || 'default', reason: null };
  const profiles = listHermesProfiles({ baseHome });
  if (!profiles.length) return { valid: false, name: normalized, reason: '本机尚未发现 Hermes profile 目录' };
  const found = profiles.find(item => item.name === normalized);
  return found
    ? { valid: true, name: normalized, reason: null }
    : { valid: false, name: normalized, reason: `Hermes profile 不存在: ${normalized}` };
}

function appendOutput(state, chunk, onOutput) {
  const text = String(chunk || '');
  if (!text) return;
  state.bytes += Buffer.byteLength(text);
  if (state.bytes <= MAX_OUTPUT_BYTES) state.output += text;
  if (state.bytes > MAX_OUTPUT_BYTES) state.truncated = true;
  if (typeof onOutput === 'function') onOutput(text);
}

function responseText(value) {
  const candidates = [
    value?.text,
    value?.content,
    value?.delta,
    value?.message?.content,
    value?.response,
    value?.result,
    value?.item?.text,
    value?.item?.content,
    value?.item?.message?.content,
    value?.item?.response,
    value?.item?.result
  ];
  return candidates.find(item => typeof item === 'string' && item.trim()) || null;
}

function runtimeStage(value) {
  const type = String(value?.item?.type || value?.type || '').toLowerCase();
  if (/reasoning|thinking/.test(type)) return { stage: 'reasoning', message: '思考摘要' };
  if (/command|shell|terminal|exec/.test(type)) return { stage: 'command', message: '运行命令' };
  if (/mcp|tool|function|browser|search|patch/.test(type)) return { stage: 'tool', message: '调用工具' };
  if (/compact|context/.test(type)) return { stage: 'context', message: '处理上下文' };
  return null;
}

function summaryText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(summaryText).filter(Boolean).join('\n');
  if (!value || typeof value !== 'object') return '';
  return [value.text, value.content, value.summary].map(summaryText).filter(Boolean).join('\n');
}

function reasoningSummary(value) {
  const item = value?.item && typeof value.item === 'object' ? value.item : value;
  const type = String(item?.type || value?.type || '').toLowerCase();
  if (!/reasoning|thinking/.test(type)) return null;
  const raw = summaryText(item?.summary) || summaryText(item?.text) || summaryText(item?.content) || summaryText(value?.summary);
  const cleaned = redactSecrets(raw).replace(/<!--\s*-->/g, '').trim().slice(0, 4000);
  return cleaned || null;
}

function commandName(value) {
  const source = String(value || '').trim();
  if (!source) return null;
  const tokens = [...source.matchAll(/"([^"\r\n]+)"|'([^'\r\n]+)'|(\S+)/g)].map(match => match[1] || match[2] || match[3]);
  if (!tokens.length) return null;
  const first = String(tokens[0]);
  if (/^(?:powershell|pwsh)(?:\.exe)?$/i.test(path.basename(first))) {
    const fileIndex = tokens.findIndex(token => /^-file$/i.test(token));
    if (fileIndex >= 0 && tokens[fileIndex + 1]) return path.basename(tokens[fileIndex + 1]).replace(/\.(?:cmd|bat|exe|ps1)$/i, '');
  }
  return path.basename(first).replace(/\.(?:cmd|bat|exe|ps1)$/i, '');
}

function runtimeStageDetail(value, stage) {
  const item = value?.item && typeof value.item === 'object' ? value.item : value;
  const type = String(value?.type || '').toLowerCase();
  const phase = /complete|finished|done|result/.test(type) ? ' · 已完成' : /error|fail/.test(type) ? ' · 失败' : ' · 执行中';
  if (stage?.stage === 'reasoning') return '公开推理摘要';
  if (stage?.stage === 'command') {
    const name = commandName(item?.command || item?.command_line || item?.executable || item?.cmd);
    return `${name ? `命令：${redactSecrets(name)}` : '本机命令'}${phase}`;
  }
  if (stage?.stage === 'tool') {
    const name = item?.name || item?.tool || item?.tool_name || item?.function?.name || item?.function_name;
    return `${name ? `工具：${redactSecrets(name)}` : '本机工具'}${phase}`;
  }
  if (stage?.stage === 'context') return '上下文窗口整理';
  return 'CLI 输出';
}

export function parseRuntimeStreamLine(line, state, onOutput = () => {}, onStage = () => {}) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return;
  try {
    const value = JSON.parse(trimmed);
    const stage = runtimeStage(value);
    if (stage) {
      const summary = reasoningSummary(value);
      onStage({...stage, detail: runtimeStageDetail(value, stage), ...(summary ? { summary } : {})});
    }
    const text = responseText(value);
    if (typeof text === 'string' && stage?.stage !== 'reasoning') {
      appendOutput(state, text, onOutput);
      const itemType = String(value?.item?.type || value?.type || '').toLowerCase();
      if (itemType === 'agent_message' || itemType === 'message' || value?.item?.role === 'assistant') {
        state.response = `${state.response || ''}${state.response ? '\n' : ''}${text}`;
      }
    }
    else if (value?.type === 'error' || value?.error) appendOutput(state, `[error] ${value.error || value.message || 'runtime error'}\n`, onOutput);
  } catch {
    appendOutput(state, `${line}\n`, onOutput);
  }
}

/** Execute an installed CLI using an explicit argv, with full local approval. */
export function executeRuntime({ runtime, prompt, model = null, profile = null, cwd = process.cwd(), env = {}, attachments = [], managementMcp = null, terminalMcp = null, creatorInstance, creatorInstanceDirectory, signal, onOutput, onProgress, onStage } = {}) {
  const resolvedRuntime = normalizeRuntime(runtime);
  if (!resolvedRuntime) return Promise.reject(new Error(`未知本机运行时: ${runtime || '(empty)'}`));
  const definition = DEFINITIONS[resolvedRuntime];
  const discovered = discoverInstalledRuntimes().runtimes[resolvedRuntime];
  if (!discovered?.binary || discovered.status === 'unavailable') return Promise.reject(new Error(`${resolvedRuntime} CLI 不可用：${discovered?.detection?.reason || '未安装、不可运行或不在 PATH 中'}${discovered?.detection?.reasonCode ? ` (${discovered.detection.reasonCode})` : ''}`));
  const content = String(prompt ?? '').trim();
  if (!content) return Promise.reject(new Error('agent.execute 需要非空 prompt'));
  let invocation = definition.invoke({ prompt: content, model: model ? String(model) : null });
  let childEnv = { ...process.env, ...env };
  if (process.platform === 'win32' && !Object.keys(env).some(key => /^path$/i.test(key))) {
    const detectedEnv = runtimeDiscoveryEnvironment(discovered);
    if (detectedEnv.PATH) {
      for (const key of Object.keys(childEnv)) if (/^path$/i.test(key)) delete childEnv[key];
      Object.assign(childEnv, detectedEnv);
    }
  }
  delete childEnv.ZIWEI_CONFIG;
  // An employee with MCP disabled must not inherit daemon management credentials.
  for (const key of [...MANAGEMENT_ENV_KEYS, ...TERMINAL_ENV_KEYS, ...LEGACY_TERMINAL_ENV_KEYS, ...CREATOR_RUNTIME_ENV_KEYS]) delete childEnv[key];
  delete childEnv.ZIWEI_DEVICE_TOKEN;
  delete childEnv.ZIWEI_DAEMON_DEVICE_TOKEN;
  const profileBaseHome = childEnv.HERMES_HOME || hermesHome();
  if (resolvedRuntime === 'Hermes') {
    const readiness = hermesProfileReadiness(profile || 'default', { baseHome: childEnv.HERMES_HOME });
    if (!readiness.ready) return Promise.reject(new Error(readiness.reason));
  } else if (resolvedRuntime === 'Codex') {
    const readiness = runtimeReadiness('Codex', { codexHome: childEnv.CODEX_HOME || path.join(os.homedir(), '.codex') });
    if (readiness.authentication === 'missing') return Promise.reject(new Error(readiness.reason));
    if (profile && profile !== 'default') {
      const normalized = normalizeRuntimeProfile(profile);
      if (!listCodexProfiles({ codexHome: childEnv.CODEX_HOME || path.join(os.homedir(), '.codex') }).some(item => item.name === normalized)) return Promise.reject(new Error(`Codex profile 不存在: ${normalized}；请在目标设备准备 ${normalized}.config.toml，不会回退默认配置`));
      invocation.args.splice(1, 0, '--profile', normalized);
    }
  } else if (profile && profile !== 'default') {
    return Promise.reject(new Error(`${resolvedRuntime} 尚未支持显式 profile；不会忽略或回退该配置`));
  }
  let receipt = null;
  let phoneReceipt = null;
  let cleanupOverlay = () => {};
  let creatorPrepared = null;
  let creatorIsolation = null;
  let selectedModel = model || null;
  try {
    const launch = prepareManagementMcpLaunch({ runtime: resolvedRuntime, profile, model, invocation, env: childEnv, ...(managementMcp || {}), creatorInstance, creatorInstanceDirectory });
    invocation = launch.invocation; childEnv = launch.env; receipt = launch.receipt;
    creatorPrepared = launch.creatorPrepared;
    selectedModel = launch.effectiveModel || selectedModel;
    if (resolvedRuntime === 'Hermes' && creatorInstance?.templateId === 'ziwei-employee-creator' && !creatorPrepared) throw new Error('Creator Hermes 缺少可信实例工作区或管理 MCP 连接；未启动模型');
    cleanupOverlay = launch.cleanup || cleanupOverlay;
    const phoneLaunch = prepareTerminalMcpLaunch({ runtime: resolvedRuntime, profile, invocation, env: childEnv, profileBaseHome, hermesOverlayHome: launch.overlayHome, ...(terminalMcp || {}) });
    invocation = phoneLaunch.invocation; childEnv = phoneLaunch.env; phoneReceipt = phoneLaunch.receipt;
    if (resolvedRuntime === 'Hermes' && !receipt && !phoneReceipt) childEnv.HERMES_HOME = hermesProfileHome(profile || 'default', { baseHome: profileBaseHome });
  } catch (error) { cleanupOverlay(); return Promise.reject(error); }
  let spec;
  try { spec = resolvedRuntime === 'Hermes' && childEnv.HERMES_MANAGED_DIR && receipt ? hermesMcpSpawnSpec(discovered.binary, invocation.args, { env: childEnv }) : runtimeSpawnSpec(discovered.binary, invocation.args); }
  catch (error) { cleanupOverlay(); return Promise.reject(error); }
  // The desktop user session may have a proxy configured in Windows Internet
  // Settings while the daemon process has no proxy variables in its service
  // environment. Propagate that proxy to each local CLI child, preserving any
  // explicit per-process proxy the caller supplied.
  const proxy = proxyUrlForChild(env);
  if (proxy) {
    for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
      if (!String(childEnv[key] || '').trim()) childEnv[key] = proxy;
    }
  }
  const state = { output: '', response: '', bytes: 0, truncated: false, lineBuffer: '' };
  let diagnosticBuffer = '';
  const consumeDiagnostics = chunk => {
    if (!creatorPrepared) { consume(chunk); return; }
    diagnosticBuffer += String(chunk || '');
    if (diagnosticBuffer.length > MAX_OUTPUT_BYTES) { consume(diagnosticBuffer.slice(0, MAX_OUTPUT_BYTES)); diagnosticBuffer = diagnosticBuffer.slice(MAX_OUTPUT_BYTES); }
    const lines = diagnosticBuffer.split(/\r?\n/); diagnosticBuffer = lines.pop() || '';
    for (const line of lines) {
      if (creatorPrepared && line.startsWith('ZIWEI_CREATOR_ISOLATION:')) {
        try {
          const value = JSON.parse(line.slice('ZIWEI_CREATOR_ISOLATION:'.length));
          if (Object.keys(value).length === Object.keys(creatorPrepared).length && Object.entries(creatorPrepared).every(([key, item]) => value[key] === item)) creatorIsolation = creatorPrepared;
        } catch {}
      } else consume(`${line}\n`);
    }
  };
  const consume = chunk => {
    if (invocation.format !== 'json-lines') { appendOutput(state, chunk, onOutput); return; }
    state.lineBuffer += String(chunk || '');
    const lines = state.lineBuffer.split(/\r?\n/);
    state.lineBuffer = lines.pop() || '';
    for (const line of lines) parseRuntimeStreamLine(line, state, onOutput, onStage);
  };
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, { cwd: path.resolve(String(cwd || process.cwd())), env: childEnv, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let settled = false;
    const finish = (result, error = null) => {
      if (settled) return;
      settled = true;
      cleanupOverlay();
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(result);
    };
    const abort = () => { try { child.kill('SIGTERM'); } catch {} };
    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }
    child.stdout?.on('data', chunk => {
      consume(chunk);
      onProgress?.({ runtime: resolvedRuntime, bytes: state.bytes, truncated: state.truncated });
    });
    child.stderr?.on('data', chunk => {
      // stderr contains diagnostics and is deliberately streamed to the same
      // redacted event channel without writing it to the daemon log.
      consumeDiagnostics(chunk);
    });
    child.once('error', error => finish(null, error));
    child.once('close', (code, childSignal) => {
      if (diagnosticBuffer) consumeDiagnostics('\n');
      if (state.lineBuffer) parseRuntimeStreamLine(state.lineBuffer, state, onOutput, onStage);
      if (signal?.aborted) return finish({ status: 'failed', code: 'cancelled', error: 'runtime execution cancelled', result: { runtime: resolvedRuntime, code, signal: childSignal, output: state.output, truncated: state.truncated } });
    const result = { runtime: resolvedRuntime, model: selectedModel, profile: profile || null, binary: discovered.binary, code, signal: childSignal, output: state.response.trim() || state.output, diagnostics: state.response.trim() ? state.output : null, truncated: state.truncated, ...(spec.nativeBinding ? { hermesBootstrap: spec.nativeBinding } : {}), ...(creatorPrepared ? { creatorIsolation: creatorIsolation || { ...creatorPrepared, enabled: false, reasonCode: 'native_isolation_unconfirmed' } } : {}), ...(receipt ? { managementMcp: managementMcpReceipt(receipt) } : {}), ...(phoneReceipt ? { terminalMcp: terminalMcpReceipt(phoneReceipt) } : {}), ...(attachments.length ? {attachments} : {}) };
      if (code === 0 && creatorPrepared && !creatorIsolation) return finish({ status: 'failed', code: 'creator_isolation_unconfirmed', error: 'Hermes 未确认 Creator 实例状态隔离；不能报告执行成功', result });
      const mcpFailure = code === 0 ? managementMcpExecutionFailure(result.managementMcp) || terminalMcpExecutionFailure(result.terminalMcp) : null;
      if (mcpFailure) return finish({ status: 'failed', ...mcpFailure, result });
      if (code !== 0) return finish({ status: 'failed', code: 'runtime_failed', error: formatRuntimeFailure(resolvedRuntime, code, state.output), result });
      finish({ status: 'succeeded', result });
    });
    if (invocation.stdin !== null && invocation.stdin !== undefined) child.stdin.end(String(invocation.stdin));
    else child.stdin.end();
  });
}

export function runtimeDefinitions() { return Object.keys(DEFINITIONS).map(runtime => ({ runtime, flags: ['full_local_permission'] })); }

export function runtimeInvocation(runtime, { prompt, model = null } = {}) {
  const resolvedRuntime = normalizeRuntime(runtime);
  if (!resolvedRuntime) throw new Error(`未知本机运行时: ${runtime || '(empty)'}`);
  return DEFINITIONS[resolvedRuntime].invoke({ prompt: String(prompt ?? ''), model: model ? String(model) : null });
}


