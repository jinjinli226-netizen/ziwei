import {botMainChatView} from './bot-main-chat.js';

export function employeeConversationView({page,workspace,actorId,employeeId,employee,conversation,routeEmployeeId='',routeConversationId='',intent,bot,bindingPending=false,bindingResolved=false,bindingError='',loading=false}={}) {
  const shell=page==='inbox'&&Boolean(routeConversationId||routeEmployeeId)&&employeeId!=='unassigned'&&(!conversation||Boolean(conversation.employee_id));
  const view={shell,ready:false,pending:false,error:''};
  if(!shell)return view;
  if(!actorId)return{...view,error:'请先登录当前工作区。'};
  if(bindingError)return{...view,error:bindingError};
  if(intent&&intent.workspace!==workspace)return{...view,error:'聊天入口不属于当前工作区，请重新选择员工。'};
  if(loading||bindingPending||(!bindingResolved&&conversation))return{...view,pending:true};
  if(!conversation)return view;
  if(conversation.id!==routeConversationId||conversation.employee_id!==employeeId||employee?.id!==employeeId||conversation.workspace&&conversation.workspace!==workspace)return{...view,error:'聊天与当前员工不一致，请重新选择员工。'};
  if(bot&&(bot.workspace!==workspace||bot.id!==employeeId))return{...view,error:'员工运行绑定尚未确认，请重新打开聊天。'};
  if((intent||bot)&&!botMainChatView({page,workspace,intent,bot,conversation,routeConversationId}).ready)return{...view,error:'此入口不是已确认的主聊天，请从员工名册重新打开。'};
  return{...view,ready:true};
}
