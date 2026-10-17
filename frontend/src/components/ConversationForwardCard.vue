<script setup>
import {computed,ref,watch} from 'vue';
import {ChevronDown,Download,MessagesSquare} from 'lucide-vue-next';
import {isConversationForward,conversationForwardSummary,conversationForwardMessages} from '../conversation-forward-card.mjs';

const props=defineProps({forward:Object,previewSrc:Function});
const emit=defineEmits(['preview-image','download']);
const expanded=ref(false);
const valid=computed(()=>isConversationForward(props.forward));
const summary=computed(()=>conversationForwardSummary(props.forward));
const messages=computed(()=>conversationForwardMessages(props.forward));
watch(()=>props.forward?.id,()=>{expanded.value=false;});
function imageSource(attachment){return props.previewSrc?.(attachment)||'';}
function attachmentName(attachment,index){return attachment.name?.trim()||`图片 ${index+1}`;}
</script>

<template>
  <section v-if="valid" class="conversation-forward-card" aria-label="合并聊天记录">
    <button type="button" class="conversation-forward-card__toggle" :aria-expanded="expanded" @click="expanded=!expanded">
      <span class="conversation-forward-card__heading"><MessagesSquare :size="17" aria-hidden="true"/><strong>{{summary.sourceName}}的聊天记录</strong><span class="conversation-forward-card__count">{{summary.count}} 条</span></span>
      <span v-if="!expanded" class="conversation-forward-card__summary"><span v-for="(line,index) in summary.lines" :key="index"><b>{{line.senderName}}：</b>{{line.text}}</span></span>
      <span class="conversation-forward-card__footer"><span>合并转发</span><span>{{expanded?'收起记录':'查看聊天记录'}}<ChevronDown :size="14" :class="{'is-expanded':expanded}" aria-hidden="true"/></span></span>
    </button>
    <div v-if="expanded" class="conversation-forward-card__messages">
      <article v-for="message in messages" :key="message.key" class="conversation-forward-card__message">
        <header><strong>{{message.senderName}}</strong><time v-if="message.time" :datetime="message.createdAt">{{message.time}}</time><span v-else class="conversation-forward-card__missing-time">时间未记录</span></header>
        <p v-if="message.content" class="conversation-forward-card__content">{{message.content}}</p>
        <div v-if="message.attachments.length" class="conversation-forward-card__files">
          <div v-for="(attachment,index) in message.attachments" :key="index" class="conversation-forward-card__file">
            <button v-if="imageSource(attachment)" type="button" class="conversation-forward-card__image" :aria-label="'查看大图：'+attachmentName(attachment,index)" @click="emit('preview-image',attachment)"><img :src="imageSource(attachment)" :alt="attachmentName(attachment,index)" loading="lazy"/></button>
            <div class="conversation-forward-card__file-label"><span :title="attachmentName(attachment,index)">{{attachmentName(attachment,index)}}</span><button type="button" :aria-label="'下载图片：'+attachmentName(attachment,index)" @click="emit('download',attachment)"><Download :size="14" aria-hidden="true"/>下载</button></div>
          </div>
        </div>
        <p v-if="!message.content&&!message.attachments.length" class="conversation-forward-card__empty">空消息</p>
      </article>
    </div>
    <p v-if="forward.note?.trim()" class="conversation-forward-card__note"><span>附言</span>{{forward.note}}</p>
  </section>
</template>

<style scoped>
.conversation-forward-card{box-sizing:border-box;width:min(100%,440px);min-width:0;overflow:hidden;border:1px solid #e4dfee;border-radius:12px;background:#fff;color:#352f43;text-align:left;font-size:13px;line-height:1.5;}
.conversation-forward-card button{box-sizing:border-box;font:inherit;cursor:pointer;}
.conversation-forward-card button:focus-visible{outline:2px solid #9475de;outline-offset:-3px;}
.conversation-forward-card__toggle{display:block;width:100%;padding:14px 16px 0;border:0;background:#faf8fd;color:inherit;text-align:left;}
.conversation-forward-card__toggle:hover{background:#f5f1fb;}
.conversation-forward-card__heading{display:flex;align-items:center;gap:8px;min-width:0;}
.conversation-forward-card__heading>svg{flex:none;color:#8262bb;}
.conversation-forward-card__heading>strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:600;}
.conversation-forward-card__count{flex:none;margin-left:auto;font-size:12px;color:#8a8196;}
.conversation-forward-card__summary{display:grid;gap:4px;margin:10px 0 12px;color:#8a8196;font-size:12px;}
.conversation-forward-card__summary>span{display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}
.conversation-forward-card__summary b{font-weight:400;color:#70667d;}
.conversation-forward-card__footer{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px;padding:9px 0;border-top:1px solid #ece7f3;font-size:11px;color:#91879e;}
.conversation-forward-card__footer>span:last-child{display:flex;align-items:center;gap:4px;color:#8262bb;}
.conversation-forward-card__footer svg{transition:transform .15s ease;}
.conversation-forward-card__footer svg.is-expanded{transform:rotate(180deg);}
.conversation-forward-card__messages{max-height:560px;max-height:min(560px,65dvh);overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding:0 16px;}
.conversation-forward-card__message{padding:14px 0;border-bottom:1px solid #eeeaf3;}
.conversation-forward-card__message:last-child{border-bottom:0;}
.conversation-forward-card__message>header{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;margin-bottom:6px;}
.conversation-forward-card__message>header>strong{max-width:100%;overflow-wrap:anywhere;color:#6d548f;font-size:12px;font-weight:600;}
.conversation-forward-card__message time,.conversation-forward-card__missing-time{color:#a097ab;font-size:11px;white-space:nowrap;}
.conversation-forward-card__content{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:1.7;}
.conversation-forward-card__files{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(140px,100%),1fr));gap:10px;margin-top:9px;}
.conversation-forward-card__file{min-width:0;overflow:hidden;border:1px solid #eee8f5;border-radius:8px;background:#fbfafc;}
.conversation-forward-card__image{display:block;width:100%;height:140px;padding:0;border:0;background:#f0edf5;}
.conversation-forward-card__image img{display:block;width:100%;height:100%;object-fit:contain;}
.conversation-forward-card__file-label{display:flex;align-items:center;gap:6px;padding:7px 8px;}
.conversation-forward-card__file-label>span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#8a8196;font-size:11px;}
.conversation-forward-card__file-label>button{display:inline-flex;flex:none;align-items:center;gap:3px;padding:3px 0;border:0;background:transparent;color:#8262bb;font-size:11px;}
.conversation-forward-card__note{margin:0;padding:10px 16px;border-top:1px solid #ece7f3;background:#fcfbfe;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;color:#6f647f;}
.conversation-forward-card__note>span{margin-right:8px;color:#9b90a8;}
.conversation-forward-card__empty{margin:0;color:#a097ab;font-size:12px;}
@media(max-width:480px){.conversation-forward-card{width:100%;}.conversation-forward-card__toggle{padding:12px 12px 0;}.conversation-forward-card__messages{padding:0 12px;}.conversation-forward-card__note{padding:10px 12px;}.conversation-forward-card__heading>strong{font-size:13px;}.conversation-forward-card__image{height:120px;}}
@media(prefers-reduced-motion:reduce){.conversation-forward-card__footer svg{transition:none;}}
</style>
