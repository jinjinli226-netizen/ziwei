import {historicalPrelaunchRecovery,HISTORICAL_PRELAUNCH_RECOVERY_DETAIL} from './historical-prelaunch-recovery.mjs';
import {operatorForceAbandonRecovery,OPERATOR_FORCE_ABANDON_DETAIL} from './operator-force-abandon-recovery.mjs';
import {failureFinalization,pendingBotFailureFinalization,finalizationPresentation} from './bot-failure-finalization.mjs';
export {executionProcessActive} from '../../src/bot-execution-state.mjs';
export function executionUncertain(run) {
  if(operatorForceAbandonRecovery(run))return false;
  if(historicalPrelaunchRecovery(run))return false;
  return run?.result?.code==='EXECUTION_UNCERTAIN' || run?.code==='EXECUTION_UNCERTAIN' || run?.result?.executionState==='uncertain' || run?.executionState==='uncertain' || run?.status==='uncertain' || (run?.status==='expired'&&Boolean(run?.acked_at));
}
export function processExitConfirmed(result) {
  const proof=result?.processExit || result?.result?.processExit;
  return !executionUncertain({result}) && !executionUncertain({result:result?.result}) && proof?.rootConfirmed===true && proof.treeConfirmed===true && proof.activeProcesses===0;
}
export function botRecoveryEvent(run) {
  if(!run?.id || !executionUncertain(run)||failureFinalization(run))return null;
  return [...(run.events || [])].reverse().find(event=>event.id && ['succeeded','failed'].includes(event.type) && !event.data?.result?.fixture && processExitConfirmed(event.data?.result)) || null;
}
export function botRecoveryDetail(run) {
  const finalization=finalizationPresentation(failureFinalization(run));
  if(finalization)return finalization.detail;
  if(operatorForceAbandonRecovery(run))return OPERATOR_FORCE_ABANDON_DETAIL;
  if(historicalPrelaunchRecovery(run))return HISTORICAL_PRELAUNCH_RECOVERY_DETAIL;
  return botRecoveryEvent(run)?'服务器已保存终态与进程退出证据，可恢复原回执。':'本轮已失败，原始回执已保留，不会自动重跑。';
}
export function botStopPresentation(bot,run=bot?.latest_run) {
  const finalization=finalizationPresentation(failureFinalization(run),{offline:bot?.device?.status==='offline'});
  if(finalization)return {confirmed:false,ended:!finalization.pending,ending:finalization.pending,label:finalization.detail,tone:'error'};
  if(operatorForceAbandonRecovery(run))return {confirmed:false,abandoned:true,label:OPERATOR_FORCE_ABANDON_DETAIL,tone:'muted'};
  if(historicalPrelaunchRecovery(run))return {confirmed:false,ended:true,notStarted:true,label:HISTORICAL_PRELAUNCH_RECOVERY_DETAIL,tone:'muted'};
  if(['failed','cancelled'].includes(run?.status) && (run.result?.stopConfirmed===true || run.result?.result?.stopConfirmed===true) && !executionUncertain(run) && processExitConfirmed(run.result))return {confirmed:true,label:'原执行已停止，根进程与进程树退出均已确认。',tone:'success'};
  if(['succeeded','failed','cancelled'].includes(run?.status) && !executionUncertain(run) && processExitConfirmed(run.result))return {confirmed:false,ended:true,label:'原执行已结束，根进程与进程树退出均已确认。',tone:'muted'};
  if(run?.result?.code==='BOT_CANCELLED_BEFORE_START' && !run.acked_at)return {confirmed:false,label:'本次执行尚未启动，已取消派发。',tone:'muted'};
  const stop=bot?.stop_action;
  if(stop?.payload?.actionId===run?.id && stop?.id){
    if(['pending','acked'].includes(stop.status))return {confirmed:false,label:'停止请求已下发，尚未确认原执行的进程树退出。',tone:'warning'};
    return {confirmed:false,label:'停止请求已有回执，但原执行的退出证据尚未确认。请检查原电脑上的执行进程。',tone:'warning'};
  }
  const paused=bot?.control_state==='paused';
  return {confirmed:false,label:run?`${paused?'Bot 已暂停；':''}服务器未返回本次执行的停止请求或退出确认。请检查原电脑上的执行进程。`:paused?'Bot 已暂停，当前没有可停止的执行。':'服务器尚未返回可核实的停止状态。',tone:run||!paused?'warning':'muted'};
}
export function botPresence(bot) {
  const run=bot?.latest_run;
  const finalization=finalizationPresentation(failureFinalization(run)||(!run?pendingBotFailureFinalization(bot):null),{offline:bot?.device?.status==='offline'});
  if(finalization)return {label:finalization.summary,tone:finalization.tone,detail:finalization.detail};
  if(bot?.configuration_state==='uninitialized')return {label:bot.kind==='creator'?'Creator · 管理伙伴':'Bot 能力待初始化',tone:'muted',detail:bot.kind==='creator'?'Creator 沿用原管理身份与记忆。':'这是团队管理中的同一位员工；初始化只增加 Bot 配置，不创建第二位员工。'};
  if(operatorForceAbandonRecovery(run))return {label:bot?.control_state==='paused'?'已暂停 · 旧记录已放弃':'旧记录已放弃',tone:'muted',detail:OPERATOR_FORCE_ABANDON_DETAIL};
  if(historicalPrelaunchRecovery(run))return {label:bot?.control_state==='paused'?'已暂停 · 原模型未启动':'原模型未启动',tone:'muted',detail:HISTORICAL_PRELAUNCH_RECOVERY_DETAIL};
  if (executionUncertain(run)) return {label:'上次执行失败',tone:'error',detail:botRecoveryDetail(run)};
  if (botStopPresentation(bot,run).confirmed)return {label:'原执行已停止',tone:'muted',detail:botStopPresentation(bot,run).label};
  if (run?.type==='hermes.bot.validate') {
    if(['pending','acked'].includes(run.status))return {label:'配置检查中',tone:'running',detail:'无模型配置检查正在等待本机回执。'};
    if(run.status==='failed')return {label:'配置检查失败',tone:'error',detail:run.error || '查看检查回执，修正配置后再检查。'};
    return {label:bot?.control_state==='active'?'已启用 · 待命':bot?.control_state==='paused'?'已暂停':'待启用',tone:'muted',detail:bot?.control_state==='active'?'可以在主聊天交任务。':'配置检查已通过，启用后即可交任务。'};
  }
  if (['pending','acked','running','queued'].includes(run?.status)) return {label:run.status==='pending'||run.status==='queued'?'等待执行':'正在执行',tone:'running',detail:bot?.control_state==='paused'?'Bot 已暂停，当前执行仍需等待结束或停止确认。':'展开活动查看本次执行。'};
  if (bot?.control_state==='paused') return {label:'已暂停',tone:'muted',detail:'暂停后不派发新工作。'};
  if (bot?.control_state==='draft') return {label:'待配置启用',tone:'muted',detail:'保存后检查配置，再明确启用。'};
  if (run?.status==='failed'||run?.status==='expired') return {label:'上次执行失败',tone:'error',detail:run.error || '查看运行记录了解原因。'};
  if (run?.status==='succeeded') return {label:'上次已完成',tone:'success',detail:'可以查看结果或继续交任务。'};
  return {label:bot?.control_state==='active'?'已启用 · 待命':'状态待确认',tone:'muted',detail:bot?.control_state==='active'?'在主聊天开始工作。':'请刷新状态。'};
}
export function capabilityPresentation(capability) {
  const states={ready:['可用','success'],enabled:['已开启','success'],disabled:['未开启','muted'],needs_configuration:['需要配置','warning'],needs_check:['待检查','warning'],checking:['检查中','running'],offline:['电脑离线','warning'],failed:['检查失败','error'],unavailable:['暂不可用','muted']};
  if(capability?.state){const [label,tone]=states[capability.state]||['状态待确认','muted'];return {label,tone};}
  const map={available:['已接入','success'],requires_configuration:['需要配置','warning'],requires_dependency:['缺少依赖','warning'],unsupported_version:['版本不支持','muted'],not_integrated:['尚未接入','muted'],unknown:['待验证','muted']};
  const [label,tone]=map[capability?.status] || ['未知状态','muted'];
  return {label,tone};
}

