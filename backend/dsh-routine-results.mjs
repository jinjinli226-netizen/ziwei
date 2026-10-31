import {createHash} from 'node:crypto';
import {normalizeConversationAttachments} from './conversation-attachments.mjs';

export const dshRoutineResultKey=({employeeId,routineId,sessionId,attemptId})=>'dsh-routine:'+createHash('sha256').update(JSON.stringify({employeeId,routineId,sessionId,attemptId:attemptId||sessionId})).digest('hex');

export function dshRoutineHistoryReply(result){
 const native=result?.dshNative||result?.result?.dshNative,records=native?.data?.snapshot?.records;
 if(native?.status!=='observed'||!Array.isArray(records))return null;
 const events=records.map(record=>record?.event||record),start=events.findLastIndex(event=>event?.type==='turn/start'),tail=events.slice(Math.max(start,0));
 const end=tail.findLast(event=>event?.type==='turn/end'),turn=events[start]?.data?.turn??end?.data?.turn;
 if(!end||!['completed','error','max-tokens','blocked','interrupted','forked','failed','aborted'].includes(end.data?.reason?.kind))return null;
 const texts=[],images=[],imageIds=new Set();let rejectedImages=0;
 for(const event of tail){
  if(!['assistant/message','tool/result'].includes(event?.type)||event.data?.turn!==turn||event.surfaceOp&&event.surfaceOp!=='append')continue;
  const content=event.data?.message?.content||event.data?.content;
  if(!Array.isArray(content))continue;
  const blocks=event.type==='tool/result'?content.flatMap(block=>block?.type==='tool-result'&&Array.isArray(block.content)?block.content:block):content;
  const text=event.type==='assistant/message'?blocks.filter(block=>block?.type==='text'&&typeof block.text==='string').map(block=>block.text).join('').trim():'';
  if(text)texts.push(text);
  for(const block of blocks){
   if(block?.type!=='image')continue;
   const imageId=block.attachment?.attachmentId;if(imageId&&imageIds.has(imageId))continue;if(imageId)imageIds.add(imageId);
   const raw=block.data??block.content??block.contentBase64,dataUrl=typeof raw==='string'?raw.match(/^data:([^;,]+);base64,(.*)$/s):null,mimeType=String(block.mediaType||block.mimeType||block.attachment?.mediaType||dataUrl?.[1]||'').toLowerCase();
   const suffix={'image/png':'.png','image/jpeg':'.jpg','image/gif':'.gif','image/webp':'.webp'}[mimeType];
   try{
    if(!suffix)throw new Error('unsupported image');
    const normalized=normalizeConversationAttachments([...images,{name:`dsh-routine-${images.length+1}${suffix}`,mimeType,contentEncoding:'base64',content:dataUrl?dataUrl[2]:raw}],{imagesOnly:true});
    images.splice(0,images.length,...normalized);
   }catch{rejectedImages++;}
  }
 }
 const reason=end.data.reason.kind;
 if(reason!=='completed')texts.unshift(reason==='aborted'?'例行工作已中断，原运行记录已保留。':'例行工作执行失败，原运行记录已保留。');
 if(rejectedImages)texts.push(`${rejectedImages} 张图片内容无效或超过聊天附件限制，未能回传。`);
 return texts.length||images.length?{text:texts.join('\n\n'),images}:null;
}

export function dshRoutineConversation(db,workspaceId,employeeId){
 return db.prepare(`SELECT c.* FROM conversations c WHERE c.workspace_id=? AND c.employee_id=? AND c.status='active'
  AND NOT EXISTS(SELECT 1 FROM management_requests m WHERE m.workspace_id=c.workspace_id AND m.kind='dsh.group.conversation' AND m.resource_id=c.id)
  ORDER BY c.updated_at DESC,c.rowid DESC LIMIT 1`).get(workspaceId,employeeId)||null;
}
