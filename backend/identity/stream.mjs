/** Native push transports revalidate before every payload and heartbeat. The
 * bounded queue serializes refresh/introspection and closes on any failure. */
export function createAuthorizedStream({authorize,deliver,close,maxPending=128}){
 let chain=Promise.resolve(),pending=0,closed=false;
 const stop=()=>{if(closed)return;closed=true;close();};
 return {close:stop,send(value){
  if(closed)return Promise.resolve();if(++pending>maxPending){pending--;stop();return Promise.resolve();}
  const flight=chain.then(async()=>{if(closed)return;try{await authorize();if(!closed)deliver(value);}catch{stop();}}).finally(()=>pending--);
  chain=flight.catch(stop);return chain;
 }};
}
