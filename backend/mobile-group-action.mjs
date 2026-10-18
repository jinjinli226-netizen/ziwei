// Group read authorization and explicit mobile projection. Stored/native/MCP
// receipts keep their full logs, planner input and all execution/exit evidence.
const object=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
// Native hosted_rooms validates a canonical identifier up to 128 characters.
// API idempotency keys have a different, wider alphabet/length contract.
const eventId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const failure=(code='GROUP_MOBILE_RECEIPT_INVALID',message='群组原生回执无法核对，请保留原请求并刷新查看',status=409)=>{throw Object.assign(new Error(message),{code,status});};
const denied=()=>failure('GROUP_MOBILE_SCOPE_REQUIRED','该群包含未绑定当前工作区可见员工的成员，请核对原群组',404);

export function createMobileGroupActionView(repo){
  const db=repo.db;
  const workspace=db.prepare('SELECT id,kind FROM workspaces WHERE slug=?');
  const member=db.prepare('SELECT role FROM members WHERE workspace_id=? AND user_id=?');
  const original=db.prepare('SELECT workspace_id FROM a2a_actions WHERE id=?');
  const employee=db.prepare('SELECT status,visibility,owner_user_id,target_device_id FROM employees WHERE id=? AND workspace_id=?');
  const device=db.prepare('SELECT owner_user_id FROM devices WHERE id=? AND workspace_id=?');

  function knownGroupReceipt(value){
    const seen=new Set();
    while(object(value)&&!seen.has(value)){
      seen.add(value);const receipt=value.nativeOperation;
      if(object(receipt)&&(receipt.resource==='groups'||receipt.resource==='collaboration'&&object(receipt.data?.room)))return true;
      value=value.result;
    }
    return false;
  }
  function project(slug,action,context={},options={}){
    const ws=workspace.get(slug),actor=context.actorUserId;
    if(!id(actor))failure('GROUP_MOBILE_USER_REQUIRED','请先登录紫薇',401);
    const membership=ws?member.get(ws.id,actor):null;
    if(!membership||!['owner','admin','member'].includes(membership.role))failure('GROUP_MOBILE_FORBIDDEN','当前用户无权访问该工作区',403);
    if(!id(action?.id)||original.get(action.id)?.workspace_id!==ws.id)failure('ACTION_NOT_FOUND','执行请求不存在于当前工作区',404);
    const request=action.payload?.nativeOperation;
    const groupRequest=(action.type==='hermes.bot.native'||options.auxiliary&&['task.execute','conversation.execute'].includes(action.type))&&object(request)&&(
      request.resource==='groups'||request.resource==='collaboration'&&(request.operation==='publish'||request.input?.mode==='group'));
    if(!groupRequest){
      // An auxiliary execution can expose a native receipt without being a
      // hermes.bot.native action. A known group receipt still needs its actual
      // original request; a recent chat or cached resource cannot supply it.
      if(options.auxiliary&&(knownGroupReceipt(action.result)||action.events?.some(event=>knownGroupReceipt(event?.data?.result))))failure();
      return action;
    }
    const binding=action.payload?.hermesBot,source=action.payload?.employeeId,input=request.input;
    if(request.schemaVersion!==2||!object(input)||!id(source)||binding?.employeeId!==source||binding?.workspace!==slug||!integer(binding.revision)||binding.revision<1)failure();
    const privileged=['owner','admin'].includes(membership.role);
    if(!privileged&&action.payload?.userId&&action.payload.userId!==actor)denied();
    function visible(employeeId){
      if(!id(employeeId))denied();
      const value=employee.get(employeeId,ws.id);
      if(!value||value.status==='deleted'||value.visibility==='personal'&&!privileged&&value.owner_user_id!==actor)denied();
      if(value.target_device_id){
        const computer=device.get(value.target_device_id,ws.id);
        if(!computer||context.deviceScope&&context.deviceScope!==value.target_device_id||ws.kind==='personal'&&!privileged&&computer.owner_user_id!==actor)denied();
      }
    }
    visible(source);
    if(action.payload.deviceId){
      const computer=device.get(action.payload.deviceId,ws.id);
      if(!computer||context.deviceScope&&context.deviceScope!==action.payload.deviceId||ws.kind==='personal'&&!privileged&&computer.owner_user_id!==actor)denied();
    }
    if(input.targets!==undefined){
      if(!Array.isArray(input.targets)||input.targets.length>128)failure();
      for(const target of input.targets){
        visible(target?.id);
        if(Object.hasOwn(target,'profile')&&target.profile!==target.id||Object.hasOwn(target,'kind')&&target.kind!=='local')failure();
      }
    }
    const listing=request.resource==='groups'&&request.operation==='list';
    if(request.resource==='groups'&&!['list','read','step'].includes(request.operation)||request.resource==='collaboration'&&!['message','publish'].includes(request.operation))failure();
    if(!listing&&!id(input.groupId))failure();
    const paged=request.resource==='groups'&&request.operation==='read'&&Object.hasOwn(input,'limit');
    if(paged&&(!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>100||!integer(input.afterSeq??0))||Object.hasOwn(input,'afterSeq')&&!paged)failure();
    function roomScope(room,expected=input.groupId){
      if(!object(room)||!id(room.room_id)||expected&&room.room_id!==expected||!Array.isArray(room.members)||room.members.length<1||room.members.length>128)failure();
      const ids=new Set();
      for(const item of room.members){
        if(ids.has(item?.member_id))failure();visible(item?.member_id);
        // Ziwei's bridge addresses logical employees inside its isolated HOME;
        // the physical runtime_profile is never the native group identity.
        if(item.profile!==item.member_id||item.handle!==undefined&&item.handle!==item.member_id)failure();
        if(item.target!==undefined&&(!object(item.target)||item.target.kind!=='local'||item.target.profile!==item.member_id||Object.keys(item.target).some(key=>!['kind','profile'].includes(key))))failure();
        ids.add(item.member_id);
      }
      if(!ids.has(source))denied();
    }
    function logShape(log,room,{after=0,limit=50100,complete=false}={}){
      if(!object(log)||!Array.isArray(log.events)||log.events.length>limit||!integer(log.cursor)||!integer(log.latest_seq)||typeof log.has_more!=='boolean'||log.cursor<after||log.latest_seq<log.cursor)failure();
      let previous=after;const ids=new Set();
      for(const event of log.events){
        if(!object(event)||event.room_id!==room.room_id||!integer(event.seq)||event.seq!==previous+1||!eventId(event.event_id)||ids.has(event.event_id))failure();
        previous=event.seq;ids.add(event.event_id);
      }
      if(log.cursor!==previous||log.has_more!==(log.cursor<log.latest_seq)||log.has_more&&log.cursor===after||complete&&log.has_more)failure();
      if(!object(log.authority)||!id(log.authority.gateway_id)||!integer(log.authority.epoch)||log.authority.epoch<1||log.authority.gateway_id!==room.authority_gateway_id||log.authority.epoch!==room.authority_epoch)failure();
    }
    let receipts=0,upgradeRequired=false;
    const upgradeError={code:'GROUP_HOST_UPGRADE_REQUIRED',message:'目标电脑暂不支持手机分页群记录，请先更新电脑端'};
    function receiptView(receipt){
      receipts++;
      const compatible=receipt?.resource===request.resource&&receipt?.operation===request.operation
        ||request.resource==='groups'&&request.operation==='step'&&(receipt?.resource==='groups'&&receipt?.operation==='read'||receipt?.resource==='collaboration'&&receipt?.operation==='publish')
        ||request.resource==='collaboration'&&request.operation==='message'&&receipt?.resource==='collaboration'&&receipt?.operation==='publish';
      if(!object(receipt)||receipt.schemaVersion!==2||receipt.employeeId!==source||receipt.revision!==binding.revision||!compatible)failure();
      const data=receipt.data;
      if(listing){
        if(receipt.status==='succeeded'&&(!object(data)||!Array.isArray(data.items)||data.items.length>500))failure();
        if(data?.items!==undefined&&(!Array.isArray(data.items)||data.items.length>500))failure();
        for(const room of data?.items||[])roomScope(room,null);
        return receipt;
      }
      if(!object(data)){
        if(receipt.status==='succeeded')failure();
        return receipt;
      }
      const oldHost=paged&&(receipt.status==='succeeded'||data.events!==undefined)&&data.pagedRead!==true;
      if(data.room)roomScope(data.room);
      else if(receipt.status==='succeeded'||data.events!==undefined)failure();
      // Notification previews carry a bounded room/receipt projection, never
      // full native history. Authorize its original roster without treating
      // that projection as a validated log, execution proof or mobile page.
      if(options.notificationScope)return receipt;
      if(oldHost&&!options.auxiliary)failure(upgradeError.code,upgradeError.message);
      if(data.events===undefined){if(receipt.status==='succeeded')failure();return receipt;}
      if(paged&&!oldHost){
        const pagination=data.pagination,after=input.afterSeq??0;
        if(!object(pagination)||pagination.limit!==input.limit||pagination.afterSeq!==after||!integer(pagination.nextAfterSeq)||typeof pagination.hasMore!=='boolean'||data.decision!=null||data.plan!=null)failure();
        logShape(data.events,data.room,{after,limit:input.limit});
        if(pagination.nextAfterSeq!==data.events.cursor||pagination.hasMore!==data.events.has_more||Buffer.byteLength(JSON.stringify(data.events))>2*1024*1024)failure();
        return receipt;
      }
      logShape(data.events,data.room,{complete:true});
      if(Object.hasOwn(data,'historyPointer'))failure();
      const {events:records,...metadata}=data.events;
      if(Object.hasOwn(metadata,'omitted')||Object.hasOwn(metadata,'eventCount')||metadata.room_id!==undefined&&metadata.room_id!==input.groupId)failure();
      if(options.validateOnly)return receipt;
      if(oldHost){if(Object.hasOwn(receipt,'mobileReadError')||Object.hasOwn(action,'mobileReadError'))failure();upgradeRequired=true;}
      const {events:_history,...rest}=data;
      // Only the known full history array moves out of the mobile response.
      // decision/plan and unknown fields are preserved, including their bounded
      // native prompt. They are not replaced with a plan over a partial log.
      return {...receipt,...(oldHost?{mobileReadError:upgradeError}:{}),data:{...rest,historyPointer:{...metadata,room_id:input.groupId,omitted:true,eventCount:records.length}}};
    }
    function resultView(value,depth=0){
      if(!object(value))return value;
      if(depth>8)failure();
      const native=Object.hasOwn(value,'nativeOperation')?receiptView(value.nativeOperation):undefined;
      const nested=resultView(value.result,depth+1);
      return native===value.nativeOperation&&nested===value.result?value:{...value,...(native!==value.nativeOperation?{nativeOperation:native}:{}),...(nested!==value.result?{result:nested}:{})};
    }
    const result=resultView(action.result),mainReceipts=receipts,events=Array.isArray(action.events)?action.events.map(event=>{
      const result=resultView(event?.data?.result);
      return result===event?.data?.result?event:{...event,data:{...event.data,result}};
    }):action.events;
    if(action.status==='succeeded'&&mainReceipts===0)failure();
    if(options.validateOnly)return action;
    return result===action.result&&events===action.events&&!upgradeRequired?action:{...action,result,...(events!==action.events?{events}:{}),...(upgradeRequired?{mobileReadError:upgradeError}:{})};
  }
  const readError=error=>({code:error.code,message:error.message});
  const expectedError=error=>/^GROUP_MOBILE_|^GROUP_HOST_|^ACTION_NOT_FOUND$/.test(error?.code||'');
  function run(slug,action,context){
    if(!action)return action;
    const request=action.payload?.nativeOperation;
    const groupRequest=object(request)&&(request.resource==='groups'||request.resource==='collaboration'&&(request.operation==='publish'||request.input?.mode==='group'));
    return groupRequest||knownGroupReceipt(action.result)||action.events?.some(event=>knownGroupReceipt(event?.data?.result))?project(slug,action,context,{auxiliary:true}):action;
  }
  function nativeReceipt(result,depth=0){
    if(!object(result)||depth>8)return null;
    return result.nativeOperation||nativeReceipt(result.result,depth+1);
  }
  function bot(slug,value,context,{partial=false}={}){
    try {
      const latest=run(slug,value.latest_run,context),stop=run(slug,value.stop_action,context),active=run(slug,value.active_run,context);
      const nativeResources={...value.nativeResources};
      for(const key of ['groups','collaboration']){
        const cached=value.nativeResources?.[key];if(!cached)continue;
        try {
          if(!id(cached.actionId))failure();
          // Cached nativeResources are derived summaries, not authority. Read
          // the original bound action before examining its room or receipt.
          const ws=workspace.get(slug);
          if(!ws||original.get(cached.actionId)?.workspace_id!==ws.id)failure('ACTION_NOT_FOUND','执行请求不存在于当前工作区',404);
          const stored=repo.getA2AAction(cached.actionId,{workspaceSlug:slug,eventView:'none'}),binding=stored?.payload?.hermesBot;
          if(!stored||stored.payload?.employeeId!==value.id||binding?.employeeId!==value.id||binding.workspace!==slug||binding.revision!==value.revision)failure();
          const projected=run(slug,stored,context),receipt=nativeReceipt(projected.result);
          if(!object(receipt)||receipt.resource!==key||receipt.employeeId!==value.id||receipt.revision!==value.revision)failure();
          nativeResources[key]={...receipt,actionId:stored.id,actionStatus:stored.status,completedAt:stored.completed_at};
        } catch(error) {
          if(!expectedError(error))throw error;
          nativeResources[key]={...(id(cached.actionId)?{actionId:cached.actionId}:{}),resourceState:'unavailable',readError:readError(error)};
        }
      }
      return {...value,...(latest!==value.latest_run?{latest_run:latest}:{}),...(stop!==value.stop_action?{stop_action:stop}:{}),...(active!==value.active_run?{active_run:active}:{}),...(value.nativeResources?{nativeResources}:{})};
    } catch(error) {
      if(!partial||!expectedError(error))throw error;
      // A list remains useful when one employee's group is no longer visible.
      // This is read availability metadata, with no invented execution state.
      return {id:value.id,employee_id:value.employee_id,workspace:value.workspace,employee:value.employee,resourceState:'unavailable',readError:readError(error)};
    }
  }
  function conversation(value,context){
    if(!value?.execution)return value;
    const slug=db.prepare('SELECT slug FROM workspaces WHERE id=?').get(value.workspace_id)?.slug;
    const execution=run(slug,value.execution,context);
    return execution===value.execution?value:{...value,execution};
  }
  // The new first-party action route accepts a full response too, but choosing
  // its presentation must never bypass the same group membership checks.
  const validate=(slug,action,context)=>project(slug,action,context,{auxiliary:true,validateOnly:true});
  return {project,validate,run,bot,conversation};
}
