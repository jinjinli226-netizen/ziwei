import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {redactSecrets} from '../src/redaction.mjs';

/** Observer lives outside the business child and records forced child exits. */
export function observeNativeProcess({entry,args=[],cwd,env=process.env,directory,name,healthUrl,heartbeatMs=10000}={}) {
  fs.mkdirSync(directory,{recursive:true});const instance=`${name}-${Date.now()}-${randomUUID().slice(0,8)}`,file=path.join(directory,instance+'.jsonl'),stateFile=path.join(directory,name+'-observer-state.json');
  function append(value){if(fs.existsSync(file)&&fs.statSync(file).size>5*1024*1024){for(let i=4;i>=1;i--)if(fs.existsSync(file+'.'+i))fs.renameSync(file+'.'+i,file+'.'+(i+1));fs.renameSync(file,file+'.1');}fs.appendFileSync(file,redactSecrets(JSON.stringify({at:new Date().toISOString(),instance,observerPid:process.pid,...value}))+'\n');}
  try{const previous=JSON.parse(fs.readFileSync(stateFile));if(previous.state==='running')append({event:'previous_unclean_exit',previous,lastKnownOnly:true});}catch{}
  const child=spawn(process.execPath,[entry,...args],{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const save=state=>fs.writeFileSync(stateFile,JSON.stringify({instance,pid:child.pid,observerPid:process.pid,state,lastSeen:new Date().toISOString()}));
  save('running');append({event:'started',pid:child.pid,parentPid:process.pid,entry,heartbeatMs,healthUrl:healthUrl||null});
  child.stdout.on('data',bytes=>append({event:'stdout',pid:child.pid,text:String(bytes)}));child.stderr.on('data',bytes=>append({event:'stderr',pid:child.pid,text:String(bytes)}));child.on('error',error=>append({event:'spawn_error',pid:child.pid,error:error.stack}));
  const timer=setInterval(async()=>{save('running');let health=null;try{if(healthUrl)health=(await fetch(healthUrl,{signal:AbortSignal.timeout(2000),redirect:'error'})).status;}catch{health='unreachable';}append({event:'heartbeat',pid:child.pid,processAlive:child.exitCode===null,health,heartbeatMs});},heartbeatMs);
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>{clearInterval(timer);save('exited');append({event:'exit_observed',pid:child.pid,code,signal:signal||null});resolve({code,signal,pid:child.pid,log:file});}));
  return {child,exited,log:file,instance};
}
