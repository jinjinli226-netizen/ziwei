<script setup>
import {computed,onBeforeUnmount,reactive,watch} from 'vue';
import {api} from '../api.js';
import {createDshNative} from '../dsh-native.js';
import {createDshNativeSecure} from '../dsh-native-secure.js';
import DshSessionControls from './DshSessionControls.vue';
import DshModelsPanel from './DshModelsPanel.vue';
const props=defineProps({workspace:{type:String,required:true},actorId:{type:String,required:true},employee:{type:Object,required:true},conversation:{type:Object,required:true},execution:Object});
const emit=defineEmits(['new-conversation']);
const bot=createDshNative({api,wrap:reactive}),session=createDshNative({api,wrap:reactive});
const secure=createDshNativeSecure({api,controller:bot,wrap:reactive});
const running=computed(()=>props.execution?.status==='acked');
const secretBusy=computed(()=>secure.state.busy||secure.state.unknown);
let visit=0,selectionReady=Promise.resolve();
watch(()=>[props.actorId,props.workspace,props.employee.id,props.employee.target_device_id,props.employee.runtime_profile,props.conversation.id],()=>{
 selectionReady=(async()=>{
  const selected=++visit;secure.clear();
  await Promise.all([bot.select(null),session.select(null)]);if(selected!==visit)return;
  const subject={actorId:props.actorId,workspace:props.workspace,employeeId:props.employee.id};
  await Promise.all([bot.select(subject,{active:true}),session.select({...subject,conversationId:props.conversation.id},{active:true})]);
 })();
},{immediate:true});
async function readModels(event){if(event.target.open&&!running.value&&!secretBusy.value&&!bot.state.request)await bot.refresh(['providers']);}
async function createSession(agentPreset){
 await selectionReady;
 await session.select({actorId:props.actorId,workspace:props.workspace,employeeId:props.employee.id,conversationId:props.conversation.id},{active:true});
 if(session.state.value?.scope?.nativeSessionId===null)await session.submit('sessions','create',{agentPreset});
}
defineExpose({createSession});
onBeforeUnmount(()=>{visit++;secure.dispose();session.dispose();bot.dispose();});
</script>
<template>
 <section class="dsh-conversation-tools" aria-label="DSH 原生会话工具">
  <DshSessionControls :controller="session" :bot-controller="bot" :message-count="conversation.messages?.length||0" :execution-busy="running" @new-conversation="emit('new-conversation',$event)"/>
  <details @toggle="readModels"><summary>模型与 Provider</summary><fieldset :disabled="running||secretBusy"><DshModelsPanel :controller="bot" :conversation-controller="session" :secure-available="secure.available()" :secure-busy="secretBusy" :secure-action="secure.state.action" @secure="secure.submit($event)"/></fieldset><p v-if="running">当前任务完成后可更改模型配置。</p></details>
  <p v-if="secure.state.error" role="alert">{{secure.state.error}}</p><p v-if="secure.state.notice" role="status">{{secure.state.notice}}</p><button v-if="secure.state.request" type="button" :disabled="secure.state.busy" @click="secure.readAction()">回读安全操作原回执</button>
 </section>
</template>
<style scoped>
.dsh-conversation-tools{margin-bottom:16px;min-width:0}.dsh-conversation-tools>details{font-size:12px;color:#756480;margin:8px 0}.dsh-conversation-tools>details>summary{padding:10px 12px;background:#faf8fd;border-radius:8px;cursor:pointer;list-style:none}.dsh-conversation-tools fieldset{border:0;padding:12px 0;margin:0;min-width:0}.dsh-conversation-tools>p{font-size:12px;line-height:1.7;color:#917d9e}.dsh-conversation-tools>button{border:0;background:#f3edf8;padding:8px 12px;min-height:34px;border-radius:7px;color:#775d8a;font:inherit;font-size:12px;cursor:pointer}
</style>
