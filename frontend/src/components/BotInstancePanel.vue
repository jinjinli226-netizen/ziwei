<script setup>
import {computed} from 'vue';
import {botInstanceStatus} from '../bot-owned-profile.js';
const props=defineProps({bot:{type:Object,required:true},discovery:Object,busy:Boolean,dirty:Boolean});
const emit=defineEmits(['refresh','recover','prepare']);
const instance=computed(()=>botInstanceStatus(props.bot,props.discovery));
const needsProgress=computed(()=>['provisioning','discovery_pending','uncertain','failed','waiting_client'].includes(instance.value.stage));
const environmentState=computed(()=>{
  const value=instance.value;
  if(value.mode==='legacy_private_home')return {label:'已配置',tone:'muted'};
  if(value.stage==='failed')return {label:'创建失败',tone:'error'};
  if(value.stage==='uncertain')return {label:'待确认',tone:'warning'};
  if(value.stage==='waiting_client')return {label:'等待客户端',tone:'warning'};
  if(value.stage==='discovery_pending')return {label:'连接待检查',tone:'warning'};
  if(value.authentication==='required'&&!value.modelReady)return {label:'需要授权',tone:'warning'};
  return {label:props.bot.control_state==='active'&&value.modelReady?'已就绪':value.provisioned?'已创建':'创建中',tone:value.provisioned?'success':'warning'};
});
</script>

<template>
  <section class="bot-instance bot-surface" aria-label="Bot Profile 与 HOME">
    <div class="bot-instance-heading"><h3>运行环境</h3><span class="bot-status" :data-tone="environmentState.tone">{{environmentState.label}}</span></div>
    <template v-if="instance.mode==='owned_profile'">
      <p v-if="instance.authentication==='required'&&!instance.modelReady">模型凭证尚未配置，请在运行电脑完成授权后检查配置。</p>
      <p v-if="instance.stage==='discovery_pending'">{{instance.issues?.join('；')}}</p>
      <p v-if="instance.stage==='uncertain'">创建结果待确认，请查询创建进度。</p>
      <p v-if="instance.stage==='waiting_client'">请更新并连接运行电脑上的客户端。</p>
      <p v-if="instance.error" class="bot-error-text" role="alert">{{typeof instance.error==='string'?instance.error:instance.error.message||instance.error.code}}</p>
      <div v-if="needsProgress||bot.control_state!=='active'&&!bot.capabilityGate" class="bot-actions"><button v-if="needsProgress" type="button" class="bot-button" :disabled="busy" @click="emit('refresh')">查询创建进度</button><button v-if="instance.canRecover" type="button" class="bot-button" :disabled="busy" @click="emit('recover')">重试创建</button><button v-if="bot.control_state!=='active'&&instance.provisioned&&!bot.capabilityGate" type="button" class="bot-button primary" :disabled="busy||dirty||!instance.canValidate" @click="emit('prepare')">检查并启用 Bot</button></div>
      <p v-if="dirty">有未保存配置，请先保存再检查。</p>
      <p v-if="bot.validation?.status==='failed'" class="bot-error-text">配置检查失败：{{bot.validation.error||'请在运行记录查看详情'}}</p>
    </template>
    <details><summary>高级信息</summary><dl><div><dt>{{instance.mode==='owned_profile'?'专属 Profile':'来源 Profile'}}</dt><dd><code>{{instance.profile||'尚未报告'}}</code></dd></div><div><dt>工作目录 HOME</dt><dd><code v-if="instance.home" data-bot-home>{{instance.home}}</code><span v-else>尚未报告</span></dd></div><div v-if="instance.mode==='owned_profile'"><dt>初始化来源</dt><dd>{{instance.templateProfile||'尚未报告'}}</dd></div></dl><p v-if="bot.instance?.authMode==='source-native-store'||instance.authentication==='source_reference'">模型认证引用初始化来源。OAuth 到期后，请在来源 Profile 重新授权。</p><p v-if="instance.mode==='legacy_private_home'">沿用来源 Profile，使用独立工作目录。</p><p>配置版本：{{bot.revision}}</p><p v-if="instance.actionId">创建请求：<code>{{instance.actionId}}</code></p><button type="button" class="bot-button" :disabled="busy" @click="emit('refresh')">刷新运行环境</button></details>
  </section>
</template>

<style scoped>
.bot-instance{margin:16px 0}.bot-instance-heading{display:flex;gap:12px;align-items:baseline;justify-content:space-between;flex-wrap:wrap}.bot-instance h3{font-size:14px;font-weight:600;margin:0 0 12px}.bot-instance p{color:var(--bot-muted);font-size:12px;line-height:1.9;margin:9px 0}.bot-instance dl{margin:0 0 10px;font-size:12px}.bot-instance dl>div{display:grid;grid-template-columns:90px minmax(0,1fr);gap:10px;margin:8px 0}.bot-instance dt{color:#92869d}.bot-instance dd{margin:0;min-width:0;overflow-wrap:anywhere}.bot-instance code{font-size:11px;overflow-wrap:anywhere;white-space:pre-wrap}.bot-instance details{font-size:11px;margin:12px 0;color:#8f7c9d}.bot-instance summary{cursor:pointer;margin-bottom:6px}.bot-instance .bot-actions{display:flex;gap:9px;margin-top:14px;flex-wrap:wrap}.bot-instance .bot-button{font:inherit;font-size:12px;line-height:1.4;padding:9px 13px;border:1px solid #e3ddec;border-radius:9px;background:white;color:#61576e;cursor:pointer}.bot-instance .bot-button.primary{background:var(--bot-accent);border-color:var(--bot-accent);color:white}.bot-instance .bot-button:disabled{opacity:.48;cursor:not-allowed}.bot-instance .bot-button:focus-visible{outline:2px solid #9379dc;outline-offset:3px}.bot-instance .bot-status{font-size:10px;padding:3px 7px;border-radius:5px;background:#f2eef7;color:#8b7c9b}.bot-instance .bot-status[data-tone=success]{color:#4b8774;background:#edf7f2}.bot-instance .bot-status[data-tone=error]{color:#b76371;background:#fbebef}.bot-instance .bot-status[data-tone=warning]{color:#a8823e;background:#fbf4e5}.bot-instance .bot-error-text{color:#ae4e63}@media(max-width:760px){.bot-instance dl>div{grid-template-columns:72px minmax(0,1fr)}}
</style>
