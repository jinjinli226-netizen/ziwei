const scopeKey=scope=>JSON.stringify([scope.workspace,scope.entityId,scope.deviceId,scope.editorId]);

// A receipt belongs to the exact editor, device and path that requested it.
export function createDirectoryController({scope,inspect,poll,pause=()=>new Promise(resolve=>setTimeout(resolve,500)),wrap=value=>value}) {
  const state=wrap({path:'',loading:false,result:null,action:null,check:null,error:''});
  let generation=0;
  function invalidate(){generation++;state.loading=false;state.result=null;state.action=null;state.check=null;state.error='';}
  function setPath(path){const next=String(path||'');if(next!==state.path){invalidate();state.path=next;}}
  async function checkDirectory(createIfMissing=false){
    invalidate();const request=++generation,frozen={...scope()},key=scopeKey(frozen),path=state.path.trim();
    const current=()=>request===generation&&key===scopeKey(scope());
    if(!frozen.deviceId){state.error='请先选择在线目标电脑';return null;}
    state.loading=true;
    try{
      const response=await inspect(frozen,{path,createIfMissing:createIfMissing===true,idempotencyKey:`directory-${globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`}`});
      if(!current())return null;
      let action=response?.action||response;state.action=action;
      for(let attempt=0;action&&!['succeeded','failed','expired','cancelled'].includes(action.status)&&attempt<30;attempt++){
        await pause();if(!current())return null;
        const response=await poll(action.id,frozen);if(!current())return null;
        action=response?.action||response;state.action=action;
      }
      if(!action||['failed','expired','cancelled'].includes(action.status))throw new Error(action?.error||'工作目录检查失败');
      if(action.status!=='succeeded')throw new Error('工作目录检查仍在等待目标电脑响应，请稍后重新检查');
      const result=action.result||{};state.result=result;
      if(result.path)state.path=result.path;
      if(result.exists===true&&result.isDirectory===true&&result.path&&action.id)state.check={workspace:frozen.workspace,deviceId:frozen.deviceId,path:result.path,actionId:action.id};
      return result;
    }catch(cause){if(current())state.error=cause.message||'工作目录检查失败';return null;}
    finally{if(current())state.loading=false;}
  }
  return {state,setPath,invalidate,inspect:checkDirectory};
}

export function defaultWorkdirPayload({path='',originalPath='',deviceId='',originalDeviceId='',workspace='',check=null}){
  const value=String(path||'').trim(),original=String(originalPath||'').trim();
  if(!value)return original?{defaultWorkingDirectory:null}:{};
  if(value===original&&deviceId===originalDeviceId)return {};
  if(!check?.actionId||check.path!==value||check.deviceId!==deviceId||check.workspace!==workspace)throw new Error('请在当前目标电脑检查默认工作目录，或明确清除默认目录');
  return {defaultWorkingDirectory:value,defaultWorkingDirectoryActionId:check.actionId};
}

export function employeeConversationPayload(employee,devices=[]){
  const deviceId=employee.target_device_id||employee.targetDeviceId||devices.find(item=>item.status==='online')?.id||devices[0]?.id||null;
  return {title:`${employee.name||'数字伙伴'} 对话`,employeeId:employee.id,modelId:employee.model_id||employee.modelId||null,deviceId};
}
export function conversationSettingsSnapshot(conversation,devices=[],candidate=conversation?.employee){
  const conversationWorkspace=conversation?.workspace_id||conversation?.workspaceId,employeeWorkspace=candidate?.workspace_id||candidate?.workspaceId;
  const employee=candidate?.id&&candidate.id===conversation?.employee_id&&(!conversationWorkspace||!employeeWorkspace||employeeWorkspace===conversationWorkspace)?candidate:null;
  const employeeDevice=employee?.target_device_id||employee?.targetDeviceId||'';
  const deviceId=conversation?.device_id||employeeDevice||devices.find(item=>item.status==='online')?.id||devices[0]?.id||'';
  const defaultDevice=employee?.default_working_directory_device_id||employee?.defaultWorkingDirectoryDeviceId;
  const employeeDirectory=defaultDevice===deviceId&&(!employeeDevice||employeeDevice===deviceId)?employee?.default_working_directory||employee?.defaultWorkingDirectory||'':'';
  return {deviceId,modelId:conversation?.model_id||'',workingDirectory:conversation?.working_directory||employeeDirectory||devices.find(item=>item.id===deviceId)?.workdir||''};
}
export function mergeConversationSettingsDraft(prior,draft,next){
  const merged=Object.fromEntries(Object.keys(next).map(key=>[key,!prior||draft[key]===prior[key]?next[key]:draft[key]]));
  // A server binding change cannot carry a temporary path from the old computer.
  if(prior&&next.deviceId!==prior.deviceId&&draft.deviceId===prior.deviceId)merged.workingDirectory=next.workingDirectory;
  return merged;
}
