import {boundedRead} from './bounded-read.js';

const activeStatuses=new Set(['queued','connecting','authorization_required']);
const knownStatuses=new Set([...activeStatuses,'connected','failed','expired','cancelled','client_required']);
const copy=value=>JSON.parse(JSON.stringify(value));
const scopeKey=value=>JSON.stringify([value.workspace,value.actorId,value.botId]);
const canonical=value=>JSON.stringify(value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(canonical(value[key]))])):Array.isArray(value)?value.map(item=>JSON.parse(canonical(item))):value??null);
export const sameMcpServer=(draft,saved)=>Boolean(draft&&saved)&&canonical(draft)===canonical(saved);
export const mcpConnectionActive=value=>activeStatuses.has(value?.status);
export function mcpAuthorizationUrl(value){
  if(typeof value!=='string'||/[\u0000-\u0020\u007f]/.test(value))return '';
  try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';}catch{return '';}
}
export function mcpConnectionLabel(connection){
  return ({queued:'等待连接',connecting:'正在连接',authorization_required:'等待授权',connected:'已连接',failed:'连接失败',expired:'授权已过期',cancelled:'已取消',client_required:'需要更新客户端'})[connection?.status]||'尚未连接';
}

// Public connection receipts only. OAuth URLs/tokens are never persisted here.
// Unknown writes retain their request identity until POST or GET proves it.
export function createMcpConnections({api,wrap=value=>value,keyFactory=()=>crypto.randomUUID(),storage=typeof sessionStorage==='undefined'?null:sessionStorage,namespace='',timeoutMs=20_000,pollMs=2500,setTimer=setTimeout,clearTimer=clearTimeout}){
  const state=wrap({scope:null,connections:{},pending:{},busy:{},errors:{},loading:false,ready:false,error:''});
  let generation=0,controller=null,timer=null,readPromise=null,disposed=false;
  const versions=new Map();
  const storageKey=scope=>'ziwei.mcp.connections.'+encodeURIComponent(namespace+':'+scopeKey(scope));
  const validScope=scope=>Boolean(scope?.workspace&&scope?.botId);
  function persist(){if(!state.scope?.actorId)return;try{const entries=Object.values(state.pending);if(entries.length)storage?.setItem(storageKey(state.scope),JSON.stringify(entries));else storage?.removeItem(storageKey(state.scope));}catch{}}
  function current(epoch){return !disposed&&generation===epoch;}
  function checked(row,scope,server,requestId){
    if(!row?.id||row.workspace!==scope.workspace||row.employeeId!==scope.botId||typeof row.server!=='string'||!/^[a-z][a-z0-9_-]{0,63}$/.test(row.server)||typeof row.idempotencyKey!=='string'||!row.idempotencyKey||!knownStatuses.has(row.status)||server&&row.server!==server||requestId&&row.idempotencyKey!==requestId)throw new Error('连接回执与当前员工或请求不一致，请刷新连接状态');
    return row;
  }
  function install(row){
    state.connections[row.server]=row;
    if(state.pending[row.server]?.body.idempotencyKey===row.idempotencyKey){delete state.pending[row.server];delete state.errors[row.server];persist();}
  }
  function schedule(){
    clearTimer(timer);timer=null;
    const epoch=generation;
    if(!disposed&&state.scope&&(Object.values(state.connections).some(mcpConnectionActive)||Object.keys(state.pending).length))timer=setTimer(()=>{if(!current(epoch))return;timer=null;void refresh();},pollMs);
  }
  function select(scope){
    if(disposed||validScope(scope)&&state.scope&&scopeKey(scope)===scopeKey(state.scope))return;
    generation++;controller?.abort();controller=new AbortController();clearTimer(timer);timer=null;readPromise=null;versions.clear();
    state.scope=validScope(scope)?copy(scope):null;state.connections={};state.pending={};state.busy={};state.errors={};state.loading=false;state.ready=false;state.error='';
    if(!state.scope)return;
    if(state.scope.actorId)try{for(const row of JSON.parse(storage?.getItem(storageKey(state.scope))||'[]')){const body=row?.body;if(typeof body?.server==='string'&&typeof body.idempotencyKey==='string'&&Number.isInteger(body.expectedRevision)&&Number.isInteger(body.expectedControlEpoch))state.pending[body.server]={body,unknown:true};}}catch{}
    void refresh();
  }
  function refresh(){
    if(!state.scope||disposed)return Promise.resolve(false);
    if(readPromise)return readPromise;
    const scope=copy(state.scope),epoch=generation,revision=new Map(versions),signal=controller.signal;
    state.loading=true;
    const promise=(async()=>{
      try{
        const response=await boundedRead(signal=>api.botMcpConnections(scope.botId,scope.workspace,{signal}),{signal,timeoutMs});
        if(!current(epoch))return false;
        if(!Array.isArray(response?.connections))throw new Error('连接状态读取失败，请重试');
        const rows=response.connections.map(row=>checked(row,scope));
        const next={...state.connections};
        for(const server of Object.keys(next))if(!rows.some(row=>row.server===server)&&versions.get(server)===revision.get(server))delete next[server];
        state.connections=next;
        for(const row of rows)if(versions.get(row.server)===revision.get(row.server))install(row);
        state.ready=true;state.error='';return true;
      }catch(error){if(current(epoch))state.error=error.message||'连接状态读取失败，请重试';return false;}
      finally{if(current(epoch)){state.loading=false;readPromise=null;schedule();}}
    })();
    readPromise=promise;return promise;
  }
  async function connect(server,binding){
    if(!state.scope||disposed||state.busy[server])return false;
    const scope=copy(state.scope),epoch=generation,signal=controller.signal;
    state.busy[server]=true;state.errors[server]='';
    let unknownBefore=Boolean(state.pending[server]);
    try{
      if(!state.ready||unknownBefore){
        if(!await refresh()||!current(epoch))return false;
        // GET found the original key: show that connection; never dispatch a
        // second one because the user retried an unknown acceptance response.
        if(unknownBefore&&!state.pending[server])return true;
      }
      if(mcpConnectionActive(state.connections[server])&&!state.pending[server]){await refresh();return true;}
      if(!state.pending[server]){
        if(!Number.isInteger(binding?.revision)||!Number.isInteger(binding?.controlEpoch))throw new Error('请先刷新并保存当前 Bot 配置');
        state.pending[server]={body:{server,expectedRevision:binding.revision,expectedControlEpoch:binding.controlEpoch,idempotencyKey:keyFactory()},unknown:false};persist();
      }
      const pending=state.pending[server];unknownBefore=unknownBefore||pending.unknown;
      versions.set(server,(versions.get(server)||0)+1);
      const response=await boundedRead(signal=>api.connectBotMcp(scope.botId,copy(pending.body),scope.workspace,{signal}),{signal,timeoutMs});
      if(!current(epoch))return false;
      install(checked(response?.connection,scope,server,pending.body.idempotencyKey));return true;
    }catch(error){
      if(!current(epoch))return false;
      const pending=state.pending[server];
      if(pending){
        const rejected=!unknownBefore&&Number.isInteger(error.status)&&error.status>=400&&error.status<500&&error.status!==408&&!/IDEMPOTENCY|RECEIPT|REQUEST_CONFLICT/i.test(error.code||'');
        if(rejected)delete state.pending[server];else pending.unknown=true;
        persist();
      }
      state.errors[server]=error.message||'连接请求未返回，请检查原连接';
      // Reading is safe after a lost acceptance response. A retrying POST is
      // always a later, explicit user action using the exact retained body.
      if(state.pending[server])await refresh();
      return false;
    }finally{if(current(epoch)){state.busy[server]=false;schedule();}}
  }
  async function cancel(server){
    const row=state.connections[server];if(!state.scope||disposed||!row||state.busy[server]||state.pending[server])return false;
    const scope=copy(state.scope),epoch=generation,signal=controller.signal;state.busy[server]=true;state.errors[server]='';versions.set(server,(versions.get(server)||0)+1);
    try{const response=await boundedRead(signal=>api.cancelBotMcpConnection(scope.botId,row.id,scope.workspace,{signal}),{signal,timeoutMs});if(!current(epoch))return false;const result=checked(response?.connection,scope,server);if(result.id!==row.id)throw new Error('取消回执不属于原连接');install(result);return true;}
    catch(error){if(current(epoch)){state.errors[server]=error.message||'取消结果尚未返回';await refresh();}return false;}
    finally{if(current(epoch)){state.busy[server]=false;schedule();}}
  }
  function dispose(){disposed=true;generation++;controller?.abort();clearTimer(timer);timer=null;readPromise=null;}
  return {state,select,refresh,connect,cancel,dispose};
}
