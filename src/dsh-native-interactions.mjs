export function createDshNativeInteractionManager(){
 const channels=new Map();
 return{
  attach(binding,channel){
   const key=binding.actionId,record={binding,channel};channels.set(key,record);
   return()=>{if(channels.get(key)===record)channels.delete(key);};
  },
  find(subject,scope){return[...channels.values()].find(({binding})=>binding.workspace===subject.workspace&&binding.deviceId===subject.deviceId&&binding.employeeId===subject.employeeId&&binding.profile===subject.profile&&binding.conversationId===scope.conversationId&&binding.nativeSessionId===scope.nativeSessionId)?.channel||null;},
  close(){channels.clear();},
 };
}

export async function executeDshNativeInteraction({operation,input={},subject,scope,rpc,manager}){
 const channel=manager?.find(subject,scope),projection=await rpc('session/projections',{request:{sessionId:scope.nativeSessionId}});
 const active=projection?.values?.userQuestions?.active||[],continued=active.filter(call=>call.state==='continued').map(call=>({interactionId:`continued:${call.callId}`,kind:'question',callId:call.callId,questions:call.questions,continued:true}));
 const live=(channel?.list()||[]).filter(item=>!continued.some(call=>call.callId===item.callId)),requests=[...live,...continued];
 if(operation==='list')return{status:'observed',data:{requests}};
 const pending=requests.find(item=>item.interactionId===input.interactionId);
 if(!pending)return{status:'failed',data:{requests},reasonCode:'DSH_INTERACTION_EXPIRED'};
 if(pending.continued){
  if(operation!=='answer')return{status:'failed',data:{requests},reasonCode:'DSH_INTERACTION_CONTINUED_REQUIRES_ANSWER'};
  const accepted=await rpc('userQuestions/answer',{agentId:scope.nativeSessionId,callId:pending.callId,answer:{answers:input.answers}});
  return{status:accepted?'applied':'unknown',data:{accepted:accepted===true,interactionId:pending.interactionId}};
 }
 if(operation==='approve'&&pending.kind!=='approval'||operation!=='approve'&&pending.kind!=='question')return{status:'failed',data:{},reasonCode:'DSH_INTERACTION_KIND_MISMATCH'};
 const accepted=await channel.answer({interactionId:pending.interactionId,decision:input.decision,answers:input.answers,dismiss:operation==='dismiss'});
 return{status:'applied',data:{...accepted,interactionId:pending.interactionId}};
}
