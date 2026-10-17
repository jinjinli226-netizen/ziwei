// The normalized Bot config is the only source of external MCP identities.
// OAuth token stores are keyed by profile HOME and server name, so OAuth names
// must remain stable; older header/stdio integrations retain their namespace.
// Hermes treats these aliases as builtin toolsets even after registering an MCP
// alias of the same name. Reject collisions instead of enabling builtin tools
// through an external server name. The native boundary rechecks its own version.
export const HERMES_BUILTIN_TOOLSET_NAMES=Object.freeze(['all','web','search','x_search','vision','video','image_gen','video_gen','computer_use','terminal','skills','browser','cronjob','file','tts','todo','memory','context_engine','session_search','connections','project','bot_room','desktop_ui','clarify','code_execution','delegation','homeassistant','kanban','discord','discord_admin','yuanbao','feishu_doc','feishu_drive','spotify','debugging','safe','coding','hermes-acp','hermes-api-server','hermes-cli','hermes-cron','hermes-telegram','hermes-discord','hermes-whatsapp','hermes-slack','hermes-signal','hermes-bluebubbles','hermes-homeassistant','hermes-email','hermes-mattermost','hermes-matrix','hermes-dingtalk','hermes-feishu','hermes-weixin','hermes-qqbot','hermes-wecom','hermes-wecom-callback','hermes-yuanbao','hermes-sms','hermes-webhook','hermes-gateway']);
export const hermesMcpNameConflicts=name=>HERMES_BUILTIN_TOOLSET_NAMES.includes(name);

export function hermesMcpServerName(logicalName,server) {
  if(typeof logicalName!=='string'||!/^[a-z][a-z0-9_-]{0,63}$/.test(logicalName)||logicalName.startsWith('ziwei'))throw new Error('Invalid external MCP server name');
  if(server?.auth==='oauth'&&hermesMcpNameConflicts(logicalName))throw Object.assign(new Error('OAuth MCP name conflicts with a native toolset; choose another logical name'),{code:'BOT_MCP_NAME_CONFLICT'});
  return server?.auth==='oauth'?logicalName:'ziwei_external_'+logicalName;
}

export function enabledHermesMcpServerNames(config) {
  if(config?.permissions?.mode==='read_only')return [];
  return Object.entries(config?.mcpServers||{}).filter(([,server])=>server.enabled!==false).map(([name,server])=>hermesMcpServerName(name,server));
}

export function hermesBotToolsets(config,{management=false}={}) {
  if(config?.permissions?.mode==='read_only')return [];
  return [...new Set([...(config?.toolsets||[]),...(config?.collaboration?.enabled?['ziwei_collaboration']:[]),...(management?['ziwei_management']:[]),...enabledHermesMcpServerNames(config)])];
}

export function nativeHermesMcpServers(config) {
  if(config?.permissions?.mode==='read_only')return {};
  return Object.fromEntries(Object.entries(config?.mcpServers||{}).map(([name,{connectTimeout,supportsParallelToolCalls,...server}])=>[
    hermesMcpServerName(name,server),
    {...server,...(connectTimeout!==undefined?{connect_timeout:connectTimeout}:{}),...(supportsParallelToolCalls!==undefined?{supports_parallel_tool_calls:supportsParallelToolCalls}:{})}
  ]));
}
