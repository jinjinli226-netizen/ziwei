<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';
import { ZiStatusTag } from '@ziwei/ui';
import { api } from '../api.js';
import { employeeMcpEvidence, managementPreparation, safeMcpConfig } from '../management-mcp.js';

const props = defineProps({ workspace: { type: String, required: true }, employee: { type: Object, default: null }, canManage: { type: Boolean, default: false } });
const status = ref(null); const employeeStatus = ref(null); const discovery = ref(null);
const loading = ref(false); const error = ref(''); const copyState = ref(''); const updating = ref(''); const retryMessage = ref(''); const configField = ref(null);
let generation = 0; let retryGeneration = 0; let disposed = false;
const config = computed(() => JSON.stringify(safeMcpConfig(status.value, props.workspace), null, 2));
const credential = computed(() => status.value?.credential || { configured: status.value?.configured, scope_allowed: status.value?.scope_allowed });
const tools = computed(() => Array.isArray(status.value?.tools) ? status.value.tools : []);
const evidence = computed(() => employeeMcpEvidence(employeeStatus.value));
const receipt = computed(() => employeeStatus.value?.receipt);
const selectedDevice = computed(() => discovery.value?.devices?.find(device => device.id === (employeeStatus.value?.target_device_id || props.employee?.target_device_id)));
const connections = computed(() => status.value?.connections || (discovery.value?.devices || []).map(device => ({ device_id: device.id, name: device.name, status: device.status, ...mcpDeviceConfig(device) })));
const employeeConnection = computed(() => connections.value.find(connection => connection.device_id === (employeeStatus.value?.target_device_id || props.employee?.target_device_id)));
const preparation = computed(() => managementPreparation(employeeConnection.value || mcpDeviceConfig(selectedDevice.value)));
const apiHealthy = computed(() => status.value?.health === 'healthy' && credential.value.scope_allowed !== false);
function mcpDeviceConfig(device) { return device?.management_mcp || device?.managementMcp; }
function runtimeLabel(runtime) { return runtime.readiness?.ready === true ? '就绪' : runtime.readiness?.reason || (runtime.cli_status === 'available' ? 'CLI 已发现，待运行验证' : 'CLI 不可用'); }
async function refresh() {
  const request = ++generation;
  loading.value = true; error.value = ''; status.value = null; employeeStatus.value = null; discovery.value = null;
  try {
    const workspace = props.workspace; const employeeId = props.employee?.id;
    const result = await Promise.all([api.employeeMcp(workspace), api.managementMcpDiscovery(workspace), employeeId ? api.employeeMcpStatus(employeeId, workspace) : Promise.resolve(null)]);
    if (disposed || request !== generation) return;
    [status.value, discovery.value, employeeStatus.value] = result;
  } catch (cause) { if (!disposed && request === generation) error.value = cause.message || '无法读取 MCP 配置，请重试。'; }
  finally { if (!disposed && request === generation) loading.value = false; }
}
async function copyConfig() {
  try { await navigator.clipboard.writeText(config.value); copyState.value = '已复制无密钥的开发者模板；平台员工无需手动填写此配置。'; }
  catch { copyState.value = '浏览器未允许复制，已选中下方配置，请手动复制。'; configField.value?.focus(); configField.value?.select(); }
}
async function retryConnection(deviceId) {
  if (!deviceId || updating.value || !connections.value.some(connection => connection.device_id === deviceId)) return;
  const request = ++retryGeneration; const workspace = props.workspace;
  updating.value = deviceId; error.value = ''; retryMessage.value = '';
  try {
    await api.retryManagementMcp(deviceId, workspace);
    if (disposed || request !== retryGeneration || workspace !== props.workspace) return;
    retryMessage.value = '已请求自动接入刷新，等待电脑下一次心跳；未执行员工任务。'; await refresh();
  } catch (cause) { if (!disposed && request === retryGeneration && workspace === props.workspace) error.value = cause.message; }
  finally { if (!disposed && request === retryGeneration) updating.value = ''; }
}
watch(() => [props.workspace, props.employee?.id], () => { retryGeneration += 1; updating.value = ''; retryMessage.value = ''; void refresh(); }, { immediate: true });
onUnmounted(() => { disposed = true; generation += 1; retryGeneration += 1; });
</script>

<template>
  <section class="management-mcp-panel" data-testid="management-mcp-panel">
    <div class="card-heading management-mcp-heading"><div><h3>{{ employee ? 'MCP 管理入口' : '紫薇管理 MCP' }}</h3><p>默认自动接入：新旧员工通过已连接电脑的当前工作区身份使用管理工具，无需单独授权。</p></div><button type="button" class="pill" :disabled="loading" @click="refresh">{{ loading ? '读取中…' : '刷新真实状态' }}</button></div>
    <p v-if="loading" role="status" class="management-mcp-note">正在读取工作区配置、设备心跳和执行回执…</p>
    <div v-if="error" class="management-mcp-alert" role="alert">{{ error }} <button type="button" class="pill" @click="refresh">重试</button></div>
    <template v-if="status">
      <div class="management-mcp-facts">
        <div><span>当前工作区</span><strong data-testid="mcp-workspace">{{ status.workspace || workspace }}</strong><small>范围：{{ status.workspaces?.join('、') || workspace }}</small></div>
        <div><span>MCP 传输</span><strong>stdio · 本机子进程</strong><small>需要 Node.js 与 scripts/ziwei-mcp.mjs</small></div>
        <div><span>HTTPS 管理 API</span><ZiStatusTag :status="apiHealthy ? 'online' : 'neutral'" :label="apiHealthy ? 'API 健康' : status.health || '未配置'" dot/><small>仅表示管理 API 状态</small></div>
        <div><span>平台自动接入</span><strong>{{ status.managed && status.default_enabled ? '新旧员工默认开启' : '等待平台状态确认' }}</strong><small>{{ credential.scope_allowed === false ? '当前工作区身份不可用' : '使用当前电脑的工作区连接 · 页面不读取密钥' }}</small></div>
      </div>
      <p class="management-mcp-note">HTTPS 管理 API：<code>{{ status.api_endpoint || status.endpoint || `https://qzelynth.top/mcp/v1/workspaces/${workspace}` }}</code>。此地址不是可直接粘贴到远程 MCP 客户端的连接 URL。</p>

      <div v-if="employee" class="management-mcp-runtime" data-testid="employee-mcp-evidence">
        <div class="card-heading"><div><h4>员工实际运行状态</h4><p>{{ employeeStatus?.runtime || employee.runtime }} · {{ employeeStatus?.runtime_profile || employee.runtime_profile || '默认 CLI 配置' }} · {{ selectedDevice?.name || employeeStatus?.target_device_id || '尚未绑定目标电脑' }}</p></div><ZiStatusTag :status="evidence.tone" :label="evidence.label" dot/></div>
        <p data-testid="employee-mcp-preparation">默认自动接入 · <strong>{{ selectedDevice || employeeConnection ? preparation.label : '等待当前工作区电脑连接' }}</strong><span v-if="preparation.reason"> · {{ preparation.reason }}</span><small v-if="preparation.reasonCode">（{{ preparation.reasonCode }}）</small></p>
        <button v-if="employeeConnection && preparation.retryable" type="button" class="pill" :disabled="Boolean(updating)" @click="retryConnection(employeeConnection.device_id)">{{ updating ? '请求中…' : '重试自动接入' }}</button>
        <details v-if="preparation.updateRequired" class="management-mcp-note"><summary>更新 ziwei_user</summary><p>在目标电脑沿原安装方式更新 ziwei_user，使用原生启动入口刷新客户端，保留已有工作区连接。更新后点击“刷新真实状态”。</p><a :href="`/${encodeURIComponent(workspace)}/members`">查看设备与安装入口</a></details>
        <p v-if="receipt?.action_id" class="management-mcp-note">执行 ID：<code>{{ receipt.action_id }}</code><span v-if="receipt.completed_at"> · {{ receipt.completed_at }}</span></p>
        <p v-if="receipt?.error" role="alert" class="management-mcp-alert">{{ receipt.error }}</p>
        <ul v-if="receipt?.tool_calls?.length" class="management-mcp-call-list"><li v-for="(call, index) in receipt.tool_calls" :key="index"><code>{{ call.toolName || call.name || call.tool }}</code> · {{ call.ok === false ? '调用失败' : call.ok === true ? '调用成功' : '结果待确认' }}</li></ul>
        <p class="management-mcp-note">员工下一次运行时自动准备并注入。自动接入已准备、已注入、已加载、工具调用成功分别依据连接状态与执行回执显示；API 健康不会被计作员工验收通过。</p>
      </div>

      <details class="management-mcp-tools" :open="!employee"><summary>真实工具清单 · {{ tools.length }} 项</summary><div v-if="tools.length" class="management-mcp-tool-grid"><article v-for="tool in tools" :key="tool.name"><code>{{ tool.name }}</code><p>{{ tool.description }}</p><details v-if="tool.inputSchema"><summary>参数</summary><pre>{{ JSON.stringify(tool.inputSchema, null, 2) }}</pre></details></article></div><p v-else class="management-mcp-note">服务端尚未返回工具清单，请刷新或更新管理 API。</p></details>

      <details class="management-mcp-setup"><summary>开发者 stdio 模板（平台员工无需手动配置）</summary><p>平台员工使用已连接电脑的工作区身份自动准备管理接入。下方仅供外部客户端集成参考，不包含密钥；自动接入状态与实际运行回执分别显示。</p><div class="form-actions"><button type="button" class="pill" @click="copyConfig">复制 stdio 配置</button></div><textarea ref="configField" :value="config" readonly spellcheck="false" aria-label="安全 stdio MCP 配置" rows="15"></textarea><p v-if="copyState" role="status" class="management-mcp-note">{{ copyState }}</p><p class="management-mcp-note">不要把任何凭据填入人格、岗位说明、任务、文档或 Git。</p></details>

      <p v-if="retryMessage" role="status" class="management-mcp-note">{{ retryMessage }}</p>
      <details v-if="!employee" class="management-mcp-devices" open><summary>自动接入进度 · 当前工作区电脑</summary><p v-if="!connections.length" class="management-mcp-note">等待当前工作区电脑连接。沿原配置连接并启动 ziwei_user 后，管理 MCP 会自动准备，无需额外授权。</p><article v-for="connection in connections" :key="connection.device_id" class="management-mcp-device" :data-device-id="connection.device_id"><div class="card-heading"><div><strong>{{ connection.name || connection.device_id }}</strong><small>{{ connection.device_id }} · {{ connection.workspace || workspace }}</small></div><ZiStatusTag :status="managementPreparation(connection).tone" :label="managementPreparation(connection).label" dot/></div><p v-if="connection.reason">{{ connection.reason }}<small v-if="connection.reasonCode">（{{ connection.reasonCode }}）</small></p><p v-if="connection.state === 'ready'">接入已准备；实际加载仍需员工运行回执。</p><button v-if="managementPreparation(connection).retryable" type="button" class="pill" :disabled="Boolean(updating)" @click="retryConnection(connection.device_id)">{{ updating === connection.device_id ? '请求中…' : '重试自动接入' }}</button><details v-if="managementPreparation(connection).updateRequired"><summary>更新 ziwei_user</summary><p>在此电脑沿原安装方式更新客户端，使用原生启动入口刷新并保留现有工作区连接，再刷新状态。</p><a :href="`/${encodeURIComponent(workspace)}/members`">查看设备与安装入口</a></details><ul><li v-for="runtime in discovery?.devices?.find(device => device.id === connection.device_id)?.runtimes || []" :key="runtime.name"><strong>{{ runtime.name }}</strong> · {{ runtime.version || '版本未发现' }} · {{ runtimeLabel(runtime) }}<span v-if="runtime.profiles?.length"> · profiles: {{ runtime.profiles.map(profile => typeof profile === 'string' ? profile : profile.name).join('、') }}</span></li></ul></article></details>
    </template>
  </section>
</template>

<style scoped>
.management-mcp-panel { margin:16px 0; padding:22px; border:1px solid var(--ziwei-line); border-radius:12px; background:var(--ziwei-surface); min-width:0; }
.management-mcp-heading { align-items:flex-start; gap:12px; }
h3,h4 { margin:0 0 8px; } h4 { font-size:14px; }
p,li { font-size:13px; line-height:1.8; color:var(--ziwei-muted); }
.management-mcp-heading p { margin:0; }
.management-mcp-facts { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin:20px 0; }
.management-mcp-facts > div { display:flex; align-items:flex-start; flex-direction:column; gap:8px; padding:14px; background:var(--ziwei-canvas); border-radius:8px; min-width:0; }
span,small { font-size:12px; color:var(--ziwei-muted); } strong { color:var(--ziwei-ink); font-size:13px; overflow-wrap:anywhere; }
code,pre { font-size:12px; overflow-wrap:anywhere; white-space:pre-wrap; } code { color:var(--ziwei-violet); }
.management-mcp-note { overflow-wrap:anywhere; margin:12px 0; }
.management-mcp-alert { padding:12px; border:1px solid #f2c8cc; border-radius:8px; color:#a43142; background:#fff7f8; font-size:13px; line-height:1.8; }
.management-mcp-runtime { margin:20px 0; padding:16px; border:1px solid var(--ziwei-line); border-radius:8px; }
.management-mcp-runtime .card-heading { gap:12px; align-items:flex-start; flex-wrap:wrap; }
.management-mcp-runtime p { margin:6px 0; }
.management-mcp-tools,.management-mcp-setup,.management-mcp-devices { padding-top:16px; margin-top:16px; border-top:1px solid var(--ziwei-line); }
summary { cursor:pointer; font-size:13px; color:var(--ziwei-ink); font-weight:600; line-height:1.8; }
.management-mcp-tool-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; margin-top:12px; }
.management-mcp-tool-grid article { padding:14px; border:1px solid var(--ziwei-line); border-radius:8px; min-width:0; }
.management-mcp-tool-grid p { margin:7px 0; }
.management-mcp-tool-grid summary { font-size:12px; color:var(--ziwei-muted); }
.management-mcp-tool-grid pre { max-height:220px; overflow:auto; }
textarea { display:block; width:100%; box-sizing:border-box; font:12px/1.7 monospace; background:var(--ziwei-canvas); }
ol { padding-left:22px; } ol li { margin:8px 0; } .management-mcp-call-list { padding-left:20px; }
.management-mcp-device { padding:14px 0; border-bottom:1px solid var(--ziwei-line); }
.management-mcp-device small { display:block; margin-top:6px; overflow-wrap:anywhere; }
.management-mcp-device ul { padding-left:20px; }
@media(max-width:850px) { .management-mcp-facts { grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media(max-width:520px) { .management-mcp-panel { padding:14px; } .management-mcp-heading { flex-wrap:wrap; } .management-mcp-facts,.management-mcp-tool-grid { grid-template-columns:minmax(0,1fr); } }
</style>
