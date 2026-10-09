#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const PROTOCOL_VERSION = '2024-11-05';
const DEFAULT_API_BASE = process.env.ZIWEI_API_BASE || 'https://qzelynth.top';

function readTokenFile(file) {
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!raw) throw new Error('MCP 管理令牌文件为空');
  if (!raw.startsWith('{')) return { token: raw };
  const parsed = JSON.parse(raw);
  const scoped = Array.isArray(parsed.workspaces) ? parsed.workspaces : (parsed.workspace ? [parsed.workspace] : []);
  return { token: String(parsed.token || parsed.bearerToken || '').trim(), workspace: scoped.length === 1 ? String(scoped[0]).trim() : '' };
}

function configFromEnv(options = {}) {
  const file = options.tokenFile || process.env.ZIWEI_MCP_TOKEN_FILE;
  const fileConfig = file ? readTokenFile(file) : {};
  const token = String(options.token ?? process.env.ZIWEI_MCP_TOKEN ?? fileConfig.token ?? '').trim();
  const workspace = String(options.workspace ?? process.env.ZIWEI_MCP_WORKSPACE ?? fileConfig.workspace ?? '').trim();
  if (!token) throw new Error('未配置 MCP 管理令牌，请设置 ZIWEI_MCP_TOKEN 或 ZIWEI_MCP_TOKEN_FILE');
  if (!/^[a-z0-9][a-z0-9_-]{1,62}$/i.test(workspace)) throw new Error('MCP 工作区标识无效');
  const baseUrl = new URL(String(options.baseUrl ?? process.env.ZIWEI_API_BASE ?? DEFAULT_API_BASE));
  if ((baseUrl.protocol !== 'https:' && !(baseUrl.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname))) || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash || !['', '/'].includes(baseUrl.pathname)) throw new Error('MCP API 必须使用无凭据的 HTTPS 根地址；本机验收允许 loopback HTTP');
  return { token, workspace, baseUrl: baseUrl.toString().replace(/\/$/, '') };
}

function objectArguments(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('工具参数必须是 JSON 对象');
  return value;
}

export const toolDefinitions = [
  { name: 'ziwei_mcp_health', description: '检查当前紫薇工作区 MCP 管理入口状态与窄管理面边界。', inputSchema: { type: 'object', properties: {} } },
  { name: 'ziwei_discover_environment', description: '先调用本工具：查询当前工作区真实目标电脑、在线状态、已发现的 CLI/runtime、模型、Hermes profiles、认证/provider 就绪信息及技能。不得猜测或替换运行时。', inputSchema: { type: 'object', properties: { deviceId: { type: 'string' } } } },
  { name: 'ziwei_get_employee', description: '按 ID 回读员工职责、人格、技能、runtime/profile 和绑定电脑。', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  { name: 'ziwei_get_employee_mcp_status', description: '查询员工管理 MCP 的配置和最近真实执行调用证据；HTTP 健康不代表员工已经加载。', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  { name: 'ziwei_create_hermes_profile', description: '在指定在线电脑创建独立 Hermes profile（本地继承 provider，主 profile 不变）。返回异步 action，必须使用 ziwei_get_action 等待 succeeded，再发现 profile 后创建 Hermes 员工。', inputSchema: { type: 'object', required: ['profile', 'deviceId', 'soul'], properties: { profile: { type: 'string' }, deviceId: { type: 'string' }, soul: { type: 'string' }, memory: { type: 'string' }, identity: { type: 'string' }, inheritProvider: { type: 'boolean', default: true }, idempotencyKey: { type: 'string' } } } },
  { name: 'ziwei_get_action', description: '回读当前工作区异步 profile 或员工执行 action 的真实状态、结果、错误和事件。pending/acked 不表示成功。', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  { name: 'ziwei_get_task', description: '回读任务、员工真实执行 action 与结果。用本工具验证试运行，不可把创建成功当成执行成功。', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  { name: 'ziwei_list_employees', description: '列出指定紫薇工作区的数字员工。', inputSchema: { type: 'object', properties: {} } },
  { name: 'ziwei_create_employee', description: '发现环境后，按用户明确选择的 runtime、目标电脑和 profile 创建员工。职责 description、人格 persona、岗位指令 instructions、技能 skills 分别保存；指定 Codex/Hermes 不会回退。使用稳定 idempotencyKey 安全重试。', inputSchema: { type: 'object', required: ['name', 'runtime', 'targetDeviceId'], properties: { name: { type: 'string' }, runtime: { type: 'string' }, targetDeviceId: { type: 'string' }, runtimeProfile: { type: 'string' }, model: { type: 'string' }, description: { type: 'string' }, persona: { type: 'string' }, instructions: { type: 'string' }, managementMcpEnabled: { type: 'boolean' }, idempotencyKey: { type: 'string' }, visibility: { type: 'string', enum: ['workspace', 'personal'] }, skills: { type: 'array', items: { type: 'string' } } } } },
  { name: 'ziwei_update_employee', description: '更新已有数字员工的职责、人格、技能、目标电脑和明确的运行时配置。', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, name: { type: 'string' }, runtime: { type: 'string' }, targetDeviceId: { type: 'string' }, runtimeProfile: { type: 'string' }, model: { type: 'string' }, persona: { type: 'string' }, managementMcpEnabled: { type: 'boolean' }, description: { type: 'string' }, instructions: { type: 'string' }, status: { type: 'string' }, visibility: { type: 'string' }, skills: { type: 'array', items: { type: 'string' } } } } },
  { name: 'ziwei_list_tasks', description: '列出指定紫薇工作区的任务。', inputSchema: { type: 'object', properties: { state: { type: 'string' }, assignee: { type: 'string' }, q: { type: 'string' } } } },
  { name: 'ziwei_create_task', description: '创建任务；试运行时 employeeId + execute:true，沿用员工明确配置并校验目标电脑、CLI 和 profile。回读 ziwei_get_task/ziwei_get_action 确认真正执行结果。使用稳定 idempotencyKey 避免重复任务。', inputSchema: { type: 'object', required: ['title'], properties: { title: { type: 'string' }, description: { type: 'string' }, employeeId: { type: 'string' }, assignee: { type: 'string' }, targetDeviceId: { type: 'string' }, runtime: { type: 'string' }, runtimeProfile: { type: 'string' }, execute: { type: 'boolean' }, idempotencyKey: { type: 'string' }, priority: { type: 'string' }, labels: { type: 'array', items: { type: 'string' } } } } },
  { name: 'ziwei_list_documents', description: '列出指定紫薇工作区的文档。', inputSchema: { type: 'object', properties: {} } },
  { name: 'ziwei_read_document', description: '读取紫薇工作区内的文档。', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  { name: 'ziwei_write_document', description: '在紫薇工作区创建文档，或更新已有文档。', inputSchema: { type: 'object', required: ['name'], properties: { id: { type: 'string' }, name: { type: 'string' }, type: { type: 'string' }, content: { type: 'string' }, mimeType: { type: 'string' }, parentId: { type: 'string' } } } },
  {name:'ziwei_phone_mcp_setup',description:'发现工作区手机平台技能实际版本/安装状态、电脑runtime/profile与原中控手机。员工绑定手机后才会获得完整十工具。',inputSchema:{type:'object',properties:{}}},
  {name:'ziwei_install_skill',description:'安装或卸载当前工作区已发现的真实平台技能ID，并保留版本记录；卸载手机技能不删除员工人格、其他技能或手机绑定。',inputSchema:{type:'object',required:['id'],properties:{id:{type:'string'},installed:{type:'boolean',default:true}}}},
  {name:'ziwei_configure_phone_mcp',description:'为当前工作区员工配置已安装手机技能、精确电脑/runtime/profile和手机绑定。不会复制管理员凭据。',inputSchema:{type:'object',required:['id','enabled'],properties:{id:{type:'string'},enabled:{type:'boolean'},phoneDeviceId:{type:'string'},targetDeviceId:{type:'string'},runtime:{type:'string'},runtimeProfile:{type:['string','null']},accountId:{type:'string'},accountLabel:{type:'string'}}}},
  {name:'ziwei_get_phone_mcp_status',description:'回读员工手机技能保存、API、实际MCP加载和本配置手机命令/截图验收结果；不能把配置成功当成实机成功。',inputSchema:{type:'object',required:['id'],properties:{id:{type:'string'}}}},
  {name:'ziwei_check_phone_mcp',description:'创建员工持久会话实际加载手机MCP并读取list/status。此次capability只准只读检测，返回action需回读。',inputSchema:{type:'object',required:['id'],properties:{id:{type:'string'},idempotencyKey:{type:'string'}}}},
  {name:'ziwei_trial_phone_mcp',description:'创建真实员工持久会话执行已绑定手机health或screenshot，返回action需回读commandId/状态/截图；幂等键避免重复试运行。',inputSchema:{type:'object',required:['id'],properties:{id:{type:'string'},action:{type:'string',enum:['health','screenshot']},idempotencyKey:{type:'string'}}}}
].map(tool=>({...tool,inputSchema:{...tool.inputSchema,properties:{...tool.inputSchema.properties,workspace:{type:'string',description:'可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。'}}}}));

export function createMcpClient(options = {}) {
  const config = configFromEnv(options);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('当前 Node 环境没有 fetch');
  const workspacePath = `/mcp/v1/workspaces/${encodeURIComponent(config.workspace)}`;
  async function request(method, route, body, query) {
    const selectedWorkspace=String(body?.workspace || query?.workspace || config.workspace).trim();
    if(!/^[a-z0-9][a-z0-9_-]{1,62}$/i.test(selectedWorkspace)) throw new Error('MCP 工作区标识无效');
    route=route.replace(/^\/mcp\/v1\/workspaces\/[^/]+/,`/mcp/v1/workspaces/${encodeURIComponent(selectedWorkspace)}`);
    if(body && Object.hasOwn(body,'workspace')) {const {workspace:_workspace,...value}=body;body=value;}
    if(query && Object.hasOwn(query,'workspace')) {const {workspace:_workspace,...value}=query;query=value;}
    const url = new URL(`${config.baseUrl}${route}`);
    for (const [key, value] of Object.entries(query || {})) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    const headers = { authorization: `Bearer ${config.token}`, accept: 'application/json' };
    const init = { method, headers, redirect: 'error', signal: AbortSignal.timeout(30_000) };
    if (body !== undefined) { headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
    const response = await fetchImpl(url, init);
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
    if (!response.ok) throw new Error(String(payload?.error || `紫薇 API 返回 HTTP ${response.status}`));
    return payload;
  }
  return {
    async health(input={}) { return request('GET', `${workspacePath}/health`,undefined,input); },
    async discoverEnvironment(input) { return request('GET', `${workspacePath}/discovery`, undefined, input); },
    async getEmployee(input) { return request('GET', `${workspacePath}/employees/${encodeURIComponent(input.id)}`,undefined,{workspace:input.workspace}); },
    async getEmployeeMcpStatus(input) { return request('GET', `${workspacePath}/employees/${encodeURIComponent(input.id)}/mcp/status`,undefined,{workspace:input.workspace}); },
    async createHermesProfile(input) { return request('POST', `${workspacePath}/hermes/profiles/requests`, input); },
    async getAction(input) { return request('GET', `${workspacePath}/actions/${encodeURIComponent(input.id)}`,undefined,{workspace:input.workspace}); },
    async getTask(input) { return request('GET', `${workspacePath}/tasks/${encodeURIComponent(input.id)}`,undefined,{workspace:input.workspace}); },
    async listEmployees(input={}) { return request('GET', `${workspacePath}/employees`,undefined,input); },
    async createEmployee(input) { return request('POST', `${workspacePath}/employees`, input); },
    async updateEmployee(input) { const { id, ...patch } = input; return request('PATCH', `${workspacePath}/employees/${encodeURIComponent(id)}`, patch); },
    async listTasks(input) { return request('GET', `${workspacePath}/tasks`, undefined, input); },
    async createTask(input) { return request('POST', `${workspacePath}/tasks`, input); },
    async listDocuments(input={}) { return request('GET', `${workspacePath}/documents`,undefined,input); },
    async readDocument(input) { return request('GET', `${workspacePath}/documents/${encodeURIComponent(input.id)}`,undefined,{workspace:input.workspace}); },
    async phoneMcpSetup(input={}) {return request('GET',`${workspacePath}/phone-mcp/setup`,undefined,input);},
    async installSkill(input) {return request('POST',`${workspacePath}/skills/${encodeURIComponent(input.id)}/install`,input);},
    async configurePhoneMcp(input) {const{id,...body}=input;return request('PUT',`${workspacePath}/employees/${encodeURIComponent(id)}/phone-mcp`,body);},
    async getPhoneMcpStatus(input) {return request('GET',`${workspacePath}/employees/${encodeURIComponent(input.id)}/phone-mcp/status`,undefined,{workspace:input.workspace});},
    async checkPhoneMcp(input) {return request('POST',`${workspacePath}/employees/${encodeURIComponent(input.id)}/phone-mcp/check`,input);},
    async trialPhoneMcp(input) {return request('POST',`${workspacePath}/employees/${encodeURIComponent(input.id)}/phone-mcp/trial`,input);},
    async writeDocument(input) {
      if (input.id) { const { id, ...patch } = input; return request('PATCH', `${workspacePath}/documents/${encodeURIComponent(id)}`, patch); }
      return request('POST', `${workspacePath}/documents`, input);
    }
  };
}

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

export function createMcpHandler(client) {
  const calls = {
    ziwei_mcp_health: args => client.health(args),
    ziwei_discover_environment: args => client.discoverEnvironment(args),
    ziwei_get_employee: args => client.getEmployee(args),
    ziwei_get_employee_mcp_status: args => client.getEmployeeMcpStatus(args),
    ziwei_create_hermes_profile: args => client.createHermesProfile(args),
    ziwei_get_action: args => client.getAction(args),
    ziwei_get_task: args => client.getTask(args),
    ziwei_list_employees: args => client.listEmployees(args),
    ziwei_create_employee: args => client.createEmployee(args),
    ziwei_update_employee: args => client.updateEmployee(args),
    ziwei_list_tasks: args => client.listTasks(args),
    ziwei_create_task: args => client.createTask(args),
    ziwei_list_documents: args => client.listDocuments(args),
    ziwei_read_document: args => client.readDocument(args),
    ziwei_write_document: args => client.writeDocument(args),
    ziwei_phone_mcp_setup: args=>client.phoneMcpSetup(args),
    ziwei_install_skill: args=>client.installSkill(args),
    ziwei_configure_phone_mcp: args=>client.configurePhoneMcp(args),
    ziwei_get_phone_mcp_status: args=>client.getPhoneMcpStatus(args),
    ziwei_check_phone_mcp: args=>client.checkPhoneMcp(args),
    ziwei_trial_phone_mcp: args=>client.trialPhoneMcp(args)
  };
  return async message => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
    const { id, method, params = {} } = message;
    if (id === undefined && method?.startsWith('notifications/')) return null;
    const reply = result => id === undefined ? null : ({ jsonrpc: '2.0', id, result });
    const failure = (code, msg) => id === undefined ? null : ({ jsonrpc: '2.0', id, error: { code, message: msg } });
    try {
      if (method === 'initialize') return reply({ protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: 'ziwei-management', version: '0.1.0' } });
      if (method === 'notifications/initialized') return null;
      if (method === 'ping') return reply({});
      if (method === 'tools/list') return reply({ tools: toolDefinitions });
      if (method !== 'tools/call') return failure(-32601, `未知方法: ${method}`);
      const name = String(params?.name || '');
      if (!calls[name]) return failure(-32602, `未知工具: ${name}`);
      const value = await calls[name](objectArguments(params?.arguments));
      return reply(textResult(value));
    } catch (error) {
      return failure(-32000, error?.message || 'MCP 工具执行失败');
    }
  };
}

export async function runStdio(options = {}) {
  const handler = createMcpHandler(options.client || createMcpClient(options));
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  const auditFile = options.auditFile || process.env.ZIWEI_MCP_AUDIT_FILE;
  if (auditFile && !path.isAbsolute(auditFile)) throw new Error('MCP 审计路径必须是本机绝对路径');
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let message;
    try { message = JSON.parse(line); } catch { output.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: '无效 JSON' } })}\n`); continue; }
    const response = await handler(message);
    if (auditFile && ['initialize', 'tools/list', 'tools/call'].includes(message.method)) {
      // Private runtime receipts contain protocol metadata and resource IDs only.
      // Never persist arguments, prompts, authorization or arbitrary tool output.
      let value = {};
      try { value = JSON.parse(response?.result?.content?.find(item => item.type === 'text')?.text || '{}'); } catch {}
      const ids = {};
      const safeId = item => typeof item === 'string' && /^(employee|task|action|doc)[_-][A-Za-z0-9_-]{1,100}$/.test(item);
      if (safeId(value.id)) ids.resourceId = value.id;
      if (safeId(value.execution?.id)) ids.actionId = value.execution.id;
      if (safeId(value.employee_id)) ids.employeeId = value.employee_id;
      const event = { at: new Date().toISOString(), method: message.method, ...(message.method === 'tools/call' ? { toolName: String(message.params?.name || '').slice(0, 100) } : {}), ok: Boolean(response && !response.error && !response.result?.isError), requestId: typeof message.id === 'number' ? message.id : String(message.id ?? '').slice(0, 100), workspace: options.workspace || process.env.ZIWEI_MCP_WORKSPACE || '', ...ids };
      fs.mkdirSync(path.dirname(auditFile), { recursive: true });
      fs.appendFileSync(auditFile, `${JSON.stringify(event)}\n`, { mode: 0o600 });
      try { fs.chmodSync(auditFile, 0o600); } catch {}
    }
    if (response) output.write(`${JSON.stringify(response)}\n`);
  }
}

function cliArgs(argv) {
  const result = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--api-base') result.baseUrl = argv[++i];
    else if (key === '--workspace') result.workspace = argv[++i];
    else if (key === '--token') result.token = argv[++i];
    else if (key === '--token-file') result.tokenFile = path.resolve(argv[++i]);
    else throw new Error(`未知参数: ${key}`);
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  runStdio(cliArgs(process.argv)).catch(error => { process.stderr.write(`ziwei-mcp: ${error.message}\n`); process.exitCode = 1; });
}
