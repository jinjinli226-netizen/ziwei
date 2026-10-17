// Explicit mobile read projection only. Stored/native/MCP receipts keep their
// full logs, planner input and all execution/exit evidence.
const object=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
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

  function project(slug,action,context={}){
    const ws=workspace.get(slug),actor=context.actorUserId;
    if(!id(actor))failure('GROUP_MOBILE_USER_REQUIRED','请先登录紫薇',401);
    const membership=ws?member.get(ws.id,actor):null;
    if(!membership||!['owner','admin','member'].includes(membership.role))failure('GROUP_MOBILE_FORBIDDEN','当前用户无权访问该工作区',403);
    if(!id(action?.id)||original.get(action.id)?.workspace_id!==ws.id)failure('ACTION_NOT_FOUND','执行请求不存在于当前工作区',404);
    const request=action.payload?.nativeOperation;
    const groupRequest=action.type==='hermes.bot.native'&&object(request)&&(
      request.resource==='groups'||request.resource==='collaboration'&&(request.operation==='publish'||request.input?.mode==='group'));
    if(!groupRequest)return action;
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
    if(input.targets!==undefined){
      if(!Array.isArray(input.targets)||input.targets.length>128)failure();
      for(const target of input.targets)visible(target?.id);
    }
    const listing=request.resource==='groups'&&request.operation==='list';
    if(request.resource==='groups'&&!['list','read','step'].includes(request.operation)||request.resource==='collaboration'&&!['message','publish'].includes(request.operation))failure();
    if(!listing&&!id(input.groupId))failure();
    const paged=request.resource==='groups'&&request.operation==='read'&&Object.hasOwn(input,'limit');
    if(paged&&(!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>100||!integer(input.afterSeq??0))||Object.hasOwn(input,'afterSeq')&&!paged)failure();
    function roomScope(room,expected=input.groupId){
      if(!object(room)||!id(room.room_id)||expected&&room.room_id!==expected||!Array.isArray(room.members)||room.members.length<1||room.members.length>128)failure();
      const ids=new Set();
      for(const item of room.members){if(ids.has(item?.member_id))failure();visible(item?.member_id);ids.add(item.member_id);}
      if(!ids.has(source))denied();
    }
    function logShape(log,room,{after=0,limit=50100,complete=false}={}){
      if(!object(log)||!Array.isArray(log.events)||log.events.length>limit||!integer(log.cursor)||!integer(log.latest_seq)||typeof log.has_more!=='boolean'||log.cursor<after||log.latest_seq<log.cursor)failure();
      let previous=after;const ids=new Set();
      for(const event of log.events){
        if(!object(event)||event.room_id!==room.room_id||!integer(event.seq)||event.seq!==previous+1||!id(event.event_id)||ids.has(event.event_id))failure();
        previous=event.seq;ids.add(event.event_id);
      }
      if(log.cursor!==previous||log.has_more!==(log.cursor<log.latest_seq)||log.has_more&&log.cursor===after||complete&&log.has_more)failure();
      if(!object(log.authority)||!id(log.authority.gateway_id)||!integer(log.authority.epoch)||log.authority.epoch<1||log.authority.gateway_id!==room.authority_gateway_id||log.authority.epoch!==room.authority_epoch)failure();
    }
    let receipts=0;
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
      if(paged&&(receipt.status==='succeeded'||data.events!==undefined)&&data.pagedRead!==true)failure('GROUP_HOST_UPGRADE_REQUIRED','目标电脑暂不支持手机分页群记录，请先更新电脑端');
      if(data.room)roomScope(data.room);
      else if(receipt.status==='succeeded'||data.events!==undefined)failure();
      if(data.events===undefined){if(receipt.status==='succeeded')failure();return receipt;}
      if(paged){
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
      const {events:_history,...rest}=data;
      // Only the known full history array moves out of the mobile response.
      // decision/plan and unknown fields are preserved, including their bounded
      // native prompt. They are not replaced with a plan over a partial log.
      return {...receipt,data:{...rest,historyPointer:{...metadata,room_id:input.groupId,omitted:true,eventCount:records.length}}};
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
    return result===action.result&&events===action.events?action:{...action,result,...(events!==action.events?{events}:{})};
  }
  return {project};
}
