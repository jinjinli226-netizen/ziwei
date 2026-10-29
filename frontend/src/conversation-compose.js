export const CONVERSATION_IMAGE_LIMIT = 10 * 1024 * 1024;

export function createConversationEnterGuard({now=()=>Date.now()}={}) {
  let composing=false,endedAt=-Infinity;
  return {
    compositionStart(){composing=true;},
    compositionEnd(){composing=false;endedAt=now();},
    shouldSend(event){
      if(event.key!=='Enter'||event.shiftKey||event.ctrlKey||event.altKey||event.metaKey)return false;
      if(composing||event.isComposing||event.keyCode===229)return false;
      event.preventDefault();
      return now()-endedAt>=500;
    }
  };
}

export function clipboardImageFiles(clipboardData) {
  const images=Array.from(clipboardData?.items || [])
    .filter(item=>item.kind==='file' && /^image\//i.test(item.type || ''))
    .map(item=>item.getAsFile()).filter(Boolean);
  if(images.length)return images;
  return Array.from(clipboardData?.files || []).filter(file=>/^image\//i.test(file.type || '') || (!file.type && /\.(png|jpe?g|gif|webp)$/i.test(file.name || '')));
}

export function createConversationComposerStore({makeId=()=>crypto.randomUUID(),wrap=value=>value}={}) {
  const entries=new Map();
  function get(key) {
    if (!entries.has(key)) entries.set(key,wrap({draft:'',attachments:[],revision:0,draftRevision:0,attachmentRevision:0,reading:false,readToken:0,pending:false,request:null,error:''}));
    return entries.get(key);
  }
  function updateDraft(key,draft) { const entry=get(key);entry.draft=draft;entry.revision++;entry.draftRevision++; }
  function setAttachments(key,attachments) { const entry=get(key);entry.attachments=attachments;entry.revision++;entry.attachmentRevision++; }
  function beginRead(key) { const entry=get(key);entry.reading=true;return ++entry.readToken; }
  function cancelRead(key) { const entry=get(key);entry.reading=false;entry.readToken++; }
  function finishRead(key,token,attachments,error='') {
    const entry=get(key);if(entry.readToken!==token)return false;
    entry.reading=false;entry.error=error;if(!error)setAttachments(key,attachments);return true;
  }
  function beginSubmission(key,settings={}) {
    const entry=get(key);
    if(entry.pending || entry.reading || (!entry.draft.trim() && !entry.attachments.length))return null;
    const fingerprint=JSON.stringify([entry.draft.trim(),entry.attachments,settings]);
    if(entry.request?.fingerprint!==fingerprint)entry.request={fingerprint,id:makeId()};
    entry.pending=true;entry.error='';
    return {key,revision:entry.revision,draftRevision:entry.draftRevision,attachmentRevision:entry.attachmentRevision,draft:entry.draft.trim(),attachments:[...entry.attachments],clientMessageId:entry.request.id};
  }
  function completeSubmission(submission) {
    const entry=get(submission.key);if(entry.request?.id!==submission.clientMessageId)return;
    if(entry.draftRevision===submission.draftRevision)updateDraft(submission.key,'');
    if(entry.attachmentRevision===submission.attachmentRevision)setAttachments(submission.key,[]);
    entry.pending=false;entry.error='';entry.request=null;
  }
  function failSubmission(submission,error) {
    const entry=get(submission.key);if(entry.request?.id!==submission.clientMessageId)return;
    entry.pending=false;entry.error=String(error || '消息发送失败，请重试');
  }
  return {get,updateDraft,setAttachments,beginRead,cancelRead,finishRead,beginSubmission,completeSubmission,failSubmission};
}

export function imageMimeFromBytes(bytes) {
  if(bytes.length>=8 && [137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value))return 'image/png';
  if(bytes.length>=3 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255)return 'image/jpeg';
  const prefix=String.fromCharCode(...bytes.subarray(0,12));
  if(prefix.startsWith('GIF87a') || prefix.startsWith('GIF89a'))return 'image/gif';
  if(prefix.startsWith('RIFF') && prefix.slice(8,12)==='WEBP')return 'image/webp';
  return '';
}

export async function readConversationImages(files) {
  if(files.length>20)throw new Error('每条消息最多附加 20 张图片');
  if(files.reduce((total,file)=>total+file.size,0)>CONVERSATION_IMAGE_LIMIT)throw new Error('每条消息的图片合计不能超过 10 MB');
  const attachments=[];
  for(const file of files) {
    const bytes=new Uint8Array(await file.arrayBuffer());
    const mimeType=imageMimeFromBytes(bytes);
    if(!mimeType)throw new Error(`${file.name}：请选择 PNG、JPG/JPEG、GIF 或 WebP 图片`);
    if(bytes.byteLength>CONVERSATION_IMAGE_LIMIT)throw new Error('每条消息的图片合计不能超过 10 MB');
    let binary='';for(let index=0;index<bytes.length;index+=0x8000)binary+=String.fromCharCode(...bytes.subarray(index,index+0x8000));
    attachments.push({name:file.name,mimeType,size:bytes.byteLength,content:btoa(binary),contentEncoding:'base64'});
  }
  if(attachments.reduce((total,item)=>total+item.size,0)>CONVERSATION_IMAGE_LIMIT)throw new Error('每条消息的图片合计不能超过 10 MB');
  return attachments;
}
