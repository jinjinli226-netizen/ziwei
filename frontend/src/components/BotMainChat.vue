<script setup>
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue';
import {ArrowLeft,ArrowUp,Plus,Settings2,PanelRight,ChevronDown,Monitor,Folder,MoreHorizontal,Smartphone,X,RefreshCw,Square,Download,FileText,Clock3} from 'lucide-vue-next';
import {botPresence,executionUncertain,botStopPresentation,botRecoveryEvent,botRecoveryDetail,processExitConfirmed} from '../bot-presentation.js';
import {chatLocalTime,conversationFiles} from '../bot-main-chat.js';
import {ownedBotChatBlockReason} from '../bot-owned-profile.js';
import {executionPresentation} from '../conversation-execution-state.mjs';
const props=defineProps({bot:Object,conversation:Object,execution:Object,events:{type:Array,default:()=>[]},draft:{type:String,default:''},attachments:{type:Array,default:()=>[]},device:Object,modelLabel:String,workingDirectory:String,sendPending:Boolean,attachmentReading:Boolean,statusLoading:Boolean,sendError:String,stopBusy:Boolean,reconcileBusy:Boolean,canStop:Boolean,preview:Boolean,work:{type:Object,default:()=>({runs:[],routines:[],tasks:[]})},workLoading:Boolean,workError:String,previewSrc:Function,sizeLabel:Function});
const emit=defineEmits(['retry-message','update:draft','send','settings','return','directory','attachment','paste-attachment','remove-attachment','preview-image','download','stop','reconcile','refresh-work','phone','workspace-tasks']);
const panel=ref(typeof window!=='undefined'&&window.innerWidth>=1100),menu=ref(''),popoverStyle=ref({}),fileInput=ref(null),timeline=ref(null),followLatest=ref(true);
const uncertain=computed(()=>executionUncertain(props.execution));
const recoveryEvent=computed(()=>botRecoveryEvent(props.execution));
const stopState=computed(()=>botStopPresentation(props.bot,props.execution));
const blockedReason=computed(()=>ownedBotChatBlockReason(props.bot));
function toggleMenu(value,event){menu.value=menu.value===value?'':value;if(!menu.value)return;const anchor=event.currentTarget;nextTick(()=>{const box=document.querySelector('.bot-main-chat .bot-chat-popover');if(!box)return;const rect=anchor.getBoundingClientRect(),width=box.offsetWidth,height=box.offsetHeight;popoverStyle.value={position:'fixed',left:Math.max(12,Math.min(rect.left,window.innerWidth-width-12))+'px',top:Math.max(12,Math.min(value==='more'?rect.bottom+8:rect.top-height-10,window.innerHeight-height-12))+'px',bottom:'auto',right:'auto'};});}
function resized(){menu.value='';if(window.innerWidth<1000)panel.value=false;}
const presence=computed(()=>botPresence(props.bot)),executionState=computed(()=>stopState.value.confirmed?{label:stopState.value.label,summary:'原执行已停止',busy:false,tone:'muted',retryable:false}:executionPresentation(props.execution)),files=computed(()=>conversationFiles(props.conversation?.messages));
const name=computed(()=>props.bot?.employee?.name||props.conversation?.employee?.name||'Hermes Bot');
const directoryLabel=computed(()=>String(props.workingDirectory||'').split(/[\\/]/).filter(Boolean).at(-1)||'选择工作目录');
const status=computed(()=>props.device?.status==='offline'?'电脑离线':props.execution?(executionState.value.summary||executionState.value.label):presence.value.label);
function keydown(event){if(event.isComposing)return;if(event.key==='Enter'&&!event.shiftKey&&!event.ctrlKey&&!event.altKey&&!event.metaKey){event.preventDefault();if(!uncertain.value&&!blockedReason.value&&!props.sendPending&&!props.attachmentReading&&!props.statusLoading)emit('send');}}
function closeMenus(event){if(event.key==='Escape'){menu.value='';panel.value=false;}else if(!event.target.closest?.('.bot-chat-chip-menu'))menu.value='';}
function scrollLatest(){nextTick(()=>{const node=timeline.value;if(node&&followLatest.value)node.scrollTop=node.scrollHeight;});}
watch(()=>props.conversation?.messages,scrollLatest,{deep:true});
onMounted(()=>{window.addEventListener('resize',resized);document.addEventListener('keydown',closeMenus);document.addEventListener('pointerdown',closeMenus);nextTick(()=>{if(timeline.value)timeline.value.scrollTop=timeline.value.scrollHeight;});});
onBeforeUnmount(()=>{window.removeEventListener('resize',resized);document.removeEventListener('keydown',closeMenus);document.removeEventListener('pointerdown',closeMenus);});
</script>
<template>
  <section class="bot-main-chat" role="region" aria-label="Bot 主聊天" :data-bot-id="bot.id" :data-conversation-id="conversation.id">
    <header class="bot-chat-header">
      <button class="bot-chat-return" aria-label="返回紫薇" title="返回当前 Bot" @click="emit('return')"><ArrowLeft :size="19"/></button>
      <img v-if="bot?.employee?.avatar" :src="bot.employee.avatar" class="bot-chat-avatar" alt=""/><span v-else class="bot-chat-avatar">{{name.slice(0,1)}}</span>
      <div class="bot-chat-identity"><strong>{{name}}</strong><span><i :data-tone="executionState.busy?'working':presence.tone"/>{{status}}<small> · 主聊天</small></span></div>
      <div class="bot-chat-header-actions"><span v-if="preview" class="bot-chat-local">本地预览</span><button aria-label="Bot 设置" title="Bot 设置" @click="emit('settings','settings')"><Settings2 :size="18"/><span>Bot 设置</span></button><button aria-label="工作面板" :aria-expanded="panel" @click="panel=!panel"><PanelRight :size="18"/><span>工作面板</span></button>
        <div class="bot-chat-chip-menu"><button aria-label="更多能力" :aria-expanded="menu==='more'" @click="toggleMenu('more',$event)"><MoreHorizontal :size="20"/></button><div v-if="menu==='more'" class="bot-chat-popover header-popover" :style="popoverStyle" role="menu"><button role="menuitem" :disabled="preview" @click="menu='';emit('phone')"><Smartphone :size="16"/>手机互联</button><small v-if="preview">本地预览未连接手机，正式入口沿用同一员工。</small><button role="menuitem" @click="menu='';emit('settings','routines')"><Clock3 :size="16"/>例行工作</button><button role="menuitem" @click="menu='';emit('settings','activity')">运行与控制</button></div></div>
      </div>
    </header>
    <div class="bot-chat-body" :class="{'with-panel':panel}">
      <main class="bot-chat-main">
        <div ref="timeline" class="bot-chat-timeline" aria-live="polite" @scroll="followLatest=$event.target.scrollHeight-$event.target.scrollTop-$event.target.clientHeight<180">
          <div class="bot-chat-transcript">
            <p class="bot-chat-day">同一位伙伴，同一条长期对话</p>
            <article v-for="message in conversation?.messages" :key="message.id" class="bot-chat-message" :class="message.role">
              <span v-if="message.role==='assistant'" class="bot-chat-message-avatar">{{name.slice(0,1)}}</span>
              <div class="bot-chat-message-body"><p v-if="message.content">{{message.content}}</p><div v-if="message.attachments?.length" class="bot-chat-message-files"><div v-for="(attachment,index) in message.attachments" :key="index" class="bot-chat-file"><button v-if="previewSrc?.(attachment)" :aria-label="'查看大图：'+attachment.name" @click="emit('preview-image',attachment)"><img :src="previewSrc(attachment)" :alt="attachment.name"/></button><strong>{{attachment.name}}</strong><button :aria-label="'下载图片：'+attachment.name" @click="emit('download',attachment)"><Download :size="15"/>下载图片</button></div></div><button v-if="message.role==='user'&&execution?.payload?.messageId===message.id&&executionState.retryable" class="bot-chat-text-link" :disabled="sendPending||attachmentReading" @click="emit('retry-message',message)">重新编辑并重试</button><time v-if="message.created_at">{{chatLocalTime(message.created_at)}}</time></div>
            </article>
            <div v-if="!conversation?.messages?.length" class="bot-chat-empty"><span class="bot-chat-avatar">{{name.slice(0,1)}}</span><h2>从这里，继续合作</h2><p>消息和执行结果会留在这条主聊天里。</p></div>
            <details v-if="execution" :open="uncertain" class="bot-chat-progress" :data-tone="executionState.tone"><summary><span><i/>{{executionState.summary||executionState.label}}</span><small>{{events.length?events.length+' 个阶段':'查看执行记录'}}<ChevronDown :size="14"/></small></summary><div class="bot-chat-progress-events"><p v-if="execution.error">{{execution.error}}</p><p v-if="uncertain">{{botRecoveryDetail(execution)}}</p><button v-if="recoveryEvent" :disabled="reconcileBusy||stopBusy||statusLoading" @click="emit('reconcile')">{{reconcileBusy?'正在核实…':'核实并恢复回执'}}</button><p v-for="event in events" :key="event.id"><strong>{{event.label}}</strong><span>{{event.detail}}</span><time>{{chatLocalTime(event.created_at)}}</time></p><p v-if="execution.result?.processExit">进程退出证据：{{processExitConfirmed(execution.result)?'根进程与进程树退出均已确认':'尚未完整确认'}}</p><p v-if="bot.stop_action?.payload?.actionId===execution.id||stopState.confirmed">{{stopState.label}}</p><button @click="emit('settings','activity')">查看原执行与停止回执</button></div></details>
          </div>
        </div>
        <footer class="bot-chat-compose">
          <div v-if="attachments.length" class="bot-chat-draft-files"><div v-for="(attachment,index) in attachments" :key="index"><button :aria-label="'查看待发送图片：'+attachment.name" @click="emit('preview-image',attachment)"><img :src="previewSrc?.(attachment)" :alt="attachment.name"/></button><span>{{attachment.name}}</span><button :aria-label="'移除图片：'+attachment.name" @click="emit('remove-attachment',index)"><X :size="13"/></button></div></div>
          <div class="bot-chat-editor"><textarea :value="draft" rows="3" aria-label="主聊天消息" :placeholder="'继续交给 '+name+'…'" @input="emit('update:draft',$event.target.value)" @paste="emit('paste-attachment',$event)" @keydown="keydown"/>
            <div class="bot-chat-compose-tools"><button class="bot-chat-add" aria-label="添加图片" title="添加图片" :disabled="sendPending||attachmentReading" @click="fileInput?.click()"><Plus :size="20"/></button><input ref="fileInput" hidden type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple @change="emit('attachment',$event)"/>
              <div class="bot-chat-chips">
                <div class="bot-chat-chip-menu"><button class="bot-chat-chip" aria-label="会话模型" :aria-expanded="menu==='model'" @click="toggleMenu('model',$event)"><span>{{modelLabel||'沿用 Profile 模型'}}</span><ChevronDown :size="12"/></button><div v-if="menu==='model'" class="bot-chat-popover" :style="popoverStyle"><strong>当前模型</strong><p>{{modelLabel||'沿用已绑定 Profile 的模型配置'}}</p><small>模型跟随这位 Bot 的运行绑定。</small><button @click="menu='';emit('settings','settings')">在 Bot 设置调整模型</button></div></div>
                <div class="bot-chat-chip-menu"><button class="bot-chat-chip" aria-label="绑定电脑" :aria-expanded="menu==='device'" @click="toggleMenu('device',$event)"><Monitor :size="14"/><span>{{device?.name||'电脑状态待同步'}}</span><ChevronDown :size="12"/></button><div v-if="menu==='device'" class="bot-chat-popover" :style="popoverStyle"><strong>{{device?.name||'绑定电脑'}}</strong><p>{{device?.status==='online'?'当前在线':device?.status==='offline'?'当前离线':'状态待同步'}}</p><small>{{bot?.instance?.mode==='owned_profile'?'专属 Profile':'来源 Profile'}}：{{bot?.employee?.runtime_profile||'待核对'}}。绑定保持在同一 Bot。</small><button @click="menu='';emit('settings','settings')">查看运行绑定</button></div></div>
                <button class="bot-chat-chip directory-chip" aria-label="选择目录" :title="workingDirectory||'检查并选择工作目录'" @click="emit('directory')"><Folder :size="14"/><span>{{directoryLabel}}</span><ChevronDown :size="12"/></button>
              </div>
              <button v-if="canStop" class="bot-chat-stop" aria-label="请求停止当前执行" :disabled="stopBusy||reconcileBusy" @click="emit('stop')"><Square :size="16"/>{{stopBusy?'请求中':'停止'}}</button><button v-else class="bot-chat-send" aria-label="发送" :disabled="Boolean(blockedReason)||sendPending||attachmentReading||statusLoading||(!draft.trim()&&!attachments.length)" @click="emit('send')"><ArrowUp :size="21"/></button>
            </div>
          </div>
          <p v-if="blockedReason" class="bot-chat-error" role="status">{{blockedReason}} <button class="bot-chat-text-link" @click="emit('settings','activity')">打开 Bot 设置</button></p><p v-if="sendError" class="bot-chat-error" role="alert">{{sendError}}</p><p class="bot-chat-compose-note">{{attachmentReading?'正在读取图片…':sendPending?'正在核对原发送请求…':uncertain?'先核对原执行结果，再发送新的工作':'Enter 发送 · Shift + Enter 换行'}}<span>每条最多 20 张图片，合计最多 10 MB。</span></p>
        </footer>
      </main>
      <aside v-if="panel" class="bot-chat-work" aria-label="Bot 工作面板"><div class="bot-chat-work-heading"><strong>工作面板</strong><button aria-label="关闭工作面板" @click="panel=false"><X :size="18"/></button></div><button class="bot-chat-work-refresh" :disabled="workLoading" @click="emit('refresh-work')"><RefreshCw :size="14"/>{{workLoading?'同步中…':'刷新实际记录'}}</button><p v-if="workError" class="bot-chat-error">{{workError}}</p>
        <section><h3>关联任务 <span>{{work.tasks?.length||0}}</span></h3><div v-for="task in work.tasks" :key="task.id" class="bot-chat-work-row"><strong>{{task.title}}</strong><small>{{task.state||task.status}}</small></div><p v-if="!work.tasks?.length" class="bot-chat-work-empty">这位 Bot 暂无关联任务。</p><button class="bot-chat-text-link" @click="emit('workspace-tasks')">查看工作区任务</button></section>
        <section><h3>会话附件 <span>{{files.length}}</span></h3><div v-for="file in files" :key="file.key" class="bot-chat-work-row"><FileText :size="17"/><span><strong>{{file.name}}</strong><small>{{sizeLabel?.(file)||'来自此会话'}}</small></span><button :aria-label="'下载图片：'+file.name" @click="emit('download',file)"><Download :size="16"/></button></div><p v-if="!files.length" class="bot-chat-work-empty">附件会随真实消息显示在这里。</p></section>
        <section><h3>例行工作 <span>{{work.routines?.length||0}}</span></h3><div v-for="routine in work.routines" :key="routine.id" class="bot-chat-work-row"><span><strong>{{routine.name}}</strong><small>{{routine.status}}</small></span></div><p v-if="!work.routines?.length" class="bot-chat-work-empty">尚未设置例行工作。</p><button class="bot-chat-text-link" @click="emit('settings','routines')">管理例行工作</button></section>
        <section><h3>最近运行</h3><div v-for="run in (work.runs||[]).slice(0,5)" :key="run.id" class="bot-chat-work-row"><span><strong>{{executionPresentation(run).label}}</strong><small>{{chatLocalTime(run.completed_at||run.created_at)}}</small></span></div><p v-if="!work.runs?.length" class="bot-chat-work-empty">尚无运行记录。</p><button class="bot-chat-text-link" @click="emit('settings','activity')">运行与控制</button></section>
      </aside>
    </div>
  </section>
</template>
<style scoped src="../bot-main-chat.css"></style>
