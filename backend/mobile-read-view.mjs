import {createHash} from 'node:crypto';

const terminalEventTypes=new Set(['succeeded','failed','cancelled','expired']);
export function mobileRunView(value) {
  if(!Array.isArray(value?.events))return value;
  const last=value.events.length-1;
  return {...value,events:value.events.filter((event,index)=>index===last||terminalEventTypes.has(event?.type)),event_count:value.events.length};
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
    if(!value?.employee)return value;
    const slug=db.prepare('SELECT slug FROM workspaces WHERE id=?').get(value.workspace_id)?.slug;
    return slug?{...value,employee:employee(slug,value.employee)}:value;
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
  return {employee,employees,bot,conversation,avatar,run:mobileRunView};
}
