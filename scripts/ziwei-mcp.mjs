#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const PROTOCOL_VERSION = '2024-11-05';
const DEFAULT_API_BASE = process.env.ZIWEI_API_BASE || 'http://127.0.0.1:4178';

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
  if (!['http:', 'https:'].includes(baseUrl.protocol)) throw new Error('MCP API 地址必须使用 HTTP(S)');
  return { token, workspace, baseUrl: baseUrl.toString().replace(/\/$/, '') };
}

function objectArguments(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('工具参数必须是 JSON 对象');
  return value;
}

const toolDefinitions = [
  { name: 'ziwei_list_employees', description: '列出指定紫薇工作区的数字员工。', inputSchema: { type: 'object', properties: {} } },
  { name: 'ziwei_create_employee', description: '通过紫薇管理 API 创建数字员工。', inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, runtime: { type: 'string' }, runtimeProfile: { type: 'string' }, description: { type: 'string' }, instructions: { type: 'string' }, visibility: { type: 'string', enum: ['workspace', 'personal'] }, skills: { type: 'array', items: { type: 'string' } } } } },
  { name: 'ziwei_update_employee', description: '通过紫薇管理 API 更新已有数字员工。', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, name: { type: 'string' }, runtime: { type: 'string' }, runtimeProfile: { type: 'string' }, description: { type: 'string' }, instructions: { type: 'string' }, status: { type: 'string' }, visibility: { type: 'string' }, skills: { type: 'array', items: { type: 'string' } } } } },
  { name: 'ziwei_list_tasks', description: '列出指定紫薇工作区的任务。', inputSchema: { type: 'object', properties: { state: { type: 'string' }, assignee: { type: 'string' }, q: { type: 'string' } } } },
  { name: 'ziwei_create_task', description: '通过紫薇管理 API 创建任务，可指定数字员工执行。', inputSchema: { type: 'object', required: ['title'], properties: { title: { type: 'string' }, description: { type: 'string' }, assignee: { type: 'string' }, runtime: { type: 'string' }, runtimeProfile: { type: 'string' }, execute: { type: 'boolean' }, priority: { type: 'string' }, labels: { type: 'array', items: { type: 'string' } } } } },
  { name: 'ziwei_list_documents', description: '列出指定紫薇工作区的文档。', inputSchema: { type: 'object', properties: {} } },
  { name: 'ziwei_read_document', description: '读取紫薇工作区内的文档。', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  { name: 'ziwei_write_document', description: '在紫薇工作区创建文档，或更新已有文档。', inputSchema: { type: 'object', required: ['name'], properties: { id: { type: 'string' }, name: { type: 'string' }, type: { type: 'string' }, content: { type: 'string' }, mimeType: { type: 'string' }, parentId: { type: 'string' } } } }
];

export function createMcpClient(options = {}) {
  const config = configFromEnv(options);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('当前 Node 环境没有 fetch');
  const workspacePath = `/mcp/v1/workspaces/${encodeURIComponent(config.workspace)}`;
  async function request(method, route, body, query) {
    const url = new URL(`${config.baseUrl}${route}`);
    for (const [key, value] of Object.entries(query || {})) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    const headers = { authorization: `Bearer ${config.token}`, accept: 'application/json' };
    const init = { method, headers };
    if (body !== undefined) { headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
    const response = await fetchImpl(url, init);
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
    if (!response.ok) throw new Error(String(payload?.error || `紫薇 API 返回 HTTP ${response.status}`));
    return payload;
  }
  return {
    async listEmployees() { return request('GET', `${workspacePath}/employees`); },
    async createEmployee(input) { return request('POST', `${workspacePath}/employees`, input); },
    async updateEmployee(input) { const { id, ...patch } = input; return request('PATCH', `${workspacePath}/employees/${encodeURIComponent(id)}`, patch); },
    async listTasks(input) { return request('GET', `${workspacePath}/tasks`, undefined, input); },
    async createTask(input) { return request('POST', `${workspacePath}/tasks`, input); },
    async listDocuments() { return request('GET', `${workspacePath}/documents`); },
    async readDocument(input) { return request('GET', `/mcp/v1/documents/${encodeURIComponent(input.id)}`); },
    async writeDocument(input) {
      if (input.id) { const { id, ...patch } = input; return request('PATCH', `/mcp/v1/documents/${encodeURIComponent(id)}`, patch); }
      return request('POST', `${workspacePath}/documents`, input);
    }
  };
}

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

export function createMcpHandler(client) {
  const calls = {
    ziwei_list_employees: args => client.listEmployees(args),
    ziwei_create_employee: args => client.createEmployee(args),
    ziwei_update_employee: args => client.updateEmployee(args),
    ziwei_list_tasks: args => client.listTasks(args),
    ziwei_create_task: args => client.createTask(args),
    ziwei_list_documents: args => client.listDocuments(args),
    ziwei_read_document: args => client.readDocument(args),
    ziwei_write_document: args => client.writeDocument(args)
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
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let message;
    try { message = JSON.parse(line); } catch { output.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: '无效 JSON' } })}\n`); continue; }
    const response = await handler(message);
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
