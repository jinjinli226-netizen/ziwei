const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));

export async function executeDshPlugins(action,{workspace,deviceId,baseUrl,signal,fetchImpl=globalThis.fetch,now=Date.now}={}){
  const payload=action.payload||{},operation=payload.pluginOperation,subject=operation?.subject;
  validateAction(action,payload,operation,subject,workspace,deviceId);
  const request=async(path,{method='GET',body}={})=>{
    let response,value;
    try{
      response=await fetchImpl(`${baseUrl.replace(/\/$/,'')}${path}`,{method,redirect:'error',headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(5000)]):AbortSignal.timeout(5000)});
      value=await response.json();
    }catch{fail('DSH_PLUGINS_HUB_UNAVAILABLE');}
    if(!response.ok||value?.ok===false)fail('DSH_PLUGINS_NATIVE_REQUEST_FAILED');
    return value;
  };
  const bot=encodeURIComponent(subject.profile),route=`/api/bots/${bot}/plugins`;
  if(operation.operation==='apply')await request(route,{method:'PUT',body:{enabled:operation.enabled}});
  const catalog=await request(route);
  if(!Array.isArray(catalog.plugins)||catalog.plugins.some(p=>!object(p)||typeof p.id!=='string'||typeof p.enabled!=='boolean'||typeof p.required!=='boolean'))fail('DSH_PLUGINS_CATALOG_INVALID');
  if(operation.operation==='apply'){
    const saved=catalog.plugins.filter(p=>p.enabled).map(p=>p.id);
    if(saved.length!==operation.enabled.length||saved.some(id=>!operation.enabled.includes(id)))fail('DSH_PLUGINS_SAVE_NOT_CONFIRMED');
  }
  const result={schemaVersion:1,subject,source:'dsh-native',checkedAt:new Date(now()).toISOString(),plugins:catalog.plugins.map(p=>pick(p,['id','name','description','enabled','required'])),restartRequired:catalog.restartRequired===true,notice:catalog.notice,
    runtime:{status:'unavailable',reasonCode:'DSH_RUNTIME_STATE_UNAVAILABLE'},configuration:{status:'unavailable',reasonCode:'DSH_RUNTIME_STATE_UNAVAILABLE',namespaces:[]}};
  let state;try{state=await request('/api/state');}catch{return result;}
  const current=state.bots?.find(b=>b.name===subject.profile);
  if(!current)return result;
  result.running=current?.running===true;result.ready=current?.ready===true;
  if(!result.running||!result.ready){
    result.runtime.reasonCode=result.configuration.reasonCode=result.running?'DSH_BOT_NOT_READY':'DSH_BOT_NOT_RUNNING';
    return result;
  }
  const rpc=async(method)=>{
    const rpcId=crypto.randomUUID(),value=await request(`/runtime/${bot}/api/${method}`,{method:'POST',body:{type:'client-request',rpcId,method,payload:{args:{}}}});
    if(value.type!=='server-response'||value.rpcId!==rpcId||value.result?.ok!==true)fail('DSH_PLUGINS_RPC_FAILED');
    return value.result.value;
  };
  const [bundles,inventory,settings]=await Promise.allSettled([rpc('pluginManager/listBundles'),rpc('pluginInventory/list'),rpc('settings/describe')]);
  if(bundles.status==='fulfilled'&&inventory.status==='fulfilled'&&Array.isArray(bundles.value)&&Array.isArray(inventory.value?.entries)){
    result.runtime={status:'observed',bundles:bundles.value.map(p=>({...pick(p,['name','enabled','availability','installed','optional','removable']),rows:(p.rows||[]).map(row=>pick(row,['rowId','moduleName','entryId']))})),entries:inventory.value.entries.map(entry),agentPresets:(inventory.value.agentPresets||[]).map(p=>({...pick(p,['id','isDefault']),rows:(p.rows||[]).map(entry)}))};
  }else result.runtime.reasonCode='DSH_PLUGIN_INVENTORY_UNAVAILABLE';
  if(settings.status==='fulfilled'&&Array.isArray(settings.value?.namespaces))result.configuration={status:'available',writable:settings.value.writable===true,schemaFormat:'schemastery',namespaces:settings.value.namespaces.map(ns=>({...pick(ns,['ns','revision','applies']),schema:fieldSchema(ns.schema)}))};
  else result.configuration.reasonCode='DSH_PLUGIN_SETTINGS_UNAVAILABLE';
  return result;
}

function validateAction(action,payload,operation,subject,workspace,deviceId){
  if(!object(operation)||operation.schemaVersion!==1||!object(subject)||subject.runtime!=='DSH'||subject.workspace!==workspace||payload.workspace!==workspace||subject.deviceId!==deviceId||payload.deviceId!==deviceId||subject.workspaceId!==payload.workspaceId||typeof subject.profile!=='string'||!/^[a-z0-9][a-z0-9-]{0,23}$/.test(subject.profile)||payload.runtime||payload.employeeId||payload.hermesBot)fail('DSH_PLUGINS_SUBJECT_INVALID');
  if(!['inspect','apply'].includes(operation.operation)||action.type!==`employee.plugins.${operation.operation}`||Object.keys(operation).some(key=>!['schemaVersion','subject','operation','enabled','requestedBy'].includes(key)))fail('DSH_PLUGINS_OPERATION_INVALID');
  if(operation.operation==='apply'&&(!Array.isArray(operation.enabled)||operation.enabled.length>128||operation.enabled.some(id=>typeof id!=='string'||!id||id.length>240)||new Set(operation.enabled).size!==operation.enabled.length))fail('DSH_PLUGINS_ENABLED_INVALID');
}
function entry(value){return pick(value,['entryId','moduleName','enabled','fiberPhase','patchId','rowId']);}
function fieldSchema(value){
  if(!object(value)||!object(value.refs))return {};
  return{uid:value.uid,refs:Object.fromEntries(Object.entries(value.refs).map(([id,node])=>[id,{
    ...pick(node,['type','dict','inner','list','sKey']),
    ...(node.type==='const'?{value:node.value}:{}),
    ...(object(node.meta)?{meta:pick(node.meta,['required','min','max','step','description','role'])}:{}),
  }]))};
}
