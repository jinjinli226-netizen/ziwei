import {MAX_CONVERSATION_IMAGE_BYTES,validateImageBytes} from './conversation-image-artifacts.mjs';

export async function executeDshNativeSessionOperation({resource,operation,input={},scope,rpc,followSnapshot}={}){
  const supported=['sessions.list','sessions.history','sessions.projections','presets.select','plan.capabilities','plan.set','models.selectSession'];
  if(!supported.includes(`${resource}.${operation}`))return result('failed',{},'DSH_NATIVE_OPERATION_UNSUPPORTED');
  const listing=resource==='sessions'&&operation==='list';
  const history=resource==='sessions'&&operation==='history';
  if(listing?(scope?.kind!=='bot'||typeof rpc!=='function'):(history?(scope?.kind==='conversation'&&!scope.conversationId||scope.kind==='conversation'&&!scope.nativeSessionId||scope?.kind==='bot'&&!input.sessionId||typeof rpc!=='function'):(scope?.kind!=='conversation'||!scope.conversationId||!scope.nativeSessionId||typeof rpc!=='function')))return result('failed',{},listing?'DSH_NATIVE_BOT_SCOPE_REQUIRED':history?'DSH_NATIVE_SESSION_SCOPE_REQUIRED':'DSH_NATIVE_CONVERSATION_SCOPE_REQUIRED');
  const sessionId=scope.kind==='bot'?input.sessionId:scope.nativeSessionId,data={};let mutationSent=false;
  const mutate=(method,args)=>{mutationSent=true;return rpc(method,args);};
  try{
    if(listing){
      const roster=await rpc('session/list',{_request:{}});
      if(!Array.isArray(roster?.items))return result('unknown',data,'DSH_NATIVE_SESSION_LIST_UNAVAILABLE');
      const keys=['sessionId','createdAt','updatedAt','running','blank','agentAvailable','title','cwd','origin','formatStatus','depth'];
      data.items=roster.items.filter(item=>item.origin!=='subagent'&&!item.parentSessionId).map(item=>({
        ...Object.fromEntries(keys.filter(key=>Object.hasOwn(item,key)).map(key=>[key,item[key]])),
        ...(item.projections?{projections:projectProjections(item.projections)}:{}),
      })).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
      return result('observed',data);
    }
    if(resource==='sessions'&&operation==='history'){
      if(typeof followSnapshot!=='function')return result('unknown',data,'DSH_NATIVE_SESSION_HISTORY_UNAVAILABLE');
      const snapshot=await followSnapshot({request:{address:{kind:'session',sessionId},assistantStream:true,maxMessages:input.maxMessages??100}});
      if(snapshot?.type!=='snapshot'||!Array.isArray(snapshot.records))return result('unknown',data,'DSH_NATIVE_SESSION_HISTORY_UNAVAILABLE');
      data.snapshot={type:'snapshot',records:structuredClone(snapshot.records),hasMore:snapshot.hasMore===true,projections:projectProjections(snapshot.projections),...(snapshot.assistantStream?{assistantStream:snapshot.assistantStream}:{})};
      try{await materializeHistoryImages(data.snapshot,sessionId,rpc);}catch{return result('unknown',data,'DSH_NATIVE_SESSION_ATTACHMENTS_UNAVAILABLE');}
      return result('observed',data);
    }
    if(resource==='sessions'){
      data.projections=await readProjections(rpc,sessionId);
      return data.projections?result('observed',data):result('unknown',data,'DSH_NATIVE_SESSION_PROJECTIONS_UNAVAILABLE');
    }
    if(resource==='presets'){
      data.projections=await readProjections(rpc,sessionId);
      const blank=data.projections?.values.sessionListMetadata?.blank;
      if(typeof blank!=='boolean')return result('unknown',data,'DSH_NATIVE_SESSION_BLANKNESS_UNAVAILABLE');
      if(!blank)return result('failed',data,'DSH_PRESET_REQUIRES_NEW_CONVERSATION');
      if(data.projections.values.agentPreset===input.agentPreset)return result('observed',data);
      data.selected=await mutate('agentPresets/select',{agentId:sessionId,agentPreset:input.agentPreset});
      data.projections=await readProjections(rpc,sessionId);
      return data.selected===input.agentPreset&&data.projections?.values.agentPreset===input.agentPreset
        ?result('applied',data):result('unknown',data,'DSH_NATIVE_PRESET_NOT_CONFIRMED');
    }
    if(resource==='plan'){
      if(operation==='capabilities'){
        data.commands=await rpc('commands/list',{agentId:sessionId});
        data.projections=await readProjections(rpc,sessionId);
        data.available=planAvailable(data.commands);data.effectiveActive=effectivePlan(data.projections);
        return Array.isArray(data.commands)&&data.projections?result('observed',data):result('unknown',data,'DSH_NATIVE_PLAN_CAPABILITIES_UNAVAILABLE');
      }
      data.projections=await readProjections(rpc,sessionId);data.effectiveActive=effectivePlan(data.projections);
      if(data.effectiveActive===null)return result('unknown',data,'DSH_NATIVE_PLAN_STATE_UNAVAILABLE');
      if(data.effectiveActive===input.active)return result('observed',data);
      data.commands=await rpc('commands/list',{agentId:sessionId});data.available=planAvailable(data.commands);
      if(!Array.isArray(data.commands))return result('unknown',data,'DSH_NATIVE_PLAN_CAPABILITIES_UNAVAILABLE');
      if(!data.available)return result('failed',data,'DSH_NATIVE_PLAN_UNAVAILABLE');
      data.command=await mutate('commands/execute',{agentId:sessionId,line:input.active?'/plan':'/plan off',submittedAttachments:[]});
      if(data.command?.result?.kind==='error')return result('failed',data,'DSH_NATIVE_PLAN_REJECTED');
      if(data.command?.result?.kind!=='success')return result('unknown',data,'DSH_NATIVE_PLAN_NOT_CONFIRMED');
      data.projections=await readProjections(rpc,sessionId);data.effectiveActive=effectivePlan(data.projections);
      return data.effectiveActive===input.active?result('applied',data):result('unknown',data,'DSH_NATIVE_PLAN_NOT_CONFIRMED');
    }
    const selection=modelSelection(input);
    const selected=await mutate('session/selectModel',{request:{sessionId,...selection}});
    data.selected=modelSelection(selected?.selected);
    const [catalog,projection]=await Promise.allSettled([rpc('session/modelCatalog',{}),readProjections(rpc,sessionId)]);
    data.catalogDefault=catalog.status==='fulfilled'?modelSelection(catalog.value?.default):null;
    data.projections=projection.status==='fulfilled'?projection.value:null;
    data.layers={selected:selectionState(selection,data.selected),next:selectionState(selection,data.projections?.values.modelSelection?.next),default:selectionState(selection,data.catalogDefault)};
    return Object.values(data.layers).every(value=>value==='confirmed')?result('applied',data):result('unknown',data,'DSH_NATIVE_MODEL_NOT_FULLY_CONFIRMED');
  }catch{
    return result(mutationSent?'unknown':'failed',data,mutationSent?'DSH_NATIVE_SESSION_MUTATION_OUTCOME_UNKNOWN':'DSH_NATIVE_SESSION_READ_FAILED');
  }
}

const result=(status,data,reasonCode)=>({status,data,...(reasonCode?{reasonCode}:{})});
async function materializeHistoryImages(snapshot,sessionId,rpc){
  const events=snapshot.records.map(record=>record?.event||record),start=events.findLastIndex(event=>event?.type==='turn/start'),tail=events.slice(Math.max(0,start));
  const end=tail.findLast(event=>event?.type==='turn/end'),turn=events[start]?.data?.turn??end?.data?.turn;
  if(!end||end.data?.turn!==turn||!['completed','aborted','blocked','error','max-tokens','interrupted','forked','failed'].includes(end.data?.reason?.kind))return;
  const seen=new Set();let count=0,total=0;
  for(const event of tail){
    if(!['assistant/message','tool/result'].includes(event?.type)||event.data?.turn!==turn||event.surfaceOp&&event.surfaceOp!=='append')continue;
    const blocks=event.data?.message?.content||event.data?.content;
    if(!Array.isArray(blocks))continue;
    for(const block of blocks){
      if(block?.type!=='image'||!block.attachment)continue;
      const ref=block.attachment;
      if(typeof ref.attachmentId!=='string'||!ref.attachmentId||!Number.isSafeInteger(ref.bytes)||ref.bytes<=0)throw Error('Invalid native image reference');
      if(seen.has(ref.attachmentId))continue;
      seen.add(ref.attachmentId);
      if(count>=20||total+ref.bytes>MAX_CONVERSATION_IMAGE_BYTES)continue;
      const value=await rpc('session/attachment',{request:{sessionId,attachmentId:ref.attachmentId}}),image=decodeHistoryAttachment(value,ref);
      count++;total+=ref.bytes;
      // Inline each durable image once; repeated refs otherwise multiply upload bytes.
      Object.assign(block,image);
    }
  }
}
function decodeHistoryAttachment(value,ref){
  if(value?.attachment?.attachmentId!==ref.attachmentId||value.attachment.mediaType!==ref.mediaType||value.attachment.bytes!==ref.bytes||typeof value.data!=='string'||value.data.length>Math.ceil(MAX_CONVERSATION_IMAGE_BYTES/3)*4)throw Error('Invalid native image response');
  const bytes=Buffer.from(value.data,'base64');
  if(bytes.length!==ref.bytes||bytes.toString('base64')!==value.data)throw Error('Invalid native image bytes');
  return{data:value.data,mediaType:validateImageBytes(bytes,ref.mediaType)};
}
async function readProjections(rpc,sessionId){
  return projectProjections(await rpc('session/projections',{request:{sessionId}}));
}
function projectProjections(projection){
  if(!projection?.values||typeof projection.values!=='object'||Array.isArray(projection.values))return null;
  const keys=['agentPreset','plan','userQuestions','modelSelection','sessionListMetadata','workingDirectory','title'];
  return{...Object.fromEntries(['kind','asOfSeq'].filter(key=>Object.hasOwn(projection,key)).map(key=>[key,projection[key]])),values:Object.fromEntries(keys.filter(key=>Object.hasOwn(projection.values,key)).map(key=>[key,projection.values[key]]))};
}
function effectivePlan(projection){
  const plan=projection?.values.plan;
  return typeof plan?.active==='boolean'&&typeof plan.pending==='boolean'?(plan.pending?!plan.active:plan.active):null;
}
function planAvailable(commands){return Array.isArray(commands)&&commands.some(command=>command.name==='plan');}
function modelSelection(value){
  if(!value||typeof value.provider!=='string'||typeof value.model!=='string')return null;
  return{provider:value.provider,model:value.model,...(typeof value.reasoningEffort==='string'?{reasoningEffort:value.reasoningEffort}:{})};
}
function selectionState(expected,value){
  const actual=modelSelection(value);
  if(!actual)return 'unknown';
  return actual.provider===expected.provider&&actual.model===expected.model&&actual.reasoningEffort===expected.reasoningEffort?'confirmed':'unconfirmed';
}
