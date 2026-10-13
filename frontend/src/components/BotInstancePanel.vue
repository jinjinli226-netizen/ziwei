<script setup>
import {computed} from 'vue';
import {botInstanceStatus} from '../bot-owned-profile.js';
const props=defineProps({bot:{type:Object,required:true},discovery:Object,busy:Boolean,dirty:Boolean});
const emit=defineEmits(['refresh','recover','prepare']);
const instance=computed(()=>botInstanceStatus(props.bot,props.discovery));
</script>

<template>
  <section class="bot-instance bot-surface" aria-label="Bot Profile 与 HOME">
    <div class="bot-instance-heading"><h3>{{instance.label}}</h3><span v-if="instance.mode==='owned_profile'" class="bot-status" :data-tone="instance.stage==='failed'?'error':instance.provisioned?'success':'warning'">{{bot.control_state==='active'?'已启用':instance.provisioned?'已创建 · 待检查':'设备创建回执'}}</span></div>
    <dl><div><dt>{{instance.mode==='owned_profile'?'专属 Profile':'来源 Profile'}}</dt><dd><code>{{instance.profile||'尚未报告'}}</code></dd></div><div><dt>{{instance.mode==='owned_profile'?'实际 HOME':'原实例 HOME'}}</dt><dd><code v-if="instance.home" data-bot-home>{{instance.home}}</code><span v-else>{{instance.mode==='owned_profile'?'等待设备回执确认':'原实例 HOME 未上报'}}</span></dd></div><div v-if="instance.mode==='owned_profile'"><dt>初始化来源</dt><dd>{{instance.templateProfile||'尚未报告'}}</dd></div></dl>
    <p v-if="instance.mode==='legacy_private_home'">此员工沿用原来源 Profile 和独立实例，保留原记忆与主聊天。</p>
    <template v-else>
      <p v-if="bot.instance.authMode==='source-native-store'||instance.authentication==='source_reference'">模型认证引用初始化来源；OAuth 原存储只读，到期后需在来源 Profile 重新授权。能否运行以当前配置检查和实际回执为准。</p>
      <p v-if="instance.authentication==='required'">开通时模型认证未就绪。请在目标电脑核对此 Profile 的 provider 或初始化来源认证，再检查当前配置；开通快照不代替最新检查。</p>
      <p v-else-if="instance.authentication==='configured'">设备已报告模型认证配置；检查通过并启用后可在同一主聊天交任务。</p>
      <p v-if="instance.stage==='discovery_pending'">目录创建已确认，等待所选电脑重新报告此 Profile。{{instance.issues?.join('；')}}</p>
      <p v-if="instance.stage==='uncertain'">原创建结果待核实，继续查询同一动作；不会重新分配 Profile 或 HOME。</p>
      <p v-if="instance.error" class="bot-error-text" role="alert">{{typeof instance.error==='string'?instance.error:instance.error.message||instance.error.code}}</p>
      <details v-if="instance.actionId"><summary>设备创建请求</summary><code>{{instance.actionId}}</code></details>
      <div class="bot-actions"><button type="button" class="bot-button" :disabled="busy" @click="emit('refresh')">查询原创建回执</button><button v-if="instance.canRecover" type="button" class="bot-button" :disabled="busy" @click="emit('recover')">恢复同一 Profile 创建</button><button v-if="bot.control_state!=='active'&&instance.provisioned" type="button" class="bot-button primary" :disabled="busy||dirty||!instance.canValidate" @click="emit('prepare')">检查并启用 Bot</button></div>
      <p v-if="dirty">有未保存配置，请先保存再检查。</p>
      <p v-if="bot.validation?.status==='failed'" class="bot-error-text">配置检查失败：{{bot.validation.error||'请在运行记录查看原回执'}}</p>
    </template>
  </section>
</template>

<style scoped>
.bot-instance{margin:16px 0}.bot-instance-heading{display:flex;gap:12px;align-items:baseline;justify-content:space-between;flex-wrap:wrap}.bot-instance h3{font-size:14px;font-weight:600;margin:0 0 12px}.bot-instance p{color:var(--bot-muted);font-size:12px;line-height:1.9;margin:9px 0}.bot-instance dl{margin:0 0 10px;font-size:12px}.bot-instance dl>div{display:grid;grid-template-columns:90px minmax(0,1fr);gap:10px;margin:8px 0}.bot-instance dt{color:#92869d}.bot-instance dd{margin:0;min-width:0;overflow-wrap:anywhere}.bot-instance code{font-size:11px;overflow-wrap:anywhere;white-space:pre-wrap}.bot-instance details{font-size:11px;margin:12px 0;color:#8f7c9d}.bot-instance summary{cursor:pointer;margin-bottom:6px}.bot-instance .bot-actions{display:flex;gap:9px;margin-top:14px;flex-wrap:wrap}.bot-instance .bot-button{font:inherit;font-size:12px;line-height:1.4;padding:9px 13px;border:1px solid #e3ddec;border-radius:9px;background:white;color:#61576e;cursor:pointer}.bot-instance .bot-button.primary{background:var(--bot-accent);border-color:var(--bot-accent);color:white}.bot-instance .bot-button:disabled{opacity:.48;cursor:not-allowed}.bot-instance .bot-button:focus-visible{outline:2px solid #9379dc;outline-offset:3px}.bot-instance .bot-status{font-size:10px;padding:3px 7px;border-radius:5px;background:#f2eef7;color:#8b7c9b}.bot-instance .bot-status[data-tone=success]{color:#4b8774;background:#edf7f2}.bot-instance .bot-status[data-tone=error]{color:#b76371;background:#fbebef}.bot-instance .bot-status[data-tone=warning]{color:#a8823e;background:#fbf4e5}.bot-instance .bot-error-text{color:#ae4e63}@media(max-width:760px){.bot-instance dl>div{grid-template-columns:72px minmax(0,1fr)}}
</style>
