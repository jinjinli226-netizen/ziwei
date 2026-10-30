const bindingFields=['workspace','employeeId','deviceId','profile','runtime'];
const scopeKey=scope=>JSON.stringify([...bindingFields,'actorId'].map(key=>scope?.[key]??null));
const sameIds=(a,b)=>a.length===b.length&&a.every(id=>b.includes(id));
const savedIds=value=>(value?.plugins||[]).filter(item=>item.enabled).map(item=>item.id);
const reasons={DEVICE_OFFLINE:'运行电脑离线，连接后可同步原生插件。',CLIENT_NOT_REPORTED:'电脑客户端尚未报告 DSH 插件支持，请更新客户端后同步。',NOT_REPORTED:'尚无原生插件快照，请同步原生目录。',DEVICE_UNASSIGNED:'尚未指定运行电脑，请先检查员工设置。',PROFILE_MISSING:'尚未绑定原生 Bot，请先检查员工设置。',SNAPSHOT_EXPIRED:'原生目录已过期，请同步后再保存。',OPERATION_FAILED:'原生插件操作失败，请检查 DSH 后重新同步。',OPERATION_TIMEOUT:'原生插件操作等待超时，请回读原请求状态。',LATE_RECEIPT:'原生回执返回过晚，历史记录不代表当前组合。',AUTHORITY_REVOKED:'原请求授权已变化，请检查员工和设备权限。',RECEIPT_INVALID:'原生回执尚不能核实，请更新客户端后同步。',REFRESH_PENDING:'等待运行电脑返回原生插件观察。'};
export function dshPluginsReason(code){return reasons[code]||'尚未取得当前原生插件记录，请检查电脑连接与 Bot 绑定。';}
export function dshRuntimeEntries(runtime){
  if(runtime?.status!=='observed')return [];
  return[...(runtime.entries||[]).map(row=>({...row,scope:'当前 Bot'})),...(runtime.agentPresets||[]).flatMap(preset=>(preset.rows||[]).map(row=>({...row,scope:'预设 · '+preset.id})))].map(row=>({...row,phase:row.fiberPhase??'未观察'}));
}
export function createDshPlugins({api,wrap=value=>value,keyFactory=()=>crypto.randomUUID(),storage=globalThis.sessionStorage,setTimer=setTimeout,clearTimer=clearTimeout,pollInterval=1500,pollLimit=20}={}){
  const state=wrap({subject:null,value:null,draft:[],loading:false,submitting:false,unknown:false,request:null,error:'',notice:''});
  let generation=0,active=false,opened=false,disposed=false,timer=null,polls=0;
  const current=visit=>!disposed&&visit===generation;
  const dirty=()=>!sameIds(state.draft,savedIds(state.value));
  const blocked=()=>state.loading||state.submitting||Boolean(state.request)||Boolean(state.value?.pending);
  const editable=()=>!blocked()&&state.value?.status==='ready'&&!state.value.stale;
  function clearPoll(){if(timer!==null)clearTimer(timer);timer=null;}
  function remember(request){
    state.request=request;
    try{const key='ziwei.dsh-plugins:'+scopeKey(state.subject);if(request)storage?.setItem(key,JSON.stringify(request));else storage?.removeItem(key);}catch{}
  }
  function restore(){try{state.request=JSON.parse(storage?.getItem('ziwei.dsh-plugins:'+scopeKey(state.subject))||'null');}catch{state.request=null;}state.unknown=Boolean(state.request);if(state.request?.operation==='apply')state.draft=[...state.request.enabled];}
  function scopedView(value){
    if(value?.schemaVersion!==1||bindingFields.some(key=>(value.subject?.[key]??null)!==(state.subject[key]??null)))throw Object.assign(Error(),{code:'DSH_PLUGINS_SCOPE_CHANGED'});
    return value;
  }
  function accept(value){
    const keepDraft=dirty();state.value=value;
    if(!state.request||state.request.operation==='inspect'){
      if(!keepDraft)state.draft=savedIds(value);
      else if(value.status==='ready'&&!value.stale)state.draft=value.plugins.filter(item=>item.required||state.draft.includes(item.id)).map(item=>item.id);
    }
    const request=state.request,attempt=value.lastAttempt;
    if(request?.actionId&&attempt?.actionId===request.actionId&&!value.pending){
      if(attempt.status==='succeeded'&&value.status==='ready'&&!value.stale&&value.snapshot?.actionId===request.actionId){
        state.notice=request.operation==='apply'?'插件组合已保存；下次启动生效，当前加载以运行时观察为准。':'已同步原生插件目录与当前观察。';if(request.operation==='apply')state.draft=savedIds(value);state.unknown=false;remember(null);
      }else if(['failed','expired'].includes(attempt.status)||['OPERATION_TIMEOUT','RECEIPT_INVALID','LATE_RECEIPT'].includes(attempt.reasonCode)){
        state.error=dshPluginsReason(attempt.reasonCode||'OPERATION_FAILED');state.unknown=false;remember(null);
      }
    }
    if(state.request&&!value.pending){state.unknown=true;state.notice='原请求结果尚未确认，请回读或按原请求重试。';}
    return value;
  }
  function schedule(){
    clearPoll();if(!active||!state.value?.pending||state.loading||state.submitting||disposed)return;
    if(polls>=pollLimit){state.notice='自动读取已到本次等待上限；请稍后回读原请求状态。';return;}
    const visit=generation;timer=setTimer(async()=>{timer=null;if(!current(visit)||!active)return;polls++;await load({poll:true});},pollInterval);timer?.unref?.();
  }
  function fail(error){
    state.error=error?.code==='DSH_PLUGINS_SCOPE_CHANGED'?'员工或运行绑定已变化，请重新选择员工。':error?.status===401?'登录状态已失效，请重新登录。':error?.status===403?'当前账号不能管理此员工的原生插件。':error?.code==='DSH_PLUGINS_REFRESH_REQUIRED'?'请先同步当前原生目录，再保存插件组合。':error?.code==='DSH_PLUGINS_ENABLED_INVALID'?'原生插件目录已变化或必需项缺失，请重新同步。':'原生插件记录未能读取，请检查连接后重试。';
  }
  async function load({poll=false}={}){
    if(!state.subject||state.loading||state.submitting||disposed)return;
    if(!poll)polls=0;clearPoll();const visit=generation,subject={...state.subject};state.loading=true;state.error='';state.notice='';
    try{const value=await api.employeePlugins(subject.workspace,subject.employeeId);if(current(visit))return accept(scopedView(value));}
    catch(error){if(current(visit)){fail(error);if(state.value)state.value={...state.value,status:'unknown',stale:true};}}
    finally{if(current(visit)){state.loading=false;schedule();}}
  }
  async function send(request){
    const visit=generation,subject={...state.subject};clearPoll();polls=0;state.submitting=true;state.error='';state.notice='';remember(request);
    try{
      const body={idempotencyKey:request.idempotencyKey,...(request.operation==='apply'?{enabled:[...request.enabled]}:{})};
      const value=await (request.operation==='apply'?api.updateEmployeePlugins(subject.workspace,subject.employeeId,body):api.refreshEmployeePlugins(subject.workspace,subject.employeeId,body));
      if(!current(visit))return;
      scopedView(value);
      const actionId=value.actionId||value.pending?.actionId;
      if(actionId){remember({...request,actionId});state.unknown=false;}
      else{remember(null);state.unknown=false;state.notice=dshPluginsReason(value.reasonCode);}
      accept(value);
      if(value.pending)state.notice=request.operation==='apply'?'保存请求已受理，等待原生回执。':'只读同步已受理，等待运行电脑返回目录。';
    }catch(error){if(current(visit)){
      fail(error);
      if(error?.status>=400&&error.status<500&&![408,429].includes(error.status)&&!['IDEMPOTENCY_CONFLICT','DSH_PLUGINS_OPERATION_PENDING'].includes(error.code)&&!state.unknown){remember(null);}
      else{state.unknown=true;state.error='原请求结果未知，已保留插件组合与请求标识，请回读或按原请求重试。';}
    }}finally{if(current(visit)){state.submitting=false;schedule();}}
  }
  async function select(subject,{active:visible=false}={}){
    const next=subject?.runtime==='DSH'&&subject.workspace&&subject.employeeId?{...subject}:null;
    if(scopeKey(next)!==scopeKey(state.subject)){generation++;clearPoll();opened=false;polls=0;Object.assign(state,{subject:next,value:null,draft:[],loading:false,submitting:false,request:null,unknown:false,error:'',notice:''});if(next)restore();}
    active=visible;if(!active){clearPoll();return;}
    if(!next)return;if(opened){schedule();return;}opened=true;
    await load();
    if(active&&scopeKey(next)===scopeKey(state.subject)&&!state.error&&!state.request&&!state.value?.pending&&!['DEVICE_OFFLINE','CLIENT_NOT_REPORTED','DEVICE_UNASSIGNED','PROFILE_MISSING'].includes(state.value?.reasonCode))await refresh();
  }
  async function refresh(){if(!state.subject||blocked()||disposed)return;await send({operation:'inspect',idempotencyKey:keyFactory()});}
  async function save(){if(!editable()||!dirty()||disposed)return;await send({operation:'apply',enabled:[...state.draft],idempotencyKey:keyFactory()});}
  async function retry(){if(!state.request||!state.unknown||state.loading||state.submitting||state.value?.pending||disposed)return;await send({...state.request});}
  function toggle(id,enabled){
    if(!editable())return false;const plugin=state.value.plugins.find(item=>item.id===id);if(!plugin||plugin.required&&!enabled)return false;
    state.draft=state.value.plugins.filter(item=>item.id===id?enabled:state.draft.includes(item.id)).map(item=>item.id);return true;
  }
  return{state,select,load,refresh,save,retry,toggle,dirty,editable,dispose(){disposed=true;generation++;clearPoll();}};
}
