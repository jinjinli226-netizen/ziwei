const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const canonical=value=>JSON.stringify(value,(_key,item)=>object(item)?Object.fromEntries(Object.entries(item).filter(([,value])=>value!==undefined).sort(([a],[b])=>a.localeCompare(b))):item);
const same=(left,right)=>canonical(left)===canonical(right);
const at=(value,path)=>path.reduce((parent,key)=>parent?.[key],value);
const hasAt=(value,path)=>path.length?Object.hasOwn(at(value,path.slice(0,-1))||{},path.at(-1)):value!==undefined;
const fail=(code,details)=>{throw Object.assign(new Error(code),{code,details});};
const protocols=['openai-completions','openai-responses','anthropic-messages'];
const empty=value=>value===null||value==='';

export async function updateDshNativeProvider({operation,input,before,rpc,refreshProviders}={}){
 let writeAccepted=false,writeSent=false;
 const failure=(code,details,status='failed')=>({status,reasonCode:code==='settings/conflict'?'DSH_NATIVE_PROVIDER_CONFLICT':status==='unknown'?'DSH_NATIVE_PROVIDER_OUTCOME_UNKNOWN':code,data:{provider:input?.provider,writeAccepted,error:{code,...details?{details}:{}}}});
 try{
  if(!['upsert','remove'].includes(operation))fail('DSH_NATIVE_OPERATION_UNSUPPORTED');
  if(typeof input?.provider!=='string'||!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(input.provider)||typeof rpc!=='function')fail('DSH_NATIVE_PROVIDER_INPUT_INVALID');
  assertPlainInput(input);
  const entry=before.directory.find(row=>row.provider===input.provider),registered=before.providers.some(row=>row.id===input.provider);
  if(entry?.settingsNs!=='llm-pi-ai'&&(entry||registered))fail('DSH_NATIVE_PROVIDER_READ_ONLY');
  const namespace=before.settings.namespaces.find(item=>item.ns==='llm-pi-ai');
  if(!before.settings.writable||!namespace)fail('DSH_NATIVE_SETTINGS_READ_ONLY');
  if(namespace.revision!==input.expectedRevision)return failure('settings/conflict',{ns:namespace.ns,expected:input.expectedRevision,actual:namespace.revision},'unknown');
  const providerPath=entry?.settingsPath||['providers',input.provider],profile=at(namespace.value,providerPath),isNew=!entry;
  const edits=[];
  if(operation==='remove'){
   if(!entry||!hasAt(namespace.user,providerPath)||hasAt(namespace.base,providerPath))fail('DSH_NATIVE_PROVIDER_NOT_REMOVABLE');
   edits.push({op:'unset',path:providerPath});
  }else{
   if(isNew&&(!protocols.includes(input.api)||typeof input.baseURL!=='string'||!input.baseURL.trim()||!validModels(input.models)))fail('DSH_NATIVE_PROVIDER_REQUIRED_FIELDS');
   for(const field of ['api','baseURL','models','credentialRef']){
    if(!Object.hasOwn(input,field))continue;
    const value=input[field],clear=empty(value)||(field==='models'&&Array.isArray(value)&&value.length===0),key=field==='credentialRef'?'apiKeyEnv':field,path=[...providerPath,key];
    if(clear){
     if(field==='credentialRef')fail('DSH_NATIVE_PROVIDER_INPUT_INVALID');
     if(field==='models'&&entry?.declared)fail('DSH_NATIVE_PROVIDER_MODELS_REQUIRED');
     if(hasAt(namespace.user,path))edits.push({op:'unset',path});
     continue;
    }
    if(field==='api'&&!protocols.includes(value)||field==='models'&&!validModels(value)||field==='credentialRef'&&(typeof value!=='string'||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)))fail('DSH_NATIVE_PROVIDER_INPUT_INVALID');
    if(field==='baseURL')assertEndpoint(value);
    if(isNew||!same(profile?.[key],value))edits.push({op:'set',path,value});
   }
  }
  if(!edits.length)return observed('observed',before);
  writeSent=true;
  await rpc('settings/mutate',{ns:namespace.ns,ops:edits,expectedRevision:input.expectedRevision});writeAccepted=true;
  const after=await(refreshProviders?refreshProviders():refresh(rpc)),saved=after.settings.namespaces.find(item=>item.ns===namespace.ns);
  const confirmed=saved&&saved.revision!==namespace.revision&&edits.every(edit=>edit.op==='unset'?!hasAt(saved.user,edit.path):same(at(saved.value,edit.path),edit.value));
  return observed(confirmed?'applied':'unknown',after);
 }catch(error){
  const code=typeof error.code==='string'&&/^(?:DSH_[A-Z0-9_]+|settings\/[a-z-]+|gateway\/[a-z-]+)$/.test(error.code)?error.code:'DSH_NATIVE_PROVIDER_OUTCOME_UNKNOWN';
  const details=object(error.details)?Object.fromEntries(Object.entries(error.details).filter(([key,value])=>key==='ns'&&typeof value==='string'||['expected','actual','expectedRevision','actualRevision'].includes(key)&&Number.isSafeInteger(value))):undefined;
  return failure(code,details,writeSent||code==='settings/conflict'?'unknown':'failed');
 }
}

function observed(status,data){return{status,data,observations:{providers:{status:'observed',data},settings:{status:'observed',data:data.settings}}};}
function validModels(value){return Array.isArray(value)&&value.length>0&&value.every(model=>object(model)&&typeof model.id==='string'&&!!model.id.trim());}
function assertEndpoint(value){
 let url;try{url=new URL(value);}catch{fail('DSH_NATIVE_PROVIDER_INPUT_INVALID');}
 if(!['http:','https:'].includes(url.protocol))fail('DSH_NATIVE_PROVIDER_INPUT_INVALID');
 if(url.username||url.password)fail('DSH_SECURE_INPUT_REQUIRED');
}
function assertPlainInput(value){
 if(Array.isArray(value)){value.forEach(assertPlainInput);return;}
 if(object(value))for(const [key,item]of Object.entries(value)){if(/^(?:api[_-]?key|token|password|passwd|secrets?|credentials?|client[_-]?secret|auth|authorization|cookie|headers|private[_-]?key|access[_-]?token|refresh[_-]?token)$/i.test(key))fail('DSH_SECURE_INPUT_REQUIRED');assertPlainInput(item);}
}
async function refresh(rpc){
 const[settings,providers,directory,modelCatalog]=await Promise.all([rpc('settings/describe',{}),rpc('llm/listProviders',{}),rpc('llm/listConfigurableProviders',{}),rpc('session/modelCatalog',{})]);
 const refs=[...new Set(directory.flatMap(entry=>{const namespace=settings.namespaces.find(item=>item.ns===entry.settingsNs),ref=at(namespace?.value,entry.settingsPath)?.apiKeyEnv;return typeof ref==='string'?[ref]:[];}))],credentials={};
 for(let offset=0;offset<refs.length;offset+=64)Object.assign(credentials,await rpc('credentials/describe',{refs:refs.slice(offset,offset+64)}));
 return{settings,providers,directory,modelCatalog,credentials};
}
