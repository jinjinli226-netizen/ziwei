import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const logs = path.join(root, '.local', 'logs');
fs.mkdirSync(logs, { recursive:true });
function rotate(file) { try { if (fs.statSync(file).size > 5 * 1024 * 1024) fs.renameSync(file, `${file}.${Date.now()}`); } catch {} }
function write(file,event,extra={}) { const target=path.join(logs,file); rotate(target); fs.appendFileSync(target, JSON.stringify({at:new Date().toISOString(),pid:process.pid,event,...extra})+'\n'); }
function launch(name, script, args=[]) {
  const out = path.join(logs, `${name}.log`); rotate(out); const child = spawn(process.execPath,[script,...args],{cwd:root,env:process.env,stdio:['ignore','pipe','pipe']});
  write(`${name}.log`,'started',{childPid:child.pid,script,port:name==='backend'?4178:5178});
  child.stdout.on('data',chunk=>fs.appendFileSync(out,chunk)); child.stderr.on('data',chunk=>fs.appendFileSync(out,chunk));
  child.on('exit',(code,signal)=>write(`${name}.log`,'exited',{childPid:child.pid,code,signal}));
  const stop=signal=>{ write(`${name}.log`,'stopping',{childPid:child.pid,signal}); child.kill(signal); };
  process.on('SIGINT',()=>stop('SIGINT')); process.on('SIGTERM',()=>stop('SIGTERM'));
  return child;
}
launch('backend','backend/server.mjs');
