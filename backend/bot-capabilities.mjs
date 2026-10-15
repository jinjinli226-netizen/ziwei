const navigate=(label,tab)=>({kind:'navigate',label,tab});
const short=value=>String(value||'').replace(/[\r\n]+/g,' ').slice(0,160);
const uncertain=value=>Boolean(value&&typeof value==='object'&&(value.code==='EXECUTION_UNCERTAIN'||value.executionState==='uncertain'||Object.values(value).some(uncertain)));
const nativeReceipt=action=>action?.result?.nativeOperation||action?.result?.result?.nativeOperation;
const resultValue=action=>action?.result?.result||action?.result||{};
const fixture=action=>action?.result?.fixture===true||resultValue(action).fixture===true||[action?.result?.executionSource,resultValue(action).executionSource,nativeReceipt(action)?.executionSource,nativeReceipt(action)?.data?.executionSource].includes('fixture');
const inFlight=action=>['pending','acked','queued','running'].includes(action?.status);
const time=action=>action?.completed_at||action?.created_at||null;
const exited=action=>{const exit=resultValue(action).processExit;return exit?.launched===true&&Number.isSafeInteger(exit.rootPid)&&exit.rootPid>0&&exit.rootConfirmed===true&&exit.rootExitCode===0&&!exit.cancelled&&!exit.failureCode&&((exit.treeConfirmed===true&&exit.activeProcesses===0)||['darwin','linux'].includes(exit.platform)&&exit.supervisor==='direct');};
const items=data=>Array.isArray(data)?data:Array.isArray(data?.items)?data.items:[];
const operationsMatch=(request,receipt)=>request?.resource===receipt?.resource&&request.operation===receipt.operation||['goals.step','heartbeat.step','kanban.dispatch'].includes(request?.resource+'.'+request?.operation)&&request.resource===receipt?.resource&&['_prepare','_settle','_fail'].includes(receipt.operation)||request?.resource==='groups'&&request.operation==='step'&&(receipt?.resource==='groups'&&receipt.operation==='read'||receipt?.resource==='collaboration'&&receipt.operation==='publish');

/** Saved switches, bounded native checks and live connection observations are separate evidence. */
export function deriveBotCapabilities({bot,capabilities=[],device=null,runtime=null,actions=[],activeAction=null,routines=[],now=Date.now()}={}) {
  const config=bot?.config||{},employee=bot?.employee||{},validation=bot?.validation||{};
  const configured=validation.status==='succeeded'&&validation.revision===bot?.revision;
  const identity=action=>{const p=action?.payload,b=p?.hermesBot;return Boolean(b&&b.employeeId===bot?.id&&p.employeeId===bot.id&&b.workspace===bot.workspace&&b.deviceId===employee.target_device_id&&p.deviceId===employee.target_device_id&&(!p.profile||p.profile===employee.runtime_profile)&&!fixture(action));};
  const current=action=>identity(action)&&action.payload.hermesBot.revision===bot.revision&&action.payload.hermesBot.controlEpoch===bot.control_epoch;
  const ordered=[...actions].sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
  const currentActions=ordered.filter(current);
  const profile=runtime?.profiles?.find(row=>(typeof row==='string'?row:row.name)===employee.runtime_profile);
  const blockingAction=activeAction||ordered.find(action=>action.id===bot?.active_action_id);
  let gate={state:'ready',reason:'当前 Bot 已启用，运行电脑在线。',action:null};
  const setGate=(state,reason,action)=>{gate={state,reason,action};};
  const provision=bot?.instance?.provisioning;
  if(bot?.configuration_state!=='initialized')setGate('needs_configuration',bot?.kind==='creator'?'此 Creator 使用原管理入口。':'此员工尚未初始化 Bot。',navigate(bot?.kind==='creator'?'打开 Creator 聊天':'初始化 Bot',bot?.kind==='creator'?'chat':'settings'));
  else if(bot?.effect?.executionAdmission?.deviceExecution==='blocked')setGate('unavailable',short(bot.effect.executionAdmission.message)||'运行电脑需要更新客户端。',navigate('检查电脑客户端','settings'));
  else if(bot?.instance?.mode==='owned_profile'&&(provision?.status!=='provisioned'||!bot.instance.home))setGate(['pending','acked','not_started'].includes(provision?.status)?'checking':'failed',provision?.status==='uncertain'?'专属 Profile 创建结果待核实。':short(provision?.error)||'专属 Profile 尚未取得创建成功回执。',navigate('查看创建状态','settings'));
  else if(blockingAction&&(uncertain(blockingAction.result)||blockingAction.status==='expired'&&blockingAction.acked_at))setGate('failed','原执行结果尚未核实，暂不能派发新工作。',navigate('核实原执行','activity'));
  else if(blockingAction&&inFlight(blockingAction))setGate('checking','原执行仍在进行，等待本次结果后才能派发新工作。',navigate('查看原执行','activity'));
  else if(!device||device.id!==employee.target_device_id||device.status!=='online'||device.healthy===false)setGate('offline',!device?'尚未发现此 Bot 的运行电脑。':'此 Bot 的运行电脑离线或心跳已过期。',navigate('检查运行电脑','settings'));
  else if(!runtime||runtime.cli_status!=='available'||runtime.available===false)setGate('unavailable',short(runtime?.issues?.[0]?.message)||'运行电脑尚未发现可用 Hermes CLI。',navigate('检查 Hermes 环境','settings'));
  else if(bot?.instance?.mode==='owned_profile'&&!profile)setGate('needs_check','电脑尚未发现此 Bot 的专属 Profile。',navigate('查看运行环境','settings'));
  else if(profile?.authentication_configured===false||profile?.readiness?.authentication==='missing'||!configured&&(provision?.authentication==='required'||runtime.readiness?.authentication==='missing'&&bot?.instance?.mode!=='owned_profile'))setGate('needs_configuration','此运行 Profile 缺少模型认证。',navigate('配置模型认证','settings'));
  else if(profile?.provider_configured===false||profile?.readiness?.provider==='missing'||!configured&&runtime.readiness?.provider==='missing'&&bot?.instance?.mode!=='owned_profile')setGate('needs_configuration','此运行 Profile 缺少模型服务商配置。',navigate('配置模型服务商','settings'));
  else if(validation.status==='pending')setGate('checking','正在检查当前配置。',navigate('查看配置检查','activity'));
  else if(!configured)setGate(validation.status==='failed'?'failed':'needs_check',validation.status==='failed'?short(validation.error)||'当前配置检查失败。':'当前保存的配置尚未检查。',{kind:'validate',label:validation.status==='failed'?'重新检查配置':'检查当前配置',tab:'activity'});
  else if(bot.control_state!=='active'||employee.status&&employee.status!=='active')setGate('disabled',bot.control_state==='paused'||employee.status==='paused'?'Bot 已暂停。':'Bot 尚未启用。',{kind:'activate',label:bot.control_state==='paused'||employee.status==='paused'?'恢复 Bot':'启用 Bot',tab:'activity'});

  function check(resource,operations) {
    const matches=action=>action.payload?.nativeOperation?.resource===resource&&(!operations||operations.includes(action.payload.nativeOperation.operation));
    const action=currentActions.find(matches);
    if(!action){const old=ordered.find(item=>identity(item)&&matches(item));return old?{stale:true,action:old}:null;}
    const receipt=nativeReceipt(action);
    if(receipt&&(receipt.schemaVersion!==2||receipt.employeeId!==bot.id||receipt.revision!==bot.revision||!operationsMatch(action.payload.nativeOperation,receipt)))return{action,invalid:true};
    return{action,receipt,data:receipt?.data||{}};
  }
  function observed(value,label,tab) {
    if(!value)return null;
    if(value.stale)return{state:'needs_check',reason:`${label}的原检查属于旧配置，请重新读取。`,action:navigate('重新检查'+label,tab),checkedAt:null};
    if(value.invalid)return{state:'needs_check',reason:`${label}回执与此 Bot 的原操作不匹配，需要重新读取。`,action:navigate('重新检查'+label,tab)};
    const {action,receipt,data}=value;
    if(uncertain(action.result)||action.status==='expired'&&action.acked_at)return{state:'failed',reason:`${label}的原执行待核实。`,action:navigate('查看原执行','activity')};
    if(inFlight(action))return{state:'checking',reason:`正在等待${label}的本机检查结果。`,action:navigate('查看检查进度',tab)};
    const code=short(receipt?.code||action.error||data.code),detail=short(data.reason||data.error||action.error);
    if(['unsupported','unsupported_version','not_integrated'].includes(receipt?.status)||/UNSUPPORTED|NOT_SUPPORTED/.test(code))return{state:'unavailable',reason:`当前 Hermes 不支持${label}${detail?'：'+detail:'。'}`,action:navigate('检查版本与依赖','settings')};
    if(receipt?.status==='requires_authorization'||/AUTHORIZATION|CREDENTIAL|API_KEY|TOKEN_MISSING|AUTHENTICATION/.test(code))return{state:'needs_configuration',reason:`${label}需要授权${detail?'：'+detail:'。'}`,action:navigate('配置'+label,tab)};
    if(receipt?.status==='requires_dependency'||/DEPENDENCY|MODULE_NOT_FOUND|IMPORT_ERROR/.test(code))return{state:'unavailable',reason:`${label}缺少依赖${detail?'：'+detail:'。'}`,action:navigate('检查'+label+'依赖',tab)};
    if(action.status==='failed'||action.status==='expired'||receipt?.status==='failed')return{state:'failed',reason:detail||`${label}检查失败。`,action:navigate('检查'+label+'设置',tab)};
    if(data.staged||data.pending_id||data.mutation?.staged||data.mutation?.pending_id)return{state:'needs_configuration',reason:`${label}修改已暂存，等待原生审核。`,action:navigate('查看待审核修改',tab)};
    if(action.status==='succeeded'&&receipt?.status==='succeeded'&&!exited(action))return{state:'needs_check',reason:`${label}尚无完整的本机检查完成证明。`,action:navigate('重新检查'+label,tab)};
    if(action.status==='succeeded'&&!receipt)return{state:'needs_check',reason:`${label}尚无匹配的原生检查回执。`,action:navigate('重新检查'+label,tab)};
    return null;
  }
  function withCheck(base,value,label,tab,onSuccess) {
    if(!value)return base;
    const problem=observed(value,label,tab);
    const evidence=[...(base.evidence||[]),{type:value.stale?'stale_action':'native_action',actionId:value.action.id,status:value.action.status,revision:value.action.payload.hermesBot.revision,controlEpoch:value.action.payload.hermesBot.controlEpoch,nativeVersion:value.receipt?.nativeVersion||null}];
    if(problem)return{...base,...problem,evidence,checkedAt:problem.checkedAt===null?null:time(value.action)};
    return{...base,...(value.action.status==='succeeded'&&value.receipt?.status==='succeeded'?onSuccess(value):{}),evidence,checkedAt:time(value.action)};
  }
  const servers=Object.entries(config.mcpServers||{}).filter(([,value])=>value.enabled!==false),toolPermission=config.permissions?.mode==='execute';
  const targets=config.collaboration?.targetEmployeeIds||[],collaboration=Boolean(config.collaboration?.enabled);
  const enable=(key,label,tab)=>({kind:'enable',key,label,tab});
  const validationAction=ordered.find(action=>identity(action)&&action.id===validation.action_id&&action.payload.hermesBot.revision===bot?.revision);
  const completedTurn=action=>['conversation.execute','runtime.execute','agent.execute','task.execute','automation.execute'].includes(action.type)&&action.status==='succeeded'&&!uncertain(action.result)&&exited(action);
  const actualTurn=currentActions.find(completedTurn);
  const result=capabilities.map(capability=>{
    let cap={...capability,state:'needs_check',enabled:null,reason:'',action:null,checkedAt:null};
    if(capability.status==='not_integrated')return{...cap,state:'unavailable',reason:`当前版本尚未接入${capability.label}。`};
    switch(cap.id){
      case 'bot_identity':cap={...cap,state:employee.instructions||employee.persona?'ready':'needs_configuration',enabled:true,reason:employee.instructions||employee.persona?'岗位与工作方式已保存。':'尚未填写岗位职责或工作方式。',action:navigate('编辑岗位职责','settings')};break;
      case 'persistent_chat':cap={...cap,state:bot.main_conversation_id?'ready':'needs_configuration',enabled:Boolean(bot.main_conversation_id),reason:bot.main_conversation_id?'主聊天已保存，后续对话沿用同一会话。':'尚未建立主聊天。',action:navigate('打开主聊天','chat')};break;
      case 'profile_memory':{
        const enabled=config.memory?.enabled!==false;cap={...cap,state:enabled?'enabled':'disabled',enabled,reason:enabled?'独立记忆已开启。':'独立记忆已关闭。',action:enabled?navigate('查看原生记忆','knowledge'):enable('memory','开启记忆','knowledge')};
        if(enabled)cap=withCheck(cap,check('memory'),'记忆','knowledge',()=>({state:'ready',reason:'独立记忆已开启，原生内容读取检查通过。'}));break;
      }
      case 'model_provider':cap={...cap,state:actualTurn?'ready':'needs_check',enabled:null,reason:actualTurn?'当前模型已完成一次真实执行。':configured?'模型与认证配置检查通过，尚无当前版本的模型执行记录。':'模型沿用保存配置或来源 Profile，需检查实际模型与认证。',action:navigate(actualTurn?'查看模型执行记录':'查看模型配置',actualTurn?'activity':'settings'),checkedAt:actualTurn?time(actualTurn):configured?time(validationAction):null,evidence:[...(cap.evidence||[]),...(actualTurn?[{type:'model_execution',actionId:actualTurn.id,revision:bot.revision,controlEpoch:bot.control_epoch}]:[])]};break;
      case 'skills':cap=withCheck({...cap,reason:'尚未读取此 Bot 的原生技能目录。',action:navigate('管理技能','knowledge')},check('skills',['list','read','install','hub_install','update','remove','check_updates']),'技能','knowledge',({data,action})=>({state:items(data).length?'ready':action.payload.nativeOperation.operation==='list'?'needs_configuration':'needs_check',reason:action.payload.nativeOperation.operation==='list'?(items(data).length?`已发现 ${items(data).length} 项技能；技能执行需按任务确认。`:'原生技能目录为空。'):'技能操作已返回，重新读取目录核对当前内容。',action:navigate(items(data).length?'管理技能':'安装技能','knowledge')}));break;
      case 'tools_mcp':{
        cap={...cap,enabled:toolPermission,state:toolPermission?servers.length||(config.toolsets||[]).length?'needs_check':'needs_configuration':'disabled',reason:!toolPermission?'当前只允许无工具对话。':servers.length?`已配置 ${servers.length} 个 MCP 服务，尚未检查连接与工具。`:(config.toolsets||[]).length?'已选择工具集，尚未取得实际加载结果。':'尚未添加工具集或 MCP 服务。',action:!toolPermission?enable('tools_permission','允许使用工具','knowledge'):navigate(servers.length?'检查 MCP 工具':'添加 MCP','knowledge')};
        if(toolPermission)cap=withCheck(cap,check('mcp',['inspect','call']),'MCP','knowledge',({data,action})=>({state:action.payload.nativeOperation.operation==='call'?'ready':data.connected===true&&Array.isArray(data.tools)?'ready':'needs_check',reason:action.payload.nativeOperation.operation==='call'?'所选 MCP 工具已有调用回执。':data.connected===true?`MCP 连接检查通过，发现 ${data.tools?.length||0} 个工具；其他工具需分别确认。`:'MCP 尚未确认连接。'}));break;
      }
      case 'routines':{
        const active=routines.filter(item=>item.status==='active'),scheduled=active.filter(item=>item.next_run),last=routines.map(item=>item.last_result).filter(Boolean).sort((a,b)=>String(b.finished_at||b.started_at||'').localeCompare(String(a.finished_at||a.started_at||'')))[0];
        cap={...cap,enabled:active.length>0,state:!routines.length?'needs_configuration':active.length?scheduled.length===active.length?'enabled':'failed':'disabled',reason:!routines.length?'尚未创建例行计划。':active.length?scheduled.length===active.length?`已启用 ${active.length} 项计划，由紫薇统一调度。`:'有已启用计划尚未计算下次运行时间。':'例行计划均已暂停。',action:navigate(routines.length?'管理例行工作':'创建例行工作','routines'),checkedAt:last?.finished_at||null};break;
      }
      case 'delegation':case 'groups_mentions':{
        const groups=cap.id==='groups_mentions';
        cap={...cap,enabled:collaboration,state:!targets.length?'needs_configuration':!toolPermission?'needs_configuration':!collaboration?'disabled':groups?'needs_check':'enabled',reason:!targets.length?'尚未选择允许协作的伙伴。':!toolPermission?'伙伴协作需要先允许使用工具。':!collaboration?'已选择伙伴，尚未开启协作。':groups?'伙伴协作已开启，尚未读取群组与成员。':`已授权 ${targets.length} 位伙伴；委派结果按目标执行确认。`,action:targets.length&&toolPermission&&!collaboration?enable('collaboration','开启伙伴协作','collaboration'):navigate(!targets.length?'选择协作伙伴':!toolPermission?'设置协作权限':groups?'管理原生群组':'查看伙伴协作','collaboration')};
        if(collaboration&&toolPermission&&targets.length)cap=withCheck(cap,check(groups?'groups':'collaboration'),groups?'群组':'伙伴协作','collaboration',({data,action})=>groups?{state:items(data).length||data.room?'ready':'needs_configuration',reason:items(data).length?`已读取 ${items(data).length} 个群组。`:data.room?'已读取当前群组与成员。':'尚未创建原生群组。'}:{state:'ready',reason:action.result?.collaboration?.actions?.length?'委派已取得目标执行标识，结果分别核实。':'原生协作操作已返回，目标结果仍需分别核实。'});break;
      }
      case 'gateway':{
        const platforms=Object.entries(config.gateway?.platforms||{}).filter(([,value])=>value.enabled);cap={...cap,enabled:platforms.length>0,state:platforms.length?'needs_check':'needs_configuration',reason:platforms.length?'渠道配置已保存，尚未确认在线连接。':'尚未配置并连接消息渠道。',action:navigate('连接渠道','channels')};
        cap=withCheck(cap,check('gateway'),'消息渠道','channels',({data,action})=>{
          const rows=Array.isArray(data.runtime)?data.runtime:[],connects=currentActions.filter(item=>{const receipt=nativeReceipt(item);return item.payload.nativeOperation?.resource==='gateway'&&item.payload.nativeOperation.operation==='connect'&&item.status==='succeeded'&&!uncertain(item.result)&&!resultValue(item).residentExit&&receipt?.schemaVersion===2&&receipt.employeeId===bot.id&&receipt.revision===bot.revision&&receipt.resource==='gateway'&&receipt.operation==='connect'&&receipt.status==='succeeded'&&receipt.data?.connected===true;});
          const connected=rows.some(worker=>platforms.some(([platform])=>platform===worker.platform)&&worker.employeeId===bot.id&&(worker.workspace===undefined||worker.workspace===bot.workspace)&&worker.revision===bot.revision&&worker.controlEpoch===bot.control_epoch&&worker.status==='connected'&&worker.processAlive!==false&&Number.isFinite(worker.lastHeartbeat)&&now-worker.lastHeartbeat*1000>=0&&now-worker.lastHeartbeat*1000<=20000&&connects.some(item=>item.id===worker.sourceActionId));
          return connected?{state:'ready',reason:'原生最近心跳已确认渠道连接。'}:{state:platforms.length?'needs_check':'needs_configuration',reason:data.connected===true?'渠道曾报告连接成功，需要刷新当前连接状态。':action.payload.nativeOperation.operation==='disconnect'&&data.stopConfirmed===true?'渠道已断开。':'渠道尚无当前版本的在线连接证明。'};
        });break;
      }
      case 'voice':{
        const modes=Object.entries(config.voice||{}).filter(([,value])=>value.enabled!==false&&value.provider);cap={...cap,enabled:modes.length>0,state:modes.length?'needs_check':'needs_configuration',reason:modes.length?'语音服务商已配置，尚未验证实际音频调用。':'尚未配置语音识别或合成服务商。',action:navigate('配置语音','channels')};
        cap=withCheck(cap,check('voice'),'语音','channels',({action,data})=>{const op=action.payload.nativeOperation.operation,output=op==='transcribe'?Boolean(String(data.transcript||data.text||'').trim()):op==='synthesize'&&data.files?.some(file=>String(file.mimeType||'').startsWith('audio/')&&file.audioBase64);return output&&data.success!==false?{state:'ready',reason:op==='transcribe'?'语音识别已取得一次实际调用回执。':'语音合成已取得一次实际调用回执。'}:{state:modes.length?'needs_check':'needs_configuration',reason:modes.length?'语音已配置，仍需取得实际音频调用产物。':'语音服务商尚未配置。'};});break;
      }
      case 'multimodal':{
        const image=currentActions.find(action=>completedTurn(action)&&action.payload.attachments?.some(item=>String(item.mimeType||item.mime_type||'').startsWith('image/')));
        cap={...cap,state:image?'ready':'needs_check',reason:image?'当前模型已完成一次图片对话。':'尚无当前模型处理图片的成功记录。',action:navigate('打开图片对话','chat'),checkedAt:time(image),evidence:[...(cap.evidence||[]),...(image?[{type:'image_execution',actionId:image.id,revision:bot.revision,controlEpoch:bot.control_epoch}]:[])]};break;
      }
      case 'session_search':cap=withCheck({...cap,reason:'尚未检查此 Bot 的原生会话目录。',action:navigate('检索会话','knowledge')},check('sessions'),'会话检索','knowledge',({action})=>({state:'ready',reason:action.payload.nativeOperation.operation==='search'?'原生会话检索已返回结果。':'原生会话目录读取检查通过。'}));break;
      case 'goals':case 'heartbeat':case 'kanban':{
        const label=cap.id==='goals'?'目标':cap.id==='heartbeat'?'主动检查':'原生工作';
        cap=withCheck({...cap,state:'needs_configuration',reason:`尚未设置${label}。`,action:navigate(cap.id==='goals'?'设置目标':cap.id==='heartbeat'?'配置主动检查':'创建原生工作','proactive')},check(cap.id),label,'proactive',({data,action})=>{
          const state=data.state?.status||data.state?.state,enabled=state==='active'||state==='running';
          if(cap.id==='kanban')return{state:items(data).length||data.task?'ready':'needs_configuration',reason:data.task?`原生工作状态：${short(data.task.status)||'已保存'}。`:items(data).length?`已读取 ${items(data).length} 项原生工作；执行按每次派发确认。`:'尚无原生工作。'};
          return{enabled,state:!data.state?'needs_configuration':enabled?'enabled':'disabled',reason:!data.state?`尚未设置${label}。`:enabled?`${label}状态已开启；${data.run===false?'本次未触发模型回合。':'持续推进需配置例行工作。'}`:`${label}当前状态：${short(state)||'已暂停'}。`,action:navigate(enabled?'管理主动工作':'配置'+label,'proactive')};
        });break;
      }
      case 'observability':cap={...cap,state:'ready',enabled:true,reason:actions.length?`已保存 ${actions.length} 条近期执行记录。`:'运行记录已接入，尚无工作执行。',action:navigate('查看运行记录','activity'),checkedAt:time(ordered[0])};break;
      default:cap={...cap,state:'unavailable',reason:'当前版本没有此能力的状态检查入口。'};
    }
    if(bot?.configuration_state!=='initialized')cap={...cap,state:'needs_configuration',enabled:null,reason:`${cap.label}尚未初始化。`,action:gate.action,blockedBy:gate.state};
    else if(gate.state!=='ready'&&['ready','enabled'].includes(cap.state))cap={...cap,state:gate.state,blockedBy:gate.state};
    if(cap.action?.kind==='enable'&&bot?.instance?.mode==='owned_profile'&&provision?.status!=='provisioned')cap={...cap,state:gate.state,action:gate.action,blockedBy:gate.state};
    return cap;
  });
  return{capabilities:result,capabilityGate:gate};
}
