import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const bridge=path.resolve(import.meta.dirname,'../src/hermes-gateway-readiness.py');
const nativePython=path.join(os.homedir(),'AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe');
const python=process.env.ZIWEI_TEST_PYTHON||(fs.existsSync(nativePython)?nativePython:['python3','python'].map(command=>{
 const result=spawnSync(command,['-I','-B','-c','import sys;print(sys.executable)'],{encoding:'utf8',windowsHide:true});
 return result.status===0?result.stdout.trim():null;
}).find(Boolean));
const harness=String.raw`
import importlib.util,json,os,pathlib,sys,types
sys.stdin.reconfigure(encoding='utf-8');sys.stdout.reconfigure(encoding='utf-8')
request=json.loads(sys.stdin.read());root=pathlib.Path(request['root']);calls=[]
def module(name,**fields):
 result=types.ModuleType(name);result.__dict__.update(fields);sys.modules[name]=result;return result
package=module('hermes_cli');package.__path__=[]
def ensure(home,*,timeout=60.0,idle_exit=False):
 calls.append({'home':str(home),'timeout':timeout,'idle_exit':idle_exit})
 if request.get('nativeError'):raise PermissionError('native refusal')
 return 'native result'
runtime=module('hermes_cli.gateway_runtime',ensure_gateway_runtime=ensure)
spec=importlib.util.spec_from_file_location('readiness_bridge',request['bridge'])
bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)
installed=bridge.install();bridge.install()
caught=None;result=None
try:
 kwargs={'idle_exit':True}
 if 'timeout' in request:kwargs['timeout']=request['timeout']
 result=runtime.ensure_gateway_runtime(root/'profile',**kwargs)
except Exception as error:caught={'type':type(error).__name__,'message':str(error)}
print(json.dumps({'installed':installed,'calls':calls,'result':result,'caught':caught}))
`;
const nativeHarness=String.raw`
import importlib.util,json,os,pathlib,sys,types
sys.stdin.reconfigure(encoding='utf-8');sys.stdout.reconfigure(encoding='utf-8')
request=json.loads(sys.stdin.read());root=pathlib.Path(request['root']);clock=types.SimpleNamespace(now=0.0)
def module(name,**fields):
 result=types.ModuleType(name);result.__dict__.update(fields);sys.modules[name]=result;return result
def audit(event,args):
 if event.startswith(('socket.connect','socket.bind','socket.getaddrinfo','subprocess.','os.exec','os.spawn','os.system')):raise AssertionError('NO_NETWORK_OR_PROCESS')
 if event=='open' and not isinstance(args[0],int):
  name,mode,flags=args
  if flags&(os.O_WRONLY|os.O_RDWR|os.O_CREAT|os.O_TRUNC|os.O_APPEND) and not pathlib.Path(name).resolve().is_relative_to(root):raise AssertionError('NO_EXTERNAL_WRITE')
  if not pathlib.Path(name).resolve().is_relative_to(root) and pathlib.Path(name).name in ('.env','auth.json','state.db','ziwei_user.json'):raise AssertionError('NO_REAL_PRIVATE_READ')
sys.addaudithook(audit)
package=module('hermes_cli');package.__path__=[]
nativeSpec=importlib.util.spec_from_file_location('hermes_cli.gateway_runtime',request['nativeRuntime'])
runtime=importlib.util.module_from_spec(nativeSpec);sys.modules[nativeSpec.name]=runtime;nativeSpec.loader.exec_module(runtime)
originalEnsure=runtime.ensure_gateway_runtime
spec=importlib.util.spec_from_file_location('readiness_bridge',request['bridge'])
bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge);bridge.install()
spawned=[];probes=[]
class RuntimeStartError(Exception):pass
def remaining(deadline):
 value=deadline-clock.now
 if value<=0:raise TimeoutError()
 return value
def spawn(home,*,deadline,idle_exit):
 spawned.append({'home':str(home),'idle_exit':idle_exit})
 return types.SimpleNamespace(pid=123,poll=lambda:None)
def discover(home,*,timeout):
 if clock.now>=request.get('readyAt',147):return runtime.GatewayDiscovery('ready',endpoint=object())
 if request.get('terminal') and clock.now>=1:return runtime.GatewayDiscovery('inaccessible',reason_code='profile_parked')
 return runtime.GatewayDiscovery('starting' if spawned or request.get('existing') else 'absent')
def observe(home,deadline,replaced):
 remaining(deadline);probes.append(clock.now)
 return discover(home,timeout=remaining(deadline))
module('hermes_constants',get_default_hermes_root=lambda:root,get_process_hermes_home=lambda:root)
module('hermes_cli.gateway_runtime_service',RuntimeStartError=RuntimeStartError,remaining=remaining,discover_existing_gateway_service=lambda *a,**kw:None,start_existing_gateway_service=lambda *a,**kw:(_ for _ in ()).throw(AssertionError('NO_SERVICE_START')))
module('hermes_cli.gateway_runtime_multiplex',implied_host_root=lambda _:None,multiplexer_serves_home=lambda _:None)
module('hermes_cli.gateway_runtime_start',spawn_unmanaged_gateway=spawn,stdio_log_size=lambda _:0)
runtime._update_fenced=lambda _:False
runtime._starting_multiplexer_root=lambda _:None
runtime._observe_replacing_stale=observe
runtime.discover_gateway_endpoint=discover
realTime=sys.modules['time'];sys.modules['time']=types.SimpleNamespace(monotonic=lambda:clock.now,sleep=lambda seconds:setattr(clock,'now',clock.now+seconds))
try:
 result=runtime.ensure_gateway_runtime(root/'profile',idle_exit=True)
finally:sys.modules['time']=realTime
print(json.dumps({'state':result.state,'reason':result.reason_code,'elapsed':clock.now,'spawned':spawned,'nativeEnsure':originalEnsure.__module__,'probeCount':len(probes)}))
`;
function run(t,source,options={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-gateway-ready-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const script=path.join(root,'fixture.py');fs.writeFileSync(script,source);
 const env={PYTHONUTF8:'1',PYTHONDONTWRITEBYTECODE:'1',TEMP:root,TMP:root};
 for(const key of ['SystemRoot','WINDIR','COMSPEC'])if(process.env[key])env[key]=process.env[key];
 const result=spawnSync(python,['-I','-B',script],{input:JSON.stringify({root,bridge,...options}),env,encoding:'utf8',windowsHide:true,timeout:15000});
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr);return JSON.parse(result.stdout);
}

test('Gateway execution supplies one longer bounded native ensure budget without retrying',{skip:!python},t=>{
 const out=run(t,harness);assert.equal(out.installed,true);assert.equal(out.result,'native result');
 assert.equal(out.calls.length,1);assert.equal(out.calls[0].timeout,180);assert.equal(out.calls[0].idle_exit,true);
});
test('Gateway execution preserves explicit budgets and native terminal errors',{skip:!python},t=>{
 assert.equal(run(t,harness,{timeout:7}).calls[0].timeout,7);
 const out=run(t,harness,{nativeError:true});assert.deepEqual(out.caught,{type:'PermissionError',message:'native refusal'});assert.equal(out.calls.length,1);
});

test('installed native ensure awaits a 147 second cold boot once and respects terminal/deadline verdicts',{skip:!python},t=>{
 const nativeRoot=process.env.ZIWEI_TEST_HERMES_ROOT;
 if(!nativeRoot){t.skip('Set ZIWEI_TEST_HERMES_ROOT for installed native no-network loop verification');return;}
 const nativeRuntime=path.join(nativeRoot,'hermes_cli/gateway_runtime.py');
 const cold=run(t,nativeHarness,{nativeRuntime});
 assert.equal(cold.state,'ready');assert.equal(cold.spawned.length,1);assert.ok(cold.elapsed>=147&&cold.elapsed<148);
 const existing=run(t,nativeHarness,{nativeRuntime,existing:true});
 assert.equal(existing.state,'ready');assert.equal(existing.spawned.length,0);
 const bounded=run(t,nativeHarness,{nativeRuntime,readyAt:500});
 assert.equal(bounded.state,'starting');assert.equal(bounded.reason,'deadline');assert.equal(bounded.elapsed,180);assert.equal(bounded.spawned.length,1);
 const terminal=run(t,nativeHarness,{nativeRuntime,terminal:true});
 assert.equal(terminal.state,'inaccessible');assert.equal(terminal.reason,'profile_parked');assert.ok(terminal.elapsed<2);assert.equal(terminal.spawned.length,1);
});
