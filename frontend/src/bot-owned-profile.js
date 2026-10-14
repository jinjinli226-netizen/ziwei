// Version 1 stays fixed even if the ordinary editor defaults change later.
const creationDefaults=version=>{if(version!==1)throw new Error('原创建请求的默认配置版本不受当前页面支持，请保留原请求核实。');return{provider:null,toolsets:[],maxTurns:20,memory:{enabled:true,userProfile:true},skills:{disabled:[]},mcpServers:{},permissions:{mode:'read_only'}};};
export function ownedBotChatBlockReason(bot){
  if(bot?.instance?.mode!=='owned_profile')return '';
  if(!botInstanceStatus(bot).provisioned)return '专属 Profile 与 HOME 尚未确认，请在 Bot 设置查询原创建回执。';
  const checked=bot.validation?.status==='succeeded'&&bot.validation.revision===bot.revision;
  if(!checked&&!['configured','source_reference'].includes(bot.instance.provisioning.authentication))return '模型认证尚待当前配置检查，请在 Bot 设置核对。';
  if(bot.control_state!=='active')return 'Bot 尚未启用，请在 Bot 设置检查并启用。';
  if(!checked)return '当前配置尚未通过检查，请在 Bot 设置核对。';
  return '';
}

export function botCreateAdmission(discovery,{workspace,deviceId,sourceProfile}={}) {
  const device=discovery?.workspace===workspace&&discovery.devices?.find(row=>row.id===deviceId),runtime=device?.runtimes?.find(row=>row.name==='Hermes'),issues=[];
  if(!device)issues.push('请选择当前工作区发现的电脑。');
  else if(device.status!=='online'||device.healthy===false)issues.push('目标电脑离线或心跳过期，请确认原客户端已连接。');
  if(!runtime||runtime.cli_status!=='available')issues.push('目标电脑尚未发现可用 Hermes CLI。');
  const profile=runtime?.profiles?.find(row=>(typeof row==='string'?row:row.name)===sourceProfile);
  if(!profile)issues.push('请选择目标电脑已发现的初始化来源 Profile。');
  else if(profile.initialization_source===false||profile.owned_profile===true)issues.push('另一个 Bot 的专属 Profile 不能作为初始化来源。');
  const authenticationReady=Boolean(profile&&(profile.authentication_configured===true||profile.readiness?.ready===true));
  return{ready:issues.length===0,issues,authenticationReady,device,runtime,profile};
}

export function botInstanceStatus(bot,discovery) {
  const instance=bot?.instance,owned=instance?.mode==='owned_profile',profile=instance?.profile||bot?.employee?.runtime_profile||'',base={mode:owned?'owned_profile':'legacy_private_home',profile,templateProfile:instance?.templateProfile||profile,home:null,provisioned:false,canValidate:false,canRecover:false,modelReady:false,authentication:null,actionId:instance?.provisioning?.actionId||null,error:instance?.provisioning?.error||''};
  if(!owned)return{...base,stage:'legacy',label:'来源 Profile + 独立实例',home:instance?.home||null,canValidate:true};
  const provision=instance.provisioning||{},identity=Boolean(profile&&profile===bot.employee?.runtime_profile&&instance.ownershipId&&provision.actionId),confirmed=identity&&provision.status==='provisioned'&&typeof instance.home==='string'&&Boolean(instance.home.trim());
  if(provision.status==='waiting_client' && bot.effect?.executionAdmission?.deviceExecution==='blocked')return {...base,stage:'waiting_client',label:'已保存规划 · 等待客户端验证或更新',canValidate:false,canRecover:false};
  if(!confirmed){const failed=['failed','cancelled','expired'].includes(provision.status),unknown=provision.status==='uncertain'||provision.status==='provisioned';return{...base,stage:unknown?'uncertain':failed?'failed':'provisioning',label:unknown?'专属 Profile 结果待核实':failed?'专属 Profile 创建失败':'正在创建专属 Profile',canRecover:identity&&failed};}
  // Running an owned Profile and selecting a template are different purposes.
  // Its initialization_source=false flag must never hide its runtime discovery.
  const device=discovery?.workspace===bot.workspace&&discovery.devices?.find(row=>row.id===bot.employee?.target_device_id),runtime=device?.runtimes?.find(row=>row.name==='Hermes');
  const computerReady=device?.status==='online'&&device.healthy!==false&&runtime?.cli_status==='available';
  const found=runtime?.profiles?.some(row=>(typeof row==='string'?row:row.name)===profile),issues=[];
  if(!device)issues.push('当前工作区尚未发现此 Bot 的运行电脑。');else if(!computerReady)issues.push('运行电脑或 Hermes CLI 尚未就绪。');
  if(!found)issues.push('目标电脑尚未报告此 Bot 的专属运行 Profile。');
  const authentication=provision.authentication||'required',required=!['configured','source_reference'].includes(authentication),stage=!computerReady||!found?'discovery_pending':required?'authentication_required':'provisioned';
  return{...base,home:instance.home,provisioned:true,authentication,stage,label:stage==='discovery_pending'?'专属 Profile 已创建 · 等待设备发现':required?'专属 Profile 已创建 · 模型认证待检查':'专属 Profile 已创建',canValidate:Boolean(computerReady),modelReady:bot.validation?.status==='succeeded'&&bot.validation.revision===bot.revision,issues};
}

// The initial creation contains identifiers and fixed safe defaults only. Role,
// persona and instructions are edited on the same Bot after provisioning. This
// permits exact response-loss recovery without retaining private prose.
export function createOwnedBotRequest({api,wrap=value=>value,namespace='',origin='local',storage=typeof sessionStorage==='undefined'?null:sessionStorage,getDiscovery=()=>null,keyFactory=()=>crypto.randomUUID()}={}) {
  const registry=new Map(),busy=new Set(),storageKey='ziwei.bot.owned.create.'+encodeURIComponent(JSON.stringify([origin,namespace]));let generation=0,disposed=false;
  const state=wrap({workspace:'',busy:false,pending:null,bot:null,phase:'idle',error:''});
  function metadata(row){return{workspace:row.workspace,name:row.name,deviceId:row.deviceId,sourceProfile:row.sourceProfile,model:row.model||null,visibility:row.visibility||'personal',defaultsVersion:row.defaultsVersion??1,requestKey:row.requestKey,botId:row.botId||null,phase:row.phase||'unknown'};}
  if(namespace)try{for(const value of JSON.parse(storage?.getItem(storageKey)||'[]'))if(value.workspace&&value.name&&value.deviceId&&value.sourceProfile&&value.requestKey)registry.set(value.workspace,metadata(value));}catch{}
  const persist=()=>{if(!namespace)return;try{if(registry.size)storage?.setItem(storageKey,JSON.stringify([...registry.values()].map(metadata)));else storage?.removeItem(storageKey);}catch{}};
  const current=visit=>!disposed&&visit===generation;
  function select(workspace){generation++;const pending=registry.get(workspace)||null;Object.assign(state,{workspace,busy:busy.has(workspace),pending,bot:null,phase:pending?.phase||'idle',error:pending?'保留了原 Bot 创建请求，请继续查询，避免重复创建。':''});}
  const body=entry=>({name:entry.name,targetDeviceId:entry.deviceId,sourceProfile:entry.sourceProfile,model:entry.model,visibility:entry.visibility,config:creationDefaults(entry.defaultsVersion),idempotencyKey:entry.requestKey});
  async function run(entry,{recovering=false}={}) {
    if(busy.has(entry.workspace))return false;const visit=generation;busy.add(entry.workspace);if(current(visit))Object.assign(state,{busy:true,error:''});
    const update=(phase,error='')=>{entry.phase=phase;registry.set(entry.workspace,entry);persist();if(current(visit))Object.assign(state,{pending:metadata(entry),phase,error});};
    try{
      const value=entry.botId?await api.bot(entry.botId,entry.workspace):await api.createBot(body(entry),entry.workspace);
      if(!value?.id||(entry.botId&&value.id!==entry.botId)||value.employee?.id!==value.id||value.workspace!==entry.workspace||value.employee?.target_device_id!==entry.deviceId||!value.main_conversation_id)throw new Error('Bot 创建回执的员工、工作区、电脑或主聊天与原请求不一致。');
      entry.botId=value.id;update('saved');
      if(value.instance?.mode!=='owned_profile'||value.instance.templateProfile!==entry.sourceProfile||value.employee.runtime_profile!==value.instance.profile||(!value.instance.provisioning?.actionId && !(value.instance.provisioning?.status==='waiting_client' && value.effect?.executionAdmission?.deviceExecution==='blocked' && value.instance.ownershipId)))throw new Error('Bot 已保存，但专属 Profile 创建身份尚未确认，请查询同一 Bot。');
      if(!current(visit))return false;state.bot=value;return true;
    }catch(error){if(current(visit))state.bot=null;if(!recovering&&!entry.botId&&entry.phase!=='unknown'&&error.status>=400&&error.status<500&&error.status!==408){registry.delete(entry.workspace);persist();if(current(visit))Object.assign(state,{pending:null,phase:'failed',error:error.message});}else update('unknown',error.message||'Bot 创建结果未知，请按原请求查询。');return false;}
    finally{busy.delete(entry.workspace);if(!disposed&&state.workspace===entry.workspace)state.busy=false;}
  }
  async function submit(form) {
    if(registry.has(state.workspace)){state.error='原 Bot 创建请求尚未确认，请先继续查询。';return false;}
    const name=String(form.name||'').trim(),sourceProfile=String(form.sourceProfile||'').trim(),admission=botCreateAdmission(getDiscovery(),{workspace:state.workspace,deviceId:form.targetDeviceId,sourceProfile});
    if(!name||name.length>100||!admission.ready){state.error=!name?'请填写 Bot 名称。':admission.issues.join('；')||'Bot 名称过长。';return false;}
    const entry=metadata({workspace:state.workspace,name,deviceId:form.targetDeviceId,sourceProfile,model:form.model||null,visibility:form.visibility||'personal',requestKey:'bot-owned-'+keyFactory(),phase:'pending'});registry.set(entry.workspace,entry);persist();state.pending=entry;return run(entry);
  }
  return{state,select,submit,recover(){const entry=registry.get(state.workspace);return entry?run(entry,{recovering:true}):Promise.resolve(false);},acknowledge(id){const entry=registry.get(state.workspace);if(entry?.botId===id){registry.delete(state.workspace);persist();state.pending=null;return true;}return false;},dispose(){disposed=true;generation++;}};
}
