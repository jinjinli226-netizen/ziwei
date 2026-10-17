import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { parseDocument, parse as parseYaml } from 'yaml';
import { redactSecrets } from './redaction.mjs';
import { normalizeRuntimeProfile } from './employee-runtime.mjs';
import { prepareCreatorRuntimeHome, CREATOR_RUNTIME_ENV_KEYS } from './creator-runtime-home.mjs';
import { createCliDiscoveryContext, discoverRuntimeCli, carryRuntimeDiscoveryEnvironment, runtimeDiscoveryEnvironment } from './runtime-cli-discovery.mjs';
import { imageArtifactInstructions, readImageArtifacts, validateImageBytes, imageArtifactDeliveryBody, MAX_CONVERSATION_IMAGE_BYTES, MAX_ACTION_RESULT_JSON_BYTES } from './conversation-image-artifacts.mjs';
import { spawnSupervisedRuntime } from './runtime-process.mjs';
import { prepareHermesBotHome, BOT_RUNTIME_ENV_KEYS } from './hermes-bot-runtime.mjs';
import { normalizeBotConfig } from './hermes-bot-config.mjs';
import {hermesBotToolsets} from './hermes-mcp-config.mjs';
import {parseBotReasoningProof} from './hermes-bot-reasoning.mjs';
import {resolveHermesLauncher} from './hermes-launcher.mjs';
import {runBeforeSpawnAdmission} from './runtime-launch-evidence.mjs';
export {parseBotReasoningProof} from './hermes-bot-reasoning.mjs';
export { prepareHermesBotHome } from './hermes-bot-runtime.mjs';

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

function updateHermesTerminalServer({ profile, env, entry, profileBaseHome, hermesOverlayHome, selectedProfileHome }) {
  const normalized = normalizeRuntimeProfile(profile);
  if ((!normalized || normalized === 'default') && !hermesOverlayHome) {
    if (entry) throw new Error('Hermes 手机 MCP 需要明确的独立 profile；不能修改主 profile');
    // Do not let employees inherit an administrator's global phone service.
    let main;
    try { main = parseYaml(fs.readFileSync(path.join((selectedProfileHome || hermesHome({ baseHome: profileBaseHome || env.HERMES_HOME })), 'config.yaml'), 'utf8')); } catch {}
    if (main?.mcp_servers?.['ziwei-terminal']?.enabled !== false && main?.mcp_servers?.['ziwei-terminal']) throw new Error('Hermes 主 profile 含宿主手机 MCP；请为员工选择独立 profile，不能继承管理员入口');
    return null;
  }
  const selectedHome = hermesOverlayHome || selectedProfileHome || hermesProfileHome(normalized, { baseHome: profileBaseHome || env.HERMES_HOME });
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

export function prepareTerminalMcpLaunch({ runtime, profile, config = {}, workspace, request, auditDirectory, actionId, invocation, env = {}, profileBaseHome, hermesOverlayHome, selectedProfileHome } = {}) {
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
      const home = updateHermesTerminalServer({ profile, env: childEnv, profileBaseHome, hermesOverlayHome, selectedProfileHome });
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
    childEnv[hermesOverlayHome ? 'HERMES_MANAGED_DIR' : 'HERMES_HOME'] = updateHermesTerminalServer({ profile, env: childEnv, entry, profileBaseHome, hermesOverlayHome, selectedProfileHome });
    if (!args.includes('--toolsets')) args.push('--toolsets', 'all');
  }
  return { invocation: { ...invocation, args }, env: childEnv, receipt: { configured: true, injected: true, loaded: false, transport: 'stdio', serverName: 'ziwei-terminal', workspace, runtime, profile: profile || null, runtimeProfile: profile || null, employeeId: request.employeeId, targetDeviceId: request.deviceId, actionId, auditFile } };
}

const phoneExecutionStates = new Set(['not_started', 'succeeded', 'failed', 'uncertain', 'pending']);
const phoneDiagnostic = value => typeof value === 'string' ? redactSecrets(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, 800) : '';
const phoneReceiptMetadata = (value, prefix = '') => {
  const error = phoneDiagnostic(value?.[`${prefix}Error`] ?? value?.error);
  const executionState = value?.[`${prefix}ExecutionState`] ?? value?.executionState;
  const executingConfirmed = value?.[`${prefix}ExecutingConfirmed`] ?? value?.executingConfirmed;
  const errorCode = value?.[`${prefix}ErrorCode`] ?? value?.errorCode;
  return { ...(error ? { error } : {}), ...(phoneExecutionStates.has(executionState) ? { executionState } : {}), ...(typeof executingConfirmed === 'boolean' ? { executingConfirmed } : {}), ...(typeof errorCode === 'string' && /^[A-Z0-9_]{1,100}$/.test(errorCode) ? { errorCode } : {}) };
};
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
      return Object.keys(safeIds).length && /^[a-z_]{1,40}$/.test(value.status || '') ? [{ ...safeIds, status: value.status, ...phoneReceiptMetadata(value) }] : [];
    });
    const specificStatuses = Object.fromEntries(['commandStatus', 'updateStatus'].map(key => [key, item[key]]).filter(([, value]) => typeof value === 'string' && /^[a-z_]{1,40}$/.test(value)));
    return { toolName: item.toolName || item.tool, ok: item.ok === true, ...ids, ...(Object.keys(ids).length ? { ids } : {}), ...(/^[a-z_]{1,40}$/.test(status) ? { status } : {}), ...specificStatuses, ...Object.fromEntries(Object.entries(phoneReceiptMetadata(item, 'command')).map(([key, value]) => [`command${key[0].toUpperCase()}${key.slice(1)}`, value])), ...(phoneDiagnostic(item.error) ? { error: phoneDiagnostic(item.error) } : {}), ...(receipts.length ? { receipts } : {}) };
  });
  const loaded = events.some(item => ['initialize', 'tools/list'].includes(item.method) && item.ok === true);
  return { ...safe, loaded, status: loaded ? 'loaded' : 'not_loaded', toolCalls, tool_calls: toolCalls, ...(toolCalls.some(call => ['ziwei_phone_action', 'ziwei_phone_screenshot', 'ziwei_phone_upgrade'].includes(call.toolName)) ? { retryAllowed: false } : {}) };
}

export function terminalMcpExecutionFailure(receipt) {
  if (!receipt) return null;
  if (!receipt.loaded) return { code: 'terminal_mcp_not_loaded', error: `${receipt.runtime} 已退出但未收到手机 MCP 实际握手；恢复目标为独立 profile、工具配置及本机 MCP 连接` };
  const calls = receipt.toolCalls || receipt.tool_calls || [];
  const issued = new Map();
  const unconfirmedSubmissions = [];
  for (const call of calls) {
    const submits = ['ziwei_phone_action', 'ziwei_phone_screenshot', 'ziwei_phone_upgrade'].includes(call.toolName);
    if (submits && call.ok !== true && !call.commandId && !call.updateId && !call.ids?.commandId && !call.ids?.updateId) unconfirmedSubmissions.push({ toolName: call.toolName, ...phoneReceiptMetadata(call, 'command'), error: phoneDiagnostic(call.error) || '工具请求未成功' });
    for (const kind of ['command', 'update']) {
      const id = call[`${kind}Id`] || call.ids?.[`${kind}Id`];
      if (!id) continue;
      const key = `${kind}:${id}`;
      if (submits && !issued.has(key)) issued.set(key, { kind, id, status: null });
      const item = issued.get(key);
      if (item && call.ok === true && (call[`${kind}Status`] || call.status)) Object.assign(item, { status: call[`${kind}Status`] || call.status }, kind === 'command' ? phoneReceiptMetadata(call, 'command') : {});
    }
    if (call.ok === true) for (const original of call.receipts || []) {
      for (const kind of ['command', 'update']) {
        const item = issued.get(`${kind}:${original[`${kind}Id`]}`);
        if (item && original.status) Object.assign(item, { status: original.status }, kind === 'command' ? phoneReceiptMetadata(original) : {});
      }
    }
  }
  const failureStatuses = new Set(['failed', 'expired', 'cancelled', 'superseded', 'aborted', 'rejected', 'timed_out']);
  const incomplete = [...issued.values()].filter(item => item.status !== (item.kind === 'update' ? 'committed' : 'succeeded'));
  const unresolved = incomplete.some(item => !failureStatuses.has(item.status) || item.executionState === 'uncertain') || unconfirmedSubmissions.some(item => item.executionState !== 'not_started');
  if (incomplete.length || unconfirmedSubmissions.length) {
    // A known failure must not hide a second command whose effects are unknown.
    const phoneExecutionState = unresolved ? 'uncertain' : issued.size === incomplete.length && [...incomplete, ...unconfirmedSubmissions].every(item => item.executionState === 'not_started') ? 'not_started' : 'failed';
    const ids = { commandIds: incomplete.filter(item => item.kind === 'command').map(item => item.id), updateIds: incomplete.filter(item => item.kind === 'update').map(item => item.id) };
    const observationErrors = calls.filter(call => !call.ok && !['ziwei_phone_action', 'ziwei_phone_screenshot', 'ziwei_phone_upgrade'].includes(call.toolName)).map(call => phoneDiagnostic(call.error)).filter(Boolean);
    const detail = [...incomplete.map(item => `${item.id}: ${item.executionState === 'not_started' ? '未执行' : item.status || 'unknown'}${item.error ? `，${item.error}` : ''}`), ...unconfirmedSubmissions.map(item => `${item.toolName}: ${item.error}`), ...observationErrors.map(error => `回执观察：${error}`)].join('、');
    return { code: unresolved ? 'terminal_mcp_receipt_incomplete' : 'terminal_mcp_receipt_failed', phoneExecutionState, retryAllowed: false, nextAction: 'observe', error: `${receipt.runtime} 手机动作${phoneExecutionState === 'uncertain' ? '执行结果未确认' : phoneExecutionState === 'not_started' ? '未执行' : '执行失败'}（${detail}）；${unresolved ? '系统继续读取原回执和当前页面，不重放动作' : '已保留原回执，恢复时只补未完成步骤，不重跑整轮业务'}`, ...ids };
  }
  if (calls.length && !calls.some(item => item.ok === true)) return { code: 'terminal_mcp_tools_failed', nextAction: 'observe', error: `${receipt.runtime} 手机 MCP 已加载，但实际尝试的工具全部失败；${calls.map(item => phoneDiagnostic(item.error)).filter(Boolean).join('、') || '手机绑定、技能安装或执行授权尚未恢复'}` };
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
export function createHermesExecutionOverlay({ profile, baseHome, privateDirectory, managedDirectory, selectedProfileHome } = {}) {
  const normalized = normalizeRuntimeProfile(profile) || 'default';
  const source = selectedProfileHome || hermesProfileHome(normalized, { baseHome });
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
      try {
        fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
        // Some Windows Node builds silently leave Unicode paths behind. This
        // overlay owns only flat config/env files; never traverse a replacement
        // junction or delete an unexpected directory in the fallback.
        if (fs.existsSync(home) && !fs.lstatSync(home).isSymbolicLink() && fs.realpathSync.native(home) === path.join(fs.realpathSync.native(parent), path.basename(home))) {
          for (const entry of fs.readdirSync(home, { withFileTypes: true })) if (!entry.isDirectory() || entry.isSymbolicLink()) fs.unlinkSync(path.join(home, entry.name));
          fs.rmdirSync(home);
        }
      } catch {}
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
export function prepareManagementMcpLaunch({ runtime, profile, model = null, config = {}, workspace, apiBase, request, auditDirectory, actionId = 'runtime', invocation, env = {}, creatorInstance, creatorInstanceDirectory, selectedProfileHome } = {}) {
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
    overlay = createHermesExecutionOverlay({ profile, selectedProfileHome, baseHome: env.HERMES_HOME, managedDirectory: env.HERMES_MANAGED_DIR, privateDirectory: path.join(auditDirectory, 'hermes-overlays') });
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
    invoke: ({ prompt, model, images = [] }) => ({
      args: ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '--config', 'model_reasoning_summary="auto"', ...(model ? ['--model', model] : []), ...images.flatMap(file=>['--image',file]), '-'],
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
    invoke: ({ prompt, model, images = [] }) => images.length>1?{
      args:['--yolo','chat','--query-file','-','--format','stream-json',...(model?['--model',model]:[])],stdin:prompt,format:'json-lines',inputImages:[...images],
    }:{
      args: images.length ? ['--yolo','chat','-q',prompt,'-Q','--image',images[0],...(model ? ['--model',model] : [])] : ['-z', prompt, '--yolo', ...(model ? ['--model', model] : [])],
      stdin: null,
      format: 'text',
    },
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

function runtimeErrorText(value, depth = 0) {
  if (typeof value === 'string') return value.trim() || null;
  if (!value || typeof value !== 'object' || depth > 3) return null;
  for (const key of ['message', 'error', 'detail']) {
    const text = runtimeErrorText(value[key], depth + 1);
    if (text) return text;
  }
  return null;
}

function runtimeStreamError(value) {
  if (!value || typeof value !== 'object' || (value.type !== 'error' && !value.error)) return null;
  return runtimeErrorText(value.error) || runtimeErrorText(value.message) || (value.type === 'error' ? runtimeErrorText(value.text) : null);
}

function runtimeDiagnosticLine(value) {
  return String(value || '').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').trim();
}

function isRoutineRuntimeDiagnostic(line) {
  return /^(?:(?:↻\s*)?Resumed session(?:\s|:|$)|session_id\s*:)/i.test(line);
}

function isBootstrapOrProviderFailure(line) {
  return /^(?:Hermes(?: Bot| MCP)? bootstrap rejected\b|Hermes native (?:multi-image input rejected|MCP bootstrap is incompatible or changed)\b|Hermes Creator isolation was not confirmed\b|Profile ['"][^'"]+['"] is not connected to any AI provider\b|(?:provider error|authentication error|authorization error)\s*:)/i.test(line);
}

function isExplicitRuntimeFailure(line) {
  return /^(?:\[error\]\s*|(?:error|fatal)\s*:|(?:[\w.]+(?:Error|Exception))\s*:)/i.test(line);
}

export function formatRuntimeFailure(runtime, code, diagnostics = '', streamError = null) {
  const base = `${String(runtime || 'Runtime')} CLI exited with code ${code ?? 'unknown'}`;
  const lines = String(diagnostics || '').split(/\r?\n/).map(runtimeDiagnosticLine).filter(Boolean);
  let diagnostic = runtimeErrorText(streamError);
  if (!diagnostic) {
    for (const line of lines) {
      try { diagnostic = runtimeStreamError(JSON.parse(line)); } catch {}
      if (diagnostic) break;
    }
  }
  diagnostic ||= lines.find(isBootstrapOrProviderFailure) || lines.find(isExplicitRuntimeFailure) || lines.find(line => !isRoutineRuntimeDiagnostic(line));
  const detail = firstLine(redactSecrets(runtimeDiagnosticLine(diagnostic)));
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
  const context = cliDiscovery || createCliDiscoveryContext({ spawnSpec: runtimeDiscoverySpawnSpec, extraCandidates: windowsRuntimeCandidates, metadataVersion: metadataVersionFor });
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

export function runtimeDiscoverySpawnSpec(binary,args) {
  if(/^hermes(?:\.(?:exe|cmd))?$/i.test(path.basename(binary)) && args.length===1 && args[0]==='--version') {
    try {const selected=resolveHermesLauncher(binary);return {command:selected.interpreter,args:[...(selected.pythonArgs||[]),HERMES_MCP_BOOTSTRAP,'--version-probe',selected.launcher,...(selected.binding?['--launcher-binding',JSON.stringify(selected.binding)]:[])]};}
    catch { /* Other supported launchers retain their own native --version path. */ }
  }
  return runtimeSpawnSpec(binary,args);
}

export function hermesMcpSpawnSpec(binary, args, { env = process.env, boundProfile, inputImages = [] } = {}) {
  if(!Array.isArray(inputImages)||inputImages.length>20||inputImages.length===1)throw new Error('Hermes 多图清单必须包含 2–20 张受控图片');
  const multiImages=inputImages.length>1;
  const selected=resolveHermesLauncher(binary),interpreter=selected.interpreter;
  let binding;
  try {
    const output = execFileSync(interpreter, [...(selected.pythonArgs||[]),HERMES_MCP_BOOTSTRAP, multiImages?'--probe-images':'--probe', selected.launcher,...(selected.binding?['--launcher-binding',JSON.stringify(selected.binding)]:[])], { env, encoding: 'utf8', timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    binding = JSON.parse(output);
    if (!binding.paths?.main || !binding.paths?.mcp_startup || !binding.paths?.managed_scope || !binding.fingerprint) throw new Error();
  } catch { throw new Error('Hermes 原生入口不兼容 managed MCP discovery 或安装已变化；请更新 Hermes/ziwei_user，不会替代运行时'); }
  return { command: interpreter, modeInsertIndex:5+(selected.pythonArgs?.length||0), args: [...(selected.pythonArgs||[]),HERMES_MCP_BOOTSTRAP, '--launcher', selected.launcher, '--binding', JSON.stringify(binding), ...(boundProfile ? ['--bound-profile', JSON.stringify({home:boundProfile.home,profile:boundProfile.profile,baseHome:boundProfile.baseHome,identity:boundProfile.identity,requestedHome:boundProfile.requestedHome,protectedHomes:boundProfile.protectedHomes})] : []), ...(multiImages?['--input-images',JSON.stringify(inputImages)]:[]), '--', ...args.map(String)], nativeBinding: { binary, interpreter, entrypoint: binding.paths.main, launcherKind:selected.kind, bootstrapBound:Boolean(binding.paths.bootstrap), mode: multiImages?'effective-mcp-gate-native-images':'effective-mcp-gate' } };
}

function readPrivateJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

/** Import and validate native config in the bound interpreter; no model or MCP startup. */
export async function runBotValidationProcess(spec,{signal,onSupervision,timeoutMs=30000}={}) {
  const supervision=spawnSupervisedRuntime(spec);onSupervision?.(supervision);let output='',stderr='',overflow=false;
  supervision.child.stdout.on('data',bytes=>{output+=String(bytes);if(output.length>1024*1024){overflow=true;void supervision.stop();}});
  supervision.child.stderr.on('data',bytes=>{stderr+=String(bytes);if(stderr.length>1024*1024){overflow=true;void supervision.stop();}});
  supervision.child.on('error',()=>{});supervision.child.stdin.end();
  const stop=()=>void supervision.stop();signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();const timer=setTimeout(stop,timeoutMs);
  let processExit;try{processExit=await supervision.completionEvidence;}finally{clearTimeout(timer);signal?.removeEventListener('abort',stop);}
  if(overflow||processExit.rootExitCode!==0||processExit.rootConfirmed!==true||processExit.treeConfirmed!==true||processExit.activeProcesses!==0||processExit.failureCode)throw Object.assign(new Error('Hermes config-only process did not finish with a confirmed empty tree'),{stderr,processExit});
  return {output,stderr,processExit};
}

export async function validateHermesBotRuntimeSupervised({context,baseHome,privateDirectory,workspace,apiBase,binary,signal,onSupervision}={}) {
  const profile=context.sourceProfile || 'default',prepared=prepareHermesBotHome({context,sourceHome:hermesProfileHome(profile,{baseHome}),privateDirectory,workspace,apiBase}),overlay=createHermesExecutionOverlay({profile,baseHome,privateDirectory:path.join(privateDirectory,'overlays')});
  const env={...process.env,HERMES_HOME:overlay.sourceHome,HERMES_MANAGED_DIR:overlay.home,...prepared.env};
  try {
    const launcher=binary || discoverInstalledRuntimes().runtimes.Hermes?.binary;if(!launcher)throw new Error('目标电脑未发现 Hermes CLI');
    const spec=hermesMcpSpawnSpec(launcher,['--profile',profile],{env});spec.args.splice(spec.modeInsertIndex??5,0,'--config-only');
    const execution=await runBotValidationProcess({...spec,cwd:process.cwd(),env},{signal,onSupervision});
    const result=execution.output.trim().split(/\r?\n/).map(line=>{try{return JSON.parse(line);}catch{return null;}}).find(item=>item?.botValidation);
    if(!result?.botValidation?.valid)throw Object.assign(new Error('缺少 Hermes 原生配置验证回执'),{processExit:execution.processExit,stderr:execution.stderr});
    return {status:'succeeded',result:{...result,processExit:execution.processExit}};
  } catch(error) {
    const reasoning=String(error.stderr||'').split(/\r?\n/).map(line=>parseBotReasoningProof(line,context,{provider:prepared.provider,model:prepared.effectiveModel})).filter(Boolean).at(-1);
    if(reasoning&&reasoning.status!=='matched')return {status:'failed',code:'BOT_REASONING_UNSATISFIED',error:'原生实际推理等级与明确请求不一致；未启动模型',result:{botValidation:{valid:false,schemaVersion:1,employeeId:context.employeeId,revision:context.revision,effective:{reasoning}},externalModelCalls:0,processExit:error.processExit}};
    const rejection=String(error.stderr||'').match(/Hermes Bot bootstrap rejected before model startup: (BOT_REASONING_[A-Z_]+)/)?.[1];
    if(context.config.reasoningEffort&&rejection)return {status:'failed',code:rejection,error:'原生明确推理配置被拒绝；未启动模型',result:{botValidation:{valid:false,schemaVersion:1,employeeId:context.employeeId,revision:context.revision,effective:{reasoning:{requested:context.config.reasoningEffort,actual:null,status:'rejected',code:rejection}}},externalModelCalls:0,processExit:error.processExit}};
    return {status:'failed',code:'BOT_VALIDATION_FAILED',error:`Hermes 配置检查失败；未启动模型。${redactSecrets(String(error.stderr||error.message)).slice(0,800)}`,result:{processExit:error.processExit||null}};
  } finally {overlay.cleanup();}
}

export function validateHermesBotRuntime({context,baseHome,privateDirectory,workspace,apiBase,binary}={}) {
  const profile=context.sourceProfile || 'default';
  const prepared=prepareHermesBotHome({context,sourceHome:hermesProfileHome(profile,{baseHome}),privateDirectory,workspace,apiBase});
  const overlay=createHermesExecutionOverlay({profile,baseHome,privateDirectory:path.join(privateDirectory,'overlays')});
  const env={...process.env,HERMES_HOME:overlay.sourceHome,HERMES_MANAGED_DIR:overlay.home,...prepared.env};
  try {
    const launcher=binary || discoverInstalledRuntimes().runtimes.Hermes?.binary;
    if(!launcher)throw new Error('目标电脑未发现 Hermes CLI');
    const spec=hermesMcpSpawnSpec(launcher,['--profile',profile],{env});
    spec.args.splice(spec.modeInsertIndex??5,0,'--config-only');
    const output=execFileSync(spec.command,spec.args,{env,encoding:'utf8',timeout:30_000,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const result=output.trim().split(/\r?\n/).map(line=>{try{return JSON.parse(line);}catch{return null;}}).find(item=>item?.botValidation);
    if(!result?.botValidation?.valid)throw new Error('缺少 Hermes 原生配置验证回执');
    return {status:'succeeded',result};
  } catch(error) {
    if(error.code==='ETIMEDOUT')throw new Error('Hermes 配置检查超时；未启动模型');
    const reasoning=String(error.stderr || '').split(/\r?\n/).map(line=>parseBotReasoningProof(line,context,{provider:prepared.provider,model:prepared.effectiveModel})).filter(Boolean).at(-1);
    if(reasoning?.status!=='matched'&&reasoning)return{status:'failed',code:'BOT_REASONING_UNSATISFIED',error:'原生实际推理等级与明确请求不一致；未启动模型',result:{botValidation:{valid:false,schemaVersion:1,employeeId:context.employeeId,revision:context.revision,effective:{reasoning}},externalModelCalls:0}};
    const rejection=String(error.stderr || '').match(/Hermes Bot bootstrap rejected before model startup: (BOT_REASONING_[A-Z_]+)/)?.[1];
    if(context.config.reasoningEffort&&rejection)return{status:'failed',code:rejection,error:'原生明确推理配置被拒绝；未启动模型',result:{botValidation:{valid:false,schemaVersion:1,employeeId:context.employeeId,revision:context.revision,effective:{reasoning:{requested:context.config.reasoningEffort,actual:null,status:'rejected',code:rejection}}},externalModelCalls:0}};
    throw new Error(`Hermes 配置检查失败；未启动模型。${redactSecrets(String(error.stderr || error.message || '')).slice(0,800)}`);
  } finally {overlay.cleanup();}
}

function hasCredential(value) {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) => {
    if (/(?:access[_-]?token|refresh[_-]?token|api[_-]?key|runtime[_-]?api[_-]?key)$/i.test(key) && typeof item === 'string' && item.trim()) return true;
    return item && typeof item === 'object' && hasCredential(item);
  });
}

export function hermesProfileReadiness(profile, { baseHome = null, selectedProfileHome = null } = {}) {
  const name = normalizeRuntimeProfile(profile) || 'default';
  const selectedHome = selectedProfileHome || hermesProfileHome(name, { baseHome });
  const base = { authentication: 'missing', provider: 'missing', ready: false, source: 'profile-files' };
  if (!fs.existsSync(selectedHome)) return { ...base, code: 'profile_missing', reason: `Hermes profile 不存在: ${name}；请先在目标设备创建该 profile` };
  let config;
  try { config = parseYaml(fs.readFileSync(path.join(selectedHome, 'config.yaml'), 'utf8')) || {}; }
  catch (error) { return { ...base, code: error.code === 'ENOENT' ? 'provider_missing' : 'profile_config_invalid', reason: `Hermes profile ${name} 缺少有效 provider 配置；请在该 profile 运行 hermes setup` }; }
  const provider = String(config.model?.provider || config.provider || '').trim();
  if (!provider || ['auto', 'none'].includes(provider)) return { ...base, code: 'provider_missing', reason: `Hermes profile ${name} 未指定 provider；请在该 profile 运行 hermes setup` };
  let credentialHome=selectedHome,authMode='profile-native-store';
  const ownership=readPrivateJson(path.join(selectedHome,'ziwei-instance.json'));
  if(ownership.mode==='owned_profile'){
    try{
      const source=hermesProfileHome(ownership.templateProfile,{baseHome});
      if(ownership.profile!==name||ownership.sourceProfile!==name||!ownership.key||!ownership.employeeId||!ownership.deviceId||!ownership.provisionActionId||fs.realpathSync.native(source)!==ownership.sourceHome||fs.realpathSync.native(source)===fs.realpathSync.native(selectedHome))throw new Error();
      credentialHome=source;authMode='source-native-store';
    }catch{return{...base,code:'profile_binding_invalid',reason:'Bot 专属 Profile 的认证来源绑定不匹配'};}
  }
  const auth = readPrivateJson(path.join(credentialHome, 'auth.json'));
  const providerAuth = auth.providers?.[provider] || auth.credential_pool?.[provider];
  let dotEnv = '';
  try { dotEnv = fs.readFileSync(path.join(credentialHome, '.env'), 'utf8'); } catch {}
  const customProvider=config.providers?.[provider.replace(/^custom:/,'')];
  const explicitKeyEnv=customProvider?.key_env;
  const knownKeys = /^[A-Z][A-Z0-9_]{0,127}$/.test(explicitKeyEnv || '') ? [explicitKeyEnv] : { 'openai-codex': [], openai: ['OPENAI_API_KEY'], openrouter: ['OPENROUTER_API_KEY'], anthropic: ['ANTHROPIC_API_KEY'], google: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], deepseek: ['DEEPSEEK_API_KEY'], nous: ['NOUS_API_KEY'], custom: ['CUSTOM_API_KEY'] }[provider];
  const envCredential = (knownKeys || []).some(key => String(process.env[key] || '').trim() || new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*["']?[^\\s"'#]+`, 'm').test(dotEnv));
  const localProvider = ['ollama', 'lm-studio', 'vllm'].includes(provider);
  const authenticated = hasCredential(providerAuth) || envCredential || localProvider || hasCredential(customProvider);
  return { ...base, provider: 'configured', authentication: authenticated ? 'configured' : (knownKeys ? 'missing' : 'unknown'), ready: authenticated, providerName: provider,authMode, ...(!authenticated ? { code: knownKeys ? 'authentication_missing' : 'authentication_unknown', reason: authMode==='source-native-store'?`Hermes profile ${name} 的 provider ${provider} 尚未确认认证；请检查此 Bot 绑定的来源认证，不能回退其他配置`:`Hermes profile ${name} 的 provider ${provider} 尚未确认认证；请在该独立 profile 配置或登录 provider，不能回退主 profile` } : {}) };
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
    const owned=readPrivateJson(path.join(profileRoot,'ziwei-instance.json')).mode==='owned_profile';
    return { name, configured: true, valid: true, owned_profile:owned,initialization_source:!owned,hasSoul: fs.existsSync(path.join(profileRoot, 'SOUL.md')), provider_configured: readiness.provider === 'configured', authentication_configured: readiness.authentication === 'configured', readiness };
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
    if(value.session_id)state.sessionId=String(value.session_id);
    if(value.type==='result' && typeof value.text==='string')state.response=value.text;
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
    if (value?.type === 'error' || value?.error) {
      const error = runtimeStreamError(value);
      const detail = firstLine(redactSecrets(runtimeDiagnosticLine(error)))?.slice(0, 600);
      const terminalError = value.type === 'result' || value.type === 'turn.failed';
      if (detail && (!state.runtimeError || (terminalError && !state.runtimeErrorTerminal))) {
        state.runtimeError = detail;
        state.runtimeErrorTerminal = terminalError;
      }
      appendOutput(state, `${state.output && !state.output.endsWith('\n') ? '\n' : ''}[error] ${detail || 'runtime error'}\n`, onOutput);
    }
  } catch {
    appendOutput(state, `${state.output && !state.output.endsWith('\n') ? '\n' : ''}${line}\n`, onOutput);
  }
}

/** Execute an installed CLI using an explicit argv, with full local approval. */
export async function executeRuntime({ runtime, prompt, model = null, profile = null, cwd = process.cwd(), env = {}, attachments = [], imageArtifacts = null, codexMcpDisabledServers = [], managementMcp = null, terminalMcp = null, creatorInstance, creatorInstanceDirectory, hermesBot, botInstanceDirectory, botAuthority, beforeSpawn, executionGuard, signal, onOutput, onProgress, onStage, onActivity, onSupervision } = {}) {
  if (signal?.aborted) return Promise.resolve({ status: 'failed', code: 'cancelled', error: 'runtime execution cancelled before launch' });
  if(hermesBot)hermesBot={...hermesBot,config:normalizeBotConfig(hermesBot.config)};
  const resolvedRuntime = normalizeRuntime(runtime);
  if (!resolvedRuntime) return Promise.reject(new Error(`未知本机运行时: ${runtime || '(empty)'}`));
  const imageInputs = attachments.filter(item=>/^image\//i.test(item?.mimeType || '') || /\.(?:png|jpe?g|gif|webp)$/i.test(item?.path || ''));
  let content = String(prompt ?? '').trim();
  if (!content && imageInputs.length) content = '请查看输入图片，并根据图片内容作答。';
  if (!content) return Promise.reject(new Error('agent.execute 需要非空 prompt'));
  if (imageArtifacts) content += imageArtifactInstructions(imageArtifacts);
  let invocation;
  const controlledImages=[];
  try {
    invocation = runtimeInvocation(resolvedRuntime,{prompt:content,model,attachments});
    let total = 0;
    for (const input of imageInputs) {
      const stat = fs.lstatSync(input.path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_CONVERSATION_IMAGE_BYTES) throw new Error('输入图片必须是普通文件，且不能超过 10 MiB');
      const bytes = fs.readFileSync(input.path);
      validateImageBytes(bytes,/^image\//i.test(input.mimeType || '') ? input.mimeType : null);
      total += bytes.length;if (total > MAX_CONVERSATION_IMAGE_BYTES) throw new Error('输入图片总大小不能超过 10 MiB');
      controlledImages.push({path:path.resolve(input.path),size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
    }
  } catch (error) { return Promise.reject(error); }
  const discovered = discoverInstalledRuntimes().runtimes[resolvedRuntime];
  if (!discovered?.binary || discovered.status === 'unavailable') return Promise.reject(new Error(`${resolvedRuntime} CLI 不可用：${discovered?.detection?.reason || '未安装、不可运行或不在 PATH 中'}${discovered?.detection?.reasonCode ? ` (${discovered.detection.reasonCode})` : ''}`));
  let childEnv = { ...process.env, ...env };
  if (imageArtifacts) Object.assign(childEnv,{ZIWEI_IMAGE_OUTPUT_DIR:imageArtifacts.directory,ZIWEI_IMAGE_OUTPUT_MANIFEST:imageArtifacts.manifestPath,ZIWEI_IMAGE_OUTPUT_ACTION_ID:imageArtifacts.actionId,ZIWEI_IMAGE_OUTPUT_CONVERSATION_ID:imageArtifacts.conversationId || ''});
  if (process.platform === 'win32' && !Object.keys(env).some(key => /^path$/i.test(key))) {
    const detectedEnv = runtimeDiscoveryEnvironment(discovered);
    if (detectedEnv.PATH) {
      for (const key of Object.keys(childEnv)) if (/^path$/i.test(key)) delete childEnv[key];
      Object.assign(childEnv, detectedEnv);
    }
  }
  delete childEnv.ZIWEI_CONFIG;
  // An employee with MCP disabled must not inherit daemon management credentials.
  for (const key of [...MANAGEMENT_ENV_KEYS, ...TERMINAL_ENV_KEYS, ...LEGACY_TERMINAL_ENV_KEYS, ...CREATOR_RUNTIME_ENV_KEYS, ...BOT_RUNTIME_ENV_KEYS]) delete childEnv[key];
  delete childEnv.ZIWEI_DEVICE_TOKEN;
  delete childEnv.ZIWEI_DAEMON_DEVICE_TOKEN;
  delete childEnv.ZIWEI_EXECUTION_PROFILE_BOUND;
  const profileBaseHome = childEnv.HERMES_HOME || hermesHome();
  const profileBinding = resolvedRuntime === 'Hermes' && executionGuard ? executionGuard.select({sourceHome:hermesProfileHome(profile || 'default',{baseHome:profileBaseHome}),profile:profile || 'default',baseHome:profileBaseHome}) : null;
  const selectedProfileHome=profileBinding?.home;
  if(profileBinding) {profileBinding.verify({cwd});childEnv.HERMES_HOME=selectedProfileHome;childEnv.ZIWEI_EXECUTION_PROFILE_BOUND='1';}
  if (resolvedRuntime === 'Hermes') {
    const readiness = hermesProfileReadiness(profile || 'default', { baseHome: childEnv.HERMES_HOME, selectedProfileHome });
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
  let botReasoning=null;
  let reasoningRequests=0;
  let reasoningProvider=null;
  let reasoningRejection=null;
  let selectedModel = model || null;
  try {
    // Internal executor policy, never an A2A payload field. Apply the complete
    // host table before scoped MCP injection: a later table override would
    // erase this execution's authorized management/phone transport entries.
    if (resolvedRuntime === 'Codex' && codexMcpDisabledServers.length) {
      if (!Array.isArray(codexMcpDisabledServers) || codexMcpDisabledServers.some(name=>typeof name !== 'string' || !name || name.length > 200 || /[\u0000-\u001f\u007f]/.test(name))) throw new Error('Codex MCP 禁用名单必须是安全的服务名数组');
      // Codex splits dotted override paths without parsing quoted segments.
      // Quote server keys in a TOML inline-table value instead, also supporting
      // literal names containing dots without editing native HOME config.
      const table=[...new Set(codexMcpDisabledServers)].map(name=>`${JSON.stringify(name)}={enabled=false}`).join(',');
      const flags=['--config',`mcp_servers={${table}}`];
      const index=invocation.args.lastIndexOf('-');invocation.args.splice(index<0?invocation.args.length:index,0,...flags);
    }
    let botPrepared=null;
    if(hermesBot) {
      if(resolvedRuntime!=='Hermes')throw new Error('Bot 必须使用 Hermes');
      botPrepared=prepareHermesBotHome({context:hermesBot,sourceHome:hermesProfileHome(profile || 'default',{baseHome:profileBaseHome}),privateDirectory:botInstanceDirectory,workspace:managementMcp?.workspace,apiBase:managementMcp?.apiBase});
      reasoningProvider=botPrepared.provider;
      invocation={args:['chat','--query-file','-','-c','Ziwei '+String(hermesBot.conversationId || 'Bot Chat'),'--create-if-missing','--format','stream-json','--model',botPrepared.effectiveModel,'--provider',botPrepared.provider,'--max-turns',String(hermesBot.config.maxTurns),'--run-budget',String(botPrepared.config.agent.run_budget_seconds),...(imageInputs.length===1?['--image',imageInputs[0].path]:[])],stdin:content,format:'json-lines'};
    }
    const launch = hermesBot && (hermesBot.config.permissions.mode==='read_only'||hermesBot.config.permissions.management===false) ? {invocation,env:childEnv,receipt:null} : prepareManagementMcpLaunch({ runtime: resolvedRuntime, profile, model, invocation, env: childEnv, ...(managementMcp || {}), creatorInstance, creatorInstanceDirectory, selectedProfileHome });
    invocation = launch.invocation; childEnv = launch.env; receipt = launch.receipt;
    creatorPrepared = launch.creatorPrepared;
    selectedModel = launch.effectiveModel || selectedModel;
    if(botPrepared) {
      if(!launch.overlayHome) {
        const overlay=createHermesExecutionOverlay({profile,baseHome:profileBaseHome,privateDirectory:path.join(botInstanceDirectory,'overlays')});
        childEnv.HERMES_HOME=overlay.sourceHome;childEnv.HERMES_MANAGED_DIR=overlay.home;launch.cleanup=overlay.cleanup;
        launch.overlayHome=overlay.home;invocation.args.unshift('--profile',profile || 'default');
      }
      Object.assign(childEnv,botPrepared.env);creatorPrepared=botPrepared.receipt;
      if(botAuthority){if(typeof botAuthority.actionId!=='string'||typeof botAuthority.deviceToken!=='string'||!botAuthority.deviceToken)throw new Error('Bot 协作缺少受信执行凭据');Object.assign(childEnv,{ZIWEI_BOT_ACTION_ID:botAuthority.actionId,ZIWEI_BOT_DEVICE_TOKEN:botAuthority.deviceToken,ZIWEI_API_BASE:managementMcp.apiBase});}
      for(let i=invocation.args.length-2;i>=0;i--)if(invocation.args[i]==='--toolsets')invocation.args.splice(i,2);
      const selected=hermesBotToolsets(hermesBot.config,{management:Boolean(receipt)});
      if(selected.length)invocation.args.push('--toolsets',selected.join(','));
      selectedModel=botPrepared.effectiveModel;
    }
    if (resolvedRuntime === 'Hermes' && creatorInstance?.templateId === 'ziwei-employee-creator' && !creatorPrepared) throw new Error('Creator Hermes 缺少可信实例工作区或管理 MCP 连接；未启动模型');
    cleanupOverlay = launch.cleanup || cleanupOverlay;
    if(profileBinding && !launch.overlayHome) {
      const overlay=createHermesExecutionOverlay({profile,baseHome:profileBaseHome,selectedProfileHome,privateDirectory:profileBinding.overlayDirectory});
      childEnv.HERMES_HOME=overlay.sourceHome;childEnv.HERMES_MANAGED_DIR=overlay.home;launch.overlayHome=overlay.home;cleanupOverlay=overlay.cleanup;
      invocation.args.unshift('--profile',profile || 'default');
    }
    if(resolvedRuntime==='Hermes'&&controlledImages.length>1&&!launch.overlayHome){
      const overlay=createHermesExecutionOverlay({profile,baseHome:profileBaseHome,selectedProfileHome,managedDirectory:childEnv.HERMES_MANAGED_DIR,privateDirectory:path.join(os.tmpdir(),'ziwei-hermes-image-overlays')});
      childEnv.HERMES_HOME=overlay.sourceHome;childEnv.HERMES_MANAGED_DIR=overlay.home;launch.overlayHome=overlay.home;cleanupOverlay=overlay.cleanup;
      invocation.args.unshift('--profile',profile || 'default');
    }
    const phoneLaunch = prepareTerminalMcpLaunch({ runtime: resolvedRuntime, profile, invocation, env: childEnv, profileBaseHome, hermesOverlayHome: launch.overlayHome, ...(terminalMcp || {}), selectedProfileHome });
    invocation = phoneLaunch.invocation; childEnv = phoneLaunch.env; phoneReceipt = phoneLaunch.receipt;
    if(hermesBot&&phoneReceipt){const index=invocation.args.indexOf('--toolsets');if(index<0)invocation.args.push('--toolsets','ziwei-terminal');else invocation.args[index+1]+=',ziwei-terminal';}
    if (resolvedRuntime === 'Hermes' && !receipt && !phoneReceipt && !hermesBot) childEnv.HERMES_HOME = selectedProfileHome || hermesProfileHome(profile || 'default', { baseHome: profileBaseHome });
  } catch (error) { cleanupOverlay(); return Promise.reject(error); }
  let spec;
  try { spec = resolvedRuntime === 'Hermes' && childEnv.HERMES_MANAGED_DIR && (receipt || hermesBot || profileBinding || controlledImages.length>1) ? hermesMcpSpawnSpec(discovered.binary, invocation.args, { env: childEnv, boundProfile:profileBinding, inputImages:controlledImages.length>1?controlledImages:[] }) : runtimeSpawnSpec(discovered.binary, invocation.args); }
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
  const emitOutput = chunk => { if (!signal?.aborted) onOutput?.(chunk); };
  const emitStage = stage => { if (!signal?.aborted) onStage?.(stage); };
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
          if (Object.keys(value).length === Object.keys(creatorPrepared).length && Object.entries(creatorPrepared).every(([key, item]) => typeof item==='object'?JSON.stringify(value[key])===JSON.stringify(item):value[key] === item)) creatorIsolation = creatorPrepared;
        } catch {}
      } else if(hermesBot&&line.startsWith('ZIWEI_BOT_REASONING:')){
        const proof=parseBotReasoningProof(line,hermesBot,{provider:reasoningProvider,model:selectedModel});
        if(proof){botReasoning=proof;if(proof.phase==='request')reasoningRequests++;}
      } else if(hermesBot?.config.reasoningEffort&&/^Hermes Bot bootstrap rejected before model startup: BOT_REASONING_[A-Z_]+$/.test(line)){
        reasoningRejection=line.split(': ').at(-1);
      } else consume(`${line}\n`);
    }
  };
  const consume = chunk => {
    if (invocation.format !== 'json-lines') { appendOutput(state, chunk, emitOutput); return; }
    state.lineBuffer += String(chunk || '');
    const lines = state.lineBuffer.split(/\r?\n/);
    state.lineBuffer = lines.pop() || '';
    for (const line of lines) parseRuntimeStreamLine(line, state, emitOutput, emitStage);
  };
  if(beforeSpawn) {try{await runBeforeSpawnAdmission(beforeSpawn);}catch(error){cleanupOverlay();throw error;}}
  return new Promise((resolve, reject) => {
    let supervision;
    try { profileBinding?.verify({env:childEnv,cwd}); supervision = spawnSupervisedRuntime({ command: spec.command, args: spec.args, cwd: path.resolve(String(cwd || process.cwd())), env: childEnv }); }
    catch (error) { cleanupOverlay(); reject(error); return; }
    const { child } = supervision;
    let settled = false;
    let launchError = null;
    const finish = (result, error = null) => {
      if (settled) return;
      settled = true;
      cleanupOverlay();
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(result);
    };
    const abort = () => { void supervision.stop(); };
    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }
    child.stdout?.on('data', chunk => {
      if (!signal?.aborted) onActivity?.({ runtime: resolvedRuntime, stream: 'stdout', bytes: Buffer.byteLength(chunk) });
      consume(chunk);
      if (!signal?.aborted) onProgress?.({ runtime: resolvedRuntime, bytes: state.bytes, truncated: state.truncated });
    });
    child.stderr?.on('data', chunk => {
      // stderr contains diagnostics and is deliberately streamed to the same
      // redacted event channel without writing it to the daemon log.
      if (!signal?.aborted) onActivity?.({ runtime: resolvedRuntime, stream: 'stderr', bytes: Buffer.byteLength(chunk) });
      consumeDiagnostics(chunk);
    });
    child.once('error', error => { launchError = error; });
    child.once('close', async (code, childSignal) => {
      const processExit = await supervision.completionEvidence;
      if (diagnosticBuffer) consumeDiagnostics('\n');
      if (state.lineBuffer) parseRuntimeStreamLine(state.lineBuffer, state, emitOutput, emitStage);
      const exitResult = { runtime: resolvedRuntime, code, signal: childSignal, processExit, output: state.output, truncated: state.truncated };
      // A normally completed CLI may intentionally leave a user-requested
      // background service running. Cancellation requires a verified empty
      // owned tree; ordinary completion requires a verified root exit.
      const neverLaunched = processExit.launched === false && processExit.treeConfirmed;
      if (process.platform === 'win32' && !neverLaunched && (!processExit.rootConfirmed || ((signal?.aborted || processExit.cancelled) && !processExit.treeConfirmed))) return finish({ status: 'failed', code: 'EXECUTION_UNCERTAIN', executionState: 'uncertain', error: '无法确认本次 CLI 及其子进程的停止状态；工具可能已产生写入，请核实后处理，不要直接重发原消息。', result: exitResult });
      if (launchError) return finish(null, launchError);
      if (signal?.aborted) return finish({ status: 'failed', code: 'cancelled', error: 'runtime execution cancelled; completed tool writes may already exist', result: exitResult });
    const result = { runtime: resolvedRuntime, model: selectedModel, profile: profile || null, binary: discovered.binary, code, signal: childSignal, processExit, output: state.response.trim() || state.output, diagnostics: state.response.trim() ? state.output : null, truncated: state.truncated, ...(spec.nativeBinding ? { hermesBootstrap: spec.nativeBinding } : {}), ...(creatorPrepared ? { creatorIsolation: creatorIsolation || { ...creatorPrepared, enabled: false, reasonCode: 'native_isolation_unconfirmed' } } : {}), ...(receipt ? { managementMcp: managementMcpReceipt(receipt) } : {}), ...(phoneReceipt ? { terminalMcp: terminalMcpReceipt(phoneReceipt) } : {}), ...(attachments.length ? {inputAttachments:attachments} : {}) };
      const phoneFailure = terminalMcpExecutionFailure(result.terminalMcp);
      if (phoneFailure?.phoneExecutionState) {
        result.terminalMcp = { ...result.terminalMcp, executionState: phoneFailure.phoneExecutionState, failure: phoneFailure };
        // The workstation CLI has exited. Keep remote phone uncertainty in
        // the result so automation will not replay it, without quarantining
        // this healthy workstation as an unconfirmed local process.
        if (phoneFailure.phoneExecutionState === 'uncertain') result.executionState = 'uncertain';
      }
      if(hermesBot)Object.assign(result,{botIsolation:creatorIsolation,configurationRevision:hermesBot.revision,nativeSessionId:state.sessionId || null});
      if(hermesBot?.config.reasoningEffort){
        result.reasoning=botReasoning?{...botReasoning,requests:reasoningRequests}:{requested:hermesBot.config.reasoningEffort,actual:null,status:'unconfirmed',requests:0};
        if(botReasoning&&botReasoning.status!=='matched'){
          if(botReasoning.phase==='preflight'&&reasoningRequests===0)Object.assign(result,{neverStarted:true,externalModelCalls:0});
          return finish({status:'failed',code:'BOT_REASONING_UNSATISFIED',error:'原生实际推理等级未满足明确请求；禁止将降级结果当作成功',result});
        }
        if(reasoningRejection){result.reasoning.status='rejected';result.reasoning.code=reasoningRejection;return finish({status:'failed',code:reasoningRejection,error:'原生明确推理配置被拒绝',result});}
        if(code===0&&(!botReasoning||botReasoning.phase!=='request'||reasoningRequests<1))return finish({status:'failed',code:'BOT_REASONING_UNCONFIRMED',error:'缺少原生请求边界的实际推理等级回执',result});
      }
      if (code === 0 && creatorPrepared && !creatorIsolation) return finish({ status: 'failed', code: 'creator_isolation_unconfirmed', error: 'Hermes 未确认实例状态隔离；不能报告执行成功', result });
      const managementFailure = code === 0 ? managementMcpExecutionFailure(result.managementMcp) : null;
      const mcpFailure = code === 0 ? phoneFailure || managementFailure : null;
      if (mcpFailure) return finish({ status: 'failed', ...mcpFailure, ...(phoneFailure && managementFailure ? { error: `${phoneFailure.error}\n${managementFailure.error}` } : {}), result });
      if (code !== 0) return finish({ status: 'failed', code: 'runtime_failed', error: `${formatRuntimeFailure(resolvedRuntime, code, state.output, state.runtimeError)}${phoneFailure ? `\n${phoneFailure.error}` : ''}`, result });
      if (imageArtifacts) {
        try { result.outputArtifacts = readImageArtifacts(imageArtifacts); }
        catch (error) { return finish({status:'failed',code:error.code || 'image_artifact_invalid',error:error.message,result}); }
      }
      finish(imageArtifactDeliveryBody({ status: 'succeeded', result },{maxBytes:MAX_ACTION_RESULT_JSON_BYTES-64*1024}));
    });
    try { onSupervision?.(supervision); }
    catch (error) { launchError = error; abort(); }
    if (invocation.stdin !== null && invocation.stdin !== undefined) child.stdin.end(String(invocation.stdin));
    else child.stdin.end();
  });
}

export function runtimeDefinitions() { return Object.keys(DEFINITIONS).map(runtime => ({ runtime, flags: ['full_local_permission'] })); }

export function runtimeInvocation(runtime, { prompt, model = null, attachments = [] } = {}) {
  const resolvedRuntime = normalizeRuntime(runtime);
  if (!resolvedRuntime) throw new Error(`未知本机运行时: ${runtime || '(empty)'}`);
  const images = attachments.filter(item=>/^image\//i.test(item?.mimeType || '') || /\.(?:png|jpe?g|gif|webp)$/i.test(item?.path || '')).map(item=>String(item.path || ''));
  if (images.length && !['Codex','Hermes'].includes(resolvedRuntime)) throw new Error(`${resolvedRuntime} 图片输入尚未实现原生视觉通道；不能把图片路径当作视觉输入`);
  if (images.length > 20) throw new Error('每条消息最多附加 20 张图片');
  if (images.some(file=>!file)) throw new Error('图片输入缺少本机文件路径');
  return DEFINITIONS[resolvedRuntime].invoke({ prompt: String(prompt ?? ''), model: model ? String(model) : null,images });
}


