import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parseDocument, stringify } from 'yaml';
import { normalizeBotConfig, botFailure, permittedCredentialName } from './hermes-bot-config.mjs';

export const BOT_RUNTIME_ENV_KEYS=['ZIWEI_INSTANCE_KIND','ZIWEI_BOT_REVISION','ZIWEI_BOT_ACTION_ID','ZIWEI_BOT_DEVICE_TOKEN','ZIWEI_BOT_PROFILE_MODE','ZIWEI_BOT_REASONING_EFFORT'];
const hash=value=>createHash('sha256').update(value).digest('hex');
function noLink(file) {try{if(fs.lstatSync(file).isSymbolicLink())throw botFailure('BOT_HOME_INVALID','Bot 状态路径不能是链接');}catch(error){if(error.code!=='ENOENT')throw error;}}
function write(file,text) {noLink(file);const tmp=`${file}.${randomUUID()}.tmp`;try{fs.writeFileSync(tmp,text,{flag:'wx',mode:0o600});fs.renameSync(tmp,file);}finally{try{fs.unlinkSync(tmp);}catch{}}}
function readConfig(file) {const document=parseDocument(fs.readFileSync(file,'utf8'));const value=document.toJSON();if(document.errors.length||!value||typeof value!=='object'||Array.isArray(value))throw botFailure('BOT_SOURCE_INVALID','来源 profile config.yaml 无效');return value;}

export function ownedProfileMetadata({context,sourceHome,apiBase}) {
  const instance=context.instance;
  if(instance?.mode!=='owned_profile'||!/^bot-[a-z0-9_-]{1,58}$/.test(instance.profile || '')||! /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(instance.templateProfile || '')||! /^[A-Za-z0-9_-]{1,100}$/.test(instance.ownershipId || '')||context.sourceProfile!==instance.profile||!context.deviceId)throw botFailure('BOT_HOME_BINDING_CONFLICT','Bot 专属 Profile 身份无效');
  if(!/^action_[A-Za-z0-9_-]+$/.test(instance.provisionActionId || ''))throw botFailure('BOT_HOME_BINDING_CONFLICT','Bot 缺少原 Profile 创建动作');
  return{version:1,templateId:'ziwei-hermes-bot',key:instance.ownershipId,origin:new URL(apiBase).origin,workspace:context.workspace,employeeId:context.employeeId,sourceHome:fs.realpathSync.native(sourceHome),sourceProfile:instance.profile,mode:'owned_profile',profile:instance.profile,templateProfile:instance.templateProfile,deviceId:context.deviceId,provisionActionId:instance.provisionActionId};
}

/** Isolated native state; source OAuth stays in its one native store, never cloned. */
export function prepareHermesBotHome({context,sourceHome,privateDirectory,workspace,apiBase}={}) {
  if(!context||context.workspace!==workspace||!/^employee_[A-Za-z0-9_-]{1,100}$/.test(context.employeeId||'')||!Number.isInteger(context.revision))throw botFailure('BOT_IDENTITY_INVALID','Bot 实例身份无效');
  const url=new URL(apiBase);if(url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname)||(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname))))throw botFailure('BOT_IDENTITY_INVALID','Bot API origin 无效');
  if(!path.isAbsolute(sourceHome||'')||!path.isAbsolute(privateDirectory||''))throw botFailure('BOT_HOME_INVALID','Bot 需要本机绝对私有目录');
  const owned=context.instance?.mode==='owned_profile';
  if(owned){noLink(sourceHome);noLink(path.dirname(sourceHome));}
  let source=fs.realpathSync.native(sourceHome);
  const sourceConfig=readConfig(path.join(source,'config.yaml')),config=normalizeBotConfig(context.config);
  const provider=config.provider || sourceConfig.model?.provider || sourceConfig.provider;
  const model=context.model || sourceConfig.model?.default;
  if(typeof provider!=='string'||!provider||typeof model!=='string'||!model)throw botFailure('BOT_PROVIDER_REQUIRED','Bot 需要明确模型和服务商');
  const providerName=provider.replace(/^custom:/,'');const custom=sourceConfig.providers?.[providerName];
  const sameProvider=provider===(sourceConfig.model?.provider || sourceConfig.provider);
  const endpoint=custom?.base_url || (sameProvider?sourceConfig.model?.base_url:null);
  const apiMode=custom?.api_mode || (sameProvider?sourceConfig.model?.api_mode:null);
  if(custom && !permittedCredentialName(custom.key_env))throw botFailure('BOT_PROVIDER_UNSUPPORTED','自定义 provider 必须使用来源 profile 的外部服务 key_env 引用');
  let home,key,binding;
  if(owned){
    home=source;
    if(path.basename(home)!==context.instance.profile||path.basename(path.dirname(home))!=='profiles')throw botFailure('BOT_HOME_BINDING_CONFLICT','Bot 实际 HOME 与专属 Profile 不一致');
    const root=path.dirname(path.dirname(home)),template=context.instance.templateProfile;
    if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(template || ''))throw botFailure('BOT_HOME_BINDING_CONFLICT','Bot 初始化来源无效');
    source=fs.realpathSync.native(template==='default'?root:path.join(root,'profiles',template));
    binding=ownedProfileMetadata({context,sourceHome:source,apiBase});key=binding.key;
  }else{
    const root=path.resolve(privateDirectory);noLink(root);fs.mkdirSync(root,{recursive:true,mode:0o700});
    key=hash(JSON.stringify([url.origin,workspace,context.employeeId]));home=path.join(root,key);noLink(home);fs.mkdirSync(home,{recursive:true,mode:0o700});
    if(fs.realpathSync.native(home)===source||path.dirname(fs.realpathSync.native(home))!==fs.realpathSync.native(root))throw botFailure('BOT_HOME_INVALID','Bot HOME 必须独立于来源 profile');
    binding={version:1,templateId:'ziwei-hermes-bot',key,origin:url.origin,workspace,employeeId:context.employeeId,sourceHome:source,sourceProfile:context.sourceProfile || 'default'};
  }
  const metadata=path.join(home,'ziwei-instance.json');noLink(metadata);
  if(fs.existsSync(metadata)){if(JSON.stringify(JSON.parse(fs.readFileSync(metadata,'utf8')))!==JSON.stringify(binding))throw botFailure('BOT_HOME_BINDING_CONFLICT','Bot 来源配置已变化，需要明确迁移');}
  else {if(owned)throw botFailure('BOT_PROFILE_NOT_PROVISIONED','Bot 专属 Profile 缺少设备归属证明');if(fs.readdirSync(home).length)throw botFailure('BOT_HOME_BINDING_CONFLICT','Bot 目录已有未绑定状态');write(metadata,JSON.stringify(binding));}
  for(const relative of ['memories','memories/MEMORY.md','memories/USER.md','state.db','state.db-wal','state.db-shm','sessions','logs','SOUL.md','config.yaml','auth.json','.env','skills'])noLink(path.join(home,relative));
  if(!owned&&(fs.existsSync(path.join(home,'auth.json'))||fs.existsSync(path.join(home,'.env'))))throw botFailure('BOT_HOME_INVALID','Bot HOME 存在复制的认证文件，拒绝使用');
  const readOnly=config.permissions.mode==='read_only';
  const native={
    model:{provider,default:model,...(endpoint?{base_url:endpoint}:{}),...(apiMode?{api_mode:apiMode}:{})},
    ...(custom?{providers:{[providerName]:Object.fromEntries(['base_url','api_mode','default_model','key_env','context_length'].filter(key=>custom[key]!==undefined).map(key=>[key,custom[key]]).concat([['discover_models',false]]))}}:{}),
    fallback_providers:[],updates:{check:false},...(sourceConfig.models_dev?.url?{models_dev:{url:sourceConfig.models_dev.url}}:{}),
    agent:{max_turns:config.maxTurns,run_budget_seconds:840,bot_mode_protocol:false,coding_context:'off',disabled_toolsets:readOnly?['all']:['cronjob','delegation','kanban'],...(config.reasoningEffort?{reasoning_effort:config.reasoningEffort}:{})},
    platform_toolsets:{cli:[...config.toolsets,...(config.collaboration?.enabled&&!readOnly?['ziwei_collaboration']:[])]},
    memory:{provider:'',memory_enabled:config.memory.enabled,user_profile_enabled:config.memory.userProfile,...(config.memory.charLimit?{memory_char_limit:config.memory.charLimit}:{}),...(config.memory.userCharLimit?{user_char_limit:config.memory.userCharLimit}:{})},
    skills:{disabled:config.skills.disabled,project_discovery:false,external_dirs:[],create_dir:'',auto_load:config.skills.autoLoad || []},
    plugins:{enabled:Object.entries(config.gateway?.platforms || {}).filter(([,v])=>v.enabled).map(([name])=>`${name.replaceAll('_','-')}-platform`),disabled:[]},
    mcp_servers:readOnly?{}:Object.fromEntries(Object.entries(config.mcpServers).map(([name,{connectTimeout,...server}])=>['ziwei_external_'+name,{...server,...(connectTimeout?{connect_timeout:connectTimeout}:{})}])),
    ...(config.gateway?{gateway:{platforms:config.gateway.platforms,profile_routes:config.gateway.profileRoutes.map(route=>({...route,profile:context.employeeId}))}}:{}),
    ...Object.fromEntries(Object.entries(config.voice || {}).map(([kind,v])=>[kind,{enabled:v.enabled,provider:v.provider,[v.provider]:{...(v.model?{model:v.model}:{}),...(v.baseUrl?{base_url:v.baseUrl}:{}),...(v.keyEnv?{api_key:`\${${v.keyEnv}}`}:{}),...(v.voice?{voice:v.voice}:{}),...(v.language?{language:v.language}:{})}}])),
    approvals:{mode:readOnly?'manual':'off',single_query_mode:readOnly?'deny':'approve',unattended_mode:readOnly?'deny':'approve',cron_mode:'deny'},
    security:{allow_lazy_installs:false},kanban:{dispatch_in_gateway:false},logging:{level:'WARNING',max_size_mb:5,backup_count:5}
  };
  write(path.join(home,'config.yaml'),stringify(native));
  write(path.join(home,'SOUL.md'),[context.name,context.description,context.persona,context.instructions].filter(Boolean).join('\n\n')+'\n');
  write(path.join(home,'profile.yaml'),stringify({display_name:context.name,description:context.description || '',ui_meta:{'hermes-bots':{title:context.name}}}));
  const receipt={enabled:true,key,workspace,employeeId:context.employeeId,sourceProfile:binding.sourceProfile,authMode:'source-native-store',kind:'hermes-bot',revision:context.revision,...(owned?{mode:'owned_profile',profile:binding.profile,home,profileHome:home}:{}),...(config.reasoningEffort?{reasoning:{requested:config.reasoningEffort,actual:null,status:'configured'}}:{})};
  return {home,sourceHome:source,config:native,effectiveModel:model,provider,receipt,env:{ZIWEI_CREATOR_HOME:home,ZIWEI_CREATOR_SOURCE_HOME:source,ZIWEI_CREATOR_KEY:key,ZIWEI_CREATOR_WORKSPACE:workspace,ZIWEI_CREATOR_EMPLOYEE_ID:context.employeeId,ZIWEI_CREATOR_PROFILE:binding.sourceProfile,ZIWEI_INSTANCE_KIND:'hermes-bot',ZIWEI_BOT_REVISION:String(context.revision),...(owned?{ZIWEI_BOT_PROFILE_MODE:'owned_profile'}:{}),...(config.reasoningEffort?{ZIWEI_BOT_REASONING_EFFORT:config.reasoningEffort}:{})}};
}
