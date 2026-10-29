import {discoverInstalledRuntimes} from './runtime-adapters.mjs';

export function createRuntimeDiscovery({discoverCli=discoverInstalledRuntimes,fetchImpl=globalThis.fetch,env=process.env,now=Date.now,ttlMs=10000,timeoutMs=1500}={}) {
  let cached=null;
  return async ({force=false}={})=>{
    const cli=discoverCli({force}),baseUrl=String(env.ZIWEI_DSH_BASE_URL||'http://127.0.0.1:7878').replace(/\/$/,'');
    if(force||!cached||cached.baseUrl!==baseUrl||cached.expiresAt<=now()){
      const value=await readDshRuntime(baseUrl,{fetchImpl,now,timeoutMs});
      cached={baseUrl,value,expiresAt:now()+ttlMs};
    }
    return {...cli,runtimes:{...cli.runtimes,DSH:cached.value}};
  };
}

async function readDshRuntime(baseUrl,{fetchImpl,now,timeoutMs}) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  let reasonCode='DSH_HUB_UNAVAILABLE',reason='DSH Hub 无法连接';
  try {
    const response=await fetchImpl(`${baseUrl}/api/state`,{method:'GET',redirect:'error',signal:controller.signal});
    reasonCode='DSH_HUB_HTTP_FAILED';reason='DSH Hub 状态读取失败';
    if(!response.ok)throw new Error(reasonCode);
    reasonCode='DSH_HUB_STATE_INVALID';reason='DSH Hub 状态格式无法识别';
    const state=await response.json();
    if(!validDshState(state))throw new Error(reasonCode);
    const profiles=state.bots.map(bot=>({name:bot.name,readiness:{ready:bot.running&&bot.ready,reason:!bot.running?'DSH Bot 未运行':!bot.ready?'DSH Bot 尚未就绪':''}}));
    const ready=profiles.some(profile=>profile.readiness.ready),readinessReason=!profiles.length?'尚无可绑定的 DSH Bot':ready?'':'DSH Bot 尚未就绪';
    return {runtime:'DSH',status:'available',version:null,source:'dsh-native-http',profiles,
      readiness:{ready,provider:'native',authentication:'native',reason:readinessReason},
      detection:{state:'available',source:'dsh-native-http',checkedAt:new Date(now()).toISOString(),reason:readinessReason}};
  } catch {
    if(controller.signal.aborted){reasonCode='DSH_HUB_TIMEOUT';reason='DSH Hub 状态读取超时';}
    return {runtime:'DSH',status:'unavailable',version:null,source:'dsh-native-http',profiles:[],
      readiness:{ready:false,provider:'unknown',authentication:'unknown',reason},
      detection:{state:'failed',source:'dsh-native-http',checkedAt:new Date(now()).toISOString(),reasonCode,reason}};
  } finally {clearTimeout(timer);}
}

function validDshState(state) {
  return Array.isArray(state?.bots)&&state.bots.every(bot=>typeof bot?.name==='string'&&/^[a-z0-9][a-z0-9-]{0,23}$/.test(bot.name)&&typeof bot.running==='boolean'&&typeof bot.ready==='boolean');
}
