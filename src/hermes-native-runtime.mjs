import fs from 'node:fs';
import path from 'node:path';
import {createHermesExecutionOverlay,hermesMcpSpawnSpec,hermesProfileHome,discoverInstalledRuntimes} from './runtime-adapters.mjs';
import {prepareHermesBotHome} from './hermes-bot-runtime.mjs';
import {spawnSupervisedRuntime} from './runtime-process.mjs';

export function nativeSpawn({context,baseHome,privateDirectory,workspace,apiBase,binary,env={},worker=false,cwd=process.cwd()}={}) {
  const profile=context.sourceProfile || 'default';
  const prepared=prepareHermesBotHome({context,sourceHome:hermesProfileHome(profile,{baseHome}),privateDirectory,workspace,apiBase});
  const overlay=createHermesExecutionOverlay({profile,baseHome,managedDirectory:env.HERMES_MANAGED_DIR,privateDirectory:path.join(privateDirectory,'overlays')});
  const childEnv={...process.env,...env,HERMES_HOME:overlay.sourceHome,HERMES_MANAGED_DIR:overlay.home,...prepared.env,HERMES_KANBAN_HOME:prepared.home,HERMES_KANBAN_DB:path.join(prepared.home,'kanban.db')};
  const launcher=binary || discoverInstalledRuntimes().runtimes.Hermes?.binary;
  if(!launcher){overlay.cleanup();throw new Error('目标电脑未发现 Hermes CLI');}
  try {const spec=hermesMcpSpawnSpec(launcher,['--profile',profile],{env:childEnv});spec.args.splice(spec.modeInsertIndex??5,0,worker?'--gateway-worker':'--native-operation');return{...spec,env:childEnv,cwd,prepared,cleanup:overlay.cleanup};}
  catch(error){overlay.cleanup();throw error;}
}

/** A bounded native operation, under the same Windows Job supervision as turns. */
export async function executeHermesNative(options={}) {
  if(options.beforeSpawn)await options.beforeSpawn();
  const spec=nativeSpawn(options),signal=options.signal;
  const supervision=spawnSupervisedRuntime(spec),{child}=supervision;
  options.onSupervision?.(supervision);
  let output='',bytes=0,exceeded=false;
  const abort=()=>void supervision.stop();
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  child.on('error',()=>{});
  child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>9*1024*1024){exceeded=true;abort();}else output+=String(chunk);});
  // Native diagnostics can contain provider request bodies. Keep only a code.
  child.stderr.on('data',()=>{});
  child.stdin.end(JSON.stringify({...options.operation,context:options.context})+'\n');
  let evidence;
  try{evidence=await supervision.completionEvidence;}
  finally{signal?.removeEventListener('abort',abort);spec.cleanup();}
  if(process.platform==='win32'&&(!evidence.rootConfirmed||!evidence.treeConfirmed))return{status:'failed',code:'EXECUTION_UNCERTAIN',executionState:'uncertain',error:'原生操作进程终态未确认',result:{code:'EXECUTION_UNCERTAIN',executionState:'uncertain',processExit:evidence}};
  const line=output.split(/\r?\n/).find(item=>item.startsWith('ZIWEI_NATIVE_RESULT:'));
  const mutates=!['read','list','search','status','inspect','hub_search','check_updates','configure','enable','disable'].includes(options.operation.operation);
  const missingReceipt=()=>({status:'failed',...(mutates&&evidence.launched!==false?{code:'EXECUTION_UNCERTAIN',executionState:'uncertain'}:{}),error:'原生操作没有可验证回执；请核对原 action 和原生状态',result:{code:mutates&&evidence.launched!==false?'EXECUTION_UNCERTAIN':'NATIVE_OPERATION_REJECTED',processExit:evidence}});
  if(!line||evidence.rootExitCode!==0||exceeded)return missingReceipt();
  let receipt;try{receipt=JSON.parse(line.slice('ZIWEI_NATIVE_RESULT:'.length));}catch{return missingReceipt();}
  if(receipt.employeeId!==options.context.employeeId||receipt.revision!==options.context.revision)return missingReceipt();
  return{status:receipt.status==='failed'?'failed':'succeeded',...(receipt.status==='failed'?{error:receipt.code}:{}),...(receipt.code==='EXECUTION_UNCERTAIN'?{code:'EXECUTION_UNCERTAIN',executionState:'uncertain'}:{}),result:{nativeOperation:receipt,...(receipt.code==='EXECUTION_UNCERTAIN'?{code:'EXECUTION_UNCERTAIN',executionState:'uncertain'}:{}),processExit:evidence,botIsolation:spec.prepared.receipt}};
}

/** Persistence here is process evidence only; resource data stays in Hermes. */
export function appendNativeLifecycle(home,event) {
  const directory=path.join(home,'logs');fs.mkdirSync(directory,{recursive:true});
  const file=path.join(directory,'ziwei-native-lifecycle.jsonl');
  if(fs.existsSync(file)&&fs.statSync(file).size>5*1024*1024){for(let i=4;i>=1;i--){const source=`${file}.${i}`,target=`${file}.${i+1}`;if(fs.existsSync(source)){if(fs.existsSync(target))fs.unlinkSync(target);fs.renameSync(source,target);}}if(fs.existsSync(`${file}.1`))fs.unlinkSync(`${file}.1`);fs.renameSync(file,`${file}.1`);}
  fs.appendFileSync(file,JSON.stringify({at:new Date().toISOString(),...event})+'\n',{mode:0o600});
}
