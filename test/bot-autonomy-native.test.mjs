import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const python=[process.env.ZIWEI_TEST_PYTHON,'python3','python','py'].filter(Boolean).find(command=>spawnSync(command,['--version'],{encoding:'utf8'}).status===0);
test('native autonomy adapter registers and sends only the current action scoped request',{skip:!python},()=>{
 const script=String.raw`
import importlib.util,sys,types,json,os
spec=importlib.util.spec_from_file_location('adapter',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
registered={}
registry=types.SimpleNamespace(register=lambda **kw:registered.update(kw))
sys.modules['tools.registry']=types.SimpleNamespace(registry=registry)
sys.modules['toolsets']=types.SimpleNamespace(TOOLSETS={})
m.install({'workspace':'fixture','employeeId':'employee_one'})
assert registered['name']=='ziwei_autonomy'
os.environ.update(ZIWEI_BOT_ACTION_ID='action_one',ZIWEI_BOT_DEVICE_TOKEN='synthetic-local-token',ZIWEI_API_BASE='https://fixture.invalid')
seen=[]
class Response:
 def __enter__(self):return self
 def __exit__(self,*args):pass
 def read(self):return b'{"scheduler":"ziwei"}'
def urlopen(req,timeout):
 seen.append(req)
 return Response()
m._open=urlopen
handler=registered['handler'];assert json.loads(handler({'operation':'routines'}))['scheduler']=='ziwei'
assert seen[0].full_url=='https://fixture.invalid/a2a/v1/actions/action_one/bot-autonomy'
first=json.loads(seen[0].data);handler({'operation':'routines'});assert first==json.loads(seen[1].data)
assert m.NoRedirect().redirect_request(None,None,302,'',{},'https://attacker.invalid') is None
os.environ['ZIWEI_API_BASE']='http://attacker.invalid';assert json.loads(handler({'operation':'status'}))['error']=='BOT_AUTONOMY_TLS_REQUIRED'
os.environ['ZIWEI_API_BASE']='https://fixture.invalid'
def broken(*args,**kw):raise Exception('synthetic-private-material')
m._open=broken
assert 'synthetic-private-material' not in handler({'operation':'status'})
print('native adapter passed')
`;
 const result=spawnSync(python,['-I','-c',script,path.resolve('src/hermes-autonomy-tools.py')],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/native adapter passed/);
});
