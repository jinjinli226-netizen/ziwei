export function executionUncertain(run) {
  return run?.result?.code==='EXECUTION_UNCERTAIN' || run?.code==='EXECUTION_UNCERTAIN' || run?.result?.executionState==='uncertain' || run?.executionState==='uncertain' || run?.status==='uncertain' || (run?.status==='expired'&&Boolean(run?.acked_at));
}
export function botPresence(bot) {
  const run=bot?.latest_run;
  if(bot?.configuration_state==='uninitialized')return {label:bot.kind==='creator'?'Creator · 管理伙伴':'Bot 能力待初始化',tone:'muted',detail:bot.kind==='creator'?'Creator 沿用原管理身份与记忆。':'这是团队管理中的同一位员工；初始化只增加 Bot 配置，不创建第二位员工。'};
  if (executionUncertain(run)) return {label:'执行待核实',tone:'warning',detail:'尚未确认执行结果或所属进程已退出；请核实原执行，勿重复派发。'};
  if (run?.type==='hermes.bot.validate') {
    if(['pending','acked'].includes(run.status))return {label:'配置检查中',tone:'running',detail:'无模型配置检查正在等待本机回执。'};
    if(run.status==='failed')return {label:'配置检查失败',tone:'error',detail:run.error || '查看检查回执，修正配置后再检查。'};
    return {label:bot?.control_state==='active'?'已启用 · 待命':bot?.control_state==='paused'?'已暂停':'待启用',tone:'muted',detail:'配置检查与实际工作分开；尚需实际执行验证模型和工具。'};
  }
  if (['pending','acked','running','queued'].includes(run?.status)) return {label:run.status==='pending'||run.status==='queued'?'等待执行':'正在执行',tone:'running',detail:bot?.control_state==='paused'?'Bot 已暂停，当前执行仍需等待结束或停止确认。':'展开活动查看本次执行。'};
  if (bot?.control_state==='paused') return {label:'已暂停',tone:'muted',detail:'暂停后不派发新工作。'};
  if (bot?.control_state==='draft') return {label:'待配置启用',tone:'muted',detail:'保存后检查配置，再明确启用。'};
  if (run?.status==='failed'||run?.status==='expired') return {label:'上次执行失败',tone:'error',detail:run.error || '查看运行记录了解原因。'};
  if (run?.status==='succeeded') return {label:'上次已完成',tone:'success',detail:'上次工作已有成功回执；设备在线情况单独显示。'};
  return {label:bot?.control_state==='active'?'已启用 · 待命':'状态待确认',tone:'muted',detail:'待命不代表模型正在运行；执行需要指定电脑及客户端在线。'};
}
export function capabilityPresentation(capability) {
  const map={available:['已接入','success'],requires_configuration:['需要配置','warning'],requires_dependency:['缺少依赖','warning'],unsupported_version:['版本不支持','muted'],not_integrated:['尚未接入','muted'],unknown:['待验证','muted']};
  const [label,tone]=map[capability?.status] || ['未知状态','muted'];
  return {label,tone};
}

