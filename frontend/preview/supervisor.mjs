import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {execFileSync} from 'node:child_process';
import {createPreviewLog,observeProcess} from './diagnostics.mjs';
import {previewStateDirectory} from './state-root.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const directory=previewStateDirectory(root);
const home=path.join(directory,'runtime-home');fs.mkdirSync(home,{recursive:true});
const apiPort=Number(process.env.ZIWEI_PREVIEW_API_PORT || 4283),frontendPort=Number(process.env.ZIWEI_PREVIEW_FRONTEND_PORT || 5283);
const instance=new Date().toISOString().replace(/[:.]/g,'-')+'-'+process.pid;
const log=createPreviewLog(path.join(directory,'logs'),`supervisor-${instance}`);
const stateFile=path.join(directory,'active-instance.json');
const previous=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):null;
if(previous&&!previous.endedAt){
  let alive=false;try{process.kill(previous.supervisorPid,0);alive=true;}catch{}
  if(alive)throw new Error('Existing preview supervisor is alive; reuse the current preview');
  log.write('previous_unclean_exit',{instance:previous.instance,supervisorPid:previous.supervisorPid,lastStartedAt:previous.startedAt});
}
if(previous){const history=path.join(directory,'instances');fs.mkdirSync(history,{recursive:true});const file=path.join(history,`${previous.instance}.json`);if(!fs.existsSync(file))fs.writeFileSync(file,JSON.stringify(previous,null,2),{flag:'wx'});}
async function checkPort(port){if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid preview port');await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(port,'127.0.0.1',()=>probe.close(resolve));});}
await checkPort(apiPort);await checkPort(frontendPort);
const env={...process.env};
for(const key of Object.keys(env))if(/^(ZIWEI_|CONTROL_MCP_|HERMES_|OPENAI_|ANTHROPIC_|GEMINI_|GOOGLE_|CODEX_HOME$)|(?:_KEY|_TOKEN|_SECRET|PASSWORD)$|^(?:HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NODE_OPTIONS|PYTHONPATH)$/.test(key))delete env[key];
Object.assign(env,{HOME:home,USERPROFILE:home,APPDATA:path.join(home,'AppData/Roaming'),LOCALAPPDATA:path.join(home,'AppData/Local'),CODEX_HOME:path.join(home,'codex'),HERMES_HOME:path.join(home,'.hermes'),ZIWEI_PREVIEW_DATA_ROOT:directory,ZIWEI_PREVIEW_API_PORT:String(apiPort),ZIWEI_PREVIEW_FRONTEND_PORT:String(frontendPort),ZIWEI_PREVIEW_INSTANCE:instance,ZIWEI_A2A_TOKEN_FILE:path.join(directory,'data/a2a.token'),FRONTEND_ORIGIN:`http://127.0.0.1:${frontendPort}`,VITE_API_URL:`http://127.0.0.1:${apiPort}`,VITE_ZIWEI_PREVIEW:'true',VITE_ZIWEI_NATIVE_PREVIEW:'true'});
let state=null;const healthStates={};
function onHealth({name,health}){healthStates[name]=health;if(state&&healthStates.backend?.ok&&healthStates.frontend?.ok&&state.phase!=='ready'){state.phase='ready';state.readyAt=new Date().toISOString();fs.writeFileSync(stateFile,JSON.stringify(state,null,2));log.write('preview_ready',{url:state.url});}}
const backend=observeProcess({name:'backend',command:process.execPath,args:['frontend/preview/backend.mjs'],cwd:root,env,log,port:apiPort,healthUrl:`http://127.0.0.1:${apiPort}/__preview/health`,onHealth});
const frontend=observeProcess({name:'frontend',command:process.execPath,args:['node_modules/vite/bin/vite.js','--config','frontend/vite.config.mjs','--host','127.0.0.1','--port',String(frontendPort),'--strictPort'],cwd:root,env,log,port:frontendPort,healthUrl:`http://127.0.0.1:${frontendPort}/`,onHealth});
let candidate=null;try{candidate=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim();}catch{}
state={phase:'starting',instance,supervisorPid:process.pid,backendPid:backend.child.pid,frontendPid:frontend.child.pid,apiPort,frontendPort,url:`http://127.0.0.1:${frontendPort}/preview-bots/bots`,startedAt:new Date().toISOString(),candidate,root,stateRoot:directory,database:path.join(directory,'data/preview.sqlite'),runtimeHome:home,fixtureDevices:true,realHermes:true,localTestProvider:true,log:log.file};
fs.writeFileSync(stateFile,JSON.stringify(state,null,2));log.write('preview_processes_started',state);
process.on('uncaughtExceptionMonitor',error=>log.write('supervisor_exception',{error:error.message,stack:error.stack}));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{log.write('preview_stop_requested',{signal});backend.child.kill(signal);frontend.child.kill(signal);});
process.on('exit',code=>log.write('supervisor_exit',{code}));
const first=await Promise.race([backend.done.then(result=>({name:'backend',result})),frontend.done.then(result=>({name:'frontend',result}))]);
log.write('preview_child_ended',{...first,action:'close_other_preview_child'});
if(first.name==='backend'&&frontend.child.exitCode===null)frontend.child.kill('SIGTERM');
if(first.name==='frontend'&&backend.child.exitCode===null)backend.child.kill('SIGTERM');
const exits=await Promise.all([backend.done,frontend.done]);
state.phase='ended';state.endedAt=new Date().toISOString();state.exits=exits;fs.writeFileSync(stateFile,JSON.stringify(state,null,2));log.write('preview_ended',{exits});
