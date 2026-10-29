// This adapter is transport only. Routes must resolve the authenticated
// workspace's visible employee/Bot binding before calling any operation.
export function createDshAdapter({baseUrl=process.env.ZIWEI_DSH_BASE_URL||'http://127.0.0.1:7879',fetchImpl=globalThis.fetch}={}) {
  const request=async(pathname,{method='GET',body=null,signal}={})=>{
    const response=await fetchImpl(`${String(baseUrl).replace(/\/$/,'')}${pathname}`,{method,headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:signal||AbortSignal.timeout(3000)});
    const value=await response.json().catch(()=>({}));
    if(!response.ok||value?.ok===false)throw Object.assign(new Error(value?.error||`DSH HTTP ${response.status}`),{status:response.status});
    return value;
  };
  const runtimeRpc=async(botName,method,args,options={})=>{
    const rpcId=crypto.randomUUID();
    const value=await request(`/runtime/${encodeURIComponent(botName)}/api/${method}`,{...options,method:'POST',body:{type:'client-request',rpcId,method,payload:{args}}});
    if(value?.result?.ok===false)throw Object.assign(new Error(value.result.error?.message||String(value.result.error||'DSH RPC failed')),{status:502});
    if(value?.type!=='server-response'||value.rpcId!==rpcId||value.result?.ok!==true)throw Object.assign(new Error('DSH returned an invalid RPC response'),{status:502});
    return value;
  };
  const sessionCancel=(botName,sessionId,options={})=>runtimeRpc(botName,'session/cancel',{request:{sessionId}},options);
  const routine=(botName,id,options)=>request(`/api/bots/${encodeURIComponent(botName)}/routines/${encodeURIComponent(id)}`,options);
  return {
    runtimeRpc,
    sessions:(botName,options={})=>runtimeRpc(botName,'session/list',{_request:{}},options),
    sessionCancel,
    sessionControl:(botName,sessionId,body,options={})=>runtimeRpc(botName,'session/control',{request:{...body,sessionId}},options),
    health:options=>request('/health',options),
    state:options=>request('/api/state',options),
    groups:(options={})=>{
      if(['POST','PUT','PATCH'].includes(String(options.method||'').toUpperCase())){
        const members=options.body?.members;
        if(!Array.isArray(members)||members.length<2||members.length>6||members.some(name=>typeof name!=='string'||!name.trim())||new Set(members).size!==members.length)throw new Error('DSH 群组必须包含 2 到 6 个不重复的真实 Bot 成员');
      }
      return request('/api/groups',options);
    },
    group:(id,options)=>request(`/api/groups/${encodeURIComponent(id)}`,options),
    routines:(botName,options)=>request(`/api/bots/${encodeURIComponent(botName)}/routines`,options),
    routine,
    routineCancel:async(botName,id,options)=>{
      const value=await routine(botName,id,options),item=value?.item||value,sessionId=item?.lastSessionId||item?.last_session_id;
      if(!sessionId)throw new Error('该例行任务当前没有可停止的真实 session');
      // An accepted cancel RPC is a request, not proof that its turn stopped.
      return sessionCancel(botName,sessionId,options);
    },
    botFiles:(botName,path,options)=>request(`/api/bots/${encodeURIComponent(botName)}/files?path=${encodeURIComponent(path||'')}`,options),
    botLog:(botName,lines=200,options)=>request(`/api/bots/${encodeURIComponent(botName)}/log?n=${Math.max(1,Math.min(1000,Number(lines)||200))}`,options)
  };
}

export const dshRuntimeRpc=(...args)=>createDshAdapter().runtimeRpc(...args);
export const dshSessions=(...args)=>createDshAdapter().sessions(...args);
export const dshSessionCancel=(...args)=>createDshAdapter().sessionCancel(...args);
export const dshSessionControl=(...args)=>createDshAdapter().sessionControl(...args);
export const dshHealth=(...args)=>createDshAdapter().health(...args);
export const dshState=(...args)=>createDshAdapter().state(...args);
export const dshGroups=(...args)=>createDshAdapter().groups(...args);
export const dshGroup=(...args)=>createDshAdapter().group(...args);
export const dshRoutines=(...args)=>createDshAdapter().routines(...args);
export const dshRoutine=(...args)=>createDshAdapter().routine(...args);
export const dshRoutineCancel=(...args)=>createDshAdapter().routineCancel(...args);
export const dshBotFiles=(...args)=>createDshAdapter().botFiles(...args);
export const dshBotLog=(...args)=>createDshAdapter().botLog(...args);
