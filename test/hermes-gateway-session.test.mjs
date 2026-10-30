import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const bridge=fileURLToPath(new URL('../src/hermes-gateway-session.py',import.meta.url));
const keyBridge=fileURLToPath(new URL('../src/hermes-provider-key.py',import.meta.url));
const python=process.env.ZIWEI_TEST_PYTHON||'python';
const harness=String.raw`
import argparse,contextlib,importlib.util,io,json,os,pathlib,sys,types
sys.stdin.reconfigure(encoding='utf-8');sys.stdout.reconfigure(encoding='utf-8');sys.stderr.reconfigure(encoding='utf-8')
request=json.loads(sys.stdin.read());root=pathlib.Path(request['root']);home=root/'home';overlay=root/'overlay'
home.mkdir();overlay.mkdir();os.environ.update(HERMES_HOME=str(home),ZIWEI_CREATOR_HOME=str(home),ZIWEI_MCP_TOKEN='FIXTURE_PRIVATE_MCP',ZIWEI_BOT_REASONING_EFFORT='max')
if request.get('ordinary'):
 os.environ.pop('ZIWEI_CREATOR_HOME');os.environ.pop('ZIWEI_BOT_REASONING_EFFORT')
secret='FIXTURE_PRIVATE_MCP';calls=[];params_seen=[];views=[];mutations=[]
def audit(event,args):
 if event.startswith(('socket.connect','socket.bind','socket.getaddrinfo','subprocess.','os.exec','os.spawn','os.system')):raise AssertionError('NO_NETWORK_OR_PROCESS')
 if event=='open' and not isinstance(args[0],int):
  name,mode,flags=args
  if flags&(os.O_WRONLY|os.O_RDWR|os.O_CREAT|os.O_TRUNC|os.O_APPEND) and not pathlib.Path(name).resolve().is_relative_to(root):raise AssertionError('NO_EXTERNAL_WRITE')
  if not pathlib.Path(name).resolve().is_relative_to(root) and pathlib.Path(name).name in ('.env','auth.json','state.db','ziwei_user.json'):raise AssertionError('NO_REAL_PRIVATE_READ')
sys.addaudithook(audit)
def module(name,**fields):
 m=types.ModuleType(name);m.__dict__.update(fields);sys.modules[name]=m;return m
package=module('hermes_cli');package.__path__=[]
module('yaml',safe_load=json.loads)
entry={'command':'fixture-node','args':['fixture-management.mjs'],'env':{'ZIWEI_MCP_TOKEN':'$'+'{ZIWEI_MCP_TOKEN}','WORKSPACE':'fixture-workspace'}}
if request.get('badRef'):entry['args'].append('$'+'{ZIWEI_MCP_TOKEN}')
(overlay/'config.yaml').write_text(json.dumps({'mcp_servers':{'ziwei_management':entry,'ziwei-terminal':{'enabled':False},'untrusted':{'command':'NO'}}}),encoding='utf-8')
effective={'model':{'provider':'openai-codex','default':'gpt-6.1-sol'},'mcp_servers':{'ziwei_management':entry,'ziwei-terminal':{'enabled':False},'untrusted':{'command':'NO'},'host-only':{'command':'NO'}}}
config=module('hermes_cli.config',load_config=lambda:effective,get_config_path=lambda:home/'config.yaml')
class GatewayClientError(Exception):pass
module('hermes_cli.gateway_client',GatewayClientError=GatewayClientError,RESUME_KEY_MISMATCH='RESUME_KEY_MISMATCH')
module('hermes_cli.gateway_connection',RESUME_REFUSALS=frozenset({'not_found'}))
module('utils',is_truthy_value=lambda _:False)
agent=module('agent');agent.__path__=[]
module('agent.session_source',create_surface=lambda value:value)
module('agent.session_client_env',collect_client_env=lambda **kw:{'PATH':'fixture-path','ZIWEI_MCP_TOKEN':secret})
module('hermes_cli.config_effective',load_user_config_effective=lambda _: {})
# Canonical SessionConnection.resume returns identity under info, including when create calls resume.
snapshot={'session_id':'session-fixture','stored_session_id':'session-fixture','authority_epoch':3,'revision':5,'execution_generation':7,'messages':[{'role':'assistant','content':'Existing synthetic history'}],'info':{'profile_id':str(home),'launch_request':{'model':'gpt-6.1-sol','provider':'openai-codex'}}}
profile_case=request.get('snapshotProfile')
if profile_case=='matching-top':snapshot['profile_id']=str(home)
if profile_case=='conflicting-top':snapshot['profile_id']=str(root/'wrong-home')
if profile_case=='missing-nested':snapshot['info'].pop('profile_id')
if profile_case=='wrong-nested':snapshot['info']['profile_id']=str(root/'wrong-home')
if profile_case=='wrong-nested-matching-top':snapshot['info']['profile_id']=str(root/'wrong-home');snapshot['profile_id']=str(home)
if profile_case=='invalid-info':snapshot['info']=None
if 'snapshotEpoch' in request:snapshot['authority_epoch']=request['snapshotEpoch']
class Client:
 async def rpc(self,method,**params):
  calls.append(method);params_seen.append((method,params))
  if method=='runtime.describe':
   contract={'sources':['cli','oneshot'],'parameters':['model','provider','client_env','reasoning','editor','cwd','title','api_key','base_url']}
   if not request.get('missingMcpCap'):contract['shell_private_mcp_v1']=True
   if not request.get('missingReasoningCap'):contract['strict_reasoning_receipts_v1']=True
   return {'profile_id':str(root/'wrong-home') if request.get('wrongHome') else str(home),'authority_epoch':3,'session_create':contract}
  if method in ('session.create','session.resume'):
   if method=='session.create':
    assert params['source']=='oneshot','SOURCE_REWRITTEN';assert params.get('reasoning')==(None if request.get('ordinary') else 'max')
    assert params['client_env']=={'PATH':'fixture-path'}
    assert 'HERMES_STRICT_REASONING_EFFORT' not in params['client_env'],'NONSECRET_HERMES_ENV_MARKER_ADDED'
   if 'editor' in params:
    specs=params['editor']['mcp_servers'];assert len(specs)==1 and specs[0]['name']=='ziwei_management'
    assert specs[0]['env'][0]=={'name':'WORKSPACE','value':'fixture-workspace'} or specs[0]['env'][1]=={'name':'WORKSPACE','value':'fixture-workspace'}
    assert secret in json.dumps(specs) and secret not in json.dumps(params.get('client_env',{}))
    if method=='session.resume' and request.get('rotate') and not mutations:raise GatewayClientError('acp_mcp_policy_conflict')
   return dict(snapshot)
  if method=='session.mutate':
   assert params['operation']=='editor_mcp' and params['expected_revision']==5 and params['expected_generation']==7
   assert secret in json.dumps(params['payload']);mutations.append(True);return {'status':'applied'}
  if method=='prompt.submit':
   if request.get('ordinary'):assert not any(key.startswith('strict_reasoning_') for key in params)
   else:assert params['strict_reasoning_effort']=='max' and params['strict_reasoning_model']=='gpt-6.1-sol' and params['strict_reasoning_provider']=='openai-codex'
   return {'admission_id':'admission-fixture','execution_generation':8,'status':'started'}
  raise AssertionError('UNEXPECTED_RPC')
@contextlib.asynccontextmanager
async def connect_gateway():yield Client()
class PreparedMutations:
 async def apply(self,client,sid,operation,payload):
  snap=await client.rpc('session.resume',session_id=sid)
  return await client.rpc('session.mutate',session_id=sid,operation=operation,payload=payload,request_id='mutation-fixture',expected_revision=snap['revision'],expected_generation=snap['execution_generation'])
 def acknowledge(self,*args):pass
module('hermes_cli.gateway_mutations',PreparedMutations=PreparedMutations)
class View:
 def __init__(self,client,snapshot,**kwargs):
  self.client=client;self.snapshot=snapshot;self.inference_request_callback=None;views.append(self)
 async def run(self,*args,**kwargs):
  assert self.snapshot['messages']==snapshot['messages'],'EXISTING_HISTORY_LOST'
  assert self.snapshot==snapshot,'NATIVE_SNAPSHOT_MUTATED'
  await self.client.rpc('prompt.submit',session_id='session-fixture',input_id='input-fixture',text='Synthetic fixture only')
  binding={'profile_id':str(home),'session_id':'session-fixture','admission_id':'admission-fixture','execution_generation':8,'authority_epoch':3}
  payload={**binding,'schemaVersion':1,'api_request_id':'a'*32,'model':'gpt-6.1-sol','provider':'openai-codex','requested':'max','actual':'max','nativeActual':'xhigh','mode':'verified_gpt61_sol_max','status':'matched','phase':'request','unknownSecret':secret,'body':{'content':secret}}
  payload.update(request.get('receiptPatch',{}));binding.update(request.get('bindingPatch',{}))
  if not request.get('missingReceipt') and not request.get('ordinary'):self.inference_request_callback(payload,binding)
  return 'complete'
viewmodule=module('hermes_cli.gateway_chat_view',GatewayChatView=View)
async def native_chat(args,emitter=None):
 async with gateway.connect_gateway() as client:
  await client.rpc('runtime.describe')
  if args.resume:snap=await client.rpc('session.resume',session_id=args.resume)
  else:snap=await client.rpc('session.create',source='oneshot',client_env={'PATH':'fixture-path','ZIWEI_MCP_TOKEN':secret},model='gpt-6.1-sol',provider='openai-codex')
  # Existing native resume guards still see the caller's original creation flags.
  assert args.reasoning is None,'RESUME_CREATION_POLICY_CHANGED'
  return await viewmodule.GatewayChatView(client,snap).run()
gateway=module('hermes_cli.gateway_chat',connect_gateway=connect_gateway,run_gateway_chat=native_chat)
sys.modules['hermes_cli.gateway_client'].connect_gateway=connect_gateway
if request.get('nativeGateway'):
 exec(compile(pathlib.Path(request['nativeGateway']).read_text(encoding='utf-8'),'isolated-native-gateway-chat.py','exec'),gateway.__dict__)
 async def inline_thread(fn,*args):return fn(*args)
 gateway.asyncio=types.SimpleNamespace(to_thread=inline_thread)
if request.get('legacy'):
 sys.modules.pop('hermes_cli.gateway_chat')
 class Missing:
  def find_spec(self,name,path=None,target=None):
   if name=='hermes_cli.gateway_chat':raise ModuleNotFoundError(name='hermes_cli.gateway_chat')
 sys.meta_path.insert(0,Missing())
if request.get('composeKey'):
 module('hermes_cli.runtime_provider',resolve_runtime_provider=lambda *,requested=None,explicit_api_key=None,explicit_base_url=None:{'api_key':explicit_api_key,'base_url':explicit_base_url})
 os.environ.update(ZIWEI_BOT_PROVIDER_KEY='FIXTURE_PROVIDER_KEY',ZIWEI_BOT_KEY_PROVIDER='openai-codex',ZIWEI_BOT_KEY_ENDPOINT='https://fixture.invalid/v1')
 spec=importlib.util.spec_from_file_location('key_bridge',request['keyBridge']);key=importlib.util.module_from_spec(spec);spec.loader.exec_module(key)
 key.install(GatewayClientError)
spec=importlib.util.spec_from_file_location('session_bridge',request['bridge']);bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)
args=argparse.Namespace(reasoning=None,resume='session-fixture' if request.get('resume') else None,provider=None,base_url=None,api_key=None,query='Synthetic fixture only',quiet=True,continue_last='Ziwei fixture' if request.get('titled') else None,create_if_missing=bool(request.get('titled')))
if request.get('plain'):
 os.environ.pop('ZIWEI_BOT_REASONING_EFFORT',None)
 effective['mcp_servers']={}
before=dict(vars(args));before_argv=list(sys.argv);stderr=io.StringIO();caught=None;result=None
try:
 with contextlib.redirect_stderr(stderr):
  installed=bridge.install(config,None if request.get('ordinary') else {'kind':'hermes-bot','employeeId':'employee-fixture','revision':4,'home':str(home)},overlay=str(overlay),reject=GatewayClientError,active=not request.get('inactive'))
  if installed:
   coroutine=gateway.run_gateway_chat(args)
   try:coroutine.send(None)
   except StopIteration as done:result=done.value
  else:result='not-installed'
except Exception as error:caught={'type':type(error).__name__,'message':str(error)}
assert vars(args)==before and sys.argv==before_argv,'CALLER_STATE_MUTATED'
assert secret not in stderr.getvalue() and 'FIXTURE_PROVIDER_KEY' not in stderr.getvalue(),'SECRET_IN_RECEIPT'
proofs=[json.loads(line.split(':',1)[1]) for line in stderr.getvalue().splitlines() if line.startswith('ZIWEI_BOT_REASONING:')]
print(json.dumps({'result':result,'caught':caught,'calls':calls,'mutations':len(mutations),'proofs':proofs,'externalModelCalls':0,'networkCalls':0,'namespaceUnchanged':True}))
`;
function run(t,options={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-gateway-session-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const script=path.join(root,'harness.py');fs.writeFileSync(script,harness);
 const env={PYTHONUTF8:'1',PYTHONDONTWRITEBYTECODE:'1',TEMP:root,TMP:root};
 for(const key of ['SystemRoot','WINDIR','COMSPEC'])if(process.env[key])env[key]=process.env[key];
 const result=spawnSync(python,['-I','-B',script],{input:JSON.stringify({root,bridge,keyBridge,nativeGateway:process.env.ZIWEI_TEST_GATEWAY_CHAT_SOURCE||null,...options}),env,encoding:'utf8',windowsHide:true,timeout:15000});
 assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
}
test('gateway bridge carries private MCP and strict per-admission route with native receipt',t=>{
 const out=run(t);assert.equal(out.result,'complete',JSON.stringify(out));assert.equal(out.proofs.length,1);
 const proof=out.proofs[0];assert.equal(proof.employeeId,'employee-fixture');assert.equal(proof.evidence,'native_gateway_sdk');
 assert.equal(proof.admission_id,'admission-fixture');assert.equal(proof.execution_generation,8);assert.equal(proof.unknownSecret,undefined);
});
test('old session without explicit reasoning keeps history and rotates transport via fenced native mutation',t=>{
 const out=run(t,{resume:true,rotate:true});assert.equal(out.result,'complete',JSON.stringify(out));assert.equal(out.mutations,1);
 assert.equal(out.calls.filter(x=>x==='session.create').length,0);
});
test('fixed titled create-if-missing reattaches the existing session and rotates private MCP without clearing history',t=>{
 const out=run(t,{titled:true,rotate:true});assert.equal(out.result,'complete',JSON.stringify(out));assert.equal(out.mutations,1);
 assert.equal(out.calls.filter(x=>x==='session.create').length,1);assert.ok(out.calls.filter(x=>x==='session.resume').length>=3);
});
test('gateway capability and HOME mismatches refuse before submitting work',t=>{
 for(const options of [{missingMcpCap:true},{missingReasoningCap:true},{wrongHome:true}]){
  const out=run(t,options);assert.ok(out.caught);assert.equal(out.calls.includes('prompt.submit'),false);assert.equal(out.proofs.length,0);
 }
});
test('receipt cannot escape native session, admission, generation, epoch, profile, or route binding',t=>{
 for(const receiptPatch of [{session_id:'wrong'},{admission_id:'wrong'},{execution_generation:9},{authority_epoch:'wrong'},{profile_id:'wrong'},{provider:'wrong'},{model:'wrong'},{phase:'preflight'},{api_request_id:''}]){
  const out=run(t,{receiptPatch});assert.ok(out.caught,JSON.stringify(receiptPatch));assert.equal(out.proofs.length,0);
 }
});
test('secret references in argv refuse and old/inactive native paths remain unmodified',t=>{
 assert.ok(run(t,{badRef:true}).caught);
 assert.equal(run(t,{legacy:true}).result,'not-installed');assert.equal(run(t,{inactive:true}).result,'not-installed');
});
test('a declared capability without an actual SDK receipt cannot report chat success',t=>{
 const out=run(t,{missingReceipt:true});assert.equal(out.result,null);assert.match(out.caught.message,/RECEIPT_MISSING/);
});
test('session bridge composes with independent provider key namespace wrapper',t=>{
 const out=run(t,{composeKey:true});assert.equal(out.result,'complete',JSON.stringify(out));assert.equal(out.proofs.length,1);
});

test('ordinary Gateway chats without private MCP or strict reasoning retain the native path',t=>{
 const out=run(t,{plain:true,missingMcpCap:true,missingReasoningCap:true});
 assert.equal(out.result,'not-installed');assert.equal(out.caught,null);assert.deepEqual(out.calls,[]);
});
test('ordinary employee Gateway chats retain execution-private MCP without requiring Bot reasoning capabilities',t=>{
 for(const options of [{},{resume:true},{titled:true},{resume:true,rotate:true}]){
  const out=run(t,{ordinary:true,missingReasoningCap:true,...options});
  assert.equal(out.result,'complete',JSON.stringify(out));assert.equal(out.caught,null);assert.deepEqual(out.proofs,[]);
  assert.ok(out.calls.includes('prompt.submit'));
 }
 const rejected=run(t,{ordinary:true,missingMcpCap:true});assert.match(rejected.caught.message,/CAPABILITY_UNSUPPORTED/);
 assert.equal(rejected.calls.includes('prompt.submit'),false);
});
test('canonical nested profile identity is preserved across create, resume, receipt and existing history',t=>{
 for(const options of [{},{resume:true},{titled:true},{resume:true,rotate:true},{snapshotProfile:'matching-top'}]){
  const out=run(t,options);assert.equal(out.result,'complete',JSON.stringify(out));assert.equal(out.proofs.length,1);
  assert.equal(out.proofs[0].authority_epoch,3);assert.equal(out.proofs[0].session_id,'session-fixture');
 }
});
test('missing, wrong, invalid or contradictory native snapshot profiles refuse before any prompt',t=>{
 for(const snapshotProfile of ['conflicting-top','missing-nested','wrong-nested','wrong-nested-matching-top','invalid-info']){
  const out=run(t,{snapshotProfile});assert.equal(out.result,null);assert.match(out.caught.message,/BOT_GATEWAY_SESSION_MISMATCH/);
  assert.equal(out.calls.includes('prompt.submit'),false);assert.equal(out.proofs.length,0);
 }
});
test('native snapshot authority epoch must match the authenticated description before admission',t=>{
 for(const snapshotEpoch of [4,'3',true,-1,9007199254740992]){
  const out=run(t,{snapshotEpoch});assert.equal(out.result,null);assert.equal(out.calls.includes('prompt.submit'),false);assert.equal(out.proofs.length,0);
 }
});
