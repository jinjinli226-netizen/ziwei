const parse=(value,fallback)=>{try{return JSON.parse(value??'')??fallback;}catch{return fallback;}};
const text=value=>String(value??'').replace(/(token|password|secret|api[_-]?key)(\s*[=:]\s*)[^\s,;]+/gi,'$1$2[redacted]').slice(0,400);
export function runtimeName(value){const name=String(value??'').trim();return ['Claude','Codex','Gemini','Hermes'].find(item=>item.toLowerCase()===name.toLowerCase())??name;}

export function safeRuntimeDetection(value,status){
  const raw=value&&typeof value==='object'?value:{};
  let state=['available','not_found','failed'].includes(raw.state)?raw.state:(status==='available'?'available':status==='unavailable'?'unavailable':'unknown');
  if(state==='available'&&(status!=='available'||raw.versionSource==='installed_metadata'))state='failed';
  const result={state};
  for(const key of ['reasonCode','reason','source','platform','arch'])if(typeof raw[key]==='string')result[key]=text(raw[key]);
  if(typeof raw.installed==='boolean'||raw.installed===null)result.installed=raw.installed;
  if(['cli','installed_metadata',null].includes(raw.versionSource))result.versionSource=raw.versionSource;
  if(typeof raw.errorCode==='string')result.errorCode=text(raw.errorCode);
  if(Number.isInteger(raw.exitCode))result.exitCode=raw.exitCode;
  if(typeof raw.checkedAt==='string'&&Number.isFinite(Date.parse(raw.checkedAt)))result.checkedAt=raw.checkedAt;
  return result;
}

export function deviceRuntimeView(catalog,metadata,device,clock=Date.now()){
  const seenAt=Date.parse(metadata?.last_seen??'');
  const fresh=Number.isFinite(seenAt)&&seenAt<=clock&&clock-seenAt<=Math.max(45000,Number(device.heartbeat_interval_ms||10000)*4);
  const detection=metadata?safeRuntimeDetection(parse(metadata.detection_json,{}),metadata.status):{state:'not_reported'};
  const discoveryState=device.status!=='online'?'device_offline':!metadata?'not_reported':!fresh?'stale':detection.state;
  const available=discoveryState==='available'&&metadata?.status==='available';
  const cliStatus=discoveryState==='device_offline'?'offline':discoveryState==='not_reported'?'not_reported':discoveryState==='stale'?'unknown':available?'available':metadata?.status==='unavailable'?'unavailable':'unknown';
  return {
    ...catalog,id:catalog.id,view_id:`${catalog.id}:${device.id}`,device_id:device.id,device_name:device.name,name:catalog.name,
    status:available?'online':discoveryState==='device_offline'?'offline':'unknown',
    version:metadata?.version??null,cli_version:metadata?.version??null,cli_binary:metadata?.binary??null,
    cli_status:cliStatus,available,discovery_state:discoveryState,detection,
    last_seen:metadata?.last_seen??null,discovery_age_ms:Number.isFinite(seenAt)&&seenAt<=clock?clock-seenAt:null,
    capabilities:parse(catalog.capabilities_json,[]),models:parse(metadata?.models_json,[]),
    profiles:parse(metadata?.profiles_json,[]),readiness:parse(metadata?.readiness_json,{}),
    bridge_name:device.bridge_name||'ziwei_user',bridge_version:device.bridge_version??null,
    bridge_status:device.status,device_status:device.status,
    available_device_ids:available?[device.id]:[],available_device_count:available?1:0
  };
}
