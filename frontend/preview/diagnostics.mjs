import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {redactSecrets} from '../../src/redaction.mjs';
const secretKey=/^(?:password|token|secret|authorization|cookie|api[_-]?key|access[_-]?token|refresh[_-]?token)$/i;
function safeText(value){
  const text=String(value);
  if(/"(?:password|token|secret|authorization|cookie|api[_-]?key|access[_-]?token|refresh[_-]?token)"\s*:/i.test(text)){
    try{return JSON.stringify(JSON.parse(text),(key,item)=>secretKey.test(key)?'[REDACTED]':item);}
    catch{return '[sensitive structured output omitted]';}
  }
  return redactSecrets(text);
}

export function createPreviewLog(directory,name,{maxBytes=5*1024*1024}={}) {
  if(!/^[a-zA-Z0-9_.-]+$/.test(name))throw new Error('Invalid log name');
  const root=path.resolve(directory);fs.mkdirSync(root,{recursive:true});
  const file=path.join(root,`${name}.jsonl`);
  function rotate(){
    if(!fs.existsSync(file)||fs.statSync(file).size<maxBytes)return;
    const oldest=`${file}.5`;if(fs.existsSync(oldest))fs.unlinkSync(oldest);
    for(let index=4;index>=1;index--)if(fs.existsSync(`${file}.${index}`))fs.renameSync(`${file}.${index}`,`${file}.${index+1}`);
    fs.renameSync(file,`${file}.1`);
  }
  function write(event,extra={}){
    rotate();
    const row={at:new Date().toISOString(),event,observerPid:process.pid,parentPid:process.ppid,...extra};
    fs.appendFileSync(file,JSON.stringify(row,(key,value)=>secretKey.test(key)?'[REDACTED]':typeof value==='string'?safeText(value):value)+'\n');
  }
  return {file,write};
}

export function observeProcess({name,command,args,env=process.env,cwd=process.cwd(),log,port=null,healthUrl=null,intervalMs=15000,onHealth=null}) {
  const child=spawn(command,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  log.write('started',{name,childPid:child.pid,port,command,args,heartbeatIntervalMs:intervalMs});
  let stopped=false,busy=false,timer;
  const tick=async()=>{
    if(stopped||busy)return;busy=true;
    try{
      let health=null;
      if(healthUrl)try{const response=await fetch(healthUrl,{signal:AbortSignal.timeout(3000)});health={ok:response.ok,status:response.status};}catch(error){health={ok:false,error:error.code || error.name};}
      log.write('observer_heartbeat',{name,childPid:child.pid,port,health});
      onHealth?.({name,health});
    }finally{busy=false;}
  };
  function capture(stream,event){let pending='';stream.on('data',chunk=>{pending+=String(chunk);let newline;while((newline=pending.indexOf('\n'))>=0){log.write(event,{name,childPid:child.pid,text:pending.slice(0,newline)});pending=pending.slice(newline+1);}if(pending.length>65536){log.write(event,{name,childPid:child.pid,text:'[oversized partial output omitted]'});pending='';}});stream.on('end',()=>{if(pending)log.write(event,{name,childPid:child.pid,text:pending});});}
  capture(child.stdout,'stdout');capture(child.stderr,'stderr');
  const done=new Promise(resolve=>{
    child.once('error',error=>{stopped=true;clearInterval(timer);log.write('spawn_error',{name,error:error.message,stack:error.stack});resolve({code:null,signal:null,error:error.message});});
    child.once('exit',(code,signal)=>{stopped=true;clearInterval(timer);log.write('exited',{name,childPid:child.pid,port,code,signal});});
    child.once('close',(code,signal)=>resolve({code,signal}));
  });
  timer=setInterval(()=>void tick(),intervalMs);timer.unref();void tick();
  return {child,done};
}
