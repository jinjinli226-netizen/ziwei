const copy=value=>JSON.parse(JSON.stringify(value));
const terminal=new Set(['succeeded','failed','expired','cancelled']);
const confirmed=new Set(['observed','applied','restart-required','overridden']);
const key=subject=>JSON.stringify([subject?.actorId,subject?.workspace,subject?.employeeId,subject?.conversationId||null,subject?.subjectHash||null]);
const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
const sensitive=value=>Array.isArray(value)?value.some(sensitive):value&&typeof value==='object'?Object.entries(value).some(([name,item])=>/^(?:api[_-]?key|token|password|passwd|secret|credentials|client[_-]?secret|authorization|cookie|headers|private[_-]?key|access[_-]?token|refresh[_-]?token)$/i.test(name)||sensitive(item)):false;
const reason={DEVICE_OFFLINE:'运行电脑离线，连接后再同步。',CLIENT_NOT_REPORTED:'客户端尚未报告原生管理支持。',NOT_REPORTED:'尚无原生观察，请同步读取。',SNAPSHOT_EXPIRED:'原生观察已过期，请重新同步。',DSH_NATIVE_SUBJECT_CHANGED:'员工运行绑定已变化，请重新选择员工。',DSH_NATIVE_SCOPE_CHANGED:'原生会话绑定已变化，请回读并检查原请求。',DSH_NATIVE_REFRESH_REQUIRED:'请先取得当前原生观察再编辑。',DSH_SECURE_INPUT_REQUIRED:'敏感值必须通过安全通道提交。',OPERATION_TIMEOUT:'原操作等待超时，请查询原请求。',RECEIPT_INVALID:'尚未取得可核实的原生回执。'};
export function dshNativeReason(code){return code==='settings/conflict'?'原生配置版本已变化；原草稿保留，请读取新版本后明确合并。':reason[code]||'原生记录尚不能核实，请回读原请求或重新同步。';}
export function dshNativeApplicationLabel(status){return({observed:'已读取原生观察',applied:'原生回执：已应用', 'restart-required':'原生回执：下次启动或重启后生效，尚未自动重启',overridden:'原生回执：变更被其他配置覆盖',partial:'原生回执：部分完成，仍有未核实步骤',unknown:'原生结果未知，保留原请求',failed:'原生操作失败',cancelled:'原生操作已取消',unavailable:'原生能力当前不可用'})[status]||'尚未取得原生应用回执';}

export function createDshNative({api,wrap=value=>value,keyFactory=()=>crypto.randomUUID(),storage=globalThis.sessionStorage,setTimer=setTimeout,clearTimer=clearTimeout,pollInterval=1500,pollLimit=20}={}){
  const state=wrap({subject:null,capabilities:null,value:null,request:null,action:null,installRequest:null,installAction:null,groupRequest:null,groupAction:null,controls:[],controlAction:null,controlBusy:false,controlNotice:'',controlError:'',loading:false,submitting:false,unknown:false,error:'',errorCode:'',conflict:null,notice:''});
  let generation=0,active=false,disposed=false,timer=null,polls=0,createdScope=null;
  const current=visit=>!disposed&&visit===generation;
  const resource=name=>state.value?.resources?.[name]||null;
  const blocked=()=>state.loading||state.submitting||state.controlBusy||Boolean(state.request)||Boolean(state.value?.pending?.length);
  const editable=name=>!blocked()&&!state.error&&resource(name)?.status==='observed'&&!resource(name).stale;
  const entry=(name,operation)=>state.capabilities?.operations?.find(item=>item.resource===name&&item.operation===operation);
  const attempt=operation=>['waitForInstall','cancelInstall'].includes(operation);
  const supported=(name,operation)=>entry(name,operation)?.supported===true&&(['either',state.subject?.conversationId?'conversation':'bot'].includes(entry(name,operation).scope)||!state.subject?.conversationId&&(name==='plugins'&&attempt(operation)&&entry(name,operation).scope==='attempt'||name==='groups'&&entry(name,operation).scope==='group'));
  const storageKey=()=> 'ziwei.dsh-native:'+key({...state.subject,subjectHash:null});
  function remember(request){state.request=request;if(request?.resource==='plugins'&&request.operation==='installBundle')state.installRequest=copy(request);if(request?.resource==='groups'&&request.operation==='send')state.groupRequest=copy(request);try{if(request)storage?.setItem(storageKey(),JSON.stringify(request));else storage?.removeItem(storageKey());}catch{}}
  function restore(){try{state.request=JSON.parse(storage?.getItem(storageKey())||'null');state.controls=JSON.parse(storage?.getItem(storageKey()+':native-controls')||'[]');}catch{state.request=null;state.controls=[];}if(state.request?.resource==='plugins'&&state.request.operation==='installBundle')state.installRequest=copy(state.request);if(state.request?.resource==='groups'&&state.request.operation==='send')state.groupRequest=copy(state.request);state.unknown=Boolean(state.request);}
  function saveControls(){try{storage?.setItem(storageKey()+':native-controls',JSON.stringify(state.controls.map(({action,...request})=>request)));}catch{}}
  function clearPoll(){if(timer!==null)clearTimer(timer);timer=null;}
  function schedule(){
    clearPoll();if(!active||disposed||state.loading||state.submitting||!state.request&&!state.value?.pending?.length&&!state.controls.some(item=>item.actionId&&!item.finished))return;
    if(polls>=pollLimit){state.notice='已到本次自动读取等待上限；请回读原请求。';return;}
    const visit=generation;timer=setTimer(async()=>{timer=null;if(!current(visit)||!active)return;polls++;await load({poll:true});},pollInterval);timer?.unref?.();
  }
  function accept(value){
    const subject=state.subject,conversationId=subject.conversationId||null;
    const mapped=createdScope&&createdScope.oldHash===subject.subjectHash&&createdScope.conversationId===conversationId&&createdScope.sessionId===value?.scope?.nativeSessionId&&same(createdScope.subject,value?.subject);
    if(value?.schemaVersion!==1||value.workspace!==subject.workspace||value.employeeId!==subject.employeeId||value.subject?.runtime!=='DSH'||!value.subjectHash||!value.resources||!Array.isArray(value.pending)||(value.scope?.conversationId||null)!==conversationId||value.scope.kind!==(conversationId?'conversation':'bot')||subject.subjectHash&&value.subjectHash!==subject.subjectHash&&!mapped)throw Object.assign(Error(),{code:'DSH_NATIVE_SUBJECT_CHANGED'});
    if(mapped){state.subject={...subject,subjectHash:value.subjectHash};createdScope=null;}
    state.value=value;
    if(state.request&&state.request.subjectHash!==value.subjectHash)state.error=dshNativeReason('DSH_NATIVE_SCOPE_CHANGED');
    return value;
  }
  function acceptAction(value){
    const action=value?.action||value,request=state.request;if(!request)return action;
    const operation=action?.payload?.dshOperation;
    if(action?.id!==request.actionId||!operation||!same(operation.subject,request.subject)||!same(operation.scope,request.scope)||operation.resource!==request.resource||operation.operation!==request.operation)throw Object.assign(Error(),{code:'DSH_NATIVE_SCOPE_CHANGED'});
    state.action=action;
    if(request.resource==='plugins'&&request.operation==='installBundle')state.installAction=action;
    if(request.resource==='groups'&&request.operation==='send')state.groupAction=action;
    if(!terminal.has(action.status))return action;
    const receipt=action.result?.dshNative;
    if(receipt?.schemaVersion===1&&receipt.source==='dsh-native'&&same(receipt.subject,request.subject)&&same(receipt.scope,request.scope)&&receipt.resource===request.resource&&receipt.operation===request.operation){
      state.notice=dshNativeApplicationLabel(receipt.status);
      if(action.status==='succeeded'&&request.resource==='sessions'&&request.operation==='create'&&request.scope.nativeSessionId===null&&receipt.status==='applied'&&typeof receipt.data?.sessionId==='string')createdScope={oldHash:request.subjectHash,subject:request.subject,conversationId:request.scope.conversationId,sessionId:receipt.data.sessionId};
      if(confirmed.has(receipt.status)||['failed','cancelled','unavailable'].includes(receipt.status)||request.readOnly){state.unknown=false;state.error='';remember(null);return action;}
    }
    if(request.readOnly){state.error='原生读取未完成，请检查回执后重新同步。';state.unknown=false;remember(null);}
    else{state.unknown=true;state.notice='原生结果未知，保留原请求；只能继续回读，不能重复提交。';}
    return action;
  }
  async function queryAction(visit){
    const request=state.request;if(!request?.actionId)return null;
    const value=await api.dshNativeAction(request.actionId,state.subject.workspace);
    if(current(visit)&&state.request===request)return acceptAction(value);
  }
  function acceptControl(action,request){
    action=action?.action||action;const op=action?.payload?.dshOperation;
    if(action?.id!==request.actionId||!same(op?.subject,request.subject)||!same(op.scope,request.scope)||op.resource!==request.resource||op.operation!==request.operation)throw Object.assign(Error(),{code:'DSH_NATIVE_SCOPE_CHANGED'});
    request.action=action;state.controlAction=action;
    if(!terminal.has(action.status)){state.controlNotice=request.resource==='groups'?'原群取消请求已受理，等待原生回执。':'原安装控制请求已受理，等待原生回执。';return;}
    const receipt=action.result?.dshNative;
    if(receipt?.schemaVersion!==1||receipt.source!=='dsh-native'||!same(receipt.subject,request.subject)||!same(receipt.scope,request.scope)||receipt.resource!==request.resource||receipt.operation!==request.operation)throw Object.assign(Error(),{code:'RECEIPT_INVALID'});
    request.finished=confirmed.has(receipt.status)||['failed','cancelled','unavailable'].includes(receipt.status);
    state.controlNotice=!request.finished?dshNativeApplicationLabel(receipt.status):request.resource==='groups'?'群取消控制已有回执；成员原动作的终态仍需分别核实。':request.operation==='cancelInstall'?'取消控制已有回执；安装是否结束仍需原安装终态核实。':dshNativeApplicationLabel(receipt.status);
    if(request.operation==='waitForInstall'&&receipt.data?.installActionId===request.body.input.sourceActionId&&['applied','restart-required','overridden','failed','cancelled'].includes(receipt.status)&&state.request?.actionId===receipt.data.installActionId){state.unknown=false;remember(null);state.notice='原安装结果已由对应安装记录核实；原执行记录保持原样。';}
  }
  async function queryControls(visit){
    for(const request of state.controls.filter(item=>item.actionId&&!item.finished)){
      const action=await api.dshNativeAction(request.actionId,state.subject.workspace);if(!current(visit))return;acceptControl(action,request);saveControls();
    }
  }
  async function readState(visit,{capabilities=false}={}){
    const subject={...state.subject},query=subject.conversationId?{conversationId:subject.conversationId}:{};
    const [value,capability]=await Promise.all([api.dshNativeState(subject.employeeId,query,subject.workspace),capabilities||!state.capabilities?api.dshNativeCapabilities(subject.employeeId,subject.workspace):Promise.resolve(null)]);
    if(!current(visit))return;
    if(capability){if(capability.workspace!==subject.workspace||capability.employeeId!==subject.employeeId||!Array.isArray(capability.operations))throw Object.assign(Error(),{code:'DSH_NATIVE_SUBJECT_CHANGED'});state.capabilities=capability;}
    return accept(value);
  }
  async function load({poll=false}={}){
    if(!state.subject||state.loading||state.submitting||disposed)return;
    if(!poll)polls=0;clearPoll();const visit=generation;state.loading=true;state.error='';
    try{
      if(state.request?.resource==='sessions'&&state.request.operation==='create')await queryAction(visit);
      if(current(visit))await readState(visit,{capabilities:!poll});if(current(visit))await queryAction(visit);if(current(visit))await queryControls(visit);
    }
    catch(error){if(current(visit)){state.error=dshNativeReason(error?.code);state.errorCode=error?.code||'';}}
    finally{if(current(visit)){state.loading=false;schedule();}}
  }
  async function readAction(){
    if(!state.request?.actionId)return load();
    if(state.loading||state.submitting||disposed)return;
    const visit=generation;clearPoll();polls=0;state.loading=true;state.error='';
    try{await queryAction(visit);if(current(visit))await queryControls(visit);if(current(visit))await readState(visit);}
    catch(error){if(current(visit))state.error=dshNativeReason(error?.code);}
    finally{if(current(visit)){state.loading=false;schedule();}}
  }
  async function send(body,{readOnly=false,refresh=false,groupBinding=null}={}){
    const visit=generation,subject={...state.subject},request={resource:refresh?'state':body.resource,operation:refresh?'refresh':body.operation,body:copy(body),subject:copy(state.value.subject),scope:groupBinding?{kind:'group',groupId:groupBinding.groupId}:copy(state.value.scope),...(groupBinding?{groupBinding}:{}),subjectHash:state.value.subjectHash,scopeKey:key({...subject,subjectHash:state.value.subjectHash}),readOnly,actionId:null};
    clearPoll();polls=0;state.submitting=true;state.error='';state.errorCode='';state.conflict=null;state.notice='';state.action=null;remember(request);
    try{
      const value=await (refresh?api.refreshDshNative(subject.employeeId,body,subject.workspace):api.submitDshNative(subject.employeeId,body,subject.workspace));
      if(!current(visit))return;
      accept(value);
      if(value.action?.id){remember({...request,actionId:value.action.id});state.unknown=false;
        if(value.action.payload?.dshOperation)acceptAction(value.action);
        else state.action=value.action;
        if(state.request&&!terminal.has(value.action.status))state.notice=readOnly?'原生读取已受理，等待设备回执。':'操作已受理，等待原生应用回执。';
      }else{remember(null);state.unknown=false;state.notice=dshNativeReason(value.reasonCode);}
      return value;
    }catch(error){if(current(visit)){
      const conflict=error?.code==='settings/conflict',definitive=conflict||error?.status>=400&&error.status<500&&![408,409,429].includes(error.status);
      state.errorCode=error?.code||'';
      if(conflict)state.conflict={code:error.code,...(Number.isSafeInteger(error.expectedRevision)?{expectedRevision:error.expectedRevision}:{}),...(Number.isSafeInteger(error.actualRevision)?{actualRevision:error.actualRevision}:{})};
      if(definitive){remember(null);state.unknown=false;state.error=dshNativeReason(error.code);}
      else{state.unknown=true;state.error='原请求结果未知，已保留原始参数与请求标识；请回读，不能重复提交。';}
    }}finally{if(current(visit)){state.submitting=false;schedule();}}
  }
  async function submit(name,operation,input={},options={}){
    if(blocked()||disposed||!state.value)return;
    if(!supported(name,operation)){state.error='当前设备未报告此原生操作支持。';return;}
    if(entry(name,operation).scope==='attempt'){state.error='请通过原安装的受限控制入口操作。';return;}
    if(name==='groups'&&operation==='cancel'){state.error='请通过原群执行的受限控制入口操作。';return;}
    if(sensitive(input)){state.error=dshNativeReason('DSH_SECURE_INPUT_REQUIRED');return;}
    const readOnly=entry(name,operation).readOnly===true;
    const creating=name==='sessions'&&operation==='create'&&state.value.scope.kind==='conversation'&&state.value.scope.nativeSessionId===null&&!state.error;
    if(!readOnly&&!creating&&!editable(options.observedResource||name)){state.error=dshNativeReason('DSH_NATIVE_REFRESH_REQUIRED');return;}
    let groupBinding=null;
    if(name==='groups'&&entry(name,operation).scope==='group'){
      const data=resource('groups')?.data,group=[...(data?.items||[]),...(data?.item?[data.item]:[])].find(group=>group.id===input.groupId);
      if(resource('groups')?.status!=='observed'||resource('groups').stale||!group?.members?.includes(state.value.subject.profile)){state.error='请先读取当前员工可见且包含它的原生群。';return;}
      groupBinding={groupId:group.id,members:[...group.members]};
    }
    return send({resource:name,operation,input:copy(input),...(state.subject.conversationId?{conversationId:state.subject.conversationId}:{}),expectedSubjectHash:state.value.subjectHash,idempotencyKey:keyFactory()},{readOnly,groupBinding});
  }
  async function refresh(resources){
    if(blocked()||disposed||!state.value)return;
    if(!supported('state','refresh')){state.error='当前范围不支持整组同步，请使用对应原生读取操作。';return;}
    return send({...(resources?.length?{resources:[...resources]}:{}),...(state.subject.conversationId?{conversationId:state.subject.conversationId}:{}),idempotencyKey:keyFactory()},{readOnly:true,refresh:true});
  }
  async function control(operation,{sourceActionId}={}){
    const group=operation==='cancelGroup',resource=group?'groups':'plugins',nativeOperation=group?'cancel':operation;
    if(disposed||state.controlBusy||!state.value||(!group&&!attempt(operation))||!supported(resource,nativeOperation)||state.value.scope.kind!=='bot')return;
    const original=group?state.groupRequest:state.installRequest;sourceActionId ||=original?.actionId;
    if(!original?.actionId||sourceActionId!==original.actionId||original.subjectHash!==state.value.subjectHash||!same(original.subject,state.value.subject)){state.controlError=group?'只能取消当前绑定下已知的原群执行。':'只能控制当前绑定下已知的原安装请求。';return;}
    const previous=state.controls.find(item=>item.resource===resource&&item.operation===nativeOperation&&item.body.input.sourceActionId===sourceActionId&&!item.finished);
    if(previous){state.controlNotice='原控制结果尚未确认，只能查询原请求。';return load();}
    const visit=generation,subject={...state.subject},request={resource,operation:nativeOperation,body:{resource,operation:nativeOperation,input:{sourceActionId},expectedSubjectHash:state.value.subjectHash,idempotencyKey:keyFactory()},subject:copy(original.subject),scope:group?copy(original.scope):{kind:'attempt',sourceActionId},...(group?{groupBinding:copy(original.groupBinding)}:{}),actionId:null,finished:false};
    state.controls.push(request);saveControls();state.controlBusy=true;state.controlError='';state.controlNotice='';
    try{
      const value=await api.submitDshNative(subject.employeeId,request.body,subject.workspace);if(!current(visit))return;
      accept(value);if(value.action?.id){request.actionId=value.action.id;if(value.action.payload?.dshOperation)acceptControl(value.action,request);else state.controlAction=value.action;}else{request.finished=true;state.controlNotice=dshNativeReason(value.reasonCode);}
      return value;
    }catch(error){if(current(visit)){state.controlError=group?'原群取消结果尚未确认；原执行引用保留，不会重新发送。':'原安装控制结果尚未确认；已保留原引用，不会重新安装。';request.unknown=true;}}
    finally{if(current(visit)){saveControls();state.controlBusy=false;schedule();}}
  }
  async function select(subject,{active:visible=false}={}){
    const next=subject?.actorId&&subject.workspace&&subject.employeeId?{...subject}:null;
    if(key(next)!==key(state.subject)){generation++;clearPoll();polls=0;createdScope=null;Object.assign(state,{subject:next,capabilities:null,value:null,request:null,action:null,installRequest:null,installAction:null,groupRequest:null,groupAction:null,controls:[],controlAction:null,controlBusy:false,controlNotice:'',controlError:'',loading:false,submitting:false,unknown:false,error:'',errorCode:'',conflict:null,notice:''});if(next)restore();}
    active=visible;if(!active){clearPoll();return;}
    if(!next)return;if(state.value){schedule();return;}await load();
  }
  return{state,select,load,refresh,submit,control,readAction,supported,editable,resource,dispose(){disposed=true;generation++;clearPoll();}};
}
