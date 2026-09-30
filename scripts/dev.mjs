import { spawn } from 'node:child_process';
const children = [
  [process.execPath,['scripts/run-backend.mjs']],
  [process.execPath,['scripts/run-frontend.mjs']]
].map(([command,args]) => spawn(command,args,{stdio:'inherit',env:process.env}));
function stop(signal){for(const child of children) child.kill(signal);}
process.on('SIGINT',()=>stop('SIGINT')); process.on('SIGTERM',()=>stop('SIGTERM'));
let exited=0; for(const child of children) child.on('exit',()=>{if(++exited===children.length) process.exit(0);});
