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
  return { token: String(parsed.token || parsed.bearerToken || '').trim(), workspace: scoped.length === 1 ? String(scoped[0]).trim() : '', managed: parsed.managed === true, expiresAt: parsed.expiresAt, audience: parsed.audience, apiBase: parsed.apiBase, deviceId: parsed.deviceId };
}

function configFromEnv(options = {}) {
  const file = options.tokenFile || process.env.ZIWEI_MCP_TOKEN_FILE;
  const fileConfig = file ? readTokenFile(file) : {};
  const token = String(fileConfig.managed ? fileConfig.token : ((options.token ?? process.env.ZIWEI_MCP_TOKEN) || fileConfig.token || '')).trim();
  const workspace = String(options.workspace ?? process.env.ZIWEI_MCP_WORKSPACE ?? fileConfig.workspace ?? '').trim();
  if (!token) throw new Error('未配置 MCP 管理令牌，请设置 ZIWEI_MCP_TOKEN 或 ZIWEI_MCP_TOKEN_FILE');
  if (!/^[a-z0-9][a-z0-9_-]{1,62}$/i.test(workspace)) throw new Error('MCP 工作区标识无效');
  const baseUrl = new URL(String(options.baseUrl ?? process.env.ZIWEI_API_BASE ?? DEFAULT_API_BASE));
  if ((baseUrl.protocol !== 'https:' && !(baseUrl.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname))) || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash || !['', '/'].includes(baseUrl.pathname)) throw new Error('MCP API 必须使用无凭据的 HTTPS 根地址；本机验收允许 loopback HTTP');
  const base = baseUrl.toString().replace(/\/$/, '');
  if (fileConfig.managed && (fileConfig.workspace !== workspace || fileConfig.audience !== 'ziwei-management' || fileConfig.apiBase !== base || !fileConfig.deviceId || !(Date.parse(fileConfig.expiresAt) > Date.now()))) throw new Error('自动管理 MCP 凭据的工作区、有效期或服务范围不匹配');
  return { token, workspace, baseUrl: base, managed: fileConfig.managed };
}

function objectArguments(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('工具参数必须是 JSON 对象');
  return value;
}

export const toolDefinitions = [
  {name:'ziwei_bot',description:'Hermes Bot 统一管理。capabilities/list发现；create创建专属命名Profile的Bot并返回主聊天和instance.provisioning；202仅排队，先用ziwei_get_action查询原创建动作并get确认provisioned；provision仅显式恢复同一身份，uncertain不重建；get回读；validate无模型原生配置检查，用ziwei_get_action等待成功后get最新revision/control_epoch，再control activate。用户已说创建并启用可覆盖正常步骤。control必须expectedRevision与expectedControlEpoch，旧请求不得覆盖暂停。native实际操作memory/sessions/skills/mcp/goals/heartbeat/kanban/groups/gateway/voice，等待原action终态；collaboration只用明确授权工作区员工。远程 MCP OAuth：空闲时先 update 中央 config.mcpServers 配置，再 connectMcp；员工正在执行且用户要求本轮结束后应用时，用原 update 携带 deferUntilIdle:true、expectedControlEpoch、稳定idempotencyKey，可加 connectMcpServers:["viral_library"]，由独立队列在空闲后应用、实际validate成功、按原授权恢复并连接；用 get.deferredConfig 回读queued/applying/validating/connecting/authorization_required/connected及原actionIds，queued不等于已生效，不在当前执行内循环等待自己结束；已有目标Profile授权由原生连接复用，不请求用户到电脑运行命令；用 mcpConnections 回读原连接，等待 authorization_required 后把 authorizationUrl 给管理员在浏览器同意。浏览器回调后仍须等待目标电脑实际工具回执，connected 才表示连接验证完成，下一次员工执行才加载；不能要求用户去员工终端登录。网络结果未知时保留原 idempotencyKey 并先回读，不重复派发；cancelMcpConnection 取消原连接。Routine.nativeDriver有限推进，紫薇唯一调度，uncertain不得重跑，OAuth 凭据留在员工专属 Profile，其他密钥仅用外部服务本机环境引用。',inputSchema:{type:'object',required:['operation'],properties:{operation:{type:'string',enum:['capabilities','list','create','initialize','get','update','provision','validate','control','runs','routines','createRoutine','updateRoutine','deleteRoutine','runRoutine','native','collaboration','mcpConnections','connectMcp','cancelMcpConnection']},id:{type:'string'},routineId:{type:'string'},connectionId:{type:'string',description:'cancelMcpConnection 必填的原连接 action ID'},deviceId:{type:'string'},data:{type:'object',description:'create: name,targetDeviceId,sourceProfile（兼容runtimeProfile初始化来源）,model,persona,description,instructions,config,idempotencyKey；config.reasoningEffort可明确minimal/low/medium/high/xhigh/max/ultra，未给保留缺省；明确值需原生effective/request回执匹配，ultra被转xhigh会拒绝，不称已满足; update: expectedRevision,employee/config；可选deferUntilIdle:true（须expectedControlEpoch、idempotencyKey），connectMcpServers为已配置服务名数组，例如["viral_library"]；get.deferredConfig回读持久队列和原连接actionIds；远程 MCP config.mcpServers 的 HTTP/SSE 服务可设 auth:oauth、oauth.cimd/scope；mcpConnections/connectMcp/cancelMcpConnection 都需顶层 id；mcpConnections 只读不需 data；connectMcp data: server,expectedRevision,expectedControlEpoch,idempotencyKey；cancelMcpConnection 另需顶层 connectionId; provision/validate: expectedRevision,idempotencyKey; control: expectedRevision,expectedControlEpoch,operation activate/pause/resume/stop; Routine: name,prompt或nativeDriver,schedule,timezone,idempotencyKey; native: expectedRevision,expectedControlEpoch,idempotencyKey,resource,operation,input；操作白名单memory read/write，sessions list/search/read，skills list/read/install/update/remove/enable/disable/hub_search/hub_install/check_updates，mcp inspect/authorize/call（网页授权使用 connectMcp），goals/heartbeat status/start/pause/resume/stop/step，kanban list/create/show/edit/claim/complete/block/unblock/dispatch，groups list/read/step，gateway status/configure/connect/disconnect/inbound/outbound，voice status/configure/transcribe/synthesize；collaboration:版本、idempotencyKey、mode message/delegate/group、targetEmployeeIds、content、可选groupId。'}}}},
  {name:'ziwei_inspect_workdir',description:'在指定在线电脑检查真实工作目录。返回异步 action，以 ziwei_get_action 等待 succeeded 后，将 result.path 和 action.id 作为员工 defaultWorkingDirectory/defaultWorkingDirectoryActionId 保存。检查回执10分钟内有效。仅用户明确要求创建时传 createIfMissing:true；不会创建会话或执行员工任务。',inputSchema:{type:'object',required:['deviceId','path'],properties:{deviceId:{type:'string'},path:{type:'string',maxLength:4096},createIfMissing:{type:'boolean',default:false},idempotencyKey:{type:'string'}}}},
  {name:'ziwei_create_conversation',description:'为当前工作区员工创建新会话，返回持久化目录快照；不发送消息或执行任务。省略 workingDirectory 会继承员工绑定该电脑的默认目录，再沿用设备目录。非空显式目录仅覆盖该会话。使用稳定 idempotencyKey 安全重试。',inputSchema:{type:'object',required:['employeeId'],properties:{employeeId:{type:'string'},title:{type:'string'},deviceId:{type:'string'},workingDirectory:{type:['string','null'],maxLength:4096},model:{type:'string'},idempotencyKey:{type:'string'}}}},
  { name: 'ziwei_mcp_health', description: '检查当前紫薇工作区 MCP 管理入口状态与窄管理面边界。', inputSchema: { type: 'object', properties: {} } },
  { name: 'ziwei_discover_environment', description: '先调用本工具：查询当前工作区真实目标电脑、在线状态、已发现的 CLI/runtime、模型、Hermes profiles、认证/provider 就绪信息及技能。不得猜测或替换运行时。', inputSchema: { type: 'object', properties: { deviceId: { type: 'string' } } } },
  { name: 'ziwei_get_employee', description: '按 ID 回读员工职责、人格、技能、runtime/profile 和绑定电脑。', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  { name: 'ziwei_get_employee_mcp_status', description: '查询员工管理 MCP 的配置和最近真实执行调用证据；HTTP 健康不代表员工已经加载。', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  {name:'ziwei_get_employee_capabilities',description:'读取员工 Skill/MCP/CLI 能力清单与 AI 回填记录。agent_reported 为自报来源，不代表已授权、已加载或独立验证。',inputSchema:{type:'object',required:['id'],properties:{id:{type:'string'}}}},
  {name:'ziwei_get_employee_plugins',description:'读取 DSH 员工绑定电脑与原生 Bot 的插件观察快照。目录、保存开关与实际加载状态分别回读；旧快照不代表当前原生状态。需要最新值先 refresh，等待原 action 后再 get。',inputSchema:{type:'object',additionalProperties:false,required:['id'],properties:{id:{type:'string'}}}},
  {name:'ziwei_refresh_employee_plugins',description:'在 DSH 员工绑定电脑只读刷新原生 Bot 插件目录、保存组合和加载证据；要求客户端 dsh_plugins_v1。返回 pending/actionId 仅表示排队，用 ziwei_get_action 等待，再 get 回读。不启动或重启 Bot，不运行模型或业务。',inputSchema:{type:'object',additionalProperties:false,required:['id'],properties:{id:{type:'string'},idempotencyKey:{type:'string',maxLength:128,pattern:'^[-A-Za-z0-9_.:]{1,128}$'}}}},
  {name:'ziwei_apply_employee_plugins',description:'将 enabled 中的真实原生 bundle ID 保存到当前 DSH 员工绑定 Bot 的同一份原生插件组合。先 get/refresh 获取目录，保留必需项和已有自定义 bundle，使用稳定 idempotencyKey。pending/actionId 不代表已保存；原 action 成功后 get 确认保存与下次启动生效状态，实际加载另看原生证据。不启动或重启 Bot，不接受外部地址、路径或另一 Bot 目标。',inputSchema:{type:'object',additionalProperties:false,required:['id','enabled','idempotencyKey'],properties:{id:{type:'string'},enabled:{type:'array',maxItems:128,items:{type:'string',maxLength:200}},idempotencyKey:{type:'string',maxLength:128,pattern:'^[-A-Za-z0-9_.:]{1,128}$'}}}},
  {name:'ziwei_report_employee_capabilities',description:'安装、配置变更或调用结果变化后，回填当前授权员工的 Skill/MCP/CLI 能力；无变化不用重复报告。不扫描电脑、不安装工具、不执行业务。source 固定 agent_reported，不授予权限或伪造可用证据。相同 kind/id 更新原条目；status removed 移除条目。使用稳定 idempotencyKey；回读 ziwei_get_employee_capabilities。command 仅填命令名，不含参数、路径或密钥。evidenceActionId 可引用同员工电脑/Profile的原终态执行，但不自动验证具体工具。',inputSchema:{type:'object',required:['id','entries','idempotencyKey'],properties:{id:{type:'string'},idempotencyKey:{type:'string',maxLength:128},entries:{type:'array',minItems:1,maxItems:100,items:{type:'object',additionalProperties:false,required:['kind','id','name','status'],properties:{kind:{type:'string',enum:['skill','mcp','cli']},id:{type:'string',maxLength:160},name:{type:'string',maxLength:160},status:{type:'string',enum:['declared','working','failed','removed']},description:{type:'string',maxLength:500},version:{type:'string',maxLength:40},command:{type:'string',maxLength:100},evidenceActionId:{type:'string',maxLength:200}}}}}}},
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
  {name:'ziwei_phone_mcp_setup',description:'只读发现手机平台技能、电脑runtime/profile与原中控手机目录。数量查询使用 view:"summary"，返回 control_catalog 的唯一手机ID数量、当前可见员工与电脑数量及简短目录；不是工作区已绑定手机数。默认 view:"full" 保留完整配置资料。员工绑定手机后才会获得完整十工具。',inputSchema:{type:'object',properties:{view:{type:'string',enum:['summary','full'],default:'full'}}}},
  {name:'ziwei_install_skill',description:'安装或卸载当前工作区已发现的真实平台技能ID，并保留版本记录；卸载手机技能不删除员工人格、其他技能或手机绑定。',inputSchema:{type:'object',required:['id'],properties:{id:{type:'string'},installed:{type:'boolean',default:true}}}},
  {name:'ziwei_configure_phone_mcp',description:'为当前工作区员工配置已安装手机技能、精确电脑/runtime/profile和手机绑定。不会复制管理员凭据。',inputSchema:{type:'object',required:['id','enabled'],properties:{id:{type:'string'},enabled:{type:'boolean'},phoneDeviceId:{type:'string'},targetDeviceId:{type:'string'},runtime:{type:'string'},runtimeProfile:{type:['string','null']},accountId:{type:'string'},accountLabel:{type:'string'}}}},
  {name:'ziwei_get_phone_mcp_status',description:'回读员工手机技能保存、API、实际MCP加载和本配置手机命令/截图验收结果；不能把配置成功当成实机成功。',inputSchema:{type:'object',required:['id'],properties:{id:{type:'string'}}}},
  {name:'ziwei_check_phone_mcp',description:'创建员工持久会话实际加载手机MCP并读取list/status。此次capability只准只读检测，返回action需回读。',inputSchema:{type:'object',required:['id'],properties:{id:{type:'string'},idempotencyKey:{type:'string'}}}},
  {name:'ziwei_trial_phone_mcp',description:'创建真实员工持久会话执行已绑定手机health或screenshot，返回action需回读commandId/状态/截图；幂等键避免重复试运行。',inputSchema:{type:'object',required:['id'],properties:{id:{type:'string'},action:{type:'string',enum:['health','screenshot']},idempotencyKey:{type:'string'}}}}
].map(tool=>({...tool,inputSchema:{...tool.inputSchema,properties:{...tool.inputSchema.properties,
  ...(['ziwei_create_employee','ziwei_update_employee'].includes(tool.name) ? {
    defaultWorkingDirectory:{type:['string','null'],maxLength:4096,description:'省略保留；null明确清空；非空路径须先在目标电脑检查并传回执，员工新会话继承，旧会话不变。'},
    defaultWorkingDirectoryActionId:{type:'string',description:'目标电脑 ziwei_inspect_workdir succeeded 检查的 action.id；10分钟内有效。'}
  } : {}),
  workspace:{type:'string',description:'可选的明确目标工作区；必须已经在本MCP bearer授权scope中，省略沿用当前工作区。'}}}}));

function phoneSetupSummary(value, workspace) {
  const shortText = (text, maxBytes) => {
    if (typeof text !== 'string') return null;
    if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
    let clipped = '', bytes = 0;
    for (const character of text) {
      const size = Buffer.byteLength(character, 'utf8');
      if (bytes + size > maxBytes - 3) break;
      clipped += character; bytes += size;
    }
    return clipped + '…';
  };
  const apiHealthy = value?.api?.status === 'healthy' && value.api.available !== false && (value.api.error == null || value.api.error === '');
  const hasId = row => row && typeof row === 'object' && !Array.isArray(row) && typeof row.id === 'string' && row.id.trim();
  const validPhones = Array.isArray(value?.phones) && value.phones.every(hasId);
  const phones = new Map();
  if (apiHealthy && validPhones) for (const phone of value.phones) if (!phones.has(phone.id)) phones.set(phone.id, phone);
  const phoneCount = apiHealthy && validPhones ? phones.size : null;
  const arrayCount = entries => Array.isArray(entries) && entries.every(hasId) ? entries.length : null;
  const summary = {
    workspace: shortText(workspace, 128), workspaceTruncated: shortText(workspace, 128) !== workspace,
    counts: { phones: phoneCount, employees: arrayCount(value?.employees), computers: arrayCount(value?.computers) },
    source: 'control_catalog', scope: 'control_catalog',
    phoneCountStatus: phoneCount === null ? 'failed' : 'ready',
    ...(phoneCount === null ? { phoneCountReason: apiHealthy ? 'invalid_phone_directory' : 'phone_api_unavailable' } : {}),
    api: { status: shortText(value?.api?.status, 32) || 'invalid', ...(typeof value?.api?.available === 'boolean' ? { available: value.api.available } : {}), error: shortText(value?.api?.error, 512) },
    phones: [], phoneList: { limit: 20, shown: 0, total: phoneCount, truncated: false, fieldsTruncated: false }
  };
  for (const phone of phones.values()) {
    if (summary.phones.length === 20) break;
    const item = { id: shortText(phone.id, 128), alias: shortText(phone.alias, 96), status: shortText(phone.status, 48) };
    if (['id', 'alias', 'status'].some(key => typeof phone[key] === 'string' && item[key] !== phone[key])) summary.phoneList.fieldsTruncated = true;
    summary.phones.push(item);
  }
  const fits = () => {
    const text = JSON.stringify(summary, null, 2);
    return Buffer.byteLength(text, 'utf8') <= 6 * 1024 && Buffer.byteLength(JSON.stringify(text), 'utf8') <= 7 * 1024;
  };
  while (true) {
    summary.phoneList.shown = summary.phones.length;
    summary.phoneList.truncated = phoneCount !== null && summary.phones.length < phoneCount;
    if (fits()) break;
    if (summary.phones.length === 0) throw new Error('手机目录 summary 超出输出字节预算');
    summary.phones.pop();
  }
  return summary;
}

export function createMcpClient(options = {}) {
  const config = configFromEnv(options);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('当前 Node 环境没有 fetch');
  const workspacePath = `/mcp/v1/workspaces/${encodeURIComponent(config.workspace)}`;
  async function request(method, route, body, query) {
    // The daemon renews this file atomically while a long-running CLI session is alive.
    const current = configFromEnv(options);
    if (current.workspace !== config.workspace || current.baseUrl !== config.baseUrl) throw new Error('管理 MCP 凭据配置变化，请重新建立本次会话');
    const selectedWorkspace=String(body?.workspace || query?.workspace || config.workspace).trim();
    if(!/^[a-z0-9][a-z0-9_-]{1,62}$/i.test(selectedWorkspace)) throw new Error('MCP 工作区标识无效');
    if (current.managed && selectedWorkspace !== current.workspace) throw new Error('自动管理 MCP 只能访问当前已连接工作区');
    route=route.replace(/^\/mcp\/v1\/workspaces\/[^/]+/,`/mcp/v1/workspaces/${encodeURIComponent(selectedWorkspace)}`);
    if(body && Object.hasOwn(body,'workspace')) {const {workspace:_workspace,...value}=body;body=value;}
    if(query && Object.hasOwn(query,'workspace')) {const {workspace:_workspace,...value}=query;query=value;}
    const url = new URL(`${config.baseUrl}${route}`);
    for (const [key, value] of Object.entries(query || {})) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    const headers = { authorization: `Bearer ${current.token}`, accept: 'application/json' };
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
    async bot(input={}) {
      const {operation,id,routineId,connectionId,deviceId,workspace}=input,body={...(input.data || {}),...(workspace?{workspace}:{})};
      const base=`${workspacePath}/bots`,item=`${base}/${encodeURIComponent(id || '')}`;
      if(['initialize','get','update','provision','validate','control','runs','routines','createRoutine','updateRoutine','deleteRoutine','runRoutine','native','collaboration','mcpConnections','connectMcp','cancelMcpConnection'].includes(operation)&&!id)throw new Error('Bot 操作需要 id');
      if(['mcpConnections','connectMcp','cancelMcpConnection'].includes(operation)&&(typeof id!=='string'||!id.trim()))throw new Error('Bot 操作需要 id');
      if(operation==='cancelMcpConnection'&&(typeof connectionId!=='string'||!connectionId.trim()))throw new Error('取消 MCP 连接需要 connectionId');
      if(['updateRoutine','deleteRoutine','runRoutine'].includes(operation)&&!routineId)throw new Error('Routine 操作需要 routineId');
      const paths={mcpConnections:['GET',`${item}/mcp/connections`],connectMcp:['POST',`${item}/mcp/connections`],cancelMcpConnection:['DELETE',`${item}/mcp/connections/${encodeURIComponent(connectionId)}`],native:['POST',`${item}/native/actions`],collaboration:['POST',`${item}/collaboration`],capabilities:['GET',`${base}/capabilities`],list:['GET',base],create:['POST',base],initialize:['POST',`${workspacePath}/employees/${encodeURIComponent(id || '')}/bot`],get:['GET',item],provision:['POST',`${item}/provision`],update:['PATCH',item],validate:['POST',`${item}/validate`],control:['POST',`${item}/control`],runs:['GET',`${item}/runs`],routines:['GET',`${item}/routines`],createRoutine:['POST',`${item}/routines`],updateRoutine:['PATCH',`${item}/routines/${encodeURIComponent(routineId)}`],deleteRoutine:['DELETE',`${item}/routines/${encodeURIComponent(routineId)}`],runRoutine:['POST',`${item}/routines/${encodeURIComponent(routineId)}/run`]};
      if(!paths[operation])throw new Error('未知 Bot operation');const [method,url]=paths[operation];return request(method,url,method==='GET'?undefined:body,{workspace,...(deviceId?{deviceId}:{})});
    },
    async inspectWorkdir(input) {const {deviceId,...body}=input;return request('POST',`${workspacePath}/devices/${encodeURIComponent(deviceId)}/workdir/inspect`,body);},
    async createConversation(input) {return request('POST',`${workspacePath}/conversations`,input);},
    async health(input={}) { return request('GET', `${workspacePath}/health`,undefined,input); },
    async discoverEnvironment(input) { return request('GET', `${workspacePath}/discovery`, undefined, input); },
    async getEmployee(input) { return request('GET', `${workspacePath}/employees/${encodeURIComponent(input.id)}`,undefined,{workspace:input.workspace}); },
    async getEmployeeMcpStatus(input) { return request('GET', `${workspacePath}/employees/${encodeURIComponent(input.id)}/mcp/status`,undefined,{workspace:input.workspace}); },
    async getEmployeeCapabilities(input) {return request('GET',`${workspacePath}/employees/${encodeURIComponent(input.id)}/capability-inventory`,undefined,{workspace:input.workspace});},
    async getEmployeePlugins(input) {return request('GET',`${workspacePath}/employees/${encodeURIComponent(input.id)}/plugins`,undefined,{workspace:input.workspace});},
    async refreshEmployeePlugins(input) {const{id,...body}=input;return request('POST',`${workspacePath}/employees/${encodeURIComponent(id)}/plugins/refresh`,body);},
    async applyEmployeePlugins(input) {const{id,...body}=input;return request('PUT',`${workspacePath}/employees/${encodeURIComponent(id)}/plugins`,body);},
    async reportEmployeeCapabilities(input) {const{id,...body}=input;return request('POST',`${workspacePath}/employees/${encodeURIComponent(id)}/capability-inventory/reports`,body);},
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
    async phoneMcpSetup(input={}) {
      const { view = 'full', ...query } = input;
      if (!['summary', 'full'].includes(view)) throw new Error('手机目录 view 必须是 summary 或 full');
      const value = await request('GET', `${workspacePath}/phone-mcp/setup`, undefined, query);
      return view === 'summary' ? phoneSetupSummary(value, String(query.workspace || config.workspace).trim()) : value;
    },
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
    ziwei_bot:args=>client.bot(args),
    ziwei_inspect_workdir:args=>client.inspectWorkdir(args),
    ziwei_create_conversation:args=>client.createConversation(args),
    ziwei_mcp_health: args => client.health(args),
    ziwei_discover_environment: args => client.discoverEnvironment(args),
    ziwei_get_employee: args => client.getEmployee(args),
    ziwei_get_employee_mcp_status: args => client.getEmployeeMcpStatus(args),
    ziwei_get_employee_capabilities: args => client.getEmployeeCapabilities(args),
    ziwei_get_employee_plugins: args => client.getEmployeePlugins(args),
    ziwei_refresh_employee_plugins: args => client.refreshEmployeePlugins(args),
    ziwei_apply_employee_plugins: args => client.applyEmployeePlugins(args),
    ziwei_report_employee_capabilities: args => client.reportEmployeeCapabilities(args),
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
