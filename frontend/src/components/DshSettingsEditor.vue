<script setup>
import {computed,onBeforeUnmount,reactive,ref,watch} from 'vue';
import {createDshSettingsDraft} from '../dsh-settings.js';

const props=defineProps({namespace:{type:Object,required:true},scopeKey:{type:String,required:true},writable:{type:Boolean,default:false},secureWritable:{type:Boolean,default:true},busy:Boolean,conflict:[Boolean,Object,String],readOnlyReason:String});
const emit=defineEmits(['mutate','secure','refresh']);
const ui=createDshSettingsDraft({wrap:reactive}),s=ui.state,notice=ref('');
const applyNotice=computed(()=>props.namespace.applies==='live'?'原生声明：保存后实时应用；提交结果以原生回执和读回为准。':['restart','restart-required','next-start'].includes(props.namespace.applies)?'原生声明：保存后需要重启或下次启动才生效；本页不会自动重启。':'原生尚未报告生效方式，请以操作回执为准。');
const canSubmit=computed(()=>props.writable&&!props.busy&&!s.conflict&&ui.dirty());
function selectValue(field){const value=s.values[field.key];return String(field.options.findIndex(option=>s.changes[field.key]==='unset'?option.unset:JSON.stringify(option.value)===JSON.stringify(value)));}
function choose(field,event){const option=field.options[Number(event.target.value)];if(option.unset)ui.unset(field.path);else ui.set(field.path,option.value);}
function submit(){
  if(props.busy)return;
  notice.value='';
  try{
    const{ns,expectedRevision,ops,secureOps}=ui.build();if(!ops.length&&!secureOps.length)return;
    if(secureOps.length){if(!props.secureWritable)throw Error('安全通道尚未接入或当前账号未获授权，敏感修改未提交。');emit('secure',{ns,expectedRevision,ops:[...ops,...secureOps]});ui.clearSecrets();notice.value='变更已交给安全通道，等待原生回执；尚未确认保存。';}
    else{emit('mutate',{ns,expectedRevision,ops});notice.value='变更已提交，等待原生回执与配置读回。';}
  }catch(error){s.error=error.message;}
}
function reset(){ui.reset();notice.value='';}
watch(()=>[props.namespace,props.scopeKey,props.writable],()=>{ui.select(props.namespace,{scopeKey:props.scopeKey,writable:props.writable});notice.value='';},{immediate:true,deep:true});
watch(()=>props.conflict,value=>{if(value)ui.markConflict();},{immediate:true});
onBeforeUnmount(()=>ui.clearSecrets());
defineExpose({reset});
</script>

<template>
  <form class="dsh-settings-editor" :aria-label="namespace.ns+' 原生配置'" :aria-busy="busy" @submit.prevent="submit">
    <header class="settings-heading"><div><h4>{{namespace.ns}}</h4><p>配置版本 {{s.base?.revision ?? '尚未报告'}} · {{applyNotice}}</p></div><button type="button" class="settings-button" :disabled="busy" @click="emit('refresh')">重新读取配置</button></header>
    <p v-if="!writable" class="settings-notice" role="status">{{readOnlyReason||'当前原生配置只读。请检查账号权限与运行时支持。'}}</p>
    <div v-if="s.conflict" class="settings-conflict" role="alert"><p>{{s.error}}</p><p>当前读取版本 {{s.latest?.revision}}。原草稿和提交版本仍保留，不会自动覆盖原生配置。</p><div class="settings-actions"><button type="button" class="settings-button" :disabled="busy||s.latest?.revision===s.base?.revision" @click="ui.rebase()">按新版本继续编辑</button><button type="button" class="settings-button" :disabled="busy" @click="reset">放弃草稿并采用最新配置</button></div></div>
    <p v-else-if="s.error" class="settings-notice error" role="alert">{{s.error}}</p>
    <p v-if="notice" class="settings-notice" role="status">{{notice}}</p>
    <div class="settings-fields">
      <div v-for="field in s.fields" :key="field.key" class="settings-field" :data-setting-path="field.key">
        <div class="settings-label"><label :for="'dsh-setting-'+encodeURIComponent(namespace.ns+field.key)">{{field.path.join('.')}}</label><span v-if="field.required">必填</span><span v-if="field.readOnly">原生只读</span></div>
        <input v-if="field.sensitive" :id="'dsh-setting-'+encodeURIComponent(namespace.ns+field.key)" type="password" :aria-label="field.path.join('.')" :value="s.values[field.key]" :disabled="busy||!secureWritable||!ui.editable(field)||s.changes[field.key]==='unset'" autocomplete="new-password" :placeholder="field.control==='json'?'完整 JSON；留空保留':field.configured?'已配置；留空保留':'留空保留现有值'" @input="ui.set(field.path,$event.target.value)"/>
        <input v-else-if="field.control==='boolean'" :id="'dsh-setting-'+encodeURIComponent(namespace.ns+field.key)" type="checkbox" :aria-label="field.path.join('.')" :checked="s.values[field.key]" :disabled="busy||!ui.editable(field)||s.changes[field.key]==='unset'" @change="ui.set(field.path,$event.target.checked)"/>
        <select v-else-if="field.control==='select'" :id="'dsh-setting-'+encodeURIComponent(namespace.ns+field.key)" :aria-label="field.path.join('.')" :value="selectValue(field)" :disabled="busy||!ui.editable(field)" @change="choose(field,$event)"><option value="-1" disabled>选择原生选项</option><option v-for="(option,index) in field.options" :key="index" :value="String(index)" :disabled="option.disabled||(option.unset&&field.required)">{{option.label}}</option></select>
        <textarea v-else-if="field.control==='json'" :id="'dsh-setting-'+encodeURIComponent(namespace.ns+field.key)" :aria-label="field.path.join('.')" :value="s.values[field.key]" :disabled="busy||!ui.editable(field)||s.changes[field.key]==='unset'" rows="4" spellcheck="false" @input="ui.set(field.path,$event.target.value)"/>
        <input v-else :id="'dsh-setting-'+encodeURIComponent(namespace.ns+field.key)" :type="field.control==='number'?'number':'text'" :aria-label="field.path.join('.')" :value="s.values[field.key]" :min="field.schema.meta?.min" :max="field.schema.meta?.max" :step="field.schema.meta?.step" :disabled="busy||!ui.editable(field)||s.changes[field.key]==='unset'" @input="ui.set(field.path,$event.target.value)"/>
        <p v-if="field.description||field.comment" class="settings-help">{{field.description}}{{field.comment?' · '+field.comment:''}}</p>
        <p v-if="field.readOnlyReason" class="settings-help">{{field.readOnlyReason}}</p>
        <p v-if="field.sensitive&&!secureWritable" class="settings-help">安全通道尚未接入或当前账号未获授权，敏感字段暂不可编辑。</p>
        <p v-if="field.sensitive" class="settings-help">敏感值不回填，留空保留；新输入只交给安全通道。{{field.control==='json'?'此字段需输入完整 JSON，包含保留的敏感项。':''}}</p>
        <div v-if="ui.editable(field)&&(!field.sensitive||secureWritable)" class="settings-field-actions"><button v-if="!field.required" type="button" class="settings-link" :aria-label="'恢复继承值：'+field.path.join('.')" :disabled="busy||s.changes[field.key]==='unset'" @click="ui.unset(field.path)">恢复继承值</button><button v-if="s.changes[field.key]" type="button" class="settings-link" :aria-label="'撤销修改：'+field.path.join('.')" :disabled="busy" @click="ui.keep(field.path)">撤销修改</button><small v-if="s.changes[field.key]==='unset'">待取消覆盖；原生可能恢复基础配置值。</small></div>
      </div>
    </div>
    <p v-if="!s.fields.length" class="settings-empty">原生没有提供可展示的配置字段。</p>
    <footer class="settings-footer"><p>仅提交修改过的字段。版本冲突会保留草稿，保存结果以原生回读为准。</p><button type="submit" class="settings-button primary" :disabled="!canSubmit">{{busy?'等待原生回执…':'保存配置'}}</button></footer>
  </form>
</template>

<style scoped>
.dsh-settings-editor{min-width:0;color:var(--bot-ink,#403747);font-size:12px}.settings-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.settings-heading h4{font-size:14px;margin:0 0 6px;overflow-wrap:anywhere}.settings-heading p,.settings-footer p{margin:0;color:var(--bot-muted,#81738c);font-size:11px;line-height:1.8}.settings-button{display:inline-flex;align-items:center;justify-content:center;min-height:32px;padding:6px 11px;border:0;border-radius:7px;background:#f1edf7;color:#6c5d7d;font:inherit;cursor:pointer;white-space:nowrap}.settings-button:hover{background:#e9e2f3}.settings-button.primary{color:#fff;background:#7655c7}.settings-button.primary:hover{background:#6645b4}.settings-button:disabled,.settings-link:disabled{opacity:.48;cursor:default}.settings-button:focus-visible,.settings-link:focus-visible,.settings-field input:focus-visible,.settings-field textarea:focus-visible,.settings-field select:focus-visible{outline:2px solid #a88af0;outline-offset:3px}.settings-notice,.settings-conflict{padding:11px 12px;margin:14px 0;line-height:1.8;background:#f5f2fa;border-radius:7px;color:#7e698d}.settings-notice.error{background:#fff3f3;color:#9a5866}.settings-conflict p{margin:0 0 6px}.settings-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.settings-fields{display:grid;gap:0}.settings-field{min-width:0;padding:16px 0;border-bottom:1px solid #eee9f2}.settings-label{display:flex;align-items:center;gap:8px;margin-bottom:8px}.settings-label label{font-weight:550;overflow-wrap:anywhere}.settings-label span{color:#998ba5;background:#f3eff8;padding:2px 5px;border-radius:4px;font-size:10px}.settings-field input:not([type=checkbox]),.settings-field textarea,.settings-field select{box-sizing:border-box;width:100%;min-width:0;border:0;box-shadow:inset 0 0 0 .5px #dcd4e8;border-radius:7px;background:#fff;padding:8px 10px;color:inherit;font:inherit;min-height:34px}.settings-field input[type=checkbox]{width:16px;height:16px;margin:0;accent-color:#7655c7}.settings-field textarea{font-family:Consolas,monospace;line-height:1.6;resize:vertical}.settings-field input:disabled,.settings-field textarea:disabled,.settings-field select:disabled{background:#f7f6f9;color:#92869e}.settings-help{margin:7px 0 0;color:#94859f;font-size:11px;line-height:1.7}.settings-field-actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:8px}.settings-link{border:0;padding:2px 0;background:none;color:#857198;font:inherit;font-size:11px;cursor:pointer}.settings-link:hover{color:#654a88}.settings-field-actions small{font-size:10px;color:#a18cac}.settings-footer{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-top:18px}.settings-empty{color:#94859f;padding:16px 0}@media(max-width:700px){.settings-heading{flex-direction:column}.settings-footer{align-items:flex-start;flex-direction:column}}@media(pointer:coarse){.settings-button{min-height:36px}.settings-field input:not([type=checkbox]),.settings-field select{min-height:36px}}
</style>
