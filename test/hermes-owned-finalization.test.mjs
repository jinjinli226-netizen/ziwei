import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const installedPython=path.join(os.homedir(),'AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe');
const program=String.raw`
import contextlib, importlib.util, io, json, os, sys, tempfile, types
from pathlib import Path
from unittest.mock import patch
root=Path(sys.argv[1])
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,root/file)
 module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
bootstrap=load('owned_finalization_bootstrap','src/hermes-mcp-bootstrap.py')
bridge=load('owned_finalization_bridge','src/hermes-native-bridge.py')
events=[]
registry=types.ModuleType('hermes_state_registry')
registry.close_all_under=lambda home:events.append(['close',str(home)])
cli=types.ModuleType('hermes_cli');cli.__version__='fixture'
class OperationError(Exception):pass
def operation(request,context):
 events.append(['operation'])
 if request.get('fail'):raise OperationError('EXPECTED_FAILURE')
 return {'status':'succeeded'}
def gateway(request,context):
 events.append(['gateway'])
 if request.get('fail'):raise RuntimeError('EXPECTED_GATEWAY_FAILURE')
native_bridge=types.SimpleNamespace(run_operation=operation,run_gateway_worker=gateway,NativeOperationError=OperationError)
with tempfile.TemporaryDirectory(prefix='ziwei-owned-finalization-') as directory:
 home=str(Path(directory)/'owned')
 modules={name:types.SimpleNamespace(__file__=str(Path(directory)/(name+'.py'))) for name in ['main','mcp_startup','config','managed_scope']}
 modules['main'].main=lambda:0
 modules['config'].load_config=lambda:{}
 modules['mcp_startup']._has_configured_mcp_servers=lambda:False
 registry.__file__=str(Path(directory)/'hermes_state_registry.py')
 safe_read=types.SimpleNamespace(__file__=str(Path(directory)/'sqlite_safe_read.py'),has_live_connection=lambda file:False)
 current={'paths':{**{name:str(Path(module.__file__).resolve()) for name,module in modules.items()},'state_registry':str(Path(registry.__file__).resolve()),'sqlite_safe_read':str(Path(safe_read.__file__).resolve())}}
 isolation={'kind':'hermes-bot','mode':'owned_profile','home':home,'employeeId':'owned-bot','revision':1,'workspace':'fixture'}
 def invoke(mode,fail=False,owned=True,close_failure=False,execute_main=False,still_live=False):
  events.clear();scope=dict(isolation)
  if not owned:scope.pop('mode');scope.pop('home')
  args=['fixture','--launcher','fixture','--binding',json.dumps(current)]
  if mode:args.append('--'+mode)
  args.append('--')
  request={'resource':'memory','operation':'read','fail':fail,'context':{k:scope[k] for k in ['employeeId','revision','workspace']}}
  output=io.StringIO()
  def close(home):
   events.append(['close',str(home)])
   if close_failure:raise RuntimeError('CLOSE_FAILED')
  registry.close_all_under=close
  safe_read.has_live_connection=lambda file:still_live
  def main():
   events.append(['model-complete'])
   if fail:raise SystemExit(7)
   return 0
  modules['main'].main=main
  importer=lambda name:registry if name=='hermes_state_registry' else safe_read if name=='hermes_cli.sqlite_safe_read' else modules[name.removeprefix('hermes_cli.')]
  loader=types.SimpleNamespace(loader=types.SimpleNamespace(exec_module=lambda module:None))
  with patch.dict(os.environ,{'HERMES_MANAGED_DIR':directory,'ZIWEI_INSTANCE_KIND':'fixture'},clear=True),patch.dict(sys.modules,{'hermes_state_registry':registry,'hermes_cli':cli}),patch.object(sys,'argv',args),patch.object(sys,'stdin',io.StringIO(json.dumps(request))),patch.object(bootstrap,'binding',lambda launcher:current),patch.object(bootstrap,'prepare_creator_home',lambda current:None),patch.object(bootstrap,'confirm_creator_home',lambda *args:scope),patch.object(bootstrap.importlib,'import_module',importer),patch.object(bootstrap.importlib.util,'spec_from_file_location',lambda *args:loader),patch.object(bootstrap.importlib.util,'module_from_spec',lambda spec:native_bridge),contextlib.redirect_stdout(output),contextlib.redirect_stderr(io.StringIO()):
   try:
    result=bootstrap.run()
    if execute_main:result=result()
    error=None
   except BaseException as caught:result=None;error=str(caught)
  return {'events':list(events),'output':output.getvalue(),'error':error,'callable':callable(result)}
 checks={}
 for mode in ['native-operation','gateway-worker']:
  for fail in [False,True]:
   value=invoke(mode,fail)
   assert value['events']==[[('gateway' if mode=='gateway-worker' else 'operation')],['close',home]],value
   if fail and mode=='gateway-worker':assert value['error']=='EXPECTED_GATEWAY_FAILURE'
   else:assert value['error'] is None,value
   checks[mode+('-failure' if fail else '-success')]=True
  value=invoke(mode,owned=False)
  assert not any(event[0]=='close' for event in value['events']),value
  checks[mode+'-legacy-unchanged']=True
 value=invoke('native-operation',close_failure=True)
 assert value['error']=='CLOSE_FAILED' and 'ZIWEI_NATIVE_RESULT:' not in value['output'],value
 checks['close-failure-has-no-success-receipt']=True
 value=invoke(None)
 assert value['callable'] and value['events']==[],value
 checks['ordinary-native-main-unchanged']=True
 for fail in [False,True]:
  value=invoke(None,fail=fail,execute_main=True)
  assert value['events']==[['model-complete'],['close',home]],value
  assert value['error']==('7' if fail else None),value
  checks['owned-model-main-finally-'+str(fail)]=True
 value=invoke(None,owned=False,execute_main=True)
 assert value['events']==[['model-complete']],value
 checks['legacy-model-main-unchanged']=True
 value=invoke('native-operation',still_live=True)
 assert value['error']=='owned state storage remains open' and 'ZIWEI_NATIVE_RESULT:' not in value['output'],value
 checks['swallowed-close-failure-with-live-handle-refused']=True
 class PendingDB:
  def __init__(self,prior=None):self.prior=prior;self.saved=None;self.closes=0
  def get_meta(self,key):return self.saved or self.prior
  def set_meta(self,key,value):self.saved=value
  def close(self):self.closes+=1
 for prior,control_error in [(None,False),('original-pending',False),(None,True)]:
  db=PendingDB(prior)
  registry.acquire=lambda file:db
  def control(*args):
   if control_error:raise OperationError('CONTROL_FAILED')
   return {'run':{'id':'original-run'}}
  with patch.dict(sys.modules,{'hermes_state_registry':registry,'hermes_cli':cli}),patch.object(bridge,'home_path',lambda file:Path(home)/file),patch.object(bridge,'control',control):
   try:bridge.run_operation({'resource':'goals','operation':'_prepare','requestId':'original'},{'config':{},'employeeId':'owned-bot','revision':1})
   except (bridge.NativeOperationError,OperationError):pass
  assert db.closes==1,{'prior':prior,'control_error':control_error,'closes':db.closes}
  checks['pending-release-'+str(prior)+'-'+str(control_error)]=True
 print(json.dumps(checks))
`;

test('owned bridge completion closes only its verified HOME and balances pending references on errors',t=>{
  const python=fs.existsSync(installedPython)?installedPython:'python';
  const output=spawnSync(python,['-B','-c',program,path.resolve(import.meta.dirname,'..')],{encoding:'utf8',windowsHide:true,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  if(output.error?.code==='ENOENT'){t.skip('Python unavailable');return;}
  assert.equal(output.status,0,output.stderr||output.stdout);
  assert.equal(Object.keys(JSON.parse(output.stdout)).length,15);
});
