<script setup>
import { onBeforeUnmount, reactive, ref, watch } from 'vue';
import { api } from '../api.js';
import { clientUpdateView, createClientUpdateController } from '../client-updates.js';

const props = defineProps({ workspace: { type: String, required: true }, actorId: { type: String, required: true } });
const copied = ref('');
let storage;
try { storage = globalThis.sessionStorage; } catch {}
const controller = createClientUpdateController({
  scope: () => ({ workspace: props.workspace, actorId: props.actorId }), wrap: reactive, storage,
  read: workspace => api.clientUpdates(workspace),
  submit: (id, body, workspace) => api.updateClient(id, body, workspace),
  cancel: (id, requestId, workspace) => api.cancelClientUpdate(id, requestId, workspace),
});
const state = controller.state;
let timer, disposed = false, pollGeneration = 0;
function view(device) { return clientUpdateView(device, { submitting: state.submitting[device.id], cancelling: state.cancelling[device.id], uncertain: state.uncertain[device.id] }); }
function build(value) { return value ? value.slice(0, 12) : '未上报'; }
function time(value) { if (!value) return ''; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleString('zh-CN', { hour12: false }); }
async function refresh() { return controller.refresh(); }
async function poll(generation) {
  await controller.refresh({ silent: true });
  if (!disposed && generation === pollGeneration) timer = setTimeout(() => poll(generation), 5000);
}
watch(() => [props.workspace, props.actorId], () => {
  clearTimeout(timer); controller.invalidate(); const generation = ++pollGeneration;
  void controller.refresh().then(() => { if (!disposed && generation === pollGeneration) timer = setTimeout(() => poll(generation), 5000); });
}, { immediate: true });
onBeforeUnmount(() => { disposed = true; pollGeneration++; clearTimeout(timer); controller.invalidate(); });

const instructions = [
  { id: 'legacy-update', title: '旧客户端首次升级', command: "irm ('https' + '://' + 'qzelynth' + '.top/downloads/cli/update-windows.ps1') | iex", description: '仅当电脑提示不支持远程升级时，在那台 Windows 电脑的 PowerShell 运行一次。更新保留设备身份和已有连接，后续可从这里远程升级。' },
  { id: 'update', title: '本机更新', command: 'ziwei_user update', description: '在需要维护的电脑上运行，官方更新器校验安装包并保留原安装位置。' },
  { id: 'update-status', title: '查看本机更新结果', command: 'ziwei_user update-status --json', description: '读取真实维护回执。' },
  { id: 'stop', title: '本机停止', command: 'ziwei_user stop', description: '停止该电脑客户端；恢复时运行 ziwei_user start。' },
  { id: 'uninstall', title: '本机卸载', command: 'ziwei_user uninstall', description: '默认保留用户数据和连接配置。' },
];
async function copy(item) { try { await navigator.clipboard.writeText(item.command); copied.value = item.id; } catch { copied.value = ''; } }
</script>

<template>
  <section class="client-maintenance-panel" data-testid="client-maintenance-panel">
    <div class="maintenance-heading"><div><h3>远程升级 ziwei_user</h3><p>选择一台电脑升级，系统等这台电脑的全部员工空闲后再维护。完成后用新版心跳确认重新上线。</p></div><button type="button" class="pill" :disabled="state.loading" @click="refresh">{{state.loading ? '读取中…' : '刷新状态'}}</button></div>
    <p v-if="state.error" class="maintenance-alert" role="alert">{{state.error}} <button type="button" class="pill" @click="refresh">重试读取</button></p>
    <p v-if="state.releaseError" class="maintenance-alert" role="status">官方版本暂不可确认（{{state.releaseError}}），暂不下发升级。</p>
    <p v-if="state.loading && !state.devices.length" role="status">正在读取各电脑的版本与远程升级能力…</p>
    <p v-else-if="state.readReady && !state.devices.length" class="modal-copy">当前工作区还没有可见的电脑。</p>
    <div class="client-update-grid">
      <article v-for="device in state.devices" :key="device.id" class="client-update-card" :data-device-id="device.id" :data-state="view(device).state">
        <div class="device-update-heading"><div><h4>{{device.name || '未命名电脑'}}</h4><small>{{device.os || '系统未上报'}} · {{device.status === 'online' ? '在线' : '离线'}}</small></div><span class="maintenance-status" :data-tone="view(device).tone" role="status">{{view(device).label}}</span></div>
        <dl class="client-update-versions"><div><dt>当前版本</dt><dd>{{device.currentVersion || '未上报'}} <code :title="device.currentBuild">{{build(device.currentBuild)}}</code></dd></div><div><dt>目标版本</dt><dd>{{device.version || state.release?.version || '未确认'}} <code :title="device.targetBuild">{{build(device.targetBuild)}}</code></dd></div></dl>
        <p v-if="view(device).reason" class="modal-copy">{{view(device).reason}}<small v-if="device.reasonCode">（{{device.reasonCode}}）</small></p>
        <p v-if="['requested','accepted','waiting_idle'].includes(view(device).state)" class="modal-copy">已安排本机所有员工空闲后升级，当前工作会继续执行。</p>
        <p v-if="view(device).state === 'updating'" class="modal-copy">正在由电脑上的独立更新器维护，客户端会短暂离线。</p>
        <p v-if="view(device).state === 'awaiting_heartbeat'" class="modal-copy">等待这台电脑上报目标版本心跳；尚未确认升级完成。</p>
        <p v-if="view(device).stalled" class="maintenance-alert" role="status">{{device.operation.stalledReason || '维护回执长时间未更新，可重新请求官方升级。电脑会先检查原更新器是否仍在运行。'}}</p>
        <p v-if="view(device).failure" class="maintenance-alert" role="alert">{{view(device).failure}}</p>
        <p v-if="state.rowErrors[device.id]" class="maintenance-alert" role="alert">{{state.rowErrors[device.id]}}</p>
        <p v-if="state.uncertain[device.id]" class="modal-copy">正在查询本次请求的真实结果，不会自动重复下发。可刷新状态继续核对。</p>
        <div class="maintenance-actions">
          <button type="button" class="maintenance-update-button" :disabled="!state.readReady || !view(device).canUpdate" @click="controller.update(device.id)">{{view(device).updateLabel}}</button>
          <button v-if="view(device).canCancel" type="button" class="pill" :disabled="!state.readReady" @click="controller.cancel(device.id)">取消等待</button>
          <button v-if="state.uncertain[device.id]" type="button" class="pill" :disabled="state.loading" @click="refresh">查询原请求</button>
          <button v-if="state.uncertain[device.id] && state.readReady && clientUpdateView(device).canUpdate" type="button" class="pill" @click="controller.retry(device.id)">重试本次请求</button>
        </div>
        <details class="maintenance-receipt"><summary>设备与升级回执</summary><p>设备：<code>{{device.id}}</code></p><template v-if="device.operation"><p>请求：<code>{{device.operation.id}}</code></p><p>更新时间：{{time(device.operation.updatedAt) || '未上报'}}</p><p>新版心跳：{{device.operation.heartbeatVerified === true ? '已核验' : '尚未核验'}}</p></template><p v-else>尚未发起升级。</p></details>
      </article>
    </div>
    <details class="client-local-maintenance"><summary>旧版首次升级与本机维护命令</summary>
      <section v-for="item in instructions" :key="item.id" class="device-install-command" :data-testid="`client-maintenance-${item.id}`"><div class="device-install-command-head"><strong>{{item.title}}</strong><button type="button" class="pill" @click="copy(item)">{{copied === item.id ? '已复制' : '复制命令'}}</button></div><pre>{{item.command}}</pre><p class="modal-copy">{{item.description}}</p></section>
      <p class="modal-copy">官方 Windows 升级入口：<code>https://qzelynth.top/downloads/cli/update-windows.ps1</code>。首次安装及配对仍从“添加设备”开始。</p>
    </details>
  </section>
</template>

<style scoped>
.client-maintenance-panel {display:grid;gap:16px;min-width:0;}
.maintenance-heading,.device-update-heading {display:flex;justify-content:space-between;align-items:flex-start;gap:14px;}
h3,h4 {margin:0 0 7px;color:var(--ziwei-ink);font-size:16px;}
h4 {font-size:14px;}
p,small,dt {font-size:12px;line-height:1.7;color:var(--ziwei-muted);}
.maintenance-heading p,.modal-copy {margin:0;font-size:12px;line-height:1.7;}
.client-update-grid {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;}
.client-update-card {min-width:0;padding:18px;border:1px solid var(--ziwei-line);border-radius:12px;background:var(--ziwei-surface);display:flex;flex-direction:column;gap:13px;}
.maintenance-status {flex-shrink:0;padding:4px 8px;border-radius:16px;font-size:11px;background:var(--ziwei-canvas);color:var(--ziwei-muted);}
.maintenance-status[data-tone="pending"] {background:#f0eafd;color:#7752c5;}
.maintenance-status[data-tone="success"] {background:#e8f6ef;color:#238459;}
.maintenance-status[data-tone="danger"] {background:#fff0f2;color:#a43142;}
.client-update-versions {margin:0;display:grid;gap:8px;}
.client-update-versions > div {display:flex;gap:14px;justify-content:space-between;}
dt {flex-shrink:0;}
dd {margin:0;font-size:12px;text-align:right;overflow-wrap:anywhere;}
code {font-size:11px;overflow-wrap:anywhere;}
dd code {display:block;color:var(--ziwei-muted);}
.maintenance-alert {padding:10px 12px;border:1px solid #f2c8cc;border-radius:8px;color:#a43142;background:#fff7f8;font-size:12px;line-height:1.7;overflow-wrap:anywhere;margin:0;}
.maintenance-actions {display:flex;align-items:center;flex-wrap:wrap;gap:8px;}
.maintenance-update-button {padding:8px 14px;border:0;border-radius:8px;background:var(--ziwei-violet,#7855d8);color:white;font-size:12px;cursor:pointer;}
button:disabled {opacity:.45;cursor:not-allowed;}
.maintenance-receipt {border-top:1px solid var(--ziwei-line);padding-top:10px;}
summary {cursor:pointer;font-size:12px;color:var(--ziwei-muted);line-height:1.8;}
.maintenance-receipt p {margin:6px 0 0;overflow-wrap:anywhere;}
.client-local-maintenance {border-top:1px solid var(--ziwei-line);padding-top:14px;}
.device-install-command {margin-top:14px;}
.client-maintenance-panel pre {white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;font-size:12px;}
@media (max-width:640px) {.client-update-grid{grid-template-columns:1fr;}.maintenance-heading{flex-wrap:wrap;}.client-update-card{padding:14px;}.maintenance-actions button{min-height:40px;}.device-update-heading{flex-wrap:wrap;}.client-update-versions > div{gap:8px;}}
</style>
