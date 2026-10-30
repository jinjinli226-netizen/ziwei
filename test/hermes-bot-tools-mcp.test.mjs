import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

const python=[process.env.ZIWEI_TEST_PYTHON,'python3','python','py'].filter(Boolean).find(command=>spawnSync(command,['--version'],{encoding:'utf8',windowsHide:true}).status===0);
const server=path.resolve('src/hermes-bot-tools-mcp.py');
const environment=()=>Object.fromEntries(Object.entries(process.env).filter(([key])=>['PATH','SYSTEMROOT','WINDIR','TEMP','TMP'].includes(key.toUpperCase())));
const request=(id,method,params)=>({jsonrpc:'2.0',id,method,...(params?{params}:{})});

test('private Bot MCP serves one shared tool over real stdio without Hermes or credentials',{skip:!python},()=>{
  const input=[request(0,'initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'fixture',version:'1'}}),
    {jsonrpc:'2.0',method:'notifications/initialized'},request(1,'ping'),request(2,'tools/list'),
    request(3,'tools/call',{name:'ziwei_autonomy',arguments:{operation:'status'}}),
    request(4,'tools/call',{name:'other',arguments:{operation:'status'}}),
    request(5,'tools/call',{name:'ziwei_autonomy',arguments:[]}),request(6,'unknown'),
    '{private-malformed-input',request(7,'ping')];
  const result=spawnSync(python,['-I','-B','-S',server],{input:input.map(value=>typeof value==='string'?value:JSON.stringify(value)).join('\n')+'\n',env:environment(),encoding:'utf8',windowsHide:true,timeout:10000});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,'');
  const rows=result.stdout.trim().split(/\r?\n/).map(line=>JSON.parse(line));
  assert.deepEqual(rows.map(row=>row.id),[0,1,2,3,4,5,6,null,7]);
  assert.equal(rows[0].result.protocolVersion,'2024-11-05');assert.deepEqual(rows[0].result.capabilities,{tools:{}});
  assert.deepEqual(rows[1].result,{});assert.equal(rows[2].result.tools.length,1);
  const tool=rows[2].result.tools[0];assert.equal(tool.name,'ziwei_autonomy');assert.equal(tool.inputSchema.additionalProperties,false);
  assert.deepEqual(tool.inputSchema.properties.operation.enum,['status','routines','configure','createRoutine','pauseRoutine']);
  assert.equal(Object.hasOwn(tool,'parameters'),false);
  assert.equal(rows[3].result.isError,true);assert.deepEqual(JSON.parse(rows[3].result.content[0].text),{error:'BOT_AUTONOMY_DEVICE_REQUIRED'});
  assert.equal(rows[4].error.code,-32602);assert.equal(rows[5].error.code,-32602);assert.equal(rows[6].error.code,-32601);
  assert.equal(rows[7].error.code,-32700);assert.deepEqual(rows[8].result,{});
  assert.equal(result.stdout.includes('private-malformed-input'),false);
});

test('private MCP and native registration share the original scoped autonomy handler and transport',{skip:!python},()=>{
  const script=String.raw`
import importlib.util,json,os,sys,types,urllib.error,io
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,file);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
m=load('private_mcp',sys.argv[1])
assert 'hermes_cli' not in sys.modules and 'toolsets' not in sys.modules and 'tools.registry' not in sys.modules
registered={}
sys.modules['tools.registry']=types.SimpleNamespace(registry=types.SimpleNamespace(register=lambda **kw:registered.update(kw)))
sys.modules['toolsets']=types.SimpleNamespace(TOOLSETS={})
m.autonomy.install({'employeeId':'fixture'})
assert registered['schema']['parameters']==m.handle({'jsonrpc':'2.0','id':1,'method':'tools/list'})['result']['tools'][0]['inputSchema']
os.environ.update(ZIWEI_BOT_ACTION_ID='action_fixture',ZIWEI_BOT_DEVICE_TOKEN='SYNTHETIC_PRIVATE_TOKEN',ZIWEI_API_BASE='https://fixture.invalid')
seen=[]
class Response:
 def __enter__(self):return self
 def __exit__(self,*args):pass
 def read(self):return b'{"scheduler":"ziwei","routines":[]}'
def transport(req,timeout):
 seen.append((req,timeout));return Response()
m.autonomy._open=transport
def call(arguments):return m.handle({'jsonrpc':'2.0','id':2,'method':'tools/call','params':{'name':'ziwei_autonomy','arguments':arguments}})['result']
arguments={'operation':'routines'}
result=call(arguments);assert result['isError'] is False
assert json.loads(result['content'][0]['text'])=={'scheduler':'ziwei','routines':[]}
registered['handler'](arguments)
assert seen[0][0].data==seen[1][0].data and seen[0][1]==20
assert seen[0][0].full_url=='https://fixture.invalid/a2a/v1/actions/action_fixture/bot-autonomy'
assert seen[0][0].get_header('X-ziwei-device-token')=='SYNTHETIC_PRIVATE_TOKEN'
assert 'SYNTHETIC_PRIVATE_TOKEN' not in seen[0][0].data.decode()
call({'operation':'configure','input':{'toolsets':[]},'idempotencyKey':'original-key'})
assert json.loads(seen[-1][0].data)['idempotencyKey']=='original-key'
def rejected(req,timeout):raise urllib.error.HTTPError(req.full_url,403,'PRIVATE',{},io.BytesIO(b'{"code":"BOT_AUTONOMY_USER_GRANT_REQUIRED"}'))
m.autonomy._open=rejected
denied=call({'operation':'configure','input':{'toolsets':['terminal']}})
assert denied['isError'] is True and json.loads(denied['content'][0]['text'])=={'error':'BOT_AUTONOMY_USER_GRANT_REQUIRED','outcome_uncertain':False}
def broken(*args,**kwargs):raise RuntimeError('SYNTHETIC_PRIVATE_TOKEN')
m.autonomy._open=broken
uncertain=call(arguments)
assert uncertain['isError'] is True and json.loads(uncertain['content'][0]['text'])['outcome_uncertain'] is True
assert 'SYNTHETIC_PRIVATE_TOKEN' not in json.dumps(uncertain)
assert m.autonomy.NoRedirect().redirect_request(None,None,302,'',{},'https://other.invalid') is None
print('shared scoped handler passed')
`;
  const result=spawnSync(python,['-I','-B','-S','-c',script,server],{env:environment(),encoding:'utf8',windowsHide:true,timeout:10000});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/shared scoped handler passed/);
});
