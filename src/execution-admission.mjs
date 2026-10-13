import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
export const PRODUCT_ROLE='v2';
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
export function executionBinding(action){return createHash('sha256').update(canonical({id:action.id,type:action.type,workspaceId:action.workspace_id||action.workspaceId||null,taskId:action.task_id||action.taskId||null,payload:action.payload||{}})).digest('hex');}
export function assertNoOwnedBotResource(action,{hermesHome,protectedHomes=[],runtimeDir,defaultWorkdir}={}) {
  const p=action.payload||{},base=p.env?.HERMES_HOME||p.hermesHome||p.hermesHomePath||hermesHome;
  const profile=p.profile||p.profileName||p.profile_name||p.runtimeProfile||p.runtime_profile||p.hermesProfile||p.hermes_profile||'default';
  const nativeCwd=['runtime.execute','agent.execute','conversation.execute','task.execute','automation.execute'].includes(action.type)?p.cwd||p.workdir||defaultWorkdir:null;
  const targetBase=['file.write','file.read'].includes(action.type)?runtimeDir||process.cwd():p.workdir||defaultWorkdir||process.cwd();
  const resources=[base&&(profile==='default'?base:path.join(base,'profiles',profile)),p.home,p.cwd,nativeCwd,p.path,p.filePath,p.destination,p.filename,p.directory,p.workingDirectory,p.working_directory,['file.write','file.read'].includes(action.type)?p.name:null,p.name&&['hermes.profile.create','profile.create'].includes(action.type)&&base&&path.join(base,'profiles',p.name)].filter(value=>typeof value==='string').map(value=>path.resolve(targetBase,value));
  const roots=protectedHomes.map(home=>{try{return fs.realpathSync.native(home);}catch{throw Object.assign(new Error('封存 HOME 不可核验'),{code:'EXECUTION_ADMISSION_REFUSED',definitelyNotStarted:true});}});
  for(const resource of resources){let directory=path.resolve(resource);
    while(!fs.existsSync(directory)){const parent=path.dirname(directory);if(parent===directory)break;directory=parent;}
    try{directory=fs.realpathSync.native(directory);if(!fs.statSync(directory).isDirectory())directory=path.dirname(directory);}catch{continue;}
    if(roots.some(root=>{const relative=path.relative(root,directory);return relative===''||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);}))throw Object.assign(new Error('实际目标属于封存 Bot HOME'),{code:'V2_OBJECT_SEALED',definitelyNotStarted:true});
    while(true){const file=path.join(directory,'ziwei-instance.json');
      if(fs.existsSync(file)){let marker;try{marker=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw Object.assign(new Error('原生资源身份不可读，禁止执行'),{code:'EXECUTION_ADMISSION_REFUSED',definitelyNotStarted:true});}
        if(marker.templateId==='ziwei-hermes-bot')throw Object.assign(new Error('此本机资源属于封存 Bot，禁止通过 Profile 或路径别名执行'),{code:'V2_OBJECT_SEALED',definitelyNotStarted:true});
      }
      const parent=path.dirname(directory);if(parent===directory)break;directory=parent;
    }
  }
}
export async function authorizeNativeExecution(action,{apiBase,workspace,deviceId,deviceToken,signal,hermesHome,runtimeDir,defaultWorkdir}={}) {
  const refused=(message,code='EXECUTION_ADMISSION_REFUSED')=>Object.assign(new Error(message),{code,definitelyNotStarted:true});
  if(PRODUCT_ROLE==='v1-compat'&&(String(action.type).startsWith('hermes.bot.')||action.payload?.hermesBot))throw refused('V2 Bot 在 V1 兼容客户端中已封存','V2_OBJECT_SEALED');
  if(!apiBase&&!deviceToken){if(PRODUCT_ROLE==='v1-compat')throw refused('V1 兼容执行必须核对原服务器动作');return;}
  if(!apiBase||!deviceToken||!workspace||!deviceId)throw refused('缺少当前连接的原动作核验信息');
  const response=await fetch(`${String(apiBase).replace(/\/$/,'')}/a2a/v1/actions/${encodeURIComponent(action.id)}/execution-admission`,{method:'POST',headers:{'content-type':'application/json','x-ziwei-device-token':deviceToken},body:JSON.stringify({workspace}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000),redirect:'error'});
  const value=await response.json();if(!response.ok||value.allowed!==true||value.actionId!==action.id||value.executionBinding!==executionBinding(action))throw refused(value.error||'原动作身份或执行许可不一致',value.code||'EXECUTION_ADMISSION_REFUSED');
  if(PRODUCT_ROLE==='v1-compat'||['preparing','sealed'].includes(value.productState))assertNoOwnedBotResource(action,{hermesHome,protectedHomes:value.protectedHomes||[],runtimeDir,defaultWorkdir});
  return value;
}
