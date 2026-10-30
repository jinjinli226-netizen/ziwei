<script setup>
import {computed,ref,watch} from 'vue';
const props=defineProps({controller:{type:Object,required:true},botController:{type:Object,required:true},messageCount:{type:Number,default:0},executionBusy:Boolean});
const emit=defineEmits(['new-conversation']);
const ctl=computed(()=>props.controller),state=computed(()=>ctl.value.state);
const busy=computed(()=>state.value.loading||state.value.submitting||Boolean(state.value.request)||Boolean(state.value.value?.pending?.length));
const sessions=computed(()=>ctl.value.resource('sessions'));
const values=computed(()=>sessions.value?.data?.projections?.values||{});
const presets=computed(()=>props.botController.resource('presets')?.data?.presets||ctl.value.resource('presets')?.data?.presets||[]);
const plan=computed(()=>ctl.value.resource('plan'));
const selected=ref(''),answers=ref({}),localError=ref('');
const requests=computed(()=>ctl.value.resource('interactions')?.status==='observed'?ctl.value.resource('interactions').data.requests||[]:[]);
const scope=computed(()=>JSON.stringify(state.value.subject));
const bound=computed(()=>Boolean(state.value.value?.scope?.nativeSessionId));
const blank=computed(()=>props.messageCount===0&&values.value.sessionListMetadata?.blank===true);
const can=(resource,operation)=>!busy.value&&ctl.value.supported(resource,operation);
watch(scope,()=>{selected.value='';answers.value={};localError.value='';});
watch(requests,list=>{const ids=new Set(list.map(item=>item.interactionId));for(const id of Object.keys(answers.value))if(!ids.has(id))delete answers.value[id];});
watch(()=>values.value.agentPreset,value=>{if(value)selected.value=value;},{immediate:true});
async function read(){await ctl.value.load();if(props.executionBusy)return ctl.value.submit('interactions','list',{});await ctl.value.refresh(['presets','sessions','plan','interactions']);}
async function changeMode(){
 if(!selected.value)return;
 if(!bound.value)return ctl.value.submit('sessions','create',{agentPreset:selected.value});
 if(blank.value)return ctl.value.submit('presets','select',{agentPreset:selected.value},{observedResource:'sessions'});
 emit('new-conversation',{agentPreset:selected.value});
}
function fields(request,question){const form=answers.value[request.interactionId]||(answers.value[request.interactionId]={});return form[question.id]||(form[question.id]={selected:question.multiSelect?[]:'',custom:''});}
async function answer(request){
 localError.value='';
 const result=request.questions.map(question=>{
  if(question.intent?.kind==='plan-review')return{id:question.id,selected:[question.intent.approve]};
  const field=fields(request,question),custom=field.custom.trim(),selected=Array.isArray(field.selected)?[...field.selected]:field.selected?[field.selected]:[];
  return{id:question.id,selected:custom&&!question.multiSelect?[]:selected,...(custom?{custom}:{})};
 });
 if(result.some(value=>!value.selected.length&&!value.custom)){localError.value='请为每个问题选择选项或填写回答。';return;}
 await ctl.value.submit('interactions','answer',{interactionId:request.interactionId,answers:result});
}
async function approve(request,decision){await ctl.value.submit('interactions','approve',{interactionId:request.interactionId,decision});}
</script>

<template>
 <details class="dsh-session-controls" @toggle="event=>{if(event.target.open&&!busy)read();}">
  <summary><span>模式与计划</span><small>{{values.agentPreset||'读取原生模式'}}<template v-if="plan?.data?.effectiveActive"> · Plan</template></small><b v-if="requests.length">{{requests.length}} 项待处理</b></summary>
  <section>
   <div class="session-heading"><strong>当前 DSH 会话</strong><button type="button" :disabled="busy||!ctl.supported(executionBusy?'interactions':'state',executionBusy?'list':'refresh')" @click="read">{{executionBusy?'读取待处理事项':'读取模式与待处理事项'}}</button></div>
   <p v-if="state.error" class="error" role="alert">{{state.error}}</p><p v-if="state.notice" role="status">{{state.notice}}</p><p v-if="state.request" class="muted">正在核对原请求。<button type="button" :disabled="state.loading||state.submitting" @click="ctl.readAction()">回读原回执</button></p>
   <label>工作模式<select v-model="selected" :disabled="busy||executionBusy"><option value="">请选择原生预设</option><option v-for="preset in presets" :key="preset.id" :value="preset.id" :disabled="Boolean(preset.broken)">{{preset.name||preset.id}}{{preset.isDefault?' · 默认':''}}</option></select></label>
   <p class="muted">{{!bound?'可先为这个空白聊天创建原生会话。':blank?'空白会话可以切换预设。':'已有内容保留原模式；更换预设会新建聊天。'}}</p>
   <div class="session-actions"><button type="button" :disabled="!selected||busy||executionBusy||(!bound&&!ctl.supported('sessions','create'))||(bound&&blank&&!ctl.supported('presets','select'))" @click="changeMode">{{!bound?'创建原生会话':blank?'应用此模式':'新建此模式聊天'}}</button><button type="button" :disabled="executionBusy||!can('plan','set')||plan?.status!=='observed'||!plan.data.available" @click="ctl.submit('plan','set',{active:!plan.data.effectiveActive})">{{plan?.data?.effectiveActive?'关闭':'开启'}} Plan</button></div>
   <p v-if="plan?.data?.projections?.values?.plan?.pending" class="muted">计划模式正在等待下一步生效。</p><p v-else-if="plan?.status==='observed'&&!plan.data.available" class="muted">当前预设没有提供 Plan。</p>
   <article v-for="request in requests" :key="request.interactionId" class="dsh-interaction">
    <template v-if="request.kind==='approval'"><strong>需要确认本次工具调用</strong><p>{{request.toolName}}</p><pre v-if="request.reason">{{typeof request.reason==='string'?request.reason:JSON.stringify(request.reason,null,2)}}</pre><div class="session-actions"><button :disabled="!can('interactions','approve')" @click="approve(request,'allowed-once')">仅本次允许</button><button :disabled="!can('interactions','approve')" @click="approve(request,'rejected')">拒绝</button></div></template>
    <form v-else @submit.prevent="answer(request)">
     <strong>{{request.questions?.some(question=>question.intent?.kind==='plan-review')?'计划待审':'员工需要补充信息'}}</strong>
     <fieldset v-for="question in request.questions" :key="question.id" :disabled="busy"><legend>{{question.header||question.question}}</legend><p v-if="question.header">{{question.question}}</p><pre v-if="question.detail">{{question.detail}}</pre>
      <template v-if="question.intent?.kind!=='plan-review'"><label v-for="option in question.options" :key="option.label" class="choice"><input v-model="fields(request,question).selected" :type="question.multiSelect?'checkbox':'radio'" :value="option.label" :name="request.interactionId+':'+question.id"/><span>{{option.label}}<small v-if="option.description">{{option.description}}</small></span></label><label>你的回答<textarea v-model="fields(request,question).custom" rows="3" maxlength="16000"/></label></template>
     </fieldset>
     <div class="session-actions"><button type="submit" :disabled="!can('interactions','answer')">{{request.questions?.some(question=>question.intent?.kind==='plan-review')?'同意执行':'提交回答'}}</button><button v-if="!request.continued" type="button" :disabled="!can('interactions','dismiss')" @click="ctl.submit('interactions','dismiss',{interactionId:request.interactionId})">{{request.questions?.some(question=>question.intent?.kind==='plan-review')?'要求修改':'取消本次提问'}}</button></div>
    </form>
   </article><p v-if="localError" role="alert" class="error">{{localError}}</p>
  </section>
 </details>
</template>

<style scoped>
.dsh-session-controls{font-size:12px;min-width:0;color:#51455f;margin:8px 0}.dsh-session-controls summary{display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 12px;background:#faf8fd;border-radius:8px;list-style:none}.dsh-session-controls summary small{color:#8b7c98}.dsh-session-controls summary b{margin-left:auto;font-size:11px;color:#7655bd}.dsh-session-controls section{padding:14px;box-shadow:inset 0 0 0 .5px #e8e0f0;border-radius:12px;margin-top:6px}.session-heading{display:flex;justify-content:space-between;align-items:center;gap:10px}.dsh-session-controls button{font:inherit;border:0;border-radius:6px;background:#f2edf8;color:#6f528b;min-height:34px;padding:6px 10px;cursor:pointer}.dsh-session-controls button:hover:not(:disabled){background:#e9dff4}.dsh-session-controls button:disabled{opacity:.5;cursor:default}.dsh-session-controls label{display:grid;gap:6px;margin:12px 0}.dsh-session-controls select,.dsh-session-controls textarea{font:inherit;width:100%;box-sizing:border-box;border:0;box-shadow:inset 0 0 0 .5px #dcd2e6;border-radius:6px;background:#fff;color:inherit;padding:8px;min-width:0}.session-actions{display:flex;flex-wrap:wrap;gap:8px}.dsh-interaction{margin:16px 0 0;padding:14px;background:#faf7fd;border-radius:10px}.dsh-interaction fieldset{margin:14px 0;padding:0;border:0;min-width:0}.dsh-interaction legend{font-weight:600;line-height:1.7}.dsh-interaction p{line-height:1.7;white-space:pre-wrap}.dsh-interaction pre{max-height:360px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.7 Consolas,monospace}.dsh-interaction .choice{display:flex;align-items:flex-start;gap:8px}.choice small{display:block;color:#8b7c98;line-height:1.6}.muted{color:#92839e;line-height:1.7}.error{color:#a65665;line-height:1.7}@media(pointer:coarse){.dsh-session-controls button{min-height:36px}}@media(max-width:700px){.session-heading{align-items:flex-start;flex-direction:column}}
</style>
