import {getDshNativeOperation,DSH_NATIVE_TYPE,DSH_NATIVE_REFRESH_RESOURCES} from './dsh-native-contract.mjs';
import {redactSecrets} from './redaction.mjs';
import {executeDshNativeSessionOperation} from './dsh-native-session-operations.mjs';
import {readDshNativeSnapshot,subscribeDshNativeEvents} from './dsh-native-streams.mjs';
import {executeDshNativeInteraction} from './dsh-native-interactions.mjs';
import {executeDshNativeGroupMetadata} from './dsh-native-groups.mjs';
import {publicDshSettings} from './dsh-native-settings.mjs';
import {updateDshNativeProvider} from './dsh-native-provider.mjs';
import {executeDshNativeGroupRun} from './dsh-native-group-run.mjs';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
const sensitiveName=name=>/^(?:api[_-]?key|access[_-]?token|token|password|secret|authorization|credential[s]?|headers)$/i.test(name);
const safeText=value=>redactSecrets(value).replace(/(https?:\/\/)[^\s/@]+@/gi,'$1[REDACTED]@');
const fail=(code,details)=>{throw Object.assign(new Error(code),{code,details});};
const errorView=error=>({code:error.code||'DSH_NATIVE_UNAVAILABLE',...(error.details?{details:error.details}:{})});
const at=(value,path)=>path.reduce((parent,key)=>parent?.[key],value);
const matchesSelection=(expected,actual)=>actual?.provider===expected.provider&&actual.model===expected.model&&(expected.reasoningEffort===undefined||actual.reasoningEffort===expected.reasoningEffort);
const credentialStates=value=>Object.fromEntries(Object.entries(value).map(([ref,state])=>[ref,pick(state,['configured','source','writable'])]));

export async function executeDshNativeOperation(action,{workspace,deviceId,baseUrl,signal,cwd,followSnapshot,interactionManager,installManager,claimSecret,devicePost,readMemberAction,onStage,WebSocketImpl,fetchImpl=globalThis.fetch,now=Date.now}={}){
 const payload=action.payload||{},op=payload.dshOperation,subject=op?.subject,scope=op?.scope;
 if(action.type!==DSH_NATIVE_TYPE||op?.schemaVersion!==1||!object(subject)||!object(scope)||!['bot','conversation','attempt','group'].includes(scope.kind)||subject.runtime!=='DSH'||subject.workspace!==workspace||payload.workspace!==workspace||subject.workspaceId!==payload.workspaceId||subject.deviceId!==deviceId||payload.deviceId!==deviceId||typeof subject.profile!=='string'||!/^[a-z0-9][a-z0-9-]{0,23}$/.test(subject.profile)||payload.runtime||payload.employeeId||payload.hermesBot)fail('DSH_NATIVE_SUBJECT_INVALID');
 const entry=getDshNativeOperation(op.resource,op.operation);
 if(!entry?.implemented)fail('DSH_NATIVE_OPERATION_UNSUPPORTED');
 if(entry.scope!=='either'&&entry.scope!==scope.kind)fail('DSH_NATIVE_SCOPE_UNSUPPORTED');
 const {resource,operation,input={}}=op,bot=encodeURIComponent(subject.profile),botPath=`/api/bots/${bot}`;
 let mutationSent=false,mutationAccepted=false;
 const result=(status,data,observed={})=>({schemaVersion:1,subject,scope,source:'dsh-native',checkedAt:new Date(now()).toISOString(),resource,operation,status,data,...Object.keys(observed).length?{observations:Object.fromEntries(Object.entries(observed).map(([name,data])=>[name,{status:'observed',data}]))}:{}});
 const request=async(path,{method='GET',body,mutation=false}={})=>{
  if(mutation)mutationSent=true;
  let response,value;
  try{
   response=await fetchImpl(`${baseUrl.replace(/\/$/,'')}${path}`,{method,redirect:'error',headers:body===undefined?undefined:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(entry.timeoutMs)]):AbortSignal.timeout(entry.timeoutMs)});
   value=await response.json();
  }catch{fail('DSH_NATIVE_TRANSPORT_UNAVAILABLE');}
  if(!response.ok||value?.ok===false)throw Object.assign(new Error('DSH_NATIVE_HTTP_FAILED'),{code:'DSH_NATIVE_HTTP_FAILED',nativeRefused:!response.ok&&response.status>=400&&response.status<500});
  if(mutation&&value.type!=='server-response')mutationAccepted=true;
  return value;
 };
 const rpc=async(method,args={},mutation=false)=>{
  const rpcId=crypto.randomUUID(),value=await request(`/runtime/${bot}/api/${method}`,{method:'POST',body:{type:'client-request',rpcId,method,payload:{args}},mutation});
  if(value.type!=='server-response'||value.rpcId!==rpcId)fail('DSH_NATIVE_RPC_INVALID');
  if(value.result?.ok!==true){const source=value.result?.error||{};throw Object.assign(new Error('DSH_NATIVE_RPC_REJECTED'),{code:typeof source.code==='string'?source.code:'DSH_NATIVE_RPC_REJECTED',nativeRefused:true,details:object(source.details)?pick(source.details,['ns','expected','actual']):undefined});}
  if(mutation)mutationAccepted=true;
  return value.result.value;
 };
 const settings=async()=>publicDshSettings(await rpc('settings/describe'));
 const plugins=async()=>{const [bundles,rows,inventory]=await Promise.all([rpc('pluginManager/listBundles'),rpc('pluginManager/listPlugins'),rpc('pluginInventory/list')]);return{bundles:bundles.map(bundleView),plugins:rows.map(pluginView),inventory:inventoryView(inventory)};};
 const botState=async()=>{const state=await request('/api/state'),current=state.bots?.find(item=>item.name===subject.profile);if(!current)fail('DSH_NATIVE_BOT_NOT_FOUND');return pick(current,['name','port','running','ready','persona','metadata','displayName','avatar','section','pinned','hidden','notify']);};
 const providers=async()=>{
  const [configuration,registered,directory,modelCatalog]=await Promise.all([settings(),rpc('llm/listProviders'),rpc('llm/listConfigurableProviders'),rpc('session/modelCatalog')]);
  const refs=[...new Set(directory.flatMap(provider=>{const ns=configuration.namespaces.find(ns=>ns.ns===provider.settingsNs),ref=at(ns?.value,provider.settingsPath)?.apiKeyEnv;return typeof ref==='string'?[ref]:[];}))];
  const credentials={};
  for(let offset=0;offset<refs.length;offset+=64)Object.assign(credentials,credentialStates(await rpc('credentials/describe',{refs:refs.slice(offset,offset+64)})));
  return{settings:configuration,providers:registered,directory,modelCatalog,credentials};
 };
 const readers={plugins,settings,providers,presets:()=>rpc('agentPresets/list'),market:async()=>({indexes:await rpc('pluginMarket/listIndexes')}),bot:botState,
  routines:async()=>({...routinesView(await request(`${botPath}/routines`)),sourceOperation:'list'}),
  files:async()=>({...pick(await request(`${botPath}/files?path=`),['path','files']),sourceOperation:'list'}),
  logs:async()=>({lines:(await request(`${botPath}/log?n=200`)).lines.map(safeText),requestedLines:200,sourceOperation:'read'}),
  groups:async()=>(await executeDshNativeGroupMetadata({...action,payload:{...payload,dshOperation:{...op,scope:{kind:'bot'},resource:'groups',operation:'list',input:{}}}},{request:(method,path)=>request(path,{method})})).data,
 };
 const mutateSettings=async(configuration,nsName,expectedRevision,ops)=>{
  const ns=requireNamespace(configuration,nsName,expectedRevision);
  assertPlainSettings(ns,ops);
  await rpc('settings/mutate',{ns:nsName,ops,expectedRevision},true);
  const readback=await settings(),saved=readback.namespaces.find(item=>item.ns===nsName);
  const confirmed=saved&&saved.revision!==ns.revision&&ops.every(edit=>edit.op==='unset'?!Object.hasOwn(at(saved.user,edit.path.slice(0,-1))||{},edit.path.at(-1)):same(at(saved.value,edit.path),edit.value));
  return{confirmed,settings:readback};
 };
 try{
  if(resource==='groups'){
   const groupRequest=(method,path,body)=>request(path,{method,body,mutation:method!=='GET'});
   const outcome=await(['send','cancel'].includes(operation)?executeDshNativeGroupRun(action,{request:groupRequest,devicePost,readMemberAction,signal,onStage,now}):executeDshNativeGroupMetadata(action,{request:groupRequest}));
   return{...result(outcome.status,outcome.data),...(outcome.observations?{observations:outcome.observations}:{}),...(outcome.reasonCode?{reasonCode:outcome.reasonCode}:{})};
  }
  if(resource==='plugins'&&['installBundle','waitForInstall','cancelInstall'].includes(operation)){
   if(!installManager)fail('DSH_NATIVE_INSTALL_UNAVAILABLE');
   const outcome=await installManager.execute(action,{rpc:(method,args)=>rpc(method,args,operation!=='waitForInstall'),signal,onStage,subscribeEvents:handler=>subscribeDshNativeEvents({baseUrl,botName:subject.profile,signal,WebSocketImpl,onEvent:handler,nextEvent:(clientId,eventId)=>rpc('$events/result',{clientId,eventId,outcome:{kind:'next'}})})});
   if(outcome.data.receipt){
    try{const observed=await plugins();return{...result(outcome.status,outcome.data,{plugins:observed}),...(outcome.reasonCode?{reasonCode:outcome.reasonCode}:{})};}
    catch(error){return{...result(outcome.status==='applied'?'unknown':outcome.status,{...outcome.data,readbackError:errorView(error)}),reasonCode:'DSH_NATIVE_INSTALL_READBACK_UNAVAILABLE'};}
   }
   return{...result(outcome.status,outcome.data),...(outcome.reasonCode?{reasonCode:outcome.reasonCode}:{})};
  }
  if(resource==='plugins'&&operation==='prepareUiHost'){
   const value=await request(`${botPath}/plugin-ui/prepare`,{method:'POST',body:{},mutation:true});
   const expectedMount=`/runtime/${subject.profile}/ui/`;
   const application=typeof value.application==='string'?value.application:'unknown';
   const valid= value.ok===true && application==='applied' && value.bridgePackage==='@dshbot/plugin-ui-host' && value.mountBase===expectedMount;
   const data={application,bridgePackage:typeof value.bridgePackage==='string'?value.bridgePackage:null,mountBase:typeof value.mountBase==='string'?value.mountBase:null,version:typeof value.version==='string'?value.version:null,...value.requestId?{requestId:value.requestId}:{},...value.receipt&&object(value.receipt)?{receipt:changeView(value.receipt)}:{},...value.error?{error:safeText(value.error)}:{}};
   const status=valid?'applied':application==='applied'?'unknown':['restart-required','overridden','failed','cancelled','unknown','unavailable'].includes(application)?application:'unknown';
   return result(status,data);
  }
  if(resource==='credentials'||operation==='mutateSecure'||operation==='discoverModelsSecure'){
   if(typeof claimSecret!=='function')fail('DSH_SECRET_CHANNEL_UNAVAILABLE');
   let secret=await claimSecret(action);
   try{
    if(resource==='credentials'){
     const before=await providers(),refs=new Set([...Object.keys(before.credentials),...before.directory.flatMap(row=>row.nativeAuth?.env||[]),...before.directory.filter(row=>row.provider!=='deepseek-account').map(row=>`${row.provider.toUpperCase().replace(/[^A-Z0-9]+/g,'_')}_API_KEY`)]);
     if(!refs.has(input.ref))fail('DSH_NATIVE_CREDENTIAL_REF_UNKNOWN');
     await rpc('credentials/set',{ref:input.ref,value:secret.value},true);
     const state=credentialStates(await rpc('credentials/describe',{refs:[input.ref]})),observed=await providers();
     return result(state[input.ref]?.configured?'applied':'unknown',{credentials:state},{providers:observed});
    }
    if(resource==='settings'){
     const configuration=await settings(),ns=requireNamespace(configuration,input.ns,input.expectedRevision);
     await rpc('settings/mutate',{ns:input.ns,expectedRevision:input.expectedRevision,ops:secret.ops},true);
     const observed=await settings(),saved=observed.namespaces.find(item=>item.ns===input.ns);
     return result(saved&&saved.revision!==ns.revision?'applied':'unknown',observed,{settings:observed});
    }
    const {secretRequestId,...metadata}=input;if(metadata.baseURL)assertPublicUrl(metadata.baseURL);
    return result('observed',await rpc('llm/discoverModels',{settingsNs:'llm-pi-ai',request:{...metadata,apiKey:secret.apiKey}}));
   }finally{secret=null;}
  }
  if(resource==='interactions'){
   const outcome=await executeDshNativeInteraction({operation,input,subject,scope,manager:interactionManager,rpc:(method,args)=>rpc(method,args,operation!=='list')});
   return{...result(outcome.status,outcome.data,operation==='list'?{interactions:outcome.data}:{}),...(outcome.reasonCode?{reasonCode:outcome.reasonCode}:{})};
  }
  if(resource==='sessions'&&operation==='create'){
   if(scope.nativeSessionId!==null)fail('DSH_NATIVE_SESSION_BINDING_CONFLICT');
   const created=await rpc('session/create',{request:{...(cwd?{cwd}:{}),...(input.agentPreset?{agentPreset:input.agentPreset}:{})}},true);
   if(typeof created?.sessionId!=='string'||!created.sessionId)fail('DSH_NATIVE_SESSION_RECEIPT_INVALID');
   const projections=await rpc('session/projections',{request:{sessionId:created.sessionId}});
   if(input.agentPreset&&projections?.values?.agentPreset!==input.agentPreset)return result('unknown',{sessionId:created.sessionId,projections});
   return result('applied',{sessionId:created.sessionId,projections},{sessions:{sessionId:created.sessionId,projections}});
  }
  if(resource!=='state'&&(scope.kind==='conversation'||resource==='sessions'&&operation==='list')){
   const outcome=await executeDshNativeSessionOperation({resource,operation,input,subject,scope,followSnapshot:followSnapshot||((args)=>readDshNativeSnapshot({baseUrl,botName:subject.profile,args,signal,WebSocketImpl})),rpc:(method,args)=>rpc(method,args,!entry.readOnly)});
   const observed=['observed','applied'].includes(outcome.status)?{[resource]:outcome.data,...outcome.data.projections?{sessions:{projections:outcome.data.projections}}:{}}:{};
   return{...result(outcome.status,outcome.data,observed),...(outcome.reasonCode?{reasonCode:outcome.reasonCode}:{})};
  }
  if(resource==='state'){
   const requested=input.resources||DSH_NATIVE_REFRESH_RESOURCES;
   for(const name of ['sessions','plan','interactions'])readers[name]=async()=>{
    if(name==='sessions'&&scope.kind==='bot')return(await executeDshNativeSessionOperation({resource:name,operation:'list',scope,rpc})).data;
    if(scope.kind!=='conversation'||!scope.nativeSessionId)fail('DSH_NATIVE_SESSION_NOT_BOUND');
    return name==='interactions'?(await executeDshNativeInteraction({operation:'list',subject,scope,rpc,manager:interactionManager})).data:(await executeDshNativeSessionOperation({resource:name,operation:name==='plan'?'capabilities':'projections',scope,rpc})).data;
   };
   const observed=await Promise.all(requested.map(async name=>{try{return[name,{status:'observed',data:await readers[name]()}];}catch(error){return[name,{status:'unavailable',error:errorView(error)}];}}));
   return result('observed',{resources:Object.fromEntries(observed)});
  }
  if(resource==='plugins'){
   if(operation==='list'){const observed=await plugins();return result('observed',observed,{plugins:observed});}
   if(operation==='registries'){const raw=await rpc('pluginManager/registries');return result('observed',{registry:raw.registry===null?null:safeText(raw.registry),fallbackRegistries:raw.fallbackRegistries.map(safeText),resolved:raw.resolved===null?null:safeText(raw.resolved)});}
   if(operation==='inspectSource'){if(input.registry)assertPublicUrl(input.registry);return result('observed',inspectionView(await rpc('pluginManager/inspect',{spec:input.spec,...Object.hasOwn(input,'registry')?{options:{registry:input.registry}}:{}})));}
   const current=await plugins();
   if(operation==='setPluginEnabled'){
    const row=current.plugins.find(row=>row.entryId===input.id);if(!row||row.readOnlyReason||!row.patchId)fail('DSH_NATIVE_PLUGIN_NOT_WRITABLE');
   }else{
    const bundle=current.bundles.find(bundle=>bundle.name===input.name);if(!bundle||bundle.readOnlyReason||operation==='removeBundle'&&!bundle.removable)fail('DSH_NATIVE_PLUGIN_NOT_WRITABLE');
   }
   const receipt=changeView(await rpc(`pluginManager/${operation}`,input,true));
   const status=['applied','restart-required','overridden','failed','cancelled'].includes(receipt.application)?receipt.application:'unknown';
   const data={receipt};
   try{data.observed=await plugins();}catch(error){data.readbackError=errorView(error);return result(status==='applied'?'unknown':status,data);}
   if(status==='applied'||status==='restart-required'){
    const row=operation==='setPluginEnabled'?data.observed.plugins.find(row=>row.entryId===input.id):data.observed.bundles.find(row=>row.name===input.name);
    if(operation==='removeBundle'?row?.installed===true:row?.enabled!==input.enabled)return result('unknown',{...data,error:{code:'DSH_NATIVE_READBACK_MISMATCH'}},{plugins:data.observed});
   }
   return result(status,data,{plugins:data.observed});
  }
  if(resource==='settings'){
   if(operation==='describe'){const observed=await settings();return result('observed',observed,{settings:observed});}
   const saved=await mutateSettings(await settings(),input.ns,input.expectedRevision,input.ops);
   return result(saved.confirmed?'applied':'unknown',saved.settings,{settings:saved.settings});
  }
  if(resource==='providers'){
   if(operation==='inspect'){const observed=await providers();return result('observed',observed,{providers:observed,settings:observed.settings});}
   if(operation==='discoverModels'){if(input.baseURL)assertPublicUrl(input.baseURL);return result('observed',await rpc('llm/discoverModels',{settingsNs:'llm-pi-ai',request:input}));}
   assertPlainValues(input);
   const outcome=await updateDshNativeProvider({operation,input,before:await providers(),rpc:(method,args)=>rpc(method,args,true),refreshProviders:providers});
   return{...result(outcome.status,outcome.data),...outcome.observations?{observations:outcome.observations}:{},...outcome.reasonCode?{reasonCode:outcome.reasonCode}:{}};
  }
  if(resource==='models'){
   const [configuration,catalog]=await Promise.all([settings(),rpc('session/modelCatalog')]);
   const model=catalog.groups.find(group=>group.id===input.provider)?.models.find(model=>model.id===input.model);
   if(!model||input.reasoningEffort&&!model.reasoning?.efforts.some(effort=>effort.id===input.reasoningEffort))fail('DSH_NATIVE_MODEL_NOT_FOUND');
   const ns=requireNamespace(configuration,'agent-default-model',input.expectedRevision),selection=pick(input,['provider','model','reasoningEffort']);
   const ops=Object.entries(selection).map(([field,value])=>({op:'set',path:[field],value}));
   if(input.reasoningEffort===undefined&&ns.value.reasoningEffort!==undefined)ops.push({op:'unset',path:['reasoningEffort']});
   await mutateSettings(configuration,ns.ns,input.expectedRevision,ops);
   const observed=await providers();return result(matchesSelection(selection,observed.modelCatalog.default)?'applied':'unknown',observed.modelCatalog,{providers:observed,settings:observed.settings});
  }
  if(resource==='market'){
   if(operation==='listIndexes'){const indexes=await rpc('pluginMarket/listIndexes');return result('observed',indexes,{market:{indexes}});}
   if(operation==='search')return result('observed',await rpc('pluginMarket/search',input));
   input.urls.forEach(assertPublicUrl);
   await rpc('pluginMarket/setIndexes',input,true);const observed=await rpc('pluginMarket/listIndexes');
   return result(same(observed.map(index=>index.url),input.urls)?'applied':'unknown',observed,{market:{indexes:observed}});
  }
  if(resource==='presets'){const observed=await rpc(`agentPresets/${operation}`,input);return result('observed',observed,operation==='list'?{presets:observed}:{});}
  if(resource==='bot'){
   if(operation==='state'){const observed=await botState();return result('observed',observed,{bot:observed});}
   if(operation==='start'||operation==='stop'){
    await request(`${botPath}/${operation}`,{method:'POST',mutation:true});
    const observed=await botState();return result(observed.running===(operation==='start')?'applied':'unknown',{accepted:true,...observed},{bot:observed});
   }
   await request(`${botPath}/${operation}`,{method:'PUT',body:input,mutation:true});
   const observed=await botState(),saved=operation==='metadata'?observed.metadata||observed:observed;
   return result(Object.entries(input).every(([key,value])=>same(saved[key],value))?'applied':'unknown',observed,{bot:observed});
  }
  if(resource==='files'){
   const route=operation==='preview'?'file':'files',value=await request(`${botPath}/${route}?path=${encodeURIComponent(input.path||'')}`);
   const observed={...pick(value,route==='file'?['path','content','size']:['path','files']),sourceOperation:operation};
   return result('observed',observed,{files:observed});
  }
  if(resource==='logs'){
   const value=await request(`${botPath}/log?n=${input.lines||200}`);
   const observed={lines:value.lines.map(safeText),requestedLines:input.lines||200,sourceOperation:operation};return result('observed',observed,{logs:observed});
  }
  if(resource==='routines'){
   const route=`${botPath}/routines`,itemPath=`${route}/${encodeURIComponent(input.id||'')}`;
   if(operation==='list'){const observed={...routinesView(await request(route)),sourceOperation:operation};return result('observed',observed,{routines:observed});}
   if(operation==='get'){const observed={item:routineView((await request(itemPath)).item),sourceOperation:operation};return result('observed',observed,{routines:observed});}
   if(operation==='delete'){
    await request(itemPath,{method:'DELETE',mutation:true});const observed=routinesView(await request(route));
    const data={...observed,deletedId:input.id,sourceOperation:operation};return result(observed.items.some(item=>item.id===input.id)?'unknown':'applied',data,{routines:data});
   }
   if(operation==='run'){
    const accepted=await request(`${itemPath}/run`,{method:'POST',body:{},mutation:true}),observed=await request(itemPath);
    const data={accepted:true,executionCompleted:false,item:routineView(accepted.item),observed:routineView(observed.item),sourceOperation:operation};return result('observed',data,{routines:{item:data.observed,sourceOperation:operation}});
   }
   const {id,...body}=input,written=await request(operation==='create'?route:itemPath,{method:operation==='create'?'POST':'PUT',body,mutation:true});
   const observed=routineView((await request(`${route}/${encodeURIComponent(written.item.id)}`)).item);
   const data={item:observed,sourceOperation:operation};return result(Object.entries(body).every(([key,value])=>same(observed[key],value))?'applied':'unknown',data,{routines:data});
  }
  fail('DSH_NATIVE_OPERATION_UNSUPPORTED');
 }catch(error){
  if(!mutationSent)throw error;
  return result(!mutationAccepted&&error.nativeRefused?'failed':'unknown',{error:errorView(error),...(mutationAccepted?{writeAccepted:true}:{})});
 }
}

function requireNamespace(configuration,name,expectedRevision){
 const namespace=configuration.namespaces.find(item=>item.ns===name);
 if(!configuration.writable||!namespace)fail('DSH_NATIVE_SETTINGS_NOT_WRITABLE');
 if(namespace.revision!==expectedRevision)fail('settings/conflict',{ns:name,expected:expectedRevision,actual:namespace.revision});
 return namespace;
}
function assertPublicUrl(value){
 let url;try{url=new URL(value);}catch{fail('DSH_NATIVE_INPUT_INVALID');}
 if(!['http:','https:'].includes(url.protocol))fail('DSH_NATIVE_INPUT_INVALID');
 if(url.username||url.password)fail('DSH_SECURE_INPUT_REQUIRED');
}
function assertPlainValues(value){
 if(Array.isArray(value)){value.forEach(assertPlainValues);return;}
 if(object(value))for(const [key,item]of Object.entries(value)){if(sensitiveName(key))fail('DSH_SECURE_INPUT_REQUIRED');assertPlainValues(item);}
}
function schemaNodes(namespace,path){
 const envelope=namespace.schema,node=ref=>object(ref)?ref:envelope.refs?.[ref];
 const visit=(ref,remaining,parents=new Set())=>{
  const value=node(ref);if(!value||parents.has(value))return[];
  const seen=new Set(parents);seen.add(value);
  if(value.meta?.role==='secret')fail('DSH_SECURE_INPUT_REQUIRED');
  if(['union','intersect'].includes(value.type))return(value.list||[]).flatMap(ref=>visit(ref,remaining,seen));
  if(value.type==='transform')return visit(value.inner,remaining,seen);
  if(!remaining.length)return[value];
  if(value.type==='object')return visit(value.dict?.[remaining[0]],remaining.slice(1),seen);
  if(value.type==='dict'||value.type==='array')return visit(value.inner,remaining.slice(1),seen);
  return[];
 };
 return visit(envelope.refs?envelope.uid:envelope,path);
}
function assertPlainSettings(namespace,ops){
 for(const edit of ops){
  if(edit.path.some(sensitiveName)||(namespace.secrets||[]).some(secret=>edit.path.every((key,i)=>secret.path[i]===key)||secret.path.every((key,i)=>edit.path[i]===key)))fail('DSH_SECURE_INPUT_REQUIRED');
  const nodes=schemaNodes(namespace,edit.path);
  if(!nodes.length)fail('DSH_NATIVE_SETTINGS_PATH_INVALID');
  if(nodes.some(node=>nodeContainsSecret(namespace.schema,node)))fail('DSH_SECURE_INPUT_REQUIRED');
  if(edit.op==='set')assertPlainValues(edit.value);
 }
}
function nodeContainsSecret(envelope,node,seen=new Set()){
 if(!object(node))node=envelope.refs?.[node];
 if(!node||seen.has(node))return false;
 seen.add(node);
 return node.meta?.role==='secret'||[...Object.values(node.dict||{}),...(node.list||[]),node.inner].some(child=>child!==undefined&&nodeContainsSecret(envelope,child,seen));
}
function changeView(value){
 const out=pick(value,['changed','application','restartReason','stage','target','enabled','bundle','version','pendingBuilds','approvedBuilds','failedAt']);
 if(value.error)out.error=pick(value.error,['code','incompatible']);
 if(value.warnings)out.warnings=value.warnings.map(safeText);
 if(value.registries)out.registries=value.registries.map(registry=>registry===null?null:safeText(registry));
 if(value.packageResult)out.packageResult={...pick(value.packageResult,['exitCode','truncated','kind','timedOut','incompatible']),output:safeText(value.packageResult.output||'')};
 return out;
}
function bundleView(value){return{...pick(value,['name','official','availability','installTarget','version','description','enabled','installed','optional','removable','readOnlyReason','overrides']),rows:(value.rows||[]).map(row=>({...pick(row,['rowId','moduleName','entryId']),...(row.meta?{meta:pick(row.meta,['title','description','icon'])}:{})})),...(value.meta?{meta:pick(value.meta,['title','description','icon'])}:{}),...(value.error?{error:pick(value.error,['code','incompatible'])}:{})};}
function pluginView(value){return{...pick(value,['entryId','moduleName','enabled','fiberPhase','patchId','readOnlyReason','rowId']),...(value.meta?{meta:pick(value.meta,['title','description','icon'])}:{})};}
function inventoryView(value){return{managementAvailable:value.managementAvailable===true,agentPresets:(value.agentPresets||[]).map(preset=>({...pick(preset,['id','name','isDefault']),rows:(preset.rows||[]).map(pluginView)})),entries:(value.entries||[]).map(pluginView)};}
function inspectionView(value){const out=pick(value,['status','kind','name','version','description','bundle','problem','host']);for(const key of ['reason','registry'])if(value[key]!==undefined)out[key]=value[key]===null?null:safeText(value[key]);if(value.registries)out.registries=value.registries.map(value=>value===null?null:safeText(value));return out;}
function routineView(value){
 const out=pick(value,['id','title','prompt','intervalMinutes','enabled','nextRun','lastRun','lastStatus','running','lastSessionId','lastAttemptId']);
 if(value.lastError!==undefined)out.lastError=value.lastError===null?null:safeText(value.lastError);
 if(value.history)out.history=value.history.map(item=>({...pick(item,['attemptId','startedAt','finishedAt','status','sessionId','trigger']),error:item.error===null?null:safeText(item.error||'')}));
 return out;
}
function routinesView(value){return{items:(value.items||[]).map(routineView),onlineOnly:value.onlineOnly===true,warnings:(value.warnings||[]).map(safeText)};}
