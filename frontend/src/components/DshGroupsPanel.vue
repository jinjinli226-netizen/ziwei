<script setup>
import {computed,ref,watch} from 'vue';
import {dshGroupRoster,dshGroupItems,dshGroupEditInput,dshGroupSendInput,dshGroupExecution} from '../dsh-groups.js';
import {dshNativeApplicationLabel} from '../dsh-native.js';

const props=defineProps({controller:{type:Object,required:true},employees:{type:Array,required:true},sourceAction:Object});
const ctl=computed(()=>props.controller),state=computed(()=>ctl.value.state),subject=computed(()=>state.value.value?.subject);
const descriptor=computed(()=>ctl.value.resource('groups'));
const roster=computed(()=>dshGroupRoster(props.employees,subject.value));
const scope=computed(()=>JSON.stringify([state.value.subject,state.value.value?.subjectHash]));
const busy=computed(()=>state.value.loading||state.value.submitting||state.value.controlBusy||Boolean(state.value.request)||Boolean(state.value.value?.pending?.length));
const groups=ref([]),selectedId=ref(''),draft=ref(null),message=ref(''),targetMode=ref('mentions'),targets=ref([]),removeTarget=ref(''),run=ref(null),cancellation=ref(null),cancelPending=ref(false),error=ref('');
let editIntent=null,sendIntent=null;const messageDrafts=new Map();
const selected=computed(()=>groups.value.find(row=>row.id===selectedId.value)||null);
const members=computed(()=>(selected.value?.members||[]).map(profile=>roster.value.find(row=>row.profile===profile&&!row.ambiguous)||{profile,label:profile,employeeId:null,ambiguous:true}));
const can=operation=>!busy.value&&ctl.value.supported('groups',operation);
const writable=operation=>can(operation)&&ctl.value.editable('groups');
const canCancel=computed(()=>run.value?.started&&!['applied','failed','cancelled'].includes(run.value.status)&&cancellation.value?.data.cancelRequested!==true&&!cancelPending.value&&!state.value.loading&&!state.value.submitting&&!state.value.controlBusy&&ctl.value.supported('groups','cancel'));
const memberLabel=row=>roster.value.find(member=>member.employeeId===row.employeeId)?.label||row.profile||row.actionId;
const statusLabel=status=>({pending:'等待成员原回执',succeeded:'成员原执行已成功',failed:'成员原执行已失败',unknown:'成员结果未确认'})[status]||status;
watch(scope,()=>{groups.value=[];selectedId.value='';draft.value=null;message.value='';targets.value=[];targetMode.value='mentions';removeTarget.value='';run.value=null;cancellation.value=null;cancelPending.value=false;error.value='';editIntent=null;sendIntent=null;});
watch(()=>descriptor.value?.data,data=>{if(!data)return;groups.value=dshGroupItems(data,groups.value);if(!groups.value.some(row=>row.id===selectedId.value))selectedId.value=groups.value[0]?.id||'';},{immediate:true,deep:true});
watch([scope,selectedId],([current,id],[previous,oldId])=>{
 if(current===previous&&oldId)messageDrafts.set(oldId,{message:message.value,targets:[...targets.value],targetMode:targetMode.value});else messageDrafts.clear();
 const saved=messageDrafts.get(id);message.value=saved?.message||'';targets.value=[...(saved?.targets||[])];targetMode.value=saved?.targetMode||'mentions';removeTarget.value='';
});
function consume(action){
 const evidence=dshGroupExecution(action,subject.value);
 if(evidence?.operation==='send'){if(run.value?.actionId!==evidence.actionId){cancellation.value=null;cancelPending.value=false;}run.value=evidence;}
 if(evidence?.operation==='cancel'&&evidence.sourceActionId===run.value?.actionId){cancellation.value=evidence;if(!['pending','unknown','partial'].includes(evidence.status))cancelPending.value=false;}
 const op=action?.payload?.dshOperation,receipt=action?.result?.dshNative;
 if(op?.resource!=='groups'||JSON.stringify(op.subject)!==JSON.stringify(subject.value)||action.status!=='succeeded'||receipt?.status!=='applied')return;
 if(editIntent?.scope===scope.value&&editIntent.actionId===action.id&&receipt.data?.item?.id){groups.value=dshGroupItems(receipt.data,groups.value);selectedId.value=receipt.data.item.id;draft.value=null;editIntent=null;}
 if(sendIntent?.scope===scope.value&&sendIntent.actionId===action.id){
  if(selectedId.value===sendIntent.groupId){if(message.value===sendIntent.content)message.value='';}
  else{const saved=messageDrafts.get(sendIntent.groupId);if(saved?.message===sendIntent.content)saved.message='';}
  sendIntent=null;
 }
}
watch(()=>[props.sourceAction,state.value.groupAction,state.value.action,state.value.controlAction],([source,group,main,control])=>{
 const original=group||(main?.payload?.dshOperation?.resource==='groups'&&main.payload.dshOperation.operation==='send'?main:source);
 if(original)consume(original);
 if(main&&main!==original&&main.payload?.dshOperation?.operation!=='send')consume(main);
 if(control)consume(control);
},{immediate:true,deep:true});
async function read(){if(can('list'))await ctl.value.submit('groups','list',{});}
async function open(group){selectedId.value=group.id;error.value='';if(can('get'))await ctl.value.submit('groups','get',{groupId:group.id});}
function edit(group=null){
 error.value='';const ids=group?.members.map(profile=>roster.value.find(row=>row.profile===profile&&!row.ambiguous)?.employeeId);
 if(ids?.some(id=>!id)){error.value='此群的成员映射尚未核实，请核对员工绑定并重新读取后编辑。';return;}
 draft.value=group?{groupId:group.id,title:group.title,memberEmployeeIds:ids}:{title:'',memberEmployeeIds:[subject.value.employeeId]};
}
function toggleMember(id,checked){if(!draft.value||id===subject.value.employeeId)return;draft.value.memberEmployeeIds=checked?[...draft.value.memberEmployeeIds,id]:draft.value.memberEmployeeIds.filter(value=>value!==id);}
async function save(){
 if(!draft.value||!writable(draft.value.groupId?'update':'create'))return;error.value='';
 try{const input=dshGroupEditInput(draft.value,{groupId:draft.value.groupId,subject:subject.value,roster:roster.value});editIntent={scope:scope.value,actionId:null};const result=await ctl.value.submit('groups',draft.value.groupId?'update':'create',input);if(result?.action){editIntent.actionId=result.action.id;consume(result.action);}}
 catch(failure){error.value=failure.message;}
}
async function remove(){if(!removeTarget.value||!writable('delete'))return;const groupId=removeTarget.value;removeTarget.value='';await ctl.value.submit('groups','delete',{groupId});}
function mention(member){if(!busy.value)message.value+=(message.value&&!/\s$/.test(message.value)?' ':'')+'@'+member.profile+' ';}
function toggleTarget(id,checked){targets.value=checked?[...targets.value,id]:targets.value.filter(value=>value!==id);}
async function send(){
 if(!writable('send'))return;error.value='';
 try{const input=dshGroupSendInput(selected.value,message.value,targetMode.value==='selected'?targets.value:null,roster.value);sendIntent={scope:scope.value,actionId:null,groupId:input.groupId,content:message.value};const result=await ctl.value.submit('groups','send',input);if(result?.action){sendIntent.actionId=result.action.id;consume(result.action);}}
 catch(failure){error.value=failure.message;}
}
async function cancel(){
 if(!canCancel.value)return;cancelPending.value=true;error.value='';
 const result=await ctl.value.control('cancelGroup',{sourceActionId:run.value.actionId});if(result?.action)consume(result.action);else if(result&&!result.action)cancelPending.value=false;
}
</script>

<template>
 <section class="dsh-groups" aria-label="DSH 原生群协作">
  <header class="groups-heading"><div><h3>原生群协作</h3><p>群成员共享这个群的历史，各自在专属群会话中执行；私人聊天不会被拼入群会话。</p><small>来源 dsh-native · 当前 Bot {{subject?.profile||'尚未核实'}}<template v-if="descriptor?.checkedAt"> · {{new Date(descriptor.checkedAt).toLocaleString('zh-CN')}}</template></small></div><div class="groups-actions"><button type="button" :disabled="!can('list')" @click="read">读取群记录</button><button type="button" :disabled="!writable('create')||roster.filter(row=>!row.ambiguous).length<2" @click="edit()">新建群</button></div></header>
  <p v-if="state.error" class="groups-error" role="alert">{{state.error}}</p><p v-if="error" class="groups-error" role="alert">{{error}}</p><p v-if="state.notice" class="groups-notice" role="status">{{state.notice}}</p>
  <p v-if="state.unknown" class="groups-error" role="alert">原请求结果未确认，已保留原参数与请求标识；回读原请求，不能重新发送冒充完成。</p>
  <p v-if="descriptor?.stale" class="groups-muted">群观察已过期，需要重新读取后才能修改或执行。</p>
  <div v-if="state.request" class="groups-pending"><span>原请求 {{state.request.actionId||'身份尚未确认'}} · {{state.request.operation}}</span><button type="button" :disabled="state.loading||state.submitting" @click="ctl.readAction()">回读原请求</button></div>
  <div class="groups-layout"><nav class="groups-list" aria-label="已观察的原生群"><button v-for="group in groups" :key="group.id" type="button" :aria-current="selectedId===group.id?'page':undefined" :class="{selected:selectedId===group.id}" @click="open(group)"><strong>{{group.title||group.id}}</strong><small>{{group.members.length}} 位成员 · {{group.id}}</small></button><p v-if="!groups.length" class="groups-muted">尚无已观察的群。读取后显示当前员工可见且包含它的原生群。</p></nav>
   <div class="groups-main">
    <form v-if="draft" class="groups-editor" aria-label="编辑原生群" @submit.prevent="save"><h4>{{draft.groupId?'编辑原生群':'新建原生群'}}</h4><label>群名称<input :value="draft.title" aria-label="群名称" maxlength="480" :disabled="busy" @input="draft.title=$event.target.value"/></label><fieldset :disabled="busy"><legend>成员 · 2–6 位，包含当前员工</legend><label v-for="row in roster" :key="row.employeeId" class="groups-check"><input type="checkbox" :checked="draft.memberEmployeeIds.includes(row.employeeId)" :aria-label="'群成员：'+row.label" :disabled="row.employeeId===subject.employeeId||row.ambiguous||!draft.memberEmployeeIds.includes(row.employeeId)&&draft.memberEmployeeIds.length>=6" @change="toggleMember(row.employeeId,$event.target.checked)"/><span>{{row.label}} <code>{{row.profile}}</code><small v-if="row.ambiguous">原生 Bot 映射不唯一</small><small v-else-if="row.employeeId===subject.employeeId">当前员工</small></span></label></fieldset><div class="groups-actions"><button type="button" :disabled="busy" @click="draft=null">关闭编辑</button><button type="submit" class="primary" :disabled="!writable(draft.groupId?'update':'create')">保存原生群</button></div></form>
    <template v-if="selected"><div class="groups-title"><div><h4>{{selected.title}}</h4><code>{{selected.id}}</code></div><div class="groups-actions"><button type="button" :disabled="!writable('update')" @click="edit(selected)">编辑群</button><button type="button" class="danger" :disabled="!writable('delete')" @click="removeTarget=selected.id">删除群</button></div></div>
     <p class="groups-muted">{{selected.members.join(' · ')}}</p>
     <section v-if="removeTarget===selected.id" class="groups-confirm" role="alertdialog" aria-label="删除原生群确认"><strong>删除 {{selected.title}}？</strong><p>将删除此原生群记录。已发出的成员执行不会因此被证明停止；需要停止时请使用原群执行的停止入口。</p><div class="groups-actions"><button type="button" @click="removeTarget=''">保留群</button><button type="button" class="danger" :disabled="!writable('delete')" @click="remove">确认删除原生群</button></div></section>
     <details class="groups-evidence"><summary>群专属会话观察</summary><p v-for="profile in selected.members" :key="profile"><code>{{profile}}</code> · {{selected.sessions[profile]||'尚未报告群专属会话'}}</p></details>
     <div class="groups-history" aria-label="原生群历史"><article v-for="(row,index) in selected.messages" :key="row.id||index"><small>{{row.botDisplayName||row.botName||({user:'你',assistant:'群成员',tool:'工具'})[row.role]||row.role}} · {{row.status}}</small><p>{{row.text}}</p><p v-if="row.error" class="groups-error">{{row.error}}</p></article><p v-if="!selected.messages.length" class="groups-muted">尚无原生群历史。</p></div>
     <section class="groups-composer" aria-label="群消息编辑"><label>群消息<textarea :value="message" aria-label="群消息" rows="4" maxlength="16000" :disabled="busy" placeholder="用 @Bot名 定向，@all 表示全员" @input="message=$event.target.value"/></label><div class="groups-actions"><button v-for="member in members" :key="member.profile" type="button" :disabled="busy" :aria-label="'提及原生 Bot：'+member.profile" @click="mention(member)">@{{member.label}}</button></div><label>发送范围<select :value="targetMode" aria-label="群发送范围" :disabled="busy" @change="targetMode=$event.target.value"><option value="mentions">按正文 @ 指向；无 @ 则全员</option><option value="selected">仅指定员工</option></select></label><div v-if="targetMode==='selected'"><label v-for="member in members" :key="member.profile" class="groups-check"><input type="checkbox" :checked="targets.includes(member.employeeId)" :disabled="busy||member.ambiguous" :aria-label="'仅发送给：'+member.label" @change="toggleTarget(member.employeeId,$event.target.checked)"/>{{member.label}} <code>{{member.profile}}</code></label></div><p class="groups-muted">正文提及使用原生 Bot 名。指定员工时以所选员工为准；发送将实际调用这些成员，不能当作普通配置保存。</p><button type="button" class="primary" :disabled="!writable('send')||!message.trim()" @click="send">发送到群</button><p v-if="!ctl.supported('groups','send')" class="groups-muted">当前客户端尚未接入受控群发送。</p></section>
    </template>
   </div>
  </div>
  <section v-if="run" class="groups-run" aria-label="本次群执行回执"><div class="groups-title"><div><h4>群执行 · {{run.groupId}}</h4><code>原协调 action {{run.actionId}}</code></div><button type="button" :disabled="!canCancel" @click="cancel">{{cancelPending?'取消请求待核实':'请求停止本次群执行'}}</button></div><p>{{dshNativeApplicationLabel(run.status)}}</p><p v-if="cancelPending||state.controlAction?.payload?.dshOperation?.resource==='groups'" class="groups-muted">{{state.controlNotice}}<span v-if="state.controlError" class="groups-error">{{state.controlError}}</span><button type="button" :disabled="state.loading||state.submitting||state.controlBusy" @click="ctl.readAction()">回读群执行与取消回执</button></p><p class="groups-muted">{{run.historyPersisted?'原生群历史已回读核实。':'群历史尚未核实保存。'}}成员终态分别以其原执行回执为准。</p><p v-if="!run.members.length" class="groups-muted">尚未返回逐成员原 action 引用，不能据父请求已受理判断成员完成。</p><article v-for="member in run.members" :key="member.actionId" class="groups-member-result"><strong>{{memberLabel(member)}} · {{statusLabel(member.status)}}</strong><code>原 action {{member.actionId}}</code><small v-if="member.conversationId">群专属聊天 {{member.conversationId}}</small><small v-if="member.sessionId">群专属 session {{member.sessionId}}</small><pre v-if="member.output">{{member.output}}</pre><p v-if="member.error" class="groups-error">{{member.error}}</p></article><p v-if="run.data.error" class="groups-error">{{run.data.error.code}}</p>
   <section v-if="cancellation" class="groups-cancel" aria-label="原群执行取消回执"><strong>取消请求已返回 · {{cancellation.actionId}}</strong><p>原群执行 {{cancellation.sourceActionId}} 的停止仍待各成员原终态确认。{{cancellation.status==='unknown'?'取消控制结果也未确认，继续回读原请求。':''}}</p><p v-for="member in cancellation.members" :key="member.actionId"><code>{{member.actionId}}</code> · {{member.cancellationRequested?'已请求取消':'尚无已发出的取消证据'}}<template v-if="member.cancelActionId"> · 控制 {{member.cancelActionId}}</template><template v-if="member.targetResultAvailable"> · 原成员结果可读取</template></p></section>
  </section>
 </section>
</template>

<style scoped>
.dsh-groups{min-width:0;font-size:12px;color:#4b4058}.groups-heading,.groups-title{display:flex;justify-content:space-between;align-items:flex-start;gap:14px}.dsh-groups h3{margin:0 0 8px;font-size:17px}.dsh-groups h4{font-size:14px;margin:0 0 8px}.dsh-groups p{line-height:1.8;overflow-wrap:anywhere}.dsh-groups small,.groups-muted{color:#92819d;line-height:1.8}.dsh-groups code{color:#9d8ba8;font:10px/1.7 Consolas,monospace;overflow-wrap:anywhere}.dsh-groups button{font:inherit;color:#765f89;background:#f2edf8;border:0;min-height:32px;padding:6px 10px;border-radius:7px;cursor:pointer}.dsh-groups button:hover:not(:disabled){background:#e9e0f3}.dsh-groups button:disabled{opacity:.45;cursor:default}.dsh-groups button.primary{background:#7655c7;color:#fff}.dsh-groups button.danger{color:#a16579;background:#fcf1f5}.dsh-groups :is(button,input,textarea,select,summary):focus-visible{outline:2px solid #a88af0;outline-offset:3px}.groups-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.groups-layout{display:grid;grid-template-columns:minmax(150px,200px) minmax(0,1fr);gap:22px;margin-top:20px}.groups-list{display:grid;align-content:start;gap:5px}.groups-list>button{display:grid;text-align:left;gap:5px;background:transparent;overflow-wrap:anywhere}.groups-list>button.selected{background:#eee7f7}.groups-main{min-width:0}.groups-editor{padding:15px;background:#faf8fd;border-radius:10px;margin-bottom:22px}.dsh-groups label{display:grid;gap:7px;margin:12px 0}.dsh-groups :is(input:not([type=checkbox]),textarea,select){box-sizing:border-box;width:100%;min-width:0;border:0;box-shadow:inset 0 0 0 .5px #ded4e9;border-radius:7px;background:#fff;font:inherit;color:inherit;padding:8px 10px;min-height:34px}.dsh-groups textarea{resize:vertical;line-height:1.7}.dsh-groups fieldset{border:0;padding:0;margin:16px 0}.dsh-groups legend{font-size:11px;color:#96839f}.dsh-groups .groups-check{display:flex;align-items:flex-start;gap:8px;line-height:1.7}.groups-check input{flex:none;width:16px;height:16px;margin:2px 0 0;accent-color:#7655c7}.groups-check small{margin-left:7px;font-size:10px}.groups-notice,.groups-pending{padding:10px 12px;background:#f5f1fa;border-radius:8px;line-height:1.8}.groups-pending{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;overflow-wrap:anywhere}.groups-error{color:#a26075;line-height:1.8}.groups-confirm,.groups-cancel{padding:14px;background:#faf3f7;border-radius:9px;margin:15px 0}.groups-evidence{border-top:1px solid #eee7f2;padding:14px 0;margin-top:15px}.groups-evidence summary{color:#8b7598;cursor:pointer}.groups-history{max-height:400px;overflow:auto;margin:14px 0;border-block:1px solid #eee7f2}.groups-history article{padding:12px 0;border-bottom:1px solid #f2edf5}.groups-history article:last-child{border-bottom:0}.groups-history p{white-space:pre-wrap;margin:7px 0}.groups-composer{margin-top:18px}.groups-run{border-top:1px solid #e9e0f1;padding-top:18px;margin-top:24px}.groups-member-result{display:grid;gap:6px;border-top:1px solid #eee7f2;padding:13px 0}.groups-member-result pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:300px;overflow:auto;font:12px/1.7 Consolas,monospace;margin:7px 0}@media(max-width:760px){.groups-heading,.groups-title{flex-direction:column}.groups-layout{grid-template-columns:minmax(0,1fr)}.groups-list{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(pointer:coarse){.dsh-groups button,.dsh-groups input:not([type=checkbox]),.dsh-groups select{min-height:36px}}
</style>
