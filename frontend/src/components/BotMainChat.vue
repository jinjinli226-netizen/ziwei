<script setup>
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue';
import {ArrowLeft,ArrowUp,Plus,Settings2,PanelRight,ChevronDown,Monitor,Folder,MoreHorizontal,Smartphone,X,RefreshCw,Square,Download,FileText,Clock3,History,SquarePen,Archive} from 'lucide-vue-next';
import {botPresence,executionUncertain,botStopPresentation,botRecoveryEvent,botRecoveryDetail,processExitConfirmed,executionProcessActive} from '../bot-presentation.js';
import {chatLocalTime,conversationFiles} from '../bot-main-chat.js';
import {isConversationNearBottom,shouldShowConversationLatest,shouldLoadEarlierHistory,restoreConversationPrependScroll} from '../conversation-history.mjs';
import {createConversationEnterGuard} from '../conversation-compose.js';
import {ownedBotChatBlockReason} from '../bot-owned-profile.js';
import {executionPresentation} from '../conversation-execution-state.mjs';
import {historicalPrelaunchRecovery} from '../historical-prelaunch-recovery.mjs';
import {operatorForceAbandonRecovery} from '../operator-force-abandon-recovery.mjs';
import {failureFinalization,pendingBotFailureFinalization,finalizationPresentation,failureFinalizationRequest} from '../bot-failure-finalization.mjs';
import ConversationForwardCard from './ConversationForwardCard.vue';
import ConversationQueuePanel from './ConversationQueuePanel.vue';
import {conversationQueueStatusLabel} from '../conversation-queue.js';
import {isConversationForward} from '../conversation-forward-card.mjs';
import {createMessageReadObserver} from '../conversation-read.mjs';
import BotInteractionCard from './BotInteractionCard.vue';
const props=defineProps({managed:{type:Boolean,default:true},employee:Object,bot:Object,conversation:Object,execution:Object,events:{type:Array,default:()=>[]},draft:{type:String,default:''},attachments:{type:Array,default:()=>[]},device:Object,modelLabel:String,workingDirectory:String,sendPending:Boolean,attachmentReading:Boolean,statusLoading:Boolean,historyLoading:Boolean,historyError:String,sendError:String,queueBusy:Boolean,queueError:String,stopBusy:Boolean,reconcileBusy:Boolean,finalizationBusy:Boolean,canStop:Boolean,preview:Boolean,work:{type:Object,default:()=>({runs:[],routines:[],tasks:[]})},workLoading:Boolean,workError:String,previewSrc:Function,sizeLabel:Function,forwardSelecting:Boolean,forwardSelected:{type:Array,default:()=>[]},forwardError:String,forwardResult:Object,readScope:String,onVisibleMessage:Function});
const emit=defineEmits(['load-history','history','new-conversation','archive-conversation','forward-view','forward','forward-select','forward-toggle','forward-open','forward-cancel','retry-message','update:draft','send','queue-pause','queue-resume','queue-remove','settings','return','directory','attachment','paste-attachment','remove-attachment','preview-image','download','stop','reconcile','finalize-failure','refresh-work','phone','workspace-tasks']);
function attachReadObserver(element){const scope=props.readScope;element._readScope=scope;element._messageRead=createMessageReadObserver(element,messageId=>{if(scope===props.readScope)return props.onVisibleMessage?.({messageId,scope});return false;});}
const vConversationRead={mounted:attachReadObserver,updated(element){if(element._readScope!==props.readScope){element._messageRead?.();attachReadObserver(element);}else element._messageRead?.update();},beforeUnmount(element){element._messageRead?.();}};
const panel=ref(false),menu=ref(''),popoverStyle=ref({}),fileInput=ref(null),timeline=ref(null),followLatest=ref(true),showLatest=ref(false);
const historyRequested=ref(false),hasEarlierHistory=computed(()=>props.conversation?.messagePage?.hasMore===true);
let disposed=false,renderGeneration=0,renderedConversation='',renderedFirstMessage='',previousScrollTop=0,userScrollIntent=false,touchY=null,prependAnchor=null;
const historicalRecovery=computed(()=>historicalPrelaunchRecovery(props.execution)||operatorForceAbandonRecovery(props.execution));
const uncertain=computed(()=>executionUncertain(props.execution));
const finalization=computed(()=>props.managed===false?null:(failureFinalization(props.execution)||(!props.execution?pendingBotFailureFinalization(props.bot):null)));
const finalizationState=computed(()=>finalizationPresentation(finalization.value,{offline:props.device?.status==='offline'}));
const canFinalize=computed(()=>props.managed!==false&&executionProcessActive(props.execution?.result)&&Boolean(failureFinalizationRequest(props.bot,props.execution)));
const queue=computed(()=>props.conversation?.queue || {paused:false,count:0,items:[]});
const blocksSending=computed(()=>props.managed!==false&&executionProcessActive(props.execution?.result)&&props.bot?.active_action_id===props.execution?.id);
const recoveryEvent=computed(()=>props.managed===false?null:botRecoveryEvent(props.execution));
const stopState=computed(()=>botStopPresentation(props.bot,props.execution));
const blockedReason=computed(()=>props.managed===false?'':ownedBotChatBlockReason(props.bot));
function toggleMenu(value,event){menu.value=menu.value===value?'':value;if(!menu.value)return;const anchor=event.currentTarget;nextTick(()=>{const box=document.querySelector('.bot-main-chat .bot-chat-popover');if(!box)return;const rect=anchor.getBoundingClientRect(),width=box.offsetWidth,height=box.offsetHeight;popoverStyle.value={position:'fixed',left:Math.max(12,Math.min(rect.left,window.innerWidth-width-12))+'px',top:Math.max(12,Math.min(value==='more'?rect.bottom+8:rect.top-height-10,window.innerHeight-height-12))+'px',bottom:'auto',right:'auto'};});}
function resized(){menu.value='';if(window.innerWidth<1000)panel.value=false;}
function toggleWorkPanel(){panel.value=!panel.value;if(panel.value)emit('refresh-work');}
const chatEmployee=computed(()=>props.employee||props.bot?.employee||props.conversation?.employee);
const presence=computed(()=>props.managed===false?{label:({active:'员工已启用',paused:'员工已暂停',archived:'员工已归档',draft:'员工待配置'})[chatEmployee.value?.status]||'员工状态待同步',tone:'muted'}:botPresence(props.bot)),executionState=computed(()=>finalizationState.value||(stopState.value.confirmed?{label:stopState.value.label,summary:'原执行已停止',busy:false,tone:'muted',retryable:false}:executionPresentation(props.execution))),files=computed(()=>conversationFiles(props.conversation?.messages));
const name=computed(()=>chatEmployee.value?.name||'数字员工');
const reasoningSummaries=computed(()=>props.events.filter(event=>event.summary));
const directoryLabel=computed(()=>String(props.workingDirectory||'').split(/[\\/]/).filter(Boolean).at(-1)||'选择工作目录');
const status=computed(()=>finalizationState.value?.summary||(props.device?.status==='offline'?'电脑离线':props.execution?(executionState.value.summary||executionState.value.label):presence.value.label));
const enterGuard=createConversationEnterGuard();
function keydown(event){if(enterGuard.shouldSend(event)&&!blocksSending.value&&!blockedReason.value&&!props.sendPending&&!props.attachmentReading&&!props.statusLoading&&!props.finalizationBusy)emit('send');}
function closeMenus(event){if(event.key==='Escape'){menu.value='';panel.value=false;}else if(!event.target.closest?.('.bot-chat-chip-menu'))menu.value='';}
function scrollLatest(){nextTick(()=>{const node=timeline.value;if(disposed||!node)return;if(followLatest.value){node.scrollTop=node.scrollHeight;previousScrollTop=node.scrollTop;}showLatest.value=shouldShowConversationLatest(node);});}
function jumpLatest(){prependAnchor=null;userScrollIntent=false;followLatest.value=true;scrollLatest();}
function timelineAnchor(node){
  if(!node)return null;
  const viewport=node.getBoundingClientRect(),messages=[...node.querySelectorAll('[data-message-id]')];
  const message=messages.find(item=>item.getBoundingClientRect().bottom>viewport.top)||messages[0];
  return {conversationId:props.conversation?.id,messageId:message?.dataset.messageId,anchorOffset:message?message.getBoundingClientRect().top-viewport.top:undefined,scrollTop:node.scrollTop,scrollHeight:node.scrollHeight};
}
function restoreTimelineAnchor(anchor){
  const node=timeline.value;if(disposed||!node||!anchor||anchor.conversationId!==props.conversation?.id)return;
  const message=[...node.querySelectorAll('[data-message-id]')].find(item=>item.dataset.messageId===anchor.messageId);
  const nextAnchorOffset=message?message.getBoundingClientRect().top-node.getBoundingClientRect().top:undefined;
  node.scrollTop=restoreConversationPrependScroll({...anchor,...(message?{scrollTop:node.scrollTop}:{}),nextScrollHeight:node.scrollHeight,nextAnchorOffset});previousScrollTop=node.scrollTop;showLatest.value=shouldShowConversationLatest(node);
}
function requestEarlierHistory(){
  if(!hasEarlierHistory.value||props.historyLoading||historyRequested.value)return;
  followLatest.value=false;userScrollIntent=false;historyRequested.value=true;emit('load-history');
  nextTick(()=>{if(!props.historyLoading)historyRequested.value=false;});
}
function checkEarlierHistory(node,previous){
  if(shouldLoadEarlierHistory({hasMore:hasEarlierHistory.value,loading:props.historyLoading||historyRequested.value,error:props.historyError,scrollTop:node.scrollTop,previousScrollTop:previous,userInitiated:userScrollIntent}))requestEarlierHistory();
}
function timelineScrolled(event){
  const node=event.currentTarget;followLatest.value=!(userScrollIntent&&node.scrollTop<previousScrollTop)&&isConversationNearBottom(node);showLatest.value=shouldShowConversationLatest(node);checkEarlierHistory(node,previousScrollTop);previousScrollTop=node.scrollTop;
}
function timelineIntent(upwards){
  prependAnchor=null;userScrollIntent=upwards;if(upwards)followLatest.value=false;
  const node=timeline.value;if(upwards&&node)checkEarlierHistory(node,node.scrollTop+1);
}
function timelineWheel(event){if(event.deltaY)timelineIntent(event.deltaY<0);}
function timelineTouchStart(event){touchY=event.touches?.[0]?.clientY??null;prependAnchor=null;userScrollIntent=false;}
function timelineTouchMove(event){const next=event.touches?.[0]?.clientY;if(touchY!==null&&next!==undefined&&next!==touchY)timelineIntent(next>touchY);touchY=next??null;}
function timelineKey(event){if(['ArrowUp','PageUp','Home'].includes(event.key))timelineIntent(true);else if(['ArrowDown','PageDown','End'].includes(event.key))timelineIntent(false);}
function timelinePointer(){prependAnchor=null;userScrollIntent=true;}
function timelineMediaLoaded(){if(prependAnchor)nextTick(()=>restoreTimelineAnchor(prependAnchor));else scrollLatest();}
watch(()=>props.historyLoading,loading=>{if(!loading)historyRequested.value=false;});
watch(()=>props.events,()=>scrollLatest(),{deep:true});
watch(()=>[props.conversation?.id,props.conversation?.messages],async([id,messages])=>{
  const generation=++renderGeneration,same=id===renderedConversation;
  const prepended=same&&renderedFirstMessage&&(messages||[]).findIndex(message=>message.id===renderedFirstMessage)>0;
  const anchor=prepended?timelineAnchor(timeline.value):null;
  if(!same){followLatest.value=true;showLatest.value=false;historyRequested.value=false;userScrollIntent=false;prependAnchor=null;previousScrollTop=0;}
  else if(prepended)followLatest.value=false;
  renderedConversation=id;renderedFirstMessage=messages?.[0]?.id||'';
  await nextTick();if(disposed||generation!==renderGeneration||id!==props.conversation?.id)return;
  if(anchor){prependAnchor=anchor;restoreTimelineAnchor(anchor);}
  else if(prependAnchor&&!followLatest.value)restoreTimelineAnchor(prependAnchor);
  else scrollLatest();
},{deep:true,flush:'pre',immediate:true});
onMounted(()=>{window.addEventListener('resize',resized);document.addEventListener('keydown',closeMenus);document.addEventListener('pointerdown',closeMenus);scrollLatest();});
onBeforeUnmount(()=>{disposed=true;renderGeneration++;prependAnchor=null;window.removeEventListener('resize',resized);document.removeEventListener('keydown',closeMenus);document.removeEventListener('pointerdown',closeMenus);});
</script>
<template>
  <section class="bot-main-chat" :class="{'employee-chat':!managed}" role="region" :aria-label="managed?'Bot 主聊天':'员工聊天'" :data-bot-id="managed?bot?.id:undefined" :data-employee-id="chatEmployee?.id" :data-conversation-id="conversation.id">
    <header class="bot-chat-header">
      <button class="bot-chat-return" aria-label="返回紫薇" title="返回当前 Bot" @click="emit('return')"><ArrowLeft :size="19"/></button>
      <img v-if="chatEmployee?.avatar" :src="chatEmployee.avatar" class="bot-chat-avatar" alt=""/><span v-else class="bot-chat-avatar">{{name.slice(0,1)}}</span>
      <div class="bot-chat-identity"><strong :title="name">{{name}}</strong><span><i :data-tone="executionState.busy?'working':presence.tone"/>{{status}}<small>{{managed?' · 主聊天':' · '+(chatEmployee?.runtime||'运行时未指定')}}</small></span></div>
      <div class="bot-chat-header-actions"><span v-if="preview" class="bot-chat-local">本地预览</span><button v-if="!managed" aria-label="会话历史" title="会话历史" @click="emit('history')"><History :size="18"/></button><button v-if="!managed" aria-label="新建会话" title="新建会话" @click="emit('new-conversation')"><SquarePen :size="18"/></button><button :aria-label="managed?'Bot 设置':'员工设置'" :title="managed?'Bot 设置':'员工设置'" @click="emit('settings','settings')"><Settings2 :size="18"/><span>{{managed?'Bot 设置':'员工设置'}}</span></button><button class="bot-chat-work-toggle" aria-label="工作面板" :aria-expanded="panel" @click="toggleWorkPanel"><PanelRight :size="18"/><span>工作面板</span></button>
        <div class="bot-chat-chip-menu"><button aria-label="更多能力" :aria-expanded="menu==='more'" @click="toggleMenu('more',$event)"><MoreHorizontal :size="20"/></button><div v-if="menu==='more'" class="bot-chat-popover header-popover" :style="popoverStyle" role="menu"><template v-if="managed"><button role="menuitem" :disabled="preview" @click="menu='';emit('phone')"><Smartphone :size="16"/>手机互联</button><small v-if="preview">本地预览未连接手机，正式入口沿用同一员工。</small><button role="menuitem" @click="menu='';emit('settings','routines')"><Clock3 :size="16"/>例行工作</button><button role="menuitem" @click="menu='';emit('settings','activity')">运行与控制</button></template><template v-else><button role="menuitem" @click="menu='';toggleWorkPanel()"><PanelRight :size="16"/>任务与附件</button><button role="menuitem" @click="menu='';emit('directory',{useDeviceDefault:true})"><Folder :size="16"/>使用电脑当前目录</button><button role="menuitem" @click="menu='';emit('archive-conversation')"><Archive :size="16"/>归档当前会话</button></template></div></div>
      </div>
    </header>
    <div class="bot-chat-body" :class="{'with-panel':panel}">
      <main class="bot-chat-main">
        <BotInteractionCard v-if="managed&&bot?.employee?.runtime==='Hermes'&&bot?.workspace&&bot?.id&&!preview" :workspace="bot.workspace" :employee-id="bot.id" :action-id="execution?.id||bot.latest_run?.id"/>
        <div class="bot-chat-timeline-wrap"><div ref="timeline" v-conversation-read class="bot-chat-timeline" aria-live="polite" tabindex="0" aria-label="聊天记录" @scroll="timelineScrolled" @wheel.passive="timelineWheel" @touchstart.passive="timelineTouchStart" @touchmove.passive="timelineTouchMove" @pointerdown="timelinePointer" @keydown="timelineKey" @load.capture="timelineMediaLoaded">
          <div class="bot-chat-transcript">
            <div v-if="hasEarlierHistory||historyLoading||historyError" class="bot-chat-history" :aria-busy="historyLoading"><button v-if="hasEarlierHistory" type="button" :disabled="historyLoading||historyRequested" @click="requestEarlierHistory"><RefreshCw v-if="historyLoading" :size="13"/>{{historyLoading?'正在加载更早消息…':historyError?'重试加载更早消息':'加载更早消息'}}</button><p v-if="historyError" role="alert">{{historyError}}</p></div>
            <p class="bot-chat-day">{{managed?'同一位伙伴，同一条长期对话':conversation.title||'当前员工会话'}}</p><div v-if="forwardResult" class="chat-forward-result"><span>聊天记录已转发</span><button type="button" @click="emit('forward-view')">查看接收聊天</button></div><div v-if="forwardSelecting" class="chat-forward-selection"><span>已选 {{forwardSelected.length}} / 20 条</span><button type="button" @click="emit('forward-cancel')">取消</button><button type="button" :disabled="!forwardSelected.length" @click="emit('forward-open')">转发</button><small v-if="forwardError" role="alert">{{forwardError}}</small></div>
            <article v-for="message in conversation?.messages" :key="message.id" class="bot-chat-message" :class="message.role" :data-message-id="message.id">
              <label v-if="forwardSelecting" class="chat-forward-select"><input type="checkbox" :checked="forwardSelected.includes(message.id)" :aria-label="'选择消息：'+(message.content?.slice(0,30)||'聊天记录')" @change="emit('forward-toggle',message.id)"/>选择</label>
              <span v-if="message.role==='assistant'" class="bot-chat-message-avatar">{{name.slice(0,1)}}</span>
              <div class="bot-chat-message-body"><ConversationForwardCard v-if="isConversationForward(message.forward)" :forward="message.forward" :preview-src="previewSrc" @preview-image="emit('preview-image',$event)" @download="emit('download',$event)"/><p v-else-if="message.content">{{message.content}}</p><div v-if="!isConversationForward(message.forward)&&message.attachments?.length" class="bot-chat-message-files"><div v-for="(attachment,index) in message.attachments" :key="index" class="bot-chat-file"><button v-if="previewSrc?.(attachment)" :aria-label="'查看大图：'+attachment.name" @click="emit('preview-image',attachment)"><img :src="previewSrc(attachment)" :alt="attachment.name"/></button><strong>{{attachment.name}}</strong><button :aria-label="'下载图片：'+attachment.name" @click="emit('download',attachment)"><Download :size="15"/>下载图片</button></div></div><button v-if="message.role==='user'&&execution?.payload?.messageId===message.id&&executionState.retryable" class="bot-chat-text-link" :disabled="sendPending||attachmentReading" @click="emit('retry-message',message)">重新编辑并重试</button><small v-if="conversationQueueStatusLabel(message.queue_status)" class="bot-chat-compose-note">{{conversationQueueStatusLabel(message.queue_status)}}</small><time v-if="message.created_at">{{chatLocalTime(message.created_at)}}</time><div v-if="!forwardSelecting" class="chat-forward-message-actions"><button type="button" @click="emit('forward',message)">转发</button><button type="button" @click="emit('forward-select',message)">多选</button></div></div>
            </article>
            <div v-if="!conversation?.messages?.length" class="bot-chat-empty"><span class="bot-chat-avatar">{{name.slice(0,1)}}</span><h2>从这里，继续合作</h2><p>{{managed?'消息和执行结果会留在这条主聊天里。':'消息和执行结果保存在当前员工的这条会话。'}}</p></div>
            <details v-if="execution" :open="(executionState.busy||uncertain)&&!finalizationState" class="bot-chat-progress" :data-tone="executionState.tone"><summary><span><i/>{{executionState.summary||executionState.label}}</span><small>{{events.length?events.length+' 个阶段':'查看执行记录'}}<ChevronDown :size="14"/></small></summary><div class="bot-chat-progress-events"><p v-if="historicalRecovery">{{stopState.label}}</p><details v-if="(historicalRecovery||finalizationState||canFinalize)&&execution.error"><summary>原始失败记录（已保留）</summary><p>{{execution.error}}</p></details><p v-else-if="execution.error">{{execution.error}}</p><p v-if="uncertain&&!finalizationState">{{botRecoveryDetail(execution)}}</p><button v-if="recoveryEvent" :disabled="reconcileBusy||stopBusy||finalizationBusy||statusLoading" @click="emit('reconcile')">{{reconcileBusy?'正在核实…':'核实并恢复回执'}}</button><p v-for="event in events" :key="event.id"><strong>{{event.label}}</strong><span>{{event.detail}}</span><time>{{chatLocalTime(event.created_at)}}</time></p><p v-if="execution.result?.processExit">进程退出证据：{{processExitConfirmed(execution.result)?'根进程与进程树退出均已确认':'尚未完整确认'}}</p><p v-if="managed&&!historicalRecovery&&(bot?.stop_action?.payload?.actionId===execution.id||stopState.confirmed)">{{stopState.label}}</p><button v-if="managed" @click="emit('settings','activity')">查看原执行与停止回执</button></div></details>
            <details v-if="reasoningSummaries.length" class="bot-chat-reasoning"><summary>思考摘要 <small>{{reasoningSummaries.length}} 条公开摘要</small></summary><article v-for="event in reasoningSummaries" :key="event.id"><div><strong>{{event.label}}</strong><time>{{chatLocalTime(event.created_at)}}</time></div><p>{{event.summary}}</p></article></details>
          </div>
        </div><button v-if="showLatest" type="button" class="bot-chat-jump-latest" @click="jumpLatest"><ChevronDown :size="14"/>跳至最新</button></div>
        <footer class="bot-chat-compose">
          <ConversationQueuePanel :queue="queue" :busy="queueBusy" :error="queueError" @pause="emit('queue-pause')" @resume="emit('queue-resume')" @remove="emit('queue-remove',$event)"/>
          <div v-if="attachments.length" class="bot-chat-draft-files"><div v-for="(attachment,index) in attachments" :key="index"><button :aria-label="'查看待发送图片：'+attachment.name" @click="emit('preview-image',attachment)"><img :src="previewSrc?.(attachment)" :alt="attachment.name"/></button><span>{{attachment.name}}</span><button :aria-label="'移除图片：'+attachment.name" @click="emit('remove-attachment',index)"><X :size="13"/></button></div></div>
          <div class="bot-chat-editor"><textarea :value="draft" rows="3" :aria-label="managed?'主聊天消息':'会话消息'" :placeholder="'继续交给 '+name+'…'" @input="emit('update:draft',$event.target.value)" @paste="emit('paste-attachment',$event)" @compositionstart="enterGuard.compositionStart" @compositionend="enterGuard.compositionEnd" @keydown="keydown"/>
            <div class="bot-chat-compose-tools"><button class="bot-chat-add" aria-label="添加图片" title="添加图片" :disabled="sendPending||attachmentReading" @click="fileInput?.click()"><Plus :size="20"/></button><input ref="fileInput" hidden type="file" accept=".png,.jpg,.jpeg,.gif,.webp,image/png,image/jpeg,image/gif,image/webp" multiple @change="emit('attachment',$event)"/>
              <div class="bot-chat-chips">
                <div class="bot-chat-chip-menu"><button class="bot-chat-chip" aria-label="会话模型" :aria-expanded="menu==='model'" @click="toggleMenu('model',$event)"><span>{{modelLabel||'沿用 Profile 模型'}}</span><ChevronDown :size="12"/></button><div v-if="menu==='model'" class="bot-chat-popover" :style="popoverStyle"><strong>当前模型</strong><p>{{modelLabel||'沿用已绑定 Profile 的模型配置'}}</p><small>{{managed?'模型跟随这位 Bot 的运行绑定。':'会话模型按当前员工的运行时能力保存。'}}</small><div v-if="!managed" class="bot-chat-conversation-settings"><slot name="conversation-settings" kind="model"><button @click="menu='';emit('settings','settings')">在员工设置查看模型</button></slot></div><button v-else @click="menu='';emit('settings','settings')">在 Bot 设置调整模型</button></div></div>
                <div class="bot-chat-chip-menu"><button class="bot-chat-chip" aria-label="绑定电脑" :aria-expanded="menu==='device'" @click="toggleMenu('device',$event)"><Monitor :size="14"/><span>{{device?.name||'电脑状态待同步'}}</span><ChevronDown :size="12"/></button><div v-if="menu==='device'" class="bot-chat-popover" :style="popoverStyle"><strong>{{device?.name||'绑定电脑'}}</strong><p>{{device?.status==='online'?'当前在线':device?.status==='offline'?'当前离线':'状态待同步'}}</p><small>{{managed?(bot?.instance?.mode==='owned_profile'?'专属 Profile':'来源 Profile'):'员工运行配置'}}：{{chatEmployee?.runtime_profile||(chatEmployee?.runtime?'默认 Profile（未显式指定）':'运行时尚未指定')}}。</small><div v-if="!managed" class="bot-chat-conversation-settings"><slot name="conversation-settings" kind="device"><button @click="menu='';emit('settings','settings')">查看运行绑定</button></slot></div><button v-else @click="menu='';emit('settings','settings')">查看运行绑定</button></div></div>
                <button class="bot-chat-chip directory-chip" aria-label="选择目录" :title="workingDirectory||'检查并选择工作目录'" @click="emit('directory')"><Folder :size="14"/><span>{{directoryLabel}}</span><ChevronDown :size="12"/></button>
              </div>
              <button v-if="canFinalize" class="bot-chat-stop" aria-label="结束本次失败执行" :disabled="finalizationBusy||stopBusy||reconcileBusy||statusLoading" @click="emit('finalize-failure')"><Square :size="16"/>{{finalizationBusy?'正在结束…':'结束本次执行'}}</button><button v-else-if="canStop" class="bot-chat-stop" aria-label="请求停止当前执行" :disabled="stopBusy||reconcileBusy" @click="emit('stop')"><Square :size="16"/>{{stopBusy?'请求中':'停止'}}</button><button v-if="!canFinalize" class="bot-chat-send" :aria-label="executionState.busy||canStop||queue.count||queue.paused?'加入队列':'发送'" :disabled="Boolean(blockedReason)||blocksSending||finalizationBusy||sendPending||attachmentReading||statusLoading||(!draft.trim()&&!attachments.length)" @click="emit('send')"><ArrowUp :size="21"/></button>
            </div>
          </div>
          <p v-if="finalizationState" class="bot-chat-error" role="status"><strong>{{finalizationState.summary}}</strong> · {{finalizationState.detail}}</p><p v-if="blockedReason" class="bot-chat-error" role="status">{{blockedReason}} <button class="bot-chat-text-link" @click="emit('settings','activity')">打开 Bot 设置</button></p><p v-if="sendError" class="bot-chat-error" role="alert">{{sendError}}</p><p class="bot-chat-compose-note">{{attachmentReading?'正在读取图片…':sendPending?'正在核对原发送请求…':blocksSending?'本轮已失败，原进程仍在运行，可请求停止。':executionState.busy||canStop||queue.count||queue.paused?'Enter 加入队列 · Shift + Enter 换行':'Enter 发送 · Shift + Enter 换行'}}<span>支持 PNG、JPG/JPEG、GIF、WebP · 每条最多 20 张，合计最多 10 MB。</span></p>
        </footer>
      </main>
      <aside v-if="panel" class="bot-chat-work" aria-label="Bot 工作面板"><div class="bot-chat-work-heading"><strong>工作面板</strong><button aria-label="关闭工作面板" @click="panel=false"><X :size="18"/></button></div><button class="bot-chat-work-refresh" :disabled="workLoading" @click="emit('refresh-work')"><RefreshCw :size="14"/>{{workLoading?'同步中…':'刷新实际记录'}}</button><p v-if="workError" class="bot-chat-error">{{workError}}</p>
        <section><h3>关联任务 <span>{{work.tasks?.length||0}}</span></h3><div v-for="task in work.tasks" :key="task.id" class="bot-chat-work-row"><strong>{{task.title}}</strong><small>{{task.state||task.status}}</small></div><p v-if="!work.tasks?.length" class="bot-chat-work-empty">{{managed?'这位 Bot 暂无关联任务。':'关联任务可在工作区任务中查看。'}}</p><button class="bot-chat-text-link" @click="emit('workspace-tasks')">查看工作区任务</button></section>
        <section><h3>会话附件 <span>{{files.length}}</span></h3><div v-for="file in files" :key="file.key" class="bot-chat-work-row"><FileText :size="17"/><span><strong>{{file.name}}</strong><small>{{sizeLabel?.(file)||'来自此会话'}}</small></span><button :aria-label="'下载图片：'+file.name" @click="emit('download',file)"><Download :size="16"/></button></div><p v-if="!files.length" class="bot-chat-work-empty">附件会随真实消息显示在这里。</p></section>
        <section v-if="managed"><h3>例行工作 <span>{{work.routines?.length||0}}</span></h3><div v-for="routine in work.routines" :key="routine.id" class="bot-chat-work-row"><span><strong>{{routine.name}}</strong><small>{{routine.status}}</small></span></div><p v-if="!work.routines?.length" class="bot-chat-work-empty">尚未设置例行工作。</p><button class="bot-chat-text-link" @click="emit('settings','routines')">管理例行工作</button></section>
        <section v-if="managed"><h3>最近运行</h3><div v-for="run in (work.runs||[]).slice(0,5)" :key="run.id" class="bot-chat-work-row"><span><strong>{{executionPresentation(run).label}}</strong><small>{{chatLocalTime(run.completed_at||run.created_at)}}</small></span></div><p v-if="!work.runs?.length" class="bot-chat-work-empty">尚无运行记录。</p><button class="bot-chat-text-link" @click="emit('settings','activity')">运行与控制</button></section>
      </aside>
    </div>
  </section>
</template>
<style scoped src="../bot-main-chat.css"></style>
