// A request owns a particular visit, not just a pair of IDs. Returning to a
// previously viewed Bot must never revive an old save or overwrite new edits.
export function createBotRequestScope() {
  let generation = 0, selection = '', disposed = false;
  const channels = new Map();
  return {
    select(workspace, bot = '') {
      const next = JSON.stringify([workspace, bot]);
      if (next !== selection) { selection = next; generation++; channels.clear(); }
    },
    begin(channel) {
      const sequence = (channels.get(channel) || 0) + 1;
      channels.set(channel, sequence);
      return { generation, channel, sequence };
    },
    current(request) {
      return !disposed && request.generation === generation && channels.get(request.channel) === request.sequence;
    },
    dispose() { disposed = true; generation++; channels.clear(); },
  };
}

export function botErrorMessage(error, {mutation = false} = {}) {
  if (error?.status === 409) return `${error.code&&error.message?`${error.message}。`:''}配置版本或运行状态冲突。你的草稿仍保留；先读取最新状态，再核对差异后保存。`;
  if (error?.status === 404) return 'Bot 或接口不存在。请刷新列表；若后端尚未升级，需要先接入对应 Bot API。';
  if (error?.status === 403) return '当前工作区授权不允许此操作。请核对账号、工作区和 Bot 归属。';
  if (error?.status === 401) return '登录已失效，请重新登录。';
  if (!error?.status && mutation) return '请求结果未确认，可能已经保存或受理。请先重新读取状态，避免重复提交。';
  return error?.message || '无法读取 Bot 状态，请检查连接。';
}

export function botTime(value, timezone = 'Asia/Shanghai') {
  if (!value || !Number.isFinite(Date.parse(value))) return '尚未返回';
  try {
    return `${new Intl.DateTimeFormat('zh-CN', {timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value))} · ${timezone}`;
  } catch { return new Date(value).toISOString(); }
}
