export const DSH_NATIVE_FEATURE='dsh_native_controls_v1';
export const DSH_PLUGIN_UI_RELAY_FEATURE='dsh_plugin_ui_relay_v1';
export const DSH_NATIVE_TYPE='employee.dsh.operation';
const string=(maxLength=240)=>({type:'string',minLength:1,maxLength});
const boolean={type:'boolean'},integer={type:'integer',minimum:0},json={};
const array=(items,maxItems=128)=>({type:'array',items,maxItems});
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const selection={provider:string(),model:string(),reasoningEffort:string()};
const groupAttachment=object({name:string(255),mimeType:{enum:['image/png','image/jpeg','image/gif','image/webp','text/plain','text/markdown','application/json']},contentBase64:string(2796204)});
const settingOp={oneOf:[object({op:{const:'set'},path:array(string(),32),value:json}),object({op:{const:'unset'},path:array(string(),32)})]};
export const DSH_NATIVE_REFRESH_RESOURCES=Object.freeze(['plugins','settings','providers','presets','bot']);
const resources=['plugins','settings','providers','presets','market','bot','sessions','plan','interactions','routines','files','logs','groups'];
const entries=[];
function add(resource,operation,inputSchema=object({}),{readOnly=false,scope='bot',implemented=true,nativeMethods=[],timeoutMs=15000}={}){entries.push({resource,operation,inputSchema,readOnly,scope,implemented,nativeMethods,timeoutMs});}
const read=(resource,operation,schema,methods)=>add(resource,operation,schema,{readOnly:true,nativeMethods:methods});
add('state','refresh',object({resources:array({enum:resources},resources.length)},[]),{readOnly:true,scope:'either'});
read('plugins','list',undefined,['pluginManager/listBundles','pluginManager/listPlugins','pluginInventory/list']);
read('plugins','registries',undefined,['pluginManager/registries']);
add('plugins','prepareUiHost',object({}),{nativeMethods:['POST /api/bots/:name/plugin-ui/prepare'],timeoutMs:60000});
add('plugins','setBundleEnabled',object({name:string(),enabled:boolean}),{nativeMethods:['pluginManager/setBundleEnabled']});
add('plugins','setPluginEnabled',object({id:string(600),enabled:boolean}),{nativeMethods:['pluginManager/setPluginEnabled']});
add('plugins','removeBundle',object({name:string()}),{nativeMethods:['pluginManager/removeBundle']});
add('plugins','inspectSource',object({spec:string(2000),registry:{type:['string','null'],maxLength:2000}},['spec']),{readOnly:true,nativeMethods:['pluginManager/inspect'],timeoutMs:60000});
read('settings','describe',undefined,['settings/describe']);
add('settings','mutate',object({ns:string(),expectedRevision:integer,ops:array(settingOp)},['ns','expectedRevision','ops']),{nativeMethods:['settings/mutate','settings/describe']});
add('settings','mutateSecure',object({ns:string(),expectedRevision:integer,secretRequestId:string()}),{nativeMethods:['settings/mutate','settings/describe'],timeoutMs:330000});
read('market','listIndexes',undefined,['pluginMarket/listIndexes']);
add('market','setIndexes',object({urls:array(string(2000),64)}),{nativeMethods:['pluginMarket/setIndexes','pluginMarket/listIndexes']});
add('market','search',object({url:string(2000),query:object({text:{type:'string',maxLength:500},category:{type:'string',maxLength:240},labels:array({type:'string',maxLength:240},64),sort:{oneOf:[object({kind:{enum:['index','relevance']}}),object({kind:{const:'published'},direction:{enum:['asc','desc']}}),object({kind:{const:'key'},id:string(),direction:{enum:['asc','desc']}})]},offset:integer,limit:{type:'integer',minimum:1,maximum:100},refresh:boolean,fetchedAt:integer},['sort','offset','limit'])}),{readOnly:true,nativeMethods:['pluginMarket/search'],timeoutMs:60000});
read('providers','inspect',undefined,['settings/describe','llm/listProviders','llm/listConfigurableProviders','session/modelCatalog','credentials/describe']);
add('providers','upsert',object({provider:string(),expectedRevision:integer,api:{enum:['openai-completions','openai-responses','anthropic-messages','',null]},baseURL:{type:['string','null'],maxLength:2000},models:{...array({type:'object',required:['id'],properties:{id:string()},additionalProperties:true}),type:['array','null']},credentialRef:string()},['provider','expectedRevision']),{nativeMethods:['settings/mutate','settings/describe']});
add('providers','remove',object({provider:string(),expectedRevision:integer}),{nativeMethods:['settings/mutate','settings/describe']});
add('providers','discoverModels',object({provider:string(),api:string(),baseURL:string(2000)},[]),{readOnly:true,nativeMethods:['llm/discoverModels'],timeoutMs:60000});
add('providers','discoverModelsSecure',object({provider:string(),api:string(),baseURL:string(2000),secretRequestId:string()},['secretRequestId']),{nativeMethods:['llm/discoverModels'],timeoutMs:330000});
add('models','setDefault',object({...selection,expectedRevision:integer},['provider','model','expectedRevision']),{nativeMethods:['settings/mutate','session/modelCatalog']});
read('presets','list',undefined,['agentPresets/list']);
read('presets','read',object({agentPreset:string()}),['agentPresets/read']);
read('bot','state',undefined,[]);
add('bot','persona',object({persona:{type:'string',maxLength:24000}}));
add('bot','metadata',object({displayName:string(240),avatar:string(240),section:string(240),pinned:boolean,hidden:boolean,notify:boolean},[]));
read('files','list',object({path:{type:'string',maxLength:2000}},[]),[]);
read('files','preview',object({path:string(2000)}),[]);
read('logs','read',object({lines:{type:'integer',minimum:1,maximum:2000}},[]),[]);
read('routines','list',undefined,[]);
read('routines','get',object({id:string()}),[]);
const routineFields={title:string(120),prompt:string(24000),intervalMinutes:{enum:[1,15,60,1440]},enabled:boolean};
add('routines','create',object(routineFields));
add('routines','update',object({id:string(),...routineFields},['id']));
add('routines','delete',object({id:string()}));
add('routines','run',object({id:string()}),{timeoutMs:60000});
for(const [resource,operation,scope,inputSchema] of [
 ['plugins','installBundle','bot',object({sourceActionId:string(),enabled:boolean,approvedBuilds:array(string()),replaceName:string()},['sourceActionId','enabled'])],
 ['plugins','waitForInstall','attempt',object({sourceActionId:string()})],
 ['plugins','cancelInstall','attempt',object({sourceActionId:string()})],
 ['presets','select','conversation',object({agentPreset:string()})],
 ['sessions','list','bot',object({})],
 ['sessions','projections','conversation',object({})],
 ['sessions','create','conversation',object({agentPreset:string()},[])],
 ['sessions','history','either',object({sessionId:string(600),routineId:string(240),attemptId:string(240),maxMessages:{type:'integer',minimum:1,maximum:1000}},[])],
 ['plan','capabilities','conversation',object({})],
 ['plan','set','conversation',object({active:boolean})],
 ['models','selectSession','conversation',object(selection,['provider','model'])],
 ['interactions','list','conversation',object({})],
 ['interactions','approve','conversation',object({interactionId:string(),decision:{enum:['allowed-once','rejected']}})],
 ['interactions','answer','conversation',object({interactionId:string(),answers:array(json,16)})],
 ['interactions','dismiss','conversation',object({interactionId:string()})],
 ['credentials','set','bot',object({ref:string(),secretRequestId:string()})],
 ['bot','start','bot',object({})],['bot','stop','bot',object({})],
 ['groups','list','bot',object({})],['groups','get','group',object({groupId:string()})],
 ['groups','create','bot',object({title:string(480),memberEmployeeIds:array(string(),6)})],
 ['groups','update','group',object({groupId:string(),title:string(480),memberEmployeeIds:array(string(),6)},['groupId'])],
 ['groups','delete','group',object({groupId:string()})],
 ['groups','send','group',object({groupId:string(),content:{type:'string',maxLength:16000},targetEmployeeIds:array(string(),6),attachments:array(groupAttachment,10)},['groupId','content'])],
 ['groups','cancel','group',object({sourceActionId:string()})],
])add(resource,operation,inputSchema,{scope,readOnly:['list','get','projections','history','capabilities','waitForInstall'].includes(operation),timeoutMs:['installBundle','waitForInstall'].includes(operation)||resource==='groups'&&operation==='send'?900000:resource==='credentials'?330000:15000});
export const DSH_NATIVE_OPERATIONS=Object.freeze(entries.map(entry=>Object.freeze(entry)));
export const getDshNativeOperation=(resource,operation)=>DSH_NATIVE_OPERATIONS.find(item=>item.resource===resource&&item.operation===operation)||null;

export function normalizeDshNativeInput(resource,operation,input={}){
 const entry=getDshNativeOperation(resource,operation);
 if(!entry)fail('DSH_NATIVE_OPERATION_UNSUPPORTED');
 if(!matches(entry.inputSchema,input)||JSON.stringify(input).length>(resource==='groups'&&operation==='send'?15*1024*1024:262144))fail('DSH_NATIVE_INPUT_INVALID');
 if(resource==='files'&&input.path&&(input.path.startsWith('/')||/[\\:\0]/.test(input.path)||input.path.split('/').some(part=>part==='..')))fail('DSH_NATIVE_INPUT_INVALID');
 for(const value of [input.spec,input.registry,input.baseURL,input.url,...(input.urls||[])])if(typeof value==='string')assertNonSecretSource(value);
 return resource==='state'&&operation==='refresh'?{resources:input.resources?[...new Set(input.resources)]:[...DSH_NATIVE_REFRESH_RESOURCES]}:structuredClone(input);
}
export const isDshNativeControlAction=action=>action?.type===DSH_NATIVE_TYPE&&['interactions.list','interactions.approve','interactions.answer','interactions.dismiss','plugins.cancelInstall','groups.cancel'].includes(`${action.payload?.dshOperation?.resource}.${action.payload?.dshOperation?.operation}`);
function fail(code){throw Object.assign(new Error(code),{code,status:400});}
function assertNonSecretSource(value){
 let url;try{url=new URL(value.replace(/^git\+/i,''));}catch{return;}
 if(url.password||url.username&&['http:','https:'].includes(url.protocol)||[...url.searchParams.keys()].some(key=>/^(?:api[_-]?key|token|password|secret|access[_-]?token|authorization)$/i.test(key)))fail('DSH_SECURE_INPUT_REQUIRED');
}
function matches(schema,value){
 if(schema.oneOf)return schema.oneOf.some(item=>matches(item,value));
 if(Object.hasOwn(schema,'const')&&schema.const!==value)return false;
 if(schema.enum&&!schema.enum.includes(value))return false;
 if(!schema.type)return true;
 const types=Array.isArray(schema.type)?schema.type:[schema.type];
 if(!types.some(type=>type==='null'?value===null:type==='array'?Array.isArray(value):type==='object'?value!==null&&typeof value==='object'&&!Array.isArray(value):type==='integer'?Number.isSafeInteger(value):typeof value===type))return false;
 if(value===null)return true;
 if(typeof value==='string')return (!schema.minLength||value.length>=schema.minLength)&&(!schema.maxLength||value.length<=schema.maxLength)&&!value.includes('\0');
 if(typeof value==='number')return (schema.minimum===undefined||value>=schema.minimum)&&(schema.maximum===undefined||value<=schema.maximum);
 if(Array.isArray(value))return value.length<=(schema.maxItems??128)&&value.every(item=>matches(schema.items,item));
 if(typeof value==='object')return (schema.required||[]).every(key=>Object.hasOwn(value,key))&&Object.entries(value).every(([key,item])=>schema.properties?.[key]?matches(schema.properties[key],item):schema.additionalProperties===true);
 return true;
}
