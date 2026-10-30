<script setup>
import {computed,ref,watch} from 'vue';
import {nativeText,nativePluginMatches} from '../dsh-native-plugins.js';
const props=defineProps({value:Object,busy:Boolean,editable:Boolean,canOperate:{type:Function,default:()=>false},namespaces:{type:Array,default:()=>[]}});
const emit=defineEmits(['action','configure','inspect']);
const query=ref(''),removeTarget=ref('');
const bundles=computed(()=>(props.value?.bundles||[]).filter(row=>nativePluginMatches(row,query.value)));
const entries=computed(()=>(props.value?.plugins||props.value?.inventory?.entries||[]).filter(row=>nativePluginMatches(row,query.value)));
const allowed=operation=>props.editable&&!props.busy&&props.canOperate(operation);
function action(operation,input){if(allowed(operation))emit('action',{operation,input});}
function remove(){if(!props.value?.bundles.some(row=>row.name===removeTarget.value&&row.removable&&!row.readOnlyReason))return;action('removeBundle',{name:removeTarget.value});removeTarget.value='';}
watch(()=>props.value,()=>removeTarget.value='');
</script>
<template>
  <section class="dshp-runtime" aria-label="DSH 运行插件">
    <p class="dshp-help">Profile 选择、包安装与 Loader 实际阶段分别展示；启用标记不代表已加载。</p>
    <label class="dshp-search">查找插件<input :value="query" aria-label="搜索运行插件" placeholder="插件名称、模块或条目 ID" @input="query=$event.target.value"/></label>
    <p v-if="!value" class="dshp-empty">尚无原生运行记录，请先刷新。未运行的 Bot 不会因读取而启动。</p>
    <template v-else>
      <h4>运行时插件包</h4><div class="dshp-list"><article v-for="bundle in bundles" :key="bundle.name" class="dshp-row"><div class="dshp-copy"><strong>{{nativeText(bundle.meta?.title)||bundle.name}}</strong><code>{{bundle.name}}{{bundle.version?' · '+bundle.version:''}}</code><span>Profile {{bundle.enabled?'已选择':'未选择'}} · {{bundle.installed===true?'已安装':bundle.installed===false?'未安装':'安装待观察'}} · {{bundle.availability}}</span><small v-if="bundle.readOnlyReason">原生只读 · {{bundle.readOnlyReason}}</small><small v-if="bundle.error?.code">原生报告 · {{bundle.error.code}}</small></div><div class="dshp-actions"><button type="button" class="dshp-button" :aria-label="(bundle.enabled?'停用':'启用')+'插件包：'+bundle.name" :disabled="!allowed('setBundleEnabled')||Boolean(bundle.readOnlyReason)" @click="action('setBundleEnabled',{name:bundle.name,enabled:!bundle.enabled})">{{bundle.enabled?'停用':'启用'}}</button><button v-if="bundle.installTarget&&bundle.availability==='missing'" type="button" class="dshp-button" :disabled="!allowed('inspectSource')" @click="emit('inspect',{spec:bundle.installTarget.spec,...(bundle.installTarget.registry?{registry:bundle.installTarget.registry}:{})})">检查安装此版本</button><button v-if="bundle.removable" type="button" class="dshp-button danger" :aria-label="'卸载插件包：'+bundle.name" :disabled="!allowed('removeBundle')||Boolean(bundle.readOnlyReason)" @click="removeTarget=bundle.name">卸载</button></div></article></div>
      <section v-if="removeTarget" class="dshp-confirm" role="alertdialog" aria-label="卸载插件确认"><strong>卸载 {{removeTarget}}？</strong><p>将移除此 Bot 的原生插件包；相关功能可能停止，不能以取消启用代替卸载结果。</p><div class="dshp-actions"><button type="button" class="dshp-button" @click="removeTarget=''">保留插件包</button><button type="button" class="dshp-button danger" :disabled="!allowed('removeBundle')" @click="remove">确认卸载插件包</button></div></section>
      <h4>Loader 运行条目</h4><div class="dshp-list"><article v-for="entry in entries" :key="entry.entryId" class="dshp-row"><div class="dshp-copy"><strong>{{nativeText(entry.meta?.title)||entry.moduleName||entry.entryId}}</strong><code>{{entry.entryId}}</code><span>原生启用标记 {{String(entry.enabled)}} · 实际阶段 {{entry.fiberPhase??'未观察'}}</span><small v-if="entry.readOnlyReason">原生只读 · {{entry.readOnlyReason}}</small></div><div class="dshp-actions"><button v-if="entry.patchId&&!entry.readOnlyReason" type="button" class="dshp-button" :aria-label="(entry.enabled?'停用':'启用')+'运行条目：'+entry.entryId" :disabled="!allowed('setPluginEnabled')" @click="action('setPluginEnabled',{id:entry.entryId,enabled:!entry.enabled})">{{entry.enabled?'停用条目':'启用条目'}}</button><button v-if="namespaces.includes(entry.patchId||entry.entryId)" type="button" class="dshp-button" :aria-label="'配置运行条目：'+entry.entryId" @click="emit('configure',entry.patchId||entry.entryId)">配置</button></div></article></div>
      <p v-if="!bundles.length&&!entries.length" class="dshp-empty">没有匹配的原生记录。</p>
      <details v-if="value.inventory?.agentPresets?.length" class="dshp-evidence"><summary>原生预设中的 Loader 观察</summary><section v-for="preset in value.inventory.agentPresets" :key="preset.id"><h5>{{preset.name||preset.id}}{{preset.isDefault?' · 默认':''}}</h5><p v-for="(row,index) in preset.rows.filter(row=>nativePluginMatches(row,query))" :key="index"><code>{{row.moduleName||row.entryId}}</code> · {{row.fiberPhase??'未观察'}}</p></section></details>
      <p v-if="!canOperate('setBundleEnabled')||!canOperate('setPluginEnabled')" class="dshp-help">部分原生操作尚未接入当前客户端，相关按钮保持禁用。</p>
    </template>
  </section>
</template>
