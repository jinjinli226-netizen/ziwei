<script setup>
import {computed,onBeforeUnmount,ref,watch} from 'vue';
import {dshProviderRows,dshModelOptions,dshProviderForm,dshProviderInput,dshDiscoveryInput,dshDefaultModelInput,dshSelectionKey,dshSelectionText,dshCredentialRef,DSH_PROVIDER_PROTOCOLS} from '../dsh-models.js';
import {dshNativeApplicationLabel} from '../dsh-native.js';

const props=defineProps({controller:{type:Object,required:true},conversationController:Object,secureAvailable:Boolean,secureAction:Object,secureBusy:Boolean});
const emit=defineEmits(['secure']);
const choice=ref(''),form=ref(null),editingId=ref(''),keyOnly=ref(false),error=ref(''),notice=ref('');
const s=computed(()=>props.controller.state),data=computed(()=>props.controller.resource('providers')?.data),rows=computed(()=>dshProviderRows(data.value)),options=computed(()=>dshModelOptions(data.value));
const busy=computed(()=>props.secureBusy||s.value.loading||s.value.submitting||Boolean(s.value.request)||Boolean(s.value.value?.pending?.length));
const canConfigure=computed(()=>props.controller.editable('providers')&&data.value?.settings?.writable===true&&props.controller.supported('providers','upsert'));
const canDefault=computed(()=>canConfigure.value&&props.controller.supported('models','setDefault')&&Number.isSafeInteger(data.value?.settings?.namespaces?.find(row=>row.ns==='agent-default-model')?.revision));
const sessionBusy=computed(()=>{const state=props.conversationController?.state;return state?.loading||state?.submitting||Boolean(state?.request)||Boolean(state?.value?.pending?.length);});
const sessionObservation=computed(()=>props.conversationController?.resource('sessions')?.status==='observed'?'sessions':'providers');
const canSession=computed(()=>props.conversationController?.supported('models','selectSession')&&props.conversationController.editable(sessionObservation.value)&&Boolean(props.conversationController.state.value?.scope?.nativeSessionId));
const sessionModels=computed(()=>props.conversationController?.resource('sessions')?.data?.projections?.values?.modelSelection||props.conversationController?.resource('models')?.data?.projections?.values?.modelSelection);
const sessionReceipt=computed(()=>{const action=props.conversationController?.state.action;return action?.payload?.dshOperation?.resource==='models'&&action.payload.dshOperation.operation==='selectSession'?action.result?.dshNative:null;});
const scopeKey=computed(()=>JSON.stringify([s.value.subject?.actorId,s.value.subject?.workspace,s.value.subject?.employeeId,s.value.value?.subjectHash]));
function closeEditor(){if(form.value)form.value.secret='';form.value=null;editingId.value='';keyOnly.value=false;}
function openEditor(row=null,credentialOnly=false){closeEditor();error.value='';notice.value='';editingId.value=row?.id||'';keyOnly.value=credentialOnly;form.value=dshProviderForm(row,data.value);}
function chosen(){const option=options.value.find(row=>row.key===choice.value);if(!option)throw Error('请先选择原生目录中的模型。');return option.selection;}
async function saveDefault(){error.value='';try{await props.controller.submit('models','setDefault',dshDefaultModelInput(chosen(),data.value),{observedResource:'providers'});}catch(failure){error.value=failure.message;}}
async function applySession(){error.value='';try{await props.conversationController.submit('models','selectSession',chosen(),{observedResource:sessionObservation.value});}catch(failure){error.value=failure.message;}}
async function saveProvider(){
  error.value='';notice.value='';
  try{
    const secret=form.value.secret.trim(),row=rows.value.find(row=>row.id===editingId.value);
    if(keyOnly.value){
      if(!props.secureAvailable||!row?.credentialWritable||!secret)throw Error('请在安全通道可用时输入要更新的凭据。');
      emit('secure',{kind:'credential',providerId:row.id,ref:row.ref,secret});form.value.secret='';notice.value='凭据已交给安全通道，等待原生回执；尚未确认保存。';return;
    }
    const input=dshProviderInput(form.value,data.value,{editingId:editingId.value});
    if(secret){
      if(!props.secureAvailable)throw Error('当前安全通道尚未就绪，请保留现有凭据。');
      const ref=input.credentialRef||dshCredentialRef(input.provider);
      emit('secure',{kind:'provider',ref,secret,mutation:{resource:'providers',operation:'upsert',input:{...input,credentialRef:ref},options:{observedResource:'providers'}}});form.value.secret='';notice.value='Provider 与凭据变更已交给安全通道，等待分别核实。';
    }else await props.controller.submit('providers','upsert',input);
  }catch(failure){error.value=failure.message;}
}
async function discover(){
  error.value='';
  try{
    const input=dshDiscoveryInput(form.value,{editingId:editingId.value}),secret=form.value.secret.trim();
    if(secret){
      if(!props.secureAvailable||!props.controller.supported('providers','discoverModelsSecure'))throw Error('当前安全通道不支持携新凭据发现模型。');
      emit('secure',{kind:'discover-models',secret,resource:'providers',operation:'discoverModelsSecure',input});form.value.secret='';notice.value='模型发现已交给安全通道，等待原生候选列表；尚未保存 Provider。';return;
    }
    await props.controller.submit('providers','discoverModels',input);
  }catch(failure){error.value=failure.message;}
}
async function removeProvider(row){
  if(!row.removable||!window.confirm(`移除此 Bot 的 Provider「${row.name}」配置？已保存凭据会保留。`))return;
  await props.controller.submit('providers','remove',{provider:row.id,expectedRevision:row.namespace.revision});
}
watch(scopeKey,()=>{closeEditor();choice.value='';error.value='';notice.value='';});
watch(options,value=>{
  if(value.some(row=>row.key===choice.value))return;
  const selected=data.value?.modelCatalog?.default,model=data.value?.modelCatalog?.groups?.find(group=>group.id===selected?.provider)?.models?.find(model=>model.id===selected?.model);
  const initial=selected?{...selected,...(!selected.reasoningEffort&&model?.reasoning?.defaultEffort?{reasoningEffort:model.reasoning.defaultEffort}:{})}:null;
  choice.value=value.find(row=>initial&&row.key===dshSelectionKey(initial))?.key||value[0]?.key||'';
},{immediate:true});
function acceptDiscovery(action){
  const receipt=action?.result?.dshNative;if(!form.value||JSON.stringify(action?.payload?.dshOperation?.subject)!==JSON.stringify(s.value.value?.subject)||receipt?.resource!=='providers'||!['discoverModels','discoverModelsSecure'].includes(receipt.operation)||receipt.status!=='observed'||!Array.isArray(receipt.data))return;
  form.value.models=JSON.stringify(receipt.data.map(({inputModalities,...model})=>({...model,...(inputModalities?{input:inputModalities}:{})})),null,2);
  notice.value=`已取得 ${receipt.data.length} 个候选模型；保存 Provider 后才会采用。`;
}
watch(()=>s.value.action,acceptDiscovery);
watch(()=>props.secureAction,acceptDiscovery);
onBeforeUnmount(closeEditor);
</script>

<template>
  <section class="dsh-models-panel" aria-label="DSH 模型与 Provider" :aria-busy="busy">
    <header class="models-heading"><div><h3>模型与 Provider</h3><p>配置来自当前 Bot 的 DSH 原生目录。凭据只显示安全状态。</p></div><div class="models-actions"><button type="button" class="models-button" :disabled="busy" @click="controller.load()">回读状态</button><button type="button" class="models-button" :disabled="busy||!controller.supported('state','refresh')" @click="controller.refresh(['providers','settings'])">同步模型与 Provider</button></div></header>
    <p v-if="s.error||error" class="models-notice error" role="alert">{{error||s.error}}</p><p v-if="notice||s.notice" class="models-notice" role="status">{{notice||s.notice}}</p>
    <div v-if="s.request" class="models-pending"><p>原请求 {{s.request.actionId||'回执待确认'}} · {{s.request.resource}} / {{s.request.operation}}</p><button type="button" class="models-button" :disabled="s.loading||s.submitting" @click="controller.readAction()">查询原请求</button></div>
    <p v-if="!data" class="models-empty">尚无可编辑的原生 Provider 观察。请同步，并核对运行电脑与客户端支持。</p>
    <template v-else>
      <dl class="models-summary"><div><dt>此 Bot 默认</dt><dd>{{dshSelectionText(data.modelCatalog?.default)}}</dd></div><div><dt>会话最近使用</dt><dd>{{dshSelectionText(sessionModels?.lastUsed)}}</dd></div><div><dt>会话下一轮</dt><dd>{{sessionModels?.next?dshSelectionText(sessionModels.next):'尚无原生会话选择记录'}}</dd></div></dl>
      <div class="models-selection"><label>原生模型<select v-model="choice" aria-label="选择 DSH 原生模型" :disabled="busy||!options.length"><option value="" disabled>选择可用模型</option><option v-for="option in options" :key="option.key" :value="option.key">{{option.label}}</option></select></label><div class="models-actions"><button type="button" class="models-button" :disabled="!choice||!canDefault" @click="saveDefault">保存 Bot 默认模型</button><button type="button" class="models-button" :disabled="!choice||!canSession||sessionBusy" @click="applySession">当前会话下一轮使用，并设为默认</button></div><p>Bot 默认只影响默认选择。会话操作会由原生同时尝试更新下一轮与默认值，分别以回执核实。</p><p v-if="!conversationController?.state.value?.scope?.nativeSessionId">当前没有已绑定的原生会话，不能切换会话下一轮模型。</p></div>
      <div v-if="sessionReceipt" class="models-notice" role="status"><strong>{{dshNativeApplicationLabel(sessionReceipt.status)}}</strong><p v-for="(value,name) in sessionReceipt.data?.layers||{}" :key="name">{{({selected:'原生选择返回',next:'会话下一轮',default:'Bot 默认'})[name]||name}}：{{value==='confirmed'?'已核实':'尚未核实'}}</p></div>
      <p v-if="conversationController?.state.error" class="models-notice error" role="alert">{{conversationController.state.error}}</p>
      <div class="models-section-heading"><h4>Provider</h4><button type="button" class="models-button" :disabled="!canConfigure" @click="openEditor()">添加 Provider</button></div>
      <div class="models-providers"><article v-for="row in rows" :key="row.id" class="models-provider"><div><strong>{{row.name}}</strong><small>{{row.id}} · {{row.registered?'运行时已注册':'尚未注册'}} · {{row.account?'使用 DSH 账号':row.ref?(row.credential?.configured?'凭据已配置':'尚未配置凭据'):'使用原生鉴权'}}</small><small v-if="row.profile?.baseURL">{{row.profile.baseURL}}</small></div><div class="models-actions"><button v-if="row.editable" type="button" class="models-button" :disabled="!canConfigure" @click="openEditor(row)">编辑</button><button v-if="row.credentialWritable" type="button" class="models-button" :disabled="busy||!secureAvailable" @click="openEditor(row,true)">更新凭据</button><button v-if="row.removable" type="button" class="models-button danger" :disabled="busy||!controller.editable('providers')||!controller.supported('providers','remove')" @click="removeProvider(row)">移除</button></div></article></div>
      <form v-if="form" class="models-editor" aria-label="Provider 编辑器" @submit.prevent="saveProvider">
        <h4>{{keyOnly?'更新安全凭据':editingId?'编辑 Provider':'添加 Provider'}}</h4><label>Provider ID<input v-model="form.provider" aria-label="Provider ID" :disabled="busy||Boolean(editingId)" maxlength="240"/></label>
        <template v-if="!keyOnly"><label>接口协议<select v-model="form.api" aria-label="Provider 接口协议" :disabled="busy"><option v-for="protocol in DSH_PROVIDER_PROTOCOLS" :key="protocol" :value="protocol">{{protocol}}</option></select></label><label>API 地址<input v-model="form.baseURL" aria-label="Provider API 地址" :disabled="busy" placeholder="https://api.example.com/v1"/></label><label>模型定义 JSON<textarea v-model="form.models" aria-label="Provider 模型定义" :disabled="busy" rows="5" spellcheck="false" placeholder='[{"id":"your-model-id"}]'/></label><button type="button" class="models-button" :disabled="busy||(form.secret?(!secureAvailable||!controller.supported('providers','discoverModelsSecure')):!controller.supported('providers','discoverModels'))" @click="discover">获取模型列表</button><p>未输入新密钥时，模型发现使用已保存的原生凭据；新密钥只经过安全通道。此处填写明确协议与模型列表。</p></template>
        <label>API Key<input v-model="form.secret" type="password" aria-label="Provider API Key" autocomplete="new-password" :disabled="busy||!secureAvailable" placeholder="留空保留已保存凭据"/></label><p>{{secureAvailable?'新密钥仅交给安全通道，原生不会读回。':'安全通道尚未就绪，当前不接受新密钥。'}}</p><div class="models-actions"><button type="button" class="models-button" :disabled="busy" @click="closeEditor">取消</button><button type="submit" class="models-button primary" :disabled="busy||(!keyOnly&&!canConfigure)||(keyOnly&&!secureAvailable)">{{keyOnly?'提交安全凭据':'保存 Provider'}}</button></div>
      </form>
    </template>
  </section>
</template>

<style scoped>
.dsh-models-panel{min-width:0;font-size:12px;color:var(--bot-ink,#403747)}.models-heading,.models-section-heading,.models-provider{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}.models-heading h3{font-size:18px;margin:0 0 8px}.models-heading p,.models-selection p,.models-editor p{color:var(--bot-muted,#81738c);line-height:1.8;margin:6px 0}.models-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.models-button{display:inline-flex;align-items:center;justify-content:center;min-height:34px;padding:6px 10px;border:0;border-radius:7px;background:#f2eff7;color:#665879;font:inherit;cursor:pointer}.models-button:hover{background:#eae4f3}.models-button.primary{background:#7655c7;color:#fff}.models-button.danger{color:#a55266}.models-button:disabled{opacity:.48;cursor:default}.models-button:focus-visible{outline:2px solid #a88af0;outline-offset:3px}.models-notice,.models-pending{padding:10px 12px;margin:12px 0;background:#f5f2fa;border-radius:7px;color:#79658c;line-height:1.8;overflow-wrap:anywhere}.models-notice.error{background:#fff3f3;color:#9a5866}.models-pending{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}.models-summary{display:grid;gap:12px;margin:20px 0;padding:16px 0;border-block:1px solid #eee9f2}.models-summary>div{display:grid;grid-template-columns:100px minmax(0,1fr);gap:10px}.models-summary dt{color:#968ba0}.models-summary dd{margin:0;overflow-wrap:anywhere}.models-selection{display:grid;gap:10px}.models-selection label,.models-editor label{display:grid;gap:7px;min-width:0}.models-selection select,.models-editor input,.models-editor select,.models-editor textarea{width:100%;min-width:0;box-sizing:border-box;font:inherit}.models-section-heading{align-items:center;margin:24px 0 10px}.models-section-heading h4{font-size:14px;margin:0}.models-providers{border-block:1px solid #eee9f2}.models-provider{padding:14px 0;border-bottom:1px solid #f0edf5;flex-wrap:wrap}.models-provider:last-child{border-bottom:0}.models-provider>div:first-child{min-width:0;flex:1 1 180px;overflow-wrap:anywhere}.models-provider strong{font-size:13px}.models-provider small{display:block;color:#968ba0;margin-top:5px;line-height:1.6}.models-editor{display:grid;gap:12px;padding:18px 0;margin-top:18px;border-top:1px solid #eee9f2}.models-editor h4{margin:0}.models-editor textarea{resize:vertical}.models-empty{padding:20px 0;color:#91849d;line-height:1.8}@media(max-width:760px){.models-heading{display:block}.models-heading>.models-actions{margin-top:12px}.models-summary>div{grid-template-columns:1fr;gap:4px}.models-button{min-height:36px}}@media(pointer:coarse){.models-button{min-height:36px}}
</style>
