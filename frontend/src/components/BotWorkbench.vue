<script setup>
import {computed,defineAsyncComponent,onBeforeUnmount,reactive,ref,watch} from 'vue';
import {Bot,Plus,MessageCircle,Settings2,Clock3,Activity,RefreshCw,ChevronRight,Pause,Play,Square,ShieldCheck,Sparkles,ArrowLeft,Search} from 'lucide-vue-next';
import {ZiButton,ZiModal,ZiFormField,ZiInput,ZiTextarea} from '@ziwei/ui';
import ZiSelect from './ZiSelect.vue';
import {api} from '../api.js';
import {createBotWorkbench,defaultBotConfig,botPresence,capabilityPresentation,executionUncertain} from '../bot-workbench.js';
import {botErrorMessage,botTime} from '../bot-state.js';
import {employeeReadiness} from '../management-mcp.js';
import {nativeRoutineDriver,routineDriver} from '../bot-native-data.js';
const BotNativeWorkspace=defineAsyncComponent(()=>import('./BotNativeWorkspace.vue'));

const props=defineProps({workspace:{type:String,required:true},actorId:{type:String,default:''},botId:{type:String,default:''},models:{type:Array,default:()=>[]},skills:{type:Array,default:()=>[]},initialTab:{type:String,default:'chat'}});
const emit=defineEmits(['select','section','chat','employee','creator','changed']);
const previewMode=import.meta.env.VITE_ZIWEI_PREVIEW==='true';
const workbench=createBotWorkbench({api,wrap:reactive});const s=workbench.state;
const tab=ref(props.initialTab),search=ref(''),discovery=ref(null),discoveryError=ref(''),discoveryLoading=ref(false);
const showCreate=ref(false),createBusy=ref(false),createError=ref(''),createForm=ref({}),createKey=ref('');
const routineEditor=ref(null),routineForm=ref({}),routineKey=ref(''),routineScope=ref(null);
const routineKind=ref('prompt'),routineTarget=ref('');
const nativeBlocked=ref(false),nativeTabs=['knowledge','collaboration','channels','proactive'];
let generation=0,disposed=false,pollTimer=null;
const tabs=[['chat','聊天',MessageCircle],['settings','基础配置',Settings2],['capabilities','能力组合',Sparkles],['knowledge','资料与工具',Settings2],['collaboration','伙伴协作',MessageCircle],['channels','消息与音频',MessageCircle],['proactive','主动工作',Activity],['routines','例行工作',Clock3],['activity','运行记录',Activity]];
const bots=computed(()=>s.bots.filter(item=>`${item.employee?.name || ''} ${item.employee?.description || ''}`.toLowerCase().includes(search.value.toLowerCase())));
const selectedDevice=computed(()=>discovery.value?.devices?.find(item=>item.id===s.bot?.employee?.target_device_id));
const deviceOptions=computed(()=>[{value:'',label:'选择当前工作区的电脑'},...(discovery.value?.devices || []).map(device=>({value:device.id,label:`${device.name || device.id} · ${device.status==='online'?'在线':'离线'}`}))]);
const createDevice=computed(()=>discovery.value?.devices?.find(item=>item.id===createForm.value.targetDeviceId));
const createRuntime=computed(()=>createDevice.value?.runtimes?.find(item=>item.name==='Hermes'));
const profileOptions=computed(()=>[{value:'',label:'选择已发现的 Hermes profile'},...(createRuntime.value?.profiles || []).map(profile=>({value:typeof profile==='string'?profile:profile.name,label:typeof profile==='string'?profile:profile.name}))]);
const createReadiness=computed(()=>employeeReadiness(discovery.value,{deviceId:createForm.value.targetDeviceId,runtime:'Hermes',profile:createForm.value.runtimeProfile}));
const modelOptions=computed(()=>[{value:'',label:'沿用来源 profile 模型'},...props.models.map(model=>({value:model.id,label:model.label || model.id}))]);
const present=computed(()=>botPresence(s.bot));
const configDirty=computed(()=>s.draft && s.bot && (s.draft.revision!==s.bot.revision || JSON.stringify(s.draft.config)!==JSON.stringify(s.bot.config) || ['name','description','instructions','persona'].some(key=>s.draft.employee[key] !== (s.bot.employee?.[key] || '')) || (s.draft.employee.model || null)!==(s.bot.employee?.model_id || null) || JSON.stringify(s.draft.employee.skills)!==JSON.stringify(s.bot.employee?.skills || []) || (s.draft.employee.avatar||null)!==(s.bot.employee?.avatar||null) || s.draft.employee.visibility!==(s.bot.employee?.visibility||'personal')));
const validationLabel=computed(()=>({not_checked:'尚未检查',pending:'检查中',succeeded:'配置检查通过',failed:'检查失败',stale:'配置已变更，需重新检查'}[s.bot?.validation?.status] || '状态待确认'));
const nextRoutine=computed(()=>s.routines.filter(item=>item.status==='active'&&item.next_run).sort((a,b)=>Date.parse(a.next_run)-Date.parse(b.next_run))[0]);
const activeRun=computed(()=>s.bot?.latest_run);
const runBusy=computed(()=>['pending','acked','running','queued'].includes(activeRun.value?.status) || executionUncertain(activeRun.value));
const checkedCurrent=computed(()=>s.bot?.validation?.status==='succeeded' && s.bot.validation.revision===s.bot.revision);
const toolsetsText=computed({get:()=>s.draft?.config.toolsets?.join('\n') || '',set:value=>{s.draft.config.toolsets=value.split(/[\n,]/).map(item=>item.trim()).filter(Boolean);}});
const disabledSkillsText=computed({get:()=>s.draft?.config.skills?.disabled?.join('\n') || '',set:value=>{s.draft.config.skills.disabled=value.split(/[\n,]/).map(item=>item.trim()).filter(Boolean);}});
const autoLoadSkillsText=computed({get:()=>s.draft?.config.skills?.autoLoad?.join('\n')||'',set:value=>{s.draft.config.skills.autoLoad=value.split(/[\n,]/).map(item=>item.trim()).filter(Boolean);}});
const managementAllowed=computed({get:()=>s.draft?.config.permissions?.management!==false,set:value=>{s.draft.config.permissions.management=value;}});
const driverBudget=computed({get:()=>s.draft?.config.drivers?.maxTotalTurns??100,set:value=>{s.draft.config.drivers={...s.draft.config.drivers,maxTotalTurns:Number(value)};}});
const driverExpiry=computed({get:()=>s.draft?.config.drivers?.expiresAt||'',set:value=>{s.draft.config.drivers={...s.draft.config.drivers,expiresAt:value||null};}});
function memoryLimit(field){return computed({get:()=>s.draft?.config.memory?.[field]??'',set:value=>{if(value==='')delete s.draft.config.memory[field];else s.draft.config.memory[field]=Number(value);}});}
const memoryCharLimit=memoryLimit('charLimit'),userCharLimit=memoryLimit('userCharLimit');
const capabilities=computed(()=>s.bot?.capabilities || []);
function displayCapability(capability){return previewMode&&capability.status==='available'?{label:'合成流程已验证',tone:'warning'}:capabilityPresentation(capability);}
const scopeCurrent=(visit,workspace)=>!disposed && visit===generation && props.workspace===workspace;

async function loadDiscovery(){
  const visit=generation,workspace=props.workspace;discoveryLoading.value=true;discoveryError.value='';
  try{const value=await api.managementMcpDiscovery(workspace);if(scopeCurrent(visit,workspace))discovery.value=value.workspace===workspace?value:null;}
  catch(error){if(scopeCurrent(visit,workspace))discoveryError.value=botErrorMessage(error);}
  finally{if(scopeCurrent(visit,workspace))discoveryLoading.value=false;}
}
function clearTransientDrafts(){routineEditor.value=null;routineScope.value=null;}
function selectBot(id){if(id===s.selectedId)return;if(configDirty.value&&!window.confirm('当前 Bot 有未保存修改，切换会丢弃草稿。继续切换？'))return;tab.value='chat';clearTransientDrafts();emit('select',id);void workbench.select(id);}
function chat(){if(s.bot?.main_conversation_id)emit('chat',{workspace:props.workspace,employee:s.bot.employee,conversation:{id:s.bot.main_conversation_id},botId:s.bot.id});}
async function refresh(){await Promise.all([workbench.list(),workbench.refresh(),loadDiscovery()]);}
async function save(){if(nativeBlocked.value){s.error='仍有原生操作待核实，请先查看原回执。';return;}if(await workbench.save())emit('changed');}
async function refreshNativeBot(){const reset=!configDirty.value;await workbench.refresh({resetDraft:reset});emit('changed');}
function changeSection(value){if(tab.value===value)return;routineEditor.value=null;tab.value=value;emit('section',value);}
async function initialize(){if(await workbench.initialize())emit('changed');}
async function removeEmployee(){if(!s.bot||!window.confirm('删除数字员工“'+s.bot.employee.name+'”？团队管理与 Bot 视图会同步移除。'))return;const ok=await workbench.mutate((id,workspace)=>api.deleteEmployee(id,workspace),'员工已删除。');if(ok){emit('select','');await workbench.select('');await workbench.list();emit('changed');}}
async function control(operation){if(await workbench.control(operation))emit('changed');}
function newBot(){
  createForm.value={name:'',description:'',persona:'',instructions:'',targetDeviceId:'',runtimeProfile:'',model:'',visibility:'personal'};
  createKey.value=`bot-create-${crypto.randomUUID()}`;createError.value='';showCreate.value=true;void loadDiscovery();
}
async function create(){
  if(createBusy.value || !createForm.value.name.trim() || !createReadiness.value.ready)return;
  const visit=generation,workspace=props.workspace;createBusy.value=true;createError.value='';
  try{
    const result=await api.createBot({...createForm.value,name:createForm.value.name.trim(),model:createForm.value.model || null,config:defaultBotConfig(),idempotencyKey:createKey.value},workspace);
    if(!scopeCurrent(visit,workspace))return;
    showCreate.value=false;await workbench.list();if(!scopeCurrent(visit,workspace))return;
    emit('select',result.id);await workbench.select(result.id);tab.value='settings';emit('changed');
    s.notice='Bot 已创建为待启用状态，主聊天已固定。配置、检查并启用后可开始工作。';
  }catch(error){if(scopeCurrent(visit,workspace))createError.value=botErrorMessage(error,{mutation:true});}
  finally{if(scopeCurrent(visit,workspace))createBusy.value=false;}
}
async function readAvatar(event) {
  const file=event.target.files?.[0];if(!file)return;
  const visit=generation,id=s.selectedId;
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>2*1024*1024){s.error='头像只支持 2 MiB 内的 PNG、JPEG、WebP。';event.target.value='';return;}
  try{const value=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('头像读取失败'));reader.readAsDataURL(file);});if(!disposed&&visit===generation&&id===s.selectedId&&s.draft)s.draft.employee.avatar=value;}catch(error){if(visit===generation&&id===s.selectedId)s.error=error.message;}
  event.target.value='';
}
async function deleteRoutine(routine){if(!window.confirm('删除计划“'+routine.name+'”？已存在的执行结果仍保留。'))return;const ok=await workbench.mutate((id,workspace)=>api.deleteBotRoutine(id,routine.id,workspace),'计划已删除。');if(ok)await workbench.refresh();}
function editRoutine(routine=null,driver=null){const native=driver||routineDriver(routine);routineKind.value=native?.resource||'prompt';routineTarget.value=native?.input?.taskId||native?.input?.groupId||'';routineScope.value={workspace:props.workspace,botId:s.selectedId};routineEditor.value=routine?.id || 'new';routineForm.value={name:routine?.name || '',prompt:routine?.prompt || '',schedule:routine?.schedule || '每天 09:00',timezone:routine?.timezone || 'Asia/Shanghai'};routineKey.value=`bot-routine-${crypto.randomUUID()}`;}
async function saveRoutine(){
  if(!s.bot||routineScope.value?.workspace!==props.workspace||routineScope.value?.botId!==s.selectedId){routineEditor.value=null;s.error='计划编辑归属已变化，请在当前员工重新打开编辑器。';return;}
  const routineId=routineEditor.value,body={...routineForm.value};
  if(routineId==='new'&&routineKind.value!=='prompt'){try{body.nativeDriver=nativeRoutineDriver(routineKind.value,routineTarget.value.trim());}catch(error){s.error=error.message;return;}}
  const ok=await workbench.mutate((id,workspace)=>routineId==='new'?api.createBotRoutine(id,{...body,idempotencyKey:routineKey.value},workspace):api.updateBotRoutine(id,routineId,body,workspace),'例行工作已保存；下一次时间及状态以回读为准。');
  if(ok){routineEditor.value=null;await workbench.refresh();emit('changed');}
}
async function toggleRoutine(routine){const ok=await workbench.mutate((id,workspace)=>api.updateBotRoutine(id,routine.id,{status:routine.status==='active'?'paused':'active'},workspace),'计划状态已保存；不会取消已在执行的工作。');if(ok)await workbench.refresh();}
async function runRoutine(routine){await workbench.runRoutine(routine.id);}
function capabilityTab(id){return ({bot_identity:'settings',model_provider:'settings',routines:'routines',persistent_chat:'chat',profile_memory:'knowledge',session_search:'knowledge',skills:'knowledge',tools_mcp:'knowledge',groups_mentions:'collaboration',delegation:'collaboration',gateway:'channels',voice:'channels',goals:'proactive',heartbeat:'proactive',kanban:'proactive',observability:'activity'})[id]||'capabilities';}
function schedulePoll(){
  clearTimeout(pollTimer);pollTimer=setTimeout(async()=>{
    if(disposed)return;
    if(!document.hidden && s.bot && !s.busy && !s.reading && (s.bot.validation?.status==='pending' || runBusy.value))await workbench.refresh();
    schedulePoll();
  },4000);
}
watch(()=>props.workspace,async workspace=>{
  generation++;clearTransientDrafts();showCreate.value=false;createBusy.value=false;discovery.value=null;tab.value=props.initialTab;
  await Promise.all([workbench.setWorkspace(workspace,props.botId),loadDiscovery()]);
},{immediate:true});
watch(()=>props.botId,id=>{if(id!==s.selectedId){clearTransientDrafts();void workbench.select(id);}});
watch(()=>props.initialTab,value=>{if(tab.value!==value){routineEditor.value=null;tab.value=value;}});
onBeforeUnmount(()=>{disposed=true;generation++;clearTimeout(pollTimer);workbench.dispose();});schedulePoll();
</script>

<template>
  <section class="bot-workbench" aria-label="Hermes Bot 工作台">
    <header class="bot-page-heading"><div><span class="bot-eyebrow">紫薇 · 数字伙伴</span><h1>与你的 Bot 一起工作</h1><p>与团队管理使用同一份数字员工。这里查看长期聊天、能力和例行工作。</p></div><div class="bot-actions"><button class="bot-button" @click="emit('creator')"><Sparkles :size="16"/> 伙伴市场 Creator</button><button class="bot-button primary" @click="newBot"><Plus :size="17"/>创建 Bot</button></div></header>
    <div class="bot-layout">
      <aside class="bot-roster" aria-label="当前工作区 Bot 名册"><div class="bot-roster-top"><strong>Hermes 员工 <small>{{s.bots.length}}</small></strong><button class="bot-icon-button" aria-label="刷新 Bot 列表与状态" :disabled="s.loading||s.reading||s.busy" @click="refresh"><RefreshCw :size="16"/></button></div><label class="bot-search"><Search :size="16"/><input v-model="search" placeholder="搜索名称或岗位" aria-label="搜索 Bot"/></label>
        <p v-if="s.loading&&!s.bots.length" class="bot-empty" role="status">正在读取工作区 Bot…</p>
        <button v-for="item in bots" :key="item.id" class="bot-roster-row" :class="{selected:s.selectedId===item.id}" :aria-current="s.selectedId===item.id?'true':undefined" @click="selectBot(item.id)"><span class="bot-avatar"><img v-if="item.employee?.avatar" :src="item.employee.avatar" alt=""/><span v-else>{{item.employee?.name?.slice(0,1)||'✦'}}</span><i :data-tone="botPresence(item).tone"/></span><span class="bot-roster-copy"><strong>{{item.employee?.name||'未命名 Bot'}}</strong><span>{{item.employee?.description||'Hermes 数字伙伴'}}</span><small>{{botPresence(item).label}}</small></span><ChevronRight :size="14"/></button>
        <div v-if="!s.loading&&!bots.length" class="bot-empty"><Bot :size="30"/><p>{{search?'没有匹配的 Bot':'在当前工作区创建第一个 Bot'}}</p><small>Bot 是同一数字员工的 Hermes 工作视图。创建后也会出现在团队管理。</small></div>
        <footer class="bot-roster-footer">工作区 · {{workspace}}<br/>仅在指定电脑及客户端可用时工作</footer>
      </aside>
      <main class="bot-main" :aria-busy="s.reading||s.busy">
        <p v-if="s.error" class="bot-banner error" role="alert">{{s.error}}</p><p v-if="s.notice" class="bot-banner" role="status">{{s.notice}}</p>
        <div v-if="s.writeUnknown" class="bot-banner warning">操作结果未确认，已暂缓重复提交。<button class="bot-link" @click="workbench.refresh()">重新读取当前状态</button><button v-if="s.pendingOperation?.kind==='routine_run'" class="bot-link" :disabled="s.busy" @click="workbench.recoverRoutine()">按原请求标识查询 / 恢复</button></div>
        <div v-if="s.conflict" class="bot-banner warning">草稿保留在本页，原版本 {{s.draft?.revision}}。<button class="bot-link" @click="workbench.refresh()">读取最新状态（保留草稿）</button><button class="bot-link" @click="workbench.refresh({resetDraft:true})">放弃草稿并采用最新配置</button></div>
        <template v-if="s.bot">
          <header class="bot-detail-heading"><div class="bot-identity"><span class="bot-avatar large"><img v-if="s.bot.employee.avatar" :src="s.bot.employee.avatar" alt=""/><span v-else>{{s.bot.employee.name?.slice(0,1)||'✦'}}</span><i :data-tone="present.tone"/></span><div><h2>{{s.bot.employee.name}}</h2><p>{{s.bot.employee.description||'Hermes 数字伙伴'}}</p><button class="bot-presence" :data-tone="present.tone" @click="changeSection('activity')">{{present.label}} <ChevronRight :size="13"/></button></div></div><div class="bot-actions"><button class="bot-button" @click="emit('employee',s.bot.employee)">在团队管理查看</button><button class="bot-button danger" :disabled="s.busy||s.writeUnknown" @click="removeEmployee">删除员工</button><button class="bot-button primary" :disabled="!s.bot.main_conversation_id" @click="chat"><MessageCircle :size="17"/>打开长期聊天</button></div></header>
          <div class="bot-device-line"><span>{{selectedDevice?.name||'指定电脑'}} · {{selectedDevice?(selectedDevice.status==='online'?'在线':'离线'):'连接待验证'}}</span><span>Hermes · {{s.bot.employee.runtime_profile||'默认 profile'}}</span><span>配置版本 {{s.bot.revision}}</span></div>
          <div v-if="s.bot.configuration_state==='uninitialized'" class="bot-banner"><strong>{{s.bot.kind==='creator'?'Creator 保留原管理路径':'同一员工 · Bot 能力尚未初始化'}}</strong><p>{{s.bot.effect?.pendingReason}}</p><button v-if="s.bot.kind!=='creator'" class="bot-button primary" :disabled="s.busy||s.writeUnknown" @click="initialize">初始化此员工的 Bot 能力</button><button v-else class="bot-button" @click="chat">打开 Creator 原聊天</button></div><nav class="bot-tabs" aria-label="Bot 详情"><button v-for="[key,label,icon] in tabs" :key="key" :aria-current="tab===key?'page':undefined" :class="{selected:tab===key}" @click="changeSection(key)"><component :is="icon" :size="15"/>{{label}}</button></nav>
          <section v-if="tab==='chat'" class="bot-chat-home">
            <div class="bot-conversation-intro"><MessageCircle :size="30"/><h3>继续与 {{s.bot.employee.name}} 的对话</h3><p>聊天记录、执行结果和图片保存在同一条主会话。回来时继续交给这个 Bot。</p><button class="bot-button primary" :disabled="!s.bot.main_conversation_id" @click="chat">进入主聊天 <ChevronRight :size="16"/></button></div>
            <div class="bot-overview-grid"><article class="bot-surface"><h3>现在的状态</h3><strong :data-tone="present.tone">{{present.label}}</strong><p>{{present.detail}}</p><button class="bot-link" @click="changeSection('activity')">查看当前动作与运行记录</button></article><article class="bot-surface"><h3>下一个例行工作</h3><template v-if="nextRoutine"><strong>{{nextRoutine.name}}</strong><p>{{botTime(nextRoutine.next_run,nextRoutine.timezone)}}</p></template><p v-else>还没有启用的 Routine。</p><button class="bot-link" @click="changeSection('routines')">管理这个 Bot 的 Routine</button></article></div>
            <div class="bot-surface"><h3>聊天、记忆和任务各有用途</h3><p>主聊天保存对话历史；长期记忆属于此 Bot 的 Hermes 配置；当前执行及停止回执在运行记录查看。配置已保存并不等于模型或工具已实际验证。</p><button class="bot-link" @click="changeSection('capabilities')">查看记忆及能力设置</button></div>
          </section>
          <section v-else-if="tab==='settings'&&s.draft" class="bot-form-section">
            <div class="bot-section-heading"><div><h3>身份与工作方式</h3><p>这些设置只作用于当前工作区的这个 Bot。</p></div><span class="bot-status" :data-tone="checkedCurrent?'success':'warning'">{{validationLabel}}</span></div>
            <fieldset :disabled="s.busy||s.writeUnknown||s.bot.configuration_state==='uninitialized'"><div class="bot-fields"><label>名称<input v-model="s.draft.employee.name" maxlength="100"/></label><label>岗位 / 简介<input v-model="s.draft.employee.description" maxlength="1000"/></label><label>头像<input type="file" accept="image/png,image/jpeg,image/webp" @change="readAvatar"/><span v-if="s.draft.employee.avatar" class="bot-avatar"><img :src="s.draft.employee.avatar" alt="头像草稿"/></span><button v-if="s.draft.employee.avatar" type="button" class="bot-link" @click="s.draft.employee.avatar=null">恢复姓名头像</button></label><label>可见范围<ZiSelect v-model="s.draft.employee.visibility" :options="[{value:'personal',label:'仅自己'},{value:'workspace',label:'工作区'}]" aria-label="Bot 可见范围"/></label><label class="wide">人格<textarea v-model="s.draft.employee.persona" rows="3" placeholder="希望它以怎样的方式与你协作"/></label><label class="wide">长期职责与交付标准<textarea v-model="s.draft.employee.instructions" rows="5" placeholder="它负责什么，怎样算完成，需要遵守哪些边界"/></label><label>模型<ZiSelect :model-value="s.draft.employee.model||''" :options="modelOptions" aria-label="Bot 模型" @update:model-value="s.draft.employee.model=$event||null"/></label><label>Provider<input v-model="s.draft.config.provider" placeholder="留空沿用来源 profile"/></label></div>
              <details class="bot-advanced"><summary>高级运行设置</summary><div class="bot-fields"><label>单次最多轮数<input v-model.number="s.draft.config.maxTurns" type="number" min="1" max="100"/></label><label>主动工作累计回合上限<input v-model="driverBudget" type="number" min="1" max="1000"/></label><label>主动工作截止时间<input v-model="driverExpiry" placeholder="例如 2026-10-14T18:00:00+08:00"/></label><label class="bot-check"><input v-model="managementAllowed" type="checkbox"/>允许使用工作区管理能力</label><label>工具权限<ZiSelect v-model="s.draft.config.permissions.mode" :options="[{value:'read_only',label:'仅对话（不启用工具）'},{value:'execute',label:'启用明确选择的工具'}]" aria-label="Bot 工具权限"/></label></div><p>设备和来源 profile：{{s.bot.employee.target_device_id}} / {{s.bot.employee.runtime_profile||'默认'}}。迁移不会自动执行；独立状态不代表独立云电脑。</p></details>
            </fieldset>
            <div class="bot-save-bar"><p>运行配置变化后需重新检查；身份展示变化是否即时生效由后端决定。当前草稿基于版本 {{s.draft.revision}}。</p><button class="bot-button primary" :disabled="s.busy||s.writeUnknown||s.bot.configuration_state==='uninitialized'||s.conflict||!s.draft.employee.name.trim()" @click="save">{{s.busy?'处理中…':'保存并读回'}}</button></div>
          </section>
          <section v-else-if="tab==='capabilities'&&s.draft" class="bot-form-section">
            <div class="bot-section-heading"><div><h3>能力组合</h3><p>状态来自后端能力发现。未接入、缺依赖、待验证均保留真实原因。</p></div></div>
            <div class="bot-capability-grid"><article v-for="capability in capabilities" :key="capability.id" class="bot-capability"><div><strong>{{capability.label}}</strong><span class="bot-status" :data-tone="displayCapability(capability).tone">{{displayCapability(capability).label}}</span></div><p>{{previewMode&&capability.status==='available'?'此预览仅收到合成配置回执，真实 Hermes 能力仍待验证。':capability.reason}}</p><details v-if="capability.evidence?.length"><summary>版本与依据</summary><ul><li v-for="(evidence,index) in capability.evidence" :key="index">{{typeof evidence==='string'?evidence:JSON.stringify(evidence)}}</li></ul></details><button v-if="capability.configurable&&capabilityTab(capability.id)!=='capabilities'" class="bot-link" @click="changeSection(capabilityTab(capability.id))">前往设置</button></article></div>
            <p v-if="!capabilities.length" class="bot-banner warning">尚未收到能力目录，不能判断本机 Hermes 能力是否可用。</p>
            <fieldset :disabled="s.busy||s.writeUnknown||s.bot.configuration_state==='uninitialized'"><div class="bot-surface"><h3>记忆与会话</h3><label class="bot-check"><input v-model="s.draft.config.memory.enabled" type="checkbox"/>启用此 Bot 的长期记忆</label><label class="bot-check"><input v-model="s.draft.config.memory.userProfile" type="checkbox"/>启用此 Bot 的用户画像记忆</label><div class="bot-fields"><label>长期记忆字符上限<input v-model="memoryCharLimit" type="number" min="100" max="50000" placeholder="留空沿用原生默认"/></label><label>用户画像字符上限<input v-model="userCharLimit" type="number" min="100" max="50000" placeholder="留空沿用原生默认"/></label></div><p>记忆与主聊天分别保存。正文、用户画像和会话检索在资料与工具中管理。</p><button class="bot-link" @click="changeSection('knowledge')">管理记忆正文与会话</button></div>
              <div class="bot-surface"><h3>技能与工具</h3><p>紫薇技能挂载与 Hermes 原生技能禁用名单分别设置。</p><div class="bot-skill-list"><label v-for="skill in skills" :key="skill.id" class="bot-check"><input v-model="s.draft.employee.skills" type="checkbox" :value="skill.id"/>{{skill.name}}</label><p v-if="!skills.length">当前工作区没有可选择的技能。</p></div><div class="bot-fields"><label>Hermes 原生工具集<textarea v-model="toolsetsText" rows="4" placeholder="每行一个工具集名称；由后端核验"/></label><label>自动加载的 Hermes 原生技能<textarea v-model="autoLoadSkillsText" rows="4" placeholder="每行一个实际技能名称"/></label><label>禁用的 Hermes 原生技能<textarea v-model="disabledSkillsText" rows="4" placeholder="每行一个原生技能名称"/></label></div><p v-if="s.draft.config.permissions.mode==='read_only'">当前为“仅对话”模式。配置工具集或 MCP 前，请在基础配置中明确选择启用工具，否则服务器会拒绝保存。</p></div>
              <div class="bot-surface"><h3>MCP 与高级连接</h3><p>标准输入输出和 HTTP / SSE 在资料与工具中使用同一配置草稿设置。</p><button class="bot-button" @click="changeSection('knowledge')">配置并检查 MCP</button></div>
            </fieldset>
            <div class="bot-save-bar"><p>全部修改统一保存，配置版本 {{s.draft.revision}}。未接入能力的开关不会被虚构。</p><button class="bot-button primary" :disabled="s.busy||s.writeUnknown||s.conflict||s.bot.configuration_state==='uninitialized'" @click="save">保存能力配置并读回</button></div>
          </section>
          <section v-else-if="tab==='routines'" class="bot-form-section">
            <div class="bot-section-heading"><div><h3>{{s.bot.employee.name}} 的 Routine</h3><p>由紫薇现有调度负责，结果回到此 Bot 主聊天。电脑及客户端需保持可用。</p></div><button class="bot-button" :disabled="s.busy||s.writeUnknown||s.bot.configuration_state==='uninitialized'" @click="editRoutine()"><Plus :size="16"/>添加计划</button></div>
            <p v-if="previewMode" class="bot-banner warning">本地预览已关闭自动调度。计划可保存并查看下一次时间；手动运行返回合成结果。</p><p class="bot-banner">调度归属：{{s.bot.scheduler_authority==='ziwei'?'紫薇统一调度':s.bot.scheduler_authority||'待确认'}}。同一工作不另建 Hermes 原生 Cron。</p>
            <div v-if="s.bot.effect" class="bot-banner">生效范围：{{s.bot.effect.scope==='next_execution'?'当前 Bot 的后续执行':s.bot.effect.scope}}；{{s.bot.effect.pendingReason || '服务端未报告待生效原因；实际运行效果需回执验证'}}。</div><div v-if="!s.routines.length" class="bot-empty"><Clock3 :size="32"/><h3>把重复工作交给这个 Bot</h3><p>设置时间、时区和任务内容，每次结果回到同一主聊天。</p></div>
            <article v-for="routine in s.routines" :key="routine.id" class="bot-routine"><div class="bot-section-heading"><h3>{{routine.name}}</h3><span class="bot-status" :data-tone="routine.status==='active'?'success':'muted'">{{routine.status==='active'?'计划已启用':'计划已暂停'}}</span></div><p>{{routine.prompt}}</p><dl><div><dt>计划</dt><dd>{{routine.schedule}} · {{routine.timezone||'时区未返回'}}</dd></div><div><dt>下次运行</dt><dd>{{botTime(routine.next_run,routine.timezone)}}</dd></div><div><dt>结果会话</dt><dd><button class="bot-link" @click="chat">当前 Bot 主聊天</button></dd></div></dl><p v-if="routine.last_result">最近结果：{{routine.last_result.status}} · {{routine.last_result.message||routine.last_result.error||'查看主聊天与运行记录'}}</p><div class="bot-actions"><button class="bot-button" :disabled="s.busy||s.writeUnknown" @click="toggleRoutine(routine)">{{routine.status==='active'?'暂停':'恢复'}}</button><button class="bot-button" :disabled="s.busy||s.writeUnknown||s.bot.control_state!=='active'" @click="runRoutine(routine)">手动运行</button><button class="bot-button" :disabled="s.busy||s.writeUnknown" @click="editRoutine(routine)">编辑</button><button class="bot-button danger" :disabled="s.busy||s.writeUnknown" @click="deleteRoutine(routine)">删除</button><button class="bot-link" @click="changeSection('activity')">结果与失败记录</button></div></article>
            <p class="bot-help">失败或执行待核实时先查看原记录；手动运行会创建新意图，不会重放未知执行。</p>
          </section>
          <section v-else-if="tab==='activity'" class="bot-form-section">
            <div class="bot-section-heading"><div><h3>运行与控制</h3><p>{{present.detail}}</p></div><button class="bot-button" :disabled="s.reading||s.busy" @click="workbench.refresh()"><RefreshCw :size="15"/>刷新回执</button></div>
            <div class="bot-surface"><h3>{{validationLabel}}</h3><p v-if="s.bot.validation?.error" class="bot-error-text">{{s.bot.validation.error}}</p><p>检查会验证本机配置，不调用模型。检查通过不能代替真实工具加载或业务成功。</p><p v-if="previewMode" class="bot-help">此预览的检查由合成 fixture 返回，不证明本机 Hermes 已连接。</p><div class="bot-actions"><button class="bot-button" :disabled="s.busy||s.writeUnknown||s.bot.configuration_state==='uninitialized'||configDirty||runBusy" @click="workbench.validate()"><ShieldCheck :size="16"/>检查已保存配置</button><button v-if="s.bot.control_state==='draft'" class="bot-button primary" :disabled="s.busy||s.writeUnknown||!checkedCurrent||configDirty||runBusy" @click="control('activate')"><Play :size="15"/>启用 Bot</button><button v-else-if="s.bot.control_state==='paused'" class="bot-button" :disabled="s.busy||s.writeUnknown||!checkedCurrent||runBusy" @click="control('resume')"><Play :size="15"/>恢复 Bot</button><button v-else class="bot-button" :disabled="s.busy||s.writeUnknown" @click="control('pause')"><Pause :size="15"/>暂停 Bot</button><button class="bot-button danger" :disabled="s.busy||s.writeUnknown||!runBusy" @click="control('stop')"><Square :size="14"/>请求停止当前执行</button></div><p v-if="configDirty" class="bot-help">有未保存草稿，请先保存，再检查和启用。</p></div>
            <article v-if="s.bot.stop_action" class="bot-surface"><h3>停止请求回执</h3><p>请求 {{s.bot.stop_action.id}} · {{s.bot.stop_action.status}}</p><p v-if="s.bot.stop_action.error" class="bot-error-text">{{s.bot.stop_action.error}}</p><p>停止确认：{{s.bot.stop_action.result?.stopConfirmed===true?'回执已确认停止':'尚未确认目标执行已停止'}}。最终结果以原执行记录为准。</p></article><div v-if="!s.runs.length" class="bot-empty">尚无运行记录。状态未知时不会显示为已成功。</div>
            <article v-for="run in s.runs" :key="run.id" class="bot-run"><div><strong>{{run.type==='hermes.bot.validate'?'配置检查':run.type||'工作执行'}}</strong><span class="bot-status" :data-tone="executionUncertain(run)?'warning':run.status==='succeeded'?'success':run.status==='failed'?'error':'muted'">{{executionUncertain(run)?'执行待核实':({succeeded:'已完成',failed:'失败',pending:'等待接收',acked:'执行中',cancelled:'已取消',expired:'已过期'}[run.status]||run.status)}}</span></div><time>{{botTime(run.created_at)}}</time><p v-if="run.error" class="bot-error-text">{{run.error}}</p><details><summary>查看执行标识与回执</summary><p>执行 ID：{{run.id}}</p><p>完成时间：{{botTime(run.completed_at)}}</p><p v-if="run.result?.executionState">执行状态：{{run.result.executionState}}</p><p v-if="run.result?.stopConfirmed!==undefined">停止确认：{{run.result.stopConfirmed?'已确认':'尚未确认'}}</p><p v-if="run.result?.processExit">根进程退出：{{run.result.processExit.rootConfirmed===true?'已确认':'待核实'}}；执行树退出：{{run.result.processExit.treeConfirmed===true?'已确认':'待核实'}}</p><p v-for="event in (run.events||[])" :key="event.id">{{event.message||event.type}}</p><button class="bot-link" @click="chat">进入主聊天查看结果与产物</button></details></article>
          </section>
          <BotNativeWorkspace v-if="s.draft" :key="actorId" v-show="nativeTabs.includes(tab)" :workspace="workspace" :actor-id="actorId" :bot="s.bot" :draft="s.draft" :bots="s.bots" :section="tab" :config-busy="s.busy||s.writeUnknown||nativeBlocked" :refresh-bot="refreshNativeBot" @busy="nativeBlocked=$event" @save-config="save" @stop-current="control('stop')"/>
        </template>
        <div v-else class="bot-start"><Bot :size="48"/><h2>{{s.reading?'正在读取 Bot…':'选择一个长期合作的伙伴'}}</h2><p>从左侧选择 Bot，继续聊天、查看进展或调整能力。</p><button v-if="!s.reading" class="bot-button primary" @click="newBot">创建 Hermes Bot</button></div>
      </main>
    </div>
    <ZiModal v-if="showCreate" title="创建 Hermes Bot" wide @close="!createBusy&&(showCreate=false)"><form class="bot-dialog-form" @submit.prevent="create"><p>在当前工作区创建独立 Bot。先保存为草稿，检查并启用后才开始工作。</p><p v-if="createError" role="alert" class="bot-banner error">{{createError}}</p><fieldset :disabled="createBusy"><div class="bot-fields"><label>名称<input v-model="createForm.name" required maxlength="100" placeholder="例如：资料研究员"/></label><label>岗位 / 简介<input v-model="createForm.description" placeholder="它主要负责什么"/></label><label>运行电脑<ZiSelect v-model="createForm.targetDeviceId" :options="deviceOptions" aria-label="新 Bot 运行电脑" @update:model-value="createForm.runtimeProfile=''"/></label><label>Hermes profile<ZiSelect v-model="createForm.runtimeProfile" :options="profileOptions" aria-label="新 Bot Hermes profile"/></label><label class="wide">人格<textarea v-model="createForm.persona" rows="2" placeholder="沟通风格与合作习惯"/></label><label class="wide">职责<textarea v-model="createForm.instructions" rows="3" placeholder="工作职责、交付标准和边界"/></label></div><details class="bot-advanced"><summary>模型与可见范围</summary><div class="bot-fields"><label>模型<ZiSelect v-model="createForm.model" :options="modelOptions" aria-label="新 Bot 模型"/></label><label>可见范围<ZiSelect v-model="createForm.visibility" :options="[{value:'personal',label:'仅自己'},{value:'workspace',label:'工作区'}]" aria-label="新 Bot 可见范围"/></label></div></details></fieldset><p v-if="discoveryError" class="bot-error-text">{{discoveryError}}</p><p v-if="createForm.targetDeviceId&&!createReadiness.ready" class="bot-help">{{createReadiness.issues.join('；')}}</p><div class="bot-dialog-actions"><button type="button" class="bot-button" :disabled="discoveryLoading||createBusy" @click="loadDiscovery">刷新环境</button><button type="submit" class="bot-button primary" :disabled="createBusy||!createForm.name?.trim()||!createReadiness.ready">{{createBusy?'创建中…':'创建并配置'}}</button></div></form></ZiModal>
    <ZiModal v-if="routineEditor&&s.bot" :title="routineEditor==='new'?'添加 Routine':'编辑 Routine'" @close="!s.busy&&(routineEditor=null)"><form class="bot-dialog-form" @submit.prevent="saveRoutine"><p>负责 Bot：{{s.bot?.employee.name}} · 结果回到它的主聊天</p><p v-if="s.error" role="alert" class="bot-banner error">{{s.error}}</p><fieldset :disabled="s.busy||s.writeUnknown||s.bot.configuration_state==='uninitialized'"><div class="bot-fields"><label class="wide">名称<input v-model="routineForm.name" required/></label><label>计划<input v-model="routineForm.schedule" required placeholder="每天 09:00 / 五段 Cron"/></label><label>时区<input v-model="routineForm.timezone" required placeholder="Asia/Shanghai"/></label><label class="wide">运行内容<select v-model="routineKind" :disabled="routineEditor!=='new'"><option value="prompt">普通工作指令</option><option value="goals">推进原生 Goal</option><option value="heartbeat">执行到期的 Heartbeat</option><option value="kanban">派发原生 Kanban 工作</option><option value="groups">推进原生群组一次</option></select></label><label v-if="routineKind==='prompt'" class="wide">工作内容<textarea v-model="routineForm.prompt" rows="5" required/></label><label v-if="['kanban','groups'].includes(routineKind)" class="wide">原生工作 / 群组标识<input v-model="routineTarget" :disabled="routineEditor!=='new'" required/></label><p v-if="routineKind!=='prompt'" class="wide">每次触发只进入所选原生管理器的有界推进。状态、回合预算和是否到期由同一 Bot 核对。</p></div></fieldset><p class="bot-help">计划由服务器验证。保存后显示真实下一次时间；本页不会另建 Hermes Cron。</p><div class="bot-dialog-actions"><button type="submit" class="bot-button primary" :disabled="s.busy||s.writeUnknown||s.bot.configuration_state==='uninitialized'">保存 Routine</button></div></form></ZiModal>
  </section>
</template>

<style scoped src="../bot-workbench.css"></style>
