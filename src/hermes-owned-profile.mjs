import fs from 'node:fs';
import path from 'node:path';
import {parse as yaml} from 'yaml';
import {ownedProfileMetadata} from './hermes-bot-runtime.mjs';
import {permittedCredentialName,botFailure} from './hermes-bot-config.mjs';
import {hermesProfileHome,hermesProfileReadiness,hermesMcpSpawnSpec,discoverInstalledRuntimes} from './runtime-adapters.mjs';
import {spawnSupervisedRuntime} from './runtime-process.mjs';
import {successfulProfileExit,ownedProfileProofMatches} from './hermes-profile-proof.mjs';

function endpoint(value){
  if(value===undefined)return undefined;
  const url=new URL(value);if(url.username||url.password||url.search||url.hash||!['http:','https:'].includes(url.protocol))throw botFailure('BOT_PROFILE_TEMPLATE_INVALID','初始化 provider URL 不允许携带认证或查询参数');
  return value;
}

export function finalizeOwnedProfileProvision({context,baseHome,receipt,processExit}){
  if(!successfulProfileExit(processExit)||!['succeeded','failed'].includes(receipt?.status)||receipt.status==='succeeded'&&!ownedProfileProofMatches(context,receipt.botProvision,processExit))return{status:'failed',code:'EXECUTION_UNCERTAIN',executionState:'uncertain',error:'Profile 创建终态未确认；请查询原动作，不要另建实例',result:{code:'EXECUTION_UNCERTAIN',processExit}};
  if(receipt.status!=='succeeded')return{status:'failed',code:receipt.code || 'BOT_PROFILE_PROVISION_FAILED',error:receipt.code || 'BOT_PROFILE_PROVISION_FAILED',result:{processExit}};
  // The requested provider can differ from the template provider. Resolve the
  // newly published config and its verified source credential reference.
  const readiness=hermesProfileReadiness(context.instance.profile,{baseHome});
  return{status:'succeeded',result:{botProvision:{...receipt.botProvision,authentication:readiness.ready?'configured':'required'},processExit}};
}

/** Device-local, bounded native layout creation; source auth is never copied. */
export async function provisionHermesBotProfile({context,baseHome,workspace,apiBase,beforeSpawn,signal,onSupervision,binary,env={}}={}){
  if(context?.workspace!==workspace||context.instance?.mode!=='owned_profile')throw botFailure('BOT_PROFILE_IDENTITY_INVALID','Profile 创建缺少受信 Bot 身份');
  const source=hermesProfileHome(context.instance.templateProfile,{baseHome}),metadata=ownedProfileMetadata({context,sourceHome:source,apiBase});
  const sourceMetadata=path.join(source,'ziwei-instance.json');
  if(fs.existsSync(sourceMetadata)&&JSON.parse(fs.readFileSync(sourceMetadata,'utf8')).mode==='owned_profile')throw botFailure('BOT_PROFILE_TEMPLATE_UNSUPPORTED','另一个 owned Bot 不能作为初始化来源');
  const original=yaml(fs.readFileSync(path.join(source,'config.yaml'),'utf8'));
  const provider=context.config.provider || original.model?.provider || original.provider,model=context.model || original.model?.default;
  if(!provider||!model)throw botFailure('BOT_PROVIDER_REQUIRED','初始化来源缺少模型/provider');
  const custom=original.providers?.[provider.replace(/^custom:/,'')];
  if(custom&&!permittedCredentialName(custom.key_env))throw botFailure('BOT_PROFILE_TEMPLATE_INVALID','初始化自定义 provider 需要安全的外部 key_env');
  const baseUrl=endpoint(custom?.base_url || (provider===original.model?.provider?original.model?.base_url:undefined));
  const apiMode=custom?.api_mode || (provider===original.model?.provider?original.model?.api_mode:undefined);
  const seedConfig={model:{provider,default:model,...(baseUrl?{base_url:baseUrl}:{}),...(apiMode?{api_mode:apiMode}:{})},
    ...(custom?{providers:{[provider.replace(/^custom:/,'')]:{key_env:custom.key_env,...(baseUrl?{base_url:baseUrl}:{}),...(apiMode?{api_mode:apiMode}:{}),...(Number.isFinite(custom.context_length)?{context_length:custom.context_length}:{}),discover_models:false}}}:{}),
    ...(original.models_dev?.url?{models_dev:{url:endpoint(original.models_dev.url)}}:{}),
    updates:{check:false},mcp_servers:{},plugins:{enabled:[],disabled:[]},platform_toolsets:{cli:[]},agent:{disabled_toolsets:['all'],bot_mode_protocol:false,...(context.config.reasoningEffort?{reasoning_effort:context.config.reasoningEffort}:{})},security:{allow_lazy_installs:false}};
  const childEnv={...process.env,...env,HERMES_HOME:baseHome,ZIWEI_BOT_PROFILE_MODE:'owned_profile',PYTHONDONTWRITEBYTECODE:'1',PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'};
  for(const key of Object.keys(childEnv))if(key.startsWith('ZIWEI_')&&key!=='ZIWEI_BOT_PROFILE_MODE'||key.startsWith('CONTROL_MCP_'))delete childEnv[key];
  const launcher=binary || discoverInstalledRuntimes().runtimes.Hermes?.binary;
  if(!launcher)throw botFailure('BOT_RUNTIME_UNAVAILABLE','目标电脑未发现 Hermes');
  const spec=hermesMcpSpawnSpec(launcher,[],{env:childEnv});spec.args.splice(spec.modeInsertIndex??5,0,'--owned-profile-provision');
  if(beforeSpawn)await beforeSpawn();
  if(signal?.aborted)throw signal.reason;
  const supervision=spawnSupervisedRuntime({...spec,env:childEnv}),{child}=supervision;onSupervision?.(supervision);
  const abort=()=>void supervision.stop();signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,60000);let output='';child.on('error',()=>{});
  child.stdout.on('data',data=>{output+=String(data);if(output.length>1024*1024)abort();});child.stderr.on('data',()=>{});
  child.stdin.end(JSON.stringify({context,metadata,seedConfig,authentication:'required'})+'\n');
  let processExit;try{processExit=await supervision.completionEvidence;}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  let receipt;try{receipt=JSON.parse(output.split(/\r?\n/).find(line=>line.startsWith('ZIWEI_BOT_PROVISION:')).slice('ZIWEI_BOT_PROVISION:'.length));}catch{}
  return finalizeOwnedProfileProvision({context,baseHome,receipt,processExit});
}
