import {BOT_REASONING_EFFORTS} from './hermes-bot-config.mjs';

export function botReasoningProof(value,context,{provider=context.config?.provider || 'openai-codex',model=context.model}={}){
  const requested=context.config?.reasoningEffort;
  if(!requested||value?.schemaVersion!==1||value.employeeId!==context.employeeId||value.revision!==context.revision
    ||value.provider!==provider||value.model!==model||value.requested!==requested||value.effective!==requested
    ||!['matched','mismatch','unsupported'].includes(value.status)||!['preflight','conversion','request'].includes(value.phase)
    ||value.evidence!=='native_codex_transport'||value.actual!==null&&!BOT_REASONING_EFFORTS.includes(value.actual)
    ||value.status==='matched'&&(value.actual!==requested||value.actualModel!==undefined&&value.actualModel!==model)
    ||value.mode!==undefined&&!['native','verified_gpt61_sol_max'].includes(value.mode)
    ||value.mode==='verified_gpt61_sol_max'&&(requested!=='max'||provider!=='openai-codex'||model!=='gpt-6.1-sol')
    ||value.nativeActual!==undefined&&value.nativeActual!==null&&!BOT_REASONING_EFFORTS.includes(value.nativeActual))return null;
  return Object.fromEntries(['schemaVersion','employeeId','revision','provider','model','requested','effective','actual','status','phase','evidence','actualModel','nativeActual','mode'].filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));
}

export function parseBotReasoningProof(line,context,binding){
  if(!line.startsWith('ZIWEI_BOT_REASONING:'))return null;
  try{return botReasoningProof(JSON.parse(line.slice('ZIWEI_BOT_REASONING:'.length)),context,binding);}catch{return null;}
}
