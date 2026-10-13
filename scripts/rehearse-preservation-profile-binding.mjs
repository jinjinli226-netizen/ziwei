import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {stringify} from 'yaml';
import {observeNativeProcess} from './preservation-diagnostics.mjs';
const project=path.resolve(import.meta.dirname,'..'),arg=name=>process.argv[process.argv.indexOf(name)+1];
const packages=path.resolve(arg('--packages')),root=path.join(project,'.local/preservation-profile-window','green-'+Date.now()),diagnostics=path.join(root,'diagnostics'),originalEnv={...process.env},originalFetch=globalThis.fetch;
const guard=path.join(root,'guard');fs.mkdirSync(guard,{recursive:true});
fs.writeFileSync(path.join(guard,'sitecustomize.py'),"import socket,ipaddress\n_c=socket.socket.connect\n_g=socket.getaddrinfo\ndef ok(h):\n try:return h in ('localhost',None) or ipaddress.ip_address(h).is_loopback\n except ValueError:return False\ndef c(s,a):\n if isinstance(a,tuple) and not ok(a[0]):raise RuntimeError('external forbidden')\n return _c(s,a)\ndef g(h,*a,**k):\n if not ok(h):raise RuntimeError('external DNS forbidden')\n return _g(h,*a,**k)\nsocket.socket.connect=c\nsocket.getaddrinfo=g\n");
Object.assign(process.env,{PYTHONPATH:guard,PYTHONDONTWRITEBYTECODE:'1',PYTHONUTF8:'1',NO_PROXY:'127.0.0.1,localhost',REHEARSAL_PROVIDER_PORT:'6389'});
fs.appendFileSync(path.join(guard,'sitecustomize.py'),"import os,sys,time\nfrom pathlib import Path\n_release=os.environ.get('PROFILE_REHEARSAL_RELEASE')\nif _release and '--launcher' in sys.argv:\n Path(_release+'.entered').write_text('entered')\n for _n in range(900):\n  if Path(_release).exists():break\n  time.sleep(.1)\n else:raise SystemExit('fixture barrier timeout')\n");
const tree=directory=>fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?tree(path.join(directory,entry.name)):({path:path.relative(root,path.join(directory,entry.name)),sha256:createHash('sha256').update(fs.readFileSync(path.join(directory,entry.name))).digest('hex')})).sort((a,b)=>a.path.localeCompare(b.path));
const cfg={model:{provider:'custom',default:'fixture-model',base_url:'http://127.0.0.1:6389/v1',api_mode:'chat_completions'},models_dev:{url:'http://127.0.0.1:6389/catalog'},mcp_servers:{}};
const rows=[];let provider;
try {
 provider=observeNativeProcess({entry:path.join(project,'test-support/preservation-provider.mjs'),cwd:root,env:process.env,directory:diagnostics,name:'profile-binding-provider',healthUrl:'http://127.0.0.1:6389/healthz'});
 let ready=false;for(let n=0;n<100;n++){try{ready=(await originalFetch('http://127.0.0.1:6389/healthz')).ok;if(ready)break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert.equal(ready,true);
 for(const role of ['v1-compat','v2']) {
  const installed=path.join(packages,role+'-installation-proof/node_modules/ziwei');
  const {createLocalActionExecutor}=await import(pathToFileURL(path.join(installed,'src/local-action.mjs')));
  const {executionBinding,createHermesExecutionGuard,PRODUCT_ROLE}=await import(pathToFileURL(path.join(installed,'src/execution-admission.mjs')));
  const {executeRuntime}=await import(pathToFileURL(path.join(installed,'src/runtime-adapters.mjs')));assert.equal(PRODUCT_ROLE,role);
  const stages=process.argv.includes('--stages')?arg('--stages').split(','):['management','terminal','beforeSpawn','nativeSelector','ordinary','ordinaryUpper','default','noManagement','tombstone'];
  for(const stage of stages) {
   const directory=path.join(root,role,stage),base=path.join(directory,'hermes'),runtime=path.join(directory,'runtime'),ordinary=path.join(base,'profiles/ordinary'),owned=path.join(base,'profiles/bot-owned'),alias=path.join(base,'profiles/ordinary-alias'),managed=path.join(directory,'managed');
   for(const home of [runtime,base,ordinary,owned,managed])fs.mkdirSync(home,{recursive:true});
   for(const home of [base,ordinary,owned]){fs.writeFileSync(path.join(home,'config.yaml'),stringify(cfg));fs.writeFileSync(path.join(home,'.env'),'OPENAI_API_KEY=loopback-fixture-only\nCUSTOM_API_KEY=loopback-fixture-only\n');fs.writeFileSync(path.join(home,'auth.json'),'{}');fs.writeFileSync(path.join(home,'.no-bundled-skills'),'');}
   fs.writeFileSync(path.join(owned,'ziwei-instance.json'),JSON.stringify({templateId:'ziwei-hermes-bot',mode:'owned_profile',employeeId:'profile-binding-fixture-owned',profile:'bot-owned'}));
   fs.writeFileSync(path.join(managed,'config.yaml'),stringify({auxiliary:{title_generation:{enabled:false},background_review:{enabled:false}},updates:{check:false}}));
   fs.symlinkSync(ordinary,alias,'junction');Object.assign(process.env,{HERMES_HOME:base,HERMES_MANAGED_DIR:managed});
   const action={id:`profile-binding-${role}-${stage}`,type:'runtime.execute',workspace:'test-111',payload:{runtime:'Hermes',profile:stage==='default'?'default':stage==='ordinaryUpper'?'OrDiNaRy-AlIaS':'ordinary-alias',model:'fixture-model',prompt:stage==='tombstone'?'--profile':'Bounded synthetic profile binding check',cwd:directory}};
   if(stage==='terminal')action.payload.terminalMcp={enabled:true,workspace:'test-111',employeeId:'employee_fixture',deviceId:'phone_fixture'};
   const before=tree(owned),ordinaryBefore=tree(ordinary),supervision=[],events=[],callsBefore=(await(await originalFetch('http://127.0.0.1:6389/healthz')).json()).calls;let result,error;
   const moveAlias=()=>{events.push({event:stage,from:fs.realpathSync.native(alias)});fs.unlinkSync(alias);fs.symlinkSync(owned,alias,'junction');events.push({event:'alias-now-owned',to:fs.realpathSync.native(alias)});};
   const swap=async()=>{await Promise.resolve();moveAlias();};
   const release=path.join(directory,'native-import-release');
   if(stage==='nativeSelector')process.env.PROFILE_REHEARSAL_RELEASE=release;else delete process.env.PROFILE_REHEARSAL_RELEASE;
   if(stage==='tombstone'){fs.mkdirSync(path.join(base,'profiles/.deleted'));fs.writeFileSync(path.join(base,'profiles/.deleted/ordinary-alias'),'deleted\n');}
   const onSupervision=value=>{supervision.push(value);if(stage==='nativeSelector'){moveAlias();fs.writeFileSync(release,'release');}};
   globalThis.fetch=async(url,options)=>{
    if(String(url).includes('/execution-admission'))return{ok:true,json:async()=>({allowed:true,actionId:action.id,executionBinding:executionBinding(action),productState:'sealed',protectedHomes:[owned]})};
    if(String(url).endsWith('/terminal-mcp/bootstrap')){await swap();return{ok:true,json:async()=>({token:'loopback-fixture-only',workspace:'test-111',employeeId:'employee_fixture',deviceId:'phone_fixture',actionId:action.id,expiresAt:new Date(Date.now()+60000).toISOString(),baseUrl:'http://127.0.0.1:6389/terminal-mcp/v1/workspaces/test-111/employees/employee_fixture'})};}
    return originalFetch(url,options);
   };
   const tokenFile=path.join(directory,'fixture-mcp-token');fs.writeFileSync(tokenFile,JSON.stringify({token:'loopback-fixture-only',workspaces:['test-111']}));
   const managementConfig={enabled:true,tokenFile,baseUrl:'http://127.0.0.1:6389',workspace:'test-111'};
   const bootstrap={async prepare(){if(stage==='management')await swap();return managementConfig;}};
   const noManagement=['noManagement','tombstone'].includes(stage);
   const executor=createLocalActionExecutor({runtimeDir:runtime,defaultWorkdir:directory,hermesHomePath:base,managementBootstrap:noManagement?{async prepare(){return {};}}:bootstrap,admissionHandledByDispatcher:true,apiBase:noManagement?null:'http://127.0.0.1:6389',workspace:noManagement?null:'test-111',deviceId:noManagement?null:'fixture',deviceToken:noManagement?null:'fixture'});
   try {
    if(stage==='beforeSpawn'){
     const executionGuard=createHermesExecutionGuard(action,{protectedHomes:[owned],runtimeDir:runtime,defaultWorkdir:directory});executionGuard.select({sourceHome:alias,profile:'ordinary-alias',baseHome:base});
     result=await executeRuntime({runtime:'Hermes',profile:'ordinary-alias',model:'fixture-model',prompt:action.payload.prompt,cwd:directory,env:{HERMES_HOME:base},executionGuard,beforeSpawn:swap,managementMcp:{config:managementConfig,workspace:'test-111',apiBase:'http://127.0.0.1:6389',auditDirectory:path.join(runtime,'audit'),actionId:action.id},signal:AbortSignal.timeout(90000),onSupervision});
    }else if(noManagement){
     const executionGuard=createHermesExecutionGuard(action,{protectedHomes:[owned],runtimeDir:runtime,defaultWorkdir:directory});executionGuard.select({sourceHome:alias,profile:'ordinary-alias',baseHome:base});
     result=await executeRuntime({runtime:'Hermes',profile:'ordinary-alias',model:'fixture-model',prompt:action.payload.prompt,cwd:directory,env:{HERMES_HOME:base},executionGuard,signal:AbortSignal.timeout(90000),onSupervision});
    }else{await executor.authorizeExecution(action);result=await executor(action,{signal:AbortSignal.timeout(90000),onSupervision});}
   }catch(value){error={code:value.code??null,message:value.message,definitelyNotStarted:value.definitelyNotStarted??null};}
   finally{await executor.close?.();globalThis.fetch=originalFetch;}
   const after=tree(owned),negative=['management','terminal','beforeSpawn'].includes(stage);
   const modelCalls=(await(await originalFetch('http://127.0.0.1:6389/healthz')).json()).calls-callsBefore;
   const overlayResidue=tree(runtime).filter(row=>/[\\/]execution-/.test(row.path));assert.equal(overlayResidue.length,0);
   const row={role,stage,status:result?.status||null,error,supervision:supervision.length,modelCalls,events,protectedBytesUnchanged:JSON.stringify(before)===JSON.stringify(after),ordinaryBytesUnchanged:JSON.stringify(ordinaryBefore)===JSON.stringify(tree(ordinary)),protectedBefore:before,protectedAfter:after,nativeBarrierEntered:fs.existsSync(release+'.entered'),overlayCleanupConfirmed:true,result};rows.push(row);
   console.log(JSON.stringify({role,stage,status:row.status,error,supervision:row.supervision,modelCalls,protectedBytesUnchanged:row.protectedBytesUnchanged}));
   assert.equal(row.protectedBytesUnchanged,true);
   if(negative){assert.equal(error?.code,'V2_OBJECT_SEALED');assert.equal(error.definitelyNotStarted,true);assert.equal(supervision.length,0);assert.equal(modelCalls,0);}else if(['nativeSelector','tombstone'].includes(stage)){assert.equal(result?.status,'failed');assert.equal(modelCalls,0);assert.equal(supervision.length,1);assert.equal(row.ordinaryBytesUnchanged,true);if(stage==='nativeSelector'){assert.equal(row.nativeBarrierEntered,true);assert.match(result.result.output,/V2_OBJECT_SEALED/);}}else{assert.equal(result?.status,'succeeded');assert.equal(supervision.length,1);assert.equal(result.result.profile,action.payload.profile);assert.ok(modelCalls>0);}
  }
 }
} finally {
 globalThis.fetch=originalFetch;if(provider){provider.child.kill('SIGTERM');await provider.exited;}
 for(const key of Object.keys(process.env))if(!Object.hasOwn(originalEnv,key))delete process.env[key];Object.assign(process.env,originalEnv);
 const receipt={scope:'installed candidate clients + installed Hermes + Windows Job + private synthetic HOME + loopback provider; admission and phone bootstrap responses are controlled fixtures, not real server admission evidence',packages,root,rows,providerClosed:true,productionApplied:false};fs.writeFileSync(path.join(root,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify({receipt:path.join(root,'receipt.json'),cases:rows.length}));
}
