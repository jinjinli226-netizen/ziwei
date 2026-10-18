import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const localActionUrl=new URL('../src/local-action.mjs',import.meta.url);
const DEFAULT='C:\\Users\\fixture',SELECTED='D:\\employees\\知暖';

// Load the real executor with only its process/network boundaries replaced.
// Windows path parsing and existence checks remain the production implementation.
async function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-native-cwd-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const key='native-cwd-'+randomUUID(),calls=[];
  globalThis[key]={
    native:async options=>{calls.push({kind:'native',options});return{status:'succeeded'};},
    runtime:async options=>{calls.push({kind:'turn',options});return{status:'succeeded'};},
    group:async(_action,options,driver)=>{calls.push({kind:'group',options});return driver.runSource({payload:{prompt:'fixture group turn'}},{});},
    driver:async(_action,options,driver)=>{calls.push({kind:'driver',options});return driver.runTurn({prompt:'fixture native driver turn'},{});},
    gateway:async(_action,options)=>{calls.push({kind:'gateway',options});return{success:true};}
  };
  t.after(()=>{delete globalThis[key];});
  const boundary=`const f=globalThis[${JSON.stringify(key)}];`;
  const reject=`()=>{throw Error('Unexpected fixture boundary');}`;
  const stubs={
    './hermes-native-runtime.mjs':boundary+'export const executeHermesNative=f.native;',
    './hermes-gateway-runtime.mjs':boundary+'export const createBotGatewayManager=()=>({operate:f.gateway,maintenanceStatus:()=>({}),close:async()=>{}});',
    './execution-admission.mjs':`export const authorizeNativeExecution=async()=>({productState:'v2'}),assertNoOwnedBotResource=()=>{},createHermesExecutionGuard=${reject},PRODUCT_ROLE='v2';`,
    './hermes-group-runtime.mjs':boundary+'export const executeBotGroup=f.group;',
    './hermes-driver-runtime.mjs':boundary+'export const executeNativeDriver=f.driver;',
    './runtime-adapters.mjs':boundary+`export const executeRuntime=f.runtime,runtimeInvocation=${reject},bootstrapTerminalMcp=${reject},discoverInstalledRuntimes=${reject},hermesHome=()=>'/fixture-home',hermesProfileHome=${reject},validateHermesBotRuntimeSupervised=${reject};`,
    './hermes-owned-profile.mjs':`export const provisionHermesBotProfile=${reject};`,
    './management-bootstrap.mjs':`export const createManagementBootstrap=${reject};`,
    './conversation-image-artifacts.mjs':`export const createImageArtifactSession=${reject};`,
    './runtime-launch-evidence.mjs':'export const markBotStartAdmissionDenied=error=>error;'
  };
  const source=fs.readFileSync(localActionUrl,'utf8').replace(/from (['"])(\.[^'"]+)\1/g,(_all,_quote,specifier)=>{
    const target=stubs[specifier]===undefined?new URL(specifier,localActionUrl).href:'data:text/javascript,'+encodeURIComponent(stubs[specifier]);
    return `from ${JSON.stringify(target)}`;
  });
  const {createLocalActionExecutor}=await import('data:text/javascript,'+encodeURIComponent(source));
  const oldPlatform=Object.getOwnPropertyDescriptor(process,'platform');
  Object.defineProperty(process,'platform',{...oldPlatform,value:'win32'});
  t.after(()=>Object.defineProperty(process,'platform',oldPlatform));
  const realStat=fs.statSync,realpath=fs.realpathSync.native;
  const directories=new Set(['C:\\','D:\\',DEFAULT,SELECTED,path.win32.join(SELECTED,'nested')]);
  const isWindows=value=>/^[A-Za-z]:[\\/]/.test(String(value));
  t.mock.method(fs,'statSync',(value,...args)=>{
    if(!isWindows(value))return realStat(value,...args);
    if(!directories.has(path.win32.normalize(value)))throw Object.assign(Error('fixture directory missing'),{code:'ENOENT'});
    return{isDirectory:()=>true};
  });
  t.mock.method(fs.realpathSync,'native',(value,...args)=>isWindows(value)?path.win32.normalize(value):realpath(value,...args));
  t.mock.method(globalThis,'fetch',async()=>{throw Error('This fixture must not make network requests');});
  const execute=createLocalActionExecutor({runtimeDir:path.join(root,'runtime'),defaultWorkdir:DEFAULT});
  const action=(operation,extra={})=>({id:'action_'+randomUUID(),type:'hermes.bot.native',payload:{
    nativeOperation:operation,hermesBot:{config:{permissions:{mode:'read_only'}}},...extra
  }});
  return{execute,action,calls};
}

test('native Bot operation uses its validated D cwd instead of the computer default',async t=>{
  const f=await fixture(t);
  await f.execute(f.action({resource:'mcp',operation:'inspect',input:{}},{workdir:DEFAULT,cwd:SELECTED}));
  assert.deepEqual(f.calls.map(({kind,options})=>[kind,options.cwd]),[['native',SELECTED]]);
});

test('group and native driver source turns keep the same selected D cwd',async t=>{
  const f=await fixture(t);
  await f.execute(f.action({resource:'groups',operation:'step',input:{}},{workdir:SELECTED,cwd:SELECTED}));
  await f.execute(f.action({resource:'heartbeat',operation:'step',input:{}},{workdir:DEFAULT,cwd:SELECTED}));
  assert.deepEqual(f.calls.map(({kind,options})=>[kind,options.cwd]),[
    ['group',SELECTED],['turn',SELECTED],['driver',SELECTED],['turn',SELECTED]
  ]);
});

test('Gateway operation receives the selected cwd too',async t=>{
  const f=await fixture(t);
  await f.execute(f.action({resource:'gateway',operation:'connect',input:{}},{cwd:SELECTED}));
  assert.deepEqual(f.calls.map(({kind,options})=>[kind,options.cwd]),[['gateway',SELECTED]]);
});

test('missing native cwd keeps the original default and relative cwd resolves from its workdir',async t=>{
  const f=await fixture(t),operation={resource:'mcp',operation:'inspect',input:{}};
  await f.execute(f.action(operation));
  await f.execute(f.action(operation,{workdir:SELECTED,cwd:'nested'}));
  assert.deepEqual(f.calls.map(({options})=>options.cwd),[DEFAULT,path.win32.join(SELECTED,'nested')]);
});

test('invalid native D directory fails before every execution boundary without fallback',async t=>{
  const f=await fixture(t);
  for(const operation of [
    {resource:'mcp',operation:'inspect',input:{}},
    {resource:'groups',operation:'step',input:{}},
    {resource:'heartbeat',operation:'step',input:{}},
    {resource:'gateway',operation:'connect',input:{}}
  ])await assert.rejects(f.execute(f.action(operation,{cwd:'D:\\missing'})),/工作目录不存在/);
  await assert.rejects(f.execute(f.action({resource:'mcp',operation:'inspect',input:{}},{cwd:'\\\\server\\share'})),/本地盘符路径/);
  assert.equal(f.calls.length,0);
});
