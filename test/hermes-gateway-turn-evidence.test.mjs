import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const marker='ZIWEI_HERMES_GATEWAY_TURN:';
function rewrite(source,url,overrides={}) {
  return source.replaceAll('import.meta.url',JSON.stringify(url.href)).replace(/from (['"])([^'"\r\n]+)\1/g,(_all,_quote,specifier)=>'from '+JSON.stringify(overrides[specifier]|| (specifier.startsWith('.')?new URL(specifier,url).href:specifier.startsWith('node:')?specifier:import.meta.resolve(specifier))));
}
async function fixture(t,{native=false}={}) {
  const root=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-gateway-turn-')));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const home=path.join(root,'home'),selected=path.join(home,'profiles','atlas');
  fs.mkdirSync(selected,{recursive:true});
  fs.writeFileSync(path.join(home,'config.yaml'),'model:\n  provider: ollama\n  default: fixture\n');
  fs.writeFileSync(path.join(selected,'config.yaml'),'model:\n  provider: ollama\n  default: fixture\n');
  const entry=path.join(root,'fixture.cjs');
  fs.writeFileSync(entry,`const fs=require('node:fs');let input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',()=>{
const mode=process.env.FIXTURE_MODE,home=process.env.HERMES_HOME;
const proof={schemaVersion:1,source:'native_gateway',actionId:process.env.ZIWEI_GATEWAY_ACTION_ID,employeeId:process.env.ZIWEI_GATEWAY_EMPLOYEE_ID,profileHome:home,sessionId:'local-fixture',inputId:'input-fixture',admissionId:'admission-fixture',authorityEpoch:1,executionGeneration:3,phase:'cleanup',status:'terminal',outcome:'completed',cancelRequested:false,verified:true};
const emit=value=>process.stderr.write(${JSON.stringify(marker)}+JSON.stringify(value)+'\\n');
if(mode==='binding') {console.log(JSON.stringify({type:'result',text:JSON.stringify({actionId:proof.actionId,employeeId:proof.employeeId,profileHome:home,botActionId:process.env.ZIWEI_BOT_ACTION_ID||null,botToken:process.env.ZIWEI_BOT_DEVICE_TOKEN||null})}));return;}
if(mode==='unknown'||mode==='unknown-no-ack') {if(mode==='unknown')emit({...proof,phase:'admission',status:'started',outcome:null});const receipt={...proof,status:'unknown',outcome:null,verified:false,...(mode==='unknown-no-ack'?{admissionId:null,executionGeneration:null}:{})};process.stderr.write(${JSON.stringify(marker)}+JSON.stringify(receipt));}
else if(mode==='admission-only')emit({...proof,phase:'admission',status:'queued',outcome:null,executionGeneration:null});
else if(mode==='failed')emit({...proof,outcome:'interrupted'});
else if(mode==='terminal-failed-zero')emit({...proof,outcome:'failed'});
else if(mode==='queued-completed'){emit({...proof,phase:'admission',status:'queued',outcome:null,executionGeneration:null});emit(proof);}
else if(mode==='stdout')console.log(${JSON.stringify(marker)}+JSON.stringify({...proof,status:'unknown',outcome:null,verified:false}));
else if(mode==='wrong-action')emit({...proof,actionId:'action-other',status:'unknown',outcome:null,verified:false});
else if(mode==='wrong-home')emit({...proof,profileHome:home+'-other',status:'unknown',outcome:null,verified:false});
else if(mode==='wrong-employee')emit({...proof,employeeId:'employee-other',status:'unknown',outcome:null,verified:false});
else if(mode==='wrong-source')emit({...proof,source:'model_output',status:'unknown',outcome:null,verified:false});
else if(mode==='mismatched-cleanup'){emit({...proof,phase:'admission',status:'started',outcome:null});emit({...proof,admissionId:'admission-other'});}
else if(mode==='all-turns'){emit({...proof,phase:'admission',status:'started',outcome:null});emit({...proof,sessionId:'local-second',inputId:'input-second',admissionId:'admission-second'});}
else emit({...proof,prompt:'PRIVATE_PROMPT',api_key:'PRIVATE_KEY'});
console.log(JSON.stringify({type:'result',text:'fixture answer',session_id:proof.sessionId,gatewayTurns:[{...proof,status:'unknown'}]}));
if(mode==='failed'||mode==='completed-cli-failed')process.exitCode=1;
});`);
  let binary=process.execPath;
  if(native) {
    const python=spawnSync(process.env.ZIWEI_TEST_PYTHON||'python',['-c','import sys;print(sys.executable)'],{encoding:'utf8',windowsHide:true});
    if(python.status!==0){t.skip('Native launcher fixture requires Python');return null;}
    const write=(name,text)=>fs.writeFileSync(path.join(root,'hermes_cli',name),text);
    fs.mkdirSync(path.join(root,'hermes_cli'));
    write('__init__.py','__version__="0.22.0"\n');
    write('managed_scope.py','import os\nHERMES_MANAGED_DIR=os.environ.get("HERMES_MANAGED_DIR")\n');
    write('mcp_startup.py','def _has_configured_mcp_servers():\n return False\n');
    write('config.py','import os\nfrom pathlib import Path\ndef load_config():\n return {}\ndef read_raw_config():\n return {}\ndef get_config_path():\n return Path(os.environ["HERMES_HOME"])/"config.yaml"\n');
    write('main.py',`import json,os,sys\nfrom pathlib import Path
def _apply_profile_override():
 if '--profile' in sys.argv:
  profile=sys.argv[sys.argv.index('--profile')+1];home=Path(os.environ['HERMES_HOME'])
  if profile!='default' and home.name!=profile:os.environ['HERMES_HOME']=str(home/'profiles'/profile)
_apply_profile_override()
def main():
 query=sys.stdin.read();assert query
 home=str(Path(os.environ['HERMES_HOME']).resolve())
 audit=os.environ.get('ZIWEI_MCP_AUDIT_FILE')
 if audit:Path(audit).write_text(json.dumps({'method':'initialize','ok':True})+'\\n')
 proof={'schemaVersion':1,'source':'native_gateway','actionId':os.environ['ZIWEI_GATEWAY_ACTION_ID'],'employeeId':os.environ['ZIWEI_GATEWAY_EMPLOYEE_ID'],'profileHome':home,'sessionId':'local-native-fixture','inputId':'input-native-fixture','admissionId':'admission-native-fixture','authorityEpoch':1,'executionGeneration':3,'phase':'cleanup','status':'terminal','outcome':'completed','cancelRequested':False,'verified':True}
 print(${JSON.stringify(marker)}+json.dumps(proof),file=sys.stderr,flush=True)
 print(json.dumps({'type':'result','text':'native fixture answer','session_id':proof['sessionId']}));return 0
`);
    binary=path.join(root,'hermes');fs.writeFileSync(binary,`#!"${python.stdout.trim()}"\nfrom hermes_cli.main import main\nif __name__=='__main__':\n raise SystemExit(main())\n`);fs.chmodSync(binary,0o755);
  }
  const url=new URL('../src/runtime-adapters.mjs',import.meta.url);
  const discovery=`export * from ${JSON.stringify(new URL('../src/runtime-cli-discovery.mjs',import.meta.url).href)};export const createCliDiscoveryContext=()=>({platform:process.platform,arch:process.arch});export const discoverRuntimeCli=({runtime})=>({status:runtime==='Hermes'?'available':'unavailable',binary:runtime==='Hermes'?${JSON.stringify(binary)}:null});`;
  const supervisor=`import {spawnSupervisedRuntime as original} from ${JSON.stringify(new URL('../src/runtime-process.mjs',import.meta.url).href)};export const spawnSupervisedRuntime=spec=>original({...spec,command:process.execPath,args:[${JSON.stringify(entry)}]});`;
  const source=rewrite(fs.readFileSync(url,'utf8'),url,{'./runtime-cli-discovery.mjs':'data:text/javascript,'+encodeURIComponent(discovery),...(!native?{'./runtime-process.mjs':'data:text/javascript,'+encodeURIComponent(supervisor)}:{})});
  t.mock.method(os,'homedir',()=>root);
  const adapters=await import('data:text/javascript,'+encodeURIComponent(source)+'#'+randomUUID());
  const env={HERMES_HOME:home,CODEX_HOME:path.join(root,'empty-codex'),...(native?{PYTHONPATH:root}:{}),ZIWEI_GATEWAY_ACTION_ID:'forged-action',ZIWEI_GATEWAY_EMPLOYEE_ID:'forged-employee',ZIWEI_BOT_ACTION_ID:'forged-bot-action',ZIWEI_BOT_DEVICE_TOKEN:'forged-device-token'};
  const execute=(mode,overrides={})=>adapters.executeRuntime({runtime:'Hermes',profile:'atlas',prompt:'fixture only',cwd:root,env:{...env,FIXTURE_MODE:mode},managementMcp:{actionId:'action-atlas',employeeId:'employee-atlas'},...overrides});
  return{root,home,selected,execute};
}

test('ordinary Atlas actions bind dedicated Gateway identity without managed Bot credentials',async t=>{
  const f=await fixture(t),execution=await f.execute('binding');
  assert.equal(execution.status,'succeeded',execution.error);
  assert.deepEqual(JSON.parse(execution.result.output),{actionId:'action-atlas',employeeId:'employee-atlas',profileHome:f.selected,botActionId:null,botToken:null});
});

test('ordinary named Atlas profile binds its actual HOME through the Python launcher and native MCP bootstrap',async t=>{
  const f=await fixture(t,{native:true});if(!f)return;
  const tokenFile=path.join(f.root,'management.json');
  fs.writeFileSync(tokenFile,JSON.stringify({workspace:'fixture',token:'synthetic-fixture-only'}));
  const execution=await f.execute('native',{managementMcp:{actionId:'action-atlas',employeeId:'employee-atlas',workspace:'fixture',apiBase:'https://fixture.invalid',config:{enabled:true,tokenFile},auditDirectory:path.join(f.root,'audit')}});
  assert.equal(execution.status,'succeeded',execution.error);
  assert.equal(execution.result.hermesBootstrap.mode,'effective-mcp-gate');
  assert.equal(execution.result.gatewayTurns[0].profileHome,f.selected);assert.equal(execution.result.gatewayTurns[0].sessionId,'local-native-fixture');
  assert.equal(execution.result.managementMcp.loaded,true);assert.equal(execution.result.botIsolation,undefined);
});

test('unbound executions clear inherited Gateway identities instead of trusting supplied environment',async t=>{
  const f=await fixture(t),execution=await f.execute('binding',{managementMcp:null});
  assert.equal(execution.status,'succeeded',execution.error);
  assert.deepEqual(JSON.parse(execution.result.output),{profileHome:f.selected,botActionId:null,botToken:null});
});

for(const mode of ['unknown','unknown-no-ack','admission-only','mismatched-cleanup','all-turns'])test(`Gateway ${mode} remains uncertain after its CLI tree has exited`,async t=>{
  const f=await fixture(t),execution=await f.execute(mode);
  assert.equal(execution.status,'failed');assert.equal(execution.code,'EXECUTION_UNCERTAIN');assert.equal(execution.executionState,'uncertain');
  assert.equal(execution.result.processExit.rootConfirmed,true);assert.equal(execution.result.processExit.treeConfirmed,true);assert.equal(execution.result.processExit.activeProcesses,0);assert.equal(execution.result.processExit.rootExitCode,0);
  assert.ok(execution.result.gatewayTurns.some(receipt=>receipt.status==='unknown'));
  assert.equal(execution.result.executionState,'uncertain');
});

test('a verified Gateway terminal receipt does not promote failed business execution',async t=>{
  const f=await fixture(t),execution=await f.execute('failed');
  assert.equal(execution.status,'failed');assert.equal(execution.code,'runtime_failed');
  assert.equal(execution.result.gatewayTurns[0].status,'terminal');assert.equal(execution.result.gatewayTurns[0].outcome,'interrupted');
  assert.equal(execution.result.processExit.rootExitCode,1);assert.notEqual(execution.executionState,'uncertain');
});

test('a completed Gateway receipt is projected without private native fields',async t=>{
  const f=await fixture(t),execution=await f.execute('completed');
  assert.equal(execution.status,'succeeded',execution.error);
  assert.equal(execution.result.gatewayTurns[0].sessionId,'local-fixture');assert.equal(execution.result.gatewayTurns[0].admissionId,'admission-fixture');
  assert.doesNotMatch(JSON.stringify(execution),/PRIVATE_PROMPT|PRIVATE_KEY/);
});

test('a terminal failed Gateway turn cannot be reported as successful from CLI exit zero',async t=>{
  const f=await fixture(t),execution=await f.execute('terminal-failed-zero');
  assert.equal(execution.status,'failed');assert.equal(execution.code,'runtime_failed');assert.equal(execution.result.processExit.rootExitCode,0);
});

test('completed Gateway cleanup cannot promote an existing CLI failure',async t=>{
  const f=await fixture(t),execution=await f.execute('completed-cli-failed');
  assert.equal(execution.status,'failed');assert.equal(execution.code,'runtime_failed');assert.equal(execution.result.gatewayTurns[0].outcome,'completed');
});

test('a queued admission may acquire its native generation before terminal cleanup',async t=>{
  const f=await fixture(t),execution=await f.execute('queued-completed');
  assert.equal(execution.status,'succeeded',execution.error);assert.equal(execution.result.gatewayTurns[0].executionGeneration,3);
});

for(const mode of ['stdout','wrong-action','wrong-home','wrong-employee','wrong-source'])test(`Gateway proof rejects ${mode} as authority`,async t=>{
  const f=await fixture(t),execution=await f.execute(mode);
  assert.equal(execution.status,'succeeded',execution.error);assert.equal(execution.result.gatewayTurns,undefined);
});

test('ordinary local action passes its employee identity beside the authoritative action ID',async t=>{
  const f=await fixture(t),key='gateway-options-'+randomUUID();
  globalThis[key]=null;t.after(()=>delete globalThis[key]);
  const runtimeUrl=new URL('../src/runtime-adapters.mjs',import.meta.url);
  const shim=`export * from ${JSON.stringify(runtimeUrl.href)};export const executeRuntime=async options=>{globalThis[${JSON.stringify(key)}]=options;return {status:'succeeded',result:{}};};`;
  const url=new URL('../src/local-action.mjs',import.meta.url),source=rewrite(fs.readFileSync(url,'utf8'),url,{'./runtime-adapters.mjs':'data:text/javascript,'+encodeURIComponent(shim)});
  const {createLocalActionExecutor}=await import('data:text/javascript,'+encodeURIComponent(source));
  const execute=createLocalActionExecutor({runtimeDir:path.join(f.root,'runtime'),defaultWorkdir:f.root,hermesHomePath:f.home,admissionHandledByDispatcher:true});
  await execute({id:'action-atlas',type:'conversation.execute',payload:{runtime:'Hermes',profile:'atlas',employeeId:'employee-atlas',prompt:'fixture only'}});
  assert.equal(globalThis[key].managementMcp.actionId,'action-atlas');assert.equal(globalThis[key].managementMcp.employeeId,'employee-atlas');assert.equal(globalThis[key].hermesBot,undefined);
});
