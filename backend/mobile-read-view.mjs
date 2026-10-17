import {createHash} from 'node:crypto';
import {canonicalRasterMimeType,rasterImageMimeType} from '../src/raster-image.mjs';

const terminalEventTypes=new Set(['succeeded','failed','cancelled','expired']);
export function mobileRunView(value) {
  if(!Array.isArray(value?.events))return value;
  const last=value.events.length-1;
  return {...value,events:value.events.filter((event,index)=>index===last||terminalEventTypes.has(event?.type)),event_count:Number.isSafeInteger(value.event_count)&&value.event_count>=value.events.length?value.event_count:value.events.length};
}

// Read projections never mutate the stored employee, conversation or receipt.
// The image source comes only from that employee's stored avatar data URL.
function imageSource(value) {
  if(typeof value!=='string')return null;
  const comma=value.indexOf(',');
  if(comma<0)return null;
  const header=value.slice(0,comma),match=/^data:(image\/[a-z0-9.+-]+)(;base64)?$/i.exec(header);
  if(!match)return null;
  const content=value.slice(comma+1),base64=Boolean(match[2]);
  if(base64&&(!/^[a-z0-9+/\s]*={0,2}$/i.test(content)||content.replace(/\s/g,'').length%4!==0))return null;
  if(!content)return null;
  return {mimeType:match[1].toLowerCase(),content,base64,version:createHash('sha256').update(value).digest('hex')};
}

// Only recognized inline raster bytes become URLs. Legacy metadata, remote
// URLs and unknown encodings remain intact instead of becoming broken images.
function attachmentImageSource(value) {
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  let field,content,mimeType;
  const urlField=['url','dataUrl','data_url','src','preview','previewUrl','download_url','downloadUrl'].find(key=>value[key]);
  if(urlField) {
    const source=imageSource(value[urlField]);
    if(!source?.base64)return null;
    field=urlField;content=source.content;mimeType=source.mimeType;
  }else if(typeof value.data==='string'&&value.mime) {
    field='data';content=value.data;mimeType=value.mime;
  }else if(typeof value.content==='string'&&String(value.contentEncoding||value.content_encoding).toLowerCase()==='base64') {
    field='content';content=value.content;mimeType=value.mimeType||value.mime_type;
  }else if(typeof value.contentBase64==='string') {
    field='contentBase64';content=value.contentBase64;mimeType=value.mimeType||value.mime_type||value.mime;
  }else return null;
  mimeType=canonicalRasterMimeType(mimeType||'');
  if(!['image/png','image/jpeg','image/gif','image/webp'].includes(mimeType))return null;
  const standard=content.replace(/\s/g,'').replace(/-/g,'+').replace(/_/g,'/');
  if(!standard||standard.length>Math.ceil(10*1024*1024/3)*4||standard.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(standard))return null;
  const bytes=Buffer.from(standard,'base64');
  if(bytes.toString('base64')!==standard||rasterImageMimeType(bytes)!==mimeType)return null;
  return {field,bytes,mimeType,version:createHash('sha256').update(bytes).digest('hex')};
}

const parseJson=value=>{try{return JSON.parse(value);}catch{return null;}};
const imageIndex=value=>typeof value==='string'&&/^(0|[1-9]\d*)$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):null;
const forwardRecord=value=>value?.schemaVersion===1&&Array.isArray(value.messages)?value:null;
function inlineImageFields(value,source) {
  const fields=new Set([source.field]);
  for(const field of ['url','dataUrl','data_url','src','preview','previewUrl','download_url','downloadUrl']) {
    if(field===source.field||typeof value[field]!=='string'||!/^data:/i.test(value[field]))continue;
    if(attachmentImageSource({[field]:value[field]})?.version===source.version)fields.add(field);
  }
  for(const field of ['content','data','contentBase64']) {
    if(field===source.field||typeof value[field]!=='string')continue;
    if(attachmentImageSource({[field]:value[field],contentEncoding:value.contentEncoding,content_encoding:value.content_encoding,mimeType:value.mimeType,mime_type:value.mime_type,mime:value.mime})?.version===source.version)fields.add(field);
  }
  return fields;
}
function projectAttachments(values,urlFor) {
  if(!Array.isArray(values))return values;
  let changed=false;
  const projected=values.map((value,index)=>{
    const source=attachmentImageSource(value),url=source&&urlFor(index,source);
    if(!url)return value;
    changed=true;
    const image={...value};for(const field of inlineImageFields(value,source))delete image[field];
    return {...image,...(!Object.hasOwn(image,'size')?{size:source.bytes.length}:{}),...(!Object.hasOwn(image,'mimeType')?{mimeType:source.mimeType}:{}),url:`${url}?v=${source.version}`};
  });
  return changed?projected:values;
}

export function createMobileReadView(repo) {
  const db=repo.db;
  function employee(slug,value) {
    if(!value?.id)return value;
    const source=imageSource(value.avatar);
    return source?{...value,avatar:`/api/workspaces/${encodeURIComponent(slug)}/employees/${encodeURIComponent(value.id)}/avatar?v=${source.version}`}:value;
  }
  function mainConversationId(value) {
    const bot=db.prepare('SELECT main_conversation_id FROM hermes_bots WHERE workspace_id=? AND employee_id=?').get(value.workspace_id,value.id);
    if(bot)return bot.main_conversation_id||null;
    return db.prepare("SELECT id FROM conversations WHERE workspace_id=? AND employee_id=? AND status='active' ORDER BY updated_at DESC LIMIT 1").get(value.workspace_id,value.id)?.id||null;
  }
  function employees(slug,values) {
    return values.map(value=>({...employee(slug,value),main_conversation_id:mainConversationId(value)}));
  }
  function bot(slug,value) {
    return value?.employee?{...value,employee:employee(slug,value.employee)}:value;
  }
  function conversation(value) {
    if(!value)return value;
    const slug=value.employee?db.prepare('SELECT slug FROM workspaces WHERE id=?').get(value.workspace_id)?.slug:null;
    let view=slug?{...value,employee:employee(slug,value.employee)}:value;
    if(!value.id||!Array.isArray(value.messages))return view;
    let changed=false;
    const messages=value.messages.map(message=>{
      if(!message?.id)return message;
      const base=`/api/conversations/${encodeURIComponent(value.id)}/messages/${encodeURIComponent(message.id)}`;
      const forward=forwardRecord(message.forward),flat=[];
      const quoted=forward?.messages.map((quote,index)=>{
        const originals=quote?.attachments;
        if(Array.isArray(originals))for(let image=0;image<originals.length;image++)flat.push({index,image,source:attachmentImageSource(originals[image])});
        const attachments=projectAttachments(originals,image=>`${base}/forwards/${index}/images/${image}`);
        return attachments===originals?quote:{...quote,attachments};
      });
      const attachments=projectAttachments(message.attachments,(index,source)=>{
        if(!forward)return `${base}/images/${index}`;
        // The old-client flattened copy must address the saved target snapshot
        // too; a source conversation is never needed to retrieve this image.
        const original=flat[index];
        return original?.source?.version===source.version?`${base}/forwards/${original.index}/images/${original.image}`:null;
      });
      const forwardChanged=forward&&quoted.some((quote,index)=>quote!==forward.messages[index]);
      if(attachments===message.attachments&&!forwardChanged)return message;
      changed=true;
      return {...message,attachments,...(forwardChanged?{forward:{...forward,messages:quoted}}:{})};
    });
    if(changed)view={...view,messages};
    return view;
  }
  function conversationImage(conversationId,messageId,index,context,forwardIndex) {
    const image=imageIndex(index),quoted=forwardIndex===undefined?undefined:imageIndex(forwardIndex);
    if(image===null||quoted===null||!repo.getConversationAccess(conversationId,context))return null;
    // Read one parent message after authorization. In particular, forwarded
    // bytes belong to its saved target snapshot, irrespective of source access.
    const row=db.prepare(forwardIndex===undefined
      ? 'SELECT attachment_json FROM conversation_messages WHERE conversation_id=? AND id=?'
      : 'SELECT forward_json FROM conversation_messages WHERE conversation_id=? AND id=?').get(conversationId,messageId);
    if(!row)return null;
    const attachments=forwardIndex===undefined?parseJson(row.attachment_json):forwardRecord(parseJson(row.forward_json))?.messages[quoted]?.attachments;
    return Array.isArray(attachments)?attachmentImageSource(attachments[image]):null;
  }
  function avatar(slug,id,context) {
    const workspace=repo.getWorkspace(slug),value=repo.getEmployee(id,context);
    if(!workspace||!value||value.workspace_id!==workspace.id)return null;
    const source=imageSource(value.avatar);
    if(!source)return null;
    try {
      const bytes=source.base64?Buffer.from(source.content.replace(/\s/g,''),'base64'):Buffer.from(decodeURIComponent(source.content),'utf8');
      return bytes.length?{mimeType:source.mimeType,bytes,version:source.version}:null;
    }catch{return null;}
  }
  return {employee,employees,bot,conversation,conversationImage,avatar,run:mobileRunView};
}
