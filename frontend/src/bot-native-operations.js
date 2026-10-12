import {createBotRequestScope,botErrorMessage} from './bot-state.js';
import {executionUncertain} from './bot-presentation.js';

const copy=value=>value==null?value:JSON.parse(JSON.stringify(value));
const accountRegistries=new Map();
const scopeKey=(workspace,botId,resource)=>JSON.stringify([workspace,botId,resource]);
const initial=()=>({data:null,draft:null,query:{},loading:false,busy:false,phase:'idle',error:'',action:null,result:null,pending:null,review:null});

// Internal UI transport. The HTTP adapter must map only the stable E02 contract
// into read/submit/action; these names are not proposed server endpoints.
export function createBotNativeOperations({transport,wrap=value=>value,keyFactory=()=>crypto.randomUUID(),namespace='',storage=typeof sessionStorage==='undefined'?null:sessionStorage}){
  const scope=createBotRequestScope();
  const storageKey='ziwei.native.pending.'+encodeURIComponent(namespace);
  const registry=namespace?(accountRegistries.get(namespace)||new Map()):new Map();
  if(namespace&&!accountRegistries.has(namespace)){
    try{for(const row of JSON.parse(storage?.getItem(storageKey)||'[]'))if(row?.intent?.workspace&&row.intent.botId&&row.intent.resource&&row.intent.idempotencyKey)registry.set(scopeKey(row.intent.workspace,row.intent.botId,row.intent.resource)+(row.kind==='review'?':review:'+row.intent.idempotencyKey:''),{...row,replayable:false});}catch{}
    accountRegistries.set(namespace,registry);
  }
  function persist(){if(!namespace||!storage)return;const rows=[...registry.values()].map(value=>({intent:Object.fromEntries(Object.entries(value.intent).filter(([key])=>key!=='input')),action:value.action?{id:value.action.id,status:value.action.status,acked_at:value.action.acked_at,result:{code:value.action.result?.code,executionState:value.action.result?.executionState}}:null,phase:value.phase,kind:value.kind,review:value.review}));try{if(rows.length)storage.setItem(storageKey,JSON.stringify(rows));else storage.removeItem(storageKey);}catch{}}
  const state=wrap({workspace:'',botId:'',resources:{}});
  function resource(name){
    if(!Object.hasOwn(state.resources,name)){
      const item=initial(),review=[...registry.values()].reverse().find(row=>row.kind==='review'&&row.intent.workspace===state.workspace&&row.intent.botId===state.botId&&row.intent.resource===name),pending=registry.get(scopeKey(state.workspace,state.botId,name))||review;
      if(pending){item.pending=['review','readback','tracking'].includes(pending.kind)?null:copy(pending.intent);item.action=copy(pending.action);item.review=copy(pending.review)||null;item.query=copy(pending.intent.readHints)||{};item.phase=pending.phase||(pending.action?(executionUncertain(pending.action)?'uncertain':'accepted'):'unknown');}
      if(review)item.review=copy(review.review);state.resources[name]=item;
    }
    return state.resources[name];
  }
  function select(workspace,botId){
    if(state.workspace===workspace&&state.botId===botId)return;
    scope.select(workspace,botId);state.workspace=workspace;state.botId=botId;state.resources={};
  }
  function draft(name,value){resource(name).draft=copy(value);}
  function identity(name){return {workspace:state.workspace,botId:state.botId,resource:name};}
  function checked(value,context){
    if(value?.workspace&&value.workspace!==context.workspace||value?.botId&&value.botId!==context.botId)throw new Error('原生资源回执不属于当前员工或工作区');
    return value;
  }
  async function read(name,query){
    if(!state.workspace||!state.botId)return false;
    const item=resource(name),context=identity(name),request=scope.begin('read:'+name);item.loading=true;query=query??item.query;item.query=copy(query);
    try{
      const value=checked(await transport.read({...context,query:copy(query),current:()=>scope.current(request)}),context);
      if(!scope.current(request))return false;
      item.data=value;item.error='';const key=scopeKey(context.workspace,context.botId,name);if(registry.get(key)?.kind==='readback'){registry.delete(key);persist();item.phase='succeeded';item.draft=null;}return true;
    }catch(error){if(scope.current(request)){item.error=botErrorMessage(error);if(registry.get(scopeKey(context.workspace,context.botId,name))?.kind==='readback')item.phase='readback_required';}return false;}
    finally{if(scope.current(request))item.loading=false;}
  }
  function blocked(){return Object.values(state.resources).some(item=>item.busy||item.pending)||[...registry.values()].some(item=>!['review','readback','tracking'].includes(item.kind)&&item.intent.workspace===state.workspace&&item.intent.botId===state.botId);}
  function invalidateRead(name){scope.begin('read:'+name);resource(name).loading=false;}
  function accept(name,key,action,request){
    if(!action?.id||!action.status)throw new Error('操作已受理，但缺少可核对的执行标识或状态');
    const saved=registry.get(key);if(saved)saved.action=copy(action);persist();
    if(!scope.current(request))return false;
    const item=resource(name);item.action=action;item.error='';
    if(executionUncertain(action)){item.phase='uncertain';return false;}
    if(['pending','acked','running','queued'].includes(action.status)){item.phase='accepted';return true;}
    if(!['succeeded','failed','cancelled','expired','rejected'].includes(action.status))throw new Error('尚不认识此原生执行状态，请核对原回执');
    item.result=action.result||null;item.phase=action.status==='succeeded'?'succeeded':/HASH_CONFLICT|REVISION_CONFLICT/.test(action.error||action.result?.code||'')?'conflict':'failed';
    const receipt=action.result?.nativeOperation||action.result?.result?.nativeOperation;
    if(action.status==='succeeded'&&(receipt?.data?.staged||receipt?.data?.pending_id||receipt?.data?.status==='staged'||receipt?.data?.mutation?.staged||receipt?.data?.mutation?.pending_id)){
      item.phase='staged';item.pending=null;item.review={actionId:action.id,pendingId:receipt.data.pending_id||receipt.data.mutation?.pending_id||null,scope:receipt.data.scope||saved?.intent.readHints?.scope||'memory',nativeVersion:receipt.nativeVersion,status:'requires_authorization'};if(saved){saved.kind='review';saved.phase='staged';saved.review=copy(item.review);delete saved.intent.input;registry.delete(key);registry.set(key+':review:'+saved.intent.idempotencyKey,saved);}persist();return false;
    }
    if(action.status==='succeeded'&&['requires_dependency','requires_authorization'].includes(receipt?.status)){
      item.phase=receipt.status;item.error=receipt.data?.reason||receipt.data?.error||'需要补齐授权或依赖';registry.delete(key);persist();item.pending=null;return false;
    }
    item.error=action.status==='succeeded'?'':action.error||'原生操作未完成，请查看这次执行记录';
    if(action.status==='succeeded'){if(saved){saved.kind='readback';saved.phase='readback_required';}item.phase='readback_required';}else registry.delete(key);persist();item.pending=null;return action.status==='succeeded';
  }
  async function trackCollaboration(name,key,pending,actions,request){
    pending.kind='tracking';pending.phase='dispatched';pending.intent.readHints={...pending.intent.readHints,actionRefs:actions.map(action=>({id:action.id,employeeId:action.payload.employeeId,sourceActionId:pending.intent.readHints?.sourceActionId||pending.intent.input?.sourceActionId}))};registry.set(key,pending);persist();
    if(!scope.current(request))return false;const item=resource(name);item.pending=null;item.phase='dispatched';item.query=copy(pending.intent.readHints);await read(name,item.query);return true;
  }
  async function execute(name,pending,{recovering=false}={}){
    const item=resource(name),context=identity(name),key=scopeKey(context.workspace,context.botId,name),request=scope.begin('write:'+name);
    invalidateRead(name);item.busy=true;item.error='';item.phase='submitting';item.pending=copy(pending.intent);registry.set(key,pending);persist();
    let accepted=false;
    try{
      const receipt=await transport.submit(copy(pending.intent));accepted=true;
      if(receipt?.kind==='collaboration')return trackCollaboration(name,key,pending,receipt.actions,request);
      if(receipt?.kind==='action'){
        const ok=accept(name,key,receipt.action,request);
        if(scope.current(request)&&resource(name).phase==='readback_required')return await read(name);
        return ok;
      }
      if(receipt?.kind!=='snapshot')throw new Error('操作回执格式未确认，请保留原请求标识');
      if(!scope.current(request))return false;
      invalidateRead(name);
      const snapshot=checked(await transport.read({...context,query:{}}),context);
      if(!scope.current(request))return false;
      if(receipt.snapshot?.revision!=null&&snapshot?.revision<receipt.snapshot.revision)throw new Error('原生配置读回版本落后于保存回执');
      item.data=snapshot;item.phase='succeeded';item.pending=null;item.draft=null;registry.delete(key);persist();return true;
    }catch(error){
      if(scope.current(request)){
        if(!accepted&&!error.accepted&&!recovering&&error.status&&error.status<500&&error.status!==408&&!/IDEMPOTENCY.*CONFLICT/i.test(error.code||'')){registry.delete(key);item.pending=null;item.phase=error.status===409?'conflict':'failed';}
        else item.phase='unknown';
        persist();item.error=botErrorMessage(error,{mutation:accepted||!error.status});
      }
      return false;
    }finally{if(scope.current(request))item.busy=false;}
  }
  async function submit(name,operation,input={}){
    if(!state.workspace||!state.botId||blocked())return false;
    const item=resource(name);if(item.phase==='readback_required'){item.error='先读回当前状态，再提交下一次修改。';return false;}
    const hintKeys={memory:['scope'],mcp:['server'],skillDetail:['name'],kanbanDetail:['taskId'],sessions:['sessionId'],collaboration:['sourceActionId','targetEmployeeIds']}[name]||[];
    const readHints=Object.fromEntries(Object.entries(input).filter(([key])=>hintKeys.includes(key)));
    let intent={...identity(name),operation,input:copy(input),readHints,idempotencyKey:keyFactory(),expectedRevision:item.data?.revision??null};
    try{if(transport.freeze)intent=transport.freeze(intent);}catch(error){item.error=botErrorMessage(error);item.phase='failed';return false;}
    return execute(name,{intent,action:null});
  }
  async function poll(name){
    const item=resource(name),context=identity(name),key=scopeKey(context.workspace,context.botId,name),pending=registry.get(key);
    if(item.busy||!pending?.action?.id)return false;
    const request=scope.begin('poll:'+name);item.busy=true;
    try{
      const action=await transport.action({...pending.intent,...context,actionId:pending.action.id});
      if(action?.id!==pending.action.id)throw new Error('回执执行标识与原请求不一致');
      const ok=accept(name,key,action,request);
      if(scope.current(request)&&resource(name).phase==='readback_required')return await read(name,pending.intent.readHints);return ok;
    }catch(error){if(scope.current(request))item.error=botErrorMessage(error);return false;}
    finally{if(scope.current(request))item.busy=false;}
  }
  async function recover(name){
    const key=scopeKey(state.workspace,state.botId,name),pending=registry.get(key);
    if(!pending||resource(name).busy)return false;
    if(['readback','review','tracking'].includes(pending.kind))return read(name,pending.intent.readHints);
    if(pending.action?.id)return poll(name);
    if(pending.replayable===false||transport.lookup||name==='collaboration'&&pending.intent.readHints?.sourceActionId){
      if(!transport.lookup){resource(name).error='原请求正文未缓存；请在运行记录定位原请求，不重发新意图。';return false;}
      const request=scope.begin('recover:'+name);resource(name).busy=true;
      try{const original=await transport.lookup(pending.intent);if(original?.kind==='collaboration')return await trackCollaboration(name,key,pending,original.actions,request);const ok=accept(name,key,original,request);if(scope.current(request)&&resource(name).phase==='readback_required')return await read(name,pending.intent.readHints);return ok;}catch(error){if(scope.current(request))resource(name).error=botErrorMessage(error);return false;}finally{if(scope.current(request))resource(name).busy=false;}
    }
    return execute(name,pending,{recovering:true});
  }
  function dispose(){scope.dispose();}
  function pending(){return [...registry.values()].filter(item=>!['readback','review','tracking'].includes(item.kind)&&item.intent.workspace===state.workspace&&item.intent.botId===state.botId).map(item=>Object.fromEntries(Object.entries(item.intent).filter(([key])=>key!=='input')));}
  return {state,resource,select,draft,read,submit,poll,recover,blocked,pending,dispose};
}
