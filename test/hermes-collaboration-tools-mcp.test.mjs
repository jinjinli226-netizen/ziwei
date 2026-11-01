import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const python=process.env.ZIWEI_TEST_PYTHON||'py';
const server=path.resolve('src/hermes-collaboration-tools-mcp.py');
const env=()=>Object.fromEntries(Object.entries(process.env).filter(([key])=>['PATH','SYSTEMROOT','WINDIR','TEMP','TMP'].includes(key.toUpperCase())));

test('private collaboration MCP advertises real platform handlers without native process spawning',()=>{
 const requests=[{id:1,method:'tools/list'},{id:2,method:'tools/call',params:{name:'delegate_task',arguments:{action:'list'}}}].map(x=>({...x,jsonrpc:'2.0'}));
 const r=spawnSync(python,['-I','-B','-S',server],{env:env(),input:requests.map(JSON.stringify).join('\n')+'\n',encoding:'utf8',windowsHide:true,timeout:10000});
 assert.equal(r.status,0,r.stderr);const rows=r.stdout.trim().split(/\r?\n/).map(JSON.parse);
 assert.deepEqual(rows[0].result.tools.map(x=>x.name),['message_agent','delegate_task']);
 assert.equal(rows[1].result.isError,true);
 assert.equal(JSON.parse(rows[1].result.content[0].text).error,'BOT_COLLABORATION_BINDING_INVALID');
});

test('private collaboration calls share native handlers and retain exact action credentials and independent Profile binding',()=>{
 const script=String.raw`
import importlib.util,json,os,sys,tempfile,pathlib,urllib.request,io
spec=importlib.util.spec_from_file_location('private',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as directory:
 root=pathlib.Path(directory)
 for name in ('one','two'):
  home=root/name;home.mkdir();binding={'kind':'hermes-bot','home':str(home),'employeeId':'employee_'+name,'workspace':'fixture','sourceProfile':'bot-'+name,'key':'key-'+name}
  (home/'ziwei-instance.json').write_text(json.dumps({'templateId':'ziwei-hermes-bot',**binding}),encoding='utf8')
  os.environ.update(HERMES_HOME=str(home),ZIWEI_COLLABORATION_BINDING=json.dumps(binding),ZIWEI_BOT_ACTION_ID='action_'+name,ZIWEI_BOT_DEVICE_TOKEN='PRIVATE_'+name,ZIWEI_API_BASE='https://fixture.invalid')
  seen=[]
  class Response:
   def __enter__(self):return self
   def __exit__(self,*args):pass
   def read(self):return b'{"actions":[]}'
  def transport(req,timeout):seen.append(req);return Response()
  urllib.request.urlopen=transport
  def call(name,args):return m.handle({'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':name,'arguments':args}})['result']
  listing=call('delegate_task',{'action':'list'});assert not listing['isError'];assert json.loads(seen[-1].data)=={'operation':'list'}
  assert seen[-1].full_url=='https://fixture.invalid/a2a/v1/actions/action_'+name+'/bot-collaboration'
  assert seen[-1].get_header('X-ziwei-device-token')=='PRIVATE_'+name
  message={'target':'employee_target','message':'Internal fixture only'}
  private=call('message_agent',message);native=m.bridge.create_collaboration_handlers(binding)['message_agent'](**message)
  assert json.loads(private['content'][0]['text'])==json.loads(native)
  assert seen[-1].data==seen[-2].data and json.loads(seen[-1].data)['targetEmployeeIds']==['employee_target']
  call('delegate_task',{'tasks':[{'target_employee_id':'employee_target','goal':'Read fixture'}]})
  assert json.loads(seen[-1].data)['mode']=='delegate'
  binding['employeeId']='employee_other';os.environ['ZIWEI_COLLABORATION_BINDING']=json.dumps(binding)
  before=len(seen);denied=call('delegate_task',{'action':'list'});assert denied['isError'] and len(seen)==before
  assert 'PRIVATE_' not in json.dumps(denied)
  binding['employeeId']='employee_'+name;os.environ['ZIWEI_COLLABORATION_BINDING']=json.dumps(binding);os.environ['HERMES_HOME']=str(root/'other')
  assert call('delegate_task',{'action':'list'})['isError'] and len(seen)==before
 print('shared handlers and separate profiles passed')
`;
 const r=spawnSync(python,['-I','-B','-S','-c',script,server],{env:env(),encoding:'utf8',windowsHide:true,timeout:10000});
 assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/shared handlers and separate profiles passed/);
});
