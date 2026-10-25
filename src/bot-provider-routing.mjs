const fail=(code,message)=>{throw Object.assign(new Error(message),{code,status:400});};
export const DEEPSEEK_MODELS=Object.freeze(['deepseek-flash','deepseek-v4-pro']);
export function normalizeBotBaseUrl(value){
  if(value===undefined||value===null||value==='')return null;
  if(typeof value!=='string'||value.length>2048||/[\s\0]|\$\{|[?#]/.test(value))fail('BOT_PROVIDER_URL_INVALID','API Base URL 必须为不含密钥或参数的 HTTPS 地址');
  let url;try{url=new URL(value);}catch{fail('BOT_PROVIDER_URL_INVALID','API Base URL 无效');}
  if(url.protocol!=='https:'||url.username||url.password)fail('BOT_PROVIDER_URL_INVALID','API Base URL 必须为不含凭据的 HTTPS 地址');
  return value.replace(/\/+$/,'');
}
export function resolveBotProviderRoute(config={},requestedModel,source={},independent=false){
  const original=source.model?.provider||source.provider;
  const provider=config.provider||original;
  const switched=Boolean(config.provider&&config.provider!==original);
  if(switched&&!requestedModel)fail('BOT_PROVIDER_MODEL_REQUIRED','切换服务商后请选择该服务商的模型');
  const model=requestedModel||source.model?.default;
  if(!provider||typeof model!=='string'||!model)fail('BOT_PROVIDER_REQUIRED','Bot 需要明确模型和服务商');
  if(provider==='deepseek'&&(config.provider||independent)){
    if(!/^deepseek-[a-z0-9._-]{1,120}$/.test(model))fail('BOT_PROVIDER_MODEL_CONFLICT','DeepSeek 服务商需要 DeepSeek 模型');
    if(config.reasoningEffort)fail('BOT_PROVIDER_REASONING_UNSUPPORTED','当前 Hermes 接线尚未验证 DeepSeek 推理等级，请使用模型默认值');
    if(config.baseUrl&&normalizeBotBaseUrl(config.baseUrl)!=='https://api.deepseek.com')fail('BOT_PROVIDER_URL_INVALID','DeepSeek 官方服务使用 https://api.deepseek.com；代理服务请选择自定义服务商');
    return{provider,model,endpoint:'https://api.deepseek.com',apiMode:'chat_completions'};
  }
  if(['openai','openai-codex'].includes(provider)&&/^(claude|deepseek)-/i.test(model)||provider==='anthropic'&&/^(gpt|o[1-9]|deepseek)[-.]/i.test(model))fail('BOT_PROVIDER_MODEL_CONFLICT','模型名称与所选服务商不匹配');
  const custom=source.providers?.[provider.replace(/^custom:/,'')];
  const defaults={openai:'https://api.openai.com/v1',anthropic:'https://api.anthropic.com',openrouter:'https://openrouter.ai/api/v1'};
  if(independent){
    const endpoint=normalizeBotBaseUrl(config.baseUrl)||defaults[provider];
    if(!endpoint)fail('BOT_PROVIDER_URL_REQUIRED','独立密钥的自定义服务需要明确保存 API Base URL');
    return{provider,model,endpoint,apiMode:custom?.api_mode||null};
  }
  return{provider,model,endpoint:normalizeBotBaseUrl(config.baseUrl)||custom?.base_url||(provider===original?source.model?.base_url:null)||((switched||independent)?defaults[provider]:null)||null,apiMode:custom?.api_mode||(provider===original?source.model?.api_mode:null)};
}
