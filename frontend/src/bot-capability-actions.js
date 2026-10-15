const tabs=new Set(['settings','knowledge','collaboration','channels','routines','proactive','activity','chat','capabilities']);
const destinations={
  bot_identity:['settings','配置身份'],model_provider:['settings','配置模型'],persistent_chat:['chat','打开主聊天'],
  profile_memory:['knowledge','管理记忆','原生记忆'],session_search:['knowledge','检索会话','原生会话检索'],
  skills:['knowledge','管理技能','原生技能管理'],tools_mcp:['knowledge','添加 MCP','原生 MCP 与工具'],
  groups_mentions:['collaboration','选择伙伴','Bot 协作'],delegation:['collaboration','选择伙伴','Bot 协作'],
  gateway:['channels','连接渠道','Gateway 渠道'],voice:['channels','配置语音','原生语音与音频'],
  goals:['proactive','管理目标','原生 Goals'],heartbeat:['proactive','设置主动检查','原生 Heartbeat'],kanban:['proactive','打开工作板','原生 Kanban'],
  routines:['routines','添加例行工作'],observability:['activity','查看运行记录'],multimodal:['chat','打开主聊天'],
};
export function botCapabilityAction(capability) {
  const action=capability?.action;
  if(action){
    if(!['navigate','enable','validate','activate'].includes(action.kind)||!tabs.has(action.tab)||!action.label)return null;
    if(action.kind==='enable'&&!['memory','tools_permission','collaboration'].includes(action.key))return null;
    return {...action,label:action.kind==='enable'&&action.key==='tools_permission'?'允许使用工具':action.label};
  }
  if(capability?.state || capability?.action===null)return null;
  const target=destinations[capability?.id];
  return capability?.configurable&&target?{kind:'navigate',tab:target[0],label:target[1]}:null;
}
export function botCapabilityDestination(capability) {
  const action=botCapabilityAction(capability),target=destinations[capability?.id];
  if(!action)return null;
  return {tab:action.tab,selector:capability?.id==='bot_identity'&&action.tab==='settings'?'[aria-label="岗位职责"]':target?.[0]===action.tab&&target[2]?`[aria-label="${target[2]}"]`:action.tab==='settings'?'[aria-label="Bot 模型"]':'.bot-form-section'};
}
export function enabledCapabilityConfig(bot,key) {
  const config=JSON.parse(JSON.stringify(bot.config));
  if(key==='memory')config.memory={...config.memory,enabled:true};
  else if(key==='tools_permission')config.permissions={...config.permissions,mode:'execute'};
  else if(key==='collaboration'){
    if(config.permissions?.mode!=='execute')throw new Error('请先明确允许使用工具，再开启伙伴协作。');
    if(!config.collaboration?.targetEmployeeIds?.length)throw new Error('请先选择协作伙伴，再开启协作。');
    config.collaboration={...config.collaboration,enabled:true};
  }else throw new Error('此能力需要前往对应设置完成配置。');
  return config;
}
export function capabilitySavedEnabled(bot,key) {return key==='memory'?bot?.config?.memory?.enabled===true:key==='tools_permission'?bot?.config?.permissions?.mode==='execute':key==='collaboration'?bot?.config?.collaboration?.enabled===true:false;}
export function focusCapabilityTarget(root,selector) {
  const node=selector?root?.querySelector(selector):null;if(!node)return false;
  for(let parent=node;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
  node.scrollIntoView?.({block:'center',behavior:'smooth'});
  const control=node.matches?.('input,button,select,textarea,[tabindex]')?node:node.querySelector?.('input,button,select,textarea,[tabindex]');
  if(control)control.focus({preventScroll:true});
  return true;
}
