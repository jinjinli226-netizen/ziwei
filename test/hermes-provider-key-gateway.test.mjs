import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const bridge=fileURLToPath(new URL('../src/hermes-provider-key.py',import.meta.url));
function pythonInterpreter(){
 const configured=process.env.ZIWEI_TEST_PYTHON;
 for(const command of configured?[configured]:['python3','python']){
  const probe=spawnSync(command,['-I','-B','-c','import sys;print(sys.executable)'],{encoding:'utf8',windowsHide:true,timeout:10000});
  if(probe.status===0&&path.isAbsolute(probe.stdout.trim()))return probe.stdout.trim();
 }
 if(configured)throw new Error('ZIWEI_TEST_PYTHON must identify a working Python interpreter');
 return null;
}
const python=pythonInterpreter();

// A synthetic installed package provides only the native session RPC boundary.
// Optionally execute the actual installed gateway_chat.py against the fake
// transport/view, so its complete creation and resume paths run without an
// owner, listener, SDK, provider request, or credential store.
const harness=String.raw`
import argparse, contextlib, importlib.util, io, json, logging, os, pathlib, sys, types
sys.stdin.reconfigure(encoding='utf-8');sys.stdout.reconfigure(encoding='utf-8');sys.stderr.reconfigure(encoding='utf-8')
request=json.loads(sys.stdin.read())
root=pathlib.Path(request['root']).resolve()
secret=request['secret']; provider='fixture-provider'; endpoint='https://fixture.invalid/v1'
calls=[]; resolver_calls=[]; durable={}; views=[]; supplied=[]
def inside(value):
    try:return pathlib.Path(value).resolve().is_relative_to(root)
    except (TypeError,ValueError):return False
def audit(event,args):
    if event.startswith(('subprocess.','socket.connect','socket.bind','socket.getaddrinfo','os.exec','os.spawn','os.system')):
        raise AssertionError('NO_PROCESS_OR_NETWORK')
    if event=='open' and not isinstance(args[0],int):
        filename,mode,flags=args
        if flags & (os.O_WRONLY|os.O_RDWR|os.O_CREAT|os.O_TRUNC|os.O_APPEND) and not inside(filename):raise AssertionError('NO_EXTERNAL_WRITE')
        if not inside(filename) and pathlib.Path(filename).name.lower() in {'.env','auth.json','state.db','ziwei_user.json'}:raise AssertionError('NO_REAL_CREDENTIAL_OR_BUSINESS_READ')
sys.addaudithook(audit)
def module(name,**values):
    result=types.ModuleType(name);result.__dict__.update(values);sys.modules[name]=result;return result
package=module('hermes_cli');package.__path__=[]
runtime=module('hermes_cli.runtime_provider')
def original_resolve(*,requested=None,explicit_api_key=None,explicit_base_url=None):
    resolver_calls.append({'requested':requested,'key':explicit_api_key,'endpoint':explicit_base_url})
    return {'api_key':explicit_api_key,'base_url':('https://wrong.invalid' if request.get('badRoute') else explicit_base_url),'credential_pool':([{}] if request.get('credentialPool') else None)}
runtime.resolve_runtime_provider=original_resolve
class GatewayClientError(Exception):pass
snapshot={'stored_session_id':'fixture-session','messages':[],'info':{'launch_request':{'model':'fixture-model','provider':provider,'base_url':endpoint,'max_turns':99}}}
class Client:
    async def rpc(self,method,**params):
        calls.append(method)
        if method=='runtime.describe':return {'session_create':{'sources':['cli','oneshot'],'parameters':['model','provider','base_url','api_key','title','max_turns','cwd','client_env']}}
        if method in {'session.create','session.resume'}:
            assert params.get('api_key')==secret,'INDEPENDENT_KEY_MISSING_FROM_NATIVE_RPC'
            assert secret not in json.dumps(params.get('client_env',{})),'KEY_IS_NOT_TOOLCHAIN_ENV'
            if request.get('resumeRefused'):raise GatewayClientError('admission_conflict')
            if method=='session.create':
                assert params['provider']==provider and params['base_url']==endpoint,'BOUND_ROUTE_NOT_FORWARDED'
                durable.update({k:v for k,v in params.items() if k!='api_key'})
                (root/'durable.json').write_text(json.dumps(durable),encoding='utf-8')
            return snapshot
        raise AssertionError('UNEXPECTED_RPC')
@contextlib.asynccontextmanager
async def connect_gateway():yield Client()
module('hermes_cli.gateway_client',GatewayClientError=GatewayClientError,RESUME_KEY_MISMATCH='RESUME_KEY_MISMATCH',connect_gateway=connect_gateway)
module('hermes_cli.gateway_connection',RESUME_REFUSALS=frozenset({'not_found','permission_denied'}))
module('utils',is_truthy_value=lambda value:False)
agent=module('agent');agent.__path__=[]
module('agent.session_source',create_surface=lambda value:value)
module('agent.session_client_env',collect_client_env=lambda **kwargs:{'PATH':'fixture-toolchain'})
module('hermes_cli.config',get_config_path=lambda:root/'config.yaml')
module('hermes_cli.config_effective',load_user_config_effective=lambda _: {})
class View:
    def __init__(self,client,snapshot,*,quiet,emitter,usage_file):
        self.emitter=emitter;views.append(self)
    async def run(self,query,*,oneshot):
        assert self.launch_api_key==secret and query=='fixture query' and oneshot is True
        return 'fixture-complete'
module('hermes_cli.gateway_chat_view',GatewayChatView=View)
fixture_gateway='''
import os
_POLICY=('model','provider','base_url','api_key','max_turns')
def _requested_policy(args):
    return {key:getattr(args,key) for key in _POLICY if getattr(args,key,None) is not None}
async def _resume(client,args,**params):
    key=getattr(args,'api_key',None)
    return await client.rpc('session.resume',**params,**({'api_key':key} if key else {}))
async def run_gateway_chat(args,emitter=None):
    async with connect_gateway() as client:
        await client.rpc('runtime.describe')
        if args.resume:
            snapshot=await _resume(client,args,session_id=args.resume)
        else:
            snapshot=await client.rpc('session.create',**_requested_policy(args),client_env={'PATH':'fixture-toolchain'})
        if emitter is not None:emitter.bind_session(snapshot['stored_session_id'])
        view=View(client,snapshot,quiet=True,emitter=emitter,usage_file=None)
        view.launch_api_key=getattr(args,'api_key',None)
        return await view.run(args.query,oneshot=True)
'''
mode=request['mode'];gateway=None;source_kind='absent'
if mode!='legacy':
    gateway=module('hermes_cli.gateway_chat',supplied=supplied,connect_gateway=connect_gateway,View=View)
    source=pathlib.Path(request['nativeGateway']).read_text(encoding='utf-8') if request.get('nativeGateway') else fixture_gateway
    source_kind='installed-native' if request.get('nativeGateway') else 'synthetic-contract'
    exec(compile(source,'isolated_gateway_chat.py','exec'),gateway.__dict__)
    async def inline_thread(fn,*args):return fn(*args)
    gateway.asyncio=types.SimpleNamespace(to_thread=inline_thread)
    native_gateway=gateway.run_gateway_chat
    async def capture_gateway(args,*positional,**kwargs):
        supplied.append(args)
        return await native_gateway(args,*positional,**kwargs)
    gateway.run_gateway_chat=capture_gateway
    original_gateway=gateway.run_gateway_chat
if request.get('missingDependency'):
    sys.modules.pop('hermes_cli.gateway_chat',None)
    class BrokenGatewayFinder:
        def find_spec(self,fullname,path=None,target=None):
            if fullname=='hermes_cli.gateway_chat':raise ModuleNotFoundError('synthetic missing dependency',name='fixture_dependency')
    sys.meta_path.insert(0,BrokenGatewayFinder())
spec=importlib.util.spec_from_file_location('ziwei_provider_key',request['bridge']);bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)
class Rejected(Exception):pass
keys={'ZIWEI_BOT_PROVIDER_KEY':secret,'ZIWEI_BOT_KEY_PROVIDER':provider,'ZIWEI_BOT_KEY_ENDPOINT':endpoint}
if mode!='no-key':os.environ.update(keys)
args=argparse.Namespace(model='fixture-model',provider=None,base_url=None,api_key=None,max_turns=99,query='fixture query',resume=('fixture-session' if mode=='resume' else None),continue_last='Ziwei fixture',create_if_missing=True,quiet=True)
for name,value in request.get('args',{}).items():setattr(args,name,value)
before=dict(vars(args));argv=list(sys.argv);caught=None;result=None
logs=io.StringIO();handler=logging.StreamHandler(logs);handler.setFormatter(logging.Formatter('%(message)s'));logging.getLogger('fixture').addHandler(handler)
try:
    bridge.install(Rejected,validate=request.get('validate',False))
    if mode=='legacy':
        resolved=runtime.resolve_runtime_provider(requested=provider)
        assert resolved['api_key']==secret and resolved['base_url']==endpoint
    elif mode=='no-key':
        assert runtime.resolve_runtime_provider is original_resolve and gateway.run_gateway_chat is original_gateway
    else:
        class Emitter:
            def bind_session(self,session):self.session=session
        emitter=Emitter()
        async def run():
            if request.get('positionalEmitter'):return await gateway.run_gateway_chat(args,emitter)
            return await gateway.run_gateway_chat(args,emitter=emitter)
        # Every transport/view await completes inline. Driving the coroutine
        # directly also avoids Windows asyncio's private socketpair listener.
        coroutine=run()
        try:
            coroutine.send(None)
            raise AssertionError('UNEXPECTED_ASYNC_SUSPENSION')
        except StopIteration as completed:result=completed.value
        assert emitter.session=='fixture-session' and views[-1].emitter is emitter,'EMITTER_NOT_FORWARDED'
    if mode!='no-key':logging.getLogger('fixture').error('synthetic provider echo %s',secret)
except Exception as error:
    caught={'type':type(error).__name__,'message':str(error)}
assert dict(vars(args))==before,'ORIGINAL_NAMESPACE_CHANGED'
if supplied:assert all(item is not args and item.api_key is None for item in supplied),'PRIVATE_NAMESPACE_NOT_SCOPED'
assert list(sys.argv)==argv and secret not in json.dumps(sys.argv),'KEY_IN_ARGV'
assert secret not in json.dumps(durable),'KEY_IN_DURABLE_RPC_METADATA'
for file in root.iterdir():
    if file.is_file():assert secret.encode() not in file.read_bytes(),'KEY_PERSISTED_TO_FIXTURE'
assert secret not in logs.getvalue(),'KEY_IN_LOG'
assert not any(key in os.environ for key in keys),'KEY_ENV_NOT_CONSUMED'
if result=='fixture-complete':
    assert resolver_calls and resolver_calls[-1]['key']==secret,'RESOLVER_BINDING_NOT_VALIDATED'
print(json.dumps({'mode':mode,'gatewaySource':source_kind,'calls':calls,'resolverCalls':len(resolver_calls),'result':result,'caught':caught,'namespaceUnchanged':True,'argvUnchanged':True,'keyPersisted':False,'modelCalls':0,'networkCalls':0,'logRedacted':('[REDACTED]' in logs.getvalue())}))
`;

function run(t,input={}){
 if(!python){t.skip('Python required; set ZIWEI_TEST_PYTHON to the installed interpreter');return null;}
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-key-gateway-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const harnessFile=path.join(directory,'harness.py');fs.writeFileSync(harnessFile,harness);
 const secret='ISOLATED_GATEWAY_KEY_NOT_A_REAL_CREDENTIAL';
 const request={root:directory,bridge,secret,nativeGateway:process.env.ZIWEI_TEST_GATEWAY_CHAT_SOURCE||null,mode:'create',...input};
 const env={PYTHONDONTWRITEBYTECODE:'1',PYTHONUTF8:'1',TEMP:directory,TMP:directory};
 for(const key of ['SystemRoot','WINDIR','COMSPEC'])if(process.env[key])env[key]=process.env[key];
 const result=spawnSync(python,['-I','-B',harnessFile],{input:JSON.stringify(request),encoding:'utf8',env,windowsHide:true,timeout:15000});
 assert.equal(result.stdout.includes(secret)||result.stderr.includes(secret),false,'test output must not contain the synthetic key');
 assert.equal(result.status,0,result.stderr);
 const receipt=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
 t.diagnostic('Gateway source: '+receipt.gatewaySource);
 return receipt;
}

for(const mode of ['create','resume'])test(`independent key reaches native ${mode} RPC without mutating Namespace, argv, env, logs, or durable metadata`,t=>{
 const value=run(t,{mode,positionalEmitter:mode==='create'});if(!value)return;
 assert.equal(value.caught,null);assert.equal(value.result,'fixture-complete');
 assert.ok(value.calls.includes(mode==='create'?'session.create':'session.resume'));assert.equal(value.logRedacted,true);
});

for(const [name,args]of [['provider',{provider:'other-provider'}],['endpoint',{base_url:'https://other.invalid/v1'}],['key',{api_key:'OTHER_SYNTHETIC_KEY'}],['blank key',{api_key:''}]])test(`a different explicit ${name} is rejected before native RPC`,t=>{
 const value=run(t,{args,expectRejected:true});if(!value)return;
 assert.equal(value.caught?.type,'Rejected');assert.deepEqual(value.calls,[]);assert.match(value.caught.message,/binding changed|route mismatch/);
});

test('native resolver binding mismatch and credential pools still reject before Gateway RPC',t=>{
 for(const overrides of [{badRoute:true},{credentialPool:true}]){const value=run(t,{...overrides,expectRejected:true});if(!value)return;assert.equal(value.caught?.type,'Rejected');assert.match(value.caught.message,/route mismatch/);assert.deepEqual(value.calls,[]);}
});

test('resume retains the native refusal when a previously held key cannot be rebound',t=>{
 const value=run(t,{mode:'resume',resumeRefused:true});if(!value)return;
 assert.equal(value.caught?.type,'GatewayClientError');assert.ok(value.calls.includes('session.resume'));
 assert.equal(value.caught.message,process.env.ZIWEI_TEST_GATEWAY_CHAT_SOURCE?'RESUME_KEY_MISMATCH':'admission_conflict');
});

test('legacy Hermes without gateway retains resolver validation and redaction',t=>{
 const value=run(t,{mode:'legacy',validate:true});if(!value)return;
 assert.equal(value.caught,null);assert.equal(value.resolverCalls,2);assert.equal(value.logRedacted,true);
});

test('missing Gateway dependency is refused rather than mistaken for legacy Hermes',t=>{
 const value=run(t,{missingDependency:true,expectRejected:true});if(!value)return;
 assert.equal(value.caught?.type,'Rejected');assert.match(value.caught.message,/gateway.*unsupported/);assert.deepEqual(value.calls,[]);
});

test('without an independent key, both native entry points remain unchanged',t=>{
 const value=run(t,{mode:'no-key'});if(!value)return;
 assert.equal(value.caught,null);assert.equal(value.resolverCalls,0);assert.deepEqual(value.calls,[]);
});
