import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {executeRuntime,hermesMcpSpawnSpec,prepareManagementMcpLaunch,resetRuntimeDiscovery,runtimeInvocation} from '../src/runtime-adapters.mjs';

function fixture(t) {
  const python=spawnSync('python3',['-c','import sys;print(sys.executable)'],{encoding:'utf8'});
  if(python.status!==0){t.skip('Isolated Hermes fixture requires Python');return null;}
  const root=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-hermes-query-')));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const write=(name,text)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);return file;};
  write('hermes_cli/__init__.py','__version__="0.22.0"\n');
  write('hermes_cli/managed_scope.py','import os\nHERMES_MANAGED_DIR=os.environ.get("HERMES_MANAGED_DIR")\n');
  write('hermes_cli/mcp_startup.py','def _has_configured_mcp_servers():\n return False\n');
  write('hermes_cli/config.py','def load_config():\n return {}\ndef read_raw_config():\n return {}\n');
  write('hermes_cli/main.py',`import argparse,json,os,sys
from pathlib import Path
def main():
 p=argparse.ArgumentParser();p.add_argument('--profile');p.add_argument('--yolo',action='store_true');p.add_argument('-z');p.add_argument('--model');p.add_argument('--toolsets');commands=p.add_subparsers(dest='command')
 chat=commands.add_parser('chat');chat.add_argument('--query-file');chat.add_argument('--format');chat.add_argument('--model');chat.add_argument('--toolsets');args=p.parse_args()
 if args.command!='chat':
  print('stdin is not a tty',file=sys.stderr);return 0
 assert args.query_file=='-' and args.format=='stream-json' and not sys.stdin.isatty()
 query=sys.stdin.read();assert query
 audit=os.environ.get('ZIWEI_MCP_AUDIT_FILE')
 if audit:Path(audit).write_text(json.dumps({'method':'initialize','ok':True})+'\\n')
 mode=os.environ.get('FIXTURE_QUERY_MODE')
 if mode in ('tty_stdout','tty_stderr'):
  print('stdin is not a tty',file=sys.stderr if mode=='tty_stderr' else sys.stdout);return 0
 selected=Path(os.environ['HERMES_HOME']);managed=Path(os.environ['HERMES_MANAGED_DIR'])
 receipt={'query':query,'profile':args.profile,'model':args.model,'cwd':os.getcwd(),'sourceHome':str(selected),'managed':str(managed),'managedText':(managed/'config.yaml').read_text(),'modelCalls':0}
 text='The diagnostic "stdin is not a tty" is only quoted here.' if mode=='quoted' else json.dumps(receipt)
 print(json.dumps({'type':'result','text':text}));return 0
`);
  const launcher=write('hermes',`#!"${python.stdout.trim()}"\nfrom hermes_cli.main import main\nif __name__=='__main__':\n raise SystemExit(main())\n`);fs.chmodSync(launcher,0o755);
  write('which',`#!${process.execPath}\nif(process.argv[2]==='hermes')console.log(${JSON.stringify(launcher)});else process.exitCode=1;\n`);fs.chmodSync(path.join(root,'which'),0o755);
  const home=path.join(root,'home'),selected=path.join(home,'profiles','selected'),policy=path.join(root,'managed'),cwd=path.join(root,'employee-work');
  for(const directory of [selected,policy,cwd])fs.mkdirSync(directory,{recursive:true});
  const config='model:\n  provider: ollama\n  default: fixture-model\n';
  fs.writeFileSync(path.join(home,'config.yaml'),config);fs.writeFileSync(path.join(selected,'config.yaml'),config);
  fs.writeFileSync(path.join(selected,'auth.json'),'synthetic-private-auth-unchanged');
  fs.writeFileSync(path.join(policy,'config.yaml'),'security:\n  fixture_policy: preserved\n');
  const tokenFile=write('fixture-management.json',JSON.stringify({token:'synthetic-management-only',workspace:'query_fixture'}));
  const env={PATH:root,PYTHONPATH:root,HERMES_HOME:home,HERMES_MANAGED_DIR:policy,CODEX_HOME:path.join(root,'empty-codex')};
  const keys=[...Object.keys(env),'ZIWEI_CREATOR_HOME','ZIWEI_INSTANCE_KIND','ZIWEI_BOT_PROFILE_MODE','ZIWEI_BOT_REASONING_EFFORT','ZIWEI_EXECUTION_PROFILE_BOUND'];
  const old=new Map(keys.map(key=>[key,process.env[key]]));
  for(const key of keys)delete process.env[key];Object.assign(process.env,env);t.mock.method(os,'homedir',()=>root);
  resetRuntimeDiscovery();t.after(()=>{for(const [key,value]of old)if(value===undefined)delete process.env[key];else process.env[key]=value;resetRuntimeDiscovery();});
  t.mock.method(globalThis,'fetch',async()=>{throw Error('No fixture network requests allowed');});
  const prompt='只读检查 cwd。Keep "quotes" and $(literal).\n第二行。';
  const options={runtime:'Hermes',profile:'selected',model:'fixture-selected-model',prompt,cwd,env,managementMcp:{workspace:'query_fixture',apiBase:'https://fixture.invalid',config:{enabled:true,tokenFile},auditDirectory:path.join(root,'audit')}};
  return{root,home,selected,policy,cwd,env,tokenFile,launcher,prompt,options};
}

test('plain Hermes uses a piped single-query JSON route through profile and management overlay', {skip:process.platform==='win32'},async t=>{
  const f=fixture(t);if(!f)return;
  const original=fs.readFileSync(path.join(f.selected,'config.yaml'),'utf8');
  const result=await executeRuntime(f.options);
  assert.equal(result.status,'succeeded',result.error);
  const receipt=JSON.parse(result.result.output);
  assert.equal(receipt.query,f.prompt);assert.equal(receipt.profile,'selected');assert.equal(receipt.model,'fixture-selected-model');assert.equal(receipt.cwd,f.cwd);
  assert.equal(receipt.sourceHome,f.selected);assert.notEqual(receipt.managed,f.policy);assert.match(receipt.managedText,/fixture_policy: preserved/);assert.match(receipt.managedText,/ziwei_management/);
  assert.equal(receipt.modelCalls,0);assert.equal(result.result.managementMcp.loaded,true);assert.equal(result.result.hermesBootstrap.mode,'effective-mcp-gate');
  assert.equal(fs.existsSync(receipt.managed),false);assert.equal(fs.readFileSync(path.join(f.selected,'config.yaml'),'utf8'),original);assert.equal(fs.readFileSync(path.join(f.selected,'auth.json'),'utf8'),'synthetic-private-auth-unchanged');
});

for(const mode of ['tty_stdout','tty_stderr'])test(`Hermes zero exit with only ${mode} is failed with original exit evidence`,{skip:process.platform==='win32'},async t=>{
  const f=fixture(t);if(!f)return;
  let launches=0;const result=await executeRuntime({...f.options,env:{...f.env,FIXTURE_QUERY_MODE:mode},onSupervision:()=>launches++});
  assert.equal(result.status,'failed');assert.equal(result.code,'HERMES_NONINTERACTIVE_FAILED');assert.equal(result.result.code,0);assert.equal(result.result.processExit.rootConfirmed,true);assert.match(result.result.output,/stdin is not a tty/);assert.equal(launches,1);
  assert.equal(Object.hasOwn(result.result,'neverStarted'),false);
});

test('structured assistant content may quote the TTY diagnostic without being rejected',{skip:process.platform==='win32'},async t=>{
  const f=fixture(t);if(!f)return;
  const result=await executeRuntime({...f.options,env:{...f.env,FIXTURE_QUERY_MODE:'quoted'}});
  assert.equal(result.status,'succeeded',result.error);assert.match(result.result.output,/only quoted here/);
});

test('model execution explicitly requests owned-Job cleanup on a failed root',{skip:process.platform==='win32'},async t=>{
  const f=fixture(t);if(!f)return;
  const sourceUrl=new URL('../src/runtime-adapters.mjs',import.meta.url),key='model-policy-'+randomUUID();
  globalThis[key]=[];t.after(()=>{delete globalThis[key];});
  const wrapper=`import {spawnSupervisedRuntime as original} from ${JSON.stringify(new URL('../src/runtime-process.mjs',import.meta.url).href)};export const spawnSupervisedRuntime=spec=>{globalThis[${JSON.stringify(key)}].push(spec.cleanupOnFailure);return original(spec);};`;
  const source=fs.readFileSync(sourceUrl,'utf8').replaceAll('import.meta.url',JSON.stringify(sourceUrl.href)).replace(/from (['"])([^'"\r\n]+)\1/g,(_all,_quote,specifier)=>{
    const target=specifier==='./runtime-process.mjs'?'data:text/javascript,'+encodeURIComponent(wrapper):specifier.startsWith('.')?new URL(specifier,sourceUrl).href:specifier.startsWith('node:')?specifier:import.meta.resolve(specifier);
    return 'from '+JSON.stringify(target);
  });
  const isolated=await import('data:text/javascript,'+encodeURIComponent(source));
  const result=await isolated.executeRuntime(f.options);
  assert.equal(result.status,'succeeded',result.error);assert.deepEqual(globalThis[key],[true]);
});

test('the former plain route produces no query result while the new route preserves prompt stdin',{skip:process.platform==='win32'},t=>{
  const f=fixture(t);if(!f)return;
  const invocation=runtimeInvocation('Hermes',{prompt:f.prompt,model:'fixture-selected-model'});
  assert.deepEqual(invocation.args,['--yolo','chat','--query-file','-','--format','stream-json','--model','fixture-selected-model']);assert.equal(invocation.stdin,f.prompt);
  const launch=prepareManagementMcpLaunch({...f.options.managementMcp,runtime:'Hermes',profile:'selected',invocation,env:f.env});
  try{
    const legacy=hermesMcpSpawnSpec(f.launcher,['--profile','selected','-z',f.prompt,'--yolo','--model','fixture-selected-model'],{env:launch.env});
    const old=spawnSync(legacy.command,legacy.args,{env:launch.env,cwd:f.cwd,encoding:'utf8',input:''});
    assert.equal(old.status,0,old.stderr);assert.match(old.stderr,/stdin is not a tty/);assert.equal(old.stdout,'');
  }finally{launch.cleanup();}
});
