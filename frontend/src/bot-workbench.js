import {executionUncertain,botPresence,capabilityPresentation,botStopPresentation,botRecoveryEvent} from './bot-presentation.js';
export {executionUncertain,botPresence,capabilityPresentation};
import {createBotRequestScope, botErrorMessage} from './bot-state.js';
import {employeeRemovalNotice} from './employee-removal.js';

const clone = value => JSON.parse(JSON.stringify(value));
const pendingRuns=new Map();
function pendingKey(workspace,id){return `ziwei.bot.pending.${encodeURIComponent(workspace)}.${encodeURIComponent(id)}`;}
function readPending(key){try{const stored=JSON.parse(sessionStorage.getItem(key));if(stored?.kind==='routine_run')return stored;}catch{}return pendingRuns.get(key)||null;}
function writePending(key,value){if(value)pendingRuns.set(key,value);else pendingRuns.delete(key);try{if(value)sessionStorage.setItem(key,JSON.stringify(value));else sessionStorage.removeItem(key);}catch{}}
export const defaultBotConfig = () => ({provider:null,toolsets:[],maxTurns:20,memory:{enabled:true,userProfile:true},skills:{disabled:[]},mcpServers:{},permissions:{mode:'read_only'}});
export function botDraft(bot) {
  const employee=bot.employee || {};
  return {revision:bot.revision,employee:{name:employee.name || '',description:employee.description || '',instructions:employee.instructions || '',persona:employee.persona || '',avatar:employee.avatar || null,visibility:employee.visibility || 'personal',model:employee.model_id || null,skills:[...(employee.skills || [])]},config:clone(bot.config)};
}
export function createBotWorkbench({api,wrap=value=>value}) {
  const scope=createBotRequestScope();let workspaceGeneration=0,listGeneration=0;
  const state=wrap({workspace:'',selectedId:'',bots:[],bot:null,draft:null,runs:[],routines:[],loading:false,reading:false,busy:false,error:'',errorCode:'',notice:'',conflict:false,writeUnknown:false,pendingOperation:null});
  const apply = bot => {
    if (!bot || bot.id!==state.selectedId || (bot.workspace && bot.workspace!==state.workspace)) throw new Error('Bot 响应归属与当前选择不一致');
    state.bot=bot;
    const index=state.bots.findIndex(item=>item.id===bot.id);
    if(index>=0)state.bots.splice(index,1,bot);else state.bots.push(bot);
  };
  async function list() {
    const workspace=state.workspace,generation=workspaceGeneration,request=++listGeneration;state.loading=true;
    try {const result=await api.bots(workspace);if(generation===workspaceGeneration&&request===listGeneration){state.bots=(result.bots || []).map(bot=>bot.id===state.bot?.id&&(bot.revision<state.bot.revision || (bot.revision===state.bot.revision&&bot.control_epoch<state.bot.control_epoch))?state.bot:bot);}}
    catch(error){if(generation===workspaceGeneration)state.error=botErrorMessage(error);}
    finally{if(generation===workspaceGeneration&&request===listGeneration)state.loading=false;}
  }
  async function refresh({resetDraft=false}={}) {
    if(!state.selectedId)return;
    const request=scope.begin('read'),workspace=state.workspace,id=state.selectedId;state.reading=true;
    let results;
    try{
      const bot=await api.bot(id,workspace);
      if(!scope.current(request))return;
      const records=bot.configuration_state==='uninitialized'?[{status:'fulfilled',value:{runs:[]}},{status:'fulfilled',value:{routines:[]}}]:await Promise.allSettled([api.botRuns(id,workspace),api.botRoutines(id,workspace)]);
      results=[{status:'fulfilled',value:bot},...records];
    }catch(error){results=[{status:'rejected',reason:error}];}
    if(!scope.current(request))return;
    try {
      if(results[0].status==='rejected')throw results[0].reason;
      apply(results[0].value);
      if(!state.pendingOperation&&results.length===3&&results.every(result=>result.status==='fulfilled'))state.writeUnknown=false;
      if(resetDraft || !state.draft){state.draft=botDraft(state.bot);state.conflict=false;}
      if(results[1].status==='fulfilled')state.runs=results[1].value.runs || [];
      if(results[2].status==='fulfilled')state.routines=results[2].value.routines || [];
      const partial=results.slice(1).find(result=>result.status==='rejected');
      state.error=partial?`部分记录未能刷新：${botErrorMessage(partial.reason)}`:'';
    }catch(error){state.error=botErrorMessage(error);}
    finally{state.reading=false;}
  }
  async function select(id) {
    if(state.selectedId===id && state.bot)return;
    scope.select(state.workspace,id);state.selectedId=id;state.bot=null;state.draft=null;state.runs=[];state.routines=[];state.error='';state.errorCode='';state.notice='';state.conflict=false;state.writeUnknown=false;state.busy=false;
    state.pendingOperation=readPending(pendingKey(state.workspace,id));state.writeUnknown=Boolean(state.pendingOperation);
    if(id)await refresh({resetDraft:true});
  }
  async function setWorkspace(workspace,id='') {
    workspaceGeneration++;state.workspace=workspace;state.bots=[];state.selectedId='';
    await Promise.all([select(id),list()]);
  }
  async function mutate(operation,notice,{readback=false,resetDraft=false,recovering=false}={}) {
    if(state.busy || (state.writeUnknown&&!recovering) || !state.bot)return false;
    const request=scope.begin('write'),workspace=state.workspace,id=state.selectedId;
    scope.begin('read');state.reading=false;
    state.busy=true;state.error='';state.errorCode='';state.notice='';
    let accepted=false;
    try {
      const result=await operation(id,workspace);accepted=true;
      if(!scope.current(request))return false;
      scope.begin('read');state.reading=false;
      if(readback){
        const persisted=await api.bot(id,workspace);
        if(!scope.current(request))return false;
        if(result?.revision && persisted.revision<result.revision)throw new Error('读回配置版本落后于保存回执');
        apply(persisted);
      } else if(result?.id===id && result?.employee)apply(result);
      if(resetDraft){state.draft=botDraft(state.bot);state.conflict=false;}
      state.notice=typeof notice==='function'?notice(state.bot,result):notice;
      return true;
    }catch(error){
      if(scope.current(request)){
        state.error=accepted?`操作已受理，但读回未确认。${botErrorMessage(error)}`:botErrorMessage(error,{mutation:true});
        state.errorCode=error.code||'';
        state.conflict=error.status===409&&(!error.code||error.code==='BOT_REVISION_CONFLICT');state.writeUnknown=accepted || !error.status;
      }
      return false;
    }finally{if(scope.current(request))state.busy=false;}
  }
  async function initialize(){
    if(state.bot?.configuration_state!=='uninitialized')return false;
    if(state.busy||state.writeUnknown)return false;
    const config=clone(state.draft.config);
    const idempotencyKey='bot-initialize-'+state.selectedId;
    return mutate((id,workspace)=>api.initializeEmployeeBot(id,{idempotencyKey,config},workspace),'原员工 Bot 能力已初始化并读回。员工 ID 和既有聊天保持；请检查并启用。',{readback:true,resetDraft:true});
  }
  async function removeEmployee({force=false}={}) {
    const request=scope.begin('remove'),target=state.selectedId;let receipt;
    const ok=await mutate(async(id,workspace)=>{receipt=await api.deleteEmployee(id,workspace,force?{force:true}:{});if(receipt?.deleted!==true)throw new Error('删除结果未确认，请刷新员工列表后核对。');return receipt;},()=>employeeRemovalNotice(receipt));
    if(!ok||!scope.current(request))return false;
    const notice=state.notice;state.bots=state.bots.filter(bot=>bot.id!==target);void select('');state.notice=notice;
    return true;
  }
  async function save() {
    if(!state.draft)return false;
    const draft=clone(state.draft);
    draft.config.provider=draft.config.provider?.trim() || null;
    return mutate((id,workspace)=>api.updateBot(id,{expectedRevision:draft.revision,employee:draft.employee,config:draft.config},workspace),'配置已保存并读回。仅作用于当前 Bot；生效范围与是否需要重新检查见服务端状态。',{readback:true,resetDraft:true});
  }
  async function control(operation) {
    const revision=state.bot?.revision,epoch=state.bot?.control_epoch;
    return mutate((id,workspace)=>api.controlBot(id,{expectedRevision:revision,expectedControlEpoch:epoch,operation},workspace),operation==='stop'?bot=>botStopPresentation(bot).label:operation==='pause'?'Bot 已暂停；已有执行仍需单独确认。':'启用请求已受理；运行与工具生效仍以实际回执为准。');
  }
  async function reconcile(run) {
    if(state.busy || state.writeUnknown || !state.bot)return false;
    const event=botRecoveryEvent(run);
    if(!event || !state.runs.some(item=>item.id===run.id))return false;
    const request=scope.begin('reconcile'),revision=state.bot?.revision,epoch=state.bot?.control_epoch;
    const ok=await mutate((botId,slug)=>api.reconcileBotAction(botId,run.id,{eventId:event.id,expectedRevision:revision,expectedControlEpoch:epoch},slug),'服务端已核实并恢复原执行回执。');
    if(scope.current(request)){const error=state.error;await refresh();if(scope.current(request)&&!ok)state.error=error;}
    return ok;
  }
  async function validate() {
    const revision=state.bot?.revision,key=`bot-validate-${state.selectedId}-${revision}-${crypto.randomUUID()}`;
    const ok=await mutate((id,workspace)=>api.validateBot(id,{expectedRevision:revision,idempotencyKey:key},workspace),'配置检查已提交；这是无模型检查，请等待回执。');
    if(ok)await refresh();return ok;
  }
  async function runRoutine(routineId,{recovering=false}={}) {
    if(!state.bot||state.busy||(state.writeUnknown&&!recovering))return false;
    const workspace=state.workspace,id=state.selectedId,key=pendingKey(workspace,id);
    const previous=readPending(key);
    if(previous&&previous.routineId!==routineId){state.error='这个 Bot 还有另一项 Routine 请求待核实。';return false;}
    const pending=previous||{kind:'routine_run',workspace,id,routineId,idempotencyKey:`routine-run-${crypto.randomUUID()}`};
    writePending(key,pending);
    const ok=await mutate((botId,slug)=>api.runBotRoutine(botId,routineId,{idempotencyKey:pending.idempotencyKey},slug),'原 Routine 请求已取得服务端回执。请查看原执行记录与主聊天结果。',{recovering});
    // A navigation never permits this response to change the new selection.
    if(state.workspace!==workspace||state.selectedId!==id)return ok;
    if(ok||(!state.writeUnknown&&!recovering)){writePending(key,null);state.pendingOperation=null;state.writeUnknown=false;}
    else {state.pendingOperation=pending;state.writeUnknown=true;}
    if(ok)await refresh();return ok;
  }
  async function recoverRoutine(){const pending=state.pendingOperation;if(pending?.kind==='routine_run')return runRoutine(pending.routineId,{recovering:true});return false;}
  function dispose(){workspaceGeneration++;scope.dispose();}
  return {state,setWorkspace,select,list,refresh,initialize,removeEmployee,save,control,reconcile,validate,mutate,runRoutine,recoverRoutine,dispose};
}
