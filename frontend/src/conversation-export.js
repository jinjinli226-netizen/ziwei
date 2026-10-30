import {conversationForwardMessages} from './conversation-forward-card.mjs';

const line=value=>String(value??'').replace(/[\r\n]+/g,' ');
const text=value=>line(value).replace(/[\\`*_[\]<>]/g,'\\$&');

export function loadedConversationMarkdown(conversation,{employeeName='',exportedAt=new Date().toISOString()}={}){
  const messages=conversation.messages||[],title=line(conversation.title||'员工聊天');
  const content=[`# ${text(title)}`,`> 仅导出当前页面已加载的 ${messages.length} 条消息，不代表全部历史。`,`员工：${text(employeeName||conversation.employee?.name||'数字员工')}  \n会话：${text(conversation.id)}  \n导出时间：${text(exportedAt)}`];
  for(const message of messages){
    const role=message.role==='user'?'你':message.role==='assistant'?(employeeName||'数字员工'):'系统';
    content.push('---',`## ${text(role)}${message.created_at?' · '+text(message.created_at):''}`);
    if(message.content)content.push(message.content);
    if(message.attachments?.length)content.push(message.attachments.map(file=>'- 附件：'+text(file.name||'未命名附件')).join('\n'));
    for(const forwarded of conversationForwardMessages(message.forward)){
      content.push(`### 转发 · ${text(forwarded.senderName)}${forwarded.createdAt?' · '+text(forwarded.createdAt):''}`);
      if(forwarded.content)content.push(forwarded.content);
      if(forwarded.attachments.length)content.push(forwarded.attachments.map(file=>'- 附件：'+text(file.name||'未命名附件')).join('\n'));
    }
  }
  const filename=title.replace(/[\\/:*?"<>|\x00-\x1f]/g,'-').replace(/[. ]+$/g,'').slice(0,80)||'员工聊天';
  return{filename:filename+'-已加载聊天.md',content:content.join('\n\n')+'\n'};
}
