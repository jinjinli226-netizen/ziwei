<script setup>
import {computed,onBeforeUnmount,reactive,ref,watch} from 'vue';
import {api} from '../api.js';
import {createDshNative} from '../dsh-native.js';
import {createDshNativeSecure} from '../dsh-native-secure.js';
import DshNativePluginsPanel from './DshNativePluginsPanel.vue';
import DshModelsPanel from './DshModelsPanel.vue';
import DshWorkspacePanel from './DshWorkspacePanel.vue';
import DshGroupsPanel from './DshGroupsPanel.vue';
const props=defineProps({workspace:{type:String,required:true},actorId:{type:String,required:true},employee:{type:Object,required:true},employees:{type:Array,default:()=>[]},section:{type:String,default:'plugins'},active:Boolean});
const native=createDshNative({api,wrap:reactive}),secure=createDshNativeSecure({api,controller:native,wrap:reactive});
const pluginPanel=ref(null),persona=ref('');
const bot=computed(()=>native.resource('bot')?.data);
const lock=computed(()=>secure.state.busy||secure.state.unknown);
const busy=computed(()=>lock.value||native.state.loading||native.state.submitting||Boolean(native.state.request)||Boolean(native.state.value?.pending?.length));
let visit=0;
watch(()=>[props.actorId,props.workspace,props.employee.id,props.employee.target_device_id,props.employee.runtime_profile],async()=>{
 const selected=++visit;secure.clear();await native.select(null);if(selected!==visit)return;
 await native.select({actorId:props.actorId,workspace:props.workspace,employeeId:props.employee.id},{active:props.active});
},{immediate:true});
watch(()=>props.active,active=>{if(native.state.subject)void native.select(native.state.subject,{active});});
watch(bot,(value,previous)=>{if(value&&(!previous||persona.value===(previous.persona||'')))persona.value=value.persona||'';});
watch(()=>secure.state.action,action=>{if(action?.status==='succeeded'&&action.result?.dshNative?.status==='applied'&&action.payload?.dshOperation?.resource==='settings')pluginPanel.value?.resetSettings();});
function processControl(operation){if(operation==='stop'&&!window.confirm('停止当前 DSH Bot 进程会中断它的全部会话。继续停止？'))return;return native.submit('bot',operation,{});}
onBeforeUnmount(()=>{visit++;secure.dispose();native.dispose();});
</script>
<template>
 <section class="dsh-native-management">
  <DshNativePluginsPanel ref="pluginPanel" v-show="section==='plugins'" :controller="native" :workspace="workspace" :actor-id="actorId" :employee="employee" :active="active&&section==='plugins'" :secure-available="secure.available()" :secure-busy="lock" @secure="secure.submit($event)"/>
  <DshModelsPanel v-show="section==='models'" :controller="native" :secure-available="secure.available()" :secure-busy="lock" :secure-action="secure.state.action" @secure="secure.submit($event)"/>
  <fieldset v-for="workSection in ['routines','files','activity']" v-show="section===workSection" :key="workSection" :disabled="lock"><DshWorkspacePanel :controller="native" :section="workSection==='activity'?'logs':workSection"/></fieldset>
  <fieldset v-show="section==='groups'" :disabled="lock"><DshGroupsPanel :controller="native" :employees="employees"/></fieldset>
  <section v-if="section==='settings'" class="dsh-process">
   <header><div><h3>DSH 原生运行端</h3><p>管理这位员工绑定的原生 Bot。</p></div><button :disabled="busy||!native.supported('bot','state')" @click="native.submit('bot','state',{})">读取运行状态</button></header>
   <p v-if="native.state.error" role="alert">{{native.state.error}}</p><p v-if="native.state.notice" role="status">{{native.state.notice}}</p>
   <template v-if="native.resource('bot')?.status==='observed'"><p>{{bot.running?(bot.ready?'运行就绪':'正在启动或等待就绪'):'进程未运行'}}</p><div class="process-actions"><button :disabled="busy||!native.supported('bot','start')||bot.running" @click="processControl('start')">启动 DSH Bot</button><button :disabled="busy||!native.supported('bot','stop')||!bot.running" @click="processControl('stop')">停止 Bot 进程</button></div><form @submit.prevent="native.submit('bot','persona',{persona})"><label>原生 Bot 人设<textarea v-model="persona" rows="6" maxlength="24000" :disabled="busy"/></label><p>保存到 DSH 原生人设。紫薇的岗位职责仍随会话执行传入。</p><button :disabled="busy||!native.supported('bot','persona')">保存原生人设</button></form></template>
  </section>
  <div v-if="secure.state.request||secure.state.error||secure.state.notice" class="secure-receipt" aria-live="polite"><p v-if="secure.state.error" role="alert">{{secure.state.error}}</p><p>{{secure.state.notice}}</p><button v-if="secure.state.request" type="button" :disabled="secure.state.busy" @click="secure.readAction()">回读安全操作原回执</button></div>
 </section>
</template>
<style scoped>
.dsh-native-management{min-width:0}.dsh-native-management>fieldset{border:0;margin:0;padding:0;min-width:0}.dsh-process{font-size:13px;padding-top:22px}.dsh-process header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.dsh-process h3{font-size:16px;margin:0 0 8px}.dsh-process p,.secure-receipt p{color:#8c7d98;line-height:1.7}.dsh-process button,.secure-receipt button{border:0;background:#f3edf8;color:#765b8c;min-height:34px;border-radius:7px;padding:7px 12px;font:inherit;cursor:pointer}.dsh-process button:disabled{opacity:.5;cursor:default}.dsh-process button:hover:not(:disabled),.secure-receipt button:hover:not(:disabled){background:#e9e0f3}.process-actions{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}.dsh-process label{display:grid;gap:8px}.dsh-process textarea{box-sizing:border-box;width:100%;border:0;box-shadow:inset 0 0 0 .5px #ded4e9;border-radius:8px;padding:10px;resize:vertical;font:inherit;line-height:1.7}.secure-receipt{font-size:12px;margin-top:16px}@media(pointer:coarse){.dsh-process button,.secure-receipt button{min-height:36px}}
</style>
