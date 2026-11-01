import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {MAX_ATTACHMENT_BYTES,ATTACHMENT_CHUNK_BYTES} from './conversation-attachment-policy.mjs';

const fail=(code,message=code)=>Object.assign(new Error(message),{code});
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(value);
function metadata(value){
  if(!value||typeof value.name!=='string'||!value.name||value.name.length>255||typeof value.mimeType!=='string'||!value.mimeType||value.mimeType.length>255||!Number.isSafeInteger(value.size)||value.size<0||value.size>MAX_ATTACHMENT_BYTES||typeof value.sha256!=='string'||!/^[a-f0-9]{64}$/.test(value.sha256))throw fail('ATTACHMENT_METADATA_INVALID');
}
export function validateAttachmentReference(value){metadata(value);if(!identifier(value.attachmentId))throw fail('ATTACHMENT_METADATA_INVALID');return value;}
function reference(value,artifact){
  if(!identifier(value?.attachmentId)||['name','mimeType','size','sha256'].some(key=>value[key]!==artifact[key]))throw fail('ATTACHMENT_REFERENCE_INVALID');
  return{attachmentId:value.attachmentId,name:value.name,mimeType:value.mimeType,size:value.size,sha256:value.sha256};
}
function uploadOffset(value,size,uploadId){
  if(!value||value.uploadId!==undefined&&value.uploadId!==uploadId||!Number.isSafeInteger(value.offset)||value.offset<0||value.offset>size)throw fail('ATTACHMENT_UPLOAD_STATE_INVALID');
  return value.offset;
}
async function verifyFile(artifact,signal){
  signal?.throwIfAborted();
  const stat=await fs.promises.stat(artifact.path);
  if(!stat.isFile()||stat.size!==artifact.size)throw fail('ATTACHMENT_FILE_MISMATCH');
  const sum=createHash('sha256');let size=0;
  for await(const chunk of fs.createReadStream(artifact.path,{highWaterMark:64*1024,signal})){size+=chunk.length;sum.update(chunk);}
  if(size!==artifact.size||sum.digest('hex')!==artifact.sha256)throw fail('ATTACHMENT_FILE_MISMATCH');
}

export function createAttachmentTransfer({apiBase,headers={},fetchImpl=fetch,timeoutMs=600000}={}){
  let origin;
  try{origin=new URL(apiBase);}catch{throw fail('ATTACHMENT_ORIGIN_INVALID');}
  if(origin.username||origin.password||origin.search||origin.hash||!(origin.protocol==='https:'||origin.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(origin.hostname)))throw fail('ATTACHMENT_ORIGIN_INVALID');
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>600000)throw fail('ATTACHMENT_TIMEOUT_INVALID');
  const base=origin.href.replace(/\/$/,'');
  async function request(route,{method='GET',body,contentType,idempotencyKey,signal,stream=false}={}){
    signal?.throwIfAborted();
    const budget=new AbortController(),bounded=signal?AbortSignal.any([signal,budget.signal]):budget.signal;
    let timer,streaming=false;
    const close=()=>clearTimeout(timer),reset=()=>{close();timer=setTimeout(()=>budget.abort(new DOMException('Attachment transfer timed out','TimeoutError')),timeoutMs);};
    reset();
    try{
      const auth=new Headers(typeof headers==='function'?await headers():headers);
      if(contentType)auth.set('content-type',contentType);
      if(idempotencyKey)auth.set('Idempotency-Key',idempotencyKey);
      const response=await fetchImpl(base+route,{method,headers:auth,body,signal:bounded,redirect:'error'});
      if(!response.ok)throw Object.assign(fail('ATTACHMENT_HTTP_FAILED',`Attachment request failed (HTTP ${response.status})`),{status:response.status});
      if(stream){streaming=true;reset();return{response,signal:bounded,reset,close};}
      return await response.json();
    }finally{if(!streaming)close();}
  }
  async function download({actionId,attachment,destination,signal}={}){
    signal?.throwIfAborted();validateAttachmentReference(attachment);
    if(!identifier(actionId)||typeof destination!=='string'||!destination)throw fail('ATTACHMENT_METADATA_INVALID');
    const {response,signal:bounded,reset,close}=await request(`/a2a/v1/actions/${encodeURIComponent(actionId)}/attachments/${encodeURIComponent(attachment.attachmentId)}`,{signal,stream:true});
    const sum=createHash('sha256');let size=0,created=false;
    try{
      const output=fs.createWriteStream(destination,{flags:'wx',mode:0o600});output.once('open',()=>{created=true;});
      const meter=new Transform({transform(chunk,encoding,done){reset();size+=chunk.length;if(size>attachment.size)return done(fail('ATTACHMENT_FILE_MISMATCH'));sum.update(chunk);done(null,chunk);}});
      await pipeline(response.body?Readable.fromWeb(response.body):Readable.from([]),meter,output,{signal:bounded});
      if(size!==attachment.size||sum.digest('hex')!==attachment.sha256)throw fail('ATTACHMENT_FILE_MISMATCH');
    }catch(error){if(created)await fs.promises.unlink(destination).catch(()=>{});throw error;}finally{close();}
    return{path:destination,name:attachment.name,mimeType:attachment.mimeType,size,bytes:size,sha256:attachment.sha256,attachmentId:attachment.attachmentId,nativeVision:false};
  }
  async function upload({actionId,artifact,state,onState=async()=>{},signal}={}){
    signal?.throwIfAborted();metadata(artifact);
    if(!identifier(actionId)||typeof artifact.path!=='string'||!artifact.path||typeof onState!=='function')throw fail('ATTACHMENT_METADATA_INVALID');
    await verifyFile(artifact,signal);
    if(state?.ref)return reference(state.ref,artifact);
    const route=`/a2a/v1/actions/${encodeURIComponent(actionId)}/attachments/uploads`;
    const creationKey=createHash('sha256').update(JSON.stringify([actionId,artifact.name,artifact.mimeType,artifact.size,artifact.sha256])).digest('hex');
    let uploadId,offset;
    if(state?.uploadId){
      if(!identifier(state.uploadId))throw fail('ATTACHMENT_UPLOAD_STATE_INVALID');
      uploadId=state.uploadId;uploadOffset(state,artifact.size,uploadId);
      const current=await request(`${route}/${encodeURIComponent(uploadId)}`,{signal});
      offset=uploadOffset(current,artifact.size,uploadId);
      await onState({uploadId,offset});
    }else{
      if(state!==undefined&&state!==null&&(!state.creating||state.creationKey!==creationKey))throw fail('ATTACHMENT_UPLOAD_STATE_INVALID');
      // Repeating this key resumes the same session after a lost create response.
      await onState({creating:true,creationKey,offset:0});
      const created=await request(route,{method:'POST',body:JSON.stringify({name:artifact.name,mimeType:artifact.mimeType,size:artifact.size}),contentType:'application/json',idempotencyKey:creationKey,signal});
      if(!identifier(created?.uploadId)||created.chunkSize!==ATTACHMENT_CHUNK_BYTES)throw fail('ATTACHMENT_UPLOAD_STATE_INVALID');
      uploadId=created.uploadId;offset=uploadOffset(created,artifact.size,uploadId);
      await onState({uploadId,offset});
    }
    const handle=await fs.promises.open(artifact.path,'r');
    try{
      const buffer=Buffer.allocUnsafe(Math.min(ATTACHMENT_CHUNK_BYTES,artifact.size-offset));
      while(offset<artifact.size){
        signal?.throwIfAborted();
        const length=Math.min(buffer.length,artifact.size-offset);let read=0;
        while(read<length){const part=await handle.read(buffer,read,length-read,offset+read);if(!part.bytesRead)throw fail('ATTACHMENT_FILE_MISMATCH');read+=part.bytesRead;}
        const next=await request(`${route}/${encodeURIComponent(uploadId)}?offset=${offset}`,{method:'PUT',body:buffer.subarray(0,length),contentType:'application/octet-stream',signal});
        const nextOffset=uploadOffset(next,artifact.size,uploadId);
        if(nextOffset!==offset+length)throw fail('ATTACHMENT_UPLOAD_STATE_INVALID');
        offset=nextOffset;await onState({uploadId,offset});
      }
    }finally{await handle.close();}
    const completed=await request(`${route}/${encodeURIComponent(uploadId)}/complete`,{method:'POST',body:'{}',contentType:'application/json',signal});
    const ref=reference(completed,artifact);
    await onState({uploadId,offset,ref});
    return ref;
  }
  return{download,upload};
}
