const UNKNOWN='unknown';
const scopeKey=subject=>JSON.stringify(['workspace','employeeId','ownerUserId','deviceId','runtime','profile','revision','controlEpoch'].map(key=>subject?.[key]??null));
const identityFields=['workspace','employeeId','ownerUserId','deviceId','runtime','profile','revision','controlEpoch'];
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
export function inventoryEmployeeBindingChanged(previous,next){return !next||['id','owner_user_id','runtime','runtime_profile','target_device_id','visibility'].some(key=>(previous?.[key]??null)!==(next[key]??null));}
export function syncInventoryRosterSelection(selection,rows=[]){if(!selection?.employee?.id)return null;const row=rows.find(value=>value.id===selection.employee.id&&(!value.workspace||value.workspace===selection.workspace));if(!row?.employee)return null;if(row.employee===selection.employee)return selection;return{...selection,employee:row.employee,conversationId:row.main_conversation_id||null};}
const layerDefinitions=[['installed','安装','installation'],['configured','配置','configuration'],['visible','可见','visibility'],['assigned','员工分配','assigned'],['enabled','启用','enabled'],['onDemand','按需读取','onDemand'],['authorization','授权','authorization'],['loaded','本轮加载','loaded']];
const layerLabels={installed:'已安装',missing:'未安装',configured:'已配置',not_configured:'未配置',visible:'可见',not_visible:'不可见',assigned:'已分配',not_assigned:'未分配',enabled:'已启用',disabled:'未启用',available:'可按需读取',unavailable:'不可按需读取',authorized:'已授权',denied:'未获授权',authorization_required:'需要本人授权',loaded:'已取得加载证据',not_loaded:'未加载',unknown:'尚未核实',pending:'等待核实',not_applicable:'不适用'};
const trueStates={installed:'installed',configured:'configured',visible:'visible',assigned:'assigned',enabled:'enabled',onDemand:'available',authorization:'authorized',loaded:'loaded'};
const falseStates={installed:'missing',configured:'not_configured',visible:'not_visible',assigned:'not_assigned',enabled:'disabled',onDemand:'unavailable',authorization:'denied',loaded:'not_loaded'};
const reasonLabels={DEVICE_OFFLINE:'运行电脑离线，当前显示上次记录；连接后可刷新。',CAPABILITY_DEVICE_OFFLINE:'运行电脑离线，连接后可刷新。',DEVICE_NOT_FOUND:'尚未选择可用的运行电脑，请在员工设置中检查。',PROFILE_MISSING:'运行电脑尚未发现此员工的 Profile，请检查员工设置。',PROFILE_NOT_FOUND:'运行电脑尚未发现此员工的 Profile，请检查员工设置。',CLIENT_UNSUPPORTED:'运行电脑的客户端尚不支持此明细，请更新后刷新。',CAPABILITY_INVENTORY_UNSUPPORTED:'当前客户端尚不支持能力明细，请更新后刷新。',RUNTIME_UNAVAILABLE:'尚未发现员工所选的运行时，请检查运行电脑。',NOT_OBSERVED:'尚未取得本轮加载证据，不能据此判断已加载。',NOT_CHECKED:'尚未检查，请主动刷新。',AUTHORIZATION_REQUIRED:'需要本人完成授权，请使用原有连接入口。',PERMISSION_DENIED:'当前员工没有获得此项使用权限。',NOT_ASSIGNED:'尚未分配给当前员工。',NOT_INSTALLED:'运行电脑尚未发现此项安装。'};
Object.assign(reasonLabels,{CLIENT_NOT_REPORTED:'运行电脑尚未报告能力清单支持，请更新客户端后刷新。',DEVICE_UNASSIGNED:'尚未指定运行电脑，请先到员工设置中选择。',DEVICE_REVOKED:'目标电脑连接已停用，请检查设备授权。',INSPECTION_TIMEOUT:'只读检查等待超时，请检查电脑连接，再重新刷新。',INSPECTION_FAILED:'只读检查未完成，请检查电脑连接或员工配置后重试。',CONFIGURATION_CHANGED:'员工配置已变化，上次清单仅供参考；请重新刷新。',SUBJECT_CHANGED:'员工电脑、Profile 或配置已变化，请重新刷新。',NO_SNAPSHOT:'还没有这位员工的检查记录，请发起只读刷新。',UNKNOWN:'尚未核实，请主动刷新取得电脑检查记录。',CACHE_READ_UNAVAILABLE:'缓存状态读取失败，暂时显示上次记录；请检查连接后重新读取。',inventory_truncated:'清单超出本次只读检查上限，仅显示部分；总数待核实。',REFRESH_PENDING:'等待运行电脑完成只读检查，请稍后读取缓存。',AUTHORITY_REVOKED:'原检查授权已变化，请核对账号和员工权限后刷新。',SNAPSHOT_EXPIRED:'上次记录已过期，请刷新取得新的检查证据。',LATE_RECEIPT:'检查结果返回过晚，保留为历史记录，请重新刷新。',INSPECTION_RECEIPT_INVALID:'本次检查回执无法核实，请更新客户端后重新刷新。',NOT_REPORTED:'还没有这位员工的能力报告，请发起只读刷新。',managed_installation_not_found:'尚未发现受管理的安装记录；这不等于员工没有其他安装。',managed_installation_not_verified:'尚未核实受管理的安装记录，请检查电脑客户端。',employee_authorization_unverified:'安装信息已读取，但员工授权和实际可见性仍需分别核实。',version_unknown:'已发现安装记录，尚未取得可核实的版本号。',runtime_context_unavailable:'尚未取得此员工运行时目录的只读信息，请检查运行电脑和 Profile。',some_metadata_unreadable:'部分技能元数据无法读取，已保留可核实的条目。',native_configuration_unreadable:'运行时配置暂时无法读取，请检查电脑上的当前配置。',skill_roots_missing:'尚未核实此员工的技能目录，请检查运行电脑和 Profile。',runtime_not_adapted:'当前运行时的技能和 MCP 明细尚未接入。',metadata_missing:'本次检查没有读到对应安装元数据。',metadata_too_large:'该项元数据超出只读检查范围，暂未读取。',metadata_unreadable:'该项元数据暂时无法读取，请检查当前安装。'});
export function inventoryProfileLabel(employee={}){return employee.runtime_profile||(employee.runtime?'默认 Profile（未显式指定）':'运行时尚未指定');}
export function inventoryReason(value){return reasonLabels[value]||'尚未取得可核验的明细，请检查员工配置或刷新。';}
export function inventorySource(value){const key=typeof value==='string'?value:value?.kind;return{runtime_skill:'运行时技能目录',project_skill:'项目技能目录',shared_skill:'共享技能目录',employee_config:'员工配置',bot_config:'员工配置',runtime_config:'运行时配置',device_inventory:'电脑只读检查',device_readonly:'电脑只读检查',platform_config:'平台配置',npm_package:'已登记软件包',managed_installation:'受管理安装记录',runtime_mcp:'运行时 MCP',business_cli:'业务 CLI',configured_cli:'已配置 CLI',runtime_cli:'运行电脑',execution_receipt:'执行回执',cache:'上次检查记录'}[key]||'来源待确认';}
export function inventoryLayerRows(item={},{historical=false}={}){return layerDefinitions.map(([key,label,flat])=>{const raw=item.layers?.[key]??item[flat]??item[key];let value=object(raw)?raw.status??raw.state:raw;value=({not_installed:'missing',requires_auth:'authorization_required',requires_authorization:'authorization_required',needs_auth:'authorization_required'})[value]||value;const allowed=[trueStates[key],falseStates[key],UNKNOWN,'pending','not_applicable',...(key==='authorization'?['authorization_required']:[])];const candidate=value===true?trueStates[key]:value===false?falseStates[key]:value;const state=allowed.includes(candidate)?candidate:UNKNOWN;return{key,label:historical&&key==='loaded'?'上次加载':label,state,text:(historical?'上次':'')+layerLabels[state],reason:object(raw)&&raw.reason?inventoryReason(raw.reason):'',tone:historical?'muted':['authorized','loaded','enabled','installed','configured','visible','assigned','available'].includes(state)?'positive':['denied','missing','not_configured','not_visible','not_assigned','unavailable','authorization_required'].includes(state)?'attention':'muted'};});}
export function inventorySections(value){const historical=Boolean(value?.stale&&value.snapshot?.sections&&value.snapshot.subject?.workspace===value.subject?.workspace&&value.snapshot.subject?.employeeId===value.subject?.employeeId&&(value.snapshot.subject?.ownerUserId??null)===(value.subject?.ownerUserId??null));return [['skills','Skills','技能'],['mcp','MCP','工具连接'],['cli','CLI','业务命令行']].map(([key,label,title])=>{const section=(historical?value.snapshot.sections:value?.sections)?.[key];const state=['ready','partial','unknown','pending','offline','failed'].includes(section?.status)?section.status:UNKNOWN;const items=Array.isArray(section?.items)?section.items.filter(object):[];const rawCount=(historical?value.snapshot.summary:value?.summary)?.[key];const count=state==='ready'&&Number.isInteger(rawCount)&&rawCount>=0?rawCount:null;return{key,label,title,state,historical,count,reason:section?.reason?inventoryReason(section.reason):'',items,empty:state==='ready'&&!value?.pending&&!value?.stale?'本次检查没有发现此类条目。':'尚未取得此类明细，不能据此判断员工没有此能力。'};});}
function responseScope(value,subject){if(value?.schemaVersion!==1||!object(value.subject)||identityFields.some(key=>Object.hasOwn(subject,key)&&value.subject[key]!==subject[key]))throw Object.assign(Error('scope'),{code:'CAPABILITY_INVENTORY_SCOPE_CHANGED'});return value;}
export function createEmployeeCapabilityInventory({api,wrap=value=>value,setTimer=setTimeout,clearTimer=clearTimeout,now=Date.now,pollIntervalMs=2000,pollLimit=30,pollBudgetMs=60000}={}){
 const state=wrap({subject:null,value:null,loading:false,refreshing:false,error:'',errorCode:'',notice:'',writeUnknown:false});
 let generation=0,request=0,disposed=false,loaded=false,active=false,timer=null,polls=0,deadline=0;
 const current=(visit,sequence)=>!disposed&&visit===generation&&sequence===request;
 function clearPoll(){if(timer!==null){clearTimer(timer);timer=null;}}
 function resetPoll(){clearPoll();polls=0;deadline=0;}
 function schedulePoll(){
  clearPoll();
  if(disposed||!active||!state.value?.pending)return;
  if(!deadline)deadline=now()+pollBudgetMs;
  if(polls>=pollLimit||now()>=deadline){state.notice='自动读取已到本次等待上限；稍后可手动读取缓存，查看最终检查原因。';return;}
  const visit=generation,subject=scopeKey(state.subject);
  timer=setTimer(async()=>{timer=null;if(disposed||!active||visit!==generation||subject!==scopeKey(state.subject))return;polls++;await load();},Math.max(1,Math.min(pollIntervalMs,deadline-now())));
  timer?.unref?.();
 }
 function fail(error){state.errorCode=error?.code==='CAPABILITY_INVENTORY_SCOPE_CHANGED'?error.code:'CAPABILITY_INVENTORY_UNAVAILABLE';state.error=error?.code==='CAPABILITY_INVENTORY_SCOPE_CHANGED'?'员工归属或配置已经变化，请重新选择后刷新。':error?.status===403?'当前账号不能读取此员工的能力明细。':error?.status===404?'能力明细暂不可用，请确认服务端和电脑客户端已更新。':'能力明细未能读取，请检查连接后重试。';}
 async function load(){
  if(!state.subject||state.loading||disposed)return;
  const subject={...state.subject},visit=generation,sequence=++request;clearPoll();state.loading=true;state.error='';state.errorCode='';
  try{const value=await api.employeeCapabilityInventory(subject.workspace,subject.employeeId);if(!current(visit,sequence))return;state.value=responseScope(value,subject);loaded=true;state.writeUnknown=false;if(!value.pending)resetPoll();return value;}
  catch(error){if(current(visit,sequence)){fail(error);if(error?.code==='CAPABILITY_INVENTORY_SCOPE_CHANGED'||[401,403,404].includes(error?.status)){state.value=null;resetPoll();}else if(state.value){
   const previous=state.value,snapshot=previous.snapshot||{schemaVersion:1,subject:previous.subject,checkedAt:previous.checkedAt,source:previous.source,sections:previous.sections,summary:previous.summary};
   state.value={...previous,status:'unknown',stale:true,reasonCode:'CACHE_READ_UNAVAILABLE',snapshot,sections:Object.fromEntries(['skills','mcp','cli'].map(key=>[key,{status:'unknown',reason:'CACHE_READ_UNAVAILABLE',items:[]}])),summary:{skills:null,mcp:null,cli:null}};
  }}}
  finally{if(current(visit,sequence)){state.loading=false;schedulePoll();}}
 }
 async function select(subject,{active:visible=false}={}){
  const next=subject?.workspace&&subject?.employeeId?{...subject}:null,changed=scopeKey(next)!==scopeKey(state.subject);
  if(changed){generation++;request++;resetPoll();state.subject=next;state.value=null;state.loading=false;state.refreshing=false;state.error='';state.errorCode='';state.notice='';state.writeUnknown=false;loaded=false;}
  if(active&&!visible){request++;resetPoll();state.loading=false;if(state.refreshing)state.writeUnknown=true;state.refreshing=false;loaded=false;}
  active=visible;
  if(active&&next&&!loaded&&!state.loading)await load();
  else if(active&&state.value?.pending)schedulePoll();
 }
 async function refresh(){
  if(!state.subject||state.loading||state.refreshing||state.writeUnknown||state.value?.pending||disposed)return;
  const subject={...state.subject},visit=generation,sequence=++request;resetPoll();state.refreshing=true;state.error='';state.errorCode='';state.notice='';
  try{
   const value=await api.refreshEmployeeCapabilityInventory(subject.workspace,subject.employeeId,{});if(!current(visit,sequence))return;
   if(value?.schemaVersion===1&&value?.subject)state.value=responseScope(value,subject);else state.value={...(state.value||{schemaVersion:1,subject,sections:{}}),pending:true};
   loaded=true;state.notice=state.value.pending?'只读刷新已受理，等待运行电脑返回检查结果。':state.value.status==='ready'&&!state.value.stale?'只读检查结果已返回；配置、授权和本轮加载状态分别列出。':'尚未开始新的电脑检查，请按当前原因处理后重试。';return value;
  }catch(error){if(current(visit,sequence)){fail(error);state.writeUnknown=true;state.error='刷新请求结果未确认，请先读取缓存状态，暂不重复提交。';}}
  finally{if(current(visit,sequence)){state.refreshing=false;schedulePoll();}}
 }
 return{state,select,load,refresh,dispose(){disposed=true;generation++;request++;clearPoll();}};
}
