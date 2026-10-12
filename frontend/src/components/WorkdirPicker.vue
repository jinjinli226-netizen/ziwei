<script setup>
import {computed,onBeforeUnmount,reactive,watch} from 'vue';
import {Folder,HardDrive} from 'lucide-vue-next';
import {api} from '../api.js';
import {createDirectoryController} from '../workdir.js';

const props=defineProps({modelValue:{type:String,default:''},workspace:{type:String,required:true},deviceId:{type:String,default:''},deviceName:{type:String,default:''},entityId:{type:String,default:''},editorId:{type:[Number,String],default:0},conversation:Boolean,disabled:Boolean,label:{type:String,default:'默认工作目录（可选）'},originalPath:{type:String,default:''},originalDeviceId:{type:String,default:''}});
const emit=defineEmits(['update:modelValue','checked','use']);
let disposed=false;
const controller=createDirectoryController({wrap:reactive,scope:()=>({workspace:props.workspace,entityId:props.entityId,deviceId:props.deviceId,editorId:disposed?'disposed':props.editorId}),inspect:(scope,body)=>props.conversation?api.inspectConversationDirectory(scope.entityId,{...body,deviceId:scope.deviceId}):api.inspectDeviceDirectory(scope.deviceId,body,scope.workspace),poll:(id,scope)=>props.conversation?api.conversationDirectoryAction(scope.entityId,id):api.deviceDirectoryAction(scope.deviceId,id,scope.workspace)});
const state=controller.state;
const path=computed({get:()=>props.modelValue,set:value=>{controller.setPath(value);emit('checked',null);emit('update:modelValue',value);}});
const unchanged=computed(()=>Boolean(props.originalPath)&&props.modelValue.trim()===props.originalPath.trim()&&props.deviceId===props.originalDeviceId);
async function inspect(directory=path.value,createIfMissing=false,use=false){
  if(props.disabled)return;
  path.value=directory;
  const result=await controller.inspect(createIfMissing);
  if(!result)return;
  emit('update:modelValue',state.path);emit('checked',state.check);
  if(use&&state.check)emit('use',state.check);
}
function clear(){path.value='';}
function use(){if(state.check&&state.check.path===props.modelValue.trim())emit('use',state.check);}
watch(()=>props.modelValue,value=>{if(value!==state.path){controller.setPath(value);emit('checked',null);}},{immediate:true,flush:'sync'});
watch(()=>[props.workspace,props.entityId,props.deviceId,props.editorId],()=>{controller.invalidate();emit('checked',null);},{flush:'sync'});
onBeforeUnmount(()=>{disposed=true;controller.invalidate();});
</script>

<template>
  <section class="conversation-directory-picker employee-default-workdir" :aria-label="label" :aria-busy="state.loading">
    <label class="workdir-label">{{label}}</label>
    <p class="employee-field-hint">{{conversation?'只修改当前会话的目录。':'新会话自动沿用；已有会话保留各自目录。'}}目录将绑定到 {{deviceName||'选定电脑'}}，换电脑后需要重新检查。</p>
    <div class="conversation-directory-picker-input">
      <input v-model="path" class="workdir-path-input" :aria-label="label" :disabled="disabled" placeholder="例如 D:\digital" @keydown.enter.prevent="inspect()"/>
      <button type="button" class="pill" :disabled="disabled||state.loading||!deviceId" @click="inspect()">{{state.loading?'检查中…':'检查目录'}}</button>
      <button v-if="!conversation&&path" type="button" class="pill" :disabled="disabled||state.loading" @click="clear">清除默认目录</button>
    </div>
    <p v-if="path" class="workdir-full-path">{{path}}</p>
    <p v-if="state.error" class="employee-readiness-error" role="alert">{{state.error}}</p>
    <p v-if="state.loading" class="conversation-directory-loading" role="status">正在目标电脑检查真实目录…</p>
    <p v-else-if="!conversation&&unchanged&&!state.result" class="employee-field-hint">已保存的默认目录；保留此电脑与路径即可沿用。</p>
    <p v-else-if="path&&!state.result" class="employee-field-hint workdir-check-required">请检查当前电脑上的目录后保存，或清除默认目录。</p>
    <template v-if="state.result">
      <div class="conversation-directory-result" :data-missing="!state.result.exists"><div><strong>{{state.check?'目录存在，可以使用':state.result.exists?'这个路径不是目录':'目录不存在'}}</strong><small>{{state.result.path}}</small></div><span v-if="state.result.created" class="conversation-row-status">已创建</span></div>
      <div class="conversation-directory-browser"><section><div class="card-heading"><h4>设备盘符</h4><small>{{state.result.roots?.length||0}} 个</small></div><div class="conversation-directory-root-list"><button v-for="root in state.result.roots||[]" :key="root" type="button" class="conversation-directory-option" :disabled="disabled||state.loading" @click="inspect(root)"><HardDrive :size="14"/><span>{{root}}</span></button><p v-if="!state.result.roots?.length" class="task-detail-empty">目标电脑没有返回可用盘符。</p></div></section><section><div class="card-heading"><h4>当前目录的子目录</h4><small>{{state.result.entries?.length||0}} 个</small></div><div class="conversation-directory-entry-list"><button v-for="entry in state.result.entries||[]" :key="entry.path" type="button" class="conversation-directory-option" :disabled="disabled||state.loading" @click="inspect(entry.path)"><Folder :size="14"/><span>{{entry.name}}</span></button><p v-if="!state.result.entries?.length" class="task-detail-empty">没有可进入的子目录。</p></div></section></div>
      <div class="form-actions"><button v-if="state.result.exists===false" type="button" class="employee-secondary-button" :disabled="disabled||state.loading||!path.trim()" @click="inspect(path,true,conversation)">{{conversation?'创建并使用':'创建缺失目录'}}</button><button v-if="conversation" type="button" class="employee-create-button" :disabled="disabled||state.loading||!state.check" @click="use">选择此目录</button></div>
    </template>
  </section>
</template>
