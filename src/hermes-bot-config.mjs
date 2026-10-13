// Shared wire validation: never forward unknown fields to a native runtime.
export const BOT_SCHEMA_VERSION = 1;
export const BOT_REASONING_EFFORTS=['minimal','low','medium','high','xhigh','max','ultra'];
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
export const permittedCredentialName=name=>typeof name==='string'&&/^[A-Z][A-Z0-9_]*$/.test(name)&&! /^(ZIWEI_|CONTROL_MCP_|HERMES_|PYTHON|NODE_OPTIONS$|HOME$|USERPROFILE$)/.test(name);
export function normalizeBotConfig(input = {}) {
  validateCredentialPlaceholders(input);
  keys(input, ['provider','reasoningEffort','toolsets','maxTurns','memory','skills','mcpServers','permissions','gateway','voice','collaboration','drivers'], 'Bot config');
  if(Object.hasOwn(input,'reasoningEffort')&&!BOT_REASONING_EFFORTS.includes(input.reasoningEffort))throw botFailure('BOT_CONFIG_INVALID','reasoningEffort 必须为明确的原生等级：'+BOT_REASONING_EFFORTS.join(', '),400);
  const provider = input.provider ?? null;
  if (provider !== null && (typeof provider !== 'string' || !/^[A-Za-z0-9_.:-]{1,100}$/.test(provider))) throw botFailure('BOT_CONFIG_INVALID', 'provider 必须是原生服务商名称', 400);
  const maxTurns = input.maxTurns ?? 20;
  if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 100) throw botFailure('BOT_CONFIG_INVALID', 'maxTurns 必须为 1–100', 400);
  const memory = input.memory ?? {}; keys(memory, ['enabled','userProfile','charLimit','userCharLimit'], 'memory');
  const skills = input.skills ?? {}; keys(skills, ['disabled','autoLoad'], 'skills');
  const permissions = input.permissions ?? {}; keys(permissions, ['mode','management'], 'permissions');
  const mode = permissions.mode ?? 'read_only';
  if (!['read_only','execute'].includes(mode)) throw botFailure('BOT_CONFIG_UNSUPPORTED','permissions.mode 仅支持 read_only 或 execute',400);
  const servers = input.mcpServers ?? {}; if (!object(servers) || Object.keys(servers).length > 20) throw botFailure('BOT_CONFIG_INVALID','mcpServers 必须是最多20个服务的映射',400);
  const mcpServers = {};
  for (const [name, server] of Object.entries(servers)) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(name) || name.startsWith('ziwei')) throw botFailure('BOT_CONFIG_INVALID','MCP 名称无效或使用了紫薇保留名称',400);
    keys(server,['transport','command','args','env','enabled','url','headers','timeout','connectTimeout','tools'],`mcpServers.${name}`);
    const transport=server.transport || (server.url?'http':'stdio');
    if(!['stdio','http','sse'].includes(transport))throw botFailure('BOT_CONFIG_INVALID','MCP transport 无效',400);
    if(transport==='stdio'&&(typeof server.command !== 'string' || !server.command.trim() || server.command.length > 4096 || /[\r\n\0]/.test(server.command)))throw botFailure('BOT_CONFIG_INVALID','MCP command 无效',400);
    const args=server.args || [];
    if (!Array.isArray(args) || args.length > 100 || args.some(arg => typeof arg !== 'string' || arg.length > 4096 || /[\0\r\n]/.test(arg))) throw botFailure('BOT_CONFIG_INVALID','MCP args 必须为字符串数组',400);
    if(transport!=='stdio')safeEndpoint(server.url,'MCP url');
    const env = server.env ?? {}; if (!object(env)) throw botFailure('BOT_CONFIG_INVALID','MCP env 必须是映射',400);
    for (const [key,value] of Object.entries(env)) if (!permittedCredentialName(key) || !/^\$\{[A-Z][A-Z0-9_]*\}$/.test(value) || !permittedCredentialName(value.slice(2,-1))) throw botFailure('BOT_SECRET_REFERENCE_REQUIRED','MCP env 仅接收本机 ${ENV_NAME} 引用；不保存密钥或引用紫薇内部凭据',400);
    const headers=references(server.headers || {},'MCP headers');
    const filters=server.tools || {};keys(filters,['include','exclude'],'MCP tools');
    const tools=Object.fromEntries(Object.entries(filters).map(([key,list])=>[key,patterns(list,'MCP tool filter')]));
    mcpServers[name] = {...(transport==='stdio'?{command:server.command,args:[...args]}:{transport,url:server.url,headers}),env:{...env},enabled:bool(server.enabled,true,'MCP enabled'),...(Object.keys(tools).length?{tools}:{}),...(server.timeout!==undefined?{timeout:bounded(server.timeout,1,120,'MCP timeout')}:{}),...(server.connectTimeout!==undefined?{connectTimeout:bounded(server.connectTimeout,1,60,'MCP connectTimeout')}:{})};
  }
  const toolsets = names(input.toolsets ?? [], 'toolsets');
  // A requested autonomous scheduler may not compete with Ziwei's single authority.
  if (toolsets.some(name => /^(all|cron|heartbeat|goals|kanban|delegate|delegation|bot|bot_mode)$/i.test(name))) throw botFailure('BOT_SCHEDULER_AUTHORITY','该工具集包含尚未接入统一控制的自主执行能力；请选择已接入的具体工具集',400);
  if (mode === 'read_only' && (toolsets.length || Object.values(mcpServers).some(server => server.enabled))) throw botFailure('BOT_PERMISSION_CONFLICT','read_only 只允许无工具对话；使用工具或 MCP 请明确选择 execute',400);
  const result={provider,toolsets,maxTurns,memory:{enabled:bool(memory.enabled,true,'memory.enabled'),userProfile:bool(memory.userProfile,true,'memory.userProfile'),...(memory.charLimit!==undefined?{charLimit:bounded(memory.charLimit,100,50000,'memory.charLimit')}:{}),...(memory.userCharLimit!==undefined?{userCharLimit:bounded(memory.userCharLimit,100,50000,'memory.userCharLimit')}:{})},skills:{disabled:names(skills.disabled ?? [],'skills.disabled'),...(skills.autoLoad!==undefined?{autoLoad:names(skills.autoLoad,'skills.autoLoad')}:{})},mcpServers,permissions:{mode,...(permissions.management!==undefined?{management:bool(permissions.management,true,'permissions.management')}:{})}};
  if(input.reasoningEffort!==undefined)result.reasoningEffort=input.reasoningEffort;
  if(input.gateway!==undefined)result.gateway=normalizeGateway(input.gateway);
  if(input.voice!==undefined)result.voice=normalizeVoice(input.voice);
  if(input.collaboration!==undefined){keys(input.collaboration,['enabled','targetEmployeeIds'],'collaboration');result.collaboration={enabled:bool(input.collaboration.enabled,false,'collaboration.enabled'),targetEmployeeIds:names(input.collaboration.targetEmployeeIds || [],'collaboration.targetEmployeeIds')};}
  if(input.drivers!==undefined){keys(input.drivers,['maxTotalTurns','expiresAt'],'drivers');result.drivers={maxTotalTurns:bounded(input.drivers.maxTotalTurns ?? 100,1,1000,'drivers.maxTotalTurns'),expiresAt:input.drivers.expiresAt || null};if(result.drivers.expiresAt&&!Number.isFinite(Date.parse(result.drivers.expiresAt)))throw botFailure('BOT_CONFIG_INVALID','drivers.expiresAt 无效',400);}
  return result;
}

function validateCredentialPlaceholders(value,path=[]) {
  if(value&&typeof value==='object'){for(const [key,item] of Object.entries(value))validateCredentialPlaceholders(item,[...path,key]);return;}
  if(typeof value!=='string'||!value.includes('${'))return;
  const credential=path[0]==='mcpServers'&&['env','headers'].includes(path[2])||path[0]==='gateway'&&path[1]==='platforms'&&(path.includes('envRefs')||path.includes('extra')&&/(?:secret|token|password|api_key|authorization|app_id)$/i.test(path.at(-1)));
  if(!credential||!/^\$\{[A-Z][A-Z0-9_]*\}$/.test(value)||!permittedCredentialName(value.slice(2,-1)))throw botFailure('BOT_SECRET_REFERENCE_REQUIRED','变量引用仅允许出现在明确的凭据字段中；禁止嵌入式或内部凭据引用',400);
}

function bounded(value,min,max,label){if(!Number.isInteger(value)||value<min||value>max)throw botFailure('BOT_CONFIG_INVALID',`${label} 必须为${min}–${max}`,400);return value;}
function patterns(value,label){if(!Array.isArray(value)||value.length>100||value.some(v=>typeof v!=='string'||v.length>160||/[\0\r\n]/.test(v)))throw botFailure('BOT_CONFIG_INVALID',`${label} 无效`,400);return [...new Set(value)];}
function safeEndpoint(value,label){try{const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash)throw new Error();return value;}catch{throw botFailure('BOT_CONFIG_INVALID',`${label} 无效或含凭据`,400);}}
function references(value,label){if(!object(value)||Object.keys(value).length>40)throw botFailure('BOT_CONFIG_INVALID',`${label} 无效`,400);for(const [key,v] of Object.entries(value))if(!/^[A-Za-z][A-Za-z0-9_-]{0,100}$/.test(key)||(!/^\$\{[A-Z][A-Z0-9_]*\}$/.test(v)||!permittedCredentialName(v.slice(2,-1))))throw botFailure('BOT_SECRET_REFERENCE_REQUIRED',`${label} 仅保存本机环境变量引用`,400);return {...value};}
function normalizeVoice(value){keys(value,['stt','tts'],'voice');const result={};for(const kind of ['stt','tts'])if(value[kind]!==undefined){const v=value[kind];keys(v,['enabled','provider','model','baseUrl','keyEnv','voice','language'],`voice.${kind}`);if(typeof v.provider!=='string'||!/^[a-z][a-z0-9_-]{0,63}$/.test(v.provider))throw botFailure('BOT_CONFIG_INVALID','voice provider 无效',400);if(v.baseUrl)safeEndpoint(v.baseUrl,'voice baseUrl');if(v.keyEnv&&!permittedCredentialName(v.keyEnv))throw botFailure('BOT_SECRET_REFERENCE_REQUIRED','voice keyEnv 必须为本机变量名',400);for(const field of ['model','voice','language'])if(v[field]!==undefined&&(typeof v[field]!=='string'||v[field].length>160||/[\0\r\n]/.test(v[field])))throw botFailure('BOT_CONFIG_INVALID','voice 参数无效',400);result[kind]={...v,enabled:bool(v.enabled,true,`voice.${kind}.enabled`)};}return result;}
function envReferenceMap(value){const result=references(value,'Gateway envRefs');if(Object.keys(result).some(key=>!permittedCredentialName(key)))throw botFailure('BOT_SECRET_REFERENCE_REQUIRED','Gateway envRefs 不能覆盖内部变量',400);return result;}
function normalizeGateway(value){keys(value,['platforms','profileRoutes'],'gateway');if(!object(value.platforms || {}))throw botFailure('BOT_CONFIG_INVALID','gateway.platforms 无效',400);const platforms={};for(const [name,v] of Object.entries(value.platforms || {})){if(!/^[a-z][a-z0-9_]{0,63}$/.test(name))throw botFailure('BOT_CONFIG_INVALID','gateway platform 无效',400);keys(v,['enabled','tokenEnv','envRefs','extra','allowedUsers'],'gateway platform');if(v.tokenEnv&&!permittedCredentialName(v.tokenEnv))throw botFailure('BOT_SECRET_REFERENCE_REQUIRED','gateway tokenEnv 必须为本机变量名',400);const extra=v.extra || {};if(!object(extra)||JSON.stringify(extra).length>50000)throw botFailure('BOT_CONFIG_INVALID','gateway extra 无效',400);const check=item=>{for(const [k,v] of Object.entries(item)){if(/(?:secret|token|password|api_key|authorization)$/i.test(k)&&(!/^\$\{[A-Z][A-Z0-9_]*\}$/.test(v)||!permittedCredentialName(v.slice(2,-1))))throw botFailure('BOT_SECRET_REFERENCE_REQUIRED','Gateway 凭据仅保存本机环境引用',400);if(v&&typeof v==='object')check(v);}};check(extra);if(name==='webhook'){if(extra.host&&!['127.0.0.1','localhost','::1'].includes(extra.host))throw botFailure('BOT_CONFIG_INVALID','Bot webhook 只允许本机监听',400);if(extra.port!==undefined)bounded(extra.port,1024,65535,'webhook port');for(const route of Object.values(extra.routes || {}))if(route.cron_job||route.script||route.deliver_only||route.coalesce||route.profile)throw botFailure('BOT_SCHEDULER_AUTHORITY','Webhook route 必须进入紫薇受控处理器',400);}platforms[name]={...v,...(v.envRefs?{envRefs:envReferenceMap(v.envRefs)}:{ }),extra:structuredClone(extra),enabled:bool(v.enabled,false,'gateway enabled'),allowedUsers:patterns(v.allowedUsers || [],'gateway allowedUsers')};}const routes=value.profileRoutes || [];if(!Array.isArray(routes)||routes.length>100)throw botFailure('BOT_CONFIG_INVALID','gateway profileRoutes 无效',400);for(const route of routes){keys(route,['name','platform','chat_id','thread_id','guild_id','enabled'],'gateway route');for(const key of ['chat_id','thread_id','guild_id'])if(route[key]!==undefined&&typeof route[key]!=='string')throw botFailure('BOT_CONFIG_INVALID','Gateway ID 必须为字符串',400);}return{platforms,profileRoutes:structuredClone(routes)};}

export const BOT_CAPABILITY_CATALOG = [
  ['bot_identity','Bot 身份与岗位'],['persistent_chat','持久主聊天'],['profile_memory','独立原生记忆'],['model_provider','模型与服务商'],['skills','技能'],['tools_mcp','工具与 MCP'],['routines','定时 Routine'],
  ['groups_mentions','群聊与 @提及'],['delegation','Bot 委派'],['gateway','外部消息 Gateway'],['voice','语音'],['multimodal','多模态'],['session_search','会话检索'],['goals','Goals'],['heartbeat','Heartbeat'],['kanban','Kanban'],['observability','运行记录']
];
