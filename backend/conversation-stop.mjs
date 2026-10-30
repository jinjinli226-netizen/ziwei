import {employeeCapabilitySubject,assertEmployeeCapabilityAuthority} from './employee-capability-inventory.mjs';
import {dshBotNameForAction} from '../src/dsh-session-evidence.mjs';

const fail=(code,status=409)=>{throw Object.assign(new Error(code),{code,status});};

export function createConversationStop(repo){
 return function stop(conversationId,input,context={}){
  if(!input||Object.keys(input).some(key=>key!=='expectedActionId')||typeof input.expectedActionId!=='string'||!input.expectedActionId||input.expectedActionId.length>200)fail('CONVERSATION_STOP_INPUT_INVALID',400);
  const conversation=repo.getConversationAccess(conversationId,context);
  if(!conversation?.employee_id)fail('CONVERSATION_NOT_FOUND',404);
  const subject=employeeCapabilitySubject(repo.db,conversation.workspace_id,conversation.employee_id);
  assertEmployeeCapabilityAuthority(repo.db,conversation.workspace_id,subject,{userId:context.actorUserId||null,role:context.actorRole||'owner',deviceScope:context.deviceScope||null});
  const source=repo.getA2AAction(input.expectedActionId,{workspaceSlug:subject.workspace}),payload=source?.payload;
  if(!source||source.type!=='conversation.execute'||payload?.conversationId!==conversationId||payload.employeeId!==subject.employeeId)fail('CONVERSATION_STOP_ACTION_MISMATCH');
  if(subject.runtime!=='DSH'||payload.runtime!=='DSH'||payload.deviceId!==subject.deviceId||dshBotNameForAction(source)!==subject.profile)fail('CONVERSATION_STOP_BINDING_CHANGED');
  if(source.status!=='acked')fail('CONVERSATION_STOP_NOT_RUNNING');
  // Cancelling controls the original dispatcher action; the source turn/end,
  // rather than this control action's receipt, proves that generation stopped.
  const action=repo.createA2AAction(subject.workspace,{type:'action.cancel',dedupeKey:`conversation-stop:${source.id}`,payload:{actionId:source.id,deviceId:subject.deviceId}});
  return{sourceActionId:source.id,stopRequested:true,stopConfirmed:false,action:{id:action.id,status:action.status}};
 };
}
