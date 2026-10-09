<script setup>
import {computed,onBeforeUnmount,ref,watch} from 'vue';
import {api} from '../api.js';
import {creatorSelection,creatorInstancePayload} from '../creator-market.js';
import {managementPreparation} from '../management-mcp.js';
import ZiSelect from './ZiSelect.vue';

const props=defineProps({workspace:{type:String,required:true},discovery:{type:Object,default:null},discoveryLoading:Boolean,discoveryError:{type:String,default:''},models:{type:Array,default:()=>[]}});
const emit=defineEmits(['refresh-discovery','open']);
const templates=ref([]),loading=ref(false),busy=ref(false),error=ref(''),deviceId=ref(''),runtime=ref('Codex'),profile=ref(''),model=ref('default');
let generation=0,disposed=false;
const template=computed(()=>templates.value.find(item=>item.id==='ziwei-employee-creator'));
const instance=computed(()=>template.value?.instance);
const devices=computed(()=>props.discovery?.workspace===props.workspace?props.discovery.devices||[]:[]);
const device=computed(()=>devices.value.find(item=>item.id===deviceId.value));
const deviceOptions=computed(()=>[{value:'',label:'请选择可用电脑'},...devices.value.map(item=>({value:item.id,label:`${item.name||item.id} · ${item.status==='online'?'在线':'离线'}`}))]);
const runtimeOptions=computed(()=>(template.value?.supportedRuntimes||['Codex','Hermes']).map(name=>({value:name,label:name,disabled:!device.value?.runtimes?.some(item=>item.name===name)})));
const selection=computed(()=>creatorSelection(props.discovery?.workspace===props.workspace?props.discovery:null,{deviceId:deviceId.value,runtime:runtime.value,profile:profile.value},template.value?.supportedRuntimes));
const preparation=computed(()=>managementPreparation(device.value?.management_mcp));
const profileOptions=computed(()=>[{value:'',label:'使用实际就绪默认配置'},...selection.value.profiles.map(name=>({value:name,label:name}))]);
const modelOptions=computed(()=>[{value:'default',label:'沿用 CLI / profile 的模型'},...props.models.map(item=>({value:item.id,label:item.label||item.id}))]);
const current=(request,workspace)=>!disposed&&request===generation&&workspace===props.workspace;
async function refresh(){
  const request=++generation,workspace=props.workspace;loading.value=true;error.value='';
  try{const result=await api.employeeTemplates(workspace);if(current(request,workspace))templates.value=Array.isArray(result.templates)?result.templates:[];}
  catch(cause){if(current(request,workspace))error.value=cause.message||'无法读取伙伴市场，请重试。';}
  finally{if(current(request,workspace))loading.value=false;}
}
function refreshAll(){emit('refresh-discovery');void refresh();}
function changeDevice(){profile.value='';model.value='default';const available=device.value?.runtimes?.filter(item=>['Codex','Hermes'].includes(item.name))||[];if(!available.some(item=>item.name===runtime.value))runtime.value=available[0]?.name||'Codex';}
function changeRuntime(){profile.value='';model.value='default';}
async function create(startExisting=false){
  if(busy.value||!template.value)return;
  const workspace=props.workspace,request=++generation;busy.value=true;error.value='';
  try{
    const body=startExisting?{}:creatorInstancePayload(props.discovery,{deviceId:deviceId.value,runtime:runtime.value,profile:profile.value,model:model.value},template.value.supportedRuntimes);
    const result=await api.createEmployeeTemplateInstance(template.value.id,body,workspace);
    if(current(request,workspace))emit('open',{...result,workspace});
  }catch(cause){
    if(current(request,workspace)){
      error.value=cause.message||'创建未完成，请修正配置后重试。';
      if(cause.status===409)try{const result=await api.employeeTemplates(workspace);if(current(request,workspace))templates.value=result.templates||[];}catch(refreshError){if(current(request,workspace))error.value+=`；重新读取实例失败：${refreshError.message}`;}
    }
  }finally{if(current(request,workspace))busy.value=false;}
}
function openExisting(){
  if(!instance.value||busy.value)return;
  if(!instance.value.conversationId)return void create(true);
  emit('open',{workspace:props.workspace,duplicate:true,employee:{id:instance.value.employeeId,name:template.value.name,runtime:instance.value.runtime,runtime_profile:instance.value.runtimeProfile,target_device_id:instance.value.targetDeviceId},conversation:{id:instance.value.conversationId}});
}
watch(()=>props.workspace,()=>{templates.value=[];deviceId.value='';runtime.value='Codex';profile.value='';model.value='default';busy.value=false;void refresh();},{immediate:true});
onBeforeUnmount(()=>{disposed=true;generation++;});
</script>

<template>
  <section class="creator-market" aria-label="官方伙伴市场" :aria-busy="loading||busy">
    <div class="creator-market-heading"><div><h3>官方伙伴市场</h3><p>选择电脑与运行时，直接开始与你的 Creator 协作。</p></div><button type="button" class="pill" :disabled="loading||busy" @click="refreshAll">{{loading?'读取中…':'刷新市场与电脑'}}</button></div>
    <p v-if="error" role="alert" class="employee-readiness-error">{{error}}</p>
    <p v-if="loading&&!template" role="status">正在读取官方模板与自己的实例…</p>
    <article v-if="template" class="creator-template-card" data-testid="creator-template-card">
      <div class="creator-template-heading"><span class="creator-template-icon" aria-hidden="true">✦</span><div><h3>{{template.name}}</h3><span>官方内置 · v{{template.version}}</span></div></div>
      <p>{{template.description}}</p>
      <details v-if="template.workflow?.length" class="creator-template-workflow"><summary>Creator 如何与你协作</summary><ol><li v-for="(step,index) in template.workflow" :key="index">{{typeof step==='string'?step:step.title}}</li></ol></details>
      <p class="employee-field-hint">新实例的职责、人格和工作流程随模板自动应用；管理 MCP 默认接入，无需复制提示词或密钥。实例仅自己可见，后续模板更新保留你的定制。</p>
      <div v-if="instance" class="creator-instance" data-testid="creator-instance">
        <strong>你的 Creator 实例</strong><p>{{instance.runtime}} · {{instance.runtimeProfile||'默认配置'}} · {{instance.targetDeviceId}}</p>
        <p v-if="instance.origin==='adopted-existing'||instance.templateApplied===false" class="employee-field-hint">已复用你已有的 Creator，原职责、人格和配置保持，未覆盖为新版模板。</p>
        <p v-else-if="template.updateAvailable" class="employee-field-hint">模板有新版本；你的实例保留原配置，更新仅用于新实例。</p>
        <button type="button" class="employee-create-button creator-primary" :disabled="busy" @click="openExisting">{{busy?'打开中…':'打开持久对话'}}</button>
      </div>
      <template v-else>
        <div class="employee-field"><label for="creator-target-device">目标电脑</label><ZiSelect id="creator-target-device" v-model="deviceId" :options="deviceOptions" :disabled="busy||discoveryLoading" aria-label="Creator 目标电脑" @update:model-value="changeDevice"/></div>
        <div class="employee-field"><label for="creator-runtime">运行时</label><ZiSelect id="creator-runtime" v-model="runtime" :options="runtimeOptions" :disabled="busy||!device" aria-label="Creator 运行时" @update:model-value="changeRuntime"/></div>
        <div v-if="selection.requiresProfile" class="employee-field"><label for="creator-profile">请选择实际就绪的 Hermes 配置</label><ZiSelect id="creator-profile" v-model="profile" :options="profileOptions" :disabled="busy" aria-label="Creator Hermes Profile"/></div>
        <p v-else-if="runtime==='Hermes'&&selection.profile" class="employee-field-hint">使用目标电脑实际就绪的 {{selection.profile}} profile，保留原配置与认证。</p>
        <details v-if="device&&(selection.profiles.length||models.length)" class="creator-advanced"><summary>其他运行配置（可选）</summary><div v-if="selection.profiles.length&&!selection.requiresProfile" class="employee-field"><label for="creator-optional-profile">Profile</label><ZiSelect id="creator-optional-profile" v-model="profile" :options="profileOptions" :disabled="busy" aria-label="Creator 可选 Profile"/></div><div v-if="models.length" class="employee-field"><label for="creator-model">模型</label><ZiSelect id="creator-model" v-model="model" :options="modelOptions" :disabled="busy" aria-label="Creator 模型"/></div></details>
        <p v-if="discoveryError" role="alert" class="employee-readiness-error">{{discoveryError}}</p>
        <p v-if="discoveryLoading" role="status">正在发现当前工作区电脑与 CLI…</p>
        <ul v-else-if="deviceId&&!selection.ready" class="employee-readiness-error"><li v-for="issue in selection.issues" :key="issue">{{issue}}</li></ul>
        <p v-if="device" class="employee-field-hint">管理 MCP · {{preparation.label}}<span v-if="preparation.reason"> · {{preparation.reason}}</span>；实际加载与工具结果以员工运行回执为准。</p>
        <button type="button" class="employee-create-button creator-primary" :disabled="loading||busy||discoveryLoading||!selection.ready" @click="create()">{{busy?'创建中…':'创建并开始对话'}}</button>
      </template>
    </article>
    <div v-else-if="!loading" class="creator-market-unavailable"><p>官方 Creator 当前不可用，请重新读取市场。</p><button type="button" class="employee-secondary-button" @click="refreshAll">重新读取市场</button></div>
  </section>
</template>
