<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';
import { ZiStatusTag } from '@ziwei/ui';
import { api } from '../api.js';
import { employeeMcpEvidence, safeMcpConfig } from '../management-mcp.js';

const props = defineProps({ workspace: { type: String, required: true }, employee: { type: Object, default: null }, canManage: { type: Boolean, default: false } });
const emit = defineEmits(['changed']);
const status = ref(null); const employeeStatus = ref(null); const discovery = ref(null);
const loading = ref(false); const error = ref(''); const copyState = ref(''); const updating = ref(false); const configField = ref(null);
let generation = 0; let disposed = false;
const config = computed(() => JSON.stringify(safeMcpConfig(status.value, props.workspace), null, 2));
const credential = computed(() => status.value?.credential || { configured: status.value?.configured, scope_allowed: status.value?.scope_allowed });
const tools = computed(() => Array.isArray(status.value?.tools) ? status.value.tools : []);
const evidence = computed(() => employeeMcpEvidence(employeeStatus.value));
const receipt = computed(() => employeeStatus.value?.receipt);
const selectedDevice = computed(() => discovery.value?.devices?.find(device => device.id === (employeeStatus.value?.target_device_id || props.employee?.target_device_id)));
const apiHealthy = computed(() => status.value?.health === 'healthy' && credential.value.scope_allowed !== false);
function mcpDeviceConfig(device) { return device?.management_mcp || device?.managementMcp; }
function runtimeLabel(runtime) { return runtime.readiness?.ready === true ? '就绪' : runtime.readiness?.reason || (runtime.cli_status === 'available' ? 'CLI 已发现，待运行验证' : 'CLI 不可用'); }
async function refresh() {
  const request = ++generation;
  loading.value = true; error.value = ''; status.value = null; employeeStatus.value = null; discovery.value = null;
  try {
    const result = await Promise.all([api.employeeMcp(), api.managementMcpDiscovery(), props.employee?.id ? api.employeeMcpStatus(props.employee.id) : Promise.resolve(null)]);
    if (disposed || request !== generation) return;
    [status.value, discovery.value, employeeStatus.value] = result;
  } catch (cause) { if (!disposed && request === generation) error.value = cause.message || '无法读取 MCP 配置，请重试。'; }
  finally { if (!disposed && request === generation) loading.value = false; }
}
async function copyConfig() {
  try { await navigator.clipboard.writeText(config.value); copyState.value = '已复制安全配置；请在目标电脑替换安装目录与私密令牌文件路径。'; }
  catch { copyState.value = '浏览器未允许复制，已选中下方配置，请手动复制。'; configField.value?.focus(); configField.value?.select(); }
}
async function toggleEmployee() {
  if (!props.canManage || !props.employee?.id || updating.value) return;
  updating.value = true; error.value = '';
  try { await api.updateEmployee(props.employee.id, { managementMcpEnabled: !employeeStatus.value?.enabled }); await refresh(); emit('changed'); }
  catch (cause) { error.value = cause.message; }
  finally { updating.value = false; }
}
watch(() => [props.workspace, props.employee?.id], refresh, { immediate: true });
onUnmounted(() => { disposed = true; generation += 1; });
</script>

<template>
  <section class="management-mcp-panel" data-testid="management-mcp-panel">
    <div class="card-heading management-mcp-heading"><div><h3>{{ employee ? 'MCP 管理入口' : '紫薇管理 MCP' }}</h3><p>通过 stdio 启动本机适配器，再经 HTTPS 管理当前工作区。</p></div><button type="button" class="pill" :disabled="loading" @click="refresh">{{ loading ? '读取中…' : '刷新真实状态' }}</button></div>
    <p v-if="loading" role="status" class="management-mcp-note">正在读取工作区配置、设备心跳和执行回执…</p>
    <div v-if="error" class="management-mcp-alert" role="alert">{{ error }} <button type="button" class="pill" @click="refresh">重试</button></div>
    <template v-if="status">
      <div class="management-mcp-facts">
        <div><span>当前工作区</span><strong data-testid="mcp-workspace">{{ status.workspace || workspace }}</strong><small>范围：{{ status.workspaces?.join('、') || workspace }}</small></div>
        <div><span>MCP 传输</span><strong>stdio · 本机子进程</strong><small>需要 Node.js 与 scripts/ziwei-mcp.mjs</small></div>
        <div><span>HTTPS 管理 API</span><ZiStatusTag :status="apiHealthy ? 'online' : 'neutral'" :label="apiHealthy ? 'API 健康' : status.health || '未配置'" dot/><small>仅表示管理 API 状态</small></div>
        <div><span>专用 MCP bearer</span><strong>{{ credential.configured ? '•••••••• · 已配置' : '未配置' }}</strong><small>{{ credential.scope_allowed === false ? '当前工作区不在凭据范围内' : '独立凭据 · 不使用 API Key' }}</small></div>
      </div>
      <p class="management-mcp-note">HTTPS 管理 API：<code>{{ status.api_endpoint || status.endpoint || `https://qzelynth.top/mcp/v1/workspaces/${workspace}` }}</code>。此地址不是可直接粘贴到远程 MCP 客户端的连接 URL。</p>

      <div v-if="employee" class="management-mcp-runtime" data-testid="employee-mcp-evidence">
        <div class="card-heading"><div><h4>员工实际运行状态</h4><p>{{ employeeStatus?.runtime || employee.runtime }} · {{ employeeStatus?.runtime_profile || employee.runtime_profile || '默认 CLI 配置' }} · {{ selectedDevice?.name || employeeStatus?.target_device_id || '尚未绑定目标电脑' }}</p></div><ZiStatusTag :status="evidence.tone" :label="evidence.label" dot/></div>
        <p>接入开关：<strong>{{ employeeStatus?.enabled ? '已开启' : '未开启' }}</strong> · 目标电脑 MCP：<strong>{{ mcpDeviceConfig(selectedDevice)?.configured ? '已报告配置' : '尚未报告配置' }}</strong></p>
        <p v-if="receipt?.action_id" class="management-mcp-note">执行 ID：<code>{{ receipt.action_id }}</code><span v-if="receipt.completed_at"> · {{ receipt.completed_at }}</span></p>
        <p v-if="receipt?.error" role="alert" class="management-mcp-alert">{{ receipt.error }}</p>
        <ul v-if="receipt?.tool_calls?.length" class="management-mcp-call-list"><li v-for="(call, index) in receipt.tool_calls" :key="index"><code>{{ call.toolName || call.name || call.tool }}</code> · {{ call.ok === false ? '调用失败' : '已调用' }}</li></ul>
        <p class="management-mcp-note">开启后在下一次员工执行时注入。已注入、已加载、已调用分别依据执行回执显示；API 健康不会被计作员工验收通过。</p>
        <button v-if="canManage" type="button" class="pill" :disabled="updating || !employeeStatus" @click="toggleEmployee">{{ updating ? '保存中…' : employeeStatus?.enabled ? '关闭员工管理 MCP' : '开启员工管理 MCP' }}</button>
      </div>

      <details class="management-mcp-tools" :open="!employee"><summary>真实工具清单 · {{ tools.length }} 项</summary><div v-if="tools.length" class="management-mcp-tool-grid"><article v-for="tool in tools" :key="tool.name"><code>{{ tool.name }}</code><p>{{ tool.description }}</p><details v-if="tool.inputSchema"><summary>参数</summary><pre>{{ JSON.stringify(tool.inputSchema, null, 2) }}</pre></details></article></div><p v-else class="management-mcp-note">服务端尚未返回工具清单，请刷新或更新管理 API。</p></details>

      <details class="management-mcp-setup" :open="!employee"><summary>接入说明与可复制配置</summary><ol><li>在员工目标电脑安装当前 ziwei_user 包和 Node.js，确认原工作区的 daemon 心跳正常。</li><li>由管理员生成仅限 <strong>{{ workspace }}</strong> 的专用 MCP bearer，并存入仅当前用户可读的私密文件。API Key 与设备凭据均不能替代 MCP bearer。</li><li>复制下方 stdio 配置，替换安装目录与私密文件绝对路径；在 Codex MCP 配置或独立 Hermes profile 中加载。紫薇员工开启管理 MCP 后，由 ziwei_user 在真实执行时注入。</li><li>安排一次只读试运行，调用发现工具确认电脑、CLI 和 profile，再回读员工执行回执与任务结果。配置刷新后重新试运行验证。</li></ol><div class="form-actions"><button type="button" class="pill" @click="copyConfig">复制 stdio 配置</button></div><textarea ref="configField" :value="config" readonly spellcheck="false" aria-label="安全 stdio MCP 配置" rows="15"></textarea><p v-if="copyState" role="status" class="management-mcp-note">{{ copyState }}</p><p class="management-mcp-note">配置模板不含真实令牌。不要把凭据填入人格、岗位说明、任务、文档或 Git；令牌文件留在目标电脑私密目录。</p></details>

      <details v-if="!employee" class="management-mcp-devices" open><summary>目标电脑与运行时 · 来自真实设备心跳</summary><p v-if="!discovery?.devices?.length" class="management-mcp-note">当前工作区尚未发现电脑。请在目标电脑沿原配置启动 ziwei_user；不会从其他工作区借用设备。</p><article v-for="device in discovery?.devices || []" :key="device.id" class="management-mcp-device"><div class="card-heading"><div><strong>{{ device.name || device.id }}</strong><small>{{ device.id }} · 最近心跳 {{ device.last_seen || '尚无心跳' }}</small></div><ZiStatusTag :status="device.status === 'online' ? 'online' : 'neutral'" :label="device.status === 'online' ? '在线' : '离线'" dot/></div><p>管理 MCP：{{ mcpDeviceConfig(device)?.configured ? '已报告配置' : mcpDeviceConfig(device)?.reason || '尚未配置或客户端待更新' }}</p><ul><li v-for="runtime in device.runtimes || []" :key="runtime.name"><strong>{{ runtime.name }}</strong> · {{ runtime.version || '版本未发现' }} · {{ runtimeLabel(runtime) }}<span v-if="runtime.profiles?.length"> · profiles: {{ runtime.profiles.map(profile => typeof profile === 'string' ? profile : profile.name).join('、') }}</span></li></ul><p v-if="!device.runtimes?.length" class="management-mcp-note">尚无 CLI 发现结果，请更新客户端并刷新心跳。</p></article></details>
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
