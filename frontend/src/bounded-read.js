export const READ_TIMEOUT_MS=20_000;

// Bound the whole read, including body consumption. Aborting fetch alone does
// not settle a custom/stalled transport, so race it against our own rejection.
export function boundedRead(read,{timeoutMs=READ_TIMEOUT_MS,signal}={}){
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0)return Promise.reject(new RangeError('timeoutMs must be positive'));
  return new Promise((resolve,reject)=>{
    const controller=new AbortController();
    let settled=false,timer;
    const finish=(complete,value)=>{
      if(settled)return;
      settled=true;clearTimeout(timer);signal?.removeEventListener('abort',onAbort);complete(value);
    };
    const cancel=reason=>{
      if(settled)return;
      finish(reject,reason);controller.abort(reason);
    };
    const onAbort=()=>cancel(signal.reason||new DOMException('读取已取消','AbortError'));
    if(signal?.aborted){onAbort();return;}
    signal?.addEventListener('abort',onAbort,{once:true});
    timer=setTimeout(()=>{
      const error=new Error('读取超时，请重试。');error.name='TimeoutError';error.code='READ_TIMEOUT';error.timeoutMs=timeoutMs;
      cancel(error);
    },timeoutMs);
    try{Promise.resolve(read(controller.signal)).then(value=>finish(resolve,value),error=>finish(reject,error));}
    catch(error){finish(reject,error);}
  });
}
