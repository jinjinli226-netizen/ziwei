import WebSocket from 'ws';

export function readDshNativeSnapshot(options){return openNativeStream({...options,endpoint:'session/follow',snapshot:true});}
export function subscribeDshNativeEvents(options){return openNativeStream({...options,endpoint:'$events',args:{},snapshot:false});}

function openNativeStream({baseUrl,botName,endpoint,args,signal,onEvent=()=>{},nextEvent,snapshot,WebSocketImpl=WebSocket,timeoutMs=5000}){
 return new Promise((resolve,reject)=>{
  const streamId=crypto.randomUUID(),ws=new WebSocketImpl(`${baseUrl.replace(/^http/,'ws').replace(/\/$/,'')}/runtime/${encodeURIComponent(botName)}/api/remote.mux`);
  let ready=false,closed=false,clientId=null;
  const detach=()=>{if(closed)return;closed=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);ws.close();};
  const fail=()=>{const error=Object.assign(new Error('DSH_NATIVE_STREAM_UNAVAILABLE'),{code:'DSH_NATIVE_STREAM_UNAVAILABLE'});if(!ready){detach();reject(error);}else{detach();onEvent({type:'transport-error',code:error.code});}};
  const abort=()=>fail(),timer=setTimeout(fail,timeoutMs);
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted){fail();return;}
  ws.on('open',()=>{if(!closed)ws.send(JSON.stringify({type:'open',streamId,endpoint,payload:{args}}));});
  ws.on('message',raw=>{
   if(closed)return;
   let frame;try{frame=JSON.parse(String(raw));}catch{fail();return;}
   if(frame.streamId!==streamId)return;
   if(frame.type==='error'||frame.type==='end'){fail();return;}
   if(frame.type!=='item'||!frame.value)return;
   const value=frame.value;
   if(snapshot&&value.type==='snapshot'){ready=true;detach();resolve(value);return;}
   if(!snapshot&&value.type==='ready'){ready=true;clientId=value.clientId;clearTimeout(timer);resolve(detach);return;}
   if(!snapshot&&ready){const handled=onEvent(value);if(value.type==='waterfall'&&handled!==true&&nextEvent)void Promise.resolve(nextEvent(clientId,value.eventId)).catch(()=>{});}
  });
  ws.on('error',fail);ws.on('close',()=>{if(!closed)fail();});
 });
}
