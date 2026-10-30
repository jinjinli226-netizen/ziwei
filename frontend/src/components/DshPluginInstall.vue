<script setup>
import {computed,ref,watch} from 'vue';
import {nativeApplication} from '../dsh-native-plugins.js';
const props=defineProps({source:Object,inspection:Object,attempt:Object,busy:Boolean,controlBusy:Boolean,editable:Boolean,canOperate:{type:Function,default:()=>false}});
const emit=defineEmits(['inspect','action']);
const spec=ref(''),registry=ref(''),enabled=ref(true),replacement=ref(false),approved=ref([]);
watch(()=>props.source,source=>{spec.value=source?.spec||'';registry.value=source?.registry||'';replacement.value=false;},{immediate:true});
watch(()=>props.attempt?.data?.receipt?.pendingBuilds,rows=>{approved.value=approved.value.filter(name=>(rows||[]).includes(name));});
watch(()=>props.attempt?.enabled,value=>{if(typeof value==='boolean')enabled.value=value;},{immediate:true});
const sourceMatches=computed(()=>props.inspection?.input.spec===spec.value.trim()&&(props.inspection.input.registry||'')===registry.value.trim());
const accepted=computed(()=>sourceMatches.value&&props.inspection.data.status==='accepted'&&props.inspection.data.bundle!==false);
const unresolved=computed(()=>props.attempt&&!['applied','restart-required','overridden','failed','cancelled'].includes(props.attempt.status));
const installId=computed(()=>props.attempt?.data?.installActionId||props.attempt?.actionId);
const pendingBuilds=computed(()=>props.attempt?.data?.receipt?.pendingBuilds||[]);
const canInspect=computed(()=>!props.busy&&!unresolved.value&&props.editable&&props.canOperate('inspectSource'));
const canInstall=computed(()=>accepted.value&&!props.attempt&&!props.busy&&props.editable&&props.canOperate('installBundle')&&(!props.source?.replaceName||replacement.value));
const status=computed(()=>props.attempt?.data?.nativeCancellation?'取消请求已返回，原安装最终结果仍未确认。':props.attempt?nativeApplication(props.attempt.status):props.busy?'正在核实原生状态，尚无可展示的安装回执。':'尚无当前安装任务回执。先检查原生来源，再确认安装。');
function inspect(){if(!canInspect.value||!spec.value.trim())return;emit('inspect',{spec:spec.value.trim(),...(registry.value.trim()?{registry:registry.value.trim()}:{})});}
function install(){if(canInstall.value)emit('action',{operation:'installBundle',input:{sourceActionId:props.inspection.actionId,enabled:enabled.value,...(props.source?.replaceName?{replaceName:props.source.replaceName}:{})}});}
function control(operation){if(installId.value&&!props.controlBusy&&props.canOperate(operation))emit('action',{operation,input:{sourceActionId:installId.value}});}
function toggleBuild(name,checked){approved.value=checked?[...approved.value,name]:approved.value.filter(item=>item!==name);}
function approveBuilds(){if(!props.busy&&props.editable&&props.canOperate('installBundle')&&approved.value.length&&approved.value.every(name=>pendingBuilds.value.includes(name)))emit('action',{operation:'installBundle',input:{sourceActionId:installId.value,enabled:enabled.value,approvedBuilds:[...approved.value]}});}
</script>
<template>
  <section class="dshp-install" aria-label="DSH 插件安装">
    <h4>安装插件</h4><p class="dshp-help">支持原生接受的包名、Git、压缩包或本机来源。检查成功不等于已经安装，未知结果只查询原请求。</p>
    <div class="dshp-form"><label>插件来源<input :value="spec" aria-label="原生插件安装来源" :disabled="busy||Boolean(unresolved)" placeholder="包名@版本或本机来源" @input="spec=$event.target.value"/></label><label>npm Registry<input :value="registry" aria-label="原生插件 Registry" :disabled="busy||Boolean(unresolved)" placeholder="留空沿用原生配置" @input="registry=$event.target.value"/></label></div>
    <button type="button" class="dshp-button" :disabled="!canInspect||!spec.trim()" @click="inspect">检查插件来源</button>
    <p v-if="sourceMatches" class="dshp-help">{{inspection.data.status==='accepted'?'原生已接受来源':'原生未接受来源'}} · {{inspection.data.name||inspection.input.spec}}{{inspection.data.version?' · '+inspection.data.version:''}}{{inspection.data.kind?' · '+inspection.data.kind:''}}<span v-if="inspection.data.problem"> · {{inspection.data.problem}}</span><span v-if="inspection.data.bundle===false"> · 不是插件 bundle</span></p>
    <label class="dshp-check"><input type="checkbox" :checked="enabled" :disabled="busy||Boolean(attempt)" @change="enabled=$event.target.checked"/>安装后启用此 Bot 的插件</label>
    <label v-if="source?.replaceName" class="dshp-check"><input type="checkbox" :checked="replacement" :disabled="busy||Boolean(attempt)" @change="replacement=$event.target.checked"/>我确认先移除 {{source.replaceName}}，再安装所选版本；两步可能仅部分完成。</label>
    <div class="dshp-actions"><button type="button" class="dshp-button primary" :disabled="!canInstall" @click="install">确认安装</button><button v-if="attempt" type="button" class="dshp-button" :disabled="controlBusy||!canOperate('waitForInstall')" @click="control('waitForInstall')">查询原安装回执</button><button v-if="unresolved" type="button" class="dshp-button" :disabled="controlBusy||!canOperate('cancelInstall')" @click="control('cancelInstall')">取消原安装</button></div>
    <p class="dshp-notice" role="status">{{status}}</p>
    <p v-if="!canOperate('installBundle')" class="dshp-help">安装尚未接入当前客户端；检查、目录与已发布启动组合仍可按各自支持状态使用。</p>
    <p v-if="attempt&&(!canOperate('waitForInstall')||!canOperate('cancelInstall'))" class="dshp-help">当前管理范围尚未接入原安装查询/取消控制。请使用上方“查询原请求”继续 GET 核实；本页不会重新提交安装来代替查询。</p>
    <template v-if="attempt"><dl class="dshp-context"><div><dt>原安装</dt><dd>{{installId}}</dd></div><div v-if="attempt.data.nativePhase"><dt>原生阶段</dt><dd>{{attempt.data.nativePhase}}</dd></div></dl><p v-if="attempt.data.nativeCancellation" class="dshp-help">{{({'cancelled':'原生已处理取消/回滚，继续等待安装最终回执。','too-late':'原生已进入应用阶段（too-late），继续等待最终回执。','not-running':'原生没有进行中的安装；这不能证明原安装已结束。'})[attempt.data.nativeCancellation.status]||'取消结果待核实。'}}</p><p v-if="attempt.data.removalReceipt" class="dshp-help">旧版本移除 · {{nativeApplication(attempt.data.removalReceipt.application)}}</p><p v-if="attempt.data.receipt?.packageResult">包管理进程退出码 {{attempt.data.receipt.packageResult.exitCode??'尚未报告'}} · {{attempt.data.receipt.packageResult.kind||''}}</p><p v-if="attempt.data.receipt?.error?.code" class="dshp-error">{{attempt.data.receipt.error.code}}</p><details class="dshp-evidence"><summary>原安装日志</summary><pre class="dshp-log">{{attempt.data.log||attempt.data.receipt?.packageResult?.output||'尚无可读的原生日志。'}}</pre></details></template>
    <section v-if="pendingBuilds.length" class="dshp-confirm" aria-label="原生构建脚本审批"><h5>原生要求批准构建脚本</h5><p>仅批准下列明确勾选的包；将创建新的授权安装尝试，不重放未知安装。</p><label v-for="name in pendingBuilds" :key="name" class="dshp-check"><input type="checkbox" :checked="approved.includes(name)" :disabled="busy||!canOperate('installBundle')" @change="toggleBuild(name,$event.target.checked)"/>{{name}}</label><button type="button" class="dshp-button" :disabled="busy||!editable||!canOperate('installBundle')||!approved.length" @click="approveBuilds">批准所选构建并重试安装</button></section>
  </section>
</template>
