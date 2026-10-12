// Shared wire validation: never forward unknown fields to a native runtime.
export const BOT_SCHEMA_VERSION = 1;
export function botFailure(code, message, status = 409) { return Object.assign(new Error(message), { code, status }); }
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function keys(value, allowed, label) {
  if (!object(value)) throw botFailure('BOT_CONFIG_INVALID', `${label} 必须是对象`, 400);
  const unknown = Object.keys(value).filter(key => !allowed.includes(key));
  if (unknown.length) throw botFailure('BOT_CONFIG_UNSUPPORTED', `${label} 未支持字段：${unknown.join(', ')}；未保存或忽略参数`, 400);
}
const names = (value, label) => {
  if (!Array.isArray(value) || value.length > 100 || value.some(item => typeof item !== 'string' || !/^[A-Za-z0-9_.:/-]{1,160}$/.test(item))) throw botFailure('BOT_CONFIG_INVALID', `${label} 必须是安全名称数组`, 400);
  return [...new Set(value)];
};
const bool = (value, fallback, label) => { if (value === undefined) return fallback; if (typeof value !== 'boolean') throw botFailure('BOT_CONFIG_INVALID', `${label} 必须是布尔值`, 400); return value; };
export function normalizeBotConfig(input = {}) {
  keys(input, ['provider','toolsets','maxTurns','memory','skills','mcpServers','permissions'], 'Bot config');
  const provider = input.provider ?? null;
  if (provider !== null && (typeof provider !== 'string' || !/^[A-Za-z0-9_.:-]{1,100}$/.test(provider))) throw botFailure('BOT_CONFIG_INVALID', 'provider 必须是原生服务商名称', 400);
  const maxTurns = input.maxTurns ?? 20;
  if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 100) throw botFailure('BOT_CONFIG_INVALID', 'maxTurns 必须为 1–100', 400);
  const memory = input.memory ?? {}; keys(memory, ['enabled','userProfile'], 'memory');
  const skills = input.skills ?? {}; keys(skills, ['disabled'], 'skills');
  const permissions = input.permissions ?? {}; keys(permissions, ['mode'], 'permissions');
  const mode = permissions.mode ?? 'read_only';
  if (!['read_only','execute'].includes(mode)) throw botFailure('BOT_CONFIG_UNSUPPORTED','permissions.mode 仅支持 read_only 或 execute',400);
  const servers = input.mcpServers ?? {}; if (!object(servers) || Object.keys(servers).length > 20) throw botFailure('BOT_CONFIG_INVALID','mcpServers 必须是最多20个服务的映射',400);
  const mcpServers = {};
  for (const [name, server] of Object.entries(servers)) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(name) || name.startsWith('ziwei')) throw botFailure('BOT_CONFIG_INVALID','MCP 名称无效或使用了紫薇保留名称',400);
    keys(server,['command','args','env','enabled'],`mcpServers.${name}`);
    if (typeof server.command !== 'string' || !server.command.trim() || server.command.length > 4096 || /[\r\n\0]/.test(server.command)) throw botFailure('BOT_CONFIG_INVALID','MCP command 无效',400);
    if (!Array.isArray(server.args) || server.args.length > 100 || server.args.some(arg => typeof arg !== 'string' || arg.length > 4096 || /[\0\r\n]/.test(arg))) throw botFailure('BOT_CONFIG_INVALID','MCP args 必须为字符串数组',400);
    const env = server.env ?? {}; if (!object(env)) throw botFailure('BOT_CONFIG_INVALID','MCP env 必须是映射',400);
    for (const [key,value] of Object.entries(env)) if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(key) || key.startsWith('ZIWEI_') || !/^\$\{[A-Z][A-Z0-9_]*\}$/.test(value)) throw botFailure('BOT_SECRET_REFERENCE_REQUIRED','MCP env 仅接收本机 ${ENV_NAME} 引用；不在服务端保存密钥或覆盖紫薇凭据',400);
    mcpServers[name] = {command:server.command,args:[...server.args],env:{...env},enabled:bool(server.enabled,true,'MCP enabled')};
  }
  const toolsets = names(input.toolsets ?? [], 'toolsets');
  // A requested autonomous scheduler may not compete with Ziwei's single authority.
  if (toolsets.some(name => /^(all|cron|heartbeat|goals|kanban|delegate|delegation|bot|bot_mode)$/i.test(name))) throw botFailure('BOT_SCHEDULER_AUTHORITY','该工具集包含尚未接入统一控制的自主执行能力；请选择已接入的具体工具集',400);
  if (mode === 'read_only' && (toolsets.length || Object.values(mcpServers).some(server => server.enabled))) throw botFailure('BOT_PERMISSION_CONFLICT','read_only 只允许无工具对话；使用工具或 MCP 请明确选择 execute',400);
  return {provider,toolsets,maxTurns,memory:{enabled:bool(memory.enabled,true,'memory.enabled'),userProfile:bool(memory.userProfile,true,'memory.userProfile')},skills:{disabled:names(skills.disabled ?? [],'skills.disabled')},mcpServers,permissions:{mode}};
}

export const BOT_CAPABILITY_CATALOG = [
  ['bot_identity','Bot 身份与岗位'],['persistent_chat','持久主聊天'],['profile_memory','独立原生记忆'],['model_provider','模型与服务商'],['skills','技能'],['tools_mcp','工具与 MCP'],['routines','定时 Routine'],
  ['groups_mentions','群聊与 @提及'],['delegation','Bot 委派'],['gateway','外部消息 Gateway'],['voice','语音'],['multimodal','多模态'],['session_search','会话检索'],['goals','Goals'],['heartbeat','Heartbeat'],['kanban','Kanban'],['observability','运行记录']
];
