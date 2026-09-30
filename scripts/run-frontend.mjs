import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..'); const logs=path.join(root,'.local','logs'); fs.mkdirSync(logs,{recursive:true}); const out=path.join(logs,'frontend.log');
function rotate(){try{if(fs.statSync(out).size>5*1024*1024)fs.renameSync(out,`${out}.${Date.now()}`)}catch{}}
function write(event,extra={}){rotate();fs.appendFileSync(out,JSON.stringify({at:new Date().toISOString(),pid:process.pid,event,...extra})+'\n')}
const vite=path.join(root,'node_modules','vite','bin','vite.js'); const child=spawn(process.execPath,[vite,'--config','frontend/vite.config.mjs','--host','127.0.0.1','--port','5178'],{cwd:root,env:process.env,stdio:['ignore','pipe','pipe']});
write('started',{childPid:child.pid,port:5178}); child.stdout.on('data',chunk=>fs.appendFileSync(out,chunk)); child.stderr.on('data',chunk=>fs.appendFileSync(out,chunk)); child.on('exit',(code,signal)=>write('exited',{childPid:child.pid,code,signal}));
const stop=signal=>{write('stopping',{childPid:child.pid,signal});child.kill(signal)};process.on('SIGINT',()=>stop('SIGINT'));process.on('SIGTERM',()=>stop('SIGTERM'));
