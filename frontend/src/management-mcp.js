export function safeMcpConfig(status, workspace) {
  const adapter = status?.config_template?.mcpServers?.['ziwei-management'];
  const script = adapter?.args?.find(value => typeof value === 'string' && /(?:^|[\\/])scripts[\\/]ziwei-mcp\.mjs$/.test(value));
  return { mcpServers: { 'ziwei-management': {
    command: 'node', args: [script || '<ZIWEI_INSTALL_DIR>/scripts/ziwei-mcp.mjs'],
    env: { ZIWEI_API_BASE: 'https://qzelynth.top', ZIWEI_MCP_WORKSPACE: String(workspace || status?.workspace || ''), ZIWEI_MCP_TOKEN_FILE: '<PRIVATE_MCP_TOKEN_FILE>' }
  } } };
}

function issueText(value) { return typeof value === 'string' ? value : String(value?.message || value?.reason || value?.code || '运行环境未就绪'); }
export function profileAfterRuntimeChange(currentRuntime, nextRuntime, profile = '') {
  return currentRuntime === nextRuntime ? String(profile || '') : '';
}
export function employeeReadiness(discovery, { deviceId, runtime, profile = '', mcpEnabled = false } = {}) {
  const issues = [];
  const device = discovery?.devices?.find(item => item.id === deviceId);
  if (!device) return { ready: false, issues: ['请选择当前工作区发现的目标电脑，并刷新环境。'], device: null, runtime: null };
  if (device.status !== 'online' || device.healthy === false) issues.push('目标电脑离线或心跳过期，请在该电脑启动原有 ziwei_user 并确认工作区。');
  const selected = device.runtimes?.find(item => item.name === runtime);
  if (!selected) issues.push(`${runtime || '所选运行时'} CLI 在目标电脑未发现，请安装并刷新设备心跳。`);
  else {
    issues.push(...(selected.issues || []).map(issueText));
    if (selected.cli_status !== 'available') issues.push(`${runtime} CLI 不可用，请在目标电脑检查安装路径与 CLI 状态。`);
    if (selected.available === false) issues.push(`${runtime} CLI 或设备尚未就绪，请查看发现诊断。`);
    if (runtime !== 'Hermes') {
      if (selected.readiness === 'unavailable' || selected.readiness === 'blocked' || selected.readiness?.ready === false || selected.authenticated === false) issues.push(`${runtime} 运行环境未就绪，请检查 CLI 认证、provider 与配置。`);
      if (selected.readiness?.issues) issues.push(...selected.readiness.issues.map(issueText));
      if (selected.readiness?.reason && selected.readiness.ready !== true) issues.push(String(selected.readiness.reason));
      if (selected.readiness?.authentication === 'missing') issues.push(`${runtime} CLI 认证缺失，请在目标电脑完成登录。`);
      if (selected.readiness?.provider === 'missing') issues.push(`${runtime} provider 未配置，请在目标电脑配置后刷新。`);
    }
    if (runtime === 'Hermes') {
      if (!profile || profile === 'default') issues.push('请选择或创建独立 Hermes profile。');
      else {
        const found = selected.profiles?.find(item => (typeof item === 'string' ? item : item.name) === profile);
        if (!found) issues.push(`目标电脑未发现 profile「${profile}」，请先在此电脑创建并刷新。`);
        else if (found.hasProvider === false || found.provider_configured === false || found.authentication_configured === false || found.ready === false || found.readiness?.ready === false) issues.push(`profile「${profile}」的 provider 或认证未就绪，请在目标电脑配置 provider 后刷新。`);
      }
    } else if (profile) {
      const found = selected.profiles?.find(item => (typeof item === 'string' ? item : item.name) === profile);
      if (!found) issues.push(`目标电脑未发现 ${runtime} profile「${profile}」，请明确选择已发现的配置。`);
      else if (found.ready === false || found.readiness?.ready === false) issues.push(found.readiness?.reason || `${runtime} profile「${profile}」尚未就绪，请在目标电脑修复配置。`);
    }
  }
  const managementMcp = device.management_mcp || device.managementMcp;
  if (mcpEnabled && managementMcp?.configured !== true) issues.push(managementMcp?.reason || '目标电脑尚未报告管理 MCP 配置，请更新 ziwei_user 并配置工作区 MCP bearer。');
  if (mcpEnabled && discovery.workspace && managementMcp?.configured && managementMcp.workspace !== discovery.workspace) issues.push('目标电脑的管理 MCP 工作区与当前工作区不同，请在该电脑核对安全配置。');
  if (mcpEnabled && managementMcp?.configured && !managementMcp.supportedRuntimes?.includes(runtime)) issues.push(`目标电脑尚未报告支持 ${runtime} 管理 MCP 注入，请升级对应客户端适配器。`);
  return { ready: issues.length === 0, issues: [...new Set(issues)], device, runtime: selected || null };
}

export function employeeMcpEvidence(status) {
  const receipt = status?.receipt;
  if (receipt?.status === 'failed' || receipt?.error) return { label: '加载或执行失败', tone: 'failed' };
  if (receipt?.loaded === true && receipt?.tool_calls?.length) return { label: '已加载并调用工具', tone: 'online' };
  if (receipt?.loaded === true) return { label: '已加载，尚无工具调用', tone: 'online' };
  if (receipt?.injected === true) return { label: '已注入，等待加载回执', tone: 'neutral' };
  if (receipt?.status === 'pending') return { label: '等待执行回执', tone: 'neutral' };
  return { label: '尚无运行回执', tone: 'neutral' };
}
