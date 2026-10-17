const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=value=>typeof value==='string';
const nonempty=value=>text(value)&&value.trim().length>0;
const optionalText=value=>value==null||text(value);
const roles=new Set(['user','assistant','system','tool']);

/** Unknown records stay in the caller's ordinary content/attachment renderer. */
export function isConversationForward(value){
  if(!object(value)||value.schemaVersion!==1||!nonempty(value.id)||!['reference','execute'].includes(value.mode)||!optionalText(value.note))return false;
  const source=value.source;
  if(!object(source)||!nonempty(source.conversationId)||!optionalText(source.employeeId)||!optionalText(source.employeeName))return false;
  if(!Array.isArray(value.messages)||value.messages.length<1||value.messages.length>20)return false;
  return value.messages.every(message=>object(message)&&nonempty(message.sourceMessageId)&&roles.has(message.role)&&optionalText(message.senderName)&&optionalText(message.createdAt)&&text(message.content)&&(message.attachments===undefined||Array.isArray(message.attachments)&&message.attachments.every(attachment=>object(attachment)&&optionalText(attachment.name))));
}

export function forwardMessageTime(value){
  if(!nonempty(value))return '';
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))return '';
  return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date);
}

export function conversationForwardMessages(value){
  if(!isConversationForward(value))return [];
  const sourceName=value.source.employeeName?.trim()||'数字员工';
  return value.messages.map((message,index)=>({
    key:`${message.sourceMessageId}:${index}`,
    senderName:message.senderName?.trim()||({user:'用户',assistant:sourceName,system:'系统',tool:'工具'})[message.role],
    content:message.content,
    createdAt:forwardMessageTime(message.createdAt)?message.createdAt:'',
    time:forwardMessageTime(message.createdAt),
    attachments:message.attachments||[],
  }));
}

export function conversationForwardSummary(value){
  if(!isConversationForward(value))return {sourceName:'',count:0,lines:[]};
  const rows=conversationForwardMessages(value);
  return {sourceName:value.source.employeeName?.trim()||'数字员工',count:rows.length,lines:rows.slice(0,2).map(message=>{
    const compact=message.content.replace(/\s+/g,' ').trim();
    const characters=Array.from(compact);
    return {senderName:message.senderName,text:characters.length>70?characters.slice(0,70).join('')+'…':compact||(message.attachments.length?`[图片 × ${message.attachments.length}]`:'[空消息]')};
  })};
}
