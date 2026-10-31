<script setup>
import {computed,onBeforeUnmount,onMounted,ref,watch} from 'vue';
import {api} from '../api.js';
import {dshPluginUiBotName,dshPluginUiMessage,dshPluginUiRelayUrl} from '../dsh-plugin-ui.js';

const props=defineProps({controller:{type:Object,required:true},workspace:{type:String,required:true},employee:{type:Object,required:true},actorId:{type:String,required:true},active:{type:Boolean,default:true}});
const c=computed(()=>props.controller),s=computed(()=>c.value.state),frame=ref(null),relay=ref(null),ready=ref(false),opening=ref(false),error=ref(''),notice=ref(''),catalog=ref(null),status=ref('idle');
let waitTimer=null, reconnectTimer=null,statusTimer=null,visit=0;
const botName=computed(()=>dshPluginUiBotName(props.employee));
const canPrepare=computed(()=>props.active&&c.value.supported('plugins','prepareUiHost')&&s.value.capabilities?.pluginUiRelayReported===true);
const prepareAction=computed(()=>{const action=s.value.action,op=action?.payload?.dshOperation,receipt=action?.result?.dshNative;return op?.resource==='plugins'&&op.operation==='prepareUiHost'&&action.status==='succeeded'&&receipt?.status==='applied'?action:null;});
const frameUrl=computed(()=>relay.value?dshPluginUiRelayUrl({...relay.value,botName:botName.value}):'');
const targetOrigin=()=>typeof window==='undefined'?'':window.location.origin;
function clearTimers(){if(waitTimer)clearTimeout(waitTimer);if(reconnectTimer)clearTimeout(reconnectTimer);if(statusTimer)clearInterval(statusTimer);waitTimer=reconnectTimer=statusTimer=null;}
function isCurrent(n){return n===visit;}
async function waitForPrepare(n){
  if(prepareAction.value)return prepareAction.value;
  return new Promise((resolve,reject)=>{const end=Date.now()+20000;const tick=()=>{if(!isCurrent(n))return reject(new Error('员工已切换'));if(prepareAction.value)return resolve(prepareAction.value);if(Date.now()>end)return reject(new Error('等待 DSH 插件工作区就绪超时'));waitTimer=setTimeout(tick,250);};tick();});
}
async function open(){
  if(opening.value||!canPrepare.value)return;
  const n=++visit;opening.value=true;error.value='';notice.value='';status.value='opening';ready.value=false;
  try{
    let action=prepareAction.value;
    if(!action){await c.value.submit('plugins','prepareUiHost',{});action=await waitForPrepare(n);}
    const value=await api.dshPluginUiRelayOpen(props.employee.id,{prepareActionId:action.id,viewKey:crypto.randomUUID(),idempotencyKey:crypto.randomUUID()},props.workspace);
    if(!isCurrent(n))return;
    relay.value=value;status.value='connecting';notice.value='正在连接 DSH 插件工作区…';
    statusTimer=setInterval(async()=>{if(!relay.value||!isCurrent(n))return;try{const live=await api.dshPluginUiRelayStatus(props.employee.id,relay.value.relayId,props.workspace);if(live.status!=='open'){ready.value=false;status.value='disconnected';error.value='插件工作区已失效，请重新打开。';clearTimers();}}catch(e){if(e?.status===404||e?.status===410){ready.value=false;status.value='disconnected';error.value='插件工作区已过期，请重新打开。';clearTimers();}}},10000);
  }catch(e){if(isCurrent(n)){status.value='error';error.value=e?.message||'插件工作区连接失败';}}finally{if(isCurrent(n))opening.value=false;}
}
async function close(){
  const current=relay.value;if(!current)return;
  ++visit;clearTimers();relay.value=null;ready.value=false;status.value='idle';catalog.value=null;
  try{await api.dshPluginUiRelayClose(props.employee.id,current.relayId,props.workspace);}catch{}
}
function post(type,payload={}){const target=frame.value?.contentWindow,origin=targetOrigin();if(!target||!ready.value||!origin)return;target.postMessage({channel:'dshbot-plugin-ui',version:1,botName:botName.value,viewKey:relay.value.viewKey,type,...payload},origin);}
function onMessage(event){
  if(!relay.value||!frame.value||!dshPluginUiMessage(event.data,{botName:botName.value,viewKey:relay.value.viewKey,source:event.source,expectedSource:frame.value.contentWindow,origin:event.origin,expectedOrigin:targetOrigin()}))return;
  if(event.data.type==='ready'){ready.value=true;status.value='ready';notice.value='';post('context',{workspace:props.workspace,employeeId:props.employee.id,profile:props.employee.runtime_profile||''});return;}
  if(event.data.type==='catalog'){catalog.value=event.data.catalog||event.data.payload||null;return;}
  if(event.data.type==='status'){
    const next=event.data.status||event.data.payload?.status;
    if(next==='unmounted'){ready.value=false;status.value='reconnecting';notice.value='DSH 插件正在热更新，等待重新挂载…';scheduleReconnect();}
    else if(next)status.value=next;
  }
}
function scheduleReconnect(){if(reconnectTimer||!relay.value)return;reconnectTimer=setTimeout(()=>{reconnectTimer=null;if(relay.value&&!ready.value){status.value='disconnected';notice.value='插件工作区暂时未就绪，可重试。';}},5000);}
function onLoad(){if(!ready.value&&status.value==='connecting')notice.value='已加载插件页面，等待 DSH 握手…';}
watch(()=>[props.employee.id,props.employee.target_device_id,props.employee.runtime_profile,props.active],()=>{if(!props.active)void close();else{clearTimers();error.value='';}}, {deep:true});
onMounted(()=>{if(typeof window!=='undefined')window.addEventListener('message',onMessage);});
onBeforeUnmount(()=>{if(typeof window!=='undefined')window.removeEventListener('message',onMessage);void close();clearTimers();});
</script>
<template>
  <section class="dsh-plugin-ui-host" aria-label="DSH 插件工作区">
    <header class="dsh-plugin-ui-heading"><div><p class="dsh-plugin-ui-eyebrow">DSH 插件工作区</p><h3>原生插件界面</h3><p>通过当前员工绑定的 DSH Bot 加载插件页面，插件热更新时会自动重新握手。</p></div><div class="dsh-plugin-ui-actions"><button v-if="!relay" type="button" class="dsh-plugin-ui-button primary" :disabled="opening||!canPrepare" @click="open">{{opening?'正在准备…':'打开插件工作区'}}</button><button v-else type="button" class="dsh-plugin-ui-button" :disabled="opening" @click="close">关闭工作区</button></div></header>
    <p v-if="!canPrepare" class="dsh-plugin-ui-notice">当前设备尚未报告 DSH 插件界面中继能力；完成客户端升级后再打开。</p>
    <p v-if="notice" class="dsh-plugin-ui-notice" role="status">{{notice}}</p><p v-if="error" class="dsh-plugin-ui-error" role="alert">{{error}}</p>
    <div v-if="relay" class="dsh-plugin-ui-frame-wrap" :class="{ready}"><iframe ref="frame" class="dsh-plugin-ui-frame" :src="frameUrl" :title="`${botName} DSH 插件工作区`" @load="onLoad"/></div>
    <p v-if="relay&&!ready" class="dsh-plugin-ui-empty">插件界面完成安全握手后显示。当前状态：{{status}}</p>
    <details v-if="catalog" class="dsh-plugin-ui-catalog"><summary>插件视图目录</summary><pre>{{JSON.stringify(catalog,null,2)}}</pre></details>
  </section>
</template>
<style scoped>
.dsh-plugin-ui-host{min-width:0;color:var(--bot-ink,#403747);font-size:12px}.dsh-plugin-ui-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.dsh-plugin-ui-eyebrow{margin:0;color:#7655c7;font-size:11px}.dsh-plugin-ui-heading h3{margin:6px 0;font-size:18px}.dsh-plugin-ui-heading p{margin:0;color:#81738c;line-height:1.7}.dsh-plugin-ui-actions{display:flex;gap:8px;flex-shrink:0}.dsh-plugin-ui-button{border:0;border-radius:7px;background:#f2eff7;color:#665879;min-height:34px;padding:7px 12px;font:inherit;cursor:pointer}.dsh-plugin-ui-button:hover:not(:disabled){background:#eae4f3}.dsh-plugin-ui-button.primary{background:#7655c7;color:#fff}.dsh-plugin-ui-button:disabled{opacity:.48;cursor:default}.dsh-plugin-ui-notice,.dsh-plugin-ui-error{margin:14px 0;padding:10px 12px;border-radius:7px;background:#f5f2fa;color:#79658c;line-height:1.8}.dsh-plugin-ui-error{background:#fff3f3;color:#9a5866}.dsh-plugin-ui-frame-wrap{position:relative;min-height:520px;margin-top:18px;border-radius:9px;background:#faf9fc;box-shadow:inset 0 0 0 .5px #e6dfed;overflow:hidden}.dsh-plugin-ui-frame-wrap:not(.ready) .dsh-plugin-ui-frame{visibility:hidden}.dsh-plugin-ui-frame{display:block;width:100%;height:520px;border:0;background:#fff}.dsh-plugin-ui-empty{color:#91849d}.dsh-plugin-ui-catalog{margin-top:14px}.dsh-plugin-ui-catalog pre{max-height:180px;overflow:auto;white-space:pre-wrap}@media(max-width:760px){.dsh-plugin-ui-heading{display:block}.dsh-plugin-ui-actions{margin-top:12px}.dsh-plugin-ui-frame-wrap,.dsh-plugin-ui-frame{min-height:420px;height:420px}}
</style>
