const defaults=['Claude','Codex','Gemini','Hermes'];
export function deviceRuntimes(device,catalog=[]){
  const scoped=Array.isArray(device?.runtimes)?device.runtimes:catalog.flatMap(row=>row.device_id===device?.id?[row]:Array.isArray(row.device_runtimes)?row.device_runtimes.filter(item=>item.device_id===device?.id):[]);
  const rows=scoped.length?scoped:(catalog.length?catalog:defaults.map(name=>({name}))).map(row=>({id:row.id,name:row.name,cli_status:'not_reported',cli_version:null,discovery_state:'not_reported'}));
  return rows.map(row=>({...row,id:row.id||`${device?.id}:${row.name}`,device_id:device?.id,device_status:device?.status,
    ...(device?.status!=='online'?{cli_status:'offline',discovery_state:'device_offline'}:{})}));
}
export function runtimePresentation(runtime){
  let state=runtime?.discovery_state||runtime?.detection?.state||runtime?.cli_status||runtime?.status||'not_reported';
  if(state==='offline')state='device_offline';
  if(state==='available'&&((runtime?.cli_status||runtime?.status)!=='available'||runtime?.detection?.versionSource==='installed_metadata'))state='failed';
  if(!['available','not_found','failed','not_reported','stale','device_offline','unavailable','unknown'].includes(state))state='not_reported';
  const label=({available:'可用',not_found:'未发现 CLI',failed:'检测失败',not_reported:'未上报',stale:'发现已过期',device_offline:'设备离线',unavailable:'CLI 不可用',unknown:'检测结果未知'})[state];
  const version=runtime?.cli_version||runtime?.version;
  const versionLabel=version?`${version}${runtime?.detection?.versionSource==='installed_metadata'?'（安装信息，未通过检测）':['stale','device_offline'].includes(state)?'（上次发现）':''}`:({not_reported:'尚未上报',not_found:'未发现 CLI',failed:'未能读取版本',device_offline:'尚无版本记录',stale:'发现已过期'})[state]||'版本未发现';
  return {state,label,versionLabel,online:state==='available',tone:state==='available'?'online':state==='failed'?'failed':'neutral',reason:runtime?.detection?.reason||''};
}
