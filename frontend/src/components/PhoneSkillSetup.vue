<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';
import { ZiModal, ZiStatusTag } from '@ziwei/ui';
import ZiSelect from './ZiSelect.vue';
import { api } from '../api.js';
import { phoneConfigurationMatches, phoneErrorText, phoneOnline, phoneRuntimeReadiness, phoneSetupPhase } from '../phone-skill.js';

const props = defineProps({ workspace:{type:String,required:true}, workspaces:{type:Array,default:()=>[]}, employeeId:{type:String,default:''}, phoneDeviceId:{type:String,default:''}, canManage:{type:Boolean,default:false} });
const emit = defineEmits(['close','changed','workspace','create-employee']);
const setup = ref(null); const status = ref(null); const loading = ref(false); const busy = ref(''); const error = ref('');
const form = ref({ employeeId:'',enabled:true,targetDeviceId:'',runtime:'',phoneDeviceId:'',accountId:'',accountLabel:'' });
const profileChoice = ref(''); const allowTrial = ref(false); const actionJob = ref(null); const trialKey = ref('');
const sourceWorkspace = ref(''); const sourceDeviceId = ref(''); const sourceComputers = ref([]); const sourceLoading = ref(false); const grant = ref(null); const grantError = ref(''); const grantBusy = ref(false);
let disposed = false; let scopeEpoch = 0; let readGeneration = 0; let sourceGeneration = 0; let actionTimer; let grantTimer;
const selection = computed(() => ({ ...form.value,runtimeProfile:profileChoice.value === '__default__' ? '' : profileChoice.value }));
const employees = computed(() => setup.value?.employees || []);
const computers = computed(() => setup.value?.computers || []);
const phones = computed(() => setup.value?.phones || []);
const selectedComputer = computed(() => computers.value.find(device => device.id === form.value.targetDeviceId));
const selectedPhone = computed(() => phones.value.find(device => device.id === form.value.phoneDeviceId));
const selectedRuntime = computed(() => selectedComputer.value?.runtimes?.find(runtime => runtime.name === form.value.runtime));
const workspaceOptions = computed(() => props.workspaces.map(item => ({ label:`${item.name || item.slug} · ${item.slug}`,value:item.slug })));
const employeeOptions = computed(() => employees.value.map(employee => ({ label:employee.name || employee.id,value:employee.id })));
const computerOptions = computed(() => computers.value.map(device => ({label:`${device.name || device.id} · ${device.status === 'online' ? '在线' : '离线'}`,value:device.id})));
const runtimeOptions = computed(() => (selectedComputer.value?.runtimes || []).map(runtime => ({label:runtime.name,value:runtime.name})));
const profileOptions = computed(() => [
  ...(form.value.runtime && form.value.runtime !== 'Hermes' ? [{label:'默认 CLI 配置',value:'__default__'}] : []),
  ...(selectedRuntime.value?.profiles || []).map(profile => typeof profile === 'string' ? profile : profile.name).filter(name => name && name !== 'default').map(name => ({label:name,value:name}))
]);
const phoneOptions = computed(() => phones.value.map(phone => ({label:`${phone.alias || phone.name || phone.id} · ${phoneOnline(phone) ? '在线' : '等待手机'}`,value:phone.id})));
const owner = computed(() => props.workspaces.some(item => item.slug === props.workspace && item.role === 'owner'));
const sourceOptions = computed(() => props.workspaces.filter(item => item.slug !== props.workspace && item.role === 'owner').map(item => ({label:`${item.name || item.slug} · ${item.slug}`,value:item.slug})));
const sourceComputerOptions = computed(() => sourceComputers.value.map(device => ({label:`${device.name || device.id} · ${device.status === 'online' ? '在线' : '离线'}`,value:device.id})));
const phase = computed(() => phoneSetupPhase(status.value,setup.value,selection.value));
const matches = computed(() => phoneConfigurationMatches(status.value?.configuration,selection.value));
const readiness = computed(() => phoneRuntimeReadiness(setup.value,selection.value));
const terminalStates = new Set(['succeeded','failed','cancelled','expired','uncertain']);
const actionActive = computed(() => Boolean(actionJob.value?.id && !terminalStates.has(actionJob.value.status)));
const canEdit = computed(() => props.canManage && !busy.value);
const canSave = computed(() => canEdit.value && form.value.employeeId && (form.value.enabled ? selectedComputer.value && selectedRuntime.value && profileChoice.value && profileOptions.value.some(option => option.value === profileChoice.value) && selectedPhone.value && readiness.value.ready : status.value?.configuration?.saved));
const canCheck = computed(() => props.canManage && matches.value && selection.value.enabled && readiness.value.ready && status.value?.api?.status === 'healthy' && !busy.value && !actionActive.value);
const canTrial = computed(() => canCheck.value && status.value?.receipt?.loaded === true && phoneOnline(selectedPhone.value) && allowTrial.value);
const grantedComputerConnected = computed(() => Boolean(grant.value?.target_device_id && computers.value.some(device => device.id === grant.value.target_device_id && device.status === 'online' && device.healthy !== false)));

function clearAction() { clearTimeout(actionTimer); actionJob.value=null; busy.value=''; trialKey.value=''; allowTrial.value=false; }
function hydrate(employee, configuration) {
  const saved = configuration?.saved;
  form.value = { employeeId:employee.id,enabled:saved ? configuration.enabled : true,targetDeviceId:saved ? configuration.target_device_id : employee.target_device_id || '',runtime:saved ? configuration.runtime : employee.runtime || '',phoneDeviceId:saved ? configuration.phone_device_id : props.phoneDeviceId || '',accountId:configuration?.binding?.account_id || configuration?.binding?.accountId || '',accountLabel:configuration?.binding?.account_label || configuration?.binding?.accountLabel || '' };
  const profile = saved ? configuration.runtime_profile : employee.runtime_profile;
  profileChoice.value = profile || (form.value.runtime && form.value.runtime !== 'Hermes' ? '__default__' : '');
}
async function refresh({ initial=false } = {}) {
  const generation = ++readGeneration; const workspace = props.workspace; const epoch = scopeEpoch;
  loading.value=true; error.value='';
  try {
    const data=await api.phoneMcpSetup(workspace);
    if(disposed || epoch!==scopeEpoch || generation!==readGeneration) return;
    setup.value=data;
    const employeeId = initial ? props.employeeId : form.value.employeeId;
    const employee=data.employees?.find(item=>item.id===employeeId);
    if (!employee) { if (employeeId) error.value='当前工作区未发现该员工，请明确选择当前工作区员工。'; status.value=null; form.value.employeeId=''; return; }
    const evidence=await api.phoneMcpStatus(employee.id,workspace);
    if(disposed || epoch!==scopeEpoch || generation!==readGeneration) return;
    status.value=evidence;
    if(initial) hydrate(employee,evidence.configuration);
  } catch(cause) { if(!disposed && epoch===scopeEpoch && generation===readGeneration) { error.value=cause.message || '配置读取失败'; status.value=null; } }
  finally { if(!disposed && generation===readGeneration) loading.value=false; }
}
async function selectEmployee(id) {
  if(busy.value) return;
  clearAction(); const employee=employees.value.find(item=>item.id===id); status.value=null;
  if(!employee) { form.value.employeeId=''; return; }
  hydrate(employee,null); const generation=++readGeneration; const epoch=scopeEpoch; loading.value=true; error.value='';
  try { const value=await api.phoneMcpStatus(id,props.workspace); if(!disposed && generation===readGeneration && epoch===scopeEpoch) { status.value=value; hydrate(employee,value.configuration); } }
  catch(cause) { if(!disposed && generation===readGeneration) error.value=cause.message; }
  finally { if(!disposed && generation===readGeneration) loading.value=false; }
}
function selectComputer(id) { form.value.targetDeviceId=id; form.value.runtime=''; profileChoice.value=''; allowTrial.value=false; }
function selectRuntime(name) { form.value.runtime=name; profileChoice.value=''; allowTrial.value=false; }
async function save() {
  if(!canSave.value) return;
  const epoch=scopeEpoch; const employeeId=form.value.employeeId; const workspace=props.workspace; const {enabled,phoneDeviceId,targetDeviceId,runtime,runtimeProfile,accountId,accountLabel}=selection.value; busy.value='save'; error.value='';
  try {
    if(!setup.value.skill?.installed) { await api.toggleSkill(setup.value.skill.id,true); if(disposed || epoch!==scopeEpoch) return; setup.value.skill.installed=true; }
    await api.savePhoneMcp(employeeId,{enabled,phoneDeviceId,targetDeviceId,runtime,runtimeProfile:runtimeProfile || null,accountId,accountLabel},workspace);
    if(disposed || epoch!==scopeEpoch) return;
    clearAction(); await refresh(); emit('changed');
  } catch(cause) { if(!disposed && epoch===scopeEpoch) error.value=cause.message; }
  finally { if(!disposed && epoch===scopeEpoch) busy.value=''; }
}
async function pollAction(id, epoch, workspace, deadline) {
  try {
    const value=await api.phoneMcpAction(id,workspace);
    if(disposed || epoch!==scopeEpoch || actionJob.value?.id!==id) return;
    actionJob.value={...actionJob.value,...value.action}; await refresh();
    if(terminalStates.has(actionJob.value?.status)) { busy.value=''; trialKey.value=''; return; }
    if(Date.now()>deadline) { busy.value=''; error.value='仍在等待原动作回执，请继续读取本次回执。'; return; }
    actionTimer=setTimeout(()=>pollAction(id,epoch,workspace,deadline),1000);
  } catch(cause) { if(!disposed && epoch===scopeEpoch) { busy.value=''; error.value=`回执读取中断：${cause.message}。请继续读取原动作，避免重复试运行。`; } }
}
async function perform(kind) {
  if(kind==='check' ? !canCheck.value : !canTrial.value) return;
  const epoch=scopeEpoch; const workspace=props.workspace; const employeeId=form.value.employeeId; busy.value=kind; error.value='';
  try {
    if(kind==='trial' && !trialKey.value) trialKey.value=crypto.randomUUID();
    const value=kind==='check' ? await api.checkPhoneMcp(employeeId,workspace) : await api.trialPhoneMcp(employeeId,{action:'health',idempotencyKey:trialKey.value},workspace);
    if(disposed || epoch!==scopeEpoch) return;
    if(!value.action?.id) throw new Error('服务端未返回可读取的动作 ID，请刷新状态核对。');
    actionJob.value={...value.action,kind}; await refresh();
    actionTimer=setTimeout(()=>pollAction(value.action.id,epoch,workspace,Date.now()+120000),1000);
  } catch(cause) { if(!disposed && epoch===scopeEpoch) { busy.value=''; error.value=kind==='trial' ? `${cause.message}。提交结果尚待核对，再次点击会使用同一幂等键读取原试运行。` : cause.message; } }
}
function resumeAction() { if(actionJob.value?.id) { error.value=''; pollAction(actionJob.value.id,scopeEpoch,props.workspace,Date.now()+120000); } }
async function selectSource(slug) {
  sourceWorkspace.value=slug; sourceDeviceId.value=''; sourceComputers.value=[]; grantError.value=''; const generation=++sourceGeneration; sourceLoading.value=true;
  try { const value=await api.managementMcpDiscovery(slug); if(!disposed && generation===sourceGeneration) sourceComputers.value=value.devices || []; }
  catch(cause) { if(!disposed && generation===sourceGeneration) grantError.value=cause.message; }
  finally { if(!disposed && generation===sourceGeneration) sourceLoading.value=false; }
}
async function pollGrant(epoch, deadline) {
  try {
    const value=await api.deviceWorkspaceGrants(props.workspace); if(disposed || epoch!==scopeEpoch) return;
    grant.value=value.grants?.find(item=>item.id===grant.value?.id) || grant.value; await refresh();
    if(Date.now()<deadline && !grantedComputerConnected.value && !grant.value?.revoked_at) grantTimer=setTimeout(()=>pollGrant(epoch,deadline),2500);
  } catch(cause) { if(!disposed && epoch===scopeEpoch) grantError.value=`授权回执读取失败：${cause.message}。可刷新当前配置状态。`; }
}
async function authorizeComputer() {
  if(!owner.value || grantBusy.value || !sourceOptions.value.some(item=>item.value===sourceWorkspace.value) || !sourceComputers.value.some(device=>device.id===sourceDeviceId.value && device.status==='online')) return;
  const epoch=scopeEpoch; grantBusy.value=true; grantError.value='';
  try { const value=await api.grantDeviceWorkspace({sourceWorkspace:sourceWorkspace.value,sourceDeviceId:sourceDeviceId.value},props.workspace); if(disposed || epoch!==scopeEpoch) return; grant.value=value.grant || value; grantTimer=setTimeout(()=>pollGrant(epoch,Date.now()+120000),2500); }
  catch(cause) { if(!disposed && epoch===scopeEpoch) grantError.value=cause.message; }
  finally { if(!disposed && epoch===scopeEpoch) grantBusy.value=false; }
}
watch(()=>[props.workspace,props.employeeId,props.phoneDeviceId],()=>{
  scopeEpoch++; readGeneration++; sourceGeneration++; clearAction(); clearTimeout(grantTimer); setup.value=null; status.value=null; sourceWorkspace.value=''; sourceDeviceId.value=''; sourceComputers.value=[]; sourceLoading.value=false; grantBusy.value=false; grant.value=null; grantError.value=''; form.value={employeeId:'',enabled:true,targetDeviceId:'',runtime:'',phoneDeviceId:'',accountId:'',accountLabel:''}; profileChoice.value=''; void refresh({initial:true});
},{immediate:true});
onUnmounted(()=>{disposed=true;scopeEpoch++;readGeneration++;sourceGeneration++;clearTimeout(actionTimer);clearTimeout(grantTimer);});
</script>

<template>
  <ZiModal title="手机技能配置" wide @close="emit('close')">
    <section class="phone-skill-setup" data-testid="phone-skill-setup">
      <header class="phone-setup-heading"><div><h2>配置手机 MCP 技能</h2><p>选择精确员工、电脑和手机，由平台安全配置，再核对实际加载与实机回执。</p></div><button type="button" class="pill" aria-label="关闭配置向导" @click="emit('close')">关闭</button></header>
      <div class="phone-setup-stage" data-testid="phone-setup-stage"><ZiStatusTag :status="phase.tone" :label="phase.label" dot/><p>{{ phase.reason }}</p></div>
      <p v-if="loading" role="status">正在读取保存配置、设备心跳和动作回执…</p>
      <p v-if="error" role="alert" class="phone-setup-error">{{ error }}</p>
      <div class="phone-setup-tools"><button type="button" class="pill" :disabled="loading" @click="refresh()">刷新配置状态</button><button v-if="actionActive && !busy" type="button" class="pill" @click="resumeAction">继续读取本次回执</button></div>
      <template v-if="setup">
        <section class="phone-setup-section"><h3>1 · 工作区与员工</h3><div class="phone-setup-fields">
          <label><span>工作区</span><ZiSelect :model-value="workspace" :options="workspaceOptions" :disabled="Boolean(busy) || grantBusy" aria-label="工作区" @update:model-value="emit('workspace',$event)"/></label>
          <label><span>数字员工</span><ZiSelect :model-value="form.employeeId" :options="employeeOptions" :disabled="Boolean(busy)" placeholder="明确选择员工" aria-label="数字员工" @update:model-value="selectEmployee"/></label>
        </div><p v-if="!employees.length">当前工作区没有数字员工，可先通过现有员工表单创建，再继续配置。</p><button v-if="canManage" type="button" class="pill" :disabled="Boolean(busy)" @click="emit('create-employee')">创建新员工</button><p>平台技能：{{ setup.skill?.name || '手机控制' }} · 版本 {{ setup.skill?.version || '未返回' }} · {{ setup.skill?.installed ? '目录已安装' : '目录未安装' }}</p></section>
        <section class="phone-setup-section"><h3>2 · 电脑、运行时与配置</h3><div class="phone-setup-fields">
          <label><span>目标电脑</span><ZiSelect :model-value="form.targetDeviceId" :options="computerOptions" aria-label="目标电脑" placeholder="等待当前工作区发现电脑" :disabled="!canEdit" @update:model-value="selectComputer"/></label>
          <label><span>运行时</span><ZiSelect :model-value="form.runtime" :options="runtimeOptions" aria-label="运行时" placeholder="选择此电脑实际发现的运行时" :disabled="!canEdit || !selectedComputer" @update:model-value="selectRuntime"/></label>
          <label><span>运行配置 Profile</span><ZiSelect v-model="profileChoice" :options="profileOptions" aria-label="运行配置 Profile" placeholder="明确选择已发现的配置" :disabled="!canEdit || !selectedRuntime"/></label>
        </div><p v-if="form.runtime==='Hermes'">Hermes 使用独立 profile，保留原主 profile。</p><ul v-if="form.targetDeviceId && !readiness.ready" class="phone-setup-issues"><li v-for="issue in readiness.issues" :key="issue">{{ issue }}</li></ul><p v-else-if="selectedComputer">电脑与 CLI 发现结果已读取，实际 MCP 加载由下一步检测确认。</p>
          <details v-if="owner && sourceOptions.length" class="phone-computer-grant" data-testid="phone-computer-grant" :open="!computers.length || Boolean(grant)"><summary>授权已有电脑连接当前工作区</summary><p>仅可选择你同时拥有 Owner 权限的来源工作区。原工作区连接继续保留，当前工作区收到真实心跳后才能选择该电脑。</p><div class="phone-setup-fields"><label><span>来源工作区</span><ZiSelect :model-value="sourceWorkspace" :options="sourceOptions" :disabled="grantBusy" aria-label="来源工作区" @update:model-value="selectSource"/></label><label><span>来源电脑</span><ZiSelect v-model="sourceDeviceId" :options="sourceComputerOptions" aria-label="来源电脑" :disabled="grantBusy || sourceLoading || !sourceWorkspace"/></label></div><button type="button" class="pill" :disabled="grantBusy || !sourceComputers.some(device=>device.id===sourceDeviceId && device.status==='online')" @click="authorizeComputer">{{ grantBusy ? '提交授权中…' : '授权此电脑连接当前工作区' }}</button><p v-if="grant">授权已保存 · {{ grant.id }} · {{ grant.revoked_at ? '授权已撤销' : grantedComputerConnected ? '当前工作区已收到此电脑真实心跳' : grant.claimed_at ? '授权已领取，等待电脑真正连接当前工作区' : '等待电脑真正连接当前工作区' }}</p><p v-if="grantError" role="alert" class="phone-setup-error">{{ grantError }}</p></details>
        </section>
        <section class="phone-setup-section"><h3>3 · 精确手机绑定</h3><label><span>绑定手机</span><ZiSelect v-model="form.phoneDeviceId" :options="phoneOptions" aria-label="绑定手机" placeholder="选择真实入网手机" :disabled="!canEdit"/></label><p v-if="selectedPhone">手机 ID：<code>{{ selectedPhone.id }}</code> · {{ phoneOnline(selectedPhone) ? '控制端在线' : '等待手机控制端上线' }}</p><p v-if="!phones.length">当前尚未发现已入网手机，请在紫薇·互联完成入网审批后刷新。</p><div class="phone-setup-fields"><label><span>外部账号 ID（可选）</span><input v-model="form.accountId" :disabled="!canEdit" maxlength="200"/></label><label><span>账号显示名（可选）</span><input v-model="form.accountLabel" :disabled="!canEdit" maxlength="200"/></label></div></section>
        <section class="phone-setup-section"><h3>4 · 保存安全配置</h3><p>平台安装并挂载手机技能，保存精确目标和绑定。认证通过平台与电脑安全交接，页面不读取密钥，也无需手改配置文件。</p><label class="phone-setup-checkbox"><input v-model="form.enabled" type="checkbox" :disabled="!canEdit"/>启用手机 MCP</label><button type="button" class="pill phone-setup-primary" :disabled="!canSave" @click="save">{{ busy==='save' ? '保存中…' : '保存安全配置' }}</button><p v-if="!canManage">当前为只读访问，配置需由工作区管理员保存。</p></section>
        <section class="phone-setup-section"><h3>5 · 检测与只读试运行</h3><div class="phone-setup-tools"><button type="button" class="pill" :disabled="!canCheck" @click="perform('check')">检测 MCP 加载</button><button type="button" class="pill phone-setup-primary" :disabled="!canTrial" @click="perform('trial')">只读试运行</button></div><p>检测读取实际 MCP 初始化与工具列表；试运行仅对所选手机执行一次健康检查。成功保存、API 健康或配置注入均不会计作实机通过。</p><label class="phone-setup-checkbox"><input v-model="allowTrial" type="checkbox" :disabled="!canEdit || !matches || !status?.receipt?.loaded"/>允许在所选手机执行只读健康检查</label><p v-if="actionJob">本次动作：<code>{{ actionJob.id }}</code> · {{ actionJob.status }}。等待期间只读取原动作回执。</p></section>
        <section class="phone-setup-evidence"><article data-testid="phone-config-evidence"><h4>保存与技能</h4><p>{{ status?.configuration?.saved ? '配置已保存' : '尚未保存员工配置' }} · {{ status?.configuration?.enabled ? '已开启' : '未开启' }}</p><p data-testid="phone-credential-evidence">认证：{{ status?.configuration?.credential?.configured ? '已配置执行时短期凭据' : '尚未配置' }} · {{ status?.configuration?.credential?.managed ? '平台托管' : '尚未确认托管' }}</p><p>版本 {{ status?.configuration?.skill_version || setup.skill?.version || '未返回' }} · 修订 {{ status?.configuration?.revision || '无' }}</p></article><article data-testid="phone-api-evidence"><h4>手机控制 API</h4><p>{{ status?.api?.status || setup.api?.status || '尚未读取' }}</p><p v-if="status?.api?.error || setup.api?.error">{{ phoneErrorText(status?.api?.error || setup.api?.error) }}</p></article><article data-testid="phone-discovery-evidence"><h4>真实设备发现</h4><p>电脑 {{ selectedComputer?.name || '未选择' }} · {{ selectedComputer?.status || '未发现' }}</p><p>手机 {{ selectedPhone?.alias || selectedPhone?.name || '未选择' }} · {{ phoneOnline(selectedPhone) ? '在线' : '等待手机' }}</p></article><article data-testid="phone-load-evidence"><h4>MCP 加载回执</h4><p>{{ status?.receipt?.status || 'never_run' }} · {{ status?.receipt?.loaded ? '已实际加载' : status?.receipt?.injected ? '已注入，待加载' : '尚无加载证据' }}</p><p v-if="status?.receipt?.action_id">动作 <code>{{ status.receipt.action_id }}</code></p><p v-if="status?.receipt?.error">{{ phoneErrorText(status.receipt.error) }}</p><ul v-if="status?.receipt?.tool_calls?.length"><li v-for="(call,index) in status.receipt.tool_calls" :key="index"><code>{{ call.toolName || call.tool_name }}</code> · {{ call.ok === true ? '成功' : '未成功' }}</li></ul></article><article data-testid="phone-verification-evidence"><h4>实机命令回执</h4><p>{{ status?.verification?.status || 'never_run' }}</p><p>手机 <code>{{ status?.verification?.device_id || '无' }}</code></p><p>command_id: <code>{{ status?.verification?.command_id || '尚无真实命令' }}</code></p><p v-if="status?.verification?.error">{{ phoneErrorText(status.verification.error) }}</p><p v-if="!matches && status?.configuration?.saved">此回执属于已保存配置，不能验证当前未保存的选择。</p></article></section>
      </template>
    </section>
  </ZiModal>
</template>

<style scoped>
:global(.ziwei-modal:has(.phone-skill-setup)) { width:min(920px,calc(100vw - 24px)); max-width:calc(100vw - 24px); max-height:calc(100dvh - 24px); }
.phone-skill-setup { min-width:0; max-width:100%; color:var(--ziwei-ink); }
.phone-setup-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
h2 { margin:0; font-size:20px; } h3 { margin:0 0 12px; font-size:15px; } h4 { margin:0 0 8px; font-size:13px; }
p,li,summary { color:var(--ziwei-muted); font-size:12px; line-height:1.7; overflow-wrap:anywhere; }
.phone-setup-stage { margin:18px 0; padding:14px; border:1px solid var(--ziwei-line); border-radius:10px; background:var(--ziwei-canvas); }
.phone-setup-stage p { margin:8px 0 0; }
.phone-setup-section { margin:18px 0; padding-top:18px; border-top:1px solid var(--ziwei-line); }
.phone-setup-fields,.phone-setup-evidence { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
label { display:grid; min-width:0; gap:7px; margin:8px 0; color:var(--ziwei-muted); font-size:12px; }
label input:not([type="checkbox"]) { box-sizing:border-box; min-width:0; width:100%; height:36px; padding:0 10px; border:1px solid var(--ziwei-line); border-radius:7px; color:var(--ziwei-ink); background:var(--ziwei-surface); }
.phone-setup-checkbox { display:flex; align-items:center; gap:8px; line-height:1.6; }
.phone-setup-checkbox input { flex:none; }
.phone-setup-tools { display:flex; flex-wrap:wrap; gap:8px; }
.phone-setup-primary { color:#fff; border-color:#2f6fca; background:#2f6fca; }
button:disabled { opacity:.5; cursor:default; }
.phone-setup-error { padding:10px 12px; border:1px solid #efcaca; border-radius:8px; color:#a43142; background:#fff6f7; }
.phone-computer-grant { margin-top:14px; padding:12px; border:1px solid var(--ziwei-line); border-radius:8px; background:var(--ziwei-canvas); }
.phone-computer-grant summary { cursor:pointer; color:var(--ziwei-violet); }
.phone-setup-evidence article { min-width:0; padding:14px; border:1px solid var(--ziwei-line); border-radius:9px; background:var(--ziwei-canvas); }
code { font:11px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace; overflow-wrap:anywhere; }
@media(max-width:640px) { .phone-setup-fields,.phone-setup-evidence { grid-template-columns:1fr; } h2 { font-size:18px; } .phone-setup-heading { flex-wrap:wrap; } }
</style>
