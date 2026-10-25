import {botFailure} from '../src/hermes-bot-config.mjs';
const fail=(code,message,status=409)=>{throw botFailure(code,message,status);};
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const own=(v,keys)=>object(v)&&Object.keys(v).every(key=>keys.includes(key));
/** Employee self-service uses the in-flight device action as its authority.
 * No caller-selected employee, device, workspace, provider or credential is accepted. */
export function createBotAutonomyService(repo,{bots}){
 return {dispatch(actionId,body={},credential){
  if(!credential?.deviceId||!credential.workspaceId)fail('BOT_AUTONOMY_DEVICE_REQUIRED','需要当前电脑身份',401);
  if(!own(body,['operation','input','routineId','idempotencyKey']))fail('BOT_AUTONOMY_INPUT_INVALID','自主操作参数无效',400);
  const action=repo.deviceAction(actionId,{deviceId:credential.deviceId}),binding=action?.payload?.hermesBot;
  const workspaceId=repo.db?.prepare('SELECT workspace_id FROM a2a_actions WHERE id=?').get(actionId)?.workspace_id??action?.workspace_id;
  if(!binding||action.status!=='acked'||workspaceId!==credential.workspaceId||action.payload.deviceId!==credential.deviceId||action.payload.employeeId!==binding.employeeId)fail('BOT_AUTONOMY_BINDING_CHANGED','原员工执行已结束或电脑归属已变化',403);
  const owner=repo.db?.prepare('SELECT owner_user_id FROM devices WHERE id=? AND workspace_id=?').get(credential.deviceId,credential.workspaceId)?.owner_user_id;
  const context={authenticatedMcp:true,deviceCredentialDeviceId:credential.deviceId,deviceScope:credential.deviceId,actorRole:'member',...(owner?{actorUserId:owner}:{})};
  const bot=bots.get(binding.workspace,binding.employeeId,context);
  if(bot.revision!==binding.revision||bot.control_epoch!==binding.controlEpoch||bot.control_state!=='active')fail('BOT_AUTONOMY_BINDING_CHANGED','配置或控制状态已变化，未执行旧请求');
  if(bot.employee&&(bot.employee.target_device_id!==credential.deviceId||bot.employee.runtime_profile!==action.payload.profile))fail('BOT_AUTONOMY_BINDING_CHANGED','员工电脑或Profile已变化');
  if(bot.config.permissions.mode!=='execute'||bot.config.permissions.management===false)fail('BOT_PERMISSION_CONFLICT','当前员工未授权自主配置与例行工作',403);
  const args=[binding.workspace,binding.employeeId],input=body.input??{};
  if(!object(input))fail('BOT_AUTONOMY_INPUT_INVALID','input须为对象',400);
  if(body.operation==='status')return{scheduler:'ziwei',permissions:bot.config.permissions,configuration:'defer_until_idle',nativeScheduler:'not_integrated',delegation:bot.config.collaboration?.enabled?'authorized_targets_only':'requires_authorization'};
  if(body.operation==='routines')return{scheduler:'ziwei',routines:bots.routines(...args,context)};
  if(!/^[A-Za-z0-9._:-]{1,100}$/.test(body.idempotencyKey||''))fail('IDEMPOTENCY_KEY_REQUIRED','需要稳定请求标识',400);
  // Namespacing isolates retries from unrelated user and employee requests.
  const idempotencyKey=`self:${actionId}:${body.idempotencyKey}`;
  if(body.operation==='configure'){
   if(!own(input,['toolsets','mcpServers','skills','memory']))fail('BOT_AUTONOMY_USER_GRANT_REQUIRED','扩大权限、服务商或资源授权需要本人确认',403);
   const config=structuredClone(bot.config);
   if(input.toolsets){if(!Array.isArray(input.toolsets)||input.toolsets.some(name=>!config.toolsets.includes(name)))fail('BOT_AUTONOMY_USER_GRANT_REQUIRED','新增工具需要本人确认',403);config.toolsets=[...input.toolsets];}
   if(input.mcpServers){
    if(!object(input.mcpServers))fail('BOT_AUTONOMY_INPUT_INVALID','MCP配置无效',400);
    for(const [name,patch] of Object.entries(input.mcpServers)){
     if(!config.mcpServers[name]||!own(patch,['enabled'])||patch.enabled!==false)fail('BOT_AUTONOMY_USER_GRANT_REQUIRED','新增或修改连接授权需要本人确认',403);
     config.mcpServers[name].enabled=false;
    }
   }
   if(input.skills){if(!own(input.skills,['disabled','autoLoad'])||input.skills.autoLoad?.some(name=>!config.skills.autoLoad?.includes(name))||input.skills.disabled&&config.skills.disabled.some(name=>!input.skills.disabled.includes(name)))fail('BOT_AUTONOMY_USER_GRANT_REQUIRED','新增或重新启用技能需要本人确认',403);config.skills={...config.skills,...input.skills};}
   if(input.memory)config.memory={...config.memory,...input.memory};
   return bots.update(...args,{config,expectedRevision:binding.revision,expectedControlEpoch:binding.controlEpoch,deferUntilIdle:true,idempotencyKey},context);
  }
  if(body.operation==='createRoutine'){
   if(!own(input,['name','prompt','nativeDriver','schedule','timezone']))fail('BOT_AUTONOMY_INPUT_INVALID','例行工作参数无效',400);
   return bots.createRoutine(...args,{...input,idempotencyKey},context);
  }
  if(body.operation==='pauseRoutine'){
   if(!/^[A-Za-z0-9_-]{1,160}$/.test(body.routineId||'')||Object.keys(input).length)fail('BOT_AUTONOMY_INPUT_INVALID','需要当前员工例行工作标识',400);
   // Repeated pauses are harmless; resuming a user-stopped routine is excluded.
   return bots.updateRoutine(...args,body.routineId,{status:'paused'},context);
  }
  fail('BOT_AUTONOMY_OPERATION_PENDING','该自主操作尚未接入，请使用已支持的紫薇接口',400);
 }};
}
