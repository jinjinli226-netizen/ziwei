<script setup>
import {computed,onBeforeUnmount,ref,watch} from 'vue';
import {Upload,RotateCcw,LoaderCircle,Shapes} from 'lucide-vue-next';
import EmployeeAvatar from './EmployeeAvatar.vue';
import {AVATAR_SHAPES,AVATAR_COLORS,avatarSpec,avatarValue,isCharacterAvatar,employeeAvatarSrc} from '../../../src/employee-avatar.mjs';

const props=defineProps({modelValue:{type:String,default:null},savedValue:{type:String,default:null},name:{type:String,default:''},identity:{type:String,default:''},saveHint:{type:String,default:'保存员工配置后生效。'},disabled:Boolean,saving:Boolean,uncertain:Boolean});
const emit=defineEmits(['update:modelValue','reading']);
const input=ref(null),reading=ref(false),error=ref(''),optionsOpen=ref(false);
const mode=ref(!props.modelValue||isCharacterAvatar(props.modelValue)?'character':'image');
const characterValue=ref(isCharacterAvatar(props.modelValue)?props.modelValue:null);
const imageValue=ref(props.modelValue&&!isCharacterAvatar(props.modelValue)?props.modelValue:null);
let request=0,reader=null;
const seed=computed(()=>props.identity||props.name||'employee');
const selectedCharacter=computed(()=>avatarSpec({name:seed.value,metadata:{avatar:characterValue.value}}));
const characterLabel=computed(()=>AVATAR_SHAPES.find(item=>item.id===selectedCharacter.value.shapeId).label+' · '+AVATAR_COLORS.find(item=>item.id===selectedCharacter.value.colorId).label);
const previewValue=computed(()=>mode.value==='character'?characterValue.value:imageValue.value||props.modelValue);
const previewOnly=computed(()=>(previewValue.value||null)!==(props.modelValue||null));
const dirty=computed(()=>(props.modelValue||null)!==(props.savedValue||null));
const status=computed(()=>props.uncertain?'保存待确认':reading.value?'正在读取':props.saving?'正在保存':previewOnly.value?'仅预览':dirty.value?'待保存':props.modelValue?'已保存':'默认角色头像');
const blocked=computed(()=>props.disabled||props.saving||props.uncertain||reading.value);
watch(()=>props.modelValue,value=>{
  if(isCharacterAvatar(value)){characterValue.value=value;mode.value='character';}
  else if(value){imageValue.value=value;mode.value='image';}
  else{characterValue.value=null;mode.value='character';}
});
watch(()=>props.savedValue,value=>{
  if(imageValue.value&&!imageValue.value.startsWith('data:image/'))imageValue.value=value&&!isCharacterAvatar(value)?value:null;
});
function switchMode(value){if(blocked.value)return;mode.value=value;error.value='';}
function preview(){if(blocked.value)return;if(mode.value==='image')pick();else optionsOpen.value=!optionsOpen.value;}
function pick(){if(!blocked.value)input.value?.click();}
function selectCharacter(shapeId,colorId){if(blocked.value)return;error.value='';characterValue.value=avatarValue(shapeId,colorId);emit('update:modelValue',characterValue.value);}
function useImage(){if(!blocked.value&&imageValue.value)emit('update:modelValue',imageValue.value);}
function reset(){if(blocked.value)return;request++;error.value='';characterValue.value=null;mode.value='character';emit('update:modelValue',null);}
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
    if(current===request&&!props.disabled&&!props.saving&&!props.uncertain){imageValue.value=value;mode.value='image';emit('update:modelValue',value);}
  }catch(failure){if(current===request)error.value=failure.message;}
  finally{if(current===request){reader=null;reading.value=false;emit('reading',false);}}
}
onBeforeUnmount(()=>{request++;reader?.abort();emit('reading',false);});
</script>

<template>
  <div class="bot-avatar-editor wide" role="group" aria-label="员工头像">
    <div class="bot-avatar-editor__heading"><span>头像</span><span class="bot-avatar-editor__status" :data-pending="dirty||reading||saving||uncertain" role="status" aria-live="polite">{{status}}</span></div>
    <div class="bot-avatar-editor__modes" role="group" aria-label="头像类型">
      <button type="button" :aria-pressed="mode==='character'" :disabled="blocked" @click="switchMode('character')"><Shapes :size="15"/>角色头像</button>
      <button type="button" :aria-pressed="mode==='image'" :disabled="blocked" @click="switchMode('image')"><Upload :size="15"/>上传图片</button>
    </div>
    <div class="bot-avatar-editor__body">
      <button type="button" class="bot-avatar-editor__preview" :disabled="blocked" aria-label="选择员工头像" @click="preview">
        <EmployeeAvatar class="bot-avatar-editor__avatar" :avatar="previewValue" :name="name" :identity="identity" alt="员工头像预览"/>
      </button>
      <div class="bot-avatar-editor__controls">
        <template v-if="mode==='character'">
          <strong class="bot-avatar-editor__selection">{{characterLabel}}</strong>
          <button type="button" class="bot-button" :disabled="blocked" :aria-expanded="optionsOpen" @click="optionsOpen=!optionsOpen"><Shapes :size="15"/>选择形状与颜色</button>
          <button v-if="previewOnly" type="button" class="bot-button" :disabled="blocked" @click="selectCharacter(selectedCharacter.shapeId,selectedCharacter.colorId)">使用此角色头像</button>
          <p class="bot-avatar-editor__hint">小眼睛角色 · 25 种形状、11 种颜色</p>
        </template>
        <template v-else>
          <div class="bot-avatar-editor__actions"><button type="button" class="bot-button" :disabled="blocked" @click="pick"><LoaderCircle v-if="reading" :size="15" class="bot-avatar-editor__spinner"/><Upload v-else :size="15"/>{{reading?'读取中…':imageValue?'更换图片':'上传头像'}}</button><button v-if="imageValue&&previewOnly" type="button" class="bot-button" :disabled="blocked" @click="useImage">使用这张图片</button></div>
          <p class="bot-avatar-editor__hint">JPG、PNG、WebP · 最大 2 MB</p>
        </template>
        <p v-if="previewOnly" class="bot-avatar-editor__hint">当前仅预览，选用后才替换头像草稿。</p>
      </div>
    </div>
    <div v-if="mode==='character'&&optionsOpen" class="bot-avatar-editor__options">
      <div class="bot-avatar-editor__option-heading">形状</div>
      <div class="bot-avatar-editor__shapes" role="group" aria-label="角色形状">
        <button v-for="shape in AVATAR_SHAPES" :key="shape.id" type="button" :aria-label="'角色形状：'+shape.label" :aria-pressed="selectedCharacter.shapeId===shape.id" :disabled="blocked" @click="selectCharacter(shape.id,selectedCharacter.colorId)"><img :src="employeeAvatarSrc(avatarValue(shape.id,selectedCharacter.colorId))" alt=""/><span>{{shape.label}}</span></button>
      </div>
      <div class="bot-avatar-editor__option-heading">颜色</div>
      <div class="bot-avatar-editor__colors" role="group" aria-label="角色颜色">
        <button v-for="color in AVATAR_COLORS" :key="color.id" type="button" :aria-label="'角色颜色：'+color.label" :aria-pressed="selectedCharacter.colorId===color.id" :disabled="blocked" @click="selectCharacter(selectedCharacter.shapeId,color.id)"><i :style="{background:color.value}"/><span>{{color.label}}</span></button>
      </div>
    </div>
    <div class="bot-avatar-editor__footer"><p v-if="dirty&&!saving&&!uncertain" class="bot-avatar-editor__hint">{{saveHint}}</p><button v-if="modelValue" type="button" class="bot-avatar-editor__reset" :disabled="blocked" @click="reset"><RotateCcw :size="13"/>恢复默认</button></div>
    <input ref="input" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" hidden :disabled="blocked" @change="choose"/>
    <p v-if="error" class="bot-avatar-editor__error" role="alert">{{error}}</p>
  </div>
</template>

<style scoped>
.bot-avatar-editor{min-width:0;padding:16px;border:1px solid var(--bot-line,#e9e5f0);border-radius:14px;background:#fcfbfe;}
.bot-avatar-editor__heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;font-size:13px;color:#6f677c;}
.bot-avatar-editor__status{font-size:12px;color:#698274;}
.bot-avatar-editor__status[data-pending=true]{color:#8866bd;}
.bot-avatar-editor__modes{display:flex;gap:4px;padding:3px;margin-bottom:16px;width:fit-content;border-radius:8px;background:#f0ecf6;}
.bot-avatar-editor__modes button{display:flex;align-items:center;gap:6px;min-height:32px;padding:6px 11px;border:0;border-radius:5px;background:transparent;color:#807489;font:inherit;font-size:12px;cursor:pointer;}
.bot-avatar-editor__modes button[aria-pressed=true]{background:#fff;color:#7355d7;box-shadow:0 1px 3px #3523410a;}
.bot-avatar-editor__body{display:flex;align-items:center;gap:16px;min-width:0;}
.bot-avatar-editor__preview{width:80px;height:80px;flex:none;display:grid;place-items:center;padding:0;overflow:hidden;border:0;border-radius:20px;background:#f0ecf6;cursor:pointer;}
.bot-avatar-editor__preview .bot-avatar-editor__avatar{width:100%;height:100%;}
.bot-avatar-editor__controls{display:flex;flex-direction:column;align-items:flex-start;gap:7px;min-width:0;}
.bot-avatar-editor__selection{font-size:12px;font-weight:500;color:#635370;}
.bot-avatar-editor__actions{display:flex;flex-wrap:wrap;gap:8px;}
.bot-avatar-editor__controls .bot-button{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:34px;padding:8px 11px;border:0;border-radius:8px;background:#f0eaf9;color:#7355d7;font:inherit;font-size:12px;line-height:1.4;cursor:pointer;}
.bot-avatar-editor__controls .bot-button:hover{background:#e8dff5;}
.bot-avatar-editor button:disabled{opacity:.48;cursor:not-allowed;}
.bot-avatar-editor button:focus-visible{outline:2px solid #9379dc;outline-offset:3px;}
.bot-avatar-editor__hint{margin:0;color:#857b92;font-size:11px;line-height:1.6;}
.bot-avatar-editor__options{margin-top:18px;padding-top:14px;border-top:1px solid #eee9f3;}
.bot-avatar-editor__option-heading{margin:0 0 8px;color:#74667f;font-size:11px;}
.bot-avatar-editor__shapes{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;margin-bottom:16px;}
.bot-avatar-editor__shapes button,.bot-avatar-editor__colors button{display:grid;justify-items:center;gap:3px;min-width:0;padding:6px 2px;border:0;border-radius:8px;background:transparent;color:#7c7086;font:inherit;font-size:10px;cursor:pointer;}
.bot-avatar-editor__shapes button[aria-pressed=true],.bot-avatar-editor__colors button[aria-pressed=true]{box-shadow:inset 0 0 0 1px #bda7e4;background:#f0e9fa;color:#7355d7;}
.bot-avatar-editor__shapes button:hover,.bot-avatar-editor__colors button:hover{background:#f1edf7;}
.bot-avatar-editor__shapes img{width:36px;height:36px;}
.bot-avatar-editor__colors{display:grid;grid-template-columns:repeat(auto-fit,minmax(42px,1fr));gap:6px;}
.bot-avatar-editor__colors i{display:block;width:22px;height:22px;border-radius:50%;}
.bot-avatar-editor__footer{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px;}
.bot-avatar-editor__reset{display:inline-flex;align-items:center;gap:5px;padding:3px 0;margin-left:auto;border:0;background:transparent;color:#81748c;font:inherit;font-size:11px;cursor:pointer;}
.bot-avatar-editor__error{margin:12px 0 0;color:#b34d65;font-size:12px;line-height:1.5;}
.bot-avatar-editor input[hidden]{display:none;}
.bot-avatar-editor__spinner{animation:avatar-spin 1s linear infinite;}
@keyframes avatar-spin{to{transform:rotate(360deg);}}
@media(max-width:420px){.bot-avatar-editor{padding:12px;}.bot-avatar-editor__body{gap:12px;}.bot-avatar-editor__preview{width:64px;height:64px;border-radius:16px;}.bot-avatar-editor__shapes{grid-template-columns:repeat(4,minmax(0,1fr));}}
@media(prefers-reduced-motion:reduce){.bot-avatar-editor__spinner{animation:none;}}
</style>
