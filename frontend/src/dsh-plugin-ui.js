export const DSH_PLUGIN_UI_CHANNEL = 'dshbot-plugin-ui';
export const DSH_PLUGIN_UI_VERSION = 1;

export function dshPluginUiMessage(value, {botName, viewKey, source, expectedSource, origin, expectedOrigin} = {}) {
  if (!value || typeof value !== 'object' || value.channel !== DSH_PLUGIN_UI_CHANNEL || value.version !== DSH_PLUGIN_UI_VERSION) return false;
  if (typeof botName === 'string' && value.botName !== botName) return false;
  if (typeof viewKey === 'string' && value.viewKey !== viewKey) return false;
  if (expectedSource && source !== expectedSource) return false;
  if (expectedOrigin && origin !== expectedOrigin) return false;
  return ['ready', 'catalog', 'status'].includes(value.type);
}

export function dshPluginUiRelayUrl(relay) {
  const path = String(relay?.originPath || '');
  if (!/^\/runtime\/[A-Za-z0-9._~%-]+\/ui\/$/.test(path) || path.includes('..')) throw new Error('DSH 插件工作区路径无效');
  const params = new URLSearchParams({ dshPluginUiRelay: String(relay.relayId || ''), viewKey: String(relay.viewKey || '') });
  if (relay.botName) params.set('botName', String(relay.botName));
  return `${path}?${params}`;
}

export function dshPluginUiBotName(employee) {
  return String(employee?.runtime_profile || employee?.name || '').trim();
}
