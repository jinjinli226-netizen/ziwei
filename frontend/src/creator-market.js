import { employeeReadiness } from './management-mcp.js';

function profileReady(profile) {
  return profile && typeof profile==='object' && profile.provider_configured!==false && profile.authentication_configured!==false &&
    profile.ready!==false && profile.readiness?.ready!==false && profile.readiness?.provider!=='missing' && profile.readiness?.authentication!=='missing' &&
    (profile.provider_configured===true || profile.readiness?.provider==='configured') &&
    (profile.authentication_configured===true || profile.readiness?.authentication==='configured');
}
export function creatorSelection(discovery, {deviceId, runtime, profile=''}={}, supportedRuntimes=['Codex','Hermes']) {
  const selected=discovery?.devices?.find(device=>device.id===deviceId)?.runtimes?.find(item=>item.name===runtime);
  const profiles=(selected?.profiles || []).map(item=>typeof item==='string'?item:item.name).filter(Boolean);
  const readyProfiles=runtime==='Hermes' ? profiles.filter(name=>profileReady(selected.profiles.find(item=>item?.name===name)) && employeeReadiness(discovery,{deviceId,runtime,profile:name}).ready) : profiles;
  const effectiveProfile=profile || (runtime==='Hermes' ? readyProfiles.includes('default')?'default':readyProfiles.length===1?readyProfiles[0]:'' : '');
  const result=employeeReadiness(discovery,{deviceId,runtime,profile:effectiveProfile});
  if(runtime==='Hermes' && effectiveProfile && !readyProfiles.includes(effectiveProfile))result.issues.push(`profile「${effectiveProfile}」尚无明确的认证与 provider 就绪证据，请刷新目标电脑发现。`);
  if(!supportedRuntimes.includes(runtime))result.issues.push('Creator 目前支持 Codex 或 Hermes，请选择目标电脑已发现的运行时。');
  return {...result,ready:result.issues.length===0,profile:effectiveProfile,profiles:readyProfiles,requiresProfile:runtime==='Hermes'&&readyProfiles.length>1&&!readyProfiles.includes('default')};
}

export function creatorInstancePayload(discovery, selection, supportedRuntimes) {
  const current=creatorSelection(discovery,selection,supportedRuntimes);
  if(!current.ready)throw new Error(current.issues.join('；'));
  return {targetDeviceId:selection.deviceId,runtime:selection.runtime,...(current.profile?{runtimeProfile:current.profile}:{}),...(selection.model&&selection.model!=='default'?{model:selection.model}:{}),visibility:'personal'};
}
