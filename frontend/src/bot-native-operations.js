import {createBotRequestScope,botErrorMessage} from './bot-state.js';
import {executionUncertain} from './bot-presentation.js';

const copy=value=>value==null?value:JSON.parse(JSON.stringify(value));
const scopeKey=(workspace,botId,resource)=>JSON.stringify([workspace,botId,resource]);
const initial=()=>({data:null,draft:null,query:{},loading:false,busy:false,phase:'idle',error:'',action:null,result:null,pending:null});

// Internal UI transport. The HTTP adapter must map only the stable E02 contract
// into read/submit/action; these names are not proposed server endpoints.
export function createBotNativeOperations({transport,wrap=value=>value,keyFactory=()=>crypto.randomUUID()}){
  const scope=createBotRequestScope();
  const registry=new Map();
  const state=wrap({workspace:'',botId:'',resources:{}});
  function resource(name){
    if(!Object.hasOwn(state.resources,name)){
      const item=initial(),pending=registry.get(scopeKey(state.workspace,state.botId,name));
      if(pending){item.pending=copy(pending.intent);item.action=copy(pending.action);item.phase=pending.action?(executionUncertain(pending.action)?'uncertain':'accepted'):'unknown';}
      state.resources[name]=item;
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
      item.data=value;item.error='';return true;
    }catch(error){if(scope.current(request))item.error=botErrorMessage(error);return false;}
    finally{if(scope.current(request))item.loading=false;}
  }
  function blocked(){return Object.values(state.resources).some(item=>item.busy||item.pending);}
  function invalidateRead(name){scope.begin('read:'+name);resource(name).loading=false;}
  function accept(name,key,action,request){
    if(!action?.id||!action.status)throw new Error('操作已受理，但缺少可核对的执行标识或状态');
    const saved=registry.get(key);if(saved)saved.action=copy(action);
    if(!scope.current(request))return false;
    const item=resource(name);item.action=action;item.error='';
    if(executionUncertain(action)){item.phase='uncertain';return false;}
    if(['pending','acked','running','queued'].includes(action.status)){item.phase='accepted';return true;}
    if(!['succeeded','failed','cancelled','expired','rejected'].includes(action.status))throw new Error('尚不认识此原生执行状态，请核对原回执');
    item.result=action.result||null;item.phase=action.status==='succeeded'?'succeeded':'failed';
    item.error=action.status==='succeeded'?'':action.error||'原生操作未完成，请查看这次执行记录';
    registry.delete(key);item.pending=null;return action.status==='succeeded';
  }
  async function execute(name,pending){
    const item=resource(name),context=identity(name),key=scopeKey(context.workspace,context.botId,name),request=scope.begin('write:'+name);
    invalidateRead(name);item.busy=true;item.error='';item.phase='submitting';item.pending=copy(pending.intent);registry.set(key,pending);
    let accepted=false;
    try{
      const receipt=await transport.submit(copy(pending.intent));accepted=true;
      if(receipt?.kind==='action'){
        const ok=accept(name,key,receipt.action,request);
        if(scope.current(request)&&resource(name).phase==='succeeded')await read(name);
        return ok;
      }
      if(receipt?.kind!=='snapshot')throw new Error('操作回执格式未确认，请保留原请求标识');
      if(!scope.current(request))return false;
      invalidateRead(name);
      const snapshot=checked(await transport.read({...context,query:{}}),context);
      if(!scope.current(request))return false;
      if(receipt.snapshot?.revision!=null&&snapshot?.revision<receipt.snapshot.revision)throw new Error('原生配置读回版本落后于保存回执');
      item.data=snapshot;item.phase='succeeded';item.pending=null;item.draft=null;registry.delete(key);return true;
    }catch(error){
      if(scope.current(request)){
        if(!accepted&&error.status){registry.delete(key);item.pending=null;item.phase=error.status===409?'conflict':'failed';}
        else item.phase='unknown';
        item.error=botErrorMessage(error,{mutation:accepted||!error.status});
      }
      return false;
    }finally{if(scope.current(request))item.busy=false;}
  }
  async function submit(name,operation,input={}){
    if(!state.workspace||!state.botId||blocked())return false;
    const item=resource(name),intent={...identity(name),operation,input:copy(input),idempotencyKey:keyFactory(),expectedRevision:item.data?.revision??null};
    return execute(name,{intent,action:null});
  }
  async function poll(name){
    const item=resource(name),context=identity(name),key=scopeKey(context.workspace,context.botId,name),pending=registry.get(key);
    if(item.busy||!pending?.action?.id)return false;
    const request=scope.begin('poll:'+name);item.busy=true;
    try{
      const action=await transport.action({...context,actionId:pending.action.id,idempotencyKey:pending.intent.idempotencyKey});
      if(action?.id!==pending.action.id)throw new Error('回执执行标识与原请求不一致');
      const ok=accept(name,key,action,request);
      if(scope.current(request)&&resource(name).phase==='succeeded')await read(name);return ok;
    }catch(error){if(scope.current(request))item.error=botErrorMessage(error);return false;}
    finally{if(scope.current(request))item.busy=false;}
  }
  async function recover(name){
    const key=scopeKey(state.workspace,state.botId,name),pending=registry.get(key);
    if(!pending||resource(name).busy)return false;
    return pending.action?.id?poll(name):execute(name,pending);
  }
  function dispose(){scope.dispose();}
  return {state,resource,select,draft,read,submit,poll,recover,blocked,dispose};
}
