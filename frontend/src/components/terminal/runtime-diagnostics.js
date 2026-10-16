const unreported = '未上报';
const text = value => typeof value === 'string' ? value.trim().slice(0, 100) : '';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const flag = (value, yes, no) => value === true ? yes : value === false ? no : unreported;
const exitReasons = {
  0: '系统未说明原因', 1: '进程主动退出', 2: '系统信号终止', 3: '系统内存不足',
  4: 'Java 崩溃', 5: '原生崩溃', 6: '应用无响应 ANR', 7: '初始化失败',
  8: '权限变更', 9: '资源使用过高', 10: '用户请求停止', 11: '用户已停止',
  12: '依赖进程退出', 13: '其他系统原因', 14: '系统冻结器终止',
  15: '应用组件状态变更', 16: '应用升级',
};

function timestamp(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value))) return null;
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 8640000000000000 ? parsed : null;
}

export function formatDiagnosticTime(value) {
  const parsed = timestamp(value);
  if (parsed === null) return '时间未上报';
  const date = new Date(parsed);
  return Number.isNaN(date.getTime()) ? '时间未上报' : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

/** Present reported facts without converting missing booleans or timestamps into a diagnosis. */
export function runtimeDiagnosticsView(node, { syncInterrupted = false } = {}) {
  const runtime = node?.health?.runtime;
  const reported = record(runtime) && Object.keys(runtime).length > 0;
  const source = node?.status === 'offline' ? '离线前记录' : syncInterrupted || node?.status !== 'online' ? '上次上报记录（连接状态待确认）' : '最近心跳记录';
  const view = { reported, source, recordedAt: formatDiagnosticTime(node?.lastSeen) };
  if (!reported) return view;
  const model = [text(runtime.manufacturer), text(runtime.model)].filter(Boolean).join(' ') || unreported;
  const release = text(runtime.androidRelease);
  const sdk = Number.isSafeInteger(runtime.sdkInt) && runtime.sdkInt > 0 ? `API ${runtime.sdkInt}` : '';
  const android = [release ? `Android ${release}` : 'Android 版本未上报', sdk].filter(Boolean).join(' · ');
  const exits = (Array.isArray(runtime.recentExits) ? runtime.recentExits : []).filter(record).map((exit, index) => {
    const reasonCode = Number.isSafeInteger(exit.reason) && exit.reason >= 0 ? exit.reason : null;
    const at = timestamp(exit.timestamp);
    return { key: `${at ?? 'unknown'}-${reasonCode ?? 'unknown'}-${index}`, at,
      time: formatDiagnosticTime(exit.timestamp), reason: exitReasons[reasonCode] || text(exit.reasonName) || (reasonCode === null ? '退出原因未上报' : `未识别的系统原因（${reasonCode}）`),
      updateNote: exit.updateRelated === true ? '与应用更新时间接近' : '' };
  }).sort((left, right) => (right.at ?? -Infinity) - (left.at ?? -Infinity)).slice(0, 6);
  const historyStatus = runtime.exitHistoryAvailable === false ? '系统退出记录暂不可用'
    : Array.isArray(runtime.recentExits) && runtime.exitHistoryAvailable === true && !exits.length ? '系统暂无退出记录'
      : exits.length ? '' : '系统退出记录未上报';
  return { ...view, model, android, statuses: [
    { label: '前台服务', value: flag(runtime.foreground, '运行中', '未运行') },
    { label: '通知', value: flag(runtime.notificationsEnabled, '已允许', '未允许') },
    { label: '后台限制', value: flag(runtime.backgroundRestricted, '受限', '未受限') },
    { label: '电池优化', value: flag(runtime.batteryOptimizationIgnored, '已豁免', '未豁免') },
    { label: '系统省电', value: flag(runtime.powerSaveMode, '已开启', '未开启') },
    { label: '设备休眠', value: flag(runtime.deviceIdleMode, '休眠中', '未休眠') },
  ], historyStatus, latestExit: exits[0] || null, earlierExits: exits.slice(1) };
}
