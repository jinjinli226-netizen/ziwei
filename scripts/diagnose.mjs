import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'); const dir=path.join(root,'.local','logs'); fs.mkdirSync(dir,{recursive:true}); const file=path.join(dir,'health.log');
const checks=[['backend','http://127.0.0.1:4178/healthz'],['frontend','http://127.0.0.1:5178/']];
function write(event,extra={}){fs.appendFileSync(file,JSON.stringify({at:new Date().toISOString(),pid:process.pid,event,...extra})+'\n')}
async function check(){for(const [name,url] of checks){try{const started=Date.now();const res=await fetch(url,{signal:AbortSignal.timeout(2500)});write('health',{service:name,url,status:res.status,ok:res.ok,latencyMs:Date.now()-started});}catch(error){write('health',{service:name,url,ok:false,error:error.message});}}}
await check();
if (process.argv.includes('--once')) { process.exitCode = 0; } else { setInterval(check,15000); write('monitor_started',{intervalMs:15000,services:checks.map(x=>x[0])}); }
