import crypto from 'node:crypto';
import { readA2AToken, safeTokenEqual } from './a2a-auth.mjs';

const at = () => new Date().toISOString();
const parse = (value, fallback = {}) => { try { return JSON.parse(value) ?? fallback; } catch { return fallback; } };
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (message, code, status = 400) => { throw Object.assign(new Error(message), { code, status }); };
const required = (value, name) => { const result=String(value ?? '').trim(); if (!result || result.length>200) fail(`${name} 必须明确填写`, 'PHONE_SCOPE_REQUIRED'); return result; };
const keyFor = options => crypto.createHash('sha256').update(options.phoneMcpSecret || (options.memory ? crypto.randomBytes(32) : readA2AToken())).update('ziwei-phone-capability-v1').digest();

export function createPhoneMcpService(repo, connect, management, options = {}) {
  const db=repo.db; const key=keyFor(options);
  const publicBase=String(options.publicApiBase || process.env.ZIWEI_APP_URL || 'https://qzelynth.top').replace(/\/$/,'');
  const ws = slug => { const item=repo.getWorkspace(slug); if(!item) fail('工作区不存在','WORKSPACE_NOT_FOUND',404); return item; };
  const employee = (slug,id) => management.employee(slug,id);
  const skill = slug => repo.listSkills(slug).find(item=>item.catalog_id==='ziwei-phone-control');
  const configuration = (slug,id) => {
    const item=employee(slug,id);const installed=skill(slug); const cfg=db.prepare('SELECT * FROM employee_phone_mcp WHERE employee_id=? AND workspace_id=?').get(id,item.workspace_id);
    const binding=connect.listBindings(slug).find(row=>row.employeeId===id) || null;
    const attached=Boolean(installed?.installed && item.skills.includes(installed.id));
    const state={employee_id:id,workspace:slug,enabled:Boolean(cfg?.enabled && attached && binding),skill_id:installed?.id || null,skill_version:installed?.version || null,target_device_id:item.target_device_id,runtime:item.runtime,runtime_profile:item.runtime_profile,phone_device_id:binding?.deviceId || null,binding};
    const revision=digest([state.enabled,state.skill_id,state.skill_version,state.target_device_id,state.runtime,state.runtime_profile,state.phone_device_id,binding?.accountId || null]);
    return {...state,saved:Boolean(cfg),revision,credential:{configured:Boolean(cfg?.enabled && attached && binding),managed:true,mode:'execution_capability'}};
  };
  const assertEnabled = (slug,id) => { const cfg=configuration(slug,id);if(!cfg.enabled) fail('请先安装手机技能并配置员工与手机绑定','PHONE_MCP_NOT_CONFIGURED');return cfg; };
  const save = async (slug,id,input={}) => {
    const previous=configuration(slug,id);const item=employee(slug,id);const installed=skill(slug);const enabled=input.enabled !== false;
    if(enabled && !installed?.installed) fail('请先从技能中心安装手机操控技能','PHONE_SKILL_NOT_INSTALLED');
    const targetDeviceId=input.targetDeviceId ?? previous.target_device_id;
    const runtime=input.runtime ?? item.runtime;const runtimeProfile=Object.hasOwn(input,'runtimeProfile') ? input.runtimeProfile : item.runtime_profile;
    let phones=[];
    if(enabled) {
      management.validateSelection(slug,{runtime,runtimeProfile,targetDeviceId,managementMcpEnabled:item.management_mcp_enabled});
      const computer=management.discovery(slug,{deviceId:targetDeviceId}).devices[0];
      if(!['codex','hermes'].includes(String(runtime).toLowerCase())) fail('手机 MCP 当前支持 Codex 或 Hermes，不能静默替换运行时','PHONE_RUNTIME_UNSUPPORTED');
      if(!computer?.terminal_mcp?.configured || computer.terminal_mcp.workspace!==slug || !computer.terminal_mcp.supportedRuntimes?.some(name=>name.toLowerCase()===String(runtime).toLowerCase())) fail('目标电脑尚未支持当前工作区的员工手机 MCP bootstrap，请更新原 ziwei_user 并等待心跳','PHONE_MCP_ADAPTER_UNAVAILABLE');
      if(runtime.toLowerCase()==='hermes' && (!runtimeProfile || runtimeProfile==='default')) fail('手机 MCP 必须使用 Hermes 独立 profile','INDEPENDENT_PROFILE_REQUIRED');
      const phoneId=required(input.phoneDeviceId ?? previous.phone_device_id,'phoneDeviceId');
      phones=await connect.listDevices();if(!phones.some(row=>row.id===phoneId)) fail('手机不在紫薇·互联设备目录中','PHONE_NOT_FOUND',404);
    }
    db.exec('SAVEPOINT phone_config');
    try {
      if(enabled) connect.bindVerified(slug,{employeeId:id,deviceId:input.phoneDeviceId ?? previous.phone_device_id,accountId:input.accountId ?? previous.binding?.accountId,accountLabel:input.accountLabel ?? previous.binding?.accountLabel},phones);
      const skills=item.skills.filter(value=>value!==installed?.id);if(enabled) skills.push(installed.id);
      management.updateEmployee(slug,id,{...(enabled ? {runtime,runtimeProfile,targetDeviceId} : {}),skills});
      db.prepare('INSERT INTO employee_phone_mcp(employee_id,workspace_id,enabled,revision,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(employee_id) DO UPDATE SET enabled=excluded.enabled,revision=excluded.revision,updated_at=excluded.updated_at').run(id,item.workspace_id,enabled?1:0,'',at());
      const cfg=configuration(slug,id);db.prepare('UPDATE employee_phone_mcp SET revision=? WHERE employee_id=?').run(cfg.revision,id);db.exec('RELEASE phone_config');
      return {configuration:cfg};
    } catch(error) {db.exec('ROLLBACK TO phone_config');db.exec('RELEASE phone_config');throw error;}
  };
  const latestAction = (slug,id,cfg) => db.prepare('SELECT * FROM a2a_actions WHERE workspace_id=? ORDER BY created_at DESC,rowid DESC').all(ws(slug).id).find(row=>{const p=parse(row.payload_json);return p.employeeId===id && p.terminalMcp?.enabled && p.terminalMcp.workspace===slug && p.terminalMcp.deviceId===cfg.phone_device_id && p.deviceId===cfg.target_device_id && p.runtime===cfg.runtime && (p.profile || null)===(cfg.runtime_profile || null) && p.terminalMcp.configurationRevision===cfg.revision;});
  const status = async (slug,id) => {
    const cfg=configuration(slug,id);let api={status:'healthy',error:null};try{await connect.listDevices();}catch(error){api={status:'unavailable',error:error.message};}
    const latest=cfg.enabled ? latestAction(slug,id,cfg) : null;const result=parse(latest?.result_json);const receipt=result.terminalMcp || result.result?.terminalMcp || {};
    const missing=latest?.status==='succeeded' && receipt.loaded!==true;
    const run=connect.listRuns(slug,100).find(row=>row.employeeId===id && row.deviceId===cfg.phone_device_id && row.configurationRevision===cfg.revision && row.executionId===latest?.id);
    const missingImage=run?.action==='screenshot' && run.status==='succeeded' && !(run.result?.snapshot?.data || run.result?.device?.snapshot?.data);
    return {configuration:cfg,api,receipt:{status:!latest?'never_run':latest.status==='failed'||latest.status==='expired'||missing?'failed':receipt.loaded?'loaded':receipt.injected?'injected':'pending',loaded:receipt.loaded===true,injected:receipt.injected===true,action_id:latest?.id || null,error:latest?.error || (missing?'缺少实际手机 MCP 握手及工具加载回执':null),tool_calls:receipt.toolCalls || receipt.tool_calls || []},verification:{status:!run?'never_run':missingImage?'failed':run.status==='succeeded'?'succeeded':['uncertain','expired'].includes(run.status)?'uncertain':run.status==='failed'?'failed':'pending',command_id:run?.commandId || null,device_id:cfg.phone_device_id,configuration_revision:cfg.revision,result:run?.result || null,error:missingImage?'截图命令已成功，但缺少本次截图图片证据，请只读回读原命令结果':run?.error || null}};
  };
  const trial = (slug,id,input={},check=false) => {
    const cfg=assertEnabled(slug,id);management.validateSelection(slug,{runtime:cfg.runtime,runtimeProfile:cfg.runtime_profile,targetDeviceId:cfg.target_device_id});
    const action=input.action || 'screenshot';if(!check && !['health','screenshot'].includes(action)) fail('员工试运行仅选择 health 或 screenshot，正式会话可使用已授权完整工具集','TRIAL_ACTION_INVALID');
    const requestKey=String(input.idempotencyKey || crypto.randomUUID()).trim();if(requestKey.length>200) fail('idempotencyKey 太长','IDEMPOTENCY_KEY_INVALID');const kind=`phone-${check?'check':'trial'}:${id}`;const fingerprint=digest([cfg.revision,action,check]);const previous=db.prepare('SELECT * FROM management_requests WHERE workspace_id=? AND kind=? AND request_key=?').get(ws(slug).id,kind,requestKey);if(previous){if(previous.fingerprint!==fingerprint)fail('同一幂等键已经用于不同手机配置或试运行','IDEMPOTENCY_CONFLICT',409);const existing=repo.getA2AAction(previous.resource_id,{workspaceSlug:slug});if(!existing)fail('原试运行已删除','IDEMPOTENCY_RESOURCE_GONE',409);return{action:existing,conversation_id:existing.payload.conversationId,duplicate:true};}
    const prompt=check?`检测手机 MCP：实际调用 ziwei_phone_list、ziwei_phone_status，目标手机 ${cfg.phone_device_id}。只读取状态，不执行手机命令，报告真实工具结果。`:`通过手机 MCP 调用 ${action==='screenshot'?'ziwei_phone_screenshot':'ziwei_phone_action'}，仅对 ${cfg.phone_device_id} 执行 ${action}，回读原 commandId、状态${action==='screenshot'?'和截图':''}，不得重复提交不确定命令。`;
    const conversation=repo.createConversation(slug,{employeeId:id,title:check?'手机 MCP 检测':'手机 MCP 员工试运行',deviceId:cfg.target_device_id,actorRole:'owner'});
    const result=repo.addConversationMessage(conversation.id,{content:prompt,role:'user',dispatch:true,actorRole:'owner'});
    const created=result.execution || repo.listA2AActions(slug,{status:'all'}).find(row=>row.payload.conversationId===conversation.id);
    const row=created?.action || created;
    if(!row?.id) fail('员工试运行没有建立执行请求','TRIAL_DISPATCH_FAILED',500);
    const payload=parse(db.prepare('SELECT payload_json FROM a2a_actions WHERE id=?').get(row.id).payload_json);
    payload.terminalMcp={enabled:true,workspace:slug,employeeId:id,deviceId:cfg.phone_device_id,configurationRevision:cfg.revision,...(check?{checkOnly:true}:{})};
    db.prepare('UPDATE a2a_actions SET payload_json=? WHERE id=?').run(JSON.stringify(payload),row.id);
    db.prepare('INSERT INTO management_requests(workspace_id,kind,request_key,fingerprint,resource_id,created_at) VALUES(?,?,?,?,?,?)').run(ws(slug).id,kind,requestKey,fingerprint,row.id,at());
    return {action:repo.getA2AAction(row.id,{workspaceSlug:slug}),conversation_id:conversation.id};
  };
  const sign = value => { const body=Buffer.from(JSON.stringify(value)).toString('base64url');return `${body}.${crypto.createHmac('sha256',key).update(body).digest('base64url')}`; };
  const bootstrap = (slug,input,credential) => {
    if(!credential || credential.workspace!==slug) fail('需要当前工作区独立电脑凭证','PHONE_DEVICE_UNAUTHORIZED',401);
    const id=required(input.employeeId,'employeeId');const cfg=assertEnabled(slug,id);const action=repo.getA2AAction(required(input.actionId,'actionId'),{workspaceSlug:slug});
    if(!action || !['pending','acked'].includes(action.status) || Date.parse(action.expires_at)<=Date.now() || action.payload.employeeId!==id || action.payload.deviceId!==credential.deviceId || credential.deviceId!==cfg.target_device_id || action.payload.runtime!==cfg.runtime || (action.payload.profile || null)!==(cfg.runtime_profile || null) || action.payload.terminalMcp?.configurationRevision!==cfg.revision || action.payload.terminalMcp?.deviceId!==cfg.phone_device_id || action.payload.terminalMcp?.enabled!==true || input.deviceId!==cfg.phone_device_id) fail('手机 MCP bootstrap 与当前员工、电脑、手机或执行不匹配','PHONE_EXECUTION_SCOPE_MISMATCH',403);
    const expiresAt=new Date(Date.now()+30*60*1000).toISOString();
    const capability={workspace:slug,employeeId:id,deviceId:cfg.phone_device_id,actionId:action.id,computerDeviceId:credential.deviceId,credentialId:credential.credentialId,revision:cfg.revision,checkOnly:action.payload.terminalMcp.checkOnly===true,expiresAt};
    return {...capability,token:sign(capability),baseUrl:`${publicBase}/terminal-mcp/v1/workspaces/${encodeURIComponent(slug)}/employees/${encodeURIComponent(id)}`};
  };
  const authorize = (slug,id,token) => {
    const [body,signature,...extra]=String(token || '').split('.');if(extra.length || !body || !signature || !safeTokenEqual(signature,crypto.createHmac('sha256',key).update(body).digest('base64url'))) fail('需要有效的员工手机执行凭据','PHONE_CAPABILITY_INVALID',401);
    const cap=parse(Buffer.from(body,'base64url').toString());if(cap.workspace!==slug || cap.employeeId!==id || Date.parse(cap.expiresAt)<=Date.now()) fail('手机执行凭据已过期或超出员工/工作区scope','PHONE_CAPABILITY_SCOPE',403);
    const cfg=configuration(slug,id);const action=repo.getA2AAction(cap.actionId,{workspaceSlug:slug});const credential=db.prepare('SELECT revoked_at FROM device_credentials WHERE id=? AND device_id=?').get(cap.credentialId,cap.computerDeviceId);
    if(!credential || credential.revoked_at || !cfg.enabled || cfg.revision!==cap.revision || cfg.phone_device_id!==cap.deviceId || cfg.target_device_id!==cap.computerDeviceId || !action || !['pending','acked'].includes(action.status) || Date.parse(action.expires_at)<=Date.now()) fail('手机配置已改变、卸载或执行已结束，请重新发起员工执行','PHONE_CAPABILITY_REVOKED',403);
    return cap;
  };
  const call = async (slug,id,token,input) => {
    const cap=authorize(slug,id,token);const {toolDefinitions}=await import('../scripts/ziwei-terminal-mcp.mjs');const definition=toolDefinitions.find(row=>row.name===input?.name);
    if(!definition) fail('未知手机工具','PHONE_TOOL_UNKNOWN');const args=input.arguments ?? {};
    if(!args || typeof args!=='object'||Array.isArray(args)) fail('工具参数必须是对象','PHONE_TOOL_ARGUMENTS');
    for(const name of Object.keys(args)) if(!Object.hasOwn(definition.inputSchema.properties,name)) fail('工具包含未授权参数','PHONE_TOOL_ARGUMENTS');
    for(const name of definition.inputSchema.required || []) if(!Object.hasOwn(args,name)) fail(`缺少工具参数 ${name}`,'PHONE_TOOL_ARGUMENTS');
    for(const [name,value] of Object.entries(args)) {const s=definition.inputSchema.properties[name];if(s.enum && !s.enum.includes(value)) fail(`${name} 无效`,'PHONE_TOOL_ARGUMENTS');if(s.type==='string' && (typeof value!=='string'||!value.trim()||value.length>200)) fail(`${name} 无效`,'PHONE_TOOL_ARGUMENTS');if(s.type==='integer' && (!Number.isSafeInteger(value)||value<(s.minimum??0)||value>(s.maximum??Number.MAX_SAFE_INTEGER))) fail(`${name} 无效`,'PHONE_TOOL_ARGUMENTS');if(s.type==='object' && (!value || typeof value!=='object'||Array.isArray(value))) fail(`${name} 必须是对象`,'PHONE_TOOL_ARGUMENTS');}
    if(args.deviceId && args.deviceId!==cap.deviceId) fail('手机工具只能访问明确绑定的手机','PHONE_DEVICE_SCOPE',403);
    if(cap.checkOnly && !['ziwei_phone_list','ziwei_phone_status'].includes(input.name)) fail('本次检测仅授权工具发现和读取状态','PHONE_CHECK_SCOPE',403);
    return connect.toolCall(slug,{employeeId:id,phoneDeviceId:cap.deviceId,actionId:cap.actionId,configurationRevision:cap.revision},input.name,args);
  };
  const encrypt = value => {const iv=crypto.randomBytes(12);const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);return JSON.stringify({iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')});};
  const decrypt = value => {const c=parse(value);const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(c.iv,'base64'));decipher.setAuthTag(Buffer.from(c.tag,'base64'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(c.data,'base64')),decipher.final()]).toString());};
  const grants = slug => db.prepare('SELECT g.id,g.source_device_id,g.target_device_id,g.action_id,g.created_at,g.claimed_at,g.revoked_at,w.slug AS source_workspace FROM device_workspace_grants g JOIN workspaces w ON w.id=g.source_workspace_id WHERE g.target_workspace_id=?').all(ws(slug).id);
  const grant = (slug,input,userId=null) => {
    const target=ws(slug);const source=ws(required(input.sourceWorkspace,'sourceWorkspace'));const device=repo.listDevices(source.slug).find(row=>row.id===input.sourceDeviceId);if(!device) fail('源电脑不属于指定工作区','GRANT_DEVICE_NOT_FOUND',404);if(source.id===target.id) fail('请选择不同目标工作区','GRANT_WORKSPACE_SAME');if(device.status!=='online') fail('源电脑当前离线，请等待原daemon心跳','GRANT_DEVICE_OFFLINE');
    const existing=db.prepare('SELECT * FROM device_workspace_grants WHERE source_device_id=? AND target_workspace_id=?').get(device.id,target.id);if(existing && !existing.revoked_at) return {grant:grants(slug).find(row=>row.id===existing.id),action:repo.getA2AAction(existing.action_id),duplicate:true};
    db.exec('SAVEPOINT workspace_grant');try{
      const targetDevice=repo.createDevice(slug,{name:device.name,os:device.os,ownerUserId:userId});const id=`grant_${crypto.randomUUID()}`;const action=repo.createA2AAction(source.slug,{type:'device.workspace.connect',payload:{grantId:id,deviceId:device.id},dedupeKey:`workspace-grant:${id}`});
      db.prepare('INSERT INTO device_workspace_grants(id,source_workspace_id,source_device_id,target_workspace_id,target_device_id,created_by,action_id,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,source.id,device.id,target.id,targetDevice.id,userId,action.id,at(),new Date(Date.now()+24*60*60*1000).toISOString());db.exec('RELEASE workspace_grant');return{grant:grants(slug).find(row=>row.id===id),action};
    }catch(error){db.exec('ROLLBACK TO workspace_grant');db.exec('RELEASE workspace_grant');throw error;}
  };
  const claim = (id,credential) => {
    const g=db.prepare('SELECT g.*,w.slug AS workspace FROM device_workspace_grants g JOIN workspaces w ON w.id=g.target_workspace_id WHERE g.id=?').get(id);
    if(!g || !credential || credential.workspaceId!==g.source_workspace_id || credential.deviceId!==g.source_device_id || g.revoked_at || Date.parse(g.expires_at)<=Date.now()) fail('电脑共享授权无效、过期或不属于当前源电脑','GRANT_SCOPE_INVALID',403);
    if(g.secret_json) return decrypt(g.secret_json);
    const token=`zwd_${crypto.randomBytes(32).toString('base64url')}`;const result={workspace:g.workspace,deviceId:g.target_device_id,deviceToken:token,apiBase:publicBase};
    db.exec('SAVEPOINT workspace_claim');try{db.prepare('INSERT INTO device_credentials(id,device_id,workspace_id,token_hash,token_prefix,created_at) VALUES(?,?,?,?,?,?)').run(`device-credential_${crypto.randomUUID()}`,g.target_device_id,g.target_workspace_id,crypto.createHash('sha256').update(token).digest('hex'),token.slice(0,12),at());db.prepare('UPDATE device_workspace_grants SET secret_json=?,claimed_at=? WHERE id=?').run(encrypt(result),at(),id);db.exec('RELEASE workspace_claim');return result;}catch(error){db.exec('ROLLBACK TO workspace_claim');db.exec('RELEASE workspace_claim');throw error;}
  };
  return {configuration,save,status,trial,bootstrap,call,grants,grant,claim,async setup(slug,context={}){let phones=[],api={status:'healthy',error:null};try{phones=await connect.listDevices();}catch(error){api={status:'unavailable',error:error.message};}return{workspace:slug,skill:skill(slug),computers:management.discovery(slug,context).devices,phones,employees:repo.listEmployees(slug,context).map(row=>({...row,phone_mcp:configuration(slug,row.id)})),api};}};
}
