#!/usr/bin/env node
/** Employee-scoped phone MCP. Administrator and Android role credentials never enter this process. */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { redactSecrets } from '../src/redaction.mjs';

const protocolVersion = '2024-11-05';
const roleValues = ['agent', 'updater'];
const actionValues = ['health', 'screenshot', 'tap', 'swipe', 'text', 'global', 'launch'];

function defineTools() {
  return [
    {
      name: 'ziwei_phone_list',
      description: '读取当前工作区中当前员工明确绑定的 Android 手机、Agent/Updater 在线状态、版本和当前任务。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'ziwei_phone_status',
      description: '读取一台手机的轻量状态、健康、控制权、未完成命令和活动升级事务；不返回历史截图。',
      inputSchema: { type: 'object', required: ['deviceId'], properties: { deviceId: { type: 'string' } }, additionalProperties: false },
    },
    {
      name: 'ziwei_phone_receipt',
      description: '按 deviceId 和 commandId 查询原命令的状态、错误和回执元数据；只读，不重新下发动作，不下载历史截图。',
      inputSchema: { type: 'object', required: ['deviceId', 'commandId'], properties: { deviceId: { type: 'string' }, commandId: { type: 'string' } }, additionalProperties: false },
    },
    {
      name: 'ziwei_phone_action',
      description: '通过截图/坐标控制链路执行手机动作。支持健康检查、截图、点击、滑动、输入文字、返回/主页/多任务和打开应用。',
      inputSchema: {
        type: 'object', required: ['deviceId', 'action'],
        properties: {
          deviceId: { type: 'string' },
          action: { type: 'string', enum: actionValues },
          args: { type: 'object', description: '截图原始像素坐标。tap: {x,y,width,height}；swipe: {x1,y1,x2,y2,width,height,durationMs}；width/height 为截图原始尺寸；text: {text}；global: {key:"back"|"home"|"recents"}；launch: {packageName}；health/screenshot: {}。', additionalProperties: true },
          waitSeconds: { type: 'integer', minimum: 0, maximum: 30, default: 0 },
        }, additionalProperties: false,
      },
    },
    {
      name: 'ziwei_phone_screenshot',
      description: '请求手机回传当前截图；成功后单独读取最新画面并返回 MCP 图片内容。',
      inputSchema: { type: 'object', required: ['deviceId'], properties: { deviceId: { type: 'string' }, waitSeconds: { type: 'integer', minimum: 0, maximum: 30, default: 8 } }, additionalProperties: false },
    },
    {
      name: 'ziwei_phone_control',
      description: '切换手机控制角色（agent、updater）或暂停控制。切换和暂停都会写入中控审计。',
      inputSchema: { type: 'object', required: ['deviceId', 'role'], properties: { deviceId: { type: 'string' }, role: { type: ['string', 'null'], enum: ['agent', 'updater', null] } }, additionalProperties: false },
    },
    {
      name: 'ziwei_phone_upgrade',
      description: '读取已发布安装包索引，为指定手机选择最新版本并创建安全升级事务；手机回传安装与健康状态后才算完成。',
      inputSchema: { type: 'object', required: ['deviceId', 'targetRole'], properties: { deviceId: { type: 'string' }, targetRole: { type: 'string', enum: roleValues }, versionCode: { type: 'integer', minimum: 1 }, waitSeconds: { type: 'integer', minimum: 0, maximum: 30, default: 5 } }, additionalProperties: false },
    },
    {
      name: 'ziwei_phone_wait',
      description: '等待已提交的命令或升级事务进入终态；超时只返回当前状态，不重复提交。',
      inputSchema: { type: 'object', required: ['deviceId'], properties: { deviceId: { type: 'string' }, commandId: { type: 'string' }, updateId: { type: 'string' }, waitSeconds: { type: 'integer', minimum: 1, maximum: 30, default: 10 } }, additionalProperties: false },
    },
    {
      name: 'ziwei_enrollment_pending',
      description: '读取手机端提交、等待中控审核的入网申请。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'ziwei_enrollment_approve',
      description: '批准一条手机入网申请；同一手机的 Agent/Updater 会自动配对并下发配置，无需 JSON。',
      inputSchema: { type: 'object', required: ['requestId'], properties: { requestId: { type: 'string' } }, additionalProperties: false },
    },
  ].map((tool) => ({ ...tool, annotations: { readOnlyHint: ['ziwei_phone_list', 'ziwei_phone_status', 'ziwei_phone_receipt', 'ziwei_phone_wait', 'ziwei_enrollment_pending'].includes(tool.name), openWorldHint: true } }))
}
export const toolDefinitions = defineTools();

function privateConfig(options) {
  const tokenFile = options.tokenFile || process.env.ZIWEI_TERMINAL_TOKEN_FILE;
  if (!tokenFile || !path.isAbsolute(tokenFile)) throw new Error('手机 MCP 需要本机私有 capability 文件的绝对路径');
  let saved;
  try {
    const stat = fs.statSync(tokenFile);
    if (!stat.isFile() || stat.size > 65536 || (process.platform !== 'win32' && (stat.mode & 0o077))) throw new Error('invalid private file');
    saved = JSON.parse(fs.readFileSync(tokenFile, 'utf8').replace(/^\uFEFF/, ''));
  } catch { throw new Error('手机 MCP 私有执行凭据不可读取或权限不正确，请重新检测员工配置'); }
  const workspace = String(options.workspace ?? process.env.ZIWEI_TERMINAL_WORKSPACE ?? saved.workspace ?? '');
  const employeeId = String(options.employeeId ?? process.env.ZIWEI_TERMINAL_EMPLOYEE_ID ?? saved.employeeId ?? '');
  const deviceId = String(options.deviceId ?? process.env.ZIWEI_TERMINAL_DEVICE_ID ?? saved.deviceId ?? '');
  if (!workspace || workspace !== saved.workspace) throw new Error('手机 MCP 工作区 scope 不匹配');
  if (!employeeId || employeeId !== saved.employeeId) throw new Error('手机 MCP 员工 scope 不匹配');
  if (!deviceId || deviceId !== saved.deviceId) throw new Error('手机 MCP 目标手机 scope 不匹配');
  const token = typeof saved.token === 'string' ? saved.token : '';
  if (!token || !/^[A-Za-z0-9_:\-.]+$/.test(token)) throw new Error('手机 MCP 执行凭据无效');
  const expiresAt = Date.parse(saved.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('手机 MCP 执行凭据已过期，请重新发起员工执行');
  let base;
  try { base = new URL(String(options.baseUrl ?? process.env.ZIWEI_TERMINAL_API_BASE ?? saved.baseUrl)); }
  catch { throw new Error('手机 MCP API 地址无效'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if ((base.protocol !== 'https:' && !(base.protocol === 'http:' && loopback)) || base.username || base.password || base.search || base.hash) throw new Error('手机 MCP API 必须使用无凭据 HTTPS 地址；隔离验收允许 loopback HTTP');
  const expected = `/terminal-mcp/v1/workspaces/${encodeURIComponent(workspace)}/employees/${encodeURIComponent(employeeId)}`;
  if (base.pathname.replace(/\/$/, '') !== expected) throw new Error('手机 MCP API 与员工/工作区 scope 不匹配');
  if (new URL(saved.baseUrl).origin !== base.origin) throw new Error('手机 MCP capability 与 API 必须同源');
  return { token, workspace, employeeId, deviceId, expiresAt, baseUrl: base.toString().replace(/\/$/, '') };
}

export function createTerminalMcpClient(options = {}) {
  const config = privateConfig(options);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const scrub = value => String(value).split(config.token).join('[已隐藏]');
  return {
    config: { workspace: config.workspace, employeeId: config.employeeId, deviceId: config.deviceId },
    async call(name, args = {}) {
      const definition = toolDefinitions.find(tool => tool.name === name);
      if (!definition) throw Object.assign(new Error('未知手机 MCP 工具'), { phoneExecutionState: 'not_started' });
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw Object.assign(new Error('手机工具参数必须是对象'), { phoneExecutionState: 'not_started' });
      if (args.deviceId !== undefined && args.deviceId !== config.deviceId) throw Object.assign(new Error('手机工具目标与已绑定手机 scope 不匹配'), { phoneExecutionState: 'not_started' });
      for (const key of definition.inputSchema.required || []) if (!Object.hasOwn(args, key)) throw Object.assign(new Error(`手机工具缺少 ${key}`), { phoneExecutionState: 'not_started' });
      if (Object.keys(args).some(key => !Object.hasOwn(definition.inputSchema.properties, key))) throw Object.assign(new Error('手机工具含未知参数'), { phoneExecutionState: 'not_started' });
      if (config.expiresAt <= Date.now()) throw Object.assign(new Error('手机 MCP 执行凭据已过期，请重启本次员工执行'), { phoneExecutionState: 'not_started' });
      let response;
      try {
        response = await fetchImpl(`${config.baseUrl}/call`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(90000), headers: { authorization: `Bearer ${config.token}`, accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ name, arguments: args }) });
      } catch { throw Object.assign(new Error('手机 MCP 连接中断或超时；动作可能已受理，请查询原回执，不要重放'), { phoneExecutionState: 'uncertain' }); }
      let value;
      try { value = await response.json(); }
      catch { throw Object.assign(new Error('手机 MCP 响应无法解析；请查询原回执，不要重放动作'), { phoneExecutionState: 'uncertain' }); }
      if (!response.ok) throw Object.assign(new Error(scrub(value?.error || value?.message || `手机 MCP HTTP ${response.status}`)), { phoneExecutionState: response.status >= 500 ? 'uncertain' : 'not_started' });
      return value;
    }
  };
}

const executionStates = new Set(['not_started', 'succeeded', 'failed', 'uncertain', 'pending']);
const safeDiagnostic = value => typeof value === 'string' ? redactSecrets(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, 800) : '';
function commandOutcome(command) {
  if (!command || typeof command !== 'object') return null;
  const declared = command.executionState || command.execution_state || command.result?.executionState;
  const state = executionStates.has(declared) ? declared : command.status === 'succeeded' ? 'succeeded' : command.status === 'uncertain' ? 'uncertain' : ['failed', 'expired', 'cancelled', 'rejected', 'aborted', 'timed_out'].includes(command.status) ? 'failed' : 'pending';
  const confirmed = command.executingConfirmed ?? command.executing_confirmed;
  const errorCode = command.errorCode || command.result?.errorCode;
  return { state, ...(typeof errorCode === 'string' && /^[A-Z0-9_]{1,100}$/.test(errorCode) ? { errorCode } : {}), ...(typeof command.id === 'string' ? { commandId: command.id } : {}), ...(typeof command.status === 'string' ? { status: command.status } : {}), ...([true, false, 0, 1].includes(confirmed) ? { executingConfirmed: Boolean(confirmed) } : {}), ...(safeDiagnostic(command.error) ? { error: safeDiagnostic(command.error) } : {}), ...(state === 'uncertain' || state === 'pending' ? { retryAllowed: false } : {}) };
}
function rpcError(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }
export async function handleTerminalJsonRpc(message, client) {
  const id = message?.id ?? null;
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return rpcError(id, -32600, '无效 JSON-RPC 请求');
  if (message.method.startsWith('notifications/')) return null;
  if (message.method === 'ping') return { jsonrpc: '2.0', id, result: {} };
  if (message.method === 'initialize') return { jsonrpc: '2.0', id, result: { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'ziwei-terminal', version: '1.0.0' }, instructions: '只使用当前员工明确绑定的手机。先 list/status 确认目标与健康，再 screenshot 观察当前画面、action 执行已授权动作，按原 commandId 查询 receipt/wait。受理不等于成功；超时或 uncertain 不重复下发。已有用户授权持续有效，缺少必要目标或配置时明确报告。' } };
  if (message.method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: toolDefinitions } };
  if (message.method !== 'tools/call') return rpcError(id, -32601, '未知 MCP 方法');
  try {
    const name = message.params?.name;
    if (!toolDefinitions.some(tool => tool.name === name)) throw Object.assign(new Error('未知手机 MCP 工具'), { phoneExecutionState: 'not_started' });
    const args = message.params?.arguments ?? {};
    let value = await client.call(name, args);
    const phoneExecution = commandOutcome(value?.command);
    if (phoneExecution) value = { ...value, phoneExecution };
    const content = [{ type: 'text', text: JSON.stringify(value, null, 2) }];
    if (name === 'ziwei_phone_screenshot' || (name === 'ziwei_phone_action' && args.action === 'screenshot')) {
      const snapshot = value?.device?.snapshot || value?.snapshot;
      if (snapshot?.data && ['image/png', 'image/jpeg'].includes(snapshot.mime || snapshot.mimeType)) {
        value = { command: value.command, ...(phoneExecution ? { phoneExecution } : {}), deviceId: value.device?.id || value.deviceId || args.deviceId, capturedAt: snapshot.capturedAt, width: snapshot.width, height: snapshot.height };
        content[0].text = JSON.stringify(value, null, 2);
        content.push({ type: 'image', data: snapshot.data, mimeType: snapshot.mime || snapshot.mimeType });
      }
    }
    return { jsonrpc: '2.0', id, result: { content, structuredContent: value, isError: false } };
  } catch (error) { return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: error?.message || '手机 MCP 工具失败' }], structuredContent: { phoneExecution: { state: executionStates.has(error?.phoneExecutionState) ? error.phoneExecutionState : 'uncertain', retryAllowed: false } }, isError: true } }; }
}

export async function runTerminalStdio(options = {}) {
  const client = options.client || createTerminalMcpClient(options);
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  const auditFile = options.auditFile || process.env.ZIWEI_TERMINAL_AUDIT_FILE;
  if (auditFile && !path.isAbsolute(auditFile)) throw new Error('手机 MCP 审计路径必须为本机绝对路径');
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let message;
    try { message = JSON.parse(line); } catch { output.write(`${JSON.stringify(rpcError(null, -32700, '无效 JSON'))}\n`); continue; }
    const response = await handleTerminalJsonRpc(message, client);
    if (auditFile && ['initialize', 'tools/list', 'tools/call'].includes(message.method)) {
      const value = response?.result?.structuredContent || {};
      const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-][A-Za-z0-9._:-]{0,199}$/.test(value) ? value : undefined;
      const status = value.command?.status || value.update?.state || value.update?.status;
      const safeStatus = value => typeof value === 'string' && /^[a-z_]{1,40}$/.test(value) ? value : undefined;
      const device = value.device || value;
      const receipts = [
        ...(Array.isArray(device.commands) ? device.commands : []).map(item => { const outcome = commandOutcome(item); return { commandId: safeId(item.id), status: safeStatus(item.status), ...(outcome?.error ? { error: outcome.error } : {}), ...(outcome?.errorCode ? { errorCode: outcome.errorCode } : {}), ...(outcome && executionStates.has(item.executionState || item.execution_state || item.result?.executionState) ? { executionState: outcome.state } : {}), ...(typeof outcome?.executingConfirmed === 'boolean' ? { executingConfirmed: outcome.executingConfirmed } : {}) }; }),
        ...(Array.isArray(device.updates) ? device.updates : []).map(item => ({ updateId: safeId(item.id), status: safeStatus(item.state || item.status) }))
      ].filter(item => (item.commandId || item.updateId) && item.status).slice(0, 200);
      const event = { at: new Date().toISOString(), method: message.method, ...(message.method === 'tools/call' ? { toolName: toolDefinitions.some(tool => tool.name === message.params?.name) ? message.params.name : 'unknown_tool' } : {}), ok: Boolean(response && !response.error && !response.result?.isError), workspace: options.workspace || process.env.ZIWEI_TERMINAL_WORKSPACE || '', deviceId: safeId(value.device?.id || value.deviceId || message.params?.arguments?.deviceId), commandId: safeId(value.command?.id), commandStatus: safeStatus(value.command?.status), updateId: safeId(value.update?.id), updateStatus: safeStatus(value.update?.state || value.update?.status), ...(safeStatus(status) ? { status } : {}), ...(receipts.length ? { receipts } : {}) };
      // `ok` describes the MCP/API request. Only the original command receipt
      // establishes whether a phone action succeeded; never treat HTTP 200 as it.
      const outcome = value.phoneExecution;
      if (outcome && executionStates.has(outcome.state)) event.commandExecutionState = outcome.state;
      if (typeof outcome?.executingConfirmed === 'boolean') event.commandExecutingConfirmed = outcome.executingConfirmed;
      if (outcome?.error) event.commandError = safeDiagnostic(outcome.error);
      if (outcome?.errorCode) event.commandErrorCode = outcome.errorCode;
      if (!event.ok) event.error = safeDiagnostic(response?.result?.content?.find(item => item.type === 'text')?.text || response?.error?.message);
      fs.mkdirSync(path.dirname(auditFile), { recursive: true });
      fs.appendFileSync(auditFile, `${JSON.stringify(event)}\n`, { mode: 0o600 });
    }
    if (response) output.write(`${JSON.stringify(response)}\n`);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) runTerminalStdio().catch(error => { process.stderr.write(`${error?.message || '手机 MCP 启动失败'}\n`); process.exitCode = 1; });
