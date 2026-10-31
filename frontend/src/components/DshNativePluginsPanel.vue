<script setup>
import {computed,nextTick,ref,watch} from 'vue';
import DshPluginsPanel from './DshPluginsPanel.vue';
import DshRuntimePlugins from './DshRuntimePlugins.vue';
import DshPluginMarket from './DshPluginMarket.vue';
import DshPluginInstall from './DshPluginInstall.vue';
import DshSettingsEditor from './DshSettingsEditor.vue';
import DshPluginUiHost from './DshPluginUiHost.vue';
import {dshNativeReason} from '../dsh-native.js';
import {nativeApplication,nativeInstallAttempt} from '../dsh-native-plugins.js';
const props=defineProps({controller:{type:Object,required:true},workspace:{type:String,required:true},employee:{type:Object,required:true},actorId:{type:String,required:true},active:{type:Boolean,default:true},secureAvailable:{type:Boolean,default:false},secureBusy:Boolean});
const emit=defineEmits(['secure']);
const tab=ref('combination'),namespace=ref(''),editor=ref(null),page=ref(null),source=ref(null),inspection=ref(null),attempt=ref(null),legacy=ref({busy:false,pending:false});
let searchIntent=null,inspectIntent=null,settingsIntent=null,installIntent=null;
const scopeKey=computed(()=>JSON.stringify([props.actorId,props.workspace,props.employee.id,props.employee.target_device_id,props.employee.runtime_profile]));
const c=computed(()=>props.controller),s=computed(()=>c.value.state);
const scopeCurrent=computed(()=>s.value.subject?.workspace===props.workspace&&s.value.subject.employeeId===props.employee.id&&s.value.subject.actorId===props.actorId&&(!s.value.value||s.value.value.subject.deviceId===(props.employee.target_device_id??null)&&s.value.value.subject.profile===(props.employee.runtime_profile??null)));
const nativeBlocked=computed(()=>props.secureBusy||s.value.loading||s.value.submitting||Boolean(s.value.request)||Boolean(s.value.value?.pending?.length));
const busy=computed(()=>legacy.value.pending||nativeBlocked.value);
const descriptor=name=>scopeCurrent.value?c.value.resource(name):null;
const observed=name=>descriptor(name)?.data||descriptor(name)?.snapshot?.data||null;
const plugins=computed(()=>observed('plugins')),settings=computed(()=>observed('settings')),market=computed(()=>observed('market'));
const namespaces=computed(()=>settings.value?.namespaces||[]);
const selectedNamespace=computed(()=>namespaces.value.find(row=>row.ns===namespace.value)||null);
const currentResource=computed(()=>({runtime:'plugins',settings:'settings',market:'market',install:'plugins'})[tab.value]);
const currentDescriptor=computed(()=>currentResource.value?descriptor(currentResource.value):null);
const editable=name=>props.active&&!legacy.value.pending&&!props.secureBusy&&scopeCurrent.value&&c.value.editable(name);
const supported=(name,operation)=>props.active&&scopeCurrent.value&&c.value.supported(name,operation);
const pluginOperation=operation=>supported('plugins',operation);
const marketOperation=operation=>operation==='inspectSource'?pluginOperation(operation):supported('market',operation);
const settingsConflict=computed(()=>s.value.action?.result?.dshNative?.data?.error?.code==='settings/conflict'||s.value.errorCode==='settings/conflict');
watch(scopeKey,()=>{page.value=null;source.value=null;inspection.value=null;attempt.value=null;namespace.value='';searchIntent=null;inspectIntent=null;settingsIntent=null;installIntent=null;legacy.value={busy:false,pending:false};});
watch(namespaces,rows=>{if(!rows.some(row=>row.ns===namespace.value))namespace.value=rows[0]?.ns||'';},{immediate:true});
function configure(ns){namespace.value=ns;tab.value='settings';}
const resourcesForTab=()=>tab.value==='runtime'?['plugins','settings']:tab.value==='market'?['plugins','settings','market']:[currentResource.value];
async function sync(){if(!props.active||!scopeCurrent.value||legacy.value.pending||props.secureBusy)return;await c.value.refresh(resourcesForTab());}
async function openTab(value){tab.value=value;if(value!=='combination'&&value!=='ui'&&s.value.value&&!busy.value&&supported('state','refresh')&&resourcesForTab().some(name=>descriptor(name)?.status!=='observed'||descriptor(name)?.stale))await sync();}
async function marketAction({operation,input}){if(!supported('market',operation))return;if(operation==='search'){page.value=null;searchIntent={input,scopeKey:scopeKey.value};}await c.value.submit('market',operation,input);}
async function pluginAction({operation,input}){if(!pluginOperation(operation)||legacy.value.pending)return;if(['waitForInstall','cancelInstall'].includes(operation))return c.value.control(operation,input);if(operation==='installBundle'){if(!editable('plugins')||busy.value)return;installIntent={input,scopeKey:scopeKey.value};}await c.value.submit('plugins',operation,input);}
async function inspect(value){
  const replaceName=value.replaceName||(source.value?.spec===value.spec&&(source.value?.registry||'')===(value.registry||'')?source.value.replaceName:null);
  source.value={...value,...(replaceName?{replaceName}:{})};tab.value='install';inspection.value=null;
  if(!pluginOperation('inspectSource'))return;
  const input={spec:value.spec,...(value.registry?{registry:value.registry}:{})};inspectIntent={input,scopeKey:scopeKey.value};await c.value.submit('plugins','inspectSource',input);
}
async function saveSettings(input){if(!editable('settings')||!supported('settings','mutate'))return;settingsIntent={...input,scopeKey:scopeKey.value};await c.value.submit('settings','mutate',input);}
function secureSettings(input){if(props.secureAvailable&&editable('settings')&&settings.value?.writable===true)emit('secure',{resource:'settings',operation:'mutateSecure',input:{ns:input.ns,expectedRevision:input.expectedRevision},secret:{ops:input.ops}});}
watch(()=>s.value.action,async action=>{
  if(!scopeCurrent.value||!action)return;
  const operation=action.payload?.dshOperation,receipt=action.result?.dshNative;if(!operation)return;
  if(operation.resource==='market'&&operation.operation==='search'&&receipt?.status==='observed'&&searchIntent?.scopeKey===scopeKey.value)page.value=receipt.data;
  if(operation.resource==='plugins'&&operation.operation==='inspectSource'&&receipt?.status==='observed'){
    const intent=inspectIntent?.scopeKey===scopeKey.value?inspectIntent.input:s.value.request?.body?.input;
    if(intent){inspection.value={actionId:action.id,input:{...intent},data:receipt.data};if(!attempt.value||!['unknown','partial','pending','acked','running'].includes(attempt.value.status))attempt.value=null;}
  }
  if(operation.resource==='plugins'&&['installBundle','waitForInstall','cancelInstall'].includes(operation.operation)){
    const input=s.value.request?.body?.input||(installIntent?.scopeKey===scopeKey.value?installIntent.input:{});
    attempt.value=nativeInstallAttempt(action,attempt.value,input);
  }
  if(operation.resource==='settings'&&operation.operation==='mutate'&&receipt?.status==='applied'&&settingsIntent?.scopeKey===scopeKey.value){
    const saved=receipt.data?.namespaces?.find(row=>row.ns===settingsIntent.ns);
    await nextTick();if(saved&&selectedNamespace.value?.ns===saved.ns&&selectedNamespace.value.revision===saved.revision&&saved.revision!==settingsIntent.expectedRevision)editor.value?.reset();settingsIntent=null;
  }
},{deep:true,immediate:true});
watch(()=>s.value.controlAction,action=>{
  if(!scopeCurrent.value||!action||!attempt.value)return;
  const op=action.payload?.dshOperation;
  if(op?.resource==='plugins'&&['waitForInstall','cancelInstall'].includes(op.operation)&&op.scope?.sourceActionId===attempt.value.actionId)attempt.value=nativeInstallAttempt(action,attempt.value,{sourceActionId:attempt.value.actionId});
},{deep:true,immediate:true});
defineExpose({resetSettings:()=>editor.value?.reset()});
</script>
<template>
  <section class="dsh-native-plugins" aria-label="DSH 原生插件管理">
    <nav class="dshp-tabs" aria-label="原生插件管理分区"><button v-for="[key,label] in [['combination','启动组合'],['ui','插件工作区'],['runtime','运行条目'],['settings','插件配置'],['market','插件市场'],['install','安装任务']]" :key="key" type="button" :class="{selected:tab===key}" :aria-current="tab===key?'page':undefined" @click="openTab(key)">{{label}}</button></nav>
    <DshPluginsPanel :key="scopeKey" v-show="tab==='combination'" :workspace="workspace" :employee="employee" :actor-id="actorId" :active="active&&(legacy.pending||tab==='combination'&&!nativeBlocked)" :external-blocked="nativeBlocked" @state="legacy=$event"/>
    <section v-show="tab==='ui'" class="dshp-native-section"><DshPluginUiHost :key="scopeKey+':ui'" :controller="c" :workspace="workspace" :actor-id="actorId" :employee="employee" :active="active&&tab==='ui'"/></section>
    <section v-show="tab!=='combination'&&tab!=='ui'" class="dshp-native-section">
      <header class="dshp-heading"><div><h3>{{({runtime:'运行条目',settings:'原生插件配置',market:'原生插件市场',install:'安装任务'})[tab]}}</h3><p class="dshp-help">绑定 Bot {{employee.runtime_profile||'尚未指定'}} · 来源 dsh-native<span v-if="currentDescriptor?.checkedAt"> · {{new Date(currentDescriptor.checkedAt).toLocaleString('zh-CN')}}</span></p></div><div class="dshp-actions"><button type="button" class="dshp-button" :disabled="s.loading||s.submitting" @click="c.load()">回读原生状态</button><button type="button" class="dshp-button" :disabled="busy||!supported('state','refresh')" @click="sync">同步当前页</button></div></header>
      <p v-if="!scopeCurrent" class="dshp-notice">正在核对当前员工的原生管理绑定，旧员工记录不会显示在这里。</p>
      <p v-else-if="s.capabilities?.clientReported===false" class="dshp-notice">运行电脑尚未支持完整原生管理。启动组合仍保留原有同步与保存入口。</p>
      <p v-if="legacy.pending" class="dshp-notice" role="status">启动组合还有未核实的原请求，新管理操作已暂缓。<button type="button" class="dshp-button" @click="tab='combination'">回到启动组合核实</button></p>
      <p v-if="secureBusy" class="dshp-notice" role="status">安全变更尚待原生核实，其他插件写入暂缓。</p><p v-if="s.error" class="dshp-error" role="alert">{{s.error}}</p><p v-if="s.unknown" class="dshp-error" role="alert">原生结果未知，已保留原请求；请查询原请求，不要重复提交。</p><p v-if="s.notice&&!s.unknown" class="dshp-notice" role="status">{{s.notice}}</p>
      <p v-if="currentDescriptor?.reasonCode" class="dshp-help">{{dshNativeReason(currentDescriptor.reasonCode)}}{{currentDescriptor.stale?' 以下为历史观察，不能据此编辑。':''}}</p>
      <div v-if="s.request" class="dshp-pending"><span>原请求 · {{s.request.resource}}.{{s.request.operation}} · {{s.request.actionId||'回执身份尚未确认'}}</span><button type="button" class="dshp-button" :disabled="s.loading||s.submitting" @click="c.readAction()">查询原请求</button></div>
      <DshRuntimePlugins :key="scopeKey+':runtime'" v-show="tab==='runtime'" :value="plugins" :busy="busy" :editable="editable('plugins')" :can-operate="pluginOperation" :namespaces="namespaces.map(row=>row.ns)" @action="pluginAction" @configure="configure" @inspect="inspect"/>
      <section v-show="tab==='settings'" class="dshp-settings"><label>配置对象<select :value="namespace" aria-label="原生配置对象" :disabled="busy" @change="namespace=$event.target.value"><option value="">选择原生配置</option><option v-for="row in namespaces" :key="row.ns" :value="row.ns">{{row.ns}}</option></select></label><DshSettingsEditor v-if="selectedNamespace" :key="scopeKey+':'+selectedNamespace.ns" ref="editor" :namespace="selectedNamespace" :scope-key="scopeKey" :secure-writable="secureAvailable" :writable="editable('settings')&&settings.writable&&supported('settings','mutate')" :busy="busy" :conflict="settingsConflict" read-only-reason="当前记录不可编辑，请同步原生配置并检查客户端与账号权限。" @mutate="saveSettings" @secure="secureSettings" @refresh="c.refresh(['settings'])"/><p v-else class="dshp-empty">尚无原生配置描述。同步后显示实际可编辑字段。</p></section>
      <DshPluginMarket :key="scopeKey+':market'" v-show="tab==='market'" :indexes="market?.indexes||[]" :page="page" :busy="busy" :editable="editable('market')" :can-operate="marketOperation" @action="marketAction" @inspect="inspect"/>
      <DshPluginInstall :key="scopeKey+':install'" v-show="tab==='install'" :source="source" :inspection="inspection" :attempt="attempt" :busy="busy" :editable="editable('plugins')" :can-operate="pluginOperation" :control-busy="s.controlBusy||s.loading||s.submitting" @inspect="inspect" @action="pluginAction"/><p v-if="tab==='install'&&s.controlNotice" class="dshp-notice" role="status">{{s.controlNotice}}</p><p v-if="tab==='install'&&s.controlError" class="dshp-error" role="alert">{{s.controlError}}</p>
      <p v-if="s.action?.result?.dshNative&&s.action.payload?.dshOperation?.resource==='plugins'&&tab==='runtime'" class="dshp-help">{{nativeApplication(s.action.result.dshNative.status)}}</p>
    </section>
  </section>
</template>
<style src="../dsh-native-plugins.css"></style>
