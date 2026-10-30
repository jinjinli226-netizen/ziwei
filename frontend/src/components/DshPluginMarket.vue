<script setup>
import {computed,ref,watch} from 'vue';
import {nativeText,nativeMarketQuery,nativeMarketSource} from '../dsh-native-plugins.js';
const props=defineProps({indexes:{type:Array,default:()=>[]},page:Object,busy:Boolean,editable:Boolean,canOperate:{type:Function,default:()=>false}});
const emit=defineEmits(['action','inspect']);
const url=ref(''),text=ref(''),indexDraft=ref(''),indexDirty=ref(false),versions=ref({}),submitted=ref('');
const queryKey=computed(()=>JSON.stringify([url.value,text.value.trim()]));
const visiblePage=computed(()=>submitted.value===queryKey.value?props.page:null);
const allowed=operation=>props.editable&&!props.busy&&props.canOperate(operation);
watch(()=>props.indexes,rows=>{if(!rows.some(row=>row.url===url.value))url.value=rows[0]?.url||'';const saved=rows.map(row=>row.url).join('\n');if(!indexDirty.value||indexDraft.value.split(/\r?\n/).map(value=>value.trim()).filter(Boolean).join('\n')===saved){indexDraft.value=saved;indexDirty.value=false;}},{immediate:true});
watch(()=>props.page,page=>{versions.value=Object.fromEntries((page?.entries||[]).map(entry=>[entry.name,entry.defaultVersion||'']));});
function search(next=false){if(!allowed('search')||!url.value||next&&visiblePage.value?.nextOffset==null)return;submitted.value=queryKey.value;emit('action',{operation:'search',input:nativeMarketQuery(url.value,text.value,next?visiblePage.value:null)});}
function saveIndexes(){if(allowed('setIndexes'))emit('action',{operation:'setIndexes',input:{urls:indexDraft.value.split(/\r?\n/).map(value=>value.trim()).filter(Boolean)}});}
function inspect(entry){if(props.busy||!props.canOperate('inspectSource'))return;const source=nativeMarketSource(entry,versions.value[entry.name]);if(source)emit('inspect',source);}
</script>
<template>
  <section class="dshp-market" aria-label="DSH 原生插件市场">
    <p class="dshp-help">索引、版本和兼容性来自当前 Bot 的原生市场。点击搜索才访问索引，不会自动启用市场插件或重启 Bot。</p>
    <div class="dshp-toolbar"><label>索引来源<select :value="url" aria-label="原生市场索引" @change="url=$event.target.value" :disabled="busy"><option v-for="index in indexes" :key="index.url" :value="index.url">{{nativeText(index.title)||index.url}}</option></select></label><label class="dshp-grow">搜索<input :value="text" aria-label="搜索原生插件市场" placeholder="插件名称或描述" :disabled="busy" @input="text=$event.target.value"/></label><button type="button" class="dshp-button" :disabled="!allowed('search')||!url" @click="search()">搜索市场</button></div>
    <p v-if="!indexes.length" class="dshp-empty">尚无可用的原生市场索引。市场服务未启用时，请在启动组合中检查原生市场插件。</p>
    <template v-if="visiblePage"><p class="dshp-help">{{nativeText(visiblePage.title)}} · 共 {{visiblePage.total}} 项 · 本页 {{visiblePage.entries.length}} 项</p><div class="dshp-list"><article v-for="entry in visiblePage.entries" :key="entry.name" class="dshp-row"><div class="dshp-copy"><strong>{{nativeText(entry.title)||entry.name}}</strong><code>{{entry.name}}</code><span>{{nativeText(entry.description)}}</span><small>原生安装状态 {{entry.installation.status}}{{entry.installation.installedVersion?' · '+entry.installation.installedVersion:''}}</small><select :value="versions[entry.name]" @change="versions[entry.name]=$event.target.value" :aria-label="entry.name+' 版本'" :disabled="busy"><option v-for="version in entry.versions" :key="version.version" :value="version.version" :disabled="!version.compatibility.compatible&&!version.compatibility.exempted">{{version.version}}{{!version.compatibility.compatible?(version.compatibility.exempted?' · 原生豁免':' · 不兼容'):''}}</option></select></div><button type="button" class="dshp-button" :aria-label="'检查安装版本：'+entry.name" :disabled="busy||!canOperate('inspectSource')||!nativeMarketSource(entry,versions[entry.name])||entry.installation.status==='provided'" @click="inspect(entry)">{{['installed','update-available','different-version'].includes(entry.installation.status)?'检查替换版本':'检查安装版本'}}</button></article></div><p v-if="!visiblePage.entries.length" class="dshp-empty">当前索引没有匹配结果。</p><button v-if="visiblePage.nextOffset!==null" type="button" class="dshp-button" :disabled="!allowed('search')" @click="search(true)">下一页</button></template>
    <details class="dshp-evidence"><summary>市场索引设置</summary><label>每行一个索引 URL<textarea :value="indexDraft" aria-label="原生市场索引列表" rows="4" :disabled="busy||!allowed('setIndexes')" @input="indexDraft=$event.target.value;indexDirty=true"/></label><button type="button" class="dshp-button" :disabled="!allowed('setIndexes')||!indexDirty" @click="saveIndexes">保存市场索引</button><p v-if="!canOperate('setIndexes')" class="dshp-help">索引修改尚未接入当前客户端。</p></details>
  </section>
</template>
