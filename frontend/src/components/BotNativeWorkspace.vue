<script setup>
import {computed,onBeforeUnmount,provide,reactive,watch} from 'vue';
import {api,API_BASE} from '../api.js';
import {createBotNativeOperations} from '../bot-native-operations.js';
import {createNativeBotTransport} from '../bot-native-transport.js';
import BotKnowledgePanel from './BotKnowledgePanel.vue';
import BotCollaborationPanel from './BotCollaborationPanel.vue';
import BotChannelsPanel from './BotChannelsPanel.vue';
import BotProactivePanel from './BotProactivePanel.vue';
const props=defineProps({workspace:{type:String,required:true},actorId:{type:String,default:''},bot:{type:Object,required:true},draft:{type:Object,required:true},bots:{type:Array,required:true},section:{type:String,default:'knowledge'},configBusy:Boolean,refreshBot:{type:Function,required:true}});
const emit=defineEmits(['save-config','stop-current','busy']);
provide('bot-native-actor-id',computed(()=>props.actorId));
const transport=createNativeBotTransport({api,getBot:()=>props.bot,onBotChanged:context=>props.workspace===context.workspace&&props.bot.id===context.botId?props.refreshBot():undefined});
const ui=createBotNativeOperations({transport,wrap:reactive,namespace:props.actorId?API_BASE+':'+props.actorId:''});
const enabled=computed(()=>props.bot.configuration_state==='initialized'&&(props.bot.instance?.mode!=='owned_profile'||props.bot.instance.provisioning?.status==='provisioned'));
const pending=computed(()=>{ui.blocked();return ui.pending();});
watch(()=>[props.workspace,props.bot.id],()=>ui.select(props.workspace,props.bot.id),{immediate:true});
watch(()=>ui.blocked()||Object.values(ui.state.resources).some(item=>item.loading),value=>emit('busy',value),{immediate:true});
let timer;function schedule(){timer=setTimeout(async()=>{if(!document.hidden){for(const [name,item] of Object.entries(ui.state.resources))if(item.pending&&item.action&&item.phase==='accepted'&&!item.busy)await ui.poll(name);}schedule();},2500);}schedule();
onBeforeUnmount(()=>{clearTimeout(timer);ui.dispose();emit('busy',false);});
</script>
<template>
  <div class="native-workspace">
    <p v-if="!enabled" class="native-help">先完成当前员工的 Bot 初始化与专属 Profile 创建，再读取原生资源。</p>
    <p v-if="pending.length" class="native-help">当前员工仍有 {{pending.length}} 项原生操作待核实：{{pending.map(item=>item.resource+' · '+item.operation).join('；')}}。原请求标识保留，新写入暂缓。</p>
    <BotKnowledgePanel v-if="section==='knowledge'" :ui="ui" :bot="bot" :draft="draft" :enabled="enabled" :config-busy="configBusy" @save-config="emit('save-config')"/>
    <BotCollaborationPanel v-else-if="section==='collaboration'" :ui="ui" :bot="bot" :draft="draft" :bots="bots" :enabled="enabled" :config-busy="configBusy" @save-config="emit('save-config')"/>
    <BotChannelsPanel v-else-if="section==='channels'" :ui="ui" :bot="bot" :draft="draft" :enabled="enabled" :config-busy="configBusy" @save-config="emit('save-config')"/>
    <BotProactivePanel v-else-if="section==='proactive'" :ui="ui" :bot="bot" :enabled="enabled" @stop-current="emit('stop-current')"/>
  </div>
</template>
<style src="../bot-native.css"></style>
