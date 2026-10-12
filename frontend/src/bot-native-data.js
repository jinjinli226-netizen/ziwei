import {nativeReceipt} from './bot-native-transport.js';
import {executionUncertain} from './bot-presentation.js';

export function nativeActionPresentation(action){
  const receipt=nativeReceipt(action),data=receipt?.data||{};
  const source=action?.result?.fixture?'合成 fixture':({native:'本机原生执行',local_test_provider:'本机原生 + 本地测试 provider',fixture:'合成 fixture'}[receipt?.executionSource||action?.result?.executionSource||data.executionSource]||'执行来源尚未说明');
  const base={source,version:receipt?.nativeVersion||null};
  if(executionUncertain(action))return {...base,label:'原执行待核实',tone:'warning'};
  if(receipt?.status==='requires_dependency')return {...base,label:'接口已返回 · 缺少依赖',tone:'warning'};
  if(receipt?.status==='requires_authorization')return {...base,label:'接口已返回 · 需要授权',tone:'warning'};
  if(data.staged||data.pending_id||data.status==='staged'||data.mutation?.staged||data.mutation?.pending_id)return {...base,label:'已暂存 · 等待原生处理',tone:'warning'};
  if(data.installed&&data.verified===false)return {...base,label:'安装结果待核实',tone:'warning'};
  if(['pending','acked','queued','running'].includes(action?.status))return {...base,label:'已受理 · 等待原回执',tone:'running'};
  if(action?.status==='succeeded')return {...base,label:'原操作回执已完成',tone:'success'};
  if(action?.status)return {...base,label:action.status==='failed'?'原操作失败':action.status,tone:'error'};
  return {...base,label:'尚无原生操作回执',tone:'muted'};
}
export function nativeItems(value,keys=['items']){const data=value?.data??value;if(Array.isArray(data))return data;for(const key of keys)if(Array.isArray(data?.[key]))return data[key];return [];}
export function nativeValue(value){return value?.data??value??null;}
export function nativeMcpTools(value){return nativeItems(value,['tools']).map(item=>{const schema=item.schema?.function||item.schema||item.function||item;return {name:item.name||schema.name,description:schema.description||'',parameters:schema.parameters||schema.inputSchema||{}};});}
export function nativeSkillCatalog(value){
  const data=nativeValue(value)||{},rows=new Map(nativeItems(value,['skills','items']).map(row=>[row.name,{...row}]));
  for(const name of data.disabled||[])if(!rows.has(name))rows.set(name,{name,enabled:false});
  const installed=Array.isArray(data.installed)?data.installed:Object.entries(data.installed||{}).map(([name,row])=>({name,...row}));
  for(const row of installed){const name=row.name||row.skill_name;if(name)rows.set(name,{...(rows.get(name)||{name}),provenance:row,source:row.source,hash:row.hash||row.content_hash,enabled:!(data.disabled||[]).includes(name)});}
  return [...rows.values()];
}
export function gatewayStages(value,voice){
  const data=nativeValue(value)||{},runtime=data.runtime,rows=Array.isArray(runtime)?runtime:runtime?[runtime]:[];
  const process=rows.length?rows.map(row=>`原生报告 ${row.status||'尚未报告'}${row.pid?' · PID '+row.pid:''}${row.lastHeartbeat?' · 心跳 '+new Date(row.lastHeartbeat*1000).toLocaleString():''}`).join('、'):'等待原生回执';
  const connection=rows.length?rows.map(row=>`${row.platform||'渠道'} · ${row.status||'尚未报告'}（原生最近报告）`).join('、'):'尚未确认连接';
  const media=['stt','tts'].map(kind=>{const row=voice?.[kind];return `${kind.toUpperCase()} · ${row?(row.enabled?(row.configured?'已配置，调用后核实可用':'缺少凭据或依赖'):'已停用'):'尚未核实'}`;}).join('；');
  return {process,connection,media};
}
export function safeProviderUrl(value){if(!value)return '';const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash||[...url.searchParams.keys()].some(key=>/token|secret|password|api[_-]?key|authorization/i.test(key)))throw new Error('服务地址不可含凭据，请使用本机环境变量引用');return url.href;}
export function gatewayExtra(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('高级设置须为 JSON 对象');
  function inspect(row){for(const [key,item] of Object.entries(row)){if(item&&typeof item==='object')inspect(item);else if(/token|secret|password|api[_-]?key|authorization|credential/i.test(key)&&item&&!/^\$\{[A-Z][A-Z0-9_]*\}$/.test(item))throw new Error('高级凭据只填写 ${LOCAL_VAR} 环境变量引用');else if(/(?:url|endpoint)$/i.test(key)&&item)safeProviderUrl(item);}}
  inspect(value);return value;
}
export function nativeRoutineDriver(resource,target=''){
  if(!['goals','heartbeat','kanban','groups'].includes(resource))throw new Error('不支持此原生 Routine 类型');
  if(['kanban','groups'].includes(resource)&&(!target||/[\\/\0\r\n]/.test(target)))throw new Error('请填写当前 Bot 的精确原生工作或群组标识');
  return {resource,operation:resource==='kanban'?'dispatch':'step',input:resource==='kanban'?{taskId:target}:resource==='groups'?{groupId:target}:{}};
}
export function routineDriver(routine){if(routine?.nativeDriver)return routine.nativeDriver;try{return JSON.parse(routine?.native_driver_json||'null');}catch{return null;}}
const lines=value=>String(value||'').split(/[\n,]/).map(item=>item.trim()).filter(Boolean);
function references(value,label){const result={};for(const line of lines(value)){const pair=line.match(/^([A-Za-z][A-Za-z0-9_-]*)=([A-Z][A-Z0-9_]*)$/);if(!pair)throw new Error(label+'只填写 本字段名=本机变量名，不填写密钥值');result[pair[1]]=String.fromCharCode(36)+'{'+pair[2]+'}';}return result;}
export function referenceText(value){return Object.entries(value||{}).map(([key,item])=>key+'='+String(item).replace(/^\$\{(.*)\}$/,'$1')).join('\n');}
export function buildMcpServer(form,existing={}){
  const transport=form.transport||'stdio',result={...existing,enabled:form.enabled??existing.enabled??true};
  for(const field of ['command','args','url','headers','transport'])delete result[field];
  if(transport==='stdio'){
    if(!form.command?.trim()||/[\n\r\0]/.test(form.command))throw new Error('请填写单行 MCP 命令');
    result.command=form.command.trim();result.args=String(form.argsText||'').split('\n').map(line=>line.trim()).filter(Boolean);
  }else{
    const url=new URL(form.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash||[...url.searchParams.keys()].some(key=>/token|secret|password|api[_-]?key|authorization/i.test(key)))throw new Error('MCP URL 不可含凭据，请通过环境引用配置认证');
    result.transport=transport;result.url=url.href;result.headers=references(form.headersText,'HTTP header');
  }
  result.env=references(form.envText,'环境引用');
  if(form.includeText!==undefined||form.excludeText!==undefined)result.tools={...existing.tools,...(form.includeText!==undefined?{include:lines(form.includeText)}:{}),...(form.excludeText!==undefined?{exclude:lines(form.excludeText)}:{})};
  for(const field of ['timeout','connectTimeout'])if(form[field]!==undefined&&form[field]!==''){const value=Number(form[field]);if(!Number.isInteger(value)||value<1||value>(field==='timeout'?120:60))throw new Error('MCP 超时时间不在允许范围');result[field]=value;}
  return result;
}
export async function audioInput(file,{maxBytes=5*1024*1024}={}){
  const supported=['audio/wav','audio/mpeg','audio/ogg','audio/webm','audio/mp4'];
  const original=String(file.type||'').split(';')[0],mimeType=({'audio/x-wav':'audio/wav','audio/mp3':'audio/mpeg'}[original]||original);if(!supported.includes(mimeType))throw new Error('请选择 WAV、MP3、OGG、WebM 或 M4A 音频');
  if(!file.size||file.size>maxBytes)throw new Error('音频大小须在5 MiB以内');
  const bytes=new Uint8Array(await file.arrayBuffer()),prefix=String.fromCharCode(...bytes.slice(0,12));
  const valid=(prefix.startsWith('RIFF')&&prefix.slice(8,12)==='WAVE')||prefix.startsWith('ID3')||bytes[0]===255&&(bytes[1]&224)===224||prefix.startsWith('OggS')||prefix.startsWith('fLaC')||bytes[0]===26&&bytes[1]===69&&bytes[2]===223&&bytes[3]===163||prefix.slice(4,8)==='ftyp';
  if(!valid)throw new Error('文件内容不是支持的音频格式');
  let binary='';for(let start=0;start<bytes.length;start+=32768)binary+=String.fromCharCode(...bytes.subarray(start,start+32768));
  return {audioBase64:btoa(binary),mimeType};
}
