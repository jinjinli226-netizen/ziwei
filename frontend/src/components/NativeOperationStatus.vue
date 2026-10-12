<script setup>
import {computed} from 'vue';
import {nativeActionPresentation} from '../bot-native-data.js';
import {botTime} from '../bot-state.js';
const props=defineProps({state:{type:Object,required:true}});const emit=defineEmits(['poll','recover']);
const visibleAction=computed(()=>props.state.action||props.state.data?.action);const presentation=computed(()=>nativeActionPresentation(visibleAction.value));
const phaseLabel=computed(()=>({submitting:'正在提交',dispatched:'精确目标已派发，目标结果分别核实',unknown:'请求结果未知，原意图已保留',conflict:'版本冲突，草稿保留',staged:'已进入原生审核，尚未写入生效',readback_required:'原操作回执成功，当前状态尚未读回',requires_authorization:'需要补齐授权',requires_dependency:'需要补齐依赖'}[props.state.phase]||presentation.value.label));
</script>
<template>
  <div class="native-operation-status" :data-tone="presentation.tone" aria-live="polite">
    <p v-if="state.error" role="alert" class="native-error">{{state.error}}</p>
    <div v-if="state.phase!=='idle'||visibleAction" class="native-status-line"><strong>{{phaseLabel}}</strong><button v-if="state.pending" class="bot-link" :disabled="state.busy" @click="state.action?emit('poll'):emit('recover')">{{state.action?'查询原回执':'按原请求标识恢复'}}</button></div>
    <details v-if="visibleAction"><summary>执行证据</summary><dl><div><dt>执行</dt><dd>{{visibleAction.id}}</dd></div><div><dt>来源</dt><dd>{{presentation.source}}</dd></div><div><dt>原生版本</dt><dd>{{presentation.version||'尚未报告'}}</dd></div><div><dt>完成时间</dt><dd>{{botTime(visibleAction.completed_at)}}</dd></div></dl></details>
    <button v-if="state.phase==='readback_required'" class="bot-link" :disabled="state.loading||state.busy" @click="emit('recover')">重新读取当前状态</button>
    <p v-if="state.review" class="native-help">审核标识：{{state.review.pendingId||'原生未返回'}}。此提案尚无审核终态证据；读取文档不会自动批准它。后续手动修改按新的原生提案处理，旧审核记录仍保留。</p>
  </div>
</template>
