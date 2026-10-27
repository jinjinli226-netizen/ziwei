import {setTimeout as sleep} from 'node:timers/promises';

export const CLIENT_START_READY_TIMEOUT_MS=60_000;

export async function waitForClientReady({probeReady,expectedPid,expectedBuild,
  timeoutMs=CLIENT_START_READY_TIMEOUT_MS,now=()=>performance.now(),sleep:pause=sleep}={}){
  if(typeof probeReady!=='function'||!Number.isSafeInteger(expectedPid)||expectedPid<=0
    ||!/^[a-f0-9]{64}$/.test(expectedBuild||'')||!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>180_000){
    throw Object.assign(new Error('客户端启动身份或等待时限无效'),{code:'CLIENT_START_ARGUMENTS_INVALID'});
  }
  const deadline=now()+timeoutMs;
  while(now()<deadline){
    const ready=await probeReady();
    if(ready.ok){
      if(ready.body?.pid!==expectedPid||ready.body?.clientBuild!==expectedBuild){
        throw Object.assign(new Error('客户端就绪响应的 PID 或构建标识不匹配'),{code:'CLIENT_START_IDENTITY_MISMATCH'});
      }
      return ready;
    }
    const remaining=deadline-now();
    if(remaining>0)await pause(Math.min(1000,remaining));
  }
  return{ok:false};
}
