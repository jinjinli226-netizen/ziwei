<script setup>
import {computed} from 'vue';
const props=defineProps({queue:{type:Object,required:true},busy:{type:Boolean,default:false},error:{type:String,default:''}});
const emit=defineEmits(['pause','resume','remove']);
const normalizedQueue=computed(()=>{
  const value=props.queue||{},count=Number(value.count);
  return {paused:value.paused===true,count:Number.isFinite(count)&&count>0?count:0,items:Array.isArray(value.items)?value.items:[]};
});
</script>

<template>
  <section v-if="normalizedQueue.count || normalizedQueue.paused || error" class="conversation-queue-panel" aria-label="待发消息队列" :aria-busy="busy">
    <header><strong>待发 {{ normalizedQueue.count }} 条</strong><button type="button" :disabled="busy" @click="emit(normalizedQueue.paused ? 'resume' : 'pause')">{{ normalizedQueue.paused ? '继续发送' : '暂停待发' }}</button></header>
    <p role="status">{{ normalizedQueue.paused ? '队列已暂停，消息和附件已保留；继续发送或提交新消息即可开启。' : '当前回答继续，待发消息将按顺序处理。' }}</p>
    <p v-if="error" class="conversation-queue-error" role="alert">{{ error }}</p>
    <ul v-if="normalizedQueue.items.length">
      <li v-for="item in normalizedQueue.items" :key="item.id">
        <div><span class="conversation-queue-preview" :title="item.content">{{ item.content || '图片消息' }}</span><small v-if="item.attachments?.length">{{ item.attachments.length }} 个附件</small></div>
        <button type="button" :disabled="busy" :aria-label="'移除待发消息：' + (item.content || '图片消息')" @click="emit('remove',item)">移除待发</button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.conversation-queue-panel{min-width:0;padding:10px;border-radius:16px;background:var(--surface-subtle,#f5f7fb);color:var(--text-secondary,#65758b);font-size:12px}
.conversation-queue-panel header,.conversation-queue-panel li{display:flex;align-items:center;justify-content:space-between;gap:12px}
.conversation-queue-panel header strong{color:var(--text-primary,#26364b);font-weight:600}
.conversation-queue-panel p{margin:6px 0;line-height:1.6}
.conversation-queue-panel ul{display:grid;gap:6px;max-height:160px;overflow:auto;padding:0;margin:10px 0 0;list-style:none}
.conversation-queue-panel li{min-width:0;padding:8px;border-radius:6px;background:var(--surface,#fff)}
.conversation-queue-panel li>div{min-width:0;flex:1}
.conversation-queue-preview{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow-wrap:anywhere}
.conversation-queue-panel small{display:block;margin-top:4px;color:var(--text-muted,#7c8798)}
.conversation-queue-panel button{flex-shrink:0;border:0;border-radius:5px;padding:5px 7px;background:transparent;color:var(--text-primary,#344966);font:inherit;cursor:pointer}
.conversation-queue-panel button:hover{background:var(--surface-hover,#e9eef7)}
.conversation-queue-panel button:focus-visible{outline:2px solid var(--focus-color,#407cdd);outline-offset:2px}
.conversation-queue-panel button:disabled{opacity:.5;cursor:default}
.conversation-queue-error{color:var(--danger-text,#a14747)}
@media(max-width:640px){.conversation-queue-panel{padding:10px}.conversation-queue-panel li{align-items:flex-start}}
</style>
