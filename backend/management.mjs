import crypto from 'node:crypto';
import { normalizeRuntimeProfile } from '../src/employee-runtime.mjs';
import { createBotService } from './bots.mjs';
import {botProfileBinding,assertBotProfileReady} from './bot-profiles.mjs';
import {assertEmployeeCapabilityAuthority,assertEmployeeCapabilitySubject,projectEmployeeCapabilityAction,EMPLOYEE_CAPABILITY_INSPECTION_TYPE} from './employee-capability-inventory.mjs';
import {assertDshPluginsSubject,projectDshPluginsAction,DSH_PLUGIN_ACTIONS} from './dsh-plugins.mjs';

const parse = (value, fallback = {}) => { try { return JSON.parse(value) ?? fallback; } catch { return fallback; } };
const fingerprint = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : (value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])])) : value);
const fail = (message, code, status = 400) => { const error = new Error(message); error.status = status; error.code = code; throw error; };
const deviceInput = input => String(input.targetDeviceId ?? input.target_device_id ?? input.deviceId ?? input.device_id ?? '').trim();
const profileInput = input => { for (const key of ['runtimeProfile','runtime_profile','profile','hermesProfile','hermes_profile']) if (Object.hasOwn(input, key)) return input[key]; return undefined; };
const assertDshNativeModel=input=>{if(input.model||input.modelId||input.model_id)fail('DSH 使用所选 Bot 的原生模型和 Provider，请在 DSH 中调整。','DSH_NATIVE_MODEL_REQUIRED');};

export function createManagementService(repo) {
  const db = repo.db;
  const ws = slug => { const value = db.prepare('SELECT * FROM workspaces WHERE slug=?').get(slug); if (!value) fail('工作区不存在', 'WORKSPACE_NOT_FOUND', 404); return value; };
  const trustedContext = context => ({ actorRole: 'owner', ...context, userId: context?.actorUserId || null, user_id: context?.actorUserId || null, actor_user_id: context?.actorUserId || null, actor_role: context?.actorRole || 'owner', enforceEmployeeVisibility: true, enforceDeviceOwnership: true });
  const employee = (slug, id, context = {}) => {
    const item = repo.listEmployees(slug, trustedContext(context)).find(row => row.id === id && row.status !== 'deleted');
    if (!item) fail('数字员工不存在于当前工作区', 'EMPLOYEE_NOT_FOUND', 404);
    return item;
  };
  const discovery = (slug, options = {}) => {
    const workspace = ws(slug);
    const requestedId = deviceInput(options);
    const devices = repo.listDevices(slug, { userId: options.userId }).filter(item => (!requestedId || item.id === requestedId) && (!options.deviceScope || item.id === options.deviceScope)).map(item => {
      const metadata = db.prepare('SELECT * FROM runtime_device_metadata WHERE workspace_id=? AND device_id=? ORDER BY runtime_name').all(workspace.id, item.id);
      const ownedProfiles=new Set(db.prepare('SELECT b.profile_binding_json,e.runtime_profile FROM hermes_bots b JOIN employees e ON e.id=b.employee_id WHERE e.target_device_id=?').all(item.id).filter(row=>botProfileBinding(row).mode==='owned_profile').map(row=>row.runtime_profile));
      const runtimes = metadata.map(row => {
        const deviceRuntime=item.runtimes.find(runtime=>runtime.name.toLowerCase()===row.runtime_name.toLowerCase());
        const readiness = parse(row.readiness_json);
        const issues = [];
        if (item.status !== 'online') issues.push({ code: 'DEVICE_OFFLINE', message: '目标电脑离线，请在这台电脑启动已有 ziwei_user 并等待心跳。' });
        if (row.status !== 'available' || (deviceRuntime&&deviceRuntime.detection.state!=='available')) issues.push({ code: 'CLI_UNAVAILABLE', message: deviceRuntime?.detection.reason || `${row.runtime_name} CLI 不可用，请在目标电脑安装/修复该 CLI。` });
        if (row.runtime_name.toLowerCase() !== 'hermes') {
          if (readiness.authentication === 'missing') issues.push({ code: 'AUTHENTICATION_MISSING', message: `${row.runtime_name} 缺少认证，请在目标电脑登录对应 CLI。` });
          if (readiness.provider === 'missing') issues.push({ code: 'PROVIDER_MISSING', message: `${row.runtime_name} 缺少 provider，请在目标电脑配置模型服务。` });
          if (readiness.ready === false && !issues.length) issues.push({ code: readiness.code || 'RUNTIME_NOT_READY', message: readiness.reason || '运行时尚未就绪，请检查目标电脑配置。' });
        }
        const seenAt = Date.parse(row.last_seen || '');
        const age = Number(item.heartbeat_interval_ms || 10000);
        if (!Number.isFinite(seenAt) || Date.now() - seenAt > Math.max(45000, age * 4)) issues.push({ code: 'DISCOVERY_STALE', message: 'CLI 发现证据已过期，请等待目标电脑新的运行时发现心跳。' });
        const profiles=parse(row.profiles_json,[]).map(profile=>row.runtime_name.toLowerCase()==='hermes'?{...profile,owned_profile:profile.owned_profile===true||ownedProfiles.has(profile.name),initialization_source:profile.initialization_source!==false&&profile.owned_profile!==true&&!ownedProfiles.has(profile.name)}:profile);
        return { name: row.runtime_name, version: row.version, binary: row.binary, cli_status: deviceRuntime?.cli_status || (item.status === 'online' ? row.status : 'offline'), discovery_state:deviceRuntime?.discovery_state, detection:deviceRuntime?.detection, models: parse(row.models_json, []), profiles, readiness, last_seen: row.last_seen, available: issues.length === 0, verified: readiness.authentication === 'configured' && readiness.provider === 'configured' && issues.length === 0, issues };
      });
      return { id: item.id, name: item.name, os: item.os, status: item.status, healthy: item.healthy, last_seen: item.last_seen, heartbeat_age_ms: item.heartbeat_age_ms, workdir: item.workdir, management_mcp: parse(item.management_mcp_json), terminal_mcp:parse(item.terminal_mcp_json), runtimes };
    });
    return { workspace: slug, source: 'device_heartbeat', discovered_at: new Date().toISOString(), devices, skills: repo.listSkills(slug).map(skill => ({ id: skill.id, name: skill.name, description: skill.description, installed: skill.installed, validation_status: skill.validation_status,version:skill.version,catalog_id:skill.catalog_id,integration:skill.integration })) };
  };
  const validateSelection = (slug, input, { requireProfile = true, allowUnknownReadiness = true, context = {} } = {}) => {
    const runtimeName = String(input.runtime || '').trim();
    if (!runtimeName) fail('必须明确 runtime，例如 Codex 或 Hermes；不会自动替换运行时。', 'RUNTIME_REQUIRED');
    const deviceId = deviceInput(input);
    const requestedProfile = normalizeRuntimeProfile(profileInput(input));
    if(runtimeName.toLowerCase()==='dsh'){
      if(!deviceId)fail('DSH 必须明确选择目标电脑。','DEVICE_REQUIRED');
      if(!requestedProfile)fail('DSH 必须明确选择目标电脑已发现的真实 Bot。','PROFILE_REQUIRED');
      assertDshNativeModel(input);
      const device=discovery(slug,{deviceId,userId:context.actorUserId,deviceScope:context.deviceScope}).devices[0];
      if(!device||device.status!=='online')fail('DSH 目标电脑不存在、离线或无权访问。','DEVICE_NOT_IN_WORKSPACE');
      const runtime=device.runtimes.find(row=>row.name==='DSH'),bot=runtime?.profiles.find(row=>row.name===requestedProfile);
      if(!runtime||runtime.issues.length)fail(runtime?.issues[0]?.message||'目标电脑尚未发现 DSH，请启动原生 DSH Hub 后刷新。',runtime?.issues[0]?.code||'RUNTIME_NOT_DISCOVERED');
      if(!bot)fail('目标电脑没有这个 DSH Bot，请刷新后重新选择。','PROFILE_NOT_FOUND');
      if(bot.readiness?.ready!==true)fail(bot.readiness?.reason||'DSH Bot 尚未启动完成，请在原生 DSH 中启动后刷新。','PROFILE_NOT_READY');
      if(!allowUnknownReadiness&&!runtime.verified)fail('DSH 模型与 Provider 尚无实际运行验证回执。','READINESS_UNKNOWN');
      return {runtime:'DSH',targetDeviceId:deviceId,runtimeProfile:requestedProfile,readiness:runtime.readiness,...(repo.serverCodeRollout?{executionAdmission:repo.serverCodeRollout.status()}:{})};
    }
    if (runtimeName.toLowerCase()==='hermes' && deviceId && requestedProfile && db.prepare("SELECT b.profile_binding_json FROM hermes_bots b JOIN employees e ON e.id=b.employee_id WHERE e.target_device_id=? AND e.runtime_profile=? AND e.status='deleted'").all(deviceId,requestedProfile).some(row=>botProfileBinding(row).mode==='owned_profile')) fail('此专属 Profile 保留属于已删除的员工，不能绑定给新员工或模板。','EMPLOYEE_PROFILE_DELETED',409);
    if(repo.serverCodeRollout){const device=discovery(slug,{deviceId,userId:context.actorUserId,deviceScope:context.deviceScope}).devices[0];if(!deviceId||!device)fail('目标电脑必须属于当前工作区','DEVICE_NOT_IN_WORKSPACE');if(context.deviceScope&&context.deviceScope!==deviceId)fail('目标电脑不属于当前设备身份','DEVICE_NOT_IN_WORKSPACE');return {runtime:runtimeName,targetDeviceId:deviceId,runtimeProfile:normalizeRuntimeProfile(profileInput(input)),executionAdmission:repo.serverCodeRollout.status()};}
    if (!deviceId) fail('必须选择当前工作区的目标电脑 targetDeviceId，请先调用 ziwei_discover_environment。', 'DEVICE_REQUIRED');
    const device = discovery(slug, { deviceId, userId: context.actorUserId, deviceScope: context.deviceScope }).devices[0];
    if (!device) fail('目标设备不属于当前工作区，请重新发现并选择工作区电脑。', 'DEVICE_NOT_IN_WORKSPACE');
    if (device.status !== 'online') fail('目标设备当前离线，请在该电脑启动已有 ziwei_user 并等待心跳。', 'DEVICE_OFFLINE');
    const runtime = device.runtimes.find(row => row.name.toLowerCase() === runtimeName.toLowerCase());
    if (!runtime) fail(`目标电脑没有 ${runtimeName} CLI 的发现记录，请安装并等待心跳；不会替换为其他 runtime。`, 'RUNTIME_NOT_DISCOVERED');
    if (runtime.issues.length) fail(runtime.issues[0].message, runtime.issues[0].code);
    if (!allowUnknownReadiness && !runtime.verified) fail('目标电脑尚未上报认证/provider 就绪证据，请升级 ziwei_user 并等待心跳。', 'READINESS_UNKNOWN');
    const profile = normalizeRuntimeProfile(profileInput(input));
    if (runtime.name.toLowerCase() === 'hermes' && requireProfile) {
      if (!profile) fail('Hermes 必须明确选择独立 runtimeProfile，先创建 profile 并等待成功和发现回读；不会回退主 profile。', 'PROFILE_REQUIRED');
      const selected = runtime.profiles.find(row => row.name === profile);
      if (!selected) fail(`Hermes profile 不存在于目标电脑: ${profile}。请使用 ziwei_create_hermes_profile 并等待成功后重试。`, 'PROFILE_NOT_FOUND');
      if (selected.provider_configured === false || selected.readiness?.provider === 'missing') fail(`Hermes profile ${profile} 缺少 provider，请在目标电脑配置或创建时继承 provider。`, 'PROFILE_PROVIDER_MISSING');
      if (selected.authentication_configured === false || selected.readiness?.authentication === 'missing') fail(`Hermes profile ${profile} 缺少认证，请在目标电脑配置该 profile 的认证。`, 'PROFILE_AUTHENTICATION_MISSING');
      if (selected.readiness?.ready === false) fail(selected.readiness.reason || `Hermes profile ${profile} 尚未就绪。`, selected.readiness.code || 'PROFILE_NOT_READY');
    } else if (profile && runtime.name.toLowerCase() !== 'hermes') {
      const selected = runtime.profiles.find(row => row.name === profile);
      if (!selected) fail(`${runtime.name} 未在目标电脑发现 profile ${profile}，请创建有效运行配置；不会静默忽略。`, 'PROFILE_NOT_FOUND');
      if (selected.readiness?.ready === false) fail(selected.readiness.reason || `${runtime.name} profile ${profile} 尚未就绪。`, selected.readiness.code || 'PROFILE_NOT_READY');
    }
    // Management is a platform default prepared at connect/execute time.
    // Missing preparation must stay visible without deadlocking employee save.
    return { runtime: runtime.name, targetDeviceId: deviceId, runtimeProfile: profile, readiness: runtime.readiness };
  };
  const idempotent = (slug, kind, input, create, read) => {
    const workspace = ws(slug);
    const { idempotencyKey, idempotency_key, ...body } = input;
    const digest = fingerprint(body); const key = String(idempotencyKey ?? idempotency_key ?? digest).trim();
    if (!key || key.length > 200) fail('idempotencyKey 必须为 1–200 字符。', 'IDEMPOTENCY_KEY_INVALID');
    const existing = db.prepare('SELECT * FROM management_requests WHERE workspace_id=? AND kind=? AND request_key=?').get(workspace.id, kind, key);
    if (existing) {
      if (existing.fingerprint !== digest) fail('同一 idempotencyKey 已用于不同请求，请使用新的请求标识。', 'IDEMPOTENCY_CONFLICT', 409);
      let value;try { value=read(existing.resource_id); } catch(error) { if(error.status!==404)throw error; }
      if (!value) fail('原请求资源已被删除，请使用新的请求标识。', 'IDEMPOTENCY_RESOURCE_GONE', 409);
      return { ...value, duplicate: true };
    }
    db.exec('SAVEPOINT management_create');
    try {
      const value = create(body);
      db.prepare('INSERT INTO management_requests(workspace_id,kind,request_key,fingerprint,resource_id,created_at) VALUES(?,?,?,?,?,?)').run(workspace.id, kind, key, digest, value.id, new Date().toISOString());
      db.exec('RELEASE management_create'); return value;
    } catch (error) { db.exec('ROLLBACK TO management_create'); db.exec('RELEASE management_create'); throw error; }
  };
  const actionVisible = (slug, item, context = {}) => {
    if (!item) return false;
    const actor = trustedContext(context);
    const payload = item.payload || {};
    if (!['owner', 'admin'].includes(actor.actorRole) && payload.userId && payload.userId !== actor.actorUserId) return false;
    if(item.type===EMPLOYEE_CAPABILITY_INSPECTION_TYPE){
      // Inventory uses a nested, immutable subject rather than a business Bot
      // payload. Generic action history must not bypass its current fences.
      try{
        const current=assertEmployeeCapabilitySubject(db,ws(slug).id,payload);
        assertEmployeeCapabilityAuthority(db,ws(slug).id,current,{userId:actor.actorUserId,role:actor.actorRole,deviceScope:context.deviceScope});
        if(!repo.listEmployees(slug,actor).some(row=>row.id===current.employeeId))return false;
      }catch{return false;}
    }
    if(DSH_PLUGIN_ACTIONS.includes(item.type)){
      try{
        const current=assertDshPluginsSubject(db,ws(slug).id,payload);
        assertEmployeeCapabilityAuthority(db,ws(slug).id,current,{userId:actor.actorUserId,role:actor.actorRole,deviceScope:context.deviceScope});
        if(!repo.listEmployees(slug,actor).some(row=>row.id===current.employeeId))return false;
      }catch{return false;}
    }
    const linkedEmployeeId = payload.employeeId || (payload.conversationId ? db.prepare('SELECT employee_id FROM conversations WHERE id=? AND workspace_id=?').get(payload.conversationId, ws(slug).id)?.employee_id : null);
    if (linkedEmployeeId && !repo.listEmployees(slug, actor).some(row => row.id === linkedEmployeeId)) return false;
    const deviceId = payload.deviceId || (linkedEmployeeId ? db.prepare('SELECT target_device_id FROM employees WHERE id=? AND workspace_id=?').get(linkedEmployeeId, ws(slug).id)?.target_device_id : null);
    if (context.deviceScope && deviceId && deviceId !== context.deviceScope) return false;
    if (deviceId && actor.actorUserId && !['owner', 'admin'].includes(actor.actorRole) && ws(slug).kind === 'personal' && !repo.listDevices(slug, { userId: actor.actorUserId }).some(row => row.id === deviceId)) return false;
    return true;
  };
  const tasks = (slug, filters = {}, context = {}) => {
    const visible = new Set(repo.listEmployees(slug, trustedContext(context)).map(row => row.id));
    const hidden = repo.listEmployees(slug).filter(row => !visible.has(row.id));
    return repo.listTasks(slug, filters).filter(row => !hidden.some(item => row.assignee === item.id || row.assignee === item.name) && (!row.execution || actionVisible(slug, row.execution, context)));
  };
  const task = (slug, taskId, context = {}) => {
    const item = tasks(slug, {}, context).find(row => row.id === taskId);
    if (!item) fail('任务不存在于当前工作区', 'TASK_NOT_FOUND', 404);
    return { ...item, messages: repo.getTaskMessages(taskId) };
  };
  const action = (slug, actionId, context = {}) => {
    const item = repo.getA2AAction(actionId, { workspaceSlug: slug });
    if (!actionVisible(slug, item, context)) fail('执行请求不存在于当前工作区', 'ACTION_NOT_FOUND', 404);
    return projectDshPluginsAction(projectEmployeeCapabilityAction(item));
  };
  const employeeStatus = (slug, employeeId, context = {}) => {
    const item = employee(slug, employeeId, context);
    const device = discovery(slug, { deviceId: item.target_device_id || '__none__', userId: context.actorUserId, deviceScope: context.deviceScope }).devices[0] || null;
    const rows = db.prepare('SELECT * FROM a2a_actions WHERE workspace_id=? ORDER BY created_at DESC,rowid DESC').all(item.workspace_id);
    const latest = item.management_mcp_enabled ? rows.find(row => {
      const payload = parse(row.payload_json);
      return payload.employeeId === employeeId && payload.managementMcp?.enabled === true && payload.managementMcp.workspace === slug && payload.runtime === item.runtime && (payload.profile || null) === (item.runtime_profile || null) && (payload.deviceId || null) === (item.target_device_id || null);
    }) : null;
    const result = parse(latest?.result_json);
    const receipt = result.managementMcp || result.result?.managementMcp || {};
    const missingReceipt = latest?.status === 'succeeded' && receipt.loaded !== true;
    return { employee_id: item.id, enabled: item.management_mcp_enabled, target_device_id: item.target_device_id, runtime: item.runtime, runtime_profile: item.runtime_profile, device, receipt: { status: !latest ? 'never_run' : (latest.status === 'failed' || latest.status === 'expired' || missingReceipt ? 'failed' : (receipt.loaded ? 'loaded' : (receipt.injected ? 'injected' : 'pending'))), loaded: receipt.loaded === true, injected: receipt.injected === true, action_id: latest?.id || null, completed_at: latest?.completed_at || null, error: latest?.error || (missingReceipt ? '员工执行已退出，但缺少实际管理 MCP 握手与加载回执，请检查本机配置后重试。' : null), tool_calls: receipt.toolCalls || receipt.tool_calls || [] } };
  };
  const service = {
    discovery, validateSelection, employee, tasks, task, action, employeeStatus,
    createEmployee(slug, input, context = {}) {
      return idempotent(slug, 'employee', input, body => {
        const selection = validateSelection(slug, body, { context });
        const skills = repo.listSkills(slug);
        if (Array.isArray(body.skills)) for (const skillId of body.skills) if (!skills.some(skill => skill.id === skillId || skill.name === skillId)) fail(`当前工作区没有技能 ${String(skillId)}，请先发现真实技能或导入后重试。`, 'SKILL_NOT_FOUND');
        const ownerUserId = ['owner', 'admin'].includes(trustedContext(context).actorRole) ? body.ownerUserId ?? body.owner_user_id ?? context.actorUserId : context.actorUserId;
        return repo.createEmployee(slug, { ...body, ...selection, ownerUserId, owner_user_id: ownerUserId, ...trustedContext(context) },trustedContext(context));
      }, id => employee(slug, id, context));
    },
    updateEmployee(slug, id, input, context = {}) {
      repo.preservation?.assert({employeeId:id});
      const previous = employee(slug, id, context);
      const nativeDsh=String(input.runtime??previous.runtime).toLowerCase()==='dsh';
      if(nativeDsh)assertDshNativeModel(input);
      if(db.prepare('SELECT 1 FROM hermes_bots WHERE employee_id=?').get(id) && !context.botConfigurationWrite) {
        const bindingKeys=['runtime','targetDeviceId','target_device_id','deviceId','device_id','runtimeProfile','runtime_profile','profile','hermesProfile','hermes_profile'];
        for(const key of bindingKeys) if(Object.hasOwn(input,key)) {
          const saved=key==='runtime'?previous.runtime:(/profile/i.test(key)?previous.runtime_profile:previous.target_device_id);
          if((input[key] ?? null)!==(saved ?? null))fail('已配置 Bot 的 runtime/电脑/profile 迁移需要单独迁移流程。','BOT_MIGRATION_REQUIRED',409);
        }
        const patch=Object.fromEntries(['name','avatar','description','persona','instructions','skills','visibility'].filter(key=>Object.hasOwn(input,key)).map(key=>[key,input[key]]));
        for(const key of ['model','modelId','model_id'])if(Object.hasOwn(input,key)){patch.model=input[key];break;}
        const current=service.bots.get(slug,id,context);
        let updated=Object.keys(patch).length?service.bots.update(slug,id,{expectedRevision:input.expectedRevision ?? current.revision,employee:patch},context):current;
        if(input.status && input.status!==previous.status) {
          if(!['active','paused'].includes(input.status))fail('Bot 状态由控制入口管理，归档请先暂停并核对执行。','BOT_CONTROL_INVALID',409);
          if(input.status==='active' && (input.expectedRevision!==updated.revision || input.expectedControlEpoch!==updated.control_epoch))fail('启用 Bot 必须提供最新 expectedRevision 与 expectedControlEpoch；请刷新 Bot 配置。','BOT_CONTROL_CONFLICT',409);
          updated=service.bots.control(slug,id,{expectedRevision:input.expectedRevision ?? updated.revision,expectedControlEpoch:input.expectedControlEpoch ?? updated.control_epoch,operation:input.status==='active'?'activate':'pause'},context);
        }
        const directoryKeys=['defaultWorkingDirectory','default_working_directory','defaultWorkingDirectoryActionId','default_working_directory_action_id'];
        const directoryPatch=Object.fromEntries(directoryKeys.filter(key=>Object.hasOwn(input,key)).map(key=>[key,input[key]]));
        if(Object.keys(directoryPatch).length)repo.updateEmployee(id,directoryPatch,{...trustedContext(context),botConfigurationWrite:true});
        return employee(slug,id,context);
      }
      const configChanged = ['runtime', 'targetDeviceId','target_device_id','deviceId','device_id','runtimeProfile','runtime_profile','profile','hermesProfile','hermes_profile','managementMcpEnabled','management_mcp_enabled','managementMcp'].some(key => Object.hasOwn(input, key));
      const targetSpecified = ['targetDeviceId','target_device_id','deviceId','device_id'].some(key => Object.hasOwn(input, key));
      const profileSpecified = ['runtimeProfile','runtime_profile','profile','hermesProfile','hermes_profile'].some(key => Object.hasOwn(input, key));
      const merged = { ...previous, ...input, runtime: input.runtime ?? previous.runtime, targetDeviceId: targetSpecified ? deviceInput(input) : previous.target_device_id, runtimeProfile: profileSpecified ? profileInput(input) : previous.runtime_profile, managementMcpEnabled: input.managementMcpEnabled ?? input.management_mcp_enabled ?? input.managementMcp?.enabled ?? previous.management_mcp_enabled };
      if (configChanged && (merged.targetDeviceId||nativeDsh)) validateSelection(slug, merged, { context });
      return repo.updateEmployee(id, input,trustedContext(context));
    },
    inspectWorkdir(slug,deviceId,input={},context={}) {
      return repo.createDeviceDirectoryAction(slug,deviceId,input,trustedContext(context));
    },
    createConversation(slug,input={},context={}) {
      repo.preservation?.assert(input);
      if(!(input.employeeId || input.employee_id)) fail('必须指定当前工作区的员工 employeeId。','EMPLOYEE_REQUIRED');
      const selected=employee(slug,input.employeeId || input.employee_id,context);
      const targetDeviceId=String(input.deviceId ?? input.device_id ?? input.targetDeviceId ?? input.target_device_id ?? selected.target_device_id ?? '').trim() || null;
      const ownLegacyDevice=Boolean(context.deviceScope && context.deviceScope===targetDeviceId && context.deviceCredentialDeviceId===targetDeviceId);
      const create=body=>repo.createConversation(slug,{...body,...trustedContext(context),enforceDeviceOwnership:!ownLegacyDevice});
      if(input.idempotencyKey===undefined && input.idempotency_key===undefined) return create(input);
      return idempotent(slug,`conversation:${context.actorUserId || 'legacy'}`,input,create,id=>repo.getConversation(id,trustedContext(context)));
    },
    createTask(slug, input, context = {}) {
      repo.preservation?.assert(input);
      return idempotent(slug, 'task', input, body => {
        const reference = body.employeeId || body.employee_id || body.assignee;
        const matching = repo.listEmployees(slug).filter(row => row.id === reference || row.name === reference);
        if (matching.some(row => !repo.listEmployees(slug, trustedContext(context)).some(visible => visible.id === row.id))) fail('员工不存在于当前身份范围内', 'EMPLOYEE_NOT_FOUND', 404);
        if (body.execute !== true && !body.runtime && !body.model) return repo.createTask(slug, { ...body, ...trustedContext(context) });
        const assignee = String(body.employeeId || body.employee_id || body.assignee || '').trim();
        const candidates = repo.listEmployees(slug, trustedContext(context)).filter(row => row.id === assignee || row.name === assignee);
        if (candidates.length !== 1) fail('执行任务必须明确指定当前工作区唯一 employeeId，请先查询员工。', 'EMPLOYEE_REQUIRED');
        const selected = candidates[0];
        if (selected.status !== 'active') fail('该员工当前不是 active，请先启用再试运行。', 'EMPLOYEE_INACTIVE');
        if (body.runtime && String(body.runtime).toLowerCase() !== selected.runtime.toLowerCase()) fail('任务 runtime 与员工配置不同；请先明确更新员工，不能静默替换运行时。', 'RUNTIME_MISMATCH');
        if (profileInput(body) && profileInput(body) !== selected.runtime_profile) fail('任务 profile 与员工配置不同；请先明确更新员工。', 'PROFILE_MISMATCH');
        const targetDeviceId = deviceInput(body) || selected.target_device_id;
        const botRow=db.prepare('SELECT * FROM hermes_bots WHERE employee_id=? AND workspace_id=?').get(selected.id,selected.workspace_id);
        const owned=botProfileBinding(botRow).mode==='owned_profile';
        if(owned){assertBotProfileReady(db,botRow,selected);if(targetDeviceId!==selected.target_device_id)fail('Bot 任务必须使用专属 Profile 所属电脑','BOT_BINDING_CONFLICT',409);}
        const selection = validateSelection(slug, { runtime: selected.runtime, runtimeProfile: selected.runtime_profile, targetDeviceId, managementMcpEnabled: selected.management_mcp_enabled }, { context,requireProfile:!owned });
        const ownLegacyDevice = Boolean(context.deviceScope && context.deviceScope === selection.targetDeviceId && context.deviceCredentialDeviceId === selection.targetDeviceId);
        return task(slug, repo.createTask(slug, { ...body, ...selection, employeeId: selected.id, assignee: selected.id, execute: true, ...trustedContext(context), enforceDeviceOwnership: !ownLegacyDevice }).id, context);
      }, id => task(slug, id, context));
    },
    createProfile(slug, input, context = {}) {
      repo.preservation?.assert(input);
      return idempotent(slug, 'hermes-profile', input, body => {
        validateSelection(slug, { ...body, runtime: 'Hermes' }, { requireProfile: false, context });
        return repo.createHermesProfileAction(slug, { ...body, ...trustedContext(context) }, { deviceCredentialDeviceId: context.deviceCredentialDeviceId });
      }, id => action(slug, id, context));
    }
  };
  service.bots = createBotService(repo, service);
  return service;
}
