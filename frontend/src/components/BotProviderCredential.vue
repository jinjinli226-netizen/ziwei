<script setup>
import {computed,ref,watch,onBeforeUnmount} from 'vue';
import {api} from '../api.js';
import {credentialStateLabel,sealBotProviderKey} from '../bot-provider-settings.js';
const props=defineProps({workspace:String,bot:Object,dirty:Boolean});
const emit=defineEmits(['saved']);
const metadata=ref(null),keyInput=ref(''),busy=ref(false),error=ref(''),notice=ref('');
const supportsKey=computed(()=>/^(deepseek|openai|anthropic|openrouter|custom(?::.+)?)$/.test(metadata.value?.binding?.provider||''));
let generation=0;
async function refresh(){
  const visit=++generation;keyInput.value='';error.value='';metadata.value=null;
  if(!props.bot?.id)return;
  try{const value=await api.botProviderCredential(props.bot.id,props.workspace);if(visit===generation)metadata.value=value;}
  catch{if(visit===generation)error.value='密钥状态暂不可用，请更新服务端并重试。';}
}
async function save(operation='replace'){
  if(busy.value||props.dirty||!metadata.value)return;
  if(operation==='replace'&&!keyInput.value.trim()){notice.value='未输入新密钥，保留现有凭据。';keyInput.value='';return;}
  const visit=generation,id=props.bot.id,workspace=props.workspace,meta=metadata.value;
  busy.value=true;error.value='';notice.value='';
  try{
    const envelope=operation==='replace'?await sealBotProviderKey(keyInput.value.trim(),meta):undefined;
    if(visit!==generation)return;
    keyInput.value='';
    const result=await api.setBotProviderCredential(id,{expectedVersion:meta.currentVersion,provider:meta.binding.provider,operation,...(envelope?{envelope}:{})},workspace);
    if(visit!==generation)return;
    metadata.value=result;notice.value='设置已保存，设备同步与实际调用状态请分别核对。';
    emit('saved');
    await refresh();
  }catch{if(visit===generation)error.value='密钥设置未确认，请刷新状态后重试；不要在聊天中发送密钥。';}
  finally{if(visit===generation){keyInput.value='';busy.value=false;}}
}
watch(()=>[props.workspace,props.bot?.id,props.bot?.revision],()=>{busy.value=false;notice.value='';void refresh();},{immediate:true});
onBeforeUnmount(()=>{generation++;keyInput.value='';});
</script>
<template>
  <section class="bot-provider-credential" aria-label="此 Bot 的模型 API Key">
    <h4>模型 API Key</h4>
    <p>{{credentialStateLabel(metadata?.state)}}</p>
    <p v-if="metadata?.state==='legacy'">尚未设置独立密钥，保留当前来源 Profile 的授权。需要独立服务商时，在这里填写。</p>
    <label v-if="supportsKey">替换密钥<input v-model="keyInput" type="password" autocomplete="new-password" spellcheck="false" maxlength="256" :disabled="busy||dirty||!metadata?.devicePublicKey" placeholder="留空保留现有凭据" aria-label="此 Bot 的模型 API Key"/></label>
    <p v-else>当前服务商沿用原生登录授权；需要 API Key 时先选择受支持的服务商。</p>
    <p v-if="!metadata?.devicePublicKey">运行电脑尚未准备安全输入，请连接并更新电脑客户端后刷新。</p>
    <p v-if="dirty">先保存服务商和模型，再设置对应密钥。</p>
    <div class="bot-actions"><button v-if="supportsKey" type="button" :disabled="busy||dirty||!metadata?.devicePublicKey" @click="save()">保存密钥</button><button type="button" :disabled="busy||dirty||!metadata||metadata.state==='legacy'" @click="save('clear')">清除此 Bot 的密钥</button><button type="button" :disabled="busy" @click="refresh">刷新状态</button></div>
    <p v-if="notice" role="status">{{notice}}</p><p v-if="error" role="alert">{{error}}</p>
    <dl><div><dt>页面配置</dt><dd>{{dirty?'有未保存修改':'已保存'}}</dd></div><div><dt>电脑安全保存</dt><dd>{{credentialStateLabel(metadata?.state)}}</dd></div><div><dt>配置检查</dt><dd>{{bot?.validation?.status==='succeeded'&&bot.validation.revision===bot.revision?'当前版本已通过':'待检查'}}</dd></div><div><dt>真实模型调用</dt><dd>未验收（安全保存不代表调用成功）</dd></div></dl>
  </section>
</template>
<style scoped>
.bot-provider-credential{margin:16px 0;padding:16px;border:1px solid #e5deed;border-radius:12px;background:#fcfbfe;color:#62576f;font-size:12px}.bot-provider-credential h4{margin:0 0 10px}.bot-provider-credential label{display:grid;gap:6px}.bot-provider-credential input{padding:10px;border:1px solid #dcd4e7;border-radius:8px;background:white}.bot-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.bot-actions button{padding:8px 12px;border:1px solid #ddd3e8;border-radius:8px;background:white;color:inherit;cursor:pointer}.bot-actions button:disabled{opacity:.5;cursor:default}dl>div{display:flex;justify-content:space-between;gap:14px;margin-top:7px}dd{margin:0}
</style>
