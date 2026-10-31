<script setup>
import {computed,ref,watch} from 'vue';
import {dshNativeApplicationLabel} from '../dsh-native.js';

const props=defineProps({controller:{type:Object,required:true},section:{type:String,default:'routines'}});
const ctl=computed(()=>props.controller),state=computed(()=>ctl.value.state);
const descriptor=computed(()=>ctl.value.resource(props.section));
const data=computed(()=>descriptor.value?.data);
const busy=computed(()=>state.value.loading||state.value.submitting||Boolean(state.value.request)||Boolean(state.value.value?.pending?.length));
const editId=ref(null),draft=ref({title:'',prompt:'',intervalMinutes:1440,enabled:true});
const intervals=[{value:1,label:'每分钟'},{value:15,label:'每15分钟'},{value:60,label:'每小时'},{value:1440,label:'每天'}];
const folders=ref(''),preview=ref(null),historySessionId=ref(''),historyPreviousActionId=ref('');
const editable=computed(()=>ctl.value.editable(props.section));
const can=(operation)=>ctl.value.supported(props.section,operation)&&!busy.value;
const items=computed(()=>data.value?.items||(data.value?.item?[data.value.item]:[]));
const sessionData=computed(()=>ctl.value.resource('sessions')?.data);
const sessionMessages=computed(()=>{
 const action=state.value.action,op=action?.payload?.dshOperation;
 if(!historySessionId.value||!action?.id||action.id===historyPreviousActionId.value||action?.status!=='succeeded'||op?.resource!=='sessions'||op.operation!=='history'||op.input?.sessionId!==historySessionId.value)return [];
 const rows=sessionData.value?.snapshot?.records||[],messages=[],imageTypes=new Set(['image/png','image/jpeg','image/gif','image/webp']);
 for(const record of rows){const event=record?.event||record;if(event?.type!=='assistant/message')continue;const blocks=event.data?.message?.content||event.data?.content||[];const text=blocks.filter(block=>block?.type==='text'&&typeof block.text==='string').map(block=>block.text).join('');const images=blocks.filter(block=>block?.type==='image'&&typeof block.data==='string'&&imageTypes.has(String(block.mediaType||block.mimeType||'image/png').toLowerCase())&&/^[A-Za-z0-9+/]+={0,2}$/.test(block.data)&&block.data.length<=14*1024*1024).map(block=>({mimeType:String(block.mediaType||block.mimeType||'image/png').toLowerCase(),data:block.data}));if(text||images.length)messages.push({text,images});}
 return messages;
});
const statusLabel=status=>({submitted:'已提交，等待执行结果',running:'运行中',completed:'已完成',succeeded:'已完成',failed:'失败',interrupted:'已中断',unknown:'结果未知'})[status]||status||'尚未运行';
const scope=computed(()=>JSON.stringify(state.value.subject));
let savedRequest=null;
const localTime=value=>value?new Date(value).toLocaleString('zh-CN'):'';
function fileLabel(name){const dot=name.lastIndexOf('.'),suffix=dot>0?name.slice(dot):'',base=dot>0?name.slice(0,dot):name;return name.length>48?base.slice(0,20)+'…'+base.slice(-12)+suffix:name;}
watch(()=>[scope.value,props.section],()=>{savedRequest=null;editId.value=null;draft.value={title:'',prompt:'',intervalMinutes:1440,enabled:true};folders.value='';preview.value=null;historySessionId.value='';historyPreviousActionId.value='';});
async function read(){
 if(props.section==='files')return browse(folders.value);
 return ctl.value.submit(props.section,props.section==='logs'?'read':'list',props.section==='logs'?{lines:200}:{});
}
function edit(item){editId.value=item?.id||'';draft.value=item?{title:item.title,prompt:item.prompt,intervalMinutes:item.intervalMinutes,enabled:item.enabled}:{title:'',prompt:'',intervalMinutes:1440,enabled:true};}
async function save(){
 if(savedRequest)return;
 const input={...draft.value};if(editId.value)input.id=editId.value;
 const previousAction=state.value.action?.id;
 savedRequest={scope:scope.value,operation:editId.value?'update':'create',id:editId.value};
 await ctl.value.submit('routines',editId.value?'update':'create',input);
 if(!savedRequest)return;
 const action=state.value.action;
 if(action?.id!==previousAction&&action?.payload?.dshOperation?.resource==='routines'&&action.payload.dshOperation.operation===savedRequest.operation)savedRequest.actionId=action.id;
 else if(!state.value.request)savedRequest=null;
 finishSave();
}
async function remove(item){if(window.confirm(`删除例行工作“${item.title}”？运行历史以原生回执为准。`))await ctl.value.submit('routines','delete',{id:item.id});}
async function browse(path){preview.value=null;folders.value=path;await ctl.value.submit('files','list',{path});}
async function openFile(item){if(item.isDir)return browse(item.path);await ctl.value.submit('files','preview',{path:item.path});}
async function readRoutineSession(item){if(!item?.lastSessionId||busy.value)return;historyPreviousActionId.value=state.value.action?.id||'';historySessionId.value=item.lastSessionId;await ctl.value.submit('sessions','history',{sessionId:item.lastSessionId,maxMessages:100});}
const parent=computed(()=>folders.value.split('/').filter(Boolean).slice(0,-1).join('/'));
watch(()=>data.value,value=>{if(props.section==='files'&&value?.sourceOperation==='preview'){preview.value=value;folders.value=value.path.split('/').slice(0,-1).join('/');}else if(props.section==='files'&&value?.sourceOperation==='list'){preview.value=null;folders.value=value.path||'';}if(props.section==='routines'&&value?.sourceOperation==='get'&&value.item)edit(value.item);},{immediate:true});
function finishSave(){
 const action=state.value.action,receipt=action?.result?.dshNative,op=action?.payload?.dshOperation;
 if(!savedRequest?.actionId||savedRequest.scope!==scope.value||action.id!==savedRequest.actionId||op?.resource!=='routines'||op.operation!==savedRequest.operation)return;
 if(action.status==='succeeded'&&receipt?.status==='applied'&&receipt.data?.item?.id){editId.value=null;savedRequest=null;}
 else if(['failed','cancelled'].includes(action.status)&&receipt?.status==='failed')savedRequest=null;
}
watch(()=>[state.value.action,state.value.request],finishSave,{deep:true});
</script>

<template>
 <section class="dsh-workspace" :aria-label="({routines:'DSH例行工作',files:'DSH工作文件',logs:'DSH运行日志'})[section]">
  <header><div><h3>{{({routines:'例行工作',files:'工作文件',logs:'运行日志'})[section]}}</h3><p>{{section==='routines'?'由这位员工的 DSH 原生调度器运行。':section==='files'?'浏览当前 Bot 工作目录中的文件。':'读取当前 Bot 的原生运行日志。'}}</p></div><button type="button" :disabled="!can(section==='logs'?'read':'list')" @click="read">{{busy?'正在回读…':'读取原生记录'}}</button></header>
  <p v-if="state.error" class="error" role="alert">{{state.error}}</p><p v-if="state.notice" role="status">{{state.notice}}</p>
  <p v-if="!data" class="empty">尚无当前原生记录，请连接员工所在电脑后读取。</p>
  <p v-if="descriptor?.stale" class="empty">上次观察已过期，需要重新读取。</p>
  <template v-if="section==='routines'">
   <div class="toolbar"><button type="button" :disabled="!editable||!can('create')" @click="edit(null)">新建例行工作</button><small v-if="data?.onlineOnly">Bot 所在电脑在线且原生调度器运行时执行</small></div>
   <p v-for="warning in data?.warnings" :key="warning" class="empty">{{warning}}</p>
   <article v-for="item in items" :key="item.id" class="routine">
    <div class="routine-heading"><strong>{{item.title}}</strong><span>{{item.enabled?'已开启':'已暂停'}} · {{statusLabel(item.lastStatus)}}</span></div>
    <p>{{item.prompt}}</p><small>{{intervals.find(value=>value.value===item.intervalMinutes)?.label}}<template v-if="item.nextRun"> · 下次：{{localTime(item.nextRun)}}</template></small>
    <p v-if="item.lastError" class="error">{{item.lastError}}</p>
    <div class="toolbar"><button :disabled="!editable||!can('update')" @click="edit(item)">编辑</button><button :disabled="!editable||!can('update')" @click="ctl.submit('routines','update',{id:item.id,enabled:!item.enabled})">{{item.enabled?'暂停':'开启'}}</button><button :disabled="!editable||!can('run')||item.running" @click="ctl.submit('routines','run',{id:item.id})">运行一次</button><button :disabled="!can('get')" @click="ctl.submit('routines','get',{id:item.id})">查看记录</button><button v-if="item.lastSessionId&&ctl.supported('sessions','history')" :disabled="busy" @click="readRoutineSession(item)">查看结果</button><button :disabled="!editable||!can('delete')||item.running" @click="remove(item)">删除</button></div>
   </article>
   <form v-if="editId!==null" class="routine-form" @submit.prevent="save">
    <label>名称<input v-model="draft.title" required maxlength="120" :disabled="busy"/></label><label>工作指令<textarea v-model="draft.prompt" required rows="4" maxlength="24000" :disabled="busy"/></label>
    <label>执行频率<select v-model="draft.intervalMinutes" :disabled="busy"><option v-for="interval in intervals" :key="interval.value" :value="interval.value">{{interval.label}}</option></select></label><label class="inline"><input v-model="draft.enabled" type="checkbox" :disabled="busy"/>保存后开启</label>
    <div class="toolbar"><button type="button" :disabled="busy" @click="editId=null">关闭</button><button type="submit" :disabled="!editable||!can(editId?'update':'create')">保存到 DSH</button></div>
   </form>
   <details v-if="data?.item?.history?.length"><summary>原生运行记录</summary><article v-for="item in data.item.history" :key="item.attemptId"><p>{{statusLabel(item.status)}} · {{localTime(item.startedAt)}}<template v-if="item.finishedAt"> → {{localTime(item.finishedAt)}}</template></p><small v-if="item.sessionId">结果会话：{{item.sessionId}}</small><p v-if="item.error" class="error">{{item.error}}</p></article></details>
   <section v-if="historySessionId&&sessionMessages.length" class="routine-results" aria-label="例行工作结果"><h4>例行工作结果</h4><article v-for="(message,index) in sessionMessages" :key="index"><p v-if="message.text">{{message.text}}</p><img v-for="(image,imageIndex) in message.images" :key="imageIndex" :src="`data:${image.mimeType};base64,${image.data}`" alt="例行工作生成的图片"/></article></section>
  </template>
  <template v-else-if="section==='files'">
   <div class="toolbar"><button :disabled="!can('list')||!folders" @click="browse(parent)">上一级</button><span :title="folders">{{folders||'工作目录'}}</span></div>
   <div v-if="data?.files" class="files"><button v-for="item in data.files" :key="item.path" class="file" :title="item.name" :disabled="!can(item.isDir?'list':'preview')" @click="openFile(item)"><span aria-hidden="true">{{item.isDir?'▱':'▤'}}</span><span>{{fileLabel(item.name)}}</span><small v-if="!item.isDir">{{item.size}} B</small></button></div>
   <article v-if="preview" class="file-preview"><strong :title="preview.path">{{preview.path}}</strong><pre>{{preview.content}}</pre></article>
  </template>
  <pre v-else-if="section==='logs'&&data?.lines" class="logs">{{data.lines.join('\n')}}</pre>
  <small v-if="descriptor?.application">{{dshNativeApplicationLabel(descriptor.application)}}</small>
 </section>
</template>

<style scoped>
.dsh-workspace{min-width:0;font-size:13px;color:#3f374d}.dsh-workspace header,.routine-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.dsh-workspace h3{font-size:16px;margin:0 0 8px}.dsh-workspace p{line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere}.dsh-workspace header p,.dsh-workspace small,.empty{color:#8a8095}.dsh-workspace button{border:0;border-radius:7px;min-height:34px;background:#f4f0f9;color:#6f558a;padding:7px 12px;font:inherit;cursor:pointer}.dsh-workspace button:hover:not(:disabled){background:#eae2f4}.dsh-workspace button:disabled{opacity:.5;cursor:default}.toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:12px 0}.routine{padding:18px 0;box-shadow:inset 0 -.5px #e7e0ee}.routine-heading span{font-size:11px;color:#8a8095}.routine-form{display:grid;gap:14px;padding:18px;background:#faf8fd;border-radius:13px}.routine-form label{display:grid;gap:7px}.routine-form .inline{display:flex;align-items:center}.routine-form input:not([type=checkbox]),.routine-form textarea,.routine-form select{box-sizing:border-box;min-width:0;width:100%;border:0;box-shadow:inset 0 0 0 .5px #dcd4e8;padding:8px 10px;border-radius:7px;background:white;font:inherit;min-height:34px}.files{display:grid}.file{display:flex;gap:8px;align-items:center;width:100%;text-align:left;background:transparent!important}.file:hover{background:#f4f0f9!important}.file span:nth-child(2){min-width:0;overflow-wrap:anywhere}.file small{margin-left:auto;white-space:nowrap}.file-preview{margin-top:16px}.file-preview strong{overflow-wrap:anywhere}.file-preview pre,.logs{white-space:pre-wrap;overflow-wrap:anywhere;max-height:460px;overflow:auto;background:#faf8fd;border-radius:9px;padding:14px;font:12px/1.7 Consolas,monospace}.routine-results{margin-top:16px;padding:14px;background:#faf8fd;border-radius:9px}.routine-results h4{margin:0 0 10px}.routine-results article+article{margin-top:14px;padding-top:14px;box-shadow:inset 0 .5px #e7e0ee}.routine-results img{display:block;max-width:100%;max-height:420px;margin-top:8px;border-radius:8px}.error{color:#a45564}.empty{padding:12px 0}@media(max-width:700px){.dsh-workspace header,.routine-heading{flex-direction:column}}@media(pointer:coarse){.dsh-workspace button{min-height:36px}}
</style>
