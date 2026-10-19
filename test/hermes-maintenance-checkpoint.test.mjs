import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {executeRuntime,resetRuntimeDiscovery} from '../src/runtime-adapters.mjs';
import {consumeMaintenancePaused} from '../src/maintenance-checkpoint.mjs';

test('real checkpoint bridge preserves SQLite results at parallel boundaries and rejects altered resume',t=>{
  const result=spawnSync('python3',[fileURLToPath(new URL('./fixtures/hermes-maintenance-checkpoint.py',import.meta.url))],{encoding:'utf8',timeout:20000});
  if(result.error?.code==='ENOENT'){t.skip('Python unavailable');return;}
  assert.equal(result.status,0,result.stderr);
});

function fixture(t){
  const python=spawnSync('python3',['-c','import sys;print(sys.executable)'],{encoding:'utf8'});if(python.status!==0){t.skip('Python unavailable');return null;}
  const root=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-maintenance-runtime-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const write=(n,s)=>{const p=path.join(root,n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);return p;};
  write('hermes_cli/__init__.py','__version__="0.22.0"\n');write('hermes_cli/managed_scope.py','import os\nHERMES_MANAGED_DIR=os.environ.get("HERMES_MANAGED_DIR")\n');write('hermes_cli/mcp_startup.py','def _has_configured_mcp_servers():\n return False\n');write('hermes_cli/config.py','def load_config():\n return {}\ndef read_raw_config():\n return {}\n');
  write('tools/__init__.py','');write('tools/process_registry.py',"class Registry:\n def has_any_active(self):return False\nprocess_registry=Registry()\n");
  write('run_agent.py',`import json,os,sqlite3,time
from pathlib import Path
from types import SimpleNamespace
class AIAgent:
 def __init__(self,sid):
  self.session_id=sid;self._session_messages=[];self._active_children=[];self._incremental_persistence_failed=False;self.interrupted=False
 def _flush_messages_to_session_db(self,messages):
  with sqlite3.connect(Path(os.environ['HERMES_HOME'])/'state.db') as db:
   db.execute('CREATE TABLE IF NOT EXISTS messages(id INTEGER,session_id TEXT,role TEXT,content TEXT,tool_calls TEXT,tool_call_id TEXT,PRIMARY KEY(session_id,id))')
   for i,m in enumerate(messages):db.execute('INSERT OR REPLACE INTO messages VALUES(?,?,?,?,?,?)',(i+1,self.session_id,m['role'],m.get('content'),json.dumps(m['tool_calls']) if m.get('tool_calls') else None,m.get('tool_call_id')))
  return True
 def _persist_session(self,messages,history=None):return self._flush_messages_to_session_db(messages)
 def interrupt(self,tool_reason=None):self.interrupted=True
 def _execute_tool_calls(self,assistant_message,messages,task_id):
  Path(os.environ['FIXTURE_STARTED']).write_text('started');time.sleep(.4)
  effect=Path(os.environ['FIXTURE_EFFECT']);effect.write_text(effect.read_text()+'1' if effect.exists() else '1')
  messages.append({'role':'tool','tool_call_id':'tool-one','content':'external operation receipt-one'});self._flush_messages_to_session_db(messages)
 def run_conversation(self,user_message):
  Path(os.environ['FIXTURE_QUERY']).write_text(user_message)
  if os.environ.get('FIXTURE_RESUME')=='1':return {'failed':False}
  self._session_messages=[{'role':'user','content':user_message},{'role':'assistant','tool_calls':[{'id':'tool-one','function':{'name':'terminal'}}]}];self._flush_messages_to_session_db(self._session_messages)
  self._execute_tool_calls(SimpleNamespace(tool_calls=[SimpleNamespace(id='tool-one',function=SimpleNamespace(name='terminal'))]),self._session_messages,'task')
  self._persist_session(self._session_messages);return {'failed':False,'interrupted':self.interrupted}
`);
  write('hermes_cli/main.py',`import argparse,json,os,sys
from pathlib import Path
def main():
 p=argparse.ArgumentParser();p.add_argument('--profile');p.add_argument('--yolo',action='store_true');c=p.add_subparsers(dest='cmd').add_parser('chat');c.add_argument('--query-file');c.add_argument('--format');c.add_argument('--toolsets');c.add_argument('--model');c.add_argument('--resume');c.add_argument('--no-restore-cwd',action='store_true');a=p.parse_args()
 if os.environ.get('ZIWEI_MCP_AUDIT_FILE'):Path(os.environ['ZIWEI_MCP_AUDIT_FILE']).write_text(json.dumps({'method':'initialize','ok':True})+'\\n')
 from run_agent import AIAgent
 agent=AIAgent(a.resume or 'native-session-one');result=agent.run_conversation(sys.stdin.read());code=130 if agent.interrupted or os.environ.get('FIXTURE_UNKNOWN_INTERRUPT')=='1' else 0;print(json.dumps({'type':'result','session_id':agent.session_id,'exit_code':code,'text':'continued' if os.environ.get('FIXTURE_RESUME')=='1' else 'boundary reached'}));raise SystemExit(code)
`);
  const launcher=write('hermes',`#!"${python.stdout.trim()}"\nfrom hermes_cli.main import main\nif __name__=='__main__':\n raise SystemExit(main())\n`);fs.chmodSync(launcher,0o755);fs.chmodSync(write('which',`#!${process.execPath}\nif(process.argv[2]==='hermes')console.log(${JSON.stringify(launcher)});else process.exitCode=1;\n`),0o755);
  const home=path.join(root,'home'),selected=path.join(home,'profiles','selected'),cwd=path.join(root,'work'),directory=path.join(root,'maintenance');for(const p of [selected,cwd,directory])fs.mkdirSync(p,{recursive:true});
  write('home/profiles/selected/config.yaml','model:\n  provider: ollama\n  default: fixture-model\n');const tokenFile=write('token.json',JSON.stringify({token:'synthetic-fixture',workspace:'maintenance_fixture'}));
  const env={PATH:root,PYTHONPATH:root,HERMES_HOME:home,CODEX_HOME:path.join(root,'empty-codex'),FIXTURE_STARTED:path.join(root,'tool-started'),FIXTURE_EFFECT:path.join(root,'effect'),FIXTURE_QUERY:path.join(root,'query')};const keys=[...Object.keys(env),'HERMES_MANAGED_DIR','ZIWEI_CREATOR_HOME','ZIWEI_INSTANCE_KIND','ZIWEI_EXECUTION_PROFILE_BOUND'];const previous=new Map(keys.map(k=>[k,process.env[k]]));for(const k of keys)delete process.env[k];Object.assign(process.env,env);t.mock.method(os,'homedir',()=>root);resetRuntimeDiscovery();t.after(()=>{for(const[k,v]of previous)if(v===undefined)delete process.env[k];else process.env[k]=v;resetRuntimeDiscovery();});t.mock.method(globalThis,'fetch',async()=>{throw Error('No fixture network');});
  let control;const maintenance={actionId:'action_fixture',executionBinding:'a'.repeat(64),directory,onControl:fn=>{control=fn;return()=>{control=null;};}};
  const options={runtime:'Hermes',profile:'selected',model:'fixture-model',prompt:'ORIGINAL_TASK_DO_NOT_REPLAY',cwd,env,maintenance,managementMcp:{workspace:'maintenance_fixture',apiBase:'https://fixture.invalid',config:{enabled:true,tokenFile},auditDirectory:path.join(root,'audit')},onSupervision:supervision=>{const evidence=supervision.completionEvidence;supervision.completionEvidence=evidence.then(value=>({...value,treeConfirmed:true,activeProcesses:0,cancelled:false,backgroundProcessesRetained:false}));}};
  return{root,env,options,maintenance,getControl:()=>control};
}
async function until(check){const end=Date.now()+10000;while(!check()){if(Date.now()>end)throw Error('fixture did not reach native tool');await new Promise(resolve=>setTimeout(resolve,15));}}

test('executeRuntime hands off one completed native tool and resumes the exact session without its original prompt',{skip:process.platform==='win32',timeout:30000},async t=>{
  const f=fixture(t);if(!f)return;const running=executeRuntime(f.options);await until(()=>f.getControl()&&fs.existsSync(f.env.FIXTURE_STARTED));assert.equal(f.getControl()({id:'client-update-fixture',targetBuild:'c'.repeat(64)}).accepted,true);
  const paused=await running;assert.equal(paused.status,'maintenance_paused',paused.error);assert.equal(paused.result.processExit.rootExitCode,0);assert.match(paused.result.diagnostics,/nativeExitCode.*130/);const receipt=consumeMaintenancePaused(paused);assert.equal(receipt.sessionId,'native-session-one');assert.equal(receipt.pendingTools,0);assert.equal(receipt.processExit.treeConfirmed,true);assert.equal(f.getControl(),null);assert.equal(fs.readFileSync(f.env.FIXTURE_EFFECT,'utf8'),'1');
  const result=await executeRuntime({...f.options,env:{...f.env,FIXTURE_RESUME:'1'},maintenance:{...f.maintenance,resume:receipt}});assert.equal(result.status,'succeeded',result.error);assert.equal(result.result.nativeSessionId,receipt.sessionId);assert.equal(fs.readFileSync(f.env.FIXTURE_EFFECT,'utf8'),'1');const query=fs.readFileSync(f.env.FIXTURE_QUERY,'utf8');assert.match(query,/remaining task/);assert.doesNotMatch(query,/ORIGINAL_TASK_DO_NOT_REPLAY/);
});

test('an unconfirmed physical tree cannot be branded as a maintenance checkpoint',{skip:process.platform==='win32',timeout:30000},async t=>{
  const f=fixture(t);if(!f)return;const running=executeRuntime({...f.options,onSupervision:undefined});await until(()=>f.getControl()&&fs.existsSync(f.env.FIXTURE_STARTED));assert.equal(f.getControl()({id:'client-update-fixture',targetBuild:'c'.repeat(64)}).accepted,true);const result=await running;assert.equal(result.status,'failed');assert.equal(result.code,'MAINTENANCE_CHECKPOINT_INVALID');assert.equal(consumeMaintenancePaused(result),null);assert.equal(fs.readFileSync(f.env.FIXTURE_EFFECT,'utf8'),'1');
});

test('unsupported native pause hooks leave an ordinary Hermes execution running and report no checkpoint',{skip:process.platform==='win32',timeout:30000},async t=>{
  const f=fixture(t);if(!f)return;fs.appendFileSync(path.join(f.root,'run_agent.py'),'\nAIAgent.interrupt=None\n');
  const running=executeRuntime({...f.options,managementMcp:null});await until(()=>f.getControl()&&fs.existsSync(f.env.FIXTURE_STARTED));
  assert.deepEqual(f.getControl()({id:'client-update-fixture',targetBuild:'c'.repeat(64)}),{accepted:false,reasonCode:'MAINTENANCE_CHECKPOINT_UNSUPPORTED'});
  const result=await running;assert.equal(result.status,'succeeded',result.error);assert.equal(result.result.nativeSessionId,'native-session-one');assert.equal(consumeMaintenancePaused(result),null);assert.equal(fs.readFileSync(f.env.FIXTURE_EFFECT,'utf8'),'1');
});

test('a stale ready nonce cannot authorize a pause in another native invocation',{skip:process.platform==='win32',timeout:30000},async t=>{
  const f=fixture(t);if(!f)return;const running=executeRuntime(f.options);await until(()=>f.getControl()&&fs.existsSync(f.env.FIXTURE_STARTED));
  const directory=fs.readdirSync(f.maintenance.directory).find(name=>name.startsWith('execution-')),file=path.join(f.maintenance.directory,directory,'ready.json');const ready=JSON.parse(fs.readFileSync(file,'utf8'));fs.writeFileSync(file,JSON.stringify({...ready,nonce:'d'.repeat(64)}));
  assert.deepEqual(f.getControl()({id:'client-update-fixture',targetBuild:'c'.repeat(64)}),{accepted:false,reasonCode:'MAINTENANCE_CHECKPOINT_NOT_READY'});const result=await running;assert.equal(result.status,'succeeded',result.error);assert.equal(consumeMaintenancePaused(result),null);assert.equal(fs.readFileSync(f.env.FIXTURE_EFFECT,'utf8'),'1');
});

test('an unknown native interrupt keeps its real exit 130 and is never promoted to a maintenance yield',{skip:process.platform==='win32',timeout:30000},async t=>{
  const f=fixture(t);if(!f)return;const result=await executeRuntime({...f.options,env:{...f.env,FIXTURE_UNKNOWN_INTERRUPT:'1'}});assert.equal(result.status,'failed');assert.equal(result.code,'runtime_failed');assert.equal(result.result.processExit.rootExitCode,130);assert.equal(consumeMaintenancePaused(result),null);assert.doesNotMatch(result.result.output,/ZIWEI_MAINTENANCE_YIELD/);assert.equal(fs.readFileSync(f.env.FIXTURE_EFFECT,'utf8'),'1');
});
