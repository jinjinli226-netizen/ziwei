<script setup>
import {computed,onBeforeUnmount,ref} from 'vue';
import {Upload,Trash2,LoaderCircle} from 'lucide-vue-next';

const props=defineProps({modelValue:{type:String,default:null},savedValue:{type:String,default:null},name:{type:String,default:''},disabled:Boolean,saving:Boolean,uncertain:Boolean});
const emit=defineEmits(['update:modelValue','reading']);
const input=ref(null),reading=ref(false),error=ref('');
let request=0,reader=null;
const dirty=computed(()=>(props.modelValue||null)!==(props.savedValue||null));
const status=computed(()=>props.uncertain?'保存待确认':reading.value?'正在读取':props.saving?'正在保存':dirty.value?'待保存':props.modelValue?'已保存':'默认头像');
const blocked=computed(()=>props.disabled||props.saving||props.uncertain||reading.value);
function pick(){if(!blocked.value)input.value?.click();}
function remove(){if(blocked.value)return;request++;error.value='';emit('update:modelValue',null);}
async function choose(event){
  const file=event.target.files?.[0];event.target.value='';
  if(!file||blocked.value)return;
  error.value='';
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>2*1024*1024){error.value='请选择 2 MB 以内的 JPG、PNG 或 WebP 图片。';return;}
  const current=++request;
  reading.value=true;emit('reading',true);
  try{
    const value=await new Promise((resolve,reject)=>{
      reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('图片读取失败，请重新选择。'));reader.onabort=()=>reject(new Error('读取已取消'));reader.readAsDataURL(file);
    });
    if(current===request&&!props.disabled&&!props.saving&&!props.uncertain)emit('update:modelValue',value);
  }catch(failure){if(current===request)error.value=failure.message;}
  finally{if(current===request){reader=null;reading.value=false;emit('reading',false);}}
}
onBeforeUnmount(()=>{request++;reader?.abort();emit('reading',false);});
</script>

<template>
  <div class="bot-avatar-editor wide" role="group" aria-label="员工头像">
    <div class="bot-avatar-editor__heading"><span>头像</span><span class="bot-avatar-editor__status" :data-pending="dirty||reading||saving||uncertain" role="status" aria-live="polite">{{status}}</span></div>
    <div class="bot-avatar-editor__body">
      <button type="button" class="bot-avatar-editor__preview" :disabled="blocked" aria-label="选择员工头像" @click="pick">
        <img v-if="modelValue" :src="modelValue" alt="员工头像预览"/>
        <span v-else>{{name?.slice(0,1)||'✦'}}</span>
      </button>
      <div class="bot-avatar-editor__controls">
        <div class="bot-avatar-editor__actions">
          <button type="button" class="bot-button" :disabled="blocked" @click="pick"><LoaderCircle v-if="reading" :size="15" class="bot-avatar-editor__spinner"/><Upload v-else :size="15"/>{{reading?'读取中…':modelValue?'更换头像':'上传头像'}}</button>
          <button v-if="modelValue" type="button" class="bot-button" :disabled="blocked" @click="remove"><Trash2 :size="15"/>移除</button>
        </div>
        <p class="bot-avatar-editor__hint">JPG、PNG、WebP · 最大 2 MB</p>
        <p v-if="dirty&&!saving&&!uncertain" class="bot-avatar-editor__hint">点击下方“保存配置”后生效。</p>
      </div>
    </div>
    <input ref="input" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" hidden :disabled="blocked" @change="choose"/>
    <p v-if="error" class="bot-avatar-editor__error" role="alert">{{error}}</p>
  </div>
</template>

<style scoped>
.bot-avatar-editor{min-width:0;padding:16px;border:1px solid var(--bot-line,#e9e5f0);border-radius:14px;background:#fcfbfe;}
.bot-avatar-editor__heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;font-size:13px;color:#6f677c;}
.bot-avatar-editor__status{font-size:12px;color:#698274;}
.bot-avatar-editor__status[data-pending=true]{color:#8866bd;}
.bot-avatar-editor__body{display:flex;align-items:center;gap:16px;min-width:0;}
.bot-avatar-editor__preview{width:80px;height:80px;flex:none;display:grid;place-items:center;padding:0;overflow:hidden;border:1px solid #e3dbef;border-radius:20px;background:#eee8fa;color:#7355d7;font-family:inherit;font-size:30px;font-weight:600;cursor:pointer;}
.bot-avatar-editor__preview img{display:block;width:100%;height:100%;object-fit:cover;}
.bot-avatar-editor__preview:focus-visible{outline:3px solid #b6a2ef;outline-offset:3px;}
.bot-avatar-editor__preview:disabled{cursor:default;}
.bot-avatar-editor__controls{min-width:0;}
.bot-avatar-editor__actions{display:flex;flex-wrap:wrap;gap:8px;}
.bot-avatar-editor__hint{margin:8px 0 0;color:#857b92;font-size:12px;line-height:1.5;}
.bot-avatar-editor__error{margin:12px 0 0;color:#b34d65;font-size:12px;line-height:1.5;}
.bot-avatar-editor input[hidden]{display:none;}
.bot-avatar-editor__spinner{animation:avatar-spin 1s linear infinite;}
@keyframes avatar-spin{to{transform:rotate(360deg);}}
@media(max-width:420px){.bot-avatar-editor{padding:12px;}.bot-avatar-editor__body{gap:12px;}.bot-avatar-editor__preview{width:64px;height:64px;border-radius:16px;}.bot-avatar-editor__actions .bot-button{padding:7px 9px;font-size:12px;}}
@media(prefers-reduced-motion:reduce){.bot-avatar-editor__spinner{animation:none;}}
</style>
