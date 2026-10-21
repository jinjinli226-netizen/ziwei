const object=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const integer=value=>Number.isSafeInteger(value)&&value>=1;
const uncertain=run=>{
  if(run?.status==='uncertain'||run?.status==='expired'&&run?.acked_at)return true;
  let value=run;
  for(let depth=0;object(value)&&depth<10;depth++,value=value.result)if(value.code==='EXECUTION_UNCERTAIN'||value.executionState==='uncertain')return true;
  return false;
};

// Only the server's separate, verified disposition is presentation authority.
// Result flags and progress events cannot turn an unknown execution into an end.
function read(value,expected={}){
  const receipt=value?.receipt,subject=receipt?.subject;
  if(!object(value)||!['awaiting_client','client_archived'].includes(value.state)||receipt?.schemaVersion!==1||receipt.kind!=='bot.failed_execution_finalization'||!hex(receipt.id)||!hex(value.receiptDigest)||receipt.status!=='failed'||receipt.executionState!=='uncertain'||receipt.executionConfirmedStopped!==false||receipt.partialEffectsPossible!==true||!['failed_automatically','abandoned_by_user'].includes(receipt.disposition)||!integer(receipt.expectedRevision)||!integer(receipt.expectedControlEpoch)||receipt.resultingControlEpoch!==receipt.expectedControlEpoch+1||!object(subject))return null;
  if(!['actionId','employeeId','deviceId','profile','workspace'].every(key=>typeof subject[key]==='string'&&subject[key].length>0)||Object.entries(expected).some(([key,item])=>item!==undefined&&subject[key]!==item))return null;
  if(value.state==='client_archived'){
    const acknowledgement=value.acknowledgement,ack=acknowledgement?.ack;
    if(acknowledgement?.deviceId!==subject.deviceId||ack?.receiptId!==receipt.id||ack.receiptDigest!==value.receiptDigest||!hex(ack.archiveSha256)||!['no_live_instance','terminated_exact_instance','unobservable'].includes(ack.localProcessDisposition))return null;
  }
  return value;
}
export function failureFinalization(run){
  if(!run?.id||run.status!=='failed')return null;
  return read(run.failureFinalization,{actionId:run.id,employeeId:run.payload?.employeeId,deviceId:run.payload?.deviceId,profile:run.payload?.profile});
}
export function pendingBotFailureFinalization(bot){
  if(!bot?.id)return null;
  const expected={employeeId:bot.id,workspace:bot.workspace,deviceId:bot.employee?.target_device_id,profile:bot.employee?.runtime_profile},latest=failureFinalization(bot.latest_run);
  const value=read(bot.failureFinalization,expected)||(latest&&read(latest,expected));
  return value?.state==='awaiting_client'?value:null;
}
export function finalizationPresentation(value,{offline=false}={}){
  if(!value)return null;
  const pending=value.state==='awaiting_client';
  return{pending,busy:false,retryable:false,tone:'error',summary:pending?(offline?'失败，等待电脑连接':'失败，正在自动收尾'):'失败 · 已结束本次执行',label:pending?(offline?'本轮已失败，电脑连接后自动收尾':'本轮已失败，正在由原电脑自动收尾'):'本轮已按失败结束',detail:pending?'系统会在原电脑结束本轮并归档，不会自动重跑；原始失败回执已保留。':'原电脑已归档本轮失败，原始回执已保留。原业务结果仍未确认，不会自动重跑。'};
}
export function failureFinalizationRequest(bot,run){
  if(!bot?.id||!run?.id||bot.active_action_id!==run.id||run.status!=='failed'||!run.acked_at||!run.completed_at||!uncertain(run)||failureFinalization(run)||!integer(bot.revision)||!integer(bot.control_epoch))return null;
  const payload=run.payload;
  if(payload?.runtime!=='Hermes'||payload.employeeId!==bot.id||payload.deviceId!==bot.employee?.target_device_id||payload.profile!==bot.employee?.runtime_profile)return null;
  return{expectedActionId:run.id,expectedRevision:bot.revision,expectedControlEpoch:bot.control_epoch,acknowledgeUncertain:true,idempotencyKey:`bot-failure-finalize-${run.id}-r${bot.revision}-e${bot.control_epoch}`};
}
