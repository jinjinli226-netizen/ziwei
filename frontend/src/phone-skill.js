import { employeeReadiness } from './management-mcp.js';

export function phoneErrorText(error) {
  return typeof error === 'string' ? error : error?.message || error?.reason || error?.code || '';
}

export function phoneRuntimeReadiness(setup, form) {
  const readiness = employeeReadiness({ workspace:setup?.workspace,devices:setup?.computers || [] }, { deviceId:form.targetDeviceId,runtime:form.runtime,profile:form.runtimeProfile });
  const terminal = readiness.device?.terminal_mcp;
  const issues = [...readiness.issues];
  if (form.runtime === 'Hermes' && (!form.runtimeProfile || form.runtimeProfile === 'default')) issues.push('手机 MCP 请选择独立 Hermes profile，保留原主 profile。');
  if (readiness.device && (!terminal?.configured || terminal.workspace !== setup?.workspace || !terminal.supportedRuntimes?.includes(form.runtime))) issues.push(terminal?.reason || '目标电脑尚未报告当前工作区的手机 MCP 适配，请等待原客户端更新并重新报告心跳。');
  return { ...readiness,issues:[...new Set(issues)],ready:issues.length === 0 };
}

export function phoneOnline(phone) {
  if (!phone) return false;
  if (Array.isArray(phone.nodes) && phone.control) return Boolean(phone.control.role && !phone.control.draining && phone.nodes.some(node => node.role === phone.control.role && node.status === 'online'));
  return phone.online === true || phone.status === 'online';
}

export function phoneConfigurationMatches(configuration, form) {
  return configuration?.saved === true && configuration.target_device_id === form.targetDeviceId && configuration.runtime === form.runtime
    && String(configuration.runtime_profile || '') === String(form.runtimeProfile || '') && configuration.phone_device_id === form.phoneDeviceId
    && Boolean(configuration.enabled) === Boolean(form.enabled)
    && String(configuration.binding?.account_id || configuration.binding?.accountId || '') === String(form.accountId || '')
    && String(configuration.binding?.account_label || configuration.binding?.accountLabel || '') === String(form.accountLabel || '');
}

export function phoneSetupPhase(status, setup, form) {
  const configuration = status?.configuration;
  if (!configuration?.saved || !configuration.enabled) return { code:'unconfigured', label:'未配置', tone:'neutral', reason:'选择员工、电脑、运行配置和手机后保存安全配置。' };
  if (!phoneConfigurationMatches(configuration, form)) return { code:'dirty', label:'配置有改动，待保存', tone:'neutral', reason:'保存当前选择后重新检测；此前回执不能验证新的目标。' };
  const error = status.receipt?.error || status.api?.error;
  const authenticationFailed = ['authentication_failed','unauthorized','forbidden','credential_missing'].includes(error?.code)
    || status.api?.status === 'unauthorized' || /认证失败|认证缺失|凭据无效|unauthorized|\b401\b/i.test(phoneErrorText(error));
  if (authenticationFailed) return { code:'authentication_failed', label:'认证失败', tone:'failed', reason:phoneErrorText(error) || '安全认证未通过，请刷新状态或联系管理员检查平台连接。' };
  if (status.api?.status !== 'healthy') return { code:'api_unavailable', label:'API 不可用', tone:'failed', reason:phoneErrorText(status.api?.error) || '手机控制 API 暂时不可达，请稍后重试。' };
  const computer = setup?.computers?.find(device => device.id === configuration.target_device_id);
  if (!computer || computer.status !== 'online' || computer.healthy === false) return { code:'waiting_computer', label:'等待电脑', tone:'neutral', reason:'等待所选电脑在当前工作区报告真实心跳。' };
  const runtimeReadiness = phoneRuntimeReadiness(setup, form);
  if (!runtimeReadiness.ready) return { code:'waiting_computer',label:'等待电脑配置',tone:'neutral',reason:runtimeReadiness.issues.join('；') };
  const phone = setup?.phones?.find(device => device.id === configuration.phone_device_id);
  if (!phoneOnline(phone)) return { code:'waiting_phone', label:'等待手机', tone:'neutral', reason:'等待精确绑定的手机控制端上线；不会切换到其他手机。' };
  if (status.receipt?.status === 'failed' || status.receipt?.error) return { code:'failed', label:'MCP 检测失败', tone:'failed', reason:phoneErrorText(status.receipt.error) || '请查看本次执行回执。' };
  const verification = status.verification;
  if (status.receipt?.loaded === true && verification?.status === 'succeeded' && verification.command_id && verification.device_id === configuration.phone_device_id
    && configuration.revision && verification.configuration_revision === configuration.revision) return { code:'verified', label:'实机通过', tone:'online', reason:'本次配置已加载手机 MCP，且精确手机的真实命令回执成功。' };
  if (verification?.status === 'pending') return { code:'trial_pending', label:'等待实机回执', tone:'neutral', reason:'试运行已提交，等待原动作与手机命令返回；不会重复发出命令。' };
  if (verification?.status === 'failed' || verification?.status === 'uncertain') return { code:'trial_failed', label:verification.status === 'uncertain' ? '实机结果待核验' : '实机试运行失败', tone:'failed', reason:phoneErrorText(verification.error) || '请查看原命令回执后再决定下一步。' };
  if (status.receipt?.loaded === true) return { code:'loaded', label:'MCP 已加载', tone:'online', reason:'已收到实际 MCP 握手回执；尚未取得本次配置的实机成功回执。' };
  if (status.receipt?.status === 'pending' || status.receipt?.injected === true) return { code:'pending', label:'等待加载回执', tone:'neutral', reason:status.receipt.injected ? '配置已注入，等待实际初始化和工具列表回执。' : '等待所选电脑执行本次检测。' };
  return { code:'saved', label:'已保存，待检测', tone:'neutral', reason:'配置保存与技能安装已完成，下一步检测实际 MCP 加载。' };
}
