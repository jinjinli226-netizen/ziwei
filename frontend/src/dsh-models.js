// Provider/model projection follows DSH ui/providers.js; writes use its native bridge contract.
export const DSH_PROVIDER_PROTOCOLS=['openai-completions','openai-responses','anthropic-messages'];
const at=(value,path=[])=>path.reduce((parent,name)=>parent?.[name],value);
export const dshCredentialRef=id=>id.toUpperCase().replace(/[^A-Z0-9]+/g,'_')+'_API_KEY';
export const dshSelectionKey=selection=>JSON.stringify({provider:selection.provider,model:selection.model,...(selection.reasoningEffort?{reasoningEffort:selection.reasoningEffort}:{})});
export const dshSelectionText=selection=>selection?`${selection.provider} / ${selection.model}${selection.reasoningEffort?' · '+selection.reasoningEffort:''}`:'尚无原生记录';

export function dshProviderRows(data){
  const registered=data?.providers||[],directory=[...(data?.directory||[])],settings=data?.settings;
  for(const provider of registered)if(!directory.some(row=>row.provider===provider.id))directory.push({provider:provider.id,displayName:provider.name,settingsNs:'',settingsPath:[]});
  return directory.flatMap(entry=>{
    const namespace=settings?.namespaces?.find(row=>row.ns===entry.settingsNs),profile=at(namespace?.value,entry.settingsPath),isRegistered=registered.some(row=>row.id===entry.provider);
    if(!profile&&!isRegistered)return[];
    const ref=typeof profile?.apiKeyEnv==='string'?profile.apiKeyEnv:null,credential=ref?data.credentials?.[ref]:null,account=entry.provider==='deepseek-account';
    return[{id:entry.provider,name:entry.displayName||entry.provider,entry,namespace,profile,ref,credential,registered:isRegistered,account,editable:settings?.writable===true&&entry.settingsNs==='llm-pi-ai'&&Number.isSafeInteger(namespace?.revision),credentialWritable:!account&&Boolean(ref)&&credential?.writable===true,removable:settings?.writable===true&&entry.settingsNs==='llm-pi-ai'&&at(namespace?.user,entry.settingsPath)!==undefined&&at(namespace?.base,entry.settingsPath)===undefined}];
  });
}
export function dshModelOptions(data){
  return(data?.modelCatalog?.groups||[]).flatMap(group=>(group.models||[]).flatMap(model=>{
    const efforts=model.reasoning?.efforts||[];
    return(efforts.length?efforts:[null]).map(effort=>{const selection={provider:group.id,model:model.id,...(effort?{reasoningEffort:effort.id}:{})};return{key:dshSelectionKey(selection),selection,label:`${group.name||group.id} / ${model.name||model.id}${effort?' · '+(effort.name||effort.id):''}`};});
  }));
}
export function dshProviderForm(row,data){
  const models=row?.profile?.models||data?.modelCatalog?.groups?.find(group=>group.id===row?.id)?.models||[];
  return{provider:row?.id||'',api:row?.profile?.api||DSH_PROVIDER_PROTOCOLS[0],baseURL:row?.profile?.baseURL||row?.entry.defaultBaseURL||'',models:models.length?JSON.stringify(models,null,2):'',secret:''};
}
function providerAddress(value){
  let endpoint;try{endpoint=new URL(value.trim());}catch{throw Error('请输入完整的 HTTP 或 HTTPS API 地址。');}
  if(!['http:','https:'].includes(endpoint.protocol)||endpoint.username||endpoint.password||[...endpoint.searchParams.keys()].some(name=>/^(?:api[_-]?key|token|secret|password)$/i.test(name)))throw Error('API 地址不能包含账号或密钥，凭据请使用安全通道。');
  return value.trim();
}
export function dshDiscoveryInput(form,{editingId=''}={}){
  if(!DSH_PROVIDER_PROTOCOLS.includes(form.api))throw Error('请选择原生支持的接口协议。');
  return{...(editingId?{provider:editingId}:{}),api:form.api,baseURL:providerAddress(form.baseURL)};
}
export function dshProviderInput(form,data,{editingId=''}={}){
  const provider=form.provider.trim(),rows=dshProviderRows(data),row=editingId?rows.find(row=>row.id===editingId):null;
  if(!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(provider))throw Error('Provider ID 需使用小写字母、数字与连字符。');
  if(editingId&&(!row?.editable||provider!==editingId)||!editingId&&rows.some(row=>row.id===provider))throw Error('此 Provider 不可在当前表单修改，或 ID 已存在。');
  const namespace=row?.namespace||data.settings?.namespaces?.find(row=>row.ns==='llm-pi-ai');
  if(data.settings?.writable!==true||!Number.isSafeInteger(namespace?.revision))throw Error('尚无可编辑的原生 Provider 配置版本。');
  if(!DSH_PROVIDER_PROTOCOLS.includes(form.api))throw Error('请选择原生支持的接口协议。');
  const baseURL=providerAddress(form.baseURL);
  let models;try{models=JSON.parse(form.models);}catch{throw Error('模型定义必须是有效 JSON 数组。');}
  if(!Array.isArray(models)||!models.length||models.some(model=>typeof model?.id!=='string'||!model.id.trim()))throw Error('请填写至少一个真实模型 ID。');
  return{provider,expectedRevision:namespace.revision,api:form.api,baseURL,models,...(row?.ref?{credentialRef:row.ref}:{})};
}
export function dshDefaultModelInput(selection,data){
  const namespace=data?.settings?.namespaces?.find(row=>row.ns==='agent-default-model');
  if(!Number.isSafeInteger(namespace?.revision))throw Error('尚无原生默认模型配置版本。');
  return{...selection,expectedRevision:namespace.revision};
}
