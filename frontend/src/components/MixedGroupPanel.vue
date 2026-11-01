<script setup>
import {computed,nextTick,onBeforeUnmount,reactive,ref,watch} from 'vue';
import {api} from '../api.js';
import {MIXED_GROUP_RUNTIMES,mixedGroupMemberDescriptor,mixedGroupStatus} from '../mixed-group.js';
import {createBotRequestScope} from '../bot-state.js';
import {createConversationEnterGuard} from '../conversation-compose.js';
import {createConversationScrollTracker} from '../conversation-history.mjs';

const props=defineProps({workspace:{type:String,required:true},groupId:{type:String,default:undefined},employee:{type:Object,default:null},employees:{type:Array,default:()=>[]},embedded:Boolean});
const emit=defineEmits(['select','changed']);
const groups=ref([]),selectedId=ref(''),selected=ref(null),title=ref(''),memberIds=ref([]),draft=ref(''),showCreate=ref(false);
const reading=ref(false),listReading=ref(false),busy=ref(false),error=ref(''),listError=ref(''),notice=ref('');
const scope=createBotRequestScope(),enterGuard=createConversationEnterGuard();
const timeline=ref(null),historyScroll=createConversationScrollTracker({wrap:reactive});
let pollTimer=null,disposed=false;
const candidates=computed(()=>props.employees.filter(employee=>MIXED_GROUP_RUNTIMES.includes(employee.runtime)&&employee.status!=='deleted'));
const activeRuns=computed(()=>selected.value?.runs?.some(run=>['pending','acked','running'].includes(run.status))||false);
const currentStatus=computed(()=>statusLabel(mixedGroupStatus(selected.value)));

async function refresh(){
 clearTimeout(pollTimer);
 await Promise.all([props.embedded?Promise.resolve():readList(),selectedId.value?readDetail():Promise.resolve()]);
}
async function readList(){
 const request=scope.begin('list'),workspace=props.workspace;listReading.value=true;listError.value='';
 try{const value=await api.mixedGroups(workspace);if(scope.current(request))groups.value=value.groups||[];}
 catch(reason){if(scope.current(request))listError.value=reason.message||'群聊列表读取失败';}
 finally{if(scope.current(request))listReading.value=false;}
}
async function readDetail(){
 const request=scope.begin('detail'),workspace=props.workspace,id=selectedId.value;reading.value=true;error.value='';
 try{
  const value=await api.mixedGroup(id,workspace);
  if(!scope.current(request))return;
  if(value.id!==id||value.workspace!==workspace)throw new Error('群聊返回内容与当前工作区或群选择不一致');
  selected.value=value;
 }catch(reason){if(scope.current(request))error.value=reason.message||'群聊读取失败';}
 finally{if(scope.current(request)){reading.value=false;schedulePoll();}}
}
function select(id){
 emit('select',id);
 if(props.groupId===undefined){selectedId.value=id;resetSelection();}
}
function resetSelection(){
 clearTimeout(pollTimer);scope.select(props.workspace,selectedId.value);historyScroll.reset();
 selected.value=null;draft.value='';title.value='';memberIds.value=props.employee?[props.employee.id]:[];
 showCreate.value=false;reading.value=false;listReading.value=false;busy.value=false;error.value='';listError.value='';notice.value='';
 void refresh();
}
function toggle(id){memberIds.value=memberIds.value.includes(id)?memberIds.value.filter(value=>value!==id):[...memberIds.value,id];}
async function create(){
 if(busy.value||memberIds.value.length<2||memberIds.value.length>6)return;
 let members;
 try{members=memberIds.value.map(id=>mixedGroupMemberDescriptor(candidates.value.find(employee=>employee.id===id)));}
 catch(reason){error.value=reason.message;return;}
 const request=scope.begin('write'),workspace=props.workspace;busy.value=true;error.value='';clearTimeout(pollTimer);
 try{
  const value=await api.createMixedGroup({id:`mix_${crypto.randomUUID().replaceAll('-','').slice(0,20)}`,title:title.value.trim()||'新群聊',members},workspace);
  if(!scope.current(request))return;
  title.value='';showCreate.value=false;emit('changed',{workspace,groupId:value.id});select(value.id);
 }catch(reason){if(scope.current(request))error.value=mutationError(reason,'创建');}
 finally{if(scope.current(request)){busy.value=false;schedulePoll();}}
}
async function send(){
 if(busy.value||!selected.value||!draft.value.trim())return;
 const request=scope.begin('write'),workspace=props.workspace,id=selectedId.value,content=draft.value;
 busy.value=true;error.value='';notice.value='';clearTimeout(pollTimer);
 try{
  await api.sendMixedGroupMessage(id,{content},workspace);
  if(!scope.current(request))return;
  if(draft.value===content)draft.value='';
  notice.value='消息已提交，成员结果将自动更新。';emit('changed',{workspace,groupId:id});await readDetail();
 }catch(reason){if(scope.current(request))error.value=mutationError(reason,'发送');}
 finally{if(scope.current(request)){busy.value=false;schedulePoll();}}
}
async function cancel(){
 if(busy.value||!activeRuns.value)return;
 const request=scope.begin('write'),workspace=props.workspace,id=selectedId.value;busy.value=true;error.value='';notice.value='';clearTimeout(pollTimer);
 try{
  await api.cancelMixedGroup(id,{},workspace);
  if(!scope.current(request))return;
  notice.value='取消请求已提交，成员是否停止以回执为准。';emit('changed',{workspace,groupId:id});await readDetail();
 }catch(reason){if(scope.current(request))error.value=mutationError(reason,'取消');}
 finally{if(scope.current(request)){busy.value=false;schedulePoll();}}
}
function keydown(event){if(enterGuard.shouldSend(event))void send();}
function scrollMessages(){nextTick(()=>{if(!disposed)historyScroll.refresh(timeline.value);});}
function jumpLatest(){historyScroll.jump(timeline.value);}
function schedulePoll(){
 clearTimeout(pollTimer);pollTimer=null;
 if(disposed||!activeRuns.value)return;
 pollTimer=setTimeout(()=>{
  pollTimer=null;
  if(document.hidden||reading.value||busy.value){schedulePoll();return;}
  void readDetail();
 },4000);
}
function statusLabel(status){return({planned:'尚未开始',pending:'等待执行',acked:'已接收',running:'执行中',partial:'部分完成',succeeded:'已完成',failed:'执行失败',cancelled:'已取消',unknown:'结果待核实',expired:'结果待核实',complete:'已保存',cancel_requested:'取消请求中'})[status]||'状态待核实';}
function memberName(row){return selected.value?.members.find(member=>member.employeeId===row.employeeId)?.name||row.profile||'群成员';}
function messageName(message){return message.role==='user'?'你':message.employeeId?memberName(message):message.role==='system'?'系统':'群成员';}
function mutationError(reason,action){return reason.status?reason.message||`${action}失败`:`${action}请求结果未确认：${reason.message||'连接中断'}。请先重新读取群聊核对结果，草稿已保留。`;}
watch(()=>selected.value?.messages,scrollMessages,{deep:true});
watch(()=>[props.workspace,props.groupId],([workspace,id],[previousWorkspace]=[])=>{
 if(workspace!==previousWorkspace)groups.value=[];
 selectedId.value=id||'';resetSelection();
},{immediate:true});
onBeforeUnmount(()=>{disposed=true;clearTimeout(pollTimer);scope.dispose();});
</script>
<template>
 <section class="mixed-group-panel" :class="{embedded}" aria-label="工作区群聊" :aria-busy="reading">
  <header class="mixed-group-heading"><div><h2>{{selected?.title||'群聊'}}</h2><p v-if="selected">{{selected.members.length}} 位成员 · Hermes、DSH、Codex 跨运行时协作</p><p v-else>从左侧选择一个群聊，查看成员与讨论记录。</p></div><div class="mixed-group-actions"><span v-if="selected" class="mixed-group-status" role="status">{{currentStatus}}</span><button type="button" :disabled="reading||listReading||busy" @click="refresh">刷新群聊</button><button type="button" :disabled="busy" @click="showCreate=!showCreate">{{showCreate?'收起新建':'新建群聊'}}</button></div></header>
  <div v-if="error" class="mixed-group-error" role="alert"><span>{{error}}</span><button type="button" :disabled="reading||busy" @click="refresh">重新读取</button></div>
  <p v-if="notice" class="mixed-group-notice" role="status">{{notice}}</p>
  <div class="mixed-group-layout">
   <aside v-if="!embedded" aria-label="工作区群聊列表"><p v-if="listReading" role="status">正在读取群聊列表…</p><div v-if="listError" class="mixed-group-error" role="alert">{{listError}}<button type="button" :disabled="listReading" @click="readList">重新读取列表</button></div><button v-for="group in groups" :key="group.id" type="button" :data-group-id="group.id" :class="{selected:group.id===selectedId}" :aria-current="group.id===selectedId?'true':undefined" @click="select(group.id)"><strong>{{group.title}}</strong><small>{{group.members.length}} 位成员</small></button><p v-if="!listReading&&!listError&&!groups.length">还没有群聊。</p></aside>
   <main>
    <form v-if="showCreate" class="mixed-group-create" aria-label="新建群聊" @submit.prevent="create"><input v-model="title" maxlength="480" placeholder="新群聊名称" aria-label="新群聊名称"/><p>选择 2–6 位成员；使用各自已绑定的 Profile、电脑和专属会话。</p><div class="mixed-group-members"><label v-for="employee in candidates" :key="employee.id"><input type="checkbox" :checked="memberIds.includes(employee.id)" :aria-label="'群成员：'+employee.name" @change="toggle(employee.id)"/> {{employee.name}} <small>{{employee.runtime}}</small></label></div><p v-if="candidates.length<2">当前至少需要两位已配置的员工。</p><button type="submit" :disabled="busy||memberIds.length<2||memberIds.length>6">创建群聊</button></form>
    <p v-if="reading&&!selected" class="mixed-group-empty" role="status">正在读取当前群聊…</p>
    <template v-if="selected">
     <div class="mixed-group-roster" aria-label="群聊成员"><span v-for="member in selected.members" :key="member.employeeId"><strong>{{member.name}}</strong><small>{{member.runtime}} · @{{member.profile}}</small></span></div>
     <div class="mixed-group-history-wrap"><div ref="timeline" class="mixed-group-history" aria-label="群聊消息" aria-live="polite" tabindex="0" @scroll="historyScroll.scroll" @wheel.passive="historyScroll.wheel" @touchstart.passive="historyScroll.touchStart" @touchmove.passive="historyScroll.touchMove" @pointerdown="historyScroll.pointer" @keydown="historyScroll.key"><article v-for="message in selected.messages" :key="message.id" :class="{'is-user':message.role==='user'}"><div class="mixed-group-message-meta"><strong>{{messageName(message)}}</strong><small v-if="message.runtime">{{message.runtime}}</small><small v-if="message.status">{{statusLabel(message.status)}}</small></div><p>{{message.text}}</p></article><p v-if="!selected.messages.length" class="mixed-group-empty">还没有消息，可以开始讨论。</p></div><button v-if="historyScroll.state.showLatest" type="button" class="mixed-group-jump-latest" @click="jumpLatest">跳至最新</button></div>
     <div class="mixed-group-compose"><textarea v-model="draft" rows="3" maxlength="20000" aria-label="群消息" placeholder="输入消息；不写 @ 默认发送给全员" @compositionstart="enterGuard.compositionStart" @compositionend="enterGuard.compositionEnd" @keydown="keydown"/><div class="mixed-group-compose-footer"><span>Enter 发送 · Shift + Enter 换行</span><div class="mixed-group-actions"><button v-if="activeRuns" type="button" :disabled="busy" @click="cancel">请求取消当前回合</button><button type="button" class="primary" :disabled="busy||!draft.trim()" @click="send">{{busy?'提交中…':'发送到群'}}</button></div></div></div>
     <section v-if="selected.runs?.length" class="mixed-group-runs" aria-label="群成员执行回执"><h3>成员执行结果</h3><article v-for="run in selected.runs" :key="run.actionId"><div class="mixed-group-run-heading"><strong>{{memberName(run)}}</strong><small>{{run.runtime}} · {{statusLabel(run.status)}}</small></div><p v-if="run.output">{{run.output}}</p><p v-if="run.error" class="mixed-group-error">{{run.error}}</p><details><summary>查看执行回执</summary><dl><div><dt>Profile</dt><dd>{{run.profile}}</dd></div><div><dt>专属会话</dt><dd>{{run.conversationId}}</dd></div><div><dt>执行 ID</dt><dd>{{run.actionId}}</dd></div></dl></details></article></section>
    </template>
    <p v-else-if="!reading&&!error" class="mixed-group-empty">请选择要打开的群聊。</p>
   </main>
  </div>
 </section>
</template>
<style scoped>
.mixed-group-panel{height:100%;min-height:0;overflow:auto;padding:24px 28px;box-sizing:border-box;color:#4b4058;background:#fff}
.mixed-group-heading,.mixed-group-actions,.mixed-group-roster,.mixed-group-compose-footer,.mixed-group-message-meta,.mixed-group-run-heading{display:flex;align-items:center;gap:10px}
.mixed-group-heading{justify-content:space-between;align-items:flex-start;gap:16px;padding-bottom:16px;border-bottom:.5px solid #e8e0ef}.mixed-group-heading h2{margin:0;font-size:19px;line-height:1.5;color:#382f43}.mixed-group-panel p{line-height:1.7}.mixed-group-heading p{margin:6px 0 0;font-size:12px;color:#8b7f96}.mixed-group-actions{flex-wrap:wrap}
.mixed-group-panel button{border:0;border-radius:7px;padding:8px 11px;font:inherit;font-size:12px;color:#6a537e;background:#f4f0f8;cursor:pointer}.mixed-group-panel button:not(:disabled):hover{background:#eae0f6}.mixed-group-panel button.primary,.mixed-group-create button{background:#7655c7;color:white}.mixed-group-panel button.primary:not(:disabled):hover,.mixed-group-create button:not(:disabled):hover{background:#6745b9}.mixed-group-panel button:disabled{opacity:.45;cursor:default}.mixed-group-status{padding:5px 9px;border-radius:99px;background:#f2edf8;font-size:12px;white-space:nowrap}
.mixed-group-layout{display:flex;gap:20px;margin-top:18px}.mixed-group-layout aside{width:190px;flex-shrink:0;display:grid;align-content:start;gap:6px}.mixed-group-layout aside button{text-align:left;padding:11px}.mixed-group-layout aside button.selected{background:#eae0f6}.mixed-group-layout aside small{display:block;margin-top:5px;font-size:11px;color:#9989a4}.mixed-group-layout main{flex:1;min-width:0}
.mixed-group-create{display:grid;gap:10px;margin-bottom:18px;padding:16px;background:#faf8fd;border-radius:9px;box-shadow:inset 0 0 0 .5px #e8e0ef}.mixed-group-create p{margin:0;font-size:12px;color:#8b7f96}.mixed-group-create>input,.mixed-group-compose textarea{border:0;box-shadow:inset 0 0 0 .5px #ded4e9;border-radius:8px;padding:11px;font:inherit;color:inherit;background:white}.mixed-group-create button{justify-self:start}.mixed-group-members{display:flex;gap:12px;flex-wrap:wrap}.mixed-group-members label{font-size:12px}
.mixed-group-roster{flex-wrap:wrap;margin-bottom:18px}.mixed-group-roster>span{display:flex;align-items:center;gap:8px;padding:7px 10px;background:#f7f4fa;border-radius:7px;font-size:12px}.mixed-group-roster small{color:#96869f;font-size:11px}
.mixed-group-history-wrap{position:relative}.mixed-group-panel .mixed-group-jump-latest{position:absolute;right:8px;bottom:12px;box-shadow:0 2px 8px #3c23552a;background:#7655c7;color:white}.mixed-group-panel .mixed-group-jump-latest:hover{background:#6745b9}.mixed-group-history{min-height:180px;max-height:calc(100vh - 380px);overflow:auto;padding:0 4px}.mixed-group-history article{max-width:90%;padding:12px 14px;margin-bottom:12px;background:#f7f5f9;border-radius:10px}.mixed-group-history article.is-user{margin-left:auto;background:#f0e9fb}.mixed-group-message-meta{font-size:12px;gap:8px}.mixed-group-message-meta small{color:#93869e;font-size:11px}.mixed-group-history article p,.mixed-group-runs article>p{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0 0;font-size:13px}
.mixed-group-compose{margin-top:18px}.mixed-group-compose textarea{display:block;width:100%;box-sizing:border-box;resize:vertical;min-height:90px}.mixed-group-compose-footer{justify-content:space-between;margin-top:9px}.mixed-group-compose-footer>span{font-size:11px;color:#a093a9}
.mixed-group-runs{display:grid;gap:9px;margin-top:24px;border-top:.5px solid #eee7f2;padding-top:16px}.mixed-group-runs h3{margin:0 0 4px;font-size:13px}.mixed-group-runs article{padding:12px;border:.5px solid #e8e0ef;border-radius:8px}.mixed-group-run-heading{justify-content:space-between;font-size:12px}.mixed-group-run-heading small{color:#8b7f96}.mixed-group-runs details{margin-top:9px;font-size:11px;color:#8b7f96}.mixed-group-runs summary{cursor:pointer}.mixed-group-runs dl{margin:8px 0 0}.mixed-group-runs dl div{display:flex;gap:8px;margin-top:5px}.mixed-group-runs dt{min-width:60px}.mixed-group-runs dd{margin:0;overflow-wrap:anywhere}
.mixed-group-error{display:flex;align-items:center;gap:10px;flex-wrap:wrap;color:#a26075;font-size:12px;padding:9px 0}.mixed-group-notice{color:#7c6a8f;font-size:12px;margin-bottom:0}.mixed-group-empty{padding:30px 0;text-align:center;color:#a093a9;font-size:13px}
@media(max-width:700px){.mixed-group-panel{padding:18px 14px}.mixed-group-heading{flex-direction:column}.mixed-group-layout{display:grid}.mixed-group-layout aside{width:auto;grid-template-columns:repeat(2,minmax(0,1fr))}.mixed-group-history{max-height:50vh}.mixed-group-history article{max-width:100%}.mixed-group-compose-footer{align-items:flex-end;gap:12px}.mixed-group-compose-footer>span{max-width:105px;line-height:1.7}}
</style>
