import {DEEPSEEK_MODELS} from '../../src/bot-provider-routing.mjs';

export function botProviderOptions(current=''){
  const values=[['','沿用来源 Profile（兼容模式）'],['deepseek','DeepSeek 官方'],['openai-codex','OpenAI Codex（原授权）'],['openai','OpenAI'],['anthropic','Anthropic'],['openrouter','OpenRouter']];
  if(current&&!values.some(([value])=>value===current))values.push([current,current]);
  return values.map(([value,label])=>({value,label}));
}
export function botProviderModelOptions(provider,models=[],current){
  const selected=provider==='deepseek'?DEEPSEEK_MODELS.map(id=>({id,label:id})):models.filter(model=>(!provider||!model.provider||model.provider===provider)&&!(['openai','openai-codex'].includes(provider)&&/^(claude|deepseek)-/i.test(model.id)||provider==='anthropic'&&/^(gpt|o[1-9]|deepseek)[-.]/i.test(model.id)));
  const result=[{value:'',label:provider?'请选择服务商模型':'沿用来源 Profile 模型'},...selected.map(model=>({value:model.id,label:model.label||model.id}))];
  if(current&&!result.some(item=>item.value===current))result.push({value:current,label:`${current}（当前配置）`});
  return result;
}
export function switchBotProvider(draft,provider){
  if(!draft||draft.config.provider===provider)return;
  draft.config.provider=provider||null;draft.employee.model=null;delete draft.config.baseUrl;delete draft.config.reasoningEffort;
}
export function credentialStateLabel(value){
  return{legacy:'沿用来源授权（兼容模式）',pending:'待同步到运行电脑',configured:'运行电脑已安全保存',cleared:'独立密钥已清除',binding_changed:'绑定已变化，需重新配置'}[value]||'状态待确认';
}
export function canonicalCredentialBinding(value){return JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);}
const toBytes=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const toBase64=value=>btoa(String.fromCharCode(...new Uint8Array(value)));
export async function sealBotProviderKey(value,metadata,cryptoApi=globalThis.crypto){
  if(!cryptoApi?.subtle||!metadata?.devicePublicKey||!metadata.binding)throw new Error('运行电脑尚未准备安全输入，请连接并更新客户端后重试');
  const pem=metadata.devicePublicKey.replace(/-----[^-]+-----|\s/g,'');
  const publicKey=await cryptoApi.subtle.importKey('spki',toBytes(pem),{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
  const clear=new TextEncoder().encode(value),label=new TextEncoder().encode(canonicalCredentialBinding(metadata.binding));
  if(!clear.length||clear.length>256)throw new Error('API Key 长度须为 1–256 字节');
  const key=await cryptoApi.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt']);
  const raw=new Uint8Array(await cryptoApi.subtle.exportKey('raw',key)),iv=cryptoApi.getRandomValues(new Uint8Array(12));
  try{
    const encrypted=new Uint8Array(await cryptoApi.subtle.encrypt({name:'AES-GCM',iv,additionalData:label,tagLength:128},key,clear));
    const wrappedKey=await cryptoApi.subtle.encrypt({name:'RSA-OAEP',label},publicKey,raw);
    return{wrappedKey:toBase64(wrappedKey),iv:toBase64(iv),ciphertext:toBase64(encrypted.slice(0,-16)),tag:toBase64(encrypted.slice(-16))};
  }finally{clear.fill(0);raw.fill(0);}
}
