import {ATTACHMENT_CHUNK_BYTES,MAX_ATTACHMENT_BYTES} from '../../src/conversation-attachment-policy.mjs';

export function createConversationAttachmentUploader({request,makeKey=()=>crypto.randomUUID()}={}) {
  const sessions=new WeakMap();
  return async function upload(conversationId,file,{signal,onProgress=()=>{}}={}) {
    if(!Number.isSafeInteger(file?.size)||file.size<=0||file.size>MAX_ATTACHMENT_BYTES)throw new Error('附件大小须大于 0，且不能超过 500 MB');
    let conversations=sessions.get(file);
    if(!conversations){conversations=new Map();sessions.set(file,conversations);}
    let state=conversations.get(conversationId);
    if(!state){state={key:makeKey()};conversations.set(conversationId,state);}
    if(state.ref)return state.ref;
    const base=`/api/conversations/${encodeURIComponent(conversationId)}/attachments/uploads`;
    const call=(path,options={})=>request(path,{...options,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(600000)]):AbortSignal.timeout(600000)});
    const status=state.uploadId
      ?await call(`${base}/${encodeURIComponent(state.uploadId)}`)
      :await call(base,{method:'POST',headers:{'Idempotency-Key':state.key},body:JSON.stringify({name:file.name,mimeType:file.type||'application/octet-stream',size:file.size})});
    if(typeof status.uploadId!=='string'||!status.uploadId||!Number.isSafeInteger(status.offset)||status.offset<0||status.offset>file.size)throw new Error('附件上传进度回执无效，请重试');
    state.uploadId=status.uploadId;
    const endpoint=`${base}/${encodeURIComponent(state.uploadId)}`;
    const chunkSize=Math.min(status.chunkSize||ATTACHMENT_CHUNK_BYTES,ATTACHMENT_CHUNK_BYTES);
    if(!Number.isSafeInteger(chunkSize)||chunkSize<=0)throw new Error('附件分块大小无效');
    let offset=status.offset;onProgress({loaded:offset,total:file.size});
    while(offset<file.size) {
      const end=Math.min(offset+chunkSize,file.size),chunk=file.slice(offset,end);
      const receipt=await call(`${endpoint}?offset=${offset}`,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:chunk});
      if(receipt.offset!==end||receipt.uploadId&&receipt.uploadId!==state.uploadId)throw new Error('附件分块回执不匹配，请重试');
      offset=end;onProgress({loaded:offset,total:file.size});
    }
    const ref=await call(`${endpoint}/complete`,{method:'POST',body:'{}'});
    if(typeof ref.attachmentId!=='string'||!ref.attachmentId||ref.size!==file.size||! /^[a-f0-9]{64}$/.test(ref.sha256||''))throw new Error('附件完成回执不匹配，请重试');
    state.ref={attachmentId:ref.attachmentId,name:ref.name,mimeType:ref.mimeType,size:ref.size,sha256:ref.sha256};
    return state.ref;
  };
}
