import {executionUncertain,botPresence,capabilityPresentation,botStopPresentation,botRecoveryEvent} from './bot-presentation.js';
export {executionUncertain,botPresence,capabilityPresentation};
import {createBotRequestScope, botErrorMessage} from './bot-state.js';
import {employeeRemovalNotice} from './employee-removal.js';
import {failureFinalizationRequest,pendingBotFailureFinalization} from './bot-failure-finalization.mjs';
import {enabledCapabilityConfig,capabilitySavedEnabled} from './bot-capability-actions.js';
import {createDefaultBotConfig} from '../../src/hermes-bot-config.mjs';
import {inventoryEmployeeBindingChanged} from './employee-capability-inventory.js';

const clone = value => JSON.parse(JSON.stringify(value));
const pendingRuns=new Map();
function pendingKey(workspace,id){return `ziwei.bot.pending.${encodeURIComponent(workspace)}.${encodeURIComponent(id)}`;}
function readPending(key){try{const stored=JSON.parse(sessionStorage.getItem(key));if(stored?.kind==='routine_run')return stored;}catch{}return pendingRuns.get(key)||null;}
function writePending(key,value){if(value)pendingRuns.set(key,value);else pendingRuns.delete(key);try{if(value)sessionStorage.setItem(key,JSON.stringify(value));else sessionStorage.removeItem(key);}catch{}}
export const defaultBotConfig = () => createDefaultBotConfig();
export function botDraft(bot) {
  const employee=bot.employee || {};
  return {revision:bot.revision,employee:{name:employee.name || '',description:employee.description || '',instructions:employee.instructions || '',persona:employee.persona || '',avatar:employee.avatar || null,visibility:employee.visibility || 'personal',model:employee.model_id || null,skills:[...(employee.skills || [])]},config:clone(bot.config)};
}
export function botDraftDirty(bot,draft) {return Boolean(bot&&draft&&JSON.stringify(draft)!==JSON.stringify(botDraft(bot)));}
export function botWorkbenchReadOptions(tab) {return {runs:tab==='activity',routines:tab==='chat'||tab==='routines'};}
export const botRosterRuntime=bot=>bot?.employee?.runtime||bot?.runtime||'unconfigured';
export function botRosterPresence(bot){
  if(botRosterRuntime(bot)==='Hermes')return botPresence(bot);
  if(botRosterRuntime(bot)==='unconfigured')return{label:'待配置运行时',tone:'muted'};
  return{label:({active:'员工已启用',paused:'已暂停',archived:'已归档',draft:'待配置'})[bot.employee?.status]||'员工状态待核实',tone:'muted'};
}
export function botRosterRuntimeOptions(bots=[]) {return [{value:'all',label:'全部'},...[...new Set(bots.map(botRosterRuntime))].map(value=>({value,label:value==='unconfigured'?'未配置运行时':value}))];}
export function filterBotRoster(bots=[],{runtime='all',search=''}={}) {const query=search.trim().toLowerCase();return bots.filter(bot=>(runtime==='all'||botRosterRuntime(bot)===runtime)&&`${bot.employee?.name||''} ${bot.employee?.description||''} ${botRosterRuntime(bot)}`.toLowerCase().includes(query));}
export function createBotWorkbench({api,wrap=value=>value,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),capabilityCheckAttempts=60,getReadOptions=()=>({runs:true,routines:true}),onEmployeeSelect=()=>{}}) {
  const scope=createBotRequestScope();let workspaceGeneration=0,listGeneration=0;
  const state=wrap({workspace:'',selectedId:'',bots:[],bot:null,draft:null,runs:[],routines:[],loading:false,reading:false,recordsReading:false,busy:false,capabilityBusy:false,error:'',errorCode:'',notice:'',conflict:false,writeUnknown:false,pendingOperation:null});
  const apply = bot => {
    if (!bot || bot.id!==state.selectedId || (bot.workspace && bot.workspace!==state.workspace)) throw new Error('Bot 响应归属与当前选择不一致');
    state.bot=bot;
    const index=state.bots.findIndex(item=>item.id===bot.id);
    if(index>=0)state.bots.splice(index,1,bot);else state.bots.push(bot);
  };
  async function list() {
    const workspace=state.workspace,generation=workspaceGeneration,request=++listGeneration;state.loading=true;
    try {const result=await api.bots(workspace);if(generation===workspaceGeneration&&request===listGeneration){state.bots=(result.bots || []).map(bot=>bot.id===state.bot?.id&&!inventoryEmployeeBindingChanged(state.bot.employee,bot.employee)&&(bot.revision<state.bot.revision || (bot.revision===state.bot.revision&&bot.control_epoch<state.bot.control_epoch))?state.bot:bot);}}
    catch(error){if(generation===workspaceGeneration)state.error=botErrorMessage(error);}
    finally{if(generation===workspaceGeneration&&request===listGeneration)state.loading=false;}
  }
  const getBot=(id,workspace)=>(api.botWorkbench||api.bot).call(api,id,workspace);
  function readOptions(overrides={}) {const defaults=getReadOptions()||{};return {runs:overrides.runs??defaults.runs??true,routines:overrides.routines??defaults.routines??true};}
  async function loadRecords(options={}, {readRequest=null,confirmUnknown=false}={}) {
    if(!state.bot||!state.selectedId||state.bot.configuration_state==='uninitialized')return;
    const request=scope.begin('records'),workspace=state.workspace,id=state.selectedId;
    const current=()=>scope.current(request)&&(!readRequest||scope.current(readRequest));
    const selected=readOptions(options),names=['runs','routines'].filter(name=>selected[name]);
    if(!names.length){state.recordsReading=false;return;}
    state.recordsReading=true;
    const results=await Promise.allSettled(names.map(name=>Promise.resolve().then(()=>name==='runs'?api.botRuns(id,workspace):api.botRoutines(id,workspace))));
    if(!current())return;
    try {
      for(let index=0;index<names.length;index++)if(results[index].status==='fulfilled')state[names[index]]=results[index].value[names[index]]||[];
      const partial=results.find(result=>result.status==='rejected');
      if(partial)state.error=`部分记录未能刷新：${botErrorMessage(partial.reason)}`;
      else if(state.error.startsWith('部分记录未能刷新：'))state.error='';
      // Unknown writes require the same complete readback as before; a lazy
      // tab read alone cannot prove that an earlier mutation has settled.
      if(confirmUnknown&&!state.pendingOperation&&selected.runs&&selected.routines&&!partial)state.writeUnknown=false;
    }finally{if(current())state.recordsReading=false;}
  }
  async function refresh({resetDraft=false,...options}={}) {
    if(!state.selectedId)return;
    const request=scope.begin('read'),workspace=state.workspace,id=state.selectedId;scope.begin('records');state.recordsReading=false;state.reading=true;
    try {
      const bot=await getBot(id,workspace);
      if(!scope.current(request))return;
      apply(bot);
      if(resetDraft||!state.draft){state.draft=botDraft(state.bot);state.conflict=false;}
      state.error='';state.reading=false;
      if(bot.configuration_state==='uninitialized'){
        state.runs=[];state.routines=[];if(!state.pendingOperation)state.writeUnknown=false;return;
      }
      const selected=readOptions(options);
      if(state.writeUnknown&&!state.pendingOperation){selected.runs=true;selected.routines=true;}
      // A stop may refer to an older execution rather than latest_run. Keep
      // its exact target proof available even outside the activity tab.
      if(bot.stop_action?.payload?.actionId&&bot.stop_action.payload.actionId!==bot.latest_run?.id)selected.runs=true;
      await loadRecords(selected,{readRequest:request,confirmUnknown:true});
    }catch(error){if(scope.current(request))state.error=botErrorMessage(error);}
    finally{if(scope.current(request))state.reading=false;}
  }
  async function select(id) {
    const rosterEntry=state.bots.find(item=>item.id===id);
    if(rosterEntry&&botRosterRuntime(rosterEntry)!=='Hermes'){
      scope.select(state.workspace,'');state.selectedId='';state.bot=null;state.draft=null;state.runs=[];state.routines=[];
      state.reading=false;state.recordsReading=false;state.error='';state.pendingOperation=null;state.writeUnknown=false;
      await onEmployeeSelect({workspace:state.workspace,employee:rosterEntry.employee,conversationId:rosterEntry.main_conversation_id||null});return;
    }
    if(state.selectedId===id && state.bot)return;
    scope.select(state.workspace,id);state.selectedId=id;state.bot=null;state.draft=null;state.runs=[];state.routines=[];state.reading=false;state.recordsReading=false;state.error='';state.errorCode='';state.notice='';state.conflict=false;state.writeUnknown=false;state.busy=false;state.capabilityBusy=false;
    state.pendingOperation=readPending(pendingKey(state.workspace,id));state.writeUnknown=Boolean(state.pendingOperation);
    if(id)await refresh({resetDraft:true});
  }
  async function setWorkspace(workspace,id='') {
    workspaceGeneration++;state.workspace=workspace;state.bots=[];state.selectedId='';
    const generation=workspaceGeneration,clearing=select(''),selection=state.selectedId,listing=list();await clearing;await listing;
    if(generation===workspaceGeneration&&state.selectedId===selection&&id)await select(id);
  }
  async function mutate(operation,notice,{readback=false,resetDraft=false,recovering=false,verifyReadback=null}={}) {
    if(state.busy || (state.writeUnknown&&!recovering) || !state.bot)return false;
    const request=scope.begin('write'),workspace=state.workspace,id=state.selectedId;
    scope.begin('read');scope.begin('records');state.reading=false;state.recordsReading=false;
    state.busy=true;state.error='';state.errorCode='';state.notice='';
    let accepted=false;
    try {
      const result=await operation(id,workspace);accepted=true;
      if(!scope.current(request))return false;
      scope.begin('read');scope.begin('records');state.reading=false;state.recordsReading=false;
      if(readback){
        const persisted=await getBot(id,workspace);
        if(!scope.current(request))return false;
        if(result?.revision && persisted.revision<result.revision)throw new Error('读回配置版本落后于保存回执');
        if(verifyReadback)verifyReadback(persisted,result);
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
    // Avatar URLs identify the saved image; only changed image data or an
    // explicit removal may be sent back as a replacement.
    if((draft.employee.avatar??null)===(state.bot?.employee?.avatar??null))delete draft.employee.avatar;
    draft.config.provider=draft.config.provider?.trim() || null;
    return mutate((id,workspace)=>api.updateBot(id,{expectedRevision:draft.revision,employee:draft.employee,config:draft.config},workspace),'配置已保存。',{readback:true,resetDraft:true});
  }
  async function enableCapability(key) {
    if(!state.bot||state.busy||state.capabilityBusy||state.writeUnknown)return false;
    if(botDraftDirty(state.bot,state.draft)){state.error='有未保存的修改，请先保存当前草稿，再开启此能力。';return false;}
    let config;try{config=enabledCapabilityConfig(state.bot,key);}catch(error){state.error=error.message;return false;}
    const request=scope.begin('capability'),revision=state.bot.revision,wasActive=state.bot.control_state==='active';
    state.capabilityBusy=true;
    try{
      const saved=await mutate((id,workspace)=>api.updateBot(id,{expectedRevision:revision,config},workspace),'设置已保存，正在检查配置。',{readback:true,resetDraft:true,verifyReadback:(bot,response)=>{if(bot.revision!==response?.revision||bot.control_epoch!==response?.control_epoch)throw new Error('配置或控制状态在保存后已变化，请刷新后核对；本次不会继续检查或启用。');if(!capabilitySavedEnabled(bot,key))throw new Error('未能确认此能力设置已保存，请刷新后核对。');}});
      if(!saved||!scope.current(request))return false;
      const savedRevision=state.bot.revision,savedEpoch=state.bot.control_epoch;
      const current=()=>scope.current(request)&&state.bot?.revision===savedRevision&&state.bot?.control_epoch===savedEpoch&&!state.writeUnknown&&!botDraftDirty(state.bot,state.draft);
      if(!current()||!await validate()||!current())return false;
      for(let i=0;i<capabilityCheckAttempts&&current()&&state.bot.validation?.status==='pending';i++){await wait(1000);if(!current())return false;await refresh();}
      if(!current())return false;
      if(state.bot.validation?.status==='pending'){state.notice='设置已保存，配置仍在检查中。完成后可在运行记录启用 Bot。';return false;}
      if(state.bot.validation?.status!=='succeeded'||state.bot.validation.revision!==savedRevision){state.error=state.bot.validation?.error||'配置检查未通过，请查看运行记录后重试。';return false;}
      if(!wasActive){state.notice='设置已保存并通过检查。启用 Bot 后即可使用。';return true;}
      const restored=await mutate((id,workspace)=>api.controlBot(id,{operation:'activate',expectedRevision:savedRevision,expectedControlEpoch:savedEpoch},workspace),bot=>bot.control_state==='active'?'设置已生效，Bot 已恢复工作。':'设置已保存，Bot 尚未恢复工作。');
      return restored;
    }finally{if(scope.current(request))state.capabilityBusy=false;}
  }
  async function control(operation) {
    const revision=state.bot?.revision,epoch=state.bot?.control_epoch;
    return mutate((id,workspace)=>api.controlBot(id,{expectedRevision:revision,expectedControlEpoch:epoch,operation},workspace),operation==='stop'?bot=>botStopPresentation(bot).label:operation==='pause'?'Bot 已暂停；已有执行仍需单独确认。':bot=>bot.control_state==='active'?'Bot 已启用。':'启用状态尚未确认，请刷新。');
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
  async function finalizeFailure(run){
    if(state.busy||state.writeUnknown||!failureFinalizationRequest(state.bot,run)||!state.runs.some(item=>item.id===run.id))return false;
    const request=scope.begin('failure-finalization');
    const ok=await mutate(async(id,workspace)=>{
      const current=await getBot(id,workspace);if(!scope.current(request))throw new Error('当前员工已变化');
      const body=failureFinalizationRequest(current,run);
      return body?api.finalizeBotFailure(id,body,workspace):current;
    },bot=>pendingBotFailureFinalization(bot)?'本轮已失败，系统正在原电脑自动收尾。':'已刷新原执行状态，原始失败回执保留。',{readback:true});
    if(scope.current(request)){const error=state.error;await refresh();if(scope.current(request)&&!ok)state.error=error;}
    return ok;
  }
  async function validate() {
    const revision=state.bot?.revision,key=`bot-validate-${state.selectedId}-${revision}-${crypto.randomUUID()}`;
    const ok=await mutate((id,workspace)=>api.validateBot(id,{expectedRevision:revision,idempotencyKey:key},workspace),'正在检查配置。');
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
  return {state,setWorkspace,select,list,refresh,loadRecords,initialize,removeEmployee,save,enableCapability,control,reconcile,finalizeFailure,validate,mutate,runRoutine,recoverRoutine,dispose};
}
