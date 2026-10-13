export function botMainChatView({page,workspace,intent,bot,conversation,routeConversationId='',loading=false}={}){
  if(page!=='inbox')return{shell:false,ready:false,pending:false};
  const scopedIntent=intent&&intent.workspace===workspace;
  if(intent&&!scopedIntent)return{shell:false,ready:false,pending:false};
  const validBot=bot&&bot.workspace===workspace&&bot.id===(bot.employee_id||bot.employee?.id)&&bot.configuration_state!=='uninitialized';
  if(scopedIntent&&bot&&(!validBot||bot.id!==intent.botId||bot.main_conversation_id!==intent.conversationId))return{shell:false,ready:false,pending:false};
  const ready=Boolean(validBot&&routeConversationId===bot.main_conversation_id&&conversation?.id===bot.main_conversation_id&&conversation.employee_id===bot.id&&(!conversation.workspace||conversation.workspace===workspace)&&(!scopedIntent||conversation.id===intent.conversationId));
  const pending=Boolean(!ready&&scopedIntent&&intent.pending&&loading);
  return{shell:ready||pending,ready,pending};
}
export function chatLocalTime(value){const date=new Date(value);if(!value||Number.isNaN(date.getTime()))return'';return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}).format(date);}
export function botWorkTasks(tasks,employeeId){return employeeId?(tasks||[]).filter(row=>[row.employee_id,row.employeeId,row.assignee,row.execution?.payload?.employeeId].includes(employeeId)):[];}
export function conversationFiles(messages){return(messages||[]).flatMap(message=>(message.attachments||[]).map((attachment,index)=>({...attachment,key:message.id+':'+index,messageRole:message.role})));}
