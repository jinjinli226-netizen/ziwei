const fields=new Set(['schemaVersion','responseId','sequence','phase','text','format']);

export function validateActionResponse(actionId,data) {
  if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(key=>!fields.has(key))||data.schemaVersion!==1||data.responseId!==`${actionId}:assistant`||!Number.isSafeInteger(data.sequence)||data.sequence<1||data.phase!=='streaming'||typeof data.text!=='string'||data.format!=='markdown') {
    throw Object.assign(new Error('公开回答事件格式或执行绑定无效'),{code:'ACTION_RESPONSE_INVALID',status:400});
  }
  if(Buffer.byteLength(data.text,'utf8')>1024*1024)throw Object.assign(new Error('公开回答超过 1 MiB 文本限制'),{code:'ACTION_RESPONSE_TOO_LARGE',status:413});
}

export function createActionResponseReader(db) {
  const latest=db.prepare("SELECT data_json FROM a2a_action_events WHERE action_id=? AND type='action.response' ORDER BY json_extract(data_json,'$.sequence') DESC,rowid DESC LIMIT 1");
  return action=>{
    if(!['pending','acked'].includes(action.status))return undefined;
    const row=latest.get(action.id);
    if(!row)return undefined;
    const {schemaVersion,responseId,sequence,phase,text,format}=JSON.parse(row.data_json);
    return {schemaVersion,responseId,sequence,phase,text,format,channel:'assistant'};
  };
}

// History keeps response ordering metadata; the independent stream projection
// carries the current text once even when later tool events arrive.
export const actionEventDataSql="CASE WHEN type='action.response' THEN json_remove(data_json,'$.text') ELSE data_json END AS data_json";
