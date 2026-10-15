const isHermes = employee => String(employee?.runtime || '').toLowerCase() === 'hermes';
const sameBot = (bot, employee, workspace) => bot?.id === employee?.id && bot?.workspace === workspace;

export function phoneBotActivityHref(workspace, employeeId) {
  return workspace && employeeId ? `/${encodeURIComponent(workspace)}/bots/${encodeURIComponent(employeeId)}?section=activity` : '';
}

export async function readPhoneSkillBot(api, employee, workspace) {
  if (!isHermes(employee)) return { kind:'none' };
  try {
    const bot = await api.bot(employee.id, workspace);
    if (!sameBot(bot, employee, workspace)) throw new Error('返回的 Bot 与当前工作区或员工不一致，请刷新状态。');
    if (!['initialized','uninitialized'].includes(bot.configuration_state)) throw new Error('Bot 状态不完整，请刷新状态。');
    return { kind:bot.configuration_state,bot };
  } catch (error) {
    return { kind:'error',error:error.message || 'Bot 状态读取失败',code:error.code || '',status:error.status || null };
  }
}

export function phoneBotReadiness(state, { employee,workspace,savedFromActive=false } = {}) {
  if (!isHermes(employee)) return { ready:true,reason:'',href:'' };
  const href = phoneBotActivityHref(workspace,employee.id);
  const blocked = reason => ({ ready:false,reason,href,label:'前往检查并启用' });
  if (!state) return blocked('正在读取 Bot 状态，读取完成后才能检测手机 MCP。');
  if (state.kind === 'error') return blocked(`无法确认 Bot 状态：${state.error}。请刷新配置状态后重试。`);
  if (!sameBot(state.bot,employee,workspace)) return blocked('Bot 状态与当前员工不匹配，请刷新配置状态。');
  if (state.kind === 'uninitialized') return { ready:true,reason:'',href:'' };
  const bot = state.bot;
  if (state.kind !== 'initialized') return blocked('尚未确认 Bot 配置，请刷新配置状态。');
  if (bot.config?.permissions?.mode !== 'execute') return { ...blocked('请先允许使用工具，再检测手机 MCP。'),href:href.replace('section=activity','section=capabilities'),label:'前往允许使用工具' };
  if (bot.validation?.status === 'pending') return blocked('Bot 配置检查中。检查完成并启用后，再检测手机 MCP。');
  if (bot.validation?.status === 'failed') return blocked(`Bot 配置检查失败${bot.validation.error ? `：${bot.validation.error}` : '，请重新检查配置'}。`);
  if (bot.control_state === 'paused') return { ...blocked('Bot 已暂停。请先检查并恢复 Bot，再检测手机 MCP。'),label:'前往检查并恢复' };
  if (bot.control_state !== 'active') return blocked(savedFromActive ? '手机配置已保存，Bot 需要检查并重新启用后才能检测。' : 'Bot 尚未启用。请先检查并启用 Bot，再检测手机 MCP。');
  if (!Number.isInteger(bot.revision) || bot.validation?.status !== 'succeeded' || bot.validation.revision !== bot.revision) return blocked('Bot 当前配置尚未检查通过。请先检查配置，再检测手机 MCP。');
  return { ready:true,reason:'',href:'' };
}
