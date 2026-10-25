<script setup>
import {ref,watch,onBeforeUnmount} from 'vue';
import {sealBrowserAnswer} from '../bot-interaction.js';
const props=defineProps({workspace:{type:String,required:true},employeeId:{type:String,required:true},actionId:String});
const requests=ref([]),busy=ref(false),error=ref(''),values=ref({});let timer,disposed=false,generation=0;
const label={vault_unlock:'解锁已连接的密码管理器',vault_save_login:'为当前网站保存登录',vault_code:'输入本次验证码',approval:'需要你确认',question:'员工需要补充信息'};
const base=()=>`/api/workspaces/${encodeURIComponent(props.workspace)}/bots/${encodeURIComponent(props.employeeId)}/interactions`;
async function api(url,options={}){const response=await fetch(url,{credentials:'same-origin',...options,headers:{'content-type':'application/json',...(options.headers||{})}});if(!response.ok)throw Error('本次交互未能保存，请刷新后核对状态。');return response.json();}
async function poll(){const version=generation;if(disposed)return;try{const data=await api(base());if(version!==generation)return;requests.value=(data.requests||[]).filter(r=>!props.actionId||r.actionId===props.actionId);const ids=new Set(requests.value.filter(r=>r.state==='waiting').map(r=>r.requestId));for(const id of Object.keys(values.value))if(!ids.has(id))delete values.value[id];}catch{/* Existing chat stays usable while an older backend lacks this endpoint. */}finally{if(!disposed&&version===generation){clearTimeout(timer);timer=setTimeout(poll,2000);}}}
function fields(r){return values.value[r.requestId]||(values.value[r.requestId]=r.options?.multiSelect?{answer:[]}:Object.fromEntries((r.display.questions||[]).filter(q=>q.multi_select).map(q=>[q.qid,[]])));}
async function submit(r,answer){busy.value=true;error.value='';const version=generation;let input;
 try{if(r.kind==='vault_save_login')input={identifier:fields(r).identifier||'',password:fields(r).password||''};else if(r.kind==='vault_unlock')input={password:fields(r).password||''};else if(r.kind==='vault_code')input={code:fields(r).code||''};else if(r.display.questions?.length)input={answer:{answers:Object.fromEntries(r.display.questions.map(q=>[q.qid,fields(r)[q.qid]||'']))}};else input={answer:answer??fields(r).answer??''};const envelope=await sealBrowserAnswer(r.devicePublicKey,r.binding,input);if(version!==generation)return;await api(`${base()}/${encodeURIComponent(r.requestId)}`,{method:'POST',body:JSON.stringify({envelope})});if(version!==generation)return;delete values.value[r.requestId];await refresh();}catch(e){if(version===generation)error.value=e.message;}finally{if(input)for(const key of Object.keys(input))input[key]='';if(version===generation){if(r.secure)delete values.value[r.requestId];busy.value=false;}} }
async function cancel(r){busy.value=true;error.value='';const version=generation;const url=`${base()}/${encodeURIComponent(r.requestId)}`;try{await api(url,{method:'DELETE'});if(version!==generation)return;delete values.value[r.requestId];await refresh();}catch(e){if(version===generation)error.value=e.message;}finally{if(version===generation){delete values.value[r.requestId];busy.value=false;}}}
async function refresh(){clearTimeout(timer);await poll();}
watch(()=>[props.workspace,props.employeeId,props.actionId],()=>{generation++;requests.value=[];values.value={};busy.value=false;error.value='';clearTimeout(timer);void poll();},{immediate:true});
onBeforeUnmount(()=>{disposed=true;generation++;clearTimeout(timer);values.value={};});
</script>
<template>
 <section v-for="r in requests" :key="r.requestId" class="bot-interaction-card" :aria-label="label[r.kind]" :data-state="r.state">
  <strong>{{label[r.kind]}}</strong><p v-if="r.display.site||r.display.origin">{{r.display.origin||r.display.site}}</p><p v-if="r.display.label">{{r.display.label}}</p>
  <template v-if="r.state==='waiting'">
   <p v-if="r.display.question">{{r.display.question}}</p><pre v-if="r.kind==='approval'">{{r.display.description}}<br/>{{r.display.command}}</pre>
   <p v-if="r.secure">内容只交给这台电脑上的当前员工处理，不会作为聊天消息发送。</p><p v-else>请勿在此填写密码、密钥或验证码。</p>
   <label v-if="r.kind==='vault_save_login'">账号<input v-model="fields(r).identifier" autocomplete="off" :disabled="busy"/></label>
   <label v-if="r.kind==='vault_save_login'||r.kind==='vault_unlock'">{{r.kind==='vault_unlock'?'解锁密码':'密码'}}<input v-model="fields(r).password" type="password" autocomplete="new-password" :disabled="busy"/></label>
   <label v-if="r.kind==='vault_code'">验证码<input v-model="fields(r).code" type="password" inputmode="numeric" autocomplete="off" :disabled="busy"/></label>
   <template v-if="r.display.questions?.length"><label v-for="q in r.display.questions" :key="q.qid">{{q.question}}<select v-if="q.choices?.length" v-model="fields(r)[q.qid]" :multiple="q.multi_select" :disabled="busy"><option v-for="choice in q.choices" :key="choice" :value="choice">{{choice}}</option></select><textarea v-else v-model="fields(r)[q.qid]" :disabled="busy" maxlength="4000"/></label></template>
   <label v-else-if="r.kind==='question'&&!r.choices?.length">答复<textarea v-model="fields(r).answer" :disabled="busy" maxlength="4000"/></label>
   <label v-if="r.choices?.length&&r.options?.multiSelect">选择答复<select v-model="fields(r).answer" multiple :disabled="busy"><option v-for="choice in r.choices" :key="choice" :value="choice">{{choice}}</option></select></label>
   <div v-else-if="r.choices?.length" class="interaction-actions"><button v-for="choice in r.choices" :key="choice" :disabled="busy" @click="submit(r,choice)">{{({once:'仅本次允许',session:'本次会话允许',always:'记住此范围',deny:'拒绝'})[choice]||choice}}</button></div>
   <button v-if="!r.choices?.length||r.options?.multiSelect" :disabled="busy" @click="submit(r)">{{busy?'提交中…':'提交并继续'}}</button><button :disabled="busy" @click="cancel(r)">取消</button><small>等待答复至 {{new Date(r.expiresAt).toLocaleTimeString()}}，当前任务尚未完成。</small>
  </template>
  <p v-else>{{({answered:'已提交，等待员工接收',delivered:'员工已接收',expired:'本次请求已到期',cancelled:'本次请求已取消'})[r.state]||r.state}}</p>
 </section><p v-if="error" role="alert">{{error}}</p>
</template>
<style scoped>
.bot-interaction-card{background:#f7f9ff;border:1px solid #dbe3f5;border-radius:14px;padding:16px;margin:12px 0;color:#273754}.bot-interaction-card strong{font-size:15px}.bot-interaction-card p,.bot-interaction-card small{font-size:13px;line-height:1.6}.bot-interaction-card small{display:block;color:#64748b;margin-top:10px}.bot-interaction-card label{display:grid;gap:6px;font-size:13px;margin:10px 0}.bot-interaction-card input,.bot-interaction-card textarea{background:white;border:1px solid #cbd5e1;border-radius:8px;padding:9px}.bot-interaction-card button{margin:6px 8px 0 0}.bot-interaction-card pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:180px;overflow:auto}.interaction-actions{display:flex;flex-wrap:wrap}
</style>
