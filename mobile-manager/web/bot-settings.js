import {workspaceId,scopeKey,employeeName,escapeHtml,id,list} from './model.js';
import {capabilityPresentation} from './bot-presentation.js';

const clone = value => JSON.parse(JSON.stringify(value));
const object = value => Boolean(value && typeof value==='object' && !Array.isArray(value));
const same = (a,b) => JSON.stringify(a)===JSON.stringify(b);
const names = value => [...new Set(String(value || '').split(/[\n,]/).map(item=>item.trim()).filter(Boolean))];
const TOOLSETS = ['web','browser','file','terminal','vision','skills','todo','memory','session_search','code_execution'];
const EFFORTS = ['minimal','low','medium','high','xhigh','max','ultra'];
const checkboxes = ['bot.memory.enabled','bot.memory.userProfile','bot.management'];
function draftOf(employee,bot) {
  return {revision:bot?.revision ?? null,employee:{model:employee.model_id || null,persona:employee.persona || '',instructions:employee.instructions || '',visibility:employee.visibility || 'personal',skills:[...(employee.skills || [])]},config:clone(bot?.config || {}),targetDeviceId:employee.target_device_id || '',runtimeProfile:employee.runtime_profile || ''};
}
function roleOf(state) {
  const slug=workspaceId(state);
  return (typeof state.workspace==='object' ? state.workspace?.role : null) || state.workspaces?.find(item=>item.slug===slug)?.role || state.user?.memberships?.find(item=>item.slug===slug)?.role || '';
}
function phoneConfigurationKnown(settings) {
  const cfg=settings.phoneStatus?.configuration;
  return settings.phoneConfigurationRead===true&&cfg?.employee_id===settings.employeeId&&typeof cfg.enabled==='boolean'&&(!cfg.workspace||cfg.workspace===settings.workspace);
}
function validateDraft(draft,isBot) {
  if(draft.employee.model && (draft.employee.model.length>200 || /[\0\r\n]/.test(draft.employee.model)))throw new Error('模型 ID 格式无效');
  if(!['personal','workspace'].includes(draft.employee.visibility))throw new Error('请选择有效的可见范围');
  if(!isBot)return;
  const config=draft.config;
  if(!Number.isInteger(config.maxTurns) || config.maxTurns<1 || config.maxTurns>100)throw new Error('单次最多轮数应为 1–100');
  if(config.provider!=null && !/^[A-Za-z0-9_.:-]{1,100}$/.test(config.provider))throw new Error('Provider 应是原生服务商名称');
  if(config.reasoningEffort!==undefined && !EFFORTS.includes(config.reasoningEffort))throw new Error('请选择有效的推理强度');
  for(const values of [config.toolsets || [],config.skills?.disabled || [],config.skills?.autoLoad || []])if(values.length>100 || values.some(value=>!/^[A-Za-z0-9_.:/-]{1,160}$/.test(value)))throw new Error('工具集和原生技能请填写有效名称，每行一个');
  if((config.toolsets || []).some(name=>/^(all|cron|heartbeat|goals|kanban|delegate|delegation|bot|bot_mode)$/i.test(name)))throw new Error('请选择具体工具集；主动工作继续使用紫薇统一调度');
  for(const key of ['charLimit','userCharLimit'])if(config.memory?.[key]!==undefined&&(!Number.isInteger(config.memory[key])||config.memory[key]<100||config.memory[key]>50000))throw new Error('记忆字符上限应为 100–50000，或留空');
  if(!['read_only','execute'].includes(config.permissions?.mode))throw new Error('请选择工具权限');
  if(!object(config.mcpServers || {}))throw new Error('MCP 配置必须是服务映射');
  if(Object.keys(config.mcpServers || {}).length>20)throw new Error('最多配置 20 个 MCP 服务');
  if(config.permissions.mode==='read_only'&&((config.toolsets || []).length || Object.values(config.mcpServers || {}).some(server=>server.enabled!==false)))throw new Error('使用工具或 MCP 前，请将工具权限改为“使用已选择的工具”');
  for(const [name,server] of Object.entries(config.mcpServers || {})) {
    if(!/^[a-z][a-z0-9_-]{0,63}$/.test(name)||name.startsWith('ziwei'))throw new Error('MCP 名称应以小写字母开头，且不能使用紫薇保留名称');
    if(!object(server))throw new Error(`${name} 的 MCP 配置无效`);
    const transport=server.transport || (server.url?'http':'stdio');
    if(!['stdio','http','sse'].includes(transport))throw new Error(`${name} 的连接方式无效`);
    if(transport==='stdio'&&!String(server.command || '').trim())throw new Error(`请填写 ${name} 的启动命令`);
    if(transport!=='stdio'){let url;try{url=new URL(server.url);}catch{}if(!url||!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash)throw new Error(`${name} 的服务地址无效或含有凭据`);}
    if(!Array.isArray(server.args || []) || (server.args || []).some(value=>typeof value!=='string'||/[\0\r\n]/.test(value)))throw new Error(`${name} 的参数应每行一个`);
    for(const field of ['env','headers']) {
      if(!object(server[field] || {}))throw new Error(`${name} 的${field==='env'?'环境变量':'请求头'}应是 JSON 对象`);
      for(const [key,value] of Object.entries(server[field] || {}))if(!/^\$\{[A-Z][A-Z0-9_]*\}$/.test(value)||/^(ZIWEI_|CONTROL_MCP_|HERMES_|PYTHON|NODE_OPTIONS$|HOME$|USERPROFILE$)/.test(value.slice(2,-1)) || field==='env'&&!/^[A-Z][A-Z0-9_]*$/.test(key))throw new Error(`${name} 仅保存本机环境变量引用，例如 ${'${API_TOKEN}'}，不能保存密钥正文`);
    }
  }
  if(config.drivers?.maxTotalTurns!==undefined&&(!Number.isInteger(config.drivers.maxTotalTurns)||config.drivers.maxTotalTurns<1||config.drivers.maxTotalTurns>1000))throw new Error('主动工作累计轮数应为 1–1000');
  if(config.drivers?.expiresAt&&!Number.isFinite(Date.parse(config.drivers.expiresAt)))throw new Error('主动工作截止时间无效');
}

export function createBotSettings({state,api,current,valid,fail,draw=()=>{},acceptBot=()=>{}}) {
  let visit=0,writeSequence=0;
  const readSequence=new Map();
  const selectedId=()=>state.selectedEmployee?.id || state.bot?.id || '';
  const capture=()=>current?.() || {scope:scopeKey(state),employeeId:selectedId()};
  const live=(settings,token,generation=visit)=>state.botSettings===settings && generation===visit && settings.key===`${scopeKey(state)}:${selectedId()}` && (valid?valid(token,true):token.scope===scopeKey(state)&&token.employeeId===selectedId());
  function ensure() {
    const employee=state.selectedEmployee || state.bot?.employee;
    if(!employee?.id)throw new Error('请先选择员工');
    const key=`${scopeKey(state)}:${employee.id}`;
    if(state.botSettings?.key!==key){
      visit++;readSequence.clear();
      const bot=state.bot?.id===employee.id?state.bot:employee.bot;
      const draft=draftOf(employee,bot);
      state.botSettings={key,employeeId:employee.id,workspace:workspaceId(state),employee:clone(employee),bot:bot?clone(bot):null,kind:bot?.configuration_state==='initialized'?'bot':'employee',draft,baseDraft:clone(draft),dirty:false,loading:false,saving:false,writeUnknown:false,conflict:false,pending:null,errors:{},fieldErrors:{},fieldValues:{},models:[],skills:[],capabilities:[],devices:clone(state.devices || []),runtimes:[],profiles:[],profileDeviceId:'',mcpStatus:null,newMcpName:'',notice:'',phoneSetup:null,phoneStatus:null,phoneConfigurationRead:false,phoneDraft:{enabled:false,phoneDeviceId:'',accountId:'',accountLabel:''},phoneDirty:false,phoneSaving:false,phoneUnknown:false,phonePending:null};
      state.botSettings.contextToken=capture();
    }else if(valid&&state.botSettings.contextToken&&!valid(state.botSettings.contextToken,true)){
      // Returning to the same employee is a new visit. Pending writes require readback, not a permanent spinner.
      visit++;readSequence.clear();
      const settings=state.botSettings;settings.contextToken=capture();settings.loading=false;settings.saving=false;settings.phoneSaving=false;
      if(settings.pending)settings.writeUnknown=true;
      if(settings.phonePending)settings.phoneUnknown=true;
    }
    return state.botSettings;
  }
  function allowed(settings) {
    if(!['owner','admin','member'].includes(roleOf(state)))throw new Error('当前工作区角色不能修改员工设置');
    if(settings.saving||settings.phoneSaving)throw new Error('正在保存，请等待回执');
  }
  function error(settings,key,value,token,generation) {
    if(!live(settings,token,generation))return;
    settings.errors[key]=value?.message || '读取失败，请刷新重试';
    if(value?.status===401)fail?.(value,token,true);
    else draw();
  }
  function acceptEmployee(employee) {
    if(employee?.id!==selectedId())throw new Error('员工返回归属不一致');
    state.employees=(state.employees || []).map(row=>row.id===employee.id?{...row,...employee}:row);
    state.selectedEmployee={...state.selectedEmployee,...employee};
  }
  function confirmPending(settings,bot) {
    const pending=settings.pending;
    if(!pending)return false;
    if(pending.kind==='save' && same(bot.config,pending.body.config) && Object.entries(pending.body.employee).every(([key,value])=>same(key==='model'?bot.employee?.model_id:bot.employee?.[key],value)))return true;
    if(pending.kind==='validate'&&bot.validation?.revision===pending.body.expectedRevision&&bot.validation?.action_id)return true;
    if(pending.kind==='control'&&bot.control_epoch>pending.body.expectedControlEpoch&&bot.control_state===(pending.body.operation==='pause'?'paused':'active'))return true;
    return false;
  }
  function apply(settings,bot,{resetDraft=false}={}) {
    if(bot.id!==settings.employeeId || bot.workspace&&bot.workspace!==settings.workspace)throw new Error('Bot 返回归属与当前员工不一致');
    settings.bot=clone(bot);settings.employee=clone(bot.employee);settings.kind=bot.configuration_state==='initialized'?'bot':'employee';
    acceptBot(bot);
    const confirmed=confirmPending(settings,bot);
    if(confirmed){settings.pending=null;settings.writeUnknown=false;settings.notice='原操作的当前状态已核实';}
    if((resetDraft&&!settings.writeUnknown)||!settings.draft||!settings.dirty||confirmed){settings.draft=draftOf(bot.employee,bot);settings.baseDraft=clone(settings.draft);settings.dirty=false;settings.conflict=false;settings.fieldValues={};settings.fieldErrors={};}
    else settings.conflict=settings.draft.revision!==bot.revision;
  }
  function background(settings,token,generation,key,request,accept) {
    const sequence=(readSequence.get(key)||0)+1;readSequence.set(key,sequence);
    return Promise.resolve().then(request).then(value=>{
      if(!live(settings,token,generation)||readSequence.get(key)!==sequence)return;
      delete settings.errors[key];accept(value);draw();
    }).catch(value=>{if(readSequence.get(key)===sequence)error(settings,key,value,token,generation);});
  }
  function invalidateWritableReads() {
    for(const key of ['bot','phoneStatus','phoneSetup'])readSequence.set(key,(readSequence.get(key)||0)+1);
  }
  function loadProfiles(settings,token,generation) {
    const deviceId=settings.draft.targetDeviceId;
    if(settings.employee.runtime!=='Hermes'||!deviceId||!api.hermesProfiles)return;
    void background(settings,token,generation,'profiles',()=>api.hermesProfiles(settings.workspace,deviceId),value=>{
      if(settings.draft.targetDeviceId!==deviceId)return;
      settings.profiles=list(value,'profiles');settings.profileDeviceId=deviceId;
    });
  }
  function applyPhone(settings,status) {
    const cfg=status.configuration;
    if(!cfg || cfg.employee_id!==settings.employeeId || typeof cfg.enabled!=='boolean' || cfg.workspace&&cfg.workspace!==settings.workspace)throw new Error('手机控制配置归属或返回内容无效');
    settings.phoneStatus=status;settings.phoneConfigurationRead=true;
    const pending=settings.phonePending;
    const confirmed=pending&&cfg.enabled===pending.enabled&&(!pending.enabled||cfg.phone_device_id===pending.phoneDeviceId&&String(cfg.binding?.accountId || '')===String(pending.accountId || ''));
    if(confirmed){settings.phoneUnknown=false;settings.phonePending=null;settings.phoneDirty=false;}
    if(!settings.phoneDirty || confirmed)settings.phoneDraft={enabled:Boolean(cfg.enabled),phoneDeviceId:cfg.phone_device_id || '',accountId:cfg.binding?.accountId || '',accountLabel:cfg.binding?.accountLabel || ''};
  }
  function loadPhone(settings,token,generation) {
    if(settings.saving||settings.phoneSaving)return;
    if(api.phoneMcpSetup)void background(settings,token,generation,'phoneSetup',()=>api.phoneMcpSetup(settings.workspace),value=>{
      if(value.workspace&&value.workspace!==settings.workspace)throw new Error('手机目录归属不一致');settings.phoneSetup=value;
      if(!settings.phoneStatus){const employee=(value.employees || []).find(item=>item.id===settings.employeeId);if(employee?.phone_mcp)applyPhone(settings,{configuration:employee.phone_mcp});}
    });
    if(api.phoneMcpStatus)void background(settings,token,generation,'phoneStatus',()=>api.phoneMcpStatus(settings.workspace,settings.employeeId),value=>applyPhone(settings,value));
  }
  async function load({resetDraft=false}={}) {
    const settings=ensure(),token=capture(),generation=visit;
    const writing=settings.saving||settings.phoneSaving;
    settings.loading=!writing;draw();
    if(api.models)void background(settings,token,generation,'models',()=>api.models(settings.workspace,{runtime:settings.employee.runtime}),value=>{settings.models=list(value,'models');});
    if(api.skills)void background(settings,token,generation,'skills',()=>api.skills(settings.workspace),value=>{settings.skills=list(value,'skills');});
    if(api.devices)void background(settings,token,generation,'devices',()=>api.devices(settings.workspace),value=>{settings.devices=list(value,'devices');});
    if(api.runtimes)void background(settings,token,generation,'runtimes',()=>api.runtimes(settings.workspace),value=>{settings.runtimes=list(value,'runtimes');});
    if(api.botCapabilities&&settings.employee.runtime==='Hermes')void background(settings,token,generation,'capabilities',()=>api.botCapabilities(settings.workspace,settings.employee.target_device_id || ''),value=>{settings.capabilities=list(value,'capabilities');settings.runtimeEvidence=value.runtime || null;});
    if(api.employeeMcpStatus)void background(settings,token,generation,'mcp',()=>api.employeeMcpStatus(settings.workspace,settings.employeeId),value=>{if(value.employee_id&&value.employee_id!==settings.employeeId)throw new Error('MCP 状态归属不一致');settings.mcpStatus=value;});
    loadProfiles(settings,token,generation);
    loadPhone(settings,token,generation);
    if(writing)return;
    await background(settings,token,generation,'bot',async()=>settings.employee.runtime==='Hermes'?api.bot(settings.workspace,settings.employeeId):api.employees(settings.workspace),value=>{
      if(settings.employee.runtime==='Hermes')apply(settings,value,{resetDraft});
      else {
        const employee=list(value,'employees').find(item=>item.id===settings.employeeId);
        if(!employee)throw new Error('员工已不在当前工作区中');
        settings.employee=clone(employee);acceptEmployee(employee);
        const pending=settings.pending;
        const confirmed=pending?.kind==='employee'&&Object.entries(pending.body).every(([key,value])=>same(employee[({model:'model_id',targetDeviceId:'target_device_id',runtimeProfile:'runtime_profile'})[key] || key] ?? null,value ?? null));
        if(resetDraft||!settings.dirty||confirmed){settings.draft=draftOf(employee,null);settings.baseDraft=clone(settings.draft);settings.dirty=false;settings.fieldValues={};settings.fieldErrors={};settings.writeUnknown=false;settings.pending=null;}
      }
    });
    if(live(settings,token,generation)){settings.loading=false;draw();}
  }
  function set(settings,path,value,fallback) {
    let target=settings.draft;
    for(const key of path.slice(0,-1)){if(!object(target[key])){if(value===undefined||same(value,fallback))return;target[key]={};}target=target[key];}
    const key=path.at(-1);
    if(value===undefined)delete target[key];
    else if(target[key]!==undefined || !same(value,fallback))target[key]=value;
  }
  function field(settings,name,value,checked=false,type='') {
    const config=settings.draft.config;
    if(name.startsWith('bot.phone.')){const key=name.slice('bot.phone.'.length);if(['enabled','phoneDeviceId','accountId','accountLabel'].includes(key)){settings.phoneDraft[key]=key==='enabled'?Boolean(checked):String(value);settings.phoneDirty=true;}return;}
    if(['bot.model','bot.persona','bot.instructions','bot.visibility'].includes(name)){const key=name.slice(4);settings.draft.employee[key]=key==='model'?String(value).trim() || null:String(value);}
    else if(name==='bot.targetDeviceId'){settings.draft.targetDeviceId=String(value);settings.profiles=[];settings.profileDeviceId='';loadProfiles(settings,capture(),visit);}
    else if(name==='bot.runtimeProfile')settings.draft.runtimeProfile=String(value);
    else if(name==='bot.provider')set(settings,['config','provider'],String(value).trim() || null,null);
    else if(name==='bot.reasoningEffort')set(settings,['config','reasoningEffort'],value || undefined);
    else if(name==='bot.maxTurns')set(settings,['config','maxTurns'],Number(value),20);
    else if(name==='bot.permission')set(settings,['config','permissions','mode'],value,'read_only');
    else if(name==='bot.management')set(settings,['config','permissions','management'],Boolean(checked),true);
    else if(name==='bot.memory.enabled'||name==='bot.memory.userProfile')set(settings,['config','memory',name.split('.').at(-1)],Boolean(checked),true);
    else if(name==='bot.memory.charLimit'||name==='bot.memory.userCharLimit')set(settings,['config','memory',name.split('.').at(-1)],value===''?undefined:Number(value));
    else if(name==='bot.toolsets'){const values=new Set(config.toolsets || []);if(checked)values.add(value);else values.delete(value);config.toolsets=[...values];}
    else if(name==='bot.toolsetsExtra')config.toolsets=[...(config.toolsets || []).filter(value=>TOOLSETS.includes(value)),...names(value)];
    else if(name==='bot.skills'){const values=new Set(settings.draft.employee.skills);if(checked)values.add(value);else values.delete(value);settings.draft.employee.skills=[...values];}
    else if(name==='bot.skills.disabled'||name==='bot.skills.autoLoad')set(settings,['config','skills',name.split('.').at(-1)],names(value),[]);
    else if(name==='bot.drivers.maxTotalTurns')set(settings,['config','drivers','maxTotalTurns'],Number(value),100);
    else if(name==='bot.drivers.expiresAt')set(settings,['config','drivers','expiresAt'],String(value).trim() || null,null);
    else if(name==='bot.newMcpName'){settings.newMcpName=String(value);return;}
    else if(name.startsWith('bot.mcp.')){
      const [, , serverName,key]=name.split('.'),server=config.mcpServers?.[serverName];
      if(!server)throw new Error('MCP 服务已变化，请刷新');
      if(key==='enabled')server.enabled=Boolean(checked);
      else if(key==='env'||key==='headers'){
        settings.fieldValues[name]=String(value);
        const parsed=JSON.parse(value || '{}');if(!object(parsed))throw new Error('请填写 JSON 对象');server[key]=parsed;
      }else if(key==='include'||key==='exclude'){server.tools={...(server.tools || {}),[key]:names(value)};}
      else if(key==='args')server.args=String(value).split('\n').filter(line=>line.length);
      else if(key==='timeout'||key==='connectTimeout'){if(value==='')delete server[key];else server[key]=Number(value);}
      else if(['transport','command','url'].includes(key))server[key]=String(value);
    }
    delete settings.fieldErrors[name];
    settings.dirty=Object.keys(settings.fieldErrors).length>0||!same(settings.draft,settings.baseDraft);
  }
  function change(event) {
    const target=event?.target || event;
    if(!target?.name?.startsWith('bot.'))return false;
    const settings=ensure();
    if(target.name.startsWith('bot.phone.')&&!phoneConfigurationKnown(settings)){draw();return true;}
    if(settings.saving||settings.phoneSaving||settings.writeUnknown)return true;
    try{field(settings,target.name,target.value,target.checked,target.type);}
    catch(value){settings.fieldErrors[target.name]=value.message;settings.dirty=true;}
    draw();return true;
  }
  function fromForm(settings,data) {
    if(!data?.has('bot.form'))return;
    for(const [name,value] of data.entries())if(name.startsWith('bot.')&&!['bot.form','bot.toolsets','bot.skills',...checkboxes].includes(name)&&!name.endsWith('.enabled'))field(settings,name,value);
    if(settings.kind==='bot'){
      for(const name of checkboxes)field(settings,name,'',data.has(name));
      const extras=names(data.get('bot.toolsetsExtra'));
      settings.draft.config.toolsets=[...new Set([...data.getAll('bot.toolsets'),...extras])];
      for(const name of Object.keys(settings.draft.config.mcpServers || {}))field(settings,`bot.mcp.${name}.enabled`,'',data.has(`bot.mcp.${name}.enabled`));
    }
    settings.draft.employee.skills=[...new Set(data.getAll('bot.skills'))];
    settings.dirty=Object.keys(settings.fieldErrors).length>0||!same(settings.draft,settings.baseDraft);
  }
  function payload(settings) {
    if(Object.keys(settings.fieldErrors).length)throw new Error(Object.values(settings.fieldErrors)[0]);
    validateDraft(settings.draft,settings.kind==='bot');
    if(settings.kind==='bot')return {expectedRevision:settings.draft.revision,employee:clone(settings.draft.employee),config:clone(settings.draft.config)};
    const body=clone(settings.draft.employee);
    if(settings.draft.targetDeviceId!==settings.baseDraft.targetDeviceId){
      if(!settings.draft.targetDeviceId || !settings.devices.some(device=>device.id===settings.draft.targetDeviceId))throw new Error('请选择当前工作区已有的运行电脑');
      body.targetDeviceId=settings.draft.targetDeviceId;
    }
    if(settings.draft.runtimeProfile!==settings.baseDraft.runtimeProfile){
      const device=settings.devices.find(item=>item.id===settings.draft.targetDeviceId),profiles=settings.employee.runtime==='Hermes'?settings.profiles:device?.runtimes?.find(runtime=>runtime.name===settings.employee.runtime)?.profiles || [];
      if(settings.draft.runtimeProfile&&!profiles.some(profile=>(typeof profile==='string'?profile:profile.name)===settings.draft.runtimeProfile))throw new Error('请选择该电脑已有的 Profile');
      body.runtimeProfile=settings.draft.runtimeProfile || null;
    }
    return body;
  }
  async function mutate(kind,body) {
    const settings=ensure(),token=capture(),generation=visit,sequence=++writeSequence;
    allowed(settings);
    settings.saving=true;settings.errors.operation='';settings.notice='';draw();
    // Invalidate reads started before this write, while keeping the user's draft intact.
    invalidateWritableReads();
    const pending={kind,body:clone(body)};settings.pending=pending;
    let refreshAfter=false;
    try {
      let result;
      if(kind==='save')result=await api.updateBot(settings.workspace,settings.employeeId,body);
      else if(kind==='employee')result=await api.updateEmployee(settings.workspace,settings.employeeId,body);
      else if(kind==='validate')result=await api.validateBot(settings.workspace,settings.employeeId,body);
      else result=await api.controlBot(settings.workspace,settings.employeeId,body);
      if(!live(settings,token,generation)||sequence!==writeSequence)return false;
      invalidateWritableReads();
      settings.pending=null;settings.writeUnknown=false;settings.conflict=false;
      if(kind==='employee'){settings.employee=clone(result);acceptEmployee(result);settings.draft=draftOf(result,null);settings.baseDraft=clone(settings.draft);settings.dirty=false;}
      else if(kind!=='validate')apply(settings,result,{resetDraft:kind==='save'});
      settings.notice=kind==='save'?'配置已保存，请检查后再启用':kind==='employee'?'员工设置已保存':kind==='validate'?'已提交配置检查，刷新查看实际回执':body.operation==='pause'?'已暂停新任务；在途执行仍以原回执为准':'当前员工已启用';
      refreshAfter=kind==='validate';
      draw();return true;
    }catch(value){
      if(!live(settings,token,generation)||sequence!==writeSequence)return false;
      settings.writeUnknown=!value.status;
      if(!settings.writeUnknown)settings.pending=null;
      settings.conflict=value.status===409&&(!value.code||value.code==='BOT_REVISION_CONFLICT');
      error(settings,'operation',value,token,generation);return false;
    }finally{if(live(settings,token,generation)&&sequence===writeSequence){invalidateWritableReads();settings.saving=false;draw();if(refreshAfter)void load();}}
  }
  async function submit(form,values) {
    const settings=ensure();
    try{
      allowed(settings);
      if(settings.writeUnknown)throw new Error('上次操作尚未确认，请先刷新核对');
      if(settings.conflict)throw new Error('配置版本已变化，请重新读取并核对草稿');
      fromForm(settings,values || form);
      const body=payload(settings);
      if(!settings.dirty){settings.notice='当前配置没有修改';draw();return true;}
      return await mutate(settings.kind==='bot'?'save':'employee',body);
    }catch(value){settings.errors.operation=value.message;draw();return false;}
  }
  async function control(operation) {
    const settings=ensure();
    try{
      allowed(settings);
      if(settings.kind!=='bot')throw new Error('这位员工尚未启用 Hermes Bot 能力');
      if(settings.dirty||settings.conflict)throw new Error('请先保存并核对当前草稿');
      if(settings.writeUnknown)throw new Error('上次操作尚未确认，请先刷新核对');
      if(operation!=='pause'&&(settings.bot.validation?.status!=='succeeded'||settings.bot.validation.revision!==settings.bot.revision))throw new Error('请先检查当前配置，等待实际检查通过后再启用');
      return await mutate('control',{expectedRevision:settings.bot.revision,expectedControlEpoch:settings.bot.control_epoch,operation});
    }catch(value){settings.errors.operation=value.message;draw();return false;}
  }
  async function savePhone(body) {
    const settings=ensure(),token=capture(),generation=visit;
    if(!['owner','admin'].includes(roleOf(state)))throw new Error('手机控制设置需要工作区 Owner 或管理员权限');
    if(!phoneConfigurationKnown(settings))throw new Error('原手机控制配置尚未读取成功，请刷新后再修改');
    allowed(settings);
    if(settings.dirty||settings.writeUnknown)throw new Error('请先保存并核对模型与能力草稿，再设置手机控制');
    if(!api.savePhoneMcp)throw new Error('手机控制设置尚未连接');
    settings.phoneSaving=true;settings.phonePending=clone(body);settings.errors.phoneSave='';draw();
    invalidateWritableReads();
    let refreshAfter=false;
    try{
      const result=await api.savePhoneMcp(settings.workspace,settings.employeeId,body);
      if(!live(settings,token,generation))return false;
      invalidateWritableReads();
      settings.phoneDirty=false;settings.phoneUnknown=false;settings.phonePending=null;applyPhone(settings,{configuration:result.configuration});
      settings.notice=body.enabled?'员工手机控制已保存，实际加载状态以回执为准':'员工手机控制已关闭';
      refreshAfter=true;return true;
    }catch(value){if(live(settings,token,generation)){settings.phoneUnknown=!value.status;if(!settings.phoneUnknown)settings.phonePending=null;error(settings,'phoneSave',value,token,generation);}return false;}
    finally{if(live(settings,token,generation)){invalidateWritableReads();settings.phoneSaving=false;draw();if(refreshAfter)void load();}}
  }
  async function submitPhone(form,values) {
    const settings=ensure(),data=values || form;
    try{
      if(!['owner','admin'].includes(roleOf(state)))throw new Error('手机控制设置需要工作区 Owner 或管理员权限');
      if(!phoneConfigurationKnown(settings))throw new Error('原手机控制配置尚未读取成功，请刷新后再修改');
      if(settings.phoneUnknown)throw new Error('上次手机控制保存尚未确认，请刷新核对或按原请求重试');
      if(data?.has('bot.phone.form')){
        settings.phoneDraft.enabled=data.has('bot.phone.enabled');
        for(const key of ['phoneDeviceId','accountId','accountLabel'])if(data.has(`bot.phone.${key}`))settings.phoneDraft[key]=String(data.get(`bot.phone.${key}`));
      }
      const value=settings.phoneDraft;
      if(value.enabled&&!value.phoneDeviceId)throw new Error('请选择已有手机');
      if(value.enabled&&!settings.phoneSetup?.phones?.some(phone=>phone.id===value.phoneDeviceId))throw new Error('请选择当前手机目录中的设备');
      return await savePhone({enabled:Boolean(value.enabled),targetDeviceId:settings.employee.target_device_id,runtime:settings.employee.runtime,runtimeProfile:settings.employee.runtime_profile || null,phoneDeviceId:value.phoneDeviceId || null,accountId:value.accountId || null,accountLabel:value.accountLabel || null});
    }catch(value){settings.errors.phoneSave=value.message;draw();return false;}
  }
  const actions={
    'bot-settings-refresh':()=>load(),
    'bot-settings-reload':()=>load({resetDraft:true}),
    'bot-settings-validate':async()=>{
      const settings=ensure();
      try{allowed(settings);if(settings.kind!=='bot'||settings.dirty||settings.conflict||settings.writeUnknown)throw new Error('请先保存并核对当前配置');return await mutate('validate',{expectedRevision:settings.bot.revision,idempotencyKey:`mobile-check-${id()}`});}
      catch(value){settings.errors.operation=value.message;draw();return false;}
    },
    'bot-settings-activate':()=>control(ensure().bot?.control_state==='paused'?'resume':'activate'),
    'bot-settings-pause':()=>control('pause'),
    'bot-settings-retry':async()=>{const settings=ensure();if(!settings.writeUnknown||!settings.pending)return false;return mutate(settings.pending.kind,clone(settings.pending.body));},
    'bot-settings-phone-refresh':()=>{const settings=ensure();loadPhone(settings,capture(),visit);},
    'bot-settings-phone-retry':async()=>{const settings=ensure();if(!settings.phoneUnknown||!settings.phonePending)return false;try{return await savePhone(clone(settings.phonePending));}catch(value){settings.errors.phoneSave=value.message;draw();return false;}},
    'bot-settings-mcp-add':()=>{
      const settings=ensure();try{allowed(settings);if(settings.writeUnknown)throw new Error('上次操作尚未确认，请先刷新核对');const name=settings.newMcpName.trim();if(!/^[a-z][a-z0-9_-]{0,63}$/.test(name)||name.startsWith('ziwei'))throw new Error('请输入小写字母开头的 MCP 名称');settings.draft.config.mcpServers ||= {};if(Object.hasOwn(settings.draft.config.mcpServers,name))throw new Error('已有同名 MCP 服务');settings.draft.config.mcpServers[name]={transport:'stdio',command:'',args:[],env:{},enabled:false};settings.newMcpName='';settings.dirty=true;draw();}catch(value){settings.errors.operation=value.message;draw();}
    },
    'bot-settings-mcp-remove':({id:name}={})=>{const settings=ensure();try{allowed(settings);if(settings.writeUnknown)return;delete settings.draft.config.mcpServers?.[name];for(const values of [settings.fieldErrors,settings.fieldValues])for(const field of Object.keys(values))if(field.startsWith(`bot.mcp.${name}.`))delete values[field];settings.dirty=!same(settings.draft,settings.baseDraft);draw();}catch(value){settings.errors.operation=value.message;draw();}},
  };
  return {load,submit,submitPhone,change,actions};
}

export function renderBotSettings(state,ui={}) {
  const e=ui.e || escapeHtml,icon=ui.icon || (()=>''),settings=state.botSettings;
  const header=ui.pageHeader?.(state,'模型与能力',employeeName(state.selectedEmployee)) || '<header><button data-action="back">返回</button><h1>模型与能力</h1></header>';
  if(!settings?.draft)return `${header}<main class="page-content"><p role="status">正在读取员工配置…</p></main>`;
  const d=settings.draft,c=d.config,isBot=settings.kind==='bot',editable=['owner','admin','member'].includes(roleOf(state));
  const locked=settings.saving||settings.phoneSaving||settings.writeUnknown||!editable,disabled=locked?' disabled':'',option=(value,label,current)=>`<option value="${e(value)}"${String(value)===String(current ?? '')?' selected':''}>${e(label)}</option>`;
  const input=(name,value,extra='')=>`<input name="bot.${name}" value="${e(value ?? '')}" ${extra}>`;
  const text=(name,value,rows=3)=>`<textarea name="bot.${name}" rows="${rows}">${e(value ?? '')}</textarea>`;
  const check=(name,label,value,extra='')=>`<label class="field-label"><span><input type="checkbox" name="bot.${name}"${value?' checked':''} ${extra}> ${e(label)}</span></label>`;
  const field=(label,control)=>`<label class="field-label">${e(label)}${control}</label>`;
  const button=(action,label,lock=false)=>`<button type="button" class="button soft" data-action="${action}"${lock?' disabled':''}>${e(label)}</button>`;
  const errors=[...Object.entries(settings.errors).filter(([,value])=>value),...Object.entries(settings.fieldErrors)].map(([key,value])=>`<p class="banner error" role="alert">${e(value)}</p>`).join('');
  const currentDevice=settings.devices.find(device=>device.id===d.targetDeviceId),deviceName=currentDevice?.name || d.targetDeviceId || '未绑定';
  const models=`<datalist id="bot-model-options">${settings.models.map(model=>`<option value="${e(model.id)}">${e(model.label || model.id)}</option>`).join('')}</datalist>`;
  const skills=new Map(settings.skills.map(skill=>[skill.id,skill]));for(const skillId of d.employee.skills)if(!skills.has(skillId))skills.set(skillId,{id:skillId,name:skillId});
  const skillFields=[...skills.values()].map(skill=>`<label class="field-label"><span><input type="checkbox" name="bot.skills" value="${e(skill.id)}"${d.employee.skills.includes(skill.id)?' checked':''}> ${e(skill.name)}${skill.installed===false?' · 未安装':''}</span></label>`).join('') || '<p class="empty-inline">暂无已发现的工作区技能</p>';
  const profiles=settings.employee.runtime==='Hermes'?settings.profiles:currentDevice?.runtimes?.find(runtime=>runtime.name===settings.employee.runtime)?.profiles || [];
  const binding=isBot?`<p>运行电脑：${e(deviceName)}（已绑定；暂不支持更换）</p><p>Profile：${e(settings.employee.runtime_profile || '未返回')}</p>`:field('运行电脑',`<select name="bot.targetDeviceId">${option('','未绑定',d.targetDeviceId)}${!settings.devices.some(device=>device.id===d.targetDeviceId)&&d.targetDeviceId?option(d.targetDeviceId,deviceName,d.targetDeviceId):''}${settings.devices.map(device=>option(device.id,`${device.name || device.id} · ${device.status==='online'?'在线':'离线'}`,d.targetDeviceId)).join('')}</select>`)+field('已有 Profile',`<select name="bot.runtimeProfile">${option('','使用默认配置',d.runtimeProfile)}${d.runtimeProfile&&!profiles.some(profile=>(typeof profile==='string'?profile:profile.name)===d.runtimeProfile)?option(d.runtimeProfile,d.runtimeProfile,d.runtimeProfile):''}${profiles.map(profile=>{const name=typeof profile==='string'?profile:profile.name;return option(name,name,d.runtimeProfile);}).join('')}</select>`);
  const capabilities=settings.bot?.capabilities || settings.capabilities;
  const statusList=capabilities.map(capability=>{const status=capabilityPresentation(capability);return `<article class="panel"><strong>${e(capability.label || capability.id)}</strong><span class="badge ${e(status.tone || 'muted')}">${e(status.label)}</span>${capability.reason?`<p>${e(capability.reason)}</p>`:''}${capability.evidence?.length?`<details><summary>查看依据</summary><div class="prose">${e(capability.evidence.map(value=>typeof value==='string'?value:JSON.stringify(value)).join('\n'))}</div></details>`:''}</article>`;}).join('');
  function mcpFields(name,server){
    const prefix=`mcp.${name}.`,transport=server.transport || (server.url?'http':'stdio');
    const json=key=>settings.fieldValues[`bot.${prefix}${key}`] ?? JSON.stringify(server[key] || {},null,2);
    return `<details class="panel"><summary>${e(name)} · ${server.enabled===false?'已停用':'已启用'}</summary><div class="form-panel">${check(`${prefix}enabled`,'启用服务',server.enabled!==false)}${field('连接方式',`<select name="bot.${prefix}transport">${['stdio','http','sse'].map(value=>option(value,value,transport)).join('')}</select>`)}${transport==='stdio'?field('启动命令',input(`${prefix}command`,server.command))+field('参数（每行一个）',text(`${prefix}args`,(server.args || []).join('\n'))):field('服务地址',input(`${prefix}url`,server.url,'type="url"'))+field('请求头（JSON 环境变量引用）',text(`${prefix}headers`,json('headers')))}${field('环境变量引用（JSON）',text(`${prefix}env`,json('env')))}<p class="empty-inline">仅保存本机变量引用，例如 ${e('${API_TOKEN}')}。</p>${field('允许工具（每行一个，可留空）',text(`${prefix}include`,(server.tools?.include || []).join('\n'),2))}${field('排除工具（每行一个，可留空）',text(`${prefix}exclude`,(server.tools?.exclude || []).join('\n'),2))}${field('工具超时（秒，可留空）',input(`${prefix}timeout`,server.timeout,'type="number" min="1" max="120"'))}${field('连接超时（秒，可留空）',input(`${prefix}connectTimeout`,server.connectTimeout,'type="number" min="1" max="60"'))}<button type="button" class="button soft" data-action="bot-settings-mcp-remove" data-id="${e(name)}">移除此服务</button></div></details>`;
  }
  const botFields=isBot?`${field('Provider',input('provider',c.provider,'placeholder="沿用已绑定配置"'))}${field('推理强度',`<select name="bot.reasoningEffort">${option('','使用运行时默认',c.reasoningEffort)}${EFFORTS.map(value=>option(value,value,c.reasoningEffort)).join('')}</select>`)}${field('单次最多轮数',input('maxTurns',c.maxTurns ?? 20,'type="number" min="1" max="100"'))}${field('工具权限',`<select name="bot.permission">${option('read_only','仅对话',c.permissions?.mode)}${option('execute','使用已选择的工具',c.permissions?.mode)}</select>`)}${check('management','允许使用工作区管理能力',c.permissions?.management!==false)}<details class="panel" open><summary>记忆与用户画像</summary><div class="form-panel">${check('memory.enabled','长期记忆',c.memory?.enabled!==false)}${check('memory.userProfile','用户画像记忆',c.memory?.userProfile!==false)}${field('长期记忆字符上限',input('memory.charLimit',c.memory?.charLimit,'type="number" min="100" max="50000" placeholder="沿用原生默认"'))}${field('用户画像字符上限',input('memory.userCharLimit',c.memory?.userCharLimit,'type="number" min="100" max="50000" placeholder="沿用原生默认"'))}</div></details><details class="panel"><summary>工具集与原生技能</summary><div class="form-panel">${TOOLSETS.map(name=>check('toolsets',name,(c.toolsets || []).includes(name),`value="${e(name)}"`)).join('')}${field('其他具体工具集（每行一个）',text('toolsetsExtra',(c.toolsets || []).filter(name=>!TOOLSETS.includes(name)).join('\n')))}${field('自动加载的原生技能',text('skills.autoLoad',(c.skills?.autoLoad || []).join('\n')))}${field('禁用的原生技能',text('skills.disabled',(c.skills?.disabled || []).join('\n')))}</div></details><details class="panel"><summary>外部工具与 MCP</summary><div class="form-panel">${Object.entries(c.mcpServers || {}).map(([name,server])=>mcpFields(name,server)).join('') || '<p class="empty-inline">暂无外部 MCP 服务</p>'}${field('新服务名称',input('newMcpName',settings.newMcpName,'placeholder="例如 my-tools"'))}${button('bot-settings-mcp-add','添加服务',locked)}</div></details><details class="panel"><summary>主动工作预算</summary><div class="form-panel">${field('累计轮数上限',input('drivers.maxTotalTurns',c.drivers?.maxTotalTurns ?? 100,'type="number" min="1" max="1000"'))}${field('截止时间',input('drivers.expiresAt',c.drivers?.expiresAt,'placeholder="2026-10-17T18:00:00+08:00"'))}</div></details>`:'';
  const validation=settings.bot?.validation,checked=validation?.status==='succeeded'&&validation.revision===settings.bot?.revision;
  const controls=isBot?`<section class="panel form-panel"><h2>检查与启用</h2><p>${e(({not_checked:'尚未检查',pending:'正在检查',succeeded:'检查通过',failed:'检查失败',stale:'配置已变化，需要重新检查'})[validation?.status] || '状态待确认')}${validation?.error?` · ${e(validation.error)}`:''}</p>${button('bot-settings-validate','检查配置',locked||settings.dirty||settings.conflict)}${settings.bot.control_state==='active'?button('bot-settings-pause','暂停新任务',locked||settings.dirty):button('bot-settings-activate','启用员工',locked||settings.dirty||!checked||settings.conflict)}<p class="empty-inline">检查只核对电脑上的实际配置；启用由你单独操作。正在执行的工作可回聊天请求停止，并等待原回执。</p></section>`:'';
  const phoneEditable=['owner','admin'].includes(roleOf(state)),phoneLocked=locked||settings.phoneUnknown||!phoneEditable||!phoneConfigurationKnown(settings),phone=settings.phoneDraft,phoneStatus=settings.phoneStatus,phones=settings.phoneSetup?.phones || [];
  const phoneReadNotice=phoneConfigurationKnown(settings)?'':`<p class="empty-inline" role="status">${settings.errors.phoneStatus||settings.errors.phoneSetup?'原手机控制配置读取失败，请刷新后再修改':'正在读取原手机控制配置…'}</p>`;
  const phoneForm=`<section class="panel form-panel"><h2>员工手机控制</h2><p>让这位员工通过原运行电脑使用已绑定手机。</p>${phoneReadNotice}${!phoneEditable?'<p class="empty-inline">仅 Owner 或管理员可修改</p>':''}${settings.phoneSetup?.skill?.installed===false?'<p class="banner error">手机操控技能尚未安装</p>':''}${settings.phoneSetup?.api?.error?`<p class="banner error">${e(settings.phoneSetup.api.error)}</p>`:''}<form data-form="bot-phone-mcp" data-state-fields data-record-key="${e(settings.key)}"><input type="hidden" name="bot.phone.form" value="1"><fieldset${phoneLocked?' disabled':''} style="border:0;padding:0;margin:0;min-width:0">${check('phone.enabled','允许这位员工控制手机',phone.enabled)}${field('已有手机',`<select name="bot.phone.phoneDeviceId">${option('','选择手机',phone.phoneDeviceId)}${phone.phoneDeviceId&&!phones.some(item=>item.id===phone.phoneDeviceId)?option(phone.phoneDeviceId,phone.phoneDeviceId,phone.phoneDeviceId):''}${phones.map(item=>option(item.id,item.alias || item.name || item.id,phone.phoneDeviceId)).join('')}</select>`)}<details><summary>业务账号（可选）</summary>${field('账号标识',input('phone.accountId',phone.accountId))}${field('账号名称',input('phone.accountLabel',phone.accountLabel))}</details><p class="empty-inline">运行电脑：${e(settings.employee.target_device_id || '未绑定')} · ${e(settings.employee.runtime || '')} · ${e(settings.employee.runtime_profile || '默认配置')}</p><button class="button primary full" type="submit">${settings.phoneSaving?'保存中…':'保存手机控制'}</button></fieldset></form>${settings.phoneUnknown?`<p class="banner error">上次手机控制保存尚未确认</p>${button('bot-settings-phone-retry','按原请求重试',settings.phoneSaving)}`:''}<p>配置：${phoneStatus?.configuration?(phoneStatus.configuration.enabled?'已开启':'已关闭'):'尚未返回'}</p><p>实际加载：${e(({never_run:'暂无执行记录',loaded:'已加载',injected:'已注入，尚未确认加载',pending:'等待回执',failed:'加载失败'})[phoneStatus?.receipt?.status] || '尚未返回')}</p>${phoneStatus?.receipt?.error?`<p class="banner error">${e(phoneStatus.receipt.error)}</p>`:''}${button('bot-settings-phone-refresh','刷新手机控制状态',settings.phoneSaving)}</section>`;
  return `${header}<main class="page-content">${ui.alerts?.(state) || ''}${errors}${settings.notice?`<p class="banner notice" role="status">${e(settings.notice)}</p>`:''}${!editable?'<p class="banner error">当前工作区角色仅可查看设置</p>':''}${settings.writeUnknown?`<section class="panel form-panel"><p>上次操作尚未确认，请先刷新核对。</p>${button('bot-settings-refresh','核对当前状态',settings.saving)}${settings.pending?button('bot-settings-retry','按原请求重试',settings.saving):''}</section>`:''}${settings.conflict?`<section class="panel form-panel"><p>配置版本已变化，草稿仍保留。</p>${button('bot-settings-reload','读取最新配置并丢弃草稿',settings.saving)}</section>`:''}<form data-form="bot-settings" data-state-fields data-record-key="${e(settings.key)}"><input type="hidden" name="bot.form" value="1"><fieldset${disabled} style="border:0;padding:0;margin:0;min-width:0"><section class="panel form-panel"><h2>模型与工作方式</h2><p>${e(settings.employee.runtime || '未指定运行时')}${settings.loading?' · 正在同步最新配置':''}</p>${field('模型 ID',input('model',d.employee.model,'list="bot-model-options" placeholder="留空沿用已绑定配置"'))}${models}${field('人格与沟通方式',text('persona',d.employee.persona))}${field('长期职责与交付标准',text('instructions',d.employee.instructions,5))}${field('可见范围',`<select name="bot.visibility">${option('personal','仅自己',d.employee.visibility)}${option('workspace','工作区',d.employee.visibility)}</select>`)}${binding}${botFields}</section><details class="panel"><summary>工作区技能</summary><div class="form-panel">${skillFields}</div></details><button class="button primary full" type="submit"${settings.conflict?' disabled':''}>${icon('check')}${settings.saving?'保存中…':'保存设置'}</button></fieldset></form>${controls}${phoneForm}${isBot?`<details class="panel"><summary>实际能力状态</summary>${statusList || '<p class="empty-inline">能力状态尚未返回</p>'}</details>`:'<p class="empty-inline">记忆、原生工具与 MCP 的能力组合适用于已启用的 Hermes Bot。</p>'}${settings.mcpStatus?`<details class="panel"><summary>工作区管理工具状态</summary><p>${e(({never_run:'暂无运行记录',loaded:'已加载',injected:'已注入，尚未确认加载',pending:'等待实际回执',failed:'加载失败'})[settings.mcpStatus.receipt?.status] || '状态待确认')}</p>${settings.mcpStatus.receipt?.error?`<p>${e(settings.mcpStatus.receipt.error)}</p>`:''}</details>`:''}<div class="form-panel">${button('bot-settings-refresh','刷新实际状态',settings.saving)}</div></main>`;
}
