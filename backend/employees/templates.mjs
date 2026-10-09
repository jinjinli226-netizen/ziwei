import crypto from 'node:crypto';
import { normalizeRuntimeProfile } from '../../src/employee-runtime.mjs';
import { listEmployeeTemplates, getEmployeeTemplate, createTemplateEmployeeConfig } from './creator-template.mjs';

const fail = (message, code, status = 400) => { const error=new Error(message); error.status=status; error.code=code; throw error; };
const optionalText = value => String(value ?? '').trim() || null;
const configurationHash = employee => crypto.createHash('sha256').update(JSON.stringify([
  employee.name, employee.runtime, employee.model_id, employee.description, employee.persona,
  employee.visibility, employee.skills, employee.instructions, employee.runtime_profile,
  employee.avatar, employee.status, employee.target_device_id,
])).digest('hex');
const profileReady = profile => profile.provider_configured !== false && profile.authentication_configured !== false &&
  profile.readiness?.provider !== 'missing' && profile.readiness?.authentication !== 'missing' && profile.readiness?.ready !== false &&
  (profile.provider_configured === true || profile.readiness?.provider === 'configured') &&
  (profile.authentication_configured === true || profile.readiness?.authentication === 'configured');

export function createEmployeeTemplateService(repo, management) {
  const db=repo.db;
  const actor = (slug, context = {}) => {
    const actorUserId=optionalText(context.actorUserId);
    if (!actorUserId) fail('请先登录后安装自己的数字员工模板。','AUTH_REQUIRED',401);
    const workspace=db.prepare('SELECT * FROM workspaces WHERE slug=?').get(slug);
    if (!workspace) fail('工作区不存在','WORKSPACE_NOT_FOUND',404);
    // Membership is authoritative even for direct service callers. Body and
    // supplied role aliases cannot elevate the current account.
    const membership=db.prepare('SELECT role FROM members WHERE workspace_id=? AND user_id=?').get(workspace.id,actorUserId);
    if (!membership || !['owner','admin','member'].includes(membership.role)) fail('没有当前工作区访问权限','WORKSPACE_FORBIDDEN',403);
    return {actorUserId,actorRole:membership.role,enforceEmployeeVisibility:true,enforceDeviceOwnership:true};
  };
  const provenance = (catalog, item, employee) => ({
    id:catalog.id,version:item.template_version,catalogVersion:catalog.version,origin:item.origin,
    customized:item.origin === 'adopted-existing' || item.initial_config_hash !== configurationHash(employee),
    templateApplied:item.origin === 'template',
  });
  const ownEmployee = (slug, item, context) => {
    const employee=repo.getEmployee(item.employee_id,context);
    if (!employee || employee.workspace_id !== item.workspace_id || employee.owner_user_id !== context.actorUserId) fail('模板实例员工已不属于当前成员，请检查原实例。','TEMPLATE_INSTANCE_CONFIG_CONFLICT',409);
    return employee;
  };
  const assertExplicitMatches = (input, employee) => {
    const comparisons=[
      ['runtime', value => optionalText(value)?.toLowerCase(), employee.runtime.toLowerCase()],
      ['targetDeviceId', optionalText, employee.target_device_id || null],
      ['runtimeProfile', normalizeRuntimeProfile, employee.runtime_profile || null],
      ['model', optionalText, employee.model_id || null],
      ['visibility', optionalText, employee.visibility],
    ];
    for (const [key,normalize,saved] of comparisons) if (Object.hasOwn(input,key) && normalize(input[key]) !== saved) fail('已安装的模板使用不同配置；请打开现有员工并明确修改，安装不会覆盖保存的配置。','TEMPLATE_INSTANCE_CONFIG_CONFLICT',409);
  };
  const conversationFor = (slug, item, employee, context) => {
    let conversation=item.conversation_id ? repo.getConversation(item.conversation_id,context) : null;
    if (conversation && (conversation.workspace_id !== item.workspace_id || conversation.employee_id !== employee.id)) fail('模板会话绑定与实例不一致。','TEMPLATE_INSTANCE_CONFIG_CONFLICT',409);
    if (!conversation) {
      const existing=repo.listConversations(slug,{...context,conversationEmployeeId:employee.id}).find(row => row.status === 'active');
      conversation=existing ? repo.getConversation(existing.id,context) : repo.createConversation(slug,{
        employeeId:employee.id,title:employee.name,deviceId:employee.target_device_id,modelId:employee.model_id,...context,
      });
      item=repo.setEmployeeTemplateConversation(slug,context.actorUserId,item.template_id,conversation.id);
    }
    return {item,conversation};
  };
  const selectionFor = (slug, catalog, input, context) => {
    const requested=optionalText(input.runtime);
    if (!requested) fail('请选择 Codex 或 Hermes 运行时。','RUNTIME_REQUIRED');
    if (!catalog.supportedRuntimes.some(value => value.toLowerCase() === requested.toLowerCase())) fail('该模板只支持实际选择的 Codex 或 Hermes，不会替换运行时。','TEMPLATE_RUNTIME_UNSUPPORTED');
    const targetDeviceId=optionalText(input.targetDeviceId);
    const hermes=requested.toLowerCase() === 'hermes';
    let selected=management.validateSelection(slug,{runtime:requested,targetDeviceId,runtimeProfile:input.runtimeProfile}, {requireProfile:false,allowUnknownReadiness:hermes,context});
    if (hermes) {
      const runtime=management.discovery(slug,{deviceId:targetDeviceId,userId:context.actorUserId}).devices[0]?.runtimes.find(row => row.name.toLowerCase() === 'hermes');
      const profiles=runtime?.profiles || [];
      let name=Object.hasOwn(input,'runtimeProfile') ? normalizeRuntimeProfile(input.runtimeProfile) : null;
      if (Object.hasOwn(input,'runtimeProfile') && !name) fail('请选择明确的 Hermes profile；不会回退其他 profile。','PROFILE_REQUIRED');
      if (!Object.hasOwn(input,'runtimeProfile')) {
        const ready=profiles.filter(profileReady);
        if (ready.some(row => row.name === 'default')) name='default';
        else if (ready.length === 1) name=ready[0].name;
        else if (ready.length > 1) fail('发现多个已就绪的 Hermes profile，请明确选择 runtimeProfile。','TEMPLATE_PROFILE_SELECTION_REQUIRED');
        else fail('没有认证与 provider 已就绪的 Hermes profile，请配置后等待发现回读。','TEMPLATE_PROFILE_NOT_READY');
      }
      // Existing validator supplies specific explicit-profile failure codes;
      // templates additionally require affirmative readiness evidence.
      selected=management.validateSelection(slug,{runtime:selected.runtime,targetDeviceId,runtimeProfile:name},{context});
      if (!profileReady(profiles.find(row => row.name === name))) fail('所选 Hermes profile 缺少已验证的认证或 provider 就绪证据。','TEMPLATE_PROFILE_NOT_READY');
    }
    const visibility=Object.hasOwn(input,'visibility') ? optionalText(input.visibility) : 'personal';
    if (!['personal','workspace'].includes(visibility)) fail('visibility 必须是 personal 或 workspace。','TEMPLATE_VISIBILITY_INVALID');
    return {...selected,modelId:optionalText(input.model),visibility};
  };
  return {
    list(slug, context = {}) {
      const trusted=actor(slug,context);
      return {templates:listEmployeeTemplates().map(catalog => {
        const item=repo.getEmployeeTemplateInstance(slug,trusted.actorUserId,catalog.id);
        const employee=item ? ownEmployee(slug,item,trusted) : null;
        const info=item ? provenance(catalog,item,employee) : null;
        const conversation=item?.conversation_id ? repo.getConversation(item.conversation_id,trusted) : null;
        return {id:catalog.id,name:catalog.name,version:catalog.version,description:catalog.description,supportedRuntimes:catalog.supportedRuntimes,
          workflow:catalog.workflow.map(step => typeof step === 'string' ? step : step.title),
          installed:Boolean(item),updateAvailable:Boolean(item?.origin === 'template' && item.template_version !== catalog.version),updatePolicy:'new-instances-only',
          instance:item ? {employeeId:employee.id,conversationId:conversation?.employee_id === employee.id ? conversation.id : null,templateVersion:item.template_version,
            runtime:employee.runtime,runtimeProfile:employee.runtime_profile,targetDeviceId:employee.target_device_id,modelId:employee.model_id,visibility:employee.visibility,
            origin:info.origin,customized:info.customized,templateApplied:info.templateApplied} : null};
      })};
    },
    install(slug, templateId, input = {}, context = {}) {
      const trusted=actor(slug,context);
      const catalog=getEmployeeTemplate(templateId);
      if (!catalog) fail('员工模板不存在。','TEMPLATE_NOT_FOUND',404);
      // Serialize retries and publish notifications only after all resources
      // commit. Management creation keeps its inner savepoint in this unit.
      return repo.withEmployeeTemplateTransaction(() => {
        let item=repo.getEmployeeTemplateInstance(slug,trusted.actorUserId,catalog.id);
        let employee,duplicate=Boolean(item);
        if (item) {
          employee=ownEmployee(slug,item,trusted);
          assertExplicitMatches(input,employee);
        } else {
          const selection=selectionFor(slug,catalog,input,trusted);
          const historical=repo.listEmployees(slug,trusted).filter(row => row.owner_user_id === trusted.actorUserId && row.name === catalog.name);
          if (historical.length > 1) fail('已有多个同名 Creator，请先确认要保留的员工；不会隐式采用或覆盖。','TEMPLATE_EXISTING_EMPLOYEE_CONFLICT',409);
          if (historical.length) {
            employee=historical[0];
            try { assertExplicitMatches({runtime:selection.runtime,targetDeviceId:selection.targetDeviceId,runtimeProfile:selection.runtimeProfile,model:selection.modelId,visibility:selection.visibility},employee); }
            catch { fail('现有同名 Creator 配置不同，请打开原员工确认；安装不会覆盖用户配置。','TEMPLATE_EXISTING_EMPLOYEE_CONFLICT',409); }
            if (db.prepare('SELECT id FROM employee_template_instances WHERE employee_id=?').get(employee.id)) fail('现有员工已有模板来源记录，请检查原实例。','TEMPLATE_EXISTING_EMPLOYEE_CONFLICT',409);
            duplicate=true;
          } else {
            const configuration=createTemplateEmployeeConfig(catalog.id,selection);
            employee=management.createEmployee(slug,{...configuration,ownerUserId:trusted.actorUserId,owner_user_id:trusted.actorUserId,idempotencyKey:crypto.randomUUID()},trusted);
          }
          item=repo.createEmployeeTemplateInstance(slug,{ownerUserId:trusted.actorUserId,employeeId:employee.id,templateId:catalog.id,
            templateVersion:duplicate ? null : catalog.version,origin:duplicate ? 'adopted-existing' : 'template',initialConfigHash:configurationHash(employee)});
        }
        const bound=conversationFor(slug,item,employee,trusted);
        const result={employee,conversation:bound.conversation,template:provenance(catalog,bound.item,employee),duplicate};
        return result;
      });
    },
  };
}
