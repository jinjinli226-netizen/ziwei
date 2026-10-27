import {BOT_REASONING_EFFORTS} from './hermes-bot-config.mjs';

const gatewayBindingFields=['profile_id','session_id','admission_id','execution_generation','authority_epoch','api_request_id'];
function validGatewayBinding(value){
  const identifier=item=>typeof item==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(item);
  return value.phase==='request'
    &&typeof value.profile_id==='string'&&value.profile_id.length>0&&value.profile_id.length<=1024&&!/[\u0000-\u001f\u007f]/.test(value.profile_id)
    &&identifier(value.session_id)&&identifier(value.admission_id)
    &&Number.isSafeInteger(value.execution_generation)&&value.execution_generation>=0
    &&Number.isSafeInteger(value.authority_epoch)&&value.authority_epoch>=0
    &&typeof value.api_request_id==='string'&&/^[a-f0-9]{32}$/.test(value.api_request_id);
}

export function botReasoningProof(value,context,{provider=context.config?.provider || 'openai-codex',model=context.model}={}){
  const requested=context.config?.reasoningEffort;
  if(!requested||value?.schemaVersion!==1||value.employeeId!==context.employeeId||value.revision!==context.revision
    ||value.provider!==provider||value.model!==model||value.requested!==requested||value.effective!==requested
    ||!['matched','mismatch','unsupported'].includes(value.status)||!['preflight','conversion','request'].includes(value.phase)
    ||!['native_codex_transport','native_gateway_sdk'].includes(value.evidence)
    ||value.evidence==='native_gateway_sdk'&&!validGatewayBinding(value)
    ||value.actual!==null&&!BOT_REASONING_EFFORTS.includes(value.actual)
    ||value.status==='matched'&&(value.actual!==requested||value.actualModel!==undefined&&value.actualModel!==model)
    ||value.mode!==undefined&&!['native','verified_gpt61_sol_max'].includes(value.mode)
    ||value.mode==='verified_gpt61_sol_max'&&(requested!=='max'||provider!=='openai-codex'||model!=='gpt-6.1-sol')
    ||value.nativeActual!==undefined&&value.nativeActual!==null&&!BOT_REASONING_EFFORTS.includes(value.nativeActual))return null;
  const fields=['schemaVersion','employeeId','revision','provider','model','requested','effective','actual','status','phase','evidence','actualModel','nativeActual','mode',...(value.evidence==='native_gateway_sdk'?gatewayBindingFields:[])];
  return Object.fromEntries(fields.filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));
}

export function parseBotReasoningProof(line,context,binding){
  if(!line.startsWith('ZIWEI_BOT_REASONING:'))return null;
  try{return botReasoningProof(JSON.parse(line.slice('ZIWEI_BOT_REASONING:'.length)),context,binding);}catch{return null;}
}
