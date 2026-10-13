import {executionUncertain} from './bot-presentation.js';

// Only request metadata is persisted. Initial SOUL is deterministic; the Bot's
// persona and responsibilities remain in its existing configuration draft.
export function createBotProfileRequest({api,wrap=value=>value,namespace='',storage=typeof sessionStorage==='undefined'?null:sessionStorage,getDiscovery=()=>null,keyFactory=()=>crypto.randomUUID(),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),pollLimit=20}={}){
  const registry=new Map(),busy=new Set(),storageKey='ziwei.bot.profile.pending.'+encodeURIComponent(namespace);
  const key=(workspace,deviceId)=>JSON.stringify([workspace,deviceId]);let generation=0,disposed=false;
  const state=wrap({workspace:'',deviceId:'',busy:false,pending:null,action:null,profile:'',phase:'idle',error:'',discovery:null});
  if(namespace)try{for(const entry of JSON.parse(storage?.getItem(storageKey)||'[]'))if(entry.workspace&&entry.deviceId&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(entry.profile)&&entry.profile.toLowerCase()!=='default'&&entry.requestKey)registry.set(key(entry.workspace,entry.deviceId),entry);}catch{}
  const persist=()=>{if(!namespace)return;try{if(registry.size)storage?.setItem(storageKey,JSON.stringify([...registry.values()]));else storage?.removeItem(storageKey);}catch{}};
  const current=visit=>!disposed&&visit===generation;
  function select(workspace,deviceId){generation++;Object.assign(state,{workspace,deviceId,busy:busy.has(key(workspace,deviceId)),pending:registry.get(key(workspace,deviceId))||null,action:null,profile:'',phase:'idle',error:'',discovery:null});if(state.pending){state.phase=state.pending.phase||'pending';state.error='保留了这个电脑的原 Profile 请求，请继续查询原回执。';}}
  function checked(action,entry){if(action?.type!=='hermes.profile.create'||!action.id||action.payload?.workspace!==entry.workspace||action.payload?.deviceId!==entry.deviceId||action.payload?.profile!==entry.profile)throw new Error('Profile 回执的工作区、电脑或名称与原请求不一致；保留原请求待核实。');return action;}
  async function run(entry,{recovering=false}={}){
    const scope=key(entry.workspace,entry.deviceId),visit=generation;if(busy.has(scope))return false;busy.add(scope);if(current(visit)){state.busy=true;state.error='';}
    const update=(phase,error='')=>{entry.phase=phase;registry.set(scope,entry);persist();if(current(visit))Object.assign(state,{phase,error,pending:{...entry}});};
    try{
      let action=checked(entry.actionId?await api.hermesProfileAction(entry.actionId,entry.workspace):await api.createHermesProfile({profile:entry.profile,deviceId:entry.deviceId,soul:`# ${entry.profile}\n`},entry.requestKey,entry.workspace),entry);
      entry.actionId=action.id;update('pending');if(current(visit))state.action=action;
      for(let i=0;['pending','acked'].includes(action.status)&&i<pollLimit;i++){await wait(500);if(!current(visit))return false;action=checked(await api.hermesProfileAction(entry.actionId,entry.workspace),entry);if(current(visit))state.action=action;}
      if(executionUncertain(action)||action.status==='expired'&&action.acked_at){update('unknown','原 Profile 创建结果待核实，请继续查询原任务，勿重新新建。');return false;}
      if(['pending','acked'].includes(action.status)){update('pending','创建请求已提交，等待目标电脑完成；继续查询会保留同一个任务。');return false;}
      if(action.status!=='succeeded'){registry.delete(scope);persist();if(current(visit))Object.assign(state,{pending:null,phase:'failed',error:action.error||'Profile 创建失败；原回执已保留。'});return false;}
      if(action.result?.profile!==entry.profile)throw new Error('Profile 成功回执缺少匹配的名称；请核对原任务。');
      update('discovery_pending','Profile 已创建，正在等待目标电脑更新发现。');
      const profiles=await api.hermesProfiles(entry.deviceId,entry.workspace);if(!current(visit))return false;
      const discovery=await api.managementMcpDiscovery(entry.workspace);if(!current(visit))return false;
      const found=profiles.source==='ziwei_user'&&profiles.profiles?.some(row=>(typeof row==='string'?row:row.name)===entry.profile)&&discovery.workspace===entry.workspace&&discovery.devices?.find(row=>row.id===entry.deviceId)?.runtimes?.find(row=>row.name==='Hermes')?.profiles?.some(row=>(typeof row==='string'?row:row.name)===entry.profile);
      if(!found){update('discovery_pending','Profile 创建回执已成功；设备发现尚未更新，请继续查询。');return false;}
      registry.delete(scope);persist();Object.assign(state,{pending:null,phase:'succeeded',profile:entry.profile,discovery,error:''});return true;
    }catch(error){if(!recovering&&!entry.actionId&&entry.phase!=='unknown'&&error.status>=400&&error.status<500){registry.delete(scope);persist();if(current(visit))Object.assign(state,{pending:null,phase:'failed',error:error.message});}else update('unknown',error.message||'Profile 请求结果待核实，请继续查询原任务。');return false;}
    finally{busy.delete(scope);if(current(visit))state.busy=false;}
  }
  async function submit(value){
    const profile=String(value||'').trim(),scope=key(state.workspace,state.deviceId),previous=registry.get(scope);
    if(previous){if(previous.profile!==profile){state.error='这个电脑还有原 Profile 请求待核实，请先继续查询。';return false;}return run(previous,{recovering:true});}
    if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(profile)||profile.toLowerCase()==='default'){state.error='请填写独立 Profile 名称：1–64 位字母、数字、点、下划线或短横线；不能使用 default。';return false;}
    const discovery=getDiscovery(),device=discovery?.workspace===state.workspace&&discovery.devices?.find(row=>row.id===state.deviceId);
    if(!device||device.status!=='online'||device.healthy===false){state.error='请选择当前工作区在线电脑，确认原 ziwei_user 心跳后再创建。';return false;}
    const entry={workspace:state.workspace,deviceId:state.deviceId,profile,requestKey:'bot-profile-'+keyFactory(),phase:'pending'};registry.set(scope,entry);persist();state.pending={...entry};return run(entry);
  }
  const recover=()=>{const entry=registry.get(key(state.workspace,state.deviceId));return entry?run(entry,{recovering:true}):Promise.resolve(state.phase==='succeeded');};
  return {state,select,submit,recover,pendingRequests:workspace=>[...registry.values()].filter(row=>row.workspace===workspace).map(row=>({...row})),dispose(){disposed=true;generation++;}};
}
